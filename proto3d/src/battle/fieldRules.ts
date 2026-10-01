/**
 * 戦場ごとの決まり（地形の速さ・損害・視界・高所・通れる所・特殊ルール）を、合戦の計算で使う形にまとめる。純粋な TypeScript。
 * sim.ts が合戦の始めに createFieldEnv を 1 回呼び、BattleState.field に入れる。
 *
 * - 既定（TERRAIN_DEFAULTS・HIGH_GROUND_DEFAULTS）は Version 11 の決まりと同じ値（sim.ts の RULES・TERRAIN_SPEED と揃える）。
 *   BattleSetup.fieldRules を省いた合戦（国境の原・歴史分岐の章）は、既定だけで今までと 1 刻みも同じ計算になる。
 * - 地形が重なるときの速さは TERRAIN_PRIORITY の順で最初に当たった 1 つ（橋 > 湿地 > 浅瀬 > 林 > 道 > 水田 > 丘）。損害・矢の倍率は、重なる地形の分を掛ける。
 *   水田の中に通す畦道・街道（道）は、道が水田より先に当たるので速い（ただし斬り合いの倍率は重なる分を掛けるので、街道は水田の区域に重ねず、
 *   水田を街道で分けて置く）。
 * - 通れない所：深い川（浅瀬・橋の重なる所を除く）・崖・fieldRules.passable の外。
 * - 区域の形は四角・円・カプセル（線分＋幅。細長い丘＝尾根）。通れない所がある戦場（または pathfinding: true）だけ、
 *   格子の道探し（pathfind.ts）を作る。
 *
 * sim.ts を実行時に import しない（sim.ts がこのファイルを import するため）。
 */
import type { BattleMap, FieldRules, HighGroundRule, SpecialRule, TerrainArea, TerrainKind, TerrainRule, UnitKind, Zone } from './types';
import { buildNav, type NavGrid } from './pathfind';

/** まとめた地形の決まり（省いた項目を既定で埋めたもの） */
export interface ResolvedTerrainRule {
    speed: number;
    kindSpeed: Partial<Record<UnitKind, number>>;
    dealMul: number;
    takeMul: number;
    arrowTakeMul: number;
    /** 中の部隊が見えるようになる距離（隠れない地形は null） */
    hideSight: number | null;
}

/**
 * 地形の既定（Version 11 と同じ値。浅瀬は設計 docs/battlefields-design.md §3 の既定）。
 * 林：遅い・矢 ×0.6・60 m まで見えない（RULES.woodsSight・woodsArcheryMul）。湿地：とても遅い・与える ×0.8・受ける ×1.15（RULES.marsh*）。
 * 深い川・崖は通れない（速さ 0）。
 * 橋（第2群で足した）：動きは道と同じ ×1.2、ほかは変えない（狭い正面は特殊ルール narrow_frontage で別に付ける）。
 * 水田（第2群で足した）：動き ×0.3。部隊の種類ごとに kindSpeed を掛ける（騎馬 ×2/3 で合わせて ×0.2、弓 ×7/6 で合わせて ×0.35。
 * 槍・本陣は ×0.3 のまま）。中で斬り合うと与える ×0.85・受ける ×1.1（湿地の ×0.8・×1.15 より少し軽い）。戦場ごとに terrainRules.paddy で上書きできる。
 */
export const TERRAIN_DEFAULTS: Readonly<Record<TerrainKind, Readonly<ResolvedTerrainRule>>> = {
    hill: { speed: 1, kindSpeed: {}, dealMul: 1, takeMul: 1, arrowTakeMul: 1, hideSight: null },
    woods: { speed: 0.5, kindSpeed: {}, dealMul: 1, takeMul: 1, arrowTakeMul: 0.6, hideSight: 60 },
    marsh: { speed: 0.35, kindSpeed: {}, dealMul: 0.8, takeMul: 1.15, arrowTakeMul: 1, hideSight: null },
    road: { speed: 1.2, kindSpeed: {}, dealMul: 1, takeMul: 1, arrowTakeMul: 1, hideSight: null },
    river: { speed: 0, kindSpeed: {}, dealMul: 1, takeMul: 1, arrowTakeMul: 1, hideSight: null },
    ford: { speed: 0.4, kindSpeed: {}, dealMul: 0.8, takeMul: 1.2, arrowTakeMul: 1, hideSight: null },
    cliff: { speed: 0, kindSpeed: {}, dealMul: 1, takeMul: 1, arrowTakeMul: 1, hideSight: null },
    bridge: { speed: 1.2, kindSpeed: {}, dealMul: 1, takeMul: 1, arrowTakeMul: 1, hideSight: null },
    paddy: { speed: 0.3, kindSpeed: { kiba: 2 / 3, yumi: 7 / 6 }, dealMul: 0.85, takeMul: 1.1, arrowTakeMul: 1, hideSight: null },
};

/**
 * 速さを決める地形の順（重なるときは最初に当たった 1 つ）。深い川・崖は通れないので速さの順には入れない。
 * 橋は川の上でいつも橋の速さ。道は水田より先（田の中の畦道・街道は速い）。橋・水田の無い戦場では、今までの順（湿地 > 浅瀬 > 林 > 道 > 丘）と同じ
 */
export const TERRAIN_PRIORITY: readonly TerrainKind[] = ['bridge', 'marsh', 'ford', 'woods', 'road', 'paddy', 'hill'];

/** 高低差の既定（Version 11：下から正面に来る相手 ×0.7、高さの差 2 m 以上。射程・視界の上乗せなし。高所から射る矢の倍率なし） */
export const HIGH_GROUND_DEFAULTS: Readonly<Required<HighGroundRule>> = { defenseVsLower: 0.7, minDiff: 2, rangeBonus: 0, sightBonus: 0, arrowDealVsLower: 1 };

/** 合戦の計算で使う、戦場ごとの決まり */
export interface FieldEnv {
    terrain: Record<TerrainKind, ResolvedTerrainRule>;
    high: Required<HighGroundRule>;
    special: readonly SpecialRule[];
    passable: { x0: number; x1: number; z0: number; z1: number } | null;
    /** 格子の道探し（通れない所がある戦場だけ。無ければ null で、今までどおりまっすぐ進む） */
    nav: NavGrid | null;
    /** 損害・矢の倍率が 1 でない地形（毎刻みの計算を軽くするため） */
    dealKinds: TerrainKind[];
    takeKinds: TerrainKind[];
    arrowKinds: TerrainKind[];
    hideKinds: TerrainKind[];
    /** 特殊ルール（種類ごとに取り出したもの） */
    narrow: Extract<SpecialRule, { type: 'narrow_frontage' }>[];
    ambush: Extract<SpecialRule, { type: 'woods_ambush' }> | null;
    /** 新しい戦場の動きの決まり（FieldRules.settleMoves。省けば Version 11 の動き） */
    settleMoves: boolean;
}

/** 区域（地形・目標）の中か */
export function inZone(a: Zone | TerrainArea, x: number, z: number): boolean {
    if (a.rect) return x >= a.rect.x0 && x <= a.rect.x1 && z >= a.rect.z0 && z <= a.rect.z1;
    if (a.circle) return Math.hypot(x - a.circle.cx, z - a.circle.cz) <= a.circle.r;
    const c = 'capsule' in a ? a.capsule : undefined;
    if (c) return capsuleDist(c, x, z) <= c.r;
    return false;
}

/** カプセル（線分 (ax,az)〜(bx,bz)）の線分から (x, z) までの距離（m） */
export function capsuleDist(c: { ax: number; az: number; bx: number; bz: number }, x: number, z: number): number {
    const dx = c.bx - c.ax;
    const dz = c.bz - c.az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - c.ax) * dx + (z - c.az) * dz) / len2)) : 0;
    return Math.hypot(x - (c.ax + dx * t), z - (c.az + dz * t));
}

/** 地形の区域の中心（カプセルは線分の中点。丘の頂・名札の置き場所に使う） */
export function areaCenter(a: TerrainArea): { x: number; z: number } {
    if (a.capsule) return { x: (a.capsule.ax + a.capsule.bx) / 2, z: (a.capsule.az + a.capsule.bz) / 2 };
    return zoneCenter(a);
}
/** 区域の中心（目標の印・敵の考えの行き先に使う） */
export function zoneCenter(a: Zone): { x: number; z: number } {
    if (a.circle) return { x: a.circle.cx, z: a.circle.cz };
    if (a.rect) return { x: (a.rect.x0 + a.rect.x1) / 2, z: (a.rect.z0 + a.rect.z1) / 2 };
    return { x: 0, z: 0 };
}
function inKind(map: BattleMap, kind: TerrainKind, x: number, z: number): boolean {
    for (const a of map.terrain) if (a.kind === kind && inZone(a, x, z)) return true;
    return false;
}

/** 通れない地形の区域がある（深い川・崖） */
export function hasBlockingTerrain(map: BattleMap): boolean {
    return map.terrain.some((a) => a.kind === 'river' || a.kind === 'cliff');
}

/** その地点を通れるか（戦場の外・深い川（浅瀬・橋を除く）・崖・通れる範囲の外は通れない） */
export function passableIn(map: BattleMap, passable: FieldEnv['passable'], x: number, z: number): boolean {
    if (Math.abs(x) > map.width / 2 || Math.abs(z) > map.depth / 2) return false;
    if (passable && (x < passable.x0 || x > passable.x1 || z < passable.z0 || z > passable.z1)) return false;
    if (inKind(map, 'cliff', x, z)) return false;
    if (inKind(map, 'river', x, z) && !inKind(map, 'ford', x, z) && !inKind(map, 'bridge', x, z)) return false;
    return true;
}

/** その地点の地形の速さ（部隊の種類ごとの補正も掛ける） */
export function terrainSpeedIn(map: BattleMap, env: FieldEnv, kind: UnitKind | null, x: number, z: number): number {
    for (const k of TERRAIN_PRIORITY) {
        if (!inKind(map, k, x, z)) continue;
        const r = env.terrain[k];
        const ks = kind ? r.kindSpeed[kind] : undefined;
        return ks === undefined ? r.speed : r.speed * ks;
    }
    return 1;
}

function resolveRule(base: Readonly<ResolvedTerrainRule>, o: TerrainRule | undefined): ResolvedTerrainRule {
    return {
        speed: o?.speed ?? base.speed,
        kindSpeed: { ...base.kindSpeed, ...(o?.kindSpeed ?? {}) },
        dealMul: o?.dealMul ?? base.dealMul,
        takeMul: o?.takeMul ?? base.takeMul,
        arrowTakeMul: o?.arrowTakeMul ?? base.arrowTakeMul,
        hideSight: o?.hideSight ?? base.hideSight,
    };
}

/** 合戦の始めに 1 回：戦場の決まりをまとめる（fieldRules を省けば既定だけ） */
export function createFieldEnv(map: BattleMap, rules?: FieldRules): FieldEnv {
    const terrain = {} as Record<TerrainKind, ResolvedTerrainRule>;
    for (const k of Object.keys(TERRAIN_DEFAULTS) as TerrainKind[]) terrain[k] = resolveRule(TERRAIN_DEFAULTS[k], rules?.terrainRules?.[k]);
    const high: Required<HighGroundRule> = { ...HIGH_GROUND_DEFAULTS, ...(rules?.highGround ?? {}) };
    const special = rules?.specialRules ?? [];
    const passable = rules?.passable ? { ...rules.passable } : null;
    const present = new Set(map.terrain.map((a) => a.kind));
    const kinds = (Object.keys(terrain) as TerrainKind[]).filter((k) => present.has(k));
    const env: FieldEnv = {
        terrain,
        high,
        special,
        passable,
        nav: null,
        dealKinds: kinds.filter((k) => terrain[k].dealMul !== 1),
        takeKinds: kinds.filter((k) => terrain[k].takeMul !== 1),
        arrowKinds: kinds.filter((k) => terrain[k].arrowTakeMul !== 1),
        hideKinds: kinds.filter((k) => terrain[k].hideSight !== null),
        narrow: special.filter((r): r is Extract<SpecialRule, { type: 'narrow_frontage' }> => r.type === 'narrow_frontage'),
        ambush: special.find((r): r is Extract<SpecialRule, { type: 'woods_ambush' }> => r.type === 'woods_ambush') ?? null,
        settleMoves: !!rules?.settleMoves,
    };
    if (hasBlockingTerrain(map) || passable || rules?.pathfinding) {
        env.nav = buildNav(
            map.width,
            map.depth,
            (x, z) => passableIn(map, passable, x, z),
            (kind, x, z) => terrainSpeedIn(map, env, kind, x, z),
        );
    }
    return env;
}

/** 中にいる部隊の与える損害の倍率（重なる地形の分を掛ける。既定では湿地・浅瀬だけ） */
export function dealMulIn(map: BattleMap, env: FieldEnv, x: number, z: number): number {
    let m = 1;
    for (const k of env.dealKinds) if (inKind(map, k, x, z)) m *= env.terrain[k].dealMul;
    return m;
}
/** 中にいる部隊の受ける損害（斬り合い）の倍率 */
export function takeMulIn(map: BattleMap, env: FieldEnv, x: number, z: number): number {
    let m = 1;
    for (const k of env.takeKinds) if (inKind(map, k, x, z)) m *= env.terrain[k].takeMul;
    return m;
}
/** 中にいる部隊の受ける矢の損害の倍率 */
export function arrowTakeMulIn(map: BattleMap, env: FieldEnv, x: number, z: number): number {
    let m = 1;
    for (const k of env.arrowKinds) if (inKind(map, k, x, z)) m *= env.terrain[k].arrowTakeMul;
    return m;
}
/** 中にいる部隊が見えるようになる距離（隠れない所は null。重なるときは短い方） */
export function hideSightIn(map: BattleMap, env: FieldEnv, x: number, z: number): number | null {
    let best: number | null = null;
    for (const k of env.hideKinds) {
        if (!inKind(map, k, x, z)) continue;
        const h = env.terrain[k].hideSight!;
        if (best === null || h < best) best = h;
    }
    return best;
}
