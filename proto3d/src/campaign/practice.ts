/**
 * 合戦場の演習（設計：docs/battlefields-design.md §6）：記録の保存と、画面の流れ（純粋な TypeScript。three・DOM を使わない）。
 *
 * 流れ：タイトルの「合戦場の演習」→ 戦場の一覧 → 合戦の前の説明 →（出陣）合戦 → 結果（勝敗・主目標・副目標を別々の行）→ 記録の保存 → 一覧。
 * 画面は PracticeView（ui/practiceView.ts が DOM で作る）。テスト（tests/proto3d-practice.test.ts）では偽の画面を差し込んで通す。
 *
 * 保存：キー 'koto-sengoku/3d-fields'（版 1）。戦場ごとに遊んだ回数・最後の結果・最高の結果。
 * - 書いた後に読み戻して確かめる（campaign/save.ts の writeVerified）。
 * - 読めない（壊れている・形が違う・知らない版）ときは上書きしない。中身を 'koto-sengoku/3d-fields/broken' へ写し（読み戻して確かめる）、
 *   写せたときだけ新しく作る。写せなければ記録は保存しない（元のデータは残る）。
 * - ほかのキー（章の保存・2D 版の保存）には触れない。
 *
 * 演習はゲーム用の演習（架空の相手）。敵はすべて架空の「敵勢」（家 rival）で、史実の合戦の再現ではない。
 */
import type { BattleEndReason, BattleOutcome, BattleResultKind, BattleRunHooks, BattleSetup } from '../battle/types';
import { buildBattleSetup, getField, practiceFields, type BattlefieldDef } from '../battle/fields';
import { createBattle } from '../battle/sim';
import { KIND_SHORT, RESULT_LABEL, fieldRuleTexts, fmtClock, scenarioTexts } from '../battle/control';
import { ABILITY_DATA, abilityDisplayName, resolveAbilityId } from '../battle/abilities';
import { generalById } from '../battle/generals';
import { CAMPAIGN_SAVE_KEY, LEGACY_2D_SAVE_KEY, saveFailureMessage, writeVerified, type SaveFailureReason, type StorageLike } from './save';
import { formatSavedTime } from './scenario';

// ================= 保存 =================

export const PRACTICE_SAVE_KEY = 'koto-sengoku/3d-fields';
/** 読めない保存を写して残す所（上書きせずに新しく作る前に） */
export const PRACTICE_BROKEN_KEY = 'koto-sengoku/3d-fields/broken';
export const PRACTICE_SAVE_VERSION = 1;
/** 演習で使う編成（どの戦場も 'standard'） */
export const PRACTICE_PRESET = 'standard';
/** 画面に出す演習の札 */
export const PRACTICE_NOTE = 'ゲーム用の演習（架空の相手）';

/** 1 回の結果（最後・最高の記録） */
export interface PracticeResultRecord {
    result: BattleResultKind;
    reason: BattleEndReason;
    /** 主目標（達成は勝利かどうかと同じ）。段階目標（第3群の城攻め前面など）は、果たした段の数と段の数も（無い記録もそのまま読める） */
    primary: { id: string; achieved: boolean; steps?: { done: number; total: number } };
    /** 副目標（1 つずつ） */
    secondary: { id: string; label: string; achieved: boolean }[];
    /** 合戦にかかった時間（秒。0.1 秒で丸める） */
    elapsedSec: number;
    /** 記録した日時（ISO） */
    at: string;
}
export interface PracticeFieldRecord {
    plays: number;
    last: PracticeResultRecord;
    best: PracticeResultRecord;
}
export interface PracticeSaveData {
    version: typeof PRACTICE_SAVE_VERSION;
    /** 戦場 id → 記録（知らない戦場の記録も消さずに残す） */
    records: Record<string, PracticeFieldRecord>;
}

export type PracticeLoad =
    | { status: 'ok'; data: PracticeSaveData }
    | { status: 'none' }
    | { status: 'unavailable'; message: string }
    | { status: 'corrupt'; message: string };

export type PracticeSaveResult =
    | { ok: true; data: PracticeSaveData; record: PracticeFieldRecord; isBest: boolean; movedBroken: boolean }
    | { ok: false; reason: SaveFailureReason | 'backup'; message: string };

export const PRACTICE_CORRUPT_MESSAGE = '演習の記録が壊れているか、形式が違うため読み込めません（次に記録するとき、今のデータを控えへ移してから新しく作ります）。';
const BACKUP_FAILED_MESSAGE = '読み込めない記録を控えへ移せなかったため、記録を保存しませんでした（今のデータはそのまま残しています）。';

const RESULTS: readonly BattleResultKind[] = ['victory', 'defeat', 'retreat'];
const REASONS: readonly BattleEndReason[] = [
    'enemy_hq_routed',
    'enemy_army_broken',
    'ally_hq_routed',
    'ally_army_broken',
    'ordered_retreat',
    'nightfall',
    'objective_done',
    'objective_failed',
];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parseResult(v: unknown): PracticeResultRecord | null {
    if (!isObj(v)) return null;
    const { result, reason, primary, secondary, elapsedSec, at } = v;
    if (!RESULTS.includes(result as BattleResultKind) || !REASONS.includes(reason as BattleEndReason)) return null;
    if (!isObj(primary) || typeof primary.id !== 'string' || typeof primary.achieved !== 'boolean') return null;
    // 段階目標の段（省けば無し。あれば 0 以上の整数で done ≤ total）
    let steps: { done: number; total: number } | undefined;
    if (primary.steps !== undefined) {
        const st = primary.steps;
        if (!isObj(st) || !Number.isInteger(st.done) || !Number.isInteger(st.total) || (st.done as number) < 0 || (st.done as number) > (st.total as number)) return null;
        steps = { done: st.done as number, total: st.total as number };
    }
    if (!Array.isArray(secondary)) return null;
    const sec: PracticeResultRecord['secondary'] = [];
    for (const s of secondary) {
        if (!isObj(s) || typeof s.id !== 'string' || typeof s.label !== 'string' || typeof s.achieved !== 'boolean') return null;
        sec.push({ id: s.id, label: s.label, achieved: s.achieved });
    }
    if (!isNum(elapsedSec) || elapsedSec < 0 || typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
    return { result: result as BattleResultKind, reason: reason as BattleEndReason, primary: { id: primary.id, achieved: primary.achieved, ...(steps ? { steps } : {}) }, secondary: sec, elapsedSec, at };
}

/** 保存の文字列を読む（形が違えば null） */
export function parsePracticeData(json: string): PracticeSaveData | null {
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        return null;
    }
    if (!isObj(raw) || raw.version !== PRACTICE_SAVE_VERSION || !isObj(raw.records)) return null;
    const records: Record<string, PracticeFieldRecord> = {};
    for (const [id, r] of Object.entries(raw.records)) {
        if (!isObj(r) || !isNum(r.plays) || !Number.isInteger(r.plays) || r.plays < 1) return null;
        const last = parseResult(r.last);
        const best = parseResult(r.best);
        if (!last || !best) return null;
        records[id] = { plays: r.plays, last, best };
    }
    return { version: PRACTICE_SAVE_VERSION, records };
}

/** 合戦の結果から 1 回分の記録を作る（主目標が無い合戦は、戦場の主目標 id と勝利かどうか） */
export function recordFromOutcome(o: BattleOutcome, primaryId: string, now: Date): PracticeResultRecord {
    const ob = o.objectives;
    return {
        result: o.result,
        reason: o.reason,
        primary: ob?.primary
            ? { id: ob.primary.id, achieved: ob.primary.achieved, ...(ob.primary.steps ? { steps: { ...ob.primary.steps } } : {}) }
            : { id: primaryId, achieved: o.result === 'victory' },
        secondary: (ob?.secondary ?? []).map((s) => ({ id: s.id, label: s.label, achieved: s.achieved })),
        elapsedSec: Math.round(Math.max(0, o.elapsedSec) * 10) / 10,
        at: now.toISOString(),
    };
}

const RESULT_RANK: Record<BattleResultKind, number> = { victory: 2, retreat: 1, defeat: 0 };

/**
 * a が b より良い記録か。順に：勝敗（勝利 > 撤退 > 敗北）→ 主目標の達成 → 副目標の達成の数 → 勝利どうしなら早い方。
 * 同じなら前の最高の記録のまま（false）。
 */
export function isBetterRecord(a: PracticeResultRecord, b: PracticeResultRecord): boolean {
    const keys = (r: PracticeResultRecord) => [RESULT_RANK[r.result], r.primary.achieved ? 1 : 0, r.secondary.filter((s) => s.achieved).length];
    const ka = keys(a);
    const kb = keys(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i]! > kb[i]!;
    return a.result === 'victory' && a.elapsedSec < b.elapsedSec;
}

/** 記録の保存（キー 'koto-sengoku/3d-fields' と、壊れたときの控え 'koto-sengoku/3d-fields/broken' だけに触れる） */
export class PracticeRecordStore {
    constructor(
        private readonly storage: StorageLike | null,
        readonly key: string = PRACTICE_SAVE_KEY,
        readonly brokenKey: string = PRACTICE_BROKEN_KEY,
    ) {
        for (const k of [key, brokenKey]) {
            if (k === LEGACY_2D_SAVE_KEY || k === CAMPAIGN_SAVE_KEY) throw new Error('章・2D 版の保存のキーは使えません');
        }
    }

    get available(): boolean {
        return this.storage !== null;
    }

    load(): PracticeLoad {
        if (!this.storage) return { status: 'unavailable', message: saveFailureMessage('unavailable') };
        let json: string | null;
        try {
            json = this.storage.getItem(this.key);
        } catch {
            return { status: 'unavailable', message: saveFailureMessage('unavailable') };
        }
        if (json === null) return { status: 'none' };
        const data = parsePracticeData(json);
        return data ? { status: 'ok', data } : { status: 'corrupt', message: PRACTICE_CORRUPT_MESSAGE };
    }

    /** 1 回の結果を足して保存する（書いた後に読み戻して確かめる） */
    record(fieldId: string, rec: PracticeResultRecord): PracticeSaveResult {
        const s = this.storage;
        if (!s) return { ok: false, reason: 'unavailable', message: saveFailureMessage('unavailable') };
        let raw: string | null;
        try {
            raw = s.getItem(this.key);
        } catch {
            return { ok: false, reason: 'unavailable', message: saveFailureMessage('unavailable') };
        }
        let base: PracticeSaveData = { version: PRACTICE_SAVE_VERSION, records: {} };
        let movedBroken = false;
        if (raw !== null) {
            const parsed = parsePracticeData(raw);
            if (parsed) base = parsed;
            else {
                // 壊れている：上書きせず、まず控えへ写す（写せなければ何も書かない）
                if (writeVerified(s, this.brokenKey, raw) !== null) return { ok: false, reason: 'backup', message: BACKUP_FAILED_MESSAGE };
                movedBroken = true;
            }
        }
        const prev = base.records[fieldId];
        const isBest = !prev || isBetterRecord(rec, prev.best);
        const record: PracticeFieldRecord = { plays: (prev?.plays ?? 0) + 1, last: rec, best: isBest ? rec : prev!.best };
        const data: PracticeSaveData = { version: PRACTICE_SAVE_VERSION, records: { ...base.records, [fieldId]: record } };
        const json = JSON.stringify(data);
        const w = writeVerified(s, this.key, json);
        if (w) return { ok: false, reason: w, message: saveFailureMessage(w) };
        // 読み戻した物を読み直して、この戦場の記録が入っていることまで確かめる
        let back: PracticeSaveData | null = null;
        try {
            const b = s.getItem(this.key);
            back = b === null ? null : parsePracticeData(b);
        } catch {
            back = null;
        }
        if (!back || JSON.stringify(back.records[fieldId]) !== JSON.stringify(record)) return { ok: false, reason: 'verify', message: saveFailureMessage('verify') };
        return { ok: true, data: back, record, isBest, movedBroken };
    }
}

// ================= 画面に出す中身 =================

/** 一覧の戦場 1 つ分 */
export interface PracticeFieldCard {
    id: string;
    name: string;
    summary: string;
    primary: string;
    secondary: string[];
    plays: number;
    /** 最後・最高の記録の短い文（無ければ null） */
    last: string | null;
    best: string | null;
}
export interface PracticeListInfo {
    note: string;
    fields: PracticeFieldCard[];
    /** 記録を読めないときの説明 */
    problem: string | null;
}
export type PracticeListAction = `field:${string}` | 'back';

/** 説明の編成の 1 行 */
export interface PracticeUnitLine {
    id: string;
    name: string;
    kind: string;
    strength: number;
    /** 率いる武将の名前（いなければ null） */
    general: string | null;
    /** 固有能力の名前（仮の能力は provisional） */
    ability: { name: string; provisional: boolean } | null;
    /** 援軍・遅れて着く部隊（開始から何秒で着くか） */
    arriveAt: number | null;
}
export interface PracticeBriefingInfo {
    id: string;
    name: string;
    note: string;
    summary: string;
    /** 地形・状況の要点（戦場のデータの briefing） */
    terrain: string[];
    primary: string;
    secondary: string[];
    /** 特殊ルール・戦場の決まり（無ければ空） */
    rules: string[];
    /** 日没までの時間（例：8:00） */
    timeLimit: string;
    allies: PracticeUnitLine[];
    /** 敵の要約（例：敵勢 7 部隊・兵 2900） */
    enemies: string;
}
export interface PracticeResultInfo {
    fieldId: string;
    name: string;
    note: string;
    result: BattleResultKind;
    resultLabel: string;
    reason: BattleEndReason;
    /** 終わり方の文（合戦の画面と同じ演習の言葉） */
    reasonText: string;
    primary: { label: string; achieved: boolean };
    secondary: { label: string; achieved: boolean }[];
    elapsed: string;
    /** 記録の保存の結果 */
    saved: { ok: boolean; text: string };
    /** 最高の記録を更新したか */
    isBest: boolean;
    best: string | null;
}

/** 記録の短い文（例：勝利・主目標 ○・副目標 1/1・4:32） */
export function recordSummary(r: PracticeResultRecord): string {
    const secDone = r.secondary.filter((s) => s.achieved).length;
    const sec = r.secondary.length ? `・副目標 ${secDone}/${r.secondary.length}` : '';
    return `${RESULT_LABEL[r.result]}・主目標 ${r.primary.achieved ? '達成' : '未達成'}${sec}・${fmtClock(r.elapsedSec)}`;
}

export function practiceListInfo(load: PracticeLoad): PracticeListInfo {
    const records = load.status === 'ok' ? load.data.records : {};
    return {
        note: PRACTICE_NOTE,
        problem: load.status === 'corrupt' || load.status === 'unavailable' ? load.message : null,
        fields: practiceFields().map((f) => {
            const r = records[f.id];
            return {
                id: f.id,
                name: f.name,
                summary: f.summary,
                primary: f.objectives.primary.label,
                secondary: f.objectives.secondary.map((o) => o.label),
                plays: r?.plays ?? 0,
                last: r ? `${recordSummary(r.last)}（${formatSavedTime(r.last.at)}）` : null,
                best: r ? recordSummary(r.best) : null,
            };
        }),
    };
}

/** 演習の合戦の設定（どの戦場も編成 'standard'・戦場の目標） */
export function practiceSetup(field: BattlefieldDef): BattleSetup {
    return buildBattleSetup(field, PRACTICE_PRESET);
}

export function practiceBriefingInfo(field: BattlefieldDef): PracticeBriefingInfo {
    const setup = practiceSetup(field);
    // 特殊ルールの文は、合戦の画面と同じ関数で作る（合戦の状態を 1 つ作って読むだけ。進めない）
    const rules = fieldRuleTexts(createBattle(setup));
    const allies: PracticeUnitLine[] = setup.units
        .filter((u) => u.side === 'ally')
        .map((u) => {
            const ab = resolveAbilityId(u);
            const g = u.generalId ? generalById(u.generalId) : undefined;
            return {
                id: u.id,
                name: u.name,
                kind: KIND_SHORT[u.kind],
                strength: Math.round(u.strength),
                general: g?.name ?? null,
                ability: ab ? { name: abilityDisplayName(ab).replace(/（仮）$/, ''), provisional: !!ABILITY_DATA[ab].provisional } : null,
                arriveAt: u.arriveAt && u.arriveAt > 0 ? u.arriveAt : null,
            };
        });
    const enemies = setup.units.filter((u) => u.side === 'enemy');
    const enemyMen = enemies.reduce((a, u) => a + Math.round(u.strength), 0);
    const late = enemies.filter((u) => u.arriveAt && u.arriveAt > 0).length;
    return {
        id: field.id,
        name: field.name,
        note: PRACTICE_NOTE,
        summary: field.summary,
        terrain: [...field.briefing],
        primary: field.objectives.primary.label,
        secondary: field.objectives.secondary.map((o) => o.label),
        rules,
        timeLimit: fmtClock(setup.timeLimitSec),
        allies,
        enemies: `敵勢（架空の相手）${enemies.length} 部隊・兵 ${enemyMen}${late ? `（うち ${late} 部隊は後から来る）` : ''}`,
    };
}

// ================= 画面の流れ =================

/** 画面（ui/practiceView.ts）。待つものは Promise で結果を返す */
export interface PracticeView {
    practiceList(info: PracticeListInfo): Promise<PracticeListAction>;
    practiceBriefing(info: PracticeBriefingInfo): Promise<'go' | 'back'>;
    /** 合戦の画面を読み込めなかった・始められなかった */
    practiceLoadFailed(message: string): Promise<'retry' | 'back'>;
    practiceResult(info: PracticeResultInfo): Promise<void>;
    /** 合戦の画面の読み込みを待っている間の表示（true で出し、false で消す） */
    practiceLoading(on: boolean): void;
}

export type PracticeRunner = (setup: BattleSetup, hooks?: BattleRunHooks) => Promise<BattleOutcome>;

export interface PracticeDeps {
    view: PracticeView;
    store: PracticeRecordStore;
    /** 合戦の画面（読み込みを待つ。読み込めなければ null か例外） */
    battleRunner: () => Promise<PracticeRunner | null>;
    now?: () => Date;
}

export type PracticeScreen = 'closed' | 'list' | 'briefing' | 'battle' | 'result';

/** 演習の画面の流れ（一覧 → 説明 → 合戦 → 結果 → 一覧。一覧の「戻る」で終わる） */
export class PracticeMode {
    private _screen: PracticeScreen = 'closed';
    private _fieldId: string | null = null;
    /** 確認用：最後の合戦の結果と保存の結果 */
    lastOutcome: BattleOutcome | null = null;
    lastSave: PracticeSaveResult | null = null;
    private readonly now: () => Date;

    constructor(private readonly deps: PracticeDeps) {
        this.now = deps.now ?? (() => new Date());
    }

    get screen(): PracticeScreen {
        return this._screen;
    }
    /** 選んでいる戦場（一覧では null） */
    get fieldId(): string | null {
        return this._fieldId;
    }

    /** 一覧から始めて、「戻る」で終わる */
    async run(): Promise<void> {
        const { view } = this.deps;
        try {
            for (;;) {
                this._screen = 'list';
                this._fieldId = null;
                const act = await view.practiceList(practiceListInfo(this.deps.store.load()));
                if (act === 'back') return;
                const id = act.slice('field:'.length);
                const field = practiceFields().find((f) => f.id === id);
                if (!field) continue;
                this._fieldId = id;
                this._screen = 'briefing';
                if ((await view.practiceBriefing(practiceBriefingInfo(field))) !== 'go') continue;
                await this.fight(field);
            }
        } finally {
            this._screen = 'closed';
            this._fieldId = null;
        }
    }

    /** 合戦を 1 回 → 記録を保存 → 結果の画面 */
    private async fight(field: BattlefieldDef): Promise<void> {
        const { view } = this.deps;
        let saved: PracticeSaveResult | null = null;
        let decided: BattleOutcome | null = null;
        /** 勝ち負けが決まった：1 回だけ記録を保存する（合戦の結果の画面に、保存の結果を出す） */
        const record = (o: BattleOutcome): PracticeSaveResult => {
            if (saved) return saved;
            decided = o;
            saved = this.deps.store.record(field.id, recordFromOutcome(o, field.objectives.primary.id, this.now()));
            this.lastSave = saved;
            return saved;
        };
        let outcome: BattleOutcome | null = null;
        while (!outcome) {
            this._screen = 'battle';
            try {
                let runner: PracticeRunner | null;
                view.practiceLoading(true);
                try {
                    runner = await this.deps.battleRunner();
                } finally {
                    view.practiceLoading(false);
                }
                if (!runner) throw new Error('合戦の画面を読み込めませんでした。');
                outcome = await runner(practiceSetup(field), { onDecided: (o) => savedNote(record(o)) });
            } catch (e) {
                // 記録した後の失敗（結果の画面の後片付けなど）なら、やり直さずに結果へ
                if (decided) {
                    outcome = decided;
                    break;
                }
                const c = await view.practiceLoadFailed(e instanceof Error ? e.message : String(e));
                if (c === 'back') return;
            }
        }
        // 合戦の画面が勝ち負けの知らせを送らなかったときも、ここで 1 回だけ保存する
        const r = record(outcome);
        this.lastOutcome = outcome;
        this._screen = 'result';
        await view.practiceResult(practiceResultInfo(field, outcome, r));
    }
}

function savedNote(r: PracticeSaveResult): { ok: boolean; text: string } {
    return r.ok
        ? { ok: true, text: `演習の記録を保存しました（書き込んだ内容を読み戻して確かめました）。${r.movedBroken ? '読み込めなかった前の記録は控えへ移しました。' : ''}` }
        : { ok: false, text: `演習の記録を保存できませんでした：${r.message}` };
}

export function practiceResultInfo(field: BattlefieldDef, o: BattleOutcome, r: PracticeSaveResult): PracticeResultInfo {
    const rec = recordFromOutcome(o, field.objectives.primary.id, new Date(0));
    const texts = scenarioTexts(createBattle(practiceSetup(field)));
    return {
        fieldId: field.id,
        name: field.name,
        note: PRACTICE_NOTE,
        result: o.result,
        resultLabel: RESULT_LABEL[o.result],
        reason: o.reason,
        reasonText: texts.reasons[o.reason] ?? '',
        primary: {
            // 段階目標で全部の段に届かなかったときは、どの段まで届いたかを添える（例：「…（段階 1／2 まで）」）
            label: (o.objectives?.primary?.label ?? field.objectives.primary.label) + (rec.primary.steps && rec.primary.steps.done < rec.primary.steps.total ? `（段階 ${rec.primary.steps.done}／${rec.primary.steps.total} まで）` : ''),
            achieved: rec.primary.achieved,
        },
        secondary: (o.objectives?.secondary ?? []).map((s) => ({ label: s.label, achieved: s.achieved })),
        elapsed: fmtClock(o.elapsedSec),
        saved: savedNote(r),
        isBest: r.ok && r.isBest,
        best: r.ok ? recordSummary(r.record.best) : null,
    };
}

/** 演習の戦場か（一覧に出る 5 つ） */
export function isPracticeField(id: string): boolean {
    return !!getField(id) && practiceFields().some((f) => f.id === id);
}
