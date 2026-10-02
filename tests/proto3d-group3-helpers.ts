/**
 * 第3群の 5 戦場（湿地・村落・寺社周辺・城下町外縁・城攻め前面）のテストの台本の道具（docs/fields-group3-design.md §1・§4）。
 *
 * どれも「早送り」：決まった時刻に issueOrder・useAbility で命令を出す台本を runToEnd で最後まで進める（画面の操作ではない）。
 * 台本は、人が画面でできる程度の命令の数・間隔にする。画面では敵の近くの地面を押すとその敵への攻撃になるので、台本の地面の行き先（tap）も、
 * 押す点の 20 m 以内に見えている敵がいればその敵への攻撃にする（画面と同じ）。
 * 'when' の行は「見てから押す」命令（条件が初めて満たされた刻みに 1 回だけ出す。人が画面で状況を見てから押すのと同じ）。
 */
import { createBattle, isActive, issueOrder, meleeUnreachable, runToEnd, unitById, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { buildBattleSetup, getField, type BattlefieldDef } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';

/** 地面を押す（押す点の 20 m 以内に見えている敵がいれば、その敵への攻撃。画面と同じ） */
export interface Tap {
    tap: [number, number];
}
/** 命令の中身。'ability' は固有能力、'nearest' は「見えている一番近い敵へ攻撃」（今の相手が戦えるなら出さない） */
export type Cmd = Order | Tap | 'ability' | 'nearest';
/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]、または [条件, 部隊 id, 命令]（見てから押す。条件が初めて真になった刻みに 1 回） */
export type Step = [number, string, Cmd] | [(s: BattleState) => boolean, string, Cmd];

export const atk = (targetId: string): Order => ({ type: 'attack', targetId });
export const tap = (x: number, z: number): Tap => ({ tap: [x, z] });
export const HOLD: Order = { type: 'hold' };
export const RETREAT: Order = { type: 'retreat' };

export function seenEnemies(s: BattleState) {
    return s.units.filter((x) => x.side === 'enemy' && isActive(x) && x.seenBy.ally);
}
export function nearestEnemy(s: BattleState, id: string): Order | null {
    const u = unitById(s, id)!;
    if (!isActive(u)) return null;
    if (u.order.type === 'attack') {
        const cur = unitById(s, u.order.targetId);
        if (cur && isActive(cur)) return null;
    }
    // 道の無い相手（櫓台の上・閉じた門の向こう）への攻撃は画面で断られて理由が出る（sim.ts の meleeUnreachable）ので、人は次に近い敵を押す
    const e = seenEnemies(s)
        .filter((x) => !meleeUnreachable(s, u, x))
        .sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
    return e ? atk(e.id) : null;
}
export function tapOrder(s: BattleState, [x, z]: [number, number]): Order {
    const e = seenEnemies(s)
        .filter((u) => Math.hypot(u.x - x, u.z - z) <= 20)
        .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    return e ? atk(e.id) : { type: 'move', x, z };
}

/** 敵の部隊が崩れた（敗走・全滅・撤退）か、まだ現れていない部隊は false */
export const gone = (id: string) => (s: BattleState) => {
    const u = unitById(s, id);
    return !!u && u.arrived && u.status !== 'ready';
};
/** 部隊が (x, z) の r m 以内にいる */
export const near = (id: string, x: number, z: number, r: number) => (s: BattleState) => {
    const u = unitById(s, id);
    return !!u && isActive(u) && Math.hypot(u.x - x, u.z - z) <= r;
};
/** 部隊が戦場に現れている（着いた） */
export const arrived = (id: string) => (s: BattleState) => !!unitById(s, id)?.arrived;

/** 部隊が待機している（移動の行き先に着いた・攻撃の相手が崩れた。斬り合っていない） */
export const idle = (id: string) => (s: BattleState) => {
    const u = unitById(s, id);
    return !!u && isActive(u) && u.order.type === 'hold' && !u.engagedWith;
};

/**
 * 道筋（見てから押す）：部隊 id に、地点 pts を順に押す。最初の点は start 秒（または start の条件）に、次の点からは、前の点に着いて
 * 待機になったら（相手が崩れて待機になったときも）押す。人が画面で、着いたのを見てから次の足場を押すのと同じ
 */
export function route(id: string, pts: [number, number][], start: number | ((s: BattleState) => boolean) = 0): Step[] {
    const prog = new WeakMap<BattleState, number>();
    return pts.map((p, i): Step => [
        (s: BattleState) => {
            const k = prog.get(s) ?? 0;
            if (k !== i) return false;
            const go = i === 0 ? (typeof start === 'number' ? s.t >= start - 1e-9 : start(s)) : idle(id)(s);
            if (go) prog.set(s, k + 1);
            return go;
        },
        id,
        tap(p[0], p[1]),
    ]);
}

export interface Run {
    o: BattleOutcome;
    /** 終わった時刻（秒） */
    t: number;
    /** 味方の兵の損害の割合（0〜1） */
    loss: number;
    /** 部隊ごとの兵の残り */
    left: Record<string, number>;
    /** 断られた命令 */
    refused: string[];
    s: BattleState;
}

/** 台本を最後まで進める（each は刻みごと。様子を見るとき） */
export function play(field: BattlefieldDef | string, steps: Step[], each?: (s: BattleState) => void): Run {
    const f = typeof field === 'string' ? getField(field)! : field;
    const s = createBattle(buildBattleSetup(f, 'standard'));
    const timed = steps.filter((x): x is [number, string, Cmd] => typeof x[0] === 'number').sort((a, b) => a[0] - b[0]);
    const watch = steps.filter((x): x is [(s: BattleState) => boolean, string, Cmd] => typeof x[0] === 'function');
    const fired = new Set<number>();
    const refused: string[] = [];
    const run = (st: BattleState, label: string, id: string, ord: Cmd) => {
        if (ord === 'nearest') {
            const n = nearestEnemy(st, id);
            if (n && !issueOrder(st, id, n)) refused.push(`${label}:${id}`);
        } else if (ord === 'ability') {
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
        each?.(st);
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    return { o, t: s.t, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused, s };
}

export const secondaryOf = (r: Run, id: string) => r.o.objectives!.secondary.find((x) => x.id === id)!.achieved;
export const statusOf = (r: Run, id: string) => r.o.units.find((u) => u.id === id)!.status;

/**
 * 時刻の行を ±15 秒ずらした 16 通り（決まった乱数。第2群のテストと同じ作り方。0 秒の行と「見てから押す」行はずらさない）の結果。
 * 主目標に届く作戦の安定性を見る
 */
export function jitter(field: string, base: Step[], n = 16): Run[] {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const out: Run[] = [];
    for (let k = 0; k < n; k++) {
        const steps = base.map((x) => (typeof x[0] === 'number' && x[0] !== 0 ? ([x[0] + Math.round((rnd() - 0.5) * 30), x[1], x[2]] as Step) : x));
        out.push(play(field, steps));
    }
    return out;
}

/** 結果の短い要約（テストの失敗の文・様子を見るとき） */
export function brief(r: Run): string {
    const sec = r.o.objectives?.secondary.map((x) => `${x.id}:${x.achieved ? '✓' : '✗'}`).join(' ');
    return `${r.o.result}/${r.o.reason} t=${r.t.toFixed(1)} loss=${(r.loss * 100).toFixed(1)}% ${sec} refused=${r.refused.join(',')}`;
}
