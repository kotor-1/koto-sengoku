/**
 * 顔と目線を相手へ向ける（Version 28 §4.4）。首（Neck）と頭（Head）の骨を、見る点の方へ、限度となめらかさを付けて回す。
 * 主人公・会話の相手・演出の人物（同じ骨組みの人物）で使える。描画に依存しない（three の骨だけ）。
 * - 動きの元（待機・歩き）で骨を置いた後（mixer.update の後）に update を呼ぶ。動きの元の首・頭の回りに、見る向きの分を足す。
 * - 見る向きは胸（首の親）から見た左右（yaw）・上下（pitch）。左右 ±75°・上 25°・下 35° まで。超える分は体を回す側（呼ぶ側）の仕事。
 * - 首 4 割・頭 6 割に分ける。目標へは指数的に近づき、1 秒に 260° を超えて回さない（急に振り向かない）。見る点を外すと正面へ戻す。
 * - 目の骨は無い（目は頭と一緒に動く。人物の形に目の骨を足すのは素材の作り直しになるので、ここではしない）。
 */
import * as THREE from 'three';

export const GAZE_LIMIT = { yaw: (75 * Math.PI) / 180, up: (25 * Math.PI) / 180, down: (35 * Math.PI) / 180 } as const;
/** 目標へ近づく時定数（秒）と、回す速さの上限（ラジアン/秒） */
const TAU = 0.18;
const MAX_RATE = (260 * Math.PI) / 180;
/** 頭の骨から見た目の高さ（m。見る線の始まり） */
const EYE = new THREE.Vector3(0, 0.08, 0.06);

const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const Q_YAW = new THREE.Quaternion();
const Q_PITCH = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class Gaze {
    /** 今の向き（首と頭を合わせた分。胸から見た左右・上下。正で左（+x）・上） */
    yaw = 0;
    pitch = 0;
    private target: THREE.Vector3 | null = null;
    private weight = 1;
    /** 前のコマに足した回転と、足した後の局所の回転（動きの元がその骨を動かさないときに、足した分を重ねないため） */
    private readonly added = [new THREE.Quaternion(), new THREE.Quaternion()];
    private readonly after = [new THREE.Quaternion(), new THREE.Quaternion()];
    private hasAdded = false;

    constructor(
        private readonly neck: THREE.Bone,
        private readonly head: THREE.Bone,
    ) {}

    /** 骨の一覧（findBones）から作る。首・頭が無ければ null */
    static from(bones: Map<string, THREE.Bone>): Gaze | null {
        const n = bones.get('Neck');
        const h = bones.get('Head');
        return n && h ? new Gaze(n, h) : null;
    }

    /** 見る点（世界）。null で正面へ戻す。weight（0〜1）で向ける強さ（少しだけ向けるとき） */
    lookAt(p: THREE.Vector3 | { x: number; y: number; z: number } | null, weight = 1): void {
        if (!p) {
            this.target = null;
            return;
        }
        this.target = (this.target ?? new THREE.Vector3()).set(p.x, p.y, p.z);
        this.weight = Math.max(0, Math.min(1, weight));
    }

    get looking(): boolean {
        return !!this.target;
    }

    /** すぐに向きを合わせる（場面の切り替えの直後など） */
    snap(): void {
        this.undoStale();
        const [y, p] = this.desired();
        this.yaw = y;
        this.pitch = p;
        this.apply();
    }

    /** 1 コマ進めて、首と頭の骨に足す（動きの元で骨を置いた後に毎コマ呼ぶ） */
    update(dt: number): void {
        this.undoStale();
        const [wy, wp] = this.desired();
        const k = dt > 0 ? 1 - Math.exp(-dt / TAU) : 0;
        const step = (cur: number, want: number) => {
            const d = (want - cur) * k;
            const lim = MAX_RATE * Math.max(0, dt);
            return cur + Math.max(-lim, Math.min(lim, d));
        };
        this.yaw = step(this.yaw, wy);
        this.pitch = step(this.pitch, wp);
        this.apply();
    }

    /** 見たい向き（胸から見た左右・上下。限度で切る） */
    private desired(): [number, number] {
        if (!this.target) return [0, 0];
        const chest = this.neck.parent;
        if (!chest) return [0, 0];
        chest.updateWorldMatrix(true, false);
        this.head.updateWorldMatrix(true, false);
        const eye = tmpV.copy(EYE).applyMatrix4(this.head.matrixWorld);
        // 胸の座標で、目 → 見る点の向き
        tmpM.copy(chest.matrixWorld).invert();
        const a = eye.clone().applyMatrix4(tmpM);
        const b = this.target.clone().applyMatrix4(tmpM);
        const d = b.sub(a);
        const horiz = Math.hypot(d.x, d.z);
        if (horiz < 1e-4 && Math.abs(d.y) < 1e-4) return [0, 0];
        let yaw = Math.atan2(d.x, d.z);
        let pitch = Math.atan2(d.y, horiz);
        // 真後ろ寄り（左右の限度の外）は、限度まで向けて止める（振り向きは体で）
        yaw = Math.max(-GAZE_LIMIT.yaw, Math.min(GAZE_LIMIT.yaw, yaw));
        pitch = Math.max(-GAZE_LIMIT.down, Math.min(GAZE_LIMIT.up, pitch));
        return [yaw * this.weight, pitch * this.weight];
    }

    /** 動きの元がこのコマで骨を置き直さなかった（その骨の動きが無い）ときは、前のコマに足した分を外してから足す */
    private undoStale(): void {
        if (!this.hasAdded) return;
        [this.neck, this.head].forEach((bone, i) => {
            if (bone.quaternion.equals(this.after[i]!)) bone.quaternion.premultiply(tmpQ.copy(this.added[i]!).invert());
        });
        this.hasAdded = false;
    }

    private apply(): void {
        if (Math.abs(this.yaw) < 1e-6 && Math.abs(this.pitch) < 1e-6) return;
        // 首 4 割・頭 6 割。上を見る = x 軸まわりの負（Rx の正は前へうつむく）
        [this.neck, this.head].forEach((bone, i) => {
            const share = i === 0 ? 0.4 : 0.6;
            Q_YAW.setFromAxisAngle(Y_AXIS, this.yaw * share);
            Q_PITCH.setFromAxisAngle(X_AXIS, -this.pitch * share);
            tmpQ.copy(Q_YAW).multiply(Q_PITCH);
            bone.quaternion.premultiply(tmpQ);
            this.added[i]!.copy(tmpQ);
            this.after[i]!.copy(bone.quaternion);
        });
        this.hasAdded = true;
        this.neck.updateMatrixWorld(true);
    }
}
