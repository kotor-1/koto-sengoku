// 会話・選択肢・メニュー・知らせの入力の確認（スマホ横 844×390・タッチ。開発サーバー）。本物のタップ・キー・マウスで確かめる。
//   1. 会話を進めた入力で、直後に出た選択肢が決まらない（素早い二度タップ・マウスの二度押し・押さえたままの Enter の自動の繰り返し・
//      repeat の付かない keydown）。出てしばらくたってから押し直すと決まる。大事な選択（協力陣営）は確認の段がある。
//   2. 会話の途中にメニュー（右上のボタン・Esc）を開いても会話は進まず、閉じると同じ行・同じ選び方のまま。閉じたタップの続けての押しでも進まない。
//   3. 知らせ（探索の .g-toast・合戦の .b-toast）は押せない（pointer-events: none）。知らせの上から始めたスティック・見回し・地図のドラッグが効く。
// 会話を開く・段階を用意するところだけ開発用の __game（talk・setPhase）を使う（状態を直接作る）。進める・選ぶ・閉じるは本物の入力。
//   (PORT=8140 nohup npx vite --config proto3d/blender/tools/vite.nohmr.mjs > /tmp/v8140.log 2>&1 &)
//   BASE3D=http://localhost:8140 node e2e/chapter1-input.mjs [出力先]
import { launchBrowser, outDir } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/chapter1/input');
const BASE = process.env.BASE3D || 'http://localhost:8140';
const POLL = { timeout: 300000, polling: 100 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}`);
};
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.setDefaultTimeout(300000);
const cdp = await ctx.newCDPSession(page);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const ui = () => page.evaluate(() => window.__game.ui);
const waitUi = (kind) => page.waitForFunction((k) => window.__game.ui?.kind === k, kind, POLL);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
const tapAt = async (x, y) => { await touch('touchStart', [[x, y]]); await touch('touchEnd', []); };
const rectOf = (sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2, bottom: r.bottom, right: r.right }; }, sel);
/** 会話の画面の、選択肢にも台詞の枠にも掛からない所（左上寄り）。タップすると 1 行進む */
const EMPTY = [120, 150];

async function openTalk(phase, alliance, id) {
  await page.evaluate(([p, a]) => window.__game.setPhase(p, a), [phase, alliance]);
  await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
  await page.evaluate((i) => window.__game.talk(i), id);
  await waitUi('script');
  await sleep(300);
}
/** 最後の行の 1 つ手前まで、本物のタップで進める */
async function tapToPenultimate() {
  for (let i = 0; i < 30; i++) {
    const u = await ui();
    if (u.index >= u.count - 2) return u;
    await tapAt(...EMPTY);
    await sleep(220);
  }
  return ui();
}

await page.goto(BASE + '/?q=low&render=manual');
await page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, null, POLL);

// ---------------------------------------------------------------- 1. 選択肢の見張り
console.log('--- 1. 会話を進めた入力で、直後の選択肢が決まらない');
{
  // 選択肢の位置を測る（開発用に最後まで進めて測り、閉じる）
  await openTalk('explore', undefined, 'genzo');
  for (let i = 0; i < 10; i++) await page.evaluate(() => window.__game.advance());
  await page.waitForFunction(() => window.__game.ui.choices.length === 2, null, POLL);
  const first = await rectOf('.g-choice[data-id="open_council"]');
  const second = await rectOf('.g-choice[data-id="not_yet"]');
  check('選択肢の位置を測れた', !!first && !!second, JSON.stringify(first));

  // (a) 素早い二度タップ：1 回目で最後の行へ（選択肢が出る）、すぐ 2 回目を選択肢の上へ
  await openTalk('explore', undefined, 'genzo');
  let u = await tapToPenultimate();
  const t0 = Date.now();
  await tapAt(...EMPTY);
  await tapAt(first.cx, first.cy);
  const gap = Date.now() - t0;
  await sleep(150);
  u = await ui();
  check('(a) 素早い二度タップ：最後の行で選択肢が出たまま（決まらない）', u?.kind === 'script' && u.id === 'explore.genzo' && u.index === u.count - 1 && u.choices.length === 2, `間 ${gap} ms・${JSON.stringify({ kind: u?.kind, i: u?.index, sel: u?.selected })}`);
  check('(a) 見張りの間のタップでは選んだ印も動かない', u.selected === 'open_council');
  await sleep(450);
  await tapAt(second.cx, second.cy);
  await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
  const s = await page.evaluate(() => ({ phase: window.__game.state.phase, talked: window.__game.state.talked['explore.genzo'] }));
  check('(a) しばらくしてからのタップで決まる（もう少し町を見る）', s.phase === 'explore' && s.talked === true, JSON.stringify(s));

  // (b) マウスの素早い二度押し（同じ位置）：二度目の源蔵は 1 行で、開いた時から選択肢が出ている
  await page.evaluate(() => window.__game.talk('genzo'));
  await waitUi('script');
  u = await ui();
  check('(b) 二度目の源蔵：1 行で選択肢がすぐ出る', u.id === 'explore.genzo.again' && u.choices.length === 2, u.id);
  // 出たばかりの選択肢をマウスで二度押し
  await page.mouse.dblclick(first.cx, first.cy);
  await sleep(120);
  u = await ui();
  check('(b) 出たばかりの選択肢をマウスで二度押ししても決まらない', u?.kind === 'script' && u.id === 'explore.genzo.again', JSON.stringify({ kind: u?.kind }));

  // (c) Enter を押さえたまま（自動の繰り返し）
  await openTalk('explore', undefined, 'genzo');
  // setPhase で済み印は消える（初めての源蔵）
  u = await ui();
  for (let i = 0; i < 30 && u.index < u.count - 2; i++) { await page.keyboard.press('Enter'); await sleep(200); u = await ui(); }
  await page.keyboard.down('Enter'); // 最後の行へ（選択肢が出る）
  for (let i = 0; i < 12; i++) { await sleep(60); await page.keyboard.down('Enter'); } // 自動の繰り返し（repeat 付き）約 0.7 秒
  u = await ui();
  check('(c) 押さえたままの Enter（自動の繰り返し）では決まらない', u?.kind === 'script' && u.index === u.count - 1 && u.choices.length === 2, JSON.stringify({ kind: u?.kind, i: u?.index }));
  // repeat の付かない keydown（離さないまま）でも決まらない
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', repeat: false, bubbles: true })));
  await sleep(80);
  u = await ui();
  check('(c) 離さないまま来た repeat なしの keydown でも決まらない', u?.kind === 'script', u?.kind);
  await page.keyboard.up('Enter');
  await page.keyboard.press('ArrowDown');
  await sleep(60);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
  const s2 = await page.evaluate(() => window.__game.state.phase);
  check('(c) 離して押し直した Enter で決まる（↓ で選んだ「もう少し町を見る」）', s2 === 'explore');

  // (d) 大事な選択：協力陣営は、内容を見せた確認の段がある（本物のタップで）
  await page.evaluate(() => window.__game.talk('genzo'));
  await waitUi('script');
  await sleep(450);
  await page.locator('.g-choice[data-id="open_council"]').tap();
  await page.waitForFunction(() => window.__game.screen === 'council' && window.__game.ui?.kind === 'script', null, POLL);
  u = await ui();
  for (let i = 0; i < 40 && !(u.choices?.length); i++) { await tapAt(...EMPTY); await sleep(220); u = await ui(); }
  check('(d) 軍議：協力陣営の 3 つが出る', u.choices.join() === 'ally_tashiro,ally_omori,ally_alone', u.choices.join());
  // 4. スマホ横で 3 つの要点が同時に見え、重ならない
  const cmp = await page.evaluate(() => {
    const r = (e) => e.getBoundingClientRect();
    const cs = [...document.querySelectorAll('.g-choice')];
    const head = document.querySelector('.g-council-head');
    const dlg = document.querySelector('.g-dialog');
    const items = cs.map((c) => {
      const s = c.querySelector('.s');
      const d = c.querySelector('.d');
      return { id: c.dataset.id, s: s?.textContent, sShown: !!s && getComputedStyle(s).display !== 'none' && r(s).height > 0, sFits: !!s && s.scrollWidth <= s.clientWidth + 1, dShown: !!d && getComputedStyle(d).display !== 'none', box: r(c) };
    });
    const boxes = items.map((i) => i.box);
    let overlap = false;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (boxes[i].bottom > boxes[j].top + 0.5 && boxes[j].bottom > boxes[i].top + 0.5) overlap = true;
    const top = Math.min(...boxes.map((b) => b.top));
    const bottom = Math.max(...boxes.map((b) => b.bottom));
    const left = Math.min(...boxes.map((b) => b.left));
    const hb = r(head);
    const headHit = hb.bottom > top && hb.right > left;
    return { items: items.map(({ box, ...x }) => x), overlap, dialogHit: bottom > r(dlg).top, headHit, inView: top >= 0 && bottom <= innerHeight, top, bottom, dlgTop: r(dlg).top, headBottom: hb.bottom };
  });
  check('4. スマホ横の軍議：3 つとも 1 行の要点が見える（途中で切れない）', cmp.items.every((i) => i.sShown && i.sFits && !i.dShown), JSON.stringify(cmp.items.map((i) => i.s)));
  check('4. 選択肢どうし・台詞の枠・見出しと重ならず、画面の中', !cmp.overlap && !cmp.dialogHit && !cmp.headHit && cmp.inView, JSON.stringify({ top: cmp.top, bottom: cmp.bottom, dlgTop: cmp.dlgTop, headBottom: cmp.headBottom }));
  await page.screenshot({ path: `${OUT}/council-choices-844x390.png` });
  await sleep(450);
  await page.locator('.g-choice[data-id="ally_omori"]').tap();
  await page.waitForFunction(() => window.__game.ui?.kind === 'script' && window.__game.ui.id === 'council.confirm.omori', null, POLL);
  const confirmLine = (await ui()).line.text;
  u = await ui();
  for (let i = 0; i < 20 && !(u.choices?.length); i++) { await tapAt(...EMPTY); await sleep(220); u = await ui(); }
  const stillCouncil = await page.evaluate(() => window.__game.state.phase);
  check('(d) 選んだだけでは決まらない：内容（台詞）を見せて「それで決める／考え直す」', stillCouncil === 'council' && u.choices.join() === 'confirm_alliance,reconsider' && confirmLine.includes('大森'), confirmLine);
  await sleep(450);
  await page.locator('.g-choice[data-id="reconsider"]').tap();
  await page.waitForFunction(() => window.__game.ui?.id === 'council.again', null, POLL);
  check('(d) 考え直すと選び直せる（まだ決まっていない）', (await page.evaluate(() => window.__game.state.alliance)) === null);
}

// ---------------------------------------------------------------- 2. 会話の途中のメニュー
console.log('--- 2. 会話の途中のメニュー');
{
  await openTalk('muster', 'tashiro', 'genzo');
  await tapAt(...EMPTY);
  await sleep(250);
  let u = await ui();
  const at = { index: u.index, text: u.line.text };
  check('会話を 1 行進めた（2 行目）', u.index === 1, String(u.index));
  const mb = await rectOf('.g-menu-btn');
  const hitMenu = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.classList.contains('g-menu-btn'), [mb.cx, mb.cy]);
  check('会話の上でも「メニュー」のボタンが一番上（押せる）', hitMenu);
  await tapAt(mb.cx, mb.cy);
  await waitUi('menu');
  u = await ui();
  check('「メニュー」をタップ：メニューが開き、会話は進まない', u.kind === 'menu' && (await page.evaluate(() => window.__game.screen)) === 'menu');
  await page.screenshot({ path: `${OUT}/menu-over-talk.png` });
  // 「閉じる」をタップして、すぐ（見張りの中）に台詞の所をもう一度タップ
  const close = await rectOf('.g-btn[data-id="close"]');
  await sleep(450);
  await tapAt(close.cx, close.cy);
  await tapAt(...EMPTY);
  await sleep(200);
  u = await ui();
  check('閉じると同じ会話の同じ行（閉じたタップ・続けてのタップで進まない）', u.kind === 'script' && u.index === at.index && u.line.text === at.text, JSON.stringify({ kind: u.kind, i: u.index }));
  // Esc でも開いて閉じる
  await sleep(400);
  await page.keyboard.press('Escape');
  await waitUi('menu');
  await sleep(400);
  await page.keyboard.press('Escape');
  await waitUi('script');
  await sleep(100);
  u = await ui();
  check('Esc で開いて Esc で閉じても同じ行', u.index === at.index, String(u.index));
  // 選択肢が出ている時（城門の出陣の確認）：↑ で選び方を変えてからメニューを開き、閉じても同じ選び方
  for (let i = 0; i < 20; i++) { const x = await ui(); if (x?.kind !== 'script') break; await page.evaluate(() => window.__game.advance()); await sleep(60); }
  await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
  await page.evaluate(() => window.__game.talk('gate'));
  await waitUi('script');
  u = await ui();
  for (let i = 0; i < 20 && !(u.choices?.length); i++) { await sleep(250); await tapAt(...EMPTY); await sleep(100); u = await ui(); }
  const before = u.selected;
  await sleep(400);
  await page.keyboard.press('ArrowUp');
  await sleep(80);
  u = await ui();
  const changed = u.selected;
  await tapAt(mb.cx, mb.cy);
  await waitUi('menu');
  await sleep(400);
  const close2 = await rectOf('.g-btn[data-id="close"]');
  await tapAt(close2.cx, close2.cy);
  await waitUi('script');
  u = await ui();
  check('選択肢が出ている時：メニューを開いて閉じても、同じ選択肢・同じ選び方（決まらない）', u.kind === 'script' && u.choices.length > 0 && u.selected === changed && changed !== before, JSON.stringify({ before, changed, after: u.selected, id: u.id }));
  // 出陣の確認（大事な選択）：最初は「まだ支度をする」
  if (u.id === 'muster.gate') check('出陣の確認：最初に選ばれているのは「まだ支度をする」', before === 'stay', before);
  await sleep(450);
  await page.keyboard.press('Escape');
  await waitUi('menu');
  await sleep(400);
  await page.keyboard.press('Escape');
  await waitUi('script');
  await page.evaluate(() => window.__game.choose('stay'));
  await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
}

// ---------------------------------------------------------------- 3. 知らせは押せない
console.log('--- 3. 知らせは入力を奪わない');
{
  await page.evaluate(() => window.__game.setPhase('muster', 'alone'));
  await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
  await sleep(4600); // 段階の案内が消えるまで
  await page.evaluate(() => window.__game.view.toast('知らせの確認：これは押せない（下のスティック・見回しが効く）'.repeat(2), 'info'));
  await sleep(100);
  const tr = await rectOf('.g-toast');
  const probe = await page.evaluate(([x, y]) => {
    const t = document.querySelector('.g-toast');
    const e = document.elementFromPoint(x, y);
    return { pe: getComputedStyle(t).pointerEvents, hit: e?.id || e?.className || e?.tagName };
  }, [Math.max(tr.x + 10, 40), tr.cy]);
  const stick = await rectOf('#stick-zone');
  check('探索の知らせ：pointer-events: none、知らせの所を押すと下の部品に届く', probe.pe === 'none' && !String(probe.hit).includes('g-toast'), JSON.stringify(probe));
  check('知らせはスティックの範囲と重なる所がある（確かめる意味がある）', tr.x < stick.right && tr.bottom > stick.y, JSON.stringify({ toast: tr, stick }));
  // 知らせの上（左半分＝スティックの範囲）から指を置いて動かすと、主人公が歩く
  const sx = Math.max(tr.x + 12, 30);
  const sy = Math.max(tr.cy, stick.y + 4);
  const p0 = await page.evaluate(() => ({ x: window.__p3.hero.x, z: window.__p3.hero.z }));
  await touch('touchStart', [[sx, sy]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[sx, sy + i * 8]]); await sleep(60); }
  await sleep(700);
  await touch('touchEnd', []);
  await sleep(300);
  const p1 = await page.evaluate(() => ({ x: window.__p3.hero.x, z: window.__p3.hero.z }));
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check('知らせの上から始めたスティックで主人公が歩く', moved > 0.3, `${moved.toFixed(2)} m`);
  // 右半分（見回し）：知らせの右端の上から横になぞると見回せる
  await page.evaluate(() => window.__game.view.toast('知らせの確認：見回し'.repeat(4), 'info'));
  await sleep(100);
  const tr2 = await rectOf('.g-toast');
  const lx = Math.min(tr2.right - 12, 800);
  if (lx > 844 / 2 + 5) {
    const y0 = await page.evaluate(() => window.__p3.orbit.yaw);
    await touch('touchStart', [[lx, tr2.cy]]);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [[lx - i * 15, tr2.cy]]); await sleep(40); }
    await touch('touchEnd', []);
    await sleep(200);
    const y1 = await page.evaluate(() => window.__p3.orbit.yaw);
    check('知らせの上から始めた見回しが効く', Math.abs(y1 - y0) > 0.1, `${y0.toFixed(2)} → ${y1.toFixed(2)}`);
  } else check('知らせの右端が見回しの範囲に届く', false, JSON.stringify(tr2));

  // 合戦の知らせ
  await page.evaluate(() => window.__game.talk('gate'));
  await waitUi('script');
  for (let i = 0; i < 10; i++) { const x = await ui(); if (x.choices?.length) break; await page.evaluate(() => window.__game.advance()); }
  await page.evaluate(() => window.__game.choose('depart'));
  await page.waitForFunction(() => window.__battle?.active && window.__battle.ui.modal === 'briefing' && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
  await sleep(450);
  await page.locator('.b-primary').tap();
  await page.waitForFunction(() => window.__battle.ui.started && document.querySelector('.b-toast'), null, POLL);
  await sleep(300);
  const bt = await rectOf('.b-toast');
  const bprobe = await page.evaluate(([x, y]) => {
    const t = document.querySelector('.b-toast');
    const e = document.elementFromPoint(x, y);
    return { pe: getComputedStyle(t).pointerEvents, map: !!e?.classList.contains('b-input'), hit: e?.className };
  }, [bt.cx, bt.cy]);
  check('合戦の知らせ：pointer-events: none、知らせの所は地図（.b-input）に届く', bprobe.pe === 'none' && bprobe.map, JSON.stringify(bprobe));
  const c0 = await page.evaluate(() => ({ x: window.__battle.camera.tx, z: window.__battle.camera.tz }));
  await touch('touchStart', [[bt.cx, bt.cy]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[bt.cx - i * 12, bt.cy + i * 10]]); await sleep(40); }
  await touch('touchEnd', []);
  await sleep(300);
  const c1 = await page.evaluate(() => ({ x: window.__battle.camera.tx, z: window.__battle.camera.tz }));
  check('合戦の知らせの上から始めたドラッグで地図が動く', Math.hypot(c1.x - c0.x, c1.z - c0.z) > 5, JSON.stringify({ c0, c1 }));
  await page.screenshot({ path: `${OUT}/battle-toast.png` });
}

check('ページの誤りなし', errors.length === 0, errors.join(' | ').slice(0, 400));
await browser.close();
console.log(failed ? `NG ${failed}` : 'ALL OK');
process.exit(failed ? 1 : 0);
