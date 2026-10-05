/**
 * 人物の素材の写し（three）。会話の相手・演出の使者・町の人々で共有する。
 * 見た目は既存の人物の素材（hero_v2.glb）を複製し、着物・袴・髪の色だけを変える（新しい素材は作らない）。
 * 演出・町の人々の人は、歩きと立ちの動きを「時刻・歩いた距離」から決める（自分では進めない。同じ時刻なら同じ形）。
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface Look {
    kosode: [number, number, number];
    hakama?: [number, number, number];
    hair?: [number, number, number];
    scale: number;
}

/** 人物の見た目の違い（素材の色に掛ける倍率。1 より大きくてよい）。暫定 */
export const LOOKS: Record<string, Look> = {
    // 老臣：くすんだ茶の着物、白髪まじり
    genzo: { kosode: [2.4, 1.7, 0.95], hakama: [1.2, 1.1, 0.9], hair: [9, 9, 9], scale: 0.97 },
    // 若い物頭：緑がかった着物
    shinpachi: { kosode: [0.9, 1.9, 1.0], scale: 0.96 },
    // 田代の使者：赤茶
    tashiro_envoy: { kosode: [3.0, 1.2, 0.6], hakama: [1.4, 1.1, 0.9], scale: 1.0 },
    // 大森の使者：明るい藍に灰の袴
    omori_envoy: { kosode: [1.3, 1.5, 1.9], hakama: [1.8, 1.8, 1.8], scale: 0.99 },
    // 町の人々（話しかけられない。色だけ変える）：荷を運ぶ人（くすんだ黄土・藍）と店の人（渋い茶・鼠色）
    townsman_a: { kosode: [1.9, 1.6, 1.0], hakama: [0.8, 0.8, 0.9], scale: 0.95 },
    townsman_b: { kosode: [0.9, 1.1, 1.5], hakama: [1.0, 0.95, 0.85], scale: 0.97 },
    merchant_a: { kosode: [1.6, 1.15, 0.85], hakama: [1.5, 1.45, 1.4], scale: 0.96 },
    merchant_b: { kosode: [1.25, 1.25, 1.25], hakama: [0.9, 0.85, 0.8], scale: 0.95 },
};

/** 人物 1 人分の three の物 */
export interface PersonBody {
    /** 置く根（位置・向きはここ） */
    root: THREE.Group;
    mixer: THREE.AnimationMixer | null;
    bones: Map<string, THREE.Bone>;
    idle: THREE.AnimationAction | null;
    walk: THREE.AnimationAction | null;
    /** 素材が読めなかったときの代わりの形 */
    standIn: boolean;
}

export class PersonFactory {
    private base: GLTF | null = null;
    private readonly lookMats = new Map<string, Map<THREE.Material, THREE.Material>>();

    constructor(
        private readonly prepare: (o: THREE.Object3D) => void,
        private readonly low: boolean,
    ) {}

    setBase(g: GLTF | null): void {
        this.base = g;
    }

    get hasModel(): boolean {
        return !!this.base;
    }

    /**
     * 人物を作る。walk なら歩きの動きも持たせる（演出・町の人々。再生位置は呼ぶ側が決める）。
     * idlePhase は待機の動きの始めの位置（0〜1。皆が同じ拍子で揺れないように）
     */
    make(lookKey: string | undefined, opts: { walk?: boolean; idlePhase?: number } = {}): PersonBody {
        const look = (lookKey && LOOKS[lookKey]) || LOOKS.genzo!;
        const root = new THREE.Group();
        const bones = new Map<string, THREE.Bone>();
        let mixer: THREE.AnimationMixer | null = null;
        let idle: THREE.AnimationAction | null = null;
        let walk: THREE.AnimationAction | null = null;
        let body: THREE.Object3D;
        if (this.base) {
            body = cloneSkinned(this.base.scene);
            this.prepare(body);
            const mats = this.materialsFor(lookKey ?? 'genzo', look);
            body.traverse((o) => {
                const mesh = o as THREE.SkinnedMesh;
                if (mesh.isSkinnedMesh) mesh.frustumCulled = false;
                if (mesh.isMesh) {
                    const mm = mesh.material;
                    mesh.material = Array.isArray(mm) ? mm.map((x) => mats.get(x) ?? x) : (mats.get(mm) ?? mm);
                    mesh.castShadow = !this.low;
                }
                if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
            });
            mixer = new THREE.AnimationMixer(body);
            const idleClip = THREE.AnimationClip.findByName(this.base.animations, 'Idle');
            if (idleClip) {
                idle = mixer.clipAction(idleClip);
                idle.play();
                idle.time = (opts.idlePhase ?? 0) * idleClip.duration;
            }
            if (opts.walk) {
                const walkClip = THREE.AnimationClip.findByName(this.base.animations, 'Walk');
                if (walkClip) {
                    walk = mixer.clipAction(walkClip);
                    walk.play();
                    walk.setEffectiveWeight(0);
                }
                // 動きの位置は呼ぶ側が決める（自分では進めない）
                if (idle) idle.timeScale = 0;
                if (walk) walk.timeScale = 0;
            }
        } else {
            body = makeStandIn();
        }
        body.scale.setScalar(look.scale);
        root.add(body);
        return { root, mixer, bones, idle, walk, standIn: !this.base };
    }

    /** 人物ごとの色を掛けた素材（同じ見た目の人物で共用） */
    private materialsFor(key: string, look: Look): Map<THREE.Material, THREE.Material> {
        const cached = this.lookMats.get(key);
        if (cached) return cached;
        const map = new Map<THREE.Material, THREE.Material>();
        this.base!.scene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
                if (map.has(mat)) continue;
                const n = mat.name.toLowerCase();
                const tint = n.includes('kosode') ? look.kosode : n.includes('hakama') ? look.hakama : n.startsWith('hair') ? look.hair : undefined;
                if (!tint) {
                    map.set(mat, mat);
                    continue;
                }
                const c = mat.clone() as THREE.MeshStandardMaterial;
                c.color.setRGB(c.color.r * tint[0], c.color.g * tint[1], c.color.b * tint[2]);
                map.set(mat, c);
            }
        });
        this.lookMats.set(key, map);
        return map;
    }
}

/** 1 歩の周期で進む距離（m。歩きの動き 0.84 秒 × 1.4 m/秒。主人公と同じ） */
const STRIDE_M = 1.4 * 0.84;

/**
 * 歩きと立ちの形を決める（時刻 time 秒・歩いた距離 walked m・歩いている割合 moving 0〜1）。同じ値なら同じ形。
 * 待機の動きは time から、歩きの動きは walked から（足が滑らない）。
 */
export function posePerson(p: PersonBody, time: number, walked: number, moving: number): void {
    if (!p.mixer) return;
    const m = Math.max(0, Math.min(1, moving));
    if (p.idle) {
        const d = p.idle.getClip().duration;
        p.idle.time = ((time % d) + d) % d;
        p.idle.setEffectiveWeight(1 - m);
    }
    if (p.walk) {
        const d = p.walk.getClip().duration;
        const ph = (((walked / STRIDE_M) % 1) + 1) % 1;
        p.walk.time = ph * d;
        p.walk.setEffectiveWeight(m);
    }
    p.mixer.update(0);
}

/** 人物の素材を読めなかったときの代わり（柱の形） */
export function makeStandIn(): THREE.Object3D {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.1, 4, 12), new THREE.MeshStandardMaterial({ color: '#50607a', roughness: 0.8 }));
    body.position.y = 0.8;
    body.castShadow = true;
    g.add(body);
    return g;
}

/** 名前（文字列）から決まる数（皆が同じ拍子にならないように） */
export function hashOf(s: string): number {
    let h = 7;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
}
