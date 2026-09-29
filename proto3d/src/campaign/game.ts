/**
 * 第一章を 1 つのゲームとしてつなぐ（タイトル → 探索 → 会話 → 軍議 → 支度 → 出陣 → 合戦 → 戦後 → 結末 → タイトル）。
 *
 * ここは「つなぎ」だけで、three も DOM も直接は使わない：
 * - 画面（会話・選択肢・タイトル・メニュー・結末・知らせ）は GameView（ui/view.ts が DOM で作る）。
 * - 探索の場面（主人公の位置・人物の配置・操作の止め／戻し）は GameWorld（explore/world.ts が three で作る）。
 * - 合戦は app/modes.ts の getBattleRunner()（battle/ が登録する）。部隊単位の指揮の画面で、ここは結果を受け取るだけ。
 * そのため Node 上のテスト（tests/proto3d-game.test.ts）で、偽の画面・場面を差し込んで章を最後まで通せる。
 *
 * 段階の進め方・台詞・保存の中身はシナリオ（scenario.ts の Scenario）が持つ（ここで勝手に状態を作らない）。
 * - 架空の第一章「国境の砦」：fictional.ts（flow.ts・story.ts・save.ts のまま）。deps.scenarios を省くと、これだけで動く（今までと同じ）。
 * - 歴史分岐「元亀元年・家康」：ieyasu1570/。
 * 会話中のメニュー・知らせ・決着の時点の結果保存・合戦の id ごとに 1 回だけの反映・書いた後に読み戻す保存は、ここで共通に扱う。
 *
 * 仮シナリオ：人物・家・出来事はすべて架空の仮の設定（story.ts の先頭の注記）。
 */
import type { BattleOutcome, BattleResultKind, BattleRunHooks, BattleSetup } from '../battle/types';
import { inGateZone, nearestInteractable, safePose, type CastMember } from '../explore/cast';
import { applyBattleOutcome, battleSetupFor, finishTalk, newGame, outcomeFromSetup } from './flow';
import { fictionalScenario } from './fictional';
import { CampaignSaveStore, SAVE_POINT_LABELS, saveFailureMessage, type SavePoint } from './save';
import { formatSavedTime, type AnyScenario, type Scenario, type ScenarioEndingView, type ScenarioId, type ScenarioScript, type ScenarioStateCore, type StatusLine } from './scenario';
import type { Alliance, CampaignState, ChoiceId, ExplorePose, TalkId } from './state';
import type { Rect } from '../layout';

export { statusLines } from './fictional';
export type { StatusLine } from './scenario';

// ================= 画面と場面の約束 =================

/** タイトルに並べるシナリオ 1 つ分 */
export interface TitleScenarioInfo {
    id: ScenarioId;
    /** 章の名前 */
    title: string;
    /** 短い札（「仮シナリオ」「歴史分岐・創作を含む」） */
    label: string;
    /** 続きから遊べる保存（無ければ null） */
    save: { summary: string } | null;
    /** 保存を読めないときの説明（壊れている・保存領域が使えない） */
    problem: string | null;
    /** 史実と創作の区別の注記 */
    note: string;
}
export interface TitleInfo {
    /** 続きから遊べる保存（無ければ null）。最初のシナリオ（scenarios[0]）の物 */
    save: { summary: string } | null;
    /** 保存を読めないときの説明（壊れている・保存領域が使えない）。最初のシナリオの物 */
    problem: string | null;
    /** 最初のシナリオの注記 */
    note: string;
    /** 選べるシナリオ（1 つだけのときは、上の 3 つと同じ中身が 1 つ入る） */
    scenarios: TitleScenarioInfo[];
}
/** 'new'／'continue' は最初のシナリオ。'new:ieyasu1570' のようにシナリオを指定もできる */
export type TitleAction = 'new' | 'continue' | `${'new' | 'continue'}:${ScenarioId}`;

export interface ConfirmOptions {
    title: string;
    lines: string[];
    buttons: { id: string; label: string }[];
    /** 最初に選ばれているボタン（戻れない操作では「やめる」側にする） */
    defaultIndex?: number;
    /** Esc で選ぶボタン */
    cancelId?: string;
}

export interface MenuInfo {
    status: StatusLine[];
    canSave: boolean;
    /** 保存できないときの理由 */
    saveNote: string | null;
    /** 直前の保存の結果 */
    message: { ok: boolean; text: string } | null;
}
export type MenuAction = 'save' | 'title' | 'close';

export interface HudInfo {
    chapter: string;
    phase: string;
    objective: string;
    provisional: string;
}
export interface PromptInfo {
    id: string;
    verb: string;
    label: string;
}

export interface ScriptOptions {
    /** 'council' は軍議の画面（城の広間。探索の場面を暗くして見出しを出す） */
    mode: 'talk' | 'council';
}

/** 画面（ui/view.ts）。待つもの（会話・選択・確認・メニュー・タイトル・結末）は Promise で結果を返す */
export interface GameView {
    title(info: TitleInfo): Promise<TitleAction>;
    /** 台詞を順に見せ、選択肢があれば選ばせて、選んだ id を返す（選択肢が無ければ null） */
    script(script: ScenarioScript, opts: ScriptOptions): Promise<string | null>;
    confirm(opts: ConfirmOptions): Promise<string>;
    menu(info: MenuInfo): Promise<MenuAction>;
    ending(view: ScenarioEndingView): Promise<void>;
    hud(info: HudInfo | null): void;
    prompt(p: PromptInfo | null): void;
    intro(title: string, text: string): void;
    toast(text: string, kind: 'ok' | 'error' | 'info'): void;
    /** 開いている画面（会話・確認など）を、答えを返さずにすべて閉じる（会話の途中にメニューから「タイトルへ」を選んだとき） */
    abandon(): void;
}

/** 探索の場面（explore/world.ts） */
export interface GameWorld {
    setCast(cast: CastMember<string>[]): void;
    heroPose(): ExplorePose;
    setHeroPose(p: ExplorePose): void;
    /** 探索の操作（歩く・見回す）を許す／止める。止めるときは押している入力も離す */
    setControl(enabled: boolean): void;
    /** 話す相手と主人公を向き合わせる */
    faceTalk?(id: string): void;
    /** 主人公が歩けない所（壁・家。人物の当たり判定は含めない） */
    walls(): Rect[];
}

/** 合戦を 1 回（hooks.onDecided：勝ち負けが決まった時＝結果の画面の前に呼ぶ。ここで結果を反映して保存する） */
export type BattleRunnerLike = (setup: BattleSetup, hooks?: BattleRunHooks) => Promise<BattleOutcome>;

export interface GameDeps {
    view: GameView;
    world: GameWorld;
    /** 架空の第一章の保存（'koto-sengoku/3d-chapter1'）。scenarios を省いたときは、これで架空の第一章だけを動かす */
    store: CampaignSaveStore;
    /** 並べるシナリオ（タイトルの順）。省けば架空の第一章だけ */
    scenarios?: AnyScenario[];
    /** 合戦の画面（読み込みを待つことがあるので Promise）。読み込めなければ null か例外（「もう一度／タイトルへ」を出す） */
    battleRunner: () => Promise<BattleRunnerLike | null>;
    /** 今の時刻（ミリ秒。合戦にかかった時間を遊んだ時間に足す） */
    now?: () => number;
}

export type GameScreen = 'boot' | 'title' | 'explore' | 'talk' | 'council' | 'menu' | 'battle' | 'ending';

// ================= 本体 =================

/** 遊んでいるシナリオと、その状態 */
type Run = { scenario: AnyScenario; state: ScenarioStateCore };

/**
 * 章を 1 つのゲームとしてつなぐ。S は state の型（架空の第一章だけなら CampaignState。複数のシナリオを並べるときは呼ぶ側が決める）。
 */
export class ChapterGame<S extends ScenarioStateCore = CampaignState> {
    private run: Run | null = null;
    private _screen: GameScreen = 'boot';
    private busy = false;
    private cast: CastMember<string>[] = [];
    private prompted: CastMember<string> | null = null;
    /** 城門の出陣の場所に入ったまま（出てから入り直すまで、もう一度は確認を出さない） */
    private inGate = false;
    /** まだ状態に足していない遊んだ時間（秒） */
    private playAcc = 0;
    private readonly now: () => number;
    /** メニューを開いている（会話の途中に開いたときも） */
    private menuOpen = false;
    /** 画面の流れの世代（会話の途中にタイトルへ戻ったら進める。捨てた流れの後始末が、新しい流れの busy を消さないように） */
    private epoch = 0;
    /** 出陣ごとの合戦の id の通し番号 */
    private battleSeq = 0;
    /** 並べるシナリオ（タイトルの順） */
    readonly scenarios: readonly AnyScenario[];
    /** 確認用：最後に起きた誤り */
    lastError: string | null = null;

    constructor(private readonly deps: GameDeps) {
        this.now = deps.now ?? (() => Date.now());
        this.scenarios = deps.scenarios && deps.scenarios.length > 0 ? deps.scenarios.slice() : [fictionalScenario(deps.store)];
    }

    get state(): S | null {
        return (this.run?.state as S | undefined) ?? null;
    }
    /** 遊んでいるシナリオ（タイトルでは null） */
    get scenarioId(): ScenarioId | null {
        return this.run?.scenario.id ?? null;
    }
    get screen(): GameScreen {
        return this._screen;
    }
    get castNow(): readonly CastMember<string>[] {
        return this.cast;
    }
    /** 今「話す」ボタンに出ている相手 */
    get promptTarget(): string | null {
        return this.prompted?.id ?? null;
    }

    /** 遊んでいるシナリオ（無ければ投げる。画面の流れの中だけで使う） */
    private get sc(): AnyScenario {
        if (!this.run) throw new Error('シナリオが始まっていません');
        return this.run.scenario;
    }
    /** 今の状態（無ければ投げる） */
    private get st(): ScenarioStateCore {
        if (!this.run) throw new Error('シナリオが始まっていません');
        return this.run.state;
    }
    private set st(s: ScenarioStateCore) {
        if (!this.run) throw new Error('シナリオが始まっていません');
        this.run.state = s;
    }

    private scenarioOf(id: ScenarioId | undefined): AnyScenario {
        if (id === undefined) return this.scenarios[0]!;
        const sc = this.scenarios.find((x) => x.id === id);
        if (!sc) throw new Error(`シナリオ ${id} はありません`);
        return sc;
    }

    /** 確認用：待っている画面の流れを捨てる（開発ビルドの __game.setPhase だけ。画面は先に閉じておく） */
    devAbandon(): void {
        this.epoch++;
        this.busy = false;
        this.menuOpen = false;
    }

    /** 起動：タイトルへ */
    start(): Promise<void> {
        return this.title();
    }

    // ---------------- タイトル ----------------

    async title(): Promise<void> {
        const { view, world } = this.deps;
        this.run = null;
        this._screen = 'title';
        this.setPrompt(null);
        view.hud(null);
        world.setControl(false);
        this.cast = [];
        world.setCast([]);
        for (;;) {
            const loads = this.scenarios.map((sc) => ({ sc, loaded: sc.store.load() }));
            const entries: TitleScenarioInfo[] = loads.map(({ sc, loaded }) => ({
                id: sc.id,
                title: sc.chapterTitle,
                label: sc.label,
                save: loaded.status === 'ok' ? { summary: loaded.summary } : null,
                problem: loaded.status === 'corrupt' || loaded.status === 'unavailable' ? loaded.message : null,
                note: sc.note,
            }));
            const first = entries[0]!;
            const info: TitleInfo = { save: first.save, problem: first.problem, note: first.note, scenarios: entries };
            const act = await view.title(info);
            const [kind, sid] = act.split(':') as ['new' | 'continue', ScenarioId | undefined];
            const pick = loads.find((l) => l.sc.id === (sid ?? loads[0]!.sc.id));
            if (!pick) continue;
            const { sc, loaded } = pick;
            if (kind === 'continue') {
                if (loaded.status !== 'ok') continue;
                this.begin(loaded.state, sc.id);
                return;
            }
            // はじめから：前の保存があれば、上書きのことを知らせて確かめる（前の保存は控えに写して残す）
            if (loaded.status === 'ok' || loaded.status === 'corrupt') {
                const what = loaded.status === 'ok' ? `今の保存（${loaded.summary}）` : '読み込めない保存データ';
                const c = await view.confirm({
                    title: 'はじめから遊ぶ',
                    lines: [
                        `${what}は、この後で保存したときに上書きされます。`,
                        this.scenarios.length > 1
                            ? '念のため、今の保存を控えとして 1 つ残します（前の控えは置き換わります）。ほかのシナリオの保存と、2D 版の保存には触れません。'
                            : '念のため、今の保存を控えとして 1 つ残します（前の控えは置き換わります）。2D 版の保存には触れません。',
                    ],
                    buttons: [
                        { id: 'new', label: 'はじめから遊ぶ' },
                        { id: 'back', label: 'やめる' },
                    ],
                    defaultIndex: 1,
                    cancelId: 'back',
                });
                if (c !== 'new') continue;
                if (!sc.store.archivePrevious()) {
                    const c2 = await view.confirm({
                        title: '控えを作れませんでした',
                        lines: ['今の保存の控えを書き込めませんでした。はじめから遊んで保存すると、今の保存は上書きされます。'],
                        buttons: [
                            { id: 'new', label: 'それでもはじめから' },
                            { id: 'back', label: 'やめる' },
                        ],
                        defaultIndex: 1,
                        cancelId: 'back',
                    });
                    if (c2 !== 'new') continue;
                }
            } else if (loaded.status === 'unavailable') {
                view.toast(`${loaded.message}このまま遊べますが、保存はできません。`, 'error');
            }
            this.begin(sc.newGame(), sc.id);
            return;
        }
    }

    /**
     * 状態から遊び始める（はじめから・つづきから・確認用）。scenario を省けば架空の第一章（無ければ最初のシナリオ）。
     */
    begin(state: S, scenario?: ScenarioId): void {
        const sc = this.scenarioOf(scenario ?? (this.scenarios.some((x) => x.id === 'fictional') ? 'fictional' : undefined));
        this.run = { scenario: sc, state };
        this.playAcc = 0;
        if (state.phase === 'ending') {
            void this.showEnding();
            return;
        }
        if (state.phase === 'council') {
            // 軍議の途中（保存からは来ない。確認用）
            this.enterField(state.explore);
            void this.exclusive(() => this.runCouncil());
            return;
        }
        if (state.phase === 'battle') {
            // 合戦の途中からは始めない（保存の読み込みでは muster に直してある）
            throw new Error('合戦の段階からは始められません');
        }
        this.enterField(state.explore);
    }

    /** 探索の場面に入る（人物を置き、主人公を立たせ、段階の案内を出す）。pose 'keep' は今の位置のまま */
    private enterField(pose: ExplorePose | null | 'keep'): void {
        const s = this.st;
        const { view, world } = this.deps;
        this.cast = this.sc.cast(s);
        world.setCast(this.cast);
        if (pose !== 'keep') world.setHeroPose(safePose(pose, this.cast, world.walls()));
        const p = world.heroPose();
        // 読み込んだ位置が城門の場所の中なら、出て入り直すまでは確認を出さない
        this.inGate = inGateZone(this.cast, p.x, p.z);
        this._screen = 'explore';
        this.prompted = null;
        view.hud(this.hudInfo());
        const intro = this.sc.phaseIntro(s);
        view.intro(intro.title, intro.text);
        world.setControl(!this.busy);
    }

    private hudInfo(): HudInfo {
        const s = this.st;
        const sc = this.sc;
        return { chapter: sc.chapterTitle, phase: sc.phaseLabel(s.phase), objective: sc.objective(s), provisional: sc.label };
    }

    private refreshField(): void {
        this.cast = this.sc.cast(this.st);
        this.deps.world.setCast(this.cast);
        this.deps.view.hud(this.hudInfo());
    }

    // ---------------- 毎フレーム ----------------

    /** 探索の毎フレーム（main.ts から）。近くの相手の「話す」ボタン、城門の出陣の確認、遊んだ時間 */
    tick(dt: number): void {
        if (!this.run || this._screen !== 'explore') return;
        if (Number.isFinite(dt) && dt > 0) this.playAcc += Math.min(dt, 1);
        if (this.busy) return;
        const p = this.deps.world.heroPose();
        const gate = inGateZone(this.cast, p.x, p.z);
        if (gate && !this.inGate) {
            this.inGate = true;
            const g = this.cast.find((c) => c.kind === 'gate');
            if (g) void this.interact(g.id);
            return;
        }
        if (!gate) this.inGate = false;
        this.setPrompt(nearestInteractable(this.cast, p.x, p.z));
    }

    private setPrompt(c: CastMember<string> | null): void {
        if (c === this.prompted) return;
        this.prompted = c;
        this.deps.view.prompt(c ? { id: c.id, verb: c.verb, label: c.label } : null);
    }

    // ---------------- 話す ----------------

    /**
     * 話しかける（「話す」ボタン・E／Enter／Space）。id を省けば、今ボタンに出ている相手。
     * 確認用（__game.talk）では距離を問わず、今の段階で居る相手と話せる。
     */
    async interact(id?: string): Promise<void> {
        if (this.busy || this._screen !== 'explore' || !this.run) return;
        const target = id ?? this.prompted?.id;
        if (!target || !this.sc.canTalk(this.st, target)) return;
        const after = { ending: false };
        await this.exclusive(async () => {
            this._screen = 'talk';
            this.deps.world.faceTalk?.(target);
            const script = this.sc.talk(this.st, target);
            const choice = await this.deps.view.script(script, { mode: 'talk' });
            if (this.sc.isDeparture(target, choice)) {
                await this.depart(target, choice!);
                return;
            }
            this.st = this.sc.finishTalk(this.st, target, choice ?? undefined);
            const phase = this.st.phase;
            if (phase === 'council') {
                await this.runCouncil();
                return;
            }
            if (phase === 'ending') {
                after.ending = true;
                return;
            }
            this._screen = 'explore';
            this.refreshField();
        });
        if (after.ending) void this.reachEnding();
    }

    /** 軍議：方針を選び、確かめて決める（考え直すと選び直し）。決めたら出陣の支度（muster）へ */
    private async runCouncil(): Promise<void> {
        const { view } = this.deps;
        this._screen = 'council';
        this.setPrompt(null);
        view.hud(this.hudInfo());
        const intro = this.sc.phaseIntro(this.st);
        view.intro(intro.title, intro.text);
        while (this.st.phase === 'council') {
            const script = this.sc.talk(this.st, 'council');
            const choice = await view.script(script, { mode: 'council' });
            if (!choice) throw new Error('軍議で選択肢が選ばれませんでした');
            this.st = this.sc.finishTalk(this.st, 'council', choice);
        }
        // 軍議の後は、そのままの位置で支度の段階へ
        this.enterField('keep');
    }

    // ---------------- 出陣・合戦 ----------------

    /** 城門で「出陣する」を選んだ：出陣前の自動保存 → 合戦 → 結果の反映 → 戦後の自動保存 → 戦後の探索 */
    private async depart(talkId: string, choice: string): Promise<void> {
        const { view } = this.deps;
        const sc = this.sc;
        const before = this.st;
        let next = sc.depart(before, talkId, choice);
        // この出陣だけの合戦の id（結果の反映を 1 回だけにする鍵。保存にも入る）
        next = sc.withBattleId(next, `${sc.battleIdPrefix}-${Math.floor(this.now()).toString(36)}-${++this.battleSeq}`);
        next = this.foldPlay(next);
        // 出陣前の保存は、開始の位置から（読み込むと出陣の確認の前から再開する）
        next = sc.setExplorePose(next, null);
        const r = sc.store.save(next, 'departure');
        if (r.ok) {
            next = r.state;
            view.toast(`保存しました：${SAVE_POINT_LABELS.departure}`, 'ok');
        } else {
            const c = await view.confirm({
                title: '保存できませんでした',
                lines: [r.message, '保存せずに出陣すると、合戦の後で読み込み直したときに出陣前へは戻れません。'],
                buttons: [
                    { id: 'go', label: '保存せずに出陣する' },
                    { id: 'stay', label: '出陣をやめる' },
                ],
                defaultIndex: 1,
                cancelId: 'stay',
            });
            if (c !== 'go') {
                this.st = before;
                this._screen = 'explore';
                return;
            }
        }
        this.st = next;
        await this.runBattle();
    }

    private async runBattle(): Promise<void> {
        const { view, world } = this.deps;
        const sc = this.sc;
        this._screen = 'battle';
        this.setPrompt(null);
        view.hud(null);
        world.setControl(false);
        const setup = sc.battleSetup(this.st);
        const battleId = this.st.battleId!;
        let t0 = this.now();
        /** 合戦の時間を遊んだ時間へ足す（ここまでの分） */
        const addBattleTime = () => {
            const t = this.now();
            const sec = (t - t0) / 1000;
            t0 = t;
            if (Number.isFinite(sec) && sec > 0) this.playAcc += Math.min(sec, 7200);
        };
        let saved: { ok: boolean; text: string } | null = null;
        /** 勝ち負けが決まった：結果を 1 回だけ反映し、戦後の自動保存（読み戻して確かめる）。2 回目からは何もしない */
        const record = (o: BattleOutcome): { ok: boolean; text: string } => {
            if (this.st.appliedBattleId === battleId && saved) return saved;
            addBattleTime();
            const r = sc.applyOutcomeOnce(this.st, battleId, o);
            this.st = r.state;
            saved = this.autoSave('aftermath', true)!;
            return saved;
        };
        const hooks: BattleRunHooks = { onDecided: (o) => record(o) };
        let outcome: BattleOutcome | null = null;
        while (!outcome) {
            t0 = this.now();
            try {
                outcome = await this.fight(setup, hooks);
            } catch (e) {
                // 結果を反映した後の失敗（結果の画面の後片付けなど）なら、合戦はやり直さずに戦後へ
                if (this.st.appliedBattleId === battleId && this.st.battle) {
                    outcome = this.st.battle;
                    break;
                }
                const c = await view.confirm({
                    title: '合戦を始められませんでした',
                    lines: [errorText(e), '出陣前の自動保存があれば、タイトルの「つづきから」で出陣の前から遊べます。'],
                    buttons: [
                        { id: 'retry', label: 'もう一度' },
                        { id: 'title', label: 'タイトルへ' },
                    ],
                    defaultIndex: 0,
                });
                if (c === 'title') {
                    void this.title();
                    return;
                }
                continue;
            } finally {
                addBattleTime();
            }
        }
        // 合戦の画面が勝ち負けの知らせ（onDecided）を送らなかったときも、ここで 1 回だけ反映する（済んでいれば何もしない）
        const note = record(outcome);
        this.enterField(null);
        view.toast(note.ok ? `保存しました：${SAVE_POINT_LABELS.aftermath}` : note.text, note.ok ? 'ok' : 'error');
    }

    /** 合戦を 1 回（部隊を指揮する本物の画面。仮の結果の選択は無い） */
    private async fight(setup: BattleSetup, hooks: BattleRunHooks): Promise<BattleOutcome> {
        const runner = await this.deps.battleRunner();
        if (!runner) throw new Error('合戦の画面を読み込めませんでした。');
        return runner(setup, hooks);
    }

    // ---------------- 結末 ----------------

    /** 戦後に「この章を締めくくる」を選んだ：結末を保存して、結末の画面へ */
    private async reachEnding(): Promise<void> {
        const saved = this.autoSave('ending');
        if (saved && !saved.ok) this.deps.view.toast(saved.text, 'error');
        await this.showEnding();
    }

    private async showEnding(): Promise<void> {
        const { view, world } = this.deps;
        this._screen = 'ending';
        this.setPrompt(null);
        view.hud(null);
        world.setControl(false);
        await view.ending(this.sc.endingView(this.st));
        await this.title();
    }

    // ---------------- メニュー・保存 ----------------

    /**
     * メニュー（状態・保存・タイトルへ）。探索中と、会話・軍議の途中に開ける。
     * 会話の途中に開いたときは、会話の画面をそのまま下に残す（閉じれば同じ行・同じ選択肢の選び方のまま。会話は進まない）。
     */
    async openMenu(): Promise<void> {
        if (!this.run || this.menuOpen) return;
        if (this._screen === 'talk' || this._screen === 'council') {
            await this.menuOverScript();
            return;
        }
        if (this.busy || this._screen !== 'explore') return;
        const after = { title: false };
        await this.exclusive(async () => {
            this._screen = 'menu';
            after.title = (await this.menuLoop()) === 'title';
            if (!after.title) this._screen = 'explore';
        });
        if (after.title) void this.title();
    }

    /** 会話・軍議の途中のメニュー（会話の流れは待たせたまま） */
    private async menuOverScript(): Promise<void> {
        const back = this._screen;
        this._screen = 'menu';
        let act: 'close' | 'title';
        try {
            act = await this.menuLoop();
        } finally {
            this.menuOpen = false;
        }
        if (act !== 'title') {
            this._screen = back;
            return;
        }
        // 会話を捨ててタイトルへ（待っている会話の流れは、答えを返さずに閉じる）
        this.deps.view.abandon();
        this.epoch++;
        this.busy = false;
        await this.title();
    }

    private async menuLoop(): Promise<'close' | 'title'> {
        this.menuOpen = true;
        try {
            let message: MenuInfo['message'] = null;
            for (;;) {
                const act = await this.deps.view.menu(this.menuInfo(message));
                if (act === 'close') return 'close';
                if (act === 'save') {
                    message = this.saveManual();
                    continue;
                }
                const c = await this.deps.view.confirm({
                    title: 'タイトルへ戻る',
                    lines: ['保存していない進み具合は失われます。'],
                    buttons: [
                        { id: 'title', label: 'タイトルへ戻る' },
                        { id: 'back', label: 'やめる' },
                    ],
                    defaultIndex: 1,
                    cancelId: 'back',
                });
                if (c === 'title') return 'title';
            }
        } finally {
            this.menuOpen = false;
        }
    }

    menuInfo(message: MenuInfo['message'] = null): MenuInfo {
        const s = this.st;
        const sc = this.sc;
        const can = sc.canSaveManually(s);
        return {
            status: sc.statusLines(s, this.playAcc),
            canSave: can && sc.store.available,
            saveNote: !sc.store.available ? saveFailureMessage('unavailable') : can ? null : saveFailureMessage('not_now'),
            message,
        };
    }

    /** 手動保存（今の位置と向きを入れる）。書いた後に読み戻して確かめた結果を返す */
    saveManual(): { ok: boolean; text: string } {
        const sc = this.sc;
        let s = this.st;
        if (!sc.canSaveManually(s)) return { ok: false, text: saveFailureMessage('not_now') };
        s = sc.setExplorePose(s, this.deps.world.heroPose());
        s = this.foldPlay(s);
        this.st = s;
        const r = sc.store.save(s, 'manual');
        if (!r.ok) return { ok: false, text: `保存できませんでした：${r.message}` };
        this.st = r.state;
        return { ok: true, text: `保存しました（${formatSavedTime(r.savedAt)}・${sc.phaseLabel(s.phase)}）。書き込んだ内容を読み戻して確かめました。` };
    }

    /** 自動保存（書いた後に読み戻して確かめる）。detail は合戦の結果の画面に出す長めの文 */
    private autoSave(point: SavePoint, detail = false): { ok: boolean; text: string } | null {
        const sc = this.sc;
        const s = this.foldPlay(this.st);
        this.st = s;
        const r = sc.store.save(s, point);
        if (!r.ok) {
            const text = `保存できませんでした（${SAVE_POINT_LABELS[point]}）：${r.message}`;
            if (!detail) return { ok: false, text };
            return { ok: false, text: `${text}このまま続けて遊べます（戦後にメニューから保存し直せます）。今ページを閉じると、前の保存（出陣前）から始まります。` };
        }
        this.st = r.state;
        if (!detail) return { ok: true, text: `保存しました：${SAVE_POINT_LABELS[point]}` };
        return { ok: true, text: `この結果を保存しました（${SAVE_POINT_LABELS[point]}。書き込んだ内容を読み戻して確かめました）。ここで閉じても、この結果の後（戦後）から続けられます。` };
    }

    private foldPlay(s: ScenarioStateCore): ScenarioStateCore {
        const add = this.playAcc;
        this.playAcc = 0;
        return add > 0 ? this.sc.addPlayTime(s, add) : s;
    }

    // ---------------- 共通 ----------------

    /** 一度に 1 つの画面の流れだけ（会話中にメニューを開かない等）。探索の操作は止め、終わったら戻す */
    private async exclusive(fn: () => Promise<void>): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        const epoch = this.epoch;
        this.setPrompt(null);
        this.deps.world.setControl(false);
        try {
            await fn();
        } catch (e) {
            if (epoch !== this.epoch) return;
            this.lastError = errorText(e);
            console.error(e);
            this.deps.view.toast(`進められませんでした：${this.lastError}`, 'error');
            if (this.run && (this._screen === 'talk' || this._screen === 'menu')) this._screen = 'explore';
        } finally {
            // 捨てた流れ（会話の途中にタイトルへ戻った）の後始末では、新しい流れの状態に触れない
            if (epoch === this.epoch) {
                this.busy = false;
                if (this._screen === 'explore') this.deps.world.setControl(true);
            }
        }
    }
}

// ================= 表示用の文 =================

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// ================= 確認用（開発ビルドの __game・テスト） =================

const ALLY_CHOICE: Record<Alliance, ChoiceId> = { tashiro: 'ally_tashiro', omori: 'ally_omori', alone: 'ally_alone' };

/**
 * 確認用：指定の段階の状態を、普通の遊び方と同じ関数の順で作る（テスト・開発の早送り専用。本番の画面の流れでは使わない）。
 * 架空の第一章の物。歴史分岐シナリオは ieyasu1570/flow.ts の devIeyasuState。
 */
export function devStateFor(phase: 'explore' | 'muster' | 'aftermath' | 'ending', alliance: Alliance = 'tashiro', result: BattleResultKind = 'victory'): CampaignState {
    let s = newGame();
    if (phase === 'explore') return s;
    s = finishTalk(s, 'genzo', 'open_council');
    s = finishTalk(s, 'council', ALLY_CHOICE[alliance]);
    s = finishTalk(s, 'council', 'confirm_alliance');
    if (phase === 'muster') return s;
    s = finishTalk(s, 'gate', 'depart');
    s = applyBattleOutcome(s, outcomeFromSetup(battleSetupFor(s), result));
    if (phase === 'aftermath') return s;
    return finishTalk(s, 'genzo', 'end_chapter');
}

/** 型だけの確認：Scenario<CampaignState> を満たす（fictional.ts） */
export type FictionalScenario = Scenario<CampaignState>;
