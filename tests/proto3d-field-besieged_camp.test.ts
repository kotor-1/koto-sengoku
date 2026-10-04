/**
 * 戦場「包囲された陣」（besieged_camp）の釣り合い（docs/fields-group4-design.md §3〜§5、依頼本文 docs/fields-group4-request.md の「16. 包囲された陣」）。
 * 主目標：総大将（家康本陣）と、ほかの 3 部隊が包囲の外の出口から脱出する（escape）。短いが守りの厚い南の突破口（切れ目の守りの槍・二の手の槍・弓）と、
 * 遠いが手薄な東の回り道（狭い抜け道の守りの槍 1。道の北に騎馬、200 秒に後詰めの騎馬）。西の林の騎馬は、突破口を攻める味方の後ろを突く後詰め。
 *
 * 合格条件は「正面なら負ける」ではなく、作戦どうしの比べ（損害・時間・副目標・守れる部隊）と、主目標に届く作戦の安定性。
 * 無計画な攻撃・待つだけ・総大将を先に出した結果は記録として書く。
 *
 * どれも「早送り」：決まった時刻と「見てから押す」行で issueOrder・useAbility・orderAllRetreat を出す台本を runToEnd で最後まで進める
 * （画面の操作ではない）。「状態を直接操作」の it はその旨を名前に書く。
 * 台本は人が画面でできる程度の命令の数・間隔にしている（一番多い準備した南で 20 回・約 2 分）。移動の後の向き（face）は使わない。
 * 画面では敵の近くの地面を押すとその敵への攻撃になるので、台本の地面の行き先（tap）も、押す点の 20 m 以内に見えている敵がいれば
 * その敵への攻撃にする。
 *
 * 揺らぎ（16 通り）：時刻の行は ±15 秒（乱数の種 7 から。第2群・第3群のテストと同じ作り方）。「見てから押す」行には、人が見てから押すまでの
 * 遅れ 0〜15 秒を足す（同じ乱数から。同じ条件を見て続けて押す行は同じ遅れ）。tests/proto3d-field-marsh.test.ts と同じ作り方。
 *
 * 作った時の結果（早送り。16 通りは上の揺らぎ。副目標は 損害 2 割以内／弓隊 5 割／南の守りを崩す。守れる部隊＝最後に崩れていない（戦える・脱出した）
 * 味方の部隊の数／7）：
 * | 作戦 | 1 通り | 16 通り |
 * | 東を開いてから総大将を出す（EAST・撤退の命令＋退路の守護） | 282.8 秒・損害 9.5％・勝ち・✓✓✗・7／7 | 16 勝・平均 294.5 秒（286.8〜304.5）・9.9％・7.00 |
 * | 同じく全軍撤退で退く（EAST_ALL） | 274.7 秒・11.5％・勝ち・✓✓✗・7／7（命令から 113 秒） | 16 勝・286.4 秒（278.7〜296.4）・11.7％ |
 * | 東（能力なし。後詰めの騎馬に当たる。EAST_PLAIN） | 281.3 秒・9.5％・勝ち・✓✓✗・7／7 | 15 勝・293.3 秒（285.5〜303.0）・11.5％ |
 * | 南の厚い口を準備して破る（SOUTH・準備した正面攻撃） | 105.6 秒・21.7％・勝ち・✗✗✓・6／7（弓隊が西の騎馬に崩される） | 16 勝・133.8 秒（120.6〜149.9）・19.6％・6.81（弓 ✓ 15） |
 * | 南の準備（能力なし。SOUTH_NA） | 119.9 秒・19.1％・勝ち・✗✓✓・6／7 | 10 勝・137.7 秒・25.0％・5.75（負けはどれも、槍の列の後ろの家康が西の騎馬に突かれて崩れる） |
 * | 無計画：南へ一斉（家康も。RUSH） | 132.4 秒に勝ち・24.9％・5／7（騎馬隊が槍の正面に当たって全滅。第4群の確かめの直しの前は 130.0 秒に負け・39.3％・3／7） | （時刻の行が 0 秒だけなので 16 通りとも同じ） |
 * | 無計画：東へ一斉（家康も） | 101.1 秒に負け・37.0％・3／7 | |
 * | 無計画：一番近い敵へ当て直すだけ | 日没・52.8％・4／7 | |
 * | 待つ | 日没（撤退）・損害 0 | |
 * | 総大将だけを先に出す（東／南） | 36.9 秒／65.2 秒に負け（家康が崩れる） | |
 * | 東を開く前に家康を出す（EAST_ALL に 0 秒の家康） | 153.4 秒に負け | |
 * | 始めに全軍撤退（1 秒） | 46.4 秒に負け（追い討ちで家康が崩れる） | |
 * 南の準備の能力（先駆けの号・立て直しの号令）は、16 通りの勝ちを 10 → 16 に増やす（号令の間は、列の後ろの家康が西の騎馬に突かれても崩れない）。
 * 1 通りの損害は能力なしの方が少ない（19.1％。先駆けの榊原隊は受ける損害 ×1.2）。
 *
 * 武将の能力の価値が場面で変わる比べ：本多忠勝の退路の守護（東の道で撤退の列の後ろ／南の切れ目で攻める最中）。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, isActive, issueOrder, orderAllRetreat, runToEnd, stepBattle, unitById, RULES, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { inZone } from '../proto3d/src/battle/fieldRules';
import { findPath } from '../proto3d/src/battle/pathfind';
import { buildBattleSetup, getField, presetUnits, validateField } from '../proto3d/src/battle/fields';
import { endRuleItems, objectiveProgress } from '../proto3d/src/battle/objectives';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';

const BC = getField('besieged_camp')!;

// ---------------------------------------------------------------- 台本の道具

/** 地面を押す（押す点の 20 m 以内に見えている敵がいれば、その敵への攻撃。画面と同じ） */
interface Tap {
    tap: [number, number];
}
/** 'ability' は固有能力（対象を選ばない）、'nearest' は「見えている一番近い敵へ攻撃」（今の相手が戦えるなら出さない）、'allRetreat' は全軍撤退 */
type Cmd = Order | Tap | 'ability' | 'nearest' | 'allRetreat';
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
const RET: Order = { type: 'retreat' };
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
/** 敵の部隊が味方から見えている（画面に名札が出ている） */
const seen =
    (id: string): Cond =>
    (s) => {
        const u = unitById(s, id);
        return !!u && isActive(u) && u.seenBy.ally;
    };
const all =
    (...cs: Cond[]): Cond =>
    (s) =>
        cs.every((c) => c(s));
const any =
    (...cs: Cond[]): Cond =>
    (s) =>
        cs.some((c) => c(s));
/** 開始から sec 秒を過ぎた（人が時計を見て、待つのをやめる） */
const after =
    (sec: number): Cond =>
    (s) =>
        s.t >= sec - 1e-9;
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
    /** 出口から脱出した時刻（部隊 id → 秒） */
    out: Record<string, number>;
    /** 全軍撤退を命じた時刻（命じなければ null） */
    allRetreatAt: number | null;
    /** 退路の守護の引きつけ・阻みの知らせの数 */
    lured: number;
    s: BattleState;
}

/** 台本を最後まで進める（each は刻みごと。様子を見るとき） */
function play(steps: Step[], each?: (s: BattleState) => void): Run {
    const s = createBattle(buildBattleSetup(BC, 'standard'));
    const timed = steps.filter((x) => typeof x[0] === 'number').sort((a, b) => (a[0] as number) - (b[0] as number));
    const watch = steps.filter((x) => typeof x[0] === 'function');
    const fired = new Set<number>();
    const refused: string[] = [];
    const out: Record<string, number> = {};
    const run = (st: BattleState, label: string, id: string, ord: Cmd) => {
        if (ord === 'allRetreat') {
            if (!orderAllRetreat(st)) refused.push(`${label}:allRetreat`);
        } else if (ord === 'nearest') {
            const n = nearestEnemy(st, id);
            if (n && !issueOrder(st, id, n)) refused.push(`${label}:${id}`);
        } else if (ord === 'ability') {
            if (!useAbility(st, id).ok) refused.push(`${label}:${id}`);
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
        for (const id of st.objectives?.primary?.entered ?? []) if (!(id in out)) out[id] = st.t;
        each?.(st);
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    const lured = s.events.filter((e) => e.kind === 'ai' && (e.text.includes('引きつけられた') || e.text.includes('が阻む'))).length;
    return { o, t: s.t, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused, out, allRetreatAt: s.allRetreatAt, lured, s };
}

const won = (r: Run) => r.o.result === 'victory' && r.o.objectives?.primary?.achieved === true;
const SEC = ['camp_losses', 'camp_yumi', 'camp_break'] as const;
const secondaryOf = (r: Run, id: (typeof SEC)[number]) => r.o.objectives!.secondary.find((x) => x.id === id)!.achieved;
const secondaries = (r: Run) => SEC.map((id) => secondaryOf(r, id));
const statusOf = (r: Run, id: string) => r.o.units.find((u) => u.id === id)!.status;
const ALLY = ['a_ieyasu', 'a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa', 'a_yumi', 'a_kiba'];
/** 守れる部隊：最後に崩れていない（戦える・脱出した）味方の部隊の数 */
const standing = (r: Run) => ALLY.filter((id) => statusOf(r, id) === 'ready' || statusOf(r, id) === 'withdrawn').length;
const meanOf = (rs: Run[], f: (r: Run) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
const winsOf = (rs: Run[]) => rs.filter(won).length;
/** 失敗の文に添える短い要約 */
function brief(r: Run): string {
    const sec = r.o.objectives?.secondary.map((x) => `${x.id}:${x.achieved ? '✓' : '✗'}`).join(' ');
    return `${r.o.result}/${r.o.reason} t=${r.t.toFixed(1)} loss=${(r.loss * 100).toFixed(1)}% ${sec} standing=${standing(r)} refused=${r.refused.join(',')}`;
}

// ---------------------------------------------------------------- 台本

/** 東の回り道の出口（南東の角）・南の突破口の出口の中の押す点 */
const EX: [number, number] = [192, 212];
const SX: [number, number] = [0, 212];

/**
 * 東を開いてから総大将を出す（撤退の命令＋忠勝の退路の守護）。命令は 12 回：
 * - 0 秒：榊原隊は道を東の抜け道の手前 (190,60) へ（途中で道の北の騎馬が打って出てくれば斬り合う）、徳川騎馬隊は (175,40) へ。
 * - 榊原隊が着いたら：榊原隊・騎馬隊で東の守りへ（抜け道は 1 部隊ずつ）。
 * - 東の守りが崩れたら：榊原隊・騎馬隊に撤退（退き口＝東の回り道の出口）。
 * - 東の守りが崩れ、西の騎馬も崩れたら（西の騎馬が来なければ 200 秒で待つのをやめる）：家康・弓・石川に撤退、忠勝隊は道の (110,0) へ。
 * - 忠勝隊が着いたら退路の守護（50 秒。後詰めの騎馬を引きつける）。家康が道の (150,0) まで来たら酒井隊に撤退。
 */
const EAST: Plan = (j) => {
    const W = (c: Cond) => late(c, j.d());
    const go = W(all(gone('e_east'), any(gone('e_west_kiba'), after(200))));
    const at = W(near('a_sakakibara', 190, 60, 12));
    return [
        [0, 'a_sakakibara', tap(190, 60)],
        [0, 'a_kiba', tap(175, 40)],
        [at, 'a_sakakibara', atk('e_east')],
        [at, 'a_kiba', atk('e_east')],
        [W(gone('e_east')), 'a_sakakibara', RET],
        [W(gone('e_east')), 'a_kiba', RET],
        [go, 'a_ieyasu', RET],
        [go, 'a_yumi', RET],
        [go, 'a_ishikawa', RET],
        [go, 'a_tadakatsu', tap(110, 0)],
        [W(near('a_tadakatsu', 110, 0, 12)), 'a_tadakatsu', 'ability'],
        [W(near('a_ieyasu', 150, 0, 15)), 'a_sakai', RET],
    ];
};
/** 東（守護なし）：EAST から退路の守護を抜く（忠勝隊は道の (110,0) で待つだけ） */
const EAST_NO_GUARD: Plan = (j) => EAST(j).filter((x) => x[2] !== 'ability');
/**
 * 東（能力なし・見てから当たる）：EAST を撤退ではなく出口を押す移動にし、退路の守護の代わりに、後詰めの騎馬が見えたら忠勝隊・酒井隊で当たる。
 * 命令は 13 回
 */
const EAST_PLAIN: Plan = (j) => [
    ...EAST_NO_GUARD(j).map((x): Step => (x[2] === RET ? [x[0], x[1], tap(...EX)] : x)),
    [late(seen('e_late'), j.d()), 'a_tadakatsu', atk('e_late')],
    [late(seen('e_late'), j.d()), 'a_sakai', atk('e_late')],
];
/**
 * 東（全軍撤退）：EAST と同じく東を開き、東の守りと西の騎馬が崩れたら（200 秒で待つのをやめる）、忠勝隊を道の (110,0) へ出してから全軍撤退を命じる。
 * 忠勝隊は退く途中で (110,0) に来たら退路の守護。命令は 7 回
 */
const EAST_ALL: Plan = (j) => {
    const W = (c: Cond) => late(c, j.d());
    const go = W(all(gone('e_east'), any(gone('e_west_kiba'), after(200))));
    const at = W(near('a_sakakibara', 190, 60, 12));
    return [
        [0, 'a_sakakibara', tap(190, 60)],
        [0, 'a_kiba', tap(175, 40)],
        [at, 'a_sakakibara', atk('e_east')],
        [at, 'a_kiba', atk('e_east')],
        [go, 'a_tadakatsu', tap(110, 0)],
        [go, 'a_ieyasu', 'allRetreat'],
        [W(near('a_tadakatsu', 110, 0, 12)), 'a_tadakatsu', 'ability'],
    ];
};

/**
 * 準備した南の正面（準備した正面攻撃。弓・予備・能力・兵種を使う）。命令は 20 回：
 * - 0 秒：弓隊は陣の南の口の外 (-6,64) へ（陣の北西から。着いたら 64 m 先の守りを射る。奥の弓は届くが弱まる）。忠勝隊・榊原隊は守りへ。家康は南の出口を押す（槍の列の後ろについて進む）。
 * - 10 秒：酒井隊・石川隊も守りへ（切れ目で同時に斬りかかれるのは 2 部隊まで。あふれた隊は後ろで待つ）。
 * - 榊原隊が守りの 45 m に来たら先駆けの号。忠勝隊が斬り合い始めたら家康の立て直しの号令。
 * - 守りが崩れたら：槍 4 と弓で二の手へ。
 * - 二の手が崩れたら：徳川騎馬隊（陣で待たせていた）で奥の弓へ。槍 4・弓は出口へ（家康はもう出口を押している）。
 */
const SOUTH: Plan = (j) => {
    const W = (c: Cond) => late(c, j.d());
    const g1 = W(gone('e_south'));
    const g2 = W(gone('e_south2'));
    return [
        [0, 'a_yumi', tap(-6, 64)],
        [W(near('a_yumi', -6, 64, 10)), 'a_yumi', atk('e_south')],
        [0, 'a_tadakatsu', atk('e_south')],
        [0, 'a_sakakibara', atk('e_south')],
        [0, 'a_ieyasu', tap(...SX)],
        [j.t(10), 'a_sakai', atk('e_south')],
        [j.t(10), 'a_ishikawa', atk('e_south')],
        [W(near('a_sakakibara', 0, 128, 45)), 'a_sakakibara', 'ability'],
        [W(engaged('a_tadakatsu', 'e_south')), 'a_ieyasu', 'ability'],
        [g1, 'a_tadakatsu', atk('e_south2')],
        [g1, 'a_sakakibara', atk('e_south2')],
        [g1, 'a_sakai', atk('e_south2')],
        [g1, 'a_ishikawa', atk('e_south2')],
        [g1, 'a_yumi', atk('e_south2')],
        [g2, 'a_kiba', atk('e_south_yumi')],
        [g2, 'a_tadakatsu', tap(...SX)],
        [g2, 'a_sakakibara', tap(...SX)],
        [g2, 'a_sakai', tap(...SX)],
        [g2, 'a_ishikawa', tap(...SX)],
        [g2, 'a_yumi', tap(...SX)],
    ];
};
/** 準備した南の正面（能力なし）：SOUTH から先駆けの号・立て直しの号令を抜く */
const SOUTH_NA: Plan = (j) => SOUTH(j).filter((x) => x[2] !== 'ability');
/** SOUTH で、忠勝隊が守りと斬り合い始めたら退路の守護を使う（南の切れ目：退く味方がいない場面） */
const SOUTH_GUARD: Plan = (j) => [...SOUTH(j), [late(engaged('a_tadakatsu', 'e_south'), j.d()), 'a_tadakatsu', 'ability']];

/** 本陣以外の 6 部隊 */
const MOVERS = ['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_sakakibara', 'a_kiba', 'a_yumi'];
/** 無計画（南へ一斉）：0 秒に家康を含む 7 部隊で南の出口を押す。後は何もしない */
const RUSH: Plan = () => [...MOVERS, 'a_ieyasu'].map((id) => [0, id, tap(...SX)] as Step);
/** 無計画（東へ一斉）：0 秒に家康を含む 7 部隊で東の回り道の出口を押す */
const RUSH_EAST: Plan = () => [...MOVERS, 'a_ieyasu'].map((id) => [0, id, tap(...EX)] as Step);
/** 無計画（当て直しだけ）：10 秒ごとに、6 部隊で見えている一番近い敵へ当て直す（第3群のテストと同じ） */
const NEAREST: Plan = () => MOVERS.flatMap((id) => Array.from({ length: 60 }, (_, k) => [1 + k * 10, id, 'nearest'] as Step));
/** 総大将だけを先に出す：0 秒に家康だけで出口を押す（ほかは動かさない） */
const HQ_ALONE_EAST: Plan = () => [[0, 'a_ieyasu', tap(...EX)]];
const HQ_ALONE_SOUTH: Plan = () => [[0, 'a_ieyasu', tap(...SX)]];
/** 東を開く前に総大将を出す：EAST_ALL に、0 秒に家康が東の回り道の出口を押す行を足す */
const EAST_HQ_FIRST: Plan = (j) => [[0, 'a_ieyasu', tap(...EX)], ...EAST_ALL(j)];
/** 始めに全軍撤退（1 秒）：退き口（東の回り道の出口）へ皆で退く */
const ALL_RETREAT_NOW: Plan = () => [[1, 'a_ieyasu', 'allRetreat']];

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

describe('包囲された陣のデータ', () => {
    it('検査を通る。味方 7／敵 9（後詰め 1 を含む・同時の部隊数は上限内）。主目標は脱出（総大将と 3 部隊。敵本陣の撃破ではない）。副目標 3 つ。判定の順・追い討ち・武将の自由な動き', () => {
        expect(validateField(BC)).toEqual([]);
        const us = presetUnits(BC, 'standard');
        expect(us.filter((u) => u.side === 'ally').map((u) => u.id)).toEqual(ALLY);
        const en = us.filter((u) => u.side === 'enemy');
        expect(en.map((u) => u.id)).toEqual(['e_hq', 'e_north', 'e_ne', 'e_west_kiba', 'e_south', 'e_south2', 'e_south_yumi', 'e_east', 'e_late']);
        expect(en.every((u) => u.clan === 'rival')).toBe(true);
        expect(en.length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.enemy);
        // 厚い南（槍 520・二の手 320・弓 220）と、手薄な東（槍 300）
        const str = (id: string) => en.find((u) => u.id === id)!.strength;
        expect(str('e_south') + str('e_south2') + str('e_south_yumi')).toBe(1060);
        expect(str('e_east')).toBe(300);
        expect(BC.objectives.primary).toMatchObject({ id: 'camp_escape', type: 'escape', count: 3, names: ['南の突破口の出口', '東の回り道の出口'] });
        expect(BC.objectives.secondary.map((o) => [o.id, o.type])).toEqual([
            ['camp_losses', 'limit_losses'],
            ['camp_yumi', 'preserve_unit'],
            ['camp_break', 'break_unit'],
        ]);
        expect(BC.endRules).toEqual({ order: ['objective_done', 'objective_failed', 'hq_lost', 'army_broken', 'nightfall', 'all_retreat'], allRetreat: 'count' });
        expect(BC.pursuit).toBe(true);
        expect(BC.generalInitiative).toBe(true);
        // 後詰めの騎馬は 200 秒に北東の端（援軍。画面に出る所の印が付く）
        expect(BC.reinforcements).toEqual([{ id: 'late', side: 'enemy', at: 200, point: { x: 190, z: -212, facing: Math.PI }, label: '敵勢の後詰め（北東から東の抜け道へ）' }]);
        // 味方の退き口（撤退の命令の行き先）は東の回り道の出口の中
        const P = BC.objectives.primary as Extract<typeof BC.objectives.primary, { type: 'escape' }>;
        expect(inZone(P.exits[1]!, BC.exits.ally.x, BC.exits.ally.z)).toBe(true);
        expect(inZone(P.exits[0]!, BC.exits.ally.x, BC.exits.ally.z)).toBe(false);
        // 合戦の前の説明：判定の順（最後の行）と、総大将の脱出は負けではないこと
        const s = createBattle(buildBattleSetup(BC, 'standard'));
        expect(s.setup.briefing.join('')).toContain('総大将が出口から離れても負けではない');
        expect(endRuleItems(s.setup)).toHaveLength(6);
        expect(endRuleItems(s.setup)[5]).toContain('退き口から離れた部隊も主目標に数え');
        expect(s.objectives!.secondary.map((r) => r.def.id)).toEqual([...SEC]);
    });

    it('地形（道探しを読む）：南の出口へは切れ目（幅 36 m）を通る。東の回り道の出口へは道を東へ出て、狭い抜け道（幅 24 m）を下る（陣の南東の湿地・南の谷を通らない）。南の谷から南東へは崖で行けない', () => {
        const s = createBattle(buildBattleSetup(BC, 'standard'));
        const nav = s.field.nav!;
        expect(nav).toBeTruthy();
        const south = findPath(nav, 'yari', 0, 0, ...SX)!;
        const east = findPath(nav, 'yari', 0, 0, ...EX)!;
        // 南：崖の帯（z 110〜130）の中の点は切れ目（|x| ≤ 18）
        for (const p of south.filter((q) => q.z >= 110 && q.z <= 130)) expect(Math.abs(p.x)).toBeLessThanOrEqual(18);
        // 東：z 20 より南の点は、みな東の抜け道の筋（x 175 より東）。崖の帯の中は抜け道（x 178〜202）
        for (const p of east.filter((q) => q.z > 20)) expect(p.x).toBeGreaterThan(175);
        for (const p of east.filter((q) => q.z >= 110 && q.z <= 130)) expect(p.x >= 178 && p.x <= 202).toBe(true);
        // 南の谷（切れ目の南）から南東の出口へは、切れ目を北へ戻ってから回る（谷と南東を分ける崖）
        const back = findPath(nav, 'yari', 0, 170, ...EX)!;
        expect(Math.min(...back.map((q) => q.z))).toBeLessThan(110);
        // 狭い正面：南の切れ目は 2 部隊まで、東の抜け道は 1 部隊まで
        expect(BC.specialRules!.map((r) => (r.type === 'narrow_frontage' ? r.maxEngaged : -1))).toEqual([2, 1]);
    });
});

// ---------------------------------------------------------------- 作戦

describe('包囲された陣：主目標に届く作戦（早送り）', () => {
    // 作った時：東を開いてから総大将を出す 282.8 秒・損害 9.5％・勝ち・損害 ✓ 弓 ✓ 南の守り ✗・7／7（家康は 274.3 秒に脱出、石川隊がその後に出て勝ち）
    it('東を開いてから総大将を出す：榊原隊・騎馬で東を開き、西の騎馬を陣で受けてから家康・弓・石川に撤退、忠勝は道で退路の守護 → 勝つ。遅いが損害は 1 割ほど（総大将の脱出の後も合戦は続く）', () => {
        const r = run1(EAST);
        expect(won(r), brief(r)).toBe(true);
        expect(r.o.reason).toBe('objective_done');
        expect(r.o.withdrawal).toBe('objective');
        expect(r.refused).toEqual([]);
        expect(r.t).toBeGreaterThan(240);
        expect(r.loss).toBeLessThan(0.15);
        expect(secondaries(r)).toEqual([true, true, false]);
        expect(standing(r)).toBe(7);
        // 総大将は出口から離れた後も合戦が続き（本陣の喪失・敗北にしない）、ほかの部隊が出て勝つ
        const hqOut = r.s.events.find((e) => e.text.startsWith('家康本陣が東の回り道の出口から脱出した'))!;
        expect(hqOut.t).toBeLessThan(r.t - 1);
        expect(r.s.events.some((e) => e.kind === 'rout' && e.text.includes('家康本陣'))).toBe(false);
        expect(r.o.objectives!.primary).toMatchObject({ type: 'escape', achieved: true, count: { done: 4, total: 4 } });
        // 南の守りとは戦わない
        expect(r.left.e_south2).toBe(320);
        expect(r.left.e_south_yumi).toBe(220);
    }, 60_000);

    // 作った時：南の準備 105.6 秒・損害 21.7％・勝ち・損害 ✗ 弓 ✗ 南の守り ✓・6／7（弓隊が西の騎馬に崩される。16 通りでは弓 ✓ が 15）
    it('南の厚い口を準備して破る（準備した正面攻撃）：弓で守りを射て、槍 4 でまとめて当たり（先駆け・号令）、騎馬は二の手が崩れてから弓へ → 勝つ。東より 2 分以上早いが、損害が大きい', () => {
        const r = run1(SOUTH);
        const e = run1(EAST);
        expect(won(r), brief(r)).toBe(true);
        expect(r.refused).toEqual([]);
        expect(Object.keys(r.o.abilitiesUsed ?? {}).sort()).toEqual(['a_ieyasu', 'a_sakakibara']);
        expect(r.t).toBeLessThan(e.t - 120);
        expect(r.loss).toBeGreaterThan(e.loss + 0.08);
        expect(secondaryOf(r, 'camp_losses')).toBe(false);
        expect(secondaryOf(r, 'camp_break')).toBe(true);
        // 守り・二の手・弓の 3 つを崩して抜けた（出口は南）
        for (const id of ['e_south', 'e_south2', 'e_south_yumi']) expect(statusOf(r, id)).not.toBe('ready');
        expect(r.s.events.some((ev) => ev.text.startsWith('家康本陣が南の突破口の出口から脱出した'))).toBe(true);
        // 家康は先頭に立たない（守りと最初に斬り合ったのは槍）
        const first = r.s.events.find((ev) => ev.text.endsWith('と敵勢の南の守りが交戦'))!;
        expect(first.text.startsWith('家康本陣')).toBe(false);
    }, 60_000);

    it('全軍撤退で退く（東を開き、忠勝を道に出してから全軍撤退）：命令から 20 秒を過ぎても合戦は打ち切らず、退き口から離れた部隊を数えて勝つ（目標を果たした撤収）', () => {
        const r = run1(EAST_ALL);
        expect(won(r), brief(r)).toBe(true);
        expect(r.allRetreatAt).not.toBeNull();
        // 作った時：161.3 秒に全軍撤退を命じ、274.7 秒に勝ち（命令から 113 秒・損害 11.5％）
        expect(r.t - r.allRetreatAt!).toBeGreaterThan(RULES.retreatGraceSec + 30);
        expect(r.o.reason).toBe('objective_done');
        expect(r.o.withdrawal).toBe('objective');
        expect(r.loss).toBeLessThan(0.15);
        expect(secondaries(r)).toEqual([true, true, false]);
    }, 60_000);

    it('東（能力なし）：守護の代わりに、後詰めの騎馬が見えたら忠勝隊・酒井隊で当たる → 勝つ（能力を使わなくても成り立つ）', () => {
        const r = run1(EAST_PLAIN);
        expect(won(r), brief(r)).toBe(true);
        expect(r.o.abilitiesUsed ?? {}).toEqual({});
        expect(secondaries(r)).toEqual([true, true, false]);
    }, 60_000);

    // 揺らぎの 16 通り（作った時）：東 16 勝（平均 294.5 秒・損害 9.9％・守れる 7.00）、全軍撤退 16 勝（286.4 秒・11.7％）、東（能力なし）15 勝（293.3 秒・11.5％。
    // 負けた k=7 は、忠勝隊・酒井隊が当たる前に後詰めの騎馬が家康の列に追いつき、家康が崩れた）、南の準備 16 勝（133.8 秒・19.6％・6.81。損害 ✓ 0・弓 ✓ 15・南の守り ✓ 16）、
    // 南の準備（能力なし）10 勝（137.7 秒・25.0％）
    it('安定性（±15 秒・見てから押すまでの遅れ 0〜15 秒の 16 通り）：東・全軍撤退・東（能力なし）は 14 勝以上、南の準備は 14 勝以上。南の準備（能力なし）は記録（10 勝）', () => {
        const e = run16(EAST);
        const a = run16(EAST_ALL);
        const p = run16(EAST_PLAIN);
        const sp = run16(SOUTH);
        const sn = run16(SOUTH_NA);
        expect(winsOf(e)).toBeGreaterThanOrEqual(14);
        expect(winsOf(a)).toBeGreaterThanOrEqual(14);
        expect(winsOf(p)).toBeGreaterThanOrEqual(14);
        expect(winsOf(sp)).toBeGreaterThanOrEqual(14);
        // 記録（能力なしの南は家康が西の騎馬に突かれて崩れやすい。号令のある準備した南より少ない）
        expect(winsOf(sn)).toBeGreaterThanOrEqual(7);
        expect(winsOf(sn)).toBeLessThan(winsOf(sp));
        // 16 通りの平均でも、東は遅く損害が少なく、南は早く損害が大きい
        expect(meanOf(sp.filter(won), (r) => r.t)).toBeLessThan(meanOf(e.filter(won), (r) => r.t) - 120);
        expect(meanOf(sp, (r) => r.loss)).toBeGreaterThan(meanOf(e, (r) => r.loss) + 0.08);
        // 副目標が作戦で分かれる：東は損害 ✓・南の守り ✗、南は南の守り ✓・損害はたいてい ✗
        expect(e.filter((r) => secondaryOf(r, 'camp_losses')).length).toBe(16);
        expect(e.filter((r) => secondaryOf(r, 'camp_break')).length).toBe(0);
        expect(sp.filter((r) => secondaryOf(r, 'camp_break')).length).toBe(16);
        expect(sp.filter((r) => secondaryOf(r, 'camp_losses')).length).toBeLessThanOrEqual(3);
        // 守れる部隊：東は 7 隊とも崩れずに出る
        expect(meanOf(e, standing)).toBeGreaterThan(meanOf(sp, standing));
    }, 180_000);
});

// 合格条件は「正面なら負ける」ではなく、同じ台本・同じ数字での比べ。無計画な攻撃・総大将を先に出した結果は「記録」として残す
describe('包囲された陣：無計画な攻撃・総大将を先に出す（早送り）', () => {
    // 第4群の確かめの直し（味方だけに塞がれた時間を、よけて回る間も数える・止まっている味方だけに塞がれている間は待機にしない）の前後（早送り。1 通り）：
    // 前は 130.0 秒に負け・損害 39.3％・3／7（家康本陣が陣の南の口で前の隊をよけ続けて列の前へ出て、南の守りと斬り合った）。
    // 後は家康本陣が前の隊の中をすり抜けて列の後ろに残り、弓隊が守りに当たる：132.4 秒に勝ち（総大将と 2 部隊が出口から脱出、残り 1 部隊も続く）・
    // 損害 24.9％・戦える 5（準備した南は 6）。騎馬隊が槍の正面に当たって全滅するのは同じ。準備した南（1 通り 21.7％・16 通りの平均 19.6％）との損害の差は 15 点以上 → 3 点ほどに縮んだ。
    // 「無計画でも勝つ」は正面攻撃を一律に負けにしない決まりにも合うが、準備の価値（損害の差）が小さくなったので、戦場のデータの釣り合いの担当へ伝える。
    // 比べは「準備した南の方が損害が少なく、騎馬隊を残す」に直し、数字は記録として固定する
    it('無計画（南へ一斉。家康も 0 秒に出口を押す）→ 騎馬隊が槍の正面に当たって全滅する。準備した南は同じ口で騎馬隊を残し、損害も少ない（記録：直しの前 130.0 秒に負け・39.3％ → 後 132.4 秒に勝ち・24.9％）', () => {
        const r = run1(RUSH);
        const p = run1(SOUTH);
        expect(r.refused).toEqual([]);
        expect(r.loss).toBeGreaterThan(p.loss);
        expect(statusOf(r, 'a_kiba')).toBe('destroyed');
        expect(statusOf(p, 'a_kiba')).not.toBe('destroyed');
        // 16 通りの平均（準備した南）と比べても損害が大きい（一斉は時刻の行が 0 秒だけなので 16 通りとも同じ）
        expect(r.loss).toBeGreaterThan(meanOf(run16(SOUTH), (x) => x.loss));
        // 記録
        expect([r.o.result, r.o.reason, Math.round(r.t * 10) / 10, Math.round(r.loss * 1000) / 10, standing(r)]).toEqual(['victory', 'objective_done', 132.4, 24.9, 5]);
        expect(standing(p)).toBe(6);
        expect(won(p)).toBe(true);
    }, 60_000);

    it('無計画（東へ一斉。家康も）→ 狭い抜け道で列が止まり、道の北の騎馬に横を突かれて、出られる部隊が足りなくなって負け（記録：101.1 秒・損害 37.0％・3／7）。東を開いてから出す台本は勝つ', () => {
        const r = run1(RUSH_EAST);
        expect([r.o.result, r.o.reason]).toEqual(['defeat', 'objective_failed']);
        expect(r.loss).toBeGreaterThan(run1(EAST).loss + 0.15);
        expect(standing(r)).toBeLessThan(standing(run1(EAST)) - 2);
    }, 60_000);

    it('一番近い敵へ当て直すだけ → 主目標に届かず、損害が大きい（記録：日没・損害 52.8％・4／7）。待つだけ → 日没（撤退）・損害 0', () => {
        const r = run1(NEAREST);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.o.reason).toBe('nightfall');
        expect(r.loss).toBeGreaterThan(run1(SOUTH).loss + 0.2);
        const h = play([]);
        expect([h.o.result, h.o.reason]).toEqual(['retreat', 'nightfall']);
        expect(h.o.objectives!.primary).toMatchObject({ achieved: false, count: { done: 0, total: 4 } });
        expect(h.loss).toBeLessThan(0.05);
    }, 60_000);

    it('総大将だけを先に出す → 東は道の北の騎馬に、南は切れ目の守りに捕まって崩れ、負け（記録：東 36.9 秒・南 65.2 秒）。東を開く前に家康を出した全軍撤退の台本も負け（153.4 秒。開いてから出せば勝つ）', () => {
        for (const p of [HQ_ALONE_EAST, HQ_ALONE_SOUTH, EAST_HQ_FIRST]) {
            const r = run1(p);
            expect([r.o.result, r.o.reason], brief(r)).toEqual(['defeat', 'objective_failed']);
            expect(statusOf(r, 'a_ieyasu')).toBe('routed');
            expect(r.o.objectives!.primary!.count).toEqual({ done: 0, total: 4 });
        }
        expect(run1(HQ_ALONE_EAST).t).toBeLessThan(60);
        expect(won(run1(EAST_ALL))).toBe(true);
    }, 60_000);

    it('始めに全軍撤退（1 秒）→ 東の回り道を退く列に道の北の騎馬が追い討ちをかけ、家康が崩れて負け（主目標の失敗。命令から 20 秒で「撤退」に打ち切らない。記録：46.4 秒）', () => {
        const r = run1(ALL_RETREAT_NOW);
        expect(r.allRetreatAt).toBe(1);
        expect([r.o.result, r.o.reason]).toEqual(['defeat', 'objective_failed']);
        expect(r.t - 1).toBeGreaterThan(RULES.retreatGraceSec);
        expect(r.s.events.some((e) => e.kind === 'ai' && e.text.includes('追い討ち'))).toBe(true);
    }, 60_000);
});

describe('包囲された陣：総大将の脱出と数え方（状態を直接操作）', () => {
    /** 敵をすべて戦場から外す（目標の数え方だけを見るため） */
    function freezeEnemies(s: BattleState): void {
        for (const u of s.units) if (u.side === 'enemy') u.present = false;
    }
    function step(s: BattleState, sec: number): void {
        for (let i = 0; i < Math.round(sec / RULES.tick); i++) stepBattle(s, RULES.tick);
    }

    it('状態を直接操作：総大将が先に出口から離れても合戦は続く。残りが崩れて出られる部隊が 3 に足りなくなると、その時に負け（主目標の失敗。本陣の喪失ではない）', () => {
        const s = createBattle(buildBattleSetup(BC, 'standard'));
        freezeEnemies(s);
        const hq = unitById(s, 'a_ieyasu')!;
        hq.x = 192;
        hq.z = 210;
        hq.path = null;
        step(s, 1);
        expect(hq.status).toBe('withdrawn');
        expect(s.result).toBeNull();
        expect(objectiveProgress(s)[0]!.progressText).toContain('総大将 済み・ほか 0／3 部隊が脱出');
        // 1 部隊が出る
        const y = unitById(s, 'a_yumi')!;
        y.x = 0;
        y.z = 210;
        y.path = null;
        step(s, 1);
        expect(s.result).toBeNull();
        // 残り 5 部隊のうち 4 部隊が崩れる → 出られるのは 1（脱出済み 1 と合わせて 2 ＜ 3）
        for (const id of ['a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa']) unitById(s, id)!.morale = 0;
        step(s, 0.2);
        expect(s.result?.result).toBe('defeat');
        expect(s.result?.reason).toBe('objective_failed');
        expect(s.result?.objectives?.primary).toMatchObject({ type: 'escape', achieved: false, count: { done: 2, total: 4 } });
    });

    it('状態を直接操作：総大将が先に出て、残り 3 部隊が後から出れば勝ち（出た順は問わない）', () => {
        const s = createBattle(buildBattleSetup(BC, 'standard'));
        freezeEnemies(s);
        const put = (id: string, x: number, z: number) => {
            const u = unitById(s, id)!;
            u.x = x;
            u.z = z;
            u.path = null;
        };
        put('a_ieyasu', 0, 210);
        step(s, 1);
        expect(s.result).toBeNull();
        put('a_kiba', 192, 210);
        put('a_sakakibara', 0, 210);
        step(s, 1);
        expect(s.result).toBeNull();
        put('a_tadakatsu', 200, 212);
        step(s, 0.2);
        expect([s.result?.result, s.result?.reason, s.result?.withdrawal]).toEqual(['victory', 'objective_done', 'objective']);
    });
});

// ---------------------------------------------------------------- 武将の能力

describe('包囲された陣：武将の能力の価値が場面で変わる（早送り）', () => {
    // 本多忠勝の退路の守護（50 秒。忠勝隊はその場で踏みとどまる。範囲 100 m で退く味方の受ける損害 −80％、追っ手を忠勝隊へ引きつける）
    it('退路の守護：東の道で撤退の列の後ろに置くと、後詰めの騎馬が忠勝隊へ引きつけられ、列は無事に出る（使わないと列が追われて崩れ、日没）。南の切れ目で攻める最中に使うと、退く味方がいないので何も引きつけず、忠勝隊は踏みとどまったまま削られる', () => {
        const g = run1(EAST);
        const n = run1(EAST_NO_GUARD);
        // 東：使う（作った時）＝勝ち・損害 9.5％・引きつけ 1・列（家康・弓・石川・酒井）の兵 1319／1350。使わない＝日没・36.3％・列の兵 627
        const column = (r: Run) => ['a_ieyasu', 'a_yumi', 'a_ishikawa', 'a_sakai'].reduce((a, id) => a + r.left[id]!, 0);
        expect(g.lured).toBeGreaterThan(0);
        expect(n.lured).toBe(0);
        expect(won(g)).toBe(true);
        expect(won(n)).toBe(false);
        expect(column(g)).toBeGreaterThan(column(n) + 400);
        // 南：使う（作った時）＝引きつけ 0・忠勝隊は踏みとどまったまま、二の手への攻撃・出口への命令が断られ、兵 144 まで減る（受ける損害 ×1.4）。
        // 使わない（SOUTH）＝忠勝隊の兵 290
        const sg = run1(SOUTH_GUARD);
        const sp = run1(SOUTH);
        expect(sg.lured).toBe(0);
        expect(sg.refused.some((x) => x.endsWith(':a_tadakatsu'))).toBe(true);
        expect(sg.left.a_tadakatsu!).toBeLessThan(sp.left.a_tadakatsu! - 100);
    }, 60_000);
});
