/**
 * 歴史分岐「元亀元年・家康」第二章の状態（純粋な TypeScript。three も DOM も使わない）。設計：docs/chapter2-design.md §3。
 *
 * ＊＊ 第一章の直後の、分岐した世界での出来事（創作）。特定の史実の合戦の再現ではない ＊＊
 *
 * - 第一章の状態（../state.ts の IeyasuState）は変えない。第二章は別の形 Ieyasu2State（chapter: 2）で持ち、同じ保存のキーの続きに書く（版 4）。
 * - 第一章の結果は chapter1（第一章の記録）に写して凍結する（第二章では書き換えない）。
 *   第二章の兵・信頼・人物は、第一章の終わりの値から始まる（援兵は第一章ですでに兵に入っている。第二章では足さない）。
 * - 段階は第一章と同じ CampaignPhase（explore → council → muster → battle → aftermath → ending）。
 * 状態は値として扱う（chapter2/flow.ts の関数は受け取った状態を書き換えず、新しい状態を返す）。
 */
import type { BattleOutcome, ObjectiveResult, ObjectiveType } from '../../../battle/types';
import { CAMPAIGN_PHASES, type CampaignPhase, type ExplorePose } from '../../state';
import {
    IEYASU_SCENARIO_ID,
    cloneIeyasuOutcome,
    type IeyasuCharacterId,
    type IeyasuCharacterStatus,
    type IeyasuEndingId,
    type IeyasuState,
    type PledgeState,
    type Policy,
    type SupportState,
    type TokugawaUnitId,
    type TrustId,
} from '../state';
import type { Ch2Plan, Ch2SupportId, Ch2Terms } from './battle';

/** 第一章の状態か第二章の状態か（歴史分岐のシナリオの状態はどちらか） */
export type IeyasuAnyState = IeyasuState | Ieyasu2State;

/** 第二章の状態か（型の守り） */
export function isChapter2(s: unknown): s is Ieyasu2State {
    return typeof s === 'object' && s !== null && (s as { chapter?: unknown }).chapter === 2;
}

// ================= 城下の人物・会話 =================

/**
 * 第二章で話しかけられる相手。
 * - tadakatsu：本多忠勝（目印：探索・戦後）
 * - ishikawa：石川数正（兵の数・補充の判断。支度では補充を答えるまで目印）
 * - envoy：方針ごとの使い（A 織田家の使者／B 浅井家の使者／C 村の使い）
 * - notice：高札／gate：城門（支度だけ）／council：軍議
 */
export type Ieyasu2TalkId = 'tadakatsu' | 'ishikawa' | 'envoy' | 'notice' | 'gate' | 'council';
export const IEYASU2_TALK_IDS: readonly Ieyasu2TalkId[] = ['tadakatsu', 'ishikawa', 'envoy', 'notice', 'gate', 'council'];
export const IEYASU2_TALK_SLOTS: Readonly<Record<CampaignPhase, readonly Ieyasu2TalkId[]>> = {
    explore: ['tadakatsu', 'ishikawa', 'envoy', 'notice'],
    council: ['council'],
    muster: ['tadakatsu', 'ishikawa', 'envoy', 'notice', 'gate'],
    battle: [],
    aftermath: ['tadakatsu', 'ishikawa', 'envoy', 'notice'],
    ending: [],
};
export type Ieyasu2TalkFlag = `${CampaignPhase}.${Ieyasu2TalkId}`;
export function ieyasu2TalkFlag(phase: CampaignPhase, id: Ieyasu2TalkId): Ieyasu2TalkFlag {
    return `${phase}.${id}`;
}
export const IEYASU2_TALK_FLAGS: readonly Ieyasu2TalkFlag[] = CAMPAIGN_PHASES.flatMap((p) => IEYASU2_TALK_SLOTS[p].map((id) => ieyasu2TalkFlag(p, id)));

/** 会話の最後の選択肢 */
export type Ieyasu2ChoiceId =
    | 'open_council' // 忠勝（探索）：軍議を開く
    | 'not_yet' // 忠勝：まだ（探索・戦後）
    | 'plan_commit' // 軍議：判断 1
    | 'plan_hold' // 軍議：判断 2
    | 'confirm_plan' // 軍議：その判断で決める
    | 'reconsider' // 軍議：考え直す
    | 'recovery_wait' // 石川（支度）：負傷兵の戻りを待つ
    | 'recovery_transfer' // 石川（支度）：守備隊から兵を回す
    | 'recovery_none' // 石川（支度）：今の兵で出る
    | 'recovery_later' // 石川（支度）：少し考える
    | 'depart' // 城門：出陣する
    | 'stay' // 城門：まだ支度をする
    | 'end_chapter'; // 忠勝（戦後）：第二章を締めくくる

// ================= 補充・記録 =================

/** 補充の判断（設計 §5.2） */
export type RecoveryChoice = 'wait' | 'transfer' | 'none';
export const RECOVERY_CHOICES: readonly RecoveryChoice[] = ['wait', 'transfer', 'none'];

export interface RecoveryState {
    choice: RecoveryChoice;
    /** 部隊ごとに増えた兵（守備隊から回したときは、守備隊が負の数）。選んだ時に 1 回だけ兵に足した値 */
    delta: Record<TokugawaUnitId, number>;
}

/** 第一章の記録（第二章のはじめに写す。以後は変えない） */
export interface Chapter1Record {
    policy: Policy;
    battle: BattleOutcome;
    /** 約束（結果まで決まっている。引き受けなければ declined） */
    pledge: PledgeState;
    /** 戦後の支援（援兵はすでに troops に入っている） */
    support: SupportState;
    /** 副目標の記録（古い版の保存から続けたときは null） */
    sideObjectives: ObjectiveResult[] | null;
    ending: IeyasuEndingId;
    /** 第一章の終わりの値（＝第二章のはじめの値） */
    trust: Record<TrustId, number>;
    troops: Record<TokugawaUnitId, number>;
    characters: Record<IeyasuCharacterId, IeyasuCharacterStatus>;
    playTimeSec: number;
}

/** 第二章の区切り（結末）。方針 × 合戦の結果 → 9 つ */
export type Ieyasu2EndingId = `ch2_${Policy}_${'victory' | 'retreat' | 'defeat'}`;
export const IEYASU2_ENDING_IDS: readonly Ieyasu2EndingId[] = (['oda', 'asai', 'home'] as const).flatMap((p) =>
    (['victory', 'retreat', 'defeat'] as const).map((r) => `ch2_${p}_${r}` as Ieyasu2EndingId),
);

/** 戦後の記録（第二章の合戦の結果から 1 回だけ作る） */
export interface Ieyasu2Result {
    plan: Ch2Plan;
    recovery: RecoveryChoice;
    /** 出陣した徳川の部隊 */
    sortie: TokugawaUnitId[];
    /** 出陣した兵（部隊ごとの合戦の始めの兵） */
    sortieTroops: Partial<Record<TokugawaUnitId, number>>;
    /** 失った兵（部隊ごと） */
    lost: Partial<Record<TokugawaUnitId, number>>;
    /** 加わった支援 */
    support: Ch2SupportId[];
    /** 兵が少ないときの調整をした（軍議で決めた任務の条件 terms.thin） */
    thin: boolean;
    /** 主目標（記録が無ければ null） */
    primary: ObjectiveResult | null;
    secondary: ObjectiveResult[];
    /** 退いて終わった合戦の区別（BattleOutcome.withdrawal。無ければ null） */
    withdrawal: 'objective' | 'abandoned' | null;
    /** この合戦で動いた信頼 */
    trustDelta: Record<TrustId, number>;
}

export interface Ieyasu2State {
    scenario: typeof IEYASU_SCENARIO_ID;
    chapter: 2;
    phase: CampaignPhase;
    /** 第一章の記録（凍結） */
    chapter1: Chapter1Record;
    /** 方針（第一章と同じ。第二章で選び直さない） */
    policy: Policy;
    trust: Record<TrustId, number>;
    troops: Record<TokugawaUnitId, number>;
    characters: Record<IeyasuCharacterId, IeyasuCharacterStatus>;
    talked: Partial<Record<Ieyasu2TalkFlag, boolean>>;
    /** 軍議の判断（決めるまで null） */
    plan: Ch2Plan | null;
    /** 軍議で選んで、まだ決めていない判断（保存しない） */
    pendingPlan: Ch2Plan | null;
    /**
     * 確定した任務の条件（軍議で判断を決めた時に、第一章の終わりの兵 chapter1.troops を基準に 1 回だけ求める。決めるまで null）。
     * 兵が少ないときの調整・主目標の値・始めの陣。補充・保存・読み込み直し・出陣・戦後では求め直さない。
     */
    terms: Ch2Terms | null;
    /** 補充の判断（支度で答えるまで null） */
    recovery: RecoveryState | null;
    battle: BattleOutcome | null;
    battleId: string | null;
    appliedBattleId: string | null;
    /** 戦後の記録（戦後から） */
    result: Ieyasu2Result | null;
    ending: Ieyasu2EndingId | null;
    explore: ExplorePose | null;
    playTimeSec: number;
    savedAt: string | null;
    /**
     * 物見の記録（町の物見櫓で調べた印の id の並び。省ける。設計：docs/story-rpg-design.md §5.2）。
     * 合戦の前（探索・支度・出陣前）だけ持つ（第二章の任務の戦場の印。合戦の結果を反映すると消える）。無い・空なら記録なし。
     * 兵・信頼・確定した条件・補充・合戦の計算には使わない。
     */
    scout?: string[];
}

// ================= 写し =================

const OBJECTIVE_COPY = (r: ObjectiveResult): ObjectiveResult => {
    const c: ObjectiveResult = { id: r.id, type: r.type, label: r.label, achieved: r.achieved };
    if (r.steps) c.steps = { ...r.steps };
    if (r.count) c.count = { ...r.count };
    if (r.met !== undefined) c.met = r.met;
    return c;
};
export const cloneObjectiveResult = OBJECTIVE_COPY;

/** 第二章の合戦の結果の写し（目標の結果・退いて終わった区別も写す） */
export function cloneIeyasu2Outcome(o: BattleOutcome): BattleOutcome {
    const c = cloneIeyasuOutcome(o);
    if (o.objectives) c.objectives = { ...(o.objectives.primary ? { primary: OBJECTIVE_COPY(o.objectives.primary) } : {}), secondary: o.objectives.secondary.map(OBJECTIVE_COPY) };
    if (o.withdrawal) c.withdrawal = o.withdrawal;
    return c;
}

export function cloneChapter1Record(r: Chapter1Record): Chapter1Record {
    return {
        policy: r.policy,
        battle: cloneIeyasuOutcome(r.battle),
        pledge: { ...r.pledge },
        support: { ...r.support, carryOver: [...r.support.carryOver] },
        sideObjectives: r.sideObjectives ? r.sideObjectives.map(OBJECTIVE_COPY) : null,
        ending: r.ending,
        trust: { ...r.trust },
        troops: { ...r.troops },
        characters: { ...r.characters },
        playTimeSec: r.playTimeSec,
    };
}

export function cloneIeyasu2Result(r: Ieyasu2Result): Ieyasu2Result {
    return {
        plan: r.plan,
        recovery: r.recovery,
        sortie: [...r.sortie],
        sortieTroops: { ...r.sortieTroops },
        lost: { ...r.lost },
        support: [...r.support],
        thin: r.thin,
        primary: r.primary ? OBJECTIVE_COPY(r.primary) : null,
        secondary: r.secondary.map(OBJECTIVE_COPY),
        withdrawal: r.withdrawal,
        trustDelta: { ...r.trustDelta },
    };
}

export function cloneIeyasu2State(s: Ieyasu2State): Ieyasu2State {
    return {
        scenario: s.scenario,
        chapter: 2,
        phase: s.phase,
        chapter1: cloneChapter1Record(s.chapter1),
        policy: s.policy,
        trust: { ...s.trust },
        troops: { ...s.troops },
        characters: { ...s.characters },
        talked: { ...s.talked },
        plan: s.plan,
        pendingPlan: s.pendingPlan,
        terms: s.terms ? { ...s.terms } : null,
        recovery: s.recovery ? { choice: s.recovery.choice, delta: { ...s.recovery.delta } } : null,
        battle: s.battle ? cloneIeyasu2Outcome(s.battle) : null,
        battleId: s.battleId,
        appliedBattleId: s.appliedBattleId,
        result: s.result ? cloneIeyasu2Result(s.result) : null,
        ending: s.ending,
        explore: s.explore ? { ...s.explore } : null,
        playTimeSec: s.playTimeSec,
        savedAt: s.savedAt,
        // 物見の記録は、あるときだけ写す（無い状態に空の欄を足さない）
        ...(s.scout && s.scout.length ? { scout: [...s.scout] } : {}),
    };
}

/** 目標の種類（保存の検査。battle/types.ts の ObjectiveDef の type と同じ並び。満たしていなければ型で気づく） */
const OBJECTIVE_TYPE_SET: Record<ObjectiveType, true> = {
    destroy_hq: true,
    hold_point: true,
    defend_time: true,
    defend_zones: true,
    rescue: true,
    breakthrough: true,
    retreat_success: true,
    survive_until: true,
    preserve_unit: true,
    limit_losses: true,
    break_unit: true,
    hold_zones: true,
    limit_breakthrough: true,
    open_gate: true,
    sequence: true,
    escape: true,
    rescue_escort: true,
    withdraw: true,
};
export const OBJECTIVE_TYPES_ALL: readonly ObjectiveType[] = Object.keys(OBJECTIVE_TYPE_SET) as ObjectiveType[];
