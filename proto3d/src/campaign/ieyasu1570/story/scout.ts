/**
 * 歴史分岐「元亀元年・家康」の物見（任意。町の物見櫓から今の任務の戦場の方角を見て、地形を記録する）。純粋な関数。
 * 設計：docs/story-rpg-design.md §5.2。型：story/types.ts（ScoutPoint・ScoutEntry）。町の目印：town/spots.ts の LOOKOUT。
 *
 * - 物見の地点は物見櫓の下の 1 か所（id 'lookout'。城下の配役の kind 'lookout' の相手と同じ id）。
 * - 方角の印は 3 つ：今の任務の戦場の方角（模式図の地図の位置から向きを決める）と、その戦場の要所 2 つ。
 * - 記録の中身は、今の任務の戦場の地形のデータからコードで作る（第一章：battle/fields/border_field.ts、第二章：chapter2/battle.ts の
 *   CH2_FIELDS の戦場の terrain・退き口・目標の区域・特殊ルール）。存在しない道を作らない。敵の居場所・伏兵・援軍の出る所・敵の配置は出さない
 *   （地形のデータと目標の区域だけを読む。部隊・援軍のデータは読まない）。
 * - 物見できるのは探索・支度の段階だけ（戦後・結末はできない）。合戦の結果を反映すると記録は消える（次の戦場は別の所）。
 * - 記録は状態の省ける欄 scout（印の id の並び）。同じ印をもう一度入れても増えない。兵・信頼・目標・合戦の計算は変えない
 *   （軍議の選択肢の説明・合戦の前の説明・情勢の地図に文を足すだけ）。
 */
import { BORDER_FIELD_DEF } from '../../../battle/fields/border_field';
import type { BattlefieldDef } from '../../../battle/fields/types';
import type { TerrainArea, TerrainKind, Zone } from '../../../battle/types';
import type { MapPlace, ScoutEntry, ScoutPoint } from '../../../story/types';
import { CH2_FIELDS, CH2_MAP_NAMES } from '../chapter2/battle';
import { cloneIeyasu2State, isChapter2, type IeyasuAnyState } from '../chapter2/state';
import { cloneIeyasuState, type Policy } from '../state';
import { CH2_SITE, MAP_POS, SCOUT_SLOTS, mapHeading, wrapAngle, type GeoId } from './geo';

/** 物見の地点の id（城下の配役の物見櫓の相手と同じ id） */
export const LOOKOUT_ID = 'lookout';

/** 物見の対象の戦場（第一章は国境の原。第二章は方針ごとの任務の戦場） */
export type ScoutMission = 'border' | 'rear' | 'relief' | 'village';

/** 印の id（保存に入る。変えない）。並びは方角の印の並び（戦場の方角・要所 1・要所 2） */
export const SCOUT_MARK_IDS: Readonly<Record<ScoutMission, readonly string[]>> = {
    border: ['border.field', 'border.hill', 'border.flanks'],
    rear: ['rear.field', 'rear.neck', 'rear.hill'],
    relief: ['relief.field', 'relief.hill', 'relief.west'],
    village: ['village.field', 'village.square', 'village.fence'],
};

const MISSION_OF_POLICY: Readonly<Record<Policy, ScoutMission>> = { oda: 'rear', asai: 'relief', home: 'village' };

/** 任務の戦場の名前（地図・案内に出す） */
export function scoutMissionName(m: ScoutMission): string {
    return m === 'border' ? '国境の原' : CH2_MAP_NAMES[m === 'rear' ? 'oda' : m === 'relief' ? 'asai' : 'home'];
}

/** 地図の上の戦場の場所 */
function siteOf(m: ScoutMission): GeoId {
    return m === 'border' ? 'field1' : CH2_SITE[m === 'rear' ? 'oda' : m === 'relief' ? 'asai' : 'home'];
}

/** 状態の任務の戦場（第一章はどの方針でも国境の原） */
export function scoutMissionOf(s: Pick<IeyasuAnyState, 'policy'> & { chapter?: unknown }): ScoutMission {
    if (s.chapter === 2 && s.policy) return MISSION_OF_POLICY[s.policy];
    return 'border';
}

/** 物見ができる段階か（探索・支度だけ。軍議・合戦・戦後・結末はできない） */
export function canScout(s: Pick<IeyasuAnyState, 'phase'>): boolean {
    return s.phase === 'explore' || s.phase === 'muster';
}

/**
 * 保存で受け付ける印の id（その段階・任務で有り得る物）。合戦の前（探索・支度・出陣前）は任務の戦場の印、戦後・結末は無し。
 * chapter：1 か 2。policy：第二章の方針（第一章は見ない）。
 */
export function scoutMarksAllowed(chapter: 1 | 2, phase: string, policy: Policy | null): readonly string[] {
    if (phase !== 'explore' && phase !== 'muster' && phase !== 'battle') return [];
    if (chapter === 2) return policy ? SCOUT_MARK_IDS[MISSION_OF_POLICY[policy]] : [];
    return SCOUT_MARK_IDS.border;
}

// ================================================================ 地形のデータを読む小道具

type Rect = { x0: number; x1: number; z0: number; z1: number };
const rectOf = (t: TerrainArea): Rect | null => t.rect ?? (t.circle ? { x0: t.circle.cx - t.circle.r, x1: t.circle.cx + t.circle.r, z0: t.circle.cz - t.circle.r, z1: t.circle.cz + t.circle.r } : null);
const areaOf = (t: TerrainArea): number => {
    if (t.rect) return (t.rect.x1 - t.rect.x0) * (t.rect.z1 - t.rect.z0);
    if (t.circle) return Math.PI * t.circle.r * t.circle.r;
    return 0;
};
const centerOf = (t: TerrainArea): { x: number; z: number } => {
    if (t.circle) return { x: t.circle.cx, z: t.circle.cz };
    const r = rectOf(t)!;
    return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
};
const zoneCenterOf = (z: Zone): { x: number; z: number } => (z.circle ? { x: z.circle.cx, z: z.circle.cz } : { x: (z.rect!.x0 + z.rect!.x1) / 2, z: (z.rect!.z0 + z.rect!.z1) / 2 });
const ofKind = (f: BattlefieldDef, k: TerrainKind) => f.terrain.filter((t) => t.kind === k);
const largest = (ts: TerrainArea[]) => [...ts].sort((a, b) => areaOf(b) - areaOf(a))[0];

/** 方角の名前（戦場の真ん中から見て。真ん中に近ければ「中央」） */
function dirOf(f: BattlefieldDef, x: number, z: number): string {
    const ns = z < -f.depth * 0.12 ? '北' : z > f.depth * 0.12 ? '南' : '';
    const ew = x < -f.width * 0.12 ? '西' : x > f.width * 0.12 ? '東' : '';
    return ns + ew || '中央';
}

/** 南北に通る道（長さが戦場の奥行きの 8 割以上）。真ん中を通るか */
function mainRoad(f: BattlefieldDef): { center: boolean } | null {
    const r = ofKind(f, 'road')
        .map(rectOf)
        .find((x) => x && x.z1 - x.z0 >= f.depth * 0.8);
    if (!r) return null;
    return { center: Math.abs((r.x0 + r.x1) / 2) < f.width * 0.05 };
}

/** 2 点の間（まっすぐ）に、足の遅くなる所・通れない所（林・湿地・家・崖・川）が無いか（地形のデータで確かめる） */
function openBetween(f: BattlefieldDef, a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    const slow: TerrainKind[] = ['woods', 'marsh', 'building', 'cliff', 'river', 'wall', 'fence', 'paddy'];
    for (let i = 0; i <= 40; i++) {
        const x = a.x + ((b.x - a.x) * i) / 40;
        const z = a.z + ((b.z - a.z) * i) / 40;
        for (const t of f.terrain) {
            if (!slow.includes(t.kind)) continue;
            if (t.circle ? Math.hypot(x - t.circle.cx, z - t.circle.cz) <= t.circle.r : t.rect && x >= t.rect.x0 && x <= t.rect.x1 && z >= t.rect.z0 && z <= t.rect.z1) return false;
        }
    }
    return true;
}

// ================================================================ 戦場ごとの記録（地形のデータから作る）

interface MarkDef {
    id: string;
    /** 方角の印の名前（物見の眺めの札） */
    label: string;
    /** 記録の文（情勢の画面） */
    text: string;
    /** 短い文（軍議の選択肢・合戦の前の説明の「物見」の行） */
    short: string;
    /** 地図に足す場所の短い名前（地図の上では任務の場所のまわりの決まった所に置く：geo.ts の SCOUT_SLOTS） */
    mapName: string;
}

function borderMarks(): MarkDef[] {
    const f = BORDER_FIELD_DEF;
    const road = mainRoad(f);
    const hill = largest(ofKind(f, 'hill'))!;
    const hc = centerOf(hill);
    const woods = largest(ofKind(f, 'woods'))!;
    const marsh = largest(ofKind(f, 'marsh'))!;
    const wc = centerOf(woods);
    const mc = centerOf(marsh);
    const exitZ = f.exits.ally.z;
    return [
        {
            id: 'border.field',
            label: '国境の原',
            text: `国境の原（架空の局地戦）：東西 ${f.width} m・南北 ${f.depth} m ほどの原。${road ? `${road.center ? '真ん中' : '原'}を南北に道が通る。` : ''}味方の退き口は${exitZ > 0 ? '南' : '北'}の端。`,
            short: road ? `${road.center ? '真ん中' : '原'}を南北に道` : `東西 ${f.width} m・南北 ${f.depth} m の原`,
            mapName: '退き口',
        },
        {
            id: 'border.hill',
            label: `${dirOf(f, hc.x, hc.z)}の丘`,
            text: `${dirOf(f, hc.x, hc.z)}に丘（差し渡し ${Math.round((hill.circle?.r ?? 0) * 2)} m・高さ ${hill.height ?? 0} m）。上に立つ側が有利で、下から当たると不利。`,
            short: `${dirOf(f, hc.x, hc.z)}に丘（高さ ${hill.height ?? 0} m）`,
            mapName: '丘',
        },
        {
            id: 'border.flanks',
            label: `${dirOf(f, wc.x, 0)}の林・${dirOf(f, mc.x, 0)}の湿地`,
            text: `${dirOf(f, wc.x, 0)}の端は林（中は外から見通せない）。${dirOf(f, mc.x, 0)}の端は湿地（足がとても遅い）。`,
            short: `${dirOf(f, wc.x, 0)}に林・${dirOf(f, mc.x, 0)}に湿地`,
            mapName: '林と湿地',
        },
    ];
}

function rearMarks(): MarkDef[] {
    const f = CH2_FIELDS.oda;
    const road = mainRoad(f);
    const cliffs = ofKind(f, 'cliff')
        .map(rectOf)
        .filter((r): r is Rect => !!r)
        .sort((a, b) => a.x0 - b.x0);
    const left = cliffs[0]!;
    const right = cliffs[cliffs.length - 1]!;
    const gap = right.x0 - left.x1;
    const cliffZ = (left.z0 + left.z1) / 2;
    const narrow = f.specialRules?.find((r) => r.type === 'narrow_frontage');
    const maxEngaged = narrow && narrow.type === 'narrow_frontage' ? narrow.maxEngaged : null;
    const marshSouth = ofKind(f, 'marsh').some((t) => (rectOf(t)?.z0 ?? -Infinity) >= left.z1);
    const hill = largest(ofKind(f, 'hill'))!;
    const hc = centerOf(hill);
    // 大きな林だけ（小さな林は書かない：地形の大きな形だけを記録する）
    const bigWoods = ofKind(f, 'woods').filter((t) => areaOf(t) >= 10000);
    const sides = new Set(bigWoods.map((t) => dirOf(f, centerOf(t).x, 0)));
    const woodsSides = sides.has('西') && sides.has('東') ? '東西' : [...sides].join('・');
    const exit = f.exits.ally;
    return [
        {
            id: 'rear.field',
            label: CH2_MAP_NAMES.oda,
            text: `${CH2_MAP_NAMES.oda}：南北 ${f.depth} m の長い原。${road ? `${road.center ? '真ん中' : '原'}を南北に道が通る。` : ''}退き口は${exit.z > 0 ? '南' : '北'}の端。`,
            short: `南北に長い原・退き口は${exit.z > 0 ? '南' : '北'}の端`,
            // 任務の場所の名前（織田勢の退き口）と重ならない言葉（退き口のある端）
            mapName: `${exit.z > 0 ? '南' : '北'}の端`,
        },
        {
            id: 'rear.neck',
            label: '崖の切れ目',
            text:
                `原の${cliffZ > 0 ? '南' : '北'}を東西に崖が塞ぎ、通れるのは切れ目（幅 ${gap} m）一つ。` +
                `${maxEngaged ? `切れ目では、同じ相手に当たれるのは ${maxEngaged} 隊まで。` : ''}${marshSouth ? '切れ目の南は、湿地に挟まれた道。' : ''}`,
            short: `崖の切れ目（幅 ${gap} m${maxEngaged ? `・${maxEngaged} 隊まで` : ''}）`,
            mapName: '切れ目',
        },
        {
            id: 'rear.hill',
            label: '北寄りの小丘',
            text: `原の${hc.z < cliffZ ? '北寄り' : '南寄り'}に小さな丘（高さ ${hill.height ?? 0} m）。${woodsSides ? `${woodsSides}の端は林で、中は外から見通せない。` : ''}`,
            short: `${hc.z < cliffZ ? '北寄り' : '南寄り'}の小丘（高さ ${hill.height ?? 0} m）${woodsSides ? `・${woodsSides}の林` : ''}`,
            mapName: '小丘',
        },
    ];
}

function reliefMarks(): MarkDef[] {
    const f = CH2_FIELDS.asai;
    const prim = f.objectives.primary;
    const meet = prim.type === 'rescue_escort' ? zoneCenterOf(prim.meetZone) : { x: 0, z: -f.depth / 3 };
    const safe = prim.type === 'rescue_escort' ? zoneCenterOf(prim.safeZone) : { x: 0, z: f.depth / 3 };
    const hills = ofKind(f, 'hill');
    // 救う相手のいる丘（合流の区域の中心に近い丘）と、もう一つの小丘
    const near = (t: TerrainArea, p: { x: number; z: number }) => Math.hypot(centerOf(t).x - p.x, centerOf(t).z - p.z);
    const hill = [...hills].sort((a, b) => near(a, meet) - near(b, meet))[0]!;
    const small = hills.find((t) => t !== hill);
    const hc = centerOf(hill);
    const woods = largest(ofKind(f, 'woods'))!;
    const marsh = largest(ofKind(f, 'marsh'));
    const wr = rectOf(woods)!;
    const wSide = dirOf(f, centerOf(woods).x, 0);
    const edgeX = wr.x1 + 15;
    // 林の東の縁（林のすぐ外）を南北に通れるか（地形のデータで確かめる）
    const edgeOpen = openBetween(f, { x: edgeX, z: Math.min(wr.z1, f.depth / 2 - 20) }, { x: edgeX, z: Math.max(wr.z0, -f.depth / 2 + 20) });
    const sc = small ? centerOf(small) : null;
    const direct = openBetween(f, safe, meet);
    return [
        {
            id: 'relief.field',
            label: CH2_MAP_NAMES.asai,
            text: `${CH2_MAP_NAMES.asai}のある原：南北 ${f.depth} m。${wSide}は広い林${marsh ? `、${dirOf(f, centerOf(marsh).x, 0)}に湿地` : ''}。連れ帰る安全地点は${dirOf(f, safe.x, safe.z)}${Math.abs(safe.z) >= f.depth * 0.3 ? 'の端' : '寄り'}。`,
            short: `${wSide}は広い林${marsh ? `・${dirOf(f, centerOf(marsh).x, 0)}に湿地` : ''}・安全地点は${dirOf(f, safe.x, safe.z)}`,
            mapName: '安全地点',
        },
        {
            id: 'relief.hill',
            label: `${dirOf(f, hc.x, hc.z)}の丘`,
            text: `${dirOf(f, hc.x, hc.z)}に丘（高さ ${hill.height ?? 0} m）。囲まれた浅井勢は、この丘の上。${direct ? `安全地点から丘までの間に、林や湿地は無い。` : ''}`,
            short: `${dirOf(f, hc.x, hc.z)}の丘（高さ ${hill.height ?? 0} m）${direct ? '・南から丘まで林や湿地は無い' : ''}`,
            mapName: '丘の上',
        },
        {
            id: 'relief.west',
            label: `${wSide}の林の縁`,
            text: `${wSide}の林の東の縁は${edgeOpen ? '開けていて、南北に通れる' : '林が迫っている'}。${sc && small ? `縁の近くに小丘（高さ ${small.height ?? 0} m）。` : ''}`,
            short: `${wSide}の林の縁${edgeOpen ? 'は開けている' : ''}${small ? `・小丘（高さ ${small.height ?? 0} m）` : ''}`,
            mapName: '林の縁',
        },
    ];
}

function villageMarks(): MarkDef[] {
    const f = CH2_FIELDS.home;
    const houses = ofKind(f, 'building');
    const hr = houses.map(rectOf).filter((r): r is Rect => !!r);
    const wallToWall = Math.min(...hr.map((r) => r.x0)) <= -f.width / 2 && Math.max(...hr.map((r) => r.x1)) >= f.width / 2;
    const roads = ofKind(f, 'road')
        .map(rectOf)
        .filter((r): r is Rect => !!r);
    const fromNorth = roads.filter((r) => r.z0 <= -f.depth / 2 + 1);
    // 庄屋の屋敷：いちばん高い建物
    const estate = [...houses].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]!;
    const er = rectOf(estate)!;
    const midRoad = roads.find((r) => r.x0 < (er.x0 + er.x1) / 2 && r.x1 > (er.x0 + er.x1) / 2 && r.z1 <= er.z0 + 10);
    // 屋敷の両脇の抜け道（同じ列で、屋敷にいちばん近い家との間）
    const sameRow = hr.filter((r) => r !== er && r.z0 < er.z1 && r.z1 > er.z0);
    const westGap = Math.min(...sameRow.filter((r) => r.x1 <= er.x0).map((r) => er.x0 - r.x1));
    const eastGap = Math.min(...sameRow.filter((r) => r.x0 >= er.x1).map((r) => r.x0 - er.x1));
    const gap = Math.min(westGap, eastGap);
    const prim = f.objectives.primary;
    const key = prim.type === 'defend_time' && prim.zone ? zoneCenterOf(prim.zone) : { x: 0, z: 40 };
    const store = f.objectives.secondary.find((d) => d.type === 'defend_zones');
    const storeAt = store && store.type === 'defend_zones' && store.zones[0] ? zoneCenterOf(store.zones[0]) : null;
    const storeName = store && store.type === 'defend_zones' ? (store.names?.[0] ?? '米蔵').replace(/の前$/, '') : '米蔵';
    // 柵の場所の呼び方（通りの上なら「〜の通り」、屋敷の脇なら「屋敷の〜の抜け道」）
    const fences = ofKind(f, 'fence').map((t) => {
        const r = rectOf(t)!;
        const c = centerOf(t);
        const onRoad = roads.find((x) => x.x0 < c.x && x.x1 > c.x && x.z0 < c.z && x.z1 > c.z);
        if (onRoad) return `${dirOf(f, c.x, 0)}の通り`;
        if (r.x1 <= er.x0 + 1 && r.x1 >= er.x0 - 1) return '屋敷の西の抜け道';
        if (r.x0 >= er.x1 - 1 && r.x0 <= er.x1 + 1) return '屋敷の東の抜け道';
        return `${dirOf(f, c.x, c.z)}`;
    });
    return [
        {
            id: 'village.field',
            label: CH2_MAP_NAMES.home,
            text: `${CH2_MAP_NAMES.home}：${wallToWall ? '家並みが東西の端まで続き、村の外を回る道は無い。' : ''}北から南へ通りが ${fromNorth.length} 本。家は通れず、矢も通さない。`,
            short: `北から南へ通りが ${fromNorth.length} 本${wallToWall ? '・村の外を回る道は無い' : ''}`,
            mapName: '村の通り',
        },
        {
            id: 'village.square',
            label: '庄屋の屋敷',
            text: `${midRoad ? '真ん中の通りは、庄屋の屋敷に突き当たる。' : ''}屋敷の両脇に細い抜け道（幅 ${gap} m）。屋敷の${key.z > er.z1 ? '南' : '北'}の広場の真ん中が屋敷前。`,
            short: `庄屋の屋敷・両脇の抜け道（幅 ${gap} m）`,
            mapName: '屋敷前',
        },
        {
            id: 'village.fence',
            label: `柵と${storeName}`,
            text: `柵が ${fences.length} か所（通れないが、矢は通る）：${fences.join('・')}。${storeAt ? `村の${dirOf(f, storeAt.x, 0)}の端に${storeName}。` : ''}`,
            short: `柵 ${fences.length} か所${storeAt ? `・${dirOf(f, storeAt.x, 0)}の端に${storeName}` : ''}`,
            mapName: `柵と${storeName}`,
        },
    ];
}

const MARKS: Readonly<Record<ScoutMission, () => MarkDef[]>> = { border: borderMarks, rear: rearMarks, relief: reliefMarks, village: villageMarks };
const cache = new Map<ScoutMission, MarkDef[]>();
function marksOf(m: ScoutMission): MarkDef[] {
    let v = cache.get(m);
    if (!v) {
        v = MARKS[m]();
        cache.set(m, v);
    }
    return v;
}

/** 方角の印の向きのずらし（戦場の方角・要所 1・要所 2。物見の眺めで印が重ならないように 26° ほど離す） */
const MARK_OFFSETS = [0, -0.45, 0.45] as const;

// ================================================================ 物見の地点・記録

/** 物見の地点（物見できる段階だけ。できなければ空） */
export function ieyasuScoutPoints(s: IeyasuAnyState): ScoutPoint[] {
    if (!canScout(s)) return [];
    const m = scoutMissionOf(s);
    const h = mapHeading('home', siteOf(m));
    return [{ id: LOOKOUT_ID, marks: marksOf(m).map((d, i) => ({ id: d.id, heading: wrapAngle(h + MARK_OFFSETS[i]!), label: d.label })) }];
}

/**
 * 物見で調べた印を記録した状態（純粋。受け取った状態は変えない）。
 * 物見できない段階・違う地点・今の任務の印でない物は記録しない。同じ印をもう一度入れても増えない（並びは方角の印の並び）。
 * 新しく記録する物が無ければ、受け取った状態をそのまま返す。
 */
export function ieyasuScout<S extends IeyasuAnyState>(s: S, pointId: string, marks: readonly string[]): S {
    if (!canScout(s) || pointId !== LOOKOUT_ID) return s;
    const ids = SCOUT_MARK_IDS[scoutMissionOf(s)];
    const have = new Set(s.scout ?? []);
    const add = marks.filter((m) => ids.includes(m) && !have.has(m));
    if (add.length === 0) return s;
    for (const m of add) have.add(m);
    const next = ids.filter((id) => have.has(id));
    const c = (isChapter2(s) ? cloneIeyasu2State(s) : cloneIeyasuState(s)) as S;
    c.scout = next;
    return c;
}

/** 記録した印（今の任務の印だけ。並びは方角の印の並び） */
export function scoutedMarks(s: IeyasuAnyState): MarkDef[] {
    const have = new Set(s.scout ?? []);
    return marksOf(scoutMissionOf(s)).filter((d) => have.has(d.id));
}

/** 地図の上の位置（任務の場所のまわりの決まった所。geo.ts の SCOUT_SLOTS。向きは模式） */
function placeOnMap(m: ScoutMission, i: number): { x: number; y: number } {
    const c = MAP_POS[siteOf(m)];
    const d = SCOUT_SLOTS[siteOf(m)][i] ?? { x: 0, y: 0 };
    const clamp = (v: number) => Math.max(2, Math.min(98, v));
    return { x: clamp(c.x + d.x), y: clamp(c.y + d.y) };
}

/** 情勢の画面の「物見で記録したこと」（地図に足す場所も。場所は印ごとに 1 つ、短い名前で） */
export function scoutEntries(s: IeyasuAnyState): ScoutEntry[] {
    const m = scoutMissionOf(s);
    const order = SCOUT_MARK_IDS[m];
    return scoutedMarks(s).map((d) => {
        const places: MapPlace[] = [{ id: d.id, name: d.mapName, ...placeOnMap(m, order.indexOf(d.id)), kind: 'site', side: 'neutral' }];
        return { id: d.id, label: d.label, text: d.text, places };
    });
}

/** まだ物見をしていない所があるときの案内（任意であること） */
export function scoutHint(s: IeyasuAnyState): string | undefined {
    if (!canScout(s)) return undefined;
    const m = scoutMissionOf(s);
    const left = SCOUT_MARK_IDS[m].length - scoutedMarks(s).length;
    if (left <= 0) return undefined;
    return `物見櫓（街道口の西）で物見をすると、${scoutMissionName(m)}の地形を地図に書き込める（任意。しなくても軍議・出陣はできる。まだ ${left} か所）。`;
}

/** 合戦の前の説明に足す 1 行（記録が無ければ null）。地形だけで、敵の配置は分からないと添える */
export function scoutBriefingLine(s: IeyasuAnyState): string | null {
    const marks = scoutedMarks(s);
    if (marks.length === 0) return null;
    return `物見で確かめた：${marks.map((d) => d.short).join('。')}（地形だけ。敵の配置は物見では分からない）。`;
}

/** 選択肢ごとに、関わりの深い印の並び（軍議の選択肢の「物見」の 1 行に使う） */
const OPTION_MARKS: Readonly<Record<string, readonly string[]>> = {
    // 第一章：織田援軍は右前（東寄り）・浅井長政隊は左前（西の林寄り）・守備隊は左前の砦
    policy_oda: ['border.hill', 'border.flanks', 'border.field'],
    policy_asai: ['border.flanks', 'border.hill', 'border.field'],
    policy_home: ['border.flanks', 'border.field', 'border.hill'],
};
/** 第二章の判断ごと（判断 1 commit・判断 2 hold） */
const PLAN_MARKS: Readonly<Record<ScoutMission, Readonly<Record<'commit' | 'hold', readonly string[]>>>> = {
    border: { commit: [], hold: [] },
    rear: { commit: ['rear.hill', 'rear.neck', 'rear.field'], hold: ['rear.neck', 'rear.field', 'rear.hill'] },
    relief: { commit: ['relief.hill', 'relief.field', 'relief.west'], hold: ['relief.west', 'relief.hill', 'relief.field'] },
    village: { commit: ['village.square', 'village.fence', 'village.field'], hold: ['village.square', 'village.fence', 'village.field'] },
};

/**
 * 軍議の選択肢の説明に足す「物見：…」の 1 行（その選択肢に関わる記録の短い文を 2 つまで。記録が無ければ null）。
 * choice：policy_*（第一章）・plan_commit／plan_hold（第二章）。
 */
export function scoutCouncilLine(s: IeyasuAnyState, choice: string): string | null {
    const marks = scoutedMarks(s);
    if (marks.length === 0) return null;
    const m = scoutMissionOf(s);
    const order = choice === 'plan_commit' ? PLAN_MARKS[m].commit : choice === 'plan_hold' ? PLAN_MARKS[m].hold : (OPTION_MARKS[choice] ?? []);
    const pick = order.map((id) => marks.find((d) => d.id === id)).filter((d): d is MarkDef => !!d);
    const use = (pick.length ? pick : marks).slice(0, 2);
    return `物見：${use.map((d) => d.short).join('。')}。`;
}
