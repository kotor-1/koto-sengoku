/**
 * 戦場「湖・河岸」（shore）の作戦と釣り合い（docs/fields-group4-request.md の「20. 湖・河岸」・docs/fields-group4-design.md §5）。
 * 東は湖（深い水面。船・水の上の戦いは無い）。湖の岸沿いの補給路の二つの要所（岸の狭まり・南の宿場）を 7 分守り抜く（defend_zones）。
 * 岸の道の北の半分は崖と湖の間の狭い道（近道。狭い正面 2 部隊・狭まりの南に小高い所）、内陸は崖のすぐ西の高地と開けた原。
 * 敵勢は岸の道を槍（始めから）・弓・騎馬（120 秒）で、内陸を槍（40 秒・210 秒）で攻め、内陸の騎馬（70 秒）は高地を越えて崖の南の端を回り、
 * 岸の狭まりを後ろから突く（内陸からの横の攻め）。
 *
 * 確かめること：
 * - データと地形（状態を直接見る）：主目標・副目標・判定の順の説明、湖・崖は通れない、狭い正面は岸の狭い道すべて、高地の東の肩の弓は
 *   岸の弓より遠くまで届く、内陸の騎馬の道は崖の南の端を回って岸の道へ入る。
 * - 主目標に届く作戦（早送り）が 3 つ（岸を固め高地に予備・高地に主力で岸は忠勝隊だけ・岸の外へ打って出る＝準備した正面攻撃）。
 *   16 通り（時刻の行 ±15 秒・見てから押す行に 0〜15 秒の遅れ）で 12 勝以上。作戦どうしで損害・副目標・最後まで戦える部隊が違う。
 * - 準備した正面攻撃と、無計画な攻撃（全部隊で一番近い敵へ当て直す）・無計画に打って出る（弓・能力・予備なしで岸の敵へ）の比べ。
 *   「正面なら必ず負ける」は合格条件にしない（準備した正面攻撃は勝てる）。無計画の結果は記録として書く。
 * - 副目標が作戦で分かれる組：岸を固める（忠勝隊 ✓・戦える部隊が少ない）／高地に主力（忠勝隊 ✗・戦える部隊が多い・損害が少ない）。
 * - 武将の能力の価値が地形で変わる比べ：酒井の両翼の采配は、高地の裾の開けた所で内陸の槍を正面と後ろから挟むと早く崩す。
 *   岸の狭い道で忠勝隊の隣から正面に当たっても、1 も変わらない（狭い正面では横・後ろへ回れず、包囲にならない）。
 * - 地形の価値：岸の狭まりの小高い所と狭い正面があるから、忠勝隊 1 隊で受けられる（小高い所の北へ出ると 16 通りとも狭まりを失う）。
 *   弓の置き場所：高地の東の肩なら岸の弓を崩せる。岸の道の後ろに置くと岸の弓に届かず、損害が大きい。
 * - この戦場で特に見ること：湖に入らない（どの作戦・16 通りでも、どの部隊も x 140 より東へ出ない）、岸の狭い道で詰まらない
 *   （味方同士の詰まりの直し RULES.allyBlockSec の後。命令のまま 10 秒以上動かない味方は、狭い正面の順番待ち＝相手が味方と斬り合っていて
 *   45 m 以内、を除いて無い。e2e/fields-group3.mjs の見張りと同じ分け方）、二つの要所の維持の進み（目標の欄の文）。
 *
 * どれも「早送り」（決まった時刻・見てから押す行で issueOrder・useAbility を出す台本を runToEnd で最後まで進める）。画面の操作ではない。
 * 台本は人が画面でできる程度：最初の配置は 2 秒おきに 1 部隊ずつ押す。命令は 1 つの台本で 16 回まで、続けて押す間は 1 秒以上（テストで確かめる）。
 * 移動の後の向き（face）は使わない。画面では敵の近くの地面を押すとその敵への攻撃になるので、地面の行き先（tap）も、押す点の 20 m 以内に
 * 見えている敵がいればその敵への攻撃にする（tests/proto3d-group3-helpers.ts の tapOrder）。「見てから押す」行は、条件が初めて真になってから
 * 遅れの後に、押す部隊が戦えて相手が見えている（道のある）ときだけ押す（崩れた部隊・見えない相手は押さない。人と同じ）。
 * 16 通りは jitterOf（乱数の種 7。tests/proto3d-field-town_edge.test.ts と同じ作り方）。
 *
 * 作った時の結果（早送り。16 通り。勝ち・平均の損害・最後まで戦える部隊（本陣以外 6 隊のうち）・副目標を果たした数＝損害／内陸の騎馬／忠勝隊・
 * 命令の数（1 通り））：
 * - 岸を固め、高地に予備（KISHI）：16／16 勝・32.8％（最大 43.8）・3.44・14／16／16・12 回。忠勝隊の兵は平均 314 残る。岸の弓を崩す 13。
 * - 高地に主力、岸は忠勝隊だけ（TAKADAI）：16／16 勝・30.3％（最大 41.0）・5.31・12／16／0・11 回。忠勝隊は平均 228 まで削られる。
 * - 岸の外へ打って出る（準備した正面攻撃。FRONTAL）：15／16 勝・26.0％（最大 30.4）・4.75・16／16／16・14 回。岸の弓を 16 通りとも崩す。
 *   負けた 1 通りは、内陸の二番手の槍が家康本陣へ届いて本陣が崩れた（364 秒。打って出た分、内陸が手薄）。
 * - 弓を岸の道の後ろに置く（ROAD。ほかは KISHI と同じ）：16／16 勝・40.4％・3.50・1／16／0。岸の弓を 1 度も崩せず、忠勝隊は平均 92 まで射られる。
 * - 無計画（UNPLANNED）：0／16 勝（記録：平均 164 秒に狭まりか宿場を失う・44.8％・戦える 1.88）。
 *   無計画に打って出る（RASH）：0／16 勝（記録：平均 223 秒に、空いた狭まりを内陸の騎馬に後ろから取られる・40.4％・戦える 3.69）。
 * - 何もしない（HOLD）：167 秒に岸の狭まりを失って負け（始めは忠勝隊が狭まりの中にいるので、最初の命令を出す間はある）。
 * - 忠勝隊を小高い所の北 (120,-70) へ出す（TAKADAI_FWD）：0／16 勝（平均 173 秒に狭まりを失う）。
 * - 酒井の両翼の采配：高地の裾で内陸の槍を挟むとき（TAKADAI_AB）、崩れるまで 38.4 → 33.2 秒・酒井隊と榊原隊の兵の減り 204 → 193
 *   （14／16 通りで 1 秒より早い）。岸の狭まりで忠勝隊の隣から使う（NAR_AB）と、57.0 秒・110 で 16 通りとも 1 も変わらない。
 *   どちらも能力を使わずに主目標に届く（TAKADAI 16／16・NAR 15／16）。
 * - 湖へ出た部隊：どの台本の 16 通りでも 0。命令のまま 10 秒以上動かない味方：0（順番待ちを除く。順番待ちは RASH の 10 通り・UNPLANNED の 1 通りで、
 *   どれも狭い道で前の味方の斬り合いの後ろ）。3 つの作戦の止まっていた最長は 2.3 秒（allyBlockSec 2 秒の後にすり抜ける）。
 *
 * 数字はどれも細かい位置・時刻で動く。そのため、勝ち数・副目標の数は「比べ」と「下限」で確かめ、等しさで縛るのは記録として安定している所
 * （0 勝・16 通りとも同じ、など）だけにした。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, meleeUnreachable, runToEnd, RULES, bowRangeFor, waitReason, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { findPath, isPassable } from '../proto3d/src/battle/pathfind';
import { buildBattleSetup, getField, validateField } from '../proto3d/src/battle/fields';
import { endRuleBriefingLine, objectiveProgress } from '../proto3d/src/battle/objectives';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';
import { atk, nearestEnemy, tapOrder } from './proto3d-group3-helpers';

const SF = getField('shore')!;
/** 二つの要所・湖の岸（この x より東は湖） */
const NARROWS = { x: 120, z: -40 };
const POST = { x: 50, z: 130 };
const LAKE_X = 140;

// ---------------------------------------------------------------- 台本の道具

/** 地面を押す（押す点の 20 m 以内に見えている敵がいれば、その敵への攻撃。画面と同じ） */
interface Tap {
    tap: [number, number];
}
/** 固有能力（対象の要らない能力） */
interface Ab {
    ability: true;
}
type Cmd = Order | Tap | Ab | 'nearest';
type Cond = (s: BattleState) => boolean;
/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]、または [条件, 部隊 id, 命令]（見てから押す。条件が初めて真になった刻みに 1 回） */
type Step = [number, string, Cmd] | [Cond, string, Cmd];

const tap = (x: number, z: number): Tap => ({ tap: [x, z] });
const AB: Ab = { ability: true };

const unitOf = (s: BattleState, id: string) => s.units.find((u) => u.id === id);
/** 部隊が斬り合っている */
const engaged = (id: string): Cond => (s) => !!unitOf(s, id)?.engagedWith;
/** 敵の部隊が崩れた（敗走・全滅・撤退）。まだ現れていない部隊は false */
const gone = (id: string): Cond => (s) => {
    const u = unitOf(s, id);
    return !!u && u.arrived && u.status !== 'ready';
};
/** 部隊が待機している（移動の行き先に着いた。斬り合っていない） */
const idle = (id: string): Cond => (s) => {
    const u = unitOf(s, id);
    return !!u && u.status === 'ready' && u.order.type === 'hold' && !u.engagedWith;
};
/** 敵 eid が見えていて、味方 aid の r m 以内にいる */
const close = (eid: string, aid: string, r: number): Cond => (s) => {
    const e = unitOf(s, eid);
    const a = unitOf(s, aid);
    return !!e && !!a && e.arrived && e.status === 'ready' && e.seenBy.ally && a.status === 'ready' && Math.hypot(e.x - a.x, e.z - a.z) <= r;
};
/** 味方 aid と敵 eid が斬り合っている（どちらかが相手に斬りかかっている） */
const fighting = (aid: string, eid: string): Cond => (s) => {
    const a = unitOf(s, aid);
    const e = unitOf(s, eid);
    return !!a && !!e && a.status === 'ready' && e.status === 'ready' && (a.engagedWith === eid || e.engagedWith === aid);
};
/** 押せる：押す部隊が戦えて、相手が見えていて戦え、道がある（人は崩れた部隊・見えない相手を押さない） */
const can = (aid: string, eid: string): Cond => (s) => {
    const a = unitOf(s, aid);
    const e = unitOf(s, eid);
    return !!a && !!e && a.present && a.status === 'ready' && e.arrived && e.status === 'ready' && e.seenBy.ally && !meleeUnreachable(s, a, e);
};
const ready = (id: string): Cond => (s) => unitOf(s, id)?.status === 'ready';
const and =
    (...cs: Cond[]): Cond =>
    (s) =>
        cs.every((c) => c(s));
const or =
    (...cs: Cond[]): Cond =>
    (s) =>
        cs.some((c) => c(s));
/** 条件が初めて真になってから sec 秒後（人が見てから少し置いて押す） */
function later(cond: Cond, sec: number): Cond {
    const first = new WeakMap<BattleState, number>();
    return (s) => {
        if (!first.has(s) && cond(s)) first.set(s, s.t);
        const f = first.get(s);
        return f !== undefined && s.t >= f + sec - 1e-9;
    };
}
/**
 * 揺らぎ：t は時刻の行の時刻をずらす、d は「見てから押す」行に足す遅れ（人が状況を見てから押すまで。秒）。
 * 1 通り（J0）はどちらも 0。16 通りは jitterOf（乱数の種 7。時刻の行は ±15 秒、見てから押す行は 0〜15 秒の遅れ）
 */
interface J {
    t: (x: number) => number;
    d: () => number;
}
const J0: J = { t: (x) => x, d: () => 0 };
function jitterOf(k: number): J {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < k * 40; i++) rnd();
    return { t: (x) => (x === 0 ? 0 : x + Math.round((rnd() - 0.5) * 30)), d: () => Math.round(rnd() * 15) };
}
/** 台本は揺らぎを受け取って行の並びを返す */
type Plan = (j: J) => Step[];
/** 見てから押す攻撃：cond が初めて真になってから sec 秒と揺らぎの遅れの後、押せるときに aid で eid へ攻撃 */
const hit = (cond: Cond, sec: number, j: J, aid: string, eid: string): Step => [and(later(cond, sec + j.d()), can(aid, eid)), aid, atk(eid)];

interface Run {
    o: BattleOutcome;
    t: number;
    /** 味方の兵の損害の割合（0〜1） */
    loss: number;
    left: Record<string, number>;
    refused: string[];
    /** 命令を出した時刻（人が押した時刻） */
    cmdT: number[];
    /** 湖（x 140 より東）へ出た部隊（id@時刻。最初の 3 つ） */
    lake: string[];
    /** 命令のまま 10 秒以上 1.5 m も動かなかった味方（狭い正面の順番待ちを除く。e2e/fields-group3.mjs と同じ分け方） */
    stuck: string[];
    /** 斬り合いの順番待ち（sim.ts の waitReason が queue）で 10 秒以上待った味方 */
    queue: string[];
    /** 止まっていた最長（秒。順番待ちを除く） */
    still: number;
    /** 目標の欄の文（秒 → 主目標の進みの文） */
    progress: Map<number, string>;
    s: BattleState;
}

function play(steps: Step[], each?: (s: BattleState) => void): Run {
    const s = createBattle(buildBattleSetup(SF, 'standard'));
    const timed = steps.filter((x): x is [number, string, Cmd] => typeof x[0] === 'number').sort((a, b) => a[0] - b[0]);
    const watch = steps.filter((x): x is [Cond, string, Cmd] => typeof x[0] === 'function');
    const fired = new Set<number>();
    const refused: string[] = [];
    const cmdT: number[] = [];
    const lake = new Set<string>();
    const anchor = new Map<string, { x: number; z: number; t: number; order: string; done: boolean }>();
    const stuck: string[] = [];
    const queue: string[] = [];
    let still = 0;
    const progress = new Map<number, string>();
    const run = (st: BattleState, label: string, id: string, ord: Cmd) => {
        cmdT.push(st.t);
        if (ord === 'nearest') {
            const n = nearestEnemy(st, id);
            if (n && !issueOrder(st, id, n)) refused.push(`${label}:${id}`);
        } else if ('ability' in ord) {
            if (!useAbility(st, id).ok) refused.push(`${label}:${id}`);
        } else if (!issueOrder(st, id, 'tap' in ord ? tapOrder(st, ord.tap) : ord)) refused.push(`${label}:${id}`);
    };
    const o = runToEnd(s, (st) => {
        while (timed.length && st.t >= timed[0]![0] - 1e-9) {
            const [t, id, ord] = timed.shift()!;
            run(st, String(t), id, ord);
        }
        watch.forEach(([cond, id, ord], i) => {
            if (fired.has(i) || !cond(st)) return;
            fired.add(i);
            run(st, `when${i}@${st.t.toFixed(1)}`, id, ord);
        });
        for (const u of st.units) {
            if (!u.present) continue;
            if (u.x > LAKE_X + 0.5 && lake.size < 3) lake.add(`${u.id}@${st.t.toFixed(1)}`);
            if (u.side !== 'ally') continue;
            // 動かない部隊（移動・攻撃の命令のまま、斬り合い・射撃なしで 1.5 m も動かない。行き先まで 8 m 以内は除く）
            const od = u.order;
            const tg = od.type === 'attack' ? unitOf(st, od.targetId) : undefined;
            const goal = od.type === 'move' ? od : tg && tg.present && tg.status === 'ready' ? tg : null;
            const hitBy = st.units.some((e) => e.side !== u.side && e.present && e.status === 'ready' && e.engagedWith === u.id);
            if (!goal || u.status !== 'ready' || u.engagedWith || u.shootingAt || hitBy) {
                anchor.delete(u.id);
                continue;
            }
            const oj = JSON.stringify(od);
            const a = anchor.get(u.id);
            if (!a || Math.hypot(u.x - a.x, u.z - a.z) > 1.5 || a.order !== oj) {
                anchor.set(u.id, { x: u.x, z: u.z, t: st.t, order: oj, done: false });
                continue;
            }
            if (Math.hypot(u.x - goal.x, u.z - goal.z) <= 8) continue;
            // 順番待ち：sim.ts の waitReason（e2e/fields-group3.mjs の見張りと同じ。狭い正面であふれた・攻撃の相手が味方と斬り合っている・
            // 行く手の筋の上で味方が斬り合っている・前の味方が敵に止められている。すり抜けの対象にしない）
            const inQueue = waitReason(st, u) === 'queue';
            if (!inQueue) still = Math.max(still, st.t - a.t);
            if (a.done || st.t - a.t < 10) continue;
            a.done = true;
            (inQueue ? queue : stuck).push(`${u.id}@${a.t.toFixed(1)}(${a.x.toFixed(0)},${a.z.toFixed(0)})`);
        }
        const sec = Math.round(st.t * 10);
        if (sec % 100 === 0) progress.set(sec / 10, objectiveProgress(st).find((p) => p.role === 'primary')!.progressText);
        each?.(st);
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    return { o, t: s.t, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused, cmdT, lake: [...lake], stuck, queue, still, progress, s };
}

/** 16 通り（揺らぎ k = 0〜15） */
function jitter(plan: Plan): Run[] {
    return Array.from({ length: 16 }, (_, k) => play(plan(jitterOf(k))));
}

const won = (r: Run) => r.o.result === 'victory' && r.o.objectives?.primary?.achieved === true;
const sec = (r: Run, id: string) => r.o.objectives!.secondary.find((x) => x.id === id)!.achieved;
const wins = (rs: Run[]) => rs.filter(won).length;
const count = (rs: Run[], id: string) => rs.filter((r) => sec(r, id)).length;
const mean = (rs: Run[], f: (r: Run) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
/** 本陣以外で、最後まで戦える（崩れていない）部隊の数 */
const FIGHTERS = ['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_sakakibara', 'a_kiba', 'a_yumi'];
const standing = (r: Run) => FIGHTERS.filter((id) => r.o.units.find((u) => u.id === id)!.status === 'ready').length;
const broke = (r: Run, id: string) => r.o.units.find((u) => u.id === id)!.status !== 'ready';
const brief = (r: Run) =>
    `${r.o.result}/${r.o.reason} t=${r.t.toFixed(1)} loss=${(r.loss * 100).toFixed(1)}% ${r.o.objectives?.secondary.map((x) => `${x.id}:${x.achieved ? '✓' : '✗'}`).join(' ')} refused=${r.refused.join(',')} stuck=${r.stuck.join(',')} lake=${r.lake.join(',')}`;

/** 同じ台本は 1 回だけ進める */
const memo = new Map<Plan, Run>();
const once = (p: Plan) => {
    if (!memo.has(p)) memo.set(p, play(p(J0)));
    return memo.get(p)!;
};
const memo16 = new Map<Plan, Run[]>();
const sixteen = (p: Plan) => {
    if (!memo16.has(p)) memo16.set(p, jitter(p));
    return memo16.get(p)!;
};

// ---------------------------------------------------------------- 台本

/** 弓：高地の東の肩に着いて待機になり、岸の弓が見えたら、岸の弓を射る（見てから押す） */
const bowDuel = (j: J): Step => hit((s) => s.t > 5 && idle('a_yumi')(s), 0, j, 'a_yumi', 'e_shore_yumi');

/**
 * 岸を固め、高地に予備（命令 15 回）：忠勝隊は狭まりの小高い所のまま、騎馬をその後ろ (125,0)、弓を高地の東の肩 (62,-55)。
 * 酒井隊を内陸の道の正面（高地の南西の裾 (-30,5)）、榊原隊を高地の上 (0,-35)、石川隊を二の備え (-5,40)、家康本陣は宿場の脇 (40,155)。
 * 忠勝隊が斬り合ったら騎馬も槍へ（狭い正面の 2 隊目）。内陸の槍が酒井隊に近づいたら酒井隊が当たり、榊原隊が高地から後ろへ。
 * 内陸の騎馬が石川隊に近づいたら石川隊が当たり、内陸の槍が崩れたら榊原隊も騎馬へ。二番手の槍は、斬り合いを見て酒井隊・榊原隊で挟む
 */
const KISHI: Plan = (j) => [
    [j.t(2), 'a_yumi', tap(62, -55)],
    [j.t(4), 'a_kiba', tap(125, 0)],
    [j.t(6), 'a_sakai', tap(-30, 5)],
    [j.t(8), 'a_sakakibara', tap(0, -35)],
    [j.t(10), 'a_ishikawa', tap(-5, 40)],
    [j.t(12), 'a_ieyasu', tap(40, 155)],
    bowDuel(j),
    hit(engaged('a_tadakatsu'), 0, j, 'a_kiba', 'e_shore_yari'),
    hit(close('e_inland_yari', 'a_sakai', 70), 0, j, 'a_sakai', 'e_inland_yari'),
    hit(fighting('a_sakai', 'e_inland_yari'), 0, j, 'a_sakakibara', 'e_inland_yari'),
    hit(close('e_inland_kiba', 'a_ishikawa', 80), 0, j, 'a_ishikawa', 'e_inland_kiba'),
    hit(gone('e_inland_yari'), 0, j, 'a_sakakibara', 'e_inland_kiba'),
    hit(or(fighting('a_sakakibara', 'e_inland_yari2'), fighting('a_ishikawa', 'e_inland_yari2')), 0, j, 'a_sakai', 'e_inland_yari2'),
    hit(or(fighting('a_sakai', 'e_inland_yari2'), fighting('a_ishikawa', 'e_inland_yari2')), 1, j, 'a_sakakibara', 'e_inland_yari2'),
];
/**
 * 高地に主力、岸は忠勝隊だけ（命令 13 回）：忠勝隊は狭まりの小高い所で 1 隊で受ける（狭い正面）。弓は高地の東の肩、騎馬も高地 (15,-15)。
 * 酒井隊を内陸の道の正面、榊原隊を高地の上。内陸の槍は酒井隊と榊原隊で挟み、内陸の騎馬は騎馬が迎え、内陸の槍が崩れたら榊原隊も。
 * 石川隊は宿場のまま
 */
const TAKADAI: Plan = (j) => [
    [j.t(2), 'a_yumi', tap(62, -55)],
    [j.t(4), 'a_kiba', tap(15, -15)],
    [j.t(6), 'a_sakai', tap(-30, 5)],
    [j.t(8), 'a_sakakibara', tap(0, -35)],
    [j.t(10), 'a_ieyasu', tap(40, 155)],
    bowDuel(j),
    hit(close('e_inland_yari', 'a_sakai', 70), 0, j, 'a_sakai', 'e_inland_yari'),
    hit(fighting('a_sakai', 'e_inland_yari'), 0, j, 'a_sakakibara', 'e_inland_yari'),
    hit(close('e_inland_kiba', 'a_kiba', 90), 0, j, 'a_kiba', 'e_inland_kiba'),
    hit(and(gone('e_inland_yari'), fighting('a_kiba', 'e_inland_kiba')), 0, j, 'a_sakakibara', 'e_inland_kiba'),
    hit(or(fighting('a_sakakibara', 'e_inland_yari2'), fighting('a_kiba', 'e_inland_yari2')), 0, j, 'a_sakai', 'e_inland_yari2'),
    hit(or(fighting('a_sakai', 'e_inland_yari2'), fighting('a_kiba', 'e_inland_yari2')), 1, j, 'a_sakakibara', 'e_inland_yari2'),
];
/**
 * 岸の外へ打って出る（準備した正面攻撃。命令 14 回）：弓は高地の東の肩から岸の弓を射る。騎馬を狭まりの後ろ、榊原隊を岸の道 (115,20)。
 * 忠勝隊が斬り合ったら騎馬も槍へ。岸の槍が崩れたら、榊原隊（先駆けの号は弓に強い）と忠勝隊で岸の弓へ打って出て、榊原隊が斬り合ったら
 * 先駆けの号。岸の弓が崩れたら忠勝隊を狭まりの小高い所へ戻す（内陸の騎馬が後ろへ来る前に）。内陸は酒井隊が道の正面、石川隊が二の備え
 */
const FRONTAL: Plan = (j) => [
    [j.t(2), 'a_yumi', tap(62, -55)],
    [j.t(4), 'a_kiba', tap(125, 0)],
    [j.t(6), 'a_sakakibara', tap(115, 20)],
    [j.t(8), 'a_sakai', tap(-30, 5)],
    [j.t(10), 'a_ishikawa', tap(-5, 40)],
    [j.t(12), 'a_ieyasu', tap(40, 155)],
    bowDuel(j),
    hit(engaged('a_tadakatsu'), 0, j, 'a_kiba', 'e_shore_yari'),
    hit(gone('e_shore_yari'), 0, j, 'a_sakakibara', 'e_shore_yumi'),
    hit(gone('e_shore_yari'), 1, j, 'a_tadakatsu', 'e_shore_yumi'),
    [and(later(fighting('a_sakakibara', 'e_shore_yumi'), j.d()), ready('a_sakakibara')), 'a_sakakibara', AB],
    [and(later(gone('e_shore_yumi'), j.d()), ready('a_tadakatsu')), 'a_tadakatsu', tap(120, -20)],
    hit(close('e_inland_yari', 'a_sakai', 70), 0, j, 'a_sakai', 'e_inland_yari'),
    hit(close('e_inland_kiba', 'a_ishikawa', 80), 0, j, 'a_ishikawa', 'e_inland_kiba'),
];
/** 弓を岸の道の後ろ (120,10) に置く（ほかは KISHI と同じ。岸の弓は射ない。命令 14 回） */
const ROAD: Plan = (j) => KISHI(j).map((x): Step => (x[1] === 'a_yumi' && typeof x[0] === 'number' ? [x[0], 'a_yumi', tap(120, 10)] : x)).filter((x) => !(x[1] === 'a_yumi' && typeof x[0] === 'function'));
/** 無計画に打って出る：忠勝隊・騎馬で岸の槍へ、榊原隊で岸の弓へ（弓の支え・能力・予備なし）。酒井隊は内陸の道の正面、家康本陣は宿場の脇 */
const RASH: Plan = (j) => [
    [j.t(2), 'a_tadakatsu', atk('e_shore_yari')],
    [j.t(4), 'a_kiba', atk('e_shore_yari')],
    [j.t(6), 'a_sakakibara', atk('e_shore_yumi')],
    [j.t(8), 'a_sakai', tap(-30, 5)],
    [j.t(10), 'a_ieyasu', tap(40, 155)],
];
/** 無計画：全部隊（本陣のほか）で、見えている一番近い敵へ 10 秒ごとに当て直す（第3群の共通の台本と同じ。命令の数の上限の外） */
const UNPLANNED: Plan = (j) => {
    const o: Step[] = [];
    for (const id of FIGHTERS) for (let t = 1; t < 450; t += 10) o.push([j.t(t), id, 'nearest']);
    return o;
};
/** 何もしない */
const HOLD: Plan = () => [];

/** 酒井の両翼の采配：高地に主力で、酒井隊が内陸の槍と斬り合ったのを見て使う（榊原隊が後ろから当たるのとほぼ同時） */
const TAKADAI_AB: Plan = (j) => [...TAKADAI(j), [and(later(fighting('a_sakai', 'e_inland_yari'), 1 + j.d()), ready('a_sakai')), 'a_sakai', AB]];
/**
 * 酒井隊を岸の狭まりへ（忠勝隊の隣で岸の槍に正面から当たる。命令 13 回）：弓は高地の東の肩、騎馬と榊原隊は高地、石川隊を内陸の道の正面
 */
const NAR: Plan = (j) => [
    [j.t(2), 'a_yumi', tap(62, -55)],
    [j.t(4), 'a_sakai', tap(118, 5)],
    [j.t(6), 'a_kiba', tap(15, -15)],
    [j.t(8), 'a_sakakibara', tap(0, -35)],
    [j.t(10), 'a_ishikawa', tap(-30, 5)],
    [j.t(12), 'a_ieyasu', tap(40, 155)],
    bowDuel(j),
    hit(and(engaged('a_tadakatsu'), idle('a_sakai')), 0, j, 'a_sakai', 'e_shore_yari'),
    hit(close('e_inland_yari', 'a_ishikawa', 70), 0, j, 'a_ishikawa', 'e_inland_yari'),
    hit(fighting('a_ishikawa', 'e_inland_yari'), 0, j, 'a_sakakibara', 'e_inland_yari'),
    hit(close('e_inland_kiba', 'a_kiba', 90), 0, j, 'a_kiba', 'e_inland_kiba'),
];
const NAR_AB: Plan = (j) => [...NAR(j), [and(later(fighting('a_sakai', 'e_shore_yari'), 1 + j.d()), ready('a_sakai')), 'a_sakai', AB]];
/** 忠勝隊を小高い所の北 (120,-70) へ出す（ほかは TAKADAI と同じ。命令 13 回） */
const TAKADAI_FWD: Plan = (j) => [[j.t(1), 'a_tadakatsu', tap(120, -70)], ...TAKADAI(j)];

const PLANS: Record<string, Plan> = { KISHI, TAKADAI, FRONTAL, ROAD, RASH, TAKADAI_AB, NAR, NAR_AB, TAKADAI_FWD };
const MAIN: Record<string, Plan> = { KISHI, TAKADAI, FRONTAL };

// ---------------------------------------------------------------- テスト

describe('湖・河岸のデータ（状態を直接見る）', () => {
    it('検査を通る。主目標は二つの要所を 7 分守る（敵本陣の撃破ではない）。副目標 3 つ。判定の順の説明が合戦の前の説明の最後にある。部隊数は上限内', () => {
        expect(validateField(SF)).toEqual([]);
        const p = SF.objectives.primary;
        expect(p.type).toBe('defend_zones');
        if (p.type !== 'defend_zones') return;
        expect([p.sec, p.minHeld, p.loseSec, p.names]).toEqual([420, 2, 15, ['岸の狭まり', '南の宿場']]);
        expect(p.zones.map((z) => [z.circle!.cx, z.circle!.cz])).toEqual([
            [NARROWS.x, NARROWS.z],
            [POST.x, POST.z],
        ]);
        expect(SF.objectives.secondary.map((x) => x.id)).toEqual(['shore_losses', 'shore_kiba', 'shore_tadakatsu']);
        const s = createBattle(buildBattleSetup(SF, 'standard'));
        const line = endRuleBriefingLine(s.setup)!;
        expect(s.setup.briefing[s.setup.briefing.length - 1]).toBe(line);
        expect(line).toContain('主目標「二つの要所を 7 分まで守り抜く」');
        const us = SF.presets[0]!.units;
        expect(us.filter((u) => u.side === 'ally').length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.ally);
        expect(us.filter((u) => u.side === 'enemy').length).toBe(8);
        expect(us.filter((u) => u.side === 'enemy').length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.enemy);
        // 船・水の上の部隊は無い（どの部隊も陸の上から始まる）
        for (const u of s.units) expect([u.id, u.x <= LAKE_X]).toEqual([u.id, true]);
    });

    it('湖と崖は通れない。狭い正面は崖と湖の間の岸の道すべて。忠勝隊は始めから狭まりの小高い所にいる。高地の東の肩の弓は岸の弓より遠くまで届く', () => {
        const s = createBattle(buildBattleSetup(SF, 'standard'));
        const nav = s.field.nav!;
        expect(isPassable(nav, 180, 0)).toBe(false); // 湖
        expect(isPassable(nav, 85, -40)).toBe(false); // 崖
        expect(isPassable(nav, 120, -40)).toBe(true); // 岸の狭まり
        expect(isPassable(nav, 85, 60)).toBe(true); // 崖の南の端より南は開けている
        const nf = SF.specialRules!.find((r) => r.type === 'narrow_frontage')!;
        expect(nf.type === 'narrow_frontage' && nf.zone.rect).toEqual({ x0: 100, x1: 140, z0: -220, z1: 40 });
        const t = s.units.find((u) => u.id === 'a_tadakatsu')!;
        expect([t.x, t.z]).toEqual([120, -20]);
        // 小高い所（高さ 5）：北から狭まりへ来る相手（120,-45）より 2 m 以上高い
        const elev = (x: number, z: number) => {
            let h = 0;
            for (const a of s.map.terrain) if (a.kind === 'hill' && a.circle) h = Math.max(h, (a.height ?? 10) * Math.max(0, 1 - Math.hypot(x - a.circle.cx, z - a.circle.cz) ** 2 / a.circle.r ** 2));
            return h;
        };
        expect(elev(120, -20) - elev(120, -45)).toBeGreaterThanOrEqual(2);
        // 高地の東の肩 (62,-55) から、岸の弓の持ち場 (120,-110) へ：140 m まで届く。岸の弓からは 120 m（高さの上乗せなし）
        expect(bowRangeFor(s, { x: 62, z: -55 }, { x: 120, z: -110 })).toBe(RULES.bowRange + 20);
        expect(bowRangeFor(s, { x: 120, z: -110 }, { x: 62, z: -55 })).toBe(RULES.bowRange);
    });

    it('敵の道：内陸の槍は高地の西の裾を通って宿場へ。内陸の騎馬は崖の南の端を回って岸の道へ入り、岸の狭まりを後ろ（南）から突く', () => {
        const s = createBattle(buildBattleSetup(SF, 'standard'));
        const nav = s.field.nav!;
        // 道筋（曲がり角の点の並び。始まりの点を足す）の線分と点の距離の最小
        const minDist = (from: { x: number; z: number }, pts: { x: number; z: number }[], c: { x: number; z: number }) => {
            let best = Infinity;
            let a = from;
            for (const b of pts) {
                const dx = b.x - a.x;
                const dz = b.z - a.z;
                const k = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
                best = Math.min(best, Math.hypot(a.x + dx * k - c.x, a.z + dz * k - c.z));
                a = b;
            }
            return best;
        };
        const yari = findPath(nav, 'yari', -155, -200, POST.x, POST.z)!;
        expect(yari).toBeTruthy();
        // 高地（中心 (20,-40)・半径 60）の頂の近くは通らず、西の裾をかすめる（作った時 59 m）
        const dy = minDist({ x: -155, z: -200 }, yari, { x: 20, z: -40 });
        expect(dy).toBeGreaterThan(50);
        expect(dy).toBeLessThan(75);
        const kiba = findPath(nav, 'kiba', -200, -200, NARROWS.x, NARROWS.z)!;
        expect(kiba).toBeTruthy();
        // 崖の南の端（z 40）より南を回ってから、岸の道（x 100〜140）を北へ上る（作った時の曲がり角：(73,43)・(103,43)・(120,-40)）
        expect(kiba.some((p) => p.z > 40 && p.x < 100)).toBe(true);
        const k = kiba.findIndex((p) => p.x >= 100 && p.x <= 140 && p.z > 30);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(kiba.slice(k).every((p) => p.x >= 100 && p.x <= 140)).toBe(true);
    });
});

describe('湖・河岸の作戦（早送り）', () => {
    it('台本は人が画面でできる程度：命令は 16 回まで、続けて押す間は 1 秒以上、向き（face）は使わない、断られた命令は無い', () => {
        for (const [name, p] of Object.entries(PLANS)) {
            const r = once(p);
            expect([name, r.cmdT.length <= 16]).toEqual([name, true]);
            const ts = [...r.cmdT].sort((a, b) => a - b);
            const gaps = ts.slice(1).map((t, i) => t - ts[i]!);
            expect([name, Math.min(...gaps) >= 1 - 1e-6]).toEqual([name, true]);
            expect([name, r.refused]).toEqual([name, []]);
            for (const x of p(J0)) if (typeof x[2] === 'object' && 'type' in x[2] && x[2].type === 'move') expect(x[2].face).toBeUndefined();
        }
        // 16 通りでも断られた命令は無い
        for (const [name, p] of Object.entries(MAIN)) for (const r of sixteen(p)) expect([name, r.refused]).toEqual([name, []]);
    }, 300_000);

    it('主目標に届く作戦が 3 つ（岸を固め高地に予備・高地に主力・岸の外へ打って出る）。どれも 16 通りで 12 勝以上', () => {
        for (const p of Object.values(MAIN)) expect(won(once(p)), brief(once(p))).toBe(true);
        // 作った時：16・16・15
        expect(wins(sixteen(KISHI))).toBeGreaterThanOrEqual(15);
        expect(wins(sixteen(TAKADAI))).toBeGreaterThanOrEqual(15);
        expect(wins(sixteen(FRONTAL))).toBeGreaterThanOrEqual(13);
    }, 300_000);

    it('作戦どうしの違い：岸を固めると忠勝隊は残るが戦える部隊が減る。高地に主力だと忠勝隊が削られるが損害が少なく戦える部隊が多い', () => {
        const k = sixteen(KISHI);
        const t = sixteen(TAKADAI);
        // 忠勝隊を兵 6 割以上で残す（16 通り）：岸を固める 16 ／高地に主力 0
        expect(count(k, 'shore_tadakatsu')).toBeGreaterThanOrEqual(14);
        expect(count(t, 'shore_tadakatsu')).toBeLessThanOrEqual(2);
        // 最後まで戦える部隊（平均）：3.44 ／ 5.31。損害（平均）：32.8％ ／ 30.3％
        expect(mean(t, standing)).toBeGreaterThan(mean(k, standing) + 1);
        expect(mean(t, (r) => r.loss)).toBeLessThan(mean(k, (r) => r.loss));
        // 忠勝隊の残りの兵（平均）：314 ／ 228
        expect(mean(k, (r) => r.left.a_tadakatsu!)).toBeGreaterThan(mean(t, (r) => r.left.a_tadakatsu!) + 50);
    }, 300_000);

    it('副目標が作戦で分かれる：岸を固める（忠勝隊 ✓）と高地に主力（忠勝隊 ✗）。1 回の台本でも同じ分かれ方', () => {
        expect(sec(once(KISHI), 'shore_tadakatsu')).toBe(true);
        expect(sec(once(TAKADAI), 'shore_tadakatsu')).toBe(false);
        // 内陸の騎馬はどちらも崩す（作った時 16 ／ 16）
        expect(count(sixteen(KISHI), 'shore_kiba')).toBeGreaterThanOrEqual(14);
        expect(count(sixteen(TAKADAI), 'shore_kiba')).toBeGreaterThanOrEqual(14);
    }, 300_000);

    it('準備した正面攻撃（岸の外へ打って出る）と無計画な攻撃の比べ：準備した方は主目標に届き、長く戦い、戦える部隊が多い（無計画の結果は記録）', () => {
        const front = sixteen(FRONTAL);
        const raw = sixteen(UNPLANNED);
        const rash = sixteen(RASH);
        // 準備した正面攻撃 15／16 勝（作った時）。無計画 0／16（平均 164 秒）、無計画に打って出る 0／16（平均 223 秒）
        expect(wins(raw)).toBe(0);
        expect(wins(rash)).toBe(0);
        expect(wins(front)).toBeGreaterThan(wins(rash) + 10);
        expect(mean(front, (r) => r.t)).toBeGreaterThan(mean(rash, (r) => r.t) + 150);
        expect(mean(front, (r) => r.t)).toBeGreaterThan(mean(raw, (r) => r.t) + 150);
        // 最後まで戦える部隊（平均）：準備 4.75 ／無計画 1.88 ／無計画に打って出る 3.69
        expect(mean(front, standing)).toBeGreaterThan(mean(raw, standing) + 2);
        expect(mean(front, standing)).toBeGreaterThan(mean(rash, standing));
        // 損害（平均）：準備 26.0％ ／無計画 44.8％ ／打って出る 40.4％
        expect(mean(front, (r) => r.loss)).toBeLessThan(mean(raw, (r) => r.loss) - 0.1);
        expect(mean(front, (r) => r.loss)).toBeLessThan(mean(rash, (r) => r.loss));
        // どちらも岸の弓は崩す（打って出た先で）が、無計画に打って出ると、内陸の騎馬に後ろの狭まりを取られる
        expect(front.filter((r) => broke(r, 'e_shore_yumi')).length).toBe(16);
        expect(rash.every((r) => r.o.reason === 'objective_failed' && (r.s.objectives!.primary!.zoneLost[0] || r.s.objectives!.primary!.zoneLost[1]))).toBe(true);
    }, 300_000);

    it('記録：何もしないと 167 秒に岸の狭まりを失って負ける（始めは忠勝隊が狭まりの中にいるので、最初の命令を出す間はある）', () => {
        const h = once(HOLD);
        expect([h.o.result, h.o.reason]).toEqual(['defeat', 'objective_failed']);
        expect(h.s.objectives!.primary!.zoneLost).toEqual([true, false]);
        expect(h.t).toBeGreaterThan(120);
        expect(h.t).toBeLessThan(200);
    });

    it('弓の置き場所（地形の価値）：高地の東の肩なら岸の弓を崩せ、損害も少ない。岸の道の後ろでは岸の弓に届かず、狭まりの守り手が射られ続ける', () => {
        const k = sixteen(KISHI);
        const r = sixteen(ROAD);
        expect(k.filter((x) => broke(x, 'e_shore_yumi')).length).toBeGreaterThanOrEqual(12);
        expect(r.filter((x) => broke(x, 'e_shore_yumi')).length).toBe(0);
        expect(mean(r, (x) => x.loss)).toBeGreaterThan(mean(k, (x) => x.loss) + 0.05);
        expect(mean(r, (x) => x.left.a_tadakatsu!)).toBeLessThan(mean(k, (x) => x.left.a_tadakatsu!) - 100);
    }, 300_000);

    it('岸の狭まりの小高い所と狭い正面（地形の価値）：忠勝隊 1 隊で受けられるのは小高い所の上。北へ出ると 16 通りとも狭まりを失う', () => {
        expect(wins(sixteen(TAKADAI))).toBeGreaterThanOrEqual(15);
        const fwd = sixteen(TAKADAI_FWD);
        expect(wins(fwd)).toBe(0);
        expect(fwd.every((r) => r.s.objectives!.primary!.zoneLost[0])).toBe(true);
    }, 300_000);

    it('能力の価値が地形で変わる（酒井の両翼の采配）：高地の裾で内陸の槍を挟むと早く崩す。岸の狭い道で忠勝隊の隣から正面に当たっても 1 も変わらない', () => {
        // 相手と最初に斬り合ってから崩れるまでの秒と、その間の味方 2 隊の兵の減り（16 通りの平均）
        const fight = (p: Plan, enemy: string, allies: string[]) =>
            Array.from({ length: 16 }, (_, k) => {
                let t0 = -1;
                let t1 = -1;
                let a0 = 0;
                let a1 = 0;
                const al = (s: BattleState) => allies.reduce((a, id) => a + unitOf(s, id)!.strength, 0);
                play(p(jitterOf(k)), (s) => {
                    const e = unitOf(s, enemy)!;
                    if (t0 < 0 && e.engagedWith) {
                        t0 = s.t;
                        a0 = al(s);
                    }
                    if (t0 >= 0 && t1 < 0 && e.status !== 'ready') {
                        t1 = s.t;
                        a1 = al(s);
                    }
                });
                return { dur: t1 - t0, lost: a0 - a1 };
            });
        const avg = (xs: { dur: number; lost: number }[], f: (x: { dur: number; lost: number }) => number) => xs.reduce((a, x) => a + f(x), 0) / xs.length;
        const hillNo = fight(TAKADAI, 'e_inland_yari', ['a_sakai', 'a_sakakibara']);
        const hillAb = fight(TAKADAI_AB, 'e_inland_yari', ['a_sakai', 'a_sakakibara']);
        const narNo = fight(NAR, 'e_shore_yari', ['a_sakai', 'a_tadakatsu']);
        const narAb = fight(NAR_AB, 'e_shore_yari', ['a_sakai', 'a_tadakatsu']);
        // 高地の裾（作った時）：38.4 → 33.2 秒・兵の減り 204 → 193。16 通りのうち 14 通りで早く崩れる
        expect(avg(hillAb, (x) => x.dur)).toBeLessThan(avg(hillNo, (x) => x.dur) - 3);
        expect(avg(hillAb, (x) => x.lost)).toBeLessThan(avg(hillNo, (x) => x.lost));
        expect(hillAb.filter((x, k) => x.dur < hillNo[k]!.dur - 1).length).toBeGreaterThanOrEqual(12);
        // 岸の狭い道（作った時）：57.0 秒・110 で、使っても 16 通りとも同じ（包囲にならない）
        expect(narAb).toEqual(narNo);
        // どちらの台本でも、能力を使わなくても主目標に届く（能力の使用は勝ちの必須ではない）
        expect(wins(sixteen(TAKADAI))).toBeGreaterThanOrEqual(15);
        expect(wins(sixteen(NAR))).toBeGreaterThanOrEqual(13);
    }, 300_000);
});

describe('湖・河岸で特に見ること（早送り）', () => {
    it('湖に入らない：どの作戦の 16 通りでも、敵味方どの部隊も x 140 より東（湖）へ出ない', () => {
        for (const [name, p] of Object.entries({ ...PLANS, UNPLANNED })) for (const r of sixteen(p)) expect([name, r.lake]).toEqual([name, []]);
    }, 300_000);

    it('岸の狭い道で詰まらない：命令のまま 10 秒以上動かない味方は、狭い正面の順番待ち（相手が味方と斬り合っている）のほかに無い', () => {
        for (const [name, p] of Object.entries({ ...PLANS, UNPLANNED })) for (const r of sixteen(p)) expect([name, r.stuck]).toEqual([name, []]);
        // 3 つの作戦では順番待ちも無く、止まっていた最長は allyBlockSec ＋ 1 秒未満（作った時 2.3 秒まで）
        for (const [name, p] of Object.entries(MAIN))
            for (const r of sixteen(p)) {
                expect([name, r.queue]).toEqual([name, []]);
                expect([name, r.still < RULES.allyBlockSec + 1]).toEqual([name, true]);
            }
        // 無計画に打って出ると、狭い道で 3 隊目が順番待ちになる（記録。狭い正面は 2 部隊まで）
        expect(sixteen(RASH).some((r) => r.queue.length > 0)).toBe(true);
    }, 300_000);

    it('目標の欄の文：二つの要所の維持の進み（守っている数・残り秒・奪われている秒・失った印）', () => {
        const k = once(KISHI);
        expect(k.progress.get(0)).toBe('守っている 2／2（2 以上で残り 420 秒）・岸の狭まり ○・南の宿場 ○');
        expect(k.progress.get(300)).toBe('守っている 2／2（2 以上で残り 120 秒）・岸の狭まり ○・南の宿場 ○');
        const h = once(HOLD);
        // 何もしないと、狭まりに敵だけがいる間「奪われている：n／15 秒」が出て、失うと ✕
        const taking = [...h.progress.values()].filter((x) => x.includes('岸の狭まりを敵に奪われている'));
        expect(taking.length).toBeGreaterThan(0);
        expect(taking[0]).toMatch(/岸の狭まりを敵に奪われている：\d+／15 秒/);
        // 失った後（合戦の終わり）は、目標の状態が「失敗」になり、欄は「未達成」
        expect(h.s.objectives!.primary!.state).toBe('failed');
        expect(objectiveProgress(h.s).find((p) => p.role === 'primary')!.progressText).toBe('未達成');
    });
});
