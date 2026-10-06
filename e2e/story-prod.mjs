// 物語の見せ方（演出・情勢・物見）を「本番ビルド」で、公開先に近い決まり（CSP）の下で通す。
// 依頼：docs/story-rpg-request.md【1】【2】【5】【7】・設計 docs/story-rpg-design.md §1〜§4。これまで本番ビルドでは演出をスキップしただけだった。
// 開発用のフック（__game・__battle・__p3）は使わない（本番のビルドには無い）。早送りもしない（合戦は ×2 の実時間）。
// 入力はすべて本物のキー・クリック・引きずり。位置は、ゲームのメニューの「保存する」で書かれた保存データ（localStorage）から読む。
//
// 準備（公開と同じ作り。/home/user/ks-prod のような別の作業場所で）：
//   rm -rf dist-proto3d && VITE_MODEL_EXT=.json npm run proto3d:build && rm -f dist-proto3d/models/*.glb && \
//   node proto3d/tools/glb-to-gltf.mjs proto3d/public/models dist-proto3d/models ground_v2 gate_v2 walls_v2 keep inner machiya_a machiya_b machiya_d tree_pine tree_sakura tree_pine_far hero_v3_mpfb hero_v2
// 使い方：DIST=<本番ビルドの dist-proto3d> node e2e/story-prod.mjs [出力先]   （PORT=8133 VIEW=844x390 で変えられる）
// この中で、次のヘッダー付きの簡易サーバーを立てる（e2e/ieyasu-prod.mjs と同じ作り）：
//   content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'
// 経路：タイトル（歴史分岐のはじめから）→ 第一章の冒頭（3D の場面だけ）をスキップせずに最後まで → J で情勢を開いて閉じる
//       → 本多忠勝と話す → 軍議で C（自領の防衛）→ 支度で忠勝の約束を引き受ける → 物見櫓まで歩いて物見を 1 回（印に向いて「調べる」→「終える」）
//       → J で情勢（物見の記録が載る）→ 城門まで歩いて「出陣する」→ 出陣の演出を最後まで → 合戦（×2・すぐに全軍撤退）→ 結果の「続ける」
//       → 帰還の演出を最後まで → 戦後の城下。CSP の違反・ページの誤り・読めなかったファイル・data: の URL が無いこと。
// 演出の見え方（字幕・場面の種類・覆い）は、ページの中で毎コマ（requestAnimationFrame）DOM を読んで記録する（読むだけ。ゲームの中身は変えない）。
//
// 確認の種類（出力の行にも書く）：
//   - 本物の入力：上の経路のクリック・キー（W・A・S・D・Shift・E・J・Esc・Enter）・物見の見回し（マウスの引きずり）。
//   - 早送り：無し。描画の省略：無し（本番ビルド・描画あり・画質「低」）。
//   - 直接状態変更：無し（保存はメニューの「保存する」で書いた物を読むだけ）。
//   - 実機・性能：ここでは未確認（ソフトウェア描画の headless Chromium。3D の場面の時計は実時間より遅い）。
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { launchBrowser, outDir } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/story-prod');
const DIST = resolve(process.env.DIST || 'dist-proto3d');
const PORT = Number(process.env.PORT || 8133);
const [VW, VH] = (process.env.VIEW || '844x390').split('x').map(Number);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };
/** 開始の見回し（proto3d/blender/scene.json の hero_start。e2e の決まり。探索では引きずらないので変わらない） */
const YAW = 0.36;
/** 物見櫓（town/spots.ts の LOOKOUT (−6.9, 11.9)）へ、開始の位置から歩く道の点（町の当たり判定と支度の段階の配役から格子で求めた道。道の西の荷置き場の北を通る） */
const TO_LOOKOUT = [[-0.5, 2.0], [-3.0, 10.5], [-3.6, 11.25], [-6.9, 11.25]];
/** 物見櫓の下から城門（(0, −10.9)）へ歩く道の点 */
const TO_GATE = [[-3.6, 11.25], [-3.25, 8.75], [0, -10.0]];

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
let oks = 0;
const T0 = Date.now();
const secs = () => `${((Date.now() - T0) / 1000).toFixed(0)}s`;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  else oks++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}  [${secs()}]`);
};
const note = (t) => console.log(`   ${t}  [${secs()}]`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => JSON.stringify(v);
const W = { timeout: 1200000, polling: 500 };

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
// CSP の違反を数える（ページの外から。ゲームの中身は変えない）
await ctx.addInitScript(() => {
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const page = await ctx.newPage();
page.setDefaultTimeout(1200000);
const errors = [];
const dataUrls = [];
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console ${m.text()}`); });
page.on('request', (r) => { if (r.url().startsWith('data:')) dataUrls.push(r.url().slice(0, 40)); });
const shot = (name) => {
  note(`撮影 ${name}`);
  return page.screenshot({ path: `${OUT}/${name}.png`, timeout: 600000 });
};
const layer = (kind) => page.locator(`.g-layer[data-kind="${kind}"]`);
const waitLayer = (kind) => layer(kind).waitFor({ state: 'visible', timeout: 1200000 });
const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('koto-sengoku/3d-ieyasu1570') || 'null'));
const hudShown = () => page.evaluate(() => { const h = document.querySelector('.g-hud'); return !!h && !h.hidden && !document.querySelector('.g-layer[data-kind="cine"]'); });

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
/** キーを押したまま、cond が真になるか ms が過ぎるまで待つ */
async function holdUntil(keys, cond, maxMs) {
  for (const k of keys) await page.keyboard.down(k);
  const t = Date.now();
  let ok = false;
  while (Date.now() - t < maxMs) {
    if (cond && (await cond())) { ok = true; break; }
    await sleep(300);
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
  await sleep(300);
  const s = await save();
  return { msg, pose: s?.explore ?? null, save: s };
}
/** 見回し yaw の画面の上で、(x, z) から (tx, tz) へ向かうキー */
function keysToward(p, tx, tz) {
  const gx = tx - p.x;
  const gz = tz - p.z;
  const d = Math.hypot(gx, gz) || 1;
  const ix = (Math.cos(YAW) * gx - Math.sin(YAW) * gz) / d;
  const iy = (Math.sin(YAW) * gx + Math.cos(YAW) * gz) / d;
  const keys = [];
  if (iy < -0.38) keys.push('KeyW');
  if (iy > 0.38) keys.push('KeyS');
  if (ix > 0.38) keys.push('KeyD');
  if (ix < -0.38) keys.push('KeyA');
  return keys;
}
/**
 * 道の点を順に、本物のキーで歩く（位置はメニューの保存で読む）。押す時間は、それまでに測った速さから決める（行き過ぎないよう 0.8 倍）。
 * cond が真になったら止める（「物見」の札・城門の確認など）
 */
let speed = 0.25;
async function walkPath(points, cond, tol = 0.6) {
  let r = await saveAndReadPose();
  for (const [tx, tz] of points) {
    const last = tx === points[points.length - 1][0] && tz === points[points.length - 1][1];
    for (let leg = 0; leg < 14; leg++) {
      if (cond && (await cond())) return { done: true, pose: r.pose };
      const p = r.pose;
      const d = Math.hypot(tx - p.x, tz - p.z);
      if (d < (last ? tol : 0.7)) break;
      const keys = [...keysToward(p, tx, tz), ...(d > 3 ? ['ShiftLeft'] : [])];
      const ms = Math.max(1500, Math.min(45000, ((d * 0.8) / speed) * 1000));
      const t = Date.now();
      const hit = await holdUntil(keys, cond, ms);
      const held = (Date.now() - t) / 1000;
      if (hit) return { done: true, pose: p };
      r = await saveAndReadPose();
      const moved = Math.hypot(r.pose.x - p.x, r.pose.z - p.z);
      if (moved > 0.05 && held > 1) speed = Math.max(0.05, moved / held);
      note(`歩く：(${p.x.toFixed(2)}, ${p.z.toFixed(2)}) → (${r.pose.x.toFixed(2)}, ${r.pose.z.toFixed(2)})（目当て (${tx}, ${tz})・キー ${keys.join('+')}・${held.toFixed(1)} 秒・速さ ${speed.toFixed(2)} m/秒）`);
    }
  }
  return { done: cond ? await cond() : true, pose: r.pose };
}

// ================================================================ 演出の見え方の記録（ページの中で毎コマ DOM を読む。読むだけ）
const LOGGER = () => {
  window.__plog = [];
  window.__plogOn = true;
  let last = '';
  const vis = (e) => !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0;
  const loop = () => {
    if (!window.__plogOn) return;
    try {
      const L = document.querySelector('.g-layer[data-kind="cine"]');
      const ld = document.querySelector('.g-layer.g-loading[data-kind="loading"]');
      const row = {
        cine: L?.dataset.cine ?? null, mode: L?.dataset.mode ?? null, wait: L?.dataset.wait === '1', beat: L?.dataset.beat ?? null,
        cap: L?.querySelector('.g-cine-cap .txt')?.textContent ?? null, who: L?.querySelector('.g-cine-cap .who:not([hidden])')?.textContent ?? null,
        head: L?.querySelector('.g-cine-heading')?.textContent ?? null,
        load: ld ? `${ld.classList.contains('opaque') ? 'opaque' : 'clear'}:${ld.textContent}` : null,
        help: vis(document.getElementById('help')), runBtn: vis(document.getElementById('run-btn')), hud: vis(document.querySelector('.g-hud')),
        battle: document.body.classList.contains('mode-battle'), toast: document.querySelector('.g-toast')?.textContent ?? null,
      };
      const key = JSON.stringify(row);
      if (key !== last) {
        last = key;
        window.__plog.push({ w: performance.now(), ...row });
      }
    } catch (e) {
      window.__plogErr = String(e);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};
const startLog = () => page.evaluate(LOGGER);
const stopLog = () => page.evaluate(() => { window.__plogOn = false; return { log: window.__plog, err: window.__plogErr ?? null }; });
/** 記録から：演出の id・場面の種類・字幕（変わった順）・3D の場面の始めの待ちのコマ・実時間 */
function cineSummary(log, id) {
  const rows = log.filter((r) => r.cine === id);
  const caps = [];
  for (const r of rows) if (r.cap && caps.at(-1) !== r.cap) caps.push(r.cap);
  const modes = [...new Set(rows.map((r) => r.mode).filter(Boolean))];
  const wall = rows.length ? (rows.at(-1).w - rows[0].w) / 1000 : 0;
  return { rows: rows.length, caps, modes, waits: rows.filter((r) => r.wait).length, wall, beats: [...new Set(rows.map((r) => r.beat))].length };
}
/** 演出が出て、スキップを押さずに閉じるまで待つ（層が閉じた＝最後まで流れた。スキップのボタンには触れない） */
async function playThrough(what) {
  await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'attached', timeout: 1200000 });
  const id = await page.locator('.g-layer[data-kind="cine"]').getAttribute('data-cine');
  const t = Date.now();
  note(`演出「${id}」（${what}）が始まった。スキップを押さずに最後まで流す`);
  await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached', timeout: 1200000 });
  const wall = (Date.now() - t) / 1000;
  note(`演出「${id}」が閉じた（実時間 ${wall.toFixed(0)} 秒）`);
  return { id, wall };
}

const result = {};
try {
  // ================================================================ タイトル → 第一章の冒頭を最後まで（情勢の図解は自動で流れない）
  const t0 = Date.now();
  await page.goto(URL0);
  await page.locator('.g-btn[data-id="new:ieyasu1570"]').waitFor({ state: 'visible', timeout: 1200000 });
  check(`本番ビルドを CSP の下で読み込み、タイトルが出る（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`, true, await page.textContent('#build'));
  check('本番ビルドの表示（開発用のフックは無い）', (await page.textContent('#build')).includes('本番') && (await page.evaluate(() => !window.__game && !window.__battle && !window.__p3)));
  const models = served.filter((p) => p.startsWith('/models/'));
  check('素材は JSON（glTF）と画像で読む（.glb も data: の URL も使わない）', models.length > 0 && models.every((p) => /\.(json|jpg|png)$/.test(p)) && dataUrls.length === 0, `${models.filter((p) => p.endsWith('.json')).length} 個の JSON`);
  // 人物の素材を読み終えるまで少し待つ（読み込みの途中で演出の 3D を描かせない。遊ぶ人もタイトルを見ている間）
  await sleep(4000);
  await startLog();
  const tNew = Date.now();
  await pressBtn('new:ieyasu1570');
  const intro = await playThrough('第一章の冒頭');
  await page.waitForFunction(() => { const h = document.querySelector('.g-hud'); return !!h && !h.hidden; }, null, W);
  const toControl = (Date.now() - tNew) / 1000;
  let lg = await stopLog();
  const si = cineSummary(lg.log, intro.id);
  note(`冒頭の字幕（順）：${si.caps.map((c) => `「${c}」`).join(' → ')}`);
  note(`「はじめから」のクリックから操作の開始（HUD）まで：${toControl.toFixed(1)} 秒（本番ビルド・描画あり・ソフトウェア描画。3D の場面の始めの待ちのコマ ${si.waits}）`);
  check(`第一章の冒頭（${intro.id}）をスキップせずに最後まで：3D の場面だけ（data-mode stage。地図の図解ではない）・字幕 ${si.caps.length} 件・3D の場面の始めの待ちのコマ ${si.waits}・実時間 ${si.wall.toFixed(0)} 秒`,
    intro.id === 'ch1_open' && J(si.modes) === '["stage"]' && si.caps.length >= 6 && si.caps[0] === '元亀元年（1570年）。三河、徳川家康の城下。' && si.caps.some((c) => c.includes('城門の前')) && si.wall >= 15,
    J({ modes: si.modes, beats: si.beats, first: si.caps[0], err: lg.err }));
  result.intro = { ...intro, ...si, toControl };
  check('冒頭の後：城下の目的の札（城門の前の本多忠勝と話し、軍議を開く）・歩く／走るの操作が出る', /城門の前の本多忠勝と話し、軍議を開く/.test(await page.textContent('.g-hud')), await page.textContent('.g-hud'));
  await sleep(1500);
  await shot('P01-after-intro');

  // ================================================================ J で情勢を開いて閉じる
  async function openSituation() {
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('KeyJ');
      const ok = await layer('situation').waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
      if (ok) return i;
      await sleep(1500);
    }
    throw new Error('J で情勢が開かない');
  }
  let tries = await openSituation();
  await sleep(1200);
  const sit1 = await page.textContent('.g-layer[data-kind="situation"]');
  check(`本物のキー J で情勢を開く（押し直し ${tries} 回）：地図（模式図の注記）・方針の選択肢の前の目的`, sit1.includes('模式図') && /忠勝|軍議/.test(sit1), sit1.slice(0, 120));
  await shot('P02-situation');
  await page.locator('.g-layer[data-kind="situation"] .g-btn[data-id="close"]').click();
  await layer('situation').waitFor({ state: 'detached' });
  check('情勢の「閉じる」（クリック）で城下へ戻る（目的の札が出る）', await page.locator('.g-hud').isVisible());

  // ================================================================ 忠勝と話す → 軍議で C → 約束を引き受ける
  let ok = await holdUntil(['ShiftLeft', 'KeyW'], () => talkShown('tadakatsu'), 420000);
  check('W と Shift で歩くと本多忠勝の「話す」が出る', ok);
  await page.keyboard.press('KeyE');
  await waitLayer('script');
  await readThrough();
  await choose('open_council');
  await page.locator('.g-layer.council').waitFor({ state: 'visible' });
  await readThrough();
  await choose('policy_home');
  await sleep(600);
  await readThrough();
  await choose('confirm_policy');
  await page.locator('.g-layer[data-kind="script"]').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('.g-hud')?.textContent.includes('約束'), null, W);
  if (!(await talkShown('tadakatsu'))) ok = await holdUntil(['KeyW'], () => talkShown('tadakatsu'), 200000);
  await page.keyboard.press('KeyE');
  await waitLayer('script');
  await readThrough();
  await choose('pledge_accept');
  await page.locator('.g-layer[data-kind="script"]').waitFor({ state: 'detached' });
  let r = await saveAndReadPose();
  check('軍議で C（自領の防衛）→ 支度で忠勝の約束を引き受ける（メニューから保存して読み戻す）', r.save?.phase === 'muster' && r.save.policy === 'home' && r.save.pledge?.accepted === true && !r.save.scout, J({ phase: r.save?.phase, policy: r.save?.policy, scout: r.save?.scout ?? null }));

  // ================================================================ 物見（櫓の下まで歩く → 「物見」→ 印へ向いて「調べる」→「終える」）
  let w = await walkPath(TO_LOOKOUT, () => talkShown('lookout'));
  check('本物のキーで物見櫓の下まで歩くと「物見」の札が出る', w.done && (await page.locator('.g-talk').textContent()).includes('物見'), J(w.pose));
  await sleep(600);
  await page.keyboard.press('KeyE');
  const bar = page.locator('.g-lookout-bar[data-kind="lookout"]');
  await bar.waitFor({ state: 'visible', timeout: 600000 });
  // カメラが櫓の上へ上がり終えるまで（1.4 秒）待つ
  await sleep(3500);
  const h0 = Number(await bar.getAttribute('data-heading'));
  // 始めの向きは、最初の印から 40° 右（ゲームの決まり）。左へ 40° 分だけ引きずる（1px 0.0055 rad）
  const dx = -Math.round(((40 * Math.PI) / 180) / 0.0055);
  await page.mouse.move(VW / 2, VH * 0.45);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(VW / 2 + (dx * i) / 8, VH * 0.45);
  await page.mouse.up();
  await sleep(2500);
  let can = await bar.getAttribute('data-can');
  const h1 = Number(await bar.getAttribute('data-heading'));
  check(`本物の引きずり ${dx}px で印へ向く（向き ${h0} → ${h1}）・「調べる」が押せる（印 ${can}）`, !!can && (await page.locator('.g-lookout-btn.examine').isEnabled()), '');
  await shot('P03-lookout');
  await page.locator('.g-lookout-btn.examine').click();
  await sleep(1500);
  const examined = await bar.getAttribute('data-examined');
  check('本物のクリック「調べる」で印を記録する', !!examined && examined.split(',').includes(can), examined);
  await page.locator('.g-lookout-btn.done').click();
  await bar.waitFor({ state: 'detached', timeout: 600000 });
  await page.waitForFunction(() => { const h = document.querySelector('.g-hud'); return !!h && !h.hidden && !document.body.classList.contains('g-lookout'); }, null, W);
  r = await saveAndReadPose();
  check('「終える」（クリック）で城下へ戻る・保存に物見の記録が入る（メニューから保存して読み戻す）', !!r.save?.scout && J(r.save.scout).includes(can), J(r.save?.scout ?? null).slice(0, 160));
  result.scout = { can, examined, scout: r.save?.scout ?? null };
  // 物見の記録が情勢に載る
  tries = await openSituation();
  await sleep(1200);
  const sit2 = await page.textContent('.g-layer[data-kind="situation"]');
  check('J で情勢：物見で確かめた場所（◇）が載る', sit2.includes('◇'), sit2.slice(0, 160));
  await shot('P04-situation-scouted');
  await page.keyboard.press('Escape');
  await layer('situation').waitFor({ state: 'detached' });

  // ================================================================ 城門まで歩いて出陣 → 出陣の演出を最後まで
  w = await walkPath(TO_GATE, () => layer('script').isVisible());
  check('本物のキーで城門まで歩くと出陣の確認が出る', w.done, J(w.pose));
  await readThrough();
  await startLog();
  await choose('depart');
  const dep = await playThrough('出陣');
  await page.locator('.b-primary:not(.off)', { hasText: '合戦を始める' }).waitFor({ state: 'visible', timeout: 1200000 });
  lg = await stopLog();
  const sd = cineSummary(lg.log, dep.id);
  note(`出陣の字幕（順）：${sd.caps.map((c) => `「${c}」`).join(' → ')}`);
  check(`出陣の演出（${dep.id}）をスキップせずに最後まで：3D の場面（隊列）と地図・3D の場面の始めの待ちのコマ ${sd.waits}`, /^departure/.test(dep.id) && sd.modes.includes('stage') && sd.modes.includes('map') && sd.caps.includes('城門から、徳川の兵が出陣する。'), J({ modes: sd.modes, caps: sd.caps }));
  // 演出が閉じてから合戦の画面が出るまで
  const kEnd = lg.log.findLastIndex((x) => x.cine === dep.id);
  const kBat = lg.log.findIndex((x, k) => k > kEnd && x.battle);
  const gap = kEnd >= 0 && kBat > kEnd ? lg.log.slice(kEnd + 1, kBat) : [];
  const bad = gap.filter((x) => !(x.load && x.load.startsWith('opaque')) || x.help || x.runBtn);
  check('出陣の演出が閉じてから合戦の画面まで：不透明な「（戦場）へ…」で覆い、操作の案内・歩く／走るのボタンを出さない（保存の知らせは出てよい）',
    gap.length > 0 && bad.length === 0, `記録 ${gap.length} 件・${gap.length ? ((lg.log[kBat].w - lg.log[kEnd + 1].w) / 1000).toFixed(2) : 0} 秒・層 ${J([...new Set(gap.map((x) => x.load))])}・知らせ ${J([...new Set(gap.map((x) => x.toast).filter(Boolean))])}${bad.length ? `・覆っていない ${J(bad.slice(0, 2))}` : ''}`);
  const dsave = await save();
  check('出陣前の自動保存（段階 battle）', dsave?.point === 'departure' && dsave.phase === 'battle', J({ point: dsave?.point, phase: dsave?.phase }));
  result.departure = { ...dep, ...sd, gap: gap.length };

  // ================================================================ 合戦（×2・すぐに全軍撤退）→ 結果の「続ける」→ 帰還の演出を最後まで
  await sleep(800);
  await page.locator('.b-primary', { hasText: '合戦を始める' }).click();
  await sleep(1500);
  await page.locator('.b-seg', { hasText: '×2' }).click();
  await sleep(1500);
  await page.locator('.b-allret').click();
  await page.locator('.b-confirm').waitFor({ state: 'visible' });
  await sleep(500);
  await page.locator('.b-confirm .b-btn', { hasText: '撤退する' }).click();
  await page.locator('.b-result').waitFor({ state: 'visible', timeout: 1800000 });
  await sleep(1000);
  const res = await page.evaluate(() => {
    const box = document.querySelector('.b-result');
    const t = box?.textContent ?? '';
    const m = t.match(/味方の失った兵 ([\d,]+) \/ ([\d,]+)/);
    const pl = box?.querySelector('.b-rpledge');
    return { head: box?.querySelector('h2')?.textContent ?? '', lost: m ? Number(m[1].replace(/,/g, '')) : null, pledgeTitle: pl?.querySelector('b')?.textContent ?? null, pledgeText: pl?.querySelector('span')?.textContent ?? null };
  });
  note(`結果の画面：${res.head}・味方の失った兵 ${res.lost}・約束「${res.pledgeTitle}」${res.pledgeText}`);
  await shot('P05-result');
  await startLog();
  await page.locator('.b-primary', { hasText: '続ける' }).click();
  const ret = await playThrough('帰還');
  await page.waitForFunction(() => !document.body.classList.contains('mode-battle') && !document.getElementById('battle-ui') && document.querySelector('.g-hud') && !document.querySelector('.g-hud').hidden, null, W);
  lg = await stopLog();
  const sr = cineSummary(lg.log, ret.id);
  note(`帰還の字幕（順）：${sr.caps.map((c) => `「${c}」`).join(' → ')}`);
  check(`帰還の演出（${ret.id}）をスキップせずに最後まで：地図と 3D の場面（隊列）`, /^return/.test(ret.id) && sr.modes.includes('stage') && sr.modes.includes('map'), J({ modes: sr.modes }));
  const unf = /敵と斬り合う前に(退いた|敗れた)/.exec(res.pledgeText ?? '');
  const wantPl = !res.pledgeTitle || res.pledgeTitle.includes('引き受けていない') ? null : unf ? `${res.pledgeTitle.split('：')[0]}：敵と斬り合う前に${unf[1]}。` : `${res.pledgeTitle}。`;
  const pl = sr.caps.filter((c) => c.startsWith('約束を'));
  check(`帰還の約束の行は結果の画面と同じ言葉で 1 行（「${wantPl}」）`, wantPl === null ? pl.length === 0 : pl.length === 1 && pl[0] === wantPl, J(pl));
  check(`帰還の損失の文：結果の画面の「味方の失った兵 ${res.lost}」${(res.lost ?? 0) > 0 ? 'があるので「兵を失わずに戻った。」は出ない' : 'が 0 なので「兵を失わずに戻った。」'}`,
    res.lost !== null && ((res.lost ?? 0) > 0 ? !sr.caps.includes('兵を失わずに戻った。') : sr.caps.includes('兵を失わずに戻った。')), J(sr.caps.filter((c) => /失/.test(c))));
  const aft = await save();
  check('帰還の後：戦後の城下（戦後の自動保存・撤退・約束は守れなかった）', aft?.phase === 'aftermath' && aft.battle?.result === 'retreat' && aft.pledge?.result === 'broken', J({ phase: aft?.phase, r: aft?.battle?.result, pl: aft?.pledge?.result }));
  result.return = { ...ret, ...sr, result: res };
  await sleep(2000);
  await shot('P06-aftermath');
} catch (e) {
  failed++;
  console.log('NG 途中で止まった：', e.stack || e.message);
  try { await shot('zz-stopped'); } catch {}
}
const csp = await page.evaluate(() => window.__cspViolations).catch(() => ['(読めない)']);
check('CSP の違反が無い', csp.length === 0, csp.slice(0, 5).join(' / '));
check('読めなかったファイルが無い', missing.length === 0, missing.slice(0, 5).join(' '));
check('data: の URL の読み込みが無い', dataUrls.length === 0, dataUrls.slice(0, 3).join(' '));
check('ページの誤り（例外・console.error）が無い', errors.length === 0, errors.slice(0, 5).join(' / '));
writeFileSync(`${OUT}/summary.json`, J({ result, csp, missing, errors }, null, 1));
await browser.close();
server.close();
console.log(`\n結果：OK ${oks}・NG ${failed}（${secs()}）。画：${OUT}`);
process.exit(failed ? 1 : 0);
