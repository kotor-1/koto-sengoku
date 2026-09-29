// 第一章を、本物のキー・クリック・タッチで最初から最後まで通す（3D 版）。
//   A（PC・キー）：田代 × 勝利。支度で保存 → 開き直して続きから、戦後で保存 → 開き直して続きから、結末 → タイトル
//   B（PC・マウス）：大森 × 敗北。はじめから（前の保存の上書きの確認）→ 敗北の戦後（源蔵は負傷して座る）→ 盟友の庇護
//   C（スマホ横・タッチ）：独力 × 撤退。スティックで歩き、ボタン・会話・選択肢をタップ → 雌伏
// 合戦の画面（battle/entry.ts）が登録されていれば本物の合戦の画面が出る。開発ビルドで無いときは、テスト用の結果の選択（と明記した画面）で進める。
// 合戦の画面が出たときは、合戦の側の確認用の早送り（window.__battle.finish(result)）があればそれで終える。
// 使い方：開発サーバー（自動再読み込みなし）を起動して、BASE3D=http://localhost:8097 node e2e/proto3d-chapter1.mjs [出力先]
// 検証コンテナはソフトウェア描画で遅い（1 経路に数分）。見た目の確認ではなく、流れ・保存・操作の確認。
import { launchBrowser, outDir } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/chapter1/flow');
const BASE = process.env.BASE3D || 'http://localhost:8097';
const ONLY = process.env.ONLY || 'ABC';
// 検証コンテナのソフトウェア描画では 1 コマに数秒かかるので、既定では探索を撮影のときだけ描く（?render=manual。動き・入力・画面の部品はふだんどおり）。
// REALTIME=1 で毎フレーム描く（遅い）。
const MANUAL = !process.env.REALTIME;
const browser = await launchBrowser();
let failed = 0;
const T0 = Date.now();
const secs = () => `${((Date.now() - T0) / 1000).toFixed(0)}s`;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}  [${secs()}]`);
};
let lastPage = null;
const errors = [];

async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...opts });
  const page = await ctx.newPage();
  lastPage = page;
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await gotoTitle(page, true);
  return { ctx, page };
}
async function gotoTitle(page, first = false) {
  if (first) await page.goto(BASE + '/?q=low' + (MANUAL ? '&render=manual' : ''));
  else await page.reload();
  await page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, { timeout: 240000 });
}
const ui = (page) => page.evaluate(() => window.__game.ui);
const st = (page) => page.evaluate(() => {
  const g = window.__game;
  const s = g.state;
  return { screen: g.screen, phase: s?.phase ?? null, alliance: s?.alliance ?? null, relations: s?.relations ?? null, characters: s?.characters ?? null, troops: s?.troops ?? null, result: s?.battle?.result ?? null, ending: s?.ending ?? null, x: window.__p3.hero.x, z: window.__p3.hero.z, heading: window.__p3.hero.heading, prompt: g.prompt, err: g.lastError };
});
const waitUi = (page, kind) => page.waitForFunction((k) => window.__game.ui?.kind === k, kind, { timeout: 240000 });
const waitScreen = (page, s) => page.waitForFunction((k) => window.__game.screen === k, s, { timeout: 240000 });
const shot = async (page, name) => {
  console.log(`   撮影 ${name}  [${secs()}]`);
  // 探索の場面を今のカメラで描いてから撮る（合戦の場面は合戦の側が毎フレーム描く）
  if (MANUAL) await page.evaluate(() => { if (!document.body.classList.contains('mode-battle')) window.__p3.renderNow(); });
  return page.screenshot({ path: `${OUT}/${name}.png`, timeout: 240000 });
};
const castOf = (page) => page.evaluate(() => window.__game.cast);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 見回しのカメラの向き（yaw）に合わせて、目標への方向を画面の入力（右 ix・下 iy）に直す */
function toScreen(s, tx, tz) {
  const gx = tx - s.x;
  const gz = tz - s.z;
  const d = Math.hypot(gx, gz) || 1;
  return { ix: (Math.cos(s.yaw) * gx - Math.sin(s.yaw) * gz) / d, iy: (Math.sin(s.yaw) * gx + Math.cos(s.yaw) * gz) / d, d };
}
const pose = (page) => page.evaluate(() => ({ x: window.__p3.hero.x, z: window.__p3.hero.z, yaw: window.__p3.orbit.yaw, prompt: window.__game.prompt, ui: window.__game.ui?.kind ?? null }));

/** 本物のキー（WASD を押したり離したり）で目標へ歩く。done(s) が真になったら止める */
async function walkKeys(page, tx, tz, done) {
  const held = new Set();
  const setKeys = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  let s;
  for (let i = 0; i < 600; i++) {
    s = await pose(page);
    if (done(s)) break;
    const { ix, iy } = toScreen(s, tx, tz);
    const want = new Set();
    if (iy < -0.38) want.add('KeyW');
    if (iy > 0.38) want.add('KeyS');
    if (ix > 0.38) want.add('KeyD');
    if (ix < -0.38) want.add('KeyA');
    await setKeys(want);
    await sleep(100);
  }
  await setKeys(new Set());
  return s;
}

/** タッチのスティック（左半分）で目標へ歩く（CDP のタッチ。指 1 本を押したまま向きを変える） */
async function walkTouch(page, cdp, tx, tz, done) {
  const O = [150, 280];
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x, y, id: 1 })) });
  await touch('touchStart', [O]);
  let s;
  for (let i = 0; i < 600; i++) {
    s = await pose(page);
    if (done(s)) break;
    const { ix, iy } = toScreen(s, tx, tz);
    await touch('touchMove', [[O[0] + ix * 60, O[1] + iy * 60]]);
    await sleep(100);
  }
  await touch('touchEnd', []);
  return s;
}

/** 会話を、選択肢が出るか閉じるまで進める（press：1 行進める操作） */
async function readThrough(page, press) {
  for (let i = 0; i < 60; i++) {
    const u = await ui(page);
    if (!u || u.kind !== 'script' || u.choices.length) return u;
    await press();
    await sleep(220);
  }
  return ui(page);
}

// ---------------------------------------------------------------- A
async function runA() {
  console.log('--- A：PC・キー（田代 × 勝利。保存して開き直す）');
  const { ctx, page } = await open();
  await page.evaluate(() => localStorage.setItem('koto-sengoku/save', '{"2d":"keep"}'));
  await shot(page, 'A01-title');
  const t = await ui(page);
  check('タイトル：はじめから・つづきから（保存なしで押せない）・仮シナリオ', t.buttons.map((b) => b.id).join() === 'new,continue' && t.buttons[1].disabled && t.text.includes('仮シナリオ'));
  await page.keyboard.press('Enter');
  await waitScreen(page, 'explore');
  await page.waitForFunction(() => window.__game.cast.some((c) => c.model), null, { timeout: 240000 });
  let s = await st(page);
  check('はじめから：城下の探索、目的は源蔵と話す', s.phase === 'explore' && (await page.textContent('.g-hud')).includes('源蔵と話す'));
  await shot(page, 'A02-explore');
  // これまでの探索の操作がそのまま使える：マウスのドラッグで見回す、Shift で走る、歩く／走るのボタン
  {
    const y0 = await page.evaluate(() => window.__p3.orbit.yaw);
    await page.mouse.move(640, 300);
    await page.mouse.down();
    await page.mouse.move(700, 300, { steps: 3 });
    await page.mouse.move(760, 300, { steps: 3 });
    await page.mouse.up();
    const y1 = await page.evaluate(() => window.__p3.orbit.yaw);
    await page.mouse.move(640, 300);
    await page.mouse.down();
    await page.mouse.move(580, 300, { steps: 3 });
    await page.mouse.move(520, 300, { steps: 3 });
    await page.mouse.up();
    const y2 = await page.evaluate(() => window.__p3.orbit.yaw);
    check('探索：ドラッグで見回せる（右へ・左へ）', y1 < y0 - 0.3 && Math.abs(y2 - y0) < 0.05, `${y0.toFixed(2)} → ${y1.toFixed(2)} → ${y2.toFixed(2)}`);
    await page.keyboard.down('Shift');
    const ran = await page.evaluate(() => window.__p3.anim.running);
    await page.keyboard.up('Shift');
    await page.click('#run-btn');
    const btnRun = await page.evaluate(() => window.__p3.anim.runMode);
    await page.click('#run-btn');
    const btnWalk = await page.evaluate(() => window.__p3.anim.runMode);
    check('探索：Shift で走る・歩く／走るのボタンで切り替わる', ran && btnRun && !btnWalk);
    check('探索：主人公の見た目の比較のボタンは出ていない（?dev のときだけ）', !(await page.isVisible('#hero-btn')));
  }
  // 源蔵へ歩く（W などの本物のキー）
  const genzo = (await castOf(page)).find((c) => c.id === 'genzo');
  const p0 = await pose(page);
  await walkKeys(page, genzo.x, genzo.z, (q) => q.prompt === 'genzo');
  s = await st(page);
  check('キーで源蔵のそばへ歩くと「話す」が出る', s.prompt === 'genzo' && Math.hypot(s.x - p0.x, s.z - p0.z) > 2 && (await page.isVisible('.g-talk')), `(${s.x.toFixed(2)}, ${s.z.toFixed(2)})`);
  await shot(page, 'A03-talk-prompt');
  await page.keyboard.press('KeyE');
  await waitUi(page, 'script');
  const before = await pose(page);
  await page.keyboard.down('KeyW');
  await sleep(600);
  await page.keyboard.up('KeyW');
  const after = await pose(page);
  check('会話の間は W を押しても歩かない', Math.hypot(after.x - before.x, after.z - before.z) < 0.01);
  await shot(page, 'A04-dialog');
  let u = await readThrough(page, () => page.keyboard.press('Enter'));
  check('源蔵の会話の最後に「軍議を開く」', u.choices.join() === 'open_council,not_yet' && u.selected === 'open_council');
  await sleep(400);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.screen === 'council');
  u = await readThrough(page, () => page.keyboard.press('Space'));
  await shot(page, 'A05-council');
  check('軍議：田代・大森・独力の 3 つ', u.choices.join() === 'ally_tashiro,ally_omori,ally_alone');
  await sleep(400);
  await page.keyboard.press('Enter'); // 田代（最初に選ばれている）
  await page.waitForFunction(() => window.__game.ui?.id?.startsWith('council.confirm'));
  u = await readThrough(page, () => page.keyboard.press('Enter'));
  await sleep(400);
  await page.keyboard.press('Enter');
  await waitScreen(page, 'explore');
  s = await st(page);
  const cast = await castOf(page);
  check('軍議で田代に決める → 出陣の支度。田代の使者が城下に居る', s.phase === 'muster' && s.alliance === 'tashiro' && cast.some((c) => c.id === 'tashiro_envoy') && !cast.some((c) => c.id === 'omori_envoy'));
  await page.waitForFunction(() => window.__game.cast.some((c) => c.id === 'tashiro_envoy' && c.model), null, { timeout: 240000 });
  await shot(page, 'A06-muster');
  // 使者と話す（関係 +5）
  const envoy = cast.find((c) => c.id === 'tashiro_envoy');
  await walkKeys(page, envoy.x, envoy.z, (q) => q.prompt === 'tashiro_envoy');
  await page.keyboard.press('Enter');
  await waitUi(page, 'script');
  await readThrough(page, () => page.keyboard.press('Enter'));
  await waitScreen(page, 'explore');
  s = await st(page);
  check('支度：田代の使者と話すと関係 +5', s.relations.tashiro === 15);
  // メニューから保存（Esc → 保存する）
  const saveAt = await pose(page);
  await page.keyboard.press('Escape');
  await waitUi(page, 'menu');
  await sleep(400);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.ui?.kind === 'menu' && window.__game.ui.text.includes('保存しました'));
  await shot(page, 'A07-menu-saved');
  u = await ui(page);
  check('メニュー：保存して、読み戻して確かめた結果を出す', u.text.includes('読み戻して確かめました') && u.text.includes('田代家と組んだ'));
  await page.keyboard.press('Escape');
  await waitScreen(page, 'explore');
  // 開き直す → つづきから
  await gotoTitle(page);
  u = await ui(page);
  check('開き直すと、タイトルのつづきからに保存の段階', u.buttons[1].disabled === false && u.text.includes('出陣の支度'));
  await shot(page, 'A08-title-continue');
  await sleep(400);
  await page.keyboard.press('Enter'); // つづきから（最初に選ばれている）
  await waitScreen(page, 'explore');
  s = await st(page);
  check('つづきから：支度の段階・田代・関係・位置が戻る', s.phase === 'muster' && s.alliance === 'tashiro' && s.relations.tashiro === 15 && Math.hypot(s.x - saveAt.x, s.z - saveAt.z) < 0.01, `(${s.x.toFixed(2)}, ${s.z.toFixed(2)})`);
  // 城門へ歩く → 出陣の確認が自動で出る（最初は「まだ支度をする」）
  const gate = (await castOf(page)).find((c) => c.id === 'gate');
  await walkKeys(page, gate.x, gate.z, (q) => q.ui === 'script');
  u = await readThrough(page, () => page.keyboard.press('Enter'));
  check('城門へ行くと出陣の確認（最初は「まだ支度をする」）', u.choices.join() === 'depart,stay' && u.selected === 'stay');
  await shot(page, 'A09-gate');
  await sleep(400);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await finishBattle(page, 'victory', 'A10');
  await waitScreen(page, 'explore');
  s = await st(page);
  check('合戦の後：戦後（勝利）。関係 田代 +30・大森 -30', s.phase === 'aftermath' && s.result === 'victory' && s.relations.tashiro === 45 && s.relations.omori === -20);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('koto-sengoku/3d-chapter1')));
  check('戦後の自動保存', saved.point === 'aftermath' && saved.phase === 'aftermath');
  await page.waitForFunction(() => window.__game.cast.filter((c) => c.model).length >= 3, null, { timeout: 240000 });
  await shot(page, 'A11-aftermath');
  // 開き直す → 戦後から
  await gotoTitle(page);
  await sleep(400);
  await page.keyboard.press('Enter');
  await waitScreen(page, 'explore');
  s = await st(page);
  check('開き直すと戦後から（結果・関係もそのまま）', s.phase === 'aftermath' && s.result === 'victory' && s.relations.tashiro === 45);
  // 戦後の源蔵 → 結末
  const g2 = (await castOf(page)).find((c) => c.id === 'genzo');
  await walkKeys(page, g2.x, g2.z, (q) => q.prompt === 'genzo');
  await page.keyboard.press('KeyE');
  await waitUi(page, 'script');
  u = await readThrough(page, () => page.keyboard.press('Enter'));
  check('戦後の源蔵：締めくくるか（最初は「まだ皆と話す」）', u.choices.join() === 'end_chapter,not_yet' && u.selected === 'not_yet');
  await sleep(400);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await waitUi(page, 'ending');
  u = await ui(page);
  await shot(page, 'A12-ending');
  check('結末：山の盟約・記録・第一章 完（仮シナリオ）', u.text.includes('山の盟約') && u.text.includes('田代家と組んだ') && u.text.includes('勝利') && u.text.includes('第一章 完（仮シナリオ）'));
  await sleep(900);
  await page.keyboard.press('Enter');
  await waitUi(page, 'title');
  u = await ui(page);
  check('タイトルへ戻る。つづきからは章の結末', u.text.includes('章の結末'));
  const twoD = await page.evaluate(() => localStorage.getItem('koto-sengoku/save'));
  check('2D 版の保存はそのまま', twoD === '{"2d":"keep"}');
  await ctx.close();
}

/** 合戦：本物の合戦の画面なら、合戦の側の早送りで終える。無ければ開発用の仮の選択 */
async function finishBattle(page, result, prefix, tap = null) {
  await page.waitForFunction(() => window.__game.screen === 'battle' || window.__game.screen === 'explore', null, { timeout: 240000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('koto-sengoku/3d-chapter1')));
  check(`${prefix} 出陣前の自動保存`, saved?.point === 'departure' && saved?.phase === 'battle');
  await page.waitForFunction(() => window.__game.ui?.kind === 'devBattle' || document.body.classList.contains('mode-battle'), null, { timeout: 240000 });
  const u = await ui(page);
  if (u?.kind === 'devBattle') {
    await shot(page, `${prefix}-battle-dev`);
    console.log('   （合戦の画面が未登録：開発用の仮の選択で進める）');
    await sleep(400);
    if (tap) await tap(`.g-btn[data-id="${result}"]`);
    else await page.click(`.g-btn[data-id="${result}"]`);
  } else {
    // 本物の合戦の画面（battle/entry.ts）。説明を読んで始め、合戦の側の采配の台本で早送りする（開発ビルドの __battle）
    await page.waitForFunction(() => window.__battle?.active, null, { timeout: 240000 });
    await sleep(1500);
    await shot(page, `${prefix}-battle-briefing`);
    const got = await page.evaluate(async (r) => {
      const sc = await import('/src/battle/scripts.ts');
      const b = window.__battle;
      b.start();
      const a = window.__game.state.alliance;
      const script = r === 'victory' ? sc.planScript(a) : r === 'defeat' ? sc.hqAloneScript() : sc.retreatAt(5);
      for (let i = 0; i < 30 && !b.state.result; i++) b.fastForward(30, script);
      return b.state.result ? (b.state.result.result ?? b.state.result) : null;
    }, result);
    check(`${prefix} 合戦の画面（部隊単位）で ${result} まで進む`, got === result, `結果 ${JSON.stringify(got)}`);
    await page.waitForFunction(() => window.__battle.ui.resultShown, null, { timeout: 240000 });
    await sleep(800);
    await shot(page, `${prefix}-battle-result`);
    const btn = page.getByRole('button', { name: '続ける' });
    if (tap) {
      const b = await btn.boundingBox();
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    } else await btn.click();
  }
}

// ---------------------------------------------------------------- B
async function runB() {
  console.log('--- B：PC・マウス（大森 × 敗北）');
  const { ctx, page } = await open();
  // 前の保存がある状態を作る（A と独立に）
  await page.evaluate(() => { window.__game.setPhase('muster', 'tashiro'); });
  await waitScreen(page, 'explore');
  await page.evaluate(() => window.__game.openMenu());
  await waitUi(page, 'menu');
  await page.evaluate(() => window.__game.choose('save'));
  await page.waitForFunction(() => window.__game.ui?.text?.includes('保存しました'));
  const prev = await page.evaluate(() => localStorage.getItem('koto-sengoku/3d-chapter1'));
  await gotoTitle(page);
  await sleep(400);
  await page.click('.g-btn[data-id="new"]');
  await waitUi(page, 'confirm');
  await shot(page, 'B01-new-confirm');
  let u = await ui(page);
  check('はじめから：前の保存があれば確かめる（最初は「やめる」）', u.text.includes('上書き') && u.buttons.map((b) => b.id).join() === 'new,back');
  await sleep(400);
  await page.click('.g-btn[data-id="new"]');
  await waitScreen(page, 'explore');
  const archived = await page.evaluate(() => localStorage.getItem('koto-sengoku/3d-chapter1/previous'));
  check('前の保存は控えに残る', archived === prev);
  // 源蔵へ（キーで歩き、ボタンはマウス）
  await page.waitForFunction(() => window.__game.cast.some((c) => c.model), null, { timeout: 240000 });
  const genzo = (await castOf(page)).find((c) => c.id === 'genzo');
  await walkKeys(page, genzo.x, genzo.z, (q) => q.prompt === 'genzo');
  await page.click('.g-talk');
  await waitUi(page, 'script');
  u = await readThrough(page, () => page.mouse.click(640, 200));
  await sleep(400);
  await page.click('.g-choice[data-id="open_council"]');
  await page.waitForFunction(() => window.__game.screen === 'council');
  u = await readThrough(page, () => page.mouse.click(640, 200));
  await sleep(400);
  await page.click('.g-choice[data-id="ally_omori"]');
  await page.waitForFunction(() => window.__game.ui?.id?.startsWith('council.confirm'));
  await readThrough(page, () => page.mouse.click(640, 200));
  await sleep(400);
  await page.click('.g-choice[data-id="confirm_alliance"]');
  await waitScreen(page, 'explore');
  let s = await st(page);
  const cast = await castOf(page);
  check('大森に決める → 大森の使者が居る', s.alliance === 'omori' && cast.some((c) => c.id === 'omori_envoy'));
  const gate = cast.find((c) => c.id === 'gate');
  await walkKeys(page, gate.x, gate.z, (q) => q.ui === 'script');
  await readThrough(page, () => page.mouse.click(640, 200));
  await sleep(400);
  await page.click('.g-choice[data-id="depart"]');
  await finishBattle(page, 'defeat', 'B02');
  await waitScreen(page, 'explore');
  s = await st(page);
  check('敗北の戦後：源蔵は負傷（死亡ではない）、若殿は無事', s.phase === 'aftermath' && s.result === 'defeat' && s.characters.genzo === 'wounded' && s.characters.hero !== undefined);
  await page.waitForFunction(() => window.__game.cast.some((c) => c.id === 'genzo' && c.model), null, { timeout: 240000 });
  const c2 = await castOf(page);
  check('戦後の場面：負傷した源蔵は座っている', c2.find((c) => c.id === 'genzo')?.pose === 'sit');
  const g2 = c2.find((c) => c.id === 'genzo');
  await walkKeys(page, g2.x, g2.z, (q) => q.prompt === 'genzo');
  await shot(page, 'B03-aftermath-wounded');
  await page.click('.g-talk');
  await waitUi(page, 'script');
  u = await readThrough(page, () => page.mouse.click(640, 200));
  await sleep(400);
  await page.click('.g-choice[data-id="end_chapter"]');
  await waitUi(page, 'ending');
  u = await ui(page);
  await shot(page, 'B04-ending');
  check('結末：大森 × 敗北 → 盟友の庇護', u.text.includes('盟友の庇護') && u.text.includes('大森家と組んだ') && u.text.includes('敗北'));
  await sleep(900);
  await page.click('.g-btn[data-id="title"]');
  await waitUi(page, 'title');
  await ctx.close();
}

// ---------------------------------------------------------------- C
async function runC() {
  console.log('--- C：スマホ横・タッチ（独力 × 撤退）');
  const { ctx, page } = await open({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const cdp = await ctx.newCDPSession(page);
  const tap = async (sel) => {
    const b = await page.locator(sel).first().boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  };
  const tapScreen = () => page.touchscreen.tap(422, 120);
  await shot(page, 'C01-title');
  await sleep(400);
  await tap('.g-btn[data-id="new"]');
  await waitScreen(page, 'explore');
  await page.waitForFunction(() => window.__game.cast.some((c) => c.model), null, { timeout: 240000 });
  await shot(page, 'C02-explore');
  const genzo = (await castOf(page)).find((c) => c.id === 'genzo');
  const p0 = await pose(page);
  await walkTouch(page, cdp, genzo.x, genzo.z, (q) => q.prompt === 'genzo');
  let s = await st(page);
  check('スマホ：スティックで源蔵のそばへ歩くと「話す」が出る', s.prompt === 'genzo' && Math.hypot(s.x - p0.x, s.z - p0.z) > 2);
  await shot(page, 'C03-talk');
  await tap('.g-talk');
  await waitUi(page, 'script');
  await shot(page, 'C04-dialog');
  let u = await readThrough(page, tapScreen);
  await sleep(400);
  await tap('.g-choice[data-id="open_council"]');
  await page.waitForFunction(() => window.__game.screen === 'council');
  u = await readThrough(page, tapScreen);
  await shot(page, 'C05-council-choices');
  await sleep(400);
  await tap('.g-choice[data-id="ally_alone"]');
  await page.waitForFunction(() => window.__game.ui?.id?.startsWith('council.confirm'));
  await readThrough(page, tapScreen);
  await sleep(400);
  await tap('.g-choice[data-id="confirm_alliance"]');
  await waitScreen(page, 'explore');
  s = await st(page);
  const cast = await castOf(page);
  check('独力に決める → 使者は居ない', s.alliance === 'alone' && !cast.some((c) => c.id.endsWith('_envoy')));
  // メニュー（タップ）→ 保存 → 閉じる
  await tap('.g-menu-btn');
  await waitUi(page, 'menu');
  await sleep(400);
  await tap('.g-btn[data-id="save"]');
  await page.waitForFunction(() => window.__game.ui?.text?.includes('保存しました'));
  await shot(page, 'C06-menu');
  await tap('.g-btn[data-id="close"]');
  await waitScreen(page, 'explore');
  const gate = cast.find((c) => c.id === 'gate');
  await walkTouch(page, cdp, gate.x, gate.z, (q) => q.ui === 'script');
  await readThrough(page, tapScreen);
  await shot(page, 'C07-gate');
  await sleep(400);
  await tap('.g-choice[data-id="depart"]');
  await finishBattle(page, 'retreat', 'C08', tap);
  await waitScreen(page, 'explore');
  s = await st(page);
  check('撤退の戦後：関係は田代・大森とも変わらない', s.phase === 'aftermath' && s.result === 'retreat' && s.relations.tashiro === 10 && s.relations.omori === 10);
  const g2 = (await castOf(page)).find((c) => c.id === 'genzo');
  await walkTouch(page, cdp, g2.x, g2.z, (q) => q.prompt === 'genzo');
  await tap('.g-talk');
  await waitUi(page, 'script');
  await readThrough(page, tapScreen);
  await sleep(400);
  await tap('.g-choice[data-id="end_chapter"]');
  await waitUi(page, 'ending');
  await shot(page, 'C09-ending');
  u = await ui(page);
  check('結末：独力 × 撤退 → 雌伏', u.text.includes('雌伏') && u.text.includes('独力で戦った') && u.text.includes('撤退'));
  // 結末は指でなぞって読める（画面の外の「タイトルへ」まで）
  const scrolled = await page.evaluate(() => { const e = document.querySelector('.g-ending'); return e.scrollHeight > e.clientHeight; });
  if (scrolled) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 422, y: 300, id: 1 }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 422, y: 300 - i * 30, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
    const top = await page.evaluate(() => document.querySelector('.g-ending').scrollTop);
    check('スマホ：結末の画面を指でなぞって読める', top > 20, `scrollTop ${top}`);
  }
  await page.locator('.g-btn[data-id="title"]').scrollIntoViewIfNeeded();
  await sleep(900);
  await tap('.g-btn[data-id="title"]');
  await waitUi(page, 'title');
  await ctx.close();
}

try {
  if (ONLY.includes('A')) await runA();
  if (ONLY.includes('B')) await runB();
  if (ONLY.includes('C')) await runC();
} catch (e) {
  failed++;
  console.log('NG 途中で止まった：', e.message);
  if (lastPage) {
    try {
      console.log('   その時の状態', JSON.stringify(await st(lastPage)), JSON.stringify(await ui(lastPage)));
      await shot(lastPage, 'zz-stopped');
    } catch {}
  }
}
check('ページの誤り（例外・console.error）が無い', errors.length === 0, errors.slice(0, 5).join(' / '));
await browser.close();
console.log(failed ? `失敗 ${failed}` : 'すべて OK');
process.exit(failed ? 1 : 0);
