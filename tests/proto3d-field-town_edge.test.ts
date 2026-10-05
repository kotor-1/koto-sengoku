/**
 * 戦場「城下町外縁」（town_edge）の作戦と釣り合い（docs/fields-group3-request.md・docs/fields-group3-design.md §1・§4）。
 * 北の野から、城下町の南の 3 つの出口（西の脇道・大通り・東の門口）へ向かう敵勢の攻め手 7 隊の突破を、7 分まで 2 部隊以内に抑える。
 * 攻め手は時間差で現れ、西の脇道と東の門口には二隊がほぼ同時に着く波が来る（どちらの道へ来るかは、林を出てからの向きで見る）。
 *
 * 確かめること：
 * - データと地形（状態を直接見る）：主目標は突破を抑える（部隊単位）。家屋・塀は通れず射線を遮る。縁は 5 m の格子の線にそろう。
 *   攻め手の道は西の脇道・大通り・東の門口に分かれる。
 * - 主目標に届く作戦（早送り）が 4 つあり、16 通り（±15 秒と見てから押す遅れ）での勝ちを記録する。作戦どうしで損害・突破の数・副目標が違う。
 * - 準備した正面攻撃（野へ打って出る。弓・予備・能力・兵種）と、無計画な攻撃（全部隊で一番近い敵へ当て直すだけ）を分けて比べる。
 *   「正面なら必ず負ける」は合格条件にしない（準備した正面攻撃は勝てるが損害が大きい、無計画は記録）。
 * - 副目標が作戦で分かれる組（辻で挟む：市 ✓・弓 ✗／出口の前：市 ✗／野へ打って出る：弓 ✓・損害 ✗）。
 * - 武将の能力の価値が地形で変わる比べ（酒井の両翼の采配：辻で二方向から挟むと効く／脇道の口の 1 対 1 では効かない）。
 * - 勝ちが、角を挟んで隣り合った部隊が斬り合わずに止まる組（エンジンの既知の穴。下の「止まり」）に頼っていないこと。
 *
 * どれも「早送り」（決まった時刻・見てから押す行で issueOrder・useAbility を出す台本を runToEnd で最後まで進める）。画面の操作ではない。
 * 台本は人が画面でできる程度にしている：最初の配置は 2 秒おきに 1 部隊ずつ押す。命令は 1 つの台本で 16 回まで、続けて押す間は 1 秒以上
 * （テストで確かめる）。台本は移動の後の向き（face）を使わない。部隊は進んだ向きを向くので、北を向かせたい所へは、
 * いったん南へ行き過ぎてから北へ押し戻す（2 回押す。押し戻しが短いと向き直りきらない）。画面では「向き」（T）でその場で向き直らせることも
 * できる（確かめの指摘で足した。tests/proto3d-battle-review-group3.test.ts）。画面では敵の近くの地面を押すとその敵への攻撃に
 * なるので、台本の地面の行き先（tap）も、押す点の 20 m 以内に見えている敵がいればその敵への攻撃にする（tests/proto3d-group3-helpers.ts）。
 * 'nearest' は「見えている一番近い敵を押す」（当て直し）。待機の味方は、隣で味方が斬り合っていても自分からは斬りかからないので、挟むには押す。
 * 16 通りは、0 秒でない時刻の行を ±15 秒ずらし、「見てから押す」行に人が見てから押すまでの遅れ 0〜15 秒を足す（乱数の種 7。
 * 城攻め前面・寺社周辺・湿地のテストと同じ作り方。前は時刻の行だけをずらしていた＝確かめの指摘で揃えた）。
 *
 * 見てから押す遅れを足した後の結果（早送り。16 通り。1 通りの結果は変わらない）：
 * - 辻で挟む（WATCH）：11／16 勝・損害 24.3％（最大 43.1）・突破 1.94・副目標 15／11／0・戦える 3.75。負けた 5 通りは、東の門口へ来る二隊
 *   （槍と騎馬）が抜け、西の騎馬が 3 部隊目になる（東の辻で挟む応じ手が遅れる）。
 * - 出口の前で受ける（EXITS）：13／16 勝・29.8％・突破 2.19・8／0／0・3.63。準備した正面攻撃（FRONTAL）：15／16 勝・41.2％・突破 2.00・0／15／15・3.50。
 * - 町の北の口で受けて回す（MOUTH）：16／16 勝・31.1％・突破 0.50・8／16／0・4.38。動かさない（STATIC）：16／16 勝・26.8％・突破 1.63・3.13。
 * - 大通りに集中（MAIN）：0／16 勝。無計画（UNPLANNED）：2／16 勝・平均 315 秒で終わる・25.5％・突破 2.81。
 *
 * 第4群の 2 つの直しの後（早送り。16 通り。前 → 後）：
 * - 味方の退き口を、西の脇道の出口（敵の突破口）から裏通りの南の路地の口 (-110,198) へ移した（地図・説明で用途を分ける）。攻め手の道は変わらない。
 *   変わったのは、出口の前で受ける（裏通りの西の端に置いた部隊が崩れたとき、退き口まで遠くなって追われる）：損害 29.8 → 31.1％・損害 3 割以内 8 → 5
 *   （勝ち 13・突破 2.19・戦える 3.63 は同じ）と、無計画（損害 24.4 → 24.2％・戦える 4.06 → 4.00）。ほかの作戦は同じ。
 * - 味方同士の詰まりの決まり（RULES.allyBlockSec 2 秒。前は待機の味方に 12 秒・止まっている味方に 20 秒塞がれてからすり抜けた）：
 *   辻で挟む 11 勝・24.3％・突破 1.94・戦える 3.75 → 11 勝・23.9％・1.94・3.75、出口の前は同じ、野へ打って出る・大通りに集中も同じ、
 *   動かさない 16 勝・26.8％・1.63・3.13 → 16 勝・26.7％・1.63・3.13、
 *   町の北の口 16 勝・31.1％・0.50・4.38 → 15 勝・33.2％・0.69・4.00（下の「準備した正面攻撃と地形に合った作戦の比べ」の注）、
 *   無計画 2 勝・25.5％・2.81・3.94 → 3 勝・24.4％・2.75・4.06。
 * 第4群の確かめの直し（味方だけに塞がれた時間を、よけて回る間も「残りの道のりを縮められない時間」で数える・止まっている味方だけに塞がれている間は
 * 「道を塞がれて」の待機にしない・損害を抑える副目標は負けて終えたら果たせない）の後（早送り。16 通り。前 → 後）：
 *   町の北の口 15 勝・33.2％・0.69・4.00 → 16 勝・31.1％・0.50・4.38（allyBlockSec の前の数字に戻った。比べの幅 0.4 → 0.8・0.75 → 1 も戻した）、
 *   辻で挟む 11 勝・23.9％・1.94・3.75 → 11 勝・24.3％・1.94・3.75（損害 3 割以内 15 → 11）、無計画 3 勝・24.4％・2.75・4.06 → 4 勝・22.4％・2.75・4.38、
 *   出口の前（13 勝・31.1％・2.19・3.63・損害 3 割以内 5）・野へ打って出る（15 勝・41.2％・2.00・3.50）・動かさない（16 勝・26.7％・1.63・3.13）・大通りに集中は同じ。
 * 作った時の結果（早送り。16 通りは時刻の行だけをずらしたもの。勝ち数・平均の損害・平均の突破の数・副目標を果たした数。損害 3 割以内／市／野の弓）：
 * - 辻で挟み、波を見て弓を回す（WATCH）：16／16 勝・損害 20.5％・突破 0.38・損害 16／市 16／弓 0。最後まで戦える部隊 平均 5.0。
 * - 出口の前で受ける（EXITS）：16／16 勝・損害 29.5％・突破 2.00（東の二隊に抜けられ、許容を使い切る）・損害 6／市 0／弓 0。
 * - 準備した正面攻撃（野へ打って出る。FRONTAL）：16／16 勝・損害 40.5％・突破 2.00・損害 0／市 16／弓 16。最後まで戦える部隊 平均 3.8。
 * - 通りの口に二隊ずつ置いて動かさない（STATIC）：10／16 勝・突破 1.75（記録。第3群の動きの直しの後 13／16 勝・突破 1.38）。町の北の口で 1 対 1 で受ける（MOUTH）：13／16 勝・損害 31.3％（記録）。
 * - 大通りに集中（MAIN）：0／16 勝（記録：脇道・門口から 3 部隊抜けて 245 秒に負け。損害 2.4％）。待つだけ（HOLD）：同じく 245 秒に負け。
 * - 無計画（UNPLANNED）：2／16 勝（記録：平均 311 秒で終わる・損害 22.9％・突破 2.75。野の弓は 16／16 崩す）。
 * - 酒井の両翼の采配：辻（WATCH）で西の二つ目の波を挟むときに使うと、その間の酒井隊・石川隊の損害 62 → 19・二隊が崩れるのが 327 → 311 秒。
 *   脇道の口（MOUTH）で使っても、損害・時刻とも 1 も変わらない（正面の 1 対 1 だけで、包囲にならない）。
 *
 * 本物の入力（このテストの外。使い捨ての Playwright で ?dev=field&id=town_edge を開き、「指揮」で止めて、札を押す → 地面・敵の体を押すで
 * WATCH と同じ点・同じ条件の命令を出し、待ちは開発用の早送り（1 秒ずつ）。ポート 8317・コミット 79b396d）：PC・スマホ相当とも 381.9 秒に勝ち
 * （突破 PC 0・スマホ 2。スマホは押した時刻が 1 秒ずれ、東の二隊に抜けられた）。副目標は損害・市 ✓、野の弓 ✗。最初の忠勝隊の (0,80) は、
 * 押した所に忠勝隊の体があって選び直しになった（移動先指定を使わない押し方。台本は issueOrder で直接出すので動く）。結果は変わらなかった。
 *
 * 止まり（エンジンの既知の穴。報告に直しの依頼を書いた）：射線の格子は斬り合いの相手選びにも使うので、家屋の角を挟んで斜めに隣り合った
 * 二部隊は、体がぶつかって近づけず、射線も角で切れて、どちらも斬りかからずに止まることがある（例：辻の角で、横道の部隊が脇道の中の敵を
 * 攻撃の命令で狙う）。止まった攻め手は出口へも進まないので、守る側に有利な結果になる。下の 3 つの作戦は、16 通りのどれにも止まりが無い。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, runToEnd, RULES, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { lineOfSight } from '../proto3d/src/battle/fieldRules';
import { findPath, isPassable } from '../proto3d/src/battle/pathfind';
import { buildBattleSetup, getField, validateField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';
import { atk, nearestEnemy, tapOrder } from './proto3d-group3-helpers';
import { unplanned } from './proto3d-fields-group3-plans';
import { logRecord } from './proto3d-record-log';

const TF = getField('town_edge')!;

// ---------------------------------------------------------------- 台本の道具

/** 地面を押す（押す点の 20 m 以内に見えている敵がいれば、その敵への攻撃。画面と同じ） */
interface Tap {
    tap: [number, number];
}
/** 固有能力（対象の要る能力は対象の部隊 id。要らなければ null） */
interface Ab {
    ability: string | null;
}
type Cmd = Order | Tap | Ab | 'nearest';
type Cond = (s: BattleState) => boolean;
/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]、または [条件, 部隊 id, 命令]（見てから押す。条件が初めて真になった刻みに 1 回） */
type Step = [number, string, Cmd] | [Cond, string, Cmd];

const tap = (x: number, z: number): Tap => ({ tap: [x, z] });
const ab = (target: string | null = null): Ab => ({ ability: target });

const unitOf = (s: BattleState, id: string) => s.units.find((u) => u.id === id);
/** 部隊が斬り合っている */
const engaged = (id: string): Cond => (s) => !!unitOf(s, id)?.engagedWith;
/** 敵の部隊が崩れた（敗走・全滅・撤退）。まだ現れていない部隊は false */
const gone = (id: string): Cond => (s) => {
    const u = unitOf(s, id);
    return !!u && u.arrived && u.status !== 'ready';
};
/** 部隊が (x, z) の r m 以内にいる */
const near = (id: string, x: number, z: number, r: number): Cond => (s) => {
    const u = unitOf(s, id);
    return !!u && u.status === 'ready' && Math.hypot(u.x - x, u.z - z) <= r;
};
/** 部隊が待機している（移動の行き先に着いた。斬り合っていない） */
const idle = (id: string): Cond => (s) => {
    const u = unitOf(s, id);
    return !!u && u.status === 'ready' && u.order.type === 'hold' && !u.engagedWith;
};
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
 * 1 通り（J0）はどちらも 0。16 通りは jitterOf（乱数の種 7。時刻の行は ±15 秒、見てから押す行は 0〜15 秒の遅れ。
 * tests/proto3d-field-siege_front.test.ts・temple・marsh と同じ作り方）
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
/** 見てから押す：条件が初めて真になってから sec 秒と、揺らぎの遅れの後 */
const w = (cond: Cond, sec: number, j: J): Cond => later(cond, sec + j.d());

/**
 * 行き過ぎてから押し戻す（向きを変える）：start 秒に 1 つ目の点を押し、着いて待機になったのを見てから 2 つ目の点を押す。
 * 部隊は進んだ向きを向くので、北を向かせたい所へは南から押し戻す（「向き」を使わない押し方。下の作戦の台本はこれで書いた）
 */
function route(id: string, pts: [[number, number], [number, number]], start: number, j: J): Step[] {
    const t0 = j.t(start);
    // 2 つ目：1 つ目を押した後（3 秒より後）に待機になったのを見てから
    const sent: Cond = (s) => s.t >= t0 + 3 - 1e-9;
    return [
        [t0, id, tap(pts[0][0], pts[0][1])],
        [w((s) => sent(s) && idle(id)(s), 0, j), id, tap(pts[1][0], pts[1][1])],
    ];
}

interface Run {
    o: BattleOutcome;
    t: number;
    /** 味方の兵の損害の割合（0〜1） */
    loss: number;
    left: Record<string, number>;
    refused: string[];
    /** 命令を出した時刻（人が押した時刻） */
    cmdT: number[];
    /** 出口を抜けた敵の部隊（抜けた順） */
    entered: string[];
    /** 止まり：攻撃の命令の相手が 32 m 以内なのに、自分も相手も斬り合わず、10 秒以上動かなかった部隊 */
    stalls: string[];
    s: BattleState;
}

function play(steps: Step[], each?: (s: BattleState) => void): Run {
    const s = createBattle(buildBattleSetup(TF, 'standard'));
    const timed = steps.filter((x): x is [number, string, Cmd] => typeof x[0] === 'number').sort((a, b) => a[0] - b[0]);
    const watch = steps.filter((x): x is [Cond, string, Cmd] => typeof x[0] === 'function');
    const fired = new Set<number>();
    const refused: string[] = [];
    const cmdT: number[] = [];
    const still = new Map<string, { x: number; z: number; t: number }>();
    const stalls = new Set<string>();
    const run = (st: BattleState, label: string, id: string, ord: Cmd) => {
        cmdT.push(st.t);
        if (ord === 'nearest') {
            const n = nearestEnemy(st, id);
            if (n && !issueOrder(st, id, n)) refused.push(`${label}:${id}`);
        } else if ('ability' in ord) {
            if (!useAbility(st, id, ord.ability ?? undefined).ok) refused.push(`${label}:${id}`);
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
        // 止まりを見る
        for (const u of st.units) {
            const tg = u.order.type === 'attack' ? unitOf(st, u.order.targetId) : undefined;
            const stuck = u.status === 'ready' && u.present && !!tg && tg.status === 'ready' && tg.present && !u.engagedWith && !tg.engagedWith && Math.hypot(tg.x - u.x, tg.z - u.z) <= 32;
            const p = still.get(u.id);
            if (!stuck) still.delete(u.id);
            else if (!p || Math.hypot(p.x - u.x, p.z - u.z) > 1) still.set(u.id, { x: u.x, z: u.z, t: st.t });
            else if (st.t - p.t >= 10) stalls.add(u.id);
        }
        each?.(st);
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    const entered = [...(s.objectives?.primary?.entered ?? [])];
    return { o, t: s.t, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused, cmdT, entered, stalls: [...stalls], s };
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
const broke = (r: Run) => r.entered.length;
/** 本陣以外で、最後まで戦える（崩れていない）部隊の数 */
const FIGHTERS = ['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_sakakibara', 'a_kiba', 'a_yumi'];
const standing = (r: Run) => FIGHTERS.filter((id) => r.o.units.find((u) => u.id === id)!.status === 'ready').length;
const brief = (r: Run) =>
    `${r.o.result}/${r.o.reason} t=${r.t.toFixed(1)} loss=${(r.loss * 100).toFixed(1)}% ${r.o.objectives?.secondary.map((x) => `${x.id}:${x.achieved ? '✓' : '✗'}`).join(' ')} 突破=${r.entered.join(',')} refused=${r.refused.join(',')} stalls=${r.stalls.join(',')}`;

/** 同じ台本は 1 回だけ進める */
const memo = new Map<Step[], Run>();
const once = (p: Step[]) => {
    if (!memo.has(p)) memo.set(p, play(p));
    return memo.get(p)!;
};
const memo16 = new Map<Step[], Run[]>();
/** 1 通りの台本（J0）から、揺らぎを受け取る台本へ（plan で作った台本だけ） */
const PLAN_OF = new Map<Step[], Plan>();
const plan = (p: Plan): Step[] => {
    const one = p(J0);
    PLAN_OF.set(one, p);
    return one;
};
const sixteen = (p: Step[]) => {
    if (!memo16.has(p)) memo16.set(p, jitter(PLAN_OF.get(p)!));
    return memo16.get(p)!;
};

// ---------------------------------------------------------------- 台本

/**
 * 辻で挟み、波を見て弓を回す（進路を見て組み替える。命令 14 回）：
 * 忠勝隊は大通りの北 (0,80)。酒井隊は横道の西 (-112,102)（西へ進んで西＝辻を向く）、石川隊は西の脇道の辻の南 (-140,124)（南へ行き過ぎて
 * 北へ押し戻す）。榊原隊・騎馬隊も東で同じ形。弓は大通り (0,108)。片方が斬り合ったら、もう片方がその敵を押す（二方向から挟む）。
 * 大通りの攻め手が崩れたら弓を東の辻の手前 (70,102) へ、東の騎馬が崩れたら西の辻の手前 (-70,102) へ回す
 */
const WATCH = plan((j) => [
    [j.t(2), 'a_tadakatsu', tap(0, 80)],
    [j.t(4), 'a_sakai', tap(-112, 102)],
    ...route('a_ishikawa', [[-140, 150], [-140, 124]], 6, j),
    [j.t(8), 'a_yumi', tap(0, 108)],
    [j.t(10), 'a_sakakibara', tap(112, 102)],
    ...route('a_kiba', [[140, 150], [140, 124]], 12, j),
    [w(engaged('a_sakai'), 1, j), 'a_ishikawa', 'nearest'],
    [w(engaged('a_ishikawa'), 1, j), 'a_sakai', 'nearest'],
    [w(engaged('a_sakakibara'), 1, j), 'a_kiba', 'nearest'],
    [w(engaged('a_kiba'), 1, j), 'a_sakakibara', 'nearest'],
    [w(gone('e_m_yari'), 0, j), 'a_yumi', tap(70, 102)],
    [w(gone('e_e_kiba'), 0, j), 'a_yumi', tap(-70, 102)],
]);
/** 辻で挟む（WATCH）で、西の二つ目の波（3 分 10 秒・3 分 50 秒）を酒井隊と石川隊が二方向から斬り合ったら、酒井の両翼の采配 */
const bothWest: Cond = (s) => s.t > 280 && engaged('a_sakai')(s) && engaged('a_ishikawa')(s);
const WATCH_SAKAI = plan((j) => [...PLAN_OF.get(WATCH)!(j), [w(bothWest, 1, j), 'a_sakai', ab()]]);

/**
 * 出口の前で受ける（命令 12 回）：裏通りの東の端の出口の手前に榊原隊 (175,175)・その後ろに騎馬隊、西の端の出口の手前に酒井隊 (-175,175)・
 * その後ろに石川隊。忠勝隊は大通りの南 (0,165)、弓はその後ろの裏通り (-20,176)、家康本陣は (-45,176)。
 * 前に立つ部隊は、出口まで行き過ぎてから町の内へ押し戻す（敵の来る向きを向く）。前の部隊が斬り合ったら後ろの部隊が押す
 */
const EXITS = plan((j) => [
    ...route('a_sakakibara', [[205, 175], [175, 175]], 2, j),
    ...route('a_sakai', [[-205, 175], [-175, 175]], 4, j),
    [j.t(6), 'a_kiba', tap(198, 175)],
    ...route('a_tadakatsu', [[0, 195], [0, 165]], 8, j),
    [j.t(10), 'a_ishikawa', tap(-198, 175)],
    [w(near('a_tadakatsu', 0, 165, 6), 1, j), 'a_yumi', tap(-20, 176)],
    [j.t(14), 'a_ieyasu', tap(-45, 176)],
    [w(engaged('a_sakakibara'), 1, j), 'a_kiba', 'nearest'],
    [w(engaged('a_sakai'), 1, j), 'a_ishikawa', 'nearest'],
]);

/**
 * 準備した正面攻撃（野へ打って出る。命令 16 回）：酒井隊だけ横道の西に残し、弓を野 (0,-20) へ出して押さえを射る。忠勝隊が押さえの前
 * (0,-45) に着いたら押さえへ当たり、石川隊も押さえへ。榊原隊は西から野の弓へ当たって先駆けの号（弓へ ×1.5）、騎馬隊も野の弓へ。
 * 押さえが崩れたら忠勝隊は大通り、石川隊は西の脇道の辻の南、弓は大通りへ戻る。野の弓が崩れたら榊原隊・騎馬隊は東の辻へ戻る
 */
const FRONTAL = plan((j) => [
    [j.t(2), 'a_sakai', tap(-112, 102)],
    [j.t(4), 'a_yumi', tap(0, -20)],
    [j.t(6), 'a_tadakatsu', tap(0, -45)],
    [j.t(8), 'a_ishikawa', tap(-35, -40)],
    [j.t(10), 'a_sakakibara', tap(-70, -75)],
    [j.t(12), 'a_kiba', tap(70, -75)],
    [w(near('a_tadakatsu', 0, -45, 8), 1, j), 'a_tadakatsu', atk('e_guard')],
    [w(engaged('a_tadakatsu'), 1, j), 'a_ishikawa', atk('e_guard')],
    [w(engaged('a_tadakatsu'), 2, j), 'a_sakakibara', atk('e_yumi')],
    [w(engaged('a_tadakatsu'), 3, j), 'a_sakakibara', ab()],
    [w(engaged('a_tadakatsu'), 4, j), 'a_kiba', atk('e_yumi')],
    [w(gone('e_guard'), 0, j), 'a_tadakatsu', tap(0, 80)],
    [w(gone('e_guard'), 1, j), 'a_ishikawa', tap(-140, 124)],
    [w(gone('e_guard'), 2, j), 'a_yumi', tap(0, 108)],
    [w(gone('e_yumi'), 0, j), 'a_sakakibara', tap(112, 102)],
    [w(gone('e_yumi'), 1, j), 'a_kiba', tap(140, 124)],
]);

/** 通りの口に二隊ずつ置いて動かさない（町の北の口。命令 8 回）：片方が斬り合ったら、もう片方が押すだけ */
const STATIC = plan((j) => [
    [j.t(2), 'a_tadakatsu', tap(0, 75)],
    [j.t(4), 'a_sakai', tap(-140, 65)],
    [j.t(6), 'a_ishikawa', tap(-140, 85)],
    [j.t(8), 'a_yumi', tap(0, 105)],
    [j.t(10), 'a_kiba', tap(140, 60)],
    [j.t(12), 'a_sakakibara', tap(140, 80)],
    [w(engaged('a_sakai'), 1, j), 'a_ishikawa', 'nearest'],
    [w(engaged('a_kiba'), 1, j), 'a_sakakibara', 'nearest'],
]);

/**
 * 町の北の口で 1 対 1 で受け、波を見て回す（命令 13 回）：酒井隊は西の脇道の北の口 (-140,65)、石川隊は横道の西で待つ。
 * 東の波が見えたら騎馬隊・榊原隊を東の口へ、大通りの攻め手が崩れたら忠勝隊を東へ回し、市の攻め手が見えたら大通りへ戻す
 */
const MOUTH = plan((j) => [
    [j.t(2), 'a_tadakatsu', tap(0, 75)],
    [j.t(4), 'a_sakai', tap(-140, 65)],
    [j.t(6), 'a_ishikawa', tap(-115, 102)],
    [j.t(8), 'a_yumi', tap(0, 105)],
    [j.t(10), 'a_sakakibara', tap(60, 102)],
    [j.t(12), 'a_kiba', tap(100, 102)],
    [w(engaged('a_sakai'), 1, j), 'a_ishikawa', 'nearest'],
    [w((s) => !!unitOf(s, 'e_e_yari')?.arrived, 0, j), 'a_kiba', tap(140, 60)],
    [w((s) => !!unitOf(s, 'e_e_yari')?.arrived, 2, j), 'a_sakakibara', tap(140, 80)],
    [w(gone('e_m_yari'), 0, j), 'a_tadakatsu', tap(125, 102)],
    [w(engaged('a_kiba'), 1, j), 'a_sakakibara', 'nearest'],
    [w(engaged('a_kiba'), 3, j), 'a_tadakatsu', 'nearest'],
    [w((s) => !!unitOf(s, 'e_m_raid')?.arrived, 0, j), 'a_tadakatsu', tap(0, 75)],
]);
/** 町の北の口（MOUTH）で、西の二つ目の波と酒井隊が斬り合ったら、酒井の両翼の采配 */
const MOUTH_SAKAI = plan((j) => [...PLAN_OF.get(MOUTH)!(j), [w((s) => s.t > 280 && engaged('a_sakai')(s), 1, j), 'a_sakai', ab()]]);

/** 大通りに集中する（脇道・門口は空ける。命令 6 回） */
const MAIN = plan((j) => [
    [j.t(2), 'a_tadakatsu', tap(0, 72)],
    [j.t(4), 'a_sakai', tap(-8, 90)],
    [j.t(6), 'a_yumi', tap(0, 110)],
    [j.t(8), 'a_ishikawa', tap(8, 90)],
    [j.t(10), 'a_sakakibara', tap(0, 125)],
    [j.t(12), 'a_kiba', tap(0, 140)],
]);
/** 無計画：全部隊で、見えている一番近い敵へ 10 秒ごとに当て直す（第3群の共通の台本） */
const UNPLANNED = plan((j) => (unplanned(450) as Step[]).map((x): Step => (typeof x[0] === 'number' ? [j.t(x[0]), x[1], x[2]] : x)));
/** 待つだけ（命令を出さない） */
const HOLD = plan(() => []);

const PLANS: Record<string, Step[]> = { WATCH, WATCH_SAKAI, EXITS, FRONTAL, STATIC, MOUTH, MOUTH_SAKAI, MAIN };

// ---------------------------------------------------------------- テスト

describe('城下町外縁のデータ（状態を直接見る）', () => {
    it('検査を通る。主目標は突破を抑える（部隊単位・敵本陣の撃破ではない）。部隊数は上限内（味方 7・敵 10。増援を含めて同時に戦場にいる数）', () => {
        expect(validateField(TF)).toEqual([]);
        const p = TF.objectives.primary;
        expect(p.type).toBe('limit_breakthrough');
        if (p.type !== 'limit_breakthrough') return;
        expect([p.maxCount, p.untilSec, p.names]).toEqual([2, 420, ['大通りの出口', '西の脇道の出口', '東の門口の出口']]);
        expect(TF.objectives.secondary.map((x) => x.id)).toEqual(['town_losses', 'town_market', 'town_yumi']);
        expect(TF.generalInitiative).toBe(true);
        const us = TF.presets[0]!.units;
        expect(us.filter((u) => u.side === 'ally').length).toBe(7);
        expect(us.filter((u) => u.side === 'enemy').length).toBe(10);
        expect(us.filter((u) => u.side === 'enemy').length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.enemy);
        // 攻め手 7 隊（援軍）は出口か市へ攻め進む。本陣・押さえ・弓は北の野で動かない（攻め手には数えない）
        const raiders = us.filter((u) => u.side === 'enemy' && u.aiRole === 'assault');
        expect(raiders.map((u) => u.id)).toEqual(['e_w_yari', 'e_m_yari', 'e_e_yari', 'e_e_kiba', 'e_w_yari2', 'e_w_kiba', 'e_m_raid']);
        expect(raiders.every((u) => !!u.reinforcement)).toBe(true);
        const aim = (id: string) => us.find((u) => u.id === id)!.aiTarget!;
        expect([aim('e_w_yari').x, aim('e_w_yari2').x, aim('e_w_kiba').x]).toEqual([-213, -213, -213]);
        expect([aim('e_e_yari').x, aim('e_e_kiba').x]).toEqual([213, 213]);
        expect([aim('e_m_raid').x, aim('e_m_raid').z]).toEqual([0, 102]);
        // 攻め手の出る所は 3 つ（西の林・東の林・敵勢の本陣の前）
        expect(new Set((TF.reinforcements ?? []).map((r) => `${r.point.x},${r.point.z}`)).size).toBe(3);
    });

    it('家屋・塀の縁は 5 m の格子の線にそろう（格子の升が「通れない」なのに体が入れる隙間を作らない）', () => {
        for (const a of TF.terrain) {
            if (a.kind !== 'building' && a.kind !== 'wall' && a.kind !== 'fence') continue;
            const r = a.rect!;
            expect([a.kind, r.x0 % 5, r.x1 % 5, r.z0 % 5, r.z1 % 5].map((v) => (typeof v === 'number' ? Math.abs(v) : v))).toEqual([a.kind, 0, 0, 0, 0]);
        }
    });

    it('地形：家屋・塀は通れず、射線を遮る。攻め手の道は西の脇道・大通り・東の門口に分かれる', () => {
        const s = createBattle(buildBattleSetup(TF, 'standard'));
        const nav = s.field.nav!;
        expect(isPassable(nav, -100, 70)).toBe(false); // 北の家並み
        expect(isPassable(nav, 130, 145)).toBe(false); // 門口の西の塀
        expect(isPassable(nav, 140, 145)).toBe(true); // 門口
        expect(isPassable(nav, -140, 70)).toBe(true); // 西の脇道
        expect(isPassable(nav, 0, 102)).toBe(true); // 辻の市
        // 大通りは北の野まで見通せる。横道の真ん中から西の脇道の北の口は家並みに遮られて見えない
        expect(lineOfSight(s.map, s.field, { x: 0, z: 108 }, { x: 0, z: -10 })).toBe(true);
        expect(lineOfSight(s.map, s.field, { x: 0, z: 108 }, { x: -140, z: 50 })).toBe(false);
        // 西の林から西の口へは西の脇道を、東の林から東の口へは東の道と門口を通る。大通りの攻め手は大通りを下る
        // 道（折れ点の並び）の線分を 1 m おきにたどって、四角の中を通るか
        const via = (path: { x: number; z: number }[], x0: number, x1: number, z0: number, z1: number) =>
            path.some((b, i) => {
                const a = i === 0 ? b : path[i - 1]!;
                const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
                for (let k = 0; k <= n; k++) {
                    const x = a.x + ((b.x - a.x) * k) / n;
                    const z = a.z + ((b.z - a.z) * k) / n;
                    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return true;
                }
                return false;
            });
        const west = findPath(nav, 'yari', -180, -185, -213, 175)!;
        expect(via(west, -145, -135, 45, 90)).toBe(true);
        expect(via(west, -15, 15, 45, 90)).toBe(false);
        const east = findPath(nav, 'yari', 180, -185, 213, 175)!;
        expect(via(east, 135, 145, 140, 150)).toBe(true);
        const main = findPath(nav, 'yari', 180, -185, 0, 193)!;
        expect(via(main, -15, 15, 45, 90)).toBe(true);
    });
});

describe('城下町外縁の作戦（早送り）', () => {
    it('台本は人が画面でできる程度：命令は 16 回まで、続けて押す間は 1 秒以上、向き（face）は使わない、断られた命令は無い', () => {
        for (const [name, p] of Object.entries(PLANS)) {
            const r = once(p);
            expect([name, r.cmdT.length <= 16]).toEqual([name, true]);
            const ts = [...r.cmdT].sort((a, b) => a - b);
            const gaps = ts.slice(1).map((t, i) => t - ts[i]!);
            expect([name, Math.min(...gaps) >= 1 - 1e-6]).toEqual([name, true]);
            expect([name, r.refused]).toEqual([name, []]);
            for (const x of p) if (typeof x[2] === 'object' && 'type' in x[2] && x[2].type === 'move') expect(x[2].face).toBeUndefined();
        }
    }, 120_000);

    // 揺らぎの作り方の直し（確かめの指摘）：前は時刻の行だけをずらし、「見てから押す」行に遅れを入れていなかった（湿地・寺社周辺・城攻め前面の
    // テストは入れていた）。見てから押すまでの 0〜15 秒の遅れを足すと、16 通りの勝ちは 辻で挟む 16 → 11・出口の前 16 → 13・野へ打って出る
    // 16 → 15、町の北の口で受けて回す（MOUTH）13 → 16（すり抜けの直しの後 16 のまま）・動かさない 16 → 16。「どれも 16 勝」を、
    // 作戦ごとの勝ちの下限（記録の数から 1〜2 下）に直した。辻で挟むの負けは、どれも東の二隊（門口の槍と騎馬）が抜け、西の騎馬が 3 部隊目になる
    it('主目標に届く作戦（辻で挟む・出口の前で受ける・野へ打って出る・町の北の口で受けて回す）：1 通りではどれも勝ち、止まりに頼らない。16 通り（±15 秒と見てから押す遅れ）の勝ちは 11・13・15・16（記録。第4群の味方同士の詰まりの直しの後 11・13・15・15）', () => {
        const floor: [Step[], number][] = [
            [WATCH, 10],
            [EXITS, 12],
            [FRONTAL, 14],
            [MOUTH, 15],
        ];
        for (const [p, min] of floor) {
            expect(won(once(p)), brief(once(p))).toBe(true);
            const rs = sixteen(p);
            expect(wins(rs), brief(once(p))).toBeGreaterThanOrEqual(min);
            // 勝ちが、角を挟んで止まった攻め手（出口へ進まない）に頼っていない
            expect(rs.flatMap((r) => r.stalls)).toEqual([]);
        }
    }, 300_000);

    // 見てから押す遅れを足した後（上の記録）：16 通りの突破の平均は 辻 0.00 → 1.94・出口の前 2.00 → 2.19・野へ 2.00 → 2.00・町の北の口 0.50。
    // 辻で挟むも東の二隊に抜けられやすくなったので、突破の比べは 1 通り（遅れ無し）と、町の北の口で受けて回す作戦（16 通り）で書く。
    // 損害の並び（辻 24.3％ < 出口の前 29.8％ < 野へ 41.2％）は同じ
    it('作戦どうしの違い：辻で挟むと損害が少ない。出口の前・野へ打って出るは許容（2）を使い切り、損害が大きい', () => {
        const w = sixteen(WATCH);
        const e = sixteen(EXITS);
        const f = sixteen(FRONTAL);
        // 突破の数：1 通りでは 辻 0 ／出口の前 2 ／野へ 2。16 通りの平均では、町の北の口 0.50 ／出口の前 2.19 ／野へ 2.00
        expect(broke(once(WATCH))).toBe(0);
        expect([broke(once(EXITS)), broke(once(FRONTAL))]).toEqual([2, 2]);
        expect(mean(e, broke)).toBeGreaterThan(mean(sixteen(MOUTH), broke) + 1);
        expect(mean(f, broke)).toBeGreaterThan(mean(sixteen(MOUTH), broke) + 1);
        // 損害（平均）：辻 24.3％ < 出口の前 29.8％ < 野へ 41.2％
        expect(mean(w, (r) => r.loss)).toBeLessThan(mean(e, (r) => r.loss) - 0.04);
        expect(mean(e, (r) => r.loss)).toBeLessThan(mean(f, (r) => r.loss) - 0.05);
        // 出口の前で受ける作戦は命令が少ない（見てから押すのは、前の部隊が斬り合ったときの 2 回だけ）
        expect(once(EXITS).cmdT.length).toBeLessThan(once(WATCH).cmdT.length);
    }, 300_000);

    it('副目標が作戦で分かれる：辻で挟む（損害 ✓・市 ✓・弓 ✗）／出口の前（市 ✗）／野へ打って出る（弓 ✓・損害 ✗）', () => {
        const w = sixteen(WATCH);
        const e = sixteen(EXITS);
        const f = sixteen(FRONTAL);
        // 記録：辻で挟む 損害 15・市 11・弓 0（見てから押す遅れを足す前は 16・16・0。市を失うのは東の二隊に抜けられた負けの回）。
        // 第4群の確かめの直し（損害を抑える副目標は、負けて終えたら果たせない。objectives.ts の finalAchieved）の後：損害 15 → 11（負けた 5 通りのうち
        // 損害が 3 割以内だった 4 通りを数えなくなった）。勝った 11 通りはどれも損害 3 割以内なので、「勝った回はすべて果たす」を確かめる
        expect(count(w, 'town_losses')).toBe(wins(w));
        expect(count(w, 'town_losses')).toBeGreaterThanOrEqual(11);
        expect(count(w, 'town_market')).toBeGreaterThanOrEqual(10);
        expect(count(w, 'town_yumi')).toBe(0);
        // 出口の前で受けると、市を荒らす攻め手は誰にも当たらずに市に居座る
        expect(count(e, 'town_market')).toBe(0);
        expect(count(e, 'town_losses')).toBeLessThan(count(w, 'town_losses'));
        // 記録：野へ打って出る 弓 15・市 15（遅れを足す前は 16・16）
        expect(count(f, 'town_yumi')).toBeGreaterThanOrEqual(14);
        expect(count(f, 'town_market')).toBeGreaterThanOrEqual(14);
        expect(count(f, 'town_losses')).toBeLessThanOrEqual(2);
        // 1 回の台本でも同じ分かれ方
        expect(['town_losses', 'town_market', 'town_yumi'].map((id) => sec(once(WATCH), id))).toEqual([true, true, false]);
        expect(sec(once(EXITS), 'town_market')).toBe(false);
        expect(['town_losses', 'town_yumi'].map((id) => sec(once(FRONTAL), id))).toEqual([false, true]);
    }, 300_000);

    it('準備した正面攻撃と無計画な攻撃の比べ：準備した方は主目標に届き、突破が少なく、最後まで戦える部隊が多い（無計画の結果は記録）', () => {
        const front = sixteen(FRONTAL);
        const raw = sixteen(UNPLANNED);
        // 準備した正面攻撃 16 勝（作った時）→ 見てから押す遅れを足して 15 勝。無計画は 2 勝（記録：平均 315 秒で終わる・突破 2.81。遅れを足す前は 311 秒・2.75）
        // （無計画は allyBlockSec の後 3 勝、第4群の確かめの直しの後 4 勝・平均 307.5 秒・突破 2.75。準備した正面攻撃は 15 勝のまま）
        expect(wins(front)).toBeGreaterThanOrEqual(14);
        expect(wins(raw)).toBeLessThanOrEqual(4);
        expect(wins(front) - wins(raw)).toBeGreaterThanOrEqual(10);
        expect(mean(front, (r) => r.t)).toBeGreaterThan(mean(raw, (r) => r.t) + 60);
        expect(mean(front, broke)).toBeLessThan(mean(raw, broke) - 0.5);
        // どちらも野の弓は崩す（15・16／16）。無計画は損害の割合・最後まで戦える部隊では劣らない（早く負けて戦いが終わる。
        // 記録：損害 25.5％・準備 41.2％、最後まで戦える部隊 3.94・準備 3.50。遅れを足す前は 22.9％・40.5％、3.9・3.8）
        expect(count(front, 'town_yumi')).toBeGreaterThanOrEqual(14);
        expect(count(raw, 'town_yumi')).toBe(16);
        expect(mean(raw, (r) => r.loss)).toBeLessThan(mean(front, (r) => r.loss));
    }, 300_000);

    // 見てから押す遅れを足した後：16 通りの最後まで戦える部隊は 辻 5.0 → 3.75・野へ 3.8 → 3.50 で差が小さくなった（辻で挟むも東の二隊に抜けられる回は
    // 3 部隊ほどになる）。突破と最後まで戦える部隊の比べは、町の北の口で受けて回す作戦（突破 0.50・戦える 4.38）と比べる
    it('準備した正面攻撃と地形に合った作戦の比べ：野へ打って出ると勝てるが、辻で挟むより損害が 15 点以上大きく、町の北の口で受けて回すより突破を多く許し、戦える部隊が少ない', () => {
        expect(mean(sixteen(FRONTAL), (r) => r.loss)).toBeGreaterThan(mean(sixteen(WATCH), (r) => r.loss) + 0.15);
        expect(mean(sixteen(FRONTAL), broke)).toBeGreaterThan(mean(sixteen(MOUTH), broke) + 1);
        // 最後まで戦える部隊（平均）：町の北の口 4.38 ／野へ 3.50。第4群の味方同士の詰まりの決まり（allyBlockSec 2 秒）の後 4.00 ／3.50
        // （町の北の口の 16 通りのうち k=10 が 383 秒に本陣が崩れて負け、k=1・5・13 も 1〜2 部隊少ない。どれも石川隊が横道で弓隊の中を 7 秒で
        // すり抜け、前は 19.7 秒まで弓隊と押し合っていた分だけ早く動くので、その後の榊原隊・忠勝隊の動きの時刻がずれた。k=10 は榊原隊が
        // 横道の弓隊を西からよけて大通りの北へ逸れ、26 秒に「道を塞がれて」の待機になる＝よけ方の向きの既知の振る舞い）。差を 0.8 → 0.4 にしていた。
        // 第4群の確かめの直し（味方だけに塞がれた時間を、よけて回っている間も「残りの道のりを縮められない時間」で数える。止まっている味方だけに
        // 塞がれている間は「道を塞がれて」の待機にしない）の後：k=10 の榊原隊は 16.5 秒に弓隊の中をすり抜けて 27.5 秒に行き先へ着き、
        // 町の北の口は 16 勝・突破 0.50・損害 31.1％・戦える 4.38（直しの前の数字に戻った）。差を 0.8 に戻す（4.38 対 3.50）
        expect(mean(sixteen(MOUTH), standing)).toBeGreaterThan(mean(sixteen(FRONTAL), standing) + 0.8);
        // 1 回の台本：野で押さえに当たった忠勝隊が残る兵は、辻で挟むときより少ない
        expect(once(FRONTAL).left.a_tadakatsu!).toBeLessThan(once(WATCH).left.a_tadakatsu! - 100);
    }, 300_000);

    // 第3群の動きの直し（建物の角の向こうの相手に「14 m より近づかない」を効かせない・止まった味方の中のすり抜け など）の後、動かさない置き方は
    // 10／16 勝・突破 1.75 → 13／16 勝・突破 1.38、待機の味方に塞がれた移動のすり抜けの後 16 勝・突破 1.00・損害 26.4％・戦える 3.00 になった。
    // 見てから押す遅れを足した後（確かめの指摘）：動かさない 16 勝・突破 1.63・損害 26.8％・戦える 3.13、辻で挟む 11 勝・突破 1.94・24.3％・3.75。
    // 辻で挟むは遅れに弱く、動かさない置き方との比べにならなくなったので、同じく波を見て回す、町の北の口で受けて回す作戦（MOUTH。16 勝・突破 0.50・
    // 損害 31.1％・戦える 4.38）と比べる。損害の割合は動かさない方が小さい（記録。回すと斬り合いが増える）
    it('進路を見て組み替える価値：通りの口に二隊ずつ置いて動かさないと、同じ道へ二隊続けて来る波（東の門口）で抜けられやすく、戦える部隊が少ない（記録：16／16 勝・突破 1.63・損害 26.8％・戦える 3.13。町の北の口で受けて回すは 16 勝・突破 0.50・31.1％・4.38）', () => {
        const st = sixteen(STATIC);
        const mo = sixteen(MOUTH);
        expect(mean(st, broke)).toBeGreaterThan(mean(mo, broke) + 0.75);
        // 第4群の味方同士の詰まりの決まりの後：動かさない 16 勝・突破 1.63・損害 26.7％・戦える 3.13（変わらない）、町の北の口 15 勝・突破 0.69・
        // 損害 33.2％・戦える 4.00（上の比べと同じ理由）。戦える部隊の差を 1 → 0.75 にしていた。第4群の確かめの直しの後：町の北の口 16 勝・
        // 突破 0.50・31.1％・4.38 に戻り（動かさない 16 勝・1.63・26.7％・3.13）、差 1.25 なので 1 に戻す
        expect(mean(st, standing)).toBeLessThan(mean(mo, standing) - 1);
        // 記録：勝ち数（動かさない 16 ／町の北の口 16 → 15）・損害（動かさない 26.8％ ／町の北の口 31.1％ → 26.7％ ／33.2％）
        expect(mean(st, (r) => r.loss)).toBeLessThan(mean(mo, (r) => r.loss));
    }, 300_000);

    it('記録：大通りに集中すると、西の脇道・東の門口から 3 部隊抜けて負ける（損害は小さい）。待つだけでも同じ。無計画は野へ散って負ける', () => {
        const main = once(MAIN);
        // 目標の判定：抜けた部隊が上限（2）を超えたら主目標を果たせない。大通りに集中したとき抜けるのは西の脇道・東の門口の部隊（地形の道）
        if (main.entered.length > 2) expect(main.o.objectives!.primary!.achieved).toBe(false);
        expect(main.entered.every((id) => id.startsWith('e_w_') || id.startsWith('e_e_'))).toBe(true);
        // 比べ：町の北の口で受けて回す作戦（MOUTH）より 16 通りの勝ちがずっと少ない。勝敗・抜けた数・損害は記録（2026-10-05・782fefe：
        // 負け・主目標 ✗・3 部隊抜ける・損害 2.4％・16 通りで 0 勝（町の北の口 16 勝・辻で挟む 11 勝）。前はここで主目標 ✗・3 部隊抜ける・
        // 損害 1 割未満・16 通り 0 勝を expect していた。この台本が必ず負けるは合格条件にしない。docs/chapter2-request.md【1】）
        logRecord('城下町外縁・大通りに集中', { 結果: main.o.result, 主目標: main.o.objectives!.primary!.achieved, 抜けた: main.entered.length, 損害: main.loss, '16 通りの勝ち': wins(sixteen(MAIN)), 町の北の口: wins(sixteen(MOUTH)), 辻で挟む: wins(sixteen(WATCH)) });
        expect(wins(sixteen(MAIN)) + 10).toBeLessThanOrEqual(wins(sixteen(MOUTH)));
        const hold = once(HOLD);
        expect(hold.o.objectives!.primary!.achieved).toBe(false);
        expect(hold.entered.length).toBe(3);
        expect(hold.t).toBeLessThan(260);
    }, 300_000);

    it('能力の価値が地形で変わる（酒井の両翼の采配）：辻で二方向から挟むと損害が減って早く崩せる。脇道の口の 1 対 1 では何も変わらない', () => {
        // 西の二つ目の波（槍 380・騎馬 300）と斬り合う間（280 秒から終わりまで）の酒井隊・石川隊の損害と、二隊が崩れた時刻
        const west = (p: Step[]) => {
            let a0 = -1;
            let tb = -1;
            const r = play(p, (s) => {
                if (a0 < 0 && s.t >= 280) a0 = unitOf(s, 'a_sakai')!.strength + unitOf(s, 'a_ishikawa')!.strength;
                const ws = s.units.filter((u) => u.id === 'e_w_yari2' || u.id === 'e_w_kiba');
                if (tb < 0 && s.t > 280 && ws.every((u) => u.arrived && u.status !== 'ready')) tb = s.t;
            });
            const used = r.s.abilityList.find((x) => x.unitId === 'a_sakai')!.usedAt;
            return { lost: a0 - unitOf(r.s, 'a_sakai')!.strength - unitOf(r.s, 'a_ishikawa')!.strength, tb, used, r };
        };
        const jNo = west(WATCH);
        const jAb = west(WATCH_SAKAI);
        const mNo = west(MOUTH);
        const mAb = west(MOUTH_SAKAI);
        // どちらの台本でも、能力は使えている（西の二つ目の波と斬り合った後）
        expect(jAb.used).toBeGreaterThan(280);
        expect(mAb.used).toBeGreaterThan(280);
        expect([jNo.used, mNo.used]).toEqual([null, null]);
        // 辻：損害 62 → 19、崩れるのが 327 → 311 秒（作った時）
        expect(jAb.lost).toBeLessThan(jNo.lost - 25);
        expect(jAb.tb).toBeGreaterThan(0);
        expect(jAb.tb).toBeLessThan(jNo.tb - 8);
        // 脇道の口：正面の 1 対 1 だけで包囲にならず、損害も結果も変わらない
        expect(mAb.lost).toBe(mNo.lost);
        expect(brief(mAb.r)).toBe(brief(mNo.r));
        // 全体（16 通りの平均の損害）でも、辻では減り、口では変わらない
        expect(mean(sixteen(WATCH_SAKAI), (r) => r.loss)).toBeLessThan(mean(sixteen(WATCH), (r) => r.loss));
        expect(mean(sixteen(MOUTH_SAKAI), (r) => r.loss)).toBeCloseTo(mean(sixteen(MOUTH), (r) => r.loss), 6);
    }, 300_000);
});

// 第4群の確かめの指摘（must-2）の再現：町の北の口で受けて回す（MOUTH）の 16 通りの k=10。榊原隊は (0,130) から (60,102) へ向かう途中、
// 横道の弓隊・大通りの忠勝隊（どちらも待機）を西からよけ続け、直す前は 10 秒あまり「味方だけに塞がれた」まま 45 m 逸れて、26.2 秒に
// 「道を塞がれて先へ進めない。ここで待機する」で止まった（よけて動く間は squeezeMove の動きで数え直しになり、2 秒の決まりが働かなかった）。
// 直した後：よけて回っても残りの道のりを縮められない時間で数え、2 秒で弓隊の中をすり抜けて、27.5 秒に行き先へ着く
describe('城下町外縁：味方だけに塞がれてよけ続けても、2 秒の決まりで先へ進む（早送り・MOUTH の k=10 の再現）', () => {
    it('榊原隊は「道を塞がれて」の待機にならず、40 秒までに (60,102) へ着く。止まっていた最長（1.5 m も動かない時間）は 4 秒未満', () => {
        let arrivedT: number | null = null;
        let anchor: { x: number; z: number; t: number } | null = null;
        let longest = 0;
        const r = play(PLAN_OF.get(MOUTH)!(jitterOf(10)), (s) => {
            const u = unitOf(s, 'a_sakakibara')!;
            if (s.t > 40 || arrivedT !== null || u.order.type !== 'move') return;
            if (Math.hypot(u.x - 60, u.z - 102) <= 6) arrivedT = s.t;
            if (!anchor || Math.hypot(u.x - anchor.x, u.z - anchor.z) > 1.5) anchor = { x: u.x, z: u.z, t: s.t };
            else longest = Math.max(longest, s.t - anchor.t);
        });
        const stuck = r.s.events.filter((e) => e.unitId === 'a_sakakibara' && e.text.includes('道を塞がれて'));
        expect(stuck, JSON.stringify(stuck)).toEqual([]);
        expect(arrivedT, brief(r)).not.toBeNull();
        expect(arrivedT!).toBeLessThan(40);
        expect(longest).toBeLessThan(4);
    }, 60_000);
});
