/**
 * 開発時の確認用（本番の画面には出さない）：?dev=field&id=<戦場id>[&preset=<編成id>] で、合戦場のデータ（battle/fields/）から
 * その戦場の合戦をすぐ始める。id を省けば大平原（plains）、preset を省けば 'standard'。
 * - 例：?dev=field&id=river_ford、?dev=field&id=mountain_pass&preset=standard
 * - 知らない戦場・編成は、画面に理由を出して止める（合戦は始めない）。
 * - 終わったら結果を window.__battleOutcome に置き、探索へ戻る。合戦の最中は window.__battle（battle/entry.ts）で状態を読める。
 * - window.__fieldDev.run(id, preset)：同じページでもう一度合戦を始める（結果を返す）。window.__fieldDev.ids：戦場 id の並び。
 * 本番の入口（演習モード）は、同じく buildBattleSetup(getField(id)!, preset) を runBattle に渡す。
 */
import { getBattleRunner } from '../app/modes';
import { FIELDS, buildBattleSetup, getField } from '../battle/fields';
import type { BattleOutcome } from '../battle/types';

async function run(id: string, preset = 'standard'): Promise<BattleOutcome> {
    const field = getField(id);
    if (!field) throw new Error(`戦場がありません: ${id}（${FIELDS.map((f) => f.id).join('・')}）`);
    const setup = buildBattleSetup(field, preset);
    await import('../battle/entry');
    const runner = getBattleRunner();
    if (!runner) throw new Error('合戦の画面が登録されていません');
    Object.assign(window, { __battleOutcome: null });
    const outcome = await runner(setup);
    Object.assign(window, { __battleOutcome: outcome });
    console.info('[dev field] 結果', id, preset, outcome.result, outcome.reason, outcome.elapsedSec, outcome.objectives ?? '');
    return outcome;
}

export async function devStart(): Promise<void> {
    const p = new URLSearchParams(location.search);
    Object.assign(window, { __fieldDev: { run, ids: FIELDS.map((f) => f.id) } });
    try {
        await run(p.get('id') || 'plains', p.get('preset') || 'standard');
    } catch (e) {
        // 開発用：理由を画面の真ん中に出す（本番には入らない）
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[dev field]', msg);
        const d = document.createElement('div');
        d.id = 'dev-field-error';
        d.textContent = `?dev=field：${msg}`;
        d.style.cssText = 'position:fixed;left:50%;top:40%;transform:translateX(-50%);padding:12px 18px;background:rgba(20,16,12,.92);color:#ffc2ba;border:1px solid #c25a45;border-radius:10px;z-index:99;font:14px sans-serif';
        document.body.append(d);
    }
}
