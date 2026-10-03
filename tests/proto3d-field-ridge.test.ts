/**
 * 戦場「尾根」（ridge）の釣り合い（docs/fields-group2-design.md §4）。
 * 地形に合った作戦（西の登り道から尾根に登り、西の肩を破って尾根の上を横に進み、忠勝隊は急坂を登って下から挟む）は 16 通りで
 * 安定して勝つ。無計画な攻撃（放置・正面の急坂を大勢で登る・弓も一緒に・近い敵へ当て直す・能力だけ使う・崩した後に残りを頂へ送る）は、
 * 地形に合った作戦・準備した正面攻撃と比べて主目標に届かない・損害が大きい・16 通りの勝ちが少ない（比べが合格条件。勝敗は記録として書く）。
 * 準備した正面攻撃（弓で崩し、采配・号令を使い、予備を入れ替えて急坂を登る）は 16 通りの多くで勝つが損害が大きい。その結果も記録して比べる。
 * 副目標（損害 25％以内・東の肩の隊も崩す）は作戦で分かれる（西だけ／西と東の両方から）。
 * 武将の能力の価値が地形で変わる比べ：酒井の両翼の采配（尾根の上と急坂から挟むと包囲・急坂だけでは狭い正面で包囲にならない）と、
 * 榊原の先駆けの号（尾根の上を横から頂の弓へ・急坂を登って口の守りへ）。
 *
 * どれも「早送り」（決まった時刻に issueOrder・useAbility で命令を出す台本を runToEnd で最後まで進める）。
 * 台本は人が画面でできる程度の命令の数・間隔（数十秒おき）にしている。移動の後の向き（face）は画面から指定できないので使わない。
 * 画面では敵の近くの地面を押すとその敵への攻撃になるので、台本の地面の行き先（tap）も、押す点の 20 m 以内に見えている敵がいれば
 * その敵への攻撃にする（例：頂の輪の中心 (0,-60) を押すと、いちばん近い頂の弓への攻撃になる）。
 * 数字（兵の残り・時間）は ridge.ts の釣り合いの目安（作った時の値をコメントに残す）。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, elevationAt, isActive, issueOrder, passableAt, runToEnd, unitById, RULES, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { inZone } from '../proto3d/src/battle/fieldRules';
import { buildBattleSetup, getField, presetUnits, validateField } from '../proto3d/src/battle/fields';
import type { BattleOutcome, Order } from '../proto3d/src/battle/types';

const RG = getField('ridge')!;

/** 地面を押す（押す点の 20 m 以内に見えている敵がいれば、その敵への攻撃。画面と同じ） */
interface Tap {
    tap: [number, number];
}
/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]。'ability' は固有能力、'nearest' は「見えている一番近い敵へ攻撃」（今の相手が戦えるなら出さない） */
type Step = [number, string, Order | Tap | 'ability' | 'nearest'];

const atk = (targetId: string): Order => ({ type: 'attack', targetId });
const tap = (x: number, z: number): Tap => ({ tap: [x, z] });
/** 本陣以外の槍・騎馬 */
const MELEE = ['a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa', 'a_kiba'];
/** 尾根の頂（主目標の輪の中心） */
const SUMMIT = tap(0, -60);

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
    /** 味方の兵の損害の割合（0〜1） */
    loss: number;
    /** 部隊ごとの兵の残り */
    left: Record<string, number>;
    /** 断られた命令 */
    refused: string[];
}

function play(steps: Step[], each?: (s: BattleState) => void): Run {
    const s = createBattle(buildBattleSetup(RG, 'standard'));
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
    return { o, loss, left: Object.fromEntries(o.units.map((u) => [u.id, Math.round(u.endStrength)])), refused };
}

const secondaryOf = (r: Run, id: string) => r.o.objectives!.secondary.find((x) => x.id === id)!.achieved;

/** 命令の時刻を ±15 秒ずらした 16 通り（決まった乱数。tests/proto3d-field-river_ford.test.ts と同じ作り方）の勝ち数と副目標の数 */
function jitterWins(base: Step[]): { wins: number; lossOk: number; eastOk: number } {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let wins = 0;
    let lossOk = 0;
    let eastOk = 0;
    for (let k = 0; k < 16; k++) {
        const steps = base.map(([t, id, o]) => [t === 0 ? 0 : t + Math.round((rnd() - 0.5) * 30), id, o] as Step);
        const r = play(steps);
        if (r.o.result === 'victory') wins++;
        if (secondaryOf(r, 'ridge_losses')) lossOk++;
        if (secondaryOf(r, 'ridge_east')) eastOk++;
    }
    return { wins, lossOk, eastOk };
}

// ---------------------------------------------------------------- 台本

/**
 * 西から横の前半（0〜160 秒）：榊原隊・酒井隊・石川隊・徳川騎馬隊は西の登り道から尾根の西の端へ上がり、60 秒に西の肩の隊へ当たる。
 * 西の肩が押されると北の麓の騎馬（後詰め）が上がって来るので、120 秒に騎馬二隊で迎え、酒井隊・石川隊は尾根の上を頂の西へ進む。
 * 160 秒に酒井隊・石川隊・騎馬隊は頂の守り（西）へ、榊原隊は頂の弓へ、尾根の上を横から当たる。
 */
const WEST: Step[] = [
    [0, 'a_sakakibara', tap(-165, -60)],
    [0, 'a_sakai', tap(-165, -40)],
    [0, 'a_ishikawa', tap(-160, -20)],
    [0, 'a_kiba', tap(-150, 0)],
    [60, 'a_sakakibara', atk('e_shoulder_w')],
    [60, 'a_sakai', atk('e_shoulder_w')],
    [60, 'a_ishikawa', atk('e_shoulder_w')],
    [60, 'a_kiba', tap(-165, -50)],
    [120, 'a_sakai', tap(-60, -60)],
    [120, 'a_ishikawa', tap(-60, -42)],
    [120, 'a_kiba', atk('e_kiba')],
    [120, 'a_sakakibara', atk('e_kiba')],
    [160, 'a_sakai', atk('e_summit_w')],
    [160, 'a_ishikawa', atk('e_summit_w')],
    [160, 'a_sakakibara', atk('e_yumi')],
    [160, 'a_kiba', atk('e_summit_w')],
];
/** 後半（250・290 秒）：残る敵へ当て直し、頂の輪の中へ入る */
const HOLD: Step[] = [
    [250, 'a_sakai', 'nearest'],
    [250, 'a_ishikawa', 'nearest'],
    [250, 'a_kiba', 'nearest'],
    [250, 'a_tadakatsu', 'nearest'],
    [290, 'a_sakai', tap(-10, -62)],
    [290, 'a_ishikawa', tap(10, -62)],
    [290, 'a_tadakatsu', tap(0, -50)],
    [290, 'a_kiba', tap(0, -70)],
];
/** 地形に合った作戦（西から横・下から挟む）：忠勝隊は弓の届かない麓で待ち、130 秒に急坂を登って頂の守り（西）へ下から当たる。命令は 25 回 */
const FIT: Step[] = [...WEST, [130, 'a_tadakatsu', atk('e_summit_w')], ...HOLD];

/**
 * 西と東の両方から：西は酒井隊・石川隊・榊原隊、東は忠勝隊・徳川騎馬隊が東の登り道から上がって東の肩を破り、尾根の上を両側から頂へ。
 * 命令は 27 回
 */
const BOTH: Step[] = [
    [0, 'a_sakakibara', tap(-165, -60)],
    [0, 'a_sakai', tap(-165, -40)],
    [0, 'a_ishikawa', tap(-160, -20)],
    [0, 'a_tadakatsu', tap(165, -40)],
    [0, 'a_kiba', tap(165, -60)],
    [60, 'a_sakakibara', atk('e_shoulder_w')],
    [60, 'a_sakai', atk('e_shoulder_w')],
    [60, 'a_ishikawa', atk('e_shoulder_w')],
    [60, 'a_tadakatsu', atk('e_shoulder_e')],
    [60, 'a_kiba', atk('e_shoulder_e')],
    [120, 'a_sakai', tap(-60, -60)],
    [120, 'a_ishikawa', tap(-60, -42)],
    [120, 'a_sakakibara', atk('e_kiba')],
    [120, 'a_tadakatsu', tap(60, -60)],
    [120, 'a_kiba', tap(60, -75)],
    [160, 'a_sakai', atk('e_summit_w')],
    [160, 'a_ishikawa', atk('e_summit_w')],
    [160, 'a_sakakibara', atk('e_yumi')],
    [160, 'a_tadakatsu', atk('e_summit_e')],
    [160, 'a_kiba', atk('e_yumi')],
    [250, 'a_sakai', 'nearest'],
    [250, 'a_ishikawa', 'nearest'],
    [250, 'a_kiba', 'nearest'],
    [250, 'a_tadakatsu', 'nearest'],
    [290, 'a_sakai', tap(-10, -62)],
    [290, 'a_ishikawa', tap(10, -62)],
    [290, 'a_tadakatsu', tap(0, -50)],
];

/** 正面突破：槍・騎馬の五隊で頂へ（画面で頂の輪の中心を押す＝頂の弓への攻撃）。弓は頂の弓を射る */
const PUSH: Step[] = [...MELEE.map((id) => [0, id, SUMMIT] as Step), [0, 'a_yumi', atk('e_yumi')]];

/**
 * 準備した正面攻撃（急坂を登る）：弓を急坂の下 (0,25) へ出して頂の守り（西）を射る（20 秒）。家康本陣も (0,60) へ上げて号令の届く所に置く。
 * 60 秒に忠勝隊・酒井隊で急坂を登って頂の守り（西）へ当たり、70 秒に酒井隊の両翼の采配、90 秒に家康の号令。120 秒に予備の石川隊が
 * 同じ守りへ、騎馬隊が頂の守り（東）へ続く（一隊ずつしか当たれない急坂へ、後から入れ替えて入れる）。180 秒に榊原隊は頂の弓へ、忠勝隊は
 * 近い敵へ、220 秒に残りも近い敵へ当て直し、260 秒に頂の輪へ入る。命令は 17 回（0・20・60・70・90・120・180・220・260 秒）。回り込まない
 */
const PREPARED: Step[] = [
    [0, 'a_yumi', tap(0, 25)],
    [0, 'a_ieyasu', tap(0, 60)],
    [20, 'a_yumi', atk('e_summit_w')],
    [60, 'a_tadakatsu', atk('e_summit_w')],
    [60, 'a_sakai', atk('e_summit_w')],
    [70, 'a_sakai', 'ability'],
    [90, 'a_ieyasu', 'ability'],
    [120, 'a_ishikawa', atk('e_summit_w')],
    [120, 'a_kiba', atk('e_summit_e')],
    [180, 'a_sakakibara', atk('e_yumi')],
    [180, 'a_tadakatsu', 'nearest'],
    [220, 'a_sakai', 'nearest'],
    [220, 'a_ishikawa', 'nearest'],
    [220, 'a_kiba', 'nearest'],
    [260, 'a_sakai', tap(-10, -62)],
    [260, 'a_ishikawa', tap(10, -62)],
    [260, 'a_tadakatsu', tap(0, -50)],
];

/** 比べの基準（同じ台本は 1 回だけ進める） */
const memo = new Map<Step[], Run>();
const run = (steps: Step[]): Run => {
    if (!memo.has(steps)) memo.set(steps, play(steps));
    return memo.get(steps)!;
};
const memo16 = new Map<Step[], ReturnType<typeof jitterWins>>();
const jitterOnce = (steps: Step[]) => {
    if (!memo16.has(steps)) memo16.set(steps, jitterWins(steps));
    return memo16.get(steps)!;
};

describe('尾根のデータ', () => {
    it('検査を通る。味方 7／敵 7（敵はすべて敵勢）。カプセルの丘 1 つ・崖 4 つ・両端の登り道・狭い正面（1 部隊）。主目標は頂の確保（敵本陣の撃破ではない）', () => {
        expect(validateField(RG)).toEqual([]);
        const us = presetUnits(RG, 'standard');
        expect(us.filter((u) => u.side === 'ally').map((u) => u.id)).toEqual(['a_ieyasu', 'a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa', 'a_yumi', 'a_kiba']);
        expect(us.filter((u) => u.side === 'enemy')).toHaveLength(7);
        expect(us.filter((u) => u.side === 'enemy').every((u) => u.clan === 'rival')).toBe(true);
        expect(RG.terrain.filter((t) => t.kind === 'hill')).toEqual([{ kind: 'hill', capsule: { ax: -120, az: -60, bx: 120, bz: -60, r: 60 }, height: 16 }]);
        expect(RG.terrain.filter((t) => t.kind === 'cliff')).toHaveLength(4);
        expect(RG.terrain.filter((t) => t.kind === 'road')).toHaveLength(2);
        expect(RG.terrainRules).toEqual({ hill: { speed: 0.6 } });
        expect(RG.highGround).toEqual({ defenseVsLower: 0.6, minDiff: 2, rangeBonus: 25, sightBonus: 40, arrowDealVsLower: 1.6 });
        expect(RG.specialRules).toEqual([{ type: 'narrow_frontage', zone: { rect: { x0: -16, x1: 16, z0: -46, z1: 4 } }, maxEngaged: 1 }]);
        expect(RG.objectives.primary).toMatchObject({ id: 'ridge_summit', type: 'hold_point', sec: 90 });
        expect(RG.objectives.secondary.map((o) => [o.id, o.type])).toEqual([
            ['ridge_losses', 'limit_losses'],
            ['ridge_east', 'break_unit'],
        ]);
        // 主目標・副目標は結果に別々に入る
        const s = createBattle(buildBattleSetup(RG, 'standard'));
        expect(s.objectives!.primary!.def.id).toBe('ridge_summit');
        expect(s.objectives!.secondary.map((r) => r.def.id)).toEqual(['ridge_losses', 'ridge_east']);
    });

    it('地形の形：正面の急坂は両側を崖に挟まれた細い坂道（幅 32 m）で、崖の切れ目のほかは南から登れない。両端の登り道から尾根の上へ上がれる', () => {
        const s = createBattle(buildBattleSetup(RG, 'standard'));
        // 急坂の中は通れて、すぐ外の両側は崖
        for (const z of [-40, -30, -16]) {
            expect(passableAt(s, 0, z)).toBe(true);
            expect(passableAt(s, -20, z)).toBe(false);
            expect(passableAt(s, 20, z)).toBe(false);
        }
        // 南の面の崖（x ±16〜150）
        for (const x of [-120, -60, 60, 120]) expect(passableAt(s, x, -16)).toBe(false);
        // 高さ：急坂の下の口 (0,-8) より上の口 (0,-46) が 8 m 以上高い。頂の守りの持ち場は上の口のさらに上
        expect(elevationAt(s.map, 0, -46) - elevationAt(s.map, 0, -8)).toBeGreaterThan(8);
        const g = RG.deployments.enemy.find((d) => d.id === 'summit_w')!;
        expect(elevationAt(s.map, g.x, g.z)).toBeGreaterThan(elevationAt(s.map, 0, -46));
        // 西の登り道の上（尾根の西の端）は 5 m より高い
        expect(elevationAt(s.map, -165, -60)).toBeGreaterThan(5);
    });

    it('敵の考え：頂の守りは急坂の上の口（hold_zone・口から 25 m）、弓は頂（主目標の輪の中）、肩は持ち場、騎馬は後詰め。守りの持ち場は狭い正面の区域の外', () => {
        const us = presetUnits(RG, 'standard').filter((u) => u.side === 'enemy');
        expect(Object.fromEntries(us.map((u) => [u.id, u.aiRole]))).toEqual({
            e_hq: 'guard_hq',
            e_summit_w: 'hold_zone',
            e_summit_e: 'hold_zone',
            e_yumi: 'hold_line',
            e_shoulder_w: 'hold_zone',
            e_shoulder_e: 'hold_zone',
            e_kiba: 'reserve',
        });
        const guard = us.find((u) => u.id === 'e_summit_w')!.aiTarget!;
        expect(guard).toEqual({ x: 0, z: -56, r: 15 });
        const gr = guard.r!;
        const p = RG.objectives.primary;
        if (p.type !== 'hold_point') throw new Error('hold_point のはず');
        const rule = RG.specialRules![0]!;
        if (rule.type !== 'narrow_frontage') throw new Error('narrow_frontage のはず');
        for (const id of ['summit_w', 'summit_e']) {
            const d = RG.deployments.enemy.find((x) => x.id === id)!;
            // 守りの持ち場は区域（hold_zone）の中・狭い正面の外・頂の輪の中
            expect(Math.hypot(d.x - guard.x, d.z - guard.z)).toBeLessThanOrEqual(gr);
            expect(inZone(rule.zone, d.x, d.z)).toBe(false);
            expect(inZone(p.zone, d.x, d.z)).toBe(true);
        }
        const y = RG.deployments.enemy.find((x) => x.id === 'archers')!;
        expect(inZone(p.zone, y.x, y.z)).toBe(true);
        // 守りは急坂の下（z -8）までは降りない：当たる距離（区域 + 10 m）は急坂の中ほどまで
        expect(Math.hypot(0 - guard.x, -8 - guard.z)).toBeGreaterThan(gr + 10);
        // 味方の部隊は最初、頂の弓（高所から射程 +25 m）の届く所にいない
        for (const a of RG.deployments.ally) expect(Math.hypot(a.x - y.x, a.z - y.z)).toBeGreaterThan(RULES.bowRange + RG.highGround!.rangeBonus!);
    });
});

// 合格条件は「正面なら負ける」ではなく、同じ台本・同じ数字での比べ（地形に合った作戦・準備した正面攻撃と比べて、主目標に届かない・
// 損害が大きい・16 通りの勝ちが少ない）。無計画な攻撃の勝敗は「記録」として残す（台本と数字は前のまま。変わったら理由と前後の数字を書いて直す）
describe('尾根：無計画な攻撃・地形に合わない作戦と、地形に合った作戦の比べ（早送り）', () => {
    it('何もしない → 地形に合った作戦（勝ち）と違い、主目標に届かない（記録：頂を取れず日没）', () => {
        const r = run([]);
        expect(run(FIT).o.objectives!.primary!.achieved).toBe(true);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).toBe('retreat');
        expect(r.o.reason).toBe('nightfall');
    }, 60_000);

    it('正面突破：五隊で頂へ（無計画。弓は頂の弓を射る）→ 地形に合った作戦より損害が大きく、主目標に届かない（記録：急坂の上の口で一隊ずつ迎えられ、日没。作った時 43.8％。五隊とも敗走）', () => {
        const r = run(PUSH);
        // 確かめた時：日没・損害 43.8％ ／ 地形に合った作戦 364.1 秒に勝ち・20.0％
        expect(r.loss).toBeGreaterThan(run(FIT).loss + 0.15);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).not.toBe('victory');
        expect(r.loss).toBeGreaterThan(0.4);
        for (const id of MELEE) expect(r.o.units.find((u) => u.id === id)!.status).not.toBe('ready');
    });

    it('五隊だけで頂へ（無計画。弓は動かさない）→ 地形に合った作戦より損害が大きく、主目標に届かない。60 秒ごとに頂へ押し直しても同じ（記録：頂の守り・弓を崩せず日没。作った時 損害 46.9％、頂の弓は無傷）', () => {
        const r = run(MELEE.map((id) => [0, id, SUMMIT] as Step));
        expect(r.loss).toBeGreaterThan(run(FIT).loss + 0.15);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).not.toBe('victory');
        expect(r.loss).toBeGreaterThan(0.4);
        expect(r.left.e_yumi).toBe(300);
        const re = [60, 120, 180, 240, 300].flatMap((t) => MELEE.map((id) => [t, id, SUMMIT] as Step));
        const r2 = run([...MELEE.map((id) => [0, id, SUMMIT] as Step), ...re]);
        expect(r2.loss).toBeGreaterThan(run(FIT).loss + 0.15);
        expect(r2.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r2.o.result).not.toBe('victory');
        expect(r2.loss).toBeGreaterThan(0.4);
    }, 60_000);

    it('弓も一緒に全部隊で頂の守り（西）へ（無計画）→ 弓で崩してから入れ替えて登る準備した正面攻撃より損害が大きく、主目標に届かない。30 秒ごとに近い敵へ当て直しても同じ（記録：負ける。作った時 414 秒・損害 67％）', () => {
        const all: Step[] = [...MELEE, 'a_yumi'].map((id) => [0, id, atk('e_summit_w')] as Step);
        const r = run(all);
        // 確かめた時：414.1 秒に負け・損害 66.6％ ／ 準備した正面攻撃 389.8 秒に勝ち・29.4％
        expect(r.loss).toBeGreaterThan(run(PREPARED).loss + 0.2);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).toBe('defeat');
        const again = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300].flatMap((t) => MELEE.map((id) => [t, id, 'nearest'] as Step));
        const r2 = run([...PUSH, ...again]);
        // 確かめた時：日没・損害 43.8％
        expect(r2.loss).toBeGreaterThan(run(PREPARED).loss + 0.1);
        expect(r2.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r2.o.result).not.toBe('victory');
        expect(r2.loss).toBeGreaterThan(0.4);
    }, 60_000);

    it('正面突破で能力も使う（榊原の先駆け・酒井の両翼・家康の号令。弓で崩さず五隊同時）→ 準備した正面攻撃より損害が大きく、主目標に届かない（記録：日没。作った時 損害 41.7％）', () => {
        const r = run([...PUSH, [25, 'a_sakakibara', 'ability'], [60, 'a_ieyasu', 'ability'], [100, 'a_sakai', 'ability']]);
        expect(r.refused).toEqual([]);
        expect(r.loss).toBeGreaterThan(run(PREPARED).loss + 0.1);
        expect(r.o.objectives!.primary!.achieved).toBe(false);
        // 記録
        expect(r.o.result).not.toBe('victory');
        expect(r.loss).toBeGreaterThan(0.4);
    });

    it('正面突破で頂の守り・弓を崩した後に、残る隊（弓・家康本陣も）を頂へ送る（無計画）→ 準備した正面攻撃・地形に合った作戦より 16 通りの勝ちが少ない（記録：16 通りで 0 勝。作った時 250 秒に送ると家康本陣が崩れて負け）', () => {
        const base: Step[] = [...MELEE, 'a_yumi'].map((id) => [0, id, SUMMIT] as Step);
        const follow: Step[] = [...base, [250, 'a_yumi', SUMMIT], [250, 'a_ieyasu', tap(0, -55)]];
        const r = run(follow);
        const w = jitterOnce(follow).wins;
        // 確かめた時：無計画 0 勝 ／ 準備した正面攻撃 13 勝 ／ 地形に合った作戦 16 勝
        expect(w + 10).toBeLessThanOrEqual(jitterOnce(PREPARED).wins);
        expect(w + 10).toBeLessThanOrEqual(jitterOnce(FIT).wins);
        // 記録（確かめた時：388.1 秒に家康本陣が崩れて負け・損害 57.1％）
        expect(r.o.result).not.toBe('victory');
        expect(w).toBe(0);
    }, 90_000);
});

describe('尾根：地形に合った作戦（早送り）', () => {
    it('西から横・下から挟む：西の登り道から尾根に登り、西の肩を破って尾根の上を横に進み、忠勝隊は急坂から下から当たる → 勝つ（作った時 364 秒・損害 20.0％）', () => {
        let crestContact = false;
        let tadaFromBelow = false;
        const r = play(FIT, (s) => {
            // 酒井隊は頂の守り（西）と、尾根の上（高さ 14 m 以上）の西側から斬り合った
            const k = unitById(s, 'a_sakai')!;
            if (k.engagedWith === 'e_summit_w' && k.x < -20 && elevationAt(s.map, k.x, k.z) > 14) crestContact = true;
            // 忠勝隊は急坂（狭い正面の区域）の中から、同じ守りと斬り合った
            const t = unitById(s, 'a_tadakatsu')!;
            if (t.engagedWith === 'e_summit_w' && Math.abs(t.x) < 16 && t.z > -46) tadaFromBelow = true;
        });
        expect(r.refused).toEqual([]);
        expect(r.o.result).toBe('victory');
        expect(r.o.reason).toBe('objective_done');
        expect(r.o.objectives!.primary!.achieved).toBe(true);
        expect(r.loss).toBeLessThan(0.25);
        expect(crestContact).toBe(true);
        expect(tadaFromBelow).toBe(true);
        // 正面突破（損害 4 割超・負けか日没）と比べて、損害は半分ほど
        expect(r.loss).toBeLessThan(play(PUSH).loss - 0.15);
    });

    // 確かめた時（乱数の種 7）：西から横 16 勝（損害 25％以内 15・東の肩 0・損害の平均 19.6％）、
    // 西と東の両方から 13 勝（損害 25％以内 1・東の肩 16・損害の平均 35.0％）、正面突破 0 勝（16 通りとも日没）。
    // 参考に種 3・11 でも数えた：西から横 15 勝・16 勝、西と東の両方から 12 勝・14 勝
    it('命令の時刻を ±15 秒ずらした 16 通り：西から横は 14 通り以上で勝ち、正面突破（五隊で頂へ）より勝ちが多い（確かめた時 16 勝・0 勝）', () => {
        expect(jitterOnce(FIT).wins).toBeGreaterThanOrEqual(14);
        expect(jitterOnce(FIT).wins).toBeGreaterThan(jitterOnce(PUSH).wins + 10);
        // 記録：正面突破はずらしても勝たない
        expect(jitterOnce(PUSH).wins).toBe(0);
    }, 60_000);
});

describe('尾根：副目標は作戦で分かれる（早送り）', () => {
    it('西から横だけ → 損害 25％以内 ✓・東の肩 ✗。西と東の両方から → 東の肩 ✓・損害 25％以内 ✗（作った時 392 秒・損害 28.7％。騎馬隊は崩れる）。勝ち負け・主目標・副目標は別の欄', () => {
        const fit = play(FIT);
        const both = play(BOTH);
        expect(both.refused).toEqual([]);
        expect(fit.o.result).toBe('victory');
        expect(both.o.result).toBe('victory');
        expect(fit.o.objectives!.primary!.achieved).toBe(true);
        expect(both.o.objectives!.primary!.achieved).toBe(true);
        expect([secondaryOf(fit, 'ridge_losses'), secondaryOf(fit, 'ridge_east')]).toEqual([true, false]);
        expect([secondaryOf(both, 'ridge_losses'), secondaryOf(both, 'ridge_east')]).toEqual([false, true]);
        expect(both.loss).toBeGreaterThan(fit.loss);
    }, 60_000);

    it('±15 秒の 16 通り：西から横は東の肩を崩さず、損害 25％以内が多い。西と東の両方からは東の肩を必ず崩し、損害 25％以内は少ない（確かめた時 15・0 と 1・16）', () => {
        const fit = jitterWins(FIT);
        const both = jitterWins(BOTH);
        expect(fit.eastOk).toBe(0);
        expect(both.eastOk).toBeGreaterThanOrEqual(14);
        expect(both.wins).toBeGreaterThanOrEqual(12);
        expect(fit.lossOk).toBeGreaterThanOrEqual(10);
        expect(both.lossOk).toBeLessThanOrEqual(7);
    }, 60_000);
});

/** 頂の守り（西）を見る：酒井隊が斬り合い始めた時刻・包囲されていた秒数・崩れた時刻 */
function guardProbe(steps: Step[]) {
    let contact = -1;
    let enc = 0;
    let broke = -1;
    const r = play(steps, (s) => {
        const w = unitById(s, 'e_summit_w')!;
        if (contact < 0 && unitById(s, 'a_sakai')!.engagedWith === 'e_summit_w') contact = s.t;
        if (s.encircled.includes('e_summit_w')) enc += RULES.tick;
        if (broke < 0 && w.status !== 'ready') broke = s.t;
    });
    return { r, contact, enc, broke };
}

/** 榊原隊を見る：t0 から 20 秒（先駆けの号の効果の長さ）の、敵の兵の減り（全部隊）・榊原隊の兵の減り、40 秒後の士気、頂の弓・榊原隊の崩れた時刻 */
function vanguardProbe(steps: Step[], t0: number) {
    const at: Record<string, { foes: number; saka: number; morale: number }> = {};
    let yumiBroke = -1;
    let sakaBroke = -1;
    const r = play(steps, (s) => {
        const k = unitById(s, 'a_sakakibara')!;
        if (yumiBroke < 0 && unitById(s, 'e_yumi')!.status !== 'ready') yumiBroke = s.t;
        if (sakaBroke < 0 && k.status !== 'ready') sakaBroke = s.t;
        for (const [key, dt] of [['a', 0], ['b', 20], ['d', 40]] as const) {
            if (!at[key] && s.t >= t0 + dt - 1e-9) at[key] = { foes: s.units.filter((u) => u.side === 'enemy').reduce((a, u) => a + u.strength, 0), saka: k.strength, morale: k.morale };
        }
    });
    return { r, foeLost: at.a!.foes - at.b!.foes, sakaLost: at.a!.saka - at.b!.saka, morale40: at.d!.morale, yumiBroke, sakaBroke };
}

describe('尾根：武将の能力の価値が地形で変わる（早送り）', () => {
    // 酒井の両翼の采配（25 秒・半径 100 m の味方が 2 つ以上の向きから挟むと包囲：側背の当たり ×1.8・その敵の損害 ×1.3・士気の低下 ×2）
    // 尾根の上：西から横の作戦で、酒井隊が尾根の上の西から、忠勝隊が急坂から、同じ頂の守り（西）へ当たる。酒井隊が当たった頃（172 秒）に使う
    // 急坂だけ：酒井隊・石川隊・忠勝隊が急坂を登って頂の守り（西）へ当たる。酒井隊が当たった頃（100 秒）に使う
    it('酒井の両翼の采配：尾根の上と急坂から挟むと包囲になり、頂の守りが早く崩れる。急坂だけから当たると狭い正面で挟めず、包囲にならず守りも崩れない', () => {
        const crestNo = guardProbe(FIT);
        const crestUse = guardProbe([...FIT, [172, 'a_sakai', 'ability']]);
        const FRONT: Step[] = ['a_sakai', 'a_ishikawa', 'a_tadakatsu'].map((id) => [0, id, atk('e_summit_w')] as Step);
        const frontNo = guardProbe(FRONT);
        const frontUse = guardProbe([...FRONT, [100, 'a_sakai', 'ability']]);
        for (const p of [crestUse, frontUse]) expect(p.r.refused).toEqual([]);
        // 尾根の上（作った時）：酒井隊が 174〜175 秒に当たり、使わない時は 16.4 秒後、使うと 1.3 秒後に崩れる（先に急坂から当たっていた
        // 忠勝隊と酒井隊で挟み、包囲 2.0 秒）
        expect(crestNo.enc).toBe(0);
        expect(crestUse.enc).toBeGreaterThan(1);
        expect(crestUse.broke - crestUse.contact).toBeLessThan(crestNo.broke - crestNo.contact - 8);
        expect(crestUse.r.o.result).toBe('victory');
        // 急坂だけ（作った時）：酒井隊が 103〜105 秒に当たっても、包囲は 0 秒。守りは最後まで崩れず、日没（損害 34％）
        expect(frontUse.contact).toBeGreaterThan(0);
        expect(frontUse.contact).toBeLessThan(130);
        expect(frontUse.enc).toBe(0);
        expect(frontUse.broke).toBe(-1);
        expect(frontNo.broke).toBe(-1);
        expect(frontUse.r.o.result).not.toBe('victory');
        // 急坂だけでは、使っても最後の兵の残りはほとんど同じ（作った時 酒井隊 138 → 139・頂の守り（西）242 → 243）
        expect(Math.abs(frontUse.r.left.a_sakai! - frontNo.r.left.a_sakai!)).toBeLessThan(10);
        expect(Math.abs(frontUse.r.left.e_summit_w! - frontNo.r.left.e_summit_w!)).toBeLessThan(10);
    }, 60_000);

    // 西から横の台本の後の当て直し（250 秒）は、使わない時の守りの崩れる早さに合わせている。使うと守りが早く崩れ、ずらさない台本では
    // 次の命令までの間に頂の弓に射られて、全体の損害は 20.0 → 25.7％に増える（人なら崩れたらすぐ次へ当てる）。
    // ±15 秒の 16 通り（使う時刻もずらす）では、損害 25％以内は 13 → 13 と変わらなかった（台本の当て直しが遅いため。局所の差だけを確かめる）

    // 榊原の先駆けの号（20 秒・動き ×1.8・最初の 8 秒の当たり ×2.0・弓へ ×1.5・側背 ×1.3・受ける損害 ×1.2・切れて士気 −15）
    // 尾根の上：西から横の作戦で、160 秒に頂の弓へ当たる命令と同時に使う（尾根の上を横から弓へ）
    // 急坂：榊原隊だけで頂の弓へ（急坂を登り、上の口の頂の守りに阻まれる）。急坂の中ほどに来た 25 秒に使う
    it('榊原の先駆けの号：尾根の上を横から頂の弓へ使う → 弓が早く崩れ、榊原隊は崩れない。急坂で使う → 口の守りをほとんど削れず、榊原隊が早く崩れる', () => {
        const crestNo = vanguardProbe(FIT, 160);
        const crestUse = vanguardProbe([...FIT, [160, 'a_sakakibara', 'ability']], 160);
        const SLOPE: Step[] = [[0, 'a_sakakibara', atk('e_yumi')]];
        const slopeNo = vanguardProbe(SLOPE, 25);
        const slopeUse = vanguardProbe([...SLOPE, [25, 'a_sakakibara', 'ability']], 25);
        for (const p of [crestUse, slopeUse]) expect(p.r.refused).toEqual([]);
        // 尾根の上（作った時）：20 秒で敵の兵 41 → 141 を削り、頂の弓が崩れたのは 222.1 → 192.7 秒。榊原隊の減りは 0 → 12 で崩れない。
        // 全体の損害も 20.0 → 17.8％
        expect(crestUse.foeLost).toBeGreaterThan(crestNo.foeLost + 60);
        expect(crestUse.yumiBroke).toBeGreaterThan(0);
        expect(crestUse.yumiBroke).toBeLessThan(crestNo.yumiBroke - 20);
        expect(crestUse.sakaLost).toBeLessThan(40);
        expect(crestUse.sakaBroke).toBe(-1);
        expect(crestUse.r.o.result).toBe('victory');
        expect(crestUse.r.loss).toBeLessThan(crestNo.r.loss);
        // 急坂（作った時）：20 秒で口の守りの兵 12 → 25 しか削れず、榊原隊は 106 → 148 を失い、56.5 → 45.0 秒に崩れる
        expect(slopeUse.foeLost).toBeLessThan(40);
        expect(slopeUse.sakaLost).toBeGreaterThan(slopeNo.sakaLost + 20);
        expect(slopeUse.sakaBroke).toBeGreaterThan(0);
        expect(slopeUse.sakaBroke).toBeLessThan(slopeNo.sakaBroke);
        // 同じ能力で、削った敵の兵 ÷ 失った自分の兵：尾根の上は 1 を大きく超え、急坂は 1 を大きく下回る
        expect(crestUse.foeLost / crestUse.sakaLost).toBeGreaterThan(4);
        expect(slopeUse.foeLost / slopeUse.sakaLost).toBeLessThan(0.3);
    }, 60_000);
});

// 尾根の準備した正面攻撃は、急坂の上の口で一隊ずつしか当たれない地形でも、弓で崩し・号令と采配で支え・予備を入れ替えて登れば、
// 16 通りの多くで頂に届く。ただし損害は大きく（平均 5 割ほど）、損害 25％以内の副目標は 16 通りとも果たせない。西から横の作戦は損害 2 割ほど
describe('尾根：準備した正面攻撃（早送り）', () => {
    it('弓で頂の守りを射てから二隊で急坂を登り、采配・号令を使い、予備を入れ替えて入れる（記録：389.8 秒に勝ち・損害 29.4％・副目標はどちらも未達成。忠勝隊は 260 秒までに敗走）', () => {
        const r = run(PREPARED);
        expect(r.refused).toEqual(['260:a_tadakatsu']);
        expect(Object.keys(r.o.abilitiesUsed ?? {}).sort()).toEqual(['a_ieyasu', 'a_sakai']);
        // 記録
        expect(r.o.result).toBe('victory');
        expect(r.o.objectives!.primary!.achieved).toBe(true);
        expect(secondaryOf(r, 'ridge_losses')).toBe(false);
        expect(secondaryOf(r, 'ridge_east')).toBe(false);
    });

    it('16 通りで、正面突破（五隊で頂へ）より勝ちがずっと多い。準備を抜くと勝てない（能力なし 4 勝・弓なし 0 勝）。西から横の作戦より勝ちが少なく、損害の副目標は一度も果たせない（記録：準備 13 勝・損害 25％以内 0 ／ 正面突破 0 勝 ／ 西から横 16 勝・15）', () => {
        const prep = jitterOnce(PREPARED);
        const push = jitterOnce(PUSH);
        const fit = jitterOnce(FIT);
        expect(prep.wins).toBeGreaterThanOrEqual(11);
        expect(prep.wins).toBeGreaterThan(push.wins + 8);
        expect(prep.lossOk).toBe(0);
        expect(fit.wins).toBeGreaterThanOrEqual(prep.wins);
        expect(fit.lossOk).toBeGreaterThan(prep.lossOk + 8);
        // 準備の値打ち：能力を抜くと勝ちが大きく減り、弓を抜くと勝てない
        expect(jitterOnce(PREPARED.filter(([, , o]) => o !== 'ability')).wins).toBeLessThanOrEqual(prep.wins - 6);
        expect(jitterOnce(PREPARED.filter(([, id]) => id !== 'a_yumi')).wins).toBeLessThanOrEqual(2);
    }, 120_000);
});
