// temporary light tuning helper (light agent). usage: node tune-light.mjs <out> <configs.json>
import { launchBrowser } from '../../../e2e/lib.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
const [out, cfgFile] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const cfgs = JSON.parse(readFileSync(cfgFile));
const views = JSON.parse(readFileSync(new URL('./views.json', import.meta.url)));
const BASE = process.env.BASE3D || 'http://localhost:8095';
const browser = await launchBrowser();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.setDefaultTimeout(900000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
await page.goto(BASE + '/' + (process.env.QS || ''));
await page.waitForFunction(() => window.__p3?.stats.readyMs > 0, null, { timeout: 600000 });
await page.evaluate(async () => {
  const p = window.__p3;
  p.manual();
  window.__post = await import('/src/post.ts');
  const r = p.renderer; const orig = r.render.bind(r);
  r.render = () => {};
  for (let i = 0; i < 40; i++) p.step(1 / 30, 0, 0);
  r.render = orig;
  window.__sun = null; p.scene.traverse((o) => { if (o.isDirectionalLight) window.__sun = o; if (o.isHemisphereLight) window.__hemi = o; });
  window.__settle = (yawDelta) => {
    r.render = () => {};
    if (window.__yaw0 === undefined) window.__yaw0 = p.orbit.yaw;
    p.orbit.yaw = window.__yaw0 + yawDelta;
    for (let i = 0; i < 30; i++) p.step(1 / 30, 0, 0);
    r.render = orig;
  };
});
const vlist = (process.env.VIEWS || 'start').split(',');
for (const c of cfgs) {
  for (const v of vlist) {
    const t0 = Date.now();
    await page.evaluate(([code, yd]) => {
      window.__settle(yd);
      const p = window.__p3; const sun = window.__sun; const hemi = window.__hemi; const U = window.__post.lastPost.uniforms; const post = window.__post.lastPost.post;
      const THREE_Color = sun.color.constructor;
      // eslint-disable-next-line no-eval
      eval(code);
      p.renderNow();
    }, [c.code || '', v === 'side' ? views.side.yawDelta : 0]);
    await page.screenshot({ path: `${out}/${c.name}-${v}.png` });
    console.log('saved', c.name, v, (Date.now() - t0) / 1000 + 's');
  }
}
console.log('errors', JSON.stringify(errors.slice(0, 10)));
await browser.close();
