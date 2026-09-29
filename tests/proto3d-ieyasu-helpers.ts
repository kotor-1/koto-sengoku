/**
 * 歴史分岐シナリオ「元亀元年・家康」のテストで共用する小道具（テストの本体ではない）。
 */
import type { BattleResultKind, UnitStatus } from '../proto3d/src/battle/types';
import {
    applyIeyasuOutcome,
    finishTalkIeyasu,
    ieyasuBattleSetup,
    ieyasuOutcomeFromSetup,
    newIeyasuGame,
    talkIeyasu,
} from '../proto3d/src/campaign/ieyasu1570/flow';
import { PLEDGE_SPECS, type IeyasuState, type Policy } from '../proto3d/src/campaign/ieyasu1570/state';

export const POLICY_CHOICE = { oda: 'policy_oda', asai: 'policy_asai', home: 'policy_home' } as const;
export type PledgeAnswer = 'accept' | 'decline';

/** 探索 → 軍議（方針を決める）→ 支度（約束はまだ答えない）まで、普通の会話の順で */
export function ieyasuToMuster(policy: Policy, opts: { talkEnvoys?: boolean } = {}): IeyasuState {
    let s = newIeyasuGame();
    if (opts.talkEnvoys) {
        s = finishTalkIeyasu(s, 'oda_envoy');
        s = finishTalkIeyasu(s, 'asai_envoy');
    }
    s = finishTalkIeyasu(s, 'tadakatsu', 'open_council');
    s = finishTalkIeyasu(s, 'council', POLICY_CHOICE[policy]);
    const confirm = talkIeyasu(s, 'council');
    if (!confirm.choices?.some((c) => c.id === 'confirm_policy')) throw new Error('確認の選択肢が出ない');
    return finishTalkIeyasu(s, 'council', 'confirm_policy');
}

/** 約束に答える */
export function answerPledge(s: IeyasuState, answer: PledgeAnswer): IeyasuState {
    return finishTalkIeyasu(s, PLEDGE_SPECS[s.policy!].giver, answer === 'accept' ? 'pledge_accept' : 'pledge_decline');
}

/** 支度 → 約束に答える → 城門で出陣（phase は battle） */
export function ieyasuToBattle(policy: Policy, answer: PledgeAnswer): IeyasuState {
    return finishTalkIeyasu(answerPledge(ieyasuToMuster(policy), answer), 'gate', 'depart');
}

/** 合戦を指定の結果で終えて戦後へ（pledge は合戦の計算が返す約束の結果。引き受けていなければ無視される） */
export function ieyasuToAftermath(
    policy: Policy,
    result: BattleResultKind,
    answer: PledgeAnswer,
    opts: { pledge?: 'kept' | 'broken'; units?: Record<string, { end?: number; status?: UnitStatus }> } = {},
): IeyasuState {
    const s = ieyasuToBattle(policy, answer);
    return applyIeyasuOutcome(s, ieyasuOutcomeFromSetup(ieyasuBattleSetup(s), result, { pledge: opts.pledge, units: opts.units }));
}
