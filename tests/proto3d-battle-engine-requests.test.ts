/**
 * 第2群の戦場の調整役から出たエンジン側の要望（docs/fields-group2-design.md の後の直し）。どれもデータと汎用の仕組みで、戦場の id では分けない。
 * - 道探し（pathfind.ts）：まっすぐ行く区間を、遅い方の速さだけでなく、かかる時間でも A* の道・元の道と比べる
 *   （行き先・出発点が水田の中でも、街道・畦道を回る方がずっと早ければ回る）。
 * - 敵の考え（ai.ts）：追う距離の上限 UnitDef.aiLeash（hold_line は持ち場から・hold_zone は区域の縁から）。
 * - 目標（objectives.ts）：defend_zones（区域 N 個のうち M 個以上を最後まで守り抜く。複数橋の「3 本の橋のうち 2 本以上」）。
 * - 地図の名札（control.ts の mapLabels）：尾根（カプセルの丘）の名札を、部隊の最初の位置から離して置く（谷間の高地の弓の名札と重なっていた）。
 * - 地図を押したとき（control.ts の resolveTap）：敵のすぐ近くの地面を押して攻撃になったら、脇へ動かすやり方を案内に添える（一本橋の担当の気づき）。
 *
 * 既存の戦場（国境の原・第1群の 5 戦場・第2群の 5 戦場）の台本が 1 刻みも変わらないことは、tests/proto3d-battle-v11-identity.test.ts・
 * tests/proto3d-fields-initiative-record.test.ts と各戦場のテストがそのまま通ることで確かめる。
 * 「状態を直接操作」（格子を作って道を直接求める）か「早送り」かは各テストの名前に書く。
 */
import { describe, expect, it } from 'vitest';
import { buildNav, findPath, type NavGrid } from '../proto3d/src/battle/pathfind';
import { createBattle, issueOrder, RULES, runToEnd, stepBattle, unitById, type BattleState } from '../proto3d/src/battle/sim';
import { activeObjectiveZones, objectiveProgress } from '../proto3d/src/battle/objectives';
import { mapLabels, NEAR_ENEMY_NOTE, objectiveStateOf, objectiveZoneCounting, objectiveZoneMarks, resolveTap } from '../proto3d/src/battle/control';
import { buildBattleSetup, getField } from '../proto3d/src/battle/fields';
import type { BattleSetup, Side, UnitDef, UnitKind } from '../proto3d/src/battle/types';

function field(units: UnitDef[], extra: Partial<BattleSetup> = {}): BattleSetup {
    return {
        map: { id: 'test', name: '試験の原', width: 400, depth: 400, terrain: [], exits: { ally: { x: 0, z: 200 }, enemy: { x: 0, z: -200 } } },
        units,
        timeLimitSec: 900,
        briefing: [],
        ...extra,
    };
}
function U(id: string, side: Side, kind: UnitKind, x: number, z: number, extra: Partial<UnitDef> = {}): UnitDef {
    return { id, side, clan: side === 'ally' ? 'tokugawa' : 'rival', kind, name: id, strength: 300, morale: 80, x, z, facing: side === 'ally' ? 0 : Math.PI, ...extra };
}
/** 両軍の本陣（離れた隅に置く。試験の相手にならない） */
const HQS = (): UnitDef[] => [U('a_hq', 'ally', 'honjin', -190, 190), U('e_hq', 'enemy', 'honjin', -190, -190, { aiRole: 'guard_hq' })];
/** sec 秒進める。刻みごとに each を呼ぶ */
function advance(s: BattleState, sec: number, each?: (s: BattleState) => void): void {
    const end = s.tick + Math.round(sec / RULES.tick);
    while (s.tick < end && !s.result) {
        stepBattle(s, RULES.tick);
        each?.(s);
    }
}
const attacking = (s: BattleState, id: string, target: string) => {
    const o = unitById(s, id)!.order;
    return o.type === 'attack' && o.targetId === target;
};

// ---------------------------------------------------------------- 道探し

/**
 * 試験の水田：200 m × 200 m の全体が水田（速さ 0.3）。南北の街道（x -5〜5）と東西の畦道（z -65〜-55）だけ速い（1.2）。
 * 真ん中の東の田に通れない池（x 20〜60, z -20〜20）。
 */
function paddyNav(): NavGrid {
    const road = (x: number, z: number) => Math.abs(x) <= 5 || (z >= -65 && z <= -55);
    const pond = (x: number, z: number) => x >= 20 && x <= 60 && z >= -20 && z <= 20;
    return buildNav(
        200,
        200,
        (x, z) => !pond(x, z),
        (_k: UnitKind, x, z) => (road(x, z) ? 1.2 : 0.3),
    );
}
/** 折れ線の道を 1 m おきにたどった、かかる時間（距離 ÷ 速さ。試験の水田の速さ） */
function travelTime(from: { x: number; z: number }, pts: { x: number; z: number }[]): number {
    const road = (x: number, z: number) => Math.abs(x) <= 5 || (z >= -65 && z <= -55);
    let t = 0;
    let a = from;
    for (const b of pts) {
        const d = Math.hypot(b.x - a.x, b.z - a.z);
        const n = Math.max(1, Math.ceil(d));
        for (let k = 0; k < n; k++) {
            const f = (k + 0.5) / n;
            t += d / n / (road(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f) ? 1.2 : 0.3);
        }
        a = b;
    }
    return t;
}
const onRoad = (p: { x: number; z: number }) => Math.abs(p.x) <= 5 || (p.z >= -65 && p.z <= -55);

describe('道探し：まっすぐ行く区間を、かかる時間でも比べる（状態を直接操作：格子を作って道を求める）', () => {
    it('行き先が田の奥：街道から田をまっすぐ突っ切らず、街道・畦道を回る（直す前は、遅い方の速さ 0.3 で比べてまっすぐ田を渡っていた）', () => {
        const nav = paddyNav();
        const from = { x: 0, z: 90 };
        const goal = { x: 70, z: -50 };
        const path = findPath(nav, 'yari', from.x, from.z, goal.x, goal.z)!;
        expect(path.length).toBeGreaterThan(1);
        // 途中の点に街道・畦道の上の点がある
        expect(path.slice(0, -1).some(onRoad)).toBe(true);
        const straightT = travelTime(from, [goal]);
        const pathT = travelTime(from, path);
        // まっすぐ（田を約 150 m・畦道を少し）は約 494 秒。回る道はその半分より早い
        expect(straightT).toBeGreaterThan(450);
        expect(pathT).toBeLessThan(straightT * 0.5);
    });

    it('出発点が田の中：池を回る道を短くするとき、田をまっすぐ突っ切る区間に縮めない（街道へ出て回る方が早い）', () => {
        const nav = paddyNav();
        const from = { x: 40, z: 30 }; // 池のすぐ南の田
        const goal = { x: 40, z: -75 }; // 池の北・畦道のすぐ北の田
        const path = findPath(nav, 'yari', from.x, from.z, goal.x, goal.z)!;
        expect(path.length).toBeGreaterThan(1);
        const pathT = travelTime(from, path);
        // 池の脇の田を回るだけ（約 130 m・0.3）なら約 430 秒。街道へ出て回る道は、それよりはっきり早い
        const viaPaddy = travelTime(from, [{ x: 65, z: 30 }, { x: 65, z: -60 }, goal]);
        expect(pathT).toBeLessThan(viaPaddy * 0.8);
    });

    it('同じ地形だけの所・速さの差の小さい所は今までどおりまっすぐ（道探しの点は行き先 1 つ）', () => {
        const nav = paddyNav();
        // 街道の上だけ
        expect(findPath(nav, 'yari', 0, 90, 0, -90)).toEqual([{ x: 0, z: -90 }]);
        // 田の中だけ（街道・畦道を通らない）
        expect(findPath(nav, 'yari', -60, 80, -30, 0)).toEqual([{ x: -30, z: 0 }]);
    });
});

// ---------------------------------------------------------------- 敵の考えの追う距離（aiLeash）

describe('敵の考え：追う距離の上限 aiLeash（早送り）', () => {
    it('hold_line：横を通る相手へ、既定（75 m）なら持ち場から 50 m でも打って出る。aiLeash 30 なら 30 m の中に来るまで持ち場で待つ', () => {
        // 持ち場 (0,-60)。味方の槍は持ち場の東 50 m を北へ通り過ぎる（守りへは向かわない）
        const mk = (leash?: number) => {
            const s = createBattle(field([...HQS(), U('a', 'ally', 'yari', 50, 40), U('g', 'enemy', 'yari', 0, -60, { aiRole: 'hold_line', ...(leash !== undefined ? { aiLeash: leash } : {}) })]));
            issueOrder(s, 'a', { type: 'move', x: 50, z: -150 });
            return s;
        };
        const def = mk();
        let out = false;
        advance(def, 40, (st) => (out ||= attacking(st, 'g', 'a')));
        expect(out).toBe(true);
        const short = mk(30);
        let out2 = false;
        let far = 0;
        advance(short, 40, (st) => {
            out2 ||= attacking(st, 'g', 'a');
            const g = unitById(st, 'g')!;
            far = Math.max(far, Math.hypot(g.x, g.z + 60));
        });
        expect(out2).toBe(false);
        expect(far).toBeLessThan(5);
    });

    it('hold_line：aiLeash 30 でも、持ち場の 30 m の中へ来た相手には打って出て、離れたら（30 m より先）持ち場へ戻る', () => {
        const s = createBattle(field([...HQS(), U('a', 'ally', 'yari', 20, 10), U('g', 'enemy', 'yari', 0, -60, { aiRole: 'hold_line', aiLeash: 30 })]));
        // 持ち場の東 20 m を北へ通る
        issueOrder(s, 'a', { type: 'move', x: 20, z: -150 });
        let out = false;
        advance(s, 30, (st) => (out ||= attacking(st, 'g', 'a')));
        expect(out).toBe(true);
    });

    it('hold_line：aiLeash 30 でも、矢を嫌って射手（持ち場から 100 m）へ打って出たときは今までどおり追う（弓の陽動で誘い出せる）', () => {
        const s = createBattle(field([...HQS(), U('b', 'ally', 'yumi', 0, 40), U('g', 'enemy', 'yari', 0, -60, { aiRole: 'hold_line', aiLeash: 30 })]));
        issueOrder(s, 'b', { type: 'attack', targetId: 'g' });
        // 弓は届く所（射程）まで寄って射る。12 秒以上浴びると打って出る
        let out = false;
        let far = 0;
        advance(s, 60, (st) => {
            out ||= attacking(st, 'g', 'b');
            const g = unitById(st, 'g')!;
            far = Math.max(far, Math.hypot(g.x, g.z + 60));
        });
        expect(out).toBe(true);
        expect(far).toBeGreaterThan(40);
    });

    it('hold_zone：区域に入った相手が区域の外へ退くと、既定（縁から 60 m）なら追うのをやめる。aiLeash 160 なら追い続ける（誘い出せる）', () => {
        const mk = (leash?: number) => {
            const s = createBattle(
                field([...HQS(), U('a', 'ally', 'kiba', 0, -30), U('g', 'enemy', 'yari', 0, -60, { aiRole: 'hold_zone', aiTarget: { x: 0, z: -60, r: 30 }, ...(leash !== undefined ? { aiLeash: leash } : {}) })]),
            );
            return s;
        };
        const run = (leash?: number) => {
            const s = mk(leash);
            // 区域の縁に入った騎馬に守りが当たりに来る。来たら騎馬は南へ駆けて離れる
            advance(s, 4);
            expect(attacking(s, 'g', 'a')).toBe(true);
            issueOrder(s, 'a', { type: 'move', x: 0, z: 150 });
            // 守りがいちばん南まで追って来た所（騎馬は 6 m/秒、槍は 3 m/秒）
            let maxZ = -Infinity;
            advance(s, 40, (st) => (maxZ = Math.max(maxZ, unitById(st, 'g')!.z)));
            return maxZ;
        };
        // 既定：騎馬が区域の中心から 90 m（z 30）より先へ出ると、守りは追うのをやめて戻る
        expect(run()).toBeLessThan(-10);
        // aiLeash 160：騎馬が中心から 190 m（z 130）より先へ出るまで追い、区域から 60 m 以上南まで出て来る
        expect(run(160)).toBeGreaterThan(5);
    });
});

// ---------------------------------------------------------------- 目標 defend_zones

describe('目標 defend_zones：区域 N 個のうち M 個以上を最後まで守り抜く（早送り）', () => {
    /** 区域は西・中・東の 3 つ（南の岸の z 40）。主目標は無し（勝ち負けは日没 120 秒＝今までの決まり）。副目標で数える */
    const ZONES = [-120, 0, 120].map((x) => ({ circle: { cx: x, cz: 40, r: 25 } }));
    const mk = (enemies: UnitDef[], minHeld = 2) =>
        createBattle(
            field([...HQS(), ...enemies], {
                timeLimitSec: 120,
                objectives: {
                    secondary: [{ id: 'z', type: 'defend_zones', label: '3 つのうち 2 つ以上を守る', sec: 120, zones: ZONES, minHeld, loseSec: 10, names: ['西の口', '中の口', '東の口'] }],
                },
            }),
        );
    const run = (s: BattleState) => s.objectives!.secondary[0]!;
    /** 区域の中心へ攻め込んで居座る敵（区域を守る hold_zone） */
    const sitter = (id: string, x: number) => U(id, 'enemy', 'yari', x, 40, { aiRole: 'hold_zone', aiTarget: { x, z: 40, r: 10 } });

    it('敵だけが区域に 10 秒続けていると、その区域を失う（取り返しても戻らない）。2 つ目を失うと果たせなくなる', () => {
        const s = mk([sitter('e1', -120)]);
        advance(s, 9.5);
        expect(run(s).zoneLost).toEqual([false, false, false]);
        expect(objectiveZoneCounting(s, 'z#0')).toBe(true);
        expect(objectiveProgress(s)[0]!.progressText).toContain('西の口を敵に奪われている：9／10 秒');
        advance(s, 1);
        expect(run(s).zoneLost).toEqual([true, false, false]);
        expect(run(s).state).toBe('active');
        expect(objectiveStateOf(s, 'z#0')).toBe('failed');
        expect(objectiveStateOf(s, 'z#1')).toBe('active');
        expect(s.events.some((e) => e.text === '副目標「3 つのうち 2 つ以上を守る」：西の口を失った')).toBe(true);
        expect(objectiveProgress(s)[0]!.progressText).toContain('守っている 2／3（2 以上で残り');
        expect(objectiveProgress(s)[0]!.progressText).toContain('西の口 ✕・中の口 ○・東の口 ○');
        // 失った区域は、味方の動きの「目標の区域」から外れる
        expect(activeObjectiveZones(s)).toEqual([ZONES[1], ZONES[2]]);
        // 2 つ目を失う
        const s2 = mk([sitter('e1', -120), sitter('e2', 120)]);
        advance(s2, 11);
        expect(run(s2).zoneLost).toEqual([true, false, true]);
        expect(run(s2).state).toBe('failed');
        expect(activeObjectiveZones(s2)).toEqual([]);
    });

    it('味方も区域にいれば奪われていない（数えない）。最後（sec 秒）まで 2 つ以上を守れば果たし、結果に 1 行で入る。sec より前に日没なら果たしていない', () => {
        const s3 = createBattle(
            field([...HQS(), sitter('e1', -120), U('a1', 'ally', 'yari', -120, 70)], {
                timeLimitSec: 120,
                objectives: { secondary: [{ id: 'z', type: 'defend_zones', label: '守る', sec: 120, zones: ZONES, minHeld: 3 }] },
            }),
        );
        issueOrder(s3, 'a1', { type: 'attack', targetId: 'e1' });
        advance(s3, 30);
        // 味方が区域に入って斬り合う間は数えない（敵だけのときだけ数える）
        expect(run(s3).zoneLost[0]).toBe(false);
        // 西を失っても 2 つ残れば、sec（＝日没の 120 秒）に果たす
        const s = mk([sitter('e1', -120)]);
        const o = runToEnd(s);
        expect(run(s).zoneLost).toEqual([true, false, false]);
        expect(o.objectives!.secondary).toEqual([{ id: 'z', type: 'defend_zones', label: '3 つのうち 2 つ以上を守る', achieved: true }]);
        // sec（150 秒）より前に日没（120 秒・撤退）で終えたら果たしていない（defend_time と同じく、勝って終えたときか sec に届いたときだけ）
        const early = createBattle(
            field([...HQS()], { timeLimitSec: 120, objectives: { secondary: [{ id: 'z', type: 'defend_zones', label: '守る', sec: 150, zones: ZONES, minHeld: 2 }] } }),
        );
        const o2 = runToEnd(early);
        expect(o2.result).toBe('retreat');
        expect(o2.objectives!.secondary[0]!.achieved).toBe(false);
    });

    it('sec 秒に届けば果たす（主目標が 300 秒しのぐ戦場と同じ時刻に done）。地図の印は区域ごと（id は「目標の id#番号」・名前は names）', () => {
        const s = createBattle(
            field([...HQS(), sitter('e1', -120)], {
                timeLimitSec: 200,
                objectives: { secondary: [{ id: 'z', type: 'defend_zones', label: '守る', sec: 60, zones: ZONES, minHeld: 2, names: ['西の口', '中の口', '東の口'] }] },
            }),
        );
        expect(objectiveZoneMarks(s).map((m) => [m.id, m.name])).toEqual([
            ['z#0', '西の口'],
            ['z#1', '中の口'],
            ['z#2', '東の口'],
        ]);
        advance(s, 61);
        expect(run(s).state).toBe('done');
        expect(objectiveStateOf(s, 'z#1')).toBe('done');
        expect(objectiveStateOf(s, 'z#0')).toBe('failed');
    });

    it('minHeld が 1〜区域の数の整数でなければ、合戦を作るときに投げる', () => {
        expect(() => mk([], 4)).toThrow(/minHeld/);
        expect(() => mk([], 0)).toThrow(/minHeld/);
    });
});

// ---------------------------------------------------------------- 地図の名札

describe('地図の名札：尾根（カプセルの丘）の名札は部隊の最初の位置から 45 m 以上離す（状態を直接操作：合戦を作って名札を読む）', () => {
    const ridges = (id: string) => {
        const s = createBattle(buildBattleSetup(getField(id)!, 'standard'));
        return { s, ls: mapLabels(s).filter((l) => l.text === '尾根') };
    };
    it('谷間：高地の弓（±95,-5）・槍（±95,70）から離れた、線分の 1/10 の所の南（±95,-67）へ移す（直す前は (±95,-32.5) で弓の名札と重なった）', () => {
        const { s, ls } = ridges('valley');
        expect(ls.map((l) => [l.x, l.z])).toEqual([
            [-95, -67],
            [95, -67],
        ]);
        for (const l of ls) for (const u of s.setup.units) expect(Math.hypot(u.x - l.x, u.z - l.z)).toBeGreaterThanOrEqual(45);
    });
    it('尾根：今までの所（線分の 4 分の 1 の所から南へ幅の半分＝(-60,-30)）のまま（頂の目標の名札とも離れている）', () => {
        const { ls } = ridges('ridge');
        expect(ls.map((l) => [l.x, l.z])).toEqual([[-60, -30]]);
    });
});

// ---------------------------------------------------------------- 地図を押したとき

describe('地図を押したとき：敵のすぐ近くの地面は攻撃。そのときは脇へ動かすやり方を案内に添える（状態を直接操作：resolveTap を呼ぶ）', () => {
    const ally = { id: 'a_tadakatsu', side: 'ally' as const, commandable: true };
    const enemy = { kind: 'unit' as const, unitId: 'e_yumi', side: 'enemy' as const, x: 30, z: -70 };
    it('敵そのもの：攻撃（案内なし。今までどおり）。すぐ近く：攻撃＋案内。「移動」の後なら、その地点へ移動', () => {
        expect(resolveTap(ally, 'none', enemy)).toEqual({ type: 'order', unitId: 'a_tadakatsu', order: { type: 'attack', targetId: 'e_yumi' } });
        expect(resolveTap(ally, 'none', { ...enemy, near: true })).toEqual({ type: 'order', unitId: 'a_tadakatsu', order: { type: 'attack', targetId: 'e_yumi' }, note: NEAR_ENEMY_NOTE });
        expect(resolveTap(ally, 'move', { ...enemy, near: true })).toEqual({ type: 'order', unitId: 'a_tadakatsu', order: { type: 'move', x: 30, z: -70 } });
        expect(NEAR_ENEMY_NOTE).toContain('「移動」の後で地面を押す');
    });
});
