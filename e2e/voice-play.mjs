// 台詞の音声ファイルをゲームの中で流す（Version 28 V2。docs/v28-town-motion-voice.md §5.4）を、開発サーバーの本物のページで確かめる。
//
// 描画の省略（?q=low&render=manual：3D を描かない。このコンテナの描画は 1 コマ 1〜8 秒で、その間タイマーも止まるため）で、
// 入力は本物（クリック・キー）。開発用の口は様子を読む（window.__audio・__game）のと、会話を始める（__game.talk）だけ。
// ページの中で 50 ms ごとに、声のバスの後の音の大きさ（声のバスに付けた AnalyserNode）・BGM の下げ（duckGain）・鳴っている台詞・
// 字幕／会話の文・画面を記録し、AudioBufferSourceNode の start／stop を記録して、2 つの声が重ならないことを確かめる。
//
// 部（PARTS。カンマ区切り。既定はすべて）：
//   cine     タイトルの「はじめから」（本物のクリック）→ 章の冒頭（短い始め。声なし）→ 本物の W で北へ歩いて町の急報（Version 28：ch1_report）を
//            通常速度で最後まで：字幕ごとに、その台詞の音声ファイルが鳴る・
//            字幕と声の台詞が合う・鳴っている間だけ BGM を下げる・音の長さは一覧の秒数・2 つ重ならない・音声ファイルは演出の始めに先読み。
//            続けて城下で忠勝と話す（__game.talk）→ 本物の Enter で行送り → 声の行で本物の M（メニュー）→ 止まる・閉じても流し直さない →
//            次の声の行でアプリの切り替え（ページの中で visibilitychange）→ 止まる・戻っても流し直さない → 本物の Enter で速く送る。
//            音の設定の欄（声の種類・クレジット）の画像と、声の種類を替えた保存（koto-sengoku/3d-audio の中だけ）。
//            新しい声では speechSynthesis を一度も読まない（ページに差し込んだ見張りで数える）。
//   skip     町の急報の声が鳴っている間に本物の Esc で演出を飛ばす：すぐ止まり、後から鳴らない。
//   fast     町の急報の中で本物の → を続けて押す（1 つの場面なので最初の → で終わる）：重ならず、後から古い台詞を鳴らさない。
//   tts      ?voice=tts：端末の読み上げ（旧）の道筋（音声ファイルを読まない）・設定の欄は選べず、そのことを書く。
//
// 使い方：(cd <worktree> && PORT=8791 npx vite --config proto3d/blender/tools/vite.nohmr.mjs &)
//   BASE3D=http://localhost:8791 node e2e/voice-play.mjs <出力先>
import { readFileSync, writeFileSync } from 'node:fs';
import { launchBrowser, outDir, walkToStreetReport } from './lib.mjs';

/** 台詞の音声ファイルの一覧（ほどいた長さの確かめ） */
const MANIFEST = JSON.parse(readFileSync(new URL('../proto3d/src/audio/voiceManifest.gen.json', import.meta.url), 'utf8'));

const OUT = outDir(process.argv[2] || 'e2e-out/voice-play');
const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8791';
const PARTS = (process.env.PARTS || 'cine,skip,fast,tts').split(',').map((s) => s.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL = { timeout: 600000, polling: 100 };
let failed = 0;
let passed = 0;
const lines = [];
const note = (t) => {
  lines.push(t);
  console.log(t);
};
const check = (name, ok, extra = '') => {
  if (ok) passed++;
  else failed++;
  note(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}`);
};
const result = {};

const browser = await launchBrowser();

/** ページに差し込む見張り：speechSynthesis を読んだ・呼んだ回数、音源の start／stop、押したキーの時刻 */
const INIT = () => {
  const calls = [];
  window.__ttsCalls = calls;
  const ss = window.speechSynthesis;
  if (ss) {
    for (const k of ['speak', 'cancel', 'getVoices', 'pause', 'resume', 'addEventListener']) {
      const f = ss[k];
      if (typeof f !== 'function') continue;
      try {
        Object.defineProperty(ss, k, { configurable: true, value: (...a) => (calls.push(k), f.apply(ss, a)) });
      } catch {
        /* 替えられない端末 */
      }
    }
  }
  try {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => (calls.push('get'), ss) });
  } catch {
    /* 替えられない端末 */
  }
  const src = [];
  window.__srcLog = src;
  // 声の音源の見分け：decodeAudioData でほどいた音（ゲームでは台詞の音声ファイルだけ。BGM は OfflineAudioContext で描き、効果音は作った音）
  const voiceBufs = new WeakSet();
  const B = BaseAudioContext.prototype;
  const dec = B.decodeAudioData;
  B.decodeAudioData = function (data, ok, bad) {
    const p = dec.call(this, data, ok && ((b) => (voiceBufs.add(b), ok(b))), bad);
    return p.then((b) => (voiceBufs.add(b), b));
  };
  const P = AudioBufferSourceNode.prototype;
  const start = P.start;
  const stop = P.stop;
  P.start = function (when = 0, ...rest) {
    src.push({ ev: 'start', voice: !!this.buffer && voiceBufs.has(this.buffer), dur: this.buffer ? this.buffer.duration : null, when: when || this.context.currentTime, ctxT: this.context.currentTime, t: performance.now(), node: (this.__n ??= src.length) });
    return start.call(this, when, ...rest);
  };
  P.stop = function (when = 0) {
    src.push({ ev: 'stop', voice: !!this.buffer && voiceBufs.has(this.buffer), dur: this.buffer ? this.buffer.duration : null, when: when || this.context.currentTime, ctxT: this.context.currentTime, t: performance.now(), node: this.__n ?? -1 });
    return stop.call(this, when);
  };
  const keys = [];
  window.__keys = keys;
  window.addEventListener('keydown', (e) => keys.push({ code: e.code, t: performance.now() }), true);
};

/** 50 ms ごとの記録（声のバスの大きさ・BGM の下げ・鳴っている台詞・字幕／会話の文・画面） */
const REC = () => {
  if (window.__rec) return;
  const rec = [];
  window.__rec = rec;
  let an = null;
  let buf = null;
  const tick = () => {
    const a = window.__audio;
    const e = a?.sys.engine;
    if (e?.ctx && e.voiceBus && !an) {
      an = e.ctx.createAnalyser();
      an.fftSize = 1024;
      e.voiceBus.connect(an);
      buf = new Float32Array(an.fftSize);
    }
    let vrms = 0;
    if (an) {
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += v * v;
      vrms = Math.sqrt(s / buf.length);
    }
    const vf = a?.sys.voiceFiles;
    const cap = document.querySelector('.g-cine-cap .txt')?.textContent || '';
    const dlg = document.querySelector('.g-layer[data-kind="script"] .text')?.textContent || '';
    rec.push({
      t: Math.round(performance.now()),
      ctxT: e ? Math.round(e.now() * 1000) / 1000 : 0,
      vrms: Math.round(vrms * 10000) / 10000,
      duck: e?.duckGain ? Math.round(e.duckGain.gain.value * 1000) / 1000 : null,
      ducked: e?.isDucked ?? null,
      playing: vf?.playingId ?? null,
      pending: vf?.pendingId ?? null,
      cap,
      dlg,
      screen: window.__game?.screen ?? null,
      menu: !!document.querySelector('.g-layer[data-kind="menu"]'),
      state: e?.state ?? null,
    });
  };
  setInterval(tick, 50);
};

async function openPage(query = '?q=low&render=manual', view = { width: 1000, height: 600 }) {
  const ctx = await browser.newContext({ viewport: view });
  const page = await ctx.newPage();
  page.setDefaultTimeout(600000);
  const errors = [];
  const voiceReq = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/voice/')) voiceReq.push({ path: u.pathname, t: Date.now() });
  });
  await page.addInitScript(INIT);
  await page.goto(BASE + '/' + query);
  await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && window.__audio, null, POLL);
  await page.waitForFunction(() => document.getElementById('loading')?.hidden !== false, null, POLL);
  await page.evaluate(REC);
  return { ctx, page, errors, voiceReq };
}

const rec = (page) => page.evaluate(() => window.__rec);
const vlog = (page) => page.evaluate(() => window.__audio.sys.voiceFiles.log.slice().reverse());
const stats = (page) => page.evaluate(() => ({ ...window.__audio.sys.voiceFiles.stats }));
const srcLog = (page) => page.evaluate(() => window.__srcLog);
const now = (page) => page.evaluate(() => Math.round(performance.now()));

/** 声の音源（短い音。BGM の輪は長い）が 2 つ同時に鳴った区間（音の時計）。返りは重なりの一覧 */
function overlaps(log) {
  const starts = log.filter((e) => e.ev === 'start' && e.voice);
  const stopAt = new Map();
  for (const e of log) if (e.ev === 'stop' && !stopAt.has(e.node)) stopAt.set(e.node, e.when);
  const spans = starts.map((s) => ({ node: s.node, a: s.when, b: Math.min(s.when + s.dur, stopAt.get(s.node) ?? Infinity), dur: s.dur }));
  const out = [];
  for (let i = 1; i < spans.length; i++) for (let j = 0; j < i; j++) if (spans[j].b > spans[i].a + 0.013) out.push({ prev: spans[j], next: spans[i], by: +(spans[j].b - spans[i].a).toFixed(3) });
  return { spans, out };
}

// ---------------------------------------------------------------- cine：冒頭の演出・会話・メニュー・アプリの切り替え・設定の欄

async function partCine() {
  note('== cine：はじめから（本物のクリック）→ 冒頭の演出（通常速度）→ 忠勝と話す（本物の Enter）→ メニュー（本物の M）→ アプリの切り替え → 設定の欄');
  const { page, ctx, errors, voiceReq } = await openPage();
  const man = MANIFEST.lines;
  const secOf = Object.fromEntries(man.map((e) => [e.id, e.sec]));
  const textOf = Object.fromEntries(man.map((e) => [e.id, e.text]));
  const before = await page.evaluate(() => ({ source: window.__audio.sys.voiceSource, keys: Object.keys(localStorage).sort() }));
  check('cine 既定の声の種類は新しい声（音声ファイル）', before.source === 'file', before.source);
  await page.locator('button[data-id="new:ieyasu1570"]').waitFor({ state: 'visible' });
  await sleep(500);
  await page.locator('button[data-id="new:ieyasu1570"]').click();
  await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'attached' });
  const openId = await page.locator('.g-layer[data-kind="cine"]').getAttribute('data-cine');
  await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached', timeout: 300000 });
  // Version 28 §4.3：冒頭（ch1_open）は町の様子の字幕 1 行（音声ファイルの無い地の文）だけ。声のある 4 台詞は操作の途中の町の急報（ch1_report）へ移った。
  // 冒頭では声を鳴らさない → 本物の W で通りを北へ歩いて線を越え、急報を通常速度で最後まで
  const openPlays = (await vlog(page)).filter((l) => l.event === 'play');
  check('cine 冒頭（短い始め・地の文の字幕 1 行）では声を鳴らさない（音声ファイルの無い行は無音）', openId === 'ch1_open' && openPlays.length === 0, `${openId}・鳴らした ${openPlays.map((p) => p.id).join(',') || 'なし'}`);
  await sleep(500);
  await walkToStreetReport(page);
  // 急報の層が出た時刻（先読みは演出を始めた時。最初の声の字幕は急報の 1.55 秒）
  const t0 = Date.now();
  const cineId = await page.locator('.g-layer[data-kind="cine"]').getAttribute('data-cine');
  await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached', timeout: 300000 });
  const cineEndT = await now(page);
  const r1 = await rec(page);
  const log1 = await vlog(page);
  const plays = log1.filter((l) => l.event === 'play');
  note(`   演出 ${cineId}：鳴らした台詞 ${plays.map((p) => `${p.id}(${p.sec}s)`).join(' / ')}`);
  const fetchedEarly = voiceReq.filter((r) => r.t - t0 < 1500).map((r) => r.path);
  check('cine 演出を始めたときに字幕の声（4 つ）を先に読む（最初の声の字幕より前）', ['ch1.oda_envoy.ask', 'ch1.asai_envoy.ask', 'ch1.tadakatsu.council', 'ch1.hero.gather'].every((id) => fetchedEarly.includes(`/voice/${id}.mp3`)), fetchedEarly.join(' '));
  check('cine 町の急報の声のある字幕 4 つすべてで、その台詞の音声ファイルが鳴った（順も同じ）', plays.map((p) => p.id).join() === 'ch1.oda_envoy.ask,ch1.asai_envoy.ask,ch1.tadakatsu.council,ch1.hero.gather', plays.map((p) => p.id).join());
  check('cine ほどいた長さは一覧の秒数と同じ（±0.01 秒）', plays.every((p) => Math.abs(p.sec - secOf[p.id]) < 0.01), plays.map((p) => `${p.sec}/${secOf[p.id]}`).join(' '));
  // 鳴っている間の字幕は、その台詞の文
  const playingRows = r1.filter((x) => x.playing);
  const mismatch = playingRows.filter((x) => x.cap !== textOf[x.playing] && x.cap !== '');
  check('cine 声が鳴っている間の字幕は、その台詞の文（50 ms ごとの記録）', playingRows.length > 20 && mismatch.length === 0, `記録 ${playingRows.length}・合わない ${mismatch.length}${mismatch.length ? ' 例 ' + JSON.stringify(mismatch[0]) : ''}`);
  // 字幕が出てから声が鳴り始めるまで（50 ms ごとの記録の差。読み込みの待ちを含む）
  const delays = [];
  for (const id of ['ch1.oda_envoy.ask', 'ch1.asai_envoy.ask', 'ch1.tadakatsu.council', 'ch1.hero.gather']) {
    const capAt = r1.find((x) => x.cap === textOf[id])?.t;
    const playAt = r1.find((x) => x.playing === id)?.t;
    delays.push({ id, ms: capAt !== undefined && playAt !== undefined ? playAt - capAt : null });
  }
  result.cineDelays = delays;
  check('cine 字幕が出てから声が鳴るまで 150 ms 以内（記録の間隔 50 ms）', delays.every((d) => d.ms !== null && d.ms <= 150), delays.map((d) => `${d.id} ${d.ms}ms`).join(' / '));
  // 声のバスの大きさ：鳴っている間は音がある・鳴っていない間は無音
  const loud = playingRows.filter((x) => x.vrms > 0.003).length / Math.max(1, playingRows.length);
  const idle = r1.filter((x) => !x.playing && !x.pending && x.state === 'running');
  const idleLoud = idle.filter((x) => x.vrms > 0.003);
  check('cine 声のバスの音：鳴っている間に音がある（50% 以上の記録）・鳴っていない間は無音', loud >= 0.5 && idleLoud.length <= 2, `鳴っている間の音あり ${(loud * 100).toFixed(0)}%・鳴っていない間の音あり ${idleLoud.length}/${idle.length}`);
  result.vrmsMax = Math.max(...playingRows.map((x) => x.vrms));
  // BGM の下げ：鳴っている間だけ
  const duckWhile = playingRows.filter((x) => x.ducked).length;
  const duckIdle = idle.filter((x) => x.ducked).length;
  check('cine BGM を下げるのは声が鳴っている間だけ（isDucked）', duckWhile === playingRows.length && duckIdle === 0, `鳴っている間 ${duckWhile}/${playingRows.length}・鳴っていない間 ${duckIdle}/${idle.length}`);
  const ov1 = overlaps(await srcLog(page));
  check('cine 声の音源は 2 つ同時に鳴らない（音の時計で、止める絞り 12 ms を除く）', ov1.out.length === 0 && ov1.spans.length === 4, `音源 ${ov1.spans.length}・重なり ${JSON.stringify(ov1.out.slice(0, 2))}`);
  note(`   演出の終わり（ページの時刻 ${cineEndT} ms）`);

  // ---- 会話：忠勝と話す → 声の行 → メニュー → 閉じる → 次の声の行 → アプリの切り替え → 速く送る
  await page.evaluate(() => window.__game.talk('tadakatsu'));
  await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, POLL);
  const envoysText = textOf['talk.tadakatsu.envoys'];
  for (let i = 0; i < 6; i++) {
    const u = await page.evaluate(() => window.__game.ui);
    if (u?.line?.text === envoysText) break;
    await sleep(500);
    await page.keyboard.press('Enter');
    await sleep(300);
  }
  await page.waitForFunction((id) => window.__audio.sys.voiceFiles.playingId === id, 'talk.tadakatsu.envoys', POLL);
  check('cine 会話の声の行（忠勝「織田家から使者が…」）で、その台詞の音声ファイルが鳴る', true);
  await sleep(800);
  const tM = await now(page);
  await page.keyboard.press('KeyM');
  await page.locator('.g-layer[data-kind="menu"]').waitFor({ state: 'attached' });
  await sleep(300);
  const r2 = await rec(page);
  const keyM = (await page.evaluate(() => window.__keys)).filter((k) => k.code === 'KeyM').pop();
  const stopRow = r2.find((x) => x.t >= keyM.t && !x.playing);
  check('cine 会話の上にメニューを開いた（本物の M）：声が止まる（50 ms ごとの記録で次の記録まで）', !!stopRow && stopRow.t - keyM.t <= 100 && (await page.evaluate(() => window.__audio.sys.voiceFiles.playingId)) === null, `M から止まるまで ${stopRow ? stopRow.t - keyM.t : '?'} ms`);
  // 音の設定の欄（声の種類・クレジット）
  const panel = page.locator('.g-sound');
  await panel.scrollIntoViewIfNeeded();
  const ui = await page.evaluate(() => ({
    select: document.querySelector('.g-sound select[data-id="voiceSource"]')?.value,
    options: [...document.querySelectorAll('.g-sound select[data-id="voiceSource"] option')].map((o) => o.textContent),
    disabled: document.querySelector('.g-sound select[data-id="voiceSource"]')?.disabled,
    note: document.querySelector('.g-sound [data-id="voiceNote"]')?.textContent,
    credit: document.querySelector('.g-sound [data-id="voiceCredit"]')?.textContent,
  }));
  result.panel = ui;
  check('cine 音の設定の欄：声の種類（新しい声／端末の読み上げ（旧））・説明・クレジット「音声：VOICEVOX:…」', ui.select === 'file' && ui.options.join('|') === '新しい声|端末の読み上げ（旧）' && !ui.disabled && !/端末/.test(ui.note) && ui.credit === '音声：VOICEVOX:玄野武宏、VOICEVOX:剣崎雌雄、VOICEVOX:離途、VOICEVOX:雀松朱司', JSON.stringify(ui));
  await page.locator('.g-layer[data-kind="menu"] .g-panel, .g-layer[data-kind="menu"]').first().screenshot({ path: `${OUT}/menu-sound-panel.png` });
  note(`   画像：${OUT}/menu-sound-panel.png`);
  // ここまで（冒頭の演出・会話・メニュー）新しい声のままで、speechSynthesis を一度も読んでいない・呼んでいない
  const ttsBefore = await page.evaluate(() => window.__ttsCalls.slice());
  check('cine 新しい声の間（演出・会話・メニューまで）、speechSynthesis を一度も読まない・呼ばない（見張りの数）', ttsBefore.length === 0, `読んだ・呼んだ ${ttsBefore.length}（${[...new Set(ttsBefore)].join(',')}）`);
  // 声の種類を替える（保存は koto-sengoku/3d-audio の中だけ）→ 戻す
  await page.locator('.g-sound select[data-id="voiceSource"]').selectOption('tts');
  await sleep(200);
  const st1 = await page.evaluate(() => ({ keys: Object.keys(localStorage).sort(), rec: JSON.parse(localStorage.getItem('koto-sengoku/3d-audio') || 'null'), source: window.__audio.sys.voiceSource, note: document.querySelector('.g-sound [data-id="voiceNote"]')?.textContent }));
  check('cine 声の種類を「端末の読み上げ（旧）」に：koto-sengoku/3d-audio の記録の中に書く（新しいキーは無い）・説明が替わる', st1.source === 'tts' && st1.rec?.voiceSource === 'tts' && st1.rec?.v === 1 && st1.keys.filter((k) => !before.keys.includes(k)).join() === 'koto-sengoku/3d-audio' && /端末の日本語読み上げ（旧）/.test(st1.note), JSON.stringify(st1));
  await page.locator('.g-sound select[data-id="voiceSource"]').selectOption('file');
  await sleep(200);
  const st2 = await page.evaluate(() => ({ source: window.__audio.sys.voiceSource, rec: JSON.parse(localStorage.getItem('koto-sengoku/3d-audio') || 'null') }));
  check('cine 新しい声に戻す', st2.source === 'file' && st2.rec?.voiceSource === 'file', JSON.stringify(st2));
  const nPlay = (await stats(page)).played;
  await page.keyboard.press('Escape');
  await page.locator('.g-layer[data-kind="menu"]').waitFor({ state: 'detached' });
  await sleep(1500);
  const after = await page.evaluate(() => ({ played: window.__audio.sys.voiceFiles.stats.played, playing: window.__audio.sys.voiceFiles.playingId, ui: window.__game.ui }));
  check('cine メニューを閉じて会話に戻っても、前の行の声を流し直さない', after.played === nPlay && after.playing === null && after.ui?.line?.text === envoysText, JSON.stringify({ played: after.played, nPlay, playing: after.playing }));
  // 次の行（家康「両家から、同じ日にか。」）→ アプリの切り替え
  await page.keyboard.press('Enter');
  await page.waitForFunction((id) => window.__audio.sys.voiceFiles.playingId === id, 'talk.hero.same_day', POLL);
  await sleep(500);
  const setVis = (v) =>
    page.evaluate((v) => {
      Object.defineProperty(document, 'visibilityState', { get: () => v, configurable: true });
      Object.defineProperty(document, 'hidden', { get: () => v === 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, v);
  const tHide = await now(page);
  await setVis('hidden');
  await sleep(150);
  const hid = await page.evaluate(() => ({ playing: window.__audio.sys.voiceFiles.playingId, state: window.__audio.probe.state, ducked: window.__audio.sys.engine.isDucked }));
  check('cine アプリを切り替えた（visibilitychange）：声を止める・BGM の下げを戻す', hid.playing === null && hid.state === 'paused' && hid.ducked === false, JSON.stringify(hid));
  await sleep(1000);
  const nPlay2 = (await stats(page)).played;
  await setVis('visible');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(2500);
  const back = await page.evaluate(() => ({ played: window.__audio.sys.voiceFiles.stats.played, playing: window.__audio.sys.voiceFiles.playingId, state: window.__audio.probe.state }));
  check('cine 戻っても前の行の声を流し直さない', back.played === nPlay2 && back.playing === null && back.state === 'running', JSON.stringify(back));
  const srcAfterHide = (await srcLog(page)).filter((e) => e.ev === 'start' && e.voice && e.t > tHide);
  check('cine 隠れている間・戻った後に声の音源を作らない', srcAfterHide.length === 0, `${srcAfterHide.length}`);
  // 速く送る（本物の Enter を 200 ms ごとに 2 回）：声の無い行は無音
  await page.keyboard.press('Enter');
  await sleep(200);
  await page.keyboard.press('Enter');
  await sleep(1200);
  const fast = await page.evaluate(() => ({ playing: window.__audio.sys.voiceFiles.playingId, ui: window.__game.ui }));
  check('cine 声の無い行へ送ると無音（端末の読み上げで埋めない）', fast.playing === null, JSON.stringify({ playing: fast.playing, line: fast.ui?.line?.text }));
  // 一度「端末の読み上げ（旧）」を選んだ後は、その部品が止める知らせ（アプリの切り替えなど）で読み上げを止めに行く（記録だけ）
  const tts = await page.evaluate(() => window.__ttsCalls);
  note(`   端末の読み上げを一度選んだ後の speechSynthesis の読み・呼び：${tts.length}（${[...new Set(tts)].join(',')}）`);
  const reqPaths = [...new Set(voiceReq.map((r) => r.path))];
  result.voiceRequests = voiceReq.map((r) => ({ path: r.path, ms: r.t - t0 }));
  check('cine 読んだ音声ファイルは、流した台詞の物だけ（6 つ・1 つ 1 回）', reqPaths.length === 6 && voiceReq.length === 6, reqPaths.join(' '));
  check('cine ページの誤りが無い', errors.length === 0, errors.slice(0, 3).join(' | '));
  result.cineStats = await stats(page);
  writeFileSync(`${OUT}/cine-rec.json`, JSON.stringify({ rec: await rec(page), vlog: await vlog(page), src: await srcLog(page), keys: await page.evaluate(() => window.__keys), voiceReq }, null, 0));
  await ctx.close();
}

/** 「はじめから」の後：冒頭（短い始め）が終わるのを待ち、本物の W で北へ歩いて線を越え、町の急報（声のある台詞 4 つ）を始める（Version 28 §4.3） */
async function toStreetReport(page) {
  await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'attached' });
  await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached', timeout: 300000 });
  await sleep(500);
  await walkToStreetReport(page);
}

// ---------------------------------------------------------------- skip：鳴っている間に Esc

async function partSkip() {
  note('== skip：町の急報の最初の声が鳴っている間に本物の Esc で演出を飛ばす');
  const { page, ctx, errors } = await openPage();
  await page.locator('button[data-id="new:ieyasu1570"]').waitFor({ state: 'visible' });
  await sleep(500);
  await page.locator('button[data-id="new:ieyasu1570"]').click();
  await toStreetReport(page);
  await page.waitForFunction(() => window.__audio.sys.voiceFiles.playingId === 'ch1.oda_envoy.ask', null, POLL);
  await sleep(600);
  await page.keyboard.press('Escape');
  await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached' });
  const esc = (await page.evaluate(() => window.__keys)).filter((k) => k.code === 'Escape').pop();
  await sleep(2500);
  const r = await rec(page);
  const stopRow = r.find((x) => x.t >= esc.t && !x.playing);
  const later = r.filter((x) => x.t > esc.t + 100 && (x.playing || x.vrms > 0.003));
  const st = await stats(page);
  const src = (await srcLog(page)).filter((e) => e.voice);
  check('skip Esc で声が止まる（次の記録まで）・後から鳴らない（声のバスも無音）', !!stopRow && stopRow.t - esc.t <= 100 && later.length === 0, `止まるまで ${stopRow ? stopRow.t - esc.t : '?'} ms・後の記録 ${later.length}`);
  check('skip 声の音源は 1 つだけ作られ、Esc で止めた', src.filter((e) => e.ev === 'start').length === 1 && src.some((e) => e.ev === 'stop' && e.t >= esc.t), JSON.stringify(st));
  check('skip ページの誤りが無い', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- fast：演出の中で → を続けて押す

async function partFast() {
  // Version 28：町の急報は 1 つの場面なので、最初の → で終わりへ（2 つ目の → は城下で押す）。声が重ならない・後から鳴らないことは同じに見る
  note('== fast：町の急報の中で本物の → を続けて押す（場面を速く進める。急報は 1 つの場面なので最初の → で終わる）');
  const { page, ctx, errors } = await openPage();
  await page.locator('button[data-id="new:ieyasu1570"]').waitFor({ state: 'visible' });
  await sleep(500);
  await page.locator('button[data-id="new:ieyasu1570"]').click();
  await toStreetReport(page);
  await page.waitForFunction(() => window.__audio.sys.voiceFiles.playingId === 'ch1.oda_envoy.ask', null, POLL);
  await sleep(300);
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('ArrowRight');
    await sleep(250);
  }
  await sleep(6000);
  const st = await stats(page);
  const ov = overlaps(await srcLog(page));
  const vl = await vlog(page);
  note(`   出来事：${vl.map((l) => `${l.event}:${l.id}`).join(' ')}`);
  check('fast 速く進めても声の音源は 2 つ同時に鳴らない', ov.out.length === 0, `音源 ${ov.spans.length}・重なり ${JSON.stringify(ov.out.slice(0, 2))}`);
  // 先の場面の字幕の声：鳴ったのは最後に出た字幕の台詞（送った後に、前の場面の台詞を後から鳴らさない）
  const plays = vl.filter((l) => l.event === 'play').map((l) => l.id);
  const stops = vl.filter((l) => l.event === 'stop').length;
  check('fast 送るたびに前の声を止め、前の場面の台詞を後から鳴らさない', plays[0] === 'ch1.oda_envoy.ask' && new Set(plays).size === plays.length && stops >= 1, JSON.stringify({ plays, stops, st }));
  check('fast ページの誤りが無い', errors.length === 0, errors.slice(0, 3).join(' | '));
  result.fast = { plays, stats: st };
  await ctx.close();
}

// ---------------------------------------------------------------- tts：?voice=tts

async function partTts() {
  note('== tts：?voice=tts（端末の読み上げ（旧）。このコンテナの Chromium には日本語の声が無い）');
  const { page, ctx, errors, voiceReq } = await openPage('?q=low&render=manual&voice=tts');
  await page.locator('button[data-id="new:ieyasu1570"]').waitFor({ state: 'visible' });
  await sleep(500);
  await page.locator('button[data-id="new:ieyasu1570"]').click();
  await toStreetReport(page);
  await page.waitForFunction(() => (document.querySelector('.g-cine-cap .txt')?.textContent || '').includes('徳川殿にも'), null, POLL);
  await sleep(1500);
  const p = await page.evaluate(() => ({ source: window.__audio.sys.voiceSource, fixed: window.__audio.sys.voiceSourceFixed, voice: window.__audio.probe.voice, tts: window.__ttsCalls }));
  check('tts ?voice=tts：端末の読み上げの道筋（音声ファイルを読まない・読み上げを調べる）', p.source === 'tts' && p.fixed && voiceReq.length === 0 && p.tts.includes('getVoices'), JSON.stringify({ source: p.source, status: p.voice.status, req: voiceReq.length, tts: [...new Set(p.tts)] }));
  await page.keyboard.press('Escape');
  await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached' });
  await sleep(500);
  await page.keyboard.press('KeyM');
  await page.locator('.g-sound').waitFor({ state: 'visible' });
  await sleep(300);
  const ui = await page.evaluate(() => ({
    select: document.querySelector('.g-sound select[data-id="voiceSource"]')?.value,
    disabled: document.querySelector('.g-sound select[data-id="voiceSource"]')?.disabled,
    note: document.querySelector('.g-sound [data-id="voiceNote"]')?.textContent,
    credit: document.querySelector('.g-sound [data-id="voiceCredit"]')?.textContent,
    stored: localStorage.getItem('koto-sengoku/3d-audio'),
  }));
  check('tts 音の設定の欄：端末の読み上げ（旧）を選んだまま選べない・URL の指定と書く・字幕の長さは新しい声のままで読み上げが途中で止まりうると書く・保存しない', ui.select === 'tts' && ui.disabled === true && ui.note.includes('?voice=tts') && ui.note.includes('読み上げが途中で止まる') && ui.note.includes('Version 27') && ui.stored === null, JSON.stringify(ui));
  await page.locator('.g-layer[data-kind="menu"]').first().screenshot({ path: `${OUT}/menu-sound-panel-tts.png` });
  note(`   画像：${OUT}/menu-sound-panel-tts.png`);
  check('tts ページの誤りが無い', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

try {
  if (PARTS.includes('cine')) await partCine();
  if (PARTS.includes('skip')) await partSkip();
  if (PARTS.includes('fast')) await partFast();
  if (PARTS.includes('tts')) await partTts();
} catch (e) {
  failed++;
  note(`NG 例外: ${e.stack || e}`);
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/voice-play-result.json`, JSON.stringify({ passed, failed, result, lines }, null, 2));
note(`voice-play: OK ${passed}・NG ${failed}`);
process.exit(failed ? 1 : 0);
