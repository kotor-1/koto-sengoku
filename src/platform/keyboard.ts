/**
 * Mac などのキーボード操作。
 *   移動：矢印キー / WASD　　話す・次へ：Space / Enter / Z　　メニュー：Esc
 */
import type { Direction, InputState } from '../core/input';

const DIR_KEYS: Record<string, Direction> = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
};
const ACTION_KEYS = new Set(['Space', 'Enter', 'NumpadEnter', 'KeyZ']);

export interface KeyboardHooks {
    /** 探索中（メニューやタイトルが開いていない）か */
    isGameplayActive(): boolean;
    onMenuKey(): void;
}

export function bindKeyboard(input: InputState, hooks: KeyboardHooks): () => void {
    const onDown = (e: KeyboardEvent) => {
        if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.code === 'Escape') {
            e.preventDefault();
            if (!e.repeat) hooks.onMenuKey();
            return;
        }
        if (!hooks.isGameplayActive()) return;
        const dir = DIR_KEYS[e.code];
        if (dir) {
            e.preventDefault(); // 矢印キーでページが動かないように
            input.setDirection(dir, true);
            return;
        }
        if (ACTION_KEYS.has(e.code)) {
            e.preventDefault(); // フォーカス中のボタンが押されないように
            if (!e.repeat) input.pressAction();
        }
    };
    const onUp = (e: KeyboardEvent) => {
        const dir = DIR_KEYS[e.code];
        // 離したキーは状態にかかわらず必ず解除する
        if (dir) input.setDirection(dir, false);
        // Cmd を押しながらのキーは keyup が来ないことがあるので、Cmd を離したら全解除
        if (e.key === 'Meta') input.releaseAll();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
        window.removeEventListener('keydown', onDown);
        window.removeEventListener('keyup', onUp);
    };
}
