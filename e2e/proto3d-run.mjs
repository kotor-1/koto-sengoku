// 3D 比較版：歩く／走るの切り替えを、本物のキー入力・クリック・タッチで確かめる。
//   - ボタン（タップ・クリック）で切り替わり、押し続けなくてよい。スティックを動かしながら別の指で押せる
//   - Shift を押している間だけ走り、離すとボタンで選んだ方に戻る
//   - 走っても壁や門をすり抜けない・斜めだけ速くならない・離すとすぐ止まる
//   - 画面を離れる（フォーカスが外れる・アプリを切り替える）と移動と Shift が解除され、戻っても勝手に動かない
//   - 歩き・走り・止まる所の人物の姿（近づけたカメラ）
// 検証コンテナはソフトウェア描画で遅いので、ゲームの時間は 1/30 秒ずつ決まった量だけ進める（入力は本物のまま）。
// 使い方: npm run proto3d:dev を起動しておき、node e2e/proto3d-run.mjs [出力先]
// 出力：p3run-*.png と p3run.png（人物の姿のまとめ）
import { readFileSync } from 'node:fs';
import { launchBrowser, outDir } from './lib.mjs';

const S = outDir(process.argv[2]);
const BASE = process.env.BASE3D || 'http://localhost:8090';
const browser = await launchBrowser();
let failed = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}`);
};
const errors = [];

async function open(opts, query = '?q=low') {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/' + query);
  await page.waitForFunction(() => window.__p3?.stats.readyMs > 0, null, { timeout: 180000 });
  await page.evaluate(() => window.__p3.manual());
  return { ctx, page };
}
const put = (page, x, z, heading = Math.PI) => page.evaluate(([x, z, heading]) => {
  const p = window.__p3;
  Object.assign(p.hero, { x, z, heading, speed: 0, dirX: Math.sin(heading), dirZ: Math.cos(heading) });
  for (let i = 0; i < 40; i++) p.step(1 / 30, 0, 0);
}, [x, z, heading]);
const stepN = (page, n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.__p3.stepInput(1 / 30); }, n);
const st = (page) => page.evaluate(() => {
  const p = window.__p3;
  const b = document.getElementById('run-btn');
  return { x: p.hero.x, z: p.hero.z, speed: p.hero.speed, ...p.anim, btnOn: b.classList.contains('on'), pressed: b.getAttribute('aria-pressed') };
});
const f2 = (v) => v.toFixed(2);
const WALK = 1.55;
const RUN = 1.55 * 2.2;

// ---------------- PC ----------------
{
  const { ctx, page } = await open({});
  const box = await page.locator('#run-btn').boundingBox();
  const s0 = await st(page);
  check('ボタンが右下に出ていて、初めは「歩く」', box && box.x > 960 / 2 && box.y > 540 / 2 && !s0.runMode && !s0.btnOn, `位置 (${Math.round(box.x)}, ${Math.round(box.y)}) 大きさ ${Math.round(box.width)}×${Math.round(box.height)}`);

  await put(page, 7, 0);
  await page.keyboard.down('ArrowRight');
  await stepN(page, 45);
  const w = await st(page);
  check('歩き：速さはこれまでと同じ（1.55m/秒）、走りの動きは混ざらない', Math.abs(w.speed - WALK) < 1e-6 && w.runBlend === 0, `速さ ${f2(w.speed)}・走りの重み ${f2(w.runBlend)}`);

  // Shift を押している間だけ走る
  await page.keyboard.down('Shift');
  await stepN(page, 30);
  const r = await st(page);
  await page.screenshot({ path: `${S}/p3run-shift.png`, timeout: 300000 });
  check('Shift を押している間は走る（歩きの 2.2 倍）。ボタンも「走る」側が明るくなる', Math.abs(r.speed - RUN) < 1e-6 && r.runBlend === 1 && r.btnOn && !r.runMode, `速さ ${f2(r.speed)}・走りの重み ${f2(r.runBlend)}`);
  await page.keyboard.up('Shift');
  await stepN(page, 1);
  const r1 = await st(page);
  await stepN(page, 10);
  const r2 = await st(page);
  check('Shift を離すと、ボタンで選んでいる「歩く」に戻る（なめらかに減速）', r1.speed < RUN && r1.speed > WALK && Math.abs(r2.speed - WALK) < 1e-6 && !r2.btnOn, `離した直後 ${f2(r1.speed)} → 0.33 秒後 ${f2(r2.speed)}`);
  await page.keyboard.up('ArrowRight');
  await stepN(page, 15);

  // ボタンをクリック：押し続けなくても走る
  await page.click('#run-btn');
  const c1 = await st(page);
  await put(page, 7, 0);
  await page.keyboard.down('ArrowRight');
  await stepN(page, 45);
  const c2 = await st(page);
  check('ボタンをクリックすると「走る」になり、キーだけで走り続ける', c1.runMode && c1.pressed === 'true' && c2.btnOn && Math.abs(c2.speed - RUN) < 1e-6, `速さ ${f2(c2.speed)}`);
  await page.keyboard.down('Shift');
  await stepN(page, 5);
  await page.keyboard.up('Shift');
  await stepN(page, 10);
  const c3 = await st(page);
  check('「走る」を選んでいるときは、Shift を押して離しても走ったまま', c3.runMode && Math.abs(c3.speed - RUN) < 1e-6);

  // 離すとすぐ止まる
  const z0 = await st(page);
  await page.keyboard.up('ArrowRight');
  await stepN(page, 9); // 0.3 秒
  const z1 = await st(page);
  await stepN(page, 30);
  const z2 = await st(page);
  // 止まった後は脚の位相も止まり（足が滑らない）、1 秒で待機の姿に戻る
  check('走っていても、キーを離すと 0.3 秒で止まり、その後は動かない（脚も止まって待機に戻る）', z1.speed === 0 && z1.x === z2.x && z1.stride === z2.stride && z2.walkBlend < 0.01, `止まるまでに ${f2(z1.x - z0.x)}m・動きの重み ${f2(z1.walkBlend)} → ${f2(z2.walkBlend)}`);

  // 斜めだけ速くならない（走り）
  const dist = async (keys) => {
    await put(page, 7, 0);
    for (const k of keys) await page.keyboard.down(k);
    await stepN(page, 30);
    const a = await st(page);
    await stepN(page, 30);
    const b = await st(page);
    for (const k of keys) await page.keyboard.up(k);
    await stepN(page, 15);
    return Math.hypot(b.x - a.x, b.z - a.z);
  };
  const dStraight = await dist(['ArrowUp']);
  const dDiag = await dist(['ArrowUp', 'ArrowRight']);
  check('走り：斜め（2 つのキー）でも、1 秒に進む距離はまっすぐと同じ', Math.abs(dDiag - dStraight) < 0.01, `まっすぐ ${f2(dStraight)}m・斜め ${f2(dDiag)}m`);

  // 壁・門
  await put(page, -2.2, -1.5);
  await page.keyboard.down('ArrowLeft');
  await stepN(page, 60);
  const hw = await st(page);
  await page.keyboard.up('ArrowLeft');
  check('走っても家の表の壁で止まる（すり抜けない）', hw.x > -4.2 + 0.25 + 0.27, `x ${f2(hw.x)}（壁の外側 ${f2(-4.2 + 0.25 + 0.28)}）`);
  await put(page, 5, -8);
  await page.keyboard.down('ArrowUp');
  await stepN(page, 45);
  const ww = await st(page);
  await page.keyboard.up('ArrowUp');
  check('走っても土塀を越えない', ww.z > -12, `z ${f2(ww.z)}（塀は z=-12）`);
  await put(page, 0, -7);
  await page.keyboard.down('ArrowUp');
  await stepN(page, 90);
  const gw = await st(page);
  await page.screenshot({ path: `${S}/p3run-gate.png`, timeout: 300000 });
  await page.keyboard.up('ArrowUp');
  check('走って城門を通り抜けられる', gw.z < -15, `z ${f2(gw.z)}`);

  // 画面を離れると解除（Shift とキーを押したまま）
  await page.click('#run-btn'); // 「歩く」に戻す
  await put(page, 7, 0);
  await page.keyboard.down('Shift');
  await page.keyboard.down('ArrowRight');
  await stepN(page, 30);
  const b0 = await st(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await stepN(page, 12);
  const b1 = await st(page);
  await stepN(page, 30);
  const b2 = await st(page);
  check('フォーカスが外れると、キーと Shift を押したままでも止まり、戻っても勝手に動かない', b0.running && b1.speed === 0 && !b1.running && b1.x === b2.x && !b2.btnOn, `外れる前 走り ${b0.running}・後 走り ${b1.running}`);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('Shift');
  // アプリの切り替え（ページが隠れる → 戻る）
  await put(page, 7, 0);
  await page.keyboard.down('Shift');
  await page.keyboard.down('ArrowRight');
  await stepN(page, 20);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await stepN(page, 12);
  const v1 = await st(page);
  await stepN(page, 30);
  const v2 = await st(page);
  check('アプリを切り替えると移動と Shift が解除され、戻っても勝手に動き出さない', v1.speed === 0 && !v1.running && v1.x === v2.x);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('Shift');
  await ctx.close();
}

// ---------------- スマホ相当（2 本の指） ----------------
{
  const { ctx, page } = await open({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })) });
  const box = await page.locator('#run-btn').boundingBox();
  const btn = [box.x + box.width / 2, box.y + box.height / 2];
  const zone = await page.locator('#stick-zone').boundingBox();
  check('スマホ：ボタンは指で押しやすい大きさで、スティックの範囲（左半分）と重ならない', box.height >= 44 && box.x > zone.x + zone.width, `ボタン ${Math.round(box.width)}×${Math.round(box.height)}px`);
  await page.screenshot({ path: `${S}/p3run-phone.png`, timeout: 300000 });

  await put(page, 7, 0);
  const A = [150, 300];
  const A2 = [150 + 70, 300]; // 右へいっぱい
  await touch('touchStart', [[...A, 1]]);
  await touch('touchMove', [[...A2, 1]]);
  await stepN(page, 45);
  const t0 = await st(page);
  // 別の指でボタンをタップ（スティックの指は置いたまま）
  await touch('touchStart', [[...A2, 1], [...btn, 2]]);
  await touch('touchEnd', [[...btn, 2]]); // 2 本目だけ離す（CDP は離した指を渡す）
  await stepN(page, 30);
  const t1 = await st(page);
  await page.screenshot({ path: `${S}/p3run-phone-run.png`, timeout: 300000 });
  check('スマホ：スティックで歩きながら、別の指のタップで「走る」に切り替わり、指を離しても走り続ける', Math.abs(t0.speed - WALK) < 1e-6 && t1.runMode && Math.abs(t1.speed - RUN) < 1e-6 && t1.x > t0.x, `歩き ${f2(t0.speed)} → 走り ${f2(t1.speed)}`);
  await touch('touchStart', [[...A2, 1], [...btn, 2]]);
  await touch('touchEnd', [[...btn, 2]]);
  await stepN(page, 15);
  const t2 = await st(page);
  check('スマホ：もう一度タップすると「歩く」に戻る（スティックは動かしたまま）', !t2.runMode && Math.abs(t2.speed - WALK) < 1e-6);
  await touch('touchEnd', [[...A2, 1]]);
  await stepN(page, 9);
  const t3 = await st(page);
  check('スマホ：スティックの指を離すと 0.3 秒で止まる', t3.speed === 0);
  check('スマホ：ページがスクロールしない', JSON.stringify(await page.evaluate(() => [scrollX, scrollY])) === '[0,0]');
  await ctx.close();
}

// ---------------- 人物の姿（近づけたカメラ・同じ場所・同じ昼） ----------------
{
  const { ctx, page } = await open({ viewport: { width: 640, height: 480 } }, '?q=low&zoom=0.2');
  const shots = [];
  const snap = async (file, label) => {
    await page.screenshot({ path: `${S}/${file}`, timeout: 300000 });
    shots.push([file, label]);
  };
  // 横から見るため、東へ（画面の右へ）動かす
  await put(page, 5, 0, Math.PI / 2);
  await snap('p3run-pose-idle.png', '止まっている');
  await page.keyboard.down('ArrowRight');
  await stepN(page, 45);
  for (let i = 0; i < 2; i++) {
    await snap(`p3run-pose-walk${i}.png`, `歩き（位相 ${f2((await st(page)).stride)}）`);
    await stepN(page, 8);
  }
  await page.keyboard.down('Shift');
  await stepN(page, 30);
  for (let i = 0; i < 4; i++) {
    await snap(`p3run-pose-run${i}.png`, `走り（位相 ${f2((await st(page)).stride)}）`);
    await stepN(page, 3);
  }
  await page.keyboard.up('Shift');
  await page.keyboard.up('ArrowRight');
  await stepN(page, 4);
  await snap('p3run-pose-stopping.png', '離して 0.13 秒（止まる途中）');
  await stepN(page, 20);
  await snap('p3run-pose-stopped.png', '止まった');
  await ctx.close();
  const img = (f) => `data:image/png;base64,${readFileSync(`${S}/${f}`).toString('base64')}`;
  const sheet = await browser.newPage({ viewport: { width: 1400, height: 800 } });
  await sheet.setContent(`<body style="margin:0;background:#15130f;color:#eee7d6;font:14px sans-serif"><div style="display:grid;grid-template-columns:repeat(5,264px);gap:10px;padding:12px">
${shots.map(([f, l]) => `<div><div style="margin:0 0 4px">${l}</div><img src="${img(f)}" style="width:264px;border-radius:4px"></div>`).join('')}</div></body>`);
  await sheet.screenshot({ path: `${S}/p3run.png`, fullPage: true });
}

console.log('errors:', JSON.stringify(errors));
if (errors.length) failed++;
console.log(failed ? `NG が ${failed} 件` : 'すべて OK');
await browser.close();
process.exit(failed ? 1 : 0);
