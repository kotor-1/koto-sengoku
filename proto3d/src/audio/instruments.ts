/**
 * 楽器と効果音の合成（Web Audio。録音・既存の曲は使わない。すべてこのコードで作るオリジナルの音）。
 *
 * - 箏のようなはじく音：はじいた弦の物理のまねの合成（Karplus–Strong）を、音の高さごとに 1 回だけ AudioBuffer に書いて使い回す。
 * - 笛のような息の音（篠笛・尺八の気分）：正弦波＋三角波に、音の高さの帯の息の雑音、遅れて掛かるゆれ（ビブラート）、立ち上がりのしゃくり。
 * - 太鼓（大太鼓・締太鼓）・鉦・拍子木・法螺：正弦波の高さの落ち・雑音の帯で作る。
 * - 効果音：刃の当たり（金属の響き）・矢（風切り）・足音・風・荷の作業（木の当たり・俵の音）・木戸のきしみ。
 *
 * どの関数も (ctx, 出口, 鳴らす時刻 t, …) を受け取り、その時刻に予約する（AudioContext の時計）。鳴り終われば止まる。
 */

/** 決まった種の乱数（同じ音を作り直しても同じ形） */
export function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

const cache = new WeakMap<BaseAudioContext, { noise?: AudioBuffer; pink?: AudioBuffer; koto: Map<string, { buf: AudioBuffer; rate: number }> }>();
function store(ctx: BaseAudioContext) {
    let c = cache.get(ctx);
    if (!c) {
        c = { koto: new Map() };
        cache.set(ctx, c);
    }
    return c;
}

/** 白い雑音（2 秒。繰り返して使う） */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
    const c = store(ctx);
    if (c.noise) return c.noise;
    const n = Math.floor(ctx.sampleRate * 2);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    const r = rng(7);
    for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
    c.noise = b;
    return b;
}

/** 低い方が強い雑音（風。4 秒。端をつないでも切れ目が出ないよう、両端を少しずつ重ねる） */
export function pinkBuffer(ctx: BaseAudioContext): AudioBuffer {
    const c = store(ctx);
    if (c.pink) return c.pink;
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * 4);
    const b = ctx.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    const r = rng(11);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
        const w = r() * 2 - 1;
        b0 = 0.997 * b0 + w * 0.029;
        b1 = 0.985 * b1 + w * 0.032;
        b2 = 0.95 * b2 + w * 0.048;
        d[i] = (b0 + b1 + b2) * 2.2;
    }
    // つなぎ目：最後の 0.2 秒を始めへ重ねる
    const x = Math.floor(sr * 0.2);
    for (let i = 0; i < x; i++) {
        const k = i / x;
        d[i] = d[i] * k + d[n - x + i] * (1 - k);
    }
    c.pink = b;
    return b;
}

/** 箏の 1 本の弦（音の高さ midi・明るさ）の音の形を作る（1 回だけ） */
function kotoBuffer(ctx: BaseAudioContext, midi: number, bright: number): { buf: AudioBuffer; rate: number } {
    const key = `${midi}:${bright}`;
    const c = store(ctx);
    const hit = c.koto.get(key);
    if (hit) return hit;
    const sr = ctx.sampleRate;
    const f = midiToHz(midi);
    // 高い音ほど早く消える（低い音 2.6 秒・高い音 1.2 秒ほどで −60 dB）
    const t60 = Math.max(1.0, Math.min(2.8, 2.8 - (midi - 50) * 0.05));
    const dur = Math.min(3.2, t60 + 0.2);
    const n = Math.floor(sr * dur);
    const b = ctx.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    const N = Math.max(2, Math.floor(sr / f - 0.5));
    const line = new Float32Array(N);
    const r = rng(1000 + midi);
    // はじき：雑音を明るさに応じて丸め、はじく位置（弦の端から 1/7）の櫛で少し削る
    let prev = 0;
    for (let i = 0; i < N; i++) {
        prev += bright * (r() * 2 - 1 - prev);
        line[i] = prev;
    }
    const p = Math.max(1, Math.round(N / 7));
    const tmp = Float32Array.from(line);
    for (let i = 0; i < N; i++) line[i] = tmp[i]! - 0.6 * tmp[(i + p) % N]!;
    let mean = 0;
    for (let i = 0; i < N; i++) mean += line[i]!;
    mean /= N;
    let peak = 0;
    for (let i = 0; i < N; i++) {
        line[i] -= mean;
        peak = Math.max(peak, Math.abs(line[i]!));
    }
    const norm = peak > 0 ? 0.9 / peak : 1;
    for (let i = 0; i < N; i++) line[i] *= norm;
    const rho = Math.pow(0.001, 1 / (t60 * f));
    let idx = 0;
    for (let i = 0; i < n; i++) {
        const cur = line[idx]!;
        const nx = line[(idx + 1) % N]!;
        line[idx] = rho * 0.5 * (cur + nx);
        d[i] = cur;
        idx = (idx + 1) % N;
    }
    // 爪の当たり（ごく短いカチッ）
    const click = Math.floor(sr * 0.004);
    for (let i = 0; i < click; i++) d[i] += (r() * 2 - 1) * 0.35 * (1 - i / click);
    // 終わりを 30 ms で 0 へ
    const tail = Math.floor(sr * 0.03);
    for (let i = 0; i < tail; i++) d[n - 1 - i] *= i / tail;
    // 平均で半分の 1 サンプルの遅れ → 実際の高さ sr / (N + 0.5)。再生の速さで合わせる
    const v = { buf: b, rate: f / (sr / (N + 0.5)) };
    c.koto.set(key, v);
    return v;
}

/** 決まった長さの音を止める時刻（予約） */
function env(g: AudioParam, t: number, peak: number, attack: number, hold: number, release: number): number {
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + attack);
    if (hold > 0) g.setValueAtTime(peak, t + attack + hold);
    g.setTargetAtTime(0.0001, t + attack + hold, release / 4);
    return t + attack + hold + release + 0.05;
}

/** 箏（はじく）。bend は押し手（半音の数。鳴らした後に上げる） */
export function koto(ctx: BaseAudioContext, out: AudioNode, t: number, midi: number, vel = 0.6, opts: { bright?: number; dur?: number; bend?: number; pan?: number } = {}): void {
    const { buf, rate } = kotoBuffer(ctx, Math.round(midi), opts.bright ?? 0.55);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(rate, t);
    if (opts.bend) {
        src.playbackRate.setValueAtTime(rate, t + 0.12);
        src.playbackRate.linearRampToValueAtTime(rate * Math.pow(2, opts.bend / 12), t + 0.32);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel, t);
    let end = t + buf.duration / rate;
    if (opts.dur !== undefined && opts.dur + 0.25 < buf.duration) {
        // 指で止める（ゆっくり消す）
        g.gain.setValueAtTime(vel, t + opts.dur);
        g.gain.setTargetAtTime(0.0001, t + opts.dur, 0.08);
        end = Math.min(end, t + opts.dur + 0.5);
    }
    src.connect(g);
    connectPan(ctx, g, out, opts.pan);
    src.start(t);
    src.stop(end);
}

function connectPan(ctx: BaseAudioContext, from: AudioNode, out: AudioNode, pan?: number): void {
    if (pan && typeof (ctx as { createStereoPanner?: unknown }).createStereoPanner === 'function') {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        from.connect(p);
        p.connect(out);
    } else from.connect(out);
}

/** 笛（篠笛のような明るい息の音。breathy で尺八のような息の多い低い音） */
export function flute(ctx: BaseAudioContext, out: AudioNode, t: number, midi: number, dur: number, vel = 0.4, opts: { breathy?: boolean; scoop?: boolean; pan?: number } = {}): void {
    const f = midiToHz(midi);
    const breathy = !!opts.breathy;
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    const scoop = opts.scoop !== false;
    for (const [o, mul] of [[o1, 1], [o2, breathy ? 1 : 2]] as const) {
        o.frequency.setValueAtTime(f * mul * (scoop ? (breathy ? 0.94 : 0.97) : 1), t);
        o.frequency.exponentialRampToValueAtTime(f * mul, t + (breathy ? 0.16 : 0.07));
    }
    // ゆれ：0.25 秒ほど後から
    const lfo = ctx.createOscillator();
    lfo.frequency.value = breathy ? 4.6 : 5.6;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f * (breathy ? 0.009 : 0.006), t + Math.min(dur, 0.45));
    lfo.connect(lg);
    lg.connect(o1.frequency);
    lg.connect(o2.frequency);
    const tone = ctx.createGain();
    const g2 = ctx.createGain();
    g2.gain.value = breathy ? 0.35 : 0.12;
    o1.connect(tone);
    o2.connect(g2);
    g2.connect(tone);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = breathy ? f * 3 : f * 6;
    tone.connect(lp);
    // 息の雑音（音の高さの帯）
    const nz = ctx.createBufferSource();
    nz.buffer = noiseBuffer(ctx);
    nz.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * (breathy ? 1.5 : 2);
    bp.Q.value = breathy ? 1.2 : 2.5;
    const ng = ctx.createGain();
    nz.connect(bp);
    bp.connect(ng);
    const g = ctx.createGain();
    lp.connect(g);
    ng.connect(g);
    const atk = breathy ? 0.12 : 0.05;
    const rel = breathy ? 0.35 : 0.15;
    const end = env(g.gain, t, vel, atk, Math.max(0, dur - atk), rel);
    // 息は立ち上がりで強く、後は薄く
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(breathy ? 0.9 : 0.5, t + atk * 0.7);
    ng.gain.setTargetAtTime(breathy ? 0.32 : 0.12, t + atk, 0.08);
    connectPan(ctx, g, out, opts.pan);
    for (const o of [o1, o2, lfo]) {
        o.start(t);
        o.stop(end);
    }
    nz.start(t, (t * 0.37) % 1.5);
    nz.stop(end);
}

/** 大太鼓（size 1 が大きい・0 で締太鼓のような小さい） */
export function taiko(ctx: BaseAudioContext, out: AudioNode, t: number, vel = 0.8, size = 1, pan?: number): void {
    const big = size >= 0.5;
    const f0 = big ? 105 - 25 * size : 340;
    const f1 = big ? 58 - 12 * size : 250;
    const dec = big ? 0.55 + 0.4 * size : 0.16;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + (big ? 0.14 : 0.05));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.004);
    g.gain.setTargetAtTime(0.0001, t + 0.01, dec / 4.5);
    o.connect(g);
    // 皮の当たり（短い雑音）
    const nz = ctx.createBufferSource();
    nz.buffer = noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    f.type = big ? 'lowpass' : 'bandpass';
    f.frequency.value = big ? 700 : 1900;
    f.Q.value = big ? 0.7 : 1.4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * (big ? 0.5 : 0.7), t);
    ng.gain.setTargetAtTime(0.0001, t, big ? 0.025 : 0.012);
    nz.connect(f);
    f.connect(ng);
    const mix = ctx.createGain();
    g.connect(mix);
    ng.connect(mix);
    connectPan(ctx, mix, out, pan);
    o.start(t);
    o.stop(t + dec + 0.1);
    nz.start(t, (t * 0.71) % 1.7);
    nz.stop(t + 0.15);
}

/** 鉦（すり鉦・当たり鉦のような小さな金属の音） */
export function kane(ctx: BaseAudioContext, out: AudioNode, t: number, vel = 0.25, pan?: number): void {
    const g = ctx.createGain();
    g.gain.value = vel;
    connectPan(ctx, g, out, pan);
    for (const [fr, d, a] of [[1180, 0.32, 1], [2790, 0.2, 0.6], [4130, 0.12, 0.4]] as const) {
        const o = ctx.createOscillator();
        o.frequency.value = fr;
        const og = ctx.createGain();
        og.gain.setValueAtTime(a, t);
        og.gain.setTargetAtTime(0.0001, t, d / 4);
        o.connect(og);
        og.connect(g);
        o.start(t);
        o.stop(t + d + 0.05);
    }
}

/** 拍子木（乾いた木の音） */
export function hyoshigi(ctx: BaseAudioContext, out: AudioNode, t: number, vel = 0.3, pan?: number): void {
    const g = ctx.createGain();
    g.gain.value = vel;
    connectPan(ctx, g, out, pan);
    for (const fr of [1870, 2640]) {
        const o = ctx.createOscillator();
        o.frequency.value = fr;
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.6, t);
        og.gain.setTargetAtTime(0.0001, t, 0.012);
        o.connect(og);
        og.connect(g);
        o.start(t);
        o.stop(t + 0.09);
    }
}

/** 法螺（低い息の太い音。formant の帯で貝の響き） */
export function horagai(ctx: BaseAudioContext, out: AudioNode, t: number, dur = 1.8, vel = 0.4, midi = 55): void {
    const f = midiToHz(midi);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.9, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.25);
    o.frequency.setValueAtTime(f, t + dur * 0.75);
    o.frequency.exponentialRampToValueAtTime(f * 0.86, t + dur);
    const sum = ctx.createGain();
    for (const [fr, q, a] of [[620, 5, 1], [1150, 6, 0.55], [2400, 8, 0.2]] as const) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = fr;
        bp.Q.value = q;
        const bg = ctx.createGain();
        bg.gain.value = a;
        o.connect(bp);
        bp.connect(bg);
        bg.connect(sum);
    }
    const nz = ctx.createBufferSource();
    nz.buffer = noiseBuffer(ctx);
    nz.loop = true;
    const nbp = ctx.createBiquadFilter();
    nbp.type = 'bandpass';
    nbp.frequency.value = 900;
    nbp.Q.value = 1;
    const ng = ctx.createGain();
    ng.gain.value = 0.12;
    nz.connect(nbp);
    nbp.connect(ng);
    ng.connect(sum);
    const g = ctx.createGain();
    sum.connect(g);
    g.connect(out);
    const end = env(g.gain, t, vel * 2.2, 0.22, Math.max(0, dur - 0.22), 0.35);
    o.start(t);
    o.stop(end);
    nz.start(t);
    nz.stop(end);
}

// ================================================================ 効果音

/** 刃の当たり（金属の響き＋短い雑音）。r は 0〜1 の揺らぎ */
export function clash(ctx: BaseAudioContext, out: AudioNode, t: number, vel = 0.35, r = 0.5, pan?: number): void {
    const g = ctx.createGain();
    g.gain.value = vel;
    connectPan(ctx, g, out, pan);
    const base = 1900 + r * 900;
    for (const [mul, d, a] of [[1, 0.28, 0.5], [1.51, 0.2, 0.4], [2.27, 0.14, 0.3], [3.1, 0.09, 0.2]] as const) {
        const o = ctx.createOscillator();
        o.frequency.value = base * mul;
        const og = ctx.createGain();
        og.gain.setValueAtTime(a, t);
        og.gain.setTargetAtTime(0.0001, t, d / 4);
        o.connect(og);
        og.connect(g);
        o.start(t);
        o.stop(t + d + 0.05);
    }
    const nz = ctx.createBufferSource();
    nz.buffer = noiseBuffer(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.8, t);
    ng.gain.setTargetAtTime(0.0001, t, 0.012);
    nz.connect(hp);
    hp.connect(ng);
    ng.connect(g);
    nz.start(t, r * 1.5);
    nz.stop(t + 0.08);
}

/** 矢（風切りの音が過ぎ、遠くで当たる） */
export function arrow(ctx: BaseAudioContext, out: AudioNode, t: number, vel = 0.3, r = 0.5, pan?: number): void {
    const nz = ctx.createBufferSource();
    nz.buffer = noiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    const d = 0.22 + r * 0.1;
    bp.frequency.setValueAtTime(3200 + r * 800, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + d * 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + d);
    nz.connect(bp);
    bp.connect(g);
    connectPan(ctx, g, out, pan);
    nz.start(t, r * 1.6);
    nz.stop(t + d + 0.02);
    // 当たり（にぶい木の音）
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(240, t + d);
    o.frequency.exponentialRampToValueAtTime(110, t + d + 0.05);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.setValueAtTime(vel * 0.6, t + d);
    og.gain.setTargetAtTime(0.0001, t + d, 0.02);
    o.connect(og);
    connectPan(ctx, og, out, pan);
    o.start(t);
    o.stop(t + d + 0.12);
}

/** 足音（土の道。run は強く短い） */
export function footstep(ctx: BaseAudioContext, out: AudioNode, t: number, run: boolean, r = 0.5): void {
    const vel = (run ? 0.5 : 0.32) * (0.85 + r * 0.3);
    const nz = ctx.createBufferSource();
    nz.buffer = noiseBuffer(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = (run ? 1500 : 950) * (0.85 + r * 0.3);
    const bp = ctx.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = 120;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.006);
    g.gain.setTargetAtTime(0.0001, t + 0.012, run ? 0.022 : 0.03);
    nz.connect(lp);
    lp.connect(bp);
    bp.connect(g);
    g.connect(out);
    nz.start(t, r * 1.8);
    nz.stop(t + 0.16);
    // 踏んだ重み（低い短い音）
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.05);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vel * 0.5, t);
    og.gain.setTargetAtTime(0.0001, t, 0.015);
    o.connect(og);
    og.connect(out);
    o.start(t);
    o.stop(t + 0.1);
}

/** 荷の作業：木の当たり（kind 'knock'）・俵を置く（'thud'） */
export function cargo(ctx: BaseAudioContext, out: AudioNode, t: number, kind: 'knock' | 'thud', vel = 0.3, r = 0.5, pan?: number): void {
    const g = ctx.createGain();
    g.gain.value = vel;
    connectPan(ctx, g, out, pan);
    const o = ctx.createOscillator();
    const nz = ctx.createBufferSource();
    nz.buffer = noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    const og = ctx.createGain();
    const ng = ctx.createGain();
    if (kind === 'knock') {
        o.frequency.setValueAtTime(380 + r * 160, t);
        og.gain.setValueAtTime(0.7, t);
        og.gain.setTargetAtTime(0.0001, t, 0.018);
        f.type = 'bandpass';
        f.frequency.value = 1300;
        f.Q.value = 2;
        ng.gain.setValueAtTime(0.5, t);
        ng.gain.setTargetAtTime(0.0001, t, 0.008);
    } else {
        o.frequency.setValueAtTime(110, t);
        o.frequency.exponentialRampToValueAtTime(70, t + 0.08);
        og.gain.setValueAtTime(0.9, t);
        og.gain.setTargetAtTime(0.0001, t, 0.04);
        f.type = 'lowpass';
        f.frequency.value = 600;
        ng.gain.setValueAtTime(0.7, t);
        ng.gain.setTargetAtTime(0.0001, t, 0.03);
    }
    o.connect(og);
    og.connect(g);
    nz.connect(f);
    f.connect(ng);
    ng.connect(g);
    o.start(t);
    o.stop(t + 0.25);
    nz.start(t, r * 1.5);
    nz.stop(t + 0.25);
}

/** 木戸のきしみ（木の擦れる低いきしみが、少し高さを変えて続く） */
export function creak(ctx: BaseAudioContext, out: AudioNode, t: number, dur = 1.1, vel = 0.3): void {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(31, t);
    o.frequency.linearRampToValueAtTime(52, t + dur * 0.45);
    o.frequency.linearRampToValueAtTime(38, t + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 7;
    bp.frequency.setValueAtTime(650, t);
    bp.frequency.linearRampToValueAtTime(1150, t + dur * 0.5);
    bp.frequency.linearRampToValueAtTime(800, t + dur);
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.Q.value = 4;
    bp2.frequency.value = 2300;
    const g = ctx.createGain();
    o.connect(bp);
    o.connect(bp2);
    bp.connect(g);
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    bp2.connect(g2);
    g2.connect(g);
    const end = env(g.gain, t, vel * 3, 0.08, Math.max(0, dur - 0.3), 0.25);
    g.connect(out);
    o.start(t);
    o.stop(end);
}

/** 風（ずっと鳴らす。返りの stop で止める）。音量は gain で変える */
export function windLoop(ctx: BaseAudioContext, out: AudioNode, t: number): { gain: GainNode; stop(at: number): void } {
    const src = ctx.createBufferSource();
    src.buffer = pinkBuffer(ctx);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.Q.value = 0.8;
    // ゆっくり強くなったり弱くなったり（帯と音量を別の速さで）
    const l1 = ctx.createOscillator();
    l1.frequency.value = 0.07;
    const l1g = ctx.createGain();
    l1g.gain.value = 260;
    l1.connect(l1g);
    l1g.connect(lp.frequency);
    const l2 = ctx.createOscillator();
    l2.frequency.value = 0.113;
    const l2g = ctx.createGain();
    l2g.gain.value = 0.35;
    const body = ctx.createGain();
    body.gain.value = 0.65;
    l2.connect(l2g);
    l2g.connect(body.gain);
    src.connect(lp);
    lp.connect(body);
    const g = ctx.createGain();
    g.gain.value = 0;
    body.connect(g);
    g.connect(out);
    src.start(t);
    l1.start(t);
    l2.start(t);
    return {
        gain: g,
        stop(at: number) {
            for (const n of [src, l1, l2]) {
                try {
                    n.stop(at);
                } catch {
                    // 止め済み
                }
            }
        },
    };
}
