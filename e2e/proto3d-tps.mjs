// 3D 比較版：肩越しの三人称の探索を、本物のマウス・キー・タッチで確かめる。
//   - 初めは主人公の背後から城門の方を見る
//   - PC：ドラッグで見回す。ボタン（歩く／走る・主人公の新旧）を押しても視点は動かない
//   - 移動はカメラの向きに合わせる
//   - スマホ：左のスティックで歩きながら、右側を別の指でなぞって見回せる。途中で走るボタンを押しても見回しが乱れない
//   - 指を離す・フォーカスが外れると、移動も見回しも止まる
//   - 町の中を歩き回っても、カメラが壁・屋根・柱の中に入らない
// 検証コンテナはソフトウェア描画で遅いので、ゲームの時間は 1/30 秒ずつ決まった量だけ進める（入力は本物のまま）。
// 使い方: npm run proto3d:dev を起動しておき、node e2e/proto3d-tps.mjs [出力先]
import { launchBrowser, outDir } from './lib.mjs';

const S = outDir(process.argv[2]);
const BASE = process.env.BASE3D || 'http://localhost:8090';
const browser = await launchBrowser();
let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}`);
};
const errors = [];
async function open(opts) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/?q=low');
  await page.waitForFunction(() => window.__p3?.stats.readyMs > 0, null, { timeout: 240000 });
  await page.evaluate(() => { window.__p3.manual(); for (let i = 0; i < 10; i++) window.__p3.step(1 / 30, 0, 0); });
  return { ctx, page };
}
const st = (page) => page.evaluate(() => {
  const p = window.__p3;
  return { x: p.hero.x, z: p.hero.z, speed: p.hero.speed, heading: p.hero.heading, yaw: p.orbit.yaw, pitch: p.orbit.pitch, dist: p.orbit.dist, cam: p.camera.position.toArray(), look: p.lookActive, run: p.anim.runMode, inside: p.cameraInside() };
});
const stepN = (page, n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.__p3.stepInput(1 / 30); }, n);
const f2 = (v) => v.toFixed(2);
const ang = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

// ---------------- PC ----------------
{
  const { ctx, page } = await open({});
  const s0 = await st(page);
  await page.screenshot({ path: `${S}/p3tps-pc-start.png`, timeout: 300000 });
  check('肩越しのカメラ：初めは主人公の背後（南）から城門の方（北）を見る', s0.cam[2] > s0.z + 2 && s0.yaw === 0 && s0.cam[1] > 1.5, `カメラ (${s0.cam.map(f2)})・主人公 (${f2(s0.x)}, ${f2(s0.z)})`);

  // マウスのドラッグで見回す（右へ 200px）
  await page.mouse.move(480, 270);
  await page.mouse.down();
  await page.mouse.move(580, 270, { steps: 4 });
  await page.mouse.move(680, 270, { steps: 4 });
  const mid = await st(page);
  await page.mouse.up();
  const s1 = await st(page);
  check('PC：画面を右へドラッグすると右を向く（主人公は動かない）', s1.yaw < -0.8 && mid.look && !s1.look && s1.x === s0.x && s1.z === s0.z, `向き ${f2(s0.yaw)} → ${f2(s1.yaw)}`);

  // 上へドラッグで上を向く
  await page.mouse.move(480, 300);
  await page.mouse.down();
  await page.mouse.move(480, 240, { steps: 4 });
  await page.mouse.up();
  const s2 = await st(page);
  check('PC：上へドラッグすると上を向く', s2.pitch < s1.pitch, `上下 ${f2(s1.pitch)} → ${f2(s2.pitch)}`);

  // ボタンを押しても視点は動かない
  await page.click('#run-btn');
  await page.click('#hero-btn');
  await page.waitForFunction(() => window.__p3.heroModel === 'old', null, { timeout: 240000 });
  await page.click('#hero-btn');
  await page.waitForFunction(() => window.__p3.heroModel === 'v2', null, { timeout: 60000 });
  const s3 = await st(page);
  check('PC：歩く／走る・主人公の新旧のボタンを押しても、視点は動かない', s3.yaw === s2.yaw && s3.pitch === s2.pitch && s3.run && !s3.look);
  await page.click('#run-btn'); // 歩くに戻す

  // 移動はカメラの向きに合わせる（W でカメラの前へ）
  await page.keyboard.down('KeyW');
  await stepN(page, 30);
  await page.keyboard.up('KeyW');
  const s4 = await st(page);
  const fwd = [-Math.sin(s3.yaw), -Math.cos(s3.yaw)];
  const mv = [s4.x - s3.x, s4.z - s3.z];
  const cos = (mv[0] * fwd[0] + mv[1] * fwd[1]) / Math.hypot(...mv);
  check('W（上）でカメラの向いている方へ進み、主人公もその方を向く', cos > 0.99 && Math.hypot(...mv) > 1 && ang(s4.heading, Math.atan2(fwd[0], fwd[1])) < 0.2, `向きの一致 ${cos.toFixed(3)}・${f2(Math.hypot(...mv))}m`);
  await stepN(page, 12);
  const s5 = await st(page);
  check('キーを離すと止まる', s5.speed === 0);

  // フォーカスが外れると、ドラッグ中でも見回しが止まる
  await page.mouse.move(480, 270);
  await page.mouse.down();
  await page.mouse.move(520, 270, { steps: 2 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const y0 = (await st(page)).yaw;
  await page.mouse.move(700, 270, { steps: 4 });
  const s6 = await st(page);
  await page.mouse.up();
  check('フォーカスが外れると、ドラッグの途中でも見回しが止まる', !s6.look && s6.yaw === y0);

  // 町を歩き回る：道 → 町家の軒下 → 家の横の路地 → 城門をくぐる。カメラを回しながら、壁・屋根・柱の中に入らないか
  await page.evaluate(() => { const h = window.__p3.hero; Object.assign(h, { x: 0.8, z: 8, heading: Math.PI, speed: 0 }); window.__p3.orbit.yaw = 0; window.__p3.orbit.pitch = 0.1; });
  const route = [
    ['KeyW', 60], ['KeyA', 40], ['KeyW', 50], ['KeyD', 25], ['KeyW', 30], ['KeyA', 50], ['KeyS', 20], ['KeyD', 60], ['KeyW', 80],
  ];
  let insideFrames = 0;
  let frames = 0;
  let minDist = 99;
  for (const [key, n] of route) {
    await page.keyboard.down(key);
    for (let i = 0; i < n; i += 5) {
      await page.evaluate(() => { for (let k = 0; k < 5; k++) { window.__p3.look(7, (Math.random() - 0.5) * 6); window.__p3.stepInput(1 / 30); } });
      const s = await st(page);
      frames++;
      if (s.inside) insideFrames++;
      minDist = Math.min(minDist, s.dist);
    }
    await page.keyboard.up(key);
  }
  const end = await st(page);
  await page.screenshot({ path: `${S}/p3tps-pc-walk.png`, timeout: 300000 });
  // 壁を背にして立つと、カメラは壁の手前（頭のすぐ後ろ）まで寄る。そのときは主人公を描かない（main.ts）
  check('町を歩き回り、カメラを回し続けても、カメラが壁・屋根・柱の中に入らない', insideFrames === 0 && frames > 60, `${frames} か所で確認・壁に寄った最短の距離 ${f2(minDist)}m・終わりの位置 (${f2(end.x)}, ${f2(end.z)})`);

  // 城門をくぐる
  await page.evaluate(() => { const h = window.__p3.hero; Object.assign(h, { x: 0, z: -6, heading: Math.PI, speed: 0 }); window.__p3.orbit.yaw = 0; window.__p3.orbit.pitch = 0.1; });
  await page.keyboard.down('KeyW');
  let gateInside = 0;
  for (let i = 0; i < 18; i++) {
    await stepN(page, 10);
    if ((await st(page)).inside) gateInside++;
  }
  await page.keyboard.up('KeyW');
  const g = await st(page);
  check('肩越しのまま城門をくぐれる（カメラは門の柱・梁・屋根に入らない）', g.z < -14 && gateInside === 0, `z ${f2(g.z)}`);
  await ctx.close();
}

// ---------------- スマホ相当（2〜3 本の指） ----------------
{
  const { ctx, page } = await open({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })) });
  const lookBox = await page.locator('#look-zone').boundingBox();
  const stickBox = await page.locator('#stick-zone').boundingBox();
  check('スマホ：見回しは右半分、スティックは左半分で、重ならない', lookBox.x >= stickBox.x + stickBox.width - 1, `見回し x=${Math.round(lookBox.x)}〜・スティック 〜${Math.round(stickBox.x + stickBox.width)}`);
  const s0 = await st(page);
  // 左の指でスティックを上へ、右の指で右へなぞる（同時）
  const A = [150, 300];
  const L = [600, 200];
  await touch('touchStart', [[...A, 1]]);
  await touch('touchMove', [[A[0], A[1] - 70, 1]]);
  await touch('touchStart', [[A[0], A[1] - 70, 1], [...L, 2]]);
  for (let k = 1; k <= 6; k++) {
    await touch('touchMove', [[A[0], A[1] - 70, 1], [L[0] + k * 20, L[1], 2]]);
    await stepN(page, 5);
  }
  const s1 = await st(page);
  await page.screenshot({ path: `${S}/p3tps-phone-walk-look.png`, timeout: 300000 });
  check('スマホ：左で歩きながら、右を別の指でなぞって見回せる', s1.speed > 1 && s1.yaw < s0.yaw - 0.4 && s1.look, `向き ${f2(s0.yaw)} → ${f2(s1.yaw)}・速さ ${f2(s1.speed)}`);
  check('スマホ：歩く向きはカメラの向きに合わせて変わる', ang(s1.heading, Math.atan2(-Math.sin(s1.yaw), -Math.cos(s1.yaw))) < 0.35, `主人公の向き ${f2(s1.heading)}・カメラの前 ${f2(Math.atan2(-Math.sin(s1.yaw), -Math.cos(s1.yaw)))}`);
  // 3 本目の指で「走る」を押す。見回し・移動は続く
  const rb = await page.locator('#run-btn').boundingBox();
  const R = [rb.x + rb.width * 0.75, rb.y + rb.height / 2];
  const yb = (await st(page)).yaw;
  await touch('touchStart', [[A[0], A[1] - 70, 1], [L[0] + 120, L[1], 2], [...R, 3]]);
  await touch('touchEnd', [[...R, 3]]);
  await stepN(page, 25);
  const s2 = await st(page);
  check('スマホ：歩きながら見回している途中に「走る」を押せる（視点は跳ばない）', s2.run && s2.speed > 3 && s2.look && s2.yaw === yb, `速さ ${f2(s2.speed)}`);
  // 見回しの指だけ離す → 見回し終わり、歩きは続く
  await touch('touchEnd', [[L[0] + 120, L[1], 2]]);
  await stepN(page, 3);
  const s3 = await st(page);
  check('スマホ：見回しの指を離しても、スティックの指で移動は続く', !s3.look && s3.speed > 3);
  await touch('touchEnd', [[A[0], A[1] - 70, 1]]);
  await stepN(page, 12);
  const s4 = await st(page);
  check('スマホ：スティックの指も離すと止まる', s4.speed === 0);
  check('スマホ：ページがスクロールしない', JSON.stringify(await page.evaluate(() => [scrollX, scrollY])) === '[0,0]');
  await ctx.close();
}

console.log('errors:', JSON.stringify(errors));
if (errors.length) failed++;
console.log(failed ? `NG が ${failed} 件` : 'すべて OK');
await browser.close();
process.exit(failed ? 1 : 0);
