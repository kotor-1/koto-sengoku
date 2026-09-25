// 3D 比較版：主人公の見た目（新＝自作モデル第 1 版／旧＝これまでの人形）を、同じ町・同じカメラ・同じ昼の光で並べる。
//   - いつものカメラ（PC 1280×720・スマホ横 844×390）と、近づけたカメラ（待機・歩き・走り・振り向きの途中）
//   - 切り替えのボタン（右上）を本物のクリック・タップで押して、見た目だけが替わり、位置・向き・操作はそのままか
// ゲームの時間は 1/30 秒ずつ決まった量だけ進める（検証コンテナはソフトウェア描画で遅いため）。
// 使い方: npm run proto3d:dev を起動しておき、node e2e/proto3d-hero-compare.mjs [出力先]
// 出力：p3hero-*.png と p3hero.png（まとめ）
import { readFileSync } from 'node:fs';
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

async function open(query, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/?q=low&view=top&${query}`);
  await page.waitForFunction(() => window.__p3?.stats.readyMs > 0, null, { timeout: 240000 });
  await page.evaluate(() => window.__p3.manual());
  return { ctx, page };
}
const put = (page, x, z, heading) => page.evaluate(([x, z, heading]) => {
  const p = window.__p3;
  Object.assign(p.hero, { x, z, heading, speed: 0, dirX: Math.sin(heading), dirZ: Math.cos(heading) });
  for (let i = 0; i < 45; i++) p.step(1 / 30, 0, 0);
}, [x, z, heading]);
const steps = (page, n, ix, iy) => page.evaluate(([n, ix, iy]) => { for (let i = 0; i < n; i++) window.__p3.step(1 / 30, ix, iy); }, [n, ix, iy]);

const rows = []; // [見出し, 新の画像, 旧の画像]
const shot = async (page, key, file) => {
  await page.screenshot({ path: `${S}/p3hero-${key}-${file}.png`, timeout: 300000 });
  return `p3hero-${key}-${file}.png`;
};

for (const key of ['v2', 'old']) {
  const q = key === 'old' ? 'hero=old' : '';
  // いつものカメラ：城門の手前（町家・松・城門が入る）
  {
    const { ctx, page } = await open(q);
    check(`${key}：読み込めて、選んだ見た目になっている`, (await page.evaluate(() => window.__p3.heroModel)) === key);
    await put(page, 0.6, -5.2, Math.PI);
    rows.push(['いつものカメラ・PC 1280×720・待機', key, await shot(page, key, 'game')]);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(q, { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await put(page, 0.6, -5.2, Math.PI);
    rows.push(['いつものカメラ・スマホ横 844×390・待機', key, await shot(page, key, 'phone')]);
    await ctx.close();
  }
  // 近づけたカメラ：草地で、画面の右（東）へ動く（横から見える）
  {
    const { ctx, page } = await open(`${q}&zoom=0.22`, { viewport: { width: 800, height: 600 } });
    await put(page, 12, 5, Math.PI / 2);
    rows.push(['近く・待機（右向き）', key, await shot(page, key, 'near-idle')]);
    await steps(page, 38, 1, 0);
    rows.push(['近く・歩き 1.55m/秒', key, await shot(page, key, 'near-walk')]);
    // 本物の入力（Shift ＋ →）で走らせる
    await page.keyboard.down('Shift');
    await page.keyboard.down('ArrowRight');
    await page.evaluate(() => { for (let i = 0; i < 30; i++) window.__p3.stepInput(1 / 30); });
    const run = await page.evaluate(() => ({ speed: window.__p3.hero.speed, runBlend: window.__p3.anim.runBlend }));
    rows.push(['近く・走り 3.41m/秒', key, await shot(page, key, 'near-run')]);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('Shift');
    check(`${key}：走りの動きになっている`, run.speed > 3.3 && run.runBlend === 1, `速さ ${run.speed.toFixed(2)}`);
    // 振り向きの途中（右へ歩いてから左を押して 0.1 秒）
    await steps(page, 30, 0, 0);
    await steps(page, 30, 1, 0);
    await steps(page, 3, -1, 0);
    rows.push(['近く・切り返し（左を押して 0.1 秒）', key, await shot(page, key, 'near-turn')]);
    await steps(page, 30, 0, 0);
    rows.push(['近く・止まった後', key, await shot(page, key, 'near-stop')]);
    await ctx.close();
  }
}

// 切り替えボタン：本物のクリック（PC）とタップ（スマホ）。位置・向き・歩く／走るはそのまま
{
  const { ctx, page } = await open('');
  await put(page, 3, 1, 1.0);
  await page.click('#run-btn');
  const a = await page.evaluate(() => ({ m: window.__p3.heroModel, x: window.__p3.hero.x, h: window.__p3.hero.heading, run: window.__p3.anim.runMode }));
  await page.click('#hero-btn');
  await page.waitForFunction(() => window.__p3.heroModel === 'old', null, { timeout: 240000 });
  await steps(page, 2, 0, 0);
  const b = await page.evaluate(() => ({ m: window.__p3.heroModel, x: window.__p3.hero.x, h: window.__p3.hero.heading, run: window.__p3.anim.runMode, on: document.getElementById('hero-btn').classList.contains('old') }));
  await page.click('#hero-btn');
  await page.waitForFunction(() => window.__p3.heroModel === 'v2', null, { timeout: 60000 });
  check('PC：右上のボタンをクリックすると新／旧が替わり、位置・向き・「走る」の選択はそのまま', a.m === 'v2' && b.m === 'old' && b.on && a.x === b.x && a.h === b.h && a.run && b.run);
  await ctx.close();
}
{
  const { ctx, page } = await open('', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const box = await page.locator('#hero-btn').boundingBox();
  const zone = await page.locator('#stick-zone').boundingBox();
  await page.tap('#hero-btn');
  await page.waitForFunction(() => window.__p3.heroModel === 'old', null, { timeout: 240000 });
  check('スマホ：右上のボタンのタップで切り替わり、スティックの範囲と重ならない', box.x > zone.x + zone.width && box.height >= 40, `ボタン ${Math.round(box.width)}×${Math.round(box.height)}px`);
  await ctx.close();
}

// まとめの画像（左：新、右：旧）
const img = (f) => `data:image/png;base64,${readFileSync(`${S}/${f}`).toString('base64')}`;
const labels = [...new Set(rows.map((r) => r[0]))];
const sheet = await browser.newPage({ viewport: { width: 1320, height: 800 } });
await sheet.setContent(`<body style="margin:0;background:#15130f;color:#eee7d6;font:14px sans-serif"><div style="padding:12px">
<div style="display:grid;grid-template-columns:640px 640px;gap:6px 16px;margin-bottom:8px"><div>新：自作の主人公モデル 第 2 版</div><div>旧：これまでの主人公</div></div>
${labels.map((l) => `<div style="margin:12px 0 4px">${l}</div><div style="display:grid;grid-template-columns:640px 640px;gap:16px">${['v2', 'old'].map((k) => `<img src="${img(rows.find((r) => r[0] === l && r[1] === k)[2])}" style="width:640px;border-radius:4px">`).join('')}</div>`).join('')}
</div></body>`);
await sheet.screenshot({ path: `${S}/p3hero.png`, fullPage: true });

console.log('errors:', JSON.stringify(errors));
if (errors.length) failed++;
console.log(failed ? `NG が ${failed} 件` : 'すべて OK');
await browser.close();
process.exit(failed ? 1 : 0);
