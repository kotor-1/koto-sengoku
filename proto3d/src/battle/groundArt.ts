/**
 * 合戦の地面の素材（Version 22。生成イラスト素材の草地・土・道・林床の 4 枚を、地形の決まりの形に合わせて混ぜる）。
 *
 * - 混ぜ方の「型紙」（マスク）は、合戦の決まりの地形の区域（BattleMap.terrain の四角・円・カプセル。sim.ts の inTerrain と同じ形）から作る。
 *   画素ごとに「区域の縁からの距離（中が負）」を持たせ（符号付き距離）、描くときにその距離 0 の所を境にする。
 *   だから道・林の見た目の縁は、決まりの縁と同じ所に来る（混ぜる帯は縁を中心に道 ±0.75 m・林 ±1 m）。
 * - 大きな濃淡と土のむらは、低い周波数のなめらかな雑音で作る（CPU で 2 m の画素の画像にして、描くときに読む。草地の中だけ。
 *   道・林・ほかの地形の縁の近くには出さない。土のむらは薄い（混ぜる割合は DIRT_MAX まで）、縁のぼやけた不ぞろいの斑で、くっきりした楕円・
 *   筋（道・川に見える細長い形）にしない：tests/proto3d-battle-art.test.ts で形と縁のなだらかさを確かめる）。
 *   画像に描かれた物を道・川・障害物として見せることはしない。
 * - 型紙と雑音の画像は、戦場の形ごとに 1 度だけ作って覚えておく（buildGroundData。少しずつ区切って作り、画面を止めない。演習のやり直し・
 *   次の合戦ではすぐ使える）。
 * - 素材 1 枚の大きさは記録の meta.tileMeters（無ければ 8 m）。同じ模様が並んで見えないように、ずらした 2 か所を雑音で混ぜる
 *   （低い画質 ?q=low では草地も 1 回だけ読み、斜めの細かさ anisotropy は 1）。
 * - 戦場の外は今までと同じ式で、表示の背景の色（昼・夜）へ薄め、通れる範囲の外は暗くする。湿地・川などほかの地形は今までの頂点の色のまま。
 * - 合戦の状態は読まない（地形の形だけ）。画像は art/registry.ts の loadArtBitmap だけで読む。
 * - 開始のボタン（BriefingGate）：木（Version 21 と同じ。12 秒で打ち切り）に加えて、地面の素材は木が済んでから ART_WAIT_MS だけ待つ。
 *   素材の無い戦場・旧表示・一覧に無いときは待たない（Version 21 と同じ）。待ちの後・合戦が始まった後に届いた素材は使わずに捨てる
 *   （合戦の途中で地面を差し替えない。読んだ画像と型紙は覚えているので、次の合戦で使う）。
 */
import * as THREE from 'three';
import type { BattleMap, TerrainArea, TerrainKind } from './types';
import { capsuleDist } from './fieldRules';
import { FIELD_ART } from '../art/ids';
import { artAvailable, artEntry, artMode, artReady, loadArtBitmap } from '../art/registry';

/** 型紙の距離の幅（m）。これより遠い所は同じ値（8 bit で 1 段 = 0.125 m） */
export const MASK_RANGE_M = 16;
/** 混ぜる帯の幅（m。決まりの縁を中心に半分ずつ） */
export const ROAD_BAND_M = 1.5;
export const WOODS_BAND_M = 2.0;
/** 型紙が覆う、戦場の外の余白（m。これより外は背景の色に溶けている） */
const MASK_MARGIN_M = 120;
/** 型紙の 1 辺の画素の上限（大きな戦場では 1 画素を 1 m より粗くする） */
const MASK_MAX_TEX = 1024;
/** 素材 1 枚の大きさ（m）の既定 */
export const DEFAULT_TILE_M = 8;

/** 型紙の色の組（R＝道・G＝林・B＝ほかの地面の色を変える地形） */
export type MaskChannel = 0 | 1 | 2;
const OTHER_KINDS: readonly TerrainKind[] = ['cliff', 'dry', 'ford', 'paddy', 'river', 'marsh'];

export interface TerrainMask {
    /** RGBA の並び（行は z の小さい方から） */
    data: Uint8Array;
    w: number;
    h: number;
    /** 型紙の左上（x・z が小さい方の角）の世界の位置と、1 画素の大きさ（m） */
    x0: number;
    z0: number;
    cell: number;
}

/** 区域の縁からの符号付き距離（m。中が負・縁が 0）。形の判定は fieldRules.ts の inZone と同じ（縁は中） */
export function areaSignedDist(a: TerrainArea, x: number, z: number): number {
    if (a.rect) {
        const cx = (a.rect.x0 + a.rect.x1) / 2;
        const cz = (a.rect.z0 + a.rect.z1) / 2;
        const dx = Math.abs(x - cx) - (a.rect.x1 - a.rect.x0) / 2;
        const dz = Math.abs(z - cz) - (a.rect.z1 - a.rect.z0) / 2;
        return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
    }
    if (a.circle) return Math.hypot(x - a.circle.cx, z - a.circle.cz) - a.circle.r;
    if (a.capsule) return capsuleDist(a.capsule, x, z) - a.capsule.r;
    return Number.POSITIVE_INFINITY;
}

/**
 * 型紙に描く区域（決まりの区域そのもの）。戦場の端に触れる道だけは、戦場の外へ伸ばす（今までの道の帯と同じ。戦場の中の形は変わらない）
 */
function maskAreas(map: BattleMap): { ch: MaskChannel; a: TerrainArea }[] {
    const hw = map.width / 2;
    const hd = map.depth / 2;
    const out: { ch: MaskChannel; a: TerrainArea }[] = [];
    for (const a of map.terrain) {
        if (a.kind === 'road') {
            if (a.rect) {
                const r = { ...a.rect };
                const alongZ = r.z1 - r.z0 >= r.x1 - r.x0;
                if (alongZ) {
                    if (r.z0 <= -hd + 1) r.z0 = -1e4;
                    if (r.z1 >= hd - 1) r.z1 = 1e4;
                } else {
                    if (r.x0 <= -hw + 1) r.x0 = -1e4;
                    if (r.x1 >= hw - 1) r.x1 = 1e4;
                }
                out.push({ ch: 0, a: { kind: 'road', rect: r } });
            } else out.push({ ch: 0, a });
        } else if (a.kind === 'woods') out.push({ ch: 1, a });
        else if (OTHER_KINDS.includes(a.kind)) out.push({ ch: 2, a });
    }
    return out;
}

function encodeSd(sd: number): number {
    const k = Math.max(-1, Math.min(1, sd / MASK_RANGE_M));
    return Math.round(k * 127.5 + 127.5);
}

function decodeSd(v: number): number {
    return ((v - 127.5) / 127.5) * MASK_RANGE_M;
}

/** 同じ種類の区域が重なる・接する所の内側の深さを探す範囲（m）と、探す向きの数・刻み */
const SEAM_SEARCH_M = 2.5;
const SEAM_DIRS = 32;
const SEAM_STEP_M = 0.0625;

/**
 * 同じ種類の区域が 2 つ以上近くにある所の内側の距離（m。負）。区域ごとの距離の最小は、区域の継ぎ目（2 つの四角が接する所など）で
 * 「縁のすぐ内側」と誤る（継ぎ目に混ぜる帯の筋が出る）ので、どの区域にも入らない点を周りに探して、本当の縁までの距離にする。
 * SEAM_SEARCH_M より内側は -SEAM_SEARCH_M（混ぜる帯の外なので見た目は同じ）
 */
function seamDepth(list: TerrainArea[], x: number, z: number): number {
    const inside = (px: number, pz: number) => list.some((a) => areaSignedDist(a, px, pz) <= 0);
    let best = SEAM_SEARCH_M;
    for (let k = 0; k < SEAM_DIRS; k++) {
        const ang = (k / SEAM_DIRS) * Math.PI * 2;
        const dx = Math.cos(ang);
        const dz = Math.sin(ang);
        for (let r = SEAM_STEP_M; r < best; r += SEAM_STEP_M) {
            if (!inside(x + dx * r, z + dz * r)) {
                best = r;
                break;
            }
        }
    }
    return -best;
}

/** 行ごとに作る画像（型紙・雑音）。rows 行を row(j) で 1 行ずつ埋める */
interface RowJob {
    out: TerrainMask;
    row: (j: number) => void;
}

/** 型紙を作る仕事（決まりの地形の形から。同じ戦場ならいつも同じ） */
function terrainMaskJob(map: BattleMap): RowJob {
    const spanX = map.width + MASK_MARGIN_M * 2;
    const spanZ = map.depth + MASK_MARGIN_M * 2;
    const cell = Math.max(1, Math.max(spanX, spanZ) / MASK_MAX_TEX);
    const w = Math.ceil(spanX / cell);
    const h = Math.ceil(spanZ / cell);
    const x0 = -(w * cell) / 2;
    const z0 = -(h * cell) / 2;
    const data = new Uint8Array(w * h * 4);
    const areas = maskAreas(map);
    const byCh: TerrainArea[][] = [[], [], []];
    for (const { ch, a } of areas) byCh[ch].push(a);
    const sd = [0, 0, 0];
    const near = [0, 0, 0];
    const row = (j: number) => {
        const z = z0 + (j + 0.5) * cell;
        for (let i = 0; i < w; i++) {
            const x = x0 + (i + 0.5) * cell;
            sd[0] = sd[1] = sd[2] = MASK_RANGE_M;
            near[0] = near[1] = near[2] = 0;
            for (const { ch, a } of areas) {
                const d = areaSignedDist(a, x, z);
                if (d < sd[ch]) sd[ch] = d;
                if (d < SEAM_SEARCH_M) near[ch]++;
            }
            // 区域の外の距離は最小で正しい。内側で同じ種類の区域が 2 つ以上近い所（継ぎ目）だけ、本当の縁までの距離を探す
            for (let c = 0; c < 3; c++) if (near[c] >= 2 && sd[c] <= 0 && sd[c] > -SEAM_SEARCH_M) sd[c] = seamDepth(byCh[c], x, z);
            const o = (j * w + i) * 4;
            data[o] = encodeSd(sd[0]);
            data[o + 1] = encodeSd(sd[1]);
            data[o + 2] = encodeSd(sd[2]);
            data[o + 3] = 255;
        }
    };
    return { out: { data, w, h, x0, z0, cell }, row };
}

function runJob(job: RowJob): TerrainMask {
    for (let j = 0; j < job.out.h; j++) job.row(j);
    return job.out;
}

/** 型紙を作る（決まりの地形の形から。同じ戦場ならいつも同じ。一度に全部作る：確かめ用。画面では buildGroundData） */
export function buildTerrainMask(map: BattleMap): TerrainMask {
    return runJob(terrainMaskJob(map));
}

/**
 * 型紙のその点の距離（m）。描く側（GPU の画素の間の直線補間・端は端の値）と同じ読み方（確かめ用）
 */
export function sampleMaskSd(m: TerrainMask, ch: MaskChannel, x: number, z: number): number {
    const u = (x - m.x0) / m.cell - 0.5;
    const v = (z - m.z0) / m.cell - 0.5;
    const i0 = Math.floor(u);
    const j0 = Math.floor(v);
    const fu = u - i0;
    const fv = v - j0;
    const at = (i: number, j: number) => {
        const ii = Math.max(0, Math.min(m.w - 1, i));
        const jj = Math.max(0, Math.min(m.h - 1, j));
        return m.data[(jj * m.w + ii) * 4 + ch];
    };
    const a = at(i0, j0) * (1 - fu) + at(i0 + 1, j0) * fu;
    const b = at(i0, j0 + 1) * (1 - fu) + at(i0 + 1, j0 + 1) * fu;
    return decodeSd(a * (1 - fv) + b * fv);
}

/** 距離から、その地形の素材の混ざり具合（0〜1。縁で 0.5。描く側の式と同じ） */
export function coverageFromSd(sd: number, band: number): number {
    const e0 = -band / 2;
    const e1 = band / 2;
    const t = Math.max(0, Math.min(1, (sd - e0) / (e1 - e0)));
    return 1 - t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------- 低い周波数の雑音（CPU で作って画像にする）

/** 整数の格子点の決まった乱数（0〜1） */
function latticeHash(ix: number, iz: number, seed: number): number {
    let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}
/** なめらかな値の雑音（0〜1。格子 1 の大きさ） */
export function valueNoise(x: number, z: number, seed: number): number {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = latticeHash(ix, iz, seed);
    const b = latticeHash(ix + 1, iz, seed);
    const c = latticeHash(ix, iz + 1, seed);
    const d = latticeHash(ix + 1, iz + 1, seed);
    return (a + (b - a) * ux) * (1 - uz) + (c + (d - c) * ux) * uz;
}
/** 3 段の重ね（段ごとに向きを回す：筋にしない。0〜1） */
export function fbm3(x: number, z: number, seed: number): number {
    let s = 0.5 * valueNoise(x, z, seed);
    const px = 1.6 * x - 1.2 * z + 7.1;
    const pz = 1.2 * x + 1.6 * z + 7.1;
    s += 0.25 * valueNoise(px, pz, seed + 1);
    const qx = 1.6 * px - 1.2 * pz + 3.7;
    const qz = 1.2 * px + 1.6 * pz + 3.7;
    s += 0.125 * valueNoise(qx, qz, seed + 2);
    return s / 0.875;
}

const smooth = (e0: number, e1: number, v: number) => {
    const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};

/** 低い周波数の雑音の画像の 1 画素（m。どれも 20 m より大きな形なので、2 m の画素の間の補間で足りる） */
const NOISE_CELL_M = 2;

/** 土の斑の置き方：DIRT_CELL_M 四方のますごとに、DIRT_P の割合で 1 つ。中心はますの真ん中の半分の中。真ん中の塊の半径は DIRT_R の間 */
const DIRT_CELL_M = 56;
const DIRT_P = 0.75;
const DIRT_R = [6, 8] as const;
/** 周りの小さな塊の数（真ん中の塊のまわりに、ほぼ 120° ずつずらして置く：不ぞろいだが、細長くはならない） */
const DIRT_LOBES = 3;
/** 斑の広がりの上限（m）：中心から、周りの塊の離れ（0.65 × 半径）＋塊の半径（0.95 × 半径） */
export const DIRT_EXTENT_M = DIRT_R[1] * (0.65 + 0.95);

/** 1 つの塊（縁から真ん中まで、なだらかに濃くなる。平らな所・縁の段差を作らない） */
function dirtLobe(dx: number, dz: number, r: number): number {
    const d = Math.hypot(dx, dz) / r;
    return d < 1 ? smooth(0, 1, 1 - d) : 0;
}

/**
 * 土のむら（0〜1）。ますごとに 1 つの、縁のぼやけた不ぞろいの斑（真ん中の塊と、そのまわりの大きさ・離れ方の違う 3 つの塊を重ねた形。
 * 中も 6 m ほどのむらで薄い所を混ぜる：くっきりした楕円・一色の面にしない）。斑の広がりは中心から DIRT_EXTENT_M（12.8 m）まで。
 * 隣のますの斑とは重ならない（中心の間は DIRT_CELL_M の半分 28 m 以上）ので、つながって長い筋（道・川に見える形）にはならない
 */
export function dirtSpotAt(x: number, z: number): number {
    const ci = Math.floor(x / DIRT_CELL_M);
    const cj = Math.floor(z / DIRT_CELL_M);
    let best = 0;
    for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
            const i = ci + di;
            const j = cj + dj;
            if (latticeHash(i, j, 501) >= DIRT_P) continue;
            const cx = (i + 0.25 + 0.5 * latticeHash(i, j, 502)) * DIRT_CELL_M;
            const cz = (j + 0.25 + 0.5 * latticeHash(i, j, 503)) * DIRT_CELL_M;
            // 遠い斑は飛ばす（広がりの外）
            if (Math.abs(x - cx) > DIRT_EXTENT_M || Math.abs(z - cz) > DIRT_EXTENT_M) continue;
            const r0 = DIRT_R[0] + (DIRT_R[1] - DIRT_R[0]) * latticeHash(i, j, 504);
            let v = dirtLobe(x - cx, z - cz, r0);
            const th = latticeHash(i, j, 505) * Math.PI * 2;
            for (let k = 0; k < DIRT_LOBES; k++) {
                const a = th + (k * Math.PI * 2) / DIRT_LOBES + (latticeHash(i, j, 510 + k) - 0.5) * 0.9;
                const off = r0 * (0.35 + 0.3 * latticeHash(i, j, 520 + k));
                const rk = r0 * (0.7 + 0.25 * latticeHash(i, j, 530 + k));
                v = Math.max(v, dirtLobe(x - cx - Math.cos(a) * off, z - cz - Math.sin(a) * off, rk));
            }
            best = Math.max(best, v);
        }
    }
    if (best <= 0) return 0;
    return best * (0.5 + 0.5 * valueNoise(x / 6 + 9.2, z / 6 + 4.4, 506));
}

/**
 * その点の低い周波数の雑音（どれも 0〜1）。big＝100〜200 m の明るさと乾き具合・mid＝40 m ほどの明るさのむら・
 * dirt＝土の斑（dirtSpotAt）・tile＝素材の繰り返しを崩すずらしの選び方（23 m ほど）
 */
export function groundNoiseAt(x: number, z: number): { big: number; mid: number; dirt: number; tile: number } {
    return {
        big: fbm3(x / 150 + 11, z / 150 + 11, 101),
        mid: valueNoise(x / 41 + 5, z / 41 + 5, 202),
        dirt: dirtSpotAt(x, z),
        tile: valueNoise(x / 23, z / 23, 404),
    };
}

/** 土のむらを出さない縁の幅（m）：道の縁から DIRT_ROAD_M[0] までは 0、[1] で上がりきる。林・ほかの地形（湿地の乾いた足場など）も同じ */
export const DIRT_ROAD_M = [6, 14] as const;
export const DIRT_WOODS_M = [5, 12] as const;
export const DIRT_OTHER_M = [5, 12] as const;

/**
 * 土のむらの濃さ（0〜DIRT_MAX。描く側の式と同じ）：草地の中だけ。道・林・ほかの地形の縁の近くには出さない
 * （道・林が広がって見えたり、決まりのある地形（乾いた足場など）に見えたりしないように）
 */
export function dirtWeight(dirtSpot: number, roadSd: number, woodsSd: number, otherSd: number): number {
    return dirtSpot * DIRT_MAX * smooth(DIRT_ROAD_M[0], DIRT_ROAD_M[1], roadSd) * smooth(DIRT_WOODS_M[0], DIRT_WOODS_M[1], woodsSd) * smooth(DIRT_OTHER_M[0], DIRT_OTHER_M[1], otherSd);
}
/** 土のむらの濃さの上限（素材を混ぜる割合。薄いむらにとどめ、地形の区域に見せない） */
export const DIRT_MAX = 0.35;

/** 雑音の画像を作る仕事（型紙と同じ範囲を NOISE_CELL_M の画素で。R＝big・G＝mid・B＝dirt・A＝tile） */
function groundNoiseJob(m: TerrainMask): RowJob {
    const cell = Math.max(NOISE_CELL_M, m.cell);
    const w = Math.ceil((m.w * m.cell) / cell);
    const h = Math.ceil((m.h * m.cell) / cell);
    const x0 = m.x0;
    const z0 = m.z0;
    const data = new Uint8Array(w * h * 4);
    const row = (j: number) => {
        const z = z0 + (j + 0.5) * cell;
        for (let i = 0; i < w; i++) {
            const x = x0 + (i + 0.5) * cell;
            const n = groundNoiseAt(x, z);
            const o = (j * w + i) * 4;
            data[o] = Math.round(n.big * 255);
            data[o + 1] = Math.round(n.mid * 255);
            data[o + 2] = Math.round(n.dirt * 255);
            data[o + 3] = Math.round(n.tile * 255);
        }
    };
    return { out: { data, w, h, x0, z0, cell }, row };
}

/** 雑音の画像（一度に全部作る：確かめ用。画面では buildGroundData） */
export function buildGroundNoise(m: TerrainMask): TerrainMask {
    return runJob(groundNoiseJob(m));
}

// ---------------------------------------------------------------- 型紙と雑音を、画面を止めずに作って覚えておく

/** 型紙と雑音の画像の組（戦場の形ごとに 1 つ。描く側は読むだけ） */
export interface GroundData {
    mask: TerrainMask;
    noise: TerrainMask;
}

/** 1 回の区切りで計算に使う時間の目安（ms）。これを超えたら次の処理（描画など）に譲る。譲るたびに 1 コマ待つ端末があるので、細かくしすぎない（遅い端末でも開始のボタンまでに作り終える） */
export const GROUND_SLICE_MS = 12;
/** 覚えておく戦場の形の数（大平原の演習のやり直し・次の合戦で作り直さない。古いものから捨てる） */
const GROUND_CACHE_MAX = 2;
const groundCache = new Map<string, Promise<GroundData>>();

/** 戦場の形の鍵（id だけでなく、広さと地形の区域も入れる：同じ id で形の違う戦場を取り違えない） */
function groundKey(map: BattleMap): string {
    return `${map.id}|${map.width}|${map.depth}|${JSON.stringify(map.terrain)}`;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const yieldTask = () => new Promise<void>((r) => setTimeout(r, 0));

async function runJobSliced(job: RowJob, sliceMs: number): Promise<TerrainMask> {
    let t0 = now();
    for (let j = 0; j < job.out.h; j++) {
        job.row(j);
        if (now() - t0 >= sliceMs) {
            await yieldTask();
            t0 = now();
        }
    }
    return job.out;
}

/**
 * その戦場の型紙と雑音の画像（戦場の形ごとに 1 度だけ作り、覚えておく。作るのは sliceMs ごとに区切り、間に描画などを挟む＝画面を止めない）。
 * 同じ形の戦場で同時に呼んでも 1 回だけ作る
 */
export function buildGroundData(map: BattleMap, sliceMs = GROUND_SLICE_MS): Promise<GroundData> {
    const key = groundKey(map);
    const hit = groundCache.get(key);
    if (hit) {
        // 使ったものを新しい側へ（古いものから捨てる）
        groundCache.delete(key);
        groundCache.set(key, hit);
        return hit;
    }
    const p = (async () => {
        const mask = await runJobSliced(terrainMaskJob(map), sliceMs);
        const noise = await runJobSliced(groundNoiseJob(mask), sliceMs);
        return { mask, noise };
    })();
    groundCache.set(key, p);
    p.catch(() => {
        if (groundCache.get(key) === p) groundCache.delete(key);
    });
    while (groundCache.size > GROUND_CACHE_MAX) groundCache.delete(groundCache.keys().next().value as string);
    return p;
}

/** その戦場の型紙と雑音をもう覚えているか（確かめ用） */
export function groundDataCached(map: BattleMap): boolean {
    return groundCache.has(groundKey(map));
}

/** 確かめ用：覚えている型紙と雑音を消す */
export function __clearGroundCacheForTest(): void {
    groundCache.clear();
}

/** 型紙の画像（GPU へ。色の変換をしない直線の値・画素の間は直線補間・縮小の段は作らない） */
export function maskTexture(m: TerrainMask): THREE.DataTexture {
    const t = new THREE.DataTexture(m.data, m.w, m.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = THREE.NoColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.flipY = false;
    t.needsUpdate = true;
    return t;
}

// ---------------------------------------------------------------- 素材の画像

export interface GroundTex {
    texture: THREE.Texture;
    /** 素材 1 枚が何 m 四方か */
    tileMeters: number;
}
export interface GroundArtSet {
    grass: GroundTex;
    dirt: GroundTex;
    road: GroundTex;
    forest: GroundTex;
    /** その戦場の型紙と雑音の画像（buildGroundData。覚えておいた物を共有するので、描く側は書き換えない） */
    ground: GroundData;
    /** 低い画質（?q=low）：草地も 1 回だけ読む・anisotropy 1 */
    low: boolean;
}

/** 読んだ画像（ImageBitmap）から、繰り返して貼る地面の素材を作る（sRGB・縮小の段あり・斜めから見ても細かさを保つ） */
export function textureFromBitmap(bmp: ImageBitmap, anisotropy: number): THREE.Texture {
    const t = new THREE.Texture(bmp);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    // ImageBitmap は上下を読み込みの時に決める（ここで裏返さない）。画像の上が北（画面の上）
    t.flipY = false;
    t.anisotropy = Math.max(1, anisotropy);
    t.needsUpdate = true;
    return t;
}

/** 素材の 4 枚を捨てる（使わなかったとき。画像 ImageBitmap は読み込みの登録が持つ共有の物なので閉じない） */
export function disposeGroundArtSet(set: GroundArtSet | null): void {
    if (!set) return;
    for (const t of [set.grass, set.dirt, set.road, set.forest]) t.texture.dispose();
}

/**
 * 届いた素材を、まだ間に合う（open：開始のボタンを出す前・合戦の前）なら apply で使い、間に合わない・使えなかったら捨てる。
 * 合戦の途中で地面を差し替えない（届くのが遅れたら、この合戦は今までの地面のまま。画像と型紙は覚えているので次の合戦で使う）。使ったら true
 */
export function takeGroundArt(set: GroundArtSet | null, open: boolean, apply: (set: GroundArtSet) => boolean): boolean {
    if (!set) return false;
    if (open && apply(set)) return true;
    disposeGroundArtSet(set);
    return false;
}

/** その戦場に地面の素材があるか（旧表示・一覧に無い戦場は false。画像はまだ読まない） */
export function fieldHasArt(fieldId: string): boolean {
    return artMode() === 'new' && !!FIELD_ART[fieldId];
}

/** 素材の一覧（開発用の仮の一覧は読み込みが後から終わる）を読み終えたか */
let manifestSettled = false;
void artReady.then(() => {
    manifestSettled = true;
});

/**
 * その戦場の地面の素材を読みに行くか（その場で決める）。旧表示・素材の無い戦場・一覧に 4 枚とも載っていないときは false
 * （画像も型紙も作らない＝Version 21 と同じ）。開発用の仮の一覧（?artFixture=1）をまだ読み終えていない間だけは、読みに行く側にする
 */
export function fieldArtWanted(fieldId: string): boolean {
    if (!fieldHasArt(fieldId)) return false;
    if (!manifestSettled) return true;
    const fa = FIELD_ART[fieldId];
    return [fa.grass, fa.dirt, fa.road, fa.forest].every((id) => artAvailable(id));
}

/**
 * その戦場の地面の素材を 4 枚とも読み、型紙と雑音の画像（buildGroundData。区切って作る・覚えておく）もそろえる。
 * 旧表示・一覧に無い・1 枚でも読めないときは null（今までの地面のまま。一覧に無ければ型紙も作らない）。
 * 画像は登録の読み込み（loadArtBitmap：fetch → createImageBitmap。CSP の connect-src 'self' の道）だけで読む。
 * 低い画質（low）では anisotropy 1。ほかは anisotropy（端末の上限。4 まで）
 */
export async function loadFieldArt(map: BattleMap, opts: { anisotropy: number; low: boolean }): Promise<GroundArtSet | null> {
    if (!fieldHasArt(map.id)) return null;
    await artReady;
    if (!fieldArtWanted(map.id)) return null;
    const fa = FIELD_ART[map.id];
    const ids = [fa.grass, fa.dirt, fa.road, fa.forest] as const;
    // 型紙と雑音は、画像を読む間に作り始める（読めなくても、作った物は次の合戦のために覚えておく）
    const groundP = buildGroundData(map);
    const bmps = await Promise.all(ids.map((id) => loadArtBitmap(id)));
    if (bmps.some((b) => !b)) return null;
    const ground = await groundP;
    const aniso = opts.low ? 1 : Math.max(1, Math.min(4, Math.floor(opts.anisotropy) || 1));
    const tex = (k: number): GroundTex => {
        const meta = artEntry(ids[k])?.meta;
        const tm = Number(meta?.tileMeters);
        return { texture: textureFromBitmap(bmps[k]!, aniso), tileMeters: Number.isFinite(tm) && tm > 0 ? tm : DEFAULT_TILE_M };
    };
    return { grass: tex(0), dirt: tex(1), road: tex(2), forest: tex(3), ground, low: opts.low };
}

// ---------------------------------------------------------------- 開始のボタンの待ち（木と地面の素材）

/** 地面の素材を、木が済んでから待つ長さ（ms）。過ぎたら今までの地面で始められる（届いた素材はこの合戦では使わない） */
export const ART_WAIT_MS = 2500;

type TimerFn = (fn: () => void, ms: number) => () => void;
const defaultTimer: TimerFn = (fn, ms) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
};

/**
 * 合戦の前の説明の「開始」のボタンを出してよいかの見張り（つなぎ entry.ts が使う）。
 * - 木（Version 21 と同じ）：木が済んだら、または treeTimeoutMs（12 秒）で打ち切り。
 * - 地面の素材（wantArt のときだけ）：木が済んでから artWaitMs だけ待つ。それより早く済めば（使った・読めなかった）その時に出す。
 *   12 秒の打ち切りは素材にも効く（Version 21 より遅くはしない）。
 *   wantArt が false（旧表示・素材の無い戦場・一覧に無い）なら待たない＝Version 21 と同じ時に出す。
 * 出した後（settled）に届いた素材は、つなぎが使わずに捨てる（合戦の途中で地面を差し替えない）。
 */
export class BriefingGate {
    private treesOk = false;
    private artOk: boolean;
    private done = false;
    private cancelTree: (() => void) | null;
    private cancelArt: (() => void) | null = null;
    private readonly timer: TimerFn;

    constructor(private readonly o: { treeTimeoutMs: number; artWaitMs: number; wantArt: boolean; onReady: () => void; timer?: TimerFn }) {
        this.artOk = !o.wantArt;
        this.timer = o.timer ?? defaultTimer;
        this.cancelTree = this.timer(() => this.settle(), o.treeTimeoutMs);
    }

    /** もう「開始」を出した（この後に届いた素材は使わない） */
    get settled(): boolean {
        return this.done;
    }

    /** 木が済んだ（読めた・読めなかった） */
    treesDone(): void {
        if (this.done) return;
        this.treesOk = true;
        if (this.artOk) this.settle();
        else if (!this.cancelArt) this.cancelArt = this.timer(() => this.settle(), this.o.artWaitMs);
    }

    /** 地面の素材が済んだ（使った・読めなかった・使わないと決めた） */
    artDone(): void {
        if (this.done) return;
        this.artOk = true;
        if (this.treesOk) this.settle();
    }

    private settle(): void {
        if (this.done) return;
        this.done = true;
        this.clearTimers();
        this.o.onReady();
    }

    private clearTimers(): void {
        this.cancelTree?.();
        this.cancelArt?.();
        this.cancelTree = this.cancelArt = null;
    }

    /** 後片付け（時計を止める。この後は何も出さない） */
    dispose(): void {
        this.clearTimers();
        this.done = true;
    }
}

// ---------------------------------------------------------------- 描く（地面の材質）

const VERT_PARS = /* glsl */ `
varying vec3 vGaW;
`;
const VERT_MAIN = /* glsl */ `
vGaW = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vGaW;
uniform sampler2D gaMask;
uniform vec4 gaMaskRect;
uniform sampler2D gaNoise;
uniform vec4 gaNoiseRect;
uniform sampler2D gaGrass;
uniform sampler2D gaDirt;
uniform sampler2D gaRoad;
uniform sampler2D gaForest;
uniform vec4 gaTile;
uniform vec2 gaField;
uniform vec4 gaPass;
uniform vec3 gaBg;
uniform vec3 gaDark;
uniform vec3 gaHill;
uniform float gaRange;
uniform vec2 gaBand;

// 同じ模様が並んで見えないように：ゆるい雑音 k で選んだ 2 通りのずらしを、境目の帯だけで混ぜる（帯の外は 1 回だけ読む。傾きは先に計算して渡す）。
// 低い画質（GA_LOW）では 1 回だけ読む（ずらさない）
vec3 gaTex(sampler2D t, vec2 uv, vec2 gx, vec2 gy, float k) {
#ifdef GA_LOW
    return textureGrad(t, uv, gx, gy).rgb;
#else
    float l = k * 7.0;
    float i = floor(l);
    float w = smoothstep(0.35, 0.65, fract(l));
    vec3 c = vec3(0.0);
    if (w < 0.999) c += (1.0 - w) * textureGrad(t, uv + sin(vec2(3.0, 7.0) * i), gx, gy).rgb;
    if (w > 0.001) c += w * textureGrad(t, uv + sin(vec2(3.0, 7.0) * (i + 1.0)), gx, gy).rgb;
    return c;
#endif
}
float gaCover(float sd, float band) {
    return 1.0 - smoothstep(-0.5 * band, 0.5 * band, sd);
}
`;

const glf = (v: number) => v.toFixed(3);
const FRAG_MAIN = /* glsl */ `
{
    vec2 w = vGaW.xz;
    // 型紙（決まりの地形の形からの符号付き距離。m）
    vec3 m = texture(gaMask, (w - gaMaskRect.xy) * gaMaskRect.zw).rgb;
    vec3 sd = (m * 255.0 - 127.5) / 127.5 * gaRange;
    float roadW = gaCover(sd.r, gaBand.x);
    float forestW = gaCover(sd.g, gaBand.y);
    float otherW = gaCover(sd.b, gaBand.y);
    // 傾き（分岐の外で）。素材ごとに少し回して、継ぎ目の格子をそろえない
    vec2 dwx = dFdx(w);
    vec2 dwy = dFdy(w);
    mat2 r1 = mat2(0.8253, 0.5646, -0.5646, 0.8253);
    mat2 r2 = mat2(0.4536, -0.8912, 0.8912, 0.4536);
    mat2 r3 = mat2(-0.6536, 0.7568, -0.7568, -0.6536);
    // 低い周波数の雑音（CPU で作った画像。groundNoiseAt と同じ）
    vec4 nz = texture(gaNoise, (w - gaNoiseRect.xy) * gaNoiseRect.zw);
    float kTile = nz.a;
    // 草地（大きな濃淡：100〜200 m のゆるい明るさと乾き具合）
    vec3 col = gaTex(gaGrass, w * gaTile.x, dwx * gaTile.x, dwy * gaTile.x, kTile);
    col *= mix(vec3(0.9, 0.93, 0.9), vec3(1.07, 1.05, 0.96), nz.r) * (0.95 + 0.1 * nz.g);
    // 土のむら：草地の中だけの薄い斑（dirtWeight と同じ式）。道・林・ほかの地形の縁の近くには出さない
    float dirtW = nz.b * ${glf(DIRT_MAX)} * smoothstep(${glf(DIRT_ROAD_M[0])}, ${glf(DIRT_ROAD_M[1])}, sd.r) * smoothstep(${glf(DIRT_WOODS_M[0])}, ${glf(DIRT_WOODS_M[1])}, sd.g) * smoothstep(${glf(DIRT_OTHER_M[0])}, ${glf(DIRT_OTHER_M[1])}, sd.b);
    // 土・林床・道は狭い所だけなので 1 回読む（素材ごとに回して、草地と継ぎ目の格子をそろえない）
    if (dirtW > 0.002) col = mix(col, textureGrad(gaDirt, r1 * w * gaTile.y, r1 * dwx * gaTile.y, r1 * dwy * gaTile.y).rgb, dirtW);
    if (forestW > 0.002) col = mix(col, textureGrad(gaForest, r2 * w * gaTile.w, r2 * dwx * gaTile.w, r2 * dwy * gaTile.w).rgb, forestW);
    if (roadW > 0.002) col = mix(col, textureGrad(gaRoad, r3 * w * gaTile.z, r3 * dwx * gaTile.z, r3 * dwy * gaTile.z).rgb, roadW);
    // ほかの地形（湿地・川など）は今までの頂点の色
    col = mix(col, vColor.rgb, otherW);
    // 丘の上の乾いた草（今までと同じ高さの式）
    float hk = clamp(vGaW.y / 12.0, 0.0, 1.0) * 0.8 * (1.0 - otherW) * (1.0 - forestW) * (1.0 - roadW);
    col *= mix(vec3(1.0), gaHill, hk);
    // 戦場の外は表示の背景の色（昼・夜）へ（今までと同じ式。縁の段差だけ 4 m でなめらかに）
    float d = max(abs(vGaW.x) - gaField.x, abs(vGaW.z) - gaField.y);
    col = mix(col, gaBg, min(1.0, 0.45 * smoothstep(-2.0, 2.0, d) + max(d, 0.0) / 200.0));
    // 通れる範囲の外（戦場の中）は暗く
    float pd = max(max(gaPass.x - vGaW.x, vGaW.x - gaPass.y), max(gaPass.z - vGaW.z, vGaW.z - gaPass.w));
    col = mix(col, gaDark, 0.55 * smoothstep(-1.0, 1.0, pd) * (1.0 - smoothstep(-2.0, 2.0, d)));
    diffuseColor.rgb *= col;
}
`;

export interface GroundArtMaterial {
    material: THREE.MeshLambertMaterial;
    mask: THREE.DataTexture;
    noise: THREE.DataTexture;
}

/** 戦場の外を薄める色の既定（昼の背景。view.ts の背景と同じ） */
export const DAY_BG = '#56653f';

/**
 * 地面の材質（今までの頂点の色の Lambert に、素材を混ぜる式を足したもの。光・霧は今までと同じ）。
 * 形（頂点の色の地面）はそのまま使い、材質だけを差し替える。型紙と雑音は set.ground（作り済み）を読むだけ。
 * bg は表示の背景の色（昼・夜。戦場の外をこの色へ薄める）。set.low のときは草地を 1 回だけ読む
 */
export function makeGroundArtMaterial(
    map: BattleMap,
    passable: { x0: number; x1: number; z0: number; z1: number } | null,
    set: GroundArtSet,
    bg: THREE.ColorRepresentation = DAY_BG,
): GroundArtMaterial {
    const mask = set.ground.mask;
    const nm = set.ground.noise;
    const maskTex = maskTexture(mask);
    const noiseTex = maskTexture(nm);
    const grass = new THREE.Color('#7a8f4c');
    const hill = new THREE.Color('#a2a462');
    const p = passable ?? { x0: -1e5, x1: 1e5, z0: -1e5, z1: 1e5 };
    const uniforms = {
        gaMask: { value: maskTex },
        gaMaskRect: { value: new THREE.Vector4(mask.x0, mask.z0, 1 / (mask.w * mask.cell), 1 / (mask.h * mask.cell)) },
        gaNoise: { value: noiseTex },
        gaNoiseRect: { value: new THREE.Vector4(nm.x0, nm.z0, 1 / (nm.w * nm.cell), 1 / (nm.h * nm.cell)) },
        gaGrass: { value: set.grass.texture },
        gaDirt: { value: set.dirt.texture },
        gaRoad: { value: set.road.texture },
        gaForest: { value: set.forest.texture },
        gaTile: { value: new THREE.Vector4(1 / set.grass.tileMeters, 1 / set.dirt.tileMeters, 1 / set.road.tileMeters, 1 / set.forest.tileMeters) },
        gaField: { value: new THREE.Vector2(map.width / 2, map.depth / 2) },
        gaPass: { value: new THREE.Vector4(p.x0, p.x1, p.z0, p.z1) },
        gaBg: { value: new THREE.Color(bg) },
        gaDark: { value: new THREE.Color('#252a1e') },
        gaHill: { value: new THREE.Vector3(hill.r / grass.r, hill.g / grass.g, hill.b / grass.b) },
        gaRange: { value: MASK_RANGE_M },
        gaBand: { value: new THREE.Vector2(ROAD_BAND_M, WOODS_BAND_M) },
    };
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    if (set.low) material.defines = { GA_LOW: '' };
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERT_PARS}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${FRAG_PARS}`).replace('#include <color_fragment>', FRAG_MAIN);
    };
    material.customProgramCacheKey = () => `battle-ground-art-4${set.low ? '-low' : ''}`;
    return { material, mask: maskTex, noise: noiseTex };
}

// ---------------------------------------------------------------- 林の木の置き場所（円・カプセルの林）

/** 林の木の置き場所（決まった配置。格子を少しずらす）。hash は 0〜1 の決まった乱数 */
export interface TreeSpot {
    x: number;
    z: number;
    rot: number;
    scale: number;
}

/**
 * 円・カプセルの林の木の置き場所（四角の林は view.ts の今までの置き方）。決まりの区域の内側だけ（縁から margin m 内側）。
 * 四角の林と同じ間隔 sp の格子を少しずらして、区域の中に入る点だけを使う。
 */
export function roundWoodsSpots(a: TerrainArea, sp: number, hash: (key: string, i: number) => number, margin = 3): TreeSpot[] {
    const out: TreeSpot[] = [];
    let bx0: number;
    let bx1: number;
    let bz0: number;
    let bz1: number;
    if (a.circle) {
        bx0 = a.circle.cx - a.circle.r;
        bx1 = a.circle.cx + a.circle.r;
        bz0 = a.circle.cz - a.circle.r;
        bz1 = a.circle.cz + a.circle.r;
    } else if (a.capsule) {
        const c = a.capsule;
        bx0 = Math.min(c.ax, c.bx) - c.r;
        bx1 = Math.max(c.ax, c.bx) + c.r;
        bz0 = Math.min(c.az, c.bz) - c.r;
        bz1 = Math.max(c.az, c.bz) + c.r;
    } else return out;
    let i = 0;
    for (let z = bz0 + sp / 2; z < bz1; z += sp) {
        for (let x = bx0 + sp / 2; x < bx1; x += sp) {
            i++;
            const px = x + (hash('cx', i) - 0.5) * sp * 0.7;
            const pz = z + (hash('cz', i) - 0.5) * sp * 0.7;
            if (areaSignedDist(a, px, pz) > -margin) continue;
            out.push({ x: px, z: pz, rot: hash('cr', i) * Math.PI * 2, scale: 0.5 + hash('cs', i) * 0.2 });
        }
    }
    return out;
}
