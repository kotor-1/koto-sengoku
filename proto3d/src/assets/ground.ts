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
    const g = new THREE.PlaneGeometry(size, size, 40, 40);
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
        const k = 0.78 + n * 0.4;
        gc.setXYZ(i, k * (1 + (n - 0.5) * 0.12), k, k * (1 - (n - 0.5) * 0.1));
    }
    b.add(m.ground, place(gg, [0, 0, -5]));

    // 土の道：縁は細かく分けて、少しだけ波打たせる
    const len = ROAD.z1 - ROAD.z0;
    const road = new THREE.PlaneGeometry(ROAD.halfWidth * 2 + 0.6, len, 4, 60);
    road.rotateX(-Math.PI / 2);
    const p = road.getAttribute('position');
    const ruv = road.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const z = p.getZ(i);
        const edge = Math.abs(x) > ROAD.halfWidth;
        p.setX(i, x + (edge ? Math.sin(z * 0.9) * 0.18 + Math.sin(z * 2.3) * 0.08 : 0));
        p.setY(i, 0.012);
        ruv.setXY(i, p.getX(i) / 5, (z + len / 2) / 5);
    }
    road.computeVertexNormals();
    const rg = normalize(road);
    // 縁は草に溶ける（頂点色で少し暗く・緑がかった土）
    const col = rg.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
        const e = Math.abs(p.getX(i)) > ROAD.halfWidth ? 0.8 : 1;
        col.setXYZ(i, e * 0.98, e, e * 0.94);
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

    // 草むら（道・建物・塀を避けて散らす。塀と家の根元に多め）
    const tufts = new Builder();
    const blocked = (x: number, z: number) =>
        Math.abs(x) < ROAD.halfWidth + 0.5 ||
        (x > HOUSE.x0 - 0.6 && x < HOUSE.x1 + 1.3 && z > HOUSE.z0 - 0.4 && z < HOUSE.z1 + 0.4) ||
        Math.abs(z - GATE.z) < WALL.thick / 2 + 0.25;
    let placed = 0;
    for (let i = 0; i < 900 && placed < 170; i++) {
        let x = (r() - 0.5) * 40;
        let z = -26 + r() * 42;
        // 半分は塀・家・木の根元に寄せる
        if (i % 2 === 0) {
            const k = r();
            if (k < 0.5) z = GATE.z + (r() < 0.5 ? 1 : -1) * (WALL.thick / 2 + 0.35 + r() * 0.3);
            else if (k < 0.75) {
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
