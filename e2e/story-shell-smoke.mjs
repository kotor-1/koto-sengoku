// 物語の見せ方の「画面と流れ」の小さな確かめ（開発サーバー）：演出の再生器・情勢の画面・軍議の「地図で見る」・動きを減らす・自動の一時停止。
// 依頼：docs/story-rpg-request.md【1】【2】【5】・設計 docs/story-rpg-design.md §1・§3・§4。
//
// 確認の種類（出力の行にも書く）：
//   - 本物の入力：タイトルの「はじめから」・演出のボタン（一時停止／再開・次の場面・前の場面・スキップ・動きを減らす）とキー（Space・K・←→・Esc）・
//     演出中の W・E・Enter（漏れないこと）・HUD の「情勢」・J・情勢の「見直す」「閉じる」・軍議の選択肢と「地図で見る」・情勢のタブ（タップ）。
//     PC（マウスとキー）と、スマホ横 844×390（タッチ）。
//   - 描画の省略：?q=low&render=manual（探索の 3D を描かない。演出の時計は実時間で進む＝通常速度。3D の場面の見た目はここでは見ない）。
//     intro3d だけは描画を省かずに流し、3D を描きながら時計がどれだけ進むかを記録する（このコンテナは毎秒 1 コマ未満。1 コマの上限 1 秒）。
//   - 直接状態変更：localStorage の見張りの保存（2D・架空・演習）を入れる・__game.talk（軍議まで歩く代わり）・見えなくなったことの模擬
//     （document.visibilityState を上書きして visibilitychange を送る）。保存の書き込みの数え上げ（setItem を包む）は観察だけ。
//   - 実機・性能：ここでは未確認（このコンテナはソフトウェア描画）。
//
// PARTS（カンマ区切り。既定はすべて）：intro, skip, situation, council, reduce, hidden, intro3d
// 使い方：自動再読み込みなしの開発サーバーを起動して
//   (PORT=5291 setsid nohup npx vite --config proto3d/blender/tools/vite.nohmr.mjs > /tmp/vite-5291.log 2>&1 &)
//   BASE=http://localhost:5291 node e2e/story-shell-smoke.mjs [出力先]
import { launchBrowser, outDir } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/story-shell');
const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:5291';
const PARTS = (process.env.PARTS || 'intro,skip,situation,council,reduce,hidden,intro3d').split(',').map((s) => s.trim()).filter(Boolean);
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
const POLL = { timeout: 300000, polling: 100 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = 'koto-sengoku/3d-ieyasu1570';
const FKEY = 'koto-sengoku/3d-chapter1';
const KEY2D = 'koto-sengoku/save';
const PKEY = 'koto-sengoku/3d-fields';
const PREFS = 'koto-sengoku/3d-prefs';
const SENT = { [KEY2D]: '{"2d":"keep"}', [FKEY]: '{"sentinel":"fictional"}', [PKEY]: '{"sentinel":"practice"}' };
const J = (v) => JSON.stringify(v);

async function open(opts = {}, query = '?q=low&render=manual') {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => console.log(`   ！ページの誤り ${e.message.slice(0, 200)}`));
  // 読み込み直しの途中の「Couldn't load texture blob」は読み込み直しで捨てた物（ieyasu-ch2.mjs と同じく数えない）
  page.on('console', (m) => { if (m.type() === 'error' && !/Couldn't load texture blob:/.test(m.text())) console.log(`   ！console ${m.text().slice(0, 200)}`); });
  await page.goto(BASE + '/' + query);
  await page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
  // 見張りの保存（2D・架空・演習）を入れ、歴史分岐と設定は消す（直接状態変更）
  await page.evaluate(([s, k, p]) => {
    localStorage.clear();
    for (const [kk, v] of Object.entries(s)) localStorage.setItem(kk, v);
    localStorage.removeItem(k);
    localStorage.removeItem(p);
  }, [SENT, KEY, PREFS]);
  await page.reload();
  await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, POLL);
  await countWrites(page);
  return { ctx, page };
}
/** 保存の書き込みを数える（setItem を包む。観察だけ） */
const countWrites = (page) => page.evaluate(() => {
  window.__writes = {};
  const orig = Storage.prototype.setItem;
  if (window.__writesWrapped) return;
  window.__writesWrapped = true;
  Storage.prototype.setItem = function (k, v) {
    window.__writes[k] = (window.__writes[k] ?? 0) + 1;
    return orig.call(this, k, v);
  };
});
const writes = (page) => page.evaluate(() => ({ ...window.__writes }));
const cine = (page) => page.evaluate(() => window.__game.cine);
const ui = (page) => page.evaluate(() => window.__game.ui);
const st = (page) => page.evaluate(() => (window.__game.state ? JSON.parse(JSON.stringify(window.__game.state)) : null));
const hero = (page) => page.evaluate(() => ({ x: window.__p3.hero.x, z: window.__p3.hero.z }));
const norm = (s) => { if (!s) return s; const c = { ...s }; delete c.playTimeSec; delete c.savedAt; return c; };
const rectOf = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2, top: b.top, bottom: b.bottom, left: b.left, right: b.right }; }, sel);
const sentinelsKept = (page) => page.evaluate((s) => Object.entries(s).every(([k, v]) => localStorage.getItem(k) === v), SENT);
const waitCine = (page) => page.waitForFunction(() => window.__game.ui?.kind === 'cine', null, POLL);
const clickBtn = async (page, id) => { await page.click(`.g-layer[data-kind="cine"] .g-cine-btn[data-id="${id}"]`); await sleep(120); };

/** 演出の層の見た目の決まり：字幕 16px 以上・2 行まで・不透明な帯／地図の文字 12px 以上・凡例と注記 */
async function cineLooks(page, tag) {
  const r = await page.evaluate(() => {
    const cap = document.querySelector('.g-cine-cap');
    const cs = getComputedStyle(cap);
    const lh = parseFloat(cs.lineHeight);
    const bottom = document.querySelector('.g-cine-bottom');
    const bg = getComputedStyle(bottom).backgroundColor;
    const texts = [...document.querySelectorAll('.g-cine svg text')].filter((t) => t.getClientRects().length > 0);
    const minPx = texts.reduce((m, t) => Math.min(m, parseFloat(getComputedStyle(t).fontSize) * (t.getScreenCTM()?.a ?? 1)), 99);
    return { capPx: parseFloat(cs.fontSize), capLines: Math.round(cap.getBoundingClientRect().height / lh), capInView: cap.getBoundingClientRect().bottom <= innerHeight, bg, minPx, texts: texts.length, legend: !!document.querySelector('.g-cine .g-map-legend'), noteText: document.querySelector('.g-cine [data-note]')?.textContent ?? '' };
  });
  check(`${tag}：字幕 16px 以上・2 行まで・画面の中・不透明な帯`, r.capPx >= 16 && r.capLines <= 2 && r.capInView && /rgba?\(14, 12, 10(, 0\.9\d+)?\)/.test(r.bg), J(r));
  if (r.texts > 0) check(`${tag}：地図の文字 12px 以上・凡例・模式図の注記`, r.minPx >= 12 && r.legend && r.noteText.includes('模式図'), `最小 ${r.minPx.toFixed(1)}px・注記「${r.noteText}」`);
}

// ================================================================ intro：通常速度の導入（PC）
let introState = null;
if (PARTS.includes('intro')) {
  console.log('--- intro：第一章の導入を通常速度で（PC：マウスとキー。描画の省略）');
  const { ctx, page } = await open();
  await sleep(600);
  await page.click('.g-scn[data-scenario="ieyasu1570"] .g-btn[data-id="new:ieyasu1570"]');
  await waitCine(page);
  // 演出を始めた直後（押し始めの守りの中）の Esc では飛ばない
  await page.keyboard.press('Escape');
  await sleep(150);
  let c = await cine(page);
  check('始めた直後の Esc（守りの中）では飛ばない', c?.state === 'playing', J({ state: c?.state, t: c?.t }));
  const S0 = await st(page);
  const h0 = await hero(page);
  check('本物の入力：はじめから → 第一章の導入（層 cine・地図の場面から）', c?.id === 'ch1_intro' && c.mode === 'map' && (await page.evaluate(() => window.__game.screen)) === 'cinematic', J({ id: c?.id, count: c?.count, mode: c?.mode }));
  await cineLooks(page, '導入');
  await page.screenshot({ path: `${OUT}/intro-map-844x390.png` });
  // 演出中の入力（W を押し続ける・E・Enter）は、探索の移動・会話へ漏れない
  await page.keyboard.down('KeyW');
  await sleep(1200);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyE');
  await page.keyboard.press('Enter');
  await sleep(200);
  const h1 = await hero(page);
  c = await cine(page);
  check('演出中の W・E・Enter は移動・会話へ漏れない（主人公は動かない・演出のまま）', Math.hypot(h1.x - h0.x, h1.z - h0.z) < 1e-6 && c?.state === 'playing' && (await ui(page))?.kind === 'cine', J({ h0, h1 }));
  // 一時停止（ボタン）→ 2 秒止まる → 再開
  await sleep(1500);
  await clickBtn(page, 'pause');
  const p1 = await cine(page);
  await sleep(2000);
  const p2 = await cine(page);
  check('本物の入力：「一時停止」で時計が止まる（2 秒待っても t が同じ）', p1.state === 'paused' && p2.state === 'paused' && Math.abs(p2.t - p1.t) < 0.05 && (await page.evaluate(() => document.querySelector('.g-layer[data-kind="cine"]').dataset.state)) === 'paused', `${p1.t} → ${p2.t}`);
  await clickBtn(page, 'pause');
  await sleep(1000);
  const p3 = await cine(page);
  check('本物の入力：「再開」で続きから進む', p3.state === 'playing' && p3.t > p2.t + 0.5 && p3.t < p2.t + 1.6, `${p2.t} → ${p3.t}`);
  // キー：Space で止める・K で再開
  await page.keyboard.press('Space');
  await sleep(150);
  const k1 = await cine(page);
  await page.keyboard.press('KeyK');
  await sleep(150);
  const k2 = await cine(page);
  check('キー：Space で一時停止・K で再開', k1.paused === true && k2.paused === false, J({ k1: k1.paused, k2: k2.paused }));
  // 次の場面（ボタン）・前の場面（←）・次の場面（→）
  const b0 = (await cine(page)).beat;
  await clickBtn(page, 'next');
  const n1 = await cine(page);
  check('本物の入力：「次の場面」で次の場面の頭へ', n1.beat === b0 + 1, J({ from: b0, to: n1.beat, t: n1.t }));
  await page.keyboard.press('ArrowLeft');
  await sleep(120);
  const n2 = await cine(page);
  check('キー：← で前の場面へ', n2.beat === b0, J({ beat: n2.beat, t: n2.t }));
  await page.keyboard.press('ArrowRight');
  await sleep(120);
  const n3 = await cine(page);
  check('キー：→ で次の場面へ', n3.beat === b0 + 1, J({ beat: n3.beat }));
  // ここから最後まで触らずに見る：時計は通常速度（壁の時計と同じ速さ）
  const w0 = Date.now();
  const tStart = n3.t;
  const beats = [];
  let last = -1;
  let cap = null;
  for (;;) {
    const x = await cine(page);
    if (!x) break;
    if (x.beat !== last) {
      last = x.beat;
      beats.push({ beat: x.beat, mode: x.mode, t: x.t, wall: (Date.now() - w0) / 1000 });
      if (x.mode === 'stage') await page.screenshot({ path: `${OUT}/intro-stage-${x.beat}.png` });
    }
    cap = x;
    await sleep(200);
  }
  const wall = (Date.now() - w0) / 1000;
  const remain = (cap?.t ?? tStart) - tStart;
  note(`場面：${beats.map((b) => `${b.beat}(${b.mode}) t=${b.t.toFixed(1)} 壁 ${b.wall.toFixed(1)}s`).join(' / ')}`);
  check('通常速度：触らずに見た区間の演出の時間と壁の時計がほぼ同じ（描画の省略）', Math.abs(wall - remain) < Math.max(1.5, remain * 0.08), `演出 ${remain.toFixed(1)} 秒・壁 ${wall.toFixed(1)} 秒`);
  check('最後に出した情報の札：いつ・どこ・協力・危機・判断', ['when', 'where', 'ally', 'crisis', 'decide'].every((k) => (cap?.info ?? []).includes(k)), J(cap?.info));
  await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
  const S1 = await st(page);
  const h2 = await hero(page);
  check('終わったら城下（探索）。状態は始める前と同じ（遊んだ時間を除く）', J(norm(S1)) === J(norm(S0)), '');
  check('終わったら主人公は始める前の位置', Math.hypot(h2.x - h0.x, h2.z - h0.z) < 1e-6, J({ h0, h2 }));
  const w = await writes(page);
  check('演出を見ても保存は書かない（設定も書かない）・見張りの保存はそのまま', Object.keys(w).length === 0 && (await sentinelsKept(page)), J(w));
  // 操作が戻っている：W を押し直すと歩く
  await sleep(300);
  await page.keyboard.down('KeyW');
  await sleep(1200);
  await page.keyboard.up('KeyW');
  const h3 = await hero(page);
  check('本物の入力：終わった後は W で歩ける（操作が戻る）', Math.hypot(h3.x - h2.x, h3.z - h2.z) > 0.5, `${Math.hypot(h3.x - h2.x, h3.z - h2.z).toFixed(2)} m`);
  introState = norm(S1);
  await ctx.close();
}

// ================================================================ skip：スマホ横（タッチ）でスキップ
if (PARTS.includes('skip')) {
  console.log('--- skip：スマホ横 844×390（タッチ）で導入をスキップ');
  const { ctx, page } = await open({ isMobile: true, hasTouch: true });
  await sleep(600);
  await page.locator('.g-scn[data-scenario="ieyasu1570"] .g-btn[data-id="new:ieyasu1570"]').tap();
  await waitCine(page);
  // 背景（地図の外の何もない所）を押しても飛ばない
  await page.touchscreen.tap(40, 200);
  await sleep(400);
  await page.touchscreen.tap(40, 200);
  await sleep(200);
  check('背景を押しても飛ばない', (await cine(page))?.state === 'playing');
  await page.locator('.g-cine-btn[data-id="skip"]').tap();
  await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
  const S = norm(await st(page));
  check('本物の入力：「スキップ」で城下へ', (await ui(page)) === null);
  if (introState) check('スキップした状態は、最後まで見た状態と同じ', J(S) === J(introState));
  check('スキップしても保存は書かない', Object.keys(await writes(page)).length === 0, J(await writes(page)));
  const hud = await rectOf(page, '.g-sit-btn');
  const menu = await rectOf(page, '.g-menu-btn');
  check('HUD に「情勢」のボタン（メニューの下・重ならない）', !!hud && !!menu && hud.top >= menu.bottom - 0.5, J({ hud, menu }));
  await page.screenshot({ path: `${OUT}/town-after-skip-844x390.png` });
  await ctx.close();
}

// ================================================================ situation：情勢の画面と見直し（スマホ横・タッチ＋キー）
if (PARTS.includes('situation')) {
  console.log('--- situation：HUD の「情勢」・J・見直し（スマホ横・タッチ）');
  const { ctx, page } = await open({ isMobile: true, hasTouch: true });
  await sleep(600);
  await page.locator('.g-btn[data-id="new:ieyasu1570"]').tap();
  await waitCine(page);
  await sleep(500);
  await page.locator('.g-cine-btn[data-id="skip"]').tap();
  await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
  const S0 = await st(page);
  await sleep(400);
  await page.locator('.g-sit-btn').tap();
  await page.waitForFunction(() => window.__game.ui?.kind === 'situation', null, POLL);
  const v = await page.evaluate(() => {
    const L = document.querySelector('.g-layer[data-kind="situation"]');
    const facts = Object.fromEntries([...L.querySelectorAll('[data-fact]')].map((d) => [d.dataset.fact, d.textContent]));
    const texts = [...L.querySelectorAll('svg.g-map text')];
    const minPx = texts.reduce((m, t) => Math.min(m, parseFloat(getComputedStyle(t).fontSize) * (t.getScreenCTM()?.a ?? 1)), 99);
    const legend = [...L.querySelectorAll('.g-sit-legend [data-legend-side]')].map((e) => e.textContent);
    const labels = [...L.querySelectorAll('svg.g-map .g-map-label')].map((e) => e.textContent);
    return { facts, minPx, legend, labels, note: L.querySelector('[data-note]')?.textContent ?? '', replays: [...L.querySelectorAll('.g-btn[data-id^="replay:"]')].map((b) => b.dataset.id) };
  });
  check('情勢：いつ・今いる所・協力・敵対・今の危機・今回の目的', ['when', 'where', 'allies', 'enemies', 'crisis', 'objective'].every((k) => (v.facts[k] ?? '').length > 0), J(v.facts));
  check('情勢：地図の名前は「記号＋名前」・凡例は「記号＋名前」・模式図の注記・文字 12px 以上', v.labels.length > 0 && v.labels.every((t) => /^[◎○✕△？]/.test(t)) && v.legend.length > 0 && v.legend.every((t) => /^[◎○✕△？]/.test(t)) && v.note.includes('模式図') && v.minPx >= 12, J({ labels: v.labels, legend: v.legend, minPx: v.minPx.toFixed(1) }));
  await page.screenshot({ path: `${OUT}/situation-explore-844x390.png` });
  // J で閉じる・J で開く（キー）
  await sleep(400);
  await page.keyboard.press('KeyJ');
  await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
  await sleep(300);
  await page.keyboard.press('KeyJ');
  await page.waitForFunction(() => window.__game.ui?.kind === 'situation', null, POLL);
  check('キー：J で情勢を閉じる・開く', true);
  // 見直し（タップ）→ 演出 → Esc でスキップ → 情勢へ戻る → 閉じる
  check('情勢に「演出を見直す」（第一章の導入）', v.replays.includes('replay:ch1_intro'), J(v.replays));
  await sleep(450);
  await page.locator('.g-btn[data-id="replay:ch1_intro"]').tap();
  await waitCine(page);
  const r1 = await cine(page);
  check('本物の入力：「見直す」で演出を最初から（状態は読むだけ）', r1.id === 'ch1_intro' && r1.t < 1.5, J({ id: r1.id, t: r1.t }));
  await sleep(1500);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.ui?.kind === 'situation', null, POLL);
  check('キー：Esc でスキップ → 情勢の画面へ戻る', true);
  await sleep(450);
  await page.locator('.g-layer[data-kind="situation"] .g-btn[data-id="close"]').tap();
  await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
  check('見直し・情勢で状態は変わらず、保存も書かない', J(norm(await st(page))) === J(norm(S0)) && Object.keys(await writes(page)).length === 0, J(await writes(page)));
  await ctx.close();
}

// ================================================================ council：軍議の「地図で見る」とタブ（見るだけ）
if (PARTS.includes('council')) {
  console.log('--- council：軍議の「地図で見る」・タブ（スマホ横・タッチ）');
  const { ctx, page } = await open({ isMobile: true, hasTouch: true });
  await sleep(600);
  await page.locator('.g-btn[data-id="new:ieyasu1570"]').tap();
  await waitCine(page);
  await sleep(500);
  await page.locator('.g-cine-btn[data-id="skip"]').tap();
  await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
  // 軍議まで（歩く代わりに __game.talk。会話の行送りと選択はタップ）
  const readThrough = async (choice) => {
    await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, POLL);
    for (let i = 0; i < 60; i++) {
      const u = await ui(page);
      if (!u || u.kind !== 'script' || u.choices?.length) break;
      await page.touchscreen.tap(120, 150);
      await sleep(220);
    }
    const u = await ui(page);
    if (u?.kind === 'script' && u.choices?.length) {
      await sleep(450);
      await page.locator(`.g-choice[data-id="${choice ?? u.choices[u.choices.length - 1]}"]`).tap();
    }
  };
  for (const id of ['oda_envoy', 'asai_envoy']) {
    await page.evaluate((i) => window.__game.talk(i), id);
    await readThrough(null);
    await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
  }
  await page.evaluate(() => window.__game.talk('tadakatsu'));
  await readThrough('open_council');
  await page.waitForFunction(() => window.__game.screen === 'council' && window.__game.ui?.kind === 'script', null, POLL);
  for (let i = 0; i < 40; i++) {
    const u = await ui(page);
    if (u.choices?.length) break;
    await page.touchscreen.tap(120, 150);
    await sleep(220);
  }
  const before = await ui(page);
  const lay = await page.evaluate(() => {
    const r = (e) => e.getBoundingClientRect();
    const b = r(document.querySelector('.g-council-map'));
    const hit = (x) => b.right > x.left && x.right > b.left && b.bottom > x.top && x.bottom > b.top;
    return { btn: { l: b.left, t: b.top, r: b.right, b: b.bottom }, choices: [...document.querySelectorAll('.g-choice')].some((c) => hit(r(c))), dialog: hit(r(document.querySelector('.g-dialog'))), head: hit(r(document.querySelector('.g-council-head'))), inView: b.top >= 0 && b.left >= 0 && b.right <= innerWidth, empty: b.left <= 120 && 120 <= b.right && b.top <= 150 && 150 <= b.bottom };
  });
  check('軍議の「地図で見る」は選択肢・台詞・見出しと重ならず、画面の中（844×390）。行送りのタップの所（120,150）とも別', !lay.choices && !lay.dialog && !lay.head && lay.inView && !lay.empty, J(lay));
  await page.screenshot({ path: `${OUT}/council-mapbtn-844x390.png` });
  await page.locator('.g-council-map').tap();
  await page.waitForFunction(() => window.__game.ui?.kind === 'situation', null, POLL);
  let s = await ui(page);
  check('本物の入力：「地図で見る」→ 情勢（軍議から・選択肢のタブ・いま選ばれている選択肢のタブ）', s.from === 'council' && J(s.options) === J(before.choices) && s.option === before.selected, J({ options: s.options, option: s.option, sel: before.selected }));
  const hl0 = s.highlight;
  const other = s.options.find((o) => o !== s.option);
  await sleep(450);
  await page.locator(`.g-sit-tab[data-option="${other}"]`).tap();
  await sleep(200);
  s = await ui(page);
  const phase = await page.evaluate(() => ({ phase: window.__game.state.phase, policy: window.__game.state.policy, screen: window.__game.screen }));
  check('タブを押すと強調が変わるだけ（閉じない・決めない）', s.kind === 'situation' && s.option === other && J(s.highlight) !== J(hl0) && phase.phase === 'council' && phase.policy === null, J({ option: s.option, hl: s.highlight, ...phase }));
  await page.screenshot({ path: `${OUT}/council-situation-tab-844x390.png` });
  await page.keyboard.press('Digit1');
  await sleep(150);
  check('キー：数字でタブを選ぶ', (await ui(page)).option === s.options[0]);
  await sleep(450);
  await page.locator('.g-layer[data-kind="situation"] .g-btn[data-id="close"]').tap();
  await page.touchscreen.tap(120, 150); // 閉じた直後の続けてのタップ（守りの中）
  await sleep(250);
  const after = await ui(page);
  check('閉じると軍議の同じ選択肢・同じ選び方（閉じたタップ・続けてのタップで決まらない）', after.kind === 'script' && J(after.choices) === J(before.choices) && after.selected === before.selected && (await page.evaluate(() => window.__game.state.phase)) === 'council', J({ kind: after.kind, sel: after.selected }));
  // J でも開いて Esc で閉じる
  await sleep(400);
  await page.keyboard.press('KeyJ');
  await page.waitForFunction(() => window.__game.ui?.kind === 'situation', null, POLL);
  await sleep(400);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, POLL);
  check('軍議で J → 情勢・Esc で閉じて軍議へ', (await page.evaluate(() => window.__game.screen)) === 'council');
  // 選ぶのは今までどおり選択肢（タップ）
  await sleep(450);
  const idBefore = (await ui(page)).id;
  await page.locator('.g-choice[data-id="policy_home"]').tap();
  // 確認の段（台詞を送ると「それで決める／考え直す」）
  await page.waitForFunction((id) => window.__game.ui?.kind === 'script' && window.__game.ui.id !== id, idBefore, POLL);
  for (let i = 0; i < 40; i++) {
    const u = await ui(page);
    if (u?.choices?.includes('confirm_policy')) break;
    await page.touchscreen.tap(120, 150);
    await sleep(220);
  }
  check('選ぶのは選択肢と確認だけ（情勢を見ても方針は決まらない）', (await page.evaluate(() => window.__game.state.policy)) === null);
  check('軍議で保存は書かない', Object.keys(await writes(page)).length === 0, J(await writes(page)));
  await ctx.close();
}

// ================================================================ reduce：動きを減らす（設定は押したときだけ書く）
if (PARTS.includes('reduce')) {
  console.log('--- reduce：動きを減らす（PC）');
  const { ctx, page } = await open();
  await sleep(600);
  await page.click('.g-btn[data-id="new:ieyasu1570"]');
  await waitCine(page);
  await sleep(500);
  const r0 = await cine(page);
  await clickBtn(page, 'reduce');
  const r1 = await cine(page);
  const pref = await page.evaluate((k) => localStorage.getItem(k), PREFS);
  check('本物の入力：「動きを減らす」で減らす・設定を 1 回だけ書く（3d-prefs）', r0.reduced === false && r1.reduced === true && JSON.parse(pref ?? '{}').reducedMotion === true && J(await writes(page)) === J({ [PREFS]: 1 }), J({ pref, w: await writes(page) }));
  await clickBtn(page, 'skip');
  await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
  // 読み込み直しても設定は残る（見直しの演出は減らしたまま）
  await page.reload();
  await page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
  check('読み込み直しても「動きを減らす」は残る', (await page.evaluate(() => window.__game.reducedMotion)) === true);
  await page.evaluate((k) => localStorage.removeItem(k), PREFS);
  await ctx.close();
  // 端末の設定（prefers-reduced-motion）に従う
  const { ctx: c2, page: p2 } = await open({ reducedMotion: 'reduce' });
  await sleep(600);
  await p2.click('.g-btn[data-id="new:ieyasu1570"]');
  await waitCine(p2);
  const rr = await cine(p2);
  check('設定が無ければ端末の prefers-reduced-motion に従う（書かない）', rr.reduced === true && Object.keys(await writes(p2)).length === 0, J(await writes(p2)));
  await c2.close();
}

// ================================================================ hidden：アプリ切り替え・窓が外れたら自動で一時停止。読み込み直しで止まらない
if (PARTS.includes('hidden')) {
  console.log('--- hidden：見えなくなったら自動で一時停止（模擬）・再読み込み');
  const { ctx, page } = await open();
  await sleep(600);
  await page.click('.g-btn[data-id="new:ieyasu1570"]');
  await waitCine(page);
  await sleep(1200);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const h1 = await cine(page);
  await sleep(1500);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(500);
  const h2 = await cine(page);
  const hint = await page.evaluate(() => !document.querySelector('.g-cine-hint').hidden);
  check('見えなくなると自動で一時停止（戻っても勝手には進まない・知らせを出す）', h1.paused && h2.paused && Math.abs(h2.t - h1.t) < 0.05 && hint, J({ t1: h1.t, t2: h2.t, hint }));
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await clickBtn(page, 'pause');
  await sleep(300);
  const h3 = await cine(page);
  check('「再開」で続きから', h3.state === 'playing' && h3.t > h2.t, `${h2.t} → ${h3.t}`);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(100);
  check('窓が外れる（blur）と自動で一時停止', (await cine(page)).paused === true);
  // 演出の途中で読み込み直す：タイトルへ（進行不能にならない）。はじめからの保存は無いので「はじめから」から
  await page.reload();
  await page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
  check('演出の途中で読み込み直すとタイトル（止まらない）', (await ui(page)).kind === 'title');
  await ctx.close();
}

// ================================================================ intro3d：描画を省かずに（3D を描きながら時計がどう進むか）
if (PARTS.includes('intro3d')) {
  console.log('--- intro3d：描画を省かずに導入を流す（3D の場面のコマと時計。このコンテナはソフトウェア描画）');
  const { ctx, page } = await open({}, '?q=low');
  await sleep(600);
  await page.click('.g-btn[data-id="new:ieyasu1570"]');
  await waitCine(page);
  // ページの中で、場面ごとの壁の時間とコマの数（requestAnimationFrame の回数）を数える
  await page.evaluate(() => {
    window.__cineLog = [];
    let last = -1;
    let frames = 0;
    const loop = () => {
      const c = window.__game.cine;
      frames++;
      if (c && c.beat !== last) {
        last = c.beat;
        window.__cineLog.push({ beat: c.beat, mode: c.mode, t: c.t, wall: performance.now() / 1000, frames });
      }
      if (c) requestAnimationFrame(loop);
      else window.__cineLog.push({ end: true, wall: performance.now() / 1000, frames });
    };
    requestAnimationFrame(loop);
  });
  await page.waitForFunction(() => window.__game.screen === 'explore', null, { timeout: 600000, polling: 1000 });
  const log = await page.evaluate(() => window.__cineLog);
  const rows = [];
  for (let i = 0; i + 1 < log.length; i++) {
    const a = log[i];
    const b = log[i + 1];
    rows.push(`${a.beat}(${a.mode}) 壁 ${(b.wall - a.wall).toFixed(1)}s・コマ ${b.frames - a.frames}`);
  }
  note(`描画あり：${rows.join(' / ')}`);
  check('描画ありでも最後まで流れて城下へ（3D の場面は 1 コマの上限 1 秒のため、毎秒 1 コマ未満の所では壁の時間が延びる）', log.some((x) => x.end), '');
  await page.screenshot({ path: `${OUT}/town-after-intro3d.png` });
  await ctx.close();
}

await browser.close();
console.log(`\n${failed === 0 ? '全部 OK' : `NG ${failed} 件`}（OK ${oks}）  [${secs()}]`);
process.exit(failed === 0 ? 0 : 1);
