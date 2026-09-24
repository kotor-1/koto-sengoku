/**
 * 人物（主人公「若殿」・家臣「源蔵」）の高解像度の仮素材。8 方向 × (待機 + 歩行 8 コマ)。
 *
 * 手法：小さな「3D 人形」を Canvas 2D で描く。
 *  - 体の部品（足袋・袴・小袖・腕・頭・髷・刀・鎧の板・槍）を、3D に置いた
 *    「楕円の輪を並べた筒（ロフト）」「楕円体」「楕円体の表面の一部（顔など）」「板」で作る。
 *  - 向き（8 方向）に合わせて鉛直軸で回し、斜め上からの正射影（奥行きを縮める）で画面に落とす。
 *  - 部品は奥行き順（奥 → 手前）に描く。同じ人形を回すので 8 方向の見た目が揃い、斜めも自然。
 *  - 陰影は光の向き（spec の LIGHT_DIR：左上手前）と部品の法線から計算し、グラデーションで塗る。
 *    明部は暖色、暗部は寒色寄り（黒は使わない）。漆・鉄・髪にはつや。
 *  - 手前の部品は、すでに描いた奥の部品へ柔らかい影を落とす（腕 → 胴、頭 → 襟 など）。
 *  - 袖・袴のように 1 枚の布でできた部分は、部品の境目に線が出ないようまとめて描く。
 *  - 最後に足元を少し暗く（接地感）、シルエットの外側に暗い藍灰の細い輪郭をつける。
 *  - 乱数は使わない（毎回同じ絵）。clip や filter は使わない（古い Safari でも同じ見た目・軽さ）。
 *    テクスチャは読み込み時に 1 回だけ描く。
 */
import { CHARACTER, DIRECTIONS, LIGHT_DIR, PALETTE, WALK_FRAMES } from './spec';
import { createCanvas, context, type ArtPiece, type Ctx } from './canvas';

export type CharacterStyle = 'hero' | 'retainer';

export function characterFrameName(dir: number, walkFrame: number | null): string {
    return walkFrame === null ? `d${dir}-idle` : `d${dir}-w${walkFrame}`;
}

/**
 * アトラス 1 枚：行 = 方向（0〜7）、列 = 0:待機, 1〜8:歩行。
 * 家臣は歩かないので待機だけ（列 1 つ）。
 */
export function characterAtlas(style: CharacterStyle, key: string, tex: number): ArtPiece {
    const fw = Math.ceil(CHARACTER.w * tex);
    const fh = Math.ceil(CHARACTER.h * tex);
    const cols = style === 'hero' ? 1 + WALK_FRAMES : 1;
    const frames: NonNullable<ArtPiece['frames']> = [];
    for (let d = 0; d < DIRECTIONS; d++) {
        for (let c = 0; c < cols; c++) {
            frames.push({ name: characterFrameName(d, c === 0 ? null : c - 1), x: c * fw, y: d * fh, w: fw, h: fh });
        }
    }
    return {
        key,
        spec: CHARACTER,
        width: fw * cols,
        height: fh * DIRECTIONS,
        frames,
        draw: (ctx) => {
            for (const f of frames) {
                const m = /^d(\d)-(idle|w(\d))$/.exec(f.name)!;
                const dir = Number(m[1]);
                const walk = m[3] === undefined ? null : Number(m[3]) / WALK_FRAMES;
                ctx.save();
                ctx.translate(f.x, f.y);
                drawCharacterFrame(ctx, style, dir, walk, tex);
                ctx.restore();
            }
            scratchSet = null;
        },
    };
}

/** 1 コマ描く。(0,0)〜(CHARACTER.w*s, CHARACTER.h*s) の範囲。足元は (w/2, h*oy)。 */
export function drawCharacterFrame(ctx: Ctx, style: CharacterStyle, dir: number, walkPhase: number | null, s: number): void {
    const fw = Math.ceil(CHARACTER.w * s);
    const fh = Math.ceil(CHARACTER.h * s);
    const foot = CHARACTER.h * CHARACTER.oy * s;
    // 真横の向き（右・左）は、少しだけカメラの方へ体を向ける（顔と胸が見えて読みやすい）
    const turn = ((style === 'hero' ? 12 : 22) * Math.PI) / 180;
    const rig = new Rig(s, dir, fw / 2, foot, dir === 2 ? turn : dir === 6 ? -turn : 0);
    if (style === 'hero') buildHero(rig, walkPhase);
    else buildRetainer(rig);

    // コマからはみ出しそうなら（手前へ踏み出した足など）、頭の上の余白の範囲で少しだけ持ち上げる
    const bottom = (CHARACTER.h - 0.4) * s;
    const top = 0.35 * s;
    let lift = 0;
    if (rig.maxY > bottom) lift = Math.max(0, Math.min(rig.maxY - bottom, rig.minY - top));
    rig.lift = lift;

    const { layer, tint } = scratch(fw, fh);
    const lctx = context(layer);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = 'source-over';
    lctx.globalAlpha = 1;
    lctx.clearRect(0, 0, fw, fh);
    lctx.translate(0, -lift);
    lctx.lineJoin = 'round';
    lctx.lineCap = 'round';
    const items = rig.items.slice().sort((a, b) => a.d - b.d || a.i - b.i);
    for (const it of items) it.draw(lctx);

    // 全体の明暗：頭の方はわずかに明るく、足元へ向かって暗く（接地感）
    lctx.globalCompositeOperation = 'source-atop';
    const ao = lctx.createLinearGradient(0, foot - 36 * s, 0, foot);
    ao.addColorStop(0, css(WARM, 0.07));
    ao.addColorStop(0.42, css(WARM, 0));
    ao.addColorStop(0.72, css(SHADE, 0.04));
    ao.addColorStop(1, css(SHADE, 0.3));
    lctx.fillStyle = ao;
    lctx.fillRect(0, 0, fw, fh + lift);
    lctx.globalCompositeOperation = 'source-over';
    lctx.setTransform(1, 0, 0, 1, 0, 0);

    // 縁の光：光の来る側（左上）の縁に暖かい光、反対側の縁にごく弱い空の照り返し
    const tctx = context(tint);
    edgeLight(lctx, tctx, layer, fw, fh, -LIGHT2[0] * 0.3 * s, -LIGHT2[1] * 0.3 * s, css(WARM), 0.34);
    edgeLight(lctx, tctx, layer, fw, fh, LIGHT2[0] * 0.25 * s, LIGHT2[1] * 0.25 * s, css([150, 170, 200]), 0.16);

    // シルエットの輪郭：塗った形を暗い色に染め、少しずらして 8 回重ねた上に本体を置く
    tctx.globalCompositeOperation = 'copy';
    tctx.drawImage(layer, 0, 0);
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = OUTLINE;
    tctx.fillRect(0, 0, fw, fh);
    tctx.globalCompositeOperation = 'source-over';
    const r = 0.27 * s;
    for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        // 影側（右下）をわずかに太く
        ctx.drawImage(tint, Math.cos(a) * r + 0.05 * s, Math.sin(a) * r + 0.06 * s);
    }
    ctx.drawImage(layer, 0, 0);
}

/**
 * シルエットの縁に光を足す。(dx, dy) だけずらした自分自身で削ると、反対側の縁だけが残る。
 * work は作業用（中身は上書きする）。
 */
function edgeLight(dst: Ctx, work: Ctx, layer: HTMLCanvasElement, fw: number, fh: number, dx: number, dy: number, color: string, alpha: number): void {
    work.globalCompositeOperation = 'copy';
    work.drawImage(layer, 0, 0);
    work.globalCompositeOperation = 'source-in';
    work.fillStyle = color;
    work.fillRect(0, 0, fw, fh);
    work.globalCompositeOperation = 'destination-out';
    work.drawImage(layer, dx, dy);
    work.globalCompositeOperation = 'source-over';
    dst.globalCompositeOperation = 'source-atop';
    dst.globalAlpha = alpha;
    dst.drawImage(work.canvas, 0, 0);
    dst.globalAlpha = 1;
    dst.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------------------
// 作業用 Canvas（コマごとに作らず使い回す）
// ---------------------------------------------------------------------------

let scratchSet: { layer: HTMLCanvasElement; tint: HTMLCanvasElement } | null = null;

function scratch(w: number, h: number): { layer: HTMLCanvasElement; tint: HTMLCanvasElement } {
    if (!scratchSet || scratchSet.layer.width !== w || scratchSet.layer.height !== h) {
        scratchSet = { layer: createCanvas(w, h), tint: createCanvas(w, h) };
    }
    return scratchSet;
}

// ---------------------------------------------------------------------------
// 小さなベクトル計算
// ---------------------------------------------------------------------------

type V3 = [number, number, number];
type P2 = [number, number];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function nrm(a: V3): V3 {
    const l = len(a);
    return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
}
/** 鉛直軸まわりの回転（+ で右が前へ出る） */
function rotZ(p: V3, a: number): V3 {
    if (a === 0) return p;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
}
/** 左右軸まわりの回転（+ で前が上がる） */
function rotX(p: V3, a: number): V3 {
    if (a === 0) return p;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
}
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number): number => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// 見る向き・光
// ---------------------------------------------------------------------------

/**
 * 地面の奥行き（南北）を画面の縦にどれだけ映すか。人物は約 27° 見下ろし（奥行きを半分に縮める）。
 * 画面 y = 奥行き*K − 高さ。高さは等倍（背の高さがそのまま映る）。
 */
const K = 0.5;
/** 世界座標（東, 南, 上）で「カメラのいる方」 */
const VIEW: V3 = nrm([0, 1, K]);
/** 画面の下向きに対応する、視線に垂直な 3D の向き */
const SDOWN: V3 = nrm([0, K, -1]);
/** 光の来る方：spec の LIGHT_DIR（画面の左上）に、少し手前（カメラ側）を足したもの */
const LIGHT: V3 = nrm(add(add(scl([1, 0, 0], LIGHT_DIR.x), scl(SDOWN, LIGHT_DIR.y)), scl(VIEW, 0.62)));
const HALF: V3 = nrm(add(LIGHT, VIEW));
/** 画面上で光の来る向き（2D, 単位） */
const LIGHT2: P2 = (() => {
    const x = LIGHT[0];
    const y = LIGHT[1] * K - LIGHT[2];
    const l = Math.hypot(x, y);
    return [x / l, y / l];
})();
/** 部品が奥の部品へ落とす影のずれ（ワールド px、画面の右下） */
const CAST: P2 = [-LIGHT2[0] * 0.42, -LIGHT2[1] * 0.42];

function dir3(dx: number, dy: number): V3 {
    return nrm(add(scl([1, 0, 0], dx), scl(SDOWN, dy)));
}

// ---------------------------------------------------------------------------
// 色
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

function hexRgb(h: string): RGB {
    const v = parseInt(h.replace('#', ''), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function mixRgb(a: RGB, b: RGB, t: number): RGB {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function css(c: RGB, a = 1): string {
    const r = Math.round(c[0]);
    const g = Math.round(c[1]);
    const b = Math.round(c[2]);
    return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

const WARM: RGB = [255, 238, 208];
const COOL: RGB = [40, 42, 66];
const INK: RGB = [30, 26, 36];
const SHADE: RGB = [30, 30, 52];
const OUTLINE = 'rgb(38,33,44)';
const GLOSS: RGB = [246, 244, 236];

/** 材質：基本色と、光の当たる側（暖）・影側（寒）の色 */
interface Mat {
    base: RGB;
    lit: RGB;
    shd: RGB;
    line: RGB;
    gloss: number;
    /** つやの鋭さ */
    sharp: number;
}

function mat(hex: string, o: { lit?: number; shd?: number; gloss?: number; sharp?: number; line?: number } = {}): Mat {
    const base = hexRgb(hex);
    return {
        base,
        lit: mixRgb(base, WARM, o.lit ?? 0.3),
        shd: mixRgb(base, COOL, o.shd ?? 0.42),
        line: mixRgb(base, INK, o.line ?? 0.6),
        gloss: o.gloss ?? 0,
        sharp: o.sharp ?? 16,
    };
}

/** 法線 n（世界座標）の面の色。明暗の境目を少しだけ締めた「塗り」らしい陰影。 */
function shadeAt(m: Mat, n: V3): RGB {
    const t = dot(n, LIGHT) * 0.5 + 0.5;
    const k = smooth(0.3, 0.7, t) * 0.62 + t * 0.38;
    let c = k < 0.5 ? mixRgb(m.shd, m.base, k / 0.5) : mixRgb(m.base, m.lit, (k - 0.5) / 0.5);
    if (m.gloss > 0) {
        const h = Math.max(0, dot(n, HALF));
        c = mixRgb(c, GLOSS, Math.min(0.85, Math.pow(h, m.sharp) * m.gloss));
    }
    return c;
}

/** 横断方向の陰影の色の数（少ないほど軽い。6 で十分なめらか） */
const STOPS = 6;

// 材質一覧
const SKIN = mat(PALETTE.skin, { lit: 0.22, shd: 0.34, line: 0.48 });
const SKIN_OLD = mat('#d6aa84', { lit: 0.2, shd: 0.36, line: 0.5 });
const HAIR = mat(PALETTE.hair, { lit: 0.1, shd: 0.2, gloss: 0.34, sharp: 14, line: 0.3 });
const KOSODE = mat(PALETTE.indigo, { lit: 0.27, shd: 0.36 });
const KOSODE_IN = mat(PALETTE.indigoDark, { lit: 0.05, shd: 0.3 });
const COLLAR = mat(PALETTE.indigoDark, { lit: 0.2, shd: 0.3 });
const JUBAN = mat('#ddd6c6', { lit: 0.25, shd: 0.3 });
const HAKAMA = mat('#4e4a47', { lit: 0.28, shd: 0.38 });
const HIMO = mat('#8a7852', { lit: 0.3, shd: 0.4 });
const TABI = mat('#e2dccd', { lit: 0.3, shd: 0.28 });
const ZORI = mat('#a88f62', { lit: 0.25, shd: 0.4 });
const LACQUER = mat('#2e2826', { lit: 0.16, shd: 0.25, gloss: 0.7, sharp: 12, line: 0.35 });
const TSUKA = mat('#2c2a31', { lit: 0.16, shd: 0.2, line: 0.3 });
const IRON = mat('#4b4a4b', { lit: 0.25, shd: 0.3, gloss: 0.5, sharp: 12, line: 0.45 });
const GOLD = mat(PALETTE.gold, { lit: 0.35, shd: 0.45, gloss: 0.6, sharp: 10, line: 0.55 });
const CORD = mat('#e4dccb', { lit: 0.3, shd: 0.3 });
// 家臣
const ODOSHI = mat('#80392f', { lit: 0.22, shd: 0.42 });
const PLATE = mat('#2f2a2a', { lit: 0.18, shd: 0.25, gloss: 0.55, sharp: 12, line: 0.35 });
const KABUTO = mat('#3a393d', { lit: 0.24, shd: 0.3, gloss: 0.65, sharp: 10, line: 0.4 });
const HAKAMA2 = mat('#5f5647', { lit: 0.26, shd: 0.4 });
const KOTE = mat('#363a47', { lit: 0.22, shd: 0.3, line: 0.4 });
const SHIN = mat('#3c3b3e', { lit: 0.24, shd: 0.28, gloss: 0.45, sharp: 10, line: 0.35 });
const BELT = mat('#3f3934', { lit: 0.25, shd: 0.35 });
const DARK_TABI = mat('#5a564d', { lit: 0.25, shd: 0.35 });
const WARAJI = mat('#9d8a60', { lit: 0.25, shd: 0.4 });
const SHAFT = mat('#4a3426', { lit: 0.22, shd: 0.3, gloss: 0.4, sharp: 10, line: 0.45 });
const STEEL = mat('#b9bec3', { lit: 0.35, shd: 0.35, gloss: 0.9, sharp: 8, line: 0.55 });
const BEARD = mat('#3b3430', { lit: 0.12, shd: 0.2, line: 0.3 });

// ---------------------------------------------------------------------------
// 人形の座標系と描画項目
// ---------------------------------------------------------------------------

interface Item {
    d: number;
    i: number;
    draw(ctx: Ctx): void;
}

/**
 * 1 コマ分の人形。
 * 人形の座標（右, 前, 上）は、向きに合わせて世界座標（東, 南, 上）へ回し、画面に落とす。
 * 原点は足元（コマの基準点）。単位はワールド px。
 */
class Rig {
    readonly items: Item[] = [];
    readonly fx: number;
    readonly fy: number;
    minY = Infinity;
    maxY = -Infinity;
    /** はみ出し防止で全体を持ち上げる量（Canvas px）。描く直前に決まる。 */
    lift = 0;

    constructor(
        readonly s: number,
        readonly dir: number,
        readonly ox: number,
        readonly oy: number,
        /** 向きの補正（ラジアン。+ で画面の手前側＝南へ回る） */
        turn = 0,
    ) {
        const a = Math.PI / 2 - dir * (Math.PI / 4) + turn;
        this.fx = Math.cos(a);
        this.fy = Math.sin(a);
    }

    /** 人形 → 世界（点にもベクトルにも使える。原点は同じ） */
    w(p: V3): V3 {
        return [-p[0] * this.fy + p[1] * this.fx, p[0] * this.fx + p[1] * this.fy, p[2]];
    }

    /** 世界 → 人形 */
    m(w: V3): V3 {
        return [-w[0] * this.fy + w[1] * this.fx, w[0] * this.fx + w[1] * this.fy, w[2]];
    }

    /** 世界 → 画面（Canvas px） */
    p(w: V3): P2 {
        return [this.ox + w[0] * this.s, this.oy + (w[1] * K - w[2]) * this.s];
    }

    /** 世界の向き → 画面の向き（px, 長さつき） */
    pv(v: V3): P2 {
        return [v[0] * this.s, (v[1] * K - v[2]) * this.s];
    }

    /** 奥行き（大きいほど手前） */
    depth(w: V3): number {
        return w[1] + w[2] * K;
    }

    /** 人形の点の奥行き */
    depthM(p: V3): number {
        return this.depth(this.w(p));
    }

    track(pts: P2[]): void {
        for (const q of pts) {
            if (q[1] < this.minY) this.minY = q[1];
            if (q[1] > this.maxY) this.maxY = q[1];
        }
    }

    push(d: number, draw: (ctx: Ctx) => void): void {
        this.items.push({ d, i: this.items.length, draw });
    }
}

// ---------------------------------------------------------------------------
// 2D の小道具
// ---------------------------------------------------------------------------

function hull(pts: P2[]): P2[] {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cr = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower: P2[] = [];
    for (const q of p) {
        while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
        lower.push(q);
    }
    const upper: P2[] = [];
    for (let i = p.length - 1; i >= 0; i--) {
        const q = p[i];
        while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
        upper.push(q);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
}

/** 点列を通る閉じた滑らかな形（角を中点の二次曲線で丸める） */
function smoothPath(ctx: Ctx, pts: P2[], dx = 0, dy = 0): void {
    const n = pts.length;
    ctx.beginPath();
    if (n < 3) return;
    ctx.moveTo((pts[n - 1][0] + pts[0][0]) / 2 + dx, (pts[n - 1][1] + pts[0][1]) / 2 + dy);
    for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[i + 1 < n ? i + 1 : 0];
        ctx.quadraticCurveTo(a[0] + dx, a[1] + dy, (a[0] + b[0]) / 2 + dx, (a[1] + b[1]) / 2 + dy);
    }
    ctx.closePath();
}

function polyPath(ctx: Ctx, pts: P2[], dx = 0, dy = 0): void {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
        if (i === 0) ctx.moveTo(pts[i][0] + dx, pts[i][1] + dy);
        else ctx.lineTo(pts[i][0] + dx, pts[i][1] + dy);
    }
    ctx.closePath();
}

function lerpP(a: P2, b: P2, t: number): P2 {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// ---------------------------------------------------------------------------
// 形（Shape）：影を落とす・輪郭・塗り・細部を、単独でもまとめてでも描けるようにする
// ---------------------------------------------------------------------------

interface Shape {
    /** 奥行き */
    d: number;
    /** 輪郭のパス（dx, dy だけずらせる：影を落とすとき） */
    path(ctx: Ctx, dx?: number, dy?: number): void;
    /** 塗り（grad を渡すとその色で塗る。まとめて同じ陰影にしたいとき） */
    paint(ctx: Ctx, grad?: CanvasGradient): void;
    /** この形の陰影（まとめて塗るときに使う） */
    gradient(ctx: Ctx): CanvasGradient;
    line: number;
    lineRGB: RGB;
    cast: number;
    detail?: (ctx: Ctx) => void;
}

interface PartOpt {
    /** 奥行きの補正（+ で手前に描く） */
    bias?: number;
    /** 奥行きを直接指定 */
    depth?: number;
    /** 輪郭線の濃さ（0 で描かない） */
    line?: number;
    /** 奥の部品へ落とす影の濃さ */
    cast?: number;
}

/**
 * 形を右下へずらして、すでに描いた部分にだけ影を落とす（source-atop なので背景には出ない）。
 * soft のときは 2 段にずらして縁を柔らかくする（頭・腕など目立つところだけ）。
 */
function castShadow(ctx: Ctx, s: number, sh: Shape): void {
    const alpha = sh.cast;
    if (alpha <= 0) return;
    const soft = alpha >= SOFT_CAST;
    const dx = CAST[0] * s * 0.6;
    const dy = CAST[1] * s * 0.6;
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = css(SHADE, soft ? alpha * 0.55 : alpha * 0.8);
    sh.path(ctx, dx, dy);
    ctx.fill();
    if (soft) {
        sh.path(ctx, dx * 2, dy * 2);
        ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
}

/** これ以上の濃さの影は 2 段で柔らかく落とす */
const SOFT_CAST = 0.24;

/** 1 つの形を描く */
function drawShape(ctx: Ctx, s: number, sh: Shape): void {
    castShadow(ctx, s, sh);
    sh.path(ctx);
    sh.paint(ctx);
    if (sh.line > 0) {
        sh.path(ctx);
        ctx.strokeStyle = css(sh.lineRGB, sh.line);
        ctx.lineWidth = 0.2 * s;
        ctx.stroke();
    }
    sh.detail?.(ctx);
}

/**
 * 1 枚の布のように、いくつかの形をまとめて描く：先に全部の輪郭（太め）、次に全部の塗り。
 * こうすると外周にだけ線が残り、部品の継ぎ目に線が出ない。shared を渡すと同じ陰影で塗る。
 */
function group(rig: Rig, shapes: Shape[], o: { depth?: number; shared?: Shape } = {}): void {
    const s = rig.s;
    const list = shapes.slice().sort((a, b) => a.d - b.d);
    const d = o.depth ?? list.reduce((m, x) => Math.max(m, x.d), -Infinity);
    rig.push(d, (ctx) => {
        for (const sh of list) castShadow(ctx, s, sh);
        for (const sh of list) {
            if (sh.line <= 0) continue;
            sh.path(ctx);
            ctx.strokeStyle = css(sh.lineRGB, sh.line);
            ctx.lineWidth = 0.4 * s;
            ctx.stroke();
        }
        const shared = o.shared?.gradient(ctx);
        for (const sh of list) {
            sh.path(ctx);
            sh.paint(ctx, shared);
        }
        for (const sh of list) sh.detail?.(ctx);
    });
}

function single(rig: Rig, sh: Shape): void {
    rig.push(sh.d, (ctx) => drawShape(ctx, rig.s, sh));
}

// ---------------------------------------------------------------------------
// 部品 1：ロフト（楕円の輪を並べた筒）
// ---------------------------------------------------------------------------

/** 輪：中心と 2 本の半径ベクトル（u = 右向き, v = 前向き を想定）。人形の座標。 */
interface Ring {
    c: V3;
    u: V3;
    v: V3;
    /** 表面の点を探すための高さの値（任意） */
    z?: number;
}

interface LoftOpt extends PartOpt {
    /** 始点側・終点側の明るさ補正（- 暗く / + 明るく） */
    tone?: [number, number];
    /** 形の上に細部を描く */
    detail?: (ctx: Ctx, g: LoftGeo) => void;
    /** 輪の分割数 */
    seg?: number;
}

class LoftGeo {
    readonly wr: { c: V3; u: V3; v: V3; z: number }[];
    readonly hull: P2[];
    readonly axis: V3;

    constructor(
        readonly rig: Rig,
        rings: Ring[],
        seg: number,
    ) {
        this.wr = rings.map((r, i) => ({ c: rig.w(r.c), u: rig.w(r.u), v: rig.w(r.v), z: r.z ?? i }));
        const pts: P2[] = [];
        for (const r of this.wr) {
            for (let k = 0; k < seg; k++) {
                const a = (k / seg) * TAU;
                const ca = Math.cos(a);
                const sa = Math.sin(a);
                pts.push(rig.p([r.c[0] + r.u[0] * ca + r.v[0] * sa, r.c[1] + r.u[1] * ca + r.v[1] * sa, r.c[2] + r.u[2] * ca + r.v[2] * sa]));
            }
        }
        this.hull = hull(pts);
        rig.track(this.hull);
        this.axis = nrm(sub(this.wr[this.wr.length - 1].c, this.wr[0].c));
    }

    /** 高さの値 z（輪の z を線形に補間）と角度 θ（0=右, 90°=前）の表面の点と法線（世界） */
    at(z: number, thetaDeg: number): { p: V3; n: V3 } {
        const r = this.wr;
        let i = 0;
        const asc = r[r.length - 1].z >= r[0].z;
        while (i < r.length - 2 && (asc ? z > r[i + 1].z : z < r[i + 1].z)) i++;
        const a = r[i];
        const b = r[i + 1];
        const t = b.z === a.z ? 0 : (z - a.z) / (b.z - a.z);
        const c = lerp3(a.c, b.c, t);
        const u = lerp3(a.u, b.u, t);
        const v = lerp3(a.v, b.v, t);
        const th = (thetaDeg * Math.PI) / 180;
        const p = add(c, add(scl(u, Math.cos(th)), scl(v, Math.sin(th))));
        const lu = len(u) || 1;
        const lv = len(v) || 1;
        const n = nrm(add(scl(u, Math.cos(th) / (lu * lu)), scl(v, Math.sin(th) / (lv * lv))));
        return { p, n };
    }

    ends(): [P2, P2] {
        return [this.rig.p(this.wr[0].c), this.rig.p(this.wr[this.wr.length - 1].c)];
    }

    /** 軸に垂直な横断方向の陰影グラデーション */
    gradient(ctx: Ctx, m: Mat): CanvasGradient {
        const rig = this.rig;
        const [A, B] = this.ends();
        let dx = B[0] - A[0];
        let dy = B[1] - A[1];
        const dl = Math.hypot(dx, dy);
        let nx: number;
        let ny: number;
        if (dl < 0.6 * rig.s) {
            // 軸がほぼこちらを向いている → 光の向きに沿って塗る
            nx = -LIGHT2[0];
            ny = -LIGHT2[1];
        } else {
            dx /= dl;
            dy /= dl;
            nx = -dy;
            ny = dx;
            // 光の側から始める
            if (nx * LIGHT2[0] + ny * LIGHT2[1] > 0) {
                nx = -nx;
                ny = -ny;
            }
        }
        const mx = (A[0] + B[0]) / 2;
        const my = (A[1] + B[1]) / 2;
        let e = 0.5;
        for (const q of this.hull) e = Math.max(e, Math.abs((q[0] - mx) * nx + (q[1] - my) * ny));
        const g = ctx.createLinearGradient(mx - nx * e, my - ny * e, mx + nx * e, my + ny * e);
        const stops = e < 2.2 * rig.s ? 3 : STOPS;
        // 3D：横断方向 P（画面で光の側）と、こちら向き Q
        let P = dir3(-nx, -ny);
        P = nrm(sub(P, scl(this.axis, dot(P, this.axis))));
        let Q = sub(VIEW, scl(this.axis, dot(VIEW, this.axis)));
        Q = len(Q) < 1e-3 ? VIEW : nrm(Q);
        for (let j = 0; j < stops; j++) {
            const u = (1 - (2 * j) / (stops - 1)) * 0.96;
            const n = nrm(add(scl(P, u), scl(Q, Math.sqrt(1 - u * u))));
            g.addColorStop(j / (stops - 1), css(shadeAt(m, n)));
        }
        return g;
    }
}

function loftShape(rig: Rig, rings: Ring[], m: Mat, o: LoftOpt = {}): Shape & { geo: LoftGeo } {
    const g = new LoftGeo(rig, rings, o.seg ?? 16);
    let d = 0;
    for (const r of g.wr) d += rig.depth(r.c);
    d = o.depth ?? d / g.wr.length + (o.bias ?? 0);
    return {
        geo: g,
        d,
        path: (ctx, dx, dy) => smoothPath(ctx, g.hull, dx, dy),
        gradient: (ctx) => g.gradient(ctx, m),
        paint: (ctx, grad) => {
            ctx.fillStyle = grad ?? g.gradient(ctx, m);
            ctx.fill();
            if (o.tone) {
                const [A, B] = g.ends();
                const tg = ctx.createLinearGradient(A[0], A[1], B[0], B[1]);
                const stop = (t: number, v: number) => tg.addColorStop(t, v >= 0 ? css(WARM, v) : css(SHADE, -v));
                stop(0, o.tone[0]);
                stop(1, o.tone[1]);
                ctx.fillStyle = tg;
                ctx.fill();
            }
        },
        line: o.line ?? 0.8,
        lineRGB: m.line,
        cast: o.cast ?? 0.22,
        detail: o.detail ? (ctx) => o.detail!(ctx, g) : undefined,
    };
}

function loft(rig: Rig, rings: Ring[], m: Mat, o: LoftOpt = {}): LoftGeo {
    const sh = loftShape(rig, rings, m, o);
    single(rig, sh);
    return sh.geo;
}

type TubeOpt = LoftOpt & { side?: V3; flat?: number };

/** 2 点を結ぶ筒の輪。side は断面の「横」の向き（人形の座標）。flat は横に対する縦の半径の比。 */
function tubeRings(A: V3, B: V3, rA: number, rB: number, o: TubeOpt): Ring[] {
    const ax = nrm(sub(B, A));
    let side = o.side ?? [1, 0, 0];
    let U = sub(side, scl(ax, dot(side, ax)));
    if (len(U) < 1e-3) {
        side = [0, 1, 0];
        U = sub(side, scl(ax, dot(side, ax)));
    }
    U = nrm(U);
    let V = cross(ax, U);
    // V は「前（+y）か上（+z）」寄りにそろえる
    if (V[1] + V[2] * 0.3 < 0) V = scl(V, -1);
    const f = o.flat ?? 1;
    return [
        { c: A, u: scl(U, rA), v: scl(V, rA * f), z: 0 },
        { c: B, u: scl(U, rB), v: scl(V, rB * f), z: 1 },
    ];
}

function tubeShape(rig: Rig, A: V3, B: V3, rA: number, rB: number, m: Mat, o: TubeOpt = {}): Shape & { geo: LoftGeo } {
    return loftShape(rig, tubeRings(A, B, rA, rB, o), m, { seg: Math.max(rA, rB) < 0.7 ? 10 : 12, ...o });
}

function tube(rig: Rig, A: V3, B: V3, rA: number, rB: number, m: Mat, o: TubeOpt = {}): LoftGeo {
    const sh = tubeShape(rig, A, B, rA, rB, m, o);
    single(rig, sh);
    return sh.geo;
}

/**
 * 帯：2 つの輪の間の、角度 th0〜th1 の範囲の面（兜の錣・眉庇、胴の板など）。
 * 奥行きは面の中心。裏側（内側）が見えるときは暗く塗る。
 */
function band(
    rig: Rig,
    r0: Ring,
    r1: Ring,
    th0: number,
    th1: number,
    m: Mat,
    o: PartOpt & { detail?: (ctx: Ctx, at: (t: number, th: number) => { p: V3; n: V3 }) => void } = {},
): void {
    const w0 = { c: rig.w(r0.c), u: rig.w(r0.u), v: rig.w(r0.v) };
    const w1 = { c: rig.w(r1.c), u: rig.w(r1.u), v: rig.w(r1.v) };
    const at = (t: number, th: number): { p: V3; n: V3 } => {
        const a = (th * Math.PI) / 180;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const c = lerp3(w0.c, w1.c, t);
        const u = lerp3(w0.u, w1.u, t);
        const v = lerp3(w0.v, w1.v, t);
        const p = add(c, add(scl(u, ca), scl(v, sa)));
        const tan = add(scl(u, -sa), scl(v, ca));
        const p0 = add(w0.c, add(scl(w0.u, ca), scl(w0.v, sa)));
        const p1 = add(w1.c, add(scl(w1.u, ca), scl(w1.v, sa)));
        let n = nrm(cross(sub(p1, p0), tan));
        if (dot(n, sub(p, c)) < 0) n = scl(n, -1);
        return { p, n };
    };
    const steps = Math.max(2, Math.ceil(Math.abs(th1 - th0) / 10));
    const pts: P2[] = [];
    for (let k = 0; k <= steps; k++) pts.push(rig.p(at(0, th0 + ((th1 - th0) * k) / steps).p));
    for (let k = steps; k >= 0; k--) pts.push(rig.p(at(1, th0 + ((th1 - th0) * k) / steps).p));
    rig.track(pts);
    const mid = at(0.5, (th0 + th1) / 2);
    const face = (n: V3) => (dot(n, VIEW) < 0 ? mixRgb(shadeAt(m, scl(n, -1)), m.shd, 0.65) : shadeAt(m, n));
    single(rig, {
        d: o.depth ?? rig.depth(mid.p) + (o.bias ?? 0),
        path: (ctx, dx, dy) => polyPath(ctx, pts, dx, dy),
        gradient: (ctx) => {
            const P0 = rig.p(at(0.5, th0).p);
            const P1 = rig.p(at(0.5, th1).p);
            const g = ctx.createLinearGradient(P0[0], P0[1], P1[0], P1[1]);
            g.addColorStop(0, css(face(at(0.5, th0).n)));
            g.addColorStop(0.5, css(face(mid.n)));
            g.addColorStop(1, css(face(at(0.5, th1).n)));
            return g;
        },
        paint(ctx, grad) {
            ctx.fillStyle = grad ?? this.gradient(ctx);
            ctx.fill();
        },
        line: o.line ?? 0.8,
        lineRGB: m.line,
        cast: o.cast ?? 0.18,
        detail: o.detail ? (ctx) => o.detail!(ctx, at) : undefined,
    });
}

// ---------------------------------------------------------------------------
// 部品 2：楕円体と、その表面の一部（顔など）
// ---------------------------------------------------------------------------

class EllGeo {
    /** 世界座標の中心と 3 軸（長さ = 半径）。軸 0=右, 1=前, 2=上 */
    readonly c: V3;
    readonly a: [V3, V3, V3];
    readonly sc: P2;
    readonly ra: number;
    readonly rb: number;
    readonly rot: number;
    /** 単位球の上で「見えている側」を表すベクトル */
    readonly wv: V3;
    /** 光の向きに沿った広がり（px） */
    readonly ext: number;

    constructor(
        readonly rig: Rig,
        C: V3,
        axes: [V3, V3, V3],
    ) {
        this.c = rig.w(C);
        this.a = [rig.w(axes[0]), rig.w(axes[1]), rig.w(axes[2])];
        this.sc = rig.p(this.c);
        const j = this.a.map((v) => rig.pv(v));
        let p = 0;
        let q = 0;
        let r = 0;
        for (const v of j) {
            p += v[0] * v[0];
            q += v[0] * v[1];
            r += v[1] * v[1];
        }
        const tr = (p + r) / 2;
        const disc = Math.sqrt(Math.max(0, tr * tr - (p * r - q * q)));
        this.ra = Math.sqrt(tr + disc);
        this.rb = Math.sqrt(Math.max(1e-6, tr - disc));
        this.rot = 0.5 * Math.atan2(2 * q, p - r);
        this.wv = this.a.map((v) => dot(v, VIEW) / Math.max(1e-6, dot(v, v))) as V3;
        this.ext = Math.sqrt(LIGHT2[0] * LIGHT2[0] * p + 2 * LIGHT2[0] * LIGHT2[1] * q + LIGHT2[1] * LIGHT2[1] * r);
        rig.track([
            [this.sc[0], this.sc[1] - Math.sqrt(r)],
            [this.sc[0], this.sc[1] + Math.sqrt(r)],
        ]);
    }

    /** 単位球の点 u → 世界の点 */
    at(u: V3): V3 {
        return add(this.c, add(add(scl(this.a[0], u[0]), scl(this.a[1], u[1])), scl(this.a[2], u[2])));
    }

    /** 単位球の点 u の法線（世界） */
    normal(u: V3): V3 {
        const inv = (v: V3) => scl(v, 1 / Math.max(1e-6, dot(v, v)));
        return nrm(add(add(scl(inv(this.a[0]), u[0]), scl(inv(this.a[1]), u[1])), scl(inv(this.a[2]), u[2])));
    }

    path(ctx: Ctx, dx = 0, dy = 0): void {
        ctx.beginPath();
        ctx.ellipse(this.sc[0] + dx, this.sc[1] + dy, this.ra, this.rb, this.rot, 0, TAU);
    }

    /** 光の向きに沿った陰影 */
    gradient(ctx: Ctx, m: Mat): CanvasGradient {
        const e = this.ext;
        const [lx, ly] = LIGHT2;
        const g = ctx.createLinearGradient(this.sc[0] + lx * e, this.sc[1] + ly * e, this.sc[0] - lx * e, this.sc[1] - ly * e);
        const D = dir3(lx, ly);
        const stops = e < 2.2 * this.rig.s ? 3 : STOPS;
        for (let j = 0; j < stops; j++) {
            const u = (1 - (2 * j) / (stops - 1)) * 0.96;
            const n = nrm(add(scl(D, u), scl(VIEW, Math.sqrt(1 - u * u))));
            g.addColorStop(j / (stops - 1), css(shadeAt(m, n)));
        }
        return g;
    }

    /** 丸みを出す：縁（特に影側）を少し暗く。いまのパスをもう一度塗る（切り抜き不要）。 */
    rim(ctx: Ctx, strength: number): void {
        const cr = Math.cos(this.rot);
        const sr = Math.sin(this.rot);
        ctx.setTransform(cr * this.ra, sr * this.ra, -sr * this.rb, cr * this.rb, this.sc[0], this.sc[1] - this.rig.lift);
        const c = Math.cos(-this.rot);
        const s = Math.sin(-this.rot);
        const hx = ((LIGHT2[0] * c - LIGHT2[1] * s) * 0.32 * this.ext) / this.ra;
        const hy = ((LIGHT2[0] * s + LIGHT2[1] * c) * 0.32 * this.ext) / this.rb;
        const g = ctx.createRadialGradient(hx, hy, 0, 0, 0, 1.02);
        g.addColorStop(0, css(WARM, 0.1 * strength));
        g.addColorStop(0.6, css(SHADE, 0));
        g.addColorStop(1, css(SHADE, 0.28 * strength));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.setTransform(1, 0, 0, 1, 0, -this.rig.lift);
    }
}

/** 経度・緯度（度）→ 単位球。経度 0 = 前、+90 = 右。緯度 +90 = 上。 */
function sph(lon: number, lat: number): V3 {
    const lo = (lon * Math.PI) / 180;
    const la = (lat * Math.PI) / 180;
    return [Math.sin(lo) * Math.cos(la), Math.cos(lo) * Math.cos(la), Math.sin(la)];
}

/** 単位球上の多角形を「見えている半球」で切り取る（切り口は球の縁に沿わせる） */
function clipSphere(poly: V3[], w: V3): V3[] {
    const W = nrm(w);
    const out: V3[] = [];
    let exit: V3 | null = null;
    let firstEntry: V3 | null = null;
    let anyInside = false;
    const n = poly.length;
    const arc = (from: V3, to: V3) => {
        // 縁（W に垂直な大円）に沿って from → to（短い方）
        const ang = Math.acos(Math.max(-1, Math.min(1, dot(from, to))));
        const sn = Math.sin(ang);
        if (sn < 1e-4) return;
        const steps = Math.max(1, Math.ceil(ang / 0.15));
        for (let k = 1; k < steps; k++) {
            const t = k / steps;
            const q = nrm(add(scl(from, Math.sin((1 - t) * ang) / sn), scl(to, Math.sin(t * ang) / sn)));
            out.push(nrm(sub(q, scl(W, dot(q, W)))));
        }
    };
    for (let i = 0; i < n; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % n];
        const da = dot(a, W);
        const db = dot(b, W);
        if (da >= 0) {
            out.push(a);
            anyInside = true;
        }
        if (da >= 0 !== db >= 0) {
            const t = da / (da - db);
            let q = lerp3(a, b, t);
            q = nrm(sub(q, scl(W, dot(q, W))));
            if (da >= 0) {
                out.push(q);
                exit = q;
            } else {
                if (exit) arc(exit, q);
                else firstEntry = q;
                out.push(q);
                exit = null;
                anyInside = true;
            }
        }
    }
    if (exit && firstEntry) arc(exit, firstEntry);
    return anyInside ? out : [];
}

/** 経度・緯度（度）の多角形を細かく刻む */
function densify(poly: [number, number][], step = 8): V3[] {
    const out: V3[] = [];
    for (let i = 0; i < poly.length; i++) {
        const [lo0, la0] = poly[i];
        const [lo1, la1] = poly[(i + 1) % poly.length];
        const n = Math.max(1, Math.ceil(Math.max(Math.abs(lo1 - lo0), Math.abs(la1 - la0)) / step));
        for (let k = 0; k < n; k++) out.push(sph(lo0 + ((lo1 - lo0) * k) / n, la0 + ((la1 - la0) * k) / n));
    }
    return out;
}

interface EllOpt extends PartOpt {
    rim?: number;
    detail?: (ctx: Ctx, g: EllGeo) => void;
}

function ellShape(rig: Rig, C: V3, axes: [V3, V3, V3], m: Mat, o: EllOpt = {}): Shape & { geo: EllGeo } {
    const g = new EllGeo(rig, C, axes);
    return {
        geo: g,
        d: o.depth ?? rig.depth(g.c) + (o.bias ?? 0),
        path: (ctx, dx, dy) => g.path(ctx, dx, dy),
        gradient: (ctx) => g.gradient(ctx, m),
        paint: (ctx, grad) => {
            ctx.fillStyle = grad ?? g.gradient(ctx, m);
            ctx.fill();
            if ((o.rim ?? 1) > 0) g.rim(ctx, o.rim ?? 1);
        },
        line: o.line ?? 0.8,
        lineRGB: m.line,
        cast: o.cast ?? 0.2,
        detail: o.detail ? (ctx) => o.detail!(ctx, g) : undefined,
    };
}

function ellipsoid(rig: Rig, C: V3, axes: [V3, V3, V3], m: Mat, o: EllOpt = {}): EllGeo {
    const sh = ellShape(rig, C, axes, m, o);
    single(rig, sh);
    return sh.geo;
}

/** 楕円体 g の表面の一部（経度・緯度の多角形）を別の材質で塗る。見えない側は切り取る。 */
function patch(ctx: Ctx, g: EllGeo, poly: [number, number][], m: Mat, o: { line?: number; rim?: number } = {}): void {
    const u = clipSphere(densify(poly), g.wv);
    if (u.length < 3) return;
    const pts = u.map((q) => g.rig.p(g.at(q)));
    smoothPath(ctx, pts);
    ctx.fillStyle = g.gradient(ctx, m);
    ctx.fill();
    if ((o.rim ?? 1) > 0) g.rim(ctx, o.rim ?? 1);
    if ((o.line ?? 0) > 0) {
        ctx.strokeStyle = css(m.line, o.line ?? 0);
        ctx.lineWidth = 0.16 * g.rig.s;
        ctx.stroke();
    }
}

/** 楕円体の表面の点（経度・緯度）と、横（経度方向）・縦（緯度方向）の接線、法線 */
function surfEll(g: EllGeo, lon: number, lat: number): { p: V3; n: V3; tl: V3; tt: V3; vis: number } {
    const u = sph(lon, lat);
    const p = g.at(u);
    const n = g.normal(u);
    const e = 0.5;
    const tl = nrm(sub(g.at(sph(lon + e, lat)), g.at(sph(lon - e, lat))));
    const tt = nrm(sub(g.at(sph(lon, lat + e)), g.at(sph(lon, lat - e))));
    return { p, n, tl, tt, vis: dot(n, VIEW) };
}

// ---------------------------------------------------------------------------
// 部品 3：平らな板
// ---------------------------------------------------------------------------

function plateShape(
    rig: Rig,
    pts: V3[],
    m: Mat,
    o: PartOpt & { detail?: (ctx: Ctx, sp: P2[], w: V3[]) => void; smooth?: boolean } = {},
): Shape {
    const w = pts.map((q) => rig.w(q));
    const sp = w.map((q) => rig.p(q));
    rig.track(sp);
    let n = nrm(cross(sub(w[1], w[0]), sub(w[2], w[0])));
    if (dot(n, VIEW) < 0) n = scl(n, -1);
    let c: V3 = [0, 0, 0];
    for (const q of w) c = add(c, q);
    c = scl(c, 1 / w.length);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const q of sp) {
        minY = Math.min(minY, q[1]);
        maxY = Math.max(maxY, q[1]);
    }
    const base = shadeAt(m, n);
    return {
        d: o.depth ?? rig.depth(c) + (o.bias ?? 0),
        path: (ctx, dx, dy) => (o.smooth ? smoothPath(ctx, sp, dx, dy) : polyPath(ctx, sp, dx, dy)),
        gradient: (ctx) => {
            const g = ctx.createLinearGradient(0, minY, 0, maxY);
            g.addColorStop(0, css(mixRgb(base, m.lit, 0.35)));
            g.addColorStop(1, css(mixRgb(base, m.shd, 0.35)));
            return g;
        },
        paint(ctx, grad) {
            ctx.fillStyle = grad ?? this.gradient(ctx);
            ctx.fill();
        },
        line: o.line ?? 0.8,
        lineRGB: m.line,
        cast: o.cast ?? 0.16,
        detail: o.detail ? (ctx) => o.detail!(ctx, sp, w) : undefined,
    };
}

function plate(rig: Rig, pts: V3[], m: Mat, o: PartOpt & { detail?: (ctx: Ctx, sp: P2[], w: V3[]) => void; smooth?: boolean } = {}): void {
    single(rig, plateShape(rig, pts, m, o));
}

// ---------------------------------------------------------------------------
// 表面の線・小物
// ---------------------------------------------------------------------------

type SP = { p: V3; n: V3 };

/** 表面の点列を線で結ぶ（見えている区間だけ）。何本でも 1 回の stroke で描く（軽くするため）。 */
function surfLines(ctx: Ctx, rig: Rig, lines: SP[][], color: string, width: number, minVis = 0.04): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const pts of lines) {
        let open = false;
        for (const q of pts) {
            if (dot(q.n, VIEW) <= minVis) {
                open = false;
                continue;
            }
            const s = rig.p(q.p);
            if (!open) ctx.moveTo(s[0], s[1]);
            else ctx.lineTo(s[0], s[1]);
            open = true;
        }
    }
    ctx.stroke();
}

function surfLine(ctx: Ctx, rig: Rig, pts: SP[], color: string, width: number, minVis = 0.04): void {
    surfLines(ctx, rig, [pts], color, width, minVis);
}

/** 輪の一周（z の高さ）の点列 */
function ringPts(g: LoftGeo, z: number, dz = 0): SP[] {
    const pts: SP[] = [];
    for (let th = 0; th <= 360; th += 15) {
        const q = g.at(z, th);
        pts.push(dz ? { p: add(q.p, [0, 0, dz]), n: q.n } : q);
    }
    return pts;
}

/**
 * 表面に貼った小さな円（家紋など）。tl・tt は表面の横・縦の向き。
 * radii に複数の半径を渡すと、交互に塗り抜いた輪（蛇の目）になる。
 */
function surfDot(ctx: Ctx, rig: Rig, p: V3, n: V3, tl: V3, tt: V3, radii: number[], color: string): void {
    const vis = dot(n, VIEW);
    if (vis < 0.12) return;
    const c = rig.p(p);
    ctx.globalAlpha = smooth(0.12, 0.4, vis);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const r of radii) {
        const a = rig.pv(scl(tl, r));
        const b = rig.pv(scl(tt, r));
        for (let k = 0; k <= 16; k++) {
            const t = (k / 16) * TAU;
            const x = c[0] + a[0] * Math.cos(t) + b[0] * Math.sin(t);
            const y = c[1] + a[1] * Math.cos(t) + b[1] * Math.sin(t);
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
    }
    ctx.fill('evenodd');
    ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// 歩き方
// ---------------------------------------------------------------------------

/**
 * 片足の運び。ph は 0〜1（0 = かかとが着く、0.5 = つま先が離れる）。
 * y：足の前後位置、lift：持ち上げ、pitch：つま先の上がり（ラジアン）。
 */
function gait(ph: number, a: number, liftH: number): { y: number; lift: number; pitch: number } {
    const p = ((ph % 1) + 1) % 1;
    if (p < 0.5) {
        const u = p / 0.5;
        const pitch = u < 0.18 ? 0.25 * (1 - u / 0.18) : u > 0.66 ? -0.6 * smooth(0.66, 1, u) : 0;
        return { y: a * (1 - 2 * u), lift: 0, pitch };
    }
    const u = (p - 0.5) / 0.5;
    const e = u * u * (3 - 2 * u);
    return { y: -a + 2 * a * e, lift: liftH * Math.pow(Math.sin(Math.PI * u), 0.85), pitch: -0.6 + 0.85 * smooth(0.1, 0.95, u) };
}

interface FootPose {
    ankle: V3;
    heel: V3;
    toe: V3;
}

/** 足首の位置と、つま先の上下・外向きから足の形を決める。地面にめり込まないよう持ち上げる。 */
function footPose(x: number, y: number, lift: number, pitch: number, yaw: number): FootPose {
    const ankle: V3 = [x, y, 1.25 + lift];
    const rot = (v: V3) => add(ankle, rotZ(rotX(v, pitch), yaw));
    let heel = rot([0, -0.95, -0.55]);
    let toe = rot([0, 2.35, -0.72]);
    const low = Math.min(heel[2], toe[2]) - 0.62;
    if (low < 0) {
        ankle[2] -= low;
        heel = add(heel, [0, 0, -low]);
        toe = add(toe, [0, 0, -low]);
    }
    return { ankle, heel, toe };
}

/** 二関節（肩→肘→手首）の曲げ。pole は肘を出したい向き。 */
function ik(S: V3, H: V3, l1: number, l2: number, pole: V3): V3 {
    const d = sub(H, S);
    const dist = Math.min(len(d), l1 + l2 - 0.02);
    const dn = nrm(d);
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const pp = nrm(sub(pole, scl(dn, dot(pole, dn))));
    return add(add(S, scl(dn, a)), scl(pp, h));
}

// ---------------------------------------------------------------------------
// 共通の部品
// ---------------------------------------------------------------------------

/** 足袋と履物（草履・草鞋） */
function drawFoot(rig: Rig, f: FootPose, sock: Mat, sole: Mat, strap: string): void {
    const fwd = nrm(sub(f.toe, f.heel));
    const down: V3 = [0, 0, -0.6];
    const soleSh = tubeShape(rig, add(add(f.heel, down), scl(fwd, -0.3)), add(add(f.toe, down), scl(fwd, 0.3)), 0.96, 0.88, sole, {
        flat: 0.17,
        line: 0.7,
        cast: 0,
    });
    const sockSh = tubeShape(rig, f.heel, f.toe, 0.8, 0.7, sock, {
        flat: 0.8,
        line: 0.6,
        cast: 0,
        detail: (ctx, g) => surfLine(ctx, rig, [g.at(0.58, 15), g.at(0.9, 90), g.at(0.58, 165)], strap, 0.3 * rig.s, -0.2),
    });
    // 底と足は 1 つにまとめて描く（部品が少ないほど軽い）
    rig.push(Math.max(soleSh.d, sockSh.d), (ctx) => {
        drawShape(ctx, rig.s, soleSh);
        drawShape(ctx, rig.s, sockSh);
    });
}

interface HeadOpt {
    skin: Mat;
    /** 顔（肌）の範囲の上端（生え際の緯度） */
    hairline: number;
    /** 眉の緯度と角度（+ で外側が上がる） */
    brows: number;
    browTilt: number;
    mustache?: boolean;
    beard?: boolean;
    /** 兜をかぶる（髪のつや・櫛目を描かない） */
    helmet?: boolean;
}

/** 頭：髪の楕円体に、顔の肌・目・眉・鼻・口を貼る。耳は別の小さな楕円体。 */
function drawHead(rig: Rig, C: V3, yaw: number, pitch: number, o: HeadOpt): EllGeo {
    const ax = (v: V3) => rotZ(rotX(v, pitch), yaw);
    const axes: [V3, V3, V3] = [ax([2.2, 0, 0]), ax([0, 2.45, 0]), ax([0, 0, 2.92])];
    const s = rig.s;
    const hl = o.hairline;
    const face: [number, number][] = [
        [-72, -86],
        [-76, -34],
        [-74, hl - 22],
        [-60, hl - 8],
        [-40, hl - 1],
        [-16, hl + 2],
        [0, hl],
        [16, hl + 2],
        [40, hl - 1],
        [60, hl - 8],
        [74, hl - 22],
        [76, -34],
        [72, -86],
    ];
    const g = ellipsoid(rig, C, axes, HAIR, {
        rim: 1,
        line: 0.7,
        cast: 0.26,
        detail: (ctx, eg) => {
            patch(ctx, eg, face, o.skin, { line: 0 });
            if (o.beard) {
                patch(
                    ctx,
                    eg,
                    [
                        [-50, -54],
                        [-24, -50],
                        [0, -54],
                        [24, -50],
                        [50, -54],
                        [34, -80],
                        [0, -88],
                        [-34, -80],
                    ],
                    BEARD,
                    { rim: 0.6 },
                );
            }
            // 生え際に落ちる髪の影
            if (!o.helmet) {
                const hlLine = [-66, -48, -30, -12, 0, 12, 30, 48, 66].map((lon) => {
                    const q = surfEll(eg, lon, hl - 3 - (Math.abs(lon) > 50 ? 8 : 0));
                    return { p: q.p, n: q.n };
                });
                surfLine(ctx, rig, hlLine, css(o.skin.shd, 0.4), 0.45 * s, 0.05);
            }
            drawFace(ctx, rig, eg, o);
            if (!o.helmet) drawHairDetail(ctx, rig, eg);
        },
    });
    // 耳
    for (const side of [-1, 1]) {
        const q = surfEll(g, side * 90, -8);
        if (q.vis < -0.35) continue;
        const nM = rig.m(q.n);
        const cM = rig.m(sub(q.p, scl(q.n, 0.12)));
        const side2 = nrm(cross([0, 0, 1], nM));
        ellipsoid(rig, cM, [scl(nM, 0.26), scl(side2, 0.42), [0, 0, 0.7]], o.skin, {
            depth: rig.depth(g.c) + (q.vis > 0 ? 0.06 : -0.3),
            line: 0.6,
            rim: 0,
            cast: 0,
        });
    }
    return g;
}

/** 目・眉・鼻・口・頬 */
function drawFace(ctx: Ctx, rig: Rig, g: EllGeo, o: HeadOpt): void {
    const s = rig.s;
    const front = surfEll(g, 0, -5);
    if (front.vis < -0.3) return;
    const eyeCol = css([46, 36, 34]);
    // 頬の血色
    for (const side of [-1, 1]) {
        const q = surfEll(g, side * 42, -24);
        if (q.vis < 0.1) continue;
        const c = rig.p(q.p);
        const rg = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], 0.95 * s);
        rg.addColorStop(0, css([212, 124, 104], 0.14 * smooth(0.1, 0.5, q.vis)));
        rg.addColorStop(1, css([212, 124, 104], 0));
        ctx.fillStyle = rg;
        ctx.fillRect(c[0] - s, c[1] - s, 2 * s, 2 * s);
    }
    // 鼻：光の反対側の影と、鼻筋のわずかな明るさ
    {
        const q = surfEll(g, 0, -15);
        if (q.vis > 0.02) {
            const al = smooth(0.02, 0.35, q.vis);
            const c = rig.p(q.p);
            const side = rig.pv(scl(q.tl, 0.34));
            const down = rig.pv(scl(q.tt, -0.32));
            ctx.fillStyle = css(o.skin.shd, 0.55 * al);
            ctx.beginPath();
            ctx.ellipse(c[0] + side[0] * 0.55 + down[0], c[1] + side[1] * 0.55 + down[1], 0.32 * s, 0.16 * s, Math.atan2(side[1], side[0]), 0, TAU);
            ctx.fill();
            ctx.fillStyle = css(o.skin.lit, 0.45 * al);
            ctx.beginPath();
            ctx.ellipse(c[0] - side[0] * 0.35, c[1] - side[1] * 0.35 - 0.1 * s, 0.13 * s, 0.26 * s, 0, 0, TAU);
            ctx.fill();
        }
    }
    const outerSign = (side: number) => (side > 0 ? 1 : -1);
    for (const side of [-1, 1]) {
        // 目：切れ長で、上まぶたの線を濃く。少しだけ白目の気配
        const e = surfEll(g, side * 26, -5);
        if (e.vis > 0.06) {
            const al = smooth(0.06, 0.42, e.vis);
            const c = rig.p(e.p);
            const hw = rig.pv(scl(e.tl, 0.52));
            const up = rig.pv(scl(e.tt, 0.26));
            const tilt = rig.pv(scl(e.tt, 0.05 * outerSign(side)));
            ctx.globalAlpha = al;
            // 黒目（中央やや内側）
            const iris = rig.p(add(e.p, scl(e.tl, -0.08 * side)));
            ctx.fillStyle = eyeCol;
            ctx.beginPath();
            ctx.ellipse(iris[0] + up[0] * 0.15, iris[1] + up[1] * 0.15, Math.max(0.2 * s, Math.hypot(hw[0], hw[1]) * 0.42), 0.26 * s, 0, 0, TAU);
            ctx.fill();
            // 上まぶた
            ctx.strokeStyle = eyeCol;
            ctx.lineWidth = 0.2 * s;
            ctx.beginPath();
            ctx.moveTo(c[0] - hw[0] - tilt[0], c[1] - hw[1] - tilt[1]);
            ctx.quadraticCurveTo(c[0] + up[0] * 1.4, c[1] + up[1] * 1.4, c[0] + hw[0] + tilt[0] * 1.6, c[1] + hw[1] + tilt[1] * 1.6);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
        // 眉
        const b = surfEll(g, side * 27, o.brows);
        if (b.vis > 0.06) {
            const al = smooth(0.06, 0.42, b.vis);
            const c = rig.p(b.p);
            const hw = rig.pv(scl(b.tl, 0.6));
            const up = rig.pv(scl(b.tt, 0.2));
            const outer = outerSign(side);
            ctx.globalAlpha = al;
            ctx.strokeStyle = css([44, 34, 32], 0.85);
            ctx.lineWidth = 0.22 * s;
            ctx.beginPath();
            ctx.moveTo(c[0] - hw[0] * outer - up[0] * o.browTilt * 0.5, c[1] - hw[1] * outer - up[1] * o.browTilt * 0.5);
            ctx.quadraticCurveTo(c[0] + up[0] * 0.5, c[1] + up[1] * 0.5, c[0] + hw[0] * outer + up[0] * o.browTilt, c[1] + hw[1] * outer + up[1] * o.browTilt);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }
    // 口
    const m = surfEll(g, 0, -37);
    if (m.vis > 0.1) {
        const c = rig.p(m.p);
        const hw = rig.pv(scl(m.tl, 0.36));
        ctx.globalAlpha = smooth(0.1, 0.45, m.vis) * 0.7;
        ctx.strokeStyle = css([126, 72, 62]);
        ctx.lineWidth = 0.16 * s;
        ctx.beginPath();
        ctx.moveTo(c[0] - hw[0], c[1] - hw[1]);
        ctx.lineTo(c[0] + hw[0], c[1] + hw[1]);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }
    if (o.mustache) {
        const q = surfEll(g, 0, -29);
        if (q.vis > 0.05) {
            const c = rig.p(q.p);
            const hw = rig.pv(scl(q.tl, 0.85));
            const dn = rig.pv(scl(q.tt, -0.3));
            ctx.globalAlpha = smooth(0.05, 0.4, q.vis);
            ctx.fillStyle = css(BEARD.base);
            ctx.beginPath();
            ctx.moveTo(c[0] - hw[0] + dn[0], c[1] - hw[1] + dn[1]);
            ctx.quadraticCurveTo(c[0] - dn[0] * 0.9, c[1] - dn[1] * 0.9, c[0] + hw[0] + dn[0], c[1] + hw[1] + dn[1]);
            ctx.quadraticCurveTo(c[0] + dn[0] * 0.2, c[1] + dn[1] * 0.2, c[0] - hw[0] + dn[0], c[1] - hw[1] + dn[1]);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }
}

/** 髪：髷へ向かう櫛目 */
function drawHairDetail(ctx: Ctx, rig: Rig, g: EllGeo): void {
    const s = rig.s;
    const lines: SP[][] = [];
    for (const lon of [-160, -132, -104, -78, -54, -30, 30, 54, 78, 104, 132, 160, 180]) {
        const pts: SP[] = [];
        for (let lat = 16; lat <= 72; lat += 8) {
            const q = surfEll(g, lon * (1 - (lat - 16) / 150) + (lon > 0 ? 8 : -8) * ((lat - 16) / 56), lat);
            pts.push({ p: q.p, n: q.n });
        }
        lines.push(pts);
    }
    surfLines(ctx, rig, lines, css([74, 70, 78], 0.3), 0.15 * s, 0.1);
}

/** 腕の袖（小袖）：肩→肘→手首と袂を 1 枚の布としてまとめ、袖口の暗がりと手を足す */
function drawSleeveArm(rig: Rig, S: V3, E: V3, Wr: V3, cloth: Mat, skin: Mat, bias: number): void {
    const fore = nrm(sub(Wr, E));
    const upper = tubeShape(rig, S, E, 1.24, 1.36, cloth, { line: 0.8, bias, side: [0, 1, 0], cast: 0.26 });
    const lower = tubeShape(rig, E, add(Wr, scl(fore, -0.1)), 1.36, 1.46, cloth, { line: 0.8, bias: bias + 0.02, side: [0, 1, 0], cast: 0.2 });
    // 袂（袖の袋）：前腕の下に垂れる
    let sag = sub([0, 0, -1], scl(fore, -fore[2]));
    if (len(sag) < 0.35) sag = [0, -1, 0];
    sag = nrm(sub(sag, scl(fore, dot(sag, fore))));
    const lat = nrm(cross(fore, sag));
    const mid = add(lerp3(E, Wr, 0.6), scl(sag, 0.75));
    const bag = ellShape(rig, mid, [scl(fore, 1.7), scl(sag, 1.2), scl(lat, 0.9)], cloth, { bias: bias - 0.04, line: 0.8, rim: 0, cast: 0.18 });
    group(rig, [upper, bag, lower], { depth: Math.max(upper.d, lower.d, bag.d) });
    // 袖口の暗がり
    const cuff = add(Wr, scl(fore, -0.05));
    ellipsoid(rig, cuff, [scl(fore, 0.1), scl(sag, 1.12), scl(lat, 1.1)], KOSODE_IN, { bias: bias + 0.03, line: 0, rim: 0, cast: 0 });
    // 手
    const H = add(Wr, scl(fore, 0.62));
    ellipsoid(rig, H, [scl(fore, 0.92), scl(sag, 0.6), scl(lat, 0.68)], skin, { bias: bias + 0.06, line: 0.7, rim: 0, cast: 0.2 });
}

/** 刀（左腰）。mouth = 鯉口の位置、hilt/saya = 柄・鞘の向き（人形の座標、変形前）。 */
interface SwordDef {
    mouth: V3;
    hilt: V3;
    saya: V3;
    hl: number;
    sl: number;
    r: number;
}

const HERO_SWORDS: SwordDef[] = [
    { mouth: [-3.5, 1.35, 18.8], hilt: nrm([0.26, 1, 0.42]), saya: nrm([-0.18, -1, -0.52]), hl: 4.1, sl: 10.6, r: 0.42 },
    { mouth: [-2.6, 1.95, 19.25], hilt: nrm([0.34, 1, 0.36]), saya: nrm([-0.22, -1, -0.44]), hl: 3.1, sl: 7.4, r: 0.37 },
];

function drawSwords(rig: Rig, T: (p: V3) => V3, defs: SwordDef[]): void {
    const s = rig.s;
    for (const b of defs) {
        const M0 = T(b.mouth);
        const hDir = nrm(sub(T(add(b.mouth, b.hilt)), M0));
        const sDir = nrm(sub(T(add(b.mouth, b.saya)), M0));
        const hilt0 = add(M0, scl(hDir, 0.42));
        const hilt1 = add(M0, scl(hDir, b.hl));
        const sayaEnd = add(M0, scl(sDir, b.sl));
        // 鞘（黒漆。つやの筋）と鐺（こじり）
        tube(rig, M0, sayaEnd, b.r, b.r * 0.84, LACQUER, {
            flat: 1.2,
            side: [1, 0, 0],
            line: 0.75,
            cast: 0.2,
            detail: (ctx, g) => {
                // 鐺：先端の金具（明るい縁）
                const q0 = g.at(0.94, 90);
                const q1 = g.at(1, 90);
                const a = rig.p(q0.p);
                const c = rig.p(q1.p);
                ctx.strokeStyle = css(IRON.lit, 0.8);
                ctx.lineWidth = b.r * 1.6 * s;
                ctx.beginPath();
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(c[0], c[1]);
                ctx.stroke();
            },
        });
        // 柄（黒い柄巻に白い菱）、鍔、柄頭
        const ax = hDir;
        const s1 = nrm(cross(ax, [0, 0, 1]));
        const s2 = nrm(cross(ax, s1));
        const tr = 0.95 * (b.r / 0.45);
        const tsuba = ellShape(rig, add(M0, scl(hDir, 0.28)), [scl(ax, 0.14), scl(s1, tr), scl(s2, tr)], IRON, {
            bias: 0.02,
            line: 0.7,
            rim: 0,
            cast: 0,
        });
        const hilt = tubeShape(rig, hilt0, hilt1, b.r * 0.86, b.r * 0.8, TSUKA, {
            flat: 1.2,
            line: 0.6,
            bias: 0.03,
            cast: 0.12,
            detail: (ctx, g) => {
                ctx.fillStyle = css(CORD.base, 0.8);
                ctx.beginPath();
                for (let k = 1; k < 6; k++) {
                    for (const th of [80, 100]) {
                        const q = g.at(k / 6, th + (k % 2) * 180);
                        if (dot(q.n, VIEW) < 0.15) continue;
                        const c = rig.p(q.p);
                        ctx.moveTo(c[0] + 0.16 * s, c[1]);
                        ctx.arc(c[0], c[1], 0.16 * s, 0, TAU);
                    }
                }
                ctx.fill();
                // 柄頭
                const a = rig.p(g.at(0.93, 90).p);
                const e = rig.p(g.at(1, 90).p);
                ctx.strokeStyle = css(IRON.base);
                ctx.lineWidth = b.r * 1.5 * s;
                ctx.beginPath();
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(e[0], e[1]);
                ctx.stroke();
            },
        });
        const ordered = tsuba.d < hilt.d ? [tsuba, hilt] : [hilt, tsuba];
        rig.push(Math.max(tsuba.d, hilt.d), (ctx) => {
            for (const sh of ordered) drawShape(ctx, s, sh);
        });
    }
}

// ---------------------------------------------------------------------------
// 主人公（若殿）
// ---------------------------------------------------------------------------

/** 向きごとの歩幅。手前・奥へ歩くときは足がコマからはみ出さないよう控えめにする。 */
function strideFor(rig: Rig): number {
    const toward = Math.max(0, rig.fy);
    const away = Math.max(0, -rig.fy);
    return 5.6 - 2.6 * Math.pow(toward, 1.4) - 2.0 * Math.pow(away, 1.4);
}

function buildHero(rig: Rig, walk: number | null): void {
    const walking = walk !== null;
    const t = walk ?? 0;
    const a = strideFor(rig);
    // 手前・奥向きでは歩幅が見えにくいので、足の上げ下げと左右の体重移動で歩きを見せる
    const depthness = Math.abs(rig.fy);
    const liftH = 1.45 + 0.6 * depthness;
    const bobAmp = 0.62 + 0.2 * depthness;
    const bob = walking ? -bobAmp / 2 + bobAmp * (0.5 - 0.5 * Math.cos(2 * TAU * t)) : 0;
    const lean = walking ? 0.05 : 0;
    const twist = walking ? 0.085 * Math.cos(TAU * t) : 0;
    // 待機：左足に体重を乗せ、腰がわずかに左へ、上体は釣り合いを取って右へ（固すぎない立ち姿）
    const sway = walking ? -(0.3 + 0.18 * depthness) * Math.sin(TAU * t) : -0.28;
    const roll = walking ? 0.025 * Math.sin(TAU * t) : 0.022;
    /** 上半身の変形（ひねり・前傾・左右の体重移動・上下動） */
    const U = (p: V3): V3 => {
        const q = rotZ(p, twist);
        return [q[0] + sway + (q[2] - 16) * roll, q[1] + (q[2] - 16) * lean, q[2] + bob];
    };
    const Uv = (v: V3): V3 => rotZ(v, twist);
    /** 腰の変形 */
    const Pv = (p: V3): V3 => {
        const q = rotZ(p, -twist * 0.5);
        return [q[0] + sway * 0.8, q[1], q[2] + bob];
    };
    const Pvv = (v: V3): V3 => rotZ(v, -twist * 0.5);

    // ---- 足と袴（腰まわりと両脚を 1 枚の布として、同じ陰影でまとめて描く） ----
    const hipRing = (z: number, rx: number, ry: number): Ring => ({ c: Pv([0, -0.05, z]), u: Pvv([rx, 0, 0]), v: Pvv([0, ry, 0]), z });
    const hakama: Shape[] = [];
    const hip = loftShape(rig, [hipRing(19.0, 3.52, 2.44), hipRing(16.4, 4.1, 2.8), hipRing(12.8, 4.55, 3.02)], HAKAMA, {
        line: 0.8,
        cast: 0.12,
        detail: (ctx, lg) => pleats(ctx, rig, lg, [18.8, 16.6, 14.7, 12.8], [48, 66, 90, 114, 132, 230, 270, 310]),
    });
    hakama.push(hip);
    for (const leg of [
        { side: 1, ph: t + 0.5 },
        { side: -1, ph: t },
    ]) {
        const g = walking ? gait(leg.ph, a, liftH) : { y: leg.side > 0 ? 0.55 : 0.0, lift: 0, pitch: 0 };
        const f = footPose(leg.side * (walking ? 1.85 : leg.side > 0 ? 2.05 : 1.7), -0.3 + g.y, g.lift, g.pitch, leg.side * (walking ? 0.05 : leg.side > 0 ? 0.26 : 0.1));
        drawFoot(rig, f, TABI, ZORI, css([96, 42, 36]));
        const top = Pv([leg.side * 1.95, 0, 14.8]);
        const hem = add(f.ankle, [leg.side * 0.18, -0.2, 0.5]);
        hakama.push(
            tubeShape(rig, top, hem, 2.35, 3.15, HAKAMA, {
                flat: 0.9,
                line: 0.8,
                seg: 14,
                cast: 0.18,
                detail: (ctx, lg) => pleats(ctx, rig, lg, [0.02, 0.4, 0.75, 1], [62, 82, 102, 122, 250, 290]),
            }),
        );
    }
    group(rig, hakama, { depth: hip.d + 1.0, shared: hip });

    // ---- 胴（小袖） ----
    const ring = (z: number, rx: number, ry: number, dy = 0): Ring => ({ c: U([0, dy, z]), u: Uv([rx, 0, 0]), v: Uv([0, ry, 0]), z });
    const torso = loft(
        rig,
        [ring(17.9, 3.4, 2.28), ring(21.2, 3.62, 2.44, 0.05), ring(24.2, 3.86, 2.48, 0.05), ring(25.9, 3.82, 2.28), ring(26.9, 2.85, 1.9), ring(27.5, 1.5, 1.28)],
        KOSODE,
        {
            line: 0.8,
            seg: 18,
            cast: 0,
            detail: (ctx, tg) => drawKosodeFront(ctx, rig, tg),
        },
    );
    const torsoDepth = rig.depth(torso.wr[0].c);
    // 腰紐（袴の紐）
    loft(rig, [hipRing(18.1, 3.6, 2.52), hipRing(19.35, 3.5, 2.45)], HIMO, {
        line: 0.6,
        depth: torsoDepth + 1.25,
        cast: 0.3,
        detail: (ctx, lg) => {
            // 前の結び目
            const q = lg.at(18.45, 90);
            if (dot(q.n, VIEW) > 0.1) {
                const c = rig.p(q.p);
                ctx.fillStyle = css(mixRgb(HIMO.lit, HIMO.base, 0.4));
                ctx.beginPath();
                ctx.ellipse(c[0], c[1], 0.75 * rig.s, 0.4 * rig.s, 0, 0, TAU);
                ctx.fill();
                ctx.strokeStyle = css(HIMO.line, 0.7);
                ctx.lineWidth = 0.15 * rig.s;
                ctx.stroke();
            }
        },
    });
    // 腰板（背中）
    {
        const pts: V3[] = [];
        for (const th of [245, 258, 270, 282, 295]) pts.push(Pv(ringPoint(3.55, 2.5, th, 19.25)));
        for (const th of [286, 270, 254]) pts.push(Pv(ringPoint(3.25, 2.4, th, 20.5)));
        plate(rig, pts, mat('#4d4843', { lit: 0.25, shd: 0.4 }), { depth: torsoDepth + 1.3, line: 0.7, cast: 0 });
    }

    // ---- 刀（左腰）----
    drawSwords(rig, Pv, HERO_SWORDS);

    // ---- 首・頭 ----
    tube(rig, U([0, 0.05, 26.6]), U([0, 0.25, 28.9]), 1.02, 0.94, SKIN, { line: 0.5, tone: [-0.35, -0.12], cast: 0 });
    // 後ろ襟（首の後ろに立つ襟）
    band(
        rig,
        { c: U([0, -0.1, 27.0]), u: Uv([1.75, 0, 0]), v: Uv([0, 1.55, 0]) },
        { c: U([0, -0.2, 27.9]), u: Uv([1.45, 0, 0]), v: Uv([0, 1.4, 0]) },
        165,
        375,
        COLLAR,
        { depth: torsoDepth + 0.05 + (rig.fy < 0 ? 3 : 0), line: 0.7, cast: 0 },
    );
    drawHead(rig, U([0, 0.32, 31.25]), walking ? twist * 0.3 : 0.07, walking ? -0.05 : -0.03, { skin: SKIN, hairline: 24, brows: 11, browTilt: 0.25 });
    // 髷（茶筅髷）：頭頂のやや後ろで結い、毛先を後ろへ流す
    const knot0 = U([0, -1.0, 33.55]);
    const knot1 = U([0, -1.5, 34.9]);
    const tail = U([0, -2.75, 35.3]);
    const tip = U([0, -3.7, 34.55]);
    const knot = tubeShape(rig, knot0, knot1, 0.95, 0.82, HAIR, {
        line: 0.6,
        cast: 0.26,
        detail: (ctx, g) => {
            // 元結（白い紙縒り）
            surfLines(ctx, rig, [0.5, 0.64].map((z) => ringPts(g, z)), css(CORD.base, 0.9), 0.26 * rig.s, -0.05);
        },
    });
    const tl1 = tubeShape(rig, knot1, tail, 0.82, 0.55, HAIR, { line: 0.6, cast: 0.2 });
    const tl2 = tubeShape(rig, tail, tip, 0.55, 0.2, HAIR, { line: 0.6, cast: 0 });
    group(rig, [tl2, tl1, knot], { depth: knot.d });

    // ---- 腕 ----
    // 右腕：自然に振る（前に出すとき少し内へ、肘も少し曲がる）
    {
        const sw = walking ? Math.cos(TAU * t) : 0;
        const phi = walking ? 0.42 * sw : 0.07;
        const bend = 0.2 + (walking ? 0.32 * Math.max(0, sw) : 0.06);
        const inward = walking ? -0.35 * Math.max(0, sw) : 0;
        const S: V3 = [3.75, 0, 25.9];
        const E = add(S, scl(nrm([0.12 + inward * 0.3, Math.sin(phi), -Math.cos(phi)]), 5.2));
        const Wr = add(E, scl(nrm([-0.04 + inward, Math.sin(phi + bend), -Math.cos(phi + bend)]), 4.3));
        drawSleeveArm(rig, U(S), U(E), U(Wr), KOSODE, SKIN, 0.7);
    }
    // 左腕：刀の鯉口に手を添える
    {
        const S: V3 = [-3.75, 0, 25.9];
        const H = Pv(SWORD_HAND);
        const Hm: V3 = [H[0] - sway, H[1], H[2] - bob];
        const E = ik(S, Hm, 5.2, 4.35, [-1, -0.7, -0.1]);
        const Wr = sub(H, scl(nrm(sub(H, U(E))), 0.6));
        drawSleeveArm(rig, U(S), U(E), Wr, KOSODE, SKIN, 0.7);
    }
}

/** 左手を添える位置（腰の座標） */
const SWORD_HAND: V3 = [-3.05, 2.4, 19.5];

function ringPoint(rx: number, ry: number, thDeg: number, z: number): V3 {
    const th = (thDeg * Math.PI) / 180;
    return [rx * Math.cos(th), ry * Math.sin(th), z];
}

/** 袴の襞：暗い線と明るい線の組 */
function pleats(ctx: Ctx, rig: Rig, lg: LoftGeo, zs: number[], ths: number[]): void {
    const s = rig.s;
    surfLines(ctx, rig, ths.map((th) => zs.map((zz) => lg.at(zz, th))), css(HAKAMA.line, 0.4), 0.16 * s, 0.08);
    surfLines(ctx, rig, ths.map((th) => zs.map((zz) => lg.at(zz, th + 6))), css(HAKAMA.lit, 0.28), 0.12 * s, 0.08);
}

/** 小袖の前（襟の重なり）と家紋 */
function drawKosodeFront(ctx: Ctx, rig: Rig, tg: LoftGeo): void {
    const s = rig.s;
    const crest = (z: number, th: number, r: number) => {
        const q = tg.at(z, th);
        if (dot(q.n, VIEW) < 0.12) return;
        const tl = nrm(sub(tg.at(z, th + 1.5).p, tg.at(z, th - 1.5).p));
        const tt = nrm(sub(tg.at(z + 0.4, th).p, tg.at(z - 0.4, th).p));
        // 蛇の目のような丸紋：外の輪と中心の点を 1 回で
        surfDot(ctx, rig, q.p, q.n, tl, tt, [r, r * 0.55, r * 0.22], css(JUBAN.base, 0.9));
    };
    // 背中と胸の家紋
    crest(24.7, 270, 0.62);
    crest(24.5, 50, 0.4);
    crest(24.5, 130, 0.4);
    // 襟：左前（着る人の左の身頃が上）。上の襟は着る人の左の首元 → 右の腰へ
    const front = tg.at(23, 90);
    if (dot(front.n, VIEW) < -0.2) return;
    const curve = (pts: [number, number][]) => pts.map(([z, th]) => tg.at(z, th));
    const over: [number, number][] = [
        [27.45, 145],
        [26.4, 128],
        [25.2, 108],
        [24.0, 92],
        [22.6, 76],
        [21.0, 63],
    ];
    const under: [number, number][] = [
        [27.45, 35],
        [26.4, 52],
        [25.3, 70],
        [24.3, 86],
    ];
    // V の中（胸元の肌）
    {
        const pts = [
            ...curve([
                [27.5, 145],
                [26.4, 128],
                [25.2, 108],
                [24.2, 94],
            ]),
            ...curve([
                [24.4, 88],
                [25.3, 70],
                [26.4, 52],
                [27.5, 35],
            ]),
        ];
        if (pts.every((q) => dot(q.n, VIEW) > -0.05)) {
            polyPath(
                ctx,
                pts.map((q) => rig.p(q.p)),
            );
            ctx.fillStyle = css(mixRgb(SKIN.shd, SKIN.base, 0.3));
            ctx.fill();
        }
    }
    // 下着（白）の襟
    surfLine(ctx, rig, curve(under.map(([z, th]) => [z, th + 7] as [number, number])), css(JUBAN.base), 0.55 * s, 0.02);
    surfLine(ctx, rig, curve(over.slice(0, 4).map(([z, th]) => [z, th - 8] as [number, number])), css(JUBAN.base), 0.55 * s, 0.02);
    // 小袖の襟（濃い藍）
    surfLine(ctx, rig, curve(under), css(COLLAR.base), 0.62 * s, 0.02);
    surfLine(ctx, rig, curve(over), css(COLLAR.base), 0.7 * s, 0.02);
}

// ---------------------------------------------------------------------------
// 家臣（源蔵）：胴丸（赤糸威）・大袖・草摺・兜（三日月の前立）・脛当・槍
// ---------------------------------------------------------------------------

function buildRetainer(rig: Rig): void {
    const s = rig.s;
    // ---- 足：草鞋・脛当・たっつけ袴 ----
    for (const side of [1, -1]) {
        const f = footPose(side * 2.2, -0.15, 0, 0, side * 0.22);
        drawFoot(rig, f, DARK_TABI, WARAJI, css([70, 58, 44]));
        const knee: V3 = [side * 2.15, 0.35, 8.0];
        // 脛当（すねあて）：鉄の篠（縦の板）と紐
        tube(rig, add(f.ankle, [0, 0.05, 0.25]), knee, 1.16, 1.34, SHIN, {
            line: 0.8,
            bias: 0.1,
            cast: 0.15,
            detail: (ctx, g) => {
                surfLines(ctx, rig, [60, 82, 104, 126].map((th) => [g.at(0.08, th), g.at(0.92, th)]), css(SHIN.lit, 0.5), 0.14 * s, 0.1);
                surfLines(ctx, rig, [ringPts(g, 0.25), ringPts(g, 0.72)], css([150, 62, 50], 0.85), 0.2 * s, 0.05);
            },
        });
        // 腿と膝のふくらみ（たっつけ袴）を 1 枚の布として
        const knob = ellShape(rig, [side * 2.15, 0.25, 8.9], [[1.52, 0, 0], [0, 1.58, 0], [0, 0, 1.25]], HAKAMA2, { line: 0.7, cast: 0.15 });
        const thigh = tubeShape(rig, [side * 2.15, 0.25, 8.8], [side * 2.05, 0, 14.6], 1.66, 2.1, HAKAMA2, { line: 0.7, cast: 0.18 });
        group(rig, [knob, thigh], { depth: Math.max(knob.d, thigh.d) + 0.12 });
    }

    // ---- 草摺（くさずり）：腰から下がる板。赤糸威に、下端の白い菱縫 ----
    const R = (z: number, rx: number, ry: number, dy = 0): Ring => ({ c: [0, dy, z], u: [rx, 0, 0], v: [0, ry, 0], z });
    const kz = loft(rig, [R(18.3, 4.12, 3.05), R(15.6, 4.7, 3.45, -0.05), R(12.7, 5.2, 3.85, -0.1)], ODOSHI, {
        line: 0.8,
        seg: 18,
        bias: 0.6,
        cast: 0.22,
        detail: (ctx, g) => {
            // 段（小札の頭）の線
            const zs = [17.2, 16.1, 15.0, 14.0];
            surfLines(ctx, rig, zs.map((z) => ringPts(g, z)), css(PLATE.base, 0.8), 0.32 * s, 0.03);
            surfLines(ctx, rig, zs.map((z) => ringPts(g, z, -0.2)), css(mixRgb(ODOSHI.lit, WARM, 0.2), 0.3), 0.12 * s, 0.03);
            // 菱縫（下端の白い帯）
            surfLine(ctx, rig, ringPts(g, 13.15), css(CORD.base, 0.85), 0.28 * s, 0.03);
            // 間（板の切れ目）
            surfLines(ctx, rig, [20, 65, 115, 160, 200, 245, 295, 340].map((th) => [g.at(17.6, th), g.at(12.75, th)]), css(PLATE.base, 0.7), 0.2 * s, 0.1);
        },
    });
    // ---- 胴（胴丸） ----
    const doG = loft(rig, [R(17.8, 4.0, 2.95), R(20.6, 4.24, 3.15), R(23.4, 4.36, 3.18), R(25.3, 4.12, 2.86), R(26.2, 3.3, 2.3), R(26.7, 1.8, 1.5)], ODOSHI, {
        line: 0.8,
        seg: 18,
        cast: 0.12,
        detail: (ctx, g) => {
            // 小札の段
            const zs = [18.9, 20.1, 21.3, 22.5];
            surfLines(ctx, rig, zs.map((z) => ringPts(g, z)), css(PLATE.base, 0.8), 0.34 * s, 0.03);
            surfLines(ctx, rig, zs.map((z) => ringPts(g, z, -0.22)), css(mixRgb(ODOSHI.lit, WARM, 0.2), 0.3), 0.12 * s, 0.03);
            // 威（縦の糸目）
            const ls: SP[][] = [];
            for (let th = 0; th < 360; th += 18) ls.push([g.at(18.2, th), g.at(23.2, th)]);
            surfLines(ctx, rig, ls, css(ODOSHI.line, 0.2), 0.1 * s, 0.15);
        },
    });
    // 胸板・背板（黒漆）と金具
    for (const [th0, th1] of [
        [22, 158],
        [202, 338],
    ]) {
        band(rig, R(23.5, 4.37, 3.19), R(26.2, 3.34, 2.33), th0, th1, PLATE, {
            depth: doG.wr.reduce((m, r) => m + rig.depth(r.c), 0) / doG.wr.length + 0.05,
            line: 0.8,
            cast: 0.1,
            detail: (ctx, at) => {
                for (const [t, th] of [
                    [0.3, th0 + 14],
                    [0.3, th1 - 14],
                ]) {
                    const q = at(t, th);
                    if (dot(q.n, VIEW) < 0.1) continue;
                    const c = rig.p(q.p);
                    ctx.fillStyle = css(GOLD.lit);
                    ctx.beginPath();
                    ctx.arc(c[0], c[1], 0.26 * s, 0, TAU);
                    ctx.fill();
                }
                // 下端の覆輪（金の縁）
                const pts: SP[] = [];
                for (let k = 0; k <= 12; k++) pts.push(at(0.04, th0 + ((th1 - th0) * k) / 12));
                surfLine(ctx, rig, pts, css(GOLD.base, 0.75), 0.16 * s, 0.03);
            },
        });
    }
    // 上帯（胴の上に締める帯）
    loft(rig, [R(17.35, 4.05, 3.0), R(18.35, 4.02, 2.98)], BELT, {
        line: 0.6,
        depth: rig.depth(kz.wr[0].c) + 0.7,
        cast: 0.25,
    });
    // 肩上（わたがみ）：胴を吊る黒い革紐
    for (const side of [1, -1]) {
        const pts: V3[] = [];
        for (let k = 0; k <= 6; k++) {
            const a = (k / 6) * Math.PI;
            pts.push([side * 2.45, -Math.cos(a) * 2.55, 25.4 + Math.sin(a) * 1.5]);
        }
        tube(rig, pts[0], pts[3], 0.42, 0.42, PLATE, { line: 0.7, cast: 0, side: [1, 0, 0], flat: 0.6 });
        tube(rig, pts[3], pts[6], 0.42, 0.42, PLATE, { line: 0.7, cast: 0, side: [1, 0, 0], flat: 0.6 });
    }

    // ---- 刀（左腰）----
    drawSwords(rig, (p) => p, [{ mouth: [-4.2, 1.35, 17.9], hilt: nrm([0.3, 1, 0.45]), saya: nrm([-0.35, -1, -0.5]), hl: 4.0, sl: 10.2, r: 0.44 }]);

    // ---- 首・頭・兜 ----
    tube(rig, [0, 0.05, 26.3], [0, 0.25, 29.0], 1.08, 1.0, SKIN_OLD, { line: 0.5, tone: [-0.35, -0.12], cast: 0 });
    // 襟（小袖の襟が胴の上に見える）
    loft(rig, [R(26.55, 1.95, 1.65, 0.1), R(27.4, 1.45, 1.3, 0.2)], KOTE, { line: 0.6, cast: 0 });
    const head = drawHead(rig, [0, 0.3, 31.15], 0, 0, {
        skin: SKIN_OLD,
        hairline: 14,
        brows: 8,
        browTilt: -0.3,
        mustache: true,
        beard: true,
        helmet: true,
    });
    drawKabuto(rig, head);

    // ---- 腕 ----
    // 左手：槍を立てて持つ（城門で左を向いて立つことが多いので、槍が手前に見える側）
    const spearX = -5.0;
    const spearY = 1.75;
    {
        const S: V3 = [-4.15, 0, 25.6];
        const H: V3 = [spearX + 0.3, spearY - 0.1, 19.9];
        const E = ik(S, H, 5.1, 4.2, [-0.35, -1, 0]);
        drawArmoredArm(rig, S, E, H, -1);
    }
    // 右手：力を抜いて下ろす
    {
        const S: V3 = [4.15, 0, 25.6];
        const H: V3 = [4.55, 0.9, 16.9];
        const E = ik(S, H, 5.1, 4.2, [0.3, -1, 0]);
        drawArmoredArm(rig, S, E, H, 1);
    }
    // ---- 槍 ----
    drawSpear(rig, spearX, spearY);
}

/** 籠手（こて）の腕と大袖。H は手の位置。 */
function drawArmoredArm(rig: Rig, S: V3, E: V3, H: V3, side: number): void {
    const s = rig.s;
    const fore = nrm(sub(H, E));
    const Wr = sub(H, scl(fore, 0.55));
    const up = tubeShape(rig, S, E, 1.12, 1.05, KOTE, { line: 0.8, bias: 0.7, side: [0, 1, 0], cast: 0.22 });
    const lo = tubeShape(rig, E, Wr, 1.02, 0.86, KOTE, {
        line: 0.8,
        bias: 0.72,
        side: [0, 1, 0],
        cast: 0.22,
        detail: (ctx, g) => {
            // 籠手の筏（いかだ：細い鉄板）
            surfLines(ctx, rig, [70, 90, 110].map((th) => [g.at(0.15, th), g.at(0.85, th)]), css(IRON.lit, 0.5), 0.2 * s, 0.1);
        },
    });
    group(rig, [up, lo]);
    // 手甲と手
    const c1 = nrm(cross(fore, [0, 0, 1]));
    ellipsoid(rig, H, [scl(fore, 0.85), scl(c1, 0.7), scl(nrm(cross(fore, c1)), 0.62)], SKIN_OLD, {
        bias: 0.78,
        line: 0.7,
        rim: 0.6,
        cast: 0.2,
    });
    // 大袖：肩から下がる板（赤糸威、段の線）
    const x0 = side * 4.9;
    const x1 = side * 5.55;
    const pts: V3[] = [
        [x0, -1.75, 26.5],
        [x0 + side * 0.35, 0, 26.75],
        [x0, 1.75, 26.5],
        [x1, 1.85, 21.8],
        [x1 + side * 0.35, 0, 21.65],
        [x1, -1.85, 21.8],
    ];
    plate(rig, pts, ODOSHI, {
        bias: 0.95,
        line: 0.8,
        cast: 0.28,
        detail: (ctx, sp) => {
            // 段：上辺と下辺を補間した線
            for (const t of [0.22, 0.42, 0.62, 0.82]) {
                const a = lerpP(sp[0], sp[5], t);
                const m = lerpP(sp[1], sp[4], t);
                const b = lerpP(sp[2], sp[3], t);
                ctx.strokeStyle = css(PLATE.base, 0.8);
                ctx.lineWidth = 0.3 * s;
                ctx.beginPath();
                ctx.moveTo(a[0], a[1]);
                ctx.quadraticCurveTo(m[0], m[1], b[0], b[1]);
                ctx.stroke();
            }
            // 冠板（上端の黒漆）
            ctx.strokeStyle = css(PLATE.base);
            ctx.lineWidth = 0.55 * s;
            ctx.beginPath();
            ctx.moveTo(sp[0][0], sp[0][1]);
            ctx.quadraticCurveTo(sp[1][0], sp[1][1], sp[2][0], sp[2][1]);
            ctx.stroke();
            // 菱縫
            const a = lerpP(sp[0], sp[5], 0.93);
            const m = lerpP(sp[1], sp[4], 0.93);
            const b = lerpP(sp[2], sp[3], 0.93);
            ctx.strokeStyle = css(CORD.base, 0.8);
            ctx.lineWidth = 0.24 * s;
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.quadraticCurveTo(m[0], m[1], b[0], b[1]);
            ctx.stroke();
        },
    });
}

/** 兜：鉢（筋の入った鉄の椀）・眉庇・錣（首を覆う段）・吹返・三日月の前立 */
function drawKabuto(rig: Rig, head: EllGeo): void {
    const s = rig.s;
    const hd = rig.depth(head.c);
    const c0: V3 = [0, 0.18, 0];
    const R = (z: number, rx: number, ry: number, dy = 0): Ring => ({ c: add(c0, [0, dy, z]), u: [rx, 0, 0], v: [0, ry, 0], z });
    // 錣（しころ）：後ろと横。前は開いている
    const top = R(32.35, 2.78, 2.98, -0.05);
    const bot = R(29.75, 3.62, 3.72, -0.45);
    const sectors: [number, number][] = [
        [150, 190],
        [190, 230],
        [230, 270],
        [270, 310],
        [310, 350],
        [350, 390],
    ];
    for (const [a, b] of sectors) {
        band(rig, top, bot, a, b, ODOSHI, {
            line: 0.8,
            cast: 0.2,
            detail: (ctx, at) => {
                const row = (t: number) => [0, 1, 2, 3, 4].map((k) => at(t, a + ((b - a) * k) / 4));
                surfLines(ctx, rig, [row(0.34), row(0.67)], css(PLATE.base, 0.8), 0.32 * s, -0.5);
                const pts: SP[] = [];
                for (let k = 0; k <= 4; k++) pts.push(at(0.92, a + ((b - a) * k) / 4));
                surfLine(ctx, rig, pts, css(CORD.base, 0.75), 0.22 * s, -0.5);
            },
        });
    }
    // 吹返し（錣の前端を外へ折り返した小さな板。金の縁）
    for (const side of [1, -1]) {
        const th = side > 0 ? 30 : 150;
        const a = (th * Math.PI) / 180;
        const p0: V3 = add(c0, [2.9 * Math.cos(a), 3.05 * Math.sin(a) - 0.05, 32.2]);
        const p1: V3 = add(c0, [3.25 * Math.cos(a), 3.3 * Math.sin(a) - 0.3, 30.9]);
        const out: V3 = [side * 0.7, -0.45, 0.05];
        plate(rig, [p0, p1, add(p1, out), add(p0, add(out, [0, 0.05, 0.2]))], PLATE, {
            line: 0.8,
            cast: 0.15,
            bias: 0.3,
            detail: (ctx, sp) => {
                ctx.strokeStyle = css(GOLD.base, 0.7);
                ctx.lineWidth = 0.14 * s;
                ctx.beginPath();
                ctx.moveTo(sp[0][0], sp[0][1]);
                ctx.lineTo(sp[1][0], sp[1][1]);
                ctx.stroke();
            },
        });
    }
    // 鉢
    loft(rig, [R(32.3, 2.8, 3.0, -0.05), R(33.4, 2.62, 2.8, -0.05), R(34.35, 2.05, 2.2, -0.1), R(34.95, 1.2, 1.3, -0.1), R(35.2, 0.35, 0.4, -0.1)], KABUTO, {
        depth: hd + 0.4,
        line: 0.8,
        seg: 18,
        tone: [-0.08, 0.2],
        cast: 0.3,
        detail: (ctx, g) => {
            // 筋（縦の筋金）
            const ls: SP[][] = [];
            for (let th = 0; th < 360; th += 22.5) ls.push([32.4, 33.4, 34.35, 34.95].map((z) => g.at(z, th)));
            surfLines(ctx, rig, ls, css(KABUTO.line, 0.55), 0.14 * s, 0.1);
            // 腰巻（鉢の下の縁）
            surfLine(ctx, rig, ringPts(g, 32.55), css(KABUTO.line, 0.8), 0.3 * s, 0.03);
            // 天辺の座（金）
            const q = g.at(35.1, 90);
            const c = rig.p(add(q.p, [0, 0, 0.05]));
            ctx.fillStyle = css(GOLD.base);
            ctx.beginPath();
            ctx.ellipse(c[0], c[1], 0.45 * s, 0.25 * s, 0, 0, TAU);
            ctx.fill();
        },
    });
    // 眉庇（まびさし）
    band(rig, R(32.35, 2.82, 3.02, -0.05), R(31.9, 3.05, 3.5, 0.05), 20, 160, PLATE, {
        depth: hd + 0.45,
        line: 0.8,
        cast: 0.35,
    });
    // 前立（金の三日月）：鉢の前、眉庇の上から立ち上がる
    const front = 3.35;
    const zc = 36.35;
    const pts: V3[] = [];
    for (let k = 0; k <= 12; k++) {
        const a = ((194 + (152 * k) / 12) * Math.PI) / 180;
        pts.push([2.35 * Math.cos(a), front, zc + 2.35 * Math.sin(a)]);
    }
    for (let k = 12; k >= 0; k--) {
        const a = ((200 + (140 * k) / 12) * Math.PI) / 180;
        pts.push([1.8 * Math.cos(a), front + 0.05, zc + 0.45 + 1.8 * Math.sin(a)]);
    }
    const md = rig.depth(rig.w([0, front, 33.5]));
    plate(rig, pts, GOLD, { depth: md + 0.1, line: 0.8, cast: 0.25, smooth: true });
    // 前立の台
    ellipsoid(rig, [0, front - 0.15, 33.55], [[0.42, 0, 0], [0, 0.2, 0], [0, 0, 0.55]], GOLD, { depth: md + 0.12, line: 0.7, rim: 0, cast: 0 });
}

/** 槍：柄・口金・穂（笹穂）。コマの上端に収まるよう、向きによって穂先の高さを少し変える。 */
function drawSpear(rig: Rig, x: number, y: number): void {
    const s = rig.s;
    const Y = rig.w([x, y, 0])[1];
    const tipZ = Math.min(37.0, CHARACTER.h * CHARACTER.oy + Y * K - 0.55);
    const blade = 4.4;
    const top = tipZ - blade;
    const butt = Math.max(1.2, top - 30.5);
    tube(rig, [x, y, butt], [x, y, top], 0.3, 0.27, SHAFT, {
        line: 0.7,
        bias: 0.9,
        cast: 0.2,
        detail: (ctx, g) => {
            // 石突と口金
            for (const [t0, t1, col] of [
                [0, 0.03, IRON.lit],
                [0.965, 1, GOLD.base],
            ] as [number, number, RGB][]) {
                const a = rig.p(g.at(t0, 90).p);
                const b = rig.p(g.at(t1, 90).p);
                ctx.strokeStyle = css(col);
                ctx.lineWidth = 0.62 * s;
                ctx.lineCap = 'butt';
                ctx.beginPath();
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(b[0], b[1]);
                ctx.stroke();
                ctx.lineCap = 'round';
            }
        },
    });
    // 穂：前後・左右の 2 枚で、どの向きでも細い菱形に見える
    const prof = [0, 0.18, 0.4, 0.62, 0.82, 1];
    const wid = [0.16, 0.5, 0.62, 0.52, 0.3, 0];
    const leaf = (ax: V3, wmax: number, bias: number): Shape => {
        const pts: V3[] = [];
        for (let k = 0; k < prof.length; k++) pts.push(add([x, y, top + prof[k] * blade], scl(ax, wid[k] * wmax)));
        for (let k = prof.length - 2; k >= 0; k--) pts.push(add([x, y, top + prof[k] * blade], scl(ax, -wid[k] * wmax)));
        return plateShape(rig, pts, STEEL, {
            bias,
            line: 0.8,
            cast: 0.1,
            smooth: true,
            detail: (ctx, sp) => {
                // 鎬（しのぎ）の筋
                const a = rig.p(rig.w([x, y, top + 0.2]));
                const b = sp[prof.length - 1];
                ctx.strokeStyle = css(STEEL.lit, 0.9);
                ctx.lineWidth = 0.14 * s;
                ctx.beginPath();
                ctx.moveTo(a[0], a[1]);
                ctx.lineTo(b[0], b[1]);
                ctx.stroke();
            },
        });
    };
    const l1 = leaf([1, 0, 0], 1.0, 0.95);
    const l2 = leaf([0, 1, 0], 0.55, 0.96);
    rig.push(Math.max(l1.d, l2.d), (ctx) => {
        drawShape(ctx, s, l1);
        drawShape(ctx, s, l2);
    });
}
