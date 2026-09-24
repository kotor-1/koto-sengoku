/**
 * 建物・構造物（民家・城壁・城門・天守・橋・小物）と、その影。
 *
 * すべて Canvas 2D で描く仮素材（画像ファイルなし）。読み込み時に 1 回だけ描く。
 * 描くときは ctx.scale(s, s) して「ワールド px」で座標を書く（s = 解像度係数）。
 *
 * 見せ方の約束：
 * - 斜め上から見下ろす。南向きの面（前面）はそのまま、屋根や上面は奥行きを縮めて見せる。
 * - 光は左上やや手前から。西向き・南向きの面が明るく、東向き・北向きの面が暗い。
 *   軒・柱・上の段の建物は右（やや上）へ柔らかい影を落とす。
 * - 輪郭は黒線で囲まず、面の明暗と細い照り・陰で立体を出す（ドット絵にしない）。
 *
 * 民家は 3 種で性格を分ける：
 *   house-w5-a 町家（瓦の大屋根・庇・虫籠窓・卯建、1 階は格子窓・暖簾・赤提灯）
 *   house-w5-b 農家（茅葺きの寄棟・箱棟・土壁・板戸・薪）
 *   house-w3-a 小さな家（妻入りの石置き板葺き屋根・板壁）
 *
 * スマホ向けの軽さ：
 * - 同じ色の部分は 1 本のパスにまとめて 1 回で塗る（瓦・石垣）。茅の筋は小さなタイルを作って模様として敷く。
 * - 影の絵はぼけているので、解像度を半分にしてメモリを節約する（表示の大きさは spec で決まる）。
 *
 * 関数の形（export）とキー名・大きさ・基準点は WorldScene が使うので変えないこと。
 */
import {
    BRIDGE_EW_DECK, BRIDGE_EW_RAIL, BRIDGE_NS_DECK, GATE, HOUSE_EAVE, HOUSE_FRONT_H, KEEP, PALETTE, PROP_BARRICADE,
    PROP_FENCE, PROP_LANTERN, PROP_MILESTONE, PROP_NOTICE, PROP_WELL, SHADOW_DIR, WALL_H, WALL_TOP_ONLY, WALL_WITH_FRONT,
    houseSpec, type SpriteSpec,
} from './spec';
import { context, createCanvas, hash2, mix, piece, rng, shade, withAlpha, type ArtPiece, type Ctx } from './canvas';

/** 民家の種類。幅 5 は 2 種、幅 3 は 1 種。 */
export function houseKey(widthTiles: number, variant: number): string {
    return widthTiles >= 5 ? `house-w5-${variant % 2 === 0 ? 'a' : 'b'}` : 'house-w3-a';
}

export function houseShadowKey(widthTiles: number): string {
    return widthTiles >= 5 ? 'shadow-house-w5' : 'shadow-house-w3';
}

// ===========================================================================
// 色（PALETTE を土台に、面ごとの明暗を作る）
// ===========================================================================

const P = PALETTE;
const C = {
    // 瓦（燻し銀）：南向きの面・西向き（明）・東向き（暗）・北向き
    tile: P.roof,
    tileLit: mix(P.roof, P.roofLight, 0.55),
    tileHi: P.roofLight,
    tileDark: P.roofDark,
    tileShade: mix(P.roof, P.roofDark, 0.6),
    // 漆喰・木
    plaster: P.plaster,
    plasterShade: P.plasterShade,
    wood: P.wood,
    woodLight: P.woodLight,
    woodDark: P.woodDark,
    woodGrey: mix(P.woodLight, P.stone, 0.45), // 風雨にさらされた板
    boardDark: mix(P.woodDark, P.roofDark, 0.35), // 下見板（墨塗り）
    // 土壁・茅
    mud: mix(P.dirt, P.plasterShade, 0.4),
    thatch: P.thatch,
    thatchDark: P.thatchDark,
    thatchLight: mix(P.thatch, P.dirtLight, 0.45),
    // 石
    stone: P.stoneWall,
    stoneLight: P.stoneLight,
    stoneDark: P.stoneDark,
    joint: mix(P.stoneDark, P.roofDark, 0.55),
    moss: mix(P.leafDark, P.grassDark, 0.5),
    // 紙・布・差し色
    paper: '#eadcb8',
    paperShade: '#c9b58e',
    indigo: P.indigo,
    indigoDark: P.indigoDark,
    vermilion: mix(P.armorRed, '#c8553d', 0.35),
    gold: P.gold,
    goldLight: mix(P.gold, '#fff3c8', 0.45),
    goldDark: mix(P.gold, P.woodDark, 0.45),
    bamboo: mix('#b7a86a', P.thatch, 0.35),
    rope: mix(P.thatchDark, P.woodDark, 0.4),
    interior: mix(P.woodDark, P.roofDark, 0.5),
    warm: '#fff4de', // 照り（純白は使わない）
};

/** 影の色（半透明） */
const ink = (a: number): string => withAlpha(P.shadow, a);
/** 照り（温かい白、半透明） */
const glint = (a: number): string => withAlpha(C.warm, a);

// ===========================================================================
// 汎用の小道具（ワールド px で描く）
// ===========================================================================

type Stops = readonly (readonly [number, string])[];

/** ワールド px で描くための piece。ctx は s 倍に拡大済み。 */
function art(key: string, spec: SpriteSpec, tex: number, draw: (ctx: Ctx, s: number) => void): ArtPiece {
    return piece(key, spec, tex, (ctx, s) => {
        ctx.save();
        ctx.scale(s, s);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        draw(ctx, s);
        ctx.restore();
    });
}

function lin(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: Stops): CanvasGradient {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [o, c] of stops) g.addColorStop(o, c);
    return g;
}

function rad(ctx: Ctx, x: number, y: number, r: number, stops: Stops, x0 = x, y0 = y, r0 = 0): CanvasGradient {
    const g = ctx.createRadialGradient(x0, y0, r0, x, y, r);
    for (const [o, c] of stops) g.addColorStop(o, c);
    return g;
}

function poly(ctx: Ctx, pts: readonly number[]): void {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
}

function fillPoly(ctx: Ctx, pts: readonly number[], style: string | CanvasGradient): void {
    poly(ctx, pts);
    ctx.fillStyle = style;
    ctx.fill();
}

function box(ctx: Ctx, x: number, y: number, w: number, h: number, style: string | CanvasGradient): void {
    ctx.fillStyle = style;
    ctx.fillRect(x, y, w, h);
}

function seg(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, style: string, width: number): void {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.stroke();
}

function oval(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, style: string | CanvasGradient): void {
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2);
    ctx.fillStyle = style;
    ctx.fill();
}

function withClip(ctx: Ctx, pts: readonly number[], fn: () => void): void {
    ctx.save();
    poly(ctx, pts);
    ctx.clip();
    fn();
    ctx.restore();
}

function withRectClip(ctx: Ctx, x: number, y: number, w: number, h: number, fn: () => void): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    fn();
    ctx.restore();
}

/**
 * 形の「ぼかした影」だけを描く（shadowBlur を使う。ctx.filter は使わない）。
 * draw の中で塗った形（不透明度つき）が、blur ワールド px でぼけて color で描かれる。
 */
function blurred(ctx: Ctx, s: number, blur: number, color: string, draw: () => void): void {
    const OFF = 3000; // ワールド px。形は画面外に描き、影だけを元の位置へずらす
    ctx.save();
    ctx.translate(-OFF, 0);
    ctx.shadowColor = color;
    ctx.shadowBlur = blur * s;
    ctx.shadowOffsetX = OFF * s;
    ctx.shadowOffsetY = 0;
    draw();
    ctx.restore();
}

/** 縦の柔らかい陰り（軒下の影など）。y0 で濃く y1 で消える。 */
function shadeBand(ctx: Ctx, x: number, y0: number, w: number, y1: number, a: number): void {
    box(ctx, x, Math.min(y0, y1), w, Math.abs(y1 - y0), lin(ctx, 0, y0, 0, y1, [[0, ink(a)], [1, ink(0)]]));
}

/** 面の左右の明暗（左が明るく右が暗い） */
function sideLight(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, lit: number, dark: number): void {
    box(ctx, x0, y0, x1 - x0, y1 - y0, lin(ctx, x0, 0, x1, 0, [[0, glint(lit)], [0.45, glint(0)], [0.55, ink(0)], [1, ink(dark)]]));
}

// ===========================================================================
// 屋根の材質
// ===========================================================================

interface TileLook {
    /** 丸瓦の列の間隔 */
    pitch: number;
    /** 段の間隔 */
    course: number;
    base: string;
    light: string;
    dark: string;
    seed: number;
}

/**
 * 瓦の面。丸瓦の列が縦に並ぶ（屋根の流れが下向き）。呼ぶ側で clip しておく。
 * 光は左から：丸瓦の左に照り、右に陰と落ち影。
 */
function kawaraField(ctx: Ctx, s: number, x0: number, y0: number, x1: number, y1: number, k: TileLook): void {
    const px = 1 / s;
    const H = y1 - y0;
    box(ctx, x0, y0, x1 - x0, H, k.base);
    const n = Math.ceil((x1 - x0) / k.pitch) + 1;
    const rw = k.pitch * 0.5;
    const cw = Math.max(px, k.course * 0.12);
    const courses: number[] = [];
    for (let y = y1 - k.course * 0.5; y > y0 - k.course; y -= k.course) courses.push(y);
    // 同じ色の部分は 1 本のパスにまとめて 1 回で塗る（丸瓦 1 列ごとにグラデーションを作るより軽い）
    const layer = (color: string, add: (i: number, cx: number) => void) => {
        ctx.beginPath();
        for (let i = 0; i < n; i++) add(i, x0 + (i + 0.5) * k.pitch);
        ctx.fillStyle = color;
        ctx.fill();
    };
    // 平瓦の重なり（横の筋）
    ctx.beginPath();
    for (const y of courses) ctx.rect(x0, y - cw / 2, x1 - x0, cw);
    ctx.fillStyle = withAlpha(k.dark, 0.5);
    ctx.fill();
    ctx.beginPath();
    for (const y of courses) ctx.rect(x0, y + cw / 2, x1 - x0, px);
    ctx.fillStyle = withAlpha(k.light, 0.18);
    ctx.fill();
    // 丸瓦の右に落ちる影（光は左から）
    layer(withAlpha(k.dark, 0.55), (_i, cx) => ctx.rect(cx + rw * 0.5, y0, rw * 0.28, H));
    layer(withAlpha(k.dark, 0.25), (_i, cx) => ctx.rect(cx + rw * 0.78, y0, rw * 0.3, H));
    // 丸瓦（円筒）：左が明るく右が暗い
    layer(mix(k.base, k.light, 0.4), (_i, cx) => ctx.rect(cx - rw * 0.5, y0, rw, H));
    layer(withAlpha(k.light, 0.45), (_i, cx) => ctx.rect(cx - rw * 0.34, y0, rw * 0.32, H));
    layer(withAlpha(k.dark, 0.3), (_i, cx) => ctx.rect(cx + rw * 0.05, y0, rw * 0.45, H));
    layer(withAlpha(k.dark, 0.4), (_i, cx) => ctx.rect(cx + rw * 0.28, y0, rw * 0.22, H));
    // 1 枚ずつの色むら
    for (const [col, lo, hi, a] of [[k.light, 0, 0.12, 0.16], [k.dark, 0.12, 0.3, 0.2]] as const) {
        layer(withAlpha(col, a), (i, cx) => {
            courses.forEach((y, j) => {
                const h = hash2(i, j, k.seed);
                if (h >= lo && h < hi) ctx.rect(cx - rw * 0.5 - k.pitch * 0.25, y - k.course, k.pitch, k.course);
            });
        });
    }
    // 丸瓦の継ぎ目
    layer(withAlpha(k.dark, 0.55), (_i, cx) => {
        for (const y of courses) ctx.rect(cx - rw * 0.5, y - px * 1.2, rw, px * 1.4);
    });
    layer(withAlpha(k.light, 0.5), (_i, cx) => {
        for (const y of courses) ctx.rect(cx - rw * 0.42, y + px * 0.4, rw * 0.6, px);
    });
}

/** kawaraField を 90 度倒して描く（丸瓦の列が横に並ぶ：東西を向いた面や縦の塀の笠瓦） */
function kawaraFieldH(ctx: Ctx, s: number, x0: number, y0: number, x1: number, y1: number, k: TileLook): void {
    ctx.save();
    ctx.transform(0, 1, 1, 0, 0, 0); // x と y を入れ替える
    kawaraField(ctx, s, y0, x0, y1, x1, k);
    ctx.restore();
}

/** 軒先の瓦（丸い瓦当が並ぶ）。y は瓦当の中心。 */
function eaveTiles(ctx: Ctx, s: number, x0: number, x1: number, y: number, pitch: number, r: number, base: string = C.tile, phase = 0.5): void {
    const px = 1 / s;
    // 軒平瓦の帯と軒裏の陰
    box(ctx, x0, y - r * 0.2, x1 - x0, r * 1.3, lin(ctx, 0, y - r * 0.2, 0, y + r * 1.1, [[0, mix(base, C.tileHi, 0.3)], [0.5, base], [1, C.tileDark]]));
    box(ctx, x0, y + r * 1.05, x1 - x0, r * 0.6, withAlpha(C.tileDark, 0.9));
    const centers: number[] = [];
    for (let cx = x0 + pitch * phase; cx < x1 + r; cx += pitch) centers.push(cx);
    // 瓦当（まとめて塗る）：地の色 → 右下の陰 → 左上の照り → 中心の紋
    const arcs = (dx: number, dy: number, rr: number, a0 = 0, a1 = Math.PI * 2) => {
        ctx.beginPath();
        for (const cx of centers) {
            ctx.moveTo(cx + dx + Math.cos(a0) * rr, y + dy + Math.sin(a0) * rr);
            ctx.arc(cx + dx, y + dy, rr, a0, a1);
        }
    };
    arcs(0, 0, r);
    ctx.fillStyle = mix(base, C.tileHi, 0.12);
    ctx.fill();
    arcs(0, 0, r * 0.78, -Math.PI * 0.15, Math.PI * 0.75);
    ctx.strokeStyle = withAlpha(C.tileDark, 0.7);
    ctx.lineWidth = r * 0.38;
    ctx.stroke();
    arcs(0, 0, r * 0.8, Math.PI * 0.95, Math.PI * 1.6);
    ctx.strokeStyle = glint(0.4);
    ctx.lineWidth = px;
    ctx.stroke();
    arcs(r * 0.1, r * 0.1, r * 0.28);
    ctx.fillStyle = withAlpha(C.tileDark, 0.55);
    ctx.fill();
}

interface ThatchLook {
    seed: number;
    base: string;
    light: string;
    dark: string;
    /** 藁の筋の向き（ラジアン。屋根の流れの向き） */
    angle: number;
    density: number;
}

/** 茅の筋のタイル（上下左右に継ぎ目なくつながる）。解像度と向きごとに 1 枚だけ作って使い回す。 */
const thatchTiles = new Map<string, HTMLCanvasElement>();
const THATCH_TILE_W = 30;
const THATCH_TILE_H = 26;

function thatchTile(s: number, horizontal: boolean): HTMLCanvasElement {
    const key = `${s}:${horizontal ? 'h' : 'v'}`;
    const hit = thatchTiles.get(key);
    if (hit) return hit;
    const TW = THATCH_TILE_W;
    const TH = THATCH_TILE_H;
    const c = createCanvas(Math.round(TW * s), Math.round(TH * s));
    const g = context(c);
    g.scale(c.width / TW, c.height / TH);
    const r = rng(horizontal ? 901 : 902);
    const cols = [C.thatchDark, mix(C.thatch, C.thatchDark, 0.4), mix(C.thatch, C.thatchLight, 0.5), C.thatchLight];
    const alphas = [0.55, 0.5, 0.55, 0.6];
    const buckets: number[][] = [[], [], [], []];
    const n = Math.floor(TW * TH * 1.25);
    for (let i = 0; i < n; i++) {
        const x = r() * TW;
        const y = r() * TH;
        const len = 2.2 + r() * 3.2;
        const a = (horizontal ? 0 : Math.PI / 2) + (r() - 0.5) * 0.25;
        const ex = x + Math.cos(a) * len;
        const ey = y + Math.sin(a) * len;
        const b = r();
        const list = buckets[b < 0.28 ? 0 : b < 0.55 ? 1 : b < 0.85 ? 2 : 3];
        // 端をまたぐ筋は反対側にも描く
        for (const ox of [0, -TW, TW]) {
            for (const oy of [0, -TH, TH]) {
                const minX = Math.min(x, ex) + ox;
                const maxX = Math.max(x, ex) + ox;
                const minY = Math.min(y, ey) + oy;
                const maxY = Math.max(y, ey) + oy;
                if (maxX < 0 || minX > TW || maxY < 0 || minY > TH) continue;
                list.push(x + ox, y + oy, ex + ox, ey + oy);
            }
        }
    }
    g.lineCap = 'butt';
    g.lineWidth = 0.36;
    buckets.forEach((list, i) => {
        g.beginPath();
        for (let k = 0; k < list.length; k += 4) {
            g.moveTo(list[k], list[k + 1]);
            g.lineTo(list[k + 2], list[k + 3]);
        }
        g.strokeStyle = withAlpha(cols[i], alphas[i]);
        g.stroke();
    });
    thatchTiles.set(key, c);
    return c;
}

/**
 * 茅の面。下地の色を塗り、藁の筋のタイルを 2 回（ずらして）重ねる。呼ぶ側で clip しておく。
 * 1 本ずつ筋を描くより大幅に軽い（スマホの読み込み時間を抑える）。
 */
function thatchField(ctx: Ctx, s: number, x0: number, y0: number, x1: number, y1: number, t: ThatchLook): void {
    const w = x1 - x0;
    const h = y1 - y0;
    box(ctx, x0, y0, w, h, t.base);
    const tile = thatchTile(s, Math.abs(Math.cos(t.angle)) > 0.7);
    const k = tile.width / THATCH_TILE_W; // タイル 1 px = 画面の 1 px になるように
    const passes: [number, number, number][] = [
        [(t.seed * 7) % THATCH_TILE_W, (t.seed * 5) % THATCH_TILE_H, Math.min(1, t.density)],
        [(t.seed * 7 + 13) % THATCH_TILE_W, (t.seed * 5 + 11) % THATCH_TILE_H, Math.min(1, t.density * 0.5)],
    ];
    ctx.save();
    for (const [ox, oy, a] of passes) {
        const pat = ctx.createPattern(tile, 'repeat');
        if (!pat) continue;
        pat.setTransform?.(new DOMMatrix([1 / k, 0, 0, 1 / k, x0 + ox, y0 + oy]));
        ctx.globalAlpha = a;
        ctx.fillStyle = pat;
        ctx.fillRect(x0, y0, w, h);
    }
    ctx.restore();
}

// ===========================================================================
// 壁・建具の部品
// ===========================================================================

/** 漆喰の壁（うっすらむらと、下のほうの汚れ） */
function plasterWall(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number, base: string = C.plaster, wrap = false): void {
    box(ctx, x, y, w, h, lin(ctx, 0, y, 0, y + h, [[0, mix(base, C.plasterShade, 0.25)], [0.5, base], [1, mix(base, C.plasterShade, 0.55)]]));
    const r = rng(seed);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    for (let i = 0; i < Math.ceil((w * h) / 50); i++) {
        const cx = x + r() * w;
        const cy = y + r() * h;
        const rr = 1.5 + r() * 4;
        const a = 0.12 + r() * 0.1;
        // wrap=true なら左右にも描いて、横に並べたときに継ぎ目が出ないようにする
        for (const ox of wrap ? [-w, 0, w] : [0]) {
            oval(ctx, cx + ox, cy, rr * 1.6, rr, rad(ctx, cx + ox, cy, rr * 1.6, [[0, withAlpha(C.plasterShade, a)], [1, withAlpha(C.plasterShade, 0)]]));
        }
    }
    ctx.restore();
}

/** 板の壁・板戸（縦板）。 */
function verticalBoards(ctx: Ctx, s: number, x: number, y: number, w: number, h: number, pitch: number, base: string, seed: number): void {
    const px = 1 / s;
    box(ctx, x, y, w, h, base);
    let i = 0;
    for (let bx = x; bx < x + w - 0.01; bx += pitch, i++) {
        const bw = Math.min(pitch, x + w - bx);
        const t = hash2(i, 3, seed);
        box(ctx, bx, y, bw, h, withAlpha(t < 0.5 ? C.woodDark : C.woodLight, 0.08 + t * 0.16));
        box(ctx, bx, y, px * 1.2, h, withAlpha(C.woodDark, 0.6));
        box(ctx, bx + px * 1.2, y, px, h, glint(0.12));
        // 木目
        const r = rng(seed * 31 + i);
        ctx.beginPath();
        for (let k = 0; k < 2; k++) {
            const gx = bx + bw * (0.3 + r() * 0.5);
            ctx.moveTo(gx, y + r() * h * 0.3);
            ctx.lineTo(gx + (r() - 0.5) * 0.4, y + h * (0.6 + r() * 0.4));
        }
        ctx.strokeStyle = withAlpha(C.woodDark, 0.18);
        ctx.lineWidth = px;
        ctx.stroke();
    }
}

/** 横板（下見板）：板の下端に陰、上端に照り */
function clapboards(ctx: Ctx, s: number, x: number, y: number, w: number, h: number, step: number, base: string): void {
    const px = 1 / s;
    box(ctx, x, y, w, h, base);
    for (let by = y; by < y + h - 0.01; by += step) {
        box(ctx, x, by, w, px * 1.2, glint(0.14));
        box(ctx, x, by + step - px * 1.6, w, px * 1.6, ink(0.35));
    }
}

/** 柱（縦の角材）：左に照り、右に陰、壁へ右向きの落ち影 */
function post(ctx: Ctx, s: number, x: number, y: number, w: number, h: number, base: string = C.wood, castOnWall = true): void {
    const px = 1 / s;
    if (castOnWall) box(ctx, x + w, y, 1.6, h, lin(ctx, x + w, 0, x + w + 1.6, 0, [[0, ink(0.22)], [1, ink(0)]]));
    box(ctx, x, y, w, h, lin(ctx, x, 0, x + w, 0, [[0, mix(base, C.woodLight, 0.55)], [0.35, base], [1, mix(base, C.woodDark, 0.6)]]));
    box(ctx, x, y, px, h, glint(0.2));
}

/** 横の材（梁・鴨居）：上面に照り、下に陰 */
function beam(ctx: Ctx, s: number, x: number, y: number, w: number, h: number, base: string = C.wood): void {
    const px = 1 / s;
    box(ctx, x, y, w, h, lin(ctx, 0, y, 0, y + h, [[0, mix(base, C.woodLight, 0.5)], [0.4, base], [1, mix(base, C.woodDark, 0.6)]]));
    box(ctx, x, y, w, px, glint(0.22));
    shadeBand(ctx, x, y + h, w, y + h + 1.4, 0.25);
}

/** 格子窓（紙の障子の手前に細い縦格子）。dark=true なら城の窓（奥が暗い）。 */
function latticeWindow(ctx: Ctx, s: number, x: number, y: number, w: number, h: number, pitch: number, dark = false): void {
    const px = 1 / s;
    // 枠
    box(ctx, x - 0.7, y - 0.7, w + 1.4, h + 1.4, lin(ctx, 0, y, 0, y + h, [[0, C.wood], [1, C.woodDark]]));
    // 奥（紙 or 闇）
    if (dark) box(ctx, x, y, w, h, lin(ctx, 0, y, 0, y + h, [[0, mix(C.interior, '#000000', 0.3)], [1, C.interior]]));
    else box(ctx, x, y, w, h, lin(ctx, 0, y, 0, y + h, [[0, C.paperShade], [0.35, C.paper], [1, mix(C.paper, C.warm, 0.3)]]));
    // 紙の桟（横）
    if (!dark) {
        ctx.beginPath();
        for (let yy = y + h / 3; yy < y + h - 0.5; yy += h / 3) {
            ctx.moveTo(x, yy);
            ctx.lineTo(x + w, yy);
        }
        ctx.strokeStyle = withAlpha(C.woodDark, 0.25);
        ctx.lineWidth = px;
        ctx.stroke();
    }
    // 縦格子
    const sw = Math.min(pitch * 0.5, 0.8);
    for (let sx = x + pitch * 0.5; sx < x + w - pitch * 0.2; sx += pitch) {
        box(ctx, sx - sw / 2 + sw, y, sw * 0.6, h, ink(dark ? 0.15 : 0.18)); // 格子の落ち影
        box(ctx, sx - sw / 2, y, sw, h, lin(ctx, sx - sw / 2, 0, sx + sw / 2, 0, [[0, dark ? mix(C.plaster, C.plasterShade, 0.3) : C.woodLight], [1, dark ? C.plasterShade : C.wood]]));
    }
    // 上の陰（軒・枠の影）と下の敷居
    shadeBand(ctx, x, y, w, y + h * 0.35, 0.28);
    box(ctx, x - 1, y + h + 0.3, w + 2, 0.9, lin(ctx, 0, y + h + 0.3, 0, y + h + 1.2, [[0, C.woodLight], [1, C.woodDark]]));
}

/** 提灯（吊り下げの紙提灯）。cy は胴の中心。 */
function chochin(ctx: Ctx, s: number, cx: number, cy: number, w: number, h: number, body: string, mark: 'line' | 'crest' | 'none'): void {
    const px = 1 / s;
    const top = cy - h / 2;
    seg(ctx, cx, top - 3.2, cx, top, withAlpha(C.woodDark, 0.9), px * 1.3);
    // 胴
    const g = rad(ctx, cx, cy, w * 0.7, [[0, mix(body, C.warm, 0.35)], [0.6, body], [1, shade(body, -0.35)]], cx - w * 0.15, cy - h * 0.1);
    ctx.beginPath();
    ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    // 竹ひごの筋
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    for (let yy = top + 1; yy < cy + h / 2; yy += 1.1) {
        ctx.moveTo(cx - w, yy);
        ctx.lineTo(cx + w, yy);
    }
    ctx.strokeStyle = withAlpha(shade(body, -0.5), 0.22);
    ctx.lineWidth = px;
    ctx.stroke();
    if (mark === 'line') {
        box(ctx, cx - w * 0.08, cy - h * 0.28, w * 0.18, h * 0.56, withAlpha(C.woodDark, 0.8));
        box(ctx, cx - w * 0.28, cy - h * 0.05, w * 0.5, h * 0.1, withAlpha(C.woodDark, 0.8));
    } else if (mark === 'crest') {
        // 家紋（丸に二つ引）
        const rr = w * 0.27;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(C.woodDark, 0.85);
        ctx.lineWidth = w * 0.06;
        ctx.stroke();
        for (const dy of [-rr * 0.34, rr * 0.34]) box(ctx, cx - rr * 0.78, cy + dy - rr * 0.14, rr * 1.56, rr * 0.28, withAlpha(C.woodDark, 0.85));
    }
    // 照り（左上）
    oval(ctx, cx - w * 0.2, cy - h * 0.12, w * 0.12, h * 0.26, glint(0.35));
    ctx.restore();
    // 上下の枠
    box(ctx, cx - w * 0.33, top - 0.9, w * 0.66, 1.1, lin(ctx, 0, top - 0.9, 0, top + 0.2, [[0, C.woodLight], [1, C.woodDark]]));
    box(ctx, cx - w * 0.33, cy + h / 2 - 0.2, w * 0.66, 1.1, lin(ctx, 0, cy + h / 2 - 0.2, 0, cy + h / 2 + 0.9, [[0, C.wood], [1, C.woodDark]]));
}

/** 暖簾（のれん）：竿から下がる布。panels 枚に割れている。 */
function noren(ctx: Ctx, s: number, x0: number, x1: number, y0: number, y1: number, panels: number): void {
    const px = 1 / s;
    const w = x1 - x0;
    const pw = w / panels;
    // 布の手前に落ちる陰（奥の戸へ）
    box(ctx, x0 + 1, y1, w, 1.6, lin(ctx, 0, y1, 0, y1 + 1.6, [[0, ink(0.3)], [1, ink(0)]]));
    for (let i = 0; i < panels; i++) {
        const a = x0 + i * pw + 0.25;
        const b = a + pw - 0.5;
        const sag = (i % 2 === 0 ? 0.35 : -0.2);
        ctx.beginPath();
        ctx.moveTo(a, y0);
        ctx.lineTo(b, y0);
        ctx.lineTo(b + 0.15, y1 + sag);
        ctx.quadraticCurveTo((a + b) / 2, y1 + sag + 0.5, a - 0.1, y1 - sag * 0.4);
        ctx.closePath();
        ctx.fillStyle = lin(ctx, a, 0, b, 0, [[0, mix(C.indigo, '#8fa0c0', 0.18)], [0.4, C.indigo], [0.75, mix(C.indigo, C.indigoDark, 0.5)], [1, C.indigoDark]]);
        ctx.fill();
        box(ctx, a, y0, b - a, (y1 - y0) * 0.25, lin(ctx, 0, y0, 0, y0 + (y1 - y0) * 0.25, [[0, ink(0.3)], [1, ink(0)]]));
    }
    // 染め抜きの紋（丸に一）：割れ目で切れる
    const cx = (x0 + x1) / 2;
    const cy = y0 + (y1 - y0) * 0.52;
    const r = Math.min(pw * 0.8, (y1 - y0) * 0.3);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(C.plaster, 0.85);
    ctx.lineWidth = r * 0.22;
    ctx.stroke();
    box(ctx, cx - r * 0.62, cy - r * 0.12, r * 1.24, r * 0.24, withAlpha(C.plaster, 0.85));
    for (let i = 1; i < panels; i++) box(ctx, x0 + i * pw - 0.25, y0 + 0.4, 0.5, y1 - y0, C.interior);
    // 竿
    box(ctx, x0 - 0.8, y0 - 0.6, w + 1.6, 0.9, lin(ctx, 0, y0 - 0.6, 0, y0 + 0.3, [[0, C.bamboo], [1, C.woodDark]]));
    box(ctx, x0 - 0.8, y0 - 0.6, w + 1.6, px, glint(0.3));
}

/** 丸い石（石置き屋根の押さえ石・井戸の縁など） */
function roundStone(ctx: Ctx, x: number, y: number, rx: number, ry: number, tone: number, castShadow = true): void {
    if (castShadow) oval(ctx, x + rx * 0.45, y + ry * 0.55, rx * 1.05, ry * 0.7, ink(0.3));
    const base = mix(C.stone, tone > 0 ? C.stoneLight : C.stoneDark, Math.abs(tone));
    oval(ctx, x, y, rx, ry, rad(ctx, x, y, Math.max(rx, ry) * 1.1, [[0, mix(base, C.warm, 0.3)], [0.55, base], [1, mix(base, C.joint, 0.55)]], x - rx * 0.35, y - ry * 0.4));
}

// ===========================================================================
// 石垣
// ===========================================================================

interface StoneLook {
    seed: number;
    rowH: readonly [number, number];
    w: readonly [number, number];
    base: string;
    /** 目地の太さ */
    gap: number;
    /** 横方向にこの幅でつながる（城壁のタイル用）。0 ならつながりを気にしない。 */
    wrap: number;
    moss: number;
}

/** 石積みの面。行ごとに大きさの違う石を並べ、1 つずつ左上を明るく右下を暗く塗る。呼ぶ側で clip しておく。 */
function stoneField(ctx: Ctx, s: number, x0: number, y0: number, x1: number, y1: number, o: StoneLook): void {
    const px = 1 / s;
    const r = rng(o.seed);
    box(ctx, x0, y0, x1 - x0, y1 - y0, C.joint);
    // 石は色の近いものごとにまとめて塗る（石 1 個ごとに描画命令を出すより軽い）
    const TONES = 7;
    const fills: number[][][] = Array.from({ length: TONES }, () => []);
    const warmFills: number[][] = [];
    const lit: number[][] = [];
    const dark: number[][] = [];
    const chips: number[] = [];
    const specksDark: number[] = [];
    const specksLight: number[] = [];
    const moss: number[] = [];
    let y = y0;
    while (y < y1 - 0.2) {
        let h = o.rowH[0] + r() * (o.rowH[1] - o.rowH[0]);
        if (y1 - (y + h) < o.rowH[0] * 0.6) h = y1 - y;
        const stones: [number, number][] = [];
        if (o.wrap > 0) {
            // タイル幅ちょうどに収まるように幅を割り振る
            let x = 0;
            const start = r() * o.w[0];
            while (x < o.wrap - 0.01) {
                let w = o.w[0] + r() * (o.w[1] - o.w[0]);
                if (o.wrap - (x + w) < o.w[0] * 0.7) w = o.wrap - x;
                stones.push([x0 + ((x + start) % o.wrap), w]);
                x += w;
            }
        } else {
            let x = x0 - r() * o.w[1];
            while (x < x1) {
                const w = o.w[0] + r() * (o.w[1] - o.w[0]);
                stones.push([x, w]);
                x += w;
            }
        }
        for (const [sx, sw] of stones) {
            const copies = o.wrap > 0 ? [sx - o.wrap, sx, sx + o.wrap] : [sx];
            const tone = r();
            const warmth = r();
            const inset = o.gap / 2;
            // 角ばった不定形：角をわずかに落とし、各頂点を少しずらす
            const j = () => (r() - 0.5) * Math.min(0.9, h * 0.16);
            const jy = [j(), j(), j(), j(), j(), j()];
            const jx = [j(), j(), j(), j()];
            const cut = [r(), r(), r(), r()].map((v) => 0.2 + v * Math.min(1.1, Math.min(sw, h) * 0.18));
            const midT = 0.3 + r() * 0.4;
            const midB = 0.3 + r() * 0.4;
            const speck = [r(), r(), r(), r(), r()];
            for (const cx of copies) {
                if (cx > x1 || cx + sw < x0) continue;
                const a = cx + inset;
                const b = cx + sw - inset;
                const t = y + inset + Math.abs(jy[0]) * 0.5;
                const bt = y + h - inset - Math.abs(jy[1]) * 0.5;
                const pts = [
                    a + cut[0], t + jy[2] * 0.4,
                    a + (b - a) * midT, t + Math.abs(jy[3]) * 0.5,
                    b - cut[1], t + jy[4] * 0.3,
                    b + jx[0] * 0.3, t + cut[1],
                    b + jx[1] * 0.3, bt - cut[2],
                    b - cut[2], bt,
                    a + (b - a) * midB, bt - Math.abs(jy[5]) * 0.5,
                    a + cut[3], bt,
                    a + jx[2] * 0.3, bt - cut[3],
                    a + jx[3] * 0.3, t + cut[0],
                ];
                fills[Math.min(TONES - 1, Math.floor(tone * TONES))].push(pts);
                if (warmth < 0.22) warmFills.push(pts);
                // 上の縁の照り・右と下の縁の陰（割れ肌の角）
                lit.push([a + jx[3] * 0.3 + 0.15, t + cut[0] + 0.3, a + cut[0], t + jy[2] * 0.4 + 0.12, a + (b - a) * midT, t + Math.abs(jy[3]) * 0.5 + 0.12, b - cut[1], t + jy[4] * 0.3 + 0.12]);
                dark.push([b + jx[0] * 0.3 - 0.15, t + cut[1], b + jx[1] * 0.3 - 0.15, bt - cut[2], b - cut[2], bt - 0.15, a + (b - a) * midB, bt - Math.abs(jy[5]) * 0.5 - 0.15, a + cut[3], bt - 0.15]);
                // のみ跡・ざらつき・苔
                const w = b - a;
                const hh = bt - t;
                chips.push(a + w * speck[0], t + hh * 0.3, a + w * speck[0] + w * 0.18, t + hh * (0.35 + speck[1] * 0.4));
                specksDark.push(a + w * speck[2], t + hh * speck[3]);
                specksLight.push(a + w * speck[3], t + hh * speck[2]);
                if (o.moss > 0 && speck[4] < o.moss * ((y - y0) / Math.max(1, y1 - y0))) moss.push(a + w * speck[2], bt - 0.35, Math.min(1.8, w * 0.3));
            }
        }
        y += h;
    }
    const fillAll = (list: number[][], style: string) => {
        if (list.length === 0) return;
        ctx.beginPath();
        for (const pts of list) {
            ctx.moveTo(pts[0], pts[1]);
            for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
            ctx.closePath();
        }
        ctx.fillStyle = style;
        ctx.fill();
    };
    const strokeAll = (list: number[][], style: string, width: number) => {
        ctx.beginPath();
        for (const pts of list) {
            ctx.moveTo(pts[0], pts[1]);
            for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
        }
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.stroke();
    };
    fills.forEach((list, i) => {
        const tone = (i + 0.5) / TONES - 0.5; // -0.5〜0.5
        fillAll(list, tone >= 0 ? mix(o.base, C.stoneLight, tone * 0.75) : mix(o.base, C.stoneDark, -tone * 0.85));
    });
    fillAll(warmFills, withAlpha(P.dirt, 0.16));
    strokeAll(lit, glint(0.32), px * 1.3);
    strokeAll(dark, ink(0.32), px * 1.5);
    ctx.beginPath();
    for (let i = 0; i < chips.length; i += 4) {
        ctx.moveTo(chips[i], chips[i + 1]);
        ctx.lineTo(chips[i + 2], chips[i + 3]);
    }
    ctx.strokeStyle = ink(0.12);
    ctx.lineWidth = px * 1.2;
    ctx.stroke();
    for (const [list, style] of [[specksDark, ink(0.14)], [specksLight, glint(0.14)]] as const) {
        ctx.beginPath();
        for (let i = 0; i < list.length; i += 2) {
            ctx.moveTo(list[i] + 0.3, list[i + 1]);
            ctx.ellipse(list[i], list[i + 1], 0.3, 0.21, 0, 0, Math.PI * 2);
        }
        ctx.fillStyle = style;
        ctx.fill();
    }
    ctx.beginPath();
    for (let i = 0; i < moss.length; i += 3) {
        ctx.moveTo(moss[i] + moss[i + 2], moss[i + 1]);
        ctx.ellipse(moss[i], moss[i + 1], moss[i + 2], 0.55, 0, 0, Math.PI * 2);
    }
    ctx.fillStyle = withAlpha(C.moss, 0.5);
    ctx.fill();
    // 石の面の上下の明暗（行ごとではなく面全体に。上が明るく下が暗い）
    box(ctx, x0, y0, x1 - x0, y1 - y0, lin(ctx, 0, y0, 0, y1, [[0, glint(0.06)], [1, ink(0.08)]]));
}

// ===========================================================================
// 民家
// ===========================================================================

/** 民家の前面と屋根の共通寸法 */
interface HouseFrame {
    W: number;
    H: number;
    /** 壁の上端（= H - 30） */
    top: number;
    /** 壁の左右（軒の出 4 の内側） */
    L: number;
    R: number;
    /** 夜の灯りの位置（WorldScene と同じ） */
    lantern: { x: number; y: number };
    window: { x: number; y: number };
}

function houseFrame(widthTiles: number): HouseFrame {
    const sp = houseSpec(widthTiles);
    const W = sp.w;
    const H = sp.h;
    return {
        W, H,
        top: H - HOUSE_FRONT_H,
        L: HOUSE_EAVE,
        R: W - HOUSE_EAVE,
        lantern: { x: 12, y: H - HOUSE_FRONT_H + 8 },
        window: { x: W - 16, y: H - 14 },
    };
}

/** 壁の最下部の土台（石・木）と、地面との境の陰り */
function sill(ctx: Ctx, s: number, x0: number, x1: number, H: number): void {
    const px = 1 / s;
    box(ctx, x0, H - 2.2, x1 - x0, 2.2, lin(ctx, 0, H - 2.2, 0, H, [[0, mix(C.stone, C.stoneLight, 0.2)], [0.5, C.stoneDark], [1, C.joint]]));
    box(ctx, x0, H - 2.2, x1 - x0, px, glint(0.35));
    const r = rng(x1 * 7 + 3);
    for (let x = x0 + r() * 3; x < x1; x += 2.5 + r() * 3) box(ctx, x, H - 2.1, px * 1.2, 2.1, ink(0.3));
}

/** 町家（厨子二階：瓦の大屋根・庇・虫籠窓・卯建、1 階は格子窓・暖簾・赤提灯） */
function drawMachiya(ctx: Ctx, s: number, f: HouseFrame): void {
    const { W, H, top, L, R } = f;
    const px = 1 / s;
    const look: TileLook = { pitch: 3.2, course: 3.2, base: C.tile, light: C.tileHi, dark: C.tileDark, seed: 21 };

    // ---- 1 階の前面 ----
    plasterWall(ctx, L, top, R - L, HOUSE_FRONT_H, 11);
    const bay1 = L + 19; // 左の間の右端（柱）
    const bay2 = W - 35; // 入口の右端（柱）
    // 左の間：腰板
    clapboards(ctx, s, L, H - 12, bay1 - L, 10, 2.2, C.boardDark);
    // 入口：格子戸（奥は暗い）
    const dx0 = bay1 + 2.2;
    const dx1 = bay2;
    box(ctx, dx0, top + 5, dx1 - dx0, HOUSE_FRONT_H - 7, C.interior);
    const doorMid = (dx0 + dx1) / 2;
    for (let x = dx0 + 0.9; x < dx1 - 0.5; x += 1.5) {
        box(ctx, x, top + 5, 0.55, HOUSE_FRONT_H - 7, lin(ctx, x, 0, x + 0.55, 0, [[0, C.woodLight], [1, C.wood]]));
    }
    beam(ctx, s, dx0, H - 12, dx1 - dx0, 0.9, C.wood);
    post(ctx, s, doorMid - 0.5, top + 5, 1.1, HOUSE_FRONT_H - 7, C.wood, false);
    shadeBand(ctx, dx0, top + 5, dx1 - dx0, top + 13, 0.45);
    // 右の間：出格子の窓（夜はここが灯る）
    const wx = f.window.x;
    const ww = 20;
    const wy = f.window.y - 8;
    box(ctx, bay2 + 2.2, H - 7, R - bay2 - 4.4, 5, lin(ctx, 0, H - 7, 0, H - 2, [[0, C.boardDark], [1, mix(C.boardDark, '#000000', 0.2)]]));
    latticeWindow(ctx, s, wx - ww / 2, wy, ww, 15.5, 1.35);
    box(ctx, wx - ww / 2 - 1.2, wy + 16.4, ww + 2.4, 1.6, lin(ctx, 0, wy + 16.4, 0, wy + 18, [[0, C.woodLight], [1, C.woodDark]]));
    box(ctx, wx - ww / 2 - 1.2, wy + 18, ww + 2.4, 1.2, lin(ctx, 0, wy + 18, 0, wy + 19.2, [[0, ink(0.35)], [1, ink(0)]]));
    // 柱と差鴨居
    for (const x of [L, bay1, bay2, R - 2.2]) post(ctx, s, x, top, 2.2, HOUSE_FRONT_H - 2, C.wood);
    beam(ctx, s, L, top + 2.6, R - L, 2.4, C.wood);
    // 暖簾
    noren(ctx, s, dx0 + 0.6, dx1 - 0.6, top + 5.4, top + 16.5, 3);
    // 土台・左右の明暗・庇の落とす影
    sill(ctx, s, L, R, H);
    sideLight(ctx, L, top, R, H, 0.06, 0.1);
    shadeBand(ctx, L, top, R - L, top + 8, 0.55);

    // ---- 2 階（低い厨子二階）：塗籠の壁と虫籠窓 ----
    const f2Top = 32.5;
    const f2Bot = 46;
    plasterWall(ctx, L, f2Top, R - L, f2Bot - f2Top, 13, mix(C.plaster, C.plasterShade, 0.12));
    sideLight(ctx, L, f2Top, R, f2Bot, 0.06, 0.16);
    for (const cx of [W * 0.31, W * 0.69]) mushikoWindow(ctx, s, cx, f2Top + 4.6, 18, 5.4);
    shadeBand(ctx, L, f2Top, R - L, f2Top + 5, 0.55);

    // ---- 大屋根（切妻・平入り） ----
    const ridge = 14.5; // 大棟の下端
    const eave = f2Top + 0.3; // 軒先の瓦当の中心
    // 奥の流れ（北向き：暗い）
    withRectClip(ctx, 0.6, 3.5, W - 1.2, ridge - 3.5, () => {
        kawaraField(ctx, s, 0.6, 3.5, W - 0.6, ridge, { ...look, base: C.tileShade, light: C.tile, seed: 22 });
        box(ctx, 0, 3.5, W, ridge - 3.5, lin(ctx, 0, 3.5, 0, ridge, [[0, ink(0.28)], [1, ink(0.05)]]));
    });
    // 手前の流れ（南向き）
    withRectClip(ctx, 0, ridge, W, eave - ridge, () => {
        kawaraField(ctx, s, 0, ridge, W, eave, look);
        shadeBand(ctx, 0, ridge, W, ridge + 6, 0.45);
        box(ctx, 0, ridge, W, eave - ridge, lin(ctx, 0, ridge, 0, eave, [[0, glint(0)], [1, glint(0.12)]]));
        sideLight(ctx, 0, ridge, W, eave, 0.08, 0.14);
        const r = rng(5);
        for (let i = 0; i < 5; i++) {
            const x = r() * W;
            box(ctx, x, ridge + 3, 2 + r() * 3, eave - ridge - 3, lin(ctx, 0, ridge + 3, 0, eave, [[0, ink(0)], [1, withAlpha(C.moss, 0.14)]]));
        }
    });
    // けらば
    for (const [x, lit] of [[0, true], [W - 1.8, false]] as const) {
        box(ctx, x, 3.2, 1.8, eave - 3, lin(ctx, x, 0, x + 1.8, 0, lit ? [[0, C.tileHi], [1, C.tile]] : [[0, C.tile], [1, C.tileDark]]));
    }
    eaveTiles(ctx, s, 0, W, eave, 3.2, 1.25);
    // 大棟（熨斗瓦を重ねた棟）
    const rt = ridge - 4.4;
    box(ctx, 1.5, rt, W - 3, 5.2, lin(ctx, 0, rt, 0, rt + 5.2, [[0, C.tileHi], [0.25, C.tileLit], [0.6, C.tile], [1, C.tileDark]]));
    for (let k = 1; k <= 3; k++) box(ctx, 1.5, rt + k * 1.3, W - 3, px * 1.3, withAlpha(C.tileDark, 0.55));
    box(ctx, 1.5, rt, W - 3, px * 1.5, glint(0.4));
    shadeBand(ctx, 0, rt + 5.2, W, rt + 7.5, 0.3);
    // 鬼瓦
    onigawara(ctx, s, 3.2, rt, -1, 1.15);
    onigawara(ctx, s, W - 3.2, rt, 1, 1.15);
    // 煙出し（棟の上の小屋根）：煙はこのあたりから出る
    smokeVentTiled(ctx, s, W * 0.5 + W * 0.18, rt + 0.3);

    // ---- 庇（1 階の上の小屋根） ----
    const hTop = f2Bot - 0.6;
    const hEave = top - 1.3; // 瓦当の中心
    withRectClip(ctx, 0, hTop, W, hEave - hTop, () => {
        kawaraField(ctx, s, 0, hTop, W, hEave, { ...look, course: 2.6, seed: 23 });
        box(ctx, 0, hTop, W, hEave - hTop, lin(ctx, 0, hTop, 0, hEave, [[0, ink(0.3)], [0.5, glint(0)], [1, glint(0.12)]]));
        sideLight(ctx, 0, hTop, W, hEave, 0.08, 0.14);
    });
    // 壁との取り合い（水切り）
    box(ctx, L, hTop - 0.6, R - L, 1, lin(ctx, 0, hTop - 0.6, 0, hTop + 0.4, [[0, C.tileHi], [1, C.tileDark]]));
    eaveTiles(ctx, s, 0, W, hEave, 3.2, 1.2);

    // ---- 卯建（両端の防火壁：小さな瓦屋根つき） ----
    for (const side of [0, 1] as const) {
        const x = side === 0 ? 0.4 : W - 4.6;
        const y0 = 26.5;
        const y1 = hTop + 0.4;
        if (side === 0) box(ctx, x + 4.2, y0 + 2, 2.4, y1 - y0 - 2, lin(ctx, x + 4.2, 0, x + 6.6, 0, [[0, ink(0.3)], [1, ink(0)]]));
        box(ctx, x, y0, 4.2, y1 - y0, lin(ctx, x, 0, x + 4.2, 0, side === 0 ? [[0, C.plaster], [1, mix(C.plaster, C.plasterShade, 0.6)]] : [[0, mix(C.plaster, C.plasterShade, 0.5)], [1, C.plasterShade]]));
        shadeBand(ctx, x, y0 + 1, 4.2, y0 + 4, 0.35);
        box(ctx, x, y1 - 1.2, 4.2, 1.2, withAlpha(C.plasterShade, 0.8));
        // 笠の瓦
        fillPoly(ctx, [x - 0.9, y0 + 1.2, x + 5.1, y0 + 1.2, x + 4.4, y0 - 1.8, x - 0.2, y0 - 1.8], lin(ctx, 0, y0 - 1.8, 0, y0 + 1.2, [[0, C.tileHi], [0.5, C.tile], [1, C.tileDark]]));
        for (let tx = x - 0.2; tx < x + 4.6; tx += 1.2) seg(ctx, tx, y0 - 1.6, tx - 0.2, y0 + 1, withAlpha(C.tileDark, 0.55), px);
        box(ctx, x - 0.3, y0 - 2.6, 4.8, 1.2, lin(ctx, 0, y0 - 2.6, 0, y0 - 1.4, [[0, C.tileHi], [1, C.tileDark]]));
        box(ctx, x - 0.9, y0 + 1.1, 6, 0.8, withAlpha(C.tileDark, 0.9));
    }
    // 赤提灯（夜はここが灯る）
    chochin(ctx, s, f.lantern.x, f.lantern.y, 5.4, 7.4, C.vermilion, 'line');
}

/**
 * 鬼瓦（棟の端の飾り瓦）。棟は東西に通るので、正面からは横から見た形（外へ反り上がる鰭）になる。
 * x: 棟の端、y: 棟の上端、dir: -1 = 左端（左へ反る）、1 = 右端。k: 大きさ。
 */
function onigawara(ctx: Ctx, s: number, x: number, y: number, dir: 1 | -1, k = 1): void {
    const px = 1 / s;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir * k, k);
    ctx.beginPath();
    ctx.moveTo(-1.4, 5.4);
    ctx.lineTo(-1.4, -0.6);
    ctx.quadraticCurveTo(-0.2, -1.6, 0.6, -3.2);
    ctx.quadraticCurveTo(1.2, -4.4, 2.4, -4.3);
    ctx.quadraticCurveTo(1.7, -3.4, 1.8, -2.2);
    ctx.quadraticCurveTo(1.9, -0.6, 1.2, 0.6);
    ctx.lineTo(1.1, 5.4);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, -4.4, 0, 5.4, [[0, C.tileHi], [0.35, C.tileLit], [0.7, C.tile], [1, C.tileDark]]);
    ctx.fill();
    ctx.strokeStyle = withAlpha(C.tileDark, 0.75);
    ctx.lineWidth = px * 1.2 / k;
    ctx.stroke();
    // 鳥衾（外へ突き出た丸瓦の先）
    oval(ctx, 1.9, 0.9, 1, 1, rad(ctx, 1.9, 0.9, 1, [[0, C.tileHi], [0.6, C.tile], [1, C.tileDark]], 1.6, 0.6));
    seg(ctx, -1, -0.6, 0.4, -3, glint(0.45), px * 1.4 / k);
    ctx.restore();
}

/** 虫籠窓（塗り込めた太い縦格子の横長の窓） */
function mushikoWindow(ctx: Ctx, s: number, cx: number, y: number, w: number, h: number): void {
    const px = 1 / s;
    const x = cx - w / 2;
    // 窓の縁（漆喰の厚み）
    box(ctx, x - 0.8, y - 0.8, w + 1.6, h + 1.6, lin(ctx, 0, y - 0.8, 0, y + h + 0.8, [[0, mix(C.plasterShade, C.woodDark, 0.15)], [1, C.plaster]]));
    box(ctx, x, y, w, h, lin(ctx, 0, y, 0, y + h, [[0, mix(C.interior, '#000000', 0.25)], [1, C.interior]]));
    // 塗り込めの格子（丸みのある太い縦桟）
    const n = Math.round(w / 1.8);
    const pitch = w / n;
    for (let i = 1; i < n; i++) {
        const bx = x + i * pitch;
        box(ctx, bx - 0.5 + 0.9, y, 0.5, h, ink(0.25));
        box(ctx, bx - 0.5, y, 1, h, lin(ctx, bx - 0.5, 0, bx + 0.5, 0, [[0, C.plaster], [0.5, mix(C.plaster, C.plasterShade, 0.3)], [1, C.plasterShade]]));
    }
    shadeBand(ctx, x, y, w, y + h * 0.5, 0.35);
    box(ctx, x - 0.8, y + h + 0.3, w + 1.6, px * 1.4, glint(0.4));
}

/** 瓦葺きの煙出し（棟にまたがる小さな越屋根） */
function smokeVentTiled(ctx: Ctx, s: number, cx: number, y: number): void {
    const px = 1 / s;
    const w = 11;
    // 右へ落ちる影
    fillPoly(ctx, [cx + w / 2, y - 2, cx + w / 2 + 3.5, y - 1, cx + w / 2 + 3.5, y + 6, cx + w / 2, y + 6], ink(0.28));
    // 側板（格子の開口）
    box(ctx, cx - w / 2 + 1, y - 2.5, w - 2, 5, C.interior);
    for (let x = cx - w / 2 + 1.8; x < cx + w / 2 - 1; x += 1.4) box(ctx, x, y - 2.5, 0.5, 5, C.woodLight);
    box(ctx, cx - w / 2 + 1, y + 2.2, w - 2, 0.6, C.woodDark);
    // 小屋根
    fillPoly(ctx, [cx - w / 2 - 0.5, y - 2.2, cx + w / 2 + 0.5, y - 2.2, cx + w / 2 - 1, y - 6.2, cx - w / 2 + 1, y - 6.2], lin(ctx, 0, y - 6.2, 0, y - 2.2, [[0, C.tileHi], [1, C.tile]]));
    for (let x = cx - w / 2 + 0.7; x < cx + w / 2; x += 1.6) seg(ctx, x, y - 5.9, x, y - 2.4, withAlpha(C.tileDark, 0.5), px);
    box(ctx, cx - w / 2 - 0.5, y - 2.6, w + 1, 0.8, C.tileDark);
    box(ctx, cx - w / 2 + 1, y - 7, w - 2, 1.2, lin(ctx, 0, y - 7, 0, y - 5.8, [[0, C.tileHi], [1, C.tileDark]]));
}

/** 農家（茅葺きの寄棟・土壁・板戸・薪） */
function drawFarmhouse(ctx: Ctx, s: number, f: HouseFrame): void {
    const { W, H, top, L, R } = f;
    const px = 1 / s;
    // ---- 前面の壁（土壁） ----
    box(ctx, L, top, R - L, HOUSE_FRONT_H, lin(ctx, 0, top, 0, H, [[0, mix(C.mud, C.thatchDark, 0.25)], [0.4, C.mud], [1, mix(C.mud, P.dirtDark, 0.35)]]));
    {
        const r = rng(71);
        withRectClip(ctx, L, top, R - L, HOUSE_FRONT_H, () => {
            for (let i = 0; i < 60; i++) {
                const x = L + r() * (R - L);
                const y = top + r() * HOUSE_FRONT_H;
                oval(ctx, x, y, 0.8 + r() * 2.2, 0.5 + r() * 1.2, withAlpha(r() < 0.5 ? C.thatchDark : C.plaster, 0.08 + r() * 0.1));
            }
            // 藁すさの細い筋
            ctx.beginPath();
            for (let i = 0; i < 90; i++) {
                const x = L + r() * (R - L);
                const y = top + r() * HOUSE_FRONT_H;
                const a = r() * Math.PI;
                ctx.moveTo(x, y);
                ctx.lineTo(x + Math.cos(a) * 1.1, y + Math.sin(a) * 0.6);
            }
            ctx.strokeStyle = withAlpha(C.thatchLight, 0.35);
            ctx.lineWidth = px;
            ctx.stroke();
        });
    }
    const p1 = L + 22;
    const p2 = W - 28;
    // 板戸（2 枚）
    const dy = top + 6;
    verticalBoards(ctx, s, p1 + 2.2, dy, p2 - p1 - 2.2, H - dy - 2, 2.3, C.woodGrey, 7);
    for (const y of [dy + 5, dy + 14]) beam(ctx, s, p1 + 2.2, y, p2 - p1 - 2.2, 1, C.wood);
    box(ctx, (p1 + p2) / 2 + 0.6, dy, 0.7, H - dy - 2, ink(0.5));
    shadeBand(ctx, p1 + 2.2, dy, p2 - p1 - 2.2, dy + 6, 0.35);
    // 連子窓（夜はここが灯る）
    latticeWindow(ctx, s, f.window.x - 7, f.window.y - 6, 14, 11.5, 1.55);
    // 柱・梁・足固め
    for (const x of [L, p1, p2, R - 2.4]) post(ctx, s, x, top, 2.4, HOUSE_FRONT_H - 1.5, C.woodDark);
    beam(ctx, s, L, top + 3.4, R - L, 2.4, C.woodDark);
    beam(ctx, s, L, H - 3.6, R - L, 1.4, C.woodDark);
    // 礎石
    for (const x of [L, p1, p2, R - 2.4]) roundStone(ctx, x + 1.2, H - 0.9, 2.1, 0.9, 0.2, false);
    sideLight(ctx, L, top, R, H, 0.05, 0.1);
    // 薪の山（左の間）
    firewood(ctx, s, L + 3, H - 1.5, 15, 3);

    // ---- 屋根（茅葺きの寄棟） ----
    const eaveY = top + 3.8; // 前の軒の下端
    const edgeTop = eaveY - 5; // 軒の厚み（小口）の上端
    const backY = 7.5; // 奥の軒
    const rL = 29;
    const rR = W - 29;
    const ridgeY = 17.5;
    const look: ThatchLook = { seed: 3, base: C.thatch, light: C.thatchLight, dark: C.thatchDark, angle: Math.PI / 2, density: 1.3 };
    // 奥の流れ（北向き：暗い）。奥の角は丸い。
    const back = [3, backY, W - 3, backY, rR, ridgeY, rL, ridgeY];
    withClip(ctx, back, () => {
        thatchField(ctx, s, 0, backY, W, ridgeY + 1, { ...look, seed: 4, base: mix(C.thatch, C.thatchDark, 0.6), angle: -Math.PI / 2 });
        box(ctx, 0, backY, W, ridgeY - backY, lin(ctx, 0, backY, 0, ridgeY, [[0, ink(0.1)], [1, ink(0.3)]]));
    });
    // 左の妻（西向き：いちばん明るい）
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0.2, edgeTop + 0.5);
    ctx.lineTo(0.2, backY + 4);
    ctx.quadraticCurveTo(0.2, backY, 3.5, backY);
    ctx.lineTo(rL, ridgeY);
    ctx.lineTo(rL + 1, ridgeY + 1);
    ctx.closePath();
    ctx.clip();
    thatchField(ctx, s, 0, backY, rL + 1, edgeTop + 1, { ...look, seed: 5, base: mix(C.thatch, C.thatchLight, 0.45), angle: Math.PI * 0.94 });
    for (const x of [9, 18]) box(ctx, x, backY, 1.4, edgeTop - backY, lin(ctx, x, 0, x + 1.4, 0, [[0, ink(0.14)], [1, ink(0)]]));
    box(ctx, 0, backY, rL, edgeTop - backY, lin(ctx, 0, 0, rL, 0, [[0, glint(0.12)], [1, glint(0)]]));
    ctx.restore();
    // 右の妻（東向き：暗い）
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(W - 0.2, edgeTop + 0.5);
    ctx.lineTo(W - 0.2, backY + 4);
    ctx.quadraticCurveTo(W - 0.2, backY, W - 3.5, backY);
    ctx.lineTo(rR, ridgeY);
    ctx.lineTo(rR - 1, ridgeY + 1);
    ctx.closePath();
    ctx.clip();
    thatchField(ctx, s, rR - 1, backY, W, edgeTop + 1, { ...look, seed: 6, base: mix(C.thatch, C.thatchDark, 0.62), angle: Math.PI * 0.06 });
    for (const x of [W - 10.4, W - 19.4]) box(ctx, x, backY, 1.4, edgeTop - backY, lin(ctx, x, 0, x + 1.4, 0, [[0, ink(0)], [1, ink(0.16)]]));
    box(ctx, rR - 1, backY, W - rR + 1, edgeTop - backY, lin(ctx, rR, 0, W, 0, [[0, ink(0.28)], [1, ink(0.12)]]));
    ctx.restore();
    // 手前の流れ（南向き）
    const front = [0, edgeTop + 0.5, W, edgeTop + 0.5, rR, ridgeY, rL, ridgeY];
    withClip(ctx, front, () => {
        thatchField(ctx, s, 0, ridgeY, W, edgeTop + 1, look);
        // 葺いた段（段葺き）の筋
        for (let y = ridgeY + 9; y < edgeTop - 3; y += 9) {
            box(ctx, 0, y, W, 1.8, lin(ctx, 0, y, 0, y + 1.8, [[0, ink(0.2)], [1, ink(0)]]));
            box(ctx, 0, y - 0.7, W, 0.7, glint(0.1));
        }
        box(ctx, 0, ridgeY, W, edgeTop - ridgeY, lin(ctx, 0, ridgeY, 0, edgeTop, [[0, ink(0.35)], [0.35, ink(0.05)], [1, glint(0.1)]]));
        sideLight(ctx, 0, ridgeY, W, edgeTop, 0.06, 0.12);
        // 苔
        const r = rng(9);
        for (let i = 0; i < 6; i++) {
            const x = 8 + r() * (W - 16);
            const y = ridgeY + 9 + r() * (edgeTop - ridgeY - 14);
            const rr = 2 + r() * 3;
            oval(ctx, x, y, rr * 1.9, rr, rad(ctx, x, y, rr * 1.9, [[0, withAlpha(C.moss, 0.32)], [1, withAlpha(C.moss, 0)]]));
        }
    });
    // 隅棟（寄棟の稜線）：丸みのある盛り上がり
    for (const [xa, lit] of [[0.8, true], [W - 0.8, false]] as const) {
        const xb = lit ? rL : rR;
        seg(ctx, xa, edgeTop, xb, ridgeY + 0.5, lit ? withAlpha(C.thatchLight, 0.8) : withAlpha(C.thatchDark, 0.7), 1.6);
        seg(ctx, xa + (lit ? 0.6 : -0.6), edgeTop + 0.3, xb + (lit ? 0.5 : -0.5), ridgeY + 1.2, ink(lit ? 0.18 : 0.3), 0.8);
    }
    // 軒の厚み（切りそろえた茅の小口）
    ctx.beginPath();
    ctx.moveTo(0, edgeTop + 1.5);
    ctx.quadraticCurveTo(0, edgeTop, 2.5, edgeTop);
    ctx.lineTo(W - 2.5, edgeTop);
    ctx.quadraticCurveTo(W, edgeTop, W, edgeTop + 1.5);
    ctx.lineTo(W - 0.6, eaveY - 0.4);
    ctx.quadraticCurveTo(W / 2, eaveY + 0.9, 0.6, eaveY - 0.4);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, edgeTop, 0, eaveY, [[0, mix(C.thatchLight, C.warm, 0.15)], [0.35, C.thatchLight], [0.75, C.thatch], [1, C.thatchDark]]);
    ctx.fill();
    {
        const r = rng(12);
        ctx.beginPath();
        for (let x = 0.6; x < W - 0.6; x += 0.55) {
            const y0 = edgeTop + 0.8 + r() * 0.8;
            ctx.moveTo(x, y0);
            ctx.lineTo(x + (r() - 0.5) * 0.3, eaveY - 0.3 - r() * 0.8);
        }
        ctx.strokeStyle = withAlpha(C.thatchDark, 0.38);
        ctx.lineWidth = px;
        ctx.stroke();
        box(ctx, 1, edgeTop + 0.2, W - 2, 0.6, glint(0.25));
        box(ctx, 0.6, eaveY - 1.3, W - 1.2, 1.3, lin(ctx, 0, eaveY - 1.3, 0, eaveY, [[0, ink(0)], [1, ink(0.35)]]));
    }
    sideLight(ctx, 0, edgeTop, W, eaveY, 0.1, 0.18);
    // 棟（杉皮で包み、竹で押さえた箱棟）
    const rt = ridgeY - 5.2;
    ctx.beginPath();
    ctx.moveTo(rL - 4.5, ridgeY + 1);
    ctx.lineTo(rL - 5.2, rt - 1.2);
    ctx.quadraticCurveTo(rL - 3, rt + 0.2, rL, rt);
    ctx.lineTo(rR, rt);
    ctx.quadraticCurveTo(rR + 3, rt + 0.2, rR + 5.2, rt - 1.2);
    ctx.lineTo(rR + 4.5, ridgeY + 1);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, rt, 0, ridgeY + 1, [[0, mix(C.woodLight, C.thatchDark, 0.4)], [0.35, mix(C.wood, C.thatchDark, 0.4)], [1, C.woodDark]]);
    ctx.fill();
    // 杉皮の横筋と、縄で縛った跡（控えめに）
    {
        const r = rng(14);
        ctx.beginPath();
        for (let i = 0; i < 40; i++) {
            const x = rL - 3 + r() * (rR - rL + 6);
            const y = rt + 1 + r() * (ridgeY - rt - 1);
            ctx.moveTo(x, y);
            ctx.lineTo(x + 1.5 + r() * 2.5, y + (r() - 0.5) * 0.2);
        }
        ctx.strokeStyle = glint(0.12);
        ctx.lineWidth = px * 1.2;
        ctx.stroke();
    }
    for (let x = rL - 1; x <= rR + 1; x += 5.5) {
        box(ctx, x - 0.4, rt + 0.6, 0.8, ridgeY + 0.4 - rt, ink(0.28));
        box(ctx, x - 0.4, rt + 0.6, px * 1.3, ridgeY + 0.4 - rt, withAlpha(C.bamboo, 0.45));
    }
    box(ctx, rL - 3, rt - 0.2, rR - rL + 6, 1.1, lin(ctx, 0, rt - 0.2, 0, rt + 0.9, [[0, mix(C.bamboo, C.warm, 0.3)], [1, mix(C.bamboo, C.woodDark, 0.55)]]));
    shadeBand(ctx, rL - 3, ridgeY + 1, rR - rL + 6, ridgeY + 5, 0.3);
    // 煙出し（棟の右寄りの小さな茅の越屋根）
    const sx = W * 0.5 + W * 0.18;
    fillPoly(ctx, [sx + 4, rt + 0.2, sx + 7, rt + 1, sx + 5, rt + 4, sx + 2, rt + 3], ink(0.2));
    const gab = [sx - 4.4, rt + 0.6, sx + 4.4, rt + 0.6, sx + 3.2, rt - 4.2, sx - 3.2, rt - 4.2];
    withClip(ctx, gab, () => {
        thatchField(ctx, s, sx - 5, rt - 5, sx + 5, rt + 1, { ...look, seed: 15, base: mix(C.thatch, C.thatchDark, 0.3), density: 3 });
        box(ctx, sx - 5, rt - 5, 10, 6, lin(ctx, sx - 5, 0, sx + 5, 0, [[0, glint(0.1)], [1, ink(0.25)]]));
    });
    box(ctx, sx - 2.2, rt - 2.4, 4.4, 2.2, C.interior);
    for (let x = sx - 1.6; x < sx + 2.2; x += 1.1) box(ctx, x, rt - 2.4, 0.4, 2.2, withAlpha(C.bamboo, 0.8));
    box(ctx, sx - 3.6, rt - 5.2, 7.2, 1.2, lin(ctx, 0, rt - 5.2, 0, rt - 4, [[0, mix(C.woodLight, C.thatchDark, 0.3)], [1, C.woodDark]]));
    // 軒下の影
    shadeBand(ctx, L, eaveY - 0.5, R - L, eaveY + 7, 0.55);
    // 提灯（白）
    chochin(ctx, s, f.lantern.x, f.lantern.y + 1, 5, 6.6, mix(C.paper, C.warm, 0.3), 'crest');
}

/** 薪の山（丸太の小口が並ぶ） */
function firewood(ctx: Ctx, s: number, x: number, bottom: number, w: number, rows: number): void {
    const px = 1 / s;
    const r = rng(41);
    oval(ctx, x + w / 2 + 1, bottom, w / 2 + 1.5, 1.4, ink(0.35));
    const rr = 1.35;
    for (let j = 0; j < rows; j++) {
        const y = bottom - rr - j * rr * 1.75;
        const off = (j % 2) * rr;
        for (let cx = x + rr + off; cx < x + w - rr * 0.5 - j * rr; cx += rr * 2) {
            const t = r();
            oval(ctx, cx, y, rr, rr, mix(C.woodDark, C.wood, 0.3));
            oval(ctx, cx - 0.1, y - 0.1, rr * 0.8, rr * 0.8, rad(ctx, cx, y, rr, [[0, mix('#c9a978', C.warm, t * 0.2)], [0.8, '#a88458'], [1, C.wood]]));
            ctx.beginPath();
            ctx.arc(cx, y, rr * 0.45, 0, Math.PI * 2);
            ctx.strokeStyle = withAlpha(C.wood, 0.4);
            ctx.lineWidth = px;
            ctx.stroke();
        }
    }
}

/** 小さな家（妻入り・石置きの板葺き屋根・板壁） */
function drawCottage(ctx: Ctx, s: number, f: HouseFrame): void {
    const { W, H, top, L, R } = f;
    const px = 1 / s;
    const cx = W / 2;
    // 屋根の形：棟は南北（画面の縦）。手前の破風の頂点と奥行き。
    const apexY = top - 13.5; // 手前の妻の頂点
    const eaveFront = top + 1.6; // 手前の軒の角（左右の端）
    const depth = 35.5; // 奥行き（画面上の長さ）
    const drop = eaveFront - apexY; // 破風の傾き

    // ---- 前面（板壁・板戸・窓） ----
    verticalBoards(ctx, s, L, top, R - L, HOUSE_FRONT_H, 2.6, mix(C.wood, C.woodGrey, 0.35), 17);
    const doorX0 = L + 2.4;
    const doorX1 = L + 20;
    verticalBoards(ctx, s, doorX0, top + 5, doorX1 - doorX0, HOUSE_FRONT_H - 7, 2.2, C.woodGrey, 19);
    for (const y of [top + 9, top + 19]) beam(ctx, s, doorX0, y, doorX1 - doorX0, 0.9, C.wood);
    box(ctx, doorX1 - 0.9, top + 5, 0.6, HOUSE_FRONT_H - 7, ink(0.4));
    shadeBand(ctx, doorX0, top + 5, doorX1 - doorX0, top + 10, 0.3);
    latticeWindow(ctx, s, f.window.x - 6, f.window.y - 5.5, 12, 10, 1.5);
    for (const x of [L, doorX1 + 0.3, R - 2.2]) post(ctx, s, x, top, 2.2, HOUSE_FRONT_H - 2, C.woodDark);
    sill(ctx, s, L, R, H);
    sideLight(ctx, L, top, R, H, 0.05, 0.12);
    // 妻の壁（三角）：縦板、破風の下は陰る
    const gable = [L, top + 0.5, R, top + 0.5, cx, apexY + 1.5];
    withClip(ctx, gable, () => {
        verticalBoards(ctx, s, L, apexY, R - L, top - apexY + 1, 2.4, mix(C.wood, C.woodDark, 0.25), 18);
        box(ctx, L, apexY, R - L, top - apexY, lin(ctx, 0, apexY, 0, top, [[0, ink(0.45)], [1, ink(0.12)]]));
        // 煙抜きの小窓
        box(ctx, cx - 2.6, apexY + 5.5, 5.2, 2.6, C.interior);
        for (let x = cx - 2; x < cx + 2.6; x += 1.3) box(ctx, x, apexY + 5.5, 0.45, 2.6, C.woodLight);
    });
    beam(ctx, s, L - 0.5, top - 0.8, R - L + 1, 2.4, C.woodDark);
    // 水桶
    const bx = R - 2;
    oval(ctx, bx + 1, H - 0.6, 3.6, 1, ink(0.35));
    box(ctx, bx - 3, H - 6.5, 5.6, 6, lin(ctx, bx - 3, 0, bx + 2.6, 0, [[0, '#a4865e'], [0.4, '#8b6d4b'], [1, C.woodDark]]));
    for (const y of [H - 5.6, H - 2]) box(ctx, bx - 3.1, y, 5.8, 0.6, withAlpha(C.woodDark, 0.8));
    oval(ctx, bx - 0.2, H - 6.5, 2.8, 0.8, lin(ctx, 0, H - 7.3, 0, H - 5.7, [[0, C.woodLight], [1, C.woodDark]]));
    oval(ctx, bx - 0.2, H - 6.4, 2.2, 0.5, withAlpha(P.waterDeep, 0.9));

    // ---- 屋根（石置きの板葺き・切妻の妻入り） ----
    for (const side of [-1, 1] as const) {
        const ex = side < 0 ? 0 : W; // 軒の線（画面の縦）
        const lit = side < 0;
        const slope = [ex, eaveFront, cx, apexY, cx, apexY - depth, ex, eaveFront - depth];
        const yFront = (x: number) => apexY + drop * Math.abs(x - cx) / cx;
        withClip(ctx, slope, () => {
            const base = lit ? mix(C.woodGrey, C.warm, 0.12) : mix(C.woodGrey, C.woodDark, 0.45);
            box(ctx, 0, apexY - depth, W, eaveFront - apexY + depth, base);
            // 段（棟に平行な縦の帯）と、段ごとの板の継ぎ目（流れの向きの斜め線）
            const r = rng(side < 0 ? 31 : 32);
            const course = 4.7;
            for (let k = 0; k * course < cx; k++) {
                const xa = cx + side * k * course; // 棟に近い側
                const xb = cx + side * (k + 1) * course; // 軒に近い側
                // 板の継ぎ目
                ctx.beginPath();
                for (let y = apexY - depth - 4 + r() * 2.4; y < eaveFront + 4; y += 1.8 + r() * 1.2) {
                    ctx.moveTo(xa, y);
                    ctx.lineTo(xb, y + drop * course / cx);
                }
                ctx.strokeStyle = withAlpha(C.woodDark, lit ? 0.3 : 0.4);
                ctx.lineWidth = px * 1.2;
                ctx.stroke();
                // 板ごとの色むら
                for (let y = apexY - depth; y < eaveFront; y += 2.6) {
                    const t = r();
                    if (t < 0.35) fillPoly(ctx, [xa, y, xb, y + drop * course / cx, xb, y + 2.4 + drop * course / cx, xa, y + 2.4], withAlpha(t < 0.18 ? C.woodDark : C.warm, 0.07 + t * 0.2));
                }
                // 段の小口：軒側は照り（西向きの面）か陰、その先に落ち影
                const shadowX = xb + side * -0.9;
                box(ctx, Math.min(xb, shadowX), apexY - depth - 4, 0.9, eaveFront - apexY + depth + 8, ink(lit ? 0.22 : 0.3));
                box(ctx, xb - (side < 0 ? 0 : px * 1.4), apexY - depth - 4, px * 1.4, eaveFront - apexY + depth + 8, lit ? glint(0.35) : withAlpha(C.woodGrey, 0.5));
            }
            // 光：西の面は明るく、東の面は暗い。棟の近くは少し陰る。
            box(ctx, 0, apexY - depth, W, eaveFront - apexY + depth, lin(ctx, cx, 0, ex, 0, lit ? [[0, ink(0.12)], [0.3, glint(0)], [1, glint(0.1)]] : [[0, ink(0.2)], [1, ink(0.08)]]));
            box(ctx, 0, apexY - depth, W, eaveFront - apexY + depth, lin(ctx, 0, apexY - depth, 0, eaveFront, [[0, ink(0.12)], [1, ink(0)]]));
            // 押さえ木（棟に平行）と石
            for (const k of [0.3, 0.6, 0.87]) {
                const x = cx + side * cx * k;
                const y0 = yFront(x) - depth;
                const y1 = yFront(x);
                box(ctx, x + 0.5, y0, 0.7, y1 - y0, ink(0.25));
                box(ctx, x - 0.55, y0, 1.1, y1 - y0, lin(ctx, x - 0.55, 0, x + 0.55, 0, [[0, mix(C.woodLight, C.warm, 0.15)], [1, C.woodDark]]));
                for (let y = y0 + 1.5 + r() * 3; y < y1 - 1.5; y += 3.8 + r() * 4.5) {
                    if (r() < 0.18) continue; // ところどころ石が抜けている
                    const big = r();
                    roundStone(ctx, x + (r() - 0.5) * 1.2, y, 1.1 + big * 1.2, 0.9 + big * 0.7, (lit ? -0.05 : -0.55) + (r() - 0.5) * 0.5);
                }
            }
        });
        // 軒の小口（画面の縦の線）
        box(ctx, side < 0 ? 0 : W - 1, eaveFront - depth, 1, depth, lin(ctx, side < 0 ? 0 : W - 1, 0, side < 0 ? 1 : W, 0, lit ? [[0, C.woodLight], [1, C.wood]] : [[0, C.wood], [1, C.woodDark]]));
        // 奥の破風の縁
        seg(ctx, ex, eaveFront - depth, cx, apexY - depth, lit ? withAlpha(C.woodLight, 0.9) : withAlpha(C.wood, 0.9), 0.8);
    }
    // 棟（板の棟包み：南北に通る）
    box(ctx, cx - 1.4, apexY - depth, 2.8, depth + 0.5, lin(ctx, cx - 1.4, 0, cx + 1.4, 0, [[0, mix(C.woodLight, C.warm, 0.2)], [0.45, C.wood], [1, C.woodDark]]));
    box(ctx, cx + 1.4, apexY - depth, 1.4, depth, lin(ctx, cx + 1.4, 0, cx + 2.8, 0, [[0, ink(0.3)], [1, ink(0)]]));
    // 煙出し（棟の奥寄り、東の面）
    const vx = W * 0.5 + W * 0.18;
    const vy = 10;
    fillPoly(ctx, [vx + 3.6, vy - 3, vx + 6.4, vy - 2, vx + 6.4, vy + 3.5, vx + 3.6, vy + 3.5], ink(0.25));
    box(ctx, vx - 3.2, vy - 3.4, 6.8, 4.4, C.interior);
    for (let x = vx - 2.6; x < vx + 3.4; x += 1.3) box(ctx, x, vy - 3.4, 0.5, 4.4, C.woodLight);
    fillPoly(ctx, [vx - 4.2, vy - 3.2, vx + 4.6, vy - 3.2, vx + 3.6, vy - 6, vx - 3.2, vy - 6], lin(ctx, 0, vy - 6, 0, vy - 3.2, [[0, C.woodLight], [1, C.wood]]));
    roundStone(ctx, vx, vy - 5.2, 1.3, 1, 0.1);
    // 手前の破風板（厚みのある板が頂点で合わさる）と懸魚
    for (const side of [-1, 1] as const) {
        const ex = side < 0 ? -0.2 : W + 0.2;
        fillPoly(ctx, [ex, eaveFront - 0.2, cx, apexY - 0.9, cx, apexY + 1.4, ex, eaveFront + 2], lin(ctx, 0, apexY, 0, eaveFront + 2, side < 0 ? [[0, C.woodLight], [1, C.wood]] : [[0, C.wood], [1, C.woodDark]]));
        seg(ctx, ex, eaveFront - 0.1, cx, apexY - 0.8, glint(side < 0 ? 0.4 : 0.2), px * 1.4);
    }
    fillPoly(ctx, [cx - 1.8, apexY + 1, cx + 1.8, apexY + 1, cx + 1.1, apexY + 4.2, cx, apexY + 5, cx - 1.1, apexY + 4.2], lin(ctx, cx - 1.8, 0, cx + 1.8, 0, [[0, C.woodLight], [1, C.woodDark]]));
    // 破風の下の影（妻の壁と前面の上部）
    shadeBand(ctx, L, top + 1.6, R - L, top + 5, 0.3);
    // 提灯（小さな白提灯）
    chochin(ctx, s, f.lantern.x, f.lantern.y + 0.8, 4.4, 5.8, mix(C.paper, C.warm, 0.3), 'none');
}

export function houseArt(tex: number): ArtPiece[] {
    const out: ArtPiece[] = [];
    const draws = [['house-w5-a', 5, drawMachiya], ['house-w5-b', 5, drawFarmhouse], ['house-w3-a', 3, drawCottage]] as const;
    for (const [key, wt, draw] of draws) {
        const spec = houseSpec(wt);
        const f = houseFrame(wt);
        out.push(art(key, spec, tex, (ctx, s) => draw(ctx, s, f)));
    }
    // 影：柔らかいので解像度を半分にしてメモリを節約する（表示の大きさは spec で決まる）
    const shadowTex = Math.max(1, tex / 2);
    for (const wt of [5, 3]) {
        const spec = houseSpec(wt);
        const w = spec.w + 40;
        const h = spec.h;
        const ax = spec.w / 2;
        out.push(art(houseShadowKey(wt), { w, h, ox: ax / w, oy: 1 }, shadowTex, (ctx, s) => {
            houseShadow(ctx, s, ax, h, spec.w / 2, 3 * 16);
        }));
    }
    return out;
}

/**
 * 民家の落ち影。敷地（奥行き depth）の右側から、右やや上（SHADOW_DIR）へ伸びる。
 * 左側はほぼ家の下に隠れるので、横に伸縮されても家の左へはみ出さないよう右寄りに置く。
 */
function houseShadow(ctx: Ctx, s: number, ax: number, ay: number, halfW: number, depth: number): void {
    const k = 0.6; // 高さ 1 あたりの影の長さ（夕方は WorldScene が横に伸ばす）
    const eaveH = HOUSE_FRONT_H;
    const dx = SHADOW_DIR.x * k;
    const dy = SHADOW_DIR.y * k;
    const xr = ax + halfW - 3;
    const ex = xr + eaveH * dx; // 軒の影の先
    const ey = eaveH * dy;
    const bulge = 7; // 屋根の高まりの分だけ、先が丸くふくらむ
    // 夕方は WorldScene が基準点のまわりに横へ最大 1.6 倍ほど伸ばすので、始まりは家の下（半幅の 6 割）に置く。
    // 家が半透明になったときに家の下の影が大きく透けて見えないよう、中心からは離す。
    const x0 = ax + halfW * 0.6;
    const shape = () => {
        ctx.beginPath();
        ctx.moveTo(x0, ay);
        ctx.lineTo(xr, ay);
        ctx.lineTo(ex - 2, ay + ey);
        ctx.quadraticCurveTo(ex + bulge, ay + ey - depth * 0.1, ex + bulge, ay + ey - depth / 2);
        ctx.quadraticCurveTo(ex + bulge, ay + ey - depth * 0.9, ex - 2, ay + ey - depth);
        ctx.lineTo(xr, ay - depth);
        ctx.lineTo(x0, ay - depth);
        ctx.closePath();
    };
    // 本体：建物の際が濃く、先へ行くほど薄くぼける
    blurred(ctx, s, 3.5, withAlpha(P.shadow, 0.5), () => {
        shape();
        ctx.fillStyle = lin(ctx, xr, 0, ex + bulge, 0, [[0, 'rgba(0,0,0,1)'], [0.6, 'rgba(0,0,0,0.75)'], [1, 'rgba(0,0,0,0.35)']]);
        ctx.fill();
    });
    // 建物の際の濃い陰り（接地感）
    blurred(ctx, s, 1.6, withAlpha(P.shadow, 0.28), () => {
        fillPoly(ctx, [xr - 2, ay - 0.5, xr + 4.5, ay - 1.5, xr + 4.5, ay - depth - 1, xr - 2, ay - depth], 'rgba(0,0,0,1)');
    });
}

// ===========================================================================
// 城壁
// ===========================================================================

const WALL_TILE: TileLook = { pitch: 16 / 6, course: 16 / 6, base: C.tile, light: C.tileHi, dark: C.tileDark, seed: 51 };

/** 城壁の上面（横に続く：棟が東西）。16×16、上端 y0。 */
function wallTopH(ctx: Ctx, s: number, y0: number): void {
    const px = 1 / s;
    const ridge = y0 + 6.8;
    // 奥の流れ（北向き・暗い）
    withRectClip(ctx, 0, y0, 16, ridge - y0, () => {
        kawaraField(ctx, s, 0, y0, 16, ridge, { ...WALL_TILE, base: C.tileShade, light: C.tile, seed: 52 });
        shadeBand(ctx, 0, y0, 16, y0 + 2, 0.25);
    });
    // 手前の流れ（南向き）
    withRectClip(ctx, 0, ridge, 16, y0 + 16 - ridge, () => {
        kawaraField(ctx, s, 0, ridge, 16, y0 + 16, WALL_TILE);
        shadeBand(ctx, 0, ridge, 16, ridge + 3, 0.4);
    });
    // 棟
    box(ctx, 0, ridge - 1.7, 16, 3.3, lin(ctx, 0, ridge - 1.7, 0, ridge + 1.6, [[0, C.tileHi], [0.35, C.tileLit], [1, C.tileDark]]));
    box(ctx, 0, ridge - 0.2, 16, px * 1.2, withAlpha(C.tileDark, 0.6));
    box(ctx, 0, ridge - 1.7, 16, px * 1.4, glint(0.35));
}

/** 城壁の上面（縦に続く：棟が南北）。西の流れが明るく東が暗い。 */
function wallTopV(ctx: Ctx, s: number, y0: number, y1: number): void {
    const px = 1 / s;
    const ridge = 8;
    withRectClip(ctx, 0, y0, ridge, y1 - y0, () => {
        kawaraFieldH(ctx, s, 0, y0, ridge, y1, { ...WALL_TILE, base: C.tileLit, light: C.tileHi, seed: 53 });
        box(ctx, 0, y0, ridge, y1 - y0, lin(ctx, 0, 0, ridge, 0, [[0, glint(0.06)], [0.7, glint(0)], [1, ink(0.15)]]));
    });
    withRectClip(ctx, ridge, y0, 16 - ridge, y1 - y0, () => {
        kawaraFieldH(ctx, s, ridge, y0, 16, y1, { ...WALL_TILE, base: C.tileShade, light: C.tile, dark: mix(C.tileDark, '#000000', 0.2), seed: 54 });
        box(ctx, ridge, y0, 16 - ridge, y1 - y0, lin(ctx, ridge, 0, 16, 0, [[0, ink(0.28)], [1, ink(0.05)]]));
    });
    // 棟
    box(ctx, ridge - 1.6, y0, 3.2, y1 - y0, lin(ctx, ridge - 1.6, 0, ridge + 1.6, 0, [[0, C.tileHi], [0.4, C.tileLit], [1, C.tileDark]]));
    box(ctx, ridge - 1.6, y0, px * 1.4, y1 - y0, glint(0.3));
    // 両端の軒先（瓦当の頭）
    box(ctx, 0, y0, 1, y1 - y0, lin(ctx, 0, 0, 1, 0, [[0, C.tileHi], [1, C.tileLit]]));
    box(ctx, 15, y0, 1, y1 - y0, lin(ctx, 15, 0, 16, 0, [[0, C.tileShade], [1, C.tileDark]]));
}

/** 城壁の前面（16 幅・高さ WALL_H）：軒瓦・漆喰（狭間）・水切り・石垣 */
function wallFront(ctx: Ctx, s: number, y0: number, end: boolean): void {
    const px = 1 / s;
    const H = WALL_H;
    const plasterTop = y0 + 3;
    // 漆喰は前面の上 4 割ほど、残りが石垣
    const plasterBot = y0 + 3 + Math.round((H - 3) * 0.42);
    // 漆喰
    plasterWall(ctx, 0, plasterTop, 16, plasterBot - plasterTop, 61, C.plaster, true);
    // 狭間（小さな四角の鉄砲狭間：縁は漆喰の面取り、奥は暗い）
    if (!end) {
        const hx = 8;
        const hy = plasterTop + 3.9;
        box(ctx, hx - 1.25, hy - 1.25, 2.5, 2.5, lin(ctx, 0, hy - 1.25, 0, hy + 1.25, [[0, mix(C.plasterShade, C.woodDark, 0.2)], [1, C.plasterShade]]));
        box(ctx, hx - 0.8, hy - 0.8, 1.6, 1.6, lin(ctx, 0, hy - 0.8, 0, hy + 0.8, [[0, mix(C.interior, '#000000', 0.2)], [1, mix(C.interior, C.plasterShade, 0.25)]]));
        box(ctx, hx - 1.25, hy + 1.25, 2.5, px * 1.4, glint(0.45));
    }
    // 軒下の陰
    shadeBand(ctx, 0, plasterTop, 16, plasterTop + 3.5, 0.5);
    // 水切り（腰の瓦）
    box(ctx, 0, plasterBot, 16, 1.4, lin(ctx, 0, plasterBot, 0, plasterBot + 1.4, [[0, C.tileHi], [0.5, C.tile], [1, C.tileDark]]));
    shadeBand(ctx, 0, plasterBot + 1.4, 16, plasterBot + 3, 0.35);
    // 石垣
    withRectClip(ctx, 0, plasterBot + 1.4, 16, y0 + H - plasterBot - 1.4, () => {
        stoneField(ctx, s, 0, plasterBot + 1.4, 16, y0 + H, { seed: 63, rowH: [3.2, 4.2], w: [4, 7], base: C.stone, gap: 0.5, wrap: 16, moss: 0.35 });
        shadeBand(ctx, 0, plasterBot + 1.4, 16, plasterBot + 3.2, 0.3);
        box(ctx, 0, y0 + H - 2, 16, 2, lin(ctx, 0, y0 + H - 2, 0, y0 + H, [[0, ink(0)], [1, ink(0.3)]]));
    });
    // 軒瓦（上面の軒先から続く）。瓦当の間から下が透けないよう先に帯を敷く。
    box(ctx, 0, y0, 16, 3, lin(ctx, 0, y0, 0, y0 + 3, [[0, C.tile], [1, C.tileDark]]));
    eaveTiles(ctx, s, 0, 16, y0 + 1.2, 16 / 6, 1.05, C.tile, 0.5);
    box(ctx, 0, y0, 16, px * 1.5, glint(0.25));
}

export function wallArt(tex: number): ArtPiece[] {
    return [
        art('wall-h-front', WALL_WITH_FRONT, tex, (ctx, s) => {
            wallTopH(ctx, s, 0);
            wallFront(ctx, s, 16, false);
        }),
        art('wall-v-front', WALL_WITH_FRONT, tex, (ctx, s) => {
            wallTopV(ctx, s, 0, 16);
            wallFront(ctx, s, 16, true);
            // 笠瓦の端（妻）を正面から見た形
            fillPoly(ctx, [0, 17.2, 8, 13.8, 16, 17.2, 16, 18.6, 8, 15.4, 0, 18.6], lin(ctx, 0, 0, 16, 0, [[0, C.tileHi], [0.5, C.tile], [1, C.tileDark]]));
            oval(ctx, 8, 15.2, 1.5, 1.3, rad(ctx, 8, 15.2, 1.5, [[0, C.tileHi], [1, C.tileDark]], 7.5, 14.7));
        }),
        art('wall-h', WALL_TOP_ONLY, tex, (ctx, s) => wallTopH(ctx, s, 0)),
        art('wall-v', WALL_TOP_ONLY, tex, (ctx, s) => wallTopV(ctx, s, 0, 16)),
    ];
}

// ===========================================================================
// 城門・天守の屋根（寄棟・入母屋を斜め上から）
// ===========================================================================

interface Hip {
    /** 前の軒先（瓦当の中心）の高さと左右 */
    eaveY: number;
    x0: number;
    x1: number;
    /** 軒の反り上がり */
    up: number;
    /** 手前の流れの上端（棟、または上の段の壁の下端）と左右 */
    topY: number;
    tx0: number;
    tx1: number;
    /** 左右の袖（妻側の流れ）の上端（奥の軒） */
    wingTopY: number;
    pitch: number;
    seed: number;
}

/** 反りのある軒の下端の線（左右の端が up だけ上がる） */
function eaveCurve(ctx: Ctx, x0: number, x1: number, y: number, up: number, move: boolean): void {
    const span = x1 - x0;
    const k = Math.min(18, span * 0.2);
    if (move) ctx.moveTo(x0, y - up);
    else ctx.lineTo(x0, y - up);
    ctx.quadraticCurveTo(x0 + k * 0.45, y, x0 + k, y);
    ctx.lineTo(x1 - k, y);
    ctx.quadraticCurveTo(x1 - k * 0.45, y, x1, y - up);
}

/** 寄棟の屋根（手前の流れ＋左右の袖）。軒先の瓦当・隅棟・軒下の影まで描く。 */
function hipRoof(ctx: Ctx, s: number, r: Hip): void {
    const px = 1 / s;
    const look: TileLook = { pitch: r.pitch, course: r.pitch * 1.05, base: C.tile, light: C.tileHi, dark: C.tileDark, seed: r.seed };
    const ey = r.eaveY;
    // 左の袖（西向き：明るい）
    const leftWing = [r.x0, ey - r.up, r.tx0, r.topY, r.tx0, r.wingTopY + 1, r.x0 + 1.5, r.wingTopY];
    withClip(ctx, leftWing, () => {
        kawaraFieldH(ctx, s, r.x0, r.wingTopY, r.tx0 + 1, ey, { ...look, base: C.tileLit, light: C.tileHi, seed: r.seed + 1 });
        box(ctx, r.x0, r.wingTopY, r.tx0 - r.x0, ey - r.wingTopY, lin(ctx, r.x0, 0, r.tx0, 0, [[0, glint(0.1)], [1, ink(0.08)]]));
    });
    // 右の袖（東向き：暗い）
    const rightWing = [r.x1, ey - r.up, r.tx1, r.topY, r.tx1, r.wingTopY + 1, r.x1 - 1.5, r.wingTopY];
    withClip(ctx, rightWing, () => {
        kawaraFieldH(ctx, s, r.tx1 - 1, r.wingTopY, r.x1, ey, { ...look, base: C.tileShade, light: C.tile, dark: mix(C.tileDark, '#000000', 0.25), seed: r.seed + 2 });
        box(ctx, r.tx1, r.wingTopY, r.x1 - r.tx1, ey - r.wingTopY, lin(ctx, r.tx1, 0, r.x1, 0, [[0, ink(0.3)], [1, ink(0.12)]]));
    });
    // 袖の上端（奥の軒）
    seg(ctx, r.x0 + 1.5, r.wingTopY + 0.2, r.tx0, r.wingTopY + 1.2, withAlpha(C.tileHi, 0.8), 0.7);
    seg(ctx, r.x1 - 1.5, r.wingTopY + 0.2, r.tx1, r.wingTopY + 1.2, withAlpha(C.tile, 0.8), 0.7);
    // 手前の流れ
    ctx.save();
    ctx.beginPath();
    eaveCurve(ctx, r.x0, r.x1, ey, r.up, true);
    ctx.lineTo(r.tx1, r.topY);
    ctx.lineTo(r.tx0, r.topY);
    ctx.closePath();
    ctx.clip();
    kawaraField(ctx, s, r.x0, r.topY, r.x1, ey + 1, look);
    shadeBand(ctx, r.x0, r.topY, r.x1 - r.x0, r.topY + (ey - r.topY) * 0.4, 0.38);
    sideLight(ctx, r.x0, r.topY, r.x1, ey, 0.1, 0.16);
    ctx.restore();
    // 隅棟（稜線）
    for (const [xa, xb, lit] of [[r.x0 + 0.6, r.tx0, true], [r.x1 - 0.6, r.tx1, false]] as const) {
        seg(ctx, xa, ey - r.up - 0.4, xb, r.topY, lit ? C.tileLit : C.tileShade, 1.5);
        seg(ctx, xa + (lit ? -0.25 : 0.25), ey - r.up - 0.8, xb + (lit ? -0.25 : 0.25), r.topY - 0.4, lit ? glint(0.5) : withAlpha(C.tile, 0.8), px * 1.4);
    }
    // 軒先の瓦当
    ctx.save();
    ctx.beginPath();
    eaveCurve(ctx, r.x0 - 1, r.x1 + 1, ey + 2.6, r.up, true);
    ctx.lineTo(r.x1 + 1, ey - r.up - 3);
    ctx.lineTo(r.x0 - 1, ey - r.up - 3);
    ctx.closePath();
    ctx.clip();
    eaveTiles(ctx, s, r.x0, r.x1, ey, r.pitch, r.pitch * 0.4);
    ctx.restore();
    // 反り上がった軒の端（瓦当が斜めに上がる部分を足す）
    for (const [x, dir] of [[r.x0, 1], [r.x1, -1]] as const) {
        const k = Math.min(18, (r.x1 - r.x0) * 0.2);
        for (let t = 0; t < 1; t += r.pitch / k) {
            const xx = x + dir * t * k;
            const yy = ey - r.up * (1 - t) * (1 - t);
            oval(ctx, xx, yy, r.pitch * 0.38, r.pitch * 0.38, rad(ctx, xx, yy, r.pitch * 0.38, [[0, C.tileLit], [1, C.tileDark]], xx - 0.2, yy - 0.2));
        }
    }
}

/** 天守・櫓の壁（漆喰）。左が明るく右が暗い。上に軒の影。 */
function towerWall(ctx: Ctx, s: number, x0: number, y0: number, x1: number, y1: number, seed: number): void {
    plasterWall(ctx, x0, y0, x1 - x0, y1 - y0, seed);
    sideLight(ctx, x0, y0, x1, y1, 0.06, 0.2);
    // 柱形（うっすら）
    const px = 1 / s;
    for (let x = x0 + 6; x < x1 - 3; x += 6) box(ctx, x, y0, px * 1.4, y1 - y0, withAlpha(C.plasterShade, 0.45));
}

/** 千鳥破風（屋根の上の三角の妻）。cx: 中心、by: 下端、w: 幅、h: 高さ */
function chidoriHafu(ctx: Ctx, s: number, cx: number, by: number, w: number, h: number, depth: number): void {
    const px = 1 / s;
    const ax = cx;
    const ay = by - h;
    // 右へ落ちる影
    fillPoly(ctx, [ax, ay, cx + w / 2 + 3, by - 1, cx + w / 2 + 3, by + 1, ax + 2, ay + 3], ink(0.22));
    // 破風の屋根（奥へ伸びる左右の流れ）
    fillPoly(ctx, [cx - w / 2 - 0.8, by, ax, ay, ax, ay - depth, cx - w / 2 - 0.8, by - depth * 0.6], lin(ctx, cx - w / 2, 0, ax, 0, [[0, C.tileLit], [1, C.tileHi]]));
    fillPoly(ctx, [cx + w / 2 + 0.8, by, ax, ay, ax, ay - depth, cx + w / 2 + 0.8, by - depth * 0.6], lin(ctx, ax, 0, cx + w / 2, 0, [[0, C.tile], [1, C.tileDark]]));
    ctx.save();
    poly(ctx, [cx - w / 2 - 0.8, by, ax, ay, ax, ay - depth, cx - w / 2 - 0.8, by - depth * 0.6]);
    ctx.clip();
    ctx.beginPath();
    for (let t = 0.12; t < 1; t += 0.14) {
        ctx.moveTo(cx - w / 2 + (ax - cx + w / 2) * t, by - h * t);
        ctx.lineTo(cx - w / 2 + (ax - cx + w / 2) * t, by - h * t - depth);
    }
    ctx.strokeStyle = withAlpha(C.tileDark, 0.45);
    ctx.lineWidth = px * 1.3;
    ctx.stroke();
    ctx.restore();
    seg(ctx, ax, ay, ax, ay - depth, C.tileHi, 0.9);
    // 妻の壁（漆喰の三角）
    fillPoly(ctx, [cx - w / 2 + 1.6, by, ax, ay + 1.4, cx + w / 2 - 1.6, by], lin(ctx, 0, ay, 0, by, [[0, C.plasterShade], [0.5, C.plaster], [1, C.plaster]]));
    fillPoly(ctx, [ax, ay + 1.4, cx + w / 2 - 1.6, by, ax, by], ink(0.1));
    // 破風板
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 - 0.6, by + 0.3);
    ctx.quadraticCurveTo(cx - w * 0.2, ay + h * 0.35, ax, ay);
    ctx.quadraticCurveTo(cx + w * 0.2, ay + h * 0.35, cx + w / 2 + 0.6, by + 0.3);
    ctx.strokeStyle = C.woodDark;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 - 0.6, by - 0.2);
    ctx.quadraticCurveTo(cx - w * 0.2, ay + h * 0.35 - 0.5, ax, ay - 0.5);
    ctx.strokeStyle = glint(0.35);
    ctx.lineWidth = px * 1.4;
    ctx.stroke();
    // 懸魚（金の飾り）
    ctx.beginPath();
    ctx.moveTo(ax - 1.3, ay + 1);
    ctx.quadraticCurveTo(ax, ay + 4.2, ax + 1.3, ay + 1);
    ctx.quadraticCurveTo(ax, ay + 1.9, ax - 1.3, ay + 1);
    ctx.fillStyle = lin(ctx, ax - 1.3, 0, ax + 1.3, 0, [[0, C.goldLight], [1, C.goldDark]]);
    ctx.fill();
    oval(ctx, ax, ay + 0.9, 0.7, 0.55, C.goldLight);
}

/** 鯱（しゃちほこ）。x,y は棟の上の足元。dir=1 なら右を向く（尾は外側）。 */
function shachi(ctx: Ctx, s: number, x: number, y: number, dir: 1 | -1): void {
    const px = 1 / s;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.beginPath();
    ctx.moveTo(1.8, 0);
    ctx.quadraticCurveTo(2.6, -2.2, 0.6, -3.4); // 頭から背へ
    ctx.quadraticCurveTo(-1.6, -4.6, -1.2, -6.4); // 反った胴
    ctx.lineTo(-2.9, -8.2); // 尾びれ
    ctx.lineTo(-1.4, -7.4);
    ctx.lineTo(-0.2, -8.6);
    ctx.quadraticCurveTo(-0.2, -6.2, 1.2, -5.2);
    ctx.quadraticCurveTo(-0.2, -4, 0.8, -2.2);
    ctx.lineTo(-1.2, 0);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -2, -8, 2, 0, [[0, C.goldLight], [0.5, C.gold], [1, C.goldDark]]);
    ctx.fill();
    ctx.strokeStyle = withAlpha(C.goldDark, 0.8);
    ctx.lineWidth = px;
    ctx.stroke();
    oval(ctx, 1.3, -1.6, 0.35, 0.35, C.woodDark);
    seg(ctx, 0.2, -3.5, -0.8, -6, glint(0.6), px * 1.3);
    ctx.restore();
}

// ===========================================================================
// 城門（櫓門）
// ===========================================================================

export function gateArt(tex: number): ArtPiece[] {
    return [art('gate', GATE, tex, (ctx, s) => drawGate(ctx, s))];
}

function drawGate(ctx: Ctx, s: number): void {
    const W = GATE.w;
    const H = GATE.h;
    const px = 1 / s;
    const passL = W / 2 - 32; // 22：通路（透明）の左端
    const passR = W / 2 + 32; // 86
    const beamY = 31.5;
    // ---- 左右の石垣 ----
    const sideTop = 29;
    for (const side of [0, 1] as const) {
        const outer = side === 0 ? 0 : W;
        const inner = side === 0 ? passL : passR;
        const flare = side === 0 ? 1.6 : -1.6;
        const pts = [outer, H, inner, H, inner, sideTop, outer + flare, sideTop];
        withClip(ctx, pts, () => {
            const x0 = Math.min(outer, inner);
            stoneField(ctx, s, x0, sideTop, x0 + 22, H, { seed: 80 + side, rowH: [4, 5.4], w: [5, 9], base: C.stone, gap: 0.55, wrap: 0, moss: 0.4 });
            // 左の石垣は明るく、右は暗く
            box(ctx, x0, sideTop, 22, H - sideTop, side === 0 ? lin(ctx, x0, 0, x0 + 22, 0, [[0, glint(0.1)], [1, ink(0.05)]]) : lin(ctx, x0, 0, x0 + 22, 0, [[0, ink(0.12)], [1, ink(0.25)]]));
            box(ctx, x0, H - 3, 22, 3, lin(ctx, 0, H - 3, 0, H, [[0, ink(0)], [1, ink(0.3)]]));
        });
        // 算木積みの角石（通路側の角）
        for (let y = sideTop + 1, i = 0; y < H - 2; y += 5.2, i++) {
            const long = i % 2 === 0;
            const w = long ? 8 : 4.5;
            const x = side === 0 ? inner - w : inner;
            const tone = C.stoneLight;
            box(ctx, x + 0.25, y + 0.25, w - 0.5, 4.7, lin(ctx, x, y, x + w, y + 5, [[0, mix(tone, C.warm, 0.2)], [1, mix(tone, C.stoneDark, 0.6)]]));
            box(ctx, x + 0.25, y + 0.25, w - 0.5, px * 1.3, glint(0.4));
            box(ctx, x + 0.25, y + 4.6, w - 0.5, px * 1.5, ink(0.35));
        }
    }
    // 通路の天井の陰（通路は透明のまま、梁の直下だけ薄く陰らせる）
    box(ctx, passL, beamY + 3.5, passR - passL, 4.5, lin(ctx, 0, beamY + 3.5, 0, beamY + 8, [[0, ink(0.22)], [1, ink(0)]]));
    // ---- 本柱（通路の両脇）。通路（中央 64 px）には一切かからないように外側に立てる ----
    const pw = 5.6;
    for (const [x, right] of [[passL - pw - 0.6, false], [passR + 0.6, true]] as const) {
        // 右の柱だけ、右の石垣へ落ち影（左の柱の影は通路に落ちるので描かない）
        if (right) box(ctx, x + pw, beamY + 3, 1.8, H - beamY - 4, lin(ctx, x + pw, 0, x + pw + 1.8, 0, [[0, ink(0.25)], [1, ink(0)]]));
        box(ctx, x, beamY + 2, pw, H - beamY - 3, lin(ctx, x, 0, x + pw, 0, [[0, mix(C.wood, C.woodLight, 0.6)], [0.35, C.wood], [1, C.woodDark]]));
        box(ctx, x, beamY + 2, px * 1.5, H - beamY - 3, glint(0.25));
        for (const y of [beamY + 7, H - 10]) {
            box(ctx, x, y, pw, 2, lin(ctx, 0, y, 0, y + 2, [[0, '#8e8a80'], [0.5, '#5d5a55'], [1, '#3c3a38']]));
            for (const bx of [x + 1, x + pw / 2, x + pw - 1]) oval(ctx, bx, y + 1, 0.35, 0.35, glint(0.5));
        }
        // 礎石
        box(ctx, right ? x : x - 0.6, H - 2, pw + 0.6, 2, lin(ctx, 0, H - 2, 0, H, [[0, C.stoneLight], [1, C.stoneDark]]));
    }
    // ---- 冠木（大きな梁） ----
    beam(ctx, s, passL - 7, beamY, passR - passL + 14, 3.8, C.wood);
    for (const x of [passL - 7, passR + 3]) {
        box(ctx, x, beamY - 0.2, 4, 4.2, lin(ctx, 0, beamY, 0, beamY + 4, [[0, '#8e8a80'], [1, '#3c3a38']]));
    }
    // ---- 櫓（漆喰の壁と窓） ----
    const wy0 = 17;
    const wy1 = beamY;
    towerWall(ctx, s, 3, wy0, W - 3, wy1 - 3.5, 91);
    clapboards(ctx, s, 3, wy1 - 3.5, W - 6, 3.5, 1.75, C.boardDark);
    for (const cx of [16, 38, 70, 92]) latticeWindow(ctx, s, cx - 4.5, wy0 + 3.4, 9, 5.6, 1.5, true);
    shadeBand(ctx, 3, wy0, W - 6, wy0 + 4, 0.5);
    // ---- 屋根（入母屋） ----
    hipRoof(ctx, s, { eaveY: 17.5, x0: 0, x1: W, up: 2.4, topY: 7.2, tx0: 20, tx1: W - 20, wingTopY: 10.5, pitch: 2.8, seed: 93 });
    // 大棟
    const rt = 3.6;
    box(ctx, 19, rt, W - 38, 4, lin(ctx, 0, rt, 0, rt + 4, [[0, C.tileHi], [0.35, C.tileLit], [1, C.tileDark]]));
    for (let k = 1; k <= 2; k++) box(ctx, 19, rt + k * 1.3, W - 38, px * 1.3, withAlpha(C.tileDark, 0.6));
    box(ctx, 19, rt, W - 38, px * 1.5, glint(0.4));
    shadeBand(ctx, 19, rt + 4, W - 38, rt + 6.5, 0.3);
    onigawara(ctx, s, 20.4, rt, -1, 0.9);
    onigawara(ctx, s, W - 20.4, rt, 1, 0.9);
    // ---- 門の提灯（夜はここが灯る） ----
    for (const dx of [-(W / 2 - 14), W / 2 - 14]) {
        chochin(ctx, s, W / 2 + dx, H - 26 + 0.6, 6.4, 8.6, mix(C.paper, C.warm, 0.25), 'crest');
    }
}

// ===========================================================================
// 天守
// ===========================================================================

export function keepArt(tex: number): ArtPiece[] {
    const shadowTex = Math.max(1, tex / 2);
    const sw = KEEP.w + 60;
    const sh = 60;
    const ax = KEEP.w / 2;
    return [
        art('keep', KEEP, tex, (ctx, s) => drawKeep(ctx, s)),
        art('shadow-keep', { w: sw, h: sh, ox: ax / sw, oy: 1 }, shadowTex, (ctx, s) => {
            // 夕方は WorldScene が基準点のまわりに横へ最大 1.6 倍ほど伸ばすので、影の始まりは天守の下（中心寄り）に置く
            const fx = ax + 96; // 石垣の右端（地面の位置）
            const x0 = ax + 55;
            blurred(ctx, s, 4.5, withAlpha(P.shadow, 0.48), () => {
                ctx.beginPath();
                ctx.moveTo(x0, sh);
                ctx.lineTo(fx, sh);
                // 石垣（高さ 28）の影：右やや上へ
                ctx.lineTo(fx + 19, sh - 5.5);
                ctx.quadraticCurveTo(fx + 24, sh - 14, fx + 22, sh - 22);
                // 天守の影：上の段ほど長く伸びて丸くふくらむ
                ctx.quadraticCurveTo(fx + 50, sh - 28, fx + 48, sh - 44);
                ctx.quadraticCurveTo(fx + 44, sh - 62, fx + 24, -12);
                ctx.lineTo(x0, -12);
                ctx.closePath();
                ctx.fillStyle = lin(ctx, fx, 0, fx + 50, 0, [[0, 'rgba(0,0,0,1)'], [0.5, 'rgba(0,0,0,0.75)'], [1, 'rgba(0,0,0,0.4)']]);
                ctx.fill();
            });
            // 石垣の際の濃い陰り
            blurred(ctx, s, 1.8, withAlpha(P.shadow, 0.3), () => {
                fillPoly(ctx, [fx - 3, sh - 0.5, fx + 6, sh - 2, fx + 6, -12, fx - 3, -12], 'rgba(0,0,0,1)');
            });
            // 絵の上端で影が切れて見えないよう、上へ向かって消す
            ctx.save();
            ctx.globalCompositeOperation = 'destination-in';
            box(ctx, 0, 0, sw, sh, lin(ctx, 0, 0, 0, sh, [[0, 'rgba(0,0,0,0)'], [0.35, 'rgba(0,0,0,1)'], [1, 'rgba(0,0,0,1)']]));
            ctx.restore();
        }),
    ];
}

function drawKeep(ctx: Ctx, s: number): void {
    const W = KEEP.w;
    const H = KEEP.h;
    const px = 1 / s;
    const cx = W / 2;
    // ---- 石垣の土台（天守台）：前面は扇の勾配で裾が広がる ----
    const faceTop = 100;
    const backTop = 22;
    const fl = 10; // 裾の左端
    const tl = 20; // 天端の左端
    const curve = (t: number) => fl + (tl - fl) * (1 - (1 - t) * (1 - t));
    const face: number[] = [];
    for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        face.push(curve(t), H - (H - faceTop) * t);
    }
    for (let i = 8; i >= 0; i--) {
        const t = i / 8;
        face.push(W - curve(t), H - (H - faceTop) * t);
    }
    // 側面（西：明るい／東：暗い）。急な勾配の面を横から見るので、石の段は細い縦の帯に見える。
    const courses = 6;
    for (const side of [0, 1] as const) {
        const X = (x: number) => (side === 0 ? x : W - x);
        const r = rng(101 + side);
        for (let i = 0; i < courses; i++) {
            const h0 = (i / courses) * (H - faceTop);
            const h1 = ((i + 1) / courses) * (H - faceTop);
            const xa = X(curve(i / courses));
            const xb = X(curve((i + 1) / courses));
            const ya = H - h0; // この段の手前の角（下端）
            const yb = H - h1;
            const back = 80; // 台の奥行き
            const tone = side === 0 ? mix(C.stone, C.stoneLight, 0.45) : mix(C.stone, C.stoneDark, 0.55);
            fillPoly(ctx, [xa, ya, xb, yb, xb, yb - back, xa, ya - back], C.joint);
            // 角石（正面で長い段は側面で短い）から奥へ、長さの違う石が並ぶ
            let d = 0;
            let k = 0;
            while (d < back) {
                const len = k === 0 ? (i % 2 === 0 ? 5 : 10) : 4 + r() * 6;
                const d1 = Math.min(back, d + len);
                const g = 0.3;
                const c = mix(tone, r() < 0.5 ? C.stoneLight : C.stoneDark, r() * 0.3);
                fillPoly(ctx, [xa, ya - d - g, xb, yb - d - g, xb, yb - d1 + g, xa, ya - d1 + g], c);
                seg(ctx, xa, ya - d1 + g + 0.1, xb, yb - d1 + g + 0.1, side === 0 ? glint(0.3) : ink(0.15), px * 1.3);
                d = d1;
                k++;
            }
        }
        // 側面全体の明暗
        const sidePts = side === 0 ? [...face.slice(0, 18), tl, backTop, fl, 48] : [...face.slice(18), W - fl, 48, W - tl, backTop];
        withClip(ctx, sidePts, () => box(ctx, Math.min(X(fl), X(tl)), backTop, tl - fl, H - backTop, side === 0 ? glint(0.1) : ink(0.3)));
    }
    // 天端（台の上面）：砂利敷きの平らな面。天守の右側は日陰。
    const topArea = [tl, faceTop, W - tl, faceTop, W - tl, backTop, tl, backTop];
    withClip(ctx, topArea, () => {
        box(ctx, tl, backTop, W - 2 * tl, faceTop - backTop, lin(ctx, 0, backTop, 0, faceTop, [[0, mix(C.stone, C.stoneLight, 0.45)], [1, mix(C.stoneLight, C.plasterShade, 0.35)]]));
        const r = rng(111);
        // 砂利のざらつき（細かい点を色ごとにまとめて描く）
        for (const [col, a] of [[C.stoneDark, 0.35], [C.warm, 0.3], [C.joint, 0.25]] as const) {
            ctx.beginPath();
            for (let i = 0; i < 380; i++) {
                const x = tl + r() * (W - 2 * tl);
                const y = backTop + r() * (faceTop - backTop);
                ctx.moveTo(x, y);
                ctx.lineTo(x + 0.35, y);
            }
            ctx.strokeStyle = withAlpha(col, a);
            ctx.lineWidth = 0.3;
            ctx.stroke();
        }
        // 縁に沿った敷石
        for (const [x0, x1] of [[tl, tl + 5], [W - tl - 5, W - tl]] as const) {
            box(ctx, x0, backTop, x1 - x0, faceTop - backTop, withAlpha(C.stone, 0.5));
            ctx.beginPath();
            for (let y = backTop + 4; y < faceTop; y += 4 + r() * 3) {
                ctx.moveTo(x0, y);
                ctx.lineTo(x1, y);
            }
            ctx.strokeStyle = withAlpha(C.stoneDark, 0.5);
            ctx.lineWidth = px * 1.3;
            ctx.stroke();
        }
        box(ctx, tl, faceTop - 5, W - 2 * tl, 5, withAlpha(C.stone, 0.45));
        // 天守の落とす影（右側）
        blurred(ctx, s, 3, withAlpha(P.shadow, 0.42), () => {
            fillPoly(ctx, [172, faceTop + 2, W, faceTop + 2, W, backTop - 4, 142, backTop - 4, 142, 36, 160, 50, 170, 60, 172, 74], 'rgba(0,0,0,1)');
        });
    });
    // 天端の縁石
    box(ctx, tl - 0.5, faceTop - 1.4, W - 2 * tl + 1, 2.2, lin(ctx, 0, faceTop - 1.4, 0, faceTop + 0.8, [[0, C.stoneLight], [0.5, mix(C.stoneLight, C.stone, 0.5)], [1, C.stoneDark]]));
    for (let x = tl + 4; x < W - tl; x += 6.5) box(ctx, x, faceTop - 1.4, px * 1.3, 2.2, ink(0.3));
    box(ctx, 172, faceTop - 1.4, W - tl - 172 + 0.5, 2.2, ink(0.3));
    seg(ctx, tl, faceTop - 1.2, tl, backTop, glint(0.35), 0.9);
    seg(ctx, W - tl, faceTop - 1.2, W - tl, backTop, ink(0.3), 0.9);
    box(ctx, tl, backTop - 0.6, W - 2 * tl, 1.2, lin(ctx, 0, backTop - 0.6, 0, backTop + 0.6, [[0, C.stoneLight], [1, C.stone]]));
    // 前面の石垣
    withClip(ctx, face, () => {
        stoneField(ctx, s, fl, faceTop, W - fl, H, { seed: 103, rowH: [4.2, 6.2], w: [6, 13], base: C.stone, gap: 0.55, wrap: 0, moss: 0.5 });
        // 左が明るく右が暗い・裾ほど暗い
        box(ctx, fl, faceTop, W - 2 * fl, H - faceTop, lin(ctx, fl, 0, W - fl, 0, [[0, glint(0.1)], [0.5, glint(0)], [0.7, ink(0)], [1, ink(0.28)]]));
        box(ctx, fl, faceTop, W - 2 * fl, H - faceTop, lin(ctx, 0, faceTop, 0, H, [[0, glint(0.05)], [0.7, ink(0)], [1, ink(0.3)]]));
    });
    // 算木積みの角（長い石と短い石を交互に。外側の辺は勾配の曲線に沿う）
    const rows = 6;
    for (let i = 0; i < rows; i++) {
        const yb = H - i * (H - faceTop) / rows;
        const yt = yb - (H - faceTop) / rows;
        const tb = (H - yb) / (H - faceTop);
        const tt = (H - yt) / (H - faceTop);
        const long = i % 2 === 0;
        const w = long ? 11 : 5.5;
        for (const side of [0, 1] as const) {
            const sgn = side === 0 ? 1 : -1;
            const ob = side === 0 ? curve(tb) : W - curve(tb);
            const ot = side === 0 ? curve(tt) : W - curve(tt);
            const g = 0.3;
            const pts = [ot + sgn * 0.2, yt + g, ot + sgn * w, yt + g, ob + sgn * w, yb - g, ob + sgn * 0.2, yb - g];
            const base = side === 0 ? mix(C.stone, C.stoneLight, 0.35) : mix(C.stone, C.stoneDark, 0.35);
            fillPoly(ctx, [ot, yt, ot + sgn * (w + 0.3), yt, ob + sgn * (w + 0.3), yb, ob, yb], C.joint);
            fillPoly(ctx, pts, lin(ctx, 0, yt, 0, yb, [[0, mix(base, C.warm, 0.15)], [0.6, base], [1, mix(base, C.joint, 0.3)]]));
            seg(ctx, ot + sgn * 0.3, yt + g + 0.12, ot + sgn * (w - 0.2), yt + g + 0.12, glint(0.4), px * 1.4);
            seg(ctx, ob + sgn * 0.3, yb - g - 0.15, ob + sgn * (w - 0.2), yb - g - 0.15, ink(0.35), px * 1.6);
        }
    }

    // ---- 天守（3 重）。奥行きは縮めて描き、屋根の袖で立体を見せる ----
    // 一重目の壁
    const t1 = { x0: 36, x1: W - 36, y0: 74, y1: 96.5 };
    box(ctx, t1.x0 - 1, t1.y1 - 0.6, t1.x1 - t1.x0 + 2, 1.6, lin(ctx, 0, t1.y1 - 0.6, 0, t1.y1 + 1, [[0, C.stoneLight], [1, C.stoneDark]]));
    towerWall(ctx, s, t1.x0, t1.y0, t1.x1, t1.y1 - 9, 121);
    clapboards(ctx, s, t1.x0, t1.y1 - 9, t1.x1 - t1.x0, 8.4, 2.1, C.boardDark);
    sideLight(ctx, t1.x0, t1.y1 - 9, t1.x1, t1.y1, 0.05, 0.2);
    for (let i = 0; i < 8; i++) {
        const x = t1.x0 + 9 + i * ((t1.x1 - t1.x0 - 18) / 7);
        latticeWindow(ctx, s, x - 2.8, t1.y0 + 5.2, 5.6, 5.4, 1.4, true);
    }
    shadeBand(ctx, t1.x0, t1.y0, t1.x1 - t1.x0, t1.y0 + 5, 0.5);
    // 一重目の屋根（袖は二重目の壁の脇まで）
    const t2 = { x0: 58, x1: W - 58, y0: 50, y1: 63 };
    hipRoof(ctx, s, { eaveY: 76.5, x0: 22, x1: W - 22, up: 3.2, topY: t2.y1, tx0: t2.x0, tx1: t2.x1, wingTopY: 54, pitch: 2.9, seed: 131 });
    // 二重目の壁
    towerWall(ctx, s, t2.x0, t2.y0, t2.x1, t2.y1, 141);
    for (let i = 0; i < 6; i++) {
        const x = t2.x0 + 8 + i * ((t2.x1 - t2.x0 - 16) / 5);
        latticeWindow(ctx, s, x - 2.5, t2.y0 + 4.4, 5, 5.2, 1.3, true);
    }
    shadeBand(ctx, t2.x0, t2.y0, t2.x1 - t2.x0, t2.y0 + 4, 0.5);
    // 二重目の落とす影（一重目の屋根の右袖へ）
    fillPoly(ctx, [t2.x1, t2.y0 + 2, t2.x1 + 9, t2.y0 + 1, t2.x1 + 12, t2.y1 + 8, t2.x1, t2.y1 + 4], ink(0.22));
    // 一重目の屋根の千鳥破風（二重目の壁の下にかぶる）
    chidoriHafu(ctx, s, cx - 34, 73, 22, 15, 5);
    chidoriHafu(ctx, s, cx + 34, 73, 22, 15, 5);
    // 二重目の屋根
    const t3 = { x0: 76, x1: W - 76, y0: 27.5, y1: 40 };
    hipRoof(ctx, s, { eaveY: 51.5, x0: 42, x1: W - 42, up: 2.8, topY: t3.y1, tx0: t3.x0, tx1: t3.x1, wingTopY: 36, pitch: 2.7, seed: 151 });
    // 三重目（最上階）の壁：花頭窓と廻縁
    towerWall(ctx, s, t3.x0, t3.y0, t3.x1, t3.y1, 161);
    for (const x of [cx - 13, cx + 13]) katomado(ctx, s, x, t3.y0 + 3.2, 6, 7);
    box(ctx, t3.x0 + 20, t3.y0 + 3.5, W - 2 * t3.x0 - 40, 6.5, C.interior);
    for (let x = t3.x0 + 21; x < W - t3.x0 - 20; x += 2.2) box(ctx, x, t3.y0 + 3.5, 0.8, 6.5, lin(ctx, x, 0, x + 0.8, 0, [[0, C.woodLight], [1, C.wood]]));
    shadeBand(ctx, t3.x0, t3.y0, t3.x1 - t3.x0, t3.y0 + 4, 0.5);
    // 廻縁の高欄（黒漆の手すり）
    beam(ctx, s, t3.x0 - 3, t3.y1 - 3.2, t3.x1 - t3.x0 + 6, 1.1, C.woodDark);
    for (let x = t3.x0 - 2.5; x <= t3.x1 + 2.5; x += 4.6) box(ctx, x, t3.y1 - 3, 0.8, 3.2, lin(ctx, x, 0, x + 0.8, 0, [[0, C.wood], [1, C.woodDark]]));
    box(ctx, t3.x0 - 3, t3.y1 - 0.4, t3.x1 - t3.x0 + 6, 1, C.woodDark);
    fillPoly(ctx, [t3.x1, t3.y0 + 2, t3.x1 + 7, t3.y0 + 1, t3.x1 + 9, t3.y1 + 6, t3.x1, t3.y1 + 3], ink(0.22));
    // 二重目の屋根の千鳥破風（中央）
    chidoriHafu(ctx, s, cx, 49.5, 26, 14, 5);
    // 最上重の屋根（入母屋）と大棟・鯱
    const ridgeY = 9;
    const rx0 = 84;
    const rx1 = W - 84;
    hipRoof(ctx, s, { eaveY: 29, x0: 58, x1: W - 58, up: 3, topY: ridgeY + 1.5, tx0: rx0, tx1: rx1, wingTopY: 19, pitch: 2.6, seed: 171 });
    // 入母屋の妻（棟の両端の小さな三角）
    for (const [x, dir] of [[rx0, 1], [rx1, -1]] as const) {
        fillPoly(ctx, [x, ridgeY + 1.5, x - dir * 7, ridgeY + 7.5, x, ridgeY + 7.5], lin(ctx, 0, ridgeY, 0, ridgeY + 7.5, [[0, C.plasterShade], [1, C.plaster]]));
        seg(ctx, x, ridgeY + 1.2, x - dir * 7.4, ridgeY + 7.8, C.woodDark, 0.9);
        oval(ctx, x - dir * 1.2, ridgeY + 3.3, 0.7, 0.7, C.gold);
    }
    box(ctx, rx0 - 2, ridgeY - 2.6, rx1 - rx0 + 4, 4.2, lin(ctx, 0, ridgeY - 2.6, 0, ridgeY + 1.6, [[0, C.tileHi], [0.3, C.tileLit], [1, C.tileDark]]));
    for (let k = 1; k <= 2; k++) box(ctx, rx0 - 2, ridgeY - 2.6 + k * 1.35, rx1 - rx0 + 4, px * 1.3, withAlpha(C.tileDark, 0.6));
    box(ctx, rx0 - 2, ridgeY - 2.6, rx1 - rx0 + 4, px * 1.5, glint(0.45));
    shadeBand(ctx, rx0, ridgeY + 1.6, rx1 - rx0, ridgeY + 4.5, 0.3);
    for (const [x, dir] of [[rx0 + 1.5, 1], [rx1 - 1.5, -1]] as const) {
        ctx.save();
        ctx.translate(x, ridgeY - 2.2);
        ctx.scale(1.3, 1.3);
        shachi(ctx, s * 1.3, 0, 0, dir);
        ctx.restore();
    }
}

/** 花頭窓（上が釣鐘形の窓）。cx: 中心、y: 上端 */
function katomado(ctx: Ctx, s: number, cx: number, y: number, w: number, h: number): void {
    const px = 1 / s;
    const path = (grow: number) => {
        ctx.beginPath();
        ctx.moveTo(cx - w / 2 - grow, y + h + grow);
        ctx.lineTo(cx - w / 2 - grow, y + h * 0.45);
        ctx.quadraticCurveTo(cx - w / 2 - grow, y + h * 0.1 - grow, cx - w * 0.2, y + h * 0.12 - grow);
        ctx.quadraticCurveTo(cx, y - grow * 1.5, cx + w * 0.2, y + h * 0.12 - grow);
        ctx.quadraticCurveTo(cx + w / 2 + grow, y + h * 0.1 - grow, cx + w / 2 + grow, y + h * 0.45);
        ctx.lineTo(cx + w / 2 + grow, y + h + grow);
        ctx.closePath();
    };
    path(0.7);
    ctx.fillStyle = C.woodDark;
    ctx.fill();
    path(0);
    ctx.fillStyle = lin(ctx, 0, y, 0, y + h, [[0, C.interior], [1, mix(C.interior, C.woodDark, 0.5)]]);
    ctx.fill();
    ctx.save();
    path(0);
    ctx.clip();
    for (let x = cx - w / 2 + 1; x < cx + w / 2; x += 1.3) box(ctx, x, y, 0.5, h, withAlpha(C.woodLight, 0.8));
    ctx.restore();
    box(ctx, cx - w / 2 - 0.9, y + h + 0.5, w + 1.8, 0.8, C.wood);
    box(ctx, cx - w / 2 - 0.9, y + h + 0.5, w + 1.8, px, glint(0.3));
}

// ===========================================================================
// 橋
// ===========================================================================

export function bridgeArt(tex: number): ArtPiece[] {
    return [
        art('bridge-ns', BRIDGE_NS_DECK, tex, (ctx, s) => drawBridgeNS(ctx, s)),
        art('bridge-ew', BRIDGE_EW_DECK, tex, (ctx, s) => drawBridgeEW(ctx, s)),
        art('bridge-ew-rail', BRIDGE_EW_RAIL, tex, (ctx, s) => drawRail(ctx, s)),
    ];
}

/** 板の色（1 枚ずつ少し違う・風雨で灰色がかる） */
function plankColor(i: number, seed: number): string {
    const t = hash2(i, 1, seed);
    return mix(mix(C.woodLight, C.woodGrey, 0.35 + t * 0.4), t < 0.3 ? C.wood : P.dirtLight, 0.12 + t * 0.12);
}

/** 堀に架かる南北の橋（板は東西向き・両側に低い欄干）。地面に貼る絵。 */
function drawBridgeNS(ctx: Ctx, s: number): void {
    const W = BRIDGE_NS_DECK.w;
    const H = BRIDGE_NS_DECK.h;
    const px = 1 / s;
    const x0 = 4;
    const x1 = W - 4;
    // 板
    const pitch = 3.2;
    for (let i = 0, y = 0; y < H; y += pitch, i++) {
        const c = plankColor(i, 201);
        box(ctx, x0, y, x1 - x0, pitch, lin(ctx, 0, y, 0, y + pitch, [[0, mix(c, C.warm, 0.18)], [0.3, c], [1, mix(c, C.woodDark, 0.35)]]));
        box(ctx, x0, y + pitch - px * 1.6, x1 - x0, px * 1.6, withAlpha(C.woodDark, 0.75));
        // 木目と釘
        const r = rng(i * 13 + 5);
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
            const gy = y + 0.6 + r() * (pitch - 1.2);
            const gx = x0 + r() * 20;
            ctx.moveTo(gx, gy);
            ctx.lineTo(gx + 12 + r() * 20, gy + (r() - 0.5) * 0.3);
        }
        ctx.strokeStyle = withAlpha(C.woodDark, 0.18);
        ctx.lineWidth = px;
        ctx.stroke();
        for (const nx of [x0 + 5, x1 - 5]) oval(ctx, nx, y + pitch / 2, 0.3, 0.3, withAlpha(C.woodDark, 0.8));
    }
    // 真ん中のすり減った明るい筋
    box(ctx, W / 2 - 14, 0, 28, H, lin(ctx, W / 2 - 14, 0, W / 2 + 14, 0, [[0, glint(0)], [0.5, glint(0.1)], [1, glint(0)]]));
    // 左右の地覆（縁の角材）と欄干
    for (const side of [0, 1] as const) {
        const ex = side === 0 ? x0 : x1 - 2.4;
        box(ctx, ex, 0, 2.4, H, lin(ctx, ex, 0, ex + 2.4, 0, side === 0 ? [[0, C.woodLight], [1, C.wood]] : [[0, C.wood], [1, C.woodDark]]));
        // 欄干：柱の頭と横木（上から見える）、水面へ落ちる影
        const rx = side === 0 ? 1.6 : W - 1.6;
        if (side === 1) box(ctx, W - 1, 0, 1, H, ink(0.25));
        else box(ctx, x0, 0, 1.4, H, ink(0.2));
        box(ctx, rx - 0.9, 0, 1.8, H, lin(ctx, rx - 0.9, 0, rx + 0.9, 0, [[0, mix(C.wood, C.woodLight, 0.6)], [1, C.woodDark]]));
        box(ctx, rx - 0.9, 0, px * 1.3, H, glint(0.3));
        for (let y = 2; y < H; y += 7.5) {
            box(ctx, rx - 1.3, y - 3, 2.6, 4.4, lin(ctx, rx - 1.3, 0, rx + 1.3, 0, [[0, C.woodLight], [1, C.woodDark]]));
            box(ctx, rx - 1.3, y + 1.4, 2.6, 0.9, ink(0.35));
        }
    }
    // 両端の擬宝珠
    for (const rx of [1.6, W - 1.6]) for (const y of [1.5, H - 2]) giboshi(ctx, s, rx, y, 1.5);
    // 縁は水面と地面になじませる
    box(ctx, x0, 0, x1 - x0, 1.2, lin(ctx, 0, 0, 0, 1.2, [[0, ink(0.25)], [1, ink(0)]]));
}

/** 擬宝珠（欄干の柱の頭の飾り）。cx,cy は中心 */
function giboshi(ctx: Ctx, _s: number, cx: number, cy: number, r: number): void {
    box(ctx, cx - r * 0.8, cy, r * 1.6, r * 1.2, lin(ctx, cx - r, 0, cx + r, 0, [[0, '#8f8a6a'], [1, '#4b4a3c']]));
    ctx.beginPath();
    ctx.moveTo(cx - r, cy + 0.2);
    ctx.quadraticCurveTo(cx - r, cy - r * 0.9, cx, cy - r * 1.6);
    ctx.quadraticCurveTo(cx + r, cy - r * 0.9, cx + r, cy + 0.2);
    ctx.closePath();
    ctx.fillStyle = rad(ctx, cx, cy - r * 0.4, r * 1.3, [[0, '#b3ad86'], [0.6, '#7e7a5c'], [1, '#474636']], cx - r * 0.4, cy - r * 0.8);
    ctx.fill();
    oval(ctx, cx - r * 0.35, cy - r * 0.6, r * 0.25, r * 0.35, glint(0.45));
}

/** 川に架かる東西の橋の床（板は南北向き）。北と南の端に欄干が別に置かれる。 */
function drawBridgeEW(ctx: Ctx, s: number): void {
    const W = BRIDGE_EW_DECK.w;
    const H = BRIDGE_EW_DECK.h;
    const px = 1 / s;
    // 南の縁の桁（手前の厚み）
    const deckB = H - 2.6;
    for (let i = 0, x = 0, pitch = 2.9; x < W; x += pitch, i++) {
        pitch = 2.4 + hash2(i, 5, 212) * 1.1; // 板の幅は少しずつ違う
        const c = plankColor(i, 211);
        box(ctx, x, 0, pitch, deckB, lin(ctx, x, 0, x + pitch, 0, [[0, mix(c, C.warm, 0.2)], [0.35, c], [1, mix(c, C.woodDark, 0.35)]]));
        box(ctx, x + pitch - px * 1.6, 0, px * 1.6, deckB, withAlpha(C.woodDark, 0.8));
        const r = rng(i * 7 + 3);
        ctx.beginPath();
        for (let k = 0; k < 2; k++) {
            const gx = x + 0.5 + r() * (pitch - 1);
            ctx.moveTo(gx, r() * 8);
            ctx.lineTo(gx + (r() - 0.5) * 0.3, 12 + r() * 16);
        }
        ctx.strokeStyle = withAlpha(C.woodDark, 0.2);
        ctx.lineWidth = px;
        ctx.stroke();
        for (const ny of [6, deckB - 5]) oval(ctx, x + pitch / 2, ny, 0.28, 0.28, withAlpha(C.woodDark, 0.8));
        // 節と、雨の染み
        if (r() < 0.35) oval(ctx, x + pitch * (0.3 + r() * 0.4), 9 + r() * 12, 0.45, 0.7, withAlpha(C.woodDark, 0.45));
        if (r() < 0.3) box(ctx, x, 18 + r() * 5, pitch, 5, lin(ctx, 0, 18, 0, deckB, [[0, ink(0)], [1, ink(0.12)]]));
    }
    // 真ん中のすり減り（東西に人が通る）
    box(ctx, 0, 8, W, 14, lin(ctx, 0, 8, 0, 22, [[0, glint(0)], [0.5, glint(0.1)], [1, glint(0)]]));
    // 両端（岸）の敷き木
    for (const x of [0, W - 1.6]) box(ctx, x, 0, 1.6, deckB, lin(ctx, x, 0, x + 1.6, 0, [[0, C.wood], [1, C.woodDark]]));
    // 北の縁は欄干の影で少し暗く
    box(ctx, 0, 0, W, 5, lin(ctx, 0, 0, 0, 5, [[0, ink(0.3)], [1, ink(0)]]));
    // 桁の前面（床の厚み）
    box(ctx, 0, deckB, W, 2.6, lin(ctx, 0, deckB, 0, H, [[0, C.woodLight], [0.3, C.wood], [1, C.woodDark]]));
    box(ctx, 0, deckB, W, px * 1.4, glint(0.3));
}

/** 東西の橋の欄干（正面から見た低い木の手すり。両端に擬宝珠） */
function drawRail(ctx: Ctx, s: number): void {
    const W = BRIDGE_EW_RAIL.w;
    const H = BRIDGE_EW_RAIL.h;
    const px = 1 / s;
    // 貫（下の横木）と笠木（上の横木）
    for (const [y, h] of [[5.6, 1.1], [2.2, 1.5]] as const) {
        box(ctx, 1, y + h, W - 2, 0.9, ink(0.25));
        box(ctx, 1, y, W - 2, h, lin(ctx, 0, y, 0, y + h, [[0, mix(C.woodLight, C.warm, 0.2)], [0.45, C.wood], [1, C.woodDark]]));
        box(ctx, 1, y, W - 2, px * 1.3, glint(0.3));
    }
    // 柱
    for (const x of [2.2, W / 2, W - 2.2]) {
        const w = x === W / 2 ? 1.6 : 2.2;
        box(ctx, x - w / 2, 2, w, H - 2, lin(ctx, x - w / 2, 0, x + w / 2, 0, [[0, C.woodLight], [0.4, C.wood], [1, C.woodDark]]));
        box(ctx, x + w / 2, 3.5, 0.9, H - 4, ink(0.2));
    }
    for (const x of [2.2, W - 2.2]) giboshi(ctx, s, x, 2.1, 1.35);
    // 足元の陰
    box(ctx, 0.5, H - 1.2, W - 1, 1.2, lin(ctx, 0, H - 1.2, 0, H, [[0, ink(0)], [1, ink(0.3)]]));
}

// ===========================================================================
// 小物
// ===========================================================================

export function propArt(tex: number): ArtPiece[] {
    return [
        art('prop-well', PROP_WELL, tex, (ctx, s) => drawWell(ctx, s)),
        art('prop-notice', PROP_NOTICE, tex, (ctx, s) => drawNotice(ctx, s)),
        art('prop-milestone', PROP_MILESTONE, tex, (ctx, s) => drawMilestone(ctx, s)),
        art('prop-fence-h', PROP_FENCE, tex, (ctx, s) => drawFenceH(ctx, s)),
        art('prop-fence-v', PROP_FENCE, tex, (ctx, s) => drawFenceV(ctx, s)),
        art('prop-barricade', PROP_BARRICADE, tex, (ctx, s) => drawBarricade(ctx, s)),
        art('prop-lantern', PROP_LANTERN, tex, (ctx, s) => drawStoneLantern(ctx, s)),
    ];
}

/** 井戸：石の井筒・木の井桁・滑車の柱と釣瓶 */
function drawWell(ctx: Ctx, s: number): void {
    const px = 1 / s;
    const cx = PROP_WELL.w / 2;
    const g = PROP_WELL.h * PROP_WELL.oy; // 地面 y=22
    const rx = 7.2;
    const topY = g - 7.5; // 井筒の上面の中心
    const ry = 2.8;
    // 井筒の側面（円筒：左が明るい）
    ctx.beginPath();
    ctx.moveTo(cx - rx, topY);
    ctx.lineTo(cx - rx, g - ry * 0.6);
    ctx.ellipse(cx, g - ry * 0.6, rx, ry, 0, Math.PI, 0, true);
    ctx.lineTo(cx + rx, topY);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, cx - rx, 0, cx + rx, 0, [[0, mix(C.stone, C.stoneLight, 0.6)], [0.35, C.stone], [1, C.joint]]);
    ctx.fill();
    // 石積みの目地
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    for (let y = topY + 2.2; y < g + 2; y += 2.4) {
        ctx.moveTo(cx - rx, y);
        ctx.ellipse(cx, y, rx, ry, 0, Math.PI, 0, true);
    }
    for (let i = 0; i < 12; i++) {
        const a = Math.PI * (0.05 + (i / 12) * 0.9);
        const x = cx - Math.cos(a) * rx;
        const row = i % 3;
        ctx.moveTo(x, topY + 0.3 + row * 2.4 + Math.sin(a) * ry);
        ctx.lineTo(x, topY + 2.2 + row * 2.4 + Math.sin(a) * ry);
    }
    ctx.strokeStyle = withAlpha(C.joint, 0.7);
    ctx.lineWidth = px * 1.3;
    ctx.stroke();
    box(ctx, cx - rx, g - 3, rx * 2, 4, lin(ctx, 0, g - 3, 0, g + 1, [[0, ink(0)], [1, ink(0.3)]]));
    ctx.restore();
    // 上面：縁の石と中の暗い水
    oval(ctx, cx, topY, rx, ry, lin(ctx, 0, topY - ry, 0, topY + ry, [[0, C.stoneLight], [1, C.stone]]));
    oval(ctx, cx + 0.2, topY + 0.2, rx - 1.6, ry - 0.8, lin(ctx, 0, topY - ry, 0, topY + ry, [[0, '#15191c'], [1, mix(P.waterDeep, '#15191c', 0.5)]]));
    oval(ctx, cx + 1.5, topY + 0.8, 2, 0.4, withAlpha(P.waterLight, 0.35));
    // 井桁（木の枠）
    for (const y of [topY - ry + 0.6, topY + ry - 0.9]) {
        box(ctx, cx - rx - 0.6, y - 0.6, rx * 2 + 1.2, 1.2, lin(ctx, 0, y - 0.6, 0, y + 0.6, [[0, C.woodLight], [1, C.wood]]));
    }
    // 柱と横木・滑車
    for (const x of [cx - rx + 0.8, cx + rx - 0.8]) {
        box(ctx, x - 0.7, 2, 1.4, topY - 1, lin(ctx, x - 0.7, 0, x + 0.7, 0, [[0, C.woodLight], [1, C.woodDark]]));
    }
    beam(ctx, s, cx - rx - 0.8, 1.6, rx * 2 + 1.6, 1.3, C.wood);
    oval(ctx, cx, 4.4, 1.6, 1.6, lin(ctx, cx - 1.6, 0, cx + 1.6, 0, [[0, C.woodLight], [1, C.woodDark]]));
    oval(ctx, cx, 4.4, 0.5, 0.5, C.woodDark);
    box(ctx, cx - 0.35, 2.9, 0.7, 1.5, C.woodDark);
    // 縄と釣瓶
    seg(ctx, cx - 1.5, 4.4, cx - 1.5, topY - 3.4, withAlpha(C.rope, 0.95), 0.4);
    seg(ctx, cx + 1.5, 4.4, cx + 1.5, topY - 0.3, withAlpha(C.rope, 0.95), 0.4);
    box(ctx, cx - 3, topY - 3.6, 3, 2.8, lin(ctx, cx - 3, 0, cx, 0, [[0, '#a4865e'], [1, C.woodDark]]));
    box(ctx, cx - 3.1, topY - 2.6, 3.2, 0.45, C.woodDark);
    // 手桶（縁に置いた桶）
    oval(ctx, cx + rx - 0.6, g - 0.8, 2.6, 0.9, ink(0.3));
    box(ctx, cx + rx - 3, g - 4.4, 3.8, 3.8, lin(ctx, cx + rx - 3, 0, cx + rx + 0.8, 0, [[0, '#a98a60'], [1, C.woodDark]]));
    box(ctx, cx + rx - 3.05, g - 3.6, 3.9, 0.45, C.woodDark);
    oval(ctx, cx + rx - 1.1, g - 4.4, 1.9, 0.55, lin(ctx, 0, g - 5, 0, g - 3.8, [[0, C.woodLight], [1, C.woodDark]]));
}

/** 高札（小さな屋根つきの掲示板） */
function drawNotice(ctx: Ctx, s: number): void {
    const px = 1 / s;
    const W = PROP_NOTICE.w;
    const g = PROP_NOTICE.h * PROP_NOTICE.oy; // 30
    // 柱
    for (const x of [4.5, W - 4.5]) {
        box(ctx, x + 0.9, 12, 1, g - 12, ink(0.2));
        box(ctx, x - 0.9, 8, 1.8, g - 8, lin(ctx, x - 0.9, 0, x + 0.9, 0, [[0, C.woodLight], [0.4, C.wood], [1, C.woodDark]]));
        box(ctx, x - 1.4, g - 1.4, 2.8, 1.6, lin(ctx, 0, g - 1.4, 0, g + 0.2, [[0, C.stoneLight], [1, C.stoneDark]]));
    }
    // 貫
    beam(ctx, s, 3, g - 7, W - 6, 1.1, C.wood);
    // 板（札が 4 枚並ぶ）
    const by0 = 8.6;
    const by1 = 20.5;
    box(ctx, 2.2, by0, W - 4.4, by1 - by0, lin(ctx, 0, by0, 0, by1, [[0, C.wood], [1, C.woodDark]]));
    const r = rng(301);
    const n = 4;
    const pw = (W - 6) / n;
    for (let i = 0; i < n; i++) {
        const x = 3 + i * pw + 0.3;
        const y = by0 + 0.8 + (i % 2) * 0.4;
        const w = pw - 0.6;
        const h = by1 - by0 - 1.8 - (i % 2) * 0.6;
        box(ctx, x, y, w, h, lin(ctx, x, y, x + w, y + h, [[0, mix('#d8c7a2', C.warm, 0.25)], [1, '#b39d77']]));
        box(ctx, x + w - px * 1.4, y, px * 1.4, h, ink(0.3));
        // 墨の文字（縦書きの筆の筋）
        for (let c = 0; c < 2; c++) {
            const lx = x + w * (0.72 - c * 0.42);
            let yy = y + 1;
            while (yy < y + h - 1.2) {
                const len = 0.6 + r() * 1.2;
                seg(ctx, lx + (r() - 0.5) * 0.35, yy, lx + (r() - 0.5) * 0.35, Math.min(y + h - 0.8, yy + len), withAlpha('#2a241e', 0.75), 0.42);
                yy += len + 0.35 + r() * 0.4;
            }
        }
    }
    shadeBand(ctx, 2.2, by0, W - 4.4, by0 + 3, 0.35);
    // 屋根（板の笠）
    fillPoly(ctx, [0.4, 8.8, W - 0.4, 8.8, W - 3.5, 3.2, 3.5, 3.2], lin(ctx, 0, 3.2, 0, 8.8, [[0, mix(C.woodLight, C.warm, 0.2)], [0.6, C.wood], [1, C.woodDark]]));
    ctx.beginPath();
    for (let x = 1.5; x < W - 1; x += 1.8) {
        ctx.moveTo(x + (W / 2 - x) * 0.12, 3.4);
        ctx.lineTo(x, 8.6);
    }
    ctx.strokeStyle = withAlpha(C.woodDark, 0.4);
    ctx.lineWidth = px * 1.2;
    ctx.stroke();
    box(ctx, 0.2, 8.6, W - 0.4, 1, lin(ctx, 0, 8.6, 0, 9.6, [[0, C.wood], [1, C.woodDark]]));
    box(ctx, 3, 2.3, W - 6, 1.3, lin(ctx, 0, 2.3, 0, 3.6, [[0, C.woodLight], [1, C.woodDark]]));
    // 地面の陰
    oval(ctx, W / 2 + 1.5, g + 0.3, W / 2 - 1, 1.4, ink(0.18));
}

/** 道標（石の柱。上は少し丸い。彫った文字） */
function drawMilestone(ctx: Ctx, s: number): void {
    const px = 1 / s;
    const W = PROP_MILESTONE.w;
    const g = PROP_MILESTONE.h * PROP_MILESTONE.oy; // 23
    const x0 = 2.6;
    const x1 = W - 2.6;
    // 台石
    fillPoly(ctx, [x0 - 1.8, g, x1 + 1.8, g, x1 + 1.2, g - 2.4, x0 - 1.2, g - 2.4], lin(ctx, 0, g - 2.4, 0, g, [[0, C.stoneLight], [1, C.stoneDark]]));
    // 柱の上面（奥行き）
    fillPoly(ctx, [x0, 4, x1, 4, x1 - 0.8, 2.3, x0 + 0.8, 2.3], lin(ctx, x0, 0, x1, 0, [[0, C.stoneLight], [1, C.stone]]));
    ctx.beginPath();
    ctx.moveTo(x0 + 0.8, 2.3);
    ctx.quadraticCurveTo(W / 2, 0.3, x1 - 0.8, 2.3);
    ctx.closePath();
    ctx.fillStyle = C.stoneLight;
    ctx.fill();
    // 前面
    box(ctx, x0, 4, x1 - x0, g - 6.4, lin(ctx, x0, 0, x1, 0, [[0, mix(C.stoneLight, C.warm, 0.1)], [0.45, mix(C.stone, C.stoneLight, 0.4)], [1, C.stoneDark]]));
    box(ctx, x0, 4, px * 1.5, g - 6.4, glint(0.4));
    // ざらつきと苔
    const r = rng(401);
    for (let i = 0; i < 30; i++) oval(ctx, x0 + r() * (x1 - x0), 4 + r() * (g - 7), 0.25, 0.2, r() < 0.5 ? ink(0.18) : glint(0.2));
    oval(ctx, x0 + 1.5, g - 3.2, 2.2, 1, withAlpha(C.moss, 0.5));
    // 彫った文字（縦に 1 行・筆の画を組み合わせた字らしい形）。彫りの下の縁は明るい。
    const strokes: [number, number, number, number][] = [];
    for (let yy = 5.8; yy < g - 6; yy += 3.1) {
        const cx = W / 2 + (r() - 0.5) * 0.3;
        const n = 3 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
            const kind = r();
            const ox = (r() - 0.5) * 1.6;
            const oy = r() * 2;
            if (kind < 0.4) strokes.push([cx + ox - 0.9, yy + oy, cx + ox + 0.9, yy + oy - 0.15]); // 横画
            else if (kind < 0.7) strokes.push([cx + ox, yy + oy - 0.6, cx + ox, yy + oy + 1.1]); // 縦画
            else if (kind < 0.88) strokes.push([cx + ox + 0.6, yy + oy - 0.4, cx + ox - 0.7, yy + oy + 0.9]); // 払い
            else strokes.push([cx + ox, yy + oy, cx + ox + 0.25, yy + oy + 0.3]); // 点
        }
    }
    ctx.beginPath();
    for (const [ax, ay, bx, by] of strokes) {
        ctx.moveTo(ax, ay + 0.25);
        ctx.lineTo(bx, by + 0.25);
    }
    ctx.strokeStyle = glint(0.35);
    ctx.lineWidth = 0.45;
    ctx.stroke();
    ctx.beginPath();
    for (const [ax, ay, bx, by] of strokes) {
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
    }
    ctx.strokeStyle = withAlpha(C.joint, 0.75);
    ctx.lineWidth = 0.45;
    ctx.stroke();
}

/** 四つ目垣（竹の柵）。横につながる。 */
function drawFenceH(ctx: Ctx, s: number): void {
    const px = 1 / s;
    const H = PROP_FENCE.h;
    // 地面の陰
    box(ctx, 0, H - 1.4, 16, 1.4, lin(ctx, 0, H - 1.4, 0, H, [[0, ink(0)], [1, ink(0.3)]]));
    // 立子（細い竹の縦）：タイルの中に 3 本
    for (const x of [2.8, 13.2]) bambooV(ctx, s, x, 3.2, H - 0.5, 0.9);
    // 胴縁（横の竹）
    for (const y of [4.2, 8.6]) {
        box(ctx, 0, y + 1, 16, 0.8, ink(0.22));
        box(ctx, 0, y, 16, 1, lin(ctx, 0, y, 0, y + 1, [[0, mix(C.bamboo, C.warm, 0.35)], [0.5, C.bamboo], [1, mix(C.bamboo, C.thatchDark, 0.6)]]));
        box(ctx, 5.3, y - 0.05, 0.4, 1.1, withAlpha(C.thatchDark, 0.7)); // 節
    }
    // 親柱（中央の太い杭）
    bambooV(ctx, s, 8, 1.2, H - 0.3, 1.5, true);
    // 結び目（棕櫚縄）
    for (const y of [4.7, 9.1]) {
        for (const x of [2.8, 8, 13.2]) {
            oval(ctx, x, y, 0.9, 0.55, withAlpha(C.rope, 0.95));
            seg(ctx, x - 0.6, y - 0.3, x + 0.6, y + 0.3, withAlpha(C.woodDark, 0.8), px);
        }
    }
}

/** 縦の竹（または杭）。上端に切り口 */
function bambooV(ctx: Ctx, s: number, x: number, y0: number, y1: number, w: number, stake = false): void {
    const px = 1 / s;
    const base = stake ? mix(C.wood, C.woodLight, 0.3) : C.bamboo;
    box(ctx, x + w / 2, y0 + 1, 0.8, y1 - y0 - 1, ink(0.2));
    box(ctx, x - w / 2, y0, w, y1 - y0, lin(ctx, x - w / 2, 0, x + w / 2, 0, [[0, mix(base, C.warm, 0.35)], [0.4, base], [1, mix(base, C.woodDark, 0.5)]]));
    oval(ctx, x, y0, w / 2, w * 0.28, stake ? '#c4a57a' : mix(C.bamboo, C.warm, 0.4));
    if (!stake) for (let y = y0 + 3.5; y < y1 - 1; y += 4) box(ctx, x - w / 2, y, w, px * 1.5, withAlpha(C.thatchDark, 0.6));
}

/** 奥へ続く柵を真横から（縦に積む）。細い竹の列に見える。 */
function drawFenceV(ctx: Ctx, s: number): void {
    const H = PROP_FENCE.h;
    const x = 8;
    // 胴縁（奥へ伸びる横竹が縦の線に見える）
    for (const [dx, a] of [[-0.35, 0.95], [0.35, 0.8]] as const) {
        box(ctx, x + dx - 0.45, 0, 0.9, H - 3, lin(ctx, x + dx - 0.45, 0, x + dx + 0.45, 0, [[0, withAlpha(mix(C.bamboo, C.warm, 0.3), a)], [1, withAlpha(mix(C.bamboo, C.thatchDark, 0.5), a)]]));
    }
    box(ctx, x + 0.8, 0, 1, H - 2, ink(0.18));
    // 杭（タイルの下端に 1 本）と立子
    bambooV(ctx, s, x, H - 11, H - 0.3, 1.5, true);
    bambooV(ctx, s, x, H - 9.5, H - 7, 0.9);
    for (const y of [H - 9.8, H - 5.4]) oval(ctx, x, y, 1, 0.55, withAlpha(C.rope, 0.95));
    box(ctx, x - 2, H - 1.2, 4.5, 1.2, lin(ctx, 0, H - 1.2, 0, H, [[0, ink(0)], [1, ink(0.3)]]));
}

/** 関所の柵（拒馬：横木に交差した尖り杭） */
function drawBarricade(ctx: Ctx, s: number): void {
    const px = 1 / s;
    const W = PROP_BARRICADE.w;
    const g = PROP_BARRICADE.h * PROP_BARRICADE.oy; // 21
    oval(ctx, W / 2 + 1.5, g - 0.3, W / 2, 1.6, ink(0.28));
    const stake = (xa: number, ya: number, xb: number, yb: number, lit: boolean) => {
        const w = 1.4;
        const ang = Math.atan2(yb - ya, xb - xa);
        const nx = -Math.sin(ang) * w / 2;
        const ny = Math.cos(ang) * w / 2;
        const tipX = xb + Math.cos(ang) * 1.6;
        const tipY = yb + Math.sin(ang) * 1.6;
        fillPoly(ctx, [xa + nx, ya + ny, xb + nx, yb + ny, tipX, tipY, xb - nx, yb - ny, xa - nx, ya - ny], lin(ctx, xa - nx, ya - ny, xa + nx, ya + ny, lit ? [[0, C.woodLight], [1, C.wood]] : [[0, C.wood], [1, C.woodDark]]));
        // 削った先（明るい木肌）
        fillPoly(ctx, [xb + nx * 0.9, yb + ny * 0.9, tipX, tipY, xb - nx * 0.9, yb - ny * 0.9], '#c7a878');
        seg(ctx, xa - nx, ya - ny, xb - nx, yb - ny, glint(0.25), px * 1.2);
    };
    // 奥の杭 → 横木 → 手前の杭
    for (const x of [4.5, W - 4.5]) stake(x + 4, g - 0.5, x - 4.5, 2.2, false);
    const ly = 12.5;
    box(ctx, 0.5, ly + 1.3, W - 1, 1.2, ink(0.25));
    box(ctx, 0.3, ly - 1.3, W - 0.6, 2.6, lin(ctx, 0, ly - 1.3, 0, ly + 1.3, [[0, mix(C.woodLight, C.warm, 0.2)], [0.4, C.wood], [1, C.woodDark]]));
    for (const x of [0.3, W - 0.3]) oval(ctx, x, ly, 0.9, 1.3, lin(ctx, 0, ly - 1.3, 0, ly + 1.3, [[0, '#c7a878'], [1, '#8c6c48']]));
    for (const x of [4.5, W - 4.5]) stake(x - 4, g - 0.5, x + 4.5, 2.2, true);
    // 縄の結び
    for (const x of [4.5, W - 4.5]) {
        oval(ctx, x, ly, 1.3, 1.1, withAlpha(C.rope, 0.95));
        seg(ctx, x - 1, ly - 0.6, x + 1, ly + 0.6, withAlpha(C.woodDark, 0.7), px * 1.3);
        seg(ctx, x - 1, ly + 0.6, x + 1, ly - 0.6, withAlpha(C.woodDark, 0.7), px * 1.3);
    }
}

/** 石灯籠（台・竿・火袋・笠・宝珠） */
function drawStoneLantern(ctx: Ctx, _s: number): void {
    const W = PROP_LANTERN.w;
    const H = PROP_LANTERN.h;
    const cx = W / 2;
    const face = (x: number, y: number, w: number, h: number) =>
        box(ctx, x, y, w, h, lin(ctx, x, 0, x + w, 0, [[0, mix(C.stoneLight, C.warm, 0.1)], [0.45, C.stone], [1, C.stoneDark]]));
    oval(ctx, cx + 1, H - 0.5, 4, 1, ink(0.3));
    face(cx - 3.4, H - 2.2, 6.8, 2.2); // 基礎
    face(cx - 1.1, H - 8, 2.2, 5.8); // 竿
    face(cx - 3, H - 9.3, 6, 1.4); // 中台
    // 火袋（窓から温かい色）
    face(cx - 2.4, H - 13.4, 4.8, 4.1);
    box(ctx, cx - 1.2, H - 12.6, 2.4, 2.4, rad(ctx, cx, H - 11.4, 1.8, [[0, '#f1c77a'], [1, '#7a5634']]));
    // 笠（反った屋根）
    ctx.beginPath();
    ctx.moveTo(cx - 3.9, H - 12.9);
    ctx.quadraticCurveTo(cx - 2.2, H - 13.6, cx - 1.4, H - 15.6);
    ctx.lineTo(cx + 1.4, H - 15.6);
    ctx.quadraticCurveTo(cx + 2.2, H - 13.6, cx + 3.9, H - 12.9);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, cx - 4, 0, cx + 4, 0, [[0, C.stoneLight], [0.5, C.stone], [1, C.stoneDark]]);
    ctx.fill();
    // 宝珠
    oval(ctx, cx, H - 16.5, 1.1, 1.2, rad(ctx, cx, H - 16.5, 1.3, [[0, C.stoneLight], [1, C.stoneDark]], cx - 0.4, H - 17));
    oval(ctx, cx - 1, H - 6, 0.6, 0.9, withAlpha(C.moss, 0.5));
}
