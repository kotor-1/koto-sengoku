/**
 * 画面の部品を作る小道具（DOM）。
 */

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
type PressEvent = Pick<Event, 'timeStamp' | 'preventDefault' | 'stopPropagation'> & { pointerType?: string; button?: number; detail?: number };

/**
 * 押したとき（pointerdown）に反応するボタン。2D 版の決まり（docs/design-policy.md §2）と同じ：
 * - スティックを押さえたまま別の指で押すと click が起きないブラウザがあるので、押した瞬間に反応する。
 * - 押した直後の click は無視する（押した結果、同じ場所に出た別のボタンまで押されないように）。
 * - キーボード（Tab で選んで Enter／Space）の click（detail 0）でも反応する。
 * - タッチで押すと、pointerdown を preventDefault しているのでマウスの互換イベントが出ず、続く click の detail が 0 になる（Chrome）。
 *   detail だけを見ると 1 回のタップで 2 回反応する（一時停止がすぐ戻る・次の場面が 2 つ進む）ので、click がポインターから来たもの
 *   （pointerType が 'touch'／'pen'／'mouse'）なら pointerdown で済んでいるとして無視する。pointerType の無い click（PointerEvent でない
 *   ブラウザ）は、直前の pointerdown から PRESS_CLICK_PAIR_MS 以内なら同じ押しの続きとして無視する。
 */
export function onPress(target: Pick<HTMLElement, 'addEventListener'>, fn: (e: Event) => void): void {
    let downAt = Number.NEGATIVE_INFINITY;
    target.addEventListener('pointerdown', (ev) => {
        const e = ev as unknown as PressEvent;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        downAt = e.timeStamp;
        fn(ev);
    });
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
