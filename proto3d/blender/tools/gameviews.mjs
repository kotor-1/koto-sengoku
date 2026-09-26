// ゲーム画面を決まったカメラで撮る（views.json。start は開始の肩越しのカメラ）。npm run proto3d:dev を起動しておく。
// 使い方: [VIEWS=hero,start] node proto3d/blender/tools/gameviews.mjs <出力先> <接頭辞> [full,nonormal,novc,noao]
import { launchBrowser } from '../../../e2e/lib.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
const [out, prefix, vlist = 'full'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const ALL = JSON.parse(readFileSync(new URL('./views.json', import.meta.url)));
const only = process.env.VIEWS ? process.env.VIEWS.split(',') : Object.keys(ALL);
const VIEWS = Object.fromEntries(Object.entries(ALL).filter(([k]) => only.includes(k)));
const BASE = process.env.BASE3D || 'http://localhost:8090';
const browser = await launchBrowser();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.setDefaultTimeout(900000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE + '/');
await page.waitForFunction(() => window.__p3?.stats.readyMs > 0, null, { timeout: 600000 });
await page.evaluate(() => {
  const p = window.__p3;
  p.manual();
  for (let i = 0; i < 40; i++) p.step(1 / 30, 0, 0);
  // 元の材質の状態を覚えておく
  window.__orig = new Map();
  p.scene.traverse((o) => { if (o.isMesh) { const m = o.material; window.__orig.set(m, { n: m.normalMap, vc: m.vertexColors, ao: m.aoMap, r: m.roughnessMap }); } });
});
for (const variant of vlist.split(',')) {
  for (const [name, v] of Object.entries(VIEWS)) {
    await page.evaluate(([variant, v]) => {
      const p = window.__p3;
      for (const [m, o] of window.__orig) {
        m.normalMap = variant === 'nonormal' ? null : o.n;
        m.vertexColors = variant === 'novc' ? false : o.vc;
        m.aoMap = variant === 'noao' ? null : o.ao;
        m.needsUpdate = true;
      }
      p.step(1 / 1000, 0, 0); // 通常のカメラで 1 回
      if (v) {
        p.camera.position.set(...v.cam);
        p.camera.fov = v.fov;
        p.camera.updateProjectionMatrix();
        p.camera.lookAt(...v.tgt);
        p.scene.traverse((o) => { if (o.isSkinnedMesh) o.visible = true; });
        p.renderer.render(p.scene, p.camera);
      }
    }, [variant, v]);
    await page.screenshot({ path: `${out}/${prefix}-${name}${variant === 'full' ? '' : '-' + variant}.png`, timeout: 900000 });
    console.log('saved', name, variant);
  }
}
console.log('errors', JSON.stringify(errors));
await browser.close();
