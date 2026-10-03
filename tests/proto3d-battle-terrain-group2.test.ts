/**
 * 第2群の地形の仕組み（docs/fields-group2-design.md §3）：橋（bridge）・細長い丘（カプセルの丘＝尾根）・水田（paddy）・
 * 高所から低所へ射る矢の倍率（highGround.arrowDealVsLower）・道探しの回り道で止まらない動き・検査（橋が川を渡る・尾根の頂へ登れる）、
 * と第2群の 5 戦場の最初の案（データの形・動いて決着がつく・地形に合った作戦の台本が勝つこと）。
 *
 * 確認の種類はテストの名前に書く：
 * - 「状態を直接操作」：部隊の位置を書き換えて、速さ・損害の式を比べる。
 * - 「早送り」：stepBattle・runToEnd で一気に進める（決まった時刻に命令を出す台本）。
 * 既存の戦場（国境の原・第1群の 5 戦場）が 1 刻みも変わらないことは、tests/proto3d-battle-v11-identity.test.ts と
 * tests/proto3d-fields-initiative-record.test.ts（能力なしの台本の結果を数字で記録）・各戦場のテストで確かめる。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, elevationAt, issueOrder, meleeDamage, passableAt, rangedDamage, runToEnd, stepBattle, unitById, unitSpeedFactor, isActive, RULES, type BattleState } from '../proto3d/src/battle/sim';
import { HIGH_GROUND_DEFAULTS, TERRAIN_DEFAULTS, TERRAIN_PRIORITY, capsuleDist, inZone } from '../proto3d/src/battle/fieldRules';
import { useAbility } from '../proto3d/src/battle/abilities';
import { fieldRuleTexts, mapLabels } from '../proto3d/src/battle/control';
import { buildBattleSetup, getField, presetUnits, validateField, type BattlefieldDef } from '../proto3d/src/battle/fields';
import type { BattleOutcome, BattleSetup, FieldRules, Order, Side, TerrainArea, UnitDef, UnitKind } from '../proto3d/src/battle/types';

function field(terrain: TerrainArea[], units: UnitDef[], extra: Partial<BattleSetup> = {}): BattleSetup {
    return {
        map: { id: 'test', name: '試験の原', width: 300, depth: 300, terrain, exits: { ally: { x: 0, z: 150 }, enemy: { x: 0, z: -150 } } },
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
const HQS = (): UnitDef[] => [U('a_hq', 'ally', 'honjin', -140, 140), U('e_hq', 'enemy', 'honjin', -140, -140, { aiRole: 'guard_hq' })];
function runUntilIdle(s: BattleState, id: string, max: number, each?: (s: BattleState) => void): void {
    while (s.t < max && !s.result) {
        stepBattle(s, RULES.tick);
        each?.(s);
        const u = unitById(s, id)!;
        if (u.order.type === 'hold' && !u.moving) break;
    }
}
const clone = (f: BattlefieldDef): BattlefieldDef => structuredClone(f);

/** 東西の深い川と、真ん中の橋（x -8〜8） */
const BRIDGE_MAP: TerrainArea[] = [
    { kind: 'river', rect: { x0: -150, x1: 150, z0: -12, z1: 12 } },
    { kind: 'bridge', rect: { x0: -8, x1: 8, z0: -16, z1: 16 } },
];

describe('橋（bridge）', () => {
    it('状態を直接操作：橋の上は通れて、動きは道と同じ ×1.2。橋の外の川は通れない。既定の決まりは道と同じ速さで、ほかの倍率は 1', () => {
        expect(TERRAIN_DEFAULTS.bridge).toMatchObject({ speed: TERRAIN_DEFAULTS.road.speed, dealMul: 1, takeMul: 1, arrowTakeMul: 1, hideSight: null });
        const s = createBattle(field(BRIDGE_MAP, [...HQS(), U('a', 'ally', 'yari', 0, 0)]));
        expect(s.field.nav).not.toBeNull();
        expect(passableAt(s, 0, 0)).toBe(true);
        expect(passableAt(s, 30, 0)).toBe(false);
        expect(passableAt(s, -30, 0)).toBe(false);
        expect(unitSpeedFactor(s, unitById(s, 'a')!)).toBeCloseTo(1.2, 10);
    });

    it('早送り：川の向こうへの移動は橋を通る（川の帯を通るのは橋の幅の中だけ）。行き先に着く', () => {
        const s = createBattle(field(BRIDGE_MAP, [...HQS(), U('a', 'ally', 'yari', 80, 60)]));
        expect(issueOrder(s, 'a', { type: 'move', x: 80, z: -60 })).toBe(true);
        const crossed: number[] = [];
        runUntilIdle(s, 'a', 400, (st) => {
            const a = unitById(st, 'a')!;
            expect(passableAt(st, a.x, a.z)).toBe(true);
            // 川の帯の内側（岸の格子を除く）
            if (Math.abs(a.z) < 9.5) crossed.push(a.x);
        });
        const a = unitById(s, 'a')!;
        expect(Math.hypot(a.x - 80, a.z + 60)).toBeLessThan(1.5);
        expect(crossed.length).toBeGreaterThan(0);
        // 橋の幅（±8 m）と、道探しの格子（5 m）の分のゆとり
        expect(Math.min(...crossed)).toBeGreaterThanOrEqual(-10.5);
        expect(Math.max(...crossed)).toBeLessThanOrEqual(10.5);
    });

    it('早送り：橋と狭い正面を組み合わせると、橋の口で受ける部隊へ同時に斬りかかれるのは 1 部隊まで（狭い正面が無ければ 3 部隊）', () => {
        // 味方の大きな本陣が橋の北の口に立ち、南から敵の槍 3 隊が橋を渡って来る
        const units = [
            U('a_hq', 'ally', 'honjin', 0, -24, { strength: 3000, morale: 100 }),
            U('e_hq', 'enemy', 'honjin', 140, 140, { aiRole: 'guard_hq' }),
            U('e1', 'enemy', 'yari', 0, 45, { aiRole: 'assault', aiTarget: { x: 0, z: -40, r: 10 } }),
            U('e2', 'enemy', 'yari', -25, 55, { aiRole: 'assault', aiTarget: { x: 0, z: -40, r: 10 } }),
            U('e3', 'enemy', 'yari', 25, 55, { aiRole: 'assault', aiTarget: { x: 0, z: -40, r: 10 } }),
        ];
        const most = (rules?: FieldRules) => {
            const s = createBattle(field(BRIDGE_MAP, units, rules ? { fieldRules: rules } : {}));
            let max = 0;
            for (let k = 0; k < 1200; k++) {
                stepBattle(s, RULES.tick);
                max = Math.max(max, s.units.filter((u) => u.side === 'enemy' && u.engagedWith === 'a_hq').length);
            }
            return max;
        };
        const narrow: FieldRules = { specialRules: [{ type: 'narrow_frontage', zone: { rect: { x0: -12, x1: 12, z0: -40, z1: 20 } }, maxEngaged: 1 }] };
        expect(most(narrow)).toBe(1);
        expect(most()).toBeGreaterThan(1);
    });
});

describe('細長い丘（カプセルの丘＝尾根）', () => {
    const RIDGE: TerrainArea = { kind: 'hill', capsule: { ax: -60, az: 0, bx: 60, bz: 0, r: 40 }, height: 12 };
    it('状態を直接操作：高さは線分からの距離 d で height × (1 − (d/r)²)。線分の上はどこでも height、幅の外は 0。区域の判定も同じ形', () => {
        const map = { id: 't', name: 't', width: 300, depth: 300, terrain: [RIDGE], exits: { ally: { x: 0, z: 150 }, enemy: { x: 0, z: -150 } } };
        expect(elevationAt(map, 0, 0)).toBeCloseTo(12, 10);
        expect(elevationAt(map, -60, 0)).toBeCloseTo(12, 10);
        expect(elevationAt(map, 45, 0)).toBeCloseTo(12, 10);
        expect(elevationAt(map, 0, 20)).toBeCloseTo(12 * (1 - 0.25), 10);
        // 端の丸み：線分の端 (60,0) から 20 m
        expect(elevationAt(map, 80, 0)).toBeCloseTo(12 * 0.75, 10);
        expect(elevationAt(map, 0, 40)).toBeCloseTo(0, 10);
        expect(elevationAt(map, 0, 60)).toBe(0);
        expect(capsuleDist(RIDGE.capsule!, 70, 30)).toBeCloseTo(Math.hypot(10, 30), 10);
        expect(inZone(RIDGE, 0, 39)).toBe(true);
        expect(inZone(RIDGE, 0, 41)).toBe(false);
        expect(inZone(RIDGE, 95, 0)).toBe(true);
        expect(inZone(RIDGE, 101, 0)).toBe(false);
    });

    it('状態を直接操作：尾根の上の部隊を下から正面に攻めると高所の守り（×0.7）が効く。尾根の上を横から（同じ高さで）攻めると効かない', () => {
        const units = [...HQS(), U('a', 'ally', 'yari', 0, 30), U('d', 'enemy', 'yari', 0, 0, { aiRole: 'hold_line' })];
        const flat = createBattle(field([], units));
        const base = meleeDamage(flat, unitById(flat, 'a')!, unitById(flat, 'd')!, 'front');
        const s = createBattle(field([RIDGE], units));
        expect(meleeDamage(s, unitById(s, 'a')!, unitById(s, 'd')!, 'front') / base).toBeCloseTo(0.7, 10);
        const a = unitById(s, 'a')!;
        a.x = -30;
        a.z = 0;
        expect(meleeDamage(s, a, unitById(s, 'd')!, 'front') / base).toBeCloseTo(1, 10);
    });
});

describe('水田（paddy）', () => {
    const PADDY_MAP: TerrainArea[] = [
        { kind: 'paddy', rect: { x0: -150, x1: -6, z0: -100, z1: 100 } },
        { kind: 'paddy', rect: { x0: 6, x1: 150, z0: -100, z1: 100 } },
        { kind: 'road', rect: { x0: -6, x1: 6, z0: -150, z1: 150 } },
    ];
    it('状態を直接操作：動きは槍・本陣 ×0.3・騎馬 ×0.2・弓 ×0.35（部隊の種類ごと）。街道（道）は速い ×1.2。重なれば道が先', () => {
        expect(TERRAIN_DEFAULTS.paddy.speed).toBe(0.3);
        expect(TERRAIN_PRIORITY.indexOf('road')).toBeLessThan(TERRAIN_PRIORITY.indexOf('paddy'));
        const s = createBattle(field(PADDY_MAP, [...HQS(), U('y', 'ally', 'yari', 50, 0), U('k', 'ally', 'kiba', 60, 20), U('b', 'ally', 'yumi', 70, 40), U('h', 'ally', 'honjin', 80, 60), U('r', 'ally', 'kiba', 0, 0)]));
        expect(unitSpeedFactor(s, unitById(s, 'y')!)).toBeCloseTo(0.3, 10);
        expect(unitSpeedFactor(s, unitById(s, 'k')!)).toBeCloseTo(0.2, 10);
        expect(unitSpeedFactor(s, unitById(s, 'b')!)).toBeCloseTo(0.35, 10);
        expect(unitSpeedFactor(s, unitById(s, 'h')!)).toBeCloseTo(0.3, 10);
        expect(unitSpeedFactor(s, unitById(s, 'r')!)).toBeCloseTo(1.2, 10);
        // 道の上に水田を重ねても、道が先に当たる
        const over = createBattle(field([{ kind: 'paddy', rect: { x0: -150, x1: 150, z0: -100, z1: 100 } }, { kind: 'road', rect: { x0: -6, x1: 6, z0: -150, z1: 150 } }], [...HQS(), U('r', 'ally', 'kiba', 0, 0)]));
        expect(unitSpeedFactor(over, unitById(over, 'r')!)).toBeCloseTo(1.2, 10);
    });

    it('状態を直接操作：水田の中で斬り合うと与える損害 ×0.85・受ける損害 ×1.1。戦場ごとに部隊の種類の速さを上書きできる', () => {
        const s = createBattle(field(PADDY_MAP, [...HQS(), U('a', 'ally', 'yari', 50, 120), U('d', 'enemy', 'yari', 50, 140, { aiRole: 'hold_line' })]));
        const a = unitById(s, 'a')!;
        const d = unitById(s, 'd')!;
        const base = meleeDamage(s, a, d, 'front');
        a.z = 50; // 攻める側が水田の中
        expect(meleeDamage(s, a, d, 'front') / base).toBeCloseTo(0.85, 10);
        a.z = 120;
        d.z = 50; // 受ける側が水田の中
        expect(meleeDamage(s, a, d, 'front') / base).toBeCloseTo(1.1, 10);
        const o = createBattle(field(PADDY_MAP, [...HQS(), U('k', 'ally', 'kiba', 60, 20)], { fieldRules: { terrainRules: { paddy: { kindSpeed: { kiba: 0.5 } } } } }));
        expect(unitSpeedFactor(o, unitById(o, 'k')!)).toBeCloseTo(0.15, 10);
    });

    it('早送り：道探しのある戦場（pathfinding）では、水田の向こうへは街道を回って行き、回り道の途中で止まらずに着く', () => {
        // 北の畦道（z -110）・街道（x 0）・南の畦道（z 110）。水田を横切れば 200 m、道を回れば 400 m 余り（道の方が早い）
        const terr: TerrainArea[] = [
            { kind: 'paddy', rect: { x0: -150, x1: -6, z0: -100, z1: 100 } },
            { kind: 'paddy', rect: { x0: 6, x1: 150, z0: -100, z1: 100 } },
            { kind: 'road', rect: { x0: -6, x1: 6, z0: -150, z1: 150 } },
            { kind: 'road', rect: { x0: -150, x1: 150, z0: -110, z1: -100 } },
            { kind: 'road', rect: { x0: -150, x1: 150, z0: 100, z1: 110 } },
        ];
        const s = createBattle(field(terr, [...HQS(), U('a', 'ally', 'yari', -120, -105)], { fieldRules: { pathfinding: true, settleMoves: true } }));
        expect(issueOrder(s, 'a', { type: 'move', x: -120, z: 105 })).toBe(true);
        let maxX = -Infinity;
        runUntilIdle(s, 'a', 400, (st) => {
            maxX = Math.max(maxX, unitById(st, 'a')!.x);
        });
        const a = unitById(s, 'a')!;
        expect(Math.hypot(a.x + 120, a.z - 105)).toBeLessThan(1.5);
        // 街道（x 0）まで回った
        expect(maxX).toBeGreaterThan(-8);
        // 水田を 0.9 m/s で 200 m 横切るより早い
        expect(s.t).toBeLessThan(200 / 0.9);
    });
});

describe('高所から低所へ射る矢（highGround.arrowDealVsLower）', () => {
    it('状態を直接操作：射手が minDiff 以上高いときだけ矢の損害に倍率が掛かる。既定は 1（変えない）', () => {
        expect(HIGH_GROUND_DEFAULTS.arrowDealVsLower).toBe(1);
        const terr: TerrainArea[] = [{ kind: 'hill', capsule: { ax: -80, az: -60, bx: 80, bz: -60, r: 40 }, height: 12 }];
        const units = [...HQS(), U('b', 'enemy', 'yumi', 0, -60, { aiRole: 'hold_line' }), U('a', 'ally', 'yari', 0, 20)];
        const plain = createBattle(field(terr, units));
        const base = rangedDamage(plain, unitById(plain, 'b')!, unitById(plain, 'a')!);
        const s = createBattle(field(terr, units, { fieldRules: { highGround: { arrowDealVsLower: 1.35 } } }));
        expect(rangedDamage(s, unitById(s, 'b')!, unitById(s, 'a')!) / base).toBeCloseTo(1.35, 10);
        // 同じ高さ（尾根の上どうし）では掛からない
        const a = unitById(s, 'a')!;
        a.x = 60;
        a.z = -60;
        const a0 = unitById(plain, 'a')!;
        a0.x = 60;
        a0.z = -60;
        expect(rangedDamage(s, unitById(s, 'b')!, a) / rangedDamage(plain, unitById(plain, 'b')!, a0)).toBeCloseTo(1, 10);
    });
});

describe('検査（validateField）：橋・尾根・地形の形', () => {
    it('橋が川を渡っていない（真ん中が川の外・両端の先が川の中）・形が無い／2 つある・カプセルの幅が 0', () => {
        const f = clone(getField('single_bridge')!);
        const bi = f.terrain.findIndex((a) => a.kind === 'bridge');
        // 両端の先が川の中（川より短い橋）
        f.terrain[bi] = { kind: 'bridge', rect: { x0: -9, x1: 9, z0: -34, z1: -16 } };
        expect(validateField(f).some((t) => t.includes('bridge') && t.includes('両端'))).toBe(true);
        // 川の無い所の橋
        const g = clone(getField('single_bridge')!);
        g.terrain.push({ kind: 'bridge', rect: { x0: 100, x1: 110, z0: 60, z1: 90 } });
        expect(validateField(g).some((t) => t.includes('bridge') && t.includes('深い川の上にない'))).toBe(true);
        const h = clone(getField('ridge')!);
        h.terrain.push({ kind: 'woods' }, { kind: 'woods', rect: { x0: 0, x1: 10, z0: 0, z1: 10 }, circle: { cx: 0, cz: 0, r: 5 } }, { kind: 'hill', capsule: { ax: 0, az: 100, bx: 10, bz: 100, r: 0 } });
        const out = validateField(h);
        expect(out.filter((t) => t.includes('ちょうど 1 つ'))).toHaveLength(2);
        expect(out.some((t) => t.includes('カプセルの幅'))).toBe(true);
    });

    it('尾根の頂へ登る道が無い（頂を崖で囲う）・頂が崖の中', () => {
        const f = clone(getField('ridge')!);
        // 尾根の頂（線分の中点 (0,-60)）を崖の箱で囲う
        f.terrain.push(
            { kind: 'cliff', rect: { x0: -40, x1: 40, z0: -100, z1: -90 } },
            { kind: 'cliff', rect: { x0: -40, x1: 40, z0: -30, z1: -20 } },
            { kind: 'cliff', rect: { x0: -40, x1: -30, z0: -100, z1: -20 } },
            { kind: 'cliff', rect: { x0: 30, x1: 40, z0: -100, z1: -20 } },
        );
        expect(validateField(f).some((t) => t.includes('hill') && t.includes('登る道がない'))).toBe(true);
        const g = clone(getField('ridge')!);
        g.terrain.push({ kind: 'cliff', rect: { x0: -10, x1: 10, z0: -70, z1: -50 } });
        expect(validateField(g).some((t) => t.includes('hill') && t.includes('頂が通れる所にない'))).toBe(true);
    });
});

// ---------------------------------------------------------------- 第2群の 5 戦場の最初の案

const GROUP2 = ['single_bridge', 'multi_bridge', 'ridge', 'valley', 'paddy'] as const;

describe('第2群の 5 戦場のデータ', () => {
    it('検査を通る。分類・味方 6〜8／敵 6〜10・徳川 5 武将（generalId と能力）・武将の自由な動き・演習の編成 standard・敵はすべて敵勢', () => {
        for (const id of GROUP2) {
            const f = getField(id)!;
            expect([id, validateField(f)]).toEqual([id, []]);
            expect(f.kind).toBe(id);
            expect(f.generalInitiative).toBe(true);
            expect(f.presets.map((p) => p.id)).toContain('standard');
            const us = presetUnits(f, 'standard');
            const al = us.filter((u) => u.side === 'ally');
            const en = us.filter((u) => u.side === 'enemy');
            expect(al.length).toBeGreaterThanOrEqual(6);
            expect(al.length).toBeLessThanOrEqual(8);
            expect(en.length).toBeGreaterThanOrEqual(6);
            expect(en.length).toBeLessThanOrEqual(10);
            expect(new Set(al.map((u) => u.generalId).filter(Boolean))).toEqual(new Set(['ieyasu', 'tadakatsu', 'sakakibara', 'sakai', 'ishikawa']));
            expect(en.every((u) => u.clan === 'rival')).toBe(true);
            // 能力：家康・忠勝は能力を持たせる。酒井・石川・榊原は武将のデータの能力を使う（どれも合戦の能力の記録に入る）
            const s = createBattle(buildBattleSetup(f, 'standard'));
            expect(new Set(s.abilityList.filter((r) => r.side === 'ally').map((r) => r.id))).toEqual(
                new Set(['ieyasu_rally', 'tadakatsu_rearguard', 'sakai_flank', 'ishikawa_reserve', 'sakakibara_vanguard']),
            );
            expect(f.briefing.length).toBeGreaterThan(2);
            expect(f.tactics.length).toBeGreaterThanOrEqual(2);
        }
    });

    it('主目標は敵本陣の撃破にしない（橋頭確保・一定時間防衛・地点確保・突破・撤退支援）。主目標・副目標は別々に結果に入る', () => {
        const types = GROUP2.map((id) => getField(id)!.objectives.primary.type);
        expect(types).toEqual(['hold_point', 'defend_time', 'hold_point', 'breakthrough', 'rescue']);
        for (const id of GROUP2) expect(getField(id)!.objectives.secondary.length).toBeGreaterThanOrEqual(1);
    });

    it('地形：一本橋・複数橋は橋と狭い正面、尾根・谷間はカプセルの丘、谷間は高所から射る矢 ×1.35、水田は水田と道・道探し', () => {
        const sb = getField('single_bridge')!;
        expect(sb.terrain.filter((a) => a.kind === 'bridge')).toHaveLength(1);
        expect(sb.terrain.some((a) => a.kind === 'ford')).toBe(true);
        expect(sb.specialRules?.[0]).toMatchObject({ type: 'narrow_frontage', maxEngaged: 1 });
        const mb = getField('multi_bridge')!;
        expect(mb.terrain.filter((a) => a.kind === 'bridge')).toHaveLength(3);
        expect(mb.specialRules?.filter((r) => r.type === 'narrow_frontage')).toHaveLength(3);
        expect(getField('ridge')!.terrain.filter((a) => a.kind === 'hill' && a.capsule)).toHaveLength(1);
        expect(getField('valley')!.terrain.filter((a) => a.kind === 'hill' && a.capsule)).toHaveLength(2);
        expect(getField('valley')!.highGround?.arrowDealVsLower).toBe(1.35);
        const pd = getField('paddy')!;
        expect(pd.terrain.filter((a) => a.kind === 'paddy').length).toBeGreaterThanOrEqual(2);
        expect(pd.pathfinding).toBe(true);
        expect(createBattle(buildBattleSetup(pd, 'standard')).field.nav).not.toBeNull();
    });

    it('画面の文：戦場の決まりの説明（橋・水田の速さ・高所の矢）と、地図の名札（橋・水田・尾根）', () => {
        const txt = (id: string) => fieldRuleTexts(createBattle(buildBattleSetup(getField(id)!, 'standard')));
        expect(txt('single_bridge')).toContain('深い川は渡れない（浅瀬と橋だけ渡れる）');
        expect(txt('multi_bridge')).toContain('深い川は渡れない（橋だけ渡れる）');
        // 3 本の橋の狭い正面は 1 行にまとめる
        expect(txt('multi_bridge').filter((t) => t.startsWith('狭い正面'))).toEqual(['狭い正面（3 か所）：区域の中では、同じ相手に斬りかかれるのは 1 部隊まで']);
        expect(txt('mountain_pass').filter((t) => t.startsWith('狭い正面'))).toEqual(['狭い正面：区域の中では、同じ相手に斬りかかれるのは 2 部隊まで']);
        expect(txt('paddy').some((t) => t.startsWith('水田：動き 槍・本陣 ×0.3・騎馬 ×0.2・弓 ×0.35'))).toBe(true);
        expect(txt('valley').some((t) => t.includes('低い相手へ射る矢 ×1.35'))).toBe(true);
        // 第1群の文は変わらない
        expect(txt('river_ford')).toContain('深い川は渡れない（浅瀬だけ渡れる）');
        const labels = (id: string) => mapLabels(createBattle(buildBattleSetup(getField(id)!, 'standard'))).map((l) => l.text);
        expect(labels('multi_bridge').filter((t) => t === '橋')).toHaveLength(3);
        expect(labels('ridge')).toContain('尾根');
        expect(labels('valley').filter((t) => t === '尾根')).toHaveLength(2);
        // 水田は区画が多いので、近い区画には名札を付けない（4 区画で 2 つ以下）
        const p = labels('paddy').filter((t) => t.startsWith('水田'));
        expect(p.length).toBeGreaterThanOrEqual(1);
        expect(p.length).toBeLessThanOrEqual(2);
    });
});

/** 台本の 1 行：[開始からの秒, 部隊 id, 命令]。'ability' は固有能力、'nearest' は「見えている一番近い敵へ攻撃」（今の相手が戦えるなら出さない） */
type Step = [number, string, Order | 'ability' | 'nearest'];
const atk = (targetId: string): Order => ({ type: 'attack', targetId });
const mv = (x: number, z: number): Order => ({ type: 'move', x, z });

function play(id: string, steps: Step[]): { o: BattleOutcome; loss: number } {
    const s = createBattle(buildBattleSetup(getField(id)!, 'standard'));
    const q = [...steps].sort((a, b) => a[0] - b[0]);
    const o = runToEnd(s, (st) => {
        while (q.length && st.t >= q[0]![0] - 1e-9) {
            const [, uid, ord] = q.shift()!;
            if (ord === 'ability') useAbility(st, uid);
            else if (ord === 'nearest') {
                const u = unitById(st, uid)!;
                if (!isActive(u)) continue;
                if (u.order.type === 'attack') {
                    const cur = unitById(st, u.order.targetId);
                    if (cur && isActive(cur)) continue;
                }
                const e = st.units.filter((x) => x.side === 'enemy' && isActive(x) && x.seenBy.ally).sort((a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z))[0];
                if (e) issueOrder(st, uid, atk(e.id));
            } else issueOrder(st, uid, ord);
        }
    });
    const al = o.units.filter((u) => u.side === 'ally');
    const loss = 1 - al.reduce((a, u) => a + u.endStrength, 0) / al.reduce((a, u) => a + u.startStrength, 0);
    return { o, loss };
}

/**
 * 最初の案の台本（早送り）。地形に合った作戦が勝ち、地形に合わない作戦（正面突破・均等に置いたまま・谷底を急ぐ・街道で押し合う）が
 * 負けるか損害が大きいことの目安。釣り合いの担当が数字を整えるときに、ここの数字も直す（作った時の値をコメントに残す）。
 */
describe('第2群の 5 戦場の最初の案（早送りの台本）', () => {
    // 一本橋は釣り合いを整えた（細かい台本・±15 秒の 16 通り・能力の比べは tests/proto3d-field-single_bridge.test.ts）。
    // 最初の案の台本（三隊で西の浅瀬へ回る。作った時 313 秒・損害 33％で勝ち、橋頭へ押し込むのは 47％で勝ち）は、釣り合いの後は
    // どちらも勝てない（橋の守り・弓を強め、浅瀬の見張りを回り込む別働隊にしたため）。ここは釣り合いの後の代表の台本に置き換えた
    it('一本橋：弓の陽動で橋の守りを南の岸へ引き出して囲み、騎馬で西の浅瀬の別働隊を討ってから橋頭へ → 勝つ（292 秒・損害 27％）。全部隊で橋頭へ押し込む → 負ける（損害 48％）', () => {
        const fit = play('single_bridge', [
            [0, 'a_yumi', atk('e_guard')],
            [0, 'a_sakakibara', mv(-167, 10)],
            [0, 'a_kiba', mv(-155, 25)],
            [0, 'a_ishikawa', mv(-10, 45)],
            [50, 'a_tadakatsu', atk('e_guard')],
            [50, 'a_sakai', atk('e_guard')],
            [50, 'a_ishikawa', atk('e_guard')],
            [60, 'a_sakakibara', atk('e_west')],
            [60, 'a_kiba', atk('e_west')],
            [100, 'a_tadakatsu', 'nearest'],
            [100, 'a_sakai', 'nearest'],
            [100, 'a_ishikawa', 'nearest'],
            [150, 'a_tadakatsu', mv(0, -70)],
            [150, 'a_sakai', atk('e_yumi_e')],
            [150, 'a_ishikawa', atk('e_yumi_w')],
            [150, 'a_yumi', atk('e_yumi_e')],
            [150, 'a_sakakibara', atk('e_yumi_w')],
            [150, 'a_kiba', mv(-20, -60)],
        ]);
        const push = play('single_bridge', [...['a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa', 'a_kiba'].map((id) => [0, id, mv(0, -72)] as Step), [0, 'a_yumi', atk('e_guard')]]);
        expect(fit.o.result).toBe('victory');
        expect(push.o.result).not.toBe('victory');
        expect(fit.loss).toBeLessThan(push.loss - 0.08);
    }, 60_000);

    it('複数橋：敵の主力が東へ集まるのを見て忠勝隊・石川隊・弓を東の橋へ寄せ、西が片付いたら酒井隊で中を埋める → 300 秒しのいで勝つ。均等に置いたまま → 本陣が崩れて負ける', () => {
        const fit = play('multi_bridge', [
            [20, 'a_tadakatsu', mv(150, 30)],
            [20, 'a_ishikawa', mv(128, 45)],
            [20, 'a_yumi', mv(110, 65)],
            [20, 'a_kiba', mv(0, 45)],
            [100, 'a_sakai', mv(0, 35)],
            [100, 'a_kiba', mv(20, 80)],
            [130, 'a_yumi', mv(40, 70)],
            [140, 'a_ishikawa', mv(10, 50)],
            [150, 'a_ieyasu', 'ability'],
        ]);
        expect(fit.o.result).toBe('victory');
        const even = play('multi_bridge', []);
        expect(even.o.result).toBe('defeat');
    }, 60_000);

    it('尾根：西の登り道から尾根に登り、肩の隊を破って尾根の上を横に進み頂へ → 勝つ（作った時 319 秒・損害 21％）。何もしない → 日没', () => {
        const fit = play('ridge', [
            [0, 'a_sakakibara', mv(-165, -60)],
            [0, 'a_sakai', mv(-165, -40)],
            [0, 'a_ishikawa', mv(-160, -20)],
            [0, 'a_kiba', mv(-150, 0)],
            [60, 'a_sakakibara', atk('e_shoulder_w')],
            [60, 'a_sakai', atk('e_shoulder_w')],
            [60, 'a_ishikawa', atk('e_shoulder_w')],
            [60, 'a_kiba', mv(-165, -50)],
            [120, 'a_sakai', mv(-60, -62)],
            [120, 'a_ishikawa', mv(-60, -45)],
            [120, 'a_sakakibara', mv(-80, -80)],
            [120, 'a_kiba', mv(-60, -75)],
            [160, 'a_sakai', atk('e_summit_w')],
            [160, 'a_ishikawa', atk('e_summit_w')],
            [160, 'a_sakakibara', atk('e_yumi')],
            [160, 'a_kiba', atk('e_summit_w')],
            [175, 'a_tadakatsu', atk('e_summit_e')],
            [250, 'a_sakai', 'nearest'],
            [250, 'a_ishikawa', 'nearest'],
            [250, 'a_kiba', 'nearest'],
            [290, 'a_sakai', mv(-10, -62)],
            [290, 'a_ishikawa', mv(10, -62)],
            [290, 'a_tadakatsu', mv(0, -50)],
            [290, 'a_kiba', mv(0, -70)],
        ]);
        expect(fit.o.result).toBe('victory');
        expect(fit.loss).toBeLessThan(0.4);
        expect(play('ridge', []).o.reason).toBe('nightfall');
    }, 60_000);

    // 谷間は釣り合いを整えた（細かい台本・±15 秒の 16 通り・能力の比べは tests/proto3d-field-valley.test.ts）。
    // 最初の案の台本（高地と谷底を並んで北へ進み、出口の塞ぎを破ってから抜ける。作った時 436 秒）は、釣り合いの後は勝てない
    // （谷の両側の壁を崖にし、出口の手前を狭い口にして塞ぎを置いたため）。ここは釣り合いの後の代表の台本に置き換えた
    it('谷間：西の高地へ南の端から登って槍と弓を破り、高地の上を北へ進んで北の端から出口の西へ降りる（忠勝隊は谷の口で攻め手を待つ）→ 勝つ（311 秒・損害 15％）。谷底を急いで抜けるだけ → 負ける（損害 52％）', () => {
        const W = ['a_sakai', 'a_ishikawa', 'a_sakakibara', 'a_kiba'];
        const ex: Record<string, [number, number]> = { a_sakai: [-30, -190], a_ishikawa: [-15, -205], a_sakakibara: [-40, -205], a_kiba: [-45, -185] };
        const fit = play('valley', [
            [0, 'a_sakai', mv(-95, 125)],
            [0, 'a_ishikawa', mv(-75, 135)],
            [0, 'a_sakakibara', mv(-115, 140)],
            [0, 'a_kiba', mv(-60, 155)],
            [0, 'a_yumi', mv(-70, 150)],
            [30, 'a_sakai', atk('e_w_guard')],
            [30, 'a_ishikawa', atk('e_w_guard')],
            [30, 'a_sakakibara', atk('e_w_guard')],
            [40, 'a_yumi', atk('e_w_guard')],
            [60, 'a_kiba', mv(-95, 100)],
            [100, 'a_sakai', atk('e_w_yumi')],
            [100, 'a_ishikawa', mv(-80, 10)],
            [100, 'a_sakakibara', mv(-110, 10)],
            [100, 'a_kiba', mv(-95, 40)],
            [100, 'a_yumi', mv(-95, 60)],
            [240, 'a_sakai', mv(-95, -150)],
            [240, 'a_ishikawa', mv(-80, -150)],
            [240, 'a_sakakibara', mv(-110, -150)],
            [240, 'a_kiba', mv(-95, -130)],
            ...W.flatMap((id) => [[300, id, mv(...ex[id]!)] as Step, [340, id, mv(...ex[id]!)] as Step]),
        ]);
        expect(fit.o.result).toBe('victory');
        expect(fit.loss).toBeLessThan(0.2);
        const rush = play('valley', ['a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa', 'a_kiba', 'a_yumi'].map((id, i) => [0, id, mv(-20 + (i % 3) * 20, -195)] as Step));
        expect(rush.o.result).toBe('defeat');
        expect(rush.loss).toBeGreaterThan(0.4);
    }, 60_000);

    // 水田は釣り合いを整えた（細かい台本・±15 秒の 16 通り・能力の比べは tests/proto3d-field-paddy.test.ts）。
    // 最初の案の台本（荷駄隊が北西の畦道から水田を南へ横切り、中の交わりを押さえる。作った時 234 秒・損害 6％で勝ち）は、釣り合いの後は
    // 中の交わりを大きな備えが塞ぎ、両脇の田の弓が田を渡る荷駄隊を射るため、遅く損害が大きい（347 秒・損害 48％）。ここは釣り合いの後の代表の台本に置き換えた
    it('水田：忠勝隊が街道から交わりの備えを押さえ、酒井隊は西の田を横切って、榊原隊は東の畦道を回って横から当たり、備えが崩れたら荷駄隊を退かせる → 勝つ（179.5 秒・損害 10％）。四隊で交わりへ押し込む → 負ける（損害 43％）', () => {
        const fit = play('paddy', [
            [0, 'a_sakai', mv(-40, 80)],
            [0, 'a_sakakibara', mv(140, 57)],
            [0, 'a_yumi', mv(-20, 130)],
            [0, 'a_tadakatsu', mv(0, 110)],
            [30, 'a_sakakibara', mv(58, 56)],
            [30, 'a_sakakibara', 'ability'],
            [38, 'a_sakakibara', atk('e_yumi_e')],
            [30, 'a_yumi', atk('e_block')],
            [45, 'a_sakai', mv(-38, 56)],
            [80, 'a_tadakatsu', atk('e_block')],
            [80, 'a_sakai', atk('e_block')],
            [80, 'a_sakakibara', atk('e_block')],
            [110, 'a_konida', { type: 'retreat' }],
        ]);
        expect(fit.o.result).toBe('victory');
        expect(fit.o.objectives?.primary?.achieved).toBe(true);
        expect(fit.loss).toBeLessThan(0.15);
        const push = play('paddy', [
            ...['a_tadakatsu', 'a_sakai', 'a_ishikawa', 'a_sakakibara'].map((id) => [0, id, atk('e_block')] as Step),
            [0, 'a_yumi', mv(0, 125)],
            [30, 'a_yumi', atk('e_block')],
            [110, 'a_konida', { type: 'retreat' }],
        ]);
        expect(push.o.result).toBe('defeat');
        expect(push.o.reason).toBe('objective_failed');
        expect(push.loss).toBeGreaterThan(0.4);
    });
});
