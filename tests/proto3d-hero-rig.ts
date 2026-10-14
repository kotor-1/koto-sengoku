/**
 * テスト用：ゲームが読む人物の GLB（proto3d/public/models/）を、ブラウザなしで three の形・骨・動きとして読み、
 * 主人公の見た目の動き（game/heroAnim.ts：動きの元の混ぜ方・位相・着いた足を地面に止める・IK・踏み替え）を 60 コマ/秒で動かして測る。
 * 画像だけは外して読む（Node では画像を開けない。形・骨・動きのデータはゲームと同じ）。
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HeroAnimator, type HeroRig } from '../proto3d/src/game/heroAnim';
import { SOLE } from '../proto3d/src/game/legs';
import { createHero, stepHero, type HeroState } from '../proto3d/src/game/motion';
import { colliders, groundY } from '../proto3d/src/layout';

// テストは Node で動く。Node の型定義は入れていないので、ファイルの読み込みだけ型なしで使う
const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { readFileSync: (p: URL) => Uint8Array };

/** GLB の JSON の部分（extras などを見る） */
export function glbJson(name: string): Record<string, unknown> & { extras?: Record<string, unknown>; animations: { name: string }[] } {
    const b = new Uint8Array(fs.readFileSync(new URL(`../proto3d/public/models/${name}.glb`, import.meta.url)));
    const len = new DataView(b.buffer, b.byteOffset).getUint32(12, true);
    return JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + len)));
}

/** GLB を three で読む（画像・画像を使う材質の指定は外す） */
export async function loadGlb(name: string): Promise<GLTF> {
    const b = new Uint8Array(fs.readFileSync(new URL(`../proto3d/public/models/${name}.glb`, import.meta.url)));
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + jsonLen)));
    delete json.images;
    delete json.textures;
    for (const m of json.materials ?? []) {
        if (m.pbrMetallicRoughness) {
            delete m.pbrMetallicRoughness.baseColorTexture;
            delete m.pbrMetallicRoughness.metallicRoughnessTexture;
        }
        delete m.normalTexture;
        delete m.occlusionTexture;
        delete m.emissiveTexture;
    }
    const binStart = 20 + jsonLen;
    const binLen = dv.getUint32(binStart, true);
    const bin = b.subarray(binStart + 8, binStart + 8 + binLen);
    const text = new TextEncoder().encode(JSON.stringify(json));
    const jl = Math.ceil(text.length / 4) * 4;
    const bl = Math.ceil(bin.length / 4) * 4;
    const out = new Uint8Array(28 + jl + bl);
    const o = new DataView(out.buffer);
    o.setUint32(0, 0x46546c67, true);
    o.setUint32(4, 2, true);
    o.setUint32(8, out.length, true);
    o.setUint32(12, jl, true);
    o.setUint32(16, 0x4e4f534a, true);
    out.fill(0x20, 20, 20 + jl);
    out.set(text, 20);
    o.setUint32(20 + jl, bl, true);
    o.setUint32(24 + jl, 0x004e4942, true);
    out.set(bin, 28 + jl);
    return new GLTFLoader().parseAsync(out.buffer, '');
}

/** main.ts の loadHeroView と同じ組み方（待機・歩き・走りを再生し、歩き・走りは位相で置く） */
export function rigOf(gltf: GLTF): HeroRig {
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const clip = (n: string) => {
        const c = THREE.AnimationClip.findByName(gltf.animations, n);
        if (!c) throw new Error(`動き ${n} が無い`);
        return c;
    };
    const idle = mixer.clipAction(clip('Idle'));
    const walk = mixer.clipAction(clip('Walk'));
    const run = mixer.clipAction(clip('Run'));
    idle.play();
    for (const a of [walk, run]) {
        a.play();
        a.timeScale = 0;
        a.setEffectiveWeight(0);
    }
    return { root: gltf.scene, mixer, idle, walk, run };
}

/** 1 コマの記録 */
export interface Row {
    tag: string;
    t: number;
    x: number;
    z: number;
    speed: number;
    yaw: number;
    hipY: number;
    /** 足ごとの足の裏の点：[x, z, 地面からの高さ]（かかと・母指球・足先） */
    feet: { heel: [number, number, number]; ball: [number, number, number]; tip: [number, number, number] }[];
}

export interface Sim {
    hero: HeroState;
    anim: HeroAnimator;
    rows: Row[];
    t: number;
    /** 入力（画面の右・下）を sec 秒。run で走る */
    hold(tag: string, sec: number, ix: number, iy: number, run?: boolean): void;
    /** 主人公を置き直す */
    place(x: number, z: number, heading: number): void;
}

export const DT = 1 / 60;

/** 主人公を動かす（カメラの yaw は 0：画面の上 = 北） */
export function simulate(rig: HeroRig): Sim {
    const hero = createHero(0.5, 8, Math.PI);
    const anim = new HeroAnimator(rig);
    const bones = new Map<string, THREE.Object3D>();
    rig.root.traverse((o) => {
        if ((o as THREE.Bone).isBone && !bones.has(o.name)) bones.set(o.name, o);
    });
    const hips = bones.get('Hips')!;
    const footBones = [bones.get('LeftFoot')!, bones.get('RightFoot')!];
    const sim: Sim = {
        hero,
        anim,
        rows: [],
        t: 0,
        place(x, z, heading) {
            Object.assign(hero, { x, z, heading, speed: 0, dirX: Math.sin(heading), dirZ: Math.cos(heading) });
            anim.snap(hero);
            anim.update(hero, 0, groundY);
        },
        hold(tag, sec, ix, iy, run = false) {
            const n = Math.round(sec / DT);
            for (let i = 0; i < n; i++) {
                stepHero(hero, ix, iy, 0, DT, run);
                anim.update(hero, DT, groundY);
                sim.t += DT;
                rig.root.updateMatrixWorld(true);
                const hp = hips.getWorldPosition(new THREE.Vector3());
                const pt = (m: THREE.Matrix4, p: THREE.Vector3): [number, number, number] => {
                    const w = p.clone().applyMatrix4(m);
                    return [w.x, w.z, w.y - groundY(w.x, w.z)];
                };
                sim.rows.push({
                    tag,
                    t: sim.t,
                    x: hero.x,
                    z: hero.z,
                    speed: hero.speed,
                    yaw: rig.root.rotation.y,
                    hipY: hp.y - groundY(hp.x, hp.z),
                    feet: footBones.map((f) => ({ heel: pt(f.matrixWorld, SOLE.heel), ball: pt(f.matrixWorld, SOLE.ball), tip: pt(f.matrixWorld, SOLE.tip) })),
                });
            }
        },
    };
    return sim;
}

const SOLE_KEYS = ['heel', 'ball', 'tip'] as const;
const lowestKey = (f: Row['feet'][number]) => SOLE_KEYS.reduce((m, c) => (f[c][2] < f[m][2] ? c : m), 'heel' as (typeof SOLE_KEYS)[number]);

/**
 * 着いた足の速さ（m/秒）：足の裏の 3 点（踵・母指球・足先）のうち低い点が前後 2 コマで同じ点で、その点が 2 コマとも地面から maxH 以内、
 * 上下の速さが 0.15 m/秒 未満のときの、その点の水平の速さ。地面に着く点が移る（踵 → 足裏 → 足先へ転がる）コマは数えない（意図した転がり）。
 * 返り：速さの一覧（小さい順）
 */
export function plantedSpeeds(rows: Row[], maxH = 0.01): number[] {
    const out: number[] = [];
    for (let i = 1; i < rows.length; i++) {
        for (const k of [0, 1]) {
            const b = rows[i]!.feet[k]!;
            const a = rows[i - 1]!.feet[k]!;
            const key = lowestKey(b);
            if (lowestKey(a) !== key) continue;
            const pa = a[key];
            const pb = b[key];
            if (pa[2] > maxH || pb[2] > maxH || Math.abs(pb[2] - pa[2]) / DT > 0.15) continue;
            out.push(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / DT);
        }
    }
    return out.sort((x, y) => x - y);
}

/** 描いた体の向きの、1 コマの変化の最大（度） */
export function maxYawStepDeg(rows: Row[]): number {
    let m = 0;
    for (let i = 1; i < rows.length; i++) m = Math.max(m, Math.abs(Math.atan2(Math.sin(rows[i]!.yaw - rows[i - 1]!.yaw), Math.cos(rows[i]!.yaw - rows[i - 1]!.yaw))));
    return (m * 180) / Math.PI;
}

/**
 * 壁に沿って滑る確かめの始めの位置：東を向いた長さ 3 m 以上の壁（当たり判定の箱の東の辺）で、その東 1 m の帯に別の箱が無い所。
 * その辺の南の端の 0.6 m 東に立つ。北西を押し続けると、壁に沿って北へ滑る（町の配置が変わっても、店先の小物に引っかからない壁を選ぶ）
 */
export function wallSlideStart(): { x: number; z: number; wall: { x1: number; z0: number; z1: number } } {
    const cs = colliders();
    const r = cs.find((r) => r.z1 - r.z0 >= 3 && !cs.some((o) => o !== r && o.x0 < r.x1 + 1 && o.x1 > r.x1 && o.z0 < r.z1 && o.z1 > r.z0));
    if (!r) throw new Error('壁に沿って滑る確かめに使える壁が無い');
    return { x: r.x1 + 0.6, z: r.z1 - 0.3, wall: { x1: r.x1, z0: r.z0, z1: r.z1 } };
}

