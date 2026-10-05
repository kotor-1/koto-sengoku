/**
 * 第二章の開始直後の全軍撤退（依頼 docs/chapter2-request-2.md【2】）。
 * 判断：撤収の対象（家康本陣・織田勢の後備え・小荷駄）が実際に退き口から離脱して主目標を満たした勝利なら、有効な作戦の 1 つとして残す。
 * 命令を押しただけで即勝利する・主目標に含まれる撤収の対象を置き去りにして勝つ、場合だけ判定を直す（最低戦闘時間・強制交戦・新しい敵の増援は足さない）。
 *
 * 確かめ（どれも「早送り」：合戦の計算を台本で最後まで進める。画面の操作ではない。「状態を直接変える」行は、その旨を書いた）：
 * - A 判断 1 の全軍撤退で勝ったとき、勝利の時点で家康本陣と必ず離れる 2 隊が、どれも退き口の区域から離脱済み（目標の entered・status withdrawn。
 *   離脱した刻みに区域の中にいた）。勝利の時刻は、その 3 隊のうち一番遠い隊が退き口の区域まで歩くのにかかる時間（いちばん速い地形で、まっすぐ）より後。
 * - 撤収の対象を置き去りにしたら勝たない（徳川だけ退く：早送り）。撤収の対象を崩した・退き口でない所から退かせたら勝たない（状態を直接変える）。
 * - 副目標（損害・忠勝隊）は主目標の勝利と別の欄（合戦の結果・戦後の記録・区切りの記録）。第二章には約束が無いので、結果に約束の欄が出ない。
 * - B・C の開始直後の全軍撤退は勝利にならない（撤退＝合戦の放棄）。
 * 演習の戦場の判定（objectives.ts・sim.ts）は変えていない（不具合が無かった）。
 */
import { describe, expect, it } from 'vitest';
import { createBattle, KIND_STATS, runToEnd, type BattleState } from '../proto3d/src/battle/sim';
import { objectiveResultModel, pledgeResultModel } from '../proto3d/src/battle/control';
import type { BattleSetup, Zone } from '../proto3d/src/battle/types';
import { CH2_UNIT, type Ch2Plan } from '../proto3d/src/campaign/ieyasu1570/chapter2/battle';
import { CH2_TIERS, RETREAT, ch2TacticScript, ch2TierAvailable, stepScript, type Ch2Step, type Ch2Tier } from '../proto3d/src/campaign/ieyasu1570/chapter2/scripts';
import { applyIeyasu2OutcomeOnce, finishTalkIeyasu2, ieyasu2BattleSetup, withIeyasu2BattleId } from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import { ieyasu2EndingView } from '../proto3d/src/campaign/ieyasu1570/chapter2/story';
import { IEYASU_UNIT_IDS } from '../proto3d/src/battle/maps';
import { ch2Info, fmt, log, sixteenCh2, summarize } from './proto3d-ieyasu-ch2-battle-helpers';
import { ch2From, toCh2Battle, toCh2Muster } from './proto3d-ieyasu-ch2-helpers';

const LEAVERS = [IEYASU_UNIT_IDS.honjin, CH2_UNIT.odaRear, CH2_UNIT.odaBaggage];
const A_TIERS = CH2_TIERS.filter((t) => ch2TierAvailable('oda', 'commit', t));

/** 区域（長方形）までのまっすぐの距離 */
function distToZone(z: Zone, x: number, zz: number): number {
    if (!('rect' in z) || !z.rect) throw new Error('長方形の区域だけ');
    const r = z.rect;
    const dx = Math.max(r.x0 - x, 0, x - r.x1);
    const dz = Math.max(r.z0 - zz, 0, zz - r.z1);
    return Math.hypot(dx, dz);
}

/** その戦場でいちばん速い地形の速さの倍率（部隊の種類ごと。既定の地面は 1） */
function maxTerrainFactor(s: BattleState, kind: keyof typeof KIND_STATS): number {
    let m = 1;
    for (const r of Object.values(s.field.terrain)) m = Math.max(m, r.speed * (r.kindSpeed[kind] ?? 1));
    return m;
}

/** 1 回の合戦（台本 sc）を、撤収の対象が離脱した刻みの時刻・位置を記録しながら最後まで。edit は毎刻みに状態を直接変える（省けば変えない） */
function playWatch(setup: BattleSetup, sc: (s: BattleState) => void, edit?: (s: BattleState) => void) {
    const s = createBattle(setup);
    const leftAt: Record<string, { t: number; x: number; z: number }> = {};
    const zone = (setup.objectives!.primary as { exit: Zone }).exit;
    const prevPos: Record<string, { x: number; z: number }> = {};
    // 毎刻みの前に見る（離脱した刻みの直前の位置を残す）。最後の刻み（勝利の刻み）の離脱は、終わった後にもう一度見る
    const watch = (st: BattleState) => {
        for (const id of LEAVERS) {
            const u = st.units.find((x) => x.id === id)!;
            if (u.status === 'withdrawn' && !leftAt[id]) leftAt[id] = { t: st.t, ...(prevPos[id] ?? { x: u.x, z: u.z }) };
            if (u.present) prevPos[id] = { x: u.x, z: u.z };
        }
    };
    const o = runToEnd(s, (st) => {
        sc(st);
        edit?.(st);
        watch(st);
    });
    watch(s);
    return { s, o, leftAt, zone };
}

describe('A 判断 1：開始直後の全軍撤退の勝利は、撤収の対象が実際に退き口から離脱した結果', () => {
    for (const tier of A_TIERS) {
        it(`${tier}：勝利の時点で 3 隊とも離脱済み・勝利は一番遠い隊が歩いて着くより後・副目標は別の欄`, () => {
            const info = ch2Info('oda', 'commit', tier);
            const setup = info.setup;
            const runs = Array.from({ length: 4 }, (_, k) => playWatch(setup, ch2TacticScript('oda', 'all_retreat', setup, k)));
            const bounds: number[] = [];
            for (const { s, o, leftAt, zone } of runs) {
                expect(o.result).toBe('victory');
                expect(o.reason).toBe('objective_done');
                expect(o.withdrawal).toBe('objective');
                const P = s.objectives!.primary!;
                expect(P.state).toBe('done');
                // 勝利の時点で、家康本陣と必ず離れる 2 隊が、どれも退き口から離脱済み（目標に数えた・撤退済み）
                for (const id of LEAVERS) {
                    expect(P.entered, `${tier} ${id}`).toContain(id);
                    const u = s.units.find((x) => x.id === id)!;
                    expect(u.status, `${tier} ${id}`).toBe('withdrawn');
                    // 離脱した刻みの直前の位置は退き口の区域の中か、その縁（歩いて入った。区域の外から消えたのではない）
                    const at = leftAt[id]!;
                    expect(distToZone(zone, at.x, at.z), `${tier} ${id} (${at.x.toFixed(1)},${at.z.toFixed(1)})`).toBeLessThan(2);
                }
                // 勝利の時刻 ≥ 3 隊それぞれが退き口の区域まで歩くのにかかる最短の時間（まっすぐ・いちばん速い地形・能力なし）
                expect(Object.keys(o.abilitiesUsed ?? {}).length).toBe(0);
                let bound = 0;
                for (const id of LEAVERS) {
                    const d = setup.units.find((u) => u.id === id)!;
                    const v = KIND_STATS[d.kind].speed * maxTerrainFactor(s, d.kind);
                    const need = distToZone(zone, d.x, d.z) / v;
                    expect(leftAt[id]!.t, `${tier} ${id}`).toBeGreaterThanOrEqual(need);
                    bound = Math.max(bound, need);
                }
                expect(s.t).toBeGreaterThanOrEqual(bound);
                expect(s.t).toBeGreaterThan(20);
                bounds.push(bound);
                // 副目標は主目標と別の欄（合戦の結果）。約束の欄は出ない（第二章には約束が無い）
                const model = objectiveResultModel(o)!;
                expect(model.primary).toEqual({ label: setup.objectives!.primary!.label, achieved: true });
                expect(model.secondary.map((r) => r.label)).toEqual(setup.objectives!.secondary!.map((d) => d.label));
                expect(o.pledge).toBeUndefined();
                expect(pledgeResultModel(s, o)).toBeNull();
            }
            const sum = summarize(sixteenCh2('oda', 'commit', tier, 'all_retreat'));
            const rh = summarize(sixteenCh2('oda', 'commit', tier, 'rear_hold'));
            const last = (r: (typeof runs)[number]) => LEAVERS.map((id) => `${id} ${r.leftAt[id]!.t.toFixed(1)}`).join('・');
            log(`A 全軍撤退 ${tier}：離脱した時刻（揺らぎ 0）${last(runs[0]!)} 秒・勝利 ${runs.map((r) => r.s.t.toFixed(1)).join('／')} 秒（3 隊が歩いて着く最短の時間の下限 ${bounds[0]!.toFixed(1)} 秒）／ 16 通り ${fmt(sum)} ／ 殿を残す rear_hold ${fmt(rh)}`);
        }, 60_000);
    }
});

describe('A 判断 1：撤収の対象を置き去りにしたら勝たない', () => {
    const tokugawaOnly: Ch2Step[] = (['t_honjin', 't_tadakatsu', 't_yumi', 't_reserve'] as const).map((id) => [0.1, id, RETREAT] as Ch2Step);
    for (const tier of A_TIERS) {
        it(`${tier}：徳川の部隊だけ撤退の命令で退く（織田勢は動かさない。早送り）→ 勝利にならない`, () => {
            const setup = ch2Info('oda', 'commit', tier).setup;
            const { s, o } = playWatch(setup, stepScript(tokugawaOnly, setup));
            expect(o.result, `${tier} ${o.reason}`).not.toBe('victory');
            expect(s.objectives!.primary!.state).not.toBe('done');
            log(`A 徳川だけ退く ${tier}：${o.result}（${o.reason}）・${s.t.toFixed(0)} 秒`);
        }, 60_000);
    }

    const editAt = (t: number, f: (s: BattleState) => void) => {
        let done = false;
        return (s: BattleState) => {
            if (done || s.t < t) return;
            done = true;
            f(s);
        };
    };
    const unit = (s: BattleState, id: string) => s.units.find((u) => u.id === id)!;

    it('状態を直接変える：全軍撤退の途中で織田勢の小荷駄を崩す（敗走）→ 勝利にならない（主目標を果たせない）', () => {
        const setup = ch2Info('oda', 'commit', 'typical').setup;
        const { s, o } = playWatch(setup, ch2TacticScript('oda', 'all_retreat', setup), editAt(10, (st) => (unit(st, CH2_UNIT.odaBaggage).status = 'routed')));
        expect(o.result).not.toBe('victory');
        expect(s.objectives!.primary!.state).toBe('failed');
        expect(s.objectives!.primary!.entered).not.toContain(CH2_UNIT.odaBaggage);
    }, 60_000);

    for (const id of [CH2_UNIT.odaRear, IEYASU_UNIT_IDS.honjin]) {
        it(`状態を直接変える：全軍撤退の途中で ${id} を退き口でない所から戦場を離れさせる → 勝利にならない`, () => {
            const setup = ch2Info('oda', 'commit', 'typical').setup;
            const zone = (setup.objectives!.primary as { exit: Zone }).exit;
            const { s, o } = playWatch(
                setup,
                ch2TacticScript('oda', 'all_retreat', setup),
                editAt(10, (st) => {
                    const u = unit(st, id);
                    expect(distToZone(zone, u.x, u.z)).toBeGreaterThan(20);
                    u.status = 'withdrawn';
                    u.present = false;
                }),
            );
            expect(o.result).not.toBe('victory');
            expect(s.objectives!.primary!.entered).not.toContain(id);
        }, 60_000);
    }
});

describe('A：全軍撤退の勝利を、キャンペーンの戦後・区切りの記録で主目標と副目標を分けて残す', () => {
    it('実物の保存（織田・勝利・約束を守った）→ 判断 1 → 全軍撤退（早送り）→ 戦後の記録・区切りの記録', () => {
        let b = toCh2Battle(toCh2Muster(ch2From('oda_victory_kept'), 'commit'), 'none');
        b = withIeyasu2BattleId(b, 'ieyasu1570-r-1');
        const setup = ieyasu2BattleSetup(b);
        const s = createBattle(setup);
        const o = runToEnd(s, ch2TacticScript('oda', 'all_retreat', setup));
        expect(o.result).toBe('victory');
        const a = applyIeyasu2OutcomeOnce(b, 'ieyasu1570-r-1', o).state;
        const r = a.result!;
        expect(r.primary).toMatchObject({ id: 'ch2_oda_withdraw', achieved: true });
        expect(r.secondary.map((x) => x.id)).toEqual(['ch2_oda_losses', 'ch2_oda_tadakatsu']);
        // 副目標の結果は合戦の結果のとおり（主目標の勝利とは別。全軍撤退は殿の忠勝隊が追い討ちで崩れやすい）
        for (const x of r.secondary) expect(x.achieved).toBe(o.objectives!.secondary.find((y) => y.id === x.id)!.achieved);
        expect(r.withdrawal).toBe('objective');
        const e = ieyasu2EndingView(finishTalkIeyasu2(a, 'tadakatsu', 'end_chapter'));
        const rows = Object.fromEntries(e.record.map((x) => [x.label, x.value]));
        expect(rows['主目標']).toContain('果たした');
        expect(rows['副目標']).toContain('損害を 2 割以内に抑える');
        expect(rows['副目標']).toContain('本多忠勝隊を崩さずに退く');
        expect(rows['合戦の兵']).toMatch(/^出陣 [\d,]+・失った [\d,]+・残った [\d,]+/);
        // 第二章の約束の欄は無い（第一章の行に第一章の約束が出るだけ）
        expect(e.record.some((x) => x.label === '約束')).toBe(false);
        expect(pledgeResultModel(s, o)).toBeNull();
        log(`A 全軍撤退（キャンペーン）：${o.elapsedSec.toFixed(0)} 秒・主目標 ${r.primary!.achieved}・副目標 ${r.secondary.map((x) => `${x.id} ${x.achieved}`).join('・')}・${rows['合戦の兵']}`);
    }, 60_000);
});

describe('B・C：開始直後の全軍撤退は勝利にならない（撤退＝合戦の放棄。救う相手が先に戦場を離れると主目標を果たせず敗北のこともある）', () => {
    const tiers = (p: 'asai' | 'home', plan: Ch2Plan): Ch2Tier[] => CH2_TIERS.filter((t) => ch2TierAvailable(p, plan, t));
    for (const p of ['asai', 'home'] as const) {
        for (const plan of ['commit', 'hold'] as Ch2Plan[]) {
            it(`${p} ${plan}：どの段階でも勝利にならず、主目標は果たせない（撤退は合戦の放棄）`, () => {
                for (const tier of tiers(p, plan)) {
                    const setup = ch2Info(p, plan, tier).setup;
                    for (let k = 0; k < 4; k++) {
                        const s = createBattle(setup);
                        const o = runToEnd(s, ch2TacticScript(p, 'all_retreat', setup, k));
                        const tag = `${p} ${plan} ${tier} ${k} ${o.result} ${o.reason}`;
                        expect(o.result, tag).not.toBe('victory');
                        expect(o.objectives!.primary!.achieved, tag).toBe(false);
                        if (o.result === 'retreat') {
                            expect(o.reason, tag).toBe('ordered_retreat');
                            if (setup.endRules) expect(o.withdrawal, tag).toBe('abandoned');
                        } else {
                            // B：孤立した浅井勢が合流の前に戦場を離れた・崩れた（もう連れ帰れない）→ 主目標を果たせず敗北
                            expect(p, tag).toBe('asai');
                            expect(o.reason, tag).toBe('objective_failed');
                        }
                        if (k === 0) log(`${p} ${plan} ${tier} 全軍撤退：${o.result}（${o.reason}${o.withdrawal ? `・${o.withdrawal}` : ''}）・${s.t.toFixed(0)} 秒`);
                    }
                }
            }, 60_000);
        }
    }
});
