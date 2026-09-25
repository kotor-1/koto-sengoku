/**
 * 3D 比較版（独立した試作）。
 * 城門 1 つ・道の両側の町家・木・道・主人公 1 人。主人公が歩き・走り・止まり・向きを変え・建物の横を通れる。
 * - カメラ：主人公の背後・肩越しの三人称（既定）。画面の右側（PC は画面のどこでも）のドラッグで周りを見る。
 *   移動はカメラの向きに合わせる。壁・屋根を突き抜けない（game/follow.ts）。
 *   確認用に、これまでの斜め見下ろしの固定カメラも残す（?view=top）。
 * - 空と山並みは、このコードで作る形（scenery.ts）。
 * - 素材は GLB（public/models/）を GLTFLoader で読み込む。城門前の場面の素材（主人公 hero_v3・町家 3 棟・城門・土塀・木・地面・天守）は
 *   Blender で作ったもの（proto3d/blender/。配置の約束は blender/scene.json、当たり判定は素材ごとの *.meta.json）。
 *   前の主人公（利用者が用意したモデルを改良した hero_v2）へは画面のボタン・?hero=old で切り替えられる。
 *   コードで作った前の素材（tools/export.ts）は残してあるが、この場面では読み込まない。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FOLLOW, createOrbit, look, placeFollow } from './game/follow';
import { CAMERA_YAW, SPEED, createHero, stepHero, type HeroState } from './game/motion';
import { START, TREES, cameraBlockers } from './layout';
import treesMeta from '../blender/trees/trees.meta.json';
import { SKY, makeHills, makeSky } from './scenery';

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
const hashParams = new URLSearchParams(location.hash.slice(1));
/** カメラ：肩越しの三人称（既定）か、これまでの斜め見下ろし（?view=top、#view=top） */
const tps = (params.get('view') ?? hashParams.get('view')) !== 'top';
document.body.classList.toggle('tps', tps);
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
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
view.appendChild(renderer.domElement);

let hemiBoost = 0;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY.horizon);
// 霧：遠い所を空の地平の色に溶かす（肩越しでは遠くまで見えるので、遠くから効かせる）
scene.fog = tps ? new THREE.Fog(SKY.horizon, 45, 480) : new THREE.Fog(SKY.horizon, 32, 70);
// 日差し：西南西の低めの所から（晴れた午後。長めの影が道に落ちる）。見下ろしのときはこれまでの高さ
const SUN_OFFSET = tps ? new THREE.Vector3(-17, 12, 9) : new THREE.Vector3(-14, 18, 7);
const sky = makeSky(SUN_OFFSET);
scene.add(sky, makeHills());
const pmrem = new THREE.PMREMGenerator(renderer);
// 周囲の映り込み（空の色のやわらかい光）。画質「低」では省く（ソフトウェア描画の検証環境では描画時間が約 2 倍になった）
if (!low) {
    const env = new THREE.Scene();
    env.add(makeSky(SUN_OFFSET));
    scene.environment = pmrem.fromScene(env, 0.04, 1, 2000).texture;
    scene.environmentIntensity = 0.45;
} else {
    hemiBoost = 0.25;
}

const sun = new THREE.DirectionalLight(tps ? '#ffe2bd' : '#fff0d8', tps ? 3.4 : 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
// 影の範囲：肩越しでは前方に広く（主人公の少し先を中心に）
const S = tps ? 20 : 15;
Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 80 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
sun.shadow.radius = 3;
scene.add(sun, sun.target);
// 空と地面の照り返し：肩越しでは地面の照り返しを暖かく（土の道の色）
const hemi = tps ? new THREE.HemisphereLight('#d6dde2', '#8c7153', 0.8 + hemiBoost) : new THREE.HemisphereLight('#cfdcea', '#7a6750', 1.0 + hemiBoost);
scene.add(hemi);

const TPS_FOV = 50;
const camera = new THREE.PerspectiveCamera(tps ? TPS_FOV : CAMERA.fov, 1, tps ? 0.1 : 0.5, 2000);
/** 肩越しのカメラの向き（ドラッグで変わる）。初めは城門の方（北）を見る */
const orbit = createOrbit(START.yaw, START.pitch);

function resize(): void {
    const w = view.clientWidth || window.innerWidth;
    const h = view.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 縦に狭い画面（スマホ横向き）でも、上下の見える範囲が狭くなりすぎないよう少し引く
    camera.fov = (tps ? TPS_FOV : CAMERA.fov) * (w / h < 1.6 ? 1.12 : 1);
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
/** 移動の入力と Shift と見回しを離した扱いにする（指を離した・画面を離れた・アプリを切り替えた）。ボタンで選んだ歩く／走るはそのまま */
function releaseAll(): void {
    keys.clear();
    releaseLook();
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
/**
 * 見回し（肩越しのカメラ）：スマホは画面の右半分、PC は画面のどこでもドラッグ。
 * ボタンは見回しの面より手前にあり、押しても見回しは始まらない。スティック（左半分）とは別の指で同時に使える。
 */
const lookZone = document.getElementById('look-zone')!;
const lookPtr = { id: -1, x: 0, y: 0 };
function releaseLook(): void {
    lookPtr.id = -1;
    lookZone.classList.remove('active');
}
lookZone.addEventListener('pointerdown', (e) => {
    if (!tps || lookPtr.id !== -1) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    lookPtr.id = e.pointerId;
    lookPtr.x = e.clientX;
    lookPtr.y = e.clientY;
    lookZone.setPointerCapture(e.pointerId);
    lookZone.classList.add('active');
});
lookZone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookPtr.id) return;
    look(orbit, e.clientX - lookPtr.x, e.clientY - lookPtr.y, FOLLOW.sensitivity * (e.pointerType === 'touch' ? 1.1 : 1));
    lookPtr.x = e.clientX;
    lookPtr.y = e.clientY;
});
for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    lookZone.addEventListener(t, (e) => {
        if ((e as PointerEvent).pointerId === lookPtr.id) releaseLook();
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
    /** 歩き・走りの 1 周期で進む距離（m）。進んだ距離から再生位置を決める（足が滑らない） */
    cycle: { walk: number; run: number };
}

/**
 * 主人公の見た目（比較用に切り替えられる）。移動・当たり判定・カメラ・歩く／走るは共通で、表示と動きの素材だけを替える。
 * - v3：Blender で作り直した主人公（proto3d/blender/hero/。体・髪・衣服を別の形で作り、布の厚み・重なり・折り目を持つ）。
 *   骨組みと動き（Idle / Walk / Run）は第 2 版と同じ
 * - v2：自作の主人公モデル 第 2 版（利用者が用意した第 1 版 proto3d/assets-src/hero_v1/ を改良。proto3d/assets-src/hero_v2/）
 */
type HeroKey = 'v3' | 'v2';
// 基準速度（Walk 1.4m/秒・Run 3.0m/秒。接地した足の送りの速さを骨組みから測って一致を確認）× 1 周期の長さ。v3 は v2 と同じ動き
const cycleOf = (w: THREE.AnimationClip, r: THREE.AnimationClip) => ({ walk: 1.4 * w.duration, run: 3.0 * r.duration });
const HERO_MODELS: Record<HeroKey, { file: string; clips: [string, string, string]; cycle: (walk: THREE.AnimationClip, run: THREE.AnimationClip) => { walk: number; run: number } }> = {
    v3: { file: 'hero_v3', clips: ['Idle', 'Walk', 'Run'], cycle: cycleOf },
    v2: { file: 'hero_v2', clips: ['Idle', 'Walk', 'Run'], cycle: cycleOf },
};
const heroParam = params.get('hero') ?? new URLSearchParams(location.hash.slice(1)).get('hero');
let heroKey: HeroKey = heroParam === 'old' || heroParam === 'v2' ? 'v2' : 'v3';
const heroViews = new Map<HeroKey, HeroView>();

async function loadHeroView(key: HeroKey): Promise<HeroView> {
    const cached = heroViews.get(key);
    if (cached) return cached;
    const def = HERO_MODELS[key];
    const gltf = await load(def.file);
    prepare(gltf.scene);
    gltf.scene.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
    });
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const clip = (n: string) => {
        const c = THREE.AnimationClip.findByName(gltf.animations, n);
        if (!c) throw new Error(`動き「${n}」がありません`);
        return c;
    };
    const [idleClip, walkClip, runClip] = def.clips.map(clip);
    const idle = mixer.clipAction(idleClip);
    const walk = mixer.clipAction(walkClip);
    const run = mixer.clipAction(runClip);
    idle.play();
    // 歩き・走りは、同じ位相（stride）から再生位置を決める（自分では進めない）
    for (const a of [walk, run]) {
        a.play();
        a.timeScale = 0;
        a.setEffectiveWeight(0);
    }
    const view = { root: gltf.scene, mixer, idle, walk, run, cycle: def.cycle(walkClip, runClip) };
    heroViews.set(key, view);
    return view;
}

/** 表示する主人公を替える（位置・向き・歩きの位相はそのまま） */
function showHero(key: HeroKey, view: HeroView): void {
    if (heroView) scene.remove(heroView.root);
    heroKey = key;
    heroView = view;
    scene.add(view.root);
    heroBtn.classList.toggle('old', key === 'v2');
    heroBtn.setAttribute('aria-label', `主人公の見た目：${key === 'v2' ? '旧' : '新'}（押すと切り替え）`);
}
const heroBtn = document.getElementById('hero-btn')!;
let heroSwitching = false;
async function switchHero(key: HeroKey): Promise<void> {
    if (heroSwitching || key === heroKey) return;
    heroSwitching = true;
    heroBtn.classList.add('busy');
    try {
        showHero(key, await loadHeroView(key));
    } catch (e) {
        console.error(e);
    } finally {
        heroSwitching = false;
        heroBtn.classList.remove('busy');
    }
}
heroBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void switchHero(heroKey === 'v2' ? 'v3' : 'v2');
});
heroBtn.addEventListener('click', (e) => {
    if (e.detail === 0) void switchHero(heroKey === 'v2' ? 'v3' : 'v2');
});

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
const hero: HeroState = createHero(START.x, START.z, START.heading);

async function start(): Promise<void> {
    const t0 = performance.now();
    // 城門前の一場面（Blender で作った素材）。地面・城門・土塀・遠景の天守・町家は配置どおりの位置で作ってあるので、そのまま置く
    const [placed, [pine, sakura, pineFar], firstHero] = await Promise.all([
        Promise.all(SCENE_MODELS.map(load)),
        Promise.all(['tree_pine', 'tree_sakura', 'tree_pine_far'].map(load)),
        loadHeroView(heroKey),
    ]);
    placed.forEach((g, i) => {
        prepare(g.scene);
        scene.add(g.scene);
        // 隠れたら半透明にするのは見下ろしのときだけ（肩越しではカメラが壁の手前に来るので、建物は薄くしない）
        if (!tps && SCENE_MODELS[i] !== 'ground_v2' && SCENE_MODELS[i] !== 'keep') addOccluder(g.scene);
    });
    // 木：配置（scene.json の trees）の幹の位置へ。松は 2 本（向きと大きさを変える）
    prepare(pine.scene);
    prepare(sakura.scene);
    let pineUsed = false;
    for (const t of TREES) {
        const isPine = t.name.startsWith('pine');
        const src = isPine ? pine.scene : sakura.scene;
        const obj = isPine && pineUsed ? src.clone() : src;
        if (isPine) pineUsed = true;
        obj.position.set(t.x, 0, t.z);
        if (t.name === 'pine_back') {
            obj.rotation.y = 2.2;
            obj.scale.setScalar(0.9);
        }
        scene.add(obj);
        addOccluder(obj);
    }
    // 城内・空き地の奥の松（軽い遠景用。置き場所は trees.meta.json）
    prepare(pineFar.scene);
    for (const f of treesMeta.tree_pine_far.placements) {
        const t = pineFar.scene.clone();
        t.position.set(f.x, 0, f.z);
        t.rotation.y = f.rotation_y;
        t.scale.setScalar(f.scale);
        scene.add(t);
    }
    // 町の外側の木立（歩ける範囲の外。奥行きを出す）
    for (const [x, z, r, sc] of BACK_TREES) {
        const t = pine.scene.clone();
        t.position.set(x, 0, z);
        t.rotation.y = r;
        t.scale.setScalar(sc);
        scene.add(t);
    }
    // 草むらは影を落とさない（地面の書き出しで指定済み）
    showHero(heroKey, firstHero);
    stats.readyMs = Math.round(performance.now());
    stats.loadMs = Math.round(performance.now() - t0);
    loading.hidden = true;
    placeCamera(1);
    renderer.setAnimationLoop(frame);
}

/** 場面の素材（配置どおりの位置で作ってある） */
const SCENE_MODELS = ['ground_v2', 'gate_v2', 'walls_v2', 'keep', 'machiya_a', 'machiya_b', 'machiya_d'];
/** 町の外側の木立：[x, z, 向き, 大きさ]（歩ける範囲 BOUNDS の外。松を使い回す） */
const BACK_TREES: [number, number, number, number][] = [
    [-27, -16, 0.3, 1.1], [26, -22, 1.7, 1.2], [-26, 12, 2.6, 1.0], [27, 9, 1.1, 0.95],
];

// ---- 毎フレーム ----
const camTarget = new THREE.Vector3(hero.x, 1.0, hero.z);
const sunCenter = new THREE.Vector3();
function placeCamera(k: number, dt = 0): void {
    if (tps) {
        const pose = placeFollow(orbit, hero.x, hero.z, dt);
        camera.position.copy(pose.position);
        camera.lookAt(pose.target);
        // 壁ぎわでカメラが頭のすぐ後ろまで寄ったときは、主人公を描かない
        if (heroView) heroView.root.visible = orbit.dist > FOLLOW.hideHeroDistance;
        // 影は主人公の少し先を中心に（見える範囲の手前側）
        sunCenter.set(hero.x - Math.sin(orbit.yaw) * 8, 0, hero.z - Math.cos(orbit.yaw) * 8);
        sun.position.copy(sunCenter).add(SUN_OFFSET);
        sun.target.position.copy(sunCenter);
        return;
    }
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
/** 確認用：これまでに進めた周期の合計（1 周するごとに 0 に戻らない） */
let strideTotal = 0;
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
    stepHero(hero, ix, iy, tps ? orbit.yaw : CAMERA.yaw, dt, running());
    const v = heroView!;
    v.root.position.set(hero.x, 0, hero.z);
    v.root.rotation.y = hero.heading;
    // 待機と動きを速さで混ぜ、動きの中では歩きと走りを速さで混ぜる
    const want = THREE.MathUtils.smoothstep(hero.speed, 0.05, 0.5);
    walkBlend += (want - walkBlend) * (1 - Math.exp(-10 * dt));
    runBlend = THREE.MathUtils.smoothstep(hero.speed, SPEED.walk * 1.02, SPEED.walk + (SPEED.run - SPEED.walk) * 0.7);
    // 位相は実際に進んだ速さで進める（1 周期の距離は歩きと走りを混ぜた長さ）。止まれば脚も止まり、滑らない
    const cycle = THREE.MathUtils.lerp(v.cycle.walk, v.cycle.run, runBlend);
    strideTotal += (hero.speed * dt) / cycle;
    stride = (stride + (hero.speed * dt) / cycle) % 1;
    v.walk.time = stride * v.walk.getClip().duration;
    v.run.time = stride * v.run.getClip().duration;
    v.walk.setEffectiveWeight(walkBlend * (1 - runBlend));
    v.run.setEffectiveWeight(walkBlend * runBlend);
    v.idle.setEffectiveWeight(1 - walkBlend);
    v.mixer.update(dt);
    placeCamera(1 - Math.exp(-6 * dt), dt);
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
            get anim() { return { walkBlend, runBlend, stride, strideTotal, walkTime: heroView?.walk.time ?? 0, running: running(), runMode }; },
            get heroModel() { return heroKey; },
            orbit, tps,
            get lookActive() { return lookPtr.id !== -1; },
            look(dx: number, dy: number) { look(orbit, dx, dy); },
            /** 確認用：カメラが壁・屋根・柱などの箱（広げていない形）の中にあるか */
            cameraInside() {
                const p = camera.position;
                return cameraBlockers().some((b) => p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1 && p.z > b.z0 && p.z < b.z1);
            },
            switchHero,
            get fade() { return occluders.map((o) => Math.round(o.alpha * 100) / 100); },
            /** 録画用：自動の更新を止め、step で 1 コマずつ進める */
            manual() { renderer.setAnimationLoop(null); },
            step(dt: number, ix: number, iy: number) { advance(dt, dt, ix, iy); },
            /** 確認用：実際のキー・スティックの入力のまま、決まった時間だけ進める */
            stepInput(dt: number) { advance(dt, dt, ...readInput()); },
        },
    });
}
