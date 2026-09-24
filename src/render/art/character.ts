/**
 * 人物（主人公・家臣）の高解像度の仮素材。8 方向 × (待機 + 歩行 8 コマ)。
 * 【仮実装】後で本実装に置き換える。関数の形（export）は変えないこと。
 */
import { CHARACTER, DIRECTIONS, PALETTE, WALK_FRAMES } from './spec';
import type { ArtPiece, Ctx } from './canvas';

export type CharacterStyle = 'hero' | 'retainer';

export function characterFrameName(dir: number, walkFrame: number | null): string {
    return walkFrame === null ? `d${dir}-idle` : `d${dir}-w${walkFrame}`;
}

/**
 * アトラス 1 枚：行 = 方向（0〜7）、列 = 0:待機, 1〜8:歩行。
 * 家臣は歩かないので待機だけ（列 1 つ）。
 */
export function characterAtlas(style: CharacterStyle, key: string, tex: number): ArtPiece {
    const fw = Math.ceil(CHARACTER.w * tex);
    const fh = Math.ceil(CHARACTER.h * tex);
    const cols = style === 'hero' ? 1 + WALK_FRAMES : 1;
    const frames: NonNullable<ArtPiece['frames']> = [];
    for (let d = 0; d < DIRECTIONS; d++) {
        for (let c = 0; c < cols; c++) {
            frames.push({ name: characterFrameName(d, c === 0 ? null : c - 1), x: c * fw, y: d * fh, w: fw, h: fh });
        }
    }
    return {
        key,
        spec: CHARACTER,
        width: fw * cols,
        height: fh * DIRECTIONS,
        frames,
        draw: (ctx) => {
            for (const f of frames) {
                const m = /^d(\d)-(idle|w(\d))$/.exec(f.name)!;
                const dir = Number(m[1]);
                const walk = m[3] === undefined ? null : Number(m[3]) / WALK_FRAMES;
                ctx.save();
                ctx.translate(f.x, f.y);
                drawCharacterFrame(ctx, style, dir, walk, tex);
                ctx.restore();
            }
        },
    };
}

/** 1 コマ描く。(0,0)〜(CHARACTER.w*s, CHARACTER.h*s) の範囲。足元は (w/2, h*oy)。 */
export function drawCharacterFrame(ctx: Ctx, style: CharacterStyle, dir: number, walkPhase: number | null, s: number): void {
    const cx = (CHARACTER.w * s) / 2;
    const foot = CHARACTER.h * CHARACTER.oy * s;
    const bob = walkPhase === null ? 0 : Math.abs(Math.sin(walkPhase * Math.PI * 2)) * 1.2 * s;
    const body = style === 'hero' ? PALETTE.indigo : PALETTE.armorRed;
    ctx.fillStyle = PALETTE.hakama;
    ctx.fillRect(cx - 5 * s, foot - 14 * s, 10 * s, 14 * s);
    ctx.fillStyle = body;
    ctx.fillRect(cx - 6 * s, foot - 26 * s - bob, 12 * s, 13 * s);
    ctx.fillStyle = PALETTE.skin;
    ctx.beginPath();
    ctx.arc(cx, foot - 30 * s - bob, 5 * s, 0, Math.PI * 2);
    ctx.fill();
    // 向きの目印
    const a = Math.PI / 2 - dir * (Math.PI / 4);
    ctx.fillStyle = PALETTE.hair;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * 3 * s, foot - 30 * s - bob + Math.sin(a) * 2 * s, 1.5 * s, 0, Math.PI * 2);
    ctx.fill();
}
