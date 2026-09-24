/**
 * 端末内（localStorage）への保存と読み込み。
 *
 * 方針：
 * - 書き込み後に読み戻して一致を確かめ、確かめられたときだけ ok: true を返す。
 * - 失敗は理由つきで返し、呼び出し側が「保存しました」と誤表示しないようにする。
 * - 読み込み時は中身を検査し、壊れたデータで始めない。
 * - 形式の版：1 = 位置・フラグ、2 = 1 に模擬戦の記録を追加。版 1 のデータは「模擬戦の記録なし」として読む。
 *   描画のためのもの（画像・Phaser のオブジェクト）は保存データに入れない。
 */
import { ACTOR_HALF_H, ACTOR_HALF_W } from './constants';
import { actorBox, rectsOverlap } from './collision';
import { RETAINER_IDS, copyBattleRecord, emptyBattleRecord, type BattleOutcome, type BattleRecord, type BattleResult } from './battle/model';
import { MAP_PIXEL_HEIGHT, MAP_PIXEL_WIDTH, PLAYER_START, areaAtPixel, rectHitsSolidTile, tileCenter } from './map';
import { createActor, createRetainer, type Flags, type GameState } from './state';
import { isFacing, type Facing } from './types';

export const SAVE_KEY = 'koto-sengoku/save';
export const SAVE_VERSION = 2;
/** 読み込める古い版 */
const LEGACY_VERSIONS = [1];

/** localStorage と同じ形の最小インターフェース（テストで差し替える） */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface SaveData {
    version: number;
    savedAt: string;
    playTimeSec: number;
    player: { x: number; y: number; facing: Facing };
    flags: Flags;
    /** 模擬戦の記録（版 2 から） */
    battle: BattleRecord;
}

export type SaveFailureReason = 'unavailable' | 'quota' | 'verify' | 'unknown';

export type SaveResult =
    | { ok: true; savedAt: string }
    | { ok: false; reason: SaveFailureReason; message: string };

export type LoadResult =
    | { status: 'ok'; data: SaveData }
    | { status: 'none' }
    | { status: 'unavailable'; message: string }
    | { status: 'corrupt'; message: string };

const FAILURE_MESSAGES: Record<SaveFailureReason, string> = {
    unavailable: 'この端末・ブラウザの設定では端末内に保存できません（プライベートブラウズ等）。',
    quota: '端末の保存領域がいっぱいのため保存できませんでした。',
    verify: '保存した内容を確認できなかったため、保存に失敗したものとして扱います。',
    unknown: '保存中に不明なエラーが起きました。',
};

export function failureMessage(reason: SaveFailureReason): string {
    return FAILURE_MESSAGES[reason];
}

export function toSaveData(state: GameState, now: Date): SaveData {
    return {
        version: SAVE_VERSION,
        savedAt: now.toISOString(),
        playTimeSec: Math.floor(state.playTimeSec),
        player: { x: state.player.x, y: state.player.y, facing: state.player.facing },
        flags: { ...state.flags },
        battle: copyBattleRecord(state.battle),
    };
}

/** 保存データからゲーム状態を作る。位置が壁の中などおかしければ初期位置に戻す。 */
export function fromSaveData(data: SaveData): GameState {
    const retainer = createRetainer();
    let { x, y } = data.player;
    const box = actorBox({ x, y }, ACTOR_HALF_W, ACTOR_HALF_H);
    if (rectHitsSolidTile(box) || rectsOverlap(box, actorBox(retainer, ACTOR_HALF_W, ACTOR_HALF_H))) {
        ({ x, y } = tileCenter(PLAYER_START.tx, PLAYER_START.ty));
    }
    return {
        player: createActor(x, y, data.player.facing),
        retainer,
        flags: { ...data.flags },
        area: areaAtPixel(x, y),
        playTimeSec: data.playTimeSec,
        dialogue: null,
        battle: copyBattleRecord(data.battle),
    };
}

/** JSON 文字列を検査して SaveData にする。不正なら null。 */
export function parseSaveData(json: string): SaveData | null {
    let v: unknown;
    try {
        v = JSON.parse(json);
    } catch {
        return null;
    }
    if (!isObject(v)) return null;
    if (v.version !== SAVE_VERSION && !LEGACY_VERSIONS.includes(v.version as number)) return null;
    if (typeof v.savedAt !== 'string' || Number.isNaN(Date.parse(v.savedAt))) return null;
    if (!isFiniteNumber(v.playTimeSec) || v.playTimeSec < 0) return null;
    const p = v.player;
    if (!isObject(p) || !isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFacing(p.facing)) return null;
    if (p.x < 0 || p.y < 0 || p.x > MAP_PIXEL_WIDTH || p.y > MAP_PIXEL_HEIGHT) return null;
    const f = v.flags;
    if (!isObject(f)) return null;
    const keys: (keyof Flags)[] = ['metRetainer', 'visitedTown', 'visitedRoad', 'reported'];
    if (!keys.every((k) => typeof f[k] === 'boolean')) return null;
    // 版 1 には模擬戦の記録がない → 記録なしとして読む
    const battle = v.version === 1 ? emptyBattleRecord() : parseBattleRecord(v.battle);
    if (!battle) return null;
    return {
        version: SAVE_VERSION,
        savedAt: v.savedAt,
        playTimeSec: v.playTimeSec,
        player: { x: p.x, y: p.y, facing: p.facing },
        flags: {
            metRetainer: f.metRetainer as boolean,
            visitedTown: f.visitedTown as boolean,
            visitedRoad: f.visitedRoad as boolean,
            reported: f.reported as boolean,
        },
        battle,
    };
}

const OUTCOMES: readonly BattleOutcome[] = ['victory', 'defeat', 'retreat'];

function parseBattleRecord(b: unknown): BattleRecord | null {
    if (!isObject(b)) return null;
    const counts = [b.victories, b.defeats, b.retreats];
    if (!counts.every(isCount)) return null;
    if (typeof b.debriefPending !== 'boolean') return null;
    let last: BattleResult | null = null;
    if (b.last !== null) {
        const l = b.last;
        if (!isObject(l)) return null;
        if (!OUTCOMES.includes(l.outcome as BattleOutcome)) return null;
        const rd = l.retainersDown;
        if (!isObject(rd) || !RETAINER_IDS.every((id) => typeof rd[id] === 'boolean')) return null;
        if (!isCount(l.defeated) || (l.defeated as number) > 4 || !isCount(l.seconds)) return null;
        last = {
            outcome: l.outcome as BattleOutcome,
            retainersDown: { genzo: rd.genzo as boolean, shinpachi: rd.shinpachi as boolean },
            defeated: l.defeated as number,
            seconds: l.seconds as number,
        };
    }
    // 報告待ちなのに結果がない、は不整合
    if (b.debriefPending && !last) return null;
    return {
        last,
        victories: b.victories as number,
        defeats: b.defeats as number,
        retreats: b.retreats as number,
        debriefPending: b.debriefPending,
    };
}

function isCount(v: unknown): boolean {
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9;
}

export class SaveStore {
    constructor(
        private readonly storage: StorageLike | null,
        private readonly key: string = SAVE_KEY,
    ) {}

    get available(): boolean {
        return this.storage !== null;
    }

    save(state: GameState, now: Date = new Date()): SaveResult {
        if (!this.storage) return fail('unavailable');
        const data = toSaveData(state, now);
        const json = JSON.stringify(data);
        try {
            this.storage.setItem(this.key, json);
        } catch (e) {
            return fail(isQuotaError(e) ? 'quota' : isSecurityError(e) ? 'unavailable' : 'unknown');
        }
        let readBack: string | null;
        try {
            readBack = this.storage.getItem(this.key);
        } catch {
            return fail('verify');
        }
        if (readBack !== json) return fail('verify');
        return { ok: true, savedAt: data.savedAt };
    }

    load(): LoadResult {
        if (!this.storage) return { status: 'unavailable', message: FAILURE_MESSAGES.unavailable };
        let json: string | null;
        try {
            json = this.storage.getItem(this.key);
        } catch {
            return { status: 'unavailable', message: FAILURE_MESSAGES.unavailable };
        }
        if (json === null) return { status: 'none' };
        const data = parseSaveData(json);
        if (!data) return { status: 'corrupt', message: '保存データが壊れているか、形式が古いため読み込めません。' };
        return { status: 'ok', data };
    }
}

/**
 * ブラウザの localStorage を安全に取得する。
 * 設定によってはアクセスしただけで例外になるため、試し書きまで行う。
 */
export function getBrowserStorage(): StorageLike | null {
    try {
        const s = globalThis.localStorage;
        if (!s) return null;
        const probe = '__koto_probe__';
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
    const name = e.name;
    const code = e.code;
    return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

function isSecurityError(e: unknown): boolean {
    return isObject(e) && e.name === 'SecurityError';
}

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null;
}

function isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}
