import { describe, expect, it } from 'vitest';
import {
    RULES,
    attackArc,
    createBattle,
    elevationAt,
    engagementLabel,
    issueOrder,
    meleeDamage,
    orderAllRetreat,
    orderLabel,
    outcome,
    rangedDamage,
    runToEnd,
    speedFactorAt,
    stepBattle,
    unitById,
    type BattleState,
} from '../proto3d/src/battle/sim';
import { BORDER_FIELD } from '../proto3d/src/battle/maps';
import type { BattleMap, BattleSetup, Side, UnitDef, UnitKind } from '../proto3d/src/battle/types';

const N = 0;
const E = Math.PI / 2;
const S = Math.PI;

/** 何もない平地（400 m 四方） */
const FLAT: BattleMap = { id: 'flat', name: '平地', width: 400, depth: 400, terrain: [], exits: { ally: { x: 0, z: 200 }, enemy: { x: 0, z: -200 } } };

function U(id: string, side: Side, kind: UnitKind, x: number, z: number, facing: number, extra: Partial<UnitDef> = {}): UnitDef {
    return { id, side, clan: side === 'ally' ? 'kotosaka' : 'washio', kind, name: id, strength: 300, morale: 80, x, z, facing, ...extra };
}
/** 本陣を遠くに置いた設定（本陣の敗走で終わらないように。士気の支えも届かない所） */
function setup(units: UnitDef[], map: BattleMap = FLAT, timeLimitSec = 600): BattleSetup {
    const hqs: UnitDef[] = [];
    if (!units.some((u) => u.side === 'ally' && u.kind === 'honjin')) hqs.push(U('a_hq', 'ally', 'honjin', 190, 190, N, { morale: 100 }));
    if (!units.some((u) => u.side === 'enemy' && u.kind === 'honjin')) hqs.push(U('e_hq', 'enemy', 'honjin', -190, -190, S, { morale: 100 }));
    return { map, units: [...hqs, ...units], timeLimitSec, briefing: [] };
}
const get = (s: BattleState, id: string) => unitById(s, id)!;
function advance(s: BattleState, sec: number) {
    for (let i = 0; i < Math.round(sec / RULES.tick); i++) stepBattle(s, RULES.tick);
}

describe('合戦の計算：当たる向き', () => {
    it('相手の向きに対して、前 ±50° は正面、130° までは側面、その外は背後', () => {
        const d = { x: 0, z: 0, facing: N };
        expect(attackArc(d, 0, -20)).toBe('front');
        expect(attackArc(d, 10, -20)).toBe('front');
        expect(attackArc(d, 20, 0)).toBe('flank');
        expect(attackArc(d, -20, 0)).toBe('flank');
        expect(attackArc(d, 0, 20)).toBe('rear');
        expect(attackArc({ x: 0, z: 0, facing: S }, 0, 20)).toBe('front');
    });

    it('側面から当たると ×1.6、背後から当たると ×2.2 の損害', () => {
        const s = createBattle(setup([U('d', 'ally', 'yari', 0, 0, N), U('a', 'enemy', 'yari', 0, -20, S)]));
        const d = get(s, 'd');
        const a = get(s, 'a');
        const front = meleeDamage(s, a, d, attackArc(d, a.x, a.z));
        a.x = 20;
        a.z = 0;
        const flank = meleeDamage(s, a, d, attackArc(d, a.x, a.z));
        a.x = 0;
        a.z = 20;
        const rear = meleeDamage(s, a, d, attackArc(d, a.x, a.z));
        expect(flank / front).toBeCloseTo(1.6, 5);
        expect(rear / front).toBeCloseTo(2.2, 5);
    });

    it('防衛・待機の相手には ×0.85。兵力と士気が高いほど損害が大きい', () => {
        const s = createBattle(setup([U('d', 'ally', 'yari', 0, 0, N), U('a', 'enemy', 'yari', 0, -20, S)]));
        const d = get(s, 'd');
        const a = get(s, 'a');
        const held = meleeDamage(s, a, d, 'front');
        d.order = { type: 'move', x: 0, z: -50 };
        const moving = meleeDamage(s, a, d, 'front');
        expect(held / moving).toBeCloseTo(RULES.holdMul, 5);
        const base = meleeDamage(s, a, d, 'front');
        a.strength *= 2;
        expect(meleeDamage(s, a, d, 'front') / base).toBeCloseTo(2, 5);
        a.morale = 20;
        expect(meleeDamage(s, a, d, 'front')).toBeLessThan(base * 2);
    });

    it('種類の相性：槍は正面の騎馬に強く、騎馬は槍の正面に弱い。騎馬は弓に強い', () => {
        const s = createBattle(setup([U('y', 'ally', 'yari', 0, 0, N), U('k', 'enemy', 'kiba', 0, -20, S), U('b', 'ally', 'yumi', 100, 0, N)]));
        const y = get(s, 'y');
        const k = get(s, 'k');
        const b = get(s, 'b');
        const yOnK = meleeDamage(s, y, k, 'front');
        // 槍が横を向いていると、相性の上乗せはない
        y.facing = E;
        expect(meleeDamage(s, y, k, 'front') / yOnK).toBeCloseTo(1 / 1.5, 5);
        y.facing = N;
        const kOnYFront = meleeDamage(s, k, y, 'front');
        const kOnYFlank = meleeDamage(s, k, y, 'flank');
        expect(kOnYFlank / kOnYFront).toBeCloseTo(1.6 / 0.6, 5);
        const kOnB = meleeDamage(s, k, b, 'front');
        const kOnYFrontNoPenalty = kOnYFront / 0.6;
        // 弓は守りが弱く（×1.2）、騎馬の相性（×1.5）も乗る
        expect(kOnB / kOnYFrontNoPenalty).toBeCloseTo(1.5 * 1.2, 5);
    });
});

describe('合戦の計算：地形', () => {
    it('国境の原：丘の頂は 12 m、湿地 ×0.35・林 ×0.5・道 ×1.2', () => {
        expect(elevationAt(BORDER_FIELD, 0, -100)).toBeCloseTo(12, 5);
        expect(elevationAt(BORDER_FIELD, 0, 60)).toBe(0);
        expect(speedFactorAt(BORDER_FIELD, 150, 50)).toBeCloseTo(0.35);
        expect(speedFactorAt(BORDER_FIELD, -140, 0)).toBeCloseTo(0.5);
        expect(speedFactorAt(BORDER_FIELD, 0, 60)).toBeCloseTo(1.2);
        expect(speedFactorAt(BORDER_FIELD, 60, 60)).toBe(1);
    });

    it('丘の上の守り：下から正面に来る相手の損害は ×0.7。側面へ回り込まれると守りは効かない', () => {
        const hill: BattleMap = { ...FLAT, terrain: [{ kind: 'hill', circle: { cx: 0, cz: 0, r: 70 }, height: 12 }] };
        const onHill = createBattle(setup([U('d', 'enemy', 'yari', 0, 0, S), U('a', 'ally', 'yari', 0, 40, N)], hill));
        const onFlat = createBattle(setup([U('d', 'enemy', 'yari', 0, 0, S), U('a', 'ally', 'yari', 0, 40, N)]));
        const up = (s: BattleState, ax: number, az: number) => {
            const a = get(s, 'a');
            a.x = ax;
            a.z = az;
            const d = get(s, 'd');
            return meleeDamage(s, a, d, attackArc(d, a.x, a.z));
        };
        expect(up(onHill, 0, 40) / up(onFlat, 0, 40)).toBeCloseTo(RULES.hillMul, 5);
        // 横（東）から：丘の守りは効かず、側面の ×1.6
        expect(up(onHill, 40, 0) / up(onFlat, 0, 40)).toBeCloseTo(RULES.flankMul, 5);
    });

    it('林の中の相手への弓は ×0.6', () => {
        const woods: BattleMap = { ...FLAT, terrain: [{ kind: 'woods', rect: { x0: -30, x1: 30, z0: -30, z1: 30 } }] };
        const inWoods = createBattle(setup([U('b', 'ally', 'yumi', 0, 70, N), U('t', 'enemy', 'yari', 0, 0, S)], woods));
        const open = createBattle(setup([U('b', 'ally', 'yumi', 0, 70, N), U('t', 'enemy', 'yari', 0, 0, S)]));
        const r = rangedDamage(inWoods, get(inWoods, 'b'), get(inWoods, 't')) / rangedDamage(open, get(open, 'b'), get(open, 't'));
        expect(r).toBeCloseTo(RULES.woodsArcheryMul, 5);
    });

    it('動きの速さ：槍は 3 m/秒、騎馬は 6 m/秒。林の中は半分', () => {
        const woods: BattleMap = { ...FLAT, terrain: [{ kind: 'woods', rect: { x0: 50, x1: 200, z0: -200, z1: 200 } }] };
        const s = createBattle(
            setup(
                [U('y', 'ally', 'yari', 0, 0, N), U('k', 'ally', 'kiba', -40, 0, N), U('w', 'ally', 'yari', 100, 0, N)],
                woods,
            ),
        );
        issueOrder(s, 'y', { type: 'move', x: 0, z: -150 });
        issueOrder(s, 'k', { type: 'move', x: -40, z: -150 });
        issueOrder(s, 'w', { type: 'move', x: 100, z: -150 });
        advance(s, 10);
        expect(-get(s, 'y').z).toBeCloseTo(30, 0);
        expect(-get(s, 'k').z).toBeCloseTo(60, 0);
        expect(-get(s, 'w').z).toBeCloseTo(15, 0);
    });
});

describe('合戦の計算：士気と敗走', () => {
    function moraleAfter(fromZ: number, sec: number) {
        const s = createBattle(setup([U('d', 'ally', 'yari', 0, 0, N), U('a', 'enemy', 'yari', 0, fromZ, fromZ < 0 ? S : N)]));
        issueOrder(s, 'a', { type: 'attack', targetId: 'd' });
        advance(s, sec);
        return get(s, 'd');
    }

    it('背後から突かれると、正面から当たられるより早く士気が落ちて敗走する', () => {
        const front = moraleAfter(-40, 25);
        const rear = moraleAfter(40, 25);
        expect(rear.morale).toBeLessThan(front.morale - 15);
        expect(rear.status).toBe('routed');
        expect(front.status).toBe('ready');
    });

    it('士気 15 以下で敗走：命令を聞かず退き口へ逃げ、着くと戦場から消える（兵は残る）', () => {
        const s = createBattle(setup([U('d', 'ally', 'yari', 0, 100, N, { morale: 15.2 }), U('a', 'enemy', 'yumi', 0, 0, S), U('spare', 'ally', 'yari', 150, 150, N)]));
        advance(s, 3);
        const d = get(s, 'd');
        expect(d.status).toBe('routed');
        expect(d.order.type).toBe('retreat');
        expect(issueOrder(s, 'd', { type: 'hold' })).toBe(false);
        expect(s.events.some((e) => e.kind === 'rout' && e.unitId === 'd')).toBe(true);
        advance(s, 40);
        expect(d.present).toBe(false);
        expect(d.status).toBe('routed');
        expect(d.strength).toBeGreaterThan(200);
        expect(s.events.some((e) => e.kind === 'fled' && e.unitId === 'd')).toBe(true);
    });

    it('兵が 0 になると全滅', () => {
        const s = createBattle(setup([U('d', 'ally', 'yari', 0, 0, N, { strength: 3, morale: 100 }), U('a', 'enemy', 'yari', 0, 20, N, { strength: 600 })]));
        issueOrder(s, 'a', { type: 'attack', targetId: 'd' });
        advance(s, 5);
        const d = get(s, 'd');
        expect(d.status).toBe('destroyed');
        expect(d.strength).toBe(0);
        expect(d.present).toBe(false);
    });

    it('近くの味方の敗走で士気が下がる（遠くの味方は下がらない）。本陣の敗走は全軍の士気を大きく下げる', () => {
        const s = createBattle(
            setup([
                U('weak', 'ally', 'yari', 0, 0, N, { morale: 15.1 }),
                U('near', 'ally', 'yari', 40, 0, N),
                U('far', 'ally', 'yari', 150, 150, N),
                U('shooter', 'enemy', 'yumi', 0, -100, S),
            ]),
        );
        advance(s, 1);
        expect(get(s, 'weak').status).toBe('routed');
        expect(get(s, 'near').morale).toBeCloseTo(80 - RULES.nearbyRoutShock, 0);
        expect(get(s, 'far').morale).toBeCloseTo(80, 5);

        const s2 = createBattle({
            map: FLAT,
            timeLimitSec: 600,
            briefing: [],
            units: [
                U('e_hq', 'enemy', 'honjin', 0, 0, S, { morale: 15.1 }),
                U('e_far', 'enemy', 'yari', 150, -150, S),
                U('shooter', 'ally', 'yumi', 0, 100, N),
                U('a_hq', 'ally', 'honjin', 0, 190, N),
            ],
        });
        advance(s2, 1);
        expect(get(s2, 'e_hq').status).toBe('routed');
        expect(get(s2, 'e_far').morale).toBeCloseTo(80 - RULES.hqRoutShock, 0);
    });

    it('本陣の近く（80 m）では士気が落ちにくい', () => {
        const withHq = createBattle({
            map: FLAT,
            timeLimitSec: 600,
            briefing: [],
            units: [U('a_hq', 'ally', 'honjin', 0, 60, N), U('d', 'ally', 'yari', 0, 0, N), U('a', 'enemy', 'yari', 0, -40, S), U('e_hq', 'enemy', 'honjin', -190, -190, S)],
        });
        const without = createBattle(setup([U('d', 'ally', 'yari', 0, 0, N), U('a', 'enemy', 'yari', 0, -40, S)]));
        for (const s of [withHq, without]) {
            issueOrder(s, 'a', { type: 'attack', targetId: 'd' });
            advance(s, 15);
        }
        const lossWith = 80 - get(withHq, 'd').morale;
        const lossWithout = 80 - get(without, 'd').morale;
        expect(lossWith).toBeGreaterThan(0);
        expect(lossWith).toBeLessThan(lossWithout * 0.85);
    });

    it('交戦していない間は、士気が少しずつ戻る（最初の士気まで）', () => {
        // 射手は本陣の守り役（持ち場へ戻らず、命じた所へ下がる）
        const s = createBattle(setup([U('d', 'ally', 'yari', 0, 70, N), U('b', 'enemy', 'yumi', 0, 0, S, { aiRole: 'guard_hq' })]));
        advance(s, 30);
        const low = get(s, 'd').morale;
        expect(low).toBeLessThan(72);
        issueOrder(s, 'b', { type: 'move', x: 0, z: -150 });
        advance(s, 40);
        const d = get(s, 'd');
        expect(d.morale).toBeGreaterThan(low + 10);
        expect(d.morale).toBeLessThanOrEqual(80);
    });
});

describe('合戦の計算：見えるか・着くか', () => {
    const woods: BattleMap = { ...FLAT, terrain: [{ kind: 'woods', rect: { x0: -60, x1: 60, z0: -60, z1: 60 } }] };

    it('林の中の部隊は、相手が 60 m 以内に来るまで見えない（見えない相手は攻撃の命令で選べない）', () => {
        const s = createBattle(setup([U('scout', 'ally', 'kiba', 0, 150, N), U('hidden', 'enemy', 'yari', 0, 0, S)], woods));
        expect(get(s, 'hidden').seenBy.ally).toBe(false);
        expect(get(s, 'scout').seenBy.enemy).toBe(true);
        expect(issueOrder(s, 'scout', { type: 'attack', targetId: 'hidden' })).toBe(false);
        issueOrder(s, 'scout', { type: 'move', x: 0, z: 50 });
        advance(s, 20);
        expect(get(s, 'hidden').seenBy.ally).toBe(true);
        expect(s.events.some((e) => e.kind === 'spotted' && e.unitId === 'hidden' && e.text.includes('林から現れた'))).toBe(true);
        expect(issueOrder(s, 'scout', { type: 'attack', targetId: 'hidden' })).toBe(true);
    });

    it('arriveAt の部隊は、その時刻まで戦場にいない。着くと知らせが出る', () => {
        const s = createBattle(setup([U('late', 'ally', 'kiba', -30, 30, N, { arriveAt: 40 }), U('x', 'enemy', 'yari', 0, -150, S)], woods));
        const late = get(s, 'late');
        expect(late.present).toBe(false);
        advance(s, 39.9);
        expect(late.present).toBe(false);
        expect(orderLabel(s, late)).toContain('到着待ち');
        advance(s, 0.1);
        expect(late.present).toBe(true);
        expect(late.seenBy.enemy).toBe(false);
        expect(s.events.some((e) => e.kind === 'arrive' && e.unitId === 'late' && e.text.includes('林に着いた'))).toBe(true);
    });
});

describe('合戦の計算：命令', () => {
    it('移動：着いたら待機になり、face があればその向きへ向き直る', () => {
        const s = createBattle(setup([U('y', 'ally', 'yari', 0, 0, N), U('x', 'enemy', 'yari', 0, -190, S)]));
        expect(issueOrder(s, 'y', { type: 'move', x: 30, z: 0, face: S })).toBe(true);
        advance(s, 20);
        const y = get(s, 'y');
        expect(y.x).toBeCloseTo(30, 0);
        expect(y.order.type).toBe('hold');
        expect(Math.abs(Math.cos(y.facing - S) - 1)).toBeLessThan(1e-6);
    });

    it('攻撃：槍は間合いまで近づいて斬り合う。弓は 105 m で止まって射る', () => {
        const s = createBattle(setup([U('y', 'ally', 'yari', -50, 100, N), U('b', 'ally', 'yumi', 50, 100, N), U('t', 'enemy', 'yari', 0, -60, S, { strength: 300, morale: 100 })]));
        issueOrder(s, 'y', { type: 'attack', targetId: 't' });
        issueOrder(s, 'b', { type: 'attack', targetId: 't' });
        advance(s, 60);
        expect(get(s, 'y').engagedWith).toBe('t');
        expect(engagementLabel(s, get(s, 'y'))).toBe('斬り合い：t');
        const b = get(s, 'b');
        expect(b.shootingAt).toBe('t');
        expect(Math.hypot(b.x - get(s, 't').x, b.z - get(s, 't').z)).toBeCloseTo(RULES.bowStandoff, -1);
    });

    it('待機中の部隊は、間合いに入った相手と自分から斬り合う', () => {
        const s = createBattle(setup([U('y', 'ally', 'yari', 0, 0, N), U('t', 'enemy', 'yari', 0, -60, S)]));
        issueOrder(s, 't', { type: 'move', x: 0, z: -5 });
        advance(s, 20);
        expect(get(s, 'y').engagedWith).toBe('t');
        expect(get(s, 't').engagedWith).toBe('y');
    });

    it('撤退：退き口に着くと「撤退済み」になり、兵は残る', () => {
        const s = createBattle(setup([U('y', 'ally', 'yari', 20, 150, N), U('t', 'enemy', 'yari', 0, -150, S)]));
        issueOrder(s, 'y', { type: 'retreat' });
        advance(s, 20);
        const y = get(s, 'y');
        expect(y.status).toBe('withdrawn');
        expect(y.present).toBe(false);
        expect(y.strength).toBe(300);
        expect(issueOrder(s, 'y', { type: 'hold' })).toBe(false);
    });

    it('出せない命令：同じ陣営への攻撃・いない相手・数でない地点', () => {
        const s = createBattle(setup([U('y', 'ally', 'yari', 0, 0, N), U('z', 'ally', 'yari', 30, 0, N), U('t', 'enemy', 'yari', 0, -150, S)]));
        expect(issueOrder(s, 'y', { type: 'attack', targetId: 'z' })).toBe(false);
        expect(issueOrder(s, 'y', { type: 'attack', targetId: 'nobody' })).toBe(false);
        expect(issueOrder(s, 'nobody', { type: 'hold' })).toBe(false);
        expect(issueOrder(s, 'y', { type: 'move', x: NaN, z: 0 })).toBe(false);
        // 戦場の外の地点は内側へ寄せる
        expect(issueOrder(s, 'y', { type: 'move', x: 9999, z: 0 })).toBe(true);
        expect(get(s, 'y').order).toEqual({ type: 'move', x: 198, z: 0 });
    });
});

describe('合戦の計算：勝ち負け', () => {
    it('敵本陣の敗走で勝利（敵兵を全員倒さなくてよい）', () => {
        const s = createBattle({
            map: FLAT,
            timeLimitSec: 600,
            briefing: [],
            units: [U('a_hq', 'ally', 'honjin', 0, 150, N), U('e_hq', 'enemy', 'honjin', 0, 0, S, { morale: 15.1 }), U('e_x', 'enemy', 'yari', 100, 0, S), U('b', 'ally', 'yumi', 0, 100, N)],
        });
        advance(s, 1);
        const r = outcome(s)!;
        expect(r.result).toBe('victory');
        expect(r.reason).toBe('enemy_hq_routed');
        expect(r.units.find((u) => u.id === 'e_x')!.status).toBe('ready');
        // 終わった後は進まない・命令も出せない
        expect(stepBattle(s, 1)).toEqual([]);
        expect(issueOrder(s, 'b', { type: 'hold' })).toBe(false);
    });

    it('敵の本陣以外の部隊がすべて戦えなくなると勝利。まだ着いていない部隊は戦える数に入る', () => {
        const units = [U('b', 'ally', 'yumi', 0, 100, N), U('e_x', 'enemy', 'yari', 0, 0, S, { morale: 15.1 }), U('e_late', 'enemy', 'yari', 0, -100, S, { arriveAt: 100 })];
        const s = createBattle(setup(units));
        advance(s, 2);
        expect(get(s, 'e_x').status).toBe('routed');
        expect(outcome(s)).toBeNull();
        const s2 = createBattle(setup(units.slice(0, 2)));
        advance(s2, 2);
        expect(outcome(s2)?.result).toBe('victory');
        expect(outcome(s2)?.reason).toBe('enemy_army_broken');
    });

    it('味方本陣の敗走で敗北。若殿（本陣）は敗走で、兵も残る（死亡とは別）', () => {
        const s = createBattle({
            map: FLAT,
            timeLimitSec: 600,
            briefing: [],
            units: [U('a_hq', 'ally', 'honjin', 0, 100, N, { morale: 15.1, leaderId: 'hero' }), U('a_x', 'ally', 'yari', 100, 100, N), U('e_hq', 'enemy', 'honjin', 0, -100, S), U('e_b', 'enemy', 'yumi', 0, 0, S)],
        });
        advance(s, 1);
        const r = outcome(s)!;
        expect(r.result).toBe('defeat');
        expect(r.reason).toBe('ally_hq_routed');
        const hq = r.units.find((u) => u.id === 'a_hq')!;
        expect(hq.status).toBe('routed');
        expect(hq.leaderId).toBe('hero');
        expect(hq.endStrength).toBeGreaterThan(0);
    });

    it('味方の本陣以外がすべて戦えなくなると敗北', () => {
        const s = createBattle(setup([U('a_x', 'ally', 'yari', 0, 100, N, { morale: 15.1 }), U('e_b', 'enemy', 'yumi', 0, 0, S)]));
        advance(s, 2);
        expect(outcome(s)?.result).toBe('defeat');
        expect(outcome(s)?.reason).toBe('ally_army_broken');
    });

    it('全軍撤退：味方は退き口へ下がり、撤退で終わる。まだ着いていない部隊は来ない', () => {
        const s = createBattle(setup([U('a_x', 'ally', 'yari', 0, 180, N), U('a_late', 'ally', 'kiba', 0, 150, N, { arriveAt: 100 }), U('e_b', 'enemy', 'yari', 0, 0, S)]));
        advance(s, 5);
        expect(orderAllRetreat(s)).toBe(true);
        expect(orderAllRetreat(s)).toBe(false);
        expect(issueOrder(s, 'a_x', { type: 'hold' })).toBe(false);
        advance(s, RULES.retreatGraceSec + 1);
        const r = outcome(s)!;
        expect(r.result).toBe('retreat');
        expect(r.reason).toBe('ordered_retreat');
        expect(r.elapsedSec).toBeLessThanOrEqual(5 + RULES.retreatGraceSec + 0.05);
        expect(r.units.find((u) => u.id === 'a_late')!.status).toBe('withdrawn');
        expect(r.units.find((u) => u.id === 'a_x')!.status).toBe('withdrawn');
        expect(r.units.find((u) => u.id === 'a_hq')!.status).toBe('withdrawn');
        expect(s.events.some((e) => e.kind === 'retreat_all')).toBe(true);
    });

    it('日没（時間切れ）で撤退（理由 nightfall）', () => {
        const s = createBattle(setup([U('a_x', 'ally', 'yari', 0, 100, N), U('e_x', 'enemy', 'yari', 0, -100, S)], FLAT, 30));
        const r = runToEnd(s);
        expect(r.result).toBe('retreat');
        expect(r.reason).toBe('nightfall');
        expect(r.elapsedSec).toBeCloseTo(30, 5);
        expect(s.events[s.events.length - 1].kind).toBe('nightfall');
    });

    it('結果には部隊ごとの最初と最後の兵・状態・家・率いる人物が入る', () => {
        const s = createBattle(setup([U('a_x', 'ally', 'yari', 0, 100, N, { leaderId: 'genzo' }), U('e_x', 'enemy', 'yari', 0, -100, S)], FLAT, 5));
        const r = runToEnd(s);
        const x = r.units.find((u) => u.id === 'a_x')!;
        expect(x).toEqual({ id: 'a_x', side: 'ally', clan: 'kotosaka', leaderId: 'genzo', startStrength: 300, endStrength: 300, status: 'ready' });
        expect(r.units.find((u) => u.id === 'e_x')!.leaderId).toBeUndefined();
        expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    });
});

describe('合戦の計算：同じ入力なら同じ結果', () => {
    it('刻みの細かさ（フレームの速さ）が違っても、同じ結果になる', () => {
        const mk = () => createBattle(setup([U('y', 'ally', 'yari', 0, 60, N), U('b', 'ally', 'yumi', 50, 80, N), U('t', 'enemy', 'yari', 0, -60, S), U('k', 'enemy', 'kiba', -80, -60, S)]));
        const a = mk();
        const b = mk();
        const order = (s: BattleState) => {
            if (s.tick === 10) issueOrder(s, 'y', { type: 'attack', targetId: 't' });
            if (s.tick === 50) issueOrder(s, 'k', { type: 'attack', targetId: 'b' });
        };
        while (!a.result && a.t < 300) {
            order(a);
            stepBattle(a, RULES.tick);
        }
        while (!b.result && b.t < 300) {
            order(b);
            stepBattle(b, 1 / 60);
        }
        expect(b.tick).toBeGreaterThanOrEqual(a.tick);
        expect(JSON.stringify(b.units)).toBe(JSON.stringify(a.units));
        expect(b.result).toEqual(a.result);
    });
});
