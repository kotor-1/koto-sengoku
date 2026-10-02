/**
 * 第3群の共通の機能（docs/fields-group3-design.md §3）：障害物（building・fence・wall）・射線・門（制圧で開き、道を引き直す）・
 * 乾いた足場（dry）と湿地の泥の決まり（arrowDealMul・noCharge）・目標 hold_zones・limit_breakthrough・open_gate・sequence・検査。
 *
 * 確認の種類はテストの名前に書く：
 * - 「状態を直接操作」：部隊の位置を書き換えて、通れるか・射線・倍率を確かめる。
 * - 「早送り」：stepBattle・runToEnd で一気に進める（決まった時刻に命令を出す）。
 * 既存の 10 戦場（と国境の原）が新しい仕組みを持たないこと（射線の格子・門・乾いた足場が無い＝計算に入らない）もここで確かめる。
 * 1 刻みも同じことは tests/proto3d-battle-v11-identity.test.ts と既存の戦場のテストで確かめる。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, passableAt, rangedDamage, stepBattle, unitById, unitSpeedFactor, hasLineOfSight, RULES, type BattleState } from '../proto3d/src/battle/sim';
import { TERRAIN_DEFAULTS, createFieldEnv, lineOfSight, openAllGates, dealMulIn, takeMulIn } from '../proto3d/src/battle/fieldRules';
import { objectiveProgress } from '../proto3d/src/battle/objectives';
import { fieldRuleTexts, mapLabels, objectivePanelModel, objectiveSummaryText, objectiveZoneMarks } from '../proto3d/src/battle/control';
import { FIELDS, buildBattleSetup, fieldMap, fieldRulesOf, getField, validateField, type BattlefieldDef } from '../proto3d/src/battle/fields';
import { isPassable } from '../proto3d/src/battle/pathfind';
import type { BattleSetup, FieldRules, GateDef, ObjectiveDef, Side, TerrainArea, UnitDef, UnitKind } from '../proto3d/src/battle/types';

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
const run = (s: BattleState, sec: number, each?: (s: BattleState) => void) => {
    const end = s.t + sec;
    while (s.t < end - 1e-9 && !s.result) {
        each?.(s);
        stepBattle(s, RULES.tick);
    }
};

/** 真ん中を東西に横切る石垣（x -150〜-10・10〜150）と、真ん中の門（x -10〜10） */
const WALL: TerrainArea[] = [
    { kind: 'wall', rect: { x0: -150, x1: -10, z0: -6, z1: 6 }, height: 6 },
    { kind: 'wall', rect: { x0: 10, x1: 150, z0: -6, z1: 6 }, height: 6 },
];
const GATE: GateDef = { id: 'g', name: '試験の門', rect: { x0: -10, x1: 10, z0: -6, z1: 6 }, capture: { zone: { rect: { x0: -20, x1: 20, z0: 0, z1: 30 } }, sec: 10 } };

describe('障害物（building・fence・wall）', () => {
    it('状態を直接操作：家屋・柵・石垣は通れない（速さ 0）。障害物のある戦場は道探しの格子を作る。家屋・石垣は射線を遮り、柵は通す', () => {
        for (const k of ['building', 'fence', 'wall'] as const) expect(TERRAIN_DEFAULTS[k].speed).toBe(0);
        const terrain: TerrainArea[] = [
            { kind: 'building', rect: { x0: -40, x1: -20, z0: -10, z1: 10 }, height: 6 },
            { kind: 'fence', rect: { x0: 20, x1: 40, z0: -3, z1: 3 } },
        ];
        const s = createBattle(field(terrain, [...HQS(), U('a', 'ally', 'yumi', -30, 60), U('b', 'ally', 'yumi', 30, 60)]));
        expect(s.field.nav).not.toBeNull();
        expect(s.field.los).not.toBeNull();
        expect(passableAt(s, -30, 0)).toBe(false);
        expect(passableAt(s, 30, 0)).toBe(false);
        expect(passableAt(s, 0, 0)).toBe(true);
        // 家屋の陰（北）の相手は射線が通らない。柵越しの相手は通る
        expect(lineOfSight(s.map, s.field, { x: -30, z: 40 }, { x: -30, z: -40 })).toBe(false);
        expect(lineOfSight(s.map, s.field, { x: 30, z: 40 }, { x: 30, z: -40 })).toBe(true);
        // 家屋の脇を通る線分は通る
        expect(lineOfSight(s.map, s.field, { x: -60, z: 40 }, { x: -60, z: -40 })).toBe(true);
    });

    it('早送り：家屋の向こうへの移動は、家屋を回って着く（家屋の中へは一度も入らない）', () => {
        const terrain: TerrainArea[] = [{ kind: 'building', rect: { x0: -60, x1: 60, z0: -10, z1: 10 }, height: 6 }];
        const s = createBattle(field(terrain, [...HQS(), U('a', 'ally', 'yari', 0, 60)]));
        expect(issueOrder(s, 'a', { type: 'move', x: 0, z: -60 })).toBe(true);
        let inside = 0;
        run(s, 120, (st) => {
            const u = unitById(st, 'a')!;
            if (!isPassable(st.field.nav!, u.x, u.z)) inside++;
        });
        const u = unitById(s, 'a')!;
        expect(inside).toBe(0);
        expect(Math.hypot(u.x, u.z + 60)).toBeLessThan(5);
    });

    it('状態を直接操作：高い所（丘の上）の射手は、遮る物より線分が高ければ越えて射る（データの高さで決まる）', () => {
        const terrain: TerrainArea[] = [
            { kind: 'wall', rect: { x0: -100, x1: 100, z0: -3, z1: 3 }, height: 6 },
            { kind: 'hill', rect: { x0: -10, x1: 10, z0: 8, z1: 28 }, height: 10 },
        ];
        const s = createBattle(field(terrain, HQS()));
        // 地面から地面へは遮られる
        expect(lineOfSight(s.map, s.field, { x: 50, z: 30 }, { x: 50, z: -40 })).toBe(false);
        // 高台（10 m）の上から、石垣のすぐ先の相手へは越える（線分は石垣の所で 6 m より高い）
        expect(lineOfSight(s.map, s.field, { x: 0, z: 12 }, { x: 0, z: -20 })).toBe(true);
        // 高さ 12 m の石垣なら越えられない
        const s2 = createBattle(field([{ ...terrain[0]!, height: 12 }, terrain[1]!], HQS()));
        expect(lineOfSight(s2.map, s2.field, { x: 0, z: 12 }, { x: 0, z: -20 })).toBe(false);
    });

    it('早送り：待機の弓は、射線が遮られた相手を射ない（届く距離でも）。攻撃の命令の弓は、射線が通る所まで回り込んで射る', () => {
        const terrain: TerrainArea[] = [{ kind: 'building', rect: { x0: -20, x1: 20, z0: -10, z1: 10 }, height: 6 }];
        // 家屋の真南の弓と、真北の敵の槍（60 m 先。家屋の陰）
        const s = createBattle(field(terrain, [...HQS(), U('a_yumi', 'ally', 'yumi', 0, 30), U('e_yari', 'enemy', 'yari', 0, -30, { aiRole: 'hold_line' })]));
        run(s, 5);
        expect(unitById(s, 'a_yumi')!.shootingAt).toBeNull();
        expect(unitById(s, 'e_yari')!.strength).toBe(300);
        expect(hasLineOfSight(s, unitById(s, 'a_yumi')!, unitById(s, 'e_yari')!)).toBe(false);
        // 攻撃を命じると、射線が通る所まで動いて射る
        expect(issueOrder(s, 'a_yumi', { type: 'attack', targetId: 'e_yari' })).toBe(true);
        let shotAt = -1;
        let losWhenShooting = true;
        run(s, 40, (st) => {
            const a = unitById(st, 'a_yumi')!;
            if (a.shootingAt !== 'e_yari') return;
            if (shotAt < 0) shotAt = st.t;
            if (!hasLineOfSight(st, a, unitById(st, 'e_yari')!)) losWhenShooting = false;
        });
        // 家屋の脇の射ち場へ回って、20 秒ほどで射始める（射っている刻みは、いつも射線が通っている）
        expect(shotAt).toBeGreaterThan(0);
        expect(shotAt).toBeLessThan(25);
        expect(losWhenShooting).toBe(true);
        expect(unitById(s, 'e_yari')!.strength).toBeLessThan(300);
    });

    it('早送り：敵の攻め進む弓（assault）も、射線が遮られた相手では止まらず地点へ進む', () => {
        const terrain: TerrainArea[] = [{ kind: 'building', rect: { x0: -30, x1: 30, z0: -10, z1: 10 }, height: 6 }];
        const s = createBattle(field(terrain, [...HQS(), U('a_yari', 'ally', 'yari', 0, 40), U('e_yumi', 'enemy', 'yumi', 0, -40, { aiRole: 'assault', aiTarget: { x: 80, z: 0, r: 10 } })]));
        run(s, 3);
        // 届く距離（80 m）だが家屋の陰：止まって待機にならず、地点へ動く
        expect(unitById(s, 'e_yumi')!.order.type).toBe('move');
    });
});

describe('門（gates）', () => {
    const units = () => [...HQS(), U('a1', 'ally', 'yari', 0, 60), U('a2', 'ally', 'yari', 40, 60), U('e_far', 'enemy', 'yari', 140, -140, { aiRole: 'hold_line' })];
    it('状態を直接操作：閉じた門は通れず射線を遮る。開くと通れる・射線が通る', () => {
        const s = createBattle(field(WALL, units(), { fieldRules: { gates: [GATE] } }));
        expect(passableAt(s, 0, 0)).toBe(false);
        expect(lineOfSight(s.map, s.field, { x: 0, z: 30 }, { x: 0, z: -30 })).toBe(false);
        openAllGates(s.map, s.field);
        expect(passableAt(s, 0, 0)).toBe(true);
        expect(lineOfSight(s.map, s.field, { x: 0, z: 30 }, { x: 0, z: -30 })).toBe(true);
    });

    it('早送り：門の前の輪を敵なしで 10 秒占めると開く（輪に戦える敵がいる間は数えない）。開いたら、閉じた門の前で押し付けられていた部隊の道を引き直して、門の向こうへ着く', () => {
        const s = createBattle(
            field(WALL, [...units(), U('e1', 'enemy', 'yari', 0, 18, { aiRole: 'hold_line', strength: 120, morale: 40 })], {
                fieldRules: { gates: [GATE] },
            }),
        );
        // a2 を門の向こう（北）へ：輪の中の敵 e1 に当たり、追い払ってから門の前で押し付けられる（閉じている間は道が無い）
        issueOrder(s, 'a2', { type: 'move', x: 0, z: -60 });
        let secWhileEnemy = 0;
        let maxSec = 0;
        let routedT = -1;
        run(s, 120, (st) => {
            const g = st.field.gates[0]!;
            const e = unitById(st, 'e1')!;
            if (e.status === 'ready') secWhileEnemy = Math.max(secWhileEnemy, g.sec);
            else if (routedT < 0) routedT = st.t;
            maxSec = Math.max(maxSec, g.sec);
        });
        const g = s.field.gates[0]!;
        expect(routedT).toBeGreaterThan(0);
        expect(secWhileEnemy).toBe(0);
        expect(g.open).toBe(true);
        expect(maxSec).toBeGreaterThanOrEqual(10 - 1e-6);
        // 開いたのは、敵を追い払って 10 秒より後
        expect(g.openedT!).toBeGreaterThanOrEqual(routedT + 10 - 1e-6);
        expect(s.events.some((e) => e.kind === 'objective' && e.text.includes('試験の門を制圧した'))).toBe(true);
        // 出来事に制圧の進み：占め始めた（条件の秒数つき）。知らせは同じ門で 20 秒に 1 回まで
        const starts = s.events.filter((e) => e.kind === 'objective' && e.text === '試験の門の前の輪を占めた。敵を入れずに 10 秒続けると開く');
        expect(starts.length).toBeGreaterThanOrEqual(1);
        for (let i = 1; i < starts.length; i++) expect(starts[i]!.t - starts[i - 1]!.t).toBeGreaterThanOrEqual(20 - 1e-6);
        // 開いた後は、門の前にいた a2 が門を抜けて北の行き先へ着く（詰まらない）
        run(s, 60);
        expect(unitById(s, 'a2')!.z).toBeLessThan(-40);
    });

    it('早送り：開く刻みに、進んでいる道（行き先が門の向こうの部隊の道）をすべて引き直す。2 部隊とも門をくぐって北へ着く', () => {
        const s = createBattle(field(WALL, units(), { fieldRules: { gates: [GATE] } }));
        issueOrder(s, 'a1', { type: 'move', x: 0, z: 18 });
        run(s, 20);
        // 輪の中の a1 が数えている間に、a2 を門の向こうへ（まだ閉じている）
        issueOrder(s, 'a2', { type: 'move', x: 30, z: -80 });
        let cleared = false;
        run(s, 30, (st) => {
            if (st.field.gates[0]!.open && st.field.gates[0]!.openedT === st.t && !unitById(st, 'a2')!.path) cleared = true;
        });
        expect(s.field.gates[0]!.open).toBe(true);
        expect(cleared).toBe(true);
        issueOrder(s, 'a1', { type: 'move', x: -20, z: -80 });
        run(s, 90);
        expect(unitById(s, 'a1')!.z).toBeLessThan(-60);
        expect(unitById(s, 'a2')!.z).toBeLessThan(-60);
    });

    it('早送り：制圧の途中で輪に敵が入ると、数えた秒数は 0 に戻り「制圧が途切れた」と出来事に出る', () => {
        const s = createBattle(field(WALL, [...units(), U('e2', 'enemy', 'yari', 120, 20, { aiRole: 'hold_line' })], { fieldRules: { gates: [GATE] } }));
        issueOrder(s, 'a1', { type: 'move', x: 0, z: 18 });
        let counted = 0;
        run(s, 40, (st) => {
            const g = st.field.gates[0]!;
            counted = Math.max(counted, g.sec);
            // 5 秒数えたところで、敵を輪の中へ置く（状態を直接操作）
            if (g.sec >= 5 && g.sec < 5 + RULES.tick) {
                const e = unitById(st, 'e2')!;
                e.x = 15;
                e.z = 25;
            }
        });
        expect(counted).toBeGreaterThanOrEqual(5);
        expect(s.events.some((e) => e.kind === 'objective' && /^試験の門の制圧が途切れた（5／10 秒。輪に敵が入った）$/.test(e.text))).toBe(true);
    });

    it('検査：門の制圧の区域へ道が無い・門の面に届いていない・門が格子に載らない・門を開いても壁で塞がれている、を見つける', () => {
        const base = getField('siege_front')!;
        const bad1: BattlefieldDef = structuredClone(base);
        bad1.gates![0]!.capture.zone = { rect: { x0: -10, x1: 10, z0: -120, z1: -100 } }; // 曲輪の中（閉じた格子では行けない）
        expect(validateField(bad1).some((t) => t.includes('制圧の区域へ ally の退き口から道がない'))).toBe(true);
        const bad2: BattlefieldDef = structuredClone(base);
        bad2.gates![0]!.rect = { x0: -10, x1: 10, z0: -60, z1: -58 };
        expect(validateField(bad2).some((t) => t.includes('細すぎて格子の升に載らない'))).toBe(true);
        const bad4: BattlefieldDef = structuredClone(base);
        bad4.gates![0]!.capture.zone = { rect: { x0: -24, x1: 24, z0: -50, z1: -30 } };
        expect(validateField(bad4).some((t) => t.includes('制圧の区域が門の面に届いていない'))).toBe(true);
        const bad3: BattlefieldDef = structuredClone(base);
        bad3.terrain.push({ kind: 'wall', rect: { x0: -12, x1: 12, z0: -66, z1: -56 } });
        expect(validateField(bad3).some((t) => t.includes('開いても門の所が通れない'))).toBe(true);
    });
});

describe('乾いた足場（dry）と湿地の泥（arrowDealMul・noCharge）', () => {
    const terrain: TerrainArea[] = [
        { kind: 'marsh', rect: { x0: -150, x1: 150, z0: -50, z1: 50 } },
        { kind: 'dry', circle: { cx: 60, cz: 0, r: 20 } },
        { kind: 'dry', rect: { x0: -6, x1: 6, z0: -50, z1: 50 } },
        { kind: 'road', rect: { x0: -5, x1: 5, z0: -150, z1: 150 } },
    ];
    const rules: FieldRules = { terrainRules: { marsh: { kindSpeed: { kiba: 0.6 }, arrowDealMul: 0.7, noCharge: true } } };
    it('状態を直接操作：泥の中は ×0.35（騎馬 ×0.21）、乾いた足場は普通の地面（×1・斬り合いの倍率も 1）、土手道（dry に road）は ×1.2', () => {
        const s = createBattle(field(terrain, [...HQS(), U('mud', 'ally', 'kiba', -60, 0), U('isle', 'ally', 'kiba', 60, 0), U('dyke', 'ally', 'yari', 0, 0), U('mud2', 'ally', 'yari', -90, 0)], { fieldRules: rules }));
        expect(unitSpeedFactor(s, unitById(s, 'mud')!)).toBeCloseTo(0.35 * 0.6, 10);
        expect(unitSpeedFactor(s, unitById(s, 'mud2')!)).toBeCloseTo(0.35, 10);
        expect(unitSpeedFactor(s, unitById(s, 'isle')!)).toBe(1);
        expect(unitSpeedFactor(s, unitById(s, 'dyke')!)).toBeCloseTo(1.2, 10);
        expect(dealMulIn(s.map, s.field, 60, 0)).toBe(1);
        expect(takeMulIn(s.map, s.field, 60, 0)).toBe(1);
        expect(dealMulIn(s.map, s.field, -60, 0)).toBeCloseTo(0.8, 10);
        expect(takeMulIn(s.map, s.field, -60, 0)).toBeCloseTo(1.15, 10);
    });

    it('状態を直接操作：泥の中の弓の矢は ×0.7、乾いた足場の上の弓は ×1（同じ相手・同じ距離）', () => {
        const s = createBattle(field(terrain, [...HQS(), U('y_mud', 'ally', 'yumi', -60, 0), U('y_isle', 'ally', 'yumi', 60, 0), U('e', 'enemy', 'yari', 0, -100)], { fieldRules: rules }));
        const e = unitById(s, 'e')!;
        const mud = unitById(s, 'y_mud')!;
        const isle = unitById(s, 'y_isle')!;
        // 同じ距離に置き直して比べる
        e.x = 0;
        e.z = -60;
        mud.x = -60;
        mud.z = 0;
        isle.x = 60;
        isle.z = 0;
        expect(rangedDamage(s, mud, e) / rangedDamage(s, isle, e)).toBeCloseTo(0.7, 10);
    });

    it('早送り：泥の中から駆け込む騎馬は突撃にならない。乾いた足場から駆け込む騎馬は突撃になる', () => {
        const charged = (x: number) => {
            const s = createBattle(field(terrain, [...HQS(), U('k', 'ally', 'kiba', x, 30), U('e', 'enemy', 'yumi', x, -5, { aiRole: 'hold_line' })], { fieldRules: rules }));
            issueOrder(s, 'k', { type: 'attack', targetId: 'e' });
            run(s, 30);
            return s.events.some((ev) => ev.kind === 'charge');
        };
        expect(charged(-60)).toBe(false);
        expect(charged(60)).toBe(true);
    });
});

describe('目標の種類（第3群）', () => {
    it('早送り：hold_zones（mode all）は、すべての区域を敵なしで同時に占めて sec 秒。どれか 1 つが外れると 0 から', () => {
        const zones = [{ circle: { cx: -60, cz: 0, r: 15 } }, { circle: { cx: 60, cz: 0, r: 15 } }];
        const primary: ObjectiveDef = { id: 'hz', type: 'hold_zones', label: '二所', zones, sec: 20, mode: 'all', names: ['西', '東'] };
        const s = createBattle(field([], [...HQS(), U('a1', 'ally', 'yari', -60, 30), U('a2', 'ally', 'yari', 60, 30)], { objectives: { primary, secondary: [] } }));
        issueOrder(s, 'a1', { type: 'move', x: -60, z: 0 });
        run(s, 40);
        const r = s.objectives!.primary!;
        expect(r.sec).toBe(0);
        expect(objectiveProgress(s)[0]!.progressText).toContain('西 ○・東 空');
        issueOrder(s, 'a2', { type: 'move', x: 60, z: 0 });
        run(s, 15);
        expect(r.sec).toBeGreaterThan(0);
        // 片方を離すと 0 に戻る
        issueOrder(s, 'a1', { type: 'move', x: -60, z: 60 });
        run(s, 20);
        expect(r.sec).toBe(0);
        issueOrder(s, 'a1', { type: 'move', x: -60, z: 0 });
        run(s, 60);
        expect(s.result?.result).toBe('victory');
        expect(s.result?.reason).toBe('objective_done');
    });

    it('早送り：limit_breakthrough は部隊単位で数える（兵の人数によらない）。抜けた敵の部隊は戦場を離れる。許容を超えたら負け', () => {
        const exits = [{ rect: { x0: -40, x1: 40, z0: 120, z1: 150 } }];
        const primary: ObjectiveDef = { id: 'lb', type: 'limit_breakthrough', label: '抜かせない', exits, maxCount: 1, untilSec: 300, names: ['南の口'] };
        const raider = (id: string, strength: number, x: number) => U(id, 'enemy', 'yari', x, -100, { strength, aiRole: 'assault', aiTarget: { x, z: 135, r: 5 } });
        const s = createBattle(field([], [...HQS(), raider('big', 900, -20), { ...raider('small', 30, 20), z: -40 }], { objectives: { primary, secondary: [] } }));
        const txt: string[] = [];
        run(s, 200, (st) => txt.push(objectiveProgress(st)[0]!.progressText));
        expect(txt.some((t) => /突破 1／許容 1（あと 0）/.test(t))).toBe(true);
        expect(s.result?.result).toBe('defeat');
        expect(s.result?.reason).toBe('objective_failed');
        expect([...s.objectives!.primary!.entered].sort()).toEqual(['big', 'small']);
        expect(unitById(s, 'big')!.status).toBe('withdrawn');
        expect(unitById(s, 'small')!.present).toBe(false);
    });

    it('早送り：limit_breakthrough は、締めの時刻（untilSec）まで許容以内なら果たす。攻め手がすべて抜けた・崩れた時も果たす', () => {
        const exits = [{ rect: { x0: -40, x1: 40, z0: 120, z1: 150 } }];
        const until: ObjectiveDef = { id: 'lb', type: 'limit_breakthrough', label: '抜かせない', exits, maxCount: 2, untilSec: 30 };
        const s = createBattle(field([], [...HQS(), U('r', 'enemy', 'yari', 0, -140, { aiRole: 'assault', aiTarget: { x: 0, z: 135, r: 5 } })], { objectives: { primary: until, secondary: [] } }));
        run(s, 40);
        expect(s.result?.result).toBe('victory');
        expect(s.result?.elapsedSec).toBeCloseTo(30, 5);
        const all: ObjectiveDef = { id: 'lb', type: 'limit_breakthrough', label: '抜かせない', exits, maxCount: 2, untilSec: 600 };
        const s2 = createBattle(field([], [...HQS(), U('r', 'enemy', 'yari', 0, 60, { aiRole: 'assault', aiTarget: { x: 0, z: 135, r: 5 } })], { objectives: { primary: all, secondary: [] } }));
        run(s2, 120);
        // 1 部隊だけ抜けて、残る攻め手がいない → 許容（2）以内で果たす
        expect(s2.result?.result).toBe('victory');
        expect(s2.objectives!.primary!.entered).toEqual(['r']);
    });

    it('早送り：sequence（open_gate → hold_point）。段の進みの文に今の段と次の段。結果にどの段まで届いたか', () => {
        const primary: ObjectiveDef = {
            id: 'seq',
            type: 'sequence',
            label: '門から奥へ',
            steps: [
                { id: 's1', type: 'open_gate', label: '門の制圧', gateId: 'g' },
                { id: 's2', type: 'hold_point', label: '奥の確保', zone: { circle: { cx: 0, cz: -60, r: 20 } }, sec: 15 },
            ],
        };
        const mk = () => createBattle(field(WALL, [...HQS(), U('a1', 'ally', 'yari', 0, 60)], { fieldRules: { gates: [GATE] }, objectives: { primary, secondary: [] }, timeLimitSec: 200 }));
        const s = mk();
        const t0 = objectiveProgress(s)[0]!.progressText;
        expect(t0).toContain('段階 1／2：門の制圧');
        expect(t0).toContain('（次：奥の確保）');
        issueOrder(s, 'a1', { type: 'move', x: 0, z: 18 });
        run(s, 40);
        expect(s.objectives!.primary!.stepIdx).toBe(1);
        expect(objectiveProgress(s)[0]!.progressText).toContain('段階 2／2：奥の確保');
        expect(s.events.some((e) => e.text.includes('段階 1「門の制圧」を果たした'))).toBe(true);
        issueOrder(s, 'a1', { type: 'move', x: 0, z: -60 });
        run(s, 80);
        expect(s.result?.result).toBe('victory');
        expect(s.result?.objectives?.primary).toMatchObject({ id: 'seq', type: 'sequence', achieved: true, steps: { done: 2, total: 2 } });
        // 門を開かずに日没：1 段も届いていない
        const s2 = mk();
        run(s2, 210);
        expect(s2.result?.reason).toBe('nightfall');
        expect(s2.result?.objectives?.primary).toMatchObject({ achieved: false, steps: { done: 0, total: 2 } });
    });

    it('早送り：breakthrough は戦える部隊だけを数える（敗走中に区域へ入った部隊は数えない）', () => {
        const primary: ObjectiveDef = { id: 'bt', type: 'breakthrough', label: '抜ける', zone: { rect: { x0: -100, x1: 150, z0: 130, z1: 150 } }, count: 1 };
        const s = createBattle(field([], [...HQS(), U('a1', 'ally', 'yari', 0, 100, { morale: 10 }), U('a2', 'ally', 'yari', 60, -100)], { objectives: { primary, secondary: [] } }));
        // a1 は士気 10（敗走の線 15 以下）：最初の刻みで敗走し、南の退き口（区域の中）へ逃げる
        run(s, 30);
        expect(unitById(s, 'a1')!.status).not.toBe('ready');
        expect(s.objectives!.primary!.entered).toEqual([]);
        expect(s.result).toBeNull();
    });

    it('画面の文：突破の見出しは畳んでも「突破 n／許容 m（あと k）」が残る。地図の印に出口・二所・段ごとの区域・門の制圧の区域が出る', () => {
        const s = createBattle(buildBattleSetup(getField('town_edge')!, 'standard'));
        const p = objectivePanelModel(s)!;
        expect(objectiveSummaryText(p.primary)).toMatch(/^突破 0／許容 2（あと 2）・残り \d+ 秒$/);
        expect(objectiveZoneMarks(s).filter((m) => m.role === 'primary').map((m) => m.name)).toEqual(['大通りの出口', '西の脇道の出口', '東の門口の出口']);
        const t = createBattle(buildBattleSetup(getField('temple')!, 'standard'));
        expect(objectiveZoneMarks(t).filter((m) => m.role === 'primary').map((m) => m.name)).toEqual(['山門', '本堂前']);
        const g = createBattle(buildBattleSetup(getField('siege_front')!, 'standard'));
        expect(objectiveZoneMarks(g).filter((m) => m.role === 'primary').map((m) => m.name)).toEqual(['段階 1・外門の制圧（輪を敵なしで 20 秒）', '段階 2・確保する地点']);
        expect(objectivePanelModel(g)!.primary!.progressText).toContain('外門 制圧 0／20 秒');
        // 門の制圧が目標の門は、目標の輪の名札に条件を書き、門の名札は出さない。目標でない門は門の名札を出す
        expect(mapLabels(g).some((l) => l.text === '主目標：段階 1・外門の制圧（輪を敵なしで 20 秒）')).toBe(true);
        expect(mapLabels(g).some((l) => l.id.startsWith('gate-'))).toBe(false);
        const ng = createBattle({ ...buildBattleSetup(getField('siege_front')!, 'standard'), objectives: undefined });
        expect(mapLabels(ng).some((l) => l.text === '外門：前の輪を敵なしで 20 秒占めると開く')).toBe(true);
        expect(fieldRuleTexts(g).some((x) => x.startsWith('外門：閉じている間は通れず、矢も通さない。前の輪を敵なしで 20 秒占めると開く'))).toBe(true);
    });

    it('地図の名札：同じ所から何度も出る援軍は 1 つの名札に時刻を並べ、出る所が 2 つ以上なら退き口・ほかの援軍の名札と重ならないようにずらす。出る所が 1 つの戦場は今までの所', () => {
        // 重なり：南北 12 m 以内で、東西の隔たりが 2 つの名札の字数 × 4.5 m より近い（全体を見る視点の北の端で 1 m ≒ 1.3 px・1 字 ≒ 12 px）
        const clash = (a: { x: number; z: number; text: string }, b: { x: number; z: number; text: string }) =>
            Math.abs(a.z - b.z) < 12 && Math.abs(a.x - b.x) < (a.text.length + b.text.length) * 4.5;
        for (const f of FIELDS) {
            const s = createBattle(buildBattleSetup(f, f.presets[0]!.id));
            const labels = mapLabels(s);
            const rl = labels.filter((l) => l.id.startsWith('reinf-'));
            const pts = new Set((f.reinforcements ?? []).map((r) => `${r.point.x},${r.point.z}`)).size;
            if (pts >= 2) {
                for (const r of rl) for (const l of labels) if (l !== r && (l.id.startsWith('reinf-') || l.id.startsWith('exit-'))) expect(clash(r, l), `${f.id} ${r.text} と ${l.text}`).toBe(false);
            }
            if (pts === 1) {
                // 今までと同じ所（出る所の西 70 m・北 4 m）
                const r = f.reinforcements![0]!;
                expect(rl.length).toBe(1);
                expect(rl[0]!.x).toBeCloseTo(Math.max(r.point.x - 70, -s.map.width / 2 + 30), 5);
                expect(rl[0]!.z).toBeCloseTo(r.point.z - 4, 5);
            }
        }
        const town = mapLabels(createBattle(buildBattleSetup(getField('town_edge')!, 'standard'))).filter((l) => l.id.startsWith('reinf-'));
        // 大通りの出る所 (0,-195) は 3 回（m1・m2・m4）を 1 つの名札に
        expect(town.length).toBe(3);
        expect(town.some((l) => /^援軍の出る所（開始 \d+:\d\d・\d+:\d\d・\d+:\d\d）$/.test(l.text))).toBe(true);
    });
});

describe('検査（validateField）', () => {
    it('障害物が細すぎて格子に載らない・配置の枠が障害物に塞がれている・段階目標の 2 段目の区域へ（門を開いても）道が無い・増援を含めた部隊数の上限', () => {
        const thin: BattlefieldDef = structuredClone(getField('village')!);
        thin.terrain.push({ kind: 'fence', rect: { x0: 100, x1: 130, z0: 150, z1: 152 } });
        expect(validateField(thin).some((t) => t.includes('細すぎて格子'))).toBe(true);
        const boxed: BattlefieldDef = structuredClone(getField('village')!);
        boxed.terrain.push({ kind: 'building', rect: { x0: -14, x1: -6, z0: 120, z1: 150 } }, { kind: 'building', rect: { x0: 6, x1: 14, z0: 120, z1: 150 } });
        expect(validateField(boxed).some((t) => t.includes('配置の枠 center のまわりが障害物で塞がれている'))).toBe(true);
        const seq: BattlefieldDef = structuredClone(getField('siege_front')!);
        const st = (seq.objectives.primary as Extract<ObjectiveDef, { type: 'sequence' }>).steps[1] as Extract<ObjectiveDef, { type: 'hold_point' }>;
        st.zone = { circle: { cx: 0, cz: -205, r: 10 } }; // 内の石垣の北（門が無い）
        expect(validateField(seq).some((t) => t.includes('段 2（siege_bailey）') && t.includes('門を開いた後'))).toBe(true);
        const many: BattlefieldDef = structuredClone(getField('village')!);
        const pr = many.presets[0]!;
        pr.units.push({ ...pr.units.find((u) => u.id === 'e_w_kiba')!, id: 'e_extra' }, { ...pr.units.find((u) => u.id === 'e_w_kiba')!, id: 'e_extra2' });
        expect(validateField(many).some((t) => t.includes('enemy の部隊が 11（増援を含めて同時に戦場にいる数の上限 10）'))).toBe(true);
    });

    it('全 16 戦場（演習の 15 と国境の原）が検査を通る。第3群の 5 戦場は部隊数の上限内（増援を含めて味方 8・敵 10）', () => {
        for (const f of FIELDS) expect([f.id, validateField(f)]).toEqual([f.id, []]);
        for (const id of ['marsh', 'village', 'temple', 'town_edge', 'siege_front']) {
            const f = getField(id)!;
            for (const pr of f.presets) {
                expect(pr.units.filter((u) => u.side === 'ally').length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.ally);
                expect(pr.units.filter((u) => u.side === 'enemy').length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.enemy);
            }
        }
    });
});

describe('既存の戦場は新しい仕組みを持たない（計算に入らない）', () => {
    it('状態を直接操作：既存の 10 戦場と国境の原は、射線の格子・門・乾いた足場・泥の弓・突撃の決まりが無い', () => {
        const old = FIELDS.filter((f) => !['marsh', 'village', 'temple', 'town_edge', 'siege_front'].includes(f.id));
        expect(old).toHaveLength(11);
        for (const f of old) {
            const env = createFieldEnv(fieldMap(f), fieldRulesOf(f));
            expect([f.id, env.los, env.gates.length, env.dry, env.arrowDealKinds.length, env.noChargeKinds.length]).toEqual([f.id, null, 0, false, 0, 0]);
            expect(f.terrain.some((a) => ['building', 'fence', 'wall', 'dry'].includes(a.kind))).toBe(false);
        }
    });
});
