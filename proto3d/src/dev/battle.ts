/**
 * 開発時の確認用（本番の画面には出さない）：?dev=battle[&ally=tashiro|omori|alone] で、標準の布陣（battle/maps.ts の demoSetup）の合戦をすぐ始める。
 * - ?dev=battle&scenario=ieyasu&policy=oda|asai|home[&pledge=1]：歴史分岐「元亀元年・家康」の合戦（maps.ts の ieyasu1570Setup。
 *   兵は章の始めの数、pledge=1 で戦前の約束を引き受けた形）。特殊能力・約束の画面の確認用。
 * - 終わったら結果を window.__battleOutcome に置き、探索へ戻る。合戦の最中は window.__battle（battle/entry.ts）で状態を読める。
 * - window.__battleDev.run(ally)：同じページでもう一度合戦を始める（後片付けと入り直しの確認。結果を返す）。
 *   window.__battleDev.runIeyasu(policy, pledge)：歴史分岐の合戦を同じページでもう一度。
 * - window.__battleScripts：台本（battle/scripts.ts）。例：__battle.setScript(__battleScripts.planScript('tashiro'))。
 */
import { getBattleRunner } from '../app/modes';
import { IEYASU_INITIAL_TROOPS, demoSetup, ieyasu1570Setup, type Alliance, type IeyasuPolicy } from '../battle/maps';
import type { BattleOutcome, BattleSetup } from '../battle/types';

async function runSetup(setup: BattleSetup, label: string): Promise<BattleOutcome> {
    await import('../battle/entry');
    const runner = getBattleRunner();
    if (!runner) throw new Error('合戦の画面が登録されていません');
    Object.assign(window, { __battleOutcome: null });
    const outcome = await runner(setup);
    Object.assign(window, { __battleOutcome: outcome });
    console.info('[dev battle] 結果', label, outcome.result, outcome.reason, outcome.elapsedSec, outcome.pledge ?? '');
    return outcome;
}

function run(ally: Alliance): Promise<BattleOutcome> {
    return runSetup(demoSetup(ally), ally);
}

function runIeyasu(policy: IeyasuPolicy, pledge: boolean): Promise<BattleOutcome> {
    return runSetup(ieyasu1570Setup(policy, { troops: { ...IEYASU_INITIAL_TROOPS }, pledgeAccepted: pledge }), `ieyasu:${policy}${pledge ? '+pledge' : ''}`);
}

export async function devStart(): Promise<void> {
    const scripts = await import('../battle/scripts');
    const p = new URLSearchParams(location.search);
    Object.assign(window, { __battleScripts: scripts, __battleDev: { run, runIeyasu } });
    if (p.get('scenario') === 'ieyasu') {
        const q = p.get('policy');
        const policy: IeyasuPolicy = q === 'asai' || q === 'home' ? q : 'oda';
        await runIeyasu(policy, p.get('pledge') === '1');
        return;
    }
    const a = p.get('ally');
    const ally: Alliance = a === 'omori' || a === 'alone' ? a : 'tashiro';
    await run(ally);
}
