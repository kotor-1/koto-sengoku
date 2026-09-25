/**
 * 主人公の動き（3D 比較版）。描画に依存しない（テストで直接動かせる）。
 * - 入力は画面の向き（右・上）で受け取り、固定カメラの向きに合わせて地面の方向へ直す。
 * - 歩く／走る：上限の速さだけが変わる（ゲームの時間は変えない）。速さは SPEED の一か所で調整する。
 * - 速さはなめらかに上がり、指を離すと素早く止まる。走るのをやめると、歩きの速さまでなめらかに落とす。
 * - 入力した方向へすぐ進み、体の向きは進みながらなめらかに向き直る（向き終わるのを待たない）。
 * - 当たり判定は、上から見た円（主人公）と四角形（壁・柱・家）。壁に沿って滑る。
 */
import { BOUNDS, colliders, type Rect } from '../layout';

/** 固定カメラの向き（真南から北を見る＝0）。カメラの置き方（main.ts）と入力の変換で共用する */
export const CAMERA_YAW = 0;
export const HERO_RADIUS = 0.28;
/**
 * 移動の速さ（m/秒）。調整はここだけで行う。
 *   walk：歩き（これまでの値）、run：走り（初期値は歩きの 2.2 倍）
 */
export const SPEED = { walk: 1.55, run: 1.55 * 2.2 } as const;
/** 歩きの上限（これまでの名前） */
export const MAX_SPEED = SPEED.walk;
const ACCEL = 5.5;
/** 入力を離したとき・走るのをやめたときの減速。走りからでも約 0.3 秒で止まる */
const DECEL = 12;
/** 1 回に動かす距離の上限（m）。走っても壁や柱をすり抜けないように、これより長い移動は分けて判定する */
const SUBSTEP = 0.1;
/** 向きを変える速さ（1/秒、指数的に近づく）。180° の切り返しで約 0.3 秒 */
const TURN_RATE = 14;
/** 進む方向が逆向き寄り（90° より大きく）に切り替わったとき、残す速さの割合（勢いを殺して切り返す） */
const REVERSE_KEEP = 0.4;

export interface HeroState {
    x: number;
    z: number;
    /** 向き（ラジアン）。0 = +z（南・画面の手前寄り）を向く */
    heading: number;
    speed: number;
    /** 進む方向（地面、長さ 1）。最後に入力した方向 */
    dirX: number;
    dirZ: number;
}

export function createHero(x: number, z: number, heading = Math.PI): HeroState {
    return { x, z, heading, speed: 0, dirX: Math.sin(heading), dirZ: Math.cos(heading) };
}

/** 画面の入力（右 +x、下 +y、長さ 0〜1）→ 地面の方向。カメラは yaw の向きから見下ろす。 */
export function screenToGround(ix: number, iy: number, cameraYaw: number): { x: number; z: number } {
    // 画面の上 = カメラから見て奥 = -(sin yaw, cos yaw)、画面の右 = (cos yaw, -sin yaw)
    const fx = -Math.sin(cameraYaw);
    const fz = -Math.cos(cameraYaw);
    const rx = Math.cos(cameraYaw);
    const rz = -Math.sin(cameraYaw);
    return { x: rx * ix + fx * -iy, z: rz * ix + fz * -iy };
}

function wrapAngle(a: number): number {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}

const RECTS = colliders();

export function stepHero(h: HeroState, ix: number, iy: number, cameraYaw: number, dt: number, run = false, rects: Rect[] = RECTS): void {
    const len = Math.hypot(ix, iy);
    const mag = Math.min(1, len);
    if (mag > 0.05) {
        // 向きは長さ 1 にし、強さは 1 までに切る（斜めでも速くならない）
        const d = screenToGround(ix / len, iy / len, cameraYaw);
        // 向き直るのを待たずに進む。逆向き寄りに切り返したときだけ、一度だけ速さを落とす
        if (d.x * h.dirX + d.z * h.dirZ < 0) h.speed *= REVERSE_KEEP;
        h.dirX = d.x;
        h.dirZ = d.z;
        const target = Math.atan2(d.x, d.z);
        const diff = wrapAngle(target - h.heading);
        h.heading = wrapAngle(h.heading + diff * (1 - Math.exp(-TURN_RATE * dt)));
        // 上限の速さへ近づける（上げるときは ACCEL、走りから歩きに戻すときは DECEL）。斜めでも入力の長さは 1 まで
        const want = (run ? SPEED.run : SPEED.walk) * mag;
        h.speed = h.speed < want ? Math.min(want, h.speed + ACCEL * dt) : Math.max(want, h.speed - DECEL * dt);
    } else {
        h.speed = Math.max(0, h.speed - DECEL * dt);
    }
    if (h.speed <= 1e-4) {
        h.speed = 0;
        return;
    }
    // 入力した方向へ進む（体の向きは後から追いつく）
    const vx = h.dirX * h.speed * dt;
    const vz = h.dirZ * h.speed * dt;
    const before = { x: h.x, z: h.z };
    const n = Math.max(1, Math.ceil(Math.hypot(vx, vz) / SUBSTEP));
    for (let i = 0; i < n; i++) {
        h.x += vx / n;
        resolve(h, rects);
        h.z += vz / n;
        resolve(h, rects);
    }
    // 壁に当たって進めなかった分は速度も落とす
    const moved = Math.hypot(h.x - before.x, h.z - before.z);
    const wanted = Math.hypot(vx, vz);
    if (wanted > 0 && moved < wanted * 0.3) h.speed *= 0.6;
}

/** 円を四角形の外へ押し出す */
function resolve(h: HeroState, rects: Rect[]): void {
    const r = HERO_RADIUS;
    for (const q of rects) {
        const cx = Math.max(q.x0, Math.min(q.x1, h.x));
        const cz = Math.max(q.z0, Math.min(q.z1, h.z));
        const dx = h.x - cx;
        const dz = h.z - cz;
        const d = Math.hypot(dx, dz);
        if (d >= r) continue;
        if (d > 1e-6) {
            h.x = cx + (dx / d) * r;
            h.z = cz + (dz / d) * r;
        } else {
            // 中心が四角形の中：近い辺へ出す
            const left = h.x - q.x0;
            const right = q.x1 - h.x;
            const top = h.z - q.z0;
            const bottom = q.z1 - h.z;
            const m = Math.min(left, right, top, bottom);
            if (m === left) h.x = q.x0 - r;
            else if (m === right) h.x = q.x1 + r;
            else if (m === top) h.z = q.z0 - r;
            else h.z = q.z1 + r;
        }
    }
    h.x = Math.max(BOUNDS.x0, Math.min(BOUNDS.x1, h.x));
    h.z = Math.max(BOUNDS.z0, Math.min(BOUNDS.z1, h.z));
}

/** その位置に立てるか（テスト用） */
export function isFree(x: number, z: number, rects: Rect[] = RECTS): boolean {
    return rects.every((q) => {
        const cx = Math.max(q.x0, Math.min(q.x1, x));
        const cz = Math.max(q.z0, Math.min(q.z1, z));
        return Math.hypot(x - cx, z - cz) >= HERO_RADIUS - 1e-6;
    });
}
