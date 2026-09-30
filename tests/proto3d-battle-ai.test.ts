import { describe, expect, it } from 'vitest';
import { RULES, createBattle, issueOrder, runToEnd, stepBattle, unitById, type BattleState } from '../proto3d/src/battle/sim';
import { AI, AI_POLICY_ROLE, defaultAiRole } from '../proto3d/src/battle/ai';
import { GENERALS } from '../proto3d/src/battle/generals';
import { demoSetup } from '../proto3d/src/battle/maps';
import type { BattleMap, Side, UnitDef, UnitKind } from '../proto3d/src/battle/types';

const N = 0;
const S = Math.PI;
const FLAT: BattleMap = { id: 'flat', name: '平地', width: 400, depth: 400, terrain: [], exits: { ally: { x: 0, z: 200 }, enemy: { x: 0, z: -200 } } };

function U(id: string, side: Side, kind: UnitKind, x: number, z: number, facing: number, extra: Partial<UnitDef> = {}): UnitDef {
    return { id, side, clan: side === 'ally' ? 'kotosaka' : 'washio', kind, name: id, strength: 300, morale: 80, x, z, facing, ...extra };
}
function battle(units: UnitDef[], map: BattleMap = FLAT): BattleState {
    const hqs: UnitDef[] = [];
    if (!units.some((u) => u.side === 'ally' && u.kind === 'honjin')) hqs.push(U('a_hq', 'ally', 'honjin', 190, 195, N, { morale: 100 }));
    if (!units.some((u) => u.side === 'enemy' && u.kind === 'honjin')) hqs.push(U('e_hq', 'enemy', 'honjin', -190, -195, S, { morale: 100 }));
    return createBattle({ map, units: [...hqs, ...units], timeLimitSec: 900, briefing: [] });
}
const get = (s: BattleState, id: string) => unitById(s, id)!;
function advance(s: BattleState, sec: number) {
    for (let i = 0; i < Math.round(sec / RULES.tick); i++) stepBattle(s, RULES.tick);
}

describe('敵の考え：hold_line（持ち場を守る）', () => {
    it('こちらへ攻めて来る相手は、持ち場で待ち構える（打って出ない）', () => {
        const s = battle([U('line', 'enemy', 'yari', 0, 0, S, { aiRole: 'hold_line' }), U('y', 'ally', 'yari', 0, 100, N)]);
        issueOrder(s, 'y', { type: 'attack', targetId: 'line' });
        advance(s, 30);
        const line = get(s, 'line');
        expect(line.order.type).toBe('hold');
        expect(Math.hypot(line.x, line.z)).toBeLessThan(3);
        expect(line.engagedWith).toBe('y');
    });

    it('持ち場の前を横切る相手には打って出て、横から迎え撃つ', () => {
        const s = battle([U('line', 'enemy', 'yari', 0, 0, S, { aiRole: 'hold_line' }), U('k', 'ally', 'kiba', -170, 50, N), U('far', 'ally', 'yari', 150, 190, N)]);
        issueOrder(s, 'k', { type: 'move', x: 170, z: 50 });
        let attacked = false;
        for (let i = 0; i < 400 && !attacked; i++) {
            stepBattle(s, RULES.tick);
            const o = get(s, 'line').order;
            attacked = o.type === 'attack' && o.targetId === 'k';
        }
        expect(attacked).toBe(true);
        expect(s.events.some((e) => e.kind === 'ai' && e.text.includes('打って出た'))).toBe(true);
    });

    it('持ち場から離れすぎた相手は追わず、持ち場へ戻る', () => {
        const s = battle([U('line', 'enemy', 'yari', 0, 0, S, { aiRole: 'hold_line' }), U('k', 'ally', 'kiba', -60, 50, N), U('far', 'ally', 'yari', 150, 190, N)]);
        issueOrder(s, 'k', { type: 'move', x: -60, z: 190 });
        advance(s, 60);
        const line = get(s, 'line');
        expect(Math.hypot(line.x, line.z)).toBeLessThan(12);
        expect(line.order.type === 'hold' || line.order.type === 'move').toBe(true);
    });

    it('林の中の相手には気づかない（60 m 以内に来るまで）', () => {
        const woods: BattleMap = { ...FLAT, terrain: [{ kind: 'woods', rect: { x0: -200, x1: -20, z0: -200, z1: 200 } }] };
        const s = battle([U('line', 'enemy', 'yari', 40, 0, S, { aiRole: 'hold_line' }), U('k', 'ally', 'kiba', -30, 120, N)], woods);
        // 林の中を、持ち場から 70〜75 m の所を北へ抜ける（見えていれば迎え撃たれる距離）
        issueOrder(s, 'k', { type: 'move', x: -30, z: -150 });
        advance(s, 60);
        expect(get(s, 'k').seenBy.enemy).toBe(false);
        expect(get(s, 'line').order.type).toBe('hold');
    });

    it('矢を浴び続けると射手へ打って出る（誘い出せる）。近くに相手の槍がいれば持ち場を離れない', () => {
        const lure = battle([U('line', 'enemy', 'yari', 0, 0, S, { aiRole: 'hold_line' }), U('b', 'ally', 'yumi', 0, 100, N)]);
        advance(lure, AI.provokeSec + 3);
        const o = get(lure, 'line').order;
        expect(o.type === 'attack' && o.targetId === 'b').toBe(true);
        expect(lure.events.some((e) => e.text.includes('矢を嫌って打って出た'))).toBe(true);

        const calm = battle([U('line', 'enemy', 'yari', 0, 0, S, { aiRole: 'hold_line' }), U('b', 'ally', 'yumi', 0, 100, N), U('guard', 'ally', 'yari', 50, 70, N)]);
        advance(calm, AI.provokeSec + 10);
        expect(get(calm, 'line').order.type).toBe('hold');
    });
});

describe('敵の考え：flank・reserve・guard_hq', () => {
    it('flank：着いてから 30 秒待ち、自分の側を南へ下って、横から当たる', () => {
        const s = battle([U('fl', 'enemy', 'yari', 120, -100, S, { aiRole: 'flank' }), U('y', 'ally', 'yari', 0, 60, N), U('b', 'ally', 'yumi', 40, 80, N)]);
        advance(s, AI.flankDelay - 1);
        expect(get(s, 'fl').order.type).toBe('hold');
        advance(s, 2);
        const mv = get(s, 'fl').order;
        expect(mv.type).toBe('move');
        if (mv.type === 'move') expect(mv.x).toBeCloseTo(120);
        expect(s.events.some((e) => e.text.includes('回り込んでくる'))).toBe(true);
        let target: string | null = null;
        for (let i = 0; i < 1200 && !target; i++) {
            stepBattle(s, RULES.tick);
            const o = get(s, 'fl').order;
            if (o.type === 'attack') target = o.targetId;
        }
        // 槍の正面より、弓（横を向いている）を選ぶ
        expect(target).toBe('b');
    });

    it('reserve：何も起きないうちは動かず、本陣へ近づく相手が見えたら迎え撃つ', () => {
        const s = battle([
            U('e_hq', 'enemy', 'honjin', 0, -120, S, { aiRole: 'guard_hq' }),
            U('res', 'enemy', 'yari', 0, -170, S, { aiRole: 'reserve' }),
            U('k', 'ally', 'kiba', 150, 0, N),
        ]);
        advance(s, 60);
        expect(get(s, 'res').order.type).toBe('hold');
        expect(s.ai.memo.res.phase).toBe('idle');
        issueOrder(s, 'k', { type: 'move', x: 50, z: -120 });
        let o = get(s, 'res').order;
        for (let i = 0; i < 600 && o.type !== 'attack'; i++) {
            stepBattle(s, RULES.tick);
            o = get(s, 'res').order;
        }
        expect(o).toEqual({ type: 'attack', targetId: 'k' });
        expect(s.ai.memo.res.phase).toBe('active');
    });

    it('guard_hq の本陣は持ち場を動かない（攻めかかられても出て行かない）', () => {
        const s = battle([U('e_hq', 'enemy', 'honjin', 0, -100, S, { aiRole: 'guard_hq' }), U('y', 'ally', 'yari', 30, -40, N), U('far', 'ally', 'yari', 150, 190, N)]);
        issueOrder(s, 'y', { type: 'move', x: 30, z: -60 });
        for (let i = 0; i < 300; i++) {
            stepBattle(s, RULES.tick);
            expect(get(s, 'e_hq').order.type).not.toBe('attack');
        }
        const hq = get(s, 'e_hq');
        expect(Math.hypot(hq.x - 0, hq.z + 100)).toBeLessThan(12);
    });

    it('敵の考えは味方の部隊に命令しない（味方は待機のまま。敗走したときだけ退く）', () => {
        for (const al of ['tashiro', 'omori', 'alone'] as const) {
            const s = createBattle(demoSetup(al));
            runToEnd(s, (st) => {
                for (const u of st.units) {
                    if (u.side !== 'ally') continue;
                    if (u.status === 'ready') expect(u.order.type).toBe('hold');
                    else expect(u.order.type).toBe('retreat');
                }
            });
        }
    });
});

describe('敵の考え：役割を省いた部隊の既定の役割（武将の AI の基本方針から）', () => {
    it('本陣は guard_hq。武将のいない部隊は hold_line。武将の部隊は aiPolicy の役割（攻めかかる＝assault・持ち場を保つ＝hold_line・慎重に守る＝guard_hq・味方を支える＝reserve）', () => {
        expect(defaultAiRole({ kind: 'honjin', generalId: 'tadakatsu' })).toBe('guard_hq');
        expect(defaultAiRole({ kind: 'yari' })).toBe('hold_line');
        expect(AI_POLICY_ROLE).toEqual({ aggressive: 'assault', steady: 'hold_line', cautious: 'guard_hq', support: 'reserve' });
        for (const g of GENERALS) expect([g.id, defaultAiRole({ kind: 'yari', generalId: g.id })]).toEqual([g.id, AI_POLICY_ROLE[g.aiPolicy]]);
        // 同じ部隊でも、率いる武将の方針を変えれば動きが変わる（攻めかかる榊原＝相手の本陣へ攻め進む／持ち場を保つ酒井＝持ち場に残る）。
        // Version 13 候補で忠勝の方針を「持ち場を保つ」（前線維持・殿）に変えたので、攻めかかる例を忠勝から榊原に替えた
        const run = (generalId: string) => {
            const s = battle([U('e1', 'enemy', 'yari', 0, -100, S, { generalId })]);
            expect(s.ai.memo.e1!.role).toBe(defaultAiRole({ kind: 'yari', generalId }));
            advance(s, 20);
            return get(s, 'e1');
        };
        const aggressive = run('sakakibara');
        const steady = run('sakai');
        expect(Math.hypot(steady.x - 0, steady.z + 100)).toBeLessThan(1);
        // 相手（味方）の本陣 (190,195) の方へ進む
        expect(Math.hypot(aggressive.x - 190, aggressive.z - 195)).toBeLessThan(Math.hypot(0 - 190, -100 - 195) - 40);
        // 役割を書いた部隊は、武将の方針より役割が先
        const s = battle([U('e2', 'enemy', 'yari', 0, -100, S, { generalId: 'tadakatsu', aiRole: 'hold_line' })]);
        expect(s.ai.memo.e2!.role).toBe('hold_line');
    });
});
