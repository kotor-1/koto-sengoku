/**
 * 第一章の進行の状態（純粋な TypeScript。three も DOM も使わない）。
 * 仕様：docs/chapter1-spec.md §1〜3・§5〜6。
 *
 * 状態は「値」として扱う。flow.ts の関数は受け取った状態を書き換えず、新しい状態を返す。
 * 保存データ（save.ts）にもこの形をそのまま入れる（数・文字・真偽値・配列だけ）。
 *
 * 仮シナリオ：人物・家・出来事はすべて架空の仮の設定（story.ts の先頭の注記を参照）。
 */
import type { BattleEndReason, BattleOutcome, BattleResultKind, ClanId, Side, UnitStatus } from '../battle/types';

/**
 * 章の段階。タイトル画面は状態の外（まだゲームが無い）なので、ここには入れない。
 * explore → council → muster → battle → aftermath → ending の一方向にしか進まない（flow.ts）。
 */
export type CampaignPhase = 'explore' | 'council' | 'muster' | 'battle' | 'aftermath' | 'ending';
export const CAMPAIGN_PHASES: readonly CampaignPhase[] = ['explore', 'council', 'muster', 'battle', 'aftermath', 'ending'];

/** 協力陣営の選択 */
export type Alliance = 'tashiro' | 'omori' | 'alone';
export const ALLIANCES: readonly Alliance[] = ['tashiro', 'omori', 'alone'];

/** 関係を持つ家（主家の琴坂は除く） */
export type RelationClan = Exclude<ClanId, 'kotosaka'>;
export const RELATION_CLANS: readonly RelationClan[] = ['tashiro', 'omori', 'washio'];
export const RELATION_MIN = -100;
export const RELATION_MAX = 100;
/** 関係の初期値（仕様 §2） */
export const INITIAL_RELATIONS: Readonly<Record<RelationClan, number>> = { tashiro: 10, omori: 10, washio: -60 };

/** 主要人物 */
export type CharacterId = 'hero' | 'genzo' | 'shinpachi' | 'tashiro_envoy' | 'omori_envoy' | 'washio_gen';
export const CHARACTER_IDS: readonly CharacterId[] = ['hero', 'genzo', 'shinpachi', 'tashiro_envoy', 'omori_envoy', 'washio_gen'];
/** 人物の状態（死亡は無い：敗北でも大将は落ち延びる） */
export type CharacterStatus = 'alive' | 'wounded' | 'captured';
export const CHARACTER_STATUSES: readonly CharacterStatus[] = ['alive', 'wounded', 'captured'];

/** 琴坂家の部隊（兵を章の間で持ち越す単位） */
export type KotosakaUnitId = 'honjin' | 'genzo' | 'shinpachi' | 'reserve';
export const KOTOSAKA_UNIT_IDS: readonly KotosakaUnitId[] = ['honjin', 'genzo', 'shinpachi', 'reserve'];
/** 兵の初期値（battle/maps.ts の標準の布陣と同じ）。予備隊は「独力で戦う」ときだけ出陣する（それ以外は城に残り、兵はそのまま） */
export const INITIAL_TROOPS: Readonly<Record<KotosakaUnitId, number>> = { honjin: 300, genzo: 500, shinpachi: 350, reserve: 300 };
export const TROOPS_MAX = 5000;

/** 話しかけられる相手（人物・高札・城門・軍議の場） */
export type TalkId = 'genzo' | 'shinpachi' | 'tashiro_envoy' | 'omori_envoy' | 'notice' | 'gate' | 'council';
export const TALK_IDS: readonly TalkId[] = ['genzo', 'shinpachi', 'tashiro_envoy', 'omori_envoy', 'notice', 'gate', 'council'];

/** 段階ごとに話しかけられる可能性のある相手（会話の済み印の鍵の元。実際に居るかは flow.ts の presentTalks） */
export const TALK_SLOTS: Readonly<Record<CampaignPhase, readonly TalkId[]>> = {
    explore: ['genzo', 'shinpachi', 'notice'],
    council: ['council'],
    muster: ['genzo', 'shinpachi', 'tashiro_envoy', 'omori_envoy', 'notice', 'gate'],
    battle: [],
    aftermath: ['genzo', 'shinpachi', 'tashiro_envoy', 'omori_envoy', 'notice'],
    ending: [],
};
/** 会話の済み印の鍵（例：'explore.genzo'） */
export type TalkFlag = `${CampaignPhase}.${TalkId}`;
export function talkFlag(phase: CampaignPhase, id: TalkId): TalkFlag {
    return `${phase}.${id}`;
}
/** 保存データに入ってよい済み印の鍵 */
export const TALK_FLAGS: readonly TalkFlag[] = CAMPAIGN_PHASES.flatMap((p) => TALK_SLOTS[p].map((id) => talkFlag(p, id)));

/** 会話の最後の選択肢 */
export type ChoiceId =
    | 'open_council' // 源蔵（探索）：軍議を開く
    | 'not_yet' // 源蔵：まだ（探索・戦後）
    | 'ally_tashiro' // 軍議：田代家と組む
    | 'ally_omori' // 軍議：大森家と組む
    | 'ally_alone' // 軍議：独力で戦う
    | 'confirm_alliance' // 軍議：選んだ陣営で決める
    | 'reconsider' // 軍議：考え直す
    | 'depart' // 城門：出陣する（出陣前の自動保存）
    | 'stay' // 城門：まだ支度をする
    | 'end_chapter'; // 源蔵（戦後）：この章を締めくくる

/** 章の結末（仕様 §5） */
export type EndingId = 'tashiro_victory' | 'omori_victory' | 'alone_victory' | 'retreat' | 'defeat_sheltered' | 'defeat_alone';
export const ENDING_IDS: readonly EndingId[] = ['tashiro_victory', 'omori_victory', 'alone_victory', 'retreat', 'defeat_sheltered', 'defeat_alone'];

/** 探索の位置と向き（proto3d/src/game/motion.ts の HeroState と同じ意味。heading 0 = +z） */
export interface ExplorePose {
    x: number;
    z: number;
    heading: number;
}
/** 保存で受け付ける探索の位置の範囲（街路の歩ける範囲より十分広い。細かい当たり判定は探索の側で直す） */
export const EXPLORE_LIMIT = 200;

export interface CampaignState {
    phase: CampaignPhase;
    /** 決めた協力陣営（軍議で決めるまでは null） */
    alliance: Alliance | null;
    /** 軍議で選んで、まだ決めていない陣営（軍議の確認の間だけ。保存しない） */
    pendingAlliance: Alliance | null;
    /** 関係 -100〜100 */
    relations: Record<RelationClan, number>;
    /** 琴坂家の部隊ごとの兵 */
    troops: Record<KotosakaUnitId, number>;
    characters: Record<CharacterId, CharacterStatus>;
    /** 会話の済み印（'explore.genzo' など。話し終えたものだけ true） */
    talked: Partial<Record<TalkFlag, boolean>>;
    /** 合戦の結果（戦後から） */
    battle: BattleOutcome | null;
    /** 結末（ending の段階だけ） */
    ending: EndingId | null;
    /** 探索の位置と向き（null は、その段階の最初の位置から） */
    explore: ExplorePose | null;
    /** 遊んだ時間（秒） */
    playTimeSec: number;
    /** 最後に保存した日時（ISO 文字列。まだ保存していなければ null） */
    savedAt: string | null;
}

export function clampRelation(v: number): number {
    return Math.max(RELATION_MIN, Math.min(RELATION_MAX, Math.round(v)));
}

export function cloneOutcome(o: BattleOutcome): BattleOutcome {
    return {
        result: o.result,
        reason: o.reason,
        elapsedSec: o.elapsedSec,
        units: o.units.map((u) => {
            const c: BattleOutcome['units'][number] = {
                id: u.id,
                side: u.side,
                clan: u.clan,
                startStrength: u.startStrength,
                endStrength: u.endStrength,
                status: u.status,
            };
            if (u.leaderId !== undefined) c.leaderId = u.leaderId;
            return c;
        }),
    };
}

/** 状態の深い写し（入れ子の物も含めて新しく作る） */
export function cloneState(s: CampaignState): CampaignState {
    return {
        phase: s.phase,
        alliance: s.alliance,
        pendingAlliance: s.pendingAlliance,
        relations: { ...s.relations },
        troops: { ...s.troops },
        characters: { ...s.characters },
        talked: { ...s.talked },
        battle: s.battle ? cloneOutcome(s.battle) : null,
        ending: s.ending,
        explore: s.explore ? { ...s.explore } : null,
        playTimeSec: s.playTimeSec,
        savedAt: s.savedAt,
    };
}

// ---- 合戦の結果の検査（flow.ts の applyBattleOutcome と save.ts の読み込みで共用） ----

const RESULT_KINDS: readonly BattleResultKind[] = ['victory', 'defeat', 'retreat'];
const END_REASONS: readonly BattleEndReason[] = ['enemy_hq_routed', 'enemy_army_broken', 'ally_hq_routed', 'ally_army_broken', 'ordered_retreat', 'nightfall'];
/** 結果の種類ごとに、ありうる終わった理由 */
const REASONS_FOR: Readonly<Record<BattleResultKind, readonly BattleEndReason[]>> = {
    victory: ['enemy_hq_routed', 'enemy_army_broken'],
    defeat: ['ally_hq_routed', 'ally_army_broken'],
    retreat: ['ordered_retreat', 'nightfall'],
};
const SIDES: readonly Side[] = ['ally', 'enemy'];
const CLANS: readonly ClanId[] = ['kotosaka', 'washio', 'tashiro', 'omori'];
const UNIT_STATUSES: readonly UnitStatus[] = ['ready', 'routed', 'withdrawn', 'destroyed'];
/** 合戦の長さの上限（秒）。日没 8 分より十分長く */
export const OUTCOME_MAX_SEC = 3600;
const MAX_UNITS = 32;

/**
 * 合戦の結果を検査して写しを返す。形・値の範囲・結果と理由の組み合わせがおかしければ null。
 * 兵は 0 以上の整数に丸めない（そのまま検査する）：合戦の側は整数で返す約束。
 */
export function parseBattleOutcome(v: unknown): BattleOutcome | null {
    if (!isObject(v)) return null;
    if (!RESULT_KINDS.includes(v.result as BattleResultKind)) return null;
    const result = v.result as BattleResultKind;
    if (!END_REASONS.includes(v.reason as BattleEndReason)) return null;
    const reason = v.reason as BattleEndReason;
    if (!REASONS_FOR[result].includes(reason)) return null;
    if (!isFiniteNumber(v.elapsedSec) || v.elapsedSec < 0 || v.elapsedSec > OUTCOME_MAX_SEC) return null;
    if (!Array.isArray(v.units) || v.units.length === 0 || v.units.length > MAX_UNITS) return null;
    const units: BattleOutcome['units'] = [];
    const ids = new Set<string>();
    for (const u of v.units as unknown[]) {
        if (!isObject(u)) return null;
        if (typeof u.id !== 'string' || u.id.length === 0 || u.id.length > 64 || ids.has(u.id)) return null;
        ids.add(u.id);
        if (!SIDES.includes(u.side as Side)) return null;
        if (!CLANS.includes(u.clan as ClanId)) return null;
        if (u.leaderId !== undefined && (typeof u.leaderId !== 'string' || u.leaderId.length > 64)) return null;
        if (!isStrength(u.startStrength) || !isStrength(u.endStrength)) return null;
        if ((u.endStrength as number) > (u.startStrength as number)) return null;
        if (!UNIT_STATUSES.includes(u.status as UnitStatus)) return null;
        const c: BattleOutcome['units'][number] = {
            id: u.id,
            side: u.side as Side,
            clan: u.clan as ClanId,
            startStrength: u.startStrength as number,
            endStrength: u.endStrength as number,
            status: u.status as UnitStatus,
        };
        if (typeof u.leaderId === 'string') c.leaderId = u.leaderId;
        units.push(c);
    }
    return { result, reason, elapsedSec: v.elapsedSec, units };
}

function isStrength(v: unknown): boolean {
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= TROOPS_MAX;
}

export function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}
