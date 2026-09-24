// 2.5D 表示の自動確認: BASE=... node visual.mjs <出力dir>
import { BASE, launchBrowser, outDir } from './lib.mjs';
const out = outDir(process.argv[2]);
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: +(process.env.W || 960), height: +(process.env.H || 540) }, deviceScaleFactor: +(process.env.DPR || 1) });
await ctx.addInitScript(() => localStorage.setItem('koto-sengoku/visual', JSON.stringify({ timeOfDay: 'evening' })));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const t0 = Date.now();
await page.goto(BASE + '/?q=high');
await page.waitForFunction(() => window.__koto && window.__koto.game.scene.getScene('World')?.hero, null, { timeout: 20000 });
console.log('scene ready ms:', Date.now() - t0, 'stats', JSON.stringify(await page.evaluate(() => window.__koto.game.scene.getScene('World').stats)));
const waitFor = async (fn, arg, ms = 8000) => { try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch { return false; } };
const check = (name, ok, extra = '') => console.log(`${ok ? 'OK ' : 'NG '} ${name} ${extra}`);
const info = await page.evaluate(() => {
  const { game, viewport, quality } = window.__koto;
  return { canvasW: game.canvas.width, cssW: parseFloat(game.canvas.style.width), scale: viewport.renderScale, tier: quality.tier };
});
check('解像度は CSS×renderScale（上限2）', info.scale <= 2 && Math.abs(info.canvasW - info.cssW * info.scale) <= 1, JSON.stringify(info));
await page.click('#btn-new');
await page.waitForTimeout(300);
const place = (tx, ty, f = 'up') => page.evaluate(([x, y, f]) => { const s = window.__koto.app.getSession(); s.state.player.x = x * 16 + 8; s.state.player.y = y * 16 + 8; s.state.player.facing = f; }, [tx, ty, f]);
const houseAlpha = (tx, ty) => page.evaluate(([tx, ty]) => {
  const sc = window.__koto.game.scene.getScene('World');
  // 敷地 (tx..,ty..) の民家の Image を探す
  const x = (tx + 2.5) * 16, bottom = (ty + 3) * 16;
  const s = sc.standing.find((s) => Math.abs(s.obj.x - x) < 1 && Math.abs(s.baseY - bottom) < 1);
  return s ? { alpha: s.obj.alpha, depth: s.obj.depth, heroDepth: sc.hero.sprite.depth } : null;
}, [tx, ty]);
// 民家（x4..8, y30..32）の裏（y=29）に立つ
await place(6, 29);
await waitFor(() => { const sc = window.__koto.game.scene.getScene('World'); return sc.standing.some((s) => Math.abs(s.obj.x - 104) < 1 && s.obj.alpha < 0.5); });
let h = await houseAlpha(4, 30);
check('家の裏に入ると家が半透明', h && h.alpha < 0.7, JSON.stringify(h));
check('裏にいる主人公は家より奥（depth 小）', h && h.heroDepth < h.depth);
await page.screenshot({ path: `${out}/v1-behind-house.png` });
await place(6, 33, 'down');
await waitFor(() => { const sc = window.__koto.game.scene.getScene('World'); return sc.standing.some((s) => Math.abs(s.obj.x - 104) < 1 && Math.abs(s.baseY - 528) < 1 && s.obj.alpha > 0.99); });
h = await houseAlpha(4, 30);
check('家の前に出ると不透明に戻る', h && h.alpha > 0.98, JSON.stringify(h));
check('手前の主人公は家より手前（depth 大）', h && h.heroDepth > h.depth);
// 木の裏
const cull = await page.evaluate(() => {
  const sc = window.__koto.game.scene.getScene('World');
  const all = sc.standing.length + sc.tufts.length;
  const vis = sc.standing.filter((s) => s.obj.visible).length + sc.tufts.filter((s) => s.obj.visible).length;
  return { all, vis };
});
check('画面外の物は非表示（間引き）', cull.vis < cull.all * 0.6, JSON.stringify(cull));
// 時間帯の切り替え（T キー）
const tint0 = await page.evaluate(() => window.__koto.game.scene.getScene('World').tintLayer.tintTopLeft);
const label0 = await page.locator('#time-btn .time-label').innerText();
await page.keyboard.press('t');
await waitFor(() => window.__koto.game.scene.getScene('World').lightT >= 1);
const tint1 = await page.evaluate(() => window.__koto.game.scene.getScene('World').tintLayer.tintTopLeft);
const label1 = await page.locator('#time-btn .time-label').innerText();
check('T キーで時間帯が変わる', label0 !== label1 && tint0 !== tint1, `${label0}->${label1} ${tint0.toString(16)}->${tint1.toString(16)}`);
await page.screenshot({ path: `${out}/v2-night.png` });
await page.click('#time-btn');
await waitFor(() => window.__koto.game.scene.getScene('World').lightT >= 1);
check('ボタンでも時間帯が変わる', (await page.locator('#time-btn .time-label').innerText()) !== label1);
await page.screenshot({ path: `${out}/v3-day.png` });
// 8 方向：斜めに歩くと斜めの向き
await place(28, 24, 'down');
await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowUp');
await waitFor(() => window.__koto.game.scene.getScene('World').hero.heading.dir === 3, null, 5000);
const dir = await page.evaluate(() => window.__koto.game.scene.getScene('World').hero.heading.dir);
// 2 つのキーを同じ瞬間に離す（ずれて離す場合は単体テストで確認）
await page.evaluate(() => { for (const code of ['ArrowRight', 'ArrowUp']) window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code })); });
await page.keyboard.up('ArrowRight'); await page.keyboard.up('ArrowUp');
check('右上へ歩くと右上向き（8 方向）', dir === 3, `dir=${dir}`);
await waitFor(() => !window.__koto.game.scene.getScene('World').hero.heading.moving, null, 5000);
const dir2 = await page.evaluate(() => window.__koto.game.scene.getScene('World').hero.heading.dir);
check('止まっても斜め向きのまま待機', dir2 === 3, `dir=${dir2}`);
// カメラが主人公の近くにある
await page.waitForTimeout(1200);
const cam = await page.evaluate(() => { const sc = window.__koto.game.scene.getScene('World'); const c = sc.cameras.main; return { cx: c.midPoint.x, cy: c.midPoint.y, hx: sc.hero.sprite.x, hy: sc.hero.sprite.y }; });
await page.waitForTimeout(1500);
check('カメラは主人公を追う', Math.hypot(cam.cx - cam.hx, cam.cy - (cam.hy - 12)) < 24, JSON.stringify(cam));
// 会話中は吹き出しが消える／近くで出る
await place(31, 10, 'right');
await waitFor(() => window.__koto.game.scene.getScene('World').bubble.visible);
const bub = await page.evaluate(() => window.__koto.game.scene.getScene('World').bubble.visible);
check('家臣の近くで吹き出し表示', bub === true);
await page.screenshot({ path: `${out}/v4-retainer.png` });
await page.keyboard.press('Space');
await waitFor(() => !window.__koto.game.scene.getScene('World').bubble.visible);
const bub2 = await page.evaluate(() => window.__koto.game.scene.getScene('World').bubble.visible);
check('会話中は吹き出しを消す', bub2 === false);
await page.screenshot({ path: `${out}/v5-dialogue.png` });
console.log('errors:', JSON.stringify(errors));
await browser.close();
