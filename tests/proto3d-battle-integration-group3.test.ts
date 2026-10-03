/**
 * 第3群の統合の確認（e2e/fields-group3.mjs）で見つけた不具合の直し（共通の機能。戦場の id では分けない）：
 * - 押し離し（sim.ts の separate）：味方とほぼ重なった部隊は 1 刻みに 18 m 近く押される。押す先の点だけを見ていたので、厚い石垣・閉じた門・
 *   家並みを押し越えて向こう側へ出られた（城攻め前面：門の前の輪で、石垣に沿って動く榊原隊が止まっている味方と重なり、閉じた外門の横の
 *   石垣を越えて曲輪の中へ抜けた。e2e の刻みごとの見張りでは、門が開く前に曲輪の中にいた）。
 *   第3群の直し（FieldRules.refinedMoves）の戦場では、押す先までまっすぐ通れるときだけ押す。既存の 10 戦場（refinedMoves なし）は
 *   今までどおり（1 刻みも同じ）。
 * - 待機の味方に塞がれた移動（第3群では sim.ts の stuckNearGoal・RULES.squeezeHoldSec の 12 秒。第4群で味方同士の詰まりの決まり
 *   RULES.allyBlockSec（2 秒。sim.ts の trackSqueeze。tests/proto3d-battle-ally-block.test.ts）に置き換えた）：行き先から遠い所で、待機（防衛・待機の命令・着いた）か能力で
 *   その場を動けない味方に塞がれて進めない移動の命令は、「道を塞がれて先へ進めない」の待機にせず、その味方の中をすり抜ける
 *   （村落：西の通りの口で待機する酒井隊の後ろで、西の辻へ向かう石川隊が待機になり、辻へ着かなかった）。塞いでいる味方が行き先の近くに
 *   いる（同じ所へ二隊を重ねて置く）とき・近くに戦える敵がいるときは今までどおり。第3群の直しの戦場だけ。
 *
 * 確かめの種類はテストの名前に書く：「状態を直接操作」（部隊の位置を書き換える）、「早送り」（stepBattle で進める）。
 */
import { describe, expect, it } from 'vitest';
import { RULES, createBattle, issueOrder, stepBattle, unitById, type BattleState } from '../proto3d/src/battle/sim';
import { buildBattleSetup, getField } from '../proto3d/src/battle/fields';
import type { BattleSetup, FieldRules, Side, TerrainArea, UnitDef, UnitKind } from '../proto3d/src/battle/types';

function field(terrain: TerrainArea[], units: UnitDef[], rules: FieldRules = {}): BattleSetup {
    return {
        map: { id: 'test', name: '試験の原', width: 300, depth: 300, terrain, exits: { ally: { x: 0, z: 150 }, enemy: { x: 0, z: -150 } } },
        units,
        timeLimitSec: 900,
        briefing: [],
        fieldRules: { pathfinding: true, settleMoves: true, ...rules },
    };
}
function U(id: string, side: Side, kind: UnitKind, x: number, z: number, extra: Partial<UnitDef> = {}): UnitDef {
    return { id, side, clan: side === 'ally' ? 'tokugawa' : 'rival', kind, name: id, strength: 300, morale: 80, x, z, facing: side === 'ally' ? 0 : Math.PI, ...extra };
}
const HQS = (): UnitDef[] => [U('a_hq', 'ally', 'honjin', -140, 140), U('e_hq', 'enemy', 'honjin', -140, -140, { aiRole: 'guard_hq' })];

/** 東西に走る厚さ 10 m の石垣（z -10〜0）。その南の面で、石垣に沿って西へ動く騎馬と、そのすぐ南に止まっている槍 */
function wallScene(refinedMoves: boolean): BattleState {
    const s = createBattle(
        field(
            [{ kind: 'wall', rect: { x0: -100, x1: 100, z0: -10, z1: 0 }, height: 6 }],
            [...HQS(), U('a_mover', 'ally', 'kiba', 0, 2), U('a_still', 'ally', 'yari', 0, 2.4)],
            { refinedMoves },
        ),
    );
    // 石垣の北（道の無い行き先）。まっすぐ向かうので、石垣に沿って西へずれて動く
    issueOrder(s, 'a_mover', { type: 'move', x: -40, z: -40 });
    return s;
}

describe('押し離しで石垣・閉じた門を越えない（sim.ts の separate）', () => {
    it('状態を直接操作：第3群の直しの戦場では、止まっている味方と重なって押されても、石垣の向こうへ押し出されない', () => {
        const s = wallScene(true);
        const u = unitById(s, 'a_mover')!;
        let north = Infinity;
        for (let k = 0; k < 30; k++) {
            stepBattle(s, RULES.tick);
            north = Math.min(north, u.z);
        }
        // 石垣の南の面（z 0）より北へ出ない（石垣の中・向こう側へ入らない）
        expect(north).toBeGreaterThan(0);
    });

    it('状態を直接操作：直しの無い戦場（既存の 10 戦場と同じ決まり）は今までどおり押す先の点だけを見る（押し越える。1 刻みも同じであることの記録）', () => {
        const s = wallScene(false);
        const u = unitById(s, 'a_mover')!;
        let north = Infinity;
        for (let k = 0; k < 30; k++) {
            stepBattle(s, RULES.tick);
            north = Math.min(north, u.z);
        }
        expect(north).toBeLessThan(-10);
    });

    it('早送り：城攻め前面で急いで門へ（出張りを 5 隊で破り、40 秒に輪の持ち場と曲輪の中への移動）を出しても、門が開く前に石垣の北へ出る味方はいない（直しの前は榊原隊が 58.3 秒に (-15.9,-54.9) → (-11.1,-66.6) へ押し越えた）', () => {
        const s = createBattle(buildBattleSetup(getField('siege_front')!, 'standard'));
        for (const id of ['a_tadakatsu', 'a_ishikawa', 'a_sakai', 'a_kiba', 'a_sakakibara']) issueOrder(s, id, { type: 'attack', targetId: 'e_sortie' });
        issueOrder(s, 'a_yumi', { type: 'move', x: 0, z: 20 });
        const gate = s.field.gates[0]!;
        const over: string[] = [];
        const step = () => {
            stepBattle(s, RULES.tick);
            if (gate.open) return;
            for (const u of s.units) if (u.side === 'ally' && u.present && u.z < -57) over.push(`${u.id}@${u.x.toFixed(1)},${u.z.toFixed(1)} t=${s.t.toFixed(1)}`);
        };
        while (s.t < 40 - 1e-9) step();
        expect(unitById(s, 'e_sortie')!.status).not.toBe('ready');
        issueOrder(s, 'a_tadakatsu', { type: 'move', x: -18, z: -50 });
        issueOrder(s, 'a_ishikawa', { type: 'move', x: 17, z: -47 });
        issueOrder(s, 'a_sakai', { type: 'move', x: -6, z: -37 });
        issueOrder(s, 'a_sakakibara', { type: 'move', x: -20, z: -95 });
        while (s.t < 120 - 1e-9 && !gate.open) step();
        // 輪を 20 秒占めて門が開く（直しの前と同じ 64.2 秒）。開いた後は、榊原隊が門をくぐって曲輪の中の行き先へ向かう
        expect(gate.open).toBe(true);
        expect(gate.openedT!).toBeGreaterThan(60);
        expect(over).toEqual([]);
        const sk = unitById(s, 'a_sakakibara')!;
        expect(sk.z).toBeGreaterThan(-57);
        while (s.t < gate.openedT! + 20) stepBattle(s, RULES.tick);
        expect(sk.z).toBeLessThan(-70);
    });
});

describe('待機の味方に塞がれた移動はすり抜ける（sim.ts の stuckNearGoal）', () => {
    it('早送り：村落で、西の通りの口 (-72,20) に待機する酒井隊の後ろを通って、西の辻 (-72,-28) へ向かう石川隊が辻へ着く（直しの前は 71 秒に (-56.5,29.1) で「道を塞がれて先へ進めない」の待機）', () => {
        const s = createBattle(buildBattleSetup(getField('village')!, 'standard'));
        const steps: [number, string, number, number][] = [
            [4, 'a_tadakatsu', 0, 30],
            [6, 'a_sakai', -48, 40],
            [8, 'a_kiba', 48, 40],
            [10, 'a_ishikawa', 18, 52],
            [12, 'a_yumi', -18, 55],
            [14, 'a_sakakibara', 30, 80],
            [16, 'a_ieyasu', 0, 125],
            [25, 'a_ishikawa', -72, -28],
            [27, 'a_sakai', -72, 20],
        ];
        let i = 0;
        let lost = false;
        while (s.t < 100 - 1e-9) {
            while (i < steps.length && s.t >= steps[i]![0] - 1e-9) {
                const [, id, x, z] = steps[i++]!;
                issueOrder(s, id, { type: 'move', x, z });
            }
            stepBattle(s, RULES.tick);
            if (s.events.some((e) => e.unitId === 'a_ishikawa' && e.text.includes('道を塞がれて'))) lost = true;
        }
        const k = unitById(s, 'a_ishikawa')!;
        const sk = unitById(s, 'a_sakai')!;
        expect(lost).toBe(false);
        expect(Math.hypot(k.x + 72, k.z + 28)).toBeLessThan(6);
        // 酒井隊は通りの口に残る（すり抜けられた側は動かない）
        expect(Math.hypot(sk.x + 72, sk.z - 20)).toBeLessThan(4);
    });

    it('状態を直接操作：塞いでいる待機の味方が行き先の近くにいる（同じ所へ二隊を重ねて置く）ときは、今までどおりその後ろで待機にする', () => {
        // 幅 16 m の通り（東西の家並み）の中ほどに待機の槍。その 3 m 先を行き先にした騎馬は、槍の後ろで止まって待機になる（すり抜けない）
        const s = createBattle(
            field(
                [
                    { kind: 'building', rect: { x0: -100, x1: -8, z0: -60, z1: 60 }, height: 6 },
                    { kind: 'building', rect: { x0: 8, x1: 100, z0: -60, z1: 60 }, height: 6 },
                ],
                [...HQS(), U('a_post', 'ally', 'yari', 0, 0), U('a_mover', 'ally', 'kiba', 0, 50)],
                { refinedMoves: true },
            ),
        );
        issueOrder(s, 'a_mover', { type: 'move', x: 0, z: -3 });
        const u = unitById(s, 'a_mover')!;
        let minZ = Infinity;
        while (s.t < 40 - 1e-9) {
            stepBattle(s, RULES.tick);
            minZ = Math.min(minZ, u.z);
        }
        expect(u.squeeze?.on ?? false).toBe(false);
        expect(minZ).toBeGreaterThan(10);
    });
});
