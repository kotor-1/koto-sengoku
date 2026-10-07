/**
 * 合戦の地面の素材（Version 22。生成イラスト素材の草地・土・道・林床の 4 枚を、地形の決まりの形に合わせて混ぜる）。
 *
 * - 混ぜ方の「型紙」（マスク）は、合戦の決まりの地形の区域（BattleMap.terrain の四角・円・カプセル。sim.ts の inTerrain と同じ形）から作る。
 *   画素ごとに「区域の縁からの距離（中が負）」を持たせ（符号付き距離）、描くときにその距離 0 の所を境にする。
 *   だから道・林の見た目の縁は、決まりの縁と同じ所に来る（混ぜる帯は縁を中心に道 ±0.75 m・林 ±1 m）。
 * - 大きな濃淡と土のむらは、低い周波数のなめらかな雑音で作る（CPU で 1 度だけ 2 m の画素の画像にして、描くときに読む。草地の中だけ。
 *   道・林の縁の近くには出さない。形はまるい斑で、筋（道・川に見える細長い形）にしない：tests/proto3d-battle-art.test.ts で形を確かめる）。
 *   画像に描かれた物を道・川・障害物として見せることはしない。
 * - 素材 1 枚の大きさは記録の meta.tileMeters（無ければ 8 m）。同じ模様が並んで見えないように、ずらした 2 か所を雑音で混ぜる。
 * - 戦場の外は今までと同じく背景の色へ薄め、通れる範囲の外は暗くする（同じ式）。湿地・川などほかの地形は今までの頂点の色のまま。
 * - 合戦の状態は読まない（地形の形だけ）。画像は art/registry.ts の loadArtBitmap だけで読む。
 */
import * as THREE from 'three';
import type { BattleMap, TerrainArea, TerrainKind } from './types';
import { capsuleDist } from './fieldRules';
import { FIELD_ART } from '../art/ids';
import { artEntry, artMode, loadArtBitmap } from '../art/registry';

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

/** 型紙を作る（決まりの地形の形から。同じ戦場ならいつも同じ） */
export function buildTerrainMask(map: BattleMap): TerrainMask {
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
    for (let j = 0; j < h; j++) {
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
    }
    return { data, w, h, x0, z0, cell };
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

// ---------------------------------------------------------------- 低い周波数の雑音（CPU で 1 度だけ作って画像にする）

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

/** 土の斑の置き方：DIRT_CELL_M 四方のますごとに、DIRT_P の割合で 1 つ。中心はますの真ん中の半分の中、半径は DIRT_R の間 */
const DIRT_CELL_M = 44;
const DIRT_P = 0.6;
const DIRT_R = [5, 11] as const;

/**
 * 土の斑（0〜1）。ますごとの丸い斑（縁を少し揺らす）。隣のますの斑とは重ならない（中心の間は 22 m 以上・半径は 11 m まで）ので、
 * つながって長い筋（道・川に見える形）にはならない
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
            const r = DIRT_R[0] + (DIRT_R[1] - DIRT_R[0]) * latticeHash(i, j, 504);
            // 縁を少し揺らす（±15%。8 m ほどの波）
            const wob = 1 + 0.3 * (valueNoise(x / 8, z / 8, 505) - 0.5);
            const d = Math.hypot(x - cx, z - cz) / (r * wob);
            if (d < 1) best = Math.max(best, smooth(0, 0.45, 1 - d));
        }
    }
    return best;
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

/** 土のむらの濃さ（0〜DIRT_MAX。描く側の式と同じ）：草地の中だけ。道の縁から 4〜10 m・林の縁から 3〜9 m の間で 0 から上がる（道・林が広がって見えないように） */
export function dirtWeight(dirtSpot: number, roadSd: number, woodsSd: number, otherSd: number): number {
    return dirtSpot * DIRT_MAX * smooth(4, 10, roadSd) * smooth(3, 9, woodsSd) * (1 - coverageFromSd(otherSd, WOODS_BAND_M));
}
/** 土のむらの濃さの上限（素材を混ぜる割合） */
export const DIRT_MAX = 0.7;

/** 雑音の画像（型紙と同じ範囲を NOISE_CELL_M の画素で。R＝big・G＝mid・B＝dirt・A＝tile） */
export function buildGroundNoise(m: TerrainMask): TerrainMask {
    const cell = Math.max(NOISE_CELL_M, m.cell);
    const w = Math.ceil((m.w * m.cell) / cell);
    const h = Math.ceil((m.h * m.cell) / cell);
    const x0 = m.x0;
    const z0 = m.z0;
    const data = new Uint8Array(w * h * 4);
    for (let j = 0; j < h; j++) {
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
    }
    return { data, w, h, x0, z0, cell };
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

/** その戦場に地面の素材があるか（旧表示・一覧に無い戦場は false。画像はまだ読まない） */
export function fieldHasArt(fieldId: string): boolean {
    return artMode() === 'new' && !!FIELD_ART[fieldId];
}

/**
 * その戦場の地面の素材を 4 枚とも読む。旧表示・一覧に無い・1 枚でも読めない ときは null（今までの地面のまま）。
 * 画像は登録の読み込み（loadArtBitmap：fetch → createImageBitmap。CSP の connect-src 'self' の道）だけで読む。
 */
export async function loadFieldArt(fieldId: string, anisotropy: number): Promise<GroundArtSet | null> {
    if (!fieldHasArt(fieldId)) return null;
    const fa = FIELD_ART[fieldId];
    const ids = [fa.grass, fa.dirt, fa.road, fa.forest] as const;
    const bmps = await Promise.all(ids.map((id) => loadArtBitmap(id)));
    if (bmps.some((b) => !b)) return null;
    const tex = (k: number): GroundTex => {
        const meta = artEntry(ids[k])?.meta;
        const tm = Number(meta?.tileMeters);
        return { texture: textureFromBitmap(bmps[k]!, anisotropy), tileMeters: Number.isFinite(tm) && tm > 0 ? tm : DEFAULT_TILE_M };
    };
    return { grass: tex(0), dirt: tex(1), road: tex(2), forest: tex(3) };
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

// 同じ模様が並んで見えないように：ゆるい雑音 k で選んだ 2 通りのずらしを、境目の帯だけで混ぜる（帯の外は 1 回だけ読む。傾きは先に計算して渡す）
vec3 gaTex(sampler2D t, vec2 uv, vec2 gx, vec2 gy, float k) {
    float l = k * 7.0;
    float i = floor(l);
    float w = smoothstep(0.35, 0.65, fract(l));
    vec3 c = vec3(0.0);
    if (w < 0.999) c += (1.0 - w) * textureGrad(t, uv + sin(vec2(3.0, 7.0) * i), gx, gy).rgb;
    if (w > 0.001) c += w * textureGrad(t, uv + sin(vec2(3.0, 7.0) * (i + 1.0)), gx, gy).rgb;
    return c;
}
float gaCover(float sd, float band) {
    return 1.0 - smoothstep(-0.5 * band, 0.5 * band, sd);
}
`;

const DIRT_GLSL = DIRT_MAX.toFixed(3);
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
    // 土のむら：草地の中だけ。まるい斑（dirtSpotAt）。道・林の縁の近くには出さない（道や林が広がって見えないように）
    float dirtW = nz.b * ${DIRT_GLSL} * smoothstep(4.0, 10.0, sd.r) * smoothstep(3.0, 9.0, sd.g) * (1.0 - otherW);
    // 土・林床・道は狭い所だけなので 1 回読む（素材ごとに回して、草地と継ぎ目の格子をそろえない）
    if (dirtW > 0.002) col = mix(col, textureGrad(gaDirt, r1 * w * gaTile.y, r1 * dwx * gaTile.y, r1 * dwy * gaTile.y).rgb, dirtW);
    if (forestW > 0.002) col = mix(col, textureGrad(gaForest, r2 * w * gaTile.w, r2 * dwx * gaTile.w, r2 * dwy * gaTile.w).rgb, forestW);
    if (roadW > 0.002) col = mix(col, textureGrad(gaRoad, r3 * w * gaTile.z, r3 * dwx * gaTile.z, r3 * dwy * gaTile.z).rgb, roadW);
    // ほかの地形（湿地・川など）は今までの頂点の色
    col = mix(col, vColor.rgb, otherW);
    // 丘の上の乾いた草（今までと同じ高さの式）
    float hk = clamp(vGaW.y / 12.0, 0.0, 1.0) * 0.8 * (1.0 - otherW) * (1.0 - forestW) * (1.0 - roadW);
    col *= mix(vec3(1.0), gaHill, hk);
    // 戦場の外は背景の色へ（今までと同じ式。縁の段差だけ 4 m でなめらかに）
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

/**
 * 地面の材質（今までの頂点の色の Lambert に、素材を混ぜる式を足したもの。光・霧は今までと同じ）。
 * 形（頂点の色の地面）はそのまま使い、材質だけを差し替える。
 */
export function makeGroundArtMaterial(map: BattleMap, passable: { x0: number; x1: number; z0: number; z1: number } | null, mask: TerrainMask, set: GroundArtSet): GroundArtMaterial {
    const maskTex = maskTexture(mask);
    const nm = buildGroundNoise(mask);
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
        gaBg: { value: new THREE.Color('#56653f') },
        gaDark: { value: new THREE.Color('#252a1e') },
        gaHill: { value: new THREE.Vector3(hill.r / grass.r, hill.g / grass.g, hill.b / grass.b) },
        gaRange: { value: MASK_RANGE_M },
        gaBand: { value: new THREE.Vector2(ROAD_BAND_M, WOODS_BAND_M) },
    };
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERT_PARS}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_MAIN}`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${FRAG_PARS}`).replace('#include <color_fragment>', FRAG_MAIN);
    };
    material.customProgramCacheKey = () => 'battle-ground-art-3';
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
