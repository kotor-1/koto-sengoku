/**
 * 押すボタンの決まり（proto3d/src/ui/dom.ts の onPress）。偽の部品・偽のイベントで、1 回の押しで 1 回だけ反応することを確かめる。
 * - マウス：pointerdown で反応し、続く click（detail 1）は無視する。
 * - タッチ：pointerdown を preventDefault するとマウスの互換イベントが出ず、続く click の detail が 0 になる（Chrome。e2e で見た）。
 *   その click は pointerType 'touch' なので無視する（前は detail だけを見ていて 2 回反応し、演出の「一時停止」がすぐ戻り、「次の場面」が 2 つ進んだ）。
 * - キーボード（Enter／Space）：pointerdown は無く、click は detail 0・pointerType ''。反応する。
 * - pointerType の無い click（PointerEvent でないブラウザ）：直前の pointerdown の続きなら無視、離れていれば反応する。
 */
import { describe, expect, it } from 'vitest';
import { PRESS_CLICK_PAIR_MS, onPress } from '../proto3d/src/ui/dom';

type Fake = { pointerType?: string; button?: number; detail?: number; timeStamp: number };

function setup() {
    const ls: Record<string, (e: Event) => void> = {};
    const target = { addEventListener: (type: string, fn: (e: Event) => void) => void (ls[type] = fn) } as unknown as Pick<HTMLElement, 'addEventListener'>;
    let n = 0;
    onPress(target, () => n++);
    const fire = (type: 'pointerdown' | 'click', e: Fake) => ls[type]!({ ...e, preventDefault() {}, stopPropagation() {} } as unknown as Event);
    return { fire, count: () => n };
}

describe('onPress（1 回の押しで 1 回だけ）', () => {
    it('マウス：pointerdown で反応し、click（detail 1）は無視', () => {
        const p = setup();
        p.fire('pointerdown', { pointerType: 'mouse', button: 0, timeStamp: 100 });
        p.fire('click', { pointerType: 'mouse', detail: 1, timeStamp: 180 });
        expect(p.count()).toBe(1);
    });
    it('マウスの右ボタンでは反応しない', () => {
        const p = setup();
        p.fire('pointerdown', { pointerType: 'mouse', button: 2, timeStamp: 100 });
        expect(p.count()).toBe(0);
    });
    it('タッチ：pointerdown で反応し、続く click（detail 0・pointerType touch）は無視（2 回にしない）', () => {
        const p = setup();
        p.fire('pointerdown', { pointerType: 'touch', button: 0, timeStamp: 100 });
        p.fire('click', { pointerType: 'touch', detail: 0, timeStamp: 160 });
        expect(p.count()).toBe(1);
        // 2 回目のタップも 1 回
        p.fire('pointerdown', { pointerType: 'touch', button: 0, timeStamp: 900 });
        p.fire('click', { pointerType: 'touch', detail: 0, timeStamp: 960 });
        expect(p.count()).toBe(2);
    });
    it('キーボード（Enter／Space）の click（detail 0・pointerType 空）で反応する', () => {
        const p = setup();
        p.fire('click', { pointerType: '', detail: 0, timeStamp: 100 });
        p.fire('click', { pointerType: '', detail: 0, timeStamp: 300 });
        expect(p.count()).toBe(2);
        // タッチで押した直後でも、キーボードの押しは別の押し
        p.fire('pointerdown', { pointerType: 'touch', button: 0, timeStamp: 1000 });
        p.fire('click', { pointerType: '', detail: 0, timeStamp: 1100 });
        expect(p.count()).toBe(4);
    });
    it('pointerType の無い click：直前の pointerdown の続きは無視、離れていれば反応', () => {
        const p = setup();
        p.fire('pointerdown', { pointerType: 'touch', button: 0, timeStamp: 100 });
        p.fire('click', { detail: 0, timeStamp: 150 });
        expect(p.count()).toBe(1);
        p.fire('click', { detail: 0, timeStamp: 100 + PRESS_CLICK_PAIR_MS + 1 });
        expect(p.count()).toBe(2);
        // pointerdown が一度も無ければ反応する
        const q = setup();
        q.fire('click', { detail: 0, timeStamp: 50 });
        expect(q.count()).toBe(1);
    });
});
