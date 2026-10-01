/**
 * 戦場「水田」（paddy）の釣り合い（docs/fields-group2-design.md §4）。
 * 街道の北で立ち往生した荷駄隊を、南の退き口まで退かせる（撤退支援）。中の交わりを敵勢の先回りの備え（槍 900）が塞ぎ、
 * 交わりより南の街道とその両脇の田の際は狭い正面（同じ相手へ 1 部隊まで）。140 秒に追っ手（騎馬・槍）が街道を攻め下る。
 *
 * 地形に合わない作戦（放置・荷駄隊をすぐ退かせる・街道だけで押す（能力・弓・家康本陣も・当て直しても））は負ける（主目標を果たせない）。
 * 地形に合った作戦（忠勝隊が街道から備えを押さえ、酒井隊は西の田を横切って中の畦道の西から、榊原隊は東の畦道を回って東から、
 * 備えの横を突く。備えが崩れたら荷駄隊を撤退させる）は勝つ。副目標（追っ手の騎馬を崩す・損害 2 割以内）は、荷駄隊をすぐ退かせるか、
 * 待たせて追っ手を迎え撃つかで分かれる。
 * 武将の能力の価値が地形で変わる比べ：榊原の先駆けの号（畦道の上・水田の中）と、酒井の両翼の采配（正面と横から挟む・街道だけで押す）。
 *
 * どれも「早送り」（決まった時刻に issueOrder・useAbility で命令を出す台本を runToEnd で最後まで進める）。
 * 台本は人が画面でできる程度の命令の数・間隔にしている。移動の後の向き（face）は画面から指定できないので使わない。
 * 画面では敵の近くの地面を押すとその敵への攻撃になるので、台本の地面の行き先（tap）も、押す点の 20 m 以内に見えている敵がいれば
 * その敵への攻撃にする（例：交わりの中心 (0,55) を押すと、交わりの備えへの攻撃になる）。
 * 水田の中の点を行き先にすると、部隊はまっすぐ田を渡る（道探しは、行き先が田の中なら田を渡る線をそのまま使う）。畦道を通らせたいときは、
 * 台本でも画面と同じく、先に畦道の上の点を押してから次の行き先を押す。
 * 数字（兵の残り・時間）は paddy.ts の釣り合いの目安（作った時の値をコメントに残す）。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, isActive, issueOrder, runToEnd, unitById, unitSpeedFactor, RULES, KIND_STATS, type BattleState } from '../proto3d/src/battle/sim';
import { ABILITY_DATA, useAbility } from '../proto3d/src/battle/abilities';
import { inZone } from '../proto3d/src/battle/fieldRules';
import { buildBattleSetup, getField, presetUnits, validateField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';

const PD = getField('paddy')!;

/** 地面を押す（押す点の 20 m 以内に見えている敵がいれば、その敵への攻撃。画面と同じ） */
interface Tap {
    tap: [number, number];
}
/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]。'ability' は固有能力、'nearest' は「見えている一番近い敵へ攻撃」（今の相手が戦えるなら出さない） */
type Step = [number, string, Order | Tap | 'ability' | 'nearest'];

const atk = (targetId: string): Order => ({ type: 'attack', targetId });
const tap = (x: number, z: number): Tap => ({ tap: [x, z] });
const RETREAT: Order = { type: 'retreat' };
/** 本陣・荷駄隊以外の槍・騎馬 */
const MELEE = ['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_sakakibara'];
/** 中の交わり（先回りの備えの持ち場） */
const JUNCTION = tap(0, 55);

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
}

function play(steps: Step[], each?: (s: BattleState) => void): Run {
    const s = createBattle(buildBattleSetup(PD, 'standard'));
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
            } else if (!issueOrder(st, id, 'tap' in ord ? tapOrder(st, ord.tap) : ord)) refused.push(`${t}:${id}`);
        }
        each?.(st);
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    return { o, t: s.t, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused };
}

const secondaryOf = (r: Run, id: string) => r.o.objectives!.secondary.find((x) => x.id === id)!.achieved;
const statusOf = (r: Run, id: string) => r.o.units.find((u) => u.id === id)!.status;

/** 命令の時刻を ±15 秒ずらした 16 通り（決まった乱数。tests/proto3d-field-river_ford.test.ts と同じ作り方）の勝ち数と副目標の数 */
function jitterWins(base: Step[]): { wins: number; kibaOk: number; lossOk: number } {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let wins = 0;
    let kibaOk = 0;
    let lossOk = 0;
    for (let k = 0; k < 16; k++) {
        const steps = base.map(([t, id, o]) => [t === 0 ? 0 : t + Math.round((rnd() - 0.5) * 30), id, o] as Step);
        const r = play(steps);
        if (r.o.result === 'victory') wins++;
        if (secondaryOf(r, 'paddy_kiba')) kibaOk++;
        if (secondaryOf(r, 'paddy_losses')) lossOk++;
    }
    return { wins, kibaOk, lossOk };
}

// ---------------------------------------------------------------- 台本

/**
 * 地形に合った作戦（交わりの備えを正面と両横から。命令は 13 回）：
 * - 0 秒：酒井隊は西の田の中 (-40,80) へ（田をまっすぐ渡る）、榊原隊は東の畦道の北の端 (140,57) へ（乾いた原と東の畦道を駆ける）、
 *   弓隊は交わりの備えに届く (-20,130) へ、忠勝隊は街道の (0,110) で待つ。
 * - 30 秒：榊原隊は中の畦道を西へ (58,56)（東の弓の脇）、同時に先駆けの号。38 秒に東の弓へ。弓隊は備えを射る。
 * - 45 秒：酒井隊は田を渡り切って中の畦道の西 (-38,56) へ。
 * - 80 秒：忠勝隊は街道から備えへ（正面）、酒井隊は西から、榊原隊は東から（横）。110 秒に荷駄隊を撤退させる。
 */
const FIT: Step[] = [
    [0, 'a_sakai', tap(-40, 80)],
    [0, 'a_sakakibara', tap(140, 57)],
    [0, 'a_yumi', tap(-20, 130)],
    [0, 'a_tadakatsu', tap(0, 110)],
    [30, 'a_sakakibara', tap(58, 56)],
    [30, 'a_sakakibara', 'ability'],
    [38, 'a_sakakibara', atk('e_yumi_e')],
    [30, 'a_yumi', atk('e_block')],
    [45, 'a_sakai', tap(-38, 56)],
    [80, 'a_tadakatsu', atk('e_block')],
    [80, 'a_sakai', atk('e_block')],
    [80, 'a_sakakibara', atk('e_block')],
    [110, 'a_konida', RETREAT],
];
/** 地形に合った作戦のうち、荷駄隊の命令を除いたもの */
const FIT_ARMY = FIT.filter((s) => s[1] !== 'a_konida');

/**
 * 追っ手を迎え撃つ：地形に合った作戦で備えを崩した後、荷駄隊を中の畦道の東 (70,55) で待たせ、追っ手の騎馬を榊原隊・忠勝隊・酒井隊で
 * 迎え撃ってから、240 秒に荷駄隊を撤退させる（命令は 17 回）
 */
const COUNTER: Step[] = [
    ...FIT_ARMY,
    [110, 'a_konida', tap(70, 55)],
    [165, 'a_sakakibara', atk('e_kiba')],
    [165, 'a_tadakatsu', atk('e_kiba')],
    [175, 'a_sakai', atk('e_kiba')],
    [240, 'a_konida', RETREAT],
];

/** 正面突破（街道だけで押す）：槍・騎馬の四隊で交わりへ（画面で交わりを押す＝備えへの攻撃）。弓は街道を上がって備えを射る。110 秒に荷駄隊を撤退させる */
const PUSH: Step[] = [...MELEE.map((id) => [0, id, JUNCTION] as Step), [0, 'a_yumi', tap(0, 125)], [30, 'a_yumi', atk('e_block')], [110, 'a_konida', RETREAT]];

describe('水田のデータ', () => {
    it('検査を通る。味方 7（荷駄隊を含む）／敵 6（追っ手 2 を含む・すべて敵勢）。道 4・水田 5・道探し・狭い正面 1。主目標は荷駄隊の救出（敵本陣の撃破ではない）', () => {
        expect(validateField(PD)).toEqual([]);
        const us = presetUnits(PD, 'standard');
        expect(us.filter((u) => u.side === 'ally').map((u) => u.id)).toEqual(['a_ieyasu', 'a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa', 'a_yumi', 'a_konida']);
        expect(us.find((u) => u.id === 'a_sakakibara')!.kind).toBe('kiba');
        const en = us.filter((u) => u.side === 'enemy');
        expect(en.map((u) => u.id)).toEqual(['e_hq', 'e_block', 'e_yumi_w', 'e_yumi_e', 'e_kiba', 'e_yari']);
        expect(en.every((u) => u.clan === 'rival')).toBe(true);
        expect(PD.terrain.filter((t) => t.kind === 'road')).toHaveLength(4);
        expect(PD.terrain.filter((t) => t.kind === 'paddy')).toHaveLength(5);
        expect(PD.pathfinding).toBe(true);
        // 水田の速さ・損害は既定（騎馬 ×0.2・弓 ×0.35）のまま。戦場で上書きしない
        expect(PD.terrainRules).toBeUndefined();
        expect(PD.specialRules).toEqual([{ type: 'narrow_frontage', zone: { rect: { x0: -25, x1: 25, z0: 68, z1: 125 } }, maxEngaged: 1 }]);
        expect(PD.objectives.primary).toMatchObject({ id: 'paddy_rescue', type: 'rescue', unitId: 'a_konida' });
        expect(PD.objectives.secondary.map((o) => [o.id, o.type])).toEqual([
            ['paddy_kiba', 'break_unit'],
            ['paddy_losses', 'limit_losses'],
        ]);
        // 追っ手は援軍（140 秒に街道の北の端）。合戦の設定の援軍に入り、画面に出る所の印が付く
        expect(PD.reinforcements).toEqual([{ id: 'pursuit', side: 'enemy', at: 140, point: { x: 0, z: -195, facing: Math.PI }, label: '追っ手（敵勢の騎馬・槍）' }]);
        const setup = buildBattleSetup(PD, 'standard');
        expect(setup.reinforcements).toEqual([{ id: 'pursuit', side: 'enemy', unitIds: ['e_kiba', 'e_yari'] }]);
        // 主目標・副目標は結果に別々に入る
        const s = createBattle(setup);
        expect(s.objectives!.primary!.def.id).toBe('paddy_rescue');
        expect(s.objectives!.secondary.map((r) => r.def.id)).toEqual(['paddy_kiba', 'paddy_losses']);
    });

    it('地形の速さ（状態を直接置いて読む）：街道・畦道は騎馬 ×1.2、水田の中は騎馬 ×0.2・槍 ×0.3・弓 ×0.35。先駆けの号の ×1.8 は田の中では 6 × 0.2 × 1.8 ≈ 2.2 m/秒', () => {
        const s = createBattle(buildBattleSetup(PD, 'standard'));
        const f = (kind: 'kiba' | 'yari' | 'yumi', x: number, z: number) => unitSpeedFactor(s, { kind, x, z });
        // 街道・中の畦道・東の畦道
        for (const [x, z] of [[0, 100], [-80, 54], [140, 90]] as const) expect(f('kiba', x, z)).toBeCloseTo(1.2, 5);
        // 水田（西の田・東の田・北の田）
        for (const [x, z] of [[-40, 80], [60, 70], [-45, 0]] as const) {
            expect(f('kiba', x, z)).toBeCloseTo(0.2, 5);
            expect(f('yari', x, z)).toBeCloseTo(0.3, 5);
            expect(f('yumi', x, z)).toBeCloseTo(0.35, 5);
        }
        const vanguard = ABILITY_DATA.sakakibara_vanguard.selfSpeedMul;
        expect(vanguard).toBe(1.8);
        expect(KIND_STATS.kiba.speed * 1.2 * vanguard).toBeCloseTo(12.96, 5);
        expect(KIND_STATS.kiba.speed * 0.2 * vanguard).toBeCloseTo(2.16, 5);
    });

    it('置き方：備えの持ち場は狭い正面の外で、街道の南から当たる所は中・中の畦道の東西から当たる所は外。弓は味方の最初の陣と荷駄隊に届かない', () => {
        const rule = PD.specialRules![0]!;
        if (rule.type !== 'narrow_frontage') throw new Error('narrow_frontage のはず');
        const block = PD.deployments.enemy.find((d) => d.id === 'block')!;
        expect([block.x, block.z]).toEqual([0, 55]);
        expect(inZone(rule.zone, block.x, block.z)).toBe(false);
        // 街道の南から斬りかかる所（備えの 22〜25 m 南）と、その脇の田の際は区域の中
        for (const [x, z] of [[0, 78], [-18, 75], [18, 75]] as const) expect(inZone(rule.zone, x, z)).toBe(true);
        // 中の畦道の東西から斬りかかる所は区域の外
        for (const [x, z] of [[-25, 56], [25, 56], [-18, 64]] as const) expect(inZone(rule.zone, x, z)).toBe(false);
        // 弓 2 隊（交わりの北の両脇の田）は、味方の最初の陣（荷駄隊を除く）と荷駄隊に届かない
        const range = RULES.bowRange;
        for (const id of ['yumi_w', 'yumi_e']) {
            const y = PD.deployments.enemy.find((d) => d.id === id)!;
            for (const a of PD.deployments.ally) expect(Math.hypot(a.x - y.x, a.z - y.z)).toBeGreaterThan(range);
        }
        // 荷駄隊は、備えの当たる距離（区域 12 m + 10 m）の外
        const k = PD.deployments.ally.find((d) => d.id === 'konida')!;
        expect(Math.hypot(k.x - block.x, k.z - block.z)).toBeGreaterThan(12 + 10);
    });
});

describe('水田：地形に合わない作戦（早送り）', () => {
    it('何もしない → 追っ手（140 秒）に荷駄隊が追いつかれて負ける（作った時 153 秒）', () => {
        const r = play([]);
        expect(r.o.result).toBe('defeat');
        expect(r.o.reason).toBe('objective_failed');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.t).toBeGreaterThan(140);
        expect(statusOf(r, 'a_konida')).not.toBe('ready');
    });

    it('荷駄隊をすぐ撤退させる → 交わりの備えにぶつかって崩れ、負ける（作った時 41.6 秒）', () => {
        const r = play([[0, 'a_konida', RETREAT]]);
        expect(r.o.result).toBe('defeat');
        expect(r.t).toBeLessThan(80);
    });

    it('正面突破（街道だけで押す）：四隊で交わりへ → 狭い正面で 1 部隊ずつしか当たれず、四隊とも崩れて備えは残る。荷駄隊は追いつかれて負ける（作った時 158.7 秒・損害 43.1％）', () => {
        let maxInZone = 0;
        const rule = PD.specialRules![0]!;
        if (rule.type !== 'narrow_frontage') throw new Error('narrow_frontage のはず');
        const r = play(PUSH, (s) => {
            // 狭い正面の区域の中から備えと斬り合っている味方は、いつも 1 部隊まで
            const n = s.units.filter((u) => u.side === 'ally' && u.engagedWith === 'e_block' && inZone(rule.zone, u.x, u.z)).length;
            maxInZone = Math.max(maxInZone, n);
        });
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('defeat');
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        expect(r.loss).toBeGreaterThan(0.4);
        expect(maxInZone).toBe(1);
        expect(statusOf(r, 'e_block')).toBe('ready');
        for (const id of MELEE) expect(statusOf(r, id)).not.toBe('ready');
    });

    it('街道だけで押して、能力も使う（榊原の先駆け・酒井の両翼・忠勝の守護・家康の号令）／弓・家康本陣も交わりへ／30 秒ごとに近い敵へ当て直す → どれも負ける（損害 4 割超）', () => {
        const ab = play([...PUSH, [25, 'a_sakakibara', 'ability'], [40, 'a_sakai', 'ability'], [30, 'a_tadakatsu', 'ability'], [60, 'a_ieyasu', 'ability']]);
        expect(ab.refused).toEqual([]);
        const all = play([...MELEE.map((id) => [0, id, JUNCTION] as Step), [0, 'a_yumi', atk('e_block')], [0, 'a_ieyasu', tap(0, 90)], [110, 'a_konida', RETREAT]]);
        const again = play([...PUSH, ...[30, 60, 90, 120, 150].flatMap((t) => MELEE.map((id) => [t, id, 'nearest'] as Step))]);
        for (const r of [ab, all, again]) {
            expect(r.o.result).toBe('defeat');
            expect(r.o.objectives!.primary!.achieved).toBe(false);
            expect(r.loss).toBeGreaterThan(0.4);
            expect(statusOf(r, 'e_block')).toBe('ready');
        }
    });

    it('街道だけで押す：命令の時刻を ±15 秒ずらした 16 通りでも 1 度も勝たない', () => {
        expect(jitterWins(PUSH).wins).toBe(0);
    }, 60_000);
});

describe('水田：地形に合った作戦（早送り）', () => {
    it('正面で押さえ、田と畦道から横を突く → 備えが崩れ、荷駄隊が退いて勝つ（作った時 179.5 秒・損害 10.4％）。酒井隊・榊原隊は狭い正面の外（交わりの横）から当たる', () => {
        const rule = PD.specialRules![0]!;
        if (rule.type !== 'narrow_frontage') throw new Error('narrow_frontage のはず');
        let sakaiWest = false;
        let sakaEast = false;
        let tadaFront = false;
        let sakaiWaded = false;
        const r = play(FIT, (s) => {
            const k = unitById(s, 'a_sakai')!;
            if (k.engagedWith === 'e_block' && k.x < -15 && !inZone(rule.zone, k.x, k.z)) sakaiWest = true;
            // 酒井隊は西の田の中を渡った（街道・畦道を通らずに中の畦道へ）
            if (s.t < 80 && k.x < -20 && k.z > 62 && k.z < 118 && unitSpeedFactor(s, k) < 0.5) sakaiWaded = true;
            const b = unitById(s, 'a_sakakibara')!;
            if (b.engagedWith === 'e_block' && b.x > 15 && !inZone(rule.zone, b.x, b.z)) sakaEast = true;
            const t = unitById(s, 'a_tadakatsu')!;
            if (t.engagedWith === 'e_block' && inZone(rule.zone, t.x, t.z)) tadaFront = true;
        });
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(r.o.reason).toBe('objective_done');
        expect(r.o.objectives!.primary!.achieved).toBe(true);
        expect(statusOf(r, 'e_block')).not.toBe('ready');
        expect(r.loss).toBeLessThan(0.15);
        expect(sakaiWaded).toBe(true);
        expect(sakaiWest).toBe(true);
        expect(sakaEast).toBe(true);
        expect(tadaFront).toBe(true);
        // 正面突破（損害 4 割超・負け）と比べて、損害は 4 分の 1 ほど
        expect(r.loss).toBeLessThan(play(PUSH).loss - 0.25);
    });

    // 確かめた時（乱数の種 7）：16 勝（損害の平均 13.0％・2 割以内 16）。正面突破は 0 勝（損害の平均 42.9％）
    // 参考に種 1〜6・11 でも数えた：どの種でも地形に合った作戦は 16 勝（損害の平均 12.3〜13.5％）、正面突破は 0 勝
    it('命令の時刻を ±15 秒ずらした 16 通り：地形に合った作戦は 14 通り以上で勝つ（確かめた時 16 勝）', () => {
        expect(jitterWins(FIT).wins).toBeGreaterThanOrEqual(14);
    }, 60_000);

    it('荷駄隊だけを田に入れて西へ大回りさせる（酒井隊が西の弓を崩す。第2群の最初の案の台本）→ 勝つこともあるが遅く、損害が大きい（作った時 347 秒・損害 47.5％、16 通りで 8 勝）', () => {
        const ROUND: Step[] = [
            [0, 'a_konida', tap(-160, -60)],
            [65, 'a_konida', tap(-160, -2)],
            [0, 'a_tadakatsu', tap(0, 12)],
            [0, 'a_sakai', tap(-30, 2)],
            [0, 'a_yumi', tap(-20, 60)],
            [0, 'a_sakakibara', tap(60, 110)],
            [70, 'a_sakakibara', 'nearest'],
            [70, 'a_sakai', 'nearest'],
            [150, 'a_konida', RETREAT],
        ];
        const r = play(ROUND);
        const fit = play(FIT);
        if (r.o.result === 'victory') expect(r.t).toBeGreaterThan(fit.t + 100);
        expect(r.loss).toBeGreaterThan(fit.loss + 0.2);
        expect(jitterWins(ROUND).wins).toBeLessThan(14);
    }, 60_000);
});

describe('水田：副目標は作戦で分かれる（早送り）', () => {
    it('荷駄隊をすぐ退かせる → 損害 2 割以内 ✓・追っ手の騎馬 ✗。荷駄隊を待たせて追っ手を迎え撃つ → 追っ手の騎馬 ✓・損害 2 割以内 ✗（作った時 285.6 秒・損害 23.8％）。勝ち負け・主目標・副目標は別の欄', () => {
        const fit = play(FIT);
        const counter = play(COUNTER);
        expect(counter.refused).toEqual([]);
        for (const r of [fit, counter]) {
            expect(r.o.result).toBe('victory');
            expect(r.o.objectives!.primary!.achieved).toBe(true);
        }
        expect([secondaryOf(fit, 'paddy_kiba'), secondaryOf(fit, 'paddy_losses')]).toEqual([false, true]);
        expect([secondaryOf(counter, 'paddy_kiba'), secondaryOf(counter, 'paddy_losses')]).toEqual([true, false]);
        expect(counter.t).toBeGreaterThan(fit.t + 60);
        expect(counter.loss).toBeGreaterThan(fit.loss);
    });

    // 確かめた時：すぐ退かせる 16 勝（騎馬 0・損害 2 割以内 16）、迎え撃つ 12 勝（騎馬 12・損害 2 割以内 3。崩した騎馬の分だけ損害が増える。
    // 負けた 4 通りは、荷駄隊が待つ間に追っ手に追いつかれた）
    it('±15 秒の 16 通り：すぐ退かせる作戦は追っ手の騎馬を崩さず、損害 2 割以内が多い。迎え撃つ作戦は騎馬を崩すことが多く、損害 2 割以内は少ない', () => {
        const fit = jitterWins(FIT);
        const counter = jitterWins(COUNTER);
        expect(fit.kibaOk).toBe(0);
        expect(fit.lossOk).toBeGreaterThanOrEqual(14);
        expect(counter.kibaOk).toBeGreaterThanOrEqual(10);
        expect(counter.lossOk).toBeLessThanOrEqual(6);
    }, 120_000);
});

/** 榊原隊を見る：t0（能力を使う時刻）からの 20 秒の動き・東の弓と斬り合い始めた時刻・弓が崩れた時刻・榊原隊の兵の残り */
function vanguardProbe(steps: Step[], t0: number) {
    let p0: { x: number; z: number } | null = null;
    let speedMax = 0;
    let prev: { x: number; z: number } | null = null;
    let contact = -1;
    let broke = -1;
    const r = play(steps, (s) => {
        const k = unitById(s, 'a_sakakibara')!;
        if (!p0 && s.t >= t0 - 1e-9) p0 = { x: k.x, z: k.z };
        // 効果の 20 秒のうち、いちばん速かった 1 刻みの速さ（m/秒）
        if (prev && s.t > t0 + 1e-9 && s.t <= t0 + 20 + 1e-9) speedMax = Math.max(speedMax, Math.hypot(k.x - prev.x, k.z - prev.z) / RULES.tick);
        prev = { x: k.x, z: k.z };
        if (contact < 0 && k.engagedWith === 'e_yumi_e') contact = s.t;
        if (broke < 0 && unitById(s, 'e_yumi_e')!.status !== 'ready') broke = s.t;
    });
    return { r, speedMax, contact, broke };
}

/** 交わりの備えを見る：酒井隊が斬り合い始めた時刻・包囲されていた秒数・崩れた時刻 */
function blockProbe(steps: Step[]) {
    let contact = -1;
    let enc = 0;
    let broke = -1;
    const r = play(steps, (s) => {
        if (contact < 0 && unitById(s, 'a_sakai')!.engagedWith === 'e_block') contact = s.t;
        if (s.encircled.includes('e_block')) enc += RULES.tick;
        if (broke < 0 && unitById(s, 'e_block')!.status !== 'ready') broke = s.t;
    });
    return { r, contact, enc, broke };
}

describe('水田：武将の能力の価値が地形で変わる（早送り）', () => {
    // 榊原の先駆けの号（20 秒・動き ×1.8・最初の 8 秒の当たり ×2.0・弓へ ×1.5・受ける損害 ×1.2・切れて士気 −15）
    // ほかの隊は地形に合った作戦のまま。榊原隊だけ、30 秒に東の弓へ向かう道を変える：
    // 畦道：東の畦道の北の端 (140,57) から中の畦道を西へ (58,56) → 38 秒に東の弓へ（畦道の端から当たる）
    // 水田：東の田の南の縁 (45,118) から、30 秒に東の弓へ（田をまっすぐ渡る）
    it('榊原の先駆けの号：畦道では約 13 m/秒で駆けて効果中に弓へ当たり、すぐ崩す。水田では約 2.2 m/秒にしかならず、当たる前に効果が切れる', () => {
        const rest = FIT.filter((s) => s[1] !== 'a_sakakibara');
        const LEVEE: Step[] = [...rest, [0, 'a_sakakibara', tap(140, 57)], [30, 'a_sakakibara', tap(58, 56)], [38, 'a_sakakibara', atk('e_yumi_e')], [80, 'a_sakakibara', atk('e_block')]];
        const PADDY: Step[] = [...rest, [0, 'a_sakakibara', tap(45, 118)], [30, 'a_sakakibara', atk('e_yumi_e')], [80, 'a_sakakibara', atk('e_block')]];
        const leveeNo = vanguardProbe(LEVEE, 30);
        const leveeUse = vanguardProbe([...LEVEE, [30, 'a_sakakibara', 'ability']], 30);
        const paddyNo = vanguardProbe(PADDY, 30);
        const paddyUse = vanguardProbe([...PADDY, [30, 'a_sakakibara', 'ability']], 30);
        for (const p of [leveeUse, paddyUse]) expect(p.r.refused).toEqual([]);
        const end = 30 + ABILITY_DATA.sakakibara_vanguard.durationSec;
        // 速さ（作った時）：畦道 7.2 → 13.0 m/秒、水田 1.2 → 2.2 m/秒。どちらも ×1.8 だが、水田では田の補正（騎馬 ×0.2）が掛かったまま
        expect(leveeUse.speedMax).toBeGreaterThan(12);
        expect(leveeNo.speedMax).toBeLessThan(7.5);
        expect(paddyUse.speedMax).toBeLessThan(2.5);
        expect(paddyNo.speedMax).toBeLessThan(1.5);
        // 畦道（作った時）：使えば 37.5 秒に当たり（効果中）、当たってから 1.9 秒で弓が崩れる（使わないと 46.3 秒に当たり、53.9 秒に崩れる）
        expect(leveeUse.contact).toBeGreaterThan(30);
        expect(leveeUse.contact).toBeLessThan(end);
        expect(leveeUse.broke - leveeUse.contact).toBeLessThan(4);
        expect(leveeUse.broke).toBeLessThan(leveeNo.broke - 10);
        // 水田（作った時）：使っても当たるのは 63.3 秒（効果が切れた 50 秒より後）で、当たってから 10.2 秒で崩れる。
        // 使わないと 79.2 秒に当たり、弓は崩れない（田を渡る間に射られ続ける）
        expect(paddyUse.contact).toBeGreaterThan(end);
        expect(paddyUse.broke - paddyUse.contact).toBeGreaterThan(6);
        // 同じ能力でも、畦道で使えば弓を 30 秒以上早く崩し（作った時 39.4 秒と 73.5 秒）、榊原隊の兵も多く残る（245 と 183。使わないと 232 と 102）
        expect(leveeUse.broke).toBeLessThan(paddyUse.broke - 30);
        expect(leveeUse.r.left.a_sakakibara!).toBeGreaterThan(paddyUse.r.left.a_sakakibara! + 40);
        for (const p of [leveeNo, leveeUse, paddyNo, paddyUse]) expect(p.r.o.result).toBe('victory');
    });

    // 酒井の両翼の采配（25 秒・半径 100 m の味方が 2 つ以上の向きから挟むと包囲：側背の当たり ×1.8・その敵の損害 ×1.3・士気の低下 ×2）
    // 正面と横：地形に合った作戦で、酒井隊が中の畦道の西から当たった頃（85 秒）に使う（忠勝隊が街道から正面、榊原隊が東から横）
    // 街道だけ：正面突破で、酒井隊が街道の列にいる 40 秒に使う
    it('酒井の両翼の采配：街道（正面）と畦道（横）から挟むと包囲になり、備えが早く崩れる。街道だけで押すと 1 部隊ずつしか当たれず、包囲にならない', () => {
        const fitNo = blockProbe(FIT);
        const fitUse = blockProbe([...FIT, [85, 'a_sakai', 'ability']]);
        const pushNo = blockProbe(PUSH);
        const pushUse = blockProbe([...PUSH, [40, 'a_sakai', 'ability']]);
        for (const p of [fitUse, pushUse]) expect(p.r.refused).toEqual([]);
        // 正面と横（作った時）：包囲 2.3 秒、備えが崩れたのは 92.0 → 87.3 秒。酒井隊の兵の残りは 231 → 258
        expect(fitNo.enc).toBe(0);
        expect(fitUse.enc).toBeGreaterThan(1);
        expect(fitUse.broke).toBeGreaterThan(0);
        expect(fitUse.broke).toBeLessThan(fitNo.broke - 3);
        expect(fitUse.r.left.a_sakai!).toBeGreaterThan(fitNo.r.left.a_sakai! + 15);
        expect(fitUse.r.o.result).toBe('victory');
        // 街道だけ（作った時）：包囲 0 秒、備えは崩れず負ける（損害 42.9％）
        expect(pushUse.enc).toBe(0);
        expect(pushUse.broke).toBe(-1);
        expect(pushNo.broke).toBe(-1);
        expect(pushUse.r.o.result).toBe('defeat');
        expect(Math.abs(pushUse.r.loss - pushNo.r.loss)).toBeLessThan(0.02);
    });
});
