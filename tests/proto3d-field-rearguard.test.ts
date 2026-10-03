/**
 * 戦場「退却戦」（rearguard）の作戦と釣り合い（docs/fields-group4-request.md §3 の 18・docs/fields-group4-design.md §3・§5）。
 * 北から追ってくる敵勢（追っ手の騎馬 2 が 15 秒ほど・槍の追っ手 2 が 40 秒ほどで原の味方に当たる。100 秒・130 秒で後詰め）を受けながら、
 * 総大将（家康本陣）とほかの 4 部隊を南の退き口から離脱させる（withdraw。目標どおり退けば勝利）。
 *
 * 確かめること：
 * - データ（状態を直接見る）：検査を通る・主目標と判定の順・追い討ち・部隊数・地形（丘・崖の切れ目）。
 * - 主目標に届く作戦（早送り）が 4 つあり、±15 秒（見てから押す行は 0〜15 秒の遅れ）の 16 通りで安定する。作戦どうしで損害・時間・副目標・
 *   守れる部隊が違う。
 * - 全軍で一気に退く（全軍撤退の号令・全部隊を同時に退き口へ）は、殿を置いて順に下げるより損害が大きく、要る数に届かないこともある
 *   （一律の負けではない。記録として数字を書く）。
 * - 敵が実際に追い討ちをかける（追い討ちの数・退く隊の損害）。退路の守護を使う／使わないで、撤退の命令で退く隊の損害が変わる。
 * - 全軍撤退の号令で、目標の前に合戦を打ち切らない。目標を果たした撤収（勝利）と、届かなかった撤退が記録で分かれる。
 * - 殿の置き場所（列の前・後ろ・脇）で結果が変わる。副目標が作戦で分かれる組。
 * - 準備した正面攻撃（騎馬・号令で追っ手を崩してから退く）と無計画な攻撃（全部隊で近い敵へ当て直すだけ）の比べ。
 *   「正面なら必ず負ける」は合格条件にしない（準備した正面攻撃は勝てる。時間と損害が大きい、を比べとして書く）。
 * - 武将の能力の価値が場面で変わる比べ（退路の守護：撤退の命令で下げる列には勝敗を分けるほど効き、移動で下げる列にはほとんど効かない）。
 *
 * どれも「早送り」（決まった時刻・見てから押す行で issueOrder・useAbility・orderAllRetreat を出す台本を runToEnd で最後まで進める）。
 * 画面の操作ではない。台本は人が画面でできる程度にしている：命令は 1 つの台本で 12 回まで、続けて押す間は 1 秒以上（もとの台本で確かめる）。
 * 移動の後の向き（face）は画面から指定できないので使わない。画面では敵の近くの地面を押すとその敵への攻撃になるので、台本の地面の行き先（tap）も、
 * 押す点の 20 m 以内に見えている敵がいればその敵への攻撃にする（tests/proto3d-group3-helpers.ts の tapOrder）。
 * ±15 秒の 16 通りは、0 秒でない時刻の行を ±15 秒ずらし、「見てから押す」行は条件が初めて満たされてから 0〜15 秒遅らせて押す（決まった乱数）。
 *
 * 作った時の結果（早送り・16 通り。勝ち数・平均の損害・平均の時間・副目標「損害 1 割以内」「忠勝隊を崩さずに」を果たした数・崩れた味方の隊の平均）：
 * - 殿＋騎馬の横槍（REAR）：16 勝・6.4％・89 秒・15／16・16／16・0.06。
 * - 殿を前に残すだけ（STAY）：16 勝・7.3％・67 秒・16／16・6／16・0.63（崩れるのは殿の忠勝隊だけ。列の損害 0.0％）。
 * - 撤退の命令の列＋退路の守護（GUARD）：14 勝・12.1％・61 秒・10／16・3／16・1.25（追い討ち 2.44 回・阻む 1.63 回・列の損害 4.2％）。
 *   同じ列で守護なし（GUARD_NO）：9 勝・15.7％・崩れ 2.19（追い討ち 2.63 回・列の損害 9.5％）。
 *   移動の列＋守護（GUARD_MOVE）：16 勝・8.2％・16／16・0／16（守護の分、殿が動けずに崩れる）。
 * - 準備した正面攻撃（FRONT）：16 勝・18.0％・191 秒・0／16・16／16・1.06。家康の号令なし（FRONT_NO_AB）：13 勝・21.3％。
 *   無計画（UNPLANNED）：0 勝（記録：損害 24.9％・崩れ 2.44。退かないので、崩れるか日没）。
 * - 全軍撤退の号令（ALLRET。5 秒±15）：9 勝・14.3％・7／16・9／16・1.56（追い討ち 2.25 回・列の損害 12.3％・離脱の平均 3.81／5）。
 *   全部隊を同時に退き口へ（MOVEALL。移動）：11 勝・13.5％・1／16・8／16・2.25（列の損害 13.1％）。
 * - 殿の置き場所：列の前＝北の丘（STAY）16 勝・7.3％ ／列の後ろ＝切れ目の北の口（STAY_CUT）9 勝・11.9％・崩れ 2.25 ／
 *   脇＝西（STAY_WEST）12 勝・13.4％・崩れ 2.19。
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
/** 列を移動で退き口へ（酒井隊・石川隊（両脇）→ 弓 → 本陣 の順に 1 秒おき） */
const COLUMN: Step[] = [
    [1, 'a_sakai', exitTap(-30)],
    [2, 'a_ishikawa', exitTap(30)],
    [3, 'a_yumi', exitTap(-15)],
    [4, 'a_ieyasu', exitTap(0)],
];
/**
 * 殿＋騎馬の横槍（命令 9 回）：列を順に下げ、忠勝隊は北の丘（持ち場のまま）で追っ手の騎馬を受ける。追っ手の騎馬が殿に当たったのを見て、
 * 榊原隊・徳川騎馬隊で横から突く。追っ手の騎馬が 2 つとも崩れたら、殿と騎馬も退き口へ
 */
const REAR: Step[] = [
    ...COLUMN,
    [later(kibaEngaged, 1), 'a_sakakibara', atk('e_kiba_r')],
    [later(kibaEngaged, 2), 'a_kiba', atk('e_kiba_l')],
    [broken(...KIBA), 'a_tadakatsu', exitTap(10)],
    [later(broken(...KIBA), 1), 'a_sakakibara', exitTap(45)],
    [later(broken(...KIBA), 2), 'a_kiba', exitTap(-45)],
];
/** 殿を前に残すだけ（命令 7 回）：列と騎馬を順に下げ、忠勝隊だけが北の丘で追っ手の騎馬を受ける。騎馬が 2 つとも崩れたら殿も下げる */
const stay = (post?: [number, number]): Step[] => [
    ...(post ? [[0, 'a_tadakatsu', tap(...post)] as Step] : []),
    ...COLUMN,
    [5, 'a_kiba', exitTap(-45)],
    [6, 'a_sakakibara', exitTap(45)],
    [broken(...KIBA), 'a_tadakatsu', exitTap(10)],
];
const STAY = stay();
/** 殿を列の後ろ（切れ目の北の口）に置く：始めに忠勝隊を (0,72) へ（列が殿より北に残る） */
const STAY_CUT = stay([0, 72]);
/** 殿を脇（西）に置く：始めに忠勝隊を (-70,20) へ */
const STAY_WEST = stay([-70, 20]);
/** 撤退の命令の列（6 部隊。1 秒おき）。guard なら 10 秒に退路の守護、効果が終わってから殿を退き口へ。守護なしなら追っ手の騎馬が崩れてから殿を下げる */
const retreatColumn = (guard: boolean): Step[] => [
    ...['a_sakai', 'a_ishikawa', 'a_yumi', 'a_ieyasu', 'a_kiba', 'a_sakakibara'].map((id, i) => [1 + i, id, { type: 'retreat' }] as Step),
    ...(guard ? [[10, 'a_tadakatsu', 'ability'] as Step, [afterGuard(51), 'a_tadakatsu', exitTap(10)] as Step] : [[broken(...KIBA), 'a_tadakatsu', exitTap(10)] as Step]),
];
const GUARD = retreatColumn(true);
const GUARD_NO = retreatColumn(false);
/** 移動の列（STAY と同じ）＋退路の守護（10 秒）。効果が終わってから殿を下げる（能力の価値の比べ） */
const GUARD_MOVE: Step[] = [...COLUMN, [5, 'a_kiba', exitTap(-45)], [6, 'a_sakakibara', exitTap(45)], [10, 'a_tadakatsu', 'ability'], [afterGuard(51), 'a_tadakatsu', exitTap(10)]];
/** 全軍撤退の号令（5 秒。命令 1 回） */
const ALLRET: Step[] = [[5, '*', 'allRetreat']];
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
 * 準備した正面攻撃（命令 8 回）：弓を丘の脇 (-20,0) へ、酒井隊・石川隊を忠勝隊の両脇へ出して受ける。追っ手の騎馬が殿に当たったら騎馬 2 隊で
 * 横を突き、槍の追っ手と斬り合い始めたら家康の号令。槍の追っ手が 2 つとも崩れたら全軍撤退の号令
 */
const FRONT: Step[] = [
    [1, 'a_yumi', tap(-20, 0)],
    [2, 'a_ishikawa', tap(35, -5)],
    [3, 'a_sakai', tap(-35, -5)],
    [later(kibaEngaged, 1), 'a_sakakibara', atk('e_kiba_r')],
    [later(kibaEngaged, 2), 'a_kiba', atk('e_kiba_l')],
    [later(vanEngaged, 1), 'a_ieyasu', 'ability'],
    [later(broken('e_van_l', 'e_van_r'), 2), '*', 'allRetreat'],
];
/** 同じ配置で能力（家康の号令）を使わない */
const FRONT_NO_AB: Step[] = FRONT.filter((x) => x[2] !== 'ability');
/** 無計画：全部隊で、見えている一番近い敵へ 10 秒ごとに当て直すだけ（退かない） */
const UNPLANNED: Step[] = [];
for (const id of ['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_sakakibara', 'a_kiba', 'a_yumi']) for (let t = 1; t < 540; t += 10) UNPLANNED.push([t, id, 'nearest']);

const ALL_PLANS: Record<string, Step[]> = { REAR, STAY, STAY_CUT, STAY_WEST, GUARD, GUARD_NO, GUARD_MOVE, ALLRET, MOVEALL, FRONT, FRONT_NO_AB };


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
        expect(us.filter((u) => u.side === 'enemy').length).toBe(8);
        expect(us.filter((u) => u.side === 'enemy').length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.enemy);
        // 後詰めは 100 秒（槍）・130 秒（騎馬）。追っ手はどれも切れ目の北の口へ攻め進む
        expect(us.filter((u) => u.arriveAt).map((u) => [u.id, u.arriveAt])).toEqual([
            ['e_late', 100],
            ['e_late_kiba', 130],
        ]);
        for (const u of us.filter((x) => x.side === 'enemy' && x.aiRole === 'assault')) expect([u.id, u.aiTarget?.x, u.aiTarget?.z]).toEqual([u.id, 0, 72]);
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

    it('主目標に届く作戦が 4 つ（殿＋騎馬の横槍・殿を前に残すだけ・撤退の命令の列＋退路の守護・準備した正面攻撃）。どれも 16 通りで 13 勝以上', () => {
        for (const p of [REAR, STAY, GUARD, FRONT]) expect(won(once(p)), brief(once(p))).toBe(true);
        for (const [name, p] of Object.entries({ REAR, STAY, GUARD, FRONT })) expect([name, wins(sixteen(p))]).toEqual([name, expect.any(Number)]);
        expect(wins(sixteen(REAR))).toBeGreaterThanOrEqual(15);
        expect(wins(sixteen(STAY))).toBeGreaterThanOrEqual(14);
        expect(wins(sixteen(GUARD))).toBeGreaterThanOrEqual(13);
        expect(wins(sixteen(FRONT))).toBeGreaterThanOrEqual(14);
        // 勝った合戦は「目標を果たした撤収」として記録する
        for (const r of sixteen(REAR).filter(won)) expect(r.o.withdrawal).toBe('objective');
    }, 300_000);

    it('作戦どうしの違い：殿＋騎馬の横槍は忠勝隊も残り、崩れる隊がほとんど無い。殿を残すだけは忠勝隊が崩れやすい。守護の列は損害が大きいが早い。正面攻撃は時間がかかる', () => {
        const rear = sixteen(REAR);
        const st = sixteen(STAY);
        const gd = sixteen(GUARD);
        const fr = sixteen(FRONT);
        // 忠勝隊を崩さずに退く（16 通り。今の版：横槍 16 ／残すだけ 6）。崩れた味方の隊（平均。横槍 0.06 ／残すだけ 0.63）
        expect(count(rear, 'rear_tadakatsu')).toBeGreaterThanOrEqual(15);
        expect(count(st, 'rear_tadakatsu')).toBeLessThanOrEqual(8);
        expect(mean(rear, routed)).toBeLessThan(mean(st, routed) - 0.3);
        // 損害（平均。今の版：横槍 6.4％・残すだけ 7.3％ < 守護の列 12.1％・正面攻撃 18.0％）
        expect(mean(rear, (r) => r.loss)).toBeLessThan(0.1);
        expect(mean(st, (r) => r.loss)).toBeLessThan(mean(gd, (r) => r.loss) - 0.03);
        expect(mean(st, (r) => r.loss)).toBeLessThan(mean(fr, (r) => r.loss) - 0.05);
        // 時間（平均。今の版：守護の列 61 秒 < 残すだけ 67 秒 < 横槍 89 秒 < 正面攻撃 191 秒）
        expect(mean(gd, (r) => r.t)).toBeLessThan(mean(rear, (r) => r.t));
        expect(mean(fr, (r) => r.t)).toBeGreaterThan(150);
        expect(mean(rear, (r) => r.t)).toBeLessThan(110);
    }, 300_000);

    it('全軍で一気に退く（全軍撤退の号令・全部隊を同時に退き口へ）は、殿を置いて順に下げるより損害が大きく、崩れる隊が多く、要る数に届かないこともある（一律の負けではない）', () => {
        const rear = sixteen(REAR);
        const st = sixteen(STAY);
        for (const [name, p] of Object.entries({ ALLRET, MOVEALL })) {
            const rs = sixteen(p);
            // 一律の負けではない（勝つ合戦もある）が、殿を置いた作戦より勝ちが少ない
            expect([name, wins(rs) >= 1]).toEqual([name, true]);
            expect([name, wins(rs) < wins(st)]).toEqual([name, true]);
            // 損害（平均）は殿＋横槍・殿を残すだけより 5 ポイント以上大きい。崩れる味方の隊も多い
            expect([name, mean(rs, (r) => r.loss) > mean(rear, (r) => r.loss) + 0.05]).toEqual([name, true]);
            expect([name, mean(rs, (r) => r.loss) > mean(st, (r) => r.loss) + 0.03]).toEqual([name, true]);
            expect([name, mean(rs, routed) > mean(st, routed) + 0.5]).toEqual([name, true]);
            // 負けた合戦は、退き口から離れた部隊が要る数（総大将＋4）に届かなかった
            for (const r of rs.filter((x) => !won(x))) expect([name, r.o.reason, outCount(r) < 5]).toEqual([name, 'objective_failed', true]);
        }
    }, 300_000);

    it('敵は実際に追い討ちをかける：全軍撤退の号令で退く隊に追い討ちが入り、列の損害・崩れる隊が殿を残す作戦より多い。移動で下げた列には追い討ちの知らせは出ない', () => {
        const ar = sixteen(ALLRET);
        const st = sixteen(STAY);
        // 追い討ち（16 通りの平均の回数。今の版 2.25）
        expect(mean(ar, pursuits)).toBeGreaterThan(1.5);
        expect(ar.filter((r) => pursuits(r) > 0).length).toBeGreaterThanOrEqual(14);
        // 忠勝隊を除く 6 部隊の損害（平均。今の版：全軍撤退 12.3％ ／殿を残すだけ 0.0％）
        expect(mean(ar, (r) => r.colLoss)).toBeGreaterThan(mean(st, (r) => r.colLoss) + 0.08);
        // 崩れた隊（平均。今の版：全軍撤退 1.56 ／殿を残すだけ 0.63。殿を残すだけで崩れるのは殿の忠勝隊だけ）
        expect(mean(ar, routed)).toBeGreaterThan(mean(st, routed) + 0.5);
        for (const r of st) for (const u of r.o.units.filter((x) => x.side === 'ally' && x.id !== 'a_tadakatsu')) expect([u.id, ['withdrawn', 'ready'].includes(u.status)]).toEqual([u.id, true]);
        // 移動で下げた列（殿を残すだけ）は追い討ちの知らせが出ない（追い討ちは撤退の命令で退く隊だけ）
        expect(mean(st, pursuits)).toBe(0);
    }, 300_000);

    it('退路の守護を使う／使わない：撤退の命令で下げる列は、守護があると追っ手が忠勝隊に阻まれ、列の損害・崩れる隊が減り、勝ち数が大きく増える', () => {
        const g = sixteen(GUARD);
        const n = sixteen(GUARD_NO);
        // 勝ち数（今の版）：守護あり 14 ／なし 9
        expect(wins(g)).toBeGreaterThan(wins(n) + 3);
        // 列（忠勝隊を除く 6 部隊）の損害の平均（今の版：守護あり 4.2％ ／なし 9.5％）。崩れた隊（1.25 ／2.19。守護ありで崩れるのは多くが忠勝隊）
        expect(mean(g, (r) => r.colLoss)).toBeLessThan(mean(n, (r) => r.colLoss) - 0.03);
        expect(mean(g, routed)).toBeLessThan(mean(n, routed) - 0.5);
        // 守護ありは「阻む」「引きつけられた」の知らせが出る（守護なしは出ない）
        expect(mean(g, blocked)).toBeGreaterThan(0.5);
        expect(mean(n, blocked)).toBe(0);
    }, 300_000);

    it('能力の価値が場面で変わる（退路の守護）：撤退の命令で下げる列には勝敗を分けるほど効き、移動で下げる列にはほとんど効かない（殿が動けない分、忠勝隊が崩れやすい）', () => {
        const gainRetreat = wins(sixteen(GUARD)) - wins(sixteen(GUARD_NO));
        const gainMove = wins(sixteen(GUARD_MOVE)) - wins(sixteen(STAY));
        // 今の版：撤退の命令の列 +5 勝（9 → 14）／移動の列 ±0（16 → 16）
        expect(gainRetreat).toBeGreaterThan(gainMove + 3);
        // 移動の列：守護ありでも損害の差は小さい（±3 ポイント）。忠勝隊が残る数は守護ありの方が少ない
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

    it('副目標が作戦で分かれる：殿を残すだけは損害 1 割以内を果たすが忠勝隊を失いやすい。準備した正面攻撃は忠勝隊を残すが損害が 1 割を超える', () => {
        const st = sixteen(STAY);
        const fr = sixteen(FRONT);
        expect(count(st, 'rear_losses')).toBeGreaterThanOrEqual(14);
        expect(count(st, 'rear_tadakatsu')).toBeLessThanOrEqual(8);
        expect(count(fr, 'rear_losses')).toBeLessThanOrEqual(2);
        expect(count(fr, 'rear_tadakatsu')).toBeGreaterThanOrEqual(14);
    }, 300_000);

    it('準備した正面攻撃と無計画な攻撃の比べ：準備した方は主目標に届き、崩れる隊が少ない。無計画は退かないので主目標に届かない（結果は記録）', () => {
        const fr = sixteen(FRONT);
        const raw = sixteen(UNPLANNED);
        expect(wins(raw)).toBe(0);
        expect(wins(fr)).toBeGreaterThan(wins(raw) + 12);
        expect(mean(fr, routed)).toBeLessThan(mean(raw, routed) - 1);
        expect(mean(fr, (r) => r.loss)).toBeLessThan(mean(raw, (r) => r.loss));
        // 準備の中身：同じ配置で家康の号令を使わない（記録。勝ち数は下がる）
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
