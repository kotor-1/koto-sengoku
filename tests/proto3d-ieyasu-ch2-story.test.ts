/**
 * 第二章の文の検査（史実と創作の区別）。第一章の文の検査（tests/proto3d-ieyasu-story.test.ts の allTexts）と同じ禁止の言葉に、
 * 第二章の取り決めを足す：特定の史実の合戦の名前（金ヶ崎・小谷・姉川）を出さない・「再現」は否定の形だけ・信長は出さない・
 * 年月日を足さない。家康は死なず、一度の勝ち負けで家が決まらない。
 * 城下の配役：第一章と同じ置き場所で、壁や互いに重ならない。
 */
import { describe, expect, it } from 'vitest';
import type { BattleResultKind } from '../proto3d/src/battle/types';
import {
    availableCh2Plans,
    ch2RecoveryOptions,
    devIeyasuCh1Ending,
    finishTalkIeyasu2,
    ieyasu2BattleInfo,
    presentIeyasu2Talks,
    startChapter2,
    talkIeyasu2,
} from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import { ieyasu2CastFor, ieyasu2StatusLines } from '../proto3d/src/campaign/ieyasu1570/chapter2/scenario';
import type { Ieyasu2State, RecoveryChoice } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import {
    IEYASU2_CHAPTER_TITLE,
    IEYASU2_END_LABEL,
    IEYASU2_FIELD_LABEL,
    IEYASU2_NOTE,
    ieyasu2Chapter1RecordView,
    ieyasu2EndingView,
    ieyasu2Objective,
    ieyasu2PhaseIntro,
} from '../proto3d/src/campaign/ieyasu1570/chapter2/story';
import { POLICIES, type PledgeResult } from '../proto3d/src/campaign/ieyasu1570/state';
import { castColliders, type CastMember } from '../proto3d/src/explore/cast';
import { colliders, type Rect } from '../proto3d/src/layout';
import { CH1_ENDINGS, ch2From, toCh2Aftermath, toCh2Battle, toCh2Muster } from './proto3d-ieyasu-ch2-helpers';

const RESULTS: BattleResultKind[] = ['victory', 'retreat', 'defeat'];
const PLEDGES: PledgeResult[] = ['kept', 'broken', 'declined'];

/** 第二章の状態を広く集める（実物の保存 9 つ ＋ 直接作った 27 通り。各段階・判断・補充・結果） */
function allStates(): Ieyasu2State[] {
    const starts: Ieyasu2State[] = CH1_ENDINGS.map((n) => ch2From(n));
    for (const p of POLICIES) for (const r of RESULTS) for (const pl of PLEDGES) starts.push(startChapter2(devIeyasuCh1Ending(p, r, pl, { heavy: r === 'defeat' })));
    const out: Ieyasu2State[] = [];
    for (const s0 of starts) {
        out.push(s0);
        const council = finishTalkIeyasu2(s0, 'tadakatsu', 'open_council');
        out.push(council);
        for (const plan of availableCh2Plans(council)) {
            out.push(finishTalkIeyasu2(council, 'council', plan === 'commit' ? 'plan_commit' : 'plan_hold'));
            const m = toCh2Muster(s0, plan);
            out.push(m);
            const opts = ch2RecoveryOptions(m);
            for (const rec of ['wait', 'transfer', 'none'] as RecoveryChoice[]) {
                if (!opts[rec].available) continue;
                const mr = finishTalkIeyasu2(m, 'ishikawa', `recovery_${rec}`);
                out.push(mr);
                if (rec !== 'none') continue;
                for (const res of RESULTS) {
                    const a = toCh2Aftermath(toCh2Battle(m, rec), res);
                    out.push(a, finishTalkIeyasu2(a, 'tadakatsu', 'end_chapter'));
                }
            }
        }
    }
    return out;
}

function textsOf(s: Ieyasu2State): string[] {
    const out: string[] = [];
    const intro = ieyasu2PhaseIntro(s);
    out.push(intro.title, intro.text, ieyasu2Objective(s));
    for (const id of presentIeyasu2Talks(s)) {
        const sc = talkIeyasu2(s, id);
        out.push(...sc.lines.map((l) => `${l.name}：${l.text}`), ...(sc.choices ?? []).flatMap((c) => [c.label, c.detail ?? '', c.summary ?? '']));
    }
    out.push(...ieyasu2StatusLines(s).map((l) => l.value));
    if (s.phase === 'explore') {
        const r = ieyasu2Chapter1RecordView(s);
        out.push(r.title, ...r.body, ...r.record.map((x) => x.value), r.footer);
    }
    if (s.phase === 'ending') {
        const e = ieyasu2EndingView(s);
        out.push(e.title, ...e.body, ...e.record.map((x) => x.value), e.footer);
    }
    if (s.plan && (s.phase === 'muster' || s.phase === 'aftermath')) out.push(...ieyasu2BattleInfo(s).setup.briefing, ieyasu2BattleInfo(s).setup.map.name);
    return out;
}

describe('第二章の文：史実と創作の区別', () => {
    const states = allStates();
    const texts = states.flatMap(textsOf);
    const all = [IEYASU2_NOTE, IEYASU2_CHAPTER_TITLE, IEYASU2_FIELD_LABEL, IEYASU2_END_LABEL, ...texts].join('\n');

    it('十分に多くの状態と文を調べた', () => {
        expect(states.length).toBeGreaterThan(200);
        expect(texts.length).toBeGreaterThan(3000);
    });
    it('注記：第一章の直後の分岐した世界・特定の史実の合戦の再現ではない・創作', () => {
        expect(IEYASU2_NOTE).toContain('第一章の直後');
        expect(IEYASU2_NOTE).toContain('特定の史実の合戦を再現したものではありません');
        expect(IEYASU2_NOTE).toContain('創作');
        expect(IEYASU2_END_LABEL).toContain('第二章');
        expect(IEYASU2_END_LABEL).toContain('創作');
    });
    it('第一章と同じ禁止の言葉（姉川の再現・史実の浅井方の家康・逸話・縁戚・死）', () => {
        expect(all).not.toMatch(/姉川の戦いを再現|姉川を再現|史実どおり/);
        expect(all).not.toMatch(/史実でも浅井|史実では浅井に付/);
        expect(all).not.toMatch(/単騎/);
        expect(all).not.toMatch(/無傷|傷ひとつ/);
        expect(all).not.toMatch(/同盟を結んで|年来の同盟|義兄|妹|お市|縁戚|婚姻/);
        expect(all).not.toMatch(/討ち死に|戦死|自害|滅亡した|滅ぼした|家は滅んだ/);
        expect(all).not.toMatch(/宣戦布告する|両家を敵に/);
    });
    it('第二章の取り決め：特定の史実の合戦の名前を出さない・「再現」は否定の形だけ・信長は出さない・年月日を足さない', () => {
        expect(all).not.toMatch(/金ヶ崎|金ケ崎|小谷|姉川/);
        for (const m of all.matchAll(/再現/g)) {
            const after = all.slice(m.index!, m.index! + 20);
            expect(after, after).toMatch(/^再現(ではない|したものではありません|ではありません)/);
        }
        // 信長は出さない（「出ない」と断る文だけ）
        for (const m of all.matchAll(/信長/g)) {
            const after = all.slice(m.index!, m.index! + 20);
            expect(after, after).toMatch(/^信長(本人)?[^。\n]{0,12}出ない/);
        }
        expect(all).not.toMatch(/元亀二|元亀三|157[1-9]|\d+月\d+日/);
    });
    it('家康は死なず、一度の勝ち負けで家が決まらない（区切りの本文）', () => {
        const endings = states.filter((s) => s.phase === 'ending').map((s) => ieyasu2EndingView(s).body.join(''));
        expect(endings.length).toBeGreaterThan(20);
        for (const b of endings) expect(b).toMatch(/一度の(勝ち|負け|戦)で/);
        // B の勝利は分岐の創作と書く
        const asai = states.find((s) => s.phase === 'ending' && s.ending === 'ch2_asai_victory')!;
        expect(ieyasu2EndingView(asai).body.join('')).toContain('創作');
    });
    it('使者・村の使いの頼みは創作と注記する', () => {
        for (const p of POLICIES) {
            const s = ch2From(`${p}_victory_kept`);
            expect(talkIeyasu2(s, 'envoy').lines.map((l) => l.text).join('')).toContain('ゲーム用の創作');
        }
    });
});

describe('第二章の城下の配役', () => {
    it('置き場所が壁や互いに重ならず、話す相手には目印が 1 つ', () => {
        const walls: Rect[] = colliders();
        const overlap = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
        for (const s of allStates()) {
            if (s.phase !== 'explore' && s.phase !== 'muster' && s.phase !== 'aftermath') continue;
            const cast: CastMember<string>[] = ieyasu2CastFor(s);
            expect(cast.filter((c) => c.key).length).toBe(1);
            const solids = castColliders(cast);
            for (const r of solids) for (const w of walls) expect(overlap(r, w)).toBe(false);
            for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) expect(overlap(solids[i]!, solids[j]!)).toBe(false);
            // 支度だけ城門
            expect(cast.some((c) => c.kind === 'gate')).toBe(s.phase === 'muster');
            // 忠勝が負傷なら戦後は床几
            const tk = cast.find((c) => c.id === 'tadakatsu')!;
            expect(tk.pose).toBe(s.phase === 'aftermath' && s.characters.tadakatsu === 'wounded' ? 'sit' : 'stand');
        }
    }, 60_000);
});
