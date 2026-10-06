// 小さな城下町の確かめ（開発サーバー）：町を歩いて新しい場所を回る・物見・軍議所を映す・演出の 3D の出来事を通常速度の時計で流す。
// 依頼：docs/story-rpg-request.md【3】【4】【5】・設計 docs/story-rpg-design.md §1・§5・記録 docs/story-rpg-town.md。
//
// 確認の種類（出力の行にも書く）：
//   - 本物の入力：歩く（キーの W・A・S・D。カメラの向きに合わせて押す）・物見の「物見」（E）・見回し（マウスの引きずり・←→）・「調べる」（クリック）・
//     「終える」（Esc）・タイトルの「はじめから」・軍議の選択肢（クリック）。
//   - 描画の省略：walk・lookout・council は ?q=low&render=manual（探索の 3D を描かない。歩き・物見の時計は実時間）。画面写しのときだけ 1 コマ描く。
//   - 通常速度の時計・コマ落ち：intro3d・depart3d・replay3d は描画を省かずに演出を流す（画質「低」844×390）。演出の時計は実時間で進むが、
//     このコンテナは 3D を描くと毎秒 1 コマ未満で、1 コマの上限 1 秒のため 3D の場面の時計は実時間より遅れる（その割合を記録する）。
//     コマは CDP の画面の流し（screencast）で受け取り、止めずに保存する（page.screenshot は 10〜20 秒止まるので使わない）。
//   - 直接状態変更：__game.setIeyasuPhase／setIeyasu2Phase（段階から始める）・__game.talk（軍議まで歩く代わり）・__game.choose（出陣の確認）・
//     見張りの保存（2D・架空・演習）を入れる。歩く道は町の当たり判定から格子で探す（ページの中で layout.ts を読む）。
//   - 実機・性能：ここでは未確認（ソフトウェア描画）。
//
//   - entry（Version 21）：町の入口（town/spots.ts の ENTRY_POSE）から城門の前の本多忠勝まで、描画あり（画質「低」）で本物のキー（W）と見回しの引きずり
//     （マウス）で歩く。第一章（直接状態変更：探索の段階から）と、第二章（第一章の結末の保存 tests/fixtures/ieyasu-ch1-v3/ から本物のクリックで
//     「第二章へ進む」→「城下へ」→ 冒頭をスキップ）。途中のコマ（画面の流し）・歩いた実時間・描く量（三角形・描く回数）・見えた町の人々の数を記録する。
//
// PARTS（カンマ区切り。既定はすべて）：walk, lookout, council, intro3d, depart3d, replay3d, entry（ENTRY_CASES=ch1,ch2kept,ch2heavy,ch2declined で選ぶ。既定は ch1,ch2kept,ch2heavy。ENTRY_RUN=1 で走る）
// 使い方：自動再読み込みなしの開発サーバーを自分用のポートで起動して
//   (PORT=8093 setsid nohup npx vite --config proto3d/blender/tools/vite.nohmr.mjs > /tmp/vite-8093.log 2>&1 &)
//   BASE=http://localhost:8093 node e2e/town-smoke.mjs [出力先]
import { readFileSync, writeFileSync } from 'node:fs';
import { launchBrowser, outDir, skipCinematic } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/town-smoke');
const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8093';
const PARTS = (process.env.PARTS || 'walk,lookout,council,intro3d,depart3d,replay3d,entry').split(',').map((s) => s.trim()).filter(Boolean);
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
const POLL = { timeout: 600000, polling: 100 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => JSON.stringify(v);
const KEY = 'koto-sengoku/3d-ieyasu1570';
const SENT = { 'koto-sengoku/save': '{"2d":"keep"}', 'koto-sengoku/3d-chapter1': '{"sentinel":"fictional"}', 'koto-sengoku/3d-fields': '{"sentinel":"practice"}' };

async function open(query, viewport = { width: 844, height: 390 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.setDefaultTimeout(600000);
  page.on('pageerror', (e) => console.log(`   ！ページの誤り ${e.message.slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Couldn't load texture blob:/.test(m.text())) console.log(`   ！console ${m.text().slice(0, 200)}`); });
  await page.goto(BASE + '/' + query);
  await page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
  await page.evaluate(([s, k]) => {
    localStorage.clear();
    for (const [kk, v] of Object.entries(s)) localStorage.setItem(kk, v);
    localStorage.removeItem(k);
  }, [SENT, KEY]);
  await page.reload();
  await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, POLL);
  return { ctx, page };
}
const pose = (page) => page.evaluate(() => ({ x: window.__p3.hero.x, z: window.__p3.hero.z, heading: window.__p3.hero.heading, yaw: window.__p3.orbit.yaw, pitch: window.__p3.orbit.pitch, prompt: window.__game.prompt?.id ?? window.__game.prompt ?? null, screen: window.__game.screen }));
/** 人物の素材を読み終えるまで待つ（会話の相手が素材の形で立つ） */
const waitModels = (page) => page.waitForFunction(() => window.__game.cast.filter((c) => c.pose).every((c) => c.model || !['tadakatsu', 'oda_envoy', 'asai_envoy', 'ishikawa', 'envoy'].includes(c.id)) && window.__game.cast.length > 0, null, POLL);
/** 1 コマ描いて撮る（描画の省略のとき。撮るのは少なく） */
async function shot(page, file) {
  await page.evaluate(() => window.__p3.renderNow());
  await page.screenshot({ path: `${OUT}/${file}.png`, timeout: 300000 });
  note(`撮影 ${file}`);
}

// ================================================================ 歩く（本物のキー）
function toScreen(s, tx, tz) {
  const gx = tx - s.x;
  const gz = tz - s.z;
  const d = Math.hypot(gx, gz) || 1;
  return { ix: (Math.cos(s.yaw) * gx - Math.sin(s.yaw) * gz) / d, iy: (Math.sin(s.yaw) * gx + Math.cos(s.yaw) * gz) / d, d };
}
async function walkKeys(page, tx, tz, done, maxSteps = 400) {
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
/**
 * 町の当たり判定（layout.ts の colliders と、置いている人物の当たり判定）から、主人公の今の位置から (tx, tz) までの道を格子で探し、
 * 見通せる所をつないだ点の列を返す（ページの中で計算する）。
 */
const planPath = (page, tx, tz) => page.evaluate(async ([tx, tz]) => {
  const L = await import('/src/layout.ts');
  const M = await import('/src/game/motion.ts');
  const C = await import('/src/explore/cast.ts');
  const rects = [...L.colliders(), ...C.castColliders(window.__game.world.cast ?? []), ...(window.__game.world.ambientRects ?? [])];
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
  // 見通せる所まで飛ばす（線の上の点がどれも通れる）
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
async function walkTo(page, tx, tz, near = 0.6) {
  const path = await planPath(page, tx, tz);
  if (!path) throw new Error(`(${tx}, ${tz}) への道が無い`);
  for (const [x, z] of path) {
    const last = x === path[path.length - 1][0] && z === path[path.length - 1][1];
    await walkKeys(page, x, z, (s) => Math.hypot(s.x - x, s.z - z) < (last ? near : 0.45));
  }
  return pose(page);
}

// ================================================================ walk：町を歩いて新しい場所を回る（本物のキー・描画の省略）
let walkPage = null;
if (PARTS.includes('walk') || PARTS.includes('lookout')) {
  console.log('--- walk：開始の位置から新しい場所を歩いて回る（本物のキー・描画の省略 ?q=low&render=manual）');
  const { ctx, page } = await open('?q=low&render=manual');
  walkPage = { ctx, page };
  await page.evaluate(() => window.__game.setIeyasuPhase('explore', 'oda'));
  await waitModels(page);
  await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
  const amb = await page.evaluate(() => window.__game.world.ambientProbe());
  check('町の人々（第一章の始め）：荷運び 2・店の人 1・門番 2（負傷兵・援兵は無し）', amb.walkers.filter((w) => w.role === 'porter').length === 2 && amb.walkers.filter((w) => w.role === 'merchant').length === 1 && amb.figures === 2, J({ walkers: amb.walkers.map((w) => w.key), figures: amb.figures }));
  if (PARTS.includes('walk')) {
    const places = [
      ['南の通り（荷置き場の前）', -2.8, 11.6, 0.7],
      ['街道口（木戸の口）', 0, 16.0, 0.7],
      ['町家の写しの前', 3.4, 14.2, 0.7],
      ['路地を抜けて東', 11.3, 11.8, 0.8],
      ['詰所（筵のそば）', 12.2, -3.0, 0.8],
      ['城内の軍議所の口の前', 9.2, -22.4, 0.8],
      ['軍議所の中', 11.2, -22.6, 0.8],
    ];
    const t0 = Date.now();
    for (const [name, x, z, near] of places) {
      const t1 = Date.now();
      const s = await walkTo(page, x, z, near);
      check(`本物のキーで歩いて着く：${name}`, Math.hypot(s.x - x, s.z - z) < near + 0.1, `(${s.x.toFixed(2)}, ${s.z.toFixed(2)}) ${((Date.now() - t1) / 1000).toFixed(0)} 秒`);
      if (name.startsWith('詰所')) await shot(page, 'walk-guardpost');
    }
    note(`回るのにかかった時間 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
    // 櫓へまっすぐ北から歩き込んでも、櫓（当たり判定）を突き抜けない
    await walkTo(page, -6.9, 11.0, 0.5);
    const s0 = await pose(page);
    await walkKeys(page, -6.9, 16.5, () => false, 30);
    const s1 = await pose(page);
    check('物見櫓に向かって歩き続けても突き抜けない（梯子の前で止まる）', s1.z < 12.6 && s1.z > s0.z - 0.5, `${s0.z.toFixed(2)} → ${s1.z.toFixed(2)}`);
  }
  if (!PARTS.includes('lookout')) await ctx.close();
}

// ================================================================ lookout：物見（本物の入力）
if (PARTS.includes('lookout') && walkPage) {
  console.log('--- lookout：物見櫓の下で「物見」→ 見回す → 調べる → 終える（本物の入力・描画の省略）');
  const { ctx, page } = walkPage;
  const lk = (await page.evaluate(() => window.__game.cast)).find((c) => c.id === 'lookout');
  await walkTo(page, lk.x, lk.z - 0.6, 0.5);
  await page.waitForFunction(() => (window.__game.prompt?.id ?? window.__game.prompt) === 'lookout', null, { timeout: 60000, polling: 100 });
  // 歩きの勢いが止まるまで待つ（キーを離してから約 0.3 秒で止まる）
  await sleep(800);
  const before = await pose(page);
  const sBefore = await page.evaluate(() => JSON.parse(JSON.stringify(window.__game.state)));
  check('物見櫓の下で「物見」のボタンが出る（相手 lookout）', before.prompt === 'lookout' && (await page.evaluate(() => document.querySelector('.g-talk')?.textContent ?? '')).includes('物見'), await page.evaluate(() => document.querySelector('.g-talk')?.textContent ?? ''));
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__game.world.lookoutProbe()?.active && window.__game.screen === 'lookout', null, POLL);
  await sleep(1700);
  let pr = await page.evaluate(() => window.__game.world.lookoutProbe());
  const ui = await page.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none'; };
    const lz = document.getElementById('look-zone').getBoundingClientRect();
    const btns = [...document.querySelectorAll('.g-lookout-btn')].map((b) => { const r = b.getBoundingClientRect(); return { id: b.dataset.id, w: r.width, h: r.height, inView: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; });
    return { stick: vis('#stick-zone'), run: vis('#run-btn'), labels: vis('#npc-labels'), hud: vis('.g-hud'), lookZone: { l: lz.left, w: lz.width }, btns, body: document.body.className };
  });
  check('物見の間：スティック・走るボタン・人物の名札・目的の札を隠し、見回しの面は画面いっぱい。ボタンは押せる大きさ（44px 以上）で画面の中', !ui.stick && !ui.run && !ui.labels && !ui.hud && ui.lookZone.l === 0 && ui.lookZone.w >= 840 && ui.btns.length === 2 && ui.btns.every((b) => b.h >= 44 && b.w >= 88 && b.inView), J(ui));
  const cam = await page.evaluate(() => ({ y: window.__p3.camera.position.y, shot: window.__game.world.cameraShot }));
  check('カメラは櫓の上（目の高さ 7 m 以上）・主人公は描かない', cam.y > 7 && cam.shot?.hideHero === true, J(cam));
  // 「調べる」は印に向くまで押せない
  check('始めは印から 40° ずれていて「調べる」は押せない', pr.can === null && (await page.evaluate(() => document.querySelector('.g-lookout-btn.examine').disabled)), J({ can: pr.can, marks: pr.marks.map((m) => [m.id, m.diff.toFixed(2)]) }));
  // マウスの引きずりで、最初の印へ向く（右へ引きずると右＝時計回りへ向く。1px 0.0055 rad）
  const m0 = pr.marks[0];
  const dx = Math.round(m0.diff / 0.0055);
  await page.mouse.move(420, 200);
  await page.mouse.down();
  const n = Math.max(4, Math.ceil(Math.abs(dx) / 40));
  for (let i = 1; i <= n; i++) await page.mouse.move(420 + (dx * i) / n, 200);
  await page.mouse.up();
  await sleep(300);
  pr = await page.evaluate(() => window.__game.world.lookoutProbe());
  check(`本物の入力：引きずり ${dx}px で印「${m0.label}」へ向き、「調べる」が押せる`, pr.can === m0.id && Math.abs(pr.marks[0].diff) < 0.21, J({ can: pr.can, diff: pr.marks[0].diff }));
  await page.evaluate(() => window.__p3.renderNow());
  await page.screenshot({ path: `${OUT}/lookout-facing.png`, timeout: 300000 });
  note('撮影 lookout-facing（描画の省略中だが物見の差し替えのカメラで 1 コマ）');
  await page.click('.g-lookout-btn.examine');
  await sleep(200);
  pr = await page.evaluate(() => window.__game.world.lookoutProbe());
  check('本物の入力：「調べる」で印を記録（もう一度押しても増えない）', J(pr.examined) === J([m0.id]), J(pr.examined));
  await page.click('.g-lookout-btn.examine');
  check('同じ印は 1 回だけ', J((await page.evaluate(() => window.__game.world.lookoutProbe())).examined) === J([m0.id]));
  // ←→ のキーで見回す（押している間だけ回る）
  const h0 = pr.heading;
  await page.keyboard.down('ArrowRight');
  await sleep(1200);
  await page.keyboard.up('ArrowRight');
  await sleep(200);
  pr = await page.evaluate(() => window.__game.world.lookoutProbe());
  const turned = Math.atan2(Math.sin(pr.heading - h0), Math.cos(pr.heading - h0));
  check('本物の入力：→ を押している間、右（時計回り）へ見回す。主人公は動かない', turned > 0.3 && Math.hypot((await pose(page)).x - before.x, (await pose(page)).z - before.z) < 1e-6, `回った ${(turned * 180 / Math.PI).toFixed(0)}°`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__game.world.lookoutProbe() && window.__game.screen === 'explore', null, POLL);
  await sleep(300);
  const after = await pose(page);
  const res = await page.evaluate(() => ({ scout: window.__game.scout, shot: window.__game.world.cameraShot, body: document.body.className, bar: !!document.querySelector('.g-lookout-bar'), toast: document.querySelector('.g-toast')?.textContent ?? '', camY: window.__p3.camera.position.y }));
  check('Esc で終える：カメラは主人公の背後へ・操作の部品が戻る・主人公の位置と向きは同じ・物見の記録が状態に入る', res.shot === null && !res.bar && !res.body.includes('g-lookout') && res.camY < 3 && Math.hypot(after.x - before.x, after.z - before.z) < 1e-6 && after.heading === before.heading && J(res.scout) === J([m0.id]) && res.toast.includes('物見の記録'), J({ ...res, after, before: { x: before.x, z: before.z } }));
  const sAfter = await page.evaluate(() => JSON.parse(JSON.stringify(window.__game.state)));
  const strip = (s) => { const c = { ...s }; delete c.scout; delete c.playTimeSec; delete c.savedAt; return c; };
  check('物見は兵・信頼・段階を変えない（記録の欄 scout だけが増える）', J(strip(sAfter)) === J(strip(sBefore)) && sAfter.phase === 'explore');
  // 歩けるように戻った（本物のキー）
  const p0 = await pose(page);
  await page.keyboard.down('KeyS');
  await sleep(900);
  await page.keyboard.up('KeyS');
  const p1 = await pose(page);
  check('終えた後は本物のキーで歩ける', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.3, `${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(2)} m`);
  await ctx.close();
}

// ================================================================ council：軍議所を映す（描画の省略）
if (PARTS.includes('council')) {
  console.log('--- council：軍議の間は軍議所（陣幕）を映し、終わると戻す（__game.talk・選択肢は本物のクリック）');
  const { ctx, page } = await open('?q=low&render=manual');
  await page.evaluate(() => window.__game.setIeyasuPhase('explore', 'oda'));
  await waitModels(page);
  await page.evaluate(() => window.__game.talk('tadakatsu'));
  const ui = () => page.evaluate(() => window.__game.ui);
  for (let i = 0; i < 80; i++) {
    const u = await ui();
    if (u?.kind === 'script' && u.choices?.length) break;
    await page.mouse.click(120, 150);
    await sleep(220);
  }
  let u = await ui();
  if (u?.choices?.includes('open_council')) {
    await sleep(450);
    await page.click('.g-choice[data-id="open_council"]');
  }
  await page.waitForFunction(() => window.__game.screen === 'council', null, POLL);
  await sleep(300);
  const c1 = await page.evaluate(() => ({ shot: window.__game.world.cameraShot, cam: window.__p3.camera.position.toArray() }));
  check('軍議の間：カメラは軍議所（城内の東の陣幕）を映す', c1.shot && c1.shot.tx > 10 && c1.shot.tz < -18, J(c1));
  await page.evaluate(() => window.__p3.renderNow());
  await page.screenshot({ path: `${OUT}/council-hall.png`, timeout: 300000 });
  note('撮影 council-hall');
  // 方針を選んで確かめる（本物のクリック）
  for (let i = 0; i < 60 && (await page.evaluate(() => window.__game.screen)) === 'council'; i++) {
    u = await ui();
    if (u?.kind === 'script' && u.choices?.length) {
      const pick = u.choices.includes('confirm_policy') ? 'confirm_policy' : u.choices.find((c) => c.startsWith('policy_')) ?? u.choices[0];
      await sleep(450);
      await page.click(`.g-choice[data-id="${pick}"]`);
    } else await page.mouse.click(120, 150);
    await sleep(250);
  }
  await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
  const c2 = await page.evaluate(() => ({ shot: window.__game.world.cameraShot, camY: window.__p3.camera.position.y, phase: window.__game.state.phase }));
  check('軍議が終わるとカメラの差し替えを外す（主人公の背後へ）', c2.shot === null && c2.camY < 3 && c2.phase === 'muster', J(c2));
  await ctx.close();
}

// ================================================================ 演出の 3D の場面を通常速度の時計で流す（描画あり・画質「低」）
/** ページの中で毎コマの記録（実時間・演出の t・場面・出来事）を取る */
const startLog = (page) => page.evaluate(() => {
  window.__tlog = [];
  const loop = () => {
    const c = window.__game.cine;
    const s = window.__game.world.stageProbe();
    const h = window.__p3.hero;
    window.__tlog.push({ w: performance.now(), t: c?.t ?? null, beat: c?.beat ?? null, mode: c?.mode ?? null, state: c?.state ?? null, ev: s.event, st: s.t, people: s.people, figures: s.figures, hide: s.hiddenCast.length, hidden: s.hiddenCast.join(','), heroShown: s.shot ? !s.shot.hideHero : null, hx: h.x, hz: h.z });
    if (window.__tlogOn !== false) requestAnimationFrame(loop);
  };
  window.__tlogOn = true;
  requestAnimationFrame(loop);
});
const stopLog = (page) => page.evaluate(() => { window.__tlogOn = false; return { log: window.__tlog, origin: performance.timeOrigin }; });
/** CDP の画面の流し（止めずにコマを受け取る） */
async function startCast(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    frames.push({ ts: f.metadata.timestamp * 1000, data: f.data });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch { /* 閉じた後 */ }
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
  return { cdp, frames };
}
/** 記録から 3D の場面ごとの時計の進み（実時間に対する割合）とコマの数をまとめ、場面の中のコマを何枚か保存する */
function summarize(tag, log, origin, frames) {
  const stages = [];
  let cur = null;
  for (const r of log) {
    if (r.mode === 'stage' && r.t !== null) {
      if (!cur || cur.beat !== r.beat) {
        cur = { beat: r.beat, ev: r.ev, w0: r.w, t0: r.t, w1: r.w, t1: r.t, n: 1, people: r.people, figures: r.figures };
        stages.push(cur);
      } else {
        cur.w1 = r.w;
        cur.t1 = r.t;
        cur.n++;
        cur.people = Math.max(cur.people, r.people);
        cur.figures = Math.max(cur.figures, r.figures);
      }
    } else cur = null;
  }
  const saved = [];
  for (const s of stages) {
    const wall = (s.w1 - s.w0) / 1000;
    const clock = s.t1 - s.t0;
    note(`${tag}：3D の場面 ${s.beat}（${s.ev}）実時間 ${wall.toFixed(1)} 秒で時計 ${clock.toFixed(1)} 秒（${wall > 0 ? ((clock / wall) * 100).toFixed(0) : '-'}%）・記録したコマ ${s.n}・人 ${s.people}・兵 ${s.figures}`);
    // 画面の流しのコマ：場面の始め・中ほど・終わりの 3 枚
    const inBeat = frames.filter((f) => f.ts >= origin + s.w0 && f.ts <= origin + s.w1);
    const pick = inBeat.length <= 3 ? inBeat : [inBeat[0], inBeat[Math.floor(inBeat.length / 2)], inBeat[inBeat.length - 1]];
    pick.forEach((f, i) => {
      const file = `${OUT}/${tag}-beat${s.beat}-${s.ev}-${i}.jpg`;
      writeFileSync(file, Buffer.from(f.data, 'base64'));
      saved.push(file);
    });
    note(`${tag}：場面 ${s.beat} の画面の流しのコマ ${inBeat.length} 枚（保存 ${pick.length} 枚）`);
  }
  return stages;
}

if (PARTS.includes('intro3d')) {
  console.log('--- intro3d：第一章の導入を通常速度の時計で（描画あり・画質「低」844×390・コマ落ち）。本物の「はじめから」');
  const { ctx, page } = await open('?q=low');
  await page.waitForFunction(() => window.__game.world.ready, null, POLL);
  await sleep(600);
  await startLog(page);
  const { cdp, frames } = await startCast(page);
  const wall0 = Date.now();
  await page.click('.g-scn[data-scenario="ieyasu1570"] .g-btn[data-id="new:ieyasu1570"]');
  await page.waitForFunction(() => window.__game.ui?.kind === 'cine', null, POLL);
  // 第一章の冒頭（Version 21）：町の様子 → 使者の到着 → 家臣の報告。どれも主人公を町の入口に立たせて描く（記録から確かめる）
  const ENTRY = await page.evaluate(async () => (await import('/src/town/spots.ts')).ENTRY_POSE);
  await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
  const wall = (Date.now() - wall0) / 1000;
  await cdp.send('Page.stopScreencast');
  const { log, origin } = await stopLog(page);
  const stages = summarize('intro3d', log, origin, frames);
  const last = log.filter((r) => r.t !== null).at(-1);
  note(`導入の時計の終わり t=${last?.t}・実時間 ${wall.toFixed(0)} 秒・記録したコマ ${log.length}`);
  check('3D の場面は時計どおりに進んだ（場面の時刻 t が単調に増え、出来事の t も同じ）', stages.length >= 1 && stages.every((s) => s.t1 > s.t0), J(stages.map((s) => ({ beat: s.beat, t0: s.t0, t1: s.t1, n: s.n }))));
  const evs = [...new Set(log.filter((r) => r.mode === 'stage' && r.ev).map((r) => r.ev))];
  check('冒頭の 3D の場面の順：町の様子 → 使者の到着 → 家臣の報告', J(evs) === J(['town_life', 'envoys_arrive', 'retainer_report']), J(evs));
  const atEntry = (r) => Math.abs(r.hx - ENTRY.x) < 1e-6 && Math.abs(r.hz - ENTRY.z) < 1e-6;
  const inEv = (id) => log.filter((r) => r.mode === 'stage' && r.ev === id);
  check('町の様子・使者の到着・家臣の報告：主人公を描くカメラ（hideHero でない）で、主人公は町の入口に立つ', ['town_life', 'envoys_arrive', 'retainer_report'].every((id) => inEv(id).length > 0 && inEv(id).every((r) => r.heroShown === true && atEntry(r))), J(['town_life', 'envoys_arrive', 'retainer_report'].map((id) => [id, inEv(id).length, inEv(id).filter((r) => r.heroShown).length])));
  check('使者の到着：使者 2 人が歩き、会話の相手の使者は着くまで隠す', inEv('envoys_arrive').some((r) => r.people === 2 && r.hide === 2), J(inEv('envoys_arrive').map((r) => [r.people, r.hide]).slice(0, 4)));
  check('家臣の報告：家臣 1 人が来て、城門の前の忠勝はその間だけ隠す', inEv('retainer_report').every((r) => r.people === 1 && r.hidden === 'tadakatsu'), J(inEv('retainer_report').map((r) => [r.people, r.hidden]).slice(0, 3)));
  const end = await page.evaluate(() => ({ probe: window.__game.world.stageProbe(), shot: window.__game.world.cameraShot, hero: { x: window.__p3.hero.x, z: window.__p3.hero.z, h: window.__p3.hero.heading }, orbit: { yaw: window.__p3.orbit.yaw, pitch: window.__p3.orbit.pitch }, cast: window.__game.cast.filter((c) => c.id === 'tadakatsu') }));
  check('演出の後：出来事を片付け・カメラの差し替えを外し・主人公は町の入口で北向き（見回しは真後ろ yaw 0）・忠勝は城門の前の置き場所', !end.probe.active && end.probe.people === 0 && end.shot === null && Math.abs(end.hero.x - ENTRY.x) < 1e-6 && Math.abs(end.hero.z - ENTRY.z) < 1e-6 && Math.abs(end.hero.h - Math.PI) < 1e-6 && Math.abs(end.orbit.yaw) < 1e-6 && end.cast[0]?.z < -5, J(end));
  await ctx.close();
}

if (PARTS.includes('depart3d')) {
  console.log('--- depart3d：出陣の演出（城内で整い城門を出る隊列）を通常速度の時計で（描画あり・コマ落ち）。城門の「出陣」は __game.talk・確認は本物のクリック');
  const { ctx, page } = await open('?q=low');
  await page.evaluate(() => window.__game.setIeyasuPhase('muster', 'oda', { pledge: 'accept' }));
  await waitModels(page);
  const amb = await page.evaluate(() => window.__game.world.ambientProbe());
  check('支度の段階：出陣を待つ兵（城内）がいる', amb.spec?.groups?.some((g) => g.kind === 'preparing' && g.count > 0), J(amb.spec));
  await startLog(page);
  const { cdp, frames } = await startCast(page);
  await page.evaluate(() => window.__game.talk('gate'));
  for (let i = 0; i < 60; i++) {
    const u = await page.evaluate(() => window.__game.ui);
    if (u?.kind === 'cine') break;
    if (u?.kind === 'script' && u.choices?.length) {
      await sleep(450);
      const pick = u.choices.find((c) => /depart/.test(c)) ?? u.choices[0];
      await page.click(`.g-choice[data-id="${pick}"]`);
    } else if (u?.kind === 'script') await page.mouse.click(120, 150);
    await sleep(300);
  }
  await page.waitForFunction(() => window.__game.cine?.mode === 'stage' || window.__game.screen === 'battle', null, POLL);
  const mid = await page.evaluate(() => window.__game.world.stageProbe());
  check('出陣の 3D の場面：隊列（兵の形）が出て、城内の支度の兵は隠す', mid.event === 'column_depart' && mid.hiddenAmbient.includes('preparing'), J(mid));
  await page.waitForFunction(() => window.__game.cine?.mode !== 'stage', null, POLL);
  await cdp.send('Page.stopScreencast');
  const { log, origin } = await stopLog(page);
  summarize('depart3d', log, origin, frames);
  const end = await page.evaluate(() => window.__game.world.stageProbe());
  check('3D の場面を出ると出来事を片付ける', !end.active && end.figures === 0, J(end));
  await ctx.close();
}

if (PARTS.includes('replay3d')) {
  console.log('--- replay3d：情勢の「見直す」から帰還（負傷・旗）と第二章への移行（詰所の負傷兵・援兵・使い）を通常速度の時計で（描画あり・コマ落ち）');
  const { ctx, page } = await open('?q=low');
  // 第一章の戦後（負け）：帰還の見直し
  await page.evaluate(() => window.__game.setIeyasuPhase('aftermath', 'oda', 'defeat', { pledge: 'accept', pledgeResult: 'kept' }));
  await waitModels(page);
  const replay = async (moment, tag) => {
    await sleep(500);
    await page.keyboard.press('KeyJ');
    await page.waitForFunction(() => window.__game.ui?.kind === 'situation', null, POLL);
    const ids = await page.evaluate(() => [...document.querySelectorAll('.g-layer[data-kind="situation"] .g-btn[data-id^="replay:"]')].map((b) => b.dataset.id));
    check(`${tag}：情勢に「見直す」がある`, ids.includes(`replay:${moment}`), J(ids));
    if (!ids.includes(`replay:${moment}`)) return null;
    await startLog(page);
    const { cdp, frames } = await startCast(page);
    await sleep(450);
    await page.click(`.g-btn[data-id="replay:${moment}"]`);
    await page.waitForFunction(() => window.__game.ui?.kind === 'cine', null, POLL);
    await page.waitForFunction(() => window.__game.ui?.kind === 'situation', null, POLL);
    await cdp.send('Page.stopScreencast');
    const { log, origin } = await stopLog(page);
    const stages = summarize(tag, log, origin, frames);
    const end = await page.evaluate(() => ({ probe: window.__game.world.stageProbe(), shot: window.__game.world.cameraShot }));
    check(`${tag}：見直しの後は出来事を片付け、カメラの差し替えを外す`, !end.probe.active && end.shot === null, J(end));
    await sleep(450);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
    return stages;
  };
  const r1 = await replay('return', 'replay-return');
  if (r1) check('帰還の 3D の場面（column_return）が流れた', r1.some((s) => s.ev === 'column_return' && s.figures > 0), J(r1.map((s) => [s.ev, s.figures])));
  // 第二章の探索（第一章で負けて約束を守った）：第二章への移行の見直し
  await page.evaluate(() => window.__game.setIeyasu2Phase('explore', 'oda', { ch1Result: 'defeat', ch1Pledge: 'kept', heavy: true }));
  await waitModels(page);
  const amb = await page.evaluate(() => window.__game.world.ambientProbe());
  check('第二章の城下（第一章で損害大）：詰所に負傷兵がいる', amb.spec?.groups?.some((g) => g.kind === 'wounded' && g.count > 0), J(amb.spec));
  const r2 = await replay('ch2_intro', 'replay-ch2');
  if (r2) check('第二章への移行の 3D の場面（負傷兵・使い）が流れた', r2.some((s) => s.ev === 'wounded_rest' && s.figures > 0) && r2.some((s) => s.ev === 'messenger_arrive' && s.people > 0), J(r2.map((s) => [s.ev, s.people, s.figures])));
  await ctx.close();
}

// ================================================================ entry：町の入口から城門の前の忠勝まで、描画ありで本物のキーと見回しで歩く（Version 21）
if (PARTS.includes('entry')) {
  const CASES = (process.env.ENTRY_CASES || 'ch1,ch2kept,ch2heavy').split(',').map((x) => x.trim()).filter(Boolean);
  // ENTRY_RUN=1：Shift を押して走る（このコンテナは描画ありで 1 コマに数秒〜十数秒かかり、歩きは 1 コマ 0.14 m しか進まないので、時間を半分にする）
  const RUN = process.env.ENTRY_RUN === '1';
  const moveKeys = RUN ? ['ShiftLeft', 'KeyW'] : ['KeyW'];
  const keysDown = async (page) => { for (const k of moveKeys) await page.keyboard.down(k); };
  const keysUp = async (page) => { for (const k of [...moveKeys].reverse()) await page.keyboard.up(k); };
  const FIX = { ch2kept: 'oda_victory_kept', ch2heavy: 'oda_defeat_broken_heavy', ch2declined: 'home_retreat_declined' };
  for (const tag of CASES) {
    console.log(`--- entry/${tag}：町の入口から城門の前の忠勝へ、描画あり（画質「低」844×390）・本物のキー（${RUN ? 'Shift+W で走る' : 'W で歩く'}）と見回しの引きずり（マウス）`);
    const { ctx, page } = await open('?q=low');
    if (tag === 'ch1') {
      await page.evaluate(() => window.__game.setIeyasuPhase('explore', 'oda'));
      note('（直接状態変更）第一章の探索の段階から始めた（保存に位置が無い：町の入口から）');
    } else {
      const fixture = readFileSync(new URL(`../tests/fixtures/ieyasu-ch1-v3/${FIX[tag]}.json`, import.meta.url), 'utf8');
      await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, fixture]);
      await page.reload();
      await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, POLL);
      note(`（直接状態変更）第一章の結末の保存 ${FIX[tag]} を入れて読み込み直した。ここから本物のクリック`);
      await sleep(600);
      await page.click('.g-btn[data-id="continue:ieyasu1570"]');
      await page.waitForFunction(() => window.__game.ui?.kind === 'ending', null, POLL);
      await sleep(600);
      await page.click('.g-btn[data-id="next_chapter"]');
      await page.waitForFunction(() => window.__game.ui?.kind === 'record', null, POLL);
      await sleep(600);
      await page.click('.g-btn[data-id="to_town"]');
      await skipCinematic(page, { what: '第二章の冒頭', log: note });
    }
    await waitModels(page);
    await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
    // 描画ありでは最初のコマが重い（1 コマに数秒）。案内の印は毎コマの更新で決まるので、1 コマ進むまで待つ
    await page.waitForFunction(() => window.__game.world.guideProbe().mode !== null, null, { timeout: 180000, polling: 500 }).catch(() => undefined);
    await sleep(1500);
    const s0 = await page.evaluate(async () => ({ entry: (await import('/src/town/spots.ts')).ENTRY_POSE, hero: { x: window.__p3.hero.x, z: window.__p3.hero.z, h: window.__p3.hero.heading }, yaw: window.__p3.orbit.yaw, amb: window.__game.world.ambientProbe().spec, guide: window.__game.world.guideProbe() }));
    const groups = Object.fromEntries((s0.amb?.groups ?? []).map((g) => [g.kind, g.count]));
    check(`${tag}：探索の始めは町の入口（北向き・見回しは真後ろ）。案内の印は忠勝へ`, Math.abs(s0.hero.x - s0.entry.x) < 1e-6 && Math.abs(s0.hero.z - s0.entry.z) < 1e-6 && Math.abs(s0.yaw) < 1e-6 && s0.guide.id === 'tadakatsu' && !!s0.guide.mode, J({ hero: s0.hero, yaw: s0.yaw, guide: s0.guide }));
    note(`${tag}：町の人々 ${J(groups)}`);
    // 毎コマの記録（主人公の位置・見回し・描く量・描いた町の人々）
    await page.evaluate(() => {
      window.__wlog = [];
      const r = window.__p3.renderer;
      const loop = () => {
        const h = window.__p3.hero;
        const a = window.__game.world.ambientProbe();
        window.__wlog.push({ w: performance.now(), x: h.x, z: h.z, yaw: window.__p3.orbit.yaw, calls: r.info.render.calls, tris: r.info.render.triangles, people: a.peopleDrawn, figs: a.figuresDrawn, guide: window.__game.world.guideProbe().mode, prompt: window.__game.prompt?.id ?? window.__game.prompt ?? null });
        if (window.__wlogOn !== false) requestAnimationFrame(loop);
      };
      window.__wlogOn = true;
      requestAnimationFrame(loop);
    });
    const { cdp, frames } = await startCast(page);
    const talkShown = () => page.evaluate(() => { const b = document.querySelector('.g-talk'); return !!b && !b.hidden && b.dataset.target === 'tadakatsu'; });
    const hz = () => page.evaluate(() => window.__p3.hero.z);
    const lz = await page.evaluate(() => { const r = document.getElementById('look-zone').getBoundingClientRect(); return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.45 }; });
    const drag = async (dx) => {
      await page.mouse.move(lz.x, lz.y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) { await page.mouse.move(lz.x + (dx * i) / 6, lz.y); await sleep(60); }
      await page.mouse.up();
    };
    const wall0 = Date.now();
    const marks = [];
    // W を押して北へ。休み場の手前（z 6 あたり）で止まり、右（東）を見回して休み場・援兵を見て、真後ろへ戻してまた W
    await keysDown(page);
    for (let i = 0; i < 20000 && (await hz()) > 6.0; i++) await sleep(150);
    await keysUp(page);
    marks.push({ what: 'W で歩いて休み場の手前', w: Date.now() });
    await sleep(800);
    const yaw0 = await page.evaluate(() => window.__p3.orbit.yaw);
    await drag(120);
    const yawR = await page.evaluate(() => window.__p3.orbit.yaw);
    marks.push({ what: '右を見回す（引きずり +120px）', w: Date.now() });
    await sleep(5000);
    const seenR = await page.evaluate(() => window.__game.world.ambientProbe());
    marks.push({ what: '右を見ている', w: Date.now() });
    await drag(-120);
    const yawB = await page.evaluate(() => window.__p3.orbit.yaw);
    marks.push({ what: '見回しを戻す', w: Date.now() });
    check(`${tag}：見回しの引きずり（本物のマウス）で右を向き、戻した`, yawR < yaw0 - 0.4 && Math.abs(yawB - yaw0) < 0.05, `yaw ${yaw0.toFixed(2)} → ${yawR.toFixed(2)} → ${yawB.toFixed(2)}`);
    const wantFigs = (groups.wounded ? Math.min(9, groups.wounded) : 0) + (groups.reinforcement ?? 0);
    check(`${tag}：右を向くと、詰所の前の休み場の負傷兵（筵・土塀ぎわ）と援兵を描いている（町の人々の兵の形の数）`, seenR.figuresDrawn >= wantFigs, `描いた兵の形 ${seenR.figuresDrawn}・負傷兵 ${groups.wounded ?? 0}・援兵 ${groups.reinforcement ?? 0}`);
    await sleep(800);
    await keysDown(page);
    let ok = false;
    for (let i = 0; i < 40000; i++) {
      if (await talkShown()) { ok = true; break; }
      await sleep(150);
    }
    await keysUp(page);
    marks.push({ what: '忠勝の「話す」が出た', w: Date.now() });
    const wall = (Date.now() - wall0) / 1000;
    await cdp.send('Page.stopScreencast');
    const { log, origin } = await page.evaluate(() => { window.__wlogOn = false; return { log: window.__wlog, origin: performance.timeOrigin }; });
    const end = await page.evaluate(() => ({ x: window.__p3.hero.x, z: window.__p3.hero.z }));
    const walked = log.reduce((a, r, i) => (i ? a + Math.hypot(r.x - log[i - 1].x, r.z - log[i - 1].z) : 0), 0);
    check(`${tag}：本物のキーで町の入口から歩くと、城門の前の忠勝の「話す」が出る`, ok, `(${end.x.toFixed(2)}, ${end.z.toFixed(2)})・歩いた ${walked.toFixed(1)} m・実時間 ${wall.toFixed(0)} 秒（見回しの止まりを含む）・記録したコマ ${log.length}（${(log.length / wall).toFixed(2)} コマ/秒）`);
    const fin = await page.evaluate(() => window.__game.world.guideProbe());
    check(`${tag}：話せる所に着くと案内の印は消える`, fin.mode === null, J(fin));
    // 描く量（歩く間のコマの最小・最大）
    const calls = log.map((r) => r.calls).filter((v) => v > 0);
    const tris = log.map((r) => r.tris).filter((v) => v > 0);
    note(`${tag}：描く量（1 コマ。影の描画を含む）描く回数 ${Math.min(...calls)}〜${Math.max(...calls)}・三角形 ${Math.min(...tris).toLocaleString()}〜${Math.max(...tris).toLocaleString()}`);
    note(`${tag}：描いた町の人々（人の写し）の最大 ${Math.max(...log.map((r) => r.people))}・兵の形の最大 ${Math.max(...log.map((r) => r.figs))}`);
    // 画面の流しのコマ：入口・歩く途中（z 10・6）・右を見る・家臣の前
    const at = (pred) => log.find(pred);
    const picks = [
      ['a-entry', log[0]],
      ['b-z10', at((r) => r.z < 10)],
      ['c-z6', at((r) => r.z < 6.2)],
      ['d-look-right', at((r) => r.w + origin > marks[2].w - 300)],
      ['e-z0', at((r) => r.z < 0 && r.w + origin > marks[3].w)],
      ['f-talk', log[log.length - 1]],
    ];
    for (const [name, r] of picks) {
      if (!r) continue;
      const ts = origin + r.w;
      const f = frames.reduce((b, x) => (!b || Math.abs(x.ts - ts) < Math.abs(b.ts - ts) ? x : b), null);
      if (!f) continue;
      writeFileSync(`${OUT}/entry-${tag}-${name}.jpg`, Buffer.from(f.data, 'base64'));
      note(`撮影 entry-${tag}-${name}.jpg（主人公 (${r.x.toFixed(1)}, ${r.z.toFixed(1)})・描く回数 ${r.calls}・三角形 ${r.tris.toLocaleString()}）`);
    }
    await ctx.close();
  }
}

console.log(`\n結果：OK ${oks}・NG ${failed}（${secs()}）`);
await browser.close();
process.exit(failed ? 1 : 0);
