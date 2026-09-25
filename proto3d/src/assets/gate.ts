/**
 * 城門（高麗門）と左右の土塀。
 * - 鏡柱 2 本と冠木、その上に切妻の瓦屋根。後ろに控柱と小屋根。門扉は内側へ開いている。
 * - 土塀：下は石積み、上は漆喰の白壁に狭間（鉄砲・矢を射る小窓）、頂に瓦の笠。
 */
import * as THREE from 'three';
import { GATE, WALL } from '../layout';
import { Builder, box, place, roundBox, shade } from './geo';
import { materials } from './materials';
import { rng } from './tex';
import { roof } from './roof';

/** 地面に近いほど暗く（接地の陰） */
const groundAO = (base = 0.55, h = 0.8) => (_x: number, y: number) => base + (1 - base) * Math.min(1, Math.max(0, y) / h);

export function buildGate(): THREE.Group {
    const m = materials();
    const b = new Builder();
    const z = GATE.z;
    const px = GATE.pillarX;

    // ---- 鏡柱・礎石 ----
    for (const s of [-1, 1]) {
        b.add(m.stone, shade(place(roundBox(0.9, 0.22, 0.95, 0.06, 1.5), [s * px, 0.1, z]), groundAO(0.6, 0.25)));
        b.add(m.wood, shade(place(box(0.42, 4.0, 0.55, 1.2), [s * px, 2.2, z]), groundAO(0.55, 1.2)));
        // 柱の根元の金具（根巻）
        b.add(m.iron, place(box(0.46, 0.3, 0.59), [s * px, 0.36, z]));
    }
    // ---- 冠木と貫 ----
    b.add(m.wood, place(box(5.4, 0.44, 0.52, 1.2), [0, 3.62, z]));
    b.add(m.wood, place(box(4.4, 0.22, 0.26, 1.2), [0, 3.0, z]));
    // 門の上の扁額の代わりの肘木
    for (const s of [-1, 1]) b.add(m.wood, place(box(0.8, 0.18, 0.4), [s * (px - 0.45), 3.32, z]));
    // ---- 大きな屋根 ----
    roof(b, { len: 6.4, run: 1.45, rise: 0.8, both: true, spacing: 0.26 }, [0, 4.72, z]);
    // 屋根の下の束（冠木と屋根をつなぐ）
    for (const x of [-1.6, 0, 1.6]) b.add(m.wood, place(box(0.18, 0.4, 0.18), [x, 4.02, z]));

    // ---- 控柱と小屋根（門の内側） ----
    for (const s of [-1, 1]) {
        const cz = z - 1.8;
        b.add(m.stone, shade(place(roundBox(0.55, 0.18, 0.55, 0.05, 1.5), [s * px, 0.08, cz]), groundAO(0.6, 0.2)));
        b.add(m.wood, shade(place(box(0.3, 2.9, 0.3, 1.2), [s * px, 1.6, cz]), groundAO(0.55, 1)));
        for (const y of [1.2, 2.55]) b.add(m.wood, place(box(0.14, 0.2, 1.8, 1.2), [s * px, y, z - 0.9]));
        roof(b, { len: 2.4, run: 0.55, rise: 0.3, both: true, spacing: 0.24 }, [s * px, 3.25, z - 1.0], Math.PI / 2);
    }

    // ---- 門扉（内側へ 70° 開く） ----
    for (const s of [-1, 1]) {
        const leaf = new Builder();
        const w = 1.78;
        const h = 3.1;
        const planks = 6;
        for (let i = 0; i < planks; i++) {
            const x = -w / 2 + (w / planks) * (i + 0.5);
            leaf.add(m.wood, shade(place(box(w / planks - 0.01, h, 0.08, 1.5), [x, h / 2, 0]), () => 0.85 + (i % 2) * 0.1));
        }
        for (const y of [0.45, 1.55, 2.7]) {
            leaf.add(m.wood, place(box(w, 0.16, 0.06), [0, y, -0.07]));
            leaf.add(m.iron, place(box(w + 0.01, 0.07, 0.09), [0, y, 0.01]));
            for (let i = 0; i < 7; i++) {
                const stud = new THREE.SphereGeometry(0.025, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
                stud.rotateX(Math.PI / 2);
                leaf.add(m.iron, place(stud, [-w / 2 + 0.12 + i * ((w - 0.24) / 6), y, 0.055]));
            }
        }
        const g = leaf.build('leaf');
        // 蝶番は柱の内側。扉の中心をずらしてから回す
        g.children.forEach((c) => {
            const mesh = c as THREE.Mesh;
            mesh.geometry.translate((w / 2) * -s, 0, 0);
            mesh.geometry.rotateY(-s * (Math.PI / 2 - 0.35));
            mesh.geometry.translate(s * (px - 0.22), 0.05, z - 0.28);
            b.add(mesh.material as THREE.Material, mesh.geometry);
        });
    }

    // ---- 土塀 ----
    const r = rng(3);
    for (const s of [-1, 1]) {
        const xa = s * (px + 0.21);
        const xb = s * GATE.wallEnd;
        const len = Math.abs(xb - xa);
        const cx = (xa + xb) / 2;
        // 石積み（3 段、石の幅はばらばら）
        const rows = 3;
        const rowH = 0.28;
        for (let row = 0; row < rows; row++) {
            let x = 0;
            while (x < len) {
                const sw = Math.min(len - x, 0.35 + r() * 0.45);
                const sx = Math.min(xa, xb) + x + sw / 2;
                const sh = rowH - 0.02 + r() * 0.03;
                const depth = WALL.thick + 0.12 - row * 0.03;
                b.add(m.stone, shade(place(roundBox(sw - 0.025, sh, depth, 0.05, 1.3, 0.03, row * 1000 + Math.round(x * 100)), [sx, row * rowH + sh / 2, z + (r() - 0.5) * 0.02], [0, (r() - 0.5) * 0.03, (r() - 0.5) * 0.03]), groundAO(0.55, 0.5)));
                x += sw;
            }
        }
        const baseTop = rows * rowH;
        // 漆喰の壁
        b.add(m.plasterWall, shade(place(box(len, WALL.height - baseTop, WALL.thick, 0.5), [cx, baseTop + (WALL.height - baseTop) / 2, z]), (_x, y) => (y > WALL.height - 0.35 ? 0.72 : 1)));
        // 腰の水切り板
        b.add(m.wood, place(box(len, 0.12, WALL.thick + 0.06, 1.5), [cx, baseTop + 0.06, z]));
        // 狭間（三角と四角を交互に。黒い穴）
        const n = Math.floor(len / 2.2);
        for (let i = 0; i < n; i++) {
            const x = Math.min(xa, xb) + 1.3 + i * ((len - 2) / Math.max(1, n - 1));
            const tri = i % 2 === 0;
            const hole = tri ? triangleHole() : box(0.26, 0.26, 0.05);
            for (const face of [1, -1]) b.add(m.dark, place(hole, [x, 1.75, z + face * (WALL.thick / 2 + 0.005)]));
        }
        // 瓦の笠
        roof(b, { len: len + 0.1, run: 0.62, rise: 0.28, both: true, spacing: 0.26, barge: false }, [cx, WALL.height + 0.34, z]);
    }
    return b.build('城門');
}

function triangleHole(): THREE.BufferGeometry {
    const s = new THREE.Shape();
    s.moveTo(-0.16, -0.12);
    s.lineTo(0.16, -0.12);
    s.lineTo(0, 0.16);
    s.lineTo(-0.16, -0.12);
    const g = new THREE.ShapeGeometry(s);
    return g;
}

