/**
 * 第3群の確かめ（遊んで確かめた担当の指摘）で見つけた問題の直し（共通の機能。戦場の id では分けない。どれも第3群の直し
 * FieldRules.refinedMoves の戦場だけで、既存の 10 戦場は 1 刻みも同じ）：
 * - 道の無い相手への攻撃（sim.ts の meleeUnreachable）：槍・騎馬・本陣で、櫓台の上の弓・閉じた門の向こうの槍への攻撃を押すと、命令が受け付け
 *   られ、石垣の足元で道が無いまま攻撃の命令で立ち続けた（知らせなし）。味方の命令は断り、理由を出す（control.ts の refusalText）。
 *   弓の攻撃は今までどおり受ける（届けば射る）。敵の「すぐ近く」を押した攻撃は、押した地点への移動にする（entry.ts。ここでは確かめない）。
 * - 湿地の島（sim.ts の separate・friendHoldsGoal）：1 つの島へ 4 部隊を 8 m おきに送ると、島の縁に着いた部隊が先に着いた味方に押されて泥へ
 *   出され、泥の中で黙って待機になった。止まっている味方どうしの押し離しでは、普通の地面から泥へ押し出さない。
 * - 取る目標（sim.ts の needsOwnDeed）：主目標が区域の確保・門の制圧・出口への突破（段階目標ならその段のどれか）の合戦では、敵の部隊が
 *   すべて崩れても勝ちにせず、主目標を果たすまで続ける（一度だけ知らせる）。守る目標は今までどおり勝ち。
 *
 * 確かめの種類はテストの名前に書く：「状態を直接操作」（部隊の状態を書き換える）、「早送り」（stepBattle で進める）。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, meleeUnreachable, stepBattle, unitById, RULES, type BattleState } from '../proto3d/src/battle/sim';
import { refusalText } from '../proto3d/src/battle/control';
import { openAllGates, takeMulIn } from '../proto3d/src/battle/fieldRules';
import { buildBattleSetup, getField } from '../proto3d/src/battle/fields';

const start = (id: string): BattleState => createBattle(buildBattleSetup(getField(id)!, 'standard'));
const runFor = (s: BattleState, sec: number) => {
    const end = s.t + sec;
    while (s.t < end - 1e-9 && !s.result) stepBattle(s, RULES.tick);
};
/** 敵の部隊を見えるようにする（状態を直接操作。命令の確かめのため） */
const seeAll = (s: BattleState) => {
    for (const u of s.units) if (u.side === 'enemy') u.seenBy.ally = true;
};

describe('道の無い相手への攻撃（状態を直接操作）', () => {
    it('城攻め前面：石川隊（槍）で西の櫓の弓を攻撃すると断られ、理由が出る。命令は前のまま。弓隊なら受ける', () => {
        const s = start('siege_front');
        seeAll(s);
        const ishi = unitById(s, 'a_ishikawa')!;
        const tower = unitById(s, 'e_tower_w')!;
        const before = ishi.order;
        expect(meleeUnreachable(s, ishi, tower)).toBe(true);
        expect(issueOrder(s, 'a_ishikawa', { type: 'attack', targetId: 'e_tower_w' })).toBe(false);
        expect(ishi.order).toEqual(before);
        expect(refusalText(s, 'a_ishikawa', { type: 'attack', targetId: 'e_tower_w' })).toBe(
            '敵勢の西の櫓の弓へは道が無く、斬りかかれません（石垣・櫓台・閉じた門の向こう）。弓なら届けば射られます',
        );
        // 騎馬・本陣も同じ。弓は射られるので受ける
        expect(issueOrder(s, 'a_kiba', { type: 'attack', targetId: 'e_tower_e' })).toBe(false);
        expect(issueOrder(s, 'a_ieyasu', { type: 'attack', targetId: 'e_tower_w' })).toBe(false);
        expect(issueOrder(s, 'a_yumi', { type: 'attack', targetId: 'e_tower_w' })).toBe(true);
        // 届く相手（門の前の出張り）への攻撃は今までどおり
        expect(issueOrder(s, 'a_ishikawa', { type: 'attack', targetId: 'e_sortie' })).toBe(true);
    });

    it('城攻め前面：閉じた門の向こうの門の裏の槍への攻撃は断る。門が開けば受ける', () => {
        const s = start('siege_front');
        seeAll(s);
        expect(issueOrder(s, 'a_tadakatsu', { type: 'attack', targetId: 'e_gate_guard' })).toBe(false);
        expect(refusalText(s, 'a_tadakatsu', { type: 'attack', targetId: 'e_gate_guard' })).toContain('道が無く');
        openAllGates(s.map, s.field);
        expect(issueOrder(s, 'a_tadakatsu', { type: 'attack', targetId: 'e_gate_guard' })).toBe(true);
    });

    it('既存の戦場（大平原・浅瀬の渡し）では判定しない（いつも false。1 刻みも同じ）', () => {
        for (const id of ['plains', 'river_ford', 'valley']) {
            const s = start(id);
            const a = s.units.find((u) => u.side === 'ally' && u.kind === 'yari')!;
            for (const e of s.units.filter((u) => u.side === 'enemy')) expect(meleeUnreachable(s, a, e), `${id} ${e.id}`).toBe(false);
        }
    });
});

describe('湿地の島に 4 部隊（早送り）', () => {
    it('1 つ目の島 (-95,112) の上へ 8 m おきに 4 部隊を送ると、150 秒にはどれも島（乾いた足場）の上で待機している。泥の中で止まらない', () => {
        const s = start('marsh');
        const ids = ['a_tadakatsu', 'a_sakai', 'a_sakakibara', 'a_kiba'];
        ids.forEach((id, i) => {
            runFor(s, 1);
            expect(issueOrder(s, id, { type: 'move', x: -107 + i * 8, z: 112 })).toBe(true);
        });
        runFor(s, 146);
        for (const id of ids) {
            const u = unitById(s, id)!;
            expect(u.order.type, id).toBe('hold');
            // 直しの前：忠勝隊 (-77.5,123.4)・酒井隊 (-94.1,130.4)・騎馬隊 (-76.6,105.1) が泥（受ける損害 ×1.15）の中で待機していた
            expect(takeMulIn(s.map, s.field, u.x, u.z), `${id} (${u.x.toFixed(1)},${u.z.toFixed(1)})`).toBe(1);
        }
    });
});

describe('取る目標は、敵がすべて崩れても果たすまで続く（状態を直接操作・早送り）', () => {
    const breakAll = (s: BattleState) => {
        for (const u of s.units) if (u.side === 'enemy') u.status = 'routed';
    };
    it('城攻め前面（段階目標：門の制圧 → 曲輪の確保）：敵をすべて敗走にしても勝ちにならず、「果たせば勝ち」を一度だけ知らせる', () => {
        const s = start('siege_front');
        runFor(s, 2);
        breakAll(s);
        runFor(s, 10);
        expect(s.result).toBeNull();
        const notes = s.events.filter((e) => e.kind === 'objective' && e.text.startsWith('敵の部隊はすべて崩れた'));
        expect(notes.map((e) => e.text)).toEqual(['敵の部隊はすべて崩れた。主目標「外門を制圧し、最初の曲輪を確保する」を果たせば勝ち（日没まで）']);
    });
    it('寺社周辺（二つの要所の同時確保）：同じく続く。守る目標の村落（屋敷前を守る）・城下町外縁（突破を抑える）は今までどおり勝ち', () => {
        const t = start('temple');
        runFor(t, 2);
        breakAll(t);
        runFor(t, 5);
        expect(t.result).toBeNull();
        // 村落は敵がすべて崩れたことで勝ち、城下町外縁は攻め手がすべて崩れたことで突破を抑える目標そのものを果たして勝ち
        for (const [id, reason] of [
            ['village', 'enemy_army_broken'],
            ['town_edge', 'objective_done'],
        ]) {
            const s = start(id!);
            runFor(s, 2);
            breakAll(s);
            runFor(s, 2);
            expect(s.result?.result, id).toBe('victory');
            expect(s.result?.reason, id).toBe(reason);
        }
    });
});
