// 既存の 2D 版と 3D 比較版の、実際のゲーム画面を並べる（PC 1280×720・スマホ横 844×390）。
//   2D 版：npm run dev（http://localhost:8080）、3D 版：npm run proto3d:dev（http://localhost:8090）を起動しておく。
//   どちらも城門・民家・木・道・主人公が入る位置に主人公を置いて撮る。
// 出力：<出力先>/compare-{pc,phone}-{2d,3d}.png と compare.png（4 枚を並べたもの）
import { readFileSync } from 'node:fs';
import { launchBrowser, outDir } from './lib.mjs';

const S = outDir(process.argv[2]);
const B2 = process.env.BASE || 'http://localhost:8080';
const B3 = process.env.BASE3D || 'http://localhost:8090';
const browser = await launchBrowser();
const sizes = { pc: { width: 1280, height: 720 }, phone: { width: 844, height: 390 } };

for (const [name, vp] of Object.entries(sizes)) {
  const phone = name === 'phone';
  const opts = { viewport: vp, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone };
  // 2D 版：城門の南、橋の手前（城門・城下の家・木・道が入る）
  {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    await page.goto(B2 + '/');
    await page.waitForFunction(() => window.__koto?.game.scene.getScene('World')?.stats.readyMs > 0, null, { timeout: 90000 });
    if (phone) await page.tap('#btn-new'); else await page.click('#btn-new');
    await page.evaluate(() => { const s = window.__koto.app.getSession(); s.state.player.x = 27.5 * 16 + 8; s.state.player.y = 17 * 16 + 8; s.state.player.facing = 'up'; });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${S}/compare-${name}-2d.png` });
    await ctx.close();
  }
  // 3D 版：城門の手前、町家の横（城門・町家・松・道が入る）
  {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    await page.goto(B3 + '/');
    await page.waitForFunction(() => window.__p3?.stats.readyMs > 0, null, { timeout: 120000 });
    await page.evaluate(() => {
      window.__p3.manual();
      const h = window.__p3.hero;
      h.x = 0.6; h.z = -5.2; h.heading = Math.PI;
      for (let i = 0; i < 90; i++) window.__p3.step(1 / 30, 0, 0);
    });
    await page.screenshot({ path: `${S}/compare-${name}-3d.png` });
    await ctx.close();
  }
  console.log('saved', name);
}

const img = (f) => `data:image/png;base64,${readFileSync(`${S}/${f}`).toString('base64')}`;
const cell = (label, f, w) => `<div><div style="font-size:15px;margin:0 0 6px">${label}</div><img src="${img(f)}" style="width:${w}px;border-radius:6px;display:block"></div>`;
const page = await browser.newPage({ viewport: { width: 1340, height: 600 } });
await page.setContent(`<body style="margin:0;background:#15130f;color:#eee7d6;font-family:sans-serif">
<div style="display:grid;grid-template-columns:640px 640px;gap:14px 16px;padding:16px">
${cell('既存の 2D 版（承認された見た目）・PC 1280×720', 'compare-pc-2d.png', 640)}
${cell('3D 比較版・PC 1280×720', 'compare-pc-3d.png', 640)}
${cell('既存の 2D 版・スマホ横 844×390', 'compare-phone-2d.png', 640)}
${cell('3D 比較版・スマホ横 844×390', 'compare-phone-3d.png', 640)}
</div></body>`);
await page.screenshot({ path: `${S}/compare.png`, fullPage: true });
await browser.close();
console.log('saved', `${S}/compare.png`);
