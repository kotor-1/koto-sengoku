/**
 * 第一章の進め方（proto3d/src/campaign/flow.ts）：段階の順、協力陣営 × 合戦の結果による関係・人物・兵・結末、受け付けない進め方、合戦の設定。
 */
import { describe, expect, it } from 'vitest';
import type { BattleResultKind } from '../proto3d/src/battle/types';
import { BORDER_FIELD } from '../proto3d/src/battle/maps';
import {
    ENVOY_COURTESY,
    FlowError,
    UNIT_IDS,
    addPlayTime,
    applyBattleOutcome,
    battleSetupFor,
    canSaveManually,
    choose,
    departure,
    endingFor,
    finishChapter,
    finishTalk,
    legalChoices,
    newGame,
    outcomeFromSetup,
    presentCharacters,
    presentTalks,
    setExplorePose,
    talk,
} from '../proto3d/src/campaign/flow';
import { ALLIANCES, INITIAL_RELATIONS, INITIAL_TROOPS, type Alliance, type CampaignState, type EndingId } from '../proto3d/src/campaign/state';
import { snapshot, toAftermath, toBattle, toMuster } from './proto3d-campaign-helpers';

const RESULTS: BattleResultKind[] = ['victory', 'retreat', 'defeat'];

/** 仕様 §5 の結末の表（関係が初期値のまま・協力陣営の兵を捨て石にしていないとき） */
const EXPECTED_ENDING: Record<Alliance, Record<BattleResultKind, EndingId>> = {
    tashiro: { victory: 'tashiro_victory', retreat: 'retreat', defeat: 'defeat_sheltered' },
    omori: { victory: 'omori_victory', retreat: 'retreat', defeat: 'defeat_sheltered' },
    alone: { victory: 'alone_victory', retreat: 'retreat', defeat: 'defeat_alone' },
};
/** 仕様 §5 の関係の変化：協力陣営 勝 +30・撤 +5・敗 -10、組まなかった陣営 -30（独力なら ±0）、鷲尾 勝 -10 */
const ALLY_DELTA: Record<BattleResultKind, number> = { victory: 30, retreat: 5, defeat: -10 };

function inRect(p: { x: number; z: number }, r: { x0: number; x1: number; z0: number; z1: number }): boolean {
    return p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1;
}
const woods = () => BORDER_FIELD.terrain.find((t) => t.kind === 'woods')!.rect!;

describe('章の段階の順（普通の遊び方）', () => {
    it('はじめは探索。源蔵・新八・高札と話せる', () => {
        const s = newGame();
        expect(s.phase).toBe('explore');
        expect(s.alliance).toBeNull();
        expect(s.relations).toEqual(INITIAL_RELATIONS);
        expect(s.troops).toEqual(INITIAL_TROOPS);
        expect(Object.values(s.characters).every((c) => c === 'alive')).toBe(true);
        expect(presentTalks(s)).toEqual(['genzo', 'shinpachi', 'notice']);
        expect(presentCharacters(s)).toEqual(['genzo', 'shinpachi']);
    });

    it('源蔵と話して「もう少し町を見る」なら探索のまま。「軍議を開く」で軍議へ', () => {
        let s = newGame();
        const first = talk(s, 'genzo');
        expect(first.choices?.map((c) => c.id)).toEqual(['open_council', 'not_yet']);
        s = finishTalk(s, 'genzo', 'not_yet');
        expect(s.phase).toBe('explore');
        expect(s.talked['explore.genzo']).toBe(true);
        expect(talk(s, 'genzo').id).toBe('explore.genzo.again');
        s = finishTalk(s, 'genzo', 'open_council');
        expect(s.phase).toBe('council');
        expect(presentTalks(s)).toEqual(['council']);
    });

    it('軍議：3 つの選択 → 確認 → 考え直すと選び直せる → 決めると出陣の支度へ', () => {
        let s = finishTalk(newGame(), 'genzo', 'open_council');
        const c = talk(s, 'council');
        expect(c.choices?.map((x) => x.id)).toEqual(['ally_tashiro', 'ally_omori', 'ally_alone']);
        s = finishTalk(s, 'council', 'ally_omori');
        expect(s.phase).toBe('council');
        expect(s.pendingAlliance).toBe('omori');
        expect(s.alliance).toBeNull();
        expect(talk(s, 'council').choices?.map((x) => x.id)).toEqual(['confirm_alliance', 'reconsider']);
        s = finishTalk(s, 'council', 'reconsider');
        expect(s.pendingAlliance).toBeNull();
        expect(talk(s, 'council').id).toBe('council.again');
        s = finishTalk(s, 'council', 'ally_tashiro');
        s = finishTalk(s, 'council', 'confirm_alliance');
        expect(s.phase).toBe('muster');
        expect(s.alliance).toBe('tashiro');
        expect(s.pendingAlliance).toBeNull();
    });

    it('出陣の支度：選んだ陣営の使者だけが居る。城門で「出陣する」と battle', () => {
        expect(presentTalks(toMuster('tashiro'))).toEqual(['genzo', 'shinpachi', 'tashiro_envoy', 'notice', 'gate']);
        expect(presentTalks(toMuster('omori'))).toEqual(['genzo', 'shinpachi', 'omori_envoy', 'notice', 'gate']);
        expect(presentTalks(toMuster('alone'))).toEqual(['genzo', 'shinpachi', 'notice', 'gate']);
        const m = toMuster('omori');
        const gate = talk(m, 'gate');
        expect(gate.choices?.map((c) => c.id)).toEqual(['depart', 'stay']);
        // 連打で勝手に出陣しない：最初に選ばれているのは「まだ支度をする」
        expect(gate.choices?.[gate.defaultChoice ?? 0]?.id).toBe('stay');
        expect(finishTalk(m, 'gate', 'stay').phase).toBe('muster');
        const b = finishTalk(m, 'gate', 'depart');
        expect(b.phase).toBe('battle');
        expect(presentTalks(b)).toEqual([]);
        expect({ ...departure(m), talked: b.talked }).toEqual(b); // 城門の会話を通さずに出陣しても同じ（済み印だけ違う）
    });

    it('出陣前に使者と話すと関係 +5（1 回だけ）', () => {
        const m = toMuster('tashiro');
        const once = finishTalk(m, 'tashiro_envoy');
        expect(once.relations.tashiro).toBe(INITIAL_RELATIONS.tashiro + ENVOY_COURTESY);
        const twice = finishTalk(once, 'tashiro_envoy');
        expect(twice.relations.tashiro).toBe(INITIAL_RELATIONS.tashiro + ENVOY_COURTESY);
        expect(talk(once, 'tashiro_envoy').id).toBe('muster.tashiro_envoy.again');
    });

    it('戦後：源蔵の「まだ皆と話す」は戦後のまま、「この章を締めくくる」で結末', () => {
        const a = toAftermath('tashiro', 'victory');
        expect(a.phase).toBe('aftermath');
        const g = talk(a, 'genzo');
        expect(g.choices?.map((c) => c.id)).toEqual(['end_chapter', 'not_yet']);
        expect(g.choices?.[g.defaultChoice ?? 0]?.id).toBe('not_yet');
        const later = finishTalk(a, 'genzo', 'not_yet');
        expect(later.phase).toBe('aftermath');
        const end = finishTalk(later, 'genzo', 'end_chapter');
        expect(end.phase).toBe('ending');
        expect(end.ending).toBe('tashiro_victory');
        expect(presentTalks(end)).toEqual([]);
    });
});

describe('協力陣営 × 合戦の結果：関係・人物・兵・結末（仕様 §5）', () => {
    for (const alliance of ALLIANCES) {
        for (const result of RESULTS) {
            it(`${alliance} × ${result}`, () => {
                const a = toAftermath(alliance, result);
                expect(a.phase).toBe('aftermath');
                expect(a.battle?.result).toBe(result);
                // 関係
                if (alliance === 'alone') {
                    expect(a.relations.tashiro).toBe(INITIAL_RELATIONS.tashiro);
                    expect(a.relations.omori).toBe(INITIAL_RELATIONS.omori);
                } else {
                    const other = alliance === 'tashiro' ? 'omori' : 'tashiro';
                    expect(a.relations[alliance]).toBe(INITIAL_RELATIONS[alliance] + ALLY_DELTA[result]);
                    expect(a.relations[other]).toBe(INITIAL_RELATIONS[other] - 30);
                }
                expect(a.relations.washio).toBe(INITIAL_RELATIONS.washio + (result === 'victory' ? -10 : 0));
                // 人物（outcomeFromSetup の既定：勝利＝敵本陣の敗走、敗北＝味方本陣の敗走、撤退＝全軍撤退）
                expect(a.characters.hero).toBe(result === 'defeat' ? 'wounded' : 'alive');
                expect(a.characters.genzo).toBe(result === 'defeat' ? 'wounded' : 'alive'); // 敗北なら殿で負傷
                expect(a.characters.shinpachi).toBe('alive');
                expect(a.characters.washio_gen).toBe(result === 'victory' ? 'wounded' : 'alive');
                // 兵：出た部隊は 2 割減、出なかった予備隊はそのまま
                expect(a.troops.honjin).toBe(Math.round(INITIAL_TROOPS.honjin * 0.8));
                expect(a.troops.genzo).toBe(Math.round(INITIAL_TROOPS.genzo * 0.8));
                expect(a.troops.reserve).toBe(alliance === 'alone' ? Math.round(INITIAL_TROOPS.reserve * 0.8) : INITIAL_TROOPS.reserve);
                // 結末
                expect(endingFor(a)).toBe(EXPECTED_ENDING[alliance][result]);
                const e = finishTalk(a, 'genzo', 'end_chapter');
                expect(e.ending).toBe(EXPECTED_ENDING[alliance][result]);
            });
        }
    }

    it('3 つの選択 × 3 つの結果で、結末は 6 通りすべてに届く', () => {
        const seen = new Set<EndingId>();
        for (const al of ALLIANCES) for (const r of RESULTS) seen.add(endingFor(toAftermath(al, r)));
        // 協力陣営ありの敗北で関係が負になる場合（下のテスト）を足すと 6 通り
        seen.add(endingFor(toAftermath('omori', 'defeat', { units: { a_omori: { status: 'destroyed', end: 0 } } })));
        expect([...seen].sort()).toEqual(['alone_victory', 'defeat_alone', 'defeat_sheltered', 'omori_victory', 'retreat', 'tashiro_victory']);
    });

    it('協力陣営の兵を捨て石にした敗北（関係 < 0）は「落ち延びる」', () => {
        const a = toAftermath('tashiro', 'defeat', { units: { a_tashiro: { status: 'destroyed', end: 0 } } });
        expect(a.relations.tashiro).toBe(INITIAL_RELATIONS.tashiro - 10 - 15);
        expect(a.characters.tashiro_envoy).toBe('wounded');
        expect(endingFor(a)).toBe('defeat_alone');
        // 使者と話して関係を上げていても、捨て石にすれば負になる
        const b = toAftermath('tashiro', 'defeat', { talkEnvoy: true, units: { a_tashiro: { status: 'destroyed', end: 0 } } });
        expect(b.relations.tashiro).toBe(INITIAL_RELATIONS.tashiro + 5 - 10 - 15);
        expect(endingFor(b)).toBe('defeat_alone');
        // 捨て石にしていなければ「盟友の庇護」
        expect(endingFor(toAftermath('tashiro', 'defeat', { talkEnvoy: true }))).toBe('defeat_sheltered');
    });

    it('新八の部隊が全滅すると捕らわれ、戦後の会話に出ない。率いた部隊が敗走した人物は負傷', () => {
        const a = toAftermath('alone', 'victory', {
            units: { a_shinpachi: { status: 'destroyed', end: 0 }, a_genzo: { status: 'routed', end: 120 } },
        });
        expect(a.characters.shinpachi).toBe('captured');
        expect(a.characters.genzo).toBe('wounded');
        expect(a.troops.shinpachi).toBe(0);
        expect(a.troops.genzo).toBe(120);
        expect(presentTalks(a)).not.toContain('shinpachi');
        expect(() => talk(a, 'shinpachi')).toThrow(FlowError);
        expect(talk(a, 'genzo').lines.some((l) => l.text.includes('新八が鷲尾に捕らわれました'))).toBe(true);
    });

    it('敗北でも主人公は死亡しない（落ち延びる：負傷のまま）', () => {
        for (const al of ALLIANCES) {
            const a = toAftermath(al, 'defeat', { units: { a_hq: { status: 'destroyed', end: 0 } } });
            expect(a.characters.hero).toBe('wounded');
            expect(a.troops.honjin).toBe(0);
        }
    });
});

describe('受け付けない進め方', () => {
    const expectFlowError = (f: () => unknown) => expect(f).toThrow(FlowError);

    it('段階を飛ばす・戻る選択は投げる', () => {
        const s = newGame();
        expectFlowError(() => choose(s, 'ally_tashiro'));
        expectFlowError(() => choose(s, 'confirm_alliance'));
        expectFlowError(() => choose(s, 'depart'));
        expectFlowError(() => choose(s, 'end_chapter'));
        expectFlowError(() => departure(s));
        expectFlowError(() => battleSetupFor(s));
        expectFlowError(() => finishChapter(s));
        expectFlowError(() => endingFor(s));
        const council = finishTalk(s, 'genzo', 'open_council');
        expectFlowError(() => choose(council, 'confirm_alliance')); // まだ選んでいない
        expectFlowError(() => choose(council, 'open_council'));
        expectFlowError(() => finishTalk(council, 'genzo'));
        const m = toMuster('alone');
        expectFlowError(() => battleSetupFor(m));
        expectFlowError(() => applyBattleOutcome(m, outcomeFromSetup(battleSetupFor(toBattle('alone')), 'victory')));
        expectFlowError(() => choose(m, 'ally_omori'));
        expectFlowError(() => finishChapter(toBattle('alone')));
    });

    it('居ない相手・その会話に無い選択肢・選択肢の無い会話への選択は投げる', () => {
        const s = newGame();
        expectFlowError(() => talk(s, 'gate'));
        expectFlowError(() => talk(s, 'tashiro_envoy'));
        expectFlowError(() => talk(s, 'council'));
        expectFlowError(() => finishTalk(s, 'genzo')); // 選択肢が必要
        expectFlowError(() => finishTalk(s, 'genzo', 'depart'));
        expectFlowError(() => finishTalk(s, 'notice', 'not_yet'));
        expectFlowError(() => talk(toMuster('tashiro'), 'omori_envoy'));
        expectFlowError(() => finishTalk(toMuster('tashiro'), 'genzo', 'depart')); // 出陣は城門でだけ
    });

    it('合戦の結果は 1 度だけ。形のおかしい結果は受け取らない', () => {
        const b = toBattle('tashiro');
        const setup = battleSetupFor(b);
        const good = outcomeFromSetup(setup, 'victory');
        const after = applyBattleOutcome(b, good);
        expectFlowError(() => applyBattleOutcome(after, good));
        expectFlowError(() => applyBattleOutcome(b, { ...good, units: good.units.filter((u) => u.id !== UNIT_IDS.allyHonjin) }));
        expectFlowError(() => applyBattleOutcome(b, { ...good, reason: 'ally_hq_routed' })); // 勝利なのに味方本陣の敗走
        expectFlowError(() => applyBattleOutcome(b, { ...good, units: good.units.map((u) => ({ ...u, endStrength: u.startStrength + 1 })) }));
        expectFlowError(() => applyBattleOutcome(b, { ...good, elapsedSec: Number.NaN }));
        expectFlowError(() => applyBattleOutcome(b, { ...good, units: [] }));
    });

    it('どの関数も受け取った状態を書き換えない', () => {
        const s0 = newGame();
        const snap0 = snapshot(s0);
        finishTalk(s0, 'genzo', 'open_council');
        setExplorePose(s0, { x: 1, z: 2, heading: 3 });
        addPlayTime(s0, 10);
        expect(s0).toEqual(snap0);
        const b = toBattle('omori');
        const snapB = snapshot(b);
        const setup = battleSetupFor(b);
        setup.units[0]!.strength = 1; // 設定を書き換えても状態には響かない
        setup.map.terrain[0]!.kind = 'marsh';
        applyBattleOutcome(b, outcomeFromSetup(battleSetupFor(b), 'defeat'));
        expect(b).toEqual(snapB);
        expect(BORDER_FIELD.terrain[0]!.kind).not.toBe('marsh');
        const a = toAftermath('omori', 'retreat');
        const snapA = snapshot(a);
        finishChapter(a);
        expect(a).toEqual(snapA);
    });

    it('どの段階でも、会話の選択肢は choose が受け付けるものだけ', () => {
        const states: CampaignState[] = [newGame()];
        for (const al of ALLIANCES) {
            const c = finishTalk(newGame(), 'genzo', 'open_council');
            states.push(c, choose(c, `ally_${al}` as 'ally_tashiro'), toMuster(al));
            for (const r of RESULTS) states.push(toAftermath(al, r));
        }
        for (const s of states) {
            for (const id of presentTalks(s)) {
                const sc = talk(s, id);
                expect(sc.lines.length).toBeGreaterThan(0);
                for (const ch of sc.choices ?? []) expect(legalChoices(s)).toContain(ch.id);
            }
        }
    });
});

describe('合戦の設定（battleSetupFor）：協力陣営で所属・側・置き場所が変わる（仕様 §3）', () => {
    const unit = (al: Alliance, id: string) => battleSetupFor(toBattle(al)).units.find((u) => u.id === id);

    it('戦場は国境の原。味方 4・敵 4 部隊。勝ち負けの条件の説明がある', () => {
        for (const al of ALLIANCES) {
            const s = battleSetupFor(toBattle(al));
            expect(s.map.id).toBe('border_field');
            expect(s.timeLimitSec).toBe(480);
            expect(s.units.filter((u) => u.side === 'ally')).toHaveLength(4);
            expect(s.units.filter((u) => u.side === 'enemy')).toHaveLength(4);
            expect(s.units.filter((u) => u.kind === 'honjin').map((u) => u.side).sort()).toEqual(['ally', 'enemy']);
            const text = s.briefing.join('\n');
            for (const w of ['勝利', '敗北', '撤退', '日没', '仮シナリオ']) expect(text).toContain(w);
            expect(new Set(s.units.map((u) => u.id)).size).toBe(s.units.length);
        }
    });

    it('田代と組む：田代騎馬隊は味方で左の林から 40 秒後、大森槍隊は敵で東から回り込む', () => {
        const t = unit('tashiro', 'a_tashiro')!;
        expect(t).toMatchObject({ side: 'ally', clan: 'tashiro', kind: 'kiba', arriveAt: 40, leaderId: 'tashiro_envoy' });
        expect(inRect(t, woods())).toBe(true);
        const o = unit('tashiro', 'e_omori')!;
        expect(o).toMatchObject({ side: 'enemy', clan: 'omori', aiRole: 'flank' });
        expect(o.x).toBeGreaterThan(60);
        expect(o.z).toBeLessThan(0);
        expect(unit('tashiro', 'a_omori')).toBeUndefined();
        expect(unit('tashiro', 'e_tashiro')).toBeUndefined();
    });

    it('大森と組む：大森槍隊は味方の右翼に最初から、田代騎馬隊は敵で左の林から回り込む', () => {
        const o = unit('omori', 'a_omori')!;
        expect(o).toMatchObject({ side: 'ally', clan: 'omori', kind: 'yari', leaderId: 'omori_envoy' });
        expect(o.arriveAt ?? 0).toBe(0);
        expect(o.x).toBeGreaterThan(60);
        expect(o.z).toBeGreaterThan(0);
        const t = unit('omori', 'e_tashiro')!;
        expect(t).toMatchObject({ side: 'enemy', clan: 'tashiro', kind: 'kiba', aiRole: 'flank' });
        expect(inRect(t, woods())).toBe(true);
    });

    it('独力：琴坂の予備隊は本陣の後ろ、鷲尾の予備隊は丘の後ろ。国衆の部隊は無い', () => {
        const s = battleSetupFor(toBattle('alone'));
        expect(s.units.some((u) => u.clan === 'tashiro' || u.clan === 'omori')).toBe(false);
        const hq = s.units.find((u) => u.id === 'a_hq')!;
        const r = s.units.find((u) => u.id === 'a_reserve')!;
        expect(r).toMatchObject({ side: 'ally', clan: 'kotosaka' });
        expect(r.z).toBeGreaterThan(hq.z);
        const ehq = s.units.find((u) => u.id === 'e_hq')!;
        const er = s.units.find((u) => u.id === 'e_reserve')!;
        expect(er).toMatchObject({ side: 'enemy', clan: 'washio', aiRole: 'reserve' });
        expect(er.z).toBeLessThan(ehq.z);
    });

    it('味方は南・敵は北。琴坂家の兵は今の troops から', () => {
        for (const al of ALLIANCES) {
            const s = battleSetupFor(toBattle(al));
            for (const u of s.units) {
                if (u.side === 'ally') expect(u.z).toBeGreaterThan(0);
                else expect(u.z).toBeLessThan(0);
            }
        }
        const b = toBattle('alone');
        const fewer: CampaignState = { ...b, troops: { honjin: 0, genzo: 123, shinpachi: 0, reserve: 45 } };
        const s = battleSetupFor(fewer);
        expect(s.units.find((u) => u.id === 'a_hq')!.strength).toBe(1); // 本陣は必ず置く
        expect(s.units.find((u) => u.id === 'a_genzo')!.strength).toBe(123);
        expect(s.units.find((u) => u.id === 'a_shinpachi')).toBeUndefined(); // 兵 0 の部隊は出さない
        expect(s.units.find((u) => u.id === 'a_reserve')!.strength).toBe(45);
    });
});

describe('探索の位置・遊んだ時間・手動保存できる段階', () => {
    it('位置は数だけ受け付け、向きは -π〜π に直す', () => {
        const s = setExplorePose(newGame(), { x: 3, z: -4, heading: Math.PI * 3 });
        expect(s.explore?.x).toBe(3);
        expect(Math.abs(s.explore!.heading)).toBeCloseTo(Math.PI);
        expect(() => setExplorePose(newGame(), { x: Number.NaN, z: 0, heading: 0 })).toThrow(FlowError);
        expect(setExplorePose(s, null).explore).toBeNull();
    });
    it('遊んだ時間は足すだけ（負・数でない値は無視）', () => {
        let s = addPlayTime(newGame(), 12.5);
        s = addPlayTime(s, -3);
        s = addPlayTime(s, Number.NaN);
        expect(s.playTimeSec).toBe(12.5);
    });
    it('手動保存は探索中（explore・muster・aftermath）だけ', () => {
        expect(canSaveManually(newGame())).toBe(true);
        expect(canSaveManually(finishTalk(newGame(), 'genzo', 'open_council'))).toBe(false);
        expect(canSaveManually(toMuster('alone'))).toBe(true);
        expect(canSaveManually(toBattle('alone'))).toBe(false);
        expect(canSaveManually(toAftermath('alone', 'retreat'))).toBe(true);
    });
    it('戦後は城下の最初の位置から（探索の位置を消す）', () => {
        const b = setExplorePose(toBattle('alone'), { x: 0, z: -10, heading: 0 });
        const a = applyBattleOutcome(b, outcomeFromSetup(battleSetupFor(b), 'victory'));
        expect(a.explore).toBeNull();
    });
});
