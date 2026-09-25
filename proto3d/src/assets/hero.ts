/**
 * 主人公（若殿）の 3D 人形。骨組み（スケルトン）で動く本物の 3D 形状。
 * - 身長約 1.68m（髷を含まない）、約 7 頭身。極端なデフォルメはしない。
 * - 服：藍の小袖（襟と白い半襟）、縞の袴（上の腰まわり＋幅の広い脚。前後に襞）、腰紐、腰板。
 * - 頭：あごの細い頭に顔を描き、鼻・耳を形で付ける。髪は生え際のある殻、茶筅髷。
 * - 足：白い足袋と草履（鼻緒）。左の腰に大小（刀・脇差）。
 * - 動き：待機（呼吸・体重移動）と歩き（1 周期 1 秒・約 1.32m）を式から作る。左手は刀の柄に添える。
 * 体の各部は、近くの骨 1〜2 本に重みを付けて一緒に曲がる（スキニング）。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { normalize, taperTube, type Geo } from './geo';
import { materials } from './materials';

/** 歩きの設計速度（m/秒）：この速さで歩くとき足が滑らない */
export const WALK_SPEED = 1.32;
export const WALK_PERIOD = 1.0;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface BoneDef {
    name: string;
    parent: string | null;
    pos: THREE.Vector3;
}

/** 骨の位置（組み立て時の姿勢、ワールド座標）。L = 本人の左 = +x。正面は +z。 */
const BONES: BoneDef[] = [
    { name: 'root', parent: null, pos: V(0, 0, 0) },
    { name: 'hips', parent: 'root', pos: V(0, 0.93, 0) },
    { name: 'spine', parent: 'hips', pos: V(0, 1.05, 0) },
    { name: 'chest', parent: 'spine', pos: V(0, 1.25, 0) },
    { name: 'neck', parent: 'chest', pos: V(0, 1.46, 0) },
    { name: 'head', parent: 'neck', pos: V(0, 1.56, 0) },
    ...(['L', 'R'] as const).flatMap((sd) => {
        const s = sd === 'L' ? 1 : -1;
        return [
            { name: `upperArm${sd}`, parent: 'chest', pos: V(s * 0.178, 1.4, 0) },
            { name: `foreArm${sd}`, parent: `upperArm${sd}`, pos: V(s * 0.205, 1.12, 0) },
            { name: `hand${sd}`, parent: `foreArm${sd}`, pos: V(s * 0.222, 0.878, 0.018) },
            { name: `thigh${sd}`, parent: 'hips', pos: V(s * 0.1, 0.86, 0) },
            { name: `shin${sd}`, parent: `thigh${sd}`, pos: V(s * 0.105, 0.47, 0) },
            { name: `foot${sd}`, parent: `shin${sd}`, pos: V(s * 0.108, 0.085, 0) },
        ];
    }),
];
const IDX = new Map(BONES.map((b, i) => [b.name, i]));
const bi = (n: string) => IDX.get(n)!;

type Weights = [number, number][];
type WeightFn = (p: THREE.Vector3) => Weights;

/** 形に骨の重みを付ける */
function skin(g: Geo, f: WeightFn): Geo {
    normalize(g);
    const p = g.getAttribute('position');
    const n = p.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i));
        const w = f(v).filter(([, x]) => x > 0.001).sort((a, b) => b[1] - a[1]).slice(0, 4);
        const sum = w.reduce((s, [, x]) => s + x, 0) || 1;
        w.forEach(([b, x], k) => {
            si[i * 4 + k] = b;
            sw[i * 4 + k] = x / sum;
        });
        if (w.length === 0) sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    return g;
}

const smooth = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
/** 高さで 2 本の骨をなめらかに切り替える（y が lo 以下で下の骨、hi 以上で上の骨） */
const byHeight = (upper: string, lower: string, lo: number, hi: number): WeightFn => (p) => {
    const t = smooth(lo, hi, p.y);
    return [[bi(upper), t], [bi(lower), 1 - t]];
};
const rigid = (bone: string): WeightFn => () => [[bi(bone), 1]];

interface Ring {
    /** 軸に沿った位置 0〜1 */
    t: number;
    rx: number;
    rz: number;
    /** 輪の中心をずらす（軸に垂直な x', z' 方向） */
    ox?: number;
    oz?: number;
}

/**
 * 輪を並べた筒（体・袖・脚）。a→b の軸に沿って楕円の輪を並べる。
 * 輪の x' は世界の x に近い向き、z' は世界の z に近い向き。
 * pleat(角度) で半径に襞を足せる。
 */
function loft(a: THREE.Vector3, b: THREE.Vector3, rings: Ring[], radial = 16, steps = 3, opts: { pleat?: (ang: number, t: number) => number; capStart?: boolean; capEnd?: boolean } = {}): Geo {
    const axis = b.clone().sub(a);
    const len = axis.length();
    axis.normalize();
    const X = V(1, 0, 0).sub(axis.clone().multiplyScalar(axis.x)).normalize();
    const Z = new THREE.Vector3().crossVectors(X, axis).negate().normalize();
    if (Z.z < 0) Z.negate();
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    // 輪の間を細かく補間
    const samples: Ring[] = [];
    for (let i = 0; i < rings.length - 1; i++) {
        for (let k = 0; k < steps; k++) {
            const f = k / steps;
            const r0 = rings[i];
            const r1 = rings[i + 1];
            const e = f * f * (3 - 2 * f);
            samples.push({
                t: r0.t + (r1.t - r0.t) * f,
                rx: r0.rx + (r1.rx - r0.rx) * e,
                rz: r0.rz + (r1.rz - r0.rz) * e,
                ox: (r0.ox ?? 0) + ((r1.ox ?? 0) - (r0.ox ?? 0)) * e,
                oz: (r0.oz ?? 0) + ((r1.oz ?? 0) - (r0.oz ?? 0)) * e,
            });
        }
    }
    samples.push(rings[rings.length - 1]);
    samples.forEach((r, j) => {
        const c = a.clone().add(axis.clone().multiplyScalar(r.t * len)).add(X.clone().multiplyScalar(r.ox ?? 0)).add(Z.clone().multiplyScalar(r.oz ?? 0));
        for (let k = 0; k <= radial; k++) {
            const ang = (k / radial) * Math.PI * 2;
            const pl = opts.pleat ? 1 + opts.pleat(ang, r.t) : 1;
            const p = c.clone().add(X.clone().multiplyScalar(Math.cos(ang) * r.rx * pl)).add(Z.clone().multiplyScalar(Math.sin(ang) * r.rz * pl));
            pos.push(p.x, p.y, p.z);
            uvs.push((k / radial) * 2, r.t * len * 3);
        }
        void j;
    });
    const row = radial + 1;
    for (let j = 0; j < samples.length - 1; j++) {
        for (let k = 0; k < radial; k++) {
            const i0 = j * row + k;
            const i1 = i0 + row;
            idx.push(i0, i0 + 1, i1, i1, i0 + 1, i1 + 1);
        }
    }
    const cap = (j: number, flip: boolean) => {
        const r = samples[j];
        const c = a.clone().add(axis.clone().multiplyScalar(r.t * len)).add(X.clone().multiplyScalar(r.ox ?? 0)).add(Z.clone().multiplyScalar(r.oz ?? 0));
        const ci = pos.length / 3;
        pos.push(c.x, c.y, c.z);
        uvs.push(0.5, 0.5);
        for (let k = 0; k < radial; k++) {
            const i0 = j * row + k;
            if (flip) idx.push(ci, i0 + 1, i0);
            else idx.push(ci, i0, i0 + 1);
        }
    };
    if (opts.capStart) cap(0, false);
    if (opts.capEnd) cap(samples.length - 1, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return normalize(g);
}

/** 楕円体（耳・芯など） */
function ellipsoid(c: THREE.Vector3, r: [number, number, number], seg = 10): Geo {
    const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg - 2));
    g.scale(...r);
    g.translate(c.x, c.y, c.z);
    return normalize(g);
}

// ---------------------------------------------------------------------------

const HEAD_C = V(0, 1.638, 0.012);
const HEAD_R: [number, number, number] = [0.089, 0.114, 0.104];

/** 頭の形：あごを細く、後頭部を少し張り出す */
function headShape(x: number, y: number, z: number): [number, number, number] {
    let px = x;
    let pz = z;
    if (y < 0) {
        const d = Math.pow(-y, 1.4);
        px *= 1 - 0.3 * d;
        pz *= 1 - 0.12 * d;
        if (z > 0) pz += 0.08 * -y * z; // あごを少し前へ
    }
    if (z < 0 && y > -0.3) pz *= 1.08; // 後頭部
    return [px * HEAD_R[0] + HEAD_C.x, y * HEAD_R[1] + HEAD_C.y, pz * HEAD_R[2] + HEAD_C.z];
}

function buildHead(): { face: Geo; hair: Geo } {
    const g = new THREE.SphereGeometry(1, 36, 24);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
        const [x, y, z] = headShape(p.getX(i), p.getY(i), p.getZ(i));
        p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    // 髪：生え際（前は額の上、横は耳の上、後ろはうなじ）より上を覆う殻
    const R = 30;
    const C = 18;
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= R; i++) {
        const phi = (i / R) * Math.PI * 2;
        const front = Math.max(0, Math.sin(phi));
        const back = Math.max(0, -Math.sin(phi));
        const thetaMax = Math.PI * (0.5 - 0.19 * Math.pow(front, 1.3) + 0.22 * Math.pow(back, 0.8));
        for (let j = 0; j <= C; j++) {
            const theta = (j / C) * thetaMax;
            const sx = -Math.cos(phi) * Math.sin(theta);
            const sy = Math.cos(theta);
            const sz = Math.sin(phi) * Math.sin(theta);
            const [x, y, z] = headShape(sx, sy, sz);
            // 殻は少し外へ。生え際の近くほど頭に沿わせる
            const lift = 0.009 * (1 - Math.pow(j / C, 3) * 0.7);
            const n = V(x - HEAD_C.x, y - HEAD_C.y, z - HEAD_C.z).normalize();
            pos.push(x + n.x * lift, y + n.y * lift, z + n.z * lift);
            uvs.push(i / R, (j / C) * 2);
        }
    }
    for (let i = 0; i < R; i++) {
        for (let j = 0; j < C; j++) {
            const a = i * (C + 1) + j;
            const b = a + C + 1;
            idx.push(a, a + 1, b, b, a + 1, b + 1);
        }
    }
    const hair = new THREE.BufferGeometry();
    hair.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    hair.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    hair.setIndex(idx);
    hair.computeVertexNormals();
    return { face: normalize(g), hair: normalize(hair) };
}

export interface HeroAsset {
    root: THREE.Group;
    clips: THREE.AnimationClip[];
}

export function buildHero(): HeroAsset {
    const m = materials();
    const parts = new Map<THREE.Material, Geo[]>();
    const add = (mat: THREE.Material, g: Geo, w: WeightFn) => {
        const list = parts.get(mat) ?? [];
        list.push(skin(g, w));
        parts.set(mat, list);
    };

    // ---- 袴：腰まわり（前に 5 本・後ろに 2 本の襞） ----
    // 襞は「折り山が外へ出て、次の折り山の下へ斜めに入り込む」片流れの段。
    // 折り山は鋭く、谷はなめらかにして、布の厚みと折り目が光で見えるようにする。
    const knife = (ang: number, center: number, half: number, count: number, depth: number) => {
        let d = ang - center;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        if (Math.abs(d) > half) return 0;
        const f = ((d + half) / (2 * half)) * count;
        const k = f - Math.floor(f);
        const edge = Math.min(1, (half - Math.abs(d)) / 0.08); // 襞のある範囲の端はなだらかに
        return depth * edge * (Math.pow(1 - k, 1.6) - 0.35);
    };
    const pleatFront = (ang: number) => knife(ang, Math.PI / 2, 1.05, 5, 0.075) + knife(ang, -Math.PI / 2, 0.55, 2, 0.06);
    add(
        m.hakama,
        loft(V(0, 1.0, -0.005), V(0, 0.6, -0.005), [
            { t: 0, rx: 0.165, rz: 0.125 },
            { t: 0.2, rx: 0.19, rz: 0.14 },
            { t: 0.5, rx: 0.232, rz: 0.158 },
            { t: 0.75, rx: 0.238, rz: 0.162 },
            { t: 1, rx: 0.242, rz: 0.165 },
        ], 72, 3, { pleat: pleatFront }),
        (p) => {
            const down = smooth(0.86, 0.62, p.y);
            const side = Math.min(1, Math.abs(p.x) / 0.14);
            const leg = p.x >= 0 ? 'thighL' : 'thighR';
            return [[bi('hips'), 1 - down * side * 0.75], [bi(leg), down * side * 0.75]];
        },
    );
    // 袴の脚（幅広。裾が足首の上）。前の襞は腰から脚へ続き、下へ行くほど開く
    const legPleat = (s: number) => (ang: number, t: number) =>
        knife(ang, Math.PI / 2 - s * 0.25, 0.8, 3, 0.05 + 0.03 * t) + knife(ang, -Math.PI / 2, 0.45, 1, 0.035 * t);
    for (const sd of ['L', 'R'] as const) {
        const s = sd === 'L' ? 1 : -1;
        add(
            m.hakama,
            loft(V(s * 0.1, 0.84, -0.005), V(s * 0.118, 0.07, 0.0), [
                { t: 0, rx: 0.108, rz: 0.125 },
                { t: 0.35, rx: 0.135, rz: 0.145 },
                { t: 0.7, rx: 0.148, rz: 0.155 },
                { t: 1, rx: 0.168, rz: 0.172, oz: 0.01 },
            ], 48, 3, { pleat: legPleat(s) }),
            byHeight(`thigh${sd}`, `shin${sd}`, 0.36, 0.56),
        );
        // 裾の布の厚み（外の面から内側へ折り返す縁）
        add(m.hakama, loft(V(s * 0.118, 0.07, 0.0), V(s * 0.118, 0.072, 0.0), [{ t: 0, rx: 0.168, rz: 0.172, oz: 0.01 }, { t: 1, rx: 0.152, rz: 0.156, oz: 0.01 }], 48, 1, { pleat: (ang) => legPleat(s)(ang, 1) }), rigid(`shin${sd}`));
        // 裾の裏（暗く）
        add(m.dark, loft(V(s * 0.118, 0.13, 0.0), V(s * 0.118, 0.075, 0.0), [{ t: 0, rx: 0.135, rz: 0.14 }, { t: 1, rx: 0.162, rz: 0.166, oz: 0.01 }], 16, 1), rigid(`shin${sd}`));
    }
    // 腰板（背中）
    const board = new THREE.BoxGeometry(0.2, 0.12, 0.025);
    board.rotateX(-0.12);
    board.translate(0, 1.0, -0.14);
    add(m.hakama, normalize(board), rigid('hips'));

    // ---- 小袖（胴） ----
    add(
        m.kosode,
        loft(V(0, 0.95, -0.005), V(0, 1.48, -0.01), [
            { t: 0, rx: 0.158, rz: 0.118 },
            { t: 0.2, rx: 0.157, rz: 0.117 },
            { t: 0.45, rx: 0.168, rz: 0.122, oz: 0.004 },
            { t: 0.66, rx: 0.18, rz: 0.122, oz: 0.006 },
            { t: 0.8, rx: 0.182, rz: 0.114 },
            { t: 0.92, rx: 0.15, rz: 0.1 },
            { t: 1, rx: 0.07, rz: 0.062 },
        ], 24, 3),
        (p) => {
            if (p.y < 1.08) {
                const t = smooth(0.96, 1.08, p.y);
                return [[bi('hips'), 1 - t], [bi('spine'), t]];
            }
            const t = smooth(1.12, 1.3, p.y);
            return [[bi('spine'), 1 - t], [bi('chest'), t]];
        },
    );
    // 腰紐
    add(m.himo, loft(V(0, 0.965, -0.005), V(0, 1.01, -0.005), [{ t: 0, rx: 0.172, rz: 0.132 }, { t: 1, rx: 0.17, rz: 0.13 }], 24, 1), rigid('hips'));
    add(m.himo, normalize(new THREE.BoxGeometry(0.07, 0.045, 0.03).translate(0.015, 0.985, 0.132)), rigid('hips'));
    add(m.himo, taperTube([V(0.02, 0.98, 0.14), V(0.035, 0.93, 0.145), V(0.03, 0.88, 0.15)], [0.012, 0.01, 0.008], 5), rigid('hips'));

    // ---- 襟（左前：本人の右の襟が下、左が上） と 白い半襟 ----
    for (const sd of [1, -1]) {
        const top = sd > 0 ? 0.004 : 0;
        const path = [V(sd * 0.035, 1.49, -0.055), V(sd * 0.07, 1.47, 0.0), V(sd * 0.06, 1.42, 0.085), V(-sd * 0.005, 1.31, 0.122 + top), V(-sd * 0.05, 1.2, 0.123 + top)];
        const collar = taperTube(path, [0.019, 0.021, 0.021, 0.02, 0.018], 6, 3);
        add(m.kosodeDark, collar, byHeight('chest', 'spine', 1.18, 1.28));
        const inner = path.map((v) => v.clone().multiply(V(0.8, 1, 0.97)).add(V(0, 0.012, 0)));
        add(m.cord, taperTube(inner.slice(0, 4), [0.011, 0.012, 0.012, 0.011], 5), byHeight('chest', 'spine', 1.18, 1.28));
    }
    // 襟元の肌（首から胸元の V）
    add(m.skin, loft(V(0, 1.43, 0.0), V(0, 1.34, 0.03), [{ t: 0, rx: 0.05, rz: 0.06 }, { t: 1, rx: 0.02, rz: 0.08 }], 10, 2), rigid('chest'));

    // ---- 袖と手 ----
    for (const sd of ['L', 'R'] as const) {
        const s = sd === 'L' ? 1 : -1;
        const sh = V(s * 0.168, 1.372, 0);
        const el = V(s * 0.205, 1.12, 0);
        const wr = V(s * 0.222, 0.885, 0.018);
        // 上腕の袖
        add(m.kosode, loft(sh, el, [
            { t: 0, rx: 0.058, rz: 0.066 },
            { t: 0.5, rx: 0.066, rz: 0.076 },
            { t: 1, rx: 0.072, rz: 0.084 },
        ], 16, 3), (p) => {
            const t = smooth(1.2, 1.1, p.y);
            return [[bi(`upperArm${sd}`), 1 - t], [bi(`foreArm${sd}`), t]];
        });
        // 前腕の袖（袂が後ろ下へ垂れ、前後に広い）
        add(m.kosode, loft(el, wr.clone().add(V(0, 0.03, 0)), [
            { t: 0, rx: 0.072, rz: 0.084 },
            { t: 0.45, rx: 0.07, rz: 0.105, oz: -0.018 },
            { t: 1, rx: 0.064, rz: 0.115, oz: -0.03 },
        ], 32, 3, {
            capEnd: false,
            // 袂のたるみ：下側（後ろ下へ垂れる側）に縦のしわ、肘から袖口へ深くなる
            pleat: (ang, t) => {
                const under = Math.max(0, -Math.sin(ang));
                return t * under * 0.07 * Math.pow(Math.abs(Math.sin(ang * 5 + t * 1.5)), 2.5) + 0.02 * t * Math.pow(Math.abs(Math.sin(ang * 3)), 4);
            },
        }), (p) => {
            const t = smooth(1.14, 1.06, p.y);
            return [[bi(`upperArm${sd}`), 1 - t], [bi(`foreArm${sd}`), t]];
        });
        // 袖口の布の厚み（縁）
        add(m.kosode, loft(wr.clone().add(V(0, 0.03, 0)), wr.clone().add(V(0, 0.034, 0)), [{ t: 0, rx: 0.066, rz: 0.117, oz: -0.03 }, { t: 1, rx: 0.056, rz: 0.104, oz: -0.03 }], 20, 1), rigid(`foreArm${sd}`));
        // 袖口の奥（暗く）
        add(m.kosodeDark, loft(wr.clone().add(V(0, 0.045, 0)), wr.clone().add(V(0, 0.03, 0)), [{ t: 0, rx: 0.06, rz: 0.1, oz: -0.03 }, { t: 1, rx: 0.068, rz: 0.125, oz: -0.035 }], 14, 1, { capStart: true }), rigid(`foreArm${sd}`));
        // 手首と手（手のひらは体の側を向く）
        const tip = V(s * 0.226, 0.71, 0.03);
        add(m.skin, loft(wr.clone().add(V(0, 0.02, 0)), tip, [
            { t: 0, rx: 0.022, rz: 0.028 },
            { t: 0.25, rx: 0.022, rz: 0.04 },
            { t: 0.5, rx: 0.02, rz: 0.044 },
            { t: 0.8, rx: 0.016, rz: 0.036 },
            { t: 1, rx: 0.008, rz: 0.018 },
        ], 12, 2, { capEnd: true }), (p) => {
            const t = smooth(0.9, 0.86, p.y);
            return [[bi(`foreArm${sd}`), 1 - t], [bi(`hand${sd}`), t]];
        });
        // 親指
        add(m.skin, taperTube([V(s * 0.214, 0.845, 0.045), V(s * 0.208, 0.81, 0.06), V(s * 0.205, 0.785, 0.062)], [0.012, 0.01, 0.008], 6), rigid(`hand${sd}`));
    }

    // ---- 首・頭・髪・髷 ----
    add(m.skin, loft(V(0, 1.43, -0.01), V(0, 1.575, 0.002), [{ t: 0, rx: 0.05, rz: 0.048 }, { t: 1, rx: 0.046, rz: 0.045 }], 14, 2), byHeight('head', 'chest', 1.46, 1.54));
    const { face, hair } = buildHead();
    add(m.face, face, rigid('head'));
    add(m.hair, hair, rigid('head'));
    add(m.skin, taperTube([V(0, 1.642, 0.1), V(0, 1.622, 0.112), V(0, 1.604, 0.116)], [0.008, 0.012, 0.014], 7), rigid('head'));
    for (const s of [1, -1]) add(m.skin, ellipsoid(V(s * 0.08, 1.622, -0.004), [0.012, 0.027, 0.019], 8), rigid('head'));
    // 茶筅髷：頭頂のやや後ろで元結で結い、毛先を後ろへ
    add(m.cord, taperTube([V(0, 1.745, -0.03), V(0, 1.758, -0.055), V(0, 1.764, -0.075)], [0.021, 0.021, 0.02], 8), rigid('head'));
    add(m.hair, taperTube([V(0, 1.764, -0.075), V(0, 1.772, -0.1), V(0, 1.772, -0.13), V(0, 1.762, -0.158)], [0.017, 0.019, 0.022, 0.012], 8), rigid('head'));

    // ---- 足袋・草履 ----
    for (const sd of ['L', 'R'] as const) {
        const s = sd === 'L' ? 1 : -1;
        const x = s * 0.112;
        add(m.tabi, loft(V(x, 0.13, -0.01), V(x, 0.05, 0.0), [{ t: 0, rx: 0.038, rz: 0.042 }, { t: 1, rx: 0.042, rz: 0.05 }], 12, 1), rigid(`foot${sd}`));
        add(m.tabi, loft(V(x, 0.045, -0.055), V(x, 0.035, 0.175), [
            { t: 0, rx: 0.036, rz: 0.035 },
            { t: 0.25, rx: 0.042, rz: 0.042 },
            { t: 0.7, rx: 0.044, rz: 0.03 },
            { t: 1, rx: 0.03, rz: 0.016 },
        ], 12, 2, { capStart: true, capEnd: true }), rigid(`foot${sd}`));
        const sole = new THREE.BoxGeometry(0.11, 0.028, 0.27, 1, 1, 2);
        sole.translate(x, 0.014, 0.055);
        add(m.zori, normalize(sole), rigid(`foot${sd}`));
        for (const k of [1, -1]) add(m.strap, taperTube([V(x + 0.004, 0.06, 0.145), V(x + k * 0.03, 0.058, 0.09), V(x + k * 0.046, 0.03, 0.045)], [0.007, 0.007, 0.006], 5), rigid(`foot${sd}`));
    }

    // ---- 大小（左の腰） ----
    const hilt = V(-0.3, 0.42, 1).normalize();
    for (const [base, blade, grip, r] of [
        [V(0.19, 0.975, 0.105), 0.7, 0.25, 0.021],
        [V(0.14, 1.0, 0.125), 0.48, 0.17, 0.018],
    ] as const) {
        const tsubaPos = base.clone();
        add(m.lacquer, taperTube([tsubaPos, tsubaPos.clone().add(hilt.clone().multiplyScalar(-blade * 0.5)).add(V(0, -0.01, 0)), tsubaPos.clone().add(hilt.clone().multiplyScalar(-blade))], [r * 1.05, r, r * 0.85], 7, 4), rigid('hips'));
        add(m.tsuka, taperTube([tsubaPos, tsubaPos.clone().add(hilt.clone().multiplyScalar(grip))], [r * 0.95, r * 0.85], 7, 8), rigid('hips'));
        const tsuba = new THREE.CylinderGeometry(r * 2.3, r * 2.3, 0.008, 12);
        tsuba.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), hilt));
        tsuba.translate(tsubaPos.x, tsubaPos.y, tsubaPos.z);
        add(m.brass, normalize(tsuba), rigid('hips'));
        const kashira = tsubaPos.clone().add(hilt.clone().multiplyScalar(grip));
        add(m.brass, ellipsoid(kashira, [r * 0.9, r * 0.9, r * 0.9], 8), rigid('hips'));
    }

    // ---- 骨と Mesh ----
    const bones = BONES.map((d) => {
        const bone = new THREE.Bone();
        bone.name = d.name;
        return bone;
    });
    BONES.forEach((d, i) => {
        if (d.parent) {
            const pi = bi(d.parent);
            bones[pi].add(bones[i]);
            bones[i].position.copy(d.pos).sub(BONES[pi].pos);
        } else bones[i].position.copy(d.pos);
    });
    const skeleton = new THREE.Skeleton(bones);
    const root = new THREE.Group();
    root.name = '若殿';
    root.add(bones[0]);
    root.updateMatrixWorld(true);
    for (const [mat, geos] of parts) {
        const merged = mergeAll(geos);
        const mesh = new THREE.SkinnedMesh(merged, mat);
        mesh.name = `若殿-${mat.name}`;
        mesh.userData = { cast: true, receive: true };
        root.add(mesh);
        mesh.bind(skeleton);
    }
    return { root, clips: [idleClip(), walkClip()] };
}

/** 材質ごとにまとめる（skinIndex / skinWeight を含めて属性をそろえてある） */
function mergeAll(geos: Geo[]): Geo {
    const g = mergeGeometries(geos, false);
    if (!g) throw new Error('若殿の形をまとめられませんでした');
    g.computeBoundingSphere();
    return g;
}

// ---------------------------------------------------------------------------
// 動き
// ---------------------------------------------------------------------------

const pos = (x: number) => Math.max(0, x);
const FPS = 30;

type Pose = Record<string, { rot?: [number, number, number]; pos?: [number, number, number] }>;

function clipFrom(name: string, duration: number, pose: (t: number) => Pose): THREE.AnimationClip {
    const frames = Math.round(duration * FPS);
    const times: number[] = [];
    const rot = new Map<string, number[]>();
    const trans = new Map<string, number[]>();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let f = 0; f <= frames; f++) {
        const t = (f / frames) * duration;
        times.push(t);
        const p = pose(t);
        for (const b of BONES) {
            const k = p[b.name];
            const r = k?.rot ?? [0, 0, 0];
            e.set(r[0], r[1], r[2], 'YXZ');
            q.setFromEuler(e);
            const list = rot.get(b.name) ?? [];
            list.push(q.x, q.y, q.z, q.w);
            rot.set(b.name, list);
            if (k?.pos) {
                const tl = trans.get(b.name) ?? [];
                tl.push(...k.pos);
                trans.set(b.name, tl);
            }
        }
    }
    const tracks: THREE.KeyframeTrack[] = [];
    for (const [n, v] of rot) {
        // 動かず、組み立て時の姿勢のままの骨だけを省く（一定の角度で曲げた骨は残す）
        const still = v.every((x, i) => Math.abs(x - v[i % 4]) < 1e-6);
        const rest = Math.abs(Math.abs(v[3]) - 1) < 1e-6;
        if (!(still && rest)) tracks.push(new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, v));
    }
    for (const [n, v] of trans) tracks.push(new THREE.VectorKeyframeTrack(`${n}.position`, times, v));
    return new THREE.AnimationClip(name, duration, tracks);
}

const HIPS_Y = 0.93;

function walkClip(): THREE.AnimationClip {
    const T = WALK_PERIOD;
    return clipFrom('walk', T, (t) => {
        const ph = (t / T) * Math.PI * 2;
        const leg = (p: number) => {
            const th = 0.4 * Math.sin(p);
            const k = 0.07 + 0.85 * Math.pow(pos(Math.cos(p + 0.35)), 2) + 0.12 * Math.pow(pos(Math.sin(p - 2.2)), 3);
            const foot = th - k + 0.38 * Math.pow(pos(-Math.sin(p)), 3) - 0.16 * Math.pow(pos(Math.sin(p)), 4);
            return { thigh: -th, shin: k, foot };
        };
        const L = leg(ph);
        const R = leg(ph + Math.PI);
        // 左手は刀の柄に添えたまま（腰と一緒に動く）。右腕だけを小さく振る
        const aR = 0.2 * Math.sin(ph);
        return {
            hips: { pos: [-0.014 * Math.cos(ph), HIPS_Y - 0.004 + 0.015 * Math.cos(2 * ph), 0], rot: [0.02, -0.05 * Math.sin(ph), 0.02 * Math.cos(ph)] },
            spine: { rot: [0.03, 0.02 * Math.sin(ph), 0] },
            chest: { rot: [0.03 + 0.01 * Math.cos(2 * ph), 0.03 * Math.sin(ph), -0.015 * Math.cos(ph)] },
            neck: { rot: [-0.02, -0.05 * Math.sin(ph), 0] },
            head: { rot: [0.02, -0.02 * Math.sin(ph), 0.01 * Math.cos(ph)] },
            thighL: { rot: [L.thigh, 0, 0] },
            shinL: { rot: [L.shin, 0, 0] },
            footL: { rot: [L.foot, 0, 0] },
            thighR: { rot: [R.thigh, 0, 0] },
            shinR: { rot: [R.shin, 0, 0] },
            footR: { rot: [R.foot, 0, 0] },
            upperArmL: { rot: [0.18 + 0.01 * Math.sin(ph), -0.4, 0.14] },
            foreArmL: { rot: [-1.34, 0, 0] },
            handL: { rot: [1.08, 0, -0.48] },
            upperArmR: { rot: [aR, 0, -0.07] },
            foreArmR: { rot: [-(0.2 + 0.2 * pos(-aR)), 0, 0] },
            handR: { rot: [-0.1, 0, 0] },
        };
    });
}

function idleClip(): THREE.AnimationClip {
    const T = 4;
    return clipFrom('idle', T, (t) => {
        const w = (t / T) * Math.PI * 2;
        const breathe = Math.sin(w * 2);
        return {
            hips: { pos: [0.008 * Math.sin(w), HIPS_Y - 0.006, 0], rot: [0, 0.02 * Math.sin(w), 0.012 * Math.sin(w)] },
            spine: { rot: [0.01 * breathe, 0, -0.008 * Math.sin(w)] },
            chest: { rot: [0.012 * breathe, -0.015 * Math.sin(w), 0] },
            neck: { rot: [0.01, 0, 0] },
            head: { rot: [0.03 + 0.01 * Math.sin(w * 0.5), 0.05 * Math.sin(w * 0.5), 0] },
            thighL: { rot: [-0.03, 0, 0.015] },
            shinL: { rot: [0.05, 0, 0] },
            footL: { rot: [-0.02, 0, 0] },
            thighR: { rot: [0.04, 0, -0.03] },
            shinR: { rot: [0.03, 0, 0] },
            footR: { rot: [-0.07, 0, 0] },
            upperArmL: { rot: [0.18 - 0.005 * breathe, -0.4, 0.14] },
            foreArmL: { rot: [-1.34, 0, 0] },
            handL: { rot: [1.08, 0, -0.48] },
            upperArmR: { rot: [0.05 - 0.01 * breathe, 0, -0.1] },
            foreArmR: { rot: [-0.26, 0, 0] },
            handR: { rot: [-0.08, 0, 0] },
        };
    });
}
