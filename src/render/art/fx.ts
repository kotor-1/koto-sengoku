/**
 * 効果用の小さなテクスチャ（影・煙・粒子・光・周辺減光・水面の揺らぎ・地面の質感・吹き出し）。
 * 【仮実装】後で本実装に置き換える。関数の形（export）は変えないこと。
 * これらは Canvas px で直接大きさを決める（ワールド換算は WorldScene 側で行う）。
 */
import { PALETTE } from './spec';
import { softEllipse, type ArtPiece } from './canvas';

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
        px('fx-shadow', 64, 32, (ctx) => softEllipse(ctx, 32, 16, 30, 14, PALETTE.shadow, 1)),
        { ...px('fx-cast', 64, 32, (ctx) => softEllipse(ctx, 30, 16, 30, 10, PALETTE.shadow, 1)), spec: { w: 64, h: 32, ox: 0, oy: 0.5 } },
        px('fx-smoke', 64, 64, (ctx) => softEllipse(ctx, 32, 32, 30, 30, '#d8d4cc', 0.9)),
        px('fx-mote', 16, 16, (ctx) => softEllipse(ctx, 8, 8, 7, 7, '#ffffff', 1)),
        px('fx-leaf', 16, 10, (ctx) => softEllipse(ctx, 8, 5, 7, 4, '#b8872f', 1)),
        px('fx-glow', 128, 128, (ctx) => softEllipse(ctx, 64, 64, 62, 62, PALETTE.lantern, 1)),
        px('fx-vignette', 256, 256, (ctx) => {
            const g = ctx.createRadialGradient(128, 128, 60, 128, 128, 181);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(1, 'rgba(0,0,0,1)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 256, 256);
        }),
        px('fx-ripple', 128, 128, (ctx) => {
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            for (let i = 0; i < 6; i++) {
                ctx.beginPath();
                ctx.moveTo((i * 23) % 128, (i * 41) % 128);
                ctx.lineTo(((i * 23) % 128) + 12, (i * 41) % 128);
                ctx.stroke();
            }
        }),
        px('fx-detail', 256, 256, (ctx) => {
            ctx.fillStyle = '#f2f2f2';
            ctx.fillRect(0, 0, 256, 256);
        }),
        { ...px('fx-bubble', 48, 40, (ctx) => {
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.beginPath();
            ctx.arc(24, 18, 16, 0, Math.PI * 2);
            ctx.fill();
        }), spec: { w: 12, h: 10, ox: 0.5, oy: 1 } },
        px('fx-sun', 128, 128, (ctx) => {
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 180);
            g.addColorStop(0, 'rgba(255,255,255,1)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 128, 128);
        }),
    ];
}
