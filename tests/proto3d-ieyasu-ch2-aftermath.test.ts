/**
 * 第二章の戦後と区切り：
 * - 結果の反映は合戦の id ごとに 1 回だけ（同じ id で 2 回目は何もしない）。
 * - 信頼の表（相手の家：勝利 判断 1 +15・判断 2 +10／撤退 0／敗北 −5、C は動かない。忠勝 勝利 +5。酒井 勝利 +5・敗北 −5。石川 判断 1 −5）。
 * - 負傷（本陣・忠勝隊・B で長政が率いた隊が崩れたら）・出陣した部隊だけ兵が変わる・戦後の記録。
 * - 9 つの区切り（ch2_<方針>_<結果>）へ着く。区切りの画面に「次の章へ」は出さない。
 */
import { describe, expect, it } from 'vitest';
import type { BattleResultKind } from '../proto3d/src/battle/types';
import { IEYASU_UNIT_IDS } from '../proto3d/src/battle/maps';
import { FlowError } from '../proto3d/src/campaign/flow';
import { CH2_UNIT } from '../proto3d/src/campaign/ieyasu1570/chapter2/battle';
import {
    CH2_TRUST_DELTA,
    applyIeyasu2Outcome,
    applyIeyasu2OutcomeOnce,
    finishIeyasu2Chapter,
    finishTalkIeyasu2,
    ieyasu2BattleSetup,
    ieyasu2OutcomeFromSetup,
    parseIeyasu2Outcome,
    talkIeyasu2,
    withIeyasu2BattleId,
} from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import { IEYASU2_ENDING_IDS } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { IEYASU2_END_LABEL, ieyasu2EndingView } from '../proto3d/src/campaign/ieyasu1570/chapter2/story';
import { ieyasuScenario } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { POLICIES, TRUST_IDS } from '../proto3d/src/campaign/ieyasu1570/state';
import { snapshot } from './proto3d-campaign-helpers';
import { ch2From, toCh2Aftermath, toCh2Battle, toCh2Muster } from './proto3d-ieyasu-ch2-helpers';

const RESULTS: BattleResultKind[] = ['victory', 'retreat', 'defeat'];

describe('結果の反映は 1 回だけ', () => {
    it('同じ合戦の id で 2 回目は何もしない・違う id や段階では受け付けない', () => {
        const b = withIeyasu2BattleId(toCh2Battle(toCh2Muster(ch2From('oda_victory_kept'))), 'ieyasu1570-t-1');
        const o = ieyasu2OutcomeFromSetup(ieyasu2BattleSetup(b), 'victory');
        const first = applyIeyasu2OutcomeOnce(b, 'ieyasu1570-t-1', o);
        expect(first.applied).toBe(true);
        expect(first.state.phase).toBe('aftermath');
        expect(first.state.appliedBattleId).toBe('ieyasu1570-t-1');
        const again = applyIeyasu2OutcomeOnce(first.state, 'ieyasu1570-t-1', o);
        expect(again.applied).toBe(false);
        expect(again.state).toBe(first.state);
        expect(() => applyIeyasu2OutcomeOnce(first.state, 'ieyasu1570-t-2', o)).toThrow(FlowError);
        expect(() => applyIeyasu2Outcome(toCh2Muster(ch2From('oda_victory_kept')), o)).toThrow(FlowError);
    });
    it('合戦の結果の検査：主目標で終わった理由は勝利・敗北の組だけ', () => {
        const b = toCh2Battle(toCh2Muster(ch2From('home_victory_kept')));
        const o = ieyasu2OutcomeFromSetup(ieyasu2BattleSetup(b), 'victory');
        expect(o.reason).toBe('objective_done');
        expect(parseIeyasu2Outcome(o)).not.toBeNull();
        expect(parseIeyasu2Outcome({ ...o, result: 'retreat' })).toBeNull();
        expect(parseIeyasu2Outcome({ ...o, result: 'defeat', reason: 'objective_failed' })).not.toBeNull();
        expect(parseIeyasu2Outcome({ ...o, reason: 'objective_failed' })).toBeNull();
        expect(parseIeyasu2Outcome({ ...o, withdrawal: 'maybe' })).toBeNull();
        expect(() => applyIeyasu2Outcome(b, { ...o, result: 'retreat' })).toThrow(FlowError);
    });
});

describe('信頼の表・兵・負傷・記録', () => {
    for (const p of POLICIES)
        for (const plan of ['commit', 'hold'] as const)
            for (const r of RESULTS) {
                it(`${p}・${plan}・${r}`, () => {
                    const m = toCh2Muster(ch2From(`${p}_victory_kept`), plan);
                    const b = toCh2Battle(m, 'none');
                    const a = toCh2Aftermath(b, r);
                    const d = Object.fromEntries(TRUST_IDS.map((k) => [k, a.trust[k] - b.trust[k]]));
                    const partner = p === 'oda' ? 'oda' : p === 'asai' ? 'asai' : null;
                    const P = CH2_TRUST_DELTA.partner;
                    expect(d.oda).toBe(partner === 'oda' ? (r === 'victory' ? P.victory[plan] : r === 'retreat' ? P.retreat : P.defeat) : 0);
                    expect(d.asai).toBe(partner === 'asai' ? (r === 'victory' ? P.victory[plan] : r === 'retreat' ? P.retreat : P.defeat) : 0);
                    expect(d.tadakatsu).toBe(r === 'victory' ? 5 : 0);
                    expect(d.sakai).toBe(r === 'victory' ? 5 : r === 'defeat' ? -5 : 0);
                    expect(d.ishikawa).toBe(plan === 'commit' ? -5 : 0);
                    expect(d.sakakibara).toBe(0);
                    expect(a.result!.trustDelta).toEqual(d);
                    // 兵：出陣した部隊だけ変わる（判断 2 は守備隊が城に残る）
                    expect(a.result!.sortie.includes('reserve')).toBe(plan === 'commit');
                    if (plan === 'hold') expect(a.troops.reserve).toBe(b.troops.reserve);
                    for (const k of a.result!.sortie) {
                        const u = a.battle!.units.find((x) => x.id === IEYASU_UNIT_IDS[k])!;
                        expect(a.troops[k]).toBe(u.endStrength);
                        expect(a.result!.lost[k]).toBe(u.startStrength - u.endStrength);
                        expect(a.result!.sortieTroops[k]).toBe(u.startStrength);
                    }
                    // 記録
                    expect(a.result!.plan).toBe(plan);
                    expect(a.result!.recovery).toBe('none');
                    expect(a.result!.primary!.achieved).toBe(r === 'victory');
                    expect(a.result!.secondary.length).toBeGreaterThan(0);
                    // 区切り
                    const e = finishIeyasu2Chapter(a);
                    expect(e.ending).toBe(`ch2_${p}_${r}`);
                });
            }

    it('負傷：本陣が崩れたら家康、忠勝隊が崩れたら忠勝、B で長政の隊が崩れたら長政', () => {
        const b = toCh2Battle(toCh2Muster(ch2From('asai_victory_kept'), 'commit'));
        expect(b.characters).toMatchObject({ ieyasu: 'alive', tadakatsu: 'alive', nagamasa: 'alive' });
        const a = toCh2Aftermath(b, 'defeat', { units: { [IEYASU_UNIT_IDS.tadakatsu]: { status: 'routed', end: 30 }, [CH2_UNIT.asai]: { status: 'routed', end: 40 } } });
        expect(a.characters).toMatchObject({ ieyasu: 'wounded', tadakatsu: 'wounded', nagamasa: 'wounded' });
        // 撤退では誰も負傷しない
        const r = toCh2Aftermath(b, 'retreat');
        expect(r.characters).toMatchObject({ ieyasu: 'alive', tadakatsu: 'alive', nagamasa: 'alive' });
        // A：長政は敵にも味方にもいない（負傷させない）
        const oa = toCh2Aftermath(toCh2Battle(toCh2Muster(ch2From('oda_victory_kept'))), 'defeat');
        expect(oa.characters.nagamasa).toBe('alive');
        // 戦後の会話：忠勝の負傷は床几（配役）・台詞
        expect(talkIeyasu2(a, 'tadakatsu').lines.map((l) => l.text).join('')).toContain('浅手');
    });

    it('補充の記録は戦後にも残り、第一章の記録は変わらない', () => {
        const m = toCh2Muster(ch2From('oda_defeat_broken_heavy'));
        const frozen = snapshot(m.chapter1);
        const a = toCh2Aftermath(toCh2Battle(m, 'wait'), 'victory');
        expect(a.result!.recovery).toBe('wait');
        expect(a.recovery!.choice).toBe('wait');
        expect(snapshot(a.chapter1)).toEqual(frozen);
    });
});

describe('9 つの区切り', () => {
    it('方針 × 結果で 9 つ。題・本文（2〜4 段落）・記録・footer。家康は死なず、一度の勝ち負けで家が決まらない', () => {
        const seen = new Set<string>();
        for (const p of POLICIES)
            for (const r of RESULTS) {
                const e = finishTalkIeyasu2(toCh2Aftermath(toCh2Battle(toCh2Muster(ch2From(`${p}_retreat_declined`))), r), 'tadakatsu', 'end_chapter');
                expect(e.phase).toBe('ending');
                const v = ieyasu2EndingView(e);
                seen.add(v.id);
                expect(v.body.length).toBeGreaterThanOrEqual(2);
                expect(v.body.length).toBeLessThanOrEqual(4);
                const body = v.body.join('\n');
                expect(body).toMatch(/一度の(勝ち|負け|戦)で/);
                expect(body).not.toMatch(/討ち死に|戦死|自害|滅亡した|家は滅んだ/);
                expect(v.footer).toBe(IEYASU2_END_LABEL);
                const rec = Object.fromEntries(v.record.map((x) => [x.label, x.value]));
                for (const label of ['方針', '第一章', '判断', '補充', '合戦の結果', '主目標', '副目標', '徳川の兵', '部隊ごとの兵', '支援', '信頼', '信頼の変化', '人物', '特殊能力', '史実と創作']) expect(rec[label], `${v.id} ${label}`).toBeTruthy();
                expect(rec['信頼の変化']).toContain('第二章のはじめから');
                expect(rec['徳川の兵']).toContain('第二章のはじめ → 今');
                expect(rec['第一章']).toContain('引き受けなかった');
                expect(rec['史実と創作']).toContain('特定の史実の合戦の再現ではない');
                // 第二章の区切りには先へのボタンを出さない
                expect(ieyasuScenario(null).nextChapter!(e)).toBeNull();
            }
        expect([...seen].sort()).toEqual([...IEYASU2_ENDING_IDS].sort());
    });
});
