// 第一章を「本番ビルド」で、公開先に近い決まり（CSP）の下で最後まで遊べるかを確かめる。開発用のフック（__game・__battle・__p3）は使わない。
// 入力はすべて本物のキー・クリック。位置は、ゲームのメニューの「保存する」で書かれた保存データ（localStorage）から読む。
//
// 準備（公開と同じ作り）：
//   VITE_MODEL_EXT=.json npm run proto3d:build
//   rm dist-proto3d/models/*.glb
//   node proto3d/tools/glb-to-gltf.mjs proto3d/public/models dist-proto3d/models ground_v2 gate_v2 walls_v2 keep inner machiya_a machiya_b machiya_d tree_pine tree_sakura tree_pine_far hero_v3_mpfb hero_v2
// 使い方：node e2e/chapter1-prod.mjs [出力先]   （DIST=dist-proto3d PORT=8131 VIEW=960x540 で変えられる）
// この中で、次のヘッダー付きの簡易サーバーを立てる：
//   content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'
// 経路：タイトル → 源蔵と話す → 軍議で独力 → 支度（メニューから保存）→ 城門で出陣 → 合戦（命令・指揮・速さ・全軍撤退）→ 戦後（自動保存）
//       → 開き直して続きから → 源蔵と話して結末 → タイトル。CSP の違反・ページの誤り・読めなかったファイル・data: の URL が無いこと。
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { launchBrowser, outDir } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/chapter1/prod');
const DIST = resolve(process.env.DIST || 'dist-proto3d');
const PORT = Number(process.env.PORT || 8131);
const [VW, VH] = (process.env.VIEW || '960x540').split('x').map(Number);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };

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
const layer = (kind) => page.locator(`.g-layer[data-kind="${kind}"]`);
const waitLayer = (kind) => layer(kind).waitFor({ state: 'visible', timeout: 600000 });
const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('koto-sengoku/3d-chapter1') || 'null'));

/** 会話を、選択肢が出るか閉じるまでクリックで進める */
async function readThrough() {
  for (let i = 0; i < 40; i++) {
    if (!(await layer('script').isVisible())) return;
    if (await page.locator('.g-choices:not([hidden]) .g-choice').first().isVisible().catch(() => false)) return;
    await page.mouse.click(VW / 2, VH * 0.3);
    await sleep(300);
  }
}
async function choose(id) {
  await page.locator(`.g-choice[data-id="${id}"]`).waitFor({ state: 'visible' });
  await sleep(500);
  await page.locator(`.g-choice[data-id="${id}"]`).click();
}
async function pressBtn(id) {
  await page.locator(`.g-btn[data-id="${id}"]`).waitFor({ state: 'visible' });
  await sleep(500);
  await page.locator(`.g-btn[data-id="${id}"]`).click();
}
/** キーを押したまま、cond が真になるまで待つ（ソフトウェア描画ではコマが遅いので、長く押す） */
async function holdUntil(keys, cond, maxMs) {
  for (const k of keys) await page.keyboard.down(k);
  const t = Date.now();
  let ok = false;
  while (Date.now() - t < maxMs) {
    if (await cond()) { ok = true; break; }
    await sleep(400);
  }
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
  return ok;
}
const talkShown = (id) => page.evaluate((id) => { const b = document.querySelector('.g-talk'); return !!b && !b.hidden && b.dataset.target === id; }, id);
/** メニューから保存して、保存された位置を読む（位置を知る手段。遊ぶ人の操作と同じ） */
async function saveAndReadPose() {
  await page.keyboard.press('Escape');
  await waitLayer('menu');
  await pressBtn('save');
  await page.locator('.g-layer[data-kind="menu"] .g-msg').waitFor({ state: 'visible' });
  const msg = await page.locator('.g-layer[data-kind="menu"] .g-msg').textContent();
  await pressBtn('close');
  await layer('menu').waitFor({ state: 'detached' });
  const s = await save();
  return { msg, pose: s?.explore ?? null, save: s };
}

try {
  const t0 = Date.now();
  await page.goto(URL0);
  await page.locator('.g-btn[data-id="new"]').waitFor({ state: 'visible', timeout: 600000 });
  check(`本番ビルドを CSP の下で読み込み、タイトルが出る（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`, true, await page.textContent('#build'));
  check('本番ビルドの表示（開発用の比較ボタンは無い）', (await page.textContent('#build')).includes('本番') && !(await page.isVisible('#hero-btn')));
  const models = served.filter((p) => p.startsWith('/models/'));
  check('素材は JSON（glTF）と画像で読む（.glb も data: の URL も使わない）', models.length > 0 && models.every((p) => /\.(json|jpg|png)$/.test(p)) && dataUrls.length === 0, `${models.filter((p) => p.endsWith('.json')).length} 個の JSON`);
  await shot('P01-title');
  await pressBtn('new');
  await page.locator('.g-hud').waitFor({ state: 'visible' });
  check('はじめから → 城下（目的：源蔵と話す）', (await page.textContent('.g-hud')).includes('源蔵'));
  await sleep(1500);
  await shot('P02-explore');
  // 源蔵は開始の画面の正面（北北西）。W と Shift（走る）で、「話す」が出るまで進む
  let ok = await holdUntil(['Shift', 'KeyW'], () => talkShown('genzo'), 420000);
  check('W と Shift で歩くと源蔵の「話す」が出る', ok);
  await shot('P03-talk');
  await page.keyboard.press('KeyE');
  await waitLayer('script');
  await readThrough();
  await choose('open_council');
  await page.locator('.g-layer.council').waitFor({ state: 'visible' });
  await readThrough();
  await shot('P04-council');
  await choose('ally_alone');
  await sleep(600);
  await readThrough();
  await choose('confirm_alliance');
  await page.locator('.g-layer[data-kind="script"]').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('.g-hud')?.textContent.includes('城門'), null, W);
  check('軍議で独力に決める → 出陣の支度（目的：城門で出陣）', true);
  // 位置を知るために保存（メニューの保存。書いた後に読み戻して確かめる）
  let r = await saveAndReadPose();
  check('メニューから保存できる（読み戻して確かめた）', r.msg.includes('読み戻して確かめました') && r.save?.phase === 'muster' && r.save?.alliance === 'alone', r.msg);
  // 城門へ：保存の位置から、今のカメラの向き（開始の向き 0.36。見回していない）で方向のキーを決める
  const yaw = 0.36;
  const gate = { x: 0, z: -10.9 };
  for (let leg = 0; leg < 6 && !(await layer('script').isVisible()); leg++) {
    const p = r.pose;
    const gx = gate.x - p.x;
    const gz = gate.z - p.z;
    const d = Math.hypot(gx, gz);
    const ix = (Math.cos(yaw) * gx - Math.sin(yaw) * gz) / d;
    const iy = (Math.sin(yaw) * gx + Math.cos(yaw) * gz) / d;
    const keys = [];
    if (iy < -0.38) keys.push('KeyW');
    if (iy > 0.38) keys.push('KeyS');
    if (ix > 0.38) keys.push('KeyD');
    if (ix < -0.38) keys.push('KeyA');
    console.log(`   城門へ ${leg + 1}：(${p.x.toFixed(2)}, ${p.z.toFixed(2)}) から ${d.toFixed(1)} m、キー ${keys.join('+')}`);
    // 近いほど短く押す（1 コマ 0.1 秒ぶんしか進まないので、コマの数で決める）
    ok = await holdUntil(keys, () => layer('script').isVisible(), Math.min(200000, 9000 + d * 25000));
    if (ok) break;
    r = await saveAndReadPose();
  }
  await waitLayer('script');
  await readThrough();
  await shot('P05-gate');
  await choose('depart');
  // 合戦の画面（別の塊を読み込む）
  await page.locator('.b-primary:not(.off)', { hasText: '合戦を始める' }).waitFor({ state: 'visible', timeout: 600000 });
  const dep = await save();
  check('出陣前の自動保存（段階 battle・出陣前）→ 合戦の説明の画面', dep?.point === 'departure' && dep?.phase === 'battle');
  check('合戦の説明：勝ち・負け・撤退の条件', /勝利/.test(await page.textContent('.b-brief-lines')) && /敗北/.test(await page.textContent('.b-brief-lines')));
  await shot('P06-briefing');
  await page.locator('.b-primary', { hasText: '合戦を始める' }).click();
  await sleep(1500);
  await page.locator('.b-pause').click();
  await sleep(800);
  check('指揮（一時停止）の印が出る', await page.locator('.b-pausepill').isVisible());
  await page.locator('.b-card', { hasText: '源蔵隊' }).click();
  await sleep(800);
  await page.locator('.b-cmd', { hasText: '防衛・待機' }).click();
  await sleep(1500);
  check('部隊の札で源蔵隊を選び「防衛・待機」（札の命令の欄）', (await page.locator('.b-card', { hasText: '源蔵隊' }).locator('.b-ord').textContent()).includes('防衛'));
  await page.locator('.b-pause').click();
  await page.locator('.b-seg', { hasText: '×2' }).click();
  await sleep(4000);
  await shot('P07-battle');
  await page.locator('.b-allret').click();
  await page.locator('.b-confirm').waitFor({ state: 'visible' });
  await sleep(500);
  await page.locator('.b-confirm .b-btn', { hasText: '撤退する' }).click();
  await page.locator('.b-result').waitFor({ state: 'visible', timeout: 900000 });
  await sleep(1000);
  await shot('P08-result');
  check('全軍撤退 → 結果の画面「撤退」', (await page.textContent('.b-result h2')).includes('撤退'), await page.textContent('.b-reason'));
  await page.locator('.b-primary', { hasText: '続ける' }).click();
  await page.waitForFunction(() => !document.body.classList.contains('mode-battle') && !document.getElementById('battle-ui') && document.querySelector('.g-hud') && !document.querySelector('.g-hud').hidden, null, W);
  const aft = await save();
  check('合戦の後 → 戦後の探索・戦後の自動保存（撤退・関係はそのまま）', aft?.point === 'aftermath' && aft?.phase === 'aftermath' && aft.battle.result === 'retreat' && aft.relations.tashiro === 10 && aft.relations.omori === 10);
  // 開き直して続きから
  await page.reload();
  await page.locator('.g-btn[data-id="continue"]').waitFor({ state: 'visible', timeout: 600000 });
  check('開き直すと、つづきからに戦後の保存', (await page.textContent('.g-btn[data-id="continue"]')).includes('戦後'));
  await pressBtn('continue');
  await page.locator('.g-hud').waitFor({ state: 'visible' });
  await sleep(1500);
  await shot('P09-aftermath');
  ok = await holdUntil(['Shift', 'KeyW'], () => talkShown('genzo'), 420000);
  check('戦後：開始の位置から源蔵へ歩くと「話す」', ok);
  await page.keyboard.press('KeyE');
  await waitLayer('script');
  await readThrough();
  await choose('end_chapter');
  await waitLayer('ending');
  const ending = await page.textContent('.g-ending');
  await shot('P10-ending');
  check('結末：雌伏（独力で戦った・撤退・第一章 完（仮シナリオ））', ending.includes('雌伏') && ending.includes('独力で戦った') && ending.includes('第一章 完（仮シナリオ）'));
  await page.locator('.g-btn[data-id="title"]').scrollIntoViewIfNeeded();
  await pressBtn('title');
  await page.locator('.g-btn[data-id="continue"]').waitFor({ state: 'visible' });
  check('タイトルへ戻る。つづきからは章の結末', (await page.textContent('.g-btn[data-id="continue"]')).includes('章の結末'));
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
