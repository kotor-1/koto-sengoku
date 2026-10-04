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
 * 第4群で足した種類（docs/fields-group4-design.md §3）：
 * - escape・withdraw：味方の戦える部隊が出口（退き口）の区域に入ると、その部隊は戦場を離れて撤退済みになり、数える（撤退の命令で、区域の中の
 *   退き口から離れた部隊も数える）。総大将と、ほかの count 部隊が離れたら果たす。総大将が出口から離れても合戦は続く（本陣の喪失ではない）。
 * - rescue_escort：合流（対象とほかの味方が合流区域に一緒に meetSec 秒）→ 対象が安全区域に戦える状態で入る（兵は minRatio 以上）。
 * 終わり方の判定の順（BattleSetup.endRules）の説明の文（endRuleItems・endRuleBriefingLine・endRuleConditions）と、退いて終わった合戦の区別（withdrawalKind）もここに置く。
 * sim.ts を実行時に import しない（sim.ts がこのファイルを import するため）。
 */
import type { BattleEndReason, BattleOutcome, BattleResultKind, BattleSetup, EndRuleKind, ObjectiveDef, ObjectiveResult, Side, Zone } from './types';
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
    /** rescue_escort：合流した時刻（まだなら null。合流を数えている秒数は sec） */
    metT: number | null;
}

export interface ObjectiveTrack {
    primary: ObjectiveRun | null;
    secondary: ObjectiveRun[];
    /** primary → secondary の順 */
    list: ObjectiveRun[];
    /** 敵の部隊がすべて崩れても主目標を自分で果たすまで続く合戦（sim.ts の needsOwnDeed）で、そのことを知らせた時刻 */
    armyBrokenT?: number;
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
/**
 * 画面向け：区域の中に、味方から見えている（発見済みの）戦える敵がいるか。進みの文・地図の輪の脈打ち・目標の欄は、未発見の敵を数えない
 * （夜・林の中の敵の位置が、表示から漏れないように。第4群の夜襲の確かめ。判定＝zoneHolders は変えない）
 */
export function seenEnemyIn(s: BattleState, zone: Zone): boolean {
    return s.units.some((u) => u.side === 'enemy' && active(u) && u.seenBy.ally && inZone(zone, u.x, u.z));
}
/** 画面向け：区域の中に、味方から見えている戦える部隊がいるか（味方はいつも見えている） */
function seenIn(s: BattleState, side: Side, zone: Zone): boolean {
    return side === 'ally' ? s.units.some((u) => u.side === 'ally' && active(u) && inZone(zone, u.x, u.z)) : seenEnemyIn(s, zone);
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
        const want = def.type === 'break_unit' ? 'enemy' : def.type === 'rescue' || def.type === 'preserve_unit' || def.type === 'rescue_escort' ? 'ally' : null;
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
        if (def.type === 'escape' && def.exits.length === 0) throw new Error(`目標 ${def.id} の出口がありません`);
        if ((def.type === 'escape' || def.type === 'withdraw') && !(Number.isInteger(def.count) && def.count >= 0)) throw new Error(`目標 ${def.id} の count は 0 以上の整数にしてください`);
        if ((def.type === 'escape' || def.type === 'withdraw') && !setup.units.some((u) => u.side === 'ally' && u.kind === 'honjin')) throw new Error(`目標 ${def.id} の総大将（味方の本陣）がありません`);
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
            metT: null,
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

function settle(s: BattleState, r: ObjectiveRun, state: 'done' | 'failed', log: ObjectiveLog, unitId?: string): void {
    if (r.state !== 'active') return;
    r.state = state;
    r.settledT = s.t;
    const head = r.role === 'primary' ? '主目標' : '副目標';
    // 段階目標の段：「主目標「…」の段階 1「外門の制圧」を果たした」
    const p = r.parent;
    const name = p ? `${head}「${p.def.label}」の段階 ${p.steps.indexOf(r) + 1}「${r.def.label}」` : `${head}「${r.def.label}」`;
    log(state === 'done' ? `${name}を果たした` : `${name}は果たせなくなった`, unitId);
}

/**
 * 目標の知らせを出す関数。unitId はその知らせの元の部隊（夜に、味方から見えていない敵の部隊の知らせは sim.ts の markUnseen が画面に出さない）
 */
export type ObjectiveLog = (text: string, unitId?: string) => void;

/**
 * 夜（第4群の確かめの指摘）：敵の部隊を崩す目標（break_unit）を果たしたが、味方はまだその崩れを知らない（味方の陣営が知っているその部隊の様子
 * intel.status が戦える 'ready' のまま＝見つけていない所で崩れた）。画面の目標の欄・進みの文では、まだ果たしていない形で出す（判定は変えない。
 * 結果の表は終わった後の本当の結果）
 */
function unknownBreakAtNight(s: BattleState, r: ObjectiveRun): boolean {
    if (!s.setup.night || r.def.type !== 'break_unit' || r.state !== 'done') return false;
    const u = byId(s, r.def.unitId);
    return !!u && u.side === 'enemy' && u.intel.status === 'ready';
}

/** 敵の部隊を崩す目標の進みの文（「〇〇を崩す」） */
function breakUnitText(s: BattleState, d: Extract<ObjectiveDef, { type: 'break_unit' }>): string {
    const u = byId(s, d.unitId);
    // 夜：一度も見つけていない敵は名前を出さない（未発見の敵の情報を漏らさない。見出しの label は戦場の文のまま。判定は変えない）
    if (u && s.setup.night && u.side === 'enemy' && u.intel.t < 0) return 'まだ見つけていない';
    return u ? `${u.name}を崩す` : '';
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
function update(s: BattleState, r: ObjectiveRun, dt: number, log: ObjectiveLog): void {
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
            // 知らせはその部隊の出来事にする（夜に見つけていない所で崩れたときは、知らせを画面に出さない＝sim.ts の markUnseen）
            if (u && u.arrived && u.status !== 'ready') settle(s, r, 'done', log, u.id);
            else if (u && u.status === 'destroyed') settle(s, r, 'done', log, u.id);
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
        case 'escape':
        case 'withdraw':
            return updateLeave(s, r, log);
        case 'rescue_escort': {
            const u = byId(s, d.unitId);
            if (!u) return;
            if (broken(u)) return settle(s, r, 'failed', log);
            // 安全区域へ届く前に戦場を離れた（撤退の命令など）：もう連れ帰れない
            if (u.status === 'withdrawn') return settle(s, r, 'failed', log);
            if (u.startStrength > 0 && u.strength / u.startStrength < d.minRatio - 1e-9) return settle(s, r, 'failed', log);
            if (r.metT === null) {
                // 合流：対象とほかの味方が、合流区域に一緒にいる秒数（離れると 0 に戻る。触れただけでは合流にならない）
                const together = active(u) && inZone(d.meetZone, u.x, u.z) && s.units.some((o) => o !== u && o.side === 'ally' && active(o) && inZone(d.meetZone, o.x, o.z));
                r.sec = together ? r.sec + dt : 0;
                if (r.sec >= (d.meetSec ?? 5) - 1e-9) {
                    r.metT = t;
                    log(`${r.role === 'primary' ? '主目標' : '副目標'}「${r.def.label}」：${u.name}と合流した。安全地点（輪）まで連れ帰る`);
                }
                return;
            }
            if (active(u) && inZone(d.safeZone, u.x, u.z)) settle(s, r, 'done', log);
            return;
        }
    }
}

/** escape・withdraw の出口（区域の並び） */
export function leaveExits(d: ObjectiveDef): Zone[] {
    if (d.type === 'escape') return d.exits;
    if (d.type === 'withdraw') return [d.exit];
    return [];
}
/** escape・withdraw の出口 k の名前 */
function leaveExitName(d: ObjectiveDef, k: number): string {
    if (d.type === 'escape') return d.names?.[k] ?? '出口';
    if (d.type === 'withdraw') return d.name ?? '退き口';
    return '出口';
}
/** escape・withdraw：離れた部隊のうち総大将でないものの数 */
function leftOthers(s: BattleState, r: ObjectiveRun): number {
    const h = hq(s, 'ally');
    return r.entered.filter((id) => id !== h?.id).length;
}

/**
 * 脱出・離脱（escape・withdraw）：出口（退き口）の区域に入った味方の戦える部隊は、戦場を離れて撤退済みになり、数える。撤退の命令で
 * 区域の中の退き口から離れた部隊（sim.ts が先に撤退済みにする）も数える。総大将とほかの count 部隊が離れたら果たす。
 * 総大将が崩れた・目標に数えない所から退いた、または離れられる部隊が足りなくなれば果たせない
 */
function updateLeave(s: BattleState, r: ObjectiveRun, log: ObjectiveLog): void {
    const d = r.def as Extract<ObjectiveDef, { type: 'escape' | 'withdraw' }>;
    const exits = leaveExits(d);
    const h = hq(s, 'ally');
    const verb = d.type === 'escape' ? '脱出した' : '離脱した';
    for (const u of s.units) {
        if (u.side !== 'ally' || r.entered.includes(u.id)) continue;
        const k = exits.findIndex((z) => inZone(z, u.x, u.z));
        if (k < 0) continue;
        if (u.present && u.status === 'ready') {
            // 出口に入った：その部隊は戦場を離れる（撤退済み。兵は残る）
            u.status = 'withdrawn';
            u.present = false;
            u.engagedWith = null;
            u.shootingAt = null;
        } else if (!(u.status === 'withdrawn' && !u.present)) continue;
        r.entered.push(u.id);
        const n = leftOthers(s, r);
        const hqOut = !!h && r.entered.includes(h.id);
        log(`${u.name}が${leaveExitName(d, k)}から${verb}（総大将 ${hqOut ? '済み' : 'まだ'}・ほか ${Math.min(n, d.count)}／${d.count} 部隊）`);
    }
    if (h && broken(h)) return settle(s, r, 'failed', log);
    if (h && h.status === 'withdrawn' && !r.entered.includes(h.id)) return settle(s, r, 'failed', log);
    const others = leftOthers(s, r);
    if ((!h || r.entered.includes(h.id)) && others >= d.count) return settle(s, r, 'done', log);
    const can = s.units.filter((u) => u.side === 'ally' && u !== h && u.status === 'ready' && !r.entered.includes(u.id)).length;
    if (others + can < d.count) settle(s, r, 'failed', log);
}

/** 1 つの目標だけを今の状態で確かめ直す（時間は進めない。sim.ts が撤退で兵を離し切った後に使う） */
export function refreshObjective(s: BattleState, r: ObjectiveRun, log: ObjectiveLog): void {
    update(s, r, 0, log);
}

/** 毎刻み（sim.ts の tick が、退き口の確かめの後・勝ち負けの前に呼ぶ） */
export function trackObjectives(s: BattleState, dt: number, log: ObjectiveLog): void {
    const tr = s.objectives;
    if (!tr) return;
    for (const r of tr.list) update(s, r, dt, log);
}

// ---------------------------------------------------------------- 終わり

/**
 * 損害を抑える・部隊を残す目標（preserve_unit・limit_losses）は、戦い抜いて（勝利・敗北・日没で）終えたときだけ果たせる。
 * 全軍撤退（ordered_retreat）で終えたときは、戦わずに退いても「果たした」と読めてしまうので、果たせなかったことにする。
 * 損害を抑える目標（limit_losses）は、さらに負けて終えたときも果たせない（finalAchieved。早く負けると損害が少なく済んでしまうため）。
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
            // 負けて終えたら果たせない（第4群の確かめの指摘：早く負けると損害が少なくて「果たした」になっていた）。
            // 全軍撤退で終えたときも果たせない（上の needsFoughtThrough。損害 0 で退いても達成にしない）。勝利・日没で終えて損害が上限以内なら果たす
            return result !== 'defeat' && allyLossRatio(s) <= d.maxRatio + 1e-9;
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
        // 脱出・離脱は、出口から離れた部隊の数（総大将を含む）も記録する（日没・放棄で終えたときに、どこまで届いたか）。
        // 総大将（離れたら 1）＋ほかの部隊（目標の count まで）。count より多く離れても total（count＋1）を超えない
        if (r.def.type === 'escape' || r.def.type === 'withdraw') {
            const h = hq(s, 'ally');
            const hqOut = !!h && r.entered.includes(h.id) ? 1 : 0;
            out.count = { done: hqOut + Math.min(leftOthers(s, r), r.def.count), total: r.def.count + 1 };
        }
        if (r.def.type === 'rescue_escort') out.met = r.metT !== null;
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
    const { allyIn } = zoneHolders(s, z);
    return seenEnemyIn(s, z) ? '敵' : allyIn ? '○' : '空';
}

/** 門の制圧の進みの文（例：「外門 制圧 5／20 秒・門の前に敵がいる」） */
export function gateProgressText(s: BattleState, id: string): string {
    const g = gateOf(s, id);
    if (!g) return '';
    if (g.open) return `${g.def.name}：開いた（通れる）`;
    const head = `${g.def.name} 制圧 ${Math.floor(g.sec)}／${g.def.capture.sec} 秒`;
    const taker = g.holder === 'enemy' ? 'ally' : 'enemy';
    const z = g.def.capture.zone;
    // 未発見の敵は数えない（表示だけ。判定は sim.ts の門の制圧）
    const holderIn = seenIn(s, g.holder, z);
    const takerIn = seenIn(s, taker, z);
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
            // 未発見の敵（夜・林の中）は数えない（表示だけ。判定は zoneHolders のまま）
            const { allyIn } = zoneHolders(s, d.zone);
            if (seenEnemyIn(s, d.zone)) return `${head}・区域に敵がいる（敵を追い出すと数え始める）`;
            if (!allyIn) return `${head}・区域に味方がいない（輪の中へ移動させる）`;
            return `${head}（敵のいない区域に味方がいる間だけ数える）`;
        }
        case 'defend_time':
            // 奪われている秒は、見えている敵が区域にいる間だけ出す（未発見の敵の位置を漏らさない）
            return `残り ${Math.max(0, Math.ceil(r.startT + d.sec - s.t))} 秒` + (d.zone && r.sec > 0 && seenEnemyIn(s, d.zone) ? `（区域を敵に奪われている：${Math.floor(r.sec)}／${d.loseSec ?? 10} 秒）` : '');
        case 'defend_zones': {
            // 例：「守っている 3／3（2 以上で残り 120 秒）・西の口 ○・中の口 ○・東の口 ✕（中の口を敵に奪われている：4／10 秒）」
            const marks = d.zones.map((_, i) => `${zoneName(d, i)} ${r.zoneLost[i] ? '✕' : '○'}`).join('・');
            const taking = d.zones
                .map((_, i) => i)
                .filter((i) => !r.zoneLost[i] && r.zoneSec[i]! > 0 && seenEnemyIn(s, d.zones[i]!))
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
            return `損害 ${Math.round(allyLossRatio(s) * 100)}％（${Math.round(d.maxRatio * 100)}％ 以内で終える・撤退・敗北は不可）`;
        case 'break_unit':
            return breakUnitText(s, d);
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
        case 'escape':
        case 'withdraw': {
            // 例：「総大将 まだ・ほか 1／3 部隊が脱出（出口の輪に入った部隊は戦場を離れる）」
            const h = hq(s, 'ally');
            const hqOut = !!h && r.entered.includes(h.id);
            const verb = d.type === 'escape' ? '脱出' : '離脱';
            return `総大将 ${hqOut ? '済み' : 'まだ'}・ほか ${Math.min(leftOthers(s, r), d.count)}／${d.count} 部隊が${verb}（${d.type === 'escape' ? '出口' : '退き口'}の輪に入った部隊は戦場を離れる）`;
        }
        case 'rescue_escort': {
            const u = byId(s, d.unitId);
            if (!u) return '';
            const ratio = `兵 ${Math.round(u.startStrength > 0 ? (u.strength / u.startStrength) * 100 : 0)}％／${Math.round(d.minRatio * 100)}％ 以上`;
            if (r.metT === null) return `合流 ${Math.floor(r.sec)}／${d.meetSec ?? 5} 秒・${ratio}（合流の輪に${u.name}とほかの味方が一緒にいる間だけ数える。安全地点はその後）`;
            return `合流した・${u.name}を安全地点へ・${ratio}（安全地点の輪に入れば果たす）`;
        }
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
    return tr.list.map((r) => {
        // 夜に、見つけていない所で崩れた敵の break_unit は、まだ果たしていない形で出す（unknownBreakAtNight）
        if (unknownBreakAtNight(s, r)) return { id: r.def.id, label: r.def.label, role: r.role, state: 'active' as const, progressText: breakUnitText(s, r.def as Extract<ObjectiveDef, { type: 'break_unit' }>) };
        return { id: r.def.id, label: r.def.label, role: r.role, state: r.state, progressText: progressText(s, r) };
    });
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
    else if (d.type === 'escape' || d.type === 'withdraw') out.push(...leaveExits(d));
    else if (d.type === 'rescue_escort') out.push(r.metT === null ? d.meetZone : d.safeZone);
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

// ---------------------------------------------------------------- 終わり方の判定の順（第4群。BattleSetup.endRules）

/** 時間切れの呼び名（夜の合戦はデータの NightRule.deadlineName。省けば「日没」） */
export function deadlineName(setup: BattleSetup): string {
    return setup.night?.deadlineName ?? '日没';
}
/** 時間切れで終わったときの文（夜の合戦はデータの NightRule.deadlineEndText。省けば日没の文） */
export function deadlineEndText(setup: BattleSetup): string {
    return setup.night?.deadlineEndText ?? '日が暮れ、両軍とも兵を引いた';
}

/** 終わり方の判定の順の既定（設計 docs/fields-group4-design.md §3 の順） */
export const DEFAULT_END_ORDER: readonly EndRuleKind[] = ['objective_done', 'objective_failed', 'hq_lost', 'army_broken', 'nightfall', 'all_retreat'];

/** 主目標が脱出・離脱（出口から離れて果たす目標）か */
export function isLeaveObjective(d: ObjectiveDef | undefined): boolean {
    return !!d && (d.type === 'escape' || d.type === 'withdraw');
}

/** 主目標が果たせなくなる時の短い説明（種類ごと） */
function failWhy(d: ObjectiveDef, setup?: BattleSetup): string {
    switch (d.type) {
        case 'escape':
        case 'withdraw':
            return `総大将が崩れる・総大将が${d.type === 'escape' ? '出口' : '退き口'}でない所から退く・離れられる部隊が足りなくなる`;
        case 'rescue_escort':
            return `救出の対象が崩れる・安全地点の前に撤退する・兵が ${Math.round(d.minRatio * 100)}％ を切る`;
        case 'defend_zones':
            return `守る地点が ${d.minHeld} か所より少なくなる`;
        case 'hold_point':
        case 'hold_zones':
            return `確保の目標は途中で失敗にならず、${setup ? deadlineName(setup) : '日没'}まで続く`;
        default:
            return '目標の条件が満たせなくなる';
    }
}

/** 判定の 1 つの説明の文 */
function endRuleText(k: EndRuleKind, setup: BattleSetup): string {
    const p = setup.objectives?.primary;
    const leave = isLeaveObjective(p);
    const allRetreat = setup.endRules?.allRetreat ?? 'end';
    switch (k) {
        case 'objective_done':
            return p ? `主目標「${p.label}」を果たす → 勝利${leave ? '（目標を果たした撤収）' : ''}` : '主目標を果たす → 勝利';
        case 'objective_failed':
            return `主目標が果たせなくなる → 敗北（${p ? failWhy(p, setup) : '目標の条件が満たせなくなる'}）`;
        case 'hq_lost':
            // 本陣が目標に数えない所から退いた（撤退の命令で退き口から離れた）ときは、合戦の放棄（撤退）。脱出・離脱の戦場では、出口でない所から
            // 総大将が退くと主目標が果たせなくなる（その判定が先なら敗北）
            return leave
                ? `味方の本陣が崩れる → 敗北。総大将が出口から離れるのは脱出で、本陣の喪失ではない（合戦は続く）。出口でない所から本陣が退く → 撤退（合戦の放棄。ただし主目標の失敗の判定が先なら敗北）`
                : '味方の本陣が崩れる → 敗北。本陣が退き口から退く → 撤退（合戦の放棄）';
        case 'army_broken':
            return '味方の部隊がすべて戦えない → 敗北（戦場を離れた部隊の方が多ければ、合戦の放棄＝撤退）';
        case 'nightfall':
            return `${deadlineName(setup)}（${Math.floor(setup.timeLimitSec / 60)}:${String(Math.floor(setup.timeLimitSec % 60)).padStart(2, '0')}）→ 撤退（主目標は未達成。どこまで届いたかを記録する）`;
        case 'all_retreat':
            return allRetreat === 'count'
                ? `全軍撤退 → 退き口から離れた部隊も主目標に数え、味方が戦場からいなくなるまで打ち切らない（要る数が離れれば勝利の撤収。途中で崩れる部隊が出て要る数に届かなくなれば、主目標の失敗＝敗北）`
                : p?.type === 'rescue_escort'
                  ? '全軍撤退 → まもなく打ち切り、撤退（合戦の放棄）。ただし打ち切りの前に救出の対象が安全地点の外で戦場を離れる・崩れると、主目標の失敗＝敗北'
                  : '全軍撤退 → まもなく打ち切り、撤退（合戦の放棄）';
    }
}

/** 終わり方の判定の順の項目（先に見るものから。endRules の無い合戦は空） */
export function endRuleItems(setup: BattleSetup): string[] {
    const er = setup.endRules;
    if (!er) return [];
    return er.order.map((k) => endRuleText(k, setup));
}

/** 合戦の前の説明に足す 1 行（endRules の無い合戦は null） */
export function endRuleBriefingLine(setup: BattleSetup): string | null {
    const items = endRuleItems(setup);
    if (!items.length) return null;
    const mark = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
    return `勝ち負けの判定の順（先に当てはまったもので決まる）：${items.map((t, i) => `${mark[i] ?? `${i + 1}.`} ${t}`).join('　')}`;
}

/** 合戦の画面の上の「勝ち負けの条件」（endRules のある合戦。control.ts の conditionsFor が使う） */
export function endRuleConditions(s: BattleState): { label: string; text: string; tone: 'good' | 'bad' | 'info' }[] {
    const setup = s.setup;
    const p = setup.objectives?.primary;
    const leave = isLeaveObjective(p);
    const short: Record<EndRuleKind, string> = {
        objective_done: '主目標の達成',
        objective_failed: '主目標の失敗',
        hq_lost: '本陣の崩れ',
        army_broken: '諸隊が戦えない',
        nightfall: deadlineName(setup),
        all_retreat: '全軍撤退',
    };
    return [
        { label: '勝利', text: p ? `主目標「${p.label}」を果たす${leave ? '（総大将が出口から離れるのは脱出。負けではない）' : ''}` : '主目標を果たす', tone: 'good' },
        { label: '敗北', text: `主目標が果たせない（${p ? failWhy(p, setup) : ''}）／味方本陣が崩れる／味方の部隊がすべて戦えない`, tone: 'bad' },
        {
            label: '撤退',
            text:
                setup.endRules?.allRetreat === 'count'
                    ? `${deadlineName(setup)}／全軍撤退（退き口から離れた部隊も目標に数える。要る数に届かなくなれば敗北）`
                    : `${deadlineName(setup)}／全軍撤退（合戦の放棄）／本陣が${leave ? '出口でない所から' : '退き口から'}退く`,
            tone: 'info',
        },
        { label: '判定の順', text: (setup.endRules?.order ?? DEFAULT_END_ORDER).map((k) => short[k]).join(' → '), tone: 'info' },
    ];
}

/**
 * 退いて終わった合戦の区別（endRules のある合戦だけ。BattleOutcome.withdrawal）：主目標（脱出・離脱）を果たした撤収＝'objective'、
 * 主目標の前に全軍撤退・本陣の撤退・諸隊の撤退で終えた＝'abandoned'。ほかは undefined
 */
export function withdrawalKind(setup: BattleSetup, result: BattleResultKind, reason: BattleEndReason): BattleOutcome['withdrawal'] {
    if (!setup.endRules) return undefined;
    if (result === 'victory' && reason === 'objective_done' && isLeaveObjective(setup.objectives?.primary)) return 'objective';
    if (reason === 'ordered_retreat') return 'abandoned';
    return undefined;
}

/** 結果の画面に添える、退いて終わった合戦の区別の文（区別の無い結果は空） */
export function withdrawalNote(o: Pick<BattleOutcome, 'withdrawal'>): string {
    if (o.withdrawal === 'objective') return '目標を果たした撤収（脱出・離脱で勝利。合戦の放棄ではない）';
    if (o.withdrawal === 'abandoned') return '主目標を果たす前に兵を退いた（合戦の放棄。撤退）';
    return '';
}
