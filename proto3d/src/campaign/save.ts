/**
 * 第一章の保存と読み込み（端末内の localStorage）。仕様：docs/chapter1-spec.md §6。純粋な TypeScript（保存先は差し替えられる）。
 *
 * 方針（2D 版 src/core/save.ts と同じ）：
 * - 書き込んだ後に読み戻して一致を確かめ、確かめられたときだけ ok: true を返す。失敗は理由つきで返す（成功したように見せない）。
 * - 読み込み時は形・値の範囲・段階との食い違いを検査し、壊れたデータでは始めない（壊れたデータを勝手に消しもしない）。
 * - 保存先のキーは 'koto-sengoku/3d-chapter1'。2D 版の 'koto-sengoku/save' には読みも書きも消しもしない。
 * - 形式の版：1。
 *
 * いつ保存するか：
 * - 自動保存（出陣前）：城門で「出陣する」を選んだ直後（phase は battle、合戦の結果はまだ無い）。point 'departure'。
 *   これを読み込むと、出陣の確認の前（muster）から再開する（合戦の途中からは再開しない）。
 * - 自動保存（戦後）：合戦の結果を反映した直後（phase は aftermath）。point 'aftermath'。
 * - 手動保存：探索中（explore・muster・aftermath）のメニューから。point 'manual'。
 * - 結末（任意）：章の結末に入った後（phase は ending）。point 'ending'。
 */
import { PLAY_TIME_MAX } from './flow';
import {
    ALLIANCES,
    CHARACTER_IDS,
    CHARACTER_STATUSES,
    ENDING_IDS,
    EXPLORE_LIMIT,
    KOTOSAKA_UNIT_IDS,
    RELATION_CLANS,
    RELATION_MAX,
    RELATION_MIN,
    TALK_FLAGS,
    TROOPS_MAX,
    cloneOutcome,
    cloneState,
    isFiniteNumber,
    isObject,
    parseBattleOutcome,
    type Alliance,
    type CampaignPhase,
    type CampaignState,
    type CharacterId,
    type CharacterStatus,
    type EndingId,
    type ExplorePose,
    type KotosakaUnitId,
    type RelationClan,
    type TalkFlag,
} from './state';
import { ALLIANCE_DONE_LABELS, PHASE_LABELS } from './story';
import type { BattleOutcome } from '../battle/types';

export const CAMPAIGN_SAVE_KEY = 'koto-sengoku/3d-chapter1';
/** 「はじめから」で前の保存を上書きする前に、控えを置く所（archivePrevious） */
export const CAMPAIGN_SAVE_ARCHIVE_KEY = 'koto-sengoku/3d-chapter1/previous';
/** 2D 版の保存のキー。ここには決して触れない（テストで確かめる） */
export const LEGACY_2D_SAVE_KEY = 'koto-sengoku/save';
export const CAMPAIGN_SAVE_VERSION = 1;

/** localStorage と同じ形の最小のもの（テストで差し替える） */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** どの時点の保存か */
export type SavePoint = 'departure' | 'aftermath' | 'manual' | 'ending';
export const SAVE_POINT_LABELS: Readonly<Record<SavePoint, string>> = {
    departure: '出陣前（自動保存）',
    aftermath: '戦後（自動保存）',
    manual: '手動保存',
    ending: '章の結末',
};
/** 保存に入る段階（council は軍議の画面の途中なので保存しない） */
export type SavedPhase = Exclude<CampaignPhase, 'council'>;

export interface CampaignSaveData {
    version: typeof CAMPAIGN_SAVE_VERSION;
    savedAt: string;
    point: SavePoint;
    playTimeSec: number;
    phase: SavedPhase;
    alliance: Alliance | null;
    relations: Record<RelationClan, number>;
    troops: Record<KotosakaUnitId, number>;
    characters: Record<CharacterId, CharacterStatus>;
    talked: Partial<Record<TalkFlag, boolean>>;
    battle: BattleOutcome | null;
    ending: EndingId | null;
    explore: ExplorePose | null;
}

export type SaveFailureReason = 'unavailable' | 'quota' | 'verify' | 'not_now' | 'unknown';
export type SaveResult =
    | { ok: true; savedAt: string; point: SavePoint; state: CampaignState }
    | { ok: false; reason: SaveFailureReason; message: string };
export type LoadResult =
    | { status: 'ok'; data: CampaignSaveData; state: CampaignState }
    | { status: 'none' }
    | { status: 'unavailable'; message: string }
    | { status: 'corrupt'; message: string };

const FAILURE_MESSAGES: Record<SaveFailureReason, string> = {
    unavailable: 'この端末・ブラウザの設定では端末内に保存できません（プライベートブラウズ等）。',
    quota: '端末の保存領域がいっぱいのため保存できませんでした。',
    verify: '保存した内容を確認できなかったため、保存に失敗したものとして扱います。',
    not_now: '今は保存できません（合戦の途中・軍議の途中は保存しません）。',
    unknown: '保存中に不明なエラーが起きました。',
};
export const CORRUPT_MESSAGE = '保存データが壊れているか、形式が違うため読み込めません（データはそのまま残しています）。';

export function saveFailureMessage(reason: SaveFailureReason): string {
    return FAILURE_MESSAGES[reason];
}

/** その時点の保存として、この状態を保存してよいか */
export function canSaveAt(state: CampaignState, point: SavePoint): boolean {
    switch (point) {
        case 'departure':
            return state.phase === 'battle' && state.battle === null && state.alliance !== null;
        case 'aftermath':
            return state.phase === 'aftermath' && state.battle !== null;
        case 'manual':
            return state.phase === 'explore' || state.phase === 'muster' || state.phase === 'aftermath';
        case 'ending':
            return state.phase === 'ending' && state.ending !== null;
    }
}

/** 保存する形にする（保存してよくない時点なら null） */
export function toSaveData(state: CampaignState, point: SavePoint, now: Date): CampaignSaveData | null {
    if (!canSaveAt(state, point) || state.phase === 'council') return null;
    return {
        version: CAMPAIGN_SAVE_VERSION,
        savedAt: now.toISOString(),
        point,
        playTimeSec: Math.floor(Math.max(0, Math.min(PLAY_TIME_MAX, state.playTimeSec))),
        phase: state.phase,
        alliance: state.alliance,
        relations: { ...state.relations },
        troops: { ...state.troops },
        characters: { ...state.characters },
        talked: pickTalked(state.talked),
        battle: state.battle ? cloneOutcome(state.battle) : null,
        ending: state.ending,
        explore: state.explore ? { ...state.explore } : null,
    };
}

function pickTalked(t: Partial<Record<TalkFlag, boolean>>): Partial<Record<TalkFlag, boolean>> {
    const out: Partial<Record<TalkFlag, boolean>> = {};
    for (const k of TALK_FLAGS) if (t[k] === true) out[k] = true;
    return out;
}

const SAVED_PHASES: readonly SavedPhase[] = ['explore', 'muster', 'battle', 'aftermath', 'ending'];
const SAVE_POINTS: readonly SavePoint[] = ['departure', 'aftermath', 'manual', 'ending'];

/** JSON 文字列を検査して保存データにする。形・範囲・段階との食い違いがあれば null */
export function parseSaveData(json: string): CampaignSaveData | null {
    let v: unknown;
    try {
        v = JSON.parse(json);
    } catch {
        return null;
    }
    if (!isObject(v)) return null;
    if (v.version !== CAMPAIGN_SAVE_VERSION) return null;
    if (typeof v.savedAt !== 'string' || Number.isNaN(Date.parse(v.savedAt))) return null;
    if (!SAVE_POINTS.includes(v.point as SavePoint)) return null;
    const point = v.point as SavePoint;
    if (!isFiniteNumber(v.playTimeSec) || v.playTimeSec < 0 || v.playTimeSec > PLAY_TIME_MAX) return null;
    if (!SAVED_PHASES.includes(v.phase as SavedPhase)) return null;
    const phase = v.phase as SavedPhase;
    if (v.alliance !== null && !ALLIANCES.includes(v.alliance as Alliance)) return null;
    const alliance = v.alliance as Alliance | null;

    const rel = v.relations;
    if (!isObject(rel)) return null;
    const relations = {} as Record<RelationClan, number>;
    for (const c of RELATION_CLANS) {
        const r = rel[c];
        if (!isFiniteNumber(r) || r < RELATION_MIN || r > RELATION_MAX) return null;
        relations[c] = r;
    }
    const tr = v.troops;
    if (!isObject(tr)) return null;
    const troops = {} as Record<KotosakaUnitId, number>;
    for (const k of KOTOSAKA_UNIT_IDS) {
        const n = tr[k];
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > TROOPS_MAX) return null;
        troops[k] = n;
    }
    const ch = v.characters;
    if (!isObject(ch)) return null;
    const characters = {} as Record<CharacterId, CharacterStatus>;
    for (const c of CHARACTER_IDS) {
        if (!CHARACTER_STATUSES.includes(ch[c] as CharacterStatus)) return null;
        characters[c] = ch[c] as CharacterStatus;
    }
    const tk = v.talked;
    if (!isObject(tk)) return null;
    const talked: Partial<Record<TalkFlag, boolean>> = {};
    for (const [k, val] of Object.entries(tk)) {
        if (!(TALK_FLAGS as readonly string[]).includes(k) || typeof val !== 'boolean') return null;
        if (val) talked[k as TalkFlag] = true;
    }
    let battle: BattleOutcome | null = null;
    if (v.battle !== null) {
        battle = parseBattleOutcome(v.battle);
        if (!battle) return null;
    }
    if (v.ending !== null && !ENDING_IDS.includes(v.ending as EndingId)) return null;
    const ending = v.ending as EndingId | null;
    let explore: ExplorePose | null = null;
    if (v.explore !== null) {
        const e = v.explore;
        if (!isObject(e) || !isFiniteNumber(e.x) || !isFiniteNumber(e.z) || !isFiniteNumber(e.heading)) return null;
        if (Math.abs(e.x) > EXPLORE_LIMIT || Math.abs(e.z) > EXPLORE_LIMIT || Math.abs(e.heading) > 100) return null;
        explore = { x: e.x, z: e.z, heading: e.heading };
    }

    // 段階との食い違い
    const beforeBattle = phase === 'explore' || phase === 'muster' || phase === 'battle';
    if (phase === 'explore' ? alliance !== null : alliance === null) return null;
    if (beforeBattle ? battle !== null : battle === null) return null;
    if (phase === 'ending' ? ending === null : ending !== null) return null;
    const data: CampaignSaveData = {
        version: CAMPAIGN_SAVE_VERSION,
        savedAt: v.savedAt,
        point,
        playTimeSec: v.playTimeSec,
        phase,
        alliance,
        relations,
        troops,
        characters,
        talked,
        battle,
        ending,
        explore,
    };
    if (!canSaveAt(stateOf(data), point)) return null;
    return data;
}

function stateOf(d: CampaignSaveData): CampaignState {
    return {
        phase: d.phase,
        alliance: d.alliance,
        pendingAlliance: null,
        relations: { ...d.relations },
        troops: { ...d.troops },
        characters: { ...d.characters },
        talked: { ...d.talked },
        battle: d.battle ? cloneOutcome(d.battle) : null,
        ending: d.ending,
        explore: d.explore ? { ...d.explore } : null,
        playTimeSec: d.playTimeSec,
        savedAt: d.savedAt,
    };
}

/**
 * 読み込んだ保存から、続きを遊ぶ状態を作る。
 * battle の段階（出陣前の自動保存）は、出陣の確認の前（muster）から再開する（合戦の途中からは再開しない）。
 */
export function stateFromSave(d: CampaignSaveData): CampaignState {
    const s = stateOf(d);
    if (s.phase === 'battle') s.phase = 'muster';
    return s;
}

/** タイトルの「つづきから」に添える説明（例：「出陣の支度・田代家と組んだ・出陣前（自動保存）・2026/09/29 12:34・遊んだ時間 12 分」） */
export function describeSave(d: CampaignSaveData): string {
    const at = new Date(d.savedAt);
    const p2 = (n: number) => String(n).padStart(2, '0');
    const when = `${at.getFullYear()}/${p2(at.getMonth() + 1)}/${p2(at.getDate())} ${p2(at.getHours())}:${p2(at.getMinutes())}`;
    const parts = [PHASE_LABELS[d.phase]];
    if (d.alliance) parts.push(ALLIANCE_DONE_LABELS[d.alliance]);
    parts.push(SAVE_POINT_LABELS[d.point], when, `遊んだ時間 ${Math.floor(d.playTimeSec / 60)} 分`);
    return parts.join('・');
}

export class CampaignSaveStore {
    constructor(
        private readonly storage: StorageLike | null,
        private readonly key: string = CAMPAIGN_SAVE_KEY,
        private readonly archiveKey: string = CAMPAIGN_SAVE_ARCHIVE_KEY,
    ) {
        if (key === LEGACY_2D_SAVE_KEY || archiveKey === LEGACY_2D_SAVE_KEY) throw new Error('2D 版の保存のキーは使えません');
    }

    get available(): boolean {
        return this.storage !== null;
    }

    /** 保存する。成功したら、保存日時を入れた新しい状態も返す */
    save(state: CampaignState, point: SavePoint, now: Date = new Date()): SaveResult {
        if (!this.storage) return fail('unavailable');
        const data = toSaveData(state, point, now);
        if (!data) return fail('not_now');
        const json = JSON.stringify(data);
        const w = this.write(this.key, json);
        if (w) return fail(w);
        return { ok: true, savedAt: data.savedAt, point, state: { ...cloneState(state), savedAt: data.savedAt } };
    }

    load(): LoadResult {
        return this.read(this.key);
    }

    /** 「はじめから」の前に、今の保存を控えの場所へ写す（写す物が無ければ true。写せなければ false で、今の保存は残る） */
    archivePrevious(): boolean {
        if (!this.storage) return false;
        let json: string | null;
        try {
            json = this.storage.getItem(this.key);
        } catch {
            return false;
        }
        if (json === null) return true;
        return this.write(this.archiveKey, json) === null;
    }

    /** 控えの保存を読む（確認用） */
    loadArchived(): LoadResult {
        return this.read(this.archiveKey);
    }

    private write(key: string, json: string): SaveFailureReason | null {
        const s = this.storage!;
        try {
            s.setItem(key, json);
        } catch (e) {
            return isQuotaError(e) ? 'quota' : isSecurityError(e) ? 'unavailable' : 'unknown';
        }
        let back: string | null;
        try {
            back = s.getItem(key);
        } catch {
            return 'verify';
        }
        return back === json ? null : 'verify';
    }

    private read(key: string): LoadResult {
        if (!this.storage) return { status: 'unavailable', message: FAILURE_MESSAGES.unavailable };
        let json: string | null;
        try {
            json = this.storage.getItem(key);
        } catch {
            return { status: 'unavailable', message: FAILURE_MESSAGES.unavailable };
        }
        if (json === null) return { status: 'none' };
        const data = parseSaveData(json);
        if (!data) return { status: 'corrupt', message: CORRUPT_MESSAGE };
        return { status: 'ok', data, state: stateFromSave(data) };
    }
}

/**
 * ブラウザの localStorage を安全に取得する（設定によっては触れただけで例外になるので、試し書きまでする）。
 * 試し書きのキーは 3D 版専用（2D 版のキーには触れない）。
 */
export function getBrowserStorage(): StorageLike | null {
    try {
        const s = (globalThis as { localStorage?: StorageLike }).localStorage;
        if (!s) return null;
        const probe = '__koto_3d_probe__';
        s.setItem(probe, '1');
        s.removeItem(probe);
        return s;
    } catch {
        return null;
    }
}

function fail(reason: SaveFailureReason): SaveResult {
    return { ok: false, reason, message: FAILURE_MESSAGES[reason] };
}

function isQuotaError(e: unknown): boolean {
    if (!isObject(e)) return false;
    return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014;
}

function isSecurityError(e: unknown): boolean {
    return isObject(e) && e.name === 'SecurityError';
}
