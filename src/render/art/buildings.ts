/**
 * 建物・構造物（民家・城壁・城門・天守・橋・小物）の仮素材と影。
 * 【仮実装】後で本実装に置き換える。関数の形（export）は変えないこと。
 */
import {
    BRIDGE_EW_DECK, BRIDGE_EW_RAIL, BRIDGE_NS_DECK, GATE, KEEP, PALETTE, PROP_BARRICADE, PROP_FENCE, PROP_LANTERN,
    PROP_MILESTONE, PROP_NOTICE, PROP_WELL, SHADOW_DIR, WALL_TOP_ONLY, WALL_WITH_FRONT, houseSpec,
} from './spec';
import { piece, softEllipse, type ArtPiece, type Ctx } from './canvas';

/** 民家の種類。幅 5 は 2 種、幅 3 は 1 種。 */
export function houseKey(widthTiles: number, variant: number): string {
    return widthTiles >= 5 ? `house-w5-${variant % 2 === 0 ? 'a' : 'b'}` : 'house-w3-a';
}

export function houseShadowKey(widthTiles: number): string {
    return widthTiles >= 5 ? 'shadow-house-w5' : 'shadow-house-w3';
}

export function houseArt(tex: number): ArtPiece[] {
    const out: ArtPiece[] = [];
    for (const [key, wt] of [['house-w5-a', 5], ['house-w5-b', 5], ['house-w3-a', 3]] as const) {
        const spec = houseSpec(wt);
        out.push(piece(key, spec, tex, (ctx, s) => {
            const W = spec.w * s;
            const H = spec.h * s;
            ctx.fillStyle = PALETTE.plaster;
            ctx.fillRect(4 * s, H - 30 * s, W - 8 * s, 30 * s);
            ctx.fillStyle = key.endsWith('b') ? PALETTE.thatch : PALETTE.roof;
            ctx.fillRect(0, 0, W, H - 30 * s);
        }));
    }
    for (const wt of [5, 3]) {
        const spec = houseSpec(wt);
        const w = spec.w + 40;
        const h = spec.h;
        out.push(piece(houseShadowKey(wt), { w, h, ox: (spec.w / 2) / w, oy: 1 }, tex, (ctx, s) => {
            softEllipse(ctx, (spec.w / 2 + 18 * SHADOW_DIR.x) * s, (h - 20) * s, (spec.w / 2 + 10) * s, 24 * s, PALETTE.shadow, 0.5);
        }));
    }
    return out;
}

export function wallArt(tex: number): ArtPiece[] {
    const top = (ctx: Ctx, s: number, horizontal: boolean) => {
        ctx.fillStyle = PALETTE.roof;
        ctx.fillRect(0, 0, 16 * s, 16 * s);
        ctx.fillStyle = PALETTE.roofLight;
        if (horizontal) ctx.fillRect(0, 7 * s, 16 * s, 2 * s);
        else ctx.fillRect(7 * s, 0, 2 * s, 16 * s);
    };
    const front = (ctx: Ctx, s: number) => {
        ctx.fillStyle = PALETTE.plaster;
        ctx.fillRect(0, 16 * s, 16 * s, 10 * s);
        ctx.fillStyle = PALETTE.stoneWall;
        ctx.fillRect(0, 26 * s, 16 * s, 10 * s);
    };
    return [
        piece('wall-h-front', WALL_WITH_FRONT, tex, (ctx, s) => { top(ctx, s, true); front(ctx, s); }),
        piece('wall-v-front', WALL_WITH_FRONT, tex, (ctx, s) => { top(ctx, s, false); front(ctx, s); }),
        piece('wall-h', WALL_TOP_ONLY, tex, (ctx, s) => top(ctx, s, true)),
        piece('wall-v', WALL_TOP_ONLY, tex, (ctx, s) => top(ctx, s, false)),
    ];
}

export function gateArt(tex: number): ArtPiece[] {
    return [
        piece('gate', GATE, tex, (ctx, s) => {
            ctx.fillStyle = PALETTE.wood;
            ctx.fillRect(10 * s, 20 * s, 6 * s, 42 * s);
            ctx.fillRect((GATE.w - 16) * s, 20 * s, 6 * s, 42 * s);
            ctx.fillStyle = PALETTE.roof;
            ctx.fillRect(0, 0, GATE.w * s, 22 * s);
        }),
    ];
}

export function keepArt(tex: number): ArtPiece[] {
    return [
        piece('keep', KEEP, tex, (ctx, s) => {
            ctx.fillStyle = PALETTE.stoneWall;
            ctx.fillRect(0, (KEEP.h - 30) * s, KEEP.w * s, 30 * s);
            ctx.fillStyle = PALETTE.plaster;
            ctx.fillRect(30 * s, 20 * s, (KEEP.w - 60) * s, (KEEP.h - 50) * s);
            ctx.fillStyle = PALETTE.roof;
            ctx.fillRect(20 * s, 10 * s, (KEEP.w - 40) * s, 14 * s);
        }),
        piece('shadow-keep', { w: KEEP.w + 60, h: 60, ox: (KEEP.w / 2) / (KEEP.w + 60), oy: 1 }, tex, (ctx, s) => {
            softEllipse(ctx, (KEEP.w / 2 + 30) * s, 30 * s, (KEEP.w / 2 + 20) * s, 26 * s, PALETTE.shadow, 0.45);
        }),
    ];
}

export function bridgeArt(tex: number): ArtPiece[] {
    const deck = (ctx: Ctx, s: number, w: number, h: number) => {
        ctx.fillStyle = PALETTE.woodLight;
        ctx.fillRect(0, 0, w * s, h * s);
    };
    return [
        piece('bridge-ns', BRIDGE_NS_DECK, tex, (ctx, s) => deck(ctx, s, BRIDGE_NS_DECK.w, BRIDGE_NS_DECK.h)),
        piece('bridge-ew', BRIDGE_EW_DECK, tex, (ctx, s) => deck(ctx, s, BRIDGE_EW_DECK.w, BRIDGE_EW_DECK.h)),
        piece('bridge-ew-rail', BRIDGE_EW_RAIL, tex, (ctx, s) => {
            ctx.fillStyle = PALETTE.wood;
            ctx.fillRect(0, 2 * s, BRIDGE_EW_RAIL.w * s, 3 * s);
        }),
    ];
}

export function propArt(tex: number): ArtPiece[] {
    const box = (color: string) => (ctx: Ctx, s: number, w: number, h: number) => {
        ctx.fillStyle = color;
        ctx.fillRect(2 * s, 2 * s, (w - 4) * s, (h - 4) * s);
    };
    const mk = (key: string, spec: ArtPiece['spec'], color: string) =>
        piece(key, spec, tex, (ctx, s) => box(color)(ctx, s, spec.w, spec.h));
    return [
        mk('prop-well', PROP_WELL, PALETTE.stoneWall),
        mk('prop-notice', PROP_NOTICE, PALETTE.woodLight),
        mk('prop-milestone', PROP_MILESTONE, PALETTE.stone),
        mk('prop-fence-h', PROP_FENCE, PALETTE.wood),
        mk('prop-fence-v', PROP_FENCE, PALETTE.woodDark),
        mk('prop-barricade', PROP_BARRICADE, PALETTE.wood),
        mk('prop-lantern', PROP_LANTERN, PALETTE.lantern),
    ];
}
