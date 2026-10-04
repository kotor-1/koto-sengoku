/**
 * 戦場「退却戦」（rearguard）の作戦と釣り合い（docs/fields-group4-request.md §3 の 18・docs/fields-group4-design.md §3・§5）。
 * 北から追ってくる敵勢（追っ手の騎馬 2 が 20 秒ほど・槍の追っ手 2 が 40 秒ほどで原の味方に当たる。45 秒に切れ目の北の口の西の林から伏兵の騎馬。
 * 100 秒・130 秒で後詰め）を受けながら、総大将（家康本陣）とほかの 4 部隊を南の退き口から離脱させる（withdraw。目標どおり退けば勝利）。
 *
 * 確かめること：
 * - データ（状態を直接見る）：検査を通る・主目標と判定の順・追い討ち・部隊数・地形（丘・崖の切れ目・伏兵の林）。
 * - 主目標に届く作戦（早送り）が 5 つあり、±15 秒（見てから押す行は 0〜15 秒の遅れ）の 16 通りで安定する。作戦どうしで損害・時間・副目標・
 *   守れる部隊が違う。殿を置いて順に退く作戦（殿 2 隊）がいちばん良い（損害・副目標）。忠勝の守護は使わない。
 * - 開始直後（0〜3 秒）の全軍撤退は勝つこともあるが、損害・崩れが目に見えて大きい（一律の負けではない）。
 * - 列の中の順番（足の遅い隊を先に／総大将をいつ出すか）で結果が変わる。
 * - 全軍で一気に退く（全軍撤退の号令・全部隊を同時に退き口へ）は、殿を置いて順に下げるより損害が大きく、要る数に届かないこともある。
 * - 敵が実際に追い討ちをかける（追い討ちの数・退く隊の損害）。退路の守護を使う／使わないで、撤退の命令で退く隊の損害が変わる。
 * - 全軍撤退の号令で、目標の前に合戦を打ち切らない。目標を果たした撤収（勝利）と、届かなかった撤退が記録で分かれる。
 * - 殿の置き場所（列の前・後ろ・脇）で結果が変わる。副目標が作戦で分かれる組。
 * - 準備した正面攻撃（騎馬・号令で追っ手と伏兵を崩してから退く）と無計画な攻撃（全部隊同時・部隊ごとにずらす 2 通り。近い敵へ当て直すだけ）の比べ。
 *   「正面なら必ず負ける」は合格条件にしない（準備した正面攻撃は勝てる。時間と損害が大きい、を比べとして書く）。
 * - 武将の能力の価値が場面で変わる比べ（退路の守護：撤退の命令で下げる列には勝敗を分けるほど効き、移動で下げる列にはほとんど効かない）。
 *
 * どれも「早送り」（決まった時刻・見てから押す行で issueOrder・useAbility・orderAllRetreat を出す台本を runToEnd で最後まで進める）。
 * 画面の操作ではない。台本は人が画面でできる程度にしている：命令は 1 つの台本で 12 回まで、続けて押す間は 1 秒以上（もとの台本で確かめる）。
 * 移動の後の向き（face）は画面から指定できないので使わない。画面では敵の近くの地面を押すとその敵への攻撃になるので、台本の地面の行き先（tap）も、
 * 押す点の 20 m 以内に見えている敵がいればその敵への攻撃にする（tests/proto3d-group3-helpers.ts の tapOrder）。
 * ±15 秒の 16 通りは、0 秒でない時刻の行を ±15 秒ずらし、「見てから押す」行は条件が初めて満たされてから 0〜15 秒遅らせて押す（決まった乱数）。
 * 開始直後の全軍撤退だけは、押す時刻を 0.1・1・2・3 秒の 4 つ（4 回ずつ）にした 16 通り（sixteenEarly）。
 *
 * 作った時の結果（早送り・16 通り。勝ち数・平均の損害・平均の時間・副目標「損害 1 割以内」「忠勝隊を崩さずに」を果たした数・崩れた味方の隊の平均）。
 * 左が直しの前（追っ手の騎馬は北 150 m・伏兵なし）、右が今の版（追っ手の騎馬は北 125 m・45 秒に伏兵の騎馬）：
 * - 殿 2 隊（TWO_REAR。新しく足した）：前 16 勝・5.1％・16／16・16／16・0.00 → 16 勝・7.3％・71 秒・15／16・16／16・0.06。
 * - 殿＋騎馬の横槍（REAR）：前 16 勝・6.2％・89 秒・15・16・0.06 → 15 勝・11.7％・84 秒・4・7・1.06（騎馬が殿と一緒に戻り、伏兵に当たる）。
 * - 殿を前に残すだけ（STAY）：前 16 勝・7.3％・67 秒・16・6・0.63 → 16 勝・7.8％・67 秒・15・0・1.06（殿 1 隊は追っ手の騎馬に崩れる）。
 * - 撤退の命令の列＋退路の守護（GUARD。守護を 10 秒 → 7 秒）：前 14 勝・12.1％・61 秒・10・3・1.25 → 13 勝・14.0％・61 秒・6・2・1.50。
 *   同じ列で守護なし（GUARD_NO）：前 9 勝・15.7％ → 1 勝・19.3％・崩れ 2.81。移動の列＋守護（GUARD_MOVE）：前 16 勝・8.2％ → 16 勝・10.6％。
 * - 準備した正面攻撃（FRONT。本陣を原の東へ寄せ、伏兵に騎馬で当たる 3 行を足した）：前 16 勝・18.0％・191 秒 → 15 勝・21.0％・182 秒・0・15・0.63。
 *   家康の号令なし（FRONT_NO_AB）：前 13 勝・21.3％ → 14 勝・24.9％。もとの FRONT のままだと今の版で 10 勝・32.0％（伏兵が原に残った本陣を突く）。
 *   無計画：全部隊同時（UNPLANNED）0 勝・21.3％・崩れ 2.13 ／ずらす 1（UNPLANNED_STAG1）0 勝・26.2％ ／ずらす 2（UNPLANNED_STAG2）0 勝・35.4％。
 * - 開始直後の全軍撤退（ALLRET_EARLY。0〜3 秒）：前 16 勝・8.2％・16・16・0.00（いちばん良かった）→ 12 勝・12.5％・57 秒・0・12・1.75。
 *   全軍撤退の号令（ALLRET。5 秒±15）：前 9 勝・14.3％ → 7 勝・17.8％・崩れ 1.81。全部隊を同時に退き口へ（MOVEALL）：前 11 勝・13.5％ → 9 勝・14.8％・2.25。
 * - 列の順（殿 1 隊／殿 2 隊）：足の遅い隊と総大将を後に（SLOW_LAST／TWO_SLOW_LAST）16 勝・9.9％・損害 1 割以内 9 ／15 勝・9.2％・9
 *   （前の版の殿 1 隊では 16 勝・7.3％・16：順番が効かなかった）。総大将を殿と一緒に残す（HQ_WITH_REAR／TWO_HQ_WITH）0 勝／6 勝。
 * - 殿の置き場所：列の前＝北の丘（STAY）16 勝・7.8％ ／列の後ろ＝切れ目の北の口（STAY_CUT）8 勝・14.0％・崩れ 2.31 ／
 *   脇＝西（STAY_WEST）10 勝・14.9％・崩れ 2.25。
 * 数字はどれも細かい位置・時刻で動くので、勝ち数・副目標の数は「比べ」と「下限」で確かめ、等しさで縛るのは記録として安定している所だけにした。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, elevationAt, issueOrder, isActive, orderAllRetreat, runToEnd, stepBattle, unitById, RULES, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { isPassable } from '../proto3d/src/battle/pathfind';
import { buildBattleSetup, getField, validateField } from '../proto3d/src/battle/fields';
import { endRuleBriefingLine, withdrawalNote } from '../proto3d/src/battle/objectives';
import { parsePracticeData, practiceBriefingInfo, practiceResultInfo, recordFromOutcome } from '../proto3d/src/campaign/practice';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';
import { atk, nearestEnemy, tap, tapOrder, type Tap } from './proto3d-group3-helpers';

const RF = getField('rearguard')!;
/** 退き口の中の押す点（南の端の輪の中） */
const EXIT_Z = 205;

// ---------------------------------------------------------------- 台本の道具

/** 'ability' は固有能力（対象の要らない能力）、'nearest' は見えている一番近い敵へ攻撃、'allRetreat' は全軍撤退の号令（部隊 id は '*'） */
type Cmd = Order | Tap | 'ability' | 'nearest' | 'allRetreat';
type Cond = (s: BattleState) => boolean;
/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]、または [条件, 部隊 id, 命令]（見てから押す。条件が初めて真になった刻みに 1 回） */
type Step = [number, string, Cmd] | [Cond, string, Cmd];

const U = (s: BattleState, id: string) => unitById(s, id)!;
/** 敵の部隊が崩れた（着いていて、戦えない） */
const broken = (...ids: string[]) => (s: BattleState) => ids.every((id) => U(s, id).arrived && U(s, id).status !== 'ready');
const KIBA = ['e_kiba_l', 'e_kiba_r'];
/** 追っ手の騎馬のどれかが斬り合っている（殿に当たった） */
const kibaEngaged = (s: BattleState) => KIBA.some((id) => !!U(s, id).engagedWith);
/** 槍の追っ手のどれかが斬り合っている */
const vanEngaged = (s: BattleState) => ['e_van_l', 'e_van_r'].some((id) => !!U(s, id).engagedWith);
/** 条件が初めて真になってから sec 秒後（人が見てから少し置いて押す） */
function later(cond: Cond, sec: number): Cond {
    const first = new WeakMap<BattleState, number>();
    return (s) => {
        if (!first.has(s) && cond(s)) first.set(s, s.t);
        const f = first.get(s);
        return f !== undefined && s.t >= f + sec - 1e-9;
    };
}
/** 忠勝隊が退路の守護を使ってから sec 秒後（効果の 50 秒が終わってから押す） */
const afterGuard = (sec: number) => later((s) => s.abilityList.some((r) => r.unitId === 'a_tadakatsu' && r.usedAt !== null), sec);

interface Run {
    o: BattleOutcome;
    t: number;
    /** 味方の兵の損害の割合（0〜1） */
    loss: number;
    /** 忠勝隊を除く 6 部隊の損害の割合（退く隊の損害） */
    colLoss: number;
    refused: string[];
    /** 命令を出した時刻（人が押した時刻） */
    cmdT: number[];
    s: BattleState;
}

function play(steps: Step[], each?: (s: BattleState) => void): Run {
    const s = createBattle(buildBattleSetup(RF, 'standard'));
    const timed = steps.filter((x): x is [number, string, Cmd] => typeof x[0] === 'number').sort((a, b) => a[0] - b[0]);
    const watch = steps.filter((x): x is [Cond, string, Cmd] => typeof x[0] === 'function');
    const fired = new Set<number>();
    const refused: string[] = [];
    const cmdT: number[] = [];
    const run = (st: BattleState, label: string, id: string, ord: Cmd) => {
        cmdT.push(st.t);
        if (ord === 'allRetreat') {
            if (!orderAllRetreat(st)) refused.push(`${label}:*`);
        } else if (ord === 'nearest') {
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
    const col = al.filter((u) => u.id !== 'a_tadakatsu');
    const colLoss = 1 - col.reduce((a, u) => a + u.endStrength, 0) / col.reduce((a, u) => a + u.startStrength, 0);
    return { o, t: s.t, loss, colLoss, refused, cmdT, s };
}

/**
 * 16 通り（決まった乱数）：0 秒でない時刻の行を ±15 秒ずらし（0.1 秒より前にはしない）、「見てから押す」行は条件が初めて満たされてから
 * 0〜15 秒遅らせて押す
 */
function jitter(base: Step[]): Run[] {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const out: Run[] = [];
    for (let k = 0; k < 16; k++) {
        const steps = base.map((x): Step => {
            if (typeof x[0] === 'number') return x[0] === 0 ? x : [Math.max(0.1, x[0] + Math.round((rnd() - 0.5) * 30)), x[1], x[2]];
            return [later(x[0], Math.round(rnd() * 15)), x[1], x[2]];
        });
        out.push(play(steps));
    }
    return out;
}

const won = (r: Run) => r.o.result === 'victory' && r.o.objectives?.primary?.achieved === true;
const sec = (r: Run, id: string) => r.o.objectives!.secondary.find((x) => x.id === id)!.achieved;
const wins = (rs: Run[]) => rs.filter(won).length;
const count = (rs: Run[], id: string) => rs.filter((r) => sec(r, id)).length;
const mean = (rs: Run[], f: (r: Run) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
/** 崩れた（敗走・全滅）味方の部隊の数 */
const routed = (r: Run) => r.o.units.filter((u) => u.side === 'ally' && (u.status === 'routed' || u.status === 'destroyed')).length;
/** 退き口から離れた部隊の数（総大将を含む） */
const outCount = (r: Run) => r.o.objectives!.primary!.count!.done;
const pursuits = (r: Run) => r.s.events.filter((e) => e.kind === 'ai' && e.text.includes('追い討ちをかける')).length;
const blocked = (r: Run) => r.s.events.filter((e) => e.kind === 'ai' && (e.text.includes('が阻む') || e.text.includes('引きつけられた'))).length;
const brief = (r: Run) =>
    `${r.o.result}/${r.o.reason} t=${r.t.toFixed(1)} loss=${(r.loss * 100).toFixed(1)}% out=${outCount(r)} ${r.o.objectives?.secondary.map((x) => `${x.id}:${x.achieved ? '✓' : '✗'}`).join(' ')} refused=${r.refused.join(',')}`;

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

const exitTap = (x: number) => tap(x, EXIT_Z);
const RET: Order = { type: 'retreat' };
/** 忠勝隊が戦える（崩れた隊へは命令を押さない。人が画面で見て押すのと同じ） */
const tadaUp = (s: BattleState) => isActive(U(s, 'a_tadakatsu'));
/** 伏兵の騎馬が現れて見えている */
const ambSeen = (s: BattleState) => {
    const u = U(s, 'e_amb');
    return u.arrived && isActive(u) && u.seenBy.ally;
};
/** 列を移動で退き口へ（酒井隊・石川隊（両脇）→ 弓 → 本陣 の順に 1 秒おき） */
const COLUMN: Step[] = [
    [1, 'a_sakai', exitTap(-30)],
    [2, 'a_ishikawa', exitTap(30)],
    [3, 'a_yumi', exitTap(-15)],
    [4, 'a_ieyasu', exitTap(0)],
];
/**
 * 殿 2 隊（命令 8 回）：酒井隊を忠勝隊の西 (-25,-10) へ寄せて殿を 2 隊にし、石川隊・弓・本陣・騎馬 2 隊を順に退き口へ。
 * 追っ手の騎馬が 2 つとも崩れたら、殿の 2 隊も退き口へ（いちばん損害が少なく、忠勝隊も残る）
 */
const TWO_REAR: Step[] = [
    [1, 'a_sakai', tap(-25, -10)],
    [2, 'a_ishikawa', exitTap(30)],
    [3, 'a_yumi', exitTap(-15)],
    [4, 'a_ieyasu', exitTap(0)],
    [5, 'a_kiba', exitTap(-45)],
    [6, 'a_sakakibara', exitTap(45)],
    [broken(...KIBA), 'a_tadakatsu', exitTap(10)],
    [later(broken(...KIBA), 1), 'a_sakai', exitTap(-30)],
];
/**
 * 殿＋騎馬の横槍（命令 9 回）：列を順に下げ、忠勝隊は北の丘（持ち場のまま）で追っ手の騎馬を受ける。追っ手の騎馬が殿に当たったのを見て、
 * 榊原隊・徳川騎馬隊で横から突く。追っ手の騎馬が 2 つとも崩れたら、殿と騎馬も退き口へ
 */
const REAR: Step[] = [
    ...COLUMN,
    [later(kibaEngaged, 1), 'a_sakakibara', atk('e_kiba_r')],
    [later(kibaEngaged, 2), 'a_kiba', atk('e_kiba_l')],
    [(s) => broken(...KIBA)(s) && tadaUp(s), 'a_tadakatsu', exitTap(10)],
    [later(broken(...KIBA), 1), 'a_sakakibara', exitTap(45)],
    [later(broken(...KIBA), 2), 'a_kiba', exitTap(-45)],
];
/** 殿を前に残すだけ（命令 7 回）：列と騎馬を順に下げ、忠勝隊だけが北の丘で追っ手の騎馬を受ける。騎馬が 2 つとも崩れたら殿も下げる */
const stay = (post?: [number, number]): Step[] => [
    ...(post ? [[0, 'a_tadakatsu', tap(...post)] as Step] : []),
    ...COLUMN,
    [5, 'a_kiba', exitTap(-45)],
    [6, 'a_sakakibara', exitTap(45)],
    [(s) => broken(...KIBA)(s) && tadaUp(s), 'a_tadakatsu', exitTap(10)],
];
const STAY = stay();
/** 殿を列の後ろ（切れ目の北の口）に置く：始めに忠勝隊を (0,72) へ（列が殿より北に残る） */
const STAY_CUT = stay([0, 72]);
/** 殿を脇（西）に置く：始めに忠勝隊を (-70,20) へ */
const STAY_WEST = stay([-70, 20]);
/** 列の順を変える（殿は忠勝隊 1 隊）：騎馬を先に、足の遅い隊（槍・弓）と総大将を後に（2 秒おき） */
const SLOW_LAST: Step[] = [
    [1, 'a_kiba', exitTap(-45)],
    [3, 'a_sakakibara', exitTap(45)],
    [5, 'a_sakai', exitTap(-30)],
    [7, 'a_ishikawa', exitTap(30)],
    [9, 'a_yumi', exitTap(-15)],
    [11, 'a_ieyasu', exitTap(0)],
    [(s) => broken(...KIBA)(s) && tadaUp(s), 'a_tadakatsu', exitTap(10)],
];
/** 列の順を変える（殿は忠勝隊 1 隊）：総大将を殿と一緒に残し、追っ手の騎馬が崩れてから下げる */
const HQ_WITH_REAR: Step[] = [
    [1, 'a_sakai', exitTap(-30)],
    [2, 'a_ishikawa', exitTap(30)],
    [3, 'a_yumi', exitTap(-15)],
    [5, 'a_kiba', exitTap(-45)],
    [6, 'a_sakakibara', exitTap(45)],
    [(s) => broken(...KIBA)(s) && tadaUp(s), 'a_tadakatsu', exitTap(10)],
    [later(broken(...KIBA), 1), 'a_ieyasu', exitTap(0)],
];
/** 殿 2 隊で、列の順を変える */
const two = (col: Step[]): Step[] => [
    [1, 'a_sakai', tap(-25, -10)],
    ...col,
    [broken(...KIBA), 'a_tadakatsu', exitTap(10)],
    [later(broken(...KIBA), 1), 'a_sakai', exitTap(-30)],
];
/** 殿 2 隊・騎馬を先に、足の遅い隊と総大将を後に（2 秒おき） */
const TWO_SLOW_LAST = two([
    [2, 'a_kiba', exitTap(-45)],
    [4, 'a_sakakibara', exitTap(45)],
    [6, 'a_ishikawa', exitTap(30)],
    [8, 'a_yumi', exitTap(-15)],
    [10, 'a_ieyasu', exitTap(0)],
]);
/** 殿 2 隊・総大将を殿と一緒に残し、追っ手の騎馬が崩れてから下げる */
const TWO_HQ_WITH: Step[] = [
    ...two([
        [2, 'a_ishikawa', exitTap(30)],
        [3, 'a_yumi', exitTap(-15)],
        [5, 'a_kiba', exitTap(-45)],
        [6, 'a_sakakibara', exitTap(45)],
    ]),
    [later(broken(...KIBA), 2), 'a_ieyasu', exitTap(0)],
];
/**
 * 撤退の命令の列（6 部隊。1 秒おき）。guard なら 7 秒に退路の守護、効果が終わってから殿を退き口へ。守護なしなら追っ手の騎馬が崩れてから殿を下げる。
 * （追っ手の騎馬が 20 秒ほどで丘に着くようになったので、守護は前の 10 秒から 7 秒へ早めた）
 */
const retreatColumn = (guard: boolean): Step[] => [
    ...['a_sakai', 'a_ishikawa', 'a_yumi', 'a_ieyasu', 'a_kiba', 'a_sakakibara'].map((id, i) => [1 + i, id, RET] as Step),
    ...(guard
        ? [[7, 'a_tadakatsu', 'ability'] as Step, [(s: BattleState) => afterGuard51(s) && tadaUp(s), 'a_tadakatsu', exitTap(10)] as Step]
        : [[(s: BattleState) => broken(...KIBA)(s) && tadaUp(s), 'a_tadakatsu', exitTap(10)] as Step]),
];
const afterGuard51 = afterGuard(51);
const GUARD = retreatColumn(true);
const GUARD_NO = retreatColumn(false);
/** 移動の列（STAY と同じ）＋退路の守護（7 秒）。効果が終わってから殿を下げる（能力の価値の比べ） */
const GUARD_MOVE: Step[] = [
    ...COLUMN,
    [5, 'a_kiba', exitTap(-45)],
    [6, 'a_sakakibara', exitTap(45)],
    [7, 'a_tadakatsu', 'ability'],
    [(s) => afterGuard51(s) && tadaUp(s), 'a_tadakatsu', exitTap(10)],
];
/** 全軍撤退の号令（5 秒。命令 1 回） */
const ALLRET: Step[] = [[5, '*', 'allRetreat']];
/** 開始直後の全軍撤退の号令（1 秒。命令 1 回）。16 通りは押す時刻を 0.1・1・2・3 秒に（sixteenEarly） */
const ALLRET_EARLY: Step[] = [[1, '*', 'allRetreat']];
/** 全部隊を同時に退き口へ（移動。殿なし。1 秒おきに 7 部隊） */
const MOVEALL: Step[] = [
    [1, 'a_ieyasu', exitTap(0)],
    [2, 'a_tadakatsu', exitTap(10)],
    [3, 'a_sakai', exitTap(-30)],
    [4, 'a_ishikawa', exitTap(30)],
    [5, 'a_yumi', exitTap(-15)],
    [6, 'a_sakakibara', exitTap(45)],
    [7, 'a_kiba', exitTap(-45)],
];
/**
 * 準備した正面攻撃（命令 10 回）：弓を丘の脇 (-20,0) へ、石川隊・酒井隊を忠勝隊の両脇へ出し、本陣を原の東 (20,15) へ寄せて（伏兵の通り道から離す）受ける。
 * 追っ手の騎馬が殿に当たったら騎馬 2 隊で横を突き、伏兵の騎馬が見えたら騎馬 2 隊でそちらへ当たる。槍の追っ手と斬り合い始めたら家康の号令。
 * 槍の追っ手が 2 つとも崩れたら全軍撤退の号令
 */
const FRONT: Step[] = [
    [1, 'a_yumi', tap(-20, 0)],
    [2, 'a_ishikawa', tap(35, -5)],
    [3, 'a_sakai', tap(-35, -5)],
    [4, 'a_ieyasu', tap(20, 15)],
    [later(kibaEngaged, 1), 'a_sakakibara', atk('e_kiba_r')],
    [later(kibaEngaged, 2), 'a_kiba', atk('e_kiba_l')],
    [later(ambSeen, 1), 'a_sakakibara', atk('e_amb')],
    [later(ambSeen, 2), 'a_kiba', atk('e_amb')],
    [later(vanEngaged, 1), 'a_ieyasu', 'ability'],
    [later(broken('e_van_l', 'e_van_r'), 2), '*', 'allRetreat'],
];
/** 同じ配置で能力（家康の号令）を使わない */
const FRONT_NO_AB: Step[] = FRONT.filter((x) => x[2] !== 'ability');
/** 無計画：全部隊で、見えている一番近い敵へ 10 秒ごとに当て直すだけ（退かない） */
const UNPLANNED: Step[] = [];
for (const id of ['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_sakakibara', 'a_kiba', 'a_yumi']) for (let t = 1; t < 540; t += 10) UNPLANNED.push([t, id, 'nearest']);
/** 無計画（部隊ごとにずらす 1）：部隊ごとに 3 秒ずつ遅らせて、10 秒ごとに近い敵へ */
const UNPLANNED_STAG1: Step[] = [];
['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_sakakibara', 'a_kiba', 'a_yumi'].forEach((id, i) => {
    for (let t = 1 + i * 3; t < 540; t += 10) UNPLANNED_STAG1.push([t, id, 'nearest']);
});
/** 無計画（部隊ごとにずらす 2）：部隊ごとに 7 秒ずつ遅らせて始め、15〜19 秒ごとに近い敵へ */
const UNPLANNED_STAG2: Step[] = [];
['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_sakakibara', 'a_kiba', 'a_yumi'].forEach((id, i) => {
    for (let t = 2 + i * 7; t < 540; t += 15 + (i % 3) * 2) UNPLANNED_STAG2.push([t, id, 'nearest']);
});

const ALL_PLANS: Record<string, Step[]> = {
    TWO_REAR,
    REAR,
    STAY,
    STAY_CUT,
    STAY_WEST,
    SLOW_LAST,
    HQ_WITH_REAR,
    TWO_SLOW_LAST,
    TWO_HQ_WITH,
    GUARD,
    GUARD_NO,
    GUARD_MOVE,
    ALLRET,
    ALLRET_EARLY,
    MOVEALL,
    FRONT,
    FRONT_NO_AB,
};

/** 開始直後の全軍撤退の 16 通り：押す時刻を 0.1・1・2・3 秒に（4 回ずつ。人が出陣してすぐ押す） */
let early: Run[] | null = null;
const sixteenEarly = () => (early ??= Array.from({ length: 16 }, (_, k) => play([[[0.1, 1, 2, 3][k % 4]!, '*', 'allRetreat']])));
/** 伏兵の騎馬が味方へ襲いかかった回数 */
const ambushHits = (r: Run) => r.s.events.filter((e) => e.kind === 'ai' && e.text.startsWith('敵勢の伏兵の騎馬が') && e.text.includes('へ襲いかかった')).length;


// ---------------------------------------------------------------- テスト

describe('退却戦のデータ（状態を直接見る）', () => {
    it('検査を通る。主目標は離脱（総大将と 4 部隊）。判定の順・追い討ち・武将の方針。部隊数は上限内（味方 7・敵 8。後詰めを含めて同時に戦場にいる数）', () => {
        expect(validateField(RF)).toEqual([]);
        const p = RF.objectives.primary;
        expect(p.type).toBe('withdraw');
        if (p.type !== 'withdraw') return;
        expect([p.count, p.exit.rect, p.name]).toEqual([4, { x0: -60, x1: 60, z0: 190, z1: 220 }, '南の退き口']);
        expect(RF.objectives.secondary.map((x) => [x.id, x.type])).toEqual([
            ['rear_losses', 'limit_losses'],
            ['rear_tadakatsu', 'preserve_unit'],
        ]);
        expect(RF.endRules).toEqual({ order: ['objective_done', 'objective_failed', 'hq_lost', 'army_broken', 'nightfall', 'all_retreat'], allRetreat: 'count' });
        expect([RF.pursuit, RF.generalInitiative]).toEqual([true, true]);
        const us = RF.presets[0]!.units;
        expect(us.filter((u) => u.side === 'ally').length).toBe(7);
        expect(us.filter((u) => u.side === 'enemy').length).toBe(9);
        expect(us.filter((u) => u.side === 'enemy').length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.enemy);
        // 後詰めは 100 秒（槍）・130 秒（騎馬）。伏兵の騎馬は 45 秒に切れ目の北の口の西の林から出る。
        // 追っ手はどれも切れ目の北の口へ攻め進む（伏兵は口の中ほど (0,80) へ）
        expect(us.filter((u) => u.arriveAt).map((u) => [u.id, u.arriveAt])).toEqual([
            ['e_late', 100],
            ['e_late_kiba', 130],
            ['e_amb', 45],
        ]);
        for (const u of us.filter((x) => x.side === 'enemy' && x.aiRole === 'assault')) expect([u.id, u.aiTarget?.x, u.aiTarget?.z]).toEqual([u.id, 0, u.id === 'e_amb' ? 80 : 72]);
        // 伏兵の置き場所は林の中（現れるまで見えず、現れても林の中は遠くから見えない）
        const amb = RF.deployments.enemy.find((d) => d.id === 'amb')!;
        expect(RF.terrain.some((t) => t.kind === 'woods' && t.rect && amb.x >= t.rect.x0 && amb.x <= t.rect.x1 && amb.z >= t.rect.z0 && amb.z <= t.rect.z1)).toBe(true);
        // 合戦の前の説明に判定の順の 1 行
        const b = practiceBriefingInfo(RF);
        expect(endRuleBriefingLine(buildBattleSetup(RF, 'standard'))).toContain('① 主目標「総大将と 4 部隊を南の退き口から離脱させる」を果たす → 勝利（目標を果たした撤収）');
        expect(b.endRules.length).toBe(6);
        expect(b.endRules[5]).toContain('全軍撤退 → 退き口から離れた部隊も主目標に数え');
    });

    it('地形：原の北の丘（忠勝隊の持ち場）は 2 m より高い。崖は通れず、切れ目（x -20〜20）だけが南へ抜ける。退き口までは足の遅い隊で 1 分ほど', () => {
        const s = createBattle(buildBattleSetup(RF, 'standard'));
        expect(elevationAt(s.map, 0, -10)).toBeGreaterThan(RULES.hillDiff);
        expect(elevationAt(s.map, 0, 30)).toBe(0);
        const nav = s.field.nav!;
        expect(isPassable(nav, -60, 110)).toBe(false);
        expect(isPassable(nav, 60, 110)).toBe(false);
        expect(isPassable(nav, 0, 110)).toBe(true);
        // 忠勝隊は丘の上（持ち場）、ほかは丘の南の原
        expect(Math.hypot(U(s, 'a_tadakatsu').x, U(s, 'a_tadakatsu').z + 14)).toBeLessThan(24);
    });
});

describe('退却戦の作戦（早送り）', () => {
    it('台本は人が画面でできる程度：命令は 12 回まで、続けて押す間は 1 秒以上、向き（face）は使わない、断られた命令は無い', () => {
        for (const [name, p] of Object.entries(ALL_PLANS)) {
            const r = once(p);
            expect([name, r.cmdT.length <= 12]).toEqual([name, true]);
            const ts = [...r.cmdT].sort((a, b) => a - b);
            const gaps = ts.slice(1).map((t, i) => t - ts[i]!);
            expect([name, gaps.length === 0 || Math.min(...gaps) >= 1 - 1e-6]).toEqual([name, true]);
            expect([name, r.refused]).toEqual([name, []]);
            for (const x of p) if (typeof x[2] === 'object' && 'type' in x[2] && x[2].type === 'move') expect(x[2].face).toBeUndefined();
        }
    }, 120_000);

    it('主目標に届く作戦が 5 つ（殿 2 隊・殿＋騎馬の横槍・殿を前に残すだけ・撤退の命令の列＋退路の守護・準備した正面攻撃）。どれも 16 通りで 13 勝以上', () => {
        for (const p of [TWO_REAR, REAR, STAY, GUARD, FRONT]) expect(won(once(p)), brief(once(p))).toBe(true);
        expect(wins(sixteen(TWO_REAR))).toBeGreaterThanOrEqual(15);
        expect(wins(sixteen(REAR))).toBeGreaterThanOrEqual(15);
        expect(wins(sixteen(STAY))).toBeGreaterThanOrEqual(14);
        expect(wins(sixteen(GUARD))).toBeGreaterThanOrEqual(13);
        expect(wins(sixteen(FRONT))).toBeGreaterThanOrEqual(14);
        // 勝った合戦は「目標を果たした撤収」として記録する
        for (const r of sixteen(TWO_REAR).filter(won)) expect(r.o.withdrawal).toBe('objective');
    }, 300_000);

    it('殿を置いて順に退く作戦がいちばん良い：殿 2 隊（忠勝＋酒井）は損害の平均がどの作戦より小さく、副目標を 2 つとも果たす数がいちばん多い。忠勝の守護は使わない（勝ちの必須ではない）', () => {
        const best = sixteen(TWO_REAR);
        const both = (rs: Run[]) => rs.filter((r) => sec(r, 'rear_losses') && sec(r, 'rear_tadakatsu')).length;
        // 今の版：殿 2 隊 16 勝・7.3％・副目標 2 つ 15／16・崩れ 0.06
        expect(wins(best)).toBe(16);
        expect(mean(best, (r) => r.loss)).toBeLessThan(0.09);
        expect(both(best)).toBeGreaterThanOrEqual(14);
        expect(mean(best, routed)).toBeLessThan(0.3);
        for (const [name, p] of Object.entries(ALL_PLANS)) {
            if (p === TWO_REAR || p === ALLRET_EARLY) continue;
            const rs = sixteen(p);
            expect([name, mean(rs, (r) => r.loss) > mean(best, (r) => r.loss)]).toEqual([name, true]);
            expect([name, both(rs) < both(best)]).toEqual([name, true]);
        }
        // 開始直後の全軍撤退（16 通り）とも比べる
        expect(mean(sixteenEarly(), (r) => r.loss)).toBeGreaterThan(mean(best, (r) => r.loss));
        expect(both(sixteenEarly())).toBeLessThan(both(best));
        // 殿 2 隊・殿を残すだけは、能力を使わずに 16 勝（守護は役に立つが、勝ちの必須ではない）
        for (const p of [TWO_REAR, STAY]) expect(p.some((x) => x[2] === 'ability')).toBe(false);
        expect(wins(sixteen(STAY))).toBe(16);
    }, 300_000);

    it('作戦どうしの違い：殿 2 隊は忠勝隊も残り、崩れる隊がほとんど無い。殿を残すだけは忠勝隊が崩れる。殿＋騎馬の横槍は騎馬が伏兵に当たり損害が増える。守護の列は損害が大きいが早い。正面攻撃は時間がかかる', () => {
        const tw = sixteen(TWO_REAR);
        const rear = sixteen(REAR);
        const st = sixteen(STAY);
        const gd = sixteen(GUARD);
        const fr = sixteen(FRONT);
        // 忠勝隊を崩さずに退く（16 通り。今の版：殿 2 隊 16 ／横槍 7 ／残すだけ 0）。崩れた味方の隊（平均。殿 2 隊 0.06 ／残すだけ 1.06）
        expect(count(tw, 'rear_tadakatsu')).toBeGreaterThanOrEqual(15);
        expect(count(st, 'rear_tadakatsu')).toBeLessThanOrEqual(8);
        expect(count(rear, 'rear_tadakatsu')).toBeLessThan(count(tw, 'rear_tadakatsu'));
        expect(mean(tw, routed)).toBeLessThan(mean(st, routed) - 0.3);
        // 横槍の騎馬は殿と一緒に戻るので、45 秒に出る伏兵に当たる（伏兵が襲いかかった回数の平均。今の版：横槍 1.25 ／殿 2 隊 0.75 ／残すだけ 0.06）
        expect(mean(rear, ambushHits)).toBeGreaterThan(mean(st, ambushHits) + 0.5);
        // 損害（平均。今の版：殿 2 隊 7.3％・残すだけ 7.8％ < 横槍 11.7％ < 守護の列 14.0％ < 正面攻撃 21.0％）
        expect(mean(st, (r) => r.loss)).toBeLessThan(0.1);
        expect(mean(st, (r) => r.loss)).toBeLessThan(mean(rear, (r) => r.loss) - 0.02);
        expect(mean(st, (r) => r.loss)).toBeLessThan(mean(gd, (r) => r.loss) - 0.03);
        expect(mean(st, (r) => r.loss)).toBeLessThan(mean(fr, (r) => r.loss) - 0.05);
        // 時間（平均。今の版：守護の列 61 秒 < 残すだけ 67 秒 < 殿 2 隊 71 秒 < 横槍 84 秒 < 正面攻撃 182 秒）
        expect(mean(gd, (r) => r.t)).toBeLessThan(mean(rear, (r) => r.t));
        expect(mean(gd, (r) => r.t)).toBeLessThan(mean(tw, (r) => r.t));
        expect(mean(fr, (r) => r.t)).toBeGreaterThan(150);
        expect(mean(rear, (r) => r.t)).toBeLessThan(110);
    }, 300_000);

    it('開始直後（0〜3 秒）の全軍撤退は勝つこともあるが（一律の負けではない）、殿を置いて順に退くより勝ちが少なく、損害・崩れが目に見えて大きく、損害 1 割以内を果たさない', () => {
        const ea = sixteenEarly();
        const tw = sixteen(TWO_REAR);
        const st = sixteen(STAY);
        // 今の版：開始直後の全軍撤退 12 勝（0.1〜2 秒に押せば勝ち、3 秒では届かない）・損害 12.5％・崩れ 1.75・損害 1 割以内 0／16
        expect(wins(ea)).toBeGreaterThanOrEqual(1);
        expect(wins(ea)).toBeLessThan(wins(tw));
        expect(mean(ea, (r) => r.loss)).toBeGreaterThan(mean(tw, (r) => r.loss) + 0.04);
        expect(mean(ea, (r) => r.loss)).toBeGreaterThan(mean(st, (r) => r.loss) + 0.03);
        expect(mean(ea, routed)).toBeGreaterThan(mean(tw, routed) + 1);
        expect(count(ea, 'rear_losses')).toBeLessThanOrEqual(2);
        expect(count(tw, 'rear_losses')).toBeGreaterThanOrEqual(13);
        // 追っ手の騎馬が退く列に追い討ちをかける（列の損害。今の版：開始直後の全軍撤退 13.3％ ／殿 2 隊 4.1％）
        expect(mean(ea, pursuits)).toBeGreaterThan(1);
        expect(mean(ea, (r) => r.colLoss)).toBeGreaterThan(mean(tw, (r) => r.colLoss) + 0.05);
        // 勝った合戦も、崩れた隊が出る（勝ちの中の崩れの平均が 1 隊以上）
        expect(mean(ea.filter(won), routed)).toBeGreaterThanOrEqual(1);
    }, 300_000);

    it('列の中の順番で結果が変わる：足の遅い隊（槍・弓）と総大将を後にすると伏兵に当たって損害が増え、総大将を殿と一緒に残すと負けが増える（殿 1 隊・殿 2 隊のどちらでも）', () => {
        const st = sixteen(STAY);
        const tw = sixteen(TWO_REAR);
        const sl = sixteen(SLOW_LAST);
        const tsl = sixteen(TWO_SLOW_LAST);
        // 足の遅い隊を後に（今の版：殿 1 隊 7.8％ → 9.9％・損害 1 割以内 15 → 9／殿 2 隊 7.3％ → 9.2％・15 → 9）
        expect(mean(sl, (r) => r.loss)).toBeGreaterThan(mean(st, (r) => r.loss) + 0.01);
        expect(count(sl, 'rear_losses')).toBeLessThan(count(st, 'rear_losses') - 3);
        expect(mean(tsl, (r) => r.loss)).toBeGreaterThan(mean(tw, (r) => r.loss) + 0.01);
        expect(count(tsl, 'rear_losses')).toBeLessThan(count(tw, 'rear_losses') - 3);
        // 伏兵が襲いかかる回数（今の版：殿 1 隊 0.06 → 0.38）
        expect(mean(sl, ambushHits)).toBeGreaterThan(mean(st, ambushHits));
        // 総大将を殿と一緒に残す（今の版：殿 1 隊 16 → 0 勝／殿 2 隊 16 → 6 勝）
        expect(wins(sixteen(HQ_WITH_REAR))).toBeLessThanOrEqual(2);
        expect(wins(sixteen(TWO_HQ_WITH))).toBeLessThan(wins(tw) - 6);
        for (const r of sixteen(HQ_WITH_REAR).filter((x) => !won(x))) expect(r.o.reason).toBe('objective_failed');
    }, 300_000);

    it('全軍で一気に退く（全軍撤退の号令・全部隊を同時に退き口へ）は、殿を置いて順に下げるより損害が大きく、崩れる隊が多く、要る数に届かないこともある（一律の負けではない）', () => {
        const tw = sixteen(TWO_REAR);
        const st = sixteen(STAY);
        for (const [name, p] of Object.entries({ ALLRET, MOVEALL })) {
            const rs = sixteen(p);
            // 一律の負けではない（勝つ合戦もある）が、殿を置いた作戦より勝ちが少ない
            expect([name, wins(rs) >= 1]).toEqual([name, true]);
            expect([name, wins(rs) < wins(st)]).toEqual([name, true]);
            // 損害（平均）は殿 2 隊より 5 ポイント以上、殿を残すだけより 3 ポイント以上大きい。崩れる味方の隊も多い
            expect([name, mean(rs, (r) => r.loss) > mean(tw, (r) => r.loss) + 0.05]).toEqual([name, true]);
            expect([name, mean(rs, (r) => r.loss) > mean(st, (r) => r.loss) + 0.03]).toEqual([name, true]);
            expect([name, mean(rs, routed) > mean(st, routed) + 0.5]).toEqual([name, true]);
            // 負けた合戦は、退き口から離れた部隊が要る数（総大将＋4）に届かなかった
            for (const r of rs.filter((x) => !won(x))) expect([name, r.o.reason, outCount(r) < 5]).toEqual([name, 'objective_failed', true]);
        }
    }, 300_000);

    it('敵は実際に追い討ちをかける：全軍撤退の号令で退く隊に追い討ちが入り、列の損害・崩れる隊が殿を残す作戦より多い。移動で下げた列には追い討ちの知らせは出ない', () => {
        const ar = sixteen(ALLRET);
        const st = sixteen(STAY);
        // 追い討ち（16 通りの平均の回数。今の版 2.50）
        expect(mean(ar, pursuits)).toBeGreaterThan(1.5);
        expect(ar.filter((r) => pursuits(r) > 0).length).toBeGreaterThanOrEqual(14);
        // 忠勝隊を除く 6 部隊の損害（平均。今の版：全軍撤退 15.0％ ／殿を残すだけ 0.2％）
        expect(mean(ar, (r) => r.colLoss)).toBeGreaterThan(mean(st, (r) => r.colLoss) + 0.08);
        // 崩れた隊（平均。今の版：全軍撤退 1.81 ／殿を残すだけ 1.06。殿を残すだけで崩れるのは、ほとんどが殿の忠勝隊）
        expect(mean(ar, routed)).toBeGreaterThan(mean(st, routed) + 0.5);
        // 殿を残すだけで忠勝隊のほかに崩れた隊は 16 通りで 1 隊まで（伏兵を足す前は 0。今の版は 1：遅く下げ始めた酒井隊が、殿の崩れた後の追っ手の騎馬と伏兵に当たった 1 回）
        const stOther = st.flatMap((r) => r.o.units.filter((x) => x.side === 'ally' && x.id !== 'a_tadakatsu' && !['withdrawn', 'ready'].includes(x.status)));
        expect(stOther.length).toBeLessThanOrEqual(1);
        // 移動で下げた列（殿を残すだけ）は追い討ちの知らせが出ない（追い討ちは撤退の命令で退く隊だけ）
        expect(mean(st, pursuits)).toBe(0);
    }, 300_000);

    it('退路の守護を使う／使わない：撤退の命令で下げる列は、守護があると追っ手が忠勝隊に阻まれ、列の損害・崩れる隊が減り、勝ち数が大きく増える', () => {
        const g = sixteen(GUARD);
        const n = sixteen(GUARD_NO);
        // 勝ち数（今の版）：守護あり 13 ／なし 1
        expect(wins(g)).toBeGreaterThan(wins(n) + 3);
        // 列（忠勝隊を除く 6 部隊）の損害の平均（今の版：守護あり 6.4％ ／なし 16.9％）。崩れた隊（1.50 ／2.81。守護ありで崩れるのは多くが忠勝隊）
        expect(mean(g, (r) => r.colLoss)).toBeLessThan(mean(n, (r) => r.colLoss) - 0.03);
        expect(mean(g, routed)).toBeLessThan(mean(n, routed) - 0.5);
        // 守護ありは「阻む」「引きつけられた」の知らせが出る（守護なしは出ない）
        expect(mean(g, blocked)).toBeGreaterThan(0.5);
        expect(mean(n, blocked)).toBe(0);
    }, 300_000);

    it('能力の価値が場面で変わる（退路の守護）：撤退の命令で下げる列には勝敗を分けるほど効き、移動で下げる列にはほとんど効かない（殿が動けない分、忠勝隊が崩れやすい）', () => {
        const gainRetreat = wins(sixteen(GUARD)) - wins(sixteen(GUARD_NO));
        const gainMove = wins(sixteen(GUARD_MOVE)) - wins(sixteen(STAY));
        // 今の版：撤退の命令の列 +12 勝（1 → 13）／移動の列 ±0（16 → 16）
        expect(gainRetreat).toBeGreaterThan(gainMove + 3);
        // 移動の列：守護ありでも損害の差は小さい（±3 ポイント。今の版 10.6％ 対 7.8％）。忠勝隊が残る数は守護ありの方が多くない（殿が動けない）
        expect(Math.abs(mean(sixteen(GUARD_MOVE), (r) => r.loss) - mean(sixteen(STAY), (r) => r.loss))).toBeLessThan(0.03);
        expect(count(sixteen(GUARD_MOVE), 'rear_tadakatsu')).toBeLessThanOrEqual(count(sixteen(STAY), 'rear_tadakatsu'));
    }, 300_000);

    it('殿の置き場所：列の前（北の丘）に置くと追っ手はまず殿に当たる。列の後ろ（切れ目の北の口）や脇（西）に置くと、前の隊が騎馬に崩される', () => {
        const front = sixteen(STAY);
        for (const [name, p] of Object.entries({ STAY_CUT, STAY_WEST })) {
            const rs = sixteen(p);
            expect([name, wins(rs) < wins(front)]).toEqual([name, true]);
            expect([name, mean(rs, (r) => r.loss) > mean(front, (r) => r.loss) + 0.03]).toEqual([name, true]);
            expect([name, mean(rs, routed) > mean(front, routed) + 0.8]).toEqual([name, true]);
        }
    }, 300_000);

    it('副目標が作戦で分かれる：殿を残すだけは損害 1 割以内を果たすが忠勝隊を失う。準備した正面攻撃は忠勝隊を残すが損害が 1 割を超える。殿 2 隊は両方', () => {
        const st = sixteen(STAY);
        const fr = sixteen(FRONT);
        const tw = sixteen(TWO_REAR);
        expect(count(st, 'rear_losses')).toBeGreaterThanOrEqual(14);
        expect(count(st, 'rear_tadakatsu')).toBeLessThanOrEqual(8);
        expect(count(fr, 'rear_losses')).toBeLessThanOrEqual(2);
        expect(count(fr, 'rear_tadakatsu')).toBeGreaterThanOrEqual(14);
        expect(count(tw, 'rear_losses')).toBeGreaterThanOrEqual(13);
        expect(count(tw, 'rear_tadakatsu')).toBeGreaterThanOrEqual(15);
    }, 300_000);

    it('準備した正面攻撃と無計画な攻撃（全部隊同時・部隊ごとにずらす 2 通り）の比べ：準備した方は主目標に届き、崩れる隊が少ない。無計画は退かないので主目標に届かない（結果は記録）', () => {
        const fr = sixteen(FRONT);
        for (const [name, p] of Object.entries({ UNPLANNED, UNPLANNED_STAG1, UNPLANNED_STAG2 })) {
            const raw = sixteen(p);
            // 今の版：無計画 0 勝（損害 21.3％・崩れ 2.13）／ずらす 1：0 勝（26.2％・2.38）／ずらす 2：0 勝（35.4％・2.63）。
            // どれも伏兵の騎馬が原に残った本陣・弓へ後ろから当たり、本陣か 3 部隊が崩れて主目標の失敗（ずらす 2 の 2 回は日没）
            expect([name, wins(raw)]).toEqual([name, 0]);
            expect([name, wins(fr) > wins(raw) + 12]).toEqual([name, true]);
            expect([name, mean(fr, routed) < mean(raw, routed) - 1]).toEqual([name, true]);
            expect([name, mean(fr, (r) => r.loss) < mean(raw, (r) => r.loss)]).toEqual([name, true]);
        }
        // 準備の中身：同じ配置で家康の号令を使わない（記録。今の版 14 勝・24.9％。勝ち数は下がる）
        expect(wins(sixteen(FRONT_NO_AB))).toBeLessThanOrEqual(wins(fr));
    }, 300_000);
});

describe('全軍撤退と記録（早送り・状態を直接見る）', () => {
    it('全軍撤退の号令から 20 秒（今までの打ち切り）を過ぎても合戦は続く。届けば「目標を果たした撤収」（勝利）、届かなければ主目標の失敗（敗北）と記録が分かれる', () => {
        const ar = sixteen(ALLRET);
        const ok = ar.filter(won);
        const ng = ar.filter((r) => !won(r));
        expect(ok.length).toBeGreaterThan(0);
        expect(ng.length).toBeGreaterThan(0);
        for (const r of ar) {
            const at = r.s.events.find((e) => e.kind === 'retreat_all')!.t;
            expect(r.t).toBeGreaterThan(at + RULES.retreatGraceSec);
        }
        for (const r of ok) {
            expect(r.o.withdrawal).toBe('objective');
            expect(withdrawalNote(r.o)).toContain('目標を果たした撤収');
        }
        for (const r of ng) {
            expect([r.o.result, r.o.reason, r.o.withdrawal]).toEqual(['defeat', 'objective_failed', undefined]);
            expect(withdrawalNote(r.o)).toBe('');
        }
        // 演習の記録：勝った撤収と届かなかった撤退で、退き方・離脱の数が分かれ、保存の形で読み戻せる
        const recOk = recordFromOutcome(ok[0]!.o, 'rear_withdraw', new Date('2026-10-03T00:00:00Z'));
        const recNg = recordFromOutcome(ng[0]!.o, 'rear_withdraw', new Date('2026-10-03T00:00:00Z'));
        expect(recOk).toMatchObject({ result: 'victory', withdrawal: 'objective', primary: { type: 'withdraw', achieved: true, count: { done: 5, total: 5 } } });
        expect(recNg.result).toBe('defeat');
        expect(recNg.withdrawal).toBeUndefined();
        expect(recNg.primary.count!.done).toBeLessThan(5);
        const back = parsePracticeData(JSON.stringify({ version: 1, records: { rearguard: { plays: 2, last: recNg, best: recOk } } }));
        expect(back?.records.rearguard?.best).toEqual(recOk);
        expect(back?.records.rearguard?.last).toEqual(recNg);
        const info = practiceResultInfo(RF, ok[0]!.o, { ok: true, data: back!, record: back!.records.rearguard!, isBest: true, movedBroken: false });
        expect(info.withdrawalText).toContain('目標を果たした撤収');
    }, 300_000);

    it('状態を直接操作：総大将が先に退き口から離れても負けにならず、合戦は続く（本陣の喪失ではない）', () => {
        const s = createBattle(buildBattleSetup(RF, 'standard'));
        const h = U(s, 'a_ieyasu');
        h.x = 0;
        h.z = 195;
        h.path = null;
        for (let i = 0; i < 20; i++) stepBattle(s, RULES.tick);
        expect(h.status).toBe('withdrawn');
        expect(s.objectives!.primary!.entered).toEqual(['a_ieyasu']);
        expect(s.result).toBeNull();
        expect(isActive(U(s, 'a_tadakatsu'))).toBe(true);
    });
});
