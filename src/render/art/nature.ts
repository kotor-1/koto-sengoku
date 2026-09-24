/**
 * 木・草むら・花の仮素材と木の影。
 * 【仮実装】後で本実装に置き換える。関数の形（export）は変えないこと。
 */
import { FLOWER, FLOWER_VARIANTS, PALETTE, TREE, TUFT, TUFT_VARIANTS } from './spec';
import { piece, softEllipse, type ArtPiece } from './canvas';

/** 木の種類：松・広葉樹 2 種 */
export const TREE_KEYS = ['tree-pine', 'tree-broad-a', 'tree-broad-b'] as const;

export function treeArt(tex: number): ArtPiece[] {
    const out = TREE_KEYS.map((key, i) =>
        piece(key, TREE, tex, (ctx, s) => {
            const W = TREE.w * s;
            const base = TREE.h * TREE.oy * s;
            ctx.fillStyle = PALETTE.bark;
            ctx.fillRect(W / 2 - 2 * s, base - 18 * s, 4 * s, 18 * s);
            ctx.fillStyle = i === 0 ? PALETTE.pine : PALETTE.leaf;
            ctx.beginPath();
            ctx.arc(W / 2, base - 36 * s, 18 * s, 0, Math.PI * 2);
            ctx.fill();
        }),
    );
    out.push(
        piece('shadow-tree', { w: 56, h: 20, ox: 12 / 56, oy: 0.5 }, tex, (ctx, s) => {
            softEllipse(ctx, 30 * s, 10 * s, 24 * s, 8 * s, PALETTE.shadow, 0.5);
        }),
    );
    return out;
}

export function tuftArt(tex: number): ArtPiece[] {
    const out: ArtPiece[] = [];
    for (let i = 0; i < TUFT_VARIANTS; i++) {
        out.push(piece(`tuft-${i}`, TUFT, tex, (ctx, s) => {
            ctx.strokeStyle = i === 2 ? PALETTE.grassDry : PALETTE.grassLight;
            ctx.lineWidth = 1 * s;
            for (let k = 0; k < 5; k++) {
                ctx.beginPath();
                ctx.moveTo((3 + k * 1.5) * s, TUFT.h * s);
                ctx.lineTo((2 + k * 2) * s, 2 * s);
                ctx.stroke();
            }
        }));
    }
    for (let i = 0; i < FLOWER_VARIANTS; i++) {
        out.push(piece(`flower-${i}`, FLOWER, tex, (ctx, s) => {
            ctx.fillStyle = i === 0 ? '#c8665a' : '#e8e0c8';
            ctx.beginPath();
            ctx.arc(5 * s, 4 * s, 2 * s, 0, Math.PI * 2);
            ctx.fill();
        }));
    }
    return out;
}
