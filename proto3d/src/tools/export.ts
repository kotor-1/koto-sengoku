/**
 * 手続きで作った 3D 素材を GLB に書き出す（開発用）。
 * ブラウザで動かす（Canvas で描いた質感を画像として埋め込むため）。
 * 書き出したファイルは本体（src/main.ts）が GLTFLoader で読み込む。
 * 将来、外部で作ったモデルに差し替えるときも、同じ名前の GLB を置けばよい。
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { buildGate } from '../assets/gate';
import { buildGround } from '../assets/ground';
import { buildHero } from '../assets/hero';
import { buildHouse } from '../assets/house';
import { buildBroadleaf, buildPine } from '../assets/trees';

/** 透けない質感は JPEG にして容量を減らす（透ける葉・草は PNG のまま） */
function useJpegForOpaque(root: THREE.Object3D): void {
    root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        for (const key of ['map', 'normalMap', 'roughnessMap'] as const) {
            const t = mat[key];
            if (t && mat.alphaTest === 0) t.userData.mimeType = 'image/jpeg';
        }
    });
}

async function toGlb(root: THREE.Object3D, animations: THREE.AnimationClip[] = []): Promise<ArrayBuffer> {
    useJpegForOpaque(root);
    const out = await new GLTFExporter().parseAsync(root, { binary: true, animations, maxTextureSize: 1024 });
    return out as ArrayBuffer;
}

function b64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}

/** only を渡すと、その名前の素材だけを書き出す（今回改修しない素材を変えないため） */
async function exportAll(only?: string[]): Promise<Record<string, string>> {
    const builders: Record<string, () => [THREE.Object3D, THREE.AnimationClip[]]> = {
        ground: () => [buildGround(), []],
        gate: () => [buildGate(), []],
        house: () => [buildHouse(), []],
        pine: () => [buildPine(), []],
        broadleaf: () => [buildBroadleaf(), []],
        hero: () => {
            const hero = buildHero();
            return [hero.root, hero.clips];
        },
    };
    const out: Record<string, string> = {};
    for (const [name, build] of Object.entries(builders)) {
        if (only && !only.includes(name)) continue;
        const [obj, clips] = build();
        out[name] = b64(await toGlb(obj, clips));
    }
    return out;
}

Object.assign(window, { __exportModels: exportAll });
document.body.dataset.ready = '1';
