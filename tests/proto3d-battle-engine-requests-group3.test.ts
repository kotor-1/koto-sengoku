/**
 * 第3群の戦場の調整役から出たエンジンの要望への対応（共通の機能。戦場の id では分けない）：
 * - 建物・塀の角の手前の行き詰まり：射線の通らない相手には「14 m より近づかない」決まりを効かせない（sim.ts の moveUnit）。
 * - 射線：両端の点を含む升は見ない（fieldRules.ts の lineOfSight。建物の縁が格子の線からずれていても、外に立つ部隊の射線が切れない）。
 * - 敗走の部隊の退き口へ道が無い（閉じた門の外）なら、その場から逃れ去る（FieldRules.refinedMoves）。
 * - break_unit：limit_breakthrough の出口を抜けた部隊は崩したことにしない（objectives.ts）。
 * - validateField：building・wall・門の射線を遮る高さ（高さ 0 からの値）が、その所の地面の高さ＋目の高さ以下なら知らせる。
 * - 第3群の動きの直し（FieldRules.refinedMoves。既存の 10 戦場は keepGroup2Movement で付けず、1 刻みも同じ）：
 *   道探しの泥の升の選び直し・泥から出る道の上限 1.1 倍（pathfind.ts）、泥の中では着いたことにしない、止まっている味方に塞がれて
 *   20 秒進めない移動・攻撃は味方の中をすり抜ける、遠くで行き詰まって待機にするときは知らせる（sim.ts）。
 *
 * 確かめの種類はテストの名前に書く：「状態を直接操作」（部隊の位置・士気を書き換える・格子を直に読む）、「早送り」（stepBattle で進める）。
 */
import { describe, expect, it } from 'vitest';
import { RULES, createBattle, issueOrder, stepBattle, unitById, type BattleState } from '../proto3d/src/battle/sim';
import { createFieldEnv, lineOfSight } from '../proto3d/src/battle/fieldRules';
import { findPath, isPassable } from '../proto3d/src/battle/pathfind';
import { FIELDS, fieldMap, fieldRulesOf, getField, validateField, type BattlefieldDef } from '../proto3d/src/battle/fields';
import type { BattleSetup, FieldRules, GateDef, Side, TerrainArea, UnitDef, UnitKind } from '../proto3d/src/battle/types';

function field(terrain: TerrainArea[], units: UnitDef[], rules: FieldRules = {}, extra: Partial<BattleSetup> = {}): BattleSetup {
    return {
        map: { id: 'test', name: '試験の原', width: 300, depth: 300, terrain, exits: { ally: { x: 0, z: 150 }, enemy: { x: 0, z: -150 } } },
        units,
        timeLimitSec: 900,
        briefing: [],
        fieldRules: { pathfinding: true, settleMoves: true, ...rules },
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
        stepBattle(s, RULES.tick);
        each?.(s);
    }
};
const G3 = ['marsh', 'village', 'temple', 'town_edge', 'siege_front'];

describe('第3群の動きの直しを付ける戦場（FieldRules.refinedMoves）', () => {
    it('状態を直接操作：第3群の 5 戦場だけに付く。既存の 10 戦場（keepGroup2Movement）と国境の原（keepV11Movement）には付かない', () => {
        for (const f of FIELDS) {
            const on = !!fieldRulesOf(f)?.refinedMoves;
            expect([f.id, on]).toEqual([f.id, G3.includes(f.id)]);
            expect([f.id, createFieldEnv(fieldMap(f), fieldRulesOf(f)).refined]).toEqual([f.id, G3.includes(f.id)]);
        }
        expect(FIELDS.filter((f) => f.keepGroup2Movement).length).toBe(10);
    });
});

describe('建物の角の手前の行き詰まり（村落・城下町外縁の要望）', () => {
    // 北西の四角い家屋（x -60〜0・z -60〜0）の南東の角 (0,0) を挟んで、斜めに隣り合う二部隊（中心どうしの線が角で切れる）
    const HOUSE: TerrainArea[] = [{ kind: 'building', rect: { x0: -60, x1: 0, z0: -60, z1: 0 } }];
    const PAIRS: [number, number, number, number][] = [
        [-10, 8, 8, -10],
        [-6, 5, 5, -6],
        [-12, 4, 4, -12],
        [-15, 6, 6, -15],
    ];

    it('早送り：角を挟んで 14 m ほどに止まった攻め手は、角を回って斬り合う（直す前は、射線が無く斬り合わず、14 m より近づけず止まった）', () => {
        for (const [ax, az, ex, ez] of PAIRS) {
            for (const ek of ['yari', 'kiba'] as UnitKind[]) {
                const s = createBattle(field(HOUSE, [...HQS(), U('a', 'ally', 'yari', ax, az), U('e', 'enemy', ek, ex, ez, { aiRole: 'hold_line' })]));
                expect(lineOfSight(s.map, s.field, { x: ax, z: az }, { x: ex, z: ez })).toBe(false);
                issueOrder(s, 'a', { type: 'attack', targetId: 'e' });
                let fought = -1;
                run(s, 60, (st) => {
                    if (fought < 0 && unitById(st, 'a')!.engagedWith === 'e') fought = st.t;
                });
                expect([ax, az, ex, ez, ek, fought > 0]).toEqual([ax, az, ex, ez, ek, true]);
            }
        }
    });

    it('早送り：斬り合うのは射線が通ってから（家屋をまっすぐ挟んだ相手とは、今までどおり斬り合わない）', () => {
        const s = createBattle(field(HOUSE, [...HQS(), U('a', 'ally', 'yari', -30, 12), U('e', 'enemy', 'yari', -30, -72, { aiRole: 'hold_line' })]));
        issueOrder(s, 'a', { type: 'hold' });
        let across = 0;
        run(s, 20, (st) => {
            const a = unitById(st, 'a')!;
            const e = unitById(st, 'e')!;
            if (a.engagedWith === 'e' && !lineOfSight(st.map, st.field, a, e)) across++;
        });
        expect(across).toBe(0);
        expect(unitById(s, 'a')!.engagedWith).toBeNull();
    });
});

describe('射線：両端の点を含む升は見ない', () => {
    it('状態を直接操作：家屋の縁（x 3）が格子の線（x 0・5）からずれ、家屋の外の点 (4,0) が「家屋の升」（中心 2.5）に入っても、そこからの射線は自分の升で切れない', () => {
        const s = createBattle(field([{ kind: 'building', rect: { x0: -60, x1: 3, z0: -30, z1: 30 } }], HQS()));
        // (4,0) は家屋の外だが、格子では通れない升（中心 x 2.5 が家屋の中）
        expect(isPassable(s.field.nav!, 4, 0)).toBe(false);
        expect(lineOfSight(s.map, s.field, { x: 4, z: 0 }, { x: 60, z: 0 })).toBe(true);
        expect(lineOfSight(s.map, s.field, { x: 60, z: 0 }, { x: 4, z: 0 })).toBe(true);
        // 家屋の向こう（西）へは今までどおり切れる
        expect(lineOfSight(s.map, s.field, { x: 4, z: 0 }, { x: -80, z: 0 })).toBe(false);
    });
});

describe('敗走の部隊の退き口へ道が無い（城攻め前面の要望）', () => {
    // 東西に石垣と閉じた門（x -10〜10）。敵の退き口は北。門の南（外）の敵の槍を敗走させる
    const WALL: TerrainArea[] = [
        { kind: 'wall', rect: { x0: -150, x1: -10, z0: -6, z1: 6 }, height: 6 },
        { kind: 'wall', rect: { x0: 10, x1: 150, z0: -6, z1: 6 }, height: 6 },
    ];
    const GATE: GateDef = { id: 'g', name: '試験の門', rect: { x0: -10, x1: 10, z0: -6, z1: 6 }, capture: { zone: { rect: { x0: -20, x1: 20, z0: 6, z1: 30 } }, sec: 10 } };
    const rout = (refined: boolean) => {
        // 北に敵の槍をもう 1 隊置く（敗走させた槍だけだと、敵の部隊がみな崩れて合戦が終わる）
        const s = createBattle(field(WALL, [...HQS(), U('e', 'enemy', 'yari', 30, 60, { aiRole: 'hold_line' }), U('e2', 'enemy', 'yari', 100, -100, { aiRole: 'hold_line' })], { gates: [GATE], refinedMoves: refined }));
        const e = unitById(s, 'e')!;
        e.morale = 1;
        e.lastHitT = 0;
        run(s, 0.5);
        expect(e.status).toBe('routed');
        run(s, 30);
        return s;
    };

    it('早送り：第3群の直しでは、閉じた門の外で敗走した部隊は、門の前に押し付けられずにその場から逃れ去る（知らせに「道が塞がれている」）', () => {
        const s = rout(true);
        const e = unitById(s, 'e')!;
        expect(e.present).toBe(false);
        expect(s.events.some((x) => x.kind === 'fled' && x.text.includes('退き口への道が塞がれている'))).toBe(true);
    });

    it('早送り：直しを付けない戦場（既存の動き）では、今までどおり閉じた門の前に残る', () => {
        const s = rout(false);
        const e = unitById(s, 'e')!;
        expect(e.present).toBe(true);
        expect(e.z).toBeGreaterThan(5);
        expect(e.z).toBeLessThan(30);
    });
});

describe('break_unit と limit_breakthrough（城下町外縁の要望）', () => {
    it('早送り：出口を抜けた敵の部隊は、崩したことにしない（副目標「崩す」は果たせない）。抜けずに崩れた部隊は今までどおり崩した', () => {
        const exit = { rect: { x0: -40, x1: 40, z0: 100, z1: 150 } };
        const s = createBattle(
            field([], [...HQS(), U('a', 'enemy', 'yari', 0, 60, { aiRole: 'assault', aiTarget: { x: 0, z: 130, r: 10 } }), U('b', 'enemy', 'yari', 100, -100, { aiRole: 'hold_line' })], {}, {
                objectives: {
                    primary: { id: 'p', label: '突破を抑える', type: 'limit_breakthrough', exits: [exit], maxCount: 2, untilSec: 300 },
                    secondary: [
                        { id: 'sa', label: 'a を崩す', type: 'break_unit', unitId: 'a' },
                        { id: 'sb', label: 'b を崩す', type: 'break_unit', unitId: 'b' },
                    ],
                },
            }),
        );
        let bRouted = false;
        run(s, 120, (st) => {
            const b = unitById(st, 'b')!;
            if (!bRouted && st.t > 5) {
                b.morale = 1;
                bRouted = true;
            }
        });
        expect(s.objectives!.primary!.entered).toEqual(['a']);
        expect(unitById(s, 'a')!.status).toBe('withdrawn');
        const sa = s.objectives!.secondary.find((r) => r.def.id === 'sa')!;
        const sb = s.objectives!.secondary.find((r) => r.def.id === 'sb')!;
        expect(sa.state).toBe('failed');
        expect(sb.state).toBe('done');
    });
});

describe('validateField：射線を遮る高さ（寺社周辺の要望）', () => {
    it('状態を直接操作：台地（高さ 8 m）の上の堂の高さが 8＋1.5 m 以下なら知らせる（height は高さ 0 からの値）。今の 15 戦場は知らせが無い', () => {
        for (const f of FIELDS) expect([f.id, validateField(f).filter((x) => x.includes('射線を遮る高さ'))]).toEqual([f.id, []]);
        const t = getField('temple')!;
        const i = t.terrain.findIndex((a) => a.kind === 'building');
        const low: BattlefieldDef = { ...t, terrain: t.terrain.map((a, k) => (k === i ? { ...a, height: 9 } : a)) };
        const msgs = validateField(low).filter((x) => x.includes('射線を遮る高さ'));
        expect(msgs.length).toBe(1);
        expect(msgs[0]).toContain(`地形 ${i}（building）`);
        // 平地の家屋（高さ 6 m）は知らせない（村落）
        expect(validateField(getField('village')!).filter((x) => x.includes('射線を遮る高さ'))).toEqual([]);
    });
});

describe('道探しの直し（湿地の要望。pathfind.ts）', () => {
    const marsh = getField('marsh')!;
    const envOf = (refined: boolean) => createFieldEnv(fieldMap(marsh), { ...fieldRulesOf(marsh), refinedMoves: refined });

    it('状態を直接操作：泥の中 (39,-11) から北の出口 (7,-180) へ：直しの前は泥をまっすぐ突っ切る。直しの後は土手道へ戻ってから北へ', () => {
        const old = findPath(envOf(false).nav!, 'yari', 39, -11, 7, -180)!;
        const now = findPath(envOf(true).nav!, 'yari', 39, -11, 7, -180)!;
        expect(old.length).toBe(1);
        expect(now.length).toBeGreaterThan(1);
        // 最初の点は土手道の首の上（|x| 7 m 以内）
        expect(Math.abs(now[0]!.x)).toBeLessThanOrEqual(7);
        expect(now[now.length - 1]).toEqual({ x: 7, z: -180 });
    });

    it('状態を直接操作：土手道の縁 (10,58) への行き先（格子の升の中心 12.5 は泥）：直しの後は泥を突っ切らず、土手道の上を通る', () => {
        const old = findPath(envOf(false).nav!, 'yari', -60, 162, 10, 58)!;
        const now = findPath(envOf(true).nav!, 'yari', -60, 162, 10, 58)!;
        expect(old).toEqual([{ x: 10, z: 58 }]);
        // 直しの後：最後の点の手前まで、通る点はどれも土手道の上（|x| 12 m 以内）か泥の外（z 140 より南）
        for (const p of now.slice(0, -1)) expect(Math.abs(p.x) <= 12 || p.z > 140).toBe(true);
        expect(now[now.length - 1]).toEqual({ x: 10, z: 58 });
    });

    it('状態を直接操作：既存の 10 戦場（水田・浅瀬）の道は、直しを付けないので今までと同じ点の並び', () => {
        for (const id of ['paddy', 'river_ford']) {
            const f = getField(id)!;
            const a = createFieldEnv(fieldMap(f), fieldRulesOf(f));
            const b = createFieldEnv(fieldMap(f), { ...fieldRulesOf(f), refinedMoves: false });
            expect(a.refined).toBe(false);
            for (const [fx, fz, tx, tz] of [
                [0, 100, 0, -100],
                [-80, 60, 60, -60],
                [40, 0, -40, 0],
            ] as const)
                expect(findPath(a.nav!, 'yari', fx, fz, tx, tz)).toEqual(findPath(b.nav!, 'yari', fx, fz, tx, tz));
        }
    });
});

describe('泥の中では着いたことにしない（湿地の要望）', () => {
    // 一面の泥。止まっている味方 2 隊（x ±10）の間の向こう (10,-30) へ騎馬を動かす
    const MUD: TerrainArea[] = [{ kind: 'marsh', rect: { x0: -150, x1: 150, z0: -100, z1: 100 } }];
    const go = (refined: boolean) => {
        const s = createBattle(field(MUD, [...HQS(), U('f1', 'ally', 'yari', -10, 0), U('f2', 'ally', 'yari', 10, 0), U('m', 'ally', 'kiba', 0, 25)], { refinedMoves: refined }));
        issueOrder(s, 'm', { type: 'move', x: 10, z: -30 });
        run(s, 90);
        const m = unitById(s, 'm')!;
        return { m, d: Math.hypot(m.x - 10, m.z + 30) };
    };

    it('早送り：直しの後は、味方に塞がれても泥の中で待機にならず、よけ・すり抜けて行き先へ着く。直しの前は泥の中で 12 秒ほどで待機になった', () => {
        const now = go(true);
        expect(now.m.order.type).toBe('hold');
        expect(now.d).toBeLessThan(2);
        const old = go(false);
        expect(old.m.order.type).toBe('hold');
        expect(old.d).toBeGreaterThan(30);
    });
});

describe('止まっている味方に塞がれた移動・攻撃（城攻め前面の要望）', () => {
    // 東西の石垣の切れ目（幅 = 味方の並び＋両脇 14 m）を、止まっている味方 4 隊（21 m おき）が埋めている。北の敵へ攻撃・北へ移動する。
    // 近くで斬り合う味方がいる（遠くの行き詰まりで待機にならない）
    const setup = (refined: boolean, order: 'attack') => {
        const gap = 21;
        const n = 4;
        const half = ((n - 1) * gap) / 2;
        const walls: TerrainArea[] = [
            { kind: 'wall', rect: { x0: -150, x1: -half - 14, z0: -6, z1: 6 } },
            { kind: 'wall', rect: { x0: half + 14, x1: 150, z0: -6, z1: 6 } },
        ];
        const line = Array.from({ length: n }, (_, i) => U(`f${i}`, 'ally', 'yari', -half + i * gap, 0, { strength: 3000, morale: 100 }));
        const s = createBattle(
            field(walls, [
                ...HQS(),
                ...line,
                U('m', 'ally', 'yari', 0, 35, { strength: 3000, morale: 100 }),
                U('fx', 'ally', 'yari', half + 30, 30, { strength: 3000, morale: 100 }),
                U('ex', 'enemy', 'yari', half + 30, 10, { strength: 3000, morale: 100, aiRole: 'hold_line' }),
                U('tg', 'enemy', 'yari', 0, -100, { strength: 3000, morale: 100, aiRole: 'hold_line' }),
            ], { refinedMoves: refined }),
        );
        issueOrder(s, 'fx', { type: 'attack', targetId: 'ex' });
        issueOrder(s, 'm', { type: order, targetId: 'tg' });
        run(s, 150);
        return s;
    };

    // 移動の命令は、近くの味方が斬り合っていなければ 12 秒で「遠くで行き詰まった」と待機になる（下のテスト）。攻撃の命令には待機にする決まりが無く、
    // 直す前は攻撃の命令のまま動けなかった（城攻め前面：門の裏の槍への攻撃の命令の忠勝隊が 300 秒動けない）
    it('早送り：直しの後は 20 秒進めなければ味方の中をすり抜けて、北の敵と斬り合う。直しの前は攻撃の命令のまま石垣の南で動けなかった', () => {
        const atk = setup(true, 'attack');
        const m = unitById(atk, 'm')!;
        expect(m.z).toBeLessThan(-50);
        const old = setup(false, 'attack');
        const o = unitById(old, 'm')!;
        expect(o.order.type).toBe('attack');
        expect(o.z).toBeGreaterThan(5);
        expect(o.engagedWith).toBeNull();
    });

    it('早送り：遠くで行き詰まって待機にするとき、味方の部隊なら知らせる（直しの戦場だけ）', () => {
        // 石垣の切れ目を味方 2 隊が埋め、斬り合う味方はいない。直しを付けない戦場では知らせない
        const make = (refined: boolean) => {
            const walls: TerrainArea[] = [
                { kind: 'wall', rect: { x0: -150, x1: -25, z0: -6, z1: 6 } },
                { kind: 'wall', rect: { x0: 25, x1: 150, z0: -6, z1: 6 } },
            ];
            const s = createBattle(
                field(walls, [...HQS(), U('f1', 'ally', 'yari', -10.5, 0), U('f2', 'ally', 'yari', 10.5, 0), U('m', 'ally', 'yari', 0, 40), U('e2', 'enemy', 'yari', 100, -120, { aiRole: 'hold_line' })], {
                    refinedMoves: refined,
                }),
            );
            issueOrder(s, 'm', { type: 'move', x: 0, z: -120 });
            let settledAt = -1;
            run(s, 40, (st) => {
                if (settledAt < 0 && unitById(st, 'm')!.order.type === 'hold') settledAt = st.t;
            });
            return { s, settledAt };
        };
        const now = make(true);
        const old = make(false);
        const note = (s: BattleState) => s.events.filter((x) => x.text.includes('道を塞がれて先へ進めない'));
        // 直しを付けない戦場：12 秒ほどで黙って待機になる
        expect(old.settledAt).toBeGreaterThan(0);
        expect(note(old.s)).toEqual([]);
        // 直しの戦場：待機になる前に 20 秒で味方の中をすり抜けるか、待機にするなら知らせる
        if (now.settledAt > 0) expect(note(now.s).length).toBe(1);
        else expect(unitById(now.s, 'm')!.z).toBeLessThan(-20);
    });
});
