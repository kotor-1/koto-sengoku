/**
 * 小さな城下町の配置（純粋なデータ。three も DOM も使わない）。設計：docs/story-rpg-design.md §5、記録：docs/story-rpg-town.md。
 * 座標は探索の座標（x 東、y 上、z 南。北の城門は z −12）。
 *
 * - 今の町家 3 棟・城門・塀・木・地面・人物の置き場所・開始の位置・道の真ん中（x −1.5〜2.5、z −12〜3）・城門への道すじは動かさない・塞がない。
 * - 足す物：町家の写し 1 棟（町家 D を道の東の南へ。今の素材を複製して置くだけ）・街道口の木戸と柵・物見櫓・荷置き場（荷車・俵・籠）・
 *   東の囲いの詰所（小屋・槍立て・筵・床几・桶）・城内の東の軍議所（陣幕・床几・机・のぼり）。
 * - 小物は箱・円柱・円すいの組み合わせ（新しい素材は読み込まない）。描く側（town/view.ts）が材質ごと・場所ごとに 1 つの形へまとめる。
 * - 当たり判定・カメラ除けは layout.ts の colliders()・cameraBlockers() がここから足す（歩き・カメラ・確かめの 4 か所のキャッシュに入る）。
 */
import machiyaD from '../../blender/machiya/machiya_d.meta.json';
import type { Box, Rect } from '../layout';
import { COUNCIL_HALL, HIGHWAY_MOUTH } from './spots';

/** 材質（描く側が 1 つずつ作る。同じ材質はまとめて 1 回で描く） */
export type TownMat = 'wood' | 'plank' | 'straw' | 'mat' | 'basket' | 'cloth' | 'metal' | 'paper' | 'roof' | 'dark';

/**
 * 小物の部品（小物の中の座標。y は地面から）。
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

/**
 * 町のまとまり（描く側はまとまりごとに形をまとめる：画面の外・塀の陰で見えないまとまりは描かない。town/view.ts の updateTownView）。
 * south：木戸と東の柵・物見櫓・荷置き場、fence_w：木戸の西の長い柵、fence_e：町家の写しの東の柵、shop_e：町家の写しのまわり、
 * guardpost：詰所（東の囲いの小屋・桶）、rest：詰所の前の休み場（通りの東、土塀の手前。筵・床几・槍立て）、council：軍議所、
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

/** 町家の写し（素材の頂点はゲームの座標のまま。z = c の面で鏡に写す：z' = 2c − z。向き（表）は元のまま） */
export interface MachiyaCopy {
    source: 'machiya_d';
    mirrorZ: number;
}

// ================================================================ 小さな計算

const rectOf = (x0: number, x1: number, z0: number, z1: number): Rect => ({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
const boxOf = (r: Rect, y0: number, y1: number): Box => ({ ...r, y0, y1 });
const B = (mat: TownMat, w: number, h: number, d: number, x: number, y: number, z: number, rot?: readonly [number, number, number]): Piece => ({ shape: 'box', mat, size: [w, h, d], pos: [x, y, z], ...(rot ? { rot } : {}) });
const C = (mat: TownMat, rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, rot?: readonly [number, number, number], open?: boolean): Piece => ({
    shape: 'cyl',
    mat,
    size: [rt, rb, h, seg],
    pos: [x, y, z],
    ...(rot ? { rot } : {}),
    ...(open ? { open } : {}),
});

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
    const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
    return {
        x0: r6(Math.min(...pts.map((q) => q.x))),
        x1: r6(Math.max(...pts.map((q) => q.x))),
        z0: r6(Math.min(...pts.map((q) => q.z))),
        z1: r6(Math.max(...pts.map((q) => q.z))),
    };
}

// ================================================================ 小物の作り方（小物の中の座標）

/** 柵（長さ len を小物の +x へ。杭と横木 2 本）。当たり判定は細い帯、カメラ除けは杭の高さまで */
function fence(name: string, cluster: TownCluster, x: number, z: number, rotY: number, len: number): TownProp {
    const pieces: Piece[] = [];
    const n = Math.max(1, Math.round(len / 1.8));
    for (let i = 0; i <= n; i++) pieces.push(B('wood', 0.12, 1.3, 0.12, (len * i) / n, 0.65, 0));
    for (const y of [0.45, 1.05]) pieces.push(B('wood', len, 0.07, 0.06, len / 2, y, 0));
    const r = rectOf(-0.08, len + 0.08, -0.12, 0.12);
    return { name, cluster, x, z, rotY, pieces, colliders: [r], blockers: [boxOf(rectOf(-0.08, len + 0.08, -0.1, 0.1), 0, 1.35)] };
}

/** 街道口の木戸（道をまたぐ 2 本の柱・冠木・小さな板屋根・外へ開いた 2 枚の扉）。小物の原点は道の真ん中 */
function kido(z: number): TownProp {
    const P = KIDO.postX;
    const pieces: Piece[] = [];
    for (const s of [-1, 1]) {
        pieces.push(B('wood', 0.3, 3.4, 0.3, s * P, 1.7, 0));
        // 外（南）へ開いた扉（柵に沿わず、道の端へ斜めに）
        pieces.push(B('plank', 0.07, 2.6, 2.4, s * (P + 0.12), 1.4, 1.35, [0, s * 0.12, 0]));
        for (const y of [0.5, 1.4, 2.3]) pieces.push(B('wood', 0.1, 0.1, 2.4, s * (P + 0.06), y, 1.35, [0, s * 0.12, 0]));
    }
    pieces.push(B('wood', 2 * P + 0.7, 0.28, 0.3, 0, 3.12, 0));
    // 板屋根（切妻を 2 枚の板で）
    for (const s of [-1, 1]) pieces.push(B('roof', 2 * P + 1.4, 0.08, 0.85, 0, 3.62, s * 0.36, [s * 0.38, 0, 0]));
    pieces.push(B('wood', 2 * P + 1.4, 0.12, 0.12, 0, 3.78, 0));
    const colliders: Rect[] = [];
    const blockers: Box[] = [];
    for (const s of [-1, 1]) {
        const post = rectOf(s * P - 0.2, s * P + 0.2, -0.2, 0.2);
        colliders.push(post);
        blockers.push(boxOf(post, 0, 3.3));
        const door = rectOf(s * (P + 0.02), s * (P + 0.45), 0.1, 2.6);
        colliders.push(door);
        blockers.push(boxOf(door, 0, 2.75));
    }
    blockers.push(boxOf(rectOf(-P - 0.75, P + 0.75, -0.75, 0.75), 2.95, 3.95));
    return { name: 'kido', cluster: 'south', x: HIGHWAY_MOUTH.x, z, rotY: 0, pieces, colliders, blockers };
}

/** 物見櫓（4 本の脚・筋交い・床・手すり・屋根・北の梯子）。原点は櫓の真ん中の地面 */
function lookoutTower(x: number, z: number): TownProp[] {
    const L = TOWER.half;
    const H = TOWER.floorY;
    const pieces: Piece[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) pieces.push(B('wood', 0.22, H, 0.22, sx * L, H / 2, sz * L));
    // 横の繋ぎと筋交い（各面）
    for (const y of [0.5, 3.1]) {
        for (const s of [-1, 1]) {
            pieces.push(B('wood', 2 * L, 0.12, 0.1, 0, y, s * L));
            pieces.push(B('wood', 0.1, 0.12, 2 * L, s * L, y, 0));
        }
    }
    const diag = Math.hypot(2 * L, 2.5);
    const ang = Math.atan2(2.5, 2 * L);
    for (const yc of [1.8, 4.4]) {
        for (const s of [-1, 1]) {
            pieces.push(B('wood', diag, 0.09, 0.08, 0, yc, s * L, [0, 0, s * ang]));
            pieces.push(B('wood', 0.08, 0.09, diag, s * L, yc, 0, [s * ang, 0, 0]));
        }
    }
    // 床と手すりの板（北の梯子の口だけ開ける）
    pieces.push(B('plank', 2 * L + 0.5, 0.16, 2 * L + 0.5, 0, H + 0.02, 0));
    const R = L + 0.22;
    pieces.push(B('plank', 2 * R, 0.8, 0.06, 0, H + 0.5, R));
    pieces.push(B('plank', 0.06, 0.8, 2 * R, -R, H + 0.5, 0));
    pieces.push(B('plank', 0.06, 0.8, 2 * R, R, H + 0.5, 0));
    pieces.push(B('plank', R - 0.45, 0.8, 0.06, -(R + 0.45) / 2, H + 0.5, -R));
    pieces.push(B('plank', R - 0.45, 0.8, 0.06, (R + 0.45) / 2, H + 0.5, -R));
    // 屋根の柱と屋根（四角すい）は別の小物（物見の眺めの間は描かない：目の前をふさがないように。town/view.ts の setTowerTopVisible）
    const top: Piece[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) top.push(B('wood', 0.1, 2.3, 0.1, sx * R, H + 1.25, sz * R));
    top.push({ shape: 'cone', mat: 'roof', size: [R * Math.SQRT2 + 0.55, 1.15, 4], pos: [0, H + 2.95, 0], rot: [0, Math.PI / 4, 0] });
    // 梯子（北の面に立てかける）
    const lad = TOWER.ladder;
    const lean = Math.atan2(lad.footOut, H);
    const lz = -(L + lad.footOut / 2 + 0.1);
    const llen = Math.hypot(H + 0.3, lad.footOut);
    for (const s of [-1, 1]) pieces.push(B('wood', 0.07, llen, 0.07, s * 0.3, (H + 0.3) / 2, lz, [-lean, 0, 0]));
    const rungs = Math.floor(H / 0.4);
    for (let i = 1; i < rungs; i++) {
        const y = i * 0.4;
        const zz = -(L + 0.1) - lad.footOut * (1 - y / H);
        pieces.push(B('wood', 0.62, 0.05, 0.05, 0, y, zz));
    }
    const base = rectOf(-L - 0.15, L + 0.15, -L - 0.15, L + 0.15);
    const ladder = rectOf(-0.42, 0.42, -(L + lad.footOut + 0.3), -L);
    return [
        {
            name: 'lookout_tower',
            cluster: 'south',
            x,
            z,
            rotY: 0,
            pieces,
            colliders: [base, ladder],
            blockers: [
                boxOf(rectOf(-L - 0.2, L + 0.2, -L - 0.2, L + 0.2), 0, H - 0.1),
                boxOf(ladder, 0, H),
                boxOf(rectOf(-R - 0.1, R + 0.1, -R - 0.1, R + 0.1), H - 0.1, H + 0.95),
            ],
        },
        { name: 'lookout_tower_top', cluster: 'towertop', x, z, rotY: 0, pieces: top, colliders: [], blockers: [boxOf(rectOf(-R - 0.6, R + 0.6, -R - 0.6, R + 0.6), H + 2.35, H + 3.55)] },
    ];
}

/** 荷車（大八車）。小物の +z が梶棒の先 */
function cart(name: string, x: number, z: number, rotY: number): TownProp {
    const pieces: Piece[] = [
        B('plank', 1.0, 0.1, 1.9, 0, 0.62, -0.1),
        B('wood', 0.06, 0.18, 1.9, -0.5, 0.75, -0.1),
        B('wood', 0.06, 0.18, 1.9, 0.5, 0.75, -0.1),
        C('wood', 0.55, 0.55, 0.1, 16, -0.62, 0.55, -0.1, [0, 0, Math.PI / 2]),
        C('wood', 0.55, 0.55, 0.1, 16, 0.62, 0.55, -0.1, [0, 0, Math.PI / 2]),
        C('dark', 0.08, 0.08, 1.4, 6, 0, 0.55, -0.1, [0, 0, Math.PI / 2]),
        B('wood', 0.07, 0.07, 1.62, -0.36, 0.35, 1.68, [0.345, 0, 0]),
        B('wood', 0.07, 0.07, 1.62, 0.36, 0.35, 1.68, [0.345, 0, 0]),
        B('wood', 0.86, 0.06, 0.06, 0, 0.1, 2.42),
        // 積み荷（俵 2 つと籠）
        C('straw', 0.3, 0.3, 0.82, 10, 0, 0.98, -0.55, [0, 0, Math.PI / 2]),
        C('straw', 0.3, 0.3, 0.82, 10, 0, 0.98, 0.1, [0, 0, Math.PI / 2]),
        C('basket', 0.26, 0.21, 0.36, 10, 0.18, 0.85, 0.62, undefined, true),
    ];
    const r = rectOf(-0.72, 0.72, -1.1, 2.5);
    return { name, cluster: 'south', x, z, rotY, pieces, colliders: [r], blockers: [boxOf(rectOf(-0.72, 0.72, -1.1, 0.95), 0, 1.3)] };
}

/** 俵の山（下 n 個・上 n−1 個。俵の軸は小物の x） */
function bales(name: string, cluster: TownCluster, x: number, z: number, rotY: number, n: number): TownProp {
    const pieces: Piece[] = [];
    const w = 0.6;
    for (let i = 0; i < n; i++) pieces.push(C('straw', 0.3, 0.3, 0.84, 10, 0, 0.3, (i - (n - 1) / 2) * w, [0, 0, Math.PI / 2]));
    for (let i = 0; i < n - 1; i++) pieces.push(C('straw', 0.3, 0.3, 0.84, 10, 0, 0.82, (i - (n - 2) / 2) * w, [0, 0, Math.PI / 2]));
    // 縄の帯（濃い色の細い輪の代わりに薄い箱）
    const half = (n * w) / 2;
    const r = rectOf(-0.5, 0.5, -half - 0.05, half + 0.05);
    return { name, cluster, x, z, rotY, pieces, colliders: [r], blockers: [boxOf(r, 0, n > 1 ? 1.15 : 0.62)] };
}

/** 籠（上の開いた筒）。いくつかまとめて */
function baskets(name: string, cluster: TownCluster, pts: readonly [number, number][]): TownProp {
    const pieces: Piece[] = [];
    const colliders: Rect[] = [];
    for (const [x, z] of pts) {
        pieces.push(C('basket', 0.3, 0.24, 0.42, 12, x, 0.21, z, undefined, true));
        pieces.push(C('dark', 0.23, 0.23, 0.03, 12, x, 0.03, z));
        colliders.push(rectOf(x - 0.3, x + 0.3, z - 0.3, z + 0.3));
    }
    return { name, cluster, x: 0, z: 0, rotY: 0, pieces, colliders, blockers: [] };
}

/** 床几（腰掛け）。いくつかまとめて。[x, z, 向き]（向きは座る人の向き。座面の長い辺は向きに直交） */
function stools(name: string, cluster: TownCluster, pts: readonly [number, number, number][]): TownProp {
    const pieces: Piece[] = [];
    const colliders: Rect[] = [];
    for (const [x, z, h] of pts) {
        const along = Math.abs(Math.sin(h)) > 0.5;
        const w = along ? 0.36 : 0.46;
        const d = along ? 0.46 : 0.36;
        pieces.push(B('cloth', w, 0.05, d, x, 0.42, z));
        for (const s of [-1, 1]) {
            if (along) pieces.push(B('wood', 0.3, 0.42, 0.05, x, 0.21, z + s * 0.19, [0, 0, 0]));
            else pieces.push(B('wood', 0.05, 0.42, 0.3, x + s * 0.19, 0.21, z));
        }
        colliders.push(rectOf(x - w / 2 - 0.02, x + w / 2 + 0.02, z - d / 2 - 0.02, z + d / 2 + 0.02));
    }
    return { name, cluster, x: 0, z: 0, rotY: 0, pieces, colliders, blockers: [] };
}

/** 詰所の小屋（板壁の箱・片流れの板屋根・西の戸口）。原点は小屋の真ん中の地面 */
function hut(x: number, z: number): TownProp {
    const W = 4.0;
    const D = 4.0;
    const pieces: Piece[] = [
        B('plank', W, 2.3, D, 0, 1.15, 0),
        // 片流れの屋根（東へ下がる）
        B('roof', W + 0.7, 0.12, D + 0.6, 0, 2.62, 0, [0, 0, -0.14]),
        // 西の戸口（暗い面）と柱
        B('dark', 0.04, 1.85, 1.05, -W / 2 - 0.02, 0.93, 0.2),
        B('wood', 0.1, 2.3, 0.1, -W / 2 - 0.03, 1.15, -0.4),
        B('wood', 0.1, 2.3, 0.1, -W / 2 - 0.03, 1.15, 0.8),
        // 腰板の帯と縦の桟（板壁に見えるように）
        B('wood', W + 0.04, 0.12, D + 0.04, 0, 0.55, 0),
        ...[-1.5, -0.5, 0.5, 1.5].flatMap((u) => [B('wood', 0.07, 2.3, D + 0.05, u, 1.15, 0), B('wood', W + 0.05, 2.3, 0.07, 0, 1.15, u)]),
        B('wood', W + 0.04, 0.1, D + 0.04, 0, 2.25, 0),
    ];
    const r = rectOf(-W / 2 - 0.1, W / 2 + 0.1, -D / 2 - 0.1, D / 2 + 0.1);
    return { name: 'guard_hut', cluster: 'guardpost', x, z, rotY: 0, pieces, colliders: [r], blockers: [boxOf(r, 0, 2.4), boxOf(rectOf(-W / 2 - 0.4, W / 2 + 0.4, -D / 2 - 0.35, D / 2 + 0.35), 2.25, 3.0)] };
}

/** 槍立て（2 本の柱と 2 本の横木に、槍を立てかける）。小物の +x が並び、槍の先は小物の −z へ傾く */
function spearRack(cluster: TownCluster, x: number, z: number, rotY: number): TownProp {
    const pieces: Piece[] = [];
    for (const s of [-1, 1]) pieces.push(B('wood', 0.1, 1.7, 0.1, s * 1.1, 0.85, 0));
    pieces.push(B('wood', 2.4, 0.08, 0.08, 0, 1.55, 0));
    pieces.push(B('wood', 2.4, 0.08, 0.08, 0, 0.45, 0.08));
    for (let i = 0; i < 6; i++) {
        const sx = -0.9 + i * 0.36;
        pieces.push(B('wood', 0.04, 3.3, 0.04, sx, 1.65, 0.12, [-0.1, 0, 0]));
        pieces.push({ shape: 'cone', mat: 'metal', size: [0.045, 0.26, 4], pos: [sx, 3.42, -0.05], rot: [-0.1, 0, 0] });
    }
    const r = rectOf(-1.25, 1.25, -0.25, 0.32);
    return { name: 'spear_rack', cluster, x, z, rotY, pieces, colliders: [r], blockers: [boxOf(r, 0, 1.7)] };
}

/** 筵（負傷兵の休む敷物。平らなので当たり判定は無し） */
function mats(cluster: TownCluster, pts: readonly [number, number][]): TownProp {
    const pieces: Piece[] = pts.map(([x, z]) => B('mat', 0.95, 0.03, 1.95, x, 0.016, z));
    return { name: 'mats', cluster, x: 0, z: 0, rotY: 0, pieces, colliders: [], blockers: [] };
}

/** 桶 */
function tub(name: string, cluster: TownCluster, x: number, z: number): TownProp {
    const pieces: Piece[] = [C('plank', 0.34, 0.3, 0.46, 12, 0, 0.23, 0), C('dark', 0.35, 0.35, 0.04, 12, 0, 0.12, 0), C('dark', 0.36, 0.36, 0.04, 12, 0, 0.38, 0)];
    const r = rectOf(-0.36, 0.36, -0.36, 0.36);
    return { name, cluster, x, z, rotY: 0, pieces, colliders: [r], blockers: [] };
}

/**
 * 軍議所の陣幕（柱と幕で囲み、西に口を開ける）・机と絵図・床几。原点は囲いの真ん中。
 * 囲いは x ±W/2、z ±D/2（小物の中）。口は西の面の z −G/2〜G/2。
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
    const tent: TownProp = { name: 'council_tent', cluster: 'council', x, z, rotY: 0, pieces, colliders, blockers };
    // 床几：北と南の 2 列（向き合う）と、奥（東）の 1 つ（西向き）
    const seats: [number, number, number][] = [];
    for (const sx of [-1.4, -0.2, 1.0]) {
        seats.push([x + sx, z - 1.5, 0]);
        seats.push([x + sx, z + 1.5, Math.PI]);
    }
    seats.push([x + 2.3, z, -Math.PI / 2]);
    return [tent, stools('council_stools', 'council', seats)];
}

// ================================================================ 置き場所の数字

/** 街道口の木戸の柱の x（道の真ん中から）。開いた口は x −2.6〜2.6 */
export const KIDO = { z: 16.4, postX: 2.9, open: 2.6 } as const;
/** 物見櫓：真ん中・床の高さ・脚の半分の幅・梯子の足の張り出し・物見の目の高さ */
export const TOWER = { x: -6.9, z: 14.9, floorY: 6.0, half: 1.2, ladder: { footOut: 0.9 }, eyeY: 7.6 } as const;
/** 軍議所の陣幕の囲い（幅 x・奥行き z・西の口の幅） */
export const TENT = { w: 6.0, d: 5.4, gate: 1.8 } as const;
/** 詰所の小屋の真ん中 */
export const HUT = { x: 16.6, z: -8.9 } as const;
/**
 * 詰所の前の休み場（Version 21）：通りの東、東の土塀と町家 D の北の端の間（詰所の囲いへの戸の前）。x 3.0〜6.9、z −1.0〜3.0。
 * 前は筵・槍立てを東の囲いの中（土塀の向こう）に置いていて、通りを歩いても見えなかった（docs/story-rpg-town.md §11）。
 * 町の入口から城門へ通りを北へ歩くと、右の前に見える。
 */
export const REST = { x0: 3.0, x1: 6.9, z0: -1.0, z1: 3.0 } as const;
/** 筵（負傷兵が横になる所）。休み場に 3 列 × 2 枚（長い辺は南北）。通りに近い列から */
export const MATS: readonly [number, number][] = [
    [3.55, 2.0], [3.55, 0.0],
    [4.65, 2.0], [4.65, 0.0],
    [5.75, 2.0], [5.75, 0.0],
];
/** 地べたに座る負傷兵（筵の 6 人の後）：休み場の北、土塀ぎわに南北に。西（通り）を向く。[x, z, 向き] */
export const GROUND_SITS: readonly [number, number, number][] = [
    [6.62, -0.8, -Math.PI / 2], [6.62, -1.6, -Math.PI / 2], [6.62, -2.4, -Math.PI / 2],
];
/**
 * 詰所の床几（座った負傷兵。筵・土塀ぎわの後の 3 人）：東の囲いの中（小屋の西）。[x, z, 向き]。
 * 通りの側には置かない（合戦の兵の形は人物の素材より粗く、歩く道のすぐ脇の床几では大きく粗く見えた）
 */
export const GUARD_STOOLS: readonly [number, number, number][] = [
    [12.4, -6.5, 0], [13.3, -6.6, 0], [14.2, -6.5, 0],
];
/** 休み場の槍立て（土塀ぎわ。並びは南北、槍の先は土塀（東）へ傾く） */
export const REST_RACK = { x: 6.62, z: 1.0, rotY: -Math.PI / 2 } as const;

/** 町家の写し：町家 D を道の東の南へ（z = 11.85 の面で鏡に写す。元の D との間に東へ抜ける路地を残す：詰所へ南東から入る） */
export const MACHIYA_COPIES: readonly MachiyaCopy[] = [{ source: 'machiya_d', mirrorZ: 11.85 }];

/** 町の小物（場所ごと） */
export const TOWN_PROPS: readonly TownProp[] = buildProps();
/** のぼり（軍議所の脇） */
export const TOWN_BANNERS: readonly TownBanner[] = [{ cluster: 'council', x: COUNCIL_HALL.x + TENT.w / 2 + 0.5, z: COUNCIL_HALL.z + 0.3 - TENT.d / 2 - 0.4, rotY: Math.PI / 2, mark: '徳', height: 4.4 }];

function buildProps(): TownProp[] {
    const out: TownProp[] = [];
    // ---- 街道口：木戸と柵（木戸の東西。東は町家の写しの裏から歩ける範囲の東の端まで）
    out.push(kido(KIDO.z));
    out.push(fence('fence_w', 'fence_w', -22, KIDO.z, 0, 22 - KIDO.postX - 0.18));
    out.push(fence('fence_e1', 'south', KIDO.postX + 0.18, KIDO.z, 0, 4.3 - KIDO.postX - 0.18));
    out.push(fence('fence_e2', 'fence_e', 9.74, KIDO.z, 0, 20 - 9.74));
    // ---- 物見櫓（街道口の西）
    out.push(...lookoutTower(TOWER.x, TOWER.z));
    // ---- 荷置き場（道の西、町家 B の南）：荷車・俵・籠
    out.push(cart('cart_w', -6.3, 10.0, Math.PI / 2));
    out.push(bales('bales_w', 'south', -9.0, 9.2, 0, 3));
    out.push(bales('bales_w2', 'south', -10.0, 11.4, Math.PI / 2, 2));
    out.push(baskets('baskets_w', 'south', [[-9.5, 12.7], [-10.15, 13.15], [-9.6, 13.5]]));
    // 町家の写しの店先（道の東、木戸の内側）
    out.push(baskets('baskets_e', 'shop_e', [[3.95, 12.95]]));
    out.push(bales('bales_e', 'shop_e', 10.6, 13.6, Math.PI / 2, 2));
    // ---- 詰所（東の囲い）：小屋・床几・桶。筵・槍立ては通りから見える休み場（詰所の前）へ（Version 21）
    out.push(hut(HUT.x, HUT.z));
    out.push(tub('guard_tub', 'guardpost', 15.1, -6.1));
    out.push(spearRack('rest', REST_RACK.x, REST_RACK.z, REST_RACK.rotY));
    out.push(mats('rest', MATS));
    out.push(stools('guard_stools', 'guardpost', GUARD_STOOLS));
    // ---- 軍議所（城内の東）：陣幕・机・床几
    out.push(...councilTent(COUNCIL_HALL.x, COUNCIL_HALL.z + 0.3));
    return out;
}

// ================================================================ 当たり判定・カメラ除け

/** 町家の写しの当たり判定・カメラ除け（素材の箱を写した位置へ） */
function copyRects(): { colliders: Rect[]; blockers: Box[] } {
    const colliders: Rect[] = [];
    const blockers: Box[] = [];
    for (const cp of MACHIYA_COPIES) {
        const meta = machiyaD as { colliders: Rect[]; camera_blockers: Box[] };
        const m = (r: Rect): Rect => ({ x0: r.x0, x1: r.x1, z0: 2 * cp.mirrorZ - r.z1, z1: 2 * cp.mirrorZ - r.z0 });
        colliders.push(...meta.colliders.map(m));
        // 写した町家の壁（素材の箱の外側の大まかな形。layout.ts が元の町家に足す houseRects と同じ考え）
        blockers.push(...meta.camera_blockers.map((b) => ({ ...m(b), y0: b.y0, y1: b.y1 })));
    }
    return { colliders, blockers };
}

/** 町の足した物の当たり判定（ゲームの座標） */
export function townColliders(): Rect[] {
    const out: Rect[] = [...copyRects().colliders];
    for (const p of TOWN_PROPS) for (const r of p.colliders) out.push(propRect(p, r));
    for (const b of TOWN_BANNERS) out.push(rectOf(b.x - 0.15, b.x + 0.15, b.z - 0.15, b.z + 0.15));
    return out;
}

/** 町の足した物のカメラ除け（ゲームの座標。y は地面から＝町の地面はほぼ 0） */
export function townBlockers(): Box[] {
    const out: Box[] = [...copyRects().blockers];
    for (const p of TOWN_PROPS) for (const b of p.blockers) out.push({ ...propRect(p, b), y0: b.y0, y1: b.y1 });
    for (const b of TOWN_BANNERS) out.push(boxOf(rectOf(b.x - 0.12, b.x + 0.12, b.z - 0.12, b.z + 0.12), 0, b.height));
    return out;
}

/** 物見の眺めの目の位置（櫓の上）。カメラはここから見回す */
export const LOOKOUT_EYE = { x: TOWER.x, y: TOWER.eyeY, z: TOWER.z } as const;
