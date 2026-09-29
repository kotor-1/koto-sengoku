/**
 * タイトルに並べるシナリオの一覧（ui/boot.ts が ChapterGame に渡す）。
 * 並び：歴史分岐「元亀元年・家康」→ 架空の第一章「国境の砦」（設計 §0）。保存のキーはシナリオごとに別。
 *
 * 使い方（boot.ts）：
 *   const { scenarios, fictionalStore } = createScenarios(getBrowserStorage());
 *   new ChapterGame({ view, world, store: fictionalStore, scenarios, battleRunner });
 * 画面（ui/view.ts）は TitleInfo.scenarios を並べ、'new:ieyasu1570'／'continue:fictional' のように返す。
 */
import { fictionalScenario } from './fictional';
import { ieyasuScenario } from './ieyasu1570/scenario';
import { CampaignSaveStore, type StorageLike } from './save';
import type { AnyScenario } from './scenario';

export function createScenarios(storage: StorageLike | null): { scenarios: AnyScenario[]; fictionalStore: CampaignSaveStore } {
    const fictionalStore = new CampaignSaveStore(storage);
    return { scenarios: [ieyasuScenario(storage), fictionalScenario(fictionalStore)], fictionalStore };
}
