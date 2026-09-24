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

/**
 * 昼：ほぼ無色の自然光、弱い周辺減光。影は短め。
 * 夕（既定）：金色の西日（乗算で暖色 + 左上から加算の日差し）、長く柔らかい影、灯りがともり始める。
 * 夜：月明かりの青（乗算で青く暗く + 左上から弱い青白い光）、柔らかい月影、温かい灯りと蛍。
 *     道と人物が読める明るさを保つ（乗算の係数はおよそ R0.41 G0.50 B0.78）。
 */
export const PRESETS: Record<TimeOfDay, LightPreset> = {
    day: {
        tint: 0xfff6e6,
        tintAlpha: 0.12,
        sunColor: 0xfff1d0,
        sunAlpha: 0.12,
        vignetteAlpha: 0.2,
        contactAlpha: 0.42,
        castAlpha: 0.26,
        castLength: 0.7,
        lanternAlpha: 0,
        waterAlpha: 0.4,
        ambient: 'motes',
    },
    evening: {
        tint: 0xf2c29a,
        tintAlpha: 0.55,
        sunColor: 0xffb877,
        sunAlpha: 0.32,
        vignetteAlpha: 0.28,
        contactAlpha: 0.44,
        castAlpha: 0.3,
        castLength: 1.6,
        lanternAlpha: 0.4,
        waterAlpha: 0.45,
        ambient: 'leaves',
    },
    night: {
        tint: 0x4260b8,
        tintAlpha: 0.8,
        sunColor: 0x9fb6ea,
        sunAlpha: 0.1,
        vignetteAlpha: 0.42,
        contactAlpha: 0.5,
        castAlpha: 0.2,
        castLength: 0.8,
        lanternAlpha: 1,
        waterAlpha: 0.28,
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
