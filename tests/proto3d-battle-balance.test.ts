/**
 * 合戦の釣り合い（国境の原・協力陣営ごとの標準の布陣 demoSetup）。
 * 利用者の采配の台本（proto3d/src/battle/scripts.ts）で最後まで進め、次を確かめる：
 * - 何もしない（全部隊待機）では勝てない。
 * - 全軍で正面から丘を押すと負ける（勝てても大きな損害）。
 * - 別働隊・予備隊・側面を使う采配なら勝てる（損害も正面押しより少ない）。反応が数秒遅れても勝てる。
 * - 全軍撤退は「撤退」、時間切れは「撤退（日没）」、味方本陣の敗走は「敗北」（本陣は敗走で、全滅ではない）。
 * - 同じ采配なら同じ結果。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, runToEnd, type BattleState } from '../proto3d/src/battle/sim';
import { BORDER_FIELD, BORDER_FIELD_TIME_LIMIT, TASHIRO_ARRIVE_SEC, demoSetup, demoUnits, type Alliance } from '../proto3d/src/battle/maps';
import { inTerrain } from '../proto3d/src/battle/sim';
import type { BattleOutcome } from '../proto3d/src/battle/types';
import { frontalNoHqScript, frontalScript, holdScript, hqAloneScript, planScript, retreatAt, type Script } from '../proto3d/src/battle/scripts';

const ALLIANCES: Alliance[] = ['tashiro', 'omori', 'alone'];

function play(alliance: Alliance, script: Script): { r: BattleOutcome; s: BattleState } {
    const s = createBattle(demoSetup(alliance));
    const r = runToEnd(s, script);
    return { r, s };
}
/** 味方の兵の損害の割合 */
function allyLoss(r: BattleOutcome): number {
    const us = r.units.filter((u) => u.side === 'ally');
    const start = us.reduce((a, u) => a + u.startStrength, 0);
    const end = us.reduce((a, u) => a + u.endStrength, 0);
    return 1 - end / start;
}
/** 刻みごとでなく、period 秒ごとにしか命令を出さない（利用者の反応の遅れ） */
function slow(script: Script, period: number): Script {
    let last = -1;
    return (s) => {
        const k = Math.floor(s.t / period);
        if (k === last) return;
        last = k;
        script(s);
    };
}

describe('協力陣営の選択で、合戦の所属と布陣が変わる', () => {
    it('どの選択でも味方 4・敵 4 部隊、本陣は各 1、id は重ならず、戦場の中にいる', () => {
        for (const al of ALLIANCES) {
            const us = demoUnits(al);
            expect(us.filter((u) => u.side === 'ally')).toHaveLength(4);
            expect(us.filter((u) => u.side === 'enemy')).toHaveLength(4);
            expect(us.filter((u) => u.side === 'ally' && u.kind === 'honjin')).toHaveLength(1);
            expect(us.filter((u) => u.side === 'enemy' && u.kind === 'honjin')).toHaveLength(1);
            expect(new Set(us.map((u) => u.id)).size).toBe(8);
            for (const u of us) {
                expect(Math.abs(u.x)).toBeLessThanOrEqual(BORDER_FIELD.width / 2);
                expect(Math.abs(u.z)).toBeLessThanOrEqual(BORDER_FIELD.depth / 2);
            }
        }
    });

    it('田代と組む：田代騎馬隊が 40 秒後に左の林へ着く味方の別働隊。大森槍隊は敵に付き、右から回り込む', () => {
        const us = demoUnits('tashiro');
        const cav = us.find((u) => u.id === 'a_tashiro')!;
        expect(cav).toMatchObject({ side: 'ally', clan: 'tashiro', kind: 'kiba', arriveAt: TASHIRO_ARRIVE_SEC, leaderId: 'tashiro_envoy' });
        expect(inTerrain(BORDER_FIELD, 'woods', cav.x, cav.z)).toBe(true);
        const om = us.find((u) => u.clan === 'omori')!;
        expect(om).toMatchObject({ side: 'enemy', kind: 'yari', aiRole: 'flank' });
        expect(om.x).toBeGreaterThan(0);
    });

    it('大森と組む：大森槍隊は最初から味方の右翼。田代騎馬隊は敵に付き、左の林から回り込む', () => {
        const us = demoUnits('omori');
        const om = us.find((u) => u.clan === 'omori')!;
        expect(om).toMatchObject({ side: 'ally', kind: 'yari', leaderId: 'omori_envoy' });
        expect(om.arriveAt).toBeUndefined();
        expect(om.x).toBeGreaterThan(0);
        const cav = us.find((u) => u.clan === 'tashiro')!;
        expect(cav).toMatchObject({ side: 'enemy', kind: 'kiba', aiRole: 'flank' });
        expect(inTerrain(BORDER_FIELD, 'woods', cav.x, cav.z)).toBe(true);
    });

    it('独力：田代・大森はどちらも出ない。互いに予備隊を持つ', () => {
        const us = demoUnits('alone');
        expect(us.some((u) => u.clan === 'tashiro' || u.clan === 'omori')).toBe(false);
        expect(us.find((u) => u.id === 'a_reserve')).toMatchObject({ side: 'ally', clan: 'kotosaka', kind: 'yari' });
        expect(us.find((u) => u.id === 'e_reserve')).toMatchObject({ side: 'enemy', clan: 'washio', aiRole: 'reserve' });
    });

    it('兵・士気は差し替えられる（章の進行が、前の出来事の結果を反映する）', () => {
        const us = demoUnits('alone', { strength: { a_genzo: 420 }, morale: { a_hq: 70 } });
        expect(us.find((u) => u.id === 'a_genzo')!.strength).toBe(420);
        expect(us.find((u) => u.id === 'a_hq')!.morale).toBe(70);
        const setup = demoSetup('alone');
        expect(setup.timeLimitSec).toBe(BORDER_FIELD_TIME_LIMIT);
        expect(setup.briefing.join('')).toContain('仮シナリオ');
        expect(setup.briefing.join('')).toContain('勝利');
        expect(setup.briefing.join('')).toContain('敗北');
        expect(setup.briefing.join('')).toContain('撤退');
    });
});

describe.each(ALLIANCES)('合戦の釣り合い（%s）', (alliance) => {
    it('何もしない（全部隊待機）では勝てない', () => {
        const { r } = play(alliance, holdScript);
        expect(r.result).not.toBe('victory');
    });

    it('全軍（本陣も）で正面から丘を押すと負ける（勝てても大きな損害）', () => {
        const { r } = play(alliance, frontalScript);
        expect(r.result !== 'victory' || allyLoss(r) >= 0.45).toBe(true);
        expect(r.result).toBe('defeat');
    });

    it('本陣以外で正面から丘を押しても負ける', () => {
        const { r } = play(alliance, frontalNoHqScript);
        expect(r.result).toBe('defeat');
        expect(allyLoss(r)).toBeGreaterThan(0.3);
    });

    it('別働隊・予備隊・側面を使う采配なら勝てる（正面押しより損害が少ない）', () => {
        const { r, s } = play(alliance, planScript(alliance));
        expect(r.result).toBe('victory');
        expect(allyLoss(r)).toBeLessThan(0.4);
        expect(allyLoss(r)).toBeLessThan(allyLoss(play(alliance, frontalScript).r));
        // 側面・背後を突いた知らせが出ている
        expect(s.events.some((e) => (e.kind === 'flank' || e.kind === 'rear') && s.units.find((u) => u.id === e.unitId)?.side === 'ally')).toBe(true);
        expect(r.elapsedSec).toBeLessThan(BORDER_FIELD_TIME_LIMIT);
    });

    it('采配の命令が数秒遅れても勝てる', () => {
        for (const period of [2, 5]) {
            const { r } = play(alliance, slow(planScript(alliance), period));
            expect(r.result).toBe('victory');
        }
    });

    it('全軍撤退を命じると「撤退」で終わる（兵は残る）', () => {
        const { r, s } = play(alliance, retreatAt(30));
        expect(r.result).toBe('retreat');
        expect(r.reason).toBe('ordered_retreat');
        expect(r.elapsedSec).toBeLessThanOrEqual(30 + 20 + 0.2);
        const allies = r.units.filter((u) => u.side === 'ally');
        expect(allies.every((u) => u.status === 'withdrawn')).toBe(true);
        expect(allyLoss(r)).toBeLessThan(0.1);
        expect(s.events.some((e) => e.kind === 'retreat_all')).toBe(true);
    });

    it('本陣だけで突っ込むと本陣が敗走して「敗北」。若殿の本陣は敗走で、全滅ではない', () => {
        const { r } = play(alliance, hqAloneScript());
        expect(r.result).toBe('defeat');
        expect(r.reason).toBe('ally_hq_routed');
        const hq = r.units.find((u) => u.id === 'a_hq')!;
        expect(hq.leaderId).toBe('hero');
        expect(hq.status).toBe('routed');
        expect(hq.endStrength).toBeGreaterThan(0);
    });

    it('同じ采配なら同じ結果になる', () => {
        const a = play(alliance, planScript(alliance));
        const b = play(alliance, planScript(alliance));
        expect(b.r).toEqual(a.r);
        expect(b.s.events).toEqual(a.s.events);
    });
});

describe('時間切れ', () => {
    it('独力で何もしなければ、日没まで動かず「撤退（日没）」', () => {
        const { r } = play('alone', holdScript);
        expect(r.result).toBe('retreat');
        expect(r.reason).toBe('nightfall');
        expect(r.elapsedSec).toBe(BORDER_FIELD_TIME_LIMIT);
    });
});
