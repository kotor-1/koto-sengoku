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
