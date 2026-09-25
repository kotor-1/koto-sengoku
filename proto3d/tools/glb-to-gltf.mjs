// GLB を、同じ中身の glTF（JSON 形式・データを base64 で埋め込み）に変換する。
// .glb を配れない置き場所向け（claude.ai の非公開ページなど）。読み込みは同じ GLTFLoader。
// 使い方: node proto3d/tools/glb-to-gltf.mjs <入力フォルダ> <出力フォルダ>
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const [src, dst] = process.argv.slice(2);
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src).filter((n) => n.endsWith('.glb'))) {
  const b = readFileSync(`${src}/${f}`);
  if (b.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${f} は GLB ではありません`);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.toString('utf8', 20, 20 + jsonLen));
  const binStart = 20 + jsonLen;
  const binLen = b.readUInt32LE(binStart);
  const bin = b.subarray(binStart + 8, binStart + 8 + binLen);
  json.buffers[0].uri = `data:application/octet-stream;base64,${bin.toString('base64')}`;
  const out = `${dst}/${f.replace(/\.glb$/, '.json')}`;
  writeFileSync(out, JSON.stringify(json));
  console.log(out, (readFileSync(out).length / 1024).toFixed(0), 'KB');
}
