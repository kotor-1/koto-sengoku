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
 * - 村落：広場を固める → 420 秒・損害 21.3％で勝つ（副目標 3 つとも ✓）。通りの口を分けて予備を回す（今の台本）→ 223 秒に負け（損害 34.1％）。
 *   （家屋・石垣を挟んだ相手と斬り合わない直しの前は、広場 18.5％・分ける 218 秒・30.8％（西の騎馬 ✓）。家屋越しに斬り合えていた分、損害が少なかった）
 *   無計画 → 163 秒に負け（損害 36.2％）。待つ（村の南のまま）→ 110 秒に負け（屋敷前を 15 秒奪われる）。
 * - 寺社周辺：分けて入る → 239 秒・損害 30.1％で勝つ（16 通りで 16 勝）。準備した石段の攻め → 日没（損害 25.8％。山門は取るが本堂前へ
 *   届かない）。無計画 → 331 秒に負け（損害 53.6％）。
 * - 城下町外縁：進路を見て組み替える → 420 秒・損害 36.5％で勝つ（突破 2 以内）。大通りに集中・出口の前で受ける・無計画・待つ →
 *   どれも 227 秒に 3 部隊目が抜けて負ける（損害 12〜37％。出口の前で受けるは直しの前 39.2％ → 37.4％）。
 * - 城攻め前面：側面の拠点を先に → 353 秒・損害 40.5％で勝つ（拠点の弓 ✓）。弓で櫓を射すくめる → 397 秒・損害 36.9％で勝つ（16 通りで 12 勝）。
 *   無計画 → 366 秒・損害 45.4％で勝つ（拠点の弓 ✗）。
 *
 * 今の結果（各戦場の釣り合いの調整と、第3群の動きの直し FieldRules.refinedMoves の後。早送り）：
 * - 湿地（湿地の調整 8ff4319 の後）：足場を伝う → 314 秒・12.7％で勝つ（16 通りで 16 勝）。最初の案の土手道の台本（causeway）は勝てなくなった
 *   （調整の後 日没・30.8％。動きの直しの後 日没・56.6％・2 部隊だけ抜ける）。準備した土手道の攻めは tests/proto3d-field-marsh.test.ts の PREP
 *   （283 秒・20.5％で勝ち、16 通りで 16 勝）で確かめる。無計画 → 日没・48.7％（直しの前は 325 秒に負け・37.1％）。
 *   待機の味方に塞がれた移動のすり抜け（RULES.squeezeHoldSec）の後、最初の案の土手道の台本は 254 秒・36.0％で勝つ。
 * - 村落（村落の調整の後）：広場を固める → 420 秒・21.5％で勝つ。無計画 → 174 秒に負け・35.4％。分ける（shift）→ 311 秒に負け・39.8％。
 * - 寺社周辺（寺社周辺の調整 3bed681 の後）：分けて入る → 242 秒・30.7％で勝つ（16 通りで 16 勝）。準備した石段の攻め → 日没（調整の後 22.2％、
 *   動きの直しの後 33.1％）。無計画 → 敵をすべて崩して勝つ（調整の後 455 秒・48.8％、動きの直しの後 380 秒・34.0％。建物の角の手前で止まって
 *   射られ続けていた部隊が、角を回って斬り合うようになった）。
 * - 城下町外縁（調整の後）：組み替える → 420 秒・32.9％で勝つ。大通り・出口の前・無計画・待つ → 3 部隊目が抜けて負け（245〜336 秒）。
 * - 城攻め前面（調整の後）：拠点を先に → 281 秒・27.9％（動きの直しの後 293 秒・28.4％）。弓で櫓を射すくめる → 255 秒・23.8％。
 *   無計画 → 459 秒に総崩れ・61.0％（門は開くが曲輪に届かない）。押し離しの直し（separate が石垣を越えて押さない）の後は、448 秒に
 *   敵の諸隊をすべて崩して勝つ・53.0％（曲輪の確保へは届かない。拠点の弓 ✓）。ほかの台本は同じ。
 *
 * 確かめの指摘への直しの後（早送り。ほかの台本の結果は 1 刻みも同じことを、直しの前のエンジンと比べて確かめた。足場を伝うだけ変わった）：
 * - 止まっている味方どうしの押し離しで島・土手道から泥へ押し出さない（sim.ts separate）：湿地の足場を伝う 314 秒・12.7％ → 302 秒・12.4％。
 *   無計画 日没・48.7％ → 223 秒に負け（戦える隊が足りなくなる）・37.7％。
 * - 道の無い相手（櫓台の上・閉じた門の向こう）への攻撃を断る（sim.ts meleeUnreachable。台本の「一番近い敵」も、断られない敵から選ぶ）と、
 *   取る目標では敵がすべて崩れても主目標を果たすまで勝ちにしない（sim.ts needsOwnDeed）：
 *   寺社周辺の無計画 380 秒に敵をすべて崩して勝つ・34.0％ → 敵はすべて崩すが二つの輪を同時に確保せず日没・34.0％。
 *   城攻め前面の無計画 448 秒に敵をすべて崩して勝つ・53.0％ → 門の前の輪を占めないまま日没・31.6％（櫓台の足元で立ち続けなくなった）。
 */
import { describe, expect, it } from 'vitest';
import { RULES } from '../proto3d/src/battle/sim';
import { buildBattleSetup, getField, validateField } from '../proto3d/src/battle/fields';
import { brief, jitter, play, secondaryOf, type Run, type Step } from './proto3d-group3-helpers';
import { parsePracticeData, practiceResultInfo, recordFromOutcome } from '../proto3d/src/campaign/practice';
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
    it('足場を伝って西から回る：4 部隊が出口へ抜けて勝つ。最初の案の土手道の台本とは、損害・副目標で分かれる（準備した土手道の攻めの比べは tests/proto3d-field-marsh.test.ts）', () => {
        expect(won(r.west!), brief(r.west!)).toBe(true);
        expect([secondaryOf(r.west!, 'marsh_losses'), secondaryOf(r.west!, 'marsh_block')]).toEqual([true, false]);
        // 最初の案の土手道の台本（押さえを正面と西の泥から押すだけ）：押さえは崩すが、損害が大きい（記録：湿地の調整の後は日没で勝てない。
        // 準備した土手道（先駆けの号で東の弓を崩す・両翼の采配・号令）は湿地のテストの PREP で勝つ）。
        // 待機の味方に塞がれた移動のすり抜け（sim.ts の stuckNearGoal・RULES.squeezeHoldSec。土手道で待機する味方の後ろで出口へ向かう部隊が
        // 「道を塞がれて先へ進めない」の待機になっていた）の後は、日没・56.6％・2 部隊だけ抜ける → 254 秒・36.0％で勝つ（押さえ ✓・損害 ✗・島 ✗）。
        // 勝ち負けの記録を外し、足場を伝う作戦との損害・副目標の分かれ方の比べにする
        expect(secondaryOf(r.causeway!, 'marsh_block')).toBe(true);
        expect(r.causeway!.loss).toBeGreaterThan(r.west!.loss + 0.1);
        expect([secondaryOf(r.causeway!, 'marsh_losses'), secondaryOf(r.west!, 'marsh_block')]).toEqual([false, false]);
    });
    it('比べ：無計画な攻撃は、足場を伝う作戦より損害が大きく、出口へ抜けた部隊が少ない（記録：223 秒に負け・損害 37.7％。前は日没・48.7％・抜けたのは 1 部隊）', () => {
        const entered = (x: Run) => x.s.objectives!.primary!.entered.length;
        expect(r.unplanned!.loss).toBeGreaterThan(r.west!.loss + 0.2);
        expect(entered(r.unplanned!)).toBeLessThan(entered(r.west!));
        // 記録
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
    // 寺社周辺の調整（3bed681）の前は「準備した石段の攻めは無計画より損害が小さい（25.8％ 対 53.6％）・無計画は負ける」を確かめていた。
    // 調整の後は無計画も敵をすべて崩して勝つ（455 秒・48.8％）、第3群の動きの直しの後は 380 秒・34.0％、石段の攻め（最初の案の台本）は日没・33.1％で、
    // 損害の差がほとんど無い。「正面・無計画なら負ける」は合格条件にしないので、分けて入る作戦との比べにする。
    // 準備した正面攻撃（全軍で石段から）の比べは tests/proto3d-field-temple.test.ts
    it('比べ：分けて入る作戦は、無計画な攻撃より早く主目標に届き、損害も小さい（記録：無計画は 380 秒に敵をすべて崩すが二つの輪を確保せず日没・34.0％（直しの前はそこで勝ち）。石段の攻めは日没）', () => {
        expect(r.split!.t).toBeLessThan(r.unplanned!.t - 60);
        expect(r.split!.loss).toBeLessThan(r.unplanned!.loss);
        // 記録
        expect(r.front!.o.reason).toBe('nightfall');
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
    // 押し離しの直し（sim.ts の separate：押す先までまっすぐ通れるときだけ押す。門の前の部隊が石垣を越えて曲輪へ抜けていた）の前は、
    // 無計画は 459 秒に負け（ally_army_broken）・61.0％・拠点の弓 ✗。直しの後は 448 秒に敵の諸隊をすべて崩して勝つ（enemy_army_broken）・
    // 53.0％・拠点の弓 ✓（すべて崩したので）。「無計画は拠点の弓を崩さない」を外し、計画した作戦どうしの分かれ方と損害の比べにした
    it('比べ：計画した作戦では、拠点を先に落とす作戦だけが副目標（拠点の弓を崩す）を果たす。弓で櫓を射すくめる作戦は、無計画な攻撃より損害が小さい（記録：無計画は門を開けず日没・損害 31.6％。直しの前は敵の諸隊をすべて崩して勝つ・53.0％）', () => {
        expect(secondaryOf(r.bastion!, 'siege_bastion')).toBe(true);
        expect(secondaryOf(r.archers!, 'siege_bastion')).toBe(false);
        expect(r.archers!.loss).toBeLessThan(r.unplanned!.loss);
        expect(r.hold!.o.objectives!.primary!.steps).toEqual({ done: 0, total: 2 });
    });
    it('安定性：弓で櫓を射すくめる作戦は ±15 秒の 16 通りで 10 勝以上（作った時 12 勝。釣り合いの担当が上げる）', () => {
        expect(wins(jitter('siege_front', SIEGE_PLANS.archers))).toBeGreaterThanOrEqual(10);
    }, 120000);
});

describe('記録（演習の保存）：段階目標はどの段まで届いたかも残す', () => {
    it('早送り：城攻め前面を待つだけで終えると、記録の主目標に段 0／2。勝てば 2／2。古い形（段の無い記録）もそのまま読める', () => {
        const f = getField('siege_front')!;
        const lose = play('siege_front', SIEGE_PLANS.hold);
        const win = play('siege_front', SIEGE_PLANS.bastion);
        const rl = recordFromOutcome(lose.o, f.objectives.primary.id, new Date(0));
        const rw = recordFromOutcome(win.o, f.objectives.primary.id, new Date(0));
        expect(rl.primary).toEqual({ id: 'siege_seq', achieved: false, steps: { done: 0, total: 2 } });
        expect(rw.primary).toEqual({ id: 'siege_seq', achieved: true, steps: { done: 2, total: 2 } });
        const json = JSON.stringify({ version: 1, records: { siege_front: { plays: 2, last: rl, best: rw } } });
        expect(parsePracticeData(json)?.records.siege_front?.last.primary.steps).toEqual({ done: 0, total: 2 });
        // 段の無い古い記録（第1群・第2群）は今までどおり読める。段の数がおかしい記録は読まない
        const old = JSON.stringify({ version: 1, records: { plains: { plays: 1, last: { ...rl, primary: { id: 'x', achieved: false } }, best: { ...rl, primary: { id: 'x', achieved: false } } } } });
        expect(parsePracticeData(old)?.records.plains?.last.primary).toEqual({ id: 'x', achieved: false });
        const bad = JSON.stringify({ version: 1, records: { siege_front: { plays: 1, last: { ...rl, primary: { id: 'x', achieved: false, steps: { done: 3, total: 2 } } }, best: rl } } });
        expect(parsePracticeData(bad)).toBeNull();
        // 結果の画面の主目標の行に「（段階 0／2 まで）」
        const info = practiceResultInfo(f, lose.o, { ok: false, reason: 'unavailable', message: '' });
        expect(info.primary.label).toBe('外門を制圧し、最初の曲輪を確保する（段階 0／2 まで）');
    });
});
