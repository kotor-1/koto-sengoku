/**
 * 橋の詰まり（sim.ts の trackSqueeze・RULES.squeezeSec）：橋の上・橋の口で、止まっている味方をよけようとして左右とも水に塞がれ、
 * 別の味方の押し離しで押し戻されて動けなくなった部隊は、味方の中をすり抜けて進む。
 *
 * 確認で見つかった場面（一本橋。本物の入力）：橋の北の東の角 (9.8,-38) にいる本多忠勝隊へ橋頭 (0,-75) への移動を出すと、
 * 20 m 先の北の岸で待機している酒井隊 (15.9,-54.9) をよけようとして動けず、直す前は 6 秒ほどで「着いた」ことにされて待機に戻った
 * （出し直しても同じ）。どれも「状態を直接操作したテスト」（部隊の位置を置いてから stepBattle で進める）。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, stepBattle, unitById, RULES, type BattleState } from '../proto3d/src/battle/sim';
import { buildBattleSetup, getField } from '../proto3d/src/battle/fields';

/** 一本橋で、敵を北の端に退け、味方を pos の所に置く（ほかの味方は南東の隅）。命令はみな待機、武将の自由な動きはなし */
function setUp(fieldId: string, pos: [string, number, number][]): BattleState {
    const s = createBattle(buildBattleSetup(getField(fieldId)!, 'standard'));
    s.units.forEach((u, i) => {
        if (u.side === 'enemy') {
            u.x = -180 + i * 25;
            u.z = -175;
        } else {
            u.x = 150 + i * 20;
            u.z = 150;
        }
        u.order = { type: 'hold' };
        u.initiative = null;
    });
    for (const [id, x, z] of pos) {
        const u = unitById(s, id)!;
        u.x = x;
        u.z = z;
    }
    return s;
}

/** 移動を出して、待機に変わるまで（最長 sec 秒）進める。待機に変わった時刻と、その時の位置 */
function moveUntilHold(s: BattleState, id: string, x: number, z: number, sec = 25): { t: number | null; x: number; z: number; squeezed: boolean } {
    expect(issueOrder(s, id, { type: 'move', x, z })).toBe(true);
    const u = unitById(s, id)!;
    let squeezed = false;
    for (let k = 0; k < sec / RULES.tick; k++) {
        stepBattle(s, RULES.tick);
        if (u.squeeze?.on) squeezed = true;
        if (u.order.type !== 'move') return { t: s.t, x: u.x, z: u.z, squeezed };
    }
    return { t: null, x: u.x, z: u.z, squeezed };
}

describe('橋の詰まり：橋の口で味方に挟まれた部隊は、味方の中をすり抜けて進む', () => {
    it('橋の北の東の角の忠勝隊 → 橋頭 (0,-75) に着く（直す前は角で 6.2 秒に待機へ戻り、行き先まで 38 m 残っていた）', () => {
        const s = setUp('single_bridge', [
            ['a_tadakatsu', 9.8, -38],
            ['a_sakai', 15.9, -54.9],
            ['a_sakakibara', -9.7, -39.4],
        ]);
        const r = moveUntilHold(s, 'a_tadakatsu', 0, -75);
        expect(r.squeezed).toBe(true);
        expect(r.t).not.toBeNull();
        expect(Math.hypot(r.x - 0, r.z + 75)).toBeLessThan(2);
        // 待機している味方は押し出されない
        expect(unitById(s, 'a_sakai')!.x).toBeCloseTo(15.9, 0);
        expect(unitById(s, 'a_sakakibara')!.z).toBeCloseTo(-39.4, 0);
    });

    it('角で酒井隊・石川隊・騎馬隊・忠勝隊に囲まれた榊原隊 → 西の弓の所 (-25,-78) に着く（直す前は角で 12.1 秒に待機へ戻った）', () => {
        const s = setUp('single_bridge', [
            ['a_sakakibara', 9.8, -37.9],
            ['a_sakai', 15.9, -54.8],
            ['a_ishikawa', -14.9, -55.3],
            ['a_kiba', -3.7, -40.7],
            ['a_tadakatsu', 0, -70],
        ]);
        const r = moveUntilHold(s, 'a_sakakibara', -25, -78);
        expect(r.squeezed).toBe(true);
        expect(Math.hypot(r.x + 25, r.z + 78)).toBeLessThan(2);
    });

    it('南の岸の口で橋の上の味方に塞がれた忠勝隊も、橋を渡り切る（直す前は口の東 (13.7,-2.9) で待機に戻った）', () => {
        const s = setUp('single_bridge', [
            ['a_tadakatsu', 0, 10],
            ['a_sakai', -8, -5],
            ['a_ishikawa', 8, -20],
        ]);
        const u = unitById(s, 'a_tadakatsu')!;
        expect(issueOrder(s, 'a_tadakatsu', { type: 'move', x: 0, z: -75 })).toBe(true);
        for (let k = 0; k < 30 / RULES.tick; k++) stepBattle(s, RULES.tick);
        // 30 秒で橋（北の端 z -44）を渡り切っている
        expect(u.z).toBeLessThan(-50);
    });

    it('すり抜けは橋のそばだけ：橋の無い戦場（河川・浅瀬）では始まらない', () => {
        const s = setUp('river_ford', [
            ['a_tadakatsu', 0, 60],
            ['a_sakai', 0, 40],
            ['a_ishikawa', 18, 52],
        ]);
        const u = unitById(s, 'a_tadakatsu')!;
        issueOrder(s, 'a_tadakatsu', { type: 'move', x: 0, z: -20 });
        for (let k = 0; k < 15 / RULES.tick; k++) {
            stepBattle(s, RULES.tick);
            expect(u.squeeze).toBeNull();
        }
    });
});
