/**
 * 遠景：空（青いグラデーション・日の周りの明るさ・薄い雲）と、町を囲む低い山並み。
 * どちらもこのコードで作る形と色（画像を貼った背景ではない）。遠い所は霧（scene.fog）で空の地平の色に溶かす。
 */
import * as THREE from 'three';

/**
 * 空の色（sRGB）。晴れた午後遅くの濃い青の空。地平に近いほど淡い。
 * haze は空気の遠近（霧）の色：遠い物が寄っていく、わずかに青い地平の色。
 */
export const SKY = { zenith: '#1d4f9e', mid: '#4f86c6', horizon: '#b4cde3', haze: '#a8c0d8', sunGlow: '#ffd09a' } as const;

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
        { r: 175, depth: 25, h0: 6, h1: 26, color: '#3f5a45', seed: 1 },
        { r: 290, depth: 40, h0: 20, h1: 75, color: '#5f7892', seed: 5 },
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
