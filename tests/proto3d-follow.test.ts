import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FOLLOW, blockersForTest, createOrbit, look, placeFollow } from '../proto3d/src/game/follow';
import { createHero, isFree, screenToGround, stepHero } from '../proto3d/src/game/motion';
import { GATE, HOUSE, START, WALL, cameraBlockers } from '../proto3d/src/layout';

const raw = cameraBlockers().map((b) => new THREE.Box3(new THREE.Vector3(b.x0, b.y0, b.z0), new THREE.Vector3(b.x1, b.y1, b.z1)));

/** 何度か動かして、カメラの距離を落ち着かせる */
function settle(o: ReturnType<typeof createOrbit>, x: number, z: number) {
    let pose = placeFollow(o, x, z, 1);
    for (let i = 0; i < 20; i++) pose = placeFollow(o, x, z, 1);
    return pose;
}

describe('3D 比較版：肩越しのカメラ', () => {
    it('初めは主人公の後ろ（南）から、城門の方（北）を見る。少し見下ろし、肩の上から', () => {
        const o = createOrbit(0);
        const pose = settle(o, START.x, START.z);
        expect(pose.position.z).toBeGreaterThan(START.z + FOLLOW.distance * 0.9);
        expect(pose.target.z).toBeLessThan(START.z - 5);
        expect(pose.position.y).toBeGreaterThan(FOLLOW.height);
        expect(pose.position.y).toBeLessThan(FOLLOW.height + 1.2);
        // 肩越し：見る中心は主人公の右（東）へずれる
        expect(pose.pivot.x).toBeGreaterThan(START.x + 0.3);
        expect(o.dist).toBeCloseTo(FOLLOW.distance, 3);
    });

    it('右へドラッグで右を向き、上へドラッグで上を向く。上下は決まった範囲で止まる', () => {
        const o = createOrbit(0);
        look(o, 100, 0);
        const d = screenToGround(0, -1, o.yaw); // 画面の上＝カメラの前
        expect(d.x).toBeGreaterThan(0.3); // 右（東）寄りを向いた
        const p0 = o.pitch;
        look(o, 0, -50);
        expect(o.pitch).toBeLessThan(p0);
        look(o, 0, -100000);
        expect(o.pitch).toBe(FOLLOW.pitchMin);
        look(o, 0, 100000);
        expect(o.pitch).toBe(FOLLOW.pitchMax);
    });

    it('移動はカメラの向きに合わせる：上を押すとカメラの前、右を押すとカメラの右へ進む', () => {
        const o = createOrbit(0);
        look(o, -300, 0); // 左を向く
        const h = createHero(0.8, 5, Math.PI);
        for (let i = 0; i < 60; i++) stepHero(h, 0, -1, o.yaw, 1 / 60);
        const fwd = { x: -Math.sin(o.yaw), z: -Math.cos(o.yaw) };
        const moved = { x: h.x - 0.8, z: h.z - 5 };
        const len = Math.hypot(moved.x, moved.z);
        expect((moved.x * fwd.x + moved.z * fwd.z) / len).toBeGreaterThan(0.99);
    });

    it('どこに立ってどちらを向いても、カメラは壁・屋根・庇・柱の中に入らない（町家の並び・城門・土塀のまわり）', () => {
        let checked = 0;
        let shortened = 0;
        for (let x = -8; x <= 8; x += 0.8) {
            for (let z = -16; z <= 14; z += 0.8) {
                if (!isFree(x, z)) continue;
                for (let k = 0; k < 12; k++) {
                    for (const pitch of [FOLLOW.pitchMin, 0.1, 0.5, FOLLOW.pitchMax]) {
                        const o = createOrbit((k / 12) * Math.PI * 2, pitch);
                        const pose = settle(o, x, z);
                        checked++;
                        if (o.dist < FOLLOW.distance - 0.01) shortened++;
                        expect(pose.position.y).toBeGreaterThanOrEqual(FOLLOW.minHeight - 1e-6);
                        for (const b of raw) {
                            if (b.containsPoint(pose.position)) throw new Error(`カメラが箱の中：主人公 (${x.toFixed(1)}, ${z.toFixed(1)}) 向き ${k} 上下 ${pitch} → ${pose.position.toArray().map((v) => v.toFixed(2))}`);
                        }
                    }
                }
            }
        }
        // 町家の間では、壁に当たって縮む場面が実際にある（調べた範囲が意味を持っている）
        expect(checked).toBeGreaterThan(5000);
        expect(shortened).toBeGreaterThan(checked * 0.05);
    });

    it('土塀のすぐ内側に立ち、カメラが塀の向こう側に回っても、カメラは塀を越えず主人公の側に残る', () => {
        const o = createOrbit(0, 0.1); // 北を見る＝カメラは南（塀の外側）へ行こうとする
        const z = GATE.z - WALL.thick / 2 - 0.3;
        const pose = settle(o, -8, z);
        expect(pose.position.z).toBeLessThan(GATE.z - WALL.thick / 2);
        expect(o.dist).toBeLessThan(FOLLOW.hideHeroDistance);
    });

    it('町家の壁を背にすると、カメラはすぐに近づき（突き抜けない）、離れると元の距離へなめらかに戻る', () => {
        const o = createOrbit(-Math.PI / 2); // 東を見る＝カメラは西（町家の側）
        const x = HOUSE.x1 + 0.25 + 0.3;
        const z = (HOUSE.z0 + HOUSE.z1) / 2;
        placeFollow(o, x, z, 1 / 60);
        expect(o.dist).toBeLessThan(0.9); // 1 コマで近づく
        // 道の中ほどへ離れると、少しずつ戻る
        const d1 = (placeFollow(o, 0, z, 1 / 60), o.dist);
        expect(d1).toBeLessThan(FOLLOW.distance - 0.5);
        for (let i = 0; i < 120; i++) placeFollow(o, 0, z, 1 / 60);
        expect(o.dist).toBeGreaterThan(FOLLOW.distance - 0.05);
    });

    it('テスト用の箱は、カメラの大きさの分だけ広げてある', () => {
        const b = blockersForTest([{ x0: 0, x1: 1, z0: 0, z1: 1, y0: 0, y1: 1 }])[0];
        expect(b.min.x).toBeCloseTo(-FOLLOW.radius, 6);
        expect(b.max.y).toBeCloseTo(1 + FOLLOW.radius, 6);
    });
});
