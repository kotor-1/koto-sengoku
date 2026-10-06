// 音（proto3d/src/audio/。docs/audio.md）を、実際に音を出力して確かめる（開発サーバー）。
//
// 部（PARTS。カンマ区切り。既定はすべて）：
//   songs  BGM 3 種と効果音の見本を、ページの中の OfflineAudioContext で、ゲームと同じ楽器・楽譜のコードで描いて WAV にする
//          （実時間ではない。音の中身（大きさ・割れ・段の変化）を聞いて・測るための物）。
//   flow   タイトルの「はじめから」（本物のクリック）→ 章の冒頭（通常速度）→ 城下を歩く（本物の W）→ メニューでミュート（本物のクリック）→
//          忠勝と話す（開発用の口 __game.talk・行送りは本物の Enter・選択は本物のクリック）→ 軍議 → 支度（直接状態変更：約束に答えた状態）→
//          城門へ歩く（本物の W）→ 出陣（本物のクリック）→ 出陣の演出（通常速度）→ 合戦（本物のクリック・×2・能力 F・全軍撤退）→
//          結果まで早送り（__battle.fastForward）→ 続ける（本物のクリック）→ 帰還の演出（通常速度）→ 戦後の城下。
//          描画の省略（?render=manual）：3D を描かない（このコンテナの描画は 1 コマ 1〜8 秒で、そのあいだ音の予約のタイマーも止まるため）。
//          ページの中で、マスターの後の AnalyserNode の音の大きさを 100 ms ごとに記録し、MediaRecorder で音のファイル（webm/opus）に取る。
//          声：このコンテナの Chromium には日本語の声が無いので、偽の speechSynthesis（ページに差し込む）で、呼び出しの文・読み・止め方を記録する。
//   interrupt  アプリの切り替え（ページの中で visibilitychange を起こす。直接）で止まり・戻り、演出のスキップ（本物の Esc）で声が止まり、
//          会話の途中にメニューからタイトルへ（本物の M・クリック）で声と曲が止まること（描画の省略・偽の speechSynthesis）。
//   prod   本番ビルド（DIST。既定 dist-proto3d）を CSP の下で開き、「はじめから」の後に音が出ること・CSP の違反が無いこと（既定の PARTS には入れない）。
//   video  音付きの実際のプレイ映像（最初の約 70 秒。描画あり ?q=low）：CDP の画面の流し（コマと時刻）と、Web Audio の出力の MediaRecorder を
//          同じ実行で同時に取り、時刻を合わせて 1 つの webm にする（コマ撮りに後から音を付けた物ではない）。声は入らない（日本語の声が無い）。
//
// 使い方：(PORT=8613 setsid nohup npx vite --config proto3d/blender/tools/vite.nohmr.mjs > /tmp/vite-8613.log 2>&1 &)
//   BASE3D=http://localhost:8613 node e2e/audio-check.mjs <出力先>
import { spawn } from 'node:child_process';
import { writeFileSync, statSync } from 'node:fs';
import { launchBrowser, outDir } from './lib.mjs';

const OUT = outDir(process.argv[2] || 'e2e-out/audio');
const BASE = process.env.BASE3D || process.env.BASE || 'http://localhost:8613';
const PARTS = (process.env.PARTS || 'songs,flow,interrupt,video').split(',').map((s) => s.trim()).filter(Boolean);
const FFMPEG = process.env.FFMPEG || '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const secs = () => `${((Date.now() - T0) / 1000).toFixed(0)}s`;
let failed = 0;
const lines = [];
const note = (t) => {
  lines.push(t);
  console.log(t);
};
const check = (name, ok, extra = '') => {
  if (!ok) failed++;
  note(`${ok ? 'OK ' : 'NG '} ${name}${extra ? '  ' + extra : ''}  [${secs()}]`);
};
const POLL = { timeout: 600000, polling: 250 };

const browser = await launchBrowser();

// ---------------------------------------------------------------- ページの中の記録

/** 100 ms ごとの音の記録（実時間・AudioContext の時刻・大きさ・曲・画面） */
const METER = () => {
  if (window.__meter) return;
  window.__meter = [];
  window.__meterOn = true;
  const tick = () => {
    if (!window.__meterOn) return;
    const a = window.__audio;
    if (a) {
      const p = a.probe;
      const l = a.level();
      window.__meter.push({
        t: Math.round(performance.now()),
        ctxT: Math.round(a.now() * 1000) / 1000,
        rms: Math.round(l.rms * 10000) / 10000,
        peak: Math.round(l.peak * 1000) / 1000,
        state: p.state,
        music: p.music.current,
        audible: p.music.audible,
        screen: p.screen,
        battle: p.battle,
        cine: p.cine ? `${p.cine.moment}:${p.cine.event ?? p.cine.kind}` : null,
        muted: p.settings.muted,
        ducked: p.ducked,
        steps: p.sfx.footsteps,
        cargo: p.sfx.cargo,
        clashes: p.sfx.clashes,
        arrows: p.sfx.arrows,
        cues: p.sfx.cues,
        creaks: p.sfx.creaks,
        mode: p.music.mode,
        section: p.music.section,
        ready: p.music.ready.length,
        sched: p.music.scheduled,
        dropped: p.music.dropped,
        gap: p.music.maxGapMs,
        voice: p.voice.speaking,
      });
    }
    setTimeout(tick, 100);
  };
  tick();
};

/** 偽の speechSynthesis（日本語の声 1 つ。読む時間は 1 字 0.15 秒 ÷ 速さ。重なり・止めた・読んだ時の字幕を記録） */
const FAKE_SPEECH = () => {
  const log = [];
  window.__speechLog = log;
  class U {
    constructor(text) {
      Object.assign(this, { text, lang: '', voice: null, pitch: 1, rate: 1, volume: 1, onstart: null, onend: null, onerror: null });
    }
  }
  let cur = null;
  let timer = 0;
  const capNow = () => {
    const c = document.querySelector('.g-cine-cap .txt');
    if (c && c.textContent) return c.textContent;
    const d = document.querySelector('.g-dialog .text');
    if (d && d.textContent) return d.textContent;
    const v = document.querySelector('.b-voicecap:not([hidden]) span');
    return v ? v.textContent.replace(/^「|」$/g, '') : null;
  };
  const synth = {
    get speaking() { return !!cur; },
    get pending() { return false; },
    getVoices() { return [{ name: '偽の日本語の声', lang: 'ja-JP', localService: true, default: true }]; },
    addEventListener() {},
    speak(u) {
      if (!u.text) return;
      if (cur) log.push({ ev: 'overlap', t: performance.now(), text: u.text, with: cur.text });
      cur = u;
      log.push({ ev: 'speak', t: Math.round(performance.now()), text: u.text, pitch: u.pitch, rate: u.rate, volume: u.volume, lang: u.lang, cap: capNow() });
      setTimeout(() => u.onstart && u.onstart(), 0);
      const ms = ([...u.text].length * 150) / (u.rate || 1);
      timer = setTimeout(() => {
        if (cur !== u) return;
        cur = null;
        log.push({ ev: 'end', t: Math.round(performance.now()), text: u.text });
        u.onend && u.onend();
      }, ms);
    },
    cancel() {
      if (!cur) return;
      const u = cur;
      cur = null;
      clearTimeout(timer);
      log.push({ ev: 'cancel', t: Math.round(performance.now()), text: u.text });
      u.onerror && u.onerror({ error: 'interrupted' });
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = U;
};

async function openPage({ width = 1000, height = 560, query = '?q=low&render=manual', fakeSpeech = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(600000);
  page.on('pageerror', (e) => note(`   ！ページの誤り ${e.message.slice(0, 200)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') note(`   ！console ${m.text().slice(0, 200)}`);
  });
  if (fakeSpeech) await page.addInitScript(FAKE_SPEECH);
  await page.goto(BASE + '/' + query);
  await page.waitForFunction(() => window.__game?.ui?.kind === 'title' && window.__audio, null, POLL);
  await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, null, POLL);
  await page.evaluate(METER);
  return { ctx, page };
}

const probe = (page) => page.evaluate(() => window.__audio.probe);
const meter = (page) => page.evaluate(() => window.__meter);
const marks = [];
const markAt = async (page, label) => {
  const t = await page.evaluate(() => Math.round(performance.now()));
  marks.push({ label, t });
  note(`   印 ${label}（ページの時刻 ${t} ms）`);
  return t;
};

/** 区間の音の大きさ（RMS の平均・最大） */
function stats(m, t0, t1) {
  const xs = m.filter((r) => r.t >= t0 && r.t <= t1);
  if (!xs.length) return { n: 0, mean: 0, max: 0 };
  const mean = xs.reduce((a, r) => a + r.rms, 0) / xs.length;
  return { n: xs.length, mean: +mean.toFixed(4), max: +Math.max(...xs.map((r) => r.rms)).toFixed(4), peak: +Math.max(...xs.map((r) => r.peak)).toFixed(3), music: [...new Set(xs.map((r) => r.music))] };
}

/** 取った音のファイル（webm/opus）をページの中で読み戻し、0.5 秒ごとの大きさと、一番長い無音（RMS < 0.003）を返す */
async function envelope(page, b64) {
  return page.evaluate(async (b64) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const ac = new OfflineAudioContext(1, 1, 48000);
    const buf = await ac.decodeAudioData(u8.buffer);
    const d = buf.getChannelData(0);
    const hop = Math.round(buf.sampleRate * 0.5);
    const rms = [];
    for (let i = 0; i + hop <= d.length; i += hop) {
      let s = 0;
      for (let j = i; j < i + hop; j++) s += d[j] * d[j];
      rms.push(Math.round(Math.sqrt(s / hop) * 10000) / 10000);
    }
    let run = 0;
    let longest = 0;
    let longestAt = -1;
    rms.forEach((r, i) => {
      if (r < 0.003) {
        run++;
        if (run > longest) {
          longest = run;
          longestAt = (i - run + 1) * 0.5;
        }
      } else run = 0;
    });
    return { sec: buf.duration, rms, longestSilenceSec: longest * 0.5, longestSilenceAt: longestAt };
  }, b64);
}

// ---------------------------------------------------------------- songs：見本の音のファイル

async function partSongs() {
  note('== songs：BGM 3 種と効果音の見本（OfflineAudioContext。ゲームと同じ楽器・楽譜のコード。実時間ではない）');
  const { page, ctx } = await openPage({ width: 640, height: 360 });
  const SEC = Number(process.env.SONG_SEC || 48);
  for (const id of ['town', 'crisis', 'battle']) {
    const r = await page.evaluate(
      async ([id, SEC]) => {
        const { SONGS, barEvents, barSeconds, barAt } = await import('/src/audio/songs.ts');
        const { playNote } = await import('/src/audio/music.ts');
        const sr = 22050;
        const oc = new OfflineAudioContext(2, Math.floor(sr * SEC), sr);
        // ゲームの既定の音量（BGM 0.6 → 0.36）と、マスターの圧縮（engine.ts と同じ値）
        const bus = oc.createGain();
        bus.gain.value = 0.36 * SONGS[id].gain;
        const comp = oc.createDynamicsCompressor();
        Object.assign(comp, {});
        comp.threshold.value = -14;
        comp.knee.value = 10;
        comp.ratio.value = 4;
        comp.attack.value = 0.006;
        comp.release.value = 0.25;
        bus.connect(comp);
        comp.connect(oc.destination);
        const song = SONGS[id];
        const spb = 60 / song.bpm;
        const sections = [];
        let t = 0.05;
        for (let i = 0; t < SEC; i++) {
          const sec = barAt(song, i).section.name;
          if (sections[sections.length - 1]?.name !== sec) sections.push({ name: sec, at: +t.toFixed(2) });
          for (const e of barEvents(song, i)) playNote(oc, bus, t + e.beat * spb, e);
          t += barSeconds(song);
        }
        const buf = await oc.startRendering();
        const n = buf.length;
        const L = buf.getChannelData(0);
        const R = buf.getChannelData(1);
        const pcm = new Int16Array(n * 2);
        let clip = 0;
        for (let i = 0; i < n; i++) {
          for (const [k, ch] of [[0, L], [1, R]]) {
            let v = ch[i];
            if (Math.abs(v) >= 1) clip++;
            v = Math.max(-1, Math.min(1, v));
            pcm[i * 2 + k] = v * 32767;
          }
        }
        const head = new DataView(new ArrayBuffer(44));
        const w = (o, s) => [...s].forEach((c, i) => head.setUint8(o + i, c.charCodeAt(0)));
        w(0, 'RIFF');
        head.setUint32(4, 36 + pcm.byteLength, true);
        w(8, 'WAVE');
        w(12, 'fmt ');
        head.setUint32(16, 16, true);
        head.setUint16(20, 1, true);
        head.setUint16(22, 2, true);
        head.setUint32(24, sr, true);
        head.setUint32(28, sr * 4, true);
        head.setUint16(32, 4, true);
        head.setUint16(34, 16, true);
        w(36, 'data');
        head.setUint32(40, pcm.byteLength, true);
        const bytes = new Uint8Array(44 + pcm.byteLength);
        bytes.set(new Uint8Array(head.buffer), 0);
        bytes.set(new Uint8Array(pcm.buffer), 44);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { b64: btoa(bin), sections, clip, title: song.title, bpm: song.bpm };
      },
      [id, SEC],
    );
    const file = `${OUT}/song-${id}.wav`;
    writeFileSync(file, Buffer.from(r.b64, 'base64'));
    note(`   ${file}（${r.title}・${r.bpm} BPM・${SEC} 秒・段 ${r.sections.map((s) => `${s.name}@${s.at}s`).join(' ')}・割れたサンプル ${r.clip}）`);
    check(`songs ${id}：割れない（|v|≥1 のサンプルなし）`, r.clip === 0, `clip ${r.clip}`);
  }
  // 効果音の見本（0.9 秒ずつ）
  const fx = await page.evaluate(async () => {
    const I = await import('/src/audio/instruments.ts');
    const sr = 22050;
    const names = ['足音（歩き）×4', '足音（走り）×4', '荷の作業（木）', '荷の作業（俵）', '木戸のきしみ', '刃の当たり', '矢', '大太鼓', '締太鼓', '鉦', '拍子木', '法螺', '風（3 秒）'];
    const SEC = names.length * 1.6 + 3;
    const oc = new OfflineAudioContext(1, Math.floor(sr * SEC), sr);
    const out = oc.createGain();
    out.gain.value = 0.49;
    out.connect(oc.destination);
    let t = 0.1;
    const at = [];
    const nx = () => {
      const v = t;
      t += 1.6;
      return v;
    };
    let s = nx();
    at.push(s);
    for (let i = 0; i < 4; i++) I.footstep(oc, out, s + i * 0.36, false, i / 4);
    s = nx(); at.push(s);
    for (let i = 0; i < 4; i++) I.footstep(oc, out, s + i * 0.2, true, i / 4);
    s = nx(); at.push(s); I.cargo(oc, out, s, 'knock', 0.4, 0.3); I.cargo(oc, out, s + 0.22, 'knock', 0.3, 0.6);
    s = nx(); at.push(s); I.cargo(oc, out, s, 'thud', 0.4, 0.5);
    s = nx(); at.push(s); I.creak(oc, out, s, 1.1, 0.3);
    s = nx(); at.push(s); I.clash(oc, out, s, 0.35, 0.4);
    s = nx(); at.push(s); I.arrow(oc, out, s, 0.3, 0.5);
    s = nx(); at.push(s); I.taiko(oc, out, s, 0.8, 1);
    s = nx(); at.push(s); I.taiko(oc, out, s, 0.5, 0); I.taiko(oc, out, s + 0.25, 0.4, 0);
    s = nx(); at.push(s); I.kane(oc, out, s, 0.3);
    s = nx(); at.push(s); I.hyoshigi(oc, out, s, 0.4); I.hyoshigi(oc, out, s + 0.3, 0.4);
    s = nx(); at.push(s); I.horagai(oc, out, s, 1.4, 0.35, 55);
    s = nx(); at.push(s);
    const w = I.windLoop(oc, out, s);
    w.gain.gain.setValueAtTime(0, s);
    w.gain.gain.linearRampToValueAtTime(0.5, s + 1);
    w.gain.gain.setValueAtTime(0.5, s + 2.5);
    w.gain.gain.linearRampToValueAtTime(0, s + 3);
    w.stop(s + 3.1);
    const buf = await oc.startRendering();
    const d = buf.getChannelData(0);
    const pcm = new Int16Array(d.length);
    for (let i = 0; i < d.length; i++) pcm[i] = Math.max(-1, Math.min(1, d[i])) * 32767;
    const head = new DataView(new ArrayBuffer(44));
    const ws = (o, x) => [...x].forEach((c, i) => head.setUint8(o + i, c.charCodeAt(0)));
    ws(0, 'RIFF'); head.setUint32(4, 36 + pcm.byteLength, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, 1, true); head.setUint32(24, sr, true);
    head.setUint32(28, sr * 2, true); head.setUint16(32, 2, true); head.setUint16(34, 16, true); ws(36, 'data'); head.setUint32(40, pcm.byteLength, true);
    const bytes = new Uint8Array(44 + pcm.byteLength);
    bytes.set(new Uint8Array(head.buffer), 0);
    bytes.set(new Uint8Array(pcm.buffer), 44);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { b64: btoa(bin), names, at };
  });
  writeFileSync(`${OUT}/sfx-samples.wav`, Buffer.from(fx.b64, 'base64'));
  writeFileSync(`${OUT}/sfx-samples.json`, JSON.stringify(fx.names.map((n, i) => ({ name: n, at: +fx.at[i].toFixed(2) })), null, 1));
  note(`   ${OUT}/sfx-samples.wav（${fx.names.map((n, i) => `${fx.at[i].toFixed(1)}s ${n}`).join('・')}）`);
  await ctx.close();
}

// ---------------------------------------------------------------- flow：画面の流れと実際の出力

async function speechLog(page) {
  return page.evaluate(() => window.__speechLog ?? []);
}
async function readEnter(page) {
  for (let i = 0; i < 40; i++) {
    const u = await page.evaluate(() => window.__game.ui);
    if (!u || u.kind !== 'script' || u.choices.length) return u;
    await page.keyboard.press('Enter');
    await sleep(700);
  }
  return page.evaluate(() => window.__game.ui);
}
async function choose(page, id) {
  await page.locator(`.g-choice[data-id="${id}"]`).waitFor({ state: 'visible' });
  await sleep(450);
  await page.locator(`.g-choice[data-id="${id}"]`).click();
  await sleep(300);
}
async function waitCineDone(page, what, timeout = 300000) {
  await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'attached', timeout });
  const id = await page.locator('.g-layer[data-kind="cine"]').getAttribute('data-cine');
  await markAt(page, `演出 ${what}（${id}）始め`);
  await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached', timeout });
  await markAt(page, `演出 ${what} 終わり`);
  return id;
}

async function partFlow() {
  note('== flow：タイトル → 冒頭 → 城下を歩く → ミュート → 軍議 → 出陣 → 合戦 → 帰還（描画の省略 ?render=manual・実時間・偽の speechSynthesis）');
  const { page, ctx } = await openPage({ fakeSpeech: true });
  const before = await probe(page);
  check('flow タイトル：利用者の操作の前は AudioContext を作らない（locked）', before.state === 'locked', before.state);
  // 本物のクリック：はじめから（歴史分岐）
  await page.locator('button[data-id="new:ieyasu1570"]').waitFor({ state: 'visible' });
  await sleep(500);
  const tStart = await markAt(page, 'タイトルの「はじめから」');
  await page.locator('button[data-id="new:ieyasu1570"]').click();
  await page.waitForFunction(() => window.__audio.probe.state === 'running', null, POLL);
  const recOk = await page.evaluate(() => window.__audio.startRecord());
  const recT = await page.evaluate(() => Math.round(performance.now()));
  note(`   音の取り込み（MediaRecorder・マスターの後）開始：${recOk}`);
  await waitCineDone(page, '章の冒頭');
  const tExplore = await markAt(page, '城下（操作の開始）');
  // 本物の W で 6 秒歩く → 3 秒止まる
  const st0 = (await probe(page)).sfx.footsteps;
  await page.keyboard.down('KeyW');
  await sleep(6000);
  await page.keyboard.up('KeyW');
  const st1 = (await probe(page)).sfx.footsteps;
  const tStop = await markAt(page, '止まった');
  await sleep(3000);
  const st2 = (await probe(page)).sfx.footsteps;
  check('flow 足音：歩くと鳴り、止まると鳴らない', st1 - st0 >= 6 && st2 - st1 <= 1, `歩いた 6 秒 ${st1 - st0} 歩・止まった 3 秒 ${st2 - st1} 歩`);
  // メニューを開いてミュート（本物の M とクリック）
  await page.keyboard.press('KeyM');
  await page.locator('.g-sound input[data-id="mute"]').waitFor({ state: 'visible' });
  await sleep(400);
  await page.locator('.g-sound input[data-id="mute"]').click();
  const tMute = await markAt(page, 'ミュート');
  await sleep(2000);
  await page.locator('.g-sound input[data-id="mute"]').click();
  const tUnmute = await markAt(page, 'ミュートを外す');
  // 音量の調整（BGM のつまみを本物のマウスで左端へ）
  const bgm = page.locator('.g-sound input[data-id="bgm"]');
  const box = await bgm.boundingBox();
  await page.mouse.click(box.x + 2, box.y + box.height / 2);
  const bgmVal = await page.evaluate(() => window.__audio.probe.settings.bgm);
  const stored = await page.evaluate(() => localStorage.getItem('koto-sengoku/3d-audio'));
  check('flow 音量のつまみ（本物のクリック）：BGM を下げ、koto-sengoku/3d-audio に書く', bgmVal <= 0.1 && stored && JSON.parse(stored).bgm === bgmVal, `bgm ${bgmVal} 保存 ${stored}`);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  await sleep(1500);
  await page.keyboard.press('Escape');
  await sleep(500);
  // 忠勝と話す（開発用の口）→ 行送り（本物の Enter）→ 軍議を開く（本物のクリック）
  await markAt(page, '忠勝と話す');
  await page.evaluate(() => window.__game.talk('tadakatsu'));
  await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, POLL);
  let u = await readEnter(page);
  await choose(page, 'open_council');
  await page.waitForFunction(() => window.__game.screen === 'council', null, POLL);
  const tCouncil = await markAt(page, '軍議');
  u = await readEnter(page);
  await sleep(2500);
  await choose(page, u?.choices?.includes('policy_oda') ? 'policy_oda' : u.choices[0]);
  u = await readEnter(page);
  if (u?.choices?.includes('confirm_policy')) await choose(page, 'confirm_policy');
  await page.waitForFunction(() => window.__game.screen === 'explore', null, POLL);
  const tMuster = await markAt(page, '軍議の後（支度）');
  // 約束に答えた支度の状態（直接状態変更）→ 城門の手前へ（開発用の口）→ 本物の W で城門へ
  await page.evaluate(() => window.__game.setIeyasuPhase('muster', 'oda', undefined, { answerPledge: true }));
  await sleep(800);
  const g = await page.evaluate(() => window.__game.cast.find((c) => c.id === 'gate'));
  await page.evaluate(([x, z]) => window.__game.teleport(x, z, Math.PI), [g.x, g.z + 4.5]);
  await sleep(300);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, POLL);
  await page.keyboard.up('KeyW');
  u = await readEnter(page);
  await choose(page, 'depart');
  await waitCineDone(page, '出陣');
  // 合戦：本物のクリックで始める
  await page.waitForFunction(() => window.__battle?.active && window.__battle.ui.modal === 'briefing' && document.querySelector('.b-primary') && !document.querySelector('.b-primary.off'), null, POLL);
  const tBrief = await markAt(page, '合戦の説明');
  await sleep(600);
  await page.locator('.b-primary').click();
  const tBattle = await markAt(page, '合戦の始め');
  await sleep(14000);
  // 能力（本物のキー：1 で本陣を選び F）
  await page.keyboard.press('Digit1');
  await sleep(300);
  await page.keyboard.press('KeyF');
  await markAt(page, '能力（1 → F）');
  await sleep(4000);
  // ×2（本物のクリック）
  await page.locator('.b-seg', { hasText: '×2' }).click();
  const tX2 = await markAt(page, '×2');
  await sleep(10000);
  const tX2end = await markAt(page, '×2 終わり');
  // 斬り合いの間の刃の音の制限：斬り合いが始まるまで早送り（待つ間だけ）→ 実時間 8 秒（×1。本物のクリック）
  await page.locator('.b-seg', { hasText: '×1' }).click();
  const eng = await page.evaluate(() => {
    const s = window.__battle.state;
    const n = () => s.units.filter((u) => u.status === 'ready' && u.engagedWith).length;
    for (let i = 0; i < 240 && n() < 4 && !s.result; i++) window.__battle.fastForward(0.5);
    return { engaged: n(), t: s.t };
  });
  note(`   斬り合いまで早送り：斬り合っている部隊 ${eng.engaged}（合戦の時刻 ${eng.t.toFixed(1)} 秒）`);
  const tMelee = await markAt(page, '斬り合い（×1・実時間）');
  await sleep(8000);
  const tMeleeEnd = await markAt(page, '斬り合い 終わり');
  // 全軍撤退（本物のクリック・確かめ）
  await page.locator('.b-allret').click();
  await page.locator('.b-primary.danger').waitFor({ state: 'visible' });
  await sleep(500);
  await page.locator('.b-primary.danger').click();
  const tRet = await markAt(page, '全軍撤退');
  await sleep(3000);
  // 結果まで早送り（待つ間だけ）
  await page.evaluate(() => {
    for (let i = 0; i < 400 && !window.__battle.state.result; i++) window.__battle.fastForward(1);
  });
  await markAt(page, '結果（早送りの後）');
  await page.locator('.b-primary', { hasText: '続ける' }).waitFor({ state: 'visible' });
  await sleep(1500);
  await page.locator('.b-primary', { hasText: '続ける' }).click();
  await waitCineDone(page, '帰還');
  const tAfter = await markAt(page, '戦後の城下');
  await sleep(5000);
  const tEnd = await markAt(page, '終わり');
  const b64 = await page.evaluate(() => window.__audio.stopRecord());
  if (b64) {
    writeFileSync(`${OUT}/flow.webm`, Buffer.from(b64, 'base64'));
    note(`   音のファイル ${OUT}/flow.webm（${(statSync(`${OUT}/flow.webm`).size / 1e6).toFixed(2)} MB。取り込みの始めはページの時刻 ${recT} ms）`);
    const env = await envelope(page, b64);
    writeFileSync(`${OUT}/flow-envelope.json`, JSON.stringify(env));
    note(`   取った音を読み戻した：${env.sec.toFixed(1)} 秒・一番長い無音 ${env.longestSilenceSec} 秒（${env.longestSilenceAt} 秒から。ミュートの 2 秒を含む）`);
  }
  await page.evaluate(() => (window.__meterOn = false));
  const m = await meter(page);
  const sp = await speechLog(page);
  const pr = await probe(page);
  writeFileSync(`${OUT}/flow-meter.json`, JSON.stringify({ marks, recT, meter: m }, null, 0));
  writeFileSync(`${OUT}/flow-speech.json`, JSON.stringify(sp, null, 1));
  writeFileSync(`${OUT}/flow-probe.json`, JSON.stringify(pr, null, 1));

  // ---- まとめ
  const S = (a, b) => stats(m, a, b);
  const sections = [
    ['冒頭', tStart + 1500, tExplore],
    ['城下を歩く', tExplore + 1000, tStop],
    ['ミュート中', tMute + 400, tUnmute - 100],
    ['ミュートを外した後', tUnmute + 600, tUnmute + 1400],
    ['軍議', tCouncil + 800, tMuster - 200],
    ['合戦 ×1', tBattle + 1000, tX2],
    ['合戦 ×2', tX2 + 500, tX2end],
    ['合戦 斬り合い', tMelee + 300, tMeleeEnd],
    ['戦後の城下', tAfter + 1000, tEnd],
  ];
  for (const [name, a, b] of sections) note(`   区間「${name}」：${JSON.stringify(S(a, b))}`);
  const scenes = [];
  for (const r of m) if (!scenes.length || scenes[scenes.length - 1].music !== r.music) scenes.push({ t: r.t, music: r.music, screen: r.screen, cine: r.cine });
  note(`   曲の移り変わり：${scenes.map((s) => `${((s.t - tStart) / 1000).toFixed(1)}s ${s.music}（${s.cine ?? s.screen}）`).join(' → ')}`);
  const mt = S(tMute + 400, tUnmute - 100);
  check('flow ミュート：マスターの後の音が 0（RMS・最大値とも 0.0005 未満）', mt.n > 5 && mt.max < 0.0005 && mt.peak < 0.0005, JSON.stringify(mt));
  const um = S(tUnmute + 600, tUnmute + 1400);
  check('flow ミュートを外すと音が戻る', um.mean > 0.005, JSON.stringify(um));
  const want = [['冒頭', 'town'], ['城下を歩く', 'town'], ['軍議', 'crisis'], ['合戦 ×1', 'battle'], ['合戦 ×2', 'battle'], ['戦後の城下', 'town']];
  for (const [name, song] of want) {
    const sec = sections.find((s) => s[0] === name);
    const st = S(sec[1], sec[2]);
    check(`flow 「${name}」：曲 ${song} が鳴り、音が出ている（RMS の平均 > 0.005）`, st.music.includes(song) && st.mean > 0.005, JSON.stringify(st));
  }
  check('flow 冒頭：急報（使者）で危機の曲へ', m.some((r) => r.cine?.includes('envoys_arrive') && r.music === 'crisis'), '');
  check('flow 出陣の演出：合戦の曲', m.some((r) => r.cine?.startsWith('departure') && r.music === 'battle'), '');
  // 重ならない：2 曲が鳴っている（フェードの間）のは 1 回あたり 1.3 秒まで
  let over = 0;
  let worst = 0;
  let start = -1;
  for (const r of m) {
    if (r.audible.length > 1) {
      if (start < 0) start = r.t;
      worst = Math.max(worst, r.t - start);
      over++;
    } else start = -1;
  }
  check('flow 切り替えで重ならない：2 曲が同時に鳴るのはフェードの間（1 回 1.3 秒まで）だけ・3 曲は無い', worst <= 1300 && !m.some((r) => r.audible.length > 2), `重なりの最長 ${worst} ms・記録の行 ${over}`);
  const steps = m[m.length - 1].steps;
  note(`   効果音の数：足音 ${steps}・荷の作業 ${m[m.length - 1].cargo}・きしみ ${m[m.length - 1].creaks}・刃 ${m[m.length - 1].clashes}・矢 ${m[m.length - 1].arrows}・出来事の太鼓 ${m[m.length - 1].cues}`);
  check('flow 合戦：刃・矢の音が出て、1 秒あたり 6 まで', (() => {
    const b = m.filter((r) => r.battle);
    let mx = 0;
    for (let i = 0; i < b.length; i++) {
      const j = b.findIndex((r) => r.t >= b[i].t + 1000);
      if (j < 0) break;
      mx = Math.max(mx, b[j].clashes + b[j].arrows - (b[i].clashes + b[i].arrows));
    }
    const mel = m.filter((r) => r.t >= tMelee && r.t <= tMeleeEnd);
    const clashN = mel.length ? mel[mel.length - 1].clashes - mel[0].clashes : 0;
    note(`   合戦の刃・矢：1 秒あたりの最大 ${mx}・斬り合いの 8 秒の刃の音 ${clashN}`);
    return b.length > 0 && b[b.length - 1].clashes + b[b.length - 1].arrows > 0 && mx <= 6 && clashN > 0;
  })());
  note(`   曲：描いた輪 ${pr.music.ready.join('・')}（描くのにかかった合計 ${pr.music.renderMs} ms）・輪で鳴らし始めた回数 ${pr.music.loops}・描き終わるまでの予約 ${pr.music.scheduled}・捨てた（遅れた）${pr.music.dropped}・タイマーの最大の間 ${pr.music.maxGapMs} ms`);
  const firstLoop = m.find((r) => r.mode === 'loop');
  note(`   描いた輪へ移った時刻：はじめからの ${firstLoop ? ((firstLoop.t - tStart) / 1000).toFixed(1) : '－'} 秒`);
  // 声
  const spoken = sp.filter((e) => e.ev === 'speak');
  note(`   声（偽の speechSynthesis）：読んだ ${spoken.length}・止めた ${sp.filter((e) => e.ev === 'cancel').length}・重なり ${sp.filter((e) => e.ev === 'overlap').length}`);
  for (const e of spoken) note(`     読み「${e.text}」（高さ ${e.pitch}・速さ ${e.rate}・字幕「${e.cap}」）`);
  check('flow 声：同時に 2 人が話さない（重なり 0）', sp.every((e) => e.ev !== 'overlap'));
  check('flow 声：冒頭の使者・忠勝・家康の台詞を読んだ（読みはかな）', ['とくがわどのにも', 'あるじは', 'との、ぐんぎ', 'みなを集めよ'].every((k) => spoken.some((e) => e.text.includes(k))));
  check('flow 声：出陣の台詞・全軍撤退の掛け声を読んだ', spoken.some((e) => e.text.includes('しゅつじん')) && spoken.some((e) => e.text.startsWith('ひけ')));
  check('flow 声：読んだ時、同じ台詞の字幕が出ていた', spoken.every((e) => !!e.cap));
  const duckRows = m.filter((r) => r.ducked);
  check('flow ダッキング：声の間は BGM を下げた', duckRows.length > 0, `下げていた記録の行 ${duckRows.length}`);
  await ctx.close();
}

// ---------------------------------------------------------------- interrupt：アプリの切り替え・スキップ・タイトルへ

async function partInterrupt() {
  note('== interrupt：アプリの切り替え（ページの中で visibilitychange を起こす）・演出のスキップ（本物の Esc）・会話の途中にタイトルへ（本物の M・クリック）（描画の省略・偽の speechSynthesis）');
  const { page, ctx } = await openPage({ fakeSpeech: true });
  await page.locator('button[data-id="new:ieyasu1570"]').waitFor({ state: 'visible' });
  await sleep(500);
  await page.locator('button[data-id="new:ieyasu1570"]').click();
  await page.waitForFunction(() => (window.__speechLog ?? []).some((e) => e.ev === 'speak' && e.text.includes('とくがわどのにも')), null, POLL);
  await sleep(300);
  const setVis = (v) => page.evaluate((v) => {
    Object.defineProperty(document, 'visibilityState', { get: () => v, configurable: true });
    Object.defineProperty(document, 'hidden', { get: () => v === 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, v);
  const nSpeak = async () => (await speechLog(page)).filter((e) => e.ev === 'speak').length;
  const tHide = await markAt(page, '隠れた（visibilitychange）');
  await setVis('hidden');
  await sleep(1500);
  const hid = await page.evaluate(() => ({ state: window.__audio.probe.state, ctx: window.__audio.sys.engine.ctx.state, cine: window.__game.cine?.paused, level: window.__audio.level() }));
  const sp1 = await speechLog(page);
  check('interrupt 隠れたら AudioContext を止め、声を止め、演出も一時停止', hid.state === 'paused' && hid.ctx === 'suspended' && hid.cine === true && sp1.some((e) => e.ev === 'cancel' && e.t >= tHide - 50), JSON.stringify(hid));
  const n0 = await nSpeak();
  const sched0 = (await probe(page)).music.scheduled;
  const tShow = await markAt(page, '戻った');
  await setVis('visible');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await sleep(2500);
  const back = await page.evaluate(() => ({ state: window.__audio.probe.state, cine: window.__game.cine?.paused, sched: window.__audio.probe.music.scheduled, dropped: window.__audio.probe.music.dropped }));
  const m1 = await meter(page);
  const after = stats(m1, tShow + 800, tShow + 2400);
  check('interrupt 戻ると音が戻る（演出は止めたまま。声は読み直さない・たまった音を鳴らさない）', back.state === 'running' && back.cine === true && (await nSpeak()) === n0 && after.mean > 0.005 && back.sched - sched0 < 120, JSON.stringify({ back, after, newNotes: back.sched - sched0 }));
  // 本物の Space で再開 → 次の声の字幕 → 本物の Esc でスキップ
  await page.keyboard.press('Space');
  await page.waitForFunction((n) => (window.__speechLog ?? []).filter((e) => e.ev === 'speak').length > n, n0, POLL);
  await sleep(400);
  const tSkip = await markAt(page, 'スキップ（Esc）');
  await page.keyboard.press('Escape');
  await page.locator('.g-layer[data-kind="cine"]').waitFor({ state: 'detached' });
  await sleep(1500);
  const sp2 = await speechLog(page);
  const cancelled = sp2.some((e) => e.ev === 'cancel' && e.t >= tSkip && e.t <= tSkip + 500);
  const later = sp2.filter((e) => e.ev === 'speak' && e.t > tSkip + 50);
  check('interrupt 演出をスキップすると、読んでいた声を止め、後から読まない', cancelled && later.length === 0, JSON.stringify({ cancelled, later: later.map((e) => e.text) }));
  check('interrupt スキップの後は城下の曲', (await probe(page)).music.current === 'town');
  // 会話の途中にメニューからタイトルへ
  await page.evaluate(() => window.__game.talk('tadakatsu'));
  await page.waitForFunction(() => window.__game.ui?.kind === 'script', null, POLL);
  // 表にある行（声のある行）まで Enter で送る
  for (let i = 0; i < 12; i++) {
    const sp = await speechLog(page);
    if (sp.some((e) => e.ev === 'speak' && e.t > tSkip + 1000)) break;
    const u = await page.evaluate(() => window.__game.ui);
    if (!u || u.kind !== 'script' || u.choices.length) break;
    await page.keyboard.press('Enter');
    await sleep(700);
  }
  const spoke = (await speechLog(page)).filter((e) => e.ev === 'speak' && e.t > tSkip + 1000);
  note(`   会話で読んだ：${spoke.map((e) => e.text).join(' / ') || 'なし'}`);
  await page.keyboard.press('KeyM');
  await page.locator('.g-layer[data-kind="menu"] button[data-id="title"]').waitFor({ state: 'visible' });
  await sleep(500);
  await page.locator('.g-layer[data-kind="menu"] button[data-id="title"]').click();
  await page.locator('.g-layer[data-kind="confirm"] button[data-id="title"]').waitFor({ state: 'visible' });
  await sleep(500);
  const tTitle = await markAt(page, 'タイトルへ（確かめ）');
  await page.locator('.g-layer[data-kind="confirm"] button[data-id="title"]').click();
  await page.waitForFunction(() => window.__game.ui?.kind === 'title', null, POLL);
  await sleep(4500);
  const sp3 = await speechLog(page);
  const m2 = await meter(page);
  const quiet = stats(m2, tTitle + 3000, tTitle + 4000);
  note(`   タイトルへ戻った後の音の大きさ（0.5 秒ごと）：${[0, 500, 1000, 1500, 2000, 2500, 3000, 3500].map((d) => stats(m2, tTitle + d, tTitle + d + 500).mean).join(' ')}`);
  check('interrupt 会話の途中にタイトルへ：声は止まったまま（読み直さない）・タイトルは曲なし（フェードの後は無音）', !sp3.some((e) => e.ev === 'speak' && e.t > tTitle) && (await probe(page)).music.audible.length === 0 && quiet.max < 0.002, JSON.stringify({ quiet, cancels: sp3.filter((e) => e.ev === 'cancel').length }));
  writeFileSync(`${OUT}/interrupt-meter.json`, JSON.stringify({ marks, meter: m2, speech: sp3 }));
  await ctx.close();
}

// ---------------------------------------------------------------- video：音付きの実際のプレイ映像

async function partVideo() {
  const VIEW = { width: 844, height: 390 };
  const SEC = Number(process.env.VIDEO_SEC || 75);
  note(`== video：音付きの実際のプレイ映像（最初の約 ${SEC} 秒。描画あり ?q=low・${VIEW.width}×${VIEW.height}。画面の流しと Web Audio の出力を同じ実行で同時に取る）`);
  const { page, ctx } = await openPage({ ...VIEW, query: '?q=low' });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (f) => {
    frames.push({ ts: f.metadata.timestamp * 1000, data: f.data });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await page.locator('button[data-id="new:ieyasu1570"]').waitFor({ state: 'visible' });
  await sleep(800);
  const wall0 = Date.now();
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
  await sleep(1500);
  // 本物のクリック：はじめから。音はこの操作で有効になる → すぐ取り込みを始める
  await page.locator('button[data-id="new:ieyasu1570"]').click();
  await page.waitForFunction(() => window.__audio.probe.state === 'running', null, POLL);
  const recEpoch = await page.evaluate(() => {
    window.__audio.startRecord();
    return performance.timeOrigin + performance.now();
  });
  note(`   音の取り込みの始め：画面の流しの始めの ${((recEpoch - wall0) / 1000).toFixed(2)} 秒後`);
  // 冒頭が終わるまで（通常速度。描画が重いので実時間より長くかかる）、または SEC - 20 秒まで
  const deadline = wall0 + (SEC - 20) * 1000;
  while (Date.now() < deadline) {
    const open = await page.evaluate(() => !!document.querySelector('.g-layer[data-kind="cine"]'));
    if (!open && (await page.evaluate(() => window.__game.screen)) === 'explore') break;
    await sleep(500);
  }
  note(`   冒頭の後（または時間切れ）：画面 ${await page.evaluate(() => window.__game.screen)}・${((Date.now() - wall0) / 1000).toFixed(1)} 秒`);
  // 城下を本物の W で歩く（残りの時間）
  await page.keyboard.down('KeyW');
  while (Date.now() < wall0 + (SEC - 6) * 1000) await sleep(300);
  await page.keyboard.up('KeyW');
  await sleep(4000);
  await cdp.send('Page.stopScreencast');
  const wall1 = Date.now();
  const b64 = await page.evaluate(() => window.__audio.stopRecord());
  await page.evaluate(() => (window.__meterOn = false));
  const m = await meter(page);
  const pr = await probe(page);
  writeFileSync(`${OUT}/video-meter.json`, JSON.stringify(m));
  writeFileSync(`${OUT}/video-audio.webm`, Buffer.from(b64, 'base64'));
  const env = await envelope(page, b64);
  writeFileSync(`${OUT}/video-envelope.json`, JSON.stringify(env));
  const loud = env.rms.filter((r) => r > 0.005).length;
  note(`   取った音を読み戻した：${env.sec.toFixed(1)} 秒・音のある 0.5 秒の区間 ${loud}/${env.rms.length}・一番長い無音 ${env.longestSilenceSec} 秒（${env.longestSilenceAt} 秒から）`);
  check('video 取った音：途切れが 1.5 秒未満（描画が止まっても BGM が鳴り続ける）', env.longestSilenceSec < 1.5, `一番長い無音 ${env.longestSilenceSec} 秒`);
  note(`   画面の流しのコマ ${frames.length}・実時間 ${((wall1 - wall0) / 1000).toFixed(1)} 秒・ページの中の記録 ${m.length} 行（100 ms ごとの予定。描画の重さでタイマーが遅れた）・タイマーの最大の間 ${pr.music.maxGapMs} ms`);
  note(`   曲：描いた輪 ${pr.music.ready.join('・')}（描くのに ${pr.music.renderMs} ms）・輪で鳴らした回数 ${pr.music.loops}・描き終わるまでの予約 ${pr.music.scheduled}・捨てた ${pr.music.dropped}`);
  // 映像（25 コマ／秒。コマは届いた時刻のとおりに並べる）
  const FPS = 25;
  const vfile = `${OUT}/video-only.webm`;
  const sorted = frames.sort((a, b) => a.ts - b.ts);
  const n = Math.ceil((wall1 - wall0) / (1000 / FPS));
  await new Promise((res, rej) => {
    const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', '-vf', `scale=${VIEW.width}:${VIEW.height}`, '-c:v', 'libvpx', '-b:v', '1500k', '-deadline', 'good', '-cpu-used', '4', '-auto-alt-ref', '0', '-pix_fmt', 'yuv420p', vfile], { stdio: ['pipe', 'inherit', 'inherit'] });
    ff.on('exit', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`))));
    ff.stdin.on('error', () => {});
    (async () => {
      let j = 0;
      for (let i = 0; i < n; i++) {
        const at = wall0 + (i * 1000) / FPS;
        while (j + 1 < sorted.length && sorted[j + 1].ts <= at) j++;
        const f = sorted[j];
        if (!f.buf) f.buf = Buffer.from(f.data, 'base64');
        if (!ff.stdin.write(f.buf)) await new Promise((r) => ff.stdin.once('drain', r));
      }
      ff.stdin.end();
    })();
  });
  // 音を同じ時刻に合わせて重ねる（音は取り込みの始め＝ recEpoch から）
  const off = ((recEpoch - wall0) / 1000).toFixed(3);
  const out = `${OUT}/play-first-minute.webm`;
  await new Promise((res, rej) => {
    const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', vfile, '-itsoffset', off, '-i', `${OUT}/video-audio.webm`, '-map', '0:v', '-map', '1:a', '-c', 'copy', out], { stdio: ['ignore', 'inherit', 'inherit'] });
    ff.on('exit', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`))));
  });
  note(`   音付きの映像 ${out}（${(statSync(out).size / 1e6).toFixed(1)} MB・${(n / FPS).toFixed(1)} 秒。音は ${off} 秒から）`);
  check('video 映像の間に音が出ていた（取った音の 0.5 秒の区間の 8 割以上で RMS > 0.005）', loud >= env.rms.length * 0.8, `${loud}/${env.rms.length}`);
  await ctx.close();
}

// ---------------------------------------------------------------- prod：本番ビルド（CSP の下）で音が出ること

async function partProd() {
  const { createServer } = await import('node:http');
  const { existsSync, readFileSync } = await import('node:fs');
  const { extname, join, normalize, resolve } = await import('node:path');
  const DIST = resolve(process.env.DIST || 'dist-proto3d');
  const PORT = Number(process.env.PORT || 8614);
  const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'";
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary' };
  note(`== prod：本番ビルド（${DIST}）を CSP の下で。開発用の口は無いので、AudioContext をページの外から包んで（出力の手前に測りを足すだけ）大きさを測る`);
  if (!existsSync(join(DIST, 'index.html'))) throw new Error(`${DIST}/index.html が無い`);
  const missing = [];
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(DIST, path === '/' ? 'index.html' : path));
    if (!file.startsWith(DIST) || !existsSync(file)) {
      missing.push(path);
      res.writeHead(404, { 'content-security-policy': CSP });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'content-security-policy': CSP, 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(PORT, r));
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    const C = window.AudioContext;
    window.__ctxs = [];
    window.AudioContext = class extends C {
      constructor(o) {
        super(o);
        window.__ctxs.push(this);
        this.__an = super.createAnalyser();
        this.__an.fftSize = 2048;
      }
    };
    const orig = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dst, ...rest) {
      const c = this.context;
      if (c && c.__an && dst === c.destination && this !== c.__an) orig.call(this, c.__an);
      return orig.call(this, dst, ...rest);
    };
    window.__level = () => {
      const c = window.__ctxs[0];
      if (!c) return null;
      const b = new Float32Array(2048);
      c.__an.getFloatTimeDomainData(b);
      let s = 0;
      for (const v of b) s += v * v;
      return { state: c.state, t: c.currentTime, rms: Math.sqrt(s / b.length) };
    };
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/?q=low`);
  await page.locator('button[data-id="new:ieyasu1570"]').waitFor({ state: 'visible', timeout: 600000 });
  const before = await page.evaluate(() => window.__ctxs.length);
  await sleep(800);
  await page.locator('button[data-id="new:ieyasu1570"]').click();
  const levels = [];
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    levels.push(await page.evaluate(() => window.__level()));
  }
  const csp = await page.evaluate(() => window.__csp);
  const loud = levels.filter((l) => l && l.rms > 0.005).length;
  note(`   大きさ（1 秒ごと）：${levels.map((l) => (l ? l.rms.toFixed(3) : '-')).join(' ')}`);
  check('prod 「はじめから」の前は AudioContext を作らない', before === 0, `${before}`);
  check('prod 押した後に音が出る（20 秒のうち 15 回以上 RMS > 0.005）', loud >= 15, `${loud}/20`);
  check('prod CSP の違反・ページの誤り・読めなかったファイルが無い', csp.length === 0 && errs.length === 0 && missing.length === 0, JSON.stringify({ csp, errs: errs.slice(0, 3), missing: missing.slice(0, 5) }));
  await ctx.close();
  server.close();
}

try {
  if (PARTS.includes('prod')) await partProd();
  if (PARTS.includes('songs')) await partSongs();
  if (PARTS.includes('flow')) await partFlow();
  if (PARTS.includes('interrupt')) await partInterrupt();
  if (PARTS.includes('video')) await partVideo();
} catch (e) {
  failed++;
  note(`NG 例外：${e instanceof Error ? e.stack : String(e)}`);
} finally {
  writeFileSync(`${OUT}/summary.txt`, lines.join('\n') + '\n');
  await browser.close();
}
note(failed ? `NG ${failed} 件` : 'すべて OK');
process.exit(failed ? 1 : 0);
