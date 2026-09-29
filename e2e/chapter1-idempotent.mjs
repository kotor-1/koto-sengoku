// 戦後の処理（applyBattleOutcome：兵・人物・関係）が二度かからないこと、結果の画面の時点で結果が保存されていることを、開発サーバーのブラウザで確かめる。
//   (c) 勝ち負けが決まった時（結果の画面の前）に戦後の自動保存（読み戻して確かめた）。結果の画面にも「保存しました」を出す。
//       結果の画面で開き直す → つづきから：戦後から（合戦をやり直さない・関係は 1 回分）。2 回開き直しても同じ
//   (a) 結果の画面の「続ける」を連打（クリック＋Enter）→ 関係・兵は 1 回分だけ変わる。戦後の保存は 1 回だけ書く
//   (b) 戦後の自動保存の後に開き直す → つづきから：同じ値のまま（もう一度かからない）
//   (d) 結果の保存に失敗（容量不足）→ 結果の画面に失敗の理由（保存しましたとは言わない）。続けると戦後（手元の状態）。
//       開き直すと出陣前の保存から（二重にはかからない）
// 段階は __game.setPhase で支度（田代）から始め、合戦は __battle.allRetreat と fastForward で撤退させる（状態を直接作る確認）。
//   (PORT=8140 nohup npx vite --config proto3d/blender/tools/vite.nohmr.mjs > /tmp/v8140.log 2>&1 &)
//   BASE3D=http://localhost:8140 node e2e/chapter1-idempotent.mjs
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
  await page.evaluate(() => window.__game.choose('continue:fictional'));
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
await page.evaluate(() => localStorage.setItem('koto-sengoku/save', '{"2d":"keep"}'));
await page.evaluate(() => window.__game.setPhase('muster', 'tashiro'));
await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
const before = await st();
const want = { ...before.relations, tashiro: before.relations.tashiro + 5, omori: Math.max(-100, before.relations.omori - 30) };
const saveOf = () => page.evaluate(() => JSON.parse(localStorage.getItem('koto-sengoku/3d-chapter1')));

// (c) 結果の画面で開き直す
await departAndRetreat();
const decidedEarly = await page.evaluate(() => window.__battle.ui.decided);
const sv1 = await saveOf();
check('(c) 結果の画面の時点で、戦後の自動保存（aftermath・撤退・関係は 1 回分・反映の済み印）', sv1?.version === 2 && sv1?.point === 'aftermath' && sv1?.phase === 'aftermath' && sv1?.battle?.result === 'retreat' && JSON.stringify(sv1?.relations) === JSON.stringify(want) && sv1?.appliedBattleId === sv1?.battleId && /^ch1-/.test(sv1?.battleId ?? ''), JSON.stringify({ point: sv1?.point, rel: sv1?.relations, id: sv1?.battleId, ap: sv1?.appliedBattleId }));
const panelSave = await page.locator('.b-rsave').textContent().catch(() => null);
check('(c) 結果の画面に「保存しました（読み戻して確かめた）」を出す', decidedEarly?.ok === true && (await page.locator('.b-rsave.ok').count()) === 1 && panelSave.includes('保存しました') && panelSave.includes('確かめ'), panelSave);
await page.screenshot({ path: 'e2e-out/chapter1/idempotent-result-saved.png' }).catch(() => {});
for (const n of [1, 2]) {
  await reloadContinue();
  const c = await st();
  check(`(c) 結果の画面で開き直し ${n} 回目：戦後から（合戦をやり直さない）・関係は 1 回分`, c.phase === 'aftermath' && c.battle === 'retreat' && JSON.stringify(c.relations) === JSON.stringify(want) && !(await page.evaluate(() => !!window.__battle?.active)), JSON.stringify(c));
}

// (a) 続けるの連打
await page.evaluate(() => window.__game.setPhase('muster', 'tashiro'));
await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
await departAndRetreat();
const writesBefore = await page.evaluate(() => (window.__saveWrites = 0));
await page.evaluate(() => {
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === 'koto-sengoku/3d-chapter1') window.__saveWrites++;
    return orig.call(this, k, v);
  };
});
const btn = page.locator('.b-primary', { hasText: '続ける' });
const box = await btn.boundingBox();
await Promise.all([
  ...Array.from({ length: 6 }, () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => {})),
  ...Array.from({ length: 4 }, () => page.keyboard.press('Enter').catch(() => {})),
]);
await page.waitForFunction(() => window.__game.screen === 'explore' && !document.getElementById('battle-ui'), null, POLL);
await sleep(1500);
const a = await st();
check('(a) 連打しても戦後の関係は 1 回分（田代 +5・大森 -30）', a.phase === 'aftermath' && a.battle === 'retreat' && JSON.stringify(a.relations) === JSON.stringify(want) && !a.err, JSON.stringify({ rel: a.relations, want, err: a.err }));
const sv2 = await saveOf();
const writes = await page.evaluate(() => window.__saveWrites);
check('(a) 戦後の自動保存（aftermath）。「続ける」の後に書き直さない', sv2?.point === 'aftermath' && writes === 0 && writesBefore === 0, `続けるの後の書き込み ${writes} 回`);

// (b) 戦後の自動保存の後に開き直す（2 回）
for (const n of [1, 2]) {
  await reloadContinue();
  const b = await st();
  check(`(b) 開き直し ${n} 回目：段階・兵・関係・人物は同じ`, b.phase === 'aftermath' && JSON.stringify([b.troops, b.relations, b.characters]) === JSON.stringify([a.troops, a.relations, a.characters]), JSON.stringify(b));
}

// (d) 結果の保存に失敗
await page.evaluate(() => window.__game.setPhase('muster', 'tashiro'));
await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
await page.evaluate(() => {
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === 'koto-sengoku/3d-chapter1' && String(v).includes('"point":"aftermath"')) throw new DOMException('full', 'QuotaExceededError');
    return orig.call(this, k, v);
  };
});
await departAndRetreat();
const ng = await page.locator('.b-rsave').textContent().catch(() => '');
check('(d) 保存に失敗：結果の画面に失敗の理由を出し、保存しましたとは言わない', (await page.locator('.b-rsave.ng').count()) === 1 && ng.includes('保存できませんでした') && ng.includes('いっぱい') && !ng.includes('保存しました'), ng);
const sv3 = await saveOf();
check('(d) 保存に残っているのは出陣前', sv3?.point === 'departure', sv3?.point);
await page.locator('.b-primary', { hasText: '続ける' }).click();
await page.waitForFunction(() => window.__game.screen === 'explore' && !document.getElementById('battle-ui'), null, POLL);
const d = await st();
const toast = await page.locator('.g-toast').textContent();
check('(d) 続けて遊べる（手元は戦後・関係は 1 回分）。知らせも失敗として出す', d.phase === 'aftermath' && JSON.stringify(d.relations) === JSON.stringify(want) && toast.includes('保存できませんでした'), JSON.stringify({ phase: d.phase, toast }));
await reloadContinue();
const d2 = await st();
check('(d) 開き直すと出陣前の保存から（支度・戦前の関係。二重にはかからない）', d2.phase === 'muster' && d2.battle === null && JSON.stringify(d2.relations) === JSON.stringify(before.relations), JSON.stringify(d2));
check('2D 版の保存は変わらない', (await page.evaluate(() => localStorage.getItem('koto-sengoku/save'))) === '{"2d":"keep"}');
check('ページの誤りなし', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(failed ? `NG ${failed}` : 'ALL OK');
process.exit(failed ? 1 : 0);
