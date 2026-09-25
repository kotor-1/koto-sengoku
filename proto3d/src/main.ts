/**
 * 3D 比較版（独立した試作）。
 * 城門 1 つ・町家 1 軒・木・道・主人公 1 人。主人公が歩き・止まり・向きを変え・建物の横を通れる。
 * - カメラは斜め見下ろしの固定（回転しない）。主人公をなめらかに追う。
 * - 素材は GLB（public/models/）を GLTFLoader で読み込む。今の GLB はこの試作のコードで作ったもの（tools/export.ts）。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { gaits } from './assets/hero';
import { CAMERA_YAW, SPEED, createHero, stepHero, type HeroState } from './game/motion';
import { PINE, START, TREE2 } from './layout';

/**
 * カメラ：南の斜め上から北を見下ろす「正面寄りの見下ろし」（向きは固定。回転しない）。
 * 城門へ向かう南北の道が画面の上下に通る。真上にはせず、屋根や壁の高さが見える角度にする。
 * 向き（CAMERA_YAW）は入力の向きの変換（motion.ts の screenToGround）と共用する（変換はそこで 1 回だけ）。
 */
const CAMERA = { yaw: CAMERA_YAW, pitch: THREE.MathUtils.degToRad(42), distance: 21, fov: 30 };
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

// ---- 入力（キーボード・タッチのスティック・歩く／走るの切り替え） ----
const keys = new Set<string>();
/** 歩く／走る：ボタンで選んでいる方（押し続けなくてよい）と、PC の Shift（押している間だけ走る） */
let runMode = false;
let shiftHeld = false;
const running = () => runMode || shiftHeld;
const stick = { x: 0, y: 0, id: -1, ox: 0, oy: 0 };
const KEY_DIR: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
    ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
};
window.addEventListener('keydown', (e) => {
    // Shift の離しを取りこぼしても、次のキー入力で今の状態に合わせる
    shiftHeld = e.shiftKey || e.key === 'Shift';
    if (KEY_DIR[e.code]) {
        keys.add(e.code);
        e.preventDefault();
    }
    updateRunUi();
});
window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    shiftHeld = e.shiftKey && e.key !== 'Shift';
    updateRunUi();
});
// 歩く／走るのボタン：タップ（クリック）で切り替え。スティックとは別の指で押せる（スティックは画面の左半分、ボタンは右下）
const runBtn = document.getElementById('run-btn')!;
runBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    runMode = !runMode;
    updateRunUi();
});
// キーボード（Tab で選んで Enter／Space）で押したとき。指やマウスは pointerdown で切り替え済み
runBtn.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    runMode = !runMode;
    updateRunUi();
});
let shownRun: boolean | null = null;
function updateRunUi(): void {
    const on = running();
    runBtn.setAttribute('aria-pressed', String(runMode));
    if (on === shownRun) return;
    shownRun = on;
    runBtn.classList.toggle('on', on);
}
const zone = document.getElementById('stick-zone')!;
const base = document.getElementById('stick-base')!;
const knob = document.getElementById('stick-knob')!;
const R = 52;
/** 移動の入力と Shift を離した扱いにする（指を離した・画面を離れた・アプリを切り替えた）。ボタンで選んだ歩く／走るはそのまま */
function releaseAll(): void {
    keys.clear();
    shiftHeld = false;
    updateRunUi();
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
// 置き場所によっては .glb を配れないので、同じ中身の glTF（JSON 形式、データ埋め込み）を .json で置けるようにする
const MODEL_EXT = (import.meta.env.VITE_MODEL_EXT as string | undefined) || '.glb';
const load = (name: string) => (MODEL_EXT === '.glb' ? loader.loadAsync(`./models/${name}.glb`) : loadJson(name));

/**
 * glTF（JSON）を読む。その置き場所では data: の URL を読み込めないので、
 * 埋め込んだ形のデータ（base64）はここで戻し、GLB の形に組み直してから読む（画像は同じ場所の別ファイル）。
 */
async function loadJson(name: string) {
    const res = await fetch(`./models/${name}${MODEL_EXT}`);
    if (!res.ok) throw new Error(`${name}${MODEL_EXT} を読み込めません（${res.status}）`);
    const json = await res.json();
    const uri: string = json.buffers[0].uri;
    const raw = atob(uri.slice(uri.indexOf(',') + 1));
    const bin = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
    delete json.buffers[0].uri;
    const text = new TextEncoder().encode(JSON.stringify(json));
    const jsonLen = Math.ceil(text.length / 4) * 4;
    const binLen = Math.ceil(bin.length / 4) * 4;
    const glb = new Uint8Array(12 + 8 + jsonLen + 8 + binLen);
    const dv = new DataView(glb.buffer);
    dv.setUint32(0, 0x46546c67, true); // 'glTF'
    dv.setUint32(4, 2, true);
    dv.setUint32(8, glb.length, true);
    dv.setUint32(12, jsonLen, true);
    dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
    glb.fill(0x20, 20, 20 + jsonLen);
    glb.set(text, 20);
    dv.setUint32(20 + jsonLen, binLen, true);
    dv.setUint32(24 + jsonLen, 0x004e4942, true); // 'BIN'
    glb.set(bin, 28 + jsonLen);
    return loader.parseAsync(glb.buffer, './models/');
}

interface HeroView {
    root: THREE.Object3D;
    mixer: THREE.AnimationMixer;
    idle: THREE.AnimationAction;
    walk: THREE.AnimationAction;
    run: THREE.AnimationAction;
}
/** 歩き・走りの 1 周期の長さと、足が滑らない設計速度（骨組みから計算。素材の動きと同じ式） */
const GAIT = gaits();

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
    const run = mixer.clipAction(clip('run'));
    idle.play();
    // 歩き・走りは、同じ位相（stride）から再生位置を決める（自分では進めない）
    for (const a of [walk, run]) {
        a.play();
        a.timeScale = 0;
        a.setEffectiveWeight(0);
    }
    heroView = { root: heroGltf.scene, mixer, idle, walk, run };
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
/** 動いている重み（0 待機 → 1 歩き・走り） */
let walkBlend = 0;
/** 歩き・走りの位相（0〜1、1 周期で 1）。進んだ距離から決めるので、足が地面の上で滑らない */
let stride = 0;
let runBlend = 0;
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
    stepHero(hero, ix, iy, CAMERA.yaw, dt, running());
    const v = heroView!;
    v.root.position.set(hero.x, 0, hero.z);
    v.root.rotation.y = hero.heading;
    // 待機と動きを速さで混ぜ、動きの中では歩きと走りを速さで混ぜる
    const want = THREE.MathUtils.smoothstep(hero.speed, 0.05, 0.5);
    walkBlend += (want - walkBlend) * (1 - Math.exp(-10 * dt));
    runBlend = THREE.MathUtils.smoothstep(hero.speed, SPEED.walk * 1.02, SPEED.walk + (SPEED.run - SPEED.walk) * 0.7);
    // 位相は実際に進んだ速さで進める（1 周期の距離は歩きと走りを混ぜた長さ）。止まれば脚も止まり、滑らない
    const cycle = THREE.MathUtils.lerp(GAIT.walk.speed * GAIT.walk.period, GAIT.run.speed * GAIT.run.period, runBlend);
    stride = (stride + (hero.speed * dt) / cycle) % 1;
    v.walk.time = stride * GAIT.walk.period;
    v.run.time = stride * GAIT.run.period;
    v.walk.setEffectiveWeight(walkBlend * (1 - runBlend));
    v.run.setEffectiveWeight(walkBlend * runBlend);
    v.idle.setEffectiveWeight(1 - walkBlend);
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
            get anim() { return { walkBlend, runBlend, stride, walkTime: heroView?.walk.time ?? 0, running: running(), runMode }; },
            get fade() { return occluders.map((o) => Math.round(o.alpha * 100) / 100); },
            /** 録画用：自動の更新を止め、step で 1 コマずつ進める */
            manual() { renderer.setAnimationLoop(null); },
            step(dt: number, ix: number, iy: number) { advance(dt, dt, ix, iy); },
            /** 確認用：実際のキー・スティックの入力のまま、決まった時間だけ進める */
            stepInput(dt: number) { advance(dt, dt, ...readInput()); },
        },
    });
}
