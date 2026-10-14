/**
 * 人ごとの拍子と、店の人の仕事の移り（Version 28 §4.2。純粋。three も DOM も使わない）。描くのは explore/people.ts・explore/actors.ts。
 *
 * - 拍子（PersonRhythm）：歩く速さ（0.95〜1.3 m/秒）・歩幅・待機の動きの再生の速さ・待機と歩きの始まりの位相を人ごとに変える
 *   （全員が同じ周期・同じ拍子で揺れない）。町の人々（荷運び・店の人・町の様子の人）は表（TOWNSFOLK）で決め、どの 2 人も同じ周期・
 *   同じ位相にならない（tests/proto3d-townsfolk.test.ts）。ほかの人（会話の相手・使者・家臣）は名前（key）から決まる数で決める。
 *   Version 27 までは名前の数から待機の始めをずらしただけで、名前の最後の 1 字だけ違う人（porter0・porter1）は 4 ms しかずれず、同じ拍子だった。
 * - 歩幅は速さに合わせる（遅い人ほど歩幅が狭く、歩く回数が速さで大きく変わらない）。動きの元（Walk）の 1 周期の距離より短い歩幅は、
 *   歩きの動きの重みを歩幅の倍率にして、待機の形と混ぜて出す（足の運びが歩幅に合い、足が地面の上で滑らない：people.ts の posePerson）。
 * - 店の人の仕事（merchantAct）：待機・通りを見る（首を巡らす）・品物を整える（店の方へ向き直って前かがみ・手を動かす）を、人ごとに
 *   決まった順と長さで繰り返す（時刻の純粋な関数）。近くを主人公が通ったときの軽い会釈は、主人公の位置が要るので描く側（actors.ts）が足す。
 */

/** 人ごとの拍子 */
export interface PersonRhythm {
    /** 歩く速さ（m/秒） */
    speed: number;
    /** 歩幅の倍率（動きの元の 1 周期の距離 × 体の大きさ × これ。1 以下） */
    stride: number;
    /** 待機の動きの再生の速さ（倍率） */
    idleRate: number;
    /** 待機の動きの始めの位置（0〜1） */
    idlePhase: number;
    /** 歩きの動きの始めの位相（0〜1） */
    walkPhase: number;
}

/** 町の人の歩く速さの範囲（m/秒） */
export const TOWNSFOLK_SPEED = [0.95, 1.3] as const;
/** 待機の動きの再生の速さの範囲 */
const IDLE_RATE = [0.84, 1.16] as const;

/** 速さに合う歩幅の倍率（遅い人ほど狭い。0.95 m/秒で 0.86、1.3 m/秒で 0.99） */
export function strideForSpeed(speed: number): number {
    return Math.max(0.82, Math.min(1, 0.5 + 0.38 * speed));
}

/** 名前（文字列）から決まる数（皆が同じ拍子にならないように） */
export function hashOf(s: string): number {
    let h = 7;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
}

/** 名前から決まる 0〜1 の数の並び（同じ名前・同じ番号なら同じ数。名前の 1 字の違いでも大きく変わる） */
export function seeded(key: string, i: number): number {
    // mulberry32（名前の数と番号を混ぜて始める）
    let a = (hashOf(key) ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0;
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const mk = (speed: number, idleRate: number, idlePhase: number, walkPhase: number, strideJitter = 0): PersonRhythm => ({
    speed,
    stride: r3(Math.min(1, strideForSpeed(speed) + strideJitter)),
    idleRate,
    idlePhase,
    walkPhase,
});

/**
 * 町の人々の拍子（表）。速さ・待機の速さ・位相をばらし、どの 2 人も同じ周期・同じ位相にならない。
 * 荷運びは荷を担ぐので少しゆっくりの人もいる。店の人は歩かない（速さは使わない）が、待機の拍子は違える
 */
export const TOWNSFOLK: Readonly<Record<string, PersonRhythm>> = {
    porter0: mk(1.06, 0.86, 0.1, 0.31, 0.02),
    porter1: mk(1.24, 1.12, 0.14, 0.91, -0.02),
    merchant0: mk(1.0, 0.95, 0.13, 0.58),
    merchant1: mk(1.15, 1.05, 0.88, 0.37),
    life_porter_w: mk(1.12, 0.9, 0.13, 0.13, 0.01),
    life_porter_e: mk(1.28, 1.16, 0.39, 0.64, -0.01),
    life_merchant: mk(0.98, 1.0, 0.58, 0.8),
};

/** 人ごとの拍子（町の人々は表、ほかは名前から） */
export function rhythmOf(key: string): PersonRhythm {
    const t = TOWNSFOLK[key];
    if (t) return t;
    const speed = r3(TOWNSFOLK_SPEED[0] + (TOWNSFOLK_SPEED[1] - TOWNSFOLK_SPEED[0]) * seeded(key, 0));
    return mk(speed, r3(IDLE_RATE[0] + (IDLE_RATE[1] - IDLE_RATE[0]) * seeded(key, 1)), r3(seeded(key, 2)), r3(seeded(key, 3)), r3((seeded(key, 4) - 0.5) * 0.04));
}

/** 待機の動きの再生位置（秒。動きの長さ duration の中）：時刻 time に拍子の速さと始めの位置を当てる */
export function idleClipTime(r: PersonRhythm, time: number, duration: number): number {
    const v = time * r.idleRate + r.idlePhase * duration;
    return ((v % duration) + duration) % duration;
}

// ================================================================ 町の人の上体の動き

/** 町の人の上体の動き（描く側 explore/actors.ts が、動きの元の形の上に骨へ足す）。どれも 0〜1 の重み */
export interface PersonAct {
    /** 前かがみ（品物を整える・荷を持ち上げる） */
    lean: number;
    /** 手を前へ出して動かす（品物を整える・荷を持ち上げる） */
    hands: number;
    /** 手の動きの位相（ラジアン） */
    handPhase: number;
    /** 見る所（世界の x・z と地面からの高さ y。null は正面）と向ける強さ（0〜1） */
    look: { x: number; y: number; z: number } | null;
    lookWeight: number;
    /** 片膝をつく（0〜1。急報の使者。骨の形で：腰を下げ、前の脚は膝を立て、後ろの脚は膝を地面へ。縮めない） */
    kneel?: number;
    /** 礼（0〜1。家臣の軽い礼。会釈と同じ形） */
    bow?: number;
}

export const NO_ACT: PersonAct = { lean: 0, hands: 0, handPhase: 0, look: null, lookWeight: 0 };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => {
    const x = clamp01(v);
    return x * x * (3 - 2 * x);
};

/** 店の人の向き直り（品物を整えるとき）にかける秒 */
export const MERCHANT_TURN_SEC = 1.3;
/** 前かがみになる・戻る秒 */
const LEAN_SEC = 0.6;

/** 店の人の 1 巡りの仕事の長さ（人ごと） */
function merchantPlan(key: string): { idle1: number; look: number; idle2: number; arrange: number; period: number; start: number; side: number; back: number; lookA: number } {
    const idle1 = 3 + 3 * seeded(key, 10);
    const look = 3.5 + 2.5 * seeded(key, 11);
    const idle2 = 2 + 2 * seeded(key, 12);
    const arrange = 6 + 3 * seeded(key, 13);
    const period = idle1 + look + idle2 + arrange;
    return {
        idle1,
        look,
        idle2,
        arrange,
        period,
        start: period * seeded(key, 14),
        // 店の方へ向き直る回り（右回り・左回り）と、真後ろからのずれ（ちょうど 180° にしない）・通りを見回す広さ
        side: seeded(key, 15) < 0.5 ? -1 : 1,
        back: Math.PI - (0.25 + 0.3 * seeded(key, 16)),
        lookA: 0.6 + 0.5 * seeded(key, 17),
    };
}

/**
 * 店の人の、時刻 time の向きと上体の動き（純粋）。立つ所 (x, z)・通りを向く向き heading。
 * 待機 → 通りを見る（首を左右へ巡らす）→ 待機 → 品物を整える（店の方へ向き直り、前かがみで手を動かし、通りへ向き直る）を繰り返す。
 * 向き直りは MERCHANT_TURN_SEC 秒かけてなめらかに（1 コマで 12° を超えて回らない。足は描く側が踏み替える）
 */
export function merchantAct(key: string, x: number, z: number, heading: number, time: number): { heading: number; act: PersonAct } {
    const p = merchantPlan(key);
    let u = (((time + p.start) % p.period) + p.period) % p.period;
    // 待機
    if (u < p.idle1) return { heading, act: NO_ACT };
    u -= p.idle1;
    if (u < p.look) {
        // 通りを見る：通りの一方から他方へゆっくり首を巡らす（始めと終わりは正面から・正面へ）
        const w = ease(u / 0.6) * ease((p.look - u) / 0.6);
        const a = heading + p.side * p.lookA * Math.cos((Math.PI * u) / p.look);
        return { heading, act: { lean: 0, hands: 0, handPhase: 0, look: { x: r3(x + Math.sin(a) * 4), y: 1.45, z: r3(z + Math.cos(a) * 4) }, lookWeight: r3(w) } };
    }
    u -= p.look;
    if (u < p.idle2) return { heading, act: NO_ACT };
    u -= p.idle2;
    // 品物を整える：向き直る → 前かがみで手を動かす → 起きる → 通りへ向き直る
    const T = MERCHANT_TURN_SEC;
    const turn = ease(u / T) * ease((p.arrange - u) / T);
    const lean = ease((u - T) / LEAN_SEC) * ease((p.arrange - T - u) / LEAN_SEC);
    const h = heading + p.side * p.back * turn;
    return { heading: Math.round(h * 1e6) / 1e6, act: { lean: r3(lean), hands: r3(lean), handPhase: r3(u * Math.PI * 2 * 0.62), look: null, lookWeight: 0 } };
}

/** 会釈（主人公が近くを通ったとき）の形の重み（会釈を始めてから s 秒。0〜1。上げて・少し止めて・戻す） */
export const BOW_SEC = 1.4;
export function bowWeight(s: number): number {
    if (s < 0 || s > BOW_SEC) return 0;
    if (s < 0.45) return ease(s / 0.45);
    if (s < 0.75) return 1;
    return 1 - ease((s - 0.75) / 0.65);
}
