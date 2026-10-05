/**
 * 第一章の版 3 の保存データ（tests/fixtures/ieyasu-ch1-v3/）の確かめ。
 * - 今のコードで読めて、結末（または戦後）の状態になる。
 * - 今のコードの第一章の保存の関数（generate.ts）が、ファイルと同じ文字列を作る（第一章の状態は今までどおり版 3 で同じ文字列で書く）。
 */
import { describe, expect, it } from 'vitest';
import { parseIeyasuSaveData } from '../proto3d/src/campaign/ieyasu1570/save';
import { generateIeyasuCh1V3 } from './fixtures/ieyasu-ch1-v3/generate';
import { IEYASU_CH1_V3_FIXTURE_NAMES, IEYASU_V3_FIXTURES } from './proto3d-ieyasu-save-v3-fixtures';

describe('第一章の版 3 の保存データ（fixture）', () => {
    it('どれも今のコードで読め、名前どおりの段階・方針・結果・約束', () => {
        for (const n of IEYASU_CH1_V3_FIXTURE_NAMES) {
            const raw = IEYASU_V3_FIXTURES[n];
            expect(JSON.parse(raw).version, n).toBe(3);
            const d = parseIeyasuSaveData(raw);
            expect(d, n).not.toBeNull();
            const [policy, result, pledge] = n.split('_');
            expect(d!.policy).toBe(policy);
            expect(d!.battle!.result).toBe(result);
            expect(d!.pledge!.result).toBe(pledge);
            expect(d!.phase).toBe(n.endsWith('_aftermath') ? 'aftermath' : 'ending');
        }
    });

    it('今のコードの第一章の保存の関数が、ファイルと同じ文字列を作る（第一章は版 3 のまま）', () => {
        const now = generateIeyasuCh1V3();
        for (const n of IEYASU_CH1_V3_FIXTURE_NAMES) expect(now[n], n).toBe(IEYASU_V3_FIXTURES[n]);
    });

    it('損害の大きい保存：忠勝隊・弓隊がほぼ失われ、家康・忠勝が負傷（B は長政も・C は守備隊も）', () => {
        for (const p of ['oda', 'asai', 'home'] as const) {
            const d = parseIeyasuSaveData(IEYASU_V3_FIXTURES[`${p}_defeat_broken_heavy`])!;
            expect(d.troops.tadakatsu).toBeLessThan(40);
            expect(d.troops.yumi).toBeLessThan(40);
            expect(d.characters.ieyasu).toBe('wounded');
            expect(d.characters.tadakatsu).toBe('wounded');
            if (p === 'asai') expect(d.characters.nagamasa).toBe('wounded');
            if (p === 'home') expect(d.troops.reserve).toBeLessThan(40);
            expect(d.support!.reinforcement).toBe(false);
        }
    });
});
