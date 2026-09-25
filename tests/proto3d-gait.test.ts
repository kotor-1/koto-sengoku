import { describe, expect, it } from 'vitest';
import { gaits } from '../proto3d/src/assets/hero';
import { SPEED } from '../proto3d/src/game/motion';

describe('3D 比較版：歩き・走りの足運び（骨組みから計算）', () => {
    const g = gaits();

    it('測った値（確認用）', () => {
        console.log(JSON.stringify({
            walk: { speed: g.walk.speed.toFixed(3), slip: g.walk.slip.toFixed(3), flight: g.walk.flight.toFixed(2), clearance: g.walk.clearance.toFixed(4) },
            run: { speed: g.run.speed.toFixed(3), slip: g.run.slip.toFixed(3), flight: g.run.flight.toFixed(2), clearance: g.run.clearance.toFixed(4) },
        }));
    });

    it('歩き：いつもどちらかの足が地面に着き、接地した足の送りのばらつきが小さい（かかとの着地の一瞬を除き ±15% 程度）', () => {
        expect(g.walk.flight).toBe(0);
        expect(g.walk.slip / g.walk.speed).toBeLessThan(0.35);
        expect(g.walk.clearance).toBeGreaterThan(-0.002); // 振り出す足が地面にめり込まない
    });

    it('走り：両足が浮く一瞬があり、接地した足の送りのばらつきが小さい', () => {
        expect(g.run.flight).toBeGreaterThan(0.1);
        expect(g.run.flight).toBeLessThan(0.5);
        expect(g.run.slip / g.run.speed).toBeLessThan(0.1);
        expect(g.run.clearance).toBeGreaterThan(-0.002);
    });

    it('実際の速さで再生したとき、再生の速さが極端にならない（歩き・走りとも 0.6〜1.6 倍）', () => {
        for (const [gait, v] of [[g.walk, SPEED.walk], [g.run, SPEED.run]] as const) {
            const scale = v / gait.speed;
            expect(scale).toBeGreaterThan(0.6);
            expect(scale).toBeLessThan(1.6);
        }
    });

    it('歩きと走りは同じ長さの位相で、同じ骨を動かす（混ぜても骨が欠けない）', () => {
        const names = (c: typeof g.walk.clip) => c.tracks.map((t) => t.name).sort();
        expect(names(g.run.clip)).toEqual(names(g.walk.clip));
    });
});
