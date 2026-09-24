// 最終確認用スクリーンショット: BASE=... node final.mjs <出力dir> [pc|phone|both] [spots(カンマ区切り)]
import { BASE, launchBrowser, outDir } from './lib.mjs';
const out = outDir(process.argv[2]);
const which = process.argv[3] || 'both';
const only = process.argv[4] ? process.argv[4].split(',') : null;
const browser = await launchBrowser();
const DEVICES = {
  pc: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
// 構図：主人公の位置（タイル）、最後に歩く向き、時間帯
const SPOTS = {
  'town-day': { tx: 43.2, ty: 26.6, walk: [-1, 1], tod: 'day' },
  'town-evening': { tx: 43.2, ty: 26.6, walk: [-1, 1], tod: 'evening' },
  'town-night': { tx: 43.2, ty: 26.6, walk: [-1, 1], tod: 'night' },
  'occlusion': { tx: 35, ty: 28.7, walk: [-1, 0], tod: 'evening' },
  'gate-retainer': { tx: 28.5, ty: 12.3, walk: [1, -1], tod: 'day' },
  'crossroads': { tx: 28.2, ty: 25.2, walk: [1, 1], tod: 'evening' },
};
const KEY = { '1': 'ArrowRight', '-1': 'ArrowLeft' };
const KEYY = { '1': 'ArrowDown', '-1': 'ArrowUp' };
for (const dev of which === 'both' ? ['pc', 'phone'] : [which]) {
  for (const [name, sp] of Object.entries(SPOTS)) {
    if (only && !only.includes(name)) continue;
    const ctx = await browser.newContext(DEVICES[dev]);
    await ctx.addInitScript((t) => localStorage.setItem('koto-sengoku/visual', JSON.stringify({ timeOfDay: t })), sp.tod);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + '/?q=high');
    await page.waitForFunction(() => window.__koto?.game.scene.getScene('World')?.hero, null, { timeout: 30000 });
    await page.waitForTimeout(500);
    if (dev === 'phone') await page.tap('#btn-new'); else await page.click('#btn-new');
    await page.waitForTimeout(400);
    // 少し手前に置いてから、指定の向きへ歩かせて止める（自然な立ち姿）
    const [wx, wy] = sp.walk;
    await page.evaluate(([x, y]) => { const s = window.__koto.app.getSession(); s.state.player.x = x * 16 + 8; s.state.player.y = y * 16 + 8; }, [sp.tx - wx * 0.6, sp.ty - wy * 0.6]);
    await page.waitForTimeout(600);
    const keys = [wx ? KEY[String(wx)] : null, wy ? KEYY[String(wy)] : null].filter(Boolean);
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForFunction(([x, y]) => { const p = window.__koto.app.getSession().state.player; return Math.hypot(p.x - (x * 16 + 8), p.y - (y * 16 + 8)) < 3 || window.__koto.game.loop.frame > 1e9; }, [sp.tx, sp.ty], { timeout: 4000 }).catch(() => {});
    for (const k of keys) await page.keyboard.up(k);
    // 光の切り替えとカメラが落ち着くまで待つ
    await page.waitForFunction(() => window.__koto.game.scene.getScene('World').lightT >= 1, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2200);
    const file = `${out}/${dev}-${name}.png`;
    await page.screenshot({ path: file });
    const st = await page.evaluate(() => { const sc = window.__koto.game.scene.getScene('World'); return { faded: sc.standing.filter((o) => o.occluder && o.obj.alpha < 0.8).length, dir: sc.hero.heading.dir, stats: sc.stats, scale: window.__koto.viewport.renderScale }; });
    console.log(file, JSON.stringify(st), errors.length ? 'ERRORS ' + JSON.stringify(errors) : '');
    await ctx.close();
  }
}
await browser.close();
