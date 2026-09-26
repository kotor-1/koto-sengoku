import { launchBrowser } from '../../../e2e/lib.mjs';
const BASE = process.env.BASE3D || 'http://localhost:8095';
const browser = await launchBrowser();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 300)));
page.on('requestfailed', (r) => console.log('reqfail', r.url()));
await page.goto(BASE + '/' + (process.env.QS || ''));
try { await page.waitForFunction(() => window.__p3?.stats.readyMs > 0, null, { timeout: 180000 }); console.log('ready'); } catch (e) { console.log('timeout'); }
console.log(await page.evaluate(() => document.getElementById('loading')?.textContent));
await browser.close();
