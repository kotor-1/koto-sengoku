// 生成イラスト素材（Version 22）を「本番ビルド」で、公開先に近い決まり（CSP）の下で確かめる。開発用のフック（__game・__battle・__p3）は使わない
// （本番のビルドには無い）。早送りもしない（合戦は ×2 の実時間）。入力はすべて本物のキー・クリック。
//
// 準備（公開と同じ作り。docs/proto3d.md の「公開」）：
//   VITE_MODEL_EXT=.json npm run proto3d:build
//   rm dist-proto3d/models/*.glb
//   node proto3d/tools/glb-to-gltf.mjs proto3d/public/models dist-proto3d/models ground_v2 gate_v2 walls_v2 keep inner machiya_a machiya_b machiya_d tree_pine tree_sakura tree_pine_far hero_v3_mpfb hero_v2
// 使い方：node e2e/art-prod.mjs [出力先]   （DIST=dist-proto3d PORT=8134 VIEW=960x540 RUNS=art,abort,old ART_MANIFEST=<manifest.gen.json> で変えられる。
//   ソフトウェア描画では歩きが遅い（1 コマ 0.1 秒までしか進まない）ので、既定の大きさは ieyasu-prod と同じ 960x540）
// この中で、次のヘッダー付きの簡易サーバーを立てる（.webp は image/webp）：
//   content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'
// 3 回遊ぶ（それぞれ新しい端末の状態から）：
//   art   … そのまま。/art/ の読み込みがすべて 200・image/webp・.webp で、素材の一覧（manifest.gen.json）にある物が画面に出ること
//   abort … /art/ への読み込みをすべて止める（読めない公開先・回線を真似る）。会話・軍議・合戦の文字と操作がすべて残り、遊びが進むこと（絵は出ない）
//   old   … ?art=old。/art/ を 1 つも読まないこと
// 経路（3 回とも同じ）：タイトル → 歴史分岐のはじめから（冒頭の演出はスキップ）→ W と Shift で歩いて本多忠勝と話す → 軍議を開く → C（自領の防衛）→ 決める
//   → 支度（目的：約束）→ 開き直してタイトル →「合戦場の演習」→ 大平原 → 出陣 → 合戦を始める → ×2 → 忠勝の札 → 全軍撤退 → 結果 → 続ける → 演習の結果。
// どの回も：CSP の違反 0・ページの誤り 0（abort の回の、止めた /art/ の読み込みの失敗の知らせは数えない）・dev-art の読み込み 0・data: の URL 0。
// 素材の一覧が空のとき（今）は「素材の一覧が空」と書き、素材の確かめは飛ばして、ほかの確かめはそのまま行う。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { launchBrowser, outDir, serveDist, skipCinematic } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/art-prod');
const DIST = resolve(process.env.DIST || 'dist-proto3d');
const PORT = Number(process.env.PORT || 8134);
const [VW, VH] = (process.env.VIEW || '960x540').split('x').map(Number);
const RUNS = (process.env.RUNS || 'art,abort,old').split(',').filter(Boolean);
if (!existsSync(join(DIST, 'index.html'))) throw new Error(`${DIST}/index.html が無い（先に本番ビルド）`);

// 素材の一覧：dist を作ったチェックアウトの manifest.gen.json（dist の隣に proto3d があればそれ。無ければ今の場所から）
const MANIFEST = resolve(process.env.ART_MANIFEST || (existsSync(resolve(DIST, '../proto3d/src/art/manifest.gen.json')) ? resolve(DIST, '../proto3d/src/art/manifest.gen.json') : 'proto3d/src/art/manifest.gen.json'));
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const assets = manifest.assets ?? {};
const ids = Object.keys(assets);
const has = (id) => ids.includes(id);
const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)])) : []);
const distArt = walk(join(DIST, 'art')).map((f) => relative(DIST, f).split('\\').join('/'));

let failed = 0;
const T0 = Date.now();
const secs = () => `${((Date.now() - T0) / 1000).toFixed(0)}s`;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''}  [${secs()}]`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = { timeout: 600000, polling: 500 };

console.log(`dist: ${DIST}\n素材の一覧: ${MANIFEST}（${ids.length} 件: ${ids.join(', ') || 'なし'}）\ndist/art: ${distArt.length} ファイル`);
if (!ids.length) console.log('   素材の一覧が空（no art in manifest）：素材が画面に出る確かめは飛ばし、ほかの確かめ（CSP・誤り・読めないときの進行・旧表示）は行う');
// 一覧と dist/art が合っている（一覧の物はすべて dist にある・一覧に無い物は dist に無い）
const listed = ids.map((id) => assets[id].file);
check('素材の一覧のファイルがすべて dist にある', listed.every((f) => distArt.includes(f)), listed.filter((f) => !distArt.includes(f)));
check('dist/art に一覧に無いファイルが無い', distArt.every((f) => listed.includes(f)), distArt.filter((f) => !listed.includes(f)));
check('一覧の素材はすべて .webp（公開先に送る種類）', listed.every((f) => f.endsWith('.webp')), listed.filter((f) => !f.endsWith('.webp')));
check('dist に開発用の TEST の模様（dev-art）が無い', !existsSync(join(DIST, 'dev-art')) && !walk(DIST).some((f) => /dev-art/.test(f)));

const srv = await serveDist(DIST, PORT);
const browser = await launchBrowser();
const summary = {};

async function run(kind) {
  console.log(`\n=== ${kind}${kind === 'abort' ? '（/art/ の読み込みをすべて止める）' : kind === 'old' ? '（?art=old）' : ''}`);
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
  await ctx.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const aborted = [];
  if (kind === 'abort') {
    await ctx.route(
      (url) => url.pathname.startsWith('/art/'),
      (route) => {
        aborted.push(new URL(route.request().url()).pathname);
        return route.abort();
      },
    );
  }
  const page = await ctx.newPage();
  page.setDefaultTimeout(600000);
  const errors = [];
  const artResp = [];
  const devArt = [];
  const dataUrls = [];
  const csp = [];
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  const artWarn = [];
  page.on('console', (m) => {
    // 素材の読み込みの失敗（registry.ts の console.warn「[art] … を読めませんでした」）は誤りにしないが、書き出す
    if (m.type() === 'warning' && m.text().includes('[art]')) artWarn.push(m.text().slice(0, 160));
    if (m.type() !== 'error') return;
    const where = m.location()?.url ?? '';
    // abort の回：止めた /art/ の読み込みの失敗の知らせ（ブラウザが出す）は数えない
    if (kind === 'abort' && /\/art\//.test(where) && /Failed to load resource/.test(m.text())) return;
    errors.push(`console ${m.text().slice(0, 200)}`);
  });
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:')) dataUrls.push(u.slice(0, 40));
    else if (/\/dev-art\//.test(new URL(u).pathname)) devArt.push(new URL(u).pathname);
  });
  page.on('response', async (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith('/art/')) artResp.push({ path: p, status: r.status(), type: (await r.headerValue('content-type').catch(() => null)) ?? '' });
  });
  const collectCsp = async () => csp.push(...(await page.evaluate(() => window.__cspViolations ?? []).catch(() => [])));
  const shot = (name) => page.screenshot({ path: `${OUT}/${kind}-${name}.png`, timeout: 600000 });
  const layer = (k) => page.locator(`.g-layer[data-kind="${k}"]`);
  const pressBtn = async (id, scope = '') => {
    const b = page.locator(`${scope} .g-btn[data-id="${id}"]`.trim()).first();
    await b.waitFor({ state: 'visible' });
    await sleep(500);
    await b.click();
  };
  const choose = async (id) => {
    const c = page.locator(`.g-choice[data-id="${id}"]`).last();
    await c.waitFor({ state: 'visible' });
    await sleep(500);
    await c.click();
  };
  const holdUntil = async (keys, cond, maxMs) => {
    for (const k of keys) await page.keyboard.down(k);
    const t = Date.now();
    let ok = false;
    while (Date.now() - t < maxMs) {
      if (await cond()) {
        ok = true;
        break;
      }
      await sleep(400);
    }
    for (const k of [...keys].reverse()) await page.keyboard.up(k);
    return ok;
  };
  // 会話の 1 行の様子（話し手・名前・文・選択肢・人物画・軍議の背景）。読むだけ
  const lineState = () =>
    page.evaluate(() => {
      const L = [...document.querySelectorAll('.g-layer[data-kind="script"]')].pop();
      if (!L) return null;
      const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]');
      const d = L.querySelector('.g-dialog');
      const pc = L.querySelector('canvas.g-portrait');
      return {
        speaker: d?.dataset.speaker ?? null,
        name: L.querySelector('.g-dialog .name')?.textContent.trim() ?? '',
        text: L.querySelector('.g-dialog .text')?.textContent.trim() ?? '',
        dialogVisible: vis(d),
        choices: [...L.querySelectorAll('.g-choice')].filter(vis).map((c) => ({ id: c.dataset.id, text: c.textContent.trim().slice(0, 30), disabled: c.disabled === true })),
        portrait: pc ? { artId: pc.dataset.artId, visible: vis(pc) && getComputedStyle(pc).opacity !== '0' } : null,
        councilBg: L.querySelector('.g-council-bg canvas.g-council-bg-base')?.dataset.artId ?? null,
        head: L.querySelector('.g-council-head')?.textContent.trim() ?? null,
        map: vis(L.querySelector('.g-council-map')),
      };
    });
  /** 選択肢が出るか層が閉じるまで、クリックで会話を進める。1 行ごとの様子を返す */
  async function readThrough() {
    const lines = [];
    for (let i = 0; i < 40; i++) {
      if (!(await layer('script').last().isVisible().catch(() => false))) break;
      await sleep(350); // 人物画の切り替え・読み込みを待つ
      const s = await lineState();
      if (s) lines.push(s);
      if (s?.choices.length) break;
      await page.mouse.click(VW / 2, VH * 0.3);
      await sleep(250);
    }
    return lines;
  }
  const out = { kind };
  try {
    const url = `http://localhost:${PORT}/?q=low${kind === 'old' ? '&art=old' : ''}`;
    await page.goto(url);
    await page.locator('.g-btn[data-id="new:ieyasu1570"]').waitFor({ state: 'visible', timeout: 600000 });
    check(`${kind}: 本番ビルドのタイトル（開発用のフックは無い）`, (await page.textContent('#build')).includes('本番') && (await page.evaluate(() => !window.__game && !window.__battle && !window.__p3)), await page.textContent('#build'));
    await pressBtn('new:ieyasu1570');
    await skipCinematic(page, { what: '第一章の冒頭' });
    await page.locator('.g-hud').waitFor({ state: 'visible' });
    const talkShown = () => page.evaluate(() => { const b = document.querySelector('.g-talk'); return !!b && !b.hidden && b.dataset.target === 'tadakatsu'; });
    const walked = await holdUntil(['Shift', 'KeyW'], talkShown, 900000);
    check(`${kind}: W と Shift で歩くと本多忠勝の「話す」が出る`, walked);
    if (!walked) throw new Error('忠勝の前まで歩けなかった（この回の残りは飛ばす）');
    await page.keyboard.press('KeyE');
    await layer('script').waitFor({ state: 'visible' });
    const talk = await readThrough();
    await shot('talk-choice');
    const last = talk[talk.length - 1];
    check(`${kind}: 会話の文字（話し手の名前・台詞。地の文は名前なし）がすべての行に出る`, talk.length >= 3 && talk.every((l) => l.dialogVisible && l.text && (l.speaker === 'narration' || l.name)), talk.map((l) => `${l.speaker}:${l.name}`).join(' '));
    check(`${kind}: 会話の選択肢（軍議を開く）が出て押せる`, !!last?.choices.find((c) => c.id === 'open_council' && !c.disabled), last?.choices.map((c) => c.id));
    out.talkPortraits = talk.map((l) => l.portrait && l.portrait.visible ? `${l.speaker}:${l.portrait.artId}` : `${l.speaker}:-`);
    if (kind === 'art') {
      // 人物画は話し始めてから読む（非同期）ので、遅い端末では最初の 1〜2 行は名前だけのことがある。出た行を書き出す（出ない行があっても NG にはしない）
      const shownOn = (sp, id) => talk.map((l, i) => (l.speaker === sp ? `${i}:${l.portrait?.artId === id && l.portrait.visible ? 'shown' : 'not yet'}` : null)).filter(Boolean).join(' ');
      if (has('portrait.tadakatsu')) check('art: 忠勝の台詞で忠勝の人物画が出る', talk.some((l) => l.speaker === 'tadakatsu' && l.portrait?.artId === 'portrait.tadakatsu' && l.portrait.visible), shownOn('tadakatsu', 'portrait.tadakatsu'));
      if (has('portrait.ieyasu')) check('art: 家康の台詞で家康の人物画が出る', talk.some((l) => l.speaker === 'hero' && l.portrait?.artId === 'portrait.ieyasu' && l.portrait.visible), shownOn('hero', 'portrait.ieyasu'));
      check('art: 人物画は、人物画のある二人の台詞だけ（地の文などでは出ない）', talk.every((l) => !l.portrait?.visible || (l.speaker === 'tadakatsu' && l.portrait.artId === 'portrait.tadakatsu') || (l.speaker === 'hero' && l.portrait.artId === 'portrait.ieyasu')), out.talkPortraits);
    } else check(`${kind}: 人物画の canvas は 1 つも無い（Version 21 と同じ）`, talk.every((l) => !l.portrait), out.talkPortraits);
    await choose('open_council');
    await page.locator('.g-layer.council').waitFor({ state: 'visible' });
    const council = await readThrough();
    await shot('council-choice');
    const cl = council[council.length - 1];
    check(`${kind}: 軍議の見出し・台詞・3 つの方針・「詳しく見る」が出る`, !!cl?.head?.includes('軍議') && council.every((l) => l.text && (l.speaker === 'narration' || l.name)) && ['policy_oda', 'policy_asai', 'policy_home'].every((id) => cl.choices.some((c) => c.id === id && !c.disabled)) && cl.map, { head: cl?.head?.slice(0, 20), choices: cl?.choices.map((c) => c.id), map: cl?.map });
    out.councilBg = council.map((l) => l.councilBg);
    if (kind === 'art') {
      if (has('bg.council')) check('art: 軍議の背景が出る', council.some((l) => l.councilBg === 'bg.council'), out.councilBg);
      if (has('portrait.tadakatsu')) check('art: 軍議の忠勝の台詞で人物画', council.some((l) => l.speaker === 'tadakatsu' && l.portrait?.artId === 'portrait.tadakatsu' && l.portrait.visible));
    } else check(`${kind}: 軍議の背景・人物画は無い（Version 21 と同じ）`, council.every((l) => !l.councilBg && !l.portrait), out.councilBg);
    await choose('policy_home');
    await sleep(600);
    await readThrough();
    await choose('confirm_policy');
    await page.locator('.g-layer[data-kind="script"]').waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.querySelector('.g-hud')?.textContent.includes('約束'), null, W);
    check(`${kind}: 軍議で C に決める → 出陣の支度へ進む（目的：約束）`, true);
    await collectCsp();

    // ---- 演習の大平原（タイトルへ戻るのは開き直し。保存は歴史分岐の支度の自動保存のまま）
    await page.goto(url);
    await page.locator('[data-practice="entry"] .g-btn[data-id="practice"]').waitFor({ state: 'visible', timeout: 600000 });
    await pressBtn('practice', '[data-practice="entry"]');
    await page.locator('.g-layer[data-sheet="practice-list"]').waitFor({ state: 'visible' });
    await pressBtn('field:plains', '.g-layer[data-sheet="practice-list"]');
    await page.locator('.g-layer[data-sheet="practice-briefing"]').waitFor({ state: 'visible' });
    await sleep(1500);
    const brief = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('.g-pr-units tr[data-unit]')].map((tr) => ({ unit: tr.dataset.unit, text: tr.textContent.trim().slice(0, 20), face: tr.querySelector('.b-face')?.dataset.artId ?? null })),
      go: !!document.querySelector('.g-layer[data-sheet="practice-briefing"] .g-btn[data-id="go"]'),
    }));
    await shot('briefing');
    check(`${kind}: 演習の説明：編成の表の文字と「出陣」`, brief.rows.length >= 4 && brief.rows.every((r) => r.text) && brief.go, brief.rows.length);
    const faceRows = brief.rows.filter((r) => r.face).map((r) => `${r.unit}:${r.face}`).sort();
    if (kind === 'art') {
      const want = [has('face.ieyasu') ? 'a_ieyasu:face.ieyasu' : null, has('face.tadakatsu') ? 'a_tadakatsu:face.tadakatsu' : null].filter(Boolean).sort();
      check('art: 編成の表の顔は一覧にある家康・忠勝だけ', JSON.stringify(faceRows) === JSON.stringify(want), faceRows);
    } else check(`${kind}: 編成の表に顔は無い`, faceRows.length === 0, faceRows);
    await pressBtn('go', '.g-layer[data-sheet="practice-briefing"]');
    await page.locator('.b-root[data-field="plains"]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, W);
    await page.locator('.b-primary').click();
    await page.locator('.b-seg', { hasText: '×2' }).click();
    const clock0 = await page.textContent('.b-topleft');
    await sleep(4000);
    const clock1 = await page.textContent('.b-topleft');
    check(`${kind}: 合戦を始めると時間が進む`, clock0 !== clock1, `${clock0.match(/日没まで\s*[\d:]+/)?.[0] ?? clock0.slice(0, 30)} → ${clock1.match(/日没まで\s*[\d:]+/)?.[0] ?? clock1.slice(0, 30)}`);
    await page.locator('.b-card[data-id="a_tadakatsu"]').click();
    await sleep(1200);
    const bs = await page.evaluate(() => {
      const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]');
      return {
        cards: [...document.querySelectorAll('.b-card')].map((c) => ({ id: c.dataset.id, text: c.innerText.replace(/\s+/g, ' ').trim().slice(0, 30), face: c.querySelector('.b-face')?.dataset.artId ?? null })),
        abil: vis(document.querySelector('.b-abil')) ? document.querySelector('.b-abil').innerText.replace(/\s+/g, ' ').slice(0, 60) : null,
        genFace: document.querySelector('.b-gen .b-face')?.dataset.artId ?? null,
        parts: Object.fromEntries(['.b-obj-head', '.b-goals', '.b-ctrl', '.b-zoom', '.b-bottom', '.b-allret', '.b-pause'].map((s) => [s, vis(document.querySelector(s))])),
        faces: document.querySelectorAll('.b-face').length,
      };
    });
    await shot('battle-selected');
    check(`${kind}: 合戦の札（4 以上）の文字・目標・操作の部品が出る`, bs.cards.length >= 4 && bs.cards.every((c) => c.text) && Object.values(bs.parts).every(Boolean), bs.parts);
    check(`${kind}: 忠勝の札を選ぶと能力の欄が出る`, !!bs.abil, bs.abil);
    if (kind === 'art') {
      const want = [has('face.ieyasu') ? 'a_ieyasu:face.ieyasu' : null, has('face.tadakatsu') ? 'a_tadakatsu:face.tadakatsu' : null].filter(Boolean).sort();
      const got = bs.cards.filter((c) => c.face).map((c) => `${c.id}:${c.face}`).sort();
      check('art: 札の顔は一覧にある家康・忠勝だけ', JSON.stringify(got) === JSON.stringify(want), got);
      if (has('face.tadakatsu')) check('art: 能力の欄の武将の行に忠勝の顔', bs.genFace === 'face.tadakatsu', bs.genFace);
      const tex = ['tex.plains.grass', 'tex.plains.dirt', 'tex.plains.road', 'tex.plains.forest'].filter(has).map((id) => `/${assets[id].file}`);
      if (tex.length) check('art: 大平原の地面の素材を読んだ', tex.every((p) => artResp.some((r) => r.path === p && r.status === 200)), tex);
    } else check(`${kind}: 合戦に顔の canvas は無い`, bs.faces === 0, bs.faces);
    await page.locator('.b-allret').click();
    await page.locator('.b-modal .b-primary').click();
    await page.locator('.b-result').waitFor({ state: 'visible', timeout: 600000 });
    const h2 = await page.textContent('.b-result h2');
    await page.locator('.b-primary', { hasText: '続ける' }).click();
    await page.locator('.g-layer[data-sheet="practice-result"]').waitFor({ state: 'visible' });
    check(`${kind}: 全軍撤退 → 結果（撤退）→ 続ける → 演習の結果へ進む`, h2 === '撤退', h2);
    await collectCsp();
  } catch (e) {
    check(`${kind}: 経路を最後まで進めた`, false, e.message.split('\n')[0]);
    await shot('failed').catch(() => {});
  }
  // ---- どの回も
  check(`${kind}: CSP の違反 0`, csp.length === 0, csp.slice(0, 3));
  check(`${kind}: ページの誤り 0`, errors.length === 0, errors.slice(0, 3));
  check(`${kind}: 開発用の TEST の模様（dev-art）を 1 つも読まない`, devArt.length === 0, devArt);
  check(`${kind}: data: の URL を使わない`, dataUrls.length === 0, dataUrls);
  if (kind === 'art') {
    check(`art: /art/ の読み込みはすべて 200・image/webp・.webp（${artResp.length} 件）`, artResp.every((r) => r.status === 200 && r.type.startsWith('image/webp') && r.path.endsWith('.webp')), artResp.filter((r) => !(r.status === 200 && r.type.startsWith('image/webp') && r.path.endsWith('.webp'))));
    if (!ids.length) check('art: 素材の一覧が空なので /art/ を 1 つも読まない', artResp.length === 0, artResp);
    else check('art: 読んだ /art/ はすべて一覧の物', artResp.every((r) => listed.includes(r.path.slice(1))), artResp.map((r) => r.path));
  }
  if (kind === 'abort') check(`abort: /art/ の読み込みは止めた物だけ（届いた /art/ は 0）`, artResp.length === 0, `止めた ${aborted.length} 件${aborted.length ? ': ' + [...new Set(aborted)].join(' ') : '（素材の一覧が空なので読みに行かない）'}`);
  if (kind === 'old') check('old: ?art=old は /art/ を 1 つも読まない', artResp.length === 0 && aborted.length === 0, artResp.map((r) => r.path));
  if (artWarn.length) console.log(`   素材の読み込みの知らせ（console.warn）：${artWarn.join(' / ')}`);
  if (kind === 'art') check('art: 一覧の素材の読み込みの失敗の知らせが無い（[art] … を読めませんでした）', !artWarn.some((w) => w.includes('読めません')), artWarn);
  out.artWarn = artWarn;
  out.artRequests = artResp;
  out.aborted = [...new Set(aborted)];
  out.errors = errors;
  out.csp = csp;
  summary[kind] = out;
  await ctx.close();
}

try {
  for (const k of RUNS) await run(k);
} finally {
  await browser.close();
  await srv.close();
}
const artMissing = srv.missing.filter((p) => p.startsWith('/art/'));
check('サーバー：/art/ の 404 は 0（一覧にあるのに dist に無い物は無い）', artMissing.length === 0, artMissing);
console.log(`\n素材の一覧 ${ids.length} 件${ids.length ? '' : '（no art in manifest：素材が画面に出る確かめは飛ばした）'}。回ごとの /art/：${RUNS.map((k) => `${k} ${summary[k]?.artRequests.length ?? '-'} 件（止めた ${summary[k]?.aborted.length ?? 0}）`).join('・')}`);
console.log(failed ? `NG ${failed} 件` : 'すべて OK');
process.exit(failed ? 1 : 0);
