/**
 * 第3群の統合の確認（e2e/fields-group3.mjs）で見つけた不具合の直し（共通の機能。戦場の id では分けない）：
 * - 押し離し（sim.ts の separate）：味方とほぼ重なった部隊は 1 刻みに 18 m 近く押される。押す先の点だけを見ていたので、厚い石垣・閉じた門・
 *   家並みを押し越えて向こう側へ出られた（城攻め前面：門の前の輪で、石垣に沿って動く榊原隊が止まっている味方と重なり、閉じた外門の横の
 *   石垣を越えて曲輪の中へ抜けた。e2e の刻みごとの見張りでは、門が開く前に曲輪の中にいた）。
 *   第3群の直し（FieldRules.refinedMoves）の戦場では、押す先までまっすぐ通れるときだけ押す。既存の 10 戦場（refinedMoves なし）は
 *   今までどおり（1 刻みも同じ）。
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
