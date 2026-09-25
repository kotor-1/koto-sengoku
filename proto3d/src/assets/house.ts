/**
 * 町家 1 軒（道に面した平入り、つし二階）。
 * - 1 階：表は弁柄の格子と、暖簾の下がる入口。格子の前に犬矢来（竹を曲げた囲い）。
 * - 2 階：低い漆喰の壁に虫籠窓（漆喰の縦の桟）。
 * - 柱・梁を見せる真壁、側面の腰板、表の庇、切妻の瓦屋根。
 * 表（道の側）は +x を向く。
 */
import * as THREE from 'three';
import { HOUSE } from '../layout';
import { Builder, box, place, quad, roundBox, shade, taperTube } from './geo';
import { materials } from './materials';
import { roof } from './roof';

const FLOOR1 = 3.25;
const EAVE = 4.8;
const SILL = 0.25;

export function buildHouse(): THREE.Group {
    const m = materials();
    const b = new Builder();
    const { x0, x1, z0, z1 } = HOUSE;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const W = x1 - x0; // 奥行き（x）
    const L = z1 - z0; // 間口（z）
    const ao = (_x: number, y: number) => Math.min(1, 0.55 + y * 0.35) * (y > FLOOR1 - 0.4 && y < FLOOR1 ? 0.8 : 1);

    // ---- 基礎の石（地覆石） ----
    b.add(m.stone, shade(place(box(W + 0.1, SILL, L + 0.1, 1.2), [cx, SILL / 2, cz]), (_x, y) => 0.55 + y * 1.6));

    // ---- 柱 ----
    const bayZ = [0, 1, 2, 3, 4].map((i) => z0 + (L / 4) * i);
    const sideX = [x0, x0 + W / 3, x0 + (2 * W) / 3, x1];
    const post = (x: number, z: number) => b.add(m.wood, shade(place(box(0.17, EAVE - SILL, 0.17, 1.5), [x, SILL + (EAVE - SILL) / 2, z]), ao));
    for (const z of bayZ) {
        post(x1, z);
        post(x0, z);
    }
    for (const x of sideX.slice(1, -1)) {
        post(x, z0);
        post(x, z1);
    }
    // ---- 梁（胴差・軒桁） ----
    for (const y of [FLOOR1, EAVE]) {
        for (const x of [x0, x1]) b.add(m.wood, place(box(0.2, 0.22, L + 0.12, 1.5), [x, y, cz]));
        for (const z of [z0, z1]) b.add(m.wood, place(box(W + 0.12, 0.22, 0.2, 1.5), [cx, y, z]));
    }

    // ---- 表 1 階：格子と入口 ----
    for (let i = 0; i < 4; i++) {
        const za = bayZ[i] + 0.09;
        const zb = bayZ[i + 1] - 0.09;
        const bw = zb - za;
        const bz = (za + zb) / 2;
        if (i === 1) {
            // 入口：奥は暗く、上に暖簾
            b.add(m.dark, place(quad(bw, FLOOR1 - SILL - 0.1), [x1 - 0.45, SILL + (FLOOR1 - SILL) / 2, bz], [0, Math.PI / 2, 0]));
            for (const s of [-1, 1]) b.add(m.wood, place(box(0.5, FLOOR1 - SILL, 0.05), [x1 - 0.22, SILL + (FLOOR1 - SILL) / 2, bz + s * (bw / 2 - 0.02)]));
            b.add(m.stone, shade(place(roundBox(0.7, 0.14, bw * 0.8, 0.04), [x1 + 0.4, 0.07, bz]), () => 0.8));
            // 暖簾：3 枚、少し揺れた形
            const cloth = new THREE.PlaneGeometry(bw * 0.92, 1.05, 12, 4);
            const p = cloth.getAttribute('position');
            for (let k = 0; k < p.count; k++) {
                const x = p.getX(k);
                const y = p.getY(k);
                const drop = (0.5 - y / 1.05) ;
                p.setZ(k, Math.sin(x * 9) * 0.015 * drop + drop * 0.04);
            }
            cloth.computeVertexNormals();
            b.add(m.noren, place(cloth, [x1 + 0.08, FLOOR1 - 0.62, bz], [0, Math.PI / 2, 0]));
            b.add(m.wood, place(box(0.05, 0.05, bw), [x1 + 0.08, FLOOR1 - 0.08, bz]));
            continue;
        }
        // 腰板
        b.add(m.wood, shade(place(box(0.06, 0.32, bw, 2), [x1 - 0.05, SILL + 0.16, bz]), () => 0.8));
        // 格子の奥（暗い）
        b.add(m.dark, place(quad(bw, FLOOR1 - SILL - 0.5), [x1 - 0.14, SILL + 0.32 + (FLOOR1 - SILL - 0.5) / 2, bz], [0, Math.PI / 2, 0]));
        // 格子：細い縦桟を細かく並べる（上と下に横木）
        const n = Math.floor(bw / 0.075);
        for (let k = 0; k < n; k++) {
            const z = za + (bw / n) * (k + 0.5);
            const tall = k % 4 === 0; // 4 本に 1 本は太い親子格子
            b.add(m.bengara, place(box(tall ? 0.06 : 0.045, FLOOR1 - SILL - 0.6, tall ? 0.04 : 0.028, 3), [x1 - 0.06, SILL + 0.35 + (FLOOR1 - SILL - 0.6) / 2, z]));
        }
        for (const y of [SILL + 0.34, FLOOR1 - 0.25]) b.add(m.bengara, place(box(0.08, 0.07, bw, 3), [x1 - 0.06, y, bz]));
        // 犬矢来（端の 2 間だけ）
        if (i === 0 || i === 3) {
            const count = Math.floor(bw / 0.07);
            for (let k = 0; k < count; k++) {
                const z = za + 0.05 + (bw - 0.1) * (k / (count - 1));
                const pts = [
                    new THREE.Vector3(x1 + 0.62, 0.02, z),
                    new THREE.Vector3(x1 + 0.52, 0.42, z),
                    new THREE.Vector3(x1 + 0.3, 0.78, z),
                    new THREE.Vector3(x1 + 0.03, 0.95, z),
                ];
                b.add(m.timber, taperTube(pts, [0.014, 0.012], 5, 4, false));
            }
            for (const [x, y] of [[x1 + 0.55, 0.3], [x1 + 0.22, 0.83]]) b.add(m.timber, place(box(0.03, 0.03, bw - 0.05), [x, y, bz]));
        }
    }

    // ---- 表 2 階：漆喰と虫籠窓 ----
    for (let i = 0; i < 4; i++) {
        const za = bayZ[i] + 0.09;
        const zb = bayZ[i + 1] - 0.09;
        const bw = zb - za;
        const bz = (za + zb) / 2;
        const y0 = FLOOR1 + 0.11;
        const h = EAVE - FLOOR1 - 0.22;
        if (i === 1 || i === 2) {
            // 窓のまわりの壁
            const ww = 1.15;
            const wh = 0.6;
            const wy = y0 + h / 2 + 0.05;
            b.add(m.plaster, place(box(0.14, h, (bw - ww) / 2, 0.6), [x1 - 0.04, y0 + h / 2, za + (bw - ww) / 4]));
            b.add(m.plaster, place(box(0.14, h, (bw - ww) / 2, 0.6), [x1 - 0.04, y0 + h / 2, zb - (bw - ww) / 4]));
            b.add(m.plaster, place(box(0.14, (h - wh) / 2, ww, 0.6), [x1 - 0.04, y0 + (h - wh) / 4 - 0.025 + 0.05 / 2, bz]));
            b.add(m.plaster, place(box(0.14, (h - wh) / 2 - 0.05, ww, 0.6), [x1 - 0.04, wy + wh / 2 + ((h - wh) / 2 - 0.05) / 2, bz]));
            b.add(m.dark, place(quad(ww, wh), [x1 - 0.1, wy, bz], [0, Math.PI / 2, 0]));
            for (let k = 0; k < 7; k++) {
                const z = bz - ww / 2 + (ww / 7) * (k + 0.5);
                b.add(m.plaster, place(roundBox(0.1, wh, 0.07, 0.025, 0.6), [x1 - 0.03, wy, z]));
            }
        } else {
            b.add(m.plaster, place(box(0.14, h, bw, 0.6), [x1 - 0.04, y0 + h / 2, bz]));
        }
    }

    // ---- 側面・裏：漆喰と腰板 ----
    const wallPanel = (x: number, z: number, w: number, rotY: number) => {
        const h1 = FLOOR1 - SILL - 0.11;
        b.add(m.wood, shade(place(box(w, 0.9, 0.06, 2), [x, SILL + 0.45, z], [0, rotY, 0]), () => 0.78));
        b.add(m.plaster, shade(place(box(w, h1 - 0.9, 0.12, 0.6), [x, SILL + 0.9 + (h1 - 0.9) / 2, z], [0, rotY, 0]), (_x, y) => 0.85 + Math.min(0.15, (y - 1) * 0.1)));
        b.add(m.plaster, place(box(w, EAVE - FLOOR1 - 0.22, 0.12, 0.6), [x, FLOOR1 + 0.11 + (EAVE - FLOOR1 - 0.22) / 2, z], [0, rotY, 0]));
    };
    for (let i = 0; i < 3; i++) {
        const xa = sideX[i] + 0.09;
        const xb = sideX[i + 1] - 0.09;
        for (const z of [z0, z1]) wallPanel((xa + xb) / 2, z, xb - xa, 0);
    }
    for (let i = 0; i < 4; i++) wallPanel(x0, (bayZ[i] + bayZ[i + 1]) / 2, L / 4 - 0.18, Math.PI / 2);

    // ---- 妻（三角の壁） ----
    const rise = 1.26;
    for (const z of [z0, z1]) {
        const s = new THREE.Shape();
        s.moveTo(-W / 2 - 0.05, 0);
        s.lineTo(W / 2 + 0.05, 0);
        s.lineTo(0, rise);
        s.lineTo(-W / 2 - 0.05, 0);
        const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false });
        g.translate(0, 0, -0.06);
        const uv = g.getAttribute('uv');
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 0.6, uv.getY(k) * 0.6);
        b.add(m.plaster, place(g, [cx, EAVE + 0.1, z]));
        // 妻の束と梁
        b.add(m.wood, place(box(0.15, rise - 0.1, 0.16), [cx, EAVE + 0.1 + (rise - 0.1) / 2, z + (z > cz ? 0.02 : -0.02)]));
        b.add(m.wood, place(box(W * 0.62, 0.16, 0.16), [cx, EAVE + 0.55, z + (z > cz ? 0.02 : -0.02)]));
    }

    // ---- 屋根（棟は z 方向）・庇 ----
    roof(b, { len: L + 0.9, run: W / 2 + 0.75, rise: 1.5, both: true, spacing: 0.27 }, [cx, EAVE + 1.58, cz], Math.PI / 2);
    roof(b, { len: L + 0.3, run: 1.05, rise: 0.42, both: false, spacing: 0.26, barge: false }, [x1 + 0.02, FLOOR1 + 0.5, cz], Math.PI / 2);
    // 庇を支える腕木
    for (const z of bayZ) b.add(m.wood, place(box(1.0, 0.1, 0.09), [x1 + 0.45, FLOOR1 + 0.12, z]));

    // ---- 縁台（店先の腰掛け） ----
    const bz = (bayZ[3] + bayZ[4]) / 2;
    b.add(m.timber, place(box(0.55, 0.05, 1.5, 3), [x1 + 1.1, 0.45, bz]));
    for (const dz of [-0.62, 0.62]) for (const dx of [-0.2, 0.2]) b.add(m.timber, place(box(0.05, 0.43, 0.05), [x1 + 1.1 + dx, 0.215, bz + dz]));

    return b.build('町家');
}
