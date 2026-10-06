// 歴史分岐「元亀元年・家康」第二章の画面の確かめ（開発サーバー。キャンペーンの側の画面：結末の「第二章へ進む」・結果確認・第二章の城下・区切り）。
//
// 確認の種類（出力の行にも書く）：
//   - 第一章の結末の保存は、実物の文字列（tests/fixtures/ieyasu-ch1-v3/*.json）を localStorage に入れて読む（保存を入れるのは直接状態変更）。
//   - タイトル・結末・結果確認・会話の行送り・選択肢・城門の出陣・合戦の「全軍撤退」・結果の画面の「続ける」は、本物のクリック・キー・タップ。
//   - 城下の相手に話しかけるのは開発用の __game.talk（歩いて近づく代わり。距離を問わない＝直接操作）。
//   - 合戦の待ち時間は、全軍撤退を命じた後に「指揮」（一時停止）にして window.__battle.fastForward で進める（早送り）。
//   - 架空の章の結末は __game.setPhase('ending')（直接状態変更）で出して、ボタンが 1 つのままかを見る。
//   D（PC 1280×720）：A 織田・勝利・約束を守った → Enter で「第二章へ進む」→ 結果確認 → 城下 → 軍議 → 補充 → 出陣 → 全軍撤退 → 戦後 → 読み込み直し → 区切り → タイトル。
//     主目標の条件（state.terms）が軍議で確定し、補充・戦後・読み込み直しで変わらないこと、選択肢の説明（確定する主目標・補充の代償）も見る。
//   P（スマホ横 844×390・タッチ）：B 浅井・敗北・約束を破った・損害大 → タップで「第二章へ進む」→ 結果確認 → 城下 → 軍議（判断 2 は出ない）→
//     補充「待つ」→ 城門 → 出陣（合戦の説明まで）→ 読み込み直し（出陣前の保存から支度へ）。兵が少ないときの条件（連れ帰る兵 3 割）が、
//     待って兵が戻っても外れないこと（前の作り方では外れて 4 割になった組み合わせ）。
//   F（PC）：架空の章の結末はボタン 1 つ（タイトルへ）。
//
// 使い方：自動再読み込みなしの開発サーバーを起動して
//   (PORT=8171 setsid nohup npx vite --config proto3d/blender/tools/vite.nohmr.mjs > /tmp/vite-8171.log 2>&1 &)
//   BASE3D=http://localhost:8171 node e2e/ieyasu-ch2-smoke.mjs [出力先]   （ONLY=DPF で絞る）
import { readFileSync } from 'node:fs';
import { launchBrowser, outDir, skipCinematic } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/ieyasu/ch2-smoke');
const BASE = process.env.BASE3D || 'http://localhost:8171';
const ONLY = process.env.ONLY || 'DPF';
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
const KEY_CH1 = 'koto-sengoku/3d-ieyasu1570/chapter1';
const FKEY = 'koto-sengoku/3d-chapter1';
const KEY2D = 'koto-sengoku/save';
const PKEY = 'koto-sengoku/3d-fields';
const SENT2D = '{"2d":"keep"}';
const SENTP = '{"sentinel":"practice"}';
const SENTF = '{"sentinel":"fictional"}';
const fixture = (n) => readFileSync(new URL(`../tests/fixtures/ieyasu-ch1-v3/${n}.json`, import.meta.url), 'utf8');
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
/** 保存を入れて読み込み直す（直接状態変更） */
async function seed(page, name) {
  await page.evaluate(([k, v, k2, s2, kp, sp, kf, sf]) => {
    localStorage.clear();
    localStorage.setItem(k, v);
    localStorage.setItem(k2, s2);
    localStorage.setItem(kp, sp);
    localStorage.setItem(kf, sf);
  }, [KEY, fixture(name), KEY2D, SENT2D, PKEY, SENTP, FKEY, SENTF]);
  await reloadToTitle(page);
}
const ui = (page) => page.evaluate(() => window.__game.ui);
/** 選択肢のボタンの文（名前・説明・まとめ） */
const choiceText = (page, id) => page.evaluate((id) => document.querySelector(`.g-choice[data-id="${id}"]`)?.textContent ?? '', id);
const st = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__game.state)));
const saved = (page, k = KEY) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), k);
const rawKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('koto-sengoku/')).sort());
const raw = (page, k) => page.evaluate((k) => localStorage.getItem(k), k);
const waitUi = (page, kind) => page.waitForFunction((k) => window.__game.ui?.kind === k, kind, POLL);
const waitScreen = (page, s) => page.waitForFunction((k) => window.__game.screen === k, s, POLL);
const shot = async (page, name) => {
  await page.evaluate(() => { if (!document.body.classList.contains('mode-battle')) window.__p3.renderNow(); });
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 300000 });
  note(`撮影 ${name}`);
};

function desktopIO(page) {
  return {
    next: () => page.keyboard.press('Enter'),
    pick: async (id) => { await sleep(450); await page.locator(`.g-choice[data-id="${id}"]`).click(); },
    btn: async (id) => { await sleep(450); await page.locator(`.g-btn[data-id="${id}"]`).click(); },
    press: async (sel) => { await page.locator(sel).first().click(); await sleep(200); },
  };
}
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
    next: () => tapAt(120, 150),
    pick: async (id) => { await sleep(450); await tapSel(`.g-choice[data-id="${id}"]`); },
    btn: async (id) => { await sleep(450); await tapSel(`.g-btn[data-id="${id}"]`); },
    press: async (sel) => { await page.locator(sel).first().tap(); await sleep(200); },
  };
}

async function readThrough(page, press) {
  let id = null;
  const seen = [];
  for (let i = 0; i < 80; i++) {
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
/** 話しかける（開発用の __game.talk：距離を問わない＝直接操作）→ 行は本物の入力で送る */
async function talk(page, io, id) {
  await page.evaluate((id) => window.__game.talk(id), id);
  await waitUi(page, 'script');
  return readThrough(page, io.next);
}

/** 結末 →「第二章へ進む」→ 結果確認 → 城下（how：'enter' は Enter キー、'tap'／'click' はボタン） */
async function enterCh2(page, io, prefix, how) {
  const c = await page.locator('.g-btn[data-id="continue:ieyasu1570"]').textContent();
  check(`${prefix} タイトル：歴史分岐の「つづきから」は第一章の結末（説明に「章の結末」）`, c.includes('章の結末'), c.replace(/\s+/g, ' ').slice(0, 80));
  await io.btn('continue:ieyasu1570');
  await waitUi(page, 'ending');
  await sleep(300);
  const e = await ui(page);
  const sel = await page.evaluate(() => document.querySelector('.g-layer[data-kind="ending"] .g-btn.sel')?.dataset.id ?? null);
  check(`${prefix} 第一章の結末の画面は残り、下に「第二章へ進む」（既定）と「タイトルへ」`, JSON.stringify(e.buttons.map((b) => b.id)) === '["next_chapter","title"]' && sel === 'next_chapter' && e.text.includes('第二章へ進む') && e.text.includes('史実と創作'), JSON.stringify({ ids: e.buttons.map((b) => b.id), sel }));
  const k1 = await page.evaluate(() => document.querySelector('.g-layer[data-kind="ending"] .kicker')?.textContent ?? '');
  check(`${prefix} 第一章の結末の見出しは今までどおり「…　結末」`, k1.endsWith('　結末') && !k1.includes('第二章'), k1);
  await shot(page, `${prefix}-ch1-ending`);
  if (how === 'enter') {
    await sleep(500);
    await page.keyboard.press('Enter');
  } else await io.btn('next_chapter');
  // 保存の後：結果確認の画面 →「城下へ」→ 第二章の冒頭（3D の場面だけ。スキップのボタンを本物の入力で押す）
  await waitUi(page, 'record');
  await sleep(300);
  const r = await ui(page);
  check(`${prefix} 「第一章の結果（第二章へ引き継ぐもの）」の画面（ボタンは「城下へ」だけ）`, r.text.includes('第一章の結果（第二章へ引き継ぐもの）') && JSON.stringify(r.buttons.map((b) => b.id)) === '["to_town"]', r.text.slice(0, 80));
  check(`${prefix} 結果確認に、方針・兵・約束・援兵・信頼・人物・副目標と「第二章で効くこと」`, ['方針', '部隊ごとの兵', '約束', '援兵', '信頼', '人物', '副目標', '効くこと：支援', '効くこと：補充', '効くこと：敵の勢い', '効くこと：士気', '効くこと：負傷', '効くこと：兵が少ないとき'].every((w) => r.text.includes(w)));
  const sv = await saved(page);
  const b1 = await saved(page, KEY_CH1);
  check(`${prefix} 移るときの保存：本来のキーは第二章の始め（版 4）・第一章の結末は控えのキー（版 3）`, sv?.version === 4 && sv.chapter === 2 && sv.point === 'chapter' && b1?.version === 3 && b1.phase === 'ending', JSON.stringify({ v: sv?.version, point: sv?.point, ch1: b1?.phase }));
  await shot(page, `${prefix}-ch1-record`);
  await io.btn('to_town');
  await skipCinematic(page, { tap: how === 'tap', what: '第二章の冒頭', log: note });
  await waitScreen(page, 'explore');
  await sleep(500);
  const s = await st(page);
  const hud = await page.evaluate(() => document.querySelector('.g-hud')?.textContent ?? '');
  check(`${prefix} 第二章の城下（章の名前・段階・目印は忠勝）`, s.chapter === 2 && s.phase === 'explore' && hud.includes('第二章'), hud.slice(0, 80));
  await shot(page, `${prefix}-ch2-town`);
  return { record: r, state: s };
}

// ---------------------------------------------------------------- D：PC
if (ONLY.includes('D')) {
  const { ctx, page } = await open();
  const io = desktopIO(page);
  await seed(page, 'oda_victory_kept');
  const { state: s0 } = await enterCh2(page, io, 'D', 'enter');
  check('D 第二章のはじめの兵＝第一章の終わりの兵（援兵は足さない）', JSON.stringify(s0.troops) === JSON.stringify(s0.chapter1.troops), JSON.stringify(s0.troops));
  let u = await talk(page, io, 'ishikawa');
  check('D 石川数正：援兵は受け取り済み・この数に入っている', u.seen.some((l) => l.includes('すでに受け取り、この数に入っております')), u.seenId);
  u = await talk(page, io, 'envoy');
  check('D 織田家の使者（約束を守った＝厚い）', u.seenId === 'ch2.explore.envoy.oda.kept', u.seenId);
  u = await talk(page, io, 'tadakatsu');
  check('D 忠勝：軍議を開く', (u.choices ?? []).includes('open_council'), u.seenId);
  await io.pick('open_council');
  await waitScreen(page, 'council');
  u = await readThrough(page, io.next);
  check('D 軍議：判断が 2 つ（殿を引き受ける／退き口の手前を固める）', JSON.stringify(u.choices ?? []) === '["plan_commit","plan_hold"]', JSON.stringify(u.choices));
  const cc = await choiceText(page, 'plan_commit');
  check('D 軍議の選択肢の説明に「この判断で確定する主目標」（後の補充では変わらない）', cc.includes('この判断で確定する主目標：家康本陣と織田勢の 2 隊') && cc.includes('決めた後の補充では変わらない'), cc.slice(0, 120));
  check('D 軍議：主目標の条件は判断を決めた時に確定する、と述べる', u.seen.some((l) => l.includes('主目標の条件は、ここで判断を決めた時に')));
  await io.pick('plan_hold');
  u = await readThrough(page, io.next);
  await io.pick('reconsider');
  u = await readThrough(page, io.next);
  await io.pick('plan_commit');
  u = await readThrough(page, io.next);
  check('D 判断を確かめる（考え直した後）', u.seenId === 'ch2.council.confirm.oda.commit', u.seenId);
  check('D 確かめ：決めると主目標の条件が確定する', u.seen.some((l) => l.includes('決めると主目標の条件が確定する')), u.seen.slice(-2).join(' / ').slice(0, 120));
  const pre = await st(page);
  check('D 決める前（考え直した後も）は主目標の条件が無い', pre.terms === null && pre.plan === null);
  await io.pick('confirm_plan');
  await waitScreen(page, 'explore');
  const sm = await st(page);
  const termsD = JSON.stringify(sm.terms);
  check('D 判断を決めた時に主目標の条件が確定（第一章の終わりの兵で数える・兵が少なくない）', sm.terms?.plan === 'commit' && sm.terms.policy === 'oda' && sm.terms.thin === false && sm.terms.basisTroops >= 650, termsD);
  u = await talk(page, io, 'gate');
  check('D 補充を答える前は城門で出陣できない', u.seenId === 'ch2.muster.gate.recovery_pending' && !u.choices?.length, u.seenId);
  await waitScreen(page, 'explore');
  u = await talk(page, io, 'ishikawa');
  check('D 石川数正：補充の 3 つ（＋少し考える）', ['recovery_wait', 'recovery_transfer', 'recovery_none', 'recovery_later'].every((c) => (u.choices ?? []).includes(c)), JSON.stringify(u.choices));
  const cw = await choiceText(page, 'recovery_wait');
  const ct = await choiceText(page, 'recovery_transfer');
  const cn = await choiceText(page, 'recovery_none');
  check('D 補充の選択肢（選ぶ前）：待つ代償（何が何秒に早まるか）と、主目標の条件は軍議で決めたまま変わらない', cw.includes('浅井の後詰めの騎馬が 1 分 10 秒ほど → 30 秒ほど') && [cw, ct, cn].every((t) => t.includes('主目標の条件は軍議で決めたまま変わらない')), cw.slice(0, 160));
  await io.pick('recovery_none');
  await waitScreen(page, 'explore');
  check('D 補充の後も主目標の条件は同じ', JSON.stringify((await st(page)).terms) === termsD);
  u = await talk(page, io, 'gate');
  check('D 城門：判断・補充・出る部隊・支援・確定した主目標をまとめて見せ、出陣できる', u.seenId === 'ch2.muster.gate' && (u.choices ?? []).includes('depart') && u.seen.join(' ').includes('支援：織田の鉄砲隊') && u.seen.join(' ').includes('主目標（軍議で確定）'), u.seen.join(' / ').slice(0, 160));
  await io.pick('depart');
  await skipCinematic(page, { what: '出陣', log: note });
  await page.waitForFunction(() => window.__game.screen === 'battle' && !!window.__battle?.state, null, POLL);
  const dep = await saved(page);
  check('D 出陣前の自動保存（版 4・支度から）', dep?.version === 4 && dep.point === 'departure', JSON.stringify({ v: dep?.version, point: dep?.point }));
  await page.waitForFunction(() => document.body.classList.contains('mode-battle') && document.querySelector('.b-allret'), null, POLL);
  const bi = await page.evaluate(() => ({ map: window.__battle.state.setup.map.id, name: window.__battle.state.setup.map.name, brief: window.__battle.state.setup.briefing[0] }));
  check('D 合戦：第二章の地図（ieyasu2_）・説明の 1 行目は分岐した世界の創作', bi.map.startsWith('ieyasu2_') && bi.brief.includes('第一章の直後'), JSON.stringify(bi).slice(0, 160));
  await page.waitForFunction(() => window.__battle?.active && window.__battle.ui.modal === 'briefing' && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
  const brief = await page.textContent('.b-modal');
  check('D 合戦の前の説明：分岐した世界の創作・第一章の勢い・支援', brief.includes('第一章の直後') && brief.includes('第一章') && brief.includes('鉄砲隊'), brief.slice(0, 100));
  await shot(page, 'D-ch2-briefing');
  await io.press('.b-primary:has-text("合戦を始める")');
  await sleep(1500);
  await shot(page, 'D-ch2-battle');
  await io.press('.b-allret');
  await page.locator('.b-confirm').waitFor({ state: 'visible' });
  await sleep(300);
  await io.press('.b-confirm .b-btn:has-text("撤退する")');
  const ordered = await page.evaluate(() => window.__battle.state.allRetreatAt !== null);
  check('D 全軍撤退を画面のボタンで命じた', ordered);
  if (!(await page.evaluate(() => window.__battle.ui.paused))) await page.keyboard.press('Space');
  let n = 0;
  while (!(await page.evaluate(() => !!window.__battle.state.result)) && n++ < 900) await page.evaluate(() => window.__battle.fastForward(1));
  note(`（早送り）全軍撤退の後、止めたまま合戦の時間を ${n} 秒進めた`);
  await page.waitForFunction(() => window.__battle.ui.resultShown && document.querySelector('.b-result'), null, POLL);
  const out = await page.evaluate(() => window.__battle.state.result);
  const aft = await saved(page);
  check('D 結果の画面の時点で戦後の自動保存（版 4・反映済み）', aft?.version === 4 && aft.point === 'aftermath' && aft.appliedBattleId === aft.battleId && aft.result?.sortie?.includes('honjin'), JSON.stringify({ result: out.result, reason: out.reason, point: aft?.point }));
  await shot(page, 'D-ch2-result');
  await io.press('.b-primary:has-text("続ける")');
  await skipCinematic(page, { what: '帰還', log: note });
  await page.waitForFunction(() => window.__game.screen === 'explore' && !document.body.classList.contains('mode-battle'), null, POLL);
  // 読み込み直す → つづきから
  await reloadToTitle(page);
  const c2 = await page.locator('.g-btn[data-id="continue:ieyasu1570"]').textContent();
  check('D 読み込み直すと、つづきからは「第二章・戦の後」', c2.includes('第二章・戦の後'), c2.replace(/\s+/g, ' ').slice(0, 80));
  await io.btn('continue:ieyasu1570');
  await waitScreen(page, 'explore');
  const s2 = await st(page);
  check('D 第二章の戦後から（二重に反映しない）', s2.chapter === 2 && s2.phase === 'aftermath' && s2.appliedBattleId === aft.appliedBattleId && JSON.stringify(s2.trust) === JSON.stringify(aft.trust));
  check('D 戦後・読み込み直しの後も主目標の条件は同じ（保存にも残る）', JSON.stringify(s2.terms) === termsD && JSON.stringify(aft.terms) === termsD && aft.result?.thin === false, JSON.stringify(s2.terms));
  u = await talk(page, io, 'tadakatsu');
  check('D 戦後の忠勝：第二章を締めくくる', (u.choices ?? []).includes('end_chapter'), u.seenId);
  await io.pick('end_chapter');
  await waitUi(page, 'ending');
  await sleep(300);
  const e2 = await ui(page);
  check('D 第二章の区切り：ボタンは「タイトルへ」だけ・記録と史実と創作', JSON.stringify(e2.buttons.map((b) => b.id)) === '["title"]' && ['第二章', '判断', '補充', '主目標', '信頼の変化', '史実と創作', '特定の史実の合戦の再現ではない'].every((w) => e2.text.includes(w)), e2.text.slice(0, 100));
  check('D 区切りの文に史実の合戦の名前・逸話を書かない', !/姉川|金ヶ崎|小谷|単騎|無傷/.test(e2.text));
  const k2 = await page.evaluate(() => document.querySelector('.g-layer[data-kind="ending"] .kicker')?.textContent ?? '');
  check('D 第二章の区切りの見出しは「…第二章　区切り」（「結末」と書かない）', k2.endsWith('第二章　区切り') && !k2.includes('結末'), k2);
  await shot(page, 'D-ch2-ending');
  await io.btn('title');
  await waitTitle(page);
  const c3 = await page.locator('.g-btn[data-id="continue:ieyasu1570"]').textContent();
  check('D タイトル：つづきからは「第二章の区切り」', c3.includes('第二章の区切り') && !c3.includes('章の結末'), c3.replace(/\s+/g, ' ').slice(0, 80));
  const keys = await rawKeys(page);
  check('D 保存のキー：歴史分岐の本来のキー・第一章の控え・2D・架空・演習だけ。2D・架空・演習はそのまま',
    JSON.stringify(keys) === JSON.stringify([KEY2D, FKEY, PKEY, KEY, KEY_CH1].sort()) && (await raw(page, KEY2D)) === SENT2D && (await raw(page, FKEY)) === SENTF && (await raw(page, PKEY)) === SENTP, JSON.stringify(keys));
  await ctx.close();
}

// ---------------------------------------------------------------- P：スマホ
if (ONLY.includes('P')) {
  const { ctx, page } = await open({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const io = await phoneIO(ctx, page);
  await seed(page, 'asai_defeat_broken_heavy');
  const { record } = await enterCh2(page, io, 'P', 'tap');
  check('P 結果確認：約束は「守れなかった」・負傷の影響・兵が少ないときは判断を決めた時に確定', record.text.includes('守れなかった') && record.text.includes('浅井勢の後備え') && record.text.includes('この判断に決めると') && record.text.includes('後の補充では変わらない'));
  let u = await talk(page, io, 'envoy');
  check('P 浅井家の使者（約束を破った＝冷たい・長政は負傷で後に残る）', u.seenId === 'ch2.explore.envoy.asai.broken' && u.seen.some((l) => l.includes('傷が癒えず')), u.seenId);
  u = await talk(page, io, 'tadakatsu');
  await io.pick('open_council');
  await waitScreen(page, 'council');
  u = await readThrough(page, io.next);
  check('P 軍議：損害が大きいと判断 2 は出ず、理由と兵が少ないときの調整を述べる', JSON.stringify(u.choices ?? []) === '["plan_commit"]' && u.seen.some((l) => l.includes('は取れませぬ')) && u.seen.some((l) => l.includes('第一章の損害で兵が少ないため')), JSON.stringify(u.choices));
  await shot(page, 'P-ch2-council');
  await io.pick('plan_commit');
  u = await readThrough(page, io.next);
  await io.pick('confirm_plan');
  await waitScreen(page, 'explore');
  const sm = await st(page);
  const termsP = JSON.stringify(sm.terms);
  check('P 判断を決めた時に、兵が少ないときの条件で確定（連れ帰る兵 3 割）', sm.terms?.thin === true && sm.terms.escortMinRatio === 0.3 && sm.terms.basisTroops < 650, termsP);
  u = await talk(page, io, 'ishikawa');
  check('P 石川数正：補充（待つ／回す／今の兵／少し考える）', ['recovery_wait', 'recovery_transfer', 'recovery_none', 'recovery_later'].every((c) => (u.choices ?? []).includes(c)), JSON.stringify(u.choices));
  const cw = await choiceText(page, 'recovery_wait');
  check('P 待つの説明（選ぶ前）：援軍が早く着く代償と、主目標（兵 3 割以上）は変わらない', cw.includes('織田方の援軍が 4 分ほど → 3 分 20 秒ほど') && cw.includes('主目標の条件は軍議で決めたまま変わらない') && cw.includes('兵 3 割以上'), cw.slice(0, 160));
  await shot(page, 'P-ch2-recovery');
  await io.pick('recovery_wait');
  await waitScreen(page, 'explore');
  const s = await st(page);
  check('P 待つ：兵が戻り、1 回だけ（記録が残る）', s.recovery?.choice === 'wait' && s.troops.tadakatsu > s.chapter1.troops.tadakatsu, JSON.stringify(s.troops));
  // 出せる兵（判断 1：守備隊も出す。家康本陣は最低 50、ほかは兵 40 以上の部隊だけ。chapter2/battle.ts の ch2SortieTroops と同じ数え方）
  const sortie = Math.max(50, s.troops.honjin) + ['tadakatsu', 'yumi', 'reserve'].reduce((n, k) => n + (s.troops[k] >= 40 ? s.troops[k] : 0), 0);
  check('P 待って出せる兵が 650 を越えても、主目標の条件は同じ（兵が少ないときの 3 割のまま）', sortie >= 650 && JSON.stringify(s.terms) === termsP, `出せる兵 ${sortie}`);
  u = await talk(page, io, 'gate');
  check('P 城門：確定した主目標（兵 3 割以上）を見せる', u.seen.join(' ').includes('主目標（軍議で確定）') && u.seen.join(' ').includes('兵 3 割以上'), u.seen.join(' / ').slice(0, 160));
  await io.pick('depart');
  await skipCinematic(page, { tap: true, what: '出陣', log: note });
  await page.waitForFunction(() => window.__game.screen === 'battle' && !!window.__battle?.state, null, POLL);
  const bp = await page.evaluate(() => ({ minRatio: window.__battle.state.setup.objectives.primary.minRatio, label: window.__battle.state.setup.objectives.primary.label }));
  check('P 合戦の主目標：連れ帰る兵 3 割以上（待った後の兵で求め直さない）', bp.minRatio === 0.3 && bp.label.includes('兵 3 割以上'), JSON.stringify(bp));
  const dep = await saved(page);
  check('P 出陣前の自動保存に確定した条件', JSON.stringify(dep?.terms) === termsP && dep?.point === 'departure');
  await reloadToTitle(page);
  await io.btn('continue:ieyasu1570');
  await waitScreen(page, 'explore');
  const s3 = await st(page);
  check('P 読み込み直す（出陣前の保存から支度へ）：条件・兵・補充は同じ（二重に足さない）', s3.phase === 'muster' && JSON.stringify(s3.terms) === termsP && JSON.stringify(s3.troops) === JSON.stringify(s.troops) && s3.recovery?.choice === 'wait', JSON.stringify(s3.troops));
  await ctx.close();
}

// ---------------------------------------------------------------- F：架空の章の結末
if (ONLY.includes('F')) {
  const { ctx, page } = await open();
  await page.evaluate(() => window.__game.setPhase('ending', 'tashiro', 'victory'));
  await waitUi(page, 'ending');
  const e = await ui(page);
  check('F 架空の章の結末はボタン 1 つ（タイトルへ）（直接状態変更で結末を出した）', JSON.stringify(e.buttons.map((b) => b.id)) === '["title"]' && !e.text.includes('第二章へ進む'));
  const kf = await page.evaluate(() => document.querySelector('.g-layer[data-kind="ending"] .kicker')?.textContent ?? '');
  check('F 架空の章の結末の見出しは今までどおり「…　結末」', kf.endsWith('　結末'), kf);
  await sleep(500);
  await page.keyboard.press('Enter');
  await waitTitle(page);
  check('F Enter でタイトルへ（今までどおり）', true);
  await ctx.close();
}

check('ページの誤りなし', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? `${failed} 件 NG` : 'ALL OK');
process.exit(failed ? 1 : 0);
