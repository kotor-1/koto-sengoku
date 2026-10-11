/**
 * 画面の部品を作る小道具（DOM）。
 */
import { SCROLL_SETTLE_MS, TapTracker } from './guard';
import type { PressPlace } from './guard';

/** 要素を作る（class・文字） */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

/** 押し始め（pointerdown）の後、この時間までに来た、ポインターの種類の分からない click は同じ押しの続きとみなす（ミリ秒） */
export const PRESS_CLICK_PAIR_MS = 2000;

/** onPress が受け取るイベントの形（テストで偽のイベントを渡せるように、使う所だけ） */
type PressEvent = Pick<Event, 'timeStamp' | 'preventDefault' | 'stopPropagation'> & { pointerType?: string; button?: number; detail?: number; pointerId?: number; clientX?: number; clientY?: number };

type Listenable = Pick<EventTarget, 'addEventListener'> | null | undefined;

/** 出来事の数を数え始める（返り：今までの数を返す関数）。画面の向き・窓の大きさの変化を数えるのに使う */
export function countEvents(sources: readonly (readonly [Listenable, readonly string[]])[]): () => number {
    let n = 0;
    const bump = () => void n++;
    for (const [src, types] of sources) for (const t of types) src?.addEventListener(t, bump, { passive: true });
    return () => n;
}

let screenCount: (() => number) | null = null;

/**
 * 画面の向き・窓の大きさ・見える所（visualViewport）が変わった回数（Version 26。初めて呼んだ時から数える。窓の無い所では 0）。
 * 窓の resize・orientationchange・screen.orientation の change・visualViewport の resize のどれか。
 * onPress の離した時に決める押しは、押し始めと離した時でこの数が違えば決めない（押している間に画面を回した）。
 */
export function screenChanges(): number {
    if (!screenCount) {
        if (typeof window === 'undefined') return 0;
        screenCount = countEvents([
            [window, ['resize', 'orientationchange']],
            [typeof screen !== 'undefined' ? screen.orientation : null, ['change']],
            [typeof visualViewport !== 'undefined' ? visualViewport : null, ['resize']],
        ]);
    }
    return screenCount();
}

/** onPress の続き：縦に動かせる並びの中のボタン（会話・軍議の選択肢。ui/choiceFit.ts） */
export interface PressOptions {
    /** true の間は「たたき」で決める（押した瞬間でなく、離した時。ui/guard.ts の TapTracker）。並びが動かせる間だけ true にする */
    tapWhen?: () => boolean;
    /** 押している間に並びが動いたかを見る（並びの scrollTop） */
    scrollOf?: () => number;
    /** 並びが最後に動いた時刻（イベントの timeStamp と同じ時計）。動いている途中・止まった直後の押しは、並びを止める押しとしてたたきにしない */
    scrolledAt?: () => number;
    /**
     * 並びの並べ方の通し番号（Version 26。収め直しで並びの形が変わると増える：ui/choiceFit.ts の ChoiceFit.layouts）。
     * 押し始めと離した時で違えば決めない（画面の向き・窓・見える所の変化は、これとは別に onPress がいつも見る：screenChanges）
     */
    layoutOf?: () => number;
}

/**
 * 押したとき（pointerdown）に反応するボタン。2D 版の決まり（docs/design-policy.md §2）と同じ：
 * - スティックを押さえたまま別の指で押すと click が起きないブラウザがあるので、押した瞬間に反応する。
 * - 押した直後の click は無視する（押した結果、同じ場所に出た別のボタンまで押されないように）。
 * - キーボード（Tab で選んで Enter／Space）の click（detail 0）でも反応する。
 * - タッチで押すと、pointerdown を preventDefault しているのでマウスの互換イベントが出ず、続く click の detail が 0 になる（Chrome）。
 *   detail だけを見ると 1 回のタップで 2 回反応する（一時停止がすぐ戻る・次の場面が 2 つ進む）ので、click がポインターから来たもの
 *   （pointerType が 'touch'／'pen'／'mouse'）なら pointerdown で済んでいるとして無視する。pointerType の無い click（PointerEvent でない
 *   ブラウザ）は、直前の pointerdown から PRESS_CLICK_PAIR_MS 以内なら同じ押しの続きとして無視する。
 * - opts.tapWhen が true の間（縦に動かせる並びの中）は、押した瞬間には決めず、離した時（pointerup）に、押し始めから TAP_SLOP_PX より
 *   動かず・並びも動かず・pointercancel も無かったときだけ反応する（なぞって並びを動かした指で選ばない）。fn の 2 つ目に押し始めの
 *   pointerdown を渡す（見張りは押し始めの時刻で見る：ui/guard.ts の InputGate.tap）。押している間の動き・離すのは、押したボタンに集める（setPointerCapture）。
 * - Version 26：その離した時に決める押しは、押している間に画面の向き・窓・見える所の大きさが変わった（screenChanges）・並びを収め直した
 *   （opts.layoutOf）・押したボタンの四角が動いた（PRESS_SHIFT_PX より）ときも決めない（回転の後に離した指で選ばない）。改めて押せば
 *   いつもどおり決まる。押した瞬間に決める並び（動かない並び）・キーボードは Version 24 のまま。
 */
export function onPress(target: Pick<HTMLElement, 'addEventListener'> & Partial<Pick<HTMLElement, 'setPointerCapture' | 'getBoundingClientRect'>>, fn: (e: Event, tapStart?: Event) => void, opts: PressOptions = {}): void {
    let downAt = Number.NEGATIVE_INFINITY;
    const tap = opts.tapWhen ? new TapTracker() : null;
    let tapStart: Event | null = null;
    const pos = (e: PressEvent) => [e.pointerId ?? 0, e.clientX ?? 0, e.clientY ?? 0] as const;
    // 押したボタンの所：画面の変化の数＋並びの並べ方の番号と、ボタンの四角（押し始めと離した時で比べる）
    const place = (): PressPlace => ({ layout: screenChanges() + (opts.layoutOf?.() ?? 0), rect: target.getBoundingClientRect?.() ?? null });
    target.addEventListener('pointerdown', (ev) => {
        const e = ev as unknown as PressEvent;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        downAt = e.timeStamp;
        if (tap && opts.tapWhen?.()) {
            const [id, x, y] = pos(e);
            tap.down(id, x, y, opts.scrollOf?.() ?? 0, !(e.timeStamp - (opts.scrolledAt?.() ?? Number.NEGATIVE_INFINITY) < SCROLL_SETTLE_MS), place());
            tapStart = tap.active ? ev : null;
            try {
                if (tap.active && e.pointerId !== undefined) target.setPointerCapture?.(e.pointerId);
            } catch {
                // 取れなくても、指の押しはブラウザが押したボタンに集める
            }
            return;
        }
        tap?.cancel();
        fn(ev);
    });
    if (tap) {
        target.addEventListener('pointermove', (ev) => {
            const [id, x, y] = pos(ev as unknown as PressEvent);
            tap.move(id, x, y);
        });
        target.addEventListener('pointercancel', (ev) => tap.cancel((ev as unknown as PressEvent).pointerId ?? 0));
        target.addEventListener('pointerup', (ev) => {
            const e = ev as unknown as PressEvent;
            const [id, x, y] = pos(e);
            const start = tapStart;
            if (!tap.up(id, x, y, opts.scrollOf?.() ?? 0, place()) || !start) return;
            tapStart = null;
            e.stopPropagation();
            fn(ev, start);
        });
    }
    target.addEventListener('click', (ev) => {
        const e = ev as unknown as PressEvent;
        e.preventDefault();
        e.stopPropagation();
        if (e.detail !== 0) return;
        const pt = e.pointerType;
        if (pt) return;
        if (pt === undefined && e.timeStamp - downAt >= 0 && e.timeStamp - downAt < PRESS_CLICK_PAIR_MS) return;
        fn(ev);
    });
}

/** 押した直後の入力を無視するための時計（連打で、次に出た選択肢まで選ばれないように） */
export function nowMs(): number {
    return performance.now();
}
