import { AUTO, Game, Scale } from 'phaser';
import { Viewport } from './viewport';
import { WorldScene, type WorldSource } from './WorldScene';
import { chooseQuality, initialRenderScale, loadQualityChoice, type QualityProfile } from './world/quality';

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
        manual: loadQualityChoice(),
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
        // Phaser は起動直後とタブ復帰直後の panicMax フレーム（既定 120）の間、1 フレームの時間を 60fps 相当に切り詰める。
        // 30fps の端末では約 4 秒、低 fps ではさらに長くスローモーションになるため無効にする。
        // 大きすぎる経過時間は core 側で 1 フレーム 0.1 秒に抑えている（MAX_STEP_SEC）。
        fps: { panicMax: 0 },
        banner: false,
        render: { powerPreference: 'default', ...(params.has('maxtex') ? { maxTextures: Number(params.get('maxtex')) } : {}) },
        scene: [new WorldScene(source, viewport, quality, params.has('fps'))],
    });
    viewport.attach(game);
    return { game, viewport, quality };
}
