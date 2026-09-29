/**
 * 第一章を 1 つのゲームとしてつなぐ（タイトル → 探索 → 会話 → 軍議 → 支度 → 出陣 → 合戦 → 戦後 → 結末 → タイトル）。
 *
 * ここは「つなぎ」だけで、three も DOM も直接は使わない：
 * - 画面（会話・選択肢・タイトル・メニュー・結末・知らせ）は GameView（ui/view.ts が DOM で作る）。
 * - 探索の場面（主人公の位置・人物の配置・操作の止め／戻し）は GameWorld（explore/world.ts が three で作る）。
 * - 合戦は app/modes.ts の getBattleRunner()（battle/ が登録する）。部隊単位の指揮の画面で、ここは結果を受け取るだけ。
 * そのため Node 上のテスト（tests/proto3d-game.test.ts）で、偽の画面・場面を差し込んで章を最後まで通せる。
 *
 * 段階の進め方・台詞・保存の中身は flow.ts・story.ts・save.ts のまま使う（ここで勝手に状態を作らない）。
 *
 * 仮シナリオ：人物・家・出来事はすべて架空の仮の設定（story.ts の先頭の注記）。
 */
import type { BattleOutcome, BattleResultKind, BattleRunHooks, BattleSetup } from '../battle/types';
import { castFor, inGateZone, nearestInteractable, safePose, type CastMember } from '../explore/cast';
import {
    addPlayTime,
    applyBattleOutcome,
    applyBattleOutcomeOnce,
    battleSetupFor,
    canSaveManually,
    canTalk,
    finishTalk,
    newGame,
    outcomeFromSetup,
    setExplorePose,
    talk,
    withBattleId,
} from './flow';
import { CampaignSaveStore, SAVE_POINT_LABELS, describeSave, saveFailureMessage, type SavePoint } from './save';
import { KOTOSAKA_UNIT_IDS, type Alliance, type CampaignState, type ChoiceId, type ExplorePose, type TalkId } from './state';
import {
    ALLIANCE_DONE_LABELS,
    CHAPTER_TITLE,
    CHARACTER_NAMES,
    CLAN_NAMES,
    PHASE_LABELS,
    PROVISIONAL_LABEL,
    PROVISIONAL_NOTE,
    REASON_LABELS,
    RESULT_LABELS,
    STATUS_LABELS,
    TROOP_UNIT_NAMES,
    endingView,
    objectiveText,
    phaseIntro,
    type EndingView,
    type Script,
} from './story';
import type { Rect } from '../layout';

// ================= 画面と場面の約束 =================

export interface TitleInfo {
    /** 続きから遊べる保存（無ければ null） */
    save: { summary: string } | null;
    /** 保存を読めないときの説明（壊れている・保存領域が使えない） */
    problem: string | null;
    /** 仮シナリオの注記 */
    note: string;
}
export type TitleAction = 'new' | 'continue';

export interface ConfirmOptions {
    title: string;
    lines: string[];
    buttons: { id: string; label: string }[];
    /** 最初に選ばれているボタン（戻れない操作では「やめる」側にする） */
    defaultIndex?: number;
    /** Esc で選ぶボタン */
    cancelId?: string;
}

export interface StatusLine {
    label: string;
    value: string;
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
    id: TalkId;
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
    script(script: Script, opts: ScriptOptions): Promise<ChoiceId | null>;
    confirm(opts: ConfirmOptions): Promise<string>;
    menu(info: MenuInfo): Promise<MenuAction>;
    ending(view: EndingView): Promise<void>;
    hud(info: HudInfo | null): void;
    prompt(p: PromptInfo | null): void;
    intro(title: string, text: string): void;
    toast(text: string, kind: 'ok' | 'error' | 'info'): void;
    /** 開いている画面（会話・確認など）を、答えを返さずにすべて閉じる（会話の途中にメニューから「タイトルへ」を選んだとき） */
    abandon(): void;
}

/** 探索の場面（explore/world.ts） */
export interface GameWorld {
    setCast(cast: CastMember[]): void;
    heroPose(): ExplorePose;
    setHeroPose(p: ExplorePose): void;
    /** 探索の操作（歩く・見回す）を許す／止める。止めるときは押している入力も離す */
    setControl(enabled: boolean): void;
    /** 話す相手と主人公を向き合わせる */
    faceTalk?(id: TalkId): void;
    /** 主人公が歩けない所（壁・家。人物の当たり判定は含めない） */
    walls(): Rect[];
}

/** 合戦を 1 回（hooks.onDecided：勝ち負けが決まった時＝結果の画面の前に呼ぶ。ここで結果を反映して保存する） */
export type BattleRunnerLike = (setup: BattleSetup, hooks?: BattleRunHooks) => Promise<BattleOutcome>;

export interface GameDeps {
    view: GameView;
    world: GameWorld;
    store: CampaignSaveStore;
    /** 合戦の画面（読み込みを待つことがあるので Promise）。読み込めなければ null か例外（「もう一度／タイトルへ」を出す） */
    battleRunner: () => Promise<BattleRunnerLike | null>;
    /** 今の時刻（ミリ秒。合戦にかかった時間を遊んだ時間に足す） */
    now?: () => number;
}

export type GameScreen = 'boot' | 'title' | 'explore' | 'talk' | 'council' | 'menu' | 'battle' | 'ending';

// ================= 本体 =================

export class ChapterGame {
    private _state: CampaignState | null = null;
    private _screen: GameScreen = 'boot';
    private busy = false;
    private cast: CastMember[] = [];
    private prompted: CastMember | null = null;
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
    /** 確認用：最後に起きた誤り */
    lastError: string | null = null;

    constructor(private readonly deps: GameDeps) {
        this.now = deps.now ?? (() => Date.now());
    }

    get state(): CampaignState | null {
        return this._state;
    }
    get screen(): GameScreen {
        return this._screen;
    }
    get castNow(): readonly CastMember[] {
        return this.cast;
    }
    /** 今「話す」ボタンに出ている相手 */
    get promptTarget(): TalkId | null {
        return this.prompted?.id ?? null;
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
        const { view, world, store } = this.deps;
        this._state = null;
        this._screen = 'title';
        this.setPrompt(null);
        view.hud(null);
        world.setControl(false);
        this.cast = [];
        world.setCast([]);
        for (;;) {
            const loaded = store.load();
            const info: TitleInfo = {
                save: loaded.status === 'ok' ? { summary: describeSave(loaded.data) } : null,
                problem: loaded.status === 'corrupt' || loaded.status === 'unavailable' ? loaded.message : null,
                note: PROVISIONAL_NOTE,
            };
            const act = await view.title(info);
            if (act === 'continue') {
                if (loaded.status !== 'ok') continue;
                this.begin(loaded.state);
                return;
            }
            // はじめから：前の保存があれば、上書きのことを知らせて確かめる（前の保存は控えに写して残す）
            if (loaded.status === 'ok' || loaded.status === 'corrupt') {
                const what = loaded.status === 'ok' ? `今の保存（${describeSave(loaded.data)}）` : '読み込めない保存データ';
                const c = await view.confirm({
                    title: 'はじめから遊ぶ',
                    lines: [
                        `${what}は、この後で保存したときに上書きされます。`,
                        '念のため、今の保存を控えとして 1 つ残します（前の控えは置き換わります）。2D 版の保存には触れません。',
                    ],
                    buttons: [
                        { id: 'new', label: 'はじめから遊ぶ' },
                        { id: 'back', label: 'やめる' },
                    ],
                    defaultIndex: 1,
                    cancelId: 'back',
                });
                if (c !== 'new') continue;
                if (!store.archivePrevious()) {
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
            this.begin(newGame());
            return;
        }
    }

    /** 状態から遊び始める（はじめから・つづきから・確認用） */
    begin(state: CampaignState): void {
        this._state = state;
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
        const s = this._state!;
        const { view, world } = this.deps;
        this.cast = castFor(s);
        world.setCast(this.cast);
        if (pose !== 'keep') world.setHeroPose(safePose(pose, this.cast, world.walls()));
        const p = world.heroPose();
        // 読み込んだ位置が城門の場所の中なら、出て入り直すまでは確認を出さない
        this.inGate = inGateZone(this.cast, p.x, p.z);
        this._screen = 'explore';
        this.prompted = null;
        view.hud(this.hudInfo());
        const intro = phaseIntro(s);
        view.intro(intro.title, intro.text);
        world.setControl(!this.busy);
    }

    private hudInfo(): HudInfo {
        const s = this._state!;
        return { chapter: CHAPTER_TITLE, phase: PHASE_LABELS[s.phase], objective: objectiveText(s), provisional: PROVISIONAL_LABEL };
    }

    private refreshField(): void {
        const s = this._state!;
        this.cast = castFor(s);
        this.deps.world.setCast(this.cast);
        this.deps.view.hud(this.hudInfo());
    }

    // ---------------- 毎フレーム ----------------

    /** 探索の毎フレーム（main.ts から）。近くの相手の「話す」ボタン、城門の出陣の確認、遊んだ時間 */
    tick(dt: number): void {
        if (!this._state || this._screen !== 'explore') return;
        if (Number.isFinite(dt) && dt > 0) this.playAcc += Math.min(dt, 1);
        if (this.busy) return;
        const p = this.deps.world.heroPose();
        const gate = inGateZone(this.cast, p.x, p.z);
        if (gate && !this.inGate) {
            this.inGate = true;
            void this.interact('gate');
            return;
        }
        if (!gate) this.inGate = false;
        this.setPrompt(nearestInteractable(this.cast, p.x, p.z));
    }

    private setPrompt(c: CastMember | null): void {
        if (c === this.prompted) return;
        this.prompted = c;
        this.deps.view.prompt(c ? { id: c.id, verb: c.verb, label: c.label } : null);
    }

    // ---------------- 話す ----------------

    /**
     * 話しかける（「話す」ボタン・E／Enter／Space）。id を省けば、今ボタンに出ている相手。
     * 確認用（__game.talk）では距離を問わず、今の段階で居る相手と話せる。
     */
    async interact(id?: TalkId): Promise<void> {
        if (this.busy || this._screen !== 'explore' || !this._state) return;
        const target = id ?? this.prompted?.id;
        if (!target || !canTalk(this._state, target)) return;
        const after = { ending: false };
        await this.exclusive(async () => {
            this._screen = 'talk';
            this.deps.world.faceTalk?.(target);
            const script = talk(this._state!, target);
            const choice = await this.deps.view.script(script, { mode: 'talk' });
            if (target === 'gate' && choice === 'depart') {
                await this.depart();
                return;
            }
            this._state = finishTalk(this._state!, target, choice ?? undefined);
            const phase = this._state.phase;
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

    /** 軍議：協力陣営を選び、確かめて決める（考え直すと選び直し）。決めたら出陣の支度（muster）へ */
    private async runCouncil(): Promise<void> {
        const { view } = this.deps;
        this._screen = 'council';
        this.setPrompt(null);
        view.hud(this.hudInfo());
        const intro = phaseIntro(this._state!);
        view.intro(intro.title, intro.text);
        while (this._state!.phase === 'council') {
            const script = talk(this._state!, 'council');
            const choice = await view.script(script, { mode: 'council' });
            if (!choice) throw new Error('軍議で選択肢が選ばれませんでした');
            this._state = finishTalk(this._state!, 'council', choice);
        }
        // 軍議の後は、そのままの位置で支度の段階へ
        this.enterField('keep');
    }

    // ---------------- 出陣・合戦 ----------------

    /** 城門で「出陣する」を選んだ：出陣前の自動保存 → 合戦 → 結果の反映 → 戦後の自動保存 → 戦後の探索 */
    private async depart(): Promise<void> {
        const { view, store } = this.deps;
        const before = this._state!;
        let next = finishTalk(before, 'gate', 'depart');
        // この出陣だけの合戦の id（結果の反映を 1 回だけにする鍵。保存にも入る）
        next = withBattleId(next, `ch1-${Math.floor(this.now()).toString(36)}-${++this.battleSeq}`);
        next = this.foldPlay(next);
        // 出陣前の保存は、開始の位置から（読み込むと出陣の確認の前から再開する）
        next = setExplorePose(next, null);
        const r = store.save(next, 'departure');
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
                this._state = before;
                this._screen = 'explore';
                return;
            }
        }
        this._state = next;
        await this.runBattle();
    }

    private async runBattle(): Promise<void> {
        const { view, world } = this.deps;
        this._screen = 'battle';
        this.setPrompt(null);
        view.hud(null);
        world.setControl(false);
        const setup = battleSetupFor(this._state!);
        const battleId = this._state!.battleId!;
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
            if (this._state!.appliedBattleId === battleId && saved) return saved;
            addBattleTime();
            const r = applyBattleOutcomeOnce(this._state!, battleId, o);
            this._state = r.state;
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
                if (this._state!.appliedBattleId === battleId && this._state!.battle) {
                    outcome = this._state!.battle;
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

    /** 戦後に源蔵の「この章を締めくくる」を選んだ：結末を保存して、結末の画面へ */
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
        await view.ending(endingView(this._state!));
        await this.title();
    }

    // ---------------- メニュー・保存 ----------------

    /**
     * メニュー（状態・保存・タイトルへ）。探索中と、会話・軍議の途中に開ける。
     * 会話の途中に開いたときは、会話の画面をそのまま下に残す（閉じれば同じ行・同じ選択肢の選び方のまま。会話は進まない）。
     */
    async openMenu(): Promise<void> {
        if (!this._state || this.menuOpen) return;
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
        const s = this._state!;
        const can = canSaveManually(s);
        return {
            status: statusLines(s, this.playAcc),
            canSave: can && this.deps.store.available,
            saveNote: !this.deps.store.available ? saveFailureMessage('unavailable') : can ? null : saveFailureMessage('not_now'),
            message,
        };
    }

    /** 手動保存（今の位置と向きを入れる）。書いた後に読み戻して確かめた結果を返す */
    saveManual(): { ok: boolean; text: string } {
        let s = this._state!;
        if (!canSaveManually(s)) return { ok: false, text: saveFailureMessage('not_now') };
        s = setExplorePose(s, this.deps.world.heroPose());
        s = this.foldPlay(s);
        this._state = s;
        const r = this.deps.store.save(s, 'manual');
        if (!r.ok) return { ok: false, text: `保存できませんでした：${r.message}` };
        this._state = r.state;
        return { ok: true, text: `保存しました（${formatTime(r.savedAt)}・${PHASE_LABELS[s.phase]}）。書き込んだ内容を読み戻して確かめました。` };
    }

    /** 自動保存（書いた後に読み戻して確かめる）。detail は合戦の結果の画面に出す長めの文 */
    private autoSave(point: SavePoint, detail = false): { ok: boolean; text: string } | null {
        const s = this.foldPlay(this._state!);
        this._state = s;
        const r = this.deps.store.save(s, point);
        if (!r.ok) {
            const text = `保存できませんでした（${SAVE_POINT_LABELS[point]}）：${r.message}`;
            if (!detail) return { ok: false, text };
            return { ok: false, text: `${text}このまま続けて遊べます（戦後にメニューから保存し直せます）。今ページを閉じると、前の保存（出陣前）から始まります。` };
        }
        this._state = r.state;
        if (!detail) return { ok: true, text: `保存しました：${SAVE_POINT_LABELS[point]}` };
        return { ok: true, text: `この結果を保存しました（${SAVE_POINT_LABELS[point]}。書き込んだ内容を読み戻して確かめました）。ここで閉じても、この結果の後（戦後）から続けられます。` };
    }

    private foldPlay(s: CampaignState): CampaignState {
        const add = this.playAcc;
        this.playAcc = 0;
        return add > 0 ? addPlayTime(s, add) : s;
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
            if (this._state && (this._screen === 'talk' || this._screen === 'menu')) this._screen = 'explore';
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

function formatTime(iso: string | null): string {
    if (!iso) return 'まだ保存していません';
    const d = new Date(iso);
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** メニューの「状態」（段階・目的・協力陣営・関係・兵・人物・合戦・保存・遊んだ時間） */
export function statusLines(s: CampaignState, extraPlaySec = 0): StatusLine[] {
    const lines: StatusLine[] = [
        { label: '章', value: `${CHAPTER_TITLE}（${PROVISIONAL_LABEL}）` },
        { label: '今', value: PHASE_LABELS[s.phase] },
        { label: '目的', value: objectiveText(s) },
        { label: '協力陣営', value: s.alliance ? ALLIANCE_DONE_LABELS[s.alliance] : 'まだ決めていない' },
        { label: '関係', value: (['tashiro', 'omori', 'washio'] as const).map((c) => `${CLAN_NAMES[c]} ${signed(s.relations[c])}`).join('・') },
        { label: '琴坂の兵', value: KOTOSAKA_UNIT_IDS.map((k) => `${TROOP_UNIT_NAMES[k]} ${s.troops[k]}`).join('・') },
        { label: '人物', value: peopleOf(s.alliance).map((c) => `${CHARACTER_NAMES[c]} ${STATUS_LABELS[s.characters[c]]}`).join('・') },
    ];
    if (s.battle) lines.push({ label: '合戦', value: `${RESULT_LABELS[s.battle.result]}（${REASON_LABELS[s.battle.reason]}）` });
    const sec = Math.floor(s.playTimeSec + extraPlaySec);
    lines.push({ label: '最後の保存', value: formatTime(s.savedAt) });
    lines.push({ label: '遊んだ時間', value: `${Math.floor(sec / 60)} 分` });
    return lines;
}

function peopleOf(a: Alliance | null): ('hero' | 'genzo' | 'shinpachi' | 'tashiro_envoy' | 'omori_envoy')[] {
    const p: ('hero' | 'genzo' | 'shinpachi' | 'tashiro_envoy' | 'omori_envoy')[] = ['hero', 'genzo', 'shinpachi'];
    if (a === 'tashiro') p.push('tashiro_envoy');
    if (a === 'omori') p.push('omori_envoy');
    return p;
}

// ================= 確認用（開発ビルドの __game・テスト） =================

const ALLY_CHOICE: Record<Alliance, ChoiceId> = { tashiro: 'ally_tashiro', omori: 'ally_omori', alone: 'ally_alone' };

/**
 * 確認用：指定の段階の状態を、普通の遊び方と同じ関数の順で作る（テスト・開発の早送り専用。本番の画面の流れでは使わない）。
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
