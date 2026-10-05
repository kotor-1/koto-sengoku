/**
 * 合戦の釣り合い（国境の原・協力陣営ごとの標準の布陣 demoSetup）。
 * 利用者の采配の台本（proto3d/src/battle/scripts.ts）で最後まで進め、次を確かめる：
 * - 何もしない（全部隊待機）では勝てない（目標を無視した手順の失敗）。
 * - 別働隊・予備隊・側面を使う采配なら勝てる。反応が数秒遅れても勝てる。
 * - 作戦の比べ：正面から丘を押す台本（本陣も・本陣以外）より、考えた采配の結果が下回らず、損害が少ない（本陣以外で押し続けたときと比べる）。
 *   正面の台本の勝敗・損害・時間は記録（合格条件にしない。docs/chapter2-request.md【1】「この台本が必ず負ける」を必須の合格条件にしない）。
 * - 全軍撤退は「撤退」、時間切れは「撤退（日没）」、味方本陣の敗走は「敗北」（本陣は敗走で、全滅ではない）。
 * - 同じ采配なら同じ結果。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, issueOrder, runToEnd, type BattleState } from '../proto3d/src/battle/sim';
import { BORDER_FIELD, BORDER_FIELD_TIME_LIMIT, TASHIRO_ARRIVE_SEC, demoSetup, demoUnits, type Alliance } from '../proto3d/src/battle/maps';
import { inTerrain } from '../proto3d/src/battle/sim';
import type { BattleOutcome } from '../proto3d/src/battle/types';
import { frontalNoHqScript, frontalScript, holdScript, hqAloneScript, lureScript, planScript, retreatAt, type Script } from '../proto3d/src/battle/scripts';
import { logRecord, outcomeRank } from './proto3d-record-log';

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

describe('家臣の助言どおりの采配（独力）', () => {
    it('弓で先手を丘から誘い出し、下りてきた先手を両の横から挟むと勝てる（反応が数秒遅れても）', () => {
        for (const period of [0, 2, 5]) {
            const { r, s } = play('alone', period ? slow(lureScript(), period) : lureScript());
            expect(r.result).toBe('victory');
            expect(s.events.some((e) => e.kind === 'ai' && e.text.includes('矢を嫌って打って出た'))).toBe(true);
            expect(s.events.some((e) => (e.kind === 'flank' || e.kind === 'rear') && e.unitId?.startsWith('a_'))).toBe(true);
        }
    });
});

describe.each(ALLIANCES)('合戦の釣り合い（%s）', (alliance) => {
    it('何もしない（全部隊待機）では勝てない', () => {
        const { r } = play(alliance, holdScript);
        expect(r.result).not.toBe('victory');
    });

    it('別働隊・予備隊・側面を使う采配なら勝てる', () => {
        const { r, s } = play(alliance, planScript(alliance));
        expect(r.result).toBe('victory');
        expect(allyLoss(r)).toBeLessThan(0.4);
        // 正面から押す台本との損害の比べは、下の「作戦の比べ」に置く
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

// 作戦の比べ（記録と相対の比べ）。正面から押す台本の勝敗・損害・時間は記録で、合格条件にしない（docs/chapter2-request.md【1】）。
// 合格条件は、考えた采配の結果が正面の台本の結果を下回らないこと（勝ち ＞ 撤退 ＞ 負け）と、損害の比べ（同じ数字・同じ向きのまま）。
// 記録（2026-10-05・782fefe の早送り。前はここで正面の台本の「負け」を expect していた）：
//   陣営      全軍（本陣も）で正面                 本陣以外で正面                       考えた采配
//   田代      負け（軍の崩壊）145.2 秒・損害 55.9％   負け（軍の崩壊）118.1 秒・48.4％       勝ち 146.8 秒・31.2％
//   大森      負け（本陣の敗走）75.7 秒・28.6％       負け（軍の崩壊）125.0 秒・50.6％       勝ち 246.6 秒・35.7％
//   独力      負け（本陣の敗走）131.9 秒・53.0％      負け（軍の崩壊）171.5 秒・49.2％       勝ち 240.2 秒・33.3％
//   独力で同じ 2 部隊を丘の上の先手へ正面から重ねる：撤退（日没）480 秒・34.6％ ／ 誘い出して挟む：勝ち 197.9 秒・31.4％
// 本陣ごと突っ込む正面押しは、本陣が早く崩れて合戦が早く終わるため、損害の比べ物にならない（大森では 28.6％で考えた采配より少ない）。
// 損害は、本陣を残して正面から押し続けたとき（最後まで斬り合う）と比べる。
describe.each(ALLIANCES)('作戦の比べ（%s）：正面から押す台本と考えた采配（正面の勝敗は記録）', (alliance) => {
    it('全軍（本陣も）で正面から丘を押す台本より、考えた采配の結果が下回らない', () => {
        const front = play(alliance, frontalScript).r;
        const plan = play(alliance, planScript(alliance)).r;
        logRecord(`国境の原（${alliance}）・全軍で正面`, { 結果: front.result, 理由: front.reason, 秒: front.elapsedSec, 損害: allyLoss(front) });
        expect(outcomeRank(plan.result)).toBeGreaterThanOrEqual(outcomeRank(front.result));
    });

    it('本陣以外で正面から丘を押し続ける台本より、考えた采配の結果が下回らず、損害が少ない', () => {
        const noHq = play(alliance, frontalNoHqScript).r;
        const plan = play(alliance, planScript(alliance)).r;
        logRecord(`国境の原（${alliance}）・本陣以外で正面`, { 結果: noHq.result, 理由: noHq.reason, 秒: noHq.elapsedSec, 損害: allyLoss(noHq) });
        logRecord(`国境の原（${alliance}）・考えた采配`, { 結果: plan.result, 理由: plan.reason, 秒: plan.elapsedSec, 損害: allyLoss(plan) });
        expect(outcomeRank(plan.result)).toBeGreaterThanOrEqual(outcomeRank(noHq.result));
        expect(allyLoss(plan)).toBeLessThan(allyLoss(noHq));
    });
});

describe('作戦の比べ（独力）：家臣の助言どおりの采配と、同じ 2 部隊で正面から重ねる台本', () => {
    it('丘の上の先手へ正面から重ねて当てるより、弓で誘い出して両の横から挟む方が、結果が下回らず損害が少ない（正面の勝敗は記録）', () => {
        const both: Script = (s) => {
            for (const id of ['a_genzo', 'a_reserve']) {
                const u = s.units.find((x) => x.id === id)!;
                if (u.order.type !== 'attack' && u.status === 'ready') issueOrder(s, id, { type: 'attack', targetId: 'e_sente' });
            }
        };
        const front = play('alone', both).r;
        const lure = play('alone', lureScript()).r;
        logRecord('国境の原（独力）・2 部隊で正面から重ねる', { 結果: front.result, 理由: front.reason, 秒: front.elapsedSec, 損害: allyLoss(front) });
        logRecord('国境の原（独力）・誘い出して挟む', { 結果: lure.result, 理由: lure.reason, 秒: lure.elapsedSec, 損害: allyLoss(lure) });
        expect(outcomeRank(lure.result)).toBeGreaterThanOrEqual(outcomeRank(front.result));
        expect(allyLoss(lure)).toBeLessThan(allyLoss(front));
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
