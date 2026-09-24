import { App } from './app';
import { createGame } from './render/createGame';
import { setupCheckInfo } from './ui/checkInfo';

function start(): void {
    try {
        const app = new App();
        const { game, viewport, quality } = createGame('game-container', app);
        setupCheckInfo(quality);
        // 開発時のみ：ブラウザのコンソールや自動テストから状態を見られるようにする
        if (import.meta.env.DEV) Object.assign(window, { __koto: { app, game, viewport, quality } });
    } catch (e) {
        const el = document.getElementById('boot-error');
        if (el) {
            el.hidden = false;
            el.textContent = `起動できませんでした：${e instanceof Error ? e.message : String(e)}`;
        }
        throw e;
    }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
