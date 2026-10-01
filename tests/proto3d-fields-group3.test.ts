/**
 * 第3群の 5 戦場（湿地・村落・寺社周辺・城下町外縁・城攻め前面）の最初の案（docs/fields-group3-design.md §4）。
 * データの形・検査・主目標に届く作戦（早送りの台本。tests/proto3d-fields-group3-plans.ts）と、作戦どうしの比べ
 * （損害・時間・副目標・突破の数）を確かめる。釣り合いの調整は後の担当（数字は作った時の値。調整で変えるときは理由と前後の数字を残す）。
 *
 * 「正面なら必ず負ける」は合格条件にしない。無計画な攻撃（全部隊で一番近い敵へ当て直すだけ）・待つだけの結果は、比べと記録として書く。
 * どれも「早送り」（決まった時刻・見てから押す行で issueOrder を出し、runToEnd で最後まで進める）。
 *
 * 作った時の結果（早送り。±15 秒の 16 通りは時刻の行だけをずらす。0 秒と「見てから押す」行だけの台本は 1 通りと同じ）：
 * - 湿地：足場を伝う → 320 秒・損害 11.6％で勝つ（損害 ✓・押さえ ✗。16 通りで 16 勝）。準備した土手道の攻め → 277 秒・損害 32.5％で勝つ
 *   （損害 ✗・押さえ ✓。16 通りで 7 勝＝時刻のずれに弱い。釣り合いの担当へ）。無計画 → 日没・損害 32.6％。待つ → 日没・損害 0。
 * - 村落：広場を固める → 420 秒・損害 18.5％で勝つ（副目標 3 つとも ✓）。通りの口を分けて予備を回す（今の台本）→ 218 秒に負け（損害 30.8％）。
 *   無計画 → 163 秒に負け（損害 36.2％）。待つ（村の南のまま）→ 110 秒に負け（屋敷前を 15 秒奪われる）。
 * - 寺社周辺：分けて入る → 239 秒・損害 30.1％で勝つ（16 通りで 16 勝）。準備した石段の攻め → 日没（損害 25.8％。山門は取るが本堂前へ
 *   届かない）。無計画 → 331 秒に負け（損害 53.6％）。
 * - 城下町外縁：進路を見て組み替える → 420 秒・損害 36.5％で勝つ（突破 2 以内）。大通りに集中・出口の前で受ける・無計画・待つ →
 *   どれも 227 秒に 3 部隊目が抜けて負ける（損害 12〜39％）。
 * - 城攻め前面：側面の拠点を先に → 353 秒・損害 40.5％で勝つ（拠点の弓 ✓）。弓で櫓を射すくめる → 397 秒・損害 36.9％で勝つ（16 通りで 12 勝）。
 *   無計画 → 366 秒・損害 45.4％で勝つ（拠点の弓 ✗）。
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '../proto3d/src/battle/sim';
import { buildBattleSetup, getField, validateField } from '../proto3d/src/battle/fields';
import { brief, jitter, play, secondaryOf, type Run, type Step } from './proto3d-group3-helpers';
import { MARSH_PLANS, SIEGE_PLANS, TEMPLE_PLANS, TOWN_PLANS, VILLAGE_PLANS } from './proto3d-fields-group3-plans';

const G3 = ['marsh', 'village', 'temple', 'town_edge', 'siege_front'] as const;
const won = (r: Run) => r.o.result === 'victory' && r.o.objectives?.primary?.achieved === true;
const wins = (rs: Run[]) => rs.filter(won).length;

describe('第3群の 5 戦場のデータ', () => {
    it('検査を通る。主目標は敵本陣の撃破ではない。武将の自由な動き・演習の編成 standard・部隊数の上限（増援を含めて味方 8・敵 10）', () => {
        const primaries = new Set<string>();
        for (const id of G3) {
            const f = getField(id)!;
            expect([id, validateField(f)]).toEqual([id, []]);
            expect(f.objectives.primary.type).not.toBe('destroy_hq');
            primaries.add(f.objectives.primary.type);
            expect(f.generalInitiative).toBe(true);
            expect(f.presets.map((p) => p.id)).toEqual(['standard']);
            const us = f.presets[0]!.units;
            expect(us.filter((u) => u.side === 'ally').length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.ally);
            expect(us.filter((u) => u.side === 'enemy').length).toBeLessThanOrEqual(RULES.maxUnitsPerSide.enemy);
            // 徳川の 5 武将（generalId）と能力
            for (const g of ['ieyasu', 'tadakatsu', 'sakakibara', 'sakai', 'ishikawa']) expect(us.some((u) => u.generalId === g)).toBe(true);
            expect(buildBattleSetup(f, 'standard').generalInitiative).toBe(true);
        }
        // 主目標の種類は 5 戦場で別々（突破・区域の防衛・同時確保・突破を抑える・段階目標）
        expect([...primaries].sort()).toEqual(['breakthrough', 'defend_time', 'hold_zones', 'limit_breakthrough', 'sequence']);
    });

    it('地形の使い方が戦場ごとに違う（背景の色・名前だけのコピーではない）', () => {
        const kinds = (id: string) => new Set(getField(id)!.terrain.map((a) => a.kind));
        expect(kinds('marsh').has('marsh') && kinds('marsh').has('dry')).toBe(true);
        expect(kinds('village').has('building') && kinds('village').has('fence')).toBe(true);
        expect(kinds('temple').has('hill') && kinds('temple').has('cliff') && kinds('temple').has('building')).toBe(true);
        expect(kinds('town_edge').has('building') && kinds('town_edge').has('wall')).toBe(true);
        expect(kinds('siege_front').has('wall') && (getField('siege_front')!.gates ?? []).length).toBeTruthy();
    });
});

function plays(field: string, plans: Record<string, Step[]>): Record<string, Run> {
    return Object.fromEntries(Object.entries(plans).map(([k, p]) => [k, play(field, p)]));
}

describe('湿地（早送り）', () => {
    const r = plays('marsh', MARSH_PLANS);
    it('足場を伝って西から回る：4 部隊が出口へ抜けて勝つ。準備した土手道の攻めも勝つ。二つは時間・損害・副目標で分かれる', () => {
        expect(won(r.west!), brief(r.west!)).toBe(true);
        expect(won(r.causeway!), brief(r.causeway!)).toBe(true);
        // 土手道は早いが損害が大きい。足場は遅いが損害が少ない
        expect(r.causeway!.t).toBeLessThan(r.west!.t);
        expect(r.causeway!.loss).toBeGreaterThan(r.west!.loss + 0.1);
        expect([secondaryOf(r.west!, 'marsh_losses'), secondaryOf(r.west!, 'marsh_block')]).toEqual([true, false]);
        expect([secondaryOf(r.causeway!, 'marsh_losses'), secondaryOf(r.causeway!, 'marsh_block')]).toEqual([false, true]);
    });
    it('比べ：無計画な攻撃は、足場を伝う作戦より損害が大きく、日没までに抜けられない（記録：日没・損害 32.6％）', () => {
        expect(r.unplanned!.loss).toBeGreaterThan(r.west!.loss);
        expect(r.unplanned!.o.objectives!.primary!.achieved).toBe(false);
        expect(r.hold!.o.reason).toBe('nightfall');
    });
    it('安定性：足場を伝う作戦は ±15 秒の 16 通りで 16 勝', () => {
        expect(wins(jitter('marsh', MARSH_PLANS.west))).toBe(16);
    }, 120000);
});

describe('村落（早送り）', () => {
    const r = plays('village', VILLAGE_PLANS);
    it('広場を固める：屋敷前を 7 分守って勝つ', () => {
        expect(won(r.plaza!), brief(r.plaza!)).toBe(true);
        expect(r.plaza!.t).toBeCloseTo(420, 5);
    });
    it('比べ：無計画な攻撃は広場を固めるより損害が大きい。待つだけ（村の南のまま）では、第一波に屋敷前を奪われる（記録：110 秒に負け）', () => {
        expect(r.unplanned!.loss).toBeGreaterThan(r.plaza!.loss);
        expect(r.hold!.o.objectives!.primary!.achieved).toBe(false);
        expect(r.hold!.t).toBeLessThan(r.plaza!.t);
    });
});

describe('寺社周辺（早送り）', () => {
    const r = plays('temple', TEMPLE_PLANS);
    it('分けて入る（石段から山門、東の脇道から本堂前）：二所を同時に 60 秒確保して勝つ。±15 秒の 16 通りで 16 勝', () => {
        expect(won(r.split!), brief(r.split!)).toBe(true);
        expect(wins(jitter('temple', TEMPLE_PLANS.split))).toBe(16);
    }, 120000);
    it('比べ：準備した石段の攻め（弓で山門の弓を射すくめてから登る）は、無計画な攻撃より損害が小さい（記録：山門は取るが、本堂前まで届かず日没）', () => {
        expect(r.front!.loss).toBeLessThan(r.unplanned!.loss);
        expect(r.unplanned!.o.objectives!.primary!.achieved).toBe(false);
    });
});

describe('城下町外縁（早送り）', () => {
    const r = plays('town_edge', TOWN_PLANS);
    const broke = (x: Run) => x.s.objectives!.primary!.entered.length;
    it('進路を見て組み替える：7 分まで突破を 2 部隊以内に抑えて勝つ（突破は部隊単位で数える）', () => {
        expect(won(r.watch!), brief(r.watch!)).toBe(true);
        expect(broke(r.watch!)).toBeLessThanOrEqual(2);
    });
    it('比べ：大通りに集中・出口の前で受ける・無計画・待つは、組み替えより多く抜けられる（記録：どれも 3 部隊目が抜けて負け）', () => {
        for (const k of ['main', 'exits', 'unplanned', 'hold'] as const) {
            expect(broke(r[k]!), k).toBeGreaterThan(broke(r.watch!));
            expect(r[k]!.o.objectives!.primary!.achieved, k).toBe(false);
        }
        // 大通りに集中した方が、損害そのものは組み替えより小さい（脇道・門口を通す代わりに斬り合いが少ない）
        expect(r.main!.loss).toBeLessThan(r.watch!.loss);
    });
});

describe('城攻め前面（早送り）', () => {
    const r = plays('siege_front', SIEGE_PLANS);
    it('側面の拠点を先に落とす・弓で櫓を射すくめる：どちらも外門を開き、曲輪を確保して勝つ（段階目標の 2 段とも）', () => {
        for (const k of ['bastion', 'archers'] as const) {
            expect(won(r[k]!), brief(r[k]!)).toBe(true);
            expect(r[k]!.o.objectives!.primary!.steps).toEqual({ done: 2, total: 2 });
        }
    });
    it('比べ：拠点を先に落とす作戦だけが副目標（拠点の弓を崩す）を果たす。弓で櫓を射すくめる作戦は、無計画な攻撃より損害が小さい（記録：無計画も勝つ・損害 45.4％）', () => {
        expect(secondaryOf(r.bastion!, 'siege_bastion')).toBe(true);
        expect(secondaryOf(r.archers!, 'siege_bastion')).toBe(false);
        expect(secondaryOf(r.unplanned!, 'siege_bastion')).toBe(false);
        expect(r.archers!.loss).toBeLessThan(r.unplanned!.loss);
        expect(r.hold!.o.objectives!.primary!.steps).toEqual({ done: 0, total: 2 });
    });
    it('安定性：弓で櫓を射すくめる作戦は ±15 秒の 16 通りで 10 勝以上（作った時 12 勝。釣り合いの担当が上げる）', () => {
        expect(wins(jitter('siege_front', SIEGE_PLANS.archers))).toBeGreaterThanOrEqual(10);
    }, 120000);
});
