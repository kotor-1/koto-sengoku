/**
 * 戦場「森林」（forest）の釣り合い：地形に合わない作戦（放置・中央の道を攻め上る・見通される林道や道の脇の林を回る・一隊だけで回る）は
 * 負ける・日没・損害が大きい、地形に合った作戦（三隊で西の林の中を見られずに抜けて本陣へ斬りかかる）は勝つ、
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

describe('森林：地形に合わない作戦（早送り）', () => {
    it('何もしない → 物見隊が追っ手に崩され、本陣へも届かずに日没（主目標・副目標とも果たせない）', () => {
        const r = play([]);
        expect(r.o.result).toBe('retreat');
        expect(r.o.reason).toBe('nightfall');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(rescued(r)).toBe(false);
        expect(statusOf(r, 'a_lost')).toBe('routed');
    });

    it('全部隊で敵勢の本陣へ攻めかかる（中央の道を攻め上る）→ 道の両脇の伏兵に横を突かれ、弓に射られて負ける', () => {
        const r = play([...LOST_WOODS, ...FIGHTERS.map((id) => [0, id, atk('e_hq')] as Step)]);
        expect(r.o.result).toBe('defeat');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.loss).toBeGreaterThan(0.3);
        expect(r.left.e_hq).toBe(350);
        // 伏兵が林から不意を突いた
        expect(r.events.some((e) => e.kind === 'ambush' && e.unitId?.startsWith('e_ambush'))).toBe(true);
    });

    it('全部隊で中央の道の中ほどへ出てから本陣へ → 負ける', () => {
        const r = play([...LOST_WOODS, ...FIGHTERS.map((id) => [0, id, mv(0, -60)] as Step), ...FIGHTERS.map((id) => [90, id, atk('e_hq')] as Step)]);
        expect(r.o.result).toBe('defeat');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
    });

    it('道の先手へ四隊・弓へ騎馬で当たり、30 秒ごとに崩れた相手から近い敵へ当て直す → 負ける', () => {
        const again = [60, 90, 120, 150, 180, 210, 240].flatMap((t) => FIGHTERS.map((id) => [t, id, 'nearest'] as Step));
        const r = play([
            ...LOST_WOODS,
            [0, 'a_tadakatsu', atk('e_sente')],
            [0, 'a_sakai', atk('e_sente')],
            [0, 'a_ishikawa', atk('e_sente')],
            [0, 'a_yumi', atk('e_sente')],
            [0, 'a_sakakibara', atk('e_yumi_l')],
            ...again,
        ]);
        expect(r.o.result).toBe('defeat');
        expect(r.loss).toBeGreaterThan(0.35);
    });

    it('同じ三隊で回るが、林道（見通される）を通る → 不意を突けず、本陣を崩せない（日没・損害が大きい）', () => {
        const r = play([
            ...LOST_WOODS,
            [0, 'a_sakai', mv(-125, 75)],
            [0, 'a_ishikawa', mv(-125, 90)],
            [0, 'a_tadakatsu', mv(-125, 105)],
            [50, 'a_sakai', mv(-125, -100)],
            [50, 'a_ishikawa', mv(-125, -80)],
            [50, 'a_tadakatsu', mv(-125, -60)],
            ...STRIKE_HQ,
        ]);
        expect(r.o.result).not.toBe('victory');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.loss).toBeGreaterThan(0.4);
    });

    it('同じ三隊で回るが、中央の道のすぐ脇の林を通る → 西の伏兵に見つかって組み合い、本陣を崩せない', () => {
        const r = play([
            ...LOST_WOODS,
            [0, 'a_sakai', mv(-45, 60)],
            [0, 'a_ishikawa', mv(-50, 70)],
            [0, 'a_tadakatsu', mv(-40, 80)],
            [50, 'a_sakai', mv(-45, -100)],
            [50, 'a_ishikawa', mv(-55, -100)],
            [50, 'a_tadakatsu', mv(-40, -100)],
            ...STRIKE_HQ,
        ]);
        expect(r.o.result).not.toBe('victory');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.events.some((e) => e.kind === 'engage' && e.text.includes('伏兵（西）'))).toBe(true);
    });

    it('西の林を一隊（忠勝隊）だけで抜けて本陣へ → 守りの騎馬は崩せても本陣は崩せず、忠勝隊を失う', () => {
        const r = play([...LOST_WOODS, [0, 'a_tadakatsu', mv(-100, 55)], [50, 'a_tadakatsu', mv(-100, -100)], [200, 'a_tadakatsu', atk('e_hq')]]);
        expect(r.o.result).not.toBe('victory');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
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
