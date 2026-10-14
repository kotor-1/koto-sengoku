/**
 * 出来事の後のカメラ（Version 28 §4.1・§4.3）：出来事の前にプレイヤーが向けていた見回しの向き・高さ・距離へ戻るか、なめらかに戻るか。
 * 開発の画面（?q=low&render=manual。描かない）で、本物の入力だけで進める：
 *   「はじめから」→ 冒頭をスキップ → マウスの引きずりで見回す → HUD の「情勢」→「冒頭を見直す」（replay:ch1_open）→ 少し見て「スキップ」
 *   → 情勢の画面へ戻る → 「閉じる」→ 城下。見回しの向き（orbit）と、カメラの毎コマの位置を記録する。
 *   BASE3D=http://localhost:8781 node e2e/camera-restore.mjs <出力フォルダ> [ラベル]
 * 判定：見直しの後の orbit（yaw・pitch）が見直しの前と同じ。カメラは 1 コマで 0.6 m 以上飛ばない（なめらかに戻る。間に物があれば切り替えてよいので、その時は記録だけ）。
 */
import { writeFileSync } from 'node:fs';
import { launchBrowser, outDir } from './lib.mjs';

const BASE3D = process.env.BASE3D || 'http://localhost:8781';
const out = outDir(process.argv[2]);
const label = process.argv[3] || 'camera';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => JSON.stringify(v);

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(600000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE3D}/?q=low&render=manual`);
await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, { timeout: 600000, polling: 250 });
// 毎コマのカメラの位置（ゲームの毎コマの後）
await page.evaluate(() => {
    const p3 = window.__p3;
    const P = (window.__cam = { on: false, rows: [] });
    const tick = () => {
        if (P.on) {
            const c = p3.camera.position;
            P.rows.push({ t: performance.now(), x: c.x, y: c.y, z: c.z, yaw: p3.orbit.yaw, pitch: p3.orbit.pitch, dist: p3.orbit.dist, screen: window.__game.screen });
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
});
const orbit = () => page.evaluate(() => ({ ...window.__p3.orbit, heading: window.__p3.hero.heading }));
const skip = async () => {
    const sel = '.g-layer[data-kind="cine"]';
    await page.locator(sel).waitFor({ state: 'attached' });
    await sleep(1500);
    await page.locator(`${sel} .g-cine-btn[data-id="skip"]`).click();
    await page.locator(sel).waitFor({ state: 'detached' });
};

await page.locator('.g-btn[data-id="new:ieyasu1570"]').click();
await skip();
await page.waitForFunction(() => window.__game.screen === 'explore', null, { polling: 100 });
await sleep(800);
const start = await orbit();
// 見回す（本物のマウスの引きずり：右へ 180px・下へ 40px）
await page.mouse.move(700, 360);
await page.mouse.down();
for (let i = 1; i <= 12; i++) await page.mouse.move(700 - 15 * i, 360 + (40 * i) / 12);
await page.mouse.up();
await sleep(600);
const before = await orbit();
// 情勢 → 冒頭を見直す
await page.locator('.g-sit-btn').click();
await page.locator('.g-layer[data-kind="situation"]').waitFor({ state: 'attached' });
await sleep(400);
await page.locator('.g-layer[data-kind="situation"] .g-btn[data-id="replay:ch1_open"]').click();
await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'attached' });
await sleep(2500);
const during = await page.evaluate(() => ({ shot: !!window.__game.world.cameraShot, orbit: { ...window.__p3.orbit } }));
await page.locator('.g-layer[data-kind="cine"] .g-cine-btn[data-id="skip"]').click();
await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached' });
await page.locator('.g-layer[data-kind="situation"]').waitFor({ state: 'attached' });
const afterReplay = await orbit();
await sleep(400);
await page.evaluate(() => {
    window.__cam.rows = [];
    window.__cam.on = true;
});
await page.locator('.g-layer[data-kind="situation"] .g-btn[data-id="close"]').click();
await page.waitForFunction(() => window.__game.screen === 'explore', null, { polling: 100 });
await sleep(1800);
const rows = await page.evaluate(() => {
    window.__cam.on = false;
    return window.__cam.rows.filter((r) => r.screen === 'explore');
});
const after = await orbit();
let maxStep = 0;
for (let i = 1; i < rows.length; i++) maxStep = Math.max(maxStep, Math.hypot(rows[i].x - rows[i - 1].x, rows[i].y - rows[i - 1].y, rows[i].z - rows[i - 1].z));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const same = Math.abs(wrap(after.yaw - before.yaw)) < 1e-3 && Math.abs(after.pitch - before.pitch) < 1e-3;
const res = {
    label,
    start,
    before,
    during,
    afterReplay,
    after,
    restored: same,
    behindHero: Math.abs(wrap(after.yaw - (after.heading - Math.PI))) < 1e-3,
    frames: rows.length,
    maxCameraStepM: Math.round(maxStep * 1000) / 1000,
    firstLast: rows.length ? [rows[0], rows[rows.length - 1]] : null,
    errors,
};
writeFileSync(`${out}/camera-${label}.json`, J(res));
console.log(J({ restored: res.restored, behindHero: res.behindHero, before: [before.yaw, before.pitch], after: [after.yaw, after.pitch], maxCameraStepM: res.maxCameraStepM, frames: rows.length, errors }));
await browser.close();
