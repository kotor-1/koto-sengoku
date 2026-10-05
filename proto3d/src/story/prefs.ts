/**
 * 演出の「動きを減らす」設定（純粋な TypeScript。保存の場所は渡してもらう）。設計：docs/story-rpg-design.md §0・§3。
 *
 * - 別のキー 'koto-sengoku/3d-prefs' に、利用者が切り替えたときだけ書く（切り替えない限り書かない：保存のキーの数を変えない）。
 * - 書いていなければ・読めなければ、端末の prefers-reduced-motion に従う。
 * - 章の保存（3d-chapter1・3d-ieyasu1570 など）には触れない。視聴・スキップの印は書かない。
 */
import type { StorageLike } from '../campaign/save';

export const PREFS_KEY = 'koto-sengoku/3d-prefs';

export interface StoryPrefs {
    /** 動きを減らす（null：決めていない＝端末の設定に従う） */
    reducedMotion: boolean | null;
}

/** 読む（無い・壊れている・読めないときは決めていない扱い） */
export function loadStoryPrefs(storage: Pick<StorageLike, 'getItem'> | null): StoryPrefs {
    try {
        const raw = storage?.getItem(PREFS_KEY);
        if (!raw) return { reducedMotion: null };
        const v = JSON.parse(raw) as unknown;
        if (v && typeof v === 'object' && typeof (v as { reducedMotion?: unknown }).reducedMotion === 'boolean') {
            return { reducedMotion: (v as { reducedMotion: boolean }).reducedMotion };
        }
    } catch {
        // 読めなければ決めていない扱い
    }
    return { reducedMotion: null };
}

/** 書く（利用者が切り替えたときだけ呼ぶ）。書けたら true */
export function saveStoryPrefs(storage: Pick<StorageLike, 'setItem'> | null, prefs: StoryPrefs): boolean {
    if (!storage) return false;
    try {
        storage.setItem(PREFS_KEY, JSON.stringify({ v: 1, reducedMotion: prefs.reducedMotion }));
        return true;
    } catch {
        return false;
    }
}

/** 今の「動きを減らす」（利用者の設定があればそれ、無ければ端末の設定） */
export function effectiveReduced(prefs: StoryPrefs, deviceReduced: boolean): boolean {
    return prefs.reducedMotion ?? deviceReduced;
}

/**
 * 設定の窓口（画面と章の進行が同じ物を使う）。端末の設定は読む関数を渡す（Node のテストでは渡さない）。
 */
export class StoryPrefsStore {
    private prefs: StoryPrefs;
    constructor(
        private readonly storage: (Pick<StorageLike, 'getItem' | 'setItem'>) | null,
        private readonly device: () => boolean = () => false,
    ) {
        this.prefs = loadStoryPrefs(storage);
    }
    /** 今の「動きを減らす」 */
    get reduced(): boolean {
        let dev = false;
        try {
            dev = this.device();
        } catch {
            dev = false;
        }
        return effectiveReduced(this.prefs, dev);
    }
    /** 利用者が切り替えた（ここでだけ書く）。書けなくても、この遊びの間は切り替わる */
    setReduced(on: boolean): boolean {
        this.prefs = { reducedMotion: on };
        return saveStoryPrefs(this.storage, this.prefs);
    }
}

/** 端末の prefers-reduced-motion を読む関数（ブラウザだけ。無ければ false） */
export function deviceReducedMotion(): boolean {
    try {
        return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}
