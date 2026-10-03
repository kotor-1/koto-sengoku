/**
 * 戦場「夜襲・奇襲」（night_raid）の釣り合い（docs/fields-group4-design.md §4・§5、依頼本文 docs/fields-group4-request.md の「19. 夜襲・奇襲」）。
 * 主目標：夜のうちに北の敵陣（(0,-120)・半径 40 m の輪）を、敵のいない状態で味方が 45 秒続けて占める（hold_point。敵本陣の撃破ではない）。
 * 副目標：損害を 3 割以内に抑える・街道の物見を崩す。判定の順（endRules）：主目標の達成 → 主目標の失敗 → 本陣の崩れ → 諸隊 → 日没 → 全軍撤退。
 * 夜：敵も味方も発見した相手だけが見える（70 m・夜の林の中は 40 m・篝火の中は 160 m・物見は 110 m・見失うのは 120 m）。発見していない相手は
 * 攻撃の相手にならない（敵の考えも同じ）。奇襲（woods_ambush。夜は林の外でも）：未発見・見つかって 15 秒以内の最初の当たりは 8 秒 ×1.5（敵も同じ）。
 *
 * 合格条件は「正面なら負ける」ではなく、作戦どうしの比べ（損害・時間・副目標・守れる部隊）と、主目標に届く作戦の安定性。
 * 無計画な攻撃・待つだけの結果は記録として書く。
 *
 * どれも「早送り」：決まった時刻と「見てから押す」行で issueOrder・useAbility を出す台本を runToEnd で最後まで進める（画面の操作ではない）。
 * 「見てから押す」行は 1 秒ごとに条件を見る（人が画面を見て押す間隔）。台本は人が画面でできる程度の命令の数・間隔にしている
 * （いちばん多い台本で 57 回・10 秒に 7 回）。移動の後の向き（face）は使わない。画面では敵の近くの地面を押すとその敵への攻撃になるので、
 * 地面の行き先（tap）も、押す点の 20 m 以内に見えている敵がいればその敵への攻撃にする。能力で動けない部隊（後詰めの差配の間の石川隊）には
 * 攻撃・移動を押さない（画面でも理由が出て受けない）。
 *
 * 揺らぎ（16 通り）：時刻の行は ±15 秒（乱数の種 7 から。第2群・第3群のテストと同じ作り方）、「見てから押す」行には人が見てから押すまでの
 * 遅れ 0〜15 秒を足す（同じ乱数から）。
 *
 * 作った時の結果（早送り。16 通りは上の揺らぎ。守れる部隊＝最後に戦える味方の部隊の数／7。副目標は 損害 3 割・物見）：
 * | 作戦 | 1 通り | 16 通り |
 * | 隠れて近づく（STEALTH。林の 4 隊。弓・騎馬・本陣は南の陣に残す） | 勝ち 289 秒・18.0％・✓✗・6／7 | 16 勝・337 秒（296〜394）・20.3％（8.7〜31.4）・守れる 5.7・副目標 15／0 |
 * | 陽動して隠れて近づく（FEINT。林の 4 隊＋弓と騎馬で辻の番兵を押す） | 296 秒・13.9％・✓✗・7／7 | 16 勝・322 秒（303〜353）・13.6％（7.4〜23.9）・6.4・16／0 |
 * | 準備した正面攻撃（FRONT。弓で番兵を誘い出し、槍 3 隊で同じ敵へ、騎馬 2 隊は予備） | 322 秒・29.6％・✓✓・5／7 | 16 勝・308 秒（292〜330）・22.8％（18.9〜36.2）・5.8・15／16 |
 * | 無計画（UNPLANNED。全 6 隊が 10 秒ごとに見えている一番近い敵へ、待機なら陣へ） | 243 秒・29.0％・✓✓・5／7 | 押す時刻のずれ 0〜9 秒で 16 勝・247 秒（243〜252）・29.0％・5・16／16 |
 * | 待つ（HOLD） | 日没・損害 0 | |
 * 作戦の違い：隠れて近づく組は、林の端（陣の真ん中から 66〜76 m）まで見つからず（敵に気づかれるのは 212〜287 秒）、陣の守り・陣の弓・後詰めの
 * 3 隊とだけ戦う。物見を崩さない（0／16）が、弓・騎馬を南の陣に残せる。陽動を足すと、番兵が押されて陣の後詰めが街道へ動き出したところを
 * 林の組が奇襲するので、損害がいちばん小さく（3 割以内 16／16）、7 隊とも残ることが多い（守れる 6.4）。準備した正面攻撃は、辻・物見・見回り・後詰めと
 * 順に戦うので損害は大きめだが、物見をいつも崩し（16／16）、勝つのは隠れて近づくより 25 秒ほど早い。
 *
 * 準備した正面攻撃と無計画の比べ（記録）：無計画は全 6 隊が一度に一番近い敵へ当たるので、ばらばらに出てくる敵を数で押し、いちばん早く勝つ
 * （16 通りで 247 秒）。損害は準備した正面攻撃より大きく（29.0％ 対 平均 22.8％）、守れる部隊は少ない（5 対 5.8）。騎馬を斬り合いの真ん中へ
 * 入れるので、騎馬 2 隊のどちらかを必ず失う。損害 3 割の副目標は、無計画の方が 16 通りで安定して守る（16 対 15。準備した正面攻撃は悪い時に
 * 36.2％まで失う）。準備した正面攻撃は騎馬を予備に置き、芯の槍と斬り合う敵の横へだけ出す。
 *
 * 武将の能力の価値が場面で変わる比べ（同じ 16 通り）：
 * - 榊原の先駆けの号（騎馬で陣の弓へ）：林の端から（見つかる前の急襲。陣の弓まで 100 m ほど）は、命じてから陣の弓を崩すまで平均 23.4 秒
 *   （使わなければ 36.9 秒）。その間の榊原隊の損害は 19 対 16 でほとんど変わらない。見つかった後に街道から陣の南へ着いて命じると、陣の守りの横を
 *   回る道が長く 20 秒の効果が着く前に切れるので 72.9 秒 対 80.1 秒（7 秒ほど）しか早まらず、受ける損害 ×1.2 のぶん榊原隊の損害が 45 対 27 に増える。
 *   能力を使わない林の台本も 16 通りで 15 勝、正面も 16 勝（能力は勝ちの必須ではない）。
 *   すれ違いの詰まりの直し（第4群のエンジンの要望。反対向きに動く味方どうしも allyBlockSec ですり抜ける）の後：陣の南からは 77.0 秒 対 80.2 秒・
 *   榊原隊の損害 34.9 対 34.0（正面の 16 通りのうち 2 通りで、予備へ下がる榊原隊と北へ上る石川隊のもつれが解けて、榊原隊が崩れかけるほど
 *   削られなくなった。前の 45 対 27 の差はこの 2〜3 通りの大きな損害から来ていた）。林の端からは同じ（23.4 秒 対 36.9 秒・19 対 16）。
 *   正面の 1 通りは 329 秒・29.9％ → 322 秒・29.6％、16 通りは 311 秒・24.2％・14／16 → 308 秒・22.8％・15／16。ほかの台本は 1 刻みも同じ。
 *
 * 台本を書くときに気を付けたこと（エンジンの振る舞い）：
 * - 番兵が押される（斬り合って士気 50 未満）と、陣の後詰め（reserve）が番兵の相手へ向かって街道を 300 m 下ってくる（警報の代わり）。
 * - 敵の陣の守り（hold_zone）は、陣の輪（半径 45 m）の 10 m 外までに入った見えている相手に当たる。林の端の味方は見つかっていないので当たらない。
 * - 武将の自由な動き（generalInitiative）：待機中の榊原隊は近くの退く敵を追うので、番兵を崩した後に街道を北へ追って行くことがある。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, isActive, issueOrder, meleeUnreachable, runToEnd, stepBattle, unitById, type BattleState } from '../proto3d/src/battle/sim';
import { isRooted, useAbility } from '../proto3d/src/battle/abilities';
import { hideSightIn, inZone } from '../proto3d/src/battle/fieldRules';
import { reachable } from '../proto3d/src/battle/pathfind';
import { buildBattleSetup, getField, validateField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';

const NR = getField('night_raid')!;

// ---------------------------------------------------------------- 台本の道具

/** 地面を押す（押す点の 20 m 以内に見えている敵がいれば、その敵への攻撃。画面と同じ） */
interface Tap {
    tap: [number, number];
}
/** 待機していれば地面を押す（斬り合っている・動いている部隊には押さない） */
interface IdleTap {
    idleTap: [number, number];
}
/** 対象を選ぶ能力（後詰めの差配） */
interface Abil {
    abilityOn: string;
}
/** 後詰めの差配を、組のうち斬り合っている部隊で士気のいちばん低い部隊へ */
interface LowestOf {
    lowestOf: string[];
}
/** 組で同じ敵へ：組（ids の弓以外）の真ん中から r m 以内に見えている、真ん中に一番近い敵 */
interface Focus {
    focus: number;
    ids: string[];
}
/** 騎馬の予備：組と斬り合っている敵の横へ。いなければ組の後ろ 45 m へ */
interface ReserveFor {
    reserveFor: string[];
}
/** 組の後ろ back m へ */
interface Follow {
    follow: string[];
    back: number;
}
/** 'nearest'＝見えている一番近い敵へ攻撃（今の相手が戦えて見えているなら押さない） */
type Cmd = Order | Tap | IdleTap | Abil | LowestOf | Focus | ReserveFor | Follow | 'ability' | 'nearest';
type Cond = (s: BattleState) => boolean;
/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]、または [条件, 部隊 id, 命令]（見てから押す。条件が初めて真になった時に 1 回。1 秒ごとに見る） */
type Step = [number | Cond, string, Cmd];
/** 揺らぎ：t は時刻の行の秒、d は見てから押すまでの遅れ（秒） */
interface J {
    t: (x: number) => number;
    d: () => number;
}
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

const dist = (a: { x: number; z: number }, x: number, z: number) => Math.hypot(a.x - x, a.z - z);
const seenEnemies = (s: BattleState) => s.units.filter((x) => x.side === 'enemy' && isActive(x) && x.seenBy.ally);
/** 今の相手が戦えて見えている（攻撃を押し直さない） */
function busy(s: BattleState, id: string): boolean {
    const u = unitById(s, id)!;
    if (u.order.type !== 'attack') return false;
    const cur = unitById(s, u.order.targetId);
    return !!cur && isActive(cur) && cur.seenBy.ally;
}
function nearestEnemy(s: BattleState, id: string): Order | null {
    const u = unitById(s, id)!;
    if (!isActive(u) || busy(s, id)) return null;
    const e = seenEnemies(s)
        .filter((x) => !meleeUnreachable(s, u, x))
        .sort((a, b) => dist(a, u.x, u.z) - dist(b, u.x, u.z))[0];
    return e ? atk(e.id) : null;
}
function centerOf(s: BattleState, ids: string[]): { x: number; z: number } | null {
    const g = ids.map((x) => unitById(s, x)!).filter((x) => isActive(x) && x.kind !== 'yumi');
    if (!g.length) return null;
    return { x: g.reduce((a, x) => a + x.x, 0) / g.length, z: g.reduce((a, x) => a + x.z, 0) / g.length };
}
function focusOrder(s: BattleState, id: string, f: Focus): Order | null {
    const u = unitById(s, id)!;
    if (!isActive(u) || u.engagedWith || busy(s, id)) return null;
    const c = centerOf(s, f.ids);
    if (!c) return null;
    const e = seenEnemies(s)
        .filter((x) => !meleeUnreachable(s, u, x) && dist(x, c.x, c.z) <= f.focus)
        .sort((a, b) => dist(a, c.x, c.z) - dist(b, c.x, c.z))[0];
    return e ? atk(e.id) : null;
}
function tapOrder(s: BattleState, [x, z]: [number, number]): Order {
    const e = seenEnemies(s)
        .filter((u) => dist(u, x, z) <= 20)
        .sort((a, b) => dist(a, x, z) - dist(b, x, z))[0];
    return e ? atk(e.id) : { type: 'move', x, z };
}
/** 命令を決める（null なら押さない） */
function resolve(s: BattleState, id: string, c: Cmd): Order | 'ability' | { abilityOn: string } | null {
    const u = unitById(s, id)!;
    // 崩れた・退いた部隊には押さない（画面でも命令を受けない）
    if (!isActive(u)) return null;
    if (c === 'ability') return c;
    if (c === 'nearest') return nearestEnemy(s, id);
    if ('abilityOn' in c) return c;
    if ('lowestOf' in c) {
        const t = c.lowestOf
            .filter((x) => x !== id)
            .map((x) => unitById(s, x)!)
            .filter((x) => isActive(x) && x.engagedWith)
            .sort((a, b) => a.morale - b.morale)[0];
        return t ? { abilityOn: t.id } : null;
    }
    // ここから下は動かす命令：能力で動けない部隊には押さない
    if (isRooted(s, id)) return null;
    if ('focus' in c) return focusOrder(s, id, c);
    if ('idleTap' in c) return isActive(u) && !u.engagedWith && u.order.type === 'hold' ? tapOrder(s, c.idleTap) : null;
    if ('reserveFor' in c) {
        if (!isActive(u) || u.engagedWith || busy(s, id)) return null;
        const foe = c.reserveFor
            .map((x) => unitById(s, x)!)
            .filter((x) => isActive(x) && x.engagedWith)
            .map((x) => unitById(s, x.engagedWith!)!)
            .find((e) => isActive(e) && e.seenBy.ally);
        if (foe) return atk(foe.id);
        const g = centerOf(s, c.reserveFor);
        if (!g || u.order.type !== 'hold' || dist(u, g.x, g.z + 45) < 30) return null;
        return tapOrder(s, [g.x + (id === 'a_kiba' ? 30 : -30), g.z + 45]);
    }
    if ('follow' in c) {
        const g = centerOf(s, c.follow);
        return g ? tapOrder(s, [g.x, g.z + c.back]) : null;
    }
    if ('tap' in c) return tapOrder(s, c.tap);
    return c;
}

/** 敵の部隊が崩れた（敗走・全滅・撤退） */
const gone =
    (id: string): Cond =>
    (s) => {
        const u = unitById(s, id);
        return !!u && u.arrived && u.status !== 'ready';
    };
const near =
    (id: string, x: number, z: number, r: number): Cond =>
    (s) => {
        const u = unitById(s, id);
        return !!u && isActive(u) && dist(u, x, z) <= r;
    };
const engaged =
    (id: string, enemy?: string): Cond =>
    (s) => {
        const e = unitById(s, id)?.engagedWith;
        return enemy ? e === enemy : !!e;
    };
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
const any =
    (...cs: Cond[]): Cond =>
    (s) =>
        cs.some((c) => c(s));
const at =
    (t: number): Cond =>
    (s) =>
        s.t >= t - 1e-9;
/** 一度真になった条件を覚える（同じ条件を何行かで使うとき、前の行の命令で条件が崩れても、見た行は押す） */
function latch(c: Cond): Cond {
    const m = new WeakSet<BattleState>();
    return (s) => {
        if (m.has(s)) return true;
        if (c(s)) m.add(s);
        return m.has(s);
    };
}
/** 条件が初めて真になってから d 秒後に真（人が見てから押すまでの遅れ） */
function late(c: Cond, d: number): Cond {
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
/** 見てから押す（遅れ j.d()） */
const w = (c: Cond, j: J) => late(c, j.d());
/** from の後（until まで）、sec 秒ごとに真になる条件の並び（人が sec 秒ごとに画面を見る） */
function every(sec: number, from: Cond, until?: Cond, f: Cond = () => true): Cond[] {
    const st = latch(from);
    return Array.from({ length: Math.ceil(600 / sec) }, (_, k) => {
        const m = new WeakMap<BattleState, number>();
        return (s: BattleState) => {
            if (!st(s) || (until && until(s))) return false;
            if (!m.has(s)) m.set(s, s.t);
            return s.t >= m.get(s)! + k * sec && f(s);
        };
    });
}

/** 道筋：部隊 id に地点 pts を順に押す。最初の点は start（秒または条件）、次の点からは前の点に着いて待機になったのを見てから */
function route(id: string, pts: [number, number][], start: number | Cond, j: J): Step[] {
    const prog = new WeakMap<BattleState, number>();
    return pts.map((p, i): Step => {
        const base: Cond =
            i === 0 ? (typeof start === 'number' ? at(j.t(start)) : late(start, j.d())) : late((s) => (prog.get(s) ?? 0) === i && idle(id)(s), j.d());
        return [
            (s) => {
                if ((prog.get(s) ?? 0) !== i) return false;
                const g = base(s);
                if (g) prog.set(s, i + 1);
                return g;
            },
            id,
            tap(p[0], p[1]),
        ];
    });
}

interface Run {
    o: BattleOutcome;
    /** 終わった時刻（秒） */
    t: number;
    /** 味方の兵の損害の割合（0〜1） */
    loss: number;
    left: Record<string, number>;
    /** 断られた命令 */
    refused: string[];
    /** 出した命令の時刻（人が画面で出せる数・間隔か見る） */
    cmds: number[];
    /** 味方の部隊が初めて敵に見つかった時刻と、そのときの陣の真ん中からの距離（m） */
    found: Record<string, { t: number; d: number }>;
    /** 敵が、見つけていない味方を攻撃の相手にしていた刻みの数（夜の決まりでは 0） */
    blindAttacks: number;
    /** 戦場の状態（終わった後） */
    s: BattleState;
}

/** 台本を最後まで進める（each は刻みごと） */
function play(steps: Step[], each?: (s: BattleState) => void): Run {
    const s = createBattle(buildBattleSetup(NR, 'standard'));
    const timed = steps.filter((x) => typeof x[0] === 'number').sort((a, b) => (a[0] as number) - (b[0] as number));
    const watch = steps.filter((x) => typeof x[0] === 'function');
    const fired = new Set<number>();
    const refused: string[] = [];
    const cmds: number[] = [];
    const found: Run['found'] = {};
    let blindAttacks = 0;
    const run = (st: BattleState, label: string, id: string, c: Cmd) => {
        const ord = resolve(st, id, c);
        if (!ord) return;
        cmds.push(st.t);
        const ok = ord === 'ability' ? useAbility(st, id).ok : 'abilityOn' in ord ? useAbility(st, id, ord.abilityOn).ok : issueOrder(st, id, ord);
        if (!ok) refused.push(`${label}:${id}:${JSON.stringify(ord)}`);
    };
    const o = runToEnd(s, (st) => {
        while (timed.length && st.t >= (timed[0]![0] as number) - 1e-9) {
            const [t, id, c] = timed.shift()!;
            run(st, String(t), id, c);
        }
        // 見てから押す行は 1 秒ごとに条件を見る
        if (st.tick % 10 === 0)
            watch.forEach(([cond, id, c], i) => {
                if (fired.has(i) || !(cond as Cond)(st)) return;
                fired.add(i);
                run(st, `when${i}@${st.t.toFixed(0)}`, id, c);
            });
        for (const u of st.units) {
            if (u.side === 'ally' && u.present && u.seenBy.enemy && !found[u.id]) found[u.id] = { t: Math.round(st.t * 10) / 10, d: Math.round(dist(u, 0, -120)) };
            if (u.side === 'enemy' && isActive(u) && u.order.type === 'attack' && !unitById(st, u.order.targetId)!.seenBy.enemy) blindAttacks++;
        }
        each?.(st);
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    return { o, t: s.t, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused, cmds, found, blindAttacks, s };
}

const won = (r: Run) => r.o.result === 'victory' && r.o.objectives?.primary?.achieved === true;
const sec = (r: Run, id: string) => r.o.objectives!.secondary.find((x) => x.id === id)!.achieved;
/** 最後に戦える味方の部隊の数（守れる部隊） */
const standing = (r: Run) => r.o.units.filter((u) => u.side === 'ally' && u.status === 'ready').length;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const count = (rs: Run[], f: (r: Run) => boolean) => rs.filter(f).length;
function brief(r: Run): string {
    const s2 = r.o.objectives?.secondary.map((x) => `${x.id}:${x.achieved ? '✓' : '✗'}`).join(' ');
    return `${r.o.result}/${r.o.reason} t=${r.t.toFixed(1)} loss=${(r.loss * 100).toFixed(1)}% ${s2} 残る部隊=${standing(r)} refused=${r.refused.join(',')}`;
}
/** 16 通り（揺らぎ k = 0〜15）。同じ台本は 1 回だけ計算する */
const memo = new Map<Plan, Run[]>();
function sixteen(plan: Plan): Run[] {
    if (!memo.has(plan)) memo.set(plan, Array.from({ length: 16 }, (_, k) => play(plan(jitterOf(k)))));
    return memo.get(plan)!;
}

// ---------------------------------------------------------------- 作戦の台本

/** 陣の輪（中心 (0,-120)・半径 40 m）の中の持ち場 */
const POSTS: Record<string, [number, number]> = {
    a_sakai: [-15, -115],
    a_tadakatsu: [10, -125],
    a_ishikawa: [-5, -140],
    a_sakakibara: [5, -105],
    a_kiba: [20, -105],
    a_yumi: [-20, -135],
};
/** 陣の輪に入ってくる敵（陣の守り・陣の弓・後詰め）。みな崩れたら輪の持ち場へ */
const CAMP_ENEMIES = ['e_camp', 'e_camp_yumi', 'e_reserve'];
const campClear = () => latch(all(...CAMP_ENEMIES.map(gone)));
/** from の後 until まで、5 秒ごとに組で同じ敵へ（真ん中から r m 以内） */
function focusAll(ids: string[], from: Cond, until: Cond, r: number): Step[] {
    const o: Step[] = [];
    for (const id of ids) for (const c of every(5, from, until)) o.push([c, id, { focus: r, ids }]);
    return o;
}
/** 陣の敵がみな崩れたら、ほかの行は押さず、輪の持ち場へ */
function finish(steps: Step[], ids: string[], j: J): Step[] {
    const done = campClear();
    const out = steps.map(([c, id, cmd]): Step => [typeof c === 'number' ? c : (s) => !done(s) && c(s), id, cmd]);
    for (const id of ids) out.push([w(done, j), id, tap(...POSTS[id]!)]);
    return out;
}

// 隠れて近づく：林の 4 隊（酒井・石川・忠勝・榊原（騎馬））。林の中を北へ、林の北東の端（陣の真ん中から 80 m ほど）でそろってから一気に
const SQUAD = ['a_sakai', 'a_tadakatsu', 'a_ishikawa', 'a_sakakibara'];
function woods(j: J): Step[] {
    return [
        ...route('a_sakai', [[-140, 120], [-140, -60], [-95, -112]], 0, j),
        ...route('a_ishikawa', [[-160, 120], [-160, -60], [-120, -125]], 0, j),
        ...route('a_tadakatsu', [[-120, 130], [-120, -60], [-95, -132]], 0, j),
        ...route('a_sakakibara', [[-100, 150], [-110, -60], [-115, -100]], 0, j),
    ];
}
/** 林の端にそろった（酒井・忠勝・榊原が待機して、酒井が端の 15 m 以内） */
const gathered = () => latch(all(idle('a_sakai'), idle('a_tadakatsu'), idle('a_sakakibara'), near('a_sakai', -95, -112, 15), near('a_tadakatsu', -95, -132, 40)));
/**
 * 林の端から陣へ：榊原隊は陣の弓へ（vanguard なら先駆けの号を使って）、崩したら西の口の外へ引く。酒井隊・忠勝隊は陣の守りへ、
 * 石川隊は西の口の外で後詰めの差配（忠勝隊が斬り合ったら）。25 秒の後は 4 隊で同じ敵へ
 */
function strike(go: Cond, j: J, vanguard = true): Step[] {
    const o: Step[] = [];
    if (vanguard) o.push([w(go, j), 'a_sakakibara', 'ability']);
    o.push(
        [w(go, j), 'a_sakakibara', atk('e_camp_yumi')],
        [w(go, j), 'a_sakai', atk('e_camp')],
        [w(go, j), 'a_tadakatsu', atk('e_camp')],
        [w(go, j), 'a_ishikawa', tap(-70, -120)],
        [w(engaged('a_tadakatsu'), j), 'a_ishikawa', { abilityOn: 'a_tadakatsu' }],
        [w(all(go, gone('e_camp_yumi')), j), 'a_sakakibara', tap(-65, -125)],
        ...focusAll(SQUAD, late(go, 25), campClear(), 200),
    );
    return o;
}
const STEALTH: Plan = (j) => finish([...woods(j), ...strike(gathered(), j)], SQUAD, j);
/** 隠れて近づく（榊原は先駆けの号を使わない） */
const STEALTH_NOVAN: Plan = (j) => finish([...woods(j), ...strike(gathered(), j, false)], SQUAD, j);
/**
 * 陽動して隠れて近づく：林の組が林の半ば（酒井隊が (-140,-60)）に着いたのを見て、弓で辻の番兵を射る。騎馬は街道の東で待ち、
 * 番兵が打って出たら（弓と斬り合う・南へ 50 m 出た）横から当たる。番兵が押されると陣の後詰めが街道へ動き出す
 */
const FEINT: Plan = (j) => {
    const halfway = latch(near('a_sakai', -140, -60, 30));
    const pk = latch(any(engaged('a_yumi', 'e_picket'), near('e_picket', 0, 120, 50)));
    return finish(
        [...woods(j), [w(halfway, j), 'a_yumi', atk('e_picket')], [w(halfway, j), 'a_kiba', tap(40, 140)], [w(pk, j), 'a_kiba', atk('e_picket')], ...strike(gathered(), j)],
        SQUAD,
        j,
    );
};

// 準備した正面攻撃：槍 3 隊（忠勝・酒井・石川）を芯に組で同じ敵へ。騎馬 2 隊（榊原・徳川騎馬）は後ろに予備として置き、芯と斬り合っている
// 敵の横へだけ出す。弓は芯の狙う敵を射て、何もなければ芯の後ろ 35 m へ。最初に弓で辻の番兵を射て誘い出す（番兵が打って出たら全部が動く）
const CORE = ['a_tadakatsu', 'a_sakai', 'a_ishikawa'];
const CAV = ['a_kiba', 'a_sakakibara'];
const ALL6 = [...CORE, ...CAV, 'a_yumi'];
const coreTarget = (s: BattleState) => {
    const c = centerOf(s, CORE);
    return !!c && seenEnemies(s).some((e) => dist(e, c.x, c.z) <= 140);
};
function front(j: J, cav: string[] = CAV): Step[] {
    const o: Step[] = [[0, 'a_yumi', atk('e_picket')]];
    const go = latch(any(engaged('a_yumi', 'e_picket'), near('e_picket', 0, 120, 50)));
    for (const id of CORE) {
        for (const c of every(5, go)) o.push([c, id, { focus: 140, ids: CORE }]);
        // 見えている敵がいなければ、芯は陣へ（街道を北へ。陣形のまま）
        const dx = id === 'a_sakai' ? -28 : id === 'a_ishikawa' ? 28 : 0;
        for (const c of every(5, go, undefined, (s) => !coreTarget(s))) o.push([c, id, { idleTap: [dx, -120] }]);
    }
    for (const id of cav) for (const c of every(5, go)) o.push([c, id, { reserveFor: CORE }]);
    for (const c of every(5, go)) o.push([c, 'a_yumi', { focus: 140, ids: CORE }]);
    for (const c of every(10, go, undefined, (s) => {
        const u = unitById(s, 'a_yumi')!;
        const g = centerOf(s, CORE);
        return isActive(u) && u.order.type === 'hold' && !coreTarget(s) && !!g && dist(u, g.x, g.z + 35) > 30;
    }))
        o.push([c, 'a_yumi', { follow: CORE, back: 35 }]);
    // 酒井の両翼の采配：芯の 2 隊が同じ敵と斬り合ったら。石川の後詰めの差配：芯で斬り合っている部隊の士気が 60 を切ったら、いちばん低い部隊へ
    o.push([
        w((s) => {
            const a = unitById(s, 'a_sakai')!;
            return !!a.engagedWith && CORE.some((x) => x !== 'a_sakai' && unitById(s, x)!.engagedWith === a.engagedWith);
        }, j),
        'a_sakai',
        'ability',
    ]);
    o.push([w((s) => CORE.some((x) => x !== 'a_ishikawa' && !!unitById(s, x)!.engagedWith && unitById(s, x)!.morale < 60), j), 'a_ishikawa', { lowestOf: CORE }]);
    return o;
}
const FRONT: Plan = (j) => finish(front(j), ALL6, j);
/** 準備した正面攻撃で、芯が陣の前（陣の真ん中から 90 m）に着いて陣の弓が見えたら、榊原隊を陣の弓へ（vanguard なら先駆けの号を使って） */
function frontVan(vanguard: boolean): Plan {
    return (j) => {
        const atCamp = latch((s: BattleState) => {
            const c = centerOf(s, CORE);
            return !!c && dist(c, 0, -120) <= 90 && !!unitById(s, 'e_camp_yumi')!.seenBy.ally;
        });
        const o = front(j, ['a_kiba']);
        const go = latch(any(engaged('a_yumi', 'e_picket'), near('e_picket', 0, 120, 50)));
        for (const c of every(5, go, atCamp)) o.push([c, 'a_sakakibara', { reserveFor: CORE }]);
        if (vanguard) o.push([w(atCamp, j), 'a_sakakibara', 'ability']);
        o.push([w(atCamp, j), 'a_sakakibara', atk('e_camp_yumi')]);
        o.push([w(all(atCamp, gone('e_camp_yumi')), j), 'a_sakakibara', { reserveFor: CORE }]);
        return finish(o, ALL6, j);
    };
}
const FRONT_VAN = frontVan(true);
const FRONT_NOVAN = frontVan(false);

/** 無計画：全 6 隊が 10 秒ごとに、見えている一番近い敵へ当て直す。待機していれば陣へ（揺らぎは押す時刻のずれ 0〜9 秒） */
const UNPLANNED: Plan = (j) => {
    const off = (((j.t(100) - 100) % 10) + 10) % 10;
    const o: Step[] = [];
    for (const id of ALL6)
        for (let t = 1 + off; t < 600; t += 10) {
            o.push([t, id, 'nearest']);
            o.push([t + 1, id, { idleTap: [0, -120] }]);
        }
    return o;
};
/** 待つ：命令を出さない */
const HOLD: Plan = () => [];

/** 榊原隊に陣の弓を命じてから、陣の弓が崩れるまでの秒（16 通り）と、その間の榊原隊の損害 */
function vanguardTimes(plan: Plan) {
    return Array.from({ length: 16 }, (_, k) => {
        let t0 = -1;
        let t1 = -1;
        let s0 = 0;
        let s1 = 0;
        let routed = false;
        const r = play(plan(jitterOf(k)), (s) => {
            const sk = unitById(s, 'a_sakakibara')!;
            const y = unitById(s, 'e_camp_yumi')!;
            if (t0 < 0 && y.status === 'ready' && sk.order.type === 'attack' && sk.order.targetId === 'e_camp_yumi') {
                t0 = s.t;
                s0 = sk.strength;
            }
            if (t0 >= 0 && t1 < 0 && (y.status !== 'ready' || sk.status !== 'ready')) {
                t1 = s.t;
                s1 = sk.strength;
                routed = sk.status !== 'ready';
            }
        });
        return { won: won(r), broke: t0 >= 0 && t1 >= 0 && !routed, dt: t1 - t0, lost: s0 - s1 };
    });
}

// ---------------------------------------------------------------- データ

describe('夜襲・奇襲のデータ', () => {
    it('検査を通る。主目標は敵陣の確保（hold_point。敵本陣の撃破ではない）。副目標 2 つ。部隊は上限以内（味方 7・敵 8・援軍なし）', () => {
        expect(validateField(NR)).toEqual([]);
        expect(NR.objectives.primary).toMatchObject({ type: 'hold_point', sec: 45, zone: { circle: { cx: 0, cz: -120, r: 40 } } });
        expect(NR.objectives.secondary.map((o) => o.type)).toEqual(['limit_losses', 'break_unit']);
        const u = NR.presets[0]!.units;
        expect([u.filter((x) => x.side === 'ally').length, u.filter((x) => x.side === 'enemy').length]).toEqual([7, 8]);
        expect(u.some((x) => x.reinforcement || x.arriveAt)).toBe(false);
        expect(NR.night).toMatchObject({ sight: 120, detectRange: 70, torchRange: 160, lookouts: [{ unitId: 'e_watch', range: 110 }] });
    });

    it('経路：街道（近い）と、西の林を北へ抜けて畦の道から陣の西の口（長い）の両方で陣へ届く。陣の口は西（幅 44 m）と南（幅 20 m）', () => {
        const s = createBattle(buildBattleSetup(NR, 'standard'));
        const nav = s.field.nav!;
        expect(reachable(nav, 'yari', 0, 160, 0, -120)).toBe(true);
        expect(reachable(nav, 'yari', -140, 120, -95, -112)).toBe(true);
        expect(reachable(nav, 'yari', -95, -112, -20, -120)).toBe(true);
        expect(reachable(nav, 'kiba', -115, -100, -15, -150)).toBe(true);
    });

    it('見つかりにくさの作り：物見（110 m）は街道を見張るが、林の北東の端と陣の西の口には届かない。夜の林の中は 40 m まで見つからない', () => {
        const s = createBattle(buildBattleSetup(NR, 'standard'));
        const watch = unitById(s, 'e_watch')!;
        // 物見から街道（z 60〜-100）は 110 m 以内、林の端（-95,-112）・西の口（-40,-120）は 110 m より遠い
        for (const z of [60, 0, -60, -100]) expect(dist(watch, 0, z)).toBeLessThanOrEqual(110);
        expect(dist(watch, -95, -112)).toBeGreaterThan(110);
        expect(dist(watch, -40, -120)).toBeGreaterThan(110);
        expect(hideSightIn(s.map, s.field, -95, -112)).toBe(40);
        expect(hideSightIn(s.map, s.field, -60, -120)).toBeNull();
        // 林の端は篝火の外で、陣の弓・陣の守り（篝火の中）から 70 m より遠い
        expect(NR.night!.torchZones!.some((z) => inZone(z, -95, -112))).toBe(false);
        for (const id of ['e_camp', 'e_camp_yumi']) expect(dist(unitById(s, id)!, -95, -112)).toBeGreaterThan(70);
    });

    it('状態を直接操作：夜の林の中の味方は、敵が 45 m では見つけず 35 m で見つける。林の外へ出ると 70 m で見つかる。見つけていない相手には敵の番兵も打って出ない', () => {
        const s = createBattle(buildBattleSetup(NR, 'standard'));
        for (const u of s.units) if (u.id !== 'a_sakai' && u.id !== 'e_camp') u.present = false;
        const a = unitById(s, 'a_sakai')!;
        const e = unitById(s, 'e_camp')!;
        // 陣の守りを林の中のそばへ（直接操作）。陣の守りは hold_zone なので、見えた相手には当たりに来る
        e.x = -60;
        e.z = 0;
        e.path = null;
        a.x = -105;
        a.z = 0;
        a.path = null;
        stepBattle(s, 0.2);
        expect(a.seenBy.enemy).toBe(false);
        a.x = -95;
        stepBattle(s, 0.2);
        expect(a.seenBy.enemy).toBe(true);
        const t = createBattle(buildBattleSetup(NR, 'standard'));
        for (const u of t.units) if (u.id !== 'a_sakai' && u.id !== 'e_picket') u.present = false;
        const b = unitById(t, 'a_sakai')!;
        // 番兵（(0,25)。篝火の中）から林の外で 72 m：見つけない（打って出る距離 75 m の中でも当たらない）。65 m で見つけて当たる
        b.x = -72;
        b.z = 25;
        b.path = null;
        for (let i = 0; i < 50; i++) stepBattle(t, 0.1);
        expect(b.seenBy.enemy).toBe(false);
        expect(unitById(t, 'e_picket')!.order.type).not.toBe('attack');
        b.x = -65;
        b.path = null;
        for (let i = 0; i < 20; i++) stepBattle(t, 0.1);
        expect(b.seenBy.enemy).toBe(true);
        expect(unitById(t, 'e_picket')!.order).toMatchObject({ type: 'attack', targetId: 'a_sakai' });
    });
});

// ---------------------------------------------------------------- 作戦（1 通り）

describe('作戦（早送り・1 通り）', () => {
    it('隠れて近づく：林の 4 隊が見つからずに林の端へ着き（敵に気づかれるのは陣の真ん中から 80 m より内・180 秒の後）、陣を取って勝つ（記録：289 秒・18.0％・物見 ✗・敵に気づかれるのは 197〜252 秒・74〜75 m）', () => {
        const r = play(STEALTH(J0));
        expect(won(r), brief(r)).toBe(true);
        for (const id of SQUAD) {
            expect(r.found[id]!.t).toBeGreaterThan(180);
            expect(r.found[id]!.d).toBeLessThanOrEqual(80);
        }
        // 弓・騎馬・本陣は南の陣に残り、見つからない
        for (const id of ['a_yumi', 'a_kiba', 'a_ieyasu']) expect(r.found[id]).toBeUndefined();
        expect(sec(r, 'raid_watch')).toBe(false);
        expect(r.blindAttacks).toBe(0);
        expect([Math.round(r.t), Math.round(r.loss * 1000) / 10]).toEqual([289, 18]);
    }, 20_000);

    it('発見の後は普通に戦える：林の組が見つかると陣の守りが当たりに来て、斬り合い、陣の守り・陣の弓・後詰めを崩してから陣を取る', () => {
        const r = play(STEALTH(J0));
        const ev = r.s.events;
        const firstFound = Math.min(...SQUAD.map((id) => r.found[id]!.t));
        expect(ev.some((e) => e.kind === 'ai' && e.text.includes('敵勢の陣の守りが守りの区域に入った') && e.t >= firstFound)).toBe(true);
        expect(ev.some((e) => e.kind === 'ambush' && e.t >= firstFound)).toBe(true);
        for (const id of CAMP_ENEMIES) expect(r.o.units.find((u) => u.id === id)!.status).not.toBe('ready');
        expect(r.o.objectives!.primary).toMatchObject({ achieved: true });
    }, 20_000);

    it('陽動して隠れて近づく：弓と騎馬で辻の番兵を押すと陣の後詰めが動き、林の組が当たる。勝つ（記録：296 秒・13.9％・7 隊とも残る）', () => {
        const r = play(FEINT(J0));
        expect(won(r), brief(r)).toBe(true);
        expect([Math.round(r.t), Math.round(r.loss * 1000) / 10, standing(r)]).toEqual([296, 13.9, 7]);
    }, 20_000);

    it('準備した正面攻撃：番兵を誘い出して崩し、街道を押し上がって物見も崩し、陣を取って勝つ（記録：322 秒・29.6％・✓✓。すれ違いの直しの前は 329 秒・29.9％）', () => {
        const r = play(FRONT(J0));
        expect(won(r), brief(r)).toBe(true);
        expect(sec(r, 'raid_watch')).toBe(true);
        expect(r.s.events.some((e) => e.kind === 'ai' && e.text.includes('番兵が矢を嫌って打って出た'))).toBe(true);
        expect([Math.round(r.t), Math.round(r.loss * 1000) / 10]).toEqual([322, 29.6]);
    }, 20_000);

    it('記録：無計画（全隊で一番近い敵へ）は 243 秒で勝つが 29.0％ を失う。待つだけは日没（夜明け）で撤退', () => {
        const u = play(UNPLANNED(J0));
        expect([u.o.result, Math.round(u.t), Math.round(u.loss * 1000) / 10, standing(u)]).toEqual(['victory', 243, 29, 5]);
        const h = play(HOLD(J0));
        expect([h.o.result, h.o.reason, h.loss]).toEqual(['retreat', 'nightfall', 0]);
    }, 20_000);

    it('台本は人が画面でできる程度：命令は 70 回以下、10 秒に 8 回以下。移動の後の向き（face）は使わない', () => {
        for (const plan of [STEALTH, FEINT, FRONT, UNPLANNED]) {
            for (const k of [0, 5, 11]) {
                const r = play(plan(jitterOf(k)));
                expect(r.cmds.length).toBeLessThanOrEqual(70);
                const c = r.cmds;
                let most = 0;
                for (let i = 0; i < c.length; i++) most = Math.max(most, c.filter((t) => t >= c[i]! && t < c[i]! + 10).length);
                expect(most).toBeLessThanOrEqual(8);
            }
            for (const [, , cmd] of plan(J0)) if (typeof cmd === 'object' && 'type' in cmd && cmd.type === 'move') expect(cmd.face).toBeUndefined();
        }
    }, 60_000);
});

// ---------------------------------------------------------------- 16 通り

describe('作戦の安定性と比べ（早送り・±15 秒と見てから押す遅れの 16 通り）', () => {
    it('主目標に届く作戦 3 つ：隠れて近づく・陽動して隠れて近づく・準備した正面攻撃は、16 通りでどれも 12 勝以上（記録：16・16・16 勝）', () => {
        const rs = [STEALTH, FEINT, FRONT].map((p) => count(sixteen(p), won));
        expect(rs.every((n) => n >= 12), rs.join(',')).toBe(true);
    }, 120_000);

    it('隠れて近づいた部隊は、見つからずに陣の近くまで行ける：敵に見つかるのは陣の真ん中から 80 m 以内・180 秒の後（16 通り。記録：隠れて 66〜76 m・212〜287 秒、陽動 50〜77 m・215〜294 秒）', () => {
        for (const plan of [STEALTH, FEINT]) {
            for (const r of sixteen(plan)) {
                for (const id of SQUAD) {
                    const f = r.found[id];
                    if (!f) continue; // 見つかる前に崩れなかった（輪の外で待った）部隊は記録が無い
                    expect(f.d).toBeLessThanOrEqual(80);
                    expect(f.t).toBeGreaterThan(180);
                }
            }
        }
    }, 120_000);

    it('敵は、見つけていない味方を攻撃の相手にしない（3 作戦の 16 通りすべての刻みで 0）', () => {
        for (const plan of [STEALTH, FEINT, FRONT]) expect(sixteen(plan).reduce((a, r) => a + r.blindAttacks, 0)).toBe(0);
    }, 120_000);

    it('副目標が作戦で分かれる：物見を崩すのは正面攻撃だけ（記録：0／0／16）。損害 3 割以内は陽動がいちばん多い（15／16／14）', () => {
        const st = sixteen(STEALTH);
        const fe = sixteen(FEINT);
        const fr = sixteen(FRONT);
        expect([count(st, (r) => sec(r, 'raid_watch')), count(fe, (r) => sec(r, 'raid_watch'))]).toEqual([0, 0]);
        expect(count(fr, (r) => sec(r, 'raid_watch'))).toBeGreaterThanOrEqual(14);
        expect(count(fe, (r) => sec(r, 'raid_losses'))).toBeGreaterThanOrEqual(Math.max(count(st, (r) => sec(r, 'raid_losses')), count(fr, (r) => sec(r, 'raid_losses'))));
    }, 120_000);

    it('損害と守れる部隊：陽動して隠れて近づくは損害がいちばん小さく、守れる部隊がいちばん多い（記録：13.6％・6.4 対 隠れて 20.3％・5.7、正面 24.2％・5.7）', () => {
        const L = (p: Plan) => mean(sixteen(p).map((r) => r.loss));
        const S = (p: Plan) => mean(sixteen(p).map(standing));
        expect(L(FEINT)).toBeLessThan(L(STEALTH));
        expect(L(FEINT)).toBeLessThan(L(FRONT));
        expect(S(FEINT)).toBeGreaterThan(S(FRONT));
    }, 120_000);

    it('時間：準備した正面攻撃は隠れて近づくより早く勝つ（記録：平均 311 秒 対 337 秒）', () => {
        const T = (p: Plan) => mean(sixteen(p).filter(won).map((r) => r.t));
        expect(T(FRONT)).toBeLessThan(T(STEALTH));
    }, 120_000);

    it('準備した正面攻撃と無計画の比べ：無計画は早く勝つが（記録：247 秒 対 311 秒）、損害が大きく守れる部隊が少ない（29.0％・5 対 平均 24.2％・5.7）', () => {
        const fr = sixteen(FRONT);
        const un = sixteen(UNPLANNED);
        expect(count(un, won)).toBeGreaterThanOrEqual(12);
        expect(mean(un.map((r) => r.loss))).toBeGreaterThan(mean(fr.map((r) => r.loss)));
        expect(mean(un.map(standing))).toBeLessThan(mean(fr.map(standing)));
        expect(mean(un.map((r) => r.t))).toBeLessThan(mean(fr.filter(won).map((r) => r.t)));
    }, 120_000);
});

describe('武将の能力の価値が場面で変わる（早送り・16 通り）', () => {
    it('榊原の先駆けの号：林の端から（見つかる前の急襲）は陣の弓を崩すのが 10 秒以上早く、損害はほとんど増えない。見つかった後に陣の南から命じると早まるのは小さい。能力を使わなくても勝てる', () => {
        const hid = vanguardTimes(STEALTH);
        const hidNo = vanguardTimes(STEALTH_NOVAN);
        const fr = vanguardTimes(FRONT_VAN);
        const frNo = vanguardTimes(FRONT_NOVAN);
        const T = (rs: ReturnType<typeof vanguardTimes>) => mean(rs.filter((x) => x.broke).map((x) => x.dt));
        const L = (rs: ReturnType<typeof vanguardTimes>) => mean(rs.map((x) => x.lost));
        // 記録：林の端から 23.4 秒 対 36.9 秒（その間の榊原隊の損害 19 対 16）、陣の南から 77.0 秒 対 80.2 秒（34.9 対 34.0）。勝ちは 16・15・16・15。
        // すれ違いの詰まりの直しの前は、陣の南から 72.9 秒 対 80.1 秒・損害 44.6 対 27.3 で「陣の南からは榊原隊の損害が 10 以上多く増える」も
        // 確かめていたが、その差は 16 通りのうち 2〜3 通りで榊原隊が味方ともつれて大きく削られた分だった（直しの後はもつれが解けて差 0.9）。
        // 損害は、どちらの場面でも能力のせいで 10 より多くは増えないことを確かめる
        expect(T(hidNo) - T(hid)).toBeGreaterThanOrEqual(10);
        expect(T(frNo) - T(fr)).toBeLessThan(T(hidNo) - T(hid));
        expect(L(hid) - L(hidNo)).toBeLessThan(10);
        expect(L(fr) - L(frNo)).toBeLessThan(10);
        for (const rs of [hid, hidNo, fr, frNo]) expect(rs.filter((x) => x.broke).length).toBeGreaterThanOrEqual(12);
        expect(hidNo.filter((x) => x.won).length).toBeGreaterThanOrEqual(12);
        expect(frNo.filter((x) => x.won).length).toBeGreaterThanOrEqual(12);
    }, 180_000);
});

