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
}

export interface QualityEnv {
    devicePixelRatio: number;
    deviceMemory?: number;
    hardwareConcurrency?: number;
    touch: boolean;
    /** URL の ?q=low / ?q=high で強制できる */
    forced?: string | null;
}

export function chooseQuality(env: QualityEnv): QualityProfile {
    let tier: QualityTier = 'high';
    if (env.forced === 'low' || env.forced === 'high') tier = env.forced;
    else if ((env.deviceMemory !== undefined && env.deviceMemory <= 3) || (env.hardwareConcurrency !== undefined && env.hardwareConcurrency <= 4)) tier = 'low';
    const high = tier === 'high';
    return {
        tier,
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
    private lastAvgFps = 60;

    constructor(
        private readonly steps: number[] = [2, 1.5, 1.25, 1],
        private readonly thresholdFps = 45,
        private readonly window = 2,
        warmupSec = 3,
    ) {
        this.warmup = warmupSec;
    }

    get averageFps(): number {
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
