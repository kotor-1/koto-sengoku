/**
 * 人物の足元の接地の影（Version 28 §3.2「足元に接地の影」）。日の影（影の画像）とは別に、足の下の地面を丸くぼかして暗くする板。
 * - 日陰（軒下・建物の影）では日の影が出ないので、人物が地面から浮いて見えないようにする。日なたでは日の影の根元を締める。
 * - 画像のファイルは使わない（中心から縁へ薄くなる濃さをコードで作る 64×64 の DataTexture）。形と材質は全員で共有。
 * - 置き方：人物の素材の根（足の高さ）の子にする（人物と一緒に動く。地面の起伏は根の高さ＝ groundY に合う）。
 */
import * as THREE from 'three';

/**
 * 半径（m）・濃さ（0〜1）・地面からの浮き（m）・深さの手前寄せ（m）。
 * 板は平らだが、地面は足のまわり 0.4 m で 1 cm ほど起伏する（地面の高さの表 ground_height.json の点の間）。板を浮かせすぎると足の下で浮いて見えるので、
 * 浮きは小さくし、深さの比べ（隠れるかどうか）だけを視線に沿って手前へ寄せる（起伏の山に埋もれない。足・小物など手前の物には隠れる）
 */
export const CONTACT_SHADOW = { radius: 0.46, opacity: 0.55, lift: 0.012, pull: 0.08 } as const;

let shared: { geometry: THREE.PlaneGeometry; material: THREE.MeshBasicMaterial } | null = null;

function sharedParts(): { geometry: THREE.PlaneGeometry; material: THREE.MeshBasicMaterial } {
    if (shared) return shared;
    const N = 64;
    const data = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
            const dx = (i + 0.5) / N - 0.5;
            const dy = (j + 0.5) / N - 0.5;
            const r = Math.hypot(dx, dy) * 2;
            // 中心が濃く、半径の 5 割から縁へなめらかに消える（袴・着物の裾の外に見える輪が薄くなりすぎないように）
            const t = Math.min(1, Math.max(0, (r - 0.5) / 0.5));
            const a = Math.round(255 * (1 - t * t * (3 - 2 * t)));
            const k = (j * N + i) * 4;
            data[k] = data[k + 1] = data[k + 2] = a;
            data[k + 3] = 255;
        }
    }
    const alpha = new THREE.DataTexture(data, N, N);
    alpha.needsUpdate = true;
    alpha.magFilter = THREE.LinearFilter;
    alpha.minFilter = THREE.LinearFilter;
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
        color: 0x000000,
        alphaMap: alpha,
        transparent: true,
        opacity: CONTACT_SHADOW.opacity,
        depthWrite: false,
    });
    // 視線に沿って手前へ寄せてから写す（上の説明）
    material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `#include <project_vertex>
            mvPosition.xyz += normalize( -mvPosition.xyz ) * ${CONTACT_SHADOW.pull.toFixed(3)};
            gl_Position = projectionMatrix * mvPosition;`,
        );
    };
    shared = { geometry, material };
    return shared;
}

/** 人物の素材（骨組みのある形）か */
export function isCharacter(obj: THREE.Object3D): boolean {
    let found = false;
    obj.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) found = true;
    });
    return found;
}

/** 人物の根に接地の影を足す（もう付いていれば何もしない）。返りはその板 */
export function addContactShadow(root: THREE.Object3D): THREE.Mesh {
    const have = root.children.find((c) => c.userData.contactShadow === true);
    if (have) return have as THREE.Mesh;
    const { geometry, material } = sharedParts();
    const m = new THREE.Mesh(geometry, material);
    m.name = '接地の影';
    m.userData.contactShadow = true;
    m.scale.set(CONTACT_SHADOW.radius * 2, 1, CONTACT_SHADOW.radius * 2);
    m.position.y = CONTACT_SHADOW.lift;
    m.receiveShadow = false;
    // 影は落とさない（人物の素材の影の設定をまとめて変える処理（traverse で castShadow を付ける）に上書きされないよう、値を固定する）
    Object.defineProperty(m, 'castShadow', { get: () => false, set: () => undefined });
    root.add(m);
    return m;
}
