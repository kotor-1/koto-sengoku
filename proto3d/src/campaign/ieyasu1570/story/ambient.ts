/**
 * 歴史分岐「元亀元年・家康」の町の人々（話しかけられない。見た目だけ）。状態を読むだけの純粋な関数。
 * 設計：docs/story-rpg-design.md §5.1。型：story/types.ts（AmbientSpec）。描き方は町の側（explore/）。
 *
 * - 人数は見た目だけ（兵 VISUAL_TROOPS_PER_FIGURE で 1 人・上限あり）。保存の兵を増やしも減らしもしない。
 * - 負傷兵：第一章・第二章の損害から（損害が大きいほど多い）。第一章の始め（合戦の前）は 0。
 *   第二章の支度で「負傷兵の戻りを待つ」を選んだら、戻った分だけ減る。
 * - 出陣を待つ兵：支度の段階だけ（第一章は城門から出る部隊、第二章は判断で出陣する部隊）。
 * - 援兵：第一章で約束を守り、兵が実際に戻ったとき（recovered > 0）だけ。その旗（織・浅、忠勝の約束は守備隊で徳）。
 * - 荷運び・店の人・門番：いつも少し（勝った後は通りが少しにぎやか）。
 */
import type { AmbientGroup, AmbientSpec } from '../../../story/types';
import { isChapter2, type Ieyasu2State, type IeyasuAnyState } from '../chapter2/state';
import { TOKUGAWA_UNIT_IDS, type IeyasuState, type SupportState } from '../state';
import { VISUAL_MAX, ch1GateTroops, ch1Lost, ch2BattleTroops, ch2Sortie, visualCount } from './counts';

const MARK_OF: Readonly<Record<NonNullable<SupportState['from']>, string>> = { oda: '織', asai: '浅', tadakatsu: '徳' };

/** いつもいる人々（荷運び・店の人・門番） */
function townFolk(lively: boolean): AmbientGroup[] {
    return [
        { kind: 'porter', count: 2, place: 'street' },
        { kind: 'merchant', count: lively ? 2 : 1, place: 'street' },
        { kind: 'guard', count: 2, place: 'gate' },
    ];
}

/** 援兵（約束を守り、兵が実際に戻ったときだけ） */
function reinforcement(sup: SupportState | null): AmbientGroup[] {
    if (!sup || !sup.reinforcement || !sup.from || sup.recovered <= 0) return [];
    return [{ kind: 'reinforcement', count: visualCount(sup.recovered, VISUAL_MAX.reinforcement), mark: MARK_OF[sup.from], place: 'guardpost' }];
}

function wounded(lost: number): AmbientGroup[] {
    const n = visualCount(lost, VISUAL_MAX.wounded);
    return n > 0 ? [{ kind: 'wounded', count: n, place: 'guardpost' }] : [];
}

function ch1Ambient(s: IeyasuState): AmbientSpec | null {
    switch (s.phase) {
        case 'explore':
        case 'council':
            // 第一章の始め：負傷兵はいない
            return { groups: townFolk(false) };
        case 'muster':
            return { groups: [{ kind: 'preparing', count: visualCount(ch1GateTroops(s), VISUAL_MAX.preparing), mark: '徳', place: 'castle' }, ...townFolk(false)] };
        case 'battle':
            return { groups: [{ kind: 'guard', count: 2, place: 'gate' }] };
        case 'aftermath':
            return { groups: [...wounded(ch1Lost(s)), ...reinforcement(s.support), ...townFolk(s.battle?.result === 'victory')] };
        case 'ending':
            return null;
    }
}

/** 第二章の負傷兵の元：第一章で失った兵（補充で待って戻った分を引く）＋第二章で失った兵 */
function ch2Lost(s: Ieyasu2State): number {
    const back = s.recovery?.choice === 'wait' ? TOKUGAWA_UNIT_IDS.reduce((n, k) => n + Math.max(0, s.recovery!.delta[k]), 0) : 0;
    const ch1 = Math.max(0, ch1Lost(s) - back);
    return ch1 + (ch2BattleTroops(s)?.lost ?? 0);
}

function ch2Ambient(s: Ieyasu2State): AmbientSpec | null {
    const sup = reinforcement(s.chapter1.support);
    switch (s.phase) {
        case 'explore':
        case 'council':
            return { groups: [...wounded(ch2Lost(s)), ...sup, ...townFolk(false)] };
        case 'muster': {
            const so = ch2Sortie(s);
            const prep: AmbientGroup[] = so ? [{ kind: 'preparing', count: visualCount(so.troops, VISUAL_MAX.preparing), mark: '徳', place: 'castle' }] : [];
            return { groups: [...prep, ...wounded(ch2Lost(s)), ...sup, ...townFolk(false)] };
        }
        case 'battle':
            return { groups: [{ kind: 'guard', count: 2, place: 'gate' }] };
        case 'aftermath':
            return { groups: [...wounded(ch2Lost(s)), ...sup, ...townFolk(s.battle?.result === 'victory')] };
        case 'ending':
            return null;
    }
}

/** 町の人々（状態を読むだけ。同じ状態なら同じ中身） */
export function ieyasuAmbient(s: IeyasuAnyState): AmbientSpec | null {
    return isChapter2(s) ? ch2Ambient(s) : ch1Ambient(s);
}
