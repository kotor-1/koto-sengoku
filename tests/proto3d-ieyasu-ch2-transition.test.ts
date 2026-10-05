/**
 * 第一章の結末 → 第二章のはじめ（startChapter2）：
 * - 純粋（同じ入力 → 同じ出力。2 回呼んでも増えない。入力を書き換えない）・援兵を足さない・第一章の記録が凍結される。
 * - 引き受けなかった約束と、破った約束を区別する（会話の id・文・状態の欄・結果確認の行）。
 * - 版 1・2・3 の結末の保存（実物の文字列）から：読み込み → 結末 → 第二章へ → 第二章の状態が正しい。
 */
import { describe, expect, it } from 'vitest';
import { FlowError } from '../proto3d/src/campaign/flow';
import { devIeyasuCh1Ending, finishIeyasu2Chapter, finishTalkIeyasu2, startChapter2, talkIeyasu2 } from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import { ieyasu2Chapter1RecordView } from '../proto3d/src/campaign/ieyasu1570/chapter2/story';
import { isChapter2 } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { INITIAL_TOKUGAWA_TROOPS, INITIAL_TRUST, TOKUGAWA_UNIT_IDS } from '../proto3d/src/campaign/ieyasu1570/state';
import { snapshot } from './proto3d-campaign-helpers';
import { CH1_ENDINGS, ch2From, loadCh1, toCh2Aftermath, toCh2Battle, toCh2Muster } from './proto3d-ieyasu-ch2-helpers';
import { IEYASU_V1_ENDING_ASAI } from './proto3d-ieyasu-save-v1-fixtures';
import { IEYASU_V2_ENDING_HOME } from './proto3d-ieyasu-save-v2-fixtures';
import { IEYASU_V3_FIXTURES } from './proto3d-ieyasu-save-v3-fixtures';
import { ieyasuToMuster } from './proto3d-ieyasu-helpers';

const sumTroops = (t: Record<string, number>) => TOKUGAWA_UNIT_IDS.reduce((n, k) => n + t[k]!, 0);

describe('startChapter2：純粋・援兵を足さない・記録の凍結', () => {
    it('同じ入力 → 同じ出力。2 回呼んでも兵・信頼は増えない。入力は書き換えない', () => {
        for (const name of CH1_ENDINGS) {
            const ch1 = loadCh1(IEYASU_V3_FIXTURES[name]);
            const before = snapshot(ch1);
            const a = startChapter2(ch1);
            const b = startChapter2(ch1);
            expect(snapshot(a), name).toEqual(snapshot(b));
            expect(snapshot(ch1), name).toEqual(before);
            expect(a.chapter).toBe(2);
            expect(isChapter2(a)).toBe(true);
            expect(isChapter2(ch1)).toBe(false);
            expect(a.phase).toBe('explore');
            expect(a.policy).toBe(ch1.policy);
            expect(a.troops).toEqual(ch1.troops);
            expect(a.trust).toEqual(ch1.trust);
            expect(a.characters).toEqual(ch1.characters);
            expect(a.playTimeSec).toBe(ch1.playTimeSec);
            expect(a.plan).toBeNull();
            expect(a.recovery).toBeNull();
            expect(a.battle).toBeNull();
            expect(a.talked).toEqual({});
        }
    });

    it('援兵は第一章ですでに兵に入っている：第二章のはじめの兵＝第一章の終わりの兵（足さない。上限も超えない）', () => {
        for (const name of ['oda_victory_kept', 'asai_victory_kept', 'home_victory_kept'] as const) {
            const ch1 = loadCh1(IEYASU_V3_FIXTURES[name]);
            expect(ch1.support!.reinforcement).toBe(true);
            expect(ch1.support!.recovered).toBeGreaterThan(0);
            const s = startChapter2(ch1);
            expect(sumTroops(s.troops)).toBe(sumTroops(ch1.troops));
            for (const k of TOKUGAWA_UNIT_IDS) expect(s.troops[k]).toBeLessThanOrEqual(INITIAL_TOKUGAWA_TROOPS[k]);
            expect(s.chapter1.support.recovered).toBe(ch1.support!.recovered);
            // 結果確認：受け取り済み・兵に含む・第二章では足さない
            const rec = Object.fromEntries(ieyasu2Chapter1RecordView(s).record.map((r) => [r.label, r.value]));
            expect(rec['援兵']).toContain('第一章で受け取り済み');
            expect(rec['援兵']).toContain('第二章では足さない');
        }
    });

    it('第一章の結末でなければ移れない（戦後・支度・第二章の状態は FlowError）', () => {
        expect(() => startChapter2(loadCh1(IEYASU_V3_FIXTURES.oda_victory_kept_aftermath))).toThrow(FlowError);
        expect(() => startChapter2(ieyasuToMuster('oda'))).toThrow(FlowError);
        const s = ch2From('oda_victory_kept');
        expect(() => startChapter2(s as never)).toThrow(FlowError);
    });

    it('第一章の記録（chapter1）は第二章の最後まで変わらない', () => {
        for (const name of CH1_ENDINGS) {
            const s0 = ch2From(name);
            const frozen = snapshot(s0.chapter1);
            const end = finishIeyasu2Chapter(toCh2Aftermath(toCh2Battle(toCh2Muster(s0)), 'defeat'));
            expect(snapshot(end.chapter1), name).toEqual(frozen);
            expect(end.chapter1.troops).toEqual(s0.troops);
            expect(end.chapter1.trust).toEqual(s0.trust);
        }
    });
});

describe('引き受けなかった約束と、破った約束を区別する', () => {
    for (const p of ['oda', 'asai'] as const) {
        it(`${p}：使者の会話の id・文、状態の欄、結果確認の行が違う`, () => {
            const declined = startChapter2(devIeyasuCh1Ending(p, 'retreat', 'declined'));
            const broken = startChapter2(devIeyasuCh1Ending(p, 'retreat', 'broken'));
            expect(declined.chapter1.pledge.result).toBe('declined');
            expect(declined.chapter1.pledge.accepted).toBe(false);
            expect(broken.chapter1.pledge.result).toBe('broken');
            expect(broken.chapter1.pledge.accepted).toBe(true);
            const ed = talkIeyasu2(declined, 'envoy');
            const eb = talkIeyasu2(broken, 'envoy');
            expect(ed.id).toBe(`ch2.explore.envoy.${p}.declined`);
            expect(eb.id).toBe(`ch2.explore.envoy.${p}.broken`);
            const td = ed.lines.map((l) => l.text).join('\n');
            const tb = eb.lines.map((l) => l.text).join('\n');
            expect(td).not.toMatch(/守られなんだ/);
            expect(tb).toMatch(/守られなんだ/);
            expect(td).toMatch(/引き受けていただけなんだ/);
            // 石川も区別する
            expect(talkIeyasu2(declined, 'ishikawa').id).toBe('ch2.explore.ishikawa.declined');
            expect(talkIeyasu2(broken, 'ishikawa').id).toBe('ch2.explore.ishikawa.broken');
            expect(talkIeyasu2(declined, 'ishikawa').lines.map((l) => l.text).join('')).toContain('約束を破ったわけではございませぬ');
            const rd = Object.fromEntries(ieyasu2Chapter1RecordView(declined).record.map((r) => [r.label, r.value]));
            const rb = Object.fromEntries(ieyasu2Chapter1RecordView(broken).record.map((r) => [r.label, r.value]));
            expect(rd['約束']).toContain('引き受けなかった');
            expect(rd['約束']).toContain('約束違反ではない');
            expect(rb['約束']).toContain('守れなかった');
            // 信頼：引き受けなかった方は約束で動いていない（破った方は −25）
            expect(declined.trust[p]).toBeGreaterThan(broken.trust[p]);
        });
    }
    it('home：約束の相手は忠勝。忠勝の会話の id・文が違う', () => {
        const declined = startChapter2(devIeyasuCh1Ending('home', 'retreat', 'declined'));
        const broken = startChapter2(devIeyasuCh1Ending('home', 'retreat', 'broken'));
        const td = talkIeyasu2(declined, 'tadakatsu');
        const tb = talkIeyasu2(broken, 'tadakatsu');
        expect(td.id).toBe('ch2.explore.tadakatsu.home.retreat.declined');
        expect(tb.id).toBe('ch2.explore.tadakatsu.home.retreat.broken');
        expect(td.lines.map((l) => l.text).join('')).toContain('責める者はおりませぬ');
        // この第一章の結末は、守備隊が崩れずに残ったまま約束を破った（斬り合う前に兵を引いた）形。第一章の忠勝の文に合わせ、
        // 「退かせきれなんだ」ではなく、刃を交える前に兵を引いたことを言う（守備隊が崩れた場合は tests/proto3d-ieyasu-ch2-texts.test.ts）
        expect(tb.lines.map((l) => l.text).join('')).toContain('刃を交える前');
    });
});

describe('版 1・2・3 の結末の保存（実物）から第二章へ', () => {
    it('版 1（B 浅井・撤退・約束を守った）：家臣の信頼は初期値で補われ、副目標は記録なしのまま引き継ぐ', () => {
        const ch1 = loadCh1(IEYASU_V1_ENDING_ASAI);
        expect(ch1.phase).toBe('ending');
        const s = startChapter2(ch1);
        expect(s.policy).toBe('asai');
        expect(s.trust).toEqual({ ...INITIAL_TRUST, oda: 0, asai: 35, tadakatsu: 40 });
        expect(s.troops).toEqual({ honjin: 290, tadakatsu: 350, yumi: 330, reserve: 300 });
        expect(s.chapter1.sideObjectives).toBeNull();
        expect(s.chapter1.pledge.result).toBe('kept');
        expect(s.chapter1.support.recovered).toBe(150);
        // 会話・結果確認が作れる
        expect(talkIeyasu2(s, 'envoy').id).toBe('ch2.explore.envoy.asai.kept');
        expect(Object.fromEntries(ieyasu2Chapter1RecordView(s).record.map((r) => [r.label, r.value]))['副目標']).toContain('記録なし');
    });
    it('版 2（C 自領・撤退・約束を引き受けない）', () => {
        const s = startChapter2(loadCh1(IEYASU_V2_ENDING_HOME));
        expect(s.policy).toBe('home');
        expect(s.troops).toEqual({ honjin: 240, tadakatsu: 360, yumi: 280, reserve: 240 });
        expect(s.chapter1.pledge.result).toBe('declined');
        expect(s.chapter1.ending).toBe('retreat');
        expect(talkIeyasu2(s, 'tadakatsu').id).toBe('ch2.explore.tadakatsu.home.retreat.declined');
    });
    it('版 3（9 つの結末）：どれも第二章の城下から軍議・支度まで進める', () => {
        for (const name of CH1_ENDINGS) {
            const s = ch2From(name);
            expect(s.chapter1.ending).toBe(loadCh1(IEYASU_V3_FIXTURES[name]).ending);
            const m = toCh2Muster(s);
            expect(m.phase, name).toBe('muster');
            const b = toCh2Battle(m);
            expect(b.phase, name).toBe('battle');
        }
    });
    it('第二章のはじめから先の会話の済み印は、第一章の済み印と混ざらない', () => {
        const s = finishTalkIeyasu2(ch2From('oda_victory_kept'), 'notice');
        expect(Object.keys(s.talked)).toEqual(['explore.notice']);
    });
});
