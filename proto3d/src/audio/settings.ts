/**
 * 音の設定（全体のミュートと、BGM・声・効果音／環境音の 3 つの音量）。純粋な TypeScript（保存の場所は渡してもらう）。
 *
 * - 保存の外の小さなキー 'koto-sengoku/3d-audio' に、利用者が変えたときだけ書く（変えない限り書かない：保存のキーの数を変えない）。
 * - 章の保存（3d-chapter1・3d-ieyasu1570 など）・演出の設定（3d-prefs）には触れない。
 * - 無い・壊れている・読めないときは既定の値。書けなくても、この遊びの間は変わる。
 */
import type { StorageLike } from '../campaign/save';

export const AUDIO_KEY = 'koto-sengoku/3d-audio';

export interface AudioSettings {
    /** 全体のミュート */
    muted: boolean;
    /** 音量（0〜1） */
    bgm: number;
    voice: number;
    sfx: number;
}

export type VolumeChannel = 'bgm' | 'voice' | 'sfx';
export const VOLUME_CHANNELS: readonly VolumeChannel[] = ['bgm', 'voice', 'sfx'];

export const DEFAULT_AUDIO: Readonly<AudioSettings> = { muted: false, bgm: 0.6, voice: 0.9, sfx: 0.7 };

const clamp01 = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

/** 読む（無い・壊れている・読めないときは既定。値は 0〜1 に収める） */
export function loadAudioSettings(storage: Pick<StorageLike, 'getItem'> | null): AudioSettings {
    try {
        const raw = storage?.getItem(AUDIO_KEY);
        if (raw) {
            const v = JSON.parse(raw) as Partial<Record<keyof AudioSettings, unknown>> | null;
            if (v && typeof v === 'object') {
                return {
                    muted: typeof v.muted === 'boolean' ? v.muted : DEFAULT_AUDIO.muted,
                    bgm: clamp01(v.bgm, DEFAULT_AUDIO.bgm),
                    voice: clamp01(v.voice, DEFAULT_AUDIO.voice),
                    sfx: clamp01(v.sfx, DEFAULT_AUDIO.sfx),
                };
            }
        }
    } catch {
        // 読めなければ既定
    }
    return { ...DEFAULT_AUDIO };
}

/** 書く（利用者が変えたときだけ呼ぶ）。書けたら true */
export function saveAudioSettings(storage: Pick<StorageLike, 'setItem'> | null, s: AudioSettings): boolean {
    if (!storage) return false;
    try {
        storage.setItem(AUDIO_KEY, JSON.stringify({ v: 1, muted: s.muted, bgm: s.bgm, voice: s.voice, sfx: s.sfx }));
        return true;
    } catch {
        return false;
    }
}

/** 設定の窓口（画面と音の土台が同じ物を使う）。変わったら listeners に知らせる */
export class AudioSettingsStore {
    private s: AudioSettings;
    private readonly listeners = new Set<(s: AudioSettings) => void>();
    constructor(private readonly storage: Pick<StorageLike, 'getItem' | 'setItem'> | null) {
        this.s = loadAudioSettings(storage);
    }
    get(): AudioSettings {
        return { ...this.s };
    }
    /** 利用者が変えた（ここでだけ書く）。返りは書けたか */
    set(patch: Partial<AudioSettings>): boolean {
        const next: AudioSettings = {
            muted: typeof patch.muted === 'boolean' ? patch.muted : this.s.muted,
            bgm: clamp01(patch.bgm, this.s.bgm),
            voice: clamp01(patch.voice, this.s.voice),
            sfx: clamp01(patch.sfx, this.s.sfx),
        };
        this.s = next;
        const ok = saveAudioSettings(this.storage, next);
        for (const l of this.listeners) {
            try {
                l(this.get());
            } catch (e) {
                console.error(e);
            }
        }
        return ok;
    }
    onChange(fn: (s: AudioSettings) => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
}
