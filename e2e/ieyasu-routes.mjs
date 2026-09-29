// 歴史分岐「元亀元年・家康」を 1 つのゲームとして、タイトルから結末まで本物の入力で通す（3D 版・開発サーバー）。
// 探索・会話・軍議・約束・出陣・合戦の命令と特殊能力・結果・戦後・結末・メニュー・保存は、すべて画面のクリック・キー・タップ。
//
// 合戦の中の「待つ」所だけ、開発ビルドの早送りで縮める（ソフトウェア描画では実時間で何分もかかるため）：
//   合戦を始めたら「指揮」（一時停止）にして、止めたまま window.__battle.fastForward(1) で合戦の時間を 1 秒ずつ進める。
//   その 1 秒ごとに状態を読み（読むだけ）、采配の条件がそろったら、止めたまま本物のクリック・キー・タップで命令と能力を出す。
//   出力の「早送り」は、この進め方をした区間。命令・能力・対象選びは、どれも画面の入力（状態の直接の書き換えはしない）。
//   経路 4（約束を破る勝利）だけは、合戦の命令を台本（battle/scripts.ts の ieyasuPlanScript('oda','break')）で早送りの中に出す（そう出力する）。
//
//   1（PC・キーとマウス）：A 織田 × 約束を引き受ける × 勝利・約束を守る。家康本陣の号令（「能力」ボタン）・忠勝隊の退路の守護（F）を使う。
//        支度でメニューから保存 → 開き直して続きから（方針・約束のまま）→ 出陣 → 合戦 → 結果 → 戦後 → 結末。
//   2（PC・マウス）：B 浅井 × 約束を引き受ける × 撤退・約束を守る（退いたが味方を救った）。長政隊の盟友への援護（プレイヤーが対象を選ぶ）・
//        退路の守護。結果の画面のまま開き直す → 続きから（戦後・結果と約束の結果が残る・二重に反映しない）。
//   3（スマホ横 844×390・タッチ）：C 自領 × 約束を引き受けない（中立）× 勝利。号令をタップで。戦後に開き直す → 続きから（同じ）。
//   4（PC）：A × 勝利・約束を守れなかった（経路 1 の支度の保存から続きから。合戦は台本で早送り）。
//   F（PC）：架空の第一章の古い保存（版 1・版 2）がそのまま読める（田代・大森のまま。書き換えない）。
//
// 使い方：自動再読み込みなしの開発サーバーを起動して
//   (PORT=8154 nohup npx vite --config proto3d/blender/tools/vite.nohmr.mjs > /tmp/vite-8154.log 2>&1 &)
//   BASE3D=http://localhost:8154 node e2e/ieyasu-routes.mjs [出力先]   （ONLY=1234F などで絞る）
import { launchBrowser, outDir } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/ieyasu/routes');
const BASE = process.env.BASE3D || 'http://localhost:8154';
const ONLY = process.env.ONLY || '1234F';
const browser = await launchBrowser();
let failed = 0;
const T0 = Date.now();
const secs = () => `${((Date.now() - T0) / 1000).toFixed(0)}s`;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}  [${secs()}]`);
};
const note = (t) => console.log(`   ${t}  [${secs()}]`);
const errors = [];
const POLL = { timeout: 300000, polling: 250 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = 'koto-sengoku/3d-ieyasu1570';
const FKEY = 'koto-sengoku/3d-chapter1';
const KEY2D = 'koto-sengoku/save';
const SENT2D = '{"2d":"keep"}';
let reloading = false;
/** 経路 1 の支度でメニューから保存した保存（経路 4 がここから続ける） */
let musterSaveA = null;

// 架空の第一章の古い保存（版 1：tests/proto3d-save-v1-fixtures.ts の戦後・大森・敗北と同じ中身）
const V1_FICTIONAL = '{"version":1,"savedAt":"2026-09-28T10:00:00.000Z","point":"aftermath","playTimeSec":0,"phase":"aftermath","alliance":"omori","relations":{"tashiro":-20,"omori":0,"washio":-60},"troops":{"honjin":240,"genzo":400,"shinpachi":280,"reserve":300},"characters":{"hero":"wounded","genzo":"wounded","shinpachi":"alive","tashiro_envoy":"alive","omori_envoy":"alive","washio_gen":"alive"},"talked":{"explore.genzo":true,"explore.shinpachi":true,"council.council":true,"muster.gate":true},"battle":{"result":"defeat","reason":"ally_hq_routed","elapsedSec":300,"units":[{"id":"a_hq","side":"ally","clan":"kotosaka","startStrength":300,"endStrength":240,"status":"routed","leaderId":"hero"},{"id":"a_genzo","side":"ally","clan":"kotosaka","startStrength":500,"endStrength":400,"status":"ready","leaderId":"genzo"},{"id":"a_shinpachi","side":"ally","clan":"kotosaka","startStrength":350,"endStrength":280,"status":"ready","leaderId":"shinpachi"},{"id":"a_omori","side":"ally","clan":"omori","startStrength":400,"endStrength":320,"status":"ready","leaderId":"omori_envoy"},{"id":"e_hq","side":"enemy","clan":"washio","startStrength":350,"endStrength":280,"status":"ready","leaderId":"washio_gen"},{"id":"e_sente","side":"enemy","clan":"washio","startStrength":550,"endStrength":440,"status":"ready"},{"id":"e_yumi","side":"enemy","clan":"washio","startStrength":350,"endStrength":280,"status":"ready"},{"id":"e_tashiro","side":"enemy","clan":"tashiro","startStrength":250,"endStrength":200,"status":"ready","leaderId":"tashiro_envoy"}]},"ending":null,"explore":null}';

const V1_DEPARTURE_TASHIRO = '{"version":1,"savedAt":"2026-09-28T09:00:00.000Z","point":"departure","playTimeSec":0,"phase":"battle","alliance":"tashiro","relations":{"tashiro":10,"omori":10,"washio":-60},"troops":{"honjin":300,"genzo":500,"shinpachi":350,"reserve":300},"characters":{"hero":"alive","genzo":"alive","shinpachi":"alive","tashiro_envoy":"alive","omori_envoy":"alive","washio_gen":"alive"},"talked":{"explore.genzo":true,"explore.shinpachi":true,"council.council":true,"muster.gate":true},"battle":null,"ending":null,"explore":null}';
// ---------------------------------------------------------------- ページ
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
const ui = (page) => page.evaluate(() => window.__game.ui);
const st = (page) => page.evaluate(() => {
  const g = window.__game;
  const s = g.state;
  return s && { scenario: g.scenario, screen: g.screen, phase: s.phase, policy: s.policy, trust: s.trust, troops: s.troops, pledge: s.pledge, support: s.support, result: s.battle?.result ?? null, reason: s.battle?.reason ?? null, abilitiesUsed: s.battle?.abilitiesUsed ?? null, outcomePledge: s.battle?.pledge ?? null, battleId: s.battleId, applied: s.appliedBattleId, ending: s.ending, characters: s.characters };
});
const saved = (page, k = KEY) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), k);
const raw = (page, k) => page.evaluate((k) => localStorage.getItem(k), k);
const waitUi = (page, kind) => page.waitForFunction((k) => window.__game.ui?.kind === k, kind, POLL);
const waitScreen = (page, s) => page.waitForFunction((k) => window.__game.screen === k, s, POLL);
const shot = async (page, name) => {
  console.log(`   撮影 ${name}  [${secs()}]`);
  await page.evaluate(() => { if (!document.body.classList.contains('mode-battle')) window.__p3.renderNow(); });
  return page.screenshot({ path: `${OUT}/${name}.png`, timeout: 300000 });
};
const castOf = (page) => page.evaluate(() => window.__game.cast);

// ---------------------------------------------------------------- 探索（本物のキー・タッチのスティックで歩く）
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
  for (let i = 0; i < 60; i++) {
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
async function talkTo(page, id, how) {
  const c = (await castOf(page)).find((m) => m.id === id);
  if (!c) throw new Error(`${id} が居ない`);
  await walkNear(page, how, c, id);
  await how.talk();
  await waitUi(page, 'script');
  return readThrough(page, how.next);
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
  };
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
  };
}

// ---------------------------------------------------------------- 章の流れ（タイトル → 軍議 → 支度）
async function newIeyasu(page, io) {
  await io.btn('new:ieyasu1570');
  await page.waitForFunction(() => window.__game.screen === 'explore' || window.__game.ui?.kind === 'confirm', null, POLL);
  if ((await ui(page))?.kind === 'confirm') {
    check('はじめから：前の保存（歴史分岐）の上書きを確かめる（ほかのシナリオの保存には触れない）', (await ui(page)).text.includes('ほかのシナリオの保存'));
    await io.btn('new');
  }
  await waitScreen(page, 'explore');
}
async function council(page, io, policy) {
  let u = await talkTo(page, 'tadakatsu', io);
  check('城下の本多忠勝：軍議を開く', u.seenId === 'explore.tadakatsu' && u.choices.includes('open_council'), u.seenId);
  await io.pick('open_council');
  await waitScreen(page, 'council');
  u = await readThrough(page, io.next);
  check('軍議：3 つの方針が並ぶ', ['policy_oda', 'policy_asai', 'policy_home'].every((c) => u.choices.includes(c)));
  await io.pick(`policy_${policy}`);
  u = await readThrough(page, io.next);
  check(`方針 ${policy} を選ぶ → 確かめる（決める／考え直す）`, u.seenId === `council.confirm.${policy}` && u.choices.includes('confirm_policy'), u.seenId);
  await io.pick('confirm_policy');
  await waitScreen(page, 'explore');
  const s = await st(page);
  check(`方針 ${policy} に決まる → 出陣の支度`, s.phase === 'muster' && s.policy === policy);
  return u;
}
async function answerPledge(page, io, giver, answer) {
  const u = await talkTo(page, giver, io);
  check(`約束の会話（${giver}）：対象と達成の条件が選ぶ前に見える`, u.seenId?.endsWith('.pledge') && u.choices.includes(`pledge_${answer}`) && u.seen.some((l) => l.includes('約束の中身')), u.seenId);
  await io.pick(`pledge_${answer}`);
  await waitScreen(page, 'explore');
  return st(page);
}
async function depart(page, io, prefix) {
  const u = await walkToGate(page, io);
  check(`${prefix} 城門の出陣の確認に、方針と約束が出る`, u.seenId === 'muster.gate' && u.seen.join(' ').includes('約束') && u.choices.includes('depart'), u.seen.join(' / ').slice(0, 140));
  await io.pick('depart');
  await page.waitForFunction(() => window.__game.screen === 'battle', null, POLL);
  const sv = await saved(page);
  check(`${prefix} 出陣前の自動保存（段階 battle・約束の答え・合戦の id）`, sv?.point === 'departure' && sv.phase === 'battle' && sv.pledge !== null && !!sv.battleId && sv.appliedBattleId === null);
  await page.waitForFunction(() => window.__battle?.active && window.__battle.ui.modal === 'briefing' && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
  await sleep(400);
  const brief = await page.textContent('.b-modal');
  const units = await page.evaluate(() => window.__battle.state.units.map((u) => ({ id: u.id, side: u.side, clan: u.clan, name: u.name, ability: u.ability ?? null })));
  const pledge = await page.evaluate(() => window.__battle.state.pledge && { targetId: window.__battle.state.pledge.targetId });
  check(`${prefix} 合戦の説明：「1570年の情勢を背景にした架空の局地戦」・勝ち負け・撤退の条件`, brief.includes('1570年の情勢を背景にした架空の局地戦') && brief.includes('勝利') && brief.includes('撤退'));
  return { brief, units, pledge, departSave: sv };
}

// ---------------------------------------------------------------- 合戦（本物の入力で命令・能力。待つ間だけ早送り）
const bUi = (page) => page.evaluate(() => window.__battle.ui);
const bUnit = (page, id) => page.evaluate((id) => { const u = window.__battle.state.units.find((x) => x.id === id); return u && { id: u.id, name: u.name, x: u.x, z: u.z, status: u.status, order: u.order, strength: u.strength, start: u.startStrength, morale: u.morale }; }, id);
const bAb = (page, id) => page.evaluate((id) => { const r = window.__battle.state.abilities[id]; return r ? { usedAt: r.usedAt, until: r.until, targetId: r.targetId ?? null } : null; }, id);
const hintText = (page) => page.evaluate(() => { const h = document.querySelector('.b-hint'); return h && !h.hidden ? h.textContent : ''; });

/** 状態を読む条件（ページの中で評価する式。s・U・alive・seen・broken・near・at が使える） */
const HELPERS = `
  const U = (id) => s.units.find((u) => u.id === id);
  const alive = (id) => { const u = U(id); return !!u && u.status === 'ready' && u.present !== false; };
  const seen = (id) => alive(id) && U(id).seenBy.ally;
  const broken = (id) => !alive(id);
  const near = (a, b, r) => alive(a) && alive(b) && Math.hypot(U(a).x - U(b).x, U(a).z - U(b).z) <= r;
  const at = (id, x, z, r = 6) => { const u = U(id); return !!u && Math.hypot(u.x - x, u.z - z) <= r; };
`;

function battleIO(page, io) {
  const names = {};
  const B = {
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
    async resume() {
      if (!(await bUi(page)).paused) return;
      if (io.phone) await io.press('.b-pause');
      else await page.keyboard.press('Space');
      await sleep(200);
      if ((await bUi(page)).paused) throw new Error('再開できない');
    },
    /** 札で味方の部隊を選ぶ（選んでいる部隊の札をもう一度押すとカメラが寄るので、選んでいれば押さない） */
    async select(id) {
      if ((await bUi(page)).selectedId === id && (await bUi(page)).pending === 'none') return;
      await io.press(`.b-card:has-text("${names[id]}")`);
      const u = await bUi(page);
      if (u.selectedId !== id) throw new Error(`${names[id]} を札で選べない（${u.selectedId}）`);
    },
    /** id の部隊から r m 離れた、ほかの部隊から一番遠い地面（押しても部隊を押したことにならない所） */
    async freeGroundNear(id, r) {
      return page.evaluate(([id, r]) => {
        const s = window.__battle.state;
        const c = s.units.find((u) => u.id === id);
        let best = null;
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const x = c.x + Math.cos(a) * r;
          const z = c.z + Math.sin(a) * r;
          if (Math.abs(x) > s.map.width / 2 - 20 || Math.abs(z) > s.map.depth / 2 - 20) continue;
          const d = Math.min(...s.units.filter((u) => u.present).map((u) => Math.hypot(u.x - x, u.z - z)));
          if (!best || d > best.d) best = { x, z, d };
        }
        return best;
      }, [id, r]);
    },
    async groundAt(x, z) {
      const p = await page.evaluate(([x, z]) => { const q = window.__battle.screenOfGround(x, z); const el = document.elementFromPoint(q.x, q.y); return { ...q, hit: el?.className ?? '' }; }, [x, z]);
      if (!String(p.hit).includes('b-input')) throw new Error(`地面 (${x}, ${z}) が画面の部品の下（${p.hit}）`);
      return p;
    },
    async unitAt(id) {
      const p = await page.evaluate((id) => { const q = window.__battle.screenOf(id); const el = q && document.elementFromPoint(q.x, q.y); return q && { ...q, hit: el?.className ?? '' }; }, id);
      if (!p || !p.shown || !String(p.hit).includes('b-input')) throw new Error(`${names[id]} を押せない（${JSON.stringify(p)}）`);
      return p;
    },
    /** 移動：札で選ぶ → 地面を押す */
    async move(id, x, z) {
      const u0 = await bUnit(page, id);
      // もう目標のすぐ近くにいる（その地点を押すと自分の部隊を押したことになる）：命令は要らない
      if (Math.hypot(u0.x - x, u0.z - z) < 10) return true;
      await B.select(id);
      const p = await B.groundAt(x, z);
      await io.at(p.x, p.y);
      const u = await bUnit(page, id);
      if (u.order.type !== 'move') {
        note(`${names[id]} の移動が出なかった（${u.order.type}。${await hintText(page)}）`);
        return false;
      }
      return true;
    },
    /** 攻撃：札で選ぶ → 敵の部隊を押す */
    async attack(id, target) {
      await B.select(id);
      const p = await B.unitAt(target);
      await io.at(p.x, p.y);
      const u = await bUnit(page, id);
      if (u.order.type !== 'attack' || u.order.targetId !== target) {
        note(`${names[id]} → ${names[target]} の攻撃が出なかった（${JSON.stringify(u.order)}。${await hintText(page)}）`);
        return false;
      }
      return true;
    },
    /** 特殊能力：札で選ぶ →「能力」（PC は key が 'F' なら F キー）→ 援護なら対象の部隊を地図で押す */
    async ability(id, { key = false, target = null, targetByCard = false } = {}) {
      await B.select(id);
      const before = await bAb(page, id);
      if (key && !io.phone) await page.keyboard.press('KeyF');
      else await io.press('.b-abil-btn');
      await sleep(150);
      if (target) {
        if ((await bUi(page)).pending !== 'ability') {
          note(`援護の対象選びにならない（${await hintText(page)}）`);
          return false;
        }
        if (targetByCard) await io.press(`.b-card:has-text("${names[target]}")`);
        else {
          const p = await B.unitAt(target);
          await io.at(p.x, p.y);
        }
      }
      const r = await bAb(page, id);
      if (!r || r.usedAt === null || (before && before.usedAt !== null)) {
        note(`${names[id]} の能力が出なかった（${await hintText(page)}）`);
        return false;
      }
      return true;
    },
    async retreat(id) {
      await B.select(id);
      await io.press('.b-cmds .b-cmd:text-is("撤退")');
      const u = await bUnit(page, id);
      return u.order.type === 'retreat';
    },
    async allRetreat() {
      await io.press('.b-allret');
      await page.locator('.b-confirm').waitFor({ state: 'visible' });
      await sleep(300);
      await io.press('.b-confirm .b-btn:has-text("撤退する")');
      return (await page.evaluate(() => window.__battle.state.allRetreatAt)) !== null;
    },
  };
  return B;
}

/**
 * 采配を進める：合戦を止めたまま、1 秒ずつ早送りし、そのたびに条件（ページで評価）を見て、そろった采配を本物の入力で出す。
 * rules：[key, 条件の式, act]。act が false を返したら次の秒にもう一度（同じ所で 6 回失敗したら止める）。
 */
async function drive(page, B, rules, { maxSec = 700, onTick = null, realtime = false } = {}) {
  const done = new Set();
  const fails = {};
  const log = [];
  let t = 0;
  const wall0 = Date.now();
  if (realtime) await B.resume();
  for (let i = 0; realtime ? Date.now() - wall0 < 20 * 60000 : i < maxSec; i++) {
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
    if (onTick) await onTick(t);
    if (realtime) await sleep(300);
    else await page.evaluate(() => window.__battle.fastForward(1));
  }
  if (realtime) note(`（早送りなし・等速 ×1）合戦の時間 ${t.toFixed(0)} 秒を実時間 ${((Date.now() - wall0) / 1000).toFixed(0)} 秒で、止めずに動かしながら采配した：${log.join('、')}`);
  else note(`（早送り）合戦の時間 ${t.toFixed(0)} 秒まで、止めたまま 1 秒ずつ進めた。采配：${log.join('、')}`);
  return log;
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
/** 結果の画面が出た時点で、戦後の保存が済んでいる（決着の時点の保存） */
async function checkDecidedSave(page, prefix, out) {
  const sv = await saved(page);
  check(`${prefix} 結果の画面の時点で戦後の自動保存が済んでいる（勝敗・約束の結果・反映済みの合戦の id）`,
    sv?.point === 'aftermath' && sv.phase === 'aftermath' && sv.battle?.result === out.result && sv.appliedBattleId === sv.battleId && (out.pledge ? sv.pledge?.result === out.pledge.result : true),
    JSON.stringify({ point: sv?.point, result: sv?.battle?.result, pledge: sv?.pledge?.result, applied: sv?.appliedBattleId === sv?.battleId }));
  return sv;
}
function checkEnding(prefix, u) {
  const t = u.text;
  const need = ['方針', '合戦の結果', '約束', '信頼', '信頼の変化', '徳川の兵', '支援', '次の章へ', '史実と創作', '創作'];
  const miss = need.filter((w) => !t.includes(w));
  check(`${prefix} 結末：方針・勝敗・約束・信頼と変化・損害・支援・次章の印・史実と創作の注記`, miss.length === 0 && t.includes('歴史分岐'), miss.length ? `足りない：${miss.join('、')}` : '');
  check(`${prefix} 結末に「姉川の戦いの再現」とは書かない・B を史実とは書かない・伝承を事実として書かない`, !/姉川の戦いを再現|史実でも浅井|単騎|無傷/.test(t));
}
async function toEnding(page, io, prefix) {
  const u = await talkTo(page, 'tadakatsu', io);
  check(`${prefix} 戦後の忠勝：章を締めくくる`, u.seenId?.startsWith('aftermath.tadakatsu.') && u.choices.includes('end_chapter'), u.seenId);
  await io.pick('end_chapter');
  await waitUi(page, 'ending');
  await sleep(300);
  const e = await ui(page);
  const s = await st(page);
  return { e, s };
}

// ================================================================ 経路 1：A 織田 × 勝利 × 約束を守る（PC）
async function route1() {
  console.log('--- 経路 1：PC（キーとマウス）A 織田 × 約束を引き受ける × 勝利・約束を守る。号令・退路の守護');
  const { ctx, page } = await open();
  const io = desktopIO(page);
  await page.evaluate(([f, v]) => { localStorage.clear(); localStorage.setItem('koto-sengoku/save', '{"2d":"keep"}'); localStorage.setItem(f, v); }, [FKEY, V1_FICTIONAL]);
  await reloadToTitle(page);
  await shot(page, '1-01-title');
  await newIeyasu(page, io);
  check('はじめから（歴史分岐）', (await st(page)).scenario === 'ieyasu1570');
  let u = await talkTo(page, 'oda_envoy', io);
  check('城下の織田家の使者（書状の趣旨。実際の書状の引用ではない）', u.seen.some((l) => l.includes('実際の書状の引用ではない')), u.seenId);
  await waitScreen(page, 'explore');
  await council(page, io, 'oda');
  let s = await answerPledge(page, io, 'oda_envoy', 'accept');
  check('約束を引き受ける（織田援軍の退路・結果はまだ）', s.pledge?.accepted === true && s.pledge.targetId === 'a_oda' && s.pledge.result === null, JSON.stringify(s.pledge));
  // 支度でメニュー（Esc）から保存 → 開き直す → つづきから
  await page.keyboard.press('Escape');
  await waitUi(page, 'menu');
  await io.btn('save');
  await page.waitForFunction(() => window.__game.ui?.kind === 'menu' && window.__game.ui.text.includes('保存しました'), null, POLL);
  check('支度：メニューから保存（読み戻して確かめた）', (await ui(page)).text.includes('読み戻して確かめました'));
  await io.btn('close');
  await waitScreen(page, 'explore');
  const sv = await saved(page);
  musterSaveA = await raw(page, KEY);
  check('保存の中身：歴史分岐・支度・方針 A・約束を引き受けた', sv?.scenario === 'ieyasu1570' && sv.phase === 'muster' && sv.policy === 'oda' && sv.pledge?.accepted === true && sv.pledge.result === null);
  await reloadToTitle(page);
  check('開き直す → タイトルの歴史分岐の「つづきから」に支度の保存', (await page.textContent('.g-btn[data-id="continue:ieyasu1570"]')).includes('出陣の支度'));
  await io.btn('continue:ieyasu1570');
  await waitScreen(page, 'explore');
  s = await st(page);
  check('つづきから：支度・方針 A・約束を引き受けたまま', s.phase === 'muster' && s.policy === 'oda' && s.pledge?.accepted === true && s.pledge.targetId === 'a_oda');

  const b = await depart(page, io, '1');
  check('1 合戦 A：織田援軍は味方・浅井長政隊（能力は敵の考え）と朝倉勢は敵・約束の対象は織田援軍',
    b.units.some((x) => x.id === 'a_oda' && x.side === 'ally') && b.units.some((x) => x.id === 'e_nagamasa' && x.side === 'enemy' && x.ability === 'nagamasa_support') && b.units.some((x) => x.clan === 'asakura' && x.side === 'enemy') && b.pledge?.targetId === 'a_oda');
  check('1 合戦の説明に約束の対象と条件', b.brief.includes('織田援軍') && b.brief.includes('約束'));
  await shot(page, '1-02-briefing');
  await io.press('.b-primary:has-text("合戦を始める")');
  const B = battleIO(page, io);
  await B.init();
  await B.pause();
  check('1 合戦を始めて、Space で指揮（一時停止）', (await bUi(page)).started && (await bUi(page)).paused);
  // 家康本陣を選ぶと、能力の欄に名前・対象・範囲・効果・代償・使えるか
  await B.select('t_honjin');
  const panel = await page.textContent('.b-abil');
  check('1 家康本陣を選ぶ → 能力の欄（立て直しの号令・対象・範囲・効果・代償・使える・創作の断り）', ['立て直しの号令', '対象', '範囲 90 m', '効果', '代償', '使える', 'ゲーム用の創作'].every((w) => panel.includes(w)), panel.slice(0, 90));
  await shot(page, '1-03-ability-panel');
  let rallyShot = false;
  const sallied = `alive('e_asai_sente') && U('e_asai_sente').engagedWith === 't_yumi'`;
  const notBusy = (id) => `(U('${id}').order.type !== 'attack' || !alive(U('${id}').order.targetId))`;
  const rules = [
    // 織田援軍を南の味方の陣へ下げる（約束：陣で 20 秒）。忠勝隊は右前で朝倉勢を待ち、着いたら「退路の守護」で踏みとどまる
    ['oda-back', 'true', () => B.move('a_oda', 25, 135)],
    ['tada-east', 'true', () => B.move('t_tadakatsu', 80, 45)],
    ['yumi-east', 'true', () => B.move('t_yumi', 45, 75)],
    ['tada-rearguard', `at('t_tadakatsu', 80, 45)`, async () => {
      const ok = await B.ability('t_tadakatsu', { key: true });
      if (ok) {
        check('1 忠勝隊の「退路の守護」を F で使う（踏みとどまる）', (await page.textContent('.b-abil')).includes('効果中'));
        const g = await B.freeGroundNear('t_tadakatsu', 35);
        await B.groundAt(g.x, g.z).then((p) => io.at(p.x, p.y));
        check('1 踏みとどまっている忠勝隊は、地面を押しても動かない（理由が出る）', (await hintText(page)).includes('踏みとどまっている') && (await bUnit(page, 't_tadakatsu')).order.type === 'hold', await hintText(page));
        await shot(page, '1-04-rearguard');
      }
      return ok;
    }],
    ['yumi-asa', `seen('e_asakura') && U('e_asakura').z > -40`, () => B.attack('t_yumi', 'e_asakura')],
    ['tada-asa', `seen('e_asakura') && U('e_asakura').z > -20 && !(s.abilities.t_tadakatsu && s.t < s.abilities.t_tadakatsu.until)`, () => B.attack('t_tadakatsu', 'e_asakura')],
    ['hq-asa', `alive('e_asakura') && U('e_asakura').engagedWith === 't_tadakatsu'`, () => B.attack('t_honjin', 'e_asakura')],
    ['rally', `alive('e_asakura') && U('e_asakura').engagedWith === 't_tadakatsu' && near('t_honjin', 'e_asakura', 60)`, async () => {
      const m0 = (await bUnit(page, 't_tadakatsu')).morale;
      const ok = await B.ability('t_honjin');
      if (ok) {
        const m1 = (await bUnit(page, 't_tadakatsu')).morale;
        check('1 家康本陣の「立て直しの号令」を「能力」ボタンで使う → 近くの忠勝隊の士気が上がる', m1 > m0, `${m0.toFixed(0)} → ${m1.toFixed(0)}`);
        rallyShot = true;
        await shot(page, '1-05-rally');
      }
      return ok;
    }],
    ['hq-back', `broken('e_asakura')`, () => B.move('t_honjin', 0, 100)],
    ['tada-wait', `broken('e_asakura')`, () => B.move('t_tadakatsu', 75, 60)],
    ['oda-wait', `broken('e_asakura') && alive('a_oda') && (s.pledge === null || s.pledge.secured)`, () => B.move('a_oda', -45, 75)],
    ['yumi-sente', `broken('e_asakura') && seen('e_asai_sente')`, () => B.attack('t_yumi', 'e_asai_sente')],
    ['tada-sente', sallied, () => B.attack('t_tadakatsu', 'e_asai_sente')],
    ['oda-sente', `${sallied} && alive('a_oda')`, () => B.attack('a_oda', 'e_asai_sente')],
    ['hq-sente', sallied, () => B.attack('t_honjin', 'e_asai_sente')],
  ];
  for (const id of ['t_tadakatsu', 't_yumi', 't_honjin', 'a_oda'])
    for (const e of ['e_asai_yumi', 'e_nagamasa'])
      rules.push([`${id}>${e}`, `broken('e_asai_sente') && alive('${id}') && seen('${e}') && ${notBusy(id)}`, () => B.attack(id, e)]);
  let counted = false;
  await drive(page, B, rules, {
    onTick: async () => {
      if (counted) return;
      const pl = await page.textContent('.b-pledge').catch(() => '');
      if (/陣に入って \d+\/20 秒/.test(pl) && !/ 0\/20/.test(pl)) {
        counted = true;
        check('1 約束の行：織田援軍が味方の陣に入って数える', true, pl);
        await shot(page, '1-06-pledge-counting');
      }
    },
  });
  check('1 号令を使った', rallyShot);
  const { out, text } = await waitResultPanel(page);
  await shot(page, '1-07-result');
  check('1 結果：勝利・約束を守った（別々に記録）', out.result === 'victory' && out.pledge?.result === 'kept', `${out.result}/${out.reason}/${out.pledge?.result}`);
  check('1 結果の画面：勝敗と別に「約束を守った」・使った能力（号令・退路の守護）', text.includes('勝利') && text.includes('約束を守った') && text.includes('立て直しの号令') && text.includes('退路の守護'), text.slice(0, 120));
  check('1 結果の画面に架空の第一章の言葉（若殿・鷲尾）が出ない', !/若殿|鷲尾/.test(text));
  check('1 合戦の記録：使った能力（家康本陣・忠勝隊）', out.abilitiesUsed && out.abilitiesUsed.t_honjin !== undefined && out.abilitiesUsed.t_tadakatsu !== undefined, JSON.stringify(out.abilitiesUsed));
  await checkDecidedSave(page, '1', out);
  await continueFromResult(page, io);
  s = await st(page);
  check('1 戦後：勝利・約束を守った → 織田 70（+15 +25）・浅井 −5・忠勝 45・援兵あり', s.phase === 'aftermath' && s.result === 'victory' && s.pledge.result === 'kept' && s.trust.oda === 70 && s.trust.asai === -5 && s.trust.tadakatsu === 45 && s.support?.reinforcement === true,
    JSON.stringify({ trust: s.trust, support: s.support }));
  check('1 戦後の状態に、合戦の記録（約束・使った能力）も残る', s.outcomePledge?.result === 'kept' && s.abilitiesUsed?.t_honjin !== undefined);
  await shot(page, '1-08-aftermath');
  u = await talkTo(page, 'oda_envoy', io);
  check('1 戦後の織田家の使者（勝利・約束を守った）', u.seenId === 'aftermath.oda_envoy.victory.kept', u.seenId);
  await waitScreen(page, 'explore');
  const { e } = await toEnding(page, io, '1');
  s = await st(page);
  await shot(page, '1-09-ending');
  check('1 結末：織田と共に勝つ（oda_victory）', s.ending === 'oda_victory', s.ending);
  checkEnding('1', e);
  await io.btn('title');
  await waitTitle(page);
  check('1 架空の第一章の保存（版 1）・2D 版の保存はそのまま', (await raw(page, FKEY)) === V1_FICTIONAL && (await raw(page, KEY2D)) === SENT2D);
  await ctx.close();
}

// ================================================================ 経路 2：B 浅井 × 撤退 × 約束を守る（PC・マウス）
async function route2() {
  console.log('--- 経路 2：PC（マウス）B 浅井 × 約束を引き受ける × 撤退・約束を守る（退いたが味方を救った）。援護・退路の守護。結果の画面で開き直す');
  const { ctx, page } = await open();
  const io = desktopIO(page);
  io.talk = () => page.locator('.g-talk').click();
  io.next = () => page.mouse.click(640, 200);
  let u;
  await newIeyasu(page, io);
  await council(page, io, 'asai');
  let s = await answerPledge(page, io, 'asai_envoy', 'accept');
  check('2 約束を引き受ける（浅井長政隊の退き口）', s.pledge?.accepted === true && s.pledge.targetId === 'a_nagamasa');
  const b = await depart(page, io, '2');
  check('2 合戦 B：浅井長政隊は味方（援護はプレイヤーが使う）・敵は織田方だけ（信長本人は出ない）・「史実から分かれた道」',
    b.units.some((x) => x.id === 'a_nagamasa' && x.side === 'ally' && x.ability === 'nagamasa_support') && b.units.filter((x) => x.side === 'enemy').every((x) => x.clan === 'oda') && !b.units.some((x) => x.name.includes('信長')) && b.brief.includes('史実から分かれた道'));
  await shot(page, '2-01-briefing');
  await io.press('.b-primary:has-text("合戦を始める")');
  const B = battleIO(page, io);
  await B.init();
  await B.pause();
  await B.select('a_nagamasa');
  const panel = await page.textContent('.b-abil');
  check('2 浅井長政隊を選ぶ → 盟友への援護（プレイヤーが使える味方の能力）', panel.includes('盟友への援護') && !panel.includes('敵方'), panel.slice(0, 80));
  const chased = `alive('a_nagamasa') && s.units.some((e) => e.side === 'enemy' && e.status === 'ready' && Math.hypot(e.x - U('a_nagamasa').x, e.z - U('a_nagamasa').z) <= 70)`;
  const rules = [
    // 忠勝隊を長政隊の退き口へ。長政隊が忠勝隊を援護 → 長政隊を撤退させ、追われたら忠勝隊が退路の守護。長政隊が戦場を出たら全軍撤退
    ['tada-cover', 'true', () => B.move('t_tadakatsu', -45, 40)],
    ['support', `near('a_nagamasa', 't_tadakatsu', 55)`, async () => {
      const ok = await B.ability('a_nagamasa', { target: 't_tadakatsu' });
      if (ok) {
        check('2 長政隊の「盟友への援護」：「能力」→ 地図で忠勝隊を押す（対象選び）', (await bAb(page, 'a_nagamasa')).targetId === 't_tadakatsu' && (await page.textContent('.b-abil')).includes('本多忠勝隊を援護中'));
        await shot(page, '2-02-support');
      }
      return ok;
    }],
    ['naga-out', `s.abilities.a_nagamasa && s.abilities.a_nagamasa.usedAt !== null && s.t > 20`, () => B.retreat('a_nagamasa')],
    ['rearguard', `${chased} && near('t_tadakatsu', 'a_nagamasa', 70) && U('a_nagamasa').order.type === 'retreat'`, async () => {
      const ok = await B.ability('t_tadakatsu', { key: true });
      if (ok) {
        check('2 追われる長政隊の退路で、忠勝隊の「退路の守護」（F）', (await page.textContent('.b-abil')).includes('効果中'));
        await shot(page, '2-03-rearguard');
      }
      return ok;
    }],
    ['all-out', `broken('a_nagamasa')`, async () => {
      const u = await bUnit(page, 'a_nagamasa');
      check('2 長政隊は撤退の命令で戦場を離れた（撤退済み）', u.status === 'withdrawn', u.status);
      const pl = await page.textContent('.b-pledge');
      check('2 約束の行：退き口から離れた ✓', pl.includes('退き口から離れた'), pl);
      return B.allRetreat();
    }],
  ];
  // 経路 2 の合戦は早送りしない（REALTIME2=0 で早送りに戻す）：等速のまま、動いている合戦に本物の入力で采配する
  await drive(page, B, rules, { realtime: process.env.REALTIME2 !== '0' });
  const { out, text } = await waitResultPanel(page);
  await shot(page, '2-04-result');
  check('2 結果：撤退・約束を守った（退いたが味方を救った）', out.result === 'retreat' && out.pledge?.result === 'kept', `${out.result}/${out.reason}/${out.pledge?.result}`);
  check('2 結果の画面：撤退と別に「約束を守った」・盟友への援護', text.includes('撤退') && text.includes('約束を守った') && text.includes('盟友への援護'), text.slice(0, 120));
  const sv = await checkDecidedSave(page, '2', out);
  // 結果の画面のまま開き直す
  await reloadToTitle(page);
  check('2 結果の画面で開き直す → タイトルの「つづきから」は戦後（合戦をやり直さない）', (await page.textContent('.g-btn[data-id="continue:ieyasu1570"]')).includes('戦の後'));
  await io.btn('continue:ieyasu1570');
  await waitScreen(page, 'explore');
  s = await st(page);
  check('2 つづきから：戦後・撤退・約束を守った（結果と約束の結果が残る）', s.phase === 'aftermath' && s.result === 'retreat' && s.pledge.result === 'kept' && s.outcomePledge?.result === 'kept');
  check('2 二重に反映しない：信頼・兵・援兵が保存と同じ（浅井 35＝+0 +25・織田 0＝−30・忠勝 40）', JSON.stringify(s.trust) === JSON.stringify(sv.trust) && JSON.stringify(s.troops) === JSON.stringify(sv.troops) && s.applied === s.battleId && s.trust.asai === 35 && s.trust.oda === 0 && s.trust.tadakatsu === 40 && s.support?.reinforcement === true,
    JSON.stringify({ trust: s.trust, troops: s.troops, support: s.support }));
  await shot(page, '2-05-aftermath-after-reload');
  u = await talkTo(page, 'asai_envoy', io).catch((e) => ({ seenId: `(${e.message})` }));
  check('2 戦後の浅井家の使者（撤退・約束を守った）', /^aftermath\.asai_envoy\..*kept$/.test(u.seenId ?? ''), u.seenId);
  await waitScreen(page, 'explore');
  const { e } = await toEnding(page, io, '2');
  s = await st(page);
  await shot(page, '2-06-ending');
  check('2 結末：撤退（retreat）・「史実から分かれた道」', s.ending === 'retreat' && e.text.includes('史実から分かれた道'), s.ending);
  checkEnding('2', e);
  await ctx.close();
}

// ================================================================ 経路 3：C 自領 × 約束を引き受けない × 勝利（スマホ・タッチ）
async function route3() {
  console.log('--- 経路 3：スマホ横 844×390（タッチ）C 自領 × 約束を引き受けない（中立）× 勝利。戦後で開き直す');
  const { ctx, page } = await open({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const io = await phoneIO(ctx, page);
  let u;
  await page.evaluate(() => { localStorage.removeItem('koto-sengoku/3d-ieyasu1570'); });
  await reloadToTitle(page);
  await shot(page, '3-01-title-phone');
  await newIeyasu(page, io);
  u = await council(page, io, 'home');
  check('3 C は「両家に刃を向けるわけではない」（宣戦ではない）', u.seen.some((l) => l.includes('両家に刃を向けるわけではございませぬ')));
  const cast = await castOf(page);
  check('3 C の支度：両家の使者は居ない', !cast.some((c) => c.id === 'oda_envoy' || c.id === 'asai_envoy'), cast.map((c) => c.id).join(','));
  let s = await answerPledge(page, io, 'tadakatsu', 'decline');
  check('3 約束を引き受けない（declined・信頼は変わらない）', s.pledge?.accepted === false && s.pledge.result === 'declined' && s.trust.tadakatsu === 40);
  const b = await depart(page, io, '3');
  check('3 合戦 C：敵は浪人衆だけ（織田・浅井と戦わない）・約束を引き受けていない（約束の対象の記録なし）', b.units.filter((x) => x.side === 'enemy').every((x) => x.clan === 'ronin') && !b.units.some((x) => x.clan === 'oda' || x.clan === 'asai') && b.pledge === null);
  check('3 合戦の説明：約束は引き受けていない（約束違反ではない）', b.brief.includes('引き受けていない'), '');
  await shot(page, '3-02-briefing-phone');
  await io.press('.b-primary:has-text("合戦を始める")');
  const B = battleIO(page, io);
  await B.init();
  await B.pause();
  check('3 「指揮」をタップで一時停止・約束の行は出ない', (await bUi(page)).paused && (await page.evaluate(() => { const e = document.querySelector('.b-pledge'); return !e || e.hidden || getComputedStyle(e).display === 'none'; })));
  const sallied = `alive('e_ronin_yari') && U('e_ronin_yari').engagedWith === 't_yumi'`;
  const kibaFighting = `alive('e_ronin_kiba') && ['t_tadakatsu', 't_yumi'].includes(U('e_ronin_kiba').engagedWith ?? '')`;
  const notBusy = (id) => `(U('${id}').order.type !== 'attack' || !alive(U('${id}').order.targetId))`;
  let rallied = false;
  const rules = [
    ['tada-west', 'true', () => B.move('t_tadakatsu', -45, 55)],
    ['yumi-back', 'true', () => B.move('t_yumi', -5, 85)],
    ['tada-kiba', `seen('e_ronin_kiba')`, () => B.attack('t_tadakatsu', 'e_ronin_kiba')],
    ['yumi-kiba', `seen('e_ronin_kiba')`, () => B.attack('t_yumi', 'e_ronin_kiba')],
    ['hq-kiba', kibaFighting, () => B.attack('t_honjin', 'e_ronin_kiba')],
    ['hq-back', `broken('e_ronin_kiba')`, () => B.move('t_honjin', 0, 100)],
    ['tada-wait', `broken('e_ronin_kiba')`, () => B.move('t_tadakatsu', -45, 75)],
    ['res-wait', `broken('e_ronin_kiba') && alive('t_reserve')`, () => B.move('t_reserve', 50, 80)],
    ['yumi-yari', `broken('e_ronin_kiba') && seen('e_ronin_yari')`, () => B.attack('t_yumi', 'e_ronin_yari')],
    ['tada-yari', sallied, () => B.attack('t_tadakatsu', 'e_ronin_yari')],
    ['res-yari', `${sallied} && alive('t_reserve')`, () => B.attack('t_reserve', 'e_ronin_yari')],
    ['hq-yari', sallied, () => B.attack('t_honjin', 'e_ronin_yari')],
    ['rally', `${sallied} && near('t_honjin', 't_yumi', 90)`, async () => {
      const ok = await B.ability('t_honjin');
      if (ok) {
        rallied = true;
        check('3 「能力」をタップで家康本陣の号令（1 回のタップで 1 回）', !(await hintText(page)).includes('いま効果中'));
        await shot(page, '3-03-rally-phone');
      }
      return ok;
    }],
  ];
  for (const id of ['t_tadakatsu', 't_yumi', 't_honjin', 't_reserve'])
    for (const e of ['e_ronin_yumi', 'e_ronin_hq'])
      rules.push([`${id}>${e}`, `broken('e_ronin_yari') && alive('${id}') && seen('${e}') && ${notBusy(id)}`, () => B.attack(id, e)]);
  await drive(page, B, rules);
  check('3 号令を使った', rallied);
  const { out, text } = await waitResultPanel(page);
  await shot(page, '3-04-result-phone');
  check('3 結果：勝利・約束は引き受けていない（約束違反ではない）', out.result === 'victory' && !out.pledge && text.includes('引き受けていない') && text.includes('約束違反ではない'), `${out.result}/${out.reason}`);
  await checkDecidedSave(page, '3', out);
  await continueFromResult(page, io);
  s = await st(page);
  const trust3 = s.trust;
  check('3 戦後：勝利・declined（中立）→ 織田 20（−10）・浅井 10（変わらない）・忠勝 45（+5）・援兵なし', s.result === 'victory' && s.pledge.result === 'declined' && s.trust.oda === 20 && s.trust.asai === 10 && s.trust.tadakatsu === 45 && s.support?.reinforcement === false, JSON.stringify({ trust: s.trust, support: s.support }));
  const sv = await saved(page);
  // 戦後で開き直す
  await reloadToTitle(page);
  await io.btn('continue:ieyasu1570');
  await waitScreen(page, 'explore');
  s = await st(page);
  check('3 戦後で開き直す → つづきから：勝敗・約束・信頼・兵が同じ（二重に反映しない）', s.phase === 'aftermath' && s.result === 'victory' && s.pledge.result === 'declined' && JSON.stringify(s.trust) === JSON.stringify(trust3) && JSON.stringify(s.troops) === JSON.stringify(sv.troops) && s.applied === s.battleId);
  await shot(page, '3-05-aftermath-phone');
  u = await talkTo(page, 'oda_envoy', io).catch(() => null);
  if (u) check('3 戦後：織田家の使者が不満を伝えに来る（敵ではない）', u.seenId === 'aftermath.oda_envoy.home', u.seenId);
  await waitScreen(page, 'explore');
  const { e } = await toEnding(page, io, '3');
  s = await st(page);
  await shot(page, '3-06-ending-phone');
  check('3 結末：国元を守る（home_victory）', s.ending === 'home_victory', s.ending);
  checkEnding('3', e);
  check('3 知らせ（.g-toast）は押せない（pointer-events: none）', await page.evaluate(() => { const t = document.querySelector('.g-toast'); return !t || getComputedStyle(t).pointerEvents === 'none'; }));
  await ctx.close();
}

// ================================================================ 経路 4：A × 勝利 × 約束を守れなかった（台本）
async function route4() {
  console.log('--- 経路 4：PC　A 織田 × 約束を引き受ける × 勝利・約束を守れなかった（経路 1 の支度の保存から。合戦の命令は台本）');
  const { ctx, page } = await open();
  const io = desktopIO(page);
  let u;
  if (!musterSaveA) throw new Error('経路 1 の支度の保存が無い（ONLY に 1 を入れる）');
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, musterSaveA]);
  await reloadToTitle(page);
  await io.btn('continue:ieyasu1570');
  await waitScreen(page, 'explore');
  let s = await st(page);
  check('4 経路 1 の支度の保存から続ける（方針 A・約束を引き受けた）', s.phase === 'muster' && s.policy === 'oda' && s.pledge?.accepted === true);
  await depart(page, io, '4');
  await io.press('.b-primary:has-text("合戦を始める")');
  const B = battleIO(page, io);
  await B.init();
  await B.pause();
  note('（台本・早送り）ieyasuPlanScript(\'oda\', \'break\')：織田援軍を陣へ下げずに前で戦わせる采配を、止めたまま早送りの中で出す');
  const r = await page.evaluate(async () => {
    const m = await import('/src/battle/scripts.ts');
    const script = m.ieyasuPlanScript('oda', 'break');
    let res = null;
    for (let i = 0; i < 120 && !res; i++) res = window.__battle.fastForward(10, script).result;
    return res && { result: res.result, reason: res.reason, pledge: res.pledge, t: res.elapsedSec };
  });
  note(`（台本・早送り）合戦の時間 ${r?.t?.toFixed(0)} 秒で決着`);
  const { out, text } = await waitResultPanel(page);
  await shot(page, '4-01-result-broken');
  check('4 結果：勝利・約束を守れなかった（勝ったが約束は守れない）', out.result === 'victory' && out.pledge?.result === 'broken', `${out.result}/${out.pledge?.result}`);
  check('4 結果の画面：勝利と別に「約束を守れなかった」', text.includes('勝利') && text.includes('約束を守れなかった'));
  await checkDecidedSave(page, '4', out);
  await continueFromResult(page, io);
  s = await st(page);
  check('4 戦後：勝利・約束を守れなかった → 織田 20（+15 −25）・援兵なし', s.result === 'victory' && s.pledge.result === 'broken' && s.trust.oda === 20 && s.support?.reinforcement === false, JSON.stringify({ trust: s.trust, support: s.support }));
  u = await talkTo(page, 'oda_envoy', io);
  check('4 戦後の織田家の使者（勝利・約束を守れなかった）', u.seenId === 'aftermath.oda_envoy.victory.broken', u.seenId);
  await waitScreen(page, 'explore');
  const { e } = await toEnding(page, io, '4');
  s = await st(page);
  await shot(page, '4-02-ending');
  check('4 結末：勝利の結末に「約束を守れなかった」が残る', s.ending === 'oda_victory' && e.text.includes('守れなかった'), s.ending);
  checkEnding('4', e);
  await ctx.close();
}

// ================================================================ F：架空の第一章の古い保存
async function routeF() {
  console.log('--- F：架空の第一章の古い保存（版 1・版 2）を読む');
  const { ctx, page } = await open();
  const io = desktopIO(page);
  const ie = await raw(page, KEY);
  await page.evaluate(([k, v]) => { localStorage.setItem(k, v); localStorage.setItem('koto-sengoku/save', '{"2d":"keep"}'); }, [FKEY, V1_FICTIONAL]);
  await reloadToTitle(page);
  await io.btn('continue:fictional');
  await waitScreen(page, 'explore');
  const s = await page.evaluate(() => { const x = window.__game.state; return { sc: window.__game.scenario, phase: x.phase, alliance: x.alliance, rel: x.relations, result: x.battle?.result }; });
  check('F 版 1 の保存から続ける：大森・田代のまま（織田・浅井へ書き換えない）', s.sc === 'fictional' && s.alliance === 'omori' && s.rel.tashiro === -20 && s.result === 'defeat', JSON.stringify(s));
  check('F 読むだけでは保存を書き換えない・歴史分岐の保存に触れない', (await raw(page, FKEY)) === V1_FICTIONAL && (await raw(page, KEY)) === ie);
  await shot(page, 'F-01-fictional-v1');
  // 版 2（今の形）：メニューから保存し直す → 開き直して続きから（大森・田代のまま）
  await page.keyboard.press('Escape');
  await waitUi(page, 'menu');
  await io.btn('save');
  await page.waitForFunction(() => window.__game.ui?.kind === 'menu' && window.__game.ui.text.includes('保存しました'), null, POLL);
  await io.btn('close');
  await waitScreen(page, 'explore');
  const v2 = await saved(page, FKEY);
  check('F メニューの保存で版 2 になる（中身は大森・田代のまま）', v2?.version === 2 && v2.alliance === 'omori' && v2.relations.tashiro === -20 && v2.battle.result === 'defeat');
  await reloadToTitle(page);
  await io.btn('continue:fictional');
  await waitScreen(page, 'explore');
  const s2 = await page.evaluate(() => { const x = window.__game.state; return { sc: window.__game.scenario, phase: x.phase, alliance: x.alliance, rel: x.relations }; });
  check('F 版 2 の保存から続ける（大森・田代のまま）', s2.sc === 'fictional' && s2.phase === 'aftermath' && s2.alliance === 'omori' && s2.rel.tashiro === -20, JSON.stringify(s2));
  // 版 1 の出陣前の保存（田代）：合戦の前（支度）から
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [FKEY, V1_DEPARTURE_TASHIRO]);
  await reloadToTitle(page);
  await io.btn('continue:fictional');
  await waitScreen(page, 'explore');
  const s3 = await page.evaluate(() => { const x = window.__game.state; return { phase: x.phase, alliance: x.alliance }; });
  check('F 版 1 の出陣前の保存（田代）→ 支度から続ける', s3.phase === 'muster' && s3.alliance === 'tashiro', JSON.stringify(s3));
  check('F 2D 版の保存・歴史分岐の保存には触れない', (await raw(page, KEY)) === ie && (await raw(page, KEY2D)) === SENT2D);
  await ctx.close();
}

try {
  if (ONLY.includes('1')) await route1();
  if (ONLY.includes('2')) await route2();
  if (ONLY.includes('3')) await route3();
  if (ONLY.includes('4')) await route4();
  if (ONLY.includes('F')) await routeF();
} catch (e) {
  failed++;
  console.log('NG 途中で止まった：', e.stack || e.message);
}
check('ページの誤りが無い', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? `\n${failed} 件 NG` : '\nALL OK');
process.exit(failed ? 1 : 0);
