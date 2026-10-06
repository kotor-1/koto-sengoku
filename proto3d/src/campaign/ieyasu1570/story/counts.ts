/**
 * 物語の見せ方（演出・町の人々）の「見た目の人数」を状態から求める（純粋な関数。状態を読むだけ）。
 * 設計：docs/story-rpg-design.md §2・§5.1。
 *
 * - 見た目の人数は兵 VISUAL_TROOPS_PER_FIGURE で 1 人（上限あり）。保存の兵を増やしも減らしもしない。
 * - 出陣する兵：第一章は城門から出る家康本陣・本多忠勝隊・徳川弓隊（岡崎の守備隊は、A・B では国元に残り、C では国境の砦にいて城門から出ない）。
 *   第二章は実際に出陣した部隊（判断と兵で決まる sortie。判断 1 で守備隊の兵が足りれば守備隊も出る）。支援の部隊は戦場で加わる（城下から出ない）。
 * - 帰る兵は残った兵から、負傷兵は失った兵から（損害が大きいほど帰る兵が少なく、負傷兵が多い）。
 */
import { IEYASU_UNIT_IDS } from '../../../battle/maps';
import type { BattleOutcome } from '../../../battle/types';
import { CH2_UNIT, type Ch2SupportId } from '../chapter2/battle';
import { ieyasu2BattleInfo } from '../chapter2/rules';
import { isChapter2, type Ieyasu2State, type IeyasuAnyState } from '../chapter2/state';
import { TOKUGAWA_UNIT_IDS, type IeyasuState, type TokugawaUnitId } from '../state';

/** 兵この数で見た目 1 人 */
export const VISUAL_TROOPS_PER_FIGURE = 50;
/** 見た目の人数の上限（隊列・負傷兵・援兵・支度の兵） */
export const VISUAL_MAX = { column: 24, wounded: 12, reinforcement: 6, preparing: 12 } as const;

/** 兵 → 見た目の人数（兵がいれば 1 人以上。上限で切る） */
export function visualCount(troops: number, max: number): number {
    if (!(troops > 0)) return 0;
    return Math.max(1, Math.min(max, Math.round(troops / VISUAL_TROOPS_PER_FIGURE)));
}

/** 第一章で城門から出陣する徳川の部隊（岡崎の守備隊は城門から出ない） */
export const CH1_GATE_UNITS: readonly TokugawaUnitId[] = ['honjin', 'tadakatsu', 'yumi'];

const tokugawaIds = new Set<string>(Object.values(IEYASU_UNIT_IDS));
const isTokugawa = (u: BattleOutcome['units'][number]) => u.side === 'ally' && u.clan === 'tokugawa' && tokugawaIds.has(u.id);

/** 合戦の結果の徳川の兵（出た・失った・残った）。部隊を絞れる */
export function outcomeTroops(o: BattleOutcome, only?: readonly TokugawaUnitId[]): { sortie: number; lost: number; left: number } {
    const ids = only ? new Set(only.map((k) => IEYASU_UNIT_IDS[k])) : null;
    let sortie = 0;
    let left = 0;
    for (const u of o.units) {
        if (!isTokugawa(u) || (ids && !ids.has(u.id))) continue;
        sortie += u.startStrength;
        left += u.endStrength;
    }
    return { sortie, lost: Math.max(0, sortie - left), left };
}

/**
 * 徳川のほかの味方の部隊の呼び名（帰還の字幕で、失った兵の主語にする）。第一章は結果の画面の部隊の名前、
 * 第二章は家ごとにまとめる（織田勢の後備え・小荷駄・鉄砲隊＝織田勢、浅井の部隊＝浅井勢。長政の名は出さない）。
 */
const OTHER_ALLY_NAMES: Readonly<Record<string, string>> = {
    a_oda: '織田援軍',
    a_nagamasa: '浅井長政隊',
    [CH2_UNIT.odaRear]: '織田勢',
    [CH2_UNIT.odaBaggage]: '織田勢',
    [CH2_UNIT.odaTeppo]: '織田勢',
    [CH2_UNIT.asai]: '浅井勢',
    [CH2_UNIT.asaiGuide]: '浅井勢',
    [CH2_UNIT.village]: '村の衆',
};
const OTHER_ALLY_BY_CLAN: Readonly<Record<string, string>> = { oda: '織田勢', asai: '浅井勢' };

/** 味方の失った兵（結果の画面と同じ数え方）。徳川と、そのほかの味方（呼び名ごと） */
export interface AllyLosses {
    /** 徳川の部隊（出た・失った・残った） */
    tokugawa: { sortie: number; lost: number; left: number };
    /** 徳川のほかの味方（呼び名ごと。出た順。失った兵が 0 の組も入る） */
    others: { name: string; start: number; lost: number }[];
    /** 味方全体の失った兵（結果の画面の「味方の失った兵」と同じ数） */
    total: number;
}

/**
 * 味方の失った兵を、結果の画面（battle/control.ts の resultRows：部隊ごとに始めと終わりの兵を丸めて引き、味方の部隊を全部足す）と
 * 同じ数え方で求める。帰還の字幕は、この数で「誰が何人失ったか」を言う（徳川だけを数えて、援軍の損失を見落とさない）。
 */
export function allyLosses(o: BattleOutcome): AllyLosses {
    const tokugawa = { sortie: 0, lost: 0, left: 0 };
    const others: AllyLosses['others'] = [];
    let total = 0;
    for (const u of o.units) {
        if (u.side !== 'ally') continue;
        const st = Math.round(u.startStrength);
        const lost = st - Math.round(u.endStrength);
        total += lost;
        if (isTokugawa(u)) {
            tokugawa.sortie += st;
            tokugawa.lost += lost;
            continue;
        }
        const name = OTHER_ALLY_NAMES[u.id] ?? OTHER_ALLY_BY_CLAN[u.clan] ?? '味方の諸隊';
        const g = others.find((x) => x.name === name);
        if (g) {
            g.start += st;
            g.lost += lost;
        } else others.push({ name, start: st, lost });
    }
    tokugawa.left = Math.max(0, tokugawa.sortie - tokugawa.lost);
    return { tokugawa, others, total };
}

/** 第一章の合戦（第一章の戦後・結末は state.battle、第二章は記録 chapter1.battle）。合戦の前は null */
export function ch1Outcome(s: IeyasuAnyState): BattleOutcome | null {
    return isChapter2(s) ? s.chapter1.battle : s.battle;
}

/** 第一章で失った徳川の兵（合戦の前は 0） */
export function ch1Lost(s: IeyasuAnyState): number {
    const o = ch1Outcome(s);
    return o ? outcomeTroops(o).lost : 0;
}

/** 損害が大きいか（残った兵が出た兵の 7 割未満。第一章の結末の文と同じ目安） */
export function heavyLoss(t: { sortie: number; left: number }): boolean {
    return t.sortie > 0 && t.left < t.sortie * 0.7;
}

/** 第一章で城門から出陣する兵（出陣の後は合戦の結果の始めの兵。合戦の前は今の兵。本陣は最低 50） */
export function ch1GateTroops(s: IeyasuState): number {
    if (s.battle) return outcomeTroops(s.battle, CH1_GATE_UNITS).sortie;
    return CH1_GATE_UNITS.reduce((n, k) => n + (k === 'honjin' ? Math.max(50, s.troops[k]) : Math.max(0, s.troops[k])), 0);
}

/**
 * 第二章で出陣する部隊と兵（戦後は記録 result から。出陣の前・出陣中は合戦の設定から。判断が無ければ null）。
 * 支援の部隊（織田の鉄砲隊・浅井の道案内・村の衆）は数えない（戦場で加わる）。
 */
export function ch2Sortie(s: Ieyasu2State): { units: TokugawaUnitId[]; troops: number; support: Ch2SupportId[] } | null {
    if (s.result) {
        const units = [...s.result.sortie];
        return { units, troops: units.reduce((n, k) => n + (s.result!.sortieTroops[k] ?? 0), 0), support: [...s.result.support] };
    }
    if (!s.plan) return null;
    let info: ReturnType<typeof ieyasu2BattleInfo>;
    try {
        info = ieyasu2BattleInfo(s);
    } catch {
        // 今の兵ではこの判断の設定を作れない（出陣できない）とき：出陣の数は出さない
        return null;
    }
    const strengthOf = (k: TokugawaUnitId) => info.setup.units.find((u) => u.id === IEYASU_UNIT_IDS[k])?.strength ?? 0;
    return { units: [...info.sortie], troops: info.sortie.reduce((n, k) => n + strengthOf(k), 0), support: [...info.support] };
}

/** 第二章の合戦の徳川の兵（出た・失った・残った。戦後だけ） */
export function ch2BattleTroops(s: Ieyasu2State): { sortie: number; lost: number; left: number } | null {
    const r = s.result;
    if (!r) return null;
    const sortie = TOKUGAWA_UNIT_IDS.reduce((n, k) => n + (r.sortieTroops[k] ?? 0), 0);
    const lost = TOKUGAWA_UNIT_IDS.reduce((n, k) => n + (r.lost[k] ?? 0), 0);
    return { sortie, lost, left: Math.max(0, sortie - lost) };
}
