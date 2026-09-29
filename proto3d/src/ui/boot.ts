/**
 * 第一章を探索の画面の上で始める（main.ts が素材を読み終えた後に呼ぶ）。
 * 画面（DomView）・探索の中の人物（ExploreWorld）・保存（CampaignSaveStore）・合戦の画面（battle/entry.ts が登録する）を
 * 章の進行（ChapterGame）につなぐ。
 *
 * 合戦の画面（battle/entry.ts）は、必要になったとき（出陣）に読み込む（別の塊 entry-*.js。本番のビルドにも必ず入る）。
 * 読み込むと battle/entry.ts が app/modes.ts の registerBattleRunner で自分を登録する。
 * 読み込めなかったとき（通信の失敗など）は、章の進行（game.ts）が「もう一度／タイトルへ」を出す。仮の結果の選択は無い。
 */
import { activeModeName, exitMode, getBattleRunner } from '../app/modes';
import { ChapterGame, devStateFor, type BattleRunnerLike } from '../campaign/game';
import { CampaignSaveStore, getBrowserStorage } from '../campaign/save';
import type { Alliance, CampaignPhase, TalkId } from '../campaign/state';
import type { BattleResultKind } from '../battle/types';
import { ExploreWorld, type ExploreHost } from '../explore/world';
import { DomView } from './view';

export type { ExploreHost };

/** 合戦の画面を読み込み、登録された実行の関数を返す（登録されなければ null） */
async function loadBattleRunner(): Promise<BattleRunnerLike | null> {
    // 読み込むだけで registerBattleRunner に登録される（2 回目からは読み込み済み）
    if (!getBattleRunner()) await import('../battle/entry');
    const runner = getBattleRunner();
    if (!runner) return null;
    return async (setup) => {
        try {
            return await runner(setup);
        } finally {
            // 合戦の画面が場面を出ていなければ、探索へ戻す
            if (activeModeName()) exitMode();
        }
    };
}

export function bootChapter(host: ExploreHost): ChapterGame {
    document.body.classList.add('g-on');
    const view = new DomView(host.overlay);
    const world = new ExploreWorld(host);
    const store = new CampaignSaveStore(getBrowserStorage());
    const game = new ChapterGame({ view, world, store, battleRunner: loadBattleRunner });
    view.onTalk = () => void game.interact();
    view.onMenu = () => void game.openMenu();
    // タイトル・軍議・メニュー・結末などが探索を覆っている間は、探索の描画を止める（見えない所の描画で電池と処理を使わない）
    view.onCover = (covered) => host.setRenderPaused(covered);
    host.onFrame((dt) => {
        world.frame(dt);
        game.tick(dt);
    });
    void world.preload();
    void game.start();

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
                talk(id: TalkId) {
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
                    game.begin(devStateFor(phase, alliance, result));
                    return game.state?.phase;
                },
                teleport(x: number, z: number, heading = Math.PI) {
                    world.setHeroPose({ x, z, heading });
                },
                openMenu() {
                    void game.openMenu();
                },
                loadBattleRunner,
            },
        });
    }
    return game;
}
