// 模擬戦（戦闘・指揮）のブラウザ確認。スマホ相当（タッチ）を主に、Mac 相当（キーボード・マウス）も確かめる。
//   - 源蔵との会話 →「模擬戦をする」→ 訓練場
//   - 指揮で時間が完全に止まる／指揮中の操作で若殿が動いたり攻撃したりしない
//   - 2 人の家臣に別々の命令（源蔵＝移動、新八＝攻撃）→ 再開で同時に動き、配置と行動が命令どおりに変わる
//   - 勝利・敗北・撤退 → 城へ戻る → 結果に応じた会話
//   - 結果の保存 → 再読み込み →「つづきから」で残っている／再挑戦は全員全快
//   - 2 本指（スティックを押したまま「指揮」）・画面を離れたときの自動停止
// 使い方: BASE=http://localhost:8080 node e2e/battle.mjs [出力先]
// 注意：開発サーバー（npm run dev）で動かす（状態を読むための window.__koto は開発時だけある）。
// ここで測る速さは実機の性能ではない（コンテナはソフトウェア描画で fps が低い）。条件がそろうまで待つ形で書いている。
import { BASE, launchBrowser, outDir } from './lib.mjs';

const S = outDir(process.argv[2]);
const browser = await launchBrowser();
let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}`);
};
const errors = [];
const T = 16;

async function open(touchDevice) {
  const ctx = await browser.newContext(touchDevice
    ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/');
  await page.waitForFunction(() => window.__koto?.game.scene.getScene('World')?.stats.readyMs > 0, null, { timeout: 60000 });
  await page.evaluate(() => localStorage.removeItem('koto-sengoku/save'));
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp };
}

// ---- ページ内の状態を読む ----
const snap = (page) => page.evaluate(() => {
  const b = window.__koto.app.getBattle();
  if (!b) return null;
  const s = b.session.state;
  return JSON.parse(JSON.stringify({
    time: s.time, paused: s.paused, outcome: s.outcome,
    units: s.units.map((u) => ({ id: u.id, x: u.x, y: u.y, hp: u.hp, down: u.down, order: u.order, cooldown: u.cooldown, swing: u.swing })),
  }));
});
const unitOf = (sn, id) => sn.units.find((u) => u.id === id);
const mode = (page) => page.evaluate(() => [...document.body.classList].find((c) => c.startsWith('mode-')));
/** 戦闘の出来事を記録する（BattleSession.step を包む）。再開後の最初の 1 歩の位置も残す。 */
const recordEvents = (page) => page.evaluate(() => {
  const s = window.__koto.app.getBattle().session;
  window.__ev = [];
  window.__firstStep = null;
  const orig = s.step.bind(s);
  s.step = (input, dt) => {
    const wasPaused = s.state.paused;
    const ev = orig(input, dt);
    for (const e of ev) window.__ev.push({ ...e, t: s.state.time });
    if (!wasPaused && !window.__firstStep && !s.state.paused) window.__firstStep = s.state.units.map((u) => ({ id: u.id, x: u.x, y: u.y }));
    return ev;
  };
});
const events = (page) => page.evaluate(() => window.__ev ?? []);
/** ワールド座標 → 画面（CSS px） */
const toScreen = (page, x, y) => page.evaluate(([x, y]) => {
  const g = window.__koto.game;
  const cam = g.scene.getScene('World').cameras.main;
  const r = g.canvas.getBoundingClientRect();
  return { x: r.left + (x - cam.worldView.x) * cam.zoom * (r.width / g.canvas.width), y: r.top + (y - cam.worldView.y) * cam.zoom * (r.height / g.canvas.height) };
}, [x, y]);
const waitFor = (page, fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 100 }).then(() => true, () => false);

/** 源蔵の隣へ立って話しかけ、選択肢が出たら「模擬戦をする」を選ぶ */
async function startBattle(page, touchDevice) {
  await page.evaluate(() => { const s = window.__koto.app.getSession(); s.state.player.x = 31 * 16 + 8; s.state.player.y = 10 * 16 + 8; s.state.player.facing = 'right'; });
  await waitFor(page, () => window.__koto.app.getSession().nearbyInteractable()?.target === 'retainer');
  for (let i = 0; i < 14 && !(await page.locator('#dialogue-choices').isVisible()); i++) {
    if (touchDevice) await page.tap('#action-btn'); else await page.keyboard.press('Space');
    await page.waitForTimeout(160);
  }
  if (touchDevice) await page.tap('#dialogue-choices button[data-index="0"]');
  else {
    await page.keyboard.press('ArrowUp'); // 既定は「今はやめておく」なので上へ
    await page.waitForTimeout(120);
    await page.keyboard.press('Space');
  }
  return waitFor(page, () => !!window.__koto.app.getBattle(), null, 10000);
}

/** 若殿を自動で戦わせる（本物の入力の経路 InputState を使う） */
const autopilot = (page, on) => page.evaluate((on) => {
  clearInterval(window.__auto);
  const app = window.__koto.app;
  if (!on) { app.input.releaseStick(); return; }
  window.__auto = setInterval(() => {
    const b = app.getBattle();
    if (!b || b.commanding) return;
    const s = b.session; const h = s.hero;
    const es = s.activeEnemies();
    if (!es.length || h.down) { app.input.releaseStick(); return; }
    const e = es.reduce((a, c) => (Math.hypot(a.x - h.x, a.y - h.y) < Math.hypot(c.x - h.x, c.y - h.y) ? a : c));
    const dx = e.x - h.x; const dy = e.y - h.y; const d = Math.hypot(dx, dy);
    if (d > 16) app.input.setStick({ x: dx / d, y: dy / d });
    else { app.input.setStick({ x: dx / d * 0.25, y: dy / d * 0.25 }); app.input.pressAction(); }
  }, 60);
}, on);

async function finishDebrief(page, touchDevice, word) {
  const ok = await waitFor(page, () => !document.getElementById('dialogue').hidden, null, 8000);
  const text = await page.evaluate(() => window.__koto.app.getSession().state.dialogue?.script.lines.map((l) => l.text).join(''));
  const pos = await page.evaluate(() => { const p = window.__koto.app.getSession().state.player; return { x: p.x, y: p.y }; });
  check(`城へ戻ると源蔵の隣に立ち、結果の会話が始まる（${word}）`, ok && !!text && text.includes(word) && Math.abs(pos.x - (31 * 16 + 8)) < 1, JSON.stringify(text?.slice(0, 30)));
  // 決定を連打しても模擬戦は始まらない（既定は「今はやめておく」）
  for (let i = 0; i < 14 && (await page.evaluate(() => !!window.__koto.app.getSession().state.dialogue)); i++) {
    if (touchDevice) await page.tap('#action-btn'); else await page.keyboard.press('Space');
    await page.waitForTimeout(140);
  }
  check('結果の会話を決定の連打で閉じても、模擬戦は勝手に始まらない', !(await page.evaluate(() => !!window.__koto.app.getBattle())) && (await mode(page)) === 'mode-play');
}

async function saveReloadContinue(page, touchDevice) {
  const tapOrClick = (sel) => (touchDevice ? page.tap(sel) : page.click(sel));
  await tapOrClick('#menu-btn');
  await page.waitForTimeout(250);
  await tapOrClick('#btn-save');
  await page.waitForTimeout(250);
  const status = await page.locator('#menu-status').innerText();
  await page.reload();
  await page.waitForFunction(() => window.__koto?.game.scene.getScene('World')?.stats.readyMs > 0, null, { timeout: 60000 });
  const saveInfo = await page.locator('#save-info').innerText();
  await tapOrClick('#btn-continue');
  await page.waitForTimeout(400);
  const rec = await page.evaluate(() => JSON.parse(JSON.stringify(window.__koto.app.getSession().state.battle)));
  await tapOrClick('#menu-btn');
  await page.waitForTimeout(250);
  const menuText = await page.locator('#menu-battle-info').innerText();
  await tapOrClick('#btn-close');
  await page.waitForTimeout(200);
  return { status, saveInfo, rec, menuText };
}

// =====================================================================
// スマホ相当（タッチ）
// =====================================================================
{
  const { ctx, page, cdp } = await open(true);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })) });
  await page.tap('#btn-new');
  await page.waitForTimeout(400);

  // ---- 会話の選択肢から模擬戦へ ----
  const started = await startBattle(page, true);
  const s0 = await snap(page);
  check('源蔵との会話で「模擬戦をする」を選ぶと、訓練場で模擬戦が始まる', started && (await mode(page)) === 'mode-battle' && s0.units.length === 7);
  check('人数：若殿 1・家臣 2・訓練相手 4、全員全快', s0.units.filter((u) => u.id.startsWith('trainee')).length === 4 && s0.units.every((u) => u.hp === { hero: 150, genzo: 70, shinpachi: 70 }[u.id] || (u.id.startsWith('trainee') && u.hp === 110)));
  await recordEvents(page);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${S}/b1-battle-touch.png` });

  // ---- 指揮：時間が完全に止まる ----
  await page.tap('#command-btn');
  const cmdOk = await waitFor(page, () => document.body.classList.contains('mode-command'), null, 5000);
  const c1 = await snap(page);
  await page.waitForTimeout(1500);
  const c2 = await snap(page);
  check('「指揮」で指揮画面になり、戦闘の時間が止まる', cmdOk && c1.paused && c1.time === c2.time, `time ${c1.time.toFixed(2)} → ${c2.time.toFixed(2)}`);
  check('指揮中は誰も動かず、体力・クールダウンも変わらない', JSON.stringify(c1.units) === JSON.stringify(c2.units));
  check('指揮中はスティックと攻撃ボタンを隠す', !(await page.locator('#touch-controls').isVisible()));
  await page.waitForTimeout(900); // カメラが寄り終わるのを待つ

  // ---- 指揮中の操作で若殿が動いたり攻撃したりしない ----
  const heroBefore = unitOf(c2, 'hero');
  const evCount = (await events(page)).length;
  const vp = page.viewportSize();
  for (const [x, y] of [[180, 300], [120, 330], [vp.width - 64, vp.height - 66], [vp.width / 2, vp.height / 2]]) {
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(120);
  }
  await page.tap('.cmd-ret[data-id="genzo"]');
  await page.tap('#cmd-orders button[data-order="hold"]');
  await page.tap('#cmd-orders button[data-order="follow"]');
  const c3 = await snap(page);
  check('指揮中に地図やボタンを押しても、若殿は動かず攻撃もしない', JSON.stringify(unitOf(c3, 'hero')) === JSON.stringify(heroBefore) && (await events(page)).length === evCount && c3.time === c2.time);

  // ---- 2 人に別々の命令：源蔵＝移動（左の中ほど）、新八＝攻撃（右端の訓練相手） ----
  const dest = { x: 45 * T + 8, y: 7 * T + 8 };
  await page.tap('.cmd-ret[data-id="genzo"]');
  await page.tap('#cmd-orders button[data-order="move"]');
  let p = await toScreen(page, dest.x, dest.y);
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(150);
  await page.tap('.cmd-ret[data-id="shinpachi"]');
  await page.tap('#cmd-orders button[data-order="attack"]');
  await page.waitForTimeout(150);
  const target = unitOf(await snap(page), 'trainee4');
  p = await toScreen(page, target.x, target.y - 12);
  await page.touchscreen.tap(p.x, p.y);
  await page.waitForTimeout(250);
  const c4 = await snap(page);
  const gOrder = unitOf(c4, 'genzo').order;
  const sOrder = unitOf(c4, 'shinpachi').order;
  check('源蔵に「移動」、新八に「攻撃」と別々の命令を出せる', gOrder.kind === 'move' && Math.hypot(gOrder.x - dest.x, gOrder.y - dest.y) < 10 && sOrder.kind === 'attack' && sOrder.targetId === 'trainee4', `${JSON.stringify(gOrder)} / ${JSON.stringify(sOrder)}`);
  check('命令を出している間も時間は止まったまま', c4.time === c2.time);
  check('画面に選択中の家臣・移動先・攻撃目標の表示が出る（指揮パネルの表示）', (await page.locator('.cmd-ret.selected').innerText()).includes('新八') && (await page.locator('.cmd-ret[data-id="genzo"] .ret-order').innerText()).includes('移動') && (await page.locator('.cmd-ret[data-id="shinpachi"] .ret-order').innerText()).includes('攻撃'));
  await page.screenshot({ path: `${S}/b2-command-orders-touch.png` });

  // 観察しやすいよう、若殿が先に倒れないようにしておく（家臣の動きを見るため。体力の仕組みは単体テストで確認）
  await page.evaluate(() => { window.__koto.app.getBattle().session.hero.hp = 100000; });
  const evAtResume = (await events(page)).length;
  await page.tap('#cmd-resume');
  const resumed = await waitFor(page, () => document.body.classList.contains('mode-battle') && !!window.__firstStep, null, 8000);
  const first = await page.evaluate(() => window.__firstStep);
  const movedIds = first ? first.filter((u) => { const b = unitOf(c4, u.id); return Math.hypot(u.x - b.x, u.y - b.y) > 0.01; }).map((u) => u.id) : [];
  check('「再開」で全員が同じフレームから動き出す', resumed && ['genzo', 'shinpachi', 'trainee1', 'trainee2', 'trainee3', 'trainee4'].every((id) => movedIds.includes(id)), movedIds.join(','));
  const heroFirst = first?.find((u) => u.id === 'hero');
  check('再開直後、若殿は勝手に動かない（指揮中の操作が残らない）', !!heroFirst && Math.hypot(heroFirst.x - heroBefore.x, heroFirst.y - heroBefore.y) < 0.01);

  const arrived = await waitFor(page, ([x, y]) => { const u = window.__koto.app.getBattle()?.session.unit('genzo'); return !!u && Math.hypot(u.x - x, u.y - y) < 14 && u.order?.kind === 'hold'; }, [gOrder.x, gOrder.y], 40000);
  const downT4 = await waitFor(page, () => window.__koto.app.getBattle()?.session.unit('trainee4').down, null, 60000);
  const ev = (await events(page)).slice(evAtResume); // 再開してからの出来事
  const downAt = ev.findIndex((e) => e.type === 'down' && e.unitId === 'trainee4');
  const shinHits = ev.slice(0, downAt < 0 ? ev.length : downAt).filter((e) => e.type === 'hit' && e.attackerId === 'shinpachi');
  const arriveAt = ev.findIndex((x) => x.type === 'orderChanged' && x.unitId === 'genzo');
  const genzoHitsBeforeArrive = ev.slice(0, arriveAt < 0 ? ev.length : arriveAt).filter((e) => e.type === 'hit' && e.attackerId === 'genzo');
  const c5 = await snap(page);
  const g5 = unitOf(c5, 'genzo');
  const sh5 = unitOf(c5, 'shinpachi');
  const gEv = ev.filter((e) => e.unitId === 'genzo' || e.attackerId === 'genzo' || e.targetId === 'genzo').map((e) => `${e.type}@${e.t.toFixed(1)}`).slice(0, 12).join(' ');
  check('源蔵は指定した場所へ移り、そこで待機に切り替わる（途中で寄り道して戦わない）', arrived && arriveAt >= 0 && genzoHitsBeforeArrive.length === 0, `源蔵 (${g5.x.toFixed(0)},${g5.y.toFixed(0)}) 目標 (${gOrder.x.toFixed(0)},${gOrder.y.toFixed(0)}) 命令 ${g5.order.kind}${arrived && arriveAt >= 0 && genzoHitsBeforeArrive.length === 0 ? '' : ` | 着く前の攻撃 ${genzoHitsBeforeArrive.length} 回 | ${gEv}`}`);
  check('新八は指定した訓練相手（四）だけを攻撃し、倒した', downT4 && shinHits.length > 0 && shinHits.every((e) => e.targetId === 'trainee4'), `新八の攻撃 ${shinHits.length} 回`);
  check('2 人の配置が命令どおり離れている', Math.hypot(g5.x - sh5.x, g5.y - sh5.y) > 60, `距離 ${Math.hypot(g5.x - sh5.x, g5.y - sh5.y).toFixed(0)}px`);
  await page.screenshot({ path: `${S}/b3-orders-result-touch.png` });

  // ---- 勝利 ----
  await page.evaluate(() => { window.__koto.app.getBattle().session.hero.hp = 150; });
  await autopilot(page, true);
  const won = await waitFor(page, () => document.body.classList.contains('mode-result'), null, 120000);
  await autopilot(page, false);
  const rv = await snap(page);
  check('訓練相手が全員戦闘不能になると「勝利」', won && rv.outcome === 'victory' && (await page.locator('#result-title').innerText()) === '勝利');
  await page.screenshot({ path: `${S}/b4-victory-touch.png` });
  const recV = await page.evaluate(() => window.__koto.app.getBattle().session.result());
  await page.tap('#btn-return');
  await finishDebrief(page, true, 'お見事');

  // ---- 保存 → 再読み込み → つづきから ----
  const sv1 = await saveReloadContinue(page, true);
  check('勝利の記録（家臣の戦闘不能を含む）が保存・再開後も残る', sv1.status.includes('保存しました') && sv1.rec.last?.outcome === 'victory' && sv1.rec.victories === 1 && JSON.stringify(sv1.rec.last.retainersDown) === JSON.stringify(recV.retainersDown), `${sv1.menuText} | ${sv1.saveInfo}`);

  // ---- 再挑戦 → 敗北 ----
  await startBattle(page, true);
  const r0 = await snap(page);
  check('再挑戦：新しい模擬戦は全員全快・始まったばかり（前の戦いの状態を引き継がない）', r0.time < 1.5 && r0.outcome === null && r0.units.every((u) => !u.down && (u.hp === { hero: 150, genzo: 70, shinpachi: 70 }[u.id] || (u.id.startsWith('trainee') && u.hp === 110))), `経過 ${r0.time.toFixed(2)} 秒`);
  await page.evaluate(() => { window.__koto.app.getBattle().session.hero.hp = 1; });
  const lost = await waitFor(page, () => document.body.classList.contains('mode-result'), null, 90000);
  check('若殿が戦闘不能になると「敗北」', lost && (await snap(page)).outcome === 'defeat' && (await page.locator('#result-title').innerText()) === '敗北');
  await page.screenshot({ path: `${S}/b5-defeat-touch.png` });
  await page.tap('#btn-return');
  await finishDebrief(page, true, '不覚');

  // ---- 再挑戦 → 2 本指（スティックを押したまま「指揮」）→ 撤退 ----
  await startBattle(page, true);
  await page.waitForTimeout(600);
  const heroPos = async () => { const u = unitOf(await snap(page), 'hero'); return { x: u.x, y: u.y }; };
  await touch('touchStart', [[150, 300, 1]]);
  await touch('touchMove', [[150, 250, 1]]);
  await page.waitForTimeout(700);
  const cmdBox = await page.locator('#command-btn').boundingBox();
  const h0 = await heroPos();
  await touch('touchStart', [[150, 250, 1], [cmdBox.x + cmdBox.width / 2, cmdBox.y + cmdBox.height / 2, 2]]);
  await touch('touchEnd', [[cmdBox.x + cmdBox.width / 2, cmdBox.y + cmdBox.height / 2, 2]]);
  await waitFor(page, () => document.body.classList.contains('mode-command'), null, 5000);
  const h1 = await heroPos();
  await touch('touchMove', [[150, 200, 1]]);
  await page.waitForTimeout(900);
  const h2 = await heroPos();
  check('スティックを押したまま「指揮」：指揮中は若殿が止まり、指を動かしても動かない', (await mode(page)) === 'mode-command' && Math.hypot(h2.x - h1.x, h2.y - h1.y) < 0.01 && Math.hypot(h1.x - h0.x, h1.y - h0.y) < 20, `歩いた ${Math.hypot(h1.x - h0.x, h1.y - h0.y).toFixed(1)}px → 指揮中 ${Math.hypot(h2.x - h1.x, h2.y - h1.y).toFixed(2)}px`);
  await page.tap('#cmd-resume');
  await page.waitForTimeout(900);
  const h3 = await heroPos();
  await touch('touchMove', [[150, 180, 1]]);
  await page.waitForTimeout(600);
  const h4 = await heroPos();
  check('再開後も、押したままの指では若殿は動かない（触り直しが必要）', Math.hypot(h4.x - h2.x, h4.y - h2.y) < 0.5 && Math.hypot(h3.x - h2.x, h3.y - h2.y) < 0.5, `${Math.hypot(h4.x - h2.x, h4.y - h2.y).toFixed(2)}px`);
  await touch('touchEnd', []);
  // 画面を離れたら自動で指揮（時間停止）
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  check('模擬戦中に画面を離れると、自動で指揮（時間停止）になる', await waitFor(page, () => document.body.classList.contains('mode-command'), null, 3000));
  await page.tap('#cmd-retreat');
  const confirmText = await page.locator('#cmd-retreat').innerText();
  await page.tap('#cmd-retreat');
  const retreated = await waitFor(page, () => document.body.classList.contains('mode-result'), null, 5000);
  check('「撤退」は 2 回押しで確定し、「撤退」の結果になる', confirmText.includes('もう一度') && retreated && (await snap(page)).outcome === 'retreat' && (await page.locator('#result-title').innerText()) === '撤退');
  await page.screenshot({ path: `${S}/b6-retreat-touch.png` });
  await page.tap('#btn-return');
  await finishDebrief(page, true, '引き際');

  const sv2 = await saveReloadContinue(page, true);
  check('勝利・敗北・撤退の回数と最後の結果が、保存・再開後も残る', sv2.rec.victories === 1 && sv2.rec.defeats === 1 && sv2.rec.retreats === 1 && sv2.rec.last.outcome === 'retreat' && sv2.menuText.includes('前回 撤退'), sv2.menuText);
  await page.screenshot({ path: `${S}/b7-after-continue-touch.png` });
  check('ページがスクロールしていない', JSON.stringify(await page.evaluate(() => [window.scrollX, window.scrollY])) === '[0,0]');
  await ctx.close();
}

// =====================================================================
// Mac 相当（キーボード・マウス）
// =====================================================================
{
  const { ctx, page } = await open(false);
  await page.click('#btn-new');
  await page.waitForTimeout(300);
  check('PC：会話の選択肢をキーボード（↑ と Space）で選んで模擬戦を始められる', await startBattle(page, false));
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(500);
  await page.keyboard.press('KeyC');
  await waitFor(page, () => document.body.classList.contains('mode-command'), null, 5000);
  const k1 = await snap(page);
  await page.waitForTimeout(600);
  const k2 = await snap(page);
  check('PC：C キーで指揮。矢印キーを押したままでも若殿は動かない', JSON.stringify(unitOf(k1, 'hero')) === JSON.stringify(unitOf(k2, 'hero')) && k1.time === k2.time);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(900);
  // 源蔵（選択中）：3 = 移動 → マウスで地点
  await page.keyboard.press('Digit3');
  const d = { x: 53 * T + 8, y: 10 * T + 8 };
  let p = await toScreen(page, d.x, d.y);
  await page.mouse.click(p.x, p.y);
  // Tab で新八 → 4 = 攻撃 → Esc で取り消し → 2 = 待機
  await page.keyboard.press('Tab');
  await page.keyboard.press('Digit4');
  const armed = await page.locator('#cmd-orders button.armed').count();
  await page.keyboard.press('Escape');
  const stillCmd = (await mode(page)) === 'mode-command';
  await page.keyboard.press('Digit2');
  const k3 = await snap(page);
  check('PC：数字キーで命令、Tab で家臣を切り替え、Esc で地図の選択を取り消せる',
    unitOf(k3, 'genzo').order.kind === 'move' && Math.hypot(unitOf(k3, 'genzo').order.x - d.x, unitOf(k3, 'genzo').order.y - d.y) < 10 && armed === 1 && stillCmd && unitOf(k3, 'shinpachi').order.kind === 'hold',
    `${JSON.stringify(unitOf(k3, 'genzo').order)} / ${JSON.stringify(unitOf(k3, 'shinpachi').order)}`);
  await page.screenshot({ path: `${S}/b8-command-pc.png` });
  await page.keyboard.press('KeyC');
  const back = await waitFor(page, () => document.body.classList.contains('mode-battle'), null, 5000);
  await page.waitForTimeout(1500);
  const k4 = await snap(page);
  check('PC：C キーで再開し、時間が進む', back && k4.time > k3.time);
  await page.screenshot({ path: `${S}/b9-resumed-pc.png` });
  await ctx.close();
}

console.log('errors:', JSON.stringify(errors));
if (errors.length) failed++;
console.log(failed ? `NG が ${failed} 件` : 'すべて OK');
await browser.close();
process.exit(failed ? 1 : 0);
