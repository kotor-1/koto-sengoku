/**
 * 木（黒松と広葉樹）と草むら。
 * - 幹・枝は太さの変わる管（樹皮の模様）。
 * - 葉は「葉の絵を貼った小さな板」を塊の形に沿って多数並べ、奥に暗い芯を置いて透けすぎないようにする。
 *   板の法線は塊の中心から外向きにそろえ、塊全体がやわらかく陰るようにする。
 */
import * as THREE from 'three';
import { Builder, normalize, place, taperTube, twoSided, type Geo } from './geo';
import { materials } from './materials';
import { fbm, rng } from './tex';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** 塊の表面に葉の板を並べる。flat が大きいほど上下につぶれた形（松の枝先の「段」） */
function foliage(b: Builder, center: THREE.Vector3, radius: [number, number, number], count: number, card: number, mat: THREE.Material, core: THREE.Material, seed: number, flat: number): void {
    const r = rng(seed);
    // 芯：ゆがませた楕円体
    const coreGeo = new THREE.IcosahedronGeometry(1, 2);
    const p = coreGeo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
        const v = V(p.getX(i), p.getY(i), p.getZ(i));
        const n = 0.8 + fbm(v.x * 0.3 + 0.5, v.z * 0.3 + 0.5 + v.y * 0.1, 4, 2, seed) * 0.35;
        p.setXYZ(i, v.x * radius[0] * 0.82 * n, v.y * radius[1] * 0.8 * n, v.z * radius[2] * 0.82 * n);
    }
    coreGeo.computeVertexNormals();
    const cg = normalize(coreGeo);
    cg.translate(center.x, center.y, center.z);
    // 下側は暗く
    const cc = cg.getAttribute('color');
    const cp = cg.getAttribute('position');
    for (let i = 0; i < cp.count; i++) {
        const k = 0.55 + 0.45 * Math.min(1, Math.max(0, (cp.getY(i) - center.y) / radius[1] + 0.6));
        cc.setXYZ(i, k, k, k);
    }
    b.add(core, cg);
    // 葉の板
    const cards: Geo[] = [];
    for (let i = 0; i < count; i++) {
        // 上半分を多めに
        const theta = r() * Math.PI * 2;
        const phi = Math.acos(1 - r() * (flat > 0.5 ? 1.2 : 1.8));
        const dir = V(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
        const pos = V(dir.x * radius[0], dir.y * radius[1], dir.z * radius[2]).multiplyScalar(0.8 + r() * 0.3).add(center);
        const size = card * (0.75 + r() * 0.5);
        const g = new THREE.PlaneGeometry(size, size);
        // 板の向き：塊の外を向きつつ、上向きに寄せる（上から見る視点で葉が見える）
        const face = dir.clone().lerp(V(0, 1, 0), flat).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), face);
        const spin = new THREE.Quaternion().setFromAxisAngle(face, r() * Math.PI * 2);
        g.applyQuaternion(q.premultiply(spin));
        g.translate(pos.x, pos.y, pos.z);
        // 法線を外向きに
        const nrm = g.getAttribute('normal');
        const out = pos.clone().sub(center).normalize().lerp(V(0, 1, 0), 0.35).normalize();
        for (let k = 0; k < nrm.count; k++) nrm.setXYZ(k, out.x, out.y, out.z);
        const ng = normalize(g);
        const col = ng.getAttribute('color');
        const lit = 0.7 + 0.3 * Math.max(0, dir.y) + (r() - 0.5) * 0.15;
        for (let k = 0; k < col.count; k++) col.setXYZ(k, lit, lit, lit);
        cards.push(twoSided(ng));
    }
    b.add(mat, ...cards);
}

export function buildPine(): THREE.Group {
    const m = materials();
    const b = new Builder();
    const r = rng(21);
    // 幹：根元が太く、少し傾いてねじれながら立つ
    const trunk = [V(0, -0.2, 0), V(0.15, 1.2, 0.05), V(0.55, 2.4, -0.1), V(0.4, 3.6, -0.25), V(0.0, 4.6, -0.2), V(-0.2, 5.3, 0)];
    b.add(m.bark, taperTube(trunk, [0.34, 0.27, 0.22, 0.17, 0.12, 0.08], 10, 1.2));
    // 根の張り出し
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        b.add(m.bark, taperTube([V(0, 0.35, 0), V(Math.cos(a) * 0.45, 0.05, Math.sin(a) * 0.45), V(Math.cos(a) * 0.75, -0.08, Math.sin(a) * 0.75)], [0.16, 0.09, 0.03], 6, 1.2));
    }
    // 枝と、枝先の葉の段
    const branches: { from: THREE.Vector3; to: THREE.Vector3; pad: [number, number, number] }[] = [
        { from: V(0.35, 2.0, -0.02), to: V(2.4, 2.35, 0.9), pad: [1.5, 0.38, 1.2] },
        { from: V(0.5, 2.8, -0.15), to: V(-1.9, 3.1, 0.6), pad: [1.4, 0.36, 1.1] },
        { from: V(0.45, 3.5, -0.25), to: V(1.6, 3.9, -1.5), pad: [1.3, 0.34, 1.05] },
        { from: V(0.1, 4.3, -0.2), to: V(-1.2, 4.6, -1.0), pad: [1.1, 0.32, 0.95] },
        { from: V(-0.1, 5.0, -0.1), to: V(0.6, 5.5, 0.4), pad: [1.1, 0.36, 1.0] },
    ];
    branches.forEach((br, i) => {
        const mid = br.from.clone().lerp(br.to, 0.5).add(V((r() - 0.5) * 0.3, 0.25, (r() - 0.5) * 0.3));
        b.add(m.bark, taperTube([br.from, mid, br.to], [0.11, 0.07, 0.04], 7, 1.5));
        foliage(b, br.to.clone().add(V(0, 0.12, 0)), br.pad, 95, 0.5, m.pineNeedles, m.pineCore, 300 + i, 0.85);
    });
    return b.build('松');
}

export function buildBroadleaf(): THREE.Group {
    const m = materials();
    const b = new Builder();
    const trunk = [V(0, -0.2, 0), V(0.05, 1.5, 0.05), V(-0.1, 2.8, 0.0)];
    b.add(m.bark, taperTube(trunk, [0.28, 0.22, 0.17], 9, 1.2));
    const tips = [V(1.3, 4.3, 0.4), V(-1.2, 4.5, 0.3), V(0.1, 4.8, -1.2), V(0.2, 5.4, 0.6)];
    tips.forEach((t, i) => {
        b.add(m.bark, taperTube([V(-0.1, 2.7, 0), V(t.x * 0.5, 3.6, t.z * 0.5), t], [0.14, 0.09, 0.05], 7, 1.4));
        foliage(b, t, [1.5, 1.2, 1.5], 110, 0.75, m.leaves, m.leafCore, 500 + i, 0.3);
    });
    foliage(b, V(0, 4.3, 0), [1.8, 1.3, 1.8], 90, 0.8, m.leaves, m.leafCore, 600, 0.3);
    return b.build('広葉樹');
}

/** 草むら 1 つ：3 枚の板を交差させる */
export function grassTuft(b: Builder, x: number, z: number, s: number, rot: number): void {
    const m = materials();
    for (let i = 0; i < 3; i++) {
        const g = new THREE.PlaneGeometry(0.7 * s, 0.34 * s);
        g.translate(0, 0.17 * s, 0);
        const ng = place(normalize(g), [x, 0, z], [0, rot + (i * Math.PI) / 3, 0]);
        const n = ng.getAttribute('normal');
        for (let k = 0; k < n.count; k++) n.setXYZ(k, 0, 1, 0);
        b.add(m.grassCard, twoSided(ng));
    }
}
