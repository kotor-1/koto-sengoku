// 3D 比較版の歩き・止まる・向きを変える・家の横を通る を録画する。
// 検証コンテナはソフトウェア描画で 1〜3fps しか出ないため、本物のゲームの処理（動き・動きの混ぜ方・カメラ・描画）を
// 1 コマ 1/24 秒ずつ進めて描き、1 枚ずつ撮ってつなぐ。入力（スティックの向き）は下の台本で与える。
// 実機でこの速さで動くかは、この方法では分からない（別に確かめる）。
//   出力：<出力先>/proto3d-walk.webm と proto3d-walk-story.png（要所の静止画）
// 使い方: npm run proto3d:dev を起動しておき、node e2e/proto3d-video.mjs [出力先]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { launchBrowser, outDir } from './lib.mjs';

const S = outDir(process.argv[2]);
const BASE = process.env.BASE3D || 'http://localhost:8090';
const W = Number(process.env.W || 1280);
const H = Number(process.env.H || 720);
const FPS = 24;
const FFMPEG = ['/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux', 'ffmpeg'].find((p) => p === 'ffmpeg' || existsSync(p));

const yaw = 0; // カメラの向き（proto3d/src/game/motion.ts の CAMERA_YAW と同じ値にする）
/** 地面の方向 → スティックの入力 */
const ground = (gx, gz) => [Math.cos(yaw) * gx - Math.sin(yaw) * gz, Math.sin(yaw) * gx + Math.cos(yaw) * gz];
// 台本：[秒数, 地面の方向（なしは止まる）, 見出し]
const SCRIPT = [
  [1.2, null, '待機'],
  [5.2, [0, -1], '北（城門の方）へ歩く'],
  [1.4, null, '止まる'],
  [5.6, [-1, 0], '向きを変えて西へ：家の横の路地を通る'],
  [1.4, null, '止まる'],
  [2.2, [1, 0], 'その場で振り向いて東へ戻る'],
  [1.4, null, '止まる'],
];

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE + '/?view=top');
await page.waitForFunction(() => window.__p3?.stats.readyMs > 0, null, { timeout: 90000 });
await page.evaluate(() => {
  window.__p3.manual();
  const h = window.__p3.hero;
  h.x = 0.8; h.z = 0.5; h.heading = Math.PI; h.speed = 0;
  for (let i = 0; i < 60; i++) window.__p3.step(1 / 30, 0, 0); // カメラを合わせる
});

const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', '-c:v', 'libvpx', '-b:v', '3M', '-deadline', 'good', '-auto-alt-ref', '0', `${S}/proto3d-walk.webm`], { stdio: ['pipe', 'inherit', 'inherit'] });
const story = [];
let frame = 0;
for (const [sec, dir, label] of SCRIPT) {
  const n = Math.round(sec * FPS);
  const input = dir ? ground(dir[0], dir[1]) : [0, 0];
  for (let i = 0; i < n; i++) {
    await page.evaluate(([ix, iy, dt]) => window.__p3.step(dt, ix, iy), [input[0], input[1], 1 / FPS]);
    const jpg = await page.screenshot({ type: 'jpeg', quality: 88 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i === Math.floor(n * 0.6)) {
      const st = await page.evaluate(() => ({ x: window.__p3.hero.x, z: window.__p3.hero.z, speed: window.__p3.hero.speed, blend: window.__p3.anim.walkBlend }));
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
await p2.screenshot({ path: `${S}/proto3d-walk-story.png`, fullPage: true });
console.log('saved', `${S}/proto3d-walk.webm`, frame, 'コマ', errors.length ? errors : '');
await browser.close();
