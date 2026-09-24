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
