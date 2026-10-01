/**
 * 立て直しの号令（家康本陣）の「効果を与えられる相手」の確かめ（docs/fields-group3-design.md §2-3）。
 * - 範囲（110 m）に、自隊（家康本陣）を含めて、兵が最初の 3 割以上で戦える味方がいる。
 * - そのうち 1 部隊以上で、士気が 100 未満（使った時の +40 が効く）か、敗走の防ぎが効く場面（交戦中・3 秒以内に損害・矢・斬り合い・
 *   見えている敵が 120 m 以内）。
 * 誰にも効かないときは、点滅せず（abilityInfo の ready・名札の印）、押しても使わず（useAbility）、使用回数も減らない。理由を出す。
 * どのテストも、場面を作るために士気・兵・見え方・時刻を直接書き換える（状態を直接操作したテスト）。
 *
 * 既存の合戦（10 戦場・歴史分岐・能力の台本）は、家康本陣の士気が最初 90（100 未満）なので開始時は今までどおり使える・点滅する。
 * この確かめを入れても既存のテスト（1218 件）は 1 件も変わらなかった（号令を使う台本の場面は、どれも効く相手がいる）。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, stepBattle, unitById, type BattleState } from '../proto3d/src/battle/sim';
import { abilityEffectTargets, abilityInfo, useAbility } from '../proto3d/src/battle/abilities';
import { abilityPanelModel, labelAbilityModel, labelTapCandidates, resolveLabelTap } from '../proto3d/src/battle/control';
import type { AbilityId, BattleMap, BattleSetup, Side, UnitDef, UnitKind } from '../proto3d/src/battle/types';

const N = 0;
const S = Math.PI;
const FLAT: BattleMap = { id: 'flat', name: '平地', width: 400, depth: 400, terrain: [], exits: { ally: { x: 0, z: 200 }, enemy: { x: 0, z: -200 } } };

function U(id: string, side: Side, kind: UnitKind, x: number, z: number, facing: number, extra: Partial<UnitDef> = {}): UnitDef {
    return { id, side, clan: side === 'ally' ? 'tokugawa' : 'asai', kind, name: id, strength: 300, morale: 80, x, z, facing, ...extra };
}
const rally = (extra: Partial<UnitDef> = {}): Partial<UnitDef> => ({ ability: 'ieyasu_rally' as AbilityId, leaderId: 'ieyasu', ...extra });
/** 家康本陣（0,100）・範囲の槍（0,40）・遠くの敵の本陣（範囲・弓の距離の外） */
function scene(hqMorale: number, yariMorale: number, more: UnitDef[] = []): BattleState {
    const setup: BattleSetup = {
        map: FLAT,
        units: [
            U('a_hq', 'ally', 'honjin', 0, 100, N, rally({ morale: hqMorale })),
            U('a_y', 'ally', 'yari', 0, 40, N, { morale: yariMorale }),
            U('e_hq', 'enemy', 'honjin', -190, -190, S, { morale: 100 }),
            ...more,
        ],
        timeLimitSec: 600,
        briefing: [],
    };
    return createBattle(setup);
}
const get = (s: BattleState, id: string) => unitById(s, id)!;

describe('立て直しの号令：効果を与えられる相手の確かめ（状態を直接操作したテスト）', () => {
    it('範囲の味方がみな士気 100 で、交戦・射撃・敵の接近も無い → 使えない（点滅しない・押しても使わない・回数は減らない・理由を出す）', () => {
        const s = scene(100, 100);
        const e = abilityEffectTargets(s, 'a_hq')!;
        expect(e.inRange).toEqual(['a_hq', 'a_y']);
        expect(e.effective).toEqual([]);
        const info = abilityInfo(s, 'a_hq')!;
        expect(info.usable).toBe(false);
        expect(info.ready).toBe(false);
        expect(info.reason).toContain('効く相手がいない');
        expect(info.reason).toContain('a_hqも含めて');
        // 名札：点滅しない・押せる名札の候補に入らない・押しても何もしない
        expect(labelAbilityModel(s, 'a_hq', 'none', null).mode).toBe('');
        expect(labelTapCandidates(s, 'none', null)).not.toContain('a_hq');
        expect(resolveLabelTap(s, 'a_hq', 'none', null)).toBeNull();
        // 能力の欄：使えない・理由
        const pm = abilityPanelModel(s, 'a_hq')!;
        expect(pm.usable).toBe(false);
        expect(pm.reason).toContain('効く相手がいない');
        // 押しても使わない（回数は減らない・士気も変わらない）
        const r = useAbility(s, 'a_hq');
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('効く相手がいない');
        expect(s.abilities.a_hq!.usedAt).toBeNull();
        expect(abilityInfo(s, 'a_hq')!.state).toBe('unused');
    });

    it('範囲に兵が 3 割以上で戦える味方がいない（家康本陣も 3 割を切り、ほかの味方は範囲の外）→ 使えない', () => {
        const s = scene(60, 60);
        get(s, 'a_hq').strength = 80; // 最初の 300 の 3 割（90）を切る
        get(s, 'a_y').x = 0;
        get(s, 'a_y').z = -50; // 本陣から 150 m（範囲 110 m の外）
        const e = abilityEffectTargets(s, 'a_hq')!;
        expect(e.inRange).toEqual([]);
        const info = abilityInfo(s, 'a_hq')!;
        expect(info.ready).toBe(false);
        expect(info.reason).toContain('110 m 以内に効果を受けられる味方がいない');
        expect(useAbility(s, 'a_hq').ok).toBe(false);
        expect(s.abilities.a_hq!.usedAt).toBeNull();
    });

    it('範囲の味方が 3 割を切った部隊だけ（士気が低くても効かない）→ 使えない', () => {
        const s = scene(100, 30);
        get(s, 'a_hq').strength = 80;
        get(s, 'a_y').strength = 50; // 最初の 300 の 3 割を切る
        expect(abilityEffectTargets(s, 'a_hq')!.inRange).toEqual([]);
        expect(abilityInfo(s, 'a_hq')!.ready).toBe(false);
    });

    it('自隊（家康本陣）だけでも効く場面：ほかの味方は範囲の外・本陣の士気 70 → 使える（点滅する）。使うと本陣の士気 +40', () => {
        const s = scene(70, 100);
        get(s, 'a_y').z = -50;
        const e = abilityEffectTargets(s, 'a_hq')!;
        expect(e.inRange).toEqual(['a_hq']);
        expect(e.effective).toEqual(['a_hq']);
        expect(e.why.a_hq).toEqual(['morale']);
        const info = abilityInfo(s, 'a_hq')!;
        expect(info.ready).toBe(true);
        expect(labelAbilityModel(s, 'a_hq', 'none', null).mode).toBe('ready');
        expect(useAbility(s, 'a_hq').ok).toBe(true);
        expect(get(s, 'a_hq').morale).toBe(100);
        expect(abilityInfo(s, 'a_hq')!.state).toBe('active');
    });

    it('士気はみな 100 でも、見えている敵が 120 m 以内にいる（敗走の防ぎが効く）→ 使える。見えていない敵は数えない', () => {
        const s = scene(100, 100, [U('e_y', 'enemy', 'yari', 0, -60, S, { morale: 90 })]);
        // 槍（0,40）から 100 m。平地なので見えている。見えていないことにすると（林に隠れている場面）数えない
        expect(get(s, 'e_y').seenBy.ally).toBe(true);
        get(s, 'e_y').seenBy.ally = false;
        expect(abilityInfo(s, 'a_hq')!.ready).toBe(false);
        get(s, 'e_y').seenBy.ally = true;
        const e = abilityEffectTargets(s, 'a_hq')!;
        expect(e.effective).toEqual(['a_y']);
        expect(e.why.a_y).toEqual(['threat']);
        expect(abilityInfo(s, 'a_hq')!.ready).toBe(true);
        // 130 m に離すと敵の接近ではない
        get(s, 'e_y').z = -90;
        expect(abilityInfo(s, 'a_hq')!.ready).toBe(false);
    });

    it('士気はみな 100 でも、交戦中・3 秒以内に矢を受けた部隊がいる → 使える。3 秒を過ぎると使えない', () => {
        const s = scene(100, 100);
        get(s, 'a_y').engagedWith = 'e_hq';
        expect(abilityInfo(s, 'a_hq')!.ready).toBe(true);
        get(s, 'a_y').engagedWith = null;
        s.t = 10;
        get(s, 'a_y').lastArrowT = 8;
        expect(abilityEffectTargets(s, 'a_hq')!.why.a_y).toEqual(['threat']);
        expect(abilityInfo(s, 'a_hq')!.ready).toBe(true);
        s.t = 11.5;
        expect(abilityInfo(s, 'a_hq')!.ready).toBe(false);
        expect(useAbility(s, 'a_hq').ok).toBe(false);
        expect(s.abilities.a_hq!.usedAt).toBeNull();
    });

    it('使えなかった後に士気が下がれば使える（判定は毎回その時の状態で見る。点滅と使う判定は同じ）', () => {
        const s = scene(100, 100);
        expect(useAbility(s, 'a_hq').ok).toBe(false);
        get(s, 'a_y').morale = 85;
        const info = abilityInfo(s, 'a_hq')!;
        expect(info.ready).toBe(true);
        expect(useAbility(s, 'a_hq').ok).toBe(true);
        expect(get(s, 'a_y').morale).toBe(100);
        stepBattle(s, 0.1);
        expect(abilityInfo(s, 'a_hq')!.state).toBe('active');
    });

    it('既存の合戦の開始時：家康本陣の士気は 90 なので、号令は今までどおり使える（点滅する）', () => {
        const s = scene(90, 100);
        expect(abilityEffectTargets(s, 'a_hq')!.why.a_hq).toEqual(['morale']);
        expect(abilityInfo(s, 'a_hq')!.ready).toBe(true);
    });

    it('号令でない能力は確かめをしない（abilityEffectTargets は null）。説明に「家康本陣も効果を受ける」と書く', () => {
        const s = createBattle({
            map: FLAT,
            units: [U('a_t', 'ally', 'yari', 0, 100, N, { ability: 'tadakatsu_rearguard', leaderId: 'tadakatsu', morale: 100 }), U('e_hq', 'enemy', 'honjin', -190, -190, S)],
            timeLimitSec: 600,
            briefing: [],
        });
        expect(abilityEffectTargets(s, 'a_t')).toBeNull();
        const s2 = scene(90, 90);
        const info = abilityInfo(s2, 'a_hq')!;
        expect(info.targetText).toContain('家康本陣も効果を受ける');
        expect(info.short.target).toContain('本陣も');
    });
});
