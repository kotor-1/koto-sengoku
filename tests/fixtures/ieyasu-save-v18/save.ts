/**
 * 旧版 Version 18（コミット deb7b2d）の歴史分岐の保存の読み書き（proto3d/src/campaign/ieyasu1570/save.ts）の写し（確かめ専用）。
 * `git show deb7b2d:proto3d/src/campaign/ieyasu1570/save.ts` をそのまま写し、import の道だけを今のコードの同じモジュールへ向けた
 * （中身の関数は 1 文字も変えていない。読み込みが使う状態・合戦の検査の関数は deb7b2d から変わっていない）。
 * tests/proto3d-ieyasu-story-save.test.ts が、今の版の保存の関数で書いた物見の記録（scout）付きの保存を、この旧版の読み込みで読めることを確かめる。
 */
// 型は今のコードの型で検査する（旧版のコードが今の型でも通る＝状態に省ける欄を足しただけで、形を変えていないことの確かめにもなる）
/**
 * 歴史分岐シナリオ「元亀元年・家康」の保存と読み込み（端末内の localStorage）。設計：docs/ieyasu1570-design.md §7。
 *
 * - 保存先のキーは 'koto-sengoku/3d-ieyasu1570'（第一章の状態は版 3。第二章の状態は版 4：このファイルの後半）。データにシナリオの id（'ieyasu1570'）を入れる。
 *   版 2：信頼（trust）に家臣の酒井忠次・石川数正・榊原康政を足した（docs/battlefields-design.md §1）。キーは同じ。
 *   版 3：合戦の副目標の達成（sideObjectives）を、勝敗（battle）・約束（pledge）とは別の欄に足した（docs/battlefields-design.md §4）。
 *   版 1・2 も読む（版 1 は足りない信頼を初期値で補う。副目標は「記録なし」＝ null。ほかの値はそのまま）。
 *   書くときは版 3。古い版のデータを勝手に書き換えない（利用者が保存したときだけ、その時の版で書く）。
 * - 架空の第一章のキー 'koto-sengoku/3d-chapter1' と、2D 版のキー 'koto-sengoku/save' には、読みも書きも消しもしない。
 * - 書き込んだ後に読み戻して一致を確かめ、確かめられたときだけ ok: true（失敗は理由つき。成功したように見せない）。
 * - 読み込み時は形・値の範囲・段階との食い違いを検査し、壊れたデータでは始めない（勝手に消しもしない）。
 * - いつ保存するか・読み込んだ後どこから始めるかは、架空の第一章と同じ（出陣前の保存は出陣の確認の前から。
 *   決着の時点で結果を反映して戦後の保存。反映は合戦の id ごとに 1 回だけ：battleId／appliedBattleId）。
 */
import { CAMPAIGN_SAVE_ARCHIVE_KEY, CAMPAIGN_SAVE_KEY, LEGACY_2D_SAVE_KEY, SAVE_POINT_LABELS, saveFailureMessage, writeVerified, type SaveFailureReason, type SavePoint, type StorageLike } from '../../../proto3d/src/campaign/save';
import type { ScenarioLoadResult, ScenarioSaveResult, ScenarioStore } from '../../../proto3d/src/campaign/scenario';
import { EXPLORE_LIMIT, isBattleId, isFiniteNumber, isObject } from '../../../proto3d/src/campaign/state';
import { IEYASU_PLAY_TIME_MAX } from '../../../proto3d/src/campaign/ieyasu1570/flow';
import {
    CARRY_FLAGS,
    IEYASU_CHARACTER_IDS,
    IEYASU_CHARACTER_STATUSES,
    IEYASU_ENDING_IDS,
    IEYASU_SCENARIO_ID,
    IEYASU_TALK_FLAGS,
    IEYASU_TROOPS_MAX,
    INITIAL_TRUST,
    PLEDGE_PARTNERS,
    PLEDGE_RESULTS,
    PLEDGE_SPECS,
    POLICIES,
    TOKUGAWA_UNIT_IDS,
    TRUST_IDS,
    TRUST_IDS_V1,
    TRUST_MAX,
    TRUST_MIN,
    cloneIeyasuOutcome,
    cloneIeyasuState,
    parseIeyasuOutcome,
    parseSideObjectives,
    type CampaignPhase,
    type CarryFlag,
    type ExplorePose,
    type IeyasuCharacterId,
    type IeyasuCharacterStatus,
    type IeyasuEndingId,
    type IeyasuState,
    type IeyasuTalkFlag,
    type PledgePartner,
    type PledgeResult,
    type PledgeState,
    type Policy,
    type SupportState,
    type TokugawaUnitId,
    type TrustId,
} from '../../../proto3d/src/campaign/ieyasu1570/state';
import { IEYASU_PHASE_LABELS, POLICY_DONE_LABELS } from '../../../proto3d/src/campaign/ieyasu1570/story';
import type { BattleOutcome, ObjectiveResult } from '../../../proto3d/src/battle/types';
import { CH2_RULES, ch2TermsProblem, type Ch2Plan, type Ch2SupportId, type Ch2Terms } from '../../../proto3d/src/campaign/ieyasu1570/chapter2/battle';
import { ch2RecoveryOptions } from '../../../proto3d/src/campaign/ieyasu1570/chapter2/rules';
import { parseIeyasu2Outcome, parseObjectiveResultRow } from '../../../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import {
    IEYASU2_ENDING_IDS,
    IEYASU2_TALK_FLAGS,
    RECOVERY_CHOICES,
    cloneIeyasu2State,
    isChapter2,
    type Chapter1Record,
    type IeyasuAnyState,
    type Ieyasu2EndingId,
    type Ieyasu2Result,
    type Ieyasu2State,
    type Ieyasu2TalkFlag,
    type RecoveryChoice,
    type RecoveryState,
} from '../../../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { IEYASU2_PHASE_LABELS } from '../../../proto3d/src/campaign/ieyasu1570/chapter2/story';

export const IEYASU_SAVE_KEY = 'koto-sengoku/3d-ieyasu1570';
export const IEYASU_SAVE_ARCHIVE_KEY = 'koto-sengoku/3d-ieyasu1570/previous';
export const IEYASU_SAVE_VERSION = 3;
/** 読める版（1 は信頼に家臣の 3 人が無い形。1・2 は副目標の欄が無い形） */
export const IEYASU_SAVE_READABLE_VERSIONS: readonly number[] = [1, 2, 3];

type SavedPhase = Exclude<CampaignPhase, 'council'>;

export interface IeyasuSaveData {
    version: typeof IEYASU_SAVE_VERSION;
    scenario: typeof IEYASU_SCENARIO_ID;
    savedAt: string;
    point: SavePoint;
    playTimeSec: number;
    phase: SavedPhase;
    policy: Policy | null;
    trust: Record<TrustId, number>;
    troops: Record<TokugawaUnitId, number>;
    characters: Record<IeyasuCharacterId, IeyasuCharacterStatus>;
    talked: Partial<Record<IeyasuTalkFlag, boolean>>;
    pledge: PledgeState | null;
    battle: BattleOutcome | null;
    battleId: string | null;
    appliedBattleId: string | null;
    support: SupportState | null;
    /** 副目標の達成（版 3 から。合戦の前・版 1・2 から続けた戦後は null） */
    sideObjectives: ObjectiveResult[] | null;
    ending: IeyasuEndingId | null;
    explore: ExplorePose | null;
}

/** その時点の保存として、この状態を保存してよいか */
export function canSaveIeyasuAt(state: IeyasuState, point: SavePoint): boolean {
    switch (point) {
        case 'departure':
            return state.phase === 'battle' && state.battle === null && state.policy !== null && state.pledge !== null;
        case 'aftermath':
            return state.phase === 'aftermath' && state.battle !== null;
        case 'manual':
            return state.phase === 'explore' || state.phase === 'muster' || state.phase === 'aftermath';
        case 'ending':
            return state.phase === 'ending' && state.ending !== null;
        case 'chapter':
            // 章の始めの保存は第二章の状態だけ（第一章の状態は書かない）
            return false;
    }
}

export function toIeyasuSaveData(state: IeyasuState, point: SavePoint, now: Date): IeyasuSaveData | null {
    if (!canSaveIeyasuAt(state, point) || state.phase === 'council') return null;
    const inField = state.phase === 'explore' || state.phase === 'muster';
    return {
        version: IEYASU_SAVE_VERSION,
        scenario: IEYASU_SCENARIO_ID,
        savedAt: now.toISOString(),
        point,
        playTimeSec: Math.floor(Math.max(0, Math.min(IEYASU_PLAY_TIME_MAX, state.playTimeSec))),
        phase: state.phase,
        policy: state.policy,
        trust: { ...state.trust },
        troops: { ...state.troops },
        characters: { ...state.characters },
        talked: pickTalked(state.talked),
        pledge: state.pledge ? { ...state.pledge } : null,
        battle: state.battle ? cloneIeyasuOutcome(state.battle) : null,
        battleId: inField ? null : state.battleId,
        appliedBattleId: inField ? null : state.appliedBattleId,
        support: state.support ? { ...state.support, carryOver: [...state.support.carryOver] } : null,
        sideObjectives: state.sideObjectives ? state.sideObjectives.map((r) => ({ ...r })) : null,
        ending: state.ending,
        explore: state.explore ? { ...state.explore } : null,
    };
}

function pickTalked(t: Partial<Record<IeyasuTalkFlag, boolean>>): Partial<Record<IeyasuTalkFlag, boolean>> {
    const out: Partial<Record<IeyasuTalkFlag, boolean>> = {};
    for (const k of IEYASU_TALK_FLAGS) if (t[k] === true) out[k] = true;
    return out;
}

const SAVED_PHASES: readonly SavedPhase[] = ['explore', 'muster', 'battle', 'aftermath', 'ending'];
const SAVE_POINTS: readonly SavePoint[] = ['departure', 'aftermath', 'manual', 'ending'];

function parsePledge(v: unknown, policy: Policy | null): PledgeState | null | undefined {
    if (v === null) return null;
    if (!isObject(v) || !policy) return undefined;
    const spec = PLEDGE_SPECS[policy];
    if (typeof v.accepted !== 'boolean' || v.partner !== spec.partner || v.targetId !== spec.targetId) return undefined;
    if (v.result !== null && !PLEDGE_RESULTS.includes(v.result as PledgeResult)) return undefined;
    const result = v.result as PledgeResult | null;
    // 引き受けなかった ⇔ declined
    if (!v.accepted ? result !== 'declined' : result === 'declined') return undefined;
    return { accepted: v.accepted, partner: spec.partner, targetId: spec.targetId, result };
}

function parseSupport(v: unknown): SupportState | null | undefined {
    if (v === null) return null;
    if (!isObject(v) || typeof v.reinforcement !== 'boolean') return undefined;
    if (v.from !== null && !PLEDGE_PARTNERS.includes(v.from as PledgePartner)) return undefined;
    if (typeof v.recovered !== 'number' || !Number.isInteger(v.recovered) || v.recovered < 0 || v.recovered > IEYASU_TROOPS_MAX) return undefined;
    if (!Array.isArray(v.carryOver) || v.carryOver.length > CARRY_FLAGS.length) return undefined;
    const carry: CarryFlag[] = [];
    for (const f of v.carryOver as unknown[]) {
        if (!CARRY_FLAGS.includes(f as CarryFlag) || carry.includes(f as CarryFlag)) return undefined;
        carry.push(f as CarryFlag);
    }
    if (v.reinforcement ? v.from === null : v.from !== null || v.recovered !== 0) return undefined;
    return { reinforcement: v.reinforcement, from: v.from as PledgePartner | null, recovered: v.recovered, carryOver: carry };
}

/**
 * 信頼を読む。版 2 は 6 人すべてが要る。版 1 は oda・asai・tadakatsu だけを読み、家臣の 3 人は初期値で補う
 * （版 1 にあった値は変えない。版 1 のデータに余計な鍵があっても、今までどおり見ない）。
 */
function parseTrust(v: unknown, version: number): Record<TrustId, number> | null {
    if (!isObject(v)) return null;
    const trust = { ...INITIAL_TRUST } as Record<TrustId, number>;
    for (const c of version === 1 ? TRUST_IDS_V1 : TRUST_IDS) {
        const r = v[c];
        if (!isFiniteNumber(r) || r < TRUST_MIN || r > TRUST_MAX) return null;
        trust[c] = r;
    }
    return trust;
}

/** JSON 文字列を検査して保存データにする（版 1・2 も版 3 の形にして返す）。形・範囲・段階との食い違いがあれば null */
export function parseIeyasuSaveData(json: string): IeyasuSaveData | null {
    let v: unknown;
    try {
        v = JSON.parse(json);
    } catch {
        return null;
    }
    if (!isObject(v)) return null;
    if (!IEYASU_SAVE_READABLE_VERSIONS.includes(v.version as number) || v.scenario !== IEYASU_SCENARIO_ID) return null;
    const version = v.version as number;
    if (typeof v.savedAt !== 'string' || Number.isNaN(Date.parse(v.savedAt))) return null;
    if (!SAVE_POINTS.includes(v.point as SavePoint)) return null;
    const point = v.point as SavePoint;
    if (!isFiniteNumber(v.playTimeSec) || v.playTimeSec < 0 || v.playTimeSec > IEYASU_PLAY_TIME_MAX) return null;
    if (!SAVED_PHASES.includes(v.phase as SavedPhase)) return null;
    const phase = v.phase as SavedPhase;
    if (v.policy !== null && !POLICIES.includes(v.policy as Policy)) return null;
    const policy = v.policy as Policy | null;

    const trust = parseTrust(v.trust, version);
    if (!trust) return null;
    if (!isObject(v.troops)) return null;
    const troops = {} as Record<TokugawaUnitId, number>;
    for (const k of TOKUGAWA_UNIT_IDS) {
        const n = v.troops[k];
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > IEYASU_TROOPS_MAX) return null;
        troops[k] = n;
    }
    if (!isObject(v.characters)) return null;
    const characters = {} as Record<IeyasuCharacterId, IeyasuCharacterStatus>;
    for (const c of IEYASU_CHARACTER_IDS) {
        if (!IEYASU_CHARACTER_STATUSES.includes(v.characters[c] as IeyasuCharacterStatus)) return null;
        characters[c] = v.characters[c] as IeyasuCharacterStatus;
    }
    if (!isObject(v.talked)) return null;
    const talked: Partial<Record<IeyasuTalkFlag, boolean>> = {};
    for (const [k, val] of Object.entries(v.talked)) {
        if (!(IEYASU_TALK_FLAGS as readonly string[]).includes(k) || typeof val !== 'boolean') return null;
        if (val) talked[k as IeyasuTalkFlag] = true;
    }
    const pledge = parsePledge(v.pledge, policy);
    if (pledge === undefined) return null;
    let battle: BattleOutcome | null = null;
    if (v.battle !== null) {
        battle = parseIeyasuOutcome(v.battle);
        if (!battle) return null;
    }
    const support = parseSupport(v.support);
    if (support === undefined) return null;
    // 副目標（版 3 は欄が要る。版 1・2 には無いので「記録なし」）
    let sideObjectives: ObjectiveResult[] | null = null;
    if (version >= 3) {
        if (!('sideObjectives' in v)) return null;
        const so = parseSideObjectives(v.sideObjectives, policy);
        if (so === undefined) return null;
        sideObjectives = so;
    }
    if (v.ending !== null && !IEYASU_ENDING_IDS.includes(v.ending as IeyasuEndingId)) return null;
    const ending = v.ending as IeyasuEndingId | null;
    let explore: ExplorePose | null = null;
    if (v.explore !== null) {
        const e = v.explore;
        if (!isObject(e) || !isFiniteNumber(e.x) || !isFiniteNumber(e.z) || !isFiniteNumber(e.heading)) return null;
        if (Math.abs(e.x) > EXPLORE_LIMIT || Math.abs(e.z) > EXPLORE_LIMIT || Math.abs(e.heading) > 100) return null;
        explore = { x: e.x, z: e.z, heading: e.heading };
    }
    if (v.battleId !== null && !isBattleId(v.battleId)) return null;
    if (v.appliedBattleId !== null && !isBattleId(v.appliedBattleId)) return null;
    const battleId = v.battleId as string | null;
    const appliedBattleId = v.appliedBattleId as string | null;

    // 段階との食い違い
    const inField = phase === 'explore' || phase === 'muster';
    const beforeBattle = inField || phase === 'battle';
    if (phase === 'explore' ? policy !== null : policy === null) return null;
    if (beforeBattle ? battle !== null || support !== null : battle === null || support === null) return null;
    // 副目標は戦後だけ（戦後でも null＝古い版から続けた記録なし、はありうる）
    if (beforeBattle && sideObjectives !== null) return null;
    if (phase === 'ending' ? ending === null : ending !== null) return null;
    if (phase === 'explore' && pledge !== null) return null;
    if (phase === 'battle' && pledge === null) return null;
    // 合戦の前の約束は結果が未定（引き受けた）か declined。戦後は必ず結果がある
    if (pledge && beforeBattle && pledge.result !== null && pledge.result !== 'declined') return null;
    if (!beforeBattle && (!pledge || pledge.result === null)) return null;
    // 約束と合戦の結果・支援の食い違い
    if (!beforeBattle && pledge && battle && support) {
        if (battle.pledge && (!pledge.accepted || battle.pledge.targetId !== pledge.targetId || battle.pledge.result !== pledge.result)) return null;
        if ((pledge.result === 'kept') !== support.reinforcement) return null;
        if (support.reinforcement && support.from !== pledge.partner) return null;
    }
    if (inField ? battleId !== null || appliedBattleId !== null : battleId === null) return null;
    if (phase === 'battle' && appliedBattleId !== null) return null;
    if ((phase === 'aftermath' || phase === 'ending') && appliedBattleId !== battleId) return null;
    const data: IeyasuSaveData = {
        version: IEYASU_SAVE_VERSION,
        scenario: IEYASU_SCENARIO_ID,
        savedAt: v.savedAt,
        point,
        playTimeSec: v.playTimeSec,
        phase,
        policy,
        trust,
        troops,
        characters,
        talked,
        pledge,
        battle,
        battleId,
        appliedBattleId,
        support,
        sideObjectives,
        ending,
        explore,
    };
    if (!canSaveIeyasuAt(stateOf(data), point)) return null;
    return data;
}

function stateOf(d: IeyasuSaveData): IeyasuState {
    return cloneIeyasuState({
        scenario: IEYASU_SCENARIO_ID,
        phase: d.phase,
        policy: d.policy,
        pendingPolicy: null,
        trust: d.trust,
        troops: d.troops,
        characters: d.characters,
        talked: d.talked,
        pledge: d.pledge,
        battle: d.battle,
        battleId: d.battleId,
        appliedBattleId: d.appliedBattleId,
        support: d.support,
        sideObjectives: d.sideObjectives,
        ending: d.ending,
        explore: d.explore,
        playTimeSec: d.playTimeSec,
        savedAt: d.savedAt,
    });
}

/** 読み込んだ保存から続きを遊ぶ状態を作る（出陣前の保存は、出陣の確認の前＝支度から。合戦の id も外す） */
export function ieyasuStateFromSave(d: IeyasuSaveData): IeyasuState {
    const s = stateOf(d);
    if (s.phase === 'battle') {
        s.phase = 'muster';
        s.battleId = null;
        s.appliedBattleId = null;
    }
    return s;
}

export function describeIeyasuSave(d: IeyasuSaveData): string {
    const at = new Date(d.savedAt);
    const p2 = (n: number) => String(n).padStart(2, '0');
    const when = `${at.getFullYear()}/${p2(at.getMonth() + 1)}/${p2(at.getDate())} ${p2(at.getHours())}:${p2(at.getMinutes())}`;
    const parts = [IEYASU_PHASE_LABELS[d.phase]];
    if (d.policy) parts.push(POLICY_DONE_LABELS[d.policy]);
    parts.push(SAVE_POINT_LABELS[d.point], when, `遊んだ時間 ${Math.floor(d.playTimeSec / 60)} 分`);
    return parts.join('・');
}

const FORBIDDEN_KEYS = [LEGACY_2D_SAVE_KEY, CAMPAIGN_SAVE_KEY, CAMPAIGN_SAVE_ARCHIVE_KEY];

export class IeyasuSaveStore implements ScenarioStore<IeyasuState> {
    constructor(
        private readonly storage: StorageLike | null,
        private readonly key: string = IEYASU_SAVE_KEY,
        private readonly archiveKey: string = IEYASU_SAVE_ARCHIVE_KEY,
    ) {
        if (FORBIDDEN_KEYS.includes(key) || FORBIDDEN_KEYS.includes(archiveKey)) throw new Error('2D 版・架空の第一章の保存のキーは使えません');
    }

    get available(): boolean {
        return this.storage !== null;
    }

    save(state: IeyasuState, point: SavePoint, now: Date = new Date()): ScenarioSaveResult<IeyasuState> {
        if (!this.storage) return fail('unavailable');
        const data = toIeyasuSaveData(state, point, now);
        if (!data) return fail('not_now');
        const w = writeVerified(this.storage, this.key, JSON.stringify(data));
        if (w) return fail(w);
        return { ok: true, savedAt: data.savedAt, point, state: { ...cloneIeyasuState(state), savedAt: data.savedAt } };
    }

    load(): ScenarioLoadResult<IeyasuState> {
        return this.read(this.key);
    }

    /** 保存データそのもの（確認用） */
    loadData(): IeyasuSaveData | null {
        if (!this.storage) return null;
        try {
            const json = this.storage.getItem(this.key);
            return json === null ? null : parseIeyasuSaveData(json);
        } catch {
            return null;
        }
    }

    archivePrevious(): boolean {
        if (!this.storage) return false;
        let json: string | null;
        try {
            json = this.storage.getItem(this.key);
        } catch {
            return false;
        }
        if (json === null) return true;
        return writeVerified(this.storage, this.archiveKey, json) === null;
    }

    loadArchived(): ScenarioLoadResult<IeyasuState> {
        return this.read(this.archiveKey);
    }

    private read(key: string): ScenarioLoadResult<IeyasuState> {
        if (!this.storage) return { status: 'unavailable', message: saveFailureMessage('unavailable') };
        let json: string | null;
        try {
            json = this.storage.getItem(key);
        } catch {
            return { status: 'unavailable', message: saveFailureMessage('unavailable') };
        }
        if (json === null) return { status: 'none' };
        const data = parseIeyasuSaveData(json);
        if (!data) return { status: 'corrupt', message: IEYASU_CORRUPT_MESSAGE };
        return { status: 'ok', state: ieyasuStateFromSave(data), summary: describeIeyasuSave(data) };
    }
}

export const IEYASU_CORRUPT_MESSAGE = '歴史分岐シナリオの保存データが壊れているか、形式が違うため読み込めません（データはそのまま残しています）。';

function fail(reason: SaveFailureReason): ScenarioSaveResult<IeyasuState> {
    return { ok: false, reason, message: saveFailureMessage(reason) };
}

// ================================================================ 第二章（版 4）

/**
 * 第二章の保存（docs/chapter2-design.md §4）。キーは第一章と同じ 'koto-sengoku/3d-ieyasu1570'。
 * - 第一章の状態は今までどおり版 3 で書く（同じ文字列。旧版 Version 17 でも読める）。第二章の状態だけ版 4（chapter: 2）。
 * - 版 4 の検査は版 3 と同じ厳しさ（形・範囲・段階との食い違い・第一章の記録 chapter1 の中身）。食い違えば壊れた保存として扱い、消さない。
 * - 確定した任務の条件（terms）は軍議で判断を決めた時の物をそのまま書き、読む（読み込みで求め直さない）。判断を決めた後は必ずあり、決める前は null。
 * - 第一章から第二章へ移るときは saveChapterStart：第一章の結末を控えのキー 'koto-sengoku/3d-ieyasu1570/chapter1' へ版 3 で書いて確かめてから、
 *   本来のキーへ第二章のはじめを版 4・時点 'chapter' で書いて確かめる。だめなら本来のキーを元の中身へ戻す（第一章の保存は消えない）。
 * - 読み込んだだけでは書き換えない。2D・架空の章・演習のキーには触れない。
 */
export const IEYASU2_SAVE_VERSION = 4;
/** 第一章の控え（第二章へ移るときに、第一章の結末を残す所） */
export const IEYASU_CHAPTER1_KEY = 'koto-sengoku/3d-ieyasu1570/chapter1';

export interface Ieyasu2SaveData {
    version: typeof IEYASU2_SAVE_VERSION;
    scenario: typeof IEYASU_SCENARIO_ID;
    chapter: 2;
    savedAt: string;
    point: SavePoint;
    playTimeSec: number;
    phase: SavedPhase;
    chapter1: Chapter1Record;
    policy: Policy;
    trust: Record<TrustId, number>;
    troops: Record<TokugawaUnitId, number>;
    characters: Record<IeyasuCharacterId, IeyasuCharacterStatus>;
    talked: Partial<Record<Ieyasu2TalkFlag, boolean>>;
    plan: Ch2Plan | null;
    /** 確定した任務の条件（判断を決めた後は必ずある。決める前は null） */
    terms: Ch2Terms | null;
    recovery: RecoveryState | null;
    battle: BattleOutcome | null;
    battleId: string | null;
    appliedBattleId: string | null;
    result: Ieyasu2Result | null;
    ending: Ieyasu2EndingId | null;
    explore: ExplorePose | null;
}

/** その時点の保存として、第二章のこの状態を保存してよいか */
export function canSaveIeyasu2At(state: Ieyasu2State, point: SavePoint): boolean {
    switch (point) {
        case 'chapter':
            return state.phase === 'explore' && state.battle === null && state.plan === null;
        case 'departure':
            return state.phase === 'battle' && state.battle === null && state.plan !== null && state.recovery !== null;
        case 'aftermath':
            return state.phase === 'aftermath' && state.battle !== null && state.result !== null;
        case 'manual':
            return state.phase === 'explore' || state.phase === 'muster' || state.phase === 'aftermath';
        case 'ending':
            return state.phase === 'ending' && state.ending !== null;
    }
}

export function toIeyasu2SaveData(state: Ieyasu2State, point: SavePoint, now: Date): Ieyasu2SaveData | null {
    if (!canSaveIeyasu2At(state, point) || state.phase === 'council') return null;
    const inField = state.phase === 'explore' || state.phase === 'muster';
    const c = cloneIeyasu2State(state);
    const talked: Partial<Record<Ieyasu2TalkFlag, boolean>> = {};
    for (const k of IEYASU2_TALK_FLAGS) if (c.talked[k] === true) talked[k] = true;
    return {
        version: IEYASU2_SAVE_VERSION,
        scenario: IEYASU_SCENARIO_ID,
        chapter: 2,
        savedAt: now.toISOString(),
        point,
        playTimeSec: Math.floor(Math.max(0, Math.min(IEYASU_PLAY_TIME_MAX, c.playTimeSec))),
        phase: c.phase as SavedPhase,
        // 第一章の遊んだ時間も秒に切り捨てて書く（今の遊んだ時間と同じ丸め。端数のままだと読むときの検査に落ちる）
        chapter1: { ...c.chapter1, playTimeSec: Math.floor(Math.max(0, Math.min(IEYASU_PLAY_TIME_MAX, c.chapter1.playTimeSec))) },
        policy: c.policy,
        trust: c.trust,
        troops: c.troops,
        characters: c.characters,
        talked,
        plan: c.plan,
        terms: c.terms,
        recovery: c.recovery,
        battle: c.battle,
        battleId: inField ? null : c.battleId,
        appliedBattleId: inField ? null : c.appliedBattleId,
        result: c.result,
        ending: c.ending,
        explore: c.explore,
    };
}

const SAVE_POINTS_V4: readonly SavePoint[] = ['departure', 'aftermath', 'manual', 'ending', 'chapter'];
const CH2_PLANS_ALL: readonly Ch2Plan[] = ['commit', 'hold'];
const CH2_SUPPORT_IDS: readonly Ch2SupportId[] = ['oda_teppo', 'asai_guide', 'village'];
/** 方針ごとに加わりうる支援（chapter2/battle.ts の ch2Support） */
const CH2_POLICY_SUPPORT: Readonly<Record<Policy, Ch2SupportId>> = { oda: 'oda_teppo', asai: 'asai_guide', home: 'village' };

function parseTroops(v: unknown): Record<TokugawaUnitId, number> | null {
    if (!isObject(v)) return null;
    const out = {} as Record<TokugawaUnitId, number>;
    for (const k of TOKUGAWA_UNIT_IDS) {
        const n = v[k];
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > IEYASU_TROOPS_MAX) return null;
        out[k] = n;
    }
    return out;
}

function parseCharacters(v: unknown): Record<IeyasuCharacterId, IeyasuCharacterStatus> | null {
    if (!isObject(v)) return null;
    const out = {} as Record<IeyasuCharacterId, IeyasuCharacterStatus>;
    for (const c of IEYASU_CHARACTER_IDS) {
        if (!IEYASU_CHARACTER_STATUSES.includes(v[c] as IeyasuCharacterStatus)) return null;
        out[c] = v[c] as IeyasuCharacterStatus;
    }
    return out;
}

/** 第一章の結果と結末の id が合っているか（flow.ts の ieyasuEndingFor の決まり） */
function ch1EndingMatches(policy: Policy, result: BattleOutcome['result'], ending: IeyasuEndingId): boolean {
    if (result === 'victory') return ending === `${policy}_victory`;
    if (result === 'retreat') return ending === 'retreat';
    return ending === 'defeat_sheltered' || ending === 'defeat_mikawa';
}

/** 第一章の記録を検査して写す（版 3 の結末の保存と同じ決まり） */
function parseChapter1Record(v: unknown): Chapter1Record | null {
    if (!isObject(v)) return null;
    if (!POLICIES.includes(v.policy as Policy)) return null;
    const policy = v.policy as Policy;
    const battle = parseIeyasuOutcome(v.battle);
    if (!battle) return null;
    const pledge = parsePledge(v.pledge, policy);
    if (!pledge || pledge.result === null) return null;
    const support = parseSupport(v.support);
    if (!support) return null;
    if (battle.pledge && (!pledge.accepted || battle.pledge.targetId !== pledge.targetId || battle.pledge.result !== pledge.result)) return null;
    if ((pledge.result === 'kept') !== support.reinforcement) return null;
    if (support.reinforcement && support.from !== pledge.partner) return null;
    if (!('sideObjectives' in v)) return null;
    const side = parseSideObjectives(v.sideObjectives, policy);
    if (side === undefined) return null;
    if (!IEYASU_ENDING_IDS.includes(v.ending as IeyasuEndingId)) return null;
    const ending = v.ending as IeyasuEndingId;
    if (!ch1EndingMatches(policy, battle.result, ending)) return null;
    const trust = parseTrust(v.trust, 2);
    const troops = parseTroops(v.troops);
    const characters = parseCharacters(v.characters);
    if (!trust || !troops || !characters) return null;
    if (!isFiniteNumber(v.playTimeSec) || v.playTimeSec < 0 || v.playTimeSec > IEYASU_PLAY_TIME_MAX) return null;
    return { policy, battle, pledge, support, sideObjectives: side, ending, trust, troops, characters, playTimeSec: v.playTimeSec };
}

function parseRecovery(v: unknown): RecoveryState | null | undefined {
    if (v === null) return null;
    if (!isObject(v) || !RECOVERY_CHOICES.includes(v.choice as RecoveryChoice) || !isObject(v.delta)) return undefined;
    const choice = v.choice as RecoveryChoice;
    const delta = {} as Record<TokugawaUnitId, number>;
    for (const k of TOKUGAWA_UNIT_IDS) {
        const n = v.delta[k];
        if (typeof n !== 'number' || !Number.isInteger(n) || Math.abs(n) > IEYASU_TROOPS_MAX) return undefined;
        delta[k] = n;
    }
    const total = TOKUGAWA_UNIT_IDS.reduce((n, k) => n + delta[k], 0);
    if (choice === 'none' && TOKUGAWA_UNIT_IDS.some((k) => delta[k] !== 0)) return undefined;
    if (choice === 'wait' && TOKUGAWA_UNIT_IDS.some((k) => delta[k] < 0)) return undefined;
    if (choice === 'transfer' && (delta.reserve > 0 || (['honjin', 'tadakatsu', 'yumi'] as const).some((k) => delta[k] < 0) || total !== 0)) return undefined;
    return { choice, delta };
}

/**
 * 確定した任務の条件を検査して写す（判断があるときは必ずある・無いときは null）。方針・判断と合い、値は決まりの表のどちらかで thin と合うこと。
 * 読み込みで求め直さない（第一章の終わりの兵から計算し直した値と比べもしない。決めた時の物をそのまま使う）。
 */
function parseTerms(v: unknown, policy: Policy, plan: Ch2Plan | null): Ch2Terms | null | undefined {
    if (v === null) return plan === null ? null : undefined;
    if (plan === null || !isObject(v)) return undefined;
    if (!POLICIES.includes(v.policy as Policy) || !CH2_PLANS_ALL.includes(v.plan as Ch2Plan)) return undefined;
    const n = v.basisTroops;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > IEYASU_TROOPS_MAX * TOKUGAWA_UNIT_IDS.length) return undefined;
    if (typeof v.thin !== 'boolean') return undefined;
    // thin は基準の兵から決まる（ch2DecideTerms と同じ閉じた決まり。基準の兵そのものは求め直さない）
    if (v.thin !== n < CH2_RULES.thinTroops) return undefined;
    if (v.escortMinRatio !== null && !isFiniteNumber(v.escortMinRatio)) return undefined;
    if (v.holdSec !== null && !isFiniteNumber(v.holdSec)) return undefined;
    const t: Ch2Terms = {
        policy: v.policy as Policy,
        plan: v.plan as Ch2Plan,
        basisTroops: n,
        thin: v.thin,
        escortMinRatio: v.escortMinRatio as number | null,
        holdSec: v.holdSec as number | null,
    };
    return ch2TermsProblem(t, policy, plan) ? undefined : t;
}

function parseUnitNumbers(v: unknown, allowed: readonly TokugawaUnitId[]): Partial<Record<TokugawaUnitId, number>> | null {
    if (!isObject(v)) return null;
    const out: Partial<Record<TokugawaUnitId, number>> = {};
    for (const [k, n] of Object.entries(v)) {
        if (!allowed.includes(k as TokugawaUnitId)) return null;
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > IEYASU_TROOPS_MAX) return null;
        out[k as TokugawaUnitId] = n;
    }
    return out;
}

function parseIeyasu2Result(v: unknown): Ieyasu2Result | null | undefined {
    if (v === null) return null;
    if (!isObject(v)) return undefined;
    if (!CH2_PLANS_ALL.includes(v.plan as Ch2Plan) || !RECOVERY_CHOICES.includes(v.recovery as RecoveryChoice)) return undefined;
    if (!Array.isArray(v.sortie) || v.sortie.length === 0 || v.sortie.length > TOKUGAWA_UNIT_IDS.length) return undefined;
    const sortie: TokugawaUnitId[] = [];
    for (const k of v.sortie as unknown[]) {
        if (!TOKUGAWA_UNIT_IDS.includes(k as TokugawaUnitId) || sortie.includes(k as TokugawaUnitId)) return undefined;
        sortie.push(k as TokugawaUnitId);
    }
    if (!sortie.includes('honjin')) return undefined;
    const sortieTroops = parseUnitNumbers(v.sortieTroops, sortie);
    const lost = parseUnitNumbers(v.lost, sortie);
    if (!sortieTroops || !lost) return undefined;
    for (const k of sortie) if ((lost[k] ?? 0) > (sortieTroops[k] ?? 0)) return undefined;
    if (!Array.isArray(v.support) || v.support.length > CH2_SUPPORT_IDS.length) return undefined;
    const support: Ch2SupportId[] = [];
    for (const x of v.support as unknown[]) {
        if (!CH2_SUPPORT_IDS.includes(x as Ch2SupportId) || support.includes(x as Ch2SupportId)) return undefined;
        support.push(x as Ch2SupportId);
    }
    if (typeof v.thin !== 'boolean') return undefined;
    let primary: ObjectiveResult | null = null;
    if (v.primary !== null) {
        primary = parseObjectiveResultRow(v.primary);
        if (!primary) return undefined;
    }
    if (!Array.isArray(v.secondary) || v.secondary.length > 8) return undefined;
    const secondary: ObjectiveResult[] = [];
    for (const r of v.secondary as unknown[]) {
        const x = parseObjectiveResultRow(r);
        if (!x) return undefined;
        secondary.push(x);
    }
    if (v.withdrawal !== null && v.withdrawal !== 'objective' && v.withdrawal !== 'abandoned') return undefined;
    if (!isObject(v.trustDelta)) return undefined;
    const trustDelta = {} as Record<TrustId, number>;
    for (const k of TRUST_IDS) {
        const n = v.trustDelta[k];
        if (typeof n !== 'number' || !Number.isInteger(n) || Math.abs(n) > TRUST_MAX - TRUST_MIN) return undefined;
        trustDelta[k] = n;
    }
    return {
        plan: v.plan as Ch2Plan,
        recovery: v.recovery as RecoveryChoice,
        sortie,
        sortieTroops,
        lost,
        support,
        thin: v.thin,
        primary,
        secondary,
        withdrawal: v.withdrawal as Ieyasu2Result['withdrawal'],
        trustDelta,
    };
}

/** JSON 文字列を検査して第二章の保存データにする（版 4 だけ）。形・範囲・段階との食い違いがあれば null */
export function parseIeyasu2SaveData(json: string): Ieyasu2SaveData | null {
    let v: unknown;
    try {
        v = JSON.parse(json);
    } catch {
        return null;
    }
    if (!isObject(v)) return null;
    if (v.version !== IEYASU2_SAVE_VERSION || v.scenario !== IEYASU_SCENARIO_ID || v.chapter !== 2) return null;
    if (typeof v.savedAt !== 'string' || Number.isNaN(Date.parse(v.savedAt))) return null;
    if (!SAVE_POINTS_V4.includes(v.point as SavePoint)) return null;
    const point = v.point as SavePoint;
    if (!isFiniteNumber(v.playTimeSec) || v.playTimeSec < 0 || v.playTimeSec > IEYASU_PLAY_TIME_MAX) return null;
    if (!SAVED_PHASES.includes(v.phase as SavedPhase)) return null;
    const phase = v.phase as SavedPhase;
    const chapter1 = parseChapter1Record(v.chapter1);
    if (!chapter1) return null;
    // 遊んだ時間は第一章から引き継いで増えるだけ
    if (chapter1.playTimeSec > v.playTimeSec) return null;
    if (v.policy !== chapter1.policy) return null;
    const policy = chapter1.policy;
    const trust = parseTrust(v.trust, 2);
    const troops = parseTroops(v.troops);
    const characters = parseCharacters(v.characters);
    if (!trust || !troops || !characters) return null;
    // 負傷は第二章で治らない（第一章で負傷した人物は第二章でも負傷）
    for (const c of IEYASU_CHARACTER_IDS) if (chapter1.characters[c] === 'wounded' && characters[c] !== 'wounded') return null;
    if (!isObject(v.talked)) return null;
    const talked: Partial<Record<Ieyasu2TalkFlag, boolean>> = {};
    for (const [k, val] of Object.entries(v.talked)) {
        if (!(IEYASU2_TALK_FLAGS as readonly string[]).includes(k) || typeof val !== 'boolean') return null;
        if (val) talked[k as Ieyasu2TalkFlag] = true;
    }
    if (v.plan !== null && !CH2_PLANS_ALL.includes(v.plan as Ch2Plan)) return null;
    const plan = v.plan as Ch2Plan | null;
    const terms = parseTerms(v.terms, policy, plan);
    if (terms === undefined) return null;
    const recovery = parseRecovery(v.recovery);
    if (recovery === undefined) return null;
    let battle: BattleOutcome | null = null;
    if (v.battle !== null) {
        battle = parseIeyasu2Outcome(v.battle);
        if (!battle) return null;
    }
    const result = parseIeyasu2Result(v.result);
    if (result === undefined) return null;
    if (v.ending !== null && !IEYASU2_ENDING_IDS.includes(v.ending as Ieyasu2EndingId)) return null;
    const ending = v.ending as Ieyasu2EndingId | null;
    let explore: ExplorePose | null = null;
    if (v.explore !== null) {
        const e = v.explore;
        if (!isObject(e) || !isFiniteNumber(e.x) || !isFiniteNumber(e.z) || !isFiniteNumber(e.heading)) return null;
        if (Math.abs(e.x) > EXPLORE_LIMIT || Math.abs(e.z) > EXPLORE_LIMIT || Math.abs(e.heading) > 100) return null;
        explore = { x: e.x, z: e.z, heading: e.heading };
    }
    if (v.battleId !== null && !isBattleId(v.battleId)) return null;
    if (v.appliedBattleId !== null && !isBattleId(v.appliedBattleId)) return null;
    const battleId = v.battleId as string | null;
    const appliedBattleId = v.appliedBattleId as string | null;

    // 段階との食い違い
    const inField = phase === 'explore' || phase === 'muster';
    const beforeBattle = inField || phase === 'battle';
    if (phase === 'explore' ? plan !== null || recovery !== null : plan === null) return null;
    if (phase === 'battle' && recovery === null) return null;
    if (beforeBattle ? battle !== null || result !== null : battle === null || result === null || recovery === null) return null;
    if (phase === 'ending' ? ending === null : ending !== null) return null;
    if (ending && battle && ending !== `ch2_${policy}_${battle.result}`) return null;
    if (result && (result.plan !== plan || result.recovery !== recovery?.choice || result.thin !== terms?.thin)) return null;
    if (inField ? battleId !== null || appliedBattleId !== null : battleId === null) return null;
    if (phase === 'battle' && appliedBattleId !== null) return null;
    // 閉じた形の食い違い（求め直さない。保存の中の値どうしで確かめる）
    // 補充：選んだ選択肢で作れる値（支度の兵・信頼は第一章の終わりのままなので、第一章の記録から作る）
    if (recovery) {
        const opt = ch2RecoveryOptions({ troops: chapter1.troops, trust: chapter1.trust })[recovery.choice];
        if (!opt.available || TOKUGAWA_UNIT_IDS.some((k) => opt.delta[k] !== recovery.delta[k])) return null;
    }
    // 合戦の前：兵は第一章の兵＋補充、信頼・人物は第一章のまま（動くのは合戦の結果だけ）
    if (beforeBattle) {
        for (const k of TOKUGAWA_UNIT_IDS) {
            if (troops[k] !== Math.max(0, Math.min(IEYASU_TROOPS_MAX, chapter1.troops[k] + (recovery?.delta[k] ?? 0)))) return null;
        }
        if (TRUST_IDS.some((k) => trust[k] !== chapter1.trust[k])) return null;
        if (IEYASU_CHARACTER_IDS.some((c) => characters[c] !== chapter1.characters[c])) return null;
    }
    // 戦後の記録：支援は方針の支援だけ・判断 2 は守備隊を出さない・勝利 ⇔ 主目標を果たした
    if (result && battle) {
        if (result.support.some((x) => x !== CH2_POLICY_SUPPORT[policy])) return null;
        if (result.plan === 'hold' && result.sortie.includes('reserve')) return null;
        if (!result.primary || result.primary.achieved !== (battle.result === 'victory')) return null;
    }
    if ((phase === 'aftermath' || phase === 'ending') && appliedBattleId !== battleId) return null;
    const data: Ieyasu2SaveData = {
        version: IEYASU2_SAVE_VERSION,
        scenario: IEYASU_SCENARIO_ID,
        chapter: 2,
        savedAt: v.savedAt,
        point,
        playTimeSec: v.playTimeSec,
        phase,
        chapter1,
        policy,
        trust,
        troops,
        characters,
        talked,
        plan,
        terms,
        recovery,
        battle,
        battleId,
        appliedBattleId,
        result,
        ending,
        explore,
    };
    if (!canSaveIeyasu2At(state2Of(data), point)) return null;
    return data;
}

function state2Of(d: Ieyasu2SaveData): Ieyasu2State {
    return cloneIeyasu2State({
        scenario: IEYASU_SCENARIO_ID,
        chapter: 2,
        phase: d.phase,
        chapter1: d.chapter1,
        policy: d.policy,
        trust: d.trust,
        troops: d.troops,
        characters: d.characters,
        talked: d.talked,
        plan: d.plan,
        pendingPlan: null,
        terms: d.terms,
        recovery: d.recovery,
        battle: d.battle,
        battleId: d.battleId,
        appliedBattleId: d.appliedBattleId,
        result: d.result,
        ending: d.ending,
        explore: d.explore,
        playTimeSec: d.playTimeSec,
        savedAt: d.savedAt,
    });
}

/** 読み込んだ第二章の保存から続きを遊ぶ状態を作る（出陣前の保存は、出陣の確認の前＝支度から。合戦の id も外す） */
export function ieyasu2StateFromSave(d: Ieyasu2SaveData): Ieyasu2State {
    const s = state2Of(d);
    if (s.phase === 'battle') {
        s.phase = 'muster';
        s.battleId = null;
        s.appliedBattleId = null;
    }
    return s;
}

/** タイトルの「つづきから」の説明（第二章・<段階>・<方針>・<時点>・<日時>・遊んだ時間 N 分） */
export function describeIeyasu2Save(d: Ieyasu2SaveData): string {
    const at = new Date(d.savedAt);
    const p2 = (n: number) => String(n).padStart(2, '0');
    const when = `${at.getFullYear()}/${p2(at.getMonth() + 1)}/${p2(at.getDate())} ${p2(at.getHours())}:${p2(at.getMinutes())}`;
    // 区切りの時点は「章の結末」と書かない（第一章の結末の保存と見分けられるように）
    const point = d.point === 'ending' ? '区切りの保存' : SAVE_POINT_LABELS[d.point];
    return [IEYASU2_PHASE_LABELS[d.phase], POLICY_DONE_LABELS[d.policy], point, when, `遊んだ時間 ${Math.floor(d.playTimeSec / 60)} 分`].join('・');
}

/** 演習の記録のキー（ここでは決して触れない。名前だけ。演習の保存の仕組み campaign/practice.ts を読み込まないように、文字で持つ） */
const PRACTICE_KEYS = ['koto-sengoku/3d-fields', 'koto-sengoku/3d-fields/broken'];

/**
 * 歴史分岐シナリオの保存先（第一章も第二章も）。シナリオ（ieyasu1570/scenario.ts）が使う。
 * - 第一章の状態は IeyasuSaveStore（版 3）で、第二章の状態は版 4 で、同じキーに書く。
 * - 読むときは版を見て、第一章（版 1〜3）・第二章（版 4）のどちらかの状態を返す。
 */
export class IeyasuCampaignStore implements ScenarioStore<IeyasuAnyState> {
    /** 第一章の保存（今までの物。版 3 で書く） */
    readonly ch1: IeyasuSaveStore;

    constructor(
        private readonly storage: StorageLike | null,
        private readonly key: string = IEYASU_SAVE_KEY,
        archiveKey: string = IEYASU_SAVE_ARCHIVE_KEY,
        private readonly chapter1Key: string = IEYASU_CHAPTER1_KEY,
    ) {
        if ([...FORBIDDEN_KEYS, ...PRACTICE_KEYS].some((k) => k === key || k === archiveKey || k === chapter1Key)) throw new Error('2D 版・架空の第一章・演習の保存のキーは使えません');
        if (chapter1Key === key || chapter1Key === archiveKey) throw new Error('第一章の控えのキーは、本来のキー・はじめからの控えと別にしてください');
        this.ch1 = new IeyasuSaveStore(storage, key, archiveKey);
    }

    get available(): boolean {
        return this.storage !== null;
    }

    /**
     * 保存する（第一章の状態は版 3、第二章の状態は版 4）。
     * - 書く文字列は、読み込みと同じ検査（第一章は版 3・第二章は版 4）で読めることを確かめてから書く。読めない物は書かずに失敗（verify）。
     *   書いた後は読み戻して同じ文字列であることを確かめる（writeVerified）ので、読み戻した物も同じ検査で読める。
     *   「保存しました」と出たのに、読み込むと壊れた保存になる、ということを起こさない。
     * - 第二章の状態を書くとき、本来のキーにまだ読める第一章の保存（版 1〜3）があり、第一章の控えに同じ物が無ければ、
     *   先に控えへ写して読み戻す（移るときの控えが書けずに「保存せずに第二章を始める」を選んだ場合など）。
     *   控えへ写せなければ失敗として返し、本来のキーには触れない（第一章の保存は残る）。
     */
    save(state: IeyasuAnyState, point: SavePoint, now: Date = new Date()): ScenarioSaveResult<IeyasuAnyState> {
        if (!isChapter2(state)) {
            if (this.storage) {
                const d1 = toIeyasuSaveData(state, point, now);
                if (d1 && !parseIeyasuSaveData(JSON.stringify(d1))) return fail2('verify');
            }
            return this.ch1.save(state, point, now);
        }
        if (!this.storage) return fail2('unavailable');
        const data = toIeyasu2SaveData(state, point, now);
        if (!data) return fail2('not_now');
        const json = JSON.stringify(data);
        if (!parseIeyasu2SaveData(json)) return fail2('verify');
        const b = this.keepChapter1Backup();
        if (b) return { ok: false, reason: b, message: `${CHAPTER1_BACKUP_FAILED}${saveFailureMessage(b)}` };
        const w = writeVerified(this.storage, this.key, json);
        if (w) return fail2(w);
        return { ok: true, savedAt: data.savedAt, point, state: { ...cloneIeyasu2State(state), savedAt: data.savedAt } };
    }

    /**
     * 本来のキーに読める第一章の保存（版 1〜3）があり、第一章の控えに同じ文字列が無ければ、控えへ写して読み戻す。
     * 写す必要が無い・写せたら null、だめなら理由（本来のキーには触れない）。
     */
    private keepChapter1Backup(): SaveFailureReason | null {
        const st = this.storage!;
        let cur: string | null;
        let bak: string | null;
        try {
            cur = st.getItem(this.key);
        } catch {
            return 'unavailable';
        }
        if (cur === null || !parseIeyasuSaveData(cur)) return null;
        try {
            bak = st.getItem(this.chapter1Key);
        } catch {
            return 'unavailable';
        }
        if (bak === cur) return null;
        return writeVerified(st, this.chapter1Key, cur);
    }

    load(): ScenarioLoadResult<IeyasuAnyState> {
        return this.read(this.key);
    }

    /** 第一章の控え（第二章へ移る前の第一章の結末）を読む */
    loadChapter1Backup(): ScenarioLoadResult<IeyasuAnyState> {
        return this.read(this.chapter1Key);
    }

    /** 保存データそのもの（確認用。版 1〜3 は第一章の形、版 4 は第二章の形） */
    loadData(): IeyasuSaveData | Ieyasu2SaveData | null {
        if (!this.storage) return null;
        try {
            const json = this.storage.getItem(this.key);
            return json === null ? null : (parseIeyasuSaveData(json) ?? parseIeyasu2SaveData(json));
        } catch {
            return null;
        }
    }

    archivePrevious(): boolean {
        return this.ch1.archivePrevious();
    }

    /**
     * 第一章の結末から第二章のはじめへ移るときの保存（二重に書かない・失敗しても元を消さない）。
     * (1) 第一章の結末の状態を版 3 の結末の保存の形で控えのキーへ書いて読み戻す（だめなら本来のキーに触れずに失敗）。
     * (2) 本来のキーの今の中身を控え、第二章のはじめを版 4・時点 'chapter' で書いて読み戻す。
     * (3) だめなら本来のキーを控えの中身へ戻す（もとが無ければ消す）。失敗は理由つき。
     */
    saveChapterStart(prev: IeyasuAnyState, next: IeyasuAnyState, now: Date = new Date()): ScenarioSaveResult<IeyasuAnyState> {
        if (!this.storage) return fail2('unavailable');
        if (isChapter2(prev) || !isChapter2(next)) return fail2('not_now');
        const d1 = toIeyasuSaveData(prev, 'ending', now);
        const d2 = toIeyasu2SaveData(next, 'chapter', now);
        if (!d1 || !d2) return fail2('not_now');
        const json1 = JSON.stringify(d1);
        const json2 = JSON.stringify(d2);
        // 書く前に、読み込みと同じ検査で読めることを確かめる（読めない物はどちらのキーにも書かない。書いた後は読み戻して同じ文字列か確かめる）
        if (!parseIeyasuSaveData(json1) || !parseIeyasu2SaveData(json2)) return fail2('verify');
        const w1 = writeVerified(this.storage, this.chapter1Key, json1);
        if (w1) return fail2(w1);
        let before: string | null;
        try {
            before = this.storage.getItem(this.key);
        } catch {
            return fail2('unavailable');
        }
        const w2 = writeVerified(this.storage, this.key, json2);
        if (w2) {
            let restored = true;
            try {
                if (before === null) this.storage.removeItem(this.key);
                else this.storage.setItem(this.key, before);
                restored = this.storage.getItem(this.key) === before;
            } catch {
                restored = false;
            }
            const msg = saveFailureMessage(w2);
            return { ok: false, reason: w2, message: restored ? msg : `${msg}（元の保存へ戻せませんでした。第一章の結末の控えは残っています）` };
        }
        return { ok: true, savedAt: d2.savedAt, point: 'chapter', state: { ...cloneIeyasu2State(next), savedAt: d2.savedAt } };
    }

    private read(key: string): ScenarioLoadResult<IeyasuAnyState> {
        if (!this.storage) return { status: 'unavailable', message: saveFailureMessage('unavailable') };
        let json: string | null;
        try {
            json = this.storage.getItem(key);
        } catch {
            return { status: 'unavailable', message: saveFailureMessage('unavailable') };
        }
        if (json === null) return { status: 'none' };
        const d1 = parseIeyasuSaveData(json);
        if (d1) return { status: 'ok', state: ieyasuStateFromSave(d1), summary: describeIeyasuSave(d1) };
        const d2 = parseIeyasu2SaveData(json);
        if (d2) return { status: 'ok', state: ieyasu2StateFromSave(d2), summary: describeIeyasu2Save(d2) };
        return { status: 'corrupt', message: IEYASU_CORRUPT_MESSAGE };
    }
}

/** 第二章の保存の前に、本来のキーの第一章の保存を控えへ写せなかったときの文（この後に理由の文が続く） */
export const CHAPTER1_BACKUP_FAILED = '第一章の保存を控えへ写せなかったため、第二章を保存しませんでした（第一章の保存はそのまま残っています）。';

function fail2(reason: SaveFailureReason): ScenarioSaveResult<IeyasuAnyState> {
    return { ok: false, reason, message: saveFailureMessage(reason) };
}
