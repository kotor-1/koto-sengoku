/**
 * 合戦のルール（部隊単位の指揮）。純粋な TypeScript（three・DOM なし）。乱数なし・決まった刻み（RULES.tick 秒）で進める。
 * 同じ設定・同じ時刻に同じ命令を出せば、必ず同じ結果になる。
 *
 * 使い方（画面・章の進行から）：
 *   const s = createBattle(setup);
 *   issueOrder(s, 'a_genzo', { type: 'attack', targetId: 'e_sente' });   // 命令（一時停止中でもよい）
 *   const events = stepBattle(s, dt);                                    // 毎フレーム（一時停止中は呼ばない）
 *   const r = outcome(s);                                                // 終わったら BattleOutcome、まだなら null
 *
 * 計算の決まり（docs/chapter1-spec.md §4）：
 * - 近接（間合い 25 m）で互いに損害を与える。弓は 120 m から射る（近接では弱い）。
 * - 損害を大きくするもの：兵力、種類の相性、側面 ×1.6・背後 ×2.2（相手の向きと当たる向きで決める）、士気、騎馬の突撃。
 * - 損害を小さくするもの：丘の上の守り（下から正面に来る相手に ×0.7。側面・背後から回り込まれると効かない）、
 *   林の中の相手への弓 ×0.6、防衛・待機 ×0.85。
 * - 士気：損害の割合・側面や背後を突かれる・囲まれる・近くの味方の敗走・自軍の本陣の敗走で下がる。本陣の近く（80 m）では下がり方が和らぐ。
 *   交戦していない間は少し戻る。15 以下で敗走（命令を聞かず退き口へ）。兵 0 で全滅。退き口に着いた撤退部隊は「撤退済み」。
 * - 林の中の部隊は、相手の部隊が 60 m 以内に来るまで相手から見えない（seenBy）。
 * - 向き：待機中は向きを保つ（周りを見回して向き直ったりしない）。斬り合いの最中はゆっくり（4°/秒）しか向き直れない。
 *   そのため、正面で組み合っている相手の側面・背後へ別の部隊を当てると効く。
 */
import type {
    BattleEndReason,
    BattleMap,
    BattleOutcome,
    BattleResultKind,
    BattleSetup,
    ClanId,
    Order,
    Side,
    TerrainKind,
    UnitDef,
    UnitKind,
    UnitStatus,
} from './types';
import { createAiState, thinkEnemy, type AiState } from './ai';

/** ルールの数値（画面の説明・テストからも読む） */
export const RULES = {
    /** 1 刻みの秒数 */
    tick: 0.1,
    /** 近接の間合い（部隊の中心どうしの距離、m） */
    meleeRange: 25,
    /** 一度組み合った相手とは、間合い + 6 m まで斬り合いを続ける（離れたり近づいたりで交戦が細切れにならないように） */
    meleeHold: 6,
    /** 弓の届く距離（m）。bowFullRange までは減衰なし、そこから 120 m で 0.6 倍まで下がる */
    bowRange: 120,
    bowFullRange: 80,
    /** 弓隊が攻撃の命令で近づくときに止まる距離 */
    bowStandoff: 105,
    /** 林の中の部隊が相手から見えるようになる距離 */
    woodsSight: 60,
    /** 本陣が士気を支える半径 */
    hqAura: 80,
    /** この士気以下で敗走 */
    routMorale: 15,
    /** 近接の損害（兵 1 人・1 秒あたり、力 1・士気 100 のとき） */
    meleeRate: 0.012,
    /** 弓の損害（弓兵 1 人・1 秒あたり） */
    rangedRate: 0.006,
    flankMul: 1.6,
    rearMul: 2.2,
    /** 正面とみなす角度（相手の向きから ±50°）、背後とみなす角度（±130° より外） */
    frontArcDeg: 50,
    rearArcDeg: 130,
    /** 丘の守り（下から正面に来る相手の損害 ×0.7。高さの差 2 m 以上） */
    hillMul: 0.7,
    hillDiff: 2,
    woodsArcheryMul: 0.6,
    holdMul: 0.85,
    /** 湿地の中で戦うと、与える損害 ×0.8・受ける損害 ×1.15 */
    marshDealMul: 0.8,
    marshTakeMul: 1.15,
    /** 騎馬の突撃（交戦の始めの 6 秒、損害 ×1.5。槍の正面へは効かない） */
    chargeMul: 1.5,
    chargeSec: 6,
    /** 敗走して逃げる相手への追い討ち */
    pursuitMul: 1.5,
    /** 損害による士気の低下（失った兵の割合 × この値）。矢による損害は rangedMoraleMul 倍 */
    moralePerLoss: 110,
    rangedMoraleMul: 0.6,
    /** 側面・背後を突かれた瞬間の士気の低下 */
    flankShock: 8,
    rearShock: 14,
    /** 側面・背後を突かれ続けている間の士気の低下（毎秒） */
    flankPressure: 0.8,
    rearPressure: 1.6,
    /** 2 部隊以上から斬りかかられている間の士気の低下（毎秒） */
    outnumberedPressure: 0.6,
    /** 近く（120 m）の味方の敗走・自軍の本陣の敗走 */
    nearbyRoutShock: 8,
    nearbyRoutRadius: 120,
    hqRoutShock: 30,
    /** 本陣の近くでは士気の低下 ×0.75 */
    hqAuraMul: 0.75,
    /** 交戦から 5 秒離れると士気が戻る（毎秒。本陣の近くはさらに +0.6） */
    recoverDelay: 5,
    recoverRate: 1.0,
    recoverHqBonus: 0.6,
    /** 斬り合いの最中の向き直り（度/秒） */
    meleeTurnDeg: 4,
    /** 本陣が斬り合いに巻き込まれている間の、本陣の士気の低下（毎秒。大将の身が危うい） */
    hqUnderAttack: 0.6,
    /** 全軍撤退の命令から、戦場を離れ切るまで待つ最長の秒数 */
    retreatGraceSec: 20,
    /** 味方どうしが重ならない距離 */
    spacing: 18,
} as const;

/** 種類ごとの性質 */
export const KIND_STATS: Record<UnitKind, { speed: number; power: number; defence: number; turnDeg: number; label: string }> = {
    honjin: { speed: 3, power: 1.1, defence: 0.9, turnDeg: 45, label: '本陣' },
    yari: { speed: 3, power: 1.0, defence: 1.0, turnDeg: 45, label: '槍' },
    yumi: { speed: 3, power: 0.5, defence: 1.2, turnDeg: 60, label: '弓' },
    kiba: { speed: 6, power: 2.0, defence: 1.0, turnDeg: 90, label: '騎馬' },
};

/** 地形ごとの動きの速さ（重なるときは 湿地 > 林 > 道 の順で 1 つだけ効く） */
export const TERRAIN_SPEED: Record<TerrainKind, number> = { marsh: 0.35, woods: 0.5, road: 1.2, hill: 1 };

/** 画面の知らせ（出来事の記録）の種類 */
export type BattleEventKind =
    | 'start'
    | 'arrive' // 部隊が戦場に着いた
    | 'spotted' // 隠れていた敵が見えた（林から現れた）
    | 'discovered' // 隠れていた味方が敵に気づかれた
    | 'engage' // 交戦が始まった
    | 'flank' // 側面を突いた
    | 'rear' // 背後を突いた
    | 'charge' // 騎馬の突撃
    | 'rout' // 敗走した
    | 'destroyed' // 全滅した
    | 'withdrawn' // 撤退して戦場を離れた
    | 'fled' // 敗走して戦場から逃れ去った
    | 'lost' // 目標を見失った・目標が崩れた
    | 'ai' // 敵の動き（見えているときだけ）
    | 'retreat_all' // 全軍撤退の命令
    | 'nightfall'
    | 'end';

export interface BattleEvent {
    /** 起きた時刻（秒） */
    t: number;
    kind: BattleEventKind;
    /** 画面に出す文（日本語） */
    text: string;
    /** 主な部隊（知らせを押したときにそこへカメラを寄せるなど） */
    unitId?: string;
    /** 相手の部隊 */
    targetId?: string;
}

/** 合戦中の部隊の状態（画面は読むだけ。書き換えは issueOrder・stepBattle だけ） */
export interface UnitState {
    readonly id: string;
    readonly side: Side;
    readonly clan: ClanId;
    readonly kind: UnitKind;
    readonly name: string;
    readonly leaderId?: string;
    readonly aiRole?: UnitDef['aiRole'];
    /** その陣営の本陣（その陣営の最初の honjin） */
    readonly isHq: boolean;
    readonly startStrength: number;
    /** 兵力（小数を含む。表示は Math.round） */
    strength: number;
    /** 士気 0〜100 */
    morale: number;
    /** 士気が戻る上限（最初の士気） */
    readonly maxMorale: number;
    x: number;
    z: number;
    /** 向き（ラジアン。0 が北＝ -z、時計回り） */
    facing: number;
    /** 今の命令 */
    order: Order;
    status: UnitStatus;
    /** 戦場に着く時刻（秒） */
    readonly arriveAt: number;
    /** 着いたことがある */
    arrived: boolean;
    /** いま戦場にいる（着いていて、まだ離れていない・全滅していない） */
    present: boolean;
    /** 斬り合っている相手（近接） */
    engagedWith: string | null;
    /** 射ている相手（弓） */
    shootingAt: string | null;
    /** この刻みに損害を与えてきた相手 */
    attackers: string[];
    /** それぞれの陣営から見えているか（林の中は近づかれるまで見えない） */
    seenBy: Record<Side, boolean>;
    /** この刻みに動いた */
    moving: boolean;
    /** 着いたら向き直る向き（move の face） */
    faceGoal: number | null;
    /** 最後に損害を受けた時刻 */
    lastHitT: number;
    /** 最後に矢を受けた時刻・射てきた部隊（敵の考えが使う） */
    lastArrowT: number;
    lastShooterId: string | null;
    /** 最後に斬り合っていた時刻 */
    lastMeleeT: number;
    /** 騎馬の突撃が効いている終わりの時刻 */
    chargeUntil: number;
    /** 相手ごとに、最後に側面・背後を突かれた時刻 */
    shockT: Record<string, number>;
    /** 直近 1 秒ほどの損害（表示用。毎刻み少しずつ減る） */
    recentLoss: number;
}

export interface BattleState {
    readonly setup: BattleSetup;
    readonly map: BattleMap;
    readonly timeLimitSec: number;
    /** 経過時間（秒）＝ tick × RULES.tick */
    t: number;
    tick: number;
    /** stepBattle に渡された時間のうち、まだ刻みにしていない分 */
    acc: number;
    units: UnitState[];
    /** 出来事の記録（古い順。画面は読んだ所までの番号を覚えておく） */
    events: BattleEvent[];
    /** 全軍撤退を命じた時刻 */
    allRetreatAt: number | null;
    result: BattleOutcome | null;
    /** 敵の考え（ai.ts） */
    ai: AiState;
    /** 部隊の組ごとに、最後に斬り合った時刻（交戦の知らせを繰り返さないため） */
    contactT: Record<string, number>;
}

// ---------------------------------------------------------------- 幾何

/** a から b への向き（0 が北、時計回り） */
export function headingTo(ax: number, az: number, bx: number, bz: number): number {
    return Math.atan2(bx - ax, -(bz - az));
}
/** 角度の差（-π〜π） */
export function angleDiff(a: number, b: number): number {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}
function norm(a: number): number {
    const t = Math.PI * 2;
    return ((a % t) + t) % t;
}
export function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
}
function turnToward(from: number, to: number, maxRad: number): number {
    const d = angleDiff(from, to);
    if (Math.abs(d) <= maxRad) return norm(to);
    return norm(from + Math.sign(d) * maxRad);
}
const DEG = Math.PI / 180;

/** 攻め手（ax, az）が守り手 d のどの向きから当たっているか */
export function attackArc(d: { x: number; z: number; facing: number }, ax: number, az: number): 'front' | 'flank' | 'rear' {
    const a = Math.abs(angleDiff(d.facing, headingTo(d.x, d.z, ax, az))) / DEG;
    if (a <= RULES.frontArcDeg) return 'front';
    if (a <= RULES.rearArcDeg) return 'flank';
    return 'rear';
}

// ---------------------------------------------------------------- 地形

function inArea(a: BattleMap['terrain'][number], x: number, z: number): boolean {
    if (a.rect) return x >= a.rect.x0 && x <= a.rect.x1 && z >= a.rect.z0 && z <= a.rect.z1;
    if (a.circle) return Math.hypot(x - a.circle.cx, z - a.circle.cz) <= a.circle.r;
    return false;
}
/** その地点の地形（重なりあり） */
export function terrainAt(map: BattleMap, x: number, z: number): TerrainKind[] {
    const out: TerrainKind[] = [];
    for (const a of map.terrain) if (inArea(a, x, z) && !out.includes(a.kind)) out.push(a.kind);
    return out;
}
export function inTerrain(map: BattleMap, kind: TerrainKind, x: number, z: number): boolean {
    for (const a of map.terrain) if (a.kind === kind && inArea(a, x, z)) return true;
    return false;
}
/**
 * 地面の高さ（m）。丘は円で、中心が height、縁が 0 の丸い頂（1 − (d/r)²）。四角の丘は一様な高さ。
 * 表示（view）も同じ式で地面を盛り上げると、見た目と守りの計算が合う。
 */
export function elevationAt(map: BattleMap, x: number, z: number): number {
    let h = 0;
    for (const a of map.terrain) {
        if (a.kind !== 'hill') continue;
        const H = a.height ?? 10;
        if (a.circle) {
            const d = Math.hypot(x - a.circle.cx, z - a.circle.cz) / a.circle.r;
            if (d < 1) h = Math.max(h, H * (1 - d * d));
        } else if (a.rect && inArea(a, x, z)) h = Math.max(h, H);
    }
    return h;
}
/** その地点の動きの速さの倍率 */
export function speedFactorAt(map: BattleMap, x: number, z: number): number {
    if (inTerrain(map, 'marsh', x, z)) return TERRAIN_SPEED.marsh;
    if (inTerrain(map, 'woods', x, z)) return TERRAIN_SPEED.woods;
    if (inTerrain(map, 'road', x, z)) return TERRAIN_SPEED.road;
    return 1;
}

// ---------------------------------------------------------------- 状態の問い合わせ

export function unitById(s: BattleState, id: string): UnitState | undefined {
    return s.units.find((u) => u.id === id);
}
/** 戦場にいて戦える */
export function isActive(u: UnitState): boolean {
    return u.present && u.status === 'ready';
}
/** 命令を出せる（戦える。まだ着いていない部隊にも先に命令しておける） */
export function canCommand(s: BattleState, u: UnitState): boolean {
    if (s.result || u.status !== 'ready') return false;
    if (u.side === 'ally' && s.allRetreatAt !== null) return false;
    return true;
}
export function hqOf(s: BattleState, side: Side): UnitState | undefined {
    return s.units.find((u) => u.side === side && u.isHq);
}
export function other(side: Side): Side {
    return side === 'ally' ? 'enemy' : 'ally';
}
/** 残り時間（日没まで、秒） */
export function timeLeft(s: BattleState): number {
    return Math.max(0, s.timeLimitSec - s.t);
}
/** 退き口（撤退・敗走で向かう所）。退き口が戦場の端にあれば、その端のうち今の位置の真っすぐ先 */
export function exitPointFor(s: BattleState, u: { side: Side; x: number }): { x: number; z: number } {
    const e = s.map.exits[u.side];
    const edge = Math.abs(e.z) >= s.map.depth / 2 - 1;
    if (edge) return { x: clamp(u.x, -s.map.width / 2 + 5, s.map.width / 2 - 5), z: e.z };
    return { x: e.x, z: e.z };
}

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------- 画面に出す言葉

export const STATUS_LABEL: Record<UnitStatus, string> = { ready: '戦える', routed: '敗走', withdrawn: '撤退済み', destroyed: '全滅' };

/** 今の命令（例：「攻撃：鷲尾先手」「移動」「防衛・待機」「撤退」） */
export function orderLabel(s: BattleState, u: UnitState): string {
    if (u.status === 'routed') return '敗走中';
    if (u.status === 'withdrawn') return '撤退済み';
    if (u.status === 'destroyed') return '―';
    if (!u.arrived) return `到着待ち（${Math.max(0, Math.ceil(u.arriveAt - s.t))} 秒）`;
    switch (u.order.type) {
        case 'hold':
            return '防衛・待機';
        case 'move':
            return '移動';
        case 'attack':
            return `攻撃：${unitById(s, u.order.targetId)?.name ?? '？'}`;
        case 'retreat':
            return '撤退';
    }
}
/** 交戦相手（例：「斬り合い：鷲尾先手」「射撃：鷲尾弓隊」「なし」） */
export function engagementLabel(s: BattleState, u: UnitState): string {
    if (u.engagedWith) return `斬り合い：${unitById(s, u.engagedWith)?.name ?? '？'}`;
    if (u.shootingAt) return `射撃：${unitById(s, u.shootingAt)?.name ?? '？'}`;
    return 'なし';
}

// ---------------------------------------------------------------- 作る・命令

/** 合戦を始める（設定は変えない。部隊の並びの順が計算の順になる） */
export function createBattle(setup: BattleSetup): BattleState {
    const ids = new Set<string>();
    const hqSeen: Record<Side, boolean> = { ally: false, enemy: false };
    const units: UnitState[] = setup.units.map((d) => {
        if (ids.has(d.id)) throw new Error(`部隊の id が重なっています: ${d.id}`);
        ids.add(d.id);
        for (const k of ['strength', 'morale', 'x', 'z', 'facing'] as const) {
            if (!Number.isFinite(d[k])) throw new Error(`部隊 ${d.id} の ${k} が数ではありません`);
        }
        const isHq = d.kind === 'honjin' && !hqSeen[d.side];
        if (isHq) hqSeen[d.side] = true;
        const arriveAt = d.arriveAt && d.arriveAt > 0 ? d.arriveAt : 0;
        const strength = Math.max(0, d.strength);
        const morale = clamp(d.morale, 0, 100);
        return {
            id: d.id,
            side: d.side,
            clan: d.clan,
            kind: d.kind,
            name: d.name,
            leaderId: d.leaderId,
            aiRole: d.aiRole,
            isHq,
            startStrength: strength,
            strength,
            morale,
            maxMorale: morale,
            x: clamp(d.x, -setup.map.width / 2, setup.map.width / 2),
            z: clamp(d.z, -setup.map.depth / 2, setup.map.depth / 2),
            facing: norm(d.facing),
            order: d.order ? { ...d.order } : { type: 'hold' },
            status: strength < 1 ? 'destroyed' : 'ready',
            arriveAt,
            arrived: arriveAt === 0,
            present: arriveAt === 0 && strength >= 1,
            engagedWith: null,
            shootingAt: null,
            attackers: [],
            seenBy: { ally: d.side === 'ally', enemy: d.side === 'enemy' },
            moving: false,
            faceGoal: null,
            lastHitT: -999,
            lastArrowT: -999,
            lastShooterId: null,
            lastMeleeT: -999,
            chargeUntil: -1,
            shockT: {},
            recentLoss: 0,
        } satisfies UnitState;
    });
    const s: BattleState = {
        setup,
        map: setup.map,
        timeLimitSec: setup.timeLimitSec,
        t: 0,
        tick: 0,
        acc: 0,
        units,
        events: [],
        allRetreatAt: null,
        result: null,
        ai: createAiState(units),
        contactT: {},
    };
    updateVisibility(s, null);
    s.events.push({ t: 0, kind: 'start', text: `${setup.map.name}の合戦が始まった` });
    return s;
}

/**
 * 命令を出す（味方にも敵にも使える。敵の考え ai.ts もこれで命令する）。出せたら true。
 * - 敗走・撤退済み・全滅の部隊、合戦が終わった後、全軍撤退の後の味方には出せない。
 * - 攻撃：相手は反対の陣営で、戦場にいて戦える、こちらの陣営から見えている部隊に限る。
 * - 移動：戦場の外の地点は内側へ寄せる。
 */
export function issueOrder(s: BattleState, unitId: string, order: Order): boolean {
    const u = unitById(s, unitId);
    if (!u || !canCommand(s, u)) return false;
    switch (order.type) {
        case 'hold':
        case 'retreat':
            u.order = { type: order.type };
            break;
        case 'move': {
            if (!Number.isFinite(order.x) || !Number.isFinite(order.z)) return false;
            const o: Order = {
                type: 'move',
                x: clamp(order.x, -s.map.width / 2 + 2, s.map.width / 2 - 2),
                z: clamp(order.z, -s.map.depth / 2 + 2, s.map.depth / 2 - 2),
            };
            if (order.face !== undefined && Number.isFinite(order.face)) o.face = norm(order.face);
            u.order = o;
            break;
        }
        case 'attack': {
            const t = unitById(s, order.targetId);
            if (!t || t.side === u.side || !isActive(t) || !t.seenBy[u.side]) return false;
            u.order = { type: 'attack', targetId: t.id };
            break;
        }
        default:
            return false;
    }
    u.faceGoal = null;
    return true;
}

/** 全軍撤退（味方のすべての部隊を退き口へ。まだ着いていない部隊は来ない）。出せたら true */
export function orderAllRetreat(s: BattleState): boolean {
    if (s.result || s.allRetreatAt !== null) return false;
    s.allRetreatAt = s.t;
    for (const u of s.units) {
        if (u.side !== 'ally' || u.status !== 'ready') continue;
        u.order = { type: 'retreat' };
        u.faceGoal = null;
        if (!u.arrived) u.status = 'withdrawn';
    }
    s.events.push({ t: s.t, kind: 'retreat_all', text: '全軍に撤退を命じた' });
    return true;
}

/** 結果（終わっていなければ null） */
export function outcome(s: BattleState): BattleOutcome | null {
    return s.result;
}

/**
 * 時間を進める（dt 秒。指揮中の一時停止では呼ばない）。決まった刻みで計算し、余りは次へ持ち越す。
 * 1 回に進めるのは最大 2 秒分（重いフレームで一度に進みすぎないように）。この呼び出しで起きた出来事を返す。
 */
export function stepBattle(s: BattleState, dt: number): BattleEvent[] {
    if (s.result || !(dt > 0)) return [];
    const from = s.events.length;
    s.acc = Math.min(s.acc + dt, 2);
    while (s.acc >= RULES.tick - 1e-9 && !s.result) {
        s.acc -= RULES.tick;
        tick(s);
    }
    if (s.acc < 0) s.acc = 0;
    return s.events.slice(from);
}

/** 結果が出るまで一気に進める（テスト・開発の早送り用）。each は刻みごと（命令を出す台本など） */
export function runToEnd(s: BattleState, each?: (s: BattleState) => void, maxSec = 3600): BattleOutcome {
    while (!s.result && s.t < maxSec) {
        each?.(s);
        stepBattle(s, RULES.tick);
    }
    if (!s.result) throw new Error('合戦が終わりませんでした');
    return s.result;
}

// ---------------------------------------------------------------- 1 刻み

interface Plan {
    melee: UnitState | null;
    ranged: UnitState | null;
    goal: { x: number; z: number; stopAt: number } | null;
}

function log(s: BattleState, kind: BattleEventKind, text: string, unitId?: string, targetId?: string): void {
    s.events.push({ t: round1(s.t), kind, text, unitId, targetId });
}
function round1(v: number): number {
    return Math.round(v * 10) / 10;
}

function tick(s: BattleState): void {
    s.tick++;
    s.t = s.tick * RULES.tick;
    const dt = RULES.tick;
    const t = s.t;

    // 1. 着いた部隊
    for (const u of s.units) {
        if (u.arrived || u.status !== 'ready' || u.arriveAt > t + 1e-9) continue;
        u.arrived = true;
        u.present = true;
        const woods = inTerrain(s.map, 'woods', u.x, u.z);
        if (u.side === 'ally') {
            log(s, 'arrive', woods ? `${u.name}が林に着いた（まだ敵に気づかれていない）` : `${u.name}が戦場に着いた`, u.id);
        }
    }

    // 2. 見えているか
    updateVisibility(s, s.events);

    // 3. 敵の考え（0.5 秒ごと）
    if (s.tick % 5 === 1) {
        thinkEnemy(s, {
            issue: (id, o) => issueOrder(s, id, o),
            log: (text, unitId) => log(s, 'ai', text, unitId),
        });
    }

    // 4. 命令の確かめ（攻撃の相手が崩れた・見えなくなった）と、この刻みの動き・交戦相手
    const plans = new Map<UnitState, Plan>();
    for (const u of s.units) {
        if (!u.present) continue;
        plans.set(u, planFor(s, u));
    }

    // 5. 損害
    const n = s.units.length;
    const loss = new Float64Array(n);
    const arrowLoss = new Float64Array(n); // loss のうち矢による分
    const pressure = new Float64Array(n); // 側面・背後の圧力（毎秒の士気の低下）
    const shock = new Float64Array(n);
    const meleeCount = new Int32Array(n);
    const index = new Map<UnitState, number>();
    s.units.forEach((u, i) => {
        index.set(u, i);
        u.attackers = [];
    });
    for (const a of s.units) {
        const p = plans.get(a);
        if (!p) continue;
        a.engagedWith = p.melee ? p.melee.id : null;
        a.shootingAt = p.ranged ? p.ranged.id : null;
        if (a.status !== 'ready') continue;
        if (p.melee) {
            const d = p.melee;
            const di = index.get(d)!;
            const wasInMelee = t - a.lastMeleeT <= RULES.tick * 1.5;
            const key = a.id < d.id ? `${a.id}|${d.id}` : `${d.id}|${a.id}`;
            const lastContact = s.contactT[key];
            if (d.status === 'ready' && (lastContact === undefined || t - lastContact > 10)) log(s, 'engage', `${a.name}と${d.name}が交戦`, a.id, d.id);
            s.contactT[key] = t;
            const arc = attackArc(d, a.x, a.z);
            // 騎馬の突撃：動いてきて交戦に入った（直前 8 秒は斬り合っていない）
            if (a.kind === 'kiba' && !wasInMelee && a.moving && t - a.lastMeleeT > 8) {
                const intoPikes = d.kind === 'yari' && arc === 'front';
                if (!intoPikes && d.status === 'ready') {
                    a.chargeUntil = t + RULES.chargeSec;
                    shock[di] += 6;
                    log(s, 'charge', `${a.name}が${d.name}へ突撃した`, a.id, d.id);
                }
            }
            a.lastMeleeT = t;
            const dmg = meleeDamage(s, a, d, arc) * dt;
            loss[di] += dmg;
            d.attackers.push(a.id);
            if (d.status === 'ready') {
                meleeCount[di]++;
                if (arc !== 'front') {
                    pressure[di] += arc === 'rear' ? RULES.rearPressure : RULES.flankPressure;
                    const last = d.shockT[a.id];
                    if (last === undefined || t - last > 20) {
                        shock[di] += arc === 'rear' ? RULES.rearShock : RULES.flankShock;
                        log(s, arc, `${a.name}が${d.name}の${arc === 'rear' ? '背後' : '側面'}を突いた`, a.id, d.id);
                    }
                    d.shockT[a.id] = t;
                }
            }
        } else if (p.ranged) {
            const d = p.ranged;
            const di = index.get(d)!;
            const dmg = rangedDamage(s, a, d) * dt;
            loss[di] += dmg;
            arrowLoss[di] += dmg;
            d.attackers.push(a.id);
            d.lastArrowT = t;
            d.lastShooterId = a.id;
        }
    }

    // 6. 動き・向き
    for (const u of s.units) {
        const p = plans.get(u);
        if (!p) continue;
        moveUnit(s, u, p, dt);
    }
    separate(s);

    // 7. 損害と士気
    const routedNow: UnitState[] = [];
    s.units.forEach((u, i) => {
        if (!u.present) return;
        const l = Math.min(loss[i], u.strength);
        u.recentLoss = u.recentLoss * 0.9 + l;
        if (l > 0) {
            u.strength -= l;
            u.lastHitT = t;
        }
        if (u.status !== 'ready') return;
        if (u.strength < 1) return;
        const aura = !u.isHq && nearOwnHq(s, u) ? RULES.hqAuraMul : 1;
        const felt = loss[i] > 0 ? l * (1 - (1 - RULES.rangedMoraleMul) * (arrowLoss[i] / loss[i])) : 0;
        let down = (felt / u.startStrength) * RULES.moralePerLoss + shock[i] + pressure[i] * dt;
        if (meleeCount[i] >= 2) down += RULES.outnumberedPressure * dt;
        if (u.isHq && meleeCount[i] >= 1) down += RULES.hqUnderAttack * dt;
        down *= aura;
        let m = u.morale - down;
        if (t - u.lastHitT >= RULES.recoverDelay && !u.engagedWith) {
            m += (RULES.recoverRate + (aura < 1 ? RULES.recoverHqBonus : 0)) * dt;
            m = Math.min(m, u.maxMorale);
        }
        u.morale = clamp(m, 0, 100);
        if (u.morale <= RULES.routMorale) routedNow.push(u);
    });

    // 8. 全滅・敗走
    for (const u of s.units) {
        if (!u.present || u.status === 'destroyed' || u.strength >= 1) continue;
        u.strength = 0;
        u.status = 'destroyed';
        u.present = false;
        u.engagedWith = null;
        u.shootingAt = null;
        log(s, 'destroyed', `${u.name}が全滅した`, u.id);
    }
    for (const u of routedNow) {
        if (u.status !== 'ready') continue;
        u.status = 'routed';
        u.order = { type: 'retreat' };
        u.engagedWith = null;
        u.shootingAt = null;
        u.faceGoal = null;
        log(s, 'rout', u.isHq ? `${u.name}が崩れた！` : `${u.name}が敗走した`, u.id);
        for (const o of s.units) {
            if (o === u || o.side !== u.side || !isActive(o)) continue;
            if (u.isHq) o.morale = Math.max(0, o.morale - RULES.hqRoutShock);
            else if (dist(o, u) <= RULES.nearbyRoutRadius) o.morale = Math.max(0, o.morale - RULES.nearbyRoutShock);
        }
    }

    // 9. 退き口に着いた
    for (const u of s.units) {
        if (!u.present) continue;
        const leaving = u.status === 'routed' || (u.status === 'ready' && u.order.type === 'retreat');
        if (!leaving) continue;
        const e = exitPointFor(s, u);
        if (dist(u, e) > 6) continue;
        u.present = false;
        u.engagedWith = null;
        u.shootingAt = null;
        if (u.status === 'routed') log(s, 'fled', `${u.name}が戦場から逃れ去った`, u.id);
        else {
            u.status = 'withdrawn';
            log(s, 'withdrawn', `${u.name}が戦場を離れた`, u.id);
        }
    }

    // 10. 勝ち負け
    decide(s);
}

/** 見えているか（林の中の部隊は、相手の戦える部隊が 60 m 以内に来るまで見えない） */
function updateVisibility(s: BattleState, events: BattleEvent[] | null): void {
    for (const u of s.units) {
        const opp = other(u.side);
        let seen: boolean;
        if (!u.present) seen = false;
        else if (!inTerrain(s.map, 'woods', u.x, u.z)) seen = true;
        else seen = s.units.some((o) => o.side === opp && isActive(o) && dist(o, u) <= RULES.woodsSight);
        const was = u.seenBy[opp];
        u.seenBy[opp] = seen;
        u.seenBy[u.side] = u.present;
        if (!events || !seen || was) continue;
        // 林の縁を出入りして何度も知らせないように、同じ部隊は 15 秒あける
        const key = `seen:${u.id}`;
        const last = s.contactT[key];
        s.contactT[key] = s.t;
        if (last !== undefined && s.t - last < 15) continue;
        if (u.side === 'enemy') {
            const woods = inTerrain(s.map, 'woods', u.x, u.z) || wasInWoodsRecently(s, u);
            log(s, 'spotted', woods ? `${u.name}が林から現れた` : `${u.name}が現れた`, u.id);
        } else if (u.arrived && s.t > 0) {
            log(s, 'discovered', `敵が${u.name}に気づいた`, u.id);
        }
    }
}
function wasInWoodsRecently(s: BattleState, u: UnitState): boolean {
    // 1 刻み前の位置は持っていないので、林の縁から 8 m 以内なら林から出てきたとみなす
    for (const dx of [-8, 0, 8]) for (const dz of [-8, 0, 8]) if (inTerrain(s.map, 'woods', u.x + dx, u.z + dz)) return true;
    return false;
}

function nearOwnHq(s: BattleState, u: UnitState): boolean {
    const hq = hqOf(s, u.side);
    return !!hq && hq !== u && isActive(hq) && dist(hq, u) <= RULES.hqAura;
}

/** この刻みの計画（誰と斬り合うか・誰を射るか・どこへ動くか）。攻撃の相手が無効なら命令を直す */
function planFor(s: BattleState, u: UnitState): Plan {
    if (u.status === 'routed' || (u.status === 'ready' && u.order.type === 'retreat')) {
        const e = exitPointFor(s, u);
        return { melee: null, ranged: null, goal: { x: e.x, z: e.z, stopAt: 0 } };
    }
    if (u.status !== 'ready') return { melee: null, ranged: null, goal: null };

    // 攻撃の相手を確かめる
    if (u.order.type === 'attack') {
        const tid = u.order.targetId;
        const tgt = unitById(s, tid);
        if (!tgt || !isActive(tgt)) {
            u.order = { type: 'hold' };
            if (u.side === 'ally' && tgt) log(s, 'lost', `${u.name}：${tgt.name}が崩れたので、その場で待機する`, u.id, tgt.id);
        } else if (!tgt.seenBy[u.side]) {
            u.order = { type: 'move', x: tgt.x, z: tgt.z };
            if (u.side === 'ally') log(s, 'lost', `${u.name}は${tgt.name}を見失った`, u.id, tgt.id);
        }
    }

    const opp = other(u.side);
    // 間合いの中の相手（戦える相手を先に、近い順。同じ距離なら並びの順）
    const near: UnitState[] = [];
    const nearRouted: UnitState[] = [];
    for (const o of s.units) {
        if (o.side !== opp || !o.present) continue;
        if (dist(o, u) > RULES.meleeRange) continue;
        if (o.status === 'ready') near.push(o);
        else if (o.status === 'routed') nearRouted.push(o);
    }
    near.sort((a, b) => dist(a, u) - dist(b, u));
    nearRouted.sort((a, b) => dist(a, u) - dist(b, u));
    const prevU = u.engagedWith ? unitById(s, u.engagedWith) : undefined;
    const prev = prevU && prevU.side === opp && isActive(prevU) && dist(prevU, u) <= RULES.meleeRange + RULES.meleeHold ? prevU : null;
    const front = (o: UnitState, heading: number) => Math.abs(angleDiff(heading, headingTo(u.x, u.z, o.x, o.z))) <= 70 * DEG;
    const inFront = (heading: number) => (prev && front(prev, heading) ? prev : near.find((o) => front(o, heading)) ?? null);
    const holdMelee = () => prev ?? near[0] ?? nearRouted[0] ?? null;

    const order = u.order;
    if (order.type === 'move') {
        const heading = headingTo(u.x, u.z, order.x, order.z);
        const block = dist(u, order) > 1.5 ? inFront(heading) : holdMelee();
        if (block) return { melee: block, ranged: null, goal: null };
        return { melee: null, ranged: null, goal: { x: order.x, z: order.z, stopAt: 0 } };
    }
    if (order.type === 'attack') {
        const tgt = unitById(s, order.targetId)!;
        const d = dist(u, tgt);
        if (near.includes(tgt) || prev === tgt) return { melee: tgt, ranged: null, goal: null };
        if (u.kind === 'yumi') {
            if (near.length || prev) return { melee: holdMelee(), ranged: null, goal: null };
            if (d <= RULES.bowStandoff + 0.5) return { melee: null, ranged: tgt, goal: null };
            return { melee: null, ranged: null, goal: { x: tgt.x, z: tgt.z, stopAt: RULES.bowStandoff } };
        }
        const block = inFront(headingTo(u.x, u.z, tgt.x, tgt.z));
        if (block) return { melee: block, ranged: null, goal: null };
        return { melee: null, ranged: null, goal: { x: tgt.x, z: tgt.z, stopAt: RULES.meleeRange * 0.8 } };
    }
    // 防衛・待機：間合いの中の相手と斬り合う。弓は見えている一番近い相手を射る
    const m = holdMelee();
    if (m) return { melee: m, ranged: null, goal: null };
    if (u.kind === 'yumi') return { melee: null, ranged: nearestShootable(s, u), goal: null };
    return { melee: null, ranged: null, goal: null };
}

function nearestShootable(s: BattleState, u: UnitState): UnitState | null {
    let best: UnitState | null = null;
    let bd = Infinity;
    for (const o of s.units) {
        if (o.side === u.side || !isActive(o) || !o.seenBy[u.side]) continue;
        const d = dist(o, u);
        if (d <= RULES.bowRange && d < bd) {
            bd = d;
            best = o;
        }
    }
    return best;
}

function moraleMul(u: UnitState): number {
    return 0.4 + 0.6 * (u.morale / 100);
}

/** 近接の損害（1 秒あたり） */
export function meleeDamage(s: BattleState, a: UnitState, d: UnitState, arc: 'front' | 'flank' | 'rear'): number {
    let m = RULES.meleeRate * KIND_STATS[a.kind].power * KIND_STATS[d.kind].defence * moraleMul(a);
    // 相性
    if (a.kind === 'yari' && d.kind === 'kiba' && attackArc(a, d.x, d.z) === 'front') m *= 1.5; // 槍は騎馬を正面で受け止める
    if (a.kind === 'kiba' && d.kind === 'yari' && arc === 'front') m *= 0.6; // 騎馬は槍の正面に弱い
    if (a.kind === 'kiba' && d.kind === 'yumi') m *= 1.5;
    if (a.kind === 'kiba' && d.kind === 'honjin') m *= 1.1;
    // 向き
    if (arc === 'flank') m *= RULES.flankMul;
    else if (arc === 'rear') m *= RULES.rearMul;
    // 丘の守り（下から正面に来る相手）
    if (arc === 'front' && elevationAt(s.map, d.x, d.z) - elevationAt(s.map, a.x, a.z) >= RULES.hillDiff) m *= RULES.hillMul;
    // 防衛・待機
    if (d.status === 'ready' && d.order.type === 'hold' && !d.moving) m *= RULES.holdMul;
    // 湿地
    if (inTerrain(s.map, 'marsh', a.x, a.z)) m *= RULES.marshDealMul;
    if (inTerrain(s.map, 'marsh', d.x, d.z)) m *= RULES.marshTakeMul;
    // 突撃・追い討ち
    if (a.kind === 'kiba' && s.t <= a.chargeUntil) m *= RULES.chargeMul;
    if (d.status === 'routed') m *= RULES.pursuitMul;
    return a.strength * m;
}

/** 弓の損害（1 秒あたり） */
export function rangedDamage(s: BattleState, a: UnitState, d: UnitState): number {
    const r = dist(a, d);
    const fall = r <= RULES.bowFullRange ? 1 : 1 - (0.4 * (r - RULES.bowFullRange)) / (RULES.bowRange - RULES.bowFullRange);
    let m = RULES.rangedRate * KIND_STATS[d.kind].defence * moraleMul(a) * Math.max(0.6, fall);
    if (inTerrain(s.map, 'woods', d.x, d.z)) m *= RULES.woodsArcheryMul;
    return a.strength * m;
}

function moveUnit(s: BattleState, u: UnitState, p: Plan, dt: number): void {
    const st = KIND_STATS[u.kind];
    u.moving = false;
    if (p.goal) {
        const d = dist(u, p.goal);
        const want = headingTo(u.x, u.z, p.goal.x, p.goal.z);
        const room = d - p.goal.stopAt;
        if (room > 0.05) {
            // 少しだけ後ろへ下がるときは、向きを変えずに後ずさりする（半分の速さ）
            const backStep = u.status === 'ready' && u.order.type === 'move' && room < 20 && Math.abs(angleDiff(u.facing, want)) > 120 * DEG;
            let aligned = 0.5;
            if (!backStep) {
                const turnRate = (u.status === 'routed' ? 180 : st.turnDeg) * DEG * dt;
                u.facing = turnToward(u.facing, want, turnRate);
                aligned = Math.abs(angleDiff(u.facing, want)) <= 45 * DEG ? 1 : 0.25;
            }
            let speed = st.speed * speedFactorAt(s.map, u.x, u.z) * aligned;
            if (u.status === 'routed') speed *= 1.2;
            const step = Math.min(speed * dt, room);
            // 相手の部隊の中へは入らない（14 m より近づかない）
            let nx = u.x + Math.sin(want) * step;
            let nz = u.z - Math.cos(want) * step;
            for (const o of s.units) {
                if (o.side === u.side || !isActive(o) || u.status !== 'ready') continue;
                const nd = Math.hypot(nx - o.x, nz - o.z);
                if (nd < ENEMY_GAP && nd < dist(u, o)) {
                    nx = u.x;
                    nz = u.z;
                    break;
                }
            }
            nx = clamp(nx, -s.map.width / 2 + 1, s.map.width / 2 - 1);
            nz = clamp(nz, -s.map.depth / 2, s.map.depth / 2);
            u.moving = Math.hypot(nx - u.x, nz - u.z) > 1e-4;
            u.x = nx;
            u.z = nz;
        } else if (u.status === 'ready' && u.order.type === 'move') {
            // 着いた：待機に変える（向き直りの指定があれば、そちらへ向き直る）
            u.faceGoal = u.order.face ?? null;
            u.order = { type: 'hold' };
        }
        if (u.moving) return;
    }
    // 動いていないときの向き
    if (p.melee) {
        u.facing = turnToward(u.facing, headingTo(u.x, u.z, p.melee.x, p.melee.z), RULES.meleeTurnDeg * DEG * dt);
    } else if (p.ranged) {
        u.facing = turnToward(u.facing, headingTo(u.x, u.z, p.ranged.x, p.ranged.z), st.turnDeg * DEG * dt);
    } else if (u.order.type === 'attack') {
        const tgt = unitById(s, u.order.targetId);
        if (tgt) u.facing = turnToward(u.facing, headingTo(u.x, u.z, tgt.x, tgt.z), st.turnDeg * DEG * dt);
    } else if (u.faceGoal !== null) {
        u.facing = turnToward(u.facing, u.faceGoal, st.turnDeg * DEG * dt);
        if (Math.abs(angleDiff(u.facing, u.faceGoal)) < 1e-6) u.faceGoal = null;
    }
}

/**
 * 部隊どうしが重ならないようにする。
 * - 同じ陣営の戦える部隊は 18 m まで押し離す（動いている部隊が主によける。待機・斬り合い中の部隊はほとんど動かさない）。
 *   押し離した先が相手の部隊に近づく（14 m より近い）ときは押さない（味方に押されて敵の中へ入らないように）。
 * - 相手の陣営の戦える部隊どうしは、14 m より近ければ押し離す。
 * - 敗走・撤退中の部隊は味方の間をすり抜ける。
 */
function separate(s: BattleState): void {
    const us = s.units;
    const solid = (u: UnitState) => isActive(u) && u.order.type !== 'retreat';
    const weight = (u: UnitState) => (u.engagedWith ? 0.1 : u.moving ? 1 : 0.25);
    const tooCloseToFoe = (u: UnitState, x: number, z: number) =>
        us.some((o) => o.side !== u.side && isActive(o) && Math.hypot(o.x - x, o.z - z) < ENEMY_GAP && Math.hypot(o.x - x, o.z - z) < dist(o, u));
    const nudge = (u: UnitState, dx: number, dz: number) => {
        const nx = u.x + dx;
        const nz = u.z + dz;
        if (tooCloseToFoe(u, nx, nz)) return;
        u.x = nx;
        u.z = nz;
    };
    for (let i = 0; i < us.length; i++) {
        const a = us[i];
        if (!solid(a)) continue;
        for (let j = i + 1; j < us.length; j++) {
            const b = us[j];
            if (!solid(b)) continue;
            const d = dist(a, b);
            const gap = b.side === a.side ? RULES.spacing : ENEMY_GAP;
            if (d >= gap) continue;
            let ux: number;
            let uz: number;
            if (d < 1e-6) {
                ux = 1;
                uz = 0;
            } else {
                ux = (b.x - a.x) / d;
                uz = (b.z - a.z) / d;
            }
            const push = gap - d;
            if (b.side !== a.side) {
                a.x -= (ux * push) / 2;
                a.z -= (uz * push) / 2;
                b.x += (ux * push) / 2;
                b.z += (uz * push) / 2;
                continue;
            }
            const wa = weight(a);
            const wb = weight(b);
            const sum = wa + wb;
            nudge(a, -ux * push * (wa / sum), -uz * push * (wa / sum));
            nudge(b, ux * push * (wb / sum), uz * push * (wb / sum));
        }
    }
    for (const u of us) {
        u.x = clamp(u.x, -s.map.width / 2 + 1, s.map.width / 2 - 1);
        u.z = clamp(u.z, -s.map.depth / 2, s.map.depth / 2);
    }
}
/** 相手の部隊にこれより近づかない（m） */
const ENEMY_GAP = 14;

/** 戦える（まだ着いていない部隊も数える） */
function able(u: UnitState): boolean {
    return u.status === 'ready';
}

function finish(s: BattleState, result: BattleResultKind, reason: BattleEndReason): void {
    s.result = {
        result,
        reason,
        elapsedSec: round1(s.t),
        units: s.units.map((u) => ({
            id: u.id,
            side: u.side,
            clan: u.clan,
            ...(u.leaderId ? { leaderId: u.leaderId } : {}),
            startStrength: Math.round(u.startStrength),
            endStrength: Math.round(u.strength),
            status: u.status,
        })),
    };
    const text: Record<BattleEndReason, string> = {
        enemy_hq_routed: '敵の本陣が崩れた。勝利',
        enemy_army_broken: '敵の諸隊が崩れた。勝利',
        ally_hq_routed: '味方の本陣が崩れた。敗北（若殿は落ち延びる）',
        ally_army_broken: '味方の諸隊が崩れた。敗北（若殿は落ち延びる）',
        ordered_retreat: '兵をまとめて退いた。撤退',
        nightfall: '日が暮れた。両軍が兵を引く（撤退）',
    };
    log(s, reason === 'nightfall' ? 'nightfall' : 'end', text[reason]);
}

function decide(s: BattleState): void {
    if (s.result) return;
    const t = s.t;
    // 全軍撤退：味方が戦場を離れ切ったか、待つ時間が過ぎたら終わる（その間は勝ち負けを決めない）
    if (s.allRetreatAt !== null) {
        const still = s.units.filter((u) => u.side === 'ally' && isActive(u));
        if (still.length === 0 || t - s.allRetreatAt >= RULES.retreatGraceSec - 1e-9) {
            for (const u of still) {
                u.status = 'withdrawn';
                u.present = false;
            }
            finish(s, 'retreat', 'ordered_retreat');
        }
        return;
    }
    const allyHq = hqOf(s, 'ally');
    const enemyHq = hqOf(s, 'enemy');
    if (allyHq && (allyHq.status === 'routed' || allyHq.status === 'destroyed')) return finish(s, 'defeat', 'ally_hq_routed');
    if (allyHq && allyHq.status === 'withdrawn') return finish(s, 'retreat', 'ordered_retreat');
    if (enemyHq && enemyHq.status !== 'ready') return finish(s, 'victory', 'enemy_hq_routed');
    const enemyOthers = s.units.filter((u) => u.side === 'enemy' && !u.isHq);
    if (enemyOthers.length > 0 && !enemyOthers.some(able)) return finish(s, 'victory', 'enemy_army_broken');
    const allyOthers = s.units.filter((u) => u.side === 'ally' && !u.isHq);
    if (allyOthers.length > 0 && !allyOthers.some(able)) return finish(s, 'defeat', 'ally_army_broken');
    if (s.tick >= Math.round(s.timeLimitSec / RULES.tick)) return finish(s, 'retreat', 'nightfall');
}
