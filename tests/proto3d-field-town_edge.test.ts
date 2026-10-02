/**
 * 戦場「城下町外縁」（town_edge）の作戦と釣り合い（docs/fields-group3-request.md・docs/fields-group3-design.md §1・§4）。
 * 北の野から、城下町の南の 3 つの出口（西の脇道・大通り・東の門口）へ向かう敵勢の攻め手 7 隊の突破を、7 分まで 2 部隊以内に抑える。
 * 攻め手は時間差で現れ、西の脇道と東の門口には二隊がほぼ同時に着く波が来る（どちらの道へ来るかは、林を出てからの向きで見る）。
 *
 * 確かめること：
 * - データと地形（状態を直接見る）：主目標は突破を抑える（部隊単位）。家屋・塀は通れず射線を遮る。縁は 5 m の格子の線にそろう。
 *   攻め手の道は西の脇道・大通り・東の門口に分かれる。
 * - 主目標に届く作戦（早送り）が 3 つあり、±15 秒の 16 通りで安定する。作戦どうしで損害・突破の数・副目標が違う。
 * - 準備した正面攻撃（野へ打って出る。弓・予備・能力・兵種）と、無計画な攻撃（全部隊で一番近い敵へ当て直すだけ）を分けて比べる。
 *   「正面なら必ず負ける」は合格条件にしない（準備した正面攻撃は勝てるが損害が大きい、無計画は記録）。
 * - 副目標が作戦で分かれる組（辻で挟む：市 ✓・弓 ✗／出口の前：市 ✗／野へ打って出る：弓 ✓・損害 ✗）。
 * - 武将の能力の価値が地形で変わる比べ（酒井の両翼の采配：辻で二方向から挟むと効く／脇道の口の 1 対 1 では効かない）。
 * - 勝ちが、角を挟んで隣り合った部隊が斬り合わずに止まる組（エンジンの既知の穴。下の「止まり」）に頼っていないこと。
 *
 * どれも「早送り」（決まった時刻・見てから押す行で issueOrder・useAbility を出す台本を runToEnd で最後まで進める）。画面の操作ではない。
 * 台本は人が画面でできる程度にしている：最初の配置は 2 秒おきに 1 部隊ずつ押す。命令は 1 つの台本で 16 回まで、続けて押す間は 1 秒以上
 * （テストで確かめる）。移動の後の向き（face）は画面から指定できないので使わない。部隊は進んだ向きを向くので、北を向かせたい所へは、
 * いったん南へ行き過ぎてから北へ押し戻す（2 回押す。押し戻しが短いと向き直りきらない）。画面では敵の近くの地面を押すとその敵への攻撃に
 * なるので、台本の地面の行き先（tap）も、押す点の 20 m 以内に見えている敵がいればその敵への攻撃にする（tests/proto3d-group3-helpers.ts）。
 * 'nearest' は「見えている一番近い敵を押す」（当て直し）。待機の味方は、隣で味方が斬り合っていても自分からは斬りかからないので、挟むには押す。
 * ±15 秒の 16 通りは、0 秒でない時刻の行だけをずらす（決まった乱数。第3群のほかのテストと同じ作り方）。「見てから押す」行はずらさない。
 *
 * 作った時の結果（早送り。16 通りの勝ち数・平均の損害・平均の突破の数・副目標を果たした数。損害 3 割以内／市／野の弓）：
 * - 辻で挟み、波を見て弓を回す（WATCH）：16／16 勝・損害 22.4％・突破 0.38・損害 16／市 16／弓 0。
 * - 出口の前で受ける（EXITS）：16／16 勝・損害 29.2％・突破 2.00（許容を使い切る）・損害 15／市 0／弓 0。命令は 11 回。
 * - 準備した正面攻撃（野へ打って出る。FRONTAL）：16／16 勝・損害 39.8％・突破 2.00・損害 0／市 16／弓 16。
 * - 通りの口に二隊ずつ置いて動かさない（STATIC）：10／16 勝・突破 2.38（記録）。町の北の口で 1 対 1 で受ける（MOUTH）：13／16 勝・損害 43.0％（記録）。
 * - 大通りに集中（MAIN）：0／16 勝（記録：脇道・門口から 3 部隊抜けて 241 秒に負け。損害 2.4％）。待つだけ（HOLD）：同じく 241 秒に負け。
 * - 無計画（UNPLANNED）：0／16 勝（記録：平均 300 秒に負け・損害 23.8％・突破 2.81。野の弓は 16／16 崩す）。
 * - 酒井の両翼の采配：辻（WATCH）で西の二つ目の波を挟むときに使うと、その間の酒井隊・石川隊の損害 59 → 19・二隊が崩れるのが 326 → 311 秒。
 *   脇道の口（MOUTH）で使っても、損害・時刻とも 1 も変わらない（正面の 1 対 1 だけで、包囲にならない）。
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
 * 行き過ぎてから押し戻す（向きを変える）：start 秒に 1 つ目の点を押し、着いて待機になったら 2 つ目の点を押す。
 * 部隊は進んだ向きを向くので、北を向かせたい所へは南から押し戻す（画面では向きを指定できない）
 */
function route(id: string, pts: [[number, number], [number, number]], start: number): Step[] {
    const prog = new WeakMap<BattleState, number>();
    return pts.map((p, i): Step => [
        (s) => {
            const k = prog.get(s) ?? 0;
            if (k !== i) return false;
            const go = i === 0 ? s.t >= start - 1e-9 : idle(id)(s);
            if (go) prog.set(s, k + 1);
            return go;
        },
        id,
        tap(p[0], p[1]),
    ]);
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

/** 時刻の行を ±15 秒ずらした 16 通り（決まった乱数。0 秒の行と「見てから押す」行はずらさない） */
function jitter(base: Step[]): Run[] {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const out: Run[] = [];
    for (let k = 0; k < 16; k++) out.push(play(base.map((x) => (typeof x[0] === 'number' && x[0] !== 0 ? ([x[0] + Math.round((rnd() - 0.5) * 30), x[1], x[2]] as Step) : x))));
    return out;
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
const sixteen = (p: Step[]) => {
    if (!memo16.has(p)) memo16.set(p, jitter(p));
    return memo16.get(p)!;
};

// ---------------------------------------------------------------- 台本

/**
 * 辻で挟み、波を見て弓を回す（進路を見て組み替える。命令 14 回）：
 * 忠勝隊は大通りの北 (0,80)。酒井隊は横道の西 (-112,102)（西へ進んで西＝辻を向く）、石川隊は西の脇道の辻の南 (-140,124)（南へ行き過ぎて
 * 北へ押し戻す）。榊原隊・騎馬隊も東で同じ形。弓は大通り (0,108)。片方が斬り合ったら、もう片方がその敵を押す（二方向から挟む）。
 * 大通りの攻め手が崩れたら弓を東の辻の手前 (70,102) へ、東の騎馬が崩れたら西の辻の手前 (-70,102) へ回す
 */
const WATCH: Step[] = [
    [2, 'a_tadakatsu', tap(0, 80)],
    [4, 'a_sakai', tap(-112, 102)],
    ...route('a_ishikawa', [[-140, 150], [-140, 124]], 6),
    [8, 'a_yumi', tap(0, 108)],
    [10, 'a_sakakibara', tap(112, 102)],
    ...route('a_kiba', [[140, 150], [140, 124]], 12),
    [later(engaged('a_sakai'), 1), 'a_ishikawa', 'nearest'],
    [later(engaged('a_ishikawa'), 1), 'a_sakai', 'nearest'],
    [later(engaged('a_sakakibara'), 1), 'a_kiba', 'nearest'],
    [later(engaged('a_kiba'), 1), 'a_sakakibara', 'nearest'],
    [gone('e_m_yari'), 'a_yumi', tap(70, 102)],
    [gone('e_e_kiba'), 'a_yumi', tap(-70, 102)],
];
/** 辻で挟む（WATCH）で、西の二つ目の波（3 分 10 秒・3 分 50 秒）を酒井隊と石川隊が二方向から斬り合ったら、酒井の両翼の采配 */
const bothWest: Cond = (s) => s.t > 280 && engaged('a_sakai')(s) && engaged('a_ishikawa')(s);
const WATCH_SAKAI: Step[] = [...WATCH, [later(bothWest, 1), 'a_sakai', ab()]];

/**
 * 出口の前で受ける（命令 11 回）：榊原隊は門口の内側 (140,163)、騎馬隊はその西 (122,175)。酒井隊は西の脇道の南 (-140,140)、
 * 石川隊は西の裏通り (-120,175)。忠勝隊は大通りの南 (0,165)、弓はその後ろの裏通り (-20,176)、家康本陣は (-45,176)。
 * 北を向かせる所は、南へ行き過ぎてから押し戻す。榊原隊が斬り合ったら騎馬隊が押す
 */
const EXITS: Step[] = [
    ...route('a_sakakibara', [[140, 180], [140, 163]], 2),
    ...route('a_sakai', [[-140, 178], [-140, 140]], 4),
    [6, 'a_kiba', tap(122, 175)],
    ...route('a_tadakatsu', [[0, 195], [0, 165]], 8),
    [10, 'a_ishikawa', tap(-120, 175)],
    [later(near('a_tadakatsu', 0, 165, 6), 1), 'a_yumi', tap(-20, 176)],
    [14, 'a_ieyasu', tap(-45, 176)],
    [later(engaged('a_sakakibara'), 1), 'a_kiba', 'nearest'],
];

/**
 * 準備した正面攻撃（野へ打って出る。命令 16 回）：酒井隊だけ横道の西に残し、弓を野 (0,-20) へ出して押さえを射る。忠勝隊が押さえの前
 * (0,-45) に着いたら押さえへ当たり、石川隊も押さえへ。榊原隊は西から野の弓へ当たって先駆けの号（弓へ ×1.5）、騎馬隊も野の弓へ。
 * 押さえが崩れたら忠勝隊は大通り、石川隊は西の脇道の辻の南、弓は大通りへ戻る。野の弓が崩れたら榊原隊・騎馬隊は東の辻へ戻る
 */
const FRONTAL: Step[] = [
    [2, 'a_sakai', tap(-112, 102)],
    [4, 'a_yumi', tap(0, -20)],
    [6, 'a_tadakatsu', tap(0, -45)],
    [8, 'a_ishikawa', tap(-35, -40)],
    [10, 'a_sakakibara', tap(-70, -75)],
    [12, 'a_kiba', tap(70, -75)],
    [later(near('a_tadakatsu', 0, -45, 8), 1), 'a_tadakatsu', atk('e_guard')],
    [later(engaged('a_tadakatsu'), 1), 'a_ishikawa', atk('e_guard')],
    [later(engaged('a_tadakatsu'), 2), 'a_sakakibara', atk('e_yumi')],
    [later(engaged('a_tadakatsu'), 3), 'a_sakakibara', ab()],
    [later(engaged('a_tadakatsu'), 4), 'a_kiba', atk('e_yumi')],
    [gone('e_guard'), 'a_tadakatsu', tap(0, 80)],
    [later(gone('e_guard'), 1), 'a_ishikawa', tap(-140, 124)],
    [later(gone('e_guard'), 2), 'a_yumi', tap(0, 108)],
    [gone('e_yumi'), 'a_sakakibara', tap(112, 102)],
    [later(gone('e_yumi'), 1), 'a_kiba', tap(140, 124)],
];

/** 通りの口に二隊ずつ置いて動かさない（町の北の口。命令 8 回）：片方が斬り合ったら、もう片方が押すだけ */
const STATIC: Step[] = [
    [2, 'a_tadakatsu', tap(0, 75)],
    [4, 'a_sakai', tap(-140, 65)],
    [6, 'a_ishikawa', tap(-140, 85)],
    [8, 'a_yumi', tap(0, 105)],
    [10, 'a_kiba', tap(140, 60)],
    [12, 'a_sakakibara', tap(140, 80)],
    [later(engaged('a_sakai'), 1), 'a_ishikawa', 'nearest'],
    [later(engaged('a_kiba'), 1), 'a_sakakibara', 'nearest'],
];

/**
 * 町の北の口で 1 対 1 で受け、波を見て回す（命令 13 回）：酒井隊は西の脇道の北の口 (-140,65)、石川隊は横道の西で待つ。
 * 東の波が見えたら騎馬隊・榊原隊を東の口へ、大通りの攻め手が崩れたら忠勝隊を東へ回し、市の攻め手が見えたら大通りへ戻す
 */
const MOUTH: Step[] = [
    [2, 'a_tadakatsu', tap(0, 75)],
    [4, 'a_sakai', tap(-140, 65)],
    [6, 'a_ishikawa', tap(-115, 102)],
    [8, 'a_yumi', tap(0, 105)],
    [10, 'a_sakakibara', tap(60, 102)],
    [12, 'a_kiba', tap(100, 102)],
    [later(engaged('a_sakai'), 1), 'a_ishikawa', 'nearest'],
    [(s) => !!unitOf(s, 'e_e_yari')?.arrived, 'a_kiba', tap(140, 60)],
    [later((s) => !!unitOf(s, 'e_e_yari')?.arrived, 2), 'a_sakakibara', tap(140, 80)],
    [gone('e_m_yari'), 'a_tadakatsu', tap(125, 102)],
    [later(engaged('a_kiba'), 1), 'a_sakakibara', 'nearest'],
    [later(engaged('a_kiba'), 3), 'a_tadakatsu', 'nearest'],
    [(s) => !!unitOf(s, 'e_m_raid')?.arrived, 'a_tadakatsu', tap(0, 75)],
];
/** 町の北の口（MOUTH）で、西の二つ目の波と酒井隊が斬り合ったら、酒井の両翼の采配 */
const MOUTH_SAKAI: Step[] = [...MOUTH, [later((s) => s.t > 280 && engaged('a_sakai')(s), 1), 'a_sakai', ab()]];

/** 大通りに集中する（脇道・門口は空ける。命令 6 回） */
const MAIN: Step[] = [
    [2, 'a_tadakatsu', tap(0, 72)],
    [4, 'a_sakai', tap(-8, 90)],
    [6, 'a_yumi', tap(0, 110)],
    [8, 'a_ishikawa', tap(8, 90)],
    [10, 'a_sakakibara', tap(0, 125)],
    [12, 'a_kiba', tap(0, 140)],
];
/** 無計画：全部隊で、見えている一番近い敵へ 10 秒ごとに当て直す（第3群の共通の台本） */
const UNPLANNED: Step[] = unplanned(450) as Step[];
/** 待つだけ（命令を出さない） */
const HOLD: Step[] = [];

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
        expect([aim('e_w_yari').x, aim('e_w_yari2').x, aim('e_w_kiba').x]).toEqual([-90, -90, -90]);
        expect([aim('e_e_yari').x, aim('e_e_kiba').x]).toEqual([90, 90]);
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
        const west = findPath(nav, 'yari', -180, -185, -90, 193)!;
        expect(via(west, -145, -135, 45, 90)).toBe(true);
        expect(via(west, -15, 15, 45, 90)).toBe(false);
        const east = findPath(nav, 'yari', 180, -185, 90, 193)!;
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

    it('主目標に届く作戦が 3 つ（辻で挟む・出口の前で受ける・野へ打って出る）。どれも ±15 秒の 16 通りで 16 勝、止まりに頼らない', () => {
        for (const p of [WATCH, EXITS, FRONTAL]) {
            expect(won(once(p)), brief(once(p))).toBe(true);
            const rs = sixteen(p);
            expect(wins(rs)).toBe(16);
            // 勝ちが、角を挟んで止まった攻め手（出口へ進まない）に頼っていない
            expect(rs.flatMap((r) => r.stalls)).toEqual([]);
        }
    }, 300_000);

    it('作戦どうしの違い：辻で挟むと突破をほとんど許さず損害も少ない。出口の前・野へ打って出るは許容（2）を使い切り、損害が大きい', () => {
        const w = sixteen(WATCH);
        const e = sixteen(EXITS);
        const f = sixteen(FRONTAL);
        // 突破の数（平均）：辻 0.38 ／出口の前 2.00 ／野へ 2.00
        expect(mean(w, broke)).toBeLessThan(0.75);
        expect(mean(e, broke)).toBeGreaterThan(mean(w, broke) + 1);
        expect(mean(f, broke)).toBeGreaterThan(mean(w, broke) + 1);
        // 損害（平均）：辻 22.4％ < 出口の前 29.2％ < 野へ 39.8％
        expect(mean(w, (r) => r.loss)).toBeLessThan(mean(e, (r) => r.loss) - 0.04);
        expect(mean(e, (r) => r.loss)).toBeLessThan(mean(f, (r) => r.loss) - 0.05);
        // 出口の前で受ける作戦は命令が少ない（見てから押す行が 1 つ）
        expect(once(EXITS).cmdT.length).toBeLessThan(once(WATCH).cmdT.length);
    }, 300_000);

    it('副目標が作戦で分かれる：辻で挟む（損害 ✓・市 ✓・弓 ✗）／出口の前（市 ✗）／野へ打って出る（弓 ✓・損害 ✗）', () => {
        const w = sixteen(WATCH);
        const e = sixteen(EXITS);
        const f = sixteen(FRONTAL);
        expect([count(w, 'town_losses'), count(w, 'town_market'), count(w, 'town_yumi')]).toEqual([16, 16, 0]);
        // 出口の前で受けると、市を荒らす攻め手は誰にも当たらずに市に居座る
        expect(count(e, 'town_market')).toBe(0);
        expect(count(e, 'town_losses')).toBeGreaterThanOrEqual(12);
        expect([count(f, 'town_yumi'), count(f, 'town_market')]).toEqual([16, 16]);
        expect(count(f, 'town_losses')).toBeLessThanOrEqual(2);
        // 1 回の台本でも同じ分かれ方
        expect(['town_losses', 'town_market', 'town_yumi'].map((id) => sec(once(WATCH), id))).toEqual([true, true, false]);
        expect(sec(once(EXITS), 'town_market')).toBe(false);
        expect(['town_losses', 'town_yumi'].map((id) => sec(once(FRONTAL), id))).toEqual([false, true]);
    }, 300_000);

    it('準備した正面攻撃と無計画な攻撃の比べ：準備した方は主目標に届き、突破が少なく、最後まで戦える部隊が多い（無計画の結果は記録）', () => {
        const front = sixteen(FRONTAL);
        const raw = sixteen(UNPLANNED);
        // 準備した正面攻撃 16 勝（作った時）。無計画は 0 勝（記録：平均 300 秒に負け・突破 2.81）
        expect(wins(front)).toBeGreaterThanOrEqual(14);
        expect(wins(raw)).toBe(0);
        expect(mean(front, (r) => r.t)).toBeGreaterThan(mean(raw, (r) => r.t) + 60);
        expect(mean(front, broke)).toBeLessThan(mean(raw, broke) - 0.5);
        expect(mean(front, standing)).toBeGreaterThan(mean(raw, standing));
        // どちらも野の弓は崩す（16／16）。無計画は損害の割合では小さい（早く負けて戦いが終わる。記録：23.8％・準備 39.8％）
        expect([count(front, 'town_yumi'), count(raw, 'town_yumi')]).toEqual([16, 16]);
        expect(mean(raw, (r) => r.loss)).toBeLessThan(mean(front, (r) => r.loss));
    }, 300_000);

    it('準備した正面攻撃と地形に合った作戦の比べ：野へ打って出ると勝てるが、辻で挟むより損害が 15 点以上大きく、突破を多く許す', () => {
        expect(mean(sixteen(FRONTAL), (r) => r.loss)).toBeGreaterThan(mean(sixteen(WATCH), (r) => r.loss) + 0.15);
        expect(mean(sixteen(FRONTAL), broke)).toBeGreaterThan(mean(sixteen(WATCH), broke));
        // 1 回の台本：野で押さえに当たった忠勝隊が残る兵は、辻で挟むときより少ない
        expect(once(FRONTAL).left.a_tadakatsu!).toBeLessThan(once(WATCH).left.a_tadakatsu! - 100);
    }, 300_000);

    it('進路を見て組み替える価値：通りの口に二隊ずつ置いて動かさないと、同じ道へ二隊続けて来る波で抜けられやすい（記録：10／16 勝）', () => {
        const st = sixteen(STATIC);
        expect(wins(st)).toBeLessThan(wins(sixteen(WATCH)) - 3);
        expect(mean(st, broke)).toBeGreaterThan(mean(sixteen(WATCH), broke) + 1.5);
    }, 300_000);

    it('記録：大通りに集中すると、西の脇道・東の門口から 3 部隊抜けて負ける（損害は小さい）。待つだけでも同じ。無計画は野へ散って負ける', () => {
        const main = once(MAIN);
        expect(main.o.objectives!.primary!.achieved).toBe(false);
        expect(main.entered.length).toBe(3);
        expect(main.entered.every((id) => id.startsWith('e_w_') || id.startsWith('e_e_'))).toBe(true);
        expect(main.loss).toBeLessThan(0.1);
        expect(wins(sixteen(MAIN))).toBe(0);
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
        // 辻：損害 59 → 19、崩れるのが 326 → 311 秒（作った時）
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
