/**
 * 夜（第4群の夜襲・奇襲）の表示から、未発見の敵の情報が漏れないこと（依頼本文の「夜襲で未発見部隊の情報が漏れない」。第4群のエンジンの要望）。
 * 判定（主目標の確保の数え方・区域を奪われる数え方）は変えず、画面に出すもの（進みの文・地図の輪の脈打ち・目標の欄・知らせ・陣営の様子・
 * 結果の表・戦場の決まりの文）だけが、味方から見えている（発見済みの）敵で決まることを確かめる。
 * 名札・兵士・画面の位置・援軍の印は e2e/fields-ui.mjs の night の part（本物の画面）と tests/proto3d-fields-group4.test.ts で確かめている。
 *
 * どれも「状態を直接操作」（部隊の位置・見えているか・士気を書き換えてから読む・進める）か「早送り」（stepBattle）。画面の操作ではない。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, RULES, stepBattle, unitById, type BattleState } from '../proto3d/src/battle/sim';
import { buildBattleSetup, getField } from '../proto3d/src/battle/fields';
import { deadlineName, endRuleConditions, endRuleItems, objectiveProgress } from '../proto3d/src/battle/objectives';
import { practiceBriefingInfo } from '../proto3d/src/campaign/practice';
import { armySummary, eventTone, fieldRuleTexts, scenarioTexts, objectivePanelModel, objectiveSummaryText, objectiveZoneCounting, objectiveZoneMarks, resultRows } from '../proto3d/src/battle/control';
import type { BattleOutcome } from '../proto3d/src/battle/types';

const night = () => createBattle(buildBattleSetup(getField('night_raid')!, 'standard'));
const primaryText = (s: BattleState) => objectiveProgress(s).find((p) => p.role === 'primary')!.progressText;
const inCamp = (x: number, z: number) => Math.hypot(x - 0, z + 120) <= 40;

describe('進みの文・目標の欄：未発見の敵を数えない（判定は変えない）', () => {
    it('夜襲の始め：敵陣の輪の中に陣の守り（未発見）がいても「区域に敵がいる」と出さない。見つけた後は出す', () => {
        const s = night();
        const camp = unitById(s, 'e_camp')!;
        expect(inCamp(camp.x, camp.z)).toBe(true);
        expect(camp.seenBy.ally).toBe(false);
        // 判定の側（確保を数えない理由）には敵がいる：味方が輪に入っても、陣の守りがいる間は数えない
        expect(primaryText(s)).toBe('確保 0／45 秒・区域に味方がいない（輪の中へ移動させる）');
        expect(primaryText(s)).not.toContain('敵');
        // 畳んだ見出し・目標の欄も同じ文から作る
        expect(objectiveSummaryText(objectivePanelModel(s)!.primary)).not.toContain('敵');
        // 見つけた（状態を直接操作）：出す
        camp.seenBy.ally = true;
        expect(primaryText(s)).toBe('確保 0／45 秒・区域に敵がいる（敵を追い出すと数え始める）');
    });

    it('判定は変えない：未発見の敵が輪にいる間は、味方が輪に入っても確保を数えない（早送り 1 刻み）', () => {
        const s = night();
        const a = unitById(s, 'a_sakai')!;
        // 味方を輪の縁（陣の守りから 40 m 余り）へ置く。陣の篝火の中なので、次の刻みで陣の守りを見つける＝見つけた後は「区域に敵がいる」
        a.x = 0;
        a.z = -82;
        stepBattle(s, RULES.tick);
        const r = s.objectives!.primary!;
        expect(r.sec).toBe(0);
        expect(unitById(s, 'e_camp')!.seenBy.ally).toBe(true);
        expect(primaryText(s)).toContain('区域に敵がいる');
    });

    it('守る区域（defend_zones）を敵に奪われかけている秒・地図の輪の脈打ちは、見えている敵が区域にいる間だけ（夜の湖・河岸を作って確かめる）', () => {
        const setup = buildBattleSetup(getField('shore')!, 'standard');
        setup.night = { sight: 120, detectRange: 70 };
        const s = createBattle(setup);
        const r = s.objectives!.primary!;
        // 岸の狭まりに敵の槍を置き、忠勝隊を外す。奪われている秒を直接 5 秒にする
        const e = unitById(s, 'e_shore_yari')!;
        e.x = 120;
        e.z = -40;
        const t = unitById(s, 'a_tadakatsu')!;
        t.x = 0;
        t.z = 150;
        r.zoneSec[0] = 5;
        e.seenBy.ally = false;
        const mark = objectiveZoneMarks(s).find((m) => m.id === 'shore_hold#0')!;
        expect(primaryText(s)).not.toContain('奪われている');
        expect(primaryText(s)).toContain('岸の狭まり ○');
        expect(objectiveZoneCounting(s, mark.id)).toBe(false);
        e.seenBy.ally = true;
        expect(primaryText(s)).toContain('岸の狭まりを敵に奪われている：5／15 秒');
        expect(objectiveZoneCounting(s, mark.id)).toBe(true);
    });

    it('敵の部隊を崩す副目標（break_unit）の進みの文は、一度も見つけていない敵の名前を出さない。見つけた後は名前を出す。昼は今までどおり', () => {
        // e2e/fields-group4.mjs（夜襲の画面の操作）で、目標の欄に見つけていない物見の名前「敵勢の物見」が出ていた
        const s = night();
        stepBattle(s, RULES.tick);
        const w = unitById(s, 'e_watch')!;
        const text = () => objectiveProgress(s).find((p) => p.id === 'raid_watch')!.progressText;
        expect(w.intel.t).toBeLessThan(0);
        expect(text()).not.toContain(w.name);
        expect(text()).toBe('まだ見つけていない');
        expect(JSON.stringify(objectivePanelModel(s))).not.toContain(w.name);
        // 見つけた（状態を直接操作：見た様子を書く）：名前を出す
        w.intel = { t: s.t, status: 'ready' };
        expect(text()).toBe(`${w.name}を崩す`);
        // 昼の戦場（夜の決まりの無い戦場）は見たかどうかによらず名前を出す（今までどおり）
        const d = createBattle(buildBattleSetup(getField('besieged_camp')!, 'standard'));
        const south = unitById(d, 'e_south')!;
        south.intel = { t: -1, status: 'ready' };
        expect(objectiveProgress(d).find((p) => p.id === 'camp_break')!.progressText).toBe(`${south.name}を崩す`);
    });
});

describe('知らせ・陣営の様子・結果の表（夜）', () => {
    it('未発見の敵が崩れた知らせは出さない（出来事に unseen の印・eventTone が null）。見えている敵の知らせは出す。陣営の様子も見た様子で数える', () => {
        const s = night();
        stepBattle(s, RULES.tick);
        const hidden = unitById(s, 'e_reserve')!;
        const seenOne = unitById(s, 'e_picket')!;
        expect(hidden.seenBy.ally).toBe(false);
        const before = armySummary(s, 'enemy');
        // 状態を直接操作：見えていない後詰めと、見えている（ことにした）番兵の士気を 0 にして 1 刻み進める
        seenOne.seenBy.ally = true;
        seenOne.intel = { t: s.t, status: 'ready' };
        hidden.morale = 0;
        const from = s.events.length;
        stepBattle(s, RULES.tick);
        const ev = s.events.slice(from).filter((e) => e.kind === 'rout');
        const evHidden = ev.find((e) => e.unitId === 'e_reserve')!;
        expect(hidden.status).toBe('routed');
        expect(evHidden.unseen).toBe(true);
        expect(eventTone(s, evHidden)).toBeNull();
        // 陣営の様子：見ていない間に崩れた後詰めは、まだ戦えることにして数える（本当は 1 隊減っている）
        const after = armySummary(s, 'enemy');
        expect(after.able).toBe(before.able);
        expect(s.units.filter((u) => u.side === 'enemy' && !u.isHq && u.status === 'ready').length).toBe(before.able - 1);
        // 見えている敵が崩れたら知らせる（早送りで番兵の士気を 0 に。番兵は辻の篝火の中）
        const a = unitById(s, 'a_tadakatsu')!;
        a.x = seenOne.x;
        a.z = seenOne.z + 40;
        stepBattle(s, RULES.tick);
        expect(seenOne.seenBy.ally).toBe(true);
        seenOne.morale = 0;
        const from2 = s.events.length;
        stepBattle(s, RULES.tick);
        const ev2 = s.events.slice(from2).find((e) => e.kind === 'rout' && e.unitId === 'e_picket')!;
        expect(ev2.unseen).toBeUndefined();
        expect(eventTone(s, ev2)).toBe('good');
        // 陣営の様子は、次の刻みに見た様子（崩れた）で数える
        stepBattle(s, RULES.tick);
        expect(armySummary(s, 'enemy').able).toBe(after.able - 1);
    });

    it('見つけていない所で崩れた敵：副目標（break_unit）の達成の知らせを出さず、目標の欄もまだ果たしていない形。見つけた後に果たした形（判定は変えない）', () => {
        const s = night();
        stepBattle(s, RULES.tick);
        const w = unitById(s, 'e_watch')!;
        expect(w.seenBy.ally).toBe(false);
        // 状態を直接操作：見えていない物見の士気を 0 にして 1 刻み
        w.morale = 0;
        const from = s.events.length;
        stepBattle(s, RULES.tick);
        expect(w.status).toBe('routed');
        const r = s.objectives!.secondary.find((x) => x.def.id === 'raid_watch')!;
        // 判定は変えない（果たした）
        expect(r.state).toBe('done');
        const note = s.events.slice(from).find((e) => e.kind === 'objective' && e.text.includes('物見'))!;
        expect(note.unitId).toBe('e_watch');
        expect(note.unseen).toBe(true);
        expect(eventTone(s, note)).toBeNull();
        const row = () => objectivePanelModel(s)!.secondary.find((x) => x.id === 'raid_watch')!;
        expect(row().state).toBe('active');
        expect(row().progressText).toBe('まだ見つけていない');
        // 見つけた（状態を直接操作：崩れた様子を見た）後は、果たした形
        w.intel = { t: s.t, status: 'routed' };
        expect(row().state).toBe('done');
    });

    it('見つけていない所で崩れた敵がいる間は、「敵の部隊はすべて崩れた」を知らせない。崩れを知ったら知らせる', () => {
        const s = night();
        stepBattle(s, RULES.tick);
        const enemies = s.units.filter((u) => u.side === 'enemy');
        // 状態を直接操作：敵をすべて崩す（どれも見ていない）
        for (const e of enemies) {
            e.status = 'routed';
            e.present = false;
        }
        stepBattle(s, RULES.tick);
        const told = () => s.events.some((e) => e.kind === 'objective' && e.text.includes('敵の部隊はすべて崩れた') && eventTone(s, e) !== null);
        expect(told()).toBe(false);
        for (const e of enemies) e.intel = { t: s.t, status: 'routed' };
        stepBattle(s, RULES.tick);
        expect(told()).toBe(true);
    });

    it('味方の部隊の出来事（「〇〇は△△を見失った」）は、相手の敵が見えなくなっても出す', () => {
        const s = night();
        stepBattle(s, RULES.tick);
        const p = unitById(s, 'e_picket')!;
        expect(p.seenBy.ally).toBe(true);
        expect(issueOrder(s, 'a_sakai', { type: 'attack', targetId: 'e_picket' })).toBe(true);
        // 状態を直接操作：番兵を遠く（篝火の外・誰からも 120 m より遠い所）へ移す → 次の刻みに見失う
        p.x = 200;
        p.z = -200;
        const from = s.events.length;
        stepBattle(s, RULES.tick);
        const e = s.events.slice(from).find((x) => x.kind === 'lost' && x.unitId === 'a_sakai')!;
        expect(e.text).toContain('見失った');
        expect(e.unseen).toBeUndefined();
        expect(eventTone(s, e)).not.toBeNull();
    });

    it('結果の表：一度も見つけなかった敵の部隊は兵の数を出さず「見つけていない」。敵の合計にも入れない。見つけた敵は今までどおり', () => {
        const s = night();
        stepBattle(s, RULES.tick);
        const seen = unitById(s, 'e_picket')!;
        expect(seen.seenBy.ally).toBe(true);
        const o = { result: 'retreat', reason: 'nightfall', elapsedSec: s.t, units: s.units.map((u) => ({ id: u.id, side: u.side, clan: u.clan, startStrength: u.startStrength, endStrength: u.strength, status: u.status })) } as BattleOutcome;
        const r = resultRows(s, o);
        const hid = r.rows.find((x) => x.id === 'e_reserve')!;
        expect(hid).toMatchObject({ unknown: true, status: '見つけていない', start: 0, end: 0, lost: 0 });
        expect(r.rows.find((x) => x.id === 'e_picket')!.unknown).toBeUndefined();
        const known = s.units.filter((u) => u.side === 'enemy' && u.intel.t >= 0);
        expect(r.start.enemy).toBe(known.reduce((a, u) => a + Math.round(u.startStrength), 0));
        // 昼の戦場は今までどおり（全部隊の兵を出す）
        const d = createBattle(buildBattleSetup(getField('shore')!, 'standard'));
        const od = { result: 'retreat', reason: 'nightfall', elapsedSec: 0, units: d.units.map((u) => ({ id: u.id, side: u.side, clan: u.clan, startStrength: u.startStrength, endStrength: u.strength, status: u.status })) } as BattleOutcome;
        expect(resultRows(d, od).rows.some((x) => x.unknown)).toBe(false);
    });
});

describe('戦場の決まりの文', () => {
    it('夜の奇襲は「奇襲（夜は林の外でも）」。昼の林の戦場は今までどおり「林の奇襲」', () => {
        const n = fieldRuleTexts(night()).join('|');
        expect(n).toContain('奇襲（夜は林の外でも）：見られていない部隊の最初の当たり ×1.5（8 秒）');
        expect(n).not.toContain('林の奇襲');
        expect(fieldRuleTexts(createBattle(buildBattleSetup(getField('forest')!, getField('forest')!.presets[0]!.id))).join('|')).toContain('林の奇襲：');
    });

    it('夜の時間切れは「夜明け」（データの NightRule.deadlineName）：判定の順・勝ち負けの条件・演習の説明・時間切れの結果の文。昼の戦場は「日没」のまま', () => {
        const s = night();
        expect(deadlineName(s.setup)).toBe('夜明け');
        const items = endRuleItems(s.setup).join('|');
        expect(items).toContain('夜明け（10:00）→ 撤退');
        expect(items).not.toContain('日没');
        expect(endRuleConditions(s).map((c) => c.text).join('|')).not.toContain('日没');
        expect(practiceBriefingInfo(getField('night_raid')!).deadlineName).toBe('夜明け');
        expect(scenarioTexts(s).reasons.nightfall).toBe('夜が明け、両軍とも兵を引いた');
        // 時間切れまで進める（早送り）：終わりの知らせも夜明けの文
        while (!s.result) stepBattle(s, RULES.tick);
        expect(s.result.reason).toBe('nightfall');
        expect(s.events[s.events.length - 1]!.text).toContain('夜が明け');
        const day = createBattle(buildBattleSetup(getField('shore')!, 'standard'));
        expect(deadlineName(day.setup)).toBe('日没');
        expect(endRuleItems(day.setup).join('|')).toContain('日没（');
        expect(scenarioTexts(day).reasons.nightfall).toBe('日が暮れ、両軍とも兵を引いた');
    });
});
