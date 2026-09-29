/**
 * 特殊能力（battle/abilities.ts）と戦前の約束（sim.ts の pledge）の決まり。
 * 何もない平地で、同じ場面を「能力なし／あり」で比べ、能力が部隊の状態（士気・損害・動き・命令）を変えることを確かめる。
 * 一部は状態を直接変える（士気・兵・位置を書き換える）テスト。その旨をテスト名に書く。
 */
import { describe, expect, it } from 'vitest';
import {
    createBattle,
    issueOrder,
    meleeDamage,
    orderAllRetreat,
    orderLabel,
    pledgeProgress,
    runToEnd,
    stepBattle,
    unitById,
    type BattleState,
} from '../proto3d/src/battle/sim';
import {
    ABILITY_DATA,
    abilityDealMul,
    abilityInfo,
    abilityMarks,
    abilityMoraleLossMul,
    abilityTakeMul,
    isRooted,
    useAbility,
} from '../proto3d/src/battle/abilities';
import { demoSetup } from '../proto3d/src/battle/maps';
import type { AbilityId, BattleMap, BattleSetup, Side, UnitDef, UnitKind } from '../proto3d/src/battle/types';

const N = 0;
const S = Math.PI;
const FLAT: BattleMap = { id: 'flat', name: '平地', width: 400, depth: 400, terrain: [], exits: { ally: { x: 0, z: 200 }, enemy: { x: 0, z: -200 } } };

function U(id: string, side: Side, kind: UnitKind, x: number, z: number, facing: number, extra: Partial<UnitDef> = {}): UnitDef {
    return { id, side, clan: side === 'ally' ? 'tokugawa' : 'asai', kind, name: id, strength: 300, morale: 80, x, z, facing, ...extra };
}
function withAbility(ability: AbilityId, leaderId: string): Partial<UnitDef> {
    return { ability, leaderId };
}
/** 本陣を遠くに置いた設定（本陣の敗走で終わらないように。士気の支えも届かない所） */
function setup(units: UnitDef[], extra: Partial<BattleSetup> = {}): BattleSetup {
    const hqs: UnitDef[] = [];
    if (!units.some((u) => u.side === 'ally' && u.kind === 'honjin')) hqs.push(U('a_hq', 'ally', 'honjin', 190, 190, N, { morale: 100 }));
    if (!units.some((u) => u.side === 'enemy' && u.kind === 'honjin')) hqs.push(U('e_hq', 'enemy', 'honjin', -190, -190, S, { morale: 100 }));
    return { map: FLAT, units: [...hqs, ...units], timeLimitSec: 600, briefing: [], ...extra };
}
const get = (s: BattleState, id: string) => unitById(s, id)!;
function advance(s: BattleState, sec: number, each?: (s: BattleState) => void): void {
    const end = s.t + sec - 1e-9;
    while (s.t < end && !s.result) {
        each?.(s);
        stepBattle(s, 0.1);
    }
}

// ---------------------------------------------------------------- 家康「立て直しの号令」

/** 家康本陣（北 60 m）と、敵の槍に攻められている味方の槍 */
function rallyScene(): BattleSetup {
    return setup([
        U('a_hq', 'ally', 'honjin', 0, 100, N, { morale: 90, ...withAbility('ieyasu_rally', 'ieyasu') }),
        U('a_y', 'ally', 'yari', 0, 40, N, { morale: 70 }),
        U('e_y', 'enemy', 'yari', 0, 5, S, { strength: 600, morale: 90, order: { type: 'attack', targetId: 'a_y' } }),
    ]);
}

describe('立て直しの号令（家康本陣）', () => {
    it('使った瞬間、半径 90 m の味方の士気 +25（上限 100）。範囲外・敗走中の部隊は上がらない', () => {
        const s = createBattle(
            setup([
                U('a_hq', 'ally', 'honjin', 0, 100, N, { morale: 90, ...withAbility('ieyasu_rally', 'ieyasu') }),
                U('a_in', 'ally', 'yari', 0, 30, N, { morale: 50 }),
                U('a_out', 'ally', 'yari', 150, 100, N, { morale: 50 }),
            ]),
        );
        expect(useAbility(s, 'a_hq')).toEqual({ ok: true, reason: null });
        expect(get(s, 'a_in').morale).toBe(75);
        expect(get(s, 'a_out').morale).toBe(50);
        expect(get(s, 'a_hq').morale).toBe(100); // 90 + 25 → 上限 100
        expect(s.events[s.events.length - 1]).toMatchObject({ kind: 'ability', unitId: 'a_hq' });
        expect(abilityMarks(s, 'a_in')).toContain('号令');
        expect(abilityMarks(s, 'a_out')).toEqual([]);
    });

    it('効果中は、範囲内の味方の士気の低下が小さい（同じ場面の能力なしと比べて、30 秒後の士気が高い）', () => {
        const a = createBattle(rallyScene());
        const b = createBattle(rallyScene());
        advance(a, 5);
        advance(b, 5);
        expect(get(a, 'a_y').morale).toBe(get(b, 'a_y').morale);
        useAbility(b, 'a_hq');
        expect(abilityMoraleLossMul(b, get(b, 'a_y'))).toBeCloseTo(0.6);
        expect(abilityMoraleLossMul(a, get(a, 'a_y'))).toBe(1);
        const before = get(b, 'a_y').morale;
        advance(a, 25);
        advance(b, 25);
        const dropA = get(a, 'a_y').morale; // 能力なし
        const dropB = get(b, 'a_y').morale; // 能力あり
        expect(dropB).toBeGreaterThan(dropA + 25);
        // 低下の量そのものも小さい（+25 を差し引いても）
        expect(before - dropB).toBeLessThan((before - 25 - dropA) * 0.8);
    });

    it('（状態を直接変更）範囲内の味方は士気 12 でも敗走しない（線 15 → 8）。能力なしなら敗走する', () => {
        const a = createBattle(rallyScene());
        const b = createBattle(rallyScene());
        useAbility(b, 'a_hq');
        for (const s of [a, b]) get(s, 'a_y').morale = 12;
        advance(a, 0.1);
        advance(b, 0.1);
        expect(get(a, 'a_y').status).toBe('routed');
        expect(get(b, 'a_y').status).toBe('ready');
    });

    it('代償：効果中、家康本陣の与える損害 ×0.5・動き ×0.5', () => {
        const s = createBattle(rallyScene());
        const hq = get(s, 'a_hq');
        const e = get(s, 'e_y');
        hq.morale = 100; // （状態を直接変更）号令の士気 +25 で上限 100 になるので、損害の比べを士気 100 にそろえる
        const d0 = meleeDamage(s, hq, e, 'front');
        useAbility(s, 'a_hq');
        expect(hq.morale).toBe(100);
        expect(abilityDealMul(s, hq)).toBe(0.5);
        expect(meleeDamage(s, hq, e, 'front') / d0).toBeCloseTo(0.5);
        // 動き：同じ移動の命令で 10 秒に進む距離
        const moved = (use: boolean) => {
            const t = createBattle(setup([U('a_hq', 'ally', 'honjin', 0, 100, N, withAbility('ieyasu_rally', 'ieyasu'))]));
            if (use) useAbility(t, 'a_hq');
            issueOrder(t, 'a_hq', { type: 'move', x: 0, z: 0 });
            advance(t, 10);
            return 100 - get(t, 'a_hq').z;
        };
        expect(moved(true) / moved(false)).toBeCloseTo(0.5, 1);
    });

    it('失った兵・戦えない部隊は戻らない（全滅は全滅のまま、兵は増えない）', () => {
        const s = createBattle(
            setup([
                U('a_hq', 'ally', 'honjin', 0, 100, N, withAbility('ieyasu_rally', 'ieyasu')),
                U('a_gone', 'ally', 'yari', 0, 60, N, { strength: 0 }),
                U('a_hurt', 'ally', 'yari', 20, 60, N, { strength: 120 }),
            ]),
        );
        useAbility(s, 'a_hq');
        expect(get(s, 'a_gone').status).toBe('destroyed');
        expect(get(s, 'a_gone').strength).toBe(0);
        expect(get(s, 'a_hurt').strength).toBe(120);
        advance(s, 30);
        expect(get(s, 'a_gone').status).toBe('destroyed');
        expect(get(s, 'a_hurt').strength).toBeLessThanOrEqual(120);
    });
});

// ---------------------------------------------------------------- 本多忠勝「退路の守護」

/** 撤退中の味方（a_r）を敵の騎馬が追う。忠勝隊（t）はその退路の近く */
function rearguardScene(tadaAt: { x: number; z: number } = { x: 30, z: 60 }): BattleSetup {
    return setup([
        U('t', 'ally', 'yari', tadaAt.x, tadaAt.z, N, { strength: 450, morale: 85, ...withAbility('tadakatsu_rearguard', 'tadakatsu') }),
        U('a_r', 'ally', 'yari', 0, 40, S, { morale: 60, order: { type: 'retreat' } }),
        U('e_k', 'enemy', 'kiba', 0, 10, S, { strength: 300, morale: 90, order: { type: 'attack', targetId: 'a_r' } }),
    ]);
}

describe('退路の守護（本多忠勝隊）', () => {
    it('範囲内で退いている味方（撤退の命令・敗走中）の受ける損害 −50%・士気の低下 −50%。退いていない味方・範囲外には効かない', () => {
        const s = createBattle(rearguardScene());
        const r = get(s, 'a_r');
        const k = get(s, 'e_k');
        const d0 = meleeDamage(s, k, r, 'rear');
        expect(useAbility(s, 't').ok).toBe(true);
        expect(abilityTakeMul(s, r)).toBe(0.5);
        expect(meleeDamage(s, k, r, 'rear') / d0).toBeCloseTo(0.5);
        expect(abilityMoraleLossMul(s, r)).toBe(0.5);
        expect(abilityMarks(s, 'a_r')).toContain('退路の守り');
        // 撤退をやめた味方には効かない
        issueOrder(s, 'a_r', { type: 'hold' });
        expect(abilityTakeMul(s, r)).toBe(1);
        // （状態を直接変更）範囲外（70 m より遠く）へ置くと効かない
        issueOrder(s, 'a_r', { type: 'retreat' });
        r.x = 150;
        expect(abilityTakeMul(s, r)).toBe(1);
    });

    it('同じ場面で比べると、追われて退く味方の兵と士気が多く残り、敗走しにくい', () => {
        const a = createBattle(rearguardScene());
        const b = createBattle(rearguardScene());
        useAbility(b, 't');
        advance(a, 6);
        advance(b, 6);
        expect(get(b, 'a_r').strength).toBeGreaterThan(get(a, 'a_r').strength + 10);
        expect(get(b, 'a_r').morale).toBeGreaterThan(get(a, 'a_r').morale + 10);
        advance(a, 4);
        advance(b, 4);
        expect(get(a, 'a_r').status).toBe('routed');
        expect(get(b, 'a_r').status).toBe('ready');
    });

    it('代償：忠勝隊は動けない（移動・攻撃・撤退の命令を断る。待機は受ける）。受ける損害 ×1.15。無敵ではない', () => {
        const s = createBattle(rearguardScene());
        const t = get(s, 't');
        const k = get(s, 'e_k');
        const d0 = meleeDamage(s, k, t, 'front');
        issueOrder(s, 't', { type: 'move', x: 100, z: 100 });
        expect(useAbility(s, 't').ok).toBe(true);
        expect(t.order).toEqual({ type: 'hold' }); // 使った所で踏みとどまる
        expect(isRooted(s, 't')).toBe(true);
        expect(issueOrder(s, 't', { type: 'move', x: 0, z: 0 })).toBe(false);
        expect(issueOrder(s, 't', { type: 'retreat' })).toBe(false);
        expect(issueOrder(s, 't', { type: 'attack', targetId: 'e_k' })).toBe(false);
        expect(issueOrder(s, 't', { type: 'hold' })).toBe(true);
        expect(orderLabel(s, t)).toContain('踏みとどまる');
        expect(meleeDamage(s, k, t, 'front') / d0).toBeCloseTo(1.15);
        // 動かない（10 秒たっても同じ所）
        const x0 = t.x;
        const z0 = t.z;
        advance(s, 10);
        expect(Math.hypot(t.x - x0, t.z - z0)).toBeLessThan(3);
        // 40 秒で効果が終わり、また動ける
        advance(s, 31);
        expect(isRooted(s, 't')).toBe(false);
        expect(s.events.some((e) => e.kind === 'ability_end' && e.unitId === 't')).toBe(true);
        expect(issueOrder(s, 't', { type: 'move', x: 0, z: 0 })).toBe(true);
    });

    it('無敵ではない：効果中に攻められれば兵も士気も減る。（状態を直接変更）士気が尽きれば敗走し、効果も終わる', () => {
        const s = createBattle(
            setup([
                U('t', 'ally', 'yari', 0, 40, N, { strength: 200, morale: 60, ...withAbility('tadakatsu_rearguard', 'tadakatsu') }),
                U('e1', 'enemy', 'yari', 0, 18, S, { strength: 600, morale: 90, order: { type: 'attack', targetId: 't' } }),
                U('a_other', 'ally', 'yari', 150, 150, N), // 合戦が終わらないように
            ]),
        );
        useAbility(s, 't');
        advance(s, 15);
        const t = get(s, 't');
        expect(t.strength).toBeLessThan(180);
        expect(t.morale).toBeLessThan(60);
        t.morale = 10;
        advance(s, 0.1);
        expect(t.status).toBe('routed');
        expect(abilityInfo(s, 't')!.state).toBe('spent');
        advance(s, 0.1);
        expect(s.abilities.t.ended).toBe(true);
        expect(isRooted(s, 't')).toBe(false);
        expect(s.events.some((e) => e.kind === 'ability_end' && e.text.includes('崩れて'))).toBe(true);
    });

    it('全軍撤退を命じても、効果中は踏みとどまり、終わってから退く', () => {
        const s = createBattle(rearguardScene());
        useAbility(s, 't');
        orderAllRetreat(s);
        expect(get(s, 't').order.type).toBe('hold');
        expect(get(s, 'a_r').order.type).toBe('retreat');
        advance(s, 19);
        expect(get(s, 't').order.type).toBe('hold');
    });
});

// ---------------------------------------------------------------- 浅井長政「盟友への援護」

function supportScene(): BattleSetup {
    return setup([
        U('a_n', 'ally', 'yari', 0, 60, N, { clan: 'asai', strength: 400, ...withAbility('nagamasa_support', 'nagamasa') }),
        U('a_p', 'ally', 'yari', 40, 60, N, { strength: 400, morale: 75 }),
        U('a_far', 'ally', 'yari', -150, 60, N),
        U('e_y', 'enemy', 'yari', 40, 35, S, { strength: 500, morale: 90, order: { type: 'attack', targetId: 'a_p' } }),
    ]);
}

describe('盟友への援護（浅井長政隊）', () => {
    it('選んだ味方が 60 m 以内にいる間、受ける損害 −30%・士気の低下 −40%。長政隊の与える損害 ×0.8', () => {
        const s = createBattle(supportScene());
        const p = get(s, 'a_p');
        const e = get(s, 'e_y');
        const d0 = meleeDamage(s, e, p, 'front');
        const n0 = meleeDamage(s, get(s, 'a_n'), e, 'front');
        expect(useAbility(s, 'a_n', 'a_p')).toEqual({ ok: true, reason: null });
        expect(meleeDamage(s, e, p, 'front') / d0).toBeCloseTo(0.7);
        expect(abilityMoraleLossMul(s, p)).toBeCloseTo(0.6);
        expect(meleeDamage(s, get(s, 'a_n'), e, 'front') / n0).toBeCloseTo(0.8);
        expect(abilityMarks(s, 'a_p')).toEqual(['援護']);
    });

    it('同じ場面で比べると、支えられた部隊の兵と士気が多く残る', () => {
        const a = createBattle(supportScene());
        const b = createBattle(supportScene());
        useAbility(b, 'a_n', 'a_p');
        advance(a, 30);
        advance(b, 30);
        expect(get(b, 'a_p').strength).toBeGreaterThan(get(a, 'a_p').strength + 10);
        expect(get(b, 'a_p').morale).toBeGreaterThan(get(a, 'a_p').morale);
    });

    it('離れると外れ、戻れば再び効く。その間も時間は減り続け、45 秒で終わる', () => {
        const s = createBattle(
            setup([
                U('a_n', 'ally', 'yari', 0, 60, N, { clan: 'asai', ...withAbility('nagamasa_support', 'nagamasa') }),
                U('a_p', 'ally', 'yari', 40, 60, N),
            ]),
        );
        useAbility(s, 'a_n', 'a_p');
        const until = s.abilities.a_n.until;
        expect(until).toBeCloseTo(s.t + 45);
        issueOrder(s, 'a_p', { type: 'move', x: 140, z: 60 });
        advance(s, 20);
        const p = get(s, 'a_p');
        expect(Math.hypot(p.x - get(s, 'a_n').x, p.z - get(s, 'a_n').z)).toBeGreaterThan(60);
        expect(abilityTakeMul(s, p)).toBe(1);
        expect(abilityInfo(s, 'a_n')!.linked).toBe(false);
        expect(abilityMarks(s, 'a_p')).toEqual(['援護（離れて外れている）']);
        expect(s.events.some((e) => e.kind === 'ability' && e.text.includes('援護が外れた'))).toBe(true);
        issueOrder(s, 'a_p', { type: 'move', x: 30, z: 60 });
        advance(s, 20);
        expect(abilityTakeMul(s, get(s, 'a_p'))).toBe(0.7);
        expect(s.events.some((e) => e.kind === 'ability' && e.text.includes('援護がまた効く'))).toBe(true);
        expect(s.abilities.a_n.until).toBe(until); // 時間は延びない
        advance(s, 6);
        expect(abilityInfo(s, 'a_n')!.state).toBe('spent');
        expect(abilityTakeMul(s, get(s, 'a_p'))).toBe(1);
    });

    it('不適切な対象（なし・敵・自分・範囲外・戦えない・いない部隊）は断り、使用回数を減らさない', () => {
        const s = createBattle(supportScene());
        const bad: (string | undefined)[] = [undefined, 'e_y', 'a_n', 'a_far', 'nobody'];
        for (const t of bad) {
            const r = useAbility(s, 'a_n', t);
            expect(r.ok).toBe(false);
            expect(r.reason).toBeTruthy();
            expect(s.abilities.a_n.usedAt).toBeNull();
        }
        // （状態を直接変更）敗走中の部隊
        get(s, 'a_p').status = 'routed';
        expect(useAbility(s, 'a_n', 'a_p').ok).toBe(false);
        get(s, 'a_p').status = 'ready';
        expect(s.abilities.a_n.usedAt).toBeNull();
        expect(abilityInfo(s, 'a_n')!.validTargets).toEqual(['a_p']);
        expect(useAbility(s, 'a_n', 'a_p').ok).toBe(true);
    });

    it('近くに味方がいなければ「使えない」と理由を出す', () => {
        const s = createBattle(setup([U('a_n', 'ally', 'yari', 0, 60, N, withAbility('nagamasa_support', 'nagamasa'))]));
        const info = abilityInfo(s, 'a_n')!;
        expect(info.usable).toBe(false);
        expect(info.reason).toContain('60 m 以内');
    });
});

// ---------------------------------------------------------------- 共通の決まり

describe('能力の共通の決まり', () => {
    it('一時停止中（stepBattle を呼ばない間）に使っても、効果の時間は減らない。合戦の時間が進んだ分だけ減る', () => {
        const s = createBattle(rallyScene());
        advance(s, 5);
        useAbility(s, 'a_hq');
        const t0 = s.t;
        expect(abilityInfo(s, 'a_hq')!.remainingSec).toBe(30);
        // 指揮中：時間を進めない（0 秒の呼び出しも時間を進めない）
        stepBattle(s, 0);
        expect(s.t).toBe(t0);
        expect(abilityInfo(s, 'a_hq')!.remainingSec).toBe(30);
        expect(abilityInfo(s, 'a_hq')!.state).toBe('active');
        advance(s, 10);
        expect(abilityInfo(s, 'a_hq')!.remainingSec).toBeCloseTo(20, 5);
        advance(s, 20);
        expect(abilityInfo(s, 'a_hq')!.state).toBe('spent');
        expect(abilityInfo(s, 'a_hq')!.remainingSec).toBe(0);
    });

    it('連打しても重ねて発動しない（2 回目は断る。士気の上げは 1 回だけ）', () => {
        const s = createBattle(
            setup([U('a_hq', 'ally', 'honjin', 0, 100, N, { morale: 60, ...withAbility('ieyasu_rally', 'ieyasu') }), U('a_y', 'ally', 'yari', 0, 60, N, { morale: 40 })]),
        );
        expect(useAbility(s, 'a_hq').ok).toBe(true);
        const usedAt = s.abilities.a_hq.usedAt;
        const again = useAbility(s, 'a_hq');
        expect(again.ok).toBe(false);
        expect(again.reason).toContain('効果中');
        expect(useAbility(s, 'a_hq').ok).toBe(false);
        expect(get(s, 'a_y').morale).toBe(65);
        expect(s.abilities.a_hq.usedAt).toBe(usedAt);
        expect(s.events.filter((e) => e.kind === 'ability')).toHaveLength(1);
        advance(s, 31);
        const late = useAbility(s, 'a_hq');
        expect(late.ok).toBe(false);
        expect(late.reason).toContain('もう使った');
    });

    it('使えない時は断り、使用回数を減らさない：まだ着いていない・敗走中・合戦の後', () => {
        const s = createBattle(
            setup([
                U('a_hq', 'ally', 'honjin', 0, 100, N, withAbility('ieyasu_rally', 'ieyasu')),
                U('t', 'ally', 'yari', 0, 60, N, { arriveAt: 30, ...withAbility('tadakatsu_rearguard', 'tadakatsu') }),
            ], { timeLimitSec: 40 }),
        );
        expect(useAbility(s, 't').reason).toContain('着いていない');
        expect(abilityInfo(s, 't')!.usable).toBe(false);
        expect(s.abilities.t.usedAt).toBeNull();
        // （状態を直接変更）敗走中
        get(s, 'a_hq').status = 'routed';
        expect(useAbility(s, 'a_hq').reason).toContain('敗走');
        get(s, 'a_hq').status = 'ready';
        expect(s.abilities.a_hq.usedAt).toBeNull();
        runToEnd(s);
        expect(useAbility(s, 'a_hq').reason).toContain('終わった');
        expect(s.abilities.a_hq.usedAt).toBeNull();
    });

    it('能力のない部隊・武将のいない部隊は能力を持たない（説明は null、使えない）', () => {
        const s = createBattle(setup([U('a_y', 'ally', 'yari', 0, 60, N), U('a_x', 'ally', 'yari', 30, 60, N, { ability: 'ieyasu_rally' })]));
        expect(abilityInfo(s, 'a_y')).toBeNull();
        expect(abilityInfo(s, 'a_x')).toBeNull();
        expect(useAbility(s, 'a_y').ok).toBe(false);
        expect(useAbility(s, 'a_x').ok).toBe(false);
    });

    it('説明：能力名・対象・範囲・効果・代償・使えるか・ゲーム用の創作の断り書き', () => {
        const s = createBattle(rearguardScene());
        const info = abilityInfo(s, 't')!;
        expect(info).toMatchObject({ id: 'tadakatsu_rearguard', name: '退路の守護', target: 'self_area', range: 70, durationSec: 40, controllable: true, usable: true, reason: null, state: 'unused' });
        expect(info.effectText).toContain('−50%');
        expect(info.costText).toContain('動けない');
        expect(info.costText).toContain('無敵ではない');
        expect(info.note).toContain('ゲーム用の創作');
        for (const d of Object.values(ABILITY_DATA)) {
            expect(d.name).toBeTruthy();
            expect(d.targetText && d.effectText && d.costText).toBeTruthy();
        }
    });

    it('敵方の能力は、プレイヤーの操作（useAbility）では使えない。敵の考えが使う', () => {
        const s = createBattle(
            setup([
                U('e_n', 'enemy', 'honjin', 0, -100, S, { ...withAbility('nagamasa_support', 'nagamasa') }),
                U('e_s', 'enemy', 'yari', 0, -50, S, { aiRole: 'hold_line' }),
                U('a_y', 'ally', 'yari', 0, 0, N, { strength: 400, order: { type: 'attack', targetId: 'e_s' } }),
            ]),
        );
        expect(useAbility(s, 'e_n', 'e_s').ok).toBe(false);
        expect(abilityInfo(s, 'e_n')!.controllable).toBe(false);
        advance(s, 20);
        expect(s.abilities.e_n.usedAt).not.toBeNull();
        expect(s.abilities.e_n.targetId).toBe('e_s');
    });

    it('能力も約束もない合戦（架空の第一章）では、状態も結果の形も変わらない', () => {
        const s = createBattle(demoSetup('alone'));
        expect(s.abilityList).toEqual([]);
        expect(s.pledge).toBeNull();
        const r = runToEnd(s);
        expect('abilitiesUsed' in r).toBe(false);
        expect('pledge' in r).toBe(false);
        expect(pledgeProgress(s)).toBeNull();
    });
});

// ---------------------------------------------------------------- 戦前の約束

const ZONE = { cx: 0, cz: 150, r: 30 };
function pledgeScene(extra: Partial<UnitDef> = {}, timeLimitSec = 600): BattleSetup {
    return setup([U('a_t', 'ally', 'yari', 0, 60, N, { strength: 400, ...extra })], {
        timeLimitSec,
        pledge: { targetId: 'a_t', safeZone: ZONE, holdSec: 20, minStrengthRatio: 0.4 },
    });
}

describe('戦前の約束（達成の判定）', () => {
    it('安全地点に一瞬触れただけでは満たさない（出ると数え直し）。20 秒続けてとどまると満たす', () => {
        const s = createBattle(pledgeScene());
        issueOrder(s, 'a_t', { type: 'move', x: 0, z: 125 });
        while (!pledgeProgress(s)!.inZone) advance(s, 0.1);
        advance(s, 5);
        expect(pledgeProgress(s)!.zoneSec).toBeGreaterThan(4);
        issueOrder(s, 'a_t', { type: 'move', x: 0, z: 60 });
        advance(s, 12);
        const p = pledgeProgress(s)!;
        expect(p.inZone).toBe(false);
        expect(p.zoneSec).toBe(0);
        expect(p.secured).toBe(false);
        issueOrder(s, 'a_t', { type: 'move', x: 0, z: 140 });
        advance(s, 60);
        expect(pledgeProgress(s)!.secured).toBe(true);
        expect(s.events.some((e) => e.kind === 'pledge' && e.text.includes('20 秒持ちこたえた'))).toBe(true);
    });

    it('撤退の命令で退き口から離れ、兵が 40% 以上なら守れた', () => {
        const s = createBattle(pledgeScene());
        issueOrder(s, 'a_t', { type: 'retreat' });
        advance(s, 60);
        expect(get(s, 'a_t').status).toBe('withdrawn');
        expect(pledgeProgress(s)!.withdrew).toBe(true);
        orderAllRetreat(s);
        const r = runToEnd(s);
        expect(r.pledge).toEqual({ targetId: 'a_t', result: 'kept' });
    });

    it('合戦の終わりに戦えていて兵が 40% 以上なら守れた（日没）', () => {
        const r = runToEnd(createBattle(pledgeScene({}, 30)));
        expect(r.reason).toBe('nightfall');
        expect(r.pledge?.result).toBe('kept');
    });

    it('（状態を直接変更）兵が 40% を下回れば、安全地点にいても守れなかった', () => {
        const s = createBattle(pledgeScene({}, 60));
        issueOrder(s, 'a_t', { type: 'move', x: 0, z: 140 });
        advance(s, 50);
        expect(pledgeProgress(s)!.secured).toBe(true);
        get(s, 'a_t').strength = 150; // 37.5%
        expect(pledgeProgress(s)!.onTrack).toBe(false);
        expect(runToEnd(s).pledge?.result).toBe('broken');
    });

    it('（状態を直接変更）対象が敗走すれば、前に安全地点を満たしていても守れなかった', () => {
        const s = createBattle(pledgeScene({}, 120));
        issueOrder(s, 'a_t', { type: 'move', x: 0, z: 140 });
        advance(s, 50);
        expect(pledgeProgress(s)!.secured).toBe(true);
        get(s, 'a_t').morale = 5;
        advance(s, 0.1);
        expect(get(s, 'a_t').status).toBe('routed');
        expect(pledgeProgress(s)!.failed).toBe(true);
        expect(s.events.some((e) => e.kind === 'pledge' && e.text.includes('果たせない'))).toBe(true);
        expect(runToEnd(s).pledge?.result).toBe('broken');
    });

    it('対象が全滅すれば守れなかった', () => {
        const s = createBattle(
            setup([U('a_t', 'ally', 'yumi', 0, 60, N, { strength: 60, morale: 100 }), U('e_k', 'enemy', 'kiba', 0, 30, S, { strength: 400, morale: 100, order: { type: 'attack', targetId: 'a_t' } })], {
                timeLimitSec: 120,
                pledge: { targetId: 'a_t', safeZone: ZONE, holdSec: 20, minStrengthRatio: 0.4 },
            }),
        );
        const r = runToEnd(s);
        expect(['routed', 'destroyed']).toContain(r.units.find((u) => u.id === 'a_t')!.status);
        expect(r.pledge?.result).toBe('broken');
    });

    it('約束の対象は味方の部隊に限る', () => {
        expect(() =>
            createBattle(setup([U('e_x', 'enemy', 'yari', 0, -60, S)], { pledge: { targetId: 'e_x', safeZone: ZONE, holdSec: 20, minStrengthRatio: 0.4 } })),
        ).toThrow();
    });
});
