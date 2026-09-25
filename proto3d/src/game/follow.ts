/**
 * 肩越しの三人称カメラ（探索用）。描画に依存しない（テストで直接動かせる）。
 * - 主人公の頭の高さから、少し右（肩の上）にずらした点を中心に、後ろから見る。
 * - 向き（yaw）と上下（pitch）は利用者のドラッグだけで変わる（勝手に回さない・揺らさない）。
 * - 壁・屋根・庇・柱などの大まかな箱（layout.ts の cameraBlockers）にぶつかる所より手前に置く（突き抜けない）。
 *   近づくときはすぐ、離れるときはなめらかに戻す。
 * 移動の向きはこのカメラの yaw に合わせる（motion.ts の screenToGround に yaw を渡す）。
 */
import * as THREE from 'three';
import { cameraBlockers, type Box } from '../layout';

export const FOLLOW = {
    /** 見る中心の高さ（主人公の首〜頭のあたり） */
    height: 1.58,
    /** 見る中心を右へずらす量（肩越し。主人公は画面の少し左に来る） */
    shoulder: 0.45,
    /** ふだんのカメラまでの距離 */
    distance: 3.3,
    /** 上下の角度（正で見下ろす）。初めは少しだけ見下ろし、空と建物の正面が入る */
    pitch0: 0.1,
    pitchMin: -0.35,
    pitchMax: 0.8,
    /** これより近づいたら主人公を描かない（カメラが頭の中から見るのを避ける） */
    hideHeroDistance: 0.45,
    /** カメラの大きさ（壁との間にこれだけ空ける） */
    radius: 0.22,
    /** 地面からの最低の高さ */
    minHeight: 0.35,
    /** ドラッグ 1px あたりの回転（ラジアン） */
    sensitivity: 0.0055,
} as const;

export interface Orbit {
    /** 0 = 南から北（城門の方）を見る。motion.ts の screenToGround と同じ決まり */
    yaw: number;
    pitch: number;
    /** 実際のカメラまでの距離（壁に当たると縮む） */
    dist: number;
}

export function createOrbit(yaw = 0, pitch: number = FOLLOW.pitch0): Orbit {
    return { yaw, pitch, dist: FOLLOW.distance };
}

/** ドラッグで見回す：右へドラッグで右を向く、上へドラッグで上を向く */
export function look(o: Orbit, dxPx: number, dyPx: number, sensitivity: number = FOLLOW.sensitivity): void {
    o.yaw -= dxPx * sensitivity;
    o.yaw = Math.atan2(Math.sin(o.yaw), Math.cos(o.yaw));
    o.pitch = Math.max(FOLLOW.pitchMin, Math.min(FOLLOW.pitchMax, o.pitch + dyPx * sensitivity));
}

/** カメラの大きさの分だけ広げた箱（毎回作らないよう、一度だけ） */
function expanded(boxes: Box[], r: number): THREE.Box3[] {
    return boxes.map((b) => new THREE.Box3(new THREE.Vector3(b.x0 - r, b.y0 - r, b.z0 - r), new THREE.Vector3(b.x1 + r, b.y1 + r, b.z1 + r)));
}
const BLOCKERS = expanded(cameraBlockers(), FOLLOW.radius);

const ray = new THREE.Ray();
const hitPoint = new THREE.Vector3();
/** 始点から方向 dir へ、最大 max まで進んだとき、最初に箱に当たる距離（当たらなければ max） */
function firstHit(from: THREE.Vector3, dir: THREE.Vector3, max: number, boxes: THREE.Box3[]): number {
    ray.set(from, dir);
    let best = max;
    for (const b of boxes) {
        if (b.containsPoint(from)) return 0;
        if (ray.intersectBox(b, hitPoint)) best = Math.min(best, hitPoint.distanceTo(from));
    }
    return best;
}

export interface CameraPose {
    position: THREE.Vector3;
    /** 見る点 */
    target: THREE.Vector3;
    /** 見る中心（肩の上） */
    pivot: THREE.Vector3;
}

/**
 * 主人公の位置（hx, hz）からカメラの置き場所を決める。o.dist を壁に合わせて更新する（dt は秒）。
 * boxes を渡すとその箱で調べる（テスト用）。
 */
export function placeFollow(o: Orbit, hx: number, hz: number, dt: number, boxes: THREE.Box3[] = BLOCKERS): CameraPose {
    const head = new THREE.Vector3(hx, FOLLOW.height, hz);
    const right = new THREE.Vector3(Math.cos(o.yaw), 0, -Math.sin(o.yaw));
    // 肩の上：頭から右へ。壁が近ければ、そこまで
    const side = firstHit(head, right, FOLLOW.shoulder + FOLLOW.radius, boxes);
    const pivot = head.clone().addScaledVector(right, Math.max(0, Math.min(FOLLOW.shoulder, side - FOLLOW.radius)));
    // 見る向き（水平の向き yaw、上下 pitch）。カメラはその反対側
    const cp = Math.cos(o.pitch);
    const dir = new THREE.Vector3(-Math.sin(o.yaw) * cp, -Math.sin(o.pitch), -Math.cos(o.yaw) * cp);
    const back = dir.clone().negate();
    let allowed = firstHit(pivot, back, FOLLOW.distance, boxes);
    // 地面より下へは行かない（見上げたとき）
    if (back.y < 0) allowed = Math.min(allowed, (pivot.y - FOLLOW.minHeight) / -back.y);
    // 壁までの余地がないときは、その手前まで（最短の距離を決めて壁の中へ押し込まない）
    allowed = Math.max(0, allowed);
    // 近づくのはすぐ（突き抜けない）、離れるのはなめらかに（ちらつかない）
    o.dist = allowed < o.dist ? allowed : o.dist + (allowed - o.dist) * (1 - Math.exp(-4 * dt));
    const position = pivot.clone().addScaledVector(back, o.dist);
    const target = pivot.clone().addScaledVector(dir, 10);
    return { position, target, pivot };
}

/** テスト用：箱の一覧を、カメラの大きさの分だけ広げた形で作る */
export function blockersForTest(boxes: Box[]): THREE.Box3[] {
    return expanded(boxes, FOLLOW.radius);
}
