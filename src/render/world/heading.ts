/**
 * 人物の見た目の向き（8 方向）。core の向き（4 方向）はそのまま使い、
 * 表示だけを「実際に動いた方向」から 8 方向で決める。
 *   0=下, 1=右下, 2=右, 3=右上, 4=上, 5=左上, 6=左, 7=左下
 */
import type { Facing } from '../../core/types';

export function dirFromVector(dx: number, dy: number): number {
    const a = Math.atan2(dy, dx); // 画面座標（下が +y）
    const d = Math.round((Math.PI / 2 - a) / (Math.PI / 4));
    return ((d % 8) + 8) % 8;
}

export function dirFromFacing(f: Facing): number {
    return f === 'down' ? 0 : f === 'right' ? 2 : f === 'up' ? 4 : 6;
}

/** 方向 d の中心角（画面座標のラジアン） */
export function dirAngle(d: number): number {
    return Math.PI / 2 - d * (Math.PI / 4);
}

/** a から b へ最短で回るときの 1 歩（-1, 0, +1） */
export function turnStep(a: number, b: number): number {
    const diff = (((b - a) % 8) + 8) % 8;
    if (diff === 0) return 0;
    return diff <= 4 ? 1 : -1;
}

/** 8 方向で a と b が何歩離れているか（0〜4） */
function stepsBetween(a: number, b: number): number {
    const d = (((a - b) % 8) + 8) % 8;
    return Math.min(d, 8 - d);
}

function angleDiff(a: number, b: number): number {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
}

/**
 * 移動量から見た目の向きと歩行の進み具合を決める。
 * - 境目付近でちらつかないよう、今の向きから少し外れるまでは向きを変えない。
 * - 大きく向きを変えるときは間の向きを短時間ずつ経由する（くるっと振り向く）。
 * - 歩行コマは「歩いた距離」で進めるので、足が滑って見えない。
 */
export class HeadingTracker {
    dir: number;
    /** 歩行周期（0〜1 を繰り返す） */
    phase = 0;
    moving = false;
    private target: number;
    private turnTimer = 0;
    private stillTime = 0;
    private lastCoreFacing: Facing;
    /** 小さな向きの変化は、しばらく続いたときだけ反映する（キーを離す瞬間のずれで向きが変わらないように） */
    private pending = -1;
    private pendingTime = 0;

    constructor(
        initial: Facing,
        private readonly strideLength = 26,
        private readonly turnInterval = 0.045,
    ) {
        this.dir = dirFromFacing(initial);
        this.target = this.dir;
        this.lastCoreFacing = initial;
    }

    /** 表示用に直接向きを合わせる（読み込み直後など） */
    reset(facing: Facing): void {
        this.dir = this.target = dirFromFacing(facing);
        this.lastCoreFacing = facing;
        this.phase = 0;
        this.moving = false;
    }

    update(dx: number, dy: number, dt: number, coreFacing: Facing, coreMoving: boolean): void {
        const dist = Math.hypot(dx, dy);
        if (dist > 0.01 && dt > 0) {
            const a = Math.atan2(dy, dx);
            // 今の向きから 22.5°+余裕 以内なら向きを保つ
            if (angleDiff(a, dirAngle(this.target)) > Math.PI / 8 + 0.14) {
                const d = dirFromVector(dx, dy);
                // 歩き始め・大きな方向転換はすぐ反映。45° の変化は 0.07 秒続いたら反映。
                if (!this.moving || stepsBetween(d, this.target) >= 2) {
                    this.target = d;
                    this.pending = -1;
                } else {
                    this.pendingTime = this.pending === d ? this.pendingTime + dt : dt;
                    this.pending = d;
                    if (this.pendingTime >= 0.07) {
                        this.target = d;
                        this.pending = -1;
                    }
                }
            } else this.pending = -1;
            this.phase = (this.phase + dist / this.strideLength) % 1;
            this.stillTime = 0;
            this.moving = true;
        } else {
            this.stillTime += dt;
            // 一瞬止まっただけで待機に戻さない
            this.moving = coreMoving && this.stillTime <= 0.09;
            // 動かずに core の向きだけ変わった（話しかけられて振り向く、壁に向かって押す など）ときは合わせる。
            // 斜めに歩いて止まったときは、斜めの向きのまま待機する。
            if (coreFacing !== this.lastCoreFacing) this.target = dirFromFacing(coreFacing);
        }
        this.lastCoreFacing = coreFacing;
        this.stepTurn(dt);
    }

    /** 歩行コマ番号（0〜frames-1） */
    walkFrame(frames: number): number {
        return Math.floor(this.phase * frames) % frames;
    }

    private stepTurn(dt: number): void {
        if (this.dir === this.target) {
            this.turnTimer = 0;
            return;
        }
        const step = turnStep(this.dir, this.target);
        if (stepsBetween(this.dir, this.target) <= 1) {
            this.dir = this.target;
            this.turnTimer = 0;
            return;
        }
        this.turnTimer += dt;
        while (this.turnTimer >= this.turnInterval && this.dir !== this.target) {
            this.turnTimer -= this.turnInterval;
            this.dir = (this.dir + step + 8) % 8;
        }
    }
}
