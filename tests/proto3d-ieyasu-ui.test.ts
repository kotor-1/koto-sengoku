/**
 * 歴史分岐「元亀元年・家康」を画面へつなぐ部分（ui/boot.ts が使う createScenarios・ChapterGame が画面へ渡すもの・タイトルの文字・結末の記録）。
 * DOM は使わない（画面は偽物）。本物の入力での確認は e2e/ieyasu-chapter.mjs。
 */
import { describe, expect, it } from 'vitest';
import {
    ChapterGame,
    type ConfirmOptions,
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
import { devIeyasuState } from '../proto3d/src/campaign/ieyasu1570/flow';
import { IEYASU_SAVE_KEY } from '../proto3d/src/campaign/ieyasu1570/save';
import { CARRY_FLAGS, INITIAL_TRUST, type IeyasuState } from '../proto3d/src/campaign/ieyasu1570/state';
import { CARRY_FLAG_LABELS, ieyasuEndingView } from '../proto3d/src/campaign/ieyasu1570/story';
import { CAMPAIGN_SAVE_KEY, LEGACY_2D_SAVE_KEY } from '../proto3d/src/campaign/save';
import type { ScenarioEndingView, ScenarioScript } from '../proto3d/src/campaign/scenario';
import { createScenarios } from '../proto3d/src/campaign/scenarios';
import type { ExplorePose } from '../proto3d/src/campaign/state';
import type { CastMember } from '../proto3d/src/explore/cast';
import { START, colliders, type Rect } from '../proto3d/src/layout';
import { SCENARIO_TITLE_TEXT, titleButtonIds } from '../proto3d/src/ui/scenarioTitles';
import { MemoryStorage } from './proto3d-campaign-helpers';
import { V1_AFTERMATH_OMORI_DEFEAT } from './proto3d-save-v1-fixtures';

type Req =
    | { kind: 'title'; info: TitleInfo; answer: (a: TitleAction) => void }
    | { kind: 'script'; script: ScenarioScript; opts: ScriptOptions; answer: (c: string | null) => void }
    | { kind: 'confirm'; opts: ConfirmOptions; answer: (id: string) => void }
    | { kind: 'menu'; info: MenuInfo; answer: (a: MenuAction) => void }
    | { kind: 'ending'; view: ScenarioEndingView; opts?: EndingOptions; answer: () => void };

class FakeView implements GameView {
    reqs: Req[] = [];
    hudInfo: HudInfo | null = null;
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
        return new Promise<void>((answer) => this.reqs.push({ kind: 'ending', view, opts, answer }));
    }
    hud(info: HudInfo | null) {
        this.hudInfo = info;
    }
    prompt(_p: PromptInfo | null) {}
    intro() {}
    toast() {}
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
}

const flush = async (n = 30) => {
    for (let i = 0; i < n; i++) await Promise.resolve();
};

function boot(storage: MemoryStorage) {
    const view = new FakeView();
    const world = new FakeWorld();
    // ui/boot.ts と同じ組み立て
    const { scenarios, fictionalStore } = createScenarios(storage);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const game = new ChapterGame<any>({ view, world, store: fictionalStore, scenarios, battleRunner: async () => null });
    const next = async <K extends Req['kind']>(kind: K): Promise<Extract<Req, { kind: K }>> => {
        await flush();
        const r = view.reqs.shift();
        if (!r || r.kind !== kind) throw new Error(`${kind} を待っていたが ${r?.kind ?? '無し'}`);
        return r as Extract<Req, { kind: K }>;
    };
    return { view, world, game, next };
}

describe('タイトル：シナリオを選ぶ', () => {
    it('歴史分岐と架空が並び、それぞれに はじめから／つづきから（保存は別々）', async () => {
        const storage = new MemoryStorage();
        storage.setItem(CAMPAIGN_SAVE_KEY, V1_AFTERMATH_OMORI_DEFEAT);
        storage.setItem(LEGACY_2D_SAVE_KEY, '{"2d":"keep"}');
        const { game, next } = boot(storage);
        void game.start();
        const t = await next('title');
        expect(t.info.scenarios.map((s) => s.id)).toEqual(['ieyasu1570', 'fictional']);
        expect(titleButtonIds(t.info.scenarios.map((s) => s.id))).toEqual(['new:ieyasu1570', 'continue:ieyasu1570', 'new:fictional', 'continue:fictional']);
        const [ie, fi] = t.info.scenarios;
        expect(ie!.save).toBeNull();
        expect(fi!.save?.summary).toContain('大森家');
        expect(ie!.label).toContain('創作');
        expect(fi!.label).toBe('仮シナリオ');
        // 古い架空の保存（版 1）から続ける：田代・大森のまま
        t.answer('continue:fictional');
        await flush();
        expect(game.scenarioId).toBe('fictional');
        expect(game.state.alliance).toBe('omori');
        expect(game.state.relations).toEqual({ tashiro: -20, omori: 0, washio: -60 });
        expect(storage.getItem(CAMPAIGN_SAVE_KEY)).toBe(V1_AFTERMATH_OMORI_DEFEAT);
        expect(storage.getItem(IEYASU_SAVE_KEY)).toBeNull();
        expect(storage.getItem(LEGACY_2D_SAVE_KEY)).toBe('{"2d":"keep"}');
    });

    it('タイトルの文字：名前と、史実と創作の区別（B を史実と書かない・姉川の再現と書かない）', () => {
        expect(SCENARIO_TITLE_TEXT.ieyasu1570.name).toBe('歴史分岐：元亀元年・家康');
        expect(SCENARIO_TITLE_TEXT.ieyasu1570.lead).toContain('1570年の情勢を背景にした歴史分岐シナリオ。会話・能力・分岐後の出来事はゲーム用の創作');
        expect(SCENARIO_TITLE_TEXT.fictional.name).toBe('架空：国境の砦（仮シナリオ）');
        expect(SCENARIO_TITLE_TEXT.fictional.lead).toContain('架空');
        for (const t of Object.values(SCENARIO_TITLE_TEXT)) expect(t.lead).not.toMatch(/姉川の戦いを再現|史実でも浅井/);
    });

    it('はじめから（歴史分岐）：HUD は歴史分岐の章の名前と札', async () => {
        const { game, next, view, world } = boot(new MemoryStorage());
        void game.start();
        (await next('title')).answer('new:ieyasu1570');
        await flush();
        expect(game.scenarioId).toBe('ieyasu1570');
        expect(view.hudInfo?.chapter).toContain('元亀元年・家康');
        expect(view.hudInfo?.provisional).toBe('歴史分岐・創作を含む');
        expect(world.cast.map((c) => c.id).sort()).toEqual(['asai_envoy', 'notice', 'oda_envoy', 'tadakatsu']);
        // 人物の見た目は既存の暫定素材（explore/world.ts の LOOKS にある鍵）
        for (const c of world.cast.filter((x) => x.kind === 'person')) expect(['genzo', 'shinpachi', 'tashiro_envoy', 'omori_envoy']).toContain(c.look);
    });
});

describe('画面へ渡すもの：章の名前と札（軍議の見出し・結末）', () => {
    it('会話・軍議にはシナリオの章の名前と札が付く', async () => {
        const { game, next, world } = boot(new MemoryStorage());
        game.begin(devIeyasuState('explore'), 'ieyasu1570');
        const t = world.cast.find((c) => c.id === 'tadakatsu')!;
        world.setHeroPose({ x: t.x + 0.9, z: t.z, heading: 0 });
        game.tick(1 / 30);
        void game.interact();
        const talk = await next('script');
        expect(talk.opts).toMatchObject({ mode: 'talk', label: '歴史分岐・創作を含む' });
        expect(talk.opts.chapter).toContain('元亀元年・家康');
        talk.answer('open_council');
        const council = await next('script');
        expect(council.opts).toMatchObject({ mode: 'council', label: '歴史分岐・創作を含む' });
    });

    it('結末：歴史分岐の結末には、シナリオの id・章の名前・札が付く', async () => {
        const { game, next } = boot(new MemoryStorage());
        game.begin(devIeyasuState('ending', 'home', 'retreat', { pledge: 'accept', pledgeResult: 'kept' }), 'ieyasu1570');
        const e = await next('ending');
        expect(e.opts).toMatchObject({ scenario: 'ieyasu1570', label: '歴史分岐・創作を含む' });
        expect(e.opts?.chapter).toContain('元亀元年・家康');
    });

    it('架空の第一章の結末は、今までどおり仮シナリオの札', async () => {
        const { devStateFor } = await import('../proto3d/src/campaign/game');
        const { game, next } = boot(new MemoryStorage());
        game.begin(devStateFor('ending', 'alone', 'retreat'), 'fictional');
        const e = await next('ending');
        expect(e.opts).toMatchObject({ scenario: 'fictional', label: '仮シナリオ' });
        expect(e.opts?.chapter).toContain('国境の砦');
    });
});

describe('結末の記録：信頼の変化と次の章へ持ち越す印', () => {
    const rec = (s: IeyasuState) => Object.fromEntries(ieyasuEndingView(s).record.map((r) => [r.label, r.value]));

    it('印はすべて読み方があり、結末の「次の章へ」に出る', () => {
        for (const f of CARRY_FLAGS) expect(CARRY_FLAG_LABELS[f]).toBeTruthy();
        const s = devIeyasuState('ending', 'oda', 'victory', { pledge: 'accept', pledgeResult: 'kept' });
        const r = rec(s);
        expect(s.support?.carryOver.length).toBeGreaterThan(0);
        for (const f of s.support!.carryOver) expect(r['次の章へ']).toContain(CARRY_FLAG_LABELS[f]);
    });

    it('信頼の変化は章のはじめからの差（引き受けなかった約束は ±0 の扱い）', () => {
        const s = devIeyasuState('ending', 'asai', 'retreat', { pledge: 'decline' });
        const r = rec(s);
        const d = s.trust.asai - INITIAL_TRUST.asai;
        expect(r['信頼の変化']).toContain(`浅井家 ${d === 0 ? '±0' : d > 0 ? `+${d}` : d}`);
        expect(r['約束']).toContain('引き受けなかった');
        expect(r['次の章へ']).toContain('約束を引き受けなかった');
    });
});
