// 実時間の録画（Version 28）：本番ビルドを公開と同じ CSP の下で開き、第一章「元亀元年・家康」を本物の入力だけで遊んで、
// 画面とゲーム自身の音を 1 本の録画（ページの中の getDisplayMedia ＋ MediaRecorder。webm・vp8＋opus）にそのまま録る。
//
// - 録画は実時間（ページの中で、画と音を同時に 1 回で録る）。後から音を足さない・差し替えない。映像も切り貼り・速さの変更をしない。
// - 足すのは上の真ん中の小さなラベル 1 つだけ（半透明・押せない。LABEL で文を変えられる）。コマの速さを書くときは、先に PROBE=1 で
//   同じ録り方の短い録画をして測った値を LABEL に書く（測っていない数を書かない。既定の文には数を書かない）。
// - 入力は本物（Playwright のマウス・キー）：タイトルで「はじめから」をクリック → 冒頭（ch1_open）をそのまま見る → W で北へ
//   （3 秒以上・2 コマ以上）→ Shift＋W で走る（2 秒以上・2 コマ以上）→ 離して、引きずりで左を見て右を見て真ん中へ戻す → 離す →
//   北へ（既定は Shift＋W で走る。APPROACH=walk なら W）、町の急報（ch1_report。声のある台詞 4 つ）が始まるまで → 飛ばさず最後まで見る
//   → 操作が戻ったら W で忠勝の方へ数秒。
//   この環境は 1 コマに数秒かかるので、押す長さは「秒」と「描いたコマの数」の両方で決める（コマが 1 つも描かれない押しは画に出ない）。
//   急報の線までの残り（約 6 m）は、歩くと 1 コマ 0.155 m（町の時計は 1 コマ 0.1 秒まで）で約 40 コマ・走ると約 18 コマ。録画の長さの
//   目安（約 6 分）のため既定は走る。引きずりは、押したままの動き 1 つの返事に 1 コマ以上かかるので、左・右・真ん中の 3 つの動きだけにする。
// - 本番ビルドには開発用の口（__game など）が無い。ページの中の記録は見るだけ：requestAnimationFrame の時刻（コマの速さ）・
//   字幕を書いた時刻（textContent）・画面の層の様子（MutationObserver。演出の再生器が字幕の声のほどけを待って時計を止めている間＝層の
//   data-voice-wait も）・声の音源（AudioBufferSourceNode の start／stop／ended と
//   getOutputTimestamp。decodeAudioData でほどいた音を長さで見分ける）・押した時刻・CSP の違反。
// - 録った後の分析（別の Chromium。音は出さない）：webm の中のブロックを読み（コマの時刻・音のかたまりの時刻と途切れ）、
//   WebCodecs で映像のコマ（字幕の帯の画が替わったコマ・代表の 6 コマを JPEG に）と音（16 kHz に）をほどき、台詞の音声ファイル
//   （dist の voice/*.mp3）を型にして録音の中の声の始まりと鳴った長さを探す（e2e/v28-voice-check.mjs と同じ相関と大きさの確かめ）。
//
// 使い方：DIST=<本番ビルドの dist> PORT=8843 [LABEL=…] [PROBE=1] [NAME=realtime-q-low] node e2e/v28-realtime-capture.mjs <出力先>
//   出力：<NAME>.webm（録画）・<NAME>.json（ページの記録と分析）・<NAME>-<番号>-<場面>.jpg（録画のコマ 6 つ）・README.md（作り方）
//   ANALYZE_ONLY=1：録った物（<NAME>.webm・<NAME>.json）から分析と README だけをやり直す。
// 注意：この環境はソフトウェア描画で 1 コマに数秒かかる。録画は実時間だが紙芝居のようになり、町の時計も遅れる（滑らかさの証拠にしない）。
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { outDir, PROD_CSP, serveDist } from './lib.mjs';

const DIST = resolve(process.env.DIST || 'dist-proto3d');
const PORT = Number(process.env.PORT || 8843);
const OUT = resolve(outDir(process.argv[2] || 'e2e-out/v28-realtime-capture'));
const NAME = process.env.NAME || 'realtime-q-low';
const QUERY = process.env.Q ?? '?q=low';
const LABEL = process.env.LABEL || '実時間の録画（この環境はソフトウェア描画・画質 低）';
/** 急報の線までの進み方：run（Shift＋W。既定）・walk（W） */
const APPROACH = process.env.APPROACH === 'walk' ? 'walk' : 'run';
const PROBE = process.env.PROBE === '1';
const PROBE_WALK_SEC = Number(process.env.PROBE_WALK_SEC || 30);
const ANALYZE_ONLY = process.env.ANALYZE_ONLY === '1';
/** 全体の目安（秒）。超えそうなら、急報の後の歩きを短くする（急報は最後まで見る） */
const BUDGET_SEC = Number(process.env.BUDGET_SEC || 360);
const VIDEO_BPS = 2500000;
const DRAG_PX = 190; // 見回しの引きずり（FOLLOW.sensitivity 0.0055 rad/px で約 60°）
const CONTAINER_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EXE = process.env.CHROMIUM_PATH || (existsSync(CONTAINER_CHROME) ? CONTAINER_CHROME : undefined);
const GL = EXE === CONTAINER_CHROME ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : [];
const VIEW = { width: 1280, height: 720 };
const MANIFEST = JSON.parse(readFileSync(new URL('../proto3d/src/audio/voiceManifest.gen.json', import.meta.url), 'utf8'));
const LINES = MANIFEST.lines;
const LINE = Object.fromEntries(LINES.map((l) => [l.id, l]));
const REPORT_IDS = ['ch1.oda_envoy.ask', 'ch1.asai_envoy.ask', 'ch1.tadakatsu.council', 'ch1.hero.gather'];
const WEBM = join(OUT, `${NAME}.webm`);
const JSON_OUT = join(OUT, `${NAME}.json`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r0 = (v) => (Number.isFinite(v) ? Math.round(v) : v ?? null);
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : v ?? null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v ?? null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v ?? null);
const T0 = Date.now();
const say = (s) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s] ${s}`);

// ================================================================ ページに差し込む記録（見るだけ）・ラベル・録画

const INIT = ({ durs }) => {
  const now = () => performance.now();
  const rd = (v) => Math.round(v * 10) / 10;
  const L = (window.__rt = { raf: [], text: [], dom: [], src: [], dec: [], input: [], moves: [], pageEv: [], csp: [], cap: null, label: null });
  // ---- コマ：requestAnimationFrame の時刻（コールバックの引数）と呼ばれた時刻
  const tick = (ts) => {
    L.raf.push([rd(ts), rd(now())]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // ---- 声：decodeAudioData でほどいた音（ゲームでは台詞の音声ファイル）を長さで見分ける（6 つの長さはすべて違う）
  const idOf = new WeakMap();
  const name = (b) => {
    if (!b) return null;
    for (const [id, sec] of durs) if (Math.abs(b.duration - sec) < 0.02) return id;
    return null;
  };
  const B = BaseAudioContext.prototype;
  const dec = B.decodeAudioData;
  B.decodeAudioData = function (data, ok, bad) {
    const t = now();
    let logged = false; // 呼び返しと Promise の両方で受け取る呼び方でも 1 回だけ書く
    const mark = (b) => {
      if (b) {
        const id = name(b);
        if (id) idOf.set(b, id);
        if (!logged) L.dec.push({ id, sec: b.duration, t0: rd(t), t: rd(now()) });
        logged = true;
      }
      return b;
    };
    const p = dec.call(this, data, ok && ((b) => ok(mark(b))), bad);
    return p && p.then ? p.then(mark) : p;
  };
  const out = (ctx) => {
    const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    return ts ? { c: ts.contextTime, p: ts.performanceTime } : null;
  };
  let nodes = 0;
  const P = AudioBufferSourceNode.prototype;
  const start = P.start;
  const stop = P.stop;
  P.start = function (when = 0, ...rest) {
    const id = this.buffer ? (idOf.get(this.buffer) ?? null) : null;
    if (id) {
      const ctx = this.context;
      this.__n = ++nodes;
      L.src.push({ ev: 'start', id, n: this.__n, dur: this.buffer.duration, when: when || ctx.currentTime, ct: ctx.currentTime, t: rd(now()), out: out(ctx), sr: ctx.sampleRate, lat: ctx.baseLatency ?? null, olat: ctx.outputLatency ?? null });
      const n = this.__n;
      this.addEventListener('ended', () => L.src.push({ ev: 'ended', id, n, ct: ctx.currentTime, t: rd(now()) }));
    }
    return start.call(this, when, ...rest);
  };
  P.stop = function (when = 0) {
    if (this.__n) L.src.push({ ev: 'stop', id: idOf.get(this.buffer) ?? null, n: this.__n, t: rd(now()) });
    return stop.call(this, when);
  };
  // ---- 字幕（演出の .g-cine-cap の .who・.txt）と会話の行（.g-dialog .text）を書いた時刻。次のコマとその次のコマの時刻も
  const seen = {};
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null;
  };
  const onText = (kind, text, el) => {
    if (text === seen[kind]) return;
    seen[kind] = text;
    const e = { kind, text, t: rd(now()), raf1: null, raf2: null, rect: null, inner: [innerWidth, innerHeight] };
    L.text.push(e);
    requestAnimationFrame((f1) => {
      e.raf1 = rd(f1);
      e.rect = box(kind === 'dlg' ? el : el.parentElement);
      requestAnimationFrame((f2) => (e.raf2 = rd(f2)));
    });
  };
  const tc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  Object.defineProperty(Node.prototype, 'textContent', {
    configurable: true,
    enumerable: tc.enumerable,
    get: tc.get,
    set(v) {
      tc.set.call(this, v);
      const cl = this.classList;
      const par = this.parentElement?.classList;
      if (!cl || !par) return;
      if (par.contains('g-cine-cap')) {
        if (cl.contains('txt')) onText('cap', String(v ?? ''), this);
        else if (cl.contains('who')) onText('who', String(v ?? ''), this);
      } else if (cl.contains('text') && par.contains('g-dialog')) onText('dlg', String(v ?? ''), this);
    },
  });
  // ---- 画面の層の様子（演出の id・場面・字幕・探索の表示・話す）。替わった時だけ
  let lastDom = '';
  const snap = () => {
    const c = document.querySelector('.g-layer[data-kind="cine"]');
    const hud = document.querySelector('.g-hud');
    const talk = document.querySelector('.g-talk');
    const s = {
      cine: c?.dataset.cine ?? null,
      beat: c?.dataset.beat ?? null,
      cap: c ? (c.querySelector('.g-cine-cap .txt')?.textContent ?? '') : null,
      hud: !!hud && !hud.hidden && hud.getClientRects().length > 0 && !document.body.classList.contains('g-cine'),
      talk: talk && !talk.hidden ? (talk.dataset.target ?? '?') : null,
      title: !!document.querySelector('.g-btn[data-id="new:ieyasu1570"]'),
      // 演出の再生器が字幕の声を待って時計を止めている間（層の data-voice-wait="1"。Version 28 の 2caa33f から）
      vw: c ? c.dataset.voiceWait === '1' : null,
    };
    const k = JSON.stringify(s);
    if (k !== lastDom) {
      lastDom = k;
      L.dom.push({ t: rd(now()), ...s });
    }
  };
  new MutationObserver(snap).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class', 'data-cine', 'data-beat', 'data-target', 'data-voice-wait'] });
  // ---- 入力・ページの知らせ・CSP の違反
  window.addEventListener('keydown', (e) => !e.repeat && L.input.push({ k: e.code, ev: 'down', t: rd(now()) }), true);
  window.addEventListener('keyup', (e) => L.input.push({ k: e.code, ev: 'up', t: rd(now()) }), true);
  for (const ev of ['pointerdown', 'pointerup']) window.addEventListener(ev, (e) => L.input.push({ p: e.pointerType, ev, x: Math.round(e.clientX), y: Math.round(e.clientY), t: rd(now()) }), true);
  window.addEventListener('pointermove', (e) => e.buttons && L.moves.push([rd(now()), Math.round(e.clientX)]), true);
  const pe = (e) => L.pageEv.push({ e, t: rd(now()), vis: document.visibilityState, focus: document.hasFocus() });
  document.addEventListener('visibilitychange', () => pe('visibilitychange'));
  for (const k of ['blur', 'focus', 'resize']) window.addEventListener(k, () => pe(k));
  document.addEventListener('securitypolicyviolation', (e) => L.csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  // ---- 上の真ん中の小さなラベル（ゲームの画面ではない。半透明・押せない）。ゲームの DOM の外（html の直下）に置く
  window.__rtLabel = (text) => {
    const d = document.createElement('div');
    d.id = 'rt-label';
    d.textContent = text;
    d.style.cssText = 'position:fixed;top:2px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;' + 'padding:2px 10px;border-radius:4px;background:rgba(0,0,0,0.5);color:rgba(255,255,255,0.92);' + 'font:12px/1.5 sans-serif;letter-spacing:0.02em;white-space:nowrap;';
    document.documentElement.appendChild(d);
    const r = d.getBoundingClientRect();
    L.label = { text, t: rd(now()), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
    return L.label;
  };
  // ---- 録画：今のタブ（音つき）→ MediaRecorder。1 秒ごとのかたまりはページの中に貯め、録り終えてから Node へまとめて読む
  //      （かたまりごとに Node へ送ると、この環境では送るたびの返事がコマを待って遅れ、送りが録画に追いつかない）
  const b64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  window.__rtCapStart = async (bps) => {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true, preferCurrentTab: true });
    const rec = new MediaRecorder(s, { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: bps, audioBitsPerSecond: 128000 });
    const cap = (L.cap = { mime: rec.mimeType, tracks: s.getTracks().map((t) => ({ kind: t.kind, label: t.label, settings: t.getSettings() })), callT: rd(now()), startT: null, stopT: null, chunks: 0, bytes: 0 });
    const parts = [];
    rec.ondataavailable = (ev) => {
      if (!ev.data.size) return;
      parts.push(ev.data);
      cap.chunks++;
      cap.bytes += ev.data.size;
    };
    const started = new Promise((res) => (rec.onstart = () => ((cap.startT = rd(now())), res())));
    rec.start(1000);
    await started;
    window.__rtRec = { s, rec, parts };
    return cap;
  };
  window.__rtCapStop = async () => {
    const { s, rec, parts } = window.__rtRec;
    await new Promise((res) => {
      rec.onstop = () => res();
      rec.stop();
    });
    L.cap.stopT = rd(now());
    s.getTracks().forEach((t) => t.stop());
    window.__rtBlob = new Blob(parts, { type: rec.mimeType });
    L.cap.blobBytes = window.__rtBlob.size;
    return L.cap;
  };
  /** 録った webm の from バイトから len バイトを base64 で（Node が何回かに分けて読む） */
  window.__rtRead = async (from, len) => b64(new Uint8Array(await window.__rtBlob.slice(from, from + len).arrayBuffer()));
};

// ================================================================ 遊ぶ・録る

async function record() {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error(`${DIST}/index.html が無い（先に本番ビルド）`);
  const srv = await serveDist(DIST, PORT);
  const udd = mkdtempSync(join(OUT, '.udd-'));
  const ctx = await chromium.launchPersistentContext(udd, {
    executablePath: EXE,
    headless: true,
    viewport: null,
    // 窓は本物の大きさで（Playwright の viewport の見せかけは取り込みの画に効かず下が欠ける）：headless の窓は隠れた道具の帯（139 px）と、
    // 取り込みの間の「共有中」の帯（53 px）があるので 1280×912・画面 1920×1080 → 録画中のページの中は 1280×720（e2e/v28-voice-check.mjs と同じ）
    args: [...GL, '--auto-accept-this-tab-capture', '--autoplay-policy=no-user-gesture-required', `--window-size=${VIEW.width},${VIEW.height + 192}`, '--screen-info={1920x1080}'],
    ignoreDefaultArgs: ['--mute-audio'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.setDefaultTimeout(600000);
  const env = { errors: [], cspConsole: [], voiceResp: [], marks: [], holds: {}, approach: APPROACH, label: null, browser: ctx.browser()?.version() ?? null };
  page.on('pageerror', (e) => env.errors.push(`pageerror ${String(e.message).slice(0, 200)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') (/Content Security Policy/i.test(m.text()) ? env.cspConsole : env.errors).push(m.text().slice(0, 200));
  });
  rmSync(WEBM, { force: true });
  await page.addInitScript(INIT, { durs: LINES.map((l) => [l.id, l.sec]) });
  let timeOrigin = null;
  const pageNow = () => (timeOrigin === null ? null : r1(Date.now() - timeOrigin));
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/voice/')) env.voiceResp.push({ path: u.pathname, status: r.status(), type: r.headers()['content-type'], t: pageNow() });
  });
  const mark = (what, extra = {}) => {
    const m = { what, t: pageNow(), ...extra };
    env.marks.push(m);
    say(`mark ${what}${Object.keys(extra).length ? ' ' + JSON.stringify(extra) : ''}`);
    return m;
  };
  /** 返事を待つ上限つき（この環境ではページが長く応えないことがある：止まったら誤りにして、録画を止めて記録を残す） */
  const limit = async (p, ms, what) => {
    let tm;
    try {
      return await Promise.race([p, new Promise((_, rej) => (tm = setTimeout(() => rej(new Error(`${Math.round(ms / 1000)} 秒応えない：${what}`)), ms)))]);
    } finally {
      clearTimeout(tm);
    }
  };
  const q = (fn, arg, ms = 180000) => limit(page.evaluate(fn, arg), ms, 'page.evaluate');
  const state = () => q(() => ({ n: window.__rt.raf.length, cine: document.querySelector('.g-layer[data-kind="cine"]')?.dataset.cine ?? null, hud: (() => { const h = document.querySelector('.g-hud'); return !!h && !h.hidden && h.getClientRects().length > 0 && !document.body.classList.contains('g-cine'); })() }));
  /** cond が真になるまで Node から見る（Playwright の待ちはコマごとに見ることがあり、1 コマ数秒のこの環境では遅れるので、150 ms ごとに） */
  const until = async (cond, timeoutMs, what) => {
    const t = Date.now();
    for (;;) {
      const s = await state();
      if (cond(s)) return s;
      if (Date.now() - t > timeoutMs) throw new Error(`待ちきれない：${what}（${JSON.stringify(s)}）`);
      await sleep(150);
    }
  };
  /** 描いたコマの数が n 増えるまで */
  const frames = async (n, timeoutMs = 120000) => {
    const s0 = await state();
    return until((s) => s.n - s0.n >= n, timeoutMs, `${n} コマ`);
  };
  /** 押したまま、ms 秒以上かつ minFrames コマ以上（演出が始まったらすぐ返る） */
  const hold = async (key, ms, minFrames, maxMs = 240000) => {
    const s0 = await state();
    const t = Date.now();
    for (;;) {
      await sleep(150);
      const s = await state();
      const el = Date.now() - t;
      if (s.cine || (el >= ms && s.n - s0.n >= minFrames) || el > maxMs) return (env.holds[key] = { ms: el, frames: s.n - s0.n, cine: s.cine });
    }
  };
  let recording = false;
  let fatal = null;
  try {
    const resp = await page.goto(`http://localhost:${PORT}/${QUERY}`);
    timeOrigin = await q(() => performance.timeOrigin);
    env.csp = resp?.headers()['content-security-policy'] ?? null;
    await page.locator('.g-btn[data-id="new:ieyasu1570"]').waitFor({ state: 'visible', timeout: 600000 });
    await page.waitForFunction(() => !document.getElementById('loading') || document.getElementById('loading').hidden || getComputedStyle(document.getElementById('loading')).display === 'none', null, { timeout: 600000, polling: 200 });
    env.loadSec = r1((Date.now() - T0) / 1000);
    env.build = (await page.textContent('#build').catch(() => null))?.trim() ?? null;
    env.devHooks = await q(() => !!(window.__game || window.__battle || window.__p3 || window.__audio));
    env.gpu = await q(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const e = gl?.getExtension('WEBGL_debug_renderer_info');
      const s = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : null;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      return s;
    });
    say(`title shown (${env.loadSec} s). build: ${env.build}. dev hooks: ${env.devHooks}. GPU: ${env.gpu}. CSP: ${env.csp === PROD_CSP ? 'production' : env.csp}`);
    // ---- ラベル → 録り始め
    env.label = await q((t) => window.__rtLabel(t), LABEL);
    await frames(2, 30000);
    env.capStart = await q((bps) => window.__rtCapStart(bps), VIDEO_BPS);
    recording = true;
    mark('録り始め', { tracks: env.capStart.tracks.map((t) => `${t.kind}:${t.label}`) });
    // 取り込みの「共有中」の帯が出て、ページの中が 1280×720 になるまで
    const t1 = Date.now();
    while (Date.now() - t1 < 8000) {
      env.inner = await q(() => [innerWidth, innerHeight]);
      if (env.inner[0] === VIEW.width && env.inner[1] === VIEW.height) break;
      await sleep(200);
    }
    if (env.inner[0] !== VIEW.width || env.inner[1] !== VIEW.height) say(`注意：録画中のページの中 ${env.inner.join('×')}（${VIEW.width}×${VIEW.height} のつもり）`);
    await sleep(1500);
    // ---- タイトルで「はじめから」（本物のクリック）
    const b = await page.locator('.g-btn[data-id="new:ieyasu1570"]').boundingBox();
    mark('「はじめから」をクリック');
    await limit(page.mouse.click(b.x + b.width / 2, b.y + b.height / 2), 300000, 'mouse.click');
    const sOpen = await until((s) => !!s.cine, 120000, '冒頭の演出');
    mark('冒頭の演出が出た', { cine: sOpen.cine });
    // ---- 冒頭をそのまま見る（押さない）
    await until((s) => !s.cine && s.hud, 1800000, '冒頭の終わり（操作）');
    mark('冒頭が終わり操作が戻った');
    await frames(1);
    // ---- W で北へ・Shift＋W で走る
    mark('W を押す');
    await limit(page.keyboard.down('KeyW'), 120000, 'key');
    const hw = await hold('W', 3000, 2);
    mark('Shift を足す（Shift＋W）', hw);
    await limit(page.keyboard.down('ShiftLeft'), 120000, 'key');
    const hr = await hold('ShiftW', 2000, 2);
    await limit(page.keyboard.up('ShiftLeft'), 120000, 'key');
    await limit(page.keyboard.up('KeyW'), 120000, 'key');
    mark('Shift と W を離した', hr);
    let s = await state();
    if (!s.cine) {
      await frames(1);
      // ---- 引きずりで見回す（左 → 右 → 真ん中へ戻して離す）。それぞれの向きが少なくとも 1 コマ描かれて画に出るよう、2 コマ待つ
      const lz = await q(() => {
        const r = document.getElementById('look-zone').getBoundingClientRect();
        return { x: Math.round(r.left + r.width * 0.6), y: Math.round(r.top + r.height * 0.45) };
      });
      // 押したままの動きは、ページが次のコマで受け取って返事をする（1 つに 1 コマ以上）。動きは 1 つずつ（Playwright の steps 1）
      const moveTo = (tx) => limit(page.mouse.move(tx, lz.y), 300000, 'mouse.move');
      await moveTo(lz.x);
      mark('引きずり：押す', { x: lz.x, y: lz.y });
      await limit(page.mouse.down(), 300000, 'mouse.down');
      await moveTo(lz.x - DRAG_PX);
      mark(`引きずり：左へ ${DRAG_PX} px`);
      await frames(1);
      mark('引きずり：右へ動かし始める');
      await moveTo(lz.x + DRAG_PX);
      mark(`引きずり：右へ（真ん中から +${DRAG_PX} px）`);
      await frames(1);
      mark('引きずり：真ん中へ戻し始める');
      await moveTo(lz.x);
      await limit(page.mouse.up(), 300000, 'mouse.up');
      mark('引きずり：真ん中で離した');
      await frames(1);
      // ---- また北へ（既定は Shift＋W で走る）、町の急報が始まるまで（PROBE なら決めた秒だけ）
      const keys = APPROACH === 'run' ? ['ShiftLeft', 'KeyW'] : ['KeyW'];
      mark(`急報の線へ進み始める（${APPROACH === 'run' ? 'Shift＋W' : 'W'}）`);
      for (const k of keys) await limit(page.keyboard.down(k), 120000, 'key');
      if (PROBE) {
        await hold('approach', PROBE_WALK_SEC * 1000, 1);
        for (const k of [...keys].reverse()) await limit(page.keyboard.up(k), 120000, 'key');
        mark('キーを離した（PROBE：ここで録り終える）');
      } else {
        s = await until((x) => !!x.cine, 1200000, '町の急報');
        for (const k of [...keys].reverse()) await limit(page.keyboard.up(k), 120000, 'key');
        mark('急報が始まった・キーを離した', { cine: s.cine });
      }
    } else mark('（W／Shift＋W の間に演出が始まった）', { cine: s.cine });
    if (!PROBE) {
      // ---- 急報を飛ばさず最後まで見る
      await until((x) => !x.cine && x.hud, 1800000, '急報の終わり（操作）');
      mark('急報が終わり操作が戻った');
      await frames(1);
      // ---- 忠勝の方へ W で数秒（全体の目安を超えそうなら短く）
      const el = (pageNow() - env.marks.find((m) => m.what === '録り始め').t) / 1000;
      const short = el > BUDGET_SEC - 40;
      mark('W を押す（忠勝の方へ）', { elapsedSec: r1(el), short });
      await limit(page.keyboard.down('KeyW'), 120000, 'key');
      const ha = await hold('W3', short ? 2000 : 3000, short ? 1 : 2);
      await limit(page.keyboard.up('KeyW'), 120000, 'key');
      mark('W を離した', ha);
    }
    await frames(2);
    await sleep(1000);
  } catch (e) {
    fatal = e;
    say(`NG 途中で止まった：${e.message}`);
    await limit(page.keyboard.up('KeyW'), 120000, 'key').catch(() => {});
    await limit(page.keyboard.up('ShiftLeft'), 120000, 'key').catch(() => {});
    await limit(page.mouse.up(), 120000, 'mouse.up').catch(() => {});
  }
  if (recording) {
    env.cap = await q(() => window.__rtCapStop(), undefined, 240000).catch((e) => ({ error: String(e) }));
    mark('録り終え');
    // 録った webm を 8 MB ずつ読んで書く
    if (env.cap?.blobBytes) {
      const STEP = 8 * 1024 * 1024;
      try {
        for (let off = 0; off < env.cap.blobBytes; off += STEP) appendFileSync(WEBM, Buffer.from(await q((a) => window.__rtRead(a[0], a[1]), [off, STEP], 300000), 'base64'));
      } catch (e) {
        env.readError = String(e);
        say(`NG 録画を読めない：${e.message}`);
      }
      say(`webm ${existsSync(WEBM) ? statSync(WEBM).size : 0} / ${env.cap.blobBytes} バイトを書いた`);
    }
  }
  const log = await q(() => ({ ...window.__rt, inner: [innerWidth, innerHeight] }), undefined, 120000).catch(() => null);
  await limit(ctx.close(), 60000, 'ctx.close').catch(() => {});
  rmSync(udd, { recursive: true, force: true });
  await srv.close();
  env.served404 = srv.missing.slice();
  env.fatal = fatal ? String(fatal.stack || fatal) : null;
  return { env, log };
}

// ================================================================ webm の中のブロック（EBML）

function vint(b, p, keepMarker) {
  const first = b[p];
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && !(first & mask)) {
    len++;
    mask >>= 1;
  }
  let v = keepMarker ? first : first & (mask - 1);
  let ones = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[p + i];
    if (b[p + i] !== 0xff) ones = false;
  }
  return { v, len, unknown: !keepMarker && ones };
}
/** Segment・Cluster・Tracks・TrackEntry・BlockGroup・Info・Video・Audio は中へ入る（大きさが「不明」の Cluster もある） */
const MASTER = new Set([0x18538067, 0x1f43b675, 0x1654ae6b, 0xae, 0xa0, 0x1549a966, 0xe0, 0xe1]);
function parseWebm(b) {
  const tracks = {};
  let scale = 1e6;
  let cluster = 0;
  let cur = null;
  const blocks = [];
  let p = 0;
  while (p < b.length - 2) {
    const id = vint(b, p, true);
    const sz = vint(b, p + id.len, false);
    const d = p + id.len + sz.len;
    if (d > b.length) break;
    if (id.v === 0x1a45dfa3) {
      p = d + sz.v;
      continue;
    }
    if (MASTER.has(id.v)) {
      if (id.v === 0xae) cur = {};
      p = d;
      continue;
    }
    const end = sz.unknown ? b.length : Math.min(b.length, d + sz.v);
    const uint = () => {
      let v = 0;
      for (let i = d; i < end; i++) v = v * 256 + b[i];
      return v;
    };
    if (id.v === 0x2ad7b1) scale = uint();
    else if (id.v === 0xe7) cluster = uint();
    else if (id.v === 0xd7) {
      cur.num = uint();
      tracks[cur.num] = cur;
    } else if (id.v === 0x83) cur.type = uint();
    else if (id.v === 0x86) cur.codec = b.subarray(d, end).toString('latin1');
    else if (id.v === 0x63a2) cur.priv = b.subarray(d, end).toString('base64');
    else if (id.v === 0xb0) cur.w = uint();
    else if (id.v === 0xba) cur.h = uint();
    else if (id.v === 0x9f) cur.channels = uint();
    else if (id.v === 0xb5) cur.rate = end - d === 4 ? b.readFloatBE(d) : b.readDoubleBE(d);
    else if (id.v === 0xa3 || id.v === 0xa1) {
      const tn = vint(b, d, false);
      const tc = (((b[d + tn.len] << 8) | b[d + tn.len + 1]) << 16) >> 16;
      const flags = b[d + tn.len + 2];
      const off = d + tn.len + 3;
      blocks.push({ track: tn.v, ms: ((cluster + tc) * scale) / 1e6, key: !!(flags & 0x80), off, size: end - off });
    }
    p = end;
  }
  return { tracks, scale, blocks };
}

// ================================================================ 録った物をほどく（別の Chromium。音は出さない）

async function decodeRecording(webmInfo, regions, pick) {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(900000);
    await page.route('http://localhost:47999/**', (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/') return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>rt</title>' });
      if (u.pathname === '/webm') return r.fulfill({ status: 200, contentType: 'video/webm', body: readFileSync(WEBM) });
      if (u.pathname.startsWith('/voice/')) return r.fulfill({ status: 200, contentType: 'audio/mpeg', body: readFileSync(join(DIST, u.pathname.slice(1))) });
      return r.fulfill({ status: 404, body: '' });
    });
    await page.goto('http://localhost:47999/'); // localhost は安全な文脈（WebCodecs が使える）
    const vTrack = Object.values(webmInfo.tracks).find((t) => t.type === 1);
    const aTrack = Object.values(webmInfo.tracks).find((t) => t.type === 2);
    const vb = webmInfo.blocks.filter((x) => x.track === vTrack.num).map(({ ms, key, off, size }) => ({ ms, key, off, size }));
    const ab = aTrack ? webmInfo.blocks.filter((x) => x.track === aTrack.num).map(({ ms, off, size }) => ({ ms, off, size })) : [];
    const res = await page.evaluate(
      async ({ vb, ab, aTrack, regions, pick, wantAudio, voices }) => {
        const buf = new Uint8Array(await (await fetch('/webm')).arrayBuffer());
        const errs = [];
        const b64 = (u8) => {
          let s = '';
          for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
          return btoa(s);
        };
        // ---- 映像：コマごとに、全体の縮めた明るさ（64×36）・字幕の帯（192×16）・ラベルの所（明るさの平均と散らばり）。選んだコマは JPEG に
        const small = new OffscreenCanvas(192, 36);
        const g = small.getContext('2d', { willReadFrequently: true });
        const luma = (w, h) => {
          const d = g.getImageData(0, 0, w, h).data;
          const o = new Uint8Array(w * h);
          for (let i = 0; i < o.length; i++) o[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
          return o;
        };
        const frames = [];
        const jpegs = [];
        let idx = 0;
        const dec = new VideoDecoder({
          output: (fr) => {
            const i = idx++;
            const w = fr.displayWidth;
            const h = fr.displayHeight;
            const f = { i, ms: fr.timestamp / 1000, w, h };
            g.drawImage(fr, 0, 0, w, h, 0, 0, 64, 36);
            f.thumb = b64(luma(64, 36));
            if (regions.cap && h === regions.inner[1]) {
              const [x, y, rw, rh] = regions.cap;
              g.drawImage(fr, x, y, rw, rh, 0, 0, 192, 16);
              f.cap = b64(luma(192, 16));
            }
            if (regions.label) {
              const [x, y, rw, rh] = regions.label;
              g.drawImage(fr, x, y, rw, rh, 0, 0, 96, 8);
              const l = luma(96, 8);
              let m = 0;
              for (const v of l) m += v;
              m /= l.length;
              let sd = 0;
              for (const v of l) sd += (v - m) ** 2;
              f.label = [Math.round(m), Math.round(Math.sqrt(sd / l.length))];
            }
            if (pick.includes(i)) {
              const c = new OffscreenCanvas(w, h);
              c.getContext('2d').drawImage(fr, 0, 0);
              jpegs.push(c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }).then(async (bl) => ({ i, ms: f.ms, b64: b64(new Uint8Array(await bl.arrayBuffer())) })));
            }
            frames.push(f);
            fr.close();
          },
          error: (e) => errs.push(`video ${e}`),
        });
        dec.configure({ codec: 'vp8' });
        for (const b of vb) dec.decode(new EncodedVideoChunk({ type: b.key ? 'key' : 'delta', timestamp: Math.round(b.ms * 1000), data: buf.subarray(b.off, b.off + b.size) }));
        await dec.flush();
        dec.close();
        const out = { frames, jpegs: await Promise.all(jpegs), errs };
        if (!wantAudio) return out;
        // ---- 音：かたまりごとに WebCodecs でほどき、webm の時刻の所へ置く（途切れがあればそのまま空く）→ 16 kHz に
        const SR = 48000;
        const lastMs = ab.length ? ab.at(-1).ms + 200 : 0;
        const line = new Float32Array(Math.ceil((lastMs / 1000) * SR));
        let placed = 0;
        let audioWay = 'webcodecs';
        try {
          const cfg = { codec: 'opus', sampleRate: aTrack.rate || 48000, numberOfChannels: aTrack.channels || 2 };
          if (aTrack.priv) cfg.description = Uint8Array.from(atob(aTrack.priv), (c) => c.charCodeAt(0));
          const ad = new AudioDecoder({
            output: (d) => {
              const n = d.numberOfFrames;
              const ch = d.numberOfChannels;
              const tmp = new Float32Array(n);
              const at = Math.round((d.timestamp / 1e6) * SR);
              for (let c = 0; c < ch; c++) {
                d.copyTo(tmp, { planeIndex: c, format: 'f32-planar' });
                for (let k = 0; k < n && at + k < line.length; k++) if (at + k >= 0) line[at + k] += tmp[k] / ch;
              }
              placed += n;
              d.close();
            },
            error: (e) => errs.push(`audio ${e}`),
          });
          ad.configure(cfg);
          for (const b of ab) ad.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(b.ms * 1000), data: buf.subarray(b.off, b.off + b.size) }));
          await ad.flush();
          ad.close();
        } catch (e) {
          errs.push(`audio webcodecs ${e}`);
          audioWay = 'none';
        }
        const to16k = async (data, rate) => {
          const n = Math.ceil((data.length / rate) * 16000);
          const oc = new OfflineAudioContext(1, Math.max(1, n), 16000);
          const ab2 = oc.createBuffer(1, Math.max(1, data.length), rate);
          ab2.copyToChannel(data, 0);
          const src = oc.createBufferSource();
          src.buffer = ab2;
          src.connect(oc.destination);
          src.start(0);
          const r = await oc.startRendering();
          return r.getChannelData(0);
        };
        const a16 = await to16k(line, SR);
        out.audio = { way: audioWay, placedSec: placed / SR, b64: b64(new Uint8Array(a16.buffer)) };
        // ---- 台詞の音声ファイル（dist の voice/*.mp3）を 16 kHz に
        out.voices = {};
        for (const [id, file] of voices) {
          const bytes = await (await fetch('/' + file)).arrayBuffer();
          const v = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(bytes);
          const m = new Float32Array(v.length);
          for (let c = 0; c < v.numberOfChannels; c++) {
            const d = v.getChannelData(c);
            for (let i = 0; i < m.length; i++) m[i] += d[i] / v.numberOfChannels;
          }
          out.voices[id] = b64(new Uint8Array(m.buffer));
        }
        return out;
      },
      { vb, ab, aTrack: aTrack ?? null, regions, pick, wantAudio: pick.length === 0 && !!aTrack, voices: LINES.map((l) => [l.id, l.file]) },
    );
    const f32 = (s) => {
      const bb = Buffer.from(s, 'base64');
      return new Float32Array(bb.buffer, bb.byteOffset, bb.length / 4);
    };
    if (res.audio) res.audio.data = f32(res.audio.b64);
    if (res.voices) for (const k of Object.keys(res.voices)) res.voices[k] = f32(res.voices[k]);
    return res;
  } finally {
    await browser.close();
  }
}

// ================================================================ 声の分析（e2e/v28-voice-check.mjs と同じ式）

const SR = 16000;
const WIN = 320; // 20 ms
const VOICED_DB = -18;
const HIT_CORR = 0.4;

function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len;
    const half = len >> 1;
    const wr = new Float64Array(half);
    const wi = new Float64Array(half);
    for (let j = 0; j < half; j++) {
      wr[j] = Math.cos(ang * j);
      wi[j] = Math.sin(ang * j);
    }
    for (let i = 0; i < n; i += len)
      for (let j = 0; j < half; j++) {
        const a = i + j;
        const b = a + half;
        const br = re[b] * wr[j] - im[b] * wi[j];
        const bi = re[b] * wi[j] + im[b] * wr[j];
        re[b] = re[a] - br;
        im[b] = im[a] - bi;
        re[a] += br;
        im[a] += bi;
      }
  }
  if (inv)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}
/** 録音 x の中の型 p の正規化した相互相関（添字 k は p の頭が x[k] に来る位置） */
function nccOf(x, p) {
  let L = 1;
  while (L < x.length + p.length) L <<= 1;
  const xr = new Float64Array(L);
  const xi = new Float64Array(L);
  xr.set(x);
  fft(xr, xi, false);
  const pr = new Float64Array(L);
  const pi = new Float64Array(L);
  pr.set(p);
  fft(pr, pi, false);
  for (let i = 0; i < L; i++) {
    const a = xr[i];
    const b = xi[i];
    const c = pr[i];
    const d = -pi[i];
    pr[i] = a * c - b * d;
    pi[i] = a * d + b * c;
  }
  fft(pr, pi, true);
  let pe = 0;
  for (const v of p) pe += v * v;
  const cum = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) cum[i + 1] = cum[i] + x[i] * x[i];
  const n = x.length - p.length;
  const out = new Float32Array(Math.max(0, n));
  for (let k = 0; k < n; k++) {
    const e = cum[k + p.length] - cum[k];
    out[k] = e > 1e-9 ? pr[k] / Math.sqrt(pe * e) : 0;
  }
  return out;
}
function highpass(x, fc = 300) {
  const w0 = (2 * Math.PI * fc) / SR;
  const c = Math.cos(w0);
  const al = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + al;
  const b0 = (1 + c) / 2 / a0;
  const b1 = -(1 + c) / a0;
  const b2 = (1 + c) / 2 / a0;
  const a1 = (-2 * c) / a0;
  const a2 = (1 - al) / a0;
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}
function windowsOf(T) {
  const es = [];
  for (let i = 0; i + WIN <= T.length; i += WIN) {
    let e = 0;
    for (let j = i; j < i + WIN; j++) e += T[j] * T[j];
    es.push(e);
  }
  const peakE = Math.max(...es);
  return es.map((e) => ({ e, voiced: e >= peakE * 10 ** (VOICED_DB / 10) }));
}
function windowCorr(x, T, k0, ws) {
  let shift = 0;
  const corrAt = (i0, len, d) => {
    let xy = 0;
    let xx = 0;
    let tt = 0;
    for (let j = 0; j < len; j++) {
      const u = x[k0 + d + i0 + j] ?? 0;
      const t = T[i0 + j] ?? 0;
      xy += u * t;
      xx += u * u;
      tt += t * t;
    }
    return xx > 1e-14 && tt > 0 ? xy / Math.sqrt(xx * tt) : 0;
  };
  const bestIn = (i0, len, lo, hi) => {
    let b = { c: -1, d: lo };
    for (let d = lo; d <= hi; d++) {
      const c = corrAt(i0, len, d);
      if (c > b.c) b = { c, d };
    }
    return b;
  };
  return ws.map(({ voiced }, w) => {
    if (!voiced) return null;
    const i0 = w * WIN;
    let b = bestIn(i0, WIN, shift - 48, shift + 48);
    if (b.c < 0.5) {
      const blk = bestIn(i0, Math.min(3 * WIN, T.length - i0), shift - 400, shift + 400);
      if (blk.c >= 0.7 && Math.abs(blk.d) <= 960) {
        shift = blk.d;
        b = bestIn(i0, WIN, shift - 12, shift + 12);
      }
    }
    if (b.c >= 0.6) shift = Math.max(-960, Math.min(960, b.d));
    return { c: b.c, d: b.d };
  });
}
function windowEvidence(x, T, k0, wc) {
  let num = 0;
  let den = 0;
  for (const th of [0.8, 0.6]) {
    wc.forEach((w, i) => {
      if (!w || w.c < th) return;
      for (let j = 0; j < WIN; j++) {
        const t = T[i * WIN + j];
        num += (x[k0 + w.d + i * WIN + j] ?? 0) * t;
        den += t * t;
      }
    });
    if (den > 0) break;
  }
  const g = den > 0 ? num / den : 0;
  const states = wc.map((w, i) => {
    if (!w) return null;
    if (!(g > 0)) return 'i';
    let er = 0;
    let et = 0;
    let eres = 0;
    for (let j = 0; j < WIN; j++) {
      const r = x[k0 + w.d + i * WIN + j] ?? 0;
      const t = g * T[i * WIN + j];
      er += r * r;
      et += t * t;
      eres += (r - t) * (r - t);
    }
    if (eres <= 0.5 * er) return 'p';
    if (eres >= er && et >= 0.5 * er) return 'a';
    return 'i';
  });
  return { g, states };
}
function lastPlayed(states) {
  const v = states.map((st, i) => [st, i]).filter(([st]) => st === 'p' || st === 'a');
  let bestCut = 0;
  let bestCost = Infinity;
  let absentBefore = 0;
  let presentAfter = v.filter(([st]) => st === 'p').length;
  for (let cut = 0; cut <= v.length; cut++) {
    const cost = absentBefore + presentAfter;
    if (cost < bestCost) {
      bestCost = cost;
      bestCut = cut;
    }
    if (cut < v.length) {
      if (v[cut][0] === 'p') presentAfter--;
      else absentBefore++;
    }
  }
  const before = v.slice(0, bestCut).filter(([st]) => st === 'p');
  return before.length ? before.at(-1)[1] : -1;
}
function lastVoicedSec(T) {
  const ws = windowsOf(T);
  let last = ws.length - 1;
  while (last > 0 && !ws[last].voiced) last--;
  return ((last + 1) * WIN) / SR;
}

/**
 * 録音（webm の時刻の 16 kHz）の中で、ページの記録の声の音源ごとに、その音声ファイルの頭が来た位置を探す（予定の位置の前後 radius 秒。
 * 声の強い所の 0.6 秒で相関）→ 20 ms ごとの相関と大きさで、どこまで鳴ったか。返り：webm の時刻（ms）の始まり・鳴った長さなど
 */
function analyzeVoices(audio, templates, starts, guessOff, radiusSec = 4) {
  const x = highpass(audio);
  const out = [];
  for (const s of starts) {
    const T = highpass(templates[s.id]);
    const ws = windowsOf(T);
    const strong = ws.findIndex((w) => w.voiced) * WIN;
    const seg = T.subarray(strong, Math.min(T.length, strong + Math.round(0.6 * SR)));
    const plannedOut = s.out ? s.out.p + (s.when - s.out.c) * 1000 : s.t;
    const expectK = Math.round(((plannedOut - guessOff) / 1000) * SR);
    const R = Math.round(radiusSec * SR);
    const lo = Math.max(0, expectK + strong - R);
    const hi = Math.min(x.length, expectK + strong + R + seg.length);
    if (hi - lo <= seg.length) {
      out.push({ id: s.id, n: s.n, error: '録音の外' });
      continue;
    }
    const c = nccOf(x.subarray(lo, hi), seg);
    let best = { k: -1, v: -1 };
    for (let i = 0; i < c.length; i++) if (c[i] > best.v) best = { k: i, v: c[i] };
    let second = -1;
    for (let i = 0; i < c.length; i++) if (Math.abs(i - best.k) > 0.3 * SR && c[i] > second) second = c[i];
    const k0 = lo + best.k - strong;
    const wc = windowCorr(x, T, k0, ws);
    const ev = windowEvidence(x, T, k0, wc);
    const last = lastPlayed(ev.states);
    const voiced = wc.filter((w) => w);
    const hits = voiced.filter((w) => w.c >= HIT_CORR).length;
    const count = (k) => ev.states.filter((st) => st === k).length;
    out.push({
      id: s.id,
      n: s.n,
      plannedOutPageMs: r1(plannedOut),
      fileStartRecMs: r1((k0 / SR) * 1000),
      speechStartRecMs: r1((k0 / SR) * 1000 + LINE[s.id].lead * 1000),
      corr: r3(best.v),
      secondCorr: r3(second),
      playedSec: last >= 0 ? r3(((last + 1) * WIN) / SR) : 0,
      voicedSec: r3(lastVoicedSec(T)),
      windowsMatched: `${hits}/${voiced.length}`,
      evidence: { present: count('p'), absent: count('a'), undecided: count('i'), gain: r3(ev.g) },
      states: ev.states.map((st) => st ?? '.').join(''),
    });
  }
  return out;
}

// ================================================================ 分析とまとめ

const median = (v) => (v.length ? v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)] : null);
const pct = (v, p) => (v.length ? v.slice().sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(v.length * p))] : null);
const u8 = (s) => Uint8Array.from(Buffer.from(s, 'base64'));
const p95diff = (a, b) => {
  const d = Array.from(a, (q, i) => Math.abs(q - b[i])).sort((x, y) => x - y);
  return d[Math.floor(d.length * 0.95)];
};
const meanDiff = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};

async function analyze(run) {
  const { env, log } = run;
  const A = { notes: [] };
  const mk = (what) => env.marks.find((m) => m.what.startsWith(what))?.t ?? null;
  const capStart = log.cap?.startT ?? mk('録り始め');
  const capStop = log.cap?.stopT ?? mk('録り終え');
  // ---- コマの速さ（ページの requestAnimationFrame）：録画の間と、区間ごと
  const raf = log.raf.map(([ts]) => ts);
  const seg = (name, a, b, cap) => {
    if (a === null || b === null || !(b > a)) return null;
    const ts = raf.filter((t) => t >= a && t <= b);
    const iv = ts.slice(1).map((t, i) => t - ts[i]);
    const wall = (b - a) / 1000;
    // ゲームの時計：探索は 1 コマ 0.1 秒・演出は 1 コマ 1 秒までに切り詰める（main.ts・ui/cinePlayer.ts）。進んだ時計 ÷ 実時間
    const game = cap ? iv.reduce((s, d) => s + Math.min(d / 1000, cap), 0) : null;
    return { name, fromMs: r0(a), toMs: r0(b), wallSec: r1(wall), frames: ts.length, fps: r2(ts.length / wall), intervalMs: { p50: r0(median(iv)), p90: r0(pct(iv, 0.9)), max: r0(Math.max(...iv)) }, clockCapSec: cap, gameClockPerRealSec: game === null ? null : r3(game / Math.max(1e-6, (ts.at(-1) - ts[0]) / 1000)) };
  };
  const evStart = mk('急報が始まった');
  const evEnd = mk('急報が終わり');
  A.fps = {
    whole: seg('録画の全体', capStart, capStop, null),
    // タイトルは文字だけで速い（3D を描かない）。3D を描く間の速さは「はじめから」から録り終えまで
    game: seg('3D を描く間（はじめから→録り終え）', mk('「はじめから」'), capStop, null),
    segments: [
      seg('タイトル（録り始め→はじめから）', capStart, mk('「はじめから」'), null),
      seg('冒頭の演出 ch1_open（はじめから→操作）', mk('「はじめから」'), mk('冒頭が終わり'), 1),
      seg('W・Shift＋W', mk('W を押す'), mk('Shift と W を離した'), 0.1),
      seg('引きずりの見回し', mk('引きずり：押す'), mk('引きずり：真ん中で離した'), 0.1),
      seg(`急報の線まで（${run.env.approach === 'walk' ? 'W' : 'Shift＋W'}）`, mk('急報の線へ進み始める'), evStart ?? mk('キーを離した（PROBE'), 0.1),
      seg('町の急報 ch1_report（最後まで）', evStart, evEnd, 1),
      seg('急報の後（W で忠勝の方へ）', evEnd, capStop, 0.1),
    ].filter(Boolean),
  };
  // ---- webm の中
  const buf = readFileSync(WEBM);
  const wi = parseWebm(buf);
  const vT = Object.values(wi.tracks).find((t) => t.type === 1);
  const aT = Object.values(wi.tracks).find((t) => t.type === 2);
  const vb = wi.blocks.filter((b) => b.track === vT?.num);
  const ab = wi.blocks.filter((b) => b.track === aT?.num);
  const adt = ab.slice(1).map((b, i) => b.ms - ab[i].ms);
  const step = median(adt) ?? 0;
  const gaps = ab.slice(1).map((b, i) => ({ at: ab[i].ms, ms: b.ms - ab[i].ms - step })).filter((g) => Math.abs(g.ms) > 1);
  const durMs = Math.max(vb.at(-1)?.ms ?? 0, (ab.at(-1)?.ms ?? 0) + step);
  A.webm = {
    bytes: buf.length,
    durationSec: r2(durMs / 1000),
    tracks: Object.values(wi.tracks).map((t) => ({ num: t.num, type: t.type === 1 ? 'video' : 'audio', codec: t.codec, w: t.w, h: t.h, rate: t.rate, channels: t.channels })),
    video: { frames: vb.length, keyframes: vb.filter((b) => b.key).length, firstMs: vb[0]?.ms, lastMs: vb.at(-1)?.ms, avgFps: r3(vb.length / (durMs / 1000)), intervalMs: { p50: r0(median(vb.slice(1).map((b, i) => b.ms - vb[i].ms))), max: r0(Math.max(...vb.slice(1).map((b, i) => b.ms - vb[i].ms))) } },
    audio: aT ? { blocks: ab.length, blockMs: step, firstMs: ab[0]?.ms, lastMs: ab.at(-1)?.ms, gaps: gaps.length, gapList: gaps.slice(0, 20).map((g) => ({ atMs: r0(g.at), ms: r0(g.ms) })) } : null,
  };
  // ---- 字幕の帯・ラベルの所（ページの記録の四角。1280×720 の時の物）
  // 字幕の帯の四角は、1280×720 の時に書いた字幕の四角をすべて含む四角
  const rects = log.text.filter((e) => e.kind === 'cap' && e.rect && e.inner?.[1] === VIEW.height).map((e) => e.rect);
  const capRect = rects.length ? (() => {
    const x0 = Math.min(...rects.map((r) => r[0]));
    const y0 = Math.min(...rects.map((r) => r[1]));
    const x1 = Math.max(...rects.map((r) => r[0] + r[2]));
    const y1 = Math.max(...rects.map((r) => r[1] + r[3]));
    return [x0, y0, x1 - x0, y1 - y0];
  })() : null;
  const regions = { cap: capRect, label: log.label?.rect ?? null, inner: [VIEW.width, VIEW.height] };
  // ---- 1 回目のほどき：コマの印・音・型
  say('analysis: decoding video frames and audio (WebCodecs)');
  const d1 = await decodeRecording(wi, regions, []);
  if (d1.errs.length) A.notes.push(`ほどきの誤り：${d1.errs.slice(0, 5).join(' / ')}`);
  const frames = d1.frames.map((f) => ({ ...f, thumb: u8(f.thumb), cap: f.cap ? u8(f.cap) : null }));
  // コマの替わり（全体の縮めた画の差）
  let distinct = 0;
  frames.forEach((f, i) => {
    f.change = i === 0 ? 255 : r1(meanDiff(f.thumb, frames[i - 1].thumb));
    if (i === 0 || f.change >= 0.5) distinct++;
  });
  A.video = {
    decodedFrames: frames.length,
    sizes: [...new Set(frames.map((f) => `${f.w}x${f.h}`))],
    framesBySize: Object.fromEntries([...new Set(frames.map((f) => `${f.w}x${f.h}`))].map((k) => [k, frames.filter((f) => `${f.w}x${f.h}` === k).length])),
    distinctFrames: distinct,
    labelSeen: frames.filter((f) => f.label && f.label[1] >= 20).length,
    labelChecked: frames.filter((f) => f.label).length,
  };
  // ---- 声：録音の中の始まり・鳴った長さ（予定の位置はページの時刻から。webm の 0 ≒ 録り始めの onstart）
  const starts = log.src.filter((e) => e.ev === 'start');
  let off = capStart;
  if (d1.audio && starts.length) {
    const v1 = analyzeVoices(d1.audio.data, d1.voices, starts, capStart);
    const offs = v1.filter((v) => v.corr >= 0.6).map((v) => v.plannedOutPageMs - v.fileStartRecMs);
    if (offs.length) off = median(offs);
    A.voice = v1.map((v) => ({ ...v, offsetMs: v.corr >= 0.6 ? r1(v.plannedOutPageMs - v.fileStartRecMs) : null }));
    A.pageToRec = { offsetMs: r1(off), fromVoices: offs.length, spreadMs: offs.length > 1 ? r1(Math.max(...offs) - Math.min(...offs)) : null, recorderOnstartMs: r1(capStart), note: 'ページの時刻 − webm の時刻（声の音源の予定の出力の時刻と、録音の中で見つけた音声ファイルの頭の差）' };
  } else A.pageToRec = { offsetMs: r1(off), fromVoices: 0, note: '声が無いので、録り始め（MediaRecorder の onstart）を webm の 0 とした（数十〜数百 ms の誤差）' };
  A.audio = d1.audio ? { way: d1.audio.way, placedSec: r2(d1.audio.placedSec) } : null;
  if (d1.audio) {
    // 録音全体の大きさ（曲・声が入っているか）：1 秒ごとの RMS の中央値と最小
    const a = d1.audio.data;
    const rms = [];
    for (let i = 0; i + SR <= a.length; i += SR) {
      let s = 0;
      for (let j = i; j < i + SR; j++) s += a[j] * a[j];
      rms.push(Math.sqrt(s / SR));
    }
    A.audio.rmsPerSec = { median: r3(median(rms)), min: r3(Math.min(...rms)), max: r3(Math.max(...rms)), silentSec: rms.filter((v) => v < 1e-3).length, totalSec: rms.length };
  }
  const toRec = (pageMs) => (pageMs === null ? null : pageMs - off);
  A.timeline = env.marks.filter((m) => m.t !== null).map((m) => ({ recSec: r1((m.t - off) / 1000), what: m.what }));
  // 演出の層が出た・閉じた時刻（ページの中の記録。上の印は Node がページを見に行った時刻で、1 コマに数秒かかるこの環境では数秒遅れる）
  {
    let prev = null;
    for (const d of log.dom) {
      if (d.cine !== prev) A.timeline.push({ recSec: r1((d.t - off) / 1000), what: d.cine ? `（ページの記録）演出の層が出た：${d.cine}` : `（ページの記録）演出の層が閉じた：${prev}` });
      prev = d.cine;
    }
    A.timeline = A.timeline.filter((x) => !(x.what.includes('閉じた：null'))).sort((a, b) => a.recSec - b.recSec);
  }
  // ---- 声の待ち（演出の再生器が字幕の声のほどけを待って時計を止めた間：層の data-voice-wait="1"）
  A.voiceWaits = [];
  {
    let open = null;
    for (const d of log.dom) {
      if (d.vw && !open) open = { fromMs: d.t, cine: d.cine, capBefore: d.cap };
      else if (!d.vw && open) {
        A.voiceWaits.push({ ...open, toMs: d.t, ms: r0(d.t - open.fromMs), capAfter: d.cap });
        open = null;
      }
    }
    if (open) A.voiceWaits.push({ ...open, toMs: null, ms: null, capAfter: null });
  }
  A.voiceWaitObserved = log.dom.some((d) => d.vw !== undefined);
  // ---- 字幕：ページで書いた時刻・次のコマ・録画の中で字幕の帯の画が替わったコマ・声
  const capFrames = frames.filter((f) => f.cap);
  A.captions = [];
  for (const e of log.text.filter((x) => x.kind === 'cap')) {
    const id = LINES.find((l) => l.text === e.text)?.id ?? null;
    const rc = toRec(e.t);
    const before = capFrames.filter((f) => f.ms <= rc - 30).at(-1) ?? null;
    let seen = null;
    if (before) for (const f of capFrames) if (f.ms > before.ms && p95diff(f.cap, before.cap) >= 12) { seen = f; break; }
    const st = id ? starts.find((s) => s.id === id && s.t >= e.t - 1 && s.t - e.t < 60000) : null;
    const v = st ? A.voice?.find((x) => x.n === st.n) : null;
    const row = {
      text: e.text,
      id,
      pageSetMs: e.t,
      nextFrameStartMs: e.raf1 !== null ? r0(e.raf1 - e.t) : null,
      recSetMs: r0(rc),
      videoFrameBeforeMs: before ? r0(before.ms) : null,
      videoShownMs: seen ? r0(seen.ms) : null,
      videoDelayMs: seen ? r0(seen.ms - rc) : null,
    };
    if (st) {
      const planned = st.out ? st.out.p + (st.when - st.out.c) * 1000 : null;
      row.voice = {
        startCallAfterCaptionMs: r1(st.t - e.t),
        plannedOutAfterCaptionMs: planned !== null ? r1(planned - e.t) : null,
        endedAfterCaptionMs: (() => {
          const en = log.src.find((x) => x.n === st.n && x.ev === 'ended');
          return en ? r1(en.t - e.t) : null;
        })(),
        stopped: log.src.some((x) => x.n === st.n && x.ev === 'stop'),
      };
      if (v && !v.error) {
        row.voice.recSpeechStartMs = v.speechStartRecMs;
        row.voice.speechMinusCaptionShownMs = seen ? r0(v.speechStartRecMs - seen.ms) : null;
        row.voice.speechMinusCaptionSetMs = r0(v.speechStartRecMs - rc);
        row.voice.playedSec = v.playedSec;
        row.voice.voicedSec = v.voicedSec;
        row.voice.corr = v.corr;
      }
    } else if (id) row.voice = { missing: true };
    if (id) {
      // 音声ファイルの返事・ほどき（decodeAudioData）の終わりが、字幕を書いた時刻の何 ms 前か（負は後）。字幕を書く前に止めた声の待ち
      const resp = env.voiceResp.find((r) => r.path.endsWith(`/${id}.mp3`));
      const decs = log.dec.filter((d) => d.id === id);
      const decBefore = decs.filter((d) => d.t <= e.t).at(-1) ?? null;
      const decAny = decBefore ?? decs[0] ?? null;
      const wait = A.voiceWaits.find((w) => w.toMs !== null && w.toMs >= e.t - 100 && w.toMs <= e.t + 100) ?? null;
      row.prep = {
        responseBeforeCaptionMs: resp && resp.t !== null ? r0(e.t - resp.t) : null,
        decodeStartBeforeCaptionMs: decAny ? r0(e.t - decAny.t0) : null,
        decodedBeforeCaptionMs: decAny ? r0(e.t - decAny.t) : null,
        decodes: decs.length,
        heldMs: wait ? wait.ms : 0,
      };
    }
    A.captions.push(row);
  }
  // ---- 代表の 6 コマ（webm の時刻）
  const last = (ms) => frames.filter((f) => ms !== null && f.ms <= ms).at(-1) ?? null;
  const want = [];
  const add = (key, f, why) => f && want.push({ key, i: f.i, ms: r0(f.ms), why });
  add('title', last(toRec(mk('「はじめから」'))), 'タイトル（クリックの直前）');
  const oa = toRec(mk('「はじめから」'));
  const ob = toRec(mk('冒頭が終わり'));
  add('establishing', last(oa + (ob - oa) * 0.6), '冒頭の演出 ch1_open の途中（町の入口の主人公へ寄るカメラ）');
  add('run', last(toRec(mk('Shift と W を離した'))), 'Shift＋W で走った後（離す直前のコマ）');
  add('look', last(toRec(mk('引きずり：右へ動かし始める'))), '引きずりで見回した（左へ引いたまま）');
  const tdk = A.captions.find((c) => c.id === 'ch1.tadakatsu.council' && c.videoShownMs !== null);
  if (tdk) add('event', frames.find((f) => f.ms === tdk.videoShownMs), '町の急報：忠勝の台詞の字幕が録画に出た最初のコマ');
  else if (evStart && evEnd) add('event', last(toRec((evStart + evEnd) / 2)), '町の急報の途中');
  else add('walk', last(toRec(mk('キーを離した（PROBE'))), '北へ進んだ後');
  add('after', last(toRec(capStop) - 300), evEnd ? '急報の後、操作が戻って W で忠勝の方へ歩いた（録り終えの直前）' : '録り終えの直前');
  const pick = [...new Set(want.map((w) => w.i))];
  say(`analysis: writing ${pick.length} representative frames as JPEG`);
  const d2 = await decodeRecording(wi, regions, pick);
  A.frames = want.map((w, k) => {
    const j = d2.jpegs.find((x) => x.i === w.i);
    const file = `${NAME}-${k + 1}-${w.key}.jpg`;
    if (j) writeFileSync(join(OUT, file), Buffer.from(j.b64, 'base64'));
    return { file: j ? file : null, recMs: w.ms, pageMs: r0(w.ms + off), why: w.why };
  });
  A.frameList = frames.map((f) => ({ ms: r0(f.ms), w: f.w, h: f.h, change: f.change, label: f.label ?? null }));
  return A;
}

function readme(run, A) {
  const { env, log } = run;
  const w = A.fps.whole;
  const segs = A.fps.segments;
  const sg = (k) => segs.find((s) => s.name.startsWith(k));
  const walk = sg('急報の線まで');
  const ev = sg('町の急報');
  const open = sg('冒頭の演出');
  const mm = (s) => `${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒`;
  const v = A.voice ?? [];
  const L = [];
  L.push(`# 実時間の録画：第一章「元亀元年・家康」のはじめから町の急報まで（Version 28 の本番ビルド）`, '');
  const big = Object.entries(A.video.framesBySize).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '?';
  const other = Object.entries(A.video.framesBySize).filter(([k]) => k !== big);
  L.push(`- ファイル：\`${NAME}.webm\`（${mm(A.webm.durationSec)}・${(A.webm.bytes / 1e6).toFixed(1)} MB。映像 VP8 ${big.replace('x', '×')}${other.length ? `（録り始めの ${other.map(([k, n]) => `${n} コマだけ ${k.replace('x', '×')}`).join('・')}：「共有中」の帯が出る前）` : ''}・音 Opus ${A.webm.tracks.find((t) => t.type === 'audio')?.rate ?? '?'} Hz ステレオ）、記録 \`${NAME}.json\`、録画から取り出したコマ 6 つ（JPEG。録画をほどいたコマをそのまま JPEG にした）。`);
  L.push(`- 長さ：${A.webm.durationSec > BUDGET_SEC ? `急報を最後まで入れるため、目安の約 ${Math.round(BUDGET_SEC / 60)} 分を超えた。` : ''}急報の後の歩きは W を約 ${((env.holds?.W3?.ms ?? 0) / 1000).toFixed(0)} 秒・${env.holds?.W3?.frames ?? '?'} コマ${env.marks.find((m) => m.what.startsWith('W を押す（忠勝'))?.short ? '（目安を超えそうなので短くした）' : ''}。`);
  L.push('', '## どう作ったか', '');
  L.push('- **実時間の録画**。ページの中の 1 回の録画で、画と音を同時に録った（Chromium の `getDisplayMedia`（今のタブ・音つき）→ `MediaRecorder`（webm・vp8＋opus））。');
  L.push('- **音はゲーム自身の出力**（曲・効果音・台詞の声）をその場で録ったもの。**後から音を足していない・差し替えていない**。映像も切り貼り・速さの変更をしていない。');
  L.push(`- 録ったもの：本番ビルド（\`${env.build ?? '?'}\`）を、公開と同じ CSP のヘッダー付きで読み取り専用で出し、\`${QUERY}\`（画質 低）で開いた。開発用の口は${env.devHooks ? '**あった**' : '無い'}。`);
  L.push(`- ブラウザ：Chromium ${env.browser ?? '?'}（headless・GPU なし。描画は ${env.gpu ?? '?'}）。ページの中の大きさ ${VIEW.width}×${VIEW.height}。`);
  L.push(`- 入力はすべて本物（Playwright のマウスとキー）：タイトルで「はじめから」をクリック → 冒頭の演出をそのまま見る → W で北へ → Shift＋W で走る → 引きずりで左を見て右を見て真ん中へ戻す → ${env.approach === 'walk' ? 'W で歩いて' : 'Shift＋W で走って'}北へ（町の急報が始まるまで${env.approach === 'walk' ? '' : '。この環境ではコマが遅く、歩くと録画が約 9 分になるので、残りの道は走った'}）→ 急報を飛ばさず最後まで見る → 操作が戻ったら W で忠勝の方へ。`);
  L.push(`- 画面に足したのは上の真ん中のラベル 1 つだけ（「${LABEL}」。半透明・押せない。演出の間は上の帯の見出し・ボタンに少し重なる）。ゲームの画面にはほかに何も足していない。ページの中の記録（コマの時刻・字幕を書いた時刻・声の音源の開始）は見るだけ。`);
  L.push('', '## コマが少なく、動きが遅い理由（この環境）', '');
  const g = A.fps.game ?? w;
  L.push(`- この環境の描画はソフトウェアで、3D を描く間（「はじめから」から録り終えまで）のゲームのコマは **${g.fps} コマ/秒**（${g.frames} コマ／${g.wallSec} 秒。1 コマの間の中央値 ${(g.intervalMs.p50 / 1000).toFixed(1)} 秒・最長 ${(g.intervalMs.max / 1000).toFixed(1)} 秒）。タイトル（文字だけ）は速い。`);
  L.push(`- 録画の映像のコマは ${A.webm.video.frames} 個（タブの取り込みは画が替わった時だけコマを出す。3D のコマのほかに、文字の層の小さな替わりのコマを含む）。`);
  if (walk) L.push(`- ゲームは 1 コマの進みを、探索の間は 0.1 秒・演出は 1 秒までに切り詰める。このため町の時計は実時間よりずっと遅く進み（探索の間は実時間の約 ${Math.round(walk.gameClockPerRealSec * 100)}%${ev?.gameClockPerRealSec ? `・急報の演出は約 ${Math.round(ev.gameClockPerRealSec * 100)}%` : ''}）、歩く・走る速さも遅く見える。**滑らかさ・速さの証拠にはならない**（実機で確かめる）。台詞の声は実時間で鳴るので、声が終わってから次の字幕まで長い間がある。`);
  L.push('- `?q=low`（画質 低：アンチエイリアス・後処理・周りの映り込みを省き、影の解像度を下げる）は、コマを増やすために選んだ。');
  L.push('', '## 区間ごとのコマの速さ（ページの requestAnimationFrame）', '', '| 区間 | 実時間 | コマ | コマ/秒 | 1 コマの間（中央値） | ゲームの時計 ÷ 実時間 |', '|---|---|---|---|---|---|');
  for (const s of segs) L.push(`| ${s.name} | ${s.wallSec} 秒 | ${s.frames} | ${s.fps} | ${(s.intervalMs.p50 / 1000).toFixed(1)} 秒 | ${s.gameClockPerRealSec ?? '—'} |`);
  if (A.captions?.some((c) => c.voice)) {
    L.push('', '## 声と字幕の時刻（町の急報）', '');
    L.push('「ページ」はページの中の時刻（字幕の文を DOM に書いた瞬間から）。「録画」は webm の中の時刻（字幕の帯の画が替わった最初の映像のコマと、録音の中の声の始まり）。');
    L.push('', '| 台詞 | 字幕を書いて→声の音源の開始（ページ） | 字幕を書いて→次のコマの始まり（ページ） | 録画に字幕が出たコマ − 字幕を書いた時刻 | 録画の声の始まり − 録画に字幕が出たコマ | 録音で鳴った／声の長さ |', '|---|---|---|---|---|---|');
    for (const c of A.captions.filter((x) => x.voice)) {
      const vv = c.voice;
      L.push(`| ${c.text} | ${vv.missing ? '**鳴らなかった**' : `${vv.startCallAfterCaptionMs} ms`} | ${c.nextFrameStartMs ?? '—'} ms | ${c.videoDelayMs ?? '—'} ms | ${vv.speechMinusCaptionShownMs ?? '—'} ms | ${vv.playedSec ?? '—'}／${vv.voicedSec ?? '—'} 秒 |`);
    }
    L.push('', '声の用意（ページの時刻。字幕を書いた時刻からどれだけ前か）と、演出の再生器が字幕の声を待って時計を止めた長さ（層の `data-voice-wait="1"` の間。字幕はその後に書かれる）：');
    L.push('', '| 台詞 | 音声ファイルの返事 | ほどき（decodeAudioData）の始め | ほどきの終わり | 時計を止めて待った長さ |', '|---|---|---|---|---|');
    for (const c of A.captions.filter((x) => x.voice && x.prep)) {
      const p = c.prep;
      const ms = (v) => (v === null ? '—' : Math.abs(v) >= 10000 ? `${(v / 1000).toFixed(1)} 秒${v < 0 ? '後' : '前'}` : `${v} ms ${v < 0 ? '後' : '前'}`);
      L.push(`| ${c.text} | ${ms(p.responseBeforeCaptionMs)} | ${ms(p.decodeStartBeforeCaptionMs)} | ${ms(p.decodedBeforeCaptionMs)} | ${p.heldMs ? `**${p.heldMs} ms**` : '待たなかった（0）'} |`);
    }
    L.push('', `- ページの中では、声の音源は字幕を書いたのと同じ処理の中で始まる（字幕を書いてから ${(() => { const v = A.captions.filter((c) => c.voice?.startCallAfterCaptionMs != null).map((c) => c.voice.startCallAfterCaptionMs); return v.length ? `${Math.min(...v)}〜${Math.max(...v)}` : '—'; })()} ms）。録音の中の声の始まり（音声ファイルの頭の無音の後）は、字幕を書いた時刻の約 ${(() => { const v = A.captions.filter((c) => c.voice?.speechMinusCaptionSetMs != null).map((c) => c.voice.speechMinusCaptionSetMs); return v.length ? `${Math.min(...v)}〜${Math.max(...v)}` : '—'; })()} ms 後。`);
    L.push('- 録画の画に字幕が出るのは、その字幕を書いたコマが描き終わった時（この環境では 1 コマに数秒）。このため**録画では声が字幕より数秒先に聞こえる**（表の負の値）。これはこの環境の描画の遅さによるもので、1 コマが 16〜33 ms の端末ではずれは 1 コマほどのはず（実機では確かめていない）。');
    L.push(`- 録音の時刻とページの時刻は、鳴った ${A.pageToRec.fromVoices} つの声の予定（getOutputTimestamp）と録音の中の位置から合わせた（ずれの幅 ${A.pageToRec.spreadMs ?? '—'} ms）。`);
  }
  if (A.findings?.length) L.push('', '## 見つかったこと', '', ...A.findings.map((f) => `- ${f}`));
  L.push('', '## 録画の中の時刻（おおよそ）', '', '| 録画の時刻 | 出来事 |', '|---|---|');
  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  for (const t of A.timeline.filter((x) => x.recSec >= 0 && x.recSec <= A.webm.durationSec + 1)) L.push(`| ${fmt(t.recSec)} | ${t.what} |`);
  L.push('', '（入力の時刻は、確かめの側がページの様子を見て書いた時刻。1 コマに数秒かかるので、画に出るのはその後のコマ。）');
  L.push('', '## 取り出したコマ', '', ...A.frames.filter((f) => f.file).map((f) => `- \`${f.file}\`（録画の ${(f.recMs / 1000).toFixed(1)} 秒）：${f.why}`));
  L.push('', `作り方のスクリプト：\`e2e/v28-realtime-capture.mjs\`。私（作った者）は音を耳で聞けない。声についての数は、録音を台詞の音声ファイルと比べた相関と大きさによる。`, '');
  return L.join('\n');
}

function findingsOf(run, A) {
  const { env, log } = run;
  const F = [];
  const csp = [...(log?.csp ?? []), ...env.cspConsole];
  F.push(`CSP の違反 ${csp.length}・ページの誤り ${env.errors.length}・読めなかったファイル ${env.served404.length}${env.served404.length ? `（${env.served404.slice(0, 3).join(' ')}）` : ''}`);
  const starts = log.src.filter((e) => e.ev === 'start').map((e) => e.id);
  if (!PROBE) {
    for (const id of REPORT_IDS) {
      if (starts.includes(id)) continue;
      const cap = log.text.find((t) => t.kind === 'cap' && t.text === LINE[id].text);
      const dec = log.dec.find((d) => d.id === id);
      const req = env.voiceResp.find((r) => r.path.endsWith(`/${id}.mp3`));
      F.push(`**声が鳴らなかった**：${id}（字幕は${cap ? '出た' : '出ていない'}${cap && dec ? `。この音声ファイルのほどき（decodeAudioData）は字幕を書く ${r0(cap.t - dec.t0)} ms 前に始まり、字幕を書いた ${r0(dec.t - cap.t)} ms 後に終わった（ゲームは演出の字幕の声を、頼んでから 0.25 秒（音の時計）より遅れて鳴らせるようになったら流さない：audio/index.ts の CINE_VOICE_LATE_SEC）` : ''}${req ? `。ファイルの読み込みの返事は字幕の ${r0(cap ? cap.t - req.t : 0)} ms 前` : ''}）`);
    }
    const dup = starts.filter((x, i) => starts.indexOf(x) !== i);
    if (dup.length) F.push(`同じ台詞の声の音源を 2 度作った：${dup.join(',')}`);
    for (const vv of A.voice ?? []) {
      if (vv.error) F.push(`録音の中で「${vv.id}」を探せない（${vv.error}）`);
      else if (vv.corr < 0.6) F.push(`録音の中で「${vv.id}」の声が見つからない（相関 ${vv.corr}）`);
      else if (vv.playedSec < vv.voicedSec - 0.3 || vv.evidence.absent > 2) F.push(`録音の中で「${vv.id}」が最後まで鳴っていない／途切れた（鳴った ${vv.playedSec}／${vv.voicedSec} 秒・無い窓 ${vv.evidence.absent}）`);
    }
    const stopped = log.src.filter((e) => e.ev === 'stop').map((e) => e.id);
    if (stopped.length) F.push(`止めた声：${stopped.join(',')}`);
  }
  if (!PROBE && A.voiceWaitObserved) F.push(A.voiceWaits.length ? `演出の再生器が字幕の声を待って時計を止めた：${A.voiceWaits.map((w) => `${w.cine ?? '?'} ${w.ms ?? '終わらない'} ms（後の字幕「${w.capAfter ?? '—'}」）`).join('・')}` : '演出の再生器が字幕の声を待って時計を止めたことは無い（data-voice-wait="1" が一度も出ていない。声は字幕より先にほどけていた）');
  if (A.webm.audio?.gaps) F.push(`タブの音の取り込みの小さな時刻の跳び ${A.webm.audio.gaps} か所（音は続いている。${A.webm.audio.gapList.slice(0, 5).map((g) => `${(g.atMs / 1000).toFixed(1)} 秒に ${g.ms} ms`).join('・')}）`);
  return F;
}

// ================================================================ 実行

let run;
if (ANALYZE_ONLY) {
  const j = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
  run = { env: j.env, log: j.log };
} else {
  say(`record: DIST=${DIST} PORT=${PORT} ${QUERY} → ${WEBM}${PROBE ? '（PROBE）' : ''}`);
  run = await record();
  writeFileSync(JSON_OUT, JSON.stringify({ env: run.env, log: run.log }, null, 0));
}
let A = null;
if (run.log && existsSync(WEBM) && statSync(WEBM).size > 0) {
  A = await analyze(run);
  A.findings = findingsOf(run, A);
}
const result = {
  about: '実時間の録画（ページの中の getDisplayMedia＋MediaRecorder。画と音を同時に 1 回で録った。後から音を足していない）。この環境はソフトウェア描画で、コマは少なく町の時計は遅れる（滑らかさの証拠にしない）',
  dist: DIST,
  query: QUERY,
  label: LABEL,
  probe: PROBE,
  env: run.env,
  analysis: A,
  log: run.log,
};
writeFileSync(JSON_OUT, JSON.stringify(result, null, 1));
if (A && !PROBE) writeFileSync(join(OUT, 'README.md'), readme(run, A));
if (A) {
  say(`fps whole ${A.fps.whole?.fps} (p50 ${A.fps.whole?.intervalMs.p50} ms) · webm ${A.webm.durationSec} s, ${A.webm.video.frames} video frames, audio gaps ${A.webm.audio?.gaps}`);
  for (const s of A.fps.segments) say(`  ${s.name}: ${s.wallSec} s, ${s.frames} frames, ${s.fps} fps, p50 ${s.intervalMs.p50} ms, clock ratio ${s.gameClockPerRealSec}`);
  for (const c of A.captions ?? []) say(`  caption ${c.id ?? '-'} next-frame ${c.nextFrameStartMs} ms, video delay ${c.videoDelayMs} ms, voice ${JSON.stringify(c.voice ?? null)}`);
  for (const f of A.findings) say(`  finding: ${f}`);
}
if (run.env.fatal) {
  say(`NG: ${run.env.fatal.split('\n')[0]}`);
  process.exit(1);
}
say('done');
process.exit(0);
