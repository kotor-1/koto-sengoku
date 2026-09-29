// 第一章を 1 つのゲームとして、本物のキー・クリック・タッチで最初から結末まで通す（3D 版・開発サーバー）。
// 合戦は本物の合戦の画面（battle/entry.ts）で、命令（選ぶ・移動・攻撃・防衛・待機・全軍撤退・指揮）はすべて画面の操作で出す。
// 合戦の中で「待つ」ところだけ、開発ビルドの早送り（window.__battle.fastForward）で縮める（ソフトウェア描画では実時間で数分かかるため）。
//
//   A（PC・キーとマウス）：田代 × 勝利（林を抜ける別働隊で敵本陣の横を突く）。保存と開き直しの確認もここで：
//        支度でメニューから保存 → 開き直して続きから（位置・関係・兵）
//        → 出陣（出陣前の自動保存）→ 合戦の説明の画面で開き直す → 続きから（出陣の確認の前・開始の位置・会話の済み印）
//        → もう一度出陣して勝つ → 戦後の自動保存 → 開き直して続きから（段階・結果・関係・兵・人物）→ 結末 → タイトル
//   B（PC・マウス）：大森 × 敗北（本陣だけで突っ込む）。はじめから（前の保存の上書きの確認・控え）→ 源蔵は負傷して座る → 敗北の結末
//   C（スマホ横 844×390・タッチ）：独力 × 全軍撤退。スティックで歩き、話す・会話・選択肢・メニュー・合戦の命令をすべてタップ → 雌伏
// 経路ごとに、合戦の部隊（所属・味方か敵か）・戦後の会話の id・関係・兵・人物・結末の id が違うことを確かめる。
//
// 使い方：自動再読み込みなしの開発サーバーを起動して
//   (PORT=8121 nohup npx vite --config proto3d/blender/tools/vite.nohmr.mjs > /tmp/vite-8121.log 2>&1 &)
//   BASE3D=http://localhost:8121 node e2e/chapter1-routes.mjs [出力先]   （ONLY=A などで絞る。REALTIME=1 で探索も毎フレーム描く＝とても遅い）
// 検証コンテナはソフトウェア描画で遅い（探索 1 コマ約 3 秒）。既定では探索を撮影のときだけ描く（?render=manual。動き・入力・画面の部品はふだんどおり）。
import { launchBrowser, outDir } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/chapter1/routes');
const BASE = process.env.BASE3D || 'http://localhost:8121';
const ONLY = process.env.ONLY || 'ABC';
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
const POLL = { timeout: 300000, polling: 250 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SAVE_KEY = 'koto-sengoku/3d-chapter1';

async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...opts });
  const page = await ctx.newPage();
  lastPage = page;
  page.setDefaultTimeout(300000);
  // 誤りは出た時刻と一緒に記録する（どの操作の最中かを後で追えるように）。
  // 開き直し（reload）の最中に、前のページで読み込みかけていた素材の画像が止まった知らせは、前のページの後始末なので誤りに数えない
  const onErr = (text) => {
    if (reloading && /Couldn't load texture blob:/.test(text)) {
      console.log(`   （開き直しで前のページの読み込みが止まった [${secs()}] ${text.slice(0, 120)}）`);
      return;
    }
    errors.push(text);
    console.log(`   ！ページの誤り [${secs()}] ${text.slice(0, 160)}`);
  };
  page.on('pageerror', (e) => onErr(e.message));
  page.on('console', (m) => { if (m.type() === 'error') onErr(m.text()); });
  await page.goto(BASE + '/?q=low' + (MANUAL ? '&render=manual' : ''));
  await waitTitle(page);
  return { ctx, page };
}
const waitTitle = (page) => page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
let reloading = false;
async function reloadToTitle(page) {
  // 最初の読み込み（場面の素材）が終わってから開き直す（遊ぶ人の開き直しも、ふつうは画面が出てから）
  await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, null, POLL);
  reloading = true;
  try {
    await page.reload();
  } finally {
    reloading = false;
  }
  await waitTitle(page);
}
const ui = (page) => page.evaluate(() => window.__game.ui);
const st = (page) => page.evaluate(() => {
  const g = window.__game;
  const s = g.state;
  return { screen: g.screen, phase: s?.phase ?? null, alliance: s?.alliance ?? null, relations: s?.relations ?? null, characters: s?.characters ?? null, troops: s?.troops ?? null, result: s?.battle?.result ?? null, reason: s?.battle?.reason ?? null, ending: s?.ending ?? null, talked: s?.talked ?? null, x: window.__p3.hero.x, z: window.__p3.hero.z, heading: window.__p3.hero.heading, prompt: g.prompt, err: g.lastError };
});
const saved = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), SAVE_KEY);
const waitUi = (page, kind) => page.waitForFunction((k) => window.__game.ui?.kind === k, kind, POLL);
const waitScreen = (page, s) => page.waitForFunction((k) => window.__game.screen === k, s, POLL);
const shot = async (page, name) => {
  console.log(`   撮影 ${name}  [${secs()}]`);
  // 探索の場面を今のカメラで描いてから撮る（合戦の場面は合戦の側が毎フレーム描く）
  if (MANUAL) await page.evaluate(() => { if (!document.body.classList.contains('mode-battle')) window.__p3.renderNow(); });
  return page.screenshot({ path: `${OUT}/${name}.png`, timeout: 300000 });
};
const castOf = (page) => page.evaluate(() => window.__game.cast);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

/** 会話を、選択肢が出るか閉じるまで進める（press：1 行進める操作）。見た台詞の id を返す */
async function readThrough(page, press) {
  let id = null;
  for (let i = 0; i < 60; i++) {
    const u = await ui(page);
    if (u?.kind === 'script') id = u.id;
    if (!u || u.kind !== 'script' || u.choices.length) return { ...(u ?? {}), seenId: id };
    await press();
    await sleep(220);
  }
  return { ...(await ui(page)), seenId: id };
}

/** 探索で相手へ歩いて話しかけ、最後まで読む（選択肢が出たらそこで止まる）。台詞の id を返す */
async function talkTo(page, id, how) {
  const c = (await castOf(page)).find((m) => m.id === id);
  if (!c) throw new Error(`${id} が居ない`);
  if (how.cdp) await walkTouch(page, how.cdp, c.x, c.z, (q) => q.prompt === id);
  else await walkKeys(page, c.x, c.z, (q) => q.prompt === id);
  await how.talk();
  await waitUi(page, 'script');
  return readThrough(page, how.next);
}

// ---------------------------------------------------------------- 合戦（本物の画面・実際の操作）

const bUi = (page) => page.evaluate(() => window.__battle.ui);
const unit = (page, id) => page.evaluate((id) => {
  const u = window.__battle.state.units.find((x) => x.id === id);
  return u && { id: u.id, side: u.side, clan: u.clan, name: u.name, x: u.x, z: u.z, order: u.order, status: u.status, present: u.present, engagedWith: u.engagedWith, arrived: u.arrived, seen: u.seenBy.ally, strength: u.strength };
}, id);
const screenOf = (page, id) => page.evaluate((id) => window.__battle.screenOf(id), id);
const groundXY = (page, x, z) => page.evaluate(([x, z]) => window.__battle.screenOfGround(x, z), [x, z]);
const center = (page, x, z, d) => page.evaluate(([x, z, d]) => window.__battle.centerOn(x, z, d), [x, z, d]);
/** 条件がそろうまで合戦を早送り（待つ時間だけを縮める。命令は出さない） */
async function ffUntil(page, cond, max = 480) {
  const step = cond === 'false' ? 5 : 0.5;
  for (let t = 0; t < max; t += step) {
    const r = await page.evaluate(([c, st]) => {
      const s = window.__battle.state;
      const U = (id) => s.units.find((u) => u.id === id);
      const ok = new Function('s', 'U', `return (${c});`)(s, U);
      if (ok || s.result) return { ok, t: s.t, result: s.result };
      window.__battle.fastForward(st);
      return null;
    }, [cond, step]);
    if (r) return r;
  }
  return { ok: false };
}
/** 押す（PC はマウス、スマホはタッチ） */
async function hit(page, phone, x, y) {
  if (phone) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await sleep(250);
}
async function hitEl(page, phone, locator) {
  if (phone) await locator.tap();
  else await locator.click();
  await sleep(250);
}
const onMap = (page, p) => page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.classList.contains('b-input'), [p.x, p.y]);
async function hitUnit(page, phone, id) {
  await sleep(600); // 表示の位置が落ち着くまで
  let p = await screenOf(page, id);
  if (!(await onMap(page, p))) {
    // UI（札・ボタン）に隠れているときは、その部隊へカメラを寄せてから押す（遊ぶ人も地図を動かして押す）
    const u = await unit(page, id);
    await center(page, u.x, u.z);
    await sleep(600);
    p = await screenOf(page, id);
  }
  await hit(page, phone, p.x, p.y);
}
async function hitGround(page, phone, x, z) {
  let p = await groundXY(page, x, z);
  if (!(await onMap(page, p))) {
    await center(page, x, z);
    await sleep(400);
    p = await groundXY(page, x, z);
  }
  await hit(page, phone, p.x, p.y);
}
const cmd = (page, text) => page.locator('.b-cmd', { hasText: text });
const card = (page, name) => page.locator('.b-card', { hasText: name });
async function frameOn(page, x, z, d = 260) {
  await center(page, x, z, d);
  await sleep(300);
}

/** 出陣を決めた直後：出陣前の自動保存と、合戦の説明の画面まで */
async function toBriefing(page, prefix) {
  await page.waitForFunction(() => window.__game.screen === 'battle', null, POLL);
  const sv = await saved(page);
  check(`${prefix} 出陣前の自動保存（段階 battle・位置は開始から）`, sv?.point === 'departure' && sv?.phase === 'battle' && sv?.explore === null, JSON.stringify({ point: sv?.point, phase: sv?.phase }));
  await page.waitForFunction(() => window.__battle?.active && window.__battle.ui.modal === 'briefing' && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
  await sleep(400);
  const units = await page.evaluate(() => window.__battle.state.units.map((u) => ({ id: u.id, side: u.side, clan: u.clan, name: u.name, strength: u.strength })));
  const brief = await page.locator('.b-brief-lines').textContent();
  return { units, brief, save: sv };
}

/** 結果の画面を確かめて「続ける」を押し、戦後の探索に戻る */
async function finishBattle(page, phone, prefix, want) {
  await page.waitForFunction(() => window.__battle.ui.resultShown, null, POLL);
  const r = await page.evaluate(() => window.__battle.state.result);
  const title = await page.locator('.b-result h2').textContent();
  check(`${prefix} 合戦の結果：${want}（${r.result} / ${r.reason} / ${r.elapsedSec.toFixed(0)} 秒）`, r.result === want, title);
  await shot(page, `${prefix}-result`);
  await hitEl(page, phone, page.locator('.b-primary', { hasText: '続ける' }));
  await page.waitForFunction(() => window.__game.screen === 'explore' && !document.body.classList.contains('mode-battle') && !document.getElementById('battle-ui'), null, POLL);
  return r;
}

// ---------------------------------------------------------------- A
async function runA() {
  console.log('--- A：PC・キーとマウス（田代 × 勝利。支度・出陣前・戦後で保存して開き直す）');
  const { ctx, page } = await open();
  // 2D 版の保存（触れてはいけない）
  await page.evaluate(() => localStorage.setItem('koto-sengoku/save', '{"2d":"keep"}'));
  await reloadToTitle(page);
  const kb = { talk: () => page.keyboard.press('KeyE'), next: () => page.keyboard.press('Enter') };
  await shot(page, 'A01-title');
  let u = await ui(page);
  check('タイトル：シナリオごとに はじめから・つづきから（保存なしで押せない）・仮シナリオ', u.buttons.map((b) => b.id).filter((id) => id !== 'practice').join() === 'new:ieyasu1570,continue:ieyasu1570,new:fictional,continue:fictional' && u.buttons[3].disabled && u.text.includes('仮シナリオ'));
  await sleep(400);
  // キーで架空の第一章の「はじめから」へ（押せない「つづきから」は飛ばす）
  await page.keyboard.press('ArrowDown');
  await sleep(100);
  await page.keyboard.press('Enter');
  await waitScreen(page, 'explore');
  await page.waitForFunction(() => window.__game.cast.some((c) => c.model), null, POLL);
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
    const p0 = await pose(page);
    await page.keyboard.down('Shift');
    await page.keyboard.down('KeyS');
    await sleep(700);
    const ran = await page.evaluate(() => ({ running: window.__p3.anim.running, speed: window.__p3.hero.speed }));
    await page.keyboard.up('KeyS');
    await page.keyboard.up('Shift');
    await sleep(500);
    const p1 = await pose(page);
    check('探索：Shift を押しながら歩くと走る（走りの速さ）・離すと止まる', ran.running && ran.speed > 2.5 && Math.hypot(p1.x - p0.x, p1.z - p0.z) > 0.8, `速さ ${ran.speed.toFixed(2)}`);
    await page.click('#run-btn');
    const btnRun = await page.evaluate(() => window.__p3.anim.runMode);
    await page.click('#run-btn');
    const btnWalk = await page.evaluate(() => window.__p3.anim.runMode);
    check('探索：歩く／走るのボタンで切り替わる', btnRun && !btnWalk);
    check('探索：主人公の見た目の比較のボタンは出ていない（?dev のときだけ）', !(await page.isVisible('#hero-btn')));
  }
  // 源蔵へ歩く（本物のキー）→ 「話す」→ E
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
  u = await readThrough(page, kb.next);
  check('源蔵（explore.genzo）の会話の最後に「軍議を開く」', u.seenId === 'explore.genzo' && u.choices.join() === 'open_council,not_yet' && u.selected === 'open_council');
  await sleep(400);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.screen === 'council', null, POLL);
  u = await readThrough(page, () => page.keyboard.press('Space'));
  await shot(page, 'A05-council');
  check('軍議：田代・大森・独力の 3 つ', u.choices.join() === 'ally_tashiro,ally_omori,ally_alone');
  // いったん大森を選んで「考え直す」→ 田代に決める（↓ で選び Enter）
  await sleep(400);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.ui?.id === 'council.confirm.omori', null, POLL);
  u = await readThrough(page, kb.next);
  await sleep(400);
  await page.keyboard.press('ArrowDown'); // 考え直す
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.ui?.id === 'council.again', null, POLL);
  u = await readThrough(page, kb.next);
  await sleep(400);
  await page.keyboard.press('Enter'); // 田代（最初に選ばれている）
  await page.waitForFunction(() => window.__game.ui?.id === 'council.confirm.tashiro', null, POLL);
  u = await readThrough(page, kb.next);
  await sleep(400);
  await page.keyboard.press('Enter');
  await waitScreen(page, 'explore');
  s = await st(page);
  let cast = await castOf(page);
  check('軍議で考え直して田代に決める → 出陣の支度。田代の使者が城下に居る（大森の使者は居ない）', s.phase === 'muster' && s.alliance === 'tashiro' && cast.some((c) => c.id === 'tashiro_envoy') && !cast.some((c) => c.id === 'omori_envoy'));
  await page.waitForFunction(() => window.__game.cast.some((c) => c.id === 'tashiro_envoy' && c.model), null, POLL);
  await shot(page, 'A06-muster');
  u = await talkTo(page, 'tashiro_envoy', kb);
  await waitScreen(page, 'explore');
  s = await st(page);
  check('支度：田代の使者（muster.tashiro_envoy）と話すと関係 +5', u.seenId === 'muster.tashiro_envoy' && s.relations.tashiro === 15);
  // ---- 保存 1：メニューから保存（Esc → 保存する）→ 開き直して続きから
  const saveAt = await pose(page);
  await page.keyboard.press('Escape');
  await waitUi(page, 'menu');
  await sleep(400);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.ui?.kind === 'menu' && window.__game.ui.text.includes('保存しました'), null, POLL);
  await shot(page, 'A07-menu-saved');
  u = await ui(page);
  check('メニュー：保存して、読み戻して確かめた結果を出す（状態の欄に田代・関係・兵）', u.text.includes('読み戻して確かめました') && u.text.includes('田代家と組んだ') && u.text.includes('田代家 +15'));
  const beforeReload = await st(page);
  await page.keyboard.press('Escape');
  await waitScreen(page, 'explore');
  await reloadToTitle(page);
  u = await ui(page);
  check('開き直すと、タイトルのつづきからに保存の段階（最初に選ばれている）', u.buttons.find((b) => b.id === 'continue:fictional').disabled === false && u.text.includes('出陣の支度'));
  await shot(page, 'A08-title-continue');
  await sleep(400);
  await page.keyboard.press('Enter');
  await waitScreen(page, 'explore');
  s = await st(page);
  check('つづきから（手動保存）：段階・陣営・関係・兵・人物・会話の済み印・位置が戻る',
    s.phase === 'muster' && s.alliance === 'tashiro' && same(s.relations, beforeReload.relations) && same(s.troops, beforeReload.troops) && same(s.characters, beforeReload.characters) && same(s.talked, beforeReload.talked) && Math.hypot(s.x - saveAt.x, s.z - saveAt.z) < 0.01,
    `(${s.x.toFixed(2)}, ${s.z.toFixed(2)}) 関係 ${JSON.stringify(s.relations)}`);
  // ---- 出陣 → 出陣前の自動保存 → 合戦の説明で開き直す
  let gate = (await castOf(page)).find((c) => c.id === 'gate');
  await walkKeys(page, gate.x, gate.z, (q) => q.ui === 'script');
  u = await readThrough(page, kb.next);
  check('城門へ行くと出陣の確認（最初は「まだ支度をする」）', u.seenId === 'muster.gate' && u.choices.join() === 'depart,stay' && u.selected === 'stay');
  await shot(page, 'A09-gate');
  await sleep(400);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  let b = await toBriefing(page, 'A10');
  check('合戦：田代と組んだので、田代騎馬隊は味方（遅れて林から）、大森槍隊は鷲尾方の敵', b.units.some((x) => x.id === 'a_tashiro' && x.side === 'ally' && x.clan === 'tashiro') && b.units.some((x) => x.id === 'e_omori' && x.side === 'enemy' && x.clan === 'omori' && x.name.includes('鷲尾方')) && !b.units.some((x) => x.id === 'a_omori' || x.id === 'e_tashiro'));
  check('合戦の説明：勝ち・負け・撤退の条件（敵本陣・士気・日没）を出す', /勝利/.test(b.brief) && /敗北/.test(b.brief) && /撤退/.test(b.brief) && /本陣/.test(b.brief), b.brief.slice(0, 80));
  await shot(page, 'A10-briefing');
  const departure = b.save;
  await reloadToTitle(page);
  u = await ui(page);
  check('合戦の途中で開き直す → タイトルのつづきからは「出陣前」の保存', !u.buttons.find((b) => b.id === 'continue:fictional').disabled && u.text.includes('出陣前'), u.text.slice(0, 120));
  await sleep(400);
  await page.keyboard.press('Enter');
  await waitScreen(page, 'explore');
  s = await st(page);
  check('つづきから（出陣前の自動保存）：出陣の確認の前（支度）・開始の位置・関係・兵・会話の済み印',
    s.phase === 'muster' && s.alliance === 'tashiro' && same(s.relations, departure.relations) && same(s.troops, departure.troops) && Math.hypot(s.x - 0.3, s.z + 1.5) < 0.01 && s.talked['muster.tashiro_envoy'] === true,
    `(${s.x.toFixed(2)}, ${s.z.toFixed(2)})`);
  // 使者とはもう話した（関係は二重に増えない）
  u = await talkTo(page, 'tashiro_envoy', kb);
  await waitScreen(page, 'explore');
  s = await st(page);
  check('使者と話し直すと、話し済みの台詞（関係は増えない）', u.seenId === 'muster.tashiro_envoy.again' && s.relations.tashiro === 15);
  gate = (await castOf(page)).find((c) => c.id === 'gate');
  await walkKeys(page, gate.x, gate.z, (q) => q.ui === 'script');
  await readThrough(page, kb.next);
  await sleep(400);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  b = await toBriefing(page, 'A11');

  // ---- 合戦（田代 × 勝利）：命令はすべてマウス・キー
  console.log('   合戦：田代騎馬隊で林を抜け、源蔵隊で先手を押さえ、騎馬で敵本陣の横を突く');
  await page.locator('.b-primary', { hasText: '合戦を始める' }).click();
  await sleep(300);
  let bu = await bUi(page);
  check('A 合戦：「合戦を始める」で始まる', bu.started && !bu.paused && bu.modal === null);
  const t0 = await page.evaluate(() => window.__battle.state.t);
  await page.waitForFunction((t) => window.__battle.state.t > t + 0.3, t0, POLL);
  check('A 合戦：敵味方が同時に動く（時間が進む）', true);
  await page.keyboard.press('Space');
  bu = await bUi(page);
  const tp = await page.evaluate(() => window.__battle.state.t);
  await sleep(800);
  check('A 合戦：Space で指揮（一時停止）。止まっている間は時間が進まない', bu.paused && (await page.evaluate(() => window.__battle.state.t)) === tp);
  // 源蔵隊・新八隊はその場で守る（キー 2・H）
  await page.keyboard.press('Digit2');
  await page.keyboard.press('KeyH');
  check('A 合戦：キー 2 で源蔵隊を選び H で防衛・待機', (await bUi(page)).selectedId === 'a_genzo' && (await unit(page, 'a_genzo')).order.type === 'hold');
  let r = await ffUntil(page, "U('a_tashiro').arrived", 80);
  check(`A 合戦：田代騎馬隊（別働隊）が林に着く（${r.t?.toFixed(1)} 秒）`, r.ok);
  await shot(page, 'A11-cavalry-arrived');
  await hitEl(page, false, card(page, '田代騎馬隊'));
  await frameOn(page, -110, -60, 260);
  await hitGround(page, false, -100, -135);
  const cav = await unit(page, 'a_tashiro');
  check('A 合戦：騎馬隊を選び、地面をクリックして林の北へ移動', cav.order.type === 'move' && Math.hypot(cav.order.x + 100, cav.order.z + 135) < 10, JSON.stringify(cav.order));
  r = await ffUntil(page, "U('a_tashiro').z < -60", 120);
  await hitEl(page, false, card(page, '源蔵隊'));
  await frameOn(page, 0, -20, 240);
  await hitEl(page, false, cmd(page, '攻撃'));
  await hitUnit(page, false, 'e_sente');
  check('A 合戦：源蔵隊で「攻撃」→ 鷲尾先手をクリック（正面を押さえる）', (await unit(page, 'a_genzo')).order.type === 'attack');
  r = await ffUntil(page, "Math.hypot(U('a_tashiro').x + 100, U('a_tashiro').z + 135) < 8 && U('e_sente').engagedWith === 'a_genzo'", 150);
  check(`A 合戦：騎馬隊が林の北の端に着き、先手が源蔵隊と組み合う（${r.t?.toFixed(1)} 秒）。敵はまだ騎馬隊に気づかない`, r.ok && !(await page.evaluate(() => window.__battle.state.units.find((u) => u.id === 'a_tashiro').seenBy.enemy)));
  await frameOn(page, -40, -100, 230);
  await shot(page, 'A12-before-charge');
  await hitEl(page, false, card(page, '田代騎馬隊'));
  await hitUnit(page, false, 'e_hq');
  check('A 合戦：騎馬隊を選んで敵本陣をクリック → 攻撃（側面へ回り込む）', (await unit(page, 'a_tashiro')).order.type === 'attack' && (await unit(page, 'a_tashiro')).order.targetId === 'e_hq');
  await page.keyboard.press('Space');
  check('A 合戦：Space で再開', !(await bUi(page)).paused);
  r = await ffUntil(page, "U('e_hq').engagedWith || U('e_hq').status !== 'ready'", 60);
  const flank = await page.evaluate(() => window.__battle.state.events.some((e) => (e.kind === 'flank' || e.kind === 'rear') && e.unitId === 'a_tashiro'));
  await frameOn(page, -20, -110, 200);
  await shot(page, 'A13-charge');
  check('A 合戦：騎馬隊が敵本陣の側面・背後を突いた（出来事の記録）', flank);
  r = await ffUntil(page, "U('e_omori').engagedWith === 'a_shinpachi'", 200);
  if (r.ok && !r.result) {
    await page.keyboard.press('Space');
    await hitEl(page, false, card(page, '若殿本陣'));
    await frameOn(page, 60, 60, 260);
    // 右クリックでも命令できる
    const p = await screenOf(page, 'e_omori');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await sleep(250);
    check('A 合戦：本陣を選び、新八隊に取り付いた大森勢を右クリックで攻撃', (await unit(page, 'a_hq')).order.type === 'attack');
    await page.keyboard.press('Space');
  }
  r = await ffUntil(page, 'false', 480);
  const outA = await finishBattle(page, false, 'A14', 'victory');
  await waitScreen(page, 'explore');
  s = await st(page);
  const svA = await saved(page);
  check('戦後（勝利）：関係 田代 +30（15→45）・大森 -30・鷲尾 -10、敵将は負傷', s.phase === 'aftermath' && s.result === 'victory' && s.relations.tashiro === 45 && s.relations.omori === -20 && s.relations.washio === -70 && s.characters.washio_gen === 'wounded', JSON.stringify(s.relations));
  const endA = Object.fromEntries(outA.units.filter((x) => x.side === 'ally' && x.clan === 'kotosaka').map((x) => [x.id, Math.round(x.endStrength)]));
  check('戦後：琴坂の兵は合戦の生き残り（本陣・源蔵・新八）', s.troops.honjin === endA.a_hq && s.troops.genzo === endA.a_genzo && s.troops.shinpachi === endA.a_shinpachi && s.troops.genzo < 500, JSON.stringify(s.troops));
  check('戦後の自動保存（戦後の段階・結果）', svA.point === 'aftermath' && svA.phase === 'aftermath' && svA.battle.result === 'victory');
  await page.waitForFunction(() => window.__game.cast.filter((c) => c.model).length >= 3, null, POLL);
  await shot(page, 'A15-aftermath');
  // ---- 開き直す → 戦後から
  const beforeReload2 = await st(page);
  await reloadToTitle(page);
  u = await ui(page);
  check('開き直すと、つづきからは戦後の保存', u.text.includes('戦後'));
  await sleep(400);
  await page.keyboard.press('Enter');
  await waitScreen(page, 'explore');
  s = await st(page);
  check('つづきから（戦後の自動保存）：段階・結果・関係・兵・人物が戻る', s.phase === 'aftermath' && s.result === 'victory' && same(s.relations, beforeReload2.relations) && same(s.troops, beforeReload2.troops) && same(s.characters, beforeReload2.characters));
  // 戦後の会話（結果と選択で変わる）
  u = await talkTo(page, 'shinpachi', kb);
  check('戦後の新八：aftermath.shinpachi.tashiro.victory', u.seenId === 'aftermath.shinpachi.tashiro.victory', u.seenId);
  await waitScreen(page, 'explore');
  u = await talkTo(page, 'tashiro_envoy', kb);
  check('戦後の田代の使者：aftermath.tashiro_envoy.victory', u.seenId === 'aftermath.tashiro_envoy.victory', u.seenId);
  await waitScreen(page, 'explore');
  u = await talkTo(page, 'genzo', kb);
  check('戦後の源蔵：aftermath.genzo.tashiro.victory、締めくくるか（最初は「まだ皆と話す」）', u.seenId === 'aftermath.genzo.tashiro.victory' && u.choices.join() === 'end_chapter,not_yet' && u.selected === 'not_yet', u.seenId);
  await sleep(400);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await waitUi(page, 'ending');
  u = await ui(page);
  s = await st(page);
  await shot(page, 'A16-ending');
  check('結末 tashiro_victory：山の盟約・記録（田代・勝利・関係）・第一章 完（仮シナリオ）', s.ending === 'tashiro_victory' && u.text.includes('山の盟約') && u.text.includes('田代家と組んだ') && u.text.includes('勝利') && u.text.includes('第一章 完（仮シナリオ）'));
  await sleep(900);
  await page.keyboard.press('Enter');
  await waitUi(page, 'title');
  u = await ui(page);
  check('タイトルへ戻る。つづきからは章の結末', u.text.includes('章の結末'));
  await reloadToTitle(page);
  await sleep(400);
  await page.keyboard.press('Enter');
  await waitUi(page, 'ending');
  check('開き直してつづきから → 結末の画面（同じ結末）', (await ui(page)).text.includes('山の盟約'));
  const twoD = await page.evaluate(() => localStorage.getItem('koto-sengoku/save'));
  check('2D 版の保存はそのまま', twoD === '{"2d":"keep"}');
  await ctx.close();
  return { ending: s.ending, relations: s.relations };
}

// ---------------------------------------------------------------- B
async function runB() {
  console.log('--- B：PC・マウス（大森 × 敗北：本陣だけで突っ込む）');
  const { ctx, page } = await open();
  // 前の保存がある状態を作る（A と独立に。はじめから → 城下でメニューの「保存する」をクリック）
  await sleep(400);
  await page.click('.g-btn[data-id="new:fictional"]');
  await waitScreen(page, 'explore');
  await page.click('.g-menu-btn');
  await waitUi(page, 'menu');
  await sleep(400);
  await page.click('.g-btn[data-id="save"]');
  await page.waitForFunction(() => window.__game.ui?.text?.includes('保存しました'), null, POLL);
  check('城下（軍議の前）でもメニューから保存できる', (await saved(page))?.phase === 'explore');
  const prev = await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY);
  await reloadToTitle(page);
  await sleep(400);
  await page.click('.g-btn[data-id="new:fictional"]');
  await waitUi(page, 'confirm');
  await shot(page, 'B01-new-confirm');
  let u = await ui(page);
  check('はじめから：前の保存があれば確かめる（最初は「やめる」）', u.text.includes('上書き') && u.buttons.map((x) => x.id).join() === 'new,back');
  await sleep(400);
  await page.click('.g-btn[data-id="new"]');
  await waitScreen(page, 'explore');
  check('前の保存は控えに残る', (await page.evaluate(() => localStorage.getItem('koto-sengoku/3d-chapter1/previous'))) === prev);
  await page.waitForFunction(() => window.__game.cast.some((c) => c.model), null, POLL);
  const mouse = { talk: () => page.click('.g-talk'), next: () => page.mouse.click(640, 200) };
  u = await talkTo(page, 'genzo', mouse);
  await sleep(400);
  await page.click('.g-choice[data-id="open_council"]');
  await page.waitForFunction(() => window.__game.screen === 'council', null, POLL);
  await readThrough(page, mouse.next);
  await sleep(400);
  await page.click('.g-choice[data-id="ally_omori"]');
  await page.waitForFunction(() => window.__game.ui?.id === 'council.confirm.omori', null, POLL);
  await readThrough(page, mouse.next);
  await sleep(400);
  await page.click('.g-choice[data-id="confirm_alliance"]');
  await waitScreen(page, 'explore');
  let s = await st(page);
  const cast = await castOf(page);
  check('大森に決める → 大森の使者が居る（田代の使者は居ない）', s.alliance === 'omori' && cast.some((c) => c.id === 'omori_envoy') && !cast.some((c) => c.id === 'tashiro_envoy'));
  u = await talkTo(page, 'genzo', mouse);
  check('支度の源蔵：muster.genzo.omori', u.seenId === 'muster.genzo.omori', u.seenId);
  await waitScreen(page, 'explore');
  const gate = cast.find((c) => c.id === 'gate');
  await walkKeys(page, gate.x, gate.z, (q) => q.ui === 'script');
  await readThrough(page, mouse.next);
  await sleep(400);
  await page.click('.g-choice[data-id="depart"]');
  const b = await toBriefing(page, 'B02');
  check('合戦：大森と組んだので、大森槍隊は最初から味方の右翼、田代騎馬隊は鷲尾方の敵', b.units.some((x) => x.id === 'a_omori' && x.side === 'ally' && x.clan === 'omori') && b.units.some((x) => x.id === 'e_tashiro' && x.side === 'enemy' && x.clan === 'tashiro' && x.name.includes('鷲尾方')) && !b.units.some((x) => x.id === 'a_tashiro' || x.id === 'e_omori'));
  await shot(page, 'B02-briefing');
  // 合戦（命令はマウス）：指揮ボタンで止め、本陣を地図でクリックして選び、先手をクリック → 本陣だけで突っ込む
  await page.locator('.b-primary', { hasText: '合戦を始める' }).click();
  await sleep(300);
  await page.locator('.b-pause').click();
  check('B 合戦：指揮ボタンで一時停止', (await bUi(page)).paused);
  await frameOn(page, 0, 20, 300);
  await hitUnit(page, false, 'a_hq');
  check('B 合戦：地図の若殿本陣をクリックして選ぶ', (await bUi(page)).selectedId === 'a_hq');
  await hitUnit(page, false, 'e_sente');
  check('B 合戦：本陣だけで鷲尾先手へ（敵をクリック）', (await unit(page, 'a_hq')).order.type === 'attack');
  await shot(page, 'B03-hq-alone');
  await page.locator('.b-seg', { hasText: '×2' }).click();
  check('B 合戦：速さ ×2', (await bUi(page)).speed === 2);
  await page.locator('.b-pause').click();
  await ffUntil(page, "U('a_hq').engagedWith", 120);
  await frameOn(page, 0, -40, 200);
  await shot(page, 'B04-melee');
  await ffUntil(page, 'false', 480);
  const out = await finishBattle(page, false, 'B05', 'defeat');
  const hq = out.units.find((x) => x.id === 'a_hq');
  check(`B 敗北の理由は本陣の敗走。本陣の兵 ${Math.round(hq.endStrength)} が残る（討死ではない）`, out.reason === 'ally_hq_routed' && hq.endStrength > 0);
  await waitScreen(page, 'explore');
  s = await st(page);
  const sv = await saved(page);
  check('敗北の戦後：源蔵は殿で負傷、若殿は無事（死亡ではない）、戦後の自動保存', s.phase === 'aftermath' && s.result === 'defeat' && s.characters.genzo === 'wounded' && s.characters.hero !== 'captured' && sv.point === 'aftermath');
  const omoriUnit = out.units.find((x) => x.id === 'a_omori');
  const sacrificed = omoriUnit.status === 'destroyed' || omoriUnit.endStrength < omoriUnit.startStrength * 0.4;
  const wantOmori = 10 - 10 + (sacrificed ? -15 : 0);
  check(`敗北の戦後：関係 大森 ${wantOmori}（敗北 -10${sacrificed ? '・捨て石 -15' : ''}）、田代 -30`, s.relations.omori === wantOmori && s.relations.tashiro === -20, JSON.stringify(s.relations));
  await page.waitForFunction(() => window.__game.cast.some((c) => c.id === 'genzo' && c.model), null, POLL);
  const c2 = await castOf(page);
  check('戦後の場面：負傷した源蔵は座っている', c2.find((c) => c.id === 'genzo')?.pose === 'sit');
  u = await talkTo(page, 'omori_envoy', mouse);
  const envoyKey = wantOmori >= 0 ? 'defeat_good' : 'defeat_bad';
  check(`戦後の大森の使者：aftermath.omori_envoy.${envoyKey}`, u.seenId === `aftermath.omori_envoy.${envoyKey}`, u.seenId);
  await waitScreen(page, 'explore');
  u = await talkTo(page, 'genzo', mouse);
  await shot(page, 'B06-aftermath-wounded');
  check('戦後の源蔵：aftermath.genzo.omori.defeat', u.seenId === 'aftermath.genzo.omori.defeat', u.seenId);
  await sleep(400);
  await page.click('.g-choice[data-id="end_chapter"]');
  await waitUi(page, 'ending');
  u = await ui(page);
  s = await st(page);
  await shot(page, 'B07-ending');
  const wantEnding = wantOmori >= 0 ? 'defeat_sheltered' : 'defeat_alone';
  check(`結末 ${wantEnding}（大森 × 敗北・関係 ${wantOmori}）`, s.ending === wantEnding && u.text.includes(wantOmori >= 0 ? '盟友の庇護' : '落ち延びる') && u.text.includes('大森家と組んだ') && u.text.includes('敗北'));
  await sleep(900);
  await page.click('.g-btn[data-id="title"]');
  await waitUi(page, 'title');
  await ctx.close();
  return { ending: s.ending, relations: s.relations };
}

// ---------------------------------------------------------------- C
async function runC() {
  console.log('--- C：スマホ横・タッチ（独力 × 全軍撤退。命令もすべてタップ）');
  const { ctx, page } = await open({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const cdp = await ctx.newCDPSession(page);
  const tap = async (sel) => {
    const b = await page.locator(sel).first().boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  };
  const touch = { cdp, talk: () => tap('.g-talk'), next: () => page.touchscreen.tap(422, 120) };
  await shot(page, 'C01-title');
  await sleep(400);
  await tap('.g-btn[data-id="new:fictional"]');
  await waitScreen(page, 'explore');
  await page.waitForFunction(() => window.__game.cast.some((c) => c.model), null, POLL);
  await shot(page, 'C02-explore');
  const p0 = await pose(page);
  let u = await talkTo(page, 'genzo', touch);
  let s = await st(page);
  check('スマホ：スティックで源蔵へ歩き、「話す」をタップ → 会話をタップで進める', u.seenId === 'explore.genzo' && Math.hypot(s.x - p0.x, s.z - p0.z) > 2);
  await sleep(400);
  await tap('.g-choice[data-id="open_council"]');
  await page.waitForFunction(() => window.__game.screen === 'council', null, POLL);
  await readThrough(page, touch.next);
  await shot(page, 'C03-council-choices');
  await sleep(400);
  await tap('.g-choice[data-id="ally_alone"]');
  await page.waitForFunction(() => window.__game.ui?.id === 'council.confirm.alone', null, POLL);
  await readThrough(page, touch.next);
  await sleep(400);
  await tap('.g-choice[data-id="confirm_alliance"]');
  await waitScreen(page, 'explore');
  s = await st(page);
  const cast = await castOf(page);
  check('独力に決める → 使者は居ない', s.alliance === 'alone' && !cast.some((c) => c.id.endsWith('_envoy')));
  u = await talkTo(page, 'shinpachi', touch);
  check('支度の新八：muster.shinpachi.alone', u.seenId === 'muster.shinpachi.alone', u.seenId);
  await waitScreen(page, 'explore');
  // メニュー（タップ）→ 保存 → 閉じる
  await tap('.g-menu-btn');
  await waitUi(page, 'menu');
  await sleep(400);
  await tap('.g-btn[data-id="save"]');
  await page.waitForFunction(() => window.__game.ui?.text?.includes('保存しました'), null, POLL);
  check('スマホ：メニューをタップして保存（読み戻して確かめた）', (await ui(page)).text.includes('読み戻して確かめました'));
  await shot(page, 'C04-menu');
  await tap('.g-btn[data-id="close"]');
  await waitScreen(page, 'explore');
  const gate = cast.find((c) => c.id === 'gate');
  await walkTouch(page, cdp, gate.x, gate.z, (q) => q.ui === 'script');
  await readThrough(page, touch.next);
  await shot(page, 'C05-gate');
  await sleep(400);
  await tap('.g-choice[data-id="depart"]');
  const b = await toBriefing(page, 'C06');
  check('合戦：独力なので、味方は琴坂の予備隊、敵は鷲尾の予備隊（田代・大森の部隊は居ない）', b.units.some((x) => x.id === 'a_reserve' && x.side === 'ally' && x.clan === 'kotosaka') && b.units.some((x) => x.id === 'e_reserve' && x.side === 'enemy') && !b.units.some((x) => x.clan === 'tashiro' || x.clan === 'omori'));
  await shot(page, 'C06-briefing');
  // 合戦（タップ）：始める → 指揮で止める → 札で源蔵隊 → 地面をタップして移動 → 防衛・待機 → 地図の新八隊をタップ → 「移動」→ 地面
  await hitEl(page, true, page.locator('.b-primary', { hasText: '合戦を始める' }));
  check('C 合戦：「合戦を始める」をタップ', (await bUi(page)).started);
  await hitEl(page, true, page.locator('.b-pause'));
  check('C 合戦：「指揮」をタップして一時停止', (await bUi(page)).paused);
  await hitEl(page, true, card(page, '源蔵隊'));
  check('C 合戦：部隊の札をタップして源蔵隊を選ぶ', (await bUi(page)).selectedId === 'a_genzo');
  await frameOn(page, 0, 50, 230);
  await hitGround(page, true, -25, 45);
  let g = await unit(page, 'a_genzo');
  check('C 合戦：地面をタップして源蔵隊を移動', g.order.type === 'move' && Math.hypot(g.order.x + 25, g.order.z - 45) < 8, JSON.stringify(g.order));
  await hitEl(page, true, cmd(page, '防衛・待機'));
  check('C 合戦：「防衛・待機」をタップ', (await unit(page, 'a_genzo')).order.type === 'hold');
  await hitUnit(page, true, 'a_shinpachi');
  check('C 合戦：地図の新八隊をタップして選ぶ', (await bUi(page)).selectedId === 'a_shinpachi');
  // 引いた画面（「全体」）で、味方の部隊のすぐ横（押しやすくするための余白の中）をタップ：選んでいる部隊がそこへ移動（近くの味方を選び直さない）
  await hitEl(page, true, page.locator('.b-zall'));
  await center(page, 10, 100); // 寄せずに（全体の距離のまま）本陣のあたりを画面の中ほどへ（下の札に隠れないように）
  await sleep(600);
  const hqPx = await screenOf(page, 'a_hq');
  const besidePx = await groundXY(page, 22, 110);
  const gapPx = Math.hypot(hqPx.x - besidePx.x, hqPx.y - besidePx.y);
  await hitGround(page, true, 22, 110);
  g = await unit(page, 'a_shinpachi');
  check(`C 合戦（スマホ・全体）：本陣の 22 m 横（画面で ${gapPx.toFixed(0)} px）の地面をタップ → 新八隊がそこへ移動（本陣を選び直さない）`,
    gapPx < 30 && (await bUi(page)).selectedId === 'a_shinpachi' && g.order.type === 'move' && Math.hypot(g.order.x - 22, g.order.z - 110) < 10, JSON.stringify(g.order));
  await hitUnit(page, true, 'a_hq');
  check('C 合戦（スマホ・全体）：本陣そのものをタップすると本陣を選ぶ', (await bUi(page)).selectedId === 'a_hq');
  await hitEl(page, true, card(page, '新八隊'));
  await frameOn(page, 0, 50, 230);
  await hitEl(page, true, cmd(page, '移動'));
  await hitGround(page, true, 20, 60);
  g = await unit(page, 'a_shinpachi');
  check('C 合戦：「移動」の後で地面をタップ', g.order.type === 'move' && Math.hypot(g.order.x - 20, g.order.z - 60) < 8, JSON.stringify(g.order));
  await hitEl(page, true, cmd(page, '攻撃'));
  await hitUnit(page, true, 'e_sente');
  check('C 合戦：「攻撃」の後で敵（鷲尾先手）をタップ', (await unit(page, 'a_shinpachi')).order.type === 'attack');
  // 本陣の真後ろの予備隊で先手へ攻めかかる：予備隊は本陣をよけて進み、防衛・待機の本陣は押し出されない
  const hq0 = await unit(page, 'a_hq');
  await hitEl(page, true, card(page, '琴坂予備隊'));
  await hitEl(page, true, cmd(page, '攻撃'));
  await hitUnit(page, true, 'e_sente');
  check('C 合戦：予備隊の札 →「攻撃」→ 鷲尾先手をタップ', (await unit(page, 'a_reserve')).order.type === 'attack');
  await hitEl(page, true, page.locator('.b-pause'));
  await ffUntil(page, 's.t > 25', 40);
  const hq1 = await unit(page, 'a_hq');
  const res1 = await unit(page, 'a_reserve');
  check(`C 合戦：予備隊が本陣の横を抜けて前へ（予備隊 z ${res1.z.toFixed(0)}）、本陣はその場（動いた距離 ${Math.hypot(hq1.x - hq0.x, hq1.z - hq0.z).toFixed(1)} m・命令 ${hq1.order.type}）`,
    res1.z < hq0.z - 20 && Math.hypot(hq1.x - hq0.x, hq1.z - hq0.z) < 1.5 && hq1.order.type === 'hold');
  await frameOn(page, 0, 80, 230);
  await shot(page, 'C07-reserve-passes-hq');
  await hitEl(page, true, page.locator('.b-allret'));
  check('C 合戦：「全軍撤退」をタップすると確かめる（止まる）', (await bUi(page)).modal === 'confirm' && (await bUi(page)).paused);
  await shot(page, 'C07-allretreat-confirm');
  await hitEl(page, true, page.locator('.b-confirm .b-btn', { hasText: '撤退する' }));
  check('C 合戦：「撤退する」をタップ → 全軍撤退', (await page.evaluate(() => window.__battle.state.allRetreatAt)) !== null);
  await ffUntil(page, 'false', 120);
  const out = await finishBattle(page, true, 'C08', 'retreat');
  check('C 撤退の理由は全軍撤退（兵は残る）', out.reason === 'ordered_retreat' && out.units.filter((x) => x.side === 'ally').every((x) => x.endStrength > 0));
  await waitScreen(page, 'explore');
  s = await st(page);
  check('撤退の戦後：関係は田代・大森・鷲尾とも変わらない（独力）', s.phase === 'aftermath' && s.result === 'retreat' && s.relations.tashiro === 10 && s.relations.omori === 10 && s.relations.washio === -60);
  u = await talkTo(page, 'shinpachi', touch);
  check('戦後の新八：aftermath.shinpachi.alone.retreat', u.seenId === 'aftermath.shinpachi.alone.retreat', u.seenId);
  await waitScreen(page, 'explore');
  u = await talkTo(page, 'genzo', touch);
  check('戦後の源蔵：aftermath.genzo.alone.retreat', u.seenId === 'aftermath.genzo.alone.retreat', u.seenId);
  await sleep(400);
  await tap('.g-choice[data-id="end_chapter"]');
  await waitUi(page, 'ending');
  await shot(page, 'C09-ending');
  u = await ui(page);
  s = await st(page);
  check('結末 retreat：雌伏（独力・撤退）', s.ending === 'retreat' && u.text.includes('雌伏') && u.text.includes('独力で戦った') && u.text.includes('撤退'));
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
  return { ending: s.ending, relations: s.relations };
}

const results = {};
try {
  if (ONLY.includes('A')) results.A = await runA();
  if (ONLY.includes('B')) results.B = await runB();
  if (ONLY.includes('C')) results.C = await runC();
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
const ends = Object.values(results).map((r) => r.ending);
if (ends.length > 1) check(`経路ごとに結末が違う（${ends.join('・')}）`, new Set(ends).size === ends.length);
check('ページの誤り（例外・console.error）が無い', errors.length === 0, errors.slice(0, 5).join(' / '));
await browser.close();
console.log(failed ? `失敗 ${failed}` : 'すべて OK');
process.exit(failed ? 1 : 0);
