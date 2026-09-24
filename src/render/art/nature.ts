/**
 * 木・草むら・花と木の影。Canvas 2D で手続き的に描く「高解像度の 2D 絵」（ドット絵にしない）。
 *
 * 描き方の考え方
 * - 樹冠は「葉のかたまり（clump）」を奥（上）から手前（下）へ重ねる。かたまりごとに球として陰影を付け、
 *   小さな葉の筆致（楕円）を暗い色→明るい色の順に置く。手前のかたまりを置く前に、既に描いた部分へ
 *   柔らかい陰（source-atop）を落として、かたまり同士の前後を出す。
 * - 松は雲のような平たい「枝葉の段（pad）」と、曲がった幹。針葉は短い線の放射で描く。
 * - 光は左上やや手前から。木は WorldScene で左右反転されることがあるので、左右の明暗差は控えめにし、
 *   上面が明るく下面が暗い（上下の差）を主にしている。
 * - 輪郭線は「細い・色つき」：描き終えた絵の形を暗い緑で少し太らせて背面に敷く。
 * - 乱数はすべて seed つき（毎回同じ絵）。ctx.filter は使わない。
 */
import { FLOWER, FLOWER_VARIANTS, PALETTE, TREE, TUFT, TUFT_VARIANTS } from './spec';
import { context, createCanvas, piece, rng, softEllipse, withAlpha, type ArtPiece, type Ctx } from './canvas';

/** 木の種類：松・広葉樹 2 種（ケヤキ・青もみじ） */
export const TREE_KEYS = ['tree-pine', 'tree-broad-a', 'tree-broad-b'] as const;

/** 木の影：幹の根元が基準点（左寄り）。右やや上へ伸びる。夕方は WorldScene が右へ引き伸ばす。 */
const TREE_SHADOW = { w: 56, h: 20, ox: 12 / 56, oy: 0.5 };

export function treeArt(tex: number): ArtPiece[] {
    return [
        piece('tree-pine', TREE, tex, (ctx, s) => drawPine(ctx, s)),
        piece('tree-broad-a', TREE, tex, (ctx, s) => drawZelkova(ctx, s)),
        piece('tree-broad-b', TREE, tex, (ctx, s) => drawMaple(ctx, s)),
        piece('shadow-tree', TREE_SHADOW, tex, (ctx, s) => drawTreeShadow(ctx, s)),
    ];
}

export function tuftArt(tex: number): ArtPiece[] {
    const out: ArtPiece[] = [];
    for (let i = 0; i < TUFT_VARIANTS; i++) {
        out.push(piece(`tuft-${i}`, TUFT, tex, (ctx, s) => drawTuft(ctx, s, i)));
    }
    for (let i = 0; i < FLOWER_VARIANTS; i++) {
        out.push(piece(`flower-${i}`, FLOWER, tex, (ctx, s) => drawFlowers(ctx, s, i)));
    }
    return out;
}

// ===========================================================================
// 共通の小道具
// ===========================================================================

interface P {
    x: number;
    y: number;
}

const TAU = Math.PI * 2;

/** 樹冠の陰影に使う光（x:右, y:下, z:手前）。左右反転に耐えるよう、上からの成分を主にする。 */
const LEAF_LIGHT = norm3(-0.38, -0.74, 0.56);

function norm3(x: number, y: number, z: number): { x: number; y: number; z: number } {
    const l = Math.hypot(x, y, z);
    return { x: x / l, y: y / l, z: z / l };
}

function clamp(v: number, a: number, b: number): number {
    return v < a ? a : v > b ? b : v;
}

/** 点列を Catmull-Rom でなめらかにつないだ点を返す */
function spline(pts: P[], per: number): P[] {
    const out: P[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        for (let k = 0; k < per; k++) {
            const t = k / per;
            const t2 = t * t;
            const t3 = t2 * t;
            const f = (a: number, b: number, c: number, d: number) =>
                0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
            out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
        }
    }
    out.push(pts[pts.length - 1]);
    return out;
}

/** 3 次ベジェを n 分割した点 */
function bezier(p0: P, p1: P, p2: P, p3: P, n: number): P[] {
    const out: P[] = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const c = 3 * u * t * t;
        const d = t * t * t;
        out.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y });
    }
    return out;
}

/** 線に沿って幅が変わる帯（先細りの葉・幹）を塗る。w(t) は 0〜1 の位置での幅。 */
function taper(ctx: Ctx, pts: P[], w: (t: number) => number, fill: string | CanvasGradient): void {
    const n = pts.length;
    const left: P[] = [];
    const right: P[] = [];
    for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(n - 1, i + 1)];
        let tx = b.x - a.x;
        let ty = b.y - a.y;
        const l = Math.hypot(tx, ty) || 1;
        tx /= l;
        ty /= l;
        const hw = w(i / (n - 1)) / 2;
        left.push({ x: pts[i].x - ty * hw, y: pts[i].y + tx * hw });
        right.push({ x: pts[i].x + ty * hw, y: pts[i].y - tx * hw });
    }
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
}

/** 楕円を 1 つのパスに追加する（まとめて塗るため、前の図形とつながらないよう moveTo してから） */
function addEllipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot: number): void {
    ctx.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot));
    ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
}

/**
 * 描き終えた絵の形を少し太らせて、色つきの細い輪郭として背面に敷く（destination-over）。
 * width は Canvas px。
 */
function outlineBehind(ctx: Ctx, color: string, width: number): void {
    const c = ctx.canvas;
    const sil = createCanvas(c.width, c.height);
    const sc = context(sil);
    sc.drawImage(c, 0, 0);
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = color;
    sc.fillRect(0, 0, sil.width, sil.height);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-over';
    const d = width;
    const k = d * 0.7071;
    for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [k, k], [-k, k], [k, -k], [-k, -k]]) {
        ctx.drawImage(sil, dx, dy);
    }
    ctx.restore();
}

/** 既に描いた部分にだけ柔らかい陰を落とす（手前の物の後ろを暗くして前後を出す） */
function occlude(ctx: Ctx, x: number, y: number, rx: number, ry: number, color: string, alpha: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, rx * 0.45, 0, 0, rx);
    g.addColorStop(0, withAlpha(color, alpha));
    g.addColorStop(0.6, withAlpha(color, alpha * 0.45));
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, TAU);
    ctx.fill();
    ctx.restore();
}

// ===========================================================================
// 幹・枝
// ===========================================================================

interface Bark {
    base: string;
    light: string;
    dark: string;
    line: string;
    /** 樹皮の模様：松は亀甲状の割れ、広葉樹はなめらか */
    texture: 'plates' | 'smooth';
}

/**
 * 幹や枝を 1 本描く。ctrl は根元→先端の制御点（ワールド px）。
 * 光の当たる側（左上）を明るく、反対側を暗く。flare は根元の広がり。
 */
function limb(ctx: Ctx, ctrl: P[], w0: number, w1: number, bark: Bark, rand: () => number, flare = 0): void {
    const c = spline(ctrl, 7);
    const n = c.length;
    const nx: number[] = [];
    const ny: number[] = [];
    const w: number[] = [];
    for (let i = 0; i < n; i++) {
        const a = c[Math.max(0, i - 1)];
        const b = c[Math.min(n - 1, i + 1)];
        let tx = b.x - a.x;
        let ty = b.y - a.y;
        const l = Math.hypot(tx, ty) || 1;
        tx /= l;
        ty /= l;
        let px = -ty;
        let py = tx;
        // 法線は光の来る側（左上）を正にする
        if (px * -0.72 + py * -0.69 < 0) {
            px = -px;
            py = -py;
        }
        nx.push(px);
        ny.push(py);
        const t = i / (n - 1);
        let ww = w0 + (w1 - w0) * Math.pow(t, 0.85);
        if (flare > 0) ww *= 1 + flare * Math.pow(Math.max(0, 1 - t / 0.16), 2);
        w.push(ww);
    }
    // 帯：オフセット a〜b（幅に対する比、+ が明るい側）
    const band = (a: number, b: number, color: string, extra = 0) => {
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const o = b * w[i] + (b > 0 ? extra : -extra);
            const x = c[i].x + nx[i] * o;
            const y = c[i].y + ny[i] * o;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        for (let i = n - 1; i >= 0; i--) {
            const o = a * w[i] + (a > 0 ? extra : -extra);
            ctx.lineTo(c[i].x + nx[i] * o, c[i].y + ny[i] * o);
        }
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
    };
    band(-0.5, 0.5, bark.line, 0.28);
    // 先端を丸く
    const e = c[n - 1];
    ctx.fillStyle = bark.base;
    ctx.beginPath();
    ctx.arc(e.x, e.y, w[n - 1] * 0.5, 0, TAU);
    ctx.fill();
    band(-0.5, 0.5, bark.base);
    band(-0.5, -0.05, withAlpha(bark.dark, 0.55));
    band(-0.5, -0.28, withAlpha(bark.dark, 0.55));
    band(0.1, 0.44, withAlpha(bark.light, 0.5));
    band(0.2, 0.38, withAlpha(bark.light, 0.45));

    // 樹皮の模様
    ctx.save();
    ctx.lineCap = 'round';
    if (bark.texture === 'plates') {
        // 亀甲状の割れ目：横向きの短い割れと、縦のつなぎ
        ctx.strokeStyle = withAlpha(bark.line, 0.75);
        ctx.lineWidth = 0.22;
        ctx.beginPath();
        let acc = 0;
        for (let i = 1; i < n - 2; i++) {
            acc += Math.hypot(c[i].x - c[i - 1].x, c[i].y - c[i - 1].y);
            if (acc < 1.15 || w[i] < 1.3) continue;
            acc = 0;
            const tx = -ny[i];
            const ty = nx[i];
            const rows = 2 + Math.floor(rand() * 2);
            for (let k = 0; k < rows; k++) {
                const o0 = (-0.46 + rand() * 0.5) * w[i];
                const o1 = o0 + (0.2 + rand() * 0.3) * w[i];
                const sl = (rand() - 0.5) * 0.7;
                ctx.moveTo(c[i].x + nx[i] * o0, c[i].y + ny[i] * o0);
                ctx.lineTo(c[i].x + nx[i] * o1 + tx * sl, c[i].y + ny[i] * o1 + ty * sl);
                if (rand() < 0.6) {
                    const oc = (o0 + o1) / 2;
                    ctx.moveTo(c[i].x + nx[i] * oc, c[i].y + ny[i] * oc);
                    ctx.lineTo(c[i].x + nx[i] * oc + tx * 1.1, c[i].y + ny[i] * oc + ty * 1.1);
                }
            }
        }
        ctx.stroke();
        // 明るい側の板状の樹皮
        ctx.fillStyle = withAlpha(bark.light, 0.35);
        ctx.beginPath();
        for (let i = 2; i < n - 2; i += 2) {
            if (w[i] < 1.3) continue;
            const o = (0.12 + rand() * 0.25) * w[i];
            addEllipse(ctx, c[i].x + nx[i] * o, c[i].y + ny[i] * o, 0.25 + rand() * 0.25, 0.4 + rand() * 0.3, Math.atan2(ny[i], nx[i]));
        }
        ctx.fill();
    } else {
        // なめらかな樹皮：縦の淡い筋と、明るい斑
        ctx.strokeStyle = withAlpha(bark.dark, 0.35);
        ctx.lineWidth = 0.18;
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
            const o = -0.3 + k * 0.22 + (rand() - 0.5) * 0.08;
            let started = false;
            for (let i = 0; i < n - 1; i++) {
                if (rand() < 0.12) {
                    started = false;
                    continue;
                }
                const x = c[i].x + nx[i] * o * w[i];
                const y = c[i].y + ny[i] * o * w[i];
                if (!started) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
                started = true;
            }
        }
        ctx.stroke();
        ctx.fillStyle = withAlpha(bark.light, 0.35);
        ctx.beginPath();
        for (let i = 1; i < n - 1; i++) {
            if (rand() < 0.55 || w[i] < 1.2) continue;
            const o = (rand() - 0.2) * 0.4 * w[i];
            addEllipse(ctx, c[i].x + nx[i] * o, c[i].y + ny[i] * o, 0.2 + rand() * 0.3, 0.35 + rand() * 0.45, Math.atan2(ny[i], nx[i]));
        }
        ctx.fill();
    }
    ctx.restore();
}

// ===========================================================================
// 樹冠（広葉樹の葉のかたまり）
// ===========================================================================

interface Clump {
    x: number;
    y: number;
    r: number;
    /** 縦のつぶれ（1 = 円） */
    sy: number;
    /** 明るさの補正 */
    tone?: number;
}

interface Foliage {
    /** 暗→明の色 */
    ramp: string[];
    dabMin: number;
    dabMax: number;
    /** 葉の縦横比 */
    aspect: number;
    /** 1 px² あたりの葉の数 */
    density: number;
    /** かたまりの縁からはみ出す葉の割合 */
    ragged: number;
    /** 樹冠全体の上端・下端（下ほど暗くする） */
    top: number;
    bottom: number;
    /** かたまりの後ろに落とす陰の色 */
    occ: string;
}

function paintClumps(ctx: Ctx, clumps: Clump[], f: Foliage, rand: () => number): void {
    const L = LEAF_LIGHT;
    const levels = f.ramp.length;
    // 樹冠全体を 1 つの大きな球とみなした陰影（かたまりの陰影と合成して、全体の立体感を出す）
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of clumps) {
        minX = Math.min(minX, c.x - c.r);
        maxX = Math.max(maxX, c.x + c.r);
        minY = Math.min(minY, c.y - c.r * c.sy);
        maxY = Math.max(maxY, c.y + c.r * c.sy);
    }
    const ccx = (minX + maxX) / 2;
    const ccy = (minY + maxY) / 2;
    const crx = (maxX - minX) / 2;
    const cry = (maxY - minY) / 2;
    const lightAt = (x: number, y: number, u: number, v: number, tone: number): number => {
        const nz = Math.sqrt(1 - Math.min(1, u * u + v * v));
        const lamClump = L.x * u + L.y * v + L.z * nz;
        const U = clamp((x - ccx) / crx, -1, 1);
        const V = clamp((y - ccy) / cry, -1, 1);
        const NZ = Math.sqrt(Math.max(0, 1 - Math.min(1, U * U + V * V)));
        const lamCrown = L.x * U + L.y * V + L.z * NZ;
        const cy = (y - f.top) / (f.bottom - f.top);
        return 0.36 + 0.3 * lamCrown + 0.26 * lamClump - 0.22 * cy + tone;
    };
    clumps.forEach((c, idx) => {
        if (idx > 0) occlude(ctx, c.x + 0.5, c.y + 1.2, c.r * 1.5, c.r * c.sy * 1.5, f.occ, 0.62);
        // 芯（葉の隙間から地面が透けないように）
        ctx.fillStyle = f.ramp[1];
        ctx.beginPath();
        ctx.ellipse(c.x + 0.2, c.y + 0.5, c.r * 0.8, c.r * c.sy * 0.8, 0, 0, TAU);
        ctx.fill();

        const buckets: number[][] = f.ramp.map(() => []);
        // 葉は「小枝ごとの房（spray）」で置く：房の中は色がそろい、房ごとに明暗が変わる
        const sprays = Math.round((f.density * Math.PI * c.r * c.r * c.sy) / 5);
        for (let k = 0; k < sprays; k++) {
            const a = rand() * TAU;
            let rr = Math.sqrt(rand());
            if (rand() < f.ragged) rr = 0.9 + rand() * 0.2;
            const u = Math.cos(a) * rr;
            const v = Math.sin(a) * rr;
            // 絵の端で切れないよう、房の中心を内側に収める
            const sx = clamp(c.x + u * c.r, 2.6, TREE.w - 2.6);
            const sy = clamp(c.y + v * c.r * c.sy, 2.4, TREE.h);
            const base = lightAt(sx, sy, u, v, c.tone ?? 0) + (rand() - 0.5) * 0.2;
            const leaves = 4 + Math.floor(rand() * 4);
            const spread = (f.dabMax + f.dabMin) * 0.9;
            for (let m = 0; m < leaves; m++) {
                const la = rand() * TAU;
                const ld = Math.sqrt(rand()) * spread;
                const x = sx + Math.cos(la) * ld;
                const y = sy + Math.sin(la) * ld * 0.85;
                // 房の上側ほど明るい
                const val = base + (-Math.sin(la) * ld) * 0.05 + (rand() - 0.5) * 0.1;
                const size = f.dabMin + (f.dabMax - f.dabMin) * rand() * (rr > 0.9 ? 0.8 : 1);
                const rot = la + (rand() - 0.5) * 0.9;
                // 絵の端をまたぐ葉は置かない（端で切れた直線の輪郭にならないように）
                if (x - size < 0.9 || x + size > TREE.w - 0.9 || y - size < 0.9) continue;
                buckets[clamp(Math.floor(val * levels), 0, levels - 1)].push(x, y, size, rot);
            }
        }
        const flush = (list: number[], color: string) => {
            if (!list.length) return;
            ctx.fillStyle = color;
            ctx.beginPath();
            for (let i = 0; i < list.length; i += 4) addEllipse(ctx, list[i], list[i + 1], list[i + 2], list[i + 2] * f.aspect, list[i + 3]);
            ctx.fill();
        };
        buckets.forEach((b, i) => flush(b, f.ramp[i]));
    });
}

// ===========================================================================
// 松（クロマツ）
// ===========================================================================

interface Pad {
    x: number;
    y: number;
    rx: number;
    ry: number;
}

const PINE_RAMP = ['#18281f', '#213728', '#2a432e', '#355236', '#42613f', '#527149', '#658253', '#7c9560', '#98a970'];

function paintPad(ctx: Ctx, p: Pad, top: number, bottom: number, rand: () => number, first: boolean): void {
    const ramp = PINE_RAMP;
    if (!first) occlude(ctx, p.x + 0.6, p.y + 1.4, p.rx * 1.35, p.ry * 1.7, '#101a14', 0.55);
    // 段の形：下が平らで、上が雲のようにふくらむ
    ctx.fillStyle = ramp[1];
    ctx.beginPath();
    addEllipse(ctx, p.x, p.y + p.ry * 0.22, p.rx, p.ry * 0.72, 0);
    const k = Math.max(3, Math.round(p.rx / 2.4));
    const bumps: { x: number; y: number; r: number }[] = [];
    for (let i = 0; i < k; i++) {
        const t = i / (k - 1);
        const bx = p.x - p.rx * 0.7 + t * p.rx * 1.4 + (rand() - 0.5) * 0.8;
        const by = p.y - p.ry * 0.1 - Math.sin(Math.PI * t) * p.ry * 0.38;
        const br = p.ry * (0.52 + rand() * 0.2) * (1 - Math.abs(t - 0.5) * 0.35);
        bumps.push({ x: bx, y: by, r: br });
        addEllipse(ctx, bx, by, br * 1.15, br, 0);
    }
    ctx.fill();

    // 針葉：短い線を放射状に（上向きの扇）
    const buckets: number[][] = ramp.map(() => []);
    const area = Math.PI * p.rx * p.ry;
    const count = Math.round(area * 1.05);
    for (let n = 0; n < count; n++) {
        const a = rand() * TAU;
        const rr = Math.sqrt(rand());
        const u = Math.cos(a) * rr;
        let v = Math.sin(a) * rr;
        // 上のふくらみに寄せる
        if (v < 0) v *= 1.02;
        const x = p.x + u * p.rx;
        const y = p.y + v * p.ry;
        let val = 0.6 - 0.62 * v - 0.12 * u;
        const cy = (y - top) / (bottom - top);
        val += 0.08 - 0.26 * cy + (rand() - 0.5) * 0.26;
        if (v > 0.55) val -= 0.25;
        const li = clamp(Math.floor(val * ramp.length), 0, ramp.length - 1);
        const needles = 4 + Math.floor(rand() * 3);
        const base = -Math.PI / 2 + u * 0.7;
        for (let m = 0; m < needles; m++) {
            const ang = base + (rand() - 0.5) * 2.3;
            const len = 0.9 + rand() * 0.9;
            buckets[li].push(x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len * 0.85);
        }
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.28;
    buckets.forEach((b, i) => {
        if (!b.length) return;
        ctx.strokeStyle = ramp[i];
        ctx.beginPath();
        for (let j = 0; j < b.length; j += 4) {
            ctx.moveTo(b[j], b[j + 1]);
            ctx.lineTo(b[j + 2], b[j + 3]);
        }
        ctx.stroke();
    });
    // 上面の光（ふくらみの左上に明るい針葉を少し）
    ctx.strokeStyle = withAlpha(ramp[8], 0.8);
    ctx.lineWidth = 0.24;
    ctx.beginPath();
    for (const b of bumps) {
        for (let m = 0; m < 9; m++) {
            const a = -Math.PI * (0.55 + rand() * 0.4);
            const x = b.x + Math.cos(a) * b.r * (0.55 + rand() * 0.4);
            const y = b.y + Math.sin(a) * b.r * (0.6 + rand() * 0.4);
            const ang = -Math.PI / 2 + (rand() - 0.6) * 1.6;
            const len = 0.7 + rand() * 0.7;
            ctx.moveTo(x, y);
            ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
        }
    }
    ctx.stroke();
}

function drawPine(ctx: Ctx, s: number): void {
    const rand = rng(1103);
    ctx.save();
    ctx.scale(s, s);
    const bark: Bark = { base: '#54473f', light: '#8b7868', dark: '#2c2420', line: '#241d1a', texture: 'plates' };
    // 枝（段の下へ伸びる）
    const branches: [P[], number, number][] = [
        [[{ x: 18.8, y: 46 }, { x: 16, y: 44.5 }, { x: 12.5, y: 43.2 }, { x: 9, y: 42.5 }], 1.7, 0.7],
        [[{ x: 19.2, y: 38 }, { x: 15, y: 35.5 }, { x: 10, y: 32.5 }], 1.7, 0.7],
        [[{ x: 20.5, y: 33 }, { x: 17.5, y: 27 }, { x: 14, y: 20.5 }], 1.5, 0.7],
        [[{ x: 22, y: 31 }, { x: 27, y: 31 }, { x: 31, y: 30.5 }, { x: 35, y: 30.2 }], 1.7, 0.7],
        [[{ x: 25, y: 23 }, { x: 28.5, y: 20.5 }, { x: 33, y: 19 }], 1.4, 0.6],
        [[{ x: 21.5, y: 41 }, { x: 25.5, y: 40.5 }, { x: 29.5, y: 39.5 }], 1.3, 0.6],
    ];
    for (const [pts, w0, w1] of branches) limb(ctx, pts, w0, w1, bark, rand);
    // 幹：根元から左へ傾き、上で右へ戻る
    limb(
        ctx,
        [{ x: 22.6, y: 62.4 }, { x: 21.2, y: 56 }, { x: 18.6, y: 48 }, { x: 18.9, y: 40 }, { x: 21.8, y: 32 }, { x: 24.8, y: 24 }, { x: 25.4, y: 17 }, { x: 24.6, y: 11.5 }],
        5.0,
        1.4,
        bark,
        rand,
        0.6,
    );
    // 段（上→下）
    const pads: Pad[] = [
        { x: 24.6, y: 9.6, rx: 7.2, ry: 4.4 },
        { x: 15, y: 18.6, rx: 8.2, ry: 4.1 },
        { x: 32.2, y: 17.8, rx: 7.8, ry: 3.9 },
        { x: 23.6, y: 23.4, rx: 5.2, ry: 3.1 },
        { x: 34.2, y: 29.4, rx: 8.2, ry: 4.1 },
        { x: 11.2, y: 31.2, rx: 8.8, ry: 4.2 },
        { x: 29.6, y: 38.6, rx: 5.2, ry: 2.9 },
        { x: 11.6, y: 41.6, rx: 7, ry: 3.3 },
    ];
    const top = 4;
    const bottom = 45;
    pads.forEach((p, i) => paintPad(ctx, p, top, bottom, rand, i === 0));
    ctx.restore();
    outlineBehind(ctx, 'rgba(22,32,24,0.9)', 0.3 * s);
    groundContact(ctx, s, 22.4, 6.5);
}

// ===========================================================================
// ケヤキ（大きな広葉樹。扇形に枝を広げ、こんもりした樹冠）
// ===========================================================================

const ZELKOVA_RAMP = ['#1c3024', '#26402c', '#314f34', '#3e5f3b', '#4d6f42', '#5f804b', '#739155', '#8aa262', '#a8b676'];

function drawZelkova(ctx: Ctx, s: number): void {
    const rand = rng(2207);
    ctx.save();
    ctx.scale(s, s);
    const bark: Bark = { base: '#6a5c50', light: '#9b8c7c', dark: '#3b322b', line: '#2c2520', texture: 'smooth' };
    // 枝分かれ（扇形）
    const limbs: [P[], number, number][] = [
        [[{ x: 21.4, y: 47 }, { x: 17.5, y: 41 }, { x: 13, y: 34 }, { x: 10, y: 27 }], 2.2, 0.8],
        [[{ x: 21.9, y: 47 }, { x: 20, y: 39 }, { x: 18.2, y: 30 }], 2.2, 0.9],
        [[{ x: 22.4, y: 47 }, { x: 24.8, y: 39 }, { x: 26.8, y: 30 }], 2.2, 0.9],
        [[{ x: 22.8, y: 47 }, { x: 27, y: 41 }, { x: 31.5, y: 34.5 }, { x: 34.5, y: 28 }], 2.0, 0.8],
    ];
    for (const [pts, w0, w1] of limbs) limb(ctx, pts, w0, w1, bark, rand);
    limb(ctx, [{ x: 22, y: 62.4 }, { x: 22.3, y: 57 }, { x: 21.8, y: 51.5 }, { x: 22.1, y: 46.2 }], 5.2, 3.6, bark, rand, 0.7);

    const clumps: Clump[] = [
        { x: 15.4, y: 11.5, r: 7.4, sy: 0.9 },
        { x: 23.1, y: 9.4, r: 8, sy: 0.9 },
        { x: 30.5, y: 12, r: 7.2, sy: 0.9 },
        { x: 9.4, y: 20, r: 6.8, sy: 0.9 },
        { x: 19, y: 18.6, r: 8.4, sy: 0.9 },
        { x: 28.2, y: 18.8, r: 8.2, sy: 0.9 },
        { x: 35.2, y: 21, r: 6.4, sy: 0.9 },
        { x: 11.8, y: 28.4, r: 7.4, sy: 0.88 },
        { x: 31.8, y: 28.6, r: 7.2, sy: 0.88 },
        { x: 22, y: 27.4, r: 8, sy: 0.88 },
        { x: 14.9, y: 36, r: 6.2, sy: 0.85, tone: -0.02 },
        { x: 29.7, y: 36.2, r: 6.2, sy: 0.85, tone: -0.02 },
        { x: 22.2, y: 33.6, r: 5.6, sy: 0.85, tone: -0.04 },
    ];
    paintClumps(
        ctx,
        clumps,
        { ramp: ZELKOVA_RAMP, dabMin: 0.75, dabMax: 1.45, aspect: 0.62, density: 1.35, ragged: 0.09, top: 2, bottom: 42, occ: '#0f1c14' },
        rand,
    );
    ctx.restore();
    outlineBehind(ctx, 'rgba(20,32,24,0.9)', 0.3 * s);
    groundContact(ctx, s, 22.1, 7);
}

// ===========================================================================
// 青もみじ（低く広がる段状の樹冠。明るく暖かみのある黄緑、葉先に少しだけ赤み）
// ===========================================================================

const MAPLE_RAMP = ['#2a4230', '#355434', '#44673a', '#577b40', '#6b8f49', '#82a254', '#9ab262', '#b3bf74', '#c7c886'];

function drawMaple(ctx: Ctx, s: number): void {
    const rand = rng(3301);
    ctx.save();
    ctx.scale(s, s);
    const bark: Bark = { base: '#6f6558', light: '#a39683', dark: '#3d352e', line: '#2e2823', texture: 'smooth' };
    const stems: [P[], number, number, number][] = [
        [[{ x: 21, y: 62.4 }, { x: 20.2, y: 57 }, { x: 17.6, y: 51 }, { x: 13.6, y: 45.5 }, { x: 9.5, y: 41 }], 3.2, 1.0, 0.5],
        [[{ x: 23.2, y: 62.4 }, { x: 24, y: 57 }, { x: 26.4, y: 51 }, { x: 30.4, y: 45.5 }, { x: 35, y: 41.5 }], 3.0, 1.0, 0.5],
        [[{ x: 22.2, y: 59 }, { x: 22.6, y: 52 }, { x: 21.4, y: 45 }, { x: 22.2, y: 37 }], 2.1, 0.9, 0],
        [[{ x: 16, y: 48.5 }, { x: 16.6, y: 43 }, { x: 15.4, y: 37 }], 1.2, 0.6, 0],
        [[{ x: 28.4, y: 48.5 }, { x: 28, y: 43 }, { x: 29.4, y: 37.5 }], 1.2, 0.6, 0],
    ];
    for (const [pts, w0, w1, fl] of stems) limb(ctx, pts, w0, w1, bark, rand, fl);

    const clumps: Clump[] = [
        { x: 22.4, y: 17.2, r: 7.6, sy: 0.74 },
        { x: 14.7, y: 20, r: 6.4, sy: 0.74 },
        { x: 29.9, y: 19.6, r: 6.8, sy: 0.74 },
        { x: 8.3, y: 28.4, r: 5.9, sy: 0.72 },
        { x: 16.7, y: 27, r: 7.2, sy: 0.72 },
        { x: 27.3, y: 26.6, r: 7.2, sy: 0.72 },
        { x: 35.9, y: 29, r: 5.8, sy: 0.72 },
        { x: 11.3, y: 36.6, r: 6.2, sy: 0.7 },
        { x: 21.6, y: 35, r: 7, sy: 0.7 },
        { x: 32, y: 36.8, r: 6.4, sy: 0.7 },
    ];
    paintClumps(
        ctx,
        clumps,
        {
            ramp: MAPLE_RAMP,
            dabMin: 0.55,
            dabMax: 1.1,
            aspect: 0.8,
            density: 1.7,
            ragged: 0.22,
            top: 8,
            bottom: 42,
            occ: '#14231a',
        },
        rand,
    );
    ctx.restore();
    outlineBehind(ctx, 'rgba(24,36,26,0.88)', 0.3 * s);
    groundContact(ctx, s, 22.1, 6.5);
}

/** 根元の接地の陰（絵の背面に敷く） */
function groundContact(ctx: Ctx, s: number, x: number, rx: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    softEllipse(ctx, x * s, 62.6 * s, rx * s, 2.1 * s, PALETTE.shadow, 0.42);
    ctx.restore();
}

// ===========================================================================
// 木の影（地面に落ちる。根元から右やや上へ、先に樹冠の丸い影）
// ===========================================================================

function drawTreeShadow(ctx: Ctx, s: number): void {
    const W = ctx.canvas.width;
    const off = W + 40 * s;
    const rand = rng(4409);
    ctx.save();
    // 形そのものは画面外に描き、ぼかした影だけを戻す（ctx.filter を使わないぼかし）
    ctx.setTransform(s, 0, 0, s, -off, 0);
    ctx.shadowColor = withAlpha(PALETTE.shadow, 0.44);
    ctx.shadowBlur = 2.6 * s;
    ctx.shadowOffsetX = off;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    // 幹の影（根元が太く、先へ細く）
    ctx.moveTo(11.2, 9.3);
    ctx.lineTo(27, 6.6);
    ctx.lineTo(27.5, 9.2);
    ctx.lineTo(12.2, 11.2);
    ctx.closePath();
    // 樹冠の影（いくつかの楕円のかたまり）
    const blobs = [
        [30.5, 9.4, 5.2, 3.8],
        [36.5, 7.4, 6.4, 4.4],
        [43, 8.4, 5.8, 4.4],
        [48.6, 9.6, 4.2, 3.4],
        [35, 11.4, 5, 3.4],
        [42, 12, 5.4, 3.2],
    ];
    for (const [x, y, rx, ry] of blobs) addEllipse(ctx, x, y, rx, ry, (rand() - 0.5) * 0.3);
    ctx.fill();
    ctx.restore();
    // 木漏れ日：影の中に少し明るい穴
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 6; i++) {
        const x = 32 + rand() * 16;
        const y = 6.5 + rand() * 6;
        softEllipse(ctx, x * s, y * s, (1.2 + rand() * 1.4) * s, (0.8 + rand() * 0.7) * s, '#000000', 0.26);
    }
    ctx.restore();
    // 根元のいちばん濃いところ
    softEllipse(ctx, 12.8 * s, 10 * s, 4.2 * s, 1.9 * s, PALETTE.shadow, 0.22);
}

// ===========================================================================
// 草むら（根元を中心に揺れる）
// ===========================================================================

interface BladeColors {
    base: string;
    tip: string;
}

/** 先細りの葉 1 枚。p0 根元、p1/p2 制御点、p3 先端。 */
function blade(ctx: Ctx, p0: P, p1: P, p2: P, p3: P, w: number, col: BladeColors): void {
    const pts = bezier(p0, p1, p2, p3, 10);
    const g = ctx.createLinearGradient(p0.x, p0.y, p3.x, p3.y);
    g.addColorStop(0, col.base);
    g.addColorStop(1, col.tip);
    taper(ctx, pts, (t) => w * (1 - t) ** 0.9 + 0.04, g);
}

function drawTuft(ctx: Ctx, s: number, variant: number): void {
    const rand = rng(5501 + variant * 131);
    ctx.save();
    ctx.scale(s, s);
    const bx = TUFT.w / 2;
    const by = TUFT.h - 0.35;
    // 根元の陰
    softEllipse(ctx, bx, by + 0.1, 4.6, 1.15, PALETTE.shadow, 0.32);

    if (variant === 2) {
        drawSusuki(ctx, bx, by, rand);
        ctx.restore();
        return;
    }
    const lush = variant === 1;
    const count = lush ? 17 : 13;
    const dark: BladeColors = lush ? { base: '#243a26', tip: '#3f5f37' } : { base: '#34492a', tip: '#56713d' };
    const mid: BladeColors = lush ? { base: '#2f4a2e', tip: '#5d7f45' } : { base: '#445e33', tip: '#7c9656' };
    const light: BladeColors = lush ? { base: '#3c5a36', tip: '#86a45e' } : { base: '#56713c', tip: '#a3b672' };
    // 奥（暗い・短い）→手前（明るい・長め）
    const blades: { x: number; lean: number; h: number; w: number; layer: number }[] = [];
    for (let i = 0; i < count; i++) {
        const layer = i < count * 0.4 ? 0 : i < count * 0.8 ? 1 : 2;
        const spread = lush ? 3.2 : 2.7;
        const x = bx + (rand() - 0.5) * spread * 2;
        const lean = (x - bx) * (0.7 + rand() * 0.9) + (rand() - 0.5) * 1.6;
        const hMax = lush ? 9.2 : 7.8;
        const h = hMax * (0.5 + rand() * 0.5) * (layer === 0 ? 0.92 : 1) * (1 - Math.abs(x - bx) * 0.07);
        blades.push({ x, lean, h, w: (lush ? 0.95 : 0.75) * (0.8 + rand() * 0.4), layer });
    }
    for (const b of blades) {
        const col = b.layer === 0 ? dark : b.layer === 1 ? mid : light;
        const tip = { x: clamp(b.x + b.lean, 0.5, TUFT.w - 0.5), y: by - b.h };
        blade(ctx, { x: b.x, y: by }, { x: b.x + b.lean * 0.1, y: by - b.h * 0.45 }, { x: b.x + b.lean * 0.55, y: by - b.h * 0.85 }, tip, b.w, col);
    }
    // 光の当たる葉先（左上）
    ctx.strokeStyle = withAlpha(lush ? '#a2bb74' : '#c0cc8a', 0.55);
    ctx.lineWidth = 0.18;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const b of blades) {
        if (b.layer === 0 || rand() < 0.35) continue;
        const tx = clamp(b.x + b.lean, 0.5, TUFT.w - 0.5);
        ctx.moveTo(b.x + b.lean * 0.45 - 0.12, by - b.h * 0.6);
        ctx.quadraticCurveTo(b.x + b.lean * 0.75 - 0.1, by - b.h * 0.85, tx, by - b.h);
    }
    ctx.stroke();
    ctx.restore();
}

/** ススキ：弓なりに垂れる細い葉と、淡い穂 */
function drawSusuki(ctx: Ctx, bx: number, by: number, rand: () => number): void {
    const leafDark: BladeColors = { base: '#4a5530', tip: '#7c7f4a' };
    const leaf: BladeColors = { base: '#5d6a38', tip: '#a39d62' };
    const leafLight: BladeColors = { base: '#6f7c42', tip: '#c1b77e' };
    // 葉（奥→手前）
    const n = 12;
    for (let i = 0; i < n; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const x = bx + (rand() - 0.5) * 2.2;
        const reach = 2.6 + rand() * 2.8;
        const h = 4.2 + rand() * 3.4;
        const p3 = { x: clamp(x + side * reach, 0.4, TUFT.w - 0.4), y: by - h * (0.45 + rand() * 0.3) };
        const col = i < 4 ? leafDark : i < 9 ? leaf : leafLight;
        blade(ctx, { x, y: by }, { x: x + side * 0.3, y: by - h * 0.7 }, { x: x + side * reach * 0.55, y: by - h * 1.05 }, p3, 0.62, col);
    }
    // 穂：細い茎の先から、羽のような細い枝が扇形に分かれて風下（右）へ垂れる
    const plumes = [
        { x: bx - 0.8, top: { x: bx - 2.2, y: 1.6 } },
        { x: bx + 0.2, top: { x: bx + 0.4, y: 0.7 } },
        { x: bx + 0.9, top: { x: bx + 2.6, y: 2.2 } },
    ];
    ctx.lineCap = 'round';
    const tones = ['#9f927c', '#c8baa3', '#e0d5bf'];
    for (const p of plumes) {
        const stem = bezier({ x: p.x, y: by }, { x: p.x, y: by - 4 }, { x: p.top.x - (p.top.x - p.x) * 0.3, y: p.top.y + 3 }, p.top, 12);
        ctx.strokeStyle = '#8d8458';
        ctx.lineWidth = 0.2;
        ctx.beginPath();
        stem.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
        ctx.stroke();
        // 枝ごとに、根元→先の順で小さな毛羽（楕円）を並べる。影側→明るい側の 3 層。
        const branches: P[][] = [];
        const nb = 5;
        for (let b = 0; b < nb; b++) {
            const a0 = -Math.PI / 2 + 0.25 + b * 0.3 + (rand() - 0.5) * 0.15;
            const len = 2.2 + rand() * 1.1;
            const p1 = { x: p.top.x + Math.cos(a0) * len * 0.45, y: p.top.y + Math.sin(a0) * len * 0.45 };
            const p3 = { x: Math.min(TUFT.w - 0.5, p.top.x + Math.cos(a0 + 0.7) * len), y: p.top.y + Math.sin(a0 + 0.7) * len + 0.9 };
            branches.push(bezier(p.top, p1, { x: (p1.x + p3.x) / 2 + 0.2, y: (p1.y + p3.y) / 2 - 0.2 }, p3, 7));
        }
        for (let layer = 0; layer < 3; layer++) {
            ctx.fillStyle = withAlpha(tones[layer], layer === 2 ? 0.75 : 0.85);
            ctx.beginPath();
            for (const br of branches) {
                for (let i = 1; i < br.length; i++) {
                    const q = br[i];
                    const ang = Math.atan2(q.y - br[i - 1].y, q.x - br[i - 1].x);
                    const size = 0.42 * (1 - i / (br.length + 2));
                    const dx = layer === 0 ? 0.12 : layer === 2 ? -0.1 : 0;
                    const dy = layer === 0 ? 0.12 : layer === 2 ? -0.1 : 0;
                    addEllipse(ctx, q.x + dx, q.y + dy, size * (layer === 2 ? 0.8 : 1.1), size * 0.42, ang);
                }
            }
            ctx.fill();
        }
    }
}

// ===========================================================================
// 地面の花（平らに置く小さな草花）
// ===========================================================================

function drawFlowers(ctx: Ctx, s: number, variant: number): void {
    const rand = rng(6607 + variant * 97);
    ctx.save();
    ctx.scale(s, s);
    const cx = FLOWER.w / 2;
    const cy = FLOWER.h / 2;
    // 葉（細長い葉を放射状に）
    const leafCols = ['#314b2c', '#40603a', '#557547'];
    for (let layer = 0; layer < 3; layer++) {
        ctx.fillStyle = leafCols[layer];
        ctx.beginPath();
        const n = layer === 0 ? 9 : 6;
        for (let i = 0; i < n; i++) {
            const a = rand() * TAU;
            const d = 0.8 + rand() * 2.4;
            const x = cx + Math.cos(a) * d * 1.2;
            const y = cy + Math.sin(a) * d * 0.7;
            addEllipse(ctx, x, y, 0.9 + rand() * 0.6, 0.3 + rand() * 0.12, a + (rand() - 0.5) * 0.6);
        }
        ctx.fill();
    }
    // 花
    const blossoms: { x: number; y: number; r: number; kind: number }[] = [];
    const count = variant === 0 ? 5 : 6;
    for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU + rand() * 0.8;
        const d = 0.6 + rand() * 2.4;
        blossoms.push({
            x: clamp(cx + Math.cos(a) * d * 1.35, 1.2, FLOWER.w - 1.2),
            y: clamp(cy + Math.sin(a) * d * 0.75, 1.1, FLOWER.h - 1.2),
            r: 0.62 + rand() * 0.22,
            kind: variant === 1 && i < 2 ? 1 : 0,
        });
    }
    blossoms.sort((a, b) => a.y - b.y);
    for (const b of blossoms) {
        // 落ちる小さな影
        softEllipse(ctx, b.x + 0.25, b.y + 0.35, b.r * 1.35, b.r * 0.8, PALETTE.shadow, 0.28);
        if (variant === 0) {
            petals(ctx, b.x, b.y, b.r, ['#a86a6c', '#c78d8a', '#dcaea4'], '#e8d7a4', rand);
        } else if (b.kind === 1) {
            // 露草（くすんだ青、2 枚の花びら）
            ctx.fillStyle = '#4f6596';
            ctx.beginPath();
            addEllipse(ctx, b.x - 0.35, b.y - 0.1, 0.5, 0.38, -0.3);
            addEllipse(ctx, b.x + 0.35, b.y - 0.1, 0.5, 0.38, 0.3);
            ctx.fill();
            ctx.fillStyle = '#7389b8';
            ctx.beginPath();
            addEllipse(ctx, b.x - 0.45, b.y - 0.22, 0.28, 0.2, -0.3);
            ctx.fill();
            ctx.fillStyle = '#d6b95c';
            ctx.beginPath();
            ctx.arc(b.x, b.y + 0.2, 0.14, 0, TAU);
            ctx.fill();
        } else {
            petals(ctx, b.x, b.y, b.r * 0.9, ['#bdb6a3', '#d9d3c1', '#ece6d4'], '#d8b85a', rand);
        }
    }
    ctx.restore();
}

/** 5 枚の花びら。colors は影→明の 3 色。 */
function petals(ctx: Ctx, x: number, y: number, r: number, colors: string[], center: string, rand: () => number): void {
    const rot = rand() * TAU;
    for (let layer = 0; layer < 3; layer++) {
        ctx.fillStyle = colors[layer];
        ctx.beginPath();
        for (let k = 0; k < 5; k++) {
            const a = rot + (k / 5) * TAU;
            // 光の当たる左上の花びらほど明るい層に
            const lit = -(Math.cos(a) * 0.6 + Math.sin(a) * 0.8);
            if (layer === 1 && lit < -0.3) continue;
            if (layer === 2 && lit < 0.35) continue;
            const d = r * (layer === 0 ? 0.62 : 0.58);
            const pr = r * (layer === 0 ? 0.55 : 0.46);
            addEllipse(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.72, pr, pr * 0.72, a);
        }
        ctx.fill();
    }
    ctx.fillStyle = center;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.22, 0, TAU);
    ctx.fill();
}
