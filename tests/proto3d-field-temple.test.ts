/**
 * 戦場「寺社周辺」（temple）の釣り合い（docs/fields-group3-design.md §1・§4、依頼本文 docs/fields-group3-request.md の「13. 寺社周辺」）。
 * 主目標：高い境内の二つの要所（山門と本堂前）を、どちらも敵のいない状態で味方が占め、同時に 60 秒確保する（hold_zones・mode 'all'）。
 * 入口は 3 つ：正面の石段（狭い・高低差・山門の奥の弓が見張る）、東の脇道（遠回りの道・口に槍）、林側の入口（林は遅いが見つかりにくい。
 * 山門の背後へ回れる）。4 分・4 分半に押し返しの槍が山門・本堂前へ下ってくるので、一方へ集めると、もう一方の輪が手薄になる。
 * 寺社だから特別な力が働く仕組みは無い（地形・入口・高低差だけ）。
 *
 * 合格条件は「正面なら負ける」ではなく、作戦どうしの比べ（損害・時間・副目標・守れる部隊）と、主目標に届く作戦の安定性。
 * 無計画な攻撃・一方へ集める・待つだけの結果は記録として書く。
 *
 * どれも「早送り」：決まった時刻と「見てから押す」行で issueOrder・useAbility を出す台本を runToEnd で最後まで進める（画面の操作ではない）。
 * 台本は人が画面でできる程度の命令の数・間隔にしている（一番多い準備した正面攻撃で 49 回・約 7 分。10 秒に多くて 8 回＝押し返しが来たとき）。
 * 移動の後の向き（face）は使わない。画面では敵の近くの地面を押すとその敵への攻撃になるので、台本の地面の行き先（tap）も、押す点の 20 m 以内に
 * 見えている敵がいればその敵への攻撃にする。
 * 人が画面でするのと同じ「見てから押す」行：着いたのを見て次の点を押す（道筋）、詰まって手前で止まったら押し直す、押し返しの槍が輪へ
 * 近づいたのを見て守り手を当てる、追い払ったら輪の中の持ち場へ戻す。
 *
 * 揺らぎ（16 通り）：時刻の行は ±15 秒（乱数の種 7 から。第2群・第3群のテストと同じ作り方）、「見てから押す」行には人が見てから押すまでの
 * 遅れ 0〜15 秒を足す（同じ乱数から。tests/proto3d-field-marsh.test.ts と同じ作り方）。
 *
 * 作った時の結果（早送り。16 通りは上の揺らぎ。守れる部隊＝最後に戦える味方の部隊の数／7。副目標は 損害 3 割・忠勝隊 6 割・押し返しの槍）：
 * | 作戦 | 1 通り | 16 通り |
 * | 石段と脇道から同時に（COMBO） | 251 秒・損害 19.8％・勝ち・✓✗✗・7／7 | 13 勝・平均 265 秒（256〜275）・損害 22.7％・守れる 6.6・副目標 13／0／3 |
 * | 脇道と林から分けて入る（SPLIT） | 266 秒・14.7％・勝ち・✓✓✗・7／7 | 15 勝・平均 311 秒（279〜454）・22.4％・守れる 6.6・副目標 15／16／3 |
 * | 準備した正面攻撃（FRONT。全軍で石段から） | 464 秒・25.0％・勝ち・✓✗✓・6／7 | 11 勝・平均 522 秒（471〜590）・27.5％・守れる 5.9・副目標 12／0／16 |
 * | 一方へ集める（CONC。東へ全軍） | 日没・31.0％・✗✗✓・6／7（本堂前は取るが、山門の輪へ手が回らない） | |
 * | 無計画：全部隊で目標へ一斉、あとは一番近い敵へ当て直すだけ（RUSH） | 443 秒に敵をすべて崩して勝ち・49.8％・✗✗✓・4／7（動きの直しの後 378 秒・37.2％・5／7） | 16 通りとも同じ（当て直しの時刻をずらしても変わらない） |
 * | 待つ（HOLD） | 日没・損害 0 | |
 * 第3群の動きの直し（FieldRules.refinedMoves ほか）の後：1 通りは無計画の行だけが変わる（上の表の括弧）。16 通りは石段と脇道 13 勝・脇道と林 15 勝のまま、
 * 準備した正面攻撃 11 勝 → 14 勝（平均 521 秒・26.3％・守れる 6.1）。
 *
 * 武将の能力の価値が地形で変わる比べ（同じ 16 通り）：
 * - 家康の「立て直しの号令」：狭い石段で忠勝隊が山門の槍と削り合う（1 部隊ずつしか斬りかかれない）と、号令で山門の槍が 9〜14 秒早く崩れる。
 *   林側から背後を突いて挟むと、山門の槍はすぐ崩れるので、号令の差は 0〜1.4 秒。
 * - 酒井の「両翼の采配」（包囲）：石段だけでは 2 部隊目が斬りかかれず包囲にならない（差 0.0 秒・包囲 0 回）。林側の入口と石段から挟むと
 *   包囲ができる（16 通りのうち 6 通り）。ただし側面・背後を突いた時の士気の衝撃で山門の槍がすぐ崩れるので、采配の差は 0〜2.5 秒と小さい。
 *   挟むこと自体の価値は大きい（山門の槍が崩れた時刻とその時の忠勝隊の兵：石段だけ 217〜233 秒・165〜172 人／挟む 179〜217 秒・277〜313 人）。
 *
 * 地形の決まりで台本を書くときに気を付けたこと（エンジンの振る舞い）：
 * - 輪（守る区域）は部隊の中心で数える。部隊どうしは 18 m 離れるので、2 部隊を同じ輪に入れるときは輪の中の持ち場を 18 m 離して押す
 *   （山門の輪 (0,-68) 半径 18 m なら (-9,-68) と (9,-68)）。
 * - 押し返しの槍を追い払うと、守り手はその場で待機になる（輪の外のことがある）。人が画面でするのと同じく、輪の中の持ち場へ押し直す。
 * - 石段は 20 m 幅で、上り切った所で斬り合っている部隊がいると後ろが詰まる。詰まって手前で待機になったら押し直す。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, hasLineOfSight, isActive, issueOrder, passableAt, runToEnd, unitById, RULES, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { inZone } from '../proto3d/src/battle/fieldRules';
import { reachable } from '../proto3d/src/battle/pathfind';
import { buildBattleSetup, getField, validateField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';

const TP = getField('temple')!;

// ---------------------------------------------------------------- 台本の道具

/** 地面を押す（押す点の 20 m 以内に見えている敵がいれば、その敵への攻撃。画面と同じ） */
interface Tap {
    tap: [number, number];
}
/** 対象を選ぶ能力（後詰めの差配）。'ability' は対象を選ばない能力、'nearest' は「見えている一番近い敵へ攻撃」（今の相手が戦えるなら出さない） */
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
/** 部隊の士気が th を切った・戦えなくなった */
const low =
    (id: string, th: number): Cond =>
    (s) => {
        const u = unitById(s, id)!;
        return u.status !== 'ready' || u.morale < th;
    };
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
const at =
    (t: number): Cond =>
    (s) =>
        s.t >= t - 1e-9;
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
/** 見てから押す（遅れ j.d()） */
const w = (c: Cond, j: J) => late(c, j.d());

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

/**
 * 組の道筋：ids の部隊それぞれに pts[k][i] を押す。最初の点は start、次の点からは、組の戦える部隊がみな待機になってから
 * （人が画面で、組が着いたのを見てから次を押すのと同じ。押すまでの遅れは j.d()）
 */
function squad(ids: string[], pts: [number, number][][], start: number, j: J): Step[] {
    const prog = new WeakMap<BattleState, number>();
    const done = new WeakMap<BattleState, Set<string>>();
    const out: Step[] = [];
    pts.forEach((row, k) => {
        const ready: Cond = k === 0 ? at(j.t(start)) : (s) => ids.every((x) => !isActive(unitById(s, x)!) || idle(x)(s));
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

/**
 * 行き先へ押す（start の後）。詰まって手前で待機になった（25 m より遠い）のを見たら押し直す（最大 n 回。石段の上で味方が斬り合っていると
 * 後ろが詰まる。人が画面で押し直すのと同じ）
 */
function go(id: string, x: number, z: number, start: Cond, j: J, n = 3): Step[] {
    const first = late(start, j.d());
    const cnt = new WeakMap<BattleState, number>();
    const sent = new WeakMap<BattleState, number>();
    const out: Step[] = [
        [
            (s) => {
                if (cnt.has(s) || !first(s)) return false;
                cnt.set(s, 1);
                sent.set(s, s.t);
                return true;
            },
            id,
            tap(x, z),
        ],
    ];
    for (let k = 0; k < n; k++) {
        const d = j.d() + 2;
        const seen = new WeakMap<BattleState, number>();
        out.push([
            (s) => {
                if ((cnt.get(s) ?? 0) !== k + 1) return false;
                const u = unitById(s, id)!;
                const ok = s.t >= sent.get(s)! + 3 && idle(id)(s) && Math.hypot(u.x - x, u.z - z) > 25;
                if (!ok) {
                    seen.delete(s);
                    return false;
                }
                if (!seen.has(s)) seen.set(s, s.t);
                if (s.t < seen.get(s)! + d - 1e-9) return false;
                cnt.set(s, k + 2);
                sent.set(s, s.t);
                return true;
            },
            id,
            tap(x, z),
        ]);
    }
    return out;
}

/** 持ち場へ戻る：from の後、待機で持ち場から 15 m より離れているのを見たら持ち場を押す（最大 n 回。押し返しを追い払った後に輪へ戻す） */
function post(id: string, x: number, z: number, from: Cond, j: J, n = 4): Step[] {
    const out: Step[] = [];
    const cnt = new WeakMap<BattleState, number>();
    const last = new WeakMap<BattleState, number>();
    for (let k = 0; k < n; k++) {
        const d = j.d() + 2;
        const seen = new WeakMap<BattleState, number>();
        out.push([
            (s) => {
                if ((cnt.get(s) ?? 0) !== k) return false;
                const u = unitById(s, id)!;
                const ok = from(s) && s.t >= (last.get(s) ?? -1e9) + 5 && idle(id)(s) && Math.hypot(u.x - x, u.z - z) > 15;
                if (!ok) {
                    seen.delete(s);
                    return false;
                }
                if (!seen.has(s)) seen.set(s, s.t);
                if (s.t < seen.get(s)! + d - 1e-9) return false;
                cnt.set(s, k + 1);
                last.set(s, s.t);
                return true;
            },
            id,
            tap(x, z),
        ]);
    }
    return out;
}

/** 押し返し（と本陣の騎馬）が輪 (zx, zz) の r m 以内へ来たのを見て、守り手 ids がその敵へ当たる（見えている敵だけ） */
const COUNTERS = ['e_counter', 'e_counter2', 'e_kiba'];
function meet(ids: string[], zx: number, zz: number, j: J, r = 60): Step[] {
    const out: Step[] = [];
    for (const f of COUNTERS) {
        const c: Cond = (s) => {
            const u = unitById(s, f);
            return !!u && u.status === 'ready' && u.present && u.seenBy.ally && Math.hypot(u.x - zx, u.z - zz) <= r;
        };
        for (const id of ids) out.push([w(c, j), id, atk(f)]);
    }
    return out;
}

// 輪（守る区域）の中の持ち場（部隊の間は 18 m）
const GATE = { x: 0, z: -68 };
const HALL = { x: 40, z: -150 };
const G1: [number, number] = [-9, -68];
const G2: [number, number] = [9, -68];
const H1: [number, number] = [31, -152];
const H2: [number, number] = [49, -152];
const H3: [number, number] = [40, -135];
const gateDef = (ids: string[], j: J) => meet(ids, GATE.x, GATE.z, j);
const hallDef = (ids: string[], j: J) => meet(ids, HALL.x, HALL.z, j);

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
    /** 出した命令の時刻（人が画面で出せる数・間隔か見る） */
    cmds: number[];
}

/** 台本を最後まで進める（each は刻みごと） */
function play(steps: Step[], each?: (s: BattleState) => void): Run {
    const s = createBattle(buildBattleSetup(TP, 'standard'));
    const timed = steps.filter((x) => typeof x[0] === 'number').sort((a, b) => (a[0] as number) - (b[0] as number));
    const watch = steps.filter((x) => typeof x[0] === 'function');
    const fired = new Set<number>();
    const refused: string[] = [];
    const cmds: number[] = [];
    const run = (st: BattleState, label: string, id: string, ord: Cmd) => {
        if (ord === 'nearest') {
            const n = nearestEnemy(st, id);
            if (!n) return;
            cmds.push(st.t);
            if (!issueOrder(st, id, n)) refused.push(`${label}:${id}`);
            return;
        }
        cmds.push(st.t);
        if (ord === 'ability') {
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
        each?.(st);
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    return { o, t: s.t, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused, cmds };
}

const won = (r: Run) => r.o.result === 'victory' && r.o.objectives?.primary?.achieved === true;
const sec = (r: Run, id: string) => r.o.objectives!.secondary.find((x) => x.id === id)!.achieved;
/** 最後に戦える味方の部隊の数（守れる部隊） */
const standing = (r: Run) => r.o.units.filter((u) => u.side === 'ally' && u.status === 'ready').length;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
function brief(r: Run): string {
    const s2 = r.o.objectives?.secondary.map((x) => `${x.id}:${x.achieved ? '✓' : '✗'}`).join(' ');
    return `${r.o.result}/${r.o.reason} t=${r.t.toFixed(1)} loss=${(r.loss * 100).toFixed(1)}% ${s2} 残る部隊=${standing(r)} refused=${r.refused.join(',')}`;
}
/** 16 通り（揺らぎ k = 0〜15） */
function sixteen(plan: Plan): Run[] {
    return Array.from({ length: 16 }, (_, k) => play(plan(jitterOf(k))));
}

// ---------------------------------------------------------------- 作戦の台本

/**
 * 石段と脇道から同時に（COMBO）：弓で山門の奥の弓を射すくめ、山門の槍が弱ったのを見て忠勝隊が石段を登る（石川隊の後詰めの差配で支える）。
 * 酒井隊・榊原隊・騎馬は東の脇道から口の槍を崩して本堂前へ（榊原隊は本堂の弓）。押し返しが来たら輪の守り手が当たり、追い払ったら輪へ戻る
 */
const COMBO: Plan = (j) => [
    [0, 'a_yumi', tap(-12, 25)],
    [j.t(25), 'a_yumi', atk('e_yumi_gate')],
    [0, 'a_tadakatsu', tap(0, -12)],
    [0, 'a_ishikawa', tap(0, 20)],
    [w(low('e_yumi_gate', 50), j), 'a_yumi', atk('e_gate')],
    [w(low('e_gate', 70), j), 'a_tadakatsu', atk('e_gate')],
    [w(engaged('a_tadakatsu', 'e_gate'), j), 'a_ishikawa', { abilityOn: 'a_tadakatsu' }],
    ...go('a_tadakatsu', ...G2, gone('e_gate'), j),
    ...go('a_ishikawa', ...G1, gone('e_gate'), j),
    [w(gone('e_gate'), j), 'a_yumi', atk('e_yumi_gate')],
    ...squad(
        ['a_sakai', 'a_sakakibara', 'a_kiba'],
        [
            [
                [174, 60],
                [174, 90],
                [176, 110],
            ],
            [
                [172, -110],
                [190, -95],
                [190, -70],
            ],
        ],
        0,
        j,
    ),
    [w(near('a_sakai', 174, -110, 15), j), 'a_sakai', atk('e_side')],
    [w(engaged('a_sakai', 'e_side'), j), 'a_sakakibara', atk('e_side')],
    [w(gone('e_side'), j), 'a_sakai', atk('e_hall')],
    [w(gone('e_side'), j), 'a_sakakibara', atk('e_yumi_hall')],
    [w(gone('e_side'), j), 'a_kiba', atk('e_hall')],
    [w(gone('e_yumi_hall'), j), 'a_sakakibara', atk('e_hall')],
    ...go('a_sakai', ...H1, gone('e_hall'), j),
    ...go('a_kiba', ...H3, gone('e_hall'), j),
    ...go('a_sakakibara', ...H2, all(gone('e_yumi_hall'), gone('e_hall')), j),
    ...hallDef(['a_sakai', 'a_sakakibara', 'a_kiba'], j),
    ...gateDef(['a_tadakatsu', 'a_ishikawa'], j),
    ...post('a_sakai', ...H1, gone('e_hall'), j),
    ...post('a_kiba', ...H3, gone('e_hall'), j),
    ...post('a_sakakibara', ...H2, gone('e_hall'), j),
    ...post('a_tadakatsu', ...G2, gone('e_gate'), j),
    ...post('a_ishikawa', ...G1, gone('e_gate'), j),
];

/**
 * 脇道と林から分けて入る（SPLIT）：酒井隊・榊原隊は東の脇道から本堂前へ。石川隊と騎馬は林を抜けて西の口へ、騎馬は山門の奥の弓、
 * 石川隊は山門の槍の背後へ。忠勝隊は石段の下で待ち、石川隊が斬り合ったのを見て正面から登る（挟む）。弓は石段の下から山門の奥の弓を射る
 */
const SPLIT: Plan = (j) => [
    ...squad(
        ['a_sakai', 'a_sakakibara'],
        [
            [
                [174, 60],
                [174, 90],
            ],
            [
                [174, -110],
                [174, -85],
            ],
        ],
        0,
        j,
    ),
    [w(near('a_sakai', 174, -110, 15), j), 'a_sakai', atk('e_side')],
    [w(engaged('a_sakai', 'e_side'), j), 'a_sakakibara', atk('e_side')],
    [w(gone('e_side'), j), 'a_sakai', atk('e_hall')],
    [w(gone('e_side'), j), 'a_sakakibara', atk('e_yumi_hall')],
    [w(gone('e_yumi_hall'), j), 'a_sakakibara', atk('e_hall')],
    ...go('a_sakai', ...H1, gone('e_hall'), j),
    ...go('a_sakakibara', ...H2, all(gone('e_yumi_hall'), gone('e_hall')), j),
    ...squad(
        ['a_ishikawa', 'a_kiba'],
        [
            [
                [-180, 40],
                [-180, 70],
            ],
            [
                [-182, -80],
                [-182, -50],
            ],
            [
                [-145, -100],
                [-175, -95],
            ],
        ],
        0,
        j,
    ),
    [w(near('a_ishikawa', -145, -100, 15), j), 'a_kiba', atk('e_yumi_gate')],
    [w(near('a_ishikawa', -145, -100, 15), j), 'a_ishikawa', atk('e_gate')],
    [0, 'a_yumi', tap(-12, 25)],
    [0, 'a_tadakatsu', tap(0, -10)],
    [j.t(40), 'a_yumi', atk('e_yumi_gate')],
    [w(engaged('a_ishikawa', 'e_gate'), j), 'a_tadakatsu', atk('e_gate')],
    ...go('a_tadakatsu', ...G2, gone('e_gate'), j),
    ...go('a_ishikawa', ...G1, gone('e_gate'), j),
    ...go('a_kiba', -30, -100, all(gone('e_gate'), gone('e_yumi_gate')), j),
    ...hallDef(['a_sakai', 'a_sakakibara'], j),
    ...gateDef(['a_tadakatsu', 'a_ishikawa', 'a_kiba'], j),
    ...post('a_sakai', ...H1, gone('e_hall'), j),
    ...post('a_sakakibara', ...H2, gone('e_hall'), j),
    ...post('a_tadakatsu', ...G2, gone('e_gate'), j),
    ...post('a_ishikawa', ...G1, gone('e_gate'), j),
];

/**
 * 準備した正面攻撃（FRONT）：全軍で石段から。弓で山門の奥の弓を射すくめてから山門の槍を射る。山門の槍が弱ったのを見て忠勝隊が登り、
 * 石川隊が後詰めの差配で支え、忠勝隊の士気が落ちたら家康が号令（本陣を石段の下へ寄せておく）。山門を取ったら、榊原隊が先駆けで本堂の弓へ、
 * 騎馬・酒井隊が境内の中から本堂前の槍へ。忠勝隊・石川隊は山門の輪、弓は山門の脇
 */
const FRONT: Plan = (j) => [
    [0, 'a_yumi', tap(-12, 25)],
    [j.t(25), 'a_yumi', atk('e_yumi_gate')],
    [0, 'a_tadakatsu', tap(0, -12)],
    [0, 'a_ishikawa', tap(0, 20)],
    [0, 'a_sakai', tap(25, 35)],
    [0, 'a_kiba', tap(-30, 50)],
    [0, 'a_sakakibara', tap(30, 60)],
    [0, 'a_ieyasu', tap(0, 45)],
    [w(low('e_yumi_gate', 50), j), 'a_yumi', atk('e_gate')],
    [w(low('e_gate', 70), j), 'a_tadakatsu', atk('e_gate')],
    [w(engaged('a_tadakatsu', 'e_gate'), j), 'a_ishikawa', { abilityOn: 'a_tadakatsu' }],
    [w(low('a_tadakatsu', 60), j), 'a_ieyasu', 'ability'],
    ...go('a_sakakibara', 25, -95, gone('e_gate'), j),
    ...go('a_kiba', -20, -100, gone('e_gate'), j),
    ...go('a_sakai', 5, -105, late(gone('e_gate'), 8), j),
    ...go('a_tadakatsu', ...G2, gone('e_gate'), j),
    ...go('a_ishikawa', ...G1, late(gone('e_gate'), 20), j),
    ...go('a_yumi', -10, -50, late(gone('e_gate'), 30), j),
    [w(near('a_sakakibara', 25, -95, 25), j), 'a_sakakibara', 'ability'],
    [w(near('a_sakakibara', 25, -95, 25), j), 'a_sakakibara', atk('e_yumi_hall')],
    [w(all(near('a_sakai', 5, -105, 25), near('a_kiba', -20, -100, 25)), j), 'a_sakai', atk('e_hall')],
    [w(all(near('a_sakai', 5, -105, 25), near('a_kiba', -20, -100, 25)), j), 'a_kiba', atk('e_hall')],
    [w(gone('e_yumi_hall'), j), 'a_sakakibara', atk('e_hall')],
    ...go('a_sakai', ...H1, gone('e_hall'), j),
    ...go('a_kiba', ...H3, gone('e_hall'), j),
    ...go('a_sakakibara', ...H2, all(gone('e_yumi_hall'), gone('e_hall')), j),
    ...hallDef(['a_sakai', 'a_sakakibara', 'a_kiba'], j),
    ...gateDef(['a_tadakatsu', 'a_ishikawa'], j),
    ...post('a_sakai', ...H1, gone('e_hall'), j),
    ...post('a_kiba', ...H3, gone('e_hall'), j),
    ...post('a_sakakibara', ...H2, gone('e_hall'), j),
    ...post('a_tadakatsu', ...G2, gone('e_gate'), j),
    ...post('a_ishikawa', ...G1, gone('e_gate'), j),
];

/** 一方へ集める（CONC）：弓のほかは全軍で東の脇道を回り、本堂前を取る。山門へは本堂前を取ってから騎馬を 1 隊だけ回す */
const CONC: Plan = (j) => [
    [0, 'a_yumi', tap(-12, 25)],
    [j.t(25), 'a_yumi', atk('e_yumi_gate')],
    ...squad(
        ['a_sakai', 'a_sakakibara', 'a_kiba', 'a_tadakatsu', 'a_ishikawa'],
        [
            [
                [174, 60],
                [174, 90],
                [176, 110],
                [174, 30],
                [174, 0],
            ],
            [
                [174, -110],
                [174, -85],
                [174, -62],
                [174, -40],
                [174, -15],
            ],
        ],
        0,
        j,
    ),
    [w(near('a_sakai', 174, -110, 15), j), 'a_sakai', atk('e_side')],
    [w(engaged('a_sakai', 'e_side'), j), 'a_sakakibara', atk('e_side')],
    [w(gone('e_side'), j), 'a_sakai', atk('e_hall')],
    [w(gone('e_side'), j), 'a_tadakatsu', atk('e_hall')],
    [w(gone('e_side'), j), 'a_ishikawa', atk('e_hall')],
    [w(gone('e_side'), j), 'a_sakakibara', atk('e_yumi_hall')],
    [w(gone('e_side'), j), 'a_kiba', atk('e_yumi_hall')],
    ...go('a_sakai', 40, -150, gone('e_hall'), j),
    ...go('a_tadakatsu', 20, -140, gone('e_hall'), j),
    ...go('a_ishikawa', 60, -160, gone('e_hall'), j),
    ...go('a_sakakibara', 65, -130, all(gone('e_yumi_hall'), gone('e_hall')), j),
    [w(gone('e_hall'), j), 'a_kiba', atk('e_gate')],
    ...hallDef(['a_sakai', 'a_sakakibara', 'a_tadakatsu', 'a_ishikawa'], j),
];

/** 無計画（RUSH）：全部隊で目標へ一斉（石段に近い隊は山門、ほかは本堂前）、あとは 10 秒ごとに一番近い敵へ当て直すだけ（本陣は動かさない） */
const RUSH: Plan = () => {
    const o: Step[] = [
        [0, 'a_tadakatsu', tap(0, -62)],
        [0, 'a_kiba', tap(0, -62)],
        [0, 'a_yumi', tap(0, -62)],
        [0, 'a_sakai', tap(40, -150)],
        [0, 'a_sakakibara', tap(40, -150)],
        [0, 'a_ishikawa', tap(40, -150)],
    ];
    for (const id of ['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_sakakibara', 'a_kiba', 'a_yumi']) for (let t = 11; t < 600; t += 10) o.push([t, id, 'nearest']);
    return o;
};

/** 待つ（HOLD）：命令を出さない */
const HOLD: Plan = () => [];

// ---------------------------------------------------------------- 能力の比べの台本

/**
 * 山門の槍を、石段だけで攻める（stairs：忠勝隊が登り、石川隊が後ろから続く。狭い正面で 2 部隊目は斬りかかれない）か、
 * 石段と林側の入口から挟む（pincer：忠勝隊が石段から、騎馬が林を抜けて西の口から背後へ）。ほかの部隊は動かさない。
 * 弓は石段の下から山門の奥の弓 → 山門の槍。酒井隊は石段の下（山門の槍から 100 m 以内）、家康本陣は石段の下（0,40）へ寄せる。
 * ability は能力を使う行を作る（無ければ使わない）。揺らぎの乱数を同じ順に引くように、能力の行は最後に作る（使う・使わないで、ほかの行の
 * 時刻・遅れが同じになる）
 */
function gateAttack(mode: 'stairs' | 'pincer', ability?: (j: J) => Step[]): Plan {
    return (j) => [
        [0, 'a_yumi', tap(-12, 25)],
        [j.t(25), 'a_yumi', atk('e_yumi_gate')],
        [0, 'a_tadakatsu', tap(0, -12)],
        [0, 'a_sakai', tap(0, 15)],
        [0, 'a_ieyasu', tap(0, 40)],
        [w(low('e_yumi_gate', 50), j), 'a_yumi', atk('e_gate')],
        ...(mode === 'stairs'
            ? ([
                  [0, 'a_ishikawa', tap(15, 30)],
                  [w(low('e_gate', 70), j), 'a_tadakatsu', atk('e_gate')],
                  [w(engaged('a_tadakatsu', 'e_gate'), j), 'a_ishikawa', atk('e_gate')],
              ] as Step[])
            : ([
                  ...route(
                      'a_kiba',
                      [
                          [-180, 40],
                          [-182, -80],
                          [-140, -100],
                          [-50, -95],
                      ],
                      0,
                      j,
                  ),
                  [w(low('e_gate', 70), j), 'a_tadakatsu', atk('e_gate')],
                  [w(all(near('a_kiba', -50, -95, 20), engaged('a_tadakatsu', 'e_gate')), j), 'a_kiba', atk('e_gate')],
              ] as Step[])),
        ...(ability ? ability(j) : []),
    ];
}
/** 能力を使う行：家康の号令（忠勝隊の士気が 60 を切ったのを見て） */
const RALLY = (j: J): Step[] => [[w(low('a_tadakatsu', 60), j), 'a_ieyasu', 'ability']];
/** 能力を使う行：酒井の両翼の采配（stairs は忠勝隊が斬り合ったのを見て。pincer は騎馬が背後に着き、忠勝隊が斬り合ったのを見て＝挟む直前） */
const FLANK = (mode: 'stairs' | 'pincer', j: J): Step[] =>
    mode === 'stairs'
        ? [[w(engaged('a_tadakatsu', 'e_gate'), j), 'a_sakai', 'ability']]
        : [[w(all(near('a_kiba', -50, -95, 20), engaged('a_tadakatsu', 'e_gate')), j), 'a_sakai', 'ability']];

interface GateFight {
    /** 山門の槍が崩れた時刻 */
    broke: number;
    /** そのときの忠勝隊の兵 */
    tadakatsu: number;
    /** 山門の槍が包囲されていた秒数 */
    encircledSec: number;
    refused: string[];
}
function gateFight(plan: Plan, j: J): GateFight {
    let broke = -1;
    let tadakatsu = -1;
    let enc = 0;
    const r = play(plan(j), (s) => {
        if (s.encircled.includes('e_gate')) enc += RULES.tick;
        if (broke < 0 && unitById(s, 'e_gate')!.status !== 'ready') {
            broke = s.t;
            tadakatsu = Math.round(unitById(s, 'a_tadakatsu')!.strength);
        }
    });
    return { broke, tadakatsu, encircledSec: enc, refused: r.refused };
}

// ---------------------------------------------------------------- テスト

describe('寺社周辺のデータ', () => {
    it('検査を通る。主目標は二つの要所の同時確保（敵本陣の撃破ではない）。副目標 3 つ。同時に存在する部隊は上限以内（押し返し 2 を含めて敵 9）', () => {
        expect(validateField(TP)).toEqual([]);
        const p = TP.objectives.primary;
        expect(p.type).toBe('hold_zones');
        if (p.type !== 'hold_zones') throw new Error('hold_zones');
        expect([p.zones.length, p.sec, p.mode, p.names]).toEqual([2, 60, 'all', ['山門', '本堂前']]);
        expect(TP.objectives.secondary.map((x) => x.id)).toEqual(['temple_losses', 'temple_tadakatsu', 'temple_counter']);
        const us = TP.presets[0]!.units;
        expect(us.filter((u) => u.side === 'ally').length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.ally);
        expect(us.filter((u) => u.side === 'enemy').length).toBe(9);
        expect(us.filter((u) => u.side === 'enemy').length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.enemy);
        expect(us.filter((u) => u.reinforcement).map((u) => u.reinforcement)).toEqual(['counter', 'counter2']);
        expect(TP.generalInitiative).toBe(true);
        // 寺社だから特別な力が働く決まりは無い（特殊ルールは狭い正面だけ）
        expect((TP.specialRules ?? []).map((r) => r.type)).toEqual(['narrow_frontage']);
    });

    it('入口は 3 つ：石段（20 m 幅・狭い正面）・東の脇道の口・林側の入口。どれからも二つの輪へ行ける。ほかの台地の縁は崖', () => {
        const s = createBattle(buildBattleSetup(TP, 'standard'));
        // 台地の南の縁（z -40）を通れる所は石段の 20 m だけ
        const south = [];
        for (let x = -147.5; x <= 147.5; x += 5) if (passableAt(s, x, -40)) south.push(x);
        expect(south).toEqual([-7.5, -2.5, 2.5, 7.5]);
        // 東の縁（x 156）・西の縁（x -156）を通れる所は、脇道の口と林側の入口だけ
        const edge = (x: number) => {
            const out: number[] = [];
            for (let z = -197.5; z <= -42.5; z += 5) if (passableAt(s, x, z)) out.push(z);
            return out;
        };
        expect(edge(156)).toEqual([-157.5, -152.5, -147.5, -142.5, -137.5, -132.5, -127.5]);
        expect(edge(-156)).toEqual([-112.5, -107.5, -102.5, -97.5, -92.5, -87.5]);
        const nav = s.field.nav!;
        for (const [fx, fz] of [
            [0, 120],
            [174, 60],
            [-180, 40],
        ])
            for (const z of [GATE, HALL]) expect(reachable(nav, 'yari', fx, fz, z.x, z.z), `${fx},${fz} → ${z.x},${z.z}`).toBe(true);
        // 石段は狭い正面（同じ相手へ斬りかかれるのは 1 部隊まで）
        const nr = TP.specialRules![0]!;
        expect(nr.type === 'narrow_frontage' && nr.maxEngaged).toBe(1);
        expect(nr.type === 'narrow_frontage' && inZone(nr.zone, 0, -40)).toBe(true);
    });

    it('台地の上の建物は、台地の上どうしの矢を遮る（遮る高さに台地の高さを足している）。開いた境内では射線が通る', () => {
        const s = createBattle(buildBattleSetup(TP, 'standard'));
        // 塔（x 90〜106・z -100〜-84）の南北
        expect(hasLineOfSight(s, { x: 98, z: -115 }, { x: 98, z: -70 })).toBe(false);
        // 本堂（x 10〜70・z -196〜-176）の南北
        expect(hasLineOfSight(s, { x: 40, z: -200 }, { x: 40, z: -160 })).toBe(false);
        // 山門の脇の建物（x 22〜46・z -64〜-54）を挟む
        expect(hasLineOfSight(s, { x: 34, z: -75 }, { x: 34, z: -48 })).toBe(false);
        // 山門の輪から本堂前の輪へは遮るものが無い
        expect(hasLineOfSight(s, GATE, HALL)).toBe(true);
        for (const a of TP.terrain.filter((x) => x.kind === 'building')) expect(a.height).toBeGreaterThan(8 + 1.5);
    });
});

describe('作戦（早送り）', () => {
    const r = {
        combo: play(COMBO(J0)),
        split: play(SPLIT(J0)),
        front: play(FRONT(J0)),
        conc: play(CONC(J0)),
        rush: play(RUSH(J0)),
        hold: play(HOLD(J0)),
    };

    it('石段と脇道から同時に：二つの要所を同時に 60 秒確保して勝つ（記録：251 秒・損害 19.8％）', () => {
        expect(won(r.combo), brief(r.combo)).toBe(true);
        expect(r.combo.o.reason).toBe('objective_done');
    });

    it('脇道と林から分けて入る：二つの要所を同時に 60 秒確保して勝つ（記録：266 秒・損害 14.7％）', () => {
        expect(won(r.split), brief(r.split)).toBe(true);
        expect(r.split.o.reason).toBe('objective_done');
    });

    it('準備した正面攻撃（全軍で石段から）：勝つ（記録：464 秒・損害 25.0％）。石段と脇道より遅い', () => {
        expect(won(r.front), brief(r.front)).toBe(true);
        expect(r.front.t).toBeGreaterThan(r.combo.t + 120);
        expect(r.front.t).toBeGreaterThan(r.split.t + 120);
    });

    it('副目標が作戦で分かれる：脇道と林は忠勝隊を残すが押し返しを崩さない。準備した正面攻撃は押し返しを崩すが忠勝隊が削られる。石段と脇道は忠勝隊 ✗', () => {
        expect([sec(r.split, 'temple_tadakatsu'), sec(r.split, 'temple_counter')], brief(r.split)).toEqual([true, false]);
        expect([sec(r.front, 'temple_tadakatsu'), sec(r.front, 'temple_counter')], brief(r.front)).toEqual([false, true]);
        expect(sec(r.combo, 'temple_tadakatsu'), brief(r.combo)).toBe(false);
        // 3 つとも損害は 3 割以内（記録：19.8・14.7・25.0％）
        for (const x of [r.combo, r.split, r.front]) expect(sec(x, 'temple_losses'), brief(x)).toBe(true);
    });

    // 第3群の動きの直し（FieldRules.refinedMoves と、建物の角の向こうの相手に「14 m より近づかない」を効かせない直し）の後、無計画な攻撃は
    // 443 秒・49.8％・残る部隊 4 → 378 秒・37.2％・残る部隊 5 になった（家屋・堂の角の手前で止まって射られ続けていた部隊が、角を回って斬り合う）。
    // ほかの作戦の 1 通りの結果は変わらない。比べの幅を「損害が 15 点以上小さい」→「10 点以上」、石段と脇道・脇道と林は「25 点以上」→「15 点以上」にする
    it('比べ：準備した正面攻撃は無計画な攻撃より損害が小さく、守れる部隊・果たす副目標が多い（記録：無計画は 443 秒に敵をすべて崩して勝つが、損害 49.8％・残る部隊 4。動きの直しの後 378 秒・37.2％・5）', () => {
        expect(r.front.loss).toBeLessThan(r.rush.loss - 0.1);
        expect(standing(r.front)).toBeGreaterThan(standing(r.rush));
        const n = (x: Run) => x.o.objectives!.secondary.filter((y) => y.achieved).length;
        expect(n(r.front)).toBeGreaterThan(n(r.rush));
        // 記録：無計画な攻撃は、二つの輪を同時に確保したのではなく、敵の部隊をすべて崩して勝つ（主目標は勝利と同じに数える）
        expect(r.rush.o.reason).toBe('enemy_army_broken');
        // 石段と脇道・脇道と林は、無計画な攻撃より早く、損害も小さい
        for (const x of [r.combo, r.split]) {
            expect(x.t).toBeLessThan(r.rush.t);
            expect(x.loss).toBeLessThan(r.rush.loss - 0.15);
        }
    });

    it('記録：一方へ集める（東へ全軍）は、本堂前は取るが山門へ手が回らず、同時の確保が数えられないまま日没（損害は分けて入る作戦と同じくらい）。待つだけも日没', () => {
        expect(r.conc.o.objectives!.primary!.achieved, brief(r.conc)).toBe(false);
        expect(r.conc.o.reason).toBe('nightfall');
        // 敵の部隊は本陣のほかすべて崩しているのに、二つの輪を同時に占めていない
        expect(r.conc.o.units.filter((u) => u.side === 'enemy' && u.id !== 'e_hq' && u.status === 'ready').length).toBe(0);
        expect(Math.abs(r.conc.loss - r.split.loss)).toBeLessThan(0.2);
        expect([r.hold.o.reason, r.hold.loss]).toEqual(['nightfall', 0]);
    });

    it('台本は人が画面でできる程度：命令は 50 回以下、10 秒に 8 回以下。移動の後の向き（face）は使わない', () => {
        for (const [k, x] of Object.entries(r)) {
            expect(x.cmds.length, k).toBeLessThanOrEqual(50);
            const most = Math.max(0, ...x.cmds.map((t) => x.cmds.filter((y) => y >= t && y < t + 10).length));
            expect(most, k).toBeLessThanOrEqual(8);
        }
        for (const p of [COMBO, SPLIT, FRONT, CONC, RUSH]) for (const st of p(J0)) expect(typeof st[2] === 'object' && 'face' in st[2]).toBe(false);
    });
});

describe('作戦の安定性（早送り・±15 秒と見てから押す遅れの 16 通り）', () => {
    it('石段と脇道・脇道と林は 16 通りで 12 勝以上（記録：13 勝・15 勝）。脇道と林は忠勝隊をいつも残し、石段と脇道は早い', () => {
        const combo = sixteen(COMBO);
        const split = sixteen(SPLIT);
        expect(combo.filter(won).length).toBeGreaterThanOrEqual(12);
        expect(split.filter(won).length).toBeGreaterThanOrEqual(12);
        // 時間：勝った回の平均（記録：265 秒・311 秒）
        expect(mean(combo.filter(won).map((x) => x.t))).toBeLessThan(mean(split.filter(won).map((x) => x.t)));
        // 忠勝隊を残す（記録：0／16・16／16）
        expect(split.filter((x) => sec(x, 'temple_tadakatsu')).length).toBe(16);
        expect(combo.filter((x) => sec(x, 'temple_tadakatsu')).length).toBe(0);
    }, 300000);

    it('準備した正面攻撃は 16 通りで 8 勝以上（記録：11 勝・平均 522 秒＝日没 600 秒に近く、遅れると日が暮れる）。押し返しの槍はいつも崩す', () => {
        const front = sixteen(FRONT);
        expect(front.filter(won).length).toBeGreaterThanOrEqual(8);
        expect(front.filter((x) => sec(x, 'temple_counter')).length).toBe(16);
        expect(mean(front.filter(won).map((x) => x.t))).toBeGreaterThan(450);
    }, 300000);
});

describe('武将の能力の価値が地形で変わる（早送り・16 通り）', () => {
    it('家康の号令：狭い石段で山門の槍と削り合うと、号令で山門の槍が 9〜14 秒早く崩れる。林側から挟むと差は 0〜1.4 秒', () => {
        const d = { stairs: [] as number[], pincer: [] as number[] };
        for (let k = 0; k < 16; k++) {
            for (const mode of ['stairs', 'pincer'] as const) {
                const off = gateFight(gateAttack(mode), jitterOf(k));
                const on = gateFight(gateAttack(mode, RALLY), jitterOf(k));
                expect(on.refused, `${mode} k${k}`).toEqual([]);
                d[mode].push(off.broke - on.broke);
            }
        }
        expect(Math.min(...d.stairs)).toBeGreaterThan(8);
        expect(Math.max(...d.pincer)).toBeLessThan(3);
        expect(mean(d.stairs)).toBeGreaterThan(mean(d.pincer) + 8);
    }, 300000);

    it('酒井の両翼の采配：石段だけでは包囲にならない（差 0・包囲 0 秒）。林側の入口と石段から挟むと包囲ができる。挟むこと自体で山門の槍が早く崩れ、忠勝隊が残る', () => {
        const stairsGain: number[] = [];
        const pincerGain: number[] = [];
        let pincerEnc = 0;
        const stairsBroke: number[] = [];
        const pincerBroke: number[] = [];
        const stairsTd: number[] = [];
        const pincerTd: number[] = [];
        for (let k = 0; k < 16; k++) {
            const sOff = gateFight(gateAttack('stairs'), jitterOf(k));
            const sOn = gateFight(gateAttack('stairs', (j) => FLANK('stairs', j)), jitterOf(k));
            const pOff = gateFight(gateAttack('pincer'), jitterOf(k));
            const pOn = gateFight(gateAttack('pincer', (j) => FLANK('pincer', j)), jitterOf(k));
            for (const x of [sOn, pOn]) expect(x.refused, `k${k}`).toEqual([]);
            expect(sOn.encircledSec, `k${k}`).toBe(0);
            stairsGain.push(sOff.broke - sOn.broke);
            pincerGain.push(pOff.broke - pOn.broke);
            if (pOn.encircledSec > 0) pincerEnc++;
            stairsBroke.push(sOff.broke);
            pincerBroke.push(pOff.broke);
            stairsTd.push(sOff.tadakatsu);
            pincerTd.push(pOff.tadakatsu);
        }
        // 石段：采配を使っても何も変わらない（狭い正面で 2 部隊目が斬りかかれない）
        expect(stairsGain.every((x) => Math.abs(x) < 1e-6)).toBe(true);
        // 挟む：包囲ができる（記録：6／16 通り）。采配の差は小さい（記録：0〜2.5 秒。側背の衝撃で山門の槍がすぐ崩れるため）
        expect(pincerEnc).toBeGreaterThanOrEqual(4);
        expect(Math.min(...pincerGain)).toBeGreaterThanOrEqual(0);
        expect(mean(pincerGain)).toBeGreaterThan(mean(stairsGain));
        // 挟むこと自体の価値（記録：石段だけ 217〜233 秒・その時の忠勝隊 165〜172 人／挟む 179〜217 秒・277〜313 人）
        expect(mean(pincerBroke)).toBeLessThan(mean(stairsBroke) - 15);
        expect(Math.min(...pincerTd)).toBeGreaterThan(Math.max(...stairsTd) + 50);
    }, 300000);
});
