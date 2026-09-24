/**
 * ボタンを「押した瞬間」（pointerdown）に反応させる。
 * - スティックを指で押さえたまま別の指でボタンを押すと、ブラウザによっては click が起きない（2 本指の操作とみなされる）ため。
 * - キーボード（Enter / Space）やスクリーンリーダーで押したときの click にも反応する。
 * - 指で押した直後にブラウザが送る click は無視する。押した結果、同じ場所に別のボタンが出ることがあり
 *   （例：「指揮」を押すと同じ位置に「再開」が出る）、その click で別のボタンまで押されてしまうため。
 * - 押したボタンにフォーカスを残さない（キーボードの Space で押し直されないように）。
 */
let lastPress = -1e9;
const GHOST_CLICK_MS = 700;

export function onPress(el: HTMLElement, fn: (e: Event) => void): void {
    el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        lastPress = performance.now();
        el.blur();
        fn(e);
    });
    el.addEventListener('click', (e) => {
        e.preventDefault();
        // detail === 0：キーボードなど、指やマウス以外で押された click
        if (e.detail !== 0 && performance.now() - lastPress < GHOST_CLICK_MS) return;
        el.blur();
        fn(e);
    });
}
