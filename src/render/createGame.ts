import { AUTO, Game, Scale } from 'phaser';
import { Viewport } from './viewport';
import { WorldScene, type WorldSource } from './WorldScene';
import { chooseQuality, initialRenderScale, type QualityProfile } from './world/quality';

export interface GameHandle {
    game: Game;
    viewport: Viewport;
    quality: QualityProfile;
}

/**
 * Phaser の起動。
 * - 入力は DOM 側（src/platform）でまとめて扱うため、Phaser 自身の入力は使わない。
 * - 解像度は Viewport で管理する（Scale.NONE）。
 */
export function createGame(parentId: string, source: WorldSource): GameHandle {
    const parent = document.getElementById(parentId);
    if (!parent) throw new Error(`#${parentId} がありません`);
    const params = new URLSearchParams(location.search);
    const nav = navigator as Navigator & { deviceMemory?: number };
    const quality = chooseQuality({
        devicePixelRatio: window.devicePixelRatio || 1,
        deviceMemory: nav.deviceMemory,
        hardwareConcurrency: nav.hardwareConcurrency,
        touch: (navigator.maxTouchPoints ?? 0) > 0,
        forced: params.get('q'),
    });
    const viewport = new Viewport(parent, initialRenderScale(quality, window.devicePixelRatio || 1));

    const game = new Game({
        type: AUTO,
        parent,
        width: viewport.pixelWidth,
        height: viewport.pixelHeight,
        backgroundColor: '#1d2019',
        antialias: true,
        pixelArt: false,
        roundPixels: false,
        scale: { mode: Scale.NONE, autoRound: true },
        input: { keyboard: false, mouse: false, touch: false, gamepad: false },
        disableContextMenu: true,
        banner: false,
        render: { powerPreference: 'default' },
        scene: [new WorldScene(source, viewport, quality, params.has('fps'))],
    });
    viewport.attach(game);
    return { game, viewport, quality };
}
