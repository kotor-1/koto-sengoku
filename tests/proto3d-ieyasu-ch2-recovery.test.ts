/**
 * 第二章の補充（設計 §5.2）・判断が選べないとき・兵が少ないとき（§5.3）・開始時から達成できない設定にならないこと。
 * - 3 つの選択肢の数・代償・1 回だけ・上限（各部隊は第一章のはじめの兵まで。守備隊は 100 未満にしない）。
 * - 判断 2 が選べないときは選択肢に出さず、理由を述べる。兵が少ないときは調整を述べる。
 * - どの第一章の結果・判断・補充でも、合戦の設定の検査（validateChapter2Setup）が空（最少の兵でも）。
 *   検査は通れる所・行ける所を道の計算で調べるので重い（空いた時でも数秒）。その 2 件は it(…, 60_000)（vitest.config.mjs の決まり）。
 */
import { describe, expect, it } from 'vitest';
import { FlowError } from '../proto3d/src/campaign/flow';
import { CH2_RULES, ch2BattleSetup, validateChapter2Setup } from '../proto3d/src/campaign/ieyasu1570/chapter2/battle';
import {
    CH2_RECOVERY,
    availableCh2Plans,
    ch2Losses,
    ch2RecoveryOptions,
    devIeyasuCh1Ending,
    finishTalkIeyasu2,
    ieyasu2BattleInput,
    ieyasu2BattleSetup,
    legalIeyasu2Choices,
    startChapter2,
    talkIeyasu2,
} from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import type { RecoveryChoice } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { INITIAL_TOKUGAWA_TROOPS, TOKUGAWA_UNIT_IDS } from '../proto3d/src/campaign/ieyasu1570/state';
import { snapshot } from './proto3d-campaign-helpers';
import { CH1_ENDINGS, ch2From, toCh2Battle, toCh2Muster } from './proto3d-ieyasu-ch2-helpers';

const total = (t: Record<string, number>) => TOKUGAWA_UNIT_IDS.reduce((n, k) => n + t[k]!, 0);

describe('補充の 3 つの選択肢', () => {
    it('待つ：各部隊の失った兵の 25%（石川の信頼 ≥ 45 なら 40%）を切り捨てで戻す。代償は敵の後詰めが早く着く', () => {
        for (const name of CH1_ENDINGS) {
            const m = toCh2Muster(ch2From(name));
            const o = ch2RecoveryOptions(m);
            const rate = m.trust.ishikawa >= CH2_RECOVERY.trustedAt ? CH2_RECOVERY.trustedRate : CH2_RECOVERY.rate;
            const lost = ch2Losses(m.troops);
            for (const k of TOKUGAWA_UNIT_IDS) {
                expect(o.wait.delta[k], `${name} ${k}`).toBe(Math.floor(lost[k] * rate));
                expect(m.troops[k] + o.wait.delta[k]).toBeLessThanOrEqual(INITIAL_TOKUGAWA_TROOPS[k]);
            }
            if (o.wait.available) {
                const after = finishTalkIeyasu2(m, 'ishikawa', 'recovery_wait');
                for (const k of TOKUGAWA_UNIT_IDS) expect(after.troops[k]).toBe(m.troops[k] + o.wait.delta[k]);
                expect(after.recovery).toEqual({ choice: 'wait', delta: o.wait.delta });
                expect(ieyasu2BattleInput(after).waited).toBe(true);
            }
        }
        // 信頼による割合の違い（同じ損害で比べる）
        const s = toCh2Muster(ch2From('oda_defeat_broken_heavy'));
        expect(ch2RecoveryOptions({ troops: s.troops, trust: { ...s.trust, ishikawa: 44 } }).wait.rate).toBe(CH2_RECOVERY.rate);
        expect(ch2RecoveryOptions({ troops: s.troops, trust: { ...s.trust, ishikawa: 45 } }).wait.rate).toBe(CH2_RECOVERY.trustedRate);
    });

    it('待った時の代償：敵の後詰め・次の波が早く着く（合戦の設定の waited）', () => {
        for (const name of ['oda_defeat_broken_heavy', 'asai_defeat_broken_heavy', 'home_defeat_broken_heavy'] as const) {
            const m = toCh2Muster(ch2From(name));
            const w = ieyasu2BattleSetup(toCh2Battle(m, 'wait'));
            const n = ieyasu2BattleSetup(toCh2Battle(m, 'none'));
            const late = n.units.filter((u) => u.arriveAt !== undefined);
            expect(late.length, name).toBeGreaterThan(0);
            // 後詰め・次の波（合戦の担当が決めた組）は waitDelaySec 早く着く。ほかの時刻の敵（伏兵など）は遅くならない
            let earlier = 0;
            for (const u of late) {
                const wu = w.units.find((x) => x.id === u.id)!;
                const d = u.arriveAt! - wu.arriveAt!;
                expect(d === 0 || d === Math.min(CH2_RULES.waitDelaySec, u.arriveAt! - 1), `${name} ${u.id} ${d}`).toBe(true);
                if (d > 0) earlier++;
            }
            expect(earlier, name).toBeGreaterThan(0);
            // 説明・選択肢にも代償の秒数が出る
            const sc = talkIeyasu2(m, 'ishikawa');
            expect(sc.choices!.find((c) => c.id === 'recovery_wait')!.detail).toContain(`${CH2_RULES.waitDelaySec} 秒早く`);
        }
    });

    it('守備隊から回す：最大 150・守備隊は 100 未満にしない・足りない割合の大きい部隊から・各部隊は上限まで・合計は変わらない', () => {
        for (const name of CH1_ENDINGS) {
            const m = toCh2Muster(ch2From(name));
            const o = ch2RecoveryOptions(m).transfer;
            if (!o.available) {
                expect(o.reason).toBeTruthy();
                expect(legalIeyasu2Choices(m)).not.toContain('recovery_transfer');
                expect(talkIeyasu2(m, 'ishikawa').choices!.map((c) => c.id)).not.toContain('recovery_transfer');
                expect(talkIeyasu2(m, 'ishikawa').lines.map((l) => l.text).join('')).toContain(o.reason!);
                continue;
            }
            expect(-o.delta.reserve).toBeLessThanOrEqual(CH2_RECOVERY.transferMax);
            expect(m.troops.reserve + o.delta.reserve).toBeGreaterThanOrEqual(CH2_RECOVERY.reserveFloor);
            expect(total(o.delta)).toBe(0);
            const after = finishTalkIeyasu2(m, 'ishikawa', 'recovery_transfer');
            expect(total(after.troops)).toBe(total(m.troops));
            for (const k of TOKUGAWA_UNIT_IDS) expect(after.troops[k]).toBeLessThanOrEqual(INITIAL_TOKUGAWA_TROOPS[k]);
        }
        // 損害の大きい A：忠勝隊（失った割合が最も大きい）から先に埋まる
        const heavy = toCh2Muster(ch2From('oda_defeat_broken_heavy'));
        const t = ch2RecoveryOptions(heavy).transfer;
        expect(t.delta.tadakatsu).toBe(150);
        expect(t.delta.reserve).toBe(-150);
        // C の損害の大きい保存は守備隊が 30：回せない
        const homeHeavy = toCh2Muster(ch2From('home_defeat_broken_heavy'));
        expect(ch2RecoveryOptions(homeHeavy).transfer.available).toBe(false);
        // 兵が満ちていれば回す先が無い・待っても戻らない
        const full = { troops: { ...INITIAL_TOKUGAWA_TROOPS }, trust: heavy.trust };
        expect(ch2RecoveryOptions(full).transfer.available).toBe(false);
        expect(ch2RecoveryOptions(full).wait.available).toBe(false);
        expect(ch2RecoveryOptions(full).none.available).toBe(true);
    });

    it('今の兵で出る：兵は変わらない', () => {
        const m = toCh2Muster(ch2From('oda_retreat_declined'));
        const after = finishTalkIeyasu2(m, 'ishikawa', 'recovery_none');
        expect(after.troops).toEqual(m.troops);
        expect(after.recovery!.choice).toBe('none');
        expect(ieyasu2BattleInput(after).waited).toBe(false);
    });

    it('1 回だけ：答えた後は選べない（会話に選択肢が無く、選ぶと FlowError）。「少し考える」は何も変えない', () => {
        const m = toCh2Muster(ch2From('asai_defeat_broken_heavy'));
        const later = finishTalkIeyasu2(m, 'ishikawa', 'recovery_later');
        expect(later.recovery).toBeNull();
        expect(later.troops).toEqual(m.troops);
        const done = finishTalkIeyasu2(later, 'ishikawa', 'recovery_wait');
        const snap = snapshot(done);
        expect(talkIeyasu2(done, 'ishikawa').choices).toBeUndefined();
        expect(() => finishTalkIeyasu2(done, 'ishikawa', 'recovery_wait')).toThrow(FlowError);
        for (const c of ['recovery_wait', 'recovery_transfer', 'recovery_none'] as const) expect(legalIeyasu2Choices(done)).not.toContain(c);
        // 話し直しても兵は増えない
        const again = finishTalkIeyasu2(done, 'ishikawa');
        expect(again.troops).toEqual(snap.troops);
    });

    it('答えるまで城門で出陣できない', () => {
        const m = toCh2Muster(ch2From('home_victory_kept'));
        const g = talkIeyasu2(m, 'gate');
        expect(g.id).toBe('ch2.muster.gate.recovery_pending');
        expect(g.choices).toBeUndefined();
        expect(() => finishTalkIeyasu2(m, 'gate', 'depart')).toThrow(FlowError);
        const r = finishTalkIeyasu2(m, 'ishikawa', 'recovery_none');
        expect(talkIeyasu2(r, 'gate').choices!.map((c) => c.id)).toEqual(['depart', 'stay']);
    });
});

describe('判断が選べないとき・兵が少ないとき', () => {
    for (const p of ['oda', 'asai', 'home'] as const) {
        it(`${p}：損害が大きいと判断 2 は選択肢に出ず、理由と兵が少ないときの調整を述べる`, () => {
            let s = ch2From(`${p}_defeat_broken_heavy`);
            s = finishTalkIeyasu2(s, 'tadakatsu', 'open_council');
            expect(availableCh2Plans(s)).toEqual(['commit']);
            const sc = talkIeyasu2(s, 'council');
            expect(sc.choices!.map((c) => c.id)).toEqual(['plan_commit']);
            const text = sc.lines.map((l) => l.text).join('\n');
            expect(text).toContain('は取れませぬ');
            expect(text).toContain('第一章の損害で兵が少ないため');
            expect(() => finishTalkIeyasu2(s, 'council', 'plan_hold')).toThrow(FlowError);
            // 選択肢の説明に数字（出る部隊・主目標・信頼・代償）
            const d = sc.choices![0]!.detail!;
            expect(d).toMatch(/出る部隊：家康本陣 \d+/);
            expect(d).toContain('主目標：');
            expect(d).toContain('戦後の信頼：');
            expect(d).toContain('代償：');
        });
    }
    it('損害が小さいと判断は 2 つとも選べ、兵が少ないときの調整は無い', () => {
        for (const p of ['oda', 'asai', 'home'] as const) {
            const s = finishTalkIeyasu2(ch2From(`${p}_victory_kept`), 'tadakatsu', 'open_council');
            expect(availableCh2Plans(s)).toEqual(['commit', 'hold']);
            const sc = talkIeyasu2(s, 'council');
            expect(sc.lines.map((l) => l.text).join('')).not.toContain('第一章の損害で兵が少ないため');
            // 判断 1 と判断 2 の説明は、出る兵・信頼の動きが違う
            const [a, b] = sc.choices!;
            expect(a!.detail).not.toBe(b!.detail);
        }
    });
});

describe('開始時から達成できない設定にならない（validateChapter2Setup が空）', () => {
    it('9 つの第一章の結末 × 選べる判断 × 選べる補充（最少の兵＝損害が大きく待った後を含む）', () => {
        let n = 0;
        for (const name of CH1_ENDINGS) {
            const s0 = ch2From(name);
            const council = finishTalkIeyasu2(s0, 'tadakatsu', 'open_council');
            for (const plan of availableCh2Plans(council)) {
                const m = toCh2Muster(s0, plan);
                const opts = ch2RecoveryOptions(m);
                for (const rec of ['wait', 'transfer', 'none'] as RecoveryChoice[]) {
                    if (!opts[rec].available) continue;
                    const b = toCh2Battle(m, rec);
                    const setup = ieyasu2BattleSetup(b);
                    expect(validateChapter2Setup(setup), `${name} ${plan} ${rec}`).toEqual([]);
                    n++;
                }
            }
        }
        expect(n).toBeGreaterThan(20);
    }, 60_000);
    it('第一章の 27 通り（直接作った状態）× 判断 × 補充でも空', () => {
        for (const p of ['oda', 'asai', 'home'] as const)
            for (const r of ['victory', 'retreat', 'defeat'] as const)
                for (const pl of ['kept', 'broken', 'declined'] as const)
                    for (const heavy of [false, true]) {
                        const s0 = startChapter2(devIeyasuCh1Ending(p, r, pl, { heavy }));
                        for (const plan of availableCh2Plans(s0)) {
                            const m = toCh2Muster(s0, plan);
                            const opts = ch2RecoveryOptions(m);
                            for (const rec of ['wait', 'transfer', 'none'] as RecoveryChoice[]) {
                                if (!opts[rec].available) continue;
                                const info = ch2BattleSetup(ieyasu2BattleInput(toCh2Battle(m, rec)));
                                expect(validateChapter2Setup(info.setup), `${p} ${r} ${pl} ${heavy} ${plan} ${rec}`).toEqual([]);
                            }
                        }
                    }
    }, 60_000);
});
