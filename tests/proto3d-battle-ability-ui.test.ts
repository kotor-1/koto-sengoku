/**
 * 合戦の画面の決まり（battle/control.ts）のうち、特殊能力・戦前の約束・シナリオの言葉の表示。
 * 歴史分岐の布陣（maps.ts の ieyasu1570Setup）と架空の第一章の布陣（demoSetup）で、画面に出す言葉と押したときの動きを確かめる。
 * 一部は状態を直接変える（位置・兵・状態を書き換える）テスト。その旨をテスト名に書く。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, stepBattle, unitById, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { IEYASU_INITIAL_TROOPS, IEYASU_SAFE_ZONE, demoSetup, ieyasu1570Setup, type IeyasuPolicy } from '../proto3d/src/battle/maps';
import {
    REASON_TEXT,
    abilitiesUsedText,
    abilityPanelModel,
    abilityShort,
    cardAbilityText,
    eventTone,
    pledgeLineModel,
    pledgeResultModel,
    refusalText,
    resolveTap,
    scenarioTexts,
    unitMarksText,
    type Selected,
} from '../proto3d/src/battle/control';
import type { BattleOutcome } from '../proto3d/src/battle/types';

function ieyasu(policy: IeyasuPolicy, pledge = true): BattleState {
    return createBattle(ieyasu1570Setup(policy, { troops: { ...IEYASU_INITIAL_TROOPS }, pledgeAccepted: pledge }));
}
function advance(s: BattleState, sec: number, each?: (s: BattleState) => void): void {
    const end = s.t + sec - 1e-9;
    while (s.t < end && !s.result) {
        each?.(s);
        stepBattle(s, 0.1);
    }
}
/** 敵を遠くへ置き、戦わずに時間だけ進める（状態を直接変える） */
function calm(s: BattleState): void {
    for (const u of s.units) {
        if (u.side !== 'enemy') continue;
        u.x = 160;
        u.z = -145;
        u.morale = 100;
    }
}

describe('押したときの決まり：援護の対象選び（pending ability）', () => {
    const ally: Selected = { id: 'a_nagamasa', side: 'ally', commandable: true };
    it('部隊（味方・敵・すぐ近く）を押すと対象に選ぶ。地面は案内だけ', () => {
        expect(resolveTap(ally, 'ability', { kind: 'unit', unitId: 't_tadakatsu', side: 'ally', x: 0, z: 0 })).toEqual({ type: 'abilityTarget', unitId: 't_tadakatsu' });
        expect(resolveTap(ally, 'ability', { kind: 'unit', unitId: 't_yumi', side: 'ally', x: 0, z: 0, near: true })).toEqual({ type: 'abilityTarget', unitId: 't_yumi' });
        // 敵を押しても攻撃の命令にはならない（対象として断られる）
        expect(resolveTap(ally, 'ability', { kind: 'unit', unitId: 'e_oda_sente', side: 'enemy', x: 0, z: 0 })).toEqual({ type: 'abilityTarget', unitId: 'e_oda_sente' });
        expect(resolveTap(ally, 'ability', { kind: 'ground', x: 1, z: 2 }).type).toBe('hint');
    });
    it('対象選びでなければ今までどおり', () => {
        expect(resolveTap(ally, 'none', { kind: 'unit', unitId: 'e_oda_sente', side: 'enemy', x: 0, z: 0 })).toEqual({ type: 'order', unitId: 'a_nagamasa', order: { type: 'attack', targetId: 'e_oda_sente' } });
    });
});

describe('シナリオの言葉', () => {
    it('架空の第一章は今までと同じ（仮シナリオ・REASON_TEXT・鷲尾勢・若殿）', () => {
        const s = createBattle(demoSetup('tashiro'));
        const t = scenarioTexts(s);
        expect(t.historical).toBe(false);
        expect(t.tag).toBe('仮シナリオ');
        expect(t.reasons).toBe(REASON_TEXT);
        expect(t.notes.victory).toContain('鷲尾勢');
        expect(t.notes.defeat).toContain('若殿');
    });
    it('歴史分岐は「1570年の情勢を背景にした架空の局地戦」、家康は落ち延びる（討死ではない）、家は滅ばない', () => {
        for (const p of ['oda', 'asai', 'home'] as const) {
            const t = scenarioTexts(ieyasu(p));
            expect(t.historical).toBe(true);
            expect(t.titleNote).toBe('1570年の情勢を背景にした架空の局地戦');
            const all = [...Object.values(t.reasons), ...Object.values(t.notes)].join('');
            expect(all).not.toMatch(/若殿|鷲尾|姉川/);
            expect(t.reasons.ally_hq_routed).toContain('討死ではない');
            expect(t.notes.defeat).toContain('滅ぶことはない');
        }
    });
});

describe('能力の欄（abilityPanelModel）', () => {
    it('家康本陣：使える → 使うと効果中（残り秒）→ 時間が過ぎると使用済み。回数も出す', () => {
        const s = ieyasu('oda');
        calm(s);
        const m0 = abilityPanelModel(s, 't_honjin')!;
        expect(m0.name).toBe('立て直しの号令');
        expect(m0.usable).toBe(true);
        expect(m0.tone).toBe('ready');
        expect(m0.uses).toContain('残り 1 回');
        expect(m0.short.target).toContain('90 m');
        expect(m0.note).toContain('ゲーム用の創作');
        expect(useAbility(s, 't_honjin').ok).toBe(true);
        const m1 = abilityPanelModel(s, 't_honjin')!;
        expect(m1.tone).toBe('active');
        expect(m1.stateText).toBe('効果中 残り 30 秒');
        expect(m1.usable).toBe(false);
        expect(cardAbilityText(s, 't_honjin')).toBe('号令 30 秒');
        advance(s, 12);
        expect(abilityPanelModel(s, 't_honjin')!.stateText).toBe('効果中 残り 18 秒');
        advance(s, 19);
        const m2 = abilityPanelModel(s, 't_honjin')!;
        expect(m2.tone).toBe('spent');
        expect(m2.uses).toContain('残り 0 回');
        expect(cardAbilityText(s, 't_honjin')).toBe('号令 済');
    });
    it('A の敵の浅井長政隊：敵方と出て、プレイヤーは使えない（理由つき）', () => {
        const s = ieyasu('oda');
        const m = abilityPanelModel(s, 'e_nagamasa')!;
        expect(m.tone).toBe('enemy');
        expect(m.usable).toBe(false);
        expect(m.reason).toContain('敵方');
        expect(m.info.controllable).toBe(false);
    });
    it('武将のいない部隊は能力の欄なし（null）。架空の第一章もなし', () => {
        expect(abilityPanelModel(ieyasu('oda'), 't_yumi')).toBeNull();
        expect(cardAbilityText(ieyasu('oda'), 't_yumi')).toBe('');
        const f = createBattle(demoSetup('tashiro'));
        for (const u of f.units) expect(abilityPanelModel(f, u.id)).toBeNull();
    });
    it('B の浅井長政隊：対象を選ぶ能力。近くに味方がいなければ使えない理由を出す（状態を直接変える）', () => {
        const s = ieyasu('asai');
        const m = abilityPanelModel(s, 'a_nagamasa')!;
        expect(m.info.target).toBe('ally_unit');
        expect(m.short.target).toContain('60 m');
        // 他の味方を遠くへ
        for (const u of s.units) if (u.side === 'ally' && u.id !== 'a_nagamasa') u.x = 170;
        const m2 = abilityPanelModel(s, 'a_nagamasa')!;
        expect(m2.usable).toBe(false);
        expect(m2.reason).toContain('60 m 以内に援護できる味方の部隊がいない');
    });
    it('援護を使った後：対象と、離れて外れている状態を出す（状態を直接変える）', () => {
        const s = ieyasu('asai');
        calm(s);
        const nag = unitById(s, 'a_nagamasa')!;
        const tad = unitById(s, 't_tadakatsu')!;
        tad.x = nag.x + 20;
        tad.z = nag.z + 10;
        expect(useAbility(s, 'a_nagamasa', 't_tadakatsu').ok).toBe(true);
        advance(s, 0.5);
        expect(abilityPanelModel(s, 'a_nagamasa')!.stateText).toContain('本多忠勝隊を援護中');
        expect(unitMarksText(s, 't_tadakatsu')).toBe('援護');
        tad.x = nag.x + 150;
        advance(s, 0.5);
        expect(abilityPanelModel(s, 'a_nagamasa')!.stateText).toContain('離れて外れている');
        expect(unitMarksText(s, 't_tadakatsu')).toContain('外れている');
    });
    it('短い説明の数値は ABILITY_DATA から', () => {
        expect(abilityShort('ieyasu_rally').effect).toContain('+25');
        expect(abilityShort('ieyasu_rally').effect).toContain('−40%');
        expect(abilityShort('tadakatsu_rearguard').effect).toContain('−50%');
        expect(abilityShort('tadakatsu_rearguard').cost).toContain('×1.15');
        expect(abilityShort('nagamasa_support').effect).toContain('−30%');
        expect(abilityShort('nagamasa_support').cost).toContain('×0.8');
    });
});

describe('踏みとどまる忠勝隊・知らせの色', () => {
    it('退路の守護の効果中は、移動の命令を断る理由に残り秒を出す（防衛・待機は受ける）', () => {
        const s = ieyasu('oda');
        calm(s);
        expect(useAbility(s, 't_tadakatsu').ok).toBe(true);
        const o = { type: 'move', x: 0, z: 0 } as const;
        expect(issueOrder(s, 't_tadakatsu', o)).toBe(false);
        expect(refusalText(s, 't_tadakatsu', o)).toContain('踏みとどまっている（残り 40 秒');
        expect(unitMarksText(s, 't_tadakatsu')).toBe('踏みとどまる');
        expect(issueOrder(s, 't_tadakatsu', { type: 'hold' })).toBe(true);
    });
    it('能力の知らせ：味方は good・敵は warn。約束の知らせ：崩れたら bad', () => {
        const s = ieyasu('oda');
        expect(eventTone(s, { t: 0, kind: 'ability', text: '', unitId: 't_honjin' })).toBe('good');
        expect(eventTone(s, { t: 0, kind: 'ability', text: '', unitId: 'e_nagamasa' })).toBe('warn');
        expect(eventTone(s, { t: 0, kind: 'ability_end', text: '', unitId: 't_honjin' })).toBe('info');
        expect(eventTone(s, { t: 0, kind: 'pledge', text: '', unitId: 'a_oda' })).toBe('good');
        unitById(s, 'a_oda')!.status = 'routed';
        expect(eventTone(s, { t: 0, kind: 'pledge', text: '', unitId: 'a_oda' })).toBe('bad');
    });
});

describe('約束の行・結果（pledgeLineModel・pledgeResultModel）', () => {
    it('約束のない合戦は行なし', () => {
        expect(pledgeLineModel(ieyasu('oda', false))).toBeNull();
        expect(pledgeLineModel(createBattle(demoSetup('tashiro')))).toBeNull();
    });
    it('陣の外 → 陣に入って 12/20 秒 → 持ちこたえた ✓（状態を直接変える：対象を陣へ置く）', () => {
        const s = ieyasu('oda');
        calm(s);
        const l0 = pledgeLineModel(s)!;
        expect(l0.title).toBe('約束：織田援軍の退路を守る');
        expect(l0.status).toBe('味方の陣の外（入って 20 秒） / 兵 100%');
        const oda = unitById(s, 'a_oda')!;
        const keep = (st: BattleState) => {
            const u = unitById(st, 'a_oda')!;
            u.x = IEYASU_SAFE_ZONE.cx + 10;
            u.z = IEYASU_SAFE_ZONE.cz;
        };
        keep(s);
        issueOrder(s, oda.id, { type: 'hold' });
        advance(s, 12, keep);
        expect(pledgeLineModel(s)!.status).toMatch(/^陣に入って 1[12]\/20 秒 \/ 兵 100%$/);
        advance(s, 9, keep);
        const l2 = pledgeLineModel(s)!;
        expect(l2.status).toContain('陣で 20 秒 持ちこたえた ✓');
        expect(l2.tone).toBe('ok');
    });
    it('兵が 40% 未満なら注意、崩れたら守れない（状態を直接変える）', () => {
        const s = ieyasu('home');
        const u = unitById(s, 't_reserve')!;
        u.strength = u.startStrength * 0.3;
        const l = pledgeLineModel(s)!;
        expect(l.tone).toBe('warn');
        expect(l.status).toContain('40% 未満では守れない');
        u.status = 'routed';
        const l2 = pledgeLineModel(s)!;
        expect(l2.tone).toBe('bad');
        expect(l2.status).toBe('守れない（岡崎の守備隊が崩れた）');
    });
    it('結果の欄：架空は null、引き受けていない＝約束違反ではない、守った・守れなかったは勝敗と別', () => {
        const f = createBattle(demoSetup('tashiro'));
        const base: BattleOutcome = { result: 'victory', reason: 'enemy_hq_routed', elapsedSec: 100, units: [] };
        expect(pledgeResultModel(f, base)).toBeNull();
        const d = pledgeResultModel(ieyasu('oda', false), base)!;
        expect(d.result).toBe('declined');
        expect(d.text).toContain('約束違反ではない');
        const s = ieyasu('oda');
        const row = (status: 'ready' | 'routed', end: number) => ({ id: 'a_oda', side: 'ally' as const, clan: 'oda' as const, startStrength: 400, endStrength: end, status });
        const kept = pledgeResultModel(s, { ...base, result: 'retreat', reason: 'ordered_retreat', units: [row('ready', 300)], pledge: { targetId: 'a_oda', result: 'kept' } })!;
        expect(kept.result).toBe('kept');
        expect(kept.title).toContain('約束を守った');
        expect(kept.text).toContain('兵 75%');
        const broken = pledgeResultModel(s, { ...base, units: [row('routed', 120)], pledge: { targetId: 'a_oda', result: 'broken' } })!;
        expect(broken.result).toBe('broken');
        expect(broken.text).toContain('織田援軍が敗走');
        expect(broken.text).toContain('勝敗とは別');
    });
    it('使った能力の記録：使った・使わなかった。架空は空', () => {
        const s = ieyasu('oda');
        const o: BattleOutcome = { result: 'victory', reason: 'enemy_hq_routed', elapsedSec: 100, units: [], abilitiesUsed: { t_honjin: 42 } };
        const t = abilitiesUsedText(s, o);
        expect(t).toContain('立て直しの号令：開始 0:42 に使った');
        expect(t).toContain('退路の守護：使わなかった');
        expect(t).not.toContain('盟友への援護'); // 敵方の能力は出さない
        expect(abilitiesUsedText(createBattle(demoSetup('tashiro')), { ...o, abilitiesUsed: undefined })).toBe('');
    });
});
