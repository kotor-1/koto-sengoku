/**
 * 3D 比較版：自作の主人公モデル 第 2 版（proto3d/public/models/hero_v2.glb。第 1 版と同じ骨組み・動き）を、ブラウザなしで骨組みから確かめる。
 * - 動き Idle / Walk / Run と 20 ジョイントがある。+Z が正面、身長約 1.76m
 * - ゲームが使う「1 周期で進む距離」（main.ts：Walk 1.4m/秒・Run 3.0m/秒 × 周期）が、接地した足の送りの速さと合う（足が滑らない）
 * - Walk と Run で左右の足の順番（位相）がそろう（速さで混ぜても脚が乱れない）
 * - 足の裏が地面の高さにある（浮かない・めり込まない）
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

interface Gltf {
    nodes: { name: string; translation?: number[]; rotation?: number[]; scale?: number[]; children?: number[] }[];
    scenes: { nodes: number[] }[];
    skins: { joints: number[]; inverseBindMatrices: number }[];
    meshes: { primitives: { attributes: Record<string, number> }[] }[];
    accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
    animations: { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number }[] }[];
}

// テストは Node で動く。Node の型定義は入れていないので、ファイルの読み込みだけ型なしで使う
const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { readFileSync: (p: URL) => Uint8Array };
const glb = new Uint8Array(fs.readFileSync(new URL('../proto3d/public/models/hero_v2.glb', import.meta.url)));
const jsonLen = new DataView(glb.buffer).getUint32(12, true);
const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen))) as Gltf;
const bin = glb.subarray(20 + jsonLen + 8);

function accessor(i: number): ArrayLike<number> {
    const a = gltf.accessors[i];
    const v = gltf.bufferViews[a.bufferView];
    const comps = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[a.type];
    const T = ({ 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array } as const)[a.componentType as 5126]!;
    if (v.byteStride && v.byteStride !== comps * T.BYTES_PER_ELEMENT) throw new Error('間隔つきの配列は扱わない');
    const off = bin.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return new T(bin.buffer.slice(off, off + a.count * comps * T.BYTES_PER_ELEMENT));
}

// 骨組み（形は作らない）
const objs = gltf.nodes.map((n) => {
    const o = new THREE.Object3D();
    o.name = n.name;
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
});
gltf.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => objs[i].add(objs[c])));
const root = objs[gltf.scenes[0].nodes[0]];
const bone = (name: string) => objs.find((o) => o.name === name)!;

// 足の骨にほぼ全部の重みが付いた頂点（足袋・草履）を、その骨から見た位置で持つ
const skin = gltf.skins[0];
const ibm = accessor(skin.inverseBindMatrices);
const soles: Record<'LeftFoot' | 'RightFoot', THREE.Vector3[]> = { LeftFoot: [], RightFoot: [] };
for (const p of gltf.meshes[0].primitives) {
    const P = accessor(p.attributes.POSITION);
    const J = accessor(p.attributes.JOINTS_0);
    const W = accessor(p.attributes.WEIGHTS_0);
    for (let v = 0; v < P.length / 3; v++) {
        for (let k = 0; k < 4; k++) {
            const j = J[v * 4 + k];
            const name = gltf.nodes[skin.joints[j]].name as 'LeftFoot' | 'RightFoot';
            if ((name === 'LeftFoot' || name === 'RightFoot') && W[v * 4 + k] > 0.95) {
                soles[name].push(new THREE.Vector3(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]).applyMatrix4(new THREE.Matrix4().fromArray(Array.from(ibm), j * 16)));
            }
        }
    }
}

const clips = gltf.animations.map((a) => new THREE.AnimationClip(a.name, -1, a.channels.map((c) => {
    const s = a.samplers[c.sampler];
    const node = gltf.nodes[c.target.node].name;
    const t = Array.from(accessor(s.input));
    const v = Array.from(accessor(s.output));
    return c.target.path === 'rotation' ? new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, t, v) : new THREE.VectorKeyframeTrack(`${node}.${c.target.path === 'translation' ? 'position' : 'scale'}`, t, v);
})));
const clip = (name: string) => clips.find((c) => c.name === name)!;

/** 1 周期を N コマで見て、足の裏の一番低い所（高さと前後）を返す */
function feet(c: THREE.AnimationClip, N = 120): { low: number; z: number }[][] {
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(c).play();
    const out: { low: number; z: number }[][] = [];
    for (let f = 0; f <= N; f++) {
        mixer.setTime((f / N) * c.duration);
        root.updateMatrixWorld(true);
        out.push((['LeftFoot', 'RightFoot'] as const).map((k) => {
            const m = bone(k).matrixWorld;
            let low = Infinity;
            let z = 0;
            for (const p of soles[k]) {
                const w = p.clone().applyMatrix4(m);
                if (w.y < low) {
                    low = w.y;
                    z = w.z;
                }
            }
            return { low, z };
        }));
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    return out;
}

/** 接地した足（地面から 1.5cm 以内）が後ろへ送られる速さの中央値と、左足が着く位相 */
function gait(name: string): { speed: number; leftLand: number; ground: number } {
    const c = clip(name);
    const N = 120;
    const rows = feet(c, N);
    const ground = Math.min(...rows.flat().map((r) => r.low));
    const dt = c.duration / N;
    const v: number[] = [];
    for (let f = 0; f < N; f++) {
        for (const k of [0, 1]) {
            if (rows[f][k].low - ground < 0.015 && rows[f + 1][k].low - ground < 0.015) v.push(-(rows[f + 1][k].z - rows[f][k].z) / dt);
        }
    }
    v.sort((a, b) => a - b);
    const land = rows.findIndex((r, i) => r[0].low - ground < 0.015 && rows[(i - 1 + N) % N][0].low - ground >= 0.015);
    return { speed: v[Math.floor(v.length / 2)], leftLand: land / N, ground };
}

describe('3D 比較版：自作の主人公モデル 第 2 版', () => {
    it('動き Idle / Walk / Run と 20 ジョイント', () => {
        expect(clips.map((c) => c.name).sort()).toEqual(['Idle', 'Run', 'Walk']);
        expect(skin.joints.length).toBe(20);
        expect(soles.LeftFoot.length).toBeGreaterThan(100);
    });

    it('大きさと向き：身長は約 1.76m、つま先は +Z（正面）を向く', () => {
        root.updateMatrixWorld(true);
        const box = new THREE.Box3();
        for (const k of ['LeftFoot', 'RightFoot'] as const) for (const p of soles[k]) box.expandByPoint(p.clone().applyMatrix4(bone(k).matrixWorld));
        expect(bone('Head').getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(1.4);
        expect(bone('Head').getWorldPosition(new THREE.Vector3()).y).toBeLessThan(1.8);
        // 足の裏の前後の広がりのうち、前（+Z）の方が長い＝つま先が前
        const ankle = bone('LeftFoot').getWorldPosition(new THREE.Vector3()).z;
        expect(box.max.z - ankle).toBeGreaterThan(ankle - box.min.z);
    });

    it('ゲームの 1 周期の距離（Walk 1.4m/秒・Run 3.0m/秒 × 周期）が、接地した足の送りの速さと 5% 以内で合う', () => {
        const walk = gait('Walk');
        const run = gait('Run');
        expect(Math.abs(walk.speed - 1.4) / 1.4).toBeLessThan(0.05);
        expect(Math.abs(run.speed - 3.0) / 3.0).toBeLessThan(0.05);
    });

    it('Walk と Run で、左足が着く位相がそろう（速さで混ぜても脚が乱れない）', () => {
        const d = Math.abs(gait('Walk').leftLand - gait('Run').leftLand);
        expect(Math.min(d, 1 - d)).toBeLessThan(0.05);
    });

    it('足の裏は地面の高さにある（どの動きでも一番低い所が 0〜2cm）', () => {
        for (const name of ['Idle', 'Walk', 'Run']) {
            const g = gait(name).ground;
            expect(g).toBeGreaterThan(-0.005);
            expect(g).toBeLessThan(0.02);
        }
    });
});
