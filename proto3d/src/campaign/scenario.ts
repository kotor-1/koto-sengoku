/**
 * シナリオの差し替え口（純粋な TypeScript。three も DOM も使わない）。設計：docs/ieyasu1570-design.md §0。
 *
 * 章をつなぐ共通の部分（campaign/game.ts の ChapterGame）は、ここの Scenario を通して 1 つの章を動かす。
 * - fictional：架空の第一章「国境の砦」（campaign/fictional.ts。中身は flow.ts・story.ts・save.ts のまま）。
 * - ieyasu1570：歴史分岐「元亀元年・家康」（campaign/ieyasu1570/）。
 *
 * 共通のまま両シナリオで使うもの（ChapterGame の側）：会話の選択肢の誤決定の防止（画面）、会話中のメニュー、知らせ、
 * 決着の時点の結果保存（BattleRunHooks.onDecided）、battleId／appliedBattleId による 1 回だけの反映、書いた後に読み戻す保存。
 *
 * シナリオごとに違うもの（ここの Scenario）：状態の形・段階ごとの台詞と選択・城下の配役・合戦の設定作り・結果の反映・結末・保存のキー。
 */
import type { BattleOutcome, BattleSetup } from '../battle/types';
import type { CastMember } from '../explore/cast';
import type { SaveFailureReason, SavePoint } from './save';
import type { CampaignPhase, ExplorePose } from './state';
import type { AmbientSpec, CineMoment, CineSpec, ScoutPoint, SituationView } from '../story/types';
import type { ArtId } from '../art/ids';

/** シナリオの id（保存・タイトルの選択に使う） */
export type ScenarioId = 'fictional' | 'ieyasu1570';
export const SCENARIO_IDS: readonly ScenarioId[] = ['fictional', 'ieyasu1570'];

// ---- 会話（架空の章の story.ts の Script と同じ形。id は文字列に広げたもの） ----

export interface ScenarioLine {
    /** 話し手の id（'hero' は主人公、'narration' は地の文。画面は 'hero'・'narration' だけ見た目を変える） */
    speaker: string;
    /** 名前の欄に出す文字（地の文は空） */
    name: string;
    text: string;
}
export interface ScenarioChoice {
    id: string;
    label: string;
    /** 選ぶ前に添える説明（何が変わるか） */
    detail?: string;
    /** 1 行の要点（低い画面で、どの選択肢にも出して見比べられるようにする） */
    summary?: string;
}
export interface ScenarioScript {
    /** 確認用の名前（例：'explore.tadakatsu'） */
    id: string;
    /** 話しかけた相手 */
    talk: string;
    lines: ScenarioLine[];
    /** 最後の行で出す選択肢（選ぶと会話が終わる） */
    choices?: ScenarioChoice[];
    /** 最初に選ばれている選択肢の番号（戻れない選択は「まだ」の側に） */
    defaultChoice?: number;
}

/** 結末の画面 */
export interface ScenarioEndingView {
    id: string;
    title: string;
    body: string[];
    record: { label: string; value: string }[];
    footer: string;
}

/** メニューの「状態」の 1 行 */
export interface StatusLine {
    label: string;
    value: string;
}

// ---- 保存 ----

export type ScenarioSaveResult<S> =
    | { ok: true; savedAt: string; point: SavePoint; state: S }
    | { ok: false; reason: SaveFailureReason; message: string };
export type ScenarioLoadResult<S> =
    | { status: 'ok'; state: S; /** タイトルの「つづきから」に添える説明 */ summary: string }
    | { status: 'none' }
    | { status: 'unavailable'; message: string }
    | { status: 'corrupt'; message: string };

/** シナリオの保存先（キーはシナリオごとに別。書いた後に読み戻して確かめる） */
export interface ScenarioStore<S> {
    readonly available: boolean;
    save(state: S, point: SavePoint, now?: Date): ScenarioSaveResult<S>;
    load(): ScenarioLoadResult<S>;
    /** 「はじめから」の前に今の保存を控えへ写す（写す物が無ければ true） */
    archivePrevious(): boolean;
    /**
     * 章の結末から次の章へ移るときの保存（省ける。歴史分岐の第二章だけ）。前の章の状態を控えに残してから、次の章のはじめを書く。
     * 失敗したら本来の保存を元の中身へ戻す（前の章の保存は消えない）。省けば ChapterGame は save(next, 'chapter') を使う。
     */
    saveChapterStart?(prev: S, next: S, now?: Date): ScenarioSaveResult<S>;
}

// ---- 状態とシナリオ ----

/** どのシナリオの状態にもある部分（ChapterGame が読む） */
export interface ScenarioStateCore {
    phase: CampaignPhase;
    battle: BattleOutcome | null;
    battleId: string | null;
    appliedBattleId: string | null;
    ending: string | null;
    explore: ExplorePose | null;
    playTimeSec: number;
    savedAt: string | null;
}

export interface Scenario<S extends ScenarioStateCore = ScenarioStateCore> {
    readonly id: ScenarioId;
    /** 画面の隅・メニューに出す章の名前 */
    readonly chapterTitle: string;
    /** 常に出す短い札（例：「仮シナリオ」「歴史分岐・創作を含む」） */
    readonly label: string;
    /** タイトルに出す注記（史実と創作の区別） */
    readonly note: string;
    readonly store: ScenarioStore<S>;
    /** 出陣ごとの合戦の id の頭（英数字と - だけ） */
    readonly battleIdPrefix: string;

    newGame(): S;
    /** 城下に置く人物・高札・城門（探索できない段階では空） */
    cast(s: S): CastMember<string>[];
    canTalk(s: S, id: string): boolean;
    talk(s: S, id: string): ScenarioScript;
    /** 会話を読み終えた（選んだ選択肢があれば反映）。出陣の選択（isDeparture）はここへ渡さない */
    finishTalk(s: S, id: string, choice?: string): S;
    /** この会話・選択肢が「出陣する」か（ChapterGame が出陣前の自動保存 → 合戦へ進める） */
    isDeparture(id: string, choice: string | null): boolean;
    /** 出陣する（muster → battle）。choice は isDeparture が true を返した選択肢 */
    depart(s: S, id: string, choice: string): S;
    withBattleId(s: S, id: string): S;
    battleSetup(s: S): BattleSetup;
    /** 合戦の結果を、その合戦の id に対して 1 回だけ反映する（済んでいれば applied: false で状態はそのまま） */
    applyOutcomeOnce(s: S, battleId: string, o: BattleOutcome): { state: S; applied: boolean };
    setExplorePose(s: S, pose: ExplorePose | null): S;
    /**
     * 保存に探索の位置が無いとき（はじめから・章の始め・戦後に城下へ入るとき）に操作を始める位置（省ける。省くか null なら今までの開始の位置）。
     * 状態を読むだけ（位置を状態や保存に書かない：位置の無い保存の文字列は変わらない）。手動の保存に位置があれば、その位置が先。
     */
    startPose?(s: S): ExplorePose | null;
    /**
     * 会話・軍議で、話し手（台詞の speaker）に出す人物画の素材の ID（Version 22。art/ids.ts）。省くか null なら人物画を出さない。
     * 架空の章は省く（話し手の id 'hero' が別の人物のため）。素材が無い・旧表示（?art=old）のときは画面が出さない。
     */
    portraitOf?(s: S, speaker: string): ArtId | null;
    /** 軍議の画面の背景（Version 22）。省くと今までの 3D の陣幕の画。front は手前に重ねる幕・柱（無くてよい） */
    readonly councilArt?: { base: ArtId; front?: ArtId };
    addPlayTime(s: S, sec: number): S;
    canSaveManually(s: S): boolean;

    /** 段階の名前（s を渡せば、その状態の章に合わせた名前。架空の章は s を見ない） */
    phaseLabel(phase: CampaignPhase, s?: S): string;
    objective(s: S): string;
    phaseIntro(s: S): { title: string; text: string };
    statusLines(s: S, extraPlaySec: number): StatusLine[];
    endingView(s: S): ScenarioEndingView;

    // ---- 章をつなぐ口（省ける。架空の章は実装しない） ----
    /** 状態ごとの章の名前（省けば chapterTitle） */
    chapterTitleOf?(s: S): string;
    /** 結末の画面の見出しの言葉（章の名前の後ろ。省けば「結末」） */
    endingHeadingOf?(s: S): string;
    /** 結末の画面に出す「次の章へ」のボタン（無ければ null） */
    nextChapter?(s: S): { label: string; sub?: string } | null;
    /** 次の章のはじめの状態を作る（純粋。同じ入力なら同じ結果） */
    startNextChapter?(s: S): S;
    /** 次の章へ移った直後に 1 回出す、前の章の結果確認の画面の中身（無ければ null） */
    chapterStartView?(s: S): ScenarioEndingView | null;

    // ---- 物語の見せ方の口（省ける。架空の章は実装しない。設計：docs/story-rpg-design.md §6。型：story/types.ts） ----
    /**
     * 演出の台本（第一章の導入・第二章への移行・出陣・帰還）。状態を読むだけ（純粋。状態を変えない）。
     * その時に流す物が無ければ null。replay は情勢の画面の「演出を見直す」から（中身は同じでよい）。
     */
    cinematic?(s: S, moment: CineMoment, opts?: { replay?: boolean }): CineSpec | null;
    /**
     * 情勢の画面の中身（状態を読むだけ）。from は開いた所。軍議から開いたときは、いま出ている選択肢（id と文字）を options に渡す
     * （SituationView.options に、その選択肢ごとの強調と説明を入れる。決めない）。出せなければ null。
     */
    situation?(s: S, opts: { from: 'explore' | 'council'; options?: { id: string; label: string }[] }): SituationView | null;
    /** 町の人々（見た目だけ。保存の兵とは別）。無ければ null */
    ambient?(s: S): AmbientSpec | null;
    /** 物見の地点（今の段階で物見ができる所。できなければ空） */
    scoutPoints?(s: S): ScoutPoint[];
    /** 物見で調べた印を記録した状態（純粋。同じ記録をもう一度入れても増えない。兵・信頼・目標は変えない） */
    scout?(s: S, pointId: string, marks: string[]): S;
}

/** どのシナリオでも入る箱（ChapterGame が複数のシナリオを並べるとき） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyScenario = Scenario<any>;

/** 表示用：日時（保存の時刻など） */
export function formatSavedTime(iso: string | null): string {
    if (!iso) return 'まだ保存していません';
    const d = new Date(iso);
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));
