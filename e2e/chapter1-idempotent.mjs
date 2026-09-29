// 戦後の処理（applyBattleOutcome：兵・人物・関係）が二度かからないことを、開発サーバーのブラウザで確かめる。
//   (c) 結果の画面で開き直す → つづきから：出陣前の自動保存（支度・戦前の兵と関係）に戻る
//   (a) 結果の画面の「続ける」を連打（クリック＋Enter）→ 関係・兵は 1 回分だけ変わる
//   (b) 戦後の自動保存の後に開き直す → つづきから：同じ値のまま（もう一度かからない）
// 段階は __game.setPhase で支度（田代）から始め、合戦は __battle.allRetreat と fastForward で撤退させる（状態を直接作る確認）。
//   (PORT=8130 nohup npx vite --config proto3d/blender/tools/vite.nohmr.mjs > /tmp/v8130.log 2>&1 &)
//   BASE3D=http://localhost:8130 node e2e/chapter1-idempotent.mjs
import { launchBrowser } from './lib.mjs';

const BASE = process.env.BASE3D || 'http://localhost:8130';
const POLL = { timeout: 300000, polling: 250 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}`);
};
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.setDefaultTimeout(300000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const st = () => page.evaluate(() => {
  const s = window.__game.state;
  return s && { phase: s.phase, troops: s.troops, relations: s.relations, characters: s.characters, battle: s.battle?.result ?? null, err: window.__game.lastError };
});
const waitTitle = () => page.waitForFunction(() => window.__game?.ui?.kind === 'title', null, POLL);
const loaded = () => page.waitForFunction(() => document.getElementById('loading')?.hidden === true, null, POLL);
async function reloadContinue() {
  await loaded();
  await page.reload();
  await waitTitle();
  await page.evaluate(() => window.__game.choose('continue'));
  await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
}
async function departAndRetreat() {
  await page.evaluate(() => window.__game.talk('gate'));
  await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, POLL);
  for (let i = 0; i < 20; i++) {
    const u = await page.evaluate(() => window.__game.ui);
    if (u?.choices?.includes('depart')) break;
    await page.evaluate(() => window.__game.advance());
    await sleep(100);
  }
  await page.evaluate(() => window.__game.choose('depart'));
  await page.waitForFunction(() => window.__battle?.active && window.__battle.ui.modal === 'briefing' && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
  await page.locator('.b-primary').click();
  await page.waitForFunction(() => window.__battle.ui.started, null, POLL);
  await page.evaluate(() => { window.__battle.allRetreat(); });
  for (let i = 0; i < 200; i++) {
    const r = await page.evaluate(() => window.__battle.fastForward(5).result);
    if (r) break;
  }
  await page.waitForFunction(() => window.__battle.ui.resultShown, null, POLL);
}

await page.goto(BASE + '/?q=low&render=manual');
await waitTitle();
await page.evaluate(() => window.__game.setPhase('muster', 'tashiro'));
await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
const before = await st();

// (c) 結果の画面で開き直す
await departAndRetreat();
const sv1 = await page.evaluate(() => JSON.parse(localStorage.getItem('koto-sengoku/3d-chapter1')));
check('(c) 結果の画面のときの保存は出陣前（departure）', sv1?.point === 'departure', sv1?.point);
await reloadContinue();
const c = await st();
check('(c) 開き直すと支度に戻り、兵・関係・人物は戦前のまま・結果なし', c.phase === 'muster' && c.battle === null && JSON.stringify([c.troops, c.relations, c.characters]) === JSON.stringify([before.troops, before.relations, before.characters]), JSON.stringify(c));

// (a) 続けるの連打
await departAndRetreat();
const btn = page.locator('.b-primary', { hasText: '続ける' });
const box = await btn.boundingBox();
await Promise.all([
  ...Array.from({ length: 6 }, () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {})),
  ...Array.from({ length: 4 }, () => page.keyboard.press('Enter').catch(() => {})),
]);
await page.waitForFunction(() => window.__game.screen === 'explore' && !document.getElementById('battle-ui'), null, POLL);
await sleep(1500);
const a = await st();
const want = { ...before.relations, tashiro: before.relations.tashiro + 5, omori: Math.max(-100, before.relations.omori - 30) };
check('(a) 連打しても戦後の関係は 1 回分（田代 +5・大森 -30）', a.phase === 'aftermath' && a.battle === 'retreat' && JSON.stringify(a.relations) === JSON.stringify(want) && !a.err, JSON.stringify({ rel: a.relations, want, err: a.err }));
const sv2 = await page.evaluate(() => JSON.parse(localStorage.getItem('koto-sengoku/3d-chapter1')));
check('(a) 戦後の自動保存（aftermath）', sv2?.point === 'aftermath');

// (b) 戦後の自動保存の後に開き直す（2 回）
for (const n of [1, 2]) {
  await reloadContinue();
  const b = await st();
  check(`(b) 開き直し ${n} 回目：段階・兵・関係・人物は同じ`, b.phase === 'aftermath' && JSON.stringify([b.troops, b.relations, b.characters]) === JSON.stringify([a.troops, a.relations, a.characters]), JSON.stringify(b));
}
check('ページの誤りなし', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `NG ${failed}` : 'ALL OK');
process.exit(failed ? 1 : 0);
