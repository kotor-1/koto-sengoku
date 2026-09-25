/**
 * 3D 比較版（独立した試作）。
 * 城門 1 つ・町家 1 軒・木・道・主人公 1 人。主人公が歩き・止まり・向きを変え・建物の横を通れる。
 * - カメラは斜め見下ろしの固定（回転しない）。主人公をなめらかに追う。
 * - 素材は GLB（public/models/）を GLTFLoader で読み込む。今の GLB はこの試作のコードで作ったもの（tools/export.ts）。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { WALK_SPEED } from './assets/hero';
import { MAX_SPEED, createHero, stepHero, type HeroState } from './game/motion';
import { PINE, START, TREE2 } from './layout';

/** カメラ：南東の斜め上から北西を見下ろす（向きは固定） */
const CAMERA = { yaw: THREE.MathUtils.degToRad(28), pitch: THREE.MathUtils.degToRad(44), distance: 21, fov: 30 };
// 確認用（?zoom=0.35 など）：同じ向きのまま近づけて、人物や建物の作りを見る。ふだんの操作では使わない
{
    const z = Number(new URLSearchParams(location.search).get('zoom'));
    if (z > 0.1 && z <= 2) CAMERA.distance *= z;
}

const params = new URLSearchParams(location.search);
const low = params.get('q') === 'low';
const showFps = params.has('fps') || location.hash === '#fps';
const touch = matchMedia('(any-pointer: coarse)').matches || (navigator.maxTouchPoints ?? 0) > 0;
document.body.classList.toggle('touch', touch);

const buildEl = document.getElementById('build')!;
const commit = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : 'unknown';
buildEl.textContent = `コミット ${commit} ・ three.js r${THREE.REVISION} ・ ${import.meta.env.DEV ? '開発' : '本番'}ビルド`;

// ---- 描画の準備 ----
const view = document.getElementById('view')!;
const renderer = new THREE.WebGLRenderer({ antialias: !low, powerPreference: 'high-performance' });
const maxDpr = low ? 1 : 2;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
view.appendChild(renderer.domElement);

let hemiBoost = 0;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#b7bfbd');
scene.fog = new THREE.Fog('#bcc3bf', 32, 70);
const pmrem = new THREE.PMREMGenerator(renderer);
// 周囲の映り込み（やわらかい環境光）。画質「低」では省く（ソフトウェア描画の検証環境では描画時間が約 2 倍になった）
if (!low) {
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
} else {
    hemiBoost = 0.25;
}

// 日差し：西南西の少し高い所から（2D 版の影の向き＝右やや上 にそろえる）
const sun = new THREE.DirectionalLight('#fff0d8', 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
const S = 15;
Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 60 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
sun.shadow.radius = 3;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(-14, 18, 7);
const hemi = new THREE.HemisphereLight('#d8e0e8', '#6d5c47', 1.0 + hemiBoost);
scene.add(hemi);

const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.5, 120);

function resize(): void {
    const w = view.clientWidth || window.innerWidth;
    const h = view.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 縦に狭い画面（スマホ横向き）でも、上下の見える範囲が狭くなりすぎないよう少し引く
    camera.fov = CAMERA.fov * (w / h < 1.6 ? 1.12 : 1);
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---- 入力（キーボード・タッチのスティック） ----
const keys = new Set<string>();
const stick = { x: 0, y: 0, id: -1, ox: 0, oy: 0 };
const KEY_DIR: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
    ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
};
window.addEventListener('keydown', (e) => {
    if (KEY_DIR[e.code]) {
        keys.add(e.code);
        e.preventDefault();
    }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
const zone = document.getElementById('stick-zone')!;
const base = document.getElementById('stick-base')!;
const knob = document.getElementById('stick-knob')!;
const R = 52;
function releaseAll(): void {
    keys.clear();
    stick.x = stick.y = 0;
    stick.id = -1;
    zone.classList.remove('active');
    base.style.transform = '';
    base.style.left = base.style.top = base.style.bottom = '';
    knob.style.transform = '';
}
zone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (stick.id !== -1) return;
    stick.id = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    stick.ox = e.clientX;
    stick.oy = e.clientY;
    const zr = zone.getBoundingClientRect();
    base.style.left = '0px';
    base.style.top = '0px';
    base.style.bottom = 'auto';
    base.style.transform = `translate(${stick.ox - zr.left - 56}px, ${stick.oy - zr.top - 56}px)`;
    zone.classList.add('active');
});
zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stick.id) return;
    const dx = e.clientX - stick.ox;
    const dy = e.clientY - stick.oy;
    const d = Math.hypot(dx, dy);
    const k = d > R ? R / d : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const m = Math.min(1, d / R);
    const dead = 0.18;
    const s = m < dead ? 0 : (m - dead) / (1 - dead) / (d || 1);
    stick.x = dx * s;
    stick.y = dy * s;
});
for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    zone.addEventListener(t, (e) => {
        if ((e as PointerEvent).pointerId === stick.id) releaseAll();
    });
}
window.addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') releaseAll();
});
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

function readInput(): [number, number] {
    let x = stick.x;
    let y = stick.y;
    for (const k of keys) {
        x += KEY_DIR[k][0];
        y += KEY_DIR[k][1];
    }
    const m = Math.hypot(x, y);
    return m > 1 ? [x / m, y / m] : [x, y];
}

// ---- 読み込み ----
const loading = document.getElementById('loading')!;
const loader = new GLTFLoader();
const load = (name: string) => loader.loadAsync(`./models/${name}.glb`);

interface HeroView {
    root: THREE.Object3D;
    mixer: THREE.AnimationMixer;
    idle: THREE.AnimationAction;
    walk: THREE.AnimationAction;
}

function prepare(obj: THREE.Object3D): void {
    obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const ud = mesh.userData as { cast?: boolean; receive?: boolean };
        mesh.castShadow = ud.cast ?? true;
        mesh.receiveShadow = ud.receive ?? true;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat.map) mat.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
    });
}

let heroView: HeroView | null = null;

/**
 * 主人公を隠す物（建物・木）を半透明にする（2D 版の「家や木の裏に入ると半透明」と同じ考え）。
 * カメラから主人公の胸と頭へ引いた線が、物の範囲（箱）を通るときに薄くする。
 */
interface Occluder {
    root: THREE.Object3D;
    box: THREE.Box3;
    mats: THREE.MeshStandardMaterial[];
    alpha: number;
}
const occluders: Occluder[] = [];
function addOccluder(root: THREE.Object3D, fade = true): void {
    root.updateMatrixWorld(true);
    const mats = new Set<THREE.MeshStandardMaterial>();
    root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m) mats.add(m);
    });
    if (fade) occluders.push({ root, box: new THREE.Box3().setFromObject(root), mats: [...mats], alpha: 1 });
}
const ray = new THREE.Ray();
const hit = new THREE.Vector3();
function fadeOccluders(dt: number): void {
    const k = 1 - Math.exp(-10 * dt);
    for (const o of occluders) {
        let covered = false;
        for (const y of [1.0, 1.6]) {
            const target = new THREE.Vector3(hero.x, y, hero.z);
            ray.origin.copy(camera.position);
            ray.direction.copy(target).sub(camera.position).normalize();
            if (ray.intersectBox(o.box, hit) && hit.distanceTo(camera.position) < target.distanceTo(camera.position) - 0.3) {
                // 箱は大まかなので、主人公が物の「向こう側」にいるときだけ（物の中心より奥＝カメラから遠い）
                const center = o.box.getCenter(new THREE.Vector3());
                if (center.distanceTo(camera.position) < target.distanceTo(camera.position) + 1.5) covered = true;
            }
        }
        const want = covered ? 0.28 : 1;
        o.alpha += (want - o.alpha) * k;
        if (Math.abs(o.alpha - want) < 0.005) o.alpha = want;
        for (const m of o.mats) {
            const t = o.alpha < 0.999;
            if (m.transparent !== t) {
                m.transparent = t;
                m.needsUpdate = true;
            }
            m.opacity = o.alpha;
        }
    }
}
const hero: HeroState = createHero(START.x, START.z, Math.PI);

async function start(): Promise<void> {
    const t0 = performance.now();
    const [ground, gate, house, pine, broadleaf, heroGltf] = await Promise.all(['ground', 'gate', 'house', 'pine', 'broadleaf', 'hero'].map(load));
    for (const g of [ground, gate, house]) {
        prepare(g.scene);
        scene.add(g.scene);
    }
    addOccluder(gate.scene);
    addOccluder(house.scene);
    prepare(pine.scene);
    pine.scene.position.set(PINE.x, 0, PINE.z);
    scene.add(pine.scene);
    prepare(broadleaf.scene);
    broadleaf.scene.position.set(TREE2.x, 0, TREE2.z);
    broadleaf.scene.rotation.y = 0.8;
    scene.add(broadleaf.scene);
    addOccluder(pine.scene);
    addOccluder(broadleaf.scene);
    // 草むらは影を落とさない（地面の書き出しで指定済み）
    prepare(heroGltf.scene);
    heroGltf.scene.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
    });
    scene.add(heroGltf.scene);
    const mixer = new THREE.AnimationMixer(heroGltf.scene);
    const clip = (n: string) => {
        const c = THREE.AnimationClip.findByName(heroGltf.animations, n);
        if (!c) throw new Error(`動き「${n}」がありません`);
        return c;
    };
    const idle = mixer.clipAction(clip('idle'));
    const walk = mixer.clipAction(clip('walk'));
    idle.play();
    walk.play();
    walk.setEffectiveWeight(0);
    heroView = { root: heroGltf.scene, mixer, idle, walk };
    stats.readyMs = Math.round(performance.now());
    stats.loadMs = Math.round(performance.now() - t0);
    loading.hidden = true;
    placeCamera(1);
    renderer.setAnimationLoop(frame);
}

// ---- 毎フレーム ----
const camTarget = new THREE.Vector3(hero.x, 1.0, hero.z);
function placeCamera(k: number): void {
    const want = new THREE.Vector3(hero.x, CAMERA.distance < 12 ? 0.95 : 1.0, hero.z);
    camTarget.lerp(want, k);
    const h = Math.cos(CAMERA.pitch) * CAMERA.distance;
    camera.position.set(
        camTarget.x + Math.sin(CAMERA.yaw) * h,
        camTarget.y + Math.sin(CAMERA.pitch) * CAMERA.distance,
        camTarget.z + Math.cos(CAMERA.yaw) * h,
    );
    camera.lookAt(camTarget);
    sun.position.copy(camTarget).add(SUN_OFFSET);
    sun.target.position.copy(camTarget);
}

const clock = new THREE.Clock();
const stats = { readyMs: 0, loadMs: 0, frames: 0 };
let walkBlend = 0;
const fpsEl = document.getElementById('fps')!;
fpsEl.hidden = !showFps;
let fpsTime = 0;
let fpsFrames = 0;

function frame(): void {
    const raw = clock.getDelta();
    const [ix, iy] = readInput();
    advance(Math.min(raw, 0.1), raw, ix, iy);
}

/** 1 フレーム進めて描く（録画用に、決まった時間と入力で進めることもできる） */
function advance(dt: number, raw: number, ix: number, iy: number): void {
    stats.frames++;
    stepHero(hero, ix, iy, CAMERA.yaw, dt);
    const v = heroView!;
    v.root.position.set(hero.x, 0, hero.z);
    v.root.rotation.y = hero.heading;
    // 歩きと待機を速さで混ぜる。歩きの再生速度は実際の速さに合わせる（足が滑らないように）
    const want = THREE.MathUtils.smoothstep(hero.speed, 0.05, 0.5);
    walkBlend += (want - walkBlend) * (1 - Math.exp(-10 * dt));
    v.walk.setEffectiveWeight(walkBlend);
    v.idle.setEffectiveWeight(1 - walkBlend);
    v.walk.timeScale = THREE.MathUtils.clamp(hero.speed / WALK_SPEED, 0.6, MAX_SPEED / WALK_SPEED);
    v.mixer.update(dt);
    placeCamera(1 - Math.exp(-6 * dt));
    fadeOccluders(dt);
    renderer.render(scene, camera);
    if (showFps) {
        // 表示する fps は実際の時間で数える（1 フレームの上限 0.1 秒で切り詰めた時間ではなく）
        fpsTime += raw;
        fpsFrames++;
        if (fpsTime > 0.5) {
            const info = renderer.info;
            fpsEl.textContent = `${Math.round(fpsFrames / fpsTime)} fps\n描画 ${renderer.domElement.width}×${renderer.domElement.height}px\n描画命令 ${info.render.calls}・三角形 ${info.render.triangles}\n読み込み ${stats.loadMs}ms`;
            fpsTime = 0;
            fpsFrames = 0;
        }
    }
}

start().catch((e: unknown) => {
    loading.hidden = false;
    loading.classList.add('error');
    loading.textContent = `読み込めませんでした：${e instanceof Error ? e.message : String(e)}`;
    console.error(e);
});

// 開発時のみ：自動確認から状態を読めるようにする
if (import.meta.env.DEV) {
    Object.assign(window, {
        __p3: {
            hero, stats, camera, renderer, scene, releaseAll,
            get anim() { return { walkBlend, walkTime: heroView?.walk.time ?? 0 }; },
            get fade() { return occluders.map((o) => Math.round(o.alpha * 100) / 100); },
            /** 録画用：自動の更新を止め、step で 1 コマずつ進める */
            manual() { renderer.setAnimationLoop(null); },
            step(dt: number, ix: number, iy: number) { advance(dt, dt, ix, iy); },
        },
    });
}
