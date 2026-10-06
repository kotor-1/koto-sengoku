/**
 * 第一章を探索の画面の上で始める（main.ts が素材を読み終えた後に呼ぶ）。
 * 画面（DomView）・探索の中の人物（ExploreWorld）・保存（CampaignSaveStore）・合戦の画面（battle/entry.ts が登録する）を
 * 章の進行（ChapterGame）につなぐ。
 *
 * 合戦の画面（battle/entry.ts）は、必要になったとき（出陣）に読み込む（別の塊 entry-*.js。本番のビルドにも必ず入る）。
 * 読み込むと battle/entry.ts が app/modes.ts の registerBattleRunner で自分を登録する。
 * 読み込めなかったとき（通信の失敗など）は、章の進行（game.ts）が「もう一度／タイトルへ」を出す。仮の結果の選択は無い。
 */
import { activeModeName, exitMode, getBattleRunner, onModeChange } from '../app/modes';
import { installAudio, unlockOnGesture } from '../audio';
import { VOICE_LINES, VOICE_SPEAKER_NAMES, findVoiceLine } from '../campaign/ieyasu1570/story/voiceLines';
import { ChapterGame, devStateFor, type BattleRunnerLike, type GameWorld } from '../campaign/game';
import { getBrowserStorage } from '../campaign/save';
import { createScenarios } from '../campaign/scenarios';
import { devIeyasuState } from '../campaign/ieyasu1570/flow';
import { devIeyasu2State, type DevIeyasu2Options } from '../campaign/ieyasu1570/chapter2/flow';
import type { Policy } from '../campaign/ieyasu1570/state';
import type { Alliance, CampaignPhase } from '../campaign/state';
import type { BattleResultKind } from '../battle/types';
import { ExploreWorld, type ExploreHost } from '../explore/world';
import { DomView } from './view';
import type { PracticeMode, PracticeRecordStore } from '../campaign/practice';
import { StoryPrefsStore, deviceReducedMotion } from '../story/prefs';
import { sampleCineSpec, sampleSituation } from '../story/sample';
import type { CineMoment } from '../story/types';

export type { ExploreHost };

/** 合戦の画面を読み込み、登録された実行の関数を返す（登録されなければ null） */
async function loadBattleRunner(): Promise<BattleRunnerLike | null> {
    // 読み込むだけで registerBattleRunner に登録される（2 回目からは読み込み済み）
    if (!getBattleRunner()) await import('../battle/entry');
    const runner = getBattleRunner();
    if (!runner) return null;
    return async (setup, hooks) => {
        try {
            return await runner(setup, hooks);
        } finally {
            // 合戦の画面が場面を出ていなければ、探索へ戻す
            if (activeModeName()) exitMode();
        }
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function bootChapter(host: ExploreHost): ChapterGame<any> {
    document.body.classList.add('g-on');
    const view = new DomView(host.overlay);
    const world = new ExploreWorld(host);
    // タイトルに並べるシナリオ（歴史分岐「元亀元年・家康」と架空の第一章「国境の砦」）。保存のキーはシナリオごとに別
    const storage = getBrowserStorage();
    const { scenarios, fictionalStore: store } = createScenarios(storage);
    // 演出の「動きを減らす」：'koto-sengoku/3d-prefs' に、利用者が切り替えたときだけ書く（無ければ端末の設定）
    const prefs = new StoryPrefsStore(storage, deviceReducedMotion);
    view.prefs = prefs;
    // 音（BGM・環境音・効果音・声）：設定は 'koto-sengoku/3d-audio'（変えたときだけ書く）。最初の利用者の操作で有効にする。
    // 作れなくても・有効にできなくても、進行は止めない（docs/audio.md）
    const sound = installAudio({
        storage,
        voices: {
            byId: (id) => VOICE_LINES.find((v) => v.id === id),
            find: (speaker, text) => findVoiceLine(speaker, text),
            nameOf: (speaker) => (VOICE_SPEAKER_NAMES as Record<string, string>)[speaker] ?? '',
        },
    });
    // 合戦場の演習（タイトルの入口）：画面の塊は選んだときに読み込む。記録は 'koto-sengoku/3d-fields' だけに書く
    let practice: { mode: PracticeMode; store: PracticeRecordStore } | null = null;
    const runPractice = async (): Promise<void> => {
        // 演習の間は、画面の切り替え・読み込みの待ちの間も探索を覆ったまま（描画を止める）
        view.holdCover(true);
        try {
            for (;;) {
                view.loading('演習を読み込んでいます…');
                try {
                    const m = await import('./practiceView');
                    practice = m.createPractice(view, storage, loadBattleRunner);
                    break;
                } catch (e) {
                    view.loading(null);
                    const c = await view.confirm({
                        title: '演習を読み込めませんでした',
                        lines: [e instanceof Error ? e.message : String(e)],
                        buttons: [
                            { id: 'retry', label: 'もう一度' },
                            { id: 'back', label: 'タイトルへ戻る' },
                        ],
                        defaultIndex: 0,
                        cancelId: 'back',
                    });
                    if (c !== 'retry') return;
                } finally {
                    view.loading(null);
                }
            }
            await practice.mode.run();
        } finally {
            view.loading(null);
            view.holdCover(false);
        }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const game = new ChapterGame<any>({ view, world, store, scenarios, battleRunner: loadBattleRunner, practice: runPractice, reducedMotion: () => prefs.reduced });
    view.onTalk = () => void game.interact();
    view.onMenu = () => void game.openMenu();
    view.onSituation = () => void game.openSituation();
    // タイトル・軍議・メニュー・結末などが探索を覆っている間は、探索の描画を止める（見えない所の描画で電池と処理を使わない）
    view.onCover = (covered) => host.setRenderPaused(covered);
    host.onFrame((dt) => {
        world.frame(dt);
        game.tick(dt);
    });
    void world.preload();
    void game.start();
    if (sound) {
        unlockOnGesture(sound);
        // 画面から曲を決める（章の進行の画面・合戦の画面）。描画のコマではなく時計で見る（覆っている間も曲は替わる）
        const watch = () => sound.setScreen(game.screen, activeModeName() === 'battle');
        onModeChange(watch);
        window.setInterval(watch, 200);
        watch();
        if (import.meta.env.DEV) void import('../audio/dev').then((m) => m.exposeAudioDev(sound));
    }

    if (import.meta.env.DEV) {
        // 開発時のみ：自動確認から章の状態を読み、操作を進められるようにする（本番の画面には出さない）
        Object.assign(window, {
            __game: {
                game,
                view,
                world,
                store,
                get state() {
                    return game.state;
                },
                /** 遊んでいるシナリオ（'fictional'／'ieyasu1570'。タイトルでは null） */
                get scenario() {
                    return game.scenarioId;
                },
                get screen() {
                    return game.screen;
                },
                /** 今「話す」ボタンに出ている相手 */
                get prompt() {
                    return game.promptTarget;
                },
                /** 一番上の画面（会話の行・選択肢・ボタン） */
                get ui() {
                    return view.probe();
                },
                get cast() {
                    return world.probe();
                },
                get lastError() {
                    return game.lastError;
                },
                /** 話しかける（距離は問わない。今の段階で居る相手だけ） */
                talk(id: string) {
                    void game.interact(id);
                    return true;
                },
                /** 会話を 1 行進める */
                advance() {
                    return view.devAdvance();
                },
                /** 選択肢・ボタンを選ぶ（id） */
                choose(id: string) {
                    return view.devPress(id);
                },
                /** 確認用：指定の段階から始める（テスト専用。普通の遊び方と同じ関数の順で状態を作る） */
                setPhase(phase: Exclude<CampaignPhase, 'council' | 'battle'>, alliance?: Alliance, result?: BattleResultKind) {
                    view.devReset();
                    game.devAbandon();
                    game.begin(devStateFor(phase, alliance, result), 'fictional');
                    return game.state?.phase;
                },
                /**
                 * 確認用：歴史分岐「元亀元年・家康」を指定の段階から始める（テスト専用。普通の遊び方と同じ関数の順で状態を作る。
                 * aftermath・ending の合戦の結果は、合戦を遊ばずに作った仮の結果。本番の画面には出さない）
                 */
                setIeyasuPhase(
                    phase: 'explore' | 'muster' | 'aftermath' | 'ending',
                    policy?: Policy,
                    result?: BattleResultKind,
                    opts?: { pledge?: 'accept' | 'decline'; pledgeResult?: 'kept' | 'broken'; answerPledge?: boolean },
                ) {
                    view.devReset();
                    game.devAbandon();
                    game.begin(devIeyasuState(phase, policy, result, opts), 'ieyasu1570');
                    return game.state?.phase;
                },
                /**
                 * 確認用：歴史分岐の第二章を指定の段階から始める（テスト専用・直接状態変更。普通の遊び方と同じ関数の順で状態を作る：
                 * 第一章の結末（opts の ch1Result・ch1Pledge・heavy。合戦は遊ばずに作った仮の結果）→ 第二章へ → 軍議の判断（plan）→ 補充（recovery）
                 * → 出陣 → 仮の結果（result）→ 戦後 → 区切り。本番の画面には出さない）
                 */
                setIeyasu2Phase(phase: 'explore' | 'muster' | 'aftermath' | 'ending', policy?: Policy, opts?: DevIeyasu2Options) {
                    view.devReset();
                    game.devAbandon();
                    game.begin(devIeyasu2State(phase, policy, opts), 'ieyasu1570');
                    return game.state?.phase;
                },
                teleport(x: number, z: number, heading = Math.PI) {
                    world.setHeroPose({ x, z, heading });
                },
                openMenu() {
                    void game.openMenu();
                },
                /** 再生中の演出（{ kind:'cine', id, beat, count, t, paused, caption, buttons, state, info, mode, reduced }。無ければ null） */
                get cine() {
                    return view.cineProbe();
                },
                /** 再生した演出の台本の id（古い順。この遊びの間だけ。保存には入らない） */
                get cineLog() {
                    return [...game.cineLog];
                },
                /** 情勢の画面を開く（探索中・軍議の途中。HUD の「情勢」・J と同じ守り） */
                situation() {
                    void game.openSituation();
                    return true;
                },
                /** 物見の記録（状態の scout。無ければ null）・地点 */
                get scout() {
                    const s = game.state as { scout?: unknown } | null;
                    return s?.scout ?? null;
                },
                /** 町の人々（今の状態からシナリオが決める物。見た目だけ） */
                get ambient() {
                    const sc = game.scenarios.find((x) => x.id === game.scenarioId);
                    return sc?.ambient && game.state ? sc.ambient(game.state) : null;
                },
                /** 動きを減らす設定（今の値） */
                get reducedMotion() {
                    return prefs.reduced;
                },
                /**
                 * 確認用：仮の台本（story/sample.ts）を再生する（物語の中身と切り離して再生器を確かめる。状態には触れない）。
                 * 返りは終わり方の Promise（'done'／'skipped'）。3D の場面は world.stage へ渡す
                 */
                sampleCine(moment: CineMoment = 'ch1_intro') {
                    const gw: GameWorld = world;
                    return view.cinematic(sampleCineSpec(moment), { reduced: prefs.reduced, onStage: (ev, t, r) => gw.stage?.(ev, t, r) });
                },
                /** 確認用：仮の情勢を開く（withOptions で軍議のタブつき）。返りは閉じ方の Promise */
                sampleSituation(withOptions = false) {
                    return view.situation(sampleSituation(withOptions));
                },
                loadBattleRunner,
            },
            // 合戦場の演習：今の画面（'closed'／'list'／'briefing'／'battle'／'result'）・選んでいる戦場・記録（読むだけ）
            __practice: {
                get screen() {
                    return practice?.mode.screen ?? 'closed';
                },
                get fieldId() {
                    return practice?.mode.fieldId ?? null;
                },
                /** 記録（保存を読み直した物。{ status, data? }） */
                get records() {
                    return practice?.store.load() ?? null;
                },
                get lastOutcome() {
                    return practice?.mode.lastOutcome ?? null;
                },
                get lastSave() {
                    return practice?.mode.lastSave ?? null;
                },
                /** 一番上の画面（__game.ui と同じ。kind 'sheet' なら sheet に practice-list などが入る） */
                get ui() {
                    return view.probe();
                },
            },
        });
    }
    return game;
}
