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
import { SCROLL_SETTLE_MS, TAP_SLOP_PX } from '../proto3d/src/ui/guard';

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

type PFake = { pointerType?: string; button?: number; detail?: number; timeStamp: number; pointerId?: number; clientX?: number; clientY?: number };

/** 動かせる並びの中のボタン（opts.tapWhen）。scroll：並びの scrollTop、scrolledAt：並びが最後に動いた時刻 */
function setupTap(scrollable = true) {
    const ls: Record<string, (e: Event) => void> = {};
    const captured: number[] = [];
    const target = {
        addEventListener: (type: string, fn: (e: Event) => void) => void (ls[type] = fn),
        setPointerCapture: (id: number) => void captured.push(id),
    } as unknown as Pick<HTMLElement, 'addEventListener' | 'setPointerCapture'>;
    const st = { scroll: 0, scrolledAt: Number.NEGATIVE_INFINITY, scrollable };
    const calls: { type: string; start: number | null }[] = [];
    onPress(target, (e, start) => calls.push({ type: e.type ?? '', start: start ? start.timeStamp : null }), {
        tapWhen: () => st.scrollable,
        scrollOf: () => st.scroll,
        scrolledAt: () => st.scrolledAt,
    });
    const stopped: string[] = [];
    const fire = (type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'click', e: PFake) =>
        ls[type]!({ type, pointerId: 1, clientX: 50, clientY: 50, ...e, preventDefault() {}, stopPropagation() { stopped.push(type); } } as unknown as Event);
    return { fire, calls, st, captured, stopped };
}

describe('onPress（動かせる並びの中：離した時に、たたきだけで反応）', () => {
    it('指でたたく：押した瞬間には反応せず、離した時に 1 回だけ（押し始めのイベントを渡す）。続く click は無視', () => {
        const p = setupTap();
        p.fire('pointerdown', { pointerType: 'touch', button: 0, timeStamp: 100 });
        expect(p.calls.length).toBe(0);
        expect(p.captured).toEqual([1]);
        p.fire('pointerup', { pointerType: 'touch', button: 0, timeStamp: 180, clientX: 52, clientY: 53 });
        expect(p.calls).toEqual([{ type: 'pointerup', start: 100 }]);
        p.fire('click', { pointerType: 'touch', detail: 0, timeStamp: 190 });
        expect(p.calls.length).toBe(1);
        // 層の「どこを押しても進む」へは伝えない
        expect(p.stopped).toContain('pointerdown');
        expect(p.stopped).toContain('pointerup');
    });
    it('縦になぞった指（並びを動かした）では反応しない', () => {
        const p = setupTap();
        p.fire('pointerdown', { pointerType: 'touch', button: 0, timeStamp: 100 });
        p.fire('pointermove', { timeStamp: 110, clientY: 50 - TAP_SLOP_PX - 2 });
        p.st.scroll = 80;
        p.fire('pointerup', { pointerType: 'touch', timeStamp: 300, clientY: 50 - TAP_SLOP_PX - 2 });
        expect(p.calls.length).toBe(0);
    });
    it('ブラウザが並びを動かし始めた（pointercancel）押しでは反応しない', () => {
        const p = setupTap();
        p.fire('pointerdown', { pointerType: 'touch', button: 0, timeStamp: 100 });
        p.fire('pointercancel', { timeStamp: 120 });
        p.fire('pointerup', { pointerType: 'touch', timeStamp: 300 });
        expect(p.calls.length).toBe(0);
    });
    it('動いている並びを止めた押し（並びが動いて SCROLL_SETTLE_MS のうち）では反応しない。止まってからのたたきは反応する', () => {
        const p = setupTap();
        p.st.scrolledAt = 90;
        p.fire('pointerdown', { pointerType: 'touch', button: 0, timeStamp: 100 });
        p.fire('pointerup', { pointerType: 'touch', timeStamp: 160 });
        expect(p.calls.length).toBe(0);
        p.fire('pointerdown', { pointerType: 'touch', button: 0, timeStamp: 90 + SCROLL_SETTLE_MS });
        p.fire('pointerup', { pointerType: 'touch', timeStamp: 90 + SCROLL_SETTLE_MS + 60 });
        expect(p.calls.length).toBe(1);
    });
    it('マウス：離した時にクリックとして反応。右ボタンでは反応しない', () => {
        const p = setupTap();
        p.fire('pointerdown', { pointerType: 'mouse', button: 2, timeStamp: 100 });
        p.fire('pointerup', { pointerType: 'mouse', button: 2, timeStamp: 150 });
        expect(p.calls.length).toBe(0);
        p.fire('pointerdown', { pointerType: 'mouse', button: 0, timeStamp: 200 });
        p.fire('pointerup', { pointerType: 'mouse', button: 0, timeStamp: 260 });
        p.fire('click', { pointerType: 'mouse', detail: 1, timeStamp: 262 });
        expect(p.calls.map((c) => c.type)).toEqual(['pointerup']);
    });
    it('並びが動かない間（tapWhen が false）は、今までどおり押した瞬間に反応する', () => {
        const p = setupTap(false);
        p.fire('pointerdown', { pointerType: 'touch', button: 0, timeStamp: 100 });
        expect(p.calls).toEqual([{ type: 'pointerdown', start: null }]);
        p.fire('pointerup', { pointerType: 'touch', timeStamp: 150 });
        expect(p.calls.length).toBe(1);
    });
    it('キーボードの click（detail 0・pointerType 空）は、動かせる並びでも反応する', () => {
        const p = setupTap();
        p.fire('click', { pointerType: '', detail: 0, timeStamp: 100 });
        expect(p.calls).toEqual([{ type: 'click', start: null }]);
    });
});
