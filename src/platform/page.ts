/**
 * ページ全体の振る舞い：スクロール・拡大の抑止、横画面の案内、
 * 画面切り替え時の入力解除、切り欠き（セーフエリア）の取得。
 */

/** ゲーム画面でのスクロール・ピンチ拡大・ダブルタップ拡大・長押しメニューを止める */
export function preventPageGestures(): void {
    const opts: AddEventListenerOptions = { passive: false };
    document.addEventListener(
        'touchmove',
        (e) => {
            const t = e.target as Element | null;
            if (t?.closest?.('.allow-scroll')) return;
            e.preventDefault();
        },
        opts,
    );
    // iOS Safari のピンチ操作
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
        document.addEventListener(type, (e) => e.preventDefault(), opts);
    }
    document.addEventListener('dblclick', (e) => e.preventDefault(), opts);
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    // 何らかの理由でずれたスクロールを戻す
    window.addEventListener('scroll', () => {
        if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    });
}

/**
 * 入力を解除すべき出来事（アプリ切り替え・タブ切り替え・画面回転・ページ離脱）を監視する。
 */
export function onInputInterrupt(release: () => void): void {
    window.addEventListener('blur', release);
    window.addEventListener('pagehide', release);
    window.addEventListener('pageshow', release);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') release();
    });
    window.addEventListener('orientationchange', release);
    screen.orientation?.addEventListener?.('change', release);
}

/** タッチ操作の端末か（iPad の「デスクトップ用サイト」表示も含む） */
export function isTouchDevice(): boolean {
    return (
        (typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches) ||
        (navigator.maxTouchPoints ?? 0) > 0
    );
}

/**
 * 縦画面かどうかを監視する。タッチ端末で縦画面なら「横向きに」の案内を出す。
 * コールバックには「縦画面のため操作を止めるべきか」を渡す。
 */
export function watchOrientation(isTouch: () => boolean, onChange: (blocked: boolean) => void): () => boolean {
    let blocked = false;
    const check = () => {
        const portrait = window.innerHeight > window.innerWidth;
        const next = portrait && isTouch();
        document.body.classList.toggle('is-portrait', next);
        if (next !== blocked) {
            blocked = next;
            onChange(blocked);
        }
    };
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', () => setTimeout(check, 50));
    matchMedia('(orientation: portrait)').addEventListener?.('change', check);
    window.visualViewport?.addEventListener('resize', check);
    check();
    return () => blocked;
}

export interface SafeInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/** CSS の env(safe-area-inset-*) を px で読む */
export function readSafeInsets(): SafeInsets {
    const probe = document.getElementById('safe-probe');
    if (!probe) return { top: 0, right: 0, bottom: 0, left: 0 };
    const cs = getComputedStyle(probe);
    const px = (v: string) => parseFloat(v) || 0;
    return { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
}
