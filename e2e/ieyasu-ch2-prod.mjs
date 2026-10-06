// 歴史分岐「元亀元年・家康」の第一章の結末から第二章の区切りまでを「本番ビルド」で、公開先に近い決まり（CSP）の下で確かめる。
// 開発用のフック（__game・__battle・__p3）は使わない（本番のビルドには無い）。早送りもしない（合戦は ×2 の実時間）。探索の描画も省かない。
// 確認の種類：
//   - 直接状態変更：はじめに第一章の結末の保存（tests/fixtures/ieyasu-ch1-v3/oda_victory_kept.json。第二章を足す前のコードが書いた実物）と、
//     見張りの保存（2D・架空・演習）を localStorage に入れて読み込み直す。
//   - 本物の入力：ほかはすべて本物のキー・クリック（タイトル・結末の「第二章へ進む」・結果確認の「城下へ」・城下を歩く（WASD）・話す（E）・行送り・選択肢・
//     メニューの保存・城門・「合戦を始める」・×2・全軍撤退・「続ける」・区切りの「タイトルへ」）。
//   - 位置は、ゲームのメニューの「保存する」で書かれた保存（localStorage の explore）から読む（遊ぶ人の操作と同じ。e2e/ieyasu-prod.mjs と同じ）。
//
// 準備（公開と同じ作り。決まったコミットを別の作業木で）：
//   git worktree add --detach /home/user/ks-prod <コミット>; ln -s /home/user/koto-sengoku/node_modules /home/user/ks-prod/node_modules
//   cd /home/user/ks-prod && VITE_MODEL_EXT=.json npm run proto3d:build && rm -f dist-proto3d/models/*.glb &&
//   node proto3d/tools/glb-to-gltf.mjs proto3d/public/models dist-proto3d/models ground_v2 gate_v2 walls_v2 keep inner machiya_a machiya_b machiya_d tree_pine tree_sakura tree_pine_far hero_v3_mpfb hero_v2
// 使い方：DIST=/home/user/ks-prod/dist-proto3d node e2e/ieyasu-ch2-prod.mjs [出力先]   （PORT=8134 VIEW=960x540 で変えられる）
// この中で、次のヘッダー付きの簡易サーバーを立てる：
//   content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'
// 経路：つづきから（第一章の結末）→「第二章へ進む」→ 結果確認 →「城下へ」→ 忠勝へ歩いて軍議（判断 1：殿を引き受ける）→ 支度：石川へ歩いて補充「待つ」
//       → メニューから保存 → 城門へ歩いて出陣 → 合戦（×2・全軍撤退）→ 結果 →「続ける」→ 戦後：忠勝へ歩いて「第二章を締めくくる」→ 区切り → タイトル。
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { keysToward, launchBrowser, measureYaw, outDir, skipCinematic } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/ieyasu-ch2/prod');
const DIST = resolve(process.env.DIST || 'dist-proto3d');
const PORT = Number(process.env.PORT || 8134);
const [VW, VH] = (process.env.VIEW || '960x540').split('x').map(Number);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'";
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };
const KEY = 'koto-sengoku/3d-ieyasu1570';
const KEY_CH1 = 'koto-sengoku/3d-ieyasu1570/chapter1';
const FKEY = 'koto-sengoku/3d-chapter1';
const KEY2D = 'koto-sengoku/save';
const PKEY = 'koto-sengoku/3d-fields';
const SENT2D = '{"2d":"keep"}';
const SENTF = '{"sentinel":"fictional"}';
const SENTP = '{"sentinel":"practice"}';
const FIXTURE = readFileSync(new URL('../tests/fixtures/ieyasu-ch1-v3/oda_victory_kept.json', import.meta.url), 'utf8');
// 城下の人物の位置（proto3d/src/explore/cast.ts の SPOTS。第二章の配役は chapter2/scenario.ts：忠勝＝源蔵の所・石川＝新八の所）
const SPOT = {
  tadakatsu: { explore: { x: -1.5, z: -7.2 }, muster: { x: -2.0, z: -7.4 }, aftermath: { x: -2.0, z: -7.4 } },
  ishikawa: { x: 5.3, z: -2.4 },
  gate: { x: 0, z: -10.9 },
};

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
let oks = 0;
const T0 = Date.now();
const secs = () => `${((Date.now() - T0) / 1000).toFixed(0)}s`;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  else oks++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}  [${secs()}]`);
};
const note = (t) => console.log(`   ${t}  [${secs()}]`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = { timeout: 600000, polling: 500 };

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
await ctx.addInitScript(() => {
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const page = await ctx.newPage();
page.setDefaultTimeout(600000);
const errors = [];
const dataUrls = [];
let reloading = false;
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (reloading && /Couldn't load texture blob:/.test(m.text())) return;
  errors.push(`console ${m.text()}`);
});
page.on('request', (r) => { if (r.url().startsWith('data:')) dataUrls.push(r.url().slice(0, 40)); });
const shot = (name) => {
  note(`撮影 ${name}`);
  return page.screenshot({ path: `${OUT}/${name}.png`, timeout: 600000 });
};
const layer = (kind) => page.locator(`.g-layer[data-kind="${kind}"]`);
const waitLayer = (kind) => layer(kind).waitFor({ state: 'visible', timeout: 600000 });
const save = (k = KEY) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), k);
const raw = (k) => page.evaluate((k) => localStorage.getItem(k), k);
const J = (v) => JSON.stringify(v);

/** 会話を、選択肢が出るか閉じるまでクリックで進める（見た行を返す） */
async function readThrough() {
  const seen = [];
  for (let i = 0; i < 80; i++) {
    if (!(await layer('script').isVisible())) return seen;
    const t = await page.locator('.g-layer[data-kind="script"]').textContent().catch(() => '');
    if (seen[seen.length - 1] !== t) seen.push(t);
    if (await page.locator('.g-choices:not([hidden]) .g-choice').first().isVisible().catch(() => false)) return seen;
    await page.mouse.click(VW / 2, VH * 0.3);
    await sleep(300);
  }
  return seen;
}
async function choose(id) {
  await page.locator(`.g-choice[data-id="${id}"]`).waitFor({ state: 'visible' });
  await sleep(500);
  await page.locator(`.g-choice[data-id="${id}"]`).click();
}
async function pressBtn(id) {
  await page.locator(`.g-btn[data-id="${id}"]`).waitFor({ state: 'visible' });
  await sleep(500);
  await page.locator(`.g-btn[data-id="${id}"]`).scrollIntoViewIfNeeded();
  await page.locator(`.g-btn[data-id="${id}"]`).click();
}
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
/**
 * 目標へ歩く（WASD を押し続ける）。done が真になれば終わり。届かなければ保存から位置を読み直して向きを直す。
 * 見回しの向き（yaw）は決め打ちにせず、歩き始めに S を短く押して下がった向きから測る（Version 21：第二章の探索の始めは町の入口で yaw 0。
 * 戦後の始めなど、段階の始めの位置で変わる）
 */
async function walkTo(target, done, label) {
  if (await done()) return true;
  const my = await measureYaw(page, async () => (await saveAndReadPose()).pose);
  const YAW = my?.yaw ?? 0;
  let r = my ? { pose: my.pose } : await saveAndReadPose();
  note(`${label}へ：見回しの向き（測った）yaw ${YAW.toFixed(2)}`);
  for (let leg = 0; leg < 8; leg++) {
    if (await done()) return true;
    const p = r.pose;
    const d = Math.hypot(target.x - p.x, target.z - p.z);
    const keys = keysToward(YAW, p, target.x, target.z);
    note(`${label}へ ${leg + 1}：(${p.x.toFixed(2)}, ${p.z.toFixed(2)}) から ${d.toFixed(1)} m、キー ${keys.join('+')}`);
    if (await holdUntil(keys, done, Math.min(200000, 9000 + d * 25000))) return true;
    r = await saveAndReadPose();
  }
  return done();
}
async function talkTo(id, target) {
  const ok = await walkTo(target, () => talkShown(id), id);
  check(`歩いて ${id} の「話す」が出る（WASD）`, ok);
  await page.keyboard.press('KeyE');
  await waitLayer('script');
  return readThrough();
}

try {
  const t0 = Date.now();
  await page.goto(URL0);
  await page.locator('.g-btn[data-id="new:ieyasu1570"]').waitFor({ state: 'visible', timeout: 600000 });
  check(`本番ビルドを CSP の下で読み込み、タイトルが出る（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`, true, await page.textContent('#build'));
  check('本番ビルドの表示・開発用のフック（__game・__battle・__p3）は無い', (await page.textContent('#build')).includes('本番') && (await page.evaluate(() => !window.__game && !window.__battle && !window.__p3)));
  // 第一章の結末の保存を入れる（直接状態変更）
  await page.evaluate(([k, v, k2, s2, kf, sf, kp, sp]) => { localStorage.clear(); localStorage.setItem(k, v); localStorage.setItem(k2, s2); localStorage.setItem(kf, sf); localStorage.setItem(kp, sp); }, [KEY, FIXTURE, KEY2D, SENT2D, FKEY, SENTF, PKEY, SENTP]);
  reloading = true;
  await page.reload();
  reloading = false;
  await page.locator('.g-btn[data-id="continue:ieyasu1570"]').waitFor({ state: 'visible', timeout: 600000 });
  note('（直接状態変更）第一章の結末の保存（oda_victory_kept）と見張りの保存を入れて読み込み直した');
  const c0 = await page.textContent('.g-btn[data-id="continue:ieyasu1570"]');
  check('タイトル：歴史分岐の「つづきから」は第一章の結末（章の結末）・タイトルに第二章の別のボタンは無い', c0.includes('章の結末') && (await page.locator('.g-btn[data-id*="chapter2"]').count()) === 0, c0.replace(/\s+/g, ' ').slice(0, 60));
  await shot('P01-title');
  await pressBtn('continue:ieyasu1570');
  await waitLayer('ending');
  const ids = await page.evaluate(() => [...document.querySelectorAll('.g-layer[data-kind="ending"] .g-btn')].map((b) => b.dataset.id));
  check('第一章の結末の画面：「第二章へ進む」と「タイトルへ」', J(ids) === '["next_chapter","title"]', J(ids));
  await shot('P02-ch1-ending');
  await pressBtn('next_chapter');
  // 保存の後：結果確認の画面 →「城下へ」→ 第二章の冒頭（スキップのボタンを本物のクリックで押す。層の属性だけで待つ）
  await waitLayer('record');
  const rec = await page.textContent('.g-layer[data-kind="record"]');
  const sv = await save();
  const b1 = await save(KEY_CH1);
  check('「第二章へ進む」→ 第一章の結果（第二章へ引き継ぐもの）・保存は版 4（第二章の始め）・第一章の控え（版 3）', rec.includes('第一章の結果') && sv?.version === 4 && sv.point === 'chapter' && b1?.version === 3 && b1.phase === 'ending', J({ v: sv?.version, point: sv?.point, ch1: b1?.phase }));
  check('第二章のはじめの兵＝第一章の終わりの兵（援兵は足さない）', J(sv?.troops) === J(JSON.parse(FIXTURE).troops), J(sv?.troops));
  await shot('P03-record');
  await pressBtn('to_town');
  await skipCinematic(page, { what: '第二章の冒頭', log: note });
  await page.locator('.g-hud').waitFor({ state: 'visible' });
  await sleep(1500);
  check('第二章の城下（HUD に第二章）', (await page.textContent('.g-hud')).includes('第二章'), (await page.textContent('.g-hud')).slice(0, 60));
  await shot('P04-ch2-town');
  // 忠勝へ歩いて軍議
  let seen = await talkTo('tadakatsu', SPOT.tadakatsu.explore);
  await choose('open_council');
  await page.locator('.g-layer.council').waitFor({ state: 'visible' });
  await readThrough();
  const planText = await page.textContent('.g-choice[data-id="plan_commit"]');
  check('軍議：判断の選択肢に「この判断で確定する主目標」', planText.includes('この判断で確定する主目標'), planText.slice(0, 100));
  await shot('P05-council');
  await choose('plan_commit');
  await sleep(600);
  seen = await readThrough();
  check('軍議の確かめ：決めると主目標の条件が確定する', seen.join(' ').includes('決めると主目標の条件が確定する'));
  await choose('confirm_plan');
  await page.locator('.g-layer[data-kind="script"]').waitFor({ state: 'detached' });
  // 支度：石川へ歩いて補充
  seen = await talkTo('ishikawa', SPOT.ishikawa);
  const wt = await page.textContent('.g-choice[data-id="recovery_wait"]').catch(() => '');
  check('補充の選択肢「待つ」：選ぶ前に代償（浅井の後詰めが早まる）と、主目標の条件は変わらない', wt.includes('→') && wt.includes('主目標の条件は軍議で決めたまま変わらない'), wt.slice(0, 120));
  await shot('P06-recovery');
  await choose('recovery_wait');
  await page.locator('.g-layer[data-kind="script"]').waitFor({ state: 'detached' });
  let r = await saveAndReadPose();
  const termsJ = J(r.save?.terms);
  check('支度：メニューから保存（版 4・確定した条件・補充「待つ」の記録）', r.msg.includes('読み戻して確かめました') && r.save?.version === 4 && r.save.phase === 'muster' && r.save.recovery?.choice === 'wait' && r.save.terms?.plan === 'commit', termsJ);
  // 城門へ歩いて出陣（石川の所から城門へまっすぐ向かうと使者に当たるので、忠勝の「話す」が出る所を経て、忠勝と使者の間を通る）
  const okVia = await walkTo(SPOT.tadakatsu.muster, () => talkShown('tadakatsu'), '忠勝の脇');
  check('歩いて忠勝の脇へ（城門への道の手前）', okVia);
  const okGate = await walkTo(SPOT.gate, () => layer('script').isVisible(), '城門');
  check('歩いて城門へ（出陣の確認が出る）', okGate);
  seen = await readThrough();
  check('城門：確定した主目標を見せる', seen.join(' ').includes('主目標（軍議で確定）'));
  await shot('P07-gate');
  await choose('depart');
  await skipCinematic(page, { what: '出陣', log: note });
  await page.locator('.b-primary:not(.off)', { hasText: '合戦を始める' }).waitFor({ state: 'visible', timeout: 600000 });
  const dep = await save();
  check('出陣前の自動保存（版 4・departure・条件は同じ）', dep?.version === 4 && dep.point === 'departure' && J(dep.terms) === termsJ);
  const brief = await page.textContent('.b-modal');
  check('合戦の説明：第一章の直後の分岐した世界の創作・待った代償（後詰めが 30 秒ほど）', brief.includes('第一章の直後') && brief.includes('30 秒ほど'), brief.slice(0, 80));
  await shot('P08-briefing');
  await page.locator('.b-primary', { hasText: '合戦を始める' }).click();
  await sleep(1500);
  await page.locator('.b-seg', { hasText: '×2' }).click();
  await sleep(2000);
  const wb = Date.now();
  await page.locator('.b-allret').click();
  await page.locator('.b-confirm').waitFor({ state: 'visible' });
  await sleep(500);
  await page.locator('.b-confirm .b-btn', { hasText: '撤退する' }).click();
  await shot('P09-battle');
  await page.locator('.b-result').waitFor({ state: 'visible', timeout: 1200000 });
  await sleep(1000);
  await shot('P10-result');
  const head = await page.textContent('.b-result h2');
  const aft = await save();
  check(`合戦（×2・全軍撤退。実時間 ${((Date.now() - wb) / 1000).toFixed(0)} 秒）→ 結果の画面「${head.trim()}」・その時点で戦後の自動保存（版 4・反映済み・条件は同じ）`,
    aft?.version === 4 && aft.point === 'aftermath' && aft.appliedBattleId === aft.battleId && J(aft.terms) === termsJ && !!aft.result, `${aft?.battle?.result}/${aft?.battle?.reason}・${aft?.battle?.elapsedSec?.toFixed(1)} 秒`);
  note(`合戦の結果：${aft?.battle?.result}（${aft?.battle?.reason}）・合戦の時間 ${aft?.battle?.elapsedSec?.toFixed(1)} 秒・副目標 ${(aft?.result?.secondary ?? []).map((o) => `${o.label}${o.achieved ? '○' : '×'}`).join('・')}`);
  await page.locator('.b-primary', { hasText: '続ける' }).click();
  await skipCinematic(page, { what: '帰還', log: note });
  await page.waitForFunction(() => !document.body.classList.contains('mode-battle') && !document.getElementById('battle-ui') && document.querySelector('.g-hud') && !document.querySelector('.g-hud').hidden, null, W);
  await sleep(1500);
  await shot('P11-aftermath');
  // 戦後：忠勝へ歩いて締めくくる
  seen = await talkTo('tadakatsu', SPOT.tadakatsu.aftermath);
  await choose('end_chapter');
  await waitLayer('ending');
  const ending = await page.textContent('.g-ending');
  const eids = await page.evaluate(() => [...document.querySelectorAll('.g-layer[data-kind="ending"] .g-btn')].map((b) => b.dataset.id));
  const se = await save();
  check('第二章の区切り：ボタンは「タイトルへ」だけ・判断・補充・主目標・史実と創作・保存は版 4 の ending', J(eids) === '["title"]' && ['第二章', '判断', '補充', '主目標', '史実と創作'].every((w) => ending.includes(w)) && se?.version === 4 && se.point === 'ending', J(eids));
  check('区切りの文に史実の合戦の名前・逸話を書かない', !/姉川|金ヶ崎|小谷|単騎|無傷/.test(ending));
  await shot('P12-ch2-ending');
  await pressBtn('title');
  await page.locator('.g-btn[data-id="continue:ieyasu1570"]').waitFor({ state: 'visible' });
  const c3 = await page.textContent('.g-btn[data-id="continue:ieyasu1570"]');
  check('タイトル：つづきからは第二章の区切り', c3.includes('第二章の区切り'), c3.replace(/\s+/g, ' ').slice(0, 60));
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('koto-sengoku/')).sort());
  check('保存のキー：歴史分岐・第一章の控え・2D・架空・演習の 5 つ。2D・架空・演習は 1 文字も変わらない', J(keys) === J([KEY2D, FKEY, PKEY, KEY, KEY_CH1].sort()) && (await raw(KEY2D)) === SENT2D && (await raw(FKEY)) === SENTF && (await raw(PKEY)) === SENTP, J(keys));
} catch (e) {
  failed++;
  console.log('NG 途中で止まった：', e.message);
  try { await shot('zz-stopped'); } catch {}
}
const csp = await page.evaluate(() => window.__cspViolations).catch(() => ['(読めない)']);
check('CSP の違反が無い', csp.length === 0, csp.slice(0, 5).join(' / '));
check('読めなかったファイルが無い', missing.length === 0, missing.slice(0, 5).join(' '));
const models = served.filter((p) => p.startsWith('/models/'));
check('素材は JSON（glTF）と画像で読む（.glb も data: の URL も使わない）', models.length > 0 && models.every((p) => /\.(json|jpg|png)$/.test(p)) && dataUrls.length === 0, `${models.filter((p) => p.endsWith('.json')).length} 個の JSON`);
check('ページの誤り（例外・console.error）が無い', errors.length === 0, errors.slice(0, 5).join(' / '));
await browser.close();
server.close();
console.log(`OK ${oks}・NG ${failed}`);
console.log(failed ? `失敗 ${failed}` : 'すべて OK');
process.exit(failed ? 1 : 0);
