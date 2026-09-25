// 3D 比較版（肩越しの三人称）の、歩く・周りを見る・走る・城門をくぐる を録画する。
// 検証コンテナはソフトウェア描画で遅い（1 コマ数秒）ため、本物のゲームの処理（移動・動き・カメラ・描画）を
// 1 コマ 1/24 秒ずつ進めて描き、1 枚ずつ撮ってつなぐ（コマ撮り）。実機でこの速さで動く証拠ではない。
// 入力：移動は台本（スティックの向き）、見回しは台本（ドラッグの量）、走るは本物のボタンのクリック。
// 既定は画質「低」・960×540（高画質・1280×720 では 1 コマ約 25 秒かかるため）。Q='?' W=1280 H=720 で高画質。
//   出力：<出力先>/proto3d-tps.webm と proto3d-tps-story.png（要所の静止画）
// 使い方: npm run proto3d:dev を起動しておき、node e2e/proto3d-tps-video.mjs [出力先]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { launchBrowser, outDir } from './lib.mjs';

const S = outDir(process.argv[2]);
const BASE = process.env.BASE3D || 'http://localhost:8090';
const W = Number(process.env.W || 960);
const H = Number(process.env.H || 540);
const FPS = 24;
const FFMPEG = ['/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux', 'ffmpeg'].find((p) => p === 'ffmpeg' || existsSync(p));

// 台本：[秒数, 画面の入力（なしは止まる）, 見回し（1 秒あたりのドラッグ px：右, 下）, 見出し, 走るボタンを押してから]
const SCRIPT = [
  [1.5, null, [0, 0], '待機：主人公の背後から、城門へ続く道を見る'],
  [5.0, [0, -1], [0, 0], '歩く（1.55m/秒）'],
  [0.8, null, [0, 0], '止まる'],
  [1.6, null, [-190, 8], '周りを見る：左の町家'],
  [2.2, null, [240, -14], '周りを見る：右の町家'],
  [0.9, null, [-249, 0], '道の先へ向き直る'], // 見回しの合計（-190×1.6 ＋ 240×2.2 − 249×0.9）がほぼ 0 で、道の先（北）を向く
  [4.8, [0, -1], [0, 0], '走る（3.41m/秒）：城門をくぐる', 'run'],
  [1.4, null, [0, -40], '止まって見上げる'],
];

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.setDefaultTimeout(600000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE + '/' + (process.env.Q ?? '?q=low'));
await page.waitForFunction(() => window.__p3?.stats.readyMs > 0, null, { timeout: 300000 });
await page.evaluate(() => {
  const p = window.__p3;
  p.manual();
  Object.assign(p.hero, { x: 0.8, z: 11, heading: Math.PI, speed: 0 });
  for (let i = 0; i < 30; i++) p.step(1 / 30, 0, 0);
  // 録画であることの表示
  const d = document.createElement('div');
  d.id = '__rec';
  d.style.cssText = 'position:fixed;left:14px;top:58px;padding:5px 10px;border-radius:6px;background:rgba(0,0,0,.6);color:#fff;font:14px sans-serif;z-index:99;white-space:pre';
  document.body.appendChild(d);
});

const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', '-c:v', 'libvpx', '-b:v', '4M', '-deadline', 'good', '-auto-alt-ref', '0', `${S}/proto3d-tps.webm`], { stdio: ['pipe', 'inherit', 'inherit'] });
const story = [];
let frame = 0;
for (const [sec, input, lookPerSec, label, action] of SCRIPT) {
  if (action === 'run') await page.click('#run-btn');
  const n = Math.round(sec * FPS);
  const [ix, iy] = input ?? [0, 0];
  for (let i = 0; i < n; i++) {
    await page.evaluate(([ix, iy, lx, ly, dt, text]) => {
      const p = window.__p3;
      p.look(lx * dt, ly * dt);
      p.step(dt, ix, iy);
      document.getElementById('__rec').textContent = text;
    }, [ix, iy, lookPerSec[0], lookPerSec[1], 1 / FPS, `コマ撮り（1/24 秒ずつ進めて描いた録画。実時間の動作ではない）・画質「低」\n${label}`]);
    const jpg = await page.screenshot({ type: 'jpeg', quality: 88, timeout: 600000 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i === Math.floor(n * 0.6)) {
      const st = await page.evaluate(() => ({ speed: window.__p3.hero.speed }));
      story.push({ label: `${label}（${(frame / FPS).toFixed(1)} 秒・速さ ${st.speed.toFixed(2)} m/秒）`, data: jpg.toString('base64') });
    }
    frame++;
  }
  process.stdout.write(`${label} … ${frame} コマ\n`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));

const html = `<html><body style="margin:0;background:#15130f;font-family:sans-serif;color:#eee7d6">
<div style="display:grid;grid-template-columns:repeat(2,640px);gap:10px;padding:14px">
${story.map((s) => `<div><div style="font-size:14px;margin:0 0 5px">${s.label}</div><img src="data:image/jpeg;base64,${s.data}" style="width:640px;border-radius:6px"></div>`).join('')}
</div></body></html>`;
const p2 = await browser.newPage({ viewport: { width: 1320, height: 400 } });
await p2.setContent(html);
await p2.screenshot({ path: `${S}/proto3d-tps-story.png`, fullPage: true });
console.log('saved', `${S}/proto3d-tps.webm`, frame, 'コマ', errors.length ? errors : '');
await browser.close();
