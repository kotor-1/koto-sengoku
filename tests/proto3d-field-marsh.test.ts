/**
 * 戦場「湿地」（marsh）の釣り合い（docs/fields-group3-design.md §1・§4、依頼本文 docs/fields-group3-request.md の「11. 湿地」）。
 * 主目標：味方の戦える部隊 4 つを北の出口へ抜けさせる（突破）。土手道（速い・首は 1 部隊の幅・両脇の弓・首の押さえ）、西の乾いた足場（島）、
 * 深い湿地（とても遅い・弓が射にくい・突撃が効かない）。
 *
 * 合格条件は「正面なら負ける」ではなく、作戦どうしの比べ（損害・時間・副目標・守れる部隊）と、主目標に届く作戦の安定性。
 * 無計画な攻撃・待つだけの結果は記録として書く。
 *
 * どれも「早送り」：決まった時刻と「見てから押す」行で issueOrder・useAbility を出す台本を runToEnd で最後まで進める（画面の操作ではない）。
 * 台本は人が画面でできる程度の命令の数・間隔にしている（一番多い準備した土手道で 24 回・約 5 分）。移動の後の向き（face）は使わない。
 * 画面では敵の近くの地面を押すとその敵への攻撃になるので、台本の地面の行き先（tap）も、押す点の 20 m 以内に見えている敵がいれば
 * その敵への攻撃にする（足場伝いで 3 つ目の島を押すと、島の槍への攻撃になる）。
 *
 * 揺らぎ（16 通り）：時刻の行は ±15 秒（乱数の種 7 から。第2群・第3群のテストと同じ作り方）。この戦場の台本はほとんどが「見てから押す」行なので、
 * その行には人が見てから押すまでの遅れ 0〜15 秒を足す（同じ乱数から。同じ条件を見て続けて押す行は同じ遅れ）。時刻の行だけをずらす
 * tests/proto3d-group3-helpers.ts の jitter より厳しい（あちらは見てから押す行をずらさない）。
 *
 * 地形の決まりで台本を書くときに気を付けたこと（エンジンの振る舞い。直すならエンジンの担当）：
 * - 乾いた足場は格子（5 m）の升の中心で決まる。土手道の上の行き先は |x| 7 m 以内にする（x 10 の升の中心は 12.5 で泥）。
 * - 泥の中にいる部隊の道は、A* の道の 2 倍の時間までならまっすぐ（泥の中）を選ぶ（pathfind.ts の SMOOTH_SLACK）。
 *   泥から土手道へ戻すときは、台本でも画面と同じく、先に土手道の上の点を押してから出口を押す。
 * - 部隊どうしは 18 m 離れる。土手道の上で止まっている味方を追い越すと脇の泥へ押し出されるので、並べる所は 18 m 以上離す。
 *
 * 作った時の結果（早送り。16 通りは上の揺らぎ。守れる部隊＝最後に戦える味方の部隊の数／7）：
 * | 作戦 | 1 通り | 16 通り |
 * | 足場伝い（WEST） | 375 秒・損害 8.5％・勝ち・損害 ✓ 押さえ ✗ 足場の槍 ✓・7／7 | 16 勝・平均 413 秒（388〜429）・損害 9.5％ |
 * | 準備した土手道（PREP・準備した正面攻撃） | 283 秒・16.2％・勝ち・損害 ✗ 押さえ ✓ 足場の槍 ✗・7／7 | 15 勝・平均 310 秒（281〜354）・22.0％ |
 * | 組み合わせ（COMBO） | 287 秒・19.5％・勝ち・損害 ✗ 押さえ ✓ 足場の槍 ✓・7／7 | 16 勝・平均 325 秒（299〜348）・26.8％ |
 * | 無計画：全部隊で出口へ一斉（RUSH） | 249 秒・43.9％・勝ち・損害 ✗ 押さえ ✓ 足場の槍 ✗・3／7 | （時刻の行・見てから押す行が無いので 16 通りとも同じ） |
 * | 無計画：一番近い敵へ当て直すだけ（NEAREST） | 325 秒に負け・37.1％・3／7 | |
 * | 待つ（HOLD） | 日没・損害 0 | |
 *
 * 武将の能力の価値が地形で変わる比べ：榊原の先駆けの号（土手道の首の手前の広い所から東の弓へ／泥の中から東の弓へ）。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, isActive, issueOrder, runToEnd, unitById, unitSpeedFactor, RULES, type BattleState } from '../proto3d/src/battle/sim';
import { ABILITY_DATA, useAbility } from '../proto3d/src/battle/abilities';
import { arrowDealMulIn, inZone, noChargeIn } from '../proto3d/src/battle/fieldRules';
import { buildBattleSetup, getField, presetUnits, validateField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';

const MS = getField('marsh')!;

// ---------------------------------------------------------------- 台本の道具

/** 地面を押す（押す点の 20 m 以内に見えている敵がいれば、その敵への攻撃。画面と同じ） */
interface Tap {
    tap: [number, number];
}
/** 対象を選ぶ能力（後詰めの差配など）。'ability' は対象を選ばない能力、'nearest' は「見えている一番近い敵へ攻撃」（今の相手が戦えるなら出さない） */
interface Abil {
    abilityOn: string;
}
type Cmd = Order | Tap | Abil | 'ability' | 'nearest';
type Cond = (s: BattleState) => boolean;
/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]、または [条件, 部隊 id, 命令]（見てから押す。条件が初めて真になった刻みに 1 回） */
type Step = [number | Cond, string, Cmd];
/** 揺らぎ：t は時刻の行の秒、d は見てから押すまでの遅れ（秒） */
interface J {
    t: (x: number) => number;
    d: () => number;
}
/** 台本は揺らぎを受け取って行の並びを返す */
type Plan = (j: J) => Step[];

const atk = (targetId: string): Order => ({ type: 'attack', targetId });
const tap = (x: number, z: number): Tap => ({ tap: [x, z] });
/** 揺らぎ無し（1 通り） */
const J0: J = { t: (x) => x, d: () => 0 };
/** k 通り目の揺らぎ（乱数の種 7。時刻の行は ±15 秒、見てから押す行は 0〜15 秒の遅れ） */
function jitterOf(k: number): J {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < k * 40; i++) rnd();
    return { t: (x) => (x === 0 ? 0 : x + Math.round((rnd() - 0.5) * 30)), d: () => Math.round(rnd() * 15) };
}

function seenEnemies(s: BattleState) {
    return s.units.filter((x) => x.side === 'enemy' && isActive(x) && x.seenBy.ally);
}
function nearestEnemy(s: BattleState, id: string): Order | null {
    const u = unitById(s, id)!;
    if (!isActive(u)) return null;
    if (u.order.type === 'attack') {
        const cur = unitById(s, u.order.targetId);
        if (cur && isActive(cur)) return null;
    }
    const e = seenEnemies(s).sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
    return e ? atk(e.id) : null;
}
function tapOrder(s: BattleState, [x, z]: [number, number]): Order {
    const e = seenEnemies(s)
        .filter((u) => Math.hypot(u.x - x, u.z - z) <= 20)
        .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    return e ? atk(e.id) : { type: 'move', x, z };
}

/** 敵の部隊が崩れた（敗走・全滅・撤退）。まだ現れていない部隊は false */
const gone =
    (id: string): Cond =>
    (s) => {
        const u = unitById(s, id);
        return !!u && u.arrived && u.status !== 'ready';
    };
/** 部隊が (x, z) の r m 以内にいる */
const near =
    (id: string, x: number, z: number, r: number): Cond =>
    (s) => {
        const u = unitById(s, id);
        return !!u && isActive(u) && Math.hypot(u.x - x, u.z - z) <= r;
    };
/** 部隊がその敵と斬り合っている */
const engaged =
    (id: string, enemy: string): Cond =>
    (s) =>
        unitById(s, id)?.engagedWith === enemy;
/** 部隊が待機している（移動の行き先に着いた・攻撃の相手が崩れた。斬り合っていない） */
const idle =
    (id: string): Cond =>
    (s) => {
        const u = unitById(s, id);
        return !!u && isActive(u) && u.order.type === 'hold' && !u.engagedWith;
    };
const all =
    (...cs: Cond[]): Cond =>
    (s) =>
        cs.every((c) => c(s));
/** 条件が初めて真になってから d 秒後に真（人が見てから押すまでの遅れ） */
function late(c: Cond, d: number): Cond {
    if (d <= 0) return c;
    const seenAt = new WeakMap<BattleState, number>();
    return (s) => {
        let t0 = seenAt.get(s);
        if (t0 === undefined) {
            if (!c(s)) return false;
            seenAt.set(s, (t0 = s.t));
        }
        return s.t >= t0 + d - 1e-9;
    };
}

/**
 * 組の道筋（見てから押す）：ids の部隊それぞれに pts[k][i] を押す。最初の点は 0 秒、次の点からは、組の戦える部隊がみな待機になってから
 * （前の点に着いた・攻撃の相手が崩れた。人が画面で、組が着いたのを見てから次の足場を押すのと同じ。押すまでの遅れは j.d()）
 */
function squad(ids: string[], pts: [number, number][][], j: J): Step[] {
    const prog = new WeakMap<BattleState, number>();
    const done = new WeakMap<BattleState, Set<string>>();
    const out: Step[] = [];
    pts.forEach((row, k) => {
        const ready: Cond = k === 0 ? () => true : (s) => ids.every((x) => !isActive(unitById(s, x)!) || idle(x)(s));
        const go = late((s) => (prog.get(s) ?? 0) === k && ready(s), k === 0 ? 0 : j.d());
        ids.forEach((id, i) => {
            const cond: Cond = (s) => {
                if ((prog.get(s) ?? 0) === k && go(s)) prog.set(s, k + 1);
                if ((prog.get(s) ?? 0) !== k + 1) return false;
                let f = done.get(s);
                if (!f) done.set(s, (f = new Set()));
                const key = `${k}:${i}`;
                if (f.has(key)) return false;
                f.add(key);
                return true;
            };
            out.push([cond, id, tap(row[i]![0], row[i]![1])]);
        });
    });
    return out;
}

interface Run {
    o: BattleOutcome;
    /** 終わった時刻（秒） */
    t: number;
    /** 味方の兵の損害の割合（0〜1） */
    loss: number;
    /** 部隊ごとの兵の残り */
    left: Record<string, number>;
    /** 断られた命令 */
    refused: string[];
    /** 出口へ着いた時刻（部隊 id → 秒） */
    entered: Record<string, number>;
}

/** 台本を最後まで進める（each は刻みごと。様子を見るとき） */
function play(steps: Step[], each?: (s: BattleState) => void): Run {
    const s = createBattle(buildBattleSetup(MS, 'standard'));
    const timed = steps.filter((x) => typeof x[0] === 'number').sort((a, b) => (a[0] as number) - (b[0] as number));
    const watch = steps.filter((x) => typeof x[0] === 'function');
    const fired = new Set<number>();
    const refused: string[] = [];
    const entered: Record<string, number> = {};
    const run = (st: BattleState, label: string, id: string, ord: Cmd) => {
        if (ord === 'nearest') {
            const n = nearestEnemy(st, id);
            if (n && !issueOrder(st, id, n)) refused.push(`${label}:${id}`);
        } else if (ord === 'ability') {
            if (!useAbility(st, id).ok) refused.push(`${label}:${id}`);
        } else if ('abilityOn' in ord) {
            if (!useAbility(st, id, ord.abilityOn).ok) refused.push(`${label}:${id}`);
        } else if (!issueOrder(st, id, 'tap' in ord ? tapOrder(st, ord.tap) : ord)) refused.push(`${label}:${id}`);
    };
    const o = runToEnd(s, (st) => {
        while (timed.length && st.t >= (timed[0]![0] as number) - 1e-9) {
            const [t, id, ord] = timed.shift()!;
            run(st, String(t), id, ord);
        }
        watch.forEach(([cond, id, ord], i) => {
            if (fired.has(i) || !(cond as Cond)(st)) return;
            fired.add(i);
            run(st, `when${i}@${st.t.toFixed(1)}`, id, ord);
        });
        for (const id of st.objectives?.primary?.entered ?? []) if (!(id in entered)) entered[id] = st.t;
        each?.(st);
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    return { o, t: s.t, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused, entered };
}

const won = (r: Run) => r.o.result === 'victory' && r.o.objectives?.primary?.achieved === true;
const secondaryOf = (r: Run, id: string) => r.o.objectives!.secondary.find((x) => x.id === id)!.achieved;
const secondaries = (r: Run) => ['marsh_losses', 'marsh_block', 'marsh_isle'].map((id) => secondaryOf(r, id));
const statusOf = (r: Run, id: string) => r.o.units.find((u) => u.id === id)!.status;
const ALLY = ['a_ieyasu', 'a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa', 'a_yumi', 'a_kiba'];
/** 守れる部隊：最後に戦える（崩れていない）味方の部隊の数 */
const standing = (r: Run) => ALLY.filter((id) => statusOf(r, id) === 'ready').length;
const meanOf = (rs: Run[], f: (r: Run) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
const winsOf = (rs: Run[]) => rs.filter(won).length;
/** 失敗の文に添える短い要約 */
function brief(r: Run): string {
    const sec = r.o.objectives?.secondary.map((x) => `${x.id}:${x.achieved ? '✓' : '✗'}`).join(' ');
    return `${r.o.result}/${r.o.reason} t=${r.t.toFixed(1)} loss=${(r.loss * 100).toFixed(1)}% ${sec} refused=${r.refused.join(',')}`;
}

// ---------------------------------------------------------------- 台本

/** 西の足場（島）の中心（marsh.ts の ISLES と同じ） */
const ISLES: [number, number][] = [
    [-95, 112],
    [-140, 62],
    [-160, 4],
    [-165, -52],
    [-135, -108],
];
/** 島の上の 4 つの置き場（18 m ずつ離す。並びの前 2 つが北＝先頭） */
const four = ([x, z]: [number, number]): [number, number][] => [
    [x - 9, z - 9],
    [x + 9, z - 9],
    [x - 9, z + 9],
    [x + 9, z + 9],
];
/** 足場伝いの最後の行き先（出口の区域の西。出口の中ほどの槍の守る輪の外） */
const WEST_EXIT: [number, number][] = [
    [-150, -182],
    [-128, -182],
    [-150, -200],
    [-128, -200],
];

/**
 * 足場伝い：酒井隊・石川隊（槍）を先頭、徳川騎馬隊・榊原隊（騎馬）を後ろに組にして、5 つの島を順に押す（島ごとに 4 回。組がみな着いたのを
 * 見てから次の島）。3 つ目の島を押すと島の槍への攻撃になり、4 隊で崩す。最後に出口の西へ。命令は 24 回
 */
const WEST: Plan = (j) => squad(['a_sakai', 'a_ishikawa', 'a_kiba', 'a_sakakibara'], [...ISLES.map(four), WEST_EXIT], j);

/**
 * 準備した土手道（準備した正面攻撃。弓・予備・能力・兵種を使う）。命令は 24 回：
 * - 0 秒：榊原隊（騎馬）は首の手前の広い所 (7,28) へ（土手道を駆ける）。忠勝隊は (-7,64)、弓隊は (7,92) で待つ（後ろの隊の通り道を塞がない）。
 * - 榊原隊が着いたら：先駆けの号を使い、東の足場の弓へ（泥 15 m を渡って効果中に当たる）。
 * - 東の弓が崩れたら：榊原隊は東の足場 (42,12) へ。忠勝隊は首の口 (0,26) へ。弓隊は (-7,46) へ出て西の足場の弓を射る。酒井隊は (7,62) へ。
 * - 酒井隊が着いたら：家康本陣を (-7,92)（号令の届く所）へ、徳川騎馬隊を (7,112) へ。
 * - 忠勝隊・酒井隊がそろったら：酒井隊は首の東の泥 (24,8) へ降りる。着いたら忠勝隊（正面）・酒井隊（東の泥から）・榊原隊（東の足場から）で押さえへ。
 *   忠勝隊が斬り合い始めたら酒井の両翼の采配と家康の号令。
 * - 押さえが崩れたら：騎馬 2 隊と忠勝隊は土手道を北の出口へ。酒井隊は先に土手道の上 (2,-40) へ戻ってから出口へ。
 */
const PREP: Plan = (j) => {
    const W = (c: Cond) => late(c, j.d());
    const yeGone = W(gone('e_yumi_e'));
    const sakAt = W(near('a_sakai', 7, 62, 10));
    const flankGo = W(all(near('a_sakai', 7, 62, 10), near('a_tadakatsu', 0, 26, 10)));
    const inPos = W(near('a_sakai', 24, 8, 8));
    const blockGone = W(gone('e_block'));
    const atStage = W(near('a_sakakibara', 7, 28, 9));
    const fight = W(engaged('a_tadakatsu', 'e_block'));
    return [
        [0, 'a_sakakibara', tap(7, 28)],
        [0, 'a_tadakatsu', tap(-7, 64)],
        [0, 'a_yumi', tap(7, 92)],
        [atStage, 'a_sakakibara', 'ability'],
        [atStage, 'a_sakakibara', atk('e_yumi_e')],
        [yeGone, 'a_sakakibara', tap(42, 12)],
        [yeGone, 'a_tadakatsu', tap(0, 26)],
        [yeGone, 'a_yumi', tap(-7, 46)],
        [W(near('a_yumi', -7, 46, 9)), 'a_yumi', atk('e_yumi_w')],
        [yeGone, 'a_sakai', tap(7, 62)],
        [sakAt, 'a_ieyasu', tap(-7, 92)],
        [sakAt, 'a_kiba', tap(7, 112)],
        [flankGo, 'a_sakai', tap(24, 8)],
        [inPos, 'a_tadakatsu', atk('e_block')],
        [inPos, 'a_sakai', atk('e_block')],
        [inPos, 'a_sakakibara', atk('e_block')],
        [fight, 'a_sakai', 'ability'],
        [fight, 'a_ieyasu', 'ability'],
        [blockGone, 'a_kiba', tap(-7, -185)],
        [blockGone, 'a_sakakibara', tap(7, -190)],
        [blockGone, 'a_tadakatsu', tap(0, -178)],
        [blockGone, 'a_sakai', tap(2, -40)],
        [W(near('a_sakai', 2, -40, 10)), 'a_sakai', tap(0, -175)],
    ];
};

/**
 * 組み合わせ：準備した土手道（忠勝隊・酒井隊・榊原隊・弓・家康本陣）に、石川隊・徳川騎馬隊の足場伝い（2 隊の組で島を伝い、
 * 3 つ目の島の槍を崩して出口の西へ）を重ねる。命令は 34 回
 */
const COMBO: Plan = (j) => [...PREP(j).filter((s) => s[1] !== 'a_kiba'), ...squad(['a_ishikawa', 'a_kiba'], [...ISLES.map((p) => four(p).slice(0, 2)), WEST_EXIT.slice(0, 2)], j)];

/** 本陣以外の 6 部隊 */
const MOVERS = ['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_sakakibara', 'a_kiba', 'a_yumi'];
/** 無計画（目標へ一斉）：0 秒に 6 部隊で北の出口 (0,-185) を押す（道探しは土手道を選ぶ）。後は何もしない */
const RUSH: Plan = () => MOVERS.map((id) => [0, id, tap(0, -185)] as Step);
/** 無計画（当て直しだけ）：10 秒ごとに、6 部隊で見えている一番近い敵へ当て直す（第3群のテストの unplanned と同じ） */
const NEAREST: Plan = () => MOVERS.flatMap((id) => Array.from({ length: 60 }, (_, k) => [1 + k * 10, id, 'nearest'] as Step));

/** 同じ台本は 1 回だけ進める */
const memo = new Map<Plan, Run>();
const run1 = (p: Plan): Run => {
    if (!memo.has(p)) memo.set(p, play(p(J0)));
    return memo.get(p)!;
};
const memo16 = new Map<Plan, Run[]>();
const run16 = (p: Plan): Run[] => {
    if (!memo16.has(p)) memo16.set(p, Array.from({ length: 16 }, (_, k) => play(p(jitterOf(k)))));
    return memo16.get(p)!;
};

// ---------------------------------------------------------------- データ

describe('湿地のデータ', () => {
    it('検査を通る。味方 7／敵 8（後詰め 1 を含む・同時の部隊数は上限内）。主目標は突破（敵本陣の撃破ではない）。副目標 3 つ。武将の自由な動き', () => {
        expect(validateField(MS)).toEqual([]);
        const us = presetUnits(MS, 'standard');
        expect(us.filter((u) => u.side === 'ally').map((u) => u.id)).toEqual(ALLY);
        expect(us.find((u) => u.id === 'a_sakakibara')!.kind).toBe('kiba');
        const en = us.filter((u) => u.side === 'enemy');
        expect(en.map((u) => u.id)).toEqual(['e_hq', 'e_block', 'e_yumi_w', 'e_yumi_e', 'e_isle', 'e_exit', 'e_kiba', 'e_reinf']);
        expect(en.every((u) => u.clan === 'rival')).toBe(true);
        expect(en.length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.enemy);
        expect(MS.objectives.primary).toMatchObject({ id: 'marsh_break', type: 'breakthrough', count: 4 });
        expect(MS.objectives.secondary.map((o) => [o.id, o.type])).toEqual([
            ['marsh_losses', 'limit_losses'],
            ['marsh_block', 'break_unit'],
            ['marsh_isle', 'break_unit'],
        ]);
        expect(MS.generalInitiative).toBe(true);
        expect(MS.pathfinding).toBe(true);
        // 後詰めは 300 秒に土手道の北の端（援軍。画面に出る所の印が付く）
        expect(MS.reinforcements).toEqual([{ id: 'north', side: 'enemy', at: 300, point: { x: 0, z: -212, facing: Math.PI }, label: '後詰めの槍（北から土手道へ）' }]);
        expect(buildBattleSetup(MS, 'standard').reinforcements).toEqual([{ id: 'north', side: 'enemy', unitIds: ['e_reinf'] }]);
        // 主目標・副目標は結果に別々に入る
        const s = createBattle(buildBattleSetup(MS, 'standard'));
        expect(s.objectives!.primary!.def.id).toBe('marsh_break');
        expect(s.objectives!.secondary.map((r) => r.def.id)).toEqual(['marsh_losses', 'marsh_block', 'marsh_isle']);
    }, 60_000);

    it('地形（状態を直接置いて読む）：土手道は ×1.2（南北は幅 24 m、首は幅 14 m）、泥は槍 ×0.35・騎馬 ×0.21・矢 ×0.7・突撃なし、島は普通の地面。水田の色替えではない', () => {
        const s = createBattle(buildBattleSetup(MS, 'standard'));
        const f = (kind: 'kiba' | 'yari' | 'yumi', x: number, z: number) => unitSpeedFactor(s, { kind, x, z });
        // 土手道：南の広い所・首・北の広い所
        for (const [x, z] of [[9, 90], [-9, 90], [0, -20], [5, -40], [9, -100], [-9, -120]] as const) expect([x, z, f('yari', x, z)]).toEqual([x, z, 1.2]);
        // 首の脇は泥（南北の広い所の x ±9 は土手道）
        for (const [x, z] of [[10, -20], [-10, -40], [20, 0]] as const) {
            expect(f('yari', x, z)).toBeCloseTo(0.35, 5);
            expect(f('kiba', x, z)).toBeCloseTo(0.21, 5);
            expect(arrowDealMulIn(s.map, s.field, x, z)).toBeCloseTo(0.7, 5);
            expect(noChargeIn(s.map, s.field, x, z)).toBe(true);
        }
        // 西の島・弓の小さな足場は普通の地面（泥の倍率を打ち消す）
        for (const [x, z] of [...ISLES, [-42, -38], [42, 12]] as const) {
            expect(f('yari', x, z)).toBe(1);
            expect(arrowDealMulIn(s.map, s.field, x, z)).toBe(1);
            expect(noChargeIn(s.map, s.field, x, z)).toBe(false);
        }
        // 水田（paddy）は使わない（湿地は別の地形）。島は 5 つ、土手道は乾いた足場の上の道
        expect(MS.terrain.some((t) => t.kind === 'paddy')).toBe(false);
        expect(MS.terrain.filter((t) => t.kind === 'dry' && t.circle).length).toBe(7);
        expect(MS.terrainRules).toEqual({ marsh: { kindSpeed: { kiba: 0.6 }, arrowDealMul: 0.7, noCharge: true } });
        // 槍の速さ（m/秒）：土手道 3.6・泥 1.05・島 3。騎馬は土手道 7.2・泥 1.26
        expect(3 * 1.2).toBeCloseTo(3.6, 5);
        expect(3 * f('yari', 20, 0)).toBeCloseTo(1.05, 5);
        expect(6 * f('kiba', 20, 0)).toBeCloseTo(1.26, 5);
    }, 60_000);

    it('置き方：押さえは首の真ん中で、首の南の口は狭い正面（1 部隊まで）・脇の泥はその外。両脇の弓は土手道と首の脇に届き、島 1〜4 には届かない', () => {
        const rule = MS.specialRules![0]!;
        if (rule.type !== 'narrow_frontage') throw new Error('narrow_frontage のはず');
        expect(rule.maxEngaged).toBe(1);
        const dep = (id: string) => MS.deployments.enemy.find((d) => d.id === id)!;
        const block = dep('block');
        expect([block.x, block.z]).toEqual([0, -20]);
        expect(inZone(rule.zone, block.x, block.z)).toBe(false);
        // 首の南の口（押さえの 22〜25 m 南）は区域の中、脇の泥（横から当たる所）は外
        for (const [x, z] of [[0, 3], [0, 25]] as const) expect(inZone(rule.zone, x, z)).toBe(true);
        for (const [x, z] of [[24, 8], [-24, 0], [20, -20]] as const) expect(inZone(rule.zone, x, z)).toBe(false);
        const range = RULES.bowRange;
        const d = (a: { x: number; z: number }, x: number, z: number) => Math.hypot(a.x - x, a.z - z);
        for (const id of ['yumi_w', 'yumi_e']) {
            const y = dep(id);
            // 首の口・首の脇の泥へ届く
            expect(d(y, 0, 10)).toBeLessThan(range);
            expect(d(y, 24, 8)).toBeLessThan(range);
            // 島 1〜4 には届かない（5 つ目の島は西の弓の届く端）
            for (const [x, z] of ISLES.slice(0, 4)) expect(d(y, x, z)).toBeGreaterThan(range);
            // 味方の最初の陣には届かない
            for (const a of MS.deployments.ally) expect(d(y, a.x, a.z)).toBeGreaterThan(range);
        }
        expect(d(dep('yumi_w'), ...ISLES[4]!)).toBeLessThan(range);
    }, 60_000);
});

// ---------------------------------------------------------------- 作戦

describe('湿地：主目標に届く作戦（早送り）', () => {
    it('足場伝い：4 隊が組で島を伝い、3 つ目の島の槍を崩して出口へ抜けて勝つ。遅いが損害は 1 割未満（作った時 375 秒・8.5％）', () => {
        const r = run1(WEST);
        expect(won(r), brief(r)).toBe(true);
        expect(r.refused).toEqual([]);
        expect(r.loss).toBeLessThan(0.1);
        expect(r.t).toBeGreaterThan(330);
        expect(secondaries(r)).toEqual([true, false, true]);
        expect(standing(r)).toBe(7);
        // 島の槍は 4 隊で崩し、押さえ・両脇の弓とは戦わない
        expect(statusOf(r, 'e_isle')).not.toBe('ready');
        for (const id of ['e_block', 'e_yumi_w', 'e_yumi_e']) expect(r.left[id]).toBe(MS.presets[0]!.units.find((u) => u.id === id)!.strength);
    }, 60_000);

    it('準備した土手道（準備した正面攻撃）：東の弓を先駆けの号で崩し、首の正面と東の泥から押さえを崩して抜けて勝つ。足場伝いより早いが損害が大きい（作った時 283 秒・16.2％）', () => {
        const r = run1(PREP);
        expect(won(r), brief(r)).toBe(true);
        expect(r.refused).toEqual([]);
        expect(Object.keys(r.o.abilitiesUsed ?? {}).sort()).toEqual(['a_ieyasu', 'a_sakai', 'a_sakakibara']);
        expect(secondaries(r)).toEqual([false, true, false]);
        expect(standing(r)).toBe(7);
        const w = run1(WEST);
        expect(r.t).toBeLessThan(w.t - 40);
        expect(r.loss).toBeGreaterThan(w.loss + 0.05);
        // 土手道を抜けた（出口へ着いたのは土手道を通った隊）
        expect(Object.keys(r.entered).sort()).toEqual(expect.arrayContaining(['a_sakakibara', 'a_tadakatsu']));
    }, 60_000);

    it('組み合わせ：準備した土手道に、石川隊・騎馬隊の足場伝いを重ねる → 押さえも足場の槍も崩して勝つ（作った時 287 秒・19.5％）', () => {
        const r = run1(COMBO);
        expect(won(r), brief(r)).toBe(true);
        expect(r.refused).toEqual([]);
        expect(secondaries(r)).toEqual([false, true, true]);
        expect(standing(r)).toBe(7);
    }, 60_000);

    // 揺らぎの 16 通り（作った時）：足場伝い 16 勝（平均 413 秒・損害 9.5％）、準備した土手道 15 勝（平均 310 秒・22.0％。負けた 1 通り（k=4）は
    // 遅れが重なって押さえが崩れたのが 210 秒。北の口で忠勝隊が騎馬と後詰め（300 秒）に崩され（出口へは入った後）、徳川騎馬隊は北の口の手前の
    // 泥 (-23,-146) で止まって出口の区域へ入らず、3 隊のまま日没）、組み合わせ 16 勝（平均 325 秒・26.8％）
    it('安定性（±15 秒・見てから押すまでの遅れ 0〜15 秒の 16 通り）：足場伝い 15 勝以上、準備した土手道・組み合わせ 13 勝以上', () => {
        const w = run16(WEST);
        const p = run16(PREP);
        const c = run16(COMBO);
        expect(winsOf(w)).toBeGreaterThanOrEqual(15);
        expect(winsOf(p)).toBeGreaterThanOrEqual(13);
        expect(winsOf(c)).toBeGreaterThanOrEqual(13);
        // 16 通りの平均でも、足場伝いは遅く損害が少なく、準備した土手道は早く損害が大きい
        const tw = meanOf(w.filter(won), (r) => r.t);
        const tp = meanOf(p.filter(won), (r) => r.t);
        expect(tp).toBeLessThan(tw - 50);
        expect(meanOf(p, (r) => r.loss)).toBeGreaterThan(meanOf(w, (r) => r.loss) + 0.08);
        // 副目標：足場伝いは損害 ✓・足場の槍 ✓・押さえ ✗、準備した土手道は押さえ ✓・損害 ✗・足場の槍 ✗、組み合わせは押さえ ✓・足場の槍 ✓
        expect(w.filter((r) => secondaryOf(r, 'marsh_losses')).length).toBe(16);
        expect(w.filter((r) => secondaryOf(r, 'marsh_block')).length).toBe(0);
        expect(p.filter((r) => secondaryOf(r, 'marsh_block')).length).toBe(16);
        expect(p.filter((r) => secondaryOf(r, 'marsh_losses')).length).toBeLessThanOrEqual(2);
        expect(p.filter((r) => secondaryOf(r, 'marsh_isle')).length).toBe(0);
        expect(c.filter((r) => secondaryOf(r, 'marsh_block') && secondaryOf(r, 'marsh_isle')).length).toBeGreaterThanOrEqual(13);
    }, 180_000);
});

// 合格条件は「正面なら負ける」ではなく、同じ台本・同じ数字での比べ（準備した土手道と比べて損害が大きい・崩れる部隊が多い・副目標を落とす）。
// 無計画な攻撃の勝敗は「記録」として残す
describe('湿地：無計画な攻撃と準備した攻撃の比べ（早送り）', () => {
    it('全部隊で出口へ一斉（土手道を押すだけ）→ 準備した土手道より早いが、損害が 2 倍を超え、7 隊のうち 4 隊が崩れる（記録：249 秒に勝ち・損害 43.9％）', () => {
        let maxFront = 0;
        const rule = MS.specialRules![0]!;
        if (rule.type !== 'narrow_frontage') throw new Error('narrow_frontage のはず');
        const r = play(RUSH(J0), (s) => {
            // 首の南の口の中から押さえと斬り合っている味方は、いつも 1 部隊まで
            const n = s.units.filter((u) => u.side === 'ally' && u.engagedWith === 'e_block' && inZone(rule.zone, u.x, u.z)).length;
            maxFront = Math.max(maxFront, n);
        });
        const p = run1(PREP);
        expect(r.refused).toEqual([]);
        expect(maxFront).toBe(1);
        // 確かめた時：一斉 249 秒・損害 43.9％・戦える隊 3 ／ 準備した土手道 283 秒・16.2％・7
        expect(r.loss).toBeGreaterThan(p.loss * 2);
        expect(standing(r)).toBeLessThanOrEqual(standing(p) - 3);
        expect(secondaryOf(r, 'marsh_losses')).toBe(false);
        // 記録
        expect(r.o.result).toBe('victory');
        expect(r.t).toBeLessThan(p.t);
        expect(r.loss).toBeGreaterThan(0.4);
        // 押さえは崩れる（首で詰まった隊と、脇の泥へ押し出された隊に囲まれ、士気で崩れる）
        expect(statusOf(r, 'e_block')).not.toBe('ready');
    }, 60_000);

    it('一番近い敵へ当て直すだけ → 準備した土手道・足場伝いと違い主目標に届かず、損害も大きい（記録：325 秒に負け・損害 37.1％・戦える隊 3）', () => {
        const r = play(NEAREST(J0));
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.loss).toBeGreaterThan(run1(PREP).loss + 0.1);
        expect(r.loss).toBeGreaterThan(run1(WEST).loss + 0.2);
        expect(standing(r)).toBeLessThan(standing(run1(PREP)));
        // 記録
        expect(r.o.result).toBe('defeat');
        expect(r.o.reason).toBe('objective_failed');
    }, 60_000);

    it('待つだけ → 主目標に届かず日没（記録：損害 0）', () => {
        const r = play([]);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.o.reason).toBe('nightfall');
        expect(r.loss).toBe(0);
    }, 60_000);
});

/** 榊原隊を見る：先駆けの号を使った時刻・効果中のいちばん速い 1 刻みの速さ・東の弓と斬り合い始めた時刻・弓が崩れた時刻・その時の榊原隊の兵 */
function vanguardProbe(steps: Step[]) {
    let used = -1;
    let prev: { x: number; z: number } | null = null;
    let speedMax = 0;
    let contact = -1;
    let broke = -1;
    let leftAtBreak = -1;
    const r = play(steps, (s) => {
        const k = unitById(s, 'a_sakakibara')!;
        const ab = s.abilities.a_sakakibara;
        if (used < 0 && ab?.usedAt != null) used = ab.usedAt;
        if (prev && used >= 0 && s.t > used + 1e-9 && s.t <= used + ABILITY_DATA.sakakibara_vanguard.durationSec + 1e-9) speedMax = Math.max(speedMax, Math.hypot(k.x - prev.x, k.z - prev.z) / RULES.tick);
        prev = { x: k.x, z: k.z };
        if (contact < 0 && k.engagedWith === 'e_yumi_e') contact = s.t;
        if (broke < 0 && unitById(s, 'e_yumi_e')!.status !== 'ready') {
            broke = s.t;
            leftAtBreak = k.strength;
        }
    });
    return { r, used, speedMax, contact, broke, leftAtBreak };
}

describe('湿地：武将の能力の価値が地形で変わる（早送り）', () => {
    // 榊原の先駆けの号（20 秒・動き ×1.8・最初の 8 秒の当たり ×2.0・弓へ ×1.5・受ける損害 ×1.2・切れて士気 −15）。榊原隊だけを動かす
    // （ほかの隊は命令なし）。どちらも先に土手道の (7,100) へ出てから：
    // 土手道：首の手前の広い所 (7,28) へ駆け、着いたら使って東の足場の弓へ（泥は 15 m だけ）
    // 泥：東の泥の中 (45,92) へ降り、着いたら使って東の足場の弓へ（泥を 70 m 渡る）
    it('榊原の先駆けの号：土手道では約 13 m/秒で駆けて効果中に弓へ当たり、すぐ崩す。泥の中では約 2.3 m/秒にしかならず、当たる前に効果が切れて弓を崩せない', () => {
        const CW: Step[] = [
            [0, 'a_sakakibara', tap(7, 100)],
            [near('a_sakakibara', 7, 100, 9), 'a_sakakibara', tap(7, 28)],
            [near('a_sakakibara', 7, 28, 9), 'a_sakakibara', 'ability'],
            [near('a_sakakibara', 7, 28, 9), 'a_sakakibara', atk('e_yumi_e')],
        ];
        const MUD: Step[] = [
            [0, 'a_sakakibara', tap(7, 100)],
            [near('a_sakakibara', 7, 100, 9), 'a_sakakibara', tap(45, 92)],
            [near('a_sakakibara', 45, 92, 9), 'a_sakakibara', 'ability'],
            [near('a_sakakibara', 45, 92, 9), 'a_sakakibara', atk('e_yumi_e')],
        ];
        const no = (x: Step[]) => x.filter((s) => s[2] !== 'ability');
        const cwUse = vanguardProbe(CW);
        const cwNo = vanguardProbe(no(CW));
        const mudUse = vanguardProbe(MUD);
        const mudNo = vanguardProbe(no(MUD));
        for (const p of [cwUse, mudUse]) {
            expect(p.r.refused).toEqual([]);
            expect(p.used).toBeGreaterThan(0);
        }
        const dur = ABILITY_DATA.sakakibara_vanguard.durationSec;
        // 速さ（作った時）：土手道 13.0 m/秒（7.2 × 1.8）、泥 2.3 m/秒（1.26 × 1.8）
        expect(cwUse.speedMax).toBeGreaterThan(12);
        expect(mudUse.speedMax).toBeLessThan(2.5);
        // 土手道（作った時）：使って 5.3 秒で当たり（効果中）、当たってから 8.9 秒で弓が崩れる（使わないと 43.7 秒に当たり 76.2 秒に崩れる）
        expect(cwUse.contact - cwUse.used).toBeLessThan(dur);
        expect(cwUse.broke - cwUse.contact).toBeLessThan(15);
        expect(cwUse.broke).toBeLessThan(cwNo.broke - 15);
        // 泥（作った時）：使って 30.8 秒で当たる（効果が切れた後）。その後も弓は崩れない（使わないと 162 秒に崩れる）
        expect(mudUse.contact - mudUse.used).toBeGreaterThan(dur);
        expect(mudUse.broke === -1 || mudUse.broke > cwUse.broke + 60).toBe(true);
        expect(mudNo.broke).toBeGreaterThan(cwUse.broke + 60);
        // 同じ能力でも、土手道で使えば弓を崩した時に榊原隊の兵が多く残る
        expect(cwUse.leftAtBreak).toBeGreaterThan(200);
    }, 60_000);
});
