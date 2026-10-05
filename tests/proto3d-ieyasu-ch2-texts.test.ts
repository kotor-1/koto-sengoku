/**
 * 第二章の文が、実際に起きたことと合っているか（第二章の点検で見つかった食い違いの直し）。
 * - 敗北の文を、合戦の終わった理由で分ける（本陣が崩れた／主目標を果たせなかった／諸隊が崩れた）。戦後の忠勝・使者・戦後の案内・区切りの本文。
 * - C で第一章の約束を「斬り合う前に退いて」破った場合の、第二章の忠勝の文と区切りの本文（第一章の文と合う）。
 * - C の区切りの本文の「浪人衆との因縁」は、第二章の勝敗で分ける。
 * - 第一章の結果確認の下の文（第一章の記録として残る。第二章の兵・信頼・人物は第二章で動く）。
 * 偽の結果（ieyasu2OutcomeFromSetup に終わった理由を渡す）で作る。合戦の計算の確かめではない。
 */
import { describe, expect, it } from 'vitest';
import type { BattleEndReason } from '../proto3d/src/battle/types';
import { IEYASU_UNIT_IDS } from '../proto3d/src/battle/maps';
import {
    applyIeyasu2Outcome,
    devIeyasuCh1Ending,
    finishTalkIeyasu2,
    ieyasu2BattleSetup,
    ieyasu2OutcomeFromSetup,
    startChapter2,
    talkIeyasu2,
} from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import type { Ieyasu2State } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { ieyasu2Chapter1RecordView, ieyasu2EndingView, ieyasu2PhaseIntro } from '../proto3d/src/campaign/ieyasu1570/chapter2/story';
import type { Policy } from '../proto3d/src/campaign/ieyasu1570/state';
import { ch2From, toCh2Battle, toCh2Muster } from './proto3d-ieyasu-ch2-helpers';

const FROM: Record<Policy, 'oda_victory_kept' | 'asai_victory_kept' | 'home_victory_kept'> = { oda: 'oda_victory_kept', asai: 'asai_victory_kept', home: 'home_victory_kept' };

/** 偽の結果で敗北（終わった理由を指定） */
function defeatBy(policy: Policy, reason: Extract<BattleEndReason, 'ally_hq_routed' | 'objective_failed' | 'ally_army_broken'>): Ieyasu2State {
    const b = toCh2Battle(toCh2Muster(ch2From(FROM[policy])));
    const o = ieyasu2OutcomeFromSetup(ieyasu2BattleSetup(b), 'defeat', { reason });
    return applyIeyasu2Outcome(b, o);
}

function texts(a: Ieyasu2State): { tadakatsu: string; envoy: string; intro: string; ending: string } {
    const lines = (id: string) => talkIeyasu2(a, id).lines.map((l) => l.text).join('\n');
    const e = finishTalkIeyasu2(a, 'tadakatsu', 'end_chapter');
    const intro = ieyasu2PhaseIntro(a);
    return { tadakatsu: lines('tadakatsu'), envoy: lines('envoy'), intro: `${intro.title}\n${intro.text}`, ending: ieyasu2EndingView(e).body.join('\n') };
}

describe('敗北の文は、合戦の終わった理由で分ける', () => {
    it('偽の結果：主目標の失敗の敗北は、家康本陣が無事（理由 objective_failed）', () => {
        const a = defeatBy('oda', 'objective_failed');
        expect(a.battle!.result).toBe('defeat');
        expect(a.battle!.reason).toBe('objective_failed');
        expect(a.battle!.units.find((u) => u.id === IEYASU_UNIT_IDS.honjin)!.status).toBe('ready');
        expect(a.characters.ieyasu).toBe('alive');
        expect(a.result!.primary!.achieved).toBe(false);
        // 諸隊が崩れた：本陣のほかの徳川の部隊が崩れている
        const b = defeatBy('oda', 'ally_army_broken');
        expect(b.battle!.reason).toBe('ally_army_broken');
        expect(b.battle!.units.find((u) => u.id === IEYASU_UNIT_IDS.honjin)!.status).toBe('ready');
        expect(b.battle!.units.filter((u) => u.side === 'ally' && u.id !== IEYASU_UNIT_IDS.honjin).every((u) => u.status === 'routed')).toBe(true);
    });

    it('本陣が崩れた（ally_hq_routed）：今までどおり本陣が崩れた文', () => {
        for (const p of ['oda', 'asai', 'home'] as const) {
            const t = texts(defeatBy(p, 'ally_hq_routed'));
            expect(t.tadakatsu, p).toContain('本陣が崩れました');
            expect(t.intro, p).toContain('本陣は崩れた');
            expect(t.ending, p).toContain('本陣が崩れ');
        }
        expect(texts(defeatBy('oda', 'ally_hq_routed')).envoy).toContain('徳川殿も崩れたか');
    });

    it('主目標の失敗（objective_failed）：本陣が崩れたとは言わず、方針ごとの理由を言う', () => {
        const want: Record<Policy, RegExp> = {
            oda: /後備え.*小荷駄.*退き口でない所/s,
            asai: /浅井勢が崩れ.*連れ帰る兵/s,
            home: /屋敷の前を奪われ/,
        };
        for (const p of ['oda', 'asai', 'home'] as const) {
            const t = texts(defeatBy(p, 'objective_failed'));
            for (const [k, v] of Object.entries(t)) {
                expect(v, `${p}・${k}`).not.toMatch(/本陣が崩れ|本陣は崩れ|徳川殿も崩れた/);
            }
            expect(t.tadakatsu, p).toMatch(want[p]);
            expect(t.ending, p).toMatch(want[p]);
            expect(t.intro, p).not.toContain('落ち延びた');
        }
        expect(texts(defeatBy('oda', 'objective_failed')).envoy).toContain('撤収');
        expect(texts(defeatBy('asai', 'objective_failed')).envoy).toContain('連れ帰れなんだ');
    });

    it('諸隊が崩れた（ally_army_broken）：「諸隊が崩れた」', () => {
        for (const p of ['oda', 'asai', 'home'] as const) {
            const t = texts(defeatBy(p, 'ally_army_broken'));
            expect(t.tadakatsu, p).toContain('諸隊が崩れ');
            expect(t.intro, p).toContain('諸隊が崩れ');
            expect(t.ending, p).toContain('諸隊が崩れ');
            for (const [k, v] of Object.entries(t)) expect(v, `${p}・${k}`).not.toMatch(/本陣が崩れ|本陣は崩れ/);
        }
        expect(texts(defeatBy('asai', 'ally_army_broken')).envoy).toContain('諸隊も崩れた');
    });
});

describe('C：第一章の約束を斬り合う前に退いて破った場合（第一章の文と合う）', () => {
    // 守備隊は無事・兵も残る・約束は「破った」（斬り合う前に退いた）
    const unfought = () => startChapter2(devIeyasuCh1Ending('home', 'victory', 'broken'));
    it('前提：第一章の記録は「破った」で、守備隊は崩れずに兵が残っている', () => {
        const s = unfought();
        expect(s.chapter1.pledge.result).toBe('broken');
        const u = s.chapter1.battle.units.find((x) => x.id === s.chapter1.pledge.targetId)!;
        expect(u.status === 'routed' || u.status === 'destroyed').toBe(false);
    });
    it('城下の忠勝：「退かせきれなんだ」と言わず、刃を交える前に兵を引いたことを言う', () => {
        const text = talkIeyasu2(unfought(), 'tadakatsu').lines.map((l) => l.text).join('\n');
        expect(text).not.toContain('退かせきれなんだ');
        expect(text).toContain('刃を交える前');
    });
    it('区切りの本文も、刃を交える前に兵を引いたことを言う（斬り合って守りきれなかった場合は別の文）', () => {
        let s = toCh2Battle(toCh2Muster(unfought()));
        s = applyIeyasu2Outcome(s, ieyasu2OutcomeFromSetup(ieyasu2BattleSetup(s), 'victory'));
        const body = ieyasu2EndingView(finishTalkIeyasu2(s, 'tadakatsu', 'end_chapter')).body.join('\n');
        expect(body).toContain('刃を交える前');
        // 斬り合って守りきれなかった（守備隊が崩れた）
        let f = toCh2Battle(toCh2Muster(ch2From('home_defeat_broken_heavy')));
        f = applyIeyasu2Outcome(f, ieyasu2OutcomeFromSetup(ieyasu2BattleSetup(f), 'victory'));
        const body2 = ieyasu2EndingView(finishTalkIeyasu2(f, 'tadakatsu', 'end_chapter')).body.join('\n');
        expect(body2).not.toContain('刃を交える前');
        expect(body2).toContain('守備隊');
        // 城下の忠勝は今までどおり
        expect(talkIeyasu2(ch2From('home_defeat_broken_heavy'), 'tadakatsu').lines.map((l) => l.text).join('\n')).toContain('退かせきれなんだ');
    });
});

describe('C の区切りの本文：浪人衆との因縁は、第二章の勝敗で分ける', () => {
    it('第一章で退けられなかった：勝利なら「区切りがついた」、撤退・敗北なら「まだ続く」', () => {
        for (const r of ['victory', 'retreat', 'defeat'] as const) {
            let s = toCh2Battle(toCh2Muster(ch2From('home_retreat_declined')));
            s = applyIeyasu2Outcome(s, ieyasu2OutcomeFromSetup(ieyasu2BattleSetup(s), r));
            const body = ieyasu2EndingView(finishTalkIeyasu2(s, 'tadakatsu', 'end_chapter')).body.join('\n');
            if (r === 'victory') {
                expect(body, r).toContain('区切りがついた');
                expect(body, r).not.toContain('まだ続く');
            } else {
                expect(body, r).toContain('因縁はまだ続く');
                expect(body, r).not.toContain('区切りがついた');
            }
        }
    });
});

describe('第一章の結果確認の下の文', () => {
    it('第一章の記録としてそのまま残る（第二章の兵・信頼・人物は第二章で動く）。「第二章でも変わらずに残る」とは言わない', () => {
        const f = ieyasu2Chapter1RecordView(ch2From('oda_victory_kept')).footer ?? '';
        expect(f).toContain('第一章の記録として');
        expect(f).toContain('第二章で動く');
        expect(f).not.toContain('第二章でも変わらずに残る');
    });
});
