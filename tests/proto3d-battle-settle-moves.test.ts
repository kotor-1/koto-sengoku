/**
 * 新しい戦場の動きの決まり（FieldRules.settleMoves。sim.ts の stuckNearGoal・friendHoldsGoal・steerAround）：
 * - 味方の間に行き先を並べても（4×2 の格子）、押し合って「移動中」のまま止まらない部隊が残らない（行き先の近くで進めなければ着いたことにする）。
 *   Version 11 の動きのまま（国境の原）ではこの決まりを使わない（章の設定に fieldRules が付かない）。
 * - 目標の区域（河川・浅瀬の丘）の縁で味方が斬り合っていても、区域の中の行き先へ移した部隊はその手前で止まらずに区域へ入る。
 *
 * どれも「状態を直接操作したテスト」（戦場のデータの敵を外す・置き直すなどして、stepBattle で進める）か、「早送り」の台本。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, runToEnd, stepBattle, type BattleState } from '../proto3d/src/battle/sim';
import { objectiveProgress } from '../proto3d/src/battle/objectives';
import { buildBattleSetup, getField, presetUnits } from '../proto3d/src/battle/fields';
import { demoSetup } from '../proto3d/src/battle/maps';
import type { Order, UnitDef } from '../proto3d/src/battle/types';

function run(s: BattleState, sec: number, each?: (s: BattleState) => void): void {
    const end = s.t + sec;
    while (s.t < end - 1e-9 && !s.result) {
        stepBattle(s, 0.1);
        each?.(s);
    }
}

/** 戦場の味方（援軍もすぐ出す）＋確認用の槍で 8 部隊にし、敵は本陣だけを遠くに置く */
function crowd(fieldId: string, hq: [number, number]): UnitDef[] {
    const f = getField(fieldId)!;
    const us = presetUnits(f, 'standard')
        .filter((u) => u.side === 'ally' || u.id === 'e_hq')
        .map((u) => {
            const c: UnitDef = { ...u };
            delete c.arriveAt;
            if (u.id === 'e_hq') Object.assign(c, { x: hq[0], z: hq[1], aiRole: 'guard_hq' });
            return c;
        });
    const lord = us.find((u) => u.side === 'ally' && u.kind === 'honjin')!;
    for (let k = 1; us.filter((u) => u.side === 'ally').length < 8; k++) {
        const dx = (k % 2 ? 1 : -1) * 30 * Math.ceil(k / 2);
        us.push({ id: `a_x${k}`, side: 'ally', clan: lord.clan, kind: 'yari', name: `加勢${k}`, strength: 200, morale: 70, x: lord.x + dx, z: lord.z, facing: lord.facing });
    }
    return us;
}

/** 4×2 の格子（20 m おき） */
const grid = (cx: number, z1: number, z2: number): [number, number][] => [-30, -10, 10, 30].flatMap((x) => [[cx + x, z1], [cx + x, z2]] as [number, number][]);

describe('新しい戦場の動き：行き先の近くで詰まった移動は着いたことにする', () => {
    it('章の設定（国境の原）は Version 11 の動きのまま。演習の 5 戦場は新しい動きの決まりを使う', () => {
        expect(createBattle(demoSetup('tashiro')).field.settleMoves).toBe(false);
        for (const id of ['plains', 'river_ford', 'hills', 'forest', 'mountain_pass']) {
            expect(createBattle(buildBattleSetup(getField(id)!, 'standard')).field.settleMoves, id).toBe(true);
        }
    });

    for (const [fieldId, pts, hq] of [
        ['plains', grid(0, -100, -120), [190, 150]],
        ['river_ford', grid(-120, -70, -90), [150, 150]],
        ['mountain_pass', grid(0, -160, -180), [100, 190]],
    ] as const) {
        it(`${fieldId}：味方 8 部隊を 4×2 の格子へ出すと、400 秒後に「移動中」のまま止まった部隊が残らない`, () => {
            const s = createBattle(buildBattleSetup(getField(fieldId)!, crowd(fieldId, hq as [number, number]), { objectives: 'none', timeLimitSec: 2000 }));
            const al = s.units.filter((u) => u.side === 'ally');
            al.forEach((u, i) => {
                const [x, z] = pts[i % pts.length]!;
                issueOrder(s, u.id, { type: 'move', x, z });
            });
            run(s, 400);
            expect(al.filter((u) => u.order.type === 'move').map((u) => u.id)).toEqual([]);
            // 着いた（待機になった）部隊は、行き先の近くにいる（格子の広がりより遠くで止まらない）
            al.forEach((u, i) => {
                const [x, z] = pts[i % pts.length]!;
                expect(Math.hypot(u.x - x, u.z - z), u.id).toBeLessThan(60);
            });
        });
    }
});

describe('新しい戦場の動き：目標の区域の縁で味方が斬り合っていても、区域の中の行き先へ入る（河川・浅瀬の丘）', () => {
    const RF = getField('river_ford')!;
    const atk = (targetId: string): Order => ({ type: 'attack', targetId });
    const mv = (x: number, z: number): Order => ({ type: 'move', x, z });
    const SPEARS = ['a_tadakatsu', 'a_sakakibara', 'a_sakai', 'a_ishikawa'];
    /** 中央を弓で開ける作戦（tests/proto3d-field-river_ford.test.ts の FIT_CENTER）の 220 秒の丘への命令だけを差し替える */
    function play(hill: (id: string, i: number) => Order, each?: (s: BattleState) => void) {
        const steps: [number, string, Order][] = [
            [0, 'a_yumi', atk('e_yumi')],
            [0, 'a_tadakatsu', mv(5, 10)],
            [120, 'a_tadakatsu', atk('e_kiba')],
            [120, 'a_yumi', atk('e_sente')],
            [150, 'a_sakakibara', atk('e_sente')],
            [150, 'a_sakai', atk('e_sente')],
            [150, 'a_ishikawa', mv(0, 10)],
            ...SPEARS.map((id, i) => [220, id, hill(id, i)] as [number, string, Order]),
            [220, 'a_yumi', atk('e_hill_yumi')],
        ];
        const s = createBattle(buildBattleSetup(RF, 'standard'));
        const o = runToEnd(s, (st) => {
            while (steps.length && st.t >= steps[0]![0] - 1e-9) {
                const [, id, ord] = steps.shift()!;
                issueOrder(st, id, ord);
            }
            each?.(st);
        });
        return { s, o };
    }

    it('丘の輪の中の端（中心から 20〜25 m）へ四隊を移すと、縁で斬り合う味方の手前で止まらずに輪へ入って勝つ', () => {
        const pts = [
            [20, 10],
            [22, -5],
            [5, 20],
            [15, 18],
        ];
        const { o } = play((_, i) => mv(-70 + pts[i]![0]!, -85 + pts[i]![1]!));
        expect(o.result).toBe('victory');
        expect(o.reason).toBe('objective_done');
    });

    it('丘の真ん中の丘の守りを攻撃した四隊は、相手が崩れると輪の外で待機になる。そのとき進みの文は「区域に味方がいない」と理由を出す', () => {
        const texts = new Set<string>();
        const { o } = play(
            () => atk('e_hill'),
            (st) => {
                if (st.t > 300) texts.add(objectiveProgress(st)[0]!.progressText);
            },
        );
        expect(o.result).not.toBe('victory');
        expect([...texts].some((t) => t.includes('区域に味方がいない'))).toBe(true);
    });
});
