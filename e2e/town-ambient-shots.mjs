// 探索中の町が第一章の結果で変わることを、画面で示す（開発サーバー・描画あり ?q=low。render=manual は付けない）。
// 依頼：docs/story-rpg-request.md【3】【5】（町の人々・負傷兵・援兵は第一章の結果で変わる）・設計 docs/story-rpg-design.md §5.1・町の記録 docs/story-rpg-town.md。
// 公開前の抜けの点検（prepub-critic）の blocker：「町が第一章の結果で変わる」を、探索中の町の画で示していなかった。
//
// 撮るもの（どれも同じ所に立ち、同じ向きで、兵の詰所と負傷兵の休み場（town/spots.ts の GUARDPOST）を向いた画）：
//   ch1start                   第一章の始め（タイトルの「はじめから」。負傷兵 0・援兵なし）
//   oda_victory_kept           第一章の結末（A 織田・勝ち・約束を守った）→ 第二章の城下（負傷兵は少なく、織田の援兵がいる）
//   home_defeat_broken_heavy   第一章の結末（C 自領・負け・約束を破った・損害大）→ 第二章の城下（負傷兵が多く、援兵なし）
//   STATES（カンマ区切り）で選べる（既定は上の 3 つ。tests/fixtures/ieyasu-ch1-v3/ のほかの名前も使える）。
//
// 確認の種類（出力の行にも書く）：
//   - 本物の入力：タイトルの「はじめから」「つづきから」・結末の「第二章へ進む」・演出の「スキップ」・結果確認の「城下へ」（クリック）・
//     歩く（キーの W・A・S・D と Shift。カメラの向きに合わせて押す）・見回し（マウスの引きずり）。
//   - 直接状態変更：第一章の結末の保存（tests/fixtures/ieyasu-ch1-v3/）と見張りの保存（2D・架空・演習）を localStorage に入れる。
//     歩く道は町の当たり判定から格子で探す（ページの中で layout.ts を読む。道を決めるだけで、動かすのは本物のキー）。
//     位置・向き・町の人々の数は開発用の口（__p3・__game.world.ambientProbe()）で読むだけ。
//   - 描画の省略：無し（描画あり・画質「低」。このコンテナは町の 3D が毎秒 1 コマ前後なので、歩くのは遅い）。
//   - 実機・性能：ここでは未確認（ソフトウェア描画の headless Chromium）。
//
// 出力：<状態>-guardpost.png（詰所を向いた画）・<状態>-arrive.png（城下へ着いた最初の画）・ambient.json（ambientProbe の記録）
// 使い方：自動再読み込みなしの開発サーバーを自分用のポートで起動して
//   (PORT=8413 setsid nohup npx vite --config proto3d/blender/tools/vite.nohmr.mjs > /tmp/vite-8413.log 2>&1 &)
//   BASE=http://localhost:8413 node e2e/town-ambient-shots.mjs [出力先（既定 e2e-out/town-ambient）]
import { readFileSync, writeFileSync } from 'node:fs';
import { launchBrowser, outDir, skipCinematic } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/town-ambient');
const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8413';
const STATES = (process.env.STATES || 'ch1start,oda_victory_kept,home_defeat_broken_heavy').split(',').map((s) => s.trim()).filter(Boolean);
const VIEW = { width: 844, height: 390 };
/**
 * 詰所を見る立ち位置（筵の南、町家の写しの東の路地から北へ抜けた所）と、見る向き（筵・床几と、その東の援兵の間）・見下ろし。
 * 肩越しのカメラは主人公の後ろ 2.1 m なので、少し見下ろして（pitch 0.3）主人公の頭の先に詰所の地面が入るようにする
 */
const STAND = { x: Number(process.env.STAND_X ?? 11.5), z: Number(process.env.STAND_Z ?? 2.5) };
const LOOK_AT = { x: 14.6, z: -3.0 };
const PITCH = Number(process.env.PITCH ?? 0.3);
const KEY = 'koto-sengoku/3d-ieyasu1570';
const KEY_CH1 = 'koto-sengoku/3d-ieyasu1570/chapter1';
const PREFS = 'koto-sengoku/3d-prefs';
const SENT = { 'koto-sengoku/save': '{"2d":"keep"}', 'koto-sengoku/3d-chapter1': '{"sentinel":"fictional"}', 'koto-sengoku/3d-fields': '{"sentinel":"practice"}' };
const POLL = { timeout: 600000, polling: 200 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => JSON.stringify(v);
const fixture = (n) => readFileSync(new URL(`../tests/fixtures/ieyasu-ch1-v3/${n}.json`, import.meta.url), 'utf8');

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

async function open(main) {
  const ctx = await browser.newContext({ viewport: VIEW });
  const page = await ctx.newPage();
  page.setDefaultTimeout(600000);
  let reloading = false;
  const onErr = (text) => {
    if (/Couldn't load texture blob:/.test(text) && reloading) return;
    errors.push(text);
    console.log(`   ！ページの誤り [${secs()}] ${text.slice(0, 200)}`);
  };
  page.on('pageerror', (e) => onErr(e.message));
  page.on('console', (m) => { if (m.type() === 'error') onErr(m.text()); });
  await page.goto(BASE + '/?q=low');
  await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && window.__game.world.ready, null, POLL);
  // 見張りの保存（2D・架空・演習）と歴史分岐の保存（main。null なら消す）を入れる（直接状態変更）
  await page.evaluate(([s, k, k1, p, v]) => {
    localStorage.clear();
    for (const [kk, vv] of Object.entries(s)) localStorage.setItem(kk, vv);
    localStorage.removeItem(k1);
    localStorage.removeItem(p);
    if (v !== null) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  }, [SENT, KEY, KEY_CH1, PREFS, main]);
  reloading = true;
  try { await page.reload(); } finally { reloading = false; }
  await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true && window.__game.world.ready, null, POLL);
  return { ctx, page };
}
const pose = (page) => page.evaluate(() => ({ x: window.__p3.hero.x, z: window.__p3.hero.z, heading: window.__p3.hero.heading, speed: window.__p3.hero.speed, yaw: window.__p3.orbit.yaw, pitch: window.__p3.orbit.pitch, screen: window.__game.screen, ui: window.__game.ui?.kind ?? null }));
const waitExplore = (page) => page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui && !document.body.classList.contains('g-cine'), null, POLL);
/** 人物の素材を読み終えるまで待つ */
const waitModels = (page) => page.waitForFunction(() => window.__game.cast.length > 0 && window.__game.cast.filter((c) => c.pose).every((c) => c.model || !['tadakatsu', 'ishikawa', 'envoy'].includes(c.id)), null, POLL);
/** 町の人々の記録（ambientProbe。数は設定の数と、直前のコマで描いた数） */
const ambient = (page) => page.evaluate(() => {
  const a = window.__game.world.ambientProbe();
  return { groups: a.spec?.groups ?? null, walkers: a.walkers.length, figures: a.figures, peopleDrawn: a.peopleDrawn, figuresDrawn: a.figuresDrawn };
});
/** 町の人々の兵の形のうち、詰所のまわり（x 9〜19・z −11〜1）にいる数（設定から。ページの中で ambient.ts を読む。読むだけ） */
const guardpostFigures = (page) => page.evaluate(async () => {
  const A = await import('/src/explore/ambient.ts');
  const plan = A.ambientPlan(window.__game.world.ambientProbe().spec);
  const near = plan.figures.filter((f) => f.x > 9 && f.x < 19 && f.z > -11 && f.z < 1);
  const by = {};
  for (const f of near) by[f.kind] = (by[f.kind] ?? 0) + 1;
  // 画面の中に入っている数（体の真ん中の高さ 0.6 m をカメラで写して、画面の枠の内か）
  const cam = window.__p3.camera;
  cam.updateMatrixWorld();
  const V = cam.position.constructor;
  const onScreen = near.filter((f) => { const v = new V(f.x, 0.6, f.z).project(cam); return v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1; }).length;
  return { total: near.length, by, onScreen, banners: plan.banners.filter((b) => b.x > 9 && b.x < 19 && b.z > -11 && b.z < 1).map((b) => b.mark) };
});

// ================================================================ 歩く（本物のキー。道は町の当たり判定から格子で探す：e2e/town-smoke.mjs と同じ）
function toScreen(s, tx, tz) {
  const gx = tx - s.x;
  const gz = tz - s.z;
  const d = Math.hypot(gx, gz) || 1;
  return { ix: (Math.cos(s.yaw) * gx - Math.sin(s.yaw) * gz) / d, iy: (Math.sin(s.yaw) * gx + Math.cos(s.yaw) * gz) / d, d };
}
async function walkKeys(page, tx, tz, done, maxMs = 240000) {
  const held = new Set();
  const setKeys = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  let s;
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    s = await pose(page);
    if (done(s)) break;
    const { ix, iy, d } = toScreen(s, tx, tz);
    const want = new Set();
    if (iy < -0.38) want.add('KeyW');
    if (iy > 0.38) want.add('KeyS');
    if (ix > 0.38) want.add('KeyD');
    if (ix < -0.38) want.add('KeyA');
    // 遠いときは走る（Shift）。着く前は歩く（1 コマが重いので行き過ぎないように）
    if (d > 2.5) want.add('ShiftLeft');
    await setKeys(want);
    await sleep(60);
  }
  await setKeys(new Set());
  return s;
}
const planPath = (page, tx, tz) => page.evaluate(async ([tx, tz]) => {
  const L = await import('/src/layout.ts');
  const M = await import('/src/game/motion.ts');
  const C = await import('/src/explore/cast.ts');
  const rects = [...L.colliders(), ...C.castColliders(window.__game.world.cast ?? [])];
  const R = M.HERO_RADIUS + 0.12;
  const free = (x, z) => rects.every((q) => Math.hypot(x - Math.max(q.x0, Math.min(q.x1, x)), z - Math.max(q.z0, Math.min(q.z1, z))) >= R) && x > L.BOUNDS.x0 + 0.4 && x < L.BOUNDS.x1 - 0.4 && z > L.BOUNDS.z0 + 0.4 && z < L.BOUNDS.z1 - 0.4;
  const step = 0.25;
  const B = L.BOUNDS;
  const nx = Math.round((B.x1 - B.x0) / step) + 1;
  const nz = Math.round((B.z1 - B.z0) / step) + 1;
  const ci = (x) => Math.round((x - B.x0) / step);
  const ck = (z) => Math.round((z - B.z0) / step);
  const h = window.__p3.hero;
  const start = ck(h.z) * nx + ci(h.x);
  const goal = ck(tz) * nx + ci(tx);
  if (!free(tx, tz)) return { error: `(${tx}, ${tz}) は当たり判定の中` };
  const prev = new Int32Array(nx * nz).fill(-1);
  const ok = new Int8Array(nx * nz).fill(-1);
  const isOk = (n) => {
    if (ok[n] === -1) ok[n] = free(B.x0 + (n % nx) * step, B.z0 + Math.floor(n / nx) * step) ? 1 : 0;
    return ok[n] === 1;
  };
  const q = [start];
  prev[start] = start;
  let head = 0;
  while (head < q.length) {
    const c = q[head++];
    if (c === goal) break;
    const i = c % nx;
    const k = Math.floor(c / nx);
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ii = i + di;
      const kk = k + dk;
      if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue;
      const n = kk * nx + ii;
      if (prev[n] !== -1 || (n !== goal && !isOk(n))) continue;
      prev[n] = c;
      q.push(n);
    }
  }
  if (prev[goal] === -1) return { error: '道が無い' };
  const cells = [];
  for (let c = goal; c !== start; c = prev[c]) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => [B.x0 + (c % nx) * step, B.z0 + Math.floor(c / nx) * step]);
  const see = (a, b) => {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.1);
    for (let i = 0; i <= n; i++) if (!free(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n)) return false;
    return true;
  };
  const out = [];
  let cur = [h.x, h.z];
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !see(cur, pts[j])) j--;
    out.push(pts[j]);
    cur = pts[j];
    i = j + 1;
  }
  return { path: out };
}, [tx, tz]);
async function walkTo(page, tx, tz, near = 0.5) {
  const r = await planPath(page, tx, tz);
  if (!r.path) throw new Error(`(${tx}, ${tz}) へ歩けない：${r.error}`);
  note(`道：${r.path.map(([x, z]) => `(${x.toFixed(1)}, ${z.toFixed(1)})`).join(' → ')}`);
  for (const [x, z] of r.path) {
    const last = x === r.path[r.path.length - 1][0] && z === r.path[r.path.length - 1][1];
    await walkKeys(page, x, z, (s) => Math.hypot(s.x - x, s.z - z) < (last ? near : 0.45));
  }
  // 歩きの勢いが止まるまで待つ
  await page.waitForFunction(() => window.__p3.hero.speed < 0.02, null, POLL);
  return pose(page);
}
/**
 * 本物のマウスの引きずり（見回しの面）で、見回しの向き yaw と見下ろし pitch を合わせる（game/follow.ts の look：
 * 右へ引くと yaw が減る＝右を向く、下へ引くと pitch が増える＝見下ろす。1px 0.0055 rad。px あたりの角度は引いた結果で測り直す）
 */
async function dragTo(page, wantYaw, wantPitch) {
  let perX = 0.0055;
  let perY = 0.0055;
  for (let i = 0; i < 5; i++) {
    const s = await pose(page);
    const dyaw = Math.atan2(Math.sin(wantYaw - s.yaw), Math.cos(wantYaw - s.yaw));
    const dpitch = wantPitch - s.pitch;
    if (Math.abs(dyaw) < 0.03 && Math.abs(dpitch) < 0.03) return s;
    const dx = Math.max(-380, Math.min(380, Math.round(-dyaw / perX)));
    const dy = Math.max(-160, Math.min(160, Math.round(dpitch / perY)));
    const x0 = 422 - dx / 2;
    const y0 = 195 - dy / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    const n = Math.max(4, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 30));
    for (let k = 1; k <= n; k++) await page.mouse.move(x0 + (dx * k) / n, y0 + (dy * k) / n);
    await page.mouse.up();
    await sleep(500);
    const t = await pose(page);
    const mx = Math.atan2(Math.sin(t.yaw - s.yaw), Math.cos(t.yaw - s.yaw));
    const my = t.pitch - s.pitch;
    if (Math.abs(mx) > 1e-3 && Math.abs(dx) > 5) perX = Math.abs(mx / dx);
    if (Math.abs(my) > 1e-3 && Math.abs(dy) > 5) perY = Math.abs(my / dy);
    note(`見回し：引きずり (${dx}, ${dy})px で yaw ${s.yaw.toFixed(3)} → ${t.yaw.toFixed(3)}・pitch ${s.pitch.toFixed(3)} → ${t.pitch.toFixed(3)}`);
  }
  return pose(page);
}

// ================================================================ 1 つの状態
async function one(name) {
  const isStart = name === 'ch1start';
  console.log(`=== ${name}：${isStart ? 'タイトルの「はじめから」→ 導入をスキップ → 城下（第一章の始め）' : '第一章の結末の保存（直接状態変更）→「つづきから」→「第二章へ進む」→ 演出をスキップ → 結果確認 →「城下へ」'}（844×390・描画あり ?q=low）`);
  const { ctx, page } = await open(isStart ? null : fixture(name));
  await sleep(600);
  if (isStart) {
    await page.click('.g-scn[data-scenario="ieyasu1570"] .g-btn[data-id="new:ieyasu1570"]');
    await skipCinematic(page, { what: '第一章の導入', log: note });
  } else {
    await page.click('.g-btn[data-id="continue:ieyasu1570"]');
    await page.waitForFunction(() => window.__game.ui?.kind === 'ending', null, POLL);
    await sleep(800);
    await page.click('.g-btn[data-id="next_chapter"]');
    await skipCinematic(page, { what: '第二章への移行', log: note });
    await page.waitForFunction(() => window.__game.ui?.kind === 'record', null, POLL);
    await sleep(800);
    await page.click('.g-btn[data-id="to_town"]');
  }
  await waitExplore(page);
  await waitModels(page);
  const st = await page.evaluate(() => ({ chapter: window.__game.state?.chapter ?? 1, phase: window.__game.state?.phase, policy: window.__game.state?.policy ?? null, troops: window.__game.state?.troops }));
  check(`[${name}] 城下に着いた（本物の入力。${isStart ? '第一章の始め' : '第二章の城下'}）`, isStart ? st.chapter !== 2 : st.chapter === 2, J(st));
  await sleep(2500);
  const a0 = await ambient(page);
  note(`[${name}] 着いた時の町の人々：${J(a0)}`);
  await page.screenshot({ path: `${OUT}/${name}-arrive.png`, timeout: 600000 });
  note(`[${name}] 撮影 ${name}-arrive.png（開始の位置）`);
  // 本物のキーで詰所の前へ歩く
  const t0 = Date.now();
  const p = await walkTo(page, STAND.x, STAND.z, 0.45);
  check(`[${name}] 本物のキー（W・A・S・D・Shift）で歩いて詰所の前 (${STAND.x}, ${STAND.z}) に着く（描画あり）`, Math.hypot(p.x - STAND.x, p.z - STAND.z) < 0.6, `(${p.x.toFixed(2)}, ${p.z.toFixed(2)})・${((Date.now() - t0) / 1000).toFixed(0)} 秒`);
  // 本物の引きずりで詰所へ向き、少し見下ろす（前の向き (−sin yaw, −cos yaw) が詰所の方へ）
  const want = Math.atan2(-(LOOK_AT.x - p.x), -(LOOK_AT.z - p.z));
  const q = await dragTo(page, want, PITCH);
  check(`[${name}] 本物のマウスの引きずりで詰所の方へ向き、見下ろす（yaw ${want.toFixed(3)}・pitch ${PITCH}）`, Math.abs(Math.atan2(Math.sin(want - q.yaw), Math.cos(want - q.yaw))) < 0.06 && Math.abs(q.pitch - PITCH) < 0.06, `yaw ${q.yaw.toFixed(3)}・pitch ${q.pitch.toFixed(3)}`);
  // 描いたコマが向きに追いつくまで待ってから撮る（このコンテナは 1 コマ 1 秒前後）
  await sleep(3000);
  const a1 = await ambient(page);
  const near = await guardpostFigures(page);
  const cam = await page.evaluate(() => { const c = window.__p3.camera.position; return [c.x, c.y, c.z].map((v) => +v.toFixed(2)); });
  await page.screenshot({ path: `${OUT}/${name}-guardpost.png`, timeout: 600000 });
  const a2 = await ambient(page);
  note(`[${name}] 撮影 ${name}-guardpost.png（主人公 (${q.x.toFixed(2)}, ${q.z.toFixed(2)})・yaw ${q.yaw.toFixed(3)}・カメラ ${J(cam)}）`);
  note(`[${name}] ambientProbe：設定 ${J(a1.groups)}・兵の形 ${a1.figures}（詰所のまわり ${near.total} ${J(near.by)}・そのうち画面の中 ${near.onScreen}・のぼり ${J(near.banners)}）・描いた兵の形 ${a1.figuresDrawn}→${a2.figuresDrawn}・描いた人 ${a1.peopleDrawn}→${a2.peopleDrawn}`);
  const w = await page.evaluate(() => Object.keys(localStorage).sort());
  await ctx.close();
  return { name, state: st, arrive: a0, facing: a1, after: a2, guardpost: near, hero: { x: q.x, z: q.z, yaw: q.yaw, pitch: q.pitch }, cam, keys: w };
}

const results = {};
try {
  for (const name of STATES) {
    const t = Date.now();
    results[name] = await one(name);
    note(`${name}：実時間 ${((Date.now() - t) / 1000).toFixed(0)} 秒`);
  }
  const r = results;
  const cnt = (x, k) => (x?.groups ?? []).filter((g) => g.kind === k).reduce((n, g) => n + g.count, 0);
  // 描いた兵の形（ambientProbe の figuresDrawn）は、詰所の兵と、画面の端に入ることのある城門の門番（2）を合わせた数
  const base = r.ch1start?.facing.figuresDrawn ?? 0;
  if (r.ch1start) {
    check('第一章の始め：町の人々に負傷兵・援兵が無い（設定 0・詰所のまわりの兵の形 0。描いた兵の形は城門の門番だけ）',
      cnt(r.ch1start.facing, 'wounded') === 0 && cnt(r.ch1start.facing, 'reinforcement') === 0 && r.ch1start.guardpost.total === 0 && r.ch1start.facing.figuresDrawn <= cnt(r.ch1start.facing, 'guard'),
      J({ groups: r.ch1start.facing.groups, near: r.ch1start.guardpost, drawn: r.ch1start.facing.figuresDrawn }));
  }
  if (r.oda_victory_kept) {
    const x = r.oda_victory_kept;
    check('A 勝ち・約束を守った → 第二章の城下：詰所に負傷兵と織田の援兵（旗 織）がいて、詰所を向いた画の中に入り、描いている（描いた兵の形が第一章の始めより多い）',
      cnt(x.facing, 'wounded') > 0 && cnt(x.facing, 'reinforcement') > 0 && x.guardpost.banners.includes('織') && x.guardpost.onScreen > 0 && x.facing.figuresDrawn > base,
      J({ groups: x.facing.groups, near: x.guardpost, drawn: x.facing.figuresDrawn, base }));
  }
  if (r.home_defeat_broken_heavy) {
    const x = r.home_defeat_broken_heavy;
    check('C 負け・約束を破った・損害大 → 第二章の城下：負傷兵が多く援兵は無い・詰所を向いた画の中に入り、描いている',
      cnt(x.facing, 'wounded') > 0 && cnt(x.facing, 'reinforcement') === 0 && x.guardpost.onScreen > 0 && x.facing.figuresDrawn > base && (!r.oda_victory_kept || cnt(x.facing, 'wounded') > cnt(r.oda_victory_kept.facing, 'wounded')),
      J({ groups: x.facing.groups, near: x.guardpost, drawn: x.facing.figuresDrawn, base }));
  }
} catch (e) {
  failed++;
  console.log('NG 途中で止まった：', e.stack || e.message);
}
writeFileSync(`${OUT}/ambient.json`, J(results, null, 1));
check('ページの誤りなし', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n結果：OK ${oks}・NG ${failed}（${secs()}）。画：${OUT}`);
process.exit(failed ? 1 : 0);
