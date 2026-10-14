/**
 * 主人公の足運び（Version 28 §4.1）を、ゲームが実際に読む GLB（hero_v3b_mpfb.glb。町人は hero_v2b.glb）と、ゲームの見た目の動きの仕組み
 *（game/heroAnim.ts・legs.ts、移動は game/motion.ts）で確かめる。ブラウザなし、60 コマ/秒の決まった歩み。
 * Version 27 までのこのテストは、ゲームが使っていない作りの主人公（proto3d/src/assets/hero.ts。書き出し用に残る）を見ていた。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GAIT } from '../proto3d/src/game/gait';
import { SPEED } from '../proto3d/src/game/motion';
import { HOUSE } from '../proto3d/src/layout';
import { glbJson, loadGlb, maxYawStepDeg, plantedSpeeds, rigOf, simulate, type Row } from './proto3d-hero-rig';

const HERO = 'hero_v3b_mpfb';
const gltf = await loadGlb(HERO);
const N = -Math.SQRT1_2;

const q = (a: number[], p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))]! : 0);
const tagged = (rows: Row[], ...tags: string[]) => rows.filter((r) => tags.includes(r.tag));
/** 最後のコマ */
const lastOf = (rows: Row[]): Row => rows[rows.length - 1]!;

/** 動きの元（クリップ）だけを位相 ph で置いたときの、骨の世界の位置 */
function clipPose(name: 'Walk' | 'Run' | 'Idle', ph: number, bone: string): THREE.Vector3 {
    const scene = gltf.scene.clone(true);
    const mixer = new THREE.AnimationMixer(scene);
    const clip = THREE.AnimationClip.findByName(gltf.animations, name)!;
    mixer.clipAction(clip).play();
    mixer.setTime(ph * clip.duration);
    scene.updateMatrixWorld(true);
    let b: THREE.Object3D | undefined;
    scene.traverse((o) => {
        if (!b && (o as THREE.Bone).isBone && o.name === bone) b = o;
    });
    return b!.getWorldPosition(new THREE.Vector3());
}

describe('主人公の動きの元（GLB の Idle / Walk / Run）', () => {
    it('ゲームが読む主人公と町人の GLB は、決まり（game/gait.ts）と同じ周期・1 周期の距離・足の着く割合を持つ', () => {
        for (const name of [HERO, 'hero_v2b']) {
            const j = glbJson(name);
            const ex = j.extras as Record<string, number>;
            expect(ex.walk_stride_m).toBeCloseTo(GAIT.walk.stride, 3);
            expect(ex.run_stride_m).toBeCloseTo(GAIT.run.stride, 3);
            expect(ex.walk_duty).toBeCloseTo(GAIT.walk.duty, 6);
            expect(ex.run_duty).toBeCloseTo(GAIT.run.duty, 6);
            expect(j.animations.map((a) => a.name).sort()).toEqual(['Idle', 'Run', 'Walk']);
        }
        const dur = (n: string) => THREE.AnimationClip.findByName(gltf.animations, n)!.duration;
        expect(dur('Walk')).toBeCloseTo(GAIT.walk.cycle, 3);
        expect(dur('Run')).toBeCloseTo(GAIT.run.cycle, 3);
        // ゲームの速さで再生すると、動きの元の基準の速さと同じ（再生を速めたり遅めたりしない）
        expect(GAIT.walk.speed).toBe(SPEED.walk);
        expect(GAIT.run.speed).toBeCloseTo(SPEED.run, 6);
    });

    it('歩きの腰：両足が着いた所から反対の足が離れる直後（位相 0〜0.15）で低く、片足で立つ真ん中（0.2〜0.4）で高い（Version 27 は逆だった）。上下は 4.5 cm 以内', () => {
        const ys = Array.from({ length: 100 }, (_, i) => clipPose('Walk', i / 100, 'Hips').y);
        const lowAt = ys.indexOf(Math.min(...ys)) / 100;
        const highAt = ys.indexOf(Math.max(...ys)) / 100;
        expect(lowAt % 0.5).toBeLessThan(0.16);
        expect(highAt % 0.5).toBeGreaterThan(0.18);
        expect(highAt % 0.5).toBeLessThan(0.42);
        expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.045);
    });

    it('待機の腰の高さと歩きの腰の高さ（平均）の差は 2 cm 未満（Version 27 は 6〜8 cm。歩き出し・止まりで腰が沈む・浮く）', () => {
        const walk = Array.from({ length: 50 }, (_, i) => clipPose('Walk', i / 50, 'Hips').y);
        const idle = Array.from({ length: 20 }, (_, i) => clipPose('Idle', i / 20, 'Hips').y);
        const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
        expect(Math.abs(mean(idle) - mean(walk))).toBeLessThan(0.02);
        // 待機は固まらない（呼吸・重心の移り）が、大きく揺れない
        expect(Math.max(...idle) - Math.min(...idle)).toBeGreaterThan(0.001);
        expect(Math.max(...idle) - Math.min(...idle)).toBeLessThan(0.012);
    });

    it('走りの腰：片足で着いた真ん中で低く、上下は 3 cm 以内（控えめ）', () => {
        const ys = Array.from({ length: 64 }, (_, i) => clipPose('Run', i / 64, 'Hips').y);
        const lowAt = (ys.indexOf(Math.min(...ys)) / 64) % 0.5;
        expect(Math.abs(lowAt - GAIT.run.duty / 2)).toBeLessThan(0.06);
        expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.03);
    });
});

describe('主人公の足運び（ゲームの仕組みで 60 コマ/秒）', () => {
    const rig = rigOf(gltf);
    const sim = simulate(rig);
    const runs: Record<string, Row[]> = {};
    const scenario = (name: string, fn: () => void) => {
        const from = sim.rows.length;
        fn();
        runs[name] = sim.rows.slice(from);
    };
    scenario('walk', () => {
        sim.place(0.5, 8, Math.PI);
        sim.hold('idle', 1.2, 0, 0);
        sim.hold('start', 0.6, 0, -1);
        sim.hold('steady', 1.4, 0, -1);
        sim.hold('stop', 1.5, 0, 0);
    });
    scenario('run', () => {
        sim.place(0.5, 9, Math.PI);
        sim.hold('idle', 0.6, 0, 0);
        sim.hold('start', 0.8, 0, -1, true);
        sim.hold('steady', 1.4, 0, -1, true);
        sim.hold('stop', 1.5, 0, 0);
    });
    scenario('turn90', () => {
        sim.place(-0.5, 8, Math.PI);
        sim.hold('idle', 0.4, 0, 0);
        sim.hold('pre', 1.5, 0, -1);
        sim.hold('turn', 1.0, 1, 0);
        sim.hold('stop', 1.2, 0, 0);
    });
    scenario('turn180', () => {
        sim.place(0.5, 8, Math.PI);
        sim.hold('idle', 0.4, 0, 0);
        sim.hold('pre', 1.5, 0, -1);
        sim.hold('turn', 1.2, 0, 1);
        sim.hold('stop', 1.2, 0, 0);
    });
    scenario('turn180run', () => {
        sim.place(0.5, 9, Math.PI);
        sim.hold('idle', 0.4, 0, 0);
        sim.hold('pre', 1.4, 0, -1, true);
        sim.hold('turn', 1.2, 0, 1, true);
        sim.hold('stop', 1.2, 0, 0);
    });
    scenario('turn180idle', () => {
        sim.place(0.5, 4, Math.PI);
        sim.hold('idle', 1.0, 0, 0);
        sim.hold('turn', 1.2, 0, 1);
        sim.hold('stop', 1.2, 0, 0);
    });
    scenario('walkrunwalk', () => {
        sim.place(0.5, 10, Math.PI);
        sim.hold('idle', 0.5, 0, 0);
        sim.hold('walk', 1.5, 0, -1);
        sim.hold('torun', 1.5, 0, -1, true);
        sim.hold('towalk', 1.5, 0, -1);
        sim.hold('stop', 1.2, 0, 0);
    });
    scenario('wallslide', () => {
        sim.place(HOUSE.x1 + 0.6, (HOUSE.z0 + HOUSE.z1) / 2 + 1.5, -Math.PI / 2);
        sim.hold('idle', 0.5, 0, 0);
        sim.hold('slide', 2.0, N, N);
        sim.hold('stop', 1.2, 0, 0);
    });
    scenario('faceturn', () => {
        sim.place(0.5, 6, Math.PI);
        sim.hold('idle', 0.8, 0, 0);
        const h = sim.hero;
        h.heading = Math.atan2(Math.sin(h.heading + 2.1), Math.cos(h.heading + 2.1));
        h.dirX = Math.sin(h.heading);
        h.dirZ = Math.cos(h.heading);
        sim.hold('turn', 1.5, 0, 0);
    });

    it('測った値（確認用）', () => {
        const out: Record<string, unknown> = {};
        for (const [k, rows] of Object.entries(runs)) {
            const s = plantedSpeeds(rows);
            out[k] = { planted: s.length, max: +q(s, 1).toFixed(3), p95: +q(s, 0.95).toFixed(3), rotDeg: +maxYawStepDeg(rows).toFixed(2), hip: [+Math.min(...rows.map((r) => r.hipY)).toFixed(3), +Math.max(...rows.map((r) => r.hipY)).toFixed(3)] };
        }
        console.log(JSON.stringify(out));
    });

    it('着いた足は地面の上を滑らない：歩き・走りの歩き出し・歩き続け・止まり、90°・180° の向き替え、歩き ↔ 走り、壁に沿って滑る間で、着いた足の速さは 0.3 m/秒以下（95% は 0.1 m/秒以下）', () => {
        for (const [k, rows] of Object.entries(runs)) {
            const s = plantedSpeeds(rows);
            expect(s.length, k).toBeGreaterThan(50);
            expect(q(s, 1), k).toBeLessThan(0.3);
            expect(q(s, 0.95), k).toBeLessThan(0.1);
        }
    });

    it('体の向きは 1 コマ（60 コマ/秒）で 12° を超えて回らない（会話・演出が向きを一度に 120° 変えても）', () => {
        for (const [k, rows] of Object.entries(runs)) expect(maxYawStepDeg(rows), k).toBeLessThanOrEqual(12);
        // その場で向きを変えるときは足を踏み替える（向きの変化に合わせて、どちらかの足が地面から上がる）
        const turn = tagged(runs.faceturn!, 'turn');
        const lifted = turn.some((r) => r.feet.some((f) => Math.min(f.heel[2], f.ball[2], f.tip[2]) > 0.02));
        expect(lifted).toBe(true);
        const yaw0 = lastOf(tagged(runs.faceturn!, 'idle')).yaw;
        const yaw1 = turn[turn.length - 1]!.yaw;
        expect(Math.abs(Math.atan2(Math.sin(yaw1 - yaw0), Math.cos(yaw1 - yaw0)))).toBeGreaterThan(2.0);
    });

    it('大きな切り返し（180°）では足を踏み替える：向きを変える間に両足とも一度は地面から上がる', () => {
        for (const k of ['turn180', 'turn180idle', 'turn180run']) {
            const turn = tagged(runs[k]!, 'turn').slice(0, 36);
            for (const f of [0, 1]) expect(turn.some((r) => Math.min(r.feet[f]!.heel[2], r.feet[f]!.ball[2], r.feet[f]!.tip[2]) > 0.02), `${k} 足 ${f}`).toBe(true);
        }
    });

    it('止まった後は、両足が体の下にそろう（踏み替え）。止まった足が途中の形で固まって滑ることはない', () => {
        for (const k of ['walk', 'run', 'turn90', 'turn180', 'wallslide']) {
            const last = lastOf(runs[k]!);
            const mid = last.feet.map((f) => [(f.heel[0] + f.tip[0]) / 2, (f.heel[1] + f.tip[1]) / 2] as const);
            const fwd = [Math.sin(last.yaw), Math.cos(last.yaw)] as const;
            const along = mid.map(([x, z]) => (x - last.x) * fwd[0] + (z - last.z) * fwd[1]);
            // 前後のずれは 20 cm 以内、どちらの足も体の中心から 30 cm 以内
            expect(Math.abs(along[0]! - along[1]!), k).toBeLessThan(0.2);
            for (const [x, z] of mid) expect(Math.hypot(x - last.x, z - last.z), k).toBeLessThan(0.3);
        }
    });

    it('歩き出し・止まりで腰が急に沈まない・浮かない（1 コマの腰の上下は 1.2 cm 未満（0.7 m/秒）、歩き出しの 0.6 秒の腰の下がりは 5 cm 未満）', () => {
        for (const [k, rows] of Object.entries(runs)) {
            for (let i = 1; i < rows.length; i++) expect(Math.abs(rows[i]!.hipY - rows[i - 1]!.hipY), `${k} ${i}`).toBeLessThan(0.012);
        }
        const w = runs.walk!;
        const idleHip = lastOf(tagged(w, 'idle')).hipY;
        expect(idleHip - Math.min(...tagged(w, 'start').map((r) => r.hipY))).toBeLessThan(0.05);
    });

    it('壁に沿って滑る間は、体は進む向きを向き、脚の位相は実際に進んだ距離で進む', () => {
        const rows = tagged(runs.wallslide!, 'slide').slice(30);
        const a = rows[0]!;
        const b = rows[rows.length - 1]!;
        const dir = Math.atan2(b.x - a.x, b.z - a.z);
        expect(Math.abs(Math.atan2(Math.sin(b.yaw - dir), Math.cos(b.yaw - dir)))).toBeLessThan(0.2);
        // 実際の速さは歩きの上限より遅い（壁に押し付けた分は進まない）。脚の動きの重みはその速さから
        const v = Math.hypot(b.x - a.x, b.z - a.z) / (b.t - a.t);
        expect(v).toBeLessThan(SPEED.walk * 0.9);
        expect(v).toBeGreaterThan(0.5);
    });
});
