// 台詞の音声（Version 28 V3。docs/v28-town-motion-voice.md §5.4・§9）を、本物の Chromium・本物の入力・タブの音の実時間の録音で確かめる。
//
// - 開発サーバーのページを、音を消さない Chromium（Playwright の既定の --mute-audio を外す・--autoplay-policy=no-user-gesture-required）で開き、
//   getDisplayMedia（今のタブ・音つき。--auto-accept-this-tab-capture）＋ MediaRecorder（webm・vp8＋opus）で、画面とゲーム自身の音を
//   実時間でそのまま録る（後から音を足さない）。画面の大きさは 1280×720（Playwright の viewport の見せかけでは取り込みの画の下が欠けるので、
//   本物の窓の大きさで：openGame）。
// - 入力は本物（クリック・タップ・キー・タブの切り替え）。開発用の口（window.__game・__audio）は様子を読むだけ。
// - ページの中で、字幕／会話の行を書いた時刻（textContent に書いた瞬間）・声の音源の start／stop／ended（AudioBufferSourceNode。音の時計と
//   getOutputTimestamp）・押した時刻・visibilitychange／blur／focus・20 ms ごとの声のバスとマスターの大きさ（AnalyserNode）を記録する。
// - 録音の時刻とページの時刻を合わせるため、録り始めと終わりに「合わせの音」（60 ms の 1→4 kHz のさえずり。確かめの側がページの
//   AudioContext から直に出す。ゲームの音ではない）と「合わせの印」（右端の 40 px の赤紫の四角を 300 ms。確かめの側の重ね。ゲームの画面ではない）を出す。
// - 録音の分析（別の Chromium で webm の opus をほどいて 16 kHz に。Node で 300 Hz の高域通過と FFT の相互相関）：台詞の音声ファイルを型にして、
//   録音の中の声の始まり（標本 1 つの細かさ）と、20 ms ごとの「声がある・無い」（型を引いた残りの大きさで決める：windowEvidence）から
//   鳴り終わりを見つけ、ページの記録の予定と比べる。重なり・止めた後の声・止めた／終わった後にまた聞こえる声（途中からでも）・予定に無い声を探す。
//   映像（同じ webm）：字幕／会話の文の所の画が替わったコマの時刻（requestVideoFrameCallback。記録だけ。取り込みのコマが少ないので判定に使わない）。
// - MUTATE=nostop：確かめの側で声を止める口を何もしない物に替えて走らせる（この e2e が止め忘れ・重なり・戻った後の続きを見つけられるかの確かめ。NG が出るのが正しい）。
// - ANALYZE_ONLY=1：録った物（<部>-log.json・<部>.webm）から分析だけをやり直す。
//
// 部（PARTS。カンマ区切り。既定は natural,skip,fast,menu,tab）：
//   natural  はじめから（本物のクリック）→ 冒頭の演出（通常の速さで最後まで。声の字幕 4 つ）→ 本物のキー（Shift＋W）で城門の前の忠勝まで
//            歩く → E で話す → Enter で行を送る（声の行 2 つは鳴り終えてから）→ 選択肢（本物のクリック）。6 台詞すべての始まりと終わり。
//   skip     冒頭の演出の 2 つ目の声（浅井の使者）の途中で、本物のクリックで「スキップ」→ すぐ止まり、後から鳴らない。
//   fast     タッチの端末（hasTouch）：演出の中で「次の場面 ▶」を 220 ms ごとに本物のタップ → 会話の行を 200 ms ごとに本物のタップ（300 ms より短い）。
//            重ならない・前の行の声を後から鳴らさない。
//   menu     声の行で本物の M（メニュー）→ 止まる・閉じても流し直さない → 次の声の行でアプリの切り替えをページの中で起こす
//            （document.hidden を上書きして visibilitychange。これだけを証拠にしない）→ 止まる・戻っても流し直さない。
//   tab      本物のタブの切り替え（同じ窓に別のタブを開いて前に出し、戻す）。取り込み中のタブは Chromium が「見えている」まま
//            （visibilitychange は来ず、本物の blur／focus が来る）なので、1 つ目の声の行は録りながら（blur の道筋）、
//            2 つ目の声の行は録るのを止めてから（本物の visibilitychange で hidden になる道筋。ページの中の記録で確かめる）。
//   render   natural の冒頭の演出（声の字幕 4 つ）だけを 3D の描画あり（?q=low）で（この環境の描画は 1 コマに数秒〜20 秒かかるので、
//            映像のコマは少なく、演出の時計も遅れる。会話まで含めると 1 時間を超えるので、会話は既定の部で確かめる）。既定では走らせない。
//
// 注意：
// - Playwright は各ページに「窓が前にある」ふり（Emulation.setFocusEmulationEnabled）をかけ、その間はタブを切り替えても見えたまま・blur も来ない。
//   tab の部では、Playwright 自身の接続でそのふりを外す（内部の口。使えなければ、その部は「確かめられない」と書く）。
// - この環境は描画がソフトウェアで遅い。既定の部は ?q=low&render=manual（3D を描かない。文字の層は毎コマ描く）。
//   映像は実時間の録画だが、3D は描いていない（render の部だけ描く。その映像は紙芝居のようになる：滑らかさの証拠にしない）。
// - 私（作った者）は音を耳で聞けない。確かめは録音の数の分析による。
//
// 使い方：(cd <worktree> && PORT=8791 npx vite --config proto3d/blender/tools/vite.nohmr.mjs &)
//   BASE3D=http://localhost:8791 node e2e/v28-voice-check.mjs <出力先>
//   出力：<部>.webm（録画）・<部>-log.json（ページの記録）・v28-voice-check.json（分析と判定）・v28-voice-check.md（短いまとめ）
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { outDir } from './lib.mjs';

const MANIFEST = JSON.parse(readFileSync(new URL('../proto3d/src/audio/voiceManifest.gen.json', import.meta.url), 'utf8'));
const LINES = MANIFEST.lines;
const LINE = Object.fromEntries(LINES.map((l) => [l.id, l]));
const VOICE_DIR = new URL('../proto3d/public/', import.meta.url);

const OUT = outDir(process.argv[2] || 'e2e-out/v28-voice-check');
const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8791';
const PARTS = (process.env.PARTS || 'natural,skip,fast,menu,tab').split(',').map((s) => s.trim()).filter(Boolean);
const QUERY = process.env.Q || '?q=low&render=manual';
/** 確かめの側でわざと壊す（nostop：声を止めない）。この e2e の確かめが空振りでないことを見るため。ふだんは空 */
const MUTATE = process.env.MUTATE || '';
const CONTAINER_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EXE = process.env.CHROMIUM_PATH || (existsSync(CONTAINER_CHROME) ? CONTAINER_CHROME : undefined);
const GL = EXE === CONTAINER_CHROME ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : [];
const VIEW = { width: 1280, height: 720 };
const POLL = { timeout: 600000, polling: 20 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? v : Math.round(v * 10) / 10);
const r3 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? v : Math.round(v * 1000) / 1000);

/** 判定の決まり（ミリ秒） */
const LIMIT = {
  /** 行が出てから声の音源を始めるまで（ページの中の時刻） */
  startMs: 150,
  /** 止める入力・知らせから、音源の stop の呼び出しまで（ページの中の時刻） */
  stopCallMs: 100,
  /** 止める入力・知らせから、録音の中で声が消えるまで（出力の時刻に直した値。出力の遅れ約 40 ms・絞り 12 ms・窓 20 ms を含む） */
  stopHeardMs: 150,
  /** 録音の中の声の始まりと、ページの予定（getOutputTimestamp）の差 */
  residualMs: 40,
  /** 2 つの声の重なり（録音の中。止める絞り 12 ms と窓 20 ms は許す） */
  overlapMs: 30,
};

let passed = 0;
let failed = 0;
const lines = [];
const note = (t) => {
  lines.push(t);
  console.log(t);
};
const check = (part, name, ok, extra = '') => {
  if (ok) passed++;
  else failed++;
  note(`${ok ? 'OK ' : 'NG '} [${part}] ${name}${extra ? '  ' + extra : ''}`);
  results.checks.push({ part, name, ok: !!ok, extra });
};
const results = { base: BASE, query: QUERY, view: VIEW, mutate: MUTATE || null, parts: {}, checks: [] };

// ================================================================ ページに差し込む記録（addInitScript）

/** durs：[id, 秒]（ほどいた音の長さから台詞を見分ける。6 つの長さはすべて違う） */
const INIT = (durs) => {
  const L = (window.__v3 = { src: [], text: [], input: [], pageEv: [], ticks: [], samples: [], tts: [], cap: null });
  const now = () => performance.now();
  // ---- speechSynthesis を読んだ・呼んだ回数（新しい声では 0 のはず）
  const ss = window.speechSynthesis;
  if (ss) {
    for (const k of ['speak', 'cancel', 'getVoices', 'pause', 'resume']) {
      const f = ss[k];
      if (typeof f !== 'function') continue;
      try {
        Object.defineProperty(ss, k, { configurable: true, value: (...a) => (L.tts.push(k), f.apply(ss, a)) });
      } catch {
        /* 替えられない */
      }
    }
  }
  try {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => (L.tts.push('get'), ss) });
  } catch {
    /* 替えられない */
  }
  // ---- 声の音源：decodeAudioData でほどいた音（ゲームでは台詞の音声ファイルだけ）を長さで見分ける
  const idOf = new WeakMap();
  const name = (b) => {
    if (!b) return null;
    for (const [id, sec] of durs) if (Math.abs(b.duration - sec) < 0.02) return id;
    return '?';
  };
  const B = BaseAudioContext.prototype;
  const dec = B.decodeAudioData;
  B.decodeAudioData = function (data, ok, bad) {
    const mark = (b) => (b && idOf.set(b, name(b)), b);
    const p = dec.call(this, data, ok && ((b) => ok(mark(b))), bad);
    return p && p.then ? p.then(mark) : p;
  };
  const ticks = new WeakSet();
  L.tickBufs = ticks;
  const out = (ctx) => {
    const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    return ts ? { c: ts.contextTime, p: ts.performanceTime } : null;
  };
  let nodes = 0;
  const P = AudioBufferSourceNode.prototype;
  const start = P.start;
  const stop = P.stop;
  P.start = function (when = 0, ...rest) {
    const ctx = this.context;
    const id = this.buffer ? (idOf.get(this.buffer) ?? null) : null;
    if (id) {
      this.__n = ++nodes;
      L.src.push({ ev: 'start', id, n: this.__n, dur: this.buffer.duration, when: when || ctx.currentTime, ct: ctx.currentTime, t: now(), out: out(ctx) });
      this.addEventListener('ended', () => L.src.push({ ev: 'ended', id, n: this.__n, ct: ctx.currentTime, t: now() }));
    }
    return start.call(this, when, ...rest);
  };
  P.stop = function (when = 0) {
    if (this.__n) {
      const ctx = this.context;
      L.src.push({ ev: 'stop', id: idOf.get(this.buffer) ?? null, n: this.__n, when: when || ctx.currentTime, ct: ctx.currentTime, t: now(), out: out(ctx) });
    }
    return stop.call(this, when);
  };
  // ---- 字幕（演出の .g-cine-cap .txt）・会話の行（.g-dialog .text）を書いた時刻（textContent に書いた瞬間。ゲームは同じ処理の続きで声を始める）。
  //      次のコマ（requestAnimationFrame）の時刻と、その次のコマの時刻（その行を描いたコマが出た後）も
  const seen = { cap: null, dlg: null };
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null;
  };
  const onText = (kind, text, el) => {
    if (text === seen[kind]) return;
    seen[kind] = text;
    const e = { kind, text, t: now(), rect: null, raf: null, rafNow: null, raf2: null };
    L.text.push(e);
    requestAnimationFrame((ft) => {
      e.raf = ft;
      e.rafNow = now();
      e.rect = box(kind === 'cap' ? el.parentElement : el);
      requestAnimationFrame((f2) => (e.raf2 = f2));
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
      if (cl.contains('txt') && par.contains('g-cine-cap')) onText('cap', String(v ?? ''), this);
      else if (cl.contains('text') && par.contains('g-dialog')) onText('dlg', String(v ?? ''), this);
    },
  });
  // ---- 入力・ページの知らせ
  window.addEventListener('keydown', (e) => L.input.push({ k: e.code, t: now(), ts: e.timeStamp, r: e.repeat }), true);
  window.addEventListener('pointerdown', (e) => L.input.push({ p: e.pointerType, x: Math.round(e.clientX), y: Math.round(e.clientY), t: now(), ts: e.timeStamp }), true);
  const pe = (e) => L.pageEv.push({ e, t: now(), vis: document.visibilityState, focus: document.hasFocus() });
  document.addEventListener('visibilitychange', () => pe('visibilitychange'));
  for (const k of ['blur', 'focus', 'pagehide', 'pageshow']) window.addEventListener(k, () => pe(k));
  // ---- 20 ms ごと：声のバス（自前の AnalyserNode）とマスター（ゲームの AnalyserNode。圧縮の後）の大きさ・鳴っている台詞・止めているか
  let an = null;
  let buf = null;
  const rms = (a, b) => {
    a.getFloatTimeDomainData(b);
    let s = 0;
    for (const v of b) s += v * v;
    return Math.sqrt(s / b.length);
  };
  setInterval(() => {
    const e = window.__audio?.sys?.engine;
    if (!e?.ctx) return;
    if (!an && e.voiceBus) {
      an = e.ctx.createAnalyser();
      an.fftSize = 512;
      e.voiceBus.connect(an);
      buf = new Float32Array(an.fftSize);
    }
    const vf = window.__audio.sys.voiceFiles;
    L.samples.push({ t: Math.round(now()), ct: r(e.ctx.currentTime), st: e.state, cs: e.ctx.state, vr: an ? r(rms(an, buf), 5) : null, mr: r(e.level().rms, 5), pl: vf?.playingId ?? null, pe: vf?.pendingId ?? null, du: e.isDucked });
  }, 20);
  const r = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
  // ---- タブの取り込み（getDisplayMedia：今のタブ・音つき）→ MediaRecorder。1 秒ごとのかたまりを Node へ（__v3save）
  const b64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  window.__v3capStart = async () => {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true, preferCurrentTab: true });
    const rec = new MediaRecorder(s, { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 1500000, audioBitsPerSecond: 128000 });
    const cap = (L.cap = { tracks: s.getTracks().map((t) => ({ kind: t.kind, label: t.label, settings: t.getSettings() })), startT: null, stopT: null, chunks: 0, bytes: 0 });
    let chain = Promise.resolve();
    rec.ondataavailable = (ev) => {
      if (!ev.data.size) return;
      chain = chain.then(async () => {
        const u8 = new Uint8Array(await ev.data.arrayBuffer());
        cap.chunks++;
        cap.bytes += u8.length;
        await window.__v3save(b64(u8));
      });
    };
    const started = new Promise((res) => (rec.onstart = () => ((cap.startT = now()), res())));
    rec.start(1000);
    await started;
    window.__v3rec = { s, rec, done: () => chain };
    return cap.tracks.map((t) => `${t.kind}:${t.label}`);
  };
  window.__v3capStop = async () => {
    const { s, rec, done } = window.__v3rec;
    await new Promise((res) => {
      rec.onstop = () => res();
      rec.stop();
    });
    L.cap.stopT = now();
    await done();
    s.getTracks().forEach((t) => t.stop());
    return L.cap;
  };
  // ---- 合わせの音（ゲームの AudioContext から直に出す 60 ms のさえずり）と合わせの印（右端の赤紫の四角を 300 ms）
  window.__v3tick = (tag) => {
    const ctx = window.__audio.sys.engine.ctx;
    const sr = ctx.sampleRate;
    const T = 0.06;
    const n = Math.round(T * sr);
    const b = ctx.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      d[i] = 0.3 * w * Math.sin(2 * Math.PI * (1000 * t + ((4000 - 1000) * t * t) / (2 * T)));
    }
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    const when = ctx.currentTime + 0.1;
    const o = out(ctx);
    s.start(when);
    const flash = document.createElement('div');
    flash.style.cssText = 'position:fixed;right:0;top:340px;width:40px;height:40px;background:#ff00ff;z-index:2147483647;pointer-events:none';
    const e = { tag, when, t: now(), out: o, flashT: now(), flashRaf: null, flashRect: [VIEW_W - 40, 340, 40, 40] };
    document.documentElement.appendChild(flash);
    requestAnimationFrame((ft) => (e.flashRaf = ft));
    setTimeout(() => flash.remove(), 300);
    L.ticks.push(e);
    return e;
  };
  const VIEW_W = window.innerWidth;
};

// ================================================================ ブラウザ・ページ

/** Playwright 自身の接続（窓が前にあるふりを外すため。内部の口：無ければ null） */
function pwSession(page) {
  try {
    return page._connection.toImpl(page).delegate._mainFrameSession._client ?? null;
  } catch {
    return null;
  }
}

async function openGame(part, { touch = false, query = QUERY, record = true } = {}) {
  const udd = mkdtempSync(join(OUT, '.udd-'));
  // 窓の大きさは本物の大きさで（Playwright の画面の大きさの見せかけ（viewport）は取り込みの画には効かず、下が欠ける）：
  // headless の窓は上に隠れた道具の帯（139 px）があり、取り込みの間は「共有中」の帯（53 px）も出るので 1280×912 にし、
  // 画面（screen）を 1920×1080 にする → 録画中のページの中は 1280×720・録画も 1280×720（録り始めの数コマだけ 1280×772）
  const ctx = await chromium.launchPersistentContext(udd, {
    executablePath: EXE,
    headless: true,
    viewport: null,
    hasTouch: touch,
    args: [...GL, '--auto-accept-this-tab-capture', '--autoplay-policy=no-user-gesture-required', `--window-size=${VIEW.width},${VIEW.height + 192}`, '--screen-info={1920x1080}'],
    ignoreDefaultArgs: ['--mute-audio'],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.setDefaultTimeout(600000);
  const errors = [];
  const voiceReq = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/voice/')) voiceReq.push(u.pathname);
  });
  const webm = join(OUT, `${part}.webm`);
  rmSync(webm, { force: true });
  if (record) await page.exposeFunction('__v3save', (b) => (appendFileSync(webm, Buffer.from(b, 'base64')), true));
  await ctx.route(`${BASE}/__v3_other.html`, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>別のタブ</title><p>別のタブ（確かめ用）</p>' }));
  await page.addInitScript(INIT, LINES.map((l) => [l.id, l.sec]));
  const t0 = Date.now();
  await page.goto(BASE + '/' + query);
  await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && window.__audio && document.getElementById('loading')?.hidden !== false, null, { timeout: 600000, polling: 200 });
  const env = { part, ctx, page, udd, webm: record ? webm : null, errors, voiceReq, touch, loadSec: (Date.now() - t0) / 1000, other: null, marks: [] };
  openEnvs.add(env);
  if (MUTATE === 'nostop') {
    // 確かめの側でわざと壊す（この e2e が止め忘れ・重なり・戻った後の続きを見つけられるかの確かめ）：声を止める口を何もしない物に替える
    await page.evaluate(() => {
      window.__audio.sys.voiceFiles.stop = () => {};
    });
    note('   （MUTATE=nostop：声を止める口を確かめの側で何もしない物に替えた。NG が出るのが正しい）');
  }

  return env;
}

/** 開いているブラウザ（途中で失敗したときも閉じて、作った作業用の利用者フォルダを消す） */
const openEnvs = new Set();
async function closeGame(env) {
  openEnvs.delete(env);
  await env.ctx.close().catch(() => {});
  rmSync(env.udd, { recursive: true, force: true });
}

const nowIn = (page) => page.evaluate(() => performance.now());
const mark = async (env, what) => env.marks.push({ what, t: await nowIn(env.page) });
const ui = (page) => page.evaluate(() => window.__game.ui);
const playing = (page) => page.evaluate(() => window.__audio.sys.voiceFiles.playingId);
/**
 * その台詞の声の音源が始まるまで待つ（ページの記録の start で見る。3D を描くとこの環境は 1 コマに数秒かかり、その間に声が鳴り終わると
 * 「鳴っている」様子を一度も読めないことがあるため）
 */
const waitPlaying = (page, id) => page.waitForFunction((id) => window.__v3.src.some((e) => e.ev === 'start' && e.id === id), id, { ...POLL, timeout: 240000 });
const waitNotPlaying = (page) => page.waitForFunction(() => window.__audio.sys.voiceFiles.playingId === null && window.__audio.sys.voiceFiles.pendingId === null, null, POLL);
const center = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

/**
 * 続けての本物のタップ（Input.dispatchTouchEvent。Playwright の touchscreen.tap と同じ口）を、gap ms ごとの決まった時刻に送る
 * （1 つずつ返事を待つと、この混んだ環境では 1 回に 100〜250 ms かかり、間が 300 ms を超える）
 */
async function rapidTaps(env, x, y, n, gap) {
  const cdp = env.cdp ?? (env.cdp = await env.ctx.newCDPSession(env.page));
  const sent = [];
  const t0 = Date.now() + 20;
  for (let i = 0; i < n; i++) {
    const wait = t0 + i * gap - Date.now();
    if (wait > 0) await sleep(wait);
    sent.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }));
    sent.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }));
  }
  await Promise.all(sent);
}

/** 本物の押し（タッチの端末ならタップ、でなければクリック） */
async function press(env, x, y) {
  if (env.touch) await env.page.touchscreen.tap(x, y);
  else await env.page.mouse.click(x, y);
}

/** タイトルで、何も無い所を本物の押しで押して音を有効にし（タイトルには曲が無い）、録り始めて、合わせの音と印を出す */
async function startRecording(env) {
  const { page } = env;
  await sleep(500);
  await press(env, 640, 60);
  await page.waitForFunction(() => window.__audio.sys.engine.state === 'running', null, POLL);
  if (env.webm) env.tracks = await page.evaluate(() => window.__v3capStart());
  await sleep(700);
  // 取り込みの間は「このタブを共有中」の帯（53 px）が出るので、窓は 1280×912（道具の帯 139 px＋共有中の帯 53 px＋1280×720）
  env.inner = await page.evaluate(() => [innerWidth, innerHeight]);
  if (env.inner[0] !== VIEW.width || env.inner[1] !== VIEW.height) note(`   注意：録画中のページの中の大きさ ${env.inner.join('×')}（${VIEW.width}×${VIEW.height} のつもり）`);
  await page.evaluate(() => window.__v3tick('start'));
  await sleep(700);
}

async function stopRecording(env) {
  const { page } = env;
  await page.evaluate(() => window.__v3tick('end'));
  await sleep(900);
  if (env.webm) env.cap = await page.evaluate(() => window.__v3capStop());
}

async function pageLog(env) {
  return await env.page.evaluate(() => {
    const L = window.__v3;
    return { src: L.src, text: L.text, input: L.input, pageEv: L.pageEv, ticks: L.ticks, samples: L.samples, tts: L.tts, cap: L.cap, vlog: window.__audio.sys.voiceFiles.log.slice(), stats: { ...window.__audio.sys.voiceFiles.stats }, timeOrigin: performance.timeOrigin };
  });
}

/** 「はじめから」（本物の押し） */
async function newGame(env) {
  const btn = env.page.locator('button[data-id="new:ieyasu1570"]');
  await btn.waitFor({ state: 'visible' });
  const c = await center(btn);
  await press(env, c.x, c.y);
  await env.page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'attached' });
  await mark(env, 'はじめから');
}

/** 探索に入ったら、本物のキー（Shift＋W：走る）で城門の前の忠勝の「話す」が出るまで北へ。出たら E（タッチなら「話す」をタップ） */
async function walkAndTalk(env) {
  const { page } = env;
  await page.waitForFunction(() => window.__game.screen === 'explore' && !window.__game.ui, null, POLL);
  await sleep(600);
  await mark(env, '歩き始め');
  const shown = () => page.evaluate(() => {
    const b = document.querySelector('.g-talk');
    return !!b && !b.hidden && b.dataset.target === 'tadakatsu';
  });
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  let ok = false;
  for (let i = 0; i < 1500 && !ok; i++) {
    ok = await shown();
    if (!ok) await sleep(80);
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  if (!ok) throw new Error('忠勝の「話す」が出ない');
  await sleep(500);
  await mark(env, '話す');
  if (env.touch) {
    const c = await center(page.locator('.g-talk'));
    await press(env, c.x, c.y);
  } else await page.keyboard.press('KeyE');
  await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, POLL);
}

/** 会話を、本物の Enter（タッチならタップ）で text の行まで送る（gap ms ずつ） */
async function advanceTo(env, text, gap = 700) {
  for (let i = 0; i < 12; i++) {
    const u = await ui(env.page);
    if (u?.line?.text === text) return;
    await sleep(gap);
    await advanceOne(env, u?.index ?? -1);
  }
  throw new Error(`行「${text}」まで送れない`);
}
/** 1 行送って、その行が出るまで待つ（3D を描くとこの環境は 1 コマ数秒で、待たずに次を押すと 2 行進む） */
async function advanceOne(env, from) {
  await advance(env);
  await env.page.waitForFunction((from) => (window.__game.ui?.index ?? -2) !== from || !!window.__game.ui?.choices?.length, from, POLL);
}
async function advance(env) {
  if (env.touch) {
    const c = env.dlgCenter ?? (env.dlgCenter = await center(env.page.locator('.g-layer[data-kind="script"] .text')));
    await env.page.touchscreen.tap(c.x, c.y);
  } else await env.page.keyboard.press('Enter');
}

/** 会話を最後まで送り、選択肢「もう少し話を聞いて回る」を本物の押しで選ぶ（軍議へは進まない） */
async function finishTalk(env, gap = 700) {
  const { page } = env;
  for (let i = 0; i < 10; i++) {
    const u = await ui(page);
    if (u?.choices?.length) break;
    await sleep(gap);
    await advanceOne(env, u?.index ?? -1);
  }
  await page.locator('.g-choice[data-id="not_yet"]').waitFor({ state: 'visible' });
  await sleep(600);
  const c = await center(page.locator('.g-choice[data-id="not_yet"]'));
  await press(env, c.x, c.y);
  await page.waitForFunction(() => !window.__game.ui, null, POLL);
  await mark(env, '会話を閉じた');
}

/** 本物のタブの切り替え：同じ窓の別のタブを前に出し、ms 待って戻す。返り：前に出した時刻・戻した時刻（ページの時刻） */
async function tabAway(env, ms) {
  if (!env.other) {
    env.other = await env.ctx.newPage();
    await env.other.goto(`${BASE}/__v3_other.html`);
    await env.page.bringToFront();
    await sleep(800);
  }
  const a = await nowIn(env.page);
  await env.other.bringToFront();
  await sleep(ms);
  const b = await nowIn(env.page);
  await env.page.bringToFront();
  return { away: a, back: b };
}

// ================================================================ 部

/** 部ごとの見込み：full＝最後まで鳴る台詞・cut＝止める台詞と止める理由（入力・知らせ）・skipped＝鳴らない台詞 */
const ALL6 = ['ch1.oda_envoy.ask', 'ch1.asai_envoy.ask', 'ch1.tadakatsu.council', 'ch1.hero.gather', 'talk.tadakatsu.envoys', 'talk.hero.same_day'];
const EXPECT = {
  natural: { full: ALL6 },
  render: { full: ['ch1.oda_envoy.ask', 'ch1.asai_envoy.ask', 'ch1.tadakatsu.council', 'ch1.hero.gather'] },
  skip: { full: ['ch1.oda_envoy.ask'], cut: [{ id: 'ch1.asai_envoy.ask', by: 'pointer' }], skipped: ['ch1.tadakatsu.council', 'ch1.hero.gather'] },
  fast: { cut: [{ id: 'ch1.oda_envoy.ask', by: 'pointer' }, { id: 'ch1.tadakatsu.council', by: 'pointer' }, { id: 'talk.tadakatsu.envoys', by: 'pointer' }, { id: 'talk.hero.same_day', by: 'pointer' }], skipped: ['ch1.asai_envoy.ask', 'ch1.hero.gather'] },
  menu: { cut: [{ id: 'talk.tadakatsu.envoys', by: 'KeyM' }, { id: 'talk.hero.same_day', by: 'synthetic-hidden' }] },
  tab: { cut: [{ id: 'talk.tadakatsu.envoys', by: 'blur' }, { id: 'talk.hero.same_day', by: 'hidden', unrecorded: true }] },
};

async function partNatural(part = 'natural', query = QUERY, { talk = true } = {}) {
  note(`== ${part}：はじめから → 冒頭の演出（通常の速さ）${talk ? ' → 歩いて忠勝 → 会話（声の行は鳴り終えてから送る）' : 'だけ'}${query.includes('render=manual') ? '' : '（3D の描画あり）'}`);
  const env = await openGame(part, { query });
  await startRecording(env);
  await newGame(env);
  await env.page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached', timeout: 1800000 });
  await mark(env, '演出の終わり');
  if (!talk) {
    // 3D を描くと、この混んだ環境では 1 コマに 5〜20 秒かかり、会話まで含めると 1 時間を超えるので、冒頭の演出だけ（会話は既定の部で）
    await sleep(1500);
    await stopRecording(env);
    const log = await pageLog(env);
    await closeGame(env);
    return { env, log };
  }
  await walkAndTalk(env);
  await advanceTo(env, LINE['talk.tadakatsu.envoys'].text, 1200);
  await waitPlaying(env.page, 'talk.tadakatsu.envoys');
  await waitNotPlaying(env.page);
  await sleep(800);
  await advanceOne(env, (await ui(env.page)).index);
  await waitPlaying(env.page, 'talk.hero.same_day');
  await waitNotPlaying(env.page);
  await sleep(800);
  await finishTalk(env, 1000);
  await sleep(1200);
  await stopRecording(env);
  const log = await pageLog(env);
  await closeGame(env);
  return { env, log };
}

async function partSkip() {
  const part = 'skip';
  note(`== ${part}：冒頭の演出の 2 つ目の声（浅井の使者）の途中で、本物のクリックで「スキップ」`);
  const env = await openGame(part);
  await startRecording(env);
  await newGame(env);
  await waitPlaying(env.page, 'ch1.asai_envoy.ask');
  await sleep(1000);
  const c = await center(env.page.locator('.g-cine-btn[data-id="skip"]'));
  await mark(env, 'スキップを押す直前');
  await press(env, c.x, c.y);
  await env.page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached' });
  await sleep(5000);
  await mark(env, 'スキップの後 5 秒');
  await stopRecording(env);
  const log = await pageLog(env);
  await closeGame(env);
  return { env, log };
}

async function partFast() {
  const part = 'fast';
  note(`== ${part}：タッチの端末。演出の「次の場面 ▶」を 220 ms ごとに本物のタップ → 会話の行を 200 ms ごとに本物のタップ`);
  const env = await openGame(part, { touch: true });
  await startRecording(env);
  await newGame(env);
  const { page } = env;
  await waitPlaying(page, 'ch1.oda_envoy.ask');
  await sleep(400);
  const nx = await center(page.locator('.g-cine-btn[data-id="next"]'));
  await mark(env, '次の場面のタップ（2 回・220 ms ごと）');
  await rapidTaps(env, nx.x, nx.y, 2, 220);
  await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached' });
  await sleep(3000);
  await walkAndTalk(env);
  // 会話：地の文 → 殿、お待ちしておりました → 声の行（忠勝）→ 声の行（家康）→ はい。… を 200 ms ごとに
  await sleep(900);
  const dlg = await center(page.locator('.g-layer[data-kind="script"] .text'));
  env.dlgCenter = dlg;
  await mark(env, '会話の行のタップ（4 回・200 ms ごと）');
  await rapidTaps(env, dlg.x, dlg.y, 4, 200);
  await sleep(3500);
  await mark(env, '速く送った後 3.5 秒');
  await finishTalk(env, 700);
  await sleep(800);
  await stopRecording(env);
  const log = await pageLog(env);
  await closeGame(env);
  return { env, log };
}

async function partMenu() {
  const part = 'menu';
  note(`== ${part}：声の行で本物の M（メニュー）→ 閉じる → 次の声の行でページの中の visibilitychange（hidden）→ 戻す`);
  const env = await openGame(part);
  await startRecording(env);
  await newGame(env);
  const { page } = env;
  await sleep(800);
  await page.keyboard.press('Escape');
  await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached' });
  await walkAndTalk(env);
  await advanceTo(env, LINE['talk.tadakatsu.envoys'].text, 700);
  await waitPlaying(page, 'talk.tadakatsu.envoys');
  await sleep(1000);
  await mark(env, 'M（メニュー）');
  await page.keyboard.press('KeyM');
  await page.locator('.g-layer[data-kind="menu"]').waitFor({ state: 'attached' });
  await sleep(2000);
  await page.keyboard.press('Escape');
  await page.locator('.g-layer[data-kind="menu"]').waitFor({ state: 'detached' });
  await mark(env, 'メニューを閉じた');
  await sleep(2500);
  await advance(env);
  await waitPlaying(page, 'talk.hero.same_day');
  await sleep(600);
  const setVis = (v) =>
    page.evaluate((v) => {
      Object.defineProperty(document, 'visibilityState', { get: () => v, configurable: true });
      Object.defineProperty(document, 'hidden', { get: () => v === 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, v);
  await mark(env, 'ページの中の hidden');
  await setVis('hidden');
  await sleep(1500);
  await setVis('visible');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await mark(env, 'ページの中の visible');
  await sleep(2500);
  await finishTalk(env, 700);
  await sleep(800);
  await stopRecording(env);
  const log = await pageLog(env);
  await closeGame(env);
  return { env, log };
}

async function partTab() {
  const part = 'tab';
  note(`== ${part}：本物のタブの切り替え（1 つ目の声の行は録りながら：blur の道筋。2 つ目は録るのを止めてから：visibilitychange hidden の道筋）`);
  const env = await openGame(part);
  const { page } = env;
  const s = pwSession(page);
  if (!s) {
    check(part, '本物のタブの切り替え（Playwright の「窓が前にあるふり」を外せない）', false, 'Playwright の内部の口が無い');
    await closeGame(env);
    return null;
  }
  await s.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await page.bringToFront();
  await sleep(500);
  env.focusAfterOff = await page.evaluate(() => ({ vis: document.visibilityState, focus: document.hasFocus() }));
  await startRecording(env);
  await newGame(env);
  await sleep(800);
  await page.keyboard.press('Escape');
  await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached' });
  await walkAndTalk(env);
  // 別のタブを先に開いておく（開く処理を、声の行の時刻に入れない）
  env.other = await env.ctx.newPage();
  await env.other.goto(`${BASE}/__v3_other.html`);
  await page.bringToFront();
  await sleep(1000);
  await advanceTo(env, LINE['talk.tadakatsu.envoys'].text, 700);
  await waitPlaying(page, 'talk.tadakatsu.envoys');
  await sleep(1000);
  await mark(env, '本物のタブの切り替え（録画中）');
  env.switch1 = await tabAway(env, 2000);
  await mark(env, 'タブを戻した（録画中）');
  await sleep(2500);
  await stopRecording(env);
  // 録るのを止めた（取り込みが外れた）：本物のタブの切り替えで hidden になるか
  await sleep(800);
  await advance(env);
  await waitPlaying(page, 'talk.hero.same_day');
  await sleep(600);
  await mark(env, '本物のタブの切り替え（録画なし）');
  env.switch2 = await tabAway(env, 2000);
  await mark(env, 'タブを戻した（録画なし）');
  await sleep(2500);
  await finishTalk(env, 700);
  const log = await pageLog(env);
  await closeGame(env);
  return { env, log };
}

// ================================================================ 録音・録画の分析

const SR = 16000;

/** 分析用のブラウザ（音は出さない）：webm の音を 16 kHz の 1 チャンネルに、台詞の音声ファイルも 16 kHz に。映像の字幕の所の画の替わり */
async function decodeAll(items) {
  // 前にほどいた物（<部>-a16k.f32・<部>-video.json・tpl16k-<id>.f32）があれば、分析のやり直し（ANALYZE_ONLY）ではそれを使う
  const f32 = (f) => {
    const b = readFileSync(f);
    return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  };
  const cached = ANALYZE_ONLY && LINES.every((l) => existsSync(join(OUT, `tpl16k-${l.id}.f32`))) && items.every((it) => existsSync(join(OUT, `${it.part}-a16k.f32`)) && existsSync(join(OUT, `${it.part}-video.json`)));
  if (cached) {
    const templates = Object.fromEntries(LINES.map((l) => [l.id, f32(join(OUT, `tpl16k-${l.id}.f32`))]));
    const out = Object.fromEntries(items.map((it) => [it.part, { audio: f32(join(OUT, `${it.part}-a16k.f32`)), video: JSON.parse(readFileSync(join(OUT, `${it.part}-video.json`), 'utf8')) }]));
    return { templates, out };
  }
  const browser = await chromium.launch({ executablePath: EXE, args: [...GL, '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(900000);
  const files = new Map();
  await page.route('http://v3.local/**', (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === '/') return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>v3</title>' });
    const f = files.get(u.pathname);
    if (!f) return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ status: 200, contentType: f.type, body: readFileSync(f.path) });
  });
  await page.goto('http://v3.local/');
  const pcm = async (path, type) => {
    const key = `/f${files.size}`;
    files.set(key, { path, type });
    const b64 = await page.evaluate(
      async ({ key, SR }) => {
        const bytes = await (await fetch(key)).arrayBuffer();
        const ab = await new OfflineAudioContext(1, 1, SR).decodeAudioData(bytes);
        const n = ab.length;
        const m = new Float32Array(n);
        for (let c = 0; c < ab.numberOfChannels; c++) {
          const d = ab.getChannelData(c);
          for (let i = 0; i < n; i++) m[i] += d[i] / ab.numberOfChannels;
        }
        const u8 = new Uint8Array(m.buffer);
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return btoa(s);
      },
      { key, SR },
    );
    const b = Buffer.from(b64, 'base64');
    return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  };
  const templates = {};
  for (const l of LINES) templates[l.id] = await pcm(new URL(l.file, VOICE_DIR).pathname, 'audio/mpeg');
  const out = {};
  for (const it of items) {
    const audio = await pcm(it.webm, 'video/webm');
    // 映像：コマごとに、字幕の帯・会話の文の所・合わせの印の所の画（縮めた明るさ）が前のコマからどれだけ替わったか
    const key = `/v${files.size}`;
    files.set(key, { path: it.webm, type: 'video/webm' });
    const video = await page.evaluate(
      async ({ key, regions }) => {
        const blob = await (await fetch(key)).blob();
        const v = document.createElement('video');
        v.muted = true;
        v.src = URL.createObjectURL(blob);
        document.body.appendChild(v);
        await new Promise((r) => (v.onloadedmetadata = r));
        const W = v.videoWidth;
        const H = v.videoHeight;
        const cv = new OffscreenCanvas(W, H);
        const g = cv.getContext('2d', { willReadFrequently: true });
        const frames = [];
        const sig = (r) => {
          const [x, y, w, h] = r.map((q) => Math.max(0, Math.round(q)));
          if (w < 2 || h < 2 || x + w > W || y + h > H) return null;
          const d = g.getImageData(x, y, w, h).data;
          const gx = 96;
          const gy = 8;
          const s = new Float32Array(gx * gy);
          const cnt = new Float32Array(gx * gy);
          for (let yy = 0; yy < h; yy++)
            for (let xx = 0; xx < w; xx++) {
              const i = (yy * w + xx) * 4;
              const k = Math.min(gy - 1, Math.floor((yy * gy) / h)) * gx + Math.min(gx - 1, Math.floor((xx * gx) / w));
              s[k] += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
              cnt[k]++;
            }
          for (let k = 0; k < s.length; k++) s[k] /= cnt[k] || 1;
          return s;
        };
        await new Promise((done) => {
          const cb = (_, meta) => {
            g.drawImage(v, 0, 0);
            const f = { m: meta.mediaTime, h: v.videoHeight };
            for (const name of ['cap', 'dlg']) {
              const r = regions[name];
              if (!r) continue;
              const s = sig(r);
              if (!s) continue;
              // 縮めた明るさ（0〜255 の整数）を base64 で
              const u8 = Uint8Array.from(s, (q) => Math.max(0, Math.min(255, Math.round(q))));
              f[name] = btoa(String.fromCharCode.apply(null, u8));
            }
            const fr = regions.flash;
            if (fr) {
              const d = g.getImageData(fr[0] + 8, fr[1] + 8, 24, 24).data;
              let rr = 0;
              let gg = 0;
              let bb = 0;
              for (let i = 0; i < d.length; i += 4) {
                rr += d[i];
                gg += d[i + 1];
                bb += d[i + 2];
              }
              const n = d.length / 4;
              f.mag = Math.round((rr / n + bb / n) / 2 - gg / n);
            }
            frames.push(f);
            if (!v.ended) v.requestVideoFrameCallback(cb);
          };
          v.requestVideoFrameCallback(cb);
          v.onended = () => setTimeout(done, 300);
          void v.play();
        });
        return { w: W, h: H, duration: v.duration, frames };
      },
      { key, regions: it.regions },
    );
    out[it.part] = { audio, video };
    writeFileSync(join(OUT, `${it.part}-a16k.f32`), Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength));
    writeFileSync(join(OUT, `${it.part}-video.json`), JSON.stringify(video));
  }
  for (const l of LINES) writeFileSync(join(OUT, `tpl16k-${l.id}.f32`), Buffer.from(templates[l.id].buffer, templates[l.id].byteOffset, templates[l.id].byteLength));
  await browser.close();
  return { templates, out };
}

// ---- FFT（基数 2）と正規化した相互相関
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

/** 録音 x の中の型 p の正規化した相互相関（-1〜1。添字 k は p の頭が x[k] に来る位置） */
function makeNcc(x) {
  let L = 1;
  while (L < x.length * 2) L <<= 1;
  const xr = new Float64Array(L);
  const xi = new Float64Array(L);
  xr.set(x);
  fft(xr, xi, false);
  const cum = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) cum[i + 1] = cum[i] + x[i] * x[i];
  return (p) => {
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
    const n = x.length - p.length;
    const out = new Float32Array(Math.max(0, n));
    for (let k = 0; k < n; k++) {
      const e = cum[k + p.length] - cum[k];
      out[k] = e > 1e-9 ? pr[k] / Math.sqrt(pe * e) : 0;
    }
    return out;
  };
}

/** 相関の山（th 以上・前後 sep 個の中でいちばん大きい所） */
function peaks(c, th, sep) {
  const out = [];
  for (let k = 0; k < c.length; k++) {
    if (c[k] < th) continue;
    let best = k;
    const end = Math.min(c.length, k + sep);
    for (let j = k; j < end; j++) if (c[j] > c[best]) best = j;
    let ok = true;
    for (let j = Math.max(0, best - sep); j < best; j++) if (c[j] > c[best]) ok = false;
    if (ok) out.push({ k: best, v: c[best] });
    k = best + sep;
  }
  return out;
}

/** 合わせの音（ページで出したのと同じさえずり）を 16 kHz で */
function chirp() {
  const T = 0.06;
  const n = Math.round(T * SR);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    d[i] = w * Math.sin(2 * Math.PI * (1000 * t + ((4000 - 1000) * t * t) / (2 * T)));
  }
  return d;
}

const WIN = 320; // 20 ms
/** 声の窓とみなす型の大きさ（型のいちばん大きい窓から -18 dB 以内）と、相関が「合った」とみなす値（数えるだけ。判定は大きさで：windowEvidence） */
const VOICED_DB = -18;
const HIT_CORR = 0.4;

/** 2 次の高域通過（300 Hz。RBJ の式）：声の高さの低い倍音と曲の低音を除き、言葉の形（ホルマント）で合わせる */
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

/** 型の 20 ms ごとの大きさ（声の窓の印） */
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

/**
 * 型 T の頭を録音の k0 に置いたときの 20 ms ごとの相関（声の窓だけ。ほかは null）。
 * タブの音の取り込みは時計を合わせるため伸び縮みし、混んでいると録音の時刻が十数 ms 跳ぶこともある（3D を描く部で、句の間の後に 14 ms）。
 * そこで窓ごとに前の窓のずれの ±48 標本の中でいちばん良い所を取り、よく合った窓（0.6 以上）でずれを追う。合わなくなったら（0.5 未満）、
 * その窓から 3 つの窓（60 ms）をまとめて ±400 標本（25 ms）で探し直し、まとめて 0.7 以上合えばそのずれに乗り換える（全体で ±60 ms まで）。
 * 探す幅が広いと曲だけの窓でも偶然の相関が上がるが、「ある」は大きさで決める（windowEvidence：偶然の相関では 0.71 以上が要る）
 */
function windowCorr(x, T, k0, ws = windowsOf(T)) {
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

/**
 * 窓ごとの「声がある・無い・決められない」（相関は大きさを見ないので、曲だけの窓でも偶然 0.5〜0.6 になる。大きさで確かめる）：
 * この台詞の声の大きさ g（よく合った窓（相関 0.8 以上、無ければ 0.6 以上）での最小二乗）で型を引いた残り E(R−gT) が、
 * 録音の窓の大きさ E(R) の半分以下（3 dB 以上説明できる）なら「ある」（偶然の相関では 0.71 以上が要る）。
 * 引くとかえって大きくなり（E(R−gT) ≥ E(R)）、声の大きさ E(gT) が録音の窓の半分以上なら「無い」（声があれば聞こえるはずの大きさなのに合わない）。
 * ほか（声が曲より小さい窓）は決めない。返り：'p'（ある）・'a'（無い）・'i'（決めない）・null（声の窓でない）の並びと g
 */
function windowEvidence(x, T, k0, wc, gFallback = 0) {
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
  const g = den > 0 ? num / den : gFallback;
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

/**
 * 鳴り終わりの窓：声の窓の並び（決められない窓は除く）を「ここまで鳴った・ここから鳴っていない」に分ける所のうち、
 * 「無い」窓（前）と「ある」窓（後）の数の和がいちばん少ない所。返りは鳴った最後の「ある」窓の番号（-1：鳴っていない）
 */
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

/** 型の声の始まり（5 ms ごとの大きさが最大から -30 dB を超えた所。秒）と、声の窓の最後の終わり（秒） */
function speechSpan(T) {
  const H = 80;
  const es = [];
  for (let i = 0; i + H <= T.length; i += H) {
    let e = 0;
    for (let j = i; j < i + H; j++) e += T[j] * T[j];
    es.push(e);
  }
  const pk = Math.max(...es);
  const first = es.findIndex((e) => e >= pk * 1e-3);
  const ws = windowsOf(T);
  let last = ws.length - 1;
  while (last > 0 && !ws[last].voiced) last--;
  return { first: (first * H) / SR, last: ((last + 1) * WIN) / SR };
}

/**
 * 1 つの部の分析：合わせの音で録音の時刻をページの時刻（出力の時刻：getOutputTimestamp）に直し、ページの記録の声の音源ごとに、
 * 録音の中の始まり（標本 1 つの細かさで型に合わせる）・鳴り終わり（20 ms ごとの相関）を確かめる。
 * 型（音声ファイル）の頭 0.5 秒・0.25 秒で録音全体を探し、予定に無い声（遅れて鳴った・2 度鳴った）を探す。
 */
function analyzePart(name, log, dec, templates0, recordedUntil) {
  const x = highpass(dec.audio);
  const templates = Object.fromEntries(Object.entries(templates0).map(([k, v]) => [k, highpass(v)]));
  const ncc = makeNcc(x);
  const a = { recSec: r3(x.length / SR), ticks: [], plays: [], unexpected: [], overlaps: [], visual: [] };
  // ---- 合わせの音
  const tc = ncc(highpass(chirp()));
  const tp = peaks(tc, 0.5, Math.round(0.5 * SR)).sort((p, q) => q.v - p.v).slice(0, 2).sort((p, q) => p.k - q.k);
  const ticks = log.ticks.filter((t) => t.tag === 'start' || t.tag === 'end');
  const offs = [];
  // 目印（録音の時刻と、ページの時刻（出力の時刻）の差）：合わせの音 2 つ・声（下で足す）
  const anchors = [];
  ticks.forEach((t, i) => {
    const pk = tp[i];
    const expected = t.out.p + (t.when - t.out.c) * 1000;
    if (pk) {
      offs.push(expected - (pk.k / SR) * 1000);
      anchors.push({ what: `tick:${t.tag}`, rec: pk.k / SR, off: expected - (pk.k / SR) * 1000 });
    }
    a.ticks.push({ tag: t.tag, recSec: pk ? r3(pk.k / SR) : null, ncc: pk ? r3(pk.v) : null, pageOutMs: r1(expected) });
  });
  if (!offs.length) {
    a.error = '合わせの音が録音に見つからない';
    return a;
  }
  a.offsetMs = r1(offs[0]);
  a.driftMs = offs.length > 1 ? r1(offs[1] - offs[0]) : null;
  // 録音の時刻 → ページの時刻（始めの合わせの音で）。混んだ環境では、タブの音の取り込みが途中で数十〜数百 ms 跳ぶことがある
  // （始めと終わりの合わせの音の差で分かる）。声ごとの時刻は、その声に合う目印（下の measure）で直す
  const toPage = (sec, off = offs[0]) => sec * 1000 + off;
  const toRec = (ms, off = offs[0]) => (ms - off) / 1000;
  // ---- ページの記録の声の音源（start と、その後の stop／ended）
  const starts = log.src.filter((e) => e.ev === 'start');
  for (const s of starts) {
    const T = templates[s.id];
    const span = speechSpan(T);
    const ws = windowsOf(T);
    const stopE = log.src.find((e) => e.n === s.n && e.ev === 'stop');
    const endE = log.src.find((e) => e.n === s.n && e.ev === 'ended');
    const outMs = s.out ? s.out.p + (s.when - s.out.c) * 1000 : null;
    const p = { id: s.id, n: s.n, startCallMs: r1(s.t), plannedOutMs: r1(outMs), stopCallMs: stopE ? r1(stopE.t) : null, endedMs: endE ? r1(endE.t) : null };
    // 録るのを止めた後の音源（tab の 2 つ目の行）：ページの記録だけ
    if (recordedUntil && s.t > recordedUntil) p.unrecorded = true;
    // 行が出た時刻：同じ文の字幕・会話の行を DOM に書いた最後の時刻（start より前）
    const txt = LINE[s.id].text;
    const shown = log.text.filter((e) => e.text === txt && e.t <= s.t + 1).at(-1);
    p.lineShownMs = shown ? r1(shown.t) : null;
    p.lineToStartMs = shown ? r1(s.t - shown.t) : null;
    // 次のコマの時刻（その行を描くコマの始まり）と、その次のコマの始まり（行を描いたコマが出た後）
    p.lineFrameMs = shown?.rafNow ? r1(shown.rafNow - shown.t) : null;
    p.lineFrame2Ms = shown?.raf2 ? r1(shown.raf2 - shown.t) : null;
    p._m = { s, T, span, ws, outMs, shown };
    a.plays.push(p);
  }
  // 録音の中の始まり・鳴り終わり。鳴った長さ（stop／ended まで）が 250 ms より短い声（速く送った行）は、録音の中で頭を合わせられない
  // （聞こえた声は 100 ms ほど）ので、ほかの声で測った「予定との差」の中央値の位置に置き、声の大きさもほかの声の中央値を使う
  // 1 回目（find）：録音の中のその声の頭の位置。予定の位置（始めの合わせの音で直した）の前後 400 ms（取り込みの跳びも入る）で、
  // 声の強い所の 0.3 秒（最初の声の窓から）と最もよく合う所（標本 1 つずつ）。相関 0.7 以上なら、その声も目印にする
  const alignAt = (T, from, len, center, radius) => {
    let tt = 0;
    for (let j = 0; j < len; j++) tt += T[from + j] * T[from + j];
    let b = { k: center, v: -1 };
    for (let d = -radius; d <= radius; d++) {
      const k = center + d;
      if (k < 0) continue;
      let xy = 0;
      let xx = 0;
      for (let j = 0; j < len; j++) {
        const u = x[k + from + j] ?? 0;
        xy += u * T[from + j];
        xx += u * u;
      }
      const c = xx > 1e-14 ? xy / Math.sqrt(xx * tt) : 0;
      if (c > b.v) b = { k, v: c };
    }
    return b;
  };
  const find = (p) => {
    const { T, ws, outMs } = p._m;
    const strong = ws.findIndex((w) => w.voiced) * WIN;
    const b = alignAt(T, strong, Math.round(0.3 * SR), Math.round(toRec(outMs) * SR), Math.round(0.4 * SR));
    p._m.found = b;
    if (b.v >= 0.7) anchors.push({ what: `${p.id}#${p.n}`, n: p.n, rec: b.k / SR, off: outMs - (b.k / SR) * 1000 });
  };
  // 2 回目（measure）：声ごとの「予定との差」は、ほかの目印のうち差がいちばん近いもの（同じ跳びの区間にある目印）に対して測り、
  // その目印の差で、この声の時刻（聞こえた・鳴り終わり・止めた後）をページの時刻に直す。
  // 鳴った長さ（stop／ended まで）が 250 ms より短い声（速く送った行）は録音の中で頭を合わせられない（聞こえた声は 100 ms ほど）ので、
  // ページの時刻で近い目印の差と、ほかの声の「予定との差」の中央値の位置に置き、声の大きさもほかの声の中央値を使う
  const measure = (p, fixed) => {
    const { s, T, span, ws, outMs, shown } = p._m;
    const s0 = Math.round(span.first * SR);
    let best;
    let ref;
    if (fixed) {
      ref = anchors.reduce((q, w) => (!q || Math.abs(toPage(w.rec, w.off) - outMs) < Math.abs(toPage(q.rec, q.off) - outMs) ? w : q), null);
      best = { k: Math.round(toRec(outMs + fixed.residualMs, ref.off) * SR), v: null };
    } else {
      best = p._m.found;
      if (best.v < 0.7) {
        // 強い所が合わない（相関 0.7 未満）：声の頭の 0.1 秒で、予定の位置の前後 60 ms
        const h = alignAt(T, s0, Math.round(0.1 * SR), Math.round(toRec(outMs) * SR), Math.round(0.06 * SR));
        if (h.v > best.v) best = h;
      }
      const own = outMs - (best.k / SR) * 1000;
      ref = anchors.filter((w) => w.n !== p.n).reduce((q, w) => (!q || Math.abs(w.off - own) < Math.abs(q.off - own) ? w : q), null);
    }
    const off = ref.off;
    const wc = windowCorr(x, T, best.k, ws);
    const ev = windowEvidence(x, T, best.k, wc, fixed?.gain ?? 0);
    const voiced = wc.map((v, i) => [v?.c ?? null, i]).filter(([v]) => v !== null);
    const hit = voiced.filter(([v]) => v >= HIT_CORR);
    const lastHit = lastPlayed(ev.states);
    // 鳴り終わりより前の「無い」窓（途中で途切れていないか）と、各状態の数
    const missBefore = ev.states.filter((st, i) => st === 'a' && i <= lastHit).length;
    const count = (k) => ev.states.filter((st) => st === k).length;
    p.rec = {
      ...(fixed ? { short: true } : {}),
      startSec: r3(best.k / SR),
      headCorr: best.v === null ? null : r3(best.v),
      // 予定との差：この声の頭（録音）を、目印 ref の差でページの時刻に直した値 − ページの予定（出力の時刻）
      residualMs: r1(toPage(best.k / SR, off) - outMs),
      ref: ref.what,
      // 始めの合わせの音だけで直したときの差（取り込みが跳んでいなければ residualMs と同じ）
      residualFromStartTickMs: r1(toPage(best.k / SR) - outMs),
      offsetMs: r1(off),
      // 音声ファイルの頭が聞こえた時刻（録音の中の型の位置）と、声の始まり（一覧の lead：ファイルの頭の無音の長さ）
      fileHeardMs: r1(toPage(best.k / SR, off)),
      speechHeardMs: r1(toPage(best.k / SR, off) + LINE[s.id].lead * 1000),
      playedUntilMs: lastHit >= 0 ? r1(toPage((best.k + (lastHit + 1) * WIN) / SR, off)) : null,
      playedSec: lastHit >= 0 ? r3(((lastHit + 1) * WIN) / SR) : 0,
      voicedSec: r3(span.last),
      matchedWindows: `${hit.length}/${voiced.length}`,
      // 大きさで確かめた窓の数（ある・無い・決めない）と、声の大きさ（型に掛ける数）
      evidence: { present: count('p'), absent: count('a'), undecided: count('i'), gain: r3(ev.g) },
      missedBeforeLast: missBefore,
      medianCorr: hit.length ? r3(hit.map(([v]) => v).sort((q, w) => q - w)[Math.floor(hit.length / 2)]) : null,
      // 20 ms ごとの相関と状態（声の窓だけ。図や確かめ直し用）
      windows: wc.map((v) => (v === null ? null : Math.round(v.c * 100) / 100)),
      states: ev.states.map((st) => st ?? '.').join(''),
      // 声が「ある」と言える窓の終わりの時刻（ページの時刻）
      voiceEndsMs: ev.states.flatMap((st, i) => (st === 'p' ? [r1(toPage((best.k + (i + 1) * WIN) / SR, off))] : [])),
    };
    p.lineToSpeechHeardMs = shown ? r1(p.rec.speechHeardMs - shown.t) : null;
  };
  const measurable = a.plays.filter((p) => p._m.outMs !== null && p._m.T && !p.unrecorded);
  const lasted = (p) => Math.min(p.stopCallMs ?? Infinity, p.endedMs ?? Infinity) - p.startCallMs;
  const longs = measurable.filter((p) => lasted(p) >= 250);
  for (const p of longs) find(p);
  for (const p of longs) measure(p, null);
  a.anchors = anchors.map((w) => ({ what: w.what, recSec: r3(w.rec), offsetMs: r1(w.off) }));
  const med = (v) => (v.length ? v.slice().sort((q, w) => q - w)[Math.floor(v.length / 2)] : null);
  const fixed = { residualMs: med(longs.map((p) => p.rec.residualMs)) ?? 6, gain: med(longs.map((p) => p.rec.evidence.gain).filter((g) => g > 0)) ?? 0 };
  for (const p of measurable.filter((q) => lasted(q) < 250)) measure(p, fixed);
  // ---- 止めた・終わった後に、同じ台詞のどこか（0.3 秒ずつ・0.1 秒ずらし）がまた聞こえないか（遅れて鳴った・戻った後に続きが鳴った）。
  //      止まった時刻：stop の呼び出し・音源の ended・始めた後の最初の入力（キー・押し）・blur・hidden のうち最も早い時刻。その 0.15〜5 秒後を探す
  for (const p of measurable) {
    const { T, ws } = p._m;
    const trig = [p.stopCallMs, p.endedMs, log.input.find((i) => i.t > p.startCallMs + 1)?.t, log.pageEv.find((e) => (e.e === 'blur' || (e.e === 'visibilitychange' && e.vis === 'hidden')) && e.t > p.startCallMs)?.t].filter((v) => Number.isFinite(v));
    const ref = Math.min(...trig);
    const off = p.rec.offsetMs;
    const r0 = Math.max(0, Math.round(toRec(ref + 150, off) * SR));
    const r1_ = Math.min(x.length, Math.round(toRec(ref + 5000, off) * SR));
    p.rec.lateSearch = { fromMs: r1(ref + 150), toMs: r1(toPage(r1_ / SR, off)), hits: [] };
    if (r1_ - r0 < Math.round(0.4 * SR)) continue;
    const seg = x.subarray(r0, r1_);
    const nccSeg = makeNcc(seg);
    const C = Math.round(0.3 * SR);
    const loud = ws.map((w) => w.e);
    const maxE = Math.max(...loud);
    for (let c0 = 0; c0 + C <= T.length; c0 += Math.round(0.1 * SR)) {
      // 声の大きい所を含むかたまりだけ（型のいちばん大きい 20 ms の窓から -12 dB 以内の窓が 3 つ以上）
      const wi = Math.floor(c0 / WIN);
      if (loud.slice(wi, wi + C / WIN).filter((e) => e >= maxE * 10 ** -1.2).length < 3) continue;
      const c = nccSeg(T.subarray(c0, c0 + C));
      for (const q of peaks(c, 0.6, Math.round(0.2 * SR))) p.rec.lateSearch.hits.push({ chunkSec: r3(c0 / SR), atMs: r1(toPage((r0 + q.k) / SR, off)), ncc: r3(q.v) });
    }
  }
  for (const p of a.plays) delete p._m;
  // ---- 録音の中の、予定に無い声（型の声の頭 0.5 秒（相関 0.6 以上）と 0.25 秒（0.7 以上）で全体を探す。予定の始まりから 0.1 秒より離れた山）
  for (const l of LINES) {
    const T = templates[l.id];
    const s0 = Math.round(speechSpan(T).first * SR);
    for (const [len, th] of [
      [0.5, 0.6],
      [0.25, 0.7],
    ]) {
      const c = ncc(T.subarray(s0, s0 + Math.round(len * SR)));
      for (const q of peaks(c, th, Math.round(0.4 * SR))) {
        const startSec = (q.k - s0) / SR;
        const known = a.plays.find((p) => p.id === l.id && p.rec && Math.abs(p.rec.startSec - startSec) < 0.1);
        if (known) {
          known.rec.searchNcc = { ...(known.rec.searchNcc ?? {}), [len]: r3(q.v) };
          continue;
        }
        if (!a.unexpected.some((u) => u.id === l.id && Math.abs(u.recSec - startSec) < 0.1)) a.unexpected.push({ id: l.id, recSec: r3(startSec), pageMs: r1(toPage(startSec)), probeSec: len, ncc: r3(q.v) });
      }
    }
  }
  // ---- 重なり（録音の中の、聞こえた声の区間 [始まり, 鳴り終わり]）
  const iv = a.plays.filter((p) => p.rec && p.rec.playedUntilMs !== null).map((p) => ({ id: p.id, a: p.rec.fileHeardMs, b: p.rec.playedUntilMs }));
  for (let i = 0; i < iv.length; i++) for (let j = i + 1; j < iv.length; j++) {
    const o = Math.min(iv[i].b, iv[j].b) - Math.max(iv[i].a, iv[j].a);
    if (o > LIMIT.overlapMs) a.overlaps.push({ a: iv[i].id, b: iv[j].id, ms: r1(o) });
  }
  // ---- 映像：行が画面に出たコマ（合わせの印で映像の時刻をページの時刻に直す）。
  //      行を書く直前のコマを基準に、その所（字幕の帯・会話の文）の縮めた明るさが大きく替わった最初のコマ（95 番目の百分位の差が 12 以上）
  const fr = dec.video.frames.map((f) => ({ ...f, cap: f.cap ? Uint8Array.from(atob(f.cap), (c) => c.charCodeAt(0)) : null, dlg: f.dlg ? Uint8Array.from(atob(f.dlg), (c) => c.charCodeAt(0)) : null }));
  const p95 = (u, v) => {
    const d = Array.from(u, (q, i) => Math.abs(q - v[i])).sort((x, y) => x - y);
    return d[Math.floor(d.length * 0.95)];
  };
  const fl = fr.find((f) => f.mag > 120);
  const t0 = log.ticks.find((t) => t.tag === 'start');
  if (fl && t0?.flashRaf) {
    const offV = t0.flashRaf - fl.m * 1000;
    a.videoOffsetMs = r1(offV);
    a.avOffsetMs = r1(offV - offs[0]);
    const span = dec.video.duration && Number.isFinite(dec.video.duration) ? dec.video.duration : fr.at(-1).m;
    a.video = { w: dec.video.w, h: [...new Set(fr.map((f) => f.h))].join('/'), frames: fr.length, fps: r1(fr.length / Math.max(0.001, span)) };
    for (const e of log.text) {
      if (!e.text) continue;
      const id = LINES.find((l) => l.text === e.text)?.id ?? null;
      const mDom = (e.t - offV) / 1000;
      const ref = fr.filter((q) => q[e.kind] && q.m <= mDom - 0.03).at(-1);
      const f = ref ? fr.find((q) => q.m > ref.m && q[e.kind] && p95(q[e.kind], ref[e.kind]) >= 12) : null;
      const shownMs = f ? f.m * 1000 + offV : null;
      const play = id ? a.plays.find((p) => p.id === id && p.lineShownMs !== null && Math.abs(p.lineShownMs - e.t) < 1) : null;
      a.visual.push({ kind: e.kind, id, text: e.text.slice(0, 24), domMs: r1(e.t), videoShownMs: r1(shownMs), domToVideoMs: shownMs !== null ? r1(shownMs - e.t) : null, videoToSpeechHeardMs: play?.rec && shownMs !== null ? r1(play.rec.speechHeardMs - shownMs) : null });
    }
  } else a.videoError = '合わせの印が映像に見つからない';
  return a;
}

// ================================================================ 判定

/** 止めた理由の時刻（ページの時刻）：入力（M・押し）・知らせ（blur・visibilitychange） */
function triggerOf(log, play, by) {
  const after = play.startCallMs;
  if (by === 'KeyM') return log.input.find((i) => i.k === 'KeyM' && i.t > after)?.t ?? null;
  if (by === 'pointer') return log.input.find((i) => i.p && i.t > after)?.t ?? null;
  if (by === 'blur') return log.pageEv.find((e) => e.e === 'blur' && e.t > after)?.t ?? null;
  if (by === 'synthetic-hidden') return log.pageEv.find((e) => e.e === 'visibilitychange' && e.vis === 'hidden' && e.t > after)?.t ?? null;
  // 本物のタブの切り替え：blur が visibilitychange（hidden）より先に来る（どちらでも止める）
  if (by === 'hidden') return log.pageEv.find((e) => (e.e === 'blur' || (e.e === 'visibilitychange' && e.vis === 'hidden')) && e.t > after)?.t ?? null;
  return null;
}

function judge(name, run, a) {
  const { log } = run;
  const expect = EXPECT[name] ?? {};
  const P = (label, ok, extra) => check(name, label, ok, extra);
  if (a.error) return P('録音を分析できる', false, a.error);
  P('合わせの音が録音の始めと終わりに見つかる', a.ticks.every((t) => t.recSec !== null) && a.ticks.length === 2, `始めと終わりの差（取り込みの時計の跳び）${a.driftMs} ms・相関 ${a.ticks.map((t) => t.ncc).join('/')}`);
  if (Math.abs(a.driftMs ?? 0) > 20) note(`   （${name}：タブの音の取り込みの時計が録音の途中で ${a.driftMs} ms 跳んだ（この環境の負荷）。声の時刻は、同じ区間の目印（ほかの声・合わせの音）で直した）`);
  const recorded = (p) => !run.recordedUntil || p.startCallMs < run.recordedUntil;
  const plays = a.plays;
  // 行が出てから声を始めるまで
  const late = plays.filter((p) => p.lineToStartMs === null || p.lineToStartMs > LIMIT.startMs || p.lineToStartMs < 0);
  P(`声のある行が出てから、その台詞の声の音源を始めるまで ${LIMIT.startMs} ms 以内（ページの中の時刻）`, plays.length > 0 && late.length === 0, plays.map((p) => `${p.id} ${p.lineToStartMs}ms`).join(' / '));
  // 録音の中の始まりが予定どおり
  // 鳴った長さが 250 ms より短い声（速く送った行）は録音の中で頭を合わせられないので、この確かめから除く（ほかの確かめはする）
  const recPlays = plays.filter((p) => recorded(p) && p.rec && !p.rec.short);
  // 型と合った位置が偶然でないこと：頭 0.1 秒の相関が 0.5 以上か、20 ms の窓が 3 つ以上合った
  P(`録音の中の声の始まりが、ページの予定（出力の時刻）と ±${LIMIT.residualMs} ms（同じ区間の目印に対して）`, recPlays.length > 0 && recPlays.every((p) => Math.abs(p.rec.residualMs) <= LIMIT.residualMs && (p.rec.headCorr >= 0.5 || Number(p.rec.matchedWindows.split('/')[0]) >= 3)), recPlays.map((p) => `${p.id} ${p.rec.residualMs}ms（目印 ${p.rec.ref}・始めの合わせの音だけなら ${p.rec.residualFromStartTickMs}ms・頭の相関 ${p.rec.headCorr}）`).join(' / '));
  // 最後まで鳴らす台詞
  for (const id of expect.full ?? []) {
    const p = plays.find((q) => q.id === id);
    // 「無い」窓は 2 つまで（続けて 2 つは無い）：3D を描く混んだ環境では、出力か取り込みの 20 ms ほどの途切れで 1 つ外れることがある
    const twoInRow = !!p?.rec && /aa/.test(p.rec.states.replace(/[.i]/g, ''));
    const ok = !!p?.rec && p.rec.playedSec >= p.rec.voicedSec - 0.3 && p.rec.evidence.absent <= 2 && !twoInRow && !p.stopCallMs && p.endedMs !== null;
    P(`「${id}」は最後まで鳴った（録音の中で最後の 0.3 秒の中まで声が「ある」・声の「無い」窓は 2 つまで（続けては無い）・音源の ended が来た・stop を呼んでいない）`, ok, p?.rec ? `鳴った ${p.rec.playedSec}/${p.rec.voicedSec} 秒・窓 ある ${p.rec.evidence.present}／無い ${p.rec.evidence.absent}／決めない ${p.rec.evidence.undecided}・相関の合った窓 ${p.rec.matchedWindows}` : '音源が無い');
  }
  // 止めた台詞
  for (const c of expect.cut ?? []) {
    const p = plays.find((q) => q.id === c.id);
    if (!p) {
      P(`「${c.id}」の声が始まった`, false, '音源が無い');
      continue;
    }
    const trig = triggerOf(log, p, c.by);
    const callMs = trig !== null && p.stopCallMs !== null ? p.stopCallMs - trig : null;
    // まとめの表のため：止めた理由・その時刻から stop の呼び出しまで・録音で声が消えるまで（鳴り終わりの窓）
    p.stopInfo = { by: c.by, callMs: r1(callMs), heardEndMs: trig !== null && p.rec?.playedUntilMs != null ? r1(p.rec.playedUntilMs - trig) : null };
    P(`「${c.id}」：止める入力・知らせ（${c.by}）から音源の stop まで ${LIMIT.stopCallMs} ms 以内`, callMs !== null && callMs >= 0 && callMs <= LIMIT.stopCallMs, `${r1(callMs)} ms`);
    // 止めた後の声のバス（次の台詞が同じ入力で始まったときは、次の台詞の始まりまで。重なりは下の確かめで見る）
    const next = log.src.find((e) => e.ev === 'start' && trig !== null && e.t > trig - 1 && e.n !== p.n);
    if (!next || next.t > trig + 2000) {
      // AudioContext を止めている（suspended）間は音を作らない（AnalyserNode は最後の中身のまま残るので、その値は見ない）
      const busAfter = log.samples.filter((s) => trig !== null && s.t > trig + 60 && s.t < trig + 2000);
      const loud = busAfter.filter((s) => s.cs === 'running' && (s.vr ?? 0) > 1e-4);
      const susp = busAfter.filter((s) => s.cs !== 'running').length;
      P(`「${c.id}」：止めた後 60 ms〜2 秒、声のバスは無音（20 ms ごとの記録。止めている AudioContext は音を作らない）`, busAfter.length > 0 && loud.length === 0, `記録 ${busAfter.length}・音あり ${loud.length}・AudioContext を止めていた記録 ${susp}`);
    } else note(`   （${c.id}：同じ入力で次の台詞「${next.id}」が ${r1(next.t - trig)} ms 後に始まった）`);
    if (!c.unrecorded && recorded(p) && p.rec) {
      const heard = p.rec.playedUntilMs !== null && trig !== null ? p.rec.playedUntilMs - trig : null;
      P(`「${c.id}」：録音の中で、止める入力・知らせから ${LIMIT.stopHeardMs} ms 以内に声が消えた（出力の時刻。鳴り終わりの窓）`, heard === null || heard <= LIMIT.stopHeardMs, heard === null ? '声の窓が合わない（鳴った長さ 0）' : `${r1(heard)} ms（鳴った ${p.rec.playedSec} 秒）`);
      const after = trig === null ? [] : p.rec.voiceEndsMs.filter((t) => t > trig + LIMIT.stopHeardMs);
      P(`「${c.id}」：止める入力・知らせの ${LIMIT.stopHeardMs} ms 後より後に、その台詞の声が「ある」20 ms の窓が 1 つも無い（録音。大きさで確かめる）`, trig !== null && after.length === 0, `${after.length}（${after.slice(0, 3).map((t) => `+${r1(t - trig)}ms`).join(' ')}）・その後の「無い」窓（声があれば聞こえる大きさなのに合わない）${[...p.rec.states].filter((st, i) => st === 'a' && p.rec.fileHeardMs + (i + 1) * 20 > trig + LIMIT.stopHeardMs).length}`);
    }
  }
  for (const id of expect.skipped ?? []) P(`「${id}」は飛ばした場面なので鳴らない`, !plays.some((p) => p.id === id), plays.map((p) => p.id).join(','));
  // 2 度鳴らない（同じ台詞の音源は 1 つ）
  const ids = plays.map((p) => p.id);
  P('同じ台詞の声の音源を 2 度作らない（後から流し直さない）', new Set(ids).size === ids.length, ids.join(','));
  // 重なり（ページの記録：音源の区間）
  const src = plays.map((p) => ({ id: p.id, a: p.startCallMs, b: Math.min(p.stopCallMs ?? Infinity, p.endedMs ?? Infinity) }));
  const pageOv = [];
  for (let i = 0; i < src.length; i++) for (let j = i + 1; j < src.length; j++) if (Math.min(src[i].b, src[j].b) - Math.max(src[i].a, src[j].a) > 15) pageOv.push(`${src[i].id}×${src[j].id}`);
  P('2 つの声の音源が同時に鳴らない（ページの記録。止める絞り 12 ms を除く）', pageOv.length === 0, pageOv.join(' '));
  P(`録音の中で 2 つの声が重ならない（${LIMIT.overlapMs} ms より長く）`, a.overlaps.length === 0, JSON.stringify(a.overlaps));
  P('録音の中に、予定に無い声（遅れて鳴った・2 度鳴った）が無い', a.unexpected.length === 0, JSON.stringify(a.unexpected));
  const again = plays.filter((p) => p.rec?.lateSearch?.hits.length);
  P('止めた・終わった声が、その 0.15〜5 秒後に（途中からでも）また聞こえない（録音。同じ台詞を 0.3 秒ずつ探す）', plays.some((p) => p.rec?.lateSearch) && again.length === 0, again.map((p) => `${p.id}：${p.rec.lateSearch.hits.slice(0, 3).map((h) => `${h.chunkSec}s→+${r1(h.atMs - p.rec.lateSearch.fromMs + 150)}ms（${h.ncc}）`).join(' ')}`).join(' / '));
  P('新しい声の間、speechSynthesis を一度も読まない・呼ばない', log.tts.length === 0, `${log.tts.length}`);
  P('ページの誤りが無い', run.env.errors.length === 0, run.env.errors.slice(0, 3).join(' | '));
}

// ================================================================ 実行

const runs = {};
const ANALYZE_ONLY = process.env.ANALYZE_ONLY === '1';
try {
  for (const part of PARTS) {
    if (ANALYZE_ONLY) {
      // 録った後の分析だけをやり直す（<部>-log.json と <部>.webm から）
      const j = JSON.parse(readFileSync(join(OUT, `${part}-log.json`), 'utf8'));
      const webm = join(OUT, `${part}.webm`);
      runs[part] = { env: { part, errors: j.errors, marks: j.marks, loadSec: j.loadSec, voiceReq: j.voiceReq, tracks: j.tracks, webm: existsSync(webm) ? webm : null, focusAfterOff: j.focusAfterOff, switch1: j.switch?.[0] ?? null, switch2: j.switch?.[1] ?? null }, log: j, recordedUntil: j.cap?.stopT ?? null };
      continue;
    }
    let run = null;
    if (part === 'natural') run = await partNatural();
    else if (part === 'skip') run = await partSkip();
    else if (part === 'fast') run = await partFast();
    else if (part === 'menu') run = await partMenu();
    else if (part === 'tab') run = await partTab();
    else if (part === 'render') run = await partNatural('render', '?q=low', { talk: false });
    else throw new Error(`知らない部 ${part}`);
    if (!run) continue;
    runs[part] = run;
    const { env, log } = run;
    run.recordedUntil = log.cap?.stopT ?? null;
    writeFileSync(join(OUT, `${part}-log.json`), JSON.stringify({ part, loadSec: env.loadSec, tracks: env.tracks ?? null, cap: log.cap, marks: env.marks, focusAfterOff: env.focusAfterOff ?? null, switch: [env.switch1 ?? null, env.switch2 ?? null], voiceReq: env.voiceReq, errors: env.errors, ...log }));
    note(`   ${part}：読み込み ${env.loadSec.toFixed(1)} 秒・録画 ${env.webm ? `${log.cap?.chunks} かたまり ${log.cap?.bytes} バイト（${((log.cap.stopT - log.cap.startT) / 1000).toFixed(1)} 秒）` : 'なし'}・音源 ${log.src.filter((e) => e.ev === 'start').map((e) => e.id).join(' / ')}`);
  }
  // ---- 分析
  const items = Object.entries(runs)
    .filter(([, r]) => r.env.webm && existsSync(r.env.webm))
    .map(([part, r]) => {
      const capRect = r.log.text.find((e) => e.kind === 'cap' && e.rect)?.rect ?? null;
      const dlgRect = r.log.text.find((e) => e.kind === 'dlg' && e.rect)?.rect ?? null;
      return { part, webm: r.env.webm, regions: { cap: capRect, dlg: dlgRect, flash: r.log.ticks[0]?.flashRect ?? null } };
    });
  note(`== 分析：録音 ${items.length} 本（16 kHz に直して型の相関）・映像のコマ（実時間で再生して数える）`);
  const dec = await decodeAll(items);
  for (const [part, run] of Object.entries(runs)) {
    const d = dec.out[part];
    if (!d) {
      check(part, '録画がある', false, '録画のファイルが無い');
      continue;
    }
    const a = analyzePart(part, run.log, d, dec.templates, run.recordedUntil);
    results.parts[part] = { analysis: a, marks: run.env.marks, loadSec: run.env.loadSec, voiceReq: run.env.voiceReq, tracks: run.env.tracks ?? null, pageEv: run.log.pageEv, stats: run.log.stats, focusAfterOff: run.env.focusAfterOff ?? null, switch: [run.env.switch1 ?? null, run.env.switch2 ?? null] };
    judge(part, run, a);
    if (part === 'tab') tabChecks(run, a);
    if (part === 'fast') {
      // 本物のタップの間（ページに届いた pointerdown の時刻）：300 ms より短い間で続けたタップの並び
      // 間はタップを作った時刻（イベントの timeStamp）で。ページが受け取った時刻（重い処理の後）の間も書く
      const taps = run.log.input.filter((i) => i.p === 'touch');
      const runsOf = [];
      for (const t of taps) {
        const last = runsOf.at(-1);
        if (last && t.ts - last.at(-1).ts < 300) last.push(t);
        else runsOf.push([t]);
      }
      const seqs = runsOf.filter((r) => r.length >= 2).map((r) => ({ made: r.slice(1).map((t, i) => r1(t.ts - r[i].ts)), got: r.slice(1).map((t, i) => r1(t.t - r[i].t)) }));
      results.parts.fast.tapGaps = seqs;
      check('fast', '本物のタップを 300 ms より短い間で続けた（演出の「次の場面」2 回・会話 4 回。タップを作った時刻の間）', seqs.some((g) => g.made.length === 1) && seqs.some((g) => g.made.length >= 3) && seqs.every((g) => g.made.every((v) => v < 300)), seqs.map((g) => `作った間 ${g.made.join('/')} ms（ページが受け取った間 ${g.got.join('/')} ms）`).join('・'));
    }
  }
} catch (e) {
  failed++;
  note(`NG 例外: ${e.stack || e}`);
  // 途中で失敗した部のページの記録も残す（何が起きたかを見るため）
  for (const env of [...openEnvs]) {
    try {
      const log = await pageLog(env);
      writeFileSync(join(OUT, `${env.part}-log.json`), JSON.stringify({ part: env.part, failed: String(e), marks: env.marks, errors: env.errors, voiceReq: env.voiceReq, ui: await env.page.evaluate(() => window.__game.ui), probe: await env.page.evaluate(() => window.__audio.probe), ...log }));
    } catch {
      /* ページが無い */
    }
    await closeGame(env);
  }
}

/** tab の部：本物のタブの切り替えで、本物の知らせが来たか（取り込み中は blur・取り込みなしは visibilitychange hidden）、戻っても流し直さないか */
function tabChecks(run, a) {
  const { log, env } = run;
  const ev = log.pageEv;
  const s1 = env.switch1;
  const s2 = env.switch2;
  const in1 = ev.filter((e) => e.t >= s1.away - 5 && e.t <= s1.back + 3000);
  const in2 = ev.filter((e) => e.t >= s2.away - 5 && e.t <= s2.back + 3000);
  const fmt = (xs) => xs.map((e) => `${e.e}(${e.vis}${e.focus ? ',focus' : ''})@${r1(e.t)}`).join(' ');
  check('tab', '録画中の本物のタブの切り替え：本物の blur が来て、戻ると focus（取り込み中のタブは Chromium が見えているまま）', in1.some((e) => e.e === 'blur') && in1.some((e) => e.e === 'focus'), fmt(in1));
  check('tab', '録画なしの本物のタブの切り替え：本物の visibilitychange（hidden）が来て、戻ると visible', in2.some((e) => e.e === 'visibilitychange' && e.vis === 'hidden') && in2.some((e) => e.e === 'visibilitychange' && e.vis === 'visible'), fmt(in2));
  const hid = log.samples.filter((s) => s.t > s2.away + 200 && s.t < s2.back);
  check('tab', '録画なしの切り替えの間：AudioContext を止めている（suspended。音を作らない）', hid.length > 0 && hid.every((s) => s.cs === 'suspended'), `記録 ${hid.length}・状態 ${[...new Set(hid.map((s) => `${s.st}/${s.cs}`))].join(',')}`);
  for (const [k, s] of [['録画中', s1], ['録画なし', s2]]) {
    const back = log.samples.filter((x) => x.t > s.back + 300 && x.t < s.back + 2400);
    const again = log.src.filter((e) => e.ev === 'start' && e.t > s.away && e.t < s.back + 2400);
    const loud = back.filter((x) => x.cs === 'running' && (x.vr ?? 0) > 1e-4);
    check('tab', `${k}：タブを戻した後 2 秒、声を流し直さない（音源を作らない・声のバスは無音）・音は再開している`, back.length > 0 && loud.length === 0 && again.length === 0 && back.at(-1).cs === 'running', `記録 ${back.length}・音あり ${loud.length}・切り替えてから戻した 2.4 秒後までの音源 ${again.map((e) => e.id).join(',') || 'なし'}・状態 ${back.at(-1)?.cs}`);
  }
}

// ================================================================ まとめ（JSON・Markdown）

results.passed = passed;
results.failed = failed;
results.lines = lines;
writeFileSync(join(OUT, 'v28-voice-check.json'), JSON.stringify(results, null, 1));
writeFileSync(join(OUT, 'v28-voice-check.md'), summaryMd());
note(`v28-voice-check: OK ${passed}・NG ${failed}`);
process.exit(failed ? 1 : 0);

function summaryMd() {
  const md = [];
  md.push('# Version 28 V3：台詞の音声の本物のブラウザでの確かめ（e2e/v28-voice-check.mjs）', '');
  md.push('- **実時間の録画（real-time capture）**：ページのタブを getDisplayMedia（今のタブ・音つき）で取り込み、MediaRecorder（webm・vp8＋opus）でそのまま録った。**音はゲーム自身の出力をその場で録ったもの（後から足していない）**。');
  md.push('- ただし録り始めと終わりに、確かめの側が「合わせの音」（60 ms の 1→4 kHz のさえずり。ページの AudioContext から直に出す）と「合わせの印」（右端の赤紫の四角 300 ms）を出している（録音・映像の時刻をページの時刻に合わせるため。ゲームの音・画面ではない）。');
  md.push(`- 画面 ${VIEW.width}×${VIEW.height}（録り始めの数コマだけ 1280×772：取り込みの「共有中」の帯が出る前）。既定の部は \`${QUERY}\`：3D は描かない（読み込みの時などに描いた止まった画が後ろに残る）。字幕・会話・メニューの文字の層だけが動き、画が替わった時だけ映像のコマが来る（このためコマは毎秒数コマ）。`);
  md.push('- render の部は冒頭の演出だけを 3D の描画あり（?q=low）で：**この環境の描画はソフトウェアで 1 コマに数秒〜20 秒かかるので、映像のコマは少ない（紙芝居のよう）。演出の時計も遅れる。滑らかさの証拠にしない**。');
  md.push('- 入力は本物（クリック・タップ・キー・本物のタブの切り替え）。開発用の口は様子を読むだけ。', '- 私（作った者）は音を耳で聞けない。下の数は、録音を台詞の音声ファイルを型にした相関と大きさで調べたもの。', '');
  md.push('表の見方：「行を書いて→音源の開始」はページの中の時刻（字幕・会話の文を DOM に書いた瞬間から AudioBufferSourceNode.start まで）。「行を書いて→次のコマ」はその文を描くコマの requestAnimationFrame の時刻まで（この環境では場面の替わり目の 3D の用意で長くなる）。「録音の始まり−予定」は録音の中で見つけた音声ファイルの頭と、ページの予定（getOutputTimestamp で出力の時刻に直した値）の差（同じ区間の目印：ほかの声か合わせの音に対して。括弧は始めの合わせの音だけで直した値で、取り込みの時計が跳んでいなければ同じ区間）。「声が聞こえる」は録音の中のファイルの頭＋ファイルの頭の無音（一覧の lead）で、出力の時刻（端末の出力の遅れ約 40 ms を含む推定）。', '');
  if (MUTATE) md.push(`**確かめの側でわざと壊した実行（MUTATE=${MUTATE}）。NG が出るのが正しい。**`, '');
  md.push(`判定：OK ${passed}・NG ${failed}`, '');
  for (const [part, p] of Object.entries(results.parts)) {
    const a = p.analysis;
    md.push(`## ${part}`, '');
    if (a.recSec) md.push(`録画 \`${part}.webm\`（${a.recSec} 秒${a.video ? `・映像 ${a.video.w}×${a.video.h}・${a.video.frames} コマ（平均 ${a.video.fps} コマ/秒）` : ''}）。合わせの音の時計のずれ（始めと終わり）${a.driftMs} ms。`, '');
    md.push('| 台詞 | 行を書いて→音源の開始 | 行を書いて→次のコマ | 録音の始まり−予定 | 行を書いて→声が聞こえる | 鳴った／声の長さ | 止めた（理由：→stop／→録音で消える） |', '|---|---|---|---|---|---|---|');
    for (const q of a.plays) {
      const st = q.stopInfo ? `${q.stopInfo.by}：${q.stopInfo.callMs} ms／${q.stopInfo.heardEndMs ?? '—'} ms` : q.stopCallMs ? 'はい' : '—';
      const res = q.rec ? (q.rec.short ? '（短すぎて合わせない）' : `${q.rec.residualMs} ms（始めの合わせの音から ${q.rec.residualFromStartTickMs} ms）`) : q.unrecorded ? '（録画なし）' : '—';
      md.push(`| ${q.id} | ${q.lineToStartMs} ms | ${q.lineFrameMs ?? '—'} ms | ${res} | ${q.lineToSpeechHeardMs ?? '—'} ms | ${q.rec ? `${q.rec.playedSec}／${q.rec.voicedSec} 秒` : '—'} | ${st} |`);
    }
    md.push('', `予定に無い声：${a.unexpected?.length ?? 0}・録音の中の重なり：${a.overlaps?.length ?? 0}・止めた／終わった後にまた聞こえた声：${a.plays.filter((q) => q.rec?.lateSearch?.hits.length).length}`, '');
    if (p.tapGaps) md.push(`タップの間：${p.tapGaps.map((g) => `作った間 ${g.made.join('/')} ms（ページが受け取った間 ${g.got.join('/')} ms）`).join('・')}`, '');
    const cs = results.checks.filter((c) => c.part === part);
    for (const c of cs) md.push(`- ${c.ok ? 'OK' : 'NG'} ${c.name}${c.extra ? `（${c.extra}）` : ''}`);
    md.push('');
  }
  md.push('映像から測った「文の所の画が替わったコマ」の時刻は v28-voice-check.json の visual に入れた（取り込みのコマが毎秒数コマしか来ないので、数百 ms の幅がある。判定には使わない）。', '');
  return md.join('\n');
}
