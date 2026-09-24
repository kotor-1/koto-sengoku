/**
 * 地面（草地・土の道・石畳・水面の下地・田・城門の床）をマップ全体で 1 枚に焼く。
 * 【仮実装】後で本実装に置き換える。関数の形（export）は変えないこと。
 */
import { TILE_SIZE } from '../../core/constants';
import { MAP_HEIGHT, MAP_PIXEL_HEIGHT, MAP_PIXEL_WIDTH, MAP_WIDTH, tileAt } from '../../core/map';
import { PALETTE } from './spec';
import type { ArtPiece } from './canvas';

export function groundArt(tex: number): ArtPiece {
    return {
        key: 'ground',
        spec: { w: MAP_PIXEL_WIDTH, h: MAP_PIXEL_HEIGHT, ox: 0, oy: 0 },
        width: Math.ceil(MAP_PIXEL_WIDTH * tex),
        height: Math.ceil(MAP_PIXEL_HEIGHT * tex),
        draw: (ctx) => {
            const t = TILE_SIZE * tex;
            for (let y = 0; y < MAP_HEIGHT; y++) {
                for (let x = 0; x < MAP_WIDTH; x++) {
                    const c = tileAt(x, y);
                    ctx.fillStyle =
                        c === ',' ? PALETTE.dirt
                        : c === '=' || c === 'G' || c === 'K' || c === '#' ? PALETTE.stone
                        : c === '~' ? PALETTE.water
                        : c === 'f' ? PALETTE.paddy
                        : PALETTE.grass;
                    ctx.fillRect(x * t, y * t, t + 1, t + 1);
                }
            }
        },
    };
}
