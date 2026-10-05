/**
 * 第二章 C「領内の村を守る」（村落の地形）の釣り合い。設計 docs/chapter2-design.md §5〜§7、記録 docs/chapter2-battles.md。
 * 主目標：庄屋の屋敷前を 6 分守る（兵が少ないときは、村の者を南へ逃がす 3 分）。敵だけが 15 秒続けて輪を占めると負け。
 *
 * どれも「早送り」（chapter2/scripts.ts の台本を runToEnd で最後まで。画面の操作ではない）。16 通りのずらし（種 7）で数える。
 * 第一章の結果の段階は tests/proto3d-ieyasu-ch2-battle-oda.test.ts の見出しと同じ（C は守備隊も第一章に出ていたので、損害が守備隊にも出る）。
 *
 * 合格の目安（「正面なら負ける」を合格の条件にしない）：
 * - 判断ごと・段階ごとに、筋の通った作戦が 16 通りの過半で勝つ（広場で囲む trap・本陣も加わる trap_hq・米蔵へ回す trap_store のどれか）。
 * - 判断 1 と判断 2 で、損害・残る部隊・副目標が分かれる（判断 1 は守備隊を米蔵へ回せる）。
 * - 目標を考えない手（何もしない・開始直後の全軍撤退・近い敵へ当て直すだけ）が、考えた作戦より明らかに良くならない。
 * - 支援（村の衆）の有無・補充で待ったかどうかで、結果が違う（数字は記録）。
 */
import { describe, expect, it } from 'vitest';
import { CH2_TIERS, ch2Tactics, ch2TierAvailable, ch2TierInput, type Ch2Tier } from '../proto3d/src/campaign/ieyasu1570/chapter2/scripts';
import { CH2_UNIT, ch2BattleSetup, type Ch2BattleInfo, type Ch2Plan } from '../proto3d/src/campaign/ieyasu1570/chapter2/battle';
import { ch2Info, densest, fmt, log, playCh2, sixteenCh2, summarize, type Ch2Summary } from './proto3d-ieyasu-ch2-battle-helpers';

const P = 'home' as const;
const PLANS: Record<Ch2Plan, string[]> = { commit: ['trap', 'trap_hq', 'trap_store'], hold: ['trap', 'trap_hq'] };
const cells = (['commit', 'hold'] as Ch2Plan[]).flatMap((plan) => CH2_TIERS.filter((t) => ch2TierAvailable(P, plan, t)).map((tier) => ({ plan, tier })));
const clearlyBetter = (n: Ch2Summary, best: Ch2Summary) => n.wins > best.wins || (n.wins === best.wins && n.wins > 0 && n.loss < best.loss - 0.01 && n.secTotal >= best.secTotal);
const bestOf = (plan: Ch2Plan, tier: Ch2Tier) =>
    PLANS[plan].map((id) => ({ id, s: summarize(sixteenCh2(P, plan, tier, id)) })).sort((a, b) => b.s.wins - a.s.wins || a.s.loss - b.s.loss)[0]!;

describe('C：台本は画面で出せる命令の数・間隔', () => {
    it('命令は 40 回まで・10 秒に 8 回まで・断られた命令なし（揺らぎ無し・typical）', () => {
        for (const plan of ['commit', 'hold'] as Ch2Plan[]) {
            for (const t of ch2Tactics(P, plan)) {
                const r = playCh2(ch2Info(P, plan, 'typical'), P, t.id);
                expect(r.cmds.length, `${plan} ${t.id}`).toBeLessThanOrEqual(40);
                expect(densest(r), `${plan} ${t.id}`).toBeLessThanOrEqual(8);
                expect(r.refused, `${plan} ${t.id}`).toEqual([]);
            }
        }
    }, 60_000);
});

describe('C：判断ごと・段階ごとに勝てる作戦がある（16 通りの過半）', () => {
    for (const { plan, tier } of cells) {
        for (const id of PLANS[plan]) {
            it(`${plan}・${tier}：${id}（数える）`, () => {
                const s = summarize(sixteenCh2(P, plan, tier, id));
                log(`C ${plan} ${tier} ${id}: ${fmt(s)}`);
            }, 60_000);
        }
        it(`${plan}・${tier}：勝てる作戦がある`, () => {
            const b = bestOf(plan, tier);
            expect(b.s.wins, `${b.id} ${fmt(b.s)}`).toBeGreaterThan(8);
        }, 60_000);
    }
    it('兵が少ないとき（thin）は守る時間が 3 分。判断 2 は minimum では軍議で選べない', () => {
        expect(ch2Info(P, 'commit', 'weak').thin).toBe(true);
        expect(ch2Info(P, 'commit', 'weak').setup.objectives!.primary).toMatchObject({ type: 'defend_time', sec: 180 });
        expect(ch2Info(P, 'commit', 'typical').setup.objectives!.primary).toMatchObject({ type: 'defend_time', sec: 360 });
        expect(ch2TierAvailable(P, 'hold', 'minimum')).toBe(false);
    });
});

describe('C：判断 1 と判断 2 の違い', () => {
    for (const tier of ['strong', 'typical'] as Ch2Tier[]) {
        it(`${tier}：判断 1 は守備隊を米蔵へ回して米蔵を守れる（判断 2 は守れない）。損害・残る部隊も違う`, () => {
            const store = summarize(sixteenCh2(P, 'commit', tier, 'trap_store'));
            const c = bestOf('commit', tier);
            const h = bestOf('hold', tier);
            log(`C 判断の違い ${tier}: 判断 1 ${c.id} ${fmt(c.s)}・trap_store ${fmt(store)} ／ 判断 2 ${h.id} ${fmt(h.s)}`);
            expect(store.sec['ch2_home_store']!).toBeGreaterThan(8);
            for (const id of PLANS.hold) expect(summarize(sixteenCh2(P, 'hold', tier, id)).sec['ch2_home_store']!).toBe(0);
            expect(Math.abs(c.s.tokLoss - h.s.tokLoss)).toBeGreaterThan(0.005);
        }, 120_000);
    }
});

describe('C：目標を考えない手は、考えた作戦より明らかに良くならない', () => {
    for (const { plan, tier } of cells.filter((c) => c.tier === 'strong' || c.tier === 'typical' || c.tier === 'minimum')) {
        it(`${plan}・${tier}`, () => {
            const b = bestOf(plan, tier);
            for (const t of ch2Tactics(P, plan, 'naive')) {
                const n = summarize(sixteenCh2(P, plan, tier, t.id));
                log(`C ${plan} ${tier} 目標を考えない手 ${t.id}: ${fmt(n)} ／ 最良 ${b.id}: ${fmt(b.s)}`);
                expect(clearlyBetter(n, b.s), `${t.id} ${fmt(n)} ／ ${b.id} ${fmt(b.s)}`).toBe(false);
            }
        }, 120_000);
    }
});

describe('C：minimum で補充しない（守備隊が 40 未満で出ず、家康本陣だけで出る。記録だけ・勝敗は強制しない）', () => {
    // 軍議の時の兵（第一章の終わり）のまま出る：本陣 100・忠勝隊 10・弓隊 10・守備隊 10 → 出るのは家康本陣だけ
    const input = () => ch2TierInput(P, 'commit', 'minimum', { noRecovery: true });
    it('出陣は家康本陣だけ・守る時間は 3 分', () => {
        const info = ch2BattleSetup(input());
        expect(info.sortie).toEqual(['honjin']);
        expect(info.setup.objectives!.primary).toMatchObject({ type: 'defend_time', sec: 180 });
    });
    for (const id of ['trap', 'trap_hq', 'trap_store', 'nothing', 'all_retreat', 'rush']) {
        it(`minimum・補充なし：${id}（数える）`, () => {
            const s = summarize(sixteenCh2(P, 'commit', 'minimum', id, (i) => Object.assign(i, input()), 'norecovery'));
            log(`C commit minimum 補充なし ${id}: ${fmt(s)}`);
            expect(s.wins).toBeGreaterThanOrEqual(0);
        }, 60_000);
    }
});

describe('C：第一章の結果が効く（支援・補充）', () => {
    it('支援：村の衆（第一章の勝ち）がいると、いないとき（状態を直接変える：設定から村の衆を除く）と結果が違う', () => {
        for (const plan of ['commit', 'hold'] as Ch2Plan[]) {
            const info = ch2BattleSetup(ch2TierInput(P, plan, 'strong'));
            expect(info.support).toEqual(['village']);
            const without: Ch2BattleInfo = { ...info, setup: { ...info.setup, units: info.setup.units.filter((u) => u.id !== CH2_UNIT.village) } };
            const id = PLANS[plan][0]!;
            const a = summarize(Array.from({ length: 16 }, (_, k) => playCh2(info, P, id, k)));
            const b = summarize(Array.from({ length: 16 }, (_, k) => playCh2(without, P, id, k)));
            log(`C 支援 ${plan} ${id}: 村の衆あり ${fmt(a)} ／ なし ${fmt(b)}`);
            expect(a.loss !== b.loss || a.wins !== b.wins).toBe(true);
        }
    }, 180_000);
    it('補充で待つ：兵が戻り（25%）、次の波が 40 秒早く着く。待たないときと結果が違う（判断 1 は兵が 650 を超えても、軍議で決めた 3 分のまま）', () => {
        for (const plan of ['commit', 'hold'] as Ch2Plan[]) {
            const no = bestOf(plan, 'weak');
            const wait = bestOf(plan, 'weakwait');
            log(`C 補充 ${plan}: 待たない ${no.id} ${fmt(no.s)} ／ 待つ ${wait.id} ${fmt(wait.s)}`);
            expect(no.s.loss !== wait.s.loss || no.s.winSec !== wait.s.winSec || no.s.wins !== wait.s.wins).toBe(true);
        }
        // 主目標の条件は軍議の時（補充の前）の兵で確定する（依頼 docs/chapter2-request-2.md【1】。前は補充の後の兵で求めて 6 分になっていた）
        expect(ch2Info(P, 'commit', 'weakwait').thin).toBe(true);
        expect(ch2Info(P, 'commit', 'weakwait').setup.objectives!.primary).toMatchObject({ type: 'defend_time', sec: 180 });
    }, 180_000);
});
