// 町の物と見た目が合うかの確かめ（開発サーバー。Version 28 §3.3・§3.7）：新しい物へ本物の入力で歩き込み、止まった所から見た目の面までを光線で測る・
// 壁ぎわで本物のマウスの引きずりで見回して、カメラが物の中・向こうに入らないかを見る・町の入口から W だけで忠勝まで歩く。
//
// 確認の種類（出力の行にも書く）：
//   - 本物の入力：キーの W（押し続ける）・マウスの横と縦の引きずり（見回し）・タイトルの「はじめから」と演出の「スキップ」（クリック）・
//     町の急報（Version 28 §4.3。通りを北へ線を越えると 1 回）の Esc。
//   - 描画の省略：?q=low&render=manual（3D は描かない。歩きと見回しの時計・入力は実時間）。
//   - 直接状態変更：物へ歩き込む前・見回す前の立ち位置へ __game.teleport で置く（その後の歩きは本物の W）。
//   - 読むだけ：主人公とカメラの位置・当たり判定（layout.ts）・3D の形への光線（three の Raycaster。体の幅の中の 7 本 × 高さ 6 段の線で、
//     体の縁から見た目の面までの隙間。負は形に入っている）。人物・地面の起伏・草むら・空・山並み・接地の影は除く。
//   - 実機・性能：ここでは未確認（ソフトウェア描画）。
// 合格の目安：歩き込みは止まった所から見た目の面まで −0.06〜0.25 m（見えない壁で手前に止まらない・形に深く入らない）。
//   見回しはカメラが箱の中 0・肩の上からカメラまでの間に形 0。
//
// PARTS（カンマ区切り。既定はすべて）：entry, objects, camera
// 使い方：自動再読み込みなしの開発サーバーを自分用のポートで起動して
//   (PORT=8093 setsid nohup npx vite --config proto3d/blender/tools/vite.nohmr.mjs > /tmp/vite-8093.log 2>&1 &)
//   BASE=http://localhost:8093 node e2e/town-contact.mjs [出力先]
import { writeFileSync } from 'node:fs';
import { endStreetReport, launchBrowser, outDir, passStreetReport, skipCinematic } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/town-contact');
const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8093';
const PARTS = (process.env.PARTS ?? 'entry,objects,camera').split(',');
const T0 = Date.now();
const log = (t) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s] ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => JSON.stringify(v);
const POLL = { timeout: 900000, polling: 200 };
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.setDefaultTimeout(900000);
page.on('pageerror', (e) => log(`pageerror ${e.message.slice(0, 300)}`));
page.on('console', (m) => { if (m.type() === 'error') log(`console.error ${m.text().slice(0, 200)}`); });
const result = { entry: null, objects: [], camera: [] };
let fails = 0;
const check = (name, ok, extra) => { if (!ok) fails++; log(`${ok ? 'OK ' : 'NG '} ${name} ${extra ?? ''}`); return ok; };

await page.goto(`${BASE}/?q=low&render=manual`);
await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true, null, POLL);
await sleep(1500);
// 「はじめから」（本物のクリック。読み込みの直後は押しが届かないことがあるので、演出が出るまで押し直す）
for (let k = 0; k < 6; k++) {
  await page.locator('.g-btn[data-id="new:ieyasu1570"]').click().catch(() => {});
  if (await page.waitForFunction(() => !!document.querySelector('.g-layer[data-kind="cine"]'), null, { timeout: 60000, polling: 500 }).then(() => true, () => false)) break;
}
await skipCinematic(page, { what: '第一章の冒頭', log });
await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui && window.__game.world.ready, null, POLL);
await page.waitForFunction(() => window.__game.cast.filter((c) => c.pose).every((c) => c.model || !['tadakatsu', 'oda_envoy', 'asai_envoy'].includes(c.id)), null, POLL);
await sleep(1500);

// 光線の道具（three の Raycaster。開発の画面の three をそのまま読む）
await page.evaluate(async () => {
  const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/deps\/three\.js/.test(n));
  const T = await import(url);
  const L = await import('/src/layout.ts');
  const M = await import('/src/game/motion.ts');
  const F = await import('/src/game/follow.ts');
  const p3 = window.__p3;
  const skip = (o) => {
    for (let x = o; x; x = x.parent) { if (!x.visible) return true; if (x.isSkinnedMesh || x.isBone) return true; }
    const n = (o.name || '') + '|' + (o.material?.name || '');
    // 地面の起伏・草むら・空・山並み・接地の影の円盤は「ぶつかる物」ではない
    return /^(ground_terrain|ground_far|ground_field|ground_water|ground_ditch|grass|fern|azalea|plants)|contact|sky|hill/i.test(n) || o.material?.transparent && o.material.opacity < 0.6;
  };
  const meshes = [];
  p3.scene.updateMatrixWorld(true);
  p3.scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && !skip(o)) meshes.push(o); });
  // 人物（主人公・町の人・家臣）の形は除く（骨組みのある形の親を持つ物）
  const people = new Set();
  p3.scene.traverse((o) => { if (o.isSkinnedMesh) { let r = o; while (r.parent && r.parent !== p3.scene) r = r.parent; people.add(r); } });
  const notPeople = meshes.filter((m) => { let r = m; while (r.parent && r.parent !== p3.scene) r = r.parent; return !people.has(r); });
  const rc = new T.Raycaster();
  const nameOf = (o) => { const a = []; for (let x = o; x && x !== p3.scene; x = x.parent) if (x.name) a.push(x.name); return a.slice(0, 3).join('<'); };
  window.__t4 = {
    T, L, M, F, n: notPeople.length,
    /** (x, y, z) から水平の向き (dx, dz) へ、最初に当たる形（距離・名前） */
    ray(x, y, z, dx, dz, far = 4, dy = 0) {
      const d = new T.Vector3(dx, dy, dz).normalize();
      rc.set(new T.Vector3(x, y, z), d);
      rc.far = far;
      const hits = rc.intersectObjects(notPeople, false);
      return hits.slice(0, 3).map((h) => ({ d: +h.distance.toFixed(3), name: nameOf(h.object), mat: h.object.material?.name ?? '' }));
    },
    /** 当たり判定（歩く箱）の中で、(x, z) から向き (dx, dz) の線に最初に当たる箱までの距離 */
    rectHit(x, z, dx, dz) {
      const n = Math.hypot(dx, dz); dx /= n; dz /= n;
      let best = Infinity, which = null;
      for (const r of L.colliders()) {
        // 線分と箱の交わり（slab）
        let t0 = 0, t1 = 10;
        for (const [p, d, a, b] of [[x, dx, r.x0, r.x1], [z, dz, r.z0, r.z1]]) {
          if (Math.abs(d) < 1e-9) { if (p < a || p > b) { t0 = 1; t1 = 0; } continue; }
          let u = (a - p) / d, v = (b - p) / d; if (u > v) [u, v] = [v, u];
          t0 = Math.max(t0, u); t1 = Math.min(t1, v);
        }
        if (t0 <= t1 && t0 < best) { best = t0; which = r; }
      }
      return { d: best, rect: which };
    },
    HERO_RADIUS: M.HERO_RADIUS,
  };
  return notPeople.length;
}).then((n) => log(`光線の対象の形 ${n}`));
const pose = () => page.evaluate(() => ({ x: +window.__p3.hero.x.toFixed(3), z: +window.__p3.hero.z.toFixed(3), heading: +window.__p3.hero.heading.toFixed(3), yaw: +window.__p3.orbit.yaw.toFixed(3), prompt: window.__game.prompt?.id ?? window.__game.prompt ?? null }));
/** キーを押したまま、止まる（2 秒動かない）か cond が真になるまで */
async function holdUntilStop(keys, cond = async () => false, maxMs = 120000) {
  for (const k of keys) await page.keyboard.down(k);
  const t0 = Date.now();
  let last = await pose(); let lastMove = Date.now(); let reason = 'timeout';
  const track = [last];
  while (Date.now() - t0 < maxMs) {
    await sleep(250);
    const p = await pose();
    if (Math.hypot(p.x - last.x, p.z - last.z) > 0.01) { lastMove = Date.now(); last = p; track.push(p); }
    if (await cond(p)) { reason = 'cond'; break; }
    if (Date.now() - lastMove > 2000) { reason = 'stopped'; break; }
  }
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
  await sleep(300);
  return { end: await pose(), reason, ms: Date.now() - t0, track };
}

// ---------------------------------------------------------------- entry：町の入口から W だけで忠勝へ
if (PARTS.includes('entry')) {
  const s0 = await pose();
  const entry = await page.evaluate(async () => (await import('/src/town/spots.ts')).ENTRY_POSE);
  check('探索の始めは ENTRY_POSE（はじめから → 冒頭のスキップの後）', Math.abs(s0.x - entry.x) < 1e-3 && Math.abs(s0.z - entry.z) < 1e-3, J({ s0, entry }));
  const talk = () => page.evaluate(() => { const b = document.querySelector('.g-talk'); return !!b && !b.hidden && b.dataset.target === 'tadakatsu'; });
  // Version 28 §4.3：通りを北へ線（z≈6）を越えると、「はじめから」の回の中で 1 回だけ町の急報が始まる。そこまでを 1 本目の歩き、
  // 急報を Esc で飛ばし（飛ばすと使者は話せる位置・忠勝は城門の前に置かれる）、また W を押し続けて忠勝の「話す」までを 2 本目の歩きとして、
  // 2 本をつないだ道すじで「途中で引っかからない」を見る
  const cine = () => page.evaluate(() => !!document.querySelector('.g-layer[data-kind="cine"]'));
  const r1 = await holdUntilStop(['KeyW'], async () => cine(), 180000);
  check('W で北へ歩くと、線（z≈6）を越えた所で町の急報（ch1_report）が始まる', r1.reason === 'cond' && (await page.evaluate(() => window.__game.cine?.id)) === 'ch1_report' && r1.end.z < 6.05, J({ end: r1.end, reason: r1.reason, sec: r1.ms / 1000 }));
  await endStreetReport(page);
  log('町の急報を Esc で飛ばした（急報そのものの確かめは e2e/v28-envoy-event.mjs）');
  const r = await holdUntilStop(['KeyW'], async () => talk(), 180000);
  const track = [...r1.track, ...r.track];
  const xs = track.map((p) => p.x);
  const td = await page.evaluate(() => { const c = window.__game.cast.find((c) => c.id === 'tadakatsu'); const p = c?.pose ?? c; return p && typeof p.x === 'number' ? { x: p.x, z: p.z } : { x: -1.5, z: -7.2, from: 'design §3.1' }; });
  result.entry = { start: s0, event: r1.end, end: r.end, reason: r.reason, sec: (r1.ms + r.ms) / 1000, xMin: Math.min(...xs), xMax: Math.max(...xs), walked: track.reduce((a, p, i) => (i ? a + Math.hypot(p.x - track[i - 1].x, p.z - track[i - 1].z) : 0), 0), tadakatsu: td, dist: td ? Math.hypot(r.end.x - td.x, r.end.z - td.z) : null };
  check('W を押し続けるだけで（途中の町の急報は Esc で飛ばす）、城門の前の忠勝の「話す」が出る（途中で引っかからない）', r.reason === 'cond', J(result.entry));
} else {
  // 町の急報の前に線の北（町家 B の店先など）へ teleport すると、その場で急報が始まる。先に本物の W で線を越えて飛ばしておく
  await passStreetReport(page, { log });
}

// ---------------------------------------------------------------- objects：新しい物へ歩き込む
// [名前, 立ち位置 x, z, 進む向き（heading：0 = 南へ進む、π = 北へ、π/2 = 東へ、−π/2 = 西へ）]
const OBJECTS = [
  ['土蔵造りの店（kura28）の表へ東に', 1.6, 14.0, Math.PI / 2],
  ['西の板塀（nishi28 の塀）へ西に', -2.6, 14.6, -Math.PI / 2],
  ['西の小屋の店（nishi28）の床几へ西に', -2.6, 10.4, -Math.PI / 2],
  ['町家 B の店先（B28 の陳列台・軒下の犬走り）へ西に', -1.8, 4.6, -Math.PI / 2],
  ['町家 D の店先（D28 のばったり床几）へ東に', 1.4, 7.0, Math.PI / 2],
  ['荷車（props28 の cart）へ北に', -12.4, 12.6, Math.PI],
  ['柳の幹（tree_willow28）へ南に', -15.2, 11.6, 0],
  ['槍立て（props28 の spear_rack）へ東に', 4.9, 1.0, Math.PI / 2],
  ['木戸の東の柱（props28 の kido）へ南に', 2.95, 14.4, 0],
  ['物見櫓の脚（props28 の lookout_tower）へ南に', -7.9, 12.2, 0],
];
if (PARTS.includes('objects')) {
  for (const [name, x, z, heading] of OBJECTS) {
    await page.evaluate(([x, z, h]) => window.__game.teleport(x, z, h), [x, z, heading]);
    await sleep(500);
    const p0 = await pose();
    const placed = Math.hypot(p0.x - x, p0.z - z) < 0.01;
    // カメラは主人公の背後（向いている方を見る）。W で向いている方へまっすぐ進む
    const r = await holdUntilStop(['KeyW'], async () => false, 60000);
    const e = r.end;
    const dx = Math.sin(heading), dz = Math.cos(heading);
    const m = await page.evaluate(([x, z, dx, dz]) => {
      const t = window.__t4;
      const R = t.HERO_RADIUS;
      const hs = [0.1, 0.3, 0.6, 0.9, 1.2, 1.6];
      // 体の幅の中の何本もの線（横のずれ o。体の表面はその線の上で中心から √(R²−o²) 先）。見た目の面までの隙間の最小
      const offs = [-0.26, -0.18, -0.1, 0, 0.1, 0.18, 0.26];
      const px = -dz, pz = dx;
      const rays = [];
      let best = { gap: Infinity, y: null, o: null, hit: null };
      for (const y of hs) for (const o of offs) {
        const hits = t.ray(x + px * o, y, z + pz * o, dx, dz, 3);
        if (!hits[0]) continue;
        const gap = hits[0].d - Math.sqrt(R * R - o * o);
        rays.push({ y, o, gap: +gap.toFixed(3), hit: hits[0] });
        if (gap < best.gap) best = { gap, y, o, hit: hits[0] };
      }
      const rect = t.rectHit(x, z, dx, dz);
      return { R, rays, best, rect: { d: +rect.d.toFixed(3), r: rect.rect } };
    }, [e.x, e.z, dx, dz]);
    const moved = Math.hypot(e.x - p0.x, e.z - p0.z);
    const gap = m.best.gap; // 体の縁から見た目の面まで（負なら体が形に入っている）
    const rec = { name, start: { x, z }, placed, moved: +moved.toFixed(3), end: e, reason: r.reason, bodyToSurface: +gap.toFixed(3), at: { y: m.best.y, o: m.best.o, hit: m.best.hit }, collider: m.rect.r, rays: m.rays };
    result.objects.push(rec);
    const ok = placed && r.reason === 'stopped' && moved > 0.2 && gap > -0.06 && gap < 0.25;
    check(`歩き込み：${name}`, ok, `進んだ ${moved.toFixed(2)} m・止まった (${e.x.toFixed(2)}, ${e.z.toFixed(2)})・体の縁から見た目の面まで ${gap.toFixed(3)} m（高さ ${m.best.y} m・横 ${m.best.o} m の線、形 ${m.best.hit?.name}）`);
  }
}

// ---------------------------------------------------------------- camera：壁ぎわで見回してもカメラが物に入らない
// 壁ぎわの立ち位置（歩き込んで止まった所）で、本物のマウスの横の引きずりで 1 周（30 回 × 40px ≈ 6.6 rad）・上下にも少し
const CAM_SPOTS = [
  ['土蔵造りの店の表の前', 1.6, 14.0, Math.PI / 2],
  ['西の板塀の前', -2.6, 14.6, -Math.PI / 2],
  ['町家 B の軒下（犬走りの上）', -1.8, 4.6, -Math.PI / 2],
  ['町家 D と土蔵造りの店の間の路地', 6.5, 11.85, Math.PI / 2],
  ['物見櫓の脚の前', -7.9, 12.2, 0],
];
if (PARTS.includes('camera')) {
  for (const [name, x, z, heading] of CAM_SPOTS) {
    await page.evaluate(([x, z, h]) => window.__game.teleport(x, z, h), [x, z, heading]);
    await sleep(300);
    await holdUntilStop(['KeyW'], async () => false, 30000);
    const lz = { x: 700, y: 360 };
    let worst = null; let insideN = 0; let losN = 0; let nearN = 0; let n = 0;
    const samples = [];
    for (const [pitchPx, label] of [[0, '水平'], [-40, '見上げ'], [60, '見下ろし']]) {
      // 上下を合わせる
      if (pitchPx) { await page.mouse.move(lz.x, lz.y); await page.mouse.down(); await page.mouse.move(lz.x, lz.y + pitchPx, { steps: 4 }); await page.mouse.up(); }
      for (let i = 0; i < 30; i++) {
        await page.mouse.move(lz.x, lz.y);
        await page.mouse.down();
        await page.mouse.move(lz.x + 40, lz.y, { steps: 3 });
        await page.mouse.up();
        await sleep(120);
        const s = await page.evaluate(() => {
          const p3 = window.__p3; const t = window.__t4;
          // 実際のカメラの置き場所は毎コマの更新で決まる（描画はしない）。ここで 1 コマ分を確実に進める代わりに、少し待った後のカメラを読む
          const c = p3.camera.position;
          const h = p3.hero;
          const piv = t.F.placeFollow({ yaw: p3.orbit.yaw, pitch: p3.orbit.pitch, dist: p3.orbit.dist }, h.x, h.z, 0).pivot;
          const v = { x: c.x - piv.x, y: c.y - piv.y, z: c.z - piv.z };
          const L = Math.hypot(v.x, v.y, v.z);
          // 肩の上（見る中心）からカメラまでの間に形があるか（カメラが壁の向こう・形の中）
          const los = L > 0.05 ? t.ray(piv.x, piv.y, piv.z, v.x, v.z, L, v.y) : [];
          // カメラのすぐそば（近くの切り取り面 0.1 m より少し外の 0.12 m）に面があるか：6 方向
          const dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
          const near = dirs.map(([a, b, cc]) => t.ray(c.x, c.y, c.z, a, cc, 0.12, b)).filter((hh) => hh.length);
          return { yaw: +p3.orbit.yaw.toFixed(2), pitch: +p3.orbit.pitch.toFixed(2), cam: [c.x, c.y, c.z].map((q) => +q.toFixed(2)), dist: +p3.orbit.dist.toFixed(2), inside: p3.cameraInside(), los: los.length ? los[0] : null, near: near.length ? near[0][0] : null, camNear: p3.camera.near };
        });
        n++;
        if (s.inside) insideN++;
        if (s.los) losN++;
        if (s.near) nearN++;
        if ((s.inside || s.los || s.near) && samples.length < 12) samples.push({ label, ...s });
      }
      if (pitchPx) { await page.mouse.move(lz.x, lz.y); await page.mouse.down(); await page.mouse.move(lz.x, lz.y - pitchPx, { steps: 4 }); await page.mouse.up(); }
    }
    result.camera.push({ name, n, insideN, losN, nearN, samples });
    check(`見回し：${name}（${n} 向き）でカメラが物の中・向こうに入らない`, insideN === 0 && losN === 0, `箱の中 ${insideN}・肩からカメラの間に形 ${losN}・カメラの 0.12 m 以内に面 ${nearN} ${samples.length ? J(samples.slice(0, 3)) : ''}`);
  }
}
writeFileSync(`${OUT}/town-contact.json`, JSON.stringify(result, null, 1));
log(`done fails=${fails}`);
await browser.close();
process.exit(fails ? 1 : 0);
