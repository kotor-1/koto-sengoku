/**
 * 地面（草地・土の道・石畳・水面の下地・田・城門の床）をマップ全体で 1 枚に焼く。
 *
 * タイルの四角が見えないように、次の 3 段で描く。
 *
 * 1. 「場」：1 タイルを 8×8 の小さな格子（ワールド 2 px）に分け、素材ごとの重み（草・道・庭土・石・水・田・林床）を
 *    「タイルの有無をぼかす＋ノイズで揺らす」ことで不規則な境界として求める。重みから下地の色を決め、
 *    小さな Canvas に書いて 2 段階で拡大（なめらか補間）する。＝輪郭が柔らかく、形が不規則な下塗り。
 *    ※ JS で 1 画素ずつ計算するのはこの小さな格子（約 16 万画素）だけ。
 * 2. 「模様」：草の葉は小さな繰り返し模様（周期の違う 2 枚）を全面に敷き、草の重みで切り抜いて重ねる。
 *    田の苗も模様で並べる。＝何万本もの線を 1 本ずつ描かずに済む（Canvas の命令数を抑える）。
 * 3. 「筆致」：道の轍・小石、切石、畦、岸の石、道の縁から伸びる草などを、色ごとに 1 本のパスへまとめて描く。
 *    最後に、物（家・壁・木）の根元の陰（AO）を重ねる。
 *
 * 乱数はすべて seed つき（毎回同じ絵）。ctx.filter は使わない。解像度 tex は 1.5 など整数でなくてよい。
 */
import { TILE_SIZE } from '../../core/constants';
import { MAP_HEIGHT, MAP_PIXEL_HEIGHT, MAP_PIXEL_WIDTH, MAP_WIDTH, tileAt, type TileChar } from '../../core/map';
import { paddyRects } from '../world/layout';
import { PALETTE } from './spec';
import { context, createCanvas, hash2, mix, parseHex, rng, shade, withAlpha, type ArtPiece, type Ctx } from './canvas';

export function groundArt(tex: number): ArtPiece {
    return {
        key: 'ground',
        spec: { w: MAP_PIXEL_WIDTH, h: MAP_PIXEL_HEIGHT, ox: 0, oy: 0 },
        width: Math.ceil(MAP_PIXEL_WIDTH * tex),
        height: Math.ceil(MAP_PIXEL_HEIGHT * tex),
        draw: (ctx) => paintGround(ctx, tex),
    };
}

const T = TILE_SIZE;
const P = PALETTE;

// ===========================================================================
// 場（低解像度の重み）
// ===========================================================================

/** 1 タイルあたりの格子数 */
const F = 8;
const FW = MAP_WIDTH * F;
const FH = MAP_HEIGHT * F;
const N = FW * FH;
/** 格子 1 つのワールド px */
const WPF = T / F;

interface Fields {
    road: Float32Array;
    worn: Float32Array;
    water: Float32Array;
    forest: Float32Array;
    grass: Float32Array;
    /** 草の明るさ（0〜1） */
    grassTone: Float32Array;
    /** 乾いた草の度合い（0〜1） */
    dry: Float32Array;
    ao: Float32Array;
    /** 下地の色（RGBA） */
    color: Uint8ClampedArray;
}

function clamp01(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

function ss(a: number, b: number, x: number): number {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
}

type RGB = Float64Array;

function rgb(hex: string): RGB {
    const c = parseHex(hex);
    return Float64Array.of(c.r, c.g, c.b);
}

function set(dst: RGB, c: RGB): void {
    dst[0] = c[0];
    dst[1] = c[1];
    dst[2] = c[2];
}

function lerpTo(dst: RGB, c: RGB, t: number): void {
    if (t <= 0) return;
    if (t > 1) t = 1;
    dst[0] += (c[0] - dst[0]) * t;
    dst[1] += (c[1] - dst[1]) * t;
    dst[2] += (c[2] - dst[2]) * t;
}

/** 格子に合わせた値ノイズ（格子点の乱数をなめらかに補間）。cell は格子数。 */
function noiseLayer(cell: number, seed: number): Float32Array {
    const lw = Math.ceil(FW / cell) + 2;
    const lh = Math.ceil(FH / cell) + 2;
    const lat = new Float32Array(lw * lh);
    for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) lat[j * lw + i] = hash2(i, j, seed);
    // 横方向の補間係数は行ごとに同じなので先に作る
    const xiA = new Int32Array(FW);
    const txA = new Float32Array(FW);
    for (let x = 0; x < FW; x++) {
        const fx = x / cell;
        const xi = fx | 0;
        const t = fx - xi;
        xiA[x] = xi;
        txA[x] = t * t * (3 - 2 * t);
    }
    const out = new Float32Array(N);
    for (let y = 0; y < FH; y++) {
        const fy = y / cell;
        const yi = fy | 0;
        let ty = fy - yi;
        ty = ty * ty * (3 - 2 * ty);
        const r0 = yi * lw;
        const o = y * FW;
        for (let x = 0; x < FW; x++) {
            const i0 = r0 + xiA[x];
            const tx = txA[x];
            const a = lat[i0];
            const top = a + (lat[i0 + 1] - a) * tx;
            const c = lat[i0 + lw];
            out[o + x] = top + (c + (lat[i0 + lw + 1] - c) * tx - top) * ty;
        }
    }
    return out;
}

/** 2 枚のノイズの重みつき和を、平均 0.5 のまま広げる（重ねると幅が狭くなるので戻す） */
function blend2(a: Float32Array, wa: number, b: Float32Array, wb: number, contrast: number): Float32Array {
    const out = new Float32Array(N);
    const s = wa + wb;
    for (let i = 0; i < N; i++) out[i] = clamp01(((a[i] * wa + b[i] * wb) / s - 0.5) * contrast + 0.5);
    return out;
}

/** 箱型ぼかし（横→縦を passes 回。2 回でほぼガウスぼかし）。縦も行の順に走査する。 */
function blur(src: Float32Array, r: number, passes = 2): Float32Array {
    const a = src.slice();
    const t = new Float32Array(N);
    const sums = new Float32Array(FW);
    const inv = 1 / (2 * r + 1);
    const lastX = FW - 1;
    const lastY = FH - 1;
    for (let p = 0; p < passes; p++) {
        for (let y = 0; y < FH; y++) {
            const row = y * FW;
            let sum = 0;
            for (let k = -r; k <= r; k++) sum += a[row + (k < 0 ? 0 : k > lastX ? lastX : k)];
            for (let x = 0; x < FW; x++) {
                t[row + x] = sum * inv;
                const xa = x + r + 1;
                const xs = x - r;
                sum += a[row + (xa > lastX ? lastX : xa)] - a[row + (xs < 0 ? 0 : xs)];
            }
        }
        sums.fill(0);
        for (let k = -r; k <= r; k++) {
            const row = (k < 0 ? 0 : k > lastY ? lastY : k) * FW;
            for (let x = 0; x < FW; x++) sums[x] += t[row + x];
        }
        for (let y = 0; y < FH; y++) {
            const row = y * FW;
            for (let x = 0; x < FW; x++) a[row + x] = sums[x] * inv;
            const ya = y + r + 1;
            const ys = y - r;
            const add = (ya > lastY ? lastY : ya) * FW;
            const sub = (ys < 0 ? 0 : ys) * FW;
            for (let x = 0; x < FW; x++) sums[x] += t[add + x] - t[sub + x];
        }
    }
    return a;
}

/** タイルの文字から 0〜1 の値を決めて、格子に塗る */
function tileMask(value: (c: TileChar, tx: number, ty: number) => number): Float32Array {
    const m = new Float32Array(N);
    for (let ty = 0; ty < MAP_HEIGHT; ty++) {
        for (let tx = 0; tx < MAP_WIDTH; tx++) {
            const v = value(tileAt(tx, ty)!, tx, ty);
            if (!v) continue;
            for (let y = 0; y < F; y++) m.fill(v, (ty * F + y) * FW + tx * F, (ty * F + y) * FW + tx * F + F);
        }
    }
    return m;
}

function isBorder(tx: number, ty: number): boolean {
    return tx === 0 || ty === 0 || tx === MAP_WIDTH - 1 || ty === MAP_HEIGHT - 1;
}

const isRoadChar = (c: TileChar | null) => c === ',' || c === 'X';

function buildFields(): Fields {
    // ノイズ（セルの大きさは格子数。1 格子 = 2 ワールド px）
    const n3 = noiseLayer(3, 103);
    const n6 = noiseLayer(6, 107);
    const n12 = noiseLayer(12, 109);
    const n24 = noiseLayer(24, 113);
    const n48 = noiseLayer(48, 127);
    const m24 = noiseLayer(24, 131);
    const edgeN = blend2(n3, 0.55, n6, 0.45, 1.7);
    const tone = blend2(blend2(n48, 0.45, n24, 0.55, 1.4), 0.7, n6, 0.3, 1.5);
    const dryN = blend2(m24, 0.7, n6, 0.3, 1.8);

    const bRoad = tileMask((c) => (isRoadChar(c) ? 1 : 0));
    const mRoad = blur(bRoad, 2);
    const roadCore = blur(bRoad, 5);
    const mYard = blur(tileMask((c) => (c === 'R' || c === 'W' ? 1 : c === 'o' || c === 'N' || c === 'M' ? 0.9 : 0)), 2);
    const mStone = blur(tileMask((c) => (c === '=' || c === 'K' || c === '#' || c === 'G' ? 1 : 0)), 1);
    const bWater = tileMask((c) => (c === '~' || c === 'B' ? 1 : 0));
    const mWater = blur(bWater, 2);
    const deep = blur(bWater, 4);
    const mPaddy = blur(tileMask((c) => (c === 'f' ? 1 : 0)), 1, 1);
    const mForest = blur(tileMask((c, tx, ty) => (c === 'T' ? (isBorder(tx, ty) ? 1 : 0.85) : 0)), 3);
    const mOcc = blur(
        tileMask((c) => (c === 'R' || c === 'W' || c === '#' || c === 'K' ? 1 : c === 'o' || c === 'N' || c === 'M' || c === 'X' ? 0.75 : c === 'F' ? 0.5 : 0)),
        2,
    );

    const road = new Float32Array(N);
    const worn = new Float32Array(N);
    const yard = new Float32Array(N);
    const stone = new Float32Array(N);
    const water = new Float32Array(N);
    const bank = new Float32Array(N);
    const paddy = new Float32Array(N);
    const forest = new Float32Array(N);
    const grass = new Float32Array(N);
    const dry = new Float32Array(N);

    // --- 重み（境界はぼかし＋ノイズで揺らしてから、なめらかな段差で切る） ---
    for (let i = 0; i < N; i++) {
        const e = edgeN[i] - 0.5;
        const wR = ss(0.36, 0.64, mRoad[i] + e * 0.7);
        const wY = ss(0.26, 0.62, mYard[i] + e * 0.6) * 0.9;
        const wS = ss(0.4, 0.6, mStone[i] + e * 0.25);
        const wWraw = mWater[i] + e * 0.26;
        const wW = ss(0.52, 0.66, wWraw);
        const wB = ss(0.1, 0.42, wWraw) * (1 - wW);
        const wP = ss(0.42, 0.58, mPaddy[i]);
        const wF = ss(0.28, 0.62, mForest[i] + e * 0.5);
        road[i] = wR;
        yard[i] = wY;
        stone[i] = wS;
        water[i] = wW;
        bank[i] = wB;
        paddy[i] = wP;
        forest[i] = wF;
        worn[i] = ss(0.7, 0.95, roadCore[i] + e * 0.12);
        grass[i] = (1 - wR) * (1 - wY) * (1 - wS) * (1 - wW) * (1 - wP) * (1 - wF * 0.8) * (1 - wB * 0.6);
        dry[i] = ss(0.55, 0.82, dryN[i]);
    }

    // --- 色 ---
    const gDark = rgb(mix(P.grassDark, '#4a5a3c', 0.25));
    const gMid = rgb(mix(P.grass, '#707e56', 0.3));
    const gLight = rgb(mix(P.grass, P.grassLight, 0.45));
    const gDry = rgb(mix(P.grassDry, '#8f8a5c', 0.3));
    const gLush = rgb(mix(P.grassDark, '#3d5a3c', 0.5));
    const gTrampled = rgb(mix(P.grassDry, P.dirt, 0.45));
    const gCool = rgb('#5b7a58');
    const gWarm = rgb('#85834f');
    const dDark = rgb(P.dirtDark);
    const dMid = rgb(P.dirt);
    const dLight = rgb(mix(P.dirtLight, P.dirt, 0.25));
    const dEdge = rgb(mix(P.dirtDark, P.grassDark, 0.35));
    const dDamp = rgb(shade(P.dirtDark, -0.06));
    const yDark = rgb(mix(P.dirtDark, P.stoneDark, 0.35));
    const yLight = rgb(mix(P.dirt, P.stone, 0.3));
    const sJoint = rgb(mix(P.stone, P.stoneDark, 0.6));
    const sJoint2 = rgb(mix(P.stoneDark, P.dirtDark, 0.3));
    const wShallow = rgb(shade(mix(P.water, P.mud, 0.55), 0.08));
    const wMid = rgb(P.water);
    const wDeep = rgb(shade(P.waterDeep, -0.08));
    const wLight = rgb(P.waterLight);
    const bankC = rgb(mix(P.mud, P.dirtDark, 0.55));
    const bankWet = rgb(shade(mix(P.mud, P.dirtDark, 0.4), -0.22));
    const ridgeC = rgb(mix(P.grassDark, P.dirtDark, 0.45));
    const fFloor = rgb(mix(P.leafDark, P.bark, 0.35));
    const fMoss = rgb(mix(P.grassDark, P.leafDark, 0.4));
    const fLitter = rgb(mix(P.bark, P.dirtDark, 0.5));

    const color = new Uint8ClampedArray(N * 4);
    const cur = new Float64Array(3);
    const tmp = new Float64Array(3);
    const waterColor = (i: number, out: RGB) => {
        const d = ss(0.5, 1.0, deep[i]);
        if (d < 0.5) {
            set(out, wShallow);
            lerpTo(out, wMid, d * 2);
        } else {
            set(out, wMid);
            lerpTo(out, wDeep, (d - 0.5) * 2);
        }
        lerpTo(out, wLight, ss(0.58, 0.86, n12[i]) * 0.14 * (1 - d * 0.5));
    };
    const stoneColor = (i: number, out: RGB) => {
        set(out, sJoint);
        lerpTo(out, sJoint2, n6[i] * 0.6);
    };
    const roadColor = (i: number, wR: number, out: RGB) => {
        set(out, dDark);
        lerpTo(out, dMid, 0.45 + 0.55 * clamp01((n12[i] * 0.6 + n3[i] * 0.4 - 0.5) * 1.8 + 0.5));
        lerpTo(out, dLight, worn[i] * 0.55);
        lerpTo(out, dDamp, ss(0.66, 0.86, m24[i]) * 0.3);
        lerpTo(out, dEdge, (1 - ss(0.45, 0.95, wR)) * 0.55);
    };
    for (let i = 0; i < N; i++) {
        const wW = water[i];
        const wS = stone[i];
        const wR = road[i];
        // 1 つの素材で完全に覆われる画素は、その色だけ計算する（大半の画素がここで済む）
        if (wW > 0.999) waterColor(i, cur);
        else if (paddy[i] > 0.999) set(cur, ridgeC);
        else if (wS > 0.999) stoneColor(i, cur);
        else if (wR > 0.999 && yard[i] === 0) roadColor(i, wR, cur);
        else {
            // 草
            const t = tone[i];
            if (t < 0.5) {
                set(cur, gDark);
                lerpTo(cur, gMid, t * 2);
            } else {
                set(cur, gMid);
                lerpTo(cur, gLight, (t - 0.5) * 2);
            }
            lerpTo(cur, gDry, dry[i] * 0.5);
            const hue = n48[i] - 0.5;
            lerpTo(cur, hue < 0 ? gCool : gWarm, Math.abs(hue) * 0.4);
            lerpTo(cur, gTrampled, ss(0.04, 0.42, roadCore[i]) * (1 - wR) * 0.38);
            lerpTo(cur, gLush, ss(0.02, 0.3, deep[i]) * 0.5);
            const sp = (n3[i] - 0.5) * 12;
            cur[0] += sp;
            cur[1] += sp;
            cur[2] += sp * 0.6;
            // 林床
            const wF = forest[i];
            if (wF > 0) {
                set(tmp, fFloor);
                lerpTo(tmp, fMoss, n6[i] * 0.7);
                lerpTo(tmp, fLitter, ss(0.55, 0.8, n3[i]) * 0.45);
                lerpTo(cur, tmp, wF * 0.85);
            }
            // 庭土（家や井戸・高札のまわりの踏み固めた土）
            const wY = yard[i];
            if (wY > 0) {
                set(tmp, yDark);
                lerpTo(tmp, yLight, 0.3 + 0.55 * n6[i]);
                lerpTo(cur, tmp, wY);
            }
            // 土の道：縁は暗く草まじり、中央は踏まれて明るい
            if (wR > 0) {
                roadColor(i, wR, tmp);
                lerpTo(cur, tmp, wR);
            }
            // 岸（水際の湿った土）
            const wB = bank[i];
            if (wB > 0) {
                set(tmp, bankC);
                lerpTo(tmp, bankWet, ss(0.3, 0.5, mWater[i]));
                lerpTo(cur, tmp, wB * 0.9);
            }
            // 石畳の目地（切石は後で上に並べる）
            if (wS > 0) {
                stoneColor(i, tmp);
                lerpTo(cur, tmp, wS);
            }
            // 田（畦の土。水面と苗は後で描く）
            if (paddy[i] > 0) lerpTo(cur, ridgeC, paddy[i]);
            // 水：岸寄りは浅く明るい泥色、中央は深い青緑
            if (wW > 0) {
                waterColor(i, tmp);
                lerpTo(cur, tmp, wW);
            }
        }
        const o = i * 4;
        color[o] = cur[0];
        color[o + 1] = cur[1];
        color[o + 2] = cur[2];
        color[o + 3] = 255;
    }
    return { road, worn, water, forest, grass, grassTone: tone, dry, ao: mOcc, color };
}

/** ワールド座標での値（最近傍） */
function at(f: Float32Array, x: number, y: number): number {
    let fx = (x / WPF) | 0;
    let fy = (y / WPF) | 0;
    fx = fx < 0 ? 0 : fx > FW - 1 ? FW - 1 : fx;
    fy = fy < 0 ? 0 : fy > FH - 1 ? FH - 1 : fy;
    return f[fy * FW + fx];
}

/** ワールド座標での値（双線形） */
function atSmooth(f: Float32Array, x: number, y: number): number {
    const fx = Math.min(FW - 1.001, Math.max(0, x / WPF - 0.5));
    const fy = Math.min(FH - 1.001, Math.max(0, y / WPF - 0.5));
    const xi = fx | 0;
    const yi = fy | 0;
    const tx = fx - xi;
    const ty = fy - yi;
    const i = yi * FW + xi;
    const a = f[i] + (f[i + 1] - f[i]) * tx;
    const c = f[i + FW] + (f[i + FW + 1] - f[i + FW]) * tx;
    return a + (c - a) * ty;
}

/** 場の値（0〜1）を、指定色・不透明度＝値の小さな Canvas にする（拡大して重ねる・切り抜く用） */
function fieldCanvas(f: Float32Array, color: string, gain: number, max = 1): HTMLCanvasElement {
    const c = createCanvas(FW, FH);
    const g = context(c);
    const img = g.createImageData(FW, FH);
    const { r, g: gg, b } = parseHex(color);
    const d = img.data;
    for (let i = 0; i < N; i++) {
        const o = i * 4;
        d[o] = r;
        d[o + 1] = gg;
        d[o + 2] = b;
        d[o + 3] = Math.min(max, f[i] * gain) * 255;
    }
    g.putImageData(img, 0, 0);
    return c;
}

// ===========================================================================
// 本番解像度での描画
// ===========================================================================

function paintGround(ctx: Ctx, tex: number): void {
    // 場は焼き終えたら捨てる（約 6MB の配列を常駐させない。地面を焼くのは起動時の 1 回だけ）
    const fields = buildFields();
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';

    // 1. 下塗り：場の色を 2 段階で拡大（双線形補間を 2 回かけて格子のひし形模様を消す。'high' 補間は重いので使わない）
    const small = createCanvas(FW, FH);
    const sctx = context(small);
    const img = sctx.createImageData(FW, FH);
    img.data.set(fields.color);
    sctx.putImageData(img, 0, 0);
    ctx.drawImage(upscale2(small), 0, 0, W, H);

    // 2. 模様：草の葉（全面に敷いて草の重みで切り抜く）
    drawGrassPattern(ctx, fields, tex, W, H);

    // 3. 筆致（ワールド座標で描く）
    ctx.setTransform(tex, 0, 0, tex, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    drawPaving(ctx, fields);
    drawPaddies(ctx, tex);
    drawRoadDetail(ctx, fields);
    drawYardDetail(ctx);
    drawWaterDetail(ctx, fields);
    drawForestFloor(ctx, fields);
    drawGrassEdges(ctx, fields);
    drawTreeBases(ctx);

    // 4. 物の根元の陰（AO）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // 敷地の内側は上限で止める（建物の絵に透けた所があっても真っ黒にならないように）
    ctx.drawImage(upscale2(fieldCanvas(fields.ao, PALETTE.shadow, 0.5, 0.31)), 0, 0, W, H);
    ctx.restore();
}

/** 2 倍に拡大した Canvas（2 段階拡大の途中） */
function upscale2(src: HTMLCanvasElement): HTMLCanvasElement {
    const c = createCanvas(src.width * 2, src.height * 2);
    const g = context(c);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'low';
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
}

/** 色ごとにまとめて描くための入れ物 */
class Batch {
    private readonly lists = new Map<string, number[]>();
    private list(color: string): number[] {
        let l = this.lists.get(color);
        if (!l) this.lists.set(color, (l = []));
        return l;
    }
    line(color: string, x0: number, y0: number, x1: number, y1: number): void {
        const l = this.list(color);
        l.push(x0, y0, x1, y1);
    }
    rect(color: string, x: number, y: number, w: number, h: number): void {
        const l = this.list(color);
        l.push(x, y, w, h);
    }
    ellipse(color: string, x: number, y: number, rx: number, ry: number, rot: number): void {
        const l = this.list(color);
        l.push(x, y, rx, ry, rot);
    }
    strokeLines(ctx: Ctx, width: number): void {
        ctx.lineWidth = width;
        for (const [color, l] of this.lists) {
            ctx.strokeStyle = color;
            ctx.beginPath();
            for (let i = 0; i < l.length; i += 4) {
                ctx.moveTo(l[i], l[i + 1]);
                ctx.lineTo(l[i + 2], l[i + 3]);
            }
            ctx.stroke();
        }
        this.lists.clear();
    }
    fillRects(ctx: Ctx): void {
        for (const [color, l] of this.lists) {
            ctx.fillStyle = color;
            ctx.beginPath();
            for (let i = 0; i < l.length; i += 4) ctx.rect(l[i], l[i + 1], l[i + 2], l[i + 3]);
            ctx.fill();
        }
        this.lists.clear();
    }
    fillEllipses(ctx: Ctx): void {
        for (const [color, l] of this.lists) {
            ctx.fillStyle = color;
            ctx.beginPath();
            for (let i = 0; i < l.length; i += 5) {
                ctx.moveTo(l[i] + l[i + 2] * Math.cos(l[i + 4]), l[i + 1] + l[i + 2] * Math.sin(l[i + 4]));
                ctx.ellipse(l[i], l[i + 1], l[i + 2], l[i + 3], l[i + 4], 0, Math.PI * 2);
            }
            ctx.fill();
        }
        this.lists.clear();
    }
}

function addRoundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

const tile = (x: number, y: number): TileChar | null => tileAt(Math.floor(x / T), Math.floor(y / T));

/** 1 次元のなめらかなノイズ（-0.5〜0.5） */
function n1d(x: number, seed: number): number {
    const i = Math.floor(x);
    const t = x - i;
    const u = t * t * (3 - 2 * t);
    return hash2(i, seed, 7) * (1 - u) + hash2(i + 1, seed, 7) * u - 0.5;
}

// ---------------------------------------------------------------------------
// 草の葉：繰り返し模様（周期 40 と 58 ワールド px の 2 枚を重ねて、繰り返しを目立たなくする）
// ---------------------------------------------------------------------------

const GRASS_BLADES = [
    withAlpha(shade(P.grassDark, -0.25), 0.5),
    withAlpha(P.grassDark, 0.55),
    withAlpha(mix(P.grassDark, P.grass, 0.6), 0.5),
    withAlpha(mix(P.grass, P.grassLight, 0.5), 0.5),
    withAlpha(mix(P.grassLight, '#c8cc92', 0.3), 0.45),
    withAlpha(mix(P.grassDry, '#cfc794', 0.25), 0.4),
];
/** 色の出やすさ（暗い葉を多めにして、明るい葉先は少なめ） */
const GRASS_WEIGHTS = [0.2, 0.24, 0.2, 0.2, 0.1, 0.06];

function pickWeighted(r: number, weights: number[]): number {
    let acc = 0;
    for (let i = 0; i < weights.length; i++) {
        acc += weights[i];
        if (r < acc) return i;
    }
    return weights.length - 1;
}

function grassTile(size: number, tex: number, seed: number, density: number): HTMLCanvasElement {
    const px = Math.max(8, Math.round(size * tex));
    const c = createCanvas(px, px);
    const g = context(c);
    g.scale(px / size, px / size);
    g.lineCap = 'round';
    const rand = rng(seed);
    const b = new Batch();
    const n = Math.round(size * size * density);
    for (let i = 0; i < n; i++) {
        const x = rand() * size;
        const y = rand() * size;
        const h = 1.0 + rand() * 1.8;
        const lean = (rand() - 0.4) * 1.0;
        const col = GRASS_BLADES[pickWeighted(rand(), GRASS_WEIGHTS)];
        // 端をまたぐ葉は反対側にも描いて、継ぎ目なくつながるように
        for (const ox of [-size, 0, size]) {
            for (const oy of [-size, 0, size]) {
                const x0 = x + ox;
                const y0 = y + oy;
                if (x0 + 1.5 < 0 || x0 - 1.5 > size || y0 + 0.5 < 0 || y0 - h - 0.5 > size) continue;
                b.line(col, x0, y0, x0 + lean, y0 - h);
            }
        }
    }
    b.strokeLines(g, 0.42);
    return c;
}

function drawGrassPattern(ctx: Ctx, f: Fields, tex: number, W: number, H: number): void {
    const layer = createCanvas(W, H);
    const g = context(layer);
    for (const [size, seed, density] of [[40, 11, 0.2], [58, 29, 0.13]] as const) {
        const pat = g.createPattern(grassTile(size, tex, seed, density), 'repeat');
        if (!pat) continue;
        g.fillStyle = pat;
        g.fillRect(0, 0, W, H);
    }
    // 草の重みで切り抜く（道・水・石畳・田には残らない。境目は柔らかく薄れる）
    g.globalCompositeOperation = 'destination-in';
    g.imageSmoothingEnabled = true;
    g.drawImage(upscale2(fieldCanvas(f.grass, '#000000', 1.15)), 0, 0, W, H);
    ctx.drawImage(layer, 0, 0);
}

/** 道や庭の縁から伸びる草（境目をぎざぎざに崩す）。模様では出せない、はっきりした葉を少しだけ。 */
function drawGrassEdges(ctx: Ctx, f: Fields): void {
    const rand = rng(809);
    const cols = [
        shade(P.grassDark, -0.15),
        P.grassDark,
        mix(P.grassDark, P.grass, 0.55),
        mix(P.grass, '#7a8458', 0.3),
        mix(P.grass, P.grassLight, 0.45),
    ];
    const dryC = [mix(P.grassDry, P.dirtDark, 0.3), mix(P.grassDry, '#b8b07c', 0.3)];
    const b = new Batch();
    const step = 2.2;
    for (let y = 0; y < MAP_PIXEL_HEIGHT; y += step) {
        for (let x = 0; x < MAP_PIXEL_WIDTH; x += step) {
            const px = x + rand() * step;
            const py = y + rand() * step;
            const w = at(f.grass, px, py);
            if (w < 0.1 || w > 0.9) continue;
            if (rand() > (1 - Math.abs(w - 0.5) * 2) * 0.9) continue;
            const t = at(f.grassTone, px, py);
            const h = 1.1 + rand() * 1.8;
            const lean = (rand() - 0.42) * 1.2;
            const col = rand() < at(f.dry, px, py) * 0.6 ? dryC[Math.floor(rand() * 2)] : cols[Math.max(0, Math.min(4, Math.floor((t * 0.8 + rand() * 0.6 - 0.1) * 5)))];
            b.line(col, px, py, px + lean, py - h);
            if (rand() < 0.4) b.line(col, px + 0.5, py + 0.2, px + 0.5 + lean * 0.6 + 0.3, py - h * 0.7);
        }
    }
    b.strokeLines(ctx, 0.42);
}

// ---------------------------------------------------------------------------
// 石畳（城内）：行ごとに長さの違う切石。色の差は控えめに、門から天守への通り道は踏まれて明るい。
// ---------------------------------------------------------------------------

function drawPaving(ctx: Ctx, f: Fields): void {
    const rand = rng(211);
    const isPave = (c: TileChar | null) => c === '=' || c === 'G';
    const coverOk = (c: TileChar | null) => c === '=' || c === 'G' || c === '#' || c === 'K';
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    let gateSum = 0, gateN = 0;
    for (let ty = 0; ty < MAP_HEIGHT; ty++) {
        for (let tx = 0; tx < MAP_WIDTH; tx++) {
            const c = tileAt(tx, ty);
            if (c === 'G') {
                gateSum += tx * T + T / 2;
                gateN++;
            }
            if (!isPave(c)) continue;
            x0 = Math.min(x0, tx * T);
            x1 = Math.max(x1, tx * T + T);
            y0 = Math.min(y0, ty * T);
            y1 = Math.max(y1, ty * T + T);
        }
    }
    if (x0 === Infinity) return;
    const gateMid = gateN ? gateSum / gateN : (x0 + x1) / 2;
    const tones = [
        mix(P.stone, P.stoneDark, 0.34),
        mix(P.stone, P.stoneDark, 0.22),
        mix(P.stone, P.stoneDark, 0.11),
        P.stone,
        mix(P.stone, P.stoneLight, 0.2),
        mix(P.stone, '#a99e86', 0.45),
        mix(P.stone, '#90958c', 0.45),
    ];
    const fills = new Batch();
    const edges = new Batch();
    const specks = new Batch();
    const cracks = new Batch();
    const moss = new Batch();
    const hiC = withAlpha(P.stoneLight, 0.24);
    const loC = withAlpha(shade(P.stoneDark, -0.3), 0.26);
    const mossC = withAlpha(mix(P.grassDark, P.stoneDark, 0.3), 0.5);
    const crackC = withAlpha(shade(P.stoneDark, -0.3), 0.35);
    const green = (c: TileChar | null) => c === 'T' || c === 'b' || c === '.';

    // 行の高さを変え、ところどころ 2 行分の大きな石を置いて、横に通る目地を途切れさせる
    const rows: { y: number; h: number; taken: [number, number][] }[] = [];
    for (let y = y0 - rand() * 4; y < y1; ) {
        const h = 6.5 + rand() * 3.5;
        rows.push({ y, h, taken: [] });
        y += h;
    }
    const slab = (sx: number, sy: number, w: number, h: number) => {
        const cx = sx + w / 2;
        const cy = sy + h / 2;
        const ok =
            isPave(tile(cx, cy)) &&
            coverOk(tile(sx + 0.6, sy + 0.6)) && coverOk(tile(sx + w - 0.6, sy + 0.6)) &&
            coverOk(tile(sx + 0.6, sy + h - 0.6)) && coverOk(tile(sx + w - 0.6, sy + h - 0.6));
        if (!ok) return;
        const g = 0.26 + rand() * 0.1;
        const x = sx + g;
        const y = sy + g;
        const sw = w - 2 * g - rand() * 0.2;
        const sh = h - 2 * g - rand() * 0.2;
        const large = at(f.grassTone, cx, cy) - 0.5;
        const onPath = Math.abs(cx - gateMid) < 26;
        let ti = 1 + Math.floor(rand() * 3) + (large > 0.15 ? 1 : large < -0.15 ? -1 : 0) + (onPath ? 1 : 0);
        if (rand() < 0.14) ti = 5 + Math.floor(rand() * 2);
        ti = Math.max(0, Math.min(tones.length - 1, ti));
        fills.rect(tones[ti], x, y, sw, sh);
        // 面取り：上の縁はわずかに明るく、下と右の縁はわずかに暗く
        edges.rect(hiC, x, y, sw, 0.32);
        edges.rect(loC, x + 0.3, y + sh - 0.34, sw - 0.3, 0.34);
        edges.rect(withAlpha(shade(P.stoneDark, -0.3), 0.16), x + sw - 0.32, y + 0.3, 0.32, sh - 0.64);
        const ns = Math.floor(rand() * 3);
        for (let k = 0; k < ns; k++) {
            const d = rand() < 0.55;
            const s = 0.28 + rand() * 0.22;
            specks.rect(withAlpha(d ? P.stoneDark : P.stoneLight, d ? 0.3 : 0.35), x + 0.8 + rand() * (sw - 1.6), y + 0.8 + rand() * (sh - 1.6), s, s * 0.8);
        }
        if (rand() < 0.08) cracks.line(crackC, x + rand() * sw, y + (rand() < 0.5 ? 0.3 : sh - 0.3), x + rand() * sw, y + sh / 2 + (rand() - 0.5) * sh * 0.6);
        // 目地ぎわの苔（植え込みの近くほど多い）
        const nearGreen = green(tile(cx, cy + T * 0.8)) || green(tile(cx, cy - T * 0.8)) || green(tile(cx + T * 0.8, cy)) || green(tile(cx - T * 0.8, cy));
        if (rand() < (nearGreen ? 0.6 : 0.05)) {
            for (let k = 0; k < 3; k++) {
                const onBottom = rand() < 0.6;
                moss.ellipse(mossC, onBottom ? x + rand() * sw : x + (rand() < 0.5 ? 0.2 : sw - 0.2), onBottom ? y + sh - 0.1 : y + rand() * sh, 0.5 + rand() * 0.7, 0.25 + rand() * 0.2, rand() * 0.4);
            }
        }
    };
    rows.forEach((row, r) => {
        let x = x0 - rand() * 14;
        let ti = 0;
        while (x < x1) {
            // 上の行から伸びてきた大きな石を避ける
            while (ti < row.taken.length && row.taken[ti][1] <= x + 0.01) ti++;
            if (ti < row.taken.length && row.taken[ti][0] <= x + 0.01) {
                x = row.taken[ti][1];
                continue;
            }
            let w = rand() < 0.18 ? 15 + rand() * 8 : 8.5 + rand() * 8;
            if (ti < row.taken.length && x + w > row.taken[ti][0]) {
                w = row.taken[ti][0] - x;
                if (w < 3.5) {
                    x = row.taken[ti][1];
                    continue;
                }
            }
            let h = row.h;
            const next = rows[r + 1];
            if (next && w < 15 && rand() < 0.2) {
                h += next.h;
                next.taken.push([x, x + w]);
            }
            slab(x, row.y, w, h);
            x += w;
        }
    });
    fills.fillRects(ctx);
    edges.fillRects(ctx);
    specks.fillRects(ctx);
    cracks.strokeLines(ctx, 0.18);
    moss.fillEllipses(ctx);
}

// ---------------------------------------------------------------------------
// 田：畦で区切った水田。濁った水面に空が映り、苗が整然と並ぶ（苗の映り込みつき）。
// ---------------------------------------------------------------------------

/** 苗の模様：4×4 株（1 株 3.5 ワールド px 間隔）。株の位置を少しずらして機械的に見えないように。 */
const SEED_CELL = 3;
function seedlingTile(tex: number): HTMLCanvasElement {
    const size = SEED_CELL * 4;
    const px = Math.max(4, Math.round(size * tex));
    const c = createCanvas(px, px);
    const g = context(c);
    g.scale(px / size, px / size);
    g.lineCap = 'round';
    const rand = rng(331);
    const refl = new Batch();
    const dark = new Batch();
    const light = new Batch();
    for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
            const x = (i + 0.5) * SEED_CELL + (rand() - 0.5) * 0.35;
            const y = (j + 0.72) * SEED_CELL + (rand() - 0.5) * 0.25;
            refl.line(withAlpha('#2f3d2c', 0.4), x - 0.15, y + 0.35, x + (rand() - 0.5) * 0.4, y + 1.0);
            for (let k = 0; k < 5; k++) {
                const a = -Math.PI / 2 + (k - 2) * 0.33 + (rand() - 0.5) * 0.2;
                const len = 1.3 + rand() * 0.7;
                const lit = k === 1 || k === 2;
                (lit ? light : dark).line(lit ? '#93ae5c' : '#5f7f3d', x, y, x + Math.cos(a) * len, y + Math.sin(a) * len);
            }
        }
    }
    refl.strokeLines(g, 0.42);
    dark.strokeLines(g, 0.34);
    light.strokeLines(g, 0.3);
    return c;
}

function drawPaddies(ctx: Ctx, tex: number): void {
    const rand = rng(307);
    const ridgeTop = withAlpha(mix(P.grassLight, P.dirtLight, 0.4), 0.4);
    const ridgeLow = withAlpha(shade(P.dirtDark, -0.4), 0.4);
    const sky = mix(mix(P.waterLight, P.mud, 0.2), '#c9cab2', 0.35);
    const midW = mix(P.mud, P.water, 0.35);
    const mud = shade(mix(P.mud, P.water, 0.2), -0.18);
    const seedPattern = ctx.createPattern(seedlingTile(tex), 'repeat');
    const ridgeGrass = new Batch();
    const streaks = new Batch();
    const grassCols = ['#5b7a3c', '#6e8b46', '#4a6634', '#7f9851'];
    for (const g of paddyRects()) {
        const X = g.tx * T;
        const Y = g.ty * T;
        const Wd = g.tw * T;
        const Hd = g.th * T;
        const nx = Math.max(1, Math.round(g.tw / 2.6));
        const ny = Math.max(1, Math.round(g.th / 3));
        const outer = 2.2;
        const inner = 1.9;
        const pw = (Wd - outer * 2 - inner * (nx - 1)) / nx;
        const ph = (Hd - outer * 2 - inner * (ny - 1)) / ny;
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const px = X + outer + i * (pw + inner);
                const py = Y + outer + j * (ph + inner);
                // 区画の中が 'f' のときだけ水を張る
                if (tile(px + 1, py + 1) !== 'f' || tile(px + pw - 1, py + ph - 1) !== 'f') continue;
                // 水面：左上に空の映り込み、右下は泥で暗い
                const grad = ctx.createLinearGradient(px, py, px + pw * 0.45, py + ph);
                grad.addColorStop(0, sky);
                grad.addColorStop(0.45, midW);
                grad.addColorStop(1, mud);
                ctx.fillStyle = grad;
                ctx.beginPath();
                addRoundRect(ctx, px, py, pw, ph, 1.1);
                ctx.fill();
                // 風の筋（映り込みがゆるく揺れる）
                for (let k = 0; k < 3; k++) {
                    const yy = py + 2 + rand() * (ph - 4);
                    const xx = px + 1 + rand() * pw * 0.5;
                    streaks.line(withAlpha('#d7dccd', 0.12 + rand() * 0.08), xx, yy, Math.min(px + pw - 1, xx + 4 + rand() * pw * 0.4), yy + (rand() - 0.5) * 0.3);
                }
                // 苗（模様の原点を区画にそろえる。模様は Canvas px 単位なので変換を一時的に外す）
                if (seedPattern) {
                    const cols = Math.floor((pw - 0.6) / SEED_CELL);
                    const rows = Math.floor((ph - 0.6) / SEED_CELL);
                    ctx.save();
                    ctx.setTransform(1, 0, 0, 1, Math.round((px + (pw - cols * SEED_CELL) / 2) * tex), Math.round((py + (ph - rows * SEED_CELL) / 2) * tex));
                    ctx.fillStyle = seedPattern;
                    ctx.fillRect(0, 0, Math.round(cols * SEED_CELL * tex), Math.round(rows * SEED_CELL * tex));
                    ctx.restore();
                }
                // 畦の影が水面に落ちる（上と左の縁）
                const sh1 = ctx.createLinearGradient(px, py, px, py + 2.4);
                sh1.addColorStop(0, withAlpha(P.shadow, 0.3));
                sh1.addColorStop(1, withAlpha(P.shadow, 0));
                ctx.fillStyle = sh1;
                ctx.fillRect(px, py, pw, 2.4);
                const sh2 = ctx.createLinearGradient(px, py, px + 2, py);
                sh2.addColorStop(0, withAlpha(P.shadow, 0.24));
                sh2.addColorStop(1, withAlpha(P.shadow, 0));
                ctx.fillStyle = sh2;
                ctx.fillRect(px, py, 2, ph);
            }
        }
        // 畦の上面の明るさ（左上）と外側の陰（右下）
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = ridgeTop;
        ctx.beginPath();
        ctx.moveTo(X + 1.4, Y + 0.7);
        ctx.lineTo(X + Wd - 1.4, Y + 0.7);
        ctx.moveTo(X + 0.7, Y + 1.4);
        ctx.lineTo(X + 0.7, Y + Hd - 1.4);
        for (let j = 1; j < ny; j++) {
            const yy = Y + outer + j * (ph + inner) - inner + 0.45;
            ctx.moveTo(X + 1, yy);
            ctx.lineTo(X + Wd - 1, yy);
        }
        for (let i = 1; i < nx; i++) {
            const xx = X + outer + i * (pw + inner) - inner + 0.45;
            ctx.moveTo(xx, Y + 1);
            ctx.lineTo(xx, Y + Hd - 1);
        }
        ctx.stroke();
        ctx.strokeStyle = ridgeLow;
        ctx.beginPath();
        ctx.moveTo(X + 1.4, Y + Hd - 0.4);
        ctx.lineTo(X + Wd - 1.4, Y + Hd - 0.4);
        ctx.moveTo(X + Wd - 0.4, Y + 1.4);
        ctx.lineTo(X + Wd - 0.4, Y + Hd - 1.4);
        ctx.stroke();
        // 畦の草（外周に多め）
        const perim = 2 * (Wd + Hd);
        for (let k = 0; k < perim / 1.4; k++) {
            const along = rand() * perim;
            let x: number, y: number;
            if (along < Wd) { x = X + along; y = Y + 0.4 + rand() * 1.5; }
            else if (along < Wd * 2) { x = X + along - Wd; y = Y + Hd - 0.3 - rand() * 1.5; }
            else if (along < Wd * 2 + Hd) { x = X + 0.4 + rand() * 1.5; y = Y + along - Wd * 2; }
            else { x = X + Wd - 0.4 - rand() * 1.5; y = Y + along - Wd * 2 - Hd; }
            const len = 0.9 + rand() * 1.3;
            const a = -Math.PI / 2 + (rand() - 0.5) * 1.1;
            ridgeGrass.line(grassCols[Math.floor(rand() * grassCols.length)], x, y + 0.5, x + Math.cos(a) * len, y + 0.5 + Math.sin(a) * len);
        }
    }
    streaks.strokeLines(ctx, 0.5);
    ridgeGrass.strokeLines(ctx, 0.36);
}

// ---------------------------------------------------------------------------
// 土の道：浅い轍、踏まれて明るい筋、小石、土の粒
// ---------------------------------------------------------------------------

function runLength(tx: number, ty: number, dx: number, dy: number): [number, number] {
    let a = 0;
    while (isRoadChar(tileAt(tx - dx * (a + 1), ty - dy * (a + 1)))) a++;
    let b = 0;
    while (isRoadChar(tileAt(tx + dx * (b + 1), ty + dy * (b + 1)))) b++;
    return [a, b];
}

function drawRoadDetail(ctx: Ctx, f: Fields): void {
    const rand = rng(401);
    const rutWide = new Batch();
    const rutCore = new Batch();
    const rutLip = new Batch();
    const streaks = new Batch();
    const rutC = shade(P.dirtDark, -0.2);
    for (let ty = 0; ty < MAP_HEIGHT; ty++) {
        for (let tx = 0; tx < MAP_WIDTH; tx++) {
            if (!isRoadChar(tileAt(tx, ty))) continue;
            const [hl, hr] = runLength(tx, ty, 1, 0);
            const [vu, vd] = runLength(tx, ty, 0, 1);
            const hRun = hl + hr + 1;
            const vRun = vu + vd + 1;
            let dir: 'h' | 'v' | null = null;
            if (hRun >= 6 && vRun <= 4) dir = 'h';
            else if (vRun >= 6 && hRun <= 4) dir = 'v';
            if (!dir) continue;
            const thick = dir === 'h' ? vRun : hRun;
            const start = dir === 'h' ? ty - vu : tx - hl;
            const center = (start + thick / 2) * T;
            const off = Math.min(7, thick * 8 - 5);
            // 轍：途切れながら続く、浅くやわらかい 2 本のくぼみ
            for (const side of [-1, 1]) {
                const seed = side > 0 ? 11 : 23;
                for (let k = 0; k < 2; k++) {
                    const a = (dir === 'h' ? tx : ty) * T + k * 8;
                    const b = a + 8;
                    const pres = n1d(a / 14, seed + 3);
                    if (pres < -0.25) continue;
                    const s = pres > 0.12 ? 1 : 0.65;
                    const wob = (p: number) => center + side * off + n1d(p / 16, seed) * 1.8;
                    const seg = (batch: Batch, color: string, d: number) => {
                        if (dir === 'h') batch.line(color, a, wob(a) + d, b, wob(b) + d);
                        else batch.line(color, wob(a) + d, a, wob(b) + d, b);
                    };
                    seg(rutWide, withAlpha(rutC, 0.07 * s), 0.2);
                    seg(rutCore, withAlpha(rutC, 0.1 * s), 0.35);
                    seg(rutLip, withAlpha(P.dirtLight, 0.14 * s), -1.2);
                }
            }
            // 踏まれて明るい筋
            for (let k = 0; k < 2; k++) {
                if (rand() < 0.35) continue;
                const along = (dir === 'h' ? tx : ty) * T + rand() * T;
                const across = center + (rand() - 0.5) * (thick * T - 10);
                const len = 4 + rand() * 7;
                const col = withAlpha(P.dirtLight, 0.1 + rand() * 0.1);
                if (dir === 'h') streaks.line(col, along, across, along + len, across + (rand() - 0.5) * 0.6);
                else streaks.line(col, across, along, across + (rand() - 0.5) * 0.6, along + len);
            }
        }
    }
    rutWide.strokeLines(ctx, 2.8);
    rutCore.strokeLines(ctx, 1.1);
    rutLip.strokeLines(ctx, 0.6);
    streaks.strokeLines(ctx, 0.7);

    // 小石と土の粒（道の縁ほど多い）
    const shadowB = new Batch();
    const bodyB = new Batch();
    const hiB = new Batch();
    const clods = new Batch();
    const stoneTones = [mix(P.stone, P.dirtDark, 0.3), P.stone, mix(P.stone, P.dirtLight, 0.4), mix(P.stoneDark, P.dirt, 0.3)];
    const shadowC = withAlpha(shade(P.dirtDark, -0.4), 0.38);
    const hiC = withAlpha(P.stoneLight, 0.65);
    const clodD = withAlpha(shade(P.dirtDark, -0.2), 0.26);
    const clodL = withAlpha(P.dirtLight, 0.3);
    for (let ty = 0; ty < MAP_HEIGHT; ty++) {
        for (let tx = 0; tx < MAP_WIDTH; tx++) {
            let near = isRoadChar(tileAt(tx, ty));
            if (!near) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isRoadChar(tileAt(tx + dx, ty + dy))) near = true;
            if (!near) continue;
            for (let k = 0; k < 5; k++) {
                const x = tx * T + rand() * T;
                const y = ty * T + rand() * T;
                if (at(f.road, x, y) < 0.55) continue;
                const edge = 1 - at(f.worn, x, y);
                if (rand() > 0.25 + edge * 0.5) continue;
                const rx = 0.32 + rand() * rand() * 0.8;
                const ry = rx * (0.6 + rand() * 0.25);
                const rot = (rand() - 0.5) * 0.8;
                shadowB.ellipse(shadowC, x + 0.22, y + 0.28, rx * 1.05, ry * 1.05, rot);
                bodyB.ellipse(stoneTones[Math.floor(rand() * stoneTones.length)], x, y, rx, ry, rot);
                if (rx > 0.5) hiB.rect(hiC, x - rx * 0.45, y - ry * 0.55, rx * 0.6, ry * 0.35);
            }
            for (let k = 0; k < 7; k++) {
                const x = tx * T + rand() * T;
                const y = ty * T + rand() * T;
                if (at(f.road, x, y) < 0.5) continue;
                const s = 0.3 + rand() * 0.4;
                clods.rect(rand() < 0.6 ? clodD : clodL, x, y, s, s * 0.7);
            }
        }
    }
    clods.fillRects(ctx);
    shadowB.fillEllipses(ctx);
    bodyB.fillEllipses(ctx);
    hiB.fillRects(ctx);
}

// ---------------------------------------------------------------------------
// 家のまわり：軒下の雨落ち（小石の帯）、井戸のまわりの敷石と湿り
// ---------------------------------------------------------------------------

function drawYardDetail(ctx: Ctx): void {
    const rand = rng(503);
    const pebbles = new Batch();
    const shadowB = new Batch();
    const tones = [P.stoneDark, P.stone, mix(P.stone, P.stoneLight, 0.5)];
    const sh = withAlpha(P.shadow, 0.22);
    for (let ty = 0; ty < MAP_HEIGHT; ty++) {
        for (let tx = 0; tx < MAP_WIDTH; tx++) {
            if (tileAt(tx, ty) !== 'W' || tileAt(tx, ty + 1) === 'W') continue;
            const y = ty * T + T;
            const xa = tx * T - (tileAt(tx - 1, ty) !== 'W' ? 2 : 0);
            const xb = tx * T + T + (tileAt(tx + 1, ty) !== 'W' ? 2 : 0);
            for (let k = 0; k < 20; k++) {
                const x = xa + rand() * (xb - xa);
                const yy = y + 0.8 + rand() * 2.2;
                const s = 0.4 + rand() * 0.5;
                shadowB.rect(sh, x + 0.15, yy + 0.2, s, s * 0.7);
                pebbles.rect(tones[Math.floor(rand() * 3)], x, yy, s, s * 0.7);
            }
        }
    }
    shadowB.fillRects(ctx);
    pebbles.fillRects(ctx);

    // 井戸：こぼれ水で湿った土と、まわりの平たい敷石
    const flag = new Batch();
    const flagHi = new Batch();
    const flagSh = new Batch();
    for (let ty = 0; ty < MAP_HEIGHT; ty++) {
        for (let tx = 0; tx < MAP_WIDTH; tx++) {
            if (tileAt(tx, ty) !== 'o') continue;
            const cx = tx * T + T / 2;
            const cy = ty * T + T - 3;
            const g = ctx.createRadialGradient(cx + 2, cy + 1, 0, cx + 2, cy + 1, 13);
            g.addColorStop(0, withAlpha(shade(P.dirtDark, -0.35), 0.32));
            g.addColorStop(1, withAlpha(shade(P.dirtDark, -0.35), 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(cx + 2, cy + 1, 13, 8, 0, 0, Math.PI * 2);
            ctx.fill();
            for (let k = 0; k < 7; k++) {
                const a = -0.3 + (k / 7) * Math.PI * 2 + rand() * 0.3;
                if (Math.sin(a) < -0.5) continue; // 井戸の奥は隠れる
                const x = cx + Math.cos(a) * (11 + rand() * 1.5);
                const y = cy + Math.sin(a) * (6.5 + rand() * 1);
                const rx = 1.8 + rand() * 1;
                const ry = rx * 0.62;
                const rot = (rand() - 0.5) * 0.5;
                flagSh.ellipse(withAlpha(P.shadow, 0.32), x + 0.3, y + 0.4, rx, ry, rot);
                flag.ellipse(rand() < 0.5 ? mix(P.stone, P.stoneDark, 0.3) : P.stone, x, y, rx, ry, rot);
                flagHi.ellipse(withAlpha(P.stoneLight, 0.45), x - 0.4, y - 0.3, rx * 0.6, ry * 0.45, rot);
            }
        }
    }
    flagSh.fillEllipses(ctx);
    flag.fillEllipses(ctx);
    flagHi.fillEllipses(ctx);
}

// ---------------------------------------------------------------------------
// 水：岸の石（半分水に浸かる）、葦、流れの筋
// ---------------------------------------------------------------------------

function drawWaterDetail(ctx: Ctx, f: Fields): void {
    const rand = rng(601);
    const isWater = (c: TileChar | null) => c === '~' || c === 'B';
    const nearBridge = (tx: number, ty: number) => {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tileAt(tx + dx, ty + dy) === 'B') return true;
        return false;
    };
    const shadowB = new Batch();
    const bodyB = new Batch();
    const hiB = new Batch();
    const reeds = new Batch();
    const tones = [mix(P.stoneDark, P.mud, 0.35), P.stoneDark, mix(P.stone, P.stoneDark, 0.4), mix(P.stone, P.mud, 0.2)];
    const wetC = withAlpha(shade(P.mud, -0.5), 0.42);
    const hiC = withAlpha(P.stoneLight, 0.5);
    const reedCols = ['#5b6b39', '#6f7b44', '#87864f', '#4c5e34'];
    for (let ty = 0; ty < MAP_HEIGHT; ty++) {
        for (let tx = 0; tx < MAP_WIDTH; tx++) {
            if (tileAt(tx, ty) !== '~') continue;
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nc = tileAt(tx + dx, ty + dy);
                if (nc === null || isWater(nc) || nc === '#' || nc === 'T') continue;
                if (nearBridge(tx + dx, ty + dy)) continue;
                // 辺に沿って石を置き、実際の水際（場の境界）へ寄せる
                for (let t = rand() * 2.5; t < T; t += 2.2 + rand() * 2.4) {
                    if (rand() < 0.2) continue;
                    let x = tx * T + (dx === 0 ? t : dx > 0 ? T : 0);
                    let y = ty * T + (dy === 0 ? t : dy > 0 ? T : 0);
                    let best = 0;
                    let bestD = 9;
                    for (let s = -3; s <= 3; s += 0.75) {
                        const v = Math.abs(atSmooth(f.water, x + dx * s, y + dy * s) - 0.5);
                        if (v < bestD) {
                            bestD = v;
                            best = s;
                        }
                    }
                    const into = best + (rand() * 1.6 - 0.5);
                    x += dx * into + (dx === 0 ? 0 : (rand() - 0.5) * 0.6);
                    y += dy * into + (dy === 0 ? 0 : (rand() - 0.5) * 0.6);
                    const rx = 0.6 + rand() * rand() * 1.4;
                    const ry = rx * (0.55 + rand() * 0.2);
                    const rot = (rand() - 0.5) * 0.6;
                    // 下半分が濡れて暗い（水に浸かっている）
                    shadowB.ellipse(wetC, x + 0.25, y + ry * 0.3, rx * 1.08, ry * 0.85, rot);
                    bodyB.ellipse(tones[Math.floor(rand() * tones.length)], x, y - 0.15, rx, ry * 0.9, rot);
                    if (rx > 0.8) hiB.ellipse(hiC, x - rx * 0.3, y - ry * 0.5, rx * 0.45, ry * 0.28, rot);
                }
                // 葦（草地側、ところどころ）
                if ((nc === '.' || nc === 'b') && rand() < 0.3) {
                    const t = 3 + rand() * 10;
                    const bx = tx * T + (dx === 0 ? t : dx > 0 ? T + 1.5 : -1.5);
                    const by = ty * T + (dy === 0 ? t : dy > 0 ? T + 1.5 : -1.5);
                    for (let k = 0; k < 7; k++) {
                        const x = bx + (rand() - 0.5) * 2.4;
                        const y = by + (rand() - 0.5) * 1.2;
                        const len = 2.5 + rand() * 2.5;
                        reeds.line(reedCols[Math.floor(rand() * reedCols.length)], x, y, x + (rand() - 0.4) * 1.4, y - len);
                    }
                }
            }
        }
    }
    shadowB.fillEllipses(ctx);
    bodyB.fillEllipses(ctx);
    hiB.fillEllipses(ctx);
    reeds.strokeLines(ctx, 0.32);

    // 流れの筋（川は縦、堀は横）と、岸寄りの細い明るい反射
    const flow = new Batch();
    for (let ty = 0; ty < MAP_HEIGHT; ty++) {
        for (let tx = 0; tx < MAP_WIDTH; tx++) {
            if (tileAt(tx, ty) !== '~') continue;
            const river = isWater(tileAt(tx, ty - 1)) && isWater(tileAt(tx, ty + 1)) && !(isWater(tileAt(tx - 1, ty)) && isWater(tileAt(tx + 1, ty)));
            for (let k = 0; k < 3; k++) {
                const x = tx * T + rand() * T;
                const y = ty * T + rand() * T;
                const w = atSmooth(f.water, x, y);
                if (w < 0.6) continue;
                const edge = w < 0.9;
                const len = (edge ? 1.5 : 4) + rand() * (edge ? 2.5 : 8);
                const col = withAlpha(P.waterLight, edge ? 0.2 : 0.07 + rand() * 0.05);
                if (river) flow.line(col, x, y, x + (rand() - 0.5) * 0.4, y + len);
                else flow.line(col, x, y, x + len, y + (rand() - 0.5) * 0.3);
            }
        }
    }
    flow.strokeLines(ctx, 0.4);
}

// ---------------------------------------------------------------------------
// 林床（木の下・林の縁）：落ち葉や松葉、苔。外周の林の奥は樹冠で隠れるので描かない。
// ---------------------------------------------------------------------------

function drawForestFloor(ctx: Ctx, f: Fields): void {
    const rand = rng(701);
    const b = new Batch();
    const cols = [mix(P.bark, P.dirt, 0.4), mix(P.bark, P.grassDry, 0.5), shade(P.bark, -0.2), mix(P.grassDark, P.leafDark, 0.5), mix(P.leaf, P.grass, 0.5)];
    const step = 2.4;
    for (let y = 0; y < MAP_PIXEL_HEIGHT; y += step) {
        const ty = Math.floor(y / T);
        for (let x = 0; x < MAP_PIXEL_WIDTH; x += step) {
            const tx = Math.floor(x / T);
            // 外周の林は下端の列（幹の間から地面が見える）だけ
            if (isBorder(tx, ty) && ty !== MAP_HEIGHT - 1) continue;
            const px = x + rand() * step;
            const py = y + rand() * step;
            const w = at(f.forest, px, py);
            if (w < 0.3 || rand() > w) continue;
            const a = rand() * Math.PI;
            const len = 0.7 + rand() * 0.9;
            b.line(cols[Math.floor(rand() * cols.length)], px, py, px + Math.cos(a) * len, py + Math.sin(a) * len * 0.7);
        }
    }
    b.strokeLines(ctx, 0.32);
}

// ---------------------------------------------------------------------------
// 木の根元の陰と、樹冠の下のうす暗さ（木は上に描かれる）
// ---------------------------------------------------------------------------

function drawTreeBases(ctx: Ctx): void {
    for (let ty = 0; ty < MAP_HEIGHT; ty++) {
        for (let tx = 0; tx < MAP_WIDTH; tx++) {
            if (tileAt(tx, ty) !== 'T') continue;
            const x = tx * T + 8;
            const y = ty * T + 14;
            if (!isBorder(tx, ty)) soft(ctx, x + 2, y - 3, 17, 10, 0.16);
            soft(ctx, x + 0.5, y, 7, 3, 0.3);
        }
    }
}

function soft(ctx: Ctx, x: number, y: number, rx: number, ry: number, alpha: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, withAlpha(P.shadow, alpha));
    g.addColorStop(0.6, withAlpha(P.shadow, alpha * 0.5));
    g.addColorStop(1, withAlpha(P.shadow, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}
