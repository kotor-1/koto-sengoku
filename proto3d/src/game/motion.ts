/**
 * 主人公の動き（3D 比較版）。描画に依存しない（テストで直接動かせる）。
 * - 入力は画面の向き（右・上）で受け取り、固定カメラの向きに合わせて地面の方向へ直す。
 * - 速さはなめらかに上がり、指を離すと素早く止まる。
 * - 向きは移動方向へなめらかに回る（その場で方向転換もする）。
 * - 当たり判定は、上から見た円（主人公）と四角形（壁・柱・家）。壁に沿って滑る。
 */
import { BOUNDS, colliders, type Rect } from '../layout';

export const HERO_RADIUS = 0.28;
export const MAX_SPEED = 1.55;
const ACCEL = 5.5;
const DECEL = 9;
/** 向きを変える速さ（1/秒、指数的に近づく） */
const TURN_RATE = 10;

export interface HeroState {
    x: number;
    z: number;
    /** 向き（ラジアン）。0 = +z（南・画面の手前寄り）を向く */
    heading: number;
    speed: number;
    /** 最後に動こうとした方向（地面） */
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

export function stepHero(h: HeroState, ix: number, iy: number, cameraYaw: number, dt: number, rects: Rect[] = RECTS): void {
    const mag = Math.min(1, Math.hypot(ix, iy));
    if (mag > 0.05) {
        const d = screenToGround(ix / mag, iy / mag, cameraYaw);
        h.dirX = d.x;
        h.dirZ = d.z;
        const target = Math.atan2(d.x, d.z);
        const diff = wrapAngle(target - h.heading);
        h.heading = wrapAngle(h.heading + diff * (1 - Math.exp(-TURN_RATE * dt)));
        // 大きく向きを変えるときは、向き終わるまで速度を上げない（その場で振り向く）
        const facing = Math.cos(diff);
        const want = MAX_SPEED * mag * Math.max(0, facing);
        h.speed = Math.min(want, h.speed + ACCEL * dt) * (facing < 0.2 ? 0.5 : 1);
    } else {
        h.speed = Math.max(0, h.speed - DECEL * dt);
    }
    if (h.speed <= 1e-4) {
        h.speed = 0;
        return;
    }
    // 向いている方向へ進む（体の向きと進む向きをそろえ、横滑りしない）
    const vx = Math.sin(h.heading) * h.speed * dt;
    const vz = Math.cos(h.heading) * h.speed * dt;
    const before = { x: h.x, z: h.z };
    h.x += vx;
    resolve(h, rects);
    h.z += vz;
    resolve(h, rects);
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
