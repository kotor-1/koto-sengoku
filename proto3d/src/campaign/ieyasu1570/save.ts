/**
 * 歴史分岐シナリオ「元亀元年・家康」の保存と読み込み（端末内の localStorage）。設計：docs/ieyasu1570-design.md §7。
 *
 * - 保存先のキーは 'koto-sengoku/3d-ieyasu1570'（版 1）。データにシナリオの id（'ieyasu1570'）を入れる。
 * - 架空の第一章のキー 'koto-sengoku/3d-chapter1' と、2D 版のキー 'koto-sengoku/save' には、読みも書きも消しもしない。
 * - 書き込んだ後に読み戻して一致を確かめ、確かめられたときだけ ok: true（失敗は理由つき。成功したように見せない）。
 * - 読み込み時は形・値の範囲・段階との食い違いを検査し、壊れたデータでは始めない（勝手に消しもしない）。
 * - いつ保存するか・読み込んだ後どこから始めるかは、架空の第一章と同じ（出陣前の保存は出陣の確認の前から。
 *   決着の時点で結果を反映して戦後の保存。反映は合戦の id ごとに 1 回だけ：battleId／appliedBattleId）。
 */
import { CAMPAIGN_SAVE_ARCHIVE_KEY, CAMPAIGN_SAVE_KEY, LEGACY_2D_SAVE_KEY, SAVE_POINT_LABELS, saveFailureMessage, writeVerified, type SaveFailureReason, type SavePoint, type StorageLike } from '../save';
import type { ScenarioLoadResult, ScenarioSaveResult, ScenarioStore } from '../scenario';
import { EXPLORE_LIMIT, isBattleId, isFiniteNumber, isObject } from '../state';
import { IEYASU_PLAY_TIME_MAX } from './flow';
import {
    CARRY_FLAGS,
    IEYASU_CHARACTER_IDS,
    IEYASU_CHARACTER_STATUSES,
    IEYASU_ENDING_IDS,
    IEYASU_SCENARIO_ID,
    IEYASU_TALK_FLAGS,
    IEYASU_TROOPS_MAX,
    PLEDGE_RESULTS,
    PLEDGE_SPECS,
    POLICIES,
    TOKUGAWA_UNIT_IDS,
    TRUST_IDS,
    TRUST_MAX,
    TRUST_MIN,
    cloneIeyasuOutcome,
    cloneIeyasuState,
    parseIeyasuOutcome,
    type CampaignPhase,
    type CarryFlag,
    type ExplorePose,
    type IeyasuCharacterId,
    type IeyasuCharacterStatus,
    type IeyasuEndingId,
    type IeyasuState,
    type IeyasuTalkFlag,
    type PledgeResult,
    type PledgeState,
    type Policy,
    type SupportState,
    type TokugawaUnitId,
    type TrustId,
} from './state';
import { IEYASU_PHASE_LABELS, POLICY_DONE_LABELS } from './story';
import type { BattleOutcome } from '../../battle/types';

export const IEYASU_SAVE_KEY = 'koto-sengoku/3d-ieyasu1570';
export const IEYASU_SAVE_ARCHIVE_KEY = 'koto-sengoku/3d-ieyasu1570/previous';
export const IEYASU_SAVE_VERSION = 1;

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
    if (v.from !== null && !TRUST_IDS.includes(v.from as TrustId)) return undefined;
    if (typeof v.recovered !== 'number' || !Number.isInteger(v.recovered) || v.recovered < 0 || v.recovered > IEYASU_TROOPS_MAX) return undefined;
    if (!Array.isArray(v.carryOver) || v.carryOver.length > CARRY_FLAGS.length) return undefined;
    const carry: CarryFlag[] = [];
    for (const f of v.carryOver as unknown[]) {
        if (!CARRY_FLAGS.includes(f as CarryFlag) || carry.includes(f as CarryFlag)) return undefined;
        carry.push(f as CarryFlag);
    }
    if (v.reinforcement ? v.from === null : v.from !== null || v.recovered !== 0) return undefined;
    return { reinforcement: v.reinforcement, from: v.from as TrustId | null, recovered: v.recovered, carryOver: carry };
}

/** JSON 文字列を検査して保存データにする。形・範囲・段階との食い違いがあれば null */
export function parseIeyasuSaveData(json: string): IeyasuSaveData | null {
    let v: unknown;
    try {
        v = JSON.parse(json);
    } catch {
        return null;
    }
    if (!isObject(v)) return null;
    if (v.version !== IEYASU_SAVE_VERSION || v.scenario !== IEYASU_SCENARIO_ID) return null;
    if (typeof v.savedAt !== 'string' || Number.isNaN(Date.parse(v.savedAt))) return null;
    if (!SAVE_POINTS.includes(v.point as SavePoint)) return null;
    const point = v.point as SavePoint;
    if (!isFiniteNumber(v.playTimeSec) || v.playTimeSec < 0 || v.playTimeSec > IEYASU_PLAY_TIME_MAX) return null;
    if (!SAVED_PHASES.includes(v.phase as SavedPhase)) return null;
    const phase = v.phase as SavedPhase;
    if (v.policy !== null && !POLICIES.includes(v.policy as Policy)) return null;
    const policy = v.policy as Policy | null;

    if (!isObject(v.trust)) return null;
    const trust = {} as Record<TrustId, number>;
    for (const c of TRUST_IDS) {
        const r = v.trust[c];
        if (!isFiniteNumber(r) || r < TRUST_MIN || r > TRUST_MAX) return null;
        trust[c] = r;
    }
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
