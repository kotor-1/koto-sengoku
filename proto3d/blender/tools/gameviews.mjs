// ゲーム画面を決まったカメラで撮る（views.json。start は開始の肩越しのカメラ）。npm run proto3d:dev を起動しておく。
// 使い方: [VIEWS=hero,start] node proto3d/blender/tools/gameviews.mjs <出力先> <接頭辞> [full,nonormal,novc,noao]
//   views.json：cam/tgt/fov は決まったカメラ。yawDelta は開始の肩越しのカメラのまま、その場で横を向く（side は左へ約 34°、side_r は右へ約 29°）
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
      if (v && v.yawDelta !== undefined) {
        // 同じ場所で横を向く：肩越しのカメラの向きだけを変える（ドラッグで見回すのと同じ）
        const yaw0 = p.orbit.yaw;
        const pitch0 = p.orbit.pitch;
        p.orbit.yaw = yaw0 + v.yawDelta;
        if (v.pitch !== undefined) p.orbit.pitch = v.pitch;
        for (let i = 0; i < 30; i++) p.step(1 / 30, 0, 0);
        window.__restore = () => { p.orbit.yaw = yaw0; p.orbit.pitch = pitch0; for (let i = 0; i < 30; i++) p.step(1 / 30, 0, 0); };
      } else if (v) {
        p.camera.position.set(...v.cam);
        p.camera.fov = v.fov;
        p.camera.updateProjectionMatrix();
        p.camera.lookAt(...v.tgt);
        p.scene.traverse((o) => { if (o.isSkinnedMesh) o.visible = true; });
        if (p.renderNow) p.renderNow(); else p.renderer.render(p.scene, p.camera);
      }
    }, [variant, v]);
    await page.screenshot({ path: `${out}/${prefix}-${name}${variant === 'full' ? '' : '-' + variant}.png`, timeout: 900000 });
    await page.evaluate(() => { if (window.__restore) { window.__restore(); window.__restore = null; } });
    console.log('saved', name, variant);
  }
}
console.log('errors', JSON.stringify(errors));
await browser.close();
