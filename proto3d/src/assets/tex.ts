/**
 * 3D 比較版の質感（テクスチャ）。すべてこのファイルのコードで描く（外部の画像は使わない）。
 * - 乱数は seed つき（毎回同じ絵）。
 * - 繰り返して貼る模様は、周期つきのノイズで継ぎ目が出ないようにする。
 * - 凹凸は「高さの絵」から法線マップを作って付ける。
 */
import * as THREE from 'three';

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

function hash(x: number, y: number, s: number): number {
    let h = (x * 374761393 + y * 668265263 + s * 2147483647) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 周期 period（格子の数）でつながる値ノイズ。u,v は 0〜1。 */
export function noise(u: number, v: number, period: number, seed = 0): number {
    const x = u * period;
    const y = v * period;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const w = (n: number) => ((n % period) + period) % period;
    const a = hash(w(x0), w(y0), seed);
    const b = hash(w(x0 + 1), w(y0), seed);
    const c = hash(w(x0), w(y0 + 1), seed);
    const d = hash(w(x0 + 1), w(y0 + 1), seed);
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** 重ねたノイズ（0〜1 付近） */
export function fbm(u: number, v: number, period: number, octaves = 4, seed = 0): number {
    let sum = 0;
    let amp = 0.5;
    let p = period;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
        sum += noise(u, v, p, seed + i * 17) * amp;
        norm += amp;
        amp *= 0.5;
        p *= 2;
    }
    return sum / norm;
}

export interface Rgb {
    r: number;
    g: number;
    b: number;
}

export function hex(c: string): Rgb {
    const n = parseInt(c.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return { canvas, ctx: canvas.getContext('2d')! };
}

export type PixelFn = (u: number, v: number, x: number, y: number) => [number, number, number, number?, number?, number?];

/** 画素ごとに色・高さ・粗さを決める。fn は u,v（0〜1）から [r,g,b,a,height,roughness] を返す。 */
export function paint(
    w: number,
    h: number,
    fn: PixelFn,
): { color: HTMLCanvasElement; height: Float32Array; rough: Float32Array | null } {
    const { canvas, ctx } = makeCanvas(w, h);
    const img = ctx.createImageData(w, h);
    const height = new Float32Array(w * h);
    let rough: Float32Array | null = null;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const [r, g, b, a = 255, hh = 0, ro] = fn((x + 0.5) / w, (y + 0.5) / h, x, y);
            if (ro !== undefined) {
                rough ??= new Float32Array(w * h);
                rough[y * w + x] = ro;
            }
            const i = (y * w + x) * 4;
            img.data[i] = r;
            img.data[i + 1] = g;
            img.data[i + 2] = b;
            img.data[i + 3] = a;
            height[y * w + x] = hh;
        }
    }
    ctx.putImageData(img, 0, 0);
    return { color: canvas, height, rough };
}

/** 粗さの配列 → 粗さの絵（glTF の決まりどおり G に粗さ、B に金属度 0） */
export function roughnessMap(rough: Float32Array, w: number, h: number): HTMLCanvasElement {
    const { canvas, ctx } = makeCanvas(w, h);
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
        img.data[i * 4] = 255;
        img.data[i * 4 + 1] = Math.max(0, Math.min(255, rough[i] * 255));
        img.data[i * 4 + 2] = 0;
        img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

/** 高さの配列から法線マップ（OpenGL 形式・つながる）を作る */
export function normalMap(height: Float32Array, w: number, h: number, strength: number): HTMLCanvasElement {
    const { canvas, ctx } = makeCanvas(w, h);
    const img = ctx.createImageData(w, h);
    const at = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
            const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
            // 画像の y は下向き、テクスチャの v は上向き
            let nx = -dx;
            let ny = dy;
            let nz = 1;
            const l = Math.hypot(nx, ny, nz);
            nx /= l;
            ny /= l;
            nz /= l;
            const i = (y * w + x) * 4;
            img.data[i] = (nx * 0.5 + 0.5) * 255;
            img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
            img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

export function tex(canvas: HTMLCanvasElement, name: string, opts: { srgb?: boolean; repeat?: boolean } = {}): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(canvas);
    t.name = name;
    t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    if (opts.repeat !== false) {
        t.wrapS = THREE.RepeatWrapping;
        t.wrapT = THREE.RepeatWrapping;
    }
    t.anisotropy = 4;
    return t;
}

/** 色の絵・法線の絵をまとめて作る */
export function textured(
    name: string,
    size: [number, number],
    fn: PixelFn,
    bump: number,
    repeat = true,
): { map: THREE.CanvasTexture; normalMap?: THREE.CanvasTexture; roughnessMap?: THREE.CanvasTexture } {
    const [w, h] = size;
    const p = paint(w, h, fn);
    const out: { map: THREE.CanvasTexture; normalMap?: THREE.CanvasTexture; roughnessMap?: THREE.CanvasTexture } = {
        map: tex(p.color, `${name}-color`, { repeat }),
    };
    if (bump > 0) out.normalMap = tex(normalMap(p.height, w, h, bump), `${name}-normal`, { srgb: false, repeat });
    if (p.rough) out.roughnessMap = tex(roughnessMap(p.rough, w, h), `${name}-rough`, { srgb: false, repeat });
    return out;
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, v));
export function rgbOut(c: Rgb, k = 1): [number, number, number] {
    return [clamp255(c.r * k), clamp255(c.g * k), clamp255(c.b * k)];
}
