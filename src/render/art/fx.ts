/**
 * 効果用の小さなテクスチャ（影・煙・粒子・光・周辺減光・水面の揺らぎ・地面の質感・吹き出し・日差し）。
 * 関数の形（export）は変えないこと。
 * これらは Canvas px で直接大きさを決める（ワールド換算は WorldScene 側で行う）。
 *
 * 描き方：
 * - ぼかし・光・影は「画素ごとに式で不透明度を計算」して putImageData で書く。
 *   ctx.filter を使わずに、輪や段差のない、なめらかな減衰を作れる。
 *   8bit に丸めるときに ±1/255 未満の揺らぎ（ディザ）を足し、引き伸ばしても縞が出ないようにする。
 * - 上下左右につながる模様（水面・地面の質感）は、周期つきの Perlin ノイズで作る。
 *   ノイズの周期をテクスチャの大きさに合わせるので、継ぎ目が出ない。
 * - 形のはっきりした小物（葉・吹き出し）は Canvas のパスで描く（輪郭がなめらか）。
 * - 乱数はすべて seed つき（hash2 / rng）。毎回同じ絵になる。
 * - いずれも起動時に 1 回だけ描く。全部で約 19 万画素（約 750KB）。開発機で合計 25〜35 ms ほど。
 *   なめらかな低周波の模様は粗い格子で計算して補間し、ディザは小さな表を使い回して軽くしている。
 */
import { LIGHT_DIR, PALETTE } from './spec';
import { hash2, parseHex, rng, type ArtPiece, type Ctx } from './canvas';

const px = (key: string, w: number, h: number, draw: ArtPiece['draw']): ArtPiece => ({
    key, width: w, height: h, draw, spec: { w, h, ox: 0.5, oy: 0.5 },
});

/**
 * - fx-shadow   64×32：足元などの柔らかい楕円の影（黒、中心の不透明度 1）
 * - fx-cast     64×32：細長く伸びる影。左端中央が根元（ox=0, oy=0.5）
 * - fx-smoke    64×64：煙のかたまり（白っぽい灰色）
 * - fx-mote     16×16：光の粒（白）
 * - fx-leaf     16×10：舞う葉
 * - fx-glow     128×128：温かい光の輪（加算合成用）
 * - fx-vignette 256×256：中央が透明で四隅が暗い
 * - fx-ripple   128×128：水面のきらめき（上下左右につながる模様。加算合成用）
 * - fx-detail   256×256：地面の細かい質感（つながる模様。乗算合成用。平均は白に近い灰）
 * - fx-bubble   48×40：話しかけられる印（吹き出し）。spec はワールド 12×10、下端中央が基準点
 * - fx-sun      128×128：画面左上から差す日差し（加算合成用。白〜透明のグラデーション。色は WorldScene で付ける）
 */
export function fxArt(): ArtPiece[] {
    return [
        px('fx-shadow', 64, 32, drawShadow),
        { ...px('fx-cast', 64, 32, drawCast), spec: { w: 64, h: 32, ox: 0, oy: 0.5 } },
        px('fx-smoke', 64, 64, drawSmoke),
        px('fx-mote', 16, 16, drawMote),
        px('fx-leaf', 16, 10, drawLeaf),
        px('fx-glow', 128, 128, drawGlow),
        px('fx-vignette', 256, 256, drawVignette),
        px('fx-ripple', 128, 128, drawRipple),
        px('fx-detail', 256, 256, drawDetail),
        { ...px('fx-bubble', 48, 40, drawBubble), spec: { w: 12, h: 10, ox: 0.5, oy: 1 } },
        px('fx-sun', 128, 128, drawSun),
    ];
}

// ===========================================================================
// 影
// ===========================================================================

/** 足元の接地影：中心が最も濃く、縁へ向かって傾き 0 で消える（輪郭の「段」が見えない） */
function drawShadow(ctx: Ctx): void {
    const cx = 32;
    const cy = 16;
    const rx = 31;
    const ry = 15;
    paintAlpha(ctx, 64, 32, PALETTE.shadow, 11, (x, y) => {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        const r2 = dx * dx + dy * dy;
        return r2 >= 1 ? 0 : Math.pow(1 - r2, 1.6);
    });
}

/**
 * 人物の伸びる影。左端中央が足元。
 * 足 → 肩 → 首 → 頭のふくらみを、とても柔らかくした形。根元ほど濃くくっきり、先ほど薄くぼける（半影が広がる）。
 * WorldScene は castAlpha / 0.3 を不透明度に掛けるので、夕方（castAlpha 0.3）でこの濃さがそのまま出る。
 * 建物・木の影（根元の不透明度 0.5 前後）と並んで同じ濃さに見えるよう、根元を 0.56 にしている。
 */
function drawCast(ctx: Ctx): void {
    // 長さ方向 u（0〜1）ごとの半幅（縦方向 -1〜1 に対する比率）
    const profile: [number, number][] = [
        [0, 0.34], [0.12, 0.5], [0.42, 0.72], [0.6, 0.86], [0.7, 0.8], [0.78, 0.56], [0.86, 0.6], [0.94, 0.42], [1, 0.1],
    ];
    const halfWidth = (u: number): number => {
        for (let i = 1; i < profile.length; i++) {
            const [u1, w1] = profile[i];
            if (u <= u1) {
                const [u0, w0] = profile[i - 1];
                const t = (u - u0) / (u1 - u0);
                return w0 + (w1 - w0) * t * t * (3 - 2 * t);
            }
        }
        return profile[profile.length - 1][1];
    };
    paintAlpha(ctx, 64, 32, PALETTE.shadow, 12, (x, y) => {
        const u = x / 64;
        const v = Math.abs(y - 16) / 15;
        const hw = halfWidth(u);
        const soft = 0.14 + 0.3 * u;
        const cover = 1 - smooth(hw - soft, hw + soft, v);
        const envelope = smooth(0, 0.08, u) * (1 - smooth(0.84, 0.995, u));
        const strength = 0.56 - 0.32 * u;
        return cover * envelope * strength;
    });
}

// ===========================================================================
// 煙・粒子・葉
// ===========================================================================

/**
 * 煙のかたまり：大きさの違う柔らかい塊をいくつか重ね、ゆるいノイズで密度にむらをつける。
 * 光の側（左上）の面を明るく、反対側を少し暗くして、厚みのあるふわっとした塊にする。
 */
function drawSmoke(ctx: Ctx): void {
    const R = rng(4201);
    // 下の太い塊から、上へ細くちぎれていく（丸い 1 つの円にしない）
    const blobs = [
        { x: 30, y: 37, r: 12.5, w: 0.95 },
        { x: 39, y: 32, r: 9.5, w: 0.7 },
        { x: 23, y: 31, r: 8.5, w: 0.6 },
        { x: 33, y: 25, r: 8, w: 0.55 },
        { x: 42, y: 41, r: 6.5, w: 0.45 },
        { x: 20, y: 41, r: 7, w: 0.5 },
        { x: 26, y: 18, r: 5, w: 0.32 },
        { x: 40, y: 20, r: 4.5, w: 0.26 },
    ].map((b) => ({ x: b.x + (R() - 0.5) * 2, y: b.y + (R() - 0.5) * 2, r: b.r * (0.92 + R() * 0.16), w: b.w }));
    const noise = perlin(8, 4202);
    // 密度を 1 回だけ計算して表にする
    const S = 64;
    const dens = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const px = x + 0.5;
            const py = y + 0.5;
            let d = 0;
            for (const b of blobs) {
                const dx = px - b.x;
                const dy = py - b.y;
                d += b.w * Math.exp(-(dx * dx + dy * dy) / (b.r * b.r));
            }
            const n = 0.5 + 0.5 * noise(px / 11, py / 11);
            const edge = 1 - smooth(23, 31.5, Math.hypot(px - 32, py - 32));
            dens[y * S + x] = d * (0.6 + 0.6 * n) * edge;
        }
    }
    const at = (x: number, y: number) => dens[Math.min(S - 1, Math.max(0, y)) * S + Math.min(S - 1, Math.max(0, x))];
    const lit = parseHex('#eeece6');
    const dark = parseHex('#aeaeac');
    const lx = Math.round(LIGHT_DIR.x * 5);
    const ly = Math.round(LIGHT_DIR.y * 5);
    paintRGBA(ctx, S, S, 13, (x, y, out) => {
        const xi = x | 0;
        const yi = y | 0;
        const d = dens[yi * S + xi];
        // 光の方へ密度が下がる = 光に向いた面
        const facing = d - at(xi + lx, yi + ly);
        const t = clamp01(0.62 + facing * 0.7);
        out[0] = dark.r + (lit.r - dark.r) * t;
        out[1] = dark.g + (lit.g - dark.g) * t;
        out[2] = dark.b + (lit.b - dark.b) * t;
        out[3] = (1 - Math.exp(-2.2 * d)) * 0.94;
    });
}

/** 光の粒：芯と柔らかいにじみ。蛍にも使う（色は WorldScene が付ける） */
function drawMote(ctx: Ctx): void {
    paintAlpha(ctx, 16, 16, '#fffdf6', 14, (x, y) => {
        const r = Math.hypot(x - 8, y - 8) / 7.6;
        if (r >= 1) return 0;
        const core = 0.9 * Math.exp(-((r / 0.2) ** 2));
        const halo = 0.42 * Math.exp(-((r / 0.5) ** 2));
        return Math.min(1, core + halo) * (1 - smooth(0.7, 1, r));
    });
}

/** 秋の葉（欅・桜のような細長い葉）。付け根は黄土、先は朱〜赤茶。上側を明るく、下側を暗く。 */
function drawLeaf(ctx: Ctx): void {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 葉柄
    ctx.strokeStyle = '#6f4a26';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0.7, 6.9);
    ctx.quadraticCurveTo(1.8, 6.2, 3.2, 5.6);
    ctx.stroke();
    // 葉身
    const blade = () => {
        ctx.beginPath();
        ctx.moveTo(3, 5.6);
        ctx.bezierCurveTo(4.6, 1.4, 10.2, 0.6, 15.3, 3.9);
        ctx.bezierCurveTo(11.4, 9.0, 5.4, 9.4, 3, 5.6);
        ctx.closePath();
    };
    const along = ctx.createLinearGradient(3, 6, 15.3, 3.9);
    along.addColorStop(0, '#c99a45');
    along.addColorStop(0.45, '#bf6d33');
    along.addColorStop(1, '#9c3f27');
    blade();
    ctx.fillStyle = along;
    ctx.fill();
    // 光：上半分を明るく、下半分を暗く
    const across = ctx.createLinearGradient(0, 1.2, 0, 9);
    across.addColorStop(0, 'rgba(255,238,200,0.28)');
    across.addColorStop(0.45, 'rgba(255,238,200,0)');
    across.addColorStop(0.6, 'rgba(40,16,8,0)');
    across.addColorStop(1, 'rgba(40,16,8,0.3)');
    ctx.fillStyle = across;
    ctx.fill();
    // 葉脈（主脈と側脈を薄く）
    ctx.strokeStyle = 'rgba(236,196,120,0.55)';
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.moveTo(3.4, 5.5);
    ctx.quadraticCurveTo(9, 4.4, 14.4, 4.1);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(236,196,120,0.3)';
    ctx.lineWidth = 0.35;
    for (const [sx, sy, ex, ey] of [
        [6.2, 5.05, 7.8, 2.4], [9.2, 4.6, 10.8, 2.3], [6.6, 5.0, 8.2, 7.5], [9.8, 4.5, 11.2, 6.8],
    ]) {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
    }
    // 輪郭（黒ではなく、葉の色を暗くした細い線）
    blade();
    ctx.strokeStyle = 'rgba(92,36,20,0.55)';
    ctx.lineWidth = 0.55;
    ctx.stroke();
    ctx.restore();
}

// ===========================================================================
// 光
// ===========================================================================

/**
 * 提灯・窓の灯り（加算合成）。小さな明るい芯のまわりに、遠くまで薄く届く光のにじみ。
 * 逆二乗に近い減衰を縁で傾き 0 になるよう窓掛けして、円盤の縁が見えないようにする。
 * 中心は白にせず、温かい色のまま（提灯の色を消さない）。
 */
function drawGlow(ctx: Ctx): void {
    const core = parseHex('#ffdca0');
    const mid = parseHex(PALETTE.lantern);
    const outer = parseHex('#ff9444');
    paintRGBA(ctx, 128, 128, 15, (x, y, out) => {
        const r = Math.hypot(x - 64, y - 64) / 63;
        if (r >= 1) {
            out[3] = 0;
            return;
        }
        const falloff = 0.42 / (1 + (r / 0.14) ** 2) + 0.55 * Math.exp(-((r / 0.55) ** 2));
        const win = 1 - smooth(0.5, 1, r);
        const t1 = smooth(0, 0.3, r);
        const t2 = smooth(0.3, 0.9, r);
        const c0 = core.r + (mid.r - core.r) * t1;
        const c1 = core.g + (mid.g - core.g) * t1;
        const c2 = core.b + (mid.b - core.b) * t1;
        out[0] = c0 + (outer.r - c0) * t2;
        out[1] = c1 + (outer.g - c1) * t2;
        out[2] = c2 + (outer.b - c2) * t2;
        out[3] = falloff * win;
    });
}

/**
 * 周辺減光：中央の広い範囲は透明のまま、四隅へ向かってなめらかに暗く（純黒ではなく墨色）。
 * 画面いっぱいに引き伸ばして薄く重ねるだけなので、なめらかな曲線を細かい色の区切り（32 段）で
 * 近似した Canvas の放射グラデーションで描く（画素ごとの計算より速い）。
 */
function drawVignette(ctx: Ctx): void {
    const { r, g, b } = parseHex('#0e1016');
    const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128 * Math.SQRT2);
    for (let i = 0; i <= 32; i++) {
        const t = i / 32;
        grad.addColorStop(t, `rgba(${r},${g},${b},${Math.pow(smooth(0.3, 1.05, t), 1.6).toFixed(4)})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
}

/**
 * 日差し（加算合成・色は WorldScene の tint）。左上の角が最も明るく、画面の対角線の 7 割ほどで消える。
 * ごく弱い光の筋（角度方向のむら）を入れて、斜めに差し込む夕日の空気感を出す。
 */
function drawSun(ctx: Ctx): void {
    const diag = 128 * Math.SQRT2;
    paintAlpha(ctx, 128, 128, '#ffffff', 17, (x, y) => {
        const r = Math.hypot(x, y) / diag;
        const base = Math.pow(1 - smooth(0, 0.92, r), 1.7);
        const th = Math.atan2(y, x);
        const rays = 1 + 0.08 * smooth(0.06, 0.4, r) * (0.6 * Math.sin(th * 11 + 1.3) + 0.4 * Math.sin(th * 19 + 0.4));
        return base * rays;
    });
}

// ===========================================================================
// 上下左右につながる模様
// ===========================================================================

/**
 * 水面のきらめき（加算合成で 2 枚を別の縮尺・向きに流す）。
 * - 小波の稜線の照り返し：横長の周期つきノイズの「0 の等高線」を細い光の線にする
 *   （斜め上から見た水面の小波は横に長い）。線の太さは勾配で割って一定に保つ。
 *   縦に曲がり込む所は光らせず、別のノイズで途切れさせて、短い光の筋が散らばるようにする。
 * - 小さな横長の照り（きらめき）をいくつか。
 * 大部分は透明で、明るいのは線と点だけ。
 */
function drawRipple(ctx: Ctx): void {
    const S = 128;
    const M = S - 1;
    // 小波の高さ（横 2 × 縦 10 格子 + 細かい横 4 × 縦 16 格子）。横に長く、ゆるく波打つ稜線になる。
    const waveA = perlin(2, 5101, 10);
    const waveB = perlin(4, 5102, 16);
    const h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const u = (x + 0.5) / S;
            const v = (y + 0.5) / S;
            h[y * S + x] = waveA(u * 2, v * 10) * 0.75 + waveB(u * 4, v * 16) * 0.25;
        }
    }
    const brk = perlin(4, 5103, 10);
    const breakup = upsample(S, 2, (x, y) => brk((x / S) * 4, (y / S) * 10));
    // きらめき：小さな横長の光を、周期を保って書き込む
    const glint = new Float32Array(S * S);
    const R = rng(5108);
    for (let i = 0; i < 9; i++) {
        const gx = R() * S;
        const gy = R() * S;
        const hx = 1.4 + R() * 2.2;
        const hy = 0.5 + R() * 0.3;
        const a = 0.45 + R() * 0.4;
        const ex = Math.ceil(hx * 3);
        const ey = Math.ceil(hy * 3);
        for (let oy = -ey; oy <= ey; oy++) {
            for (let ox = -ex; ox <= ex; ox++) {
                const px = Math.floor(gx) + ox;
                const py = Math.floor(gy) + oy;
                const dx = (px + 0.5 - gx) / hx;
                const dy = (py + 0.5 - gy) / hy;
                glint[(py & M) * S + (px & M)] += a * Math.exp(-(dx * dx + dy * dy));
            }
        }
    }
    paintAlpha(ctx, S, S, '#ffffff', 18, (x, y) => {
        const xi = x | 0;
        const yi = y | 0;
        const i = yi * S + xi;
        const hv = h[i];
        const gx = (h[yi * S + ((xi + 1) & M)] - h[yi * S + ((xi + M) & M)]) * 0.5;
        const gy = (h[((yi + 1) & M) * S + xi] - h[((yi + M) & M) * S + xi]) * 0.5;
        const gl = Math.sqrt(gx * gx + gy * gy) + 1e-4;
        const dist = Math.abs(hv) / gl; // 稜線までの px
        // 横向きの稜線だけを光らせる（縦に曲がり込む所は照り返さない）
        const flat = smooth(0.55, 0.92, Math.abs(gy) / gl);
        const crest = Math.exp(-((dist / 0.75) ** 2)) * flat;
        const halo = Math.exp(-((dist / 2.6) ** 2)) * flat;
        const b = breakup[i];
        const dash = smooth(0.15, 0.65, b);
        // 稜線の手前側のなだらかな面にも、ごく薄い照り
        const sheen = smooth(-0.2, 0.5, b) * smooth(0.1, 0.5, hv) * 0.05;
        return Math.min(1, (0.78 * crest + 0.12 * halo) * dash + sheen + glint[i]);
    });
}

/**
 * 地面の細かい質感（乗算合成・画面全体の地面に 1/4 の縮尺で敷く = 64 ワールド px ごとに繰り返す）。
 * 平均は約 0.94 の、ほぼ無彩色の白。
 * - 目立つ大きな模様は入れない（繰り返しが見えるので）。最も大きいむらでも 1 タイル（64 Canvas px）より小さい。
 * - 粒状のざらつき（1〜2 px）と、ごく小さな砂粒・小石の点（左上が明るく右下に小さな影）で、近くで見たときの締まりを出す。
 * - 点は「格子の中でずらす」配置にして、固まり（覚えやすい模様）ができないようにする。
 */
function drawDetail(ctx: Ctx): void {
    const S = 256;
    const M = S - 1;
    const n32 = perlin(8, 6101);
    const n16 = perlin(16, 6102);
    const n8 = perlin(32, 6103);
    // なめらかなむら（32・16・8 px の 3 段）は 2 px ごとの格子で計算し、下で補間して読む
    const G = S / 2;
    const smoothGrid = new Float32Array(G * G);
    for (let j = 0; j < G; j++) {
        for (let i = 0; i < G; i++) {
            const u = (i * 2) / S;
            const v = (j * 2) / S;
            smoothGrid[j * G + i] = n32(u * 8, v * 8) * 0.011 + n16(u * 16, v * 16) * 0.015 + n8(u * 32, v * 32) * 0.017;
        }
    }
    // 1 px ごとの粒（下で上下左右となじませる：1 px のちらつきを抑える）
    const raw = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) raw[y * S + x] = hash2(x, y, 6105) - 0.5;
    // 小さな砂粒・小石（16×16 の格子の各マスに 0〜3 個）
    const specks = new Float32Array(S * S); // 暗さ（正）・明るさ（負）
    const R = rng(6106);
    const cell = 16;
    for (let cy = 0; cy < S / cell; cy++) {
        for (let cx = 0; cx < S / cell; cx++) {
            for (let k = 0; k < 3; k++) {
                if (R() > 0.6) continue;
                const sx = cx * cell + 1 + R() * (cell - 2);
                const sy = cy * cell + 1 + R() * (cell - 2);
                const r = 0.6 + R() * 0.7;
                const dark = 0.035 + R() * 0.045;
                stampSpeck(specks, S, sx, sy, r, dark);
            }
        }
    }
    const img = ctx.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
        const r0 = (y >> 1) * G;
        const r1 = (((y >> 1) + 1) & (G - 1)) * G;
        const ty = (y & 1) * 0.5;
        const up = ((y + M) & M) * S;
        const down = ((y + 1) & M) * S;
        for (let x = 0; x < S; x++) {
            const i = y * S + x;
            const i0 = x >> 1;
            const i1 = (i0 + 1) & (G - 1);
            const tx = (x & 1) * 0.5;
            const a = smoothGrid[r0 + i0] + (smoothGrid[r0 + i1] - smoothGrid[r0 + i0]) * tx;
            const b = smoothGrid[r1 + i0] + (smoothGrid[r1 + i1] - smoothGrid[r1 + i0]) * tx;
            const grain = (raw[i] * 0.5 + (raw[y * S + ((x + 1) & M)] + raw[y * S + ((x + M) & M)] + raw[up + x] + raw[down + x]) * 0.125) * 1.6;
            let value = 0.946 + a + (b - a) * ty + grain * 0.036 - specks[i];
            value = Math.min(1, value);
            // 暗い所はほんのわずかに温かく（土の色）。明るい所は無彩色。
            const warm = Math.max(0, 0.95 - value) * 0.12;
            const o = i * 4;
            const dth = dither(x, y, 19);
            d[o] = value * 255 + dth;
            d[o + 1] = value * (1 - warm * 0.4) * 255 + dth;
            d[o + 2] = value * (1 - warm) * 255 + dth;
            d[o + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
}

/** 砂粒 1 つ：右下に小さな陰、左上にごくわずかな照り（周期つきに書き込む） */
function stampSpeck(buf: Float32Array, S: number, sx: number, sy: number, r: number, dark: number): void {
    const ext = Math.ceil(r * 2);
    for (let oy = -ext; oy <= ext; oy++) {
        for (let ox = -ext; ox <= ext; ox++) {
            const x = Math.floor(sx) + ox;
            const y = Math.floor(sy) + oy;
            const dx = x + 0.5 - sx;
            const dy = y + 0.5 - sy;
            // 本体（少し右下へずらした陰）
            const bx = (dx - r * 0.25) / r;
            const by = (dy - r * 0.25) / (r * 0.8);
            let v = dark * Math.exp(-(bx * bx + by * by) * 1.6);
            // 左上の照り
            const hx = (dx + r * 0.45) / (r * 0.6);
            const hy = (dy + r * 0.45) / (r * 0.5);
            v -= dark * 0.35 * Math.exp(-(hx * hx + hy * hy) * 1.8);
            const wx = ((x % S) + S) % S;
            const wy = ((y % S) + S) % S;
            buf[wy * S + wx] += v;
        }
    }
}

// ===========================================================================
// 吹き出し
// ===========================================================================

/**
 * 話しかけられる・調べられる印。丸いピル型の半透明の吹き出しに「…」。
 * 光のかぶせより上（UI の層）に出るので、色は時間帯で変わらない。明るい地面の上でも見えるよう、
 * 薄い影と細い縁をつける。
 */
function drawBubble(ctx: Ctx): void {
    const x0 = 4;
    const y0 = 3.5;
    const x1 = 44;
    const y1 = 27.5;
    const r = (y1 - y0) / 2;
    const shape = () => {
        ctx.beginPath();
        ctx.moveTo(x0 + r, y0);
        ctx.lineTo(x1 - r, y0);
        ctx.arc(x1 - r, y0 + r, r, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(28.2, y1);
        ctx.quadraticCurveTo(25.6, y1 + 0.2, 24.8, 32.6);
        ctx.quadraticCurveTo(24, 34.2, 23.2, 32.6);
        ctx.quadraticCurveTo(22.4, y1 + 0.2, 19.8, y1);
        ctx.lineTo(x0 + r, y1);
        ctx.arc(x0 + r, y0 + r, r, Math.PI / 2, Math.PI * 1.5);
        ctx.closePath();
    };
    ctx.save();
    // 地面から浮いて見える柔らかい影
    ctx.shadowColor = 'rgba(16,18,24,0.4)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 1.5;
    shape();
    const fill = ctx.createLinearGradient(0, y0, 0, y1);
    fill.addColorStop(0, 'rgba(252,249,242,0.94)');
    fill.addColorStop(1, 'rgba(236,231,221,0.9)');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
    // 細い縁（明るい背景でも形が分かるように）
    shape();
    ctx.strokeStyle = 'rgba(52,48,44,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // 「…」
    ctx.fillStyle = 'rgba(58,54,52,0.9)';
    for (const dx of [-8.5, 0, 8.5]) {
        ctx.beginPath();
        ctx.arc(24 + dx, (y0 + y1) / 2 + 0.3, 2.4, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ===========================================================================
// 画素を書く道具・ノイズ
// ===========================================================================

function clamp01(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smooth(a: number, b: number, x: number): number {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
}

/** 8bit に丸めるときのディザ（三角分布、±0.7/255 程度）。64×64 の表を 1 回だけ作って使い回す。 */
let ditherTable: Float32Array | null = null;
function dither(x: number, y: number, seed: number): number {
    if (!ditherTable) {
        ditherTable = new Float32Array(64 * 64);
        for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) ditherTable[j * 64 + i] = (hash2(i, j, 7001) + hash2(i, j, 7002) - 1) * 0.7;
    }
    return ditherTable[((y + seed * 13) & 63) * 64 + ((x + seed * 29) & 63)];
}

/** 1 色で、不透明度だけを画素ごとに計算して書く */
function paintAlpha(ctx: Ctx, w: number, h: number, color: string, seed: number, alphaAt: (x: number, y: number) => number): void {
    const { r, g, b } = parseHex(color);
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const a = alphaAt(x + 0.5, y + 0.5);
            const o = (y * w + x) * 4;
            d[o] = r;
            d[o + 1] = g;
            d[o + 2] = b;
            d[o + 3] = a <= 0 ? 0 : a * 255 + dither(x, y, seed);
        }
    }
    ctx.putImageData(img, 0, 0);
}

/** 色と不透明度を画素ごとに計算して書く（out = [r, g, b（0〜255）, a（0〜1）]） */
function paintRGBA(ctx: Ctx, w: number, h: number, seed: number, at: (x: number, y: number, out: Float32Array) => void): void {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const out = new Float32Array(4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            out[3] = 0;
            at(x + 0.5, y + 0.5, out);
            const o = (y * w + x) * 4;
            d[o] = out[0];
            d[o + 1] = out[1];
            d[o + 2] = out[2];
            d[o + 3] = out[3] <= 0 ? 0 : out[3] * 255 + dither(x, y, seed);
        }
    }
    ctx.putImageData(img, 0, 0);
}

/**
 * 周期つき 2D Perlin ノイズ。格子 period（横）× periodY（縦）マスで上下左右がつながる。
 * 返す関数の引数は格子単位の座標、値はおよそ -1〜1。
 */
function perlin(period: number, seed: number, periodY = period): (x: number, y: number) => number {
    const gx = new Float32Array(period * periodY);
    const gy = new Float32Array(period * periodY);
    for (let j = 0; j < periodY; j++) {
        for (let i = 0; i < period; i++) {
            const a = hash2(i, j, seed) * Math.PI * 2;
            gx[j * period + i] = Math.cos(a);
            gy[j * period + i] = Math.sin(a);
        }
    }
    const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    return (x, y) => {
        const xf = Math.floor(x);
        const yf = Math.floor(y);
        const fx = x - xf;
        const fy = y - yf;
        const i0 = ((xf % period) + period) % period;
        const j0 = ((yf % periodY) + periodY) % periodY;
        const i1 = (i0 + 1) % period;
        const j1 = (j0 + 1) % periodY;
        const k00 = j0 * period + i0;
        const k10 = j0 * period + i1;
        const k01 = j1 * period + i0;
        const k11 = j1 * period + i1;
        const n00 = gx[k00] * fx + gy[k00] * fy;
        const n10 = gx[k10] * (fx - 1) + gy[k10] * fy;
        const n01 = gx[k01] * fx + gy[k01] * (fy - 1);
        const n11 = gx[k11] * (fx - 1) + gy[k11] * (fy - 1);
        const u = fade(fx);
        const v = fade(fy);
        const a = n00 + (n10 - n00) * u;
        const b = n01 + (n11 - n01) * u;
        return (a + (b - a) * v) * 1.41;
    };
}

/**
 * 周期 S×S のなめらかな関数を step px ごとの格子で計算し、双一次補間で S×S の配列に広げる
 * （低周波の模様を安く作る。端は反対側とつながる）。
 */
function upsample(S: number, step: number, fn: (x: number, y: number) => number): Float32Array {
    const n = S / step;
    const g = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g[j * n + i] = fn(i * step, j * step);
    const out = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
        const j0 = Math.floor(y / step);
        const ty = (y - j0 * step) / step;
        const r0 = j0 * n;
        const r1 = ((j0 + 1) % n) * n;
        for (let x = 0; x < S; x++) {
            const i0 = Math.floor(x / step);
            const tx = (x - i0 * step) / step;
            const i1 = (i0 + 1) % n;
            const a = g[r0 + i0] + (g[r0 + i1] - g[r0 + i0]) * tx;
            const b = g[r1 + i0] + (g[r1 + i1] - g[r1 + i0]) * tx;
            out[y * S + x] = a + (b - a) * ty;
        }
    }
    return out;
}
