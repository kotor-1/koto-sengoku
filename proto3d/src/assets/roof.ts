/**
 * 瓦屋根（切妻・片流れ）。形として作る：
 * - 屋根面は軒へ向かってゆるく反る（中ほどが弦より下がる凹んだ曲線）。
 * - 丸瓦の列を 1 本ずつ半円筒で屋根面に沿わせ、軒先には瓦当（丸い面）を付ける。平瓦は屋根面の模様。
 * - 大棟は熨斗瓦を段に積み、冠瓦をのせ、両端に鬼瓦。
 * - 切妻の端には破風板と懸魚。
 * 座標：棟は x 方向、屋根は ±z へ下る。棟の中心が原点（あとで place で動かす）。
 */
import * as THREE from 'three';
import { Builder, box, normalize, place, roundBox, shade, type Geo } from './geo';
import { materials } from './materials';

export interface RoofSpec {
    /** 棟の長さ（x、けらばの出を含む） */
    len: number;
    /** 棟から軒までの水平距離 */
    run: number;
    /** 棟から軒までの高さの差 */
    rise: number;
    /** 両側に下る（切妻）か、+z だけ（片流れ・庇） */
    both: boolean;
    /** 丸瓦の間隔 */
    spacing?: number;
    ridge?: boolean;
    barge?: boolean;
    /** 屋根の厚み（軒先で見える） */
    thick?: number;
}

/** 屋根の断面：t=0 棟、t=1 軒。反りは c で決める。 */
function profile(s: RoofSpec, t: number): { y: number; z: number; dy: number; dz: number } {
    const c = s.rise * 0.2;
    const y = -s.rise * t - c * t * (1 - t);
    const dy = -s.rise - c * (1 - 2 * t);
    return { y, z: s.run * t, dy, dz: s.run };
}

export function roof(b: Builder, s: RoofSpec, at: [number, number, number], rotY = 0): void {
    const m = materials();
    const sides = s.both ? [1, -1] : [1];
    const spacing = s.spacing ?? 0.27;
    const thick = s.thick ?? 0.14;
    const out = (g: Geo) => place(g, at, [0, rotY, 0]);
    const T = s.run > 1 ? 12 : 6; // 屋根の断面の分割（小さい屋根は粗く）
    const half = s.len / 2;

    for (const side of sides) {
        // ---- 屋根面（上面：平瓦の模様、下面：軒裏、前面：軒の厚み） ----
        const top = grid(2, T, (u, t) => {
            const p = profile(s, t);
            return [(u - 0.5) * s.len, p.y, p.z * side];
        }, (u, _t, arc) => [((u - 0.5) * s.len) / (2 * spacing), arc / (4 * 0.21)], side < 0);
        b.add(m.roof, out(top));
        const under = grid(2, T, (u, t) => {
            const p = profile(s, t);
            return [(u - 0.5) * s.len, p.y - thick, p.z * side];
        }, (u, _t, arc) => [(u - 0.5) * s.len * 2, arc * 2], side > 0);
        b.add(m.wood, out(shade(under, () => 0.55)));
        // 軒裏の垂木：軒先から屋根の奥へ、一定の間隔で並ぶ細い角材（下から見える所）
        const rafterGap = s.run > 1 ? 0.33 : 0.3;
        const nr = Math.floor(s.len / rafterGap);
        const ta = 0.25;
        const pa = profile(s, ta);
        const pb = profile(s, 1);
        const ya = pa.y - thick - 0.035;
        const yb = pb.y - thick - 0.035;
        const za = pa.z;
        const zb = pb.z + 0.02;
        const rl = Math.hypot(zb - za, yb - ya);
        const slope = Math.atan2(ya - yb, zb - za);
        for (let i = 0; i < nr; i++) {
            const x = -((nr - 1) * rafterGap) / 2 + i * rafterGap;
            b.add(m.wood, out(shade(place(box(0.055, 0.065, rl, 3), [x, (ya + yb) / 2, ((za + zb) / 2) * side], [slope * side, 0, 0]), () => 0.62)));
        }
        // 軒先の厚み（茅負）と軒平瓦の並び
        const e = profile(s, 1);
        b.add(m.wood, out(place(box(s.len, thick, 0.06, 2), [0, e.y - thick / 2, (e.z + 0.02) * side])));
        b.add(m.roofTileRound, out(place(box(s.len + 0.02, 0.05, 0.1), [0, e.y + 0.01, (e.z + 0.03) * side], [0.25 * side, 0, 0])));
        // けらば（屋根の両端）の厚み
        for (const x of [-half, half]) {
            const edge = grid(1, T, (u, t) => {
                const p = profile(s, t);
                return [x, p.y - u * thick, p.z * side];
            }, (u, _t, arc) => [u, arc], (x > 0) !== (side < 0));
            b.add(m.wood, out(edge));
        }

        // ---- 丸瓦の列 ----
        const cols = Math.floor(s.len / spacing);
        const x0 = -((cols - 1) * spacing) / 2;
        const rr = spacing * 0.28;
        for (let i = 0; i < cols; i++) {
            const x = x0 + i * spacing;
            b.add(m.roofTileRound, out(coverRow(s, x, rr, side, T)));
            // 瓦当（軒先の丸い面）
            const tip = profile(s, 1.0);
            const n = new THREE.Vector3(0, tip.dz * side, -tip.dy).normalize();
            if (n.y < 0) n.negate();
            const face = new THREE.CylinderGeometry(rr * 1.08, rr * 1.08, 0.03, 8);
            face.rotateX(Math.PI / 2);
            b.add(m.roofTileRound, out(place(normalize(face), [x, tip.y + n.y * rr * 0.3, (tip.z + 0.06) * side], [-0.2 * side, 0, 0])));
        }
    }

    // ---- 大棟 ----
    if (s.ridge !== false) {
        if (s.both) {
            const layers = [
                { w: 0.34, h: 0.08 },
                { w: 0.3, h: 0.06 },
                { w: 0.27, h: 0.06 },
                { w: 0.24, h: 0.06 },
            ];
            let y = -0.02;
            for (const l of layers) {
                b.add(m.roofTileRound, out(shade(place(box(s.len - 0.1, l.h, l.w, 3), [0, y + l.h / 2, 0]), (_x, yy) => 0.8 + (yy - y) * 1.5)));
                y += l.h;
            }
            const cap = new THREE.CylinderGeometry(0.1, 0.1, s.len - 0.12, 12, 1, false, 0, Math.PI);
            cap.rotateZ(Math.PI / 2);
            cap.rotateX(-Math.PI / 2);
            b.add(m.roofTileRound, out(place(normalize(cap), [0, y, 0])));
            // 鬼瓦
            for (const x of [-(half - 0.12), half - 0.12]) {
                b.add(m.roofTileRound, out(onigawara(x, y)));
            }
        } else {
            // 片流れ：壁に取り付く水切り
            b.add(m.roofTileRound, out(place(box(s.len, 0.08, 0.16), [0, 0.02, -0.04])));
        }
    }

    // ---- 破風板と懸魚（切妻の端） ----
    if (s.barge !== false && s.both) {
        for (const x of [-half - 0.03, half + 0.03]) {
            for (const side of [1, -1]) {
                const board = grid(1, T, (u, t) => {
                    const p = profile(s, t);
                    return [x, p.y + 0.03 - u * 0.3, p.z * side];
                }, (u, _t, arc) => [u * 0.3 * 2, arc * 2], (x > 0) !== (side < 0));
                b.add(m.wood, out(board));
                // 裏面
                const back = grid(1, T, (u, t) => {
                    const p = profile(s, t);
                    return [x - Math.sign(x) * 0.05, p.y + 0.03 - u * 0.3, p.z * side];
                }, (u, _t, arc) => [u * 0.6, arc * 2], (x > 0) === (side < 0));
                b.add(m.wood, out(back));
            }
            // 懸魚：棟の下に下がる飾り板
            const g = new THREE.Shape();
            g.moveTo(0, 0);
            g.quadraticCurveTo(0.22, -0.05, 0.16, -0.32);
            g.quadraticCurveTo(0.05, -0.25, 0, -0.42);
            g.quadraticCurveTo(-0.05, -0.25, -0.16, -0.32);
            g.quadraticCurveTo(-0.22, -0.05, 0, 0);
            const ex = new THREE.ExtrudeGeometry(g, { depth: 0.04, bevelEnabled: false });
            ex.rotateY(Math.PI / 2);
            b.add(m.wood, out(place(normalize(ex), [x - Math.sign(x) * 0.04, -0.2, 0])));
        }
    }
}

/**
 * 格子状の面。f(u,t) で位置、uvf(u,t,arc) で UV（arc は t 方向の長さ）。flip で表裏を逆にする。
 */
function grid(
    nu: number,
    nt: number,
    f: (u: number, t: number) => [number, number, number],
    uvf: (u: number, t: number, arc: number) => [number, number],
    flip: boolean,
): Geo {
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    const arcs: number[] = [0];
    for (let j = 1; j <= nt; j++) {
        const a = f(0, (j - 1) / nt);
        const bb = f(0, j / nt);
        arcs.push(arcs[j - 1] + Math.hypot(bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]));
    }
    for (let j = 0; j <= nt; j++) {
        for (let i = 0; i <= nu; i++) {
            const u = i / nu;
            const t = j / nt;
            pos.push(...f(u, t));
            uvs.push(...uvf(u, t, arcs[j]));
        }
    }
    const row = nu + 1;
    for (let j = 0; j < nt; j++) {
        for (let i = 0; i < nu; i++) {
            const a = j * row + i;
            const c = a + row;
            if (flip) idx.push(a, a + 1, c, c, a + 1, c + 1);
            else idx.push(a, c, a + 1, c, c + 1, a + 1);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return normalize(g);
}

/** 丸瓦 1 列：屋根面に沿った半円筒 */
function coverRow(s: RoofSpec, x: number, r: number, side: number, T: number): Geo {
    const K = 5;
    const pos: number[] = [];
    const idx: number[] = [];
    const uvs: number[] = [];
    const t0 = 0.03;
    for (let j = 0; j <= T; j++) {
        const t = t0 + (1 - t0) * (j / T) + (j === T ? 0.02 : 0);
        const p = profile(s, t);
        const n = new THREE.Vector3(0, p.dz * side, -p.dy);
        n.normalize();
        if (n.y < 0) n.negate();
        for (let k = 0; k <= K; k++) {
            const a = (k / K) * Math.PI;
            const ox = Math.cos(a) * r;
            const on = Math.sin(a) * r * 0.9;
            pos.push(x + ox, p.y + n.y * on, p.z * side + n.z * on);
            uvs.push(k / K, j / T * 4);
        }
    }
    const row = K + 1;
    for (let j = 0; j < T; j++) {
        for (let k = 0; k < K; k++) {
            const a = j * row + k;
            const c = a + row;
            if (side > 0) idx.push(a, c, a + 1, c, c + 1, a + 1);
            else idx.push(a, a + 1, c, c, a + 1, c + 1);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // 瓦の継ぎ目の陰（一定の間隔で少し暗く）
    return shade(normalize(g), (_x, y) => 0.88 + 0.12 * Math.abs(Math.sin(y * 18)));
}

/** 鬼瓦：棟の端に立つ厚い板（上が丸く張り出す） */
function onigawara(x: number, y: number): Geo {
    const g = new THREE.Shape();
    g.moveTo(-0.24, -0.34);
    g.lineTo(-0.2, 0.02);
    g.quadraticCurveTo(-0.26, 0.2, -0.12, 0.26);
    g.quadraticCurveTo(0, 0.34, 0.12, 0.26);
    g.quadraticCurveTo(0.26, 0.2, 0.2, 0.02);
    g.lineTo(0.24, -0.34);
    g.lineTo(-0.24, -0.34);
    const ex = new THREE.ExtrudeGeometry(g, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
    ex.translate(0, 0, -0.07);
    ex.rotateY(Math.PI / 2);
    const out = place(normalize(ex), [x, y + 0.08, 0]);
    // 中央の丸い飾り
    const boss = roundBox(0.06, 0.14, 0.14, 0.05);
    return mergeTwo(out, place(boss, [x + Math.sign(x) * 0.1, y + 0.1, 0]));
}

function mergeTwo(a: Geo, b: Geo): Geo {
    const bb = new Builder();
    const tmp = new THREE.MeshBasicMaterial();
    bb.add(tmp, a, b);
    const g = (bb.build('tmp').children[0] as THREE.Mesh).geometry;
    return g;
}
