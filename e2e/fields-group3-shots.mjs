/**
 * 第3群の 5 戦場（湿地・村落・寺社周辺・城下町外縁・城攻め前面）の見た目の撮影（docs/fields-group3-design.md §5）。
 *   BASE3D=http://localhost:8302 BASE=http://localhost:8302 node e2e/fields-group3-shots.mjs [出力先]   （既定の出力先 e2e-out/group3）
 * - ?dev=field&id=<戦場id> を PC（1280×720）とスマホ横（844×390、タッチ）で開き、合戦の前の説明を閉じた直後（<id>-<kind>.png）と、
 *   開発用の早送り（window.__battle.fastForward）で 60 秒進めた後（<id>-<kind>-60s.png）を撮る。命令は出さない（見た目の確認だけ）。
 * - 地形・建物・柵・石垣・門・乾いた足場・目標の輪・名札が描かれ、ページの誤りが出ないことを確かめる（重なりは fields-ui.mjs が見る）。
 * IDS=marsh,village で一部だけ。
 */
import { launchBrowser } from './lib.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8302';
const OUT = process.argv[2] || 'e2e-out/group3';
mkdirSync(OUT, { recursive: true });
const IDS = (process.env.IDS || 'marsh,village,temple,town_edge,siege_front').split(',');
const failures = [];
const log = (...a) => console.log(...a);
function check(ok, what, extra = '') {
    log(`${ok ? '  ok ' : '  NG '} ${what}${extra ? `  ${extra}` : ''}`);
    if (!ok) failures.push(what);
}

const b = await launchBrowser();
for (const id of IDS) {
    for (const kind of ['desktop', 'phone']) {
        const phone = kind === 'phone';
        const ctx = await b.newContext(phone ? { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 720 } });
        const page = await ctx.newPage();
        page.setDefaultTimeout(120000);
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`${BASE}/?dev=field&id=${id}&q=low`);
        await page.waitForFunction(() => document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, { timeout: 240000, polling: 500 });
        // 合戦の前の説明を閉じる（出陣のボタン）
        if (phone) await page.tap('.b-primary');
        else await page.click('.b-primary');
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${OUT}/${id}-${kind}.png` });
        const ok = await page.evaluate(() => !!window.__battle && window.__battle.state.units.length > 0);
        check(ok, `${id} ${kind}：合戦が始まった`);
        await page.evaluate(() => window.__battle.fastForward(60));
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${OUT}/${id}-${kind}-60s.png` });
        const t = await page.evaluate(() => window.__battle.state.t);
        check(t >= 59, `${id} ${kind}：早送りで 60 秒進んだ`, `t=${t.toFixed(1)}`);
        check(errors.length === 0, `${id} ${kind}：ページの誤りが無い`, errors.join(' / '));
        await ctx.close();
    }
}
await b.close();
log(failures.length ? `NG ${failures.length}` : 'all ok');
process.exit(failures.length ? 1 : 0);
