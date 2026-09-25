// 3D 比較版のブラウザ確認と録画。本物のキー入力・タッチで動かす。
//   - 読み込み（GLB 6 つ）・WebGL の描画・エラーなし
//   - 歩く（歩きの動きに切り替わる）・止まる（待機に戻る）・向きを変える（待たずに進みながら向き直る）
//   - 家の横の路地を通り抜ける（家の壁に沿って滑る）
//   - タッチのスティックで歩き、指を離すと止まる／フォーカスが外れると止まる
// 録画は e2e/proto3d-video.mjs（1 コマずつ描いてつなぐ）。
// 使い方: npm run proto3d:dev を起動しておき、node e2e/proto3d.mjs [出力先]
// 注意：検証コンテナはソフトウェア描画で、画質「低」・小さな画面でも 2〜5fps しか出ない。
//   1 フレームの時間は 0.1 秒で切り詰めるので、ゲームの中の時間は実時間よりゆっくり進む。
//   そのため「決まった時間待つ」ではなく「条件がそろうまで待つ」で確かめる。実機の速さはここでは分からない。
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
const state = (page) => page.evaluate(() => {
  const p = window.__p3;
  return { x: p.hero.x, z: p.hero.z, heading: p.hero.heading, speed: p.hero.speed, ...p.anim };
});
const waitFor = (page, fn, arg, timeout = 90000) => page.waitForFunction(fn, arg, { timeout, polling: 50 }).then(() => true, () => false);
const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

async function open(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/?fps&q=low&view=top');
  const ok = await waitFor(page, () => window.__p3?.stats.readyMs > 0, null, 90000);
  return { ctx, page, ok };
}

// ---------------- PC（キーボード） ----------------
{
  const { ctx, page, ok } = await open({ viewport: { width: 800, height: 450 } });
  const info = await page.evaluate(() => {
    const r = window.__p3.renderer;
    return { gl: r.getContext() instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1', calls: r.info.render.calls, tris: r.info.render.triangles, loadMs: window.__p3.stats.loadMs };
  });
  check('3D の画面が表示され、GLB の素材 6 つを読み込めた', ok && info.calls > 20, `${info.gl}・描画命令 ${info.calls}・三角形 ${info.tris}・読み込み ${info.loadMs}ms`);
  await page.waitForTimeout(1200); // 待機の姿
  const s0 = await state(page);
  check('初めは止まっていて、待機の動き', s0.speed === 0 && s0.walkBlend < 0.05);
  await page.screenshot({ path: `${S}/p3-pc-idle.png` });

  // 城門へ歩く（↑）
  await page.keyboard.down('ArrowUp');
  const walking = await waitFor(page, () => window.__p3.hero.speed > 1.2 && window.__p3.anim.walkBlend > 0.8);
  const w0 = (await state(page)).strideTotal;
  await waitFor(page, (z0) => window.__p3.hero.z < z0 - 1.5, s0.z);
  const s1 = await state(page);
  await page.screenshot({ path: `${S}/p3-pc-walk.png` });
  await page.keyboard.up('ArrowUp');
  check('↑ で奥（城門の方）へ歩き、歩きの動きに切り替わる', walking && s1.z < s0.z - 1, `z ${s0.z.toFixed(2)} → ${s1.z.toFixed(2)}・歩きの重み ${s1.walkBlend.toFixed(2)}`);
  // 止まる
  const stopped = await waitFor(page, () => window.__p3.hero.speed === 0);
  await waitFor(page, () => window.__p3.anim.walkBlend < 0.1);
  const s2 = await state(page);
  await page.waitForTimeout(1500);
  const s3 = await state(page);
  check('キーを離すと止まり、待機の動きに戻る（その場から動かない）', stopped && s2.walkBlend < 0.1 && s2.x === s3.x && s2.z === s3.z, `歩きの重み ${s2.walkBlend.toFixed(2)}`);
  // 再生位置は 1 周ごとに戻るので、進めた周期の合計で見る
  check('歩いている間、歩きの動きが再生されていた（再生位置が進んだ）', s1.strideTotal - w0 > 0.3, `${(s1.strideTotal - w0).toFixed(2)} 周期`);

  // 切り返して戻る（↓）：向き直るのを待たずに手前へ進み、進みながら向き直る
  const h0 = s3.heading;
  await page.keyboard.down('ArrowDown');
  await waitFor(page, (z) => window.__p3.hero.z > z + 0.02, s3.z);
  const t1 = await state(page);
  await waitFor(page, (h0) => Math.abs(Math.atan2(Math.sin(window.__p3.hero.heading - h0), Math.cos(window.__p3.hero.heading - h0))) > 2.8, h0);
  await waitFor(page, (z) => window.__p3.hero.z > z + 0.8, s3.z);
  const t2 = await state(page);
  await page.screenshot({ path: `${S}/p3-pc-turn.png` });
  await page.keyboard.up('ArrowDown');
  // 「向き直るのを待たずに進む」ことは、ここでは確かめられない（検証コンテナは数 fps で、1 コマに最大 0.1 秒進むため、
  // 1〜2 コマで体の向きがほぼ変わり終わる）。1/30 秒ずつ進める e2e/proto3d-directions.mjs で確かめる
  check('↓ で手前へ歩き、体も手前へ向き直る', angleDiff(t2.heading, h0) > 2.8 && t2.z > s3.z + 0.5, `進み出した時の体の向き ${(angleDiff(t1.heading, h0) * 180 / Math.PI).toFixed(0)}°・最後 ${(angleDiff(t2.heading, h0) * 180 / Math.PI).toFixed(0)}°`);
  await waitFor(page, () => window.__p3.hero.speed === 0);

  // 家の横を通る：家の北東の角の外から、←（西寄り）で歩く。家の北の壁に沿って滑り、裏まで抜ける
  await page.evaluate(() => { const h = window.__p3.hero; h.x = -3.0; h.z = -7.2; h.heading = -1.2; });
  await page.waitForTimeout(500);
  await page.keyboard.down('ArrowLeft');
  // 路地の途中（家の裏にいてカメラから隠れる所）では、家が半透明になる
  await waitFor(page, () => window.__p3.hero.x < -6.5, null, 180000);
  const faded = await waitFor(page, () => window.__p3.fade[1] < 0.5);
  const mid = await state(page); // 家の横（x が家の範囲の中ほど）での位置
  await page.screenshot({ path: `${S}/p3-pc-behind-house.png` });
  check('家の裏（カメラから隠れる所）では家が半透明になり、主人公が見える', faded, `透明度 ${JSON.stringify(await page.evaluate(() => window.__p3.fade))}（城門・町家・松・広葉樹）`);
  const passed = await waitFor(page, () => window.__p3.hero.x < -10.6, null, 180000);
  const along = await state(page);
  await page.screenshot({ path: `${S}/p3-pc-beside-house.png` });
  await page.keyboard.up('ArrowLeft');
  check('家の横（北側の路地）を通って裏まで抜けられ、家には入り込まない', passed && mid.z < -5.6 - 0.2 && along.x < -10.6, `家の横 (${mid.x.toFixed(1)}, ${mid.z.toFixed(2)}) → 抜けた所 (${along.x.toFixed(1)}, ${along.z.toFixed(1)})`);
  await waitFor(page, () => window.__p3.hero.speed === 0);

  // 家の表へ向かって歩いても、めり込まない
  await page.evaluate(() => { const h = window.__p3.hero; h.x = -2.6; h.z = -1.5; h.heading = -1.57; });
  await page.keyboard.down('ArrowLeft');
  // 壁に着くまで（x がほぼ変わらなくなるまで）待つ
  await waitFor(page, () => window.__p3.hero.x < -3.5);
  await page.waitForTimeout(3000);
  const wall = await state(page);
  await page.keyboard.up('ArrowLeft');
  check('家の表に向かって歩いても、壁で止まる（めり込まない）', wall.x > -4.2 + 0.2, `x ${wall.x.toFixed(2)}`);

  // フォーカスが外れたら止まる
  await page.keyboard.down('ArrowUp');
  await waitFor(page, () => window.__p3.hero.speed > 0.5);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const blurStop = await waitFor(page, () => window.__p3.hero.speed === 0);
  await page.keyboard.up('ArrowUp');
  check('ウィンドウのフォーカスが外れると、キーを押したままでも止まる', blurStop);

  await ctx.close();
}

// ---------------- スマホ相当（タッチ） ----------------
{
  const { ctx, page, ok } = await open({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })) });
  check('スマホ相当：3D の画面が表示される', ok);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${S}/p3-phone-idle.png` });
  const a = await state(page);
  await touch('touchStart', [[150, 280, 1]]);
  await touch('touchMove', [[150, 230, 1]]);
  const moving = await waitFor(page, () => window.__p3.hero.speed > 0.8);
  await waitFor(page, (z) => window.__p3.hero.z < z - 0.8, a.z);
  const b = await state(page);
  await page.screenshot({ path: `${S}/p3-phone-walk.png` });
  await touch('touchEnd', []);
  const stop = await waitFor(page, () => window.__p3.hero.speed === 0);
  check('スマホ相当：スティックを上へ倒すと奥へ歩き、指を離すと止まる', moving && stop && b.z < a.z - 0.5, `z ${a.z.toFixed(2)} → ${b.z.toFixed(2)}`);
  check('スマホ相当：ページがスクロールしない', JSON.stringify(await page.evaluate(() => [scrollX, scrollY])) === '[0,0]');
  await ctx.close();
}

console.log('errors:', JSON.stringify(errors));
if (errors.length) failed++;
console.log(failed ? `NG が ${failed} 件` : 'すべて OK');
await browser.close();
process.exit(failed ? 1 : 0);
