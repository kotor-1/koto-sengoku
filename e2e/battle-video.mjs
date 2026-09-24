// 模擬戦の「指揮 → 命令 → 再開」の流れを録画する（スマホ横向き相当・タッチ操作）。
//   出力：<出力先>/battle-command.webm（動画）と battle-command-story.png（要所の静止画を並べたもの）
// 指で押した場所は、録画用に丸い印を重ねて見えるようにしている（ゲーム本体には入っていない）。
// 注意：コンテナはソフトウェア描画なので、動画のコマ数は実機より少ない（カクついて見える）。
// 使い方: BASE=http://localhost:8080 node e2e/battle-video.mjs [出力先]
import { renameSync, writeFileSync } from 'node:fs';
import { BASE, launchBrowser, outDir } from './lib.mjs';

const S = outDir(process.argv[2]);
const W = 844;
const H = 390;
const browser = await launchBrowser();
const ctx = await browser.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
  recordVideo: { dir: S, size: { width: W, height: H } },
});
const page = await ctx.newPage();
await page.goto(BASE + '/');
await page.waitForFunction(() => window.__koto?.game.scene.getScene('World')?.stats.readyMs > 0, null, { timeout: 60000 });
// 押した場所の印（録画用）
await page.addStyleTag({ content: '.tap-mark{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid rgba(255,255,255,.95);box-shadow:0 0 0 3px rgba(0,0,0,.35);pointer-events:none;z-index:99;animation:tapm .6s ease-out forwards}@keyframes tapm{from{transform:scale(.5);opacity:1}to{transform:scale(1.25);opacity:0}}' });
await page.evaluate(() => window.addEventListener('pointerdown', (e) => {
  const d = document.createElement('div'); d.className = 'tap-mark'; d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px';
  document.body.appendChild(d); setTimeout(() => d.remove(), 700);
}, true));

const story = [];
const shot = async (label) => story.push({ label, data: (await page.screenshot()).toString('base64') });
const toScreen = (x, y) => page.evaluate(([x, y]) => {
  const g = window.__koto.game; const cam = g.scene.getScene('World').cameras.main; const r = g.canvas.getBoundingClientRect();
  return { x: r.left + (x - cam.worldView.x) * cam.zoom * (r.width / g.canvas.width), y: r.top + (y - cam.worldView.y) * cam.zoom * (r.height / g.canvas.height) };
}, [x, y]);
const beat = (ms = 700) => page.waitForTimeout(ms);

await page.tap('#btn-new');
await page.evaluate(() => { const s = window.__koto.app.getSession(); s.state.player.x = 31 * 16 + 8; s.state.player.y = 10 * 16 + 8; s.state.player.facing = 'right'; });
await beat(500);
for (let i = 0; i < 12 && !(await page.locator('#dialogue-choices').isVisible()); i++) { await page.tap('#action-btn'); await beat(350); }
await shot('1. 源蔵の誘い →「模擬戦をする」');
await page.tap('#dialogue-choices button[data-index="0"]');
await beat(2600);
// 若殿が少し前へ出て、戦いが始まる
await page.evaluate(() => window.__koto.app.input.setStick({ x: 0, y: -1 }));
await beat(700);
await page.evaluate(() => window.__koto.app.input.releaseStick());
await beat(1200);
await shot('2. 戦闘中（訓練相手が迫る）');
await page.tap('#command-btn');
await beat(1300);
await shot('3.「指揮」：時間が止まる');
await page.tap('.cmd-ret[data-id="genzo"]');
await beat(500);
await page.tap('#cmd-orders button[data-order="move"]');
await beat(700);
let p = await toScreen(45 * 16 + 8, 6 * 16 + 8);
await page.touchscreen.tap(p.x, p.y);
await beat(900);
await shot('4. 源蔵：移動（左奥を押す）');
await page.tap('.cmd-ret[data-id="shinpachi"]');
await beat(500);
await page.tap('#cmd-orders button[data-order="attack"]');
await beat(700);
const t = await page.evaluate(() => { const u = window.__koto.app.getBattle().session.unit('trainee4'); return { x: u.x, y: u.y }; });
p = await toScreen(t.x, t.y - 12);
await page.touchscreen.tap(p.x, p.y);
await beat(1600);
await shot('5. 新八：攻撃（右端の相手を押す）');
await page.tap('#cmd-resume');
await beat(1500);
await shot('6.「再開」：全員が同時に動く');
await beat(2500);
await shot('7. 源蔵は左奥へ、新八は指定の相手と戦う');
await beat(1500);

const video = page.video();
await ctx.close();
const src = await video.path();
renameSync(src, `${S}/battle-command.webm`);

// 要所の静止画を 1 枚に並べる
const html = `<html><body style="margin:0;background:#15130f;font-family:sans-serif;color:#eee7d6">
<div style="display:grid;grid-template-columns:repeat(2,${W / 2 + 20}px);gap:10px;padding:14px">
${story.map((s) => `<div><div style="font-size:14px;margin:0 0 5px">${s.label}</div><img src="data:image/png;base64,${s.data}" style="width:${W / 2 + 20}px;border-radius:6px"></div>`).join('')}
</div></body></html>`;
const b2 = await browser.newPage({ viewport: { width: W + 70, height: 400 } });
await b2.setContent(html);
await b2.screenshot({ path: `${S}/battle-command-story.png`, fullPage: true });
writeFileSync(`${S}/battle-command-story.txt`, story.map((s) => s.label).join('\n') + '\n');
await browser.close();
console.log('saved', `${S}/battle-command.webm`, `${S}/battle-command-story.png`);
