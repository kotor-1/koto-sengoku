// 歴史分岐「元亀元年・家康」を、タイトルから結末まで本物の入力（タップ・キー・マウス）で通す（3D 版・開発サーバー）。
// 探索・会話・軍議・約束・出陣・戦後・結末・メニュー・保存はすべて画面の操作。合戦は本物の合戦の画面（battle/entry.ts）。
// 合戦の中で「待つ」ところだけ、開発ビルドの早送り（window.__battle.fastForward）で縮める（ソフトウェア描画では実時間で数分かかるため）。
// 早送りした所は、出力に「早送り」と書く。
//
//   A（スマホ横 844×390・タッチ）：方針 A（織田）。軍議で B を選んで「考え直す」→ A に決める。約束を「少し考える」→ 城門で止められる
//        → 織田家の使者に「引き受ける」。約束の会話の途中でメニューを開いて閉じる（会話は進まない）・選択肢の見張り（出たばかりは決まらない）。
//        支度でメニューから保存 → 開き直して続きから → 出陣（出陣前の自動保存）→ 合戦（始める・指揮・全軍撤退）→ 戦後の自動保存
//        → 開き直して続きから（結果・約束・信頼が同じ。二重に反映しない）→ 戦後の会話 → 結末（方針・勝敗・約束・信頼・損害・支援・次章の印・創作の注記）
//   B（PC・キーとマウス）：方針 B（浅井。史実から分かれた道）。約束を「引き受けない」。合戦は始めて、そのまま早送りで決着。
//   C（PC・マウス）：方針 C（自領の防衛）。約束は本多忠勝から。合戦は始めて全軍撤退。
//   F（PC）：架空の第一章「国境の砦」の古い保存（版 1）を置いて開き直す → つづきから（田代・大森のまま）→ はじめからも始まる。
//
// 使い方：自動再読み込みなしの開発サーバーを起動して
//   (PORT=8153 nohup npx vite --config proto3d/blender/tools/vite.nohmr.mjs > /tmp/vite-8153.log 2>&1 &)
//   BASE3D=http://localhost:8153 node e2e/ieyasu-chapter.mjs [出力先]   （ONLY=A などで絞る）
import { launchBrowser, outDir, skipCinematic } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/ieyasu/chapter');
const BASE = process.env.BASE3D || 'http://localhost:8153';
const ONLY = process.env.ONLY || 'ABCF';
const browser = await launchBrowser();
let failed = 0;
const T0 = Date.now();
const secs = () => `${((Date.now() - T0) / 1000).toFixed(0)}s`;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}  [${secs()}]`);
};
const errors = [];
const POLL = { timeout: 300000, polling: 250 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = 'koto-sengoku/3d-ieyasu1570';
const FKEY = 'koto-sengoku/3d-chapter1';
let reloading = false;

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
  return s && { scenario: g.scenario, screen: g.screen, phase: s.phase, policy: s.policy, trust: s.trust, troops: s.troops, pledge: s.pledge, support: s.support, result: s.battle?.result ?? null, reason: s.battle?.reason ?? null, battleId: s.battleId, applied: s.appliedBattleId, ending: s.ending, characters: s.characters, prompt: g.prompt, err: g.lastError };
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

function toScreen(s, tx, tz) {
  const gx = tx - s.x;
  const gz = tz - s.z;
  const d = Math.hypot(gx, gz) || 1;
  return { ix: (Math.cos(s.yaw) * gx - Math.sin(s.yaw) * gz) / d, iy: (Math.sin(s.yaw) * gx + Math.cos(s.yaw) * gz) / d, d };
}
const pose = (page) => page.evaluate(() => ({ x: window.__p3.hero.x, z: window.__p3.hero.z, yaw: window.__p3.orbit.yaw, prompt: window.__game.prompt, ui: window.__game.ui?.kind ?? null }));

/** 本物のキー（WASD）で目標へ歩く */
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
/** タッチのスティック（左半分）で目標へ歩く */
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
/** 会話を、選択肢が出るか閉じるまで進める。見た台詞の id と、見た行を返す */
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
async function talkTo(page, id, how) {
  const c = (await castOf(page)).find((m) => m.id === id);
  if (!c) throw new Error(`${id} が居ない`);
  await walkNear(page, how, c, id);
  await how.talk();
  await waitUi(page, 'script');
  return readThrough(page, how.next);
}
/** 相手の南（通りの側）を経由して近づく（間に立つ人を回り込む）。遊ぶ人も通りから近づく */
async function walkNear(page, how, c, id) {
  const walk = (x, z, done) => (how.cdp ? walkTouch(page, how.cdp, x, z, done) : walkKeys(page, x, z, done));
  // 西（通り）を向いて立つ相手（石川・浅井の使者の所）は西から近づく。南には詰所の前の休み場（負傷兵がいれば当たり判定）がある（Version 21）
  const west = typeof c.heading === 'number' && Math.abs(Math.atan2(Math.sin(c.heading + Math.PI / 2), Math.cos(c.heading + Math.PI / 2))) < 0.3;
  const wx = west ? c.x - 2.4 : c.x;
  const wz = west ? c.z : c.z + 2.4;
  await walk(wx, wz, (q) => q.prompt === id || Math.hypot(q.x - wx, q.z - wz) < 0.5);
  await walk(c.x, c.z, (q) => q.prompt === id);
  const p = await pose(page);
  if (p.prompt !== id) throw new Error(`${id} の「話す」が出ない（${p.x.toFixed(1)}, ${p.z.toFixed(1)} / ${p.prompt}）`);
}
async function walkToGate(page, how) {
  const g = (await castOf(page)).find((m) => m.id === 'gate');
  if (how.cdp) await walkTouch(page, how.cdp, g.x, g.z, (q) => q.ui === 'script');
  else await walkKeys(page, g.x, g.z, (q) => q.ui === 'script');
  await waitUi(page, 'script');
  return readThrough(page, how.next);
}

// ---------------------------------------------------------------- 合戦
const bUi = (page) => page.evaluate(() => window.__battle.ui);
async function ffUntil(page, cond, max = 480) {
  const step = cond === 'false' ? 5 : 0.5;
  for (let t = 0; t < max; t += step) {
    const r = await page.evaluate(([c, stp]) => {
      const s = window.__battle.state;
      const U = (id) => s.units.find((u) => u.id === id);
      const ok = new Function('s', 'U', `return (${c});`)(s, U);
      if (ok || s.result) return { ok, t: s.t, result: s.result };
      window.__battle.fastForward(stp);
      return null;
    }, [cond, step]);
    if (r) return r;
  }
  return { ok: false };
}
async function hitEl(page, phone, locator) {
  if (phone) await locator.tap();
  else await locator.click();
  await sleep(250);
}
async function toBriefing(page, prefix, phone = false) {
  // 出陣の演出（出陣前の保存の後・合戦の前）：スキップのボタンを本物の入力で押す
  await skipCinematic(page, { tap: phone, what: '出陣' });
  await page.waitForFunction(() => window.__game.screen === 'battle', null, POLL);
  const sv = await saved(page);
  check(`${prefix} 出陣前の自動保存（段階 battle・約束の答えが入る）`, sv?.point === 'departure' && sv?.phase === 'battle' && sv?.pledge !== null, JSON.stringify({ point: sv?.point, phase: sv?.phase, pledge: sv?.pledge }));
  await page.waitForFunction(() => window.__battle?.active && window.__battle.ui.modal === 'briefing' && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
  await sleep(400);
  const units = await page.evaluate(() => window.__battle.state.units.map((u) => ({ id: u.id, side: u.side, clan: u.clan, name: u.name, ability: u.ability ?? null })));
  const brief = await page.evaluate(() => document.querySelector('.b-modal, .b-brief, .b-brief-lines')?.closest('div')?.textContent ?? document.body.textContent);
  return { units, brief, save: sv };
}
async function finishBattle(page, phone, prefix) {
  await page.waitForFunction(() => window.__battle.ui.resultShown, null, POLL);
  const r = await page.evaluate(() => window.__battle.state.result);
  const title = await page.locator('.b-result h2').textContent();
  check(`${prefix} 合戦の結果の画面（${r.result} / ${r.reason} / 約束 ${r.pledge?.result ?? '-'}）`, !!r.result, title);
  await shot(page, `${prefix}-result`);
  await hitEl(page, phone, page.locator('.b-primary', { hasText: '続ける' }));
  // 帰還の演出（戦後の保存の後）：スキップのボタンを本物の入力で押す
  await skipCinematic(page, { tap: phone, what: '帰還' });
  await page.waitForFunction(() => window.__game.screen === 'explore' && !document.body.classList.contains('mode-battle') && !document.getElementById('battle-ui'), null, POLL);
  return r;
}
function checkEnding(prefix, u, s) {
  const t = u.text;
  const need = ['方針', '合戦の結果', '約束', '信頼', '信頼の変化', '徳川の兵', '支援', '次の章へ', '史実と創作', '創作'];
  const miss = need.filter((w) => !t.includes(w));
  check(`${prefix} 結末の画面：方針・勝敗・約束・信頼・損害・支援・次章の印・創作の注記`, miss.length === 0 && t.includes('歴史分岐'), miss.length ? `足りない：${miss.join('、')}` : s.ending);
  check(`${prefix} 結末に「姉川の戦いの再現」とは書かない・B を史実とは書かない`, !/姉川の戦いを再現|史実でも浅井/.test(t));
}

// ---------------------------------------------------------------- A（スマホ・タッチ）
async function runA() {
  console.log('--- A：スマホ横 844×390・タッチ（方針 A 織田 × 約束を引き受ける × 全軍撤退。支度・戦後で開き直す）');
  const { ctx, page } = await open({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const cdp = await ctx.newCDPSession(page);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('koto-sengoku/save', '{"2d":"keep"}'); });
  await reloadToTitle(page);
  const tapAt = async (x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const tap = async (sel) => {
    const r = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, sel);
    if (!r) throw new Error(`${sel} が無い`);
    await tapAt(r.x, r.y);
    await sleep(250);
  };
  const touch = { cdp, talk: () => tap('.g-talk'), next: () => tapAt(120, 150) };

  await shot(page, 'A01-title');
  let u = await ui(page);
  check('タイトル：歴史分岐と架空のシナリオが並び、それぞれに はじめから／つづきから',
    ['new:ieyasu1570', 'continue:ieyasu1570', 'new:fictional', 'continue:fictional'].every((id) => u.buttons.some((b) => b.id === id)) &&
    u.text.includes('歴史分岐：元亀元年・家康') && u.text.includes('架空：国境の砦（仮シナリオ）') &&
    u.text.includes('1570年の情勢を背景にした歴史分岐シナリオ。会話・能力・分岐後の出来事はゲーム用の創作'));
  await sleep(500);
  await tap('.g-btn[data-id="new:ieyasu1570"]');
  // 第一章の冒頭の演出（はじめからの道だけ。3D の場面だけ）：スキップのボタンを本物の入力で押す
  await skipCinematic(page, { tap: true, what: '第一章の冒頭' });
  await waitScreen(page, 'explore');
  let s = await st(page);
  check('はじめから（歴史分岐）→ 城下（家康編・目的は忠勝）', s.scenario === 'ieyasu1570' && s.phase === 'explore' && (await page.textContent('.g-hud')).includes('忠勝'), await page.textContent('.g-hud'));
  await sleep(1500);
  await shot(page, 'A02-explore');
  const cast = await castOf(page);
  check('城下の人物：本多忠勝・織田家の使者・浅井家の使者・高札', ['tadakatsu', 'oda_envoy', 'asai_envoy', 'notice'].every((id) => cast.some((c) => c.id === id)), cast.map((c) => c.id).join(','));

  u = await talkTo(page, 'oda_envoy', touch);
  check('織田家の使者（書状の趣旨を使者が伝える・引用ではないと明記）', u.seenId === 'explore.oda_envoy' && u.seen.some((l) => l.includes('実際の書状の引用ではない')), u.seenId);
  await waitScreen(page, 'explore');
  u = await talkTo(page, 'asai_envoy', touch);
  check('浅井家の使者', u.seenId === 'explore.asai_envoy', u.seenId);
  await waitScreen(page, 'explore');
  u = await talkTo(page, 'notice', touch);
  check('高札を読む', u.seenId === 'explore.notice', u.seenId);
  await waitScreen(page, 'explore');
  u = await talkTo(page, 'tadakatsu', touch);
  check('本多忠勝：軍議を開くか選ぶ', u.seenId === 'explore.tadakatsu' && u.choices.includes('open_council'), u.seenId);
  await sleep(400);
  await tap('.g-choice[data-id="open_council"]');
  await waitScreen(page, 'council');
  u = await readThrough(page, touch.next);
  check('軍議：3 つの方針', ['policy_oda', 'policy_asai', 'policy_home'].every((c) => u.choices.includes(c)), u.choices.join(','));
  await sleep(400);
  // スマホ：どの選択肢にも 1 行の要点が見える（見比べられる）
  const sums = await page.evaluate(() => [...document.querySelectorAll('.g-choice')].map((b) => { const s = b.querySelector('.s'); const r = b.getBoundingClientRect(); return { id: b.dataset.id, s: s && getComputedStyle(s).display !== 'none' ? s.textContent : null, inView: r.top >= 0 && r.bottom <= innerHeight }; }));
  check('スマホの軍議：3 つの方針すべてに要点が見え、画面に収まる', sums.length === 3 && sums.every((x) => x.s && x.inView), JSON.stringify(sums));
  check('軍議の見出しは歴史分岐の札', (await page.textContent('.g-council-head')).includes('歴史分岐'));
  await shot(page, 'A03-council-phone');
  await tap('.g-choice[data-id="policy_asai"]');
  u = await readThrough(page, touch.next);
  check('B を選ぶと確かめる（決める／考え直す）', u.seenId === 'council.confirm.asai' && u.choices.includes('reconsider'), u.seenId);
  await sleep(400);
  await tap('.g-choice[data-id="reconsider"]');
  u = await readThrough(page, touch.next);
  check('考え直す → もう一度 3 つの方針', u.choices.includes('policy_oda'), u.seenId);
  await sleep(400);
  await tap('.g-choice[data-id="policy_oda"]');
  u = await readThrough(page, touch.next);
  await sleep(400);
  await tap('.g-choice[data-id="confirm_policy"]');
  await waitScreen(page, 'explore');
  s = await st(page);
  check('方針 A に決まる → 出陣の支度（目的：約束の相手と話す）', s.phase === 'muster' && s.policy === 'oda' && (await page.textContent('.g-hud')).includes('約束'), await page.textContent('.g-hud'));

  // 城門へ行っても、約束に答える前は出陣できない
  u = await walkToGate(page, touch);
  check('約束に答える前の城門：出陣の選択肢は出ない', u.seenId === 'muster.gate.pledge_pending' && !u.choices?.length, u.seenId);
  await waitScreen(page, 'explore');

  // 約束の会話：選択肢の見張り（最後の行を出したタップの直後のタップでは決まらない）・会話の途中のメニュー
  const envoy = (await castOf(page)).find((c) => c.id === 'oda_envoy');
  await walkNear(page, touch, envoy, 'oda_envoy');
  await touch.talk();
  await waitUi(page, 'script');
  await sleep(300);
  u = await ui(page);
  check('約束の会話が始まる（織田家の使者）', u.id === 'muster.oda_envoy.pledge', u.id);
  // 途中でメニュー（右上のボタンをタップ）→ 閉じる → 同じ行のまま
  await tapAt(120, 150);
  await sleep(300);
  const before = await ui(page);
  await tap('.g-menu-btn');
  await waitUi(page, 'menu');
  const menuText = (await ui(page)).text;
  check('会話の途中にメニューが重なる（状態：方針・信頼・約束）', menuText.includes('方針') && menuText.includes('信頼') && menuText.includes('約束'));
  await shot(page, 'A04-menu-over-pledge');
  await sleep(400);
  const closeR = await page.evaluate(() => { const b = document.querySelector('.g-btn[data-id="close"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await tapAt(closeR.x, closeR.y);
  await tapAt(120, 150); // 閉じた直後の続けてのタップ（見張りの間）
  await sleep(150);
  check('メニューを閉じると会話に戻る', (await ui(page)).kind === 'script');
  const after = await ui(page);
  check('メニューを閉じると同じ行のまま（閉じた直後のタップでも進まない）', after.index === before.index, `${before.index} → ${after.index}`);
  await sleep(500);
  // 最後の 1 つ手前まで進め、最後の行を出すタップの直後に選択肢の位置をタップ
  for (let i = 0; i < 20; i++) {
    const x = await ui(page);
    if (x.index >= x.count - 2) break;
    await tapAt(120, 150);
    await sleep(220);
  }
  const pre = await ui(page);
  await tapAt(120, 150);
  await sleep(40);
  const accRect = await page.evaluate(() => { const b = document.querySelector('.g-choice[data-id="pledge_accept"]')?.getBoundingClientRect(); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  if (accRect) await tapAt(accRect.x, accRect.y);
  await sleep(200);
  u = await ui(page);
  check('約束の選択肢：出た直後のタップでは決まらない（既定は「少し考える」）', u.kind === 'script' && u.choices.length === 3 && u.selected === 'pledge_later', `pre ${pre.index}/${pre.count} sel ${u.selected}`);
  const pledgeText = await page.textContent('.g-choices');
  check('約束の選択肢：対象（織田援軍）と達成条件・引き受けないのは中立', pledgeText.includes('織田援軍') && pledgeText.includes('約束違反にはならない'), pledgeText.slice(0, 80));
  await shot(page, 'A05-pledge');
  await sleep(500);
  await tap('.g-choice[data-id="pledge_later"]');
  await waitScreen(page, 'explore');
  s = await st(page);
  check('「少し考える」：約束はまだ（出陣できない）', s.pledge === null);
  u = await talkTo(page, 'oda_envoy', touch);
  await sleep(500);
  await tap('.g-choice[data-id="pledge_accept"]');
  await waitScreen(page, 'explore');
  s = await st(page);
  check('約束を引き受ける（対象 a_oda・結果はまだ）', s.pledge?.accepted === true && s.pledge.targetId === 'a_oda' && s.pledge.result === null, JSON.stringify(s.pledge));
  u = await talkTo(page, 'tadakatsu', touch);
  check('支度の忠勝（方針 A の段取り）', u.seenId === 'muster.tadakatsu.oda', u.seenId);
  await waitScreen(page, 'explore');

  // 支度でメニューから保存 → 開き直して続きから
  await tap('.g-menu-btn');
  await waitUi(page, 'menu');
  await sleep(500);
  await tap('.g-btn[data-id="save"]');
  await page.waitForFunction(() => window.__game.ui?.kind === 'menu' && window.__game.ui.text.includes('保存しました'), null, POLL);
  check('支度：メニューから保存（読み戻して確かめた）', (await ui(page)).text.includes('読み戻して確かめました'));
  await sleep(400);
  await tap('.g-btn[data-id="close"]');
  await waitScreen(page, 'explore');
  let sv = await saved(page);
  check('保存（歴史分岐のキー）：muster・方針 A・約束を引き受けた', sv?.scenario === 'ieyasu1570' && sv.phase === 'muster' && sv.policy === 'oda' && sv.pledge?.accepted === true);
  check('架空の第一章の保存・2D 版の保存には触れていない', (await raw(page, FKEY)) === null && (await raw(page, 'koto-sengoku/save')) === '{"2d":"keep"}');
  await reloadToTitle(page);
  u = await ui(page);
  check('開き直すとタイトルの「つづきから」（歴史分岐）に支度の保存', !u.buttons.find((b) => b.id === 'continue:ieyasu1570').disabled && (await page.textContent('.g-btn[data-id="continue:ieyasu1570"]')).includes('出陣の支度'));
  await sleep(500);
  await tap('.g-btn[data-id="continue:ieyasu1570"]');
  await waitScreen(page, 'explore');
  s = await st(page);
  check('つづきから：支度・方針 A・約束を引き受けたまま', s.scenario === 'ieyasu1570' && s.phase === 'muster' && s.policy === 'oda' && s.pledge?.accepted === true);

  // 城門で出陣（約束のことが出る）
  u = await walkToGate(page, touch);
  const gateLines = u.seen.join(' / ');
  check('城門の出陣の確認：方針と約束（織田援軍の退路）が出る', u.seenId === 'muster.gate' && gateLines.includes('約束') && gateLines.includes('織田援軍') && u.choices.includes('depart'), gateLines.slice(0, 120));
  await shot(page, 'A06-gate');
  await sleep(500);
  await tap('.g-choice[data-id="depart"]');
  const b = await toBriefing(page, 'A07', true);
  check('合戦 A：味方に織田援軍、敵に浅井長政隊（敵の能力）・朝倉勢。徳川の家康本陣・忠勝隊', b.units.some((x) => x.id === 'a_oda' && x.side === 'ally') && b.units.some((x) => x.id === 'e_nagamasa' && x.side === 'enemy') && b.units.some((x) => x.clan === 'asakura' && x.side === 'enemy') && b.units.some((x) => x.id === 't_honjin' && x.side === 'ally'), b.units.map((x) => `${x.id}:${x.side}`).join(','));
  await shot(page, 'A07-briefing');
  await hitEl(page, true, page.locator('.b-primary', { hasText: '合戦を始める' }));
  check('合戦：「合戦を始める」をタップ', (await bUi(page)).started);
  console.log('   （早送り）合戦の時間を 20 秒進める');
  await ffUntil(page, 's.t > 20', 40);
  await hitEl(page, true, page.locator('.b-allret'));
  await page.locator('.b-confirm').waitFor({ state: 'visible' });
  await sleep(400);
  await hitEl(page, true, page.locator('.b-confirm .b-btn', { hasText: '撤退する' }));
  check('「全軍撤退」→「撤退する」をタップ', (await page.evaluate(() => window.__battle.state.allRetreatAt)) !== null);
  console.log('   （早送り）全軍が退くまで');
  await ffUntil(page, 'false', 200);
  const out = await finishBattle(page, true, 'A08');
  await waitScreen(page, 'explore');
  s = await st(page);
  sv = await saved(page);
  check('戦後：勝敗と約束を別々に記録（自動保存にも同じ）', s.phase === 'aftermath' && s.result === out.result && s.pledge.result && sv.point === 'aftermath' && sv.battle.result === s.result && sv.pledge.result === s.pledge.result && sv.appliedBattleId === s.battleId,
    JSON.stringify({ result: s.result, pledge: s.pledge.result, trust: s.trust, support: s.support }));
  const trustA = s.trust;
  const troopsA = s.troops;
  await shot(page, 'A09-aftermath');
  u = await talkTo(page, 'oda_envoy', touch);
  check('戦後の織田家の使者（結果 × 約束）', u.seenId?.startsWith('aftermath.oda_envoy.') && u.seenId.endsWith(`.${s.pledge.result}`), u.seenId);
  await waitScreen(page, 'explore');

  // 開き直して続きから：結果・約束・信頼が同じ（二重に反映しない）
  await reloadToTitle(page);
  check('開き直すとタイトルの「つづきから」に戦後の保存', (await page.textContent('.g-btn[data-id="continue:ieyasu1570"]')).includes('戦の後'));
  await sleep(500);
  await tap('.g-btn[data-id="continue:ieyasu1570"]');
  await waitScreen(page, 'explore');
  s = await st(page);
  check('つづきから（戦後）：勝敗・約束・信頼・兵が同じ（二重に反映しない）', s.phase === 'aftermath' && s.result === out.result && JSON.stringify(s.trust) === JSON.stringify(trustA) && JSON.stringify(s.troops) === JSON.stringify(troopsA) && s.applied === s.battleId, JSON.stringify(s.trust));
  u = await talkTo(page, 'tadakatsu', touch);
  check('戦後の忠勝：方針 × 結果', u.seenId === `aftermath.tadakatsu.oda.${s.result}`, u.seenId);
  await sleep(500);
  await tap('.g-choice[data-id="end_chapter"]');
  await waitUi(page, 'ending');
  await shot(page, 'A10-ending');
  u = await ui(page);
  s = await st(page);
  checkEnding('A', u, s);
  // 保存の知らせは押せない（下の操作を奪わない）
  const tpe = await page.evaluate(() => getComputedStyle(document.querySelector('.g-toast')).pointerEvents);
  check('知らせ（.g-toast）は pointer-events: none', tpe === 'none', tpe);
  await tap('.g-btn[data-id="title"]');
  await waitTitle(page);
  check('結末 → タイトル。つづきからは章の結末', (await page.textContent('.g-btn[data-id="continue:ieyasu1570"]')).includes('章の結末'));
  check('2D 版の保存はそのまま', (await raw(page, 'koto-sengoku/save')) === '{"2d":"keep"}');
  await ctx.close();
}

// ---------------------------------------------------------------- B（PC・キー）
async function runB() {
  console.log('--- B：PC・キーとマウス（方針 B 浅井 × 約束を引き受けない × 早送りで決着）');
  const { ctx, page } = await open();
  const kb = { talk: () => page.keyboard.press('KeyE'), next: () => page.keyboard.press('Enter') };
  const pick = async (id) => {
    await sleep(450);
    await page.locator(`.g-choice[data-id="${id}"]`).click();
  };
  const pressBtn = async (id) => {
    await sleep(450);
    await page.locator(`.g-btn[data-id="${id}"]`).click();
  };
  await pressBtn('new:ieyasu1570');
  // 前の保存があれば上書きの確認
  await page.waitForFunction(() => ['explore', 'cinematic'].includes(window.__game.screen) || window.__game.ui?.kind === 'confirm', null, POLL);
  if ((await ui(page))?.kind === 'confirm') {
    check('はじめから：前の保存（歴史分岐）の上書きを確かめる', (await ui(page)).text.includes('ほかのシナリオの保存'));
    await pressBtn('new');
  }
  await skipCinematic(page, { what: '第一章の冒頭' });
  await waitScreen(page, 'explore');
  let u = await talkTo(page, 'tadakatsu', kb);
  await pick('open_council');
  await waitScreen(page, 'council');
  u = await readThrough(page, kb.next);
  await shot(page, 'B01-council-desk');
  // キーで選ぶ：↓ で B へ、Enter
  await sleep(450);
  await page.keyboard.press('ArrowDown');
  await sleep(100);
  await page.keyboard.press('Enter');
  u = await readThrough(page, kb.next);
  check('キーで B を選ぶ → 確かめる', u.seenId === 'council.confirm.asai', u.seenId);
  await pick('confirm_policy');
  await waitScreen(page, 'explore');
  let s = await st(page);
  check('方針 B（浅井）に決まる', s.policy === 'asai' && s.phase === 'muster');
  u = await talkTo(page, 'asai_envoy', kb);
  check('浅井家の使者の約束（長政隊の退き口）', u.seenId === 'muster.asai_envoy.pledge' && (await page.textContent('.g-choices')).includes('浅井長政隊'), u.seenId);
  await pick('pledge_decline');
  await waitScreen(page, 'explore');
  s = await st(page);
  check('約束を引き受けない（declined・信頼は変わらない）', s.pledge?.accepted === false && s.pledge.result === 'declined' && s.trust.asai === 10);
  u = await walkToGate(page, kb);
  check('城門：約束は引き受けていないと出る', u.seen.join(' ').includes('引き受けていない'));
  await pick('depart');
  const b = await toBriefing(page, 'B02');
  check('合戦 B：浅井長政隊は味方（能力つき）、敵は織田方（信長本人は出ない）', b.units.some((x) => x.id === 'a_nagamasa' && x.side === 'ally' && x.ability === 'nagamasa_support') && b.units.filter((x) => x.side === 'enemy').every((x) => x.clan === 'oda') && !b.units.some((x) => /信長/.test(x.name)), b.units.map((x) => `${x.name}:${x.side}`).join(','));
  await shot(page, 'B02-briefing');
  await page.locator('.b-primary', { hasText: '合戦を始める' }).click();
  await sleep(500);
  console.log('   （早送り）命令を出さずに決着まで');
  await ffUntil(page, 'false', 900);
  const out = await finishBattle(page, false, 'B03');
  await waitScreen(page, 'explore');
  s = await st(page);
  check('戦後 B：約束は declined のまま（違反ではない）・援兵なし・織田の信頼は下がる', s.pledge.result === 'declined' && s.support?.reinforcement === false && s.trust.oda < 30, JSON.stringify({ r: out.result, trust: s.trust }));
  u = await talkTo(page, 'tadakatsu', kb);
  check('戦後の忠勝（B）', u.seenId === `aftermath.tadakatsu.asai.${s.result}` && u.seen.some((l) => l.includes('責められる筋はございませぬ')), u.seenId);
  await pick('end_chapter');
  await waitUi(page, 'ending');
  await shot(page, 'B04-ending');
  u = await ui(page);
  s = await st(page);
  checkEnding('B', u, s);
  check('B の結末は「史実から分かれた道」と明記', u.text.includes('史実から分かれた道'));
  await ctx.close();
}

// ---------------------------------------------------------------- C（PC・マウス）
async function runC() {
  console.log('--- C：PC・マウス（方針 C 自領の防衛 × 忠勝の約束を引き受ける × 全軍撤退）');
  const { ctx, page } = await open();
  const mouse = { talk: () => page.locator('.g-talk').click(), next: () => page.mouse.click(640, 200) };
  const pick = async (id) => {
    await sleep(450);
    await page.locator(`.g-choice[data-id="${id}"]`).click();
  };
  await sleep(450);
  await page.locator('.g-btn[data-id="new:ieyasu1570"]').click();
  await page.waitForFunction(() => ['explore', 'cinematic'].includes(window.__game.screen) || window.__game.ui?.kind === 'confirm', null, POLL);
  if ((await ui(page))?.kind === 'confirm') {
    await sleep(450);
    await page.locator('.g-btn[data-id="new"]').click();
  }
  await skipCinematic(page, { what: '第一章の冒頭' });
  await waitScreen(page, 'explore');
  await talkTo(page, 'tadakatsu', mouse);
  await pick('open_council');
  await waitScreen(page, 'council');
  await readThrough(page, mouse.next);
  await pick('policy_home');
  let u = await readThrough(page, mouse.next);
  check('C を選ぶと「両家に刃を向けるわけではない」', u.seen.some((l) => l.includes('両家に刃を向けるわけではございませぬ')));
  await pick('confirm_policy');
  await waitScreen(page, 'explore');
  let s = await st(page);
  const cast = await castOf(page);
  check('方針 C の支度：使者は居ない（両家とは戦わない）', s.policy === 'home' && !cast.some((c) => c.id === 'oda_envoy' || c.id === 'asai_envoy'), cast.map((c) => c.id).join(','));
  u = await talkTo(page, 'tadakatsu', mouse);
  check('忠勝の約束（岡崎の守備隊の退路）', u.seenId === 'muster.tadakatsu.pledge' && (await page.textContent('.g-choices')).includes('岡崎の守備隊'), u.seenId);
  await pick('pledge_accept');
  await waitScreen(page, 'explore');
  u = await walkToGate(page, mouse);
  await pick('depart');
  const b = await toBriefing(page, 'C01');
  check('合戦 C：敵は浪人衆だけ（織田・浅井は出ない）、味方に岡崎の守備隊', b.units.filter((x) => x.side === 'enemy').every((x) => x.clan === 'ronin') && !b.units.some((x) => x.clan === 'oda' || x.clan === 'asai') && b.units.some((x) => x.id === 't_reserve' && x.side === 'ally'));
  check('合戦の説明：「1570年の情勢を背景にした架空の局地戦」', (await page.evaluate(() => document.body.textContent)).includes('1570年の情勢を背景にした架空の局地戦'));
  await shot(page, 'C01-briefing');
  await page.locator('.b-primary', { hasText: '合戦を始める' }).click();
  await sleep(500);
  console.log('   （早送り）15 秒');
  await ffUntil(page, 's.t > 15', 30);
  await page.locator('.b-allret').click();
  await page.locator('.b-confirm').waitFor({ state: 'visible' });
  await sleep(400);
  await page.locator('.b-confirm .b-btn', { hasText: '撤退する' }).click();
  console.log('   （早送り）全軍が退くまで');
  await ffUntil(page, 'false', 200);
  const out = await finishBattle(page, false, 'C02');
  await waitScreen(page, 'explore');
  s = await st(page);
  check('戦後 C：勝敗と約束を別々に記録・約束の相手は忠勝・織田の信頼は下がる（敵にはならない）', s.result === out.result && ['kept', 'broken'].includes(s.pledge.result) && s.pledge.partner === 'tadakatsu' && s.trust.oda < 30, JSON.stringify({ r: s.result, p: s.pledge.result, trust: s.trust, support: s.support }));
  u = await talkTo(page, 'oda_envoy', mouse).catch(() => null);
  if (u) check('戦後 C：織田家の使者が不満を伝えに来る（敵ではない）', u.seenId === 'aftermath.oda_envoy.home', u.seenId);
  await waitScreen(page, 'explore');
  u = await talkTo(page, 'tadakatsu', mouse);
  await pick('end_chapter');
  await waitUi(page, 'ending');
  await shot(page, 'C03-ending');
  u = await ui(page);
  s = await st(page);
  checkEnding('C', u, s);
  await ctx.close();
}

// ---------------------------------------------------------------- F（架空の第一章）
const V1_AFTERMATH_OMORI_DEFEAT = '{"version":1,"savedAt":"2026-09-28T10:00:00.000Z","point":"aftermath","playTimeSec":0,"phase":"aftermath","alliance":"omori","relations":{"tashiro":-20,"omori":0,"washio":-60},"troops":{"honjin":240,"genzo":400,"shinpachi":280,"reserve":300},"characters":{"hero":"wounded","genzo":"wounded","shinpachi":"alive","tashiro_envoy":"alive","omori_envoy":"alive","washio_gen":"alive"},"talked":{"explore.genzo":true,"explore.shinpachi":true,"council.council":true,"muster.gate":true},"battle":{"result":"defeat","reason":"ally_hq_routed","elapsedSec":300,"units":[{"id":"a_hq","side":"ally","clan":"kotosaka","startStrength":300,"endStrength":240,"status":"routed","leaderId":"hero"},{"id":"a_genzo","side":"ally","clan":"kotosaka","startStrength":500,"endStrength":400,"status":"ready","leaderId":"genzo"},{"id":"a_shinpachi","side":"ally","clan":"kotosaka","startStrength":350,"endStrength":280,"status":"ready","leaderId":"shinpachi"},{"id":"a_omori","side":"ally","clan":"omori","startStrength":400,"endStrength":320,"status":"ready","leaderId":"omori_envoy"},{"id":"e_hq","side":"enemy","clan":"washio","startStrength":350,"endStrength":280,"status":"ready","leaderId":"washio_gen"},{"id":"e_sente","side":"enemy","clan":"washio","startStrength":550,"endStrength":440,"status":"ready"},{"id":"e_yumi","side":"enemy","clan":"washio","startStrength":350,"endStrength":280,"status":"ready"},{"id":"e_tashiro","side":"enemy","clan":"tashiro","startStrength":250,"endStrength":200,"status":"ready","leaderId":"tashiro_envoy"}]},"ending":null,"explore":null}';
async function runF() {
  console.log('--- F：架空の第一章（古い保存 版 1 を読む・はじめからも始まる）');
  const { ctx, page } = await open();
  const ieyasuBefore = await raw(page, KEY);
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [FKEY, V1_AFTERMATH_OMORI_DEFEAT]);
  await reloadToTitle(page);
  const c = await page.textContent('.g-btn[data-id="continue:fictional"]');
  check('タイトル：架空の「つづきから」に版 1 の戦後の保存', c.includes('戦後') || c.includes('戦の後'), c);
  await shot(page, 'F01-title-with-saves');
  await sleep(450);
  await page.locator('.g-btn[data-id="continue:fictional"]').click();
  await waitScreen(page, 'explore');
  const s = await page.evaluate(() => { const x = window.__game.state; return { sc: window.__game.scenario, phase: x.phase, alliance: x.alliance, rel: x.relations, result: x.battle?.result }; });
  check('架空の第一章を版 1 の保存から続けられる（大森・田代のまま。織田・浅井に書き換えない）', s.sc === 'fictional' && s.phase === 'aftermath' && s.alliance === 'omori' && s.rel.tashiro === -20 && s.rel.omori === 0 && s.result === 'defeat', JSON.stringify(s));
  check('HUD は架空の第一章（仮シナリオ）', (await page.textContent('.g-hud')).includes('国境の砦') && (await page.textContent('.g-hud')).includes('仮シナリオ'));
  await sleep(1000);
  await shot(page, 'F02-fictional-continue');
  check('保存の中身は版 1 のまま（読むだけでは書き換えない）', (await raw(page, FKEY)) === V1_AFTERMATH_OMORI_DEFEAT);
  check('歴史分岐の保存には触れない', (await raw(page, KEY)) === ieyasuBefore);
  // はじめから（架空）
  await reloadToTitle(page);
  await sleep(450);
  await page.locator('.g-btn[data-id="new:fictional"]').click();
  await waitUi(page, 'confirm');
  await sleep(450);
  await page.locator('.g-btn[data-id="new"]').click();
  await waitScreen(page, 'explore');
  const s2 = await page.evaluate(() => ({ sc: window.__game.scenario, phase: window.__game.state.phase, cast: window.__game.cast.map((c) => c.id) }));
  check('架空の第一章を、はじめから始められる（源蔵・新八・高札）', s2.sc === 'fictional' && s2.phase === 'explore' && s2.cast.includes('genzo') && s2.cast.includes('shinpachi'), JSON.stringify(s2));
  await ctx.close();
}

try {
  if (ONLY.includes('A')) await runA();
  if (ONLY.includes('B')) await runB();
  if (ONLY.includes('C')) await runC();
  if (ONLY.includes('F')) await runF();
} catch (e) {
  failed++;
  console.log('NG 途中で止まった：', e.stack || e.message);
}
check('ページの誤りが無い', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? `\n${failed} 件 NG` : '\nALL OK');
process.exit(failed ? 1 : 0);
