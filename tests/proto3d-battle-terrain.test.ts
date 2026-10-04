/**
 * データ駆動の戦場の合戦エンジン（docs/battlefields-design.md §3）：通行・道探し・浅瀬・林の奇襲・狭い正面・視界と高所の上書き・
 * 部隊の種類ごとの速さ・援軍・敵の考えの新しい役割（hold_zone・assault）・計算の重さ。
 * 小さな試験用の戦場で確かめる。「早送り」（runToEnd・stepBattle で一気に進める）と、「状態を直接操作」（位置・士気を書き換えて
 * 損害の式を比べる）の両方がある。どちらかは各テストの名前に書く。
 */
import { describe, expect, it } from 'vitest';
import {
    bowRangeFor,
    createBattle,
    issueOrder,
    meleeDamage,
    passableAt,
    runToEnd,
    stepBattle,
    unitById,
    unitSpeedFactor,
    type BattleState,
} from '../proto3d/src/battle/sim';
import { findPath, findPathAvoiding, isPassable } from '../proto3d/src/battle/pathfind';
import { TERRAIN_DEFAULTS } from '../proto3d/src/battle/fieldRules';
import { RULES } from '../proto3d/src/battle/sim';
import { demoSetup } from '../proto3d/src/battle/maps';
import { buildBattleSetup, getField, presetUnits } from '../proto3d/src/battle/fields';
import type { BattleSetup, FieldRules, Side, TerrainArea, UnitDef, UnitKind } from '../proto3d/src/battle/types';

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
/** sec 秒進める（stepBattle は 1 回に 2 秒までしか進めないので刻みで進める） */
function advance(s: BattleState, sec: number): void {
    const end = s.tick + Math.round(sec / RULES.tick);
    while (s.tick < end && !s.result) stepBattle(s, RULES.tick);
}
/** 部隊が止まる（待機になる）か、max 秒まで進める。刻みごとに each を呼ぶ */
function runUntilIdle(s: BattleState, id: string, max: number, each?: (s: BattleState) => void): void {
    while (s.t < max && !s.result) {
        stepBattle(s, RULES.tick);
        each?.(s);
        const u = unitById(s, id)!;
        if (u.order.type === 'hold' && !u.moving) break;
    }
}

const RIVER: TerrainArea[] = [
    { kind: 'river', rect: { x0: -150, x1: 150, z0: -10, z1: 10 } },
    { kind: 'ford', rect: { x0: 90, x1: 110, z0: -10, z1: 10 } },
];

describe('通行と道探し（早送り）', () => {
    it('通れない所の無い戦場（国境の原）は道探しを作らない（まっすぐ進む今の動きのまま）', () => {
        expect(createBattle(demoSetup('tashiro')).field.nav).toBeNull();
        expect(createBattle(buildBattleSetup(getField('plains')!, 'standard')).field.nav).toBeNull();
        expect(createBattle(buildBattleSetup(getField('river_ford')!, 'standard')).field.nav).not.toBeNull();
        expect(createBattle(buildBattleSetup(getField('mountain_pass')!, 'standard')).field.nav).not.toBeNull();
    });

    it('川を浅瀬で渡る：深い川には入らず、川の帯を通るのは浅瀬の中だけ。行き先に着く', () => {
        const s = createBattle(field(RIVER, [...HQS(), U('a', 'ally', 'yari', 0, 60)]));
        expect(issueOrder(s, 'a', { type: 'move', x: 0, z: -60 })).toBe(true);
        let crossedAt: number[] = [];
        runUntilIdle(s, 'a', 400, (st) => {
            const a = unitById(st, 'a')!;
            expect(passableAt(st, a.x, a.z)).toBe(true);
            if (Math.abs(a.z) < 10) crossedAt.push(a.x);
        });
        const a = unitById(s, 'a')!;
        expect(Math.hypot(a.x - 0, a.z + 60)).toBeLessThan(1.5);
        expect(crossedAt.length).toBeGreaterThan(0);
        crossedAt = crossedAt.map((x) => Math.round(x));
        expect(Math.min(...crossedAt)).toBeGreaterThanOrEqual(89);
        expect(Math.max(...crossedAt)).toBeLessThanOrEqual(111);
    });

    it('崖を回る：崖の壁の切れ目を通って向こうへ着く（壁の中には入らない）', () => {
        const wall: TerrainArea[] = [{ kind: 'cliff', rect: { x0: -150, x1: 60, z0: -6, z1: 6 } }];
        const s = createBattle(field(wall, [...HQS(), U('a', 'ally', 'kiba', 0, 50)]));
        issueOrder(s, 'a', { type: 'move', x: 0, z: -50 });
        let maxX = -Infinity;
        runUntilIdle(s, 'a', 300, (st) => {
            const a = unitById(st, 'a')!;
            expect(passableAt(st, a.x, a.z)).toBe(true);
            maxX = Math.max(maxX, a.x);
        });
        const a = unitById(s, 'a')!;
        expect(Math.hypot(a.x, a.z + 50)).toBeLessThan(1.5);
        expect(maxX).toBeGreaterThan(60);
    });

    it('通れない所への移動の命令は、いちばん近い通れる所へ寄せる。囲まれた所への道は無い', () => {
        const s = createBattle(field(RIVER, [...HQS(), U('a', 'ally', 'yari', 0, 60)]));
        issueOrder(s, 'a', { type: 'move', x: 0, z: 0 });
        const o = unitById(s, 'a')!.order;
        expect(o.type).toBe('move');
        if (o.type === 'move') expect(isPassable(s.field.nav!, o.x, o.z)).toBe(true);
        const ring: TerrainArea[] = [
            { kind: 'cliff', rect: { x0: -40, x1: 40, z0: -40, z1: -30 } },
            { kind: 'cliff', rect: { x0: -40, x1: 40, z0: 30, z1: 40 } },
            { kind: 'cliff', rect: { x0: -40, x1: -30, z0: -40, z1: 40 } },
            { kind: 'cliff', rect: { x0: 30, x1: 40, z0: -40, z1: 40 } },
        ];
        const r = createBattle(field(ring, HQS()));
        expect(findPath(r.field.nav!, 'yari', 0, 0, 0, 120)).toBeNull();
        expect(findPath(r.field.nav!, 'yari', 0, 100, 0, 120)).not.toBeNull();
    });

    it('攻撃の相手が川の向こう：浅瀬を通って追いつき、斬り合う', () => {
        const s = createBattle(field(RIVER, [U('a_hq', 'ally', 'honjin', -140, 140), U('a', 'ally', 'yari', 0, 60, { strength: 600 }), U('e_hq', 'enemy', 'honjin', 0, -60, { aiRole: 'guard_hq', strength: 150 })]));
        issueOrder(s, 'a', { type: 'attack', targetId: 'e_hq' });
        let engaged = false;
        const xs: number[] = [];
        while (s.t < 300 && !s.result) {
            stepBattle(s, RULES.tick);
            const a = unitById(s, 'a')!;
            expect(passableAt(s, a.x, a.z)).toBe(true);
            if (Math.abs(a.z) < 10) xs.push(a.x);
            if (a.engagedWith === 'e_hq') engaged = true;
        }
        expect(engaged).toBe(true);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(89);
        expect(s.result?.result).toBe('victory');
    });

    it('全軍の退き口：通れない所がある戦場では、決まった退き口の点へ向かって離れる', () => {
        const s = createBattle(field(RIVER, [...HQS(), U('a', 'ally', 'yari', 60, -60)]));
        issueOrder(s, 'a', { type: 'retreat' });
        runUntilIdle(s, 'a', 400);
        const a = unitById(s, 'a')!;
        expect(a.status).toBe('withdrawn');
    });
});

describe('地形の決まり（状態を直接操作して損害・速さの式を比べる）', () => {
    it('浅瀬の既定：動き ×0.4、中にいる部隊の与える損害 ×0.8・受ける損害 ×1.2', () => {
        expect(TERRAIN_DEFAULTS.ford).toMatchObject({ speed: 0.4, dealMul: 0.8, takeMul: 1.2 });
        const s = createBattle(field(RIVER, [...HQS(), U('a', 'ally', 'yari', 100, 30), U('d', 'enemy', 'yari', 100, 50, { aiRole: 'hold_line' })]));
        const a = unitById(s, 'a')!;
        const d = unitById(s, 'd')!;
        const base = meleeDamage(s, a, d, 'front');
        a.z = 0; // 浅瀬の中
        expect(unitSpeedFactor(s, a)).toBeCloseTo(0.4, 10);
        expect(meleeDamage(s, a, d, 'front') / base).toBeCloseTo(0.8, 10);
        a.z = 30;
        d.z = 0;
        expect(meleeDamage(s, a, d, 'front') / base).toBeCloseTo(1.2, 10);
    });

    it('fieldRules で地形の決まりを上書きできる（浅瀬の損害・林の中の騎馬の速さ）', () => {
        const rules: FieldRules = { terrainRules: { ford: { dealMul: 0.5 }, woods: { kindSpeed: { kiba: 0.5 } } } };
        const terr: TerrainArea[] = [...RIVER, { kind: 'woods', rect: { x0: -150, x1: -50, z0: 20, z1: 100 } }];
        const s = createBattle(field(terr, [...HQS(), U('a', 'ally', 'yari', 100, 0), U('d', 'enemy', 'yari', 100, 20, { aiRole: 'hold_line' }), U('k', 'ally', 'kiba', -100, 50), U('y', 'ally', 'yari', -100, 70)], { fieldRules: rules }));
        const a = unitById(s, 'a')!;
        const d = unitById(s, 'd')!;
        const inFord = meleeDamage(s, a, d, 'front');
        a.z = 30;
        expect(inFord / meleeDamage(s, a, d, 'front')).toBeCloseTo(0.5, 10);
        expect(unitSpeedFactor(s, unitById(s, 'k')!)).toBeCloseTo(0.25, 10);
        expect(unitSpeedFactor(s, unitById(s, 'y')!)).toBeCloseTo(0.5, 10);
    });

    it('視界の上書き：林の隠れる距離を 30 m にすると、45 m の相手からは見えない（既定の 60 m なら見える）', () => {
        const terr: TerrainArea[] = [{ kind: 'woods', rect: { x0: -150, x1: 150, z0: -150, z1: -20 } }];
        const units = [...HQS(), U('a', 'ally', 'yari', 0, -60), U('d', 'enemy', 'yari', 0, -15, { aiRole: 'hold_line' })];
        expect(unitById(createBattle(field(terr, units)), 'a')!.seenBy.enemy).toBe(true);
        const s = createBattle(field(terr, units, { fieldRules: { terrainRules: { woods: { hideSight: 30 } } } }));
        expect(unitById(s, 'a')!.seenBy.enemy).toBe(false);
    });

    it('丘の見通し：高所の部隊は、隠れた相手を sightBonus だけ遠くから見つける', () => {
        const terr: TerrainArea[] = [
            { kind: 'woods', rect: { x0: -150, x1: 150, z0: 20, z1: 150 } },
            { kind: 'hill', circle: { cx: 0, cz: -40, r: 40 }, height: 12 },
        ];
        // 林の中の味方（z 50）と、丘の頂の敵（z -40）は 90 m
        const units = [U('a_hq', 'ally', 'honjin', -140, 140), U('e_hq', 'enemy', 'honjin', 140, -140, { aiRole: 'guard_hq' }), U('a', 'ally', 'yari', 0, 50), U('d', 'enemy', 'yari', 0, -40, { aiRole: 'hold_line' })];
        expect(unitById(createBattle(field(terr, units)), 'a')!.seenBy.enemy).toBe(false);
        const s = createBattle(field(terr, units, { fieldRules: { highGround: { sightBonus: 40 } } }));
        expect(unitById(s, 'a')!.seenBy.enemy).toBe(true);
    });

    it('高所の有利を上書きできる：下から正面に来る相手の損害の倍率・弓の射程の上乗せ', () => {
        const terr: TerrainArea[] = [{ kind: 'hill', circle: { cx: 0, cz: -40, r: 50 }, height: 14 }];
        const units = [...HQS(), U('a', 'ally', 'yari', 0, 30), U('d', 'enemy', 'yari', 0, -40, { aiRole: 'hold_line' }), U('b', 'enemy', 'yumi', 0, -40, { aiRole: 'hold_line' })];
        const flat = createBattle(field([], units));
        const base = meleeDamage(flat, unitById(flat, 'a')!, unitById(flat, 'd')!, 'front');
        const def = createBattle(field(terr, units));
        expect(meleeDamage(def, unitById(def, 'a')!, unitById(def, 'd')!, 'front') / base).toBeCloseTo(0.7, 10);
        const strong = createBattle(field(terr, units, { fieldRules: { highGround: { defenseVsLower: 0.5, rangeBonus: 30 } } }));
        expect(meleeDamage(strong, unitById(strong, 'a')!, unitById(strong, 'd')!, 'front') / base).toBeCloseTo(0.5, 10);
        // 弓：丘の上から下の相手へは 150 m まで届く（既定は 120 m）
        const b = unitById(strong, 'b')!;
        const far = { x: 0, z: 100 };
        expect(bowRangeFor(def, b, far)).toBe(RULES.bowRange);
        expect(bowRangeFor(strong, b, far)).toBe(RULES.bowRange + 30);
    });

    it('高所の射程の上乗せ（早送り）：丘の上の弓は 140 m 下の相手を射る。上乗せが無ければ射ない', () => {
        const terr: TerrainArea[] = [{ kind: 'hill', circle: { cx: 0, cz: -40, r: 50 }, height: 14 }];
        const units = [...HQS(), U('a', 'ally', 'yari', 0, 100), U('b', 'enemy', 'yumi', 0, -40, { aiRole: 'hold_line' })];
        const shoots = (rules?: FieldRules) => {
            const s = createBattle(field(terr, units, rules ? { fieldRules: rules } : {}));
            advance(s, 1);
            return unitById(s, 'b')!.shootingAt;
        };
        expect(shoots()).toBeNull();
        expect(shoots({ highGround: { rangeBonus: 30 } })).toBe('a');
    });
});

describe('特殊ルール（早送り）', () => {
    const woods: TerrainArea[] = [{ kind: 'woods', rect: { x0: -150, x1: 150, z0: -150, z1: 0 } }];
    /** 林から出て、開けた所の敵へ斬りかかる。接してから 8 秒の敵の損害と、出来事 */
    function strike(rules?: FieldRules, startZ = -60): { loss: number; ambush: number } {
        const s = createBattle(field(woods, [...HQS(), U('a', 'ally', 'yari', 0, startZ), U('d', 'enemy', 'yari', 0, 40, { aiRole: 'hold_line', morale: 100, strength: 600 })], rules ? { fieldRules: rules } : {}));
        issueOrder(s, 'a', { type: 'attack', targetId: 'd' });
        let t0: number | null = null;
        let before = 0;
        while (s.t < 200) {
            stepBattle(s, RULES.tick);
            const a = unitById(s, 'a')!;
            if (t0 === null && a.engagedWith === 'd') {
                t0 = s.t;
                before = unitById(s, 'd')!.strength + 0;
            }
            if (t0 !== null && s.t >= t0 + 8 - 1e-9) break;
        }
        return { loss: before - unitById(s, 'd')!.strength, ambush: s.events.filter((e) => e.kind === 'ambush').length };
    }

    it('林の奇襲：見えていなかった部隊の最初の当たりは損害 ×1.5（無い戦場では変わらない）。見られていた部隊には効かない', () => {
        const plain = strike();
        const amb = strike({ specialRules: [{ type: 'woods_ambush', firstStrikeMul: 1.5, sec: 8 }] });
        expect(plain.ambush).toBe(0);
        expect(amb.ambush).toBe(1);
        expect(amb.loss / plain.loss).toBeGreaterThan(1.3);
        expect(amb.loss / plain.loss).toBeLessThan(1.6);
        // 林の外（見られている所）から斬りかかる部隊には効かない
        const open = strike({ specialRules: [{ type: 'woods_ambush', firstStrikeMul: 1.5, sec: 8 }] }, 110);
        expect(open.ambush).toBe(0);
    });

    it('狭い正面：区域の中では、同じ相手へ斬りかかれるのは maxEngaged 部隊まで（無い戦場では 3 部隊とも当たる）', () => {
        const units = [
            U('a_hq', 'ally', 'honjin', 0, 0, { strength: 3000, morale: 100 }),
            U('e_hq', 'enemy', 'honjin', 140, -140, { aiRole: 'guard_hq' }),
            U('e1', 'enemy', 'yari', 0, -40, { aiRole: 'hold_line' }),
            U('e2', 'enemy', 'yari', -30, -30, { aiRole: 'hold_line' }),
            U('e3', 'enemy', 'yari', 30, -30, { aiRole: 'hold_line' }),
        ];
        const most = (rules?: FieldRules) => {
            const s = createBattle(field([], units, rules ? { fieldRules: rules } : {}));
            let max = 0;
            for (let k = 0; k < 400; k++) {
                stepBattle(s, RULES.tick);
                max = Math.max(max, s.units.filter((u) => u.side === 'enemy' && u.engagedWith === 'a_hq').length);
            }
            return max;
        };
        expect(most()).toBe(3);
        expect(most({ specialRules: [{ type: 'narrow_frontage', zone: { rect: { x0: -60, x1: 60, z0: -60, z1: 60 } }, maxEngaged: 2 }] })).toBe(2);
        expect(most({ specialRules: [{ type: 'narrow_frontage', zone: { rect: { x0: -60, x1: 60, z0: -60, z1: 60 } }, maxEngaged: 1 }] })).toBe(1);
        // 区域の外なら絞らない
        expect(most({ specialRules: [{ type: 'narrow_frontage', zone: { rect: { x0: 100, x1: 140, z0: 100, z1: 140 } }, maxEngaged: 1 }] })).toBe(3);
    });
});

describe('援軍（早送り）', () => {
    it('arriveAt と出現地点で現れる。敵の援軍は知らせが出る', () => {
        const units = [...HQS(), U('a_r', 'ally', 'yari', 0, 140, { arriveAt: 10 }), U('e_r', 'enemy', 'yari', 0, -140, { arriveAt: 12, aiRole: 'hold_line' })];
        const s = createBattle(field([], units, { reinforcements: [{ id: 'ra', side: 'ally', unitIds: ['a_r'] }, { id: 're', side: 'enemy', unitIds: ['e_r'] }] }));
        advance(s, 9.9);
        expect(unitById(s, 'a_r')!.present).toBe(false);
        advance(s, 0.2);
        expect(unitById(s, 'a_r')!.present).toBe(true);
        expect(unitById(s, 'a_r')!.x).toBe(0);
        advance(s, 2);
        expect(unitById(s, 'e_r')!.present).toBe(true);
        expect(s.events.some((e) => e.kind === 'arrive' && e.text.includes('敵の援軍'))).toBe(true);
    });

    it('戦場のデータの援軍（山道・峠）：援軍の部隊は 180 秒で南の出現地点に現れ、BattleSetup.reinforcements に入る', () => {
        const setup = buildBattleSetup(getField('mountain_pass')!, 'standard');
        expect(setup.reinforcements).toEqual([{ id: 'relief', side: 'ally', unitIds: ['a_sakakibara', 'a_ishikawa'] }]);
        const r = setup.units.find((u) => u.id === 'a_ishikawa')!;
        expect(r.arriveAt).toBe(180);
        expect(r.z).toBe(195);
    });
});

describe('敵の考えの新しい役割（早送り）', () => {
    it('hold_zone：区域に入ってきた相手には当たる。区域の外を通る相手には出ない', () => {
        const mk = (allyZ: number) =>
            createBattle(field([], [...HQS(), U('a', 'ally', 'yari', 0, allyZ), U('g', 'enemy', 'yari', 0, -60, { aiRole: 'hold_zone', aiTarget: { x: 0, z: -60, r: 30 } })]));
        const far = mk(5); // 区域の中心から 65 m（30 + 10 より遠い）
        advance(far, 5);
        expect(unitById(far, 'g')!.order.type).not.toBe('attack');
        const near = mk(-25); // 35 m
        advance(near, 1);
        const o = unitById(near, 'g')!.order;
        expect(o.type === 'attack' && o.targetId === 'a').toBe(true);
    });

    it('assault：地点へ攻め進み、途中で近くに見えた相手に当たる', () => {
        const s = createBattle(field([], [U('a_hq', 'ally', 'honjin', -140, 140), U('e_hq', 'enemy', 'honjin', -140, -140, { aiRole: 'guard_hq' }), U('a', 'ally', 'yari', 45, 20), U('e', 'enemy', 'yari', 0, -120, { aiRole: 'assault', aiTarget: { x: 0, z: 100, r: 20 } })]));
        advance(s, 10);
        const e = unitById(s, 'e')!;
        expect(e.z).toBeGreaterThan(-110);
        expect(e.order.type).toBe('move');
        let hit: string | null = null;
        while (s.t < 60 && !hit) {
            stepBattle(s, RULES.tick);
            const o = unitById(s, 'e')!.order;
            if (o.type === 'attack') hit = o.targetId;
        }
        expect(hit).toBe('a');
    });

    it('assault は川を浅瀬で渡って地点へ着く（道探しに対応）', () => {
        const s = createBattle(field(RIVER, [...HQS(), U('e', 'enemy', 'yari', 0, -60, { aiRole: 'assault', aiTarget: { x: 0, z: 60, r: 20 } })]));
        const xs: number[] = [];
        while (s.t < 300) {
            stepBattle(s, RULES.tick);
            const e = unitById(s, 'e')!;
            expect(passableAt(s, e.x, e.z)).toBe(true);
            if (Math.abs(e.z) < 10) xs.push(e.x);
        }
        const e = unitById(s, 'e')!;
        expect(Math.hypot(e.x, e.z - 60)).toBeLessThan(20);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(89);
    });
});

describe('計算の重さ（早送り。ここでの値は開発機の目安で、実機の性能は確かめていない）', () => {
    it('通れない所のある戦場で 18 部隊（味方 8・敵 10）：1 刻みの計算は平均 3 ms 未満', () => {
        const f = getField('mountain_pass')!;
        const units = presetUnits(f, 'standard');
        units.push(
            { ...units.find((u) => u.id === 'a_sakai')!, id: 'a_extra1', name: '追加の槍 1', x: -40, z: 150, arriveAt: undefined },
            { ...units.find((u) => u.id === 'a_sakai')!, id: 'a_extra2', name: '追加の槍 2', x: 40, z: 150, arriveAt: undefined },
        );
        expect(units.filter((u) => u.side === 'ally')).toHaveLength(8);
        expect(units.filter((u) => u.side === 'enemy')).toHaveLength(10);
        const s = createBattle(buildBattleSetup(f, units));
        // 味方の全部隊が、見えている敵へ次々に攻めかかる（道を作り直し続ける重い場合）。
        // 測るのは、このテストの処理（vitest の 1 ファイル＝1 つの子プロセス）が使った CPU の時間（process.cpuUsage。無ければ経過時間）。
        // 負荷が高い（ほかの処理と CPU を取り合う）ときの経過時間は、CPU の順番を待つ時間を含んで何倍にも延び、計算の重さを表さないため
        // （第4群の確かめ：負荷 10 以上で経過時間が上限を超えた）。上限 3 ms はそのまま
        const cpu = (globalThis as { process?: { cpuUsage?: () => { user: number; system: number } } }).process?.cpuUsage;
        const now = () => {
            if (!cpu) return performance.now();
            const c = cpu();
            return (c.user + c.system) / 1000;
        };
        const t0 = now();
        runToEnd(s, (st) => {
            for (const u of st.units) {
                if (u.side !== 'ally' || !u.present || u.status !== 'ready' || u.order.type === 'attack') continue;
                const e = st.units.find((x) => x.side === 'enemy' && x.present && x.status === 'ready' && x.seenBy.ally);
                if (e) issueOrder(st, u.id, { type: 'attack', targetId: e.id });
            }
        });
        const perTick = (now() - t0) / s.tick;
        expect(perTick).toBeLessThan(3);
    }, 60_000);

    it('味方を避けた短い迂回の探索（sim.ts の tryAllyDetour）：長さの上限を渡すと、見つからない場合も格子の全体を探さない。見つかる道は上限なしと同じ', () => {
        const cpu = (globalThis as { process?: { cpuUsage?: () => { user: number; system: number } } }).process?.cpuUsage;
        const now = () => {
            if (!cpu) return performance.now();
            const c = cpu();
            return (c.user + c.system) / 1000;
        };
        const lenOf = (x: number, z: number, pts: { x: number; z: number }[] | null) => {
            let l = 0;
            for (const p of pts ?? []) {
                l += Math.hypot(p.x - x, p.z - z);
                x = p.x;
                z = p.z;
            }
            return l;
        };
        const cases: [string, [number, number], [number, number], { x: number; z: number; r: number }[]][] = [
            // 城下町外縁：大通りの北の口を塞ぐ味方と、両脇の口の味方（短い迂回は無い。上限なしでは格子の全体を探して 1 回 3 ms ほど）
            ['town_edge', [0, 60], [0, 190], [{ x: 0, z: 100, r: 20 }, { x: -137, z: 100, r: 12 }, { x: 140, z: 100, r: 12 }]],
            // 湖・河岸：岸の道の味方を内陸へよける（迂回がある）
            ['shore', [0, 0], [0, -200], [{ x: 0, z: -100, r: 30 }]],
        ];
        for (const [fid, a, b, avoid] of cases) {
            const f = getField(fid)!;
            const nav = createBattle(buildBattleSetup(f, 'standard')).field.nav!;
            const maxLen = lenOf(a[0], a[1], findPath(nav, 'yari', a[0], a[1], b[0], b[1])) * RULES.allyDetourRatio;
            const free = findPathAvoiding(nav, 'yari', a[0], a[1], b[0], b[1], avoid);
            const bounded = findPathAvoiding(nav, 'yari', a[0], a[1], b[0], b[1], avoid, maxLen);
            // 上限の内の道なら同じ道、上限を超える道しか無ければ null（tryAllyDetour はどちらも迂回にしない）
            if (free && lenOf(a[0], a[1], free) <= maxLen) expect(bounded).toEqual(free);
            else expect(bounded).toBeNull();
            // 1 回目の何回かは関数の下ごしらえ（JIT）の分だけ重いので、先に回してから測る
            for (let i = 0; i < 10; i++) findPathAvoiding(nav, 'yari', a[0], a[1], b[0], b[1], avoid, maxLen);
            const t0 = now();
            for (let i = 0; i < 40; i++) findPathAvoiding(nav, 'yari', a[0], a[1], b[0], b[1], avoid, maxLen);
            const per = (now() - t0) / 40;
            // 開発機の空いた時：城下町外縁 0.5 ms（上限なし 3.05 ms）・湖・河岸 0.35 ms
            expect(per, fid).toBeLessThan(1.5);
        }
    }, 60_000);
});
