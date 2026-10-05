/**
 * 歴史分岐「元亀元年・家康」第二章のテストで共用する小道具（テストの本体ではない）。
 * 第一章の結末は、実物の保存（tests/fixtures/ieyasu-ch1-v3/）を今のコードで読み込んで作る。第二章は普通の会話の関数の順で進める。
 */
import type { BattleResultKind, UnitStatus } from '../proto3d/src/battle/types';
import { IeyasuSaveStore, IEYASU_SAVE_KEY } from '../proto3d/src/campaign/ieyasu1570/save';
import type { IeyasuState } from '../proto3d/src/campaign/ieyasu1570/state';
import {
    applyIeyasu2Outcome,
    availableCh2Plans,
    finishTalkIeyasu2,
    ieyasu2BattleSetup,
    ieyasu2OutcomeFromSetup,
    startChapter2,
} from '../proto3d/src/campaign/ieyasu1570/chapter2/flow';
import type { Ch2Plan } from '../proto3d/src/campaign/ieyasu1570/chapter2/battle';
import type { Ieyasu2State, RecoveryChoice } from '../proto3d/src/campaign/ieyasu1570/chapter2/state';
import { MemoryStorage } from './proto3d-campaign-helpers';
import { IEYASU_V3_FIXTURES, type IeyasuCh1V3FixtureName } from './proto3d-ieyasu-save-v3-fixtures';

/** 第一章の保存の文字列を読み込んだ状態（結末なら結末の状態） */
export function loadCh1(raw: string): IeyasuState {
    const storage = new MemoryStorage();
    storage.data.set(IEYASU_SAVE_KEY, raw);
    const l = new IeyasuSaveStore(storage).load();
    if (l.status !== 'ok') throw new Error(`第一章の保存を読めない：${l.status}`);
    return l.state;
}

/** fixture の第一章の結末 → 第二章のはじめ */
export function ch2From(name: IeyasuCh1V3FixtureName): Ieyasu2State {
    return startChapter2(loadCh1(IEYASU_V3_FIXTURES[name]));
}

/** 第二章：忠勝と話して軍議 → 判断を決める（支度へ） */
export function toCh2Muster(s: Ieyasu2State, plan?: Ch2Plan): Ieyasu2State {
    let x = finishTalkIeyasu2(s, 'tadakatsu', 'open_council');
    const p = plan ?? availableCh2Plans(x)[0]!;
    x = finishTalkIeyasu2(x, 'council', p === 'commit' ? 'plan_commit' : 'plan_hold');
    return finishTalkIeyasu2(x, 'council', 'confirm_plan');
}

/** 支度：石川と補充 → 城門で出陣（phase は battle） */
export function toCh2Battle(s: Ieyasu2State, recovery: RecoveryChoice = 'none'): Ieyasu2State {
    const x = finishTalkIeyasu2(s, 'ishikawa', `recovery_${recovery}`);
    return finishTalkIeyasu2(x, 'gate', 'depart');
}

/** 合戦を偽の結果で終えて戦後へ */
export function toCh2Aftermath(
    s: Ieyasu2State,
    result: BattleResultKind,
    opts: { units?: Record<string, { end?: number; status?: UnitStatus }>; secondary?: boolean; reason?: 'ally_hq_routed' | 'objective_failed' | 'ally_army_broken' } = {},
): Ieyasu2State {
    return applyIeyasu2Outcome(s, ieyasu2OutcomeFromSetup(ieyasu2BattleSetup(s), result, opts));
}

export const CH1_ENDINGS: readonly IeyasuCh1V3FixtureName[] = [
    'oda_victory_kept',
    'oda_defeat_broken_heavy',
    'oda_retreat_declined',
    'asai_victory_kept',
    'asai_defeat_broken_heavy',
    'asai_retreat_declined',
    'home_victory_kept',
    'home_defeat_broken_heavy',
    'home_retreat_declined',
];
