import { describe, expect, it } from 'vitest';
import { actorBox, moveWithCollision, rectGap, rectsOverlap } from '../src/core/collision';
import type { Rect } from '../src/core/types';

const wall: Rect = { x: 100, y: 0, w: 16, h: 200 };
const blocked = (r: Rect) => rectsOverlap(r, wall);

describe('collision', () => {
    it('壁の手前で止まり、すり抜けない', () => {
        const res = moveWithCollision({ x: 80, y: 50 }, 200, 0, 5, 4, blocked);
        expect(res.x).toBeLessThanOrEqual(95);
        expect(res.x).toBeGreaterThan(94.5);
        expect(blocked(actorBox(res, 5, 4))).toBe(false);
    });

    it('斜めに壁へ当たると壁沿いに滑る', () => {
        const res = moveWithCollision({ x: 94, y: 50 }, 10, 10, 5, 4, blocked);
        expect(res.y).toBeCloseTo(60);
        expect(res.x).toBeLessThanOrEqual(95);
    });

    it('何もなければそのまま動く', () => {
        const res = moveWithCollision({ x: 10, y: 10 }, 3, -2, 5, 4, () => false);
        expect(res).toMatchObject({ x: 13, y: 8 });
    });

    it('rectGap は重なりで 0、離れていれば距離', () => {
        expect(rectGap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(0);
        expect(rectGap({ x: 0, y: 0, w: 10, h: 10 }, { x: 13, y: 0, w: 10, h: 10 })).toBe(3);
    });
});
