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

/**
 * 押したとき（pointerdown）に反応するボタン。2D 版の決まり（docs/design-policy.md §2）と同じ：
 * - スティックを押さえたまま別の指で押すと click が起きないブラウザがあるので、押した瞬間に反応する。
 * - 押した直後の click は無視する（押した結果、同じ場所に出た別のボタンまで押されないように）。
 * - キーボード（Tab で選んで Enter／Space）の click（detail 0）でも反応する。
 */
export function onPress(target: HTMLElement, fn: (e: Event) => void): void {
    target.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        fn(e);
    });
    target.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.detail === 0) fn(e);
    });
}

/** 押した直後の入力を無視するための時計（連打で、次に出た選択肢まで選ばれないように） */
export function nowMs(): number {
    return performance.now();
}
