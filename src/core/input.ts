import type { Vec2 } from './types';

export type Direction = 'up' | 'down' | 'left' | 'right';

/** 1 フレーム分の入力 */
export interface InputFrame {
    /** -1〜1。長さは最大 1 */
    moveX: number;
    moveY: number;
    /** このフレームで「話す／次へ」が押されたか（押した瞬間だけ true） */
    action: boolean;
}

/**
 * キーボードとタッチの入力をまとめる（DOM 非依存）。
 * - 移動入力の元（キー・スティック）を別々に持ち、releaseAll で全部解除できる。
 * - ボタンは「押した回数」で持つので、フレームの合間に押しても取りこぼさない。
 */
export class InputState {
    private readonly held = new Set<Direction>();
    private stick: Vec2 = { x: 0, y: 0 };
    private pendingActions = 0;

    setDirection(dir: Direction, down: boolean): void {
        if (down) this.held.add(dir);
        else this.held.delete(dir);
    }

    setStick(v: Vec2): void {
        this.stick = { x: v.x, y: v.y };
    }

    releaseStick(): void {
        this.stick = { x: 0, y: 0 };
    }

    pressAction(): void {
        // 連打で溜まりすぎないよう上限を設ける
        this.pendingActions = Math.min(this.pendingActions + 1, 2);
    }

    /** 指を離した・画面を切り替えたときなど、すべての入力を解除する */
    releaseAll(): void {
        this.held.clear();
        this.stick = { x: 0, y: 0 };
        this.pendingActions = 0;
    }

    /** 押されたままの移動入力があるか */
    hasMovement(): boolean {
        return this.held.size > 0 || this.stick.x !== 0 || this.stick.y !== 0;
    }

    /** 現在の入力を読み取り、ボタン押下を 1 回分消費する */
    poll(): InputFrame {
        let x = 0;
        let y = 0;
        if (this.stick.x !== 0 || this.stick.y !== 0) {
            x = this.stick.x;
            y = this.stick.y;
        } else {
            if (this.held.has('left')) x -= 1;
            if (this.held.has('right')) x += 1;
            if (this.held.has('up')) y -= 1;
            if (this.held.has('down')) y += 1;
        }
        const len = Math.hypot(x, y);
        if (len > 1) {
            x /= len;
            y /= len;
        }
        const action = this.pendingActions > 0;
        if (action) this.pendingActions--;
        return { moveX: x, moveY: y, action };
    }
}
