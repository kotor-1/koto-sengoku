/**
 * 第2群の戦場の調整役から出たエンジン側の要望（docs/fields-group2-design.md の後の直し）。どれもデータと汎用の仕組みで、戦場の id では分けない。
 * - 道探し（pathfind.ts）：まっすぐ行く区間を、遅い方の速さだけでなく、かかる時間でも A* の道・元の道と比べる
 *   （行き先・出発点が水田の中でも、街道・畦道を回る方がずっと早ければ回る）。
 *
 * 既存の戦場（国境の原・第1群の 5 戦場・第2群の 5 戦場）の台本が 1 刻みも変わらないことは、tests/proto3d-battle-v11-identity.test.ts・
 * tests/proto3d-fields-initiative-record.test.ts と各戦場のテストがそのまま通ることで確かめる。
 * 「状態を直接操作」（格子を作って道を直接求める）か「早送り」かは各テストの名前に書く。
 */
import { describe, expect, it } from 'vitest';
import { buildNav, findPath, type NavGrid } from '../proto3d/src/battle/pathfind';
import type { UnitKind } from '../proto3d/src/battle/types';

// ---------------------------------------------------------------- 道探し

/**
 * 試験の水田：200 m × 200 m の全体が水田（速さ 0.3）。南北の街道（x -5〜5）と東西の畦道（z -65〜-55）だけ速い（1.2）。
 * 真ん中の東の田に通れない池（x 20〜60, z -20〜20）。
 */
function paddyNav(): NavGrid {
    const road = (x: number, z: number) => Math.abs(x) <= 5 || (z >= -65 && z <= -55);
    const pond = (x: number, z: number) => x >= 20 && x <= 60 && z >= -20 && z <= 20;
    return buildNav(
        200,
        200,
        (x, z) => !pond(x, z),
        (_k: UnitKind, x, z) => (road(x, z) ? 1.2 : 0.3),
    );
}
/** 折れ線の道を 1 m おきにたどった、かかる時間（距離 ÷ 速さ。試験の水田の速さ） */
function travelTime(from: { x: number; z: number }, pts: { x: number; z: number }[]): number {
    const road = (x: number, z: number) => Math.abs(x) <= 5 || (z >= -65 && z <= -55);
    let t = 0;
    let a = from;
    for (const b of pts) {
        const d = Math.hypot(b.x - a.x, b.z - a.z);
        const n = Math.max(1, Math.ceil(d));
        for (let k = 0; k < n; k++) {
            const f = (k + 0.5) / n;
            t += d / n / (road(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f) ? 1.2 : 0.3);
        }
        a = b;
    }
    return t;
}
const onRoad = (p: { x: number; z: number }) => Math.abs(p.x) <= 5 || (p.z >= -65 && p.z <= -55);

describe('道探し：まっすぐ行く区間を、かかる時間でも比べる（状態を直接操作：格子を作って道を求める）', () => {
    it('行き先が田の奥：街道から田をまっすぐ突っ切らず、街道・畦道を回る（直す前は、遅い方の速さ 0.3 で比べてまっすぐ田を渡っていた）', () => {
        const nav = paddyNav();
        const from = { x: 0, z: 90 };
        const goal = { x: 70, z: -50 };
        const path = findPath(nav, 'yari', from.x, from.z, goal.x, goal.z)!;
        expect(path.length).toBeGreaterThan(1);
        // 途中の点に街道・畦道の上の点がある
        expect(path.slice(0, -1).some(onRoad)).toBe(true);
        const straightT = travelTime(from, [goal]);
        const pathT = travelTime(from, path);
        // まっすぐ（田を約 150 m・畦道を少し）は約 494 秒。回る道はその半分より早い
        expect(straightT).toBeGreaterThan(450);
        expect(pathT).toBeLessThan(straightT * 0.5);
    });

    it('出発点が田の中：池を回る道を短くするとき、田をまっすぐ突っ切る区間に縮めない（街道へ出て回る方が早い）', () => {
        const nav = paddyNav();
        const from = { x: 40, z: 30 }; // 池のすぐ南の田
        const goal = { x: 40, z: -75 }; // 池の北・畦道のすぐ北の田
        const path = findPath(nav, 'yari', from.x, from.z, goal.x, goal.z)!;
        expect(path.length).toBeGreaterThan(1);
        const pathT = travelTime(from, path);
        // 池の脇の田を回るだけ（約 130 m・0.3）なら約 430 秒。街道へ出て回る道は、それよりはっきり早い
        const viaPaddy = travelTime(from, [{ x: 65, z: 30 }, { x: 65, z: -60 }, goal]);
        expect(pathT).toBeLessThan(viaPaddy * 0.8);
    });

    it('同じ地形だけの所・速さの差の小さい所は今までどおりまっすぐ（道探しの点は行き先 1 つ）', () => {
        const nav = paddyNav();
        // 街道の上だけ
        expect(findPath(nav, 'yari', 0, 90, 0, -90)).toEqual([{ x: 0, z: -90 }]);
        // 田の中だけ（街道・畦道を通らない）
        expect(findPath(nav, 'yari', -60, 80, -30, 0)).toEqual([{ x: -30, z: 0 }]);
    });
});
