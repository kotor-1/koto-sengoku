/**
 * 画面の部品を作る小道具（DOM）。
 */
import { SCROLL_SETTLE_MS, TapTracker } from './guard';

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

/** onPress の続き：縦に動かせる並びの中のボタン（会話・軍議の選択肢。ui/choiceFit.ts） */
export interface PressOptions {
    /** true の間は「たたき」で決める（押した瞬間でなく、離した時。ui/guard.ts の TapTracker）。並びが動かせる間だけ true にする */
    tapWhen?: () => boolean;
    /** 押している間に並びが動いたかを見る（並びの scrollTop） */
    scrollOf?: () => number;
    /** 並びが最後に動いた時刻（イベントの timeStamp と同じ時計）。動いている途中・止まった直後の押しは、並びを止める押しとしてたたきにしない */
    scrolledAt?: () => number;
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
 */
export function onPress(target: Pick<HTMLElement, 'addEventListener'> & Partial<Pick<HTMLElement, 'setPointerCapture'>>, fn: (e: Event, tapStart?: Event) => void, opts: PressOptions = {}): void {
    let downAt = Number.NEGATIVE_INFINITY;
    const tap = opts.tapWhen ? new TapTracker() : null;
    let tapStart: Event | null = null;
    const pos = (e: PressEvent) => [e.pointerId ?? 0, e.clientX ?? 0, e.clientY ?? 0] as const;
    target.addEventListener('pointerdown', (ev) => {
        const e = ev as unknown as PressEvent;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        downAt = e.timeStamp;
        if (tap && opts.tapWhen?.()) {
            const [id, x, y] = pos(e);
            tap.down(id, x, y, opts.scrollOf?.() ?? 0, !(e.timeStamp - (opts.scrolledAt?.() ?? Number.NEGATIVE_INFINITY) < SCROLL_SETTLE_MS));
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
            if (!tap.up(id, x, y, opts.scrollOf?.() ?? 0) || !start) return;
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
