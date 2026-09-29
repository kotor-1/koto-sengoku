/**
 * 第一章のつなぎ（proto3d/src/campaign/game.ts）を、偽の画面・場面で最後まで通す。
 * タイトル → 探索（源蔵に近づいて話す）→ 軍議（選ぶ・考え直す・決める）→ 支度 → 城門 → 出陣前の自動保存 → 合戦 →
 * 戦後の自動保存 → 戦後の会話 → 結末 → タイトル。保存して開き直すと続きから。保存の失敗・合戦の画面が無いとき・2D 版の保存に触れないこと。
 */
import { describe, expect, it } from 'vitest';
import type { BattleOutcome, BattleResultKind, BattleSetup, UnitStatus } from '../proto3d/src/battle/types';
import {
    ChapterGame,
    devStateFor,
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
import { outcomeFromSetup } from '../proto3d/src/campaign/flow';
import { CAMPAIGN_SAVE_ARCHIVE_KEY, CAMPAIGN_SAVE_KEY, CampaignSaveStore, LEGACY_2D_SAVE_KEY } from '../proto3d/src/campaign/save';
import type { Alliance, ChoiceId, ExplorePose } from '../proto3d/src/campaign/state';
import type { EndingView, Script } from '../proto3d/src/campaign/story';
import type { CastMember } from '../proto3d/src/explore/cast';
import { START, colliders, type Rect } from '../proto3d/src/layout';
import { MemoryStorage } from './proto3d-campaign-helpers';
import { V1_AFTERMATH_OMORI_DEFEAT, V1_DEPARTURE_TASHIRO } from './proto3d-save-v1-fixtures';
import { createBattle, runToEnd } from '../proto3d/src/battle/sim';
import { hqAloneScript, planScript, retreatAt } from '../proto3d/src/battle/scripts';

// ---------------- 偽の画面 ----------------

type Req =
    | { kind: 'title'; info: TitleInfo; answer: (a: TitleAction) => void }
    | { kind: 'script'; script: Script; mode: string; answer: (c: ChoiceId | null) => void }
    | { kind: 'confirm'; opts: ConfirmOptions; answer: (id: string) => void }
    | { kind: 'menu'; info: MenuInfo; answer: (a: MenuAction) => void }
    | { kind: 'ending'; view: EndingView; answer: () => void };

class FakeView implements GameView {
    reqs: Req[] = [];
    hudInfo: HudInfo | null = null;
    promptInfo: PromptInfo | null = null;
    intros: string[] = [];
    toasts: { text: string; kind: string }[] = [];
    title(info: TitleInfo) {
        return new Promise<TitleAction>((answer) => this.reqs.push({ kind: 'title', info, answer }));
    }
    script(script: Script, opts: { mode: string }) {
        return new Promise<ChoiceId | null>((answer) => this.reqs.push({ kind: 'script', script, mode: opts.mode, answer }));
    }
    confirm(opts: ConfirmOptions) {
        return new Promise<string>((answer) => this.reqs.push({ kind: 'confirm', opts, answer }));
    }
    menu(info: MenuInfo) {
        return new Promise<MenuAction>((answer) => this.reqs.push({ kind: 'menu', info, answer }));
    }
    ending(view: EndingView) {
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
    abandoned = 0;
    abandon() {
        this.abandoned++;
        this.reqs = [];
    }
}

class FakeWorld implements GameWorld {
    pose: ExplorePose = { x: START.x, z: START.z, heading: START.heading };
    cast: CastMember[] = [];
    control = true;
    controlLog: boolean[] = [];
    private readonly w = colliders();
    setCast(c: CastMember[]) {
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
        this.controlLog.push(b);
    }
    walls(): Rect[] {
        return this.w;
    }
    /** 相手の隣へ歩いた（テストでは位置を置くだけ） */
    walkTo(id: string, dx = 0.9) {
        const m = this.cast.find((c) => c.id === id);
        if (!m) throw new Error(`${id} は居ない`);
        this.pose = { x: m.x + (m.kind === 'gate' ? 0 : dx), z: m.z, heading: 0 };
    }
}

/** Promise の続きを流す */
async function flush(n = 20): Promise<void> {
    for (let i = 0; i < n; i++) await Promise.resolve();
}

class Harness {
    view = new FakeView();
    world = new FakeWorld();
    battles: BattleSetup[] = [];
    game: ChapterGame;
    constructor(
        readonly storage: MemoryStorage,
        opts: {
            runner?: BattleRunnerLike | null;
            /** 合戦の画面の読み込み（省略すると runner をそのまま返す） */
            load?: () => Promise<BattleRunnerLike | null>;
            result?: BattleResultKind;
            units?: Record<string, { end?: number; status?: UnitStatus }>;
        } = {},
    ) {
        const runner: BattleRunnerLike | null =
            opts.runner === undefined
                ? async (setup) => {
                      this.battles.push(setup);
                      return outcomeFromSetup(setup, opts.result ?? 'victory', { units: opts.units });
                  }
                : opts.runner;
        let t = 0;
        this.game = new ChapterGame({
            view: this.view,
            world: this.world,
            store: new CampaignSaveStore(storage),
            battleRunner: opts.load ?? (async () => runner),
            now: () => (t += 1000),
        });
    }
    /** 次の画面の頼み（種類を確かめる） */
    async next<K extends Req['kind']>(kind: K): Promise<Extract<Req, { kind: K }>> {
        await flush();
        const r = this.view.reqs.shift();
        if (!r) throw new Error(`画面の頼みが無い（${kind} を待っていた）。画面 ${this.game.screen}・誤り ${this.game.lastError}`);
        if (r.kind !== kind) throw new Error(`${kind} を待っていたが ${r.kind}（${r.kind === 'script' ? r.script.id : ''}）`);
        return r as Extract<Req, { kind: K }>;
    }
    async none(): Promise<void> {
        await flush();
        expect(this.view.reqs.map((r) => r.kind)).toEqual([]);
    }
    /** 近くへ歩いて「話す」を押し、会話を最後まで読み、選択肢があれば選ぶ */
    async talkTo(id: string, choice: ChoiceId | null = null): Promise<Script> {
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
    /** 軍議：選ぶ → 確認 → 決める */
    async council(a: Alliance, opts: { reconsider?: boolean } = {}): Promise<void> {
        const pick = { tashiro: 'ally_tashiro', omori: 'ally_omori', alone: 'ally_alone' }[a] as ChoiceId;
        let r = await this.next('script');
        expect(r.mode).toBe('council');
        if (opts.reconsider) {
            r.answer('ally_omori');
            r = await this.next('script');
            expect(r.script.choices?.map((c) => c.id)).toEqual(['confirm_alliance', 'reconsider']);
            r.answer('reconsider');
            r = await this.next('script');
            expect(r.script.id).toBe('council.again');
        }
        r.answer(pick);
        r = await this.next('script');
        expect(r.script.id).toBe(`council.confirm.${a}`);
        r.answer('confirm_alliance');
        await flush();
    }
    /** タイトル → はじめから → 探索 */
    async newGame(): Promise<void> {
        void this.game.start();
        const t = await this.next('title');
        t.answer('new');
        await flush();
    }
    /** 城門へ歩いて入る（出陣の確認が自動で出る） */
    async walkIntoGate(): Promise<Extract<Req, { kind: 'script' }>> {
        this.world.walkTo('gate');
        this.game.tick(1 / 30);
        const r = await this.next('script');
        expect(r.script.id).toBe('muster.gate');
        expect(r.script.choices?.[r.script.defaultChoice ?? 0]?.id).toBe('stay');
        return r;
    }
    saved() {
        return new CampaignSaveStore(this.storage).load();
    }
}

async function playToMuster(h: Harness, a: Alliance, opts: { reconsider?: boolean } = {}) {
    await h.newGame();
    expect(h.game.state?.phase).toBe('explore');
    await h.talkTo('shinpachi');
    await h.talkTo('genzo', 'open_council');
    expect(h.game.screen).toBe('council');
    await h.council(a, opts);
    expect(h.game.state?.phase).toBe('muster');
    expect(h.game.state?.alliance).toBe(a);
}

async function playToAftermath(h: Harness, a: Alliance) {
    await playToMuster(h, a);
    const gate = await h.walkIntoGate();
    gate.answer('depart');
    await flush(60);
    expect(h.game.state?.phase).toBe('aftermath');
}

async function playToEnding(h: Harness, a: Alliance): Promise<EndingView> {
    await playToAftermath(h, a);
    await h.talkTo('genzo', 'end_chapter');
    const e = await h.next('ending');
    return e.view;
}

describe('第一章を最初から最後まで（田代 × 勝利）', () => {
    it('タイトル → 探索 → 軍議 → 支度 → 出陣 → 合戦 → 戦後 → 結末 → タイトル', async () => {
        const storage = new MemoryStorage();
        const h = new Harness(storage, { result: 'victory' });
        void h.game.start();
        const t = await h.next('title');
        expect(t.info.save).toBeNull();
        expect(t.info.note).toContain('仮シナリオ');
        t.answer('new');
        await flush();
        // 探索：目的と人物
        expect(h.game.screen).toBe('explore');
        expect(h.view.hudInfo?.objective).toBe('源蔵と話す');
        expect(h.view.hudInfo?.provisional).toBe('仮シナリオ');
        expect(h.world.cast.map((c) => c.id).sort()).toEqual(['genzo', 'notice', 'shinpachi']);
        expect(h.world.control).toBe(true);
        // 遠いと「話す」は出ない
        h.world.pose = { x: START.x, z: START.z + 5, heading: 0 };
        h.game.tick(1 / 30);
        expect(h.view.promptInfo).toBeNull();
        // 源蔵に近づいて話す：会話の間は歩けない
        h.world.walkTo('genzo');
        h.game.tick(1 / 30);
        expect(h.view.promptInfo).toMatchObject({ id: 'genzo', verb: '話す', label: '源蔵' });
        void h.game.interact();
        const g = await h.next('script');
        expect(h.world.control).toBe(false);
        expect(h.view.promptInfo).toBeNull();
        expect(g.script.id).toBe('explore.genzo');
        g.answer('open_council');
        // 軍議（考え直してから田代に決める）
        await h.council('tashiro', { reconsider: true });
        expect(h.game.state?.phase).toBe('muster');
        expect(h.world.control).toBe(true);
        expect(h.view.intros).toContain('出陣の支度');
        expect(h.world.cast.map((c) => c.id)).toEqual(expect.arrayContaining(['genzo', 'shinpachi', 'tashiro_envoy', 'notice', 'gate']));
        expect(h.world.cast.map((c) => c.id)).not.toContain('omori_envoy');
        // 使者と話すと関係 +5
        await h.talkTo('tashiro_envoy');
        expect(h.game.state?.relations.tashiro).toBe(15);
        // 城門へ：出陣の確認が自動で出る
        const gate = await h.walkIntoGate();
        gate.answer('depart');
        await flush(60);
        // 出陣前の自動保存 → 合戦（部隊単位の設定）→ 戦後
        expect(h.battles).toHaveLength(1);
        const setup = h.battles[0]!;
        expect(setup.units.find((u) => u.id === 'a_tashiro')).toMatchObject({ side: 'ally', clan: 'tashiro' });
        expect(setup.units.find((u) => u.id === 'e_omori')).toMatchObject({ side: 'enemy', clan: 'omori' });
        expect(h.view.toasts.some((t) => t.kind === 'ok' && t.text.includes('出陣前'))).toBe(true);
        expect(h.game.state?.phase).toBe('aftermath');
        expect(h.game.state?.battle?.result).toBe('victory');
        const saved = h.saved();
        expect(saved.status === 'ok' && saved.data.point).toBe('aftermath');
        expect(h.view.intros).toContain('凱旋');
        expect(h.world.pose).toMatchObject({ x: START.x, z: START.z });
        expect(h.world.control).toBe(true);
        // 戦後の会話 → 結末
        await h.talkTo('shinpachi');
        await h.talkTo('genzo', 'end_chapter');
        const e = await h.next('ending');
        expect(e.view.id).toBe('tashiro_victory');
        expect(e.view.footer).toBe('第一章 完（仮シナリオ）');
        expect(e.view.record.map((r) => r.label)).toEqual(expect.arrayContaining(['協力陣営', '合戦の結果', '琴坂の兵', '人物', '関係']));
        expect(h.game.screen).toBe('ending');
        expect(h.world.control).toBe(false);
        const endSave = h.saved();
        expect(endSave.status === 'ok' && endSave.data.phase).toBe('ending');
        // タイトルへ
        e.answer();
        const t2 = await h.next('title');
        expect(t2.info.save?.summary).toContain('章の結末');
        expect(h.game.state).toBeNull();
        // 2D 版の保存には触れていない
        expect(storage.touched.some((x) => x.key === LEGACY_2D_SAVE_KEY)).toBe(false);
    });
});

describe('選択と結果で展開が変わる', () => {
    const cases: [Alliance, BattleResultKind, string][] = [
        ['tashiro', 'victory', 'tashiro_victory'],
        ['omori', 'victory', 'omori_victory'],
        ['alone', 'victory', 'alone_victory'],
        ['omori', 'defeat', 'defeat_sheltered'],
        ['alone', 'defeat', 'defeat_alone'],
        ['alone', 'retreat', 'retreat'],
    ];
    for (const [a, r, ending] of cases) {
        it(`${a} × ${r} → ${ending}`, async () => {
            const h = new Harness(new MemoryStorage(), { result: r });
            const v = await playToEnding(h, a);
            expect(v.id).toBe(ending);
        });
    }
    it('協力陣営で合戦の所属と配置が変わる（大森と組むと田代が敵、独力なら予備隊）', async () => {
        const h1 = new Harness(new MemoryStorage());
        await playToAftermath(h1, 'omori');
        const u1 = h1.battles[0]!.units;
        expect(u1.find((u) => u.id === 'a_omori')?.side).toBe('ally');
        expect(u1.find((u) => u.id === 'e_tashiro')?.side).toBe('enemy');
        const h2 = new Harness(new MemoryStorage());
        await playToAftermath(h2, 'alone');
        const u2 = h2.battles[0]!.units.map((u) => u.id);
        expect(u2).toEqual(expect.arrayContaining(['a_reserve', 'e_reserve']));
        expect(u2).not.toContain('a_tashiro');
    });
    it('戦後の場面：敗北で源蔵は負傷して座る、新八の部隊が全滅すると新八は居ない', async () => {
        const h = new Harness(new MemoryStorage(), { result: 'defeat', units: { a_shinpachi: { status: 'destroyed', end: 0 } } });
        await playToAftermath(h, 'tashiro');
        expect(h.game.state?.characters.genzo).toBe('wounded');
        expect(h.game.state?.characters.shinpachi).toBe('captured');
        expect(h.world.cast.find((c) => c.id === 'genzo')?.pose).toBe('sit');
        expect(h.world.cast.map((c) => c.id)).not.toContain('shinpachi');
        expect(h.view.intros).toContain('落ち延びた夜');
    });
});

describe('保存して開き直す', () => {
    it('支度の段階で手動保存 → 開き直すと、同じ段階・陣営・位置から', async () => {
        const storage = new MemoryStorage();
        const h = new Harness(storage);
        await playToMuster(h, 'omori');
        h.world.pose = { x: 1.2, z: -3.4, heading: 1.1 };
        void h.game.openMenu();
        let m = await h.next('menu');
        expect(m.info.canSave).toBe(true);
        expect(m.info.status.find((s) => s.label === '協力陣営')?.value).toBe('大森家と組んだ');
        m.answer('save');
        m = await h.next('menu');
        expect(m.info.message?.ok).toBe(true);
        expect(m.info.message?.text).toContain('読み戻して確かめました');
        m.answer('close');
        await flush();
        expect(h.game.screen).toBe('explore');
        expect(h.world.control).toBe(true);

        // 開き直す（別のゲームの入れ物で、同じ保存先）
        const h2 = new Harness(storage);
        void h2.game.start();
        const t = await h2.next('title');
        expect(t.info.save?.summary).toContain('出陣の支度');
        t.answer('continue');
        await flush();
        expect(h2.game.state?.phase).toBe('muster');
        expect(h2.game.state?.alliance).toBe('omori');
        expect(h2.world.pose).toEqual({ x: 1.2, z: -3.4, heading: 1.1 });
        expect(h2.world.cast.map((c) => c.id)).toContain('omori_envoy');
    });
    it('出陣前の自動保存から開き直すと、出陣の確認の前（支度）から', async () => {
        const storage = new MemoryStorage();
        // 合戦の途中で止まった（結果が返らない）
        const h = new Harness(storage, { runner: () => new Promise<BattleOutcome>(() => {}) });
        await playToMuster(h, 'alone');
        const gate = await h.walkIntoGate();
        gate.answer('depart');
        await flush(60);
        expect(h.game.screen).toBe('battle');
        const s = h.saved();
        expect(s.status === 'ok' && s.data.point).toBe('departure');
        const h2 = new Harness(storage);
        void h2.game.start();
        const t = await h2.next('title');
        t.answer('continue');
        await flush();
        expect(h2.game.state?.phase).toBe('muster');
        expect(h2.world.pose).toMatchObject({ x: START.x, z: START.z });
        // 開始の位置は城門の場所の外。城門へ歩けば、また出陣の確認
        const g2 = await h2.walkIntoGate();
        g2.answer('stay');
        await flush();
    });
    it('戦後の自動保存から開き直すと、戦後の場面（負傷・関係もそのまま）', async () => {
        const storage = new MemoryStorage();
        const h = new Harness(storage, { result: 'retreat' });
        await playToAftermath(h, 'tashiro');
        const rel = h.game.state!.relations;
        const h2 = new Harness(storage);
        void h2.game.start();
        (await h2.next('title')).answer('continue');
        await flush();
        expect(h2.game.state?.phase).toBe('aftermath');
        expect(h2.game.state?.relations).toEqual(rel);
        expect(h2.game.state?.battle?.result).toBe('retreat');
        await h2.talkTo('genzo', 'end_chapter');
        expect((await h2.next('ending')).view.id).toBe('retreat');
    });
    it('版 1 の保存（変更前に書いたもの）から続きを遊べる：戦後は結末まで、出陣前は支度から合戦へ', async () => {
        const storage = new MemoryStorage();
        storage.data.set(CAMPAIGN_SAVE_KEY, V1_AFTERMATH_OMORI_DEFEAT);
        const h = new Harness(storage, { runner: async () => { throw new Error('合戦をやり直してはいけない'); } });
        void h.game.start();
        const t = await h.next('title');
        expect(t.info.save?.summary).toContain('戦後');
        t.answer('continue');
        await flush();
        expect(h.game.state?.phase).toBe('aftermath');
        expect(h.game.state?.relations).toEqual({ tashiro: -20, omori: 0, washio: -60 });
        await h.talkTo('genzo', 'end_chapter');
        expect((await h.next('ending')).view.id).toBe('defeat_sheltered');
        const sv = h.saved();
        expect(sv.status === 'ok' && sv.data.version).toBe(2);

        const s2 = new MemoryStorage();
        s2.data.set(CAMPAIGN_SAVE_KEY, V1_DEPARTURE_TASHIRO);
        const h2 = new Harness(s2, { result: 'victory' });
        void h2.game.start();
        (await h2.next('title')).answer('continue');
        await flush();
        expect(h2.game.state?.phase).toBe('muster');
        (await h2.walkIntoGate()).answer('depart');
        await flush(60);
        expect(h2.battles).toHaveLength(1);
        expect(h2.game.state?.phase).toBe('aftermath');
        expect(h2.game.state?.relations.tashiro).toBe(40);
    });
    it('結末の後で開き直すと、結末の画面から', async () => {
        const storage = new MemoryStorage();
        const h = new Harness(storage, { result: 'victory' });
        await playToEnding(h, 'alone');
        const h2 = new Harness(storage);
        void h2.game.start();
        (await h2.next('title')).answer('continue');
        const e = await h2.next('ending');
        expect(e.view.id).toBe('alone_victory');
    });
    it('「はじめから」は前の保存を上書きする前に確かめ、控えを残す（やめれば何も変わらない）', async () => {
        const storage = new MemoryStorage();
        storage.data.set(LEGACY_2D_SAVE_KEY, '{"2d":true}');
        const h = new Harness(storage);
        await playToMuster(h, 'tashiro');
        void h.game.openMenu();
        (await h.next('menu')).answer('save');
        (await h.next('menu')).answer('close');
        const before = storage.data.get(CAMPAIGN_SAVE_KEY)!;

        const h2 = new Harness(storage);
        void h2.game.start();
        (await h2.next('title')).answer('new');
        let c = await h2.next('confirm');
        expect(c.opts.buttons[c.opts.defaultIndex ?? 0]!.id).toBe('back');
        c.answer('back');
        (await h2.next('title')).answer('new');
        c = await h2.next('confirm');
        c.answer('new');
        await flush();
        expect(h2.game.state?.phase).toBe('explore');
        expect(storage.data.get(CAMPAIGN_SAVE_ARCHIVE_KEY)).toBe(before);
        expect(storage.data.get(CAMPAIGN_SAVE_KEY)).toBe(before); // まだ保存していないので、そのまま
        expect(storage.data.get(LEGACY_2D_SAVE_KEY)).toBe('{"2d":true}');
        expect(storage.touched.some((x) => x.key === LEGACY_2D_SAVE_KEY)).toBe(false);
    });
    it('壊れた保存：つづきからは出さず、理由を見せる（データは消さない）', async () => {
        const storage = new MemoryStorage();
        storage.data.set(CAMPAIGN_SAVE_KEY, '{broken');
        const h = new Harness(storage);
        void h.game.start();
        const t = await h.next('title');
        expect(t.info.save).toBeNull();
        expect(t.info.problem).toContain('壊れて');
        expect(storage.data.get(CAMPAIGN_SAVE_KEY)).toBe('{broken');
    });
});

describe('失敗と例外', () => {
    it('出陣前の保存に失敗：理由を見せ、やめれば支度のまま（合戦は始まらない）', async () => {
        const storage = new MemoryStorage();
        const h = new Harness(storage);
        await playToMuster(h, 'tashiro');
        storage.setItem = () => {
            throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
        };
        const gate = await h.walkIntoGate();
        gate.answer('depart');
        const c = await h.next('confirm');
        expect(c.opts.lines[0]).toContain('いっぱい');
        expect(c.opts.buttons[c.opts.defaultIndex ?? 0]!.id).toBe('stay');
        c.answer('stay');
        await flush();
        expect(h.game.state?.phase).toBe('muster');
        expect(h.battles).toHaveLength(0);
        expect(h.world.control).toBe(true);
        // 城門の場所の中に居る間は、もう一度は出ない（出て入り直すと出る）
        h.game.tick(1 / 30);
        await h.none();
        h.world.pose = { x: START.x, z: START.z, heading: 0 };
        h.game.tick(1 / 30);
        const again = await h.walkIntoGate();
        again.answer('depart');
        const c2 = await h.next('confirm');
        c2.answer('go');
        await flush(60);
        expect(h.battles).toHaveLength(1);
        expect(h.game.state?.phase).toBe('aftermath');
    });
    it('手動保存の失敗は失敗として見せる', async () => {
        const storage = new MemoryStorage();
        const h = new Harness(storage);
        await h.newGame();
        const orig = storage.getItem.bind(storage);
        storage.getItem = (k) => (k === CAMPAIGN_SAVE_KEY ? 'x' : orig(k)); // 読み戻しが一致しない
        void h.game.openMenu();
        (await h.next('menu')).answer('save');
        const m = await h.next('menu');
        expect(m.info.message?.ok).toBe(false);
        expect(m.info.message?.text).toContain('確認できなかった');
        m.answer('close');
    });
    it('合戦の画面が無いとき：仮の結果の選択は無く、やり直すかタイトルへ（出陣前の保存は残る）', async () => {
        const storage = new MemoryStorage();
        const h = new Harness(storage, { runner: null });
        await playToMuster(h, 'tashiro');
        (await h.walkIntoGate()).answer('depart');
        const c = await h.next('confirm');
        expect(c.opts.title).toContain('合戦を始められません');
        expect(c.opts.buttons.map((b) => b.id)).toEqual(['retry', 'title']);
        c.answer('title');
        await h.next('title');
        const saved = h.saved();
        expect(saved.status === 'ok' && saved.data.point).toBe('departure');
    });
    it('合戦の画面の読み込みに失敗しても、もう一度で本物の合戦へ進める', async () => {
        let tries = 0;
        const battles: BattleSetup[] = [];
        const h = new Harness(new MemoryStorage(), {
            load: async () => {
                if (tries++ === 0) throw new Error('通信が切れました');
                return async (setup) => {
                    battles.push(setup);
                    return outcomeFromSetup(setup, 'defeat');
                };
            },
        });
        await playToMuster(h, 'omori');
        (await h.walkIntoGate()).answer('depart');
        const c = await h.next('confirm');
        expect(c.opts.lines.join('')).toContain('通信が切れました');
        c.answer('retry');
        await flush(60);
        expect(battles).toHaveLength(1);
        expect(h.game.state?.phase).toBe('aftermath');
        expect(h.game.state?.battle?.result).toBe('defeat');
    });
    it('メニューからタイトルへ（確かめてから）。会話中は話しかけを受け付けず、メニューは会話の上に重なる（閉じれば同じ会話のまま）', async () => {
        const h = new Harness(new MemoryStorage());
        await h.newGame();
        h.world.walkTo('genzo');
        h.game.tick(1 / 30);
        void h.game.interact();
        const g = await h.next('script');
        void h.game.interact('shinpachi');
        await h.none();
        // 会話の途中のメニュー：会話はそのまま待っている（新しい会話も、答えも出ない）
        void h.game.openMenu();
        const m = await h.next('menu');
        expect(h.game.screen).toBe('menu');
        void h.game.openMenu(); // 二重には開かない
        await h.none();
        m.answer('close');
        await h.none();
        expect(h.game.screen).toBe('talk');
        expect(h.game.state?.talked['explore.genzo']).toBeUndefined();
        expect(h.world.control).toBe(false);
        g.answer('not_yet');
        await flush();
        expect(h.game.state?.phase).toBe('explore');
        void h.game.openMenu();
        (await h.next('menu')).answer('title');
        const c = await h.next('confirm');
        expect(c.opts.buttons[c.opts.defaultIndex ?? 0]!.id).toBe('back');
        c.answer('title');
        await h.next('title');
        expect(h.world.control).toBe(false);
        expect(h.view.hudInfo).toBeNull();
    });
    it('会話の途中のメニューで保存でき、タイトルへ戻ると会話は捨てる（次の流れは普通に動く）', async () => {
        const storage = new MemoryStorage();
        const h = new Harness(storage);
        await playToMuster(h, 'omori');
        h.world.walkTo('genzo');
        h.game.tick(1 / 30);
        void h.game.interact();
        await h.next('script');
        void h.game.openMenu();
        (await h.next('menu')).answer('save');
        const m2 = await h.next('menu');
        expect(m2.info.message?.ok).toBe(true);
        const sv = h.saved();
        expect(sv.status === 'ok' && sv.data.phase).toBe('muster');
        m2.answer('title');
        (await h.next('confirm')).answer('title');
        const t = await h.next('title');
        expect(h.view.abandoned).toBe(1);
        expect(h.game.state).toBeNull();
        t.answer('continue');
        await flush();
        expect(h.game.state?.phase).toBe('muster');
        expect(h.world.control).toBe(true);
        await h.talkTo('shinpachi');
        expect(h.game.screen).toBe('explore');
    });
    it('軍議の途中のメニュー：保存はできない（理由つき）。閉じれば同じ軍議の選択のまま', async () => {
        const h = new Harness(new MemoryStorage());
        await h.newGame();
        await h.talkTo('genzo', 'open_council');
        const c = await h.next('script');
        expect(c.mode).toBe('council');
        void h.game.openMenu();
        const m = await h.next('menu');
        expect(m.info.canSave).toBe(false);
        expect(m.info.saveNote).toContain('軍議');
        m.answer('close');
        await h.none();
        expect(h.game.screen).toBe('council');
        c.answer('ally_alone');
        const conf = await h.next('script');
        expect(conf.script.id).toBe('council.confirm.alone');
    });
    it('遊んだ時間を足して保存する（合戦の間の時間も）', async () => {
        const storage = new MemoryStorage();
        const h = new Harness(storage);
        await playToMuster(h, 'tashiro');
        for (let i = 0; i < 90; i++) h.game.tick(1);
        (await h.walkIntoGate()).answer('depart');
        await flush(60);
        const s = h.saved();
        expect(s.status === 'ok' && s.data.playTimeSec).toBeGreaterThanOrEqual(90);
    });
});

describe('本物の合戦の計算でつなぐ（3 つの経路）', () => {
    /** 合戦の画面の代わりに、本物の合戦の計算（sim.ts）を采配の台本で最後まで進める（画面の「続ける」と同じ結果を返す） */
    const simRunner = (plan: (a: Alliance) => Parameters<typeof runToEnd>[1]): BattleRunnerLike => async (setup) => {
        const s = createBattle(setup);
        const a: Alliance = setup.units.some((u) => u.id === 'a_tashiro') ? 'tashiro' : setup.units.some((u) => u.id === 'a_omori') ? 'omori' : 'alone';
        return runToEnd(s, plan(a));
    };
    const cases: { a: Alliance; plan: (a: Alliance) => Parameters<typeof runToEnd>[1]; result: BattleResultKind; ending: string }[] = [
        { a: 'tashiro', plan: (a) => planScript(a), result: 'victory', ending: 'tashiro_victory' },
        { a: 'omori', plan: () => hqAloneScript(), result: 'defeat', ending: 'defeat_' },
        { a: 'alone', plan: () => retreatAt(20), result: 'retreat', ending: 'retreat' },
    ];
    for (const c of cases) {
        it(`${c.a} × ${c.result}：出陣前の保存 → 合戦の計算 → 戦後の保存 → 結末 ${c.ending}`, async () => {
            const storage = new MemoryStorage();
            const h = new Harness(storage, { runner: simRunner(c.plan) });
            await playToMuster(h, c.a);
            const troopsBefore = { ...h.game.state!.troops };
            (await h.walkIntoGate()).answer('depart');
            await flush(80);
            const s = h.game.state!;
            expect(s.phase).toBe('aftermath');
            expect(s.battle?.result).toBe(c.result);
            // 戦後の自動保存に、結果・兵・関係が入る
            const saved = h.saved();
            expect(saved.status === 'ok' && saved.data.point).toBe('aftermath');
            expect(saved.status === 'ok' && saved.data.battle?.result).toBe(c.result);
            expect(saved.status === 'ok' && saved.data.relations).toEqual(s.relations);
            expect(s.troops.genzo).toBeLessThanOrEqual(troopsBefore.genzo);
            // 協力陣営で関係が変わる（独力は田代・大森とも変わらない）
            if (c.a === 'alone') expect([s.relations.tashiro, s.relations.omori]).toEqual([10, 10]);
            else expect(s.relations[c.a === 'tashiro' ? 'omori' : 'tashiro']).toBe(-20);
            await h.talkTo('genzo', 'end_chapter');
            const e = await h.next('ending');
            expect(h.game.state?.ending?.startsWith(c.ending)).toBe(true);
            expect(e.view.footer).toContain('仮シナリオ');
        });
    }
});

describe('合戦の結果は、勝ち負けが決まった時（結果の画面の前）に保存する', () => {
    /** 合戦の画面の代わり：勝ち負けが決まったら onDecided を呼び、「続ける」（release）まで結果を返さない */
    function panelRunner(result: BattleResultKind, opts: { decideTimes?: number } = {}) {
        const st: { notes: ({ ok: boolean; text: string } | null)[]; release: () => void; reached: boolean } = { notes: [], release: () => {}, reached: false };
        const runner: BattleRunnerLike = (setup, hooks) =>
            new Promise((resolve) => {
                const o = outcomeFromSetup(setup, result);
                for (let i = 0; i < (opts.decideTimes ?? 1); i++) st.notes.push(hooks?.onDecided?.(o) ?? null);
                st.reached = true;
                st.release = () => resolve(o);
            });
        return { runner, st };
    }
    it('結果の画面の時点で戦後の保存がある：開き直すと戦後から（合戦をやり直さず、関係・兵は 1 回分だけ）', async () => {
        const storage = new MemoryStorage();
        const { runner, st } = panelRunner('retreat');
        const h = new Harness(storage, { runner });
        await playToMuster(h, 'tashiro');
        const before = h.game.state!;
        (await h.walkIntoGate()).answer('depart');
        await flush(60);
        expect(st.reached).toBe(true);
        // 結果の画面：保存できたこと（読み戻して確かめた）を出す
        expect(st.notes[0]?.ok).toBe(true);
        expect(st.notes[0]?.text).toContain('読み戻して確かめました');
        const sv = h.saved();
        expect(sv.status).toBe('ok');
        if (sv.status !== 'ok') return;
        expect(sv.data.point).toBe('aftermath');
        expect(sv.data.phase).toBe('aftermath');
        expect(sv.data.battle?.result).toBe('retreat');
        expect(sv.data.battleId).toMatch(/^ch1-/);
        expect(sv.data.appliedBattleId).toBe(sv.data.battleId);
        const want = { ...before.relations, tashiro: before.relations.tashiro + 5, omori: before.relations.omori - 30 };
        expect(sv.data.relations).toEqual(want);
        // ここで閉じて開き直す（結果の画面の「続ける」を押さない）
        for (let n = 0; n < 2; n++) {
            const h2 = new Harness(storage, { runner: async () => { throw new Error('合戦をやり直してはいけない'); } });
            void h2.game.start();
            (await h2.next('title')).answer('continue');
            await flush();
            expect(h2.game.state?.phase).toBe('aftermath');
            expect(h2.game.state?.battle?.result).toBe('retreat');
            expect(h2.game.state?.relations).toEqual(want);
            expect(h2.game.screen).toBe('explore');
            // 戦後の手動保存で上書きしても、反映の済み印はそのまま
            void h2.game.openMenu();
            (await h2.next('menu')).answer('save');
            (await h2.next('menu')).answer('close');
            await flush();
        }
        const again = h.saved();
        expect(again.status === 'ok' && again.data.relations).toEqual(want);
        expect(again.status === 'ok' && again.data.appliedBattleId).toBe(sv.data.battleId);
        // 元のページで「続ける」を押しても、二重にはかからない（保存も書き直さない）
        const writes = storage.touched.filter((t) => t.op === 'set' && t.key === CAMPAIGN_SAVE_KEY).length;
        st.release();
        await flush(40);
        expect(h.game.state?.phase).toBe('aftermath');
        expect(h.game.state?.relations).toEqual(want);
        expect(storage.touched.filter((t) => t.op === 'set' && t.key === CAMPAIGN_SAVE_KEY).length).toBe(writes);
        expect(h.view.toasts.some((t) => t.kind === 'ok' && t.text.includes('戦後'))).toBe(true);
    });
    it('勝ち負けの知らせが 2 回来ても、結果の反映と保存は 1 回だけ', async () => {
        const storage = new MemoryStorage();
        const { runner, st } = panelRunner('victory', { decideTimes: 3 });
        const h = new Harness(storage, { runner });
        await playToMuster(h, 'omori');
        const before = h.game.state!;
        const writes0 = storage.touched.filter((t) => t.op === 'set' && t.key === CAMPAIGN_SAVE_KEY).length;
        (await h.walkIntoGate()).answer('depart');
        await flush(60);
        st.release();
        await flush(40);
        expect(st.notes).toHaveLength(3);
        expect(st.notes.every((n) => n?.ok)).toBe(true);
        expect(h.game.state?.relations.omori).toBe(before.relations.omori + 30);
        expect(h.game.state?.relations.tashiro).toBe(before.relations.tashiro - 30);
        // 出陣前 1 回 + 戦後 1 回
        expect(storage.touched.filter((t) => t.op === 'set' && t.key === CAMPAIGN_SAVE_KEY).length - writes0).toBe(2);
    });
    it('結果の保存に失敗：結果の画面に失敗の理由を出し（成功とは言わない）、続けて遊べる（手元の状態は戦後）', async () => {
        const storage = new MemoryStorage();
        const { runner, st } = panelRunner('defeat');
        const h = new Harness(storage, { runner });
        await playToMuster(h, 'alone');
        // 出陣前の保存は書ける。戦後（結果）の保存だけ、容量不足で失敗させる
        const origSet = storage.setItem.bind(storage);
        storage.setItem = (k, v) => {
            if (k === CAMPAIGN_SAVE_KEY && v.includes('"point":"aftermath"')) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
            origSet(k, v);
        };
        (await h.walkIntoGate()).answer('depart');
        await flush(60);
        expect(st.reached).toBe(true);
        expect(st.notes[0]?.ok).toBe(false);
        expect(st.notes[0]?.text).toContain('保存できませんでした');
        expect(st.notes[0]?.text).toContain('いっぱい');
        expect(st.notes[0]?.text).not.toContain('保存しました');
        expect(st.notes[0]?.text).toContain('出陣前');
        st.release();
        await flush(40);
        expect(h.game.state?.phase).toBe('aftermath');
        expect(h.game.state?.battle?.result).toBe('defeat');
        expect(h.game.screen).toBe('explore');
        expect(h.view.toasts.some((t) => t.kind === 'error' && t.text.includes('保存できませんでした'))).toBe(true);
        expect(h.view.toasts.some((t) => t.kind === 'ok' && t.text.includes('戦後'))).toBe(false);
        // 保存に残っているのは出陣前（開き直すと出陣前から＝合戦をやり直す。二重にはかからない）
        const sv = h.saved();
        expect(sv.status === 'ok' && sv.data.point).toBe('departure');
        // 保存先が戻れば、戦後にメニューから保存し直せる
        storage.setItem = origSet;
        void h.game.openMenu();
        (await h.next('menu')).answer('save');
        const m = await h.next('menu');
        expect(m.info.message?.ok).toBe(true);
        m.answer('close');
        const sv2 = h.saved();
        expect(sv2.status === 'ok' && sv2.data.phase).toBe('aftermath');
        expect(sv2.status === 'ok' && sv2.data.appliedBattleId).toBe(h.game.state?.battleId);
    });
    it('合戦の画面が知らせを送らなくても（古い呼び方）、結果は 1 回だけ反映して保存する', async () => {
        const storage = new MemoryStorage();
        const h = new Harness(storage, { result: 'victory' });
        await playToAftermath(h, 'tashiro');
        const sv = h.saved();
        expect(sv.status === 'ok' && sv.data.point).toBe('aftermath');
        expect(h.game.state?.appliedBattleId).toBe(h.game.state?.battleId);
    });
});

describe('確認用の状態作り', () => {
    it('devStateFor は普通の遊び方と同じ順で状態を作る', () => {
        expect(devStateFor('explore').phase).toBe('explore');
        expect(devStateFor('muster', 'omori').alliance).toBe('omori');
        const a = devStateFor('aftermath', 'alone', 'retreat');
        expect(a.phase).toBe('aftermath');
        expect(a.battle?.result).toBe('retreat');
        expect(devStateFor('ending', 'tashiro', 'defeat').ending).toBe('defeat_sheltered');
    });
});
