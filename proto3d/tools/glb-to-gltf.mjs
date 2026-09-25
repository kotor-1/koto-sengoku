// GLB を、同じ中身の glTF（JSON 形式・データを base64 で埋め込み）に変換する。
// .glb を配れない置き場所向け（claude.ai の非公開ページなど）。
// 質感の画像は別のファイル（.jpg / .png）に出し、形のデータからは外す（同じ画像を 2 回配らない）。その置き場所では data: の URL を読み込めないため、
// 形のデータ（base64）はページ側（main.ts）で自分で戻し、画像は同じ場所のファイルとして読む。
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
  const name = f.replace(/\.glb$/, '');
  (json.images ?? []).forEach((img, i) => {
    if (img.bufferView === undefined) return;
    const v = json.bufferViews[img.bufferView];
    const ext = img.mimeType === 'image/png' ? 'png' : 'jpg';
    const file = `${name}-${i}.${ext}`;
    writeFileSync(`${dst}/${file}`, bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
    delete img.bufferView;
    delete img.mimeType;
    img.uri = file;
  });
  // 画像に使っていた部分を形のデータから外す（同じ画像を 2 回配らない）。残りを詰め、参照の番号と位置を付け直す
  //（画像は上で別ファイルにしたので、形のデータから参照されるのは accessor だけ）
  if ((json.accessors ?? []).some((a) => a.sparse)) throw new Error(`${f}：sparse の accessor には対応していない`);
  const used = new Set((json.accessors ?? []).map((a) => a.bufferView).filter((v) => v !== undefined));
  const imageViews = new Set(json.bufferViews.map((_, i) => i).filter((i) => !used.has(i)));
  const remap = new Map();
  const parts = [];
  let offset = 0;
  const views = [];
  json.bufferViews.forEach((v, i) => {
    if (imageViews.has(i)) return;
    const pad = (4 - (offset % 4)) % 4;
    if (pad) parts.push(Buffer.alloc(pad));
    offset += pad;
    parts.push(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
    remap.set(i, views.length);
    views.push({ ...v, byteOffset: offset });
    offset += v.byteLength;
  });
  for (const a of json.accessors ?? []) if (a.bufferView !== undefined) a.bufferView = remap.get(a.bufferView);
  json.bufferViews = views;
  const packed = Buffer.concat(parts);
  json.buffers[0].byteLength = packed.length;
  json.buffers[0].uri = `data:application/octet-stream;base64,${packed.toString('base64')}`;
  const out = `${dst}/${f.replace(/\.glb$/, '.json')}`;
  writeFileSync(out, JSON.stringify(json));
  console.log(out, (readFileSync(out).length / 1024).toFixed(0), 'KB');
}
