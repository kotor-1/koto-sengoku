/**
 * 歴史分岐「元亀元年・家康」第二章の決まり（ゲーム用の数値の 1 か所）と、状態から求める見込み（純粋な関数）。
 * flow.ts（状態を進める）と story.ts（台詞・説明に数字を出す）の両方が使う（数値を台詞に直書きしない）。
 *
 * ＊＊ 第一章の直後の、分岐した世界での出来事（創作）。特定の史実の合戦の再現ではない ＊＊
 */
import type { BattleResultKind } from '../../../battle/types';
import { FlowError } from '../../flow';
import { INITIAL_TOKUGAWA_TROOPS, TOKUGAWA_UNIT_IDS, TRUST_IDS, type PledgeResult, type Policy, type TokugawaUnitId, type TrustId } from '../state';
import { ch2BattleSetup, ch2PlanAvailability, type Ch2BattleInfo, type Ch2BattleInput, type Ch2Plan } from './battle';
import type { Ieyasu2State, RecoveryChoice } from './state';

// ================= 決まり（ゲーム用の数値。1 か所） =================

/**
 * 補充の決まり（設計 §5.2）。
 * - wait：各部隊、第一章で失った兵（第一章のはじめの兵 − 今の兵。0 未満は 0）の rate を切り捨てで戻す（石川の信頼 ≥ trustedAt なら trustedRate）。
 *   合戦の設定の waited が true（敵の後詰め・次の波が早く着く。秒数は CH2_RULES.waitDelaySec：合戦の側）。
 * - transfer：岡崎の守備隊から、兵の少ない部隊へ最大 transferMax を移す（守備隊は reserveFloor 未満にしない。足りない割合の大きい部隊から。
 *   各部隊は第一章のはじめの兵まで）。合計は変わらない。守備隊が reserveFloor 以下・足りない部隊が無いときは選べない。
 * - none：変えない。
 */
export const CH2_RECOVERY = {
    rate: 0.25,
    trustedRate: 0.4,
    trustedAt: 45,
    transferMax: 150,
    reserveFloor: 100,
} as const;

/**
 * 第二章の信頼の動き（ゲーム用の数値）。
 * - partner：相手の家（A 織田・B 浅井）。勝利は判断ごと（判断 1 commit／判断 2 hold）、撤退 0、敗北 −5。C は両家とも動かない。
 * - tadakatsu：本多忠勝。勝利 +5。
 * - sakai：酒井忠次。勝利 +5・敗北 −5。
 * - ishikawaCommit：石川数正。判断 1（守備隊を出した＝城を空けた）で −5（勝敗によらない）。
 */
export const CH2_TRUST_DELTA = {
    partner: { victory: { commit: 15, hold: 10 }, retreat: 0, defeat: -5 },
    tadakatsu: { victory: 5, retreat: 0, defeat: 0 } as Readonly<Record<BattleResultKind, number>>,
    sakai: { victory: 5, retreat: 0, defeat: -5 } as Readonly<Record<BattleResultKind, number>>,
    ishikawaCommit: -5,
} as const;

/** 方針ごとの相手の家（C は無し） */
export function ch2PartnerOf(policy: Policy): Extract<TrustId, 'oda' | 'asai'> | null {
    return policy === 'oda' ? 'oda' : policy === 'asai' ? 'asai' : null;
}

/** 方針 × 判断 × 結果ごとの信頼の動き（戦後に足す値。軍議・結末の説明にも使う） */
export function ch2TrustDelta(policy: Policy, plan: Ch2Plan, result: BattleResultKind): Record<TrustId, number> {
    const d = Object.fromEntries(TRUST_IDS.map((k) => [k, 0])) as Record<TrustId, number>;
    const partner = ch2PartnerOf(policy);
    if (partner) {
        const P = CH2_TRUST_DELTA.partner;
        d[partner] = result === 'victory' ? P.victory[plan] : result === 'retreat' ? P.retreat : P.defeat;
    }
    d.tadakatsu = CH2_TRUST_DELTA.tadakatsu[result];
    d.sakai = CH2_TRUST_DELTA.sakai[result];
    if (plan === 'commit') d.ishikawa = CH2_TRUST_DELTA.ishikawaCommit;
    return d;
}

export interface RecoveryOption {
    choice: RecoveryChoice;
    /** 選べるか（選べないときは reason） */
    available: boolean;
    reason: string | null;
    /** 部隊ごとに増える兵（守備隊から回すときは守備隊が負） */
    delta: Record<TokugawaUnitId, number>;
    /** wait の戻る割合（石川の信頼で変わる） */
    rate?: number;
}

const zeroTroops = (): Record<TokugawaUnitId, number> => ({ honjin: 0, tadakatsu: 0, yumi: 0, reserve: 0 });

/** 第一章で失った兵（第一章のはじめの兵 − 今の兵。0 未満は 0） */
export function ch2Losses(troops: Record<TokugawaUnitId, number>): Record<TokugawaUnitId, number> {
    const out = zeroTroops();
    for (const k of TOKUGAWA_UNIT_IDS) out[k] = Math.max(0, INITIAL_TOKUGAWA_TROOPS[k] - troops[k]);
    return out;
}

/** 補充の 3 つの選択肢（今の兵・信頼から。選ぶ前の見込み） */
export function ch2RecoveryOptions(s: Pick<Ieyasu2State, 'troops' | 'trust'>): Record<RecoveryChoice, RecoveryOption> {
    const R = CH2_RECOVERY;
    const lost = ch2Losses(s.troops);
    // 待つ
    const rate = s.trust.ishikawa >= R.trustedAt ? R.trustedRate : R.rate;
    const wait = zeroTroops();
    for (const k of TOKUGAWA_UNIT_IDS) wait[k] = Math.floor(lost[k] * rate);
    const waitSum = TOKUGAWA_UNIT_IDS.reduce((n, k) => n + wait[k], 0);
    // 守備隊から回す
    const transfer = zeroTroops();
    let transferReason: string | null = null;
    const spare = Math.min(R.transferMax, s.troops.reserve - R.reserveFloor);
    const takers = (['honjin', 'tadakatsu', 'yumi'] as const)
        .filter((k) => lost[k] > 0)
        .sort((a, b) => lost[b] / INITIAL_TOKUGAWA_TROOPS[b] - lost[a] / INITIAL_TOKUGAWA_TROOPS[a]);
    if (s.troops.reserve <= R.reserveFloor) transferReason = `岡崎の守備隊が ${s.troops.reserve} で、${R.reserveFloor} より少なくはできない（回せる兵がない）`;
    else if (takers.length === 0) transferReason = '兵の足りない部隊がない（回す先がない）';
    else {
        let left = spare;
        for (const k of takers) {
            const give = Math.min(left, lost[k]);
            transfer[k] = give;
            left -= give;
            if (left <= 0) break;
        }
        transfer.reserve = -(spare - left);
    }
    return {
        wait: { choice: 'wait', available: waitSum > 0, reason: waitSum > 0 ? null : '第一章で失った兵がほとんど無く、待っても戻る兵がない', delta: wait, rate },
        transfer: { choice: 'transfer', available: transferReason === null, reason: transferReason, delta: transfer },
        none: { choice: 'none', available: true, reason: null, delta: zeroTroops() },
    };
}

/** 選べる判断（ch2PlanAvailability が false の物は出さない） */
export function availableCh2Plans(state: Pick<Ieyasu2State, 'troops'>): Ch2Plan[] {
    return (['commit', 'hold'] as const).filter((p) => ch2PlanAvailability(p, state.troops).available);
}

/** 合戦の設定に渡す入力（今の状態から毎回同じに作る。plan を渡せば、その判断での見込み） */
export function ieyasu2BattleInput(state: Ieyasu2State, plan: Ch2Plan | null = state.plan): Ch2BattleInput {
    if (!plan) throw new FlowError('判断が決まっていません');
    return {
        policy: state.policy,
        plan,
        troops: { ...state.troops },
        characters: { ...state.characters },
        trust: { ...state.trust },
        ch1Result: state.chapter1.battle.result,
        ch1Pledge: state.chapter1.pledge.result as PledgeResult,
        waited: state.recovery?.choice === 'wait',
    };
}

/** 合戦の設定と、出る部隊・支援・調整（どの段階でも、判断があれば見込みを作れる） */
export function ieyasu2BattleInfo(state: Ieyasu2State, plan: Ch2Plan | null = state.plan): Ch2BattleInfo {
    return ch2BattleSetup(ieyasu2BattleInput(state, plan));
}

