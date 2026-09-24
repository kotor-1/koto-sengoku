import { BASE, launchBrowser } from './lib.mjs';
const browser = await launchBrowser();
for (const q of ['high', 'low']) {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem('koto-sengoku/visual', JSON.stringify({ timeOfDay: 'night' })));
  const page = await ctx.newPage();
  await page.goto(BASE + '/?q=' + q);
  await page.waitForFunction(() => window.__koto?.game.scene.getScene('World')?.hero, null, { timeout: 30000 });
  await page.tap('#btn-new');
  await page.evaluate(() => { const s = window.__koto.app.getSession(); s.state.player.x = 28*16+8; s.state.player.y = 25*16+8; });
  await page.waitForTimeout(4000);
  const r = await page.evaluate(() => {
    const sc = window.__koto.game.scene.getScene('World');
    const list = sc.children.list;
    const tex = [];
    for (const [k, p] of sc.artSpecs) tex.push([k, Math.round(p.width * p.height * 4 / 1024)]);
    tex.sort((a, b) => b[1] - a[1]);
    const emitters = list.filter((o) => o.type === 'ParticleEmitter');
    return {
      quality: window.__koto.quality.tier, renderScale: window.__koto.viewport.renderScale,
      canvas: [sc.game.canvas.width, sc.game.canvas.height],
      displayListTotal: list.length, displayListVisible: list.filter((o) => o.visible).length,
      standing: sc.standing.length, standingVisible: sc.standing.filter((s) => s.obj.visible).length,
      tufts: sc.tufts.length, tuftsVisible: sc.tufts.filter((s) => s.obj.visible).length,
      glows: sc.glows.length, glowsVisible: sc.glows.filter((g) => g.img.visible).length,
      emitters: emitters.length, emittersEmitting: emitters.filter((e) => e.emitting).length,
      particlesAlive: emitters.reduce((n, e) => n + e.getAliveParticleCount(), 0),
      particleCap: emitters.reduce((n, e) => n + (e.maxAliveParticles || 0), 0),
      textureMB: +(sc.stats.textureBytes / 1048576).toFixed(1), artMs: sc.stats.artMs,
      topTextures: tex.slice(0, 8),
    };
  });
  console.log(JSON.stringify(r));
  await ctx.close();
}
await browser.close();
