/**
 * Canvas の大きさと解像度の管理。
 * - 表示サイズ（CSS px）は画面いっぱい。
 * - 実際の描画解像度は renderScale 倍（高精細画面でも最大 2 倍まで。重ければ下げる）。
 * Phaser の RESIZE モードは CSS px 等倍でしか描かないため、NONE モードで自前で合わせる。
 */
import type { Game } from 'phaser';

export class Viewport {
    cssWidth = 1;
    cssHeight = 1;
    private game: Game | null = null;
    private listeners: (() => void)[] = [];
    private pending = 0;

    constructor(
        private readonly container: HTMLElement,
        public renderScale: number,
    ) {
        this.measure();
        const later = () => {
            window.cancelAnimationFrame(this.pending);
            this.pending = window.requestAnimationFrame(() => this.apply());
        };
        window.addEventListener('resize', later);
        window.addEventListener('orientationchange', () => setTimeout(later, 60));
        window.visualViewport?.addEventListener('resize', later);
    }

    get pixelWidth(): number {
        return Math.max(1, Math.round(this.cssWidth * this.renderScale));
    }

    get pixelHeight(): number {
        return Math.max(1, Math.round(this.cssHeight * this.renderScale));
    }

    attach(game: Game): void {
        this.game = game;
        this.apply();
    }

    onChange(fn: () => void): void {
        this.listeners.push(fn);
    }

    setRenderScale(s: number): void {
        if (Math.abs(s - this.renderScale) < 0.01) return;
        this.renderScale = s;
        this.apply();
    }

    apply(): void {
        this.measure();
        const g = this.game;
        if (g) {
            g.scale.resize(this.pixelWidth, this.pixelHeight);
            const style = g.canvas.style;
            style.width = `${this.cssWidth}px`;
            style.height = `${this.cssHeight}px`;
        }
        for (const fn of this.listeners) fn();
    }

    private measure(): void {
        const r = this.container.getBoundingClientRect();
        this.cssWidth = Math.max(1, Math.round(r.width));
        this.cssHeight = Math.max(1, Math.round(r.height));
    }
}
