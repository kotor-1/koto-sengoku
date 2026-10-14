/**
 * 演出の再生器（ui/cinePlayer.ts）の「次の場面」（→ キー・ボタン）：最後の場面では、スキップと同じに終わりの画を描かずに終える
 * （Version 28 §4.3：町の急報は 3D の場面 1 つ。終わりの画を描くと、探索の側（explore/world.ts）は最後まで見たとして、急報の人を止まる所へ
 * 飛ばしてから置き場所へ歩かせ、その間「話す」を出さなかった。スキップは置き場所に置く）。途中の場面では今までどおり次の場面の頭へ。
 * 画面は偽の DOM（描かない）。時計は requestAnimationFrame を止めて、押した時だけ進める。
 */
import { describe, expect, it } from 'vitest';
import { newIeyasuGame } from '../proto3d/src/campaign/ieyasu1570/flow';
import { ieyasuCinematic } from '../proto3d/src/campaign/ieyasu1570/story/cinematics';
import { afterWalkEnd } from '../proto3d/src/explore/stage';
import type { CineSpec, StageEvent } from '../proto3d/src/story/types';
import type { Modal } from '../proto3d/src/ui/modal';

function fakeElement(tag = 'div'): Record<string, unknown> {
    const children: unknown[] = [];
    const classes = new Set<string>();
    const attrs = new Map<string, string>();
    return {
        tagName: tag.toUpperCase(),
        id: '',
        className: '',
        textContent: '',
        hidden: false,
        disabled: false,
        dataset: {},
        style: {},
        children,
        clientWidth: 800,
        clientHeight: 400,
        classList: {
            add: (...c: string[]) => c.forEach((x) => classes.add(x)),
            remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
            toggle: (c: string, on?: boolean) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
            contains: (c: string) => classes.has(c),
        },
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        getAttribute: (k: string) => attrs.get(k) ?? null,
        appendChild: (c: unknown) => children.push(c),
        append: (...c: unknown[]) => children.push(...c),
        replaceChildren: (...c: unknown[]) => children.splice(0, children.length, ...c),
        remove: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    };
}

async function play(spec: CineSpec) {
    const g = globalThis as Record<string, unknown>;
    g.document ??= { createElement: (t: string) => fakeElement(t), body: fakeElement('body'), addEventListener: () => undefined, removeEventListener: () => undefined, visibilityState: 'visible' };
    g.window ??= { addEventListener: () => undefined, removeEventListener: () => undefined };
    // 時計は押した時だけ進める（自動では進めない）
    g.requestAnimationFrame = () => 1;
    g.cancelAnimationFrame = () => undefined;
    const { playCinematic } = await import('../proto3d/src/ui/cinePlayer');
    const { HeldKeys } = await import('../proto3d/src/ui/guard');
    let modal: Modal | null = null;
    const calls: { ev: StageEvent | null; t: number }[] = [];
    const host = {
        keys: new HeldKeys(),
        openLayer: () => fakeElement() as unknown as HTMLElement,
        pushModal: (m: Modal) => {
            modal = m;
        },
        closeModal: (m: Modal) => m.dispose?.(),
        refreshCover: () => undefined,
        buttonRowFor: () => {
            throw new Error('使わない');
        },
    };
    const done = playCinematic(host as never, spec, { reduced: false, onStage: (ev, t) => calls.push({ ev, t }) });
    return { done, calls, modal: () => modal! };
}

describe('演出の「次の場面」：最後の場面ではスキップと同じ（終わりの画を描かない）', () => {
    it('町の急報（3D の場面 1 つ）：途中で「次の場面」→ スキップで終わり、場面の終わりの時刻の出来事を置かない（探索の側は後の歩きを始めない）', async () => {
        const spec = ieyasuCinematic(newIeyasuGame(), 'ch1_report')!;
        const ev = (spec.beats[0] as { event: StageEvent }).event;
        const end = afterWalkEnd(ev)!;
        expect(end).toBe(spec.duration);
        const { done, calls, modal } = await play(spec);
        expect(calls.length).toBeGreaterThan(0);
        expect(modal().press!('next')).toBe(true);
        await expect(done).resolves.toBe('skipped');
        // 置いた出来事の時刻は、どれも後の歩きを始める時刻（終わり − 0.05 秒）より前。最後は片付け（null）
        const placed = calls.filter((c) => c.ev);
        expect(placed.length).toBeGreaterThan(0);
        for (const c of placed) expect(c.t).toBeLessThan(end - 0.05);
        expect(calls[calls.length - 1]!.ev).toBeNull();
    });

    it('場面が 2 つ以上：途中の場面の「次の場面」は次の場面の頭へ（終えない）。最後の場面でもう一度押すとスキップと同じに終わる', async () => {
        const a: StageEvent = { id: 'town_life', hero: true };
        const b: StageEvent = { id: 'town_life', hero: false };
        const spec: CineSpec = {
            id: 'test.two',
            moment: 'ch1_open',
            title: '確かめ',
            duration: 4,
            beats: [
                { kind: 'stage', start: 0, end: 2, event: a },
                { kind: 'stage', start: 2, end: 4, event: b },
            ],
            captions: [{ start: 0, end: 4, text: '確かめの字幕。' }],
            info: {},
        };
        const { done, calls, modal } = await play(spec);
        let settled = false;
        void done.then(() => (settled = true));
        modal().press!('next');
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(modal().probe().beat).toBe(1);
        expect(calls.some((c) => c.ev && JSON.stringify(c.ev) === JSON.stringify(b) && c.t === 0)).toBe(true);
        modal().press!('next');
        await expect(done).resolves.toBe('skipped');
        for (const c of calls.filter((x) => x.ev)) expect(c.t).toBeLessThan(2);
        expect(calls[calls.length - 1]!.ev).toBeNull();
    });
});
