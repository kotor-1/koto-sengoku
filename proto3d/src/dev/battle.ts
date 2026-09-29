/**
 * 開発時の確認用（本番の画面には出さない）：?dev=battle[&ally=tashiro|omori|alone] で、標準の布陣（battle/maps.ts の demoSetup）の合戦をすぐ始める。
 * - 終わったら結果を window.__battleOutcome に置き、探索へ戻る。合戦の最中は window.__battle（battle/entry.ts）で状態を読める。
 * - window.__battleDev.run(ally)：同じページでもう一度合戦を始める（後片付けと入り直しの確認。結果を返す）。
 * - window.__battleScripts：台本（battle/scripts.ts）。例：__battle.setScript(__battleScripts.planScript('tashiro'))。
 */
import { getBattleRunner } from '../app/modes';
import { demoSetup, type Alliance } from '../battle/maps';
import type { BattleOutcome } from '../battle/types';

async function run(ally: Alliance): Promise<BattleOutcome> {
    await import('../battle/entry');
    const runner = getBattleRunner();
    if (!runner) throw new Error('合戦の画面が登録されていません');
    Object.assign(window, { __battleOutcome: null });
    const outcome = await runner(demoSetup(ally));
    Object.assign(window, { __battleOutcome: outcome });
    console.info('[dev battle] 結果', ally, outcome.result, outcome.reason, outcome.elapsedSec);
    return outcome;
}

export async function devStart(): Promise<void> {
    const scripts = await import('../battle/scripts');
    const p = new URLSearchParams(location.search);
    const a = p.get('ally');
    const ally: Alliance = a === 'omori' || a === 'alone' ? a : 'tashiro';
    Object.assign(window, { __battleScripts: scripts, __battleDev: { run } });
    await run(ally);
}
