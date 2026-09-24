/**
 * 仮素材。画像ファイルを使わず、起動時に Canvas へドット絵を描いてテクスチャにする。
 * 本番素材に差し替えるときは、このファイルの代わりに画像を読み込めばよい。
 */
import { TILE_SIZE } from '../core/constants';
import { TILE_COUNT } from '../core/map';
import type { Facing } from '../core/types';

export const TILESET_KEY = 'tiles';
export const TILE_MARGIN = 1;
export const TILE_SPACING = 2;
export const HERO_KEY = 'hero';
export const RETAINER_KEY = 'retainer';
export const KEEP_KEY = 'keep';
export const GATE_KEY = 'gate-roof';
export const SHADOW_KEY = 'shadow';
export const CHAR_W = 16;
export const CHAR_H = 20;

type Ctx = CanvasRenderingContext2D;
type Painter = (x: number, y: number, w: number, h: number, color: string) => void;

function painter(ctx: Ctx, ox: number, oy: number): Painter {
    return (x, y, w, h, color) => {
        ctx.fillStyle = color;
        ctx.fillRect(ox + x, oy + y, w, h);
    };
}

function disc(r: Painter, cx: number, cy: number, radius: number, color: string): void {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
        for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
            if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius * radius) r(x, y, 1, 1, color);
        }
    }
}

// ---------- タイル ----------

const C = {
    grass: '#5e8f3c', grassDark: '#4e7d31', grassLight: '#6fa14a',
    dirt: '#b99b6b', dirtDark: '#a78a5c', dirtLight: '#c9ad7e',
    stone: '#b1ab9f', stoneLine: '#948e83',
    plaster: '#ece6d6', plasterShade: '#cfc8b6',
    roof: '#3b4150', roofLight: '#56607a',
    wood: '#6b4a2b', woodLight: '#9c6d3e', woodDark: '#74502a',
    water: '#3c73a3', waterLight: '#5d93c2', waterDark: '#33669a',
};

function grassBase(r: Painter): void {
    r(0, 0, 16, 16, C.grass);
    for (const [x, y] of [[2, 3], [9, 1], [13, 6], [5, 10], [11, 13], [1, 14], [7, 6]]) r(x, y, 1, 2, C.grassDark);
    for (const [x, y] of [[4, 5], [12, 10], [8, 14], [14, 2]]) r(x, y, 1, 1, C.grassLight);
}

function dirtBase(r: Painter): void {
    r(0, 0, 16, 16, C.dirt);
    for (const [x, y] of [[3, 2], [10, 5], [6, 11], [13, 13], [1, 8]]) r(x, y, 2, 1, C.dirtDark);
    for (const [x, y] of [[8, 1], [2, 13], [12, 9]]) r(x, y, 1, 1, C.dirtLight);
}

const TILE_DRAWERS: ((r: Painter) => void)[] = [
    // 0 草地
    grassBase,
    // 1 花
    (r) => {
        grassBase(r);
        for (const [x, y, c] of [[3, 4, '#d8574a'], [11, 9, '#d8574a'], [7, 12, '#f2eee0'], [12, 3, '#f2eee0']] as const) {
            r(x - 1, y, 3, 1, c);
            r(x, y - 1, 1, 3, c);
            r(x, y, 1, 1, '#e8c23a');
        }
    },
    // 2 土の道
    dirtBase,
    // 3 石畳
    (r) => {
        r(0, 0, 16, 16, C.stone);
        r(0, 7, 16, 1, C.stoneLine);
        r(0, 15, 16, 1, C.stoneLine);
        r(7, 0, 1, 7, C.stoneLine);
        r(3, 8, 1, 7, C.stoneLine);
        r(12, 8, 1, 7, C.stoneLine);
    },
    // 4 城壁（瓦・白壁・石垣）
    (r) => {
        r(0, 0, 16, 4, C.roof);
        r(0, 1, 16, 1, C.roofLight);
        r(0, 4, 16, 6, C.plaster);
        r(0, 4, 16, 1, C.plasterShade);
        r(0, 10, 16, 6, '#8a8d93');
        r(0, 12, 16, 1, '#6d7076');
        r(0, 15, 16, 1, '#6d7076');
        r(5, 10, 1, 2, '#6d7076');
        r(11, 13, 1, 2, '#6d7076');
        r(2, 13, 1, 2, '#6d7076');
    },
    // 5 水
    (r) => {
        r(0, 0, 16, 16, C.water);
        r(2, 4, 5, 1, C.waterLight);
        r(9, 10, 5, 1, C.waterLight);
        r(11, 3, 3, 1, C.waterDark);
        r(1, 12, 3, 1, C.waterDark);
    },
    // 6 橋
    (r) => {
        r(0, 0, 16, 16, C.woodLight);
        for (const y of [3, 7, 11, 15]) r(0, y, 16, 1, C.woodDark);
        r(0, 0, 1, 16, C.woodDark);
        r(15, 0, 1, 16, C.woodDark);
    },
    // 7 木
    (r) => {
        grassBase(r);
        r(6, 11, 4, 5, '#5a3d22');
        disc(r, 8, 7, 7, '#2e5a2a');
        disc(r, 7, 6, 5, '#3a6f33');
        disc(r, 6, 4, 2.5, '#4a8540');
        r(4, 12, 8, 1, '#244a22');
    },
    // 8 屋根（瓦）
    (r) => {
        r(0, 0, 16, 16, '#4b5563');
        for (let y = 0; y < 16; y += 4) {
            r(0, y + 3, 16, 1, '#39414c');
            for (let x = (y / 4) % 2 === 0 ? 0 : 2; x < 16; x += 4) r(x, y, 1, 3, '#5d6878');
        }
    },
    // 9 家の壁（格子窓）
    (r) => {
        r(0, 0, 16, 16, '#e8e1cc');
        r(0, 0, 16, 2, C.wood);
        r(0, 14, 16, 2, C.wood);
        r(0, 0, 1, 16, C.wood);
        r(15, 0, 1, 16, C.wood);
        r(4, 4, 8, 8, '#f4efe0');
        for (let i = 4; i <= 12; i += 2) {
            r(i, 4, 1, 8, '#5a3e24');
            r(4, i, 8, 1, '#5a3e24');
        }
    },
    // 10 柵
    (r) => {
        grassBase(r);
        r(0, 5, 16, 2, '#8a6038');
        r(0, 10, 16, 2, '#8a6038');
        r(2, 3, 2, 12, '#6b4a2b');
        r(12, 3, 2, 12, '#6b4a2b');
    },
    // 11 田
    (r) => {
        r(0, 0, 16, 16, '#6f7d44');
        r(0, 0, 16, 1, '#5e6a3a');
        r(1, 6, 14, 1, '#7b9a55');
        for (let y = 2; y < 16; y += 5) for (let x = 2; x < 16; x += 4) r(x, y, 1, 3, '#9cc95e');
    },
    // 12 井戸
    (r) => {
        dirtBase(r);
        disc(r, 8, 9, 6.5, '#8e9096');
        disc(r, 8, 9, 4, '#2d4f73');
        r(1, 1, 14, 2, C.wood);
        r(2, 3, 1, 5, C.wood);
        r(13, 3, 1, 5, C.wood);
    },
    // 13 高札
    (r) => {
        grassBase(r);
        r(3, 8, 2, 8, C.wood);
        r(11, 8, 2, 8, C.wood);
        r(0, 1, 16, 2, '#4b3a2a');
        r(1, 3, 14, 7, '#8a6038');
        r(3, 4, 10, 5, '#efe9d8');
        for (const x of [4, 7, 10]) r(x, 5, 1, 3, '#333');
    },
    // 14 道標
    (r) => {
        grassBase(r);
        r(5, 1, 6, 14, '#a4a49b');
        r(9, 1, 2, 14, '#7c7c75');
        r(5, 1, 6, 1, '#c4c4bb');
        r(7, 3, 1, 3, '#333');
        r(6, 4, 3, 1, '#333');
        r(7, 8, 1, 4, '#333');
        r(4, 14, 8, 2, '#5d5d57');
    },
    // 15 天守の下地（上に天守の絵を重ねる）
    (r) => {
        r(0, 0, 16, 16, C.stone);
    },
    // 16 城門の床
    (r) => {
        r(0, 0, 16, 16, '#a39c8f');
        r(0, 7, 16, 2, C.wood);
        r(0, 0, 16, 1, '#8b8578');
    },
    // 17 関所の柵
    (r) => {
        dirtBase(r);
        for (let i = 0; i < 14; i++) {
            r(1 + i, 1 + i, 2, 2, '#7a5530');
            r(13 - i, 1 + i, 2, 2, '#6b4a2b');
        }
        r(0, 7, 16, 2, '#8a6038');
    },
];

export function drawTileset(ctx: Ctx): { width: number; height: number } {
    const cell = TILE_SIZE + TILE_SPACING;
    for (let i = 0; i < TILE_COUNT; i++) {
        const ox = TILE_MARGIN + i * cell;
        const oy = TILE_MARGIN;
        TILE_DRAWERS[i](painter(ctx, ox, oy));
        // 1px の縁を外側へ複製して、拡大表示時の継ぎ目を防ぐ
        const s = TILE_SIZE;
        ctx.drawImage(ctx.canvas, ox, oy, s, 1, ox, oy - 1, s, 1);
        ctx.drawImage(ctx.canvas, ox, oy + s - 1, s, 1, ox, oy + s, s, 1);
        ctx.drawImage(ctx.canvas, ox, oy - 1, 1, s + 2, ox - 1, oy - 1, 1, s + 2);
        ctx.drawImage(ctx.canvas, ox + s - 1, oy - 1, 1, s + 2, ox + s, oy - 1, 1, s + 2);
    }
    return tilesetSize();
}

export function tilesetSize(): { width: number; height: number } {
    return {
        width: TILE_MARGIN * 2 + TILE_COUNT * (TILE_SIZE + TILE_SPACING) - TILE_SPACING,
        height: TILE_SIZE + TILE_MARGIN * 2,
    };
}

if (TILE_DRAWERS.length !== TILE_COUNT) {
    throw new Error(`タイル描画の数 (${TILE_DRAWERS.length}) とタイル定義の数 (${TILE_COUNT}) が一致しません`);
}

// ---------- 人物 ----------

export type CharacterStyle = 'hero' | 'retainer';
export const CHAR_FACINGS: Facing[] = ['down', 'up', 'left', 'right'];

export function charFrameName(facing: Facing, step: 0 | 1): string {
    return `${facing}-${step}`;
}

/** 8 コマ（4 方向 × 2 歩）を横一列に描く */
export function drawCharacterSheet(ctx: Ctx, style: CharacterStyle): { width: number; height: number } {
    CHAR_FACINGS.forEach((facing, fi) => {
        for (const step of [0, 1] as const) {
            const ox = (fi * 2 + step) * CHAR_W;
            if (facing === 'right') {
                ctx.save();
                ctx.translate(ox + CHAR_W, 0);
                ctx.scale(-1, 1);
                drawCharacter(painter(ctx, 0, 0), 'left', step, style);
                ctx.restore();
            } else {
                drawCharacter(painter(ctx, ox, 0), facing, step, style);
            }
        }
    });
    return { width: CHAR_W * 8, height: CHAR_H };
}

const HERO = {
    hair: '#1d1a17', skin: '#f0c9a0', body: '#34569a', bodyDark: '#26407a', legs: '#3b3b46', belt: '#d8b04a',
};
const RETAINER = {
    hair: '#2b2b30', skin: '#e6b98e', body: '#8b3a2e', bodyDark: '#5e241c', legs: '#4a3a2a', belt: '#d9b44a',
};

function drawCharacter(r: Painter, facing: Exclude<Facing, 'right'>, step: 0 | 1, style: CharacterStyle): void {
    const p = style === 'hero' ? HERO : RETAINER;
    const armored = style === 'retainer';
    const side = facing === 'left';

    // 足（歩きで片足が上がる）
    const shoe = '#222';
    if (side) {
        r(step ? 4 : 5, 18 - (step ? 1 : 0), 2, 2, shoe);
        r(step ? 9 : 8, 18, 2, 2, shoe);
    } else {
        r(5, step ? 17 : 18, 2, 2, shoe);
        r(9, step ? 18 : 17, 2, 2, shoe);
    }
    // 袴
    r(4, 15, 8, 3, p.legs);
    // 胴
    if (side) {
        r(4, 10, 8, 6, p.body);
        r(6, 11, 2, 4, p.bodyDark);
    } else {
        r(3, 10, 10, 6, p.body);
        r(2, 11, 1, 4, p.bodyDark);
        r(13, 11, 1, 4, p.bodyDark);
        if (facing === 'down' && !armored) {
            r(7, 10, 2, 2, p.skin);
            r(6, 10, 1, 3, p.bodyDark);
            r(9, 10, 1, 3, p.bodyDark);
        }
    }
    if (armored) {
        // 鎧の札（さね）と袖
        r(side ? 4 : 3, 12, side ? 8 : 10, 1, p.bodyDark);
        if (!side) {
            r(1, 10, 3, 3, p.bodyDark);
            r(12, 10, 3, 3, p.bodyDark);
        } else {
            r(8, 10, 4, 3, p.bodyDark);
        }
    }
    r(side ? 4 : 3, 14, side ? 8 : 10, 1, p.belt);

    // 頭
    if (armored) {
        // 兜と前立て
        if (facing === 'up') {
            r(4, 3, 8, 7, p.hair);
        } else if (side) {
            r(5, 5, 6, 5, p.skin);
            r(5, 7, 1, 1, '#222');
        } else {
            r(4, 5, 8, 5, p.skin);
            r(6, 7, 1, 1, '#222');
            r(9, 7, 1, 1, '#222');
        }
        r(3, 2, 10, 4, p.hair);
        r(2, 5, 12, 1, p.hair);
        if (facing !== 'up') {
            r(side ? 4 : 5, 0, 1, 2, p.belt);
            r(side ? 7 : 10, 0, 1, 2, p.belt);
            r(side ? 5 : 6, 1, side ? 2 : 4, 1, p.belt);
        }
    } else {
        if (facing === 'up') {
            r(4, 3, 8, 7, p.hair);
            r(7, 1, 2, 2, p.hair);
        } else if (side) {
            r(5, 3, 7, 7, p.skin);
            r(5, 3, 7, 2, p.hair);
            r(9, 5, 3, 4, p.hair);
            r(9, 1, 2, 2, p.hair);
            r(6, 6, 1, 1, '#222');
        } else {
            r(4, 3, 8, 7, p.skin);
            r(4, 3, 8, 2, p.hair);
            r(4, 5, 1, 2, p.hair);
            r(11, 5, 1, 2, p.hair);
            r(7, 1, 2, 2, p.hair);
            r(6, 6, 1, 1, '#222');
            r(9, 6, 1, 1, '#222');
        }
    }
}

// ---------- 大きな建物 ----------

/** 天守（192×80px = 12×5 タイル） */
export function drawKeep(ctx: Ctx): { width: number; height: number } {
    const r = painter(ctx, 0, 0);
    const W = 192;
    const H = 80;
    const tier = (y: number, h: number, inset: number) => {
        r(inset, y, W - inset * 2, h, '#ece6d6');
        r(inset, y + h - 2, W - inset * 2, 2, '#cfc8b6');
        for (let x = inset + 8; x < W - inset - 8; x += 14) r(x, y + 3, 5, 4, '#2c2f38');
    };
    const roofBand = (y: number, inset: number) => {
        r(inset - 6, y, W - (inset - 6) * 2, 6, '#3b4150');
        r(inset - 6, y, W - (inset - 6) * 2, 1, '#56607a');
        r(inset - 8, y + 4, 4, 2, '#3b4150');
        r(W - inset + 4, y + 4, 4, 2, '#3b4150');
    };
    // 石垣
    for (let y = 58; y < H; y++) {
        const inset = Math.floor((y - 58) * -0.25) + 8;
        r(inset, y, W - inset * 2, 1, y % 5 === 0 ? '#6d7076' : '#8a8d93');
    }
    tier(42, 16, 14);
    roofBand(36, 14);
    tier(24, 12, 40);
    roofBand(18, 40);
    tier(10, 8, 64);
    roofBand(4, 64);
    // 最上の屋根と鯱
    r(70, 0, 52, 4, '#3b4150');
    r(70, 0, 3, 3, '#d9b44a');
    r(119, 0, 3, 3, '#d9b44a');
    return { width: W, height: H };
}

/** 城門の屋根（人物より手前に描き、くぐる見た目にする） */
export function drawGateRoof(ctx: Ctx): { width: number; height: number } {
    const r = painter(ctx, 0, 0);
    const W = 96;
    const H = 24;
    r(0, 0, W, 9, '#33394a');
    r(0, 1, W, 1, '#56607a');
    r(0, 8, W, 1, '#2a2f3c');
    r(6, 9, W - 12, 4, '#5a3a22');
    r(14, 13, 4, 11, '#5a3a22');
    r(W - 18, 13, 4, 11, '#5a3a22');
    return { width: W, height: H };
}

export function drawShadow(ctx: Ctx): { width: number; height: number } {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(6, 2.5, 6, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    return { width: 12, height: 5 };
}
