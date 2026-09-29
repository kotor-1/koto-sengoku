/**
 * 敵の考え（純粋な TypeScript。乱数なし）。sim.ts の stepBattle が 0.5 秒ごとに呼ぶ。
 * 敵の部隊だけを動かす（味方の部隊は利用者の命令だけで動く。待機中に間合いの相手と斬り合うのは sim.ts の決まり）。
 * 敵は「敵から見えている味方」（seenBy.enemy）だけを相手に考える。林の中の味方は 60 m 以内に来るまで気づかない。
 *
 * 役割（UnitDef.aiRole。省けば本陣は guard_hq。ほかは、率いる武将（generalId）がいればその AI の基本方針（generals.ts の aiPolicy）から
 * 決め（defaultAiRole：攻めかかる＝相手の本陣へ assault・持ち場を保つ＝hold_line・慎重に守る＝guard_hq・味方を支える＝reserve）、
 * いなければ hold_line。Version 11 の部隊は generalId を持たないので今までどおり）：
 * - hold_line：持ち場（最初の位置）を守る。持ち場の 75 m 以内に来た見えている味方が、
 *   ほかの部隊へ向かう・横を通るなら打って出て迎え撃つ（自分へ向かって来る相手は、持ち場で待ち構える）。
 *   持ち場から 120 m より離れた相手は追わず、持ち場へ戻る。矢を 12 秒以上浴び、持ち場の 90 m 以内に相手の槍・騎馬・本陣がいなければ、射手へ打って出る（誘い出せる）。
 *   弓隊は持ち場を動かず、届く相手を射る。
 * - reserve：味方（敵方）の部隊が崩れた・士気が落ちた・本陣が攻められた・本陣へ近づく相手が見えた、のどれかで動き出し、
 *   本陣を攻めている相手 → 押されている味方の相手 → 本陣に近い相手 の順に向かう。
 * - flank：着いてから 30 秒待ち、自分の側（東なら東、西なら西）を真っすぐ南へ下って相手の横へ出てから、
 *   斬り合っている部隊・弓・本陣・こちらを向いていない部隊を選んで横から当たる。途中で近くに相手が見えたらすぐ当たる。
 * - guard_hq：本陣を守る。本陣そのものは持ち場を動かない。本陣以外なら、本陣の 80 m 以内に来た相手を迎え撃つ。
 * - hold_zone（データ駆動の戦場）：aiTarget の区域（省けば最初の位置・半径 60 m）を守る。区域（＋10 m）に入ってきた見えている相手に当たり、
 *   区域から 60 m より離れた相手は追わずに持ち場（区域の中の最初の位置。外にいれば区域の中心）へ戻る。弓隊は持ち場を動かず、届く相手を射る。
 * - assault（データ駆動の戦場）：aiTarget の地点へ攻め進む。途中で 60 m 以内に見えている相手がいれば当たる（弓隊は届く相手がいれば止まって射る）。
 *   着いたら、その区域を hold_zone と同じように守る。
 * 動く命令は sim.ts が道探し（通れない所がある戦場だけ）でたどるので、ここは行き先を決めるだけ。
 *
 * 特殊能力（abilities.ts。敵方に能力を持つ武将がいるときだけ。プレイヤーは敵の能力を操作できない）：
 * - 盟友への援護：範囲（60 m）の中で斬り合っている・矢を浴びて士気の落ちた味方（敵方）の部隊があれば、士気のいちばん低い部隊を支える。
 *   （A の方針の浅井長政隊は、丘の前で持ち場を守る浅井先手が交戦すると支える）
 * - 立て直しの号令：範囲の中の戦える味方（敵方）が 2 部隊以上で士気 50 未満、または本陣自身が 45 未満になったら使う。
 * - 退路の守護：範囲の中で味方（敵方）が敗走・撤退しているとき、自分が斬り合っていなければ使う。
 * - 仮の能力（新しい武将。敵方が持つとき）：
 *   両翼の采配＝範囲の中で斬り合っている味方（敵方。自分も）が 2 部隊以上／後詰めの差配＝範囲の中に味方（敵方）が 2 部隊以上いて、
 *   自分か範囲の味方が斬り合っている／先駆けの号＝自分が斬り合っていて、士気が 40 以上（切れたときの士気 −10 で崩れないうち）。
 *
 * 追い討ち（BattleSetup.pursuit の合戦＝歴史分岐だけ。架空の第一章では何もしない）：
 * - 弓・本陣以外の部隊は、近く（騎馬 110 m・ほか 60 m）で撤退の命令で退いている見えている味方へ追い討ちをかける
 *   （hold_line は持ち場から 120 m、guard_hq は本陣から 110 m の中だけ。reserve は動き出してから）。
 * - その味方が「退路の守護」の範囲の中にいれば、追う代わりに守護の持ち主（忠勝隊）へ向かう（追っ手を阻む）。
 */
import type { Order, UnitDef } from './types';
import { ABILITY_DATA, rearguardCover } from './abilities';
import { generalById, type GeneralAiPolicy } from './generals';
import type { BattleState, UnitState } from './sim';

export type AiRole = NonNullable<UnitDef['aiRole']>;

/** 武将の AI の基本方針 → aiRole を省いた部隊の既定の役割 */
export const AI_POLICY_ROLE: Readonly<Record<GeneralAiPolicy, AiRole>> = {
    aggressive: 'assault',
    steady: 'hold_line',
    cautious: 'guard_hq',
    support: 'reserve',
};

/** aiRole を省いた部隊の役割（本陣は guard_hq。率いる武将がいれば、その AI の基本方針から。いなければ hold_line） */
export function defaultAiRole(u: Pick<UnitDef, 'kind' | 'generalId'>): AiRole {
    if (u.kind === 'honjin') return 'guard_hq';
    const g = u.generalId ? generalById(u.generalId) : undefined;
    return g ? AI_POLICY_ROLE[g.aiPolicy] : 'hold_line';
}

export const AI = {
    /** hold_line：持ち場からこの距離に来た相手を見る */
    holdEngage: 75,
    /** hold_line：持ち場からこれより離れた相手は追わない */
    holdLeash: 120,
    /** 矢を浴び続けて打って出るまでの秒数・射手までの距離の上限（持ち場から）。
     *  持ち場から provokeCalm 以内に、見えている相手の槍・騎馬・本陣がいるときは、持ち場を離れない */
    provokeSec: 12,
    provokeRange: 160,
    provokeCalm: 90,
    /** guard_hq：本陣からこの距離の相手を迎え撃つ・これより離れたら戻る */
    guardRadius: 80,
    guardLeash: 110,
    /** reserve：本陣へこの距離まで近づいた相手が見えたら動く */
    reserveAlarm: 60,
    /** reserve：味方（敵方）の士気がこれより下がったら動く */
    reserveMorale: 50,
    /** flank：着いてから動き出すまでの秒数 */
    flankDelay: 30,
    /** flank：回り込む途中、この距離に相手が見えたらすぐ当たる */
    flankStrike: 60,
    /** 追い討ち（BattleSetup.pursuit の合戦だけ）：退いている相手を追い始める距離（騎馬・ほか） */
    pursuitRangeKiba: 110,
    pursuitRange: 60,
    /** hold_zone・assault：aiTarget の半径の既定・区域の外のこの距離までに入った相手に当たる・これより離れた相手は追わない */
    zoneRadius: 60,
    zoneEngage: 10,
    zoneLeash: 60,
    /** assault：攻め進む途中、この距離に見えている相手がいれば当たる・攻撃中の相手がこれより離れたらあきらめる */
    assaultStrike: 60,
    assaultLeash: 120,
    /** assault の弓隊：この距離に見えている相手がいれば止まって射る */
    assaultShoot: 110,
} as const;

export interface AiMemo {
    role: AiRole;
    homeX: number;
    homeZ: number;
    homeFacing: number;
    /** reserve：動き出したか。flank：'wait' → 'approach' → 'strike'。assault：'approach'（攻め進む）→ 'active'（着いて守る） */
    phase: 'idle' | 'active' | 'wait' | 'approach' | 'strike';
    /** 矢を浴びている時間（秒） */
    arrowSec: number;
    waypoint: { x: number; z: number } | null;
    /** hold_zone・assault の区域（aiTarget。省けば最初の位置・半径 AI.zoneRadius） */
    zone: { x: number; z: number; r: number } | null;
}

export interface AiState {
    memo: Record<string, AiMemo>;
}

/** 敵の考えが使う、合戦への窓口（sim.ts が渡す） */
export interface AiApi {
    issue(unitId: string, order: Order): boolean;
    /** 知らせ（見えている部隊の動きだけを知らせる） */
    log(text: string, unitId: string): void;
    /** 敵方の部隊の特殊能力を使う（使えたら true。断られたら使用回数は減らない）。sim.ts が渡す */
    useAbility?(unitId: string, targetId?: string): boolean;
}

/** 敵の考えが能力を使う目安 */
export const AI_ABILITY = {
    /** 援護：この士気より低い、または斬り合っている部隊を支える */
    supportMorale: 70,
    /** 号令：範囲の中でこの士気より低い部隊が 2 つ以上、または本陣自身がこれより低い */
    rallyMorale: 50,
    rallySelfMorale: 45,
    /** 両翼の采配：範囲の中で斬り合っている部隊（自分も）がこの数以上 */
    flankEngaged: 2,
    /** 後詰めの差配：範囲の中の味方（自分を除く）がこの数以上 */
    reserveFriends: 2,
    /** 先駆けの号：自分の士気がこれ以上 */
    vanguardMorale: 40,
} as const;


export function createAiState(units: readonly UnitState[]): AiState {
    const memo: Record<string, AiMemo> = {};
    for (const u of units) {
        if (u.side !== 'enemy') continue;
        const role: AiRole = u.aiRole ?? defaultAiRole(u);
        const zoned = role === 'hold_zone' || role === 'assault';
        // 攻め進む先を省いた assault（攻めかかる方針の武将）は、相手の本陣の最初の位置へ攻め進む
        const foeHq = !u.aiTarget && role === 'assault' ? units.find((o) => o.side !== u.side && o.isHq) : undefined;
        const zone = zoned ? { x: u.aiTarget?.x ?? foeHq?.x ?? u.x, z: u.aiTarget?.z ?? foeHq?.z ?? u.z, r: u.aiTarget?.r ?? AI.zoneRadius } : null;
        // hold_zone の持ち場：最初の位置が区域の中ならそこ、外なら区域の中心
        const outside = role === 'hold_zone' && zone && Math.hypot(u.x - zone.x, u.z - zone.z) > zone.r;
        memo[u.id] = {
            role,
            homeX: outside ? zone!.x : u.x,
            homeZ: outside ? zone!.z : u.z,
            homeFacing: u.facing,
            phase: role === 'flank' ? 'wait' : role === 'assault' ? 'approach' : 'idle',
            arrowSec: 0,
            waypoint: null,
            zone,
        };
    }
    return { memo };
}

// ---- 小さな道具（sim.ts を実行時に import しないため、ここにも置く） ----
function d2(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
}
function active(u: UnitState | undefined): u is UnitState {
    return !!u && u.present && u.status === 'ready';
}
function byId(s: BattleState, id: string | null | undefined): UnitState | undefined {
    return id ? s.units.find((u) => u.id === id) : undefined;
}
/** 敵から見えている、戦える味方 */
function visibleAllies(s: BattleState): UnitState[] {
    return s.units.filter((u) => u.side === 'ally' && active(u) && u.seenBy.enemy);
}
function home(m: AiMemo): { x: number; z: number } {
    return { x: m.homeX, z: m.homeZ };
}
/** 相手 o が、u の方を向いている（u が o の正面 ±50° にいる） */
function facesMe(o: UnitState, u: UnitState): boolean {
    const h = Math.atan2(u.x - o.x, -(u.z - o.z));
    let d = (h - o.facing) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d) <= (50 * Math.PI) / 180;
}
function attackTarget(s: BattleState, u: UnitState): UnitState | undefined {
    return u.order.type === 'attack' ? byId(s, u.order.targetId) : undefined;
}
function goHome(api: AiApi, u: UnitState, m: AiMemo): void {
    // 少し押されただけなら戻らない（持ち場の 10 m 以内）
    if (d2(u, home(m)) <= 10) {
        if (u.order.type !== 'hold') api.issue(u.id, { type: 'hold' });
        return;
    }
    if (u.order.type === 'move' && Math.abs(u.order.x - m.homeX) < 0.5 && Math.abs(u.order.z - m.homeZ) < 0.5) return;
    api.issue(u.id, { type: 'move', x: m.homeX, z: m.homeZ, face: m.homeFacing });
}
function attack(s: BattleState, api: AiApi, u: UnitState, t: UnitState, text?: string): void {
    if (attackTarget(s, u) === t) return;
    if (api.issue(u.id, { type: 'attack', targetId: t.id }) && text && u.seenBy.ally) api.log(text, u.id);
}

/** 敵の部隊に命令を出す（0.5 秒ごと） */
export function thinkEnemy(s: BattleState, api: AiApi): void {
    if (api.useAbility && s.abilityList.length > 0) enemyAbilities(s, api);
    for (const u of s.units) {
        const m = s.ai.memo[u.id];
        if (!m || !active(u)) continue;
        // 矢を浴びている時間
        if (s.t - u.lastArrowT < 0.6) m.arrowSec += 0.5;
        else m.arrowSec = Math.max(0, m.arrowSec - 0.25);
        if (s.setup.pursuit && pursue(s, api, u, m)) continue;
        switch (m.role) {
            case 'hold_line':
                holdLine(s, api, u, m);
                break;
            case 'guard_hq':
                guardHq(s, api, u, m);
                break;
            case 'reserve':
                reserve(s, api, u, m);
                break;
            case 'flank':
                flank(s, api, u, m);
                break;
            case 'hold_zone':
                holdZone(s, api, u, m);
                break;
            case 'assault':
                assault(s, api, u, m);
                break;
        }
    }
}

/** 撤退の命令で退いている、敵から見えている味方 */
function retreatingAlly(o: UnitState): boolean {
    return o.side === 'ally' && active(o) && o.order.type === 'retreat' && o.seenBy.enemy;
}

/** 追い討ちで追ってよいか（役割ごとの持ち場の縛り） */
function mayChase(s: BattleState, u: UnitState, m: AiMemo, o: UnitState): boolean {
    switch (m.role) {
        case 'hold_line':
            return d2(o, home(m)) <= AI.holdLeash;
        case 'guard_hq': {
            const hq = s.units.find((x) => x.side === u.side && x.isHq);
            return d2(o, hq && active(hq) ? hq : home(m)) <= AI.guardLeash;
        }
        case 'reserve':
            return m.phase === 'active';
        case 'flank':
        case 'assault':
            return true;
        case 'hold_zone':
            return d2(o, m.zone!) <= m.zone!.r + AI.zoneLeash;
    }
}

/**
 * 追い討ち（BattleSetup.pursuit の合戦だけ）。この部隊の命令を決めたら true（役割の考えは飛ばす）。
 * 退路の守護に守られた味方は追わず、守護の持ち主へ向かう。
 */
function pursue(s: BattleState, api: AiApi, u: UnitState, m: AiMemo): boolean {
    if (u.kind === 'yumi' || u.isHq) return false;
    const cur = attackTarget(s, u);
    if (cur && retreatingAlly(cur)) {
        const guard = rearguardCover(s, cur);
        if (guard && guard.seenBy.enemy) {
            attack(s, api, u, guard, `${u.name}の追い討ちを${guard.name}が阻む`);
            return true;
        }
        return mayChase(s, u, m, cur);
    }
    if (u.engagedWith) return false;
    const range = u.kind === 'kiba' ? AI.pursuitRangeKiba : AI.pursuitRange;
    const cands = s.units.filter((o) => retreatingAlly(o) && d2(o, u) <= range && mayChase(s, u, m, o)).sort((a, b) => d2(a, u) - d2(b, u));
    for (const o of cands) {
        const guard = rearguardCover(s, o);
        if (guard) {
            if (!guard.seenBy.enemy) continue;
            attack(s, api, u, guard, `${u.name}の追い討ちを${guard.name}が阻む`);
            return true;
        }
        attack(s, api, u, o, `${u.name}が退く${o.name}へ追い討ちをかける`);
        return true;
    }
    return false;
}

function holdLine(s: BattleState, api: AiApi, u: UnitState, m: AiMemo): void {
    if (u.engagedWith) return; // 斬り合いの最中は、その場で戦う
    if (u.kind === 'yumi') {
        if (u.order.type !== 'move' || d2(u, home(m)) <= 10) goHome(api, u, m);
        return;
    }
    const cur = attackTarget(s, u);
    if (cur) {
        if (active(cur) && cur.seenBy.enemy && d2(cur, home(m)) <= AI.holdLeash) return;
        goHome(api, u, m);
        return;
    }
    // 矢を浴び続けたら、射手へ打って出る
    if (m.arrowSec >= AI.provokeSec) {
        const sh = byId(s, u.lastShooterId);
        const calm = visibleAllies(s).some((o) => o.kind !== 'yumi' && d2(o, home(m)) <= AI.provokeCalm);
        if (!calm && active(sh) && sh.seenBy.enemy && d2(sh, home(m)) <= AI.provokeRange) {
            m.arrowSec = 0;
            attack(s, api, u, sh, `${u.name}が矢を嫌って打って出た`);
            return;
        }
    }
    const threats = visibleAllies(s)
        .filter((o) => d2(o, home(m)) <= AI.holdEngage)
        .sort((a, b) => d2(a, home(m)) - d2(b, home(m)));
    for (const o of threats) {
        if (attackTarget(s, o) === u) continue; // こちらへ来る相手は、持ち場で待ち構える
        attack(s, api, u, o, `${u.name}が打って出た`);
        return;
    }
    if (u.order.type !== 'move') goHome(api, u, m);
}

function guardHq(s: BattleState, api: AiApi, u: UnitState, m: AiMemo): void {
    if (u.engagedWith) return;
    if (u.isHq) {
        if (u.order.type !== 'move') goHome(api, u, m);
        return;
    }
    const hq = s.units.find((o) => o.side === u.side && o.isHq);
    const center = hq && active(hq) ? hq : home(m);
    const cur = attackTarget(s, u);
    if (cur && active(cur) && cur.seenBy.enemy && d2(cur, center) <= AI.guardLeash) return;
    const threats = visibleAllies(s)
        .filter((o) => d2(o, center) <= AI.guardRadius)
        .sort((a, b) => d2(a, center) - d2(b, center));
    if (threats.length) {
        attack(s, api, u, threats[0], `${u.name}が本陣を守りに出た`);
        return;
    }
    if (u.order.type !== 'move') goHome(api, u, m);
}

function reserve(s: BattleState, api: AiApi, u: UnitState, m: AiMemo): void {
    const hq = s.units.find((o) => o.side === u.side && o.isHq);
    const friends = s.units.filter((o) => o.side === u.side && o !== u);
    if (m.phase === 'idle') {
        const broken = friends.some((o) => !o.isHq && o.arrived && (o.status === 'routed' || o.status === 'destroyed'));
        const shaken = friends.some((o) => active(o) && o.engagedWith && o.morale < AI.reserveMorale);
        const hqPressed = !!hq && active(hq) && (hq.attackers.length > 0 || !!hq.engagedWith);
        const near = !!hq && visibleAllies(s).some((o) => d2(o, hq) <= AI.reserveAlarm);
        if (!(broken || shaken || hqPressed || near)) return;
        m.phase = 'active';
        if (u.seenBy.ally) api.log(`${u.name}が動いた`, u.id);
    }
    if (u.engagedWith) return;
    const cur = attackTarget(s, u);
    if (cur && active(cur) && cur.seenBy.enemy) return;
    const allies = visibleAllies(s);
    // 1. 本陣を攻めている相手
    if (hq && active(hq)) {
        const onHq = allies.filter((o) => hq.attackers.includes(o.id)).sort((a, b) => d2(a, u) - d2(b, u));
        if (onHq.length) return attack(s, api, u, onHq[0]);
    }
    // 2. 押されている味方（敵方）の相手
    const pressed = friends
        .filter((o) => active(o) && o.engagedWith && o.morale < 60)
        .sort((a, b) => a.morale - b.morale);
    for (const f of pressed) {
        const foe = byId(s, f.engagedWith);
        if (active(foe) && foe.seenBy.enemy) return attack(s, api, u, foe);
    }
    // 3. 本陣に近い相手
    if (hq) {
        const near = allies.filter((o) => d2(o, hq) <= 160).sort((a, b) => d2(a, hq) - d2(b, hq));
        if (near.length) return attack(s, api, u, near[0]);
    }
    if (u.order.type !== 'move') goHome(api, u, m);
}

function flank(s: BattleState, api: AiApi, u: UnitState, m: AiMemo): void {
    if (u.engagedWith) return;
    const allies = visibleAllies(s);
    const close = allies.some((o) => d2(o, u) <= AI.flankStrike);
    if (m.phase === 'wait') {
        if (close) m.phase = 'strike';
        else if (s.t >= u.arriveAt + AI.flankDelay) {
            m.phase = 'approach';
            const zs = allies.map((o) => o.z);
            const lineZ = zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : s.map.exits.ally.z - 100;
            m.waypoint = { x: m.homeX, z: lineZ };
            api.issue(u.id, { type: 'move', x: m.waypoint.x, z: m.waypoint.z });
            // 通れない所へは sim.ts が近くの通れる所へ寄せる：寄せた先を回り込みの点にする（通れない所の無い戦場では同じ点）
            if (u.order.type === 'move' && (u.order.x !== m.waypoint.x || u.order.z !== m.waypoint.z)) m.waypoint = { x: u.order.x, z: u.order.z };
            if (u.seenBy.ally) api.log(`${u.name}が回り込んでくる`, u.id);
            return;
        } else return;
    }
    if (m.phase === 'approach') {
        const wp = m.waypoint!;
        if (!close && d2(u, wp) > 20) {
            if (u.order.type !== 'move') api.issue(u.id, { type: 'move', x: wp.x, z: wp.z });
            return;
        }
        m.phase = 'strike';
    }
    // strike：横から当たる相手を選ぶ
    const cur = attackTarget(s, u);
    if (cur && active(cur) && cur.seenBy.enemy) return;
    let best: UnitState | null = null;
    let bestScore = Infinity;
    for (const o of allies) {
        let score = d2(o, u);
        if (o.engagedWith) score -= 40;
        if (o.kind === 'yumi') score -= 25;
        if (o.kind === 'honjin') score -= 20;
        if (facesMe(o, u)) score += 30;
        if (u.kind === 'kiba' && o.kind === 'yari' && facesMe(o, u)) score += 40;
        if (score < bestScore) {
            bestScore = score;
            best = o;
        }
    }
    if (best) attack(s, api, u, best, `${u.name}が${best.name}へ横から迫る`);
    else if (u.order.type !== 'move') goHome(api, u, m);
}

/** 区域（中心と半径）を守る：区域に入ってきた見えている相手に当たる。離れすぎた相手は追わない */
function guardZone(s: BattleState, api: AiApi, u: UnitState, m: AiMemo, backHome: () => void): void {
    const Z = m.zone!;
    const cur = attackTarget(s, u);
    if (cur) {
        if (active(cur) && cur.seenBy.enemy && d2(cur, Z) <= Z.r + AI.zoneLeash) return;
        backHome();
        return;
    }
    const threats = visibleAllies(s)
        .filter((o) => d2(o, Z) <= Z.r + AI.zoneEngage)
        .sort((a, b) => d2(a, Z) - d2(b, Z) || d2(a, u) - d2(b, u));
    if (threats.length) {
        attack(s, api, u, threats[0]!, `${u.name}が守りの区域に入った${threats[0]!.name}へ当たる`);
        return;
    }
    if (u.order.type !== 'move') backHome();
}

function holdZone(s: BattleState, api: AiApi, u: UnitState, m: AiMemo): void {
    if (u.engagedWith) return;
    if (u.kind === 'yumi') {
        if (u.order.type !== 'move' || d2(u, home(m)) <= 10) goHome(api, u, m);
        return;
    }
    guardZone(s, api, u, m, () => goHome(api, u, m));
}

function assault(s: BattleState, api: AiApi, u: UnitState, m: AiMemo): void {
    if (u.engagedWith) return;
    const Z = m.zone!;
    const allies = visibleAllies(s);
    if (u.kind === 'yumi') {
        // 届く相手がいれば止まって射る（待機の弓はいちばん近い相手を射る）。いなければ地点へ進む
        if (allies.some((o) => d2(o, u) <= AI.assaultShoot)) {
            if (u.order.type !== 'hold') api.issue(u.id, { type: 'hold' });
            return;
        }
        if (d2(u, Z) > Z.r * 0.5) {
            if (!(u.order.type === 'move' && Math.abs(u.order.x - Z.x) < 6 && Math.abs(u.order.z - Z.z) < 6)) api.issue(u.id, { type: 'move', x: Z.x, z: Z.z });
        } else if (u.order.type !== 'hold' && u.order.type !== 'move') api.issue(u.id, { type: 'hold' });
        return;
    }
    const cur = attackTarget(s, u);
    if (cur && active(cur) && cur.seenBy.enemy && d2(cur, u) <= AI.assaultLeash) return;
    if (m.phase === 'approach') {
        const near = allies.filter((o) => d2(o, u) <= AI.assaultStrike).sort((a, b) => d2(a, u) - d2(b, u));
        if (near.length) {
            attack(s, api, u, near[0]!, `${u.name}が${near[0]!.name}へ襲いかかった`);
            return;
        }
        if (d2(u, Z) > Z.r * 0.5) {
            if (!(u.order.type === 'move' && Math.abs(u.order.x - Z.x) < 6 && Math.abs(u.order.z - Z.z) < 6)) api.issue(u.id, { type: 'move', x: Z.x, z: Z.z });
            return;
        }
        m.phase = 'active';
        m.homeX = u.x;
        m.homeZ = u.z;
    }
    guardZone(s, api, u, m, () => goHome(api, u, m));
}

/** 敵方の武将の能力を、目安に合えば使う（1 合戦 1 回。使えるかの確かめは abilities.ts が行う） */
function enemyAbilities(s: BattleState, api: AiApi): void {
    for (const r of s.abilityList) {
        if (r.side !== 'enemy' || r.usedAt !== null) continue;
        const u = byId(s, r.unitId);
        if (!active(u)) continue;
        const R = ABILITY_DATA[r.id].radius;
        const friends = s.units.filter((o) => o !== u && o.side === 'enemy' && active(o) && d2(o, u) <= R);
        if (r.id === 'nagamasa_support') {
            const need = friends
                .filter((o) => !!o.engagedWith || (o.attackers.length > 0 && o.morale < AI_ABILITY.supportMorale))
                .sort((a, b) => a.morale - b.morale || d2(a, u) - d2(b, u));
            if (need.length && api.useAbility!(u.id, need[0].id) && u.seenBy.ally) api.log(`${u.name}が${need[0].name}を支えに入った`, u.id);
        } else if (r.id === 'ieyasu_rally') {
            const low = [u, ...friends].filter((o) => o.morale < AI_ABILITY.rallyMorale).length;
            if (low >= 2 || u.morale < AI_ABILITY.rallySelfMorale) api.useAbility!(u.id);
        } else if (r.id === 'tadakatsu_rearguard') {
            if (u.engagedWith) continue;
            const fleeing = s.units.some((o) => o !== u && o.side === 'enemy' && o.present && (o.status === 'routed' || o.order.type === 'retreat') && d2(o, u) <= R);
            if (fleeing) api.useAbility!(u.id);
        } else if (r.id === 'sakai_flank') {
            const engaged = [u, ...friends].filter((o) => !!o.engagedWith).length;
            if (engaged >= AI_ABILITY.flankEngaged) api.useAbility!(u.id);
        } else if (r.id === 'ishikawa_reserve') {
            const fighting = [u, ...friends].some((o) => !!o.engagedWith || inMelee(s, o));
            if (friends.length >= AI_ABILITY.reserveFriends && fighting) api.useAbility!(u.id);
        } else if (r.id === 'sakakibara_vanguard') {
            if (u.engagedWith && u.morale >= AI_ABILITY.vanguardMorale) api.useAbility!(u.id);
        }
    }
}

/** u に斬りかかっている相手がいる */
function inMelee(s: BattleState, u: UnitState): boolean {
    return s.units.some((o) => o.side !== u.side && active(o) && o.engagedWith === u.id);
}
