/**
 * 特殊能力（battle/abilities.ts）と戦前の約束（sim.ts の pledge）の決まり。
 * 何もない平地で、同じ場面を「能力なし／あり」で比べ、能力が部隊の状態（士気・損害・動き・命令）を変えることを確かめる。
 * 一部は状態を直接変える（士気・兵・位置を書き換える）テスト。その旨をテスト名に書く。
 *
 * Version 13 候補（docs/troops-abilities-design.md §2）で家康・忠勝の能力の数値を強めたので、数値を確かめる所を新しい値に直した：
 * - 立て直しの号令：半径 90 → 110 m、30 → 35 秒、士気 +25（最初の士気まで）→ +40（上限 100）、低下 −40% → −60%、
 *   敗走の線 15 → 8 → 「士気 20 未満に下がらず、敗走しない」、代償の与える損害 ×0.5 → ×0.3（動き ×0.5 は同じ）。
 * - 退路の守護：半径 70 → 100 m、40 → 50 秒、退く味方の損害・士気の低下 −50% → −80%、忠勝隊の受ける損害 ×1.15 → ×1.4、引きつけを足した。
 * 盟友への援護（長政）は変えていない。
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
        U('a_y', 'ally', 'yari', 0, 40, N, { morale: 95 }),
        U('e_y', 'enemy', 'yari', 0, 5, S, { strength: 600, morale: 90, order: { type: 'attack', targetId: 'a_y' } }),
    ]);
}

describe('立て直しの号令（家康本陣）', () => {
    it('（状態を直接変更）使った瞬間、半径 110 m の味方の士気 +40（上限 100）。範囲外の部隊は上がらない', () => {
        const s = createBattle(
            setup([
                U('a_hq', 'ally', 'honjin', 0, 100, N, { morale: 90, ...withAbility('ieyasu_rally', 'ieyasu') }),
                U('a_in', 'ally', 'yari', 0, 30, N, { morale: 80 }),
                U('a_out', 'ally', 'yari', 150, 100, N, { morale: 80 }),
                U('a_full', 'ally', 'yumi', 40, 80, N, { morale: 75 }),
            ]),
        );
        get(s, 'a_in').morale = 50;
        get(s, 'a_out').morale = 50;
        get(s, 'a_hq').morale = 70;
        expect(useAbility(s, 'a_hq')).toEqual({ ok: true, reason: null });
        expect(get(s, 'a_in').morale).toBe(90);
        expect(get(s, 'a_out').morale).toBe(50); // 家康本陣から 150 m（110 m の外）
        expect(get(s, 'a_hq').morale).toBe(100); // 70 + 40 → 上限 100
        expect(get(s, 'a_full').morale).toBe(100); // 下がっていない部隊も上がる（最初の士気 75 より上へ。上限 100）
        expect(s.events[s.events.length - 1]).toMatchObject({ kind: 'ability', unitId: 'a_hq' });
        expect(abilityMarks(s, 'a_in')).toContain('号令');
        expect(abilityMarks(s, 'a_out')).toEqual([]);
    });

    it('効果中は、範囲内の味方の士気の低下が小さい（同じ場面の能力なしと比べて、25 秒後の士気が高い）', () => {
        const a = createBattle(rallyScene());
        const b = createBattle(rallyScene());
        advance(a, 5);
        advance(b, 5);
        expect(get(a, 'a_y').morale).toBe(get(b, 'a_y').morale);
        // （状態を直接変更）攻められて士気が下がった所（号令で 60 → 100）
        for (const x of [a, b]) get(x, 'a_y').morale = 60;
        useAbility(b, 'a_hq');
        expect(get(b, 'a_y').morale).toBe(100);
        expect(abilityMoraleLossMul(b, get(b, 'a_y'))).toBeCloseTo(0.4);
        expect(abilityMoraleLossMul(a, get(a, 'a_y'))).toBe(1);
        const before = get(b, 'a_y').morale;
        advance(a, 25);
        advance(b, 25);
        const dropA = get(a, 'a_y').morale; // 能力なし
        const dropB = get(b, 'a_y').morale; // 能力あり
        expect(dropB).toBeGreaterThan(dropA + 40);
        // 低下の量そのものも小さい（+40 を差し引いても。能力なしの低下の 6 割より小さい）
        expect(before - dropB).toBeLessThan((before - 40 - dropA) * 0.6);
    });

    it('（状態を直接変更）範囲内の味方は士気 12 でも敗走しない（効果中は士気で敗走しない）。能力なしなら敗走する', () => {
        const a = createBattle(rallyScene());
        const b = createBattle(rallyScene());
        useAbility(b, 'a_hq');
        for (const s of [a, b]) get(s, 'a_y').morale = 12;
        advance(a, 0.1);
        advance(b, 0.1);
        expect(get(a, 'a_y').status).toBe('routed');
        expect(get(b, 'a_y').status).toBe('ready');
        expect(get(b, 'a_y').morale).toBeGreaterThanOrEqual(12);
    });

    it('効果中は、範囲内の味方の士気が 20 未満に下がらない（攻められ続けても。能力なしなら崩れる）。35 秒で切れる', () => {
        const a = createBattle(rallyScene());
        const b = createBattle(rallyScene());
        // （状態を直接変更）押されて士気が 25 まで落ちた所（号令で 65 へ）
        for (const x of [a, b]) get(x, 'a_y').morale = 25;
        useAbility(b, 'a_hq');
        let low = 100;
        advance(a, 34);
        advance(b, 34, (x) => (low = Math.min(low, get(x, 'a_y').morale)));
        expect(low).toBeGreaterThanOrEqual(20);
        expect(get(b, 'a_y').status).toBe('ready');
        expect(get(a, 'a_y').status).toBe('routed');
        expect(abilityInfo(b, 'a_hq')!.state).toBe('active');
        advance(b, 1.1);
        expect(abilityInfo(b, 'a_hq')!.state).toBe('spent');
    });

    // ---- 号令の直し（docs/fields-group2-design.md §1）：兵が最初の 3 割（routGuardMinStrength）を切った部隊は守りが外れる。号令で支えていた
    // 士気（+40・低下の軽減・士気の床）も外れ、号令が無かったときの士気の見積もり（UnitState.rallyShadow）まで下がり、普通の決まりで見る ----

    /** routGuardMinStrength を一時的に変えて fn を走らせる（調整できるデータであることの確かめ。終わったら戻す） */
    function withGuard<T>(ratio: number, fn: () => T): T {
        const d = ABILITY_DATA.ieyasu_rally as { routGuardMinStrength: number };
        const keep = d.routGuardMinStrength;
        d.routGuardMinStrength = ratio;
        try {
            return fn();
        } finally {
            d.routGuardMinStrength = keep;
        }
    }
    /**
     * 号令を 0 秒に使い（use が false なら使わない）、a_y（兵 300）が正面の槍 600・横の騎馬 400 に斬られて敗走・全滅するまで
     * （最長 35 秒＝効果の間）進める。そのときの兵と状態、守りが外れた知らせの時刻（確かめた時の値）：
     * - 号令なし：13.6 秒に兵 86.0 で敗走（士気が尽きる）。
     * - 下限なし（直す前）：20.9 秒に全滅（士気の床で崩れない）。
     * - 0.3（最初の直し。守りが外れたら士気に関係なく敗走）：13.2 秒に兵 89.8 で敗走。
     * - 0.3（今。号令で支えていた士気も外す）：13.2 秒に守りが外れて士気 100 → 16（号令が無かったときの見積もり。号令なしの 13.0 秒は 16.4）、
     *   13.8 秒に兵 85.9 で敗走（号令なしとほぼ同じ）。
     * - 0.5：9.3 秒に守りが外れる（見積もりの士気はまだ敗走の線より上）。その後は普通の決まりで、13.8 秒に敗走。
     */
    function rallyUntilBreak(use = true): { status: string; strength: number; t: number; text: string; offT: number } {
        const s = createBattle(
            setup([
                U('a_hq', 'ally', 'honjin', 0, 100, N, { morale: 90, ...withAbility('ieyasu_rally', 'ieyasu') }),
                U('a_y', 'ally', 'yari', 0, 40, N, { morale: 95 }),
                U('e_y', 'enemy', 'yari', 0, 5, S, { strength: 600, morale: 90, order: { type: 'attack', targetId: 'a_y' } }),
                U('e_k', 'enemy', 'kiba', -40, 40, Math.PI / 2, { strength: 400, morale: 90, order: { type: 'attack', targetId: 'a_y' } }),
            ]),
        );
        if (use) useAbility(s, 'a_hq');
        const y = get(s, 'a_y');
        advance(s, 35);
        const end = s.events.find((e) => (e.kind === 'rout' || e.kind === 'destroyed') && e.unitId === 'a_y');
        const off = s.events.find((e) => e.kind === 'ability' && e.unitId === 'a_y' && e.text.includes('号令の守りが外れた'));
        return { status: y.status, strength: y.strength, t: end?.t ?? -1, text: end?.text ?? '', offT: off?.t ?? -1 };
    }

    it('既定の値：兵が最初の 3 割（0.3）を切った部隊は守りが外れる（ABILITY_DATA.ieyasu_rally.routGuardMinStrength）。ほかの能力は下限なし', () => {
        expect(ABILITY_DATA.ieyasu_rally.routGuardMinStrength).toBe(0.3);
        for (const id of Object.keys(ABILITY_DATA) as AbilityId[]) if (id !== 'ieyasu_rally') expect(ABILITY_DATA[id].routGuardMinStrength).toBe(0);
    });

    it('早送り：正面と横から斬られ続けても、効果中に兵が 3 割を切ると守りが外れて敗走し、全滅するまで戦わない（下限なし＝直す前は効果中に全滅する）', () => {
        const before = withGuard(0, () => rallyUntilBreak());
        expect(before.status).toBe('destroyed');
        expect(before.t).toBeLessThan(35);
        const after = rallyUntilBreak();
        expect(after.status).toBe('routed');
        expect(after.t).toBeLessThan(before.t);
        // 3 割（90）を切った刻みに守りが外れ（号令で支えていた士気も外れる）、間もなく敗走する。兵は残る
        expect(after.offT).toBeGreaterThan(0);
        expect(after.t - after.offT).toBeLessThan(2);
        expect(after.strength).toBeGreaterThan(0);
        expect(after.strength).toBeLessThan(90);
        // 号令を使わない時とほぼ同じ所で崩れる（号令が無ければ崩れていた部隊。号令のせいで早く崩れるわけではない）
        const none = rallyUntilBreak(false);
        expect(none.status).toBe('routed');
        expect(Math.abs(after.t - none.t)).toBeLessThan(1);
        expect(Math.abs(after.strength - none.strength)).toBeLessThan(5);
    });

    it('早送り：下限は調整できるデータ。0.5 にすると、兵が 5 割を切った所で（3 割より早く）守りが外れる（その後は普通の決まりで、士気が尽きて敗走する）', () => {
        const at03 = rallyUntilBreak();
        const at05 = withGuard(0.5, () => rallyUntilBreak());
        expect(at05.offT).toBeGreaterThan(0);
        expect(at05.offT).toBeLessThan(at03.offT);
        expect(at05.status).toBe('routed');
        expect(at05.strength).toBeGreaterThan(0);
        // 守りが外れた時の見積もりの士気はまだ敗走の線より上なので、号令を使わない時とほぼ同じ所まで戦って崩れる
        expect(Math.abs(at05.t - rallyUntilBreak(false).t)).toBeLessThan(1);
    });

    /**
     * 士気が自前で高い部隊（a_y：兵 92＝最初の 30.7%・士気 99）が弱い敵の槍 150 に斬られて 3 割を切る。号令を使うか（use）で比べる。
     * 返すのは、3 割を切ってから 3 秒後の状態・士気と、守りが外れた知らせの有無・決着
     */
    function highMoraleBreak(use: boolean, hq = false): { status: string; morale: number; off: boolean; result: string | null } {
        const target = hq ? 'a_hq' : 'a_y';
        const s = createBattle(
            setup([
                U('a_hq', 'ally', 'honjin', 0, 100, N, { morale: 99, ...withAbility('ieyasu_rally', 'ieyasu') }),
                U('a_y', 'ally', 'yari', 0, 40, N, { morale: 99 }),
                U('e_y', 'enemy', 'yari', hq ? 0 : 0, hq ? 70 : 10, S, { strength: 150, morale: 90, order: { type: 'attack', targetId: target } }),
            ]),
        );
        const u = get(s, target);
        u.strength = u.startStrength * 0.307;
        if (use) useAbility(s, 'a_hq');
        let crossed = -1;
        // 3 割を切ってから 3 秒まで（または決着まで）
        while (!s.result && (crossed < 0 || s.t < crossed + 3) && s.t < 60) {
            stepBattle(s, 0.1);
            if (crossed < 0 && u.strength < u.startStrength * 0.3) crossed = s.t;
        }
        return {
            status: u.status,
            morale: u.morale,
            off: s.events.some((e) => e.kind === 'ability' && e.unitId === target && e.text.includes('号令の守りが外れた')),
            result: s.result?.result ?? null,
        };
    }

    it('早送り：士気が自前で高い部隊は、効果中に兵が 3 割を切っても崩れない（守りが外れて普通の決まりで戦う＝号令を使わない時と同じ。号令のせいで崩れない）', () => {
        const on = highMoraleBreak(true);
        const off = highMoraleBreak(false);
        // 確かめた時の値：3 割を切って 3 秒後、号令あり 士気 97.3・号令なし 97.3、どちらも戦える（最初の直しでは、切った刻みに士気 99 のまま敗走した）
        expect(on.off).toBe(true);
        expect(off.off).toBe(false);
        expect(on.status).toBe('ready');
        expect(off.status).toBe('ready');
        expect(Math.abs(on.morale - off.morale)).toBeLessThan(3);
    });

    it('早送り：家康本陣も同じ扱い。斬り合っていて兵が 3 割を切っても、士気が自前で高ければその場で崩れず、負けにならない（号令を使わない時と同じ）', () => {
        const on = highMoraleBreak(true, true);
        const off = highMoraleBreak(false, true);
        // 確かめた時の値：3 割を切って 3 秒後、号令あり 士気 94.0・号令なし 94.0、どちらも崩れず決着なし（最初の直しでは、切った刻みに
        // 「崩れた！（兵が減り、号令でも支えきれない）」となり、本陣の崩れでその場で負けた）
        expect(on.off).toBe(true);
        expect(on.status).toBe('ready');
        expect(off.status).toBe('ready');
        expect(on.result).toBeNull();
        expect(off.result).toBeNull();
        expect(Math.abs(on.morale - off.morale)).toBeLessThan(3);
    });

    it('（状態を直接変更）兵が 3 割以上の部隊は今までどおり守られる（士気 12 でも敗走しない・士気の低下 −60%・印「号令」）', () => {
        const s = createBattle(rallyScene());
        useAbility(s, 'a_hq');
        const y = get(s, 'a_y');
        y.strength = 95; // 最初の 300 の 31.7%
        y.morale = 12;
        expect(abilityMoraleLossMul(s, y)).toBeCloseTo(0.4);
        expect(abilityMarks(s, 'a_y')).toContain('号令');
        advance(s, 0.1);
        // この刻みの損害で 3 割（90）を切らなければ、守られたまま
        if (y.strength >= 90) {
            expect(y.status).toBe('ready');
            expect(y.morale).toBeGreaterThanOrEqual(12);
        }
    });

    it('（状態を直接変更）兵が 3 割未満の部隊には号令が効かない：士気 +40 も上がらず、士気が低ければ普通の決まりで敗走する。印も出ない', () => {
        const s = createBattle(
            setup([
                U('a_hq', 'ally', 'honjin', 0, 100, N, { morale: 90, ...withAbility('ieyasu_rally', 'ieyasu') }),
                U('a_weak', 'ally', 'yari', 0, 40, N, { morale: 95 }),
                U('a_ok', 'ally', 'yari', 30, 40, N, { morale: 95 }),
            ]),
        );
        const weak = get(s, 'a_weak');
        const ok = get(s, 'a_ok');
        weak.strength = 80; // 26.7%
        ok.strength = 100; // 33.3%
        weak.morale = 30;
        ok.morale = 30;
        useAbility(s, 'a_hq');
        expect(weak.morale).toBe(30);
        expect(ok.morale).toBe(70);
        expect(abilityMarks(s, 'a_weak')).toEqual([]);
        expect(abilityMarks(s, 'a_ok')).toContain('号令');
        expect(abilityMoraleLossMul(s, weak)).toBe(1);
        weak.morale = 12;
        ok.morale = 12;
        advance(s, 0.1);
        expect(weak.status).toBe('routed');
        expect(ok.status).toBe('ready');
    });

    it('画面の説明が処理と一致：短い説明に「兵が 3 割を切った部隊は守りが外れる」、長い説明に号令で支えた士気も外れ、号令が無ければ崩れていた部隊は敗走する旨（値を変えれば短い説明も変わる）', () => {
        const s = createBattle(rallyScene());
        const info = abilityInfo(s, 'a_hq')!;
        expect(info.effectText).toContain('3 割を切った部隊には効かず');
        expect(info.effectText).toContain('号令で支えた士気も外れ');
        expect(info.effectText).toContain('号令が無ければ崩れていた部隊はその場で敗走');
        expect(info.short.effect).toContain('兵が 3 割を切った部隊は守りが外れる');
        expect(info.short.effect).not.toContain('敗走しない');
        withGuard(0.25, () => expect(abilityInfo(s, 'a_hq')!.short.effect).toContain('兵が 25%を切った部隊は守りが外れる'));
    });

    it('代償：効果中、家康本陣の与える損害 ×0.3・動き ×0.5', () => {
        const s = createBattle(rallyScene());
        const hq = get(s, 'a_hq');
        const e = get(s, 'e_y');
        hq.morale = 100; // （状態を直接変更）号令の士気 +40 で上限 100 になるので、損害の比べを士気 100 にそろえる
        const d0 = meleeDamage(s, hq, e, 'front');
        useAbility(s, 'a_hq');
        expect(hq.morale).toBe(100);
        expect(abilityDealMul(s, hq)).toBe(0.3);
        expect(meleeDamage(s, hq, e, 'front') / d0).toBeCloseTo(0.3);
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
    it('範囲内で退いている味方（撤退の命令・敗走中）の受ける損害 −80%・士気の低下 −80%。退いていない味方・範囲外には効かない', () => {
        const s = createBattle(rearguardScene());
        const r = get(s, 'a_r');
        const k = get(s, 'e_k');
        const d0 = meleeDamage(s, k, r, 'rear');
        expect(useAbility(s, 't').ok).toBe(true);
        expect(abilityTakeMul(s, r)).toBe(0.2);
        expect(meleeDamage(s, k, r, 'rear') / d0).toBeCloseTo(0.2);
        expect(abilityMoraleLossMul(s, r)).toBe(0.2);
        expect(abilityMarks(s, 'a_r')).toContain('退路の守り');
        // 撤退をやめた味方には効かない
        issueOrder(s, 'a_r', { type: 'hold' });
        expect(abilityTakeMul(s, r)).toBe(1);
        // （状態を直接変更）範囲外（100 m より遠く）へ置くと効かない
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

    it('代償：忠勝隊は動けない（移動・攻撃・撤退の命令を断る。待機は受ける）。受ける損害 ×1.4。無敵ではない', () => {
        // 騎馬が忠勝隊に引きつけられて崩れても合戦が終わらないように、遠くに敵の槍を 1 つ足す
        const sc = rearguardScene();
        sc.units.push(U('e_far', 'enemy', 'yari', -150, -150, S));
        const s = createBattle(sc);
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
        expect(meleeDamage(s, k, t, 'front') / d0).toBeCloseTo(1.4);
        // 動かない（10 秒たっても同じ所）
        const x0 = t.x;
        const z0 = t.z;
        advance(s, 10);
        expect(Math.hypot(t.x - x0, t.z - z0)).toBeLessThan(3);
        // 50 秒で効果が終わり、また動ける
        advance(s, 41);
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
        expect(abilityInfo(s, 'a_hq')!.remainingSec).toBe(35);
        // 指揮中：時間を進めない（0 秒の呼び出しも時間を進めない）
        stepBattle(s, 0);
        expect(s.t).toBe(t0);
        expect(abilityInfo(s, 'a_hq')!.remainingSec).toBe(35);
        expect(abilityInfo(s, 'a_hq')!.state).toBe('active');
        advance(s, 10);
        expect(abilityInfo(s, 'a_hq')!.remainingSec).toBeCloseTo(25, 5);
        advance(s, 25);
        expect(abilityInfo(s, 'a_hq')!.state).toBe('spent');
        expect(abilityInfo(s, 'a_hq')!.remainingSec).toBe(0);
    });

    it('連打しても重ねて発動しない（2 回目は断る。士気の上げは 1 回だけ）', () => {
        const s = createBattle(
            setup([U('a_hq', 'ally', 'honjin', 0, 100, N, { morale: 60, ...withAbility('ieyasu_rally', 'ieyasu') }), U('a_y', 'ally', 'yari', 0, 60, N, { morale: 80 })]),
        );
        get(s, 'a_y').morale = 40; // （状態を直接変更）下がった士気
        expect(useAbility(s, 'a_hq').ok).toBe(true);
        const usedAt = s.abilities.a_hq.usedAt;
        const again = useAbility(s, 'a_hq');
        expect(again.ok).toBe(false);
        expect(again.reason).toContain('効果中');
        expect(useAbility(s, 'a_hq').ok).toBe(false);
        expect(get(s, 'a_y').morale).toBe(80); // 40 + 40（1 回だけ）
        expect(s.abilities.a_hq.usedAt).toBe(usedAt);
        expect(s.events.filter((e) => e.kind === 'ability')).toHaveLength(1);
        advance(s, 36);
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
        expect(info).toMatchObject({ id: 'tadakatsu_rearguard', name: '退路の守護', target: 'self_area', needsTarget: false, range: 100, durationSec: 50, controllable: true, usable: true, ready: true, reason: null, state: 'unused' });
        expect(info.effectText).toContain('−80%');
        expect(info.rangeText).toContain('100 m');
        expect(info.generalName).toBe('本多忠勝');
        expect(info.costText).toContain('動けない');
        expect(info.costText).toContain('無敵ではない');
        expect(info.note).toContain('ゲーム用の創作');
        for (const d of Object.values(ABILITY_DATA)) {
            expect(d.name).toBeTruthy();
            expect(d.targetText && d.rangeText && d.effectText && d.costText).toBeTruthy();
            // 能力はゲーム上の創作。説明に「史実」の能力として書かない
            expect(`${d.targetText}${d.rangeText}${d.effectText}${d.costText}`).not.toContain('史実');
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

    it('撤退の命令で退き口から離れ、兵が 40% 以上なら守れた（約束の場面：味方が敵と 15 秒以上斬り結んだ後の撤退）', () => {
        const s = createBattle(
            setup([U('a_t', 'ally', 'yari', 0, 60, N, { strength: 400 }), U('a_g', 'ally', 'yari', 60, 0, N, { strength: 400, morale: 100 }), U('e_y', 'enemy', 'yari', 60, -25, S, { strength: 200, morale: 100 }), U('e_far', 'enemy', 'yari', -150, -150, S)], {
                timeLimitSec: 600,
                pledge: { targetId: 'a_t', safeZone: ZONE, holdSec: 20, minStrengthRatio: 0.4 },
            }),
        );
        issueOrder(s, 'a_t', { type: 'retreat' });
        advance(s, 90);
        expect(get(s, 'a_t').status).toBe('withdrawn');
        const p = pledgeProgress(s)!;
        expect(p.withdrew).toBe(true);
        expect(p.pressed).toBe(false); // 対象そのものは斬り合っていない
        expect(p.meleeSec).toBeGreaterThanOrEqual(15); // 忠勝役の a_g が斬り結んで退路を守った
        expect(p.contested).toBe(true);
        expect(s.events.some((e) => e.kind === 'pledge' && e.text.includes('約束の場面'))).toBe(true);
        orderAllRetreat(s);
        const r = runToEnd(s);
        expect(r.pledge).toEqual({ targetId: 'a_t', result: 'kept' });
    });

    it('約束の場面の前（敵と斬り合う前）に全軍撤退すると、対象が無事でも約束を果たしたことにならない（broken）', () => {
        const s = createBattle(pledgeScene());
        orderAllRetreat(s);
        const r = runToEnd(s);
        expect(r.result).toBe('retreat');
        expect(r.units.find((u) => u.id === 'a_t')!.status).toBe('withdrawn');
        expect(r.units.find((u) => u.id === 'a_t')!.endStrength).toBe(400);
        expect(r.pledge).toEqual({ targetId: 'a_t', result: 'broken' });
        expect(pledgeProgress(s)!.contested).toBe(false);
    });

    it('約束の場面の前でも、勝利か日没で終われば（戦場に踏みとどまった）守れた', () => {
        // 日没は下の「合戦の終わりに戦えていて…（日没）」。勝利：敵の本陣が崩れる
        const s = createBattle(pledgeScene());
        get(s, 'e_hq').morale = 5; // （状態を直接変更）
        const r = runToEnd(s);
        expect(r.result).toBe('victory');
        expect(pledgeProgress(s)!.contested).toBe(false);
        expect(r.pledge?.result).toBe('kept');
    });

    it('対象が敵と斬り合えば、すぐに約束の場面になる', () => {
        const s = createBattle(
            setup([U('a_t', 'ally', 'yari', 0, 60, N, { strength: 400 }), U('e_y', 'enemy', 'yari', 0, 35, S, { strength: 200, order: { type: 'attack', targetId: 'a_t' } })], {
                timeLimitSec: 600,
                pledge: { targetId: 'a_t', safeZone: ZONE, holdSec: 20, minStrengthRatio: 0.4 },
            }),
        );
        expect(pledgeProgress(s)!.contested).toBe(false);
        advance(s, 3);
        const p = pledgeProgress(s)!;
        expect(p.pressed).toBe(true);
        expect(p.contested).toBe(true);
        expect(p.onTrack).toBe(true);
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

// ---------------------------------------------------------------- 追い討ち（歴史分岐の合戦だけ）

/** 味方の槍 a_t が敵の槍 e_y と斬り合っている所。rg なら忠勝役 a_rg（退路の守護）を a_t の退路（南）に置く */
function pursuitScene(pursuit: boolean, rg = false): BattleSetup {
    const units = [
        U('a_t', 'ally', 'yari', 0, 20, N, { strength: 400, morale: 90 }),
        U('e_y', 'enemy', 'yari', 0, -4, S, { strength: 400, morale: 100 }),
        U('e_far', 'enemy', 'yari', -150, -150, S),
    ];
    if (rg) units.push(U('a_rg', 'ally', 'yari', 30, 75, N, { strength: 400, morale: 100, ...withAbility('tadakatsu_rearguard', 'tadakatsu') }));
    return setup(units, { pursuit });
}

describe('追い討ち（BattleSetup.pursuit。歴史分岐の合戦だけ）', () => {
    it('退く味方を、近くの敵は斬りながら後を追う（追い討ちなしの合戦では離れれば止む）', () => {
        const out: Record<string, number> = {};
        for (const pursuit of [false, true]) {
            const s = createBattle(pursuitScene(pursuit));
            advance(s, 4);
            expect(get(s, 'a_t').engagedWith).toBe('e_y');
            const before = get(s, 'a_t').strength;
            issueOrder(s, 'a_t', { type: 'retreat' });
            advance(s, 20);
            out[String(pursuit)] = before - get(s, 'a_t').strength;
            if (pursuit) {
                const e = get(s, 'e_y');
                expect(e.order).toEqual({ type: 'attack', targetId: 'a_t' });
                expect(Math.hypot(e.x - get(s, 'a_t').x, e.z - get(s, 'a_t').z)).toBeLessThan(40); // 離されない
            }
        }
        expect(out.true).toBeGreaterThan(out.false * 2 + 40);
    });

    it('退路の守護の範囲で退く味方を追う敵は、忠勝隊に阻まれて忠勝隊へ向かう', () => {
        const s = createBattle(pursuitScene(true, true));
        advance(s, 4);
        issueOrder(s, 'a_t', { type: 'retreat' });
        expect(useAbility(s, 'a_rg').ok).toBe(true);
        advance(s, 1);
        advance(s, 20, (x) => {
            if (get(x, 'e_y').order.type === 'attack') expect(['a_t', 'a_rg']).toContain((get(x, 'e_y').order as { targetId: string }).targetId);
        });
        expect(get(s, 'e_y').order).toEqual({ type: 'attack', targetId: 'a_rg' });
        expect(s.events.some((e) => e.kind === 'ai' && e.text.includes('追い討ちをa_rgが阻む'))).toBe(true);
        expect(get(s, 'a_t').status).toBe('ready');
    });

    it('架空の第一章（pursuit なし）の合戦は、追い討ちの考えを使わない（同じ采配で同じ結果）', () => {
        const a = runToEnd(createBattle(demoSetup('alone')));
        const b = runToEnd(createBattle({ ...demoSetup('alone'), pursuit: false }));
        expect(b).toEqual(a);
        expect(demoSetup('tashiro').pursuit).toBeUndefined();
    });
});
