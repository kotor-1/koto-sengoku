/**
 * 主人公の動き（3D 比較版）。描画に依存しない（テストで直接動かせる）。
 * - 入力は画面の向き（右・上）で受け取り、固定カメラの向きに合わせて地面の方向へ直す。
 * - 歩く／走る：上限の速さだけが変わる（ゲームの時間は変えない）。速さは SPEED の一か所で調整する。
 * - 速さはなめらかに上がり、指を離すと素早く止まる。走るのをやめると、歩きの速さまでなめらかに落とす。
 * - 入力した方向へすぐ進み、体の向きは進みながらなめらかに向き直る（向き終わるのを待たない。途中で別の向きへ変えてもよい）。
 *   体の向きの変わる速さには上限がある（MAX_TURN：60 コマ/秒で 1 コマ 11.5° まで。Version 28）。
 * - 当たり判定は、上から見た円（主人公）と四角形（壁・柱・家）。壁に沿って滑る。壁に沿って滑る間は、体は実際に進む向きを向く（壁へ押し付ける向きのまま横へ滑らない）。
 * 足の運び（着いた足を止める・踏み替え）は描く側（game/legs.ts・game/heroAnim.ts）で、実際に進んだ距離から決める。
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
/** 体の向きの変わる速さの上限（ラジアン/秒）。60 コマ/秒で 1 コマ 11.5°（大きな切り返しでも 1 コマで飛ばない） */
export const MAX_TURN = 12;
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
        // 上限の速さへ近づける（上げるときは ACCEL、走りから歩きに戻すときは DECEL）。斜めでも入力の長さは 1 まで
        const want = (run ? SPEED.run : SPEED.walk) * mag;
        h.speed = h.speed < want ? Math.min(want, h.speed + ACCEL * dt) : Math.max(want, h.speed - DECEL * dt);
    } else {
        h.speed = Math.max(0, h.speed - DECEL * dt);
    }
    if (h.speed <= 1e-4) {
        h.speed = 0;
        if (mag > 0.05) turnToward(h, Math.atan2(h.dirX, h.dirZ), dt);
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
    const mx = h.x - before.x;
    const mz = h.z - before.z;
    const moved = Math.hypot(mx, mz);
    const wanted = Math.hypot(vx, vz);
    if (wanted > 0 && moved < wanted * 0.3) h.speed *= 0.6;
    // 体の向き：入力した方向へ。壁に沿って滑っている（進めたのが 25〜90%）ときは、実際に進んだ向きへ
    if (mag > 0.05) {
        const slide = wanted > 0 && moved > wanted * 0.25 && moved < wanted * 0.9;
        turnToward(h, slide ? Math.atan2(mx, mz) : Math.atan2(h.dirX, h.dirZ), dt);
    }
}

/** 体の向きを target へ近づける（指数的に。1 コマの回りは MAX_TURN·dt まで） */
function turnToward(h: HeroState, target: number, dt: number): void {
    const diff = wrapAngle(target - h.heading);
    const step = diff * (1 - Math.exp(-TURN_RATE * dt));
    const lim = MAX_TURN * dt;
    h.heading = wrapAngle(h.heading + Math.max(-lim, Math.min(lim, step)));
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
