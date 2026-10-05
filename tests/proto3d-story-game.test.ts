/**
 * 章のつなぎ（proto3d/src/campaign/game.ts）の、物語の見せ方の口（演出・情勢・物見・町の人々・軍議所）を、偽の画面・場面で確かめる。
 * - 偽の画面に cinematic・situation の口を足した版：はじめから → 導入 → 城下／移行 → 結果確認／出陣 → 合戦／帰還 → 戦後。
 *   演出の前後で状態が同じ・保存の書き込みが増えない・主人公の位置が戻る・演出中の入力が漏れない・見たかスキップかで同じ。
 * - 情勢（探索・軍議の上・見直し）・物見（保存しない・同じ記録は増えない・やめれば変えない）・町の人々・軍議所。
 * - 口が無い偽の画面では今までどおり（待たない）。
 * シナリオは歴史分岐の本物に、確かめ用の口（story/sample.ts の仮の台本と情勢）を足した物（物語の中身とは切り離す）。
 */
import { describe, expect, it } from 'vitest';
import type { BattleSetup } from '../proto3d/src/battle/types';
import { createBattle, orderAllRetreat, runToEnd } from '../proto3d/src/battle/sim';
import {
    ChapterGame,
    type BattleRunnerLike,
    type CinematicOptions,
    type ConfirmOptions,
    type EndingAction,
    type EndingOptions,
    type GameView,
    type GameWorld,
    type HudInfo,
    type MenuAction,
    type MenuInfo,
    type PromptInfo,
    type ScriptOptions,
    type TitleAction,
    type TitleInfo,
} from '../proto3d/src/campaign/game';
import { fictionalScenario } from '../proto3d/src/campaign/fictional';
import { ieyasuScenario } from '../proto3d/src/campaign/ieyasu1570/scenario';
import { devIeyasuState } from '../proto3d/src/campaign/ieyasu1570/flow';
import { IEYASU_CHAPTER1_KEY, IEYASU_SAVE_KEY } from '../proto3d/src/campaign/ieyasu1570/save';
import { CampaignSaveStore } from '../proto3d/src/campaign/save';
import type { AnyScenario, ScenarioEndingView, ScenarioScript, ScenarioStateCore } from '../proto3d/src/campaign/scenario';
import type { CastMember } from '../proto3d/src/explore/cast';
import type { ExplorePose } from '../proto3d/src/campaign/state';
import { START, colliders, type Rect } from '../proto3d/src/layout';
import { sampleCineSpec, sampleSituation } from '../proto3d/src/story/sample';
import type { AmbientSpec, CineMoment, CineSpec, ScoutPoint, SituationView, StageEvent } from '../proto3d/src/story/types';
import { MemoryStorage } from './proto3d-campaign-helpers';
import { IEYASU_V3_FIXTURES } from './proto3d-ieyasu-save-v3-fixtures';

type Req =
    | { kind: 'title'; info: TitleInfo; answer: (a: TitleAction) => void }
    | { kind: 'script'; script: ScenarioScript; opts: ScriptOptions; answer: (c: string | null) => void }
    | { kind: 'confirm'; opts: ConfirmOptions; answer: (id: string) => void }
    | { kind: 'menu'; info: MenuInfo; answer: (a: MenuAction) => void }
    | { kind: 'ending'; view: ScenarioEndingView; opts?: EndingOptions; answer: (a?: EndingAction) => void }
    | { kind: 'record'; view: ScenarioEndingView; answer: () => void }
    | { kind: 'cinematic'; spec: CineSpec; opts: CinematicOptions; answer: (r: 'done' | 'skipped') => void }
    | { kind: 'situation'; view: SituationView; opts?: { option?: string }; answer: (r?: { replay?: CineMoment }) => void };

/** 口の無い偽の画面（今のテストと同じ形） */
class PlainView implements GameView {
    reqs: Req[] = [];
    hudInfo: HudInfo | null = null;
    promptInfo: PromptInfo | null = null;
    intros: string[] = [];
    toasts: { text: string; kind: string }[] = [];
    title(info: TitleInfo) {
        return new Promise<TitleAction>((answer) => this.reqs.push({ kind: 'title', info, answer }));
    }
    script(script: ScenarioScript, opts: ScriptOptions) {
        return new Promise<string | null>((answer) => this.reqs.push({ kind: 'script', script, opts, answer }));
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
    record(view: ScenarioEndingView) {
        return new Promise<void>((answer) => this.reqs.push({ kind: 'record', view, answer }));
    }
    hud(info: HudInfo | null) {
        this.hudInfo = info;
    }
    prompt(p: PromptInfo | null) {
        this.promptInfo = p;
    }
    intro(title: string) {
        this.intros.push(title);
    }
    toast(text: string, kind: string) {
        this.toasts.push({ text, kind });
    }
    abandon() {
        this.reqs = [];
    }
}

/** 演出・情勢の口を足した偽の画面。演出は 3D の場面の出来事を 1 回ずつ置き、答えるときに片付ける（本物の再生器と同じ約束） */
class StoryView extends PlainView {
    cinematic(spec: CineSpec, opts: CinematicOptions) {
        for (const b of spec.beats) if (b.kind === 'stage') opts.onStage(b.event, 0.5, opts.reduced);
        return new Promise<'done' | 'skipped'>((resolve) =>
            this.reqs.push({
                kind: 'cinematic',
                spec,
                opts,
                answer: (r) => {
                    opts.onStage(null, 0, opts.reduced);
                    resolve(r);
                },
            }),
        );
    }
    situation(view: SituationView, opts?: { option?: string }) {
        return new Promise<{ replay?: CineMoment } | void>((answer) => this.reqs.push({ kind: 'situation', view, opts, answer: (r) => answer(r) }));
    }
}

class FakeWorld implements GameWorld {
    pose: ExplorePose = { x: START.x, z: START.z, heading: START.heading };
    cast: CastMember<string>[] = [];
    control = false;
    private readonly w = colliders();
    walls(): Rect[] {
        return this.w;
    }
    setCast(c: CastMember<string>[]) {
        this.cast = c;
    }
    heroPose() {
        return { ...this.pose };
    }
    setHeroPose(p: ExplorePose) {
        this.pose = { ...p };
    }
    setControl(on: boolean) {
        this.control = on;
    }
    walkTo(id: string, dx = 0.9) {
        const m = this.cast.find((c) => c.id === id);
        if (!m) throw new Error(`${id} は居ない（${this.cast.map((c) => c.id).join(',')}）`);
        this.pose = { x: m.x + (m.kind === 'gate' ? 0 : dx), z: m.z, heading: 0 };
    }
}

/** 物語の見せ方の口を足した偽の場面（演出の出来事は主人公をよそへ動かす：戻ることを確かめる） */
class StoryWorld extends FakeWorld {
    stages: (StageEvent['id'] | null)[] = [];
    ambient: (AmbientSpec | null)[] = [];
    hall: boolean[] = [];
    lookouts: { point: ScoutPoint; reduced: boolean; answer: (marks: string[]) => void }[] = [];
    stage(ev: StageEvent | null) {
        this.stages.push(ev ? ev.id : null);
        if (ev) this.pose = { x: 0, z: 15, heading: 1 };
    }
    setAmbient(spec: AmbientSpec | null) {
        this.ambient.push(spec);
    }
    showCouncilHall(on: boolean) {
        this.hall.push(on);
    }
    startLookout(point: ScoutPoint, reduced: boolean) {
        return new Promise<string[]>((answer) => this.lookouts.push({ point, reduced, answer }));
    }
}

async function flush(n = 40): Promise<void> {
    for (let i = 0; i < n; i++) await Promise.resolve();
}

/** 物見櫓（確かめ用。道の西の空き地） */
const LOOKOUT_MEMBER = { id: 'lookout', kind: 'lookout', x: -9.5, z: 12.5, heading: 0, pose: 'stand', label: '物見櫓', verb: '物見', reach: 2, key: false, solid: null } as unknown as CastMember<string>;

type Story = {
    situationCalls: { from: string; options?: { id: string; label: string }[] }[];
    cineCalls: { moment: CineMoment; replay: boolean }[];
};

/** 歴史分岐の本物に、確かめ用の口を足す（仮の台本・仮の情勢・町の人々・物見櫓） */
function withStory(base: AnyScenario, log: Story): AnyScenario {
    return {
        ...base,
        cast: (s: ScenarioStateCore) => {
            const c = base.cast(s);
            return s.phase === 'explore' || s.phase === 'muster' ? [...c, LOOKOUT_MEMBER] : c;
        },
        cinematic: (_s: ScenarioStateCore, moment: CineMoment, opts?: { replay?: boolean }) => {
            log.cineCalls.push({ moment, replay: !!opts?.replay });
            return sampleCineSpec(moment);
        },
        situation: (_s: ScenarioStateCore, opts: { from: 'explore' | 'council'; options?: { id: string; label: string }[] }) => {
            log.situationCalls.push({ from: opts.from, ...(opts.options ? { options: opts.options } : {}) });
            const v = sampleSituation(false);
            return opts.options ? { ...v, options: opts.options.map((o) => ({ id: o.id, label: o.label, highlight: ['field'], text: o.label })) } : v;
        },
        ambient: (s: ScenarioStateCore) => ({ groups: [{ kind: 'porter', count: s.phase === 'aftermath' ? 1 : 2, place: 'street' }] }),
        scoutPoints: (s: ScenarioStateCore) =>
            s.phase === 'explore' || s.phase === 'muster'
                ? [
                      {
                          id: 'lookout',
                          marks: [
                              { id: 'm_road', heading: 0, label: '道' },
                              { id: 'm_hill', heading: 1, label: '丘' },
                          ],
                      },
                  ]
                : [],
        scout: (s: ScenarioStateCore, _point: string, marks: string[]) => {
            const cur = ((s as { scout?: string[] }).scout ?? []) as string[];
            return { ...s, scout: [...new Set([...cur, ...marks])].sort() };
        },
    } as AnyScenario;
}

/** 本物の合戦の計算：3 秒で全軍撤退を命じて終える。決着の時点で onDecided（throwAfter なら、その後で投げる） */
function realRunner(log: { setups: BattleSetup[] }, throwAfter = false): BattleRunnerLike {
    return async (setup, hooks) => {
        log.setups.push(setup);
        const o = runToEnd(createBattle(setup), (s) => {
            if (s.t >= 3 && s.allRetreatAt === null) orderAllRetreat(s);
        });
        hooks?.onDecided?.(o);
        if (throwAfter) throw new Error('結果の画面の後片付けで失敗（確かめ用）');
        return o;
    };
}

class FailingStorage extends MemoryStorage {
    failKeys = new Set<string>();
    override setItem(k: string, v: string): void {
        if (this.failKeys.has(k)) {
            const e = new Error('quota') as Error & { name: string };
            e.name = 'QuotaExceededError';
            throw e;
        }
        super.setItem(k, v);
    }
}

class Harness<V extends PlainView = PlainView, W extends FakeWorld = FakeWorld> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    game: ChapterGame<any>;
    log = { setups: [] as BattleSetup[] };
    story: Story = { situationCalls: [], cineCalls: [] };
    constructor(
        readonly storage: MemoryStorage,
        readonly view: V,
        readonly world: W,
        o: { story?: boolean; reduced?: boolean; throwAfter?: boolean } = {},
    ) {
        let t = 0;
        const fictionalStore = new CampaignSaveStore(storage);
        const base = ieyasuScenario(storage);
        this.game = new ChapterGame({
            view,
            world,
            store: fictionalStore,
            scenarios: [o.story === false ? base : withStory(base, this.story), fictionalScenario(fictionalStore)],
            battleRunner: async () => realRunner(this.log, o.throwAfter),
            now: () => (t += 1000),
            ...(o.reduced !== undefined ? { reducedMotion: () => o.reduced! } : {}),
        });
    }
    async next<K extends Req['kind']>(kind: K, n = 40): Promise<Extract<Req, { kind: K }>> {
        await flush(n);
        const r = this.view.reqs.shift();
        if (!r) throw new Error(`画面の頼みが無い（${kind} を待っていた）。画面 ${this.game.screen}・誤り ${this.game.lastError}`);
        if (r.kind !== kind) throw new Error(`${kind} を待っていたが ${r.kind}（${r.kind === 'script' ? r.script.id : ''}）`);
        return r as Extract<Req, { kind: K }>;
    }
    async talkTo(id: string, choice: string | null = null): Promise<void> {
        this.world.walkTo(id);
        this.game.tick(1 / 30);
        expect(this.view.promptInfo?.id).toBe(id);
        void this.game.interact();
        const r = await this.next('script');
        r.answer(choice);
        await flush();
    }
    writes(): string[] {
        return this.storage.touched.filter((t) => t.op !== 'get').map((t) => t.key);
    }
}

const story = (storage = new MemoryStorage(), o: { reduced?: boolean; throwAfter?: boolean } = {}) => new Harness(storage, new StoryView(), new StoryWorld(), o);
const J = (v: unknown) => JSON.stringify(v);
const last = <T,>(a: readonly T[]): T | undefined => a[a.length - 1];

describe('第一章の導入（タイトルの「はじめから」の道だけ）', () => {
    for (const how of ['done', 'skipped'] as const) {
        it(`はじめから → 城下に入った後に導入（${how}）→ 城下。状態・保存・主人公の位置・操作は始める前のまま`, async () => {
            const h = story(new MemoryStorage(), { reduced: true });
            void h.game.start();
            (await h.next('title')).answer('new:ieyasu1570');
            const c = await h.next('cinematic');
            expect(c.spec.moment).toBe('ch1_intro');
            expect(c.opts.reduced).toBe(true);
            expect(h.story.cineCalls).toEqual([{ moment: 'ch1_intro', replay: false }]);
            // 城下に入ってから流す（人物・町の人々・HUD は整っている）
            expect(h.game.screen).toBe('cinematic');
            expect(h.world.cast.map((c) => c.id)).toContain('tadakatsu');
            expect(last(h.world.ambient)).toEqual({ groups: [{ kind: 'porter', count: 2, place: 'street' }] });
            expect(h.world.control).toBe(false);
            expect(h.world.stages).toEqual(['envoys_arrive', 'wounded_rest']);
            const s0 = J(h.game.state);
            // 演出中の入力は、探索の移動・会話・メニュー・情勢へ漏れない
            h.world.walkTo('tadakatsu');
            h.game.tick(1 / 30);
            void h.game.interact('tadakatsu');
            void h.game.openMenu();
            void h.game.openSituation();
            await flush();
            expect(h.view.reqs).toEqual([]);
            expect(h.view.promptInfo).toBeNull();
            h.world.pose = { x: 0, z: 15, heading: 1 };
            c.answer(how);
            await flush();
            expect(h.game.screen).toBe('explore');
            expect(h.world.control).toBe(true);
            // 主人公は始める前の位置・向きへ。3D の出来事は片付けた
            expect(h.world.pose).toEqual({ x: START.x, z: START.z, heading: START.heading });
            expect(last(h.world.stages)).toBeNull();
            expect(J(h.game.state)).toBe(s0);
            expect(h.writes()).toEqual([]);
            // 段階の案内をもう一度出す（演出が隠したので）
            expect(h.view.intros.length).toBeGreaterThanOrEqual(2);
            expect(h.game.cineLog).toEqual(['sample.ch1_intro']);
        });
    }

    it('見た・スキップした・口の無い画面で飛ばした：同じ状態・同じ町', async () => {
        const runs: string[] = [];
        for (const how of ['done', 'skipped', 'plain'] as const) {
            const h = how === 'plain' ? new Harness(new MemoryStorage(), new PlainView(), new FakeWorld()) : story();
            void h.game.start();
            (await h.next('title')).answer('new:ieyasu1570');
            if (how !== 'plain') (await h.next('cinematic')).answer(how);
            await flush();
            expect(h.game.screen).toBe('explore');
            expect(h.view.reqs).toEqual([]);
            runs.push(J({ s: h.game.state, cast: h.world.cast.map((c) => c.id), pose: h.world.pose, w: h.writes() }));
        }
        expect(runs[1]).toBe(runs[0]);
        expect(runs[2]).toBe(runs[0]);
    });

    it('つづきから・確認用の begin では流さない', async () => {
        const storage = new MemoryStorage();
        const h = story(storage);
        h.game.begin(devIeyasuState('explore'), 'ieyasu1570');
        await flush();
        expect(h.game.screen).toBe('explore');
        expect(h.view.reqs).toEqual([]);
        expect(h.game.saveManual().ok).toBe(true);
        const h2 = story(storage);
        void h2.game.start();
        (await h2.next('title')).answer('continue:ieyasu1570');
        await flush();
        expect(h2.game.screen).toBe('explore');
        expect(h2.view.reqs).toEqual([]);
        expect(h2.story.cineCalls).toEqual([]);
    });

    it('口の無い偽の画面：待たずに城下（今までどおり）', async () => {
        const h = new Harness(new MemoryStorage(), new PlainView(), new FakeWorld());
        void h.game.start();
        (await h.next('title')).answer('new:ieyasu1570');
        await flush();
        expect(h.game.screen).toBe('explore');
        expect(h.view.reqs).toEqual([]);
        expect(h.view.hudInfo?.situation).toBeUndefined();
    });
});

describe('第二章への移行（保存の後・結果確認の前）', () => {
    async function toRecord(h: Harness, cine: boolean) {
        void h.game.start();
        (await h.next('title')).answer('continue:ieyasu1570');
        const e = await h.next('ending');
        e.answer('next_chapter');
        if (cine) {
            const c = await h.next('cinematic');
            expect(c.spec.moment).toBe('ch2_intro');
            expect(h.game.screen).toBe('cinematic');
            // 保存は済んでいる（第一章の控え・第二章の始め）。知らせも出ている
            expect(h.storage.data.has(IEYASU_CHAPTER1_KEY)).toBe(true);
            expect(JSON.parse(h.storage.data.get(IEYASU_SAVE_KEY)!).point).toBe('chapter');
            expect(last(h.view.toasts)?.text).toBe('保存しました：第二章の始め（自動保存）');
            // 第二章の町を整えてから流す
            expect(h.world.cast.map((x) => x.id)).toContain('ishikawa');
            const w = h.writes().length;
            const s = J(h.game.state);
            c.answer('skipped');
            await flush();
            expect(h.writes().length).toBe(w);
            expect(J(h.game.state)).toBe(s);
        }
        const r = await h.next('record');
        expect(h.game.screen).toBe('record');
        r.answer();
        await flush();
        expect(h.game.screen).toBe('explore');
    }
    it('演出あり・口が無い：同じ保存・同じ状態・同じ町', async () => {
        const out: string[] = [];
        for (const cine of [true, false]) {
            const storage = new MemoryStorage();
            storage.data.set(IEYASU_SAVE_KEY, IEYASU_V3_FIXTURES.oda_defeat_broken_heavy);
            const h = cine ? story(storage) : new Harness(storage, new PlainView(), new FakeWorld());
            await toRecord(h, cine);
            const norm = (k: string) => {
                const v = JSON.parse(h.storage.data.get(k)!);
                delete v.savedAt;
                return v;
            };
            out.push(J({ main: norm(IEYASU_SAVE_KEY), ch1: norm(IEYASU_CHAPTER1_KEY), w: h.writes(), s: { ...h.game.state, savedAt: null }, cast: h.world.cast.map((c) => c.id), pose: h.world.pose }));
        }
        expect(out[0]).toBe(out[1]);
    });
    it('保存に失敗して「結末の画面へ戻る」：演出は流さない', async () => {
        const storage = new FailingStorage();
        storage.data.set(IEYASU_SAVE_KEY, IEYASU_V3_FIXTURES.home_victory_kept);
        storage.failKeys.add(IEYASU_CHAPTER1_KEY);
        storage.failKeys.add(IEYASU_SAVE_KEY);
        const h = new Harness(storage, new StoryView(), new StoryWorld());
        void h.game.start();
        (await h.next('title')).answer('continue:ieyasu1570');
        (await h.next('ending')).answer('next_chapter');
        const c = await h.next('confirm');
        expect(c.opts.title).toBe('保存できませんでした');
        c.answer('back');
        const e = await h.next('ending');
        expect(e.opts?.next).toBeTruthy();
        expect(h.story.cineCalls).toEqual([]);
    });
});

describe('出陣と帰還（出陣前の保存の後・戦後の保存の後）', () => {
    async function departAndReturn(h: Harness<StoryView, StoryWorld>) {
        h.game.begin(devIeyasuState('muster', 'home', 'victory', { pledge: 'decline' }), 'ieyasu1570');
        await flush();
        h.world.walkTo('gate');
        h.game.tick(1 / 30);
        const g = await h.next('script');
        g.answer('depart');
        const d = await h.next('cinematic', 80);
        expect(d.spec.moment).toBe('departure');
        // 出陣前の保存は済み、合戦はまだ
        expect(JSON.parse(h.storage.data.get(IEYASU_SAVE_KEY)!).point).toBe('departure');
        expect(h.log.setups).toHaveLength(0);
        expect(h.game.screen).toBe('cinematic');
        const gatePose = { x: 0, z: -10.9, heading: 0 };
        expect(h.world.cast.find((c) => c.kind === 'gate')).toBeTruthy();
        const sDep = J(h.game.state);
        d.answer('done');
        const r = await h.next('cinematic', 120);
        expect(J(h.game.state)).not.toBe(sDep);
        expect(r.spec.moment).toBe('return');
        expect(h.log.setups).toHaveLength(1);
        // 結果は反映・戦後の保存も済み。戦後の町で流す。保存の知らせはまだ（演出の後）
        const s = h.game.state;
        expect(s.phase).toBe('aftermath');
        expect(s.appliedBattleId).toBe(s.battleId);
        expect(JSON.parse(h.storage.data.get(IEYASU_SAVE_KEY)!).point).toBe('aftermath');
        expect(h.view.toasts.some((t) => t.text.includes('戦後'))).toBe(false);
        expect(h.world.cast.some((c) => c.kind === 'gate')).toBe(false);
        expect(last(h.world.ambient)).toEqual({ groups: [{ kind: 'porter', count: 1, place: 'street' }] });
        const w = h.writes().length;
        const s1 = J(s);
        r.answer('skipped');
        await flush();
        expect(h.game.screen).toBe('explore');
        expect(h.world.control).toBe(true);
        expect(J(h.game.state)).toBe(s1);
        expect(h.writes().length).toBe(w);
        expect(last(h.view.toasts)?.text).toContain('戦後');
        expect(h.world.pose).toEqual({ x: START.x, z: START.z, heading: START.heading });
        void gatePose;
        return h;
    }
    it('出陣 → 合戦 → 帰還 → 戦後：反映・保存は 1 回ずつ（演出は読むだけ）', async () => {
        const h = await departAndReturn(story());
        expect(h.writes().filter((k) => k === IEYASU_SAVE_KEY)).toHaveLength(2);
        expect(h.game.cineLog).toEqual(['sample.departure', 'sample.return']);
    });
    it('合戦の画面が決着の後に投げた道でも、帰還の演出の後に戦後へ', async () => {
        const h = await departAndReturn(story(new MemoryStorage(), { throwAfter: true }));
        expect(h.game.state.phase).toBe('aftermath');
    });
    it('戦後の保存に失敗：知らせは帰還の演出の後に出す', async () => {
        const storage = new FailingStorage();
        const h = new Harness(storage, new StoryView(), new StoryWorld());
        h.game.begin(devIeyasuState('muster', 'home', 'victory', { pledge: 'decline' }), 'ieyasu1570');
        await flush();
        h.world.walkTo('gate');
        h.game.tick(1 / 30);
        (await h.next('script')).answer('depart');
        const d = await h.next('cinematic', 80);
        storage.failKeys.add(IEYASU_SAVE_KEY);
        d.answer('done');
        const r = await h.next('cinematic', 120);
        expect(r.spec.moment).toBe('return');
        expect(h.view.toasts.some((t) => t.kind === 'error')).toBe(false);
        r.answer('done');
        await flush();
        expect(last(h.view.toasts)?.kind).toBe('error');
        expect(last(h.view.toasts)?.text).toContain('保存できませんでした');
    });
    it('口の無い偽の画面：出陣から戦後まで待たずに進む', async () => {
        const h = new Harness(new MemoryStorage(), new PlainView(), new FakeWorld());
        h.game.begin(devIeyasuState('muster', 'home', 'victory', { pledge: 'decline' }), 'ieyasu1570');
        await flush();
        h.world.walkTo('gate');
        h.game.tick(1 / 30);
        (await h.next('script')).answer('depart');
        await flush(120);
        expect(h.game.state.phase).toBe('aftermath');
        expect(h.game.screen).toBe('explore');
    });
});

describe('情勢の画面（探索・軍議）と見直し', () => {
    it('探索：HUD の情勢 → 見直し（状態は変えない・保存しない）→ 情勢へ戻る → 閉じる', async () => {
        const h = story();
        h.game.begin(devIeyasuState('explore'), 'ieyasu1570');
        await flush();
        expect(h.view.hudInfo?.situation).toBe(true);
        const s0 = J(h.game.state);
        h.world.pose = { x: 1, z: -3, heading: 0.5 };
        void h.game.openSituation();
        const v = await h.next('situation');
        expect(h.game.screen).toBe('situation');
        expect(h.world.control).toBe(false);
        expect(h.story.situationCalls).toEqual([{ from: 'explore' }]);
        // 情勢の間はメニュー・会話・もう 1 つの情勢を開かない
        void h.game.openMenu();
        void h.game.openSituation();
        void h.game.interact('tadakatsu');
        await flush();
        expect(h.view.reqs).toEqual([]);
        v.answer({ replay: 'ch1_intro' });
        const c = await h.next('cinematic');
        expect(h.story.cineCalls).toEqual([{ moment: 'ch1_intro', replay: true }]);
        c.answer('done');
        const v2 = await h.next('situation');
        expect(h.game.screen).toBe('situation');
        expect(h.world.pose).toEqual({ x: 1, z: -3, heading: 0.5 });
        v2.answer();
        await flush();
        expect(h.game.screen).toBe('explore');
        expect(h.world.control).toBe(true);
        expect(J(h.game.state)).toBe(s0);
        expect(h.writes()).toEqual([]);
    });
    it('軍議：「地図で見る」は会話を残して重ねる。選択肢を渡すだけで決めない。閉じれば軍議のまま。軍議所を映して戻す', async () => {
        const h = story();
        h.game.begin(devIeyasuState('explore'), 'ieyasu1570');
        await flush();
        await h.talkTo('oda_envoy');
        await h.talkTo('asai_envoy');
        await h.talkTo('tadakatsu', 'open_council');
        const sc = await h.next('script');
        expect(sc.opts.mode).toBe('council');
        expect(sc.opts.situation).toBe(true);
        expect(h.world.hall).toEqual([true]);
        void h.game.openSituation();
        const v = await h.next('situation');
        expect(h.game.screen).toBe('situation');
        const ids = sc.script.choices!.map((c) => c.id);
        expect(last(h.story.situationCalls)).toEqual({ from: 'council', options: sc.script.choices!.map((c) => ({ id: c.id, label: c.label })) });
        expect(v.view.options?.map((o) => o.id)).toEqual(ids);
        // 見直しても軍議所へ戻す
        v.answer({ replay: 'ch1_intro' });
        (await h.next('cinematic')).answer('skipped');
        const v2 = await h.next('situation');
        expect(last(h.world.hall)).toBe(true);
        v2.answer();
        await flush();
        expect(h.game.screen).toBe('council');
        expect(h.game.state.phase).toBe('council');
        expect(h.game.state.policy).toBeNull();
        // 軍議の会話は待ったまま（決めていない）。ここから普通に選ぶ
        sc.answer('policy_home');
        (await h.next('script')).answer('confirm_policy');
        await flush();
        expect(h.game.state.phase).toBe('muster');
        expect(h.world.hall).toEqual([true, true, false]);
    });
    it('口の無い偽の画面：情勢は開かない（HUD にも出さない）', async () => {
        const h = new Harness(new MemoryStorage(), new PlainView(), new FakeWorld());
        h.game.begin(devIeyasuState('explore'), 'ieyasu1570');
        await flush();
        void h.game.openSituation();
        await flush();
        expect(h.view.reqs).toEqual([]);
        expect(h.game.screen).toBe('explore');
    });
});

describe('物見（保存しない・同じ記録は増えない・やめれば変えない）と町の人々', () => {
    it('物見櫓で「物見」→ 眺め → 調べた印を記録（知らせ）。やめれば何も変えない', async () => {
        const h = story(new MemoryStorage(), { reduced: true });
        h.game.begin(devIeyasuState('explore'), 'ieyasu1570');
        await flush();
        h.world.walkTo('lookout');
        h.game.tick(1 / 30);
        expect(h.view.promptInfo).toEqual({ id: 'lookout', verb: '物見', label: '物見櫓' });
        void h.game.interact();
        await flush();
        expect(h.game.screen).toBe('lookout');
        expect(h.world.control).toBe(false);
        expect(h.world.lookouts).toHaveLength(1);
        expect(h.world.lookouts[0]!.point.id).toBe('lookout');
        expect(h.world.lookouts[0]!.reduced).toBe(true);
        const s0 = J(h.game.state);
        h.world.lookouts[0]!.answer([]);
        await flush();
        expect(h.game.screen).toBe('explore');
        expect(J(h.game.state)).toBe(s0);
        expect(h.view.toasts).toEqual([]);
        // 調べた
        void h.game.interact('lookout');
        await flush();
        h.world.lookouts[1]!.answer(['m_road']);
        await flush();
        expect(h.game.state.scout).toEqual(['m_road']);
        expect(last(h.view.toasts)).toEqual({ text: '物見の記録を情勢の地図に書いた（情勢：J）', kind: 'ok' });
        expect(h.world.control).toBe(true);
        // 同じ記録をもう一度：増えない
        const s1 = J(h.game.state);
        void h.game.interact('lookout');
        await flush();
        h.world.lookouts[2]!.answer(['m_road']);
        await flush();
        expect(J(h.game.state)).toBe(s1);
        expect(last(h.view.toasts)?.text).toContain('書いてある');
        // 保存はしない（次の保存の区切りで入る）
        expect(h.writes()).toEqual([]);
        // 兵・信頼・段階は変えない
        const a = JSON.parse(s0);
        const b = JSON.parse(J(h.game.state));
        delete b.scout;
        delete a.scout;
        expect(b).toEqual(a);
    });
    it('眺めが投げても探索へ戻る（操作も戻る）', async () => {
        const h = story();
        h.world.startLookout = () => Promise.reject(new Error('眺めの失敗（確かめ用）'));
        h.game.begin(devIeyasuState('explore'), 'ieyasu1570');
        await flush();
        void h.game.interact('lookout');
        await flush();
        expect(h.game.screen).toBe('explore');
        expect(h.world.control).toBe(true);
    });
    it('町の人々：城下に入る・会話の後に状態から決め直す。タイトルで消す', async () => {
        const h = story();
        h.game.begin(devIeyasuState('explore'), 'ieyasu1570');
        await flush();
        const n = h.world.ambient.length;
        expect(n).toBeGreaterThanOrEqual(1);
        await h.talkTo('oda_envoy');
        expect(h.world.ambient.length).toBeGreaterThan(n);
        void h.game.title();
        await flush();
        expect(last(h.world.ambient)).toBeNull();
    });
});
