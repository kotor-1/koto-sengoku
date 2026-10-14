/**
 * 町のまわりの中景（Version 28 §3.2「近景・中景・遠景のつながり」）の置き方。純粋（three を使わない）。形は scenery.ts の makeSurroundings が作る。
 * - 歩ける範囲（layout.ts の BOUNDS）の外だけに置く。歩ける範囲は広げない（当たり判定は足さない。範囲の端は今のまま BOUNDS で止まる）。
 * - 範囲の端（東西）には竹垣を立てる：見えない壁で止まる所を、垣で止まる所に見せる。垣はカメラ除けの箱にもする（layout.ts の cameraBlockers）。
 * - 垣の向こう：隣の町並み（屋根と壁だけの軽い形を 2 列。間に裏の通り）、屋敷の木・竹やぶ。木戸の外：田畑の縁の並木と、田畑の先の村（茅葺きと板葺きの屋根、屋敷林）。
 * - どれも架空の町並み（ゲームの創作）。名前は付けない。
 * - 形はまとまり（cluster）ごとに 1 つにまとめる（描く回数を増やさない。画面の外のまとまりは描かない）。影は落とさない・受けない（町の通りからは遠い）。
 * 乱数は種つき（毎回同じ形）。
 */
import { EDGE_FENCE } from '../layout';

/** 屋根の種類（scenery.ts の画像の升目と対応） */
export type RoofKind = 'tile' | 'board' | 'thatch';
/** 壁の種類（表＝格子と漆喰、裏・横＝漆喰と柱、板壁、土壁） */
export type WallKind = 'front' | 'plaster' | 'board' | 'earth';
/** 木の種類（広葉樹・松・竹やぶ・生垣） */
export type TreeKind = 'broad' | 'pine' | 'bamboo' | 'hedge';

/** まとまり：西の町並み（北・南）、東の町並み（北・南）、西と東の奥の木立、田畑の縁の並木（西・東・南）、南の村 */
export type SurroundCluster = 'west_n' | 'west_s' | 'east_n' | 'east_s' | 'west_far' | 'east_far' | 'fields_w' | 'fields_e' | 'fields_s' | 'village';

/** 家 1 軒（上から見た四角形 x0〜x1・z0〜z1、軒の高さ、屋根の勾配（1 m あたりの上がり）、棟の向き、表の向き） */
export interface SurroundHouse {
    cluster: SurroundCluster;
    x0: number;
    x1: number;
    z0: number;
    z1: number;
    eave: number;
    pitch: number;
    /** 棟が z に沿う（true）か x に沿う（false） */
    ridgeAlongZ: boolean;
    /** 表（格子のある面）の向き */
    front: 'x+' | 'x-' | 'z+' | 'z-';
    roof: RoofKind;
    /** 表の壁 */
    wall: WallKind;
    /** 表のほかの壁（裏・横・妻） */
    back: WallKind;
    /** 色の揺らぎ（1 が基準） */
    tint: number;
}

/** 木 1 本（幹の位置、高さ、枝張りの半径、種類） */
export interface SurroundTree {
    cluster: SurroundCluster;
    x: number;
    z: number;
    h: number;
    r: number;
    kind: TreeKind;
    tint: number;
}

/** 垣の一続き（a → b の線。高さ） */
export interface SurroundFence {
    cluster: SurroundCluster;
    ax: number;
    az: number;
    bx: number;
    bz: number;
    h: number;
}

export interface SurroundPlan {
    houses: SurroundHouse[];
    trees: SurroundTree[];
    fences: SurroundFence[];
}


function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * 町並みの 1 列：z0〜z1 に間口 5〜8.5 m の家を並べる（隣とはほぼ接し、ときどき 2.5〜4 m の隙間に木）。
 * edgeX は列の通りに面する側（表）の x、dir は表から奥への向き（+1 で x が増える方が奥）。
 */
function row(out: SurroundPlan, cluster: SurroundCluster, z0: number, z1: number, edgeX: number, dir: 1 | -1, front: 'x+' | 'x-', seed: number, opts: { tallShare: number; treeX: number }): void {
    const r = rng(seed);
    let z = z0 + r() * 1.2;
    while (z < z1 - 4) {
        const w = Math.min(5 + r() * 3.5, z1 - z);
        const d = 6.2 + r() * 2.2;
        const set = r() * 0.7;
        const tall = r() < opts.tallShare;
        const ex = edgeX + dir * set;
        const roofPick = r();
        const backPick = r();
        out.houses.push({
            cluster,
            x0: Math.min(ex, ex + dir * d),
            x1: Math.max(ex, ex + dir * d),
            z0: z,
            z1: z + w,
            eave: tall ? 4.5 + r() * 0.7 : 2.9 + r() * 0.5,
            pitch: 0.4 + r() * 0.12,
            ridgeAlongZ: true,
            front,
            roof: roofPick < 0.45 ? 'tile' : 'board',
            wall: 'front',
            back: backPick < 0.6 ? 'plaster' : backPick < 0.82 ? 'board' : 'earth',
            tint: 0.88 + r() * 0.22,
        });
        z += w + 0.25 + r() * 0.4;
        // ときどき隙間（路地・裏庭）を空けて木を 1 本
        if (r() < 0.32 && z < z1 - 7) {
            const gap = 2.5 + r() * 1.5;
            out.trees.push({ cluster, x: opts.treeX + (r() - 0.5) * 1.2, z: z + gap / 2, h: 6 + r() * 3.5, r: 1.8 + r() * 1.0, kind: r() < 0.4 ? 'pine' : 'broad', tint: 0.85 + r() * 0.3 });
            z += gap;
        }
    }
}

/**
 * 木を線に沿って並べる（間隔 step ± ゆらぎ。skip の範囲（道など）は空ける）。木は 1〜3 本のまとまりにする（等間隔に 1 本ずつ並べない）。
 * 生垣（hedge）は 1 つずつ並べる
 */
function treeLine(out: SurroundPlan, cluster: SurroundCluster, ax: number, az: number, bx: number, bz: number, step: number, seed: number, kinds: TreeKind[], skip?: (x: number, z: number) => boolean): void {
    const r = rng(seed);
    const L = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / L;
    const uz = (bz - az) / L;
    const hedgeOnly = kinds.every((k) => k === 'hedge');
    for (let s0 = r() * step; s0 < L; s0 += step * (0.7 + r() * 0.6) * (hedgeOnly ? 1 : 1.4)) {
      const n = hedgeOnly ? 1 : 1 + Math.floor(r() * 2.6);
      for (let m = 0; m < n; m++) {
        const s = s0 + (m ? (r() - 0.5) * 4 : 0);
        const side = (r() - 0.5) * (m ? 4 : 2.5);
        const x = ax + ux * s - uz * side;
        const z = az + uz * s + ux * side;
        if (skip?.(x, z)) continue;
        const kind = kinds[Math.floor(r() * kinds.length)]!;
        if (kind === 'hedge') {
            out.trees.push({ cluster, x, z, h: 1.3 + r() * 0.5, r: 1.3 + r() * 0.5, kind, tint: 0.85 + r() * 0.3 });
            continue;
        }
        const big = kind === 'bamboo' ? 1 : 0.8 + r() * 0.5;
        out.trees.push({ cluster, x, z, h: (kind === 'bamboo' ? 9 + r() * 3 : 7 + r() * 5) * big, r: (kind === 'bamboo' ? 2.2 + r() * 0.8 : 2.4 + r() * 1.6) * big, kind, tint: 0.85 + r() * 0.3 });
        // 根もとの低い茂み（木の幹だけが並んで見えないように）
        if (r() < 0.55) out.trees.push({ cluster, x: x + (r() - 0.5) * 3, z: z + (r() - 0.5) * 3, h: 1.4 + r() * 0.8, r: 1.4 + r() * 0.8, kind: 'hedge', tint: 0.85 + r() * 0.3 });
      }
    }
}

/** 村（茅葺き・板葺きの家を、道の両脇に散らす。屋敷林つき） */
function village(out: SurroundPlan, seed: number): void {
    const r = rng(seed);
    const spots: [number, number][] = [
        [-9, 104], [-22, 108], [-33, 118], [11, 106], [24, 112], [-14, 122], [36, 120], [8, 126], [-44, 104], [46, 103],
    ];
    for (const [cx, cz] of spots) {
        const w = 8 + r() * 4;
        const d = 6 + r() * 2.5;
        const along = r() < 0.7;
        const thatch = r() < 0.6;
        const hw = (along ? w : d) / 2;
        const hd = (along ? d : w) / 2;
        out.houses.push({
            cluster: 'village',
            x0: cx - hw,
            x1: cx + hw,
            z0: cz - hd,
            z1: cz + hd,
            eave: thatch ? 2.5 + r() * 0.4 : 3.0 + r() * 0.5,
            pitch: thatch ? 0.95 + r() * 0.15 : 0.45 + r() * 0.1,
            ridgeAlongZ: !along,
            front: cx < 0 ? 'x+' : 'x-',
            roof: thatch ? 'thatch' : 'board',
            wall: thatch ? 'earth' : 'board',
            back: thatch ? 'earth' : 'board',
            tint: 0.85 + r() * 0.25,
        });
        // 屋敷林：家の北と西（冬の風よけ）に 2〜4 本、裏に竹やぶ
        const n = 2 + Math.floor(r() * 3);
        for (let i = 0; i < n; i++) {
            const a = Math.PI * (0.9 + r() * 0.9);
            const dist = 7 + r() * 4;
            out.trees.push({ cluster: 'village', x: cx + Math.cos(a) * dist, z: cz + Math.sin(a) * dist * 0.8 + 6, h: 8 + r() * 6, r: 2.6 + r() * 1.8, kind: r() < 0.35 ? 'pine' : 'broad', tint: 0.85 + r() * 0.3 });
        }
        if (r() < 0.6) out.trees.push({ cluster: 'village', x: cx + (r() - 0.5) * 6, z: cz + 9 + r() * 3, h: 9 + r() * 3, r: 3 + r() * 1.2, kind: 'bamboo', tint: 0.9 + r() * 0.2 });
    }
}

/** 町のまわりの中景の置き方（毎回同じ） */
export function surroundPlan(): SurroundPlan {
    const out: SurroundPlan = { houses: [], trees: [], fences: [] };
    const W = EDGE_FENCE.west;
    const E = EDGE_FENCE.east;
    // 範囲の端の竹垣（西・東）
    out.fences.push({ cluster: 'west_s', ax: W, az: EDGE_FENCE.z1, bx: W, bz: 2.4, h: EDGE_FENCE.h });
    out.fences.push({ cluster: 'west_n', ax: W, az: 2.4, bx: W, bz: EDGE_FENCE.z0, h: EDGE_FENCE.h });
    out.fences.push({ cluster: 'east_s', ax: E, az: EDGE_FENCE.z1, bx: E, bz: 2.4, h: EDGE_FENCE.h });
    out.fences.push({ cluster: 'east_n', ax: E, az: 2.4, bx: E, bz: EDGE_FENCE.z0, h: EDGE_FENCE.h });
    // 西の町並み：垣の向こうの裏庭（幅 2 m ほど）→ 1 列目（裏を町へ向ける）→ 裏の通り（3 m）→ 2 列目（表を裏の通りへ）
    const w1 = W - 2.2;
    row(out, 'west_n', -11.2, 2.4, w1, -1, 'x-', 11, { tallShare: 0.35, treeX: w1 - 3.5 });
    row(out, 'west_s', 2.4, 16.8, w1, -1, 'x-', 12, { tallShare: 0.3, treeX: w1 - 3.5 });
    const w2 = w1 - 9.4 - 3.2;
    row(out, 'west_n', -10.5, 2.4, w2, -1, 'x+', 13, { tallShare: 0.25, treeX: w2 - 9 });
    row(out, 'west_s', 2.4, 17.5, w2, -1, 'x+', 14, { tallShare: 0.25, treeX: w2 - 9 });
    // 東の町並み（同じ作り。向きが逆）
    const e1 = E + 2.2;
    row(out, 'east_n', -11.2, 2.4, e1, 1, 'x+', 21, { tallShare: 0.3, treeX: e1 + 3.5 });
    row(out, 'east_s', 2.4, 16.8, e1, 1, 'x+', 22, { tallShare: 0.35, treeX: e1 + 3.5 });
    const e2 = e1 + 9.4 + 3.2;
    row(out, 'east_n', -10.5, 2.4, e2, 1, 'x-', 23, { tallShare: 0.25, treeX: e2 + 9 });
    row(out, 'east_s', 2.4, 17.5, e2, 1, 'x-', 24, { tallShare: 0.25, treeX: e2 + 9 });
    // 町並みの奥の木立と竹やぶ（家並みの屋根の向こうに見える）
    treeLine(out, 'west_far', w2 - 13, -14, w2 - 13, 22, 6.5, 31, ['broad', 'pine', 'bamboo', 'broad', 'broad']);
    treeLine(out, 'east_far', e2 + 13, -14, e2 + 13, 22, 6.5, 32, ['broad', 'broad', 'pine', 'bamboo', 'broad']);
    // 木戸の外の田畑の縁（西・東の並木、南の端の防風の並木。道は空ける）
    treeLine(out, 'fields_w', -70, 24, -70, 92, 7, 41, ['broad', 'broad', 'pine', 'broad', 'bamboo']);
    treeLine(out, 'fields_e', 70, 24, 70, 92, 7, 42, ['broad', 'broad', 'broad', 'pine', 'bamboo']);
    treeLine(out, 'fields_s', -66, 98, 66, 98, 6.5, 43, ['broad', 'pine', 'broad', 'bamboo', 'broad'], (x) => Math.abs(x) < 6);
    // 生垣：田畑の角の家の囲い（村の手前の道の両脇）
    treeLine(out, 'fields_s', -60, 96, -8, 96, 2.6, 44, ['hedge']);
    treeLine(out, 'fields_s', 8, 96, 60, 96, 2.6, 45, ['hedge']);
    village(out, 51);
    return out;
}
