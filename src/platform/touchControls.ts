/**
 * スマホ用の移動スティックと「話す」ボタン（DOM + Pointer Events）。
 *
 * - スティックとボタンは別々の指（pointerId）で同時に操作できる。
 * - スティックは触れた場所を中心にする（左側の広い範囲のどこからでも始められる）。
 * - 指を離す・キャンセル・捕捉が外れたときは必ず移動入力を解除する。
 */
import { STICK_DEADZONE } from '../core/constants';
import type { InputState } from '../core/input';
import { clampToRadius, stickVector } from '../core/joystick';
import { readSafeInsets } from './page';

export interface TouchElements {
    zone: HTMLElement;
    base: HTMLElement;
    knob: HTMLElement;
    action: HTMLElement;
}

export interface TouchHooks {
    canMove(): boolean;
    canAct(): boolean;
}

const RADIUS = 52;

export class TouchControls {
    private stickId: number | null = null;
    private origin = { x: 0, y: 0 };
    private readonly actionIds = new Set<number>();

    constructor(
        private readonly el: TouchElements,
        private readonly input: InputState,
        private readonly hooks: TouchHooks,
    ) {
        const z = el.zone;
        z.addEventListener('pointerdown', this.onStickDown);
        z.addEventListener('pointermove', this.onStickMove);
        z.addEventListener('pointerup', this.onStickEnd);
        z.addEventListener('pointercancel', this.onStickEnd);
        z.addEventListener('lostpointercapture', this.onStickEnd);

        const a = el.action;
        a.addEventListener('pointerdown', this.onActionDown);
        for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
            a.addEventListener(t, this.onActionEnd);
        }
    }

    /** 画面切り替えなどで呼ぶ。スティックとボタンの状態をすべて戻す。 */
    reset(): void {
        if (this.stickId !== null) {
            try {
                this.el.zone.releasePointerCapture(this.stickId);
            } catch {
                /* すでに外れている */
            }
        }
        this.stickId = null;
        this.input.releaseStick();
        this.resetStickVisual();
        this.actionIds.clear();
        this.el.action.classList.remove('pressed');
    }

    private onStickDown = (e: PointerEvent) => {
        e.preventDefault();
        if (this.stickId !== null || !this.hooks.canMove()) return;
        this.stickId = e.pointerId;
        try {
            this.el.zone.setPointerCapture(e.pointerId);
        } catch {
            /* 捕捉できなくても pointerup で解除される */
        }
        // 触れた場所を中心に。ただし切り欠きや画面端でスティックが欠けないよう内側へ寄せる
        const safe = readSafeInsets();
        const minX = safe.left + RADIUS + 8;
        const maxY = window.innerHeight - safe.bottom - RADIUS - 8;
        const minY = safe.top + RADIUS + 8;
        this.origin = {
            x: Math.max(minX, e.clientX),
            y: Math.min(maxY, Math.max(minY, e.clientY)),
        };
        const zr = this.el.zone.getBoundingClientRect();
        const bw = this.el.base.offsetWidth;
        const bh = this.el.base.offsetHeight;
        this.el.base.style.left = '0px';
        this.el.base.style.top = '0px';
        this.el.base.style.bottom = 'auto';
        this.el.base.style.transform = `translate(${this.origin.x - zr.left - bw / 2}px, ${this.origin.y - zr.top - bh / 2}px)`;
        this.el.zone.classList.add('active');
        this.update(e.clientX, e.clientY);
    };

    private onStickMove = (e: PointerEvent) => {
        if (e.pointerId !== this.stickId) return;
        e.preventDefault();
        this.update(e.clientX, e.clientY);
    };

    private onStickEnd = (e: PointerEvent) => {
        if (e.pointerId !== this.stickId) return;
        this.stickId = null;
        this.input.releaseStick();
        this.resetStickVisual();
    };

    /** スティックを定位置（左下）の待機表示に戻す */
    private resetStickVisual(): void {
        this.el.zone.classList.remove('active');
        const b = this.el.base.style;
        b.left = '';
        b.top = '';
        b.bottom = '';
        b.transform = '';
        this.el.knob.style.transform = '';
    }

    private update(cx: number, cy: number): void {
        const dx = cx - this.origin.x;
        const dy = cy - this.origin.y;
        const k = clampToRadius(dx, dy, RADIUS);
        this.el.knob.style.transform = `translate(${k.x}px, ${k.y}px)`;
        if (this.hooks.canMove()) this.input.setStick(stickVector(dx, dy, RADIUS, STICK_DEADZONE));
        else this.input.releaseStick();
    }

    private onActionDown = (e: PointerEvent) => {
        e.preventDefault();
        if (!this.hooks.canAct()) return;
        this.actionIds.add(e.pointerId);
        this.el.action.classList.add('pressed');
        this.input.pressAction();
    };

    private onActionEnd = (e: PointerEvent) => {
        this.actionIds.delete(e.pointerId);
        if (this.actionIds.size === 0) this.el.action.classList.remove('pressed');
    };
}
