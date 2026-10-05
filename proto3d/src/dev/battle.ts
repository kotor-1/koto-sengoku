/**
 * 開発時の確認用（本番の画面には出さない）：?dev=battle[&ally=tashiro|omori|alone] で、標準の布陣（battle/maps.ts の demoSetup）の合戦をすぐ始める。
 * - ?dev=battle&scenario=ieyasu&policy=oda|asai|home[&pledge=1]：歴史分岐「元亀元年・家康」の合戦（maps.ts の ieyasu1570Setup。
 *   兵は章の始めの数、pledge=1 で戦前の約束を引き受けた形）。特殊能力・約束の画面の確認用。
 * - ?dev=battle&scenario=ieyasu2&policy=oda|asai|home&plan=commit|hold&tier=strong|typical|weak|weakwait|minimum：歴史分岐の第二章の合戦
 *   （chapter2/battle.ts の ch2BattleSetup。第一章の結果の段階は chapter2/scripts.ts の ch2TierInput）。キャンペーンの状態を通さない
 *   （報告では「直接状態変更」と書く）。その段階で選べない判断（minimum の hold）は commit にする。
 *   window.__ch2Scripts：第二章の台本（例：__battle.fastForward(600, __ch2Scripts.ch2TacticScript('oda', 'rear_hold', __battle.state.setup))）。
 * - 終わったら結果を window.__battleOutcome に置き、探索へ戻る。合戦の最中は window.__battle（battle/entry.ts）で状態を読める。
 * - window.__battleDev.run(ally)：同じページでもう一度合戦を始める（後片付けと入り直しの確認。結果を返す）。
 *   window.__battleDev.runIeyasu(policy, pledge)：歴史分岐の合戦を同じページでもう一度。runIeyasu2(policy, plan, tier)：第二章の合戦。
 * - window.__battleScripts：台本（battle/scripts.ts）。例：__battle.setScript(__battleScripts.planScript('tashiro'))。
 */
import { getBattleRunner } from '../app/modes';
import { IEYASU_INITIAL_TROOPS, demoSetup, ieyasu1570Setup, type Alliance, type IeyasuPolicy } from '../battle/maps';
import type { BattleOutcome, BattleSetup } from '../battle/types';
import { ch2BattleSetup, type Ch2Plan } from '../campaign/ieyasu1570/chapter2/battle';
import { CH2_TIERS, ch2TierAvailable, ch2TierInput, type Ch2Tier } from '../campaign/ieyasu1570/chapter2/scripts';

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

/** 第二章の合戦（段階で選べない判断は commit にする）。設定に信頼の写し（relations）を足す（キャンペーンと同じ） */
function runIeyasu2(policy: IeyasuPolicy, plan: Ch2Plan, tier: Ch2Tier): Promise<BattleOutcome> {
    const pl: Ch2Plan = ch2TierAvailable(policy, plan, tier) ? plan : 'commit';
    if (pl !== plan) console.warn(`[dev battle] ${policy}・${tier} では判断 ${plan} を選べないので commit にした`);
    const input = ch2TierInput(policy, pl, tier);
    const info = ch2BattleSetup(input);
    Object.assign(window, { __ch2Info: { sortie: info.sortie, support: info.support, thin: info.thin, adjustments: info.adjustments, enemyFactor: info.enemyFactor, plan: pl, tier } });
    return runSetup({ ...info.setup, relations: { ...input.trust } }, `ieyasu2:${policy}:${pl}:${tier}`);
}

export async function devStart(): Promise<void> {
    const scripts = await import('../battle/scripts');
    const ch2Scripts = await import('../campaign/ieyasu1570/chapter2/scripts');
    const p = new URLSearchParams(location.search);
    Object.assign(window, { __battleScripts: scripts, __ch2Scripts: ch2Scripts, __battleDev: { run, runIeyasu, runIeyasu2 } });
    if (p.get('scenario') === 'ieyasu2') {
        const q = p.get('policy');
        const policy: IeyasuPolicy = q === 'asai' || q === 'home' ? q : 'oda';
        const plan: Ch2Plan = p.get('plan') === 'hold' ? 'hold' : 'commit';
        const t = p.get('tier') as Ch2Tier | null;
        const tier: Ch2Tier = t && CH2_TIERS.includes(t) ? t : 'typical';
        await runIeyasu2(policy, plan, tier);
        return;
    }
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
