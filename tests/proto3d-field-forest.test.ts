/**
 * 戦場「森林」（forest）の釣り合い：地形に合った作戦（三隊で西の林の中を見られずに抜けて本陣へ斬りかかる）は 16 通りで安定して勝つ。
 * 無計画な攻撃（中央の道を攻め上る・見通される林道や道の脇の林を回る・一隊だけで回る）は、地形に合った作戦・準備した正面攻撃と比べて
 * 主目標に届かない・損害が大きい・崩せる敵が少ない（比べが合格条件。無計画な攻撃の勝敗は記録として書く）。準備した正面攻撃（伏兵を誘い、
 * 近い敵から順に当たり、本陣を上げて采配・号令を使う）は 16 通りで 2 勝と本陣に届きにくいが、その結果と理由も記録して比べる。
 * 副目標（迷った物見隊を連れ帰る）は作戦によって達成／未達成に分かれる。
 *
 * どれも「早送り」（決まった時刻に issueOrder・useAbility で命令を出す台本を runToEnd で最後まで進める）。
 * 台本は人が画面でできる程度の命令の数・間隔（数十秒おき）にしている。数字（兵の残り・時間）は forest.ts の釣り合いの目安。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, isActive, issueOrder, runToEnd, type BattleEvent, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { inZone } from '../proto3d/src/battle/fieldRules';
import { buildBattleSetup, getField, presetUnits, validateField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';

const FOREST = getField('forest')!;

/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]。'ability' は固有能力（対象の要る能力は { abilityTarget: 対象の部隊 id }）、'nearest' は「見えている一番近い敵へ攻撃」（今の相手が戦えるなら出さない） */
type Step = [number, string, Order | 'ability' | 'nearest' | { abilityTarget: string }];

const atk = (targetId: string): Order => ({ type: 'attack', targetId });
const mv = (x: number, z: number): Order => ({ type: 'move', x, z });
/** 本陣・物見隊以外の味方の部隊 */
const FIGHTERS = ['a_tadakatsu', 'a_sakai', 'a_sakakibara', 'a_ishikawa', 'a_yumi'];
/** 西の林を抜ける三隊 */
const FLANKERS = ['a_tadakatsu', 'a_sakai', 'a_ishikawa'];

function nearestEnemy(s: BattleState, id: string): Order | null {
    const u = s.units.find((x) => x.id === id)!;
    if (!isActive(u)) return null;
    if (u.order.type === 'attack') {
        const tid = u.order.targetId;
        const cur = s.units.find((x) => x.id === tid);
        if (cur && isActive(cur)) return null;
    }
    const e = s.units
        .filter((x) => x.side === 'enemy' && isActive(x) && x.seenBy.ally)
        .sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
    return e ? atk(e.id) : null;
}

interface Run {
    o: BattleOutcome;
    /** 味方の兵の損害の割合（0〜1） */
    loss: number;
    /** 部隊ごとの兵の残り */
    left: Record<string, number>;
    /** 断られた命令 */
    refused: string[];
    events: BattleEvent[];
}

function play(steps: Step[]): Run {
    const s = createBattle(buildBattleSetup(FOREST, 'standard'));
    const q = [...steps].sort((a, b) => a[0] - b[0]);
    const refused: string[] = [];
    const o = runToEnd(s, (st) => {
        while (q.length && st.t >= q[0]![0] - 1e-9) {
            const [t, id, ord] = q.shift()!;
            if (ord === 'nearest') {
                const n = nearestEnemy(st, id);
                if (n && !issueOrder(st, id, n)) refused.push(`${t}:${id}`);
            } else if (ord === 'ability') {
                if (!useAbility(st, id).ok) refused.push(`${t}:${id}`);
            } else if (typeof ord === 'object' && 'abilityTarget' in ord) {
                if (!useAbility(st, id, ord.abilityTarget).ok) refused.push(`${t}:${id}`);
            } else if (!issueOrder(st, id, ord)) refused.push(`${t}:${id}`);
        }
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    return { o, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused, events: s.events };
}

const statusOf = (r: Run, id: string) => r.o.units.find((u) => u.id === id)!.status;
const rescued = (r: Run) => r.o.objectives!.secondary.find((x) => x.id === 'forest_rescue')!.achieved;

// ---------------------------------------------------------------- 台本

/** 物見隊を始めに林の中を通して味方の陣へ下げる（空き地から南東へまっすぐ。林道は横切るだけ） */
const LOST_WOODS: Step[] = [[0, 'a_lost', mv(0, 130)]];
/** 物見隊を林道（見通される）へ出して、林道沿いに南へ下げる */
const LOST_ROAD: Step[] = [
    [0, 'a_lost', mv(-125, -60)],
    [20, 'a_lost', mv(-125, 80)],
    [80, 'a_lost', mv(0, 130)],
];

/**
 * 三隊で西の林を抜ける：まず西の林の南の縁へ入り（0 秒）、中央の道から離れた所（x -115〜-85）を北の縁まで進む（50 秒。着くのは 170 秒ごろ）。
 * 途中で、林道沿いに下りてくる追っ手を林の中で不意に突く（待機中の部隊が間合いで斬り合う）。
 */
const WOODS_MARCH: Step[] = [
    [0, 'a_sakai', mv(-115, 50)],
    [0, 'a_ishikawa', mv(-100, 55)],
    [0, 'a_tadakatsu', mv(-85, 60)],
    [50, 'a_sakai', mv(-115, -100)],
    [50, 'a_ishikawa', mv(-100, -100)],
    [50, 'a_tadakatsu', mv(-85, -100)],
];
/** 林の北の縁から、三隊そろって敵勢の本陣へ斬りかかる（200 秒） */
const STRIKE_HQ: Step[] = FLANKERS.map((id) => [200, id, atk('e_hq')] as Step);

/** 地形に合った作戦：物見隊を林の中から下げ、三隊で西の林を見られずに抜けて本陣へ。命令は 10 回（0・50・200 秒） */
const FIT: Step[] = [...LOST_WOODS, ...WOODS_MARCH, ...STRIKE_HQ];

/** t 秒ごとに、ids の部隊へ「見えている一番近い敵へ攻撃」（今の相手が戦えるなら出さない） */
const nearestAt = (ts: number[], ids: string[]): Step[] => ts.flatMap((t) => ids.map((id) => [t, id, 'nearest'] as Step));

/**
 * 準備した正面攻撃（中央の道を攻め上る）：物見隊は林の中から下げる。忠勝隊を道の東の伏兵の守る区域の縁 (0,25) へ出して伏兵を誘い、
 * 酒井隊・石川隊はその左右の後ろ（道の外の開けた所）、弓はすぐ後ろ、家康本陣も (0,75) へ上げて号令の届く所に置く。榊原隊（騎馬）は予備。
 * 60・90・120 秒に四隊が見えている一番近い敵へ当たり、70 秒に酒井隊の両翼の采配、80 秒に家康の号令。200 秒に槍三隊と騎馬で本陣へ。
 * 命令は 24 回（0・60・70・80・90・120・200 秒）。回り込まない
 */
const PREPARED: Step[] = [
    ...LOST_WOODS,
    [0, 'a_tadakatsu', mv(0, 25)],
    [0, 'a_sakai', mv(-25, 50)],
    [0, 'a_ishikawa', mv(25, 50)],
    [0, 'a_yumi', mv(0, 60)],
    [0, 'a_ieyasu', mv(0, 75)],
    ...nearestAt([60, 90, 120], ['a_sakai', 'a_ishikawa', 'a_tadakatsu', 'a_yumi']),
    [70, 'a_sakai', 'ability'],
    [80, 'a_ieyasu', 'ability'],
    ...['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_sakakibara'].map((id) => [200, id, atk('e_hq')] as Step),
];

/** 無計画な攻撃：全部隊で敵勢の本陣へ攻めかかる（中央の道を攻め上る） */
const ALL_HQ: Step[] = [...LOST_WOODS, ...FIGHTERS.map((id) => [0, id, atk('e_hq')] as Step)];

/** 命令の時刻を ±15 秒ずらした 16 通り（決まった乱数で作る。0 秒の命令はずらさない。地形に合った作戦の 16 通りと同じ作り方） */
function variants16(base: Step[]): Run[] {
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const out: Run[] = [];
    for (let k = 0; k < 16; k++) out.push(play(base.map(([t, id, o]) => [t === 0 ? 0 : t + Math.round((rnd() - 0.5) * 30), id, o] as Step)));
    return out;
}
const count = (rs: Run[], result: BattleOutcome['result']) => rs.filter((r) => r.o.result === result).length;
/** 崩した（敗走・全滅させた）敵の部隊の数 */
const broken = (r: Run) => r.o.units.filter((u) => u.side === 'enemy' && u.status !== 'ready').length;

/** 比べの基準（同じ台本は 1 回だけ進める） */
const memo = new Map<Step[], Run>();
const run = (steps: Step[]): Run => {
    if (!memo.has(steps)) memo.set(steps, play(steps));
    return memo.get(steps)!;
};

describe('森林のデータ', () => {
    it('検査を通る。味方 6＋迷った物見隊／敵 8（敵はすべて敵勢）。林の奇襲と林の中の騎馬の遅さ。通れない所は無い', () => {
        expect(validateField(FOREST)).toEqual([]);
        const us = presetUnits(FOREST, 'standard');
        expect(us.filter((u) => u.side === 'ally').map((u) => u.id)).toEqual(['a_ieyasu', 'a_tadakatsu', 'a_sakai', 'a_sakakibara', 'a_ishikawa', 'a_yumi', 'a_lost']);
        expect(us.find((u) => u.id === 'a_sakakibara')!.kind).toBe('kiba');
        expect(us.filter((u) => u.side === 'enemy')).toHaveLength(8);
        expect(us.filter((u) => u.side === 'enemy').every((u) => u.clan === 'rival')).toBe(true);
        expect(FOREST.specialRules).toEqual([{ type: 'woods_ambush', firstStrikeMul: 1.5, sec: 8 }]);
        expect(FOREST.terrainRules?.woods).toMatchObject({ speed: 0.5, kindSpeed: { kiba: 0.5 }, hideSight: 60 });
        expect(createBattle(buildBattleSetup(FOREST, 'standard')).field.nav).toBeNull();
    });

    it('敵の考え：本陣と騎馬が本陣を守り、弓・先手が中央の道を固め、道の両脇の林に伏兵（持ち場は林の中・守る区域は道）、追っ手は西の林へ下りる', () => {
        const us = presetUnits(FOREST, 'standard').filter((u) => u.side === 'enemy');
        const roles = Object.fromEntries(us.map((u) => [u.id, u.aiRole]));
        expect(roles).toEqual({ e_hq: 'guard_hq', e_kiba: 'guard_hq', e_yumi_l: 'hold_line', e_yumi_r: 'hold_line', e_sente: 'hold_line', e_ambush_w: 'hold_zone', e_ambush_e: 'hold_zone', e_hunters: 'assault' });
        const s = createBattle(buildBattleSetup(FOREST, 'standard'));
        const inWoods = (x: number, z: number) => FOREST.terrain.some((a) => a.kind === 'woods' && inZone(a, x, z));
        for (const id of ['e_ambush_w', 'e_ambush_e']) {
            const u = s.units.find((x) => x.id === id)!;
            // 持ち場は林の中（始めは見えない）で、守る区域の中心は中央の道（x -35〜35）
            expect(inWoods(u.x, u.z)).toBe(true);
            expect(u.seenBy.ally).toBe(false);
            expect(Math.abs(u.aiTarget!.x)).toBeLessThan(35);
            expect(Math.hypot(u.x - u.aiTarget!.x, u.z - u.aiTarget!.z)).toBeLessThanOrEqual(u.aiTarget!.r!);
        }
        // 迷った物見隊は空き地（見通される）にいる
        const lost = s.units.find((x) => x.id === 'a_lost')!;
        expect(inWoods(lost.x, lost.z)).toBe(false);
        expect(lost.seenBy.enemy).toBe(true);
    });
});

// 合格条件は「正面なら負ける」ではなく、同じ台本・同じ数字での比べ（地形に合った作戦・準備した正面攻撃と比べて、主目標に届かない・
// 損害が大きい・崩せる敵が少ない）。無計画な攻撃の勝敗は「記録」として残す（台本と数字は前のまま。変わったら理由と前後の数字を書いて直す）
describe('森林：無計画な攻撃・地形に合わない作戦と、地形に合った作戦の比べ（早送り）', () => {
    it('何もしない → 地形に合った作戦（主目標・副目標とも達成）と違い、どちらも果たせない（記録：物見隊が追っ手に崩され、本陣へも届かずに日没）', () => {
        const r = run([]);
        expect(run(FIT).o.objectives!.primary!.achieved).toBe(true);
        expect(rescued(run(FIT))).toBe(true);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(rescued(r)).toBe(false);
        // 記録
        expect(r.o.result).toBe('retreat');
        expect(r.o.reason).toBe('nightfall');
        expect(statusOf(r, 'a_lost')).toBe('routed');
    });

    it('全部隊で敵勢の本陣へ攻めかかる（無計画に中央の道を攻め上る）→ 地形に合った作戦より損害が大きく、主目標に届かず、準備した正面攻撃より崩せる敵が少ない（記録：道の両脇の伏兵に横を突かれ、弓に射られて負ける）', () => {
        const r = run(ALL_HQ);
        // 確かめた時：無計画 166.8 秒に負け・損害 38.6％・崩した敵 2 隊 ／ 地形に合った作戦 勝ち・14.9％ ／ 準備した正面攻撃 日没・52.7％・崩した敵 5 隊
        expect(r.loss).toBeGreaterThan(run(FIT).loss + 0.1);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(broken(r)).toBeLessThan(broken(run(PREPARED)));
        // 記録
        expect(r.o.result).toBe('defeat');
        expect(r.loss).toBeGreaterThan(0.3);
        expect(r.left.e_hq).toBe(350);
        // 伏兵が林から不意を突いた
        expect(r.events.some((e) => e.kind === 'ambush' && e.unitId?.startsWith('e_ambush'))).toBe(true);
    });

    it('全部隊で中央の道の中ほどへ出てから本陣へ（無計画）→ 地形に合った作戦より損害が大きく、主目標に届かない（記録：負ける）', () => {
        const r = run([...LOST_WOODS, ...FIGHTERS.map((id) => [0, id, mv(0, -60)] as Step), ...FIGHTERS.map((id) => [90, id, atk('e_hq')] as Step)]);
        // 確かめた時：166.8 秒に負け・損害 36.0％
        expect(r.loss).toBeGreaterThan(run(FIT).loss + 0.1);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).toBe('defeat');
    });

    it('道の先手へ四隊・弓へ騎馬で当たり、30 秒ごとに崩れた相手から近い敵へ当て直す（無計画）→ 地形に合った作戦より損害が大きく、主目標に届かない（記録：負ける）', () => {
        const again = [60, 90, 120, 150, 180, 210, 240].flatMap((t) => FIGHTERS.map((id) => [t, id, 'nearest'] as Step));
        const r = run([
            ...LOST_WOODS,
            [0, 'a_tadakatsu', atk('e_sente')],
            [0, 'a_sakai', atk('e_sente')],
            [0, 'a_ishikawa', atk('e_sente')],
            [0, 'a_yumi', atk('e_sente')],
            [0, 'a_sakakibara', atk('e_yumi_l')],
            ...again,
        ]);
        // 確かめた時：370.2 秒に負け・損害 40.1％
        expect(r.loss).toBeGreaterThan(run(FIT).loss + 0.1);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).toBe('defeat');
        expect(r.loss).toBeGreaterThan(0.35);
    });

    it('同じ三隊で回るが、林道（見通される）を通る → 林の中を通る同じ三隊より損害が大きく、主目標に届かない（記録：不意を突けず日没）', () => {
        const r = run([
            ...LOST_WOODS,
            [0, 'a_sakai', mv(-125, 75)],
            [0, 'a_ishikawa', mv(-125, 90)],
            [0, 'a_tadakatsu', mv(-125, 105)],
            [50, 'a_sakai', mv(-125, -100)],
            [50, 'a_ishikawa', mv(-125, -80)],
            [50, 'a_tadakatsu', mv(-125, -60)],
            ...STRIKE_HQ,
        ]);
        // 確かめた時：日没・損害 47.4％（林の中を通ると 268.8 秒に勝ち・14.9％）
        expect(r.loss).toBeGreaterThan(run(FIT).loss + 0.2);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).not.toBe('victory');
        expect(r.loss).toBeGreaterThan(0.4);
    });

    it('同じ三隊で回るが、中央の道のすぐ脇の林を通る → 道から離れた林を通る同じ三隊より損害が大きく、主目標に届かない（記録：西の伏兵に見つかって組み合い、日没）', () => {
        const r = run([
            ...LOST_WOODS,
            [0, 'a_sakai', mv(-45, 60)],
            [0, 'a_ishikawa', mv(-50, 70)],
            [0, 'a_tadakatsu', mv(-40, 80)],
            [50, 'a_sakai', mv(-45, -100)],
            [50, 'a_ishikawa', mv(-55, -100)],
            [50, 'a_tadakatsu', mv(-40, -100)],
            ...STRIKE_HQ,
        ]);
        // 確かめた時：日没・損害 41.3％
        expect(r.loss).toBeGreaterThan(run(FIT).loss + 0.2);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).not.toBe('victory');
        expect(r.events.some((e) => e.kind === 'engage' && e.text.includes('伏兵（西）'))).toBe(true);
    });

    it('西の林を一隊（忠勝隊）だけで抜けて本陣へ → 三隊で抜ける作戦と違い、主目標に届かず、忠勝隊を失う（記録：守りの騎馬は崩せても本陣は崩せず日没）', () => {
        const r = run([...LOST_WOODS, [0, 'a_tadakatsu', mv(-100, 55)], [50, 'a_tadakatsu', mv(-100, -100)], [200, 'a_tadakatsu', atk('e_hq')]]);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.left.a_tadakatsu).toBeLessThan(run(FIT).left.a_tadakatsu! - 100);
        // 記録
        expect(r.o.result).not.toBe('victory');
        expect(r.left.a_tadakatsu).toBeLessThan(100);
    });
});

describe('森林：地形に合った作戦（早送り）', () => {
    it('物見隊を林の中から下げ、三隊で西の林を見られずに抜けて本陣へ斬りかかる → 勝つ（副目標も達成）', () => {
        const r = play(FIT);
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(r.o.reason).toBe('enemy_hq_routed');
        expect(r.o.objectives!.primary!.achieved).toBe(true);
        expect(rescued(r)).toBe(true);
        expect(r.loss).toBeLessThan(0.25);
        expect(r.o.elapsedSec).toBeLessThan(300);
        // 林の中で追っ手を、林の北の縁から本陣の守りを、どちらも不意を突いた
        const amb = r.events.filter((e) => e.kind === 'ambush' && FLANKERS.includes(e.unitId ?? ''));
        expect(amb.some((e) => e.targetId === 'e_hunters' && e.t < 150)).toBe(true);
        expect(amb.some((e) => e.t >= 200)).toBe(true);
        // 中央の道の伏兵・先手は一度も戦わずに終わる
        expect(r.left.e_ambush_w).toBe(300);
        expect(r.left.e_ambush_e).toBe(350);
    });

    it('同じ作戦で、命令の時刻を ±15 秒ずらした 16 通りのうち 15 通り以上で勝つ（決まった乱数で作る。確かめた時は 16 勝）', () => {
        let seed = 11;
        const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        let wins = 0;
        for (let k = 0; k < 16; k++) {
            const steps = FIT.map(([t, id, o]) => [t === 0 ? 0 : t + Math.round((rnd() - 0.5) * 30), id, o] as Step);
            if (play(steps).o.result === 'victory') wins++;
        }
        expect(wins).toBeGreaterThanOrEqual(15);
    }, 60_000);

    // Version 13 候補で後詰めの差配は「味方の部隊を 1 つ選ぶ・石川隊は 30 秒動けない」能力に変わった（前は対象なし）。本陣へ斬りかかる忠勝隊を選ぶ
    it('固有能力を足しても勝つ（本陣へ斬りかかった後に酒井隊の両翼の采配・石川隊の後詰めの差配で忠勝隊を立て直す）', () => {
        const r = play([...FIT, [210, 'a_sakai', 'ability'], [210, 'a_ishikawa', { abilityTarget: 'a_tadakatsu' }]]);
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(Object.keys(r.o.abilitiesUsed ?? {}).sort()).toEqual(['a_ishikawa', 'a_sakai']);
    });

    it('榊原隊（騎馬）は林を通らず林道で北へ上げ、本陣へ突っ込ませても勝つ（林道なら騎馬は速い）', () => {
        const r = play([...FIT, [0, 'a_sakakibara', mv(-125, 75)], [100, 'a_sakakibara', mv(-125, -100)], [210, 'a_sakakibara', atk('e_hq')]]);
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(r.loss).toBeLessThan(0.3);
    });
});

describe('森林：副目標（迷った物見隊を連れ帰る）は作戦で分かれる（早送り）', () => {
    it('本隊の作戦が同じでも、物見隊を始めに下げる → 達成／60 秒後まで放っておく → 勝っても未達成（空き地で追っ手に崩される）', () => {
        const early = play(FIT);
        const late = play([[60, 'a_lost', mv(0, 130)], ...WOODS_MARCH, ...STRIKE_HQ]);
        expect(early.o.result).toBe('victory');
        expect(late.o.result).toBe('victory');
        expect(rescued(early)).toBe(true);
        expect(rescued(late)).toBe(false);
        expect(statusOf(late, 'a_lost')).toBe('routed');
        // 60 秒後の命令は、崩れた後なので断られる
        expect(late.refused).toEqual(['60:a_lost']);
        // 勝敗・主目標・副目標は別の欄
        expect(late.o.objectives!.primary!.achieved).toBe(true);
    });

    it('物見隊だけを動かす：林の中を通って下げる → 達成／林道へ出て下げる → 林道沿いに下りてくる追っ手に見つかって未達成', () => {
        const woods = play(LOST_WOODS);
        const road = play(LOST_ROAD);
        expect(rescued(woods)).toBe(true);
        expect(rescued(road)).toBe(false);
        expect(statusOf(road, 'a_lost')).toBe('routed');
        // どちらも本隊は動かしていないので、主目標は果たせない（日没）
        expect(woods.o.reason).toBe('nightfall');
        expect(road.o.reason).toBe('nightfall');
    });
});

// 森林では準備した正面攻撃は、たまにしか本陣に届かない（16 通りで 2 勝）。理由：中央の道の守りは 5 隊（先手 450・伏兵 300 と 350・弓 250 が
// 2 隊）で、林の中の伏兵は見えないまま横から当たり（林の奇襲：最初の 8 秒の損害 ×1.5）、道の出口の弓 2 隊が道の上を射る。伏兵を道の外へ誘い、
// 家康本陣を号令の届く所まで上げて当たれば、道の守りの多くを崩せるが、そのころには当たった槍も多くが敗走し（200 秒の本陣への命令は
// 忠勝隊がもう敗走していて断られる）、本陣と守りの騎馬は無傷のまま残る。無計画な攻撃と比べて良いのは「負けが少ない（16 → 3）・
// 崩せる敵が多い・ときどき勝つ」。損害の割合はかえって大きい（無計画な攻撃は早く崩れて終わるが、準備した攻撃は日没まで戦い続けるため）
describe('森林：準備した正面攻撃（早送り）', () => {
    it('伏兵を道の外へ誘い、近い敵から順に当たり、本陣を上げて采配・号令を使って攻め上る（記録：日没・損害 52.7％・崩した敵 5 隊・物見隊は連れ帰る。忠勝隊は 200 秒までに敗走）', () => {
        const r = run(PREPARED);
        expect(r.refused).toEqual(['200:a_tadakatsu']);
        expect(Object.keys(r.o.abilitiesUsed ?? {}).sort()).toEqual(['a_ieyasu', 'a_sakai']);
        // 記録
        expect(r.o.result).toBe('retreat');
        expect(r.o.reason).toBe('nightfall');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(rescued(r)).toBe(true);
        expect(broken(r)).toBe(5);
        for (const id of ['e_sente', 'e_ambush_w', 'e_ambush_e']) expect(statusOf(r, id)).not.toBe('ready');
        expect(statusOf(r, 'e_hq')).toBe('ready');
    });

    it('16 通りで、無計画な攻め上り（全部隊で本陣へ）より負けが少なく、勝ちが多く、崩せる敵が多い。損害の割合はかえって大きい（記録：準備 2 勝・負け 3・平均 53.7％ ／ 無計画 0 勝・負け 16・38.6％ ／ 地形に合った作戦 16 勝）', () => {
        const prep = variants16(PREPARED);
        const reckless = variants16(ALL_HQ);
        expect(count(prep, 'defeat') + 10).toBeLessThanOrEqual(count(reckless, 'defeat'));
        expect(count(prep, 'victory')).toBeGreaterThan(count(reckless, 'victory'));
        expect(prep.reduce((a, r) => a + broken(r), 0)).toBeGreaterThan(reckless.reduce((a, r) => a + broken(r), 0) * 1.5);
        // 地形に合った作戦（林の中を抜ける）の方が、ずっと安定して勝つ
        expect(count(variants16(FIT), 'victory')).toBeGreaterThanOrEqual(count(prep, 'victory') + 10);
    }, 90_000);
});
