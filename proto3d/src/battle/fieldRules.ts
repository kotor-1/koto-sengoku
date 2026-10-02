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
 * 第3群で足したもの（どれも、その地形・門を持たない戦場では計算に入らない。既存の 10 戦場は 1 刻みも同じ）：
 * - 障害物 building・fence・wall：通れない。building・wall（と閉じた門）は射線も遮る（lineOfSight）。fence は射線を通す。
 * - 乾いた足場 dry：湿地・水田・浅瀬に重ねると、その所の速さ・損害・矢の倍率を打ち消す（普通の地面。土手道は dry に road を重ねる）。
 * - 門（FieldRules.gates）：閉じている間は通れない・射線を遮る。開いたら rebuildNav で格子（道探し・射線）を作り直す。
 * - 地形の決まりの arrowDealMul（中の弓の射る矢）・noCharge（中の騎馬は突撃にならない）。
 *
 * sim.ts を実行時に import しない（sim.ts がこのファイルを import するため）。
 */
import type { BattleMap, FieldRules, GateDef, HighGroundRule, Side, SpecialRule, TerrainArea, TerrainKind, TerrainRule, UnitKind, Zone } from './types';
import { NAV_CELL, buildNav, type NavGrid } from './pathfind';

/** まとめた地形の決まり（省いた項目を既定で埋めたもの） */
export interface ResolvedTerrainRule {
    speed: number;
    kindSpeed: Partial<Record<UnitKind, number>>;
    dealMul: number;
    takeMul: number;
    arrowTakeMul: number;
    /** 中の部隊が見えるようになる距離（隠れない地形は null） */
    hideSight: number | null;
    /** 中の弓が射る矢の倍率 */
    arrowDealMul: number;
    /** 中の騎馬は突撃にならない */
    noCharge: boolean;
}

/**
 * 地形の既定（Version 11 と同じ値。浅瀬は設計 docs/battlefields-design.md §3 の既定）。
 * 林：遅い・矢 ×0.6・60 m まで見えない（RULES.woodsSight・woodsArcheryMul）。湿地：とても遅い・与える ×0.8・受ける ×1.15（RULES.marsh*）。
 * 深い川・崖は通れない（速さ 0）。
 * 橋（第2群で足した）：動きは道と同じ ×1.2、ほかは変えない（狭い正面は特殊ルール narrow_frontage で別に付ける）。
 * 水田（第2群で足した）：動き ×0.3。部隊の種類ごとに kindSpeed を掛ける（騎馬 ×2/3 で合わせて ×0.2、弓 ×7/6 で合わせて ×0.35。
 * 槍・本陣は ×0.3 のまま）。中で斬り合うと与える ×0.85・受ける ×1.1（湿地の ×0.8・×1.15 より少し軽い）。戦場ごとに terrainRules.paddy で上書きできる。
 */
const PLAIN = { arrowDealMul: 1, noCharge: false } as const;
export const TERRAIN_DEFAULTS: Readonly<Record<TerrainKind, Readonly<ResolvedTerrainRule>>> = {
    hill: { speed: 1, kindSpeed: {}, dealMul: 1, takeMul: 1, arrowTakeMul: 1, hideSight: null, ...PLAIN },
    woods: { speed: 0.5, kindSpeed: {}, dealMul: 1, takeMul: 1, arrowTakeMul: 0.6, hideSight: 60, ...PLAIN },
    marsh: { speed: 0.35, kindSpeed: {}, dealMul: 0.8, takeMul: 1.15, arrowTakeMul: 1, hideSight: null, ...PLAIN },
    road: { speed: 1.2, kindSpeed: {}, dealMul: 1, takeMul: 1, arrowTakeMul: 1, hideSight: null, ...PLAIN },
    river: { speed: 0, kindSpeed: {}, dealMul: 1, takeMul: 1, arrowTakeMul: 1, hideSight: null, ...PLAIN },
    ford: { speed: 0.4, kindSpeed: {}, dealMul: 0.8, takeMul: 1.2, arrowTakeMul: 1, hideSight: null, ...PLAIN },
    cliff: { speed: 0, kindSpeed: {}, dealMul: 1, takeMul: 1, arrowTakeMul: 1, hideSight: null, ...PLAIN },
    bridge: { speed: 1.2, kindSpeed: {}, dealMul: 1, takeMul: 1, arrowTakeMul: 1, hideSight: null, ...PLAIN },
    paddy: { speed: 0.3, kindSpeed: { kiba: 2 / 3, yumi: 7 / 6 }, dealMul: 0.85, takeMul: 1.1, arrowTakeMul: 1, hideSight: null, ...PLAIN },
    // 第3群：障害物は通れない（速さ 0。速さの順には入れない）。乾いた足場は普通の地面（湿地などを打ち消すだけ）
    building: { speed: 0, kindSpeed: {}, dealMul: 1, takeMul: 1, arrowTakeMul: 1, hideSight: null, ...PLAIN },
    fence: { speed: 0, kindSpeed: {}, dealMul: 1, takeMul: 1, arrowTakeMul: 1, hideSight: null, ...PLAIN },
    wall: { speed: 0, kindSpeed: {}, dealMul: 1, takeMul: 1, arrowTakeMul: 1, hideSight: null, ...PLAIN },
    dry: { speed: 1, kindSpeed: {}, dealMul: 1, takeMul: 1, arrowTakeMul: 1, hideSight: null, ...PLAIN },
};

/** 通れない障害物（第3群）。building・wall は射線も遮る */
export const OBSTACLE_KINDS: readonly TerrainKind[] = ['building', 'fence', 'wall'];
/** 射線を遮る障害物の種類 */
export const LOS_BLOCK_KINDS: readonly TerrainKind[] = ['building', 'wall'];
/** 射線を遮る高さの既定（m。TerrainArea.height・GateDef.height で上書き） */
export const OBSTACLE_HEIGHT = { building: 6, wall: 6, gate: 6 } as const;
/** 射線の目の高さ（m。射手と相手の地面の高さに足して、線分の高さを出す） */
export const LOS_EYE = 1.5;
/** 乾いた足場（dry）が打ち消す地形 */
export const DRY_MASKS: readonly TerrainKind[] = ['marsh', 'paddy', 'ford'];

/**
 * 速さを決める地形の順（重なるときは最初に当たった 1 つ）。深い川・崖は通れないので速さの順には入れない。
 * 橋は川の上でいつも橋の速さ。道は水田より先（田の中の畦道・街道は速い）。橋・水田の無い戦場では、今までの順（湿地 > 浅瀬 > 林 > 道 > 丘）と同じ
 */
export const TERRAIN_PRIORITY: readonly TerrainKind[] = ['bridge', 'marsh', 'ford', 'woods', 'road', 'paddy', 'hill'];

/** 高低差の既定（Version 11：下から正面に来る相手 ×0.7、高さの差 2 m 以上。射程・視界の上乗せなし。高所から射る矢の倍率なし） */
export const HIGH_GROUND_DEFAULTS: Readonly<Required<HighGroundRule>> = { defenseVsLower: 0.7, minDiff: 2, rangeBonus: 0, sightBonus: 0, arrowDealVsLower: 1 };

/** 合戦の計算で使う、戦場ごとの決まり */
/** 合戦中の門 1 つの状態（FieldEnv.gates） */
export interface GateRun {
    def: GateDef;
    /** 門を持つ側（制圧されて開く） */
    holder: Side;
    open: boolean;
    /** 制圧の区域を、門を持つ側がいない状態で反対の側が続けて占めている秒数 */
    sec: number;
    /** 開いた時刻（開いていなければ null） */
    openedT: number | null;
    /** 制圧を始めた知らせを最後に出した時刻（出していなければ null。出入りを繰り返すときに知らせを重ねない） */
    noteT: number | null;
}

/** 射線の格子（道探しの格子と同じ升。升ごとに射線を遮る高さ。0 は遮らない） */
export interface LosGrid {
    cell: number;
    x0: number;
    z0: number;
    cols: number;
    rows: number;
    height: Float32Array;
}

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
    /** 中の弓の矢の倍率が 1 でない地形・中の騎馬が突撃にならない地形（第3群。無い戦場では空） */
    arrowDealKinds: TerrainKind[];
    noChargeKinds: TerrainKind[];
    /** 乾いた足場（dry）がある（湿地・水田・浅瀬の倍率を打ち消す所がある） */
    dry: boolean;
    /** 門（FieldRules.gates。無い戦場では空） */
    gates: GateRun[];
    /** 射線の格子（射線を遮る障害物・門がある戦場だけ。無ければ null で、射線を見ない） */
    los: LosGrid | null;
    /** 第3群の動きの直し（FieldRules.refinedMoves。省けば false で、既存の 10 戦場の動きのまま） */
    refined: boolean;
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

/**
 * 地面の高さ（m）。丘は円で、中心が height、縁が 0 の丸い頂（1 − (d/r)²）。四角の丘は一様な高さ。
 * カプセルの丘（尾根）は、線分からの距離 d で同じ式（線分の上が height、幅 r の所で 0）。sim.ts の elevationAt はこれを呼ぶ
 * （射線の計算で fieldRules.ts からも使うため、ここに置く。計算は Version 14 までの sim.ts の elevationAt と同じ）
 */
export function terrainElevation(map: BattleMap, x: number, z: number): number {
    let h = 0;
    for (const a of map.terrain) {
        if (a.kind !== 'hill') continue;
        const H = a.height ?? 10;
        if (a.circle) {
            const d = Math.hypot(x - a.circle.cx, z - a.circle.cz) / a.circle.r;
            if (d < 1) h = Math.max(h, H * (1 - d * d));
        } else if (a.capsule) {
            const d = capsuleDist(a.capsule, x, z) / a.capsule.r;
            if (d < 1) h = Math.max(h, H * (1 - d * d));
        } else if (a.rect && inZone(a, x, z)) h = Math.max(h, H);
    }
    return h;
}

/** 通れない地形の区域がある（深い川・崖・第3群の障害物） */
export function hasBlockingTerrain(map: BattleMap): boolean {
    return map.terrain.some((a) => a.kind === 'river' || a.kind === 'cliff' || OBSTACLE_KINDS.includes(a.kind));
}

/** 障害物（building・fence・wall）の区域がある地図か（地図ごとに 1 回だけ数える） */
const obstacleMaps = new WeakMap<BattleMap, boolean>();
function hasObstacles(map: BattleMap): boolean {
    let v = obstacleMaps.get(map);
    if (v === undefined) obstacleMaps.set(map, (v = map.terrain.some((a) => OBSTACLE_KINDS.includes(a.kind))));
    return v;
}

/**
 * その地点を通れるか（戦場の外・深い川（浅瀬・橋を除く）・崖・通れる範囲の外は通れない）。
 * 第3群：障害物（building・fence・wall）と、閉じている門（gates）も通れない
 */
export function passableIn(map: BattleMap, passable: FieldEnv['passable'], x: number, z: number, gates?: readonly GateRun[]): boolean {
    if (Math.abs(x) > map.width / 2 || Math.abs(z) > map.depth / 2) return false;
    if (passable && (x < passable.x0 || x > passable.x1 || z < passable.z0 || z > passable.z1)) return false;
    if (inKind(map, 'cliff', x, z)) return false;
    if (inKind(map, 'river', x, z) && !inKind(map, 'ford', x, z) && !inKind(map, 'bridge', x, z)) return false;
    if (hasObstacles(map)) for (const k of OBSTACLE_KINDS) if (inKind(map, k, x, z)) return false;
    if (gates) for (const g of gates) if (!g.open && inZone(g.def, x, z)) return false;
    return true;
}

/** 乾いた足場（dry）で打ち消されている地形か（dry の無い戦場ではいつも false） */
function dryMasked(map: BattleMap, env: FieldEnv, k: TerrainKind, x: number, z: number): boolean {
    return env.dry && DRY_MASKS.includes(k) && inKind(map, 'dry', x, z);
}

/** その地点の地形の速さ（部隊の種類ごとの補正も掛ける） */
export function terrainSpeedIn(map: BattleMap, env: FieldEnv, kind: UnitKind | null, x: number, z: number): number {
    for (const k of TERRAIN_PRIORITY) {
        if (!inKind(map, k, x, z)) continue;
        if (env.dry && dryMasked(map, env, k, x, z)) continue;
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
        arrowDealMul: o?.arrowDealMul ?? base.arrowDealMul,
        noCharge: o?.noCharge ?? base.noCharge,
    };
}

/** 射線の格子を作る（射線を遮る障害物・門が無い戦場は null） */
function buildLos(map: BattleMap, gates: readonly GateRun[]): LosGrid | null {
    const blockers = map.terrain.filter((a) => LOS_BLOCK_KINDS.includes(a.kind));
    if (blockers.length === 0 && gates.length === 0) return null;
    const cell = NAV_CELL;
    const cols = Math.max(1, Math.ceil(map.width / cell));
    const rows = Math.max(1, Math.ceil(map.depth / cell));
    const x0 = -map.width / 2;
    const z0 = -map.depth / 2;
    const height = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const x = x0 + (c + 0.5) * cell;
            const z = z0 + (r + 0.5) * cell;
            let h = 0;
            for (const a of blockers) if (inZone(a, x, z)) h = Math.max(h, a.height ?? OBSTACLE_HEIGHT[a.kind as 'building' | 'wall']);
            for (const g of gates) if (!g.open && inZone(g.def, x, z)) h = Math.max(h, g.def.height ?? OBSTACLE_HEIGHT.gate);
            height[r * cols + c] = h;
        }
    }
    return { cell, x0, z0, cols, rows, height };
}

/** 射線の格子の升の番号（格子の外は -1） */
function losCell(g: LosGrid, x: number, z: number): number {
    const c = Math.floor((x - g.x0) / g.cell);
    const r = Math.floor((z - g.z0) / g.cell);
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return -1;
    return r * g.cols + c;
}

/**
 * 射線が通るか（a から d へ。射線の格子の無い戦場ではいつも true＝見ない）。
 * 線分を 1 m おきにたどり、射線を遮る升（建物・石垣・閉じた門）の上で、線分の高さ（両端の地面の高さ＋目の高さ LOS_EYE を
 * まっすぐ結んだ高さ）が遮る高さより低ければ遮られる。高い所（丘・櫓）の上から射る・高い所の相手を射るときは、遮る物の上を越えることがある。
 * 両端の点そのものを含む升は見ない（建物の縁が格子の線からずれていると、建物の外に立つ部隊の点が「遮る升」に入ることがある。
 * 自分の立つ升で自分の射線が切れないように）
 */
export function lineOfSight(map: BattleMap, env: FieldEnv, a: { x: number; z: number }, d: { x: number; z: number }): boolean {
    const g = env.los;
    if (!g) return true;
    const len = Math.hypot(d.x - a.x, d.z - a.z);
    const steps = Math.max(1, Math.ceil(len));
    const ia = losCell(g, a.x, a.z);
    const id = losCell(g, d.x, d.z);
    let ea = NaN;
    let ed = NaN;
    for (let k = 1; k < steps; k++) {
        const t = k / steps;
        const x = a.x + (d.x - a.x) * t;
        const z = a.z + (d.z - a.z) * t;
        const i = losCell(g, x, z);
        if (i < 0 || i === ia || i === id) continue;
        const h = g.height[i]!;
        if (h <= 0) continue;
        if (Number.isNaN(ea)) {
            ea = terrainElevation(map, a.x, a.z) + LOS_EYE;
            ed = terrainElevation(map, d.x, d.z) + LOS_EYE;
        }
        if (ea + (ed - ea) * t < h) return false;
    }
    return true;
}

/** 道探しの格子を作る（今の門の開き具合で） */
function makeNav(map: BattleMap, env: FieldEnv): NavGrid {
    return buildNav(
        map.width,
        map.depth,
        (x, z) => passableIn(map, env.passable, x, z, env.gates),
        (kind, x, z) => terrainSpeedIn(map, env, kind, x, z),
        env.refined,
    );
}

/** 門の開き具合が変わった：道探しの格子と射線の格子を作り直す（進んでいる道の引き直しは sim.ts が行う） */
export function rebuildNav(map: BattleMap, env: FieldEnv): void {
    if (env.nav) env.nav = makeNav(map, env);
    env.los = buildLos(map, env.gates);
}

/** 門をすべて開いた状態にする（戦場データの検査で、門が開いた後の格子を確かめるため） */
export function openAllGates(map: BattleMap, env: FieldEnv): void {
    for (const g of env.gates) g.open = true;
    rebuildNav(map, env);
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
        arrowDealKinds: kinds.filter((k) => terrain[k].arrowDealMul !== 1),
        noChargeKinds: kinds.filter((k) => terrain[k].noCharge),
        dry: present.has('dry'),
        gates: (rules?.gates ?? []).map((def) => ({ def, holder: def.holder ?? 'enemy', open: false, sec: 0, openedT: null, noteT: null })),
        los: null,
        refined: !!rules?.refinedMoves,
    };
    if (hasBlockingTerrain(map) || passable || rules?.pathfinding || env.gates.length > 0) env.nav = makeNav(map, env);
    env.los = buildLos(map, env.gates);
    return env;
}

/** 中にいる部隊の与える損害の倍率（重なる地形の分を掛ける。既定では湿地・浅瀬だけ） */
export function dealMulIn(map: BattleMap, env: FieldEnv, x: number, z: number): number {
    let m = 1;
    for (const k of env.dealKinds) if (inKind(map, k, x, z) && !dryMasked(map, env, k, x, z)) m *= env.terrain[k].dealMul;
    return m;
}
/** 中にいる部隊の受ける損害（斬り合い）の倍率 */
export function takeMulIn(map: BattleMap, env: FieldEnv, x: number, z: number): number {
    let m = 1;
    for (const k of env.takeKinds) if (inKind(map, k, x, z) && !dryMasked(map, env, k, x, z)) m *= env.terrain[k].takeMul;
    return m;
}
/** 中にいる部隊の受ける矢の損害の倍率 */
export function arrowTakeMulIn(map: BattleMap, env: FieldEnv, x: number, z: number): number {
    let m = 1;
    for (const k of env.arrowKinds) if (inKind(map, k, x, z) && !dryMasked(map, env, k, x, z)) m *= env.terrain[k].arrowTakeMul;
    return m;
}
/** 中にいる弓の射る矢の倍率（第3群。倍率を持つ地形の無い戦場では 1） */
export function arrowDealMulIn(map: BattleMap, env: FieldEnv, x: number, z: number): number {
    let m = 1;
    for (const k of env.arrowDealKinds) if (inKind(map, k, x, z) && !dryMasked(map, env, k, x, z)) m *= env.terrain[k].arrowDealMul;
    return m;
}
/** 中にいる騎馬が突撃にならない所か（第3群。noCharge の地形の無い戦場ではいつも false） */
export function noChargeIn(map: BattleMap, env: FieldEnv, x: number, z: number): boolean {
    for (const k of env.noChargeKinds) if (inKind(map, k, x, z) && !dryMasked(map, env, k, x, z)) return true;
    return false;
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
