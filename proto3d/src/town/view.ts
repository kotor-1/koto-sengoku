/**
 * 小さな城下町の描画（three）。配置は town/plan.ts（純粋）。main.ts が場面の素材を読み終えた後に 1 回だけ作る。
 * - 町家の写し：読み込み済みの町家の素材を複製して置く（形・素材は元と共有。新しい素材は読み込まない）。
 * - 小物：箱・円柱・円すいを、場所（まとまり）×材質ごとに 1 つの形へまとめる（描く回数を増やしすぎない。見えないまとまりは three が描かない）。
 * - のぼり：旗の一文字の画像（shared/figures.ts。合戦と同じ描き方）。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeMarkBannerTexture } from '../shared/figures';
import { groundY } from '../layout';
import { MACHIYA_COPIES, TOWN_BANNERS, TOWN_PROPS, type Piece, type TownCluster, type TownMat, type TownProp } from './plan';

/** 小物の材質（色だけ。画像は陣幕の縞だけ：コードで描く） */
function makeMaterials(): Record<TownMat, THREE.Material> {
    const std = (color: string, roughness = 0.88, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
    return {
        wood: std('#5a4430'),
        plank: std('#5f4733'),
        straw: std('#9c8656', 0.95),
        mat: std('#7d6f4c', 0.97),
        basket: std('#86693f', 0.92, { side: THREE.DoubleSide }),
        cloth: std('#ffffff', 0.9, { map: makeCurtainTexture() }),
        metal: std('#cfd2d4', 0.45, { metalness: 0.6 }),
        paper: std('#d8cfb6', 0.95),
        roof: std('#4a4038', 0.9),
        dark: std('#2a2420', 0.95),
    };
}

/** 陣幕の布の画像：白地に黒の横縞 2 本（紋は描かない） */
function makeCurtainTexture(): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 64;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#e9e4d8';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#1c1a18';
    g.fillRect(0, 14, 64, 9);
    g.fillRect(0, 41, 64, 9);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

const tmpM = new THREE.Matrix4();
const tmpE = new THREE.Euler();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

function pieceGeometry(p: Piece): THREE.BufferGeometry {
    const s = p.size;
    switch (p.shape) {
        case 'box':
            return new THREE.BoxGeometry(s[0], s[1], s[2]);
        case 'cyl':
            return new THREE.CylinderGeometry(s[0], s[1], s[2], s[3] ?? 10, 1, !!p.open);
        case 'cone':
            return new THREE.ConeGeometry(s[0], s[1], s[2] ?? 8);
    }
}

/** 小物の部品を、置いた位置（地面の高さを足す）のゲームの座標の形にする */
function placedPiece(prop: TownProp, p: Piece, gy: number): THREE.BufferGeometry {
    const g = pieceGeometry(p);
    const r = p.rot ?? [0, 0, 0];
    tmpE.set(r[0], r[1], r[2], 'XYZ');
    tmpQ.setFromEuler(tmpE);
    tmpP.set(p.pos[0], p.pos[1], p.pos[2]);
    g.applyMatrix4(tmpM.compose(tmpP, tmpQ, ONE));
    tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), prop.rotY);
    tmpP.set(prop.x, gy, prop.z);
    g.applyMatrix4(tmpM.compose(tmpP, tmpQ, ONE));
    return g;
}

export interface TownView {
    /** 町に足した物の根（町家の写し・小物・のぼり） */
    root: THREE.Group;
    /** まとまりごとの形（塀の陰で見えないまとまりを描かない：updateTownView） */
    clusters: Map<TownCluster, THREE.Object3D[]>;
    /** 影を落とす形と、その形と影の届く所を囲む球（画面に入らない形は影の描画を省く：updateTownView） */
    casters: { meshes: THREE.Mesh[]; sphere: THREE.Sphere }[];
    /** 町家の写し（見下ろしのときに半透明にする対象） */
    copies: THREE.Object3D[];
    /** 画質「低」（小物は影を落とさない。町家の写しは元と同じく落とす） */
    lowShadows: boolean;
    /** 確かめ用：まとめた形の数と三角形の数 */
    stats: { meshes: number; triangles: number; copies: number };
}

/** 物見櫓の屋根と柱を描く／描かない（物見の眺めの間は目の前をふさがないように描かない） */
export function setTowerTopVisible(scene: THREE.Object3D, visible: boolean): void {
    towerTopHidden = !visible;
    scene.traverse((o) => {
        if (o.name.startsWith('town:towertop:')) o.visible = visible;
    });
}
let towerTopHidden = false;

/**
 * まとまりが今のカメラから見えうるか（塀の陰の大まかな決まり。画面の外は three が別に描かない）。
 * - 軍議所（城内）：カメラが城内（塀の北）か、高い所（物見櫓の上）にあるときだけ。町から見ると土塀（高さ 3.7 m）の陰
 * - 詰所（東の囲い）：カメラが囲いの中・町家 D より南・高い所にあるときだけ。通りからは東の土塀の陰
 * - 南の物（木戸・櫓・荷置き場・柵）：カメラが城内の奥（塀より北）にいなければ
 */
export function clusterMayShow(c: TownCluster, cam: { x: number; y: number; z: number }): boolean {
    const high = cam.y > 5;
    switch (c) {
        case 'council':
            return cam.z < -11.3 || high;
        case 'guardpost':
            return cam.x > 7.0 || cam.z > 3.0 || high;
        case 'towertop':
            return !towerTopHidden;
        default:
            return cam.z > -12.7 || high;
    }
}

/** 影の落ちる向き（地面の上。日は南南西の上：main.ts の SUN_OFFSET の反対） */
const SHADOW_DIR = new THREE.Vector3(5, 0, -16).normalize();
const frustum = new THREE.Frustum();
const pv = new THREE.Matrix4();

/**
 * 毎フレーム、描く前：塀の陰で見えないまとまりを描かない。形も影も画面に入らない物は、影の描画も省く
 * （影の範囲は主人公の前後に広いので、背中側の町家の写しの影も描いていた）。
 */
export function updateTownView(view: TownView, camera: THREE.Camera): void {
    const p = camera.position;
    for (const [c, list] of view.clusters) {
        const v = clusterMayShow(c, p);
        for (const o of list) if (o.visible !== v) o.visible = v;
    }
    camera.updateMatrixWorld();
    pv.multiplyMatrices((camera as THREE.PerspectiveCamera).projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    for (const c of view.casters) {
        const cast = !view.lowShadows && frustum.intersectsSphere(c.sphere);
        for (const m of c.meshes) if (m.castShadow !== cast) m.castShadow = cast;
    }
}

/**
 * 町に足した物を作る。models は読み込み済みの場面の素材（名前 → 根。町家の写しの元）。
 * prepare は素材の影・異方性の設定（main.ts の prepare と同じ）。
 */
export function buildTown(models: ReadonlyMap<string, THREE.Object3D>, prepare: (o: THREE.Object3D) => void, low: boolean): TownView {
    const root = new THREE.Group();
    root.name = 'town';
    const copies: THREE.Object3D[] = [];
    // ---- 町家の写し（元と同じ形・素材を共有。z = c の面で鏡に写す：three は鏡の裏返しを自動で直す）
    for (const cp of MACHIYA_COPIES) {
        const src = models.get(cp.source);
        if (!src) continue;
        const c = src.clone(true);
        c.name = `${cp.source}_copy`;
        c.scale.z = -1;
        c.position.z = 2 * cp.mirrorZ;
        prepare(c);
        c.updateMatrixWorld(true);
        root.add(c);
        copies.push(c);
    }
    // ---- 小物：まとまり × 材質ごとに 1 つの形へ
    const mats = makeMaterials();
    const buckets = new Map<string, { cluster: TownCluster; mat: TownMat; geos: THREE.BufferGeometry[] }>();
    for (const prop of TOWN_PROPS) {
        const gy = groundY(prop.x, prop.z);
        for (const p of prop.pieces) {
            const key = `${prop.cluster}:${p.mat}`;
            let b = buckets.get(key);
            if (!b) buckets.set(key, (b = { cluster: prop.cluster, mat: p.mat, geos: [] }));
            // 散らばった小物（籠・床几）は部品ごとに地面の高さを取る
            const local = prop.x === 0 && prop.z === 0 ? groundY(p.pos[0], p.pos[2]) : gy;
            b.geos.push(placedPiece(prop, p, local));
        }
    }
    let triangles = 0;
    let meshes = 0;
    const clusters = new Map<TownCluster, THREE.Object3D[]>();
    const addTo = (c: TownCluster, o: THREE.Object3D) => {
        const list = clusters.get(c) ?? [];
        list.push(o);
        clusters.set(c, list);
    };
    for (const b of buckets.values()) {
        const g = mergeGeometries(b.geos);
        for (const x of b.geos) x.dispose();
        if (!g) continue;
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, mats[b.mat]);
        m.name = `town:${b.cluster}:${b.mat}`;
        m.castShadow = !low;
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        m.updateMatrix();
        root.add(m);
        addTo(b.cluster, m);
        meshes++;
        triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
    // ---- のぼり（竿と布）
    const poleMat = mats.wood;
    const bannerMats = new Map<string, THREE.Material>();
    for (const bn of TOWN_BANNERS) {
        let bm = bannerMats.get(bn.mark);
        if (!bm) {
            const tex = makeMarkBannerTexture(bn.mark);
            bannerMats.set(bn.mark, (bm = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 })));
        }
        const gy = groundY(bn.x, bn.z);
        const g = new THREE.Group();
        g.name = `town:banner:${bn.mark}`;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, bn.height, 6), poleMat);
        pole.position.y = bn.height / 2;
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 1.55), bm);
        cloth.position.set(0.34, bn.height - 0.95, 0);
        // 上の横棒
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.035, 0.035), poleMat);
        bar.position.set(0.34, bn.height - 0.16, 0);
        for (const o of [pole, cloth, bar]) {
            o.castShadow = !low;
            o.receiveShadow = true;
            g.add(o);
        }
        g.position.set(bn.x, gy, bn.z);
        g.rotation.y = bn.rotY;
        root.add(g);
        addTo(bn.cluster, g);
        meshes += 3;
        triangles += 12 + 2 + 12 + 24;
    }
    root.updateMatrixWorld(true);
    // 影を落とす形ごとに、形と影の届く所を囲む球（影は日の反対へ、高さの 1.4 倍ほどまで伸びる）
    const casters: TownView['casters'] = [];
    const addCaster = (o: THREE.Object3D) => {
        const meshes: THREE.Mesh[] = [];
        o.traverse((x) => {
            if ((x as THREE.Mesh).isMesh && (x as THREE.Mesh).castShadow) meshes.push(x as THREE.Mesh);
        });
        if (!meshes.length) return;
        const box = new THREE.Box3().setFromObject(o);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const reach = Math.max(1, box.max.y) * 1.4;
        sphere.center.x += SHADOW_DIR.x * reach * 0.5;
        sphere.center.z += SHADOW_DIR.z * reach * 0.5;
        sphere.radius += reach * 0.5 + 1;
        casters.push({ meshes, sphere });
    };
    for (const c of copies) addCaster(c);
    for (const list of clusters.values()) for (const o of list) addCaster(o);
    return { root, clusters, casters, copies, lowShadows: false, stats: { meshes, triangles: Math.round(triangles), copies: copies.length } };
}
