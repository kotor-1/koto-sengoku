// 物語の見せ方と城下町の「つなぎ」の確かめ（開発サーバー）：A（演出の再生器・情勢の画面・流れ）・B（物語のデータ）・C（町の 3D・物見）を
// 1 本の遊びの流れで通す。依頼：docs/story-rpg-request.md・設計 docs/story-rpg-design.md。
//
// 確認の種類（出力の行にも書く）：
//   - 本物の入力：タイトルの「はじめから」「つづきから」・演出のボタン（一時停止／再開・次の場面・スキップ）とキー（Esc）・
//     HUD の「情勢」・J・情勢の「閉じる」「見直す」・城下を歩く（キーの W・A・S・D。カメラの向きに合わせて押す）・「物見」（E）・
//     見回し（マウスの引きずり）・「調べる」「終える」（クリック）・話す（E）・行送り（Enter）・選択肢（クリック）・軍議の「地図で見る」とタブ・
//     城門（歩いて入る）・合戦の「合戦を始める」・指揮（Space）・全軍撤退と確認・結果の「続ける」・結末の「第二章へ進む」・結果確認の「城下へ」（タップ）。
//     ch1 は PC 1280×720（キーとマウス）、ch2 はスマホ横 844×390（タッチ）。
//   - 早送り：合戦の待つ間だけ（全軍撤退を出した後、指揮（一時停止）のまま window.__battle.fastForward(1) で 1 秒ずつ結果まで）。
//   - 描画の省略：?q=low&render=manual（探索の 3D を描かない。歩き・演出・物見の時計は実時間で進む＝通常速度）。3D の見た目はここでは見ない
//     （e2e/town-smoke.mjs の intro3d・depart3d・replay3d が描画ありで見る）。画面写しのときだけ 1 コマ描く。
//   - 直接状態変更：localStorage の見張りの保存（2D・架空・演習）を入れる・ch2 は第一章の結末の保存（tests/fixtures/ieyasu-ch1-v3/）を入れる。
//     歩く道は町の当たり判定から格子で探す（ページの中で layout.ts を読む。読むだけ）。保存の書き込みの数え上げ（setItem を包む）は観察だけ。
//   - 実機・性能：ここでは未確認（このコンテナはソフトウェア描画）。
//
// PARTS（カンマ区切り。既定はすべて）：ch1, ch2
//   ch1  はじめから → 第一章の導入（一時停止・次の場面・スキップ）→ 城下（HUD の「情勢」・J）→ 物見櫓へ歩いて物見（調べる・終える）→
//        情勢の地図に記録 → 忠勝と軍議（地図で見る・タブで強調・決めない → 方針を決める）→ 支度（約束）→ 城門 → 出陣の演出（通常速度で最後まで）→
//        合戦（全軍撤退）→ 帰還の演出（Esc でスキップ）→ 戦後 → 情勢から演出を見直す
//   ch2  第一章の結末の保存 2 つ（勝ち・約束を守った／敗北・約束を破った・損害大）から「第二章へ進む」→ 移行の演出 → 結果確認 → 城下。
//        勝ちの保存は移行の演出を触らずに最後まで（通常速度）、損害大の保存は一時停止 →「次の場面」で送る →「スキップ」。
//        演出の 3D の出来事と町の人々が第一章の結果で違うこと・兵は保存のまま
// 使い方：自動再読み込みなしの開発サーバーを自分用のポートで起動して
//   (PORT=5391 setsid nohup npx vite --config proto3d/blender/tools/vite.nohmr.mjs > /tmp/vite-5391.log 2>&1 &)
//   BASE=http://localhost:5391 node e2e/story-integrate-smoke.mjs [出力先]
import { readFileSync } from 'node:fs';
import { launchBrowser, outDir } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/story-integrate');
const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:5391';
const PARTS = (process.env.PARTS || 'ch1,ch2').split(',').map((s) => s.trim()).filter(Boolean);
const browser = await launchBrowser();
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
const errors = [];
const POLL = { timeout: 300000, polling: 100 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => JSON.stringify(v);
const KEY = 'koto-sengoku/3d-ieyasu1570';
const KEY_CH1 = 'koto-sengoku/3d-ieyasu1570/chapter1';
const PREFS = 'koto-sengoku/3d-prefs';
const SENT = { 'koto-sengoku/save': '{"2d":"keep"}', 'koto-sengoku/3d-chapter1': '{"sentinel":"fictional"}', 'koto-sengoku/3d-fields': '{"sentinel":"practice"}' };
const fixture = (n) => readFileSync(new URL(`../tests/fixtures/ieyasu-ch1-v3/${n}.json`, import.meta.url), 'utf8');

// ================================================================ ページ
async function open(opts = {}, main = null) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  let reloading = false;
  const onErr = (text) => {
    if (reloading && /Couldn't load texture blob:/.test(text)) return;
    errors.push(text);
    console.log(`   ！ページの誤り [${secs()}] ${text.slice(0, 200)}`);
  };
  page.on('pageerror', (e) => onErr(e.message));
  page.on('console', (m) => { if (m.type() === 'error') onErr(m.text()); });
  await page.goto(BASE + '/?q=low&render=manual');
  await page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
  // 見張りの保存（2D・架空・演習）を入れ、歴史分岐の保存は main（null なら消す）（直接状態変更）
  await page.evaluate(([s, k, k1, p, v]) => {
    localStorage.clear();
    for (const [kk, vv] of Object.entries(s)) localStorage.setItem(kk, vv);
    localStorage.removeItem(k1);
    localStorage.removeItem(p);
    if (v !== null) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  }, [SENT, KEY, KEY_CH1, PREFS, main]);
  reloading = true;
  try { await page.reload(); } finally { reloading = false; }
  await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, POLL);
  await countWrites(page);
  return { ctx, page };
}
/** 保存の書き込みを数える（setItem を包む。観察だけ） */
const countWrites = (page) => page.evaluate(() => {
  window.__writes = {};
  if (window.__writesWrapped) return;
  window.__writesWrapped = true;
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    window.__writes[k] = (window.__writes[k] ?? 0) + 1;
    return orig.call(this, k, v);
  };
});
const writes = (page) => page.evaluate(() => ({ ...window.__writes }));
const ui = (page) => page.evaluate(() => window.__game.ui);
const cine = (page) => page.evaluate(() => window.__game.cine);
const st = (page) => page.evaluate(() => (window.__game.state ? JSON.parse(JSON.stringify(window.__game.state)) : null));
const screen = (page) => page.evaluate(() => window.__game.screen);
const saved = (page, k = KEY) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), k);
const waitUi = (page, kind) => page.waitForFunction((k) => window.__game.ui?.kind === k, kind, POLL);
const waitScreen = (page, s) => page.waitForFunction((k) => window.__game.screen === k && (k !== 'explore' || !window.__game.ui), s, POLL);
const norm = (s) => { if (!s) return s; const c = { ...s }; delete c.playTimeSec; delete c.savedAt; return c; };
const sentinelsKept = (page) => page.evaluate((s) => Object.entries(s).every(([k, v]) => localStorage.getItem(k) === v), SENT);
const pose = (page) => page.evaluate(() => ({ x: window.__p3.hero.x, z: window.__p3.hero.z, heading: window.__p3.hero.heading, yaw: window.__p3.orbit.yaw, prompt: window.__game.prompt, ui: window.__game.ui?.kind ?? null, screen: window.__game.screen }));
const toastText = (page) => page.evaluate(() => { const t = document.querySelector('.g-toast'); return t && getComputedStyle(t).display !== 'none' && !t.hidden ? t.textContent : ''; });
async function shot(page, file) {
  await page.evaluate(() => { if (!document.body.classList.contains('mode-battle')) window.__p3.renderNow(); });
  await page.screenshot({ path: `${OUT}/${file}.png`, timeout: 300000 });
  note(`撮影 ${file}`);
}
/** 演出の層のボタンを押す（本物の入力：クリック／タップ） */
async function cineBtn(page, id, tap = false) {
  const sel = `.g-layer[data-kind="cine"] .g-cine-btn[data-id="${id}"]`;
  if (tap) await page.locator(sel).tap();
  else await page.locator(sel).click();
  await sleep(150);
}

// ================================================================ 歩く（本物のキー）
function toScreen(s, tx, tz) {
  const gx = tx - s.x;
  const gz = tz - s.z;
  const d = Math.hypot(gx, gz) || 1;
  return { ix: (Math.cos(s.yaw) * gx - Math.sin(s.yaw) * gz) / d, iy: (Math.sin(s.yaw) * gx + Math.cos(s.yaw) * gz) / d, d };
}
async function walkKeys(page, tx, tz, done, maxSteps = 500) {
  const held = new Set();
  const setKeys = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  let s;
  for (let i = 0; i < maxSteps; i++) {
    s = await pose(page);
    if (done(s)) break;
    const { ix, iy } = toScreen(s, tx, tz);
    const want = new Set();
    if (iy < -0.38) want.add('KeyW');
    if (iy > 0.38) want.add('KeyS');
    if (ix > 0.38) want.add('KeyD');
    if (ix < -0.38) want.add('KeyA');
    await setKeys(want);
    await sleep(80);
  }
  await setKeys(new Set());
  return s;
}
/** 町の当たり判定（layout.ts の colliders と置いている人物の当たり判定）から道を格子で探す（ページの中で計算。読むだけ。e2e/town-smoke.mjs と同じ） */
const planPath = (page, tx, tz) => page.evaluate(async ([tx, tz]) => {
  const L = await import('/src/layout.ts');
  const M = await import('/src/game/motion.ts');
  const C = await import('/src/explore/cast.ts');
  const rects = [...L.colliders(), ...C.castColliders(window.__game.world.cast ?? [])];
  const R = M.HERO_RADIUS + 0.12;
  const free = (x, z) => rects.every((q) => Math.hypot(x - Math.max(q.x0, Math.min(q.x1, x)), z - Math.max(q.z0, Math.min(q.z1, z))) >= R) && x > L.BOUNDS.x0 + 0.4 && x < L.BOUNDS.x1 - 0.4 && z > L.BOUNDS.z0 + 0.4 && z < L.BOUNDS.z1 - 0.4;
  const step = 0.25;
  const B = L.BOUNDS;
  const nx = Math.round((B.x1 - B.x0) / step) + 1;
  const nz = Math.round((B.z1 - B.z0) / step) + 1;
  const ci = (x) => Math.round((x - B.x0) / step);
  const ck = (z) => Math.round((z - B.z0) / step);
  const h = window.__p3.hero;
  const start = ck(h.z) * nx + ci(h.x);
  const goal = ck(tz) * nx + ci(tx);
  const prev = new Int32Array(nx * nz).fill(-1);
  const ok = new Int8Array(nx * nz).fill(-1);
  const isOk = (n) => {
    if (ok[n] === -1) ok[n] = free(B.x0 + (n % nx) * step, B.z0 + Math.floor(n / nx) * step) ? 1 : 0;
    return ok[n] === 1;
  };
  const q = [start];
  prev[start] = start;
  let head = 0;
  while (head < q.length) {
    const c = q[head++];
    if (c === goal) break;
    const i = c % nx;
    const k = Math.floor(c / nx);
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ii = i + di;
      const kk = k + dk;
      if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue;
      const n = kk * nx + ii;
      if (prev[n] !== -1 || (n !== goal && !isOk(n))) continue;
      prev[n] = c;
      q.push(n);
    }
  }
  if (prev[goal] === -1) return null;
  const cells = [];
  for (let c = goal; c !== start; c = prev[c]) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => [B.x0 + (c % nx) * step, B.z0 + Math.floor(c / nx) * step]);
  const see = (a, b) => {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1);
    for (let i = 0; i <= n; i++) if (!free(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n)) return false;
    return true;
  };
  const out = [];
  let cur = [h.x, h.z];
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !see(cur, pts[j])) j--;
    out.push(pts[j]);
    cur = pts[j];
    i = j + 1;
  }
  return out;
}, [tx, tz]);
/** 道を探して本物のキーで歩く。stop(s) が真になったらそこで止める */
async function walkTo(page, tx, tz, near = 0.6, stop = () => false) {
  const path = await planPath(page, tx, tz);
  if (!path) throw new Error(`(${tx}, ${tz}) への道が無い`);
  let s = await pose(page);
  for (const [x, z] of path) {
    const last = x === path[path.length - 1][0] && z === path[path.length - 1][1];
    s = await walkKeys(page, x, z, (q) => stop(q) || Math.hypot(q.x - x, q.z - z) < (last ? near : 0.45));
    if (stop(s)) break;
  }
  return s;
}
/** 行を本物の入力（Enter）で送る。選択肢か会話の外になったら返す */
async function readThrough(page) {
  let id = null;
  const seen = [];
  for (let i = 0; i < 120; i++) {
    const u = await ui(page);
    if (u?.kind === 'script') {
      id = u.id;
      const t = `${u.line?.name ?? ''}：${u.line?.text ?? ''}`;
      if (seen[seen.length - 1] !== t) seen.push(t);
    }
    if (!u || u.kind !== 'script' || u.choices?.length) return { ...(u ?? {}), seenId: id, seen };
    await page.keyboard.press('Enter');
    await sleep(220);
  }
  return { ...(await ui(page)), seenId: id, seen };
}
const pick = async (page, id) => { await sleep(450); await page.locator(`.g-choice[data-id="${id}"]`).click(); };
/** 相手の 2.4 m 南へ道を探して歩き、相手へ向かって「話す」が出るまで歩く → E → 行を送る（本物の入力） */
async function talkTo(page, id) {
  const c = (await page.evaluate(() => window.__game.cast)).find((m) => m.id === id);
  if (!c) throw new Error(`${id} が居ない`);
  await walkTo(page, c.x, c.z + 2.4, 0.5, (q) => q.prompt === id);
  await walkKeys(page, c.x, c.z, (q) => q.prompt === id, 200);
  if ((await pose(page)).prompt !== id) throw new Error(`${id} の「話す」が出ない`);
  await sleep(300);
  await page.keyboard.press('KeyE');
  await waitUi(page, 'script');
  return readThrough(page);
}

// ================================================================ 合戦（全軍撤退。待つ間だけ早送り）
async function battleAllRetreat(page) {
  await page.waitForFunction(() => window.__battle?.active && window.__battle.ui.modal === 'briefing' && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
  await sleep(400);
  const brief = await page.textContent('.b-modal');
  await page.locator('.b-primary:has-text("合戦を始める")').click();
  await page.waitForFunction(() => window.__battle.ui.started, null, POLL);
  await sleep(300);
  await page.keyboard.press('Space');
  await sleep(250);
  if (!(await page.evaluate(() => window.__battle.ui.paused))) throw new Error('指揮（一時停止）にできない');
  await page.locator('.b-allret').click();
  await page.locator('.b-confirm').waitFor({ state: 'visible' });
  await sleep(300);
  await page.locator('.b-confirm .b-btn:has-text("撤退する")').click();
  await sleep(200);
  const at = await page.evaluate(() => window.__battle.state.allRetreatAt);
  let t0 = null;
  let t = 0;
  for (let i = 0; i < 900; i++) {
    const s = await page.evaluate(() => ({ t: window.__battle.state.t, result: !!window.__battle.state.result }));
    if (t0 === null) t0 = s.t;
    t = s.t;
    if (s.result) break;
    await page.evaluate(() => window.__battle.fastForward(1));
  }
  note(`（早送り）合戦の時間 ${t0?.toFixed(0)} 秒 → ${t.toFixed(0)} 秒を、指揮（一時停止）のまま 1 秒ずつ進めた（全軍撤退は本物の入力：${at !== null ? '出た' : '出ない'}）`);
  await page.waitForFunction(() => window.__battle.ui.resultShown && document.querySelector('.b-result'), null, POLL);
  await sleep(400);
  return { brief, allRetreatAt: at, out: await page.evaluate(() => window.__battle.state.result) };
}

// ================================================================ ch1：はじめから → 戦後 → 見直し（PC・キーとマウス）
async function ch1() {
  console.log('=== ch1（PC 1280×720・キーとマウス。描画の省略 ?q=low&render=manual）：はじめから → 導入 → 城下 → 物見 → 軍議 → 出陣 → 合戦 → 帰還 → 戦後 → 見直し');
  const { ctx, page } = await open();
  // ---- 1. はじめから → 第一章の導入
  await sleep(600);
  await page.click('.g-scn[data-scenario="ieyasu1570"] .g-btn[data-id="new:ieyasu1570"]');
  await waitUi(page, 'cine');
  const S0 = await st(page);
  let c = await cine(page);
  check('本物の入力：はじめから → 第一章の導入（層 cine・台本 ch1_intro・最初は地図の場面）', c.id === 'ch1_intro' && c.mode === 'map' && (await screen(page)) === 'cinematic', J({ id: c.id, count: c.count, mode: c.mode }));
  const h0 = await pose(page);
  // 演出中の W は歩きへ漏れない
  await page.keyboard.down('KeyW');
  await sleep(800);
  await page.keyboard.up('KeyW');
  const h1 = await pose(page);
  check('演出中の W は探索の歩きへ漏れない', Math.hypot(h1.x - h0.x, h1.z - h0.z) < 1e-6);
  // 一時停止 → 2 秒 → 再開
  await cineBtn(page, 'pause');
  const p1 = await cine(page);
  await sleep(2000);
  const p2 = await cine(page);
  check('本物の入力：「一時停止」で時計が止まる（2 秒待っても t が同じ）', p1.paused && p2.paused && Math.abs(p2.t - p1.t) < 0.05, `${p1.t} → ${p2.t}`);
  await cineBtn(page, 'pause');
  await sleep(800);
  const p3 = await cine(page);
  check('本物の入力：「再開」で続きから進む', !p3.paused && p3.t > p2.t + 0.4, `${p2.t} → ${p3.t}`);
  // 次の場面
  const b0 = p3.beat;
  await cineBtn(page, 'next');
  const n1 = await cine(page);
  check('本物の入力：「次の場面」で次の場面の頭へ', n1.beat === b0 + 1, J({ from: b0, to: n1.beat, t: n1.t, mode: n1.mode }));
  // 3D の場面（使者の到着）まで次の場面で進め、出来事が町に出ることを見る（描画の省略：見た目ではなく出来事の置き方）
  for (let i = 0; i < 6 && (await cine(page))?.mode !== 'stage'; i++) await cineBtn(page, 'next');
  await sleep(600);
  const sp = await page.evaluate(() => window.__game.world.stageProbe());
  check('導入の 3D の場面：使者の到着の出来事が町に出る（使者 2 人・会話の相手の使者は隠す・カメラの差し替え）', sp.event === 'envoys_arrive' && sp.people === 2 && sp.hiddenCast.length === 2 && !!sp.shot, J({ ev: sp.event, people: sp.people, hidden: sp.hiddenCast, t: sp.t.toFixed(1) }));
  await sleep(500);
  await cineBtn(page, 'skip');
  await waitScreen(page, 'explore');
  const S1 = await st(page);
  const h2 = await pose(page);
  const sp2 = await page.evaluate(() => ({ probe: window.__game.world.stageProbe(), shot: window.__game.world.cameraShot }));
  check('本物の入力：「スキップ」→ 城下。状態は始める前と同じ・出来事を片付けカメラを戻す・主人公は始めの位置', J(norm(S1)) === J(norm(S0)) && !sp2.probe.active && sp2.shot === null && Math.hypot(h2.x - h0.x, h2.z - h0.z) < 1e-6 && Math.abs(h2.yaw - 0.36) < 1e-6, J({ h0: [h0.x, h0.z], h2: [h2.x, h2.z, h2.yaw] }));
  check('導入を見てもスキップしても保存は書かない', Object.keys(await writes(page)).length === 0, J(await writes(page)));
  // ---- 2. 城下：HUD の「情勢」・J
  await sleep(400);
  await page.locator('.g-sit-btn').click();
  await waitUi(page, 'situation');
  const sit0 = await page.evaluate(() => {
    const L = document.querySelector('.g-layer[data-kind="situation"]');
    return { facts: Object.fromEntries([...L.querySelectorAll('[data-fact]')].map((d) => [d.dataset.fact, d.textContent])), scouted: L.querySelectorAll('[data-scout]').length, hint: L.querySelector('.g-sit-scout')?.textContent ?? '', replays: [...L.querySelectorAll('.g-btn[data-id^="replay:"]')].map((b) => b.dataset.id) };
  });
  check('本物の入力：HUD の「情勢」→ いつ・今いる所・協力・敵対・危機・目的。物見はまだ（任意の案内）。見直しは導入', ['when', 'where', 'allies', 'enemies', 'crisis', 'objective'].every((k) => (sit0.facts[k] ?? '').length > 0) && sit0.scouted === 0 && sit0.hint.includes('物見') && sit0.replays.includes('replay:ch1_intro'), J({ ...sit0.facts, hint: sit0.hint.slice(0, 60), replays: sit0.replays }));
  await shot(page, 'ch1-situation-before-scout');
  await sleep(400);
  await page.keyboard.press('KeyJ');
  await waitScreen(page, 'explore');
  await sleep(300);
  await page.keyboard.press('KeyJ');
  await waitUi(page, 'situation');
  await sleep(400);
  await page.locator('.g-layer[data-kind="situation"] .g-btn[data-id="close"]').click();
  await waitScreen(page, 'explore');
  check('キー：J で情勢を閉じる・開く／「閉じる」で城下へ', true);
  // ---- 3. 物見櫓へ歩いて物見
  const lk = (await page.evaluate(() => window.__game.cast)).find((m) => m.id === 'lookout');
  check('城下（探索）に物見櫓の相手がいる', !!lk, J(lk));
  const w0 = Date.now();
  await walkTo(page, lk.x, lk.z - 0.6, 0.5);
  await page.waitForFunction(() => window.__game.prompt === 'lookout', null, { timeout: 60000, polling: 100 });
  await sleep(800);
  const before = await pose(page);
  const talkLabel = await page.evaluate(() => document.querySelector('.g-talk')?.textContent ?? '');
  check(`本物のキーで物見櫓の下へ歩いた（${((Date.now() - w0) / 1000).toFixed(0)} 秒）・「物見」のボタン`, before.prompt === 'lookout' && talkLabel.includes('物見'), `(${before.x.toFixed(2)}, ${before.z.toFixed(2)}) ${talkLabel}`);
  const sBefore = await st(page);
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__game.world.lookoutProbe()?.active && window.__game.screen === 'lookout', null, POLL);
  await sleep(1700);
  let pr = await page.evaluate(() => window.__game.world.lookoutProbe());
  // 印へ向く：マウスの引きずり（1px 0.0055 rad）
  const examined = [];
  for (const m of pr.marks.slice(0, 2)) {
    const cur = (await page.evaluate(() => window.__game.world.lookoutProbe())).marks.find((x) => x.id === m.id);
    const dx = Math.round(cur.diff / 0.0055);
    await page.mouse.move(640, 360);
    await page.mouse.down();
    const n = Math.max(4, Math.ceil(Math.abs(dx) / 40));
    for (let i = 1; i <= n; i++) await page.mouse.move(640 + (dx * i) / n, 360);
    await page.mouse.up();
    await sleep(300);
    pr = await page.evaluate(() => window.__game.world.lookoutProbe());
    if (pr.can !== m.id) { note(`印「${m.label}」へ向けなかった（${J({ can: pr.can })}）`); continue; }
    await page.locator('.g-lookout-btn[data-id="examine"]').click();
    await sleep(250);
    examined.push(m.id);
  }
  pr = await page.evaluate(() => window.__game.world.lookoutProbe());
  check(`本物の入力：引きずりで印へ向き「調べる」を ${examined.length} 回（印 ${examined.join('・')}）`, examined.length === 2 && J(pr.examined) === J(examined), J(pr.examined));
  await shot(page, 'ch1-lookout');
  await page.locator('.g-lookout-btn[data-id="done"]').click();
  await page.waitForFunction(() => !window.__game.world.lookoutProbe() && window.__game.screen === 'explore', null, POLL);
  await sleep(300);
  const after = await pose(page);
  const sAfter = await st(page);
  const strip = (s) => { const c = { ...s }; delete c.scout; delete c.playTimeSec; delete c.savedAt; return c; };
  const toast = await toastText(page);
  check('本物の入力：「終える」→ 城下へ戻る（位置・向きは同じ・記録が状態に入る・知らせ・兵や段階は同じ・保存しない）',
    Math.hypot(after.x - before.x, after.z - before.z) < 1e-6 && after.heading === before.heading && Array.isArray(sAfter.scout) && J([...sAfter.scout].sort()) === J([...examined].sort()) && J(strip(sAfter)) === J(strip(sBefore)) && toast.includes('物見の記録') && Object.keys(await writes(page)).length === 0,
    J({ scout: sAfter.scout, toast }));
  // ---- 4. 情勢の地図に記録
  await sleep(400);
  await page.keyboard.press('KeyJ');
  await waitUi(page, 'situation');
  const sit1 = await page.evaluate(() => {
    const L = document.querySelector('.g-layer[data-kind="situation"]');
    return { list: [...L.querySelectorAll('li[data-scout]')].map((li) => li.dataset.scout + '：' + li.textContent.slice(0, 50)), onMap: [...L.querySelectorAll('svg [data-scout="1"]')].map((e) => e.dataset.place ?? e.dataset.route), legend: !!L.querySelector('[data-legend-scout]'), objective: L.querySelector('[data-fact="objective"]')?.textContent ?? '' };
  });
  check('情勢：物見の記録が一覧と地図（記録の印）・凡例に出る。目的の文は物見の前と同じ', sit1.list.length >= 1 && sit1.onMap.length >= 1 && sit1.legend && sit1.objective === sit0.facts.objective, J(sit1));
  await shot(page, 'ch1-situation-after-scout');
  await sleep(400);
  await page.keyboard.press('Escape');
  await waitScreen(page, 'explore');
  // ---- 5. 忠勝と軍議（地図で見る・タブで強調・決めない）
  let u = await talkTo(page, 'tadakatsu');
  check('本物の入力：忠勝へ歩いて話す → 軍議を開く', (u.choices ?? []).includes('open_council'), u.seenId);
  await pick(page, 'open_council');
  await waitScreen(page, 'council');
  await sleep(300);
  const hall = await page.evaluate(() => window.__game.world.cameraShot);
  check('軍議の間は軍議所（陣幕）を映す', !!hall && hall.tx > 10 && hall.tz < -18, J(hall));
  u = await readThrough(page);
  const policyText = await page.evaluate(() => document.querySelector('.g-choice[data-id="policy_oda"]')?.textContent ?? '');
  check('軍議の選択肢の説明に「物見：…」の 1 行（記録があるとき）', policyText.includes('物見：'), policyText.slice(0, 160));
  const sel0 = u.selected;
  await sleep(400);
  await page.locator('.g-council-map').click();
  await waitUi(page, 'situation');
  let s = await ui(page);
  const hl0 = s.highlight;
  check('本物の入力：「地図で見る」→ 情勢（軍議から・選択肢のタブ）', s.from === 'council' && s.options.length >= 3 && s.option === sel0, J({ options: s.options, option: s.option }));
  const other = s.options.find((o) => o !== s.option);
  await sleep(450);
  await page.locator(`.g-sit-tab[data-option="${other}"]`).click();
  await sleep(200);
  s = await ui(page);
  const ph = await page.evaluate(() => ({ phase: window.__game.state.phase, policy: window.__game.state.policy }));
  check('本物の入力：タブを押すと強調が変わるだけ（方針は決まらない）', s.option === other && J(s.highlight) !== J(hl0) && ph.phase === 'council' && ph.policy === null, J({ option: s.option, hl: s.highlight, ...ph }));
  await shot(page, 'ch1-council-situation');
  await sleep(450);
  await page.locator('.g-layer[data-kind="situation"] .g-btn[data-id="close"]').click();
  await waitUi(page, 'script');
  const back = await ui(page);
  check('閉じると軍議の同じ選択肢（決まっていない）', J(back.choices) === J(u.choices) && (await st(page)).policy === null);
  await pick(page, 'policy_oda');
  u = await readThrough(page);
  await pick(page, 'confirm_policy');
  await waitScreen(page, 'explore');
  const sm = await st(page);
  const hallOff = await page.evaluate(() => window.__game.world.cameraShot);
  check('方針（織田）を決める → 支度。軍議所の差し替えを外す', sm.phase === 'muster' && sm.policy === 'oda' && hallOff === null);
  const amb = await page.evaluate(() => window.__game.world.ambientProbe());
  check('支度の町：出陣を待つ兵（城内）がいる', amb.spec?.groups?.some((g) => g.kind === 'preparing' && g.count > 0), J(amb.spec?.groups));
  // ---- 6. 支度：約束（織田の使者）→ 城門
  u = await talkTo(page, 'oda_envoy');
  if ((u.choices ?? []).includes('pledge_accept')) await pick(page, 'pledge_accept');
  await waitScreen(page, 'explore');
  check('本物の入力：織田の使者へ歩いて話す → 約束を引き受ける', (await st(page)).pledge?.accepted === true, u.seenId);
  await countWrites(page);
  // 城門へは道の真ん中 (0, −5.4) を経て（本番の e2e と同じ道すじ）
  await walkTo(page, 0, -5.4, 0.6, (q) => q.ui === 'script');
  const g = (await page.evaluate(() => window.__game.cast)).find((m) => m.id === 'gate');
  await walkKeys(page, g.x, g.z, (q) => q.ui === 'script', 300);
  await waitUi(page, 'script');
  u = await readThrough(page);
  check('本物のキーで城門へ歩く → 出陣の確認', (u.choices ?? []).includes('depart'), u.seenId);
  await pick(page, 'depart');
  // ---- 7. 出陣の演出（通常速度で最後まで見る）
  await waitUi(page, 'cine');
  c = await cine(page);
  const dSave = await saved(page);
  check('出陣の演出は出陣前の保存の後（版 3・departure）', c.id.startsWith('departure') && dSave?.point === 'departure', J({ id: c.id, point: dSave?.point }));
  const dw0 = Date.now();
  const dBeats = [];
  let last = -1;
  let lastC = c;
  for (;;) {
    const x = await cine(page);
    if (!x) break;
    lastC = x;
    if (x.beat !== last) {
      last = x.beat;
      const sp3 = x.mode === 'stage' ? await page.evaluate(() => window.__game.world.stageProbe()) : null;
      dBeats.push(`${x.beat}(${x.mode}${sp3 ? ` ${sp3.event} 兵 ${sp3.figures}` : ''}) t=${x.t.toFixed(1)}`);
    }
    await sleep(150);
  }
  const dWall = (Date.now() - dw0) / 1000;
  note(`出陣の演出：${dBeats.join(' / ')}`);
  check(`出陣の演出を触らずに最後まで（通常速度。描画の省略）：壁の時計 ${dWall.toFixed(1)} 秒・8〜15 秒`, dWall >= 7 && dWall <= 16 && dBeats.some((b) => b.includes('column_depart')), `最後の t=${lastC.t.toFixed(1)}`);
  // ---- 8. 合戦（全軍撤退）
  await page.waitForFunction(() => window.__game.screen === 'battle', null, POLL);
  const bt = await battleAllRetreat(page);
  check('合戦の前の説明に「物見で確かめた：…」の行（地形だけ）', bt.brief.includes('物見で確かめた：'), (bt.brief.match(/物見で確かめた：[^。]*。/) ?? [''])[0]);
  check(`合戦：全軍撤退（本物の入力）→ 結果 ${bt.out.result}`, bt.allRetreatAt !== null && !!bt.out.result, `${bt.out.result}/${bt.out.reason}`);
  const aSave = await saved(page);
  await sleep(300);
  await page.locator('.b-primary:has-text("続ける")').click();
  // ---- 9. 帰還の演出（Esc でスキップ）
  await waitUi(page, 'cine');
  c = await cine(page);
  const toastDuring = await toastText(page);
  check('帰還の演出は戦後の保存の後（版 3・aftermath・反映済み）・保存の知らせは演出の後', c.id.startsWith('return') && aSave?.point === 'aftermath' && aSave.appliedBattleId === aSave.battleId && !toastDuring.includes('戦後'), J({ id: c.id, point: aSave?.point, toastDuring }));
  await sleep(1500);
  const rp = await page.evaluate(() => ({ c: window.__game.cine, probe: window.__game.world.stageProbe(), key: window.__game.world.stageKey }));
  if (rp.c?.mode === 'stage') note(`帰還の 3D の場面：${rp.key}`);
  await sleep(600);
  await page.keyboard.press('Escape');
  await waitScreen(page, 'explore');
  await sleep(300);
  const sa = await st(page);
  const toastAfter = await toastText(page);
  const hp = await pose(page);
  check('キー：Esc で帰還の演出をスキップ → 戦後の城下（主人公は始めの位置・知らせ「保存しました：戦後」）', sa.phase === 'aftermath' && toastAfter.includes('保存しました') && Math.abs(hp.yaw - 0.36) < 1e-6, J({ toastAfter, phase: sa.phase }));
  check('物見の記録は合戦の結果を反映すると消える', sa.scout === undefined || sa.scout === null, J(sa.scout));
  const w = await writes(page);
  check('出陣から戦後まで、保存の書き込みは出陣前と戦後の 2 回だけ（演出は書かない）', w[KEY] === 2 && Object.keys(w).length === 1 && (await sentinelsKept(page)), J(w));
  // ---- 10. 戦後：情勢から演出を見直す
  await countWrites(page);
  const sBeforeReplay = await st(page);
  await sleep(400);
  await page.locator('.g-sit-btn').click();
  await waitUi(page, 'situation');
  const reps = await page.evaluate(() => [...document.querySelectorAll('.g-layer[data-kind="situation"] .g-btn[data-id^="replay:"]')].map((b) => b.dataset.id));
  check('戦後の情勢：見直せる演出は導入・出陣・帰還', ['replay:ch1_intro', 'replay:departure', 'replay:return'].every((x) => reps.includes(x)), J(reps));
  await sleep(450);
  await page.locator('.g-btn[data-id="replay:return"]').click();
  await waitUi(page, 'cine');
  const rr = await cine(page);
  await sleep(1200);
  const rr2 = await cine(page);
  check('本物の入力：「見直す」→ 帰還の演出を最初から（時計が進む）', rr.id.startsWith('return') && rr.t < 1 && rr2.t > rr.t + 0.8, `${rr.t} → ${rr2.t}`);
  await cineBtn(page, 'skip');
  await waitUi(page, 'situation');
  await sleep(450);
  await page.locator('.g-layer[data-kind="situation"] .g-btn[data-id="close"]').click();
  await waitScreen(page, 'explore');
  check('見直し：状態は変わらず、保存も書かない', J(norm(await st(page))) === J(norm(sBeforeReplay)) && Object.keys(await writes(page)).length === 0, J(await writes(page)));
  note(`再生した演出（cineLog）：${J(await page.evaluate(() => window.__game.cineLog))}`);
  await shot(page, 'ch1-aftermath');
  // 戦後の保存から読み込み直しても戦後（演出は流れない）
  await page.reload();
  await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, POLL);
  await sleep(600);
  await page.click('.g-btn[data-id="continue:ieyasu1570"]');
  await waitScreen(page, 'explore');
  const sr = await st(page);
  check('読み込み直して「つづきから」→ 戦後の城下（演出は流さない・反映済みの合戦）', sr.phase === 'aftermath' && sr.appliedBattleId === sa.appliedBattleId && J(sr.troops) === J(sa.troops) && (await page.evaluate(() => window.__game.cineLog.length)) === 0);
  await ctx.close();
}

// ================================================================ ch2：第一章の結末の保存から第二章へ（スマホ横・タッチ）
async function ch2One(name, watch) {
  const src = fixture(name);
  const f = JSON.parse(src);
  const { ctx, page } = await open({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true }, src);
  await sleep(600);
  await page.locator('.g-btn[data-id="continue:ieyasu1570"]').tap();
  await waitUi(page, 'ending');
  await sleep(600);
  await page.locator('.g-btn[data-id="next_chapter"]').tap();
  await waitUi(page, 'cine');
  const c0 = await cine(page);
  const sv = await saved(page);
  check(`[${name}] 本物の入力：「第二章へ進む」（タップ）→ 保存（版 4・chapter）の後に移行の演出`, c0.id.startsWith('ch2_intro') && sv?.version === 4 && sv.point === 'chapter', c0.id);
  const events = [];
  const infos = new Set();
  const byBeat = new Map();
  const readStage = async (beat) => {
    const k = await page.evaluate(() => window.__game.world.stageKey);
    if (!k) return;
    const p = await page.evaluate(() => window.__game.world.stageProbe());
    const e = byBeat.get(beat) ?? { ...JSON.parse(k), people: 0, figures: 0 };
    e.people = Math.max(e.people, p.people);
    e.figures = Math.max(e.figures, p.figures);
    if (!byBeat.has(beat)) { byBeat.set(beat, e); events.push(e); }
  };
  if (watch) {
    // 触らずに最後まで見る（通常速度。描画の省略：3D は描かないが、出来事の置き方は同じ時計で動く）。画面写しは撮らない（ページが止まるため）
    const w0 = Date.now();
    let lastT = 0;
    for (;;) {
      const x = await cine(page);
      if (!x) break;
      lastT = x.t;
      for (const k of x.info ?? []) infos.add(k);
      if (x.mode === 'stage') await readStage(x.beat);
      await sleep(200);
    }
    const wall = (Date.now() - w0) / 1000;
    check(`[${name}] 移行の演出を触らずに最後まで（通常速度。描画の省略）：演出の時計と壁の時計がほぼ同じ・30〜45 秒`, Math.abs(wall - lastT) < Math.max(1.5, lastT * 0.08) && lastT >= 29 && lastT <= 46, `演出 ${lastT.toFixed(1)} 秒・壁 ${wall.toFixed(1)} 秒`);
  } else {
    // 一時停止して、「次の場面」で場面を送りながら 3D の出来事を記録する（止めたまま。画面写しも止めたまま撮る）
    await sleep(400);
    await cineBtn(page, 'pause', true);
    const pz0 = await cine(page);
    await sleep(1200);
    const pz1 = await cine(page);
    check(`[${name}] 本物の入力：「一時停止」をタップすると止まる（1 回のタップで 1 回だけ切り替わる）`, pz0.paused && pz1.paused && Math.abs(pz1.t - pz0.t) < 0.05, `${pz0.t} → ${pz1.t}`);
    const steps = [];
    for (let i = 0; i < 20; i++) {
      const x = await cine(page);
      if (!x) break;
      for (const k of x.info ?? []) infos.add(k);
      if (x.mode === 'stage') { await sleep(300); await readStage(x.beat); }
      if (i === 1) await shot(page, `ch2-${name}-cine`);
      if (x.beat >= x.count - 1) break;
      await cineBtn(page, 'next', true);
      await page.waitForFunction((b) => window.__game.cine?.beat !== b, x.beat, POLL);
      const y = await cine(page);
      steps.push(`${x.beat}→${y?.beat}${y?.paused ? '' : '（再生）'}`);
    }
    check(`[${name}] 本物の入力：「次の場面」のタップ 1 回で 1 場面だけ進む（止めたまま）`, steps.length > 0 && steps.every((t) => { const [a, b] = t.replace('（再生）', '').split('→').map(Number); return b === a + 1 && !t.includes('（再生）'); }), steps.join(' '));
    const last = await cine(page);
    for (const k of last?.info ?? []) infos.add(k);
    await sleep(400);
    await cineBtn(page, 'skip', true);
  }
  note(`[${name}] 移行の 3D の出来事：${events.map((e) => `${e.id}${e.count !== undefined ? ` ×${e.count}` : ''}${e.mark ? ` 旗 ${e.mark}` : ''}${e.name ? ` ${e.name}` : ''}（人 ${e.people}・兵 ${e.figures}）`).join(' / ')}`);
  note(`[${name}] 出した情報の札：${[...infos].join(',')}`);
  await waitUi(page, 'record');
  const r = await ui(page);
  check(`[${name}] ${watch ? '演出が終わる' : '本物の入力：「スキップ」（タップ）'} → 結果確認（ボタンは「城下へ」）`, J(r.buttons.map((b) => b.id)) === '["to_town"]');
  await sleep(500);
  await page.locator('.g-btn[data-id="to_town"]').tap();
  await waitScreen(page, 'explore');
  await sleep(500);
  const s = await st(page);
  const amb = await page.evaluate(() => window.__game.world.ambientProbe());
  check(`[${name}] 第二章の城下：兵は第一章の終わりのまま（演出の人数で増減しない）`, s.chapter === 2 && J(s.troops) === J(f.troops), J(s.troops));
  const castIds = await page.evaluate(() => window.__game.cast.map((c) => c.id));
  check(`[${name}] 第二章の城下にも物見櫓の相手（任意の物見）`, castIds.includes('lookout'), castIds.join(','));
  await shot(page, `ch2-${name}-town`);
  await ctx.close();
  return { events, infos: [...infos], ambient: amb.spec, figures: amb.figures, walkers: amb.walkers.map((w) => w.role) };
}
async function ch2() {
  console.log('=== ch2（スマホ横 844×390・タッチ。描画の省略）：第一章の結末の保存 2 つ（直接状態変更）から第二章へ。移行の演出と町の人々が結果で違う');
  const win = await ch2One('oda_victory_kept', true);
  const heavy = await ch2One('oda_defeat_broken_heavy', false);
  const g = (a, k) => a.ambient?.groups?.find((x) => x.kind === k) ?? null;
  const ev = (a, id) => a.events.find((e) => e.id === id) ?? null;
  note(`町の人々：勝ち ${J(win.ambient?.groups)}／損害大 ${J(heavy.ambient?.groups)}`);
  check('移行の演出：勝ち・約束を守った保存は援兵の到着（旗 織）、損害大・約束を破った保存は援兵なし', ev(win, 'reinforcement_arrive')?.mark === '織' && !ev(heavy, 'reinforcement_arrive'), J({ win: ev(win, 'reinforcement_arrive'), heavy: ev(heavy, 'reinforcement_arrive') }));
  check('移行の演出：損害大の保存は負傷兵の場面が多い（見た目の人数）', (ev(heavy, 'wounded_rest')?.count ?? 0) > (ev(win, 'wounded_rest')?.count ?? 0), `${ev(win, 'wounded_rest')?.count ?? 0} → ${ev(heavy, 'wounded_rest')?.count ?? 0}`);
  check('移行の演出：どちらも使いの到着と、いつ・どこ・協力・前の結果・危機・判断の札', [win, heavy].every((a) => !!ev(a, 'messenger_arrive') && ['when', 'where', 'ally', 'prev', 'crisis', 'decide'].every((k) => a.infos.includes(k))), J([win.infos, heavy.infos]));
  check('第二章の町の人々：損害大の保存は詰所の負傷兵が多い。援兵（旗 織）は勝ち・約束を守った保存だけ', (g(heavy, 'wounded')?.count ?? 0) > (g(win, 'wounded')?.count ?? 0) && g(win, 'reinforcement')?.mark === '織' && !g(heavy, 'reinforcement'), `負傷 ${g(win, 'wounded')?.count ?? 0} → ${g(heavy, 'wounded')?.count ?? 0}・援兵 ${J(g(win, 'reinforcement'))} / ${J(g(heavy, 'reinforcement'))}`);
}

try {
  for (const part of PARTS) {
    const t = Date.now();
    if (part === 'ch1') await ch1();
    else if (part === 'ch2') await ch2();
    else throw new Error(`PARTS が分からない：${part}`);
    note(`${part}：実時間 ${((Date.now() - t) / 1000).toFixed(0)} 秒`);
  }
} catch (e) {
  failed++;
  console.log('NG 途中で止まった：', e.stack || e.message);
}
check('ページの誤りなし', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n結果：OK ${oks}・NG ${failed}（${secs()}）`);
process.exit(failed ? 1 : 0);
