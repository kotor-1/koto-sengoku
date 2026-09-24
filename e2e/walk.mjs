// 城下町を 20〜30 秒歩き、カメラ・8方向・歩行コマ・描画順・半透明化・環境アニメ・UI を同時に記録する
// 使い方: BASE=... MODE=desktop|phone TOD=evening node walk.mjs <出力dir>
import { BASE, launchBrowser, outDir } from './lib.mjs';
const out = outDir(process.argv[2]);
const MODE = process.env.MODE || 'desktop';
const TOD = process.env.TOD || 'evening';
const phone = MODE === 'phone';
const browser = await launchBrowser();
const ctx = await browser.newContext(phone
  ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await ctx.addInitScript((t) => localStorage.setItem('koto-sengoku/visual', JSON.stringify({ timeOfDay: t })), TOD);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(BASE + '/?fps');
await page.waitForFunction(() => window.__koto?.game.scene.getScene('World')?.hero, null, { timeout: 20000 });
await page.waitForTimeout(800);
if (phone) await page.tap('#btn-new'); else await page.click('#btn-new');
await page.waitForTimeout(500);
const cdp = phone ? await ctx.newCDPSession(page) : null;
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });

// 入力：主人公の現在位置を見ながら目標地点へ向かう（フレームレートに左右されない経路）
const KEYMAP = { x: { '1': 'ArrowRight', '-1': 'ArrowLeft' }, y: { '1': 'ArrowDown', '-1': 'ArrowUp' } };
const held = new Set();
let stuck = 0;
let stickDown = false;
async function setInput(dx, dy) {
  if (phone) {
    const ox = 150, oy = 290, r = 45;
    if (dx === 0 && dy === 0) { if (stickDown) { await touch('touchEnd', []); stickDown = false; } return; }
    if (!stickDown) { await touch('touchStart', [[ox, oy, 1]]); stickDown = true; }
    const l = Math.hypot(dx, dy) || 1;
    await touch('touchMove', [[ox + dx / l * r, oy + dy / l * r, 1]]);
  } else {
    const want = new Set();
    if (dx) want.add(KEYMAP.x[String(dx)]);
    if (dy) want.add(KEYMAP.y[String(dy)]);
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  }
}
const heroPos = () => page.evaluate(() => { const p = window.__koto.app.getSession().state.player; return { x: p.x, y: p.y }; });
async function moveTo(tx, ty, timeout = 12000) {
  const gx = tx * 16 + 8, gy = ty * 16 + 8;
  const end = Date.now() + timeout;
  const began = Date.now();
  for (;;) {
    const p = await heroPos();
    const ex = gx - p.x, ey = gy - p.y;
    if (Math.abs(ex) < 12 && Math.abs(ey) < 12) { if (process.env.DEBUG) console.log('arrived', tx, ty, Date.now() - began, 'ms'); break; }
    if (Date.now() > end) { console.log('NG  到達できず', tx, ty, 'いま', (p.x / 16 - 0.5).toFixed(1), (p.y / 16 - 0.5).toFixed(1)); stuck++; break; }
    // 8 方向に量子化（片方の差が小さければ直進）
    const dx = Math.abs(ex) > 5 && Math.abs(ex) > Math.abs(ey) * 0.4 ? Math.sign(ex) : 0;
    const dy = Math.abs(ey) > 5 && Math.abs(ey) > Math.abs(ex) * 0.4 ? Math.sign(ey) : 0;
    await setInput(dx, dy);
    if (Math.hypot(ex, ey) < 28) {
      // 目標の近くでは短く刻む（1 回の確認の間に行き過ぎないように）
      await page.waitForTimeout(60);
      await setInput(0, 0);
    }
    await sample(1, true);
  }
}
async function hold(dx, dy, ms) { await setInput(dx, dy); await sample(ms); }
async function release(ms) { await setInput(0, 0); await sample(ms); }

const samples = [];
let lastSample = 0;
async function sample(ms, once = false) {
  const end = Date.now() + ms;
  while (once || Date.now() < end) {
    if (once && Date.now() - lastSample < 200) { await page.waitForTimeout(40); return; }
    lastSample = Date.now();
    samples.push(await page.evaluate(() => {
      const sc = window.__koto.game.scene.getScene('World');
      const s = window.__koto.app.getSession();
      const c = sc.cameras.main;
      const faded = sc.standing.filter((o) => o.occluder && o.obj.alpha < 0.8).length;
      const tuft = sc.tufts.find((t) => t.obj.visible);
      const heroD = sc.hero.sprite.depth;
      // 描画順：主人公と重なる立ち物が、足元の Y の順になっているか
      const hx = sc.hero.sprite.x, hy = sc.hero.sprite.y;
      let orderErrors = 0;
      for (const o of sc.standing) {
        if (!o.obj.visible || o.right < hx - 8 || o.left > hx + 8 || o.bottom < hy - 34 || o.top > hy) continue;
        if ((o.baseY > hy) !== (o.obj.depth > heroD)) orderErrors++;
      }
      return {
        t: performance.now(),
        x: s.state.player.x, y: s.state.player.y, area: s.state.area,
        dir: sc.hero.heading.dir, frame: sc.hero.sprite.frame.name, moving: sc.hero.heading.moving,
        camDx: c.midPoint.x - sc.hero.sprite.x, camDy: c.midPoint.y - (sc.hero.sprite.y - 12),
        faded, water: sc.waterLayers[0]?.ts.tilePositionY ?? 0, tuftRot: tuft ? tuft.obj.frame.name : null,
        orderErrors,
        prompt: !document.getElementById('prompt')?.hidden, actionLabel: document.getElementById('action-btn')?.textContent,
        actionIdle: document.getElementById('action-btn')?.classList.contains('idle'),
        bubble: sc.bubble.visible, fps: Math.round(sc.game.loop.actualFps),
        atBounds: c.worldView.y <= 0.5 || c.worldView.x <= 0.5 || c.worldView.bottom >= 704 - 0.5 || c.worldView.right >= 896 - 0.5,
      };
    }));
    if (once) return;
    await page.waitForTimeout(250);
  }
}

const t0 = Date.now();
// 城内（天守前）→ 家臣に向き合う → 城門・橋 → 城門前 → 十字路 → 南の家並みの裏（半透明）→ 東へ → 川の橋 → 街道
await moveTo(32, 8.6);
await hold(0, 1, 500);          // 家臣に向き合う（吹き出し）
await release(400);
await page.screenshot({ path: `${out}/walk-${MODE}-0-retainer.png` });
await moveTo(28.5, 12);
await moveTo(27.5, 16);          // 城門・堀の橋
await moveTo(26.5, 19);
await moveTo(27.5, 25);          // 十字路の北
await moveTo(27.5, 26.5);
await moveTo(21, 26.5);          // 通りを西へ
await moveTo(20, 28.6);          // 南の家並みとの隙間
await moveTo(6, 28.6);           // 家並みの裏を西へ（半透明）
await page.screenshot({ path: `${out}/walk-${MODE}-2-behind.png` });
await moveTo(8, 26.5);
await moveTo(40, 26.5);          // 通りを東へ
await moveTo(44, 25);            // 右上
await moveTo(47, 26.5);          // 川の橋
await moveTo(52, 26.5);          // 街道
await moveTo(50, 24.5);          // 左上（道標の方）
await release(800);
await page.screenshot({ path: `${out}/walk-${MODE}-3.png` });
const dur = (Date.now() - t0) / 1000;

if (process.env.DEBUG) for (const s of samples) if (Math.hypot(s.camDx, s.camDy) > 30) console.log(JSON.stringify(s));
const dirs = new Set(samples.filter((s) => s.moving).map((s) => s.dir));
const frames = new Set(samples.filter((s) => s.moving).map((s) => s.frame));
const maxCam = Math.max(...samples.filter((s) => !s.atBounds).map((s) => Math.hypot(s.camDx, s.camDy)));
const fadedAny = samples.some((s) => s.faded > 0);
const waterMoved = Math.abs(samples.at(-1).water - samples[0].water) > 1;
const tuftVals = samples.map((s) => s.tuftRot).filter((v) => v !== null);
const tuftMoved = new Set(tuftVals).size > 1;
const orderErr = samples.reduce((n, s) => n + s.orderErrors, 0);
const areas = [...new Set(samples.map((s) => s.area))];
const fps = samples.map((s) => s.fps);
const check = (name, ok, extra = '') => console.log(`${ok ? 'OK ' : 'NG '} ${name} ${extra}`);
console.log(`mode=${MODE} tod=${TOD} 歩行 ${dur.toFixed(1)} 秒, サンプル ${samples.length}, 地域 ${areas.join('→')}, コンテナ内fps(ソフトウェア描画) ${Math.min(...fps)}〜${Math.max(...fps)}`);
check('8方向のうち歩いた向き', dirs.size >= 6, `${[...dirs].sort().join(',')}`);
check('歩行コマが切り替わる', frames.size >= 5, `${frames.size} 種`);
check('カメラが主人公から大きく離れない（先読み込み）', maxCam < 40, `最大 ${maxCam.toFixed(1)}px`);
check('裏に入って半透明化が起きた', fadedAny);
check('描画順の矛盾なし', orderErr === 0, `矛盾 ${orderErr}`);
check('水面が動く', waterMoved);
check('草が揺れる', tuftMoved);
check('城下町・街道まで歩けた', areas.includes('town') && areas.includes('road'));
check('近づくとアクション表示（吹き出し）', samples.some((s) => s.bubble));
check('経路をすべて歩けた', stuck === 0, `未到達 ${stuck}`);
console.log('errors:', JSON.stringify(errors));
await browser.close();
