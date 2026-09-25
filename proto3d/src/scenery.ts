/**
 * 遠景：空（青いグラデーション・日の周りの明るさ・薄い雲）と、町を囲む低い山並み。
 * どちらもこのコードで作る形と色（画像を貼った背景ではない）。遠い所は霧（scene.fog）で空の地平の色に溶かす。
 */
import * as THREE from 'three';

/** 空の色（sRGB）。霧の色は地平の色にそろえる */
export const SKY = { zenith: '#4f7fb8', horizon: '#c9d6db', sunGlow: '#ffdcae' } as const;

export function makeSky(sunDir: THREE.Vector3): THREE.Mesh {
    const g = new THREE.SphereGeometry(900, 48, 24);
    const m = new THREE.ShaderMaterial({
        uniforms: {
            sunDir: { value: sunDir.clone().normalize() },
            zenith: { value: new THREE.Color(SKY.zenith) },
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
                vec3 col = mix(horizon, zenith, pow(h, 0.5));
                // 日の周りを少し明るく、暖かく
                float s = max(dot(d, normalize(sunDir)), 0.0);
                col += glow * (pow(s, 6.0) * 0.18 + pow(s, 64.0) * 0.35);
                // 薄い雲（空の高い所ほど小さく、地平の近くは薄く）
                vec2 uv = d.xz / (d.y + 0.18) * 1.6;
                float n = fbm(uv + vec2(3.1, 7.7));
                float c = smoothstep(0.52, 0.78, n) * smoothstep(0.02, 0.3, h) * 0.75;
                vec3 cloud = mix(vec3(0.92, 0.93, 0.95), vec3(1.0, 0.95, 0.88), s);
                col = mix(col, cloud, c);
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

/** 値ノイズ（山の稜線用、周期つき） */
function ridge(a: number, seed: number, octaves = 4): number {
    let s = 0;
    let amp = 0.5;
    let f = 3;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
        const x = a * f + seed * 13.1 + i * 7.3;
        s += amp * (0.5 + 0.5 * Math.sin(x) * Math.cos(x * 0.61 + seed));
        norm += amp;
        amp *= 0.5;
        f *= 2.1;
    }
    return s / norm;
}

/**
 * 町を囲む山並み（手前は低く緑、奥は高く青みがかる）。地面の端（200m 先）を隠す位置に置く。
 * 霧で遠いほど空の色に近づく。
 */
export function makeHills(): THREE.Group {
    const group = new THREE.Group();
    group.name = '山並み';
    const rings = [
        { r: 175, depth: 25, h0: 6, h1: 26, color: '#56684a', seed: 1 },
        { r: 290, depth: 40, h0: 20, h1: 75, color: '#6a7a86', seed: 5 },
    ];
    for (const k of rings) {
        const N = 160;
        const pos: number[] = [];
        const idx: number[] = [];
        for (let i = 0; i <= N; i++) {
            const a = (i / N) * Math.PI * 2;
            const n = ridge(a, k.seed);
            const h = k.h0 + (k.h1 - k.h0) * n * n;
            const r = k.r + k.depth * ridge(a, k.seed + 2, 2);
            const x = Math.sin(a);
            const z = Math.cos(a);
            // 手前の裾（地面の下から）、稜線、奥の裾
            pos.push(x * (r - k.depth), -3, z * (r - k.depth));
            pos.push(x * r, h, z * r);
            pos.push(x * (r + k.depth * 2), -3, z * (r + k.depth * 2));
        }
        for (let i = 0; i < N; i++) {
            const a = i * 3;
            const b = a + 3;
            idx.push(a, b, a + 1, b, b + 1, a + 1, a + 1, b + 1, a + 2, b + 1, b + 2, a + 2);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        const mat = new THREE.MeshLambertMaterial({ color: k.color, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(g, mat);
        mesh.name = `山並み-${k.r}`;
        group.add(mesh);
    }
    return group;
}
