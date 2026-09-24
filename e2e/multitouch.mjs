import { BASE, launchBrowser } from './lib.mjs';
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })) });
await page.goto(BASE + '/');
await page.waitForTimeout(1200);
await page.tap('#btn-new');
await page.waitForTimeout(400);
await page.evaluate(() => {
  window.__log = [];
  for (const id of ['stick-zone', 'action-btn']) for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture'])
    document.getElementById(id).addEventListener(t, (e) => window.__log.push(`${id} ${t} #${e.pointerId}`));
  // 家臣の左隣（右向き）：「話す」ボタンが表示される位置
  const s = window.__koto.app.getSession(); s.state.player.x = 31*16+8; s.state.player.y = 10*16+8; s.state.player.facing = 'right';
});
await page.waitForFunction(() => !document.getElementById('action-btn').classList.contains('idle'), null, { timeout: 10000 });
const btn = await page.locator('#action-btn').boundingBox();
const bx = btn.x + btn.width / 2, by = btn.y + btn.height / 2;
const hm = () => page.evaluate(() => window.__koto.app.input.hasMovement());
// 左へ（家臣から離れる向き）スティックを倒すと、ボタンが隠れないよう右向きのまま少しだけ動く
await touch('touchStart', [[120, 300, 1]]);
await touch('touchMove', [[125, 300, 1]]);
console.log('1 finger stick:', await hm(), '(小さく倒しているので無反応域なら false でもよい)');
await touch('touchStart', [[170, 300, 1], [bx, by, 2]]);
console.log('2 fingers: ボタン押下表示', await page.locator('#action-btn').getAttribute('class'), '会話開始', await page.evaluate(() => window.__koto.app.getSession().state.dialogue !== null), 'スティックの指は追跡中', await page.evaluate(() => document.getElementById('stick-zone').classList.contains('active')));
await touch('touchMove', [[175, 305, 1], [bx, by, 2]]);
console.log('after move with 2 fingers:', await hm());
await touch('touchEnd', [[bx, by, 2]]);
console.log('after lifting button finger:', await hm(), await page.locator('#action-btn').getAttribute('class'));
await touch('touchMove', [[180, 300, 1]]);
console.log('stick finger moves again:', await hm());
await touch('touchEnd', []);
console.log('all up:', await hm());
console.log((await page.evaluate(() => window.__log)).join('\n'));
await browser.close();
