/**
 * 敵の考え（純粋な TypeScript。乱数なし）。sim.ts の stepBattle が 0.5 秒ごとに呼ぶ。
 * 敵の部隊だけを動かす（味方の部隊は利用者の命令だけで動く。待機中に間合いの相手と斬り合うのは sim.ts の決まり）。
 * 敵は「敵から見えている味方」（seenBy.enemy）だけを相手に考える。林の中の味方は 60 m 以内に来るまで気づかない。
 *
 * 役割（UnitDef.aiRole。省けば本陣は guard_hq、ほかは hold_line）：
 * - hold_line：持ち場（最初の位置）を守る。持ち場の 75 m 以内に来た見えている味方が、
 *   ほかの部隊へ向かう・横を通るなら打って出て迎え撃つ（自分へ向かって来る相手は、持ち場で待ち構える）。
 *   持ち場から 120 m より離れた相手は追わず、持ち場へ戻る。矢を 12 秒以上浴び、近くに槍・騎馬がいなければ、射手へ打って出る（誘い出せる）。
 *   弓隊は持ち場を動かず、届く相手を射る。
 * - reserve：味方（敵方）の部隊が崩れた・士気が落ちた・本陣が攻められた・本陣へ近づく相手が見えた、のどれかで動き出し、
 *   本陣を攻めている相手 → 押されている味方の相手 → 本陣に近い相手 の順に向かう。
 * - flank：着いてから 30 秒待ち、自分の側（東なら東、西なら西）を真っすぐ南へ下って相手の横へ出てから、
 *   斬り合っている部隊・弓・本陣・こちらを向いていない部隊を選んで横から当たる。途中で近くに相手が見えたらすぐ当たる。
 * - guard_hq：本陣を守る。本陣そのものは持ち場を動かない。本陣以外なら、本陣の 80 m 以内に来た相手を迎え撃つ。
 */
import type { Order, UnitDef } from './types';
import type { BattleState, UnitState } from './sim';

export type AiRole = NonNullable<UnitDef['aiRole']>;

export const AI = {
    /** hold_line：持ち場からこの距離に来た相手を見る */
    holdEngage: 75,
    /** hold_line：持ち場からこれより離れた相手は追わない */
    holdLeash: 120,
    /** 矢を浴び続けて打って出るまでの秒数・射手までの距離の上限（持ち場から）。
     *  持ち場から provokeCalm 以内に、見えている相手の槍・騎馬・本陣がいるときは、持ち場を離れない */
    provokeSec: 12,
    provokeRange: 160,
    provokeCalm: 110,
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
} as const;

export interface AiMemo {
    role: AiRole;
    homeX: number;
    homeZ: number;
    homeFacing: number;
    /** reserve：動き出したか。flank：'wait' → 'approach' → 'strike' */
    phase: 'idle' | 'active' | 'wait' | 'approach' | 'strike';
    /** 矢を浴びている時間（秒） */
    arrowSec: number;
    waypoint: { x: number; z: number } | null;
}

export interface AiState {
    memo: Record<string, AiMemo>;
}

/** 敵の考えが使う、合戦への窓口（sim.ts が渡す） */
export interface AiApi {
    issue(unitId: string, order: Order): boolean;
    /** 知らせ（見えている部隊の動きだけを知らせる） */
    log(text: string, unitId: string): void;
}

export function createAiState(units: readonly UnitState[]): AiState {
    const memo: Record<string, AiMemo> = {};
    for (const u of units) {
        if (u.side !== 'enemy') continue;
        const role: AiRole = u.aiRole ?? (u.kind === 'honjin' ? 'guard_hq' : 'hold_line');
        memo[u.id] = {
            role,
            homeX: u.x,
            homeZ: u.z,
            homeFacing: u.facing,
            phase: role === 'flank' ? 'wait' : 'idle',
            arrowSec: 0,
            waypoint: null,
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
    for (const u of s.units) {
        const m = s.ai.memo[u.id];
        if (!m || !active(u)) continue;
        // 矢を浴びている時間
        if (s.t - u.lastArrowT < 0.6) m.arrowSec += 0.5;
        else m.arrowSec = Math.max(0, m.arrowSec - 0.25);
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
        }
    }
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
