/**
 * 探索の場面の中の第一章のもの（three）：家臣・使者の人物、高札、城門の出陣の印、頭の上の名前。
 * campaign/game.ts の GameWorld を満たす。置く場所と誰が居るかは explore/cast.ts（純粋）が決める。
 *
 * 見た目は暫定：人物は既存の主人公の素材（hero_v2.glb。GLB／公開用の JSON の読み込みは main.ts のまま）を複製し、
 * 着物・髪の色だけを変える。新しい素材は作らない。後で人物ごとの素材に替えるときは LOOKS と load の名前を替える。
 * 負傷した人物は、床几（簡単な箱）に腰掛けた姿勢にする（骨の向きを直接決める）。
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GameWorld } from '../campaign/game';
import type { CharacterId, ExplorePose, TalkId } from '../campaign/state';
import type { HeroState } from '../game/motion';
import { colliders, groundY, type Rect } from '../layout';
import { castColliders, headingToward, type CastMember } from './cast';

/** main.ts（探索）が渡すもの */
export interface ExploreHost {
    scene: THREE.Scene;
    camera: THREE.Camera;
    /** 名前の札を置く入れ物（#app） */
    overlay: HTMLElement;
    hero: HeroState;
    /** 画質「低」（影を落とさない） */
    low: boolean;
    load(name: string): Promise<GLTF>;
    prepare(obj: THREE.Object3D): void;
    /** 主人公をその位置・向きに立たせ、カメラを背後へ */
    setHeroPose(p: ExplorePose): void;
    /** 探索の操作を許す／止める（止めるときは入力を離す） */
    setControl(enabled: boolean): void;
    /** 歩きの当たり判定に足す四角形（人物・高札） */
    setExtraColliders(r: Rect[]): void;
    /** 毎フレーム（探索の間だけ。カメラを置いた後・描く前） */
    onFrame(fn: (dt: number) => void): void;
    viewSize(): { w: number; h: number };
}

/** 人物の見た目の違い（素材の色に掛ける倍率。1 より大きくてよい）。暫定 */
const LOOKS: Record<Exclude<CharacterId, 'hero' | 'washio_gen'>, { kosode: [number, number, number]; hakama?: [number, number, number]; hair?: [number, number, number]; scale: number }> = {
    // 老臣：くすんだ茶の着物、白髪まじり
    genzo: { kosode: [2.4, 1.7, 0.95], hakama: [1.2, 1.1, 0.9], hair: [9, 9, 9], scale: 0.97 },
    // 若い物頭：緑がかった着物
    shinpachi: { kosode: [0.9, 1.9, 1.0], scale: 0.96 },
    // 田代の使者：赤茶
    tashiro_envoy: { kosode: [3.0, 1.2, 0.6], hakama: [1.4, 1.1, 0.9], scale: 1.0 },
    // 大森の使者：明るい藍に灰の袴
    omori_envoy: { kosode: [1.3, 1.5, 1.9], hakama: [1.8, 1.8, 1.8], scale: 0.99 },
};
const NPC_MODEL = 'hero_v2';

interface NpcView {
    member: CastMember;
    root: THREE.Object3D;
    mixer: THREE.AnimationMixer | null;
    bones: Map<string, THREE.Bone>;
    heading: number;
    targetHeading: number;
    label: HTMLElement;
    labelY: number;
}

const tmp = new THREE.Vector3();
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class ExploreWorld implements GameWorld {
    private base: GLTF | null = null;
    private baseFailed = false;
    private loading: Promise<void> | null = null;
    private cast: CastMember[] = [];
    private readonly views = new Map<TalkId, NpcView>();
    private readonly group = new THREE.Group();
    private readonly labels: HTMLElement;
    private readonly wallRects = colliders();
    private readonly lookMats = new Map<string, Map<THREE.Material, THREE.Material>>();
    private time = 0;

    constructor(private readonly host: ExploreHost) {
        this.group.name = 'chapter-cast';
        host.scene.add(this.group);
        this.labels = document.createElement('div');
        this.labels.id = 'npc-labels';
        host.overlay.appendChild(this.labels);
    }

    /** 人物の素材を読む（読めなければ簡単な形で代わりに立てる：ゲームは進められる） */
    preload(): Promise<void> {
        this.loading ??= this.host
            .load(NPC_MODEL)
            .then((g) => {
                this.base = g;
            })
            .catch((e: unknown) => {
                console.error('人物の素材を読み込めませんでした（簡単な形で代わりに立てます）', e);
                this.baseFailed = true;
            })
            .then(() => {
                // 読み込みの前に置くよう頼まれていた人物を作り直す
                const c = this.cast;
                this.clear();
                this.build(c);
            });
        return this.loading;
    }

    get ready(): boolean {
        return !!this.base || this.baseFailed;
    }

    // ---------------- GameWorld ----------------

    setCast(cast: CastMember[]): void {
        // 同じ相手・同じ姿勢・同じ場所なら作り直さない
        const same =
            cast.length === this.cast.length &&
            cast.every((c, i) => {
                const o = this.cast[i]!;
                return o.id === c.id && o.pose === c.pose && o.x === c.x && o.z === c.z && o.key === c.key && o.look === c.look;
            });
        if (same) return;
        this.clear();
        this.build(cast);
    }

    heroPose(): ExplorePose {
        const h = this.host.hero;
        return { x: h.x, z: h.z, heading: h.heading };
    }

    setHeroPose(p: ExplorePose): void {
        this.host.setHeroPose(p);
    }

    setControl(enabled: boolean): void {
        this.host.setControl(enabled);
    }

    faceTalk(id: TalkId): void {
        const v = this.views.get(id);
        const h = this.host.hero;
        const m = v?.member ?? this.cast.find((c) => c.id === id);
        if (!m) return;
        if (v && m.kind === 'person' && m.pose === 'stand') v.targetHeading = headingToward(m.x, m.z, h.x, h.z);
        // 主人公も相手の方を向く（城門はそのまま）
        if (m.kind !== 'gate') {
            h.heading = headingToward(h.x, h.z, m.x, m.z);
            h.dirX = Math.sin(h.heading);
            h.dirZ = Math.cos(h.heading);
        }
    }

    walls(): Rect[] {
        return this.wallRects;
    }

    // ---------------- 作る・消す ----------------

    private clear(): void {
        for (const v of this.views.values()) {
            this.group.remove(v.root);
            v.mixer?.stopAllAction();
            v.label.remove();
        }
        this.views.clear();
        this.cast = [];
        this.host.setExtraColliders([]);
    }

    private build(cast: CastMember[]): void {
        this.cast = cast.slice();
        this.host.setExtraColliders(castColliders(cast));
        for (const m of cast) {
            let v: NpcView | null = null;
            if (m.kind === 'person') v = this.makePerson(m);
            else if (m.kind === 'notice') v = this.makeStatic(m, makeNoticeBoard(), 2.3);
            else v = this.makeStatic(m, makeGateMark(m), 3.2);
            if (v) this.views.set(m.id, v);
        }
    }

    private makeLabel(m: CastMember): HTMLElement {
        const l = document.createElement('div');
        l.className = `npc-label${m.key ? ' key' : ''}${m.kind === 'gate' ? ' gate' : ''}`;
        l.textContent = m.label;
        l.dataset.id = m.id;
        this.labels.appendChild(l);
        return l;
    }

    private makeStatic(m: CastMember, obj: THREE.Object3D, labelY: number): NpcView {
        obj.position.set(m.x, groundY(m.x, m.z), m.z);
        obj.rotation.y = m.heading;
        this.group.add(obj);
        return { member: m, root: obj, mixer: null, bones: new Map(), heading: m.heading, targetHeading: m.heading, label: this.makeLabel(m), labelY };
    }

    private makePerson(m: CastMember): NpcView | null {
        if (!this.ready) {
            // 素材を読み終えたら作る（preload の最後で作り直す）。名前の札だけは先に出さない
            void this.preload();
            return null;
        }
        const look = m.look && m.look in LOOKS ? LOOKS[m.look as keyof typeof LOOKS] : LOOKS.genzo;
        const root = new THREE.Group();
        let body: THREE.Object3D;
        let mixer: THREE.AnimationMixer | null = null;
        const bones = new Map<string, THREE.Bone>();
        if (this.base) {
            body = cloneSkinned(this.base.scene);
            this.host.prepare(body);
            const mats = this.materialsFor(m.look ?? 'genzo', look);
            body.traverse((o) => {
                const mesh = o as THREE.SkinnedMesh;
                if (mesh.isSkinnedMesh) mesh.frustumCulled = false;
                if (mesh.isMesh) {
                    const mm = mesh.material;
                    mesh.material = Array.isArray(mm) ? mm.map((x) => mats.get(x) ?? x) : (mats.get(mm) ?? mm);
                    mesh.castShadow = !this.host.low;
                }
                if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
            });
            mixer = new THREE.AnimationMixer(body);
            const idle = THREE.AnimationClip.findByName(this.base.animations, 'Idle');
            if (idle) {
                const a = mixer.clipAction(idle);
                a.play();
                // 皆が同じ拍子で揺れないように、始める位置をずらす
                a.time = (hash(m.id) % 1000) / 1000 * idle.duration;
            }
        } else {
            body = makeStandIn();
        }
        body.scale.setScalar(look.scale);
        root.add(body);
        if (m.pose === 'sit') root.add(makeStool());
        root.position.set(m.x, groundY(m.x, m.z), m.z);
        root.rotation.y = m.heading;
        this.group.add(root);
        const v: NpcView = { member: m, root, mixer, bones, heading: m.heading, targetHeading: m.heading, label: this.makeLabel(m), labelY: m.pose === 'sit' ? 1.65 : 2.05 };
        if (mixer) {
            mixer.update(0);
            if (m.pose === 'sit') sitPose(bones);
        }
        return v;
    }

    /** 人物ごとの色を掛けた素材（同じ見た目の人物で共用） */
    private materialsFor(key: string, look: (typeof LOOKS)[keyof typeof LOOKS]): Map<THREE.Material, THREE.Material> {
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

    // ---------------- 毎フレーム ----------------

    frame(dt: number): void {
        this.time += dt;
        const h = this.host.hero;
        const { w, h: vh } = this.host.viewSize();
        const cam = this.host.camera;
        for (const v of this.views.values()) {
            const m = v.member;
            if (v.mixer) {
                // 話しかけられたら相手の方へ向き直る（ゆっくり）
                const d = wrap(v.targetHeading - v.heading);
                if (Math.abs(d) > 1e-3) {
                    v.heading = wrap(v.heading + d * (1 - Math.exp(-6 * dt)));
                    v.root.rotation.y = v.heading;
                }
                v.mixer.update(dt);
                if (m.pose === 'sit') sitPose(v.bones);
            }
            if (m.kind === 'gate') {
                const ring = v.root.getObjectByName('gate-ring') as THREE.Mesh | undefined;
                if (ring) (ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.2 * Math.sin(this.time * 3);
            }
            // 名前の札：頭の上。遠い・画面の外・カメラの後ろでは出さない
            tmp.set(m.x, groundY(m.x, m.z) + v.labelY, m.z).project(cam);
            const dist = Math.hypot(m.x - h.x, m.z - h.z);
            const show = tmp.z > -1 && tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1 && dist < 26;
            if (!show) {
                if (!v.label.hidden) v.label.hidden = true;
                continue;
            }
            v.label.hidden = false;
            const sx = (tmp.x * 0.5 + 0.5) * w;
            const sy = (-tmp.y * 0.5 + 0.5) * vh;
            v.label.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
            v.label.classList.toggle('far', dist > 12);
        }
    }

    /** 確認用：置いている人物（id・姿勢・場所） */
    probe(): { id: TalkId; pose: string; x: number; z: number; model: boolean }[] {
        return [...this.views.values()].map((v) => ({ id: v.member.id, pose: v.member.pose, x: v.member.x, z: v.member.z, model: !!v.mixer }));
    }
}

function hash(s: string): number {
    let h = 7;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
}

const qx = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
const qz = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
/**
 * 腰掛けた姿勢（hero_v2 の骨：休みの形では骨はすべて回転なし、脚は下向き）。待機の動きの後に上書きする。
 * 太ももを前へ水平に、すねを下へ、腰を床几の高さへ。上体を少し前へ傾け、手を膝の上へ。
 */
const SIT = {
    hipsY: 0.52,
    upperLeg: qx(-Math.PI / 2 + 0.08),
    lowerLeg: qx(Math.PI / 2 - 0.02),
    spine: qx(0.16),
    neck: qx(0.18),
    upperArmL: qx(-0.55).multiply(qz(0.12)),
    upperArmR: qx(-0.55).multiply(qz(-0.12)),
    foreArm: qx(-0.5),
};
function sitPose(b: Map<string, THREE.Bone>): void {
    const hips = b.get('Hips');
    if (hips) hips.position.y = SIT.hipsY;
    b.get('LeftUpperLeg')?.quaternion.copy(SIT.upperLeg);
    b.get('RightUpperLeg')?.quaternion.copy(SIT.upperLeg);
    b.get('LeftLowerLeg')?.quaternion.copy(SIT.lowerLeg);
    b.get('RightLowerLeg')?.quaternion.copy(SIT.lowerLeg);
    b.get('LeftFoot')?.quaternion.identity();
    b.get('RightFoot')?.quaternion.identity();
    b.get('Spine')?.quaternion.copy(SIT.spine);
    b.get('Neck')?.quaternion.copy(SIT.neck);
    b.get('LeftUpperArm')?.quaternion.copy(SIT.upperArmL);
    b.get('RightUpperArm')?.quaternion.copy(SIT.upperArmR);
    b.get('LeftForeArm')?.quaternion.copy(SIT.foreArm);
    b.get('RightForeArm')?.quaternion.copy(SIT.foreArm);
}

const WOOD = new THREE.MeshStandardMaterial({ color: '#5a4430', roughness: 0.85 });
const PAPER = new THREE.MeshStandardMaterial({ color: '#d8cfb6', roughness: 0.95 });
const INK = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.9 });

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

/** 床几（腰掛け。簡単な箱。暫定） */
function makeStool(): THREE.Object3D {
    const g = new THREE.Group();
    g.add(box(0.46, 0.06, 0.36, WOOD, 0, 0.42, 0.02));
    for (const sx of [-1, 1]) g.add(box(0.05, 0.42, 0.3, WOOD, sx * 0.19, 0.21, 0.02));
    return g;
}

/** 高札（2 本の柱・板・小さな屋根。簡単な箱。暫定）。表（文字の面）は +z。向きは cast の heading で回す */
function makeNoticeBoard(): THREE.Object3D {
    const g = new THREE.Group();
    for (const sx of [-1, 1]) g.add(box(0.1, 2.1, 0.1, WOOD, sx * 0.7, 1.05, 0));
    g.add(box(1.5, 0.75, 0.05, WOOD, 0, 1.45, 0.02));
    g.add(box(1.36, 0.62, 0.02, PAPER, 0, 1.45, 0.055));
    // 墨の行（札の文字の代わり）
    for (let i = 0; i < 5; i++) g.add(box(0.03, 0.46, 0.005, INK, -0.45 + i * 0.22, 1.45, 0.068));
    g.add(box(1.75, 0.05, 0.42, WOOD, 0, 1.92, 0.02));
    return g;
}

/** 城門の出陣の場所（地面の輪。人物の素材ではない印） */
function makeGateMark(m: CastMember): THREE.Object3D {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(m.reach - 0.25, m.reach, 48),
        new THREE.MeshBasicMaterial({ color: '#e0b964', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.name = 'gate-ring';
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    ring.renderOrder = 2;
    g.add(ring);
    return g;
}

/** 人物の素材を読めなかったときの代わり（柱の形） */
function makeStandIn(): THREE.Object3D {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.1, 4, 12), new THREE.MeshStandardMaterial({ color: '#50607a', roughness: 0.8 }));
    body.position.y = 0.8;
    body.castShadow = true;
    g.add(body);
    return g;
}
