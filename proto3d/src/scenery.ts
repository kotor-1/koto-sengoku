/**
 * 遠景と中景（どれもこのコードで作る形と色。画像のファイルは読まない）：
 * - 空（青いグラデーション・日の周りの明るさ・薄い雲）。
 * - 遠景（Version 28）：丘・山の重なり 3 段（手前ほど濃く、奥ほど空の地平の色へ溶ける。手前の段ほど低く、北と西が高く南は低い）。
 *   霧（scene.fog）は使わず、段ごとの空気の遠近と、裾ほど白む靄を頂点の色に入れる（霧で平らな淡い壁に見えないように）。
 * - 中景（Version 28）：歩ける範囲の外の竹垣・隣の町並みの屋根と壁・木立・田畑の縁の並木・田畑の先の村（置き方は town/surround.ts）。
 *   画像はコードで描く 1 枚（升目に屋根・壁・葉・竹垣の模様）だけ。まとまりごとに 1 つの形・1 回の描画。影は落とさない・受けない。
 */
import * as THREE from 'three';
import { surroundPlan, type RoofKind, type SurroundCluster, type SurroundHouse, type SurroundPlan, type SurroundTree, type TreeKind, type WallKind } from './town/surround';

/**
 * 空の色（sRGB）。晴れた日の濃い青の空。地平に近いほど淡い。
 * haze は空気の遠近（霧）の色：遠い物が寄っていく、わずかに青い地平の色。
 */
export const SKY = { zenith: '#1d4f9e', mid: '#4f86c6', horizon: '#b4cde3', haze: '#a8c0d8', sunGlow: '#ffd09a' } as const;

/**
 * 町を歩くとき（肩越しのカメラ）の光と霧（main.ts が使う。Version 28）。
 * - 日（sunOffset：影の範囲の真ん中から日の位置への差。x 東・y 上・z 南）：南南東の高め（高さ約 42°、真南から東へ約 27°）。晴れた昼前。
 *   通りは南北なので、西の町家（A・B。表が東）の表に浅く日が当たり、東の店（D・土蔵造り）の表は陰になる
 *   （Version 27 までは南南西の低い日 (−5, 12, 16)：西の町家の表がいつも逆光で、陰の青みと合わせて青黒かった）。
 *   開始の画面（町の入口から北を見る）では日は右うしろ：主人公の背と城門の正面が日なた。
 * - 空と地面の照り返し（hemi）：空はわずかに青く、地面は日の当たる土の道の色。陰の側の明るさは主にこれで決める。
 * - 照り返しの補い（bounce）：日の反対（北北西）の低い所からの、影を作らない弱い暖かい光。陰になる東の店の表と、人物の日の当たらない側
 *  （北を向いて話す人の顔・胸）を、青黒くせずに形が読める明るさにする。
 * - 霧（fog）：通り（〜30 m）にはかけず、門越しの天守（約 140 m）に半分ほど。遠景の山並みは霧を使わない（makeHills が色で空気の遠近を付ける）。
 * 合戦の画面（battle/view.ts）は自分の光を持つので変わらない（描画の露出 toneMappingExposure も変えない）
 */
export const TOWN_LIGHT = {
    sunOffset: [7, 14, 14],
    sun: { color: '#ffe2bd', intensity: 4.6 },
    hemi: { sky: '#b4c8e4', ground: '#a68a66', intensity: 1.45 },
    bounce: { color: '#ffd9b4', intensity: 0.55, height: 4 },
    fog: { near: 30, far: 260 },
} as const;

export function makeSky(sunDir: THREE.Vector3): THREE.Mesh {
    const g = new THREE.SphereGeometry(900, 48, 24);
    const m = new THREE.ShaderMaterial({
        uniforms: {
            sunDir: { value: sunDir.clone().normalize() },
            zenith: { value: new THREE.Color(SKY.zenith) },
            mid: { value: new THREE.Color(SKY.mid) },
            horizon: { value: new THREE.Color(SKY.horizon) },
            glow: { value: new THREE.Color(SKY.sunGlow) },
        },
        vertexShader: /* glsl */ `
            varying vec3 vDir;
            void main() {
                vDir = normalize(position);
                vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                gl_Position = p.xyww; // いちばん奥に描く
            }`,
        fragmentShader: /* glsl */ `
            uniform vec3 sunDir;
            uniform vec3 zenith;
            uniform vec3 mid;
            uniform vec3 horizon;
            uniform vec3 glow;
            varying vec3 vDir;
            float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
            }
            float fbm(vec2 p) {
                float s = 0.0;
                float a = 0.5;
                for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
                return s;
            }
            void main() {
                vec3 d = normalize(vDir);
                float h = max(d.y, 0.0);
                vec3 sd = normalize(sunDir);
                // 地平（淡い）→ 中ほど（青）→ 天頂（濃い青）
                vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, pow(h, 0.8)));
                col = mix(col, zenith, smoothstep(0.12, 0.85, h));
                // 日の側の地平を明るく暖かく（午後遅くの光のかすみ）
                float s = max(dot(d, sd), 0.0);
                col += glow * (pow(s, 5.0) * 0.35 * (1.0 - h) + pow(s, 48.0) * 0.6);
                // 積雲：形のはっきりした白い雲（日の側が明るく、下側と日の反対側は青灰色）。地平に近い所に多く、天頂には少ない
                vec2 uv = d.xz / (d.y + 0.12) * 0.9;
                vec2 w = vec2(fbm(uv * 0.7 + vec2(1.7, 9.2)), fbm(uv * 0.7 + vec2(8.3, 2.8)));
                vec2 p = uv + (w - 0.5) * 1.1 + vec2(3.1, 7.7);
                float n = fbm(p);
                float cover = 0.56 - 0.1 * smoothstep(0.05, 0.5, h);
                float dens = smoothstep(cover, cover + 0.16, n) * smoothstep(0.015, 0.12, h) * (1.0 - smoothstep(0.55, 0.9, h));
                // 日の方へ少しずらした所の濃さで、雲の中の陰を決める（簡単な自己陰）
                vec2 toSun = normalize(sd.xz + 1e-4) * 0.08;
                float n2 = fbm(p + toSun);
                float lit = clamp(0.5 + (n - n2) * 6.0, 0.0, 1.0);
                lit = mix(lit, 1.0, 0.25) * (0.75 + 0.25 * smoothstep(0.0, 0.3, h));
                vec3 cloudShade = vec3(0.50, 0.58, 0.72);
                vec3 cloudLit = mix(vec3(1.25, 1.24, 1.22), vec3(1.45, 1.3, 1.1), pow(s, 3.0));
                vec3 cloud = mix(cloudShade, cloudLit, lit);
                col = mix(col, cloud, dens * 0.95);
                // 地平より下は地平の色（山並みの向こう）
                if (d.y < 0.0) col = horizon;
                gl_FragColor = vec4(col, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.name = '空';
    mesh.renderOrder = -1;
    mesh.frustumCulled = false;
    return mesh;
}

// ================================================================ 遠景：丘・山の重なり

/**
 * 周期つきの値 0〜1（角度 a。整数の波の数だけを使うので 1 周でつながる）。peaky なら峰を尖らせる（山。谷は広く、頂は細く）。
 * 波の数は、段の 1 周の頂点の数で描ける細かさまで（細かすぎる波は、頂点の間隔で崖のような段になる）
 */
function waves(a: number, seed: number, peaky: boolean): number {
    const ks = [3, 5, 8, 13, 21, 34];
    const amps = [0.36, 0.26, 0.17, 0.11, 0.06, 0.04];
    let s = 0;
    let n = 0;
    for (let i = 0; i < ks.length; i++) {
        const ph = seed * 2.399 + i * 1.731;
        const w = Math.sin(ks[i]! * a + ph) * 0.6 + Math.sin((ks[i]! + 1) * a + ph * 1.37) * 0.4;
        s += amps[i]! * (0.5 + 0.5 * w);
        n += amps[i]!;
    }
    const v = s / n;
    return peaky ? Math.pow(THREE.MathUtils.smoothstep(v, 0.28, 0.78), 1.8) : v;
}

/**
 * 山並みの段（遠い順に後ろ）。r：稜線までの距離、front：手前の裾の距離、h0〜h1：高さ（低い所〜高い所。北と西ほど高い）、
 * color：山肌の色（sRGB）、haze：空気の遠近の濃さ（0 で山肌の色のまま、1 で空の地平の色）、peaky：峰の尖った山（奥の 2 段）、n：1 周の頂点の数
 */
export const RANGES = [
    { name: '近い丘', r: 238, front: 182, h0: 7, h1: 30, color: '#2c4733', haze: 0.28, seed: 3, peaky: false, n: 240 },
    { name: '中の山', r: 430, front: 330, h0: 14, h1: 80, color: '#334d5c', haze: 0.5, seed: 11, peaky: true, n: 300 },
    { name: '奥の山', r: 780, front: 620, h0: 24, h1: 168, color: '#4f6686', haze: 0.6, seed: 23, peaky: true, n: 360 },
] as const;

/** 山の高さの向きの重み（0 = 北（−z）、東回り）。北北西が高く、南（平野・田畑の続く方）は低い */
function rangeEnvelope(a: number): number {
    return 0.5 + 0.5 * Math.cos(a + 0.6);
}

/**
 * 町を囲む山並み 3 段。sunDir（日のある向き）で山肌に明暗を付け、段ごとに空の地平の色へ寄せる（裾ほど白む）。
 * 光と霧の計算はしない（頂点の色をそのまま出す。空の絵と同じ色の決まり）。
 */
export function makeHills(sunDir: THREE.Vector3): THREE.Group {
    const group = new THREE.Group();
    group.name = '山並み';
    const sun = sunDir.clone().normalize();
    const horizon = new THREE.Color(SKY.horizon);
    const haze = new THREE.Color(SKY.haze);
    for (const k of RANGES) {
        const base = new THREE.Color(k.color);
        const N = k.n;
        // 頂点：手前の裾（地面の下）・中腹・稜線の 3 列
        const ring: { x: number; z: number; y: number }[][] = [];
        for (let i = 0; i <= N; i++) {
            const a = (i / N) * Math.PI * 2;
            const env = k.name === '近い丘' ? 0.55 + 0.45 * rangeEnvelope(a) : 0.3 + 0.7 * rangeEnvelope(a);
            const n = waves(a, k.seed, k.peaky);
            const h = k.h0 * (0.6 + 0.4 * env) + (k.h1 - k.h0) * env * n;
            const rr = k.r + (k.r - k.front) * 0.25 * (waves(a, k.seed + 5, false) - 0.5);
            const dx = Math.sin(a);
            const dz = -Math.cos(a);
            const mid = k.front + (rr - k.front) * 0.62;
            ring.push([
                { x: dx * k.front, z: dz * k.front, y: -6 },
                { x: dx * mid, z: dz * mid, y: h * 0.62 },
                { x: dx * rr, z: dz * rr, y: h },
            ]);
        }
        const pos: number[] = [];
        const col: number[] = [];
        const c = new THREE.Color();
        const nrm = new THREE.Vector3();
        const e1 = new THREE.Vector3();
        const e2 = new THREE.Vector3();
        const vert = (p: { x: number; y: number; z: number }, shade: number, hTop: number) => {
            pos.push(p.x, p.y, p.z);
            // 山肌の明暗（日の側が明るい）→ 段の空気の遠近 → 裾の靄（低い所ほど白む）
            const low = 1 - THREE.MathUtils.clamp(p.y / Math.max(hTop, 1), 0, 1);
            const hz = THREE.MathUtils.clamp(k.haze + (1 - k.haze) * 0.45 * low * low, 0, 1);
            c.copy(base).multiplyScalar(shade).lerp(k.haze > 0.5 ? horizon : haze, hz);
            col.push(c.r, c.g, c.b);
        };
        for (let i = 0; i < N; i++) {
            const A = ring[i]!;
            const B = ring[i + 1]!;
            for (let j = 0; j < 2; j++) {
                const p0 = A[j]!;
                const p1 = B[j]!;
                const p2 = B[j + 1]!;
                const p3 = A[j + 1]!;
                // 面の向き（内側＝町の方）から明暗
                e1.set(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
                e2.set(p3.x - p0.x, p3.y - p0.y, p3.z - p0.z);
                nrm.crossVectors(e2, e1).normalize();
                if (nrm.x * p0.x + nrm.z * p0.z > 0) nrm.negate();
                const shade = 0.62 + 0.55 * Math.max(0, nrm.dot(sun));
                const hTop = Math.max(A[2]!.y, B[2]!.y);
                for (const p of [p0, p1, p2, p0, p2, p3]) vert(p, shade, hTop);
            }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(g, mat);
        mesh.name = `山並み-${k.name}`;
        // 奥の段から描く（手前の段が上に重なる。深さでも決まるが、同じ距離の継ぎ目で揺れないように）
        mesh.renderOrder = -1 + RANGES.indexOf(k) * -0.01;
        mesh.frustumCulled = false;
        group.add(mesh);
    }
    return group;
}

// ================================================================ 中景：竹垣・隣の町並み・木立・村

/** 模様の升目（4×4。scenery の画像の中の位置） */
const CELL = {
    roof_tile: [0, 0], roof_board: [1, 0], roof_thatch: [2, 0], soffit: [3, 0],
    wall_front: [0, 1], wall_plaster: [1, 1], wall_board: [2, 1], wall_earth: [3, 1],
    leaf_broad: [0, 2], leaf_pine: [1, 2], leaf_bamboo: [2, 2], bark: [3, 2],
    fence: [0, 3], leaf_hedge: [1, 3], gable: [2, 3],
} as const satisfies Record<string, readonly [number, number]>;
type CellId = keyof typeof CELL;
const ROOF_CELL: Record<RoofKind, CellId> = { tile: 'roof_tile', board: 'roof_board', thatch: 'roof_thatch' };
const WALL_CELL: Record<WallKind, CellId> = { front: 'wall_front', plaster: 'wall_plaster', board: 'wall_board', earth: 'wall_earth' };
const LEAF_CELL: Record<TreeKind, CellId> = { broad: 'leaf_broad', pine: 'leaf_pine', bamboo: 'leaf_bamboo', hedge: 'leaf_hedge' };
/** 升目の縁の余白（遠くで隣の升目の色がにじまないように） */
const CELL_PAD = 0.07;

/** 升目の中の (u, v)（0〜1）を画像全体の uv へ（画像は上下を返して貼る：升目の行 0 が上） */
function cellUv(id: CellId, u: number, v: number): [number, number] {
    const [cx, cy] = CELL[id];
    const uu = CELL_PAD + (1 - 2 * CELL_PAD) * THREE.MathUtils.clamp(u, 0, 1);
    const vv = CELL_PAD + (1 - 2 * CELL_PAD) * THREE.MathUtils.clamp(v, 0, 1);
    return [(cx + uu) / 4, 1 - (cy + 1 - vv) / 4];
}

/** 形の組み立て（三角形ごとに頂点を持つ。法線・uv・色つき） */
class Builder {
    readonly pos: number[] = [];
    readonly nrm: number[] = [];
    readonly uv: number[] = [];
    readonly col: number[] = [];
    private readonly a = new THREE.Vector3();
    private readonly b = new THREE.Vector3();

    /** 頂点 1 つ */
    v(p: THREE.Vector3Like, n: THREE.Vector3Like, uv: [number, number], c: number): void {
        this.pos.push(p.x, p.y, p.z);
        this.nrm.push(n.x, n.y, n.z);
        this.uv.push(uv[0], uv[1]);
        this.col.push(c, c, c);
    }

    /** 四角形 p0→p1→p2→p3（表から見て反時計回り）。cell の (0,0)〜(1,1) を貼る。c0（下の辺 p0p1）・c1（上の辺）の明るさ */
    quad(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, cell: CellId, c0: number, c1: number, tint = 1): void {
        const n = this.a.subVectors(p1, p0).cross(this.b.subVectors(p3, p0)).normalize().clone();
        const q: [THREE.Vector3, [number, number], number][] = [
            [p0, cellUv(cell, 0, 0), c0 * tint],
            [p1, cellUv(cell, 1, 0), c0 * tint],
            [p2, cellUv(cell, 1, 1), c1 * tint],
            [p3, cellUv(cell, 0, 1), c1 * tint],
        ];
        for (const i of [0, 1, 2, 0, 2, 3]) this.v(q[i]![0], n, q[i]![1], q[i]![2]);
    }

    /** 三角形（妻壁）。uv は升目の中の値 */
    tri(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, uv: [number, number][], cell: CellId, c: number[]): void {
        const n = this.a.subVectors(p1, p0).cross(this.b.subVectors(p2, p0)).normalize().clone();
        [p0, p1, p2].forEach((p, i) => this.v(p, n, cellUv(cell, uv[i]![0], uv[i]![1]), c[i]!));
    }

    get triangles(): number {
        return this.pos.length / 9;
    }

    geometry(): THREE.BufferGeometry {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
        g.computeBoundingSphere();
        g.computeBoundingBox();
        return g;
    }

    /** 冠の絵の板 1 枚（表と裏の 2 面。法線は頂点ごとに渡す。uv は冠の絵の画像の中の値） */
    card(p: THREE.Vector3[], n: THREE.Vector3[], uv: [number, number][], c: number[]): void {
        for (const i of [0, 1, 2, 0, 2, 3]) this.v(p[i]!, n[i]!, uv[i]!, c[i]!);
        for (const i of [1, 0, 3, 1, 3, 2]) this.v(p[i]!, n[i]!, uv[i]!, c[i]!);
    }

    /** 2 つの組み立てをつなぐ（前の材質 0：模様の画像、後ろの材質 1：冠の絵）。group で材質を分ける */
    static merged(a: Builder, b: Builder | undefined): THREE.BufferGeometry {
        if (!b || !b.pos.length) {
            const g = a.geometry();
            g.addGroup(0, a.pos.length / 3, 0);
            return g;
        }
        const m = new Builder();
        for (const k of ['pos', 'nrm', 'uv', 'col'] as const) for (const src of [a[k], b[k]]) for (const x of src) m[k].push(x);
        const g = m.geometry();
        g.addGroup(0, a.pos.length / 3, 0);
        g.addGroup(a.pos.length / 3, b.pos.length / 3, 1);
        return g;
    }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * 家 1 軒：壁 4 面（表に格子の模様）、妻壁 2 枚、屋根 2 面（上と軒裏）、棟。棟の向き・軒の出・けらばの出は家の大きさから。
 * 地面に少し埋める（起伏で浮かない）
 */
function addHouse(b: Builder, h: SurroundHouse): void {
    // 棟が z に沿う家を基準に組み、棟が x に沿う家は x と z を入れ替えて置く
    const sw = h.ridgeAlongZ;
    const P = (a: number, y: number, c: number) => (sw ? V(a, y, c) : V(c, y, a));
    const a0 = sw ? h.x0 : h.z0;
    const a1 = sw ? h.x1 : h.z1;
    const c0 = sw ? h.z0 : h.x0;
    const c1 = sw ? h.z1 : h.x1;
    const am = (a0 + a1) / 2;
    const e = h.eave;
    const ridge = e + h.pitch * (a1 - a0) / 2;
    const y0 = -0.3;
    const t = h.tint;
    const wall = WALL_CELL[h.wall];
    // 表の面：front の向きの壁だけ格子の模様（ほかは漆喰か板・土の壁）
    const frontA = sw ? (h.front === 'x+' ? 1 : h.front === 'x-' ? -1 : 0) : (h.front === 'z+' ? 1 : h.front === 'z-' ? -1 : 0);
    const back = WALL_CELL[h.back];
    const sideCell = (dir: number): CellId => (dir === frontA ? wall : back);
    // 入れ替えたとき（x と z）は面の向き（巻き）が逆になるので、四角形の順を逆にする
    const q = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, cell: CellId, k0: number, k1: number, tint = t) =>
        sw ? b.quad(p0, p1, p2, p3, cell, k0, k1, tint) : b.quad(p1, p0, p3, p2, cell, k0, k1, tint);
    // 長い壁（棟と平行。a0 の側・a1 の側）
    q(P(a1, y0, c1), P(a1, y0, c0), P(a1, e, c0), P(a1, e, c1), sideCell(1), 0.62, 0.8);
    q(P(a0, y0, c0), P(a0, y0, c1), P(a0, e, c1), P(a0, e, c0), sideCell(-1), 0.62, 0.8);
    // 妻側の壁（短い壁）と妻壁の三角
    q(P(a0, y0, c1), P(a1, y0, c1), P(a1, e, c1), P(a0, e, c1), back, 0.62, 0.82);
    q(P(a1, y0, c0), P(a0, y0, c0), P(a0, e, c0), P(a1, e, c0), back, 0.62, 0.82);
    const gc = h.roof === 'thatch' ? 'roof_thatch' : 'gable';
    const tg = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3) => (sw ? b.tri(p0, p1, p2, [[0, 0], [1, 0], [0.5, 1]], gc, [0.8 * t, 0.8 * t, 0.9 * t]) : b.tri(p1, p0, p2, [[0, 0], [1, 0], [0.5, 1]], gc, [0.8 * t, 0.8 * t, 0.9 * t]));
    tg(P(a0, e, c1), P(a1, e, c1), P(am, ridge, c1));
    tg(P(a1, e, c0), P(a0, e, c0), P(am, ridge, c0));
    // 屋根：軒の出 o（棟と直角）、けらばの出 og（棟の向き）
    const o = h.roof === 'thatch' ? 0.9 : 0.65;
    const og = h.roof === 'thatch' ? 0.6 : 0.4;
    const ye = e - h.pitch * o;
    const rc = ROOF_CELL[h.roof];
    const th = h.roof === 'thatch' ? 0.35 : 0.12;
    for (const s of [1, -1]) {
        const ae = s > 0 ? a1 + o : a0 - o;
        // 上の面（軒 → 棟）・軒裏（暗い板）・軒先の木口。面の向き（巻き）は軒の側で逆になる
        if (s < 0) {
            q(P(ae, ye, c0 - og), P(ae, ye, c1 + og), P(am, ridge + th, c1 + og), P(am, ridge + th, c0 - og), rc, 0.92, 1.05);
            q(P(ae, ye - th, c1 + og), P(ae, ye - th, c0 - og), P(am, ridge, c0 - og), P(am, ridge, c1 + og), 'soffit', 0.45, 0.3, 1);
            q(P(ae, ye - th, c0 - og), P(ae, ye - th, c1 + og), P(ae, ye, c1 + og), P(ae, ye, c0 - og), 'soffit', 0.6, 0.6, 1);
        } else {
            q(P(ae, ye, c1 + og), P(ae, ye, c0 - og), P(am, ridge + th, c0 - og), P(am, ridge + th, c1 + og), rc, 0.92, 1.05);
            q(P(ae, ye - th, c0 - og), P(ae, ye - th, c1 + og), P(am, ridge, c1 + og), P(am, ridge, c0 - og), 'soffit', 0.45, 0.3, 1);
            q(P(ae, ye - th, c1 + og), P(ae, ye - th, c0 - og), P(ae, ye, c0 - og), P(ae, ye, c1 + og), 'soffit', 0.6, 0.6, 1);
        }
    }
    // 棟（瓦・板の家は細い暗い棟、茅葺きは太い棟）
    const rw = h.roof === 'thatch' ? 0.45 : 0.18;
    const rh = h.roof === 'thatch' ? 0.4 : 0.22;
    const ry = ridge + th;
    q(P(am - rw, ry - 0.05, c0 - og), P(am - rw, ry - 0.05, c1 + og), P(am, ry + rh, c1 + og), P(am, ry + rh, c0 - og), 'soffit', 0.75, 0.9, 1);
    q(P(am + rw, ry - 0.05, c1 + og), P(am + rw, ry - 0.05, c0 - og), P(am, ry + rh, c0 - og), P(am, ry + rh, c1 + og), 'soffit', 0.75, 0.9, 1);
}

/** 木の冠の色の明るさ（下ほど暗く、上ほど明るい） */
function crownShade(yn: number): number {
    return 0.5 + 0.55 * THREE.MathUtils.clamp(yn, 0, 1);
}

/** 正二十面体（細かさ 0 か 1）の球の頂点（単位球。三角形ごとに 3 つ：three の多面体は頂点を共有しない形） */
const ICO = [0, 1].map((d) => new THREE.IcosahedronGeometry(1, d).getAttribute('position').array as Float32Array);

/** 冠の塊 1 つ：中心 (cx, cy, cz)、半径 rx・ry（横・縦）、表面の揺らぎ。法線は中心から外へ（柔らかい陰） */
function addBlob(b: Builder, cx: number, cy: number, cz: number, rx: number, ry: number, detail: 0 | 1, cell: CellId, tint: number, seed: number, yBase: number, yTop: number): void {
    const src = ICO[detail]!;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < src.length; i += 3) {
        const x = src[i]!;
        const y = src[i + 1]!;
        const z = src[i + 2]!;
        // 頂点の位置で決まる揺らぎ（隣の三角形と同じ頂点は同じ値：割れ目ができない）
        const j = 1 + 0.16 * Math.sin(x * 5.1 + seed) * Math.cos(z * 4.3 + seed * 1.7) + 0.08 * Math.sin(y * 7.7 + seed * 0.3);
        p.set(cx + x * rx * j, cy + y * ry * j, cz + z * rx * j);
        n.set(x, y * 0.8 + 0.2, z).normalize();
        const yn = (p.y - yBase) / Math.max(0.1, yTop - yBase);
        const ang = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
        b.v(p, n, cellUv(cell, ang, (y + 1) / 2), crownShade(yn) * tint);
    }
}

/**
 * 木 1 本（幹＋冠。竹やぶ・生垣は幹を描かない）。冠は塊をいくつか重ねる（1 つの丸い塊にしない：枝ごとの茂みのまとまり）。
 * fine：近いまとまり（範囲の端・田畑の縁）は細かさ 1 の塊、遠いまとまり（南の端・村）は細かさ 0
 */
function addTree(b: Builder, t: SurroundTree, seed: number, fine: boolean): void {
    const cell = LEAF_CELL[t.kind];
    const top = t.h;
    const d: 0 | 1 = fine ? 1 : 0;
    const rnd = (k: number) => 0.5 + 0.5 * Math.sin(seed * 12.9898 + k * 78.233);
    if (t.kind === 'hedge') {
        addBlob(b, t.x, t.h * 0.42, t.z, t.r, t.h * 0.55, 0, cell, t.tint * 0.9, seed, 0, t.h);
        return;
    }
    if (t.kind === 'bamboo') {
        // 竹やぶ：細長い塊 3 つ（少しずつ高さと傾きを変える）
        for (let k = 0; k < 3; k++) {
            const a = seed + k * 2.1;
            const ox = Math.cos(a) * t.r * 0.55 * (k ? 1 : 0);
            const oz = Math.sin(a) * t.r * 0.55 * (k ? 1 : 0);
            const hk = top * (1 - k * 0.15);
            addBlob(b, t.x + ox, hk * 0.52, t.z + oz, t.r * (k ? 0.7 : 0.85), hk * 0.5, d, cell, t.tint * (1 - k * 0.05), seed + k, 0, top);
        }
        return;
    }
    // 幹（五角の筒）。松は少し傾ける
    const trunkTop = t.kind === 'pine' ? top * 0.86 : top * 0.5;
    const lean = t.kind === 'pine' ? (rnd(1) - 0.5) * t.r * 0.8 : 0;
    const leanZ = t.kind === 'pine' ? (rnd(2) - 0.5) * t.r * 0.8 : 0;
    const tr = 0.12 + t.r * 0.05;
    const N = 5;
    for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 2;
        const a1 = ((i + 1) / N) * Math.PI * 2;
        const p0 = V(t.x + Math.cos(a0) * tr, -0.2, t.z + Math.sin(a0) * tr);
        const p1 = V(t.x + Math.cos(a1) * tr, -0.2, t.z + Math.sin(a1) * tr);
        const p2 = V(t.x + lean + Math.cos(a1) * tr * 0.55, trunkTop, t.z + leanZ + Math.sin(a1) * tr * 0.55);
        const p3 = V(t.x + lean + Math.cos(a0) * tr * 0.55, trunkTop, t.z + leanZ + Math.sin(a0) * tr * 0.55);
        b.quad(p0, p3, p2, p1, 'bark', 0.55, 0.75);
    }
    if (t.kind === 'pine') {
        // 松：横に広く平たい枝の茂み（段ごとに幹のまわりへずらす）
        const pads = fine ? 4 : 3;
        for (let k = 0; k < pads; k++) {
            const f = k / (pads - 1);
            const y = top * (0.55 + f * 0.37);
            const r = t.r * (1.15 - f * 0.4);
            const a = seed * 1.7 + k * 2.4;
            const off = t.r * (k === pads - 1 ? 0.1 : 0.35);
            addBlob(b, t.x + lean * (y / top) + Math.cos(a) * off, y, t.z + leanZ * (y / top) + Math.sin(a) * off, r, t.h * 0.13, d, cell, t.tint * (0.9 + f * 0.15), seed + k, top * 0.4, top);
        }
        return;
    }
    // 広葉樹：上の大きな茂み＋まわりの茂み 3〜4（冠の下は幹の上半分を隠す高さまで下げる）
    addBlob(b, t.x, top * 0.7, t.z, t.r * 0.78, top * 0.28, d, cell, t.tint, seed, top * 0.32, top);
    const n = fine ? 4 : 3;
    for (let k = 0; k < n; k++) {
        const a = seed * 2.3 + (k / n) * Math.PI * 2 + rnd(k) * 0.8;
        const rr = t.r * (0.5 + rnd(k + 5) * 0.15);
        addBlob(b, t.x + Math.cos(a) * t.r * 0.52, top * (0.48 + rnd(k + 9) * 0.12), t.z + Math.sin(a) * t.r * 0.52, rr, top * 0.2, d, cell, t.tint * (0.88 + rnd(k + 3) * 0.12), seed + k * 3, top * 0.32, top);
    }
}

/**
 * 遠い木（範囲の外の木立・田畑の縁・村。通りから 25 m より遠い）は、冠の絵（コードで描く透けた画像。makeCrownTexture）を
 * 縦の板 3 枚（60° ずつ回して交差）に貼る。塊を重ねた冠は遠くで多角形の輪郭（六角形の塊の積み重ね）に見えたので、
 * 葉の房の縁のある輪郭にする（三角形も 1 本 12 に減る）。生垣と、町並みの家の間の近い木は塊のまま
 */
export const CROWN_CLUSTERS: ReadonlySet<SurroundCluster> = new Set<SurroundCluster>(['west_far', 'east_far', 'fields_w', 'fields_e', 'fields_s', 'village', 'groves']);
/** 冠の絵の升目（横に 4 枚：広葉樹 2・松・竹やぶ） */
const CROWN_CELL = { broad_a: 0, broad_b: 1, pine: 2, bamboo: 3 } as const;
type CrownId = keyof typeof CROWN_CELL;
/** 冠の絵の 1 枚の大きさ（px。横 128・縦 256） */
const CROWN_W = 128;
const CROWN_H = 256;

function crownUv(id: CrownId, u: number, v: number): [number, number] {
    const pad = 1.5 / (CROWN_W * 4);
    const i = CROWN_CELL[id];
    return [i / 4 + pad + (1 / 4 - 2 * pad) * u, v];
}

function addCrownCard(b: Builder, t: SurroundTree, seed: number): void {
    const rnd = (k: number) => 0.5 + 0.5 * Math.sin(seed * 12.9898 + k * 78.233);
    const id: CrownId = t.kind === 'pine' ? 'pine' : t.kind === 'bamboo' ? 'bamboo' : rnd(7) < 0.5 ? 'broad_a' : 'broad_b';
    // 板の幅（絵の冠は升目の幅の 9 割ほど）と高さ（絵の下の端が根もと。少し地面に埋める）
    const w = t.r * (id === 'pine' ? 2.5 : id === 'bamboo' ? 2.0 : 2.3);
    const y0 = -0.25;
    const y1 = t.h * 1.04;
    const a0 = seed * 1.3;
    for (let k = 0; k < 3; k++) {
        const a = a0 + (k * Math.PI) / 3;
        const dx = (Math.cos(a) * w) / 2;
        const dz = (Math.sin(a) * w) / 2;
        const p = [V(t.x - dx, y0, t.z - dz), V(t.x + dx, y0, t.z + dz), V(t.x + dx, y1, t.z + dz), V(t.x - dx, y1, t.z - dz)];
        // 法線：上向きを主に、板の左右へ少し開く（交差した板どうしで明るさが急に変わらない。上ほど空を向く）
        const nx = Math.cos(a) * 0.5;
        const nz = Math.sin(a) * 0.5;
        const n = [V(-nx, 0.35, -nz).normalize(), V(nx, 0.35, nz).normalize(), V(nx, 1, nz).normalize(), V(-nx, 1, -nz).normalize()];
        const uv = [crownUv(id, 0, 0), crownUv(id, 1, 0), crownUv(id, 1, 1), crownUv(id, 0, 1)];
        const c0 = 0.58 * t.tint;
        const c1 = 0.96 * t.tint;
        b.card(p, n, uv, [c0, c0, c1, c1]);
    }
}

/**
 * 冠の絵（コードで描く。512×256 の 4 枚：広葉樹 2・松・竹やぶ。地は透明。種つきの乱数で毎回同じ）。
 * 葉の房（暗い下・明るい上）を重ねて輪郭に凹凸と小さな透き間を作る。幹と枝も描く（板の下の端が根もと）
 */
function makeCrownTexture(): THREE.CanvasTexture {
    const W = CROWN_W;
    const H = CROWN_H;
    const cv = document.createElement('canvas');
    cv.width = W * 4;
    cv.height = H;
    const g = cv.getContext('2d')!;
    let seed = 19;
    const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
    const disc = (x: number, y: number, r: number, c: string) => {
        g.fillStyle = c;
        g.beginPath();
        g.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
        g.fill();
    };
    const stroke = (pts: [number, number][], w: number, c: string) => {
        g.strokeStyle = c;
        g.lineWidth = w;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(pts[0]![0], pts[0]![1]);
        for (const q of pts.slice(1)) g.lineTo(q[0], q[1]);
        g.stroke();
    };
    /** 葉の房を点の列に描く（暗い影 → 中の色 → 上の明るい色の 3 回。下ほど暗い） */
    const clumps = (pts: [number, number, number][], dark: string, mid: string, light: string, top: number, bottom: number) => {
        for (const [x, y, r] of pts) disc(x + r * 0.2, y + r * 0.3, r, dark);
        for (const [x, y, r] of pts) disc(x, y, r * 0.82, mid);
        for (const [x, y, r] of pts) {
            const k = 1 - (y - top) / Math.max(1, bottom - top);
            if (rnd() < 0.2 + 0.45 * k) disc(x - r * 0.28, y - r * 0.32, r * (0.28 + 0.18 * k), light);
        }
    };
    /** 輪郭の細かい葉（房の縁に小さな点を散らす）と、冠の中の小さな透き間 */
    const fringe = (cx: number, cy: number, rx: number, ry: number, n: number, c: string) => {
        for (let i = 0; i < n; i++) {
            const a = rnd() * Math.PI * 2;
            const k = 0.92 + rnd() * 0.16;
            disc(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k, 1 + rnd() * 2.2, c);
        }
    };
    const holes = (cx: number, cy: number, rx: number, ry: number, n: number) => {
        g.save();
        g.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < n; i++) {
            const a = rnd() * Math.PI * 2;
            const k = 0.55 + rnd() * 0.35;
            disc(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k, 1.5 + rnd() * 2.5, '#000');
        }
        g.restore();
    };
    // 広葉樹：幹と 2〜3 本の枝、丸く不揃いな冠（房 60〜80）
    const broad = (i: number, shape: { cy: number; rx: number; ry: number; n: number; lean: number }) => {
        const x0 = i * W;
        const cx = x0 + W / 2;
        const cy = H * shape.cy;
        const trunkTop = cy + H * shape.ry * 0.2;
        stroke([[cx, H], [cx + shape.lean * 4, (H + trunkTop) / 2], [cx + shape.lean * 7, trunkTop]], 7, '#3b3029');
        stroke([[cx + shape.lean * 5, H * 0.72], [cx - W * 0.2, cy + H * 0.05]], 3.5, '#3b3029');
        stroke([[cx + shape.lean * 6, H * 0.66], [cx + W * 0.22, cy]], 3, '#3b3029');
        const pts: [number, number, number][] = [];
        for (let k = 0; k < shape.n; k++) {
            // 楕円の中に、縁へ寄せて置く（輪郭の凹凸が出るように）
            const a = rnd() * Math.PI * 2;
            const d = Math.sqrt(rnd()) * (0.55 + 0.45 * rnd());
            const r = W * (0.07 + rnd() * 0.06);
            pts.push([cx + Math.cos(a) * W * shape.rx * d, cy + Math.sin(a) * H * shape.ry * d, r]);
        }
        pts.sort((p, q) => q[1] - p[1]);
        clumps(pts, '#182a12', '#334f25', '#587a40', cy - H * shape.ry, cy + H * shape.ry);
        fringe(cx, cy, W * shape.rx * 1.02, H * shape.ry * 1.02, 140, '#2a4624');
        holes(cx, cy, W * shape.rx, H * shape.ry, 14);
    };
    broad(CROWN_CELL.broad_a, { cy: 0.36, rx: 0.36, ry: 0.27, n: 70, lean: 0.3 });
    broad(CROWN_CELL.broad_b, { cy: 0.4, rx: 0.38, ry: 0.3, n: 80, lean: -0.4 });
    // 松：傾いた幹、横に平たい枝の茂み（段 5。上ほど小さい）
    {
        const x0 = CROWN_CELL.pine * W;
        const cx = x0 + W / 2;
        stroke([[cx - 4, H], [cx + 2, H * 0.6], [cx + 10, H * 0.3], [cx + 8, H * 0.08]], 6, '#4a3a30');
        const pads = [
            { y: 0.62, w: 0.46, side: -1 },
            { y: 0.5, w: 0.42, side: 1 },
            { y: 0.37, w: 0.4, side: -1 },
            { y: 0.25, w: 0.33, side: 1 },
            { y: 0.12, w: 0.24, side: 0 },
        ];
        for (const pd of pads) {
            const px = cx + pd.side * W * 0.12 + (pd.side ? 0 : 6);
            const py = H * pd.y;
            stroke([[cx + 4, py + 10], [px, py + 4]], 2.5, '#4a3a30');
            const pts: [number, number, number][] = [];
            for (let k = 0; k < 26; k++) {
                const u = (rnd() - 0.5) * 2;
                pts.push([px + u * W * pd.w * 0.95, py - Math.abs(u) * 3 + (rnd() - 0.6) * H * 0.045, W * (0.045 + rnd() * 0.035)]);
            }
            clumps(pts, '#142318', '#2a4630', '#4a6e4c', py - H * 0.05, py + H * 0.04);
            fringe(px, py - 2, W * pd.w, H * 0.035, 40, '#223a28');
        }
    }
    // 竹やぶ：細い稈を何本も、上の 7 割に細かい葉の房（上ほど広がり、先は細く垂れる）
    {
        const x0 = CROWN_CELL.bamboo * W;
        const cx = x0 + W / 2;
        for (let k = 0; k < 16; k++) {
            const bx = cx + (rnd() - 0.5) * W * 0.4;
            const lean = (rnd() - 0.5) * W * 0.35;
            const top = H * (0.03 + rnd() * 0.12);
            stroke([[bx, H], [bx + lean * 0.3, H * 0.5], [bx + lean, top]], 1.6, rnd() < 0.5 ? '#9aa266' : '#7f8a52');
        }
        const pts: [number, number, number][] = [];
        for (let k = 0; k < 150; k++) {
            const v = Math.pow(rnd(), 0.8);
            const y = H * (0.06 + v * 0.62);
            const half = W * (0.12 + 0.3 * Math.sin(Math.PI * Math.min(1, (y / H - 0.02) / 0.75)));
            pts.push([cx + (rnd() - 0.5) * 2 * half, y, W * (0.025 + rnd() * 0.03)]);
        }
        pts.sort((p, q) => q[1] - p[1]);
        clumps(pts, '#34492a', '#557238', '#88a456', H * 0.05, H * 0.7);
        fringe(cx, H * 0.36, W * 0.4, H * 0.32, 120, '#56743a');
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

/** 竹垣（a → b）：1.8 m ごとの面（両側）と柱 */
function addFence(b: Builder, ax: number, az: number, bx: number, bz: number, h: number): void {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(L / 1.8));
    const ux = (bx - ax) / L;
    const uz = (bz - az) / L;
    for (let i = 0; i < n; i++) {
        const s0 = (L * i) / n;
        const s1 = (L * (i + 1)) / n;
        const p0 = V(ax + ux * s0, -0.1, az + uz * s0);
        const p1 = V(ax + ux * s1, -0.1, az + uz * s1);
        const p2 = V(p1.x, h, p1.z);
        const p3 = V(p0.x, h, p0.z);
        b.quad(p0, p1, p2, p3, 'fence', 0.7, 0.95);
        b.quad(p1, p0, p3, p2, 'fence', 0.6, 0.85);
    }
    // 柱（四角。垣より少し高い）
    const w = 0.06;
    for (let i = 0; i <= n; i++) {
        const s = (L * i) / n;
        const cx = ax + ux * s;
        const cz = az + uz * s;
        const ph = h + 0.12;
        const c = [V(cx - w, -0.1, cz - w), V(cx + w, -0.1, cz - w), V(cx + w, -0.1, cz + w), V(cx - w, -0.1, cz + w)];
        for (let k = 0; k < 4; k++) {
            const a = c[k]!;
            const d = c[(k + 1) % 4]!;
            b.quad(d, a, V(a.x, ph, a.z), V(d.x, ph, d.z), 'bark', 0.5, 0.7);
        }
    }
}

/** 中景の形（まとまりごとに 1 つ。three の材質は付けない：確かめで三角形の数・置き場所を見る） */
export function surroundGeometry(plan: SurroundPlan = surroundPlan()): Map<SurroundCluster, THREE.BufferGeometry> {
    const builders = new Map<SurroundCluster, Builder>();
    const crowns = new Map<SurroundCluster, Builder>();
    const bOf = (c: SurroundCluster) => builders.get(c) ?? builders.set(c, new Builder()).get(c)!;
    const cOf = (c: SurroundCluster) => crowns.get(c) ?? crowns.set(c, new Builder()).get(c)!;
    for (const f of plan.fences) addFence(bOf(f.cluster), f.ax, f.az, f.bx, f.bz, f.h);
    for (const h of plan.houses) addHouse(bOf(h.cluster), h);
    plan.trees.forEach((t, i) => {
        const seed = i * 1.37 + 0.5;
        if (t.kind !== 'hedge' && CROWN_CLUSTERS.has(t.cluster)) addCrownCard(cOf(t.cluster), t, seed);
        else addTree(bOf(t.cluster), t, seed, t.cluster !== 'fields_s' && t.cluster !== 'village');
    });
    const out = new Map<SurroundCluster, THREE.BufferGeometry>();
    for (const c of new Set([...builders.keys(), ...crowns.keys()])) out.set(c, Builder.merged(builders.get(c) ?? new Builder(), crowns.get(c)));
    return out;
}

/** 模様の画像（コードで描く。512×512 の 4×4 の升目。種つきの乱数で毎回同じ） */
function makeSurroundTexture(): THREE.CanvasTexture {
    const S = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S * 4;
    const g = cv.getContext('2d')!;
    let seed = 7;
    const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
    const cell = (id: CellId, draw: (x: number, y: number) => void) => {
        const [cx, cy] = CELL[id];
        g.save();
        g.beginPath();
        g.rect(cx * S, cy * S, S, S);
        g.clip();
        draw(cx * S, cy * S);
        g.restore();
    };
    const fill = (x: number, y: number, c: string) => {
        g.fillStyle = c;
        g.fillRect(x, y, S, S);
    };
    const specks = (x: number, y: number, n: number, colors: string[], size: number) => {
        for (let i = 0; i < n; i++) {
            g.fillStyle = colors[Math.floor(rnd() * colors.length)]!;
            const s = size * (0.5 + rnd());
            g.fillRect(x + rnd() * S, y + rnd() * S, s, s);
        }
    };
    // 屋根（u が棟に沿う、v が軒（下）→ 棟（上））
    cell('roof_tile', (x, y) => {
        fill(x, y, '#5c5e62');
        for (let i = 0; i < 22; i++) {
            const u = x + (i + 0.5) * (S / 22);
            g.fillStyle = '#3d3f43';
            g.fillRect(u - 1.2, y, 2.4, S);
            g.fillStyle = '#74767a';
            g.fillRect(u + 1.6, y, 1.2, S);
        }
        for (let j = 0; j < 14; j++) {
            g.fillStyle = 'rgba(30,30,34,0.35)';
            g.fillRect(x, y + j * (S / 14), S, 1);
        }
        g.fillStyle = '#2f3134';
        g.fillRect(x, y + S - 7, S, 7);
        specks(x, y, 120, ['rgba(255,255,255,0.08)', 'rgba(0,0,0,0.12)'], 2);
    });
    cell('roof_board', (x, y) => {
        fill(x, y, '#6a5d4e');
        let u = 0;
        while (u < S) {
            const w = 3 + rnd() * 4;
            const k = 0.8 + rnd() * 0.35;
            g.fillStyle = `rgb(${Math.round(104 * k)},${Math.round(92 * k)},${Math.round(78 * k)})`;
            g.fillRect(x + u, y, w - 0.8, S);
            u += w;
        }
        // 押さえの桟と石
        for (const v of [0.2, 0.5, 0.8]) {
            g.fillStyle = '#3b332b';
            g.fillRect(x, y + S * v, S, 3);
            for (let i = 0; i < 9; i++) {
                g.fillStyle = rnd() < 0.5 ? '#6b6964' : '#57554f';
                g.beginPath();
                g.ellipse(x + (i + 0.3 + rnd() * 0.4) * (S / 9), y + S * v - 1, 2.6 + rnd() * 1.4, 1.8 + rnd() * 0.8, 0, 0, Math.PI * 2);
                g.fill();
            }
        }
        g.fillStyle = '#2f2922';
        g.fillRect(x, y + S - 5, S, 5);
    });
    cell('roof_thatch', (x, y) => {
        fill(x, y, '#7d6a4a');
        for (let i = 0; i < 900; i++) {
            const k = 0.7 + rnd() * 0.5;
            g.strokeStyle = `rgba(${Math.round(150 * k)},${Math.round(128 * k)},${Math.round(88 * k)},0.55)`;
            g.lineWidth = 1;
            const u = x + rnd() * S;
            const v = y + rnd() * S;
            g.beginPath();
            g.moveTo(u, v);
            g.lineTo(u + (rnd() - 0.5) * 2, v + 6 + rnd() * 8);
            g.stroke();
        }
        g.fillStyle = 'rgba(40,32,20,0.55)';
        g.fillRect(x, y + S - 10, S, 10);
        g.fillStyle = 'rgba(60,70,40,0.25)';
        g.fillRect(x, y, S, 12);
    });
    cell('soffit', (x, y) => {
        fill(x, y, '#3a3029');
        for (let i = 0; i < 16; i++) {
            g.fillStyle = 'rgba(0,0,0,0.25)';
            g.fillRect(x + i * 8, y, 2, S);
        }
    });
    // 壁（u が水平、v が地面（下）→ 軒（上））
    cell('wall_front', (x, y) => {
        fill(x, y, '#d9d2c2');
        // 下の 55 %：格子（暗い茶の縦の桟）
        g.fillStyle = '#3a2c22';
        g.fillRect(x, y + S * 0.45, S, S * 0.55);
        g.fillStyle = '#5e4836';
        for (let i = 0; i < 26; i++) g.fillRect(x + i * (S / 26), y + S * 0.47, 2.2, S * 0.5);
        // 柱と梁
        g.fillStyle = '#2c221b';
        for (const u of [0, 0.33, 0.66, 0.97]) g.fillRect(x + S * u, y, 4, S);
        g.fillRect(x, y + S * 0.42, S, 5);
        g.fillRect(x, y, S, 4);
        // 上の漆喰に小窓
        g.fillStyle = '#4a3a2e';
        g.fillRect(x + S * 0.42, y + S * 0.12, S * 0.16, S * 0.14);
        specks(x, y, 80, ['rgba(80,70,60,0.10)'], 3);
    });
    cell('wall_plaster', (x, y) => {
        fill(x, y, '#d6cfbf');
        g.fillStyle = '#2f251d';
        for (const u of [0, 0.5, 0.97]) g.fillRect(x + S * u, y, 4, S);
        g.fillRect(x, y, S, 4);
        // 腰板
        g.fillStyle = '#4b3b2e';
        g.fillRect(x, y + S * 0.78, S, S * 0.22);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        for (let i = 0; i < 12; i++) g.fillRect(x + i * (S / 12), y + S * 0.78, 1, S * 0.22);
        specks(x, y, 120, ['rgba(110,96,80,0.10)', 'rgba(255,255,255,0.08)'], 3);
    });
    cell('wall_board', (x, y) => {
        fill(x, y, '#5b4636');
        for (let j = 0; j < 18; j++) {
            const k = 0.85 + rnd() * 0.3;
            g.fillStyle = `rgb(${Math.round(98 * k)},${Math.round(76 * k)},${Math.round(58 * k)})`;
            g.fillRect(x, y + j * (S / 18), S, S / 18 - 1.2);
        }
        g.fillStyle = '#2d231b';
        for (const u of [0.02, 0.25, 0.5, 0.75, 0.97]) g.fillRect(x + S * u, y, 3, S);
    });
    cell('wall_earth', (x, y) => {
        fill(x, y, '#9a8160');
        specks(x, y, 400, ['rgba(70,52,34,0.18)', 'rgba(190,170,140,0.15)'], 3);
        g.fillStyle = '#3a2d22';
        for (const u of [0, 0.5, 0.97]) g.fillRect(x + S * u, y, 4, S);
        g.fillRect(x, y, S, 4);
        g.fillRect(x, y + S * 0.62, S, 3);
        g.fillStyle = '#2e241c';
        g.fillRect(x + S * 0.18, y + S * 0.25, S * 0.18, S * 0.2);
    });
    // 葉（冠に巻く。下が暗い色は頂点の色で付ける）
    // 葉の茂みのまとまり：暗い地に、上が明るく下が暗い小さな房を重ねる（房の間は暗い隙間）
    const leaves = (x: number, y: number, base: string, mid: string, light: string, dark: string, n: number, r: number) => {
        fill(x, y, base);
        for (let i = 0; i < n; i++) {
            const cx = x + rnd() * S;
            const cy = y + rnd() * S;
            const rr = r * (0.6 + rnd() * 0.8);
            g.fillStyle = dark;
            g.beginPath();
            g.arc(cx + rr * 0.25, cy + rr * 0.3, rr, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = mid;
            g.beginPath();
            g.arc(cx, cy, rr * 0.85, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = light;
            g.beginPath();
            g.arc(cx - rr * 0.25, cy - rr * 0.3, rr * 0.45, 0, Math.PI * 2);
            g.fill();
        }
        specks(x, y, 260, ['rgba(255,255,220,0.10)', 'rgba(0,0,0,0.18)'], 1.5);
    };
    cell('leaf_broad', (x, y) => leaves(x, y, '#1d3016', '#3a5a2a', '#5f8040', '#22381a', 150, 6));
    cell('leaf_pine', (x, y) => leaves(x, y, '#152519', '#2a4630', '#44664a', '#1a2c1f', 170, 5));
    cell('leaf_bamboo', (x, y) => {
        leaves(x, y, '#3a5226', '#5c763a', '#86a052', '#40592a', 220, 4);
        g.fillStyle = 'rgba(210,220,150,0.25)';
        for (let i = 0; i < 20; i++) g.fillRect(x + rnd() * S, y, 1.4, S);
    });
    cell('leaf_hedge', (x, y) => leaves(x, y, '#1f3519', '#365a2a', '#56783e', '#23391c', 260, 3.5));
    cell('bark', (x, y) => {
        fill(x, y, '#4a3f36');
        for (let i = 0; i < 40; i++) {
            g.fillStyle = rnd() < 0.5 ? 'rgba(30,24,20,0.5)' : 'rgba(110,100,90,0.35)';
            g.fillRect(x + rnd() * S, y, 1.5, S);
        }
    });
    // 竹垣（建仁寺垣の形：割った竹を縦に並べ、横に押縁を 4 本、上に笠）
    cell('fence', (x, y) => {
        fill(x, y, '#8a7d58');
        for (let i = 0; i < 24; i++) {
            const k = 0.85 + rnd() * 0.3;
            g.fillStyle = `rgb(${Math.round(168 * k)},${Math.round(152 * k)},${Math.round(108 * k)})`;
            g.fillRect(x + i * (S / 24), y, S / 24 - 1, S);
        }
        g.fillStyle = '#4c4130';
        for (const v of [0.08, 0.32, 0.56, 0.8]) g.fillRect(x, y + S * v, S, 4);
        g.fillStyle = '#3a3226';
        g.fillRect(x, y, S, 6);
    });
    cell('gable', (x, y) => {
        fill(x, y, '#d3ccbc');
        specks(x, y, 150, ['rgba(100,88,74,0.12)', 'rgba(255,255,255,0.06)'], 3);
        g.fillStyle = '#2f251d';
        g.fillRect(x, y + S - 6, S, 6);
        g.fillRect(x + S * 0.48, y, 4, S);
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

/**
 * 木戸の外の田畑（地面の素材 ground_v3 の ground_fields。範囲は blender/scene/build_ground.py の FIELDS：x −65〜65、z 20〜95）の下に敷く暗い土の板。
 * 田畑の外の縁は遠くの地面（ground_far）の縁より数 mm 低く、その段のすき間を通る視線が地面の下を抜けて空に当たり、物見から白い点線に見えた。
 * すき間を抜けた視線が当たるように、田畑のまわり 20 m まで広げる（物見の高さ・通りの高さの浅い視線でも、高さ −0.3 m まで下がる前に板に当たる）。
 * 田の水・用水路の底より下。北の端は町の細かい地面の端（z 19）まで（町の側溝の底にかからない）。影は落とさない・受けない
 */
export const FIELD_UNDERLAY = { x0: -85, x1: 85, z0: 19, z1: 115, y: -0.3 } as const;
function makeFieldUnderlay(): THREE.Mesh {
    const u = FIELD_UNDERLAY;
    const g = new THREE.PlaneGeometry(u.x1 - u.x0, u.z1 - u.z0);
    g.rotateX(-Math.PI / 2);
    g.translate((u.x0 + u.x1) / 2, u.y, (u.z0 + u.z1) / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#4f4234', roughness: 1, metalness: 0 }));
    m.name = '田畑の下の土';
    m.castShadow = false;
    m.receiveShadow = false;
    return m;
}

/** 中景（竹垣・隣の町並み・木立・村）。まとまりごとの形を 1 つの材質で描く。影は落とさない・受けない */
export function makeSurroundings(plan: SurroundPlan = surroundPlan()): THREE.Group {
    const group = new THREE.Group();
    group.name = '中景';
    group.add(makeFieldUnderlay());
    const mat = new THREE.MeshStandardMaterial({ map: makeSurroundTexture(), vertexColors: true, roughness: 0.92, metalness: 0 });
    // 遠い木の冠の絵（透けた所は描かない。板は表と裏の 2 面で作ってあるので片面）
    const crownMat = new THREE.MeshStandardMaterial({ map: makeCrownTexture(), vertexColors: true, roughness: 0.95, metalness: 0, alphaTest: 0.5 });
    for (const [cluster, g] of surroundGeometry(plan)) {
        const m = new THREE.Mesh(g, [mat, crownMat]);
        m.name = `中景-${cluster}`;
        m.castShadow = false;
        m.receiveShadow = false;
        group.add(m);
    }
    return group;
}
