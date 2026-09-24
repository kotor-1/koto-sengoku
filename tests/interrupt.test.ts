/**
 * 画面の中断（アプリ切り替え・タブ非表示・ページ離脱・画面回転）で移動入力が解除され、
 * 復帰後に「押しっぱなし」が残らないことの確認。ブラウザのイベントを EventTarget で模している。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputState } from '../src/core/input';
import { GameSession } from '../src/core/session';
import { createNewGameState } from '../src/core/state';
import { onInputInterrupt } from '../src/platform/page';

function fakeBrowser() {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const orientation = new EventTarget();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    vi.stubGlobal('screen', { orientation });
    return { win, doc, orientation };
}

afterEach(() => vi.unstubAllGlobals());

function heldInput(): InputState {
    const input = new InputState();
    input.setDirection('right', true);
    input.setStick({ x: 0, y: 1 });
    input.pressAction();
    return input;
}

describe('画面の中断で入力を解除', () => {
    const cases: [string, (b: ReturnType<typeof fakeBrowser>) => void][] = [
        ['ウィンドウのフォーカスが外れた（blur）', (b) => b.win.dispatchEvent(new Event('blur'))],
        ['ページ離脱（pagehide）', (b) => b.win.dispatchEvent(new Event('pagehide'))],
        ['bfcache からの復帰（pageshow）', (b) => b.win.dispatchEvent(new Event('pageshow'))],
        ['タブ・アプリの切り替え（visibilitychange → hidden）', (b) => {
            b.doc.visibilityState = 'hidden';
            b.doc.dispatchEvent(new Event('visibilitychange'));
        }],
        ['画面回転（orientationchange）', (b) => b.win.dispatchEvent(new Event('orientationchange'))],
        ['画面回転（screen.orientation change）', (b) => b.orientation.dispatchEvent(new Event('change'))],
    ];

    for (const [name, fire] of cases) {
        it(name, () => {
            const b = fakeBrowser();
            const input = heldInput();
            onInputInterrupt(() => input.releaseAll());
            fire(b);
            expect(input.hasMovement()).toBe(false);
            expect(input.poll()).toEqual({ moveX: 0, moveY: 0, action: false });
        });
    }

    it('visible に戻っただけでは何も起きない（解除は隠れた時点）', () => {
        const b = fakeBrowser();
        const release = vi.fn();
        onInputInterrupt(release);
        b.doc.visibilityState = 'visible';
        b.doc.dispatchEvent(new Event('visibilitychange'));
        expect(release).not.toHaveBeenCalled();
    });

    it('中断→復帰のあと、低 fps の大きな時間差でも主人公は動かない', () => {
        const b = fakeBrowser();
        const input = heldInput();
        onInputInterrupt(() => input.releaseAll());
        const s = new GameSession(createNewGameState());
        s.step(input.poll(), 1 / 60); // 押している間は動く
        const x = s.state.player.x;
        const y = s.state.player.y;
        b.doc.visibilityState = 'hidden';
        b.doc.dispatchEvent(new Event('visibilitychange'));
        b.doc.visibilityState = 'visible';
        b.doc.dispatchEvent(new Event('visibilitychange'));
        // 復帰直後のフレームは経過時間が大きい（低 fps・長い中断）
        for (let i = 0; i < 5; i++) s.step(input.poll(), 2);
        expect(s.state.player.x).toBe(x);
        expect(s.state.player.y).toBe(y);
        expect(s.state.dialogue).toBeNull(); // 中断前に押したボタンで会話が始まらない
    });
});
