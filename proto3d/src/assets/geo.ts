/**
 * 形を作る道具。
 * - どの形も「位置・法線・UV・頂点色（陰り）・インデックス」をそろえ、材質ごとに 1 つへまとめる（描画命令を減らす）。
 * - UV はメートル単位（1m = 1）× 材質ごとの倍率。同じ材質なら大きさが違っても模様の細かさがそろう。
 * - 頂点色は「陰り（AO）」として使う：地面に近い所・軒の下などを少し暗くする。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

export type Geo = THREE.BufferGeometry;

/** 位置・法線・UV・頂点色・インデックスをそろえる */
export function normalize(g: Geo): Geo {
    let geo = g;
    if (!geo.index) {
        const n = geo.getAttribute('position').count;
        const idx = new Uint32Array(n);
        for (let i = 0; i < n; i++) idx[i] = i;
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const n = geo.getAttribute('position').count;
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (!geo.getAttribute('color')) {
        const c = new Float32Array(n * 3).fill(1);
        geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    for (const name of Object.keys(geo.attributes)) {
        if (!['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'].includes(name)) geo.deleteAttribute(name);
    }
    geo.clearGroups();
    return geo;
}

/** 頂点色に陰りを掛ける（f はワールド座標 → 0〜1 の明るさ） */
export function shade(g: Geo, f: (x: number, y: number, z: number) => number): Geo {
    normalize(g);
    const p = g.getAttribute('position');
    const c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
        const k = Math.max(0, Math.min(1, f(p.getX(i), p.getY(i), p.getZ(i))));
        c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
    }
    c.needsUpdate = true;
    return g;
}

/** 形を置く（位置・回転・大きさ）。元の形は変えずに複製して返す。 */
export function place(g: Geo, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): Geo {
    const m = new THREE.Matrix4().compose(
        new THREE.Vector3(...pos),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot, 'YXZ')),
        new THREE.Vector3(...scale),
    );
    return g.clone().applyMatrix4(m);
}

/** 箱。UV は各面の大きさ（メートル）× uv */
export function box(w: number, h: number, d: number, uv = 1): Geo {
    const g = new THREE.BoxGeometry(w, h, d);
    const faceSize: [number, number][] = [
        [d, h], [d, h], [w, d], [w, d], [w, h], [w, h],
    ];
    const a = g.getAttribute('uv');
    for (let f = 0; f < 6; f++) {
        for (let i = 0; i < 4; i++) {
            const k = f * 4 + i;
            a.setXY(k, a.getX(k) * faceSize[f][0] * uv, a.getY(k) * faceSize[f][1] * uv);
        }
    }
    return normalize(g);
}

/**
 * 面の向きで決める平面の UV（箱の中の座標、メートル）。x 向きの面は (z, y)、y 向きは (x, z)、z 向きは (x, y)。
 * swapLong が指す軸（0=x,1=y,2=z）が u になる面では u と v を入れ替える（木目＝絵の v を長い方向へ）。
 */
function planarUv(g: Geo, su: number, sv: number, long = -1): void {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
        const nx = Math.abs(n.getX(i));
        const ny = Math.abs(n.getY(i));
        const c = [p.getX(i), p.getY(i), p.getZ(i)];
        let ua: number;
        let va: number;
        if (nx > 0.5) [ua, va] = [2, 1];
        else if (ny > 0.5) [ua, va] = [0, 2];
        else [ua, va] = [0, 1];
        if (ua === long) [ua, va] = [va, ua];
        uv[i * 2] = c[ua] * su;
        uv[i * 2 + 1] = c[va] * sv;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * 木の部材（柱・梁・板）。木目（絵の v）が部材の長い方向に走るように UV を付ける。
 * across：木目と直角の方向に 1m あたり何回、along：木目の方向に 1m あたり何回。
 */
export function woodBox(w: number, h: number, d: number, across = 2, along = 0.5, step = 0): Geo {
    const dims = [w, h, d];
    const long = dims.indexOf(Math.max(...dims));
    // step > 0：長い方向に step m ごとに頂点を置く（根元の汚れなどを頂点色で付けるため）
    const seg = dims.map((v, i) => (step > 0 && i === long ? Math.max(1, Math.ceil(v / step)) : 1));
    const g = new THREE.BoxGeometry(w, h, d, seg[0], seg[1], seg[2]);
    // 木目の方向が v になるよう、長い軸が u に来る面では入れ替える
    planarUv(g, across, along, long === 1 ? -1 : long);
    // 長い軸が y（柱）のときは、どの側面でも v = y なのでそのまま
    return normalize(g);
}

/**
 * 細かく分けた板（漆喰の壁など）。場所に理由のある汚れを頂点色で描けるよう、約 step m ごとに頂点を置く。
 */
export function panel(w: number, h: number, d: number, uv = 1, step = 0.12): Geo {
    // 雨筋は横方向に細かく変わるので横だけ細かく分ける。縦の変化はなだらかなので粗く、薄い向き（厚み）は分けない
    const seg = (len: number, st: number) => (len < 0.2 ? 1 : Math.max(1, Math.ceil(len / st)));
    const g = new THREE.BoxGeometry(w, h, d, seg(w, step), Math.max(1, Math.ceil(h / 0.3)), seg(d, step));
    planarUv(g, uv, uv);
    return normalize(g);
}

/**
 * 角を面取りした箱（石・瓦の塊など）。角を 3 点に分けた凸包で作るので軽い（約 130 頂点）。
 * jitter を付けると角の位置が少しずつずれ、手で割った石らしくなる。
 */
export function roundBox(w: number, h: number, d: number, r: number, uv = 1, jitter = 0, seed = 1): Geo {
    const c = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
    let s = seed * 9301 + 49297;
    const rnd = () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280 - 0.5;
    };
    const pts: THREE.Vector3[] = [];
    for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
            for (const sz of [-1, 1]) {
                const j = () => rnd() * jitter;
                const X = (w / 2) * sx;
                const Y = (h / 2) * sy;
                const Z = (d / 2) * sz;
                pts.push(new THREE.Vector3(X - sx * c + j(), Y + j() * 0.5, Z - sz * c + j()));
                pts.push(new THREE.Vector3(X + j() * 0.5, Y - sy * c + j(), Z - sz * c + j()));
                pts.push(new THREE.Vector3(X - sx * c + j(), Y - sy * c + j(), Z + j() * 0.5));
            }
        }
    }
    const g = new ConvexGeometry(pts);
    // UV：上下の面は xz、側面は横と高さ（メートル × uv）
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const uvs = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
        const ny = Math.abs(n.getY(i));
        const nx = Math.abs(n.getX(i));
        uvs[i * 2] = (ny > 0.7 ? p.getX(i) : nx > 0.7 ? p.getZ(i) : p.getX(i)) * uv;
        uvs[i * 2 + 1] = (ny > 0.7 ? p.getZ(i) : p.getY(i)) * uv;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    return normalize(g);
}

/** 小石（ゆがんだ二十面体、60 頂点） */
export function pebble(size: number, seed: number): Geo {
    const g = new THREE.IcosahedronGeometry(size, 0);
    const p = g.getAttribute('position');
    let s = seed * 7919 + 13;
    const rnd = () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
    };
    const k = [0.8 + rnd() * 0.4, 0.45 + rnd() * 0.25, 0.8 + rnd() * 0.4];
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * k[0], p.getY(i) * k[1], p.getZ(i) * k[2]);
    g.computeVertexNormals();
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * 2, p.getZ(i) * 2);
    return normalize(g);
}

export function cylinder(rTop: number, rBottom: number, h: number, seg = 12, uv = 1, open = false): Geo {
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open);
    const a = g.getAttribute('uv');
    const circ = Math.PI * 2 * Math.max(rTop, rBottom);
    for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * circ * uv, a.getY(i) * h * uv);
    return normalize(g);
}

/**
 * 太さの変わる管（木の幹・枝・刀の鞘など）。points に沿って、radii の太さで作る。
 */
export function taperTube(points: THREE.Vector3[], radii: number[], radial = 8, uv = 1, caps = true): Geo {
    const curve = new THREE.CatmullRomCurve3(points);
    const steps = Math.max(2, points.length * 3);
    const frames = curve.computeFrenetFrames(steps, false);
    const pos: number[] = [];
    const nor: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    const radiusAt = (t: number) => {
        const f = t * (radii.length - 1);
        const i = Math.min(radii.length - 2, Math.floor(f));
        return radii[i] + (radii[i + 1] - radii[i]) * (f - i);
    };
    let length = 0;
    let prev = curve.getPointAt(0);
    for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const c = curve.getPointAt(t);
        length += c.distanceTo(prev);
        prev = c;
        const r = radiusAt(t);
        const N = frames.normals[s];
        const B = frames.binormals[s];
        for (let k = 0; k <= radial; k++) {
            const a = (k / radial) * Math.PI * 2;
            const nx = Math.cos(a) * N.x + Math.sin(a) * B.x;
            const ny = Math.cos(a) * N.y + Math.sin(a) * B.y;
            const nz = Math.cos(a) * N.z + Math.sin(a) * B.z;
            pos.push(c.x + nx * r, c.y + ny * r, c.z + nz * r);
            nor.push(nx, ny, nz);
            uvs.push((k / radial) * Math.PI * 2 * r * uv * 3, length * uv);
        }
    }
    const row = radial + 1;
    for (let s = 0; s < steps; s++) {
        for (let k = 0; k < radial; k++) {
            const a = s * row + k;
            const b = a + row;
            idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    if (caps) {
        for (const [s, dir] of [[0, -1], [steps, 1]] as const) {
            const c = curve.getPointAt(s / steps);
            const T = frames.tangents[s].clone().multiplyScalar(dir);
            const center = pos.length / 3;
            pos.push(c.x, c.y, c.z);
            nor.push(T.x, T.y, T.z);
            uvs.push(0, 0);
            for (let k = 0; k < radial; k++) {
                const a = s * row + k;
                if (dir < 0) idx.push(center, a + 1, a);
                else idx.push(center, a, a + 1);
            }
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    return normalize(g);
}

/**
 * 葉や草の板を「両面」にする：裏向きの面を別に足し、法線は表と同じ（上・外向き）のままにする。
 * 両面描画（DoubleSide）だと裏から見た面の法線が反転して真っ黒に見えるため。
 */
export function twoSided(g: Geo): Geo {
    const idx = g.getIndex()!;
    const n = g.getAttribute('position').count;
    const out = g.clone();
    for (const name of Object.keys(g.attributes)) {
        const a = g.getAttribute(name) as THREE.BufferAttribute;
        const arr = new (a.array.constructor as new (n: number) => THREE.TypedArray)(a.array.length * 2);
        arr.set(a.array as ArrayLike<number>);
        arr.set(a.array as ArrayLike<number>, a.array.length);
        out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
    }
    const src = idx.array as ArrayLike<number>;
    const list: number[] = Array.from(src);
    for (let i = 0; i < src.length; i += 3) list.push(src[i] + n, src[i + 2] + n, src[i + 1] + n);
    out.setIndex(list);
    return out;
}

/** 縦長の四角い板（両面、ワールド単位の UV） */
export function quad(w: number, h: number, uvRect: [number, number, number, number] = [0, 0, 1, 1]): Geo {
    const g = new THREE.PlaneGeometry(w, h);
    const a = g.getAttribute('uv');
    for (let i = 0; i < a.count; i++) a.setXY(i, uvRect[0] + a.getX(i) * (uvRect[2] - uvRect[0]), uvRect[1] + a.getY(i) * (uvRect[3] - uvRect[1]));
    return normalize(g);
}

/**
 * 材質ごとに形を集め、最後にまとめて 1 つの Mesh にする。
 */
export class Builder {
    private readonly parts = new Map<THREE.Material, Geo[]>();

    add(material: THREE.Material, ...geos: Geo[]): void {
        let list = this.parts.get(material);
        if (!list) {
            list = [];
            this.parts.set(material, list);
        }
        for (const g of geos) list.push(normalize(g));
    }

    /** まとめた結果。cast / receive は影の設定（読み込み後に使う印として userData に残す） */
    build(name: string, opts: { cast?: boolean; receive?: boolean } = {}): THREE.Group {
        const group = new THREE.Group();
        group.name = name;
        for (const [mat, geos] of this.parts) {
            const merged = mergeGeometries(geos, false);
            if (!merged) throw new Error(`${name}: 形をまとめられませんでした（${mat.name}）`);
            merged.computeBoundingSphere();
            const mesh = new THREE.Mesh(merged, mat);
            mesh.name = `${name}-${mat.name}`;
            mesh.userData = { cast: opts.cast ?? true, receive: opts.receive ?? true };
            group.add(mesh);
        }
        return group;
    }
}
