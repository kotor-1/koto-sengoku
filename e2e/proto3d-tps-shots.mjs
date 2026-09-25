// 3D 比較版（肩越しの三人称）の、実際のゲーム画面の静止画（画質「高」・PC 1280×720、スマホ横 844×390）。
//   同じ昼の光で、決まった場所・向きから撮る。参考画像（アート方向）を並べるときは REF=画像のパス を渡す。
//   出力：p3shot-*.png と p3shot.png（まとめ）、REF を渡したときは p3shot-ref.png（参考画像と並べたもの）
// 使い方: npm run proto3d:dev を起動しておき、node e2e/proto3d-tps-shots.mjs [出力先]
import { readFileSync } from 'node:fs';
import { launchBrowser, outDir } from './lib.mjs';

const S = outDir(process.argv[2]);
const BASE = process.env.BASE3D || 'http://localhost:8090';
const browser = await launchBrowser();
const errors = [];
// [ファイル名, 見出し, 主人公 x, z, 向き, カメラの向き yaw, 上下 pitch, 画面]
const SHOTS = [
  ['start', '始めの位置：背後から城門へ続く道', 0.8, 9, Math.PI, 0, 0.1, 'pc'],
  ['street', '町家の前：柱・格子・庇の軒下', 2.2, 4, Math.PI, 0.55, 0.02, 'pc'],
  ['eaves', '軒下から見上げる：垂木と庇', 2.8, -1.5, Math.PI, 1.1, -0.3, 'pc'],
  ['gate', '城門の前', 0.4, -7.5, Math.PI, 0, 0.0, 'pc'],
  ['back', '主人公の背中（近く）', 0.8, 2, Math.PI, 0.2, 0.25, 'pc-near'],
  ['phone', 'スマホ横 844×390', 0.8, 9, Math.PI, 0, 0.1, 'phone'],
];
const shots = [];
for (const [file, label, x, z, heading, yaw, pitch, kind] of SHOTS) {
  const phone = kind === 'phone';
  const ctx = await browser.newContext(phone ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(900000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/');
  await page.waitForFunction(() => window.__p3?.stats.readyMs > 0, null, { timeout: 300000 });
  await page.evaluate(([x, z, heading, yaw, pitch, near]) => {
    const p = window.__p3;
    p.manual();
    Object.assign(p.hero, { x, z, heading, speed: 0 });
    p.orbit.yaw = yaw;
    p.orbit.pitch = pitch;
    for (let i = 0; i < 40; i++) p.step(1 / 30, 0, 0);
    if (near) {
      // 近くで背中：カメラの距離だけを縮めて 1 回描く（ふだんの操作では使わない）
      p.orbit.dist = 1.7;
      p.step(1 / 1000, 0, 0);
    }
  }, [x, z, heading, yaw, pitch, kind === 'pc-near']);
  await page.screenshot({ path: `${S}/p3shot-${file}.png`, timeout: 900000 });
  shots.push([file, label]);
  console.log('saved', file);
  await ctx.close();
}
const img = (f, type = 'png') => `data:image/${type};base64,${readFileSync(f).toString('base64')}`;
const sheet = await browser.newPage({ viewport: { width: 1320, height: 800 } });
await sheet.setContent(`<body style="margin:0;background:#15130f;color:#eee7d6;font:14px sans-serif"><div style="display:grid;grid-template-columns:640px 640px;gap:10px 16px;padding:12px">
${shots.map(([f, l]) => `<div><div style="margin:0 0 4px">${l}</div><img src="${img(`${S}/p3shot-${f}.png`)}" style="width:640px;border-radius:4px"></div>`).join('')}
</div><div style="padding:0 12px 12px;font-size:12px;opacity:.8">実際のゲーム画面（検証コンテナの Chromium・ソフトウェア描画、画質「高」）。実機での表示・速さではない。</div></body>`);
await sheet.screenshot({ path: `${S}/p3shot.png`, fullPage: true });
if (process.env.REF) {
  const ref = await browser.newPage({ viewport: { width: 1320, height: 600 } });
  const type = process.env.REF.endsWith('.webp') ? 'webp' : 'png';
  await ref.setContent(`<body style="margin:0;background:#15130f;color:#eee7d6;font:14px sans-serif"><div style="display:grid;grid-template-columns:640px 640px;gap:6px 16px;padding:12px">
<div>参考：承認されたアート方向（生成された完成イメージ。ゲーム画面ではない）</div><div>いまの試作の実際のゲーム画面（同じ昼の光・画質「高」）</div>
<img src="${img(process.env.REF, type)}" style="width:640px;border-radius:4px"><img src="${img(`${S}/p3shot-start.png`)}" style="width:640px;border-radius:4px">
</div></body>`);
  await ref.screenshot({ path: `${S}/p3shot-ref.png`, fullPage: true });
}
console.log('errors:', JSON.stringify(errors));
await browser.close();
