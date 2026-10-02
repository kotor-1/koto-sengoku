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
 *
 * 第3群で足した種類（docs/fields-group3-design.md §3）：
 * - hold_zones：すべての区域を同時に確保して sec 秒（どれか外れると 0 に戻る）。
 * - limit_breakthrough：敵の戦える部隊が出口へ届いた数（部隊単位）を maxCount 以内に抑える。届いた部隊は戦場を抜けて離れる（撤退済み）。
 * - open_gate：門を制圧して開く（数えるのは sim.ts の trackGates。ここは門が開いたかを見るだけ）。
 * - sequence：段階目標。今の段だけを数え、果たしたら次の段へ（次の段の時間は、その段が始まった時から数える）。
 * sim.ts を実行時に import しない（sim.ts がこのファイルを import するため）。
 */
import type { BattleEndReason, BattleResultKind, BattleSetup, ObjectiveDef, ObjectiveResult, Side, Zone } from './types';
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
    /** defend_zones：区域ごとの、敵だけが区域にいる秒数と、失ったか（ほかの目標では空） */
    zoneSec: number[];
    zoneLost: boolean[];
    /** breakthrough：区域に入った味方の部隊 id */
    entered: string[];
    /** survive_until：援軍が着いた時刻 */
    arrivedT: number | null;
    /** done・failed になった時刻 */
    settledT: number | null;
    /** 数え始めた時刻（ふつうは 0。段階目標の段は、その段が始まった時刻。defend_time・limit_breakthrough の時間はここから数える） */
    startT: number;
    /** 段階目標（sequence）の段（ほかの目標では空）と、今の段の番号 */
    steps: ObjectiveRun[];
    stepIdx: number;
    /** 段階目標の段なら、その段階目標 */
    parent: ObjectiveRun | null;
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

/** defend_zones：まだ失っていない区域の数 */
function heldCount(r: ObjectiveRun): number {
    return r.zoneLost.filter((x) => !x).length;
}
/** defend_zones の区域の短い名前（names を省けば「守る地点 1」など） */
export function zoneName(d: Extract<ObjectiveDef, { type: 'defend_zones' }>, i: number): string {
    return d.names?.[i] ?? `守る地点 ${i + 1}`;
}

/** 区域の中に、戦える味方・敵がいるか */
function zoneHolders(s: BattleState, zone: Zone): { allyIn: boolean; enemyIn: boolean } {
    return {
        allyIn: s.units.some((u) => u.side === 'ally' && active(u) && inZone(zone, u.x, u.z)),
        enemyIn: s.units.some((u) => u.side === 'enemy' && active(u) && inZone(zone, u.x, u.z)),
    };
}

// ---------------------------------------------------------------- 作る

/** 合戦の始めに作る（目標の無い合戦は null）。目標の指す部隊・援軍が無い、部隊の陣営が違う（救出・部隊を残すは味方、崩すは敵）なら投げる */
export function createObjectiveTrack(setup: BattleSetup): ObjectiveTrack | null {
    const o = setup.objectives;
    if (!o) return null;
    const ids = new Set(setup.units.map((u) => u.id));
    const sideOf = new Map(setup.units.map((u) => [u.id, u.side]));
    const seen = new Set<string>();
    const mk = (def: ObjectiveDef, role: ObjectiveRole): ObjectiveRun => {
        if (seen.has(def.id)) throw new Error(`目標の id が重なっています: ${def.id}`);
        seen.add(def.id);
        if ('unitId' in def && !ids.has(def.unitId)) throw new Error(`目標 ${def.id} の部隊がありません: ${def.unitId}`);
        const want = def.type === 'break_unit' ? 'enemy' : def.type === 'rescue' || def.type === 'preserve_unit' ? 'ally' : null;
        if (want && 'unitId' in def && sideOf.get(def.unitId) !== want) throw new Error(`目標 ${def.id}（${def.type}）の部隊 ${def.unitId} は ${want} の部隊ではありません`);
        if (def.type === 'survive_until' && !setup.reinforcements?.some((r) => r.id === def.reinforcementId)) {
            throw new Error(`目標 ${def.id} の援軍がありません: ${def.reinforcementId}`);
        }
        const n = def.type === 'defend_zones' ? def.zones.length : 0;
        if (def.type === 'defend_zones' && !(Number.isInteger(def.minHeld) && def.minHeld >= 1 && def.minHeld <= n)) {
            throw new Error(`目標 ${def.id} の minHeld は 1 以上・区域の数（${n}）以下の整数にしてください`);
        }
        if (def.type === 'open_gate' && !setup.fieldRules?.gates?.some((g) => g.id === def.gateId)) throw new Error(`目標 ${def.id} の門がありません: ${def.gateId}`);
        if (def.type === 'sequence' && def.steps.length === 0) throw new Error(`目標 ${def.id} の段階がありません`);
        if (def.type === 'hold_zones' && def.zones.length === 0) throw new Error(`目標 ${def.id} の区域がありません`);
        if (def.type === 'limit_breakthrough' && def.exits.length === 0) throw new Error(`目標 ${def.id} の出口がありません`);
        const run: ObjectiveRun = {
            def,
            role,
            state: 'active',
            sec: 0,
            zoneSec: new Array<number>(n).fill(0),
            zoneLost: new Array<boolean>(n).fill(false),
            entered: [],
            arrivedT: null,
            settledT: null,
            startT: 0,
            steps: [],
            stepIdx: 0,
            parent: null,
        };
        if (def.type === 'sequence') {
            run.steps = def.steps.map((d) => mk(d, role));
            for (const st of run.steps) st.parent = run;
        }
        return run;
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
    // 段階目標の段：「主目標「…」の段階 1「外門の制圧」を果たした」
    const p = r.parent;
    const name = p ? `${head}「${p.def.label}」の段階 ${p.steps.indexOf(r) + 1}「${r.def.label}」` : `${head}「${r.def.label}」`;
    log(state === 'done' ? `${name}を果たした` : `${name}は果たせなくなった`);
}

/** 部隊が limit_breakthrough の出口を抜けた（段階目標の段も見る。突破を抑える目標の無い合戦ではいつも false） */
function brokeThrough(s: BattleState, id: string): boolean {
    const tr = s.objectives;
    if (!tr) return false;
    const look = (r: ObjectiveRun): boolean => (r.def.type === 'limit_breakthrough' && r.entered.includes(id)) || r.steps.some(look);
    return tr.list.some(look);
}

/** limit_breakthrough の攻め手（aiRole 'assault' の敵。いなければ本陣以外の敵） */
function breakthroughAttackers(s: BattleState): UnitState[] {
    const es = s.units.filter((u) => u.side === 'enemy');
    const assault = es.filter((u) => u.aiRole === 'assault');
    return assault.length ? assault : es.filter((u) => !u.isHq);
}

/** limit_breakthrough の締めの時刻（untilSec を省けば日没） */
function breakthroughUntil(s: BattleState, r: ObjectiveRun): number {
    const d = r.def as Extract<ObjectiveDef, { type: 'limit_breakthrough' }>;
    return d.untilSec !== undefined ? r.startT + d.untilSec : s.timeLimitSec;
}

/** 門（第3群。fieldRules.gates）の今の状態 */
function gateOf(s: BattleState, id: string) {
    return s.field.gates.find((g) => g.def.id === id);
}

/** 区域が「敵がいない状態で味方が占めている」か */
function heldByAlly(s: BattleState, z: Zone): boolean {
    const { allyIn, enemyIn } = zoneHolders(s, z);
    return allyIn && !enemyIn;
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
            const { allyIn, enemyIn } = zoneHolders(s, d.zone);
            r.sec = allyIn && !enemyIn ? r.sec + dt : 0;
            if (r.sec >= d.sec - 1e-9) settle(s, r, 'done', log);
            return;
        }
        case 'defend_time': {
            const t = s.t - r.startT;
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
        case 'defend_zones': {
            const lose = d.loseSec ?? 10;
            d.zones.forEach((z, i) => {
                if (r.zoneLost[i]) return;
                const { allyIn, enemyIn } = zoneHolders(s, z);
                r.zoneSec[i] = enemyIn && !allyIn ? r.zoneSec[i]! + dt : 0;
                if (r.zoneSec[i]! >= lose - 1e-9) {
                    r.zoneLost[i] = true;
                    log(`${r.role === 'primary' ? '主目標' : '副目標'}「${r.def.label}」：${zoneName(d, i)}を失った`);
                }
            });
            if (heldCount(r) < d.minHeld) return settle(s, r, 'failed', log);
            if (t - r.startT >= d.sec - 1e-9) settle(s, r, 'done', log);
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
            // 出口を抜けた（limit_breakthrough で撤退済みにした）敵は、崩したことにしない。もう崩せないので果たせない
            if (u && brokeThrough(s, u.id)) return settle(s, r, 'failed', log);
            if (u && u.arrived && u.status !== 'ready') settle(s, r, 'done', log);
            else if (u && u.status === 'destroyed') settle(s, r, 'done', log);
            return;
        }
        case 'hold_zones': {
            r.sec = d.zones.every((z) => heldByAlly(s, z)) ? r.sec + dt : 0;
            if (r.sec >= d.sec - 1e-9) settle(s, r, 'done', log);
            return;
        }
        case 'limit_breakthrough': {
            // 敵の戦える部隊が出口に入った：部隊単位で数え、その部隊は戦場を抜けて離れる（撤退済み。兵の人数では数えない）
            for (const u of s.units) {
                if (u.side !== 'enemy' || !active(u) || r.entered.includes(u.id)) continue;
                const k = d.exits.findIndex((z) => inZone(z, u.x, u.z));
                if (k < 0) continue;
                r.entered.push(u.id);
                u.status = 'withdrawn';
                u.present = false;
                u.engagedWith = null;
                u.shootingAt = null;
                const where = d.names?.[k] ?? '出口';
                log(`${u.name}が${where}を抜けた（突破 ${r.entered.length}／許容 ${d.maxCount}）`);
            }
            if (r.entered.length > d.maxCount) return settle(s, r, 'failed', log);
            if (s.t >= breakthroughUntil(s, r) - 1e-9) return settle(s, r, 'done', log);
            // 攻め手が、すべて抜けたか戦えなくなった（まだ着いていない攻め手は残っている）
            if (!breakthroughAttackers(s).some((u) => u.status === 'ready' && !r.entered.includes(u.id))) settle(s, r, 'done', log);
            return;
        }
        case 'open_gate': {
            if (gateOf(s, d.gateId)?.open) settle(s, r, 'done', log);
            return;
        }
        case 'sequence': {
            const cur = r.steps[r.stepIdx];
            if (!cur) return;
            update(s, cur, dt, log);
            if (cur.state === 'failed') return settle(s, r, 'failed', log);
            if (cur.state !== 'done') return;
            r.stepIdx++;
            const next = r.steps[r.stepIdx];
            if (!next) return settle(s, r, 'done', log);
            next.startT = s.t;
            // 次の段がもう満たされている（門を開いた刻みに、門の目標がもう果たされているなど）なら、同じ刻みに確かめる
            update(s, next, 0, log);
            if (next.state === 'done' || next.state === 'failed') update(s, r, 0, log);
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
        case 'defend_zones':
            // 勝って終えて、まだ minHeld 個以上を守っている（足りなくなった時点で failed になっている）
            return result === 'victory' && heldCount(r) >= d.minHeld;
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
        case 'limit_breakthrough':
            // 撤退で終えたら果たせない。そうでなければ、許容の数を超えずに終えた
            return reason !== 'ordered_retreat' && r.entered.length <= d.maxCount;
        default:
            return false;
    }
}

/** 段階目標の、果たした段の数 */
function stepsDone(r: ObjectiveRun): number {
    return r.steps.filter((x) => x.state === 'done').length;
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
        const out: ObjectiveResult = { id: r.def.id, type: r.def.type, label: r.def.label, achieved };
        // 段階目標は、どの段まで届いたか（果たした段の数）も記録する
        if (r.def.type === 'sequence') out.steps = { done: stepsDone(r), total: r.steps.length };
        return out;
    };
    const out: { primary?: ObjectiveResult; secondary: ObjectiveResult[] } = { secondary: [] };
    if (tr.primary) out.primary = row(tr.primary);
    out.secondary = tr.secondary.map(row);
    return out;
}

// ---------------------------------------------------------------- 画面向け

/** 区域ごとの ○（敵のいない区域に味方がいる）・敵（敵がいる）・空（味方がいない） */
function zoneMark(s: BattleState, z: Zone): string {
    const { allyIn, enemyIn } = zoneHolders(s, z);
    return enemyIn ? '敵' : allyIn ? '○' : '空';
}

/** 門の制圧の進みの文（例：「外門 制圧 5／20 秒・門の前に敵がいる」） */
export function gateProgressText(s: BattleState, id: string): string {
    const g = gateOf(s, id);
    if (!g) return '';
    if (g.open) return `${g.def.name}：開いた（通れる）`;
    const head = `${g.def.name} 制圧 ${Math.floor(g.sec)}／${g.def.capture.sec} 秒`;
    const taker = g.holder === 'enemy' ? 'ally' : 'enemy';
    const z = g.def.capture.zone;
    const holderIn = s.units.some((u) => u.side === g.holder && active(u) && inZone(z, u.x, u.z));
    const takerIn = s.units.some((u) => u.side === taker && active(u) && inZone(z, u.x, u.z));
    if (holderIn) return `${head}・門の前に敵がいる（追い出すと数え始める）`;
    if (!takerIn) return `${head}・門の前に味方がいない（門の前の輪へ移動させる）`;
    return `${head}（門の前の輪を、敵のいない間に味方が占めて数える）`;
}

function progressText(s: BattleState, r: ObjectiveRun): string {
    const d = r.def;
    if (r.state === 'done') return '達成';
    if (r.state === 'failed') return '未達成';
    switch (d.type) {
        case 'destroy_hq': {
            const e = hq(s, 'enemy');
            return e ? `${e.name}を崩す` : '敵をすべて崩す';
        }
        case 'hold_point': {
            // 数えていないときは、なぜ数えていないか（区域に敵がいる・味方がいない）を出す（畳んだ見出しでも読めるよう括弧の外に）
            const head = `確保 ${Math.floor(r.sec)}／${d.sec} 秒`;
            const { allyIn, enemyIn } = zoneHolders(s, d.zone);
            if (enemyIn) return `${head}・区域に敵がいる（敵を追い出すと数え始める）`;
            if (!allyIn) return `${head}・区域に味方がいない（輪の中へ移動させる）`;
            return `${head}（敵のいない区域に味方がいる間だけ数える）`;
        }
        case 'defend_time':
            return `残り ${Math.max(0, Math.ceil(r.startT + d.sec - s.t))} 秒` + (d.zone && r.sec > 0 ? `（区域を敵に奪われている：${Math.floor(r.sec)}／${d.loseSec ?? 10} 秒）` : '');
        case 'defend_zones': {
            // 例：「守っている 3／3（2 以上で残り 120 秒）・西の口 ○・中の口 ○・東の口 ✕（中の口を敵に奪われている：4／10 秒）」
            const marks = d.zones.map((_, i) => `${zoneName(d, i)} ${r.zoneLost[i] ? '✕' : '○'}`).join('・');
            const taking = d.zones
                .map((_, i) => i)
                .filter((i) => !r.zoneLost[i] && r.zoneSec[i]! > 0)
                .map((i) => `${zoneName(d, i)}を敵に奪われている：${Math.floor(r.zoneSec[i]!)}／${d.loseSec ?? 10} 秒`);
            return `守っている ${heldCount(r)}／${d.zones.length}（${d.minHeld} 以上で残り ${Math.max(0, Math.ceil(r.startT + d.sec - s.t))} 秒）・${marks}` + (taking.length ? `（${taking.join('・')}）` : '');
        }
        case 'rescue': {
            const u = byId(s, d.unitId);
            // 輪の真ん中に味方の部隊が立っていることがある（押すとその部隊が選び直される）ので、空いた所を押すよう添える
            return u ? `${u.name}を輪の中まで連れ帰る（輪の中の空いた地面を押す）` : '救出';
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
        case 'hold_zones': {
            // 例：「同時確保 12／60 秒・山門 ○・本堂前 敵」（どれか外れると 0 に戻る）
            const marks = d.zones.map((z, i) => `${d.names?.[i] ?? `地点 ${i + 1}`} ${zoneMark(s, z)}`).join('・');
            return `同時確保 ${Math.floor(r.sec)}／${d.sec} 秒・${marks}（すべてを敵なしで味方が占める間だけ数える）`;
        }
        case 'limit_breakthrough': {
            // 例：「突破 1／許容 2（あと 1）・残り 120 秒」
            const left = d.maxCount - r.entered.length;
            return `突破 ${r.entered.length}／許容 ${d.maxCount}（あと ${left}）・残り ${Math.max(0, Math.ceil(breakthroughUntil(s, r) - s.t))} 秒`;
        }
        case 'open_gate':
            return gateProgressText(s, d.gateId);
        case 'sequence': {
            // 例：「段階 1／2：外門の制圧・外門 制圧 5／20 秒（次：最初の曲輪の確保）」
            const cur = r.steps[r.stepIdx];
            if (!cur) return '';
            const next = r.steps[r.stepIdx + 1];
            return `段階 ${r.stepIdx + 1}／${r.steps.length}：${cur.def.label}・${progressText(s, cur)}` + (next ? `（次：${next.def.label}）` : '（最後の段）');
        }
    }
}

/** 目標ごとの見通し（主目標 → 副目標の順。目標の無い合戦は空の並び） */
export function objectiveProgress(s: BattleState): ObjectiveProgress[] {
    const tr = s.objectives;
    if (!tr) return [];
    return tr.list.map((r) => ({ id: r.def.id, label: r.def.label, role: r.role, state: r.state, progressText: progressText(s, r) }));
}

/** まだ果たしていない（active の）目標の、味方が入る区域（地点の確保・区域の防衛・突破・救出の陣）。sim.ts の動きが使う */
export function activeObjectiveZones(s: BattleState): Zone[] {
    const tr = s.objectives;
    if (!tr) return [];
    const out: Zone[] = [];
    for (const r of tr.list) {
        if (r.state !== 'active') continue;
        pushActiveZones(s, r, out);
    }
    return out;
}

function pushActiveZones(s: BattleState, r: ObjectiveRun, out: Zone[]): void {
    const d = r.def;
    if (d.type === 'hold_point' || d.type === 'breakthrough' || d.type === 'rescue') out.push(d.zone);
    else if (d.type === 'defend_time' && d.zone) out.push(d.zone);
    else if (d.type === 'defend_zones') d.zones.forEach((z, i) => !r.zoneLost[i] && out.push(z));
    else if (d.type === 'hold_zones') out.push(...d.zones);
    else if (d.type === 'open_gate') {
        const g = gateOf(s, d.gateId);
        if (g && !g.open) out.push(g.def.capture.zone);
    } else if (d.type === 'sequence') {
        const cur = r.steps[r.stepIdx];
        if (cur && cur.state === 'active') pushActiveZones(s, cur, out);
    }
}

/** 主目標の状態（主目標の無い合戦は null） */
export function primaryState(s: BattleState): ObjectiveState | null {
    return s.objectives?.primary?.state ?? null;
}

/** 目標の時刻の丸め（記録用） */
export function settledAt(r: ObjectiveRun): number | null {
    return r.settledT === null ? null : r1(r.settledT);
}
