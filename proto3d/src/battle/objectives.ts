/**
 * 合戦の目標（主目標・副目標）の判定。純粋な TypeScript（three・DOM なし）。設計：docs/battlefields-design.md §4。
 *
 * - BattleSetup.objectives があるときだけ動く（無い合戦＝国境の原・歴史分岐の章は、何もしないで今までどおり）。
 * - sim.ts が毎刻み trackObjectives を呼び、確保の秒数・突破した部隊などを数えて、各目標を active（まだ）／done（果たした）／
 *   failed（もう果たせない）にする。主目標の done・failed で勝ち負けが決まる（sim.ts の decide）。副目標は勝ち負けに影響しない。
 * - 合戦の終わりに finalObjectives が各目標の達成を決め、BattleOutcome.objectives に入れる（約束 pledge とは別の欄）。
 * - 画面は objectiveProgress(s) で、目標ごとの { id, label, role, state, progressText } の一覧を読む。
 *
 * 目標の種類を足すときは：types.ts の ObjectiveDef に型を 1 つ足し、このファイルの update・finalAchieved・progressText に分岐を足す。
 * sim.ts を実行時に import しない（sim.ts がこのファイルを import するため）。
 */
import type { BattleEndReason, BattleResultKind, BattleSetup, ObjectiveDef, ObjectiveResult, Side } from './types';
import type { BattleState, UnitState } from './sim';
import { inZone } from './fieldRules';

export type ObjectiveRole = 'primary' | 'secondary';
export type ObjectiveState = 'active' | 'done' | 'failed';

/** 合戦中の目標 1 つの見張り */
export interface ObjectiveRun {
    def: ObjectiveDef;
    role: ObjectiveRole;
    state: ObjectiveState;
    /** hold_point：敵のいない区域に味方が続けている秒数／defend_time（区域）：敵だけが区域にいる秒数 */
    sec: number;
    /** breakthrough：区域に入った味方の部隊 id */
    entered: string[];
    /** survive_until：援軍が着いた時刻 */
    arrivedT: number | null;
    /** done・failed になった時刻 */
    settledT: number | null;
}

export interface ObjectiveTrack {
    primary: ObjectiveRun | null;
    secondary: ObjectiveRun[];
    /** primary → secondary の順 */
    list: ObjectiveRun[];
}

/** 画面向けの見通し */
export interface ObjectiveProgress {
    id: string;
    label: string;
    role: ObjectiveRole;
    state: ObjectiveState;
    /** 例：「確保 23／60 秒」「残り 120 秒」「救出を待つ」 */
    progressText: string;
}

// ---- 小さな道具（sim.ts を実行時に import しないため） ----
function byId(s: BattleState, id: string): UnitState | undefined {
    return s.units.find((u) => u.id === id);
}
function active(u: UnitState | undefined): u is UnitState {
    return !!u && u.present && u.status === 'ready';
}
function broken(u: UnitState): boolean {
    return u.status === 'routed' || u.status === 'destroyed';
}
function hq(s: BattleState, side: Side): UnitState | undefined {
    return s.units.find((u) => u.side === side && u.isHq);
}
function r1(v: number): number {
    return Math.round(v * 10) / 10;
}
function allyStart(s: BattleState): number {
    return s.units.filter((u) => u.side === 'ally').reduce((a, u) => a + u.startStrength, 0);
}
function allyNow(s: BattleState): number {
    return s.units.filter((u) => u.side === 'ally').reduce((a, u) => a + u.strength, 0);
}
/** 味方の兵の損害の割合（0〜1） */
export function allyLossRatio(s: BattleState): number {
    const st = allyStart(s);
    return st > 0 ? 1 - allyNow(s) / st : 0;
}
/** 撤退で戦場を離れた味方の兵の割合（最初の兵に対して） */
function withdrawnRatio(s: BattleState): number {
    const st = allyStart(s);
    const w = s.units.filter((u) => u.side === 'ally' && u.status === 'withdrawn').reduce((a, u) => a + u.strength, 0);
    return st > 0 ? w / st : 0;
}
/** 敵の部隊（まだ着いていない部隊も）がすべて戦えない */
function enemyAllBroken(s: BattleState): boolean {
    const es = s.units.filter((u) => u.side === 'enemy');
    return es.length > 0 && !es.some((u) => u.status === 'ready');
}
function reinforcementUnits(s: BattleState, rid: string): UnitState[] {
    const r = s.setup.reinforcements?.find((x) => x.id === rid);
    return r ? r.unitIds.map((id) => byId(s, id)).filter((u): u is UnitState => !!u) : [];
}

// ---------------------------------------------------------------- 作る

/** 合戦の始めに作る（目標の無い合戦は null）。目標の指す部隊・援軍が無ければ投げる */
export function createObjectiveTrack(setup: BattleSetup): ObjectiveTrack | null {
    const o = setup.objectives;
    if (!o) return null;
    const ids = new Set(setup.units.map((u) => u.id));
    const seen = new Set<string>();
    const mk = (def: ObjectiveDef, role: ObjectiveRole): ObjectiveRun => {
        if (seen.has(def.id)) throw new Error(`目標の id が重なっています: ${def.id}`);
        seen.add(def.id);
        if ('unitId' in def && !ids.has(def.unitId)) throw new Error(`目標 ${def.id} の部隊がありません: ${def.unitId}`);
        if (def.type === 'survive_until' && !setup.reinforcements?.some((r) => r.id === def.reinforcementId)) {
            throw new Error(`目標 ${def.id} の援軍がありません: ${def.reinforcementId}`);
        }
        return { def, role, state: 'active', sec: 0, entered: [], arrivedT: null, settledT: null };
    };
    const primary = o.primary ? mk(o.primary, 'primary') : null;
    const secondary = (o.secondary ?? []).map((d) => mk(d, 'secondary'));
    return { primary, secondary, list: primary ? [primary, ...secondary] : secondary };
}

// ---------------------------------------------------------------- 毎刻み

function settle(s: BattleState, r: ObjectiveRun, state: 'done' | 'failed', log: (text: string) => void): void {
    if (r.state !== 'active') return;
    r.state = state;
    r.settledT = s.t;
    const head = r.role === 'primary' ? '主目標' : '副目標';
    log(state === 'done' ? `${head}「${r.def.label}」を果たした` : `${head}「${r.def.label}」は果たせなくなった`);
}

/** 1 つの目標を進める（毎刻み。done・failed になった目標は動かない） */
function update(s: BattleState, r: ObjectiveRun, dt: number, log: (text: string) => void): void {
    if (r.state !== 'active') return;
    const d = r.def;
    const t = s.t;
    switch (d.type) {
        case 'destroy_hq': {
            const e = hq(s, 'enemy');
            if (e ? e.status !== 'ready' : enemyAllBroken(s)) settle(s, r, 'done', log);
            return;
        }
        case 'hold_point': {
            const allyIn = s.units.some((u) => u.side === 'ally' && active(u) && inZone(d.zone, u.x, u.z));
            const enemyIn = s.units.some((u) => u.side === 'enemy' && active(u) && inZone(d.zone, u.x, u.z));
            r.sec = allyIn && !enemyIn ? r.sec + dt : 0;
            if (r.sec >= d.sec - 1e-9) settle(s, r, 'done', log);
            return;
        }
        case 'defend_time': {
            if (d.zone) {
                const allyIn = s.units.some((u) => u.side === 'ally' && active(u) && inZone(d.zone!, u.x, u.z));
                const enemyIn = s.units.some((u) => u.side === 'enemy' && active(u) && inZone(d.zone!, u.x, u.z));
                r.sec = enemyIn && !allyIn ? r.sec + dt : 0;
                if (r.sec >= (d.loseSec ?? 10) - 1e-9) return settle(s, r, 'failed', log);
            } else {
                const a = hq(s, 'ally');
                if (a && a.status !== 'ready') return settle(s, r, 'failed', log);
            }
            if (t >= d.sec - 1e-9) settle(s, r, 'done', log);
            return;
        }
        case 'rescue': {
            const u = byId(s, d.unitId);
            if (!u) return;
            if (broken(u)) return settle(s, r, 'failed', log);
            if (u.status === 'withdrawn' || (active(u) && inZone(d.zone, u.x, u.z))) settle(s, r, 'done', log);
            return;
        }
        case 'breakthrough': {
            for (const u of s.units) {
                if (u.side !== 'ally' || !active(u) || r.entered.includes(u.id)) continue;
                if (inZone(d.zone, u.x, u.z)) r.entered.push(u.id);
            }
            if (r.entered.length >= d.count) return settle(s, r, 'done', log);
            const left = s.units.filter((u) => u.side === 'ally' && u.status === 'ready' && !r.entered.includes(u.id)).length;
            if (r.entered.length + left < d.count) settle(s, r, 'failed', log);
            return;
        }
        case 'retreat_success': {
            const a = hq(s, 'ally');
            if (a && broken(a)) return settle(s, r, 'failed', log);
            // まだ退ける兵（戦場にいる・着いていない・もう離れた）が足りなければ、もう果たせない
            const st = allyStart(s);
            const can = s.units.filter((u) => u.side === 'ally' && (u.status === 'ready' || u.status === 'withdrawn')).reduce((x, u) => x + u.strength, 0);
            if (st > 0 && can / st < d.minRatio - 1e-9) return settle(s, r, 'failed', log);
            if (a && a.status === 'withdrawn' && withdrawnRatio(s) >= d.minRatio - 1e-9) settle(s, r, 'done', log);
            return;
        }
        case 'survive_until': {
            if (r.arrivedT === null && reinforcementUnits(s, d.reinforcementId).some((u) => u.arrived)) r.arrivedT = t;
            if (r.arrivedT !== null && t - r.arrivedT >= (d.holdSec ?? 0) - 1e-9) settle(s, r, 'done', log);
            return;
        }
        case 'preserve_unit': {
            const u = byId(s, d.unitId);
            if (!u) return;
            if (broken(u) || (u.startStrength > 0 && u.strength / u.startStrength < d.minRatio - 1e-9)) settle(s, r, 'failed', log);
            return;
        }
        case 'limit_losses':
            if (allyLossRatio(s) > d.maxRatio + 1e-9) settle(s, r, 'failed', log);
            return;
        case 'break_unit': {
            const u = byId(s, d.unitId);
            if (u && u.arrived && u.status !== 'ready') settle(s, r, 'done', log);
            else if (u && u.status === 'destroyed') settle(s, r, 'done', log);
            return;
        }
    }
}

/** 1 つの目標だけを今の状態で確かめ直す（時間は進めない。sim.ts が撤退で兵を離し切った後に使う） */
export function refreshObjective(s: BattleState, r: ObjectiveRun, log: (text: string) => void): void {
    update(s, r, 0, log);
}

/** 毎刻み（sim.ts の tick が、退き口の確かめの後・勝ち負けの前に呼ぶ） */
export function trackObjectives(s: BattleState, dt: number, log: (text: string) => void): void {
    const tr = s.objectives;
    if (!tr) return;
    for (const r of tr.list) update(s, r, dt, log);
}

// ---------------------------------------------------------------- 終わり

/**
 * 損害を抑える・部隊を残す目標（preserve_unit・limit_losses）は、戦い抜いて（勝利・敗北・日没で）終えたときだけ果たせる。
 * 全軍撤退（ordered_retreat）で終えたときは、戦わずに退いても「果たした」と読めてしまうので、果たせなかったことにする。
 */
function needsFoughtThrough(d: ObjectiveDef): boolean {
    return d.type === 'preserve_unit' || d.type === 'limit_losses';
}

/** 終わりに：その目標を果たしたか */
function finalAchieved(s: BattleState, r: ObjectiveRun, result: BattleResultKind, reason?: BattleEndReason): boolean {
    // 主目標は勝敗と同じ（勝利＝果たした）
    if (r.role === 'primary') return result === 'victory';
    if (r.state === 'done') return true;
    if (r.state === 'failed') return false;
    const d = r.def;
    if (reason === 'ordered_retreat' && needsFoughtThrough(d)) return false;
    switch (d.type) {
        case 'defend_time':
            // 勝って終えたなら、守り切った
            return result === 'victory';
        case 'retreat_success': {
            const a = hq(s, 'ally');
            return !!a && a.status === 'withdrawn' && withdrawnRatio(s) >= d.minRatio - 1e-9;
        }
        case 'preserve_unit': {
            const u = byId(s, d.unitId);
            return !!u && !broken(u) && (u.startStrength <= 0 || u.strength / u.startStrength >= d.minRatio - 1e-9);
        }
        case 'limit_losses':
            return allyLossRatio(s) <= d.maxRatio + 1e-9;
        default:
            return false;
    }
}

/** BattleOutcome.objectives を作る（目標の無い合戦は undefined）。終わりの状態も done／failed に決める */
export function finalObjectives(
    s: BattleState,
    result: BattleResultKind,
    reason?: BattleEndReason,
): { primary?: ObjectiveResult; secondary: ObjectiveResult[] } | undefined {
    const tr = s.objectives;
    if (!tr) return undefined;
    const row = (r: ObjectiveRun): ObjectiveResult => {
        const achieved = finalAchieved(s, r, result, reason);
        r.state = achieved ? 'done' : 'failed';
        if (r.settledT === null) r.settledT = s.t;
        return { id: r.def.id, type: r.def.type, label: r.def.label, achieved };
    };
    const out: { primary?: ObjectiveResult; secondary: ObjectiveResult[] } = { secondary: [] };
    if (tr.primary) out.primary = row(tr.primary);
    out.secondary = tr.secondary.map(row);
    return out;
}

// ---------------------------------------------------------------- 画面向け

function progressText(s: BattleState, r: ObjectiveRun): string {
    const d = r.def;
    if (r.state === 'done') return '達成';
    if (r.state === 'failed') return '未達成';
    switch (d.type) {
        case 'destroy_hq': {
            const e = hq(s, 'enemy');
            return e ? `${e.name}を崩す` : '敵をすべて崩す';
        }
        case 'hold_point':
            return `確保 ${Math.floor(r.sec)}／${d.sec} 秒（敵のいない区域に味方がいる間だけ数える）`;
        case 'defend_time':
            return `残り ${Math.max(0, Math.ceil(d.sec - s.t))} 秒` + (d.zone && r.sec > 0 ? `（区域を敵に奪われている：${Math.floor(r.sec)}／${d.loseSec ?? 10} 秒）` : '');
        case 'rescue': {
            const u = byId(s, d.unitId);
            return u ? `${u.name}を味方の陣まで連れ帰る` : '救出';
        }
        case 'breakthrough':
            return `突破 ${r.entered.length}／${d.count} 部隊`;
        case 'retreat_success':
            return `退いた兵 ${Math.round(withdrawnRatio(s) * 100)}％（${Math.round(d.minRatio * 100)}％ 以上と本陣が退く）`;
        case 'survive_until': {
            const us = reinforcementUnits(s, d.reinforcementId);
            const at = us.length ? Math.min(...us.map((u) => u.arriveAt)) : 0;
            if (r.arrivedT === null) return `援軍の到着まで ${Math.max(0, Math.ceil(at - s.t))} 秒`;
            return `援軍が着いた。あと ${Math.max(0, Math.ceil(r.arrivedT + (d.holdSec ?? 0) - s.t))} 秒`;
        }
        case 'preserve_unit': {
            const u = byId(s, d.unitId);
            return u ? `${u.name}：兵 ${Math.round(u.startStrength > 0 ? (u.strength / u.startStrength) * 100 : 0)}％（${Math.round(d.minRatio * 100)}％ 以上で終える・撤退は不可）` : '';
        }
        case 'limit_losses':
            return `損害 ${Math.round(allyLossRatio(s) * 100)}％（${Math.round(d.maxRatio * 100)}％ 以内で終える・撤退は不可）`;
        case 'break_unit': {
            const u = byId(s, d.unitId);
            return u ? `${u.name}を崩す` : '';
        }
    }
}

/** 目標ごとの見通し（主目標 → 副目標の順。目標の無い合戦は空の並び） */
export function objectiveProgress(s: BattleState): ObjectiveProgress[] {
    const tr = s.objectives;
    if (!tr) return [];
    return tr.list.map((r) => ({ id: r.def.id, label: r.def.label, role: r.role, state: r.state, progressText: progressText(s, r) }));
}

/** 主目標の状態（主目標の無い合戦は null） */
export function primaryState(s: BattleState): ObjectiveState | null {
    return s.objectives?.primary?.state ?? null;
}

/** 目標の時刻の丸め（記録用） */
export function settledAt(r: ObjectiveRun): number | null {
    return r.settledT === null ? null : r1(r.settledT);
}
