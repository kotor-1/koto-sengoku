import { AUTO, Game, Scale } from 'phaser';
import { WorldScene, type WorldSource } from './WorldScene';

/**
 * Phaser の起動。入力は DOM 側（src/platform）でまとめて扱うため、
 * Phaser 自身のキーボード・タッチ入力は使わない（二重処理とスクロール干渉を避ける）。
 */
export function createGame(parent: string, source: WorldSource): Game {
    return new Game({
        type: AUTO,
        parent,
        backgroundColor: '#1b1f16',
        pixelArt: true,
        scale: {
            mode: Scale.RESIZE,
            parent,
            width: '100%',
            height: '100%',
        },
        input: { keyboard: false, mouse: false, touch: false, gamepad: false },
        disableContextMenu: true,
        banner: false,
        scene: [new WorldScene(source)],
    });
}
