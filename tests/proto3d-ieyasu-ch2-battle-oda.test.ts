/**
 * 第二章 A「織田勢の撤収を支える」（退却戦の地形）の釣り合い。設計 docs/chapter2-design.md §5〜§7、記録 docs/chapter2-battles.md。
 * 主目標：家康本陣と、織田勢の後備え・小荷駄（必ず離れる部隊）が南の退き口から離脱する。
 *
 * どれも「早送り」（chapter2/scripts.ts の台本を runToEnd で最後まで。画面の操作ではない）。16 通りのずらし（種 7）で数える。
 * 第一章の結果の段階（ch2TierInput）：strong（勝ち・約束を守った）・typical（撤退・引き受けなかった）・weak（敗北・破った。補充なし）・
 * weakwait（weak の後に補充「待つ」）・minimum（忠勝隊・弓隊がほぼ全滅＋待つ。判断 2 は軍議で選べない）。
 *
 * 合格の目安（「正面なら負ける」「この手なら必ず負ける」は合格の条件にしない）：
 * - 判断ごと・段階ごとに、筋の通った作戦が 16 通りの過半で勝つ（判断 1：rear_hold、判断 2：meet）。
 * - 判断 1 と判断 2 で、時間・損害・残る部隊・副目標が分かれる。
 * - 目標を考えない手（何もしない・開始直後の全軍撤退・全部隊を同時に退き口へ）が、考えた作戦より明らかに良くならない
 *   （勝ち数が多い、または同じ勝ち数で損害が 1 ポイント以上少なく副目標も同じ以上、を「明らかに良い」とする）。
 *   開始直後の全軍撤退は、撤収の対象が実際に退き口から離脱した結果の勝利なら有効な作戦の 1 つ（依頼 docs/chapter2-request-2.md【2】。
 *   離脱の確かめは tests/proto3d-ieyasu-ch2-allretreat.test.ts）。代償として、殿を残す作戦より損害の割合・失った兵が大きく、副目標は同じ以下。
 * - 記録（CH2_LOG=1）：勝ち数・時間（全回の平均の所要時間）・出陣／損失／残存の兵・損害の割合・残る部隊・副目標（id ごとに果たした回数／16）。
 * - 支援（織田の鉄砲隊）の有無・補充で待ったかどうかで、結果（損害・時間・勝ち数）が違う（第一章の結果が効く裏付け。数字は記録）。
 */
import { describe, expect, it } from 'vitest';
import { CH2_TIERS, ch2Tactics, ch2TierAvailable, type Ch2Tier } from '../proto3d/src/campaign/ieyasu1570/chapter2/scripts';
import type { Ch2Plan } from '../proto3d/src/campaign/ieyasu1570/chapter2/battle';
import { ch2Info, densest, fmt, log, playCh2, sixteenCh2, summarize, type Ch2Summary } from './proto3d-ieyasu-ch2-battle-helpers';

const P = 'oda' as const;
const MAIN: Record<Ch2Plan, string> = { commit: 'rear_hold', hold: 'meet' };
const cells = (['commit', 'hold'] as Ch2Plan[]).flatMap((plan) => CH2_TIERS.filter((t) => ch2TierAvailable(P, plan, t)).map((tier) => ({ plan, tier })));
const clearlyBetter = (n: Ch2Summary, best: Ch2Summary) => n.wins > best.wins || (n.wins === best.wins && n.wins > 0 && n.loss < best.loss - 0.01 && n.secTotal >= best.secTotal);
const best = (plan: Ch2Plan, tier: Ch2Tier) =>
    ch2Tactics(P, plan, 'plan')
        .map((t) => ({ id: t.id, s: summarize(sixteenCh2(P, plan, tier, t.id)) }))
        .sort((a, b) => b.s.wins - a.s.wins || a.s.loss - b.s.loss)[0]!;

describe('A：台本は画面で出せる命令の数・間隔', () => {
    it('考えた作戦・目標を考えない手とも、命令は 40 回まで・10 秒に 8 回まで・断られた命令なし（揺らぎ無し・typical）', () => {
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

describe('A：判断ごと・段階ごとに勝てる作戦がある（16 通りの過半）', () => {
    for (const { plan, tier } of cells) {
        for (const t of ch2Tactics(P, plan, 'plan').filter((x) => x.id !== MAIN[plan])) {
            it(`${plan}・${tier}：${t.id}（数える）`, () => {
                log(`A ${plan} ${tier} ${t.id}: ${fmt(summarize(sixteenCh2(P, plan, tier, t.id)))}`);
            }, 60_000);
        }
        it(`${plan}・${tier}：${MAIN[plan]}`, () => {
            const s = summarize(sixteenCh2(P, plan, tier, MAIN[plan]));
            log(`A ${plan} ${tier} ${MAIN[plan]}: ${fmt(s)}`);
            expect(s.wins, fmt(s)).toBeGreaterThan(8);
        }, 60_000);
    }
    it('判断 2（退き口の手前を固める）は、第一章で忠勝隊・弓隊がほぼ全滅した段階（minimum）では軍議で選べない（判断 1 で進める）', () => {
        expect(ch2TierAvailable(P, 'hold', 'minimum')).toBe(false);
        expect(ch2TierAvailable(P, 'commit', 'minimum')).toBe(true);
    });
});

describe('A：判断 1 と判断 2 の違い（時間・損害・残る部隊・副目標）', () => {
    for (const tier of ['strong', 'typical', 'weak', 'weakwait'] as Ch2Tier[]) {
        it(`${tier}`, () => {
            const c = summarize(sixteenCh2(P, 'commit', tier, MAIN.commit));
            const h = summarize(sixteenCh2(P, 'hold', tier, MAIN.hold));
            log(`A 判断の違い ${tier}: 判断 1 ${fmt(c)} ／ 判断 2 ${fmt(h)}`);
            // 判断 2 は織田勢が北から戻るのを迎えに出るので時間がかかり、徳川の損害が大きい（判断 1 は守備隊も出す代わりに早く、損害が小さい）
            expect(h.winSec! - c.winSec!).toBeGreaterThan(3);
            expect(h.tokLoss - c.tokLoss).toBeGreaterThan(0.03);
        }, 60_000);
    }
});

describe('A：目標を考えない手は、考えた作戦より明らかに良くならない', () => {
    for (const { plan, tier } of cells) {
        it(`${plan}・${tier}`, () => {
            const b = best(plan, tier);
            for (const t of ch2Tactics(P, plan, 'naive')) {
                const n = summarize(sixteenCh2(P, plan, tier, t.id));
                log(`A ${plan} ${tier} 目標を考えない手 ${t.id}: ${fmt(n)} ／ 最良 ${b.id}: ${fmt(b.s)}`);
                expect(clearlyBetter(n, b.s), `${t.id} ${fmt(n)} ／ ${b.id} ${fmt(b.s)}`).toBe(false);
            }
            // 開始直後の全軍撤退は、勝てば有効な作戦の 1 つ（撤収の対象が退き口から離脱した結果。依頼【2】）。代償があることを確かめる：
            // 殿を残す作戦より損害の割合・失った兵（徳川）が大きく、殿の忠勝隊を崩さずに退く副目標・副目標の合計は同じ以下。
            // 前は副目標の合計が「より少ない」ことまで求めていたが、minimum は軍議の時の兵（400）で兵が少ないときの陣（本陣が切れ目寄り）に
            // 確定するようになり、全軍撤退の損害が 2 割を切って（20.4% → 18.4%）損害の副目標を果たし、殿を残す作戦（忠勝隊は兵 120 で
            // 3 割を保てず 0/16）と副目標の合計が並んだ（どちらも 16）。損害の代償（徳川 36.1% 対 14.5%・失った兵 240 対 96）は残る。
            if (plan === 'commit') {
                const ar = summarize(sixteenCh2(P, plan, tier, 'all_retreat'));
                const rh = summarize(sixteenCh2(P, plan, tier, 'rear_hold'));
                expect(ar.loss).toBeGreaterThan(rh.loss);
                expect(ar.tokLost).toBeGreaterThan(rh.tokLost);
                expect(ar.sec['ch2_oda_tadakatsu'] ?? 0).toBeLessThanOrEqual(rh.sec['ch2_oda_tadakatsu'] ?? 0);
                expect(ar.secTotal).toBeLessThanOrEqual(rh.secTotal);
            }
        }, 120_000);
    }
});

describe('A：第一章の結果が効く（支援・補充）', () => {
    it('支援：織田の鉄砲隊（織田の信頼 ≥ 50）がいると、いないとき（同じ勝ちで約束を引き受けなかった＝信頼 45）より損害・時間が違う', () => {
        for (const plan of ['commit', 'hold'] as Ch2Plan[]) {
            const withS = summarize(sixteenCh2(P, plan, 'strong', MAIN[plan]));
            const info = ch2Info(P, plan, 'strong', (i) => (i.trust.oda = 45), 'oda45');
            expect(info.support).toEqual([]);
            const noS = summarize(sixteenCh2(P, plan, 'strong', MAIN[plan], (i) => (i.trust.oda = 45), 'oda45'));
            log(`A 支援 ${plan}: 鉄砲隊あり ${fmt(withS)} ／ なし ${fmt(noS)}`);
            expect(withS.loss !== noS.loss || withS.winSec !== noS.winSec || withS.wins !== noS.wins).toBe(true);
        }
    }, 120_000);
    it('補充で待つ：兵が戻り（25%）、後詰めの騎馬が 40 秒早く着く。待たないときと結果が違う', () => {
        for (const plan of ['commit', 'hold'] as Ch2Plan[]) {
            const no = summarize(sixteenCh2(P, plan, 'weak', MAIN[plan]));
            const wait = summarize(sixteenCh2(P, plan, 'weakwait', MAIN[plan]));
            log(`A 補充 ${plan}: 待たない ${fmt(no)} ／ 待つ ${fmt(wait)}`);
            expect(no.loss !== wait.loss || no.winSec !== wait.winSec || no.wins !== wait.wins).toBe(true);
        }
    }, 120_000);
});
