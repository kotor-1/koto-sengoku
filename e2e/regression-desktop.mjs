import { BASE, launchBrowser, outDir } from './lib.mjs';
const S = outDir(process.argv[2]);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
await page.goto(BASE + '/');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${S}/d1-title.png` });
const st = () => page.evaluate(() => { const s = window.__koto.app.getSession(); return s && JSON.parse(JSON.stringify({ p: s.state.player, flags: s.state.flags, area: s.state.area, dlg: s.state.dialogue && s.state.dialogue.index })); });
console.log('continue disabled:', await page.locator('#btn-continue').isDisabled());
await page.click('#btn-new');
await page.waitForTimeout(500);
const p0 = (await st()).p;
await page.keyboard.down('ArrowRight'); await page.waitForTimeout(400); await page.keyboard.up('ArrowRight');
await page.keyboard.down('ArrowDown'); await page.waitForTimeout(300); await page.keyboard.up('ArrowDown');
const p1 = (await st()).p;
console.log('moved', p0.x, p0.y, '->', p1.x.toFixed(1), p1.y.toFixed(1), p1.facing);
await page.waitForTimeout(300);
const p2 = (await st()).p;
console.log('stopped after keyup:', p1.x === p2.x && p1.y === p2.y);
await page.screenshot({ path: `${S}/d2-walk.png` });
// 家臣へ近づいて話す（右へ歩き続ける）
await page.evaluate(() => { const s = window.__koto.app.getSession(); s.state.player.x = 31*16+8; s.state.player.y = 10*16+8; s.state.player.facing="right"; });
await page.keyboard.down('ArrowRight'); await page.waitForTimeout(1200); await page.keyboard.up('ArrowRight');
console.log('pos before talk', JSON.stringify((await st()).p));
console.log('prompt visible:', await page.locator('#prompt').isVisible(), await page.locator('#prompt').innerText());
await page.keyboard.press('Space');
await page.waitForTimeout(200);
console.log('dialogue:', await page.locator('#dialogue').isVisible(), JSON.stringify(await page.locator('#dialogue').innerText()));
await page.screenshot({ path: `${S}/d3-talk.png` });
for (let i = 0; i < 4; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(80); }
console.log('dialogue closed:', !(await page.locator('#dialogue').isVisible()), 'objective:', await page.locator('#objective').innerText());
// 城下へ歩く
await page.evaluate(() => { const s = window.__koto.app.getSession(); s.state.player.x = 27*16+8; s.state.player.y = 12*16+8; });
await page.keyboard.down("ArrowDown"); await page.waitForFunction(() => window.__koto.app.getSession().state.area === "town", null, { timeout: 30000 }).catch(() => {}); await page.keyboard.up("ArrowDown");
await page.waitForTimeout(300);
const s3 = await st();
console.log('area', s3.area, 'flags', JSON.stringify(s3.flags), 'objective:', await page.locator('#objective').innerText());
await page.screenshot({ path: `${S}/d4-town.png` });
// 保存
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
console.log('menu visible:', await page.locator('#menu').isVisible());
await page.click('#btn-save');
await page.waitForTimeout(200);
console.log('menu status:', await page.locator('#menu-status').innerText(), '| toast:', await page.locator('#toast').innerText());
await page.screenshot({ path: `${S}/d5-saved.png` });
// 保存失敗のシミュレーション
await page.evaluate(() => { Storage.prototype._set = Storage.prototype.setItem; Storage.prototype.setItem = function () { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }; });
await page.click('#btn-save');
await page.waitForTimeout(200);
console.log('fail status:', await page.locator('#menu-status').innerText(), '| toast:', await page.locator('#toast').innerText());
await page.screenshot({ path: `${S}/d6-savefail.png` });
await page.evaluate(() => { Storage.prototype.setItem = Storage.prototype._set; });
await page.keyboard.press('Escape');
// 再読み込みして続きから
await page.reload();
await page.waitForTimeout(1200);
console.log('continue enabled:', !(await page.locator('#btn-continue').isDisabled()), await page.locator('#save-info').innerText());
await page.click('#btn-continue');
await page.waitForTimeout(400);
const s4 = await st();
console.log('restored', s4.p.x.toFixed(1), s4.p.y.toFixed(1), s3.p.x.toFixed(1), s3.p.y.toFixed(1), JSON.stringify(s4.flags));
// blur で入力解除
await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(200);
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
const b1 = (await st()).p; await page.waitForTimeout(300); const b2 = (await st()).p;
console.log('blur released:', b1.x === b2.x, b2.moving);
await page.keyboard.up('ArrowLeft');
console.log('scroll', await page.evaluate(() => [window.scrollX, window.scrollY]));
console.log('errors:', errors);
await browser.close();
