/**
 * 地面：草地、土の道（門をくぐって城内へ続く）、道の縁石、草むら。
 */
import * as THREE from 'three';
import { GATE, HOUSE, PINE, ROAD, TREE2, WALL } from '../layout';
import { Builder, normalize, pebble, place, shade } from './geo';
import { materials } from './materials';
import { fbm, rng } from './tex';
import { grassTuft } from './trees';

export function buildGround(): THREE.Group {
    const m = materials();
    const b = new Builder();
    // 草地（大きな板、UV は 6m で 1 回）
    const size = 80;
    const g = new THREE.PlaneGeometry(size, size, 56, 56);
    g.rotateX(-Math.PI / 2);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * size) / 3.5, (uv.getY(i) * size) / 3.5);
    const gg = normalize(g);
    // 大きなむら（濃い草・乾いた草・土が見える所）を頂点色で
    const gp = gg.getAttribute('position');
    const gc = gg.getAttribute('color');
    for (let i = 0; i < gp.count; i++) {
        const x = gp.getX(i);
        const z = gp.getZ(i);
        const n = fbm(x / 80 + 0.5, z / 80 + 0.5, 6, 3, 5);
        // 数 m の濃い所・乾いた所（テクスチャの繰り返しより大きく、周期を持たない）
        const dry = Math.max(0, fbm(x / 80 + 0.5, z / 80 + 0.5, 20, 2, 6) - 0.5) * 2;
        const k = 0.84 + n * 0.28;
        let r = k * (1 + (n - 0.5) * 0.1 + dry * 0.14);
        let gr = k * (1 + dry * 0.04);
        let bl = k * (1 - (n - 0.5) * 0.08 - dry * 0.04);
        // 道の縁は踏まれて乾き、黄ばむ（道から 0.9m くらいまで）
        const d = Math.abs(x) - ROAD.halfWidth;
        if (d < 0.9) {
            const t = 1 - Math.max(0, d) / 0.9;
            r *= 1 + 0.06 * t;
            gr *= 1 - 0.04 * t;
            bl *= 1 - 0.1 * t;
        }
        gc.setXYZ(i, r, gr, bl);
    }
    b.add(m.ground, place(gg, [0, 0, -5]));

    // 土の道：縁は細かく分けて、少しだけ波打たせる
    const len = ROAD.z1 - ROAD.z0;
    const road = new THREE.PlaneGeometry(ROAD.halfWidth * 2 + 0.6, len, 20, 160);
    road.rotateX(-Math.PI / 2);
    const p = road.getAttribute('position');
    const ruv = road.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const z = p.getZ(i);
        // 縁ほど大きく波打たせる（内側の列を追い越して面が裏返らないよう、0.7m かけて強める）
        const edge = Math.max(0, Math.min(1, (Math.abs(x) - ROAD.halfWidth + 0.4) / 0.7));
        p.setX(i, x + edge * (Math.sin(z * 0.9) * 0.18 + Math.sin(z * 2.3) * 0.08));
        p.setY(i, 0.012);
        ruv.setXY(i, p.getX(i) / 6, (z + len / 2) / 6);
    }
    road.computeVertexNormals();
    const rg = normalize(road);
    // 縁は草に溶ける（頂点色で少し暗く・緑がかった土）
    // 頂点色：轍（車や人の通る 2 本の筋は踏み固められて暗く滑らか）、中央の盛り上がりは明るく、
    //   縁は草に溶ける。大きなむらで、6m ごとの繰り返しを目立たなくする。
    const col = rg.getAttribute('color');
    const rp = rg.getAttribute('position');
    for (let i = 0; i < rp.count; i++) {
        const x = rp.getX(i);
        const z = rp.getZ(i);
        const ax = Math.abs(x);
        const rut = Math.exp(-Math.pow((ax - 0.8) / 0.28, 2));
        const crown = Math.exp(-Math.pow(x / 0.35, 2));
        const macro = fbm(x / 40 + 0.5, z / 70 + 0.5, 8, 3, 91);
        let k = 0.93 + (macro - 0.5) * 0.18 - rut * 0.07 + crown * 0.04;
        if (ax > ROAD.halfWidth) k *= 0.85;
        const edge = Math.max(0, Math.min(1, (ax - ROAD.halfWidth + 0.3) / 0.6));
        col.setXYZ(i, k * (1 - edge * 0.06), k, k * (1 - edge * 0.02));
    }
    b.add(m.road, place(rg, [0, 0, (ROAD.z0 + ROAD.z1) / 2]));

    // 縁石（門の前後は切る）
    const r = rng(33);
    for (const side of [-1, 1]) {
        let k = 0;
        for (let z = ROAD.z0 + 1; z < ROAD.z1 - 1; z += 0.9 + r() * 0.6) {
            if (Math.abs(z - GATE.z) < 3.2) continue;
            const x = side * (ROAD.halfWidth + 0.15 + (r() - 0.5) * 0.08);
            const s = 0.08 + r() * 0.07;
            b.add(m.stone, shade(place(pebble(s, k++ * 2 + (side > 0 ? 1 : 0)), [x, 0.03, z], [0, r() * 3, 0]), (_x, y) => 0.45 + y * 3));
        }
    }

    // 雨落ち：庇の軒先の真下（雨がまとまって落ちる線）に、小石を敷いた細い溝
    {
        const x = HOUSE.x1 + 1.08;
        const drip = new THREE.PlaneGeometry(0.32, HOUSE.z1 - HOUSE.z0 + 0.3, 2, 40);
        drip.rotateX(-Math.PI / 2);
        const dg = normalize(drip);
        const dp = dg.getAttribute('position');
        const duv = dg.getAttribute('uv');
        const dc = dg.getAttribute('color');
        for (let i = 0; i < dp.count; i++) {
            duv.setXY(i, (dp.getX(i) + x) / 2.5, dp.getZ(i) / 2.5);
            dc.setXYZ(i, 0.72, 0.72, 0.74);
        }
        b.add(m.road, place(dg, [x, 0.016, (HOUSE.z0 + HOUSE.z1) / 2]));
        const rr = rng(55);
        for (let z = HOUSE.z0 - 0.1; z < HOUSE.z1 + 0.1; z += 0.07 + rr() * 0.06) {
            const s = 0.025 + rr() * 0.03;
            b.add(m.stone, shade(place(pebble(s, Math.floor(z * 100)), [x + (rr() - 0.5) * 0.24, 0.02, z], [0, rr() * 3, 0]), () => 0.75));
        }
    }

    // 草むら（道・建物・塀を避けて散らす。塀と家の根元、道の縁に多め）
    const tufts = new Builder();
    const blocked = (x: number, z: number) =>
        Math.abs(x) < ROAD.halfWidth + 0.5 ||
        (x > HOUSE.x0 - 0.6 && x < HOUSE.x1 + 1.3 && z > HOUSE.z0 - 0.4 && z < HOUSE.z1 + 0.4) ||
        Math.abs(z - GATE.z) < WALL.thick / 2 + 0.25;
    let placed = 0;
    for (let i = 0; i < 1400 && placed < 260; i++) {
        let x = (r() - 0.5) * 40;
        let z = -26 + r() * 42;
        // 半分は塀・家・木の根元、道の縁（踏まれにくい所）に寄せる
        if (i % 2 === 0) {
            const k = r();
            if (k < 0.3) z = GATE.z + (r() < 0.5 ? 1 : -1) * (WALL.thick / 2 + 0.35 + r() * 0.3);
            else if (k < 0.55) x = (r() < 0.5 ? 1 : -1) * (ROAD.halfWidth + 0.55 + r() * 0.5);
            else if (k < 0.78) {
                x = HOUSE.x0 - 0.5 - r() * 0.3;
                z = HOUSE.z0 + r() * (HOUSE.z1 - HOUSE.z0);
            } else {
                const t = r() < 0.5 ? PINE : TREE2;
                const a = r() * Math.PI * 2;
                x = t.x + Math.cos(a) * (0.6 + r() * 0.8);
                z = t.z + Math.sin(a) * (0.6 + r() * 0.8);
            }
        }
        if (blocked(x, z)) continue;
        grassTuft(tufts, x, z, 0.8 + r() * 0.7, r() * Math.PI);
        placed++;
    }
    const ground = b.build('地面', { cast: false, receive: true });
    const grass = tufts.build('草むら', { cast: false, receive: true });
    const group = new THREE.Group();
    group.name = '地面と草';
    group.add(ground, grass);
    return group;
}
