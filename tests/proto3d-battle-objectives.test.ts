/**
 * 合戦の目標（objectives.ts。docs/battlefields-design.md §4）：主目標・副目標の 10 種の判定と、勝ち負け・結果の記録・画面向けの見通し。
 * 小さな試験用の戦場で確かめる。「早送り」（stepBattle・runToEnd）と「状態を直接操作」（士気・兵・位置を書き換えて崩す）を使う。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, orderAllRetreat, runToEnd, stepBattle, unitById, RULES, type BattleState } from '../proto3d/src/battle/sim';
import { objectiveProgress } from '../proto3d/src/battle/objectives';
import type { BattleSetup, ObjectiveDef, Side, UnitDef, UnitKind } from '../proto3d/src/battle/types';

function U(id: string, side: Side, kind: UnitKind, x: number, z: number, extra: Partial<UnitDef> = {}): UnitDef {
    return { id, side, clan: side === 'ally' ? 'tokugawa' : 'rival', kind, name: id, strength: 300, morale: 80, x, z, facing: side === 'ally' ? 0 : Math.PI, ...extra };
}
/** 両軍の本陣（隅）と、味方の槍 2・敵の槍 1（遠く） */
function baseUnits(): UnitDef[] {
    return [
        U('a_hq', 'ally', 'honjin', -140, 140),
        U('a1', 'ally', 'yari', -20, 60),
        U('a2', 'ally', 'yari', 20, 60),
        U('e_hq', 'enemy', 'honjin', 140, -140, { aiRole: 'guard_hq' }),
        U('e1', 'enemy', 'yari', 100, -140, { aiRole: 'guard_hq' }),
    ];
}
function setup(objectives: BattleSetup['objectives'], units = baseUnits(), extra: Partial<BattleSetup> = {}): BattleSetup {
    return {
        map: { id: 'test', name: '試験の原', width: 300, depth: 300, terrain: [], exits: { ally: { x: 0, z: 150 }, enemy: { x: 0, z: -150 } } },
        units,
        timeLimitSec: 600,
        briefing: [],
        ...(objectives ? { objectives } : {}),
        ...extra,
    };
}
function advance(s: BattleState, sec: number): void {
    const end = s.tick + Math.round(sec / RULES.tick);
    while (s.tick < end && !s.result) stepBattle(s, RULES.tick);
}
const P = (def: ObjectiveDef) => ({ primary: def, secondary: [] });
/** 士気を尽きさせて次の刻みで敗走させる（状態を直接操作） */
function rout(s: BattleState, id: string): void {
    unitById(s, id)!.morale = 0;
}

describe('主目標で勝ち負けが決まる', () => {
    it('destroy_hq：敵本陣が崩れれば勝利（理由は今までどおり enemy_hq_routed）。主目標は達成', () => {
        const s = createBattle(setup(P({ id: 'o', type: 'destroy_hq', label: '敵本陣を崩す' })));
        rout(s, 'e_hq');
        const r = runToEnd(s);
        expect(r.result).toBe('victory');
        expect(r.reason).toBe('enemy_hq_routed');
        expect(r.objectives).toEqual({ primary: { id: 'o', type: 'destroy_hq', label: '敵本陣を崩す', achieved: true }, secondary: [] });
    });

    it('hold_point：敵のいない区域に味方が続けて sec 秒いれば勝利。敵が入ると数え直し', () => {
        const s = createBattle(setup(P({ id: 'h', type: 'hold_point', label: '丘を確保', zone: { circle: { cx: 0, cz: 0, r: 20 } }, sec: 30 })));
        // 数えていない理由を出す：区域に味方がいない
        expect(objectiveProgress(s)[0]!.progressText).toBe('確保 0／30 秒・区域に味方がいない（輪の中へ移動させる）');
        issueOrder(s, 'a1', { type: 'move', x: 0, z: 0 });
        advance(s, 30);
        expect(objectiveProgress(s)[0]!.progressText).toMatch(/^確保 \d+／30 秒（敵のいない区域に味方がいる間だけ数える）$/);
        const before = s.objectives!.primary!.sec;
        expect(before).toBeGreaterThan(0);
        // 敵を区域へ（直接操作）：数え直し。理由は「区域に敵がいる」
        const e1 = unitById(s, 'e1')!;
        e1.x = 10;
        e1.z = -10;
        stepBattle(s, RULES.tick);
        expect(s.objectives!.primary!.sec).toBe(0);
        expect(objectiveProgress(s)[0]!.progressText).toBe('確保 0／30 秒・区域に敵がいる（敵を追い出すと数え始める）');
        e1.x = 100;
        e1.z = -140;
        const r = runToEnd(s);
        expect(r.result).toBe('victory');
        expect(r.reason).toBe('objective_done');
        expect(r.objectives!.primary!.achieved).toBe(true);
        expect(s.events.some((e) => e.kind === 'objective' && e.text.includes('丘を確保'))).toBe(true);
    });

    it('defend_time：本陣を sec 秒守れば勝利。区域を守る型は、敵だけが loseSec 秒いると果たせず敗北（objective_failed）', () => {
        const ok = runToEnd(createBattle(setup(P({ id: 'd', type: 'defend_time', label: '守る', sec: 20 }))));
        expect(ok.result).toBe('victory');
        expect(ok.reason).toBe('objective_done');
        expect(ok.elapsedSec).toBe(20);
        const units = baseUnits();
        units.find((u) => u.id === 'e1')!.x = 0;
        units.find((u) => u.id === 'e1')!.z = -100;
        const lost = runToEnd(createBattle(setup(P({ id: 'd', type: 'defend_time', label: '関を守る', sec: 60, zone: { circle: { cx: 0, cz: -100, r: 20 } }, loseSec: 5 }), units)));
        expect(lost.result).toBe('defeat');
        expect(lost.reason).toBe('objective_failed');
        expect(lost.elapsedSec).toBeCloseTo(5, 5);
        expect(lost.objectives!.primary!.achieved).toBe(false);
    });

    it('rescue：対象を区域まで連れ帰れば勝利。対象が崩れれば敗北', () => {
        const def: ObjectiveDef = { id: 'r', type: 'rescue', label: '救出', unitId: 'a2', zone: { circle: { cx: 0, cz: 120, r: 20 } } };
        const s = createBattle(setup(P(def)));
        issueOrder(s, 'a2', { type: 'move', x: 0, z: 120 });
        const r = runToEnd(s);
        expect(r.result).toBe('victory');
        expect(r.reason).toBe('objective_done');
        const f = createBattle(setup(P(def)));
        rout(f, 'a2');
        const rf = runToEnd(f);
        expect(rf.result).toBe('defeat');
        expect(rf.reason).toBe('objective_failed');
    });

    it('breakthrough：味方 count 部隊が区域に入れば勝利。入れる部隊が足りなくなれば敗北', () => {
        const zone = { rect: { x0: -60, x1: 60, z0: -100, z1: -80 } };
        const s = createBattle(setup(P({ id: 'b', type: 'breakthrough', label: '突破', zone, count: 2 })));
        issueOrder(s, 'a1', { type: 'move', x: -20, z: -90 });
        issueOrder(s, 'a2', { type: 'move', x: 20, z: -90 });
        advance(s, 20);
        expect(objectiveProgress(s)[0]!.progressText).toMatch(/突破 \d／2 部隊/);
        const r = runToEnd(s);
        expect(r.result).toBe('victory');
        expect(r.reason).toBe('objective_done');
        const f = runToEnd(createBattle(setup(P({ id: 'b', type: 'breakthrough', label: '突破', zone, count: 4 }))));
        expect(f.result).toBe('defeat');
        expect(f.reason).toBe('objective_failed');
    });

    it('retreat_success：本陣と兵の minRatio 以上が退き口から離れれば勝利。兵が足りなければ敗北', () => {
        const near = () => [U('a_hq', 'ally', 'honjin', 0, 130), U('a1', 'ally', 'yari', -20, 130), U('a2', 'ally', 'yari', 20, 130), U('e_hq', 'enemy', 'honjin', 140, -140, { aiRole: 'guard_hq' })];
        const def: ObjectiveDef = { id: 'rt', type: 'retreat_success', label: '退く', minRatio: 0.6 };
        const s = createBattle(setup(P(def), near()));
        orderAllRetreat(s);
        const r = runToEnd(s);
        expect(r.result).toBe('victory');
        expect(r.reason).toBe('objective_done');
        expect(r.objectives!.primary!.achieved).toBe(true);
        // 兵を大きく失ってから退く（直接操作）：果たせず敗北
        const f = createBattle(setup(P(def), near()));
        unitById(f, 'a1')!.strength = 20;
        unitById(f, 'a2')!.strength = 20;
        stepBattle(f, RULES.tick);
        const rf = runToEnd(f, (st) => {
            if (st.allRetreatAt === null) orderAllRetreat(st);
        });
        expect(rf.result).toBe('defeat');
        expect(rf.reason).toBe('objective_failed');
    });

    it('survive_until：援軍が着いて holdSec 秒たてば勝利。見通しは到着までの秒数', () => {
        const units = [...baseUnits(), U('a_r', 'ally', 'yari', 0, 145, { arriveAt: 10 })];
        const s = createBattle(setup(P({ id: 's', type: 'survive_until', label: '耐える', reinforcementId: 'relief', holdSec: 5 }), units, { reinforcements: [{ id: 'relief', side: 'ally', unitIds: ['a_r'] }] }));
        advance(s, 3);
        expect(objectiveProgress(s)[0]!.progressText).toBe('援軍の到着まで 7 秒');
        const r = runToEnd(s);
        expect(r.result).toBe('victory');
        expect(r.reason).toBe('objective_done');
        expect(r.elapsedSec).toBeCloseTo(15, 5);
    });

    it('主目標があっても、味方本陣の敗走は敗北・日没は撤退（今までどおり）。敵がすべて崩れれば勝利', () => {
        const def: ObjectiveDef = { id: 'h', type: 'hold_point', label: '確保', zone: { circle: { cx: 0, cz: -120, r: 10 } }, sec: 999 };
        const s = createBattle(setup(P(def)));
        rout(s, 'a_hq');
        expect(runToEnd(s).reason).toBe('ally_hq_routed');
        const n = createBattle(setup(P(def), baseUnits(), { timeLimitSec: 30 }));
        const rn = runToEnd(n);
        expect(rn.result).toBe('retreat');
        expect(rn.reason).toBe('nightfall');
        expect(rn.objectives!.primary!.achieved).toBe(false);
        const b = createBattle(setup(P(def)));
        rout(b, 'e_hq');
        rout(b, 'e1');
        const rb = runToEnd(b);
        expect(rb.result).toBe('victory');
        expect(rb.reason).toBe('enemy_army_broken');
        expect(rb.objectives!.primary!.achieved).toBe(true);
    });
});

describe('副目標は勝ち負けに影響せず、終わりに判定して記録する', () => {
    it('preserve_unit・limit_losses・break_unit（主目標は defend_time 5 秒）', () => {
        const obj = (): BattleSetup['objectives'] => ({
            primary: { id: 'p', type: 'defend_time', label: '守る', sec: 5 },
            secondary: [
                { id: 'keep', type: 'preserve_unit', label: '崩さない', unitId: 'a2', minRatio: 0.5 },
                { id: 'loss', type: 'limit_losses', label: '損害 1 割以内', maxRatio: 0.1 },
                { id: 'brk', type: 'break_unit', label: '敵の槍を崩す', unitId: 'e1' },
            ],
        });
        const good = createBattle(setup(obj()));
        rout(good, 'e1');
        const rg = runToEnd(good);
        expect(rg.result).toBe('victory');
        expect(rg.objectives!.secondary.map((o) => [o.id, o.achieved])).toEqual([
            ['keep', true],
            ['loss', true],
            ['brk', true],
        ]);
        const bad = createBattle(setup(obj()));
        rout(bad, 'a2');
        unitById(bad, 'a1')!.strength = 100;
        const rb = runToEnd(bad);
        expect(rb.result).toBe('victory');
        expect(rb.objectives!.secondary.map((o) => [o.id, o.achieved])).toEqual([
            ['keep', false],
            ['loss', false],
            ['brk', false],
        ]);
        expect(objectiveProgress(bad).map((o) => [o.role, o.state])).toEqual([
            ['primary', 'done'],
            ['secondary', 'failed'],
            ['secondary', 'failed'],
            ['secondary', 'failed'],
        ]);
    });

    it('preserve_unit・limit_losses は、全軍撤退で終えたら果たせない（戦わずに退いても達成にしない）。日没まで戦えば果たせる', () => {
        const obj = (): BattleSetup['objectives'] => ({
            primary: { id: 'p', type: 'destroy_hq', label: '敵本陣を崩す' },
            secondary: [
                { id: 'keep', type: 'preserve_unit', label: '崩さない', unitId: 'a2', minRatio: 0.5 },
                { id: 'loss', type: 'limit_losses', label: '損害 3 割以内', maxRatio: 0.3 },
            ],
        });
        const ret = createBattle(setup(obj()));
        advance(ret, 5);
        orderAllRetreat(ret);
        const rr = runToEnd(ret);
        expect([rr.result, rr.reason]).toEqual(['retreat', 'ordered_retreat']);
        expect(rr.objectives!.secondary.map((o) => [o.id, o.achieved])).toEqual([
            ['keep', false],
            ['loss', false],
        ]);
        const night = createBattle(setup(obj(), baseUnits(), { timeLimitSec: 20 }));
        const rn = runToEnd(night);
        expect([rn.result, rn.reason]).toEqual(['retreat', 'nightfall']);
        expect(rn.objectives!.secondary.map((o) => [o.id, o.achieved])).toEqual([
            ['keep', true],
            ['loss', true],
        ]);
    });

    it('主目標を省いて副目標だけ：勝ち負けは今までの決まり（敵本陣の敗走で勝利）。結果には副目標だけ', () => {
        const s = createBattle(setup({ secondary: [{ id: 'keep', type: 'preserve_unit', label: '崩さない', unitId: 'a1', minRatio: 0.5 }] }));
        rout(s, 'e_hq');
        const r = runToEnd(s);
        expect(r.reason).toBe('enemy_hq_routed');
        expect(r.objectives).toEqual({ secondary: [{ id: 'keep', type: 'preserve_unit', label: '崩さない', achieved: true }] });
    });

    it('目標の無い合戦：結果に objectives の欄は無く、見通しは空', () => {
        const s = createBattle(setup(undefined));
        expect(objectiveProgress(s)).toEqual([]);
        rout(s, 'e_hq');
        expect('objectives' in runToEnd(s)).toBe(false);
    });

    it('目標の指す部隊・援軍が無ければ合戦を作らない', () => {
        expect(() => createBattle(setup(P({ id: 'x', type: 'rescue', label: 'x', unitId: 'nobody', zone: { circle: { cx: 0, cz: 0, r: 5 } } })))).toThrow();
        expect(() => createBattle(setup(P({ id: 'x', type: 'survive_until', label: 'x', reinforcementId: 'none' })))).toThrow();
    });

    it('見通しの一覧は主目標 → 副目標の順で、id・名前・役・状態・進みの文を持つ', () => {
        const s = createBattle(setup({ primary: { id: 'p', type: 'destroy_hq', label: '敵本陣を崩す' }, secondary: [{ id: 'l', type: 'limit_losses', label: '損害 3 割以内', maxRatio: 0.3 }] }));
        expect(objectiveProgress(s)).toEqual([
            { id: 'p', label: '敵本陣を崩す', role: 'primary', state: 'active', progressText: 'e_hqを崩す' },
            { id: 'l', label: '損害 3 割以内', role: 'secondary', state: 'active', progressText: '損害 0％（30％ 以内で終える・撤退は不可）' },
        ]);
    });
});
