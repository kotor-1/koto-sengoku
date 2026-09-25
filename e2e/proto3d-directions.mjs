// 3D 比較版：操作の向きを「実際の画面」で確かめる（本物のキー入力とタッチのスティック）。
//   - 上下左右・斜め：押した向きと、画面の上で主人公が動いた向きがそろうか
//     （動く前のカメラのまま描き直した画面で、主人公がどちらへ動いたかを見る）
//   - キーボードとスティックで同じ向き・同じ速さになるか
//   - 指やキーを離すと止まるか
//   - 城門を通り抜けられるか、家の横の路地を抜けられるか
// 検証コンテナはソフトウェア描画で遅いので、ゲームの時間は 1/30 秒ずつ決まった量だけ進める（入力は本物のまま）。
// 使い方: npm run proto3d:dev を起動しておき、node e2e/proto3d-directions.mjs [出力先]
// 出力：p3dir-*.png（向きごとの画面）と p3dir.png（まとめ）
import { readFileSync } from 'node:fs';
import { launchBrowser, outDir } from './lib.mjs';

const S = outDir(process.argv[2]);
const BASE = process.env.BASE3D || 'http://localhost:8090';
const VP = { width: 960, height: 540 };
const browser = await launchBrowser();
let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}`);
};
const errors = [];

async function open(opts) {
  const ctx = await browser.newContext({ viewport: VP, ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/?q=low&view=top');
  await page.waitForFunction(() => window.__p3?.stats.readyMs > 0, null, { timeout: 180000 });
  await page.evaluate(() => window.__p3.manual());
  return { ctx, page };
}

/** 主人公を置き、カメラを追いつかせる */
const put = (page, x, z, heading = Math.PI) => page.evaluate(([x, z, heading]) => {
  const p = window.__p3;
  Object.assign(p.hero, { x, z, heading, speed: 0, dirX: Math.sin(heading), dirZ: Math.cos(heading) });
  for (let i = 0; i < 60; i++) p.step(1 / 30, 0, 0);
}, [x, z, heading]);

/** いまのカメラを覚える／覚えたカメラで、主人公の足元が画面のどこに映るか（ピクセル） */
const saveCam = (page) => page.evaluate(() => {
  const c = window.__p3.camera;
  window.__cam0 = { pos: c.position.clone(), q: c.quaternion.clone() };
});
const heroOnScreen = (page) => page.evaluate(() => {
  const p = window.__p3;
  const c = p.camera.clone();
  c.position.copy(window.__cam0.pos);
  c.quaternion.copy(window.__cam0.q);
  c.updateMatrixWorld(true);
  const v = p.camera.position.clone().set(p.hero.x, 0, p.hero.z).project(c);
  const r = p.renderer.domElement.getBoundingClientRect();
  return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, speed: p.hero.speed, hx: p.hero.x, hz: p.hero.z };
});
/** 覚えたカメラのまま描き直して撮る（主人公が画面の上でどちらへ動いたかが見える）。動く前の位置に印を付ける */
async function shotFrozen(page, file, from, label) {
  await page.evaluate(([from, label]) => {
    const p = window.__p3;
    const c = p.camera;
    const keep = { pos: c.position.clone(), q: c.quaternion.clone() };
    c.position.copy(window.__cam0.pos);
    c.quaternion.copy(window.__cam0.q);
    c.updateMatrixWorld(true);
    p.renderer.render(p.scene, c);
    c.position.copy(keep.pos);
    c.quaternion.copy(keep.q);
    let m = document.getElementById('__mark');
    if (!m) {
      m = document.createElement('div');
      m.id = '__mark';
      document.body.appendChild(m);
    }
    m.innerHTML = `<div style="position:fixed;left:${from.x - 9}px;top:${from.y - 9}px;width:14px;height:14px;border:2px solid #ffd54a;border-radius:50%;z-index:99"></div>
      <div style="position:fixed;left:12px;top:60px;padding:4px 10px;background:rgba(0,0,0,.65);color:#fff;font:16px sans-serif;border-radius:6px;z-index:99">${label}</div>`;
  }, [from, label]);
  await page.screenshot({ path: `${S}/${file}`, timeout: 300000 });
  await page.evaluate(() => document.getElementById('__mark')?.remove());
}
const stepN = (page, n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.__p3.stepInput(1 / 30); }, n);
const deg = (r) => Math.round((r * 180) / Math.PI);
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// 押す向き（画面）：右 +x、下 +y
const DIRS = [
  { name: '上', keys: ['ArrowUp'], v: [0, -1] },
  { name: '下', keys: ['ArrowDown'], v: [0, 1] },
  { name: '左', keys: ['ArrowLeft'], v: [-1, 0] },
  { name: '右', keys: ['ArrowRight'], v: [1, 0] },
  { name: '右上', keys: ['ArrowUp', 'ArrowRight'], v: [1, -1] },
  { name: '左上', keys: ['KeyW', 'KeyA'], v: [-1, -1] },
  { name: '右下', keys: ['KeyS', 'KeyD'], v: [1, 1] },
  { name: '左下', keys: ['ArrowDown', 'ArrowLeft'], v: [-1, 1] },
];
// 開けた所（東の町家のさらに東の草地）。どの向きへ 1 秒歩いても何にも当たらない
const OPEN = { x: 12, z: 5 };
const kbResult = {};

// ---------------- キーボード ----------------
{
  const { ctx, page } = await open({});
  for (const d of DIRS) {
    await put(page, OPEN.x, OPEN.z);
    await saveCam(page);
    const a = await heroOnScreen(page);
    for (const k of d.keys) await page.keyboard.down(k);
    await stepN(page, 30); // 1 秒
    const b = await heroOnScreen(page);
    for (const k of d.keys) await page.keyboard.up(k);
    const got = Math.atan2(b.y - a.y, b.x - a.x);
    const want = Math.atan2(d.v[1], d.v[0]);
    const err = angDiff(got, want);
    kbResult[d.name] = { dx: b.hx - a.hx, dz: b.hz - a.hz, speed: b.speed };
    // 見下ろしの遠近で、画面の上下の動きは左右より短く映る。地面で 45° の斜めは画面では約 35° に見える（許容 12°）
    check(`キー「${d.name}」：画面の${d.name}へ動く`, err < (12 * Math.PI) / 180 && Math.hypot(b.x - a.x, b.y - a.y) > 20, `画面上の向きのずれ ${deg(err)}°・画面上で ${Math.round(Math.hypot(b.x - a.x, b.y - a.y))}px`);
    await shotFrozen(page, `p3dir-key-${DIRS.indexOf(d)}.png`, a, `キー ${d.name}（黄色の丸＝押す前の位置）`);
  }

  // 離すと止まる
  await put(page, OPEN.x, OPEN.z);
  await page.keyboard.down('ArrowRight');
  await stepN(page, 20);
  await page.keyboard.up('ArrowRight');
  await stepN(page, 10); // 0.33 秒
  const s1 = await heroOnScreen(page);
  await stepN(page, 30);
  const s2 = await heroOnScreen(page);
  check('キーを離すと 0.33 秒以内に止まり、その場から動かない', s1.speed === 0 && s1.hx === s2.hx && s1.hz === s2.hz);

  // 逆向きへの切り返し：向き直るのを待たずに、すぐ逆へ進む
  await put(page, OPEN.x, OPEN.z);
  await page.keyboard.down('ArrowUp');
  await stepN(page, 30);
  await page.keyboard.up('ArrowUp');
  const r0 = await page.evaluate(() => ({ z: window.__p3.hero.z, h: window.__p3.hero.heading }));
  await page.keyboard.down('ArrowDown');
  await stepN(page, 3); // 0.1 秒
  const r1 = await page.evaluate(() => ({ z: window.__p3.hero.z, h: window.__p3.hero.heading, s: window.__p3.hero.speed }));
  await stepN(page, 12);
  const r2 = await page.evaluate(() => ({ z: window.__p3.hero.z, h: window.__p3.hero.heading }));
  await page.keyboard.up('ArrowDown');
  check('逆向きに押すと、その場で待たずに 0.1 秒でもう手前へ進み、進みながら向き直る', r1.z > r0.z && angDiff(r1.h, r0.h) < 2.8 && angDiff(r2.h, r0.h) > 2.9,
    `0.1 秒後：${(r1.z - r0.z).toFixed(2)}m 手前・体の向き ${deg(angDiff(r1.h, r0.h))}° → 0.5 秒後 ${deg(angDiff(r2.h, r0.h))}°`);

  // 城門を通り抜ける（↑）
  await put(page, 0, -6);
  await page.keyboard.down('ArrowUp');
  await stepN(page, 60);
  await page.screenshot({ path: `${S}/p3dir-gate.png`, timeout: 300000 });
  await stepN(page, 120);
  const g = await heroOnScreen(page);
  await page.keyboard.up('ArrowUp');
  check('↑ で城門を通り抜けられる', g.hz < -12 - 2, `z ${g.hz.toFixed(2)}（門は z=-12）`);

  // 家の横の路地（家の北東の角から ← で西へ）
  await put(page, -3.0, -6.5);
  await page.keyboard.down('ArrowLeft');
  await stepN(page, 75);
  const mid = await heroOnScreen(page);
  const fade = await page.evaluate(() => window.__p3.fade);
  await page.screenshot({ path: `${S}/p3dir-alley.png`, timeout: 300000 });
  await stepN(page, 120);
  const out = await heroOnScreen(page);
  await page.keyboard.up('ArrowLeft');
  check('← で家の横（北側の路地）を通って裏まで抜けられ、家には入り込まない', mid.hz < -5.6 - 0.2 && out.hx < -10.6, `家の横 (${mid.hx.toFixed(1)}, ${mid.hz.toFixed(2)}) → (${out.hx.toFixed(1)}, ${out.hz.toFixed(2)})`);
  check('路地で家に隠れる所では、家が半透明になる', fade[1] < 0.5, `透明度 ${JSON.stringify(fade)}（城門・町家・松・広葉樹）`);
  await ctx.close();
}

// ---------------- スマホ相当（タッチのスティック） ----------------
{
  const { ctx, page } = await open({ isMobile: true, hasTouch: true });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y, id: 1 })) });
  const C = [170, 380];
  for (const d of DIRS) {
    await put(page, OPEN.x, OPEN.z);
    await saveCam(page);
    const a = await heroOnScreen(page);
    const m = Math.hypot(d.v[0], d.v[1]);
    await touch('touchStart', [C]);
    await touch('touchMove', [[C[0] + (d.v[0] / m) * 70, C[1] + (d.v[1] / m) * 70]]); // いっぱいに倒す
    await stepN(page, 30);
    const b = await heroOnScreen(page);
    await touch('touchEnd', []);
    const got = Math.atan2(b.y - a.y, b.x - a.x);
    const err = angDiff(got, Math.atan2(d.v[1], d.v[0]));
    const k = kbResult[d.name];
    const same = Math.hypot(b.hx - a.hx - k.dx, b.hz - a.hz - k.dz) < 0.02 && Math.abs(b.speed - k.speed) < 0.02;
    check(`スティック「${d.name}」：画面の${d.name}へ動き、キーと同じ動き`, err < (12 * Math.PI) / 180 && same, `画面上の向きのずれ ${deg(err)}°・キーとの差 ${Math.hypot(b.hx - a.hx - k.dx, b.hz - a.hz - k.dz).toFixed(3)}m`);
    if (d.name === '右上') await shotFrozen(page, 'p3dir-stick-4.png', a, 'スティック 右上（黄色の丸＝倒す前の位置）');
  }
  // 指を離すと止まる
  await put(page, OPEN.x, OPEN.z);
  await touch('touchStart', [C]);
  await touch('touchMove', [[C[0], C[1] - 70]]);
  await stepN(page, 20);
  await touch('touchEnd', []);
  await stepN(page, 10);
  const t1 = await heroOnScreen(page);
  await stepN(page, 30);
  const t2 = await heroOnScreen(page);
  check('指を離すと 0.33 秒以内に止まり、その場から動かない', t1.speed === 0 && t1.hx === t2.hx && t1.hz === t2.hz);
  check('ページがスクロールしない', JSON.stringify(await page.evaluate(() => [scrollX, scrollY])) === '[0,0]');
  await ctx.close();
}

// まとめの画像
const img = (f) => `data:image/png;base64,${readFileSync(`${S}/${f}`).toString('base64')}`;
const files = [...DIRS.map((_, i) => `p3dir-key-${i}.png`), 'p3dir-stick-4.png', 'p3dir-gate.png', 'p3dir-alley.png'];
const sheet = await browser.newPage({ viewport: { width: 1500, height: 800 } });
await sheet.setContent(`<body style="margin:0;background:#15130f"><div style="display:grid;grid-template-columns:repeat(4,360px);gap:10px;padding:12px">
${files.map((f) => `<img src="${img(f)}" style="width:360px;border-radius:4px">`).join('')}</div></body>`);
await sheet.screenshot({ path: `${S}/p3dir.png`, fullPage: true });

console.log('errors:', JSON.stringify(errors));
if (errors.length) failed++;
console.log(failed ? `NG が ${failed} 件` : 'すべて OK');
await browser.close();
process.exit(failed ? 1 : 0);
