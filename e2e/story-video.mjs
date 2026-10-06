// 物語の演出を「通常速度」で動画に撮って確かめる（開発サーバー・描画あり ?q=low。render=manual は付けない）。
// 依頼：docs/story-rpg-request.md【1】【5】【7】（アニメーションの確認を静止画や一コマずつ進めた画像だけで完了にしない）・設計 docs/story-rpg-design.md §1〜§3。
//
// 撮り方：CDP の Page.startScreencast でコマと、そのコマが画面に出た時刻（metadata.timestamp）を止めずに受け取り、
//   撮り終えてから、時刻どおりにコマを並べて（次のコマが来るまで同じコマを繰り返して）25 コマ／秒の webm（VP8）にする
//   （Playwright の ffmpeg：image2pipe の mjpeg → libvpx）。page.screenshot は再生中に使わない（10〜20 秒止まるため）。
//   同時に、ページの中で毎コマ（requestAnimationFrame）の記録を取る：実時間（performance.now）・演出の時計 t・場面・字幕・3D の出来事・カメラ・主人公。
//   動画から場面の中ほどのコマを ffmpeg -ss で抜き出す（PNG）。
//
// 確認の種類（出力の行にも書く）：
//   - 本物の入力：タイトルの「はじめから」「つづきから」・結末の「第二章へ進む」・結果確認の「城下へ」・演出の「一時停止」「スキップ」「見直す」「閉じる」（クリック）・
//     キー（Space・→・←・Esc・J・W）・城門の確認の選択肢・合戦の「合戦を始める」・指揮（Space）・全軍撤退と確認・結果の「続ける」。
//   - 早送り：合戦の待つ間だけ（全軍撤退を出した後、指揮（一時停止）のまま window.__battle.fastForward(1) で結果まで）。動画には入れない。
//   - 描画の省略：無し（どの部も描画あり・画質「低」。演出の時計は実時間で進むが、このコンテナは 3D を描くと 1 コマに 1〜2 秒かかり、
//     演出の時計の 1 コマの上限 1 秒のため、3D の場面の時計は実時間より遅れる。その割合を場面ごとに出す）。
//   - 直接状態変更：見張りの保存（2D・架空・演習）を入れる・ch2 は第一章の結末の保存（tests/fixtures/ieyasu-ch1-v3/）を localStorage に入れる・
//     depart は __game.setIeyasuPhase('muster') から始め、__game.teleport で城門の手前へ置く（そこから城門へは本物の W で歩く）。
//     台本（spec）はページの中でシナリオの cinematic を読んで比べる（読むだけ）。保存の書き込みの数え上げ（setItem を包む）は観察だけ。
//   - 実機・性能：ここでは未確認（ソフトウェア描画の headless Chromium。3D の場面の滑らかさは実機で確かめていない）。
//
// PARTS（カンマ区切り。既定はすべて）：
//   intro     第一章の導入を、タイトルの「はじめから」の本物のクリックから最後まで（844×390）。終わった後に主人公・カメラが戻り、W で歩けるか
//   ch2       第二章への移行（第一章の結末の保存から。「つづきから」→「第二章へ進む」→ 演出 → 結果確認 →「城下へ」）。
//             保存は CH2（カンマ区切り。tests/fixtures/ieyasu-ch1-v3/ の名前）で選ぶ。既定は oda_victory_kept,home_defeat_broken_heavy,asai_victory_kept
//             （A 勝ち・約束を守った／C 負け・約束を破った・損害大／B 勝ち・約束を守った）
//   depart    出陣（城門で「出陣する」）と帰還（合戦は全軍撤退 → 結果の「続ける」）を 1 回ずつ
//   reduced   動きを減らす設定（端末の prefers-reduced-motion を模擬）での第一章の導入
//   controls  一時停止（クリック）・再開（Space）・次の場面（→）・前の場面（←）・スキップ（クリック）→ 城下 → J → 情勢の「見直す」→ Esc でスキップ → 「閉じる」
//   ch2a      第二章 A（織田勢の撤収を支える）を、第一章の結末の保存から戦後の城下まで、どの演出もスキップせずにつなぐ（docs/ch2a-reason-request.md の確認）：
//             「つづきから」→「第二章へ進む」→ 移行の演出 →「城下へ」→ J（情勢）→ 忠勝と軍議 → 判断 → 石川と補充 → 城門で「出陣する」→ 出陣の演出 →
//             合戦 → 結果の「続ける」→ 帰還の演出 → 戦後の城下 → J（情勢）。
//             CH2A（カンマ区切り。保存:判断:補充:合戦の手）で選ぶ。合戦の手は rear_hold などの作戦の id（chapter2/scripts.ts。命令は本物の入力）・
//             allret（開始直後に全軍撤退。本物のクリック）・nothing（命令を出さない）。どれも待つ間は早送り。
//             人の近くへは開発用の口（__game.teleport。直接状態変更）で移し、そこから本物の W で歩いて「話す」を出し、E で話す。行送りは Enter・選択は本物のクリック。
//             動画は 1 回につき 2 本：<tag>-a（結末の画面 → 合戦の説明の画面）・<tag>-b（結果の画面 → 戦後の城下）。合戦の早送りの間は撮らない
// 使い方：自動再読み込みなしの開発サーバーを自分用のポートで起動して
//   (PORT=8097 setsid nohup npx vite --config proto3d/blender/tools/vite.nohmr.mjs > /tmp/vite-8097.log 2>&1 &)
//   BASE=http://localhost:8097 node e2e/story-video.mjs [出力先（既定 e2e-out/story-video）]
//   出力：<部>.webm・<部>-<台本>-b<場面>-<種類>.png（場面の中ほどのコマ）・<部>-<印>.png（印の 1 秒後など）・summary-<部>.json（まとめ）・
//   log-<部>.json（ページの毎コマの記録・入力の時刻・画面の流しのコマの時刻）
//   NG の行は「見つけたこと」（このコンテナの重い 3D のコマで起きるものを含む）。実機の滑らかさはここでは確かめられない
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { launchBrowser, outDir } from './lib.mjs';
import { battleIO, driveTactic, fastForwardToResult } from './ch2-drive.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/story-video');
const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8097';
const PARTS = (process.env.PARTS || 'intro,ch2,depart,reduced,controls').split(',').map((s) => s.trim()).filter(Boolean);
/** 第二章への移行を撮る第一章の結末の保存（tests/fixtures/ieyasu-ch1-v3/ の名前） */
const CH2 = (process.env.CH2 || 'oda_victory_kept,home_defeat_broken_heavy,asai_victory_kept').split(',').map((s) => s.trim()).filter(Boolean);
/**
 * 第二章 A をつなぐ回（保存:判断:補充:合戦の手）。既定：
 *   1. 第一章で勝った保存 → 判断 1（殿を引き受ける）・補充「待つ」・作戦 rear_hold（本物の入力）で主目標を果たす
 *   2. 第一章で負けた保存（損害大）→ 判断 1・補充なし・命令を出さない（主目標を果たせない）
 *   3. 第一章で勝った保存 → 判断 2（退き口の手前を固める）・補充「待つ」・開始直後に全軍撤退（主目標を果たせない）
 *   （A の判断 1 で開始直後に全軍撤退すると、撤収の対象が退き口から離れて勝つ：tests/proto3d-ieyasu-ch2-allretreat.test.ts）
 */
const CH2A = (process.env.CH2A || 'oda_victory_kept:commit:wait:rear_hold,oda_defeat_broken_heavy:commit:none:nothing,oda_victory_kept:hold:wait:allret')
  .split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const [name, plan, recovery, tactic] = s.split(':'); return { name, plan, recovery, tactic }; });
const FFMPEG = process.env.FFMPEG || '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';
const FPS = 25;
const VIEW = { width: 844, height: 390 };
const browser = await launchBrowser();
let failed = 0;
let oks = 0;
const T0 = Date.now();
const secs = () => `${((Date.now() - T0) / 1000).toFixed(0)}s`;
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  else oks++;
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}  [${secs()}]`);
};
const note = (t) => console.log(`   ${t}  [${secs()}]`);
const errors = [];
const POLL = { timeout: 600000, polling: 100 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (v) => JSON.stringify(v);
const KEY = 'koto-sengoku/3d-ieyasu1570';
const KEY_CH1 = 'koto-sengoku/3d-ieyasu1570/chapter1';
const PREFS = 'koto-sengoku/3d-prefs';
const SENT = { 'koto-sengoku/save': '{"2d":"keep"}', 'koto-sengoku/3d-chapter1': '{"sentinel":"fictional"}', 'koto-sengoku/3d-fields': '{"sentinel":"practice"}' };
const fixture = (n) => readFileSync(new URL(`../tests/fixtures/ieyasu-ch1-v3/${n}.json`, import.meta.url), 'utf8');
/** 開始の位置と向き・見回し（proto3d/blender/scene.json の hero_start。e2e の決まり） */
const START = { x: 0.3, z: -1.5, yaw: 0.36 };

// ================================================================ ページ
async function open({ reducedMotion = 'no-preference', main = null, viewport = VIEW } = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion });
  const page = await ctx.newPage();
  page.setDefaultTimeout(600000);
  let reloading = false;
  const onErr = (text) => {
    if (/Couldn't load texture blob:/.test(text) && reloading) return;
    errors.push(text);
    console.log(`   ！ページの誤り [${secs()}] ${text.slice(0, 200)}`);
  };
  page.on('pageerror', (e) => onErr(e.message));
  page.on('console', (m) => { if (m.type() === 'error') onErr(m.text()); });
  await page.goto(BASE + '/?q=low');
  // 人物の素材を読み終えてから読み込み直す（読み込みの途中で読み込み直すと、取りやめた読み込みの誤りが出るため）
  await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && window.__game.world.ready, null, POLL);
  // 見張りの保存（2D・架空・演習）を入れ、歴史分岐の保存は main（null なら消す）（直接状態変更）
  await page.evaluate(([s, k, k1, p, v]) => {
    localStorage.clear();
    for (const [kk, vv] of Object.entries(s)) localStorage.setItem(kk, vv);
    localStorage.removeItem(k1);
    localStorage.removeItem(p);
    if (v !== null) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  }, [SENT, KEY, KEY_CH1, PREFS, main]);
  reloading = true;
  try { await page.reload(); } finally { reloading = false; }
  await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && document.getElementById('loading')?.hidden === true && window.__game.world.ready, null, POLL);
  await countWrites(page);
  return { ctx, page };
}
/** 保存の書き込みを数える（setItem を包む。観察だけ） */
const countWrites = (page) => page.evaluate(() => {
  window.__writes = {};
  if (window.__writesWrapped) return;
  window.__writesWrapped = true;
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    window.__writes[k] = (window.__writes[k] ?? 0) + 1;
    return orig.call(this, k, v);
  };
});
const writes = (page) => page.evaluate(() => ({ ...window.__writes }));
const ui = (page) => page.evaluate(() => window.__game.ui);
const st = (page) => page.evaluate(() => (window.__game.state ? JSON.parse(JSON.stringify(window.__game.state)) : null));
const norm = (s) => { if (!s) return s; const c = { ...s }; delete c.playTimeSec; delete c.savedAt; return c; };
const waitUi = (page, kind) => page.waitForFunction((k) => window.__game.ui?.kind === k, kind, POLL);
const waitExplore = (page) => page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
const pose = (page) => page.evaluate(() => {
  const c = window.__p3.camera.position;
  return { x: window.__p3.hero.x, z: window.__p3.hero.z, heading: window.__p3.hero.heading, yaw: window.__p3.orbit.yaw, pitch: window.__p3.orbit.pitch, dist: window.__p3.orbit.dist, cam: [c.x, c.y, c.z], shot: window.__game.world.cameraShot, stage: window.__game.world.stageProbe(), body: document.body.className };
});
/** 台本（ページの中でシナリオの cinematic を読む。読むだけ） */
const specOf = (page, moment, replay = false) => page.evaluate(([m, r]) => {
  const g = window.__game;
  const sc = g.game.scenarios.find((x) => x.id === g.scenario);
  return sc?.cinematic ? sc.cinematic(g.state, m, r ? { replay: true } : undefined) : null;
}, [moment, replay]);

// ================================================================ 撮る（CDP の画面の流し）と、ページの中の毎コマの記録
/** ページの中で毎コマ（rAF）の記録を取る：実時間・演出の時計・場面・字幕・3D の出来事・カメラ・主人公。字幕と見出しは変わった時に大きさと位置を測る */
const LOGGER = () => {
  window.__vlog = [];
  window.__vcap = [];
  window.__vkeys = [];
  window.__vin = [];
  window.__vlogOn = true;
  // 本物の入力の時刻（押してから画面が変わるまでの遅れを測る。観察だけ）
  if (!window.__vinOn) {
    window.__vinOn = true;
    const onIn = (e) => {
      if (window.__vlogOn) window.__vin.push({ type: e.type, w: performance.now(), key: e.code ?? null, id: e.target?.closest?.('[data-id]')?.dataset?.id ?? null, repeat: !!e.repeat });
    };
    for (const t of ['pointerdown', 'keydown']) window.addEventListener(t, onIn, true);
  }
  let lastCap = null;
  let lastHead = null;
  let lastKey = undefined;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  /** 地図の場面で見る印（場所 data-place・線 data-route） */
  const MAP_MARKS = [
    ['camp', '[data-place="oda_camp"]'],
    ['main', '[data-route="withdraw.oda_main"]'],
    ['rear', '[data-route="withdraw.oda_rear"]'],
    ['threat', '[data-route^="threat."]'],
    ['march', '[data-route^="march."]'],
    ['return', '[data-route^="return."]'],
  ];
  // w は rAF の時刻（そのコマの始まり＝前のコマを描き終えた頃。演出の時計もこの差で進む）。wl は記録した瞬間（3D を描いた後になることがある）
  const loop = (ts) => {
    if (!window.__vlogOn) return;
    try {
      const g = window.__game;
      const c = g.cine;
      const w = g.world;
      const sp = w.stageProbe();
      const cam = window.__p3.camera;
      const V = cam.position.constructor;
      const d = cam.getWorldDirection(new V());
      const h = window.__p3.hero;
      const o = window.__p3.orbit;
      const L = document.querySelector('.g-layer[data-kind="cine"]');
      const people = w.stageActors?.people;
      const ppl = sp.active && people ? [...people.values()].map((a) => [Math.round(a.body.root.position.x * 100) / 100, Math.round(a.body.root.position.z * 100) / 100]) : [];
      const row = {
        w: ts, wl: performance.now(), ui: g.ui?.kind ?? null, screen: g.screen, id: c?.id ?? null, t: c?.t ?? null, beat: c?.beat ?? null, count: c?.count ?? null, mode: c?.mode ?? null,
        state: c?.state ?? null, paused: c?.paused ?? null, reduced: c?.reduced ?? null, cap: c?.caption?.text ?? null, info: c?.info?.length ?? 0,
        ev: sp.event, st: r3(sp.t), people: sp.people, figures: sp.figures, hidden: sp.hiddenCast.length, hideHero: !!sp.shot?.hideHero,
        cam: [r3(cam.position.x), r3(cam.position.y), r3(cam.position.z)], dir: [r3(d.x), r3(d.y), r3(d.z)],
        hero: [r3(h.x), r3(h.z), r3(h.heading)], yaw: r3(o.yaw), pitch: r3(o.pitch), ppl,
        appearing: L ? L.querySelectorAll('.g-cine-map [data-state="appearing"]').length : 0,
        // 3D の場面の始めの待ち（字幕と見出しの不透明な層を 1 コマ出してから 3D の最初の画を描く。data-wait="1"）
        wait: L?.dataset?.wait === '1',
        // 演出の後、合戦の画面が出るまでの覆い（不透明な「（戦場）へ…」）・探索の操作の案内が見えるか・合戦の画面か
        load: (() => { const e = document.querySelector('.g-layer.g-loading[data-kind="loading"]'); return e ? (e.classList.contains('opaque') ? 'opaque' : 'clear') + ':' + (e.textContent ?? '') : null; })(),
        hold: document.body.classList.contains('g-hold'),
        help: (() => { const e = document.getElementById('help'); return !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0; })(),
        runBtn: (() => { const e = document.getElementById('run-btn'); return !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0; })(),
        battle: document.body.classList.contains('mode-battle'),
        // 地図の場面の印（第二章 A の撤収のわけ）：場所・線の data-state（* は強調）。地図の場面のときだけ
        mp: (() => {
          if (!L || c?.mode !== 'map') return null;
          const q = (s) => { const e = L.querySelector(`.g-cine-map ${s}`); return e ? e.dataset.state + (e.dataset.hl === '1' ? '*' : '') : '-'; };
          return MAP_MARKS.map(([k, s]) => `${k}:${q(s)}`).join(',');
        })(),
      };
      window.__vlog.push(row);
      if (L) {
        const capEl = L.querySelector('.g-cine-cap');
        const txt = capEl?.querySelector('.txt');
        const who = capEl?.querySelector('.who');
        const head = L.querySelector('.g-cine-heading');
        const capText = txt?.textContent ?? '';
        const headText = head?.textContent ?? '';
        if (capText !== lastCap || headText !== lastHead) {
          lastCap = capText;
          lastHead = headText;
          const cs = getComputedStyle(txt);
          const hs = getComputedStyle(head);
          const cr = capEl.getBoundingClientRect();
          const hr = head.getBoundingClientRect();
          window.__vcap.push({
            w: row.w, cap: capText, who: who && !who.hidden ? who.textContent : '', capPx: parseFloat(cs.fontSize), capLines: capText ? txt.getClientRects().length : 0,
            capTrunc: capEl.scrollHeight > capEl.clientHeight + 1, capRect: [cr.left, cr.top, cr.right, cr.bottom].map(Math.round),
            capBg: getComputedStyle(L.querySelector('.g-cine-bottom')).backgroundColor,
            head: headText, headPx: parseFloat(hs.fontSize), headLines: Math.round(hr.height / (parseFloat(hs.lineHeight) || parseFloat(hs.fontSize) * 1.3)), headTrunc: head.scrollWidth > head.clientWidth + 1, headRect: [hr.left, hr.top, hr.right, hr.bottom].map(Math.round),
            vw: innerWidth, vh: innerHeight,
          });
        }
      }
      const key = w.stageKey ?? null;
      if (key !== lastKey) {
        lastKey = key;
        window.__vkeys.push({ w: row.w, key });
      }
    } catch (e) {
      window.__vlogErr = String(e?.stack ?? e);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};

/** 撮り始める（ページの中の記録と画面の流し） */
async function startRec(page, tag) {
  await page.evaluate(LOGGER);
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => {
    frames.push({ ts: f.metadata.timestamp * 1000, data: f.data });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  const wall0 = Date.now();
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });
  note(`[${tag}] 撮り始め（CDP の画面の流し・ページの中の毎コマの記録）`);
  return { tag, page, cdp, frames, wall0, marks: [] };
}
/** 動画の中の印（あとでそのコマを抜き出す） */
const mark = (rec, label, after = 1.0) => rec.marks.push({ label, at: Date.now(), after });
async function stopRec(rec) {
  await rec.cdp.send('Page.stopScreencast');
  const wall1 = Date.now();
  await sleep(300);
  const { log, cap, keys, inputs, origin, err } = await rec.page.evaluate(() => {
    window.__vlogOn = false;
    return { log: window.__vlog, cap: window.__vcap, keys: window.__vkeys, inputs: window.__vin, origin: performance.timeOrigin, err: window.__vlogErr ?? null };
  });
  await rec.cdp.detach().catch(() => {});
  if (err) note(`[${rec.tag}] ！ページの中の記録の誤り：${err.slice(0, 200)}`);
  note(`[${rec.tag}] 撮り終え：画面の流しのコマ ${rec.frames.length}・ページの記録 ${log.length} コマ・実時間 ${((wall1 - rec.wall0) / 1000).toFixed(1)} 秒`);
  return { ...rec, wall1, log, cap, keys, inputs, origin };
}

/** コマを時刻どおりに並べて 25 コマ／秒の webm にする（次のコマが来るまで同じコマを繰り返す） */
async function encode(rec) {
  const frames = [...rec.frames].sort((a, b) => a.ts - b.ts);
  if (frames.length === 0) throw new Error(`[${rec.tag}] コマが 1 つも来ない`);
  const file = `${OUT}/${rec.tag}.webm`;
  const t0 = rec.wall0;
  const n = Math.max(1, Math.ceil((rec.wall1 - t0) / (1000 / FPS)));
  const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-vf', `scale=${VIEW.width}:${VIEW.height}`, '-c:v', 'libvpx', '-b:v', '2M', '-crf', '8', '-deadline', 'good', '-cpu-used', '4', '-auto-alt-ref', '0', '-pix_fmt', 'yuv420p', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  let exited = false;
  const done = new Promise((res, rej) => { ff.on('exit', (c) => { exited = true; if (c === 0) res(); else rej(new Error(`ffmpeg ${c}`)); }); ff.on('error', rej); });
  ff.stdin.on('error', () => {});
  const exitP = new Promise((r) => ff.once('exit', r));
  let j = 0;
  const used = new Set();
  for (let i = 0; i < n; i++) {
    const at = t0 + (i * 1000) / FPS;
    while (j + 1 < frames.length && frames[j + 1].ts <= at) j++;
    const f = frames[j];
    if (!f.buf) f.buf = Buffer.from(f.data, 'base64');
    used.add(j);
    if (exited) break;
    if (!ff.stdin.write(f.buf)) await Promise.race([new Promise((r) => ff.stdin.once('drain', r)), exitP]);
  }
  ff.stdin.end();
  await done;
  const bytes = statSync(file).size;
  const firstLag = (frames[0].ts - t0) / 1000;
  note(`[${rec.tag}] 動画 ${file}：${(n / FPS).toFixed(1)} 秒・${n} コマ（25 コマ／秒）・元のコマ ${frames.length}（使った ${used.size}）・${(bytes / 1e6).toFixed(1)} MB・最初のコマは撮り始めの ${firstLag.toFixed(2)} 秒後`);
  return { file, sec: n / FPS, outFrames: n, srcFrames: frames.length, usedFrames: used.size, bytes };
}
/** 動画の sec 秒のコマを PNG に抜き出す（ffmpeg -ss） */
function extract(video, sec, file) {
  return new Promise((res, rej) => {
    const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', sec.toFixed(2), '-i', video, '-frames:v', '1', file], { stdio: ['ignore', 'inherit', 'inherit'] });
    ff.on('exit', (c) => (c === 0 ? res(file) : rej(new Error(`ffmpeg ${c}`))));
  });
}

/**
 * 記録をまとめる：演出ごと・場面ごとの実時間と時計の進み（割合）・記録のコマの数・画面の流しのコマの数・3D の出来事・カメラの動き・字幕の出ていた実時間と大きさ。
 * specs：演出の id → 台本（字幕の要る時間を比べる）
 */
function analyze(rec, specs = {}) {
  const { log, origin, wall0 } = rec;
  const vsec = (w) => (origin + w - wall0) / 1000;
  const frameTs = rec.frames.map((f) => f.ts).sort((a, b) => a - b);
  const framesIn = (w0, w1) => frameTs.filter((ts) => ts >= origin + w0 && ts < origin + w1).length;
  // 演出の区間（id が続く所。見直しは別の区間）
  const runs = [];
  let cur = null;
  log.forEach((r, i) => {
    if (r.id !== null) {
      // 見直しは、間に情勢の画面（演出の無いコマ）が挟まるので別の区間になる（← で前の場面へ戻っても同じ区間）
      if (!cur || cur.id !== r.id) {
        cur = { id: r.id, i0: i, i1: i };
        runs.push(cur);
      } else cur.i1 = i;
    } else cur = null;
  });
  const out = [];
  for (const run of runs) {
    const rows = log.slice(run.i0, run.i1 + 1);
    const sp = specs[run.id] ?? null;
    const sb = sp ? sp.beats.map((x, i) => ({ x, i })).sort((p, q) => p.x.start - q.x.start || p.i - q.i).map((y) => y.x) : null;
    const wEndNext = log[run.i1 + 1]?.w ?? rows.at(-1).w;
    const beats = [];
    let b = null;
    rows.forEach((r, k) => {
      if (!b || b.beat !== r.beat) {
        b = { beat: r.beat, mode: r.mode, k0: k, k1: k };
        beats.push(b);
      } else b.k1 = k;
    });
    const beatOut = beats.map((bb, idx) => {
      const rr = rows.slice(bb.k0, bb.k1 + 1);
      const wStart = rr[0].w;
      const wNext = idx + 1 < beats.length ? rows[beats[idx + 1].k0].w : wEndNext;
      const tStart = rr[0].t;
      const tEnd = rr.at(-1).t;
      const wallLast = (rr.at(-1).w - wStart) / 1000;
      // 場面の中の進み（最初のコマを除く：場面に入るコマの飛びを含めない）
      const inner = rr.length > 2 && rr.at(-1).w > rr[1].w ? (tEnd - rr[1].t) / ((rr.at(-1).w - rr[1].w) / 1000) : null;
      // 場面に入った最初のコマで、場面の始まりから何秒進んでいたか（その分の地図・字幕は画面に出ない）
      const headSkip = sb?.[bb.beat] ? +(tStart - sb[bb.beat].start).toFixed(2) : null;
      // 1 コマで時計が進んだ最大（1 コマの上限 1 秒。重いコマの後は大きく進む）
      let maxTick = 0;
      for (let k = 1; k < rr.length; k++) maxTick = Math.max(maxTick, (rr[k].t ?? 0) - (rr[k - 1].t ?? 0));
      if (idx + 1 < beats.length) maxTick = Math.max(maxTick, (rows[beats[idx + 1].k0].t ?? 0) - (rr.at(-1).t ?? 0));
      // 地図の場面：台本の長さのうち、画面に出なかった時間（台本の長さ − 画面に出ていた実時間。地図は通常速度なので）
      const specDur = sb?.[bb.beat] ? sb[bb.beat].end - sb[bb.beat].start : null;
      const wall = (wNext - wStart) / 1000;
      const evs = [...new Set(rr.map((r) => r.ev).filter(Boolean))];
      const camSet = new Set(rr.map((r) => r.cam.join(',') + '|' + r.dir.join(',')));
      let camStep = 0;
      let camJumps = 0;
      for (let k = 1; k < rr.length; k++) {
        const dd = Math.hypot(rr[k].cam[0] - rr[k - 1].cam[0], rr[k].cam[1] - rr[k - 1].cam[1], rr[k].cam[2] - rr[k - 1].cam[2]);
        camStep = Math.max(camStep, dd);
        if (dd > 1.5) camJumps++;
      }
      const pplSet = new Set(rr.map((r) => J(r.ppl)));
      const pausedRows = rr.filter((r) => r.paused).length;
      const waitRows = rr.filter((r) => r.wait).length;
      return {
        beat: bb.beat, mode: bb.mode, ev: evs.join('+') || null, wall: +wall.toFixed(2), clock: +(tEnd - tStart).toFixed(2), ratio: wallLast > 0 ? +((tEnd - tStart) / wallLast).toFixed(3) : null,
        innerRatio: inner === null ? null : +inner.toFixed(3), headSkip, maxTick: +maxTick.toFixed(2), specDur,
        // 場面に入ったコマから次のコマまで（3D の場面の最初の画が出るまでの目安。その間は前の画面か、描いていない暗い画面のまま）
        // 始めの待ち（data-wait）のコマがあれば、待ちが明けた最初のコマ（3D の最初の画を描くコマ）の次のコマまで
        firstGap: (() => {
          const k = Math.max(0, rr.findIndex((r) => !r.wait));
          return rr.length > k + 1 ? +((rr[k + 1].w - rr[0].w) / 1000).toFixed(2) : +((wNext - wStart) / 1000).toFixed(2);
        })(),
        lost: bb.mode === 'map' && specDur !== null ? +(specDur - wall).toFixed(2) : null,
        tStart, tEnd, rafRows: rr.length, rafPerSec: wall > 0 ? +(rr.length / wall).toFixed(1) : null, castFrames: framesIn(wStart, wNext),
        people: Math.max(...rr.map((r) => r.people)), figures: Math.max(...rr.map((r) => r.figures)), hidden: Math.max(...rr.map((r) => r.hidden)),
        camPoses: camSet.size, camMaxStep: +camStep.toFixed(3), camJumps, peopleSets: pplSet.size, appearingMax: Math.max(...rr.map((r) => r.appearing)), pausedRows, waitRows,
        reduced: [...new Set(rr.map((r) => r.reduced))], vStart: +vsec(wStart).toFixed(2), vEnd: +vsec(wNext).toFixed(2),
      };
    });
    const wStart = rows[0].w;
    const tMax = Math.max(...rows.map((r) => r.t ?? 0));
    const wall = (wEndNext - wStart) / 1000;
    const pausedWall = (() => {
      let s = 0;
      for (let k = 1; k < rows.length; k++) if (rows[k - 1].paused) s += rows[k].w - rows[k - 1].w;
      return s / 1000;
    })();
    // 字幕：変わった時に測った物（この区間の中）。出ていた実時間は、出た時から次に変わった時まで
    const caps = rec.cap.filter((c) => c.w >= wStart && c.w <= wEndNext);
    const spec = specs[run.id] ?? null;
    const capOut = caps.map((c, k) => {
      const wNext = caps[k + 1]?.w ?? wEndNext;
      const sc = spec?.captions?.find((x) => x.text === c.cap) ?? null;
      const need = c.cap ? Math.max(2.5, [...c.cap].length / 8) : 0;
      return {
        headLines: c.headLines, text: c.cap, who: c.who, shownWall: +((wNext - c.w) / 1000).toFixed(2), need: +need.toFixed(2), specSec: sc ? +(sc.end - sc.start).toFixed(2) : null,
        castFrames: framesIn(c.w, wNext), px: c.capPx, lines: c.capLines, trunc: c.capTrunc, rect: c.capRect, head: c.head, headPx: c.headPx, headTrunc: c.headTrunc, vStart: +vsec(c.w).toFixed(2),
        onScreen: c.capRect[0] >= 0 && c.capRect[2] <= c.vw && c.capRect[3] <= c.vh && c.capRect[1] >= 0,
      };
    });
    out.push({
      id: run.id, wall: +wall.toFixed(2), clockEnd: tMax, duration: spec?.duration ?? null, pausedWall: +pausedWall.toFixed(2),
      overallRatio: wall - pausedWall > 0 ? +(tMax / (wall - pausedWall)).toFixed(3) : null, vStart: +vsec(wStart).toFixed(2), vEnd: +vsec(wEndNext).toFixed(2),
      beats: beatOut, captions: capOut, stageKeys: rec.keys.filter((k) => k.w >= wStart && k.w <= wEndNext && k.key).map((k) => ({ v: +vsec(k.w).toFixed(2), ev: JSON.parse(k.key) })),
    });
  }
  return out;
}
/**
 * 本物の入力（pointerdown・keydown）から、ゲームの様子（層の種類・画面・場面・一時停止）が変わるまでと、変わった画面のコマが出るまでの遅れ。
 * 様子の変化はページの記録（rAF の時刻）で、画面のコマは CDP の画面の流しの時刻で見る。20 秒の内に変わらなければ「変化なし」
 */
function inputLatency(rec) {
  const sig = (r) => `${r.ui}|${r.screen}|${r.id}|${r.beat}|${r.paused}`;
  const frameTs = rec.frames.map((f) => f.ts).sort((a, b) => a - b);
  return (rec.inputs ?? []).filter((e) => !e.repeat).map((e) => {
    // 並べるのは記録した瞬間（wl）で：rAF の時刻（w）はコマの始まりで、ページが重いと入力より前の時刻になる
    const k0 = rec.log.findLastIndex((r) => r.wl < e.w);
    const before = k0 >= 0 ? sig(rec.log[k0]) : null;
    const k1 = rec.log.findIndex((r, k) => k > k0 && r.wl < e.w + 20000 && sig(r) !== before);
    const after = k1 >= 0 ? rec.log[k1] : null;
    // 変わった様子が画面に出るのは、記録した後の最初の画面の流しのコマ
    const paint = after ? frameTs.find((ts) => ts >= rec.origin + after.wl) : undefined;
    return {
      type: e.type, key: e.key, id: e.id, v: +((rec.origin + e.w - rec.wall0) / 1000).toFixed(2),
      change: after ? +(Math.max(0, after.wl - e.w) / 1000).toFixed(2) : null, paint: paint !== undefined ? +((paint - rec.origin - e.w) / 1000).toFixed(2) : null,
      from: before, to: after ? sig(after) : null,
    };
  });
}

/** まとめを出力し、場面の中ほどのコマを抜き出す */
async function report(rec, video, runs) {
  const files = [];
  for (const run of runs) {
    note(`[${rec.tag}] 演出 ${run.id}：実時間 ${run.wall} 秒（一時停止 ${run.pausedWall} 秒）・時計の終わり ${run.clockEnd}／台本の長さ ${run.duration}・時計の比（一時停止を除く）${run.overallRatio === null ? '-' : (run.overallRatio * 100).toFixed(0) + '%'}・動画の ${run.vStart}〜${run.vEnd} 秒`);
    for (const b of run.beats) {
      note(`    場面 ${b.beat}（${b.mode}${b.ev ? ' ' + b.ev : ''}）：実時間 ${b.wall} 秒で時計 ${b.clock} 秒（${b.ratio === null ? '-' : (b.ratio * 100).toFixed(0) + '%'}・最初のコマを除くと ${b.innerRatio === null ? '-' : (b.innerRatio * 100).toFixed(0) + '%'}）・場面に入った時に場面の頭から ${b.headSkip ?? '-'} 秒進んでいた・1 コマの時計の最大の進み ${b.maxTick} 秒${b.lost !== null ? `・台本 ${b.specDur.toFixed(1)} 秒のうち画面に出なかった ${b.lost} 秒` : ''}・ページのコマ ${b.rafRows}（毎秒 ${b.rafPerSec}）・画面の流しのコマ ${b.castFrames}` +
        (b.mode === 'stage' ? `・始めの待ち（data-wait）のコマ ${b.waitRows}・最初の画が出るまで約 ${b.firstGap} 秒・人 ${b.people}・兵 ${b.figures}・隠した相手 ${b.hidden}・カメラの位置と向き ${b.camPoses} 通り（1 コマの最大の動き ${b.camMaxStep} m・飛び ${b.camJumps}）・人の位置 ${b.peopleSets} 通り` : `・現れる途中の印 最大 ${b.appearingMax}`) +
        `・動画 ${b.vStart}〜${b.vEnd} 秒`);
      const mid = (b.vStart + b.vEnd) / 2;
      if (b.vEnd - b.vStart > 0.2) {
        const f = `${OUT}/${rec.tag}-${run.id.replace(/[^\w.-]/g, '_')}-b${b.beat}-${b.mode}${b.ev ? '-' + b.ev : ''}.png`;
        await extract(video.file, mid, f);
        files.push(f);
      }
    }
    for (const c of run.captions) {
      if (!c.text) continue;
      note(`    字幕「${c.who ? c.who + '：' : ''}${c.text}」：出ていた実時間 ${c.shownWall} 秒（要る ${c.need} 秒・台本 ${c.specSec ?? '-'} 秒）・画面の流しのコマ ${c.castFrames}・${c.px}px・${c.lines} 行${c.trunc ? '・切れている' : ''}${c.onScreen ? '' : '・画面の外'}／見出し「${c.head}」${c.headPx}px・${c.headLines} 行${c.headTrunc ? '・切れている' : ''}`);
    }
    for (const k of run.stageKeys) note(`    3D の出来事（動画 ${k.v} 秒）：${J(k.ev)}`);
  }
  const lat = inputLatency(rec);
  for (const x of lat) {
    if (x.type === 'keydown' && x.key === 'KeyW') continue;
    note(`    入力 ${x.type}${x.key && x.type === 'keydown' ? ' ' + x.key : ''}${x.id ? '（' + x.id + '）' : ''}（動画 ${x.v} 秒）→ ${x.change === null ? '20 秒の内に様子は変わらない' : `様子が変わる ${x.change} 秒後・その画面のコマ ${x.paint ?? '-'} 秒後（${x.from} → ${x.to}）`}`);
  }
  for (const m of rec.marks) {
    // 印を付けた時刻の after 秒後のコマ（このコンテナは 3D の 1 コマに 1〜2 秒かかり、変わった画面が出るのが遅れるため）
    const sec = (m.at - rec.wall0) / 1000 + (m.after ?? 0);
    const f = `${OUT}/${rec.tag}-${m.label}.png`;
    await extract(video.file, Math.max(0, Math.min(video.sec - 0.05, sec)), f);
    files.push(f);
  }
  writeFileSync(`${OUT}/log-${rec.tag}.json`, J({ origin: rec.origin, wall0: rec.wall0, wall1: rec.wall1, log: rec.log, cap: rec.cap, keys: rec.keys, inputs: rec.inputs, frameTs: rec.frames.map((f) => f.ts) }));
  writeFileSync(`${OUT}/summary-${rec.tag}.json`, J({ tag: rec.tag, video, runs, inputs: lat, marks: rec.marks.map((m) => ({ label: m.label, sec: (m.at - rec.wall0) / 1000 + (m.after ?? 0) })) }, null, 1));
  note(`[${rec.tag}] 抜き出したコマ ${files.length} 枚（${OUT}/${rec.tag}-*.png）`);
  return files;
}

/** 演出の後：出来事の片付け・カメラの差し替えを外す・主人公と見回しの戻りを確かめる */
async function checkRestored(page, tag, want) {
  const p = await pose(page);
  const okHero = Math.abs(p.x - want.x) < 1e-6 && Math.abs(p.z - want.z) < 1e-6 && (want.heading === undefined || Math.abs(p.heading - want.heading) < 1e-6);
  const okYaw = want.yaw === undefined || Math.abs(p.yaw - want.yaw) < 1e-6;
  check(`[${tag}] 演出の後：出来事を片付け・カメラの差し替えを外し・主人公は${want.what}・見回しは${want.yaw === undefined ? '始める前' : `yaw ${want.yaw}`}・body の g-cine を外す`,
    okHero && okYaw && !p.stage.active && p.stage.people === 0 && p.stage.figures === 0 && p.shot === null && !/g-cine/.test(p.body),
    J({ hero: [p.x, p.z, p.heading], yaw: p.yaw, pitch: p.pitch, cam: p.cam.map((v) => +v.toFixed(3)), shot: p.shot, body: p.body }));
  return p;
}
/** 本物の W を押し続けて主人公が動く（操作が戻った）。描画ありで 1 コマ 0.1 秒の上限なので、ゆっくりしか進まない */
async function checkWalk(page, tag, ms = 5000) {
  const a = await pose(page);
  await page.keyboard.down('KeyW');
  await sleep(ms);
  await page.keyboard.up('KeyW');
  await sleep(800);
  const b = await pose(page);
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  check(`[${tag}] 演出の後に本物の W を ${ms / 1000} 秒押すと主人公が歩く（操作が戻った。描画ありなので進みは遅い）`, d > 0.05, `${d.toFixed(2)} m`);
  return d;
}
/**
 * 地図の場面は通常速度か（場面の中の進み。最初のコマを除く・一時停止していない場面）。
 * あわせて、場面に入った最初のコマで場面の頭を飛ばしていないか（前の 3D の場面の重いコマの分、時計が進んでしまうと、その分の地図・字幕は出ない）
 */
function mapRatioCheck(tag, runs) {
  const maps = runs.flatMap((r) => r.beats.filter((b) => b.mode === 'map' && b.wall > 1.5 && b.pausedRows === 0 && b.innerRatio !== null));
  const bad = maps.filter((b) => Math.abs(b.innerRatio - 1) > 0.05);
  check(`[${tag}] 地図の場面は通常速度（場面の中の時計の比が 95〜105%。最初のコマを除く）`, maps.length > 0 && bad.length === 0, maps.map((b) => `${b.beat}:${(b.innerRatio * 100).toFixed(0)}%`).join(' '));
  const all = runs.flatMap((r) => r.beats.filter((b) => b.lost !== null && b.pausedRows === 0));
  const skip = all.filter((b) => b.lost > 0.25);
  check(`[${tag}] 地図の場面は台本の長さだけ画面に出た（出なかった時間 0.25 秒以内。前の 3D の場面の重いコマの分、時計が先へ進むと、場面の頭の地図・字幕が出ない）`, all.length > 0 && skip.length === 0, all.map((b) => `${b.beat}:${b.lost}秒`).join(' '));
}
/** 字幕が要る時間（文字数 ÷ 8 秒と 2.5 秒の大きい方）以上・16px 以上・2 行まで・切れない・画面の中に出ていたか */
function captionCheck(tag, runs) {
  const caps = runs.flatMap((r) => r.captions.filter((c) => c.text));
  // 最後の字幕は演出の終わりで閉じるので、出ていた時間は台本どおり
  const shortOnes = caps.filter((c) => c.shownWall + 0.15 < c.need);
  check(`[${tag}] 字幕は要る時間以上出ていた（${caps.length} 件。実時間で測る）`, caps.length > 0 && shortOnes.length === 0, shortOnes.map((c) => `「${c.text}」${c.shownWall}/${c.need}`).join(' '));
  const small = caps.filter((c) => c.px < 16 || c.lines > 2 || c.trunc || !c.onScreen);
  check(`[${tag}] 字幕は 16px 以上・2 行まで・切れない・画面の中`, caps.length > 0 && small.length === 0, `px ${[...new Set(caps.map((c) => c.px))].join('/')}・行 ${[...new Set(caps.map((c) => c.lines))].join('/')}` + (small.length ? ` 問題 ${J(small.map((c) => c.text))}` : ''));
  const heads = [...new Set(caps.map((c) => `${c.head}（${c.headPx}px・${c.headLines} 行${c.headTrunc ? '・切れる' : ''}）`))];
  note(`[${tag}] 見出し：${heads.join(' / ')}`);
}

/** 台本の字幕が、台本の順にすべて画面に出たか（ページの記録で、字幕が変わった時に読んだ文。最後まで流した演出だけ） */
function specCapsCheck(tag, run, spec) {
  const want = [...spec.captions].sort((a, b) => a.start - b.start).map((c) => c.text);
  const shown = run.captions.filter((c) => c.text).map((c) => c.text);
  const seq = shown.filter((t, i) => t !== shown[i - 1]);
  const missing = want.filter((t) => !seq.includes(t));
  const order = J(seq.filter((t) => want.includes(t))) === J(want);
  check(`[${tag}] 台本の字幕 ${want.length} 件が、台本の順にすべて画面に出た`, missing.length === 0 && order, missing.length ? `出なかった ${J(missing)}` : '');
  return seq;
}
/** 字幕の全部を出力する（見た文の記録） */
const listCaps = (tag, seq) => note(`[${tag}] 画面に出た字幕（順）：${seq.map((t) => `「${t}」`).join(' → ')}`);

// ================================================================ intro：第一章の導入（本物の「はじめから」から最後まで）
async function partIntro(tag = 'intro', reducedMotion = 'no-preference') {
  console.log(`=== ${tag}：第一章の導入を、タイトルの「はじめから」の本物のクリックから最後まで（844×390・描画あり ?q=low・通常速度${reducedMotion === 'reduce' ? '・端末の prefers-reduced-motion を模擬' : ''}）`);
  const { ctx, page } = await open({ reducedMotion });
  const dev = await page.evaluate(() => ({ reduced: window.__game.reducedMotion, mm: matchMedia('(prefers-reduced-motion: reduce)').matches }));
  note(`[${tag}] 動きを減らす設定：${J(dev)}`);
  if (reducedMotion === 'reduce') check(`[${tag}] 端末の prefers-reduced-motion（模擬）を読んで、動きを減らす設定が入る（設定のキーは書かない）`, dev.reduced === true && dev.mm === true);
  await sleep(600);
  const rec = await startRec(page, tag);
  await sleep(1500);
  await page.click('.g-scn[data-scenario="ieyasu1570"] .g-btn[data-id="new:ieyasu1570"]');
  mark(rec, 'click-new');
  await waitUi(page, 'cine');
  const S0 = await st(page);
  const spec = await specOf(page, 'ch1_intro');
  const c0 = await page.evaluate(() => window.__game.cine);
  check(`[${tag}] 本物のクリック「はじめから」→ 第一章の導入（台本 ${c0.id}・場面 ${c0.count}・長さ ${spec?.duration} 秒）`, c0.id === spec?.id && c0.id.startsWith('ch1_intro'), J({ beats: spec?.beats.map((b) => [b.kind, b.start, b.end, b.event?.id ?? '']) }));
  await waitExplore(page);
  mark(rec, 'after-end');
  await sleep(4000);
  await stopRec(rec).then(async (r) => Object.assign(rec, r));
  const p = await checkRestored(page, tag, { x: START.x, z: START.z, yaw: START.yaw, what: '開始の位置と向き' });
  const S1 = await st(page);
  const w = await writes(page);
  check(`[${tag}] 導入を見ても状態は始めのまま・保存は書かない（設定のキーも）`, J(norm(S1)) === J(norm(S0)) && Object.keys(w).length === 0, J(w));
  await checkWalk(page, tag);
  await ctx.close();
  const video = await encode(rec);
  const runs = analyze(rec, { [spec.id]: spec });
  await report(rec, video, runs);
  mapRatioCheck(tag, runs);
  captionCheck(tag, runs);
  const run = runs.find((r) => r.id === spec.id);
  const stages = run.beats.filter((b) => b.mode === 'stage');
  if (reducedMotion === 'reduce') {
    // 動きを減らすとき：使者は歩かず、着いた姿で城門の前の画に現れる。名札を出すため、同じ見た目の会話の相手は隠して演出の人（名札つき）に替える
    // （点検の指摘：会話の相手のままでは演出の間に名札が出ず、誰が誰か分からなかった）。人が歩かないことは下の「動きを減らす」の確かめで見る
    check(`[${tag}] 3D の場面（使者の到着・動きを減らす）が描かれた：画面の流しのコマがある・使者 2 人が着いた所に名札つきで現れ、会話の相手の使者はその間だけ隠す`, stages.length > 0 && stages.every((b) => b.castFrames > 0 && b.people >= 2 && b.hidden >= 2), J(stages.map((b) => ({ ev: b.ev, frames: b.castFrames, people: b.people, hidden: b.hidden }))));
  } else check(`[${tag}] 3D の場面（使者の到着）が描かれた：画面の流しのコマがある・使者 2 人・会話の相手の使者は隠す`, stages.length > 0 && stages.every((b) => b.castFrames > 0 && b.people >= 2 && b.hidden >= 2), J(stages.map((b) => ({ ev: b.ev, frames: b.castFrames, people: b.people, hidden: b.hidden }))));
  check(`[${tag}] 時計は最後まで進んだ（台本の長さ ${spec.duration} 秒）`, Math.abs(run.clockEnd - spec.duration) < 0.05, `${run.clockEnd}`);
  const seq = specCapsCheck(tag, run, spec);
  listCaps(tag, seq);
  // 第 2 回の直し（S）：最初の字幕で自分が徳川家康だと分かる（城・町の名前は出さない。見出しの「徳川の城下（三河）」と同じ所）・A の言い方
  const first = run.captions.find((c) => c.text);
  check(`[${tag}] 最初の字幕は「元亀元年（1570年）。三河、徳川家康の城下。」で、見出しは「徳川の城下（三河）」（同じ所）`,
    first?.text === '元亀元年（1570年）。三河、徳川家康の城下。' && /徳川の城下（三河）/.test(first?.head ?? ''), J({ cap: first?.text, head: first?.head }));
  check(`[${tag}] A の字幕は方針の名前の言い方（織田との協力を続け…）`, seq.some((t) => t.startsWith('A：織田との協力を続け')), J(seq.filter((t) => /^[ABC]：/.test(t))));
  if (reducedMotion === 'reduce') {
    check(`[${tag}] 動きを減らす：どのコマも reduced`, run.beats.every((b) => J(b.reduced) === '[true]'), J(run.beats.map((b) => b.reduced)));
    check(`[${tag}] 動きを減らす：地図の場所・線は現れる途中が無い（すぐ出る）`, run.beats.filter((b) => b.mode === 'map').every((b) => b.appearingMax === 0), J(run.beats.map((b) => b.appearingMax)));
    check(`[${tag}] 動きを減らす：3D の場面でカメラが動かない（1 コマの動き 1 cm 未満。画の切り替えの飛びは別に数える）・人は歩かない`,
      stages.every((b) => b.camMaxStep < 0.01 || (b.camJumps > 0 && b.camPoses <= b.camJumps + 1)) && stages.every((b) => b.peopleSets <= b.camJumps + 1),
      J(stages.map((b) => ({ ev: b.ev, camPoses: b.camPoses, camMaxStep: b.camMaxStep, jumps: b.camJumps, peopleSets: b.peopleSets }))));
  } else {
    check(`[${tag}] 通常：3D の場面でカメラ・人が動く（時計どおりに置き直す）`, stages.some((b) => b.camPoses > 2 && b.peopleSets > 2), J(stages.map((b) => ({ ev: b.ev, camPoses: b.camPoses, peopleSets: b.peopleSets }))));
  }
  return { runs, video, pose: p };
}

// ================================================================ ch2：第一章の結末の保存から第二章への移行
async function ch2One(name) {
  const tag = `ch2-${name}`;
  const src = fixture(name);
  const f = JSON.parse(src);
  console.log(`=== ${tag}：第一章の結末の保存（直接状態変更）→「つづきから」→「第二章へ進む」→ 移行の演出（通常速度で最後まで）→ 結果確認 →「城下へ」`);
  const { ctx, page } = await open({ main: src });
  await sleep(600);
  await page.click('.g-btn[data-id="continue:ieyasu1570"]');
  await waitUi(page, 'ending');
  await sleep(800);
  const rec = await startRec(page, tag);
  await sleep(1200);
  await page.click('.g-btn[data-id="next_chapter"]');
  mark(rec, 'click-next-chapter');
  await waitUi(page, 'cine');
  const spec = await specOf(page, 'ch2_intro');
  const c0 = await page.evaluate(() => window.__game.cine);
  const S0 = await st(page);
  check(`[${tag}] 本物のクリック「第二章へ進む」→ 移行の演出（台本 ${c0.id}・長さ ${spec?.duration} 秒）`, c0.id === spec?.id, J(spec?.beats.map((b) => [b.kind, b.start, b.end, b.event ? J(b.event) : ''])));
  await waitUi(page, 'record');
  mark(rec, 'record');
  await sleep(2500);
  const recordText = await page.evaluate(() => document.querySelector('.g-layer[data-kind="record"]')?.textContent ?? '');
  await page.click('.g-btn[data-id="to_town"]');
  await waitExplore(page);
  mark(rec, 'town');
  await sleep(4000);
  Object.assign(rec, await stopRec(rec));
  const p = await checkRestored(page, tag, { x: START.x, z: START.z, yaw: START.yaw, what: '開始の位置と向き' });
  const S1 = await st(page);
  check(`[${tag}] 第二章の城下：兵は第一章の終わりのまま（演出の人数で増減しない）・状態は演出の前と同じ`, S1.chapter === 2 && J(S1.troops) === J(f.troops) && J(norm(S1)) === J(norm(S0)), J(S1.troops));
  const amb = await page.evaluate(() => window.__game.world.ambientProbe());
  note(`[${tag}] 第二章の城下の町の人々：${J(amb.spec?.groups)}`);
  await ctx.close();
  const video = await encode(rec);
  const runs = analyze(rec, { [spec.id]: spec });
  await report(rec, video, runs);
  mapRatioCheck(tag, runs);
  captionCheck(tag, runs);
  const run = runs.find((r) => r.id === spec.id);
  check(`[${tag}] 時計は最後まで進んだ（台本の長さ ${spec.duration} 秒）`, Math.abs(run.clockEnd - spec.duration) < 0.05, `${run.clockEnd}`);
  const stages = run.beats.filter((b) => b.mode === 'stage');
  check(`[${tag}] 3D の場面が描かれた（どの場面にも画面の流しのコマがある）`, stages.length > 0 && stages.every((b) => b.castFrames > 0), J(stages.map((b) => ({ ev: b.ev, frames: b.castFrames, people: b.people, figures: b.figures }))));
  const seq = specCapsCheck(tag, run, spec);
  listCaps(tag, seq);
  // 第 2 回の直し（S）の字幕を、画面に出た文で確かめる
  const evs = run.stageKeys.map((k) => k.ev);
  const rein = evs.find((e) => e.id === 'reinforcement_arrive');
  if (rein) {
    const rc = seq.filter((t) => /援兵|守備隊の者たち/.test(t));
    check(`[${tag}] 援兵の字幕は「先の戦の後に…隊に加わった。」（記録の「第一章で受け取り済み」と同じ時点）・「援兵 N が着いた」とは言わない`,
      rc.length > 0 && rc.every((t) => t.includes('先の戦の後に') && t.endsWith('隊に加わった。')) && !seq.some((t) => /援兵 [\d,]+ が着いた/.test(t)), J(rc));
    note(`[${tag}] 結果確認の画面の援兵の行：${(recordText.match(/援兵[^。]*。?/g) ?? []).slice(0, 3).join(' / ') || '(無し)'}`);
  }
  const single = seq.some((t) => /」だけ。$/.test(t));
  if (single) {
    check(`[${tag}] 選べる手が 1 つ：「…だけ。」「「…」は、兵が足りず取れない。」「今回決めるのは兵の補充…」を言い、「一つ選ぶ」「もう一つは」とは言わない`,
      seq.some((t) => /^「[^」]+」は、兵が足りず取れない。$/.test(t)) && seq.some((t) => t.startsWith('今回決めるのは兵の補充')) && !seq.some((t) => /一つ選ぶ|もう一つは/.test(t)), J(seq.slice(-4)));
  } else {
    const plans = seq.filter((t) => /^「[^」]+」：/.test(t));
    check(`[${tag}] 選べる手が 2 つ：手ごとに「「名前」：違いの一言」が 2 つ出る`, plans.length === 2, J(plans));
  }
  check(`[${tag}] 「殿を引き受ける」は読み（しんがり）を添える`, !seq.some((t) => t.includes('殿を引き受ける')), J(seq.filter((t) => t.includes('殿'))));
  const msg = evs.find((e) => e.id === 'messenger_arrive');
  note(`[${tag}] 使い：${J(msg)}・援兵：${J(rein ?? null)}`);
  return { runs, video, ambient: amb.spec, stageKeys: run.stageKeys, seq, recordText };
}

// ================================================================ depart：出陣と帰還
async function battleAllRetreat(page) {
  await page.waitForFunction(() => window.__battle?.active && window.__battle.ui.modal === 'briefing' && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
  await sleep(400);
  await page.locator('.b-primary:has-text("合戦を始める")').click();
  await page.waitForFunction(() => window.__battle.ui.started, null, POLL);
  await sleep(300);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__battle.ui.paused, null, POLL);
  await page.locator('.b-allret').click();
  await page.locator('.b-confirm').waitFor({ state: 'visible' });
  await sleep(300);
  await page.locator('.b-confirm .b-btn:has-text("撤退する")').click();
  await sleep(200);
  let t0 = null;
  let t = 0;
  for (let i = 0; i < 900; i++) {
    const s = await page.evaluate(() => ({ t: window.__battle.state.t, result: !!window.__battle.state.result }));
    if (t0 === null) t0 = s.t;
    t = s.t;
    if (s.result) break;
    await page.evaluate(() => window.__battle.fastForward(1));
  }
  note(`（早送り）合戦の時間 ${t0?.toFixed(0)} 秒 → ${t.toFixed(0)} 秒を、指揮（一時停止）のまま 1 秒ずつ進めた（全軍撤退は本物の入力）。動画には入れない`);
  await page.waitForFunction(() => window.__battle.ui.resultShown && document.querySelector('.b-result'), null, POLL);
  await sleep(500);
  return page.evaluate(() => window.__battle.state.result);
}
async function partDepart() {
  const tag = 'depart';
  console.log('=== depart：出陣（城門で「出陣する」）と帰還（全軍撤退 → 結果の「続ける」）を通常速度で（844×390・描画あり）');
  const { ctx, page } = await open();
  await page.evaluate(() => window.__game.setIeyasuPhase('muster', 'oda', { pledge: 'accept' }));
  await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
  const g = (await page.evaluate(() => window.__game.cast)).find((m) => m.id === 'gate');
  // 城門の手前（道の真ん中）へ置き（直接状態変更）、そこから本物の W で城門の輪へ歩く
  await page.evaluate(([x, z]) => window.__game.teleport(x, z, Math.PI), [g.x, g.z + 2.2]);
  await sleep(1500);
  const before = await pose(page);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, { timeout: 300000, polling: 200 });
  await page.keyboard.up('KeyW');
  const atGate = await pose(page);
  note(`城門の手前 (${before.x.toFixed(2)}, ${before.z.toFixed(2)}) から本物の W で歩いて城門の輪へ (${atGate.x.toFixed(2)}, ${atGate.z.toFixed(2)})`);
  // 行を本物の Enter で送り、「出陣する」をクリック
  for (let i = 0; i < 60; i++) {
    const u = await ui(page);
    if (u?.kind === 'script' && u.choices?.length) break;
    await page.keyboard.press('Enter');
    await sleep(300);
  }
  const u = await ui(page);
  check('[depart] 本物の W で城門へ → 出陣の確認の選択肢', (u.choices ?? []).includes('depart'), J(u.choices));
  await countWrites(page);
  const recD = await startRec(page, 'depart');
  await sleep(1200);
  await page.locator('.g-choice[data-id="depart"]').click();
  mark(recD, 'click-depart');
  await waitUi(page, 'cine');
  const specD = await specOf(page, 'departure');
  const heroDuring = await page.evaluate(() => [window.__p3.hero.x, window.__p3.hero.z]);
  check(`[depart] 本物のクリック「出陣する」→ 出陣の演出（${specD?.id}・長さ ${specD?.duration} 秒）`, !!specD && (await page.evaluate(() => window.__game.cine?.id)) === specD.id, J(specD?.beats.map((b) => [b.kind, b.start, b.end, b.event ? J(b.event) : ''])));
  await page.waitForFunction(() => window.__game.screen === 'battle', null, POLL);
  mark(recD, 'battle');
  await sleep(1500);
  Object.assign(recD, await stopRec(recD));
  const res = await battleAllRetreat(page);
  note(`合戦の結果：${res.result}/${res.reason}`);
  // 結果の画面の数と約束の欄（帰還の字幕と比べる。読むだけ）
  const resultScreen = await page.evaluate(() => {
    const box = document.querySelector('.b-result');
    const t = box?.textContent ?? '';
    const m = t.match(/味方の失った兵 ([\d,]+) \/ ([\d,]+)/);
    const pl = box?.querySelector('.b-rpledge');
    return { lost: m ? Number(m[1].replace(/,/g, '')) : null, start: m ? Number(m[2].replace(/,/g, '')) : null, pledgeTitle: pl?.querySelector('b')?.textContent ?? null, pledgeText: pl?.querySelector('span')?.textContent ?? null, text: t.slice(0, 600) };
  });
  note(`結果の画面：味方の失った兵 ${resultScreen.lost} / ${resultScreen.start}・約束「${resultScreen.pledgeTitle}」${resultScreen.pledgeText}`);
  const recR = await startRec(page, 'return');
  await sleep(1200);
  await page.locator('.b-primary:has-text("続ける")').click();
  mark(recR, 'click-continue');
  await waitUi(page, 'cine');
  const specR = await specOf(page, 'return');
  check(`[return] 本物のクリック「続ける」→ 帰還の演出（${specR?.id}・長さ ${specR?.duration} 秒）`, !!specR && (await page.evaluate(() => window.__game.cine?.id)) === specR.id, J(specR?.beats.map((b) => [b.kind, b.start, b.end, b.event ? J(b.event) : ''])));
  await waitExplore(page);
  mark(recR, 'after-end');
  await sleep(4000);
  Object.assign(recR, await stopRec(recR));
  const p = await checkRestored(page, 'return', { x: START.x, z: START.z, yaw: START.yaw, what: '戦後の城下の開始の位置と向き' });
  const s = await st(page);
  const w = await writes(page);
  check('[depart/return] 出陣から戦後まで、保存の書き込みは出陣前と戦後の 2 回だけ（演出は書かない）', w[KEY] === 2 && Object.keys(w).length === 1, J(w));
  note(`戦後の状態：段階 ${s.phase}・兵 ${J(s.troops)}`);
  await checkWalk(page, 'return');
  await ctx.close();
  const out = {};
  for (const [rec, spec] of [[recD, specD], [recR, specR]]) {
    const video = await encode(rec);
    const runs = analyze(rec, { [spec.id]: spec });
    await report(rec, video, runs);
    mapRatioCheck(rec.tag, runs);
    captionCheck(rec.tag, runs);
    const run = runs.find((r) => r.id === spec.id);
    // 最後の場面が 3D のときは、時計が長さに着いたコマで層を閉じるので、記録の最後の t は長さの 1 コマ前（1 コマの上限 1 秒）
    check(`[${rec.tag}] 時計は最後まで進んだ（台本の長さ ${spec.duration} 秒。スキップは押していない）・3D の場面が描かれた`, run.clockEnd >= spec.duration - (run.beats.at(-1).mode === 'stage' ? 1.0 : 0.05) - 1e-6 && run.beats.filter((b) => b.mode === 'stage').every((b) => b.castFrames > 0), J(run.beats.map((b) => [b.mode, b.ev, b.castFrames])));
    out[rec.tag] = { runs, video };
    const seq = specCapsCheck(rec.tag, run, spec);
    listCaps(rec.tag, seq);
    out[rec.tag].seq = seq;
    if (rec.tag === 'depart') {
      // 第 2 回の直し（T）：演出が閉じてから合戦の画面が出るまで、町の画・操作の案内を出さない（不透明な「（戦場）へ…」で覆う）
      const L = rec.log;
      const kEnd = L.findLastIndex((r) => r.id === spec.id);
      // 合戦の画面に入った＝body の mode-battle（ゲームの screen は覆いを出した時に 'battle' になるので使わない）
      const kBat = L.findIndex((r, k) => k > kEnd && r.battle);
      const gap = kEnd >= 0 && kBat > kEnd ? L.slice(kEnd + 1, kBat) : [];
      const bad = gap.filter((r) => !(r.load && r.load.startsWith('opaque')) || r.help || r.runBtn);
      const gapSec = gap.length ? (L[kBat].w - L[kEnd + 1].w) / 1000 : 0;
      check('[depart] 演出が閉じてから合戦の画面まで：どのコマも不透明な読み込みの層（「…へ…」）で覆い、操作の案内（WASD）・歩く／走るのボタンを出さない',
        gap.length > 0 && bad.length === 0, `間 ${gap.length} コマ・${gapSec.toFixed(2)} 秒・層 ${J([...new Set(gap.map((r) => r.load))])}・覆い ${J([...new Set(gap.map((r) => r.hold))])}${bad.length ? `・覆っていないコマ ${bad.length}` : ''}`);
      if (gap.length) {
        const v = (L[kEnd + 1].w + L[kBat].w) / 2;
        const f = `${OUT}/depart-gap-cover.png`;
        await extract(video.file, Math.max(0, (rec.origin + v - rec.wall0) / 1000), f);
        note(`[depart] 覆いの間のコマ：${f}`);
      }
      const stg = run.beats.find((b) => b.mode === 'stage');
      note(`[depart] 3D の場面の始めの待ち（data-wait）のコマ ${stg?.waitRows ?? '-'}・最初の画が出るまで約 ${stg?.firstGap ?? '-'} 秒`);
    }
    if (rec.tag === 'return') {
      // 第 2 回の直し（S）：帰還の損失の文は結果の画面と同じ数（味方全体）。損失があれば「兵を失わずに戻った。」と言わない。約束の行は結果の画面と同じ言葉
      const lostAny = (resultScreen.lost ?? 0) > 0;
      check(`[return] 結果の画面の「味方の失った兵 ${resultScreen.lost}」${lostAny ? 'があるので、「兵を失わずに戻った。」は出ない（主語を言う）' : 'が 0 なので「兵を失わずに戻った。」'}`,
        resultScreen.lost !== null && (lostAny ? !seq.includes('兵を失わずに戻った。') && seq.some((t) => /失った|失わずに/.test(t)) : seq.includes('兵を失わずに戻った。')), J(seq.filter((t) => /失|戻/.test(t))));
      const nums = seq.flatMap((t) => [...t.matchAll(/([\d,]+) を失った|失った兵 ([\d,]+)/g)].map((m) => Number((m[1] ?? m[2]).replace(/,/g, ''))));
      check(`[return] 帰還の字幕の失った兵の数の合計（${nums.join('+') || 0}）は、結果の画面の「味方の失った兵」（${resultScreen.lost}）と同じ`, nums.reduce((a, b) => a + b, 0) === (resultScreen.lost ?? -1), '');
      const pl = seq.filter((t) => t.startsWith('約束を'));
      const titleHead = (resultScreen.pledgeTitle ?? '').split('：')[0];
      const unf = /敵と斬り合う前に(退いた|敗れた)/.exec(resultScreen.pledgeText ?? '');
      const wantPl = !resultScreen.pledgeTitle || resultScreen.pledgeTitle.includes('引き受けていない') ? null : unf ? `${titleHead}：敵と斬り合う前に${unf[1]}。` : `${resultScreen.pledgeTitle}。`;
      check(`[return] 約束の行は結果の画面と同じ言葉で 1 行（結果の画面「${resultScreen.pledgeTitle}」→ 字幕「${wantPl ?? '出さない'}」）`, wantPl === null ? pl.length === 0 : pl.length === 1 && pl[0] === wantPl, J(pl));
    }
  }
  out.heroDuringDepart = heroDuring;
  out.after = p;
  return out;
}

// ================================================================ controls：一時停止・再開・次・前・スキップ・見直し（本物の入力）
async function partControls() {
  const tag = 'controls';
  console.log('=== controls：第一章の導入で一時停止（クリック）・再開（Space）・次の場面（→）・前の場面（←）・スキップ（クリック）→ 城下 → J → 「見直す」→ Esc → 「閉じる」（844×390・描画あり）');
  const { ctx, page } = await open();
  await sleep(600);
  const rec = await startRec(page, tag);
  await sleep(1200);
  await page.click('.g-scn[data-scenario="ieyasu1570"] .g-btn[data-id="new:ieyasu1570"]');
  await waitUi(page, 'cine');
  const S0 = await st(page);
  const spec = await specOf(page, 'ch1_intro');
  const h0 = await pose(page);
  await sleep(2500);
  const cl = async (id) => { await page.locator(`.g-layer[data-kind="cine"] .g-cine-btn[data-id="${id}"]`).click(); };
  const cine = () => page.evaluate(() => window.__game.cine);
  // 一時停止（クリック）→ 3 秒
  await cl('pause');
  mark(rec, 'paused');
  const a = await cine();
  await sleep(3000);
  const b = await cine();
  check('[controls] 本物のクリック「一時停止」：3 秒待っても時計が止まったまま・ボタンは「再開」', a.paused && b.paused && Math.abs(b.t - a.t) < 0.02 && b.buttons.find((x) => x.id === 'pause')?.label === '再開', `${a.t} → ${b.t}`);
  // 再開（Space）
  await page.keyboard.press('Space');
  await sleep(1500);
  const c = await cine();
  check('[controls] 本物のキー Space：再開して進む', !c.paused && c.t > b.t + 1.0, `${b.t} → ${c.t}`);
  // 次の場面（→）
  await page.keyboard.press('ArrowRight');
  await sleep(300);
  const d = await cine();
  check('[controls] 本物のキー →：次の場面の頭へ', d.beat === c.beat + 1 && Math.abs(d.t - spec.beats.slice().sort((x, y) => x.start - y.start)[d.beat].start) < 0.5, J({ from: c.beat, to: d.beat, t: d.t, mode: d.mode }));
  mark(rec, 'next', 0.4);
  await sleep(700);
  // 前の場面（←。場面の頭から 1.5 秒以内なら 1 つ前の場面へ）
  await page.keyboard.press('ArrowLeft');
  await sleep(300);
  const e = await cine();
  check('[controls] 本物のキー ←：前の場面へ戻る', e.beat === d.beat - 1, J({ from: d.beat, to: e.beat, t: e.t }));
  await sleep(2500);
  // スキップ（クリック）
  mark(rec, 'before-skip', 0);
  await cl('skip');
  await waitExplore(page);
  mark(rec, 'after-skip');
  const S1 = await st(page);
  const h1 = await pose(page);
  check('[controls] 本物のクリック「スキップ」→ 城下（状態は始めのまま・主人公は始めの位置・見回し yaw 0.36・出来事を片付け）', J(norm(S1)) === J(norm(S0)) && Math.abs(h1.x - h0.x) < 1e-6 && Math.abs(h1.z - h0.z) < 1e-6 && Math.abs(h1.yaw - START.yaw) < 1e-6 && !h1.stage.active && h1.shot === null, J({ hero: [h1.x, h1.z, h1.yaw] }));
  await sleep(2500);
  // 情勢（J）→ 見直す（クリック）→ Esc でスキップ → 閉じる（クリック）
  await page.keyboard.press('KeyJ');
  await waitUi(page, 'situation');
  mark(rec, 'situation');
  await sleep(1500);
  await page.locator('.g-btn[data-id="replay:ch1_intro"]').click();
  await waitUi(page, 'cine');
  const r0 = await cine();
  await sleep(4000);
  const r1 = await cine();
  mark(rec, 'replay', 0);
  check('[controls] 本物のクリック「見直す」→ 導入を最初から（時計が進む）', r0.id === spec.id && r0.t < 1 && r1.t > r0.t + 2.5, `${r0.t} → ${r1.t}`);
  await page.keyboard.press('Escape');
  await waitUi(page, 'situation');
  mark(rec, 'back-situation');
  await sleep(1500);
  await page.locator('.g-layer[data-kind="situation"] .g-btn[data-id="close"]').click();
  await waitExplore(page);
  mark(rec, 'town');
  await sleep(3000);
  Object.assign(rec, await stopRec(rec));
  const S2 = await st(page);
  const w = await writes(page);
  const h2 = await checkRestored(page, tag, { x: START.x, z: START.z, yaw: START.yaw, what: '開始の位置と向き' });
  check('[controls] 見直し・スキップの後も状態は始めのまま・保存は書かない', J(norm(S2)) === J(norm(S0)) && Object.keys(w).length === 0, J(w));
  await checkWalk(page, tag);
  await ctx.close();
  const video = await encode(rec);
  const runs = analyze(rec, { [spec.id]: spec });
  await report(rec, video, runs);
  // 一時停止の間は時計が止まる（ページの記録で）
  const paused = rec.log.filter((r) => r.paused);
  const pt = [...new Set(paused.map((r) => r.t))];
  check('[controls] ページの記録：一時停止の間のどのコマも同じ時刻 t', paused.length > 0 && pt.length === 1, `一時停止のコマ ${paused.length}・t ${J(pt)}`);
  return { runs, video, h2 };
}

// ================================================================ ch2a：第二章 A を、第一章の結末の保存から戦後の城下までつなぐ（どの演出もスキップしない）
/** 第二章 A の撤収のわけの字幕（docs/ch2a-reason.md の表。台本と同じ文） */
const A_TXT = {
  mission: '主の本隊が近江の陣を引く。撤収をお支えくだされ。',
  reason: '近江の浅井・朝倉は健在。織田の本隊は陣を引き払う。',
  who: '本隊の最後尾、後備え・小荷駄を浅井・朝倉が追う。',
  guard: '二隊が南の退き口を抜けるまで、徳川が守る。',
  ch1Win: '国境の原の局地戦に勝ち、浅井・朝倉は退いた。',
  depart: '本隊の後備え・小荷駄が抜けるまで、退き口を守る。',
  ret: '撤収を支えきった：後備え・小荷駄は南の退き口を抜けた。',
};
/** 勝ちを前提にした言い方（第一章で勝っていない経路・主目標を果たせなかった帰還に出てはいけない） */
const WIN_WORDS = /勝ち|勝利|勝った|勝って|支えきった|抜けた/;
/** 状態・保存・書き込みの控え（読むだけ） */
const snapOf = (page) => page.evaluate(([k, k1]) => ({ st: window.__game.state ? JSON.parse(JSON.stringify(window.__game.state)) : null, raw: localStorage.getItem(k), raw1: localStorage.getItem(k1), w: { ...(window.__writes ?? {}) } }), [KEY, KEY_CH1]);
const snapDiff = (a, b) => {
  const out = [];
  const sa = norm(a.st) ?? {};
  const sb = norm(b.st) ?? {};
  for (const k of new Set([...Object.keys(sa), ...Object.keys(sb)])) if (J(sa[k]) !== J(sb[k])) out.push(`状態.${k}`);
  if (a.raw !== b.raw) out.push('保存（本来のキー）');
  if (a.raw1 !== b.raw1) out.push('保存（第一章の控え）');
  if (J(a.w) !== J(b.w)) out.push(`書き込み ${J(a.w)} → ${J(b.w)}`);
  return out;
};
/** 会話の行を本物の Enter で送る（選択肢・ほかの画面が出たら返す） */
async function readLines(page) {
  let id = null;
  const seen = [];
  for (let i = 0; i < 120; i++) {
    const u = await ui(page);
    if (u?.kind === 'script') {
      id = u.id;
      const t = `${u.line.name}：${u.line.text}`;
      if (seen[seen.length - 1] !== t) seen.push(t);
    }
    if (!u || u.kind !== 'script' || u.choices.length) return { ...(u ?? {}), seenId: id, seen };
    await page.keyboard.press('Enter');
    await sleep(250);
  }
  return { ...(await ui(page)), seenId: id, seen };
}
/** 選択肢を本物のクリックで選ぶ（押し始めの守りのため少し待つ） */
const pick = async (page, id) => { await sleep(500); await page.locator(`.g-choice[data-id="${id}"]`).click(); };
/**
 * 話す相手の 2.6 m 南へ開発用の口で移し（直接状態変更）、本物の W で北へ歩いて「話す」が出たら、本物の E で話す。行は本物の Enter で送る。
 * 描画ありの町は 1 コマ 1〜2 秒・1 コマの進みの上限 0.1 秒なので、ゆっくりしか歩かない
 */
async function walkTalk(page, tag, id) {
  const c = (await page.evaluate(() => window.__game.cast)).find((m) => m.id === id);
  if (!c) throw new Error(`${id} が居ない`);
  await page.evaluate(([x, z]) => window.__game.teleport(x, z, Math.PI), [c.x, c.z + 2.6]);
  await sleep(1500);
  const a = await pose(page);
  const t0 = Date.now();
  await page.keyboard.down('KeyW');
  await page.waitForFunction((id) => window.__game.prompt === id, id, { timeout: 300000, polling: 200 });
  await page.keyboard.up('KeyW');
  const b = await pose(page);
  note(`[${tag}] ${id}：開発用の口で (${a.x.toFixed(2)}, ${a.z.toFixed(2)}) へ移し（直接状態変更）、本物の W で ${Math.hypot(b.x - a.x, b.z - a.z).toFixed(2)} m 歩いて「話す」が出た（${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
  await sleep(600);
  await page.keyboard.press('KeyE');
  await waitUi(page, 'script');
  return readLines(page);
}
/** 情勢の画面（本物の J → 読む →「閉じる」のクリック）。地図の印と文を返す */
async function situationJ(page, rec, label) {
  await page.keyboard.press('KeyJ');
  await waitUi(page, 'situation');
  mark(rec, label, 1.5);
  await sleep(2500);
  const v = await page.evaluate(() => {
    const L = document.querySelector('.g-layer[data-kind="situation"]');
    const st = (s) => { const e = L?.querySelector(s); return e ? e.dataset.state : '-'; };
    return {
      text: L?.textContent ?? '',
      camp: st('[data-place="oda_camp"]'), main: st('[data-route="withdraw.oda_main"]'), rear: st('[data-route="withdraw.oda_rear"]'),
      threat: st('[data-route^="threat."]'), march: st('[data-route^="march."]'), ret: st('[data-route^="return."]'),
      campName: L?.querySelector('[data-place="oda_camp"]')?.textContent ?? '',
    };
  });
  await page.locator('.g-layer[data-kind="situation"] .g-btn[data-id="close"]').click();
  await waitExplore(page);
  return v;
}
/** 字幕の出ていた間の地図の印（ページの記録で、その字幕のコマの最後の値） */
function mapAtCaption(rec, text) {
  const rows = rec.log.filter((r) => r.cap === text && r.mp);
  return rows.length ? rows[rows.length - 1].mp : null;
}
const mpHas = (mp, key, want = 'shown') => !!mp && mp.split(',').some((x) => x.startsWith(`${key}:${want}`));
/** 字幕が出ていた間の 8 割の所のコマを抜き出す（地図の印が出そろった後） */
async function capFrame(rec, video, text, file) {
  const k = rec.cap.findIndex((c) => c.cap === text);
  if (k < 0) return null;
  const w0 = rec.cap[k].w;
  const w1 = rec.cap[k + 1]?.w ?? w0 + 3000;
  const sec = (rec.origin + w0 + (w1 - w0) * 0.8 - rec.wall0) / 1000;
  await extract(video.file, Math.max(0, Math.min(video.sec - 0.05, sec)), file);
  return { file, sec: +sec.toFixed(2) };
}

async function ch2aOne(cfg, idx) {
  const tag = `ch2a-${idx + 1}-${cfg.name}-${cfg.plan}-${cfg.tactic}`;
  const src = fixture(cfg.name);
  const f = JSON.parse(src);
  const ch1Win = f.battle?.result === 'victory';
  console.log(`=== ${tag}：第一章の結末の保存（${f.battle?.result}・約束 ${f.pledge?.result ?? '-'}。直接状態変更）→ 第二章 A を戦後の城下まで、どの演出もスキップせずにつなぐ（判断 ${cfg.plan}・補充 ${cfg.recovery}・合戦 ${cfg.tactic}）`);
  const { ctx, page } = await open({ main: src });
  await sleep(600);
  await page.click('.g-btn[data-id="continue:ieyasu1570"]');
  await waitUi(page, 'ending');
  await sleep(800);
  const recA = await startRec(page, `${tag}-a`);
  await sleep(1200);
  // 1. 「第二章へ進む」（本物のクリック）→ 移行の演出（スキップしない）
  await page.click('.g-btn[data-id="next_chapter"]');
  mark(recA, 'click-next-chapter');
  await waitUi(page, 'cine');
  const specI = await specOf(page, 'ch2_intro');
  const sI0 = await snapOf(page);
  check(`[${tag}] 本物のクリック「第二章へ進む」→ 移行の演出（${specI?.id}・台本の長さ ${specI?.duration} 秒）`, !!specI && (await page.evaluate(() => window.__game.cine?.id)) === specI.id);
  await waitUi(page, 'record');
  const sI1 = await snapOf(page);
  const dI = snapDiff(sI0, sI1);
  check(`[${tag}] 移行の演出の間：状態・保存（本来のキー・第一章の控え）・書き込みの数が変わらない`, dI.length === 0, dI.join('・'));
  mark(recA, 'record');
  await sleep(2500);
  const recordText = await page.evaluate(() => document.querySelector('.g-layer[data-kind="record"]')?.textContent ?? '');
  await page.click('.g-btn[data-id="to_town"]');
  await waitExplore(page);
  mark(recA, 'town', 2.0);
  await sleep(3000);
  await checkRestored(page, `${tag} 移行`, { x: START.x, z: START.z, yaw: START.yaw, what: '開始の位置と向き' });
  // 2. 情勢（本物の J）
  const sit1 = await situationJ(page, recA, 'situation-explore');
  check(`[${tag}] 情勢（探索・J）：「織田の本隊（近江の陣）」・撤収の線 2 本・脅かす向き・出陣の進路が出る。今の危機に「ゲーム用の創作」「織田援軍とは別の隊」`,
    sit1.camp === 'shown' && sit1.main === 'shown' && sit1.rear === 'shown' && sit1.threat === 'shown' && sit1.march === 'shown' && sit1.text.includes('ゲーム用の創作') && sit1.text.includes('織田援軍とは別の隊'),
    J({ camp: sit1.camp, campName: sit1.campName, main: sit1.main, rear: sit1.rear, threat: sit1.threat, march: sit1.march }));
  if (!ch1Win) check(`[${tag}] 情勢（第一章で勝っていない）：勝ちを前提にした言い方（「勝ち」「勝利」…）が無い`, !/勝ち|勝利|勝った|勝って/.test(sit1.text.replace(/勝敗/g, '')), (sit1.text.match(/.{0,20}(勝ち|勝利|勝った|勝って).{0,20}/g) ?? []).join(' / '));
  // 3. 忠勝と軍議 → 判断を決める
  let u = await walkTalk(page, tag, 'tadakatsu');
  check(`[${tag}] 忠勝（本物の E）→ 軍議を開く`, (u.choices ?? []).includes('open_council'), `${u.seenId}｜${u.seen.join(' / ').slice(0, 300)}`);
  const tadakatsuLines = u.seen;
  await pick(page, 'open_council');
  await page.waitForFunction(() => window.__game.screen === 'council', null, POLL);
  u = await readLines(page);
  const councilLines = u.seen;
  check(`[${tag}] 軍議：判断「${cfg.plan}」を選べる`, (u.choices ?? []).includes(`plan_${cfg.plan}`), J(u.choices));
  await pick(page, `plan_${cfg.plan}`);
  u = await readLines(page);
  await pick(page, 'confirm_plan');
  await waitExplore(page);
  const sm = await st(page);
  check(`[${tag}] 判断を決めた（支度へ）`, sm.phase === 'muster' && sm.plan === cfg.plan && !!sm.terms, J(sm.terms));
  // 4. 石川と補充
  u = await walkTalk(page, tag, 'ishikawa');
  const opts = ['recovery_wait', 'recovery_transfer', 'recovery_none'].filter((x) => (u.choices ?? []).includes(x));
  const rc = opts.includes(`recovery_${cfg.recovery}`) ? cfg.recovery : opts[0]?.replace('recovery_', '');
  if (rc !== cfg.recovery) note(`！補充「${cfg.recovery}」が選べないので「${rc}」（選べる：${opts.join(',')}）`);
  await pick(page, `recovery_${rc}`);
  await waitExplore(page);
  const sr = await st(page);
  check(`[${tag}] 石川と補充「${rc}」（本物の E・クリック）`, sr.recovery?.choice === rc, J(sr.troops));
  // 5. 城門：手前へ移し（直接状態変更）、本物の W で歩く →「出陣する」（本物のクリック）
  const g = (await page.evaluate(() => window.__game.cast)).find((m) => m.id === 'gate');
  await page.evaluate(([x, z]) => window.__game.teleport(x, z, Math.PI), [g.x, g.z + 2.2]);
  await sleep(1500);
  const gb = await pose(page);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, { timeout: 300000, polling: 200 });
  await page.keyboard.up('KeyW');
  const ga = await pose(page);
  note(`[${tag}] 城門：開発用の口で (${gb.x.toFixed(2)}, ${gb.z.toFixed(2)}) へ移し（直接状態変更）、本物の W で城門の輪へ (${ga.x.toFixed(2)}, ${ga.z.toFixed(2)})`);
  u = await readLines(page);
  check(`[${tag}] 城門：出陣の確認（主目標（軍議で確定））`, (u.choices ?? []).includes('depart'), u.seen.join(' / ').slice(0, 200));
  await pick(page, 'depart');
  mark(recA, 'click-depart');
  await waitUi(page, 'cine');
  const specD = await specOf(page, 'departure');
  const sD0 = await snapOf(page);
  check(`[${tag}] 本物のクリック「出陣する」→ 出陣の演出（${specD?.id}・${specD?.duration} 秒）`, !!specD && (await page.evaluate(() => window.__game.cine?.id)) === specD.id);
  await page.waitForFunction(() => window.__battle?.active && window.__battle.ui.modal === 'briefing' && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
  const sD1 = await snapOf(page);
  const dD = snapDiff(sD0, sD1);
  check(`[${tag}] 出陣の演出の間（合戦の説明の画面まで）：状態・保存・書き込みの数が変わらない（出陣前の保存は演出の前）`, dD.length === 0, dD.join('・'));
  mark(recA, 'briefing', 1.0);
  await sleep(2000);
  Object.assign(recA, await stopRec(recA));
  // 6. 合戦（撮らない）
  const brief = await page.textContent('.b-modal');
  await sleep(400);
  await page.locator('.b-primary:has-text("合戦を始める")').click();
  await page.waitForFunction(() => window.__battle.ui.started, null, POLL);
  await sleep(300);
  const B = battleIO(page, note);
  await B.init();
  await B.pause();
  if (cfg.tactic === 'allret') {
    const ok = await B.allRetreat();
    check(`[${tag}] 合戦：開始直後に全軍撤退（本物のクリック：全軍撤退 →「撤退する」）`, ok);
    await fastForwardToResult(page, note, '全軍撤退の後');
  } else if (cfg.tactic === 'nothing') {
    note(`[${tag}] 合戦：命令を出さない`);
    await fastForwardToResult(page, note, '命令なし');
  } else {
    await driveTactic(page, B, 'oda', cfg.tactic, note);
    check(`[${tag}] 合戦：命令はすべて画面の入力（${B.summary()}）`, B.issues.length === 0, B.issues.join(' | ') + (B.refused.length ? `／出せず ${B.refused.join(' | ')}` : ''));
  }
  await page.waitForFunction(() => window.__battle.ui.resultShown && document.querySelector('.b-result'), null, POLL);
  await sleep(600);
  const out = await page.evaluate(() => window.__battle.state.result);
  const resultText = await page.textContent('.b-result');
  const prim = out?.objectives?.primary?.achieved ?? null;
  note(`[${tag}] 合戦の結果：${out.result}（${out.reason}）・主目標 ${prim ? '果たした' : '果たせなかった'}・合戦 ${out.elapsedSec?.toFixed(0)} 秒`);
  // 7. 結果の画面 →「続ける」（本物のクリック）→ 帰還の演出（スキップしない）→ 戦後の城下
  const recB = await startRec(page, `${tag}-b`);
  await sleep(1500);
  await page.locator('.b-primary:has-text("続ける")').click();
  mark(recB, 'click-continue');
  await waitUi(page, 'cine');
  const specR = await specOf(page, 'return');
  const sR0 = await snapOf(page);
  check(`[${tag}] 本物のクリック「続ける」→ 帰還の演出（${specR?.id}・${specR?.duration} 秒）`, !!specR && (await page.evaluate(() => window.__game.cine?.id)) === specR.id);
  await waitExplore(page);
  const sR1 = await snapOf(page);
  const dR = snapDiff(sR0, sR1);
  check(`[${tag}] 帰還の演出の間：状態・保存・書き込みの数が変わらない（戦後の保存は結果の画面で済み）`, dR.length === 0, dR.join('・'));
  mark(recB, 'after-end', 2.0);
  await sleep(4000);
  const pR = await checkRestored(page, `${tag} 帰還`, { x: START.x, z: START.z, yaw: START.yaw, what: '戦後の城下の開始の位置と向き' });
  const sit2 = await situationJ(page, recB, 'situation-aftermath');
  Object.assign(recB, await stopRec(recB));
  await checkWalk(page, `${tag} 帰還`);
  const sEnd = await st(page);
  note(`[${tag}] 戦後の状態：段階 ${sEnd.phase}・兵 ${J(sEnd.troops)}・主目標 ${J(sEnd.result?.primary)}`);
  await ctx.close();

  // ---------------- 動画とまとめ
  const res = { tag, cfg, ch1: f.battle?.result, battle: { result: out.result, reason: out.reason, prim, sec: out.elapsedSec }, brief, tadakatsuLines, councilLines, recordText: recordText.slice(0, 600), sit1: { ...sit1, text: sit1.text.slice(0, 900) }, sit2: { ...sit2, text: sit2.text.slice(0, 900) }, resultText: resultText.slice(0, 400), frames: {} };
  for (const [rec, specs] of [[recA, { [specI.id]: specI, [specD.id]: specD }], [recB, { [specR.id]: specR }]]) {
    const video = await encode(rec);
    const runs = analyze(rec, specs);
    await report(rec, video, runs);
    mapRatioCheck(rec.tag, runs);
    captionCheck(rec.tag, runs);
    res[rec === recA ? 'videoA' : 'videoB'] = { file: video.file, sec: video.sec, runs: runs.map((r) => ({ id: r.id, wall: r.wall, clockEnd: r.clockEnd, duration: r.duration, ratio: r.overallRatio, beats: r.beats.map((b) => ({ beat: b.beat, mode: b.mode, ev: b.ev, wall: b.wall, ratio: b.ratio, innerRatio: b.innerRatio, lost: b.lost })) })) };
    for (const [id, spec] of Object.entries(specs)) {
      const run = runs.find((r) => r.id === id);
      if (!run) { check(`[${rec.tag}] 演出 ${id} が記録にある`, false); continue; }
      const lastStage = run.beats.at(-1)?.mode === 'stage';
      check(`[${rec.tag}] ${id}：時計は最後まで進んだ（台本 ${spec.duration} 秒。スキップは押していない）`, run.clockEnd >= spec.duration - (lastStage ? 1.0 : 0.05) - 1e-6, `${run.clockEnd}`);
      const seq = specCapsCheck(rec.tag, run, spec);
      listCaps(`${rec.tag} ${id}`, seq);
      res[`seq:${spec.moment}`] = seq;
      if (spec.moment === 'ch2_intro') {
        const iM = seq.indexOf(A_TXT.mission);
        const iR = seq.indexOf(A_TXT.reason);
        const iW = seq.indexOf(A_TXT.who);
        const iG = seq.indexOf(A_TXT.guard);
        check(`[${tag}] 移行：使者の頼み → わけ（近江の浅井・朝倉は健在・本隊は陣を引き払う）→ どの隊（本隊の最後尾、後備え・小荷駄）→ 守るもの（二隊が南の退き口を抜けるまで）の順に出た`,
          iM >= 0 && iR > iM && iW > iR && iG > iW, J({ iM, iR, iW, iG }));
        const winSeq = seq.filter((t) => WIN_WORDS.test(t));
        if (ch1Win) check(`[${tag}] 移行（第一章で勝った）：第一章の結果は「${A_TXT.ch1Win}」（局地戦の勝ち）`, seq.includes(A_TXT.ch1Win), J(winSeq));
        else check(`[${tag}] 移行（第一章は ${f.battle?.result}）：どの字幕も勝ちを前提にしない（勝ち・勝利・支えきった・抜けた が無い）`, winSeq.length === 0, J(seq.filter((t) => t.includes('国境の原'))));
        const ally = seq.filter((t) => t.includes('援軍'));
        check(`[${tag}] 移行：「援軍」の字幕に撤収・後備え・小荷駄・退き口が出ない（第一章の織田援軍と第二章の本隊を混ぜない）`, ally.every((t) => !/撤収|後備え|小荷駄|退き口/.test(t)), J(ally));
        // 地図の印：わけの字幕で陣と本隊の撤収の線、どの隊の字幕で後備え・小荷駄の撤収の線と脅かす向き
        const mR = mapAtCaption(rec, A_TXT.reason);
        const mW = mapAtCaption(rec, A_TXT.who);
        const mG = mapAtCaption(rec, A_TXT.guard);
        check(`[${tag}] 移行の地図：わけの字幕で「織田の本隊」の陣と本隊の撤収の線（→ 織田家）が出た`, mpHas(mR, 'camp') && mpHas(mR, 'main'), mR ?? '(記録なし)');
        check(`[${tag}] 移行の地図：どの隊の字幕で後備え・小荷駄の撤収の線（→ 退き口）と浅井・朝倉の脅かす向きが出た`, mpHas(mW, 'rear') && mpHas(mW, 'threat') && mpHas(mW, 'camp') && mpHas(mW, 'main'), mW ?? '(記録なし)');
        const marchRows = rec.log.filter((r) => r.id === id && mpHas(r.mp, 'march'));
        check(`[${tag}] 移行の地図：徳川の出陣の進路が出た（守るものの字幕の地図 ${mG ?? '-'}）`, marchRows.length > 0, marchRows.length ? `最初に出た字幕「${marchRows[0].cap}」` : '');
        for (const [k, text] of [['ch1', ch1Win ? A_TXT.ch1Win : seq.find((t) => t.startsWith('国境の原'))], ['mission', A_TXT.mission], ['reason', A_TXT.reason], ['who', A_TXT.who], ['guard', A_TXT.guard]]) {
          if (!text) continue;
          const fr = await capFrame(rec, video, text, `${OUT}/${rec.tag}-cap-${k}.png`);
          if (fr) { res.frames[k] = fr; note(`[${tag}] 字幕「${text}」のコマ：${fr.file}（動画 ${fr.sec} 秒）・地図の印 ${mapAtCaption(rec, text) ?? '-'}`); }
        }
      }
      if (spec.moment === 'departure') {
        const iD = seq.indexOf(A_TXT.depart);
        check(`[${tag}] 出陣：「行き先：織田勢の退き口。」の後に「${A_TXT.depart}」`, iD > 0 && seq[iD - 1] === '行き先：織田勢の退き口。', J(seq));
        const mD = mapAtCaption(rec, A_TXT.depart);
        check(`[${tag}] 出陣の地図：出陣の進路が出ている`, mpHas(mD, 'march'), mD ?? '(記録なし)');
        const fr = await capFrame(rec, video, A_TXT.depart, `${OUT}/${rec.tag}-cap-depart.png`);
        if (fr) res.frames.depart = fr;
      }
      if (spec.moment === 'return') {
        const head = seq[0] ?? '';
        if (prim) check(`[${tag}] 帰還（主目標を果たした）：「${A_TXT.ret}」`, seq.includes(A_TXT.ret), J(seq));
        else check(`[${tag}] 帰還（主目標を果たせなかった：${out.result}）：「支えきった」「抜けた」「勝ち」を言わず、「主目標を果たせなかった」と言う`, !seq.some((t) => WIN_WORDS.test(t)) && seq.some((t) => t.includes('主目標を果たせなかった')), J(seq));
        const mRet = mapAtCaption(rec, head);
        check(`[${tag}] 帰還の地図：帰り道の線が出ている`, mpHas(mRet, 'return'), mRet ?? '(記録なし)');
        const fr = await capFrame(rec, video, head, `${OUT}/${rec.tag}-cap-return.png`);
        if (fr) res.frames.ret = fr;
      }
    }
  }
  check(`[${tag}] 情勢（戦後・J）：陣と撤収の線が出て、帰り道の線が出る（脅かす向き・出陣の進路は出ない）`, sit2.camp === 'shown' && sit2.main === 'shown' && sit2.rear === 'shown' && sit2.ret === 'shown', J({ camp: sit2.camp, main: sit2.main, rear: sit2.rear, threat: sit2.threat, march: sit2.march, ret: sit2.ret }));
  if (!prim) check(`[${tag}] 情勢（戦後・主目標を果たせなかった）：「支えきった」「抜けた」が無い`, !/支えきった|抜けた/.test(sit2.text), (sit2.text.match(/.{0,20}(支えきった|抜けた).{0,20}/g) ?? []).join(' / '));
  res.pose = pR;
  writeFileSync(`${OUT}/ch2a-${idx + 1}.json`, J(res, null, 1));
  return res;
}

const results = {};
try {
  for (const part of PARTS) {
    const t = Date.now();
    if (part === 'intro') results.intro = await partIntro('intro');
    else if (part === 'reduced') results.reduced = await partIntro('reduced', 'reduce');
    else if (part === 'ch2') {
      results.ch2 = {};
      for (const name of CH2) {
        results.ch2[name] = await ch2One(name);
        note(`第二章への移行の 3D の出来事（${name}）：${J(results.ch2[name].stageKeys.map((k) => k.ev))}`);
      }
      const ev = (r, id) => r.stageKeys.map((k) => k.ev).filter((e) => e.id === id);
      const win = results.ch2.oda_victory_kept;
      const heavy = results.ch2.home_defeat_broken_heavy;
      const asai = results.ch2.asai_victory_kept;
      if (win && heavy) {
        check('第二章への移行：勝ち・約束を守った保存は援兵の到着がある・負け・約束を破った（損害大）の保存は援兵なしで負傷兵が多い',
          ev(win, 'reinforcement_arrive').length > 0 && ev(heavy, 'reinforcement_arrive').length === 0 && (ev(heavy, 'wounded_rest')[0]?.count ?? 0) > (ev(win, 'wounded_rest')[0]?.count ?? 0),
          J({ win: ev(win, 'wounded_rest'), heavy: ev(heavy, 'wounded_rest') }));
      }
      if (heavy) {
        // 第 2 回の直し（S）：C の村の使いは町の人の見た目（武家の使者の見た目の鍵を使わない）
        const m = ev(heavy, 'messenger_arrive')[0];
        check('第二章への移行（C）：村の使いは町の人の見た目（townsman_*。武家の使者 tashiro_envoy／omori_envoy ではない）・名札は「村の使い」', !!m && /^townsman_/.test(m.look) && m.name === '村の使い', J(m));
      }
      if (asai) {
        const m = ev(asai, 'messenger_arrive')[0];
        const r = ev(asai, 'reinforcement_arrive')[0];
        check('第二章への移行（B 浅井の勝ち・約束を守った）：浅井家の使者が来る・浅井の援兵（旗 浅）が木戸を入る', m?.name === '浅井家の使者' && m.look === 'omori_envoy' && r?.mark === '浅', J({ m, r }));
      }
    } else if (part === 'ch2a') {
      results.ch2a = [];
      // 回の番号の始め（CH2A_FROM。別の実行で続きの回を撮るとき、出力の名前が重ならないように）
      const from = Number(process.env.CH2A_FROM || 0);
      for (let i = 0; i < CH2A.length; i++) {
        const t1 = Date.now();
        results.ch2a.push(await ch2aOne(CH2A[i], from + i));
        note(`ch2a の ${i + 1} 回目：実時間 ${((Date.now() - t1) / 1000).toFixed(0)} 秒`);
      }
    } else if (part === 'depart') results.depart = await partDepart();
    else if (part === 'controls') results.controls = await partControls();
    else throw new Error(`PARTS が分からない：${part}`);
    note(`${part}：実時間 ${((Date.now() - t) / 1000).toFixed(0)} 秒`);
  }
} catch (e) {
  failed++;
  console.log('NG 途中で止まった：', e.stack || e.message);
}
check('ページの誤りなし', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n結果：OK ${oks}・NG ${failed}（${secs()}）。動画とコマ：${OUT}`);
process.exit(failed ? 1 : 0);
