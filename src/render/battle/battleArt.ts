/**
 * 模擬戦用の小さな効果の絵（起動時に 1 回だけ描く）。
 * - fx-slash：刀を振った弧。8 方向ぶんを別々のコマとして描いておく（表示時に回転しない：
 *   Phaser 4 の複数テクスチャ一括描画で、回転した画像が別のテクスチャで描かれる不具合を避けるため）。
 */
import type { ArtPiece, Ctx } from '../art/canvas';
import { dirAngle } from '../world/heading';

/** 弧の 1 コマの大きさ（Canvas px）と、ワールドでの大きさ */
const SLASH_PX = 96;
export const SLASH_WORLD = 26;
export const slashFrame = (dir: number) => `s${dir}`;

export function battleArt(): ArtPiece[] {
    const frames = Array.from({ length: 8 }, (_, d) => ({ name: slashFrame(d), x: d * SLASH_PX, y: 0, w: SLASH_PX, h: SLASH_PX }));
    return [
        {
            key: 'fx-slash',
            width: SLASH_PX * 8,
            height: SLASH_PX,
            frames,
            spec: { w: SLASH_WORLD, h: SLASH_WORLD, ox: 0.5, oy: 0.5 },
            draw: (ctx) => {
                for (let d = 0; d < 8; d++) drawSlash(ctx, d * SLASH_PX + SLASH_PX / 2, SLASH_PX / 2, dirAngle(d));
            },
        },
    ];
}

/** 三日月形の弧：中央が太く両端が細い。外側は白、内側へ向かって金色に透ける。 */
function drawSlash(ctx: Ctx, cx: number, cy: number, a: number): void {
    const R = SLASH_PX * 0.42;
    const spread = 1.25; // 弧の広がり（ラジアン、片側）
    const steps = 28;
    const outer: [number, number][] = [];
    const inner: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const th = a - spread + t * spread * 2;
        const w = Math.sin(t * Math.PI); // 中央が太い
        const ro = R;
        const ri = R - 3 - w * SLASH_PX * 0.13;
        outer.push([cx + Math.cos(th) * ro, cy + Math.sin(th) * ro]);
        inner.push([cx + Math.cos(th) * ri, cy + Math.sin(th) * ri]);
    }
    const g = ctx.createRadialGradient(cx, cy, R * 0.45, cx, cy, R);
    g.addColorStop(0, 'rgba(255, 214, 140, 0)');
    g.addColorStop(0.6, 'rgba(255, 226, 170, 0.55)');
    g.addColorStop(1, 'rgba(255, 252, 240, 0.95)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(outer[0][0], outer[0][1]);
    for (const p of outer) ctx.lineTo(p[0], p[1]);
    for (let i = inner.length - 1; i >= 0; i--) ctx.lineTo(inner[i][0], inner[i][1]);
    ctx.closePath();
    ctx.fill();
}
