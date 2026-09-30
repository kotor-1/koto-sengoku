/**
 * 武将の基本方針による自由な動き（ai.ts の thinkGenerals。docs/troops-abilities-design.md §3）。
 * - BattleSetup.generalInitiative の合戦（演習の 5 戦場）だけ。歴史分岐・架空の第一章では使わない。
 * - 命令を受けていない待機中（最初の待機・移動の命令で着いた後）だけ、持ち場から 40 m 以内で方針ごとに動く。どの命令も優先する。
 * - 酒井＝隣と組む敵へ横から、石川＝弱った味方の近くへ寄る、忠勝＝撤退する味方と追っ手の間へ、榊原＝近くの退く敵・弓を追う。
 * 何もない平地（generalInitiative: true）で、同じ場面を「命令なし（自由な動き）／防衛・待機を命じる」で比べる。
 * 早送り（stepBattle で進める）。一部は状態を直接変える（士気を書き換える）テスト。その旨をテスト名に書く。
 */
import { describe, expect, it } from 'vitest';
import { FREE_HOLD_LABEL, createBattle, issueOrder, orderAllRetreat, orderLabel, stepBattle, unitById, type BattleState } from '../proto3d/src/battle/sim';
import { useAbility } from '../proto3d/src/battle/abilities';
import { INITIATIVE } from '../proto3d/src/battle/ai';
import { GENERAL_INITIATIVE_LABELS } from '../proto3d/src/battle/generals';
import { buildBattleSetup, getField, practiceFields } from '../proto3d/src/battle/fields';
import { IEYASU_INITIAL_TROOPS, demoSetup, ieyasu1570Setup } from '../proto3d/src/battle/maps';
import type { BattleMap, BattleSetup, Side, UnitDef, UnitKind } from '../proto3d/src/battle/types';

const N = 0;
const S = Math.PI;
const FLAT: BattleMap = { id: 'flat', name: '平地', width: 400, depth: 400, terrain: [], exits: { ally: { x: 0, z: 200 }, enemy: { x: 0, z: -200 } } };

function U(id: string, side: Side, kind: UnitKind, x: number, z: number, facing: number, extra: Partial<UnitDef> = {}): UnitDef {
    return { id, side, clan: side === 'ally' ? 'tokugawa' : 'rival', kind, name: id, strength: 300, morale: 80, x, z, facing, ...extra };
}
function G(general: string): Partial<UnitDef> {
    return { generalId: general, leaderId: general };
}
function setup(units: UnitDef[], initiative = true): BattleSetup {
    const hqs: UnitDef[] = [];
    if (!units.some((u) => u.side === 'ally' && u.kind === 'honjin')) hqs.push(U('a_hq', 'ally', 'honjin', 190, 190, N, { morale: 100 }));
    if (!units.some((u) => u.side === 'enemy' && u.kind === 'honjin')) hqs.push(U('e_hq', 'enemy', 'honjin', -190, -190, S, { morale: 100 }));
    return { map: FLAT, units: [...hqs, ...units], timeLimitSec: 600, briefing: [], ...(initiative ? { generalInitiative: true } : {}) };
}
const get = (s: BattleState, id: string) => unitById(s, id)!;
function advance(s: BattleState, sec: number, each?: (s: BattleState) => void): void {
    const end = s.t + sec - 1e-9;
    while (s.t < end && !s.result) {
        each?.(s);
        stepBattle(s, 0.1);
    }
}
const fromPost = (s: BattleState, id: string) => {
    const u = get(s, id);
    return Math.hypot(u.x - u.initiative!.postX, u.z - u.initiative!.postZ);
};
const generalEvents = (s: BattleState, id: string) => s.events.filter((e) => e.kind === 'general' && e.unitId === id);

describe('どの合戦で使うか', () => {
    it('演習の 5 戦場だけ generalInitiative。国境の原（架空の第一章）・歴史分岐の合戦は使わない', () => {
        for (const f of practiceFields()) expect(buildBattleSetup(f, f.presets[0]!.id).generalInitiative).toBe(true);
        expect(getField('border_field')!.generalInitiative).toBeUndefined();
        expect(demoSetup('alone').generalInitiative).toBeUndefined();
        for (const p of ['oda', 'asai', 'home'] as const) {
            const st = ieyasu1570Setup(p, { troops: { ...IEYASU_INITIAL_TROOPS }, pledgeAccepted: true });
            expect(st.generalInitiative).toBeUndefined();
            expect(createBattle(st).units.every((u) => u.initiative === null)).toBe(true);
        }
        // 章が自分で作る合戦は、戦場の印を false で消せる
        expect(buildBattleSetup(getField('plains')!, 'standard', { generalInitiative: false }).generalInitiative).toBeUndefined();
    });

    it('方針を持つのは、味方の酒井・石川・忠勝・榊原の部隊だけ（家康本陣・長政隊・武将のいない部隊・敵方は持たない）', () => {
        const s = createBattle(buildBattleSetup(getField('plains')!, 'standard'));
        const pol = Object.fromEntries(s.units.filter((u) => u.initiative).map((u) => [u.id, u.initiative!.policy]));
        expect(pol).toEqual({ a_tadakatsu: 'rearguard', a_sakakibara: 'pursuit', a_sakai: 'coordinate', a_ishikawa: 'support' });
        const t = createBattle(setup([U('a_naga', 'ally', 'yari', 0, 60, N, { ...G('nagamasa'), clan: 'asai' }), U('e_sakai', 'enemy', 'yari', 0, -60, S, G('sakai'))]));
        expect(get(t, 'a_naga').initiative).toBeNull();
        expect(get(t, 'e_sakai').initiative).toBeNull();
        expect(Object.keys(GENERAL_INITIATIVE_LABELS).sort()).toEqual(['coordinate', 'pursuit', 'rearguard', 'support']);
    });
});

describe('札の命令の文：命令を受けていない待機と、命じた「防衛・待機」を分ける（Version 13 候補の確認で直した）', () => {
    it('最初の待機・移動の命令で着いた後は「待機・武将任せ」（武将の判断で動く）。防衛・待機を命じると「防衛・待機」（動かない）', () => {
        const s = createBattle(buildBattleSetup(getField('plains')!, 'standard'));
        expect(orderLabel(s, get(s, 'a_ishikawa'))).toBe(FREE_HOLD_LABEL);
        // 方針を持たない部隊（弓隊）・家康本陣は今までどおり
        expect(orderLabel(s, get(s, 'a_yumi'))).toBe('防衛・待機');
        expect(orderLabel(s, get(s, 'a_ieyasu'))).toBe('防衛・待機');
        expect(issueOrder(s, 'a_ishikawa', { type: 'hold' })).toBe(true);
        expect(orderLabel(s, get(s, 'a_ishikawa'))).toBe('防衛・待機');
        // 移動の命令で着いた後は、また武将の判断で動く待機
        const u = get(s, 'a_ishikawa');
        expect(issueOrder(s, 'a_ishikawa', { type: 'move', x: u.x + 6, z: u.z })).toBe(true);
        expect(orderLabel(s, u)).toBe('移動');
        for (let i = 0; i < 60 && u.order.type === 'move'; i++) stepBattle(s, 0.1);
        expect(u.order.type).toBe('hold');
        expect(orderLabel(s, u)).toBe(FREE_HOLD_LABEL);
    });
    it('武将の方針を使わない合戦（歴史分岐）は、待機はいつも「防衛・待機」', () => {
        const st = ieyasu1570Setup('oda', { troops: { ...IEYASU_INITIAL_TROOPS }, pledgeAccepted: true });
        const s = createBattle(st);
        for (const u of s.units) if (u.order.type === 'hold' && u.status === 'ready' && u.arrived) expect(orderLabel(s, u)).toBe('防衛・待機');
    });
});

// ---------------------------------------------------------------- 酒井（連携）

/** 酒井隊（西）の隣の味方の槍 f に、敵の槍が斬りかかる。酒井隊は敵の横にいる */
function sakaiScene(initiative = true): BattleSetup {
    return setup(
        [
            U('a_sakai', 'ally', 'yari', -10, 15, E_FACING, G('sakai')),
            U('a_f', 'ally', 'yari', 40, 40, N),
            U('e_y', 'enemy', 'yari', 40, 15, S, { strength: 400, order: { type: 'attack', targetId: 'a_f' }, aiRole: 'hold_line' }),
        ],
        initiative,
    );
}
const E_FACING = Math.PI / 2;

describe('酒井忠次（周りの部隊との連携）', () => {
    it('命令を受けていない待機中：隣の味方に斬りかかった敵へ、横から当たる（知らせ「武将の判断」）。持ち場から離れすぎない', () => {
        const s = createBattle(sakaiScene());
        let far = 0;
        advance(s, 20, (x) => (far = Math.max(far, fromPost(x, 'a_sakai'))));
        expect(generalEvents(s, 'a_sakai').length).toBe(1);
        expect(generalEvents(s, 'a_sakai')[0]!.text).toContain('横へ当たる（武将の判断）');
        expect(s.events.some((e) => e.kind === 'flank' && e.unitId === 'a_sakai')).toBe(true);
        expect(far).toBeLessThanOrEqual(INITIATIVE.leash + 8);
    });
    it('防衛・待機を命じると動かない（プレイヤーの命令が優先）。自由な動きの無い合戦でも動かない', () => {
        const s = createBattle(sakaiScene());
        expect(issueOrder(s, 'a_sakai', { type: 'hold' })).toBe(true);
        expect(get(s, 'a_sakai').initiative!.free).toBe(false);
        advance(s, 20);
        expect(generalEvents(s, 'a_sakai')).toEqual([]);
        expect(get(s, 'a_sakai').order).toEqual({ type: 'hold' });
        expect(Math.hypot(get(s, 'a_sakai').x + 10, get(s, 'a_sakai').z - 15)).toBeLessThan(2);
        const t = createBattle(sakaiScene(false));
        advance(t, 20);
        expect(get(t, 'a_sakai').initiative).toBeNull();
        expect(Math.hypot(get(t, 'a_sakai').x + 10, get(t, 'a_sakai').z - 15)).toBeLessThan(2);
    });
});

// ---------------------------------------------------------------- 石川（支援）

describe('石川数正（予備・援軍・同盟の支援）', () => {
    const scene = () =>
        setup([
            U('a_ishi', 'ally', 'yari', 0, 100, N, G('ishikawa')),
            U('a_f', 'ally', 'yari', 60, 40, N),
            U('e_y', 'enemy', 'yari', 60, 15, S, { strength: 500, order: { type: 'attack', targetId: 'a_f' }, aiRole: 'hold_line' }),
        ]);
    it('（状態を直接変更）士気の落ちた味方が攻められていると、その近くへ寄って構える（自分から斬りかからない）。持ち場から 40 m まで', () => {
        const s = createBattle(scene());
        get(s, 'a_f').morale = 30;
        let far = 0;
        advance(s, 20, (x) => (far = Math.max(far, fromPost(x, 'a_ishi'))));
        expect(generalEvents(s, 'a_ishi')[0]!.text).toContain('a_fを支えに寄る');
        expect(far).toBeGreaterThan(20);
        expect(far).toBeLessThanOrEqual(INITIATIVE.leash + 1);
        expect(get(s, 'a_ishi').order.type === 'attack').toBe(false);
    });
    it('士気の落ちていない味方（予備・援軍・同盟でもない）なら動かない', () => {
        const s = createBattle(scene());
        advance(s, 10);
        expect(generalEvents(s, 'a_ishi')).toEqual([]);
        expect(fromPost(s, 'a_ishi')).toBeLessThan(1);
    });
    it('援軍（後から着いた部隊）・同盟（別の家）が攻められていれば、士気が高くても寄る', () => {
        const s = createBattle(
            setup([
                U('a_ishi', 'ally', 'yari', 0, 100, N, G('ishikawa')),
                U('a_f', 'ally', 'yari', 60, 40, N, { clan: 'asai' }),
                U('e_y', 'enemy', 'yari', 60, 15, S, { strength: 500, order: { type: 'attack', targetId: 'a_f' }, aiRole: 'hold_line' }),
            ]),
        );
        advance(s, 10);
        expect(generalEvents(s, 'a_ishi').length).toBe(1);
    });
    it('後詰めの差配の効果中（石川隊は動けない）は、自由な動きもしない', () => {
        const s = createBattle(scene());
        get(s, 'a_f').morale = 30;
        expect(useAbility(s, 'a_ishi', 'a_f').ok).toBe(true);
        advance(s, 20);
        expect(generalEvents(s, 'a_ishi')).toEqual([]);
        expect(fromPost(s, 'a_ishi')).toBeLessThan(1);
    });
});

// ---------------------------------------------------------------- 忠勝（前線維持・殿）

describe('本多忠勝（前線維持・殿）', () => {
    const scene = () =>
        setup([
            U('a_tada', 'ally', 'yari', 0, 60, N, G('tadakatsu')),
            U('a_r', 'ally', 'yari', 30, 40, N),
            U('e_c', 'enemy', 'yari', 30, 5, S, { strength: 400, order: { type: 'attack', targetId: 'a_r' }, aiRole: 'hold_line' }),
        ]);
    it('撤退の命令で退く味方がいれば、その味方と追っ手の間へ入る（持ち場から 40 m まで）。退かなければ持ち場を保つ', () => {
        const s = createBattle(scene());
        advance(s, 3);
        expect(generalEvents(s, 'a_tada')).toEqual([]);
        expect(fromPost(s, 'a_tada')).toBeLessThan(1);
        issueOrder(s, 'a_r', { type: 'retreat' });
        let far = 0;
        advance(s, 15, (x) => (far = Math.max(far, fromPost(x, 'a_tada'))));
        expect(generalEvents(s, 'a_tada')[0]!.text).toContain('退くa_rの後ろへ入る');
        expect(far).toBeGreaterThan(15);
        expect(far).toBeLessThanOrEqual(INITIATIVE.leash + 1);
    });
    it('（状態を直接変更）敗走した味方には入らない（敗走の立て直しは作戦の判断なので、自由な動きではしない）', () => {
        const s = createBattle(scene());
        advance(s, 2);
        get(s, 'a_r').morale = 0;
        advance(s, 10);
        expect(get(s, 'a_r').status).toBe('routed');
        expect(generalEvents(s, 'a_tada')).toEqual([]);
    });
});

// ---------------------------------------------------------------- 榊原（側面・機動・追撃）

describe('榊原康政（側面・機動・追撃）', () => {
    it('近く（80 m）の敵の弓隊へ当たる。遠い弓隊には動かない', () => {
        const near = createBattle(setup([U('a_saka', 'ally', 'yari', 0, 60, N, G('sakakibara')), U('e_b', 'enemy', 'yumi', 20, 5, S, { aiRole: 'hold_line' })]));
        advance(near, 5);
        expect(get(near, 'a_saka').order).toMatchObject({ type: 'attack', targetId: 'e_b' });
        expect(generalEvents(near, 'a_saka')[0]!.text).toContain('e_bを追う（武将の判断）');
        expect(orderLabel(near, get(near, 'a_saka'))).toContain('武将の判断');
        const far = createBattle(setup([U('a_saka', 'ally', 'yari', 0, 60, N, G('sakakibara')), U('e_b', 'enemy', 'yumi', 0, -60, S, { aiRole: 'hold_line' })]));
        advance(far, 5);
        expect(generalEvents(far, 'a_saka')).toEqual([]);
    });
    it('プレイヤーの移動の命令の間は追わず、着いたら着いた所を新しい持ち場にして、また方針で動く', () => {
        const s = createBattle(setup([U('a_saka', 'ally', 'yari', 0, 160, N, G('sakakibara')), U('e_b', 'enemy', 'yumi', 20, 5, S, { aiRole: 'hold_line' })]));
        issueOrder(s, 'a_saka', { type: 'move', x: 0, z: 60 });
        expect(get(s, 'a_saka').initiative!.free).toBe(false);
        advance(s, 60, (x) => {
            if (!get(x, 'a_saka').initiative!.free) expect(get(x, 'a_saka').order.type).toBe('move');
        });
        const g = get(s, 'a_saka').initiative!;
        expect(g.free).toBe(true);
        expect(Math.hypot(g.postX - 0, g.postZ - 60)).toBeLessThan(10);
        expect(generalEvents(s, 'a_saka').length).toBe(1);
    });
    it('プレイヤーの攻撃の相手が崩れて待機になったときは、自由な動きに戻さない（その場で次の命令を待つ）', () => {
        const s = createBattle(
            setup([
                U('a_saka', 'ally', 'yari', 0, 40, N, { ...G('sakakibara'), strength: 600 }),
                U('e_y', 'enemy', 'yari', 0, 15, S, { strength: 120, morale: 30, aiRole: 'hold_line' }),
                U('e_b', 'enemy', 'yumi', 40, 0, S, { aiRole: 'hold_line' }),
            ]),
        );
        issueOrder(s, 'a_saka', { type: 'attack', targetId: 'e_y' });
        advance(s, 30);
        expect(get(s, 'e_y').status).not.toBe('ready');
        expect(get(s, 'a_saka').initiative!.free).toBe(false);
        expect(generalEvents(s, 'a_saka')).toEqual([]);
    });
    it('全軍撤退の後は動かない', () => {
        const s = createBattle(setup([U('a_saka', 'ally', 'yari', 0, 60, N, G('sakakibara')), U('a_other', 'ally', 'yari', 150, 150, N), U('e_b', 'enemy', 'yumi', 20, 5, S, { aiRole: 'hold_line' })]));
        orderAllRetreat(s);
        advance(s, 5);
        expect(generalEvents(s, 'a_saka')).toEqual([]);
        expect(get(s, 'a_saka').order.type).toBe('retreat');
    });
});
