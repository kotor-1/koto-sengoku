/**
 * 歴史分岐シナリオ「元亀元年・家康」の状態（純粋な TypeScript。three も DOM も使わない）。
 * 設計：docs/ieyasu1570-design.md（§2 人物・§3 方針・§5 約束・§6 結末・§7 保存）。依頼本文：docs/historical-scenario-request.md。
 *
 * ＊＊ 1570年の情勢を背景にした歴史分岐シナリオ（創作を含む） ＊＊
 * 資料で確かめた開始の情勢は docs/ieyasu1570-history.md。会話・方針 B／C の出来事・戦場・兵数・能力・約束・戦後は、ゲーム用の創作。
 *
 * 架空の第一章（campaign/state.ts の CampaignState）とは別の形で持つ（架空のセーブの田代家・大森家を書き換えない）。
 * 状態は値として扱う（flow.ts の関数は受け取った状態を書き換えず、新しい状態を返す）。
 */
import type { BattleOutcome, ClanId, ObjectiveDef, ObjectiveResult, ObjectiveType } from '../../battle/types';
import { IEYASU_INITIAL_TROOPS, IEYASU_PLEDGE_TARGET, type IeyasuPolicy, type IeyasuTroopKey } from '../../battle/maps';
import { CAMPAIGN_PHASES, parseBattleOutcome, type CampaignPhase, type ExplorePose } from '../state';

export { CAMPAIGN_PHASES, type CampaignPhase, type ExplorePose };

export const IEYASU_SCENARIO_ID = 'ieyasu1570' as const;

/**
 * 軍議で選ぶ方針（依頼本文 §3）
 * - oda：A. 織田との協力を続ける
 * - asai：B. 浅井との協力を選ぶ（史実から分かれた道。家康が史実で浅井側にいたとは表示しない）
 * - home：C. 自領の防衛を優先する（両家へ宣戦する選択ではない）
 * 合戦の設定（battle/maps.ts の ieyasu1570Setup）と同じ値。
 */
export type Policy = IeyasuPolicy;
export const POLICIES: readonly Policy[] = ['oda', 'asai', 'home'];

/**
 * 信頼を持つ相手（織田家・浅井家・本多忠勝・酒井忠次・石川数正・榊原康政）。
 * 家臣の鍵は battle/generals.ts の武将の relationKey と同じ。榊原康政はこの章に登場しない（値だけ持ち、次の章へ持ち越す）。
 * 保存の版 1 は oda・asai・tadakatsu だけを持つ（読むときに残りを初期値で補う：save.ts）。
 */
export type TrustId = 'oda' | 'asai' | 'tadakatsu' | 'sakai' | 'ishikawa' | 'sakakibara';
export const TRUST_IDS: readonly TrustId[] = ['oda', 'asai', 'tadakatsu', 'sakai', 'ishikawa', 'sakakibara'];
/** 保存の版 1 にあった相手 */
export const TRUST_IDS_V1: readonly TrustId[] = ['oda', 'asai', 'tadakatsu'];
export const TRUST_MIN = -100;
export const TRUST_MAX = 100;
/** 信頼の初期値（ゲーム用の数値。1570 年の時点で織田と協力している、という開始の情勢だけを表す。家臣は忠勝と同じ 40 から） */
export const INITIAL_TRUST: Readonly<Record<TrustId, number>> = { oda: 30, asai: 10, tadakatsu: 40, sakai: 40, ishikawa: 40, sakakibara: 40 };

/** 人物（登場のしかたは設計 §2。信長は書状と使者だけで、戦場には出ない） */
export type IeyasuCharacterId = 'ieyasu' | 'tadakatsu' | 'nobunaga' | 'nagamasa';
export const IEYASU_CHARACTER_IDS: readonly IeyasuCharacterId[] = ['ieyasu', 'tadakatsu', 'nobunaga', 'nagamasa'];
/** 人物の状態（死亡は無い：敗北でも家康は落ち延びる。捕らわれも作らない） */
export type IeyasuCharacterStatus = 'alive' | 'wounded';
export const IEYASU_CHARACTER_STATUSES: readonly IeyasuCharacterStatus[] = ['alive', 'wounded'];

/**
 * 徳川の部隊（兵を章の間で持ち越す単位。battle/maps.ts の IeyasuTroopKey と同じ）。
 * reserve は岡崎の守備隊：C の方針だけ出陣する（それ以外は岡崎に残り、兵はそのまま）。
 */
export type TokugawaUnitId = IeyasuTroopKey;
export const TOKUGAWA_UNIT_IDS: readonly TokugawaUnitId[] = ['honjin', 'tadakatsu', 'yumi', 'reserve'];
/** 兵の初期値（ゲーム用の数値。史実の兵数ではない。battle/maps.ts と同じ）。援兵で戻せる上限もこの値 */
export const INITIAL_TOKUGAWA_TROOPS: Readonly<Record<TokugawaUnitId, number>> = { ...IEYASU_INITIAL_TROOPS };
export const IEYASU_TROOPS_MAX = 5000;

/** 話しかけられる相手 */
export type IeyasuTalkId = 'tadakatsu' | 'oda_envoy' | 'asai_envoy' | 'notice' | 'gate' | 'council';
export const IEYASU_TALK_IDS: readonly IeyasuTalkId[] = ['tadakatsu', 'oda_envoy', 'asai_envoy', 'notice', 'gate', 'council'];
/** 段階ごとに話しかけられる可能性のある相手（済み印の鍵の元。実際に居るかは flow.ts の presentTalks） */
export const IEYASU_TALK_SLOTS: Readonly<Record<CampaignPhase, readonly IeyasuTalkId[]>> = {
    explore: ['tadakatsu', 'oda_envoy', 'asai_envoy', 'notice'],
    council: ['council'],
    muster: ['tadakatsu', 'oda_envoy', 'asai_envoy', 'notice', 'gate'],
    battle: [],
    aftermath: ['tadakatsu', 'oda_envoy', 'asai_envoy', 'notice'],
    ending: [],
};
export type IeyasuTalkFlag = `${CampaignPhase}.${IeyasuTalkId}`;
export function ieyasuTalkFlag(phase: CampaignPhase, id: IeyasuTalkId): IeyasuTalkFlag {
    return `${phase}.${id}`;
}
export const IEYASU_TALK_FLAGS: readonly IeyasuTalkFlag[] = CAMPAIGN_PHASES.flatMap((p) => IEYASU_TALK_SLOTS[p].map((id) => ieyasuTalkFlag(p, id)));

/** 会話の最後の選択肢 */
export type IeyasuChoiceId =
    | 'open_council' // 忠勝（探索）：軍議を開く
    | 'not_yet' // 忠勝：まだ（探索・戦後）
    | 'policy_oda' // 軍議：A
    | 'policy_asai' // 軍議：B
    | 'policy_home' // 軍議：C
    | 'confirm_policy' // 軍議：その方針で決める
    | 'reconsider' // 軍議：考え直す
    | 'pledge_accept' // 約束を引き受ける
    | 'pledge_decline' // 約束を引き受けない
    | 'pledge_later' // 約束の返事を後にする
    | 'depart' // 城門：出陣する
    | 'stay' // 城門：まだ支度をする
    | 'end_chapter'; // 忠勝（戦後）：この章を締めくくる

/** 約束の結果：守った／守れなかった／引き受けなかった（引き受けなかったのは約束違反とは別） */
export type PledgeResult = 'kept' | 'broken' | 'declined';
export const PLEDGE_RESULTS: readonly PledgeResult[] = ['kept', 'broken', 'declined'];
/** 約束の相手（信頼が動く相手）：A は織田家（使者）、B は浅井家（長政の使者）、C は本多忠勝 */
export type PledgePartner = Extract<TrustId, 'oda' | 'asai' | 'tadakatsu'>;
export const PLEDGE_PARTNERS: readonly PledgePartner[] = ['oda', 'asai', 'tadakatsu'];

export interface PledgeState {
    /** 引き受けたか */
    accepted: boolean;
    /** 約束の相手 */
    partner: PledgePartner;
    /** 対象の部隊（合戦の部隊 id。その方針の戦場に実際に出る味方の部隊） */
    targetId: string;
    /** 結果（引き受けて、まだ合戦の前なら null。引き受けなければ 'declined'） */
    result: PledgeResult | null;
}

/** 次の章へ持ち越す印 */
export type CarryFlag =
    | 'policy_oda'
    | 'policy_asai'
    | 'policy_home'
    | 'pledge_kept'
    | 'pledge_broken'
    | 'pledge_declined'
    | 'reinforcement_oda'
    | 'reinforcement_asai'
    | 'reinforcement_tadakatsu';
export const CARRY_FLAGS: readonly CarryFlag[] = [
    'policy_oda',
    'policy_asai',
    'policy_home',
    'pledge_kept',
    'pledge_broken',
    'pledge_declined',
    'reinforcement_oda',
    'reinforcement_asai',
    'reinforcement_tadakatsu',
];

/** 戦後の支援（約束を守ったときの「援兵」。新しい経済の仕組みは作らず、兵の回復だけ） */
export interface SupportState {
    /** 援兵を得た */
    reinforcement: boolean;
    /** 援兵を出した相手（無ければ null） */
    from: PledgePartner | null;
    /** 実際に戻った兵の合計（各部隊の上限で切れた分は入らない） */
    recovered: number;
    /** 次の章へ持ち越す印 */
    carryOver: CarryFlag[];
}

/** 章の結末（設計 §6。3 方針 × 勝利・敗北・撤退 → 6 つ） */
export type IeyasuEndingId = 'oda_victory' | 'asai_victory' | 'home_victory' | 'retreat' | 'defeat_sheltered' | 'defeat_mikawa';
export const IEYASU_ENDING_IDS: readonly IeyasuEndingId[] = ['oda_victory', 'asai_victory', 'home_victory', 'retreat', 'defeat_sheltered', 'defeat_mikawa'];

export interface IeyasuState {
    /** シナリオの id（保存にも入れる） */
    scenario: typeof IEYASU_SCENARIO_ID;
    phase: CampaignPhase;
    /** 決めた方針（軍議で決めるまでは null） */
    policy: Policy | null;
    /** 軍議で選んで、まだ決めていない方針（保存しない） */
    pendingPolicy: Policy | null;
    /** 信頼 -100〜100 */
    trust: Record<TrustId, number>;
    /** 徳川の部隊ごとの兵 */
    troops: Record<TokugawaUnitId, number>;
    characters: Record<IeyasuCharacterId, IeyasuCharacterStatus>;
    talked: Partial<Record<IeyasuTalkFlag, boolean>>;
    /** 戦前の約束（支度の会話で答えるまでは null） */
    pledge: PledgeState | null;
    /** 合戦の結果（戦後から） */
    battle: BattleOutcome | null;
    battleId: string | null;
    appliedBattleId: string | null;
    /** 戦後の支援（戦後から） */
    support: SupportState | null;
    /**
     * 副目標の達成（戦後から。合戦の勝敗 battle.result・約束 pledge.result とは別の欄）。
     * 合戦の前は null。戦後でも、副目標を記録していなかった版（保存の版 1・2）から続けたときは null（記録なし）。
     */
    sideObjectives: ObjectiveResult[] | null;
    ending: IeyasuEndingId | null;
    explore: ExplorePose | null;
    playTimeSec: number;
    savedAt: string | null;
}

export function clampTrust(v: number): number {
    return Math.max(TRUST_MIN, Math.min(TRUST_MAX, Math.round(v)));
}

/** この シナリオの合戦に出る家 */
export const IEYASU_CLANS: readonly ClanId[] = ['tokugawa', 'oda', 'asai', 'asakura', 'ronin'];

/** 合戦の結果の写し（約束と能力の記録も写す） */
export function cloneIeyasuOutcome(o: BattleOutcome): BattleOutcome {
    const c: BattleOutcome = {
        result: o.result,
        reason: o.reason,
        elapsedSec: o.elapsedSec,
        units: o.units.map((u) => {
            const r: BattleOutcome['units'][number] = {
                id: u.id,
                side: u.side,
                clan: u.clan,
                startStrength: u.startStrength,
                endStrength: u.endStrength,
                status: u.status,
            };
            if (u.leaderId !== undefined) r.leaderId = u.leaderId;
            return r;
        }),
    };
    if (o.pledge) c.pledge = { targetId: o.pledge.targetId, result: o.pledge.result };
    if (o.abilitiesUsed) c.abilitiesUsed = { ...o.abilitiesUsed };
    return c;
}

/** 合戦の結果を検査して写す（このシナリオの家・約束・能力の記録を受け付ける） */
export function parseIeyasuOutcome(v: unknown): BattleOutcome | null {
    return parseBattleOutcome(v, { clans: IEYASU_CLANS, extras: true });
}

export function cloneIeyasuState(s: IeyasuState): IeyasuState {
    return {
        scenario: s.scenario,
        phase: s.phase,
        policy: s.policy,
        pendingPolicy: s.pendingPolicy,
        trust: { ...s.trust },
        troops: { ...s.troops },
        characters: { ...s.characters },
        talked: { ...s.talked },
        pledge: s.pledge ? { ...s.pledge } : null,
        battle: s.battle ? cloneIeyasuOutcome(s.battle) : null,
        battleId: s.battleId,
        appliedBattleId: s.appliedBattleId,
        support: s.support ? { ...s.support, carryOver: [...s.support.carryOver] } : null,
        sideObjectives: s.sideObjectives ? s.sideObjectives.map((r) => ({ ...r })) : null,
        ending: s.ending,
        explore: s.explore ? { ...s.explore } : null,
        playTimeSec: s.playTimeSec,
        savedAt: s.savedAt,
    };
}

/** 方針ごとの約束（設計 §5）：相手・話す相手・対象の部隊（その方針の戦場に実際に出る味方）・対象の名前 */
export interface PledgeSpec {
    partner: PledgePartner;
    giver: Extract<IeyasuTalkId, 'oda_envoy' | 'asai_envoy' | 'tadakatsu'>;
    targetId: string;
    targetName: string;
}
export const PLEDGE_SPECS: Readonly<Record<Policy, PledgeSpec>> = {
    oda: { partner: 'oda', giver: 'oda_envoy', targetId: IEYASU_PLEDGE_TARGET.oda, targetName: '織田援軍' },
    asai: { partner: 'asai', giver: 'asai_envoy', targetId: IEYASU_PLEDGE_TARGET.asai, targetName: '浅井長政隊' },
    home: { partner: 'tadakatsu', giver: 'tadakatsu', targetId: IEYASU_PLEDGE_TARGET.home, targetName: '岡崎の守備隊' },
};

/**
 * 方針ごとの副目標（合戦の BattleSetup.objectives.secondary に 1 つ入れる。主目標は入れない＝勝ち負けは今の決まりのまま）。
 * ゲーム用の創作の目安（史実の戦いの目的ではない）。勝敗・約束とは別に判定し、別の欄（IeyasuState.sideObjectives）に残す。
 * - oda：東から回り込む朝倉勢（織田援軍の横を突く）を崩す。
 * - asai：西の林から回り込む織田騎馬（浅井の退き口を脅かす）を崩す。
 * - home：徳川の兵の損害を 3 割以内に抑える（自領の守りに兵を残す）。
 */
export const IEYASU_SIDE_OBJECTIVES: Readonly<Record<Policy, ObjectiveDef>> = {
    oda: { id: 'oda_break_asakura', type: 'break_unit', unitId: 'e_asakura', label: '東から回り込む朝倉勢を崩す' },
    asai: { id: 'asai_break_oda_kiba', type: 'break_unit', unitId: 'e_oda_kiba', label: '西の林から回り込む織田騎馬を崩す' },
    home: { id: 'home_limit_losses', type: 'limit_losses', maxRatio: 0.3, label: '徳川の兵の損害を 3 割以内に抑える' },
};

/** 副目標の記録の 1 行の上限（保存の検査） */
const SIDE_OBJECTIVE_LABEL_MAX = 120;
const OBJECTIVE_TYPES: readonly ObjectiveType[] = ['destroy_hq', 'hold_point', 'defend_time', 'defend_zones', 'rescue', 'breakthrough', 'retreat_success', 'survive_until', 'preserve_unit', 'limit_losses', 'break_unit'];

/**
 * 合戦の結果（BattleOutcome.objectives.secondary）から、その方針の副目標の記録を作る。
 * 結果に副目標が無ければ空の並び（記録なし）。名前・種類は方針のデータから取る（結果の文をそのまま信じない）。
 */
export function sideObjectivesFromOutcome(policy: Policy, o: BattleOutcome): ObjectiveResult[] {
    const def = IEYASU_SIDE_OBJECTIVES[policy];
    const sec: unknown = o.objectives?.secondary;
    const row = Array.isArray(sec) ? (sec as unknown[]).find((r): r is ObjectiveResult => typeof r === 'object' && r !== null && (r as ObjectiveResult).id === def.id) : undefined;
    if (!row || typeof row.achieved !== 'boolean') return [];
    return [{ id: def.id, type: def.type, label: def.label, achieved: row.achieved }];
}

/** 保存の副目標の記録を検査して写す（null はそのまま）。形・その方針の副目標でない行があれば undefined */
export function parseSideObjectives(v: unknown, policy: Policy | null): ObjectiveResult[] | null | undefined {
    if (v === null) return null;
    if (!Array.isArray(v) || !policy || v.length > 4) return undefined;
    const def = IEYASU_SIDE_OBJECTIVES[policy];
    const out: ObjectiveResult[] = [];
    for (const r of v as unknown[]) {
        if (typeof r !== 'object' || r === null || Array.isArray(r)) return undefined;
        const x = r as Record<string, unknown>;
        if (x.id !== def.id || out.some((o) => o.id === x.id)) return undefined;
        if (!OBJECTIVE_TYPES.includes(x.type as ObjectiveType) || x.type !== def.type) return undefined;
        if (typeof x.label !== 'string' || x.label.length === 0 || x.label.length > SIDE_OBJECTIVE_LABEL_MAX) return undefined;
        if (typeof x.achieved !== 'boolean') return undefined;
        out.push({ id: def.id, type: def.type, label: x.label, achieved: x.achieved });
    }
    return out;
}
