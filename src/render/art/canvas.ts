/**
 * Canvas で仮素材を描くための小道具。各アートモジュールから使う。
 * 乱数は必ず seed つき（毎回同じ絵になるように）。
 */

export type Ctx = CanvasRenderingContext2D;

/** Phaser に登録するテクスチャ 1 枚分の定義 */
export interface TextureDef {
    key: string;
    /** Canvas の px */
    width: number;
    height: number;
    draw(ctx: Ctx): void;
    /** アトラスの場合のコマ（Canvas px） */
    frames?: { name: string; x: number; y: number; w: number; h: number }[];
}

/** seed つき乱数（mulberry32） */
export function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 整数座標のハッシュ（0〜1） */
export function hash2(x: number, y: number, seed = 0): number {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function createCanvas(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
}

export function context(c: HTMLCanvasElement): Ctx {
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D が使えません');
    return ctx;
}

/** 柔らかい楕円（中心が濃く外へ消える） */
export function softEllipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, alpha: number): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, withAlpha(color, alpha));
    g.addColorStop(0.55, withAlpha(color, alpha * 0.6));
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/** '#rrggbb' を rgba() にする */
export function withAlpha(color: string, alpha: number): string {
    if (color.startsWith('rgba') || color.startsWith('rgb')) {
        const nums = color.match(/[\d.]+/g) ?? ['0', '0', '0'];
        return `rgba(${nums[0]},${nums[1]},${nums[2]},${alpha})`;
    }
    const { r, g, b } = parseHex(color);
    return `rgba(${r},${g},${b},${alpha})`;
}

/** 2 色を混ぜる（t=0 で a、t=1 で b） */
export function mix(a: string, b: string, t: number): string {
    const A = parseHex(a);
    const B = parseHex(b);
    const f = (x: number, y: number) => Math.round(x + (y - x) * t);
    return `rgb(${f(A.r, B.r)},${f(A.g, B.g)},${f(A.b, B.b)})`;
}

/** 明るく（amt>0）／暗く（amt<0）する */
export function shade(color: string, amt: number): string {
    return amt >= 0 ? mix(color, '#ffffff', amt) : mix(color, '#000000', -amt);
}

export function parseHex(color: string): { r: number; g: number; b: number } {
    if (color.startsWith('rgb')) {
        const n = (color.match(/[\d.]+/g) ?? ['0', '0', '0']).map(Number);
        return { r: n[0], g: n[1], b: n[2] };
    }
    const h = color.replace('#', '');
    const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
    const v = parseInt(full, 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

/**
 * 値ノイズ（なめらかな雲模様）を Canvas に描く。低解像度で作って拡大するので軽い。
 * 返り値は Canvas（そのまま drawImage で重ねる）。
 */
export function valueNoiseCanvas(w: number, h: number, cell: number, seed: number, colorA: string, colorB: string): HTMLCanvasElement {
    const small = createCanvas(Math.ceil(w / cell) + 1, Math.ceil(h / cell) + 1);
    const sctx = context(small);
    const img = sctx.createImageData(small.width, small.height);
    const A = parseHex(colorA);
    const B = parseHex(colorB);
    for (let y = 0; y < small.height; y++) {
        for (let x = 0; x < small.width; x++) {
            const t = hash2(x, y, seed);
            const i = (y * small.width + x) * 4;
            img.data[i] = A.r + (B.r - A.r) * t;
            img.data[i + 1] = A.g + (B.g - A.g) * t;
            img.data[i + 2] = A.b + (B.b - A.b) * t;
            img.data[i + 3] = 255;
        }
    }
    sctx.putImageData(img, 0, 0);
    const out = createCanvas(w, h);
    const octx = context(out);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(small, 0, 0, small.width * cell, small.height * cell);
    return out;
}

/** 置き方の情報つきテクスチャ。spec はワールド px と基準点（地面に接する点）。 */
export interface ArtPiece extends TextureDef {
    spec: { w: number; h: number; ox: number; oy: number };
}

/** spec（ワールド px）× 解像度 tex の Canvas を持つ ArtPiece を作る */
export function piece(
    key: string,
    spec: { w: number; h: number; ox: number; oy: number },
    tex: number,
    draw: (ctx: Ctx, s: number) => void,
): ArtPiece {
    return {
        key,
        spec,
        width: Math.ceil(spec.w * tex),
        height: Math.ceil(spec.h * tex),
        draw: (ctx) => draw(ctx, tex),
    };
}
