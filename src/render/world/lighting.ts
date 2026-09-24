/**
 * 時間帯ごとの光の設定（データのみ）。
 * 全画面の効果は「乗算の色かぶせ 1 枚 + 加算の日差し 1 枚 + 周辺減光 1 枚」だけに抑え、
 * シェーダーや画面全体の後処理は使わない（スマホで軽くするため）。
 */
export type TimeOfDay = 'day' | 'evening' | 'night';

export const TIME_ORDER: TimeOfDay[] = ['day', 'evening', 'night'];

export const TIME_LABELS: Record<TimeOfDay, string> = {
    day: '昼',
    evening: '夕',
    night: '夜',
};

export type AmbientKind = 'motes' | 'leaves' | 'fireflies';

export interface LightPreset {
    /** 乗算で全体にかぶせる色と強さ（0 で効果なし） */
    tint: number;
    tintAlpha: number;
    /** 加算の日差し（画面左上から） */
    sunColor: number;
    sunAlpha: number;
    /** 周辺減光 */
    vignetteAlpha: number;
    /** 足元の接地影の濃さ */
    contactAlpha: number;
    /** 伸びる影の濃さと長さ（1 = 標準） */
    castAlpha: number;
    castLength: number;
    /** 提灯・窓の灯り */
    lanternAlpha: number;
    /** 水面のきらめき */
    waterAlpha: number;
    ambient: AmbientKind;
}

export const PRESETS: Record<TimeOfDay, LightPreset> = {
    day: {
        tint: 0xfff8ec,
        tintAlpha: 0.15,
        sunColor: 0xfff1d0,
        sunAlpha: 0.1,
        vignetteAlpha: 0.14,
        contactAlpha: 0.34,
        castAlpha: 0.26,
        castLength: 0.7,
        lanternAlpha: 0,
        waterAlpha: 0.42,
        ambient: 'motes',
    },
    evening: {
        tint: 0xf0b48a,
        tintAlpha: 0.58,
        sunColor: 0xffb070,
        sunAlpha: 0.3,
        vignetteAlpha: 0.3,
        contactAlpha: 0.38,
        castAlpha: 0.3,
        castLength: 1.6,
        lanternAlpha: 0.35,
        waterAlpha: 0.5,
        ambient: 'leaves',
    },
    night: {
        tint: 0x4a5a8c,
        tintAlpha: 0.82,
        sunColor: 0x8fa6d8,
        sunAlpha: 0.1,
        vignetteAlpha: 0.45,
        contactAlpha: 0.42,
        castAlpha: 0.1,
        castLength: 0.5,
        lanternAlpha: 1,
        waterAlpha: 0.3,
        ambient: 'fireflies',
    },
};

export function nextTime(t: TimeOfDay): TimeOfDay {
    return TIME_ORDER[(TIME_ORDER.indexOf(t) + 1) % TIME_ORDER.length];
}

export function isTimeOfDay(v: unknown): v is TimeOfDay {
    return v === 'day' || v === 'evening' || v === 'night';
}

/** 2 つの設定の間を t（0〜1）で補間した値（色も成分ごとに補間） */
export function lerpPreset(a: LightPreset, b: LightPreset, t: number): LightPreset {
    const n = (x: number, y: number) => x + (y - x) * t;
    return {
        tint: lerpColor(a.tint, b.tint, t),
        tintAlpha: n(a.tintAlpha, b.tintAlpha),
        sunColor: lerpColor(a.sunColor, b.sunColor, t),
        sunAlpha: n(a.sunAlpha, b.sunAlpha),
        vignetteAlpha: n(a.vignetteAlpha, b.vignetteAlpha),
        contactAlpha: n(a.contactAlpha, b.contactAlpha),
        castAlpha: n(a.castAlpha, b.castAlpha),
        castLength: n(a.castLength, b.castLength),
        lanternAlpha: n(a.lanternAlpha, b.lanternAlpha),
        waterAlpha: n(a.waterAlpha, b.waterAlpha),
        ambient: t < 0.5 ? a.ambient : b.ambient,
    };
}

export function lerpColor(a: number, b: number, t: number): number {
    const ch = (c: number, s: number) => (c >> s) & 255;
    const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
    return m(16) | m(8) | m(0);
}

/**
 * 乗算で色をかぶせる：tintAlpha を「白との混ぜ具合」として色に焼き込む。
 * （乗算合成の画像は alpha で薄めると暗くなるだけなので、色の側で弱める）
 */
export function effectiveTint(p: LightPreset): number {
    return lerpColor(0xffffff, p.tint, p.tintAlpha);
}
