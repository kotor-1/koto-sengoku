/**
 * タイトルに並べるシナリオの名前と、題のすぐ下（ボタンより前）に出す史実と創作の区別（純粋な TypeScript。DOM を使わない）。
 * - 歴史分岐：1570年の情勢を背景にした歴史分岐シナリオ。会話・能力・分岐後の出来事はゲーム用の創作。
 * - 架空：人物・家・出来事はすべて架空の仮シナリオ。
 * 長い注記（Scenario.note）は、札の下に小さく出す（ui/view.ts）。
 */
import type { ScenarioId } from '../campaign/scenario';

export const SCENARIO_TITLE_TEXT: Readonly<Record<ScenarioId, { name: string; lead: string }>> = {
    ieyasu1570: {
        name: '歴史分岐：元亀元年・家康',
        lead: '1570年の情勢を背景にした歴史分岐シナリオ。会話・能力・分岐後の出来事はゲーム用の創作です。',
    },
    fictional: {
        name: '架空：国境の砦（仮シナリオ）',
        lead: '歴史分岐 RPG の仕組みを完成させるために作った仮シナリオです。人物・家・出来事はすべて架空で、史実として確認したものではありません。',
    },
};

/** タイトルのボタンの id（'new:<シナリオ>'／'continue:<シナリオ>'。campaign/game.ts の TitleAction） */
export function titleButtonIds(ids: readonly ScenarioId[]): string[] {
    return ids.flatMap((id) => [`new:${id}`, `continue:${id}`]);
}
