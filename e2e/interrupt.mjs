// 低 fps・画面の中断・復帰のあとに移動入力が残らないことの確認（キーボードとタッチ）。
// CPU を 6 倍遅くして低 fps を再現する（CDP の CPU スロットリング）。
// 使い方: BASE=... node e2e/interrupt.mjs
import { BASE, launchBrowser } from './lib.mjs';
const browser = await launchBrowser();
const check = (name, ok, extra = '') => console.log(`${ok ? 'OK ' : 'NG '} ${name} ${extra}`);
const errors = [];

async function open(touchDevice) {
  const ctx = await browser.newContext(touchDevice
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
    : { viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  await page.goto(BASE + '/?fps');
  await page.waitForFunction(() => window.__koto?.game.scene.getScene('World')?.hero, null, { timeout: 30000 });
  if (touchDevice) await page.tap('#btn-new'); else await page.click('#btn-new');
  // 広い場所へ
  await page.evaluate(() => { const s = window.__koto.app.getSession(); s.state.player.x = 27.5 * 16 + 8; s.state.player.y = 30 * 16 + 8; });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await page.waitForTimeout(1500);
  return { ctx, page, cdp };
}
const pos = (page) => page.evaluate(() => { const p = window.__koto.app.getSession().state.player; return { x: p.x, y: p.y }; });
// 実際に回ったフレーム数を 1 秒数える（Phaser の actualFps は平滑化されていて低 fps 時に実態とずれる）
const fps = (page) => page.evaluate(async () => { const l = window.__koto.game.loop; const f0 = l.frame; await new Promise((r) => setTimeout(r, 1000)); return l.frame - f0; });
const moved = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// 1 秒あたりの移動距離の期待値：1 フレームの時間を 0.1 秒で打ち切るので、実時間の min(1, フレーム数 × 0.1) 秒ぶん進む
const expected = (frames) => 76 * Math.min(1, frames * 0.1);
const hide = (page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('blur'));
});
const show = (page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
});

// ---- キーボード ----
{
  const { ctx, page } = await open(false);
  await page.keyboard.down('ArrowDown');
  const a0 = await pos(page); const f = await fps(page); const a1 = await pos(page);
  check('キーボード：低 fps でも押している間は動く', moved(a0, a1) > 3, `1 秒で ${moved(a0, a1).toFixed(1)}px・実測 ${f}fps`);
  check('キーボード：低 fps でもゲーム内時間が実時間どおり進む（スローにならない）', moved(a0, a1) > expected(f) * 0.7, `期待 ${expected(f).toFixed(0)}px 前後`);
  await hide(page);
  await page.waitForTimeout(800);
  await show(page);
  // キーは物理的には押されたまま（keyup は来ていない）。復帰後に勝手に動き続けないこと。
  const b0 = await pos(page); await page.waitForTimeout(1500); const b1 = await pos(page);
  check('キーボード：中断→復帰後、押しっぱなしが残らない', moved(b0, b1) < 0.5, `${moved(b0, b1).toFixed(2)}px`);
  await page.keyboard.up('ArrowDown');
  check('キーボード：入力状態も空', !(await page.evaluate(() => window.__koto.app.input.hasMovement())));
  await ctx.close();
}

// ---- タッチ（スティック） ----
{
  const { ctx, page, cdp } = await open(true);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  await touch('touchStart', [[150, 300, 1]]);
  await touch('touchMove', [[150, 345, 1]]);
  const a0 = await pos(page); const f = await fps(page); const a1 = await pos(page);
  check('タッチ：低 fps でもスティックを倒している間は動く', moved(a0, a1) > 3, `1 秒で ${moved(a0, a1).toFixed(1)}px・実測 ${f}fps`);
  check('タッチ：低 fps でもゲーム内時間が実時間どおり進む（スローにならない）', moved(a0, a1) > expected(f) * 0.7, `期待 ${expected(f).toFixed(0)}px 前後`);
  await hide(page);
  await page.waitForTimeout(800);
  await show(page);
  const b0 = await pos(page); await page.waitForTimeout(1500); const b1 = await pos(page);
  check('タッチ：中断→復帰後、指を置いたままでも動かない', moved(b0, b1) < 0.5, `${moved(b0, b1).toFixed(2)}px`);
  await touch('touchMove', [[150, 350, 1]]); // 同じ指を動かしても再開しない（触り直しが必要）
  const c0 = await pos(page); await page.waitForTimeout(1000); const c1 = await pos(page);
  check('タッチ：同じ指を動かしても再開しない', moved(c0, c1) < 0.5, `${moved(c0, c1).toFixed(2)}px`);
  await touch('touchEnd', []);
  await touch('touchStart', [[150, 300, 2]]);
  await touch('touchMove', [[150, 345, 2]]);
  const d0 = await pos(page); await page.waitForTimeout(1200); const d1 = await pos(page);
  check('タッチ：触り直せば再び動く', moved(d0, d1) > 3, `${moved(d0, d1).toFixed(1)}px`);
  await touch('touchEnd', []);
  await ctx.close();
}
console.log('errors:', JSON.stringify(errors));
await browser.close();
