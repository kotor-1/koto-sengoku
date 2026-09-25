import { describe, expect, it } from 'vitest';
import { GATE, HOUSE, START, colliders } from '../proto3d/src/layout';
import { CAMERA_YAW, HERO_RADIUS, MAX_SPEED, SPEED, createHero, isFree, screenToGround, stepHero } from '../proto3d/src/game/motion';
import { PINE } from '../proto3d/src/layout';

/** 実際のゲームと同じカメラの向き */
const YAW = CAMERA_YAW;
const DT = 1 / 60;

/** 地面の方向 (gx, gz) へ歩く画面入力（screenToGround の逆） */
function groundInput(gx: number, gz: number): [number, number] {
    return [Math.cos(YAW) * gx - Math.sin(YAW) * gz, Math.sin(YAW) * gx + Math.cos(YAW) * gz];
}

function run(h: ReturnType<typeof createHero>, ix: number, iy: number, sec: number, running = false, dt = DT) {
    for (let t = 0; t < sec - 1e-9; t += dt) stepHero(h, ix, iy, YAW, dt, running);
}

describe('3D 比較版：主人公の動き', () => {
    it('始めの位置は通れる場所', () => {
        expect(isFree(START.x, START.z)).toBe(true);
    });

    it('カメラは正面寄り：画面の上＝北（城門）、右＝東。斜めも画面どおり', () => {
        const cases: [number, number, number, number][] = [
            [0, -1, 0, -1], // 上 → 北
            [0, 1, 0, 1], // 下 → 南
            [1, 0, 1, 0], // 右 → 東
            [-1, 0, -1, 0], // 左 → 西
            [Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2], // 右上 → 北東
            [-Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2], // 左下 → 南西
        ];
        for (const [ix, iy, gx, gz] of cases) {
            const d = screenToGround(ix, iy, YAW);
            expect(d.x).toBeCloseTo(gx, 6);
            expect(d.z).toBeCloseTo(gz, 6);
        }
    });

    it('画面の上を押すと、奥（北）へまっすぐ歩き、速さは上限まで上がる', () => {
        const h = createHero(START.x, START.z, Math.PI);
        run(h, 0, -1, 1.5);
        expect(h.z).toBeLessThan(START.z - 1);
        expect(h.x).toBeCloseTo(START.x, 6);
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

    it('逆向きを押すと、向き直るのを待たずにすぐ逆へ進み、進みながら 0.4 秒ほどで向き直る', () => {
        const h = createHero(START.x, START.z, Math.PI);
        run(h, 0, -1, 1);
        const before = { x: h.x, z: h.z, heading: h.heading };
        run(h, 0, 1, 0.1); // 逆向き（下）を 0.1 秒
        expect(h.z).toBeGreaterThan(before.z); // もう手前へ進んでいる
        const mid = Math.abs(Math.atan2(Math.sin(h.heading - before.heading), Math.cos(h.heading - before.heading)));
        expect(mid).toBeLessThan(2.8); // 体はまだ向き直りの途中（一瞬で反転しない）
        run(h, 0, 1, 0.3);
        const diff = Math.abs(Math.atan2(Math.sin(h.heading - before.heading), Math.cos(h.heading - before.heading)));
        expect(diff).toBeGreaterThan(2.9);
        expect(h.speed).toBeCloseTo(MAX_SPEED, 1);
    });

    it('横へ切り替えても、その場で止まらず入力の方向へ進み続ける', () => {
        const h = createHero(START.x, START.z, Math.PI);
        run(h, 0, -1, 1);
        const x0 = h.x;
        stepHero(h, 1, 0, YAW, DT);
        expect(h.speed).toBeGreaterThan(MAX_SPEED * 0.9);
        run(h, 1, 0, 0.2);
        expect(h.x).toBeGreaterThan(x0 + 0.2);
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
        // 西へ（画面の左）歩き続ける：地面の -x 方向になる入力
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

describe('3D 比較版：歩く／走る', () => {
    it('速さは一か所（SPEED）で決まり、歩きはこれまでと同じ 1.55m/秒、走りは歩きの 2.2 倍', () => {
        expect(SPEED.walk).toBe(1.55);
        expect(MAX_SPEED).toBe(SPEED.walk);
        expect(SPEED.run / SPEED.walk).toBeCloseTo(2.2, 6);
        const w = createHero(12, 5, Math.PI);
        run(w, 1, 0, 1.5);
        expect(w.speed).toBeCloseTo(SPEED.walk, 6);
        const r = createHero(12, 5, Math.PI);
        run(r, 1, 0, 1.5, true);
        expect(r.speed).toBeCloseTo(SPEED.run, 6);
    });

    it('走りで 1 秒に進む距離は、斜めでもまっすぐと同じ（斜めだけ速くならない）', () => {
        const d = (ix: number, iy: number) => {
            const h = createHero(12, 5, Math.PI);
            run(h, ix, iy, 1, true); // 速さを上げきる
            const x = h.x;
            const z = h.z;
            run(h, ix, iy, 1, true);
            return Math.hypot(h.x - x, h.z - z);
        };
        const straight = d(1, 0);
        // キーボードの斜め（2 つ押し）は長さ 1 にそろえて渡る（main.ts の readInput）。長さ √2 のまま来ても 1 に切る
        expect(d(Math.SQRT1_2, -Math.SQRT1_2)).toBeCloseTo(straight, 3);
        expect(d(1, -1)).toBeCloseTo(straight, 3);
        expect(straight).toBeCloseTo(SPEED.run, 2);
    });

    it('走っていても、入力を離すと 0.3 秒で止まり、止まるまでに進むのは 0.6m 未満', () => {
        const h = createHero(12, 5, Math.PI);
        run(h, 0, -1, 1.5, true);
        const z = h.z;
        run(h, 0, 0, 0.3, true);
        expect(h.speed).toBe(0);
        expect(z - h.z).toBeLessThan(0.6);
    });

    it('走るのをやめると、歩きの速さまでなめらかに落ちる（一瞬で変わらない）', () => {
        const h = createHero(12, 5, Math.PI);
        run(h, 1, 0, 1.5, true);
        stepHero(h, 1, 0, YAW, DT, false);
        expect(h.speed).toBeLessThan(SPEED.run);
        expect(h.speed).toBeGreaterThan(SPEED.walk + 0.5);
        run(h, 1, 0, 0.3, false);
        expect(h.speed).toBeCloseTo(SPEED.walk, 6);
    });

    it('走っても、画面が重くて 1 コマが長い（0.1 秒）ときでも、家・土塀・門の柱・控柱・木の幹をすり抜けない', () => {
        for (const dt of [DT, 0.1]) {
            // 家の表へ（西へ）
            const house = createHero(HOUSE.x1 + 2, (HOUSE.z0 + HOUSE.z1) / 2, -Math.PI / 2);
            run(house, -1, 0, 3, true, dt);
            expect(house.x).toBeGreaterThanOrEqual(HOUSE.x1 + 0.25 + HERO_RADIUS - 1e-6);
            // 土塀へ（北へ）
            const wall = createHero(6, GATE.z + 3, Math.PI);
            run(wall, 0, -1, 3, true, dt);
            expect(wall.z).toBeGreaterThan(GATE.z);
            // 門の内側の控柱（0.4m 角）へ、門の中から北へ
            const post = createHero(GATE.pillarX, GATE.z - 0.8, Math.PI);
            run(post, 0, -1, 2, true, dt);
            expect(post.z).toBeGreaterThan(GATE.z - 1.6);
            // 松の幹へ（東へ）
            const pine = createHero(PINE.x - 2, PINE.z, Math.PI / 2);
            run(pine, 1, 0, 2, true, dt);
            expect(pine.x).toBeLessThan(PINE.x);
            for (const h of [house, wall, post, pine]) expect(isFree(h.x, h.z)).toBe(true);
        }
    });

    it('走って城門を通り抜けられる', () => {
        const h = createHero(0, GATE.z + 4, Math.PI);
        run(h, 0, -1, 4, true, 0.1);
        expect(h.z).toBeLessThan(GATE.z - 4);
    });
});
