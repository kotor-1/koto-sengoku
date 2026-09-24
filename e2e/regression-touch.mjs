import { BASE, launchBrowser, outDir } from './lib.mjs';
const S = outDir(process.argv[2]);
const browser = await launchBrowser();
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const cdp = await ctx.newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id, radiusX: 5, radiusY: 5, force: 1 })) });
await page.goto(BASE + '/');
await page.waitForTimeout(1500);
console.log('touch-ui:', await page.evaluate(() => document.body.classList.contains('touch-ui')));
await page.screenshot({ path: `${S}/m1-title.png` });
await page.tap('#btn-new');
await page.waitForTimeout(600);
const st = () => page.evaluate(() => { const s = window.__koto.app.getSession(); return JSON.parse(JSON.stringify({ p: s.state.player, dlg: s.state.dialogue ? s.state.dialogue.index : null, flags: s.state.flags })); });
const zoom = await page.evaluate(() => window.__koto.game.scene.getScene('World').cameras.main.zoom);
console.log('zoom', zoom);
// 1 本指でスティック：左下 (120, 300) から右へドラッグ
const p0 = (await st()).p;
await touch('touchStart', [[120, 300, 1]]);
for (let i = 1; i <= 5; i++) { await touch('touchMove', [[120 + i * 12, 300, 1]]); await page.waitForTimeout(16); }
await page.waitForTimeout(500);
await page.screenshot({ path: `${S}/m2-stick.png` });
const p1 = (await st()).p;
console.log('stick move x:', p0.x, '->', p1.x.toFixed(1), 'moving', p1.moving);
// 「話す」ボタンの位置（押すのは家臣の隣に立ってから。相手が近くにいないとボタンは隠れる仕様）
const btn = await page.locator('#action-btn').boundingBox();
const bx = btn.x + btn.width / 2, by = btn.y + btn.height / 2;
// スティック＋ボタンの 2 本指の同時操作は e2e/multitouch.mjs で、ボタンが表示される位置で確かめる
// 指を全部離す
await touch('touchEnd', []);
await page.waitForTimeout(100);
const p4 = (await st()).p; await page.waitForTimeout(300); const p5 = (await st()).p;
console.log('released after all fingers up:', p4.x === p5.x, 'hasMovement', await page.evaluate(() => window.__koto.app.input.hasMovement()));
// 押したまま画面切替（visibilitychange 相当の blur / pagehide）
await touch('touchStart', [[120, 300, 3]]);
await touch('touchMove', [[60, 300, 3]]);
await page.waitForTimeout(200);
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
const q1 = (await st()).p; await page.waitForTimeout(300); const q2 = (await st()).p;
console.log('released on pagehide:', q1.x === q2.x, 'hasMovement', await page.evaluate(() => window.__koto.app.input.hasMovement()));
await touch('touchMove', [[40, 300, 3]]); // 同じ指を動かしても再開しない
await page.waitForTimeout(200);
console.log('stays released while same finger moves:', !(await page.evaluate(() => window.__koto.app.input.hasMovement())));
await touch('touchEnd', []);
// 会話：家臣の隣に移動しボタンをタップ
await page.evaluate(() => { const s = window.__koto.app.getSession(); s.state.player.x = 31*16+8; s.state.player.y = 10*16+8; s.state.player.facing="right"; });
await page.waitForTimeout(100);
console.log('button label:', await page.locator('#action-btn').innerText());
await touch('touchStart', [[bx, by, 4]]); await touch('touchEnd', []);
await page.waitForTimeout(200);
console.log('dialogue', (await st()).dlg, await page.locator('#action-btn').innerText());
await page.screenshot({ path: `${S}/m3-talk.png` });
// 会話枠をタップして進める
const dl = await page.locator('#dialogue').boundingBox();
await touch('touchStart', [[dl.x + 50, dl.y + 30, 5]]); await touch('touchEnd', []);
await page.waitForTimeout(100);
console.log('dialogue index after box tap', (await st()).dlg);
for (let i = 0; i < 3; i++) { await touch('touchStart', [[bx, by, 6]]); await touch('touchEnd', []); await page.waitForTimeout(60); }
console.log('dialogue after taps', (await st()).dlg);
// ページがスクロールしていないか
await touch('touchStart', [[600, 200, 7]]);
for (let i = 1; i <= 5; i++) await touch('touchMove', [[600, 200 - i * 30, 7]]);
await touch('touchEnd', []);
console.log('scroll', await page.evaluate(() => [window.scrollX, window.scrollY, document.scrollingElement.scrollTop]));
// 切り欠きの模擬（左右 47px, 下 21px）
await page.addStyleTag({ content: ':root{--safe-l:47px;--safe-r:47px;--safe-b:21px;} #safe-probe{padding:0 47px 21px 47px !important;}' });
await page.waitForTimeout(200);
await page.screenshot({ path: `${S}/m4-notch.png` });
const sb = await page.locator('#stick-base').boundingBox(); console.log('stick base after reset', JSON.stringify(sb), 'left>=47:', sb.x >= 47, 'bottom<=390-21:', sb.y + sb.height <= 369);
const vb = await page.locator('#action-btn').boundingBox();
const mb = await page.locator('#menu-btn').boundingBox();
console.log('action btn right edge', vb.x + vb.width, '<= 844-47:', vb.x + vb.width <= 797, 'menu', mb.x + mb.width <= 797);
// 縦画面
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
console.log('portrait hint visible:', await page.locator('#rotate-hint').isVisible());
await page.screenshot({ path: `${S}/m5-portrait.png` });
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(400);
console.log('portrait hint after rotate back:', await page.locator('#rotate-hint').isVisible());
// メニューから保存
await page.tap('#menu-btn'); await page.waitForTimeout(200);
await page.tap('#btn-save'); await page.waitForTimeout(200);
console.log('mobile save:', await page.locator('#menu-status').innerText());
await page.screenshot({ path: `${S}/m6-menu.png` });
console.log('errors:', errors);
await browser.close();
