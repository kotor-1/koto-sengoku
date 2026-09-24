// 既知の描画問題（木が三角に欠ける）の再現と、回避策が効いているかの確認。docs/known-issues.md 参照。
// 使い方: BASE=... node e2e/tree-wedge-repro.mjs <出力dir>
// 出力: wedge-default.png（回避あり：欠けないはず） / wedge-rotsway.png（回転で揺らす：検証環境では欠ける）
//       wedge-rotsway-maxtex1.png（回転＋ maxTextures=1：検証環境では欠けない）
import { BASE, launchBrowser, outDir } from './lib.mjs';
const out = outDir(process.argv[2]);
const browser = await launchBrowser();
for (const [name, query] of [['default', ''], ['rotsway', '&rotsway'], ['rotsway-maxtex1', '&rotsway&maxtex=1']]) {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => localStorage.setItem('koto-sengoku/visual', JSON.stringify({ timeOfDay: 'day' })));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?q=high${query}`);
  await page.waitForFunction(() => window.__koto?.game.scene.getScene('World')?.hero, null, { timeout: 30000 });
  await page.click('#btn-new');
  // 木が多い、川の東側の街道の近く
  await page.evaluate(() => { const s = window.__koto.app.getSession(); s.state.player.x = 43.2 * 16 + 8; s.state.player.y = 26.6 * 16 + 8; });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/wedge-${name}.png` });
  console.log(`wedge-${name}.png`);
  await ctx.close();
}
await browser.close();
