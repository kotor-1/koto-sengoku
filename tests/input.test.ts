import { describe, expect, it } from 'vitest';
import { InputState } from '../src/core/input';
import { clampToRadius, stickVector } from '../src/core/joystick';

describe('InputState', () => {
    it('キーの斜め入力は長さ 1 に正規化される', () => {
        const s = new InputState();
        s.setDirection('right', true);
        s.setDirection('down', true);
        const f = s.poll();
        expect(Math.hypot(f.moveX, f.moveY)).toBeCloseTo(1);
    });

    it('ボタンは押した回数だけ 1 回ずつ読める', () => {
        const s = new InputState();
        s.pressAction();
        expect(s.poll().action).toBe(true);
        expect(s.poll().action).toBe(false);
    });

    it('releaseAll で移動もボタンも解除される', () => {
        const s = new InputState();
        s.setDirection('left', true);
        s.setStick({ x: 0.5, y: 0.5 });
        s.pressAction();
        s.releaseAll();
        expect(s.hasMovement()).toBe(false);
        expect(s.poll()).toEqual({ moveX: 0, moveY: 0, action: false });
    });

    it('スティックを離すとキー入力だけが残る', () => {
        const s = new InputState();
        s.setDirection('up', true);
        s.setStick({ x: 1, y: 0 });
        expect(s.poll().moveX).toBe(1);
        s.releaseStick();
        expect(s.poll()).toMatchObject({ moveX: 0, moveY: -1 });
    });
});

describe('joystick', () => {
    it('無反応域の内側は 0', () => {
        expect(stickVector(5, 0, 50, 0.2)).toEqual({ x: 0, y: 0 });
    });
    it('半径を超えても長さは 1', () => {
        const v = stickVector(300, 400, 50, 0.2);
        expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
        expect(v.x).toBeCloseTo(0.6);
    });
    it('つまみは円の内側に収まる', () => {
        const v = clampToRadius(0, 100, 40);
        expect(v).toEqual({ x: 0, y: 40 });
    });
});
