import { describe, expect, it } from 'vitest';
import { GATE, HOUSE, START, colliders } from '../proto3d/src/layout';
import { HERO_RADIUS, MAX_SPEED, createHero, isFree, screenToGround, stepHero } from '../proto3d/src/game/motion';

const YAW = (28 * Math.PI) / 180;
const DT = 1 / 60;

/** 地面の方向 (gx, gz) へ歩く画面入力（screenToGround の逆） */
function groundInput(gx: number, gz: number): [number, number] {
    return [Math.cos(YAW) * gx - Math.sin(YAW) * gz, Math.sin(YAW) * gx + Math.cos(YAW) * gz];
}

function run(h: ReturnType<typeof createHero>, ix: number, iy: number, sec: number) {
    for (let t = 0; t < sec; t += DT) stepHero(h, ix, iy, YAW, DT);
}

describe('3D 比較版：主人公の動き', () => {
    it('始めの位置は通れる場所', () => {
        expect(isFree(START.x, START.z)).toBe(true);
    });

    it('画面の上を押すと、カメラから見て奥（北西寄り）へ歩き、速さは上限まで上がる', () => {
        const h = createHero(START.x, START.z, Math.PI);
        run(h, 0, -1, 1.5);
        const d = screenToGround(0, -1, YAW);
        expect(d.z).toBeLessThan(0);
        expect(h.z).toBeLessThan(START.z - 1);
        expect(h.speed).toBeCloseTo(MAX_SPEED, 1);
    });

    it('入力をやめると 0.3 秒以内に止まる', () => {
        const h = createHero(START.x, START.z, Math.PI);
        run(h, 1, 0, 1);
        run(h, 0, 0, 0.3);
        expect(h.speed).toBe(0);
        const p = { x: h.x, z: h.z };
        run(h, 0, 0, 1);
        expect(h.x).toBe(p.x);
        expect(h.z).toBe(p.z);
    });

    it('逆向きを押すと、まずその場で振り向き、向き終わってから歩き出す', () => {
        const h = createHero(START.x, START.z, Math.PI);
        run(h, 0, -1, 1);
        const before = { x: h.x, z: h.z, heading: h.heading };
        stepHero(h, 0, 1, YAW, DT); // 逆向き
        expect(h.speed).toBeLessThan(0.8);
        run(h, 0, 1, 0.6);
        // 向きがほぼ反対になっている
        const diff = Math.abs(Math.atan2(Math.sin(h.heading - before.heading), Math.cos(h.heading - before.heading)));
        expect(diff).toBeGreaterThan(2.8);
        run(h, 0, 1, 1);
        expect(h.z).toBeGreaterThan(before.z);
    });

    it('向きは移動の方向へなめらかに回る（1 フレームで飛ばない）', () => {
        const h = createHero(START.x, START.z, Math.PI);
        const h0 = h.heading;
        stepHero(h, 1, 0, YAW, DT);
        const d = Math.abs(Math.atan2(Math.sin(h.heading - h0), Math.cos(h.heading - h0)));
        expect(d).toBeGreaterThan(0);
        expect(d).toBeLessThan(0.4);
    });

    it('家の横（北側の路地）を東西に通り抜けられ、家には入り込まない', () => {
        const z = HOUSE.z0 - 0.9;
        const h = createHero(HOUSE.x1 + 1.2, z, -Math.PI / 2);
        // 西へ（画面の左下寄り）歩き続ける：地面の -x 方向になる入力
        const [ix, iy] = groundInput(-1, 0);
        const g = screenToGround(ix, iy, YAW);
        expect(g.x).toBeCloseTo(-1, 5);
        expect(g.z).toBeCloseTo(0, 5);
        run(h, ix, iy, 6);
        expect(h.x).toBeLessThan(HOUSE.x0 - 0.5);
        expect(Math.abs(h.z - z)).toBeLessThan(0.05);
        // 家の中には入らない
        const inside = h.x > HOUSE.x0 && h.x < HOUSE.x1 && h.z > HOUSE.z0 && h.z < HOUSE.z1;
        expect(inside).toBe(false);
    });

    it('家や土塀に向かって歩いても、めり込まずに止まる（壁に沿って滑る）', () => {
        const h = createHero(HOUSE.x1 + 1.5, (HOUSE.z0 + HOUSE.z1) / 2, -Math.PI / 2);
        const [ix, iy] = groundInput(-1, 0);
        run(h, ix, iy, 4);
        expect(h.x).toBeGreaterThanOrEqual(HOUSE.x1 + 0.25 + HERO_RADIUS - 1e-6);
        expect(isFree(h.x, h.z)).toBe(true);
    });

    it('土塀は越えられず、城門の間だけ通れる', () => {
        // 北（-z）へまっすぐ
        const [ix, iy] = groundInput(0, -1);
        const g = screenToGround(ix, iy, YAW);
        expect(g.z).toBeLessThan(-0.99);
        const wall = createHero(6, GATE.z + 3, Math.PI);
        run(wall, ix, iy, 6);
        expect(wall.z).toBeGreaterThan(GATE.z);
        const gate = createHero(0, GATE.z + 3, Math.PI);
        run(gate, ix, iy, 6);
        expect(gate.z).toBeLessThan(GATE.z - 2);
    });

    it('当たり判定の四角形はすべて有効な大きさ', () => {
        for (const r of colliders()) {
            expect(r.x1).toBeGreaterThan(r.x0);
            expect(r.z1).toBeGreaterThan(r.z0);
        }
    });
});
