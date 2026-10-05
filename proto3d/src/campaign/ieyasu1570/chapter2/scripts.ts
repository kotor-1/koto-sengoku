/**
 * 歴史分岐「元亀元年・家康」第二章の合戦の台本（早送りの確かめ用。本番の画面からは使わない）。設計：docs/chapter2-design.md §9・
 * 記録：docs/chapter2-battles.md。
 *
 * 台本は battle/scripts.ts の Script と同じ形（刻みごとに呼ぶ関数）。単体テスト（tests/proto3d-ieyasu-ch2-battle.test.ts）は runToEnd で、
 * 開発用の画面（e2e）は window.__battle.fastForward(秒, 台本) で使う。
 *
 * 台本の命令は、画面で出せる命令だけ：移動（地面を押す）・攻撃・防衛・撤退・全軍撤退・能力。
 * - 地面を押す（tap）：押す点の 20 m 以内に見えている敵がいれば、その敵への攻撃になる（画面と同じ。第4群の field テストの play と同じ扱い）。
 * - 時刻の行は、その時刻を過ぎた最初の刻みに 1 回。「見てから押す」行（条件）は 1 秒ごとに見て、初めて真になった時に 1 回
 *   （人が画面を見て押す間隔。刻みごとには見ない）。
 * - 揺らぎ（16 通り）：時刻の行は ±15 秒、見てから押す行は 0〜15 秒の遅れ（乱数の種 7。tests/proto3d-field-relief.test.ts の jitterOf と同じ）。
 * - 台本に出てくる部隊がその合戦にいない（判断 2 で守備隊が城に残る・支援が無い・兵が少なくて出陣しない）ときは、その行を使わない。
 */
import { isActive, issueOrder, meleeUnreachable, orderAllRetreat, unitById, type BattleState } from '../../../battle/sim';
import { useAbility } from '../../../battle/abilities';
import type { BattleResultKind, BattleSetup, Order } from '../../../battle/types';
import type { Script } from '../../../battle/scripts';
import type { IeyasuCharacterId, IeyasuCharacterStatus, PledgeResult, Policy, TokugawaUnitId, TrustId } from '../state';
import { ch2DecideTerms, ch2PlanAvailability, type Ch2BattleInput, type Ch2Plan } from './battle';

// ================================================================ 台本の道具

/** 地面を押す（押す点の 20 m 以内に見えている敵がいれば、その敵への攻撃。画面と同じ） */
export interface Ch2Tap {
    tap: [number, number];
}
/** 対象を選ぶ能力（援護・差配など） */
export interface Ch2AbilityOn {
    abilityOn: string;
}
/**
 * 命令：Order（移動・攻撃・防衛・撤退）／地面を押す／'ability'（対象を選ばない能力）／{abilityOn}（対象を選ぶ能力）／
 * 'nearest'（見えている一番近い敵へ攻撃。今の相手が戦えるなら出さない）／'allRetreat'（全軍撤退の号令。部隊 id は何でもよい）
 */
export type Ch2Cmd = Order | Ch2Tap | Ch2AbilityOn | 'ability' | 'nearest' | 'allRetreat';
export type Ch2Cond = (s: BattleState) => boolean;
/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]、または [条件, 部隊 id, 命令]（見てから押す） */
export type Ch2Step = [number | Ch2Cond, string, Ch2Cmd];

/** 揺らぎ：t は時刻の行の秒、d は見てから押すまでの遅れ（秒） */
export interface Ch2Jitter {
    t: (x: number) => number;
    d: () => number;
}
/** 揺らぎ無し（1 通り） */
export const CH2_J0: Ch2Jitter = { t: (x) => x, d: () => 0 };
/** k 通り目の揺らぎ（乱数の種 7。時刻の行は ±15 秒、見てから押す行は 0〜15 秒の遅れ） */
export function ch2Jitter(k: number): Ch2Jitter {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < k * 40; i++) rnd();
    return { t: (x) => (x === 0 ? 0 : Math.max(0, x + Math.round((rnd() - 0.5) * 30))), d: () => Math.round(rnd() * 15) };
}

export const atk = (targetId: string): Order => ({ type: 'attack', targetId });
export const tap = (x: number, z: number): Ch2Tap => ({ tap: [x, z] });
export const HOLD: Order = { type: 'hold' };
export const RETREAT: Order = { type: 'retreat' };

function seenEnemies(s: BattleState) {
    return s.units.filter((x) => x.side === 'enemy' && isActive(x) && x.seenBy.ally);
}
/** 見えている一番近い敵への攻撃（今の相手が戦えるなら null） */
export function nearestEnemyOrder(s: BattleState, id: string): Order | null {
    const u = unitById(s, id);
    if (!u || !isActive(u)) return null;
    if (u.order.type === 'attack') {
        const cur = unitById(s, u.order.targetId);
        if (cur && isActive(cur)) return null;
    }
    const e = seenEnemies(s)
        .filter((x) => !meleeUnreachable(s, u, x))
        .sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
    return e ? atk(e.id) : null;
}
/** 地面を押した命令（押す点の 20 m 以内に見えている敵がいればその敵への攻撃。画面と同じ） */
export function tapOrder(s: BattleState, [x, z]: [number, number]): Order {
    const e = seenEnemies(s)
        .filter((u) => Math.hypot(u.x - x, u.z - z) <= 20)
        .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    return e ? atk(e.id) : { type: 'move', x, z };
}

// ---------------------------------------------------------------- 条件

const alive = (s: BattleState, id: string) => {
    const u = unitById(s, id);
    return !!u && isActive(u);
};
/** 部隊が崩れた（敗走・全滅・撤退）。まだ現れていない部隊は false */
export const gone =
    (id: string): Ch2Cond =>
    (s) => {
        const u = unitById(s, id);
        return !!u && u.arrived && u.status !== 'ready';
    };
/** 部隊が戦場に現れている（着いた） */
export const arrived =
    (id: string): Ch2Cond =>
    (s) =>
        !!unitById(s, id)?.arrived;
/** 敵の部隊が見えている */
export const seen =
    (id: string): Ch2Cond =>
    (s) =>
        alive(s, id) && !!unitById(s, id)!.seenBy.ally;
/** 部隊が (x, z) の r m 以内にいる */
export const near =
    (id: string, x: number, z: number, r: number): Ch2Cond =>
    (s) => {
        const u = unitById(s, id);
        return !!u && isActive(u) && Math.hypot(u.x - x, u.z - z) <= r;
    };
/** 部隊が (x, z) から r m より遠い（持ち場を離れた） */
export const away =
    (id: string, x: number, z: number, r: number): Ch2Cond =>
    (s) => {
        const u = unitById(s, id);
        return !!u && isActive(u) && Math.hypot(u.x - x, u.z - z) > r;
    };
/** 部隊 a と b がどちらも戦えて r m 以内 */
export const close =
    (a: string, b: string, r: number): Ch2Cond =>
    (s) => {
        const u = unitById(s, a);
        const v = unitById(s, b);
        return !!u && !!v && isActive(u) && isActive(v) && Math.hypot(u.x - v.x, u.z - v.z) <= r;
    };
/** 部隊が（その敵と）斬り合っている */
export const engaged =
    (id: string, enemy?: string): Ch2Cond =>
    (s) => {
        const u = unitById(s, id);
        return !!u && isActive(u) && (enemy ? u.engagedWith === enemy : !!u.engagedWith);
    };
/** 部隊が待機している（移動の行き先に着いた・攻撃の相手が崩れた。斬り合っていない） */
export const idle =
    (id: string): Ch2Cond =>
    (s) => {
        const u = unitById(s, id);
        return !!u && isActive(u) && u.order.type === 'hold' && !u.engagedWith;
    };
/** 部隊がもう戦場にいない・戦えない（離脱・崩れ。いない部隊も） */
export const out =
    (id: string): Ch2Cond =>
    (s) => {
        const u = unitById(s, id);
        return !u || u.status !== 'ready';
    };
/** 見えている敵のどれかが (x, z) の r m 以内にいる */
export const enemyNear =
    (x: number, z: number, r: number): Ch2Cond =>
    (s) =>
        seenEnemies(s).some((e) => Math.hypot(e.x - x, e.z - z) <= r);
/** 見えている敵のどれかが部隊 id の r m 以内にいる */
export const enemyClose =
    (id: string, r: number): Ch2Cond =>
    (s) => {
        const u = unitById(s, id);
        return !!u && isActive(u) && seenEnemies(s).some((e) => Math.hypot(e.x - u.x, e.z - u.z) <= r);
    };
export const all =
    (...cs: Ch2Cond[]): Ch2Cond =>
    (s) =>
        cs.every((c) => c(s));
export const any =
    (...cs: Ch2Cond[]): Ch2Cond =>
    (s) =>
        cs.some((c) => c(s));
export const at =
    (t: number): Ch2Cond =>
    (s) =>
        s.t >= t - 1e-9;

/** 条件が初めて真になってから d 秒後に真（人が見てから押すまでの遅れ。1 回の合戦ごとに作り直す） */
export function late(c: Ch2Cond, d: number): Ch2Cond {
    if (d <= 0) return c;
    let t0: number | null = null;
    return (s) => {
        if (t0 === null) {
            if (!c(s)) return false;
            t0 = s.t;
        }
        return s.t >= t0 + d - 1e-9;
    };
}
/** 見てから押す（遅れ j.d()） */
export const w = (c: Ch2Cond, j: Ch2Jitter): Ch2Cond => late(c, j.d());

/** 部隊が移動の命令のまま、10 秒のあいだ 3 m も進めていない（味方に挟まれて止まっている。人が画面で見て押し直す） */
function stuck(id: string): Ch2Cond {
    let mark: { x: number; z: number; t: number } | null = null;
    return (s) => {
        const u = unitById(s, id);
        if (!u || !isActive(u) || u.order.type !== 'move' || u.engagedWith) {
            mark = null;
            return false;
        }
        if (!mark || Math.hypot(u.x - mark.x, u.z - mark.z) > 3) {
            mark = { x: u.x, z: u.z, t: s.t };
            return false;
        }
        return s.t >= mark.t + 10;
    };
}

/**
 * 道筋：部隊 id に地点 pts を順に押す。最初の点は start（秒または条件）、次の点からは前の点に着いて待機になったのを見てから
 * （詰まって止まったのを見ても押し直す）
 */
export function route(id: string, pts: [number, number][], start: number | Ch2Cond, j: Ch2Jitter): Ch2Step[] {
    let prog = 0;
    const isStuck = stuck(id);
    return pts.map((p, i): Ch2Step => {
        const base: Ch2Cond = i === 0 ? (typeof start === 'number' ? at(j.t(start)) : late(start, j.d())) : late((s) => prog === i && (idle(id)(s) || isStuck(s)), j.d());
        return [
            (s) => {
                if (prog !== i) return false;
                const g = base(s);
                if (g) prog = i + 1;
                return g;
            },
            id,
            tap(p[0], p[1]),
        ];
    });
}

/**
 * 行き先へ押す（start の後）。手前で待機になった・詰まって止まった（far m より遠い）のを見たら押し直す（最大 n 回。人が画面で押し直すのと同じ）。
 * stop が真になったら押し直さない
 */
export function go(id: string, x: number, z: number, start: Ch2Cond, j: Ch2Jitter, n = 3, stop?: Ch2Cond, far = 25): Ch2Step[] {
    const first = late(start, j.d());
    let cnt = 0;
    let sent = 0;
    const out: Ch2Step[] = [
        [
            (s) => {
                if (cnt !== 0 || !first(s)) return false;
                cnt = 1;
                sent = s.t;
                return true;
            },
            id,
            tap(x, z),
        ],
    ];
    const isStuck = stuck(id);
    for (let k = 0; k < n; k++) {
        const d = j.d() + 2;
        let seenAt: number | null = null;
        out.push([
            (s) => {
                if (cnt !== k + 1) return false;
                const u = unitById(s, id);
                if (!u || !isActive(u)) return false;
                const ok = s.t >= sent + 3 && (idle(id)(s) || isStuck(s)) && Math.hypot(u.x - x, u.z - z) > far && !(stop && stop(s));
                if (!ok) {
                    seenAt = null;
                    return false;
                }
                if (seenAt === null) seenAt = s.t;
                if (s.t < seenAt + d - 1e-9) return false;
                cnt = k + 2;
                sent = s.t;
                return true;
            },
            id,
            tap(x, z),
        ]);
    }
    return out;
}

// ---------------------------------------------------------------- 台本を動かす

/** 台本が出した命令の控え（人が画面で出せる数・間隔か、断られた命令が無いかを見る） */
export interface Ch2ScriptLog {
    /** 命令を出した時刻（秒） */
    cmds: number[];
    /** 断られた命令（行の印:部隊 id） */
    refused: string[];
}
export type Ch2Script = Script & { log: Ch2ScriptLog };

/**
 * 台本の行から Script を作る（1 回の合戦ごとに作り直す）。setup を渡すと、その合戦にいない部隊の行を使わない
 * （'allRetreat' の行は部隊を問わない）。
 */
export function stepScript(steps: Ch2Step[], setup?: BattleSetup): Ch2Script {
    const has = (id: string) => !setup || setup.units.some((u) => u.id === id);
    const use = steps.filter(([, id, cmd]) => cmd === 'allRetreat' || has(id));
    const timed = use.filter((x) => typeof x[0] === 'number').sort((a, b) => (a[0] as number) - (b[0] as number));
    const watch = use.filter((x) => typeof x[0] === 'function');
    const fired = new Set<number>();
    const log: Ch2ScriptLog = { cmds: [], refused: [] };
    const run = (s: BattleState, label: string, id: string, cmd: Ch2Cmd) => {
        if (cmd === 'allRetreat') {
            log.cmds.push(s.t);
            if (!orderAllRetreat(s)) log.refused.push(`${label}:全軍撤退`);
            return;
        }
        if (cmd === 'nearest') {
            const n = nearestEnemyOrder(s, id);
            if (!n) return;
            log.cmds.push(s.t);
            if (!issueOrder(s, id, n)) log.refused.push(`${label}:${id}`);
            return;
        }
        // 戦えない部隊（崩れた・離脱した）への命令は、画面では押せない（名札が無い）ので出さない。
        // 攻撃の相手が崩れた・見えていないときも、画面では押せないので出さない（見てから押すまでの遅れの間に崩れたとき）
        const u = unitById(s, id);
        if (!u || !isActive(u) || !u.arrived) return;
        if (typeof cmd === 'object' && 'type' in cmd && cmd.type === 'attack') {
            const t = unitById(s, cmd.targetId);
            if (!t || !isActive(t) || (t.side === 'enemy' && !t.seenBy.ally)) return;
        }
        log.cmds.push(s.t);
        if (cmd === 'ability') {
            if (!useAbility(s, id).ok) log.refused.push(`${label}:${id}`);
        } else if ('abilityOn' in cmd) {
            if (!useAbility(s, id, cmd.abilityOn).ok) log.refused.push(`${label}:${id}`);
        } else if (!issueOrder(s, id, 'tap' in cmd ? tapOrder(s, cmd.tap) : cmd)) log.refused.push(`${label}:${id}`);
    };
    const script = ((s: BattleState) => {
        while (timed.length && s.t >= (timed[0]![0] as number) - 1e-9) {
            const [t, id, cmd] = timed.shift()!;
            run(s, String(t), id, cmd);
        }
        // 見てから押す行は 1 秒ごとに見る（10 刻みごと）
        if (s.tick % 10 === 0) {
            watch.forEach(([cond, id, cmd], i) => {
                if (fired.has(i) || !(cond as Ch2Cond)(s)) return;
                fired.add(i);
                run(s, `when${i}@${s.t.toFixed(1)}`, id, cmd);
            });
        }
    }) as Ch2Script;
    script.log = log;
    return script;
}

// ================================================================ 第一章の結果の段階（確かめ用の入力）

/**
 * 第一章の結果の段階（釣り合いの確かめ・開発用の入口）。どれも第一章で実際に起こりうる兵・信頼・人物から作る
 * （第一章の決まり：ieyasu1570/flow.ts の TRUST_DELTA・援兵 150・負傷。第二章の補充：設計 §5.2）。
 * - strong：第一章で勝ち・約束を守った（援兵を受け取り済みで兵はほぼ満ちる。相手の信頼が高く支援あり。敵 ×0.85）
 * - typical：撤退・引き受けなかった（兵 75% ほど。支援は信頼しだい＝無い。敵 ×1）
 * - weak：敗北・約束を破った（兵 40% ほど。相手の信頼が負で士気 −10。敵 ×1.1。A 家康・B 忠勝と長政・C 忠勝が負傷）。補充なし
 * - weakwait：weak の後に補充「負傷兵の戻りを待つ」（失った兵の 25%（石川の信頼 35）が戻る。敵の後詰め・次の波が 40 秒早い）
 * - minimum：第一章で忠勝隊・弓隊（C は守備隊も）がほぼ全滅した敗北・約束を破った＋補充「待つ」の後（いちばん厳しい、ありうる形）
 * 任務の条件（terms：兵が少ないときの調整・主目標の値・始めの陣）は、キャンペーンと同じく軍議の時の兵（第一章の終わり＝補充の前）で
 * ch2DecideTerms で確定した物を渡す（weakwait・minimum で補充の後に兵が戻っても、条件は変わらない）。
 */
export type Ch2Tier = 'strong' | 'typical' | 'weak' | 'weakwait' | 'minimum';
export const CH2_TIERS: readonly Ch2Tier[] = ['strong', 'typical', 'weak', 'weakwait', 'minimum'];

/** 第一章のはじめの兵（ieyasu1570/state.ts の INITIAL_TOKUGAWA_TROOPS と同じ） */
const CH1_START = { honjin: 300, tadakatsu: 450, yumi: 350, reserve: 300 } as const;

/** 補充「負傷兵の戻りを待つ」（設計 §5.2）：各部隊、第一章で失った兵の 25%（石川の信頼 ≥ 45 なら 40%）を切り捨てで戻す */
export function ch2WaitRecovery(troops: Record<TokugawaUnitId, number>, ishikawaTrust: number): Record<TokugawaUnitId, number> {
    const rate = ishikawaTrust >= 45 ? 0.4 : 0.25;
    const out = { ...troops };
    for (const k of Object.keys(CH1_START) as TokugawaUnitId[]) out[k] = Math.min(CH1_START[k], troops[k] + Math.floor(Math.max(0, CH1_START[k] - troops[k]) * rate));
    return out;
}

/**
 * 段階でその判断を選べるか。軍議（補充の前）の兵で選べて、出陣（補充の後）の兵でも選べること（キャンペーンの流れと同じ。
 * 第一章で忠勝隊・弓隊がほぼ全滅した minimum は、軍議の時に守備隊を残すと本陣だけになるので判断 2 を選べない）
 */
export function ch2TierAvailable(policy: Policy, plan: Ch2Plan, tier: Ch2Tier): boolean {
    const council = ch2TierInput(policy, plan, tier === 'weakwait' ? 'weak' : tier, { noRecovery: true });
    return ch2PlanAvailability(plan, council.troops).available && ch2PlanAvailability(plan, ch2TierInput(policy, plan, tier).troops).available;
}

/** 段階の第二章の合戦の入力（方針・判断ごと）。opts.noRecovery：補充の前の兵（軍議の時） */
export function ch2TierInput(policy: Policy, plan: Ch2Plan, tier: Ch2Tier, opts: { noRecovery?: boolean } = {}): Ch2BattleInput {
    const home = policy === 'home';
    const alive = { ieyasu: 'alive', tadakatsu: 'alive', nobunaga: 'alive', nagamasa: 'alive' } as Record<IeyasuCharacterId, IeyasuCharacterStatus>;
    // 第一章の信頼の動き（ieyasu1570/flow.ts の TRUST_DELTA）：はじめ oda 30・asai 10・家臣 40
    const trustOf = (result: BattleResultKind, pledge: PledgeResult): Record<TrustId, number> => {
        const t: Record<TrustId, number> = { oda: 30, asai: 10, tadakatsu: 40, sakai: 40, ishikawa: 40, sakakibara: 40 };
        const partnerD = { victory: 15, retreat: 0, defeat: -10 }[result];
        if (policy === 'oda') {
            t.oda += partnerD;
            t.asai -= 15;
        } else if (policy === 'asai') {
            t.asai += partnerD;
            t.oda -= 30;
        } else t.oda -= 10;
        t.tadakatsu += result === 'victory' ? 5 : 0;
        t.sakai += { victory: 5, retreat: 0, defeat: -5 }[result];
        const partner: TrustId = policy === 'oda' ? 'oda' : policy === 'asai' ? 'asai' : 'tadakatsu';
        t[partner] += { kept: 25, broken: -25, declined: 0 }[pledge];
        t.ishikawa += { kept: 5, broken: -5, declined: 0 }[pledge];
        return t;
    };
    const base = (troops: Record<TokugawaUnitId, number>, result: BattleResultKind, pledge: PledgeResult, characters: Record<IeyasuCharacterId, IeyasuCharacterStatus>, waited: boolean): Ch2BattleInput => {
        const trust = trustOf(result, pledge);
        const recover = waited && !opts.noRecovery;
        return {
            policy,
            plan,
            troops: recover ? ch2WaitRecovery(troops, trust.ishikawa) : troops,
            characters,
            trust,
            ch1Result: result,
            ch1Pledge: pledge,
            waited: recover,
            terms: ch2DecideTerms(policy, plan, troops),
        };
    };
    const reserveCh1 = (n: number) => (home ? n : CH1_START.reserve);
    switch (tier) {
        case 'strong':
            // 第一章の損害（本陣 270・忠勝隊 360・弓隊 300、C は守備隊 270）に、約束を守った援兵 150 を足した後（flow.ts の distributeReinforcement。各部隊は第一章のはじめの兵まで）
            return base(home ? { honjin: 300, tadakatsu: 405, yumi: 345, reserve: 300 } : { honjin: 300, tadakatsu: 430, yumi: 350, reserve: 300 }, 'victory', 'kept', alive, false);
        case 'typical':
            return base({ honjin: 225, tadakatsu: 340, yumi: 260, reserve: reserveCh1(225) }, 'retreat', 'declined', alive, false);
        case 'weak':
        case 'weakwait': {
            const ch = { ...alive };
            if (policy === 'oda') ch.ieyasu = 'wounded';
            else if (policy === 'asai') {
                ch.tadakatsu = 'wounded';
                ch.nagamasa = 'wounded';
            } else ch.tadakatsu = 'wounded';
            return base({ honjin: 120, tadakatsu: 180, yumi: 140, reserve: reserveCh1(120) }, 'defeat', 'broken', ch, tier === 'weakwait');
        }
        case 'minimum': {
            const ch = { ...alive, ieyasu: 'wounded', tadakatsu: 'wounded' } as Record<IeyasuCharacterId, IeyasuCharacterStatus>;
            if (policy === 'asai') ch.nagamasa = 'wounded';
            return base({ honjin: 100, tadakatsu: 10, yumi: 10, reserve: reserveCh1(10) }, 'defeat', 'broken', ch, true);
        }
    }
}

// ================================================================ 方針ごとの作戦の台本

/** 作戦の種類：plan＝目標を考えた作戦／naive＝目標を考えない手（比べる相手。勝ち負けを合格の条件にしない） */
export type Ch2TacticKind = 'plan' | 'naive';

export interface Ch2Tactic {
    id: string;
    label: string;
    kind: Ch2TacticKind;
    /** 使える判断（省けば両方） */
    plans?: readonly Ch2Plan[];
    /** 台本の行（揺らぎ j） */
    steps: (j: Ch2Jitter) => Ch2Step[];
}

// ---------------------------------------------------------------- A：織田勢の撤収を支える（退却戦の地形）

/** 退き口の中の押す点（南の端の輪の中） */
const A_EXIT: [number, number] = [0, 205];
const A_ALL = ['t_honjin', 't_tadakatsu', 't_yumi', 't_reserve', 'a_oda_rear', 'a_oda_baggage', 'a_oda_teppo'];
/** 織田勢の 2 隊が切れ目まで来た（または、もう戦場にいない） */
const odaAtCut: Ch2Cond = all(any(near('a_oda_rear', 0, 110, 35), out('a_oda_rear')), any(near('a_oda_baggage', 0, 110, 35), out('a_oda_baggage')));

const TACTICS_A: Ch2Tactic[] = [
    {
        id: 'rear_hold',
        label: '殿は丘で受け、織田勢と本陣を移動で先に退き口へ（撤退の号令は使わない）。弓は追っ手の騎馬を射る',
        kind: 'plan',
        plans: ['commit'],
        steps: (j) => [
            [0, 'a_oda_rear', tap(...A_EXIT)],
            [0, 'a_oda_baggage', tap(...A_EXIT)],
            [j.t(5), 't_honjin', tap(...A_EXIT)],
            [w(seen('e_asakura_kiba'), j), 't_yumi', atk('e_asakura_kiba')],
        ],
    },
    {
        id: 'rear_ambush',
        label: '殿は丘で受け、織田勢と本陣を先に。伏兵が見えたら守備隊・鉄砲で当たり、後備えは切れ目の東寄りを抜ける',
        kind: 'plan',
        plans: ['commit'],
        steps: (j) => [
            [0, 'a_oda_baggage', tap(...A_EXIT)],
            [0, 'a_oda_rear', tap(20, 100)],
            [j.t(5), 't_honjin', tap(...A_EXIT)],
            [w(seen('e_asakura_kiba'), j), 't_yumi', atk('e_asakura_kiba')],
            [w(seen('e_asakura_amb'), j), 't_reserve', atk('e_asakura_amb')],
            [w(seen('e_asakura_amb'), j), 'a_oda_teppo', atk('e_asakura_amb')],
            [w(near('a_oda_rear', 20, 100, 15), j), 'a_oda_rear', tap(...A_EXIT)],
        ],
    },
    {
        id: 'meet',
        label: '忠勝隊が前へ出て、織田勢を追う騎馬を受ける。弓が射る。織田勢は移動で退き口へ、切れ目まで来たら本陣も退く',
        kind: 'plan',
        steps: (j) => [
            [0, 'a_oda_rear', tap(...A_EXIT)],
            [0, 'a_oda_baggage', tap(...A_EXIT)],
            [0, 't_tadakatsu', tap(20, 20)],
            [w(seen('e_asakura_kiba'), j), 't_yumi', atk('e_asakura_kiba')],
            [w(odaAtCut, j), 't_honjin', tap(...A_EXIT)],
        ],
    },
    { id: 'nothing', label: '何もしない（命令を出さない）', kind: 'naive', steps: () => [] },
    { id: 'all_retreat', label: '開始直後に全軍撤退を号令する', kind: 'naive', steps: () => [[0.1, '', 'allRetreat']] },
    { id: 'all_move', label: '開始直後に全部隊を同時に退き口へ（移動）', kind: 'naive', steps: () => A_ALL.map((id) => [0, id, tap(...A_EXIT)] as Ch2Step) },
];

// ---------------------------------------------------------------- B：孤立した浅井勢を救う（援軍救出の地形）

const B_SAFE: [number, number] = [0, 175];
/** 合流した（画面の知らせ「…と合流した。安全地点（輪）まで連れ帰る」） */
const met: Ch2Cond = (s) => s.objectives?.primary?.metT != null;

const TACTICS_B: Ch2Tactic[] = [
    {
        id: 'south',
        label:
            '南から急いで救う：忠勝隊と守備隊で東の原の鉄砲を挟んで崩し、道案内・弓と南の囲みへ一度に当たる。浅井勢も丘から背を突く。' +
            '崩したら丘で合流し、浅井勢を東の原から下げる',
        kind: 'plan',
        plans: ['commit'],
        steps: (j) => [
            [0, 't_tadakatsu', tap(70, 20)],
            [0, 't_reserve', tap(95, 25)],
            [0, 'a_asai_guide', tap(25, 40)],
            [0, 't_yumi', tap(55, 50)],
            [w(near('t_tadakatsu', 70, 20, 15), j), 't_tadakatsu', atk('e_oda_teppo')],
            [w(near('t_reserve', 95, 25, 15), j), 't_reserve', atk('e_oda_teppo')],
            [w(any(gone('e_oda_teppo'), at(100)), j), 't_reserve', tap(55, -45)],
            [w(any(gone('e_oda_teppo'), at(100)), j), 'a_asai_guide', tap(30, -45)],
            [w(any(gone('e_oda_teppo'), at(100)), j), 't_tadakatsu', tap(80, -45)],
            [w(any(gone('e_oda_teppo'), at(100)), j), 't_yumi', tap(50, -10)],
            [w(all(near('t_tadakatsu', 80, -45, 20), near('t_reserve', 55, -45, 20)), j), 't_tadakatsu', atk('e_oda_ring_s')],
            [w(all(near('t_tadakatsu', 80, -45, 25), near('t_reserve', 55, -45, 20)), j), 't_reserve', atk('e_oda_ring_s')],
            [w(all(near('t_tadakatsu', 80, -45, 25), near('a_asai_guide', 30, -45, 20)), j), 'a_asai_guide', atk('e_oda_ring_s')],
            [w(near('t_yumi', 50, -10, 20), j), 't_yumi', atk('e_oda_ring_s')],
            [w(all(engaged('e_oda_ring_s'), gone('e_oda_attack')), j), 'a_asai', atk('e_oda_ring_s')],
            [w(gone('e_oda_ring_s'), j), 'a_asai', tap(60, -125)],
            [w(gone('e_oda_ring_s'), j), 't_reserve', tap(50, -110)],
            [w(gone('e_oda_ring_s'), j), 't_tadakatsu', tap(85, -85)],
            ...route('a_asai', [[40, 60], B_SAFE], met, j),
            [w(met, j), 't_reserve', tap(30, -40)],
            [w(any(near('a_asai', 40, 60, 40), at(400)), j), 't_tadakatsu', tap(70, 60)],
            [w(any(near('a_asai', 40, 60, 40), at(400)), j), 't_reserve', tap(20, 80)],
        ],
    },
    {
        id: 'west',
        label:
            '西の筋から救う：弓で西の囲みを射て誘い出し、林の縁に伏せた忠勝隊・道案内（守備隊）と、丘から下りた浅井勢で挟む。' +
            '崩したら丘の西で合流し、浅井勢を西の筋から下げる',
        kind: 'plan',
        steps: (j) => [
            ...route('t_yumi', [[-55, 20], [-55, -45]], 0, j),
            ...route('t_tadakatsu', [[-85, -15]], 0, j),
            ...route('a_asai_guide', [[-85, 10]], 0, j),
            ...route('t_reserve', [[-85, 35]], 0, j),
            [j.t(5), 't_honjin', tap(-50, 50)],
            [w(near('t_yumi', -55, -45, 15), j), 't_yumi', atk('e_oda_ring_w')],
            [w(away('e_oda_ring_w', -35, -150, 30), j), 't_yumi', tap(-50, 40)],
            [w(all(away('e_oda_ring_w', -35, -150, 30), gone('e_oda_attack')), j), 'a_asai', atk('e_oda_ring_w')],
            [w(any(engaged('e_oda_ring_w'), close('e_oda_ring_w', 't_tadakatsu', 45)), j), 't_tadakatsu', atk('e_oda_ring_w')],
            [w(any(engaged('e_oda_ring_w'), close('e_oda_ring_w', 'a_asai_guide', 45)), j), 'a_asai_guide', atk('e_oda_ring_w')],
            [w(any(engaged('e_oda_ring_w'), close('e_oda_ring_w', 't_reserve', 45)), j), 't_reserve', atk('e_oda_ring_w')],
            [w(gone('e_oda_ring_w'), j), 't_tadakatsu', tap(15, -150)],
            [w(gone('e_oda_ring_w'), j), 'a_asai', tap(30, -150)],
            [w(gone('e_oda_ring_w'), j), 'a_asai_guide', tap(-50, -60)],
            [w(gone('e_oda_ring_w'), j), 't_reserve', tap(-50, -20)],
            ...route('a_asai', [[-45, -100], [-55, 60], B_SAFE], met, j),
            [w(near('a_asai', -45, -100, 30), j), 't_tadakatsu', tap(-40, -80)],
            [w(near('a_asai', -55, 60, 30), j), 't_tadakatsu', tap(-50, 50)],
        ],
    },
    { id: 'nothing', label: '何もしない（命令を出さない）', kind: 'naive', steps: () => [] },
    { id: 'all_retreat', label: '開始直後に全軍撤退を号令する', kind: 'naive', steps: () => [[0.1, '', 'allRetreat']] },
    { id: 'target_only', label: '救出の対象（浅井勢）だけを、開始直後に南の安全地点へ動かす', kind: 'naive', steps: () => [[0, 'a_asai', tap(...B_SAFE)]] },
    {
        id: 'rush',
        label: '全部隊で丘へ一斉に向かい、あとは 30 秒ごとに見えている一番近い敵へ当て直すだけ（合流したら浅井勢を下げる）',
        kind: 'naive',
        steps: (j) => [
            ...['t_honjin', 't_tadakatsu', 't_yumi', 't_reserve', 'a_asai_guide'].flatMap((id) => [
                [0, id, tap(60, -150)] as Ch2Step,
                ...[30, 60, 90, 120, 150, 180, 210, 240, 270, 300].map((t) => [j.t(t), id, 'nearest'] as Ch2Step),
            ]),
            [w(met, j), 'a_asai', tap(...B_SAFE)],
        ],
    },
];

// ---------------------------------------------------------------- C：領内の村を守る（村落の地形）

const C_WAVES = ['e_ronin_w1_yari', 'e_ronin_w2_yari', 'e_ronin_w3_yari'];
/** 波の槍が広場（家並みの南。屋敷の抜け道・西の通りから出た所）へ入って見えている */
const inPlaza =
    (id: string): Ch2Cond =>
    (s) => {
        const u = unitById(s, id);
        return !!u && u.status === 'ready' && u.arrived && u.seenBy.ally && u.z > 18 && Math.abs(u.x) < 70;
    };
/**
 * 広場で囲む：部隊を広場に置き（開始から 1.5 秒おきに 1 部隊ずつ）、波の槍が広場へ入ったら fighters で一度に当たる（弓も射る）。
 * 崩したら持ち場へ戻る。通りの口・抜け道では 1 部隊ずつしか当たれないので、広場へ入れてから囲む
 */
function trapSteps(pos: Record<string, [number, number]>, fighters: string[], j: Ch2Jitter): Ch2Step[] {
    const out: Ch2Step[] = Object.entries(pos).map(([id, p], i) => [i * 1.5, id, tap(...p)] as Ch2Step);
    for (const wv of C_WAVES) {
        for (const id of fighters) out.push([w(inPlaza(wv), j), id, atk(wv)]);
        out.push([w(inPlaza(wv), j), 't_yumi', atk(wv)]);
        for (const id of [...fighters, 't_yumi']) if (pos[id]) out.push([w(all(gone(wv), at(30)), j), id, tap(...pos[id]!)]);
    }
    return out;
}
const C_PLAZA: Record<string, [number, number]> = { t_tadakatsu: [0, 40], t_reserve: [-34, 38], t_yumi: [-20, 60], t_honjin: [5, 62], a_village: [30, 60] };

const TACTICS_C: Ch2Tactic[] = [
    {
        id: 'trap',
        label: '広場に集め、波の槍が広場へ入ったら忠勝隊・守備隊・村の衆で一度に囲む（弓も射る）。崩したら持ち場へ戻る',
        kind: 'plan',
        steps: (j) => trapSteps(C_PLAZA, ['t_tadakatsu', 't_reserve', 'a_village'], j),
    },
    {
        id: 'trap_hq',
        label: '広場で囲む。家康本陣も囲みに加わる（兵が少ないとき。本陣が崩れると負けなので危うい）',
        kind: 'plan',
        steps: (j) => trapSteps(C_PLAZA, ['t_tadakatsu', 't_reserve', 'a_village', 't_honjin'], j),
    },
    {
        id: 'trap_store',
        label: '守備隊を西の通りの家並みの間へ回して米蔵へ向かう騎馬を受け、広場は忠勝隊・本陣・村の衆で囲む',
        kind: 'plan',
        plans: ['commit'],
        steps: (j) => [
            ...trapSteps({ t_tadakatsu: [0, 40], t_yumi: [-20, 60], t_honjin: [5, 62], a_village: [30, 60] }, ['t_tadakatsu', 'a_village', 't_honjin'], j),
            [j.t(20), 't_reserve', tap(-72, -5)],
        ],
    },
    { id: 'nothing', label: '何もしない（命令を出さない）', kind: 'naive', steps: () => [] },
    { id: 'all_retreat', label: '開始直後に全軍撤退を号令する', kind: 'naive', steps: () => [[0.1, '', 'allRetreat']] },
    {
        id: 'rush',
        label: '全部隊が 10 秒ごとに、見えている一番近い敵へ当て直すだけ（持ち場を考えない）',
        kind: 'naive',
        steps: (j) =>
            ['t_honjin', 't_tadakatsu', 't_yumi', 't_reserve', 'a_village'].flatMap((id) =>
                Array.from({ length: 35 }, (_, i) => [j.t(10 + i * 10), id, 'nearest'] as Ch2Step),
            ),
    },
];

/**
 * 方針ごとの作戦の台本（数字は docs/chapter2-battles.md・tests/proto3d-ieyasu-ch2-battle-*.test.ts）。
 * 勝てる作戦（16 通りの過半。段階は strong・typical・weak・weakwait・minimum。判断 2 は minimum では選べない）：
 * - A 判断 1（殿を引き受ける）：rear_hold・rear_ambush（全段階 16/16）・meet（全段階。minimum は 9/16）。
 *   判断 2（退き口の手前を固める）：meet（全段階 16/16）
 * - B 判断 1（南から急いで救う）：south（13〜16/16）・west（15〜16/16）。判断 2（西の筋から救う）：west（全段階 16/16）
 * - C 判断 1（全軍で村を守る）：trap（strong・typical・weak）・trap_hq（全段階。minimum 12/16）・trap_store（strong・typical・weak。米蔵を守る）。
 *   判断 2（守備隊は城に残す）：trap（全段階。weakwait 13/16）・trap_hq（strong・typical・weakwait）
 * 目標を考えない手（naive）は比べる相手。勝ち負けを合格の条件にしない（考えた作戦より明らかに良くならないことだけを確かめる）。
 */
export const CH2_TACTICS: Readonly<Record<Policy, readonly Ch2Tactic[]>> = {
    oda: TACTICS_A,
    asai: TACTICS_B,
    home: TACTICS_C,
};

/** 方針・判断で使える作戦 */
export function ch2Tactics(policy: Policy, plan: Ch2Plan, kind?: Ch2TacticKind): Ch2Tactic[] {
    return CH2_TACTICS[policy].filter((t) => (!t.plans || t.plans.includes(plan)) && (!kind || t.kind === kind));
}

/**
 * 作戦の台本（1 回の合戦ごとに作る）。setup はその合戦の設定（いない部隊の行を除く）。k は揺らぎの番号（省けば揺らぎ無し）。
 * 例（開発用の画面）：__battle.fastForward(600, ch2TacticScript('oda', 'rear_screen', __battle.state.setup))
 */
export function ch2TacticScript(policy: Policy, id: string, setup?: BattleSetup, k?: number): Ch2Script {
    const t = CH2_TACTICS[policy].find((x) => x.id === id);
    if (!t) throw new Error(`第二章の台本がありません：${policy}/${id}`);
    return stepScript(t.steps(k === undefined ? CH2_J0 : ch2Jitter(k)), setup);
}
