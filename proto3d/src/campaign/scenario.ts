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
    addPlayTime(s: S, sec: number): S;
    canSaveManually(s: S): boolean;

    phaseLabel(phase: CampaignPhase): string;
    objective(s: S): string;
    phaseIntro(s: S): { title: string; text: string };
    statusLines(s: S, extraPlaySec: number): StatusLine[];
    endingView(s: S): ScenarioEndingView;
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
