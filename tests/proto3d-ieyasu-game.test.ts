/**
 * 章のつなぎ（proto3d/src/campaign/game.ts）を、2 つのシナリオ（歴史分岐「元亀元年・家康」・架空の第一章）を並べて、偽の画面・場面で通す。
 * タイトルでシナリオを選ぶ → 城下 → 軍議（3 方針の比較・確認）→ 支度（約束）→ 城門 → 出陣前の自動保存 → 合戦（本物の合戦の計算）→
 * 決着の時点の結果保存 → 開き直しても勝敗と約束の結果が消えず二重に反映しない → 結末。架空の第一章の保存には触れない。
 */
import { describe, expect, it } from 'vitest';
import type { BattleOutcome, BattleSetup } from '../proto3d/src/battle/types';
import { createBattle, orderAllRetreat, runToEnd } from '../proto3d/src/battle/sim';
import {
    ChapterGame,
    type BattleRunnerLike,
    type ConfirmOptions,
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
import { IEYASU_SAVE_KEY, IeyasuSaveStore } from '../proto3d/src/campaign/ieyasu1570/save';
import type { IeyasuState, Policy } from '../proto3d/src/campaign/ieyasu1570/state';
import { PLEDGE_SPECS } from '../proto3d/src/campaign/ieyasu1570/state';
import { CAMPAIGN_SAVE_KEY, CampaignSaveStore, LEGACY_2D_SAVE_KEY } from '../proto3d/src/campaign/save';
import type { ScenarioEndingView, ScenarioScript } from '../proto3d/src/campaign/scenario';
import type { CastMember } from '../proto3d/src/explore/cast';
import type { ExplorePose } from '../proto3d/src/campaign/state';
import { START, colliders, type Rect } from '../proto3d/src/layout';
import { MemoryStorage, toAftermath } from './proto3d-campaign-helpers';

type Req =
    | { kind: 'title'; info: TitleInfo; answer: (a: TitleAction) => void }
    | { kind: 'script'; script: ScenarioScript; mode: string; answer: (c: string | null) => void }
    | { kind: 'confirm'; opts: ConfirmOptions; answer: (id: string) => void }
    | { kind: 'menu'; info: MenuInfo; answer: (a: MenuAction) => void }
    | { kind: 'ending'; view: ScenarioEndingView; answer: () => void };

class FakeView implements GameView {
    reqs: Req[] = [];
    hudInfo: HudInfo | null = null;
    promptInfo: PromptInfo | null = null;
    intros: string[] = [];
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
    ending(view: ScenarioEndingView) {
        return new Promise<void>((answer) => this.reqs.push({ kind: 'ending', view, answer }));
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

class FakeWorld implements GameWorld {
    pose: ExplorePose = { x: START.x, z: START.z, heading: START.heading };
    cast: CastMember<string>[] = [];
    control = true;
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
    setControl(b: boolean) {
        this.control = b;
    }
    walls(): Rect[] {
        return this.w;
    }
    walkTo(id: string, dx = 0.9) {
        const m = this.cast.find((c) => c.id === id);
        if (!m) throw new Error(`${id} は居ない`);
        this.pose = { x: m.x + (m.kind === 'gate' ? 0 : dx), z: m.z, heading: 0 };
    }
}

async function flush(n = 30): Promise<void> {
    for (let i = 0; i < n; i++) await Promise.resolve();
}

/** 本物の合戦の計算で戦う：約束の対象（と全軍）を早めに退かせる＝撤退・約束は守れる見込み。決着の時点で onDecided を呼ぶ */
function realRunner(log: { setups: BattleSetup[]; outcomes: BattleOutcome[]; decided: number }): BattleRunnerLike {
    return async (setup, hooks) => {
        log.setups.push(setup);
        const b = createBattle(setup);
        const o = runToEnd(b, (s) => {
            if (s.t >= 3 && s.allRetreatAt === null) orderAllRetreat(s);
        });
        log.decided++;
        hooks?.onDecided?.(o);
        log.outcomes.push(o);
        return o;
    };
}

class Harness {
    view = new FakeView();
    world = new FakeWorld();
    game: ChapterGame<IeyasuState>;
    log = { setups: [] as BattleSetup[], outcomes: [] as BattleOutcome[], decided: 0 };
    constructor(
        readonly storage: MemoryStorage,
        runner?: BattleRunnerLike,
    ) {
        let t = 0;
        const fictionalStore = new CampaignSaveStore(storage);
        this.game = new ChapterGame<IeyasuState>({
            view: this.view,
            world: this.world,
            store: fictionalStore,
            scenarios: [ieyasuScenario(storage), fictionalScenario(fictionalStore)],
            battleRunner: async () => runner ?? realRunner(this.log),
            now: () => (t += 1000),
        });
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
    async titleNew(scenario: 'ieyasu1570' | 'fictional') {
        void this.game.start();
        const t = await this.next('title');
        t.answer(`new:${scenario}`);
        await flush();
        return t.info;
    }
}

const PICK: Record<Policy, string> = { oda: 'policy_oda', asai: 'policy_asai', home: 'policy_home' };

async function playToMuster(h: Harness, p: Policy) {
    const info = await h.titleNew('ieyasu1570');
    expect(info.scenarios.map((s) => s.id)).toEqual(['ieyasu1570', 'fictional']);
    expect(h.game.scenarioId).toBe('ieyasu1570');
    expect(h.game.state?.scenario).toBe('ieyasu1570');
    expect(h.view.hudInfo?.provisional).toBe('歴史分岐・創作を含む');
    expect(h.world.cast.map((c) => c.id).sort()).toEqual(['asai_envoy', 'notice', 'oda_envoy', 'tadakatsu']);
    await h.talkTo('oda_envoy');
    await h.talkTo('asai_envoy');
    await h.talkTo('tadakatsu', 'open_council');
    expect(h.game.screen).toBe('council');
    // 軍議：3 方針の比較（どの選択肢にも要点と説明）→ 選ぶ → 確認 → 決める
    let r = await h.next('script');
    expect(r.mode).toBe('council');
    expect(r.script.choices?.map((c) => c.id)).toEqual(['policy_oda', 'policy_asai', 'policy_home']);
    expect(r.script.choices?.every((c) => (c.summary ?? '').length > 0 && (c.detail ?? '').length > 0)).toBe(true);
    r.answer(PICK[p]);
    r = await h.next('script');
    expect(r.script.choices?.map((c) => c.id)).toEqual(['confirm_policy', 'reconsider']);
    r.answer('confirm_policy');
    await flush();
    expect(h.game.state?.phase).toBe('muster');
    expect(h.game.state?.policy).toBe(p);
}

async function departFromGate(h: Harness) {
    h.world.walkTo('gate');
    h.game.tick(1 / 30);
    const g = await h.next('script');
    expect(g.script.id).toBe('muster.gate');
    expect(g.script.choices?.[g.script.defaultChoice ?? 0]?.id).toBe('stay');
    g.answer('depart');
    await flush(80);
}

describe('歴史分岐シナリオを、タイトルから結末まで（本物の合戦の計算）', () => {
    for (const p of ['oda', 'asai', 'home'] as const) {
        it(`${p}：約束を引き受け、撤退して約束の対象を退かせる → 開き直しても結果が残る → 結末`, async () => {
            const storage = new MemoryStorage();
            storage.data.set(LEGACY_2D_SAVE_KEY, 'legacy-2d');
            const fs = new CampaignSaveStore(storage).save(toAftermath('omori', 'retreat'), 'aftermath');
            expect(fs.ok).toBe(true);
            const fictional = storage.data.get(CAMPAIGN_SAVE_KEY);
            const h = new Harness(storage);
            await playToMuster(h, p);
            // 約束の相手が目印。城門は答えるまで出陣できない
            const giver = PLEDGE_SPECS[p].giver;
            expect(h.world.cast.find((c) => c.key)?.id).toBe(giver);
            h.world.walkTo('gate');
            h.game.tick(1 / 30);
            const pending = await h.next('script');
            expect(pending.script.id).toBe('muster.gate.pledge_pending');
            expect(pending.script.choices).toBeUndefined();
            pending.answer(null);
            await flush();
            h.world.pose = { x: START.x, z: START.z, heading: 0 };
            h.game.tick(1 / 30);
            // 約束を引き受ける
            await h.talkTo(giver, 'pledge_accept');
            expect(h.game.state?.pledge?.accepted).toBe(true);
            expect(h.world.cast.find((c) => c.key)?.id).toBe('gate');
            await departFromGate(h);
            // 合戦：方針ごとの設定・約束つき。決着の時点で 1 回だけ反映・保存
            expect(h.log.setups).toHaveLength(1);
            expect(h.log.setups[0]!.pledge?.targetId).toBe(PLEDGE_SPECS[p].targetId);
            expect(h.log.setups[0]!.briefing.join('')).toContain('架空の局地戦');
            const s = h.game.state!;
            expect(s.phase).toBe('aftermath');
            expect(s.battle?.result).toBe('retreat');
            expect(s.pledge?.result).toBe(h.log.outcomes[0]!.pledge?.result);
            expect(['kept', 'broken']).toContain(s.pledge?.result);
            expect(s.appliedBattleId).toBe(s.battleId);
            expect(s.battleId).toMatch(/^ieyasu1570-/);
            // 保存は歴史分岐のキーだけ。架空の第一章・2D 版の保存はそのまま
            expect(storage.data.get(CAMPAIGN_SAVE_KEY)).toBe(fictional);
            expect(storage.data.get(LEGACY_2D_SAVE_KEY)).toBe('legacy-2d');
            const saved = new IeyasuSaveStore(storage).loadData();
            expect(saved?.phase).toBe('aftermath');
            expect(saved?.pledge?.result).toBe(s.pledge?.result);
            expect(saved?.battle?.result).toBe('retreat');

            // 開き直す（別のゲーム）：つづきから → 戦後。勝敗・約束・支援・信頼・兵がそのまま
            const h2 = new Harness(storage);
            void h2.game.start();
            const t = await h2.next('title');
            expect(t.info.scenarios[0]!.save?.summary).toContain('戦の後');
            expect(t.info.scenarios[1]!.save?.summary).toContain('戦の後');
            t.answer('continue:ieyasu1570');
            await flush();
            const back = h2.game.state!;
            expect(back.phase).toBe('aftermath');
            expect(back.battle?.result).toBe(s.battle?.result);
            expect(back.pledge).toEqual(s.pledge);
            expect(back.support).toEqual(s.support);
            expect(back.trust).toEqual(s.trust);
            expect(back.troops).toEqual(s.troops);
            // 合戦はやり直さない
            expect(h2.log.setups).toHaveLength(0);
            // 結末
            const tk = await h2.talkTo('tadakatsu', 'end_chapter');
            expect(tk.id).toMatch(/^aftermath\.tadakatsu\./);
            const e = await h2.next('ending');
            expect(e.view.id).toBe('retreat');
            expect(e.view.record.map((r) => r.label)).toEqual(expect.arrayContaining(['方針', '合戦の結果', '約束', '信頼', '徳川の兵', '支援']));
            expect(e.view.footer).toContain('創作');
            e.answer();
            await flush();
            expect(h2.game.screen).toBe('title');
            expect(storage.data.get(CAMPAIGN_SAVE_KEY)).toBe(fictional);
        });
    }

    it('onDecided の後に合戦の画面が同じ結果を返しても、二重に反映しない', async () => {
        const storage = new MemoryStorage();
        let calls = 0;
        const runner: BattleRunnerLike = async (setup, hooks) => {
            const o = runToEnd(createBattle(setup), (s) => {
                if (s.t >= 3 && s.allRetreatAt === null) orderAllRetreat(s);
            });
            const r1 = hooks?.onDecided?.(o);
            const r2 = hooks?.onDecided?.(o);
            calls++;
            expect(r1).toEqual(r2);
            return o;
        };
        const h = new Harness(storage, runner);
        await playToMuster(h, 'home');
        await h.talkTo('tadakatsu', 'pledge_accept');
        const troopsBefore = { ...h.game.state!.troops };
        await departFromGate(h);
        expect(calls).toBe(1);
        const s = h.game.state!;
        const o = s.battle!;
        // 兵は合戦の結果（＋援兵）を 1 回だけ
        const lost = o.units.filter((u) => u.clan === 'tokugawa').reduce((n, u) => n + u.startStrength - u.endStrength, 0);
        const total = (t: Record<string, number>) => Object.values(t).reduce((a, b) => a + b, 0);
        expect(total(s.troops)).toBe(total(troopsBefore) - lost + (s.support?.recovered ?? 0));
    });

    it('支度の途中の手動保存 → 開き直すと約束の返事の前から', async () => {
        const storage = new MemoryStorage();
        const h = new Harness(storage);
        await playToMuster(h, 'asai');
        void h.game.openMenu();
        const m = await h.next('menu');
        expect(m.info.status.map((l) => l.label)).toEqual(expect.arrayContaining(['方針', '信頼', '徳川の兵', '約束']));
        m.answer('save');
        const m2 = await h.next('menu');
        expect(m2.info.message?.ok).toBe(true);
        m2.answer('close');
        await flush();
        expect(storage.data.has(IEYASU_SAVE_KEY)).toBe(true);
        expect(storage.data.has(CAMPAIGN_SAVE_KEY)).toBe(false);
        const h2 = new Harness(storage);
        void h2.game.start();
        const t = await h2.next('title');
        expect(t.info.scenarios[1]!.save).toBeNull();
        t.answer('continue:ieyasu1570');
        await flush();
        expect(h2.game.state?.phase).toBe('muster');
        expect(h2.game.state?.pledge).toBeNull();
        expect(h2.world.cast.find((c) => c.key)?.id).toBe('asai_envoy');
    });

    it('同じゲームから架空の第一章も選べ、今までどおり動く（田代・大森のまま）', async () => {
        const storage = new MemoryStorage();
        const h = new Harness(storage);
        await h.titleNew('fictional');
        expect(h.game.scenarioId).toBe('fictional');
        expect(h.view.hudInfo?.provisional).toBe('仮シナリオ');
        expect(h.view.hudInfo?.objective).toBe('源蔵と話す');
        expect(h.world.cast.map((c) => c.id).sort()).toEqual(['genzo', 'notice', 'shinpachi']);
        await h.talkTo('genzo', 'open_council');
        const r = await h.next('script');
        expect(r.script.choices?.map((c) => c.id)).toEqual(['ally_tashiro', 'ally_omori', 'ally_alone']);
    });
});
