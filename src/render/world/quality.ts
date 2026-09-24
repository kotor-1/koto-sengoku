/**
 * 表示品質の設定。スマホでの動作を最優先し、重い端末では自動で解像度や効果を下げる。
 *
 * - renderScale：Canvas の解像度（CSS px あたりの実 px）。端末の devicePixelRatio を上限 2 までに抑える。
 * - 描画が遅いと判断したら、ゲーム中に renderScale を段階的に下げる（上げ直しはしない＝ちらつき防止）。
 */
import { GROUND_TEX_HIGH, GROUND_TEX_LOW, OBJECT_TEX_HIGH, OBJECT_TEX_LOW } from '../art/spec';

export type QualityTier = 'high' | 'low';

export interface QualityProfile {
    tier: QualityTier;
    /** Canvas 解像度の上限（devicePixelRatio と比べて小さい方を使う） */
    maxRenderScale: number;
    /** 自動で下げるときの下限 */
    minRenderScale: number;
    groundTex: number;
    objectTex: number;
    /** 揺れる草の数 */
    grassTufts: number;
    /** 画面内を漂う粒子の最大数 */
    ambientParticles: number;
    /** 煙を出す家の数 */
    smokeSources: number;
    /** 地面の細かい質感を重ねるか（全画面 1 枚分の描画が増える） */
    groundDetail: boolean;
    /** どう決まったか：url（?q=）、manual（メニューで選択）、auto（自動判定） */
    source: 'url' | 'manual' | 'auto';
    /** 決まった理由（画面表示用） */
    reason: string;
}

export type QualityChoice = 'auto' | QualityTier;

export function isQualityChoice(v: unknown): v is QualityChoice {
    return v === 'auto' || v === 'high' || v === 'low';
}

export interface QualityEnv {
    devicePixelRatio: number;
    deviceMemory?: number;
    hardwareConcurrency?: number;
    touch: boolean;
    /** URL の ?q=low / ?q=high で強制できる（最優先） */
    forced?: string | null;
    /** メニューで選んだ画質（端末に保存。URL の次に優先） */
    manual?: QualityChoice | null;
}

/**
 * 画質を決める。優先順：URL（?q=）→ メニューの選択 → 自動判定。
 * 自動判定：メモリ 3GB 以下、またはコア数 2 以下なら low。
 * 端末情報が取れない場合（iOS Safari は deviceMemory を返さない等）は high とし、
 * 実際に遅ければ ResolutionGovernor が描画解像度を下げる。
 */
export function chooseQuality(env: QualityEnv): QualityProfile {
    let tier: QualityTier = 'high';
    let source: QualityProfile['source'] = 'auto';
    let reason: string;
    if (env.forced === 'low' || env.forced === 'high') {
        tier = env.forced;
        source = 'url';
        reason = `URL で指定（?q=${env.forced}）`;
    } else if (env.manual === 'low' || env.manual === 'high') {
        tier = env.manual;
        source = 'manual';
        reason = 'メニューで選択';
    } else {
        const mem = env.deviceMemory;
        const cores = env.hardwareConcurrency;
        const lowMem = mem !== undefined && mem <= 3;
        const lowCpu = cores !== undefined && cores <= 2;
        tier = lowMem || lowCpu ? 'low' : 'high';
        const known = [mem !== undefined ? `メモリ ${mem}GB` : null, cores !== undefined ? `コア ${cores}` : null].filter(Boolean);
        reason = known.length === 0 ? '自動（端末情報なし→高）' : `自動（${known.join('・')}）`;
    }
    const high = tier === 'high';
    return {
        tier,
        source,
        reason,
        maxRenderScale: high ? 2 : 1.5,
        minRenderScale: 1,
        groundTex: high ? GROUND_TEX_HIGH : GROUND_TEX_LOW,
        objectTex: high ? OBJECT_TEX_HIGH : OBJECT_TEX_LOW,
        grassTufts: high ? 220 : 110,
        ambientParticles: high ? 14 : 8,
        smokeSources: high ? 3 : 2,
        groundDetail: high,
    };
}

export function initialRenderScale(q: QualityProfile, dpr: number): number {
    return Math.max(q.minRenderScale, Math.min(q.maxRenderScale, dpr || 1));
}

/**
 * フレーム時間を見て、遅ければ解像度を一段下げるよう知らせる。
 * 起動直後（テクスチャ転送などで遅い）は見ない。判定は 2 秒ごとの平均。
 */
export class ResolutionGovernor {
    private acc = 0;
    private frames = 0;
    private warmup: number;
    private lastAvgFps: number | null = null;

    constructor(
        private readonly steps: number[] = [2, 1.5, 1.25, 1],
        private readonly thresholdFps = 45,
        private readonly window = 2,
        warmupSec = 3,
    ) {
        this.warmup = warmupSec;
    }

    /** 直近 2 秒の平均 fps。起動直後でまだ測っていなければ null */
    get averageFps(): number | null {
        return this.lastAvgFps;
    }

    /** dt 秒のフレームを記録。下げるべきなら新しい renderScale、そうでなければ null。 */
    sample(dt: number, current: number): number | null {
        if (dt <= 0 || dt > 0.5) return null; // タブ復帰などの極端な値は捨てる
        if (this.warmup > 0) {
            this.warmup -= dt;
            return null;
        }
        this.acc += dt;
        this.frames++;
        if (this.acc < this.window) return null;
        this.lastAvgFps = this.frames / this.acc;
        this.acc = 0;
        this.frames = 0;
        if (this.lastAvgFps >= this.thresholdFps) return null;
        const next = this.steps.find((s) => s < current - 0.01);
        if (next === undefined) return null;
        this.warmup = 1.5; // 切り替え直後は測り直す
        return next;
    }
}

/** メニューで選んだ画質の保存先（ゲームの保存データとは別。端末の好みとして覚えるだけ） */
export const QUALITY_PREF_KEY = 'koto-sengoku/quality';

export function loadQualityChoice(): QualityChoice {
    try {
        const v = globalThis.localStorage?.getItem(QUALITY_PREF_KEY);
        return isQualityChoice(v) ? v : 'auto';
    } catch {
        return 'auto';
    }
}

/** 保存できたら true */
export function saveQualityChoice(c: QualityChoice): boolean {
    try {
        globalThis.localStorage?.setItem(QUALITY_PREF_KEY, c);
        return globalThis.localStorage?.getItem(QUALITY_PREF_KEY) === c;
    } catch {
        return false;
    }
}

export const QUALITY_LABELS: Record<QualityChoice, string> = { auto: '自動', high: '高', low: '低' };
