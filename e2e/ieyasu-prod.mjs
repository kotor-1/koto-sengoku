// 歴史分岐「元亀元年・家康」を「本番ビルド」で、公開先に近い決まり（CSP）の下で、タイトルから結末まで遊べるかを確かめる。
// 開発用のフック（__game・__battle・__p3）は使わない（本番のビルドには無い）。早送りもしない（合戦は ×2 の実時間）。
// 入力はすべて本物のキー・クリック。位置は、ゲームのメニューの「保存する」で書かれた保存データ（localStorage）から読む。
//
// 準備（公開と同じ作り）：
//   VITE_MODEL_EXT=.json npm run proto3d:build
//   rm dist-proto3d/models/*.glb
//   node proto3d/tools/glb-to-gltf.mjs proto3d/public/models dist-proto3d/models ground_v2 gate_v2 walls_v2 keep inner machiya_a machiya_b machiya_d tree_pine tree_sakura tree_pine_far hero_v3_mpfb hero_v2
// 使い方：node e2e/ieyasu-prod.mjs [出力先]   （DIST=dist-proto3d PORT=8132 VIEW=960x540 で変えられる）
// この中で、次のヘッダー付きの簡易サーバーを立てる：
//   content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'
// 経路：タイトル（歴史分岐のはじめから）→ 本多忠勝と話す → 軍議で C（自領の防衛）→ 支度で忠勝の約束を引き受ける（メニューから保存）
//       → 城門で出陣 → 合戦（指揮・家康本陣の「立て直しの号令」を「能力」ボタンで・×2・すぐに全軍撤退）→ 結果（撤退・約束は「敵と斬り合う前に退いた」ので
//       守れなかった。勝敗と約束を別々に）→ 戦後（自動保存）
//       → 開き直して続きから → 忠勝と話して結末 → タイトル。CSP の違反・ページの誤り・読めなかったファイル・data: の URL が無いこと。
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { launchBrowser, outDir, skipCinematic } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/ieyasu/prod');
const DIST = resolve(process.env.DIST || 'dist-proto3d');
const PORT = Number(process.env.PORT || 8132);
const [VW, VH] = (process.env.VIEW || '960x540').split('x').map(Number);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };

if (!existsSync(join(DIST, 'index.html'))) throw new Error(`${DIST}/index.html が無い（先に本番ビルド）`);
const served = [];
const missing = [];
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(DIST, path === '/' ? 'index.html' : path));
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
    missing.push(path);
    res.writeHead(404, { 'content-security-policy': CSP });
    res.end('not found');
    return;
  }
  served.push(path);
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'content-security-policy': CSP, 'cache-control': 'no-store' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));
const URL0 = `http://localhost:${PORT}/?q=low`;

let failed = 0;
const T0 = Date.now();
const secs = () => `${((Date.now() - T0) / 1000).toFixed(0)}s`;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}  [${secs()}]`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = { timeout: 600000, polling: 500 };

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
// CSP の違反を数える（ページの外から。ゲームの中身は変えない）
await ctx.addInitScript(() => {
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const page = await ctx.newPage();
page.setDefaultTimeout(600000);
const errors = [];
const dataUrls = [];
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console ${m.text()}`); });
page.on('request', (r) => { if (r.url().startsWith('data:')) dataUrls.push(r.url().slice(0, 40)); });
const shot = (name) => {
  console.log(`   撮影 ${name}  [${secs()}]`);
  return page.screenshot({ path: `${OUT}/${name}.png`, timeout: 600000 });
};
const layer = (kind) => page.locator(`.g-layer[data-kind="${kind}"]`);
const waitLayer = (kind) => layer(kind).waitFor({ state: 'visible', timeout: 600000 });
const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('koto-sengoku/3d-ieyasu1570') || 'null'));

/** 会話を、選択肢が出るか閉じるまでクリックで進める */
async function readThrough() {
  for (let i = 0; i < 40; i++) {
    if (!(await layer('script').isVisible())) return;
    if (await page.locator('.g-choices:not([hidden]) .g-choice').first().isVisible().catch(() => false)) return;
    await page.mouse.click(VW / 2, VH * 0.3);
    await sleep(300);
  }
}
async function choose(id) {
  await page.locator(`.g-choice[data-id="${id}"]`).waitFor({ state: 'visible' });
  await sleep(500);
  await page.locator(`.g-choice[data-id="${id}"]`).click();
}
async function pressBtn(id) {
  await page.locator(`.g-btn[data-id="${id}"]`).waitFor({ state: 'visible' });
  await sleep(500);
  await page.locator(`.g-btn[data-id="${id}"]`).click();
}
/** キーを押したまま、cond が真になるまで待つ（ソフトウェア描画ではコマが遅いので、長く押す） */
async function holdUntil(keys, cond, maxMs) {
  for (const k of keys) await page.keyboard.down(k);
  const t = Date.now();
  let ok = false;
  while (Date.now() - t < maxMs) {
    if (await cond()) { ok = true; break; }
    await sleep(400);
  }
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
  return ok;
}
const talkShown = (id) => page.evaluate((id) => { const b = document.querySelector('.g-talk'); return !!b && !b.hidden && b.dataset.target === id; }, id);
/** メニューから保存して、保存された位置を読む（位置を知る手段。遊ぶ人の操作と同じ） */
async function saveAndReadPose() {
  await page.keyboard.press('Escape');
  await waitLayer('menu');
  await pressBtn('save');
  await page.locator('.g-layer[data-kind="menu"] .g-msg').waitFor({ state: 'visible' });
  const msg = await page.locator('.g-layer[data-kind="menu"] .g-msg').textContent();
  await pressBtn('close');
  await layer('menu').waitFor({ state: 'detached' });
  const s = await save();
  return { msg, pose: s?.explore ?? null, save: s };
}

try {
  const t0 = Date.now();
  await page.goto(URL0);
  await page.locator('.g-btn[data-id="new:ieyasu1570"]').waitFor({ state: 'visible', timeout: 600000 });
  check(`本番ビルドを CSP の下で読み込み、タイトルが出る（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`, true, await page.textContent('#build'));
  check('本番ビルドの表示（開発用の比較ボタンは無い・開発用のフックは無い）', (await page.textContent('#build')).includes('本番') && !(await page.isVisible('#hero-btn')) && (await page.evaluate(() => !window.__game && !window.__battle && !window.__p3)));
  const models = served.filter((p) => p.startsWith('/models/'));
  check('素材は JSON（glTF）と画像で読む（.glb も data: の URL も使わない）', models.length > 0 && models.every((p) => /\.(json|jpg|png)$/.test(p)) && dataUrls.length === 0, `${models.filter((p) => p.endsWith('.json')).length} 個の JSON`);
  const title = await page.textContent('.g-layer[data-kind="title"]');
  check('タイトル：歴史分岐と架空の第一章が並び、創作の注記がある', title.includes('歴史分岐：元亀元年・家康') && title.includes('架空：国境の砦') && title.includes('ゲーム用の創作'));
  check('ページの題（タブ）にシナリオの名前・「仮シナリオ」を付けない（タイトルではシナリオが決まっていない）', (await page.title()) === '戦国探索記 3D', await page.title());
  await shot('I01-title');
  await pressBtn('new:ieyasu1570');
  // 第一章の冒頭の演出（はじめからの道だけ。3D の場面だけ）：スキップのボタンを本物のクリックで押す（層の属性だけで待つ）
  await skipCinematic(page, { what: '第一章の冒頭' });
  await page.locator('.g-hud').waitFor({ state: 'visible' });
  check('歴史分岐のはじめから → 城下（目的：忠勝と話す）', (await page.textContent('.g-hud')).includes('忠勝') && (await page.textContent('.g-hud')).includes('歴史分岐'), await page.textContent('.g-hud'));
  check('ページの題：元亀元年・家康（仮シナリオとは出さない）', (await page.title()).includes('元亀元年・家康') && !(await page.title()).includes('仮シナリオ'), await page.title());
  await sleep(1500);
  await shot('I02-explore');
  let ok = await holdUntil(['Shift', 'KeyW'], () => talkShown('tadakatsu'), 420000);
  check('W と Shift で歩くと本多忠勝の「話す」が出る', ok);
  await page.keyboard.press('KeyE');
  await waitLayer('script');
  await readThrough();
  await choose('open_council');
  await page.locator('.g-layer.council').waitFor({ state: 'visible' });
  await readThrough();
  const cText = await page.textContent('.g-layer.council');
  check('軍議：3 つの方針（織田・浅井・自領）', cText.includes('織田') && cText.includes('浅井') && cText.includes('自領'));
  await shot('I03-council');
  await choose('policy_home');
  await sleep(600);
  await readThrough();
  await choose('confirm_policy');
  await page.locator('.g-layer[data-kind="script"]').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('.g-hud')?.textContent.includes('約束'), null, W);
  check('軍議で C（自領の防衛）に決める → 出陣の支度（目的：約束）', true);
  // 忠勝は町の入口（探索の始め）から真っすぐ北。軍議の後も忠勝の前にいる。すぐ前にいなければ W で近づく
  if (!(await talkShown('tadakatsu'))) ok = await holdUntil(['KeyW'], () => talkShown('tadakatsu'), 200000);
  await page.keyboard.press('KeyE');
  await waitLayer('script');
  await readThrough();
  const pledgeText = await page.textContent('.g-choices');
  check('忠勝の約束：対象（岡崎の守備隊）と、引き受けないのは約束違反ではない', pledgeText.includes('岡崎の守備隊') && pledgeText.includes('約束違反にはならない'), pledgeText.slice(0, 80));
  await shot('I04-pledge');
  await choose('pledge_accept');
  await page.locator('.g-layer[data-kind="script"]').waitFor({ state: 'detached' });
  let r = await saveAndReadPose();
  check('支度：メニューから保存（読み戻して確かめた）・方針 C・約束を引き受けた', r.msg.includes('読み戻して確かめました') && r.save?.scenario === 'ieyasu1570' && r.save.phase === 'muster' && r.save.policy === 'home' && r.save.pledge?.accepted === true, r.msg);
  check('架空の第一章の保存・2D 版の保存には触れない', await page.evaluate(() => localStorage.getItem('koto-sengoku/3d-chapter1') === null && localStorage.getItem('koto-sengoku/save') === null));
  // 見回しの向きは決め打ちにせず、S を短く押して下がった向きから測る（Version 21：探索の始めは町の入口で、見回しは真後ろ＝ yaw 0）
  const my = await measureYaw(page, async () => (await saveAndReadPose()).pose);
  const yaw = my?.yaw ?? 0;
  if (my) r = { ...r, pose: my.pose };
  console.log(`   見回しの向き（測った）yaw ${yaw.toFixed(2)}`);
  const gate = { x: 0, z: -10.9 };
  for (let leg = 0; leg < 6 && !(await layer('script').isVisible()); leg++) {
    const p = r.pose;
    const d = Math.hypot(gate.x - p.x, gate.z - p.z);
    const keys = keysToward(yaw, p, gate.x, gate.z);
    console.log(`   城門へ ${leg + 1}：(${p.x.toFixed(2)}, ${p.z.toFixed(2)}) から ${d.toFixed(1)} m、キー ${keys.join('+')}`);
    ok = await holdUntil(keys, () => layer('script').isVisible(), Math.min(200000, 9000 + d * 25000));
    if (ok) break;
    r = await saveAndReadPose();
  }
  await waitLayer('script');
  await readThrough();
  const gateText = await page.textContent('.g-layer[data-kind="script"]');
  await shot('I05-gate');
  await choose('depart');
  await skipCinematic(page, { what: '出陣' });
  await page.locator('.b-primary:not(.off)', { hasText: '合戦を始める' }).waitFor({ state: 'visible', timeout: 600000 });
  const dep = await save();
  check('出陣前の自動保存（段階 battle・約束を引き受けた）→ 合戦の説明', dep?.point === 'departure' && dep?.phase === 'battle' && dep.pledge?.accepted === true, gateText.slice(0, 60));
  const brief = await page.textContent('.b-modal');
  check('合戦の説明：「1570年の情勢を背景にした架空の局地戦」・約束の対象（岡崎の守備隊）・浪人衆', brief.includes('1570年の情勢を背景にした架空の局地戦') && brief.includes('岡崎の守備隊') && brief.includes('浪人衆') && !brief.includes('織田方'));
  // （プレイテストの指摘）説明が長くても「合戦を始める」は送らずに見えて押せる（枠の下に貼りつく）
  const startBox = await page.locator('.b-primary', { hasText: '合戦を始める' }).boundingBox();
  const startHit = await page.evaluate(() => {
    const b = document.querySelector('.b-brief .b-primary').getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return !!hit && !!hit.closest('.b-primary');
  });
  check('合戦の説明：「合戦を始める」が送らずに画面の中に見えて押せる', !!startBox && startBox.y >= 0 && startBox.y + startBox.height <= VH && startHit, JSON.stringify(startBox));
  await shot('I06-briefing');
  await page.locator('.b-primary', { hasText: '合戦を始める' }).click();
  await sleep(1500);
  await page.locator('.b-pause').click();
  await sleep(800);
  const pl0 = await page.locator('.b-pledge').textContent();
  check('指揮（一時停止）の印が出る・約束の行が出る（敵と斬り合う前は「今退くと守れない」）', (await page.locator('.b-pausepill').isVisible()) && (await page.locator('.b-pledge').isVisible()) && pl0.includes('今退くと守れない'), pl0);
  await page.locator('.b-card', { hasText: '家康本陣' }).click();
  await sleep(800);
  const abil0 = await page.textContent('.b-abil');
  check('家康本陣を選ぶ → 能力の欄（立て直しの号令・使える・対象・効果・代償）', ['立て直しの号令', '使える', '対象', '効果', '代償'].every((w) => abil0.includes(w)), abil0.slice(0, 60));
  await page.locator('.b-abil-btn').click();
  await sleep(1200);
  const abil1 = await page.textContent('.b-abil');
  check('「能力」ボタンで号令（指揮の間は残りが減らない：残り 35 秒）', abil1.includes('効果中') && abil1.includes('残り 35 秒'), abil1.slice(0, 60));
  await page.locator('.b-abil-btn').click();
  await sleep(600);
  check('もう一度押しても重ねて発動しない（理由が出る）', (await page.textContent('.b-hint')).includes('いま効果中'));
  await shot('I07-battle-rally');
  await page.locator('.b-pause').click();
  await page.locator('.b-seg', { hasText: '×2' }).click();
  await sleep(4000);
  await page.locator('.b-allret').click();
  await page.locator('.b-confirm').waitFor({ state: 'visible' });
  await sleep(500);
  await page.locator('.b-confirm .b-btn', { hasText: '撤退する' }).click();
  await page.locator('.b-result').waitFor({ state: 'visible', timeout: 1200000 });
  await sleep(1000);
  await shot('I08-result');
  const res = await page.textContent('.b-result');
  // （プレイテストの指摘）始まってすぐの全軍撤退では、守備隊が無事でも約束は守ったことにならない
  check('すぐに全軍撤退 → 結果の画面「撤退」と、勝敗とは別に「約束を守れなかった（敵と斬り合う前に退いた）」・使った能力', (await page.textContent('.b-result h2')).includes('撤退') && res.includes('約束を守れなかった') && res.includes('敵と斬り合う前に退いた') && res.includes('勝敗とは別') && res.includes('立て直しの号令'), res.slice(0, 160));
  const decided = await save();
  check('結果の画面の時点で戦後の自動保存（撤退・約束の結果）', decided?.point === 'aftermath' && decided.battle?.result === 'retreat' && decided.pledge?.result === 'broken' && decided.appliedBattleId === decided.battleId, JSON.stringify({ p: decided?.point, r: decided?.battle?.result, pl: decided?.pledge?.result }));
  await page.locator('.b-primary', { hasText: '続ける' }).click();
  await skipCinematic(page, { what: '帰還' });
  await page.waitForFunction(() => !document.body.classList.contains('mode-battle') && !document.getElementById('battle-ui') && document.querySelector('.g-hud') && !document.querySelector('.g-hud').hidden, null, W);
  const aft = await save();
  const kept = aft?.pledge?.result === 'kept';
  check('合戦の後 → 戦後の探索（撤退・約束を守れなかった・信頼：忠勝 −25 → 15・織田 −10・浅井 そのまま・援兵なし）', aft?.phase === 'aftermath' && aft.battle.result === 'retreat' && !kept && aft.trust.tadakatsu === 15 && aft.trust.oda === 20 && aft.trust.asai === 10 && aft.support?.reinforcement === kept, JSON.stringify({ trust: aft?.trust, pledge: aft?.pledge?.result, support: aft?.support }));
  // 開き直して続きから
  await page.reload();
  await page.locator('.g-btn[data-id="continue:ieyasu1570"]').waitFor({ state: 'visible', timeout: 600000 });
  check('開き直すと、歴史分岐のつづきからに戦後の保存', (await page.textContent('.g-btn[data-id="continue:ieyasu1570"]')).includes('戦の後'));
  await pressBtn('continue:ieyasu1570');
  await page.locator('.g-hud').waitFor({ state: 'visible' });
  const again = await save();
  check('つづきから：勝敗・約束・信頼・兵は同じ（二重に反映しない）', JSON.stringify(again.trust) === JSON.stringify(aft.trust) && JSON.stringify(again.troops) === JSON.stringify(aft.troops) && again.pledge.result === aft.pledge.result && again.appliedBattleId === aft.battleId);
  await sleep(1500);
  await shot('I09-aftermath');
  ok = await holdUntil(['Shift', 'KeyW'], () => talkShown('tadakatsu'), 420000);
  check('戦後：探索の始めの位置から W と Shift で北へ歩くと忠勝の「話す」', ok);
  await page.keyboard.press('KeyE');
  await waitLayer('script');
  await readThrough();
  await choose('end_chapter');
  await waitLayer('ending');
  const ending = await page.textContent('.g-ending');
  await shot('I10-ending');
  check('結末：方針（自領の防衛）・撤退・約束・信頼・史実と創作', ending.includes('自領の防衛') && ending.includes('撤退') && ending.includes('約束') && ending.includes('信頼') && ending.includes('史実と創作'));
  check('結末：守備隊は無事でも「刃を交える前に兵を引いた」ので約束は果たせなかった、と書く', ending.includes('敵と刃を交える前に兵を引いたため') && ending.includes('守れなかった'));
  check('結末に「姉川の戦いの再現」とは書かない', !ending.includes('姉川の戦いを再現'));
  await page.locator('.g-btn[data-id="title"]').scrollIntoViewIfNeeded();
  await pressBtn('title');
  await page.locator('.g-btn[data-id="continue:ieyasu1570"]').waitFor({ state: 'visible' });
  check('タイトルへ戻る。つづきからは章の結末', (await page.textContent('.g-btn[data-id="continue:ieyasu1570"]')).includes('章の結末'));
} catch (e) {
  failed++;
  console.log('NG 途中で止まった：', e.message);
  try { await shot('zz-stopped'); } catch {}
}
const csp = await page.evaluate(() => window.__cspViolations).catch(() => ['(読めない)']);
check('CSP の違反が無い', csp.length === 0, csp.slice(0, 5).join(' / '));
check('読めなかったファイルが無い', missing.length === 0, missing.slice(0, 5).join(' '));
check('data: の URL の読み込みが無い', dataUrls.length === 0, dataUrls.slice(0, 3).join(' '));
check('ページの誤り（例外・console.error）が無い', errors.length === 0, errors.slice(0, 5).join(' / '));
await browser.close();
server.close();
console.log(failed ? `失敗 ${failed}` : 'すべて OK');
process.exit(failed ? 1 : 0);
