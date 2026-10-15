/**
 * 町の人物（hero_v2b.glb：忠勝・使者・町の人）の腕（Version 28 の直し）。第 2 版の形は腕を開いた休みの形（上腕は真下から 19°・前腕 7.5° 外へ）で、
 * 待機・話す間も腕を体から離して張って見えた。動きの元に、上腕を下ろして少し前へ・肘を曲げる形を足した（assets-src/hero_v2/hero_motion.py の
 * NPC_ARMS・write_clips.py の --npc-arms）。第 2 版の袴は手の高さで広く、腰の左に刀があるので、手が袴・刀に入らないように前腕を外へ戻す。
 * ゲームと同じ描き方（explore/actors.ts の ActorLayer：動きの元・足の IK・上体の動き・会釈）で、ゲームが読む GLB を動かし、形の点で確かめる：
 * - 肘（前腕の骨の根）が体の軸へ寄る（待機・歩き：直す前は 29.6〜30.2 cm）。
 * - 手と袖口の点が、袴・胴（腕の骨に付かない小袖・袴・袴の縫い目）の外側の殻の中に入らない（待機・歩き・走り・品物を整える・会釈）。
 * - 手は刀（帯と鞘・鍔）から 1 cm より近づかない。
 * 形・重み・画像のデータは元の hero_v2.glb と同じバイト列（write_clips.py の --check。ここでは頂点の数と範囲が同じことを見る）。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ActorLayer } from '../proto3d/src/explore/actors';
import { PersonFactory } from '../proto3d/src/explore/people';
import { NO_ACT, type PersonAct } from '../proto3d/src/explore/rhythm';
import type { StagePerson } from '../proto3d/src/explore/stage';
import { glbJson, loadGlb } from './proto3d-hero-rig';

const NPC = await loadGlb('hero_v2b');
const ORIG = await loadGlb('hero_v2');

/** 形の部分（材質の名前 → 役） */
const PART: Record<string, 'hakama' | 'kosode' | 'seamGrey' | 'skin' | 'cuff' | 'sword'> = {
    'Pleated charcoal hakama': 'hakama',
    'Indigo woven kosode': 'kosode',
    'Seam grey': 'seamGrey',
    Skin: 'skin',
    'Seam blue': 'cuff',
    'Obi and scabbard': 'sword',
    'Patinated bronze': 'sword',
};
const ARM_BONES = new Set(['LeftUpperArm', 'RightUpperArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand']);
const HAND_BONES = new Set(['LeftHand', 'RightHand']);
/** 素材の形（複製は形を共有する）→ 部分の名前 */
const partOf = new Map<THREE.BufferGeometry, string>();
NPC.scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) partOf.set(m.geometry, PART[(m.material as THREE.Material).name] ?? 'other');
});

interface Sets {
    body: THREE.Vector3[];
    hands: THREE.Vector3[];
    cuffs: THREE.Vector3[];
    sword: THREE.Vector3[];
    axis: { x: number; z: number };
    elbow: number;
}

/** 描いた人の形の点（世界）を役ごとに：体（腕の骨に付かない小袖・袴・袴の縫い目）・手・袖口・刀 */
function pointsOf(root: THREE.Object3D, bones: Map<string, THREE.Bone>): Sets {
    root.updateMatrixWorld(true);
    const out: Sets = { body: [], hands: [], cuffs: [], sword: [], axis: { x: 0, z: 0 }, elbow: 0 };
    const v = new THREE.Vector3();
    root.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isSkinnedMesh) return;
        const part = partOf.get(m.geometry);
        if (!part || part === 'other') return;
        const pos = m.geometry.getAttribute('position');
        const si = m.geometry.getAttribute('skinIndex');
        const sw = m.geometry.getAttribute('skinWeight');
        m.skeleton.update();
        for (let i = 0; i < pos.count; i++) {
            let best = 0;
            for (let k = 1; k < 4; k++) if (sw.getComponent(i, k) > sw.getComponent(i, best)) best = k;
            const bone = m.skeleton.bones[si.getComponent(i, best)]!.name;
            const arm = ARM_BONES.has(bone);
            let into: THREE.Vector3[] | null = null;
            if (part === 'hakama' || part === 'seamGrey' || (part === 'kosode' && !arm)) into = out.body;
            else if (part === 'skin' && HAND_BONES.has(bone)) into = out.hands;
            else if (part === 'cuff' && arm) into = out.cuffs;
            else if (part === 'sword') into = out.sword;
            if (!into) continue;
            v.fromBufferAttribute(pos, i);
            m.applyBoneTransform(i, v);
            into.push(v.clone().applyMatrix4(m.matrixWorld));
        }
    });
    const hips = bones.get('Hips')!.getWorldPosition(new THREE.Vector3());
    out.axis = { x: hips.x, z: hips.z };
    const el = ['LeftForeArm', 'RightForeArm'].map((n) => bones.get(n)!.getWorldPosition(new THREE.Vector3()));
    out.elbow = el.reduce((s, p) => s + Math.hypot(p.x - hips.x, p.z - hips.z), 0) / el.length;
    return out;
}

/**
 * 体の軸（腰の x・z を通る縦の線）から見た向き（5°）・高さ（2 cm）の升ごとに、体の点のいちばん外の距離（隣の升も含む）を殻とし、
 * その殻より 4 mm 以上内にある点の数と、いちばん深い所（m）
 */
function inside(pts: THREE.Vector3[], body: THREE.Vector3[], axis: { x: number; z: number }): { n: number; deep: number } {
    const YB = 0.02;
    const TB = (5 * Math.PI) / 180;
    const NT = Math.round((2 * Math.PI) / TB);
    const key = (p: THREE.Vector3) => {
        const dx = p.x - axis.x;
        const dz = p.z - axis.z;
        return { r: Math.hypot(dx, dz), ky: Math.floor(p.y / YB), kt: Math.floor((Math.atan2(dx, dz) + Math.PI) / TB) % NT };
    };
    const hull = new Map<string, number>();
    for (const p of body) {
        const k = key(p);
        for (const d of [-1, 0, 1]) {
            const id = `${k.ky}:${(k.kt + d + NT) % NT}`;
            if (k.r > (hull.get(id) ?? 0)) hull.set(id, k.r);
        }
    }
    let n = 0;
    let deep = 0;
    for (const p of pts) {
        const k = key(p);
        const h = hull.get(`${k.ky}:${k.kt}`);
        if (h !== undefined && k.r < h - 0.004) {
            n++;
            deep = Math.max(deep, h - k.r);
        }
    }
    return { n, deep };
}

function minDist(a: THREE.Vector3[], b: THREE.Vector3[]): number {
    let m = Infinity;
    for (const p of a) for (const q of b) m = Math.min(m, p.distanceToSquared(q));
    return Math.sqrt(m);
}

/** ゲームと同じ描き方で、1 人を姿勢ごとに置く */
function poser(gltf: typeof NPC) {
    const f = new PersonFactory(() => {}, true);
    f.setBase(gltf);
    const cam = new THREE.PerspectiveCamera(48, 1, 0.1, 500);
    cam.position.set(0, 1.5, 6);
    cam.lookAt(0, 1, 0);
    cam.updateMatrixWorld();
    const layer = new ActorLayer('t', f, null, () => ({ w: 800, h: 600 }), 4, true);
    const people = (layer as unknown as { people: Map<string, { body: { root: THREE.Object3D; bones: Map<string, THREE.Bone> } }> }).people;
    let clock = 0;
    return (p: Partial<StagePerson> & { act?: PersonAct }, time: number): Sets => {
        const base: StagePerson = { key: 'p', look: 'genzo', name: '', x: 0.3, z: 0.5, heading: 0, walked: 0, moving: 0, label: false };
        // 足が続きの動きになるよう、少し前から 1/60 秒ずつ
        clock = time - 0.3;
        for (let i = 0; i <= 18; i++, clock += 1 / 60) layer.setPeople([{ ...base, ...p, walked: (p.walked ?? 0) - (18 - i) * (p.moving ? 1.55 / 60 : 0) }], clock, cam);
        const a = people.get('p')!;
        return pointsOf(a.body.root, a.body.bones);
    };
}

type Pose = { name: string; p: Partial<StagePerson> & { act?: PersonAct }; t: number };
const POSES: Pose[] = [];
for (const t of [0.5, 1.7, 2.9, 4.1, 5.3]) POSES.push({ name: '待機', p: {}, t });
for (const w of [0.3, 0.6, 0.9, 1.2, 1.5, 1.8]) POSES.push({ name: '歩き', p: { moving: 1, walked: 4 + w }, t: 3 });
for (const w of [0.3, 0.7, 1.1, 1.5, 1.9]) POSES.push({ name: '走り', p: { moving: 1, run: 1, walked: 6 + w }, t: 3 });
for (const ph of [0, 1.6, 3.2, 4.8]) POSES.push({ name: '品物を整える', p: { act: { ...NO_ACT, lean: 1, hands: 1, handPhase: ph } }, t: 2 });
POSES.push({ name: '会釈', p: { act: { ...NO_ACT, bow: 1 } }, t: 2 });

describe('町の人物（hero_v2b）の腕：下ろして肘を曲げる。手・袖口は袴・胴・刀に入らない', () => {
    const pose = poser(NPC);
    const before = poser(ORIG);
    const rows = POSES.map((x) => ({ ...x, s: pose(x.p, x.t) }));

    it('動きの元の決まり：町の人物の GLB に腕の足し（NPC_ARMS）を書いてある。形・画像の数と範囲は元の hero_v2.glb と同じ', () => {
        const j = glbJson('hero_v2b');
        const arms = (j.extras as { npc_arms?: Record<string, { drop: number; elbow: number }> }).npc_arms;
        expect(arms).toBeDefined();
        for (const k of ['Idle', 'Walk', 'Run']) expect(arms![k]!.drop, k).toBeGreaterThan(0);
        const o = glbJson('hero_v2') as unknown as { meshes: unknown; images: unknown[]; materials: unknown; skins: { joints: number[] }[] };
        const n = j as unknown as typeof o;
        expect(JSON.stringify(n.materials)).toBe(JSON.stringify(o.materials));
        expect(n.images.length).toBe(o.images.length);
        expect(n.skins[0]!.joints).toEqual(o.skins[0]!.joints);
    });

    it('待機・歩きでは肘が体の軸へ寄る（直す前より 3 cm 以上・27.5 cm 以内）', () => {
        for (const r of rows.filter((x) => x.name === '待機' || x.name === '歩き')) {
            const b = before(r.p, r.t);
            expect(r.s.elbow, `${r.name}`).toBeLessThan(0.275);
            expect(b.elbow - r.s.elbow, `${r.name}（前 ${b.elbow.toFixed(3)}）`).toBeGreaterThan(0.03);
        }
    }, 60_000);

    it('待機・歩き・走り・品物を整える・会釈：手・袖口の点は袴・胴の殻に入らない（4 mm 以上内の点 0）。手は刀から 1 cm 以上', () => {
        for (const r of rows) {
            const h = inside(r.s.hands, r.s.body, r.s.axis);
            const c = inside(r.s.cuffs, r.s.body, r.s.axis);
            expect(h.n, `${r.name} t=${r.t} 手（深さ ${(h.deep * 100).toFixed(1)} cm）`).toBe(0);
            expect(c.n, `${r.name} t=${r.t} 袖口（深さ ${(c.deep * 100).toFixed(1)} cm）`).toBe(0);
            expect(minDist(r.s.hands, r.s.sword), `${r.name} t=${r.t} 手と刀`).toBeGreaterThan(0.01);
        }
    }, 120_000);
});
