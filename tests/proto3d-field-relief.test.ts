/**
 * 戦場「援軍救出」（relief）の釣り合い（docs/fields-group4-design.md §3・§5、依頼本文 docs/fields-group4-request.md の「17. 援軍救出」）。
 * 主目標：孤立した浅井長政隊と合流し（長政隊とほかの味方が丘の上の合流の輪に一緒に 5 秒）、その後に長政隊を南の安全地点の輪まで連れ帰る
 * （rescue_escort。合流の輪と安全地点は別。長政隊の兵は最初の 4 割以上）。敵本陣の撃破ではない。
 * 丘を囲む敵勢は役割が違う：南の囲み（槍・強い。南の区域を守る）・東の囲み（騎馬。南の囲みの東）・西の囲み（槍。持ち場を保つが、矢を浴び
 * 続けると射手へ打って出て持ち場から 200 m まで追う＝弓で誘い出せる）。中央に押さえ（槍）、東の原に弓。4 分で北東から敵の援軍（槍）が丘へ。
 *
 * 合格条件は「正面なら負ける」ではなく、作戦どうしの比べ（損害・時間・副目標・守れる部隊）と、主目標に届く作戦の安定性。
 * 無計画な攻撃・待つだけの結果は記録として書く。
 *
 * どれも「早送り」：決まった時刻と「見てから押す」行で issueOrder・useAbility を出す台本を runToEnd で最後まで進める（画面の操作ではない）。
 * 「見てから押す」行の条件は 1 秒ごとに見る（人が画面を見て押す間隔。刻みごとには見ない）。
 * 台本は人が画面でできる程度の命令の数・間隔にしている（多くて 40 回・10 秒に多くて 8 回。下の it で確かめる）。移動の後の向き（face）は使わない。
 * 画面では敵の近くの地面を押すとその敵への攻撃になるので、台本の地面の行き先（tap）も、押す点の 20 m 以内に見えている敵がいればその敵への攻撃にする。
 * 人が画面でするのと同じ「見てから押す」行：着いたのを見て次の点を押す（道筋）、詰まって止まったら押し直す、囲みが崩れた・打って出た・
 * 合流したのを見て次を押す。
 *
 * 揺らぎ（16 通り）：時刻の行は ±15 秒（乱数の種 7 から。第2群・第3群のテストと同じ作り方）、「見てから押す」行には人が見てから押すまでの
 * 遅れ 0〜15 秒を足す（同じ乱数から。tests/proto3d-field-siege_front.test.ts と同じ作り方）。
 *
 * 今の結果（早送り。守れる部隊＝最後に戦える味方の部隊の数／8。副目標は 損害 1 割・長政隊 7 割・南の囲みを崩す）：
 * | 作戦 | 1 通り | 16 通り |
 * | 急いで直接救う＝準備した正面攻撃（DIRECT。騎馬で東の原の弓・4 部隊と弓で南の囲み・両翼の采配・後詰めの差配で長政隊を下げる） | 合流 110 秒・勝ち 190 秒・損害 13.8％・長政隊 87％・✗✓✓・7／8 | 16 勝・勝ち 251 秒（223〜281）・損害 13.9％（9.2〜17.6）・長政隊 85.3％・守れる 7.1・副目標 1／16／16 |
 * | 引き離してから救う（LURE。弓で西の囲みを誘い出し、西の筋の伏せで叩く。林の北の縁の騎馬が丘の西から合流） | 合流 168 秒・勝ち 284 秒・5.3％・87％・✓✓✗・8／8（西の囲みは持ち場から 133 m まで出た） | 16 勝・341 秒（325〜399）・6.6％（4.1〜8.3）・87.0％・守れる 8.0・副目標 16／16／0 |
 * | 無計画：全部隊で丘へ一斉、あとは 10 秒ごとに一番近い敵へ当て直すだけ（UNPLANNED） | 合流 187 秒・勝ち 286 秒・31.9％・長政隊 87％・✗✓✓・6／8 | 16 勝・295 秒（290〜301）・32.2％（31.9〜32.9）・87.1％・守れる 6.0・副目標 0／16／16 |
 * | 待つ（HOLD） | 始めの攻め手は丘の上の長政隊が退けるが、4 分の敵の援軍に攻められ、347 秒に兵が 4 割を切って負け（主目標の失敗） | |
 * 作戦の違い：急いで直接救うは合流が早く（平均 135 対 183 秒）、勝つのも 90 秒ほど早いが、強い南の囲みと東の囲みの騎馬と戦うので損害が倍
 * ほどで、損害 1 割を 16 通りで 1 回しか守れない（南の囲みを崩す副目標は果たす）。引き離してから救うは西の囲みを伏せへ引き込んで叩くだけで
 * 損害が小さく、8 部隊すべてが残るが、南の囲みは崩さない。無計画な攻撃も 16 通りで勝つが、中央の押さえ・東の原の弓・南の囲み・東の囲みと
 * 次々に正面から戦い、損害は準備した正面攻撃の 2 倍以上（32.2％ 対 13.9％）で、勝つのも遅く、守れる部隊も少ない。
 * 長政隊の兵は、どの作戦でも合流の前の丘の戦いで 87％ ほどになり、合流の後の退きでほとんど減らない（急いで直接救うで東の囲みに横を突かれた
 * 時だけ減る。1 通りの前の版では 71％）。
 *
 * 武将の能力の価値が場面で変わる比べ（同じ 16 通り）：
 * - 石川の後詰めの差配（長政隊の動き ×1.8・士気 +30・敗走の線 5・同盟なので士気の低下をさらに抑える）：
 *   追っ手のいない西の筋を下げるとき（引き離してから救う）は、使っても使わなくても 16 勝（勝ち 341 対 348 秒）。
 *   騎馬が丘へ向かうのを 240 秒まで待って合流が遅れ、敵の援軍が丘へ攻めかかる頃に重なると、使えば 14 勝・使わなければ 5 勝
 *   （長政隊の兵 58.7％ 対 52.3％）。東の原を下げる急いで直接救うでは、合流から安全地点までが 115.7 秒 → 使わないと 130.2 秒。
 * - 能力を使わなくても主目標に届く：酒井・石川の能力を使わない急いで直接救う 16 勝（271 秒・14.6％）、引き離してから救う 16 勝（348 秒・6.8％）。
 *
 * 救出の決まりの確かめ（早送り）：南の囲みを破った後に石川隊が合流の輪の縁へ入ってすぐ出る（一緒にいたのは 4 秒）・石川隊の後詰めの差配を
 * 長政隊に使うだけ・合流せずに撤退を命じる（安全地点の輪を通って退き口から離れる）のどれも、長政隊が安全地点の輪に入っても勝たない。
 * 合流した後でも、長政隊を丘に残せば敵の援軍に崩されて負ける。勝ちは、合流の後に長政隊が安全地点の輪へ入った刻み。
 *
 * 台本を書くときに気を付けたこと（エンジンの振る舞い）：
 * - 通れない所の無い戦場でも道探しの格子（pathfinding）を付けた。格子が無いと味方同士の詰まりの決まり（RULES.allyBlockSec の短い迂回・
 *   すり抜け）が働かず、止まっている味方 2 部隊の間を抜けられない部隊が「道を塞がれて先へ進めない」で止まる（sim.ts の allyOnlyBlock は格子が要る）。
 * - 動く部隊は止まっている味方をよけて横へずれる（15〜20 m）。押さえ・囲みの区域のすぐ横を通る道筋は、ずれた分だけ区域に入って斬りかかられる。
 *   区域の縁から 20 m 以上離した道筋にし、待つ部隊は通り道の上に置かない。
 * - 騎馬を先に南の囲みへ当てると、東の囲みの騎馬に横を突かれて崩れる。騎馬は忠勝隊が斬り合ってから当てる。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, isActive, issueOrder, meleeUnreachable, runToEnd, unitById, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { inZone } from '../proto3d/src/battle/fieldRules';
import { buildBattleSetup, getField, validateField } from '../proto3d/src/battle/fields';
import { endRuleBriefingLine } from '../proto3d/src/battle/objectives';
import { practiceBriefingInfo } from '../proto3d/src/campaign/practice';
import type { BattleOutcome, Order, Zone } from '../proto3d/src/battle/types';

const RF = getField('relief')!;
const PRIMARY = RF.objectives.primary as Extract<(typeof RF)['objectives']['primary'], { type: 'rescue_escort' }>;
const MEET: Zone = PRIMARY.meetZone;
const SAFE: Zone = PRIMARY.safeZone;

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
/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]、または [条件, 部隊 id, 命令]（見てから押す。条件が初めて真になった 1 秒ごとの見回りに 1 回） */
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
/** 部隊が (x, z) から r m より遠い（持ち場を離れた） */
const away =
    (id: string, x: number, z: number, r: number): Cond =>
    (s) => {
        const u = unitById(s, id);
        return !!u && isActive(u) && Math.hypot(u.x - x, u.z - z) > r;
    };
/** 部隊 a と b がどちらも戦えて r m 以内 */
const close =
    (a: string, b: string, r: number): Cond =>
    (s) => {
        const u = unitById(s, a);
        const v = unitById(s, b);
        return !!u && !!v && isActive(u) && isActive(v) && Math.hypot(u.x - v.x, u.z - v.z) <= r;
    };
/** 部隊が（その敵と）斬り合っている */
const engaged =
    (id: string, enemy?: string): Cond =>
    (s) => {
        const u = unitById(s, id);
        return !!u && (enemy ? u.engagedWith === enemy : !!u.engagedWith);
    };
/** 敵の部隊が誰かと斬り合っている */
const fighting =
    (id: string): Cond =>
    (s) => {
        const u = unitById(s, id);
        return !!u && isActive(u) && !!u.engagedWith;
    };
/** 部隊が待機している（移動の行き先に着いた・攻撃の相手が崩れた。斬り合っていない） */
const idle =
    (id: string): Cond =>
    (s) => {
        const u = unitById(s, id);
        return !!u && isActive(u) && u.order.type === 'hold' && !u.engagedWith;
    };
/** 合流した（画面の知らせ「…と合流した。安全地点（輪）まで連れ帰る」） */
const met: Cond = (s) => s.objectives!.primary!.metT !== null;
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
/**
 * 行き先へ押す（start の後）。手前で待機になった・詰まって止まった（far m より遠い）のを見たら押し直す（最大 n 回。人が画面で押し直すのと同じ）。
 * stop が真になったら押し直さない
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
    /** 味方の兵の損害の割合（0〜1。長政隊を含む） */
    loss: number;
    /** 部隊ごとの兵の残り */
    left: Record<string, number>;
    /** 断られた命令 */
    refused: string[];
    /** 出した命令の時刻（人が画面で出せる数・間隔か見る） */
    cmds: number[];
    /** 合流した時刻（合流しなければ null） */
    metT: number | null;
    /** 長政隊が安全地点の輪に初めて入った時刻（null なら入っていない）と、そのとき合流していたか */
    safeT: number | null;
    safeAfterMeet: boolean | null;
    /** 長政隊の兵の割合（終わりに。0〜1） */
    nagaRatio: number;
    s: BattleState;
}

/** 台本を最後まで進める。見てから押す行の条件は 1 秒ごとに見る（each は刻みごと） */
function play(steps: Step[], each?: (s: BattleState) => void): Run {
    const s = createBattle(buildBattleSetup(RF, 'standard'));
    const timed = steps.filter((x) => typeof x[0] === 'number').sort((a, b) => (a[0] as number) - (b[0] as number));
    const watch = steps.filter((x) => typeof x[0] === 'function');
    const fired = new Set<number>();
    const refused: string[] = [];
    const cmds: number[] = [];
    let safeT: number | null = null;
    let safeAfterMeet: boolean | null = null;
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
        // 見てから押す行は 1 秒ごとに見る（10 刻みごと）
        if (st.tick % 10 === 0) {
            watch.forEach(([cond, id, ord], i) => {
                if (fired.has(i) || !(cond as Cond)(st)) return;
                fired.add(i);
                run(st, `when${i}@${st.t.toFixed(1)}`, id, ord);
            });
        }
        const n = unitById(st, 'a_nagamasa')!;
        if (safeT === null && isActive(n) && inZone(SAFE, n.x, n.z)) {
            safeT = st.t;
            safeAfterMeet = st.objectives!.primary!.metT !== null;
        }
        each?.(st);
    });
    // 安全地点の輪へ入った刻みに果たして終わったとき（runToEnd はその刻みの後に each を呼ばない）
    const nEnd = unitById(s, 'a_nagamasa')!;
    if (safeT === null && isActive(nEnd) && inZone(SAFE, nEnd.x, nEnd.z)) {
        safeT = s.t;
        safeAfterMeet = s.objectives!.primary!.metT !== null;
    }
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    const n = o.units.find((u) => u.id === 'a_nagamasa')!;
    return {
        o,
        t: s.t,
        loss,
        left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])),
        refused,
        cmds,
        metT: s.objectives!.primary!.metT,
        safeT,
        safeAfterMeet,
        nagaRatio: n.endStrength / n.startStrength,
        s,
    };
}

const won = (r: Run) => r.o.result === 'victory' && r.o.objectives?.primary?.achieved === true;
const sec = (r: Run, id: string) => r.o.objectives!.secondary.find((x) => x.id === id)!.achieved;
/** 最後に戦える味方の部隊の数（守れる部隊。長政隊を含めて 8 部隊のうち） */
const standing = (r: Run) => r.o.units.filter((u) => u.side === 'ally' && u.status === 'ready').length;
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const count = (rs: Run[], f: (r: Run) => boolean) => rs.filter(f).length;
/** 10 秒のうちに出した命令の数の最大 */
const densest = (r: Run) => Math.max(0, ...r.cmds.map((t) => r.cmds.filter((u) => u >= t - 1e-9 && u < t + 10 - 1e-9).length));
function brief(r: Run): string {
    const s2 = r.o.objectives?.secondary.map((x) => `${x.id}:${x.achieved ? '✓' : '✗'}`).join(' ');
    return `${r.o.result}/${r.o.reason} t=${r.t.toFixed(1)} 合流=${r.metT?.toFixed(0)} loss=${(r.loss * 100).toFixed(1)}% 長政隊=${(r.nagaRatio * 100).toFixed(0)}% ${s2} 残る部隊=${standing(r)} refused=${r.refused.join(',')}`;
}
/** 16 通り（揺らぎ k = 0〜15） */
function sixteen(plan: Plan): Run[] {
    return Array.from({ length: 16 }, (_, k) => play(plan(jitterOf(k))));
}
/** 同じ台本の結果を何度も使うので覚えておく */
const memo = new Map<string, Run[]>();
function sixteenOf(name: string, plan: Plan): Run[] {
    if (!memo.has(name)) memo.set(name, sixteen(plan));
    return memo.get(name)!;
}
/** 16 通りの要約（テストの失敗の文・記録） */
function summary(rs: Run[]): string {
    const ws = rs.filter(won);
    const ts = ws.map((r) => r.t);
    const pct = (v: number) => (v * 100).toFixed(1);
    return (
        `${ws.length} 勝・勝ち ${mean(ts).toFixed(0)} 秒（${Math.min(...ts).toFixed(0)}〜${Math.max(...ts).toFixed(0)}）・損害 ${pct(mean(rs.map((r) => r.loss)))}％` +
        `（${pct(Math.min(...rs.map((r) => r.loss)))}〜${pct(Math.max(...rs.map((r) => r.loss)))}）・長政隊 ${pct(mean(rs.map((r) => r.nagaRatio)))}％・守れる ${mean(rs.map(standing)).toFixed(1)}` +
        `・副目標 ${count(rs, (r) => sec(r, 'relief_losses'))}／${count(rs, (r) => sec(r, 'relief_keep'))}／${count(rs, (r) => sec(r, 'relief_break'))}` +
        `・結果 ${[...new Set(rs.map((r) => r.o.reason))].join(',')}`
    );
}

/** RELIEF_LOG=1 で数字を出す（テストの見出しの表を作るとき） */
const LOG = !!(globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.RELIEF_LOG;
const log = (...a: unknown[]) => LOG && console.log(...a);

// ---------------------------------------------------------------- 作戦の台本

/**
 * 急いで直接救う＝準備した正面攻撃（DIRECT）：東の原を上がる。榊原隊（騎馬）で東の原の弓を先に崩し、忠勝隊・酒井隊・石川隊と弓で南の囲みへ
 * 一度に当たり、酒井隊の両翼の采配で挟み、榊原隊・騎馬も加わる。南の囲みが崩れたら榊原隊・酒井隊を丘の南の斜面へ上げて合流し、石川隊の
 * 後詰めの差配で長政隊を速く退かせ、東の原から安全地点へ下げる（残りの部隊は東の囲みとの間に立つ）
 */
/** 急いで直接救うの前半：東の原を上がって東の原の弓を崩し、南の囲みを一度に破る（ここまでは合流しない） */
const directPrep = (j: J): Step[] => {
    const ready = all(gone('e_block_yumi'), at(j.t(40)));
    return [
        [0, 'a_sakakibara', atk('e_block_yumi')],
        [0, 'a_kiba', tap(95, 0)],
        [0, 'a_sakai', tap(60, 15)],
        [0, 'a_ishikawa', tap(85, 20)],
        [0, 'a_tadakatsu', tap(50, 30)],
        [0, 'a_yumi', tap(60, 40)],
        [w(ready, j), 'a_tadakatsu', atk('e_ring_s')],
        [w(ready, j), 'a_sakai', atk('e_ring_s')],
        [w(ready, j), 'a_ishikawa', atk('e_ring_s')],
        [w(ready, j), 'a_yumi', atk('e_ring_s')],
        [w(engaged('a_tadakatsu'), j), 'a_sakai', 'ability'],
        [w(engaged('a_tadakatsu'), j), 'a_sakakibara', atk('e_ring_s')],
        [w(engaged('a_tadakatsu'), j), 'a_kiba', atk('e_ring_s')],
    ];
};
const DIRECT: Plan = (j) => [
    ...directPrep(j),
    ...go('a_sakakibara', 60, -125, gone('e_ring_s'), j, 3, met, 15),
    ...go('a_sakai', 50, -110, gone('e_ring_s'), j, 3, met, 15),
    [w(met, j), 'a_ishikawa', { abilityOn: 'a_nagamasa' }],
    ...route('a_nagamasa', [[50, -60], [40, 60], [20, 170]], met, j),
    [w(met, j), 'a_sakakibara', tap(75, -60)],
    [w(met, j), 'a_tadakatsu', tap(95, -50)],
    [w(met, j), 'a_sakai', tap(80, -75)],
];

/**
 * 引き離してから救う（LURE）：弓が西の筋を上がって西の囲みを射る（矢を嫌って打って出る）。打って出た囲みが近づいたのを見て、弓は西の筋を
 * 南へ下がり、忠勝隊（林の縁）と酒井隊の間へ引き込む。囲みが誰かと斬り合ったのを見て忠勝隊・酒井隊が当たり、酒井隊は両翼の采配。
 * 榊原隊と騎馬は林の北の縁に隠れて待ち、西の囲みが持ち場から離れたのを見て丘の西から入って合流する。石川隊（林の縁）が後詰めの差配で
 * 長政隊を速く退かせ、長政隊は西の筋を下って安全地点へ。
 * late を渡すと、騎馬が丘へ向かうのを late 秒まで待つ（遅れた合流。敵の援軍が丘へ攻めかかる頃に重なる）。abil = false なら差配を使わない
 */
const lure =
    (lateSec?: number, abil = true): Plan =>
    (j) => [
        ...route('a_yumi', [[-58, 40], [-58, -45]], 0, j),
        [w(near('a_yumi', -58, -45, 15), j), 'a_yumi', atk('e_ring_w')],
        [w(close('a_yumi', 'e_ring_w', 85), j), 'a_yumi', tap(-58, 90)],
        [0, 'a_tadakatsu', tap(-68, -5)],
        [0, 'a_sakai', tap(-44, 5)],
        ...route('a_ishikawa', [[-60, 60], [-82, -45]], 0, j),
        ...route('a_kiba', [[-70, 70], [-90, -95]], 0, j),
        ...route('a_sakakibara', [[-60, 90], [-95, -115]], 0, j),
        [w(fighting('e_ring_w'), j), 'a_sakai', atk('e_ring_w')],
        [w(fighting('e_ring_w'), j), 'a_tadakatsu', atk('e_ring_w')],
        [w(engaged('a_sakai', 'e_ring_w'), j), 'a_sakai', 'ability'],
        [w(lateSec ? at(lateSec) : away('e_ring_w', -35, -150, 110), j), 'a_sakakibara', tap(30, -135)],
        [w(lateSec ? at(lateSec) : away('e_ring_w', -35, -150, 110), j), 'a_kiba', tap(20, -155)],
        ...(abil ? ([[w(met, j), 'a_ishikawa', { abilityOn: 'a_nagamasa' }]] as Step[]) : []),
        ...route('a_nagamasa', [[-30, -125], [-58, -20], [-50, 100], [-5, 170]], met, j),
        ...route('a_sakakibara', [[-20, -140], [-45, -40], [-35, 100], [15, 165]], met, j),
        ...route('a_kiba', [[-45, -110], [-70, -20], [-65, 100], [-25, 160]], met, j),
    ];
const LURE = lure();

const MELEE = ['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_sakakibara', 'a_kiba', 'a_yumi'];
/** 無計画（UNPLANNED）：全部隊で丘へ一斉、あとは 10 秒ごとに見えている一番近い敵へ当て直すだけ。合流の知らせを見たら長政隊を安全地点へ */
const UNPLANNED: Plan = (j) => {
    const o: Step[] = [];
    for (const id of MELEE) {
        o.push([0, id, tap(HILL_X, HILL_Z)]);
        for (let t = 10; t < 600; t += 10) o.push([t, id, 'nearest']);
    }
    o.push([w(met, j), 'a_nagamasa', tap(0, 175)]);
    return o;
};
const HILL_X = 60;
const HILL_Z = -150;

/** 台本から、ある部隊の能力の行を除く（能力を使わない比べ） */
const without =
    (p: Plan, unit: string): Plan =>
    (j) =>
        p(j).filter((r) => !(r[1] === unit && (r[2] === 'ability' || (typeof r[2] === 'object' && 'abilityOn' in r[2]))));

// ---------------------------------------------------------------- データ

describe('援軍救出のデータ', () => {
    it('検査を通る。主目標は救出の護送（合流の輪と安全地点は別。兵 4 割以上）。副目標 3 つ。部隊は上限以内（味方 7＋救出の対象 1・敵 9＝援軍 1 を含む）', () => {
        expect(validateField(RF)).toEqual([]);
        expect(PRIMARY).toMatchObject({ type: 'rescue_escort', unitId: 'a_nagamasa', minRatio: 0.4, meetSec: 5 });
        expect(inZone(MEET, 0, 175)).toBe(false);
        expect(inZone(SAFE, HILL_X, HILL_Z)).toBe(false);
        expect(RF.objectives.secondary.map((x) => x.type)).toEqual(['limit_losses', 'preserve_unit', 'break_unit']);
        const units = RF.presets[0]!.units;
        expect(units.filter((u) => u.side === 'ally')).toHaveLength(8);
        expect(units.filter((u) => u.side === 'enemy')).toHaveLength(9);
        expect(units.filter((u) => u.reinforcement).map((u) => u.id)).toEqual(['e_late']);
        expect(RF.reinforcements!.find((r) => r.id === 'late')!.at).toBe(240);
    });

    it('出陣前の説明：救出の条件（生存と兵 4 割以上）・合流の前に下げても数えないこと・判定の順を出す', () => {
        const s = createBattle(buildBattleSetup(RF, 'standard'));
        const line = endRuleBriefingLine(s.setup)!;
        expect(s.setup.briefing[s.setup.briefing.length - 1]).toBe(line);
        expect(line).toContain('① 主目標「長政隊と合流し、南の安全地点まで連れ帰る（兵 4 割以上）」を果たす → 勝利');
        const info = practiceBriefingInfo(RF);
        expect(info.primary).toContain('兵 4 割以上');
        expect(info.terrain.join('')).toContain('崩れる・撤退する・兵が 4 割を切ると負け');
        expect(info.terrain.join('')).toContain('合流の前に長政隊だけを下げても数えない');
        expect(info.endRules).toHaveLength(6);
    });

    it('丘の囲みの役割：南の囲みは区域を守り、西の囲みは持ち場を保ち（弓で誘い出せる）、持ち場は丘の上の長政隊から 90 m より離れている', () => {
        const ring = (id: string) => RF.presets[0]!.units.find((u) => u.id === id)!;
        expect(ring('e_ring_s').aiRole).toBe('hold_zone');
        expect(ring('e_ring_e')).toMatchObject({ aiRole: 'hold_zone', kind: 'kiba' });
        expect(ring('e_ring_w')).toMatchObject({ aiRole: 'hold_line', aiLeash: 200 });
        const slot = RF.deployments.enemy.find((d) => d.id === 'ring_w')!;
        expect(Math.hypot(slot.x - HILL_X, slot.z - HILL_Z)).toBeGreaterThan(90);
    });
});

// ---------------------------------------------------------------- 救出の決まり（早送り）

describe('救出の決まり：接触だけ・能力だけでは救出にならない、合流の後に安全地点へ入って初めて果たす（早送り）', () => {
    it('触れただけ：南の囲みを破った後、石川隊が合流の輪の縁へ入って長政隊に触れ、すぐ出る。長政隊だけを安全地点へ下げても、合流にならず勝たない', () => {
        let most = 0;
        let touched = false;
        const inMeet: Cond = (s) => {
            const u = unitById(s, 'a_ishikawa')!;
            const inside = isActive(u) && inZone(MEET, u.x, u.z);
            touched = touched || inside;
            return inside;
        };
        const leftMeet: Cond = (s) => touched && !inMeet(s);
        const r = play(
            [
                ...directPrep(J0),
                [w(gone('e_ring_s'), J0), 'a_ishikawa', tap(60, -108)],
                [inMeet, 'a_ishikawa', tap(60, -60)],
                ...route('a_nagamasa', [[50, -60], [40, 60], [20, 170]], leftMeet, J0),
            ],
            (s) => (most = Math.max(most, s.objectives!.primary!.sec)),
        );
        // 合流の輪に一緒にいたのは 5 秒に満たない（数え始めたが、離れて 0 に戻った）
        log('touch', most, brief(r));
        expect(touched).toBe(true);
        expect(most).toBeGreaterThan(0);
        expect(most).toBeLessThan(5);
        expect(r.metT).toBeNull();
        expect(r.safeT).not.toBeNull();
        expect(r.safeAfterMeet).toBe(false);
        expect(r.o.result).not.toBe('victory');
        expect(r.o.objectives?.primary).toMatchObject({ achieved: false, met: false });
    }, 20_000);

    it('能力だけ：南の囲みを破った後、石川隊の後詰めの差配（180 m）を長政隊に使い、長政隊だけを安全地点へ走らせても、合流にならず勝たない', () => {
        const r = play([
            ...directPrep(J0),
            [w(gone('e_ring_s'), J0), 'a_ishikawa', { abilityOn: 'a_nagamasa' }],
            ...route('a_nagamasa', [[50, -60], [40, 60], [20, 170]], gone('e_ring_s'), J0),
        ]);
        expect(r.s.events.some((e) => e.text.startsWith('石川数正隊：「後詰めの差配」— 浅井長政隊'))).toBe(true);
        expect(r.metT).toBeNull();
        expect(r.safeT).not.toBeNull();
        expect(r.safeAfterMeet).toBe(false);
        expect(r.o.result).not.toBe('victory');
        expect(r.o.objectives?.primary).toMatchObject({ achieved: false, met: false });
    }, 20_000);

    it('撤退の命令で退かせる：南の囲みを破った後、合流せずに長政隊を東の原から下げて撤退を命じると、安全地点の輪を通って退き口から戦場を離れるが、救出にならず負け（主目標の失敗）', () => {
        const r = play([
            ...directPrep(J0),
            ...route('a_nagamasa', [[50, -60], [40, 60]], gone('e_ring_s'), J0),
            [w(near('a_nagamasa', 40, 60, 15), J0), 'a_nagamasa', { type: 'retreat' }],
        ]);
        expect(r.metT).toBeNull();
        expect(r.safeAfterMeet).toBe(false);
        expect([r.o.result, r.o.reason]).toEqual(['defeat', 'objective_failed']);
        expect(r.o.units.find((u) => u.id === 'a_nagamasa')!.status).toBe('withdrawn');
        expect(r.o.objectives?.primary).toMatchObject({ achieved: false, met: false });
    }, 20_000);

    it('撤退の命令（囲みの中で）：囲みを破らずに長政隊だけに撤退を命じると、南の囲みに後ろを突かれ、兵が 4 割を切って負け（記録：34 秒）', () => {
        const r = play([[5, 'a_nagamasa', { type: 'retreat' }]]);
        expect([r.o.result, r.o.reason]).toEqual(['defeat', 'objective_failed']);
        expect(r.t).toBeLessThan(60);
        expect(r.metT).toBeNull();
    });

    it('待つ：長政隊は丘で始めの攻め手を退けるが、4 分の敵の援軍に攻められて兵が 4 割を切り、主目標の失敗で負け（記録：347 秒・長政隊 40％）', () => {
        const r = play([]);
        expect([r.o.result, r.o.reason]).toEqual(['defeat', 'objective_failed']);
        expect(r.nagaRatio).toBeLessThan(0.4 + 0.005);
        expect(r.o.units.find((u) => u.id === 'a_nagamasa')!.status).toBe('ready');
        expect(r.metT).toBeNull();
        // 援軍が来るまでは、長政隊は丘で持ちこたえている（始めの攻め手を退けた後の兵）
        const before = play([], (s) => {
            if (Math.abs(s.t - 239) < 0.05) expect(unitById(s, 'a_nagamasa')!.strength / 420).toBeGreaterThan(0.8);
        });
        expect(before.t).toBeGreaterThan(300);
    });

    it('合流しても、安全地点へ入るまでは果たさない。入った刻みに果たして勝つ（急いで直接救う 1 通り）', () => {
        const r = play(DIRECT(J0), (s) => {
            const n = unitById(s, 'a_nagamasa')!;
            if (s.objectives!.primary!.metT !== null && !inZone(SAFE, n.x, n.z)) expect(s.result).toBeNull();
        });
        expect(won(r)).toBe(true);
        expect(r.metT).not.toBeNull();
        expect(r.safeAfterMeet).toBe(true);
        expect(r.safeT).not.toBeNull();
        expect(r.o.elapsedSec).toBeCloseTo(r.safeT!, 0);
        expect(r.metT!).toBeLessThan(r.safeT!);
        expect(r.o.objectives?.primary).toMatchObject({ type: 'rescue_escort', achieved: true, met: true });
    }, 20_000);

    it('合流しても下げなければ果たさない：急いで直接救うで合流した後、長政隊を丘に残して救い手が下がると、4 分の敵の援軍に攻められて兵が 4 割を切り、主目標の失敗（敗北）', () => {
        const r = play(DIRECT(J0).filter((x) => x[1] !== 'a_nagamasa' && x[1] !== 'a_ishikawa'));
        expect(r.metT).not.toBeNull();
        expect(r.safeT).toBeNull();
        expect([r.o.result, r.o.reason]).toEqual(['defeat', 'objective_failed']);
        expect(r.t).toBeGreaterThan(RF.reinforcements![0]!.at);
        expect(r.o.objectives?.primary).toMatchObject({ achieved: false, met: true });
    }, 20_000);
});

// ---------------------------------------------------------------- 作戦


describe('作戦（早送り・1 通り）', () => {
    const direct = () => play(DIRECT(J0));
    it('急いで直接救う（準備した正面攻撃：騎馬で弓を崩し、4 部隊と弓・両翼の采配で南の囲みを破り、後詰めの差配で長政隊を下げる）：勝つ', () => {
        const r = direct();
        log('DIRECT 1', brief(r), r.cmds.length, densest(r));
        expect(won(r)).toBe(true);
        expect(sec(r, 'relief_break')).toBe(true);
    }, 20_000);

    it('引き離してから救う（弓で西の囲みを誘い出し、西の筋の伏せで叩く。林の北の縁の騎馬が丘の西から合流）：勝つ。西の囲みは矢を嫌って打って出て、持ち場から 110 m より遠くへ出る', () => {
        let far = 0;
        const r = play(LURE(J0), (s) => {
            const u = unitById(s, 'e_ring_w')!;
            if (isActive(u)) far = Math.max(far, Math.hypot(u.x + 35, u.z + 150));
        });
        log('LURE 1', brief(r), r.cmds.length, densest(r), far.toFixed(0));
        expect(won(r)).toBe(true);
        expect(r.s.events.some((e) => e.text === '敵勢の丘の西の囲みが矢を嫌って打って出た')).toBe(true);
        expect(far).toBeGreaterThan(110);
        expect(sec(r, 'relief_break')).toBe(false);
        expect(r.o.units.find((u) => u.id === 'e_ring_w')!.status).not.toBe('ready');
    }, 20_000);

    it('台本は人が画面でできる程度：命令は 40 回以下、10 秒に 8 回以下。移動の後の向き（face）は使わない', () => {
        for (const [name, plan] of [
            ['DIRECT', DIRECT],
            ['LURE', LURE],
            ['UNPLANNED', UNPLANNED],
        ] as const) {
            for (const k of [-1, 0, 5, 11]) {
                const steps = plan(k < 0 ? J0 : jitterOf(k));
                expect(steps.some((x) => typeof x[2] === 'object' && 'type' in x[2] && x[2].type === 'move' && 'face' in x[2])).toBe(false);
                const r = play(steps);
                expect([name, k, r.cmds.length <= 40]).toEqual([name, k, true]);
                expect([name, k, densest(r) <= 8]).toEqual([name, k, true]);
            }
        }
    }, 60_000);
});

describe('作戦の安定性と比べ（早送り・±15 秒と見てから押す遅れの 16 通り）', () => {
    const D = () => sixteenOf('DIRECT', DIRECT);
    const L = () => sixteenOf('LURE', LURE);
    const U = () => sixteenOf('UNPLANNED', UNPLANNED);

    it('主目標に届く作戦 2 つ：急いで直接救う・引き離してから救うは 16 通りで 14 勝以上', () => {
        log('DIRECT', summary(D()));
        log('LURE', summary(L()));
        log('UNPLANNED', summary(U()));
        expect(count(D(), won), summary(D())).toBeGreaterThanOrEqual(14);
        expect(count(L(), won), summary(L())).toBeGreaterThanOrEqual(14);
    }, 120_000);

    it('時間：急いで直接救うは、引き離してから救うより 40 秒以上早く勝つ（合流も早い）', () => {
        const tD = mean(D().filter(won).map((r) => r.t));
        const tL = mean(L().filter(won).map((r) => r.t));
        const mD = mean(D().map((r) => r.metT ?? 999));
        const mL = mean(L().map((r) => r.metT ?? 999));
        log('time', tD.toFixed(1), tL.toFixed(1), 'met', mD.toFixed(1), mL.toFixed(1));
        expect(tD).toBeLessThan(tL - 40);
        expect(mD).toBeLessThan(mL);
    }, 120_000);

    it('損害・守れる部隊：引き離してから救うは損害が小さく（平均で 5 ポイント以上）、守れる部隊が多い', () => {
        const lD = mean(D().map((r) => r.loss));
        const lL = mean(L().map((r) => r.loss));
        log('loss', lD, lL, 'standing', mean(D().map(standing)), mean(L().map(standing)));
        expect(lL).toBeLessThan(lD - 0.05);
        expect(Math.max(...L().map((r) => r.loss))).toBeLessThan(Math.max(...D().map((r) => r.loss)));
        expect(mean(L().map(standing))).toBeGreaterThan(mean(D().map(standing)));
    }, 120_000);

    it('副目標が作戦で分かれる：南の囲みを崩すのは急いで直接救うだけ、損害 1 割は引き離してから救うがほとんど守り、急いで直接救うはほとんど守れない', () => {
        const by = (rs: Run[], id: string) => count(rs, (r) => sec(r, id));
        log('sec D', by(D(), 'relief_losses'), by(D(), 'relief_keep'), by(D(), 'relief_break'), 'L', by(L(), 'relief_losses'), by(L(), 'relief_keep'), by(L(), 'relief_break'));
        expect(by(D(), 'relief_break')).toBeGreaterThanOrEqual(14);
        expect(by(L(), 'relief_break')).toBe(0);
        expect(by(L(), 'relief_losses')).toBeGreaterThanOrEqual(14);
        expect(by(D(), 'relief_losses')).toBeLessThanOrEqual(8);
    }, 120_000);

    it('比べ：準備した正面攻撃（急いで直接救う）は、無計画な攻撃より損害が小さく（平均で 8 ポイント以上）、早く勝ち、守れる部隊が多い（無計画の結果は記録）', () => {
        const lD = mean(D().map((r) => r.loss));
        const lU = mean(U().map((r) => r.loss));
        log('unplanned', lU, mean(U().filter(won).map((r) => r.t)), mean(U().map(standing)), count(U(), won));
        expect(lU).toBeGreaterThan(lD + 0.08);
        expect(mean(D().filter(won).map((r) => r.t))).toBeLessThan(mean(U().filter(won).map((r) => r.t)));
        expect(mean(D().map(standing))).toBeGreaterThan(mean(U().map(standing)));
        expect(count(U(), (r) => sec(r, 'relief_losses'))).toBe(0);
    }, 120_000);
});

describe('武将の能力の価値が場面で変わる・能力は勝ちに必須ではない（早送り・16 通り）', () => {
    it('石川の後詰めの差配（長政隊を速く退かせる）：追っ手のいない西の筋では勝ちの数がほとんど変わらないが、敵の援軍が丘へ攻めかかる頃に合流した時は、使うと勝ちが大きく増える', () => {
        const normal = sixteenOf('LURE', LURE);
        const normalNo = sixteenOf('LURE_NO_ISHIKAWA', without(LURE, 'a_ishikawa'));
        const lateWith = sixteenOf('LURE_LATE', lure(240));
        const lateNo = sixteenOf('LURE_LATE_NO', lure(240, false));
        log('ishikawa normal', summary(normal), '|', summary(normalNo));
        log('ishikawa late', summary(lateWith), '|', summary(lateNo));
        expect(Math.abs(count(normal, won) - count(normalNo, won))).toBeLessThanOrEqual(2);
        expect(count(lateWith, won) - count(lateNo, won)).toBeGreaterThanOrEqual(6);
    }, 180_000);

    it('石川の後詰めの差配：東の原を下げる急いで直接救うでは、合流から安全地点までの時間を縮める', () => {
        const withA = sixteenOf('DIRECT', DIRECT);
        const noA = sixteenOf('DIRECT_NO_ISHIKAWA', without(DIRECT, 'a_ishikawa'));
        const esc = (rs: Run[]) => mean(rs.filter(won).map((r) => r.t - r.metT!));
        log('escort', esc(withA), esc(noA), summary(noA));
        expect(esc(withA)).toBeLessThan(esc(noA) - 5);
    }, 180_000);

    it('能力を使わなくても主目標に届く：酒井・石川の能力を使わない急いで直接救う・引き離してから救うも 16 通りで 12 勝以上', () => {
        const d = sixteenOf('DIRECT_NOABIL', without(without(DIRECT, 'a_ishikawa'), 'a_sakai'));
        const l = sixteenOf('LURE_NOABIL', without(without(LURE, 'a_ishikawa'), 'a_sakai'));
        log('noabil', summary(d), '|', summary(l));
        expect(count(d, won)).toBeGreaterThanOrEqual(12);
        expect(count(l, won)).toBeGreaterThanOrEqual(12);
    }, 180_000);
});
