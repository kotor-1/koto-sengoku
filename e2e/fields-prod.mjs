// 合戦場の演習を「本番ビルド」で、公開先に近い決まり（CSP）の下で始められるかを確かめる。開発用のフック（__game・__battle・__practice）は使わない
// （本番のビルドには無い）。早送りもしない（合戦は ×2 の実時間）。入力はすべて本物のクリック。記録は演習の保存（localStorage）から読む。
//
// 準備（公開と同じ作り）：
//   VITE_MODEL_EXT=.json npm run proto3d:build
//   rm dist-proto3d/models/*.glb
//   node proto3d/tools/glb-to-gltf.mjs proto3d/public/models dist-proto3d/models ground_v2 gate_v2 walls_v2 keep inner machiya_a machiya_b machiya_d tree_pine tree_sakura tree_pine_far hero_v3_mpfb hero_v2
// 使い方：node e2e/fields-prod.mjs [出力先]   （DIST=dist-proto3d PORT=8133 VIEW=1280x720 で変えられる）
// この中で、次のヘッダー付きの簡易サーバーを立てる：
//   content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'
// 経路：タイトル →「合戦場の演習」→ 一覧 → 戦場を選ぶ → 説明 → 出陣 → 合戦（合戦を始める・×2・全軍撤退）→ 結果 → 続ける → 演習の結果（勝敗・主目標・副目標・保存）
//       → 一覧へ、を 15 戦場（第1群・第2群・第3群）で。最後に開き直して、15 戦場の記録が一覧に残ること。演習の画面の塊（practiceView-*.js）を選んだときに読むこと。
//       CSP の違反・ページの誤り・読めなかったファイル・data: の URL が無いこと。
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { launchBrowser, outDir } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/fields-practice/prod');
const DIST = resolve(process.env.DIST || 'dist-proto3d');
const PORT = Number(process.env.PORT || 8133);
const [VW, VH] = (process.env.VIEW || '1280x720').split('x').map(Number);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };
const FIELD_IDS = ['plains', 'river_ford', 'hills', 'forest', 'mountain_pass', 'single_bridge', 'multi_bridge', 'ridge', 'valley', 'paddy', 'marsh', 'village', 'temple', 'town_edge', 'siege_front'];

if (!existsSync(join(DIST, 'index.html'))) throw new Error(`${DIST}/index.html が無い（先に本番ビルド）`);
const served = [];
const missing = [];
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(DIST, path === '/' ? 'index.html' : path));
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
    missing.push(path);
    res.writeHead(404, { 'content-security-policy': CSP });
    res.end('not found');
    return;
  }
  served.push(path);
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'content-security-policy': CSP, 'cache-control': 'no-store' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));
const URL0 = `http://localhost:${PORT}/?q=low`;

let failed = 0;
const T0 = Date.now();
const secs = () => `${((Date.now() - T0) / 1000).toFixed(0)}s`;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}  [${secs()}]`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = { timeout: 600000, polling: 500 };

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
// CSP の違反を数える（ページの外から。ゲームの中身は変えない）
await ctx.addInitScript(() => {
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const page = await ctx.newPage();
page.setDefaultTimeout(600000);
const errors = [];
const dataUrls = [];
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console ${m.text()}`); });
page.on('request', (r) => { if (r.url().startsWith('data:')) dataUrls.push(r.url().slice(0, 40)); });
const shot = (name) => {
  console.log(`   撮影 ${name}  [${secs()}]`);
  return page.screenshot({ path: `${OUT}/${name}.png`, timeout: 600000 });
};
const sheet = (name) => page.locator(`.g-layer[data-sheet="${name}"]`);
/** 出たばかりのボタンは決まらない（ui/guard.ts）ので、少し待ってから押す */
async function pressIn(scope, sel) {
  const b = page.locator(`${scope} ${sel}`).first();
  await b.waitFor({ state: 'visible' });
  await sleep(500);
  await b.scrollIntoViewIfNeeded();
  await b.click();
}
const records = () => page.evaluate(() => JSON.parse(localStorage.getItem('koto-sengoku/3d-fields') || 'null'));

try {
  await page.goto(URL0);
  await page.locator('[data-practice="entry"] .g-btn[data-id="practice"]').waitFor({ state: 'visible', timeout: 600000 });
  check('本番ビルド：タイトルに「合戦場の演習」の入口', (await page.textContent('[data-practice="entry"]')).includes('合戦場の演習'));
  check('演習の画面の塊は、選ぶ前には読んでいない', !served.some((p) => /practiceView-/.test(p)), served.filter((p) => p.includes('assets')).join(' '));
  await shot('P00-title');
  await pressIn('', '.g-btn[data-id="practice"]');
  await sheet('practice-list').waitFor({ state: 'visible' });
  check('演習の一覧が出る（選んだときに演習の画面の塊を読む）', served.some((p) => /practiceView-.*\.js$/.test(p)), served.filter((p) => /practiceView/.test(p)).join(' '));
  const listed = await page.evaluate(() => [...document.querySelectorAll('.g-pr-field')].map((e) => e.dataset.field));
  check(`一覧に ${FIELD_IDS.length} 戦場（第1群・第2群・第3群）`, JSON.stringify(listed) === JSON.stringify(FIELD_IDS), listed.join(','));
  await shot('P01-list');
  for (const id of FIELD_IDS) {
    console.log(`--- ${id}`);
    await pressIn('.g-layer[data-sheet="practice-list"]', `.g-btn[data-id="field:${id}"]`);
    await sheet('practice-briefing').waitFor({ state: 'visible' });
    check(`${id}：説明の画面`, (await page.getAttribute('.g-pr-brief', 'data-field')) === id);
    await pressIn('.g-layer[data-sheet="practice-briefing"]', '.g-btn[data-id="go"]');
    await page.locator(`.b-root[data-field="${id}"]`).waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, W);
    check(`${id}：合戦の画面（戦場の印・札・目標の欄）`, (await page.locator('.b-card').count()) >= 4 && (await page.locator('.b-goals').count()) === 1);
    await page.locator('.b-primary').click();
    await page.locator('.b-seg', { hasText: '×2' }).click();
    const clock0 = await page.textContent('.b-topleft');
    await sleep(4000);
    const clock1 = await page.textContent('.b-topleft');
    check(`${id}：合戦を始めると時間が進む（日没までの時計が変わる）`, clock0 !== clock1);
    await shot(`P10-${id}-battle`);
    await page.locator('.b-allret').click();
    await page.locator('.b-modal .b-primary').click();
    await page.locator('.b-result').waitFor({ state: 'visible', timeout: 600000 });
    await sleep(500);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.b-robj-row')].map((r) => r.dataset.role));
    check(`${id}：合戦の結果（撤退）に主目標・副目標の行`, (await page.textContent('.b-result h2')) === '撤退' && rows.length >= 2 && rows[0] === 'primary' && rows.slice(1).every((r) => r === 'secondary'), rows.join(','));
    await shot(`P11-${id}-result`);
    await page.locator('.b-primary', { hasText: '続ける' }).click();
    await sheet('practice-result').waitFor({ state: 'visible' });
    const res = await page.evaluate(() => ({
      outcome: document.querySelector('.g-pr-result [data-outcome]')?.dataset.outcome,
      primary: document.querySelector('.g-pr-result [data-objective="primary"]')?.dataset.achieved,
      secondary: document.querySelectorAll('.g-pr-result [data-objective="secondary"]').length,
      saved: document.querySelector('.g-pr-result [data-saved]')?.dataset.saved,
    }));
    const rec = await records();
    check(`${id}：演習の結果（撤退・主目標・副目標・保存が別の行）と記録`, res.outcome === 'retreat' && res.primary === 'false' && res.secondary >= 1 && res.secondary === rows.length - 1 && res.saved === 'true' && rec?.version === 1 && rec.records[id]?.last.result === 'retreat', JSON.stringify(res));
    await pressIn('.g-layer[data-sheet="practice-result"]', '.g-btn[data-id="list"]');
    await sheet('practice-list').waitFor({ state: 'visible' });
  }
  // 開き直す → 一覧に記録が残る
  await page.reload();
  await page.locator('[data-practice="entry"] .g-btn[data-id="practice"]').waitFor({ state: 'visible', timeout: 600000 });
  await pressIn('', '.g-btn[data-id="practice"]');
  await sheet('practice-list').waitFor({ state: 'visible' });
  const recs = await page.evaluate(() => [...document.querySelectorAll('.g-pr-field')].map((e) => `${e.dataset.field}:${e.querySelector('.rec')?.textContent ?? ''}`));
  const rec = await records();
  check(`開き直した後も ${FIELD_IDS.length} 戦場の記録が残る（一覧と保存）`, recs.every((r) => r.includes('撤退')) && Object.keys(rec?.records ?? {}).length === FIELD_IDS.length, recs.join(' / '));
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('koto-sengoku')));
  check('書いたキーは koto-sengoku/3d-fields だけ', JSON.stringify(keys) === JSON.stringify(['koto-sengoku/3d-fields']), keys.join(','));
  await shot('P20-list-after-reload');
  await pressIn('.g-layer[data-sheet="practice-list"]', '.g-btn[data-id="back"]');
  await page.locator('.g-btn[data-id="new:ieyasu1570"]').waitFor({ state: 'visible' });
  check('一覧の「タイトルへ戻る」でタイトルへ', true);
} catch (e) {
  failed++;
  console.log('NG 途中で止まった：', e.message);
  try { await shot('zz-stopped'); } catch {}
}
const csp = await page.evaluate(() => window.__cspViolations).catch(() => ['(読めない)']);
check('CSP の違反が無い', csp.length === 0, csp.slice(0, 5).join(' / '));
check('読めなかったファイルが無い', missing.length === 0, missing.slice(0, 5).join(' '));
check('data: の URL の読み込みが無い', dataUrls.length === 0, dataUrls.slice(0, 3).join(' '));
check('ページの誤り（例外・console.error）が無い', errors.length === 0, errors.slice(0, 5).join(' / '));
await browser.close();
server.close();
console.log(failed ? `失敗 ${failed}` : 'すべて OK');
process.exit(failed ? 1 : 0);
