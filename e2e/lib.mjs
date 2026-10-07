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

/** 本番の簡易サーバーの種類の表（生成イラスト素材の .webp を足した） */
export const PROD_MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };

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
