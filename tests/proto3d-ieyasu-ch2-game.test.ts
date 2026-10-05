/**
 * 章のつなぎ（proto3d/src/campaign/game.ts）で、第一章の結末から第二章の区切りまでを、偽の画面・場面と本物の合戦の計算で通す。
 * タイトル「つづきから」→ 第一章の結末 →「第二章へ進む」→ 第一章の結果確認 → 城下 → 軍議 → 支度（補充）→ 城門 → 合戦（全軍撤退で終える）
 * → 戦後の自動保存 → 読み込み直し → 締めくくる → 第二章の区切り（「次の章へ」は無い）→ タイトルで「つづきから」が第二章の区切り。
 * 架空の章の結末は今までどおり（ボタン 1 つ）。連打・保存の失敗でも二重に進まず、第一章の保存は残る。
 */
import { describe, expect, it } from 'vitest';
import type { BattleOutcome, BattleSetup } from '../proto3d/src/battle/types';
import { createBattle, orderAllRetreat, runToEnd } from '../proto3d/src/battle/sim';
import {
    ChapterGame,
    devStateFor,
    type BattleRunnerLike,
    type ConfirmOptions,
    type EndingAction,
    type EndingOptions,
    type GameView,
    type GameWorld,
    type HudInfo,
    type MenuAction,
    type MenuInfo,
    type PromptInfo,
    type TitleAction,
    type TitleInfo,
} from '../proto3d/src/campaign/game';
import { fictionalScenario } from '../proto3d/src/campaign/fictional';
import { ieyasuScenario } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { IEYASU_CHAPTER1_KEY, IEYASU_SAVE_KEY, parseIeyasu2SaveData, parseIeyasuSaveData } from '../proto3d/src/campaign/ieyasu1570/save';
import { IEYASU2_CHAPTER_TITLE, IEYASU2_RECORD_TITLE } from '../proto3d/src/campaign/ieyasu1570/chapter2/story';
import type { Ieyasu2State } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import type { Policy } from '../proto3d/src/campaign/ieyasu1570/state';
import { CAMPAIGN_SAVE_KEY, CampaignSaveStore, LEGACY_2D_SAVE_KEY } from '../proto3d/src/campaign/save';
import { PRACTICE_SAVE_KEY } from '../proto3d/src/campaign/practice';
import type { ScenarioEndingView, ScenarioScript } from '../proto3d/src/campaign/scenario';
import type { CastMember } from '../proto3d/src/explore/cast';
import type { ExplorePose } from '../proto3d/src/campaign/state';
import { START, colliders, type Rect } from '../proto3d/src/layout';
import { MemoryStorage, toAftermath } from './proto3d-campaign-helpers';
import { IEYASU_V3_FIXTURES, type IeyasuCh1V3FixtureName } from './proto3d-ieyasu-save-v3-fixtures';

type Req =
    | { kind: 'title'; info: TitleInfo; answer: (a: TitleAction) => void }
    | { kind: 'script'; script: ScenarioScript; mode: string; answer: (c: string | null) => void }
    | { kind: 'confirm'; opts: ConfirmOptions; answer: (id: string) => void }
    | { kind: 'menu'; info: MenuInfo; answer: (a: MenuAction) => void }
    | { kind: 'ending'; view: ScenarioEndingView; opts?: EndingOptions; answer: (a?: EndingAction) => void }
    | { kind: 'record'; view: ScenarioEndingView; opts?: EndingOptions; answer: () => void };

class FakeView implements GameView {
    reqs: Req[] = [];
    hudInfo: HudInfo | null = null;
    promptInfo: PromptInfo | null = null;
    toasts: { text: string; kind: string }[] = [];
    title(info: TitleInfo) {
        return new Promise<TitleAction>((answer) => this.reqs.push({ kind: 'title', info, answer }));
    }
    script(script: ScenarioScript, opts: { mode: string }) {
        return new Promise<string | null>((answer) => this.reqs.push({ kind: 'script', script, mode: opts.mode, answer }));
    }
    confirm(opts: ConfirmOptions) {
        return new Promise<string>((answer) => this.reqs.push({ kind: 'confirm', opts, answer }));
    }
    menu(info: MenuInfo) {
        return new Promise<MenuAction>((answer) => this.reqs.push({ kind: 'menu', info, answer }));
    }
    ending(view: ScenarioEndingView, opts?: EndingOptions) {
        return new Promise<EndingAction | void>((answer) => this.reqs.push({ kind: 'ending', view, opts, answer }));
    }
    record(view: ScenarioEndingView, opts?: EndingOptions) {
        return new Promise<void>((answer) => this.reqs.push({ kind: 'record', view, opts, answer }));
    }
    hud(info: HudInfo | null) {
        this.hudInfo = info;
    }
    prompt(p: PromptInfo | null) {
        this.promptInfo = p;
    }
    intro() {}
    toast(text: string, kind: string) {
        this.toasts.push({ text, kind });
    }
    abandon() {
        this.reqs = [];
    }
}

class FakeWorld implements GameWorld {
    pose: ExplorePose = { x: START.x, z: START.z, heading: START.heading };
    cast: CastMember<string>[] = [];
    private readonly w = colliders();
    setCast(c: CastMember<string>[]) {
        this.cast = c;
    }
    heroPose() {
        return { ...this.pose };
    }
    setHeroPose(p: ExplorePose) {
        this.pose = { ...p };
    }
    setControl() {}
    walls(): Rect[] {
        return this.w;
    }
    walkTo(id: string, dx = 0.9) {
        const m = this.cast.find((c) => c.id === id);
        if (!m) throw new Error(`${id} は居ない（${this.cast.map((c) => c.id).join(',')}）`);
        this.pose = { x: m.x + (m.kind === 'gate' ? 0 : dx), z: m.z, heading: 0 };
    }
}

async function flush(n = 40): Promise<void> {
    for (let i = 0; i < n; i++) await Promise.resolve();
}

/** 本物の合戦の計算：3 秒で全軍撤退を命じて終える（勝ち負けの数値の釣り合いには頼らない）。決着の時点で onDecided */
function realRunner(log: { setups: BattleSetup[]; outcomes: BattleOutcome[] }): BattleRunnerLike {
    return async (setup, hooks) => {
        log.setups.push(setup);
        const o = runToEnd(createBattle(setup), (s) => {
            if (s.t >= 3 && s.allRetreatAt === null) orderAllRetreat(s);
        });
        hooks?.onDecided?.(o);
        log.outcomes.push(o);
        return o;
    };
}

class Harness {
    view = new FakeView();
    world = new FakeWorld();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    game: ChapterGame<any>;
    log = { setups: [] as BattleSetup[], outcomes: [] as BattleOutcome[] };
    constructor(readonly storage: MemoryStorage) {
        let t = 0;
        const fictionalStore = new CampaignSaveStore(storage);
        this.game = new ChapterGame({
            view: this.view,
            world: this.world,
            store: fictionalStore,
            scenarios: [ieyasuScenario(storage), fictionalScenario(fictionalStore)],
            battleRunner: async () => realRunner(this.log),
            now: () => (t += 1000),
        });
    }
    get s(): Ieyasu2State {
        return this.game.state as Ieyasu2State;
    }
    async next<K extends Req['kind']>(kind: K): Promise<Extract<Req, { kind: K }>> {
        await flush();
        const r = this.view.reqs.shift();
        if (!r) throw new Error(`画面の頼みが無い（${kind} を待っていた）。画面 ${this.game.screen}・誤り ${this.game.lastError}`);
        if (r.kind !== kind) throw new Error(`${kind} を待っていたが ${r.kind}（${r.kind === 'script' ? r.script.id : ''}）`);
        return r as Extract<Req, { kind: K }>;
    }
    async talkTo(id: string, choice: string | null = null): Promise<ScenarioScript> {
        this.world.walkTo(id);
        this.game.tick(1 / 30);
        expect(this.view.promptInfo?.id).toBe(id);
        void this.game.interact();
        const r = await this.next('script');
        expect(r.script.talk).toBe(id);
        if (choice) expect(r.script.choices?.map((c) => c.id)).toContain(choice);
        r.answer(choice);
        await flush();
        return r.script;
    }
    async continueIeyasu(): Promise<TitleInfo> {
        void this.game.start();
        const t = await this.next('title');
        t.answer('continue:ieyasu1570');
        await flush();
        return t.info;
    }
}

const LEGACY_2D = '{"2d":"keep"}';
const PRACTICE = '{"version":1,"fields":{}}';

function seeded(name: IeyasuCh1V3FixtureName): { storage: MemoryStorage; fictional: string } {
    const storage = new MemoryStorage();
    storage.data.set(LEGACY_2D_SAVE_KEY, LEGACY_2D);
    storage.data.set(PRACTICE_SAVE_KEY, PRACTICE);
    const r = new CampaignSaveStore(storage).save(toAftermath('omori', 'retreat'), 'aftermath');
    if (!r.ok) throw new Error('架空の章の保存を作れない');
    storage.data.set(IEYASU_SAVE_KEY, IEYASU_V3_FIXTURES[name]);
    storage.touched = [];
    return { storage, fictional: storage.data.get(CAMPAIGN_SAVE_KEY)! };
}

function expectOthers(storage: MemoryStorage, fictional: string) {
    expect(storage.data.get(LEGACY_2D_SAVE_KEY)).toBe(LEGACY_2D);
    expect(storage.data.get(CAMPAIGN_SAVE_KEY)).toBe(fictional);
    expect(storage.data.get(PRACTICE_SAVE_KEY)).toBe(PRACTICE);
    expect(storage.touched.filter((t) => t.op !== 'get' && (t.key === LEGACY_2D_SAVE_KEY || t.key === CAMPAIGN_SAVE_KEY || t.key.startsWith(PRACTICE_SAVE_KEY)))).toEqual([]);
}

/** 第一章の結末 →「第二章へ進む」→ 結果確認 → 城下 */
async function enterChapter2(h: Harness, policy: Policy) {
    const info = await h.continueIeyasu();
    expect(info.scenarios[0]!.save?.summary).toContain('章の結末');
    const e = await h.next('ending');
    expect(e.opts?.next?.label).toBe('第二章へ進む');
    expect(e.opts?.scenario).toBe('ieyasu1570');
    // 第一章の結末の見出しは今までどおり「結末」
    expect(e.opts?.heading ?? '結末').toBe('結末');
    expect(e.view.footer).toContain('完');
    e.answer('next_chapter');
    const r = await h.next('record');
    expect(h.game.screen).toBe('record');
    expect(r.view.title).toBe(IEYASU2_RECORD_TITLE);
    expect(r.opts?.chapter).toBe(IEYASU2_CHAPTER_TITLE);
    const rows = Object.fromEntries(r.view.record.map((x) => [x.label, x.value]));
    for (const label of ['方針', '合戦の結果', '部隊ごとの兵', '約束', '援兵', '信頼', '人物', '副目標', '効くこと：支援', '効くこと：補充', '効くこと：敵の勢い', '効くこと：士気', '効くこと：負傷', '効くこと：兵が少ないとき']) expect(rows[label], label).toBeTruthy();
    expect(h.view.toasts[h.view.toasts.length - 1]?.text).toBe('保存しました：第二章の始め（自動保存）');
    r.answer();
    await flush();
    expect(h.game.screen).toBe('explore');
    expect(h.s.chapter).toBe(2);
    expect(h.s.policy).toBe(policy);
    expect(h.view.hudInfo?.chapter).toBe(IEYASU2_CHAPTER_TITLE);
    expect(h.view.hudInfo?.phase).toBe('第二章・城下');
    expect(h.world.cast.map((c) => c.id).sort()).toEqual(['envoy', 'ishikawa', 'notice', 'tadakatsu']);
    expect(h.world.cast.find((c) => c.key)?.id).toBe('tadakatsu');
}

async function councilAndMuster(h: Harness) {
    await h.talkTo('ishikawa');
    await h.talkTo('envoy');
    await h.talkTo('tadakatsu', 'open_council');
    expect(h.game.screen).toBe('council');
    let c = await h.next('script');
    expect(c.mode).toBe('council');
    expect(c.script.choices!.length).toBeGreaterThanOrEqual(1);
    expect(c.script.choices!.every((x) => (x.detail ?? '').includes('出る部隊：'))).toBe(true);
    c.answer(c.script.choices![0]!.id);
    c = await h.next('script');
    // 考え直す → 選び直す → 決める
    expect(c.script.choices!.map((x) => x.id)).toEqual(['confirm_plan', 'reconsider']);
    c.answer('reconsider');
    c = await h.next('script');
    c.answer(c.script.choices![0]!.id);
    c = await h.next('script');
    c.answer('confirm_plan');
    await flush();
    expect(h.s.phase).toBe('muster');
    expect(h.view.hudInfo?.phase).toBe('第二章・出陣の支度');
    // 補充を答えるまで目印は石川・城門で出陣できない
    expect(h.world.cast.find((x) => x.key)?.id).toBe('ishikawa');
    h.world.walkTo('gate');
    h.game.tick(1 / 30);
    const pending = await h.next('script');
    expect(pending.script.id).toBe('ch2.muster.gate.recovery_pending');
    pending.answer(null);
    await flush();
    h.world.pose = { x: START.x, z: START.z, heading: 0 };
    h.game.tick(1 / 30);
    const rec = await h.talkTo('ishikawa', 'recovery_none');
    expect(rec.defaultChoice).toBe(rec.choices!.length - 1);
    expect(h.s.recovery?.choice).toBe('none');
    expect(h.world.cast.find((x) => x.key)?.id).toBe('gate');
}

async function departFromGate(h: Harness) {
    h.world.walkTo('gate');
    h.game.tick(1 / 30);
    const g = await h.next('script');
    expect(g.script.id).toBe('ch2.muster.gate');
    expect(g.script.choices?.[g.script.defaultChoice ?? 0]?.id).toBe('stay');
    g.answer('depart');
    await flush(120);
}

describe('第一章の結末の保存から、第二章の区切りまで（本物の合戦の計算）', () => {
    for (const [name, policy] of [
        ['oda_victory_kept', 'oda'],
        ['asai_defeat_broken_heavy', 'asai'],
        ['home_retreat_declined', 'home'],
    ] as const) {
        it(`${name}`, async () => {
            const { storage, fictional } = seeded(name);
            const h = new Harness(storage);
            await enterChapter2(h, policy);
            // 移るときの保存：第一章の控え（版 3・結末）と、本来のキーに第二章のはじめ（版 4・第二章の始め）
            expect(parseIeyasuSaveData(storage.data.get(IEYASU_CHAPTER1_KEY)!)?.phase).toBe('ending');
            const start = parseIeyasu2SaveData(storage.data.get(IEYASU_SAVE_KEY)!)!;
            expect(start.point).toBe('chapter');
            expect(start.troops).toEqual(start.chapter1.troops);
            // メニューの「状態」に第一章の行と第二章の章の名前
            void h.game.openMenu();
            const m = await h.next('menu');
            const st = Object.fromEntries(m.info.status.map((l) => [l.label, l.value]));
            expect(st['章']).toContain(IEYASU2_CHAPTER_TITLE);
            expect(st['第一章']).toBeTruthy();
            m.answer('close');
            await flush();

            await councilAndMuster(h);
            await departFromGate(h);
            // 合戦：第二章の設定（地図の名前は物語の物・説明の 1 行目は分岐した世界の創作）
            expect(h.log.setups).toHaveLength(1);
            const setup = h.log.setups[0]!;
            expect(setup.map.id).toMatch(/^ieyasu2_/);
            expect(setup.briefing[0]).toContain('第一章の直後');
            expect(setup.generalInitiative ?? false).toBe(false);
            const s = h.s;
            expect(s.phase).toBe('aftermath');
            expect(s.appliedBattleId).toBe(s.battleId);
            expect(s.battleId).toMatch(/^ieyasu1570-/);
            expect(s.result?.sortie).toContain('honjin');
            expect(h.view.hudInfo?.phase).toBe('第二章・戦の後');
            const saved = parseIeyasu2SaveData(storage.data.get(IEYASU_SAVE_KEY)!)!;
            expect(saved.point).toBe('aftermath');
            expect(saved.result).toEqual(s.result);

            // 読み込み直す（別のゲーム）：つづきから → 第二章の戦後。合戦はやり直さない
            const h2 = new Harness(storage);
            const info = await h2.continueIeyasu();
            expect(info.scenarios[0]!.save?.summary).toMatch(/^第二章・戦の後・/);
            expect(h2.s.chapter).toBe(2);
            expect(h2.s.result).toEqual(s.result);
            expect(h2.s.trust).toEqual(s.trust);
            expect(h2.log.setups).toHaveLength(0);
            expect(h2.view.reqs.filter((r) => r.kind === 'record')).toHaveLength(0);
            // 締めくくる → 第二章の区切り（「次の章へ」は無い）→ タイトル
            await h2.talkTo('tadakatsu', 'end_chapter');
            const e = await h2.next('ending');
            expect(e.view.id).toBe(`ch2_${policy}_${s.battle!.result}`);
            expect(e.opts?.next).toBeUndefined();
            expect(e.opts?.chapter).toBe(IEYASU2_CHAPTER_TITLE);
            // 第二章の終わりの見出しは「…第二章　区切り」（「結末」と書かない）
            expect(e.opts?.heading).toBe('区切り');
            e.answer();
            await flush();
            expect(h2.game.screen).toBe('title');
            const t = await h2.next('title');
            expect(t.info.scenarios[0]!.save?.summary).toMatch(/^第二章の区切り・/);
            expect(t.info.scenarios[0]!.save?.summary).not.toContain('章の結末');
            // 第一章の控えはそのまま・2D・架空・演習の保存に触れない
            expect(parseIeyasuSaveData(storage.data.get(IEYASU_CHAPTER1_KEY)!)?.phase).toBe('ending');
            expectOthers(storage, fictional);
        }, 60_000);
    }

    it('第一章の戦後の保存から：締めくくる → 結末 →「第二章へ進む」', async () => {
        const { storage, fictional } = seeded('oda_victory_kept_aftermath');
        const h = new Harness(storage);
        await h.continueIeyasu();
        expect(h.game.state.phase).toBe('aftermath');
        await h.talkTo('tadakatsu', 'end_chapter');
        const e = await h.next('ending');
        expect(e.view.id).toBe('oda_victory');
        expect(e.opts?.next?.label).toBe('第二章へ進む');
        e.answer('next_chapter');
        const r = await h.next('record');
        r.answer();
        await flush();
        expect(h.s.chapter).toBe(2);
        expectOthers(storage, fictional);
    });

    it('第一章をその場で遊び終えて（遊んだ時間に端数）第二章へ：始めの保存も、移った直後（1 秒未満）の手動保存も読み込み直せる', async () => {
        const { storage } = seeded('oda_victory_kept_aftermath');
        const h = new Harness(storage);
        await h.continueIeyasu();
        // 探索の毎フレームの遊んだ時間（端数）。talkTo も tick(1/30) を入れる
        for (let i = 0; i < 7; i++) h.game.tick(1 / 30);
        await h.talkTo('tadakatsu', 'end_chapter');
        const e = await h.next('ending');
        e.answer('next_chapter');
        const r = await h.next('record');
        expect(h.view.toasts[h.view.toasts.length - 1]?.text).toBe('保存しました：第二章の始め（自動保存）');
        r.answer();
        await flush();
        expect(h.s.chapter).toBe(2);
        // 本来のキーの版 4 は読める（第一章の遊んだ時間も切り捨てて書く）
        const start = parseIeyasu2SaveData(storage.data.get(IEYASU_SAVE_KEY)!);
        expect(start).not.toBeNull();
        expect(Number.isInteger(start!.chapter1.playTimeSec)).toBe(true);
        expect(start!.chapter1.playTimeSec).toBeLessThanOrEqual(start!.playTimeSec);
        // 別のゲームでタイトルを開くと「つづきから」は第二章・城下
        const h2 = new Harness(storage);
        const info = await h2.continueIeyasu();
        expect(info.scenarios[0]!.save?.summary).toMatch(/^第二章・城下・/);
        expect(h2.s.chapter).toBe(2);
        expect(h2.game.screen).toBe('explore');
        expect(h2.view.hudInfo?.phase).toBe('第二章・城下');
        // 移った直後（1 秒未満）の手動保存も読める
        h.game.tick(0.3);
        void h.game.openMenu();
        const m = await h.next('menu');
        m.answer('save');
        const m2 = await h.next('menu');
        expect(m2.info.message?.ok).toBe(true);
        m2.answer('close');
        await flush();
        const manual = parseIeyasu2SaveData(storage.data.get(IEYASU_SAVE_KEY)!);
        expect(manual?.point).toBe('manual');
        const h3 = new Harness(storage);
        const info3 = await h3.continueIeyasu();
        expect(info3.scenarios[0]!.save?.summary).toMatch(/^第二章・城下・/);
        expect(h3.s.chapter).toBe(2);
    });
});

describe('結末の画面のボタン・連打・保存の失敗', () => {
    it('架空の章の結末は今までどおり「タイトルへ」だけ（次の章は無い）', async () => {
        const h = new Harness(new MemoryStorage());
        h.game.begin(devStateFor('ending', 'tashiro', 'victory'), 'fictional');
        const e = await h.next('ending');
        expect(e.opts?.next).toBeUndefined();
        expect(e.opts?.scenario).toBe('fictional');
        // 架空の章の見出しは今までどおり（言葉を渡さない＝「結末」）
        expect(e.opts?.heading).toBeUndefined();
        e.answer();
        await flush();
        expect(h.game.screen).toBe('title');
    });

    it('第一章の結末で「タイトルへ」（返りが無いのも同じ）なら、第二章へは進まず保存も変えない', async () => {
        const { storage } = seeded('home_victory_kept');
        const h = new Harness(storage);
        await h.continueIeyasu();
        const e = await h.next('ending');
        e.answer('title');
        await flush();
        expect(h.game.screen).toBe('title');
        expect(storage.data.get(IEYASU_SAVE_KEY)).toBe(IEYASU_V3_FIXTURES.home_victory_kept);
        expect(storage.data.has(IEYASU_CHAPTER1_KEY)).toBe(false);
    });

    it('連打：結末の画面が 2 つ重なって両方「第二章へ進む」でも、移るのは 1 回（保存も結果確認も 1 回）', async () => {
        const { storage } = seeded('asai_victory_kept');
        const h = new Harness(storage);
        await h.continueIeyasu();
        const a = await h.next('ending');
        // 同じ結末をもう一度出す（つづきからの二重押しに相当）
        h.game.begin(h.game.state, 'ieyasu1570');
        const b = await h.next('ending');
        storage.touched = [];
        a.answer('next_chapter');
        b.answer('next_chapter');
        await flush(80);
        const writes = storage.touched.filter((t) => t.op === 'set' && t.key === IEYASU_SAVE_KEY);
        expect(writes).toHaveLength(1);
        expect(storage.touched.filter((t) => t.op === 'set' && t.key === IEYASU_CHAPTER1_KEY)).toHaveLength(1);
        expect(h.view.reqs.filter((r) => r.kind === 'record')).toHaveLength(1);
        const r = await h.next('record');
        r.answer();
        await flush();
        expect(h.s.chapter).toBe(2);
        expect(h.s.troops).toEqual(h.s.chapter1.troops);
    });

    it('移るときの保存に失敗：確かめる → 結末の画面へ戻る（第一章の保存は元のまま）→ もう一度 → 保存せずに始める', async () => {
        class Full extends MemoryStorage {
            override setItem(k: string, v: string): void {
                if (k === IEYASU_SAVE_KEY && v.includes('"version":4')) {
                    const e = new Error('full');
                    e.name = 'QuotaExceededError';
                    throw e;
                }
                super.setItem(k, v);
            }
        }
        const storage = new Full();
        storage.data.set(IEYASU_SAVE_KEY, IEYASU_V3_FIXTURES.oda_defeat_broken_heavy);
        const h = new Harness(storage);
        await h.continueIeyasu();
        let e = await h.next('ending');
        e.answer('next_chapter');
        let c = await h.next('confirm');
        expect(c.opts.title).toBe('保存できませんでした');
        expect(c.opts.lines[0]).toBe('第二章の始めを保存できませんでした。第一章の保存はそのまま残っています。');
        expect(c.opts.lines[2]).toContain('先に第一章の保存を控えへ写します');
        expect(c.opts.buttons.map((b) => b.label)).toEqual(['保存せずに第二章を始める', '結末の画面へ戻る']);
        expect(c.opts.buttons[c.opts.defaultIndex ?? 0]!.id).toBe('back');
        c.answer('back');
        e = await h.next('ending');
        expect(e.view.id).toBe('defeat_mikawa');
        expect(storage.data.get(IEYASU_SAVE_KEY)).toBe(IEYASU_V3_FIXTURES.oda_defeat_broken_heavy);
        e.answer('next_chapter');
        c = await h.next('confirm');
        c.answer('go');
        const r = await h.next('record');
        r.answer();
        await flush();
        expect(h.s.chapter).toBe(2);
        expect(h.game.screen).toBe('explore');
        // 保存はされていない（第一章の結末の保存のまま。読み込み直すと第一章の結末から）
        expect(storage.data.get(IEYASU_SAVE_KEY)).toBe(IEYASU_V3_FIXTURES.oda_defeat_broken_heavy);
        const h2 = new Harness(storage);
        const info = await h2.continueIeyasu();
        expect(info.scenarios[0]!.save?.summary).toContain('章の結末');
        expect((await h2.next('ending')).view.id).toBe('defeat_mikawa');
    });

    it('第一章の控えが書けない（容量）→ 保存せずに第二章を始める：その後の第二章の保存（手動・出陣前・戦後）は失敗を知らせ、第一章の保存を上書きしない', async () => {
        class FullBackup extends MemoryStorage {
            override setItem(k: string, v: string): void {
                if (k === IEYASU_CHAPTER1_KEY) {
                    const e = new Error('full');
                    e.name = 'QuotaExceededError';
                    throw e;
                }
                super.setItem(k, v);
            }
        }
        const storage = new FullBackup();
        storage.data.set(IEYASU_SAVE_KEY, IEYASU_V3_FIXTURES.oda_victory_kept);
        const h = new Harness(storage);
        await h.continueIeyasu();
        const e = await h.next('ending');
        e.answer('next_chapter');
        const c = await h.next('confirm');
        expect(c.opts.lines[2]).toContain('第一章の保存を上書きしません');
        c.answer('go');
        (await h.next('record')).answer();
        await flush();
        expect(h.s.chapter).toBe(2);
        // 手動保存：失敗を知らせる
        void h.game.openMenu();
        const m = await h.next('menu');
        m.answer('save');
        const m2 = await h.next('menu');
        expect(m2.info.message?.ok).toBe(false);
        expect(m2.info.message?.text).toContain('第一章の保存を控えへ写せなかったため');
        m2.answer('close');
        await flush();
        // 出陣前の自動保存：確かめる → 保存せずに出陣 → 戦後の自動保存も失敗（知らせる）
        await councilAndMuster(h);
        h.world.walkTo('gate');
        h.game.tick(1 / 30);
        const g = await h.next('script');
        g.answer('depart');
        const d = await h.next('confirm');
        expect(d.opts.lines[0]).toContain('第一章の保存を控えへ写せなかったため');
        d.answer('go');
        await flush(120);
        expect(h.s.phase).toBe('aftermath');
        expect(h.view.toasts.some((t) => t.kind === 'error' && t.text.includes('第一章の保存を控えへ写せなかったため'))).toBe(true);
        // 第一章の保存はそのまま（読み込み直すと第一章の結末から）
        expect(storage.data.get(IEYASU_SAVE_KEY)).toBe(IEYASU_V3_FIXTURES.oda_victory_kept);
        const h2 = new Harness(storage);
        const info = await h2.continueIeyasu();
        expect(info.scenarios[0]!.save?.summary).toContain('章の結末');
    }, 60_000);

    it('移った後に読み込み直すと第二章の城下から（移る処理をもう一度通らない・結果確認は出さない）', async () => {
        const { storage } = seeded('home_defeat_broken_heavy');
        const h = new Harness(storage);
        await enterChapter2(h, 'home');
        const before = storage.data.get(IEYASU_SAVE_KEY);
        storage.touched = [];
        const h2 = new Harness(storage);
        const info = await h2.continueIeyasu();
        expect(info.scenarios[0]!.save?.summary).toMatch(/^第二章・城下・自領の防衛を優先した・第二章の始め（自動保存）/);
        expect(h2.s.chapter).toBe(2);
        expect(h2.s.phase).toBe('explore');
        expect(h2.view.reqs).toHaveLength(0);
        expect(storage.touched.every((t) => t.op === 'get')).toBe(true);
        expect(storage.data.get(IEYASU_SAVE_KEY)).toBe(before);
    });
});
