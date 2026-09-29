/**
 * 新しい武将の仮の能力（battle/abilities.ts の sakai_flank・ishikawa_reserve・sakakibara_vanguard）と、能力の決め方（resolveAbilityId）。
 * - 何もない平地で、同じ場面を「能力なし／あり」で比べ、効果・代償・範囲・時間・回数を確かめる。
 * - 敵方が持つときの敵の考え（ai.ts）の使い方。
 * 一部は状態を直接変える（士気・位置を書き換える）テスト。その旨をテスト名に書く。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, meleeDamage, stepBattle, unitById, type BattleState } from '../proto3d/src/battle/sim';
import {
    ABILITY_DATA,
    abilityDealMul,
    abilityDisplayName,
    abilityFlankDealMul,
    abilityInfo,
    abilityMarks,
    abilityMoraleLossMul,
    abilitySpeedMul,
    provisionalAbilityShort,
    resolveAbilityId,
    useAbility,
} from '../proto3d/src/battle/abilities';
import { GENERALS } from '../proto3d/src/battle/generals';
import { buildBattleSetup, getField } from '../proto3d/src/battle/fields';
import type { AbilityId, BattleMap, BattleSetup, Side, UnitDef, UnitKind } from '../proto3d/src/battle/types';

const N = 0;
const S = Math.PI;
const E = Math.PI / 2;
const FLAT: BattleMap = { id: 'flat', name: '平地', width: 400, depth: 400, terrain: [], exits: { ally: { x: 0, z: 200 }, enemy: { x: 0, z: -200 } } };

function U(id: string, side: Side, kind: UnitKind, x: number, z: number, facing: number, extra: Partial<UnitDef> = {}): UnitDef {
    return { id, side, clan: side === 'ally' ? 'tokugawa' : 'rival', kind, name: id, strength: 300, morale: 80, x, z, facing, ...extra };
}
/** 武将の部隊（generalId と leaderId に同じ値。ability は武将のデータから） */
function G(general: string): Partial<UnitDef> {
    return { generalId: general, leaderId: general };
}
function setup(units: UnitDef[], extra: Partial<BattleSetup> = {}): BattleSetup {
    const hqs: UnitDef[] = [];
    if (!units.some((u) => u.side === 'ally' && u.kind === 'honjin')) hqs.push(U('a_hq', 'ally', 'honjin', 190, 190, N, { morale: 100 }));
    if (!units.some((u) => u.side === 'enemy' && u.kind === 'honjin')) hqs.push(U('e_hq', 'enemy', 'honjin', -190, -190, S, { morale: 100 }));
    return { map: FLAT, units: [...hqs, ...units], timeLimitSec: 600, briefing: [], ...extra };
}
const get = (s: BattleState, id: string) => unitById(s, id)!;
function advance(s: BattleState, sec: number): void {
    const end = s.t + sec - 1e-9;
    while (s.t < end && !s.result) stepBattle(s, 0.1);
}
const NEW: AbilityId[] = ['sakai_flank', 'ishikawa_reserve', 'sakakibara_vanguard'];

describe('仮の能力のデータ', () => {
    it('3 つとも provisional: true（仮）。今までの 3 能力は仮ではなく、数値も変わらない', () => {
        for (const id of NEW) expect(ABILITY_DATA[id].provisional).toBe(true);
        for (const id of ['ieyasu_rally', 'tadakatsu_rearguard', 'nagamasa_support'] as const) expect(ABILITY_DATA[id].provisional).toBe(false);
        const old = (id: AbilityId) => {
            const d = ABILITY_DATA[id];
            return [d.radius, d.durationSec, d.moraleBoost, d.areaFilter, d.areaTakeMul, d.areaMoraleLossMul, d.areaRoutMorale, d.selfDealMul, d.selfSpeedMul, d.selfTakeMul, d.rooted, d.areaSpeedMul, d.areaFlankDealMul, d.endMoraleCost];
        };
        expect(old('ieyasu_rally')).toEqual([90, 30, 25, 'all', 1, 0.6, 8, 0.5, 0.5, 1, false, 1, 1, 0]);
        expect(old('tadakatsu_rearguard')).toEqual([70, 40, 0, 'retreating', 0.5, 0.5, null, 1, 0, 1.15, true, 1, 1, 0]);
        expect(old('nagamasa_support')).toEqual([60, 45, 0, 'target', 0.7, 0.6, null, 0.8, 1, 1, false, 1, 1, 0]);
    });
    it('数値は設計どおり（酒井 20 秒・80 m・側背 ×1.25・動き ×0.7／石川 30 秒・90 m・動き ×1.3・斬り合いの士気 −25%・与える損害 ×0.7／榊原 20 秒・×1.3・切れて士気 −10）', () => {
        const a = ABILITY_DATA.sakai_flank;
        expect([a.durationSec, a.radius, a.areaFlankDealMul, a.selfSpeedMul, a.target]).toEqual([20, 80, 1.25, 0.7, 'self_area']);
        const b = ABILITY_DATA.ishikawa_reserve;
        expect([b.durationSec, b.radius, b.areaSpeedMul, b.areaMoraleLossMul, b.areaMoraleLossMeleeOnly, b.selfDealMul, b.target]).toEqual([30, 90, 1.3, 0.75, true, 0.7, 'self_area']);
        const c = ABILITY_DATA.sakakibara_vanguard;
        expect([c.durationSec, c.selfDealMul, c.endMoraleCost, c.target, c.areaFilter]).toEqual([20, 1.3, 10, 'self', 'self']);
    });
    it('武将 6 人の能力は、すべて ABILITY_DATA にある', () => {
        for (const g of GENERALS) expect(ABILITY_DATA[g.abilityId]).toBeDefined();
    });
    it('名前・説明に「仮」と分かる表示（今までの能力には付けない）。短い説明も数値から作る', () => {
        expect(abilityDisplayName('sakai_flank')).toBe('両翼の采配（仮）');
        expect(abilityDisplayName('ieyasu_rally')).toBe('立て直しの号令');
        expect(provisionalAbilityShort('sakai_flank').effect).toContain('×1.25');
        expect(provisionalAbilityShort('ishikawa_reserve').effect).toContain('−25%');
        expect(provisionalAbilityShort('sakakibara_vanguard').cost).toContain('−10');
    });
});

describe('能力の決め方（部隊の ability → 無ければ generalId の武将の能力）', () => {
    it('resolveAbilityId', () => {
        expect(resolveAbilityId({ generalId: 'sakai' })).toBe('sakai_flank');
        expect(resolveAbilityId({ generalId: 'ishikawa', leaderId: 'ishikawa' })).toBe('ishikawa_reserve');
        expect(resolveAbilityId({ generalId: 'sakakibara' })).toBe('sakakibara_vanguard');
        // 部隊の ability が先
        expect(resolveAbilityId({ generalId: 'sakai', ability: 'ieyasu_rally' })).toBe('ieyasu_rally');
        // 武将のいない部隊・知らない武将・武将ではない人物（leaderId だけ）は持たない
        expect(resolveAbilityId({ ability: 'ieyasu_rally' })).toBeUndefined();
        expect(resolveAbilityId({ generalId: 'genzo' })).toBeUndefined();
        expect(resolveAbilityId({ leaderId: 'genzo' })).toBeUndefined();
        expect(resolveAbilityId({ leaderId: 'hero', ability: 'ieyasu_rally' })).toBe('ieyasu_rally');
    });
    it('合戦を始めると、generalId だけの部隊にも武将の能力が付く（部隊の ability が優先）', () => {
        const s = createBattle(
            setup([
                U('a_sakai', 'ally', 'yari', 0, 50, N, G('sakai')),
                U('a_other', 'ally', 'yari', 40, 50, N, { ...G('ishikawa'), ability: 'sakakibara_vanguard' }),
                U('a_plain', 'ally', 'yumi', 80, 50, N, { leaderId: 'genzo' }),
            ]),
        );
        expect(s.abilities.a_sakai?.id).toBe('sakai_flank');
        expect(s.abilities.a_other?.id).toBe('sakakibara_vanguard');
        expect(s.abilities.a_plain).toBeUndefined();
        expect(get(s, 'a_sakai').ability).toBe('sakai_flank');
    });
    it('演習の大平原：酒井・石川・榊原の部隊が仮の能力を持つ（家康・忠勝は今の能力）', () => {
        const s = createBattle(buildBattleSetup(getField('plains')!, 'standard'));
        const ids = Object.fromEntries(Object.values(s.abilities).map((r) => [r.unitId, r.id]));
        expect(ids).toMatchObject({ a_ieyasu: 'ieyasu_rally', a_tadakatsu: 'tadakatsu_rearguard', a_sakai: 'sakai_flank', a_ishikawa: 'ishikawa_reserve', a_sakakibara: 'sakakibara_vanguard' });
        expect(abilityInfo(s, 'a_sakai')).toMatchObject({ name: '両翼の采配（仮）', provisional: true, cardLabel: '両翼', usable: true, controllable: true });
    });
});

// ---------------------------------------------------------------- 酒井忠次「両翼の采配」

/** 酒井隊（南）と、敵の槍の東の側面を突く味方の騎馬（範囲内）・遠くの味方の槍（範囲外） */
function sakaiScene(): BattleSetup {
    return setup([
        U('a_sakai', 'ally', 'yari', 0, 60, N, G('sakai')),
        U('a_kiba', 'ally', 'kiba', 30, 0, -E, { order: { type: 'attack', targetId: 'e_y' } }),
        U('a_far', 'ally', 'yari', 150, 60, N),
        U('e_y', 'enemy', 'yari', 0, 0, S),
    ]);
}

describe('両翼の采配（酒井忠次隊・仮）', () => {
    it('効果中、半径 80 m の味方が側面・背後を突いたときの与える損害 ×1.25（正面は変わらない）。範囲外の味方には効かない', () => {
        const s = createBattle(sakaiScene());
        const k = get(s, 'a_kiba');
        const f = get(s, 'a_far');
        const d = get(s, 'e_y');
        const before = { flank: meleeDamage(s, k, d, 'flank'), rear: meleeDamage(s, k, d, 'rear'), front: meleeDamage(s, k, d, 'front'), far: meleeDamage(s, f, d, 'flank') };
        expect(useAbility(s, 'a_sakai')).toEqual({ ok: true, reason: null });
        expect(abilityFlankDealMul(s, k, 'flank')).toBe(1.25);
        expect(abilityFlankDealMul(s, k, 'front')).toBe(1);
        expect(abilityFlankDealMul(s, f, 'flank')).toBe(1);
        expect(meleeDamage(s, k, d, 'flank') / before.flank).toBeCloseTo(1.25, 9);
        expect(meleeDamage(s, k, d, 'rear') / before.rear).toBeCloseTo(1.25, 9);
        expect(meleeDamage(s, k, d, 'front')).toBe(before.front);
        expect(meleeDamage(s, f, d, 'flank')).toBe(before.far);
        expect(abilityMarks(s, 'a_kiba')).toContain('両翼の采配');
        expect(abilityMarks(s, 'a_sakai')).toContain('両翼の采配（足が鈍る）');
    });
    it('代償：効果中、酒井隊の動き ×0.7（同じ移動を能力なしと比べる）。20 秒で切れて元に戻る', () => {
        // 斬り合いの無い場面（騎馬は待機。合戦が途中で終わらないように）
        const scene = () => ({ ...sakaiScene(), units: sakaiScene().units.map((u) => (u.id === 'a_kiba' ? { ...u, order: undefined } : u)) });
        const a = createBattle(scene());
        const b = createBattle(scene());
        useAbility(b, 'a_sakai');
        expect(abilitySpeedMul(b, get(b, 'a_sakai'))).toBe(0.7);
        expect(abilitySpeedMul(b, get(b, 'a_kiba'))).toBe(1);
        for (const x of [a, b]) issueOrder(x, 'a_sakai', { type: 'move', x: -150, z: 60 });
        advance(a, 6);
        advance(b, 6);
        const da = Math.abs(get(a, 'a_sakai').x);
        const db = Math.abs(get(b, 'a_sakai').x);
        expect(db / da).toBeGreaterThan(0.6);
        expect(db / da).toBeLessThan(0.8);
        advance(b, 14.2);
        expect(b.result).toBeNull();
        expect(abilityInfo(b, 'a_sakai')!.state).toBe('spent');
        expect(abilitySpeedMul(b, get(b, 'a_sakai'))).toBe(1);
    });
});

// ---------------------------------------------------------------- 石川数正「後詰めの差配」

function ishikawaScene(): BattleSetup {
    return setup([
        U('a_ishi', 'ally', 'yari', 0, 100, N, G('ishikawa')),
        U('a_near', 'ally', 'yari', 60, 100, N),
        U('a_far', 'ally', 'yari', -120, 100, N),
        U('e_y', 'enemy', 'yari', 0, -100, S),
    ]);
}

describe('後詰めの差配（石川数正隊・仮）', () => {
    it('効果中、半径 90 m の味方（石川隊を含む）の動き ×1.3。範囲外は変わらない', () => {
        const s = createBattle(ishikawaScene());
        useAbility(s, 'a_ishi');
        expect(abilitySpeedMul(s, get(s, 'a_ishi'))).toBeCloseTo(1.3, 9);
        expect(abilitySpeedMul(s, get(s, 'a_near'))).toBeCloseTo(1.3, 9);
        expect(abilitySpeedMul(s, get(s, 'a_far'))).toBe(1);
        expect(abilityMarks(s, 'a_near')).toContain('後詰め');
    });
    it('動き：範囲内の味方は同じ時間でおよそ 1.3 倍進む（能力なしと比べる。範囲は石川隊について動く）', () => {
        const a = createBattle(ishikawaScene());
        const b = createBattle(ishikawaScene());
        useAbility(b, 'a_ishi');
        for (const x of [a, b]) {
            issueOrder(x, 'a_near', { type: 'move', x: 60, z: 180 });
            issueOrder(x, 'a_ishi', { type: 'move', x: 0, z: 180 });
        }
        advance(a, 5);
        advance(b, 5);
        const ra = (get(b, 'a_near').z - 100) / (get(a, 'a_near').z - 100);
        expect(ra).toBeGreaterThan(1.2);
        expect(ra).toBeLessThan(1.4);
    });
    it('斬り合いでの士気の低下 −25%（斬り合っていない部隊の、矢などの低下には効かない）', () => {
        const s = createBattle(ishikawaScene());
        useAbility(s, 'a_ishi');
        expect(abilityMoraleLossMul(s, get(s, 'a_near'), true)).toBeCloseTo(0.75, 9);
        expect(abilityMoraleLossMul(s, get(s, 'a_near'), false)).toBe(1);
        expect(abilityMoraleLossMul(s, get(s, 'a_far'), true)).toBe(1);
    });
    it('代償：効果中、石川隊の与える損害 ×0.7。30 秒で切れる', () => {
        const s = createBattle(ishikawaScene());
        const d = get(s, 'e_y');
        const before = meleeDamage(s, get(s, 'a_ishi'), d, 'front');
        useAbility(s, 'a_ishi');
        expect(abilityDealMul(s, get(s, 'a_ishi'))).toBe(0.7);
        expect(abilityDealMul(s, get(s, 'a_near'))).toBe(1);
        expect(meleeDamage(s, get(s, 'a_ishi'), d, 'front') / before).toBeCloseTo(0.7, 9);
        advance(s, 29.5);
        expect(abilityInfo(s, 'a_ishi')!.state).toBe('active');
        advance(s, 0.7);
        expect(abilityInfo(s, 'a_ishi')!.state).toBe('spent');
        expect(abilityDealMul(s, get(s, 'a_ishi'))).toBe(1);
    });
    it('斬り合いの場面：効果のある方が、範囲内の味方の士気が高く残る', () => {
        const scene = () =>
            setup([
                U('a_ishi', 'ally', 'yari', 50, 90, N, G('ishikawa')),
                U('a_y', 'ally', 'yari', 0, 40, N, { morale: 90 }),
                U('e_y', 'enemy', 'yari', 0, 5, S, { strength: 600, morale: 90, order: { type: 'attack', targetId: 'a_y' } }),
            ]);
        const a = createBattle(scene());
        const b = createBattle(scene());
        useAbility(b, 'a_ishi');
        advance(a, 25);
        advance(b, 25);
        expect(get(b, 'a_y').morale).toBeGreaterThan(get(a, 'a_y').morale);
    });
});

// ---------------------------------------------------------------- 榊原康政「先駆けの号」

function sakakibaraScene(): BattleSetup {
    return setup([U('a_saka', 'ally', 'yari', 0, 100, N, G('sakakibara')), U('a_near', 'ally', 'yari', 30, 100, N), U('e_y', 'enemy', 'yari', 0, -100, S)]);
}

describe('先駆けの号（榊原康政隊・仮）', () => {
    it('効果中、自分の部隊だけ与える損害 ×1.3（近くの味方には効かない）。対象は選ばない', () => {
        const s = createBattle(sakakibaraScene());
        const d = get(s, 'e_y');
        const before = meleeDamage(s, get(s, 'a_saka'), d, 'front');
        expect(abilityInfo(s, 'a_saka')).toMatchObject({ target: 'self', validTargets: [], usable: true });
        expect(useAbility(s, 'a_saka', 'a_near')).toEqual({ ok: true, reason: null });
        expect(s.abilities.a_saka!.targetId).toBeNull();
        expect(abilityDealMul(s, get(s, 'a_saka'))).toBe(1.3);
        expect(abilityDealMul(s, get(s, 'a_near'))).toBe(1);
        expect(meleeDamage(s, get(s, 'a_saka'), d, 'front') / before).toBeCloseTo(1.3, 9);
        expect(abilityMarks(s, 'a_saka')).toEqual(['先駆け']);
        expect(abilityMarks(s, 'a_near')).toEqual([]);
    });
    it('代償：20 秒で切れたとき、榊原隊の士気 −10（切れた知らせにも書く）', () => {
        const s = createBattle(sakakibaraScene());
        useAbility(s, 'a_saka');
        advance(s, 19.9);
        expect(get(s, 'a_saka').morale).toBe(80);
        advance(s, 0.3);
        expect(abilityInfo(s, 'a_saka')!.state).toBe('spent');
        // 切れた刻みのうちに少しだけ戻る（戻りの決まり）ので、70 からわずかに上
        expect(get(s, 'a_saka').morale).toBeGreaterThanOrEqual(70);
        expect(get(s, 'a_saka').morale).toBeLessThan(71);
        const end = s.events.find((e) => e.kind === 'ability_end' && e.unitId === 'a_saka')!;
        expect(end.text).toContain('士気 −10');
    });
    it('（状態を直接変更）途中で崩れて終わったときは、士気の代償を取らない', () => {
        const s = createBattle(sakakibaraScene());
        useAbility(s, 'a_saka');
        advance(s, 2);
        get(s, 'a_saka').morale = 0;
        advance(s, 1);
        expect(get(s, 'a_saka').status).toBe('routed');
        const end = s.events.find((e) => e.kind === 'ability_end' && e.unitId === 'a_saka')!;
        expect(end.text).toContain('崩れて');
        expect(end.text).not.toContain('士気 −');
    });
});

// ---------------------------------------------------------------- 共通の決まり

describe('共通の決まり（仮の能力も今までと同じ）', () => {
    it('1 合戦 1 回。連打しても重ならない（2 回目は断り、効果の時間も延びない）', () => {
        const s = createBattle(sakakibaraScene());
        expect(useAbility(s, 'a_saka').ok).toBe(true);
        const until = s.abilities.a_saka!.until;
        advance(s, 3);
        const r = useAbility(s, 'a_saka');
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('効果中');
        expect(s.abilities.a_saka!.until).toBe(until);
        expect(abilityDealMul(s, get(s, 'a_saka'))).toBe(1.3);
        advance(s, 20);
        expect(useAbility(s, 'a_saka').reason).toContain('もう使った');
    });
    it('一時停止中（合戦を進めない間）は効果の時間が減らない', () => {
        const s = createBattle(ishikawaScene());
        useAbility(s, 'a_ishi');
        advance(s, 5);
        const left = abilityInfo(s, 'a_ishi')!.remainingSec;
        // 進めない（一時停止）
        expect(abilityInfo(s, 'a_ishi')!.remainingSec).toBe(left);
        expect(left).toBeCloseTo(25, 5);
    });
    it('（状態を直接変更）使えない部隊（敗走中）では使えず、回数も減らない。敵方の能力はプレイヤーが使えない', () => {
        const s = createBattle(
            setup([
                U('a_sakai', 'ally', 'yari', 0, 60, N, G('sakai')),
                U('e_ishi', 'enemy', 'yari', 0, -120, S, G('ishikawa')),
            ]),
        );
        get(s, 'a_sakai').status = 'routed';
        const r = useAbility(s, 'a_sakai');
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('敗走中');
        expect(s.abilities.a_sakai!.usedAt).toBeNull();
        get(s, 'a_sakai').status = 'ready';
        expect(useAbility(s, 'a_sakai').ok).toBe(true);
        const e = useAbility(s, 'e_ishi');
        expect(e.ok).toBe(false);
        expect(s.abilities.e_ishi!.usedAt).toBeNull();
        expect(abilityInfo(s, 'e_ishi')!.controllable).toBe(false);
    });
    it('abilityInfo：名前に（仮）、効果・代償・断り書きに仮と出る', () => {
        const s = createBattle(sakaiScene());
        const i = abilityInfo(s, 'a_sakai')!;
        expect(i.name).toBe('両翼の采配（仮）');
        expect(i.provisional).toBe(true);
        expect(i.effectText).toContain('仮');
        expect(i.costText).toContain('仮');
        expect(i.note).toContain('仮の能力');
        expect(i.range).toBe(80);
        expect(i.target).toBe('self_area');
    });
});

// ---------------------------------------------------------------- 敵方が持つとき（敵の考え）

describe('敵の考えが仮の能力を使う', () => {
    it('先駆けの号：斬り合いになると使う', () => {
        const s = createBattle(setup([U('a_y', 'ally', 'yari', 0, 20, N), U('e_saka', 'enemy', 'yari', 0, -20, S, { ...G('sakakibara'), aiRole: 'hold_line' })]));
        advance(s, 1);
        expect(s.abilities.e_saka!.usedAt).toBeNull();
        issueOrder(s, 'a_y', { type: 'attack', targetId: 'e_saka' });
        advance(s, 15);
        expect(s.abilities.e_saka!.usedAt).not.toBeNull();
    });
    it('後詰めの差配：範囲に味方（敵方）が 2 部隊以上いて、斬り合いが始まると使う（斬り合いが無ければ使わない）', () => {
        const scene = () =>
            setup([
                U('a_y', 'ally', 'yari', 0, 40, N),
                U('e_ishi', 'enemy', 'yari', 0, -60, S, { ...G('ishikawa'), aiRole: 'hold_line' }),
                U('e_a', 'enemy', 'yari', -40, -20, S, { aiRole: 'hold_line' }),
                U('e_b', 'enemy', 'yari', 40, -60, S, { aiRole: 'hold_line' }),
            ]);
        const quiet = createBattle(scene());
        advance(quiet, 10);
        expect(quiet.abilities.e_ishi!.usedAt).toBeNull();
        const s = createBattle(scene());
        issueOrder(s, 'a_y', { type: 'attack', targetId: 'e_a' });
        advance(s, 20);
        expect(s.abilities.e_ishi!.usedAt).not.toBeNull();
    });
    it('両翼の采配：範囲の中で 2 部隊以上が斬り合うと使う', () => {
        const s = createBattle(
            setup([
                U('a_1', 'ally', 'yari', -20, 30, N),
                U('a_2', 'ally', 'yari', 20, 30, N),
                U('e_sakai', 'enemy', 'yari', -20, -10, S, { ...G('sakai'), aiRole: 'hold_line' }),
                U('e_b', 'enemy', 'yari', 20, -10, S, { aiRole: 'hold_line' }),
            ]),
        );
        advance(s, 1);
        expect(s.abilities.e_sakai!.usedAt).toBeNull();
        issueOrder(s, 'a_1', { type: 'attack', targetId: 'e_sakai' });
        issueOrder(s, 'a_2', { type: 'attack', targetId: 'e_b' });
        advance(s, 20);
        expect(s.abilities.e_sakai!.usedAt).not.toBeNull();
    });
});
