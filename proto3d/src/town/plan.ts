/**
 * 小さな城下町の配置（純粋なデータ。three も DOM も使わない）。設計：docs/story-rpg-design.md §5、記録：docs/story-rpg-town.md。
 * 座標は探索の座標（x 東、y 上、z 南。北の城門は z −12）。
 *
 * - Version 28：置き場所の数字は proto3d/blender/street28/street28.json（通りの配置の唯一の元。Blender の建物の制作も同じ表を読む）。
 * - 通りの建物（町家 A・B・D の作り直し・土蔵造りの店・西の空き地の小屋と板塀）は Blender で作った素材（street28.json の buildings）。
 *   その当たり判定・カメラ除けは素材と一緒に書き出した meta（形の中の固い物の部品の箱）から layout.ts が読む。
 *   Version 27 までの「町家 D の鏡写し」（木戸の柵の線にまたがっていた）は、土蔵造りの店（kura28）に置き換えてやめた。
 * - 小物（木戸・柵・物見櫓・詰所の小屋・荷車・俵・籠・槍立て・筵・桶・床几）も Version 28 から Blender で形から作った素材
 *   （proto3d/public/models/props28.glb、制作は street28/build_props28.py）。ここは表の 1 行から「どの種類の形を、小物の中のどこへ・
 *   どの向きで置くか」（parts）を組む所。描く側（town/view.ts）が種類ごとの形を写して、場所（まとまり）× 材質ごとに 1 つの形へまとめる。
 *   Version 27 までの色だけの箱・円柱・円すいの小物はやめた（残るのは軍議所の陣幕の囲いと机だけ：布の縞の画像をコードで描く）。
 * - 小物の当たり判定・カメラ除けは、制作が形の中の固い物の部品から作った種類ごとの箱（street28/props28.types.json）を、
 *   置き場所・向きへ写したもの（手で別に書かない）。layout.ts の colliders()・cameraBlockers() がここから足す（歩き・カメラ・確かめの 4 か所のキャッシュに入る）。
 * - 今の城門・塀・木・地面・人物の置き場所・開始の位置・道の真ん中（x −1.5〜2.5、z −12〜3）・城門への道すじは動かさない・塞がない。
 */
import street from '../../blender/street28/street28.json';
import propTypes from '../../blender/street28/props28.types.json';
import type { Box, Rect } from '../layout';
import { HIGHWAY_MOUTH } from './spots';

/** コードで作る形の材質（軍議所の陣幕の囲いと机だけ。描く側が 1 つずつ作る） */
export type TownMat = 'wood' | 'plank' | 'cloth' | 'paper';

/**
 * コードで作る形の部品（小物の中の座標。y は地面から）。軍議所の陣幕の囲いと机だけ（布の縞の画像をコードで描く）。
 * - box：size = [幅 x, 高さ y, 奥行き z]
 * - cyl：size = [上の半径, 下の半径, 高さ, 分割]（軸は y。rot で倒す）。open は筒（上下の蓋なし）
 * - cone：size = [半径, 高さ, 分割]
 * rot は小物の中での回転（ラジアン。XYZ の順）
 */
export interface Piece {
    shape: 'box' | 'cyl' | 'cone';
    mat: TownMat;
    size: readonly number[];
    pos: readonly [number, number, number];
    rot?: readonly [number, number, number];
    open?: boolean;
}

/** Blender で作った小物の種類（props28.glb の中の prop_<種類> の形。street28/build_props28.py） */
export type PropType = 'kido' | 'fence_bay' | 'fence_post' | 'tower' | 'tower_top' | 'hut' | 'cart' | 'tawara' | 'basket' | 'tub' | 'stool' | 'spear_rack' | 'kosatsu' | 'mat';

/** 種類ごとの形の情報（制作が書き出す。小物の中の座標） */
export interface PropTypeInfo {
    /** 歩きの当たり判定（高さ 1.9 m より下の固い部品の頂点の箱） */
    walk: Rect[];
    /** カメラ除け（固い部品の頂点の箱。1.9 m の上下で分けた箱） */
    camera: Box[];
    /** 形の全体の箱 */
    bounds: Box;
    triangles: number;
    /** 影を落とすか（平らな筵は落とさない） */
    cast: boolean;
}
const TYPES = propTypes.types as unknown as Record<PropType, PropTypeInfo>;
/** 種類ごとの形の情報（制作が書き出した street28/props28.types.json） */
export const PROP_TYPES: Readonly<Record<PropType, PropTypeInfo>> = TYPES;
/** 制作の寸法（柵の 1 間・俵・筵） */
export const PROP_DIMS: { readonly fence_bay: number; readonly fence_h: number; readonly bale: { readonly L: number; readonly r: number }; readonly mat: { readonly w: number; readonly l: number; readonly t: number } } = propTypes.dims;

/**
 * 小物の中に置く 1 つの形（種類・小物の中の位置（y は小物の地面から）・向き・x の伸び縮み（柵の間だけ））。
 * 形の座標 (px, pz) → 小物の中 (x + (px·sx)·cos r + pz·sin r, z − (px·sx)·sin r + pz·cos r)（three の rotation.y と同じ回し方）
 */
export interface PropPart {
    type: PropType;
    x: number;
    y: number;
    z: number;
    rotY: number;
    sx?: number;
}

/**
 * 町のまとまり（描く側はまとまりごとに形をまとめる：画面の外・塀の陰で見えないまとまりは描かない。town/view.ts の updateTownView）。
 * south：木戸と東の柵・物見櫓・荷置き場、fence_w：木戸の西の長い柵、fence_e：土蔵造りの店の東の柵、shop_e：土蔵造りの店のまわり、
 * guardpost：詰所（東の囲いの小屋・桶・床几）、rest：詰所の前の休み場（通りの東、土塀の手前。筵・槍立て）、council：軍議所、
 * towertop：物見櫓の屋根（物見の眺めの間は描かない）
 */
export type TownCluster = 'south' | 'fence_w' | 'fence_e' | 'shop_e' | 'guardpost' | 'rest' | 'council' | 'towertop';

export interface TownProp {
    name: string;
    cluster: TownCluster;
    /** 置く位置（地面の高さは描く側が足す）と向き（y 軸の回転。three の rotation.y と同じ） */
    x: number;
    z: number;
    rotY: number;
    /** 散らばった小物（籠・筵・床几）：形ごとに、その形の所の地面の高さに置く（ほかは小物の原点の地面の高さ） */
    scatter?: boolean;
    /** Blender で作った形の置き方 */
    parts: PropPart[];
    /** コードで作る形（軍議所の陣幕の囲いと机だけ） */
    pieces: Piece[];
    /** 当たり判定・カメラ除け（小物の中の座標。y は地面から） */
    colliders: Rect[];
    blockers: Box[];
}

/** のぼり（旗の一文字の画像は描く側が作る） */
export interface TownBanner {
    cluster: TownCluster;
    x: number;
    z: number;
    /** のぼりの向き（布の面の向き。y 軸の回転） */
    rotY: number;
    mark: string;
    /** 竿の高さ（m） */
    height: number;
}

// ================================================================ 小さな計算

const rectOf = (x0: number, x1: number, z0: number, z1: number): Rect => ({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
const boxOf = (r: Rect, y0: number, y1: number): Box => ({ ...r, y0, y1 });
const B = (mat: TownMat, w: number, h: number, d: number, x: number, y: number, z: number, rot?: readonly [number, number, number]): Piece => ({ shape: 'box', mat, size: [w, h, d], pos: [x, y, z], ...(rot ? { rot } : {}) });
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** 小物の中の点 → ゲームの座標（three の rotation.y と同じ回し方） */
export function propToWorld(p: Pick<TownProp, 'x' | 'z' | 'rotY'>, lx: number, lz: number): { x: number; z: number } {
    const c = Math.cos(p.rotY);
    const s = Math.sin(p.rotY);
    return { x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c };
}

/** 小物の中の四角形 → ゲームの座標の四角形（回した四隅を囲む） */
export function propRect(p: Pick<TownProp, 'x' | 'z' | 'rotY'>, r: Rect): Rect {
    const pts = [
        propToWorld(p, r.x0, r.z0),
        propToWorld(p, r.x1, r.z0),
        propToWorld(p, r.x0, r.z1),
        propToWorld(p, r.x1, r.z1),
    ];
    return {
        x0: r6(Math.min(...pts.map((q) => q.x))),
        x1: r6(Math.max(...pts.map((q) => q.x))),
        z0: r6(Math.min(...pts.map((q) => q.z))),
        z1: r6(Math.max(...pts.map((q) => q.z))),
    };
}

// ================================================================ 形の置き方 → 当たり判定（小物の中の座標）

/** 形の中の点 → 小物の中の点 */
export function partToProp(q: Pick<PropPart, 'x' | 'z' | 'rotY' | 'sx'>, px: number, pz: number): { x: number; z: number } {
    const c = Math.cos(q.rotY);
    const s = Math.sin(q.rotY);
    const x = px * (q.sx ?? 1);
    return { x: q.x + x * c + pz * s, z: q.z - x * s + pz * c };
}

/** 形の中の四角形 → 小物の中の四角形（回した四隅を囲む） */
function partRect(q: PropPart, r: Rect): Rect {
    const pts = [partToProp(q, r.x0, r.z0), partToProp(q, r.x1, r.z0), partToProp(q, r.x0, r.z1), partToProp(q, r.x1, r.z1)];
    return {
        x0: r6(Math.min(...pts.map((v) => v.x))),
        x1: r6(Math.max(...pts.map((v) => v.x))),
        z0: r6(Math.min(...pts.map((v) => v.z))),
        z1: r6(Math.max(...pts.map((v) => v.z))),
    };
}

/** Blender で作った形を置いた小物（当たり判定・カメラ除けは、種類ごとの固い部品の箱を置き場所へ写したもの） */
function partsProp(name: string, cluster: TownCluster, x: number, z: number, rotY: number, parts: PropPart[], scatter = false): TownProp {
    const colliders: Rect[] = [];
    const blockers: Box[] = [];
    for (const q of parts) {
        const t = PROP_TYPES[q.type];
        for (const r of t.walk) colliders.push(partRect(q, r));
        for (const b of t.camera) blockers.push({ ...partRect(q, b), y0: r6(b.y0 + q.y), y1: r6(b.y1 + q.y) });
    }
    return { name, cluster, x, z, rotY, ...(scatter ? { scatter } : {}), parts, pieces: [], colliders, blockers };
}

const part = (type: PropType, x = 0, z = 0, rotY = 0, y = 0, sx?: number): PropPart => ({ type, x, y, z, rotY, ...(sx !== undefined ? { sx } : {}) });

// ================================================================ 小物の組み方（表の 1 行 → 形の置き方）

/** 柵（長さ len を小物の +x へ）：1 間（PROP_DIMS.fence_bay）ごとの形を、長さに合わせて少し伸び縮みさせて並べ、終わりに柱 */
function fence(name: string, cluster: TownCluster, x: number, z: number, rotY: number, len: number): TownProp {
    const bay = PROP_DIMS.fence_bay;
    const n = Math.max(1, Math.round(len / bay));
    const sx = len / (n * bay);
    const parts: PropPart[] = [];
    for (let i = 0; i < n; i++) parts.push(part('fence_bay', (len * i) / n, 0, 0, 0, sx));
    parts.push(part('fence_post', len, 0));
    return partsProp(name, cluster, x, z, rotY, parts);
}

/** 俵の山（下 n 個・上 n−1 個。俵の軸は小物の x）。下の俵の間は俵の直径の 1.04 倍、上の俵は下の 2 つの間の溝に載る */
function bales(name: string, cluster: TownCluster, x: number, z: number, rotY: number, n: number): TownProp {
    const r = PROP_DIMS.bale.r;
    const w = 2 * r * 1.04;
    const up = Math.sqrt((2 * r) ** 2 - (w / 2) ** 2);
    const parts: PropPart[] = [];
    // 置き方の小さなむら（同じ表なら同じ形：番号から決める）
    const jit = (i: number, k: number) => Math.sin(i * 12.9898 + k * 78.233) * 0.5;
    for (let i = 0; i < n; i++) parts.push(part('tawara', 0.04 * jit(i, 1), (i - (n - 1) / 2) * w, 0.06 * jit(i, 2)));
    for (let i = 0; i < n - 1; i++) parts.push(part('tawara', 0.05 * jit(i, 3), (i - (n - 2) / 2) * w, 0.08 * jit(i, 4), up));
    return partsProp(name, cluster, x, z, rotY, parts);
}

/**
 * 軍議所の陣幕（柱と幕で囲み、西に口を開ける）・机と絵図・床几。原点は囲いの真ん中。
 * 囲いは x ±W/2、z ±D/2（小物の中）。口は西の面の z −G/2〜G/2。陣幕・机はコードで作る形（布の縞の画像をコードで描く）、床几は Blender の形。
 */
function councilTent(x: number, z: number): TownProp[] {
    const { w: W, d: D, gate: G } = TENT;
    const hx = W / 2;
    const hz = D / 2;
    const pieces: Piece[] = [];
    const colliders: Rect[] = [];
    const blockers: Box[] = [];
    const poles: [number, number][] = [
        [-hx, -hz], [0, -hz], [hx, -hz], [hx, 0], [hx, hz], [0, hz], [-hx, hz], [-hx, G / 2], [-hx, -G / 2],
    ];
    for (const [px, pz] of poles) pieces.push(B('wood', 0.08, 2.35, 0.08, px, 1.175, pz));
    // 幕（柱の間。下は地面から少し上げる）
    const wall = (ax: number, az: number, bx: number, bz: number) => {
        const len = Math.hypot(bx - ax, bz - az);
        const alongX = Math.abs(bz - az) < 1e-6;
        pieces.push(B('cloth', alongX ? len : 0.03, 1.6, alongX ? 0.03 : len, (ax + bx) / 2, 1.3, (az + bz) / 2));
        const r = alongX ? rectOf(ax, bx, az - 0.12, az + 0.12) : rectOf(ax - 0.12, ax + 0.12, az, bz);
        colliders.push(r);
        blockers.push(boxOf(r, 0, 2.4));
    };
    wall(-hx, -hz, hx, -hz);
    wall(-hx, hz, hx, hz);
    wall(hx, -hz, hx, hz);
    wall(-hx, -hz, -hx, -G / 2);
    wall(-hx, G / 2, -hx, hz);
    // 机（板と脚）と絵図
    pieces.push(B('plank', 1.8, 0.07, 0.9, 0.2, 0.56, 0));
    for (const s of [-1, 1]) pieces.push(B('wood', 0.07, 0.52, 0.78, 0.2 + s * 0.75, 0.26, 0));
    pieces.push(B('paper', 1.45, 0.012, 0.66, 0.2, 0.6, 0));
    colliders.push(rectOf(-0.75, 1.15, -0.5, 0.5));
    const tent: TownProp = { name: 'council_tent', cluster: 'council', x, z, rotY: 0, parts: [], pieces, colliders, blockers };
    // 床几：北と南の 2 列（向き合う）と、奥（東）の 1 つ（西向き）
    const seats: [number, number, number][] = [];
    for (const sx of [-1.4, -0.2, 1.0]) {
        seats.push([x + sx, z - 1.5, 0]);
        seats.push([x + sx, z + 1.5, Math.PI]);
    }
    seats.push([x + 2.3, z, -Math.PI / 2]);
    return [tent, stools('council_stools', 'council', seats)];
}

/** 床几。いくつかまとめて。[x, z, 向き]（向きは座る人の向き。座面の長い辺は向きに直交） */
function stools(name: string, cluster: TownCluster, pts: readonly (readonly [number, number, number])[]): TownProp {
    return partsProp(name, cluster, 0, 0, 0, pts.map(([x, z, h]) => part('stool', x, z, h)), true);
}

// ================================================================ 置き場所の数字（street28.json から）

type Pt2 = [number, number];
type Pt3 = [number, number, number];

/** 街道口の木戸の柱の x（道の真ん中から）。開いた口は x −2.6〜2.6 */
export const KIDO: { readonly z: number; readonly postX: number; readonly open: number } = street.kido;
/** 物見櫓：真ん中・床の高さ・脚の半分の幅・梯子の足の張り出し・物見の目の高さ */
export const TOWER: { readonly x: number; readonly z: number; readonly floorY: number; readonly half: number; readonly ladder: { readonly footOut: number }; readonly eyeY: number } = street.tower;
/** 軍議所の陣幕の囲い（幅 x・奥行き z・西の口の幅） */
export const TENT: { readonly w: number; readonly d: number; readonly gate: number } = street.tent;
/** 詰所の小屋の真ん中 */
export const HUT: { readonly x: number; readonly z: number } = street.hut;
/**
 * 詰所の前の休み場（Version 21）：通りの東、東の土塀と町家 D の北の端の間（詰所の囲いへの戸の前）。x 3.0〜6.9、z −1.0〜3.0。
 * 前は筵・槍立てを東の囲いの中（土塀の向こう）に置いていて、通りを歩いても見えなかった（docs/story-rpg-town.md §11）。
 * 町の入口から城門へ通りを北へ歩くと、右の前に見える。
 */
export const REST: Rect = street.rest;
/** 筵（負傷兵が横になる所）。休み場に 3 列 × 2 枚（長い辺は南北）。通りに近い列から */
export const MATS: readonly Pt2[] = street.mats as Pt2[];
/** 地べたに座る負傷兵（筵の 6 人の後）：休み場の北、土塀ぎわに南北に。西（通り）を向く。[x, z, 向き]（人物の置き場所。小物ではない） */
export const GROUND_SITS: readonly [number, number, number][] = [
    [6.62, -0.8, -Math.PI / 2], [6.62, -1.6, -Math.PI / 2], [6.62, -2.4, -Math.PI / 2],
];
/**
 * 詰所の床几（座った負傷兵。筵・土塀ぎわの後の 3 人）：東の囲いの中（小屋の西）。[x, z, 向き]。
 * 通りの側には置かない（合戦の兵の形は人物の素材より粗く、歩く道のすぐ脇の床几では大きく粗く見えた）
 */
export const GUARD_STOOLS: readonly Pt3[] = street.guard_stools as Pt3[];
/** 休み場の槍立て（土塀ぎわ。並びは南北、槍の先は土塀（東）へ傾く） */
export const REST_RACK: { readonly x: number; readonly z: number; readonly rotY: number } = street.rest_rack;

/** 町の小物（場所ごと） */
export const TOWN_PROPS: readonly TownProp[] = buildProps();
/** のぼり（軍議所の脇） */
export const TOWN_BANNERS: readonly TownBanner[] = street.banners.map((b) => ({ ...b, cluster: b.cluster as TownCluster }));

/** 表の小物の 1 行（street28.json の props） */
interface PropSpec {
    id: string;
    type: string;
    cluster: string;
    x?: number;
    z?: number;
    rotY?: number;
    len?: number;
    n?: number;
    pts?: number[][];
}

/** 表の 1 行から小物を組む（type ごとに、Blender で作った形の置き方を選ぶ） */
function propsOf(p: PropSpec): TownProp[] {
    const c = p.cluster as TownCluster;
    const x = p.x ?? 0;
    const z = p.z ?? 0;
    const r = p.rotY ?? 0;
    switch (p.type) {
        case 'kido':
            return [partsProp('kido', c, HIGHWAY_MOUTH.x, KIDO.z, 0, [part('kido')])];
        case 'fence':
            return [fence(p.id, c, x, z, r, p.len ?? 1)];
        case 'lookout_tower':
            // 屋根の柱と屋根は別の小物（物見の眺めの間は描かない：目の前をふさがないように。town/view.ts の setTowerTopVisible）
            return [partsProp('lookout_tower', c, TOWER.x, TOWER.z, 0, [part('tower')]), partsProp('lookout_tower_top', 'towertop', TOWER.x, TOWER.z, 0, [part('tower_top')])];
        case 'cart':
            return [partsProp(p.id, c, x, z, r, [part('cart')])];
        case 'bales':
            return [bales(p.id, c, x, z, r, p.n ?? 2)];
        case 'baskets':
            return [partsProp(p.id, c, 0, 0, 0, ((p.pts ?? []) as Pt2[]).map(([bx, bz], i) => part('basket', bx, bz, i * 1.7)), true)];
        case 'hut':
            return [partsProp('guard_hut', c, HUT.x, HUT.z, 0, [part('hut')])];
        case 'tub':
            return [partsProp(p.id, c, x, z, r, [part('tub')])];
        case 'spear_rack':
            return [partsProp('spear_rack', c, REST_RACK.x, REST_RACK.z, REST_RACK.rotY, [part('spear_rack')])];
        case 'mats':
            // 筵（負傷兵の休む敷物。平らなので当たり判定は無し）。少しずつ向きをずらして敷く
            return [partsProp('mats', c, 0, 0, 0, MATS.map(([mx, mz], i) => part('mat', mx, mz, ((i * 37) % 7) * 0.012 - 0.036)), true)];
        case 'stools':
            return [stools(p.id, c, GUARD_STOOLS)];
        case 'council_tent':
            return councilTent(x, z);
        default:
            throw new Error(`street28.json：知らない小物の種類 ${p.type}（${p.id}）`);
    }
}

function buildProps(): TownProp[] {
    return (street.props as PropSpec[]).flatMap(propsOf);
}

// ================================================================ 当たり判定・カメラ除け

/** 町の足した物の当たり判定（ゲームの座標） */
export function townColliders(): Rect[] {
    const out: Rect[] = [];
    for (const p of TOWN_PROPS) for (const r of p.colliders) out.push(propRect(p, r));
    for (const b of TOWN_BANNERS) out.push(rectOf(b.x - 0.15, b.x + 0.15, b.z - 0.15, b.z + 0.15));
    return out;
}

/** 町の足した物のカメラ除け（ゲームの座標。y は地面から＝町の地面はほぼ 0） */
export function townBlockers(): Box[] {
    const out: Box[] = [];
    for (const p of TOWN_PROPS) for (const b of p.blockers) out.push({ ...propRect(p, b), y0: b.y0, y1: b.y1 });
    for (const b of TOWN_BANNERS) out.push(boxOf(rectOf(b.x - 0.12, b.x + 0.12, b.z - 0.12, b.z + 0.12), 0, b.height));
    return out;
}

/** 物見の眺めの目の位置（櫓の上）。カメラはここから見回す */
export const LOOKOUT_EYE = { x: TOWER.x, y: TOWER.eyeY, z: TOWER.z } as const;
