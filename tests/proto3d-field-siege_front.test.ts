/**
 * 戦場「城攻め前面」（siege_front）の釣り合い（docs/fields-group3-design.md §1・§4、依頼本文 docs/fields-group3-request.md の「15. 城攻め前面」）。
 * 主目標：段階目標（sequence）。1. 外門の制圧（門の前の輪を、敵の戦える部隊がいない状態で味方が 20 秒占めると門が開く）→
 * 2. 最初の曲輪（門の奥の輪）を、敵のいない状態で味方が 45 秒確保する（hold_point）。敵本陣の撃破ではない。
 * 外門は閉じている間は通れず矢も通さない。開いた後は通れ、道探しの格子と進んでいる道が引き直される。門の左右の櫓（櫓台の石垣の上の弓）は
 * 門の前を射下ろし、外からは斬り合いも届かない。東の外の側面の拠点（丘・南と西は柵）の弓は門の前の輪の東半分まで届く。
 * 西の櫓の前（南西）に小さな林（第4群の釣り合いの直しで足した。林の中の部隊は 60 m まで見えないので、林の中の弓は西の櫓を射返されにくい）。
 * 城壁の破壊・梯子・攻城兵器は無い。
 *
 * 合格条件は「正面なら負ける」ではなく、作戦どうしの比べ（損害・時間・副目標・守れる部隊）と、主目標に届く作戦の安定性。
 * 無計画な攻撃・待つだけの結果は記録として書く。
 *
 * どれも「早送り」：決まった時刻と「見てから押す」行で issueOrder・useAbility を出す台本を runToEnd で最後まで進める（画面の操作ではない）。
 * 台本は人が画面でできる程度の命令の数・間隔にしている（一番多い台本で 36 回・10 秒に多くて 8 回）。移動の後の向き（face）は使わない。
 * 画面では敵の近くの地面を押すとその敵への攻撃になるので、台本の地面の行き先（tap）も、押す点の 20 m 以内に見えている敵がいれば
 * その敵への攻撃にする。人が画面でするのと同じ「見てから押す」行：着いたのを見て次の点を押す（道筋）、櫓の弓が弱ったのを見て出張りへ
 * 当たる、出張りが崩れたのを見て門の前の輪へ入る、門が開いたのを見て門の裏の槍へ当たる、詰まって止まったら押し直す。
 *
 * 揺らぎ（16 通り）：時刻の行は ±15 秒（乱数の種 7 から。第2群・第3群のテストと同じ作り方）、「見てから押す」行には人が見てから押すまでの
 * 遅れ 0〜15 秒を足す（同じ乱数から。tests/proto3d-field-temple.test.ts・marsh と同じ作り方）。
 *
 * 作った時の結果（第3群。第4群の釣り合いの直しの後の数字は、16 通りの比べの describe の前の表。早送り。16 通りは上の揺らぎ。守れる部隊＝最後に戦える味方の部隊の数／7。副目標は 損害 3 割・拠点の弓・騎馬 6 割）：
 * | 作戦 | 1 通り | 16 通り |
 * | 側面の拠点を先に（BASTION） | 門 161 秒・勝ち 289 秒・損害 22.5％・✓✓✓・7／7 | 16 勝・勝ち 371 秒（320〜400）・門 214 秒（180〜252）・損害 29.3％（24.8〜36.2）・守れる 6.4・副目標 10／16／9 |
 * | 準備した正面攻撃（FRONT。弓で櫓を射すくめてから全軍） | 門 171 秒・勝ち 288 秒・27.8％・✓✗✓・6／7 | 16 勝・331 秒（310〜348）・門 195 秒（175〜208）・28.0％（24.0〜31.0）・6.4・14／0／10 |
 * | 急いで門へ（RUSH） | 門 80 秒・勝ち 386 秒・39.4％・✗✗✗・6／7 | 15 勝（1 回は日没）・249 秒（209〜418）・門 88 秒（82〜93）・31.9％（26.9〜44.3）・6.4・7／0／0 |
 * | 無計画：全部隊で門の前へ一斉、あとは一番近い（斬りかかれる）敵へ当て直すだけ（UNPLANNED） | 門を開けず日没・31.7％・残る部隊 5（道の無い相手への攻撃を断る直しの前は、門 195 秒・曲輪の確保へ届かず 439 秒に敵の諸隊をすべて崩して勝つ・53.4％・残る部隊 4。押し離しの直しの前は 205 秒・463 秒に総崩れ・63.0％・残る部隊 1） | 時刻をずらしても同じ |
 * | 待つ（HOLD） | 日没・損害 0・門は開かない | |
 * 作戦の違い：拠点を先には東へ遠回りするので門が開くのも勝つのも一番遅いが、拠点の弓をいつも崩す。準備した正面攻撃は損害が一番安定して
 * 小さく（損害 3 割を 16 通りで 14 回守る）、拠点には手を出さない。急いで門へは門が 100 秒ほど早く開き勝つのも早いが、損害が大きくばらつき
 * （最大 44.3％・日没 1 回）、騎馬を 1 度も残せない。櫓の弓は、射すくめない作戦でも、待機の弓が届く一番近い敵として射るので最後は崩れる。
 *
 * 武将の能力の価値が地形で変わる比べ（同じ 16 通り）：
 * - 榊原の先駆けの号（騎馬で弓へ駆け込む）：拠点の丘の上の弓へは、使えば 25〜33 秒で崩し（16／16）、使わなければ拠点の槍に横を突かれて
 *   榊原隊が先に崩れる（0／16）。櫓の上の弓へは、外からは櫓台の石垣で斬り合いが届かず、使っても使わなくても届かない（0／16）。
 *   門を開けて曲輪の中から櫓へ回ると、門と曲輪を回る道が長く 20 秒の効果が着く前に切れ、差は平均 2 秒ほど（88.2 → 86.0 秒）。
 * - 忠勝の退路の守護（門の前で退く隊）：門の前で出張りと斬り合って退く酒井隊の、退き始めて 30 秒の損害が平均 34.6 → 13.6
 *   （櫓・拠点の矢と出張りの追い討ちが忠勝隊へ向く）。代わりに忠勝隊の同じ 30 秒の損害が増える（55〜115 → 111〜144）。
 * - 家康の号令（矢を浴びる門の前）：この戦場の台本では数字の差が出なかった（記録）。急いで門へに家康本陣を門の前の道へ寄せ、門の前の
 *   3 部隊・門の裏の槍と斬り合う忠勝隊の士気が 45〜65 を切ったら号令、という台本を足しても、条件が一度も満たされず結果が同じだった
 *   （5 部隊で出張りを一度に破る・石川隊の後詰めの差配が支えるので、士気が敗走の近くまで下がらない）。
 *
 * 台本を書くときに気を付けたこと（エンジンの振る舞い。engineRequests に書いた）：
 * - 門の前の輪の持ち場は、門の口の正面（x -10〜10 の筋）と、門へ向かう味方の通り道をふさがない所に置く（止まっている味方 2 部隊の間を
 *   抜けられない部隊は、移動のまま止まり続ける。同じ行き先を押し直しても動かない。第4群の味方同士の詰まりの決まりの後は、味方だけに塞がれて
 *   2 秒（RULES.allyBlockSec）で味方の中をすり抜ける）。
 * - 敗走した出張りは、閉じた門に押し付けられて門の前に残る（戦えないので輪の制圧は止めない）。
 */
import { describe, expect, it } from 'vitest';
import { bowRangeFor, createBattle, hasLineOfSight, isActive, issueOrder, meleeUnreachable, passableAt, runToEnd, stepBattle, unitById, RULES, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { inZone, openAllGates } from '../proto3d/src/battle/fieldRules';
import { reachable } from '../proto3d/src/battle/pathfind';
import { buildBattleSetup, getField, validateField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';

const SF = getField('siege_front')!;

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
    // 道の無い相手（櫓台の上・閉じた門の向こう）は、画面で押しても断られて理由が出る（sim.ts の meleeUnreachable）ので、人は次に近い敵を押す。
    // 前はこの相手への攻撃も受け付けられ、石垣の足元で道が無いまま立ち続けていた
    const e = seenEnemies(s)
        .filter((x) => !meleeUnreachable(s, u, x))
        .sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
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
/** 部隊が移動の命令のまま、10 秒のあいだ 3 m も進めていない（味方に挟まれて止まっている。人が画面で見て押し直す） */
const stuck = (id: string): Cond => {
    const mark = new WeakMap<BattleState, { x: number; z: number; t: number }>();
    return (s) => {
        const u = unitById(s, id);
        if (!u || !isActive(u) || u.order.type !== 'move' || u.engagedWith) {
            mark.delete(s);
            return false;
        }
        const m = mark.get(s);
        if (!m || Math.hypot(u.x - m.x, u.z - m.z) > 3) {
            mark.set(s, { x: u.x, z: u.z, t: s.t });
            return false;
        }
        return s.t >= m.t + 10;
    };
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
 * 行き先へ押す（start の後）。詰まって手前で待機になった・味方に挟まれて止まった（far m より遠い）のを見たら押し直す（最大 n 回。
 * 人が画面で押し直すのと同じ）。stop が真になったら押し直さない（門が開いた後に門の前の持ち場へ戻さない）
 */
function go(id: string, x: number, z: number, start: Cond, j: J, n = 3, stop?: Cond, far = 25): Step[] {
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
    const isStuck = stuck(id);
    for (let k = 0; k < n; k++) {
        const d = j.d() + 2;
        const seen = new WeakMap<BattleState, number>();
        out.push([
            (s) => {
                if ((cnt.get(s) ?? 0) !== k + 1) return false;
                const u = unitById(s, id)!;
                const stk = isStuck(s);
                const ok = s.t >= sent.get(s)! + 3 && (idle(id)(s) || stk) && Math.hypot(u.x - x, u.z - z) > far && !(stop && stop(s));
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
    /** 外門が開いた時刻（開かなければ null） */
    gateT: number | null;
}

/** 台本を最後まで進める（each は刻みごと） */
function play(steps: Step[], each?: (s: BattleState) => void): Run {
    const s = createBattle(buildBattleSetup(SF, 'standard'));
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
    const g = s.field.gates[0]!;
    return { o, t: s.t, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused, cmds, gateT: g.open ? g.openedT : null };
}

const won = (r: Run) => r.o.result === 'victory' && r.o.objectives?.primary?.achieved === true;
const sec = (r: Run, id: string) => r.o.objectives!.secondary.find((x) => x.id === id)!.achieved;
/** 最後に戦える味方の部隊の数（守れる部隊） */
const standing = (r: Run) => r.o.units.filter((u) => u.side === 'ally' && u.status === 'ready').length;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const count = (rs: Run[], f: (r: Run) => boolean) => rs.filter(f).length;
function brief(r: Run): string {
    const s2 = r.o.objectives?.secondary.map((x) => `${x.id}:${x.achieved ? '✓' : '✗'}`).join(' ');
    return `${r.o.result}/${r.o.reason} t=${r.t.toFixed(1)} 門=${r.gateT?.toFixed(0)} loss=${(r.loss * 100).toFixed(1)}% ${s2} 残る部隊=${standing(r)} refused=${r.refused.join(',')}`;
}
/** 16 通り（揺らぎ k = 0〜15） */
function sixteen(plan: Plan): Run[] {
    return Array.from({ length: 16 }, (_, k) => play(plan(jitterOf(k))));
}

// ---------------------------------------------------------------- 作戦の台本

const opened: Cond = (s) => s.field.gates[0]!.open;
// 門の前の輪（x -24〜24・z -56〜-30）の中の持ち場。門の口の正面（x -10〜10）と、門へ向かう通り道をふさがない所（部隊の間は 18 m）
const F1: [number, number] = [-18, -50];
const F2: [number, number] = [17, -47];
const F3: [number, number] = [-6, -37];
// 曲輪の輪（中心 (0,-122)・半径 25 m）の中の持ち場
const B1: [number, number] = [-12, -118];
const B2: [number, number] = [12, -118];
const B3: [number, number] = [0, -134];
/** 輪の持ち場へ（出張りが崩れたのを見て。詰まったら押し直す。門が開いたら押し直さない） */
const toFront = (id: string, p: [number, number], j: J) => go(id, ...p, gone('e_sortie'), j, 3, opened, 8);

/**
 * 門が開いた後（どの作戦も同じ）：先頭の部隊 first が門の裏の槍へ当たり、斬り合ったのを見て rest が続き（門をくぐる所は 1 部隊ずつ。
 * くぐった後は横へ回れる）、石川隊が first を後詰めの差配で支える。門の裏の槍が崩れたら曲輪の槍へ。曲輪の槍が崩れたら輪の持ち場へ
 */
function inside(first: string, rest: string[], j: J): Step[] {
    const ids = [first, ...rest];
    const o: Step[] = [[w(opened, j), first, atk('e_gate_guard')]];
    for (const id of rest) o.push([w(engaged(first, 'e_gate_guard'), j), id, atk('e_gate_guard')]);
    o.push([w(engaged(first, 'e_gate_guard'), j), 'a_ishikawa', { abilityOn: first }]);
    for (const id of ids) o.push([w(gone('e_gate_guard'), j), id, atk('e_inner')]);
    const posts = [B1, B2, B3];
    ids.slice(0, 3).forEach((id, i) => o.push(...go(id, ...posts[i]!, gone('e_inner'), j)));
    return o;
}
const INSIDE_ORDER = ['a_sakai', 'a_kiba', 'a_sakakibara', 'a_ishikawa'];

/** 西の櫓の前の小さな林の中の弓の持ち場（林の中の部隊は 60 m まで見えない。西の櫓から 77 m・東の櫓・拠点の弓からは届かない） */
const GROVE: [number, number] = [-106, 0];
/** 弓：西の櫓の前の林へ入り、着いて待機になったのを見て西の櫓の弓を射る。西の櫓の弓が崩れたのを見て東の櫓の弓へ（林を出て射る） */
const archersFromGrove = (j: J): Step[] => [
    ...route('a_yumi', [GROVE], 0, j),
    [w(all(near('a_yumi', ...GROVE, 12), idle('a_yumi')), j), 'a_yumi', atk('e_tower_w')],
    [w(gone('e_tower_w'), j), 'a_yumi', atk('e_tower_e')],
];

/**
 * 側面の拠点を先に（BASTION）：酒井隊・榊原隊・騎馬で東へ回り、拠点の東の口から入って槍と弓を崩す（榊原隊は弓へ）。忠勝隊・石川隊は
 * 櫓の届かない所で待ち、弓は西の櫓の前の林から西の櫓を射る。拠点が崩れたのを見て、忠勝隊・石川隊・酒井隊で出張りへ。出張りが崩れたら
 * 門の前の輪を占める
 */
const BASTION: Plan = (j) => [
    ...squad(
        ['a_sakai', 'a_sakakibara', 'a_kiba'],
        [
            [
                [150, 40],
                [170, 45],
                [130, 45],
            ],
            [
                [140, 0],
                [160, 0],
                [150, -20],
            ],
        ],
        0,
        j,
    ),
    [w(near('a_sakai', 140, 0, 20), j), 'a_sakai', atk('e_bast_yari')],
    [w(near('a_sakai', 140, 0, 20), j), 'a_sakakibara', atk('e_bast_yumi')],
    [w(near('a_sakai', 140, 0, 20), j), 'a_kiba', atk('e_bast_yari')],
    [0, 'a_tadakatsu', tap(0, 85)],
    [0, 'a_ishikawa', tap(25, 95)],
    ...route('a_yumi', [GROVE], 0, j),
    [w(all(near('a_yumi', ...GROVE, 12), idle('a_yumi')), j), 'a_yumi', atk('e_tower_w')],
    [w(all(gone('e_bast_yari'), gone('e_bast_yumi')), j), 'a_tadakatsu', atk('e_sortie')],
    [w(all(gone('e_bast_yari'), gone('e_bast_yumi')), j), 'a_ishikawa', atk('e_sortie')],
    [w(all(gone('e_bast_yari'), gone('e_bast_yumi')), j), 'a_sakai', atk('e_sortie')],
    [w(gone('e_tower_w'), j), 'a_yumi', atk('e_tower_e')],
    ...toFront('a_tadakatsu', F1, j),
    ...toFront('a_ishikawa', F2, j),
    ...toFront('a_sakai', F3, j),
    ...inside('a_tadakatsu', INSIDE_ORDER, j),
];

/**
 * 準備した正面攻撃（FRONT）：弓は西の櫓の前の林から西の櫓の弓を射すくめ（崩れたら東の櫓へ）、ほかは櫓・拠点の弓の届かない所で待つ（予備の
 * 石川隊も）。西の櫓の弓が弱ったのを見て、槍・騎馬の 5 部隊で出張りへ一度に当たる。出張りが崩れたら、拠点の弓の届かない輪の西の側を
 * 忠勝隊・酒井隊で占め、騎馬・榊原隊・石川隊は拠点の弓の届かない西へよける。門が開いたら石川隊の後詰めの差配で支えて門の裏の槍へ
 */
const FRONT: Plan = (j) => {
    const ready = low('e_tower_w', 30);
    return [
        ...archersFromGrove(j),
        [0, 'a_tadakatsu', tap(0, 90)],
        [0, 'a_sakai', tap(-30, 90)],
        [0, 'a_ishikawa', tap(15, 105)],
        [0, 'a_kiba', tap(-55, 100)],
        [0, 'a_sakakibara', tap(30, 110)],
        [w(ready, j), 'a_tadakatsu', atk('e_sortie')],
        [w(ready, j), 'a_sakai', atk('e_sortie')],
        [w(ready, j), 'a_ishikawa', atk('e_sortie')],
        [w(ready, j), 'a_kiba', atk('e_sortie')],
        [w(ready, j), 'a_sakakibara', atk('e_sortie')],
        ...toFront('a_tadakatsu', F1, j),
        ...toFront('a_sakai', F3, j),
        [w(gone('e_sortie'), j), 'a_kiba', tap(-45, 10)],
        [w(gone('e_sortie'), j), 'a_sakakibara', tap(-20, 25)],
        [w(gone('e_sortie'), j), 'a_ishikawa', tap(-40, 30)],
        ...inside('a_tadakatsu', INSIDE_ORDER, j),
    ];
};

/** 急いで門へ（RUSH）：始めから槍・騎馬の 5 部隊で出張りへ。弓は道の上まで出る（待機の弓は届く一番近い敵を射る）。崩れたら輪を占める */
const RUSH: Plan = (j) => [
    [0, 'a_tadakatsu', atk('e_sortie')],
    [0, 'a_ishikawa', atk('e_sortie')],
    [0, 'a_sakai', atk('e_sortie')],
    [0, 'a_kiba', atk('e_sortie')],
    [0, 'a_sakakibara', atk('e_sortie')],
    [0, 'a_yumi', tap(0, 20)],
    ...toFront('a_tadakatsu', F1, j),
    ...toFront('a_ishikawa', F2, j),
    ...toFront('a_sakai', F3, j),
    ...inside('a_tadakatsu', INSIDE_ORDER, j),
];

/**
 * 準備なしの 5 隊の一斉（ALL5。確かめの担当が見つけた形。急いで門への 1 形として比べる）：弓も能力も使わず、槍・騎馬の 5 隊で 5 秒に出張りへ当たり、崩れたら 3 隊で輪を占め、
 * 門が開いたら 5 隊で門の裏の槍、崩れたら曲輪の槍、崩れたら曲輪の輪の持ち場へ（急いで門へ＝RUSH との違い：弓を前へ出さない・差配を使わない・
 * 門の裏の槍へ 5 隊が一度に当たる）
 */
const ALL5: Plan = (j) => {
    const ids = ['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_kiba', 'a_sakakibara'];
    const o: Step[] = ids.map((id) => [j.t(5), id, atk('e_sortie')] as Step);
    o.push(...toFront('a_tadakatsu', F1, j), ...toFront('a_ishikawa', F2, j), ...toFront('a_sakai', F3, j));
    for (const id of ids) o.push([w(opened, j), id, atk('e_gate_guard')]);
    for (const id of ids) o.push([w(gone('e_gate_guard'), j), id, atk('e_inner')]);
    const posts = [B1, B2, B3];
    ids.slice(0, 3).forEach((id, i) => o.push(...go(id, ...posts[i]!, gone('e_inner'), j)));
    return o;
};

/**
 * 急いで門へを部隊ごとに時刻をずらした形（無計画な攻めの比べは、同じ時刻に押す 1 形だけだとたまたまの結果になりやすいので、ずらした形を 2 通り
 * ずつ足す）。槍・騎馬の 5 部隊それぞれに、出張りのいる所（門の前の道 (0,-24)）を ids の順に offs 秒に押す（出張りが 20 m 以内にいればその
 * 攻撃、崩れて離れていればそこへの移動。画面と同じ）。あとは RUSH（弓は道の上まで出る・差配で支える）か ALL5（弓も能力も使わない）と同じ
 */
function staggered(ids: string[], offs: number[], withBow: boolean): Plan {
    return (j) => {
        const o: Step[] = ids.map((id, i) => [j.t(offs[i]!), id, tap(0, -24)] as Step);
        if (withBow) o.push([j.t(offs[5] ?? 0), 'a_yumi', tap(0, 20)]);
        o.push(...toFront('a_tadakatsu', F1, j), ...toFront('a_ishikawa', F2, j), ...toFront('a_sakai', F3, j));
        if (withBow) {
            o.push(...inside('a_tadakatsu', INSIDE_ORDER, j));
            return o;
        }
        for (const id of ids) o.push([w(opened, j), id, atk('e_gate_guard')]);
        for (const id of ids) o.push([w(gone('e_gate_guard'), j), id, atk('e_inner')]);
        const posts = [B1, B2, B3];
        ['a_tadakatsu', 'a_sakai', 'a_ishikawa'].forEach((id, i) => o.push(...go(id, ...posts[i]!, gone('e_inner'), j)));
        return o;
    };
}
/** 急いで門へ（ずらし A）：忠勝隊から 10 秒おきに（忠勝・石川・酒井・騎馬・榊原、弓は始めに道へ） */
const RUSH_STAG_A = staggered(['a_tadakatsu', 'a_ishikawa', 'a_sakai', 'a_kiba', 'a_sakakibara'], [0, 10, 20, 30, 40, 0], true);
/** 急いで門へ（ずらし B）：騎馬から先に（騎馬 0・榊原 5・酒井 10・石川 20・忠勝 30 秒、弓は 15 秒） */
const RUSH_STAG_B = staggered(['a_tadakatsu', 'a_ishikawa', 'a_sakai', 'a_kiba', 'a_sakakibara'], [30, 20, 10, 0, 5, 15], true);
/** 5 隊の一斉（ずらし A）：忠勝・酒井・石川・騎馬・榊原を 5・15・25・35・45 秒に */
const ALL5_STAG_A = staggered(['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_kiba', 'a_sakakibara'], [5, 15, 25, 35, 45], false);
/** 5 隊の一斉（ずらし B）：榊原・騎馬・石川・酒井・忠勝を 3・10・20・32・45 秒に */
const ALL5_STAG_B = staggered(['a_sakakibara', 'a_kiba', 'a_ishikawa', 'a_sakai', 'a_tadakatsu'], [3, 10, 20, 32, 45], false);

/** 無計画（UNPLANNED）：全部隊で門の前へ一斉、あとは 10 秒ごとに見えている一番近い敵へ当て直すだけ（地形を見ない。本陣は動かさない） */
const UNPLANNED: Plan = () => {
    const o: Step[] = [];
    for (const id of ['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_sakakibara', 'a_kiba', 'a_yumi']) {
        o.push([0, id, tap(0, -42)]);
        for (let t = 11; t < 660; t += 10) o.push([t, id, 'nearest']);
    }
    return o;
};

/** 待つ（HOLD）：命令を出さない */
const HOLD: Plan = () => [];

// ---------------------------------------------------------------- 能力の比べの台本

const RETREAT: Order = { type: 'retreat' };
const dist = (s: BattleState, a: string, b: string) => {
    const u = unitById(s, a)!;
    const v = unitById(s, b)!;
    return Math.hypot(u.x - v.x, u.z - v.z);
};

/**
 * 榊原の先駆けの号（騎馬で弓へ駆け込む）：相手の弓のいる所で価値が変わる。
 * - bastion：拠点の丘の上の弓へ（東の口から入れる）。
 * - towerOut：門が閉じたまま、外から東の櫓の弓へ（櫓台の石垣で、外からは上がれない・斬り合いも届かない）。
 * - towerIn：忠勝隊・石川隊・酒井隊で出張りを破って門を開け、開いたのを見て曲輪の中から東の櫓の弓へ（櫓の北は曲輪の側に開いている）。
 * van なら、攻撃の命令で相手まで 70 m に来たのを見て先駆け（揺らぎの乱数を同じ順に引くように、能力の行は最後に作る）
 */
function vanguard(where: 'bastion' | 'towerOut' | 'towerIn', van: boolean): Plan {
    const target = where === 'bastion' ? 'e_bast_yumi' : 'e_tower_e';
    return (j) => {
        const o: Step[] = [];
        if (where === 'towerIn') {
            o.push(
                [0, 'a_tadakatsu', atk('e_sortie')],
                [0, 'a_ishikawa', atk('e_sortie')],
                [0, 'a_sakai', atk('e_sortie')],
                [0, 'a_yumi', tap(-30, 160)],
                [0, 'a_kiba', tap(-60, 160)],
                [0, 'a_sakakibara', tap(40, 100)],
                ...toFront('a_tadakatsu', F1, j),
                ...toFront('a_ishikawa', F2, j),
                ...toFront('a_sakai', F3, j),
                [w(opened, j), 'a_tadakatsu', atk('e_gate_guard')],
                [w(opened, j), 'a_sakakibara', atk(target)],
            );
        } else o.push([0, 'a_sakakibara', atk(target)]);
        if (van) o.push([w((s) => unitById(s, 'a_sakakibara')!.order.type === 'attack' && dist(s, 'a_sakakibara', target) < 70, j), 'a_sakakibara', 'ability']);
        return o;
    };
}
interface Charge {
    /** 攻撃の命令から、相手の弓が崩れるまでの秒（崩れなければ null） */
    breakSec: number | null;
    /** 斬り合いが始まったか */
    reached: boolean;
    /** その間の榊原隊の兵の損害 */
    lost: number | null;
    refused: string[];
}
function charge(where: 'bastion' | 'towerOut' | 'towerIn', van: boolean, j: J): Charge {
    const target = where === 'bastion' ? 'e_bast_yumi' : 'e_tower_e';
    let t0 = -1;
    let s0 = 0;
    let tb = -1;
    let sb = 0;
    let reached = false;
    const r = play(vanguard(where, van)(j), (s) => {
        const u = unitById(s, 'a_sakakibara')!;
        if (t0 < 0 && u.order.type === 'attack' && u.order.targetId === target) {
            t0 = s.t;
            s0 = u.strength;
        }
        if (t0 >= 0 && u.engagedWith === target) reached = true;
        if (t0 >= 0 && tb < 0 && unitById(s, target)!.status !== 'ready') {
            tb = s.t;
            sb = u.strength;
        }
    });
    return { breakSec: tb < 0 ? null : tb - t0, reached, lost: tb < 0 ? null : s0 - sb, refused: r.refused };
}

/**
 * 忠勝の退路の守護：門の前で出張りと斬り合った酒井隊が、士気が 50 を切ったのを見て退く（撤退の命令）。退く道は櫓・拠点の矢の下で、
 * 出張りも追ってくる。guard なら、同じ時に忠勝隊（門の前の道の上 (10,30) で待つ）が守護を使う（能力の行は最後に作る）
 */
function rearguard(guard: boolean): Plan {
    return (j) => {
        const o: Step[] = [
            [0, 'a_sakai', atk('e_sortie')],
            [0, 'a_tadakatsu', tap(10, 30)],
            [w(low('a_sakai', 50), j), 'a_sakai', RETREAT],
        ];
        if (guard) o.push([w(low('a_sakai', 50), j), 'a_tadakatsu', 'ability']);
        return o;
    };
}
interface Withdraw {
    /** 撤退の命令の時刻 */
    t0: number;
    /** 退き始めてから 30 秒の酒井隊の損害 */
    sakaiLost: number;
    /** 同じ 30 秒の忠勝隊の損害 */
    tadakatsuLost: number;
    refused: string[];
}
function withdraw(guard: boolean, j: J): Withdraw {
    let t0 = -1;
    let a0 = 0;
    let b0 = 0;
    let a1 = -1;
    let b1 = -1;
    const r = play(rearguard(guard)(j), (s) => {
        const a = unitById(s, 'a_sakai')!;
        const b = unitById(s, 'a_tadakatsu')!;
        if (t0 < 0 && a.order.type === 'retreat') {
            t0 = s.t;
            a0 = a.strength;
            b0 = b.strength;
        }
        if (t0 >= 0 && a1 < 0 && s.t >= t0 + 30) {
            a1 = a.strength;
            b1 = b.strength;
        }
    });
    return { t0, sakaiLost: a0 - a1, tadakatsuLost: b0 - b1, refused: r.refused };
}

// ---------------------------------------------------------------- テスト

describe('城攻め前面のデータ', () => {
    it('検査を通る。主目標は段階目標（外門の制圧 → 最初の曲輪の確保。敵本陣の撃破ではない）。副目標 3 つ。部隊は上限以内（味方 7・敵 8・援軍なし）', () => {
        expect(validateField(SF)).toEqual([]);
        const p = SF.objectives.primary;
        expect(p.type).toBe('sequence');
        if (p.type !== 'sequence') throw new Error('sequence');
        expect(p.steps.map((x) => [x.id, x.type])).toEqual([
            ['siege_gate', 'open_gate'],
            ['siege_bailey', 'hold_point'],
        ]);
        const bailey = p.steps[1]!;
        expect(bailey.type === 'hold_point' && bailey.sec).toBe(45);
        expect(SF.objectives.secondary.map((x) => x.id)).toEqual(['siege_losses', 'siege_bastion', 'siege_cavalry']);
        const us = SF.presets[0]!.units;
        expect(us.filter((u) => u.side === 'ally').length).toBe(7);
        expect(us.filter((u) => u.side === 'enemy').length).toBe(8);
        expect(us.filter((u) => u.side === 'enemy').length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.enemy);
        expect(us.some((u) => u.reinforcement)).toBe(false);
        expect(SF.generalInitiative).toBe(true);
        // 門の制圧の条件：門の前の輪を 20 秒（説明にも同じ秒数）
        const g = SF.gates![0]!;
        expect([g.id, g.capture.sec]).toEqual(['outer_gate', 20]);
        expect(SF.briefing.some((t) => t.includes('20 秒続けて占める'))).toBe(true);
        // 城壁の破壊・梯子・攻城兵器の決まりは無い（特殊ルールは門をくぐる所の狭い正面だけ）
        expect((SF.specialRules ?? []).map((r) => r.type)).toEqual(['narrow_frontage']);
    });

    it('外門：閉じている間は通れず（曲輪へ道が無い）、開くと通れる（曲輪と、曲輪の側から櫓の上へ道ができる）', () => {
        const s = createBattle(buildBattleSetup(SF, 'standard'));
        for (const x of [-7.5, -2.5, 2.5, 7.5]) expect(passableAt(s, x, -62.5)).toBe(false);
        const nav0 = s.field.nav!;
        // 味方の本陣の前から門の前の輪へは行ける。曲輪・櫓の上へは行けない
        expect(reachable(nav0, 'yari', 0, 110, 0, -42)).toBe(true);
        expect(reachable(nav0, 'yari', 0, 110, 0, -122)).toBe(false);
        expect(reachable(nav0, 'kiba', 150, 130, 60, -62)).toBe(false);
        openAllGates(s.map, s.field);
        for (const x of [-7.5, -2.5, 2.5, 7.5]) expect(passableAt(s, x, -62.5)).toBe(true);
        expect(reachable(s.field.nav!, 'yari', 0, 110, 0, -122)).toBe(true);
        expect(reachable(s.field.nav!, 'kiba', 150, 130, 60, -62)).toBe(true);
    });

    it('射線：櫓の上の弓は門の前の輪をどこでも射る。櫓台のすぐ足元は射られない（死角）。拠点の弓は輪の東半分まで届き、西の端は届かない', () => {
        const s = createBattle(buildBattleSetup(SF, 'standard'));
        const tw = { x: -60, z: -62 };
        const te = { x: 60, z: -62 };
        for (const x of [-20, -10, 0, 10, 20]) {
            expect(hasLineOfSight(s, tw, { x, z: -45 })).toBe(true);
            expect(hasLineOfSight(s, te, { x, z: -45 })).toBe(true);
        }
        // 櫓台（石垣・高さ 6 m）のすぐ南は、その櫓から射られない。斬り合いも同じ判定なので、外から櫓の上の弓とは斬り合えない
        expect(hasLineOfSight(s, tw, { x: -60, z: -36 })).toBe(false);
        expect(hasLineOfSight(s, te, { x: 60, z: -36 })).toBe(false);
        // 拠点の弓（丘の上・射程 +20 m）：輪の東の端・真ん中へは届き、西の持ち場（-18,-50）へは届かない
        const by = unitById(s, 'e_bast_yumi')!;
        const reach = (x: number, z: number) => hasLineOfSight(s, by, { x, z }) && Math.hypot(by.x - x, by.z - z) <= bowRangeFor(s, by, { x, z });
        expect(reach(20, -40)).toBe(true);
        expect(reach(0, -44)).toBe(true);
        expect(reach(...F1)).toBe(false);
        // 閉じた門は矢を通さない（門の前から曲輪へ射られない）
        expect(hasLineOfSight(s, { x: 0, z: -45 }, { x: 0, z: -80 })).toBe(false);
    });

    it('西の櫓の前の小さな林：林の中の弓は西の櫓を射られる所にいるが、西の櫓からは見えない（60 m より遠い）。東の櫓・拠点の弓からは届かない。門の前の輪・門への道とは重ならない（状態を直接操作）', () => {
        const s = createBattle(buildBattleSetup(SF, 'standard'));
        const tw = unitById(s, 'e_tower_w')!;
        const yumi = unitById(s, 'a_yumi')!;
        expect([tw.strength, unitById(s, 'e_tower_e')!.strength]).toEqual([200, 200]);
        [yumi.x, yumi.z] = GROVE;
        const d = Math.hypot(tw.x - yumi.x, tw.z - yumi.z);
        expect(d).toBeGreaterThan(60);
        expect(d).toBeLessThanOrEqual(bowRangeFor(s, yumi, tw));
        expect(hasLineOfSight(s, yumi, tw)).toBe(true);
        for (let i = 0; i < 3; i++) stepBattle(s, RULES.tick);
        // 林の中の弓は櫓から見えない（射返されない）。弓からは櫓が見えている
        expect(yumi.seenBy.enemy).toBe(false);
        expect(tw.seenBy.ally).toBe(true);
        expect(issueOrder(s, 'a_yumi', atk('e_tower_w'))).toBe(true);
        for (let i = 0; i < 100; i++) stepBattle(s, RULES.tick);
        expect(tw.strength).toBeLessThan(200);
        expect(yumi.strength).toBe(350);
        // 東の櫓・拠点の弓（射程 +20 m の高所）からは届かない
        for (const id of ['e_tower_e', 'e_bast_yumi']) {
            const e = unitById(s, id)!;
            expect(Math.hypot(e.x - GROVE[0], e.z - GROVE[1]), id).toBeGreaterThan(bowRangeFor(s, e, { x: GROVE[0], z: GROVE[1] }));
        }
        // 林は門の前の輪（x -24〜24）・門へ向かう道（x -8〜8）から 60 m 以上離れている
        const grove = SF.terrain.filter((t) => t.kind === 'woods' && t.rect && inZone({ rect: t.rect }, ...GROVE));
        expect(grove.length).toBe(1);
        expect(-24 - grove[0]!.rect!.x1).toBeGreaterThanOrEqual(60);
    });

    it('側面の拠点：南と西（門の側）は柵で、口は東だけ（門の前の輪から拠点へは東へ回る）', () => {
        const s = createBattle(buildBattleSetup(SF, 'standard'));
        // 柵の筋（西 x 83・南 z 13）は通れない。東の口（x 160）は通れる
        for (const z of [-50, -30, -10, 10]) expect(passableAt(s, 82.5, z + 2.5)).toBe(false);
        for (const x of [90, 110, 130]) expect(passableAt(s, x + 2.5, 12.5)).toBe(false);
        expect(passableAt(s, 152.5, -12.5)).toBe(true);
        expect(inZone({ circle: { cx: 115, cz: -20, r: 36 } }, 125, -25)).toBe(true);
        expect(reachable(s.field.nav!, 'yari', 0, -42, 112, -15)).toBe(true);
    });
});

describe('作戦（早送り）', () => {
    const r = {
        bastion: play(BASTION(J0)),
        front: play(FRONT(J0)),
        rush: play(RUSH(J0)),
        unplanned: play(UNPLANNED(J0)),
        hold: play(HOLD(J0)),
    };

    // 第4群の釣り合いの直し（櫓の弓 150 → 200・西の櫓の前の小さな林。台本は弓を林へ・待つ所を拠点の弓の届かない所へ）の前：門 161 秒・勝ち 289 秒・22.5％・✓✓✓
    it('側面の拠点を先に：外門を開き、曲輪を確保して勝つ（段階 2／2。記録：門 160 秒・勝ち 289 秒・損害 26.2％・副目標 3 つとも ✓）', () => {
        expect(won(r.bastion), brief(r.bastion)).toBe(true);
        expect(r.bastion.o.objectives!.primary!.steps).toEqual({ done: 2, total: 2 });
        expect(sec(r.bastion, 'siege_bastion')).toBe(true);
    });

    // 釣り合いの直しの前：門 171 秒・勝ち 288 秒・27.8％・✓✗✓
    it('準備した正面攻撃（林の中の弓で西の櫓を射すくめてから全軍で出張りへ）：勝つ（記録：門 191 秒・勝ち 301 秒・損害 22.5％・✓✗✗）', () => {
        expect(won(r.front), brief(r.front)).toBe(true);
        expect(r.front.o.objectives!.primary!.steps).toEqual({ done: 2, total: 2 });
        expect(sec(r.front, 'siege_bastion')).toBe(false);
    });

    // 第3群の動きの直し（FieldRules.refinedMoves：閉じた門の外で敗走した出張りが、その場から逃れ去る・止まった味方の中のすり抜け など）の後、
    // この 1 通りは 386 秒・39.4％・副目標 ✗✗✗ → 211 秒・24.8％・損害 ✓（門は 80 秒のまま）。拠点の弓・騎馬を残すは ✗ のまま。
    // 第4群の釣り合いの直しの後：門 74 秒・185 秒・28.1％・✓✗✗（この 1 通りは損害 3 割を守るが、16 通りでは 2 回だけ。下の比べ）
    it('急いで門へ：門はいちばん早く開き、この 1 通りも勝つ（負けにしない）。準備した正面攻撃より損害が大きい（記録：門 74 秒・勝ち 185 秒・損害 28.1％・✓✗✗）', () => {
        expect(won(r.rush), brief(r.rush)).toBe(true);
        expect(r.rush.gateT!).toBeLessThan(r.bastion.gateT! - 60);
        expect(r.rush.gateT!).toBeLessThan(r.front.gateT! - 60);
        expect([sec(r.rush, 'siege_bastion'), sec(r.rush, 'siege_cavalry')], brief(r.rush)).toEqual([false, false]);
        expect(r.rush.loss).toBeGreaterThan(r.front.loss + 0.03);
    });

    // 押し離しの直し（sim.ts の separate：第3群の直しの戦場では、押す先までまっすぐ通れるときだけ押す）の前は、門の前で味方と重なった部隊が
    // 1 刻みに 12 m ほど押されて閉じた門の横の石垣を越え、曲輪の中へ抜けていた（e2e/fields-group3.mjs の見張りで見つけた）。
    // 無計画な攻撃は直しの前：門 205 秒・曲輪へ届かず 463 秒に総崩れ（ally_army_broken）・損害 63.0％・残る部隊 1。
    // 直しの後：門 195 秒・曲輪の確保（段階 2）の前に敵の諸隊をすべて崩して 439 秒に勝つ（enemy_army_broken。主目標は勝敗と同じで ✓、段は 1／2）・
    // 損害 53.4％・残る部隊 4。比べを「主目標まで届くか」から「段階 2 まで届くか・時間・損害・残る部隊」に直し、残る部隊の差を 3 → 2 にした
    // （準備した正面攻撃は 286 秒・27.7％・残る部隊 6 のまま）。
    // 第4群の釣り合いの直しの後：無計画は日没・38.4％・残る部隊 4（前は 31.7％・5）、準備した正面攻撃は 22.5％・7（前は 27.7％・6）。
    // 損害の幅を 2 点 → 10 点、残る部隊を「少ない」→「2 部隊以上少ない」に戻す
    it('比べ：準備した正面攻撃は、無計画な攻撃より損害が小さく、守れる部隊が多く、曲輪の確保（段階 2）まで届く（記録：無計画は門を開けず日没・損害 38.4％・残る部隊 4）', () => {
        expect(r.unplanned.loss).toBeGreaterThan(r.front.loss + 0.1);
        expect(standing(r.unplanned)).toBeLessThanOrEqual(standing(r.front) - 2);
        expect(r.unplanned.o.objectives!.primary!.steps!.done).toBeLessThan(2);
        expect(r.front.o.objectives!.primary!.steps).toEqual({ done: 2, total: 2 });
        // 記録（確かめの指摘への直しの後）：道の無い相手（櫓の上の弓・閉じた門の向こうの槍）への攻撃は断られるので、一番近い「斬りかかれる」敵へ
        // 当て直す（前は櫓台の足元で道が無いまま立ち続けた）。外の敵（出張り・拠点）を崩した後は当たれる敵がいなくなり、門の前の輪を
        // 占めないまま日没（門 ✗・段 0／2）。前は門を 195 秒に開き、曲輪の確保の前に敵の諸隊をすべて崩して 439 秒に
        // 勝っていた（enemy_army_broken・損害 53.4％・残る部隊 4）。直しの後は、取る目標（段階目標）のある合戦では敵がすべて崩れても、
        // 主目標を果たすまで勝ちにならない（sim.ts の needsOwnDeed）
        expect(r.unplanned.o.reason).toBe('nightfall');
        // 待つだけは日没（門は開かない・損害 0）
        expect([r.hold.o.reason, r.hold.loss, r.hold.gateT]).toEqual(['nightfall', 0, null]);
        expect(r.hold.o.objectives!.primary!.steps).toEqual({ done: 0, total: 2 });
    });

    it('台本は人が画面でできる程度：命令は 50 回以下、10 秒に 8 回以下。移動の後の向き（face）は使わない', () => {
        const more = { all5: play(ALL5(J0)), rushA: play(RUSH_STAG_A(J0)), rushB: play(RUSH_STAG_B(J0)), all5A: play(ALL5_STAG_A(J0)), all5B: play(ALL5_STAG_B(J0)) };
        for (const [k, x] of Object.entries({ ...r, ...more })) {
            expect(x.cmds.length, k).toBeLessThanOrEqual(50);
            const most = Math.max(0, ...x.cmds.map((t) => x.cmds.filter((y) => y >= t && y < t + 10).length));
            expect(most, k).toBeLessThanOrEqual(8);
        }
        for (const p of [BASTION, FRONT, RUSH, ALL5, RUSH_STAG_A, RUSH_STAG_B, ALL5_STAG_A, ALL5_STAG_B, UNPLANNED])
            for (const st of p(J0)) expect(typeof st[2] === 'object' && 'face' in st[2]).toBe(false);
    }, 60_000);
});

/*
 * 16 通りの比べ（第4群の釣り合いの直し。確かめの指摘 should-1「急いで門へと準備した正面攻撃の損害の差がほぼ消えた（平均 0.8 点・最大 1.3 点）」）。
 * 直したこと（データ）：櫓の弓 150 → 200（門の前の輪と、門が開いた後の門の裏・曲輪の手前を射る矢が、急いで当たる部隊に効くように）と、
 * 西の櫓の前の小さな林（中心 (-106,0)。林の中の部隊は 60 m まで見えないので、林の中の弓は西の櫓から射返されにくい）。台本：準備した正面攻撃の弓を
 * 林へ、待つ所を拠点の弓の届かない所へ（前の台本は弓を両方の櫓が届く (-45,12) に出し、榊原隊・石川隊を拠点の弓の届く (50,100)・(20,15) に
 * 待たせていた。拠点の弓だけで 16 通りの平均 178 の損害）。拠点を先にの弓も林から西の櫓を射る。
 * 前後の数字（16 通り。勝ち・勝ちの秒・門の秒・損害の平均（最小〜最大）・守れる部隊・副目標 損害／拠点／騎馬）：
 * | 作戦 | 直しの前（10ca516） | 直しの後 |
 * | 準備した正面攻撃 FRONT | 16・330・196・27.8（24.1〜31.2）・6.38・13／0／11 | 16・338・203・21.1（17.7〜25.7）・6.75・16／0／9 |
 * | 側面の拠点を先に BASTION | 16・368・214・28.9（24.3〜33.9）・6.44・12／16／6 | 16・361・205・31.0（28.2〜35.2）・6.44・7／16／9 |
 * | 急いで門へ RUSH | 16・217・81・28.5（25.2〜31.7）・6.75・14／0／0 | 16・218・81・31.8（28.9〜35.0）・6.63・2／0／0 |
 * | 5 隊の一斉 ALL5 | 16・210・89・28.3（22.5〜31.0）・5.88・13／0／3 | 16・210・88・32.5（26.3〜41.3）・5.50・1／0／3 |
 * | 急いで門へ・ずらし A | 16・247・102・38.7（35.5〜42.4）・6.56・0／0／5 | 16・251・102・45.0（41.1〜48.8）・6.00・0／0／2 |
 * | 急いで門へ・ずらし B | 16・251・97・36.0（29.0〜43.1）・5.63・1／0／0 | 16・256・97・41.6（32.8〜55.7）・5.38・0／0／0 |
 * | 5 隊の一斉・ずらし A | 16・218・107・28.2（22.3〜32.5）・6.69・11／0／7 | 16・219・108・32.2（26.1〜38.3）・6.63・4／0／6 |
 * | 5 隊の一斉・ずらし B | 16・227・107・29.9（25.8〜36.6）・6.00・10／0／0 | 16・232・108・35.3（30.7〜42.0）・5.75・0／0／0 |
 * （直しの前のずらしの 4 行は、今の台本を直しの前のデータで流した数字。直しの前の FRONT・BASTION は前の台本）
 * 台本だけ・データだけの分け：今の FRONT・BASTION の台本を直しの前のデータで流すと 20.0％（17.0〜25.6）・16／0／10、28.5％（23.7〜34.0）・12／16／9。
 * 準備した正面攻撃の損害の差の多くは台本（弓の置き場・待つ所）による。データ（櫓の弓 200・林）は、急ぐ形の損害を 3〜6 点上げ、損害 3 割を
 * 守れる回数を 10〜14 → 0〜4 に下げる（準備した方は 16 のまま）ことで、副目標の分かれを戻す。
 * 急いで門へ（どの形も）は 16 通りとも勝ち、門は 100 秒ほど早く開き、勝つのも 80 秒以上早い（一律の負けではない）。代わりに損害が 10 点ほど大きく、
 * 損害 3 割を守れるのは 16 通りで 0〜4 回（準備した正面攻撃は 16 回）。拠点を先には一番遅く、損害は急ぐ形と同じくらいだが、拠点の弓を必ず崩し、
 * 騎馬を残しやすい。
 */
describe('作戦の安定性と比べ（早送り・±15 秒と見てから押す遅れの 16 通り）', () => {
    const bastion = sixteen(BASTION);
    const front = sixteen(FRONT);
    const rush = sixteen(RUSH);
    const all5 = sixteen(ALL5);
    /** 急いで門へ（弓も能力も使わない 5 隊の一斉を含む。同じ時刻に押す 2 形と、部隊ごとに時刻をずらした 4 形） */
    const hurried: Record<string, Run[]> = {
        rush,
        all5,
        rushA: sixteen(RUSH_STAG_A),
        rushB: sixteen(RUSH_STAG_B),
        all5A: sixteen(ALL5_STAG_A),
        all5B: sixteen(ALL5_STAG_B),
    };
    const wins = (rs: Run[]) => count(rs, won);
    const winT = (rs: Run[]) => mean(rs.filter(won).map((x) => x.t));
    const gateT = (rs: Run[]) => mean(rs.map((x) => x.gateT ?? 660));
    const lossMean = (rs: Run[]) => mean(rs.map((x) => x.loss));
    const lossMax = (rs: Run[]) => Math.max(...rs.map((x) => x.loss));
    const n = (rs: Run[], id: string) => count(rs, (x) => sec(x, id));
    const stand = (rs: Run[]) => mean(rs.map(standing));

    // 釣り合いの直しの前は 12 勝以上（記録 16・16）。直しの後も 16・16 なので 15 勝以上にする
    it('主目標に届く作戦 2 つ：側面の拠点を先に・準備した正面攻撃は 16 通りで 15 勝以上（記録：16 勝・16 勝）', () => {
        expect(wins(bastion)).toBeGreaterThanOrEqual(15);
        expect(wins(front)).toBeGreaterThanOrEqual(15);
    }, 300000);

    it('急いで門へは一律の負けではない：同じ時刻に押す形も、部隊ごとに時刻をずらした形も 16 通りで 14 勝以上（記録：6 形とも 16 勝）', () => {
        for (const [k, rs] of Object.entries(hurried)) expect(wins(rs), k).toBeGreaterThanOrEqual(14);
    }, 600000);

    it('時間：急いで門へ（どの形も）は門が 60 秒以上早く開き、勝つのも 40 秒以上早い。拠点を先には遠回りの分いちばん遅い（記録：門 81〜108・203・205 秒、勝ち 210〜256・338・361 秒）', () => {
        for (const [k, rs] of Object.entries(hurried)) {
            expect(gateT(rs), k).toBeLessThan(gateT(front) - 60);
            expect(winT(rs), k).toBeLessThan(winT(front) - 40);
        }
        expect(gateT(front)).toBeLessThan(gateT(bastion));
        expect(winT(front)).toBeLessThan(winT(bastion));
    }, 300000);

    // 直しの前の幅：平均 +2 点・最大 +5 点（第3群の動きの直しの後）→ 味方同士の詰まりの直しの後、差が平均 0.8 点・最大 1.3 点に縮み、幅を外して
    // 向きだけにしていた。釣り合いの直しの後：平均の差は 10.7〜23.9 点、最大の差は 9.3〜30.0 点。幅を戻し、平均 +6 点・最大 +5 点にする
    it('損害：急いで門へ（どの形も）は準備した正面攻撃より損害が平均で 6 点以上大きく、悪い時も 5 点以上大きい（記録：準備 21.1％（最大 25.7）、急ぐ形 31.8〜45.0％（最大 35.0〜55.7））', () => {
        for (const [k, rs] of Object.entries(hurried)) {
            expect(lossMean(rs), k).toBeGreaterThan(lossMean(front) + 0.06);
            expect(lossMax(rs), k).toBeGreaterThan(lossMax(front) + 0.05);
        }
    }, 300000);

    it('守れる部隊：準備した正面攻撃は急ぐどの形より少なくなく、急ぐ形の平均より 0.4 部隊以上多い。拠点を先にも急ぐ形の平均より多い（記録：6.75・6.44 対 5.38〜6.63（平均 5.98））', () => {
        const avg = mean(Object.values(hurried).map(stand));
        for (const [k, rs] of Object.entries(hurried)) expect(stand(front), k).toBeGreaterThanOrEqual(stand(rs));
        expect(stand(front)).toBeGreaterThan(avg + 0.4);
        expect(stand(bastion)).toBeGreaterThan(avg);
        // 拠点を先にの損害は、急ぐ形の平均より小さい（記録：31.0％ 対 36.4％）
        expect(lossMean(bastion)).toBeLessThan(mean(Object.values(hurried).map(lossMean)) - 0.03);
    }, 300000);

    // 直しの前：損害 3 割以内は 拠点を先に 11・準備した正面攻撃 13・急いで門へ 14（「準備した正面攻撃がいちばん多い」が崩れ、急ぐ方との比べを外していた）。
    // 直しの後：16・7・急ぐ形 0〜4。急ぐ方との比べを戻し、幅を 8 回にする
    it('副目標が作戦で分かれる：拠点の弓は拠点を先にだけ（16／0／急ぐ形 0）、損害 3 割は準備した正面攻撃が急ぐどの形より 8 回以上多い（16 対 0〜4）、騎馬を残すのは急ぐどの形より準備・拠点を先にが多い（9・9 対 0〜6）', () => {
        expect([n(bastion, 'siege_bastion'), n(front, 'siege_bastion')]).toEqual([16, 0]);
        for (const [k, rs] of Object.entries(hurried)) {
            expect(n(rs, 'siege_bastion'), k).toBe(0);
            expect(n(front, 'siege_losses'), k).toBeGreaterThanOrEqual(n(rs, 'siege_losses') + 8);
            expect(n(front, 'siege_cavalry'), k).toBeGreaterThan(n(rs, 'siege_cavalry'));
            expect(n(bastion, 'siege_cavalry'), k).toBeGreaterThan(n(rs, 'siege_cavalry'));
        }
        expect(n(rush, 'siege_cavalry')).toBe(0);
        expect(n(front, 'siege_losses')).toBeGreaterThan(n(bastion, 'siege_losses'));
    }, 300000);
});

describe('武将の能力の価値が地形で変わる（早送り・16 通り）', () => {
    it('榊原の先駆けの号（騎馬で弓へ駆け込む）：拠点の丘の弓へは、使えば崩せ、使わなければ拠点の槍に横を突かれて崩れる。櫓の弓へは、外からは櫓台の石垣でどちらも届かない。曲輪の中からは門と曲輪を回る道が長く、20 秒の効果が着く前に切れて差は小さい', () => {
        const res = (where: 'bastion' | 'towerOut' | 'towerIn', van: boolean) => Array.from({ length: 16 }, (_, k) => charge(where, van, jitterOf(k)));
        const bOff = res('bastion', false);
        const bOn = res('bastion', true);
        // 拠点の丘：先駆けなしは 16 通りとも崩せない（榊原隊が先に崩れる）。先駆けありは 16 通りとも崩す（記録：25〜33 秒・損害 27〜76）
        expect(bOff.every((c) => c.breakSec === null)).toBe(true);
        expect(bOn.every((c) => c.breakSec !== null && c.breakSec < 40)).toBe(true);
        // 櫓（外から）：櫓台の石垣で斬り合いが届かない。先駆けを使っても同じ
        for (const c of [...res('towerOut', false), ...res('towerOut', true)]) expect([c.reached, c.breakSec]).toEqual([false, null]);
        // 曲輪の中から櫓へ：どちらも崩すが、先駆けの差は平均で数秒（記録：88.2 秒 → 86.0 秒。早まるのは 22 秒まで、遅れることもある）。
        // 第3群の動きの直し（閉じた門の外で敗走した出張りがその場から逃れ去る）の後は門の開く時刻が変わり、先駆けありの 1 通り（k=5）で、榊原隊が
        // 門をくぐって西の道へ回り、門の裏の槍に捕まって崩れる（櫓へ届かない）。16 通りとも崩す → 15 通り以上で崩す。平均は崩した通りで比べる
        // （直しの後：なし 75.1 秒・あり 74.6 秒（崩した 15 通り））
        const iOff = res('towerIn', false);
        const iOn = res('towerIn', true);
        const broke = (cs: Charge[]) => cs.filter((c) => c.breakSec !== null).map((c) => c.breakSec!);
        expect(broke(iOff).length).toBeGreaterThanOrEqual(15);
        expect(broke(iOn).length).toBeGreaterThanOrEqual(15);
        expect(Math.abs(mean(broke(iOff)) - mean(broke(iOn)))).toBeLessThan(6);
    }, 600000);

    it('忠勝の退路の守護（門の前で退く隊）：矢と出張りの追い討ちの下で退く酒井隊の損害が減る。代わりに忠勝隊が引きつけて削られる', () => {
        const off = Array.from({ length: 16 }, (_, k) => withdraw(false, jitterOf(k)));
        const on = Array.from({ length: 16 }, (_, k) => withdraw(true, jitterOf(k)));
        for (const x of on) expect(x.refused).toEqual([]);
        // 退き始めてから 30 秒の酒井隊の損害（記録：守護なし 24〜38・平均 34／守護あり 9〜38・平均 15）
        expect(mean(on.map((x) => x.sakaiLost))).toBeLessThan(mean(off.map((x) => x.sakaiLost)) - 10);
        // 同じ 30 秒の忠勝隊の損害（記録：55〜115 → 111〜144）
        expect(mean(on.map((x) => x.tadakatsuLost))).toBeGreaterThan(mean(off.map((x) => x.tadakatsuLost)));
    }, 600000);

});
