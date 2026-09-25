/**
 * 地面：草地、土の道（門をくぐって城内へ続く）、道の縁石、草むら。
 * 草地は地平線まで続く大きさ（肩越しのカメラで遠くまで見えるため。遠くは霧に溶ける）。
 */
import * as THREE from 'three';
import { GATE, HOUSE, HOUSES, PINE, ROAD, TREE2, WALL, houseRect } from '../layout';
import { Builder, normalize, pebble, place, shade } from './geo';
import { materials } from './materials';
import { fbm, rng } from './tex';
import { grassTuft } from './trees';

export function buildGround(): THREE.Group {
    const m = materials();
    const b = new Builder();
    // 草地（大きな板、UV は 3.5m で 1 回）
    const size = 400;
    const g = new THREE.PlaneGeometry(size, size, 100, 100);
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

    // 土の道：縁は細かく分けて、少しだけ波打たせる。横にも細かく分けて、頂点の色でむらを付ける
    const len = ROAD.z1 - ROAD.z0;
    const road = new THREE.PlaneGeometry(ROAD.halfWidth * 2 + 0.6, len, 28, 180);
    road.rotateX(-Math.PI / 2);
    const p = road.getAttribute('position');
    const ruv = road.getAttribute('uv');
    const zc = (ROAD.z0 + ROAD.z1) / 2;
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const z = p.getZ(i);
        const edge = Math.abs(x) > ROAD.halfWidth;
        p.setX(i, x + (edge ? Math.sin(z * 0.9) * 0.18 + Math.sin(z * 2.3) * 0.08 : 0));
        p.setY(i, 0.012);
        ruv.setXY(i, p.getX(i) / 4, (z + len / 2) / 4);
    }
    road.computeVertexNormals();
    const rg = normalize(road);
    // 色のむら：荷車のわだち（道の中ほどの 2 本、少し暗く締まった土）、家の表の近く（軒下で湿って暗い）、
    // 縁は草に溶ける、大きな乾いた所・湿った所
    const col = rg.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const z = p.getZ(i) + zc;
        const ax = Math.abs(x);
        const rut = Math.exp(-(((ax - 0.85 + Math.sin(z * 0.23) * 0.12) / 0.22) ** 2));
        const nearHouse = HOUSES.some((q) => z > HOUSE.z0 + q.dz - 0.3 && z < HOUSE.z1 + q.dz + 0.3) ? THREE.MathUtils.smoothstep(ax, 2.4, 3.6) : 0;
        const patch = fbm(x / 30 + 0.5, z / 30 + 0.5, 4, 3, 91);
        const grassEdge = Math.abs(x) > ROAD.halfWidth ? 0.82 : 1;
        const k = grassEdge * (1 - rut * 0.13 - nearHouse * 0.2) * (0.9 + patch * 0.2);
        col.setXYZ(i, k * (0.98 + patch * 0.04), k, k * (0.93 - nearHouse * 0.04));
    }
    b.add(m.road, place(rg, [0, 0, (ROAD.z0 + ROAD.z1) / 2]));

    // 縁石（門の前後は切る）
    const r = rng(33);
    for (const side of [-1, 1]) {
        let k = 0;
        for (let z = ROAD.z0 + 1; z < ROAD.z1 - 1; z += 0.9 + r() * 0.6) {
            if (Math.abs(z - GATE.z) < 3.2) continue;
            // 町家の前は道が家の表まで続くので、縁石は置かない
            if (HOUSES.some((p) => z > HOUSE.z0 + p.dz - 0.5 && z < HOUSE.z1 + p.dz + 0.5)) continue;
            const x = side * (ROAD.halfWidth + 0.15 + (r() - 0.5) * 0.08);
            const s = 0.08 + r() * 0.07;
            b.add(m.stone, shade(place(pebble(s, k++ * 2 + (side > 0 ? 1 : 0)), [x, 0.03, z], [0, r() * 3, 0]), (_x, y) => 0.45 + y * 3));
        }
    }

    // 草むら（道・建物・塀を避けて散らす。塀と家の根元に多め）
    const tufts = new Builder();
    const houses = HOUSES.map((p) => houseRect(p, { x0: HOUSE.x0 - 0.6, x1: HOUSE.x1 + 1.3, z0: HOUSE.z0 - 0.4, z1: HOUSE.z1 + 0.4 }));
    const blocked = (x: number, z: number) =>
        Math.abs(x) < ROAD.halfWidth + 0.5 ||
        houses.some((q) => x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1) ||
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
                // 町家の裏の根元
                const p = HOUSES[Math.floor(r() * HOUSES.length)];
                x = p.side * (HOUSE.x0 - 0.5 - r() * 0.3);
                z = HOUSE.z0 + p.dz + r() * (HOUSE.z1 - HOUSE.z0);
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
