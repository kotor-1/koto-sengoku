/**
 * 動かせる並びの中の押し（離した時に決める。proto3d/src/ui/dom.ts の onPress）を、押している間の画面の変化で取り消す（Version 26）：
 * 窓の大きさ（resize）・向き（orientationchange・screen.orientation の change）・見える所（visualViewport の resize）のどれが来ても、
 * 離した時に決めない。改めて押せば決まる。並べ方が変わらなければ今までどおり。
 * Node には窓が無いので、EventTarget で偽の window・screen.orientation・visualViewport を置く（数え始めは最初の押しの時。
 * このファイルだけの偽物：テストのファイルごとに部品を読み直すので、ほかのテストには残らない）。
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { onPress, screenChanges } from '../proto3d/src/ui/dom';

const win = new EventTarget();
const orientation = new EventTarget();
const vv = new EventTarget();

beforeAll(() => {
    vi.stubGlobal('window', win);
    vi.stubGlobal('screen', { orientation });
    vi.stubGlobal('visualViewport', vv);
});

type PFake = { pointerType?: string; button?: number; detail?: number; timeStamp: number };

function setup() {
    const ls: Record<string, (e: Event) => void> = {};
    const target = { addEventListener: (type: string, fn: (e: Event) => void) => void (ls[type] = fn) } as unknown as Pick<HTMLElement, 'addEventListener'>;
    const calls: number[] = [];
    onPress(target, (e) => calls.push(e.timeStamp), { tapWhen: () => true, scrollOf: () => 0, scrolledAt: () => Number.NEGATIVE_INFINITY });
    const fire = (type: 'pointerdown' | 'pointerup', e: PFake) => ls[type]!({ type, pointerId: 1, clientX: 40, clientY: 40, ...e, preventDefault() {}, stopPropagation() {} } as unknown as Event);
    return { fire, calls };
}

describe('screenChanges（画面の向き・窓・見える所の変化の数）', () => {
    it('窓の resize・orientationchange・screen.orientation の change・visualViewport の resize で増える', () => {
        const n0 = screenChanges();
        win.dispatchEvent(new Event('resize'));
        expect(screenChanges()).toBe(n0 + 1);
        win.dispatchEvent(new Event('orientationchange'));
        orientation.dispatchEvent(new Event('change'));
        vv.dispatchEvent(new Event('resize'));
        expect(screenChanges()).toBe(n0 + 4);
        // 関係の無い出来事では増えない
        win.dispatchEvent(new Event('scroll'));
        vv.dispatchEvent(new Event('scroll'));
        expect(screenChanges()).toBe(n0 + 4);
    });
});

describe('onPress：押している間に画面が変わったら、離しても決めない', () => {
    for (const [what, src, type] of [
        ['窓の大きさが変わった（resize）', win, 'resize'],
        ['向きが変わった（orientationchange）', win, 'orientationchange'],
        ['向きが変わった（screen.orientation の change）', orientation, 'change'],
        ['見える所の大きさが変わった（visualViewport の resize）', vv, 'resize'],
    ] as const) {
        it(`${what}：離しても反応せず、改めて押せば反応する`, () => {
            const p = setup();
            p.fire('pointerdown', { pointerType: 'touch', button: 0, timeStamp: 100 });
            src.dispatchEvent(new Event(type));
            p.fire('pointerup', { pointerType: 'touch', timeStamp: 900 });
            expect(p.calls).toEqual([]);
            p.fire('pointerdown', { pointerType: 'touch', button: 0, timeStamp: 1400 });
            p.fire('pointerup', { pointerType: 'touch', timeStamp: 1460 });
            expect(p.calls).toEqual([1460]);
        });
    }
    it('何も変わらなければ今までどおり離した時に反応する', () => {
        const p = setup();
        p.fire('pointerdown', { pointerType: 'touch', button: 0, timeStamp: 100 });
        p.fire('pointerup', { pointerType: 'touch', timeStamp: 2600 });
        expect(p.calls).toEqual([2600]);
    });
    it('押す前の変化では取り消さない（押し始めからの変化だけを見る）', () => {
        const p = setup();
        win.dispatchEvent(new Event('resize'));
        p.fire('pointerdown', { pointerType: 'touch', button: 0, timeStamp: 100 });
        p.fire('pointerup', { pointerType: 'touch', timeStamp: 180 });
        expect(p.calls).toEqual([180]);
    });
});
