/**
 * 主人公を追うカメラの計算。
 * - 経過時間に依存しない指数補間で、フレームレートが変わっても同じ滑らかさ。
 * - 歩いている方向を「ほんの少しだけ」先に見る（最大 10 ワールド px、ゆっくり変化）。
 * - 揺れ・振動・急な寄りはしない（酔い防止）。
 */
export interface CameraParams {
    /** 追従の速さ（1/秒）。大きいほど素早い。 */
    followRate: number;
    /** 先読みの時間（秒） */
    lookAheadTime: number;
    /** 先読みの最大距離（ワールド px） */
    lookAheadMax: number;
    /** 先読み量が変化する速さ（1/秒）。小さいほど穏やか。 */
    lookAheadRate: number;
    /** これ以上離れたら補間せず瞬時に合わせる（読み込み・ワープ時） */
    snapDistance: number;
}

export const DEFAULT_CAMERA: CameraParams = {
    followRate: 5.5,
    lookAheadTime: 0.14,
    lookAheadMax: 10,
    lookAheadRate: 2.2,
    snapDistance: 160,
};

export class CameraFollower {
    x = 0;
    y = 0;
    private lookX = 0;
    private lookY = 0;

    constructor(private readonly p: CameraParams = DEFAULT_CAMERA) {}

    snap(x: number, y: number): void {
        this.x = x;
        this.y = y;
        this.lookX = 0;
        this.lookY = 0;
    }

    /** target: 主人公の位置, vel: 主人公の速度（px/秒） */
    update(targetX: number, targetY: number, velX: number, velY: number, dt: number): { x: number; y: number } {
        if (dt <= 0) return { x: this.x, y: this.y };
        const p = this.p;
        let lx = velX * p.lookAheadTime;
        let ly = velY * p.lookAheadTime;
        const ll = Math.hypot(lx, ly);
        if (ll > p.lookAheadMax) {
            lx = (lx / ll) * p.lookAheadMax;
            ly = (ly / ll) * p.lookAheadMax;
        }
        const la = 1 - Math.exp(-p.lookAheadRate * dt);
        this.lookX += (lx - this.lookX) * la;
        this.lookY += (ly - this.lookY) * la;

        const tx = targetX + this.lookX;
        const ty = targetY + this.lookY;
        if (Math.hypot(tx - this.x, ty - this.y) > p.snapDistance) {
            this.x = tx;
            this.y = ty;
        } else {
            const a = 1 - Math.exp(-p.followRate * dt);
            this.x += (tx - this.x) * a;
            this.y += (ty - this.y) * a;
        }
        return { x: this.x, y: this.y };
    }
}
