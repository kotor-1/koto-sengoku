// 3D 素材（GLB）を書き出して proto3d/public/models/ に保存する。
// 使い方: 別の端末で npm run proto3d:dev を起動しておき、node proto3d/tools/export-models.mjs [名前,名前…]
//   名前を渡すとその素材だけ書き出す（例: hero,house,ground）
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../../e2e/lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../public/models');
mkdirSync(out, { recursive: true });
const base = process.env.BASE3D || 'http://localhost:8090';
const browser = await launchBrowser();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${base}/tools/export.html`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60000 });
const only = process.argv[2] ? process.argv[2].split(',') : undefined;
const files = await page.evaluate((o) => window.__exportModels(o), only);
for (const [name, data] of Object.entries(files)) {
    const buf = Buffer.from(data, 'base64');
    writeFileSync(`${out}/${name}.glb`, buf);
    console.log(`${name}.glb`, (buf.length / 1024).toFixed(0), 'KB');
}
if (errors.length) console.log('errors:', errors);
await browser.close();
