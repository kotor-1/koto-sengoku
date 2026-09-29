/**
 * 素材（glTF）の読み込み。探索（main.ts）と同じやり方を、合戦など別の場面からも使えるようにしたもの。
 * - 開発・既定：public/models/<名前>.glb を GLTFLoader で読む。
 * - VITE_MODEL_EXT=.json のとき（.glb を配れない置き場所）：同じ中身の glTF（JSON 形式、データ埋め込み）を読み、
 *   埋め込んだデータ（base64）をここで戻して GLB の形に組み直してから読む（画像は同じ場所の別ファイル）。
 * main.ts の load / loadJson と同じ動き（main.ts はまだ自分の分を使っている。振る舞いは変えていない）。
 */
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_EXT = (import.meta.env.VITE_MODEL_EXT as string | undefined) || '.glb';
let loader: GLTFLoader | null = null;

/** 素材を 1 つ読む（名前は拡張子なし。例：'tree_pine_far'） */
export function loadModel(name: string): Promise<GLTF> {
    loader ??= new GLTFLoader();
    return MODEL_EXT === '.glb' ? loader.loadAsync(`./models/${name}.glb`) : loadJson(loader, name);
}

async function loadJson(l: GLTFLoader, name: string): Promise<GLTF> {
    const res = await fetch(`./models/${name}${MODEL_EXT}`);
    if (!res.ok) throw new Error(`${name}${MODEL_EXT} を読み込めません（${res.status}）`);
    const json = await res.json();
    const uri: string = json.buffers[0].uri;
    const raw = atob(uri.slice(uri.indexOf(',') + 1));
    const bin = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
    delete json.buffers[0].uri;
    const text = new TextEncoder().encode(JSON.stringify(json));
    const jsonLen = Math.ceil(text.length / 4) * 4;
    const binLen = Math.ceil(bin.length / 4) * 4;
    const glb = new Uint8Array(12 + 8 + jsonLen + 8 + binLen);
    const dv = new DataView(glb.buffer);
    dv.setUint32(0, 0x46546c67, true); // 'glTF'
    dv.setUint32(4, 2, true);
    dv.setUint32(8, glb.length, true);
    dv.setUint32(12, jsonLen, true);
    dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
    glb.fill(0x20, 20, 20 + jsonLen);
    glb.set(text, 20);
    dv.setUint32(20 + jsonLen, binLen, true);
    dv.setUint32(24 + jsonLen, 0x004e4942, true); // 'BIN'
    glb.set(bin, 28 + jsonLen);
    return l.parseAsync(glb.buffer, './models/');
}
