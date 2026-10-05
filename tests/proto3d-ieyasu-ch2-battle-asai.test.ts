/**
 * 第二章 B「孤立した浅井勢を救う」（援軍救出の地形）の釣り合い。設計 docs/chapter2-design.md §5〜§7、記録 docs/chapter2-battles.md。
 * 主目標：孤立した浅井勢（長政が無事なら浅井長政隊、負傷していれば浅井勢の後備え）と丘の上で合流し、南の安全地点まで連れ帰る。
 *
 * どれも「早送り」（chapter2/scripts.ts の台本を runToEnd で最後まで。画面の操作ではない）。16 通りのずらし（種 7）で数える。
 * 第一章の結果の段階は tests/proto3d-ieyasu-ch2-battle-oda.test.ts の見出しと同じ。
 *
 * 合格の目安（「正面なら負ける」を合格の条件にしない）：
 * - 判断ごと・段階ごとに、筋の通った作戦が 16 通りの過半で勝つ（判断 1：south か west、判断 2：west）。
 * - 判断 1 と判断 2 で、時間・損害・残る部隊・副目標が分かれる（判断 1 の south は南の囲みを崩して早く、判断 2 の west は遅いが損害が小さい）。
 * - 目標を考えない手（何もしない・開始直後の全軍撤退・救出の対象だけを動かす・全部隊で丘へ一斉）が、考えた作戦より明らかに良くならない。
 * - 支援（浅井の道案内）の有無・補充で待ったかどうかで、結果が違う（数字は記録）。
 */
import { describe, expect, it } from 'vitest';
import { CH2_TIERS, ch2Tactics, ch2TierAvailable, type Ch2Tier } from '../proto3d/src/campaign/ieyasu1570/chapter2/scripts';
import type { Ch2Plan } from '../proto3d/src/campaign/ieyasu1570/chapter2/battle';
import { ch2Info, densest, fmt, log, playCh2, sixteenCh2, summarize, type Ch2Summary } from './proto3d-ieyasu-ch2-battle-helpers';

const P = 'asai' as const;
/** 判断ごとの作戦（判断 1 は 2 つとも数える。勝ち数の多いほうで合格を見る） */
const PLANS: Record<Ch2Plan, string[]> = { commit: ['south', 'west'], hold: ['west'] };
const cells = (['commit', 'hold'] as Ch2Plan[]).flatMap((plan) => CH2_TIERS.filter((t) => ch2TierAvailable(P, plan, t)).map((tier) => ({ plan, tier })));
const clearlyBetter = (n: Ch2Summary, best: Ch2Summary) => n.wins > best.wins || (n.wins === best.wins && n.wins > 0 && n.loss < best.loss - 0.01 && n.secTotal >= best.secTotal);
const bestOf = (plan: Ch2Plan, tier: Ch2Tier, key = '', tweak?: Parameters<typeof sixteenCh2>[4]) =>
    PLANS[plan].map((id) => ({ id, s: summarize(sixteenCh2(P, plan, tier, id, tweak, key)) })).sort((a, b) => b.s.wins - a.s.wins || a.s.loss - b.s.loss)[0]!;

describe('B：台本は画面で出せる命令の数・間隔', () => {
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

describe('B：判断ごと・段階ごとに勝てる作戦がある（16 通りの過半）', () => {
    for (const { plan, tier } of cells) {
        for (const id of PLANS[plan]) {
            it(`${plan}・${tier}：${id}（数える）`, () => {
                const s = summarize(sixteenCh2(P, plan, tier, id));
                log(`B ${plan} ${tier} ${id}: ${fmt(s)}`);
            }, 60_000);
        }
        it(`${plan}・${tier}：勝てる作戦がある`, () => {
            const b = bestOf(plan, tier);
            expect(b.s.wins, `${b.id} ${fmt(b.s)}`).toBeGreaterThan(8);
        }, 60_000);
    }
    it('判断 2（西の筋から救う）は minimum では軍議で選べない（判断 1 で進める）', () => {
        expect(ch2TierAvailable(P, 'hold', 'minimum')).toBe(false);
    });
});

describe('B：判断 1 と判断 2 の違い', () => {
    for (const tier of ['strong', 'typical', 'weak', 'weakwait'] as Ch2Tier[]) {
        it(`${tier}：判断 1 の south は早く、南の囲みを崩す副目標を果たす。判断 2 の west は遅いが、救う相手の兵が残る`, () => {
            const c = summarize(sixteenCh2(P, 'commit', tier, 'south'));
            const h = summarize(sixteenCh2(P, 'hold', tier, 'west'));
            log(`B 判断の違い ${tier}: 判断 1 south ${fmt(c)} ／ 判断 2 west ${fmt(h)}`);
            expect(h.winSec! - c.winSec!).toBeGreaterThan(20);
            expect(c.sec['ch2_asai_ring_s']!).toBeGreaterThan(h.sec['ch2_asai_ring_s']!);
            expect(c.tokLoss).toBeGreaterThan(h.tokLoss);
        }, 60_000);
    }
});

describe('B：目標を考えない手は、考えた作戦より明らかに良くならない', () => {
    for (const { plan, tier } of cells.filter((c) => c.tier === 'strong' || c.tier === 'typical' || c.tier === 'minimum')) {
        it(`${plan}・${tier}`, () => {
            const b = bestOf(plan, tier);
            for (const t of ch2Tactics(P, plan, 'naive')) {
                const n = summarize(sixteenCh2(P, plan, tier, t.id));
                log(`B ${plan} ${tier} 目標を考えない手 ${t.id}: ${fmt(n)} ／ 最良 ${b.id}: ${fmt(b.s)}`);
                expect(clearlyBetter(n, b.s), `${t.id} ${fmt(n)} ／ ${b.id} ${fmt(b.s)}`).toBe(false);
            }
            // 救出の対象だけを動かす・何もしないは、合流しないので主目標に届かない（記録。0 勝の固定は合格の条件にしない）
            const only = summarize(sixteenCh2(P, plan, tier, 'target_only'));
            expect(only.wins).toBeLessThan(b.s.wins);
        }, 120_000);
    }
});

describe('B：第一章の結果が効く（支援・補充）', () => {
    it('支援：浅井の道案内（浅井の信頼 ≥ 40）がいると、いないとき（同じ勝ちで約束を引き受けなかった＝信頼 25）と結果が違う', () => {
        for (const plan of ['commit', 'hold'] as Ch2Plan[]) {
            const withS = bestOf(plan, 'strong');
            expect(ch2Info(P, plan, 'strong', (i) => (i.trust.asai = 25), 'asai25').support).toEqual([]);
            const noS = bestOf(plan, 'strong', 'asai25', (i) => (i.trust.asai = 25));
            log(`B 支援 ${plan}: 道案内あり ${withS.id} ${fmt(withS.s)} ／ なし ${noS.id} ${fmt(noS.s)}`);
            expect(withS.s.loss !== noS.s.loss || withS.s.winSec !== noS.s.winSec || withS.s.wins !== noS.s.wins).toBe(true);
        }
    }, 180_000);
    it('補充で待つ：兵が戻り（25%）、織田方の援軍が 40 秒早く着く。待たないときと結果が違う', () => {
        for (const plan of ['commit', 'hold'] as Ch2Plan[]) {
            const no = bestOf(plan, 'weak');
            const wait = bestOf(plan, 'weakwait');
            log(`B 補充 ${plan}: 待たない ${no.id} ${fmt(no.s)} ／ 待つ ${wait.id} ${fmt(wait.s)}`);
            expect(no.s.loss !== wait.s.loss || no.s.winSec !== wait.s.winSec || no.s.wins !== wait.s.wins).toBe(true);
        }
    }, 120_000);
});
