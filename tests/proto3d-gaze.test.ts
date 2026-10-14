/**
 * 顔と目線（game/gaze.ts）：首・頭の骨を見る点へ、限度となめらかさを付けて向ける。ゲームが読む主人公の GLB の骨で確かめる（ブラウザなし）。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GAZE_LIMIT, Gaze } from '../proto3d/src/game/gaze';
import { findBones } from '../proto3d/src/game/legs';
import { loadGlb, rigOf } from './proto3d-hero-rig';

const DT = 1 / 60;
/** テストごとに読み直す（骨の向きをテストの間で持ち越さない） */
const fresh = () => loadGlb('hero_v3b_mpfb');

/** 頭の前（+z）の、胸から見た左右の向き（ラジアン。正で左 = +x） */
function headYaw(bones: Map<string, THREE.Bone>): number {
    const chest = bones.get('Chest')!;
    const head = bones.get('Head')!;
    chest.updateWorldMatrix(true, false);
    head.updateWorldMatrix(true, false);
    const qc = chest.getWorldQuaternion(new THREE.Quaternion());
    const qh = head.getWorldQuaternion(new THREE.Quaternion());
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(qc.invert().multiply(qh));
    return Math.atan2(f.x, f.z);
}

describe('顔と目線（首・頭の骨）', () => {
    it('横の見る点へ、なめらかに（1 秒に 260° まで）顔を向け、外すと正面へ戻る', async () => {
        const rig = rigOf(await fresh());
        const bones = findBones(rig.root);
        const gaze = Gaze.from(bones)!;
        expect(gaze).not.toBeNull();
        rig.root.updateMatrixWorld(true);
        const head = bones.get('Head')!.getWorldPosition(new THREE.Vector3());
        // 左前（+x、+z）45° の点
        gaze.lookAt({ x: head.x + 2, y: head.y, z: head.z + 2 });
        rig.mixer.update(0);
        let prev = headYaw(bones);
        let maxStep = 0;
        for (let i = 0; i < 60; i++) {
            rig.mixer.update(DT);
            gaze.update(DT);
            const y = headYaw(bones);
            maxStep = Math.max(maxStep, Math.abs(y - prev));
            prev = y;
        }
        expect(prev).toBeGreaterThan(0.6);
        expect(prev).toBeLessThan(0.95);
        expect(maxStep).toBeLessThanOrEqual(((260 * Math.PI) / 180) * DT + 0.02);
        gaze.lookAt(null);
        for (let i = 0; i < 90; i++) {
            rig.mixer.update(DT);
            gaze.update(DT);
        }
        expect(Math.abs(headYaw(bones))).toBeLessThan(0.06);
    });

    it('真後ろの点は限度（左右 75°）までしか向かない（振り向きは体で）', async () => {
        const rig = rigOf(await fresh());
        const bones = findBones(rig.root);
        const gaze = Gaze.from(bones)!;
        rig.root.updateMatrixWorld(true);
        const head = bones.get('Head')!.getWorldPosition(new THREE.Vector3());
        gaze.lookAt({ x: head.x + 0.3, y: head.y, z: head.z - 3 });
        for (let i = 0; i < 120; i++) {
            rig.mixer.update(DT);
            gaze.update(DT);
        }
        expect(Math.abs(headYaw(bones))).toBeLessThan(GAZE_LIMIT.yaw + 0.08);
        expect(Math.abs(headYaw(bones))).toBeGreaterThan(GAZE_LIMIT.yaw - 0.2);
    });

    it('動きの元が首・頭を動かさない骨組みでも、向けた分が毎コマ重ならない', async () => {
        const scene = (await fresh()).scene;
        const bones = findBones(scene);
        const gaze = Gaze.from(bones)!;
        scene.updateMatrixWorld(true);
        const head = bones.get('Head')!.getWorldPosition(new THREE.Vector3());
        gaze.lookAt({ x: head.x + 2, y: head.y, z: head.z + 2 });
        for (let i = 0; i < 120; i++) gaze.update(DT);
        const a = headYaw(bones);
        for (let i = 0; i < 120; i++) gaze.update(DT);
        expect(headYaw(bones)).toBeCloseTo(a, 4);
        expect(a).toBeLessThan(0.95);
    });
});
