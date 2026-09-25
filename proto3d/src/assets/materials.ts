/**
 * 3D 比較版の材質。落ち着いた和風のセミリアル：
 *   漆喰の白（真っ白にしない）、古びた杉・檜の木肌、弁柄格子、いぶし瓦、花崗岩の石、土の道。
 * 色の基準は 2D 版の PALETTE（src/render/art/spec.ts）にそろえ、彩度は抑える。
 * 質感は tex.ts で描いた絵（色＋法線）と、粗さ（roughness）で出す。
 */
import * as THREE from 'three';
import { fbm, hex, makeCanvas, mixRgb, noise, normalMap as normalMapFrom, rgbOut, rng, roughnessMap, tex, textured } from './tex';

type Mat = THREE.MeshStandardMaterial;

function std(name: string, o: THREE.MeshStandardMaterialParameters): Mat {
    // 両面描画：手続きで作った面の向き（表裏）の誤りで、面が消えたり暗くなったりしないように
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, ...o });
    m.name = name;
    return m;
}

let cache: ReturnType<typeof build> | null = null;
export function materials(): ReturnType<typeof build> {
    cache ??= build();
    return cache;
}

function build() {
    // ---- 漆喰：温かみのある白。こて跡の大きなうねりはごく弱く、砂の細かな凹凸を法線で出す ----
    //   汚れ（雨だれ・足元の泥はね）は場所に理由があるので、絵には入れず、壁の形の頂点色で付ける（house.ts）
    const plaster = textured('plaster', [512, 512], (u, v) => {
        const trowel = fbm(u + 0.15 * Math.sin(v * 6.283 * 2), v, 3, 3, 1); // 横に流れるこて跡
        const sand = noise(u, v, 256, 3) * 0.6 + noise(u, v, 128, 4) * 0.4;
        const c = mixRgb(hex('#e4ddcc'), hex('#d8cfbb'), trowel * 0.55 + sand * 0.12);
        return [...rgbOut(c), 255, trowel * 0.35 + sand * 0.65, 0.9 + sand * 0.07];
    }, 1.6);

    // ---- 木：木目は v（絵の縦）に沿って走る。細い筋・ゆるいうねり・ごくまれな節 ----
    //   木の部材は geo.ts の木目用の箱（grain）で、長い方向に木目がそろう
    const woodTex = (name: string, dark: string, light: string, seed: number, paint = 0) =>
        textured(name, [256, 1024], (u, v) => {
            const warp = fbm(u * 0.5, v, 2, 3, seed) * 0.9 + Math.sin(v * 6.283 * 2 + u * 3) * 0.08;
            const w = u * 34 + warp;
            const f = w - Math.floor(w);
            const line = Math.max(0, 1 - Math.abs(f - 0.5) / 0.09); // 細い濃い筋
            const late = Math.pow(Math.abs(Math.sin(w * Math.PI)), 6); // 年輪の晩材
            const streak = fbm(u * 2, v * 0.5, 4, 3, seed + 5);
            const knotD = Math.hypot((u - 0.62) * 4, (v - 0.37) * 1.4);
            const knot = knotD < 0.18 ? 1 - knotD / 0.18 : 0;
            let c = mixRgb(hex(dark), hex(light), 0.35 + streak * 0.45 - late * 0.18 - line * 0.25 - knot * 0.35);
            // 塗り（弁柄）は角や筋でわずかに剝げ、下地の木色がのぞく
            if (paint > 0) c = mixRgb(c, hex('#7a5a44'), Math.max(0, streak - 0.72) * paint);
            const h = 0.55 - line * 0.35 - late * 0.1 + knot * 0.2; // 風化して柔らかい部分がやせ、筋が残る
            return [...rgbOut(c), 255, h, 0.72 + line * 0.12 + (1 - streak) * 0.08];
        }, 2.4);
    const wood = woodTex('wood', '#2f231b', '#5a4434', 11);
    const bengara = woodTex('bengara', '#4a2219', '#743a28', 23, 1.2);
    const timber = woodTex('timber', '#6b563f', '#9a8264', 31);

    // ---- いぶし瓦：銀鼠。1 枚ごとにわずかに色が違い、棟から軒へ雨の筋がごく薄く流れる ----
    const roofTile = textured('rooftile', [256, 512], (u, v) => {
        // v 方向に 8 段（1 段の下端が影）、u 方向に 2 列。v は屋根の上から下
        const rowF = v * 8;
        const row = rowF - Math.floor(rowF);
        const col = u * 2;
        const cell = Math.floor(rowF) * 7 + Math.floor(col) * 13;
        const tint = (noise(cell * 0.137, 0.5, 64, 42) - 0.5) * 0.16; // 1 枚ごとの色の違い
        const edge = row < 0.1 ? row / 0.1 : 1;
        const trough = Math.abs((col - Math.floor(col)) - 0.5) * 2;
        const rain = fbm(u * 3, v * 0.25, 6, 3, 44);
        const n = noise(u, v, 128, 41);
        const c = mixRgb(hex('#3f4349'), hex('#6f7379'), 0.45 + tint - (1 - edge) * 0.4 - trough * 0.12 - Math.max(0, rain - 0.6) * 0.25 + n * 0.06);
        return [...rgbOut(c), 255, edge * 0.8 + (1 - trough) * 0.4 + n * 0.1, 0.38 + (1 - edge) * 0.2 + Math.max(0, rain - 0.55) * 0.3 + n * 0.08];
    }, 3);

    // ---- 石（花崗岩：細かな黒と白の粒） ----
    const stone = textured('stone', [512, 512], (u, v) => {
        const n = fbm(u, v, 5, 4, 51);
        const speck = noise(u, v, 256, 52);
        const speck2 = noise(u, v, 512, 53);
        let c = mixRgb(hex('#8b867c'), hex('#b3ad9f'), n * 0.8);
        if (speck > 0.78) c = mixRgb(c, hex('#3c3a36'), (speck - 0.78) * 3);
        if (speck2 > 0.85) c = mixRgb(c, hex('#d9d4c8'), (speck2 - 0.85) * 4);
        return [...rgbOut(c), 255, n * 0.7 + speck * 0.3, 0.8 + (1 - n) * 0.12];
    }, 2.2);

    // ---- 樹皮（松のうろこ状の皮） ----
    const bark = textured('bark', [256, 512], (u, v) => {
        const cell = noise(u * 1.0, v * 0.55, 10, 61);
        const cracks = Math.abs(noise(u, v, 12, 62) - 0.5) < 0.06 ? 0 : 1;
        const n = fbm(u, v, 6, 4, 63);
        const c = mixRgb(hex('#3b2e25'), hex('#7a6553'), cell * 0.6 + n * 0.3);
        const k = cracks ? 1 : 0.55;
        return [...rgbOut(c, k), 255, cell * 0.6 + cracks * 0.6 + n * 0.2];
    }, 3);

    // ---- 松の葉のかたまり（透けるカード用） ----
    const needles = needleTexture();
    // ---- 広葉樹の葉（透けるカード用） ----
    const leaves = leafTexture();
    // ---- 草（透けるカード用） ----
    const grassCard = grassCardTexture();

    // ---- 地面：草地（短い葉を描き重ねた絵。3.5m で 1 回）と、踏み固めた土の道（6m で 1 回） ----
    //   繰り返しの目立ちは、地面の形の頂点色（大きなむら・轍・縁）で崩す（ground.ts）
    const ground = grassGroundTexture();
    const road = textured('road', [1024, 1024], (u, v) => {
        const n = fbm(u, v, 6, 5, 81);
        const fine = noise(u, v, 512, 84);
        // 小石：丸い粒に上からの光の陰を付ける
        const gx = u * 90;
        const gy = v * 90;
        const cx = Math.floor(gx);
        const cy = Math.floor(gy);
        const has = noise(cx / 90 + 0.003, cy / 90 + 0.003, 90, 82) > 0.8;
        let c = mixRgb(hex('#8f7a5e'), hex('#b09a78'), n * 0.8 + fine * 0.12);
        let hh = n * 0.3 + fine * 0.15;
        let ro = 0.9;
        if (has) {
            // 粒の中心と大きさを格子ごとにずらす（規則的な並びに見えないように）
            const jx = noise(cx / 90 + 0.5, cy / 90 + 0.2, 90, 85) - 0.5;
            const jy = noise(cx / 90 + 0.2, cy / 90 + 0.5, 90, 86) - 0.5;
            const rad = 0.18 + 0.16 * noise(cx / 90 + 0.7, cy / 90 + 0.7, 90, 87);
            const dx = gx - cx - 0.5 - jx * 0.5;
            const dy = gy - cy - 0.5 - jy * 0.5;
            const d = Math.hypot(dx, dy);
            if (d < rad) {
                const k = 1 - d / rad;
                c = mixRgb(c, hex('#8a847a'), 0.45 * k + 0.15);
                c = mixRgb(c, hex('#b8b2a4'), Math.max(0, -dy / rad) * k * 0.35);
                hh += k * 0.6;
                ro = 0.75;
            }
        }
        return [...rgbOut(c), 255, hh, ro];
    }, 2.2);

    // ---- 布：小袖（藍木綿の綾織り。細かな斜めの畝）・袴（細い縞の仙台平ふう） ----
    const kosode = textured('kosode', [256, 256], (u, v) => {
        const twill = Math.sin((u * 64 + v * 64) * Math.PI * 2) * 0.5 + 0.5; // 斜めの畝
        const slub = noise(u, v, 32, 91);
        const fade = fbm(u, v, 4, 3, 92);
        const c = mixRgb(hex('#1f2a40'), hex('#34425d'), 0.3 + twill * 0.12 + slub * 0.15 + fade * 0.25);
        return [...rgbOut(c), 255, twill * 0.6 + slub * 0.4, 0.88 + twill * 0.06];
    }, 1.3);
    const hakama = textured('hakama', [256, 256], (u, v) => {
        const s1 = Math.abs(((u * 32) % 1) - 0.5) < 0.1 ? 1 : 0;
        const s2 = Math.abs(((u * 32 + 0.5) % 1) - 0.5) < 0.04 ? 1 : 0;
        const weave = Math.sin((u * 96 - v * 96) * Math.PI * 2) * 0.5 + 0.5;
        const c = mixRgb(hex('#39342f'), hex('#4c4640'), 0.35 + s1 * 0.25 - s2 * 0.12 + weave * 0.08);
        return [...rgbOut(c), 255, weave * 0.5 + s1 * 0.3, 0.9];
    }, 1.2);
    const noren = norenTexture();

    // ---- 髪（筋とつや） ----
    const hair = textured('hair', [128, 256], (u, v) => {
        const strand = noise(u * 1, v, 64, 101) * 0.6 + noise(u, v, 16, 102) * 0.4;
        const c = mixRgb(hex('#171513'), hex('#3a332c'), strand * 0.6);
        return [...rgbOut(c), 255, strand];
    }, 1.5);

    const face = faceTexture();

    return {
        plaster: std('漆喰', { ...plaster, roughness: 1 }),
        plasterWall: std('土塀の漆喰', { ...plaster, roughness: 0.95 }),
        wood: std('古材', { ...wood, roughness: 1 }),
        bengara: std('弁柄格子', { ...bengara, roughness: 1 }),
        timber: std('白木', { ...timber, roughness: 1 }),
        roof: std('いぶし瓦', { ...roofTile, roughness: 1, metalness: 0.12 }),
        roofTileRound: std('丸瓦', { color: 0x6c7076, roughness: 0.42, metalness: 0.12 }),
        stone: std('石', { ...stone, roughness: 1 }),
        iron: std('鉄金具', { color: 0x2b2a28, roughness: 0.45, metalness: 0.6 }),
        dark: std('奥の暗がり', { color: 0x16130f, roughness: 1 }),
        bark: std('樹皮', { ...bark, roughness: 0.95 }),
        pineNeedles: std('松葉', { map: needles, alphaTest: 0.45, side: THREE.FrontSide, roughness: 0.85 }),
        pineCore: std('松葉の奥', { color: 0x2c3d25, roughness: 1 }),
        leaves: std('葉', { map: leaves, alphaTest: 0.45, side: THREE.FrontSide, roughness: 0.8 }),
        leafCore: std('葉の奥', { color: 0x3a4a28, roughness: 1 }),
        grassCard: std('草', { map: grassCard, alphaTest: 0.4, side: THREE.FrontSide, roughness: 0.9 }),
        ground: std('草地', { ...ground, roughness: 0.97 }),
        road: std('土の道', { ...road, roughness: 1 }),
        kosode: std('小袖', { ...kosode, roughness: 1 }),
        kosodeDark: std('襟', { color: 0x1a2236, roughness: 0.9 }),
        hakama: std('袴', { ...hakama, roughness: 1 }),
        himo: std('腰紐', { color: 0x7d6a48, roughness: 0.85 }),
        noren: std('暖簾', { map: noren, side: THREE.DoubleSide, roughness: 0.9 }),
        skin: std('肌', { color: 0xd9b18d, roughness: 0.6 }),
        face: std('顔', { map: face, roughness: 0.6 }),
        hair: std('髪', { ...hair, roughness: 0.45 }),
        cord: std('元結', { color: 0xe6e0d2, roughness: 0.7 }),
        tabi: std('足袋', { color: 0xdcd5c5, roughness: 0.92 }),
        zori: std('草履', { color: 0xa88f62, roughness: 0.95 }),
        strap: std('鼻緒', { color: 0x5c2a24, roughness: 0.7 }),
        lacquer: std('黒漆の鞘', { color: 0x141211, roughness: 0.28, metalness: 0.1 }),
        tsuka: std('柄巻', { color: 0x2a2530, roughness: 0.7 }),
        brass: std('金具', { color: 0x9b7d3c, roughness: 0.35, metalness: 0.8 }),
    };
}

// ---------------------------------------------------------------------------

/**
 * 草地：土の色の地に、短い葉（線）を多数描き重ねる。端を越えた葉は反対側にも描いてつなげる。
 * 明るさから高さを取り、法線にする（葉の重なりの陰）。
 */
function grassGroundTexture(): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture } {
    const W = 1024;
    const { canvas, ctx } = makeCanvas(W, W);
    // 地：土と枯れ草が少し見える暗い緑
    const img = ctx.createImageData(W, W);
    for (let y = 0; y < W; y++) {
        for (let x = 0; x < W; x++) {
            const u = x / W;
            const v = y / W;
            // 1 枚の中に大きなむらを入れない（3.5m ごとに同じむらが並んで見えるため）。大きなむらは地面の頂点色で付ける
            const n = fbm(u, v, 32, 3, 71);
            const c = mixRgb(hex('#4a5634'), hex('#665f42'), n);
            const i = (y * W + x) * 4;
            img.data[i] = c.r;
            img.data[i + 1] = c.g;
            img.data[i + 2] = c.b;
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    const r = rng(77);
    const blade = (x: number, y: number, len: number, ang: number, col: string, wdt: number) => {
        for (const ox of [-W, 0, W]) {
            for (const oy of [-W, 0, W]) {
                const x0 = x + ox;
                const y0 = y + oy;
                if (x0 < -40 || x0 > W + 40 || y0 < -40 || y0 > W + 40) continue;
                ctx.strokeStyle = col;
                ctx.lineWidth = wdt;
                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.quadraticCurveTo(x0 + Math.cos(ang) * len * 0.5 + 2, y0 + Math.sin(ang) * len * 0.5, x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
                ctx.stroke();
            }
        }
    };
    ctx.lineCap = 'round';
    for (let i = 0; i < 26000; i++) {
        const x = r() * W;
        const y = r() * W;
        const t = r();
        const dry = r() < 0.12; // 枯れた葉は一様に少しだけ
        const g = dry
            ? `rgb(${128 + t * 36},${122 + t * 28},${80 + t * 20})`
            : `rgb(${70 + t * 48},${92 + t * 46},${52 + t * 26})`;
        blade(x, y, 7 + r() * 11, -Math.PI / 2 + (r() - 0.5) * 1.4, g, 1.2 + r() * 1.3);
    }
    // 明るさ → 高さ → 法線
    const data = ctx.getImageData(0, 0, W, W).data;
    const height = new Float32Array(W * W);
    const rough = new Float32Array(W * W);
    for (let i = 0; i < W * W; i++) {
        const l = (data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11) / 255;
        height[i] = l;
        rough[i] = 0.92 - l * 0.1;
    }
    return {
        map: tex(canvas, 'grassground-color'),
        normalMap: tex(normalMapFrom(height, W, W, 2.4), 'grassground-normal', { srgb: false }),
        roughnessMap: tex(roughnessMap(rough, W, W), 'grassground-rough', { srgb: false }),
    };
}

/** 松葉：細い線が放射状に集まった房をいくつも描く（透明の背景） */
function needleTexture(): THREE.CanvasTexture {
    const { canvas, ctx } = makeCanvas(256, 256);
    const r = rng(7);
    for (let k = 0; k < 26; k++) {
        const cx = 30 + r() * 196;
        const cy = 30 + r() * 196;
        const n = 40;
        for (let i = 0; i < n; i++) {
            const a = r() * Math.PI * 2;
            const len = 14 + r() * 22;
            const t = r();
            ctx.strokeStyle = `rgb(${30 + t * 38},${52 + t * 40},${32 + t * 22})`;
            ctx.lineWidth = 0.9 + r() * 0.6;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len * 0.8);
            ctx.stroke();
        }
    }
    return tex(canvas, 'needles-color', { repeat: false });
}

/** 広葉樹の葉：先の尖った楕円の葉を重ねる */
function leafTexture(): THREE.CanvasTexture {
    const { canvas, ctx } = makeCanvas(256, 256);
    const r = rng(9);
    for (let i = 0; i < 70; i++) {
        const x = 20 + r() * 216;
        const y = 20 + r() * 216;
        const a = r() * Math.PI * 2;
        const s = 10 + r() * 9;
        const t = r();
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.fillStyle = `rgb(${58 + t * 50},${80 + t * 50},${38 + t * 22})`;
        ctx.beginPath();
        ctx.moveTo(-s, 0);
        ctx.quadraticCurveTo(0, -s * 0.55, s, 0);
        ctx.quadraticCurveTo(0, s * 0.55, -s, 0);
        ctx.fill();
        ctx.strokeStyle = 'rgba(30,40,20,0.35)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-s, 0);
        ctx.lineTo(s, 0);
        ctx.stroke();
        ctx.restore();
    }
    return tex(canvas, 'leaves-color', { repeat: false });
}

/** 草：下から伸びる細い葉 */
function grassCardTexture(): THREE.CanvasTexture {
    const { canvas, ctx } = makeCanvas(256, 128);
    const r = rng(13);
    for (let i = 0; i < 90; i++) {
        const x = 8 + r() * 240;
        const h = 40 + r() * 80;
        const bend = (r() - 0.5) * 30;
        const t = r();
        ctx.strokeStyle = `rgb(${96 + t * 60},${118 + t * 45},${58 + t * 25})`;
        ctx.lineWidth = 2.5 + r() * 2.5;
        ctx.beginPath();
        ctx.moveTo(x, 128);
        ctx.quadraticCurveTo(x + bend * 0.3, 128 - h * 0.6, x + bend, 128 - h);
        ctx.stroke();
    }
    return tex(canvas, 'grass-color', { repeat: false });
}

/** 暖簾：藍の布に白い丸の家紋、布の重なりの陰 */
function norenTexture(): THREE.CanvasTexture {
    const { canvas, ctx } = makeCanvas(256, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#26314b');
    g.addColorStop(1, '#324264');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    // 3 枚に分かれる切れ目
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (const x of [85, 170]) ctx.fillRect(x - 1, 70, 2, 186);
    // 家紋（丸に三つ引き両の略）
    ctx.strokeStyle = '#e8e2d2';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(128, 150, 42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#e8e2d2';
    for (const dy of [-20, 0, 20]) ctx.fillRect(100, 144 + dy, 56, 10);
    // 布目
    const r = rng(17);
    for (let i = 0; i < 1500; i++) {
        ctx.fillStyle = `rgba(255,255,255,${r() * 0.04})`;
        ctx.fillRect(r() * 256, r() * 256, 1, 1);
    }
    return tex(canvas, 'noren-color', { repeat: false });
}

/**
 * 顔（頭の球の UV に描く）。球の u=0.25 が正面、+u 側が本人の左。
 * 写実に寄せすぎず、落ち着いた表情の目・眉・口・鼻の陰を描く。
 */
function faceTexture(): THREE.CanvasTexture {
    const W = 512;
    const H = 256;
    const { canvas, ctx } = makeCanvas(W, H);
    // 肌の地（頬に少し赤み、あごの下は陰）
    ctx.fillStyle = '#e3bf9c';
    ctx.fillRect(0, 0, W, H);
    const cx = W * 0.25;
    const cheek = ctx.createRadialGradient(cx, H * 0.6, 5, cx, H * 0.6, 70);
    cheek.addColorStop(0, 'rgba(214,150,120,0.25)');
    cheek.addColorStop(1, 'rgba(214,150,120,0)');
    ctx.fillStyle = cheek;
    ctx.fillRect(0, 0, W, H);
    const eyeY = H * 0.53;
    const dx = W * 0.058;
    for (const s of [-1, 1]) {
        const ex = cx + s * dx;
        // 眼窩の陰
        const sh = ctx.createRadialGradient(ex, eyeY - 2, 2, ex, eyeY - 2, 20);
        sh.addColorStop(0, 'rgba(150,100,80,0.28)');
        sh.addColorStop(1, 'rgba(150,100,80,0)');
        ctx.fillStyle = sh;
        ctx.fillRect(ex - 24, eyeY - 24, 48, 44);
        // 白目
        ctx.fillStyle = '#efe8dc';
        ctx.beginPath();
        ctx.ellipse(ex, eyeY, 10, 4.2, 0, 0, Math.PI * 2);
        ctx.fill();
        // 瞳
        ctx.fillStyle = '#231a14';
        ctx.beginPath();
        ctx.ellipse(ex + s * -0.5, eyeY + 0.3, 4.6, 4.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillRect(ex - 2, eyeY - 2, 1.6, 1.6);
        // 上まぶたの線
        ctx.strokeStyle = '#2b1e17';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(ex - 11, eyeY + 0.5);
        ctx.quadraticCurveTo(ex, eyeY - 6.5, ex + 11, eyeY - 0.5);
        ctx.stroke();
        // 眉（きりっと上がる）
        ctx.strokeStyle = '#1e1714';
        ctx.lineWidth = 3.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const inner = ex - s * 9;
        const outer = ex + s * 12;
        ctx.moveTo(inner, eyeY - 13);
        ctx.quadraticCurveTo(ex, eyeY - 17.5, outer, eyeY - 15);
        ctx.stroke();
    }
    // 鼻筋と小鼻の陰
    ctx.strokeStyle = 'rgba(160,110,85,0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 3, eyeY + 6);
    ctx.lineTo(cx - 4, eyeY + 24);
    ctx.stroke();
    ctx.fillStyle = 'rgba(150,100,78,0.45)';
    ctx.beginPath();
    ctx.ellipse(cx, eyeY + 27, 7, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    // 口（引き結んだ口）
    ctx.strokeStyle = '#7d4a3c';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(cx - 10, eyeY + 40);
    ctx.quadraticCurveTo(cx, eyeY + 42, cx + 10, eyeY + 40);
    ctx.stroke();
    ctx.fillStyle = 'rgba(170,95,80,0.35)';
    ctx.beginPath();
    ctx.ellipse(cx, eyeY + 43.5, 7, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // あごの下・首の付け根は少し暗く
    const jaw = ctx.createLinearGradient(0, H * 0.78, 0, H);
    jaw.addColorStop(0, 'rgba(160,110,85,0)');
    jaw.addColorStop(1, 'rgba(160,110,85,0.35)');
    ctx.fillStyle = jaw;
    ctx.fillRect(0, H * 0.78, W, H * 0.22);
    return tex(canvas, 'face-color', { repeat: false });
}
