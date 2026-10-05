/**
 * 歴史分岐「元亀元年・家康」の物見（story/scout.ts）と、軍議・合戦の前の説明への反映。直接状態変更のテスト
 * （状態は flow の関数を普通の順に呼ぶ。物見は ieyasuScout を直接呼ぶ＝画面の物見の眺めは通さない）。
 *
 * - 地点：探索・支度だけ（物見櫓の 1 か所 'lookout'・方角の印 3 つ）。軍議・合戦・戦後・結末はできない。城下の物見櫓の相手も同じ段階だけ。
 * - 記録は純粋：同じ印をもう一度入れても増えない・今の任務の印だけ・兵や信頼や確定した条件は変えない。合戦の結果を反映すると消える。
 * - 中身は戦場の地形のデータから（数は戦場のデータと同じ）。存在しない道を作らない。敵の居場所・伏兵・援軍・敵の配置は出さない。
 * - 反映：軍議の選択肢の説明に「物見：…」、合戦の前の説明に「物見で確かめた：…」。記録が無ければ今までと同じ文。
 *   合戦の設定は説明の文のほかは同じで、合戦の計算は 1 刻みも同じ（同じ設定を 1 刻みずつ進めて比べる）。
 */
import { describe, expect, it } from 'vitest';
import { BORDER_FIELD_DEF } from '../proto3d/src/battle/fields/border_field';
import { createBattle, runToEnd } from '../proto3d/src/battle/sim';
import type { BattleSetup } from '../proto3d/src/battle/types';
import { CH2_FIELDS } from '../proto3d/src/campaign/ieyasu1570/chapter2/battle';
import { applyIeyasu2Outcome, finishTalkIeyasu2, ieyasu2BattleSetup, ieyasu2OutcomeFromSetup, startChapter2, talkIeyasu2 } from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import type { Ieyasu2State } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { applyIeyasuOutcome, finishTalkIeyasu, ieyasuBattleSetup, ieyasuOutcomeFromSetup, newIeyasuGame, talkIeyasu } from '../proto3d/src/campaign/ieyasu1570/flow';
import { ieyasuCastFor, ieyasuScenario } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { ieyasu2CastFor } from '../proto3d/src/campaign/ieyasu1570/chapter2/scenario';
import { POLICIES, type IeyasuState, type Policy } from '../proto3d/src/campaign/ieyasu1570/state';
import {
    LOOKOUT_ID,
    SCOUT_MARK_IDS,
    canScout,
    ieyasuScout,
    ieyasuScoutPoints,
    scoutBriefingLine,
    scoutEntries,
    scoutMissionOf,
} from '../proto3d/src/campaign/ieyasu1570/story/scout';
import { LOOKOUT } from '../proto3d/src/town/spots';
import { answerPledge, ieyasuToMuster } from './proto3d-ieyasu-helpers';
import { ch1BeforeBattle, ch1Cases, ch1Ending, ch2Battle, ch2Cases, ch2Muster, ch2Starts, checkBannedWords } from './proto3d-ieyasu-story-states';

const CH1 = ch1Cases().filter((c) => c.loss !== 'light');
const CH2_STARTS = ch2Starts(CH1);
const CH2 = ch2Cases(CH2_STARTS.filter((c) => c.ch1.pledge !== 'unfought'));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const MISSION_IDS = { oda: SCOUT_MARK_IDS.rear, asai: SCOUT_MARK_IDS.relief, home: SCOUT_MARK_IDS.village } as const;
const ALL_IDS = Object.values(SCOUT_MARK_IDS).flat();
/** 物見の記録を除いた状態（ほかの欄が変わっていないことの確かめ） */
const withoutScout = <S extends { scout?: string[] }>(s: S) => {
    const c = clone(s);
    delete c.scout;
    return c;
};

describe('物見の地点（探索・支度だけ）と城下の物見櫓', () => {
    it('第一章：探索・支度は物見櫓の 1 か所・方角の印 3 つ（国境の原と要所）。軍議・出陣・戦後・結末はできない', () => {
        for (const { name, state } of ch1BeforeBattle()) {
            const pts = ieyasuScoutPoints(state);
            const ok = state.phase === 'explore' || state.phase === 'muster';
            expect(pts.length, name).toBe(ok ? 1 : 0);
            expect(ieyasuCastFor(state).some((m) => m.id === LOOKOUT_ID), name).toBe(ok);
            if (!ok) continue;
            expect(pts[0]!.id).toBe(LOOKOUT_ID);
            expect(pts[0]!.marks.map((m) => m.id)).toEqual([...SCOUT_MARK_IDS.border]);
        }
        for (const c of CH1) {
            expect(ieyasuScoutPoints(c.state)).toEqual([]);
            expect(ieyasuScoutPoints(ch1Ending(c.state))).toEqual([]);
            expect(ieyasuCastFor(c.state).some((m) => m.id === LOOKOUT_ID)).toBe(false);
        }
    });
    it('第二章：任務の戦場の印（A 退き口・B 孤立した丘・C 村）。探索・支度だけ', () => {
        for (const { name, state } of CH2) {
            const pts = ieyasuScoutPoints(state);
            const ok = state.phase === 'explore' || state.phase === 'muster';
            expect(pts.length, name).toBe(ok ? 1 : 0);
            expect(ieyasu2CastFor(state as Ieyasu2State).some((m) => m.id === LOOKOUT_ID), name).toBe(ok);
            if (ok) expect(pts[0]!.marks.map((m) => m.id)).toEqual([...MISSION_IDS[state.policy as Policy]]);
        }
    }, 60_000);
    it('方角の印は互いに離れていて（見回して選べる）、戦場の方角は地図の向き。物見櫓の相手は town/spots.ts の LOOKOUT・目印なし・当たり判定なし', () => {
        for (const s of [newIeyasuGame(), ...CH2_STARTS.slice(0, 12).map((c) => c.state)]) {
            const marks = ieyasuScoutPoints(s)[0]!.marks;
            for (let i = 0; i < marks.length; i++)
                for (let j = i + 1; j < marks.length; j++) {
                    const d = Math.abs(Math.atan2(Math.sin(marks[i]!.heading - marks[j]!.heading), Math.cos(marks[i]!.heading - marks[j]!.heading)));
                    expect(d).toBeGreaterThan(0.4);
                }
            for (const m of marks) expect(m.label.length).toBeGreaterThan(1);
        }
        const lk = ieyasuCastFor(newIeyasuGame()).find((m) => m.id === LOOKOUT_ID)!;
        expect(lk).toMatchObject({ kind: 'lookout', x: LOOKOUT.x, z: LOOKOUT.z, key: false, solid: null, label: '物見櫓', verb: '物見' });
        // 会話の相手ではない（canTalk は false。物見は ChapterGame が kind で振り分ける）
        expect(ieyasuScenario(null).canTalk(newIeyasuGame(), LOOKOUT_ID)).toBe(false);
    });
});

describe('物見の記録（純粋）', () => {
    it('同じ印をもう一度入れても増えない。並びは方角の印の並び。今の任務の印でない物・違う地点は記録しない。受け取った状態は変えない', () => {
        const s0 = newIeyasuGame();
        const before = clone(s0);
        const s1 = ieyasuScout(s0, LOOKOUT_ID, ['border.flanks']);
        expect(s0).toEqual(before);
        expect(s1.scout).toEqual(['border.flanks']);
        expect(ieyasuScout(s1, LOOKOUT_ID, ['border.flanks'])).toBe(s1);
        expect(ieyasuScout(clone(s1), LOOKOUT_ID, ['border.flanks', 'border.flanks'])).toEqual(s1);
        const s2 = ieyasuScout(s1, LOOKOUT_ID, ['border.field', 'rear.neck', 'nope']);
        expect(s2.scout).toEqual(['border.field', 'border.flanks']);
        expect(ieyasuScout(s2, 'other', ['border.hill'])).toBe(s2);
        expect(ieyasuScout(s0, LOOKOUT_ID, [])).toBe(s0);
        // 2 回呼んでも同じ（同じ入力なら同じ結果）
        expect(ieyasuScout(s0, LOOKOUT_ID, ['border.hill', 'border.field'])).toEqual(ieyasuScout(s0, LOOKOUT_ID, ['border.field', 'border.hill']));
        // シナリオの口も同じ
        expect(ieyasuScenario(null).scout!(s0, LOOKOUT_ID, ['border.flanks'])).toEqual(s1);
    });
    it('兵・信頼・人物・約束・会話の済み印・確定した条件・補充は変えない（記録の欄だけ）', () => {
        for (const { state } of [...ch1BeforeBattle(), ...CH2.filter((x) => x.state.phase === 'explore' || x.state.phase === 'muster')]) {
            const ids = scoutMissionOf(state) === 'border' ? SCOUT_MARK_IDS.border : MISSION_IDS[state.policy as Policy];
            const after = ieyasuScout(state, LOOKOUT_ID, [...ids]);
            if (!canScout(state)) {
                expect(after).toBe(state);
                continue;
            }
            expect(after.scout).toEqual([...ids]);
            expect(withoutScout(after)).toEqual(withoutScout(state));
        }
    }, 60_000);
    it('第二章：ほかの任務の印は受け付けない。記録は会話・軍議・補充・出陣を通っても残り、合戦の結果を反映すると消える', () => {
        for (const c of CH2_STARTS.slice(0, 36)) {
            const p = c.state.policy;
            const s = ieyasuScout(c.state, LOOKOUT_ID, ALL_IDS);
            expect(s.scout).toEqual([...MISSION_IDS[p]]);
            const m = ch2Muster(s, 'commit');
            expect(m.scout).toEqual([...MISSION_IDS[p]]);
            const b = ch2Battle(m);
            expect(b.scout).toEqual([...MISSION_IDS[p]]);
            const a = applyIeyasu2Outcome(b, ieyasu2OutcomeFromSetup(ieyasu2BattleSetup(b), 'victory'));
            expect('scout' in a).toBe(false);
        }
    });
    it('第一章：記録は第二章へ持ち越さない（合戦の結果を反映すると消え、第二章のはじめに無い）', () => {
        let s: IeyasuState = ieyasuScout(newIeyasuGame(), LOOKOUT_ID, [...SCOUT_MARK_IDS.border]);
        s = finishTalkIeyasu(s, 'tadakatsu', 'open_council');
        s = finishTalkIeyasu(finishTalkIeyasu(s, 'council', 'policy_home'), 'council', 'confirm_policy');
        s = finishTalkIeyasu(answerPledge(s, 'accept'), 'gate', 'depart');
        expect(s.scout).toEqual([...SCOUT_MARK_IDS.border]);
        const a = applyIeyasuOutcome(s, ieyasuOutcomeFromSetup(ieyasuBattleSetup(s), 'victory', { pledge: 'kept' }));
        expect('scout' in a).toBe(false);
        expect('scout' in startChapter2(ch1Ending(a))).toBe(false);
    });
});

describe('記録の中身は戦場の地形のデータから（存在しない道を作らない・敵のことは出さない）', () => {
    const entriesOf = (s: IeyasuState | Ieyasu2State) => scoutEntries(ieyasuScout(s, LOOKOUT_ID, ALL_IDS));
    const ch1 = entriesOf(newIeyasuGame());
    const ch2 = (p: Policy) => entriesOf(CH2_STARTS.find((c) => c.state.policy === p)!.state);
    it('数は戦場のデータと同じ（広さ・丘の高さ・崖の切れ目の幅・狭い正面の隊数・通りと柵の数）', () => {
        const F = BORDER_FIELD_DEF;
        const t = (es: ReturnType<typeof entriesOf>, id: string) => es.find((e) => e.id === id)!.text;
        expect(t(ch1, 'border.field')).toContain(`東西 ${F.width} m・南北 ${F.depth} m`);
        const hill = F.terrain.find((x) => x.kind === 'hill')!;
        expect(t(ch1, 'border.hill')).toContain(`高さ ${hill.height} m`);
        const R = CH2_FIELDS.oda;
        const cliffs = R.terrain.filter((x) => x.kind === 'cliff').map((x) => x.rect!);
        const gap = Math.max(...cliffs.map((r) => r.x0)) - Math.min(...cliffs.map((r) => r.x1));
        const narrow = R.specialRules!.find((x) => x.type === 'narrow_frontage') as { maxEngaged: number };
        expect(t(ch2('oda'), 'rear.neck')).toContain(`切れ目（幅 ${gap} m）一つ`);
        expect(t(ch2('oda'), 'rear.neck')).toContain(`${narrow.maxEngaged} 隊まで`);
        const V = CH2_FIELDS.home;
        const fromNorth = V.terrain.filter((x) => x.kind === 'road' && x.rect!.z0 <= -V.depth / 2 + 1).length;
        expect(t(ch2('home'), 'village.field')).toContain(`通りが ${fromNorth} 本`);
        expect(t(ch2('home'), 'village.fence')).toContain(`柵が ${V.terrain.filter((x) => x.kind === 'fence').length} か所`);
        const B = CH2_FIELDS.asai;
        expect(t(ch2('asai'), 'relief.field')).toContain(`南北 ${B.depth} m`);
    });
    it('道の無い戦場（援軍救出）で「道」と書かない。道のある戦場でも、道は地形のデータの道だけ', () => {
        expect(CH2_FIELDS.asai.terrain.some((x) => x.kind === 'road')).toBe(false);
        for (const e of ch2('asai')) expect(e.text, e.id).not.toMatch(/道/);
        // 国境の原・退却戦は南北の道が 1 本（「南北に道」とだけ書く）
        for (const es of [ch1, ch2('oda')]) for (const e of es) for (const m of e.text.matchAll(/道/g)) expect(e.text.slice(Math.max(0, m.index! - 6), m.index! + 2), e.id).toMatch(/南北に道|挟まれた道|道が通る/);
    });
    it('敵の居場所・伏兵・援軍・後詰め・敵の部隊の名前を出さない', () => {
        const enemyNames = new Set<string>();
        for (const p of POLICIES) {
            const b = finishTalkIeyasu(answerPledge(ieyasuToMuster(p), 'accept'), 'gate', 'depart');
            for (const u of ieyasuBattleSetup(b).units) if (u.side === 'enemy') enemyNames.add(u.name);
        }
        for (const { state } of CH2) if (state.phase === 'battle') for (const u of ieyasu2BattleSetup(state as Ieyasu2State).units) if (u.side === 'enemy') enemyNames.add(u.name);
        expect(enemyNames.size).toBeGreaterThan(10);
        const all = [ch1, ...POLICIES.map(ch2)].flat();
        for (const e of all) {
            for (const n of enemyNames) expect(e.text, `${e.id}：${n}`).not.toContain(n);
            expect(e.text).not.toMatch(/敵|伏兵|援軍|後詰め|浪人|織田方|朝倉|追っ手/);
            for (const p of e.places ?? []) expect(p.side).toBe('neutral');
        }
        checkBannedWords(all.map((e) => `${e.label}\n${e.text}`).join('\n'));
    });
});

describe('軍議の選択肢の説明・合戦の前の説明への反映', () => {
    it('第一章：記録があれば方針の選択肢の説明の終わりに「物見：…」。無ければ今までと同じ説明（id・名前・要点は変えない）', () => {
        const open = finishTalkIeyasu(newIeyasuGame(), 'tadakatsu', 'open_council');
        const plain = talkIeyasu(open, 'council').choices!;
        for (const c of plain) expect(c.detail).not.toContain('物見');
        const scouted = ieyasuScout(newIeyasuGame(), LOOKOUT_ID, ['border.hill', 'border.flanks']);
        const sc = talkIeyasu(finishTalkIeyasu(scouted, 'tadakatsu', 'open_council'), 'council').choices!;
        expect(sc.map((c) => [c.id, c.label, c.summary])).toEqual(plain.map((c) => [c.id, c.label, c.summary]));
        for (let i = 0; i < sc.length; i++) {
            expect(sc[i]!.detail!.startsWith(plain[i]!.detail!)).toBe(true);
            expect(sc[i]!.detail).toMatch(/ 物見：.+。$/);
        }
    });
    it('第二章：記録があれば判断の選択肢の説明に「物見：…」（主目標・代償の文は同じ）', () => {
        for (const c of CH2_STARTS.slice(0, 36)) {
            const open = finishTalkIeyasu2(c.state, 'tadakatsu', 'open_council');
            const plain = talkIeyasu2(open, 'council').choices!;
            const scouted = finishTalkIeyasu2(ieyasuScout(c.state, LOOKOUT_ID, ALL_IDS), 'tadakatsu', 'open_council');
            const sc = talkIeyasu2(scouted, 'council').choices!;
            expect(sc.map((x) => x.id)).toEqual(plain.map((x) => x.id));
            for (let i = 0; i < sc.length; i++) {
                expect(sc[i]!.detail!.startsWith(plain[i]!.detail!), c.name).toBe(true);
                expect(sc[i]!.detail).toContain('物見：');
                expect(plain[i]!.detail).not.toContain('物見');
            }
        }
    });
    /** 合戦の設定の、説明の文を除いた部分 */
    const sansBriefing = (s: BattleSetup) => ({ ...clone(s), briefing: [] as string[] });
    it('第一章：合戦の前の説明に「物見で確かめた：…」（勝利の行の前）。説明のほかは同じ設定', () => {
        for (const p of POLICIES)
            for (const ans of ['accept', 'decline'] as const) {
                const m = ieyasuToMuster(p);
                const plain = finishTalkIeyasu(answerPledge(m, ans), 'gate', 'depart');
                const scouted = finishTalkIeyasu(answerPledge(ieyasuScout(m, LOOKOUT_ID, [...SCOUT_MARK_IDS.border]), ans), 'gate', 'depart');
                const a = ieyasuBattleSetup(plain);
                const b = ieyasuBattleSetup(scouted);
                expect(a.briefing.some((l) => l.includes('物見'))).toBe(false);
                const at = b.briefing.findIndex((l) => l.startsWith('物見で確かめた：'));
                expect(at).toBeGreaterThan(0);
                expect(b.briefing[at + 1]!.startsWith('勝利')).toBe(true);
                expect(b.briefing.filter((_, i) => i !== at)).toEqual(a.briefing);
                expect(b.briefing[at]).toBe(scoutBriefingLine(scouted));
                expect(b.briefing[at]).toContain('敵の配置は物見では分からない');
                expect(sansBriefing(b)).toEqual(sansBriefing(a));
            }
    });
    it('第二章：合戦の前の説明に「物見で確かめた：…」。説明のほかは同じ設定（確定した主目標・部隊・兵・敵）', () => {
        for (const c of CH2_STARTS.slice(0, 36)) {
            const plain = ch2Battle(ch2Muster(c.state, 'commit'));
            const scouted = ch2Battle(ch2Muster(ieyasuScout(c.state, LOOKOUT_ID, ALL_IDS), 'commit'));
            const a = ieyasu2BattleSetup(plain);
            const b = ieyasu2BattleSetup(scouted);
            const at = b.briefing.findIndex((l) => l.startsWith('物見で確かめた：'));
            expect(at, c.name).toBeGreaterThan(0);
            expect(b.briefing[at + 1]!.startsWith('勝利')).toBe(true);
            expect(b.briefing.filter((_, i) => i !== at)).toEqual(a.briefing);
            expect(sansBriefing(b)).toEqual(sansBriefing(a));
        }
    });
    it('合戦の計算は 1 刻みも同じ（記録あり・なしの設定を、命令なしで終わりまで 1 刻みずつ進めて比べる）', () => {
        const trace = (setup: BattleSetup) => {
            const st = createBattle(setup);
            const rows: string[] = [];
            const o = runToEnd(st, (s) => rows.push(s.units.map((u) => `${u.id}:${u.x.toFixed(3)},${u.z.toFixed(3)},${u.strength.toFixed(3)},${u.status}`).join('|')));
            return { rows, o };
        };
        const pairs: [BattleSetup, BattleSetup][] = [];
        for (const p of POLICIES) {
            const m = ieyasuToMuster(p);
            pairs.push([
                ieyasuBattleSetup(finishTalkIeyasu(answerPledge(m, 'accept'), 'gate', 'depart')),
                ieyasuBattleSetup(finishTalkIeyasu(answerPledge(ieyasuScout(m, LOOKOUT_ID, [...SCOUT_MARK_IDS.border]), 'accept'), 'gate', 'depart')),
            ]);
            const c = CH2_STARTS.find((x) => x.state.policy === p && x.ch1.result === 'victory' && x.ch1.pledge === 'kept')!;
            pairs.push([ieyasu2BattleSetup(ch2Battle(ch2Muster(c.state, 'hold'))), ieyasu2BattleSetup(ch2Battle(ch2Muster(ieyasuScout(c.state, LOOKOUT_ID, ALL_IDS), 'hold')))]);
        }
        for (const [a, b] of pairs) {
            const ta = trace(a);
            const tb = trace(b);
            expect(tb.rows.length).toBe(ta.rows.length);
            expect(tb.rows).toEqual(ta.rows);
            expect(tb.o).toEqual(ta.o);
        }
    }, 120_000);
});
