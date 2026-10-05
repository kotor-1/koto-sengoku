// 歴史分岐「元亀元年・家康」の第一章の開始から第二章の区切りまでを、3 方針それぞれ画面の操作で通す（開発サーバー）。
// 依頼：docs/chapter2-request.md【8】・追加の判断 docs/chapter2-request-2.md【3】。記録：docs/chapter2-verification.md。
//
// 確認の種類（出力の行にも書く）：
//   - 本物の入力：タイトル・城下を歩く（WASD を押し続ける／スマホはタッチのスティック）・話す（E／「話す」）・行送り・選択肢・軍議・約束・
//     補充・城門・結末の「第二章へ進む」・結果確認の「城下へ」・メニューの保存・合戦の命令（札・「移動」→ 地面・敵の体・「能力」・全軍撤退）・
//     結果の「続ける」・区切りの「タイトルへ」。歩く向きは __p3.hero・__game.cast の位置を読んで決める（読むだけ）。
//   - 早送り：合戦の待つ間だけ。合戦を「指揮」（一時停止）にして、止めたまま window.__battle.fastForward(1) で 1 秒ずつ進める。
//     その 1 秒ごとに状態を読み（読むだけ）、采配の条件がそろったら、止めたまま本物の入力で命令を出す。区間は出力の「（早送り）」の行。
//     第二章の合戦の采配は chapter2/scripts.ts の作戦（CH2_TACTICS）の行（揺らぎなし）を、ページの中で条件だけ評価して、命令は画面の入力で出す。
//     compare の損害の大きい保存の合戦だけは、命令も台本（ch2TacticScript を fastForward に渡す）。
//   - 描画の省略：?q=low&render=manual（開発用。探索の場面を毎フレーム描かず、画面写しのときだけ描く。歩く・話す処理・合戦の画面は動く）。
//   - カメラ：合戦で押す所へ window.__battle.centerOn で寄せる（表示だけ。人が地図を動かすのと同じ）。
//   - 直接状態変更：保存を localStorage に入れる（compare・idem・regress の第一章の結末の保存・各部の 2D／架空／演習の見張りの保存）・
//     __game.talk（compare・idem で歩く代わり）・__game.setPhase（regress の架空の章の結末）・setItem を包んで容量の失敗を起こす（idem）。
//     保存の書き込みの数え上げ（setItem を包む）は観察だけ。
//   合戦で地面を押す移動は、必ず「移動」（移動先指定）→ 地面。押す前後で能力の使用（abilityList の usedAt）とほかの味方の命令が変わっていないことを確かめる。
//
// PARTS（カンマ区切り。既定はすべて）：
//   chain:oda   PC（キーとマウス）：A 織田・約束を引き受ける → 勝利・約束を守る → 第二章：判断 1（殿を引き受ける）・補充「待つ」・作戦 rear_hold
//   chain:asai  PC（マウス）：B 浅井・約束を引き受ける → 撤退・約束を守る → 第二章：判断 2（西の筋から救う）・補充「守備隊から回す」・作戦 west
//   chain:home  スマホ横 844×390（タッチ）：C 自領・約束を引き受けない → 勝利 → 第二章：判断 1（全軍で村を守る）・補充「今の兵で出る」・作戦 trap
//   compare     同じ方針（A）で第一章の結果が違う 3 つの保存（勝ち・守った／撤退・引き受けなかった／敗北・破った・損害大）から第二章へ。並べて記録。
//               損害の大きい保存は台本の早送りで区切りまで。
//   idem        「第二章へ進む」の連打・移った直後の読み込み直し・補充の後の読み込み直し・移るときの保存の容量の失敗・版 1／版 2 の結末から
//   regress     架空の章の結末はボタン 1 つ（Enter でタイトルへ）・第一章の結末で「タイトルへ」→ つづきからは「章の結末」
//
// 使い方：自動再読み込みなしの開発サーバーを起動して（起動したら 1 回ページを開いて温める）
//   (PORT=8191 setsid nohup npx vite --config proto3d/blender/tools/vite.nohmr.mjs > /tmp/vite-8191.log 2>&1 &)
//   BASE3D=http://localhost:8191 BASE=http://localhost:8191 PARTS=chain:oda node e2e/ieyasu-ch2.mjs [出力先]
import { readFileSync } from 'node:fs';
import { launchBrowser, outDir } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/ieyasu-ch2');
const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8191';
const PARTS = (process.env.PARTS || 'chain:oda,chain:asai,chain:home,compare,idem,regress').split(',').map((s) => s.trim()).filter(Boolean);
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
const POLL = { timeout: 300000, polling: 250 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = 'koto-sengoku/3d-ieyasu1570';
const KEY_CH1 = 'koto-sengoku/3d-ieyasu1570/chapter1';
const FKEY = 'koto-sengoku/3d-chapter1';
const KEY2D = 'koto-sengoku/save';
const PKEY = 'koto-sengoku/3d-fields';
const SENT2D = '{"2d":"keep"}';
const SENTP = '{"sentinel":"practice"}';
// 架空の第一章の古い保存（版 1：e2e/ieyasu-routes.mjs と同じ中身）。1 文字も変わらないことを見張る
const V1_FICTIONAL = '{"version":1,"savedAt":"2026-09-28T10:00:00.000Z","point":"aftermath","playTimeSec":0,"phase":"aftermath","alliance":"omori","relations":{"tashiro":-20,"omori":0,"washio":-60},"troops":{"honjin":240,"genzo":400,"shinpachi":280,"reserve":300},"characters":{"hero":"wounded","genzo":"wounded","shinpachi":"alive","tashiro_envoy":"alive","omori_envoy":"alive","washio_gen":"alive"},"talked":{"explore.genzo":true,"explore.shinpachi":true,"council.council":true,"muster.gate":true},"battle":{"result":"defeat","reason":"ally_hq_routed","elapsedSec":300,"units":[{"id":"a_hq","side":"ally","clan":"kotosaka","startStrength":300,"endStrength":240,"status":"routed","leaderId":"hero"},{"id":"a_genzo","side":"ally","clan":"kotosaka","startStrength":500,"endStrength":400,"status":"ready","leaderId":"genzo"},{"id":"a_shinpachi","side":"ally","clan":"kotosaka","startStrength":350,"endStrength":280,"status":"ready","leaderId":"shinpachi"},{"id":"a_omori","side":"ally","clan":"omori","startStrength":400,"endStrength":320,"status":"ready","leaderId":"omori_envoy"},{"id":"e_hq","side":"enemy","clan":"washio","startStrength":350,"endStrength":280,"status":"ready","leaderId":"washio_gen"},{"id":"e_sente","side":"enemy","clan":"washio","startStrength":550,"endStrength":440,"status":"ready"},{"id":"e_yumi","side":"enemy","clan":"washio","startStrength":350,"endStrength":280,"status":"ready"},{"id":"e_tashiro","side":"enemy","clan":"tashiro","startStrength":250,"endStrength":200,"status":"ready","leaderId":"tashiro_envoy"}]},"ending":null,"explore":null}';
const fixture = (n) => readFileSync(new URL(`../tests/fixtures/ieyasu-ch1-v3/${n}.json`, import.meta.url), 'utf8');
/** tests/*.ts の `export const NAME = '...'` の文字列を取り出す（版 1・版 2 の保存の実物） */
function tsConst(file, name) {
  const t = readFileSync(new URL(`../tests/${file}`, import.meta.url), 'utf8');
  const m = t.match(new RegExp(`export const ${name} =\\s*'([^']*)'`));
  if (!m) throw new Error(`${file} に ${name} が無い`);
  return m[1];
}
const UNIT_OF = { t_honjin: 'honjin', t_tadakatsu: 'tadakatsu', t_yumi: 'yumi', t_reserve: 'reserve' };
let reloading = false;

// ================================================================ ページ
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  const onErr = (text) => {
    if (reloading && /Couldn't load texture blob:/.test(text)) return;
    errors.push(text);
    console.log(`   ！ページの誤り [${secs()}] ${text.slice(0, 200)}`);
  };
  page.on('pageerror', (e) => onErr(e.message));
  page.on('console', (m) => { if (m.type() === 'error') onErr(m.text()); });
  await page.goto(BASE + '/?q=low&render=manual');
  await waitTitle(page);
  return { ctx, page };
}
const waitTitle = (page) => page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
async function reloadToTitle(page) {
  await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, null, POLL);
  reloading = true;
  try { await page.reload(); } finally { reloading = false; }
  await waitTitle(page);
  await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, null, POLL);
}
/** 見張りの保存（2D・架空・演習）を入れ、歴史分岐の保存は main（null なら消す）（直接状態変更） */
async function seed(page, main) {
  await page.evaluate(([k, v, k2, s2, kf, sf, kp, sp]) => {
    localStorage.clear();
    if (v !== null) localStorage.setItem(k, v);
    localStorage.setItem(k2, s2);
    localStorage.setItem(kf, sf);
    localStorage.setItem(kp, sp);
  }, [KEY, main, KEY2D, SENT2D, FKEY, V1_FICTIONAL, PKEY, SENTP]);
  await reloadToTitle(page);
}
async function sentinelsKept(page) {
  return (await raw(page, KEY2D)) === SENT2D && (await raw(page, FKEY)) === V1_FICTIONAL && (await raw(page, PKEY)) === SENTP;
}
const ui = (page) => page.evaluate(() => window.__game.ui);
const st = (page) => page.evaluate(() => (window.__game.state ? JSON.parse(JSON.stringify(window.__game.state)) : null));
const saved = (page, k = KEY) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), k);
const raw = (page, k) => page.evaluate((k) => localStorage.getItem(k), k);
const rawKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('koto-sengoku/')).sort());
const waitUi = (page, kind) => page.waitForFunction((k) => window.__game.ui?.kind === k, kind, POLL);
const waitScreen = (page, s) => page.waitForFunction((k) => window.__game.screen === k, s, POLL);
const choiceText = (page, id) => page.evaluate((id) => document.querySelector(`.g-choice[data-id="${id}"]`)?.textContent ?? '', id);
const shot = async (page, name) => {
  await page.evaluate(() => { if (!document.body.classList.contains('mode-battle')) window.__p3.renderNow(); });
  const file = name.replace(/:/g, '_');
  await page.screenshot({ path: `${OUT}/${file}.png`, timeout: 300000 });
  note(`撮影 ${file}`);
};
const castOf = (page) => page.evaluate(() => window.__game.cast);
const J = (v) => JSON.stringify(v);
/** 保存の書き込みを数える（setItem を包む。観察だけ。読み込み直すと外れる） */
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

// ================================================================ 探索（本物のキー・タッチのスティックで歩く）
function toScreen(s, tx, tz) {
  const gx = tx - s.x;
  const gz = tz - s.z;
  const d = Math.hypot(gx, gz) || 1;
  return { ix: (Math.cos(s.yaw) * gx - Math.sin(s.yaw) * gz) / d, iy: (Math.sin(s.yaw) * gx + Math.cos(s.yaw) * gz) / d, d };
}
const pose = (page) => page.evaluate(() => ({ x: window.__p3.hero.x, z: window.__p3.hero.z, yaw: window.__p3.orbit.yaw, prompt: window.__game.prompt, ui: window.__game.ui?.kind ?? null }));
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
async function readThrough(page, press) {
  let id = null;
  const seen = [];
  for (let i = 0; i < 100; i++) {
    const u = await ui(page);
    if (u?.kind === 'script') {
      id = u.id;
      const t = `${u.line.name}：${u.line.text}`;
      if (seen[seen.length - 1] !== t) seen.push(t);
    }
    if (!u || u.kind !== 'script' || u.choices.length) return { ...(u ?? {}), seenId: id, seen };
    await press();
    await sleep(220);
  }
  return { ...(await ui(page)), seenId: id, seen };
}
async function walkNear(page, how, c, id) {
  const walk = (x, z, done) => (how.cdp ? walkTouch(page, how.cdp, x, z, done) : walkKeys(page, x, z, done));
  const wx = c.x;
  const wz = c.z + 2.4;
  await walk(wx, wz, (q) => q.prompt === id || Math.hypot(q.x - wx, q.z - wz) < 0.5);
  await walk(c.x, c.z, (q) => q.prompt === id);
  const p = await pose(page);
  if (p.prompt !== id) throw new Error(`${id} の「話す」が出ない（${p.x.toFixed(1)}, ${p.z.toFixed(1)} / ${p.prompt}）`);
}
/** 歩いて近づき、「話す」→ 行を本物の入力で送る（本物の入力） */
async function talkTo(page, id, how) {
  const c = (await castOf(page)).find((m) => m.id === id);
  if (!c) throw new Error(`${id} が居ない（${(await castOf(page)).map((m) => m.id).join(',')}）`);
  await walkNear(page, how, c, id);
  await how.talk();
  await waitUi(page, 'script');
  return readThrough(page, how.next);
}
/** 話しかける（開発用の __game.talk：距離を問わない＝直接操作）→ 行は本物の入力で送る */
async function talkDev(page, io, id) {
  await page.evaluate((id) => window.__game.talk(id), id);
  await waitUi(page, 'script');
  return readThrough(page, io.next);
}
async function walkToGate(page, how) {
  const g = (await castOf(page)).find((m) => m.id === 'gate');
  if (how.cdp) await walkTouch(page, how.cdp, g.x, g.z, (q) => q.ui === 'script');
  else await walkKeys(page, g.x, g.z, (q) => q.ui === 'script');
  await waitUi(page, 'script');
  return readThrough(page, how.next);
}

/** PC の入力（キーとマウス） */
function desktopIO(page) {
  return {
    phone: false,
    talk: () => page.keyboard.press('KeyE'),
    next: () => page.keyboard.press('Enter'),
    pick: async (id) => { await sleep(450); await page.locator(`.g-choice[data-id="${id}"]`).click(); },
    btn: async (id) => { await sleep(450); await page.locator(`.g-btn[data-id="${id}"]`).click(); },
    press: async (sel) => { await page.locator(sel).first().click(); await sleep(200); },
    at: async (x, y) => { await page.mouse.click(x, y); await sleep(200); },
    menu: () => page.keyboard.press('Escape'),
  };
}
/** PC の入力（マウスだけ。「話す」もボタン・行送りもクリック） */
function mouseIO(page) {
  const io = desktopIO(page);
  io.talk = () => page.locator('.g-talk').click();
  io.next = () => page.mouse.click(640, 200);
  io.menu = () => page.locator('.g-menu-btn').click();
  return io;
}
/** スマホの入力（タッチ。探索の画面は CDP のタッチ、合戦の画面は Playwright のタップ） */
async function phoneIO(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  const tapAt = async (x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const tapSel = async (sel) => {
    const r = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, sel);
    if (!r) throw new Error(`${sel} が無い`);
    await tapAt(r.x, r.y);
    await sleep(250);
  };
  return {
    phone: true,
    cdp,
    talk: () => tapSel('.g-talk'),
    next: () => tapAt(120, 150),
    pick: async (id) => { await sleep(450); await tapSel(`.g-choice[data-id="${id}"]`); },
    btn: async (id) => { await sleep(450); await tapSel(`.g-btn[data-id="${id}"]`); },
    press: async (sel) => { await page.locator(sel).first().tap(); await sleep(200); },
    at: async (x, y) => { await page.touchscreen.tap(x, y); await sleep(250); },
    menu: () => tapSel('.g-menu-btn'),
  };
}

// ================================================================ 第一章（タイトル → 軍議 → 約束 → 出陣）
async function newIeyasu(page, io) {
  await io.btn('new:ieyasu1570');
  await page.waitForFunction(() => window.__game.screen === 'explore' || window.__game.ui?.kind === 'confirm', null, POLL);
  if ((await ui(page))?.kind === 'confirm') await io.btn('new');
  await waitScreen(page, 'explore');
}
async function council1(page, io, P, policy) {
  let u = await talkTo(page, 'tadakatsu', io);
  check(`${P} 第一章の城下：本多忠勝と話す → 軍議を開く（本物の入力：歩いて話す）`, u.seenId === 'explore.tadakatsu' && u.choices.includes('open_council'), u.seenId);
  await io.pick('open_council');
  await waitScreen(page, 'council');
  u = await readThrough(page, io.next);
  await io.pick(`policy_${policy}`);
  u = await readThrough(page, io.next);
  await io.pick('confirm_policy');
  await waitScreen(page, 'explore');
  const s = await st(page);
  check(`${P} 第一章の軍議：方針 ${policy} に決める → 出陣の支度`, s.phase === 'muster' && s.policy === policy && s.chapter === undefined);
}
async function pledge1(page, io, P, giver, answer) {
  const u = await talkTo(page, giver, io);
  await io.pick(`pledge_${answer}`);
  await waitScreen(page, 'explore');
  const s = await st(page);
  check(`${P} 第一章の約束（${giver}）：${answer === 'accept' ? '引き受ける' : '引き受けない'}`, answer === 'accept' ? s.pledge?.accepted === true : s.pledge?.result === 'declined', u.seenId);
}
async function depart1(page, io, P) {
  const u = await walkToGate(page, io);
  check(`${P} 第一章の城門（歩いて）：出陣の確認`, u.seenId === 'muster.gate' && u.choices.includes('depart'), u.seenId);
  await io.pick('depart');
  await page.waitForFunction(() => window.__game.screen === 'battle', null, POLL);
  const sv = await saved(page);
  check(`${P} 第一章の出陣前の自動保存（版 3・departure）`, sv?.version === 3 && sv.point === 'departure' && !!sv.battleId);
  await page.waitForFunction(() => window.__battle?.active && window.__battle.ui.modal === 'briefing' && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
  await sleep(400);
}

// ================================================================ 合戦（本物の入力。移動は「移動」→ 地面。待つ間だけ早送り）
const bUi = (page) => page.evaluate(() => window.__battle.ui);
const bUnit = (page, id) => page.evaluate((id) => { const u = window.__battle.state.units.find((x) => x.id === id); return u && { id: u.id, name: u.name, x: u.x, z: u.z, status: u.status, order: u.order, strength: u.strength, start: u.startStrength, morale: u.morale, present: u.present }; }, id);
const bAb = (page, id) => page.evaluate((id) => { const r = window.__battle.state.abilities[id]; return r ? { usedAt: r.usedAt, until: r.until, targetId: r.targetId ?? null } : null; }, id);
const hintText = (page) => page.evaluate(() => { const h = document.querySelector('.b-hint'); return h && !h.hidden ? h.textContent : ''; });
/** 押す前の控え（読むだけ）：能力の使用（abilityList の usedAt）と、命令する部隊のほかの味方の命令 */
const cmdSnap = (page, id) => page.evaluate((id) => {
  const s = window.__battle.state;
  return {
    used: Object.fromEntries(s.abilityList.map((r) => [r.unitId, r.usedAt])),
    others: Object.fromEntries(s.units.filter((u) => u.side === 'ally' && u.id !== id).map((u) => [u.id, JSON.stringify(u.order)])),
  };
}, id);
const ordStr = (o) => (!o ? '?' : o.type === 'attack' ? `攻撃 ${o.targetId}` : o.type === 'move' ? `移動 (${o.x.toFixed(0)},${o.z.toFixed(0)})` : o.type);

/** 状態を読む条件（ページの中で評価する式。s・U・alive・seen・broken・near・at が使える） */
const HELPERS = `
  const U = (id) => s.units.find((u) => u.id === id);
  const alive = (id) => { const u = U(id); return !!u && u.status === 'ready' && u.present !== false; };
  const seen = (id) => alive(id) && U(id).seenBy.ally;
  const broken = (id) => !alive(id);
  const near = (a, b, r) => alive(a) && alive(b) && Math.hypot(U(a).x - U(b).x, U(a).z - U(b).z) <= r;
  const at = (id, x, z, r = 6) => { const u = U(id); return !!u && Math.hypot(u.x - x, u.z - z) <= r; };
`;
const MOVE_ECHO_GAP_MS = 650;

function battleIO(page, io) {
  const names = {};
  let moveTapAt = 0;
  const D = io.phone ? { ground: 200, unit: 160 } : { ground: 240, unit: 190 };
  const B = {
    counts: { move: 0, attack: 0, ability: 0, retreat: 0, hold: 0, allRetreat: 0 },
    issues: [],
    refused: [],
    async init() {
      Object.assign(names, Object.fromEntries(await page.evaluate(() => window.__battle.state.units.map((u) => [u.id, u.name]))));
    },
    async pause() {
      if ((await bUi(page)).paused) return;
      if (io.phone) await io.press('.b-pause');
      else await page.keyboard.press('Space');
      await sleep(200);
      if (!(await bUi(page)).paused) throw new Error('指揮（一時停止）にできない');
    },
    async gap() {
      const d = Date.now() - moveTapAt;
      if (d < MOVE_ECHO_GAP_MS) await sleep(MOVE_ECHO_GAP_MS - d);
    },
    /** 札で味方の部隊を選ぶ（選んでいれば押さない） */
    async select(id) {
      const u0 = await bUi(page);
      if (u0.selectedId === id && (u0.pending === 'none' || u0.pending === 'move')) return;
      await page.evaluate((id) => document.querySelector(`.b-card[data-id="${id}"]`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' }), id);
      await io.press(`.b-card[data-id="${id}"]`);
      const u = await bUi(page);
      if (u.selectedId !== id) throw new Error(`${names[id]} を札で選べない（${u.selectedId}）`);
    },
    async leaks(id, before, abilityOf = null) {
      const after = await cmdSnap(page, id);
      const bad = [];
      const usedDiff = Object.keys(after.used).filter((k) => after.used[k] !== before.used[k]);
      const want = abilityOf ? [abilityOf] : [];
      if (usedDiff.join() !== want.join()) bad.push(`能力の使用が変わった（${usedDiff.join(',') || 'なし'}${abilityOf ? `。意図は ${abilityOf} だけ` : '。意図はなし'}）`);
      const od = Object.keys(before.others).filter((k) => after.others[k] !== before.others[k]);
      if (od.length) bad.push(`ほかの部隊の命令が変わった（${od.map((k) => `${k} → ${after.others[k]}`).join('・')}）`);
      if (bad.length) {
        B.issues.push(`${names[id]}：${bad.join('・')}`);
        note(`！${names[id]}：${bad.join('・')}`);
      }
    },
    /** 移動：札で選ぶ →「移動」（移動先指定）→ 地面を押す */
    async move(id, x, z, { skipNear = 0 } = {}) {
      const u0 = await bUnit(page, id);
      if (!u0 || u0.status !== 'ready') return true;
      if (skipNear && Math.hypot(u0.x - x, u0.z - z) < skipNear) return true;
      await B.select(id);
      const before = await cmdSnap(page, id);
      if ((await bUi(page)).pending !== 'move') await io.press('.b-cmds .b-cmd:text-is("移動")');
      if ((await bUi(page)).pending !== 'move') {
        note(`${names[id]}：「移動」で移動先指定にならない（${(await bUi(page)).pending}）`);
        return false;
      }
      await page.evaluate(([x, z, d]) => window.__battle.centerOn(x, z, d), [x, z, D.ground]);
      await sleep(250);
      const g = await page.evaluate(([x, z]) => { const q = window.__battle.screenOfGround(x, z); const el = document.elementFromPoint(q.x, q.y); return { ...q, hit: String(el?.className ?? '') }; }, [x, z]);
      if (!g.hit.includes('b-input')) {
        note(`${names[id]}：地面 (${x}, ${z}) が画面の部品の下（${g.hit}）`);
        await io.press('.b-cmds .b-cmd:text-is("移動")');
        return false;
      }
      await B.gap();
      await io.at(g.x, g.y);
      moveTapAt = Date.now();
      const u = await bUnit(page, id);
      const now = await bUi(page);
      const tol = (await page.evaluate(async ([x, z]) => (await import('/src/battle/sim.ts')).passableAt(window.__battle.state, x, z), [x, z])) ? 4 : 25;
      if (u.order.type !== 'move' || Math.hypot(u.order.x - x, u.order.z - z) > tol) {
        const h = await hintText(page);
        B.refused.push(`${names[id]} 移動 (${x},${z}) → ${ordStr(u.order)}（${h}）`);
        note(`${names[id]} の移動が出なかった（${ordStr(u.order)}。${h}）`);
        if (now.pending === 'move') await io.press('.b-cmds .b-cmd:text-is("移動")');
        return false;
      }
      if (now.selectedId !== id) B.issues.push(`${names[id]}：移動の後に選んだ部隊が変わった（${now.selectedId}）`);
      await B.leaks(id, before);
      B.counts.move++;
      return true;
    },
    /** 攻撃：札で選ぶ → 敵の体を押す（名札の当たり・画面の部品を避けた点）。ならなければ「攻撃」→ 体 */
    async attack(id, target) {
      await B.select(id);
      if ((await bUi(page)).pending === 'move') await io.press('.b-cmds .b-cmd:text-is("移動")');
      const before = await cmdSnap(page, id);
      const tu = await bUnit(page, target);
      await page.evaluate(([x, z, d]) => window.__battle.centerOn(x, z, d), [tu.x, tu.z, D.unit]);
      await sleep(250);
      const ok = async () => { const o = (await bUnit(page, id)).order; return o.type === 'attack' && o.targetId === target; };
      const tries = [[0, 0], [0, 8], [10, 0], [-10, 0], [0, -8], [0, 14]];
      for (let k = 0; k < tries.length; k++) {
        const p = await page.evaluate(([t, dx, dy]) => {
          const q = window.__battle.screenOf(t);
          if (!q) return null;
          const x = q.x + dx;
          const y = q.y + dy;
          const el = document.elementFromPoint(x, y);
          return { x, y, hit: String(el?.className ?? ''), label: window.__battle.labelHitAt(x, y) };
        }, [target, ...tries[k]]);
        if (!p || !p.hit.includes('b-input') || p.label) continue;
        if (k > 0) {
          await B.select(id);
          await io.press('.b-cmds .b-cmd:text-is("攻撃")');
        }
        await B.gap();
        await io.at(p.x, p.y);
        if (await ok()) {
          await B.leaks(id, before);
          B.counts.attack++;
          return true;
        }
      }
      const o = (await bUnit(page, id)).order;
      B.refused.push(`${names[id]} → ${names[target]} 攻撃にならない（${ordStr(o)}。${await hintText(page)}）`);
      note(`${names[id]} → ${names[target]} の攻撃が出なかった（${ordStr(o)}。${await hintText(page)}）`);
      return false;
    },
    /** 特殊能力：札で選ぶ →「能力」（PC は key なら F）→ 援護なら対象の部隊を押す */
    async ability(id, { key = false, target = null } = {}) {
      await B.select(id);
      if ((await bUi(page)).pending === 'move') await io.press('.b-cmds .b-cmd:text-is("移動")');
      const before = await cmdSnap(page, id);
      const b0 = await bAb(page, id);
      if (key && !io.phone) await page.keyboard.press('KeyF');
      else await io.press('.b-abil-btn');
      await sleep(150);
      if (target) {
        if ((await bUi(page)).pending !== 'ability') {
          note(`援護の対象選びにならない（${await hintText(page)}）`);
          return false;
        }
        const tu = await bUnit(page, target);
        await page.evaluate(([x, z, d]) => window.__battle.centerOn(x, z, d), [tu.x, tu.z, D.unit]);
        await sleep(250);
        const p = await page.evaluate((t) => window.__battle.screenOf(t), target);
        await io.at(p.x, p.y);
      }
      const r = await bAb(page, id);
      if (!r || r.usedAt === null || (b0 && b0.usedAt !== null)) {
        note(`${names[id]} の能力が出なかった（${await hintText(page)}）`);
        return false;
      }
      await B.leaks(id, before, id);
      B.counts.ability++;
      return true;
    },
    async simple(id, label, type) {
      await B.select(id);
      if ((await bUi(page)).pending === 'move') await io.press('.b-cmds .b-cmd:text-is("移動")');
      const before = await cmdSnap(page, id);
      await io.press(`.b-cmds .b-cmd:text-is("${label}")`);
      const u = await bUnit(page, id);
      if (u.order.type !== type) return false;
      await B.leaks(id, before);
      B.counts[type]++;
      return true;
    },
    retreat: (id) => B.simple(id, '撤退', 'retreat'),
    hold: (id) => B.simple(id, '防衛・待機', 'hold'),
    async allRetreat() {
      await io.press('.b-allret');
      await page.locator('.b-confirm').waitFor({ state: 'visible' });
      await sleep(300);
      await io.press('.b-confirm .b-btn:has-text("撤退する")');
      const ok = (await page.evaluate(() => window.__battle.state.allRetreatAt)) !== null;
      if (ok) B.counts.allRetreat++;
      return ok;
    },
    summary() {
      const c = B.counts;
      return `移動 ${c.move}・攻撃 ${c.attack}・能力 ${c.ability}・撤退 ${c.retreat}・防衛 ${c.hold}・全軍撤退 ${c.allRetreat}`;
    },
  };
  return B;
}

/** 第一章の采配（ieyasu-routes と同じ規則。移動は「移動」→ 地面）。止めたまま 1 秒ずつ早送りし、条件がそろったら本物の入力で命令 */
async function drive(page, B, rules, { maxSec = 700 } = {}) {
  const done = new Set();
  const fails = {};
  const log = [];
  let t = 0;
  let t0 = null;
  for (let i = 0; i < maxSec; i++) {
    const snap = await page.evaluate(([rs, helpers]) => {
      const s = window.__battle.state;
      const fire = [];
      for (const [key, when] of rs) {
        let ok = false;
        try { ok = !!new Function('s', `${helpers}; return (${when});`)(s); } catch (e) { return { err: `${key}: ${e.message}` }; }
        if (ok) fire.push(key);
      }
      return { t: s.t, result: !!s.result, fire };
    }, [rules.filter(([k]) => !done.has(k)).map(([k, w]) => [k, w]), HELPERS]);
    if (snap.err) throw new Error(`条件の式の誤り ${snap.err}`);
    t = snap.t;
    if (t0 === null) t0 = t;
    if (snap.result) break;
    for (const key of snap.fire) {
      const act = rules.find(([k]) => k === key)[2];
      const ok = await act();
      if (ok === false) {
        fails[key] = (fails[key] ?? 0) + 1;
        if (fails[key] >= 6) throw new Error(`采配「${key}」を 6 回出せなかった`);
        continue;
      }
      done.add(key);
      log.push(`${t.toFixed(0)}s ${key}`);
    }
    await page.evaluate(() => window.__battle.fastForward(1));
  }
  note(`（早送り）合戦の時間 ${t0?.toFixed(0)} 秒 → ${t.toFixed(0)} 秒を、止めたまま 1 秒ずつ進めた。采配（本物の入力）：${log.join('、')}`);
  return log;
}

/**
 * 第二章の采配：chapter2/scripts.ts の作戦（CH2_TACTICS[policy] の id。揺らぎなし CH2_J0）の行を、ページの中で条件だけ評価し（読むだけ）、
 * 命令は画面の入力で出す。台本（stepScript）と同じ決まり：時刻の行はその時刻に、見てから押す行は 1 秒ごとに条件を見て 1 回だけ。
 * 合戦にいない部隊の行は使わない。戦えない・まだ着いていない部隊・崩れた・見えていない相手への命令は出さない（画面に名札が無い）。
 * 地面を押す行（tap）は、押す点の 20 m 以内に見えている敵がいれば、その敵への攻撃（敵の体を押す）、いなければ「移動」→ 地面。
 * 1 行を出すごとに、続きの行の条件をその後の状態で見る（台本と同じく、出した命令が次の行の条件に効く）。
 */
async function driveTactic(page, B, policy, tid, { maxSec = 900 } = {}) {
  const n = await page.evaluate(async ([policy, tid]) => {
    const m = await import('/src/campaign/ieyasu1570/chapter2/scripts.ts');
    const sim = await import('/src/battle/sim.ts');
    const t = m.CH2_TACTICS[policy].find((x) => x.id === tid);
    const setup = window.__battle.state.setup;
    const has = (id) => setup.units.some((u) => u.id === id);
    const use = t.steps(m.CH2_J0).filter(([, id, cmd]) => cmd === 'allRetreat' || has(id));
    const timed = use.filter((x) => typeof x[0] === 'number').sort((a, b) => a[0] - b[0]);
    const watch = use.filter((x) => typeof x[0] === 'function');
    const D = { timed, watch, fired: new Set(), cursor: 0 };
    const resolve = (label, id, cmd, s) => {
      if (cmd === 'allRetreat') return { label, kind: 'allRetreat' };
      if (cmd === 'nearest') {
        const o = m.nearestEnemyOrder(s, id);
        return o ? { label, id, kind: 'attack', target: o.targetId, via: '一番近い敵' } : { label, id, kind: 'skip', why: '当てる敵が無い・今の相手が戦える' };
      }
      const u = sim.unitById(s, id);
      if (!u || !sim.isActive(u) || !u.arrived) return { label, id, kind: 'skip', why: '戦えない・まだ着いていない' };
      if (cmd === 'ability') return { label, id, kind: 'ability' };
      if (typeof cmd === 'object' && 'abilityOn' in cmd) return { label, id, kind: 'abilityOn', target: cmd.abilityOn };
      if (typeof cmd === 'object' && 'tap' in cmd) {
        const o = m.tapOrder(s, cmd.tap);
        return o.type === 'attack' ? { label, id, kind: 'attack', target: o.targetId, via: `地面 (${cmd.tap}) の 20 m 以内の敵` } : { label, id, kind: 'move', x: o.x, z: o.z };
      }
      if (cmd.type === 'attack') {
        const tu = sim.unitById(s, cmd.targetId);
        if (!tu || !sim.isActive(tu) || (tu.side === 'enemy' && !tu.seenBy.ally)) return { label, id, kind: 'skip', why: `相手 ${cmd.targetId} が崩れた・見えていない` };
        return { label, id, kind: 'attack', target: cmd.targetId };
      }
      if (cmd.type === 'move') return { label, id, kind: 'move', x: cmd.x, z: cmd.z };
      return { label, id, kind: cmd.type };
    };
    D.next = () => {
      const s = window.__battle.state;
      while (D.timed.length && s.t >= D.timed[0][0] - 1e-9) {
        const [t, id, cmd] = D.timed.shift();
        return resolve(`${t}s`, id, cmd, s);
      }
      for (let i = D.cursor; i < D.watch.length; i++) {
        if (D.fired.has(i)) continue;
        if (!D.watch[i][0](s)) continue;
        D.fired.add(i);
        D.cursor = i + 1;
        return resolve(`見て#${i}`, D.watch[i][1], D.watch[i][2], s);
      }
      D.cursor = D.watch.length;
      return null;
    };
    window.__ch2drive = D;
    return use.length;
  }, [policy, tid]);
  note(`作戦 ${policy}/${tid} の行 ${n}（chapter2/scripts.ts。条件はページの中で評価・命令は画面の入力）`);
  const log = [];
  const skipped = [];
  let t = 0;
  let t0 = null;
  for (let i = 0; i < maxSec; i++) {
    const s0 = await page.evaluate(() => { const s = window.__battle.state; window.__ch2drive.cursor = 0; return { t: s.t, result: !!s.result }; });
    t = s0.t;
    if (t0 === null) t0 = t;
    if (s0.result) break;
    for (let k = 0; k < 60; k++) {
      const c = await page.evaluate(() => window.__ch2drive.next());
      if (!c) break;
      let ok = true;
      if (c.kind === 'skip') { skipped.push(`${t.toFixed(0)}s ${c.label} ${c.id}：${c.why}`); continue; }
      if (c.kind === 'move') ok = await B.move(c.id, c.x, c.z);
      else if (c.kind === 'attack') ok = await B.attack(c.id, c.target);
      else if (c.kind === 'ability') ok = await B.ability(c.id);
      else if (c.kind === 'abilityOn') ok = await B.ability(c.id, { target: c.target });
      else if (c.kind === 'allRetreat') ok = await B.allRetreat();
      else if (c.kind === 'retreat') ok = await B.retreat(c.id);
      else if (c.kind === 'hold') ok = await B.hold(c.id);
      log.push(`${t.toFixed(0)}s ${c.id ?? ''} ${c.kind}${c.kind === 'move' ? ` (${c.x.toFixed(0)},${c.z.toFixed(0)})` : c.target ? ` ${c.target}` : ''}${ok ? '' : '（出せず）'}`);
    }
    await page.evaluate(() => window.__battle.fastForward(1));
  }
  note(`（早送り）合戦の時間 ${t0?.toFixed(0)} 秒 → ${t.toFixed(0)} 秒を、止めたまま 1 秒ずつ進めた。命令（本物の入力）：${log.join('、')}`);
  if (skipped.length) note(`出さなかった行（台本と同じ決まり）：${skipped.join('、')}`);
  return { log, skipped };
}

async function waitResultPanel(page) {
  await page.waitForFunction(() => window.__battle.ui.resultShown && document.querySelector('.b-result'), null, POLL);
  await sleep(400);
  return { out: await page.evaluate(() => window.__battle.state.result), text: await page.textContent('.b-result') };
}
async function continueFromResult(page, io) {
  await io.press('.b-primary:has-text("続ける")');
  await page.waitForFunction(() => window.__game.screen === 'explore' && !document.body.classList.contains('mode-battle') && !document.getElementById('battle-ui'), null, POLL);
}

// ================================================================ 第一章の 3 つの采配（e2e/ieyasu-routes.mjs の経路 1〜3 と同じ規則）
function rulesCh1(policy, page, B, P) {
  const notBusy = (id) => `(U('${id}').order.type !== 'attack' || !alive(U('${id}').order.targetId))`;
  if (policy === 'oda') {
    const sallied = `alive('e_asai_sente') && U('e_asai_sente').engagedWith === 't_yumi'`;
    const rules = [
      ['oda-back', 'true', () => B.move('a_oda', 25, 135, { skipNear: 10 })],
      ['tada-east', 'true', () => B.move('t_tadakatsu', 80, 45, { skipNear: 10 })],
      ['yumi-east', 'true', () => B.move('t_yumi', 45, 75, { skipNear: 10 })],
      ['tada-rearguard', `at('t_tadakatsu', 80, 45)`, () => B.ability('t_tadakatsu', { key: true })],
      ['yumi-asa', `seen('e_asakura') && U('e_asakura').z > -40`, () => B.attack('t_yumi', 'e_asakura')],
      ['tada-asa', `seen('e_asakura') && U('e_asakura').z > -20 && !(s.abilities.t_tadakatsu && s.t < s.abilities.t_tadakatsu.until)`, () => B.attack('t_tadakatsu', 'e_asakura')],
      ['hq-asa', `alive('e_asakura') && U('e_asakura').engagedWith === 't_tadakatsu'`, () => B.attack('t_honjin', 'e_asakura')],
      ['rally', `alive('e_asakura') && U('e_asakura').engagedWith === 't_tadakatsu' && near('t_honjin', 'e_asakura', 60)`, () => B.ability('t_honjin')],
      ['hq-back', `broken('e_asakura')`, () => B.move('t_honjin', 0, 100, { skipNear: 10 })],
      ['tada-wait', `broken('e_asakura')`, () => B.move('t_tadakatsu', 75, 60, { skipNear: 10 })],
      ['oda-wait', `broken('e_asakura') && alive('a_oda') && (s.pledge === null || s.pledge.secured)`, () => B.move('a_oda', -45, 75, { skipNear: 10 })],
      ['yumi-sente', `broken('e_asakura') && seen('e_asai_sente')`, () => B.attack('t_yumi', 'e_asai_sente')],
      ['tada-sente', sallied, () => B.attack('t_tadakatsu', 'e_asai_sente')],
      ['oda-sente', `${sallied} && alive('a_oda')`, () => B.attack('a_oda', 'e_asai_sente')],
      ['hq-sente', sallied, () => B.attack('t_honjin', 'e_asai_sente')],
    ];
    for (const id of ['t_tadakatsu', 't_yumi', 't_honjin', 'a_oda'])
      for (const e of ['e_asai_yumi', 'e_nagamasa'])
        rules.push([`${id}>${e}`, `broken('e_asai_sente') && alive('${id}') && seen('${e}') && ${notBusy(id)}`, () => B.attack(id, e)]);
    return rules;
  }
  if (policy === 'asai') {
    const chased = `alive('a_nagamasa') && s.units.some((e) => e.side === 'enemy' && e.status === 'ready' && Math.hypot(e.x - U('a_nagamasa').x, e.z - U('a_nagamasa').z) <= 70)`;
    return [
      ['tada-cover', 'true', () => B.move('t_tadakatsu', -45, 40, { skipNear: 10 })],
      ['support', `near('a_nagamasa', 't_tadakatsu', 55)`, () => B.ability('a_nagamasa', { target: 't_tadakatsu' })],
      ['naga-out', `s.abilities.a_nagamasa && s.abilities.a_nagamasa.usedAt !== null && s.t > 20`, () => B.retreat('a_nagamasa')],
      ['rearguard', `${chased} && near('t_tadakatsu', 'a_nagamasa', 70) && U('a_nagamasa').order.type === 'retreat'`, () => B.ability('t_tadakatsu', { key: true })],
      ['all-out', `broken('a_nagamasa')`, () => B.allRetreat()],
    ];
  }
  const sallied = `alive('e_ronin_yari') && U('e_ronin_yari').engagedWith === 't_yumi'`;
  const kibaFighting = `alive('e_ronin_kiba') && ['t_tadakatsu', 't_yumi'].includes(U('e_ronin_kiba').engagedWith ?? '')`;
  const rules = [
    ['tada-west', 'true', () => B.move('t_tadakatsu', -45, 55, { skipNear: 10 })],
    ['yumi-back', 'true', () => B.move('t_yumi', -5, 85, { skipNear: 10 })],
    ['tada-kiba', `seen('e_ronin_kiba')`, () => B.attack('t_tadakatsu', 'e_ronin_kiba')],
    ['yumi-kiba', `seen('e_ronin_kiba')`, () => B.attack('t_yumi', 'e_ronin_kiba')],
    ['hq-kiba', kibaFighting, () => B.attack('t_honjin', 'e_ronin_kiba')],
    ['hq-back', `broken('e_ronin_kiba')`, () => B.move('t_honjin', 0, 100, { skipNear: 10 })],
    ['tada-wait', `broken('e_ronin_kiba')`, () => B.move('t_tadakatsu', -45, 75, { skipNear: 10 })],
    ['res-wait', `broken('e_ronin_kiba') && alive('t_reserve')`, () => B.move('t_reserve', 50, 80, { skipNear: 10 })],
    ['yumi-yari', `broken('e_ronin_kiba') && seen('e_ronin_yari')`, () => B.attack('t_yumi', 'e_ronin_yari')],
    ['tada-yari', sallied, () => B.attack('t_tadakatsu', 'e_ronin_yari')],
    ['res-yari', `${sallied} && alive('t_reserve')`, () => B.attack('t_reserve', 'e_ronin_yari')],
    ['hq-yari', sallied, () => B.attack('t_honjin', 'e_ronin_yari')],
    ['rally', `${sallied} && near('t_honjin', 't_yumi', 90)`, () => B.ability('t_honjin')],
  ];
  for (const id of ['t_tadakatsu', 't_yumi', 't_reserve'])
    for (const e of ['e_ronin_yumi', 'e_ronin_hq'])
      rules.push([`${id}>${e}`, `broken('e_ronin_yari') && alive('${id}') && seen('${e}') && ${notBusy(id)}`, () => B.attack(id, e)]);
  return rules;
}

// ================================================================ 第一章を通す（タイトル → 結末）
const CH1 = {
  oda: { giver: 'oda_envoy', answer: 'accept', want: { result: 'victory', pledge: 'kept', ending: 'oda_victory' } },
  asai: { giver: 'asai_envoy', answer: 'accept', want: { result: 'retreat', pledge: 'kept', ending: 'retreat' } },
  home: { giver: 'tadakatsu', answer: 'decline', want: { result: 'victory', pledge: 'declined', ending: 'home_victory' } },
};
async function chapter1(page, io, P, policy) {
  const c = CH1[policy];
  const w0 = Date.now();
  note(`--- ${P} 第一章（本物の入力。合戦の待つ間だけ早送り。探索の描画は ?render=manual）`);
  await newIeyasu(page, io);
  check(`${P} タイトル「はじめから」（歴史分岐）→ 第一章の城下`, (await st(page))?.phase === 'explore' && (await page.evaluate(() => window.__game.scenario)) === 'ieyasu1570');
  await council1(page, io, P, policy);
  await pledge1(page, io, P, c.giver, c.answer);
  await depart1(page, io, P);
  await shot(page, `${P}-1-briefing`);
  await io.press('.b-primary:has-text("合戦を始める")');
  const B = battleIO(page, io);
  await B.init();
  await B.pause();
  await drive(page, B, rulesCh1(policy, page, B, P));
  check(`${P} 第一章の合戦：命令はすべて画面の入力（移動は「移動」→ 地面）。押す前後で能力の使用・ほかの部隊の命令が変わっていない`, B.issues.length === 0, `${B.summary()}${B.issues.length ? '／' + B.issues.join(' | ') : ''}${B.refused.length ? `／出せずに押し直した ${B.refused.length}` : ''}`);
  const { out, text } = await waitResultPanel(page);
  await shot(page, `${P}-1-result`);
  check(`${P} 第一章の合戦の結果：${c.want.result}・約束 ${c.want.pledge}`, out.result === c.want.result && (out.pledge?.result ?? 'declined') === c.want.pledge, `${out.result}/${out.reason}/${out.pledge?.result ?? '(約束なし)'}・合戦 ${out.elapsedSec?.toFixed(0)} 秒`);
  const sv = await saved(page);
  check(`${P} 第一章の結果の画面の時点で戦後の自動保存（版 3・反映済み）`, sv?.version === 3 && sv.point === 'aftermath' && sv.appliedBattleId === sv.battleId);
  await continueFromResult(page, io);
  const u = await talkTo(page, 'tadakatsu', io);
  check(`${P} 第一章の戦後：忠勝と話して「この章を締めくくる」`, u.choices.includes('end_chapter'), u.seenId);
  await io.pick('end_chapter');
  await waitUi(page, 'ending');
  await sleep(300);
  const s = await st(page);
  const e = await ui(page);
  const sv2 = await saved(page);
  check(`${P} 第一章の結末（${c.want.ending}）・保存は版 3・時点 ending`, s.ending === c.want.ending && sv2?.version === 3 && sv2.point === 'ending' && sv2.phase === 'ending', `${s.ending}・兵 ${J(s.troops)}・信頼 ${J(s.trust)}`);
  const sel = await page.evaluate(() => document.querySelector('.g-layer[data-kind="ending"] .g-btn.sel')?.dataset.id ?? null);
  check(`${P} 第一章の結末の画面は残り、下に「第二章へ進む」（既定）と「タイトルへ」`, J(e.buttons.map((b) => b.id)) === '["next_chapter","title"]' && sel === 'next_chapter' && e.text.includes('史実と創作'), J({ ids: e.buttons.map((b) => b.id), sel }));
  await shot(page, `${P}-1-ending`);
  note(`${P} 第一章：実時間 ${((Date.now() - w0) / 1000).toFixed(0)} 秒・合戦の時間 ${out.elapsedSec?.toFixed(0)} 秒・${out.result}`);
  return { ch1: s, endingRaw: await raw(page, KEY), out };
}

// ================================================================ 第二章を通す（結末 →「第二章へ進む」→ 区切り → タイトル）
const CH2 = {
  oda: { plan: 'commit', recovery: 'wait', tactic: 'rear_hold', enter: 'enter' },
  asai: { plan: 'hold', recovery: 'transfer', tactic: 'west', enter: 'click' },
  home: { plan: 'commit', recovery: 'none', tactic: 'trap', enter: 'tap' },
};
async function chapter2(page, io, P, policy, ch1) {
  const c = CH2[policy];
  const w0 = Date.now();
  note(`--- ${P} 第二章（判断 ${c.plan}・補充 ${c.recovery}・作戦 ${c.tactic}。本物の入力。合戦の待つ間だけ早送り）`);
  // 1. 「第二章へ進む」（保存の書き込みを数える）
  await countWrites(page);
  if (c.enter === 'enter') { await sleep(500); await page.keyboard.press('Enter'); }
  else await io.btn('next_chapter');
  await waitUi(page, 'record');
  await sleep(400);
  const w = await writes(page);
  const r = await ui(page);
  check(`${P} 「第二章へ進む」（${c.enter === 'enter' ? 'Enter' : c.enter === 'tap' ? 'タップ' : 'クリック'}）→「第一章の結果（第二章へ引き継ぐもの）」（ボタンは「城下へ」）`, r.text.includes('第一章の結果（第二章へ引き継ぐもの）') && J(r.buttons.map((b) => b.id)) === '["to_town"]');
  const sv = await saved(page);
  const b1 = await saved(page, KEY_CH1);
  const e1 = JSON.parse(ch1.endingRaw);
  const same1 = ['scenario', 'phase', 'policy', 'trust', 'troops', 'characters', 'pledge', 'battle', 'battleId', 'appliedBattleId', 'support', 'sideObjectives', 'ending'].filter((k) => J(b1?.[k]) !== J(e1[k]));
  check(`${P} 移るときの保存：本来のキーは版 4・時点 chapter・第一章の控え（…/chapter1）は第一章の結末（版 3）と同じ中身・書き込みは各 1 回`,
    sv?.version === 4 && sv.chapter === 2 && sv.point === 'chapter' && b1?.version === 3 && b1.point === 'ending' && same1.length === 0 && w[KEY] === 1 && w[KEY_CH1] === 1,
    `書き込み ${J(w)}${same1.length ? `・違う ${same1.join(',')}` : ''}`);
  await shot(page, `${P}-2-record`);
  await io.btn('to_town');
  await waitScreen(page, 'explore');
  await sleep(500);
  const s0 = await st(page);
  check(`${P} 第二章の城下：第二章のはじめの兵＝第一章の終わりの兵（援兵 ${e1.support?.reinforcement ? 'は第一章で受け取り済み。足さない' : 'なし'}）・判断と条件はまだ無い`,
    s0.chapter === 2 && s0.phase === 'explore' && J(s0.troops) === J(e1.troops) && J(s0.chapter1.troops) === J(e1.troops) && s0.plan === null && s0.terms === null && s0.recovery === null,
    `兵 ${J(s0.troops)}`);
  await shot(page, `${P}-2-town`);
  // 2. 城下で歩いて話す
  let u = await talkTo(page, 'ishikawa', io);
  check(`${P} 第二章の城下：石川数正（歩いて話す）`, (u.seenId ?? '').startsWith('ch2.explore.ishikawa'), u.seenId);
  await waitScreen(page, 'explore');
  u = await talkTo(page, 'envoy', io);
  const pl = e1.pledge?.result ?? 'declined';
  check(`${P} 第二章の城下：使い（歩いて話す。第一章の約束 ${pl} で言い方が変わる）`, (u.seenId ?? '').startsWith(`ch2.explore.envoy.${policy}`) && (u.seenId ?? '').includes(pl === 'declined' && policy === 'home' ? '' : pl), u.seenId);
  await waitScreen(page, 'explore');
  u = await talkTo(page, 'tadakatsu', io);
  check(`${P} 第二章の城下：本多忠勝（歩いて話す）→ 軍議を開く`, (u.choices ?? []).includes('open_council'), u.seenId);
  // 3. 軍議
  await io.pick('open_council');
  await waitScreen(page, 'council');
  u = await readThrough(page, io.next);
  const planText = await choiceText(page, `plan_${c.plan}`);
  check(`${P} 軍議：判断の選択肢に「この判断で確定する主目標」`, planText.includes('この判断で確定する主目標') && (u.choices ?? []).includes(`plan_${c.plan}`), planText.slice(0, 140));
  await shot(page, `${P}-2-council`);
  await io.pick(`plan_${c.plan}`);
  u = await readThrough(page, io.next);
  check(`${P} 軍議の確かめ：決めると主目標の条件が確定する（決める前は条件が無い）`, u.seen.some((l) => l.includes('決めると主目標の条件が確定する')) && (await st(page)).terms === null, u.seenId);
  await io.pick('confirm_plan');
  await waitScreen(page, 'explore');
  const sm = await st(page);
  const termsJ = J(sm.terms);
  const expect = await page.evaluate(async () => {
    const b = await import('/src/campaign/ieyasu1570/chapter2/battle.ts');
    const s = window.__game.state;
    return JSON.stringify(b.ch2DecideTerms(s.policy, s.plan, s.chapter1.troops));
  });
  check(`${P} 判断を決めた時に主目標の条件が確定（第一章の終わりの兵を基準に求めた値と同じ）`, sm.plan === c.plan && sm.terms?.plan === c.plan && termsJ === expect, termsJ);
  // 4. 支度：補充
  u = await talkTo(page, 'ishikawa', io);
  const opts = ['recovery_wait', 'recovery_transfer', 'recovery_none'].filter((x) => (u.choices ?? []).includes(x));
  const texts = {};
  for (const o of opts) texts[o] = await choiceText(page, o);
  check(`${P} 支度の石川数正：補充の選択肢（選ぶ前に代償。どれも「主目標の条件は軍議で決めたまま変わらない」）`, opts.includes(`recovery_${c.recovery}`) && opts.every((o) => texts[o].includes('主目標の条件は軍議で決めたまま変わらない')) && (!texts.recovery_wait || texts.recovery_wait.includes('→')),
    `${opts.join(',')}｜${(texts.recovery_wait ?? '').slice(0, 120)}`);
  await shot(page, `${P}-2-recovery`);
  const tBefore = sm.troops;
  const rc = opts.includes(`recovery_${c.recovery}`) ? c.recovery : (opts[0] ?? 'recovery_none').replace('recovery_', '');
  if (rc !== c.recovery) note(`！補充「${c.recovery}」が選べないので「${rc}」で進める`);
  c.recovery = rc;
  await io.pick(`recovery_${c.recovery}`);
  await waitScreen(page, 'explore');
  const sr = await st(page);
  const applied = Object.keys(tBefore).every((k) => sr.troops[k] === tBefore[k] + (sr.recovery?.delta?.[k] ?? 0));
  check(`${P} 補充「${c.recovery}」：兵は記録の増減のぶん 1 回だけ変わる・主目標の条件は同じ`, sr.recovery?.choice === c.recovery && applied && J(sr.terms) === termsJ, `${J(tBefore)} → ${J(sr.troops)}（増減 ${J(sr.recovery?.delta)}）`);
  u = await talkTo(page, 'ishikawa', io);
  const s2 = await st(page);
  check(`${P} もう一度石川と話す：補充はもう選べない・兵は増えない`, !(u.choices ?? []).some((x) => x.startsWith('recovery_')) && J(s2.troops) === J(sr.troops), u.seenId);
  await waitScreen(page, 'explore');
  // 5. 支度でメニューから保存 → 読み込み直し（支度で 1 回）
  await io.menu();
  await waitUi(page, 'menu');
  await io.btn('save');
  await page.waitForFunction(() => window.__game.ui?.kind === 'menu' && window.__game.ui.text.includes('保存しました'), null, POLL);
  await io.btn('close');
  await waitScreen(page, 'explore');
  const svm = await saved(page);
  check(`${P} 支度：メニューから保存（版 4・確定した条件と補充の記録が入る）`, svm?.version === 4 && svm.point === 'manual' && J(svm.terms) === termsJ && svm.recovery?.choice === c.recovery, J({ v: svm?.version, point: svm?.point }));
  await reloadToTitle(page);
  const ct = await page.locator('.g-btn[data-id="continue:ieyasu1570"]').textContent();
  await io.btn('continue:ieyasu1570');
  await waitScreen(page, 'explore');
  const s3 = await st(page);
  check(`${P} 支度で読み込み直す（つづきから「${ct.replace(/\s+/g, ' ').slice(0, 30)}」）：兵・補充・条件が同じ（二重に足さない）`, s3.chapter === 2 && s3.phase === 'muster' && J(s3.troops) === J(sr.troops) && s3.recovery?.choice === c.recovery && J(s3.terms) === termsJ, J(s3.troops));
  // 6. 城門 → 出陣
  u = await walkToGate(page, io);
  check(`${P} 城門（歩いて）：判断・補充・出る部隊・支援・確定した主目標をまとめて見せる`, u.seenId === 'ch2.muster.gate' && (u.choices ?? []).includes('depart') && u.seen.join(' ').includes('主目標（軍議で確定）'), u.seen.join(' / ').slice(0, 160));
  await io.pick('depart');
  await page.waitForFunction(() => window.__game.screen === 'battle' && !!window.__battle?.state, null, POLL);
  const dep = await saved(page);
  check(`${P} 出陣前の自動保存（版 4・departure・条件は同じ）`, dep?.version === 4 && dep.point === 'departure' && J(dep.terms) === termsJ && !!dep.battleId && dep.appliedBattleId === null);
  await page.waitForFunction(() => window.__battle?.active && window.__battle.ui.modal === 'briefing' && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
  await sleep(400);
  // 7. 合戦の設定：状態の兵・確定した条件から（支援は兵に足さない）
  const bs = await page.evaluate(async () => {
    const R = await import('/src/campaign/ieyasu1570/chapter2/rules.ts');
    const s = window.__game.state;
    const setup = window.__battle.state.setup;
    const info = R.ieyasu2BattleInfo(s);
    const pick = (us) => us.map((u) => ({ id: u.id, side: u.side, clan: u.clan, name: u.name, strength: u.strength, morale: u.morale, x: u.x, z: u.z }));
    return {
      units: pick(setup.units),
      sameUnits: JSON.stringify(pick(setup.units)) === JSON.stringify(pick(info.setup.units)),
      sameObj: JSON.stringify(setup.objectives) === JSON.stringify(info.setup.objectives),
      primary: setup.objectives.primary,
      support: info.support,
      troops: s.troops,
      map: setup.map.id,
    };
  });
  const tok = bs.units.filter((x) => UNIT_OF[x.id]);
  const strengthOk = tok.every((x) => x.strength === (x.id === 't_honjin' ? Math.max(50, bs.troops.honjin) : bs.troops[UNIT_OF[x.id]]));
  const objOk = policy === 'asai' ? bs.primary.minRatio === sm.terms.escortMinRatio : policy === 'home' ? bs.primary.sec === sm.terms.holdSec : true;
  check(`${P} 合戦の設定は状態の兵と確定した条件から（主目標・始めの陣が同じ・徳川の兵＝今の兵・支援は部隊として出るだけ）`,
    bs.map.startsWith('ieyasu2_') && bs.sameUnits && bs.sameObj && strengthOk && objOk && J(bs.troops) === J(s3.troops),
    `主目標 ${bs.primary.label}・支援 ${bs.support.join(',') || 'なし'}・部隊 ${bs.units.filter((x) => x.side === 'ally').map((x) => `${x.name}${x.strength}`).join('・')}`);
  const brief = await page.textContent('.b-modal');
  check(`${P} 合戦の前の説明：第一章の直後の分岐した世界の創作`, brief.includes('第一章の直後'), brief.slice(0, 80));
  await shot(page, `${P}-2-briefing`);
  // 8. 合戦（本物の入力。待つ間だけ早送り）
  await io.press('.b-primary:has-text("合戦を始める")');
  const B = battleIO(page, io);
  await B.init();
  await B.pause();
  await sleep(300);
  await shot(page, `${P}-2-battle`);
  const drv = await driveTactic(page, B, policy, c.tactic);
  check(`${P} 第二章の合戦：命令はすべて画面の入力（移動は「移動」→ 地面）。押す前後で能力の使用・ほかの部隊の命令が変わっていない`, B.issues.length === 0, `${B.summary()}${B.issues.length ? '／' + B.issues.join(' | ') : ''}${B.refused.length ? `／出せなかった ${B.refused.join(' | ')}` : ''}`);
  const { out, text } = await waitResultPanel(page);
  await shot(page, `${P}-2-result`);
  const aft = await saved(page);
  const res = aft?.result;
  const sortieN = res ? Object.values(res.sortieTroops).reduce((a, b) => a + b, 0) : 0;
  const lostN = res ? Object.values(res.lost).reduce((a, b) => a + b, 0) : 0;
  const side = (res?.secondary ?? []).map((o) => `${o.label}${o.achieved ? '○' : '×'}`).join('・');
  check(`${P} 第二章の合戦：作戦 ${c.tactic} で勝利（主目標）`, out.result === 'victory' && res?.primary?.achieved === true, `${out.result}/${out.reason}・合戦 ${out.elapsedSec?.toFixed(1)} 秒・出陣 ${sortieN}・失った ${lostN}・残った ${sortieN - lostN}・副目標 ${side}`);
  check(`${P} 結果の画面の時点で戦後の自動保存（版 4・aftermath・反映済み・条件は同じ・副目標は主目標と別の欄）`,
    aft?.version === 4 && aft.point === 'aftermath' && aft.appliedBattleId === aft.battleId && J(aft.terms) === termsJ && Array.isArray(res?.secondary) && res.thin === sm.terms.thin);
  check(`${P} 結果の画面：第一章の約束の欄は出ない`, !text.includes('約束を守った') && !text.includes('約束を守れなかった'), text.slice(0, 80));
  // 9. 「続ける」の連打（クリック／タップ 6 回＋Enter 4 回）→ 戦後の反映は 1 回
  const trustBefore = s3.trust;
  await countWrites(page);
  const btn = page.locator('.b-primary', { hasText: '続ける' });
  const box = await btn.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (io.phone) {
    for (let k = 0; k < 6; k++) await page.touchscreen.tap(cx, cy).catch(() => {});
    for (let k = 0; k < 4; k++) await page.keyboard.press('Enter').catch(() => {});
  } else {
    await Promise.all([
      ...Array.from({ length: 6 }, () => page.mouse.click(cx, cy).catch(() => {})),
      ...Array.from({ length: 4 }, () => page.keyboard.press('Enter').catch(() => {})),
    ]);
  }
  await page.waitForFunction(() => window.__game.screen === 'explore' && !document.body.classList.contains('mode-battle') && !document.getElementById('battle-ui'), null, POLL);
  await sleep(1500);
  const sa = await st(page);
  const wa = await writes(page);
  // 守備隊を出したかは、実際に出陣した部隊（戦後の記録の sortie）で決まる（4 つ目の引数。省くと判断 1 なら出たとみなす）
  const reserveOut = (res?.sortie ?? []).includes('reserve');
  const want = await page.evaluate(async ([p, plan, r, ro]) => (await import('/src/campaign/ieyasu1570/chapter2/rules.ts')).ch2TrustDelta(p, plan, r, ro), [policy, c.plan, out.result, reserveOut]);
  const trustOk = Object.keys(want).every((k) => sa.trust[k] === Math.max(-100, Math.min(100, trustBefore[k] + want[k])));
  check(`${P} 「続ける」の連打（${io.phone ? 'タップ' : 'クリック'} 6 回＋Enter 4 回）：戦後の反映は 1 回（信頼の動きは 1 回分・保存を書き直さない）`,
    sa.phase === 'aftermath' && sa.appliedBattleId === sa.battleId && trustOk && !wa[KEY], `信頼 ${J(trustBefore)} → ${J(sa.trust)}（動き ${J(want)}）・書き込み ${J(wa)}`);
  // 10. 戦後で読み込み直す（戦後で 1 回）
  await reloadToTitle(page);
  const c2 = await page.locator('.g-btn[data-id="continue:ieyasu1570"]').textContent();
  await io.btn('continue:ieyasu1570');
  await waitScreen(page, 'explore');
  const s4 = await st(page);
  check(`${P} 戦後で読み込み直す（つづきから「第二章・戦の後」）：信頼・兵・条件・反映済みの合戦が同じ`, c2.includes('第二章・戦の後') && s4.phase === 'aftermath' && J(s4.trust) === J(sa.trust) && J(s4.troops) === J(sa.troops) && J(s4.terms) === termsJ && s4.appliedBattleId === sa.appliedBattleId, c2.replace(/\s+/g, ' ').slice(0, 60));
  // 11. 締めくくる → 区切り → タイトル
  u = await talkTo(page, 'tadakatsu', io);
  check(`${P} 第二章の戦後：忠勝（歩いて話す）→「第二章を締めくくる」`, (u.choices ?? []).includes('end_chapter'), u.seenId);
  await io.pick('end_chapter');
  await waitUi(page, 'ending');
  await sleep(300);
  const e2 = await ui(page);
  const se = await saved(page);
  check(`${P} 第二章の区切り：ボタンは「タイトルへ」だけ・判断・補充・主目標・合戦の兵・史実と創作`, J(e2.buttons.map((b) => b.id)) === '["title"]' && ['第二章', '判断', '補充', '主目標', '合戦の兵', '史実と創作'].every((x) => e2.text.includes(x)) && !/姉川|金ヶ崎|小谷|単騎|無傷/.test(e2.text) && se?.version === 4 && se.point === 'ending', (await st(page)).ending);
  await shot(page, `${P}-2-ending`);
  await io.btn('title');
  await waitTitle(page);
  const c3 = await page.locator('.g-btn[data-id="continue:ieyasu1570"]').textContent();
  check(`${P} タイトル：「つづきから」の説明は第二章の区切り`, c3.includes('第二章の区切り') && !c3.includes('章の結末'), c3.replace(/\s+/g, ' ').slice(0, 60));
  const keys = await rawKeys(page);
  check(`${P} 保存のキーは 5 つ（歴史分岐・第一章の控え・2D・架空・演習）。2D・架空・演習は 1 文字も変わらない`, J(keys) === J([KEY2D, FKEY, PKEY, KEY, KEY_CH1].sort()) && (await sentinelsKept(page)), J(keys));
  note(`${P} 第二章：実時間 ${((Date.now() - w0) / 1000).toFixed(0)} 秒・合戦 ${out.result}（${out.reason}）${out.elapsedSec?.toFixed(1)} 秒・出陣 ${sortieN}・失った ${lostN}・残った ${sortieN - lostN}・副目標 ${side}・条件 ${termsJ}`);
  return { out, res, terms: sm.terms };
}

async function chain(policy) {
  const P = `chain:${policy}`;
  const phone = policy === 'home';
  console.log(`=== ${P}（${phone ? 'スマホ横 844×390・タッチ' : policy === 'asai' ? 'PC 1280×720・マウス' : 'PC 1280×720・キーとマウス'}）：第一章の開始 → 第二章の区切り`);
  const w0 = Date.now();
  const { ctx, page } = phone ? await open({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true }) : await open();
  const io = phone ? await phoneIO(ctx, page) : policy === 'asai' ? mouseIO(page) : desktopIO(page);
  await seed(page, null);
  note('（直接状態変更）見張りの保存（2D・架空の第一章 版 1・演習）を localStorage に入れた。歴史分岐の保存は無し');
  const ch1 = await chapter1(page, io, P, policy);
  const r2 = await chapter2(page, io, P, policy, ch1);
  await ctx.close();
  note(`${P} 通し：実時間 ${((Date.now() - w0) / 1000).toFixed(0)} 秒`);
  return r2;
}

// ================================================================ compare：同じ方針（A）で第一章の結果が違う保存
async function compare() {
  console.log('=== compare（PC）：A 織田の第一章の結末の保存 3 つ（直接状態変更で入れる）から第二章へ。結果確認・会話・軍議・説明・部隊を並べる');
  const rows = [];
  for (const name of ['oda_victory_kept', 'oda_retreat_declined', 'oda_defeat_broken_heavy']) {
    const { ctx, page } = await open();
    const io = desktopIO(page);
    await seed(page, fixture(name));
    await io.btn('continue:ieyasu1570');
    await waitUi(page, 'ending');
    await io.btn('next_chapter');
    await waitUi(page, 'record');
    await sleep(300);
    const rec = (await ui(page)).text;
    await io.btn('to_town');
    await waitScreen(page, 'explore');
    const s0 = await st(page);
    const ik = await talkDev(page, io, 'ishikawa');
    await waitScreen(page, 'explore');
    const ev = await talkDev(page, io, 'envoy');
    await waitScreen(page, 'explore');
    await talkDev(page, io, 'tadakatsu');
    await io.pick('open_council');
    await waitScreen(page, 'council');
    const cu = await readThrough(page, io.next);
    const plans = {};
    for (const p of cu.choices ?? []) plans[p] = await choiceText(page, p);
    await io.pick('plan_commit');
    await readThrough(page, io.next);
    await io.pick('confirm_plan');
    await waitScreen(page, 'explore');
    const terms = (await st(page)).terms;
    await talkDev(page, io, 'ishikawa');
    await io.pick('recovery_none');
    await waitScreen(page, 'explore');
    await talkDev(page, io, 'gate');
    await io.pick('depart');
    await page.waitForFunction(() => window.__battle?.active && window.__battle.ui.modal === 'briefing' && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
    await sleep(400);
    const brief = await page.textContent('.b-modal');
    const units = await page.evaluate(() => window.__battle.state.setup.units.filter((u) => u.side === 'ally').map((u) => `${u.name} ${u.strength}（士気 ${u.morale}）`));
    const foe = await page.evaluate(() => window.__battle.state.setup.units.filter((u) => u.side === 'enemy').reduce((n, u) => n + u.strength, 0));
    await shot(page, `compare-${name}-briefing`);
    const row = { name, troops: s0.troops, trust: s0.trust, rec, ishikawa: ik.seenId, ikLines: ik.seen.join(' / '), envoy: ev.seenId, plans, terms, brief, units, foe };
    rows.push(row);
    note(`[${name}] 兵 ${J(s0.troops)}・信頼 織田 ${s0.trust.oda}・石川 ${s0.trust.ishikawa}・忠勝 ${s0.trust.tadakatsu}`);
    note(`[${name}] 石川 ${ik.seenId}：${ik.seen.slice(0, 3).join(' / ').slice(0, 200)}`);
    note(`[${name}] 使者 ${ev.seenId}：${ev.seen.slice(0, 2).join(' / ').slice(0, 160)}`);
    note(`[${name}] 軍議の選択肢 ${Object.keys(plans).join(',')}：判断 1「${(plans.plan_commit ?? '').replace(/\s+/g, ' ').slice(0, 160)}」`);
    note(`[${name}] 確定した条件 ${J(terms)}`);
    note(`[${name}] 合戦の味方：${units.join('・')}・敵の兵の合計 ${foe}`);
    if (name === 'oda_defeat_broken_heavy') {
      // 損害が大きく、約束を破った保存から区切りまで（合戦は台本の早送り：命令も台本）
      await io.press('.b-primary:has-text("合戦を始める")');
      await page.waitForFunction(() => window.__battle.ui.started, null, POLL);
      const r = await page.evaluate(async () => {
        const m = await import('/src/campaign/ieyasu1570/chapter2/scripts.ts');
        const sc = m.ch2TacticScript('oda', 'rear_hold', window.__battle.state.setup);
        window.__battle.pause(true);
        let res = null;
        for (let i = 0; i < 120 && !res; i++) res = window.__battle.fastForward(10, sc).result;
        return res && { result: res.result, reason: res.reason, t: res.elapsedSec, refused: sc.log.refused };
      });
      note(`（台本・早送り）ch2TacticScript('oda', 'rear_hold')：合戦の時間 ${r?.t?.toFixed(1)} 秒で ${r?.result}（${r?.reason}）・断られた命令 ${r?.refused?.length}`);
      await page.waitForFunction(() => window.__battle.ui.resultShown && document.querySelector('.b-result'), null, POLL);
      await sleep(400);
      await io.press('.b-primary:has-text("続ける")');
      await page.waitForFunction(() => window.__game.screen === 'explore' && !document.getElementById('battle-ui'), null, POLL);
      const ua = await talkDev(page, io, 'tadakatsu');
      await io.pick('end_chapter');
      await waitUi(page, 'ending');
      const e2 = await ui(page);
      check('compare 損害が大きく約束を破った保存（A）から、第二章の区切りまで進める（合戦は台本の早送り）', r?.result === 'victory' && J(e2.buttons.map((b) => b.id)) === '["title"]' && e2.text.includes('第二章'), `${r?.result}・${ua.seenId}・${(await st(page)).ending}`);
      await shot(page, 'compare-heavy-ch2-ending');
    }
    await ctx.close();
  }
  const [v, rt, d] = rows;
  check('compare 結果確認の画面が 3 つとも違う（勝ち・守った／撤退・引き受けなかった／敗北・破った・損害大）', v.rec !== rt.rec && rt.rec !== d.rec && v.rec.includes('守った') && rt.rec.includes('引き受けなかった') && d.rec.includes('守れなかった'));
  check('compare 第二章のはじめの兵が違う（第一章の損害）', J(v.troops) !== J(rt.troops) && J(rt.troops) !== J(d.troops), `${J(v.troops)} / ${J(rt.troops)} / ${J(d.troops)}`);
  check('compare 使者の言い方が約束の結果で違う（守った・引き受けなかった・破った）', v.envoy !== rt.envoy && rt.envoy !== d.envoy && v.envoy.includes('kept') && rt.envoy.includes('declined') && d.envoy.includes('broken'), `${v.envoy} / ${rt.envoy} / ${d.envoy}`);
  check('compare 石川の言う兵の数が違う', v.ikLines !== rt.ikLines && rt.ikLines !== d.ikLines);
  check('compare 軍議の選択肢（確定する条件）が違う。損害大は判断 2 が出ず、兵が少ないときの条件', v.plans.plan_commit !== d.plans.plan_commit && !!v.plans.plan_hold && !d.plans.plan_hold && v.terms.thin === false && d.terms.thin === true, `${J(v.terms)} / ${J(d.terms)}`);
  check('compare 合戦の前の説明が違う（敵の勢い・支援・兵が少ないとき）', v.brief !== rt.brief && rt.brief !== d.brief);
  check('compare 合戦の部隊が違う：勝ち・守った（織田の信頼 ≥ 50）は織田の鉄砲隊、ほかは無い。兵・士気・敵の兵の合計も違う', v.units.some((x) => x.includes('鉄砲')) && !rt.units.some((x) => x.includes('鉄砲')) && !d.units.some((x) => x.includes('鉄砲')) && J(v.units) !== J(rt.units) && J(rt.units) !== J(d.units) && v.foe < rt.foe && rt.foe < d.foe, `敵 ${v.foe} / ${rt.foe} / ${d.foe}`);
}

// ================================================================ idem：二重に適用しない・保存の失敗
async function idem() {
  console.log('=== idem（PC）：「第二章へ進む」の連打・移った直後の読み込み直し・補充の後の読み込み直し・移るときの保存の容量の失敗・版 1／版 2 の結末から');
  // (1) 連打 → 1 回だけ移る
  {
    const { ctx, page } = await open();
    const io = desktopIO(page);
    const src = fixture('home_victory_kept');
    await seed(page, src);
    await io.btn('continue:ieyasu1570');
    await waitUi(page, 'ending');
    await sleep(600);
    await countWrites(page);
    const box = await page.locator('.g-btn[data-id="next_chapter"]').boundingBox();
    await Promise.all([
      ...Array.from({ length: 6 }, () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {})),
      ...Array.from({ length: 4 }, () => page.keyboard.press('Enter').catch(() => {})),
    ]);
    await page.waitForFunction(() => window.__game.state?.chapter === 2 && (window.__game.ui?.kind === 'record' || window.__game.screen === 'explore'), null, POLL);
    await sleep(1500);
    const w = await writes(page);
    const r = await ui(page);
    check('idem 「第二章へ進む」の連打（クリック 6 回＋Enter 4 回）：移るのは 1 回（本来のキー・控えのキーへの書き込みは各 1 回）', w[KEY] === 1 && w[KEY_CH1] === 1 && (await st(page)).chapter === 2, `${J(w)}・今の画面 ${r?.kind ?? (await page.evaluate(() => window.__game.screen))}`);
    const ch1raw = await raw(page, KEY_CH1);
    const v4raw = await raw(page, KEY);
    // (2) 移った直後（結果確認の画面）に読み込み直す
    await reloadToTitle(page);
    const ct = await page.locator('.g-btn[data-id="continue:ieyasu1570"]').textContent();
    await io.btn('continue:ieyasu1570');
    await waitScreen(page, 'explore');
    const s = await st(page);
    check('idem 移った直後に読み込み直す → つづきから「第二章の始め」→ 第二章の城下（移る処理・結果確認をもう一度通らない。読むだけでは書かない）',
      ct.includes('第二章') && s.chapter === 2 && s.phase === 'explore' && (await raw(page, KEY)) === v4raw && (await raw(page, KEY_CH1)) === ch1raw, ct.replace(/\s+/g, ' ').slice(0, 60));
    // (3) 補充を答えた後に、保存せずに読み込み直す → 補充は残らない（兵は第一章の終わりのまま。二重にならない）
    const t0 = s.troops;
    await talkDev(page, io, 'tadakatsu');
    await io.pick('open_council');
    await waitScreen(page, 'council');
    await readThrough(page, io.next);
    await io.pick('plan_commit');
    await readThrough(page, io.next);
    await io.pick('confirm_plan');
    await waitScreen(page, 'explore');
    const termsJ = J((await st(page)).terms);
    await talkDev(page, io, 'ishikawa');
    await io.pick('recovery_wait');
    await waitScreen(page, 'explore');
    const sw = await st(page);
    check('idem 補充「待つ」：兵が戻る（1 回）', sw.recovery?.choice === 'wait' && J(sw.troops) !== J(t0), `${J(t0)} → ${J(sw.troops)}`);
    await reloadToTitle(page);
    await io.btn('continue:ieyasu1570');
    await waitScreen(page, 'explore');
    const sn = await st(page);
    check('idem 補充を答えた後、保存せずに読み込み直す → 最後の保存（第二章の始め）から。兵は第一章の終わりのまま（補充は残らず、二重にもならない）', sn.phase === 'explore' && sn.recovery === null && sn.terms === null && J(sn.troops) === J(t0));
    // (3') 答えて、メニューから保存して読み込み直す → 兵は 1 回分・もう選べない・条件が同じ
    await talkDev(page, io, 'tadakatsu');
    await io.pick('open_council');
    await waitScreen(page, 'council');
    await readThrough(page, io.next);
    await io.pick('plan_commit');
    await readThrough(page, io.next);
    await io.pick('confirm_plan');
    await waitScreen(page, 'explore');
    check('idem もう一度軍議で同じ判断を決める → 同じ条件', J((await st(page)).terms) === termsJ);
    await talkDev(page, io, 'ishikawa');
    await io.pick('recovery_wait');
    await waitScreen(page, 'explore');
    const sw2 = await st(page);
    await io.menu();
    await waitUi(page, 'menu');
    await io.btn('save');
    await page.waitForFunction(() => window.__game.ui?.kind === 'menu' && window.__game.ui.text.includes('保存しました'), null, POLL);
    await io.btn('close');
    await waitScreen(page, 'explore');
    for (const n of [1, 2]) {
      await reloadToTitle(page);
      await io.btn('continue:ieyasu1570');
      await waitScreen(page, 'explore');
      const u = await talkDev(page, io, 'ishikawa');
      const sx = await st(page);
      check(`idem 補充の後に保存して読み込み直す（${n} 回目）：兵は 1 回分・補充はもう選べない・条件が同じ`, J(sx.troops) === J(sw2.troops) && J(sw2.troops) === J(sw.troops) && sx.recovery?.choice === 'wait' && !(u.choices ?? []).some((x) => x.startsWith('recovery_')) && J(sx.terms) === termsJ, `${J(sx.troops)}・${u.seenId}`);
      await waitScreen(page, 'explore');
    }
    await ctx.close();
  }
  // (4) 移るときの保存に容量の失敗（本来のキーへの版 4 の書き込みで QuotaExceededError）
  {
    const { ctx, page } = await open();
    const io = desktopIO(page);
    const src = fixture('asai_retreat_declined');
    await seed(page, src);
    await io.btn('continue:ieyasu1570');
    await waitUi(page, 'ending');
    note('（直接状態変更）setItem を包み、本来のキーへの版 4 の書き込みを QuotaExceededError にする');
    await page.evaluate((key) => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === key && String(v).includes('"version":4')) throw new DOMException('full', 'QuotaExceededError');
        return orig.call(this, k, v);
      };
    }, KEY);
    await io.btn('next_chapter');
    await waitUi(page, 'confirm');
    const cf = await ui(page);
    const b1 = await saved(page, KEY_CH1);
    check('idem 移るときの保存に容量の失敗 → 確認（保存せずに始める／結末の画面へ戻る）。本来のキーは第一章の結末のまま・控えはある',
      cf.text.includes('第二章の始めを保存できませんでした') && cf.text.includes('第一章の保存はそのまま残っています') && J(cf.buttons.map((b) => b.id)) === '["go","back"]' && (await raw(page, KEY)) === src && b1?.version === 3 && b1.phase === 'ending', cf.text.slice(0, 120));
    await io.btn('back');
    await waitUi(page, 'ending');
    check('idem 「結末の画面へ戻る」→ 第一章の結末の画面（本来のキーはそのまま）', (await raw(page, KEY)) === src && J((await ui(page)).buttons.map((b) => b.id)) === '["next_chapter","title"]');
    await io.btn('next_chapter');
    await waitUi(page, 'confirm');
    await io.btn('go');
    await waitUi(page, 'record');
    await io.btn('to_town');
    await waitScreen(page, 'explore');
    const s = await st(page);
    check('idem 「保存せずに第二章を始める」→ 第二章の城下（本来のキーは第一章の結末のまま）', s.chapter === 2 && s.phase === 'explore' && (await raw(page, KEY)) === src);
    await reloadToTitle(page);
    const ct = await page.locator('.g-btn[data-id="continue:ieyasu1570"]').textContent();
    check('idem 読み込み直すと、つづきからは第一章の結末（もう一度「第二章へ進む」から）', ct.includes('章の結末') && !ct.includes('第二章'), ct.replace(/\s+/g, ' ').slice(0, 60));
    await ctx.close();
  }
  // (5) 版 1・版 2 の第一章の結末の保存から「第二章へ進む」
  for (const [label, file, name, policy] of [['版 1', 'proto3d-ieyasu-save-v1-fixtures.ts', 'IEYASU_V1_ENDING_ASAI', 'asai'], ['版 2', 'proto3d-ieyasu-save-v2-fixtures.ts', 'IEYASU_V2_ENDING_HOME', 'home']]) {
    const { ctx, page } = await open();
    const io = desktopIO(page);
    const src = tsConst(file, name);
    await seed(page, src);
    const ct = await page.locator('.g-btn[data-id="continue:ieyasu1570"]').textContent();
    await io.btn('continue:ieyasu1570');
    await waitUi(page, 'ending');
    check(`idem ${label}の結末の保存：読むだけでは書き換えない・結末の画面に「第二章へ進む」`, (await raw(page, KEY)) === src && J((await ui(page)).buttons.map((b) => b.id)) === '["next_chapter","title"]' && ct.includes('章の結末'));
    await io.btn('next_chapter');
    await waitUi(page, 'record');
    await io.btn('to_town');
    await waitScreen(page, 'explore');
    const s = await st(page);
    const sv = await saved(page);
    const b1 = await saved(page, KEY_CH1);
    const v = JSON.parse(src);
    check(`idem ${label}の結末から第二章へ：版 4・方針 ${policy}・兵は${label}の兵のまま・控えは版 3 の結末`, s.chapter === 2 && s.policy === policy && J(s.troops) === J(v.troops) && sv?.version === 4 && b1?.version === 3 && b1.phase === 'ending', J(s.troops));
    await ctx.close();
  }
}

// ================================================================ regress
async function regress() {
  console.log('=== regress（PC）：架空の章の結末・第一章の結末で「タイトルへ」');
  const { ctx, page } = await open();
  const io = desktopIO(page);
  await page.evaluate(() => window.__game.setPhase('ending', 'tashiro', 'victory'));
  await waitUi(page, 'ending');
  const e = await ui(page);
  check('regress 架空の章の結末はボタン 1 つ（タイトルへ）（直接状態変更 __game.setPhase で結末を出した）', J(e.buttons.map((b) => b.id)) === '["title"]' && !e.text.includes('第二章へ進む'));
  await sleep(500);
  await page.keyboard.press('Enter');
  await waitTitle(page);
  check('regress 架空の章の結末：Enter でタイトルへ（今までどおり）', true);
  const src = fixture('oda_retreat_declined');
  await seed(page, src);
  await io.btn('continue:ieyasu1570');
  await waitUi(page, 'ending');
  await io.btn('title');
  await waitTitle(page);
  const ct = await page.locator('.g-btn[data-id="continue:ieyasu1570"]').textContent();
  check('regress 第一章の結末で「タイトルへ」→ つづきからの説明は今までどおり「章の結末」・保存はそのまま・控えのキーは作らない', ct.includes('章の結末') && (await raw(page, KEY)) === src && (await raw(page, KEY_CH1)) === null, ct.replace(/\s+/g, ' ').slice(0, 60));
  await ctx.close();
}

try {
  for (const part of PARTS) {
    const t = Date.now();
    if (part.startsWith('chain:')) await chain(part.slice(6));
    else if (part === 'compare') await compare();
    else if (part === 'idem') await idem();
    else if (part === 'regress') await regress();
    else throw new Error(`PARTS が分からない：${part}`);
    note(`${part}：実時間 ${((Date.now() - t) / 1000).toFixed(0)} 秒`);
  }
} catch (e) {
  failed++;
  console.log('NG 途中で止まった：', e.stack || e.message);
}
check('ページの誤りなし', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`OK ${oks}・NG ${failed}`);
console.log(failed ? `${failed} 件 NG` : 'ALL OK');
process.exit(failed ? 1 : 0);
