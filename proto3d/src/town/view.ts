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
    /** 町家の写し（見下ろしのときに半透明にする対象） */
    copies: THREE.Object3D[];
    /** 確かめ用：まとめた形の数と三角形の数 */
    stats: { meshes: number; triangles: number; copies: number };
}

/** 物見櫓の屋根と柱を描く／描かない（物見の眺めの間は目の前をふさがないように描かない） */
export function setTowerTopVisible(scene: THREE.Object3D, visible: boolean): void {
    scene.traverse((o) => {
        if (o.name.startsWith('town:towertop:')) o.visible = visible;
    });
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
        meshes += 3;
        triangles += 12 + 2 + 12 + 24;
    }
    root.updateMatrixWorld(true);
    return { root, copies, stats: { meshes, triangles: Math.round(triangles), copies: copies.length } };
}
