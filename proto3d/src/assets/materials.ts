/**
 * 3D 比較版の材質。落ち着いた和風のセミリアル：
 *   漆喰の白（真っ白にしない）、古びた杉・檜の木肌、弁柄格子、いぶし瓦、花崗岩の石、土の道。
 * 色の基準は 2D 版の PALETTE（src/render/art/spec.ts）にそろえ、彩度は抑える。
 * 質感は tex.ts で描いた絵（色＋法線）と、粗さ（roughness）で出す。
 */
import * as THREE from 'three';
import { fbm, hex, makeCanvas, mixRgb, noise, rgbOut, rng, tex, textured } from './tex';

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
    // ---- 漆喰：わずかなむら、下の方ほど少し汚れる ----
    const plaster = textured('plaster', [512, 512], (u, v) => {
        const n = fbm(u, v, 6, 5, 1);
        const fine = noise(u, v, 128, 3);
        const base = mixRgb(hex('#e7e0d0'), hex('#d6ccb6'), n * 0.8 + fine * 0.15);
        return [...rgbOut(base), 255, n * 0.6 + fine * 0.4];
    }, 1.2);

    // ---- 古びた木（縦の木目）：柱・梁・門扉 ----
    const woodTex = (name: string, dark: string, light: string, seed: number) =>
        textured(name, [256, 512], (u, v) => {
            const warp = fbm(u, v, 4, 3, seed) * 0.12;
            const grain = Math.sin((u + warp) * 90 + noise(u, v, 8, seed + 5) * 6) * 0.5 + 0.5;
            const rings = Math.pow(grain, 3);
            const blot = fbm(u, v, 3, 4, seed + 9);
            const c = mixRgb(hex(dark), hex(light), 0.25 + blot * 0.45 - rings * 0.25);
            return [...rgbOut(c), 255, grain * 0.7 + blot * 0.3];
        }, 2.2);
    const wood = woodTex('wood', '#3b2b20', '#6c5140', 11);
    const bengara = woodTex('bengara', '#3e2019', '#6d3a2b', 23);
    const timber = woodTex('timber', '#5d4633', '#8d6f52', 31);

    // ---- いぶし瓦（平瓦の重なりの段）：屋根の面に貼る ----
    const roofTile = textured('rooftile', [256, 256], (u, v) => {
        // v 方向に 4 段（1 段の下端が影になる）、u 方向に 2 列
        const row = (v * 4) % 1;
        const edge = row < 0.12 ? row / 0.12 : 1;
        const col = (u * 2) % 1;
        const trough = Math.abs(col - 0.5) * 2; // 谷は暗く
        const n = fbm(u, v, 8, 3, 41);
        const c = mixRgb(hex('#3a3f47'), hex('#6d747e'), 0.35 + n * 0.35 - (1 - edge) * 0.35 - trough * 0.1);
        return [...rgbOut(c), 255, edge * 0.8 + (1 - trough) * 0.4 + n * 0.2];
    }, 3);

    // ---- 石（花崗岩のまだら） ----
    const stone = textured('stone', [512, 512], (u, v) => {
        const n = fbm(u, v, 5, 5, 51);
        const speck = noise(u, v, 256, 52);
        const c = mixRgb(hex('#7f7a70'), hex('#b5afa2'), n * 0.9 + (speck > 0.8 ? 0.2 : 0) - (speck < 0.12 ? 0.25 : 0));
        return [...rgbOut(c), 255, n + speck * 0.3];
    }, 2.5);

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

    // ---- 地面：草地と土の道 ----
    const ground = textured('ground', [1024, 1024], (u, v) => {
        const n = fbm(u, v, 8, 5, 71);
        const m = fbm(u, v, 3, 3, 72);
        const blade = noise(u, v, 512, 73);
        const c = mixRgb(hex('#55703f'), hex('#8d9a5e'), n * 0.7 + blade * 0.25);
        const dry = mixRgb(c, hex('#9a915f'), Math.max(0, m - 0.55) * 1.6);
        return [...rgbOut(dry), 255, n * 0.5 + blade * 0.5];
    }, 2);
    const road = textured('road', [1024, 1024], (u, v) => {
        const n = fbm(u, v, 8, 5, 81);
        const pebble = noise(u, v, 200, 82);
        const rut = fbm(u, v, 2, 2, 83);
        let c = mixRgb(hex('#9c8667'), hex('#c3ad88'), n * 0.8);
        let hh = n * 0.4;
        if (pebble > 0.78) {
            c = mixRgb(c, hex('#8e877a'), 0.6);
            hh += (pebble - 0.78) * 4;
        }
        c = mixRgb(c, hex('#7f6b52'), Math.max(0, rut - 0.6) * 1.4);
        return [...rgbOut(c), 255, hh];
    }, 2.5);

    // ---- 布：小袖（藍の細かな織り）・袴（細い縞）・暖簾（藍に白い家紋） ----
    const kosode = textured('kosode', [256, 256], (u, v) => {
        const weave = (noise(u, v, 128, 91) + noise(u, v, 64, 92)) * 0.5;
        const c = mixRgb(hex('#27324a'), hex('#3f4c66'), 0.35 + weave * 0.4);
        return [...rgbOut(c), 255, weave];
    }, 1);
    const hakama = textured('hakama', [256, 256], (u, v) => {
        const stripe = Math.abs(((u * 24) % 1) - 0.5) < 0.12 ? 1 : 0;
        const weave = noise(u, v, 128, 95);
        const c = mixRgb(hex('#433e39'), hex('#5c5650'), 0.3 + weave * 0.3 + stripe * 0.25);
        return [...rgbOut(c), 255, weave * 0.6 + stripe * 0.4];
    }, 1);
    const noren = norenTexture();

    // ---- 髪（筋とつや） ----
    const hair = textured('hair', [128, 256], (u, v) => {
        const strand = noise(u * 1, v, 64, 101) * 0.6 + noise(u, v, 16, 102) * 0.4;
        const c = mixRgb(hex('#171513'), hex('#3a332c'), strand * 0.6);
        return [...rgbOut(c), 255, strand];
    }, 1.5);

    const face = faceTexture();

    return {
        plaster: std('漆喰', { ...plaster, roughness: 0.92 }),
        plasterWall: std('土塀の漆喰', { ...plaster, roughness: 0.95 }),
        wood: std('古材', { ...wood, roughness: 0.82 }),
        bengara: std('弁柄格子', { ...bengara, roughness: 0.75 }),
        timber: std('白木', { ...timber, roughness: 0.8 }),
        roof: std('いぶし瓦', { ...roofTile, roughness: 0.55, metalness: 0.15 }),
        roofTileRound: std('丸瓦', { color: 0x80858d, roughness: 0.5, metalness: 0.18, normalMap: roofTile.normalMap }),
        stone: std('石', { ...stone, roughness: 0.9 }),
        iron: std('鉄金具', { color: 0x2b2a28, roughness: 0.45, metalness: 0.6 }),
        dark: std('奥の暗がり', { color: 0x16130f, roughness: 1 }),
        bark: std('樹皮', { ...bark, roughness: 0.95 }),
        pineNeedles: std('松葉', { map: needles, alphaTest: 0.45, side: THREE.FrontSide, roughness: 0.85 }),
        pineCore: std('松葉の奥', { color: 0x2c3d25, roughness: 1 }),
        leaves: std('葉', { map: leaves, alphaTest: 0.45, side: THREE.FrontSide, roughness: 0.8 }),
        leafCore: std('葉の奥', { color: 0x3a4a28, roughness: 1 }),
        grassCard: std('草', { map: grassCard, alphaTest: 0.4, side: THREE.FrontSide, roughness: 0.9 }),
        ground: std('草地', { ...ground, roughness: 0.97 }),
        road: std('土の道', { ...road, roughness: 0.96 }),
        kosode: std('小袖', { ...kosode, roughness: 0.88 }),
        kosodeDark: std('襟', { color: 0x1f2940, roughness: 0.85 }),
        hakama: std('袴', { ...hakama, roughness: 0.9 }),
        himo: std('腰紐', { color: 0x8a7852, roughness: 0.8 }),
        noren: std('暖簾', { map: noren, side: THREE.DoubleSide, roughness: 0.9 }),
        skin: std('肌', { color: 0xe3bf9c, roughness: 0.62 }),
        face: std('顔', { map: face, roughness: 0.6 }),
        hair: std('髪', { ...hair, roughness: 0.45 }),
        cord: std('元結', { color: 0xe6e0d2, roughness: 0.7 }),
        tabi: std('足袋', { color: 0xe4ded0, roughness: 0.9 }),
        zori: std('草履', { color: 0xa88f62, roughness: 0.95 }),
        strap: std('鼻緒', { color: 0x5c2a24, roughness: 0.7 }),
        lacquer: std('黒漆の鞘', { color: 0x141211, roughness: 0.28, metalness: 0.1 }),
        tsuka: std('柄巻', { color: 0x2a2530, roughness: 0.7 }),
        brass: std('金具', { color: 0x9b7d3c, roughness: 0.35, metalness: 0.8 }),
    };
}

// ---------------------------------------------------------------------------

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
