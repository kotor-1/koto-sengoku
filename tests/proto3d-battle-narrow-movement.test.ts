/**
 * 狭い所（崖に挟まれた峠道・関）の動き（通れない所がある戦場だけ。sim.ts の moveUnit・pathAim・steerAround・separate）：
 * - 峠道の真ん中に速い道があっても、並んで進む二隊が道探しで同じ点へ寄り合って詰まらない（通り過ぎた点・味方が立つ点は飛ばす）。
 * - 止まっている味方の横をよける幅が無い（関の幅 30 m の真ん中に弓がいる）ときは、その味方の中をすり抜ける。
 * - 幅 40 m の峠道の真ん中に止まっている味方は、崖の角へ押し付けられずに横をよけて通る。
 * - ちょうど spacing（18 m）離れた二つの行き先へ二隊を出しても、どちらも行き先に着く。
 * - 敵の考えの assault の弓が関の中で止まって射ても、後から来る敵の槍は関を抜けて南へ攻め込む。
 *
 * どれも「状態を直接操作したテスト」（戦場のデータの敵を外す・道を足すなどして、stepBattle で進める）。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, stepBattle, unitById, type BattleState } from '../proto3d/src/battle/sim';
import { buildBattleSetup, getField } from '../proto3d/src/battle/fields';
import type { BattleSetup } from '../proto3d/src/battle/types';

const PASS = getField('mountain_pass')!;

/** 山道・峠から、敵の本陣だけを残した合戦（味方の動きだけを見る）。road：峠道の真ん中に速い道を足す */
function quietPass(road = false): BattleSetup {
    const st = buildBattleSetup(PASS, 'standard');
    const terrain = road ? [...st.map.terrain, { kind: 'road' as const, rect: { x0: -5, x1: 5, z0: -130, z1: 110 } }] : st.map.terrain;
    return { ...st, map: { ...st.map, terrain }, units: st.units.filter((u) => u.side === 'ally' || u.kind === 'honjin') };
}

function run(s: BattleState, sec: number, each?: (s: BattleState) => void): void {
    const end = s.t + sec;
    while (s.t < end - 1e-9) {
        stepBattle(s, 0.1);
        each?.(s);
    }
}

const at = (s: BattleState, id: string) => unitById(s, id)!;
const near = (s: BattleState, id: string, x: number, z: number) => Math.hypot(at(s, id).x - x, at(s, id).z - z);

describe('狭い所の動き（通れない所がある戦場）', () => {
    it('峠道の真ん中に速い道があっても、並んで進む二隊は詰まらずに関の行き先へ着く', () => {
        const s = createBattle(quietPass(true));
        expect(s.field.nav).not.toBeNull();
        issueOrder(s, 'a_tadakatsu', { type: 'move', x: -10, z: 42 });
        issueOrder(s, 'a_sakai', { type: 'move', x: 10, z: 42 });
        run(s, 80);
        expect(near(s, 'a_tadakatsu', -10, 42)).toBeLessThan(0.5);
        expect(near(s, 'a_sakai', 10, 42)).toBeLessThan(0.5);
        expect(at(s, 'a_tadakatsu').order.type).toBe('hold');
        expect(at(s, 'a_sakai').order.type).toBe('hold');
    });

    it('関（幅 30 m）の真ん中に止まっている弓の中を、後から来る槍がすり抜けて北へ抜ける', () => {
        const s = createBattle(quietPass());
        issueOrder(s, 'a_yumi', { type: 'move', x: 0, z: 40 });
        run(s, 40);
        expect(near(s, 'a_yumi', 0, 40)).toBeLessThan(0.5);
        issueOrder(s, 'a_tadakatsu', { type: 'move', x: 0, z: -20 });
        let squeezed = false;
        run(s, 90, (st) => {
            if (at(st, 'a_tadakatsu').passThrough === 'a_yumi') squeezed = true;
        });
        expect(squeezed).toBe(true);
        expect(near(s, 'a_tadakatsu', 0, -20)).toBeLessThan(0.5);
        // 止まっている弓は押し出されない
        expect(near(s, 'a_yumi', 0, 40)).toBeLessThan(0.5);
    });

    it('峠道（幅 40 m）の真ん中に止まっている弓は、横をよけて通る（崖の角で止まらない）', () => {
        const s = createBattle(quietPass());
        issueOrder(s, 'a_yumi', { type: 'move', x: 0, z: 80 });
        run(s, 30);
        issueOrder(s, 'a_tadakatsu', { type: 'move', x: 0, z: 0 });
        run(s, 70);
        expect(near(s, 'a_tadakatsu', 0, 0)).toBeLessThan(0.5);
        expect(near(s, 'a_yumi', 0, 80)).toBeLessThan(0.5);
    });

    it('ちょうど 18 m 離れた二つの行き先へ二隊を出しても、どちらも行き先に着く', () => {
        const s = createBattle(quietPass());
        issueOrder(s, 'a_tadakatsu', { type: 'move', x: -9, z: 42 });
        issueOrder(s, 'a_sakai', { type: 'move', x: 9, z: 42 });
        run(s, 90);
        expect(near(s, 'a_tadakatsu', -9, 42)).toBeLessThan(0.5);
        expect(near(s, 'a_sakai', 9, 42)).toBeLessThan(0.5);
    });

    it('敵勢の弓が始めからいて関で止まって射ても、二番手・三番手の槍は関を抜けて南へ攻め込む', () => {
        const st = buildBattleSetup(PASS, 'standard');
        const s = createBattle({ ...st, units: st.units.map((u) => (u.id === 'e_yumi' ? { ...u, arriveAt: 0 } : u)) });
        let yumiHeldInGate = false;
        run(s, 150, (x) => {
            const y = at(x, 'e_yumi');
            if (y.order.type === 'hold' && Math.hypot(y.x, y.z - 40) < 25) yumiHeldInGate = true;
        });
        expect(yumiHeldInGate).toBe(true);
        // 関（z 25〜55）より南へ出た二番手・三番手
        const south = ['e_w2a', 'e_w2b', 'e_w2c', 'e_w3a', 'e_w3b'].filter((id) => at(s, id).z > 55);
        expect(south.length).toBeGreaterThanOrEqual(4);
    });
});
