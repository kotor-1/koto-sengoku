/**
 * 第一章の 9 通り（協力陣営 3 × 合戦の結果 3。撤退は ordered_retreat・nightfall の両方）を本物の flow の関数で通し、
 * 仕様 §5 の結末の表どおりに 6 つの結末のどれか 1 つへ着くことを確かめる。
 * あわせて、戦後の処理（applyBattleOutcome：兵・人物・関係）が二度かからないこと（保存の読み直しを含む）を確かめる。
 */
import { describe, expect, it } from 'vitest';
import type { BattleEndReason, BattleResultKind } from '../proto3d/src/battle/types';
import { applyBattleOutcome, battleSetupFor, endingFor, finishChapter, FlowError, outcomeFromSetup } from '../proto3d/src/campaign/flow';
import { CampaignSaveStore } from '../proto3d/src/campaign/save';
import type { Alliance, EndingId } from '../proto3d/src/campaign/state';
import { MemoryStorage, snapshot, toBattle } from './proto3d-campaign-helpers';

const ENDINGS: EndingId[] = ['tashiro_victory', 'omori_victory', 'alone_victory', 'retreat', 'defeat_sheltered', 'defeat_alone'];
const COMBOS: { a: Alliance; r: BattleResultKind; reason?: BattleEndReason }[] = [];
for (const a of ['tashiro', 'omori', 'alone'] as Alliance[]) {
    COMBOS.push({ a, r: 'victory' }, { a, r: 'defeat' }, { a, r: 'retreat', reason: 'ordered_retreat' }, { a, r: 'retreat', reason: 'nightfall' });
}

describe('第一章の 9 通り → 結末（仕様 §5）', () => {
    const table: string[] = [];
    it.each(COMBOS)('$a × $r ($reason)', ({ a, r, reason }) => {
        const s = toBattle(a);
        const after = applyBattleOutcome(s, outcomeFromSetup(battleSetupFor(s), r, reason ? { reason } : {}));
        const e = endingFor(after);
        expect(ENDINGS.filter((x) => x === e)).toHaveLength(1);
        const expected: EndingId =
            r === 'retreat'
                ? 'retreat'
                : r === 'victory'
                  ? (`${a}_victory` as EndingId)
                  : a !== 'alone' && after.relations[a] >= 0
                    ? 'defeat_sheltered'
                    : 'defeat_alone';
        expect(e).toBe(expected);
        expect(finishChapter(after).ending).toBe(e);
        table.push(`${a} × ${r}${reason ? `(${reason})` : ''} → ${e}`);
        if (table.length === COMBOS.length) console.log(table.join('\n'));
    });
});

describe('戦後の処理は二度かからない', () => {
    it('同じ結果をもう一度渡しても投げ、状態は変わらない（続けるの連打）', () => {
        const s = toBattle('tashiro');
        const o = outcomeFromSetup(battleSetupFor(s), 'victory');
        const once = applyBattleOutcome(s, o);
        const snap = snapshot(once);
        expect(() => applyBattleOutcome(once, o)).toThrow(FlowError);
        expect(once).toEqual(snap);
    });
    it('戦後の自動保存を読み直しても、兵・人物・関係は 1 回分のまま', () => {
        const storage = new MemoryStorage();
        const store = new CampaignSaveStore(storage);
        const s = toBattle('omori');
        const o = outcomeFromSetup(battleSetupFor(s), 'defeat');
        const once = applyBattleOutcome(s, o);
        expect(store.save(once, 'aftermath').ok).toBe(true);
        const loaded = new CampaignSaveStore(storage).load();
        expect(loaded.status).toBe('ok');
        if (loaded.status !== 'ok') return;
        expect(loaded.state.phase).toBe('aftermath');
        expect(loaded.state.troops).toEqual(once.troops);
        expect(loaded.state.relations).toEqual(once.relations);
        expect(loaded.state.characters).toEqual(once.characters);
        expect(() => applyBattleOutcome(loaded.state, o)).toThrow(FlowError);
        // 2 回読んでも同じ
        const again = new CampaignSaveStore(storage).load();
        expect(again.status === 'ok' && again.state.relations).toEqual(once.relations);
    });
    it('結果の画面で読み直す（戦後の保存より前）：出陣前の保存へ戻り、戦前の兵・関係のまま', () => {
        const storage = new MemoryStorage();
        const store = new CampaignSaveStore(storage);
        const s = toBattle('tashiro');
        expect(store.save(s, 'departure').ok).toBe(true);
        const loaded = new CampaignSaveStore(storage).load();
        expect(loaded.status).toBe('ok');
        if (loaded.status !== 'ok') return;
        expect(loaded.state.phase).toBe('muster');
        expect(loaded.state.battle).toBeNull();
        expect(loaded.state.troops).toEqual(s.troops);
        expect(loaded.state.relations).toEqual(s.relations);
    });
});
