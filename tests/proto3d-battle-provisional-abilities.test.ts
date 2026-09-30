/**
 * 新しい武将の能力（battle/abilities.ts の sakai_flank・ishikawa_reserve・sakakibara_vanguard。数値は差し替え前提の「仮」）と、能力の決め方（resolveAbilityId）。
 * Version 13 候補（docs/troops-abilities-design.md §2）で 3 能力を作り直した（酒井＝側背 ×1.8 と包囲、石川＝対象を選ぶ再配置と立て直し、
 * 榊原＝動き ×1.8 と最初の当たり ×2.0）。前の値はデータのテストの注に残す。
 * - 何もない平地で、同じ場面を「能力なし／あり」で比べ、効果・代償・範囲・時間・回数を確かめる。
 * - 敵方が持つときの敵の考え（ai.ts）の使い方。
 * 一部は状態を直接変える（士気・位置を書き換える）テスト。その旨をテスト名に書く。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, meleeDamage, orderLabel, stepBattle, unitById, type BattleState } from '../proto3d/src/battle/sim';
import {
    ABILITY_DATA,
    abilityDealMul,
    abilityDisplayName,
    abilityFlankDealMul,
    abilityInfo,
    abilityMarks,
    abilityMoraleLossMul,
    abilityRoutMorale,
    abilityShortText,
    abilitySpeedMul,
    canTarget,
    encircleMul,
    isRooted,
    provisionalAbilityShort,
    resolveAbilityId,
    targetReason,
    useAbility,
    vanguardDealMul,
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
function advance(s: BattleState, sec: number, each?: (s: BattleState) => void): void {
    const end = s.t + sec - 1e-9;
    while (s.t < end && !s.result) {
        each?.(s);
        stepBattle(s, 0.1);
    }
}
const NEW: AbilityId[] = ['sakai_flank', 'ishikawa_reserve', 'sakakibara_vanguard'];

describe('新しい武将の能力のデータ（数値は差し替え前提の「仮」）', () => {
    it('3 つとも provisional: true（仮）。家康・忠勝・長政の能力は仮ではない', () => {
        for (const id of NEW) expect(ABILITY_DATA[id].provisional).toBe(true);
        for (const id of ['ieyasu_rally', 'tadakatsu_rearguard', 'nagamasa_support'] as const) expect(ABILITY_DATA[id].provisional).toBe(false);
    });
    // Version 13 候補（docs/troops-abilities-design.md §2）で数値を作り直した。前の値：
    // 家康 90 m・30 秒・士気 +25・低下 ×0.6・敗走の線 8・与える損害 ×0.5／忠勝 70 m・40 秒・退く味方 ×0.5・受ける損害 ×1.15／
    // 酒井 20 秒・80 m・側背 ×1.25・動き ×0.7／石川 30 秒・90 m の周り・動き ×1.3・斬り合いの士気 −25%・与える損害 ×0.7／榊原 20 秒・与える損害 ×1.3・切れて士気 −10
    it('家康・忠勝・長政の数値（長政は変えない）', () => {
        const row = (id: AbilityId) => {
            const d = ABILITY_DATA[id];
            return [d.radius, d.durationSec, d.moraleBoost, d.areaFilter, d.areaTakeMul, d.areaMoraleLossMul, d.areaRoutMorale, d.areaMoraleFloor, d.selfDealMul, d.selfSpeedMul, d.selfTakeMul, d.rooted, d.lure];
        };
        expect(row('ieyasu_rally')).toEqual([110, 35, 40, 'all', 1, 0.4, -1, 20, 0.3, 0.5, 1, false, false]);
        expect(row('tadakatsu_rearguard')).toEqual([100, 50, 0, 'retreating', 0.2, 0.2, null, 0, 1, 0, 1.4, true, true]);
        expect(row('nagamasa_support')).toEqual([60, 45, 0, 'target', 0.7, 0.6, null, 0, 0.8, 1, 1, false, false]);
        expect(ABILITY_DATA.nagamasa_support.leash).toBe(true);
    });
    it('酒井・石川・榊原の数値（設計の表どおり）', () => {
        const a = ABILITY_DATA.sakai_flank;
        expect([a.durationSec, a.radius, a.areaFlankDealMul, a.encircle, a.selfSpeedMul, a.target]).toEqual([25, 100, 1.8, { takeMul: 1.3, moraleLossMul: 2 }, 0.7, 'self_area']);
        const b = ABILITY_DATA.ishikawa_reserve;
        expect([b.durationSec, b.radius, b.target, b.areaFilter, b.leash, b.areaSpeedMul, b.moraleBoost, b.areaMoraleLossMul, b.reserveMoraleLossMul, b.areaRoutMorale, b.rooted, b.selfDealMul]).toEqual([
            30, 180, 'ally_unit', 'target', false, 1.8, 30, 0.5, 0.75, 5, true, 1,
        ]);
        const c = ABILITY_DATA.sakakibara_vanguard;
        expect([c.durationSec, c.selfSpeedMul, c.vanguard, c.selfTakeMul, c.endMoraleCost, c.selfDealMul, c.target]).toEqual([
            20, 1.8, { firstStrikeSec: 8, firstStrikeMul: 2, softTargetMul: 1.5, flankMul: 1.3 }, 1.2, 15, 1, 'self',
        ]);
    });
    it('武将 6 人の能力は、すべて ABILITY_DATA にある', () => {
        for (const g of GENERALS) expect(ABILITY_DATA[g.abilityId]).toBeDefined();
    });
    it('名前・説明に「仮」と分かる表示（家康・忠勝・長政には付けない）。短い説明も数値から作る（6 能力とも）', () => {
        expect(abilityDisplayName('sakai_flank')).toBe('両翼の采配（仮）');
        expect(abilityDisplayName('ieyasu_rally')).toBe('立て直しの号令');
        expect(abilityShortText('sakai_flank').effect).toContain('×1.8');
        expect(abilityShortText('sakai_flank').effect).toContain('×1.3');
        expect(abilityShortText('ishikawa_reserve').effect).toContain('×1.8');
        expect(abilityShortText('ishikawa_reserve').target).toContain('180 m');
        expect(abilityShortText('sakakibara_vanguard').effect).toContain('×2');
        expect(abilityShortText('sakakibara_vanguard').cost).toContain('−15');
        expect(abilityShortText('ieyasu_rally').effect).toContain('+40');
        expect(abilityShortText('tadakatsu_rearguard').effect).toContain('−80%');
        // 前の名前（control.ts が使う）も同じ関数
        expect(provisionalAbilityShort).toBe(abilityShortText);
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

/**
 * 包囲の場面：南を向いた敵の槍 e_y（0,0）に、味方が決まった向きから斬りかかる。酒井隊は南 70 m（範囲 100 m の内）。
 * where：'front'＝正面（南）、'left'／'right'＝側面（東・西）、'rear'＝背後（北）。far を付けると、その部隊は酒井隊から 100 m より遠い所に置く
 */
function ringScene(where: ('front' | 'front2' | 'east' | 'west' | 'rear')[], farSakai = false): BattleSetup {
    const at = { front: [0, 20, S], front2: [12, 19, S], east: [20, 0, -E], west: [-20, 0, E], rear: [0, -20, N] } as const;
    return setup([
        U('a_sakai', 'ally', 'yari', 0, farSakai ? 170 : 70, N, G('sakai')),
        ...where.map((w) => U(`a_${w}`, 'ally', 'yari', at[w][0], at[w][1], at[w][2], { order: { type: 'attack', targetId: 'e_y' } })),
        U('e_y', 'enemy', 'yari', 0, 0, S, { strength: 600, morale: 90 }),
    ]);
}

describe('両翼の采配（酒井忠次隊・仮）', () => {
    it('効果中、半径 100 m の味方が側面・背後を突いたときの与える損害 ×1.8（正面は変わらない）。範囲外の味方には効かない', () => {
        const s = createBattle(sakaiScene());
        const k = get(s, 'a_kiba');
        const f = get(s, 'a_far');
        const d = get(s, 'e_y');
        const before = { flank: meleeDamage(s, k, d, 'flank'), rear: meleeDamage(s, k, d, 'rear'), front: meleeDamage(s, k, d, 'front'), far: meleeDamage(s, f, d, 'flank') };
        expect(useAbility(s, 'a_sakai')).toEqual({ ok: true, reason: null });
        expect(abilityFlankDealMul(s, k, 'flank')).toBe(1.8);
        expect(abilityFlankDealMul(s, k, 'front')).toBe(1);
        expect(abilityFlankDealMul(s, f, 'flank')).toBe(1);
        expect(meleeDamage(s, k, d, 'flank') / before.flank).toBeCloseTo(1.8, 9);
        expect(meleeDamage(s, k, d, 'rear') / before.rear).toBeCloseTo(1.8, 9);
        expect(meleeDamage(s, k, d, 'front')).toBe(before.front);
        expect(meleeDamage(s, f, d, 'flank')).toBe(before.far);
        expect(abilityMarks(s, 'a_kiba')).toContain('両翼の采配');
        expect(abilityMarks(s, 'a_sakai')).toContain('両翼の采配（足が鈍る）');
    });

    it('包囲：範囲の味方 2 部隊が同じ敵を別の向き（正面と側面・左右の側面・側面と背後）から斬ると、その敵は包囲される。能力なしでは包囲にならない', () => {
        const encircled = (where: Parameters<typeof ringScene>[0], use = true, far = false) => {
            const s = createBattle(ringScene(where, far));
            if (use) useAbility(s, 'a_sakai');
            advance(s, 0.5);
            return s.encircled.includes('e_y');
        };
        expect(encircled(['front', 'east'])).toBe(true);
        expect(encircled(['east', 'west'])).toBe(true);
        expect(encircled(['west', 'rear'])).toBe(true);
        expect(encircled(['front', 'east'], false)).toBe(false);
        // 正面だけ（2 部隊でも）は包囲にならない。1 部隊だけも
        expect(encircled(['front', 'front2'])).toBe(false);
        expect(encircled(['east'])).toBe(false);
        // 攻め手が酒井隊の範囲（100 m）の外なら包囲にならない
        expect(encircled(['front', 'east'], true, true)).toBe(false);
    });

    it('包囲された敵は受ける損害 ×1.3・士気の低下 ×2（同じ場面の能力なしと比べて、兵も士気も大きく減る）。印「包囲されている」', () => {
        const a = createBattle(ringScene(['front', 'east']));
        const b = createBattle(ringScene(['front', 'east']));
        useAbility(b, 'a_sakai');
        advance(a, 0.5);
        advance(b, 0.5);
        expect(encircleMul(b, get(b, 'e_y'))).toEqual({ take: 1.3, morale: 2 });
        expect(encircleMul(a, get(a, 'e_y'))).toEqual({ take: 1, morale: 1 });
        expect(abilityMarks(b, 'e_y')).toContain('包囲されている');
        // 同じ刻みの側面の当たり：×1.8（側背）×1.3（包囲）
        const east = get(b, 'a_east');
        expect(meleeDamage(b, east, get(b, 'e_y'), 'flank') / meleeDamage(a, get(a, 'a_east'), get(a, 'e_y'), 'flank')).toBeCloseTo(1.8 * 1.3, 6);
        advance(a, 10);
        advance(b, 10);
        const lostA = 600 - get(a, 'e_y').strength;
        const lostB = 600 - get(b, 'e_y').strength;
        expect(lostB).toBeGreaterThan(lostA * 1.3);
        expect(90 - get(b, 'e_y').morale).toBeGreaterThan((90 - get(a, 'e_y').morale) * 1.8);
    });

    it('正面だけの当たりは強くならない：正面から 2 部隊で斬る同じ場面は、能力があってもなくても 1 刻みも同じ', () => {
        const a = createBattle(ringScene(['front', 'front2']));
        const b = createBattle(ringScene(['front', 'front2']));
        useAbility(b, 'a_sakai');
        advance(a, 15);
        advance(b, 15);
        expect(get(b, 'e_y').strength).toBe(get(a, 'e_y').strength);
        expect(get(b, 'e_y').morale).toBe(get(a, 'e_y').morale);
        expect(b.encircled).toEqual([]);
    });

    it('代償：効果中、酒井隊の動き ×0.7（同じ移動を能力なしと比べる）。25 秒で切れて元に戻る', () => {
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
        advance(b, 19.2);
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
        U('a_far', 'ally', 'yari', -200, 100, N),
        U('e_y', 'enemy', 'yari', 0, -100, S),
    ]);
}

describe('後詰めの差配（石川数正隊・仮。対象の要る能力）', () => {
    it('対象を選ぶ：needsTarget。選べるのは 180 m 以内の戦える味方（自分・敵・遠い部隊・いない部隊は選べない）。不適切な対象では回数を減らさない', () => {
        const s = createBattle(ishikawaScene());
        const info = abilityInfo(s, 'a_ishi')!;
        expect(info).toMatchObject({ needsTarget: true, target: 'ally_unit', usable: true, ready: true, range: 180 });
        expect(info.validTargets).toEqual(['a_near']);
        expect(canTarget(s, 'a_ishi', 'a_near')).toBe(true);
        for (const bad of ['a_ishi', 'e_y', 'a_far', 'nobody']) {
            expect(canTarget(s, 'a_ishi', bad)).toBe(false);
            expect(targetReason(s, 'a_ishi', bad)).toBeTruthy();
            const r = useAbility(s, 'a_ishi', bad);
            expect(r.ok).toBe(false);
            expect(s.abilities.a_ishi!.usedAt).toBeNull();
        }
        expect(targetReason(s, 'a_ishi', 'a_far')).toContain('180 m');
        expect(useAbility(s, 'a_ishi').reason).toContain('選ぶ');
        expect(s.abilities.a_ishi!.usedAt).toBeNull();
        // 対象の要らない能力には「対象は選ばない」
        const t = createBattle(sakaiScene());
        expect(targetReason(t, 'a_sakai', 'a_kiba')).toContain('選ばない');
        expect(canTarget(t, 'a_sakai', 'a_kiba')).toBe(false);
    });

    it('選べる味方がいなければ使えない（理由つき。点滅させない）', () => {
        const s = createBattle(setup([U('a_ishi', 'ally', 'yari', -100, -100, N, G('ishikawa')), U('e_y', 'enemy', 'yari', 100, -150, S)]));
        const info = abilityInfo(s, 'a_ishi')!;
        expect(info.usable).toBe(false);
        expect(info.ready).toBe(false);
        expect(info.reason).toContain('180 m 以内に対象にできる味方の部隊がいない');
    });

    it('使うと対象の士気 +30（上限 100）・動き ×1.8・士気の低下 −50%（予備はさらに −25%）・敗走の線 5。ほかの部隊には効かない', () => {
        const s = createBattle(ishikawaScene());
        get(s, 'a_near').morale = 50; // （状態を直接変更）押されて下がった士気
        expect(useAbility(s, 'a_ishi', 'a_near')).toEqual({ ok: true, reason: null });
        expect(get(s, 'a_near').morale).toBe(80);
        expect(abilitySpeedMul(s, get(s, 'a_near'))).toBeCloseTo(1.8, 9);
        expect(abilitySpeedMul(s, get(s, 'a_far'))).toBe(1);
        // まだ斬り合っていない部隊＝予備：0.5 × 0.75
        expect(s.abilities.a_ishi!.reserveBonus).toBe(true);
        expect(abilityMoraleLossMul(s, get(s, 'a_near'))).toBeCloseTo(0.375, 9);
        expect(abilityMoraleLossMul(s, get(s, 'a_far'))).toBe(1);
        expect(abilityRoutMorale(s, get(s, 'a_near'), 15)).toBe(5);
        expect(abilityMarks(s, 'a_near')).toContain('後詰めの差配');
        expect(abilityInfo(s, 'a_ishi')).toMatchObject({ state: 'active', targetId: 'a_near', targetName: 'a_near', ready: false });
        const ev = s.events[s.events.length - 1]!;
        expect(ev).toMatchObject({ kind: 'ability', unitId: 'a_ishi', targetId: 'a_near', ability: 'ishikawa_reserve' });
    });

    it('（状態を直接変更）すでに斬り合った部隊（予備でない）は、士気の低下 −50% だけ。援軍（後から着いた）・同盟（別の家）は予備と同じく −62.5%', () => {
        const s = createBattle(ishikawaScene());
        get(s, 'a_near').lastMeleeT = 1; // 前に斬り合った
        useAbility(s, 'a_ishi', 'a_near');
        expect(s.abilities.a_ishi!.reserveBonus).toBe(false);
        expect(abilityMoraleLossMul(s, get(s, 'a_near'))).toBeCloseTo(0.5, 9);
        const t = createBattle(setup([U('a_ishi', 'ally', 'yari', 0, 100, N, G('ishikawa')), U('a_ally', 'ally', 'yari', 60, 100, N, { clan: 'asai' }), U('e_y', 'enemy', 'yari', 0, -100, S)]));
        get(t, 'a_ally').lastMeleeT = 1;
        useAbility(t, 'a_ishi', 'a_ally');
        expect(t.abilities.a_ishi!.reserveBonus).toBe(true);
        expect(abilityMoraleLossMul(t, get(t, 'a_ally'))).toBeCloseTo(0.375, 9);
    });

    it('再配置：対象は同じ時間でおよそ 1.8 倍進む（能力なしと比べる）。石川隊から離れても効く', () => {
        const a = createBattle(ishikawaScene());
        const b = createBattle(ishikawaScene());
        useAbility(b, 'a_ishi', 'a_near');
        for (const x of [a, b]) issueOrder(x, 'a_near', { type: 'move', x: 60, z: -150 });
        advance(a, 20);
        advance(b, 20);
        const ra = (100 - get(b, 'a_near').z) / (100 - get(a, 'a_near').z);
        expect(ra).toBeGreaterThan(1.7);
        expect(ra).toBeLessThan(1.9);
        // 石川隊から 180 m より離れても効き続ける（長政の援護と違い、外れない）
        expect(Math.hypot(get(b, 'a_near').x - 0, get(b, 'a_near').z - 100)).toBeGreaterThan(40);
        issueOrder(b, 'a_near', { type: 'move', x: 180, z: -180 });
        advance(b, 5);
        expect(abilitySpeedMul(b, get(b, 'a_near'))).toBeCloseTo(1.8, 9);
    });

    it('代償：効果中、石川隊は差配に専念して動けない（移動・攻撃・撤退を断る。待機は受ける）。与える損害は上がらない。30 秒で切れる', () => {
        const s = createBattle(ishikawaScene());
        const d = get(s, 'e_y');
        const before = meleeDamage(s, get(s, 'a_ishi'), d, 'front');
        useAbility(s, 'a_ishi', 'a_near');
        expect(isRooted(s, 'a_ishi')).toBe(true);
        expect(issueOrder(s, 'a_ishi', { type: 'move', x: 0, z: 0 })).toBe(false);
        expect(issueOrder(s, 'a_ishi', { type: 'retreat' })).toBe(false);
        expect(issueOrder(s, 'a_ishi', { type: 'hold' })).toBe(true);
        expect(orderLabel(s, get(s, 'a_ishi'))).toContain('差配に専念');
        expect(abilityDealMul(s, get(s, 'a_ishi'))).toBe(1);
        expect(meleeDamage(s, get(s, 'a_ishi'), d, 'front')).toBe(before);
        advance(s, 29.5);
        expect(abilityInfo(s, 'a_ishi')!.state).toBe('active');
        advance(s, 0.7);
        expect(abilityInfo(s, 'a_ishi')!.state).toBe('spent');
        expect(isRooted(s, 'a_ishi')).toBe(false);
        expect(issueOrder(s, 'a_ishi', { type: 'move', x: 0, z: 0 })).toBe(true);
    });

    it('立て直し：押されている味方を対象にすると、同じ場面の能力なしより士気が高く残り、崩れない', () => {
        const scene = () =>
            setup([
                U('a_ishi', 'ally', 'yari', 50, 90, N, G('ishikawa')),
                U('a_y', 'ally', 'yari', 0, 40, N, { morale: 70 }),
                U('e_y', 'enemy', 'yari', 0, 5, S, { strength: 600, morale: 90, order: { type: 'attack', targetId: 'a_y' } }),
            ]);
        const a = createBattle(scene());
        const b = createBattle(scene());
        advance(a, 5);
        advance(b, 5);
        useAbility(b, 'a_ishi', 'a_y');
        advance(a, 25);
        advance(b, 25);
        expect(get(b, 'a_y').morale).toBeGreaterThan(get(a, 'a_y').morale + 30);
        expect(get(b, 'a_y').status).toBe('ready');
    });
});

// ---------------------------------------------------------------- 榊原康政「先駆けの号」

function sakakibaraScene(): BattleSetup {
    return setup([U('a_saka', 'ally', 'yari', 0, 100, N, G('sakakibara')), U('a_near', 'ally', 'yari', 30, 100, N), U('e_y', 'enemy', 'yari', 0, -100, S), U('e_yumi', 'enemy', 'yumi', 150, -150, S)]);
}

describe('先駆けの号（榊原康政隊・仮）', () => {
    it('効果中、自分の部隊だけ動き ×1.8・受ける損害 ×1.2（近くの味方には効かない）。対象は選ばない', () => {
        const s = createBattle(sakakibaraScene());
        const e = get(s, 'e_y');
        const before = meleeDamage(s, e, get(s, 'a_saka'), 'front');
        expect(abilityInfo(s, 'a_saka')).toMatchObject({ target: 'self', needsTarget: false, validTargets: [], usable: true, ready: true });
        expect(useAbility(s, 'a_saka', 'a_near')).toEqual({ ok: true, reason: null });
        expect(s.abilities.a_saka!.targetId).toBeNull();
        expect(abilitySpeedMul(s, get(s, 'a_saka'))).toBeCloseTo(1.8, 9);
        expect(abilitySpeedMul(s, get(s, 'a_near'))).toBe(1);
        expect(meleeDamage(s, e, get(s, 'a_saka'), 'front') / before).toBeCloseTo(1.2, 9);
        expect(abilityMarks(s, 'a_saka')).toEqual(['先駆け']);
        expect(abilityMarks(s, 'a_near')).toEqual([]);
    });

    it('当たりの強さ：弓隊・退く敵へ ×1.5、側面・背後 ×1.3。最初に斬り合った 8 秒は ×2.0、その後は戻る。ほかの部隊の当たりは変わらない', () => {
        const s = createBattle(sakakibaraScene());
        const a = get(s, 'a_saka');
        const y = get(s, 'e_y');
        const yumi = get(s, 'e_yumi');
        expect(vanguardDealMul(s, a, y, 'front')).toBe(1);
        useAbility(s, 'a_saka');
        expect(vanguardDealMul(s, a, y, 'front')).toBe(1);
        expect(vanguardDealMul(s, a, yumi, 'front')).toBe(1.5);
        expect(vanguardDealMul(s, a, y, 'flank')).toBe(1.3);
        expect(vanguardDealMul(s, a, yumi, 'rear')).toBeCloseTo(1.95, 9);
        expect(vanguardDealMul(s, get(s, 'a_near'), yumi, 'rear')).toBe(1);
        // （状態を直接変更）撤退の命令で退く敵へは ×1.5
        y.order = { type: 'retreat' };
        expect(vanguardDealMul(s, a, y, 'front')).toBe(1.5);
    });

    it('最初の当たり：同じ場面で斬りかかると、能力ありの方が最初の 8 秒の敵の損害が 2 倍ほど（動きも速いので早く当たる）', () => {
        const scene = () => setup([U('a_saka', 'ally', 'yari', 0, 40, N, G('sakakibara')), U('e_y', 'enemy', 'yari', 0, 0, S, { strength: 600, morale: 90 })]);
        const a = createBattle(scene());
        const b = createBattle(scene());
        useAbility(b, 'a_saka');
        for (const x of [a, b]) issueOrder(x, 'a_saka', { type: 'attack', targetId: 'e_y' });
        const lost = (x: BattleState) => 600 - get(x, 'e_y').strength;
        // どちらも斬り合いに入ってから 8 秒の損害を比べる
        const upTo = (x: BattleState) => {
            while (!get(x, 'a_saka').engagedWith) advance(x, 0.1);
            const l0 = lost(x);
            advance(x, 8);
            return lost(x) - l0;
        };
        const la = upTo(a);
        const lb = upTo(b);
        expect(lb / la).toBeGreaterThan(1.8);
        expect(lb / la).toBeLessThan(2.3);
        expect(b.events.some((e) => e.kind === 'ability' && e.text.includes('先駆けて斬り込んだ'))).toBe(true);
        // 8 秒を過ぎると ×2.0 は切れる
        advance(b, 0.2);
        expect(vanguardDealMul(b, get(b, 'a_saka'), get(b, 'e_y'), 'front')).toBe(1);
    });

    it('代償：20 秒で切れたとき、榊原隊の士気 −15（切れた知らせにも書く）', () => {
        const s = createBattle(sakakibaraScene());
        useAbility(s, 'a_saka');
        advance(s, 19.9);
        expect(get(s, 'a_saka').morale).toBe(80);
        advance(s, 0.3);
        expect(abilityInfo(s, 'a_saka')!.state).toBe('spent');
        // 切れた刻みのうちに少しだけ戻る（戻りの決まり）ので、65 からわずかに上
        expect(get(s, 'a_saka').morale).toBeGreaterThanOrEqual(65);
        expect(get(s, 'a_saka').morale).toBeLessThan(66);
        const end = s.events.find((e) => e.kind === 'ability_end' && e.unitId === 'a_saka')!;
        expect(end.text).toContain('士気 −15');
        expect(end.ability).toBe('sakakibara_vanguard');
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

describe('共通の決まり（新しい武将の能力も今までと同じ）', () => {
    it('1 合戦 1 回。連打しても重ならない（2 回目は断り、効果の時間も延びない）', () => {
        const s = createBattle(sakakibaraScene());
        expect(useAbility(s, 'a_saka').ok).toBe(true);
        const until = s.abilities.a_saka!.until;
        advance(s, 3);
        const r = useAbility(s, 'a_saka');
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('効果中');
        expect(s.abilities.a_saka!.until).toBe(until);
        expect(abilitySpeedMul(s, get(s, 'a_saka'))).toBeCloseTo(1.8, 9);
        advance(s, 20);
        expect(useAbility(s, 'a_saka').reason).toContain('もう使った');
        // 石川：対象を替えて 2 回目を押しても断る
        const t = createBattle(ishikawaScene());
        expect(useAbility(t, 'a_ishi', 'a_near').ok).toBe(true);
        expect(useAbility(t, 'a_ishi', 'a_near').ok).toBe(false);
        expect(t.events.filter((e) => e.kind === 'ability')).toHaveLength(1);
    });
    it('一時停止中（合戦を進めない間）は効果の時間が減らない', () => {
        const s = createBattle(ishikawaScene());
        useAbility(s, 'a_ishi', 'a_near');
        advance(s, 5);
        const left = abilityInfo(s, 'a_ishi')!.remainingSec;
        // 進めない（一時停止）
        stepBattle(s, 0);
        expect(abilityInfo(s, 'a_ishi')!.remainingSec).toBe(left);
        expect(left).toBeCloseTo(25, 5);
        expect(abilityInfo(s, 'a_ishi')!.endsAt).toBeCloseTo(30, 5);
    });
    it('（状態を直接変更）使えない部隊（敗走中）では使えず、回数も減らない（点滅させない）。敵方の能力はプレイヤーが使えない', () => {
        const s = createBattle(
            setup([
                U('a_sakai', 'ally', 'yari', 0, 60, N, G('sakai')),
                U('e_ishi', 'enemy', 'yari', 0, -120, S, G('ishikawa')),
                U('e_b', 'enemy', 'yari', 30, -120, S),
            ]),
        );
        get(s, 'a_sakai').status = 'routed';
        const r = useAbility(s, 'a_sakai');
        expect(r.ok).toBe(false);
        expect(r.reason).toContain('敗走中');
        expect(abilityInfo(s, 'a_sakai')!.ready).toBe(false);
        expect(s.abilities.a_sakai!.usedAt).toBeNull();
        get(s, 'a_sakai').status = 'ready';
        expect(abilityInfo(s, 'a_sakai')!.ready).toBe(true);
        expect(useAbility(s, 'a_sakai').ok).toBe(true);
        expect(abilityInfo(s, 'a_sakai')!.ready).toBe(false);
        const e = useAbility(s, 'e_ishi', 'e_b');
        expect(e.ok).toBe(false);
        expect(s.abilities.e_ishi!.usedAt).toBeNull();
        expect(abilityInfo(s, 'e_ishi')!.controllable).toBe(false);
        expect(abilityInfo(s, 'e_ishi')!.ready).toBe(false);
    });
    it('abilityInfo：名前に（仮）、効果・代償・断り書きに仮と出る。範囲・武将の名前', () => {
        const s = createBattle(sakaiScene());
        const i = abilityInfo(s, 'a_sakai')!;
        expect(i.name).toBe('両翼の采配（仮）');
        expect(i.provisional).toBe(true);
        expect(i.effectText).toContain('仮');
        expect(i.costText).toContain('仮');
        expect(i.note).toContain('仮の能力');
        expect(i.note).toContain('ゲーム用の創作');
        expect(i.range).toBe(100);
        expect(i.rangeText).toContain('100 m');
        expect(i.target).toBe('self_area');
        expect(i.generalName).toBe('酒井忠次');
        expect(i.short.effect).toContain('×1.8');
    });
});

// ---------------------------------------------------------------- 敵方が持つとき（敵の考え）

describe('敵の考えが新しい武将の能力を使う', () => {
    it('先駆けの号：斬り合いになると使う', () => {
        const s = createBattle(setup([U('a_y', 'ally', 'yari', 0, 20, N), U('e_saka', 'enemy', 'yari', 0, -20, S, { ...G('sakakibara'), aiRole: 'hold_line' })]));
        advance(s, 1);
        expect(s.abilities.e_saka!.usedAt).toBeNull();
        issueOrder(s, 'a_y', { type: 'attack', targetId: 'e_saka' });
        advance(s, 15);
        expect(s.abilities.e_saka!.usedAt).not.toBeNull();
    });
    it('後詰めの差配：範囲に味方（敵方）が 2 部隊以上いて、斬り合いが始まると、斬り合っている部隊を対象に使う（斬り合いが無ければ使わない）', () => {
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
        expect(s.abilities.e_ishi!.targetId).toBe('e_a');
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
