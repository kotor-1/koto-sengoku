// 確認用の画面撮影に使う開発サーバー（自動再読み込みなし）。ほかの作業がファイルを書き換えても、撮影中のページが読み直されない。
//   PORT=8091 npx vite --config proto3d/blender/tools/vite.nohmr.mjs
import base from '../../vite.config.mjs';
const port = Number(process.env.PORT || 8091);
export default { ...base, server: { port, strictPort: true, hmr: false } };
