/**
 * ブラウザ確認スクリプトの共通部分。
 * - Chromium の場所：環境変数 CHROMIUM_PATH → クラウドの検証コンテナの既定 → Playwright の既定（Mac なら `npx playwright-core install chromium` で入る）
 * - 確認先：環境変数 BASE（既定 http://localhost:8080）
 * 注意：ここで測る fps は実機の性能ではない（コンテナはソフトウェア描画）。
 */
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const CONTAINER_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export const BASE = process.env.BASE || 'http://localhost:8080';

export function launchBrowser() {
    const executablePath = process.env.CHROMIUM_PATH || (existsSync(CONTAINER_CHROME) ? CONTAINER_CHROME : undefined);
    const args = executablePath === CONTAINER_CHROME ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : [];
    return chromium.launch({ executablePath, args });
}

/** スクリーンショットの出力先（なければ作る） */
export function outDir(dir) {
    const d = dir || 'e2e-out';
    mkdirSync(d, { recursive: true });
    return d;
}

/**
 * 物語の演出（層 `.g-layer[data-kind="cine"]`。章の冒頭・情勢の図解の見直し・出陣・帰還）が出るのを待ち、
 * 「スキップ」のボタンを本物の入力（クリック。tap なら Playwright のタップ）で押して、層が閉じるまで待つ。
 * - 押し始めの守り（350ms）があるので、出てから 0.5 秒待ってから押す。
 * - 演出そのものの確かめ（中身・通常速度）は飛ばすので、出力に「スキップした」と書く（演出の確かめは e2e/story-*.mjs・town-smoke.mjs）。
 * - 開発用のフック（__game）を使わないので、本番ビルドの e2e でも同じに使える。
 * 返り：台本の id（層の data-cine。例 'ch1_open'）。
 */
export async function skipCinematic(page, { tap = false, what = '', timeout = 600000, log = (t) => console.log(`   ${t}`) } = {}) {
    const sel = '.g-layer[data-kind="cine"]';
    await page.locator(sel).waitFor({ state: 'attached', timeout });
    const id = await page.locator(sel).getAttribute('data-cine');
    await new Promise((r) => setTimeout(r, 500));
    const btn = page.locator(`${sel} .g-cine-btn[data-id="skip"]`);
    if (tap) await btn.tap();
    else await btn.click();
    await page.locator(sel).waitFor({ state: 'detached', timeout });
    log(`演出「${id}」${what ? `（${what}）` : ''}をスキップした（本物の入力：「スキップ」を${tap ? 'タップ' : 'クリック'}。演出そのものの確かめはここでは飛ばす）`);
    return id;
}

/**
 * Version 28 §4.3：第一章の「はじめから」の後、使者 2 人は町に居ない。主人公が通りを北へ進んで線（z≈6）を越えると、
 * 「はじめから」の回の中で 1 回だけ町の急報（演出 ch1_report：織田の使者・浅井の使者・忠勝・家康の声のある台詞）が始まり、
 * その後に使者は話せる位置へ、忠勝は城門の前へ歩いて行く。使者・城門・忠勝の前へ行く e2e は、その前にこれで急報を越える。
 *
 * 本物の入力だけ：今の見回しのまま W（run なら Shift も）を押し続けて北へ歩き、急報の層（`.g-layer[data-kind="cine"][data-cine="ch1_report"]`）
 * が出たら離す。飛ばす（既定）なら、出てから 0.5 秒（押し始めの守り 350ms）待って Esc（tap なら「スキップ」をタップ）を押し、層が閉じるまで待つ。
 * watch なら最後まで見て、層が閉じるまで待つ。どちらも閉じた後、開発の画面（window.__game がある）では操作へ戻る（screen が explore・
 * 層が無い）まで待つ。本番ビルド（開発用のフックが無い）でも同じに使える。
 * - 呼ぶのは「はじめから」の冒頭の演出（ch1_open）が閉じた後（町の入口・北を見る）。主人公が線の北に居ると歩いても出ないので、そこで呼ばない。
 * - 歩いても出ないとき（walkTimeout）は誤りを投げる（開発の画面なら主人公の位置も書く）。
 * - 開発用の口（__game.teleport など）で線の北へ移すと、その場で急報が始まる。移す前にこれで越えておく。
 * - settle（最後まで見た後、使者・忠勝が話せる位置に着くまで待つ）は endStreetReport、optional（急報の無い前の版のビルドでも使う）は
 *   walkToStreetReport を見る。optional で急報が無かったときの返りは id: null。
 * 返り：{ id, walkMs, skipped, watchedMs }
 */
export async function passStreetReport(page, { watch = false, settle = false, run = false, tap = false, optional = false, walkTimeout = 600000, timeout = 1800000, log = (t) => console.log(`   ${t}`) } = {}) {
    const { id, walkMs } = await walkToStreetReport(page, { run, optional, walkTimeout, timeout });
    if (!id) {
        log(`町の急報は無かった（W${run ? '＋Shift' : ''}で北へ ${(walkMs / 1000).toFixed(1)} 秒歩いて忠勝の「話す」が出た：急報の無い前の版のビルド）`);
        return { id: null, walkMs, skipped: false, watchedMs: null };
    }
    const { watchedMs } = await endStreetReport(page, { watch, settle, tap, timeout });
    log(`町の急報「${id}」：W${run ? '＋Shift' : ''}で北へ ${(walkMs / 1000).toFixed(1)} 秒歩いて線を越えた → ${watch ? `最後まで見た（${(watchedMs / 1000).toFixed(1)} 秒${settle ? '。使者・忠勝が話せる位置に着くまで待った' : ''}）` : `${tap ? '「スキップ」のタップ' : 'Esc'}で飛ばした（急報そのものの確かめは e2e/v28-envoy-event.mjs）`}`);
    return { id, walkMs, skipped: !watch, watchedMs };
}

/**
 * passStreetReport の後半だけ：出ている町の急報の層を、飛ばす（出てから 0.5 秒待って Esc／tap なら「スキップ」をタップ）か最後まで見て、
 * 層が閉じて操作へ戻るまで待つ（自分の歩きの記録を取りながら線を越えた e2e が使う）。返り：{ watchedMs }
 * settle（最後まで見たときだけ意味がある）：急報の後、使者・忠勝は話せる位置へ歩いて行き、着くまで「話す」が出ない。その歩きが終わるまで待つ
 * （開発の画面は __game.event の epilogue が空になるまで。本番ビルドは町の時計で STREET_REPORT_SETTLE_SEC 秒：waitGameSeconds）。
 * 飛ばしたときは、使者・忠勝はすぐ話せる位置に置かれるので待たない。
 */
export async function endStreetReport(page, { watch = false, settle = false, tap = false, timeout = 1800000 } = {}) {
    const sel = '.g-layer[data-kind="cine"]';
    await page.locator(sel).waitFor({ state: 'attached', timeout });
    const id = await page.locator(sel).getAttribute('data-cine');
    if (id !== 'ch1_report') throw new Error(`町の急報のはずの演出が「${id}」だった`);
    let watchedMs = null;
    if (watch) {
        const w0 = Date.now();
        await page.locator(sel).waitFor({ state: 'detached', timeout });
        watchedMs = Date.now() - w0;
    } else {
        await new Promise((r) => setTimeout(r, 500));
        if (tap) await page.locator(`${sel} .g-cine-btn[data-id="skip"]`).tap();
        else await page.keyboard.press('Escape');
        await page.locator(sel).waitFor({ state: 'detached', timeout });
    }
    await waitControl(page, timeout);
    if (watch && settle) {
        const dev = await page.evaluate(() => !!window.__game?.event);
        if (dev) await page.waitForFunction(() => window.__game.event.epilogue.length === 0, null, { timeout, polling: 200 });
        else await waitGameSeconds(page, STREET_REPORT_SETTLE_SEC);
    }
    return { watchedMs };
}

/** 急報の後、使者・忠勝が話せる位置に着くまでの町の時計の秒（設計 §12.2：出来事の終わりから 10.4〜14.2 秒。余裕を足す） */
export const STREET_REPORT_SETTLE_SEC = 16;

/**
 * 町の時計（探索の 1 コマの進みは min(実時間の差, 0.1 秒)：main.ts の frame）で sec 秒進むまで待つ。開発用のフックを使わない
 * （本番ビルドでも使える）。描画の遅いこのコンテナでは、1 コマ 0.1 秒の上限の分、実時間はずっと長くかかる
 */
export function waitGameSeconds(page, sec) {
    return page.evaluate(
        (sec) =>
            new Promise((done) => {
                let acc = 0;
                let last = null;
                const loop = (ts) => {
                    if (last !== null) acc += Math.min(Math.max(0, (ts - last) / 1000), 0.1);
                    last = ts;
                    if (acc >= sec) done(acc);
                    else requestAnimationFrame(loop);
                };
                requestAnimationFrame(loop);
            }),
        sec,
    );
}

/**
 * passStreetReport の歩くところだけ：W（run なら Shift も）を押し続け、町の急報の層が出たら離して返る（演出は流れたまま）。
 * 急報の途中で何かをする e2e（声の確かめ・途中のメニューなど）が使う。返り：{ id, walkMs }
 * optional：急報の無い前の版のビルド（比べのための旧版の dist など）でも使えるように、急報より先に忠勝の「話す」が出たら
 * そこで止めて { id: null } を返す（今の版では、忠勝の前へ行くには必ず線を越えるので、先に急報が出る）。
 */
export async function walkToStreetReport(page, { run = false, optional = false, walkTimeout = 600000, timeout = 1800000 } = {}) {
    const sel = '.g-layer[data-kind="cine"]';
    await page.locator(sel).waitFor({ state: 'detached', timeout });
    await waitControl(page, timeout);
    const keys = run ? ['ShiftLeft', 'KeyW'] : ['KeyW'];
    const t0 = Date.now();
    for (const k of keys) await page.keyboard.down(k);
    let err = null;
    try {
        if (optional)
            await page.waitForFunction(
                () => {
                    if (document.querySelector('.g-layer[data-kind="cine"]')) return true;
                    const b = document.querySelector('.g-talk');
                    return !!b && !b.hidden && b.dataset.target === 'tadakatsu';
                },
                null,
                { timeout: walkTimeout, polling: 100 },
            );
        else await page.locator(sel).waitFor({ state: 'attached', timeout: walkTimeout });
    } catch (e) {
        err = e;
    } finally {
        for (const k of [...keys].reverse()) await page.keyboard.up(k);
    }
    const walkMs = Date.now() - t0;
    if (!err && optional && !(await page.locator(sel).count())) return { id: null, walkMs };
    if (err) {
        const where = await page.evaluate(() => (window.__p3?.hero ? { x: window.__p3.hero.x, z: window.__p3.hero.z, screen: window.__game?.screen, ui: window.__game?.ui?.kind ?? null, townEvent: window.__game?.townEvent ?? null } : null)).catch(() => null);
        throw new Error(`町の急報（ch1_report）が始まらない（W を ${(walkMs / 1000).toFixed(1)} 秒押した${where ? `。主人公 ${JSON.stringify(where)}` : ''}）`);
    }
    const id = await page.locator(sel).getAttribute('data-cine');
    if (id !== 'ch1_report') throw new Error(`町の急報のはずの演出が「${id}」だった`);
    return { id, walkMs };
}

/** 開発の画面（window.__game がある）なら、操作へ戻る（探索の画面・層が無い）まで待つ。本番ビルドではすぐ返る */
function waitControl(page, timeout) {
    return page.waitForFunction(() => !window.__game || (window.__game.screen === 'explore' && !window.__game.ui), null, { timeout, polling: 100 });
}

/** passStreetReport の、急報を最後まで見る形（声・字幕・人物の動きを流し切る） */
export function watchStreetReport(page, opts = {}) {
    return passStreetReport(page, { ...opts, watch: true });
}

/**
 * 本番の e2e（開発用のフックが無い）の歩き：肩越しのカメラの見回しの向き（yaw。0 で北を見る）を本物の入力から測る。
 * S を短く押して下がり（下がれなければ W で進み）、前後の位置（readPose：メニューから保存して読むなど）の差から求める。
 * 見回しは引きずりでしか変わらないが、演出の後・段階の始めには主人公の向きから決め直す（歴史分岐の町の入口は 0・架空の章の開始の位置は 0.36）ので、
 * 決め打ちにせず歩く前に測る（Version 21 で歴史分岐の探索の始めが町の入口になった）。返り：{ yaw, pose }（動けなければ null）
 */
export async function measureYaw(page, readPose, holdMs = 700) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let a = await readPose();
  for (const key of ['KeyS', 'KeyW']) {
    await page.keyboard.down(key);
    await sleep(holdMs);
    await page.keyboard.up(key);
    await sleep(200);
    const b = await readPose();
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (Math.hypot(dx, dz) >= 0.05) return { yaw: key === 'KeyS' ? Math.atan2(dx, dz) : Math.atan2(-dx, -dz), pose: b };
    a = b;
  }
  return null;
}

/** 見回し yaw の画面の上で、p（x, z）から (tx, tz) へ向かう移動のキー（WASD） */
export function keysToward(yaw, p, tx, tz) {
  const gx = tx - p.x;
  const gz = tz - p.z;
  const d = Math.hypot(gx, gz) || 1;
  const ix = (Math.cos(yaw) * gx - Math.sin(yaw) * gz) / d;
  const iy = (Math.sin(yaw) * gx + Math.cos(yaw) * gz) / d;
  const keys = [];
  if (iy < -0.38) keys.push('KeyW');
  if (iy > 0.38) keys.push('KeyS');
  if (ix > 0.38) keys.push('KeyD');
  if (ix < -0.38) keys.push('KeyA');
  return keys;
}

// ---------------------------------------------------------------- 本番ビルドの e2e の共通（Version 22〜。今までの *-prod.mjs は自分の表を持つまま）

/** 公開先に近い決まり（すべての本番の e2e と同じ CSP） */
export const PROD_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'";

/** 本番の簡易サーバーの種類の表（生成イラスト素材の .webp を足した。Version 28：台詞の音声ファイルの音の種類を足した） */
export const PROD_MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.glb': 'model/gltf-binary',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
};

/**
 * dist を CSP のヘッダー付きで出す簡易サーバー（ほかの本番の e2e と同じ作り）。返り：{ served, missing, close }。
 * served は出したパス（例 '/art/portraits/ieyasu.webp'）の順の記録、missing は 404 にしたパス。
 */
export async function serveDist(dist, port, { csp = PROD_CSP, mime = PROD_MIME } = {}) {
    const { createServer } = await import('node:http');
    const { existsSync: has, readFileSync, statSync } = await import('node:fs');
    const { extname, join, normalize } = await import('node:path');
    const served = [];
    const missing = [];
    const server = createServer((req, res) => {
        const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        const file = normalize(join(dist, path === '/' ? 'index.html' : path));
        if (!file.startsWith(dist) || !has(file) || !statSync(file).isFile()) {
            missing.push(path);
            res.writeHead(404, { 'content-security-policy': csp });
            res.end('not found');
            return;
        }
        served.push(path);
        res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'content-security-policy': csp, 'cache-control': 'no-store' });
        res.end(readFileSync(file));
    });
    await new Promise((r) => server.listen(port, r));
    return {
        served,
        missing,
        close: () =>
            new Promise((r) => {
                server.close(r);
                server.closeAllConnections?.();
            }),
    };
}

/** 2 つの四角（{l,t,r,b}。CSS px）が重なるか（tol px までの接しは重なりにしない） */
export function boxesOverlap(a, b, tol = 0.5) {
    return !!a && !!b && a.l < b.r - tol && b.l < a.r - tol && a.t < b.b - tol && b.t < a.b - tol;
}

/**
 * 軍議の背景の描き方の決まり（Version 26。docs/v25-portraits.md の 5）を e2e の側で別に計算する（ui/artCanvas.ts の councilArtLayout・backingScale と同じ式）。
 * 表示の倍率（描く CSS の px ÷ 元の画素）＝ min(画面を埋める倍率（cover・上下は 18% まで切る）, 1.25)。端末の画素の比（dpr）では外さない・縮めない
 * （dpr は canvas の画素の数にだけ効く：CSS の 1px あたり 1〜2 の画素と、元の画像の細かさ 1÷表示の倍率 の小さい方）。縦横はいつも同じ倍率。
 * 返り：need（埋める倍率）・scale（表示の倍率）・limited（1.25 を超える画面：画面より小さく真ん中に描く）・描く所 dx,dy,dw,dh（CSS の px）・canvas の画素 [幅, 高さ]
 */
export const COUNCIL_BG_MAX_SCALE = 1.25;
export function councilBgExpect(srcW, srcH, vw, vh, dpr = 1, { maxScale = COUNCIL_BG_MAX_SCALE, maxCropY = 0.18 } = {}) {
    const W = Math.max(1, Math.round(vw));
    const H = Math.max(1, Math.round(vh));
    const need = Math.min(Math.max(W / srcW, H / srcH), H / (srcH * (1 - 2 * maxCropY)));
    const scale = Math.min(need, maxScale);
    const dw = srcW * scale >= W - 1e-6 ? W : srcW * scale;
    const dh = srcH * scale >= H - 1e-6 ? H : srcH * scale;
    const k = Math.max(0.25, Math.min(Math.min(2, Math.max(1, dpr || 1)), 1 / scale));
    return { need, scale, limited: need > maxScale + 1e-9, dx: (W - dw) / 2, dy: (H - dh) / 2, dw, dh, canvas: [Math.max(1, Math.round(dw * k)), Math.max(1, Math.round(dh * k))] };
}

/** 測った軍議の背景の canvas（box：{l,t,w,h} CSS の px、px：[canvas の幅, 高さ]）が councilBgExpect の決まりどおりか（四角は 1px、画素は 1 まで） */
export function councilBgMatches(box, px, want) {
    if (!box || !want) return false;
    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    return near(box.l, want.dx, 1) && near(box.t, want.dy, 1) && near(box.w, want.dw, 1) && near(box.h, want.dh, 1) && (!px || (near(px[0], want.canvas[0], 1) && near(px[1], want.canvas[1], 1)));
}
