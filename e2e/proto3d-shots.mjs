// 3D 比較版の改修前・改修後を、同じ場所・同じ昼の条件で撮る（実際のゲーム画面）。
//   full   ：標準の画角（全景）
//   near   ：近めの探索用の画角（同じ場所）
//   house  ：民家の表の近景（標準の向きのまま近づける ?zoom）
//   wall   ：民家の角の近景（横の漆喰壁・柱・腰の板・軒）
//   hero   ：人物の近景（こちらを向いた若殿）
//   heroWalk：人物の近景（歩いている途中の姿。1 コマずつ進めて止めたもの）
// 使い方: npm run proto3d:dev を起動しておき、node e2e/proto3d-shots.mjs <before|after> [出力先] [撮る名前,…]
import { launchBrowser, outDir } from './lib.mjs';

const variant = process.argv[2] === 'before' ? 'before' : 'after';
const S = outDir(process.argv[3]);
const BASE = process.env.BASE3D || 'http://localhost:8090';
const browser = await launchBrowser();
const models = variant === 'before' ? '&models=before' : '';
// 若殿は町家の前の道（表の格子と暖簾が見える位置）
const SPOT = { x: -2.3, z: -1.2 };
const TOWARD_CAMERA = Math.atan2(Math.sin((28 * Math.PI) / 180), Math.cos((28 * Math.PI) / 180));

const shots = [
  { name: 'full', q: '', heading: -1.9, walk: false },
  { name: 'near', q: '&cam=near', heading: -1.9, walk: false },
  { name: 'house', q: '&zoom=0.42', heading: -1.9, walk: false, at: { x: -1.2, z: -0.6 } },
  { name: 'wall', q: '&zoom=0.42', heading: -1.9, walk: false, at: { x: -6.2, z: 3.1 } },
  { name: 'hero', q: '&zoom=0.2', heading: TOWARD_CAMERA, walk: false },
  { name: 'heroWalk', q: '&zoom=0.26', heading: TOWARD_CAMERA + 0.6, walk: true },
];

const only = process.argv[4] ? process.argv[4].split(',') : null;
for (const s of shots) {
  if (only && !only.includes(s.name)) continue;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(300000);
  await page.goto(`${BASE}/?x=1${models}${s.q}`);
  await page.waitForFunction(() => window.__p3?.stats.readyMs > 0, null, { timeout: 120000 });
  const at = s.at ?? SPOT;
  await page.evaluate(([x, z, h, walk]) => {
    const p = window.__p3;
    p.manual();
    p.hero.x = x; p.hero.z = z; p.hero.heading = h; p.hero.speed = 0;
    for (let i = 0; i < 40; i++) p.step(1 / 30, 0, 0);
    if (walk) {
      // 向いている方向へ少し歩かせ、歩きの途中で止めて撮る（入力は向きと同じ方向）
      const yaw = (28 * Math.PI) / 180;
      const gx = Math.sin(h), gz = Math.cos(h);
      const ix = Math.cos(yaw) * gx - Math.sin(yaw) * gz, iy = Math.sin(yaw) * gx + Math.cos(yaw) * gz;
      for (let i = 0; i < 26; i++) p.step(1 / 30, ix, iy);
    }
  }, [at.x, at.z, s.heading, s.walk]);
  await page.screenshot({ path: `${S}/${variant}-${s.name}.png` });
  console.log('saved', `${variant}-${s.name}.png`);
  await page.close();
}
await browser.close();
