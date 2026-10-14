/**
 * 音のテスト用の偽物：AudioContext（ノードの作成・つなぎ・予約を記録するだけ。音は出さない）と speechSynthesis、
 * 声の音声ファイルの読み込み（FakeFetch。Version 28）。時刻（currentTime）はテストが進める。
 */
import type { PageLike } from '../proto3d/src/audio/engine';
import type { SpeechLike, UtteranceLike, VoiceLike } from '../proto3d/src/audio/voice';
import type { TimerLike } from '../proto3d/src/audio/music';

export class FakeParam {
    value: number;
    calls: { m: string; v: number; t: number }[] = [];
    constructor(v = 0) {
        this.value = v;
    }
    setValueAtTime(v: number, t: number) {
        this.calls.push({ m: 'set', v, t });
        this.value = v;
        return this;
    }
    linearRampToValueAtTime(v: number, t: number) {
        this.calls.push({ m: 'lin', v, t });
        this.value = v;
        return this;
    }
    exponentialRampToValueAtTime(v: number, t: number) {
        this.calls.push({ m: 'exp', v, t });
        this.value = v;
        return this;
    }
    setTargetAtTime(v: number, t: number, _tc: number) {
        this.calls.push({ m: 'target', v, t });
        this.value = v;
        return this;
    }
    cancelScheduledValues(t: number) {
        this.calls.push({ m: 'cancel', v: this.value, t });
        return this;
    }
}

export class FakeNode {
    outs: FakeNode[] = [];
    /** つないだ先の記録（切り離しても消えない） */
    readonly everOuts: FakeNode[] = [];
    constructor(
        readonly ctx: FakeAudioContext,
        readonly kind: string,
    ) {
        ctx.nodes.push(this);
    }
    connect(n: FakeNode | FakeParam) {
        if (n instanceof FakeNode) {
            this.outs.push(n);
            this.everOuts.push(n);
        }
        return n;
    }
    disconnect() {
        this.outs = [];
        this.ctx.disconnected++;
    }
}

export class FakeSource extends FakeNode {
    startedAt: number | null = null;
    stoppedAt: number | null = null;
    offset = 0;
    buffer: FakeBuffer | null = null;
    onended: (() => void) | null = null;
    start(t = 0, offset = 0) {
        this.startedAt = t;
        this.offset = offset;
        this.ctx.starts.push({ kind: this.kind, t, node: this });
    }
    stop(t = 0) {
        this.stoppedAt = t;
    }
    /** 鳴り終えた（本物と同じく終わりの知らせを呼ぶ） */
    end() {
        this.onended?.();
    }
}

export class FakeBuffer {
    readonly data: Float32Array;
    constructor(
        readonly numberOfChannels: number,
        readonly length: number,
        readonly sampleRate: number,
    ) {
        this.data = new Float32Array(length);
    }
    get duration() {
        return this.length / this.sampleRate;
    }
    getChannelData() {
        return this.data;
    }
}

export class FakeAudioContext {
    currentTime = 0;
    sampleRate = 8000;
    state: 'suspended' | 'running' | 'closed' = 'suspended';
    nodes: FakeNode[] = [];
    starts: { kind: string; t: number; node: FakeNode }[] = [];
    disconnected = 0;
    resumes = 0;
    suspends = 0;
    readonly destination = new FakeNode(this, 'destination');
    private listeners: (() => void)[] = [];
    /** false なら resume() は始まらずに待つ（start() で始める。重い処理の間に始まりの知らせが来ない時のまね） */
    autoResume = true;
    private waiting: (() => void)[] = [];
    resume() {
        this.resumes++;
        if (!this.autoResume) return new Promise<void>((r) => this.waiting.push(r));
        this.state = 'running';
        for (const l of this.listeners) l();
        return Promise.resolve();
    }
    /** 待たせていた resume() を始める */
    start() {
        this.state = 'running';
        for (const l of this.listeners) l();
        for (const r of this.waiting.splice(0)) r();
    }
    /** 端末が止めた（iOS の interrupted のまね） */
    interrupt() {
        this.state = 'suspended';
        for (const l of this.listeners) l();
    }
    suspend() {
        this.suspends++;
        this.state = 'suspended';
        for (const l of this.listeners) l();
        return Promise.resolve();
    }
    addEventListener(_t: string, fn: () => void) {
        this.listeners.push(fn);
    }
    createGain() {
        return Object.assign(new FakeNode(this, 'gain'), { gain: new FakeParam(1) });
    }
    createOscillator() {
        return Object.assign(new FakeSource(this, 'osc'), { type: 'sine', frequency: new FakeParam(440), detune: new FakeParam(0) });
    }
    createBufferSource() {
        return Object.assign(new FakeSource(this, 'buffer'), { loop: false, playbackRate: new FakeParam(1) });
    }
    /** decodeAudioData を呼んだ回数・渡された中身の長さ（ほどく前に写しを渡しているか） */
    decodes: number[] = [];
    /** false なら decodeAudioData は待つ（decodeNow() で答える） */
    autoDecode = true;
    private decodeWaiting: (() => void)[] = [];
    /** 偽の音声ファイル（fakeVoiceBytes）をほどく：先頭の 8 バイトの秒数の長さの音にする。読めなければ失敗（知らせの関数と約束の両方で答える） */
    decodeAudioData(bytes: ArrayBuffer, ok?: (b: AudioBuffer) => void, bad?: (e: unknown) => void): Promise<AudioBuffer> {
        this.decodes.push(bytes.byteLength);
        const sec = bytes.byteLength >= 8 ? new DataView(bytes).getFloat64(0) : NaN;
        const run = (res: (b: AudioBuffer) => void, rej: (e: unknown) => void) => {
            if (!Number.isFinite(sec) || sec <= 0) {
                const e = new Error('ほどけない');
                bad?.(e);
                rej(e);
                return;
            }
            const buf = new FakeBuffer(1, Math.round(sec * this.sampleRate), this.sampleRate) as unknown as AudioBuffer;
            ok?.(buf);
            res(buf);
        };
        return new Promise((res, rej) => {
            if (this.autoDecode) run(res, rej);
            else this.decodeWaiting.push(() => run(res, rej));
        });
    }
    /** 待たせていた decodeAudioData に答える */
    decodeNow() {
        for (const f of this.decodeWaiting.splice(0)) f();
    }
    createBiquadFilter() {
        return Object.assign(new FakeNode(this, 'filter'), { type: 'lowpass', frequency: new FakeParam(350), Q: new FakeParam(1), gain: new FakeParam(0) });
    }
    createDynamicsCompressor() {
        return Object.assign(new FakeNode(this, 'comp'), { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() });
    }
    createStereoPanner() {
        return Object.assign(new FakeNode(this, 'pan'), { pan: new FakeParam(0) });
    }
    createAnalyser() {
        return Object.assign(new FakeNode(this, 'analyser'), { fftSize: 2048, getFloatTimeDomainData: (a: Float32Array) => a.fill(0) });
    }
    createBuffer(ch: number, n: number, sr: number) {
        return new FakeBuffer(ch, n, sr);
    }
    /** 時間を進める（秒） */
    advance(sec: number) {
        if (this.state === 'running') this.currentTime += sec;
    }
}

export function fakeContext(): { ctx: FakeAudioContext; create: () => AudioContext } {
    const ctx = new FakeAudioContext();
    return { ctx, create: () => ctx as unknown as AudioContext };
}

/** 手で進めるタイマー（ms の時計） */
export class FakeTimers implements TimerLike {
    now = 0;
    private seq = 0;
    private q = new Map<number, { at: number; fn: () => void }>();
    set(fn: () => void, ms: number) {
        const id = ++this.seq;
        this.q.set(id, { at: this.now + ms, fn });
        return id;
    }
    clear(h: unknown) {
        this.q.delete(h as number);
    }
    /** ms だけ進め、期限の来た物を順に呼ぶ */
    run(ms: number) {
        const end = this.now + ms;
        for (;;) {
            let next: [number, { at: number; fn: () => void }] | null = null;
            for (const e of this.q) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
            if (!next) break;
            this.q.delete(next[0]);
            this.now = next[1].at;
            next[1].fn();
        }
        this.now = end;
    }
    get size() {
        return this.q.size;
    }
}

export class FakePage implements PageLike {
    vis = true;
    foc = true;
    private ls = new Map<string, (() => void)[]>();
    visible() {
        return this.vis;
    }
    focused() {
        return this.foc;
    }
    on(type: string, fn: () => void) {
        const a = this.ls.get(type) ?? [];
        a.push(fn);
        this.ls.set(type, a);
    }
    fire(type: string) {
        for (const f of this.ls.get(type) ?? []) f();
    }
    hide() {
        this.vis = false;
        this.fire('visibilitychange');
    }
    show() {
        this.vis = true;
        this.fire('visibilitychange');
    }
}

export class FakeUtterance implements UtteranceLike {
    lang = '';
    voice: VoiceLike | null = null;
    pitch = 1;
    rate = 1;
    volume = 1;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e?: unknown) => void) | null = null;
    constructor(public text: string) {}
}

/** 偽の speechSynthesis：読む待ち（queue）・読んだ物（spoken）・止めた数（cancels）。最大の待ちの長さ（maxQueue）を記録 */
export class FakeSynth implements SpeechLike {
    queue: FakeUtterance[] = [];
    spoken: FakeUtterance[] = [];
    cancels = 0;
    maxQueue = 0;
    throwOnSpeak = false;
    constructor(public voices: VoiceLike[] = [{ name: 'Kyoko', lang: 'ja-JP', localService: true }]) {}
    get speaking() {
        return this.queue.length > 0;
    }
    get pending() {
        return this.queue.length > 1;
    }
    speak(u: UtteranceLike) {
        if (this.throwOnSpeak) throw new Error('読めません');
        this.queue.push(u as FakeUtterance);
        this.maxQueue = Math.max(this.maxQueue, this.queue.length);
        if (u.text) this.spoken.push(u as FakeUtterance);
        if (this.queue.length === 1) u.onstart?.();
    }
    cancel() {
        this.cancels++;
        const q = this.queue;
        this.queue = [];
        // 本物と同じく、止めた発話にも終わり（誤り）の知らせが来る
        for (const u of q) u.onerror?.('canceled');
    }
    getVoices() {
        return this.voices;
    }
    /** 今読んでいる物を読み終える */
    finish() {
        const u = this.queue.shift();
        u?.onend?.();
        this.queue[0]?.onstart?.();
    }
}

/** 偽の音声ファイルの中身（先頭の 8 バイトに長さの秒数。FakeAudioContext.decodeAudioData がその長さの音にする） */
export function fakeVoiceBytes(sec: number, size = 64): ArrayBuffer {
    const b = new ArrayBuffer(Math.max(8, size));
    new DataView(b).setFloat64(0, sec);
    return b;
}

/**
 * 偽の fetch（音声ファイル）：頼まれた場所を記録し、答えはテストが出す（auto なら、すぐ secOf の長さの中身で答える）
 */
export class FakeFetch {
    readonly urls: string[] = [];
    readonly waiting: { url: string; resolve: (b: ArrayBuffer) => void; reject: (e: unknown) => void }[] = [];
    auto = false;
    constructor(public secOf: (url: string) => number = () => 2) {}
    readonly fetchBytes = (url: string): Promise<ArrayBuffer> => {
        this.urls.push(url);
        if (this.auto) return Promise.resolve(fakeVoiceBytes(this.secOf(url)));
        return new Promise((resolve, reject) => this.waiting.push({ url, resolve, reject }));
    };
    /** 待っている読み込みに答える（url を渡せばその場所だけ。fail なら失敗で） */
    answer(url?: string, fail = false) {
        for (const w of [...this.waiting]) {
            if (url !== undefined && !w.url.endsWith(url)) continue;
            this.waiting.splice(this.waiting.indexOf(w), 1);
            if (fail) w.reject(new Error('HTTP 404'));
            else w.resolve(fakeVoiceBytes(this.secOf(w.url)));
        }
    }
}

export function memoryStorage(init: Record<string, string> = {}) {
    const m = new Map(Object.entries(init));
    const writes: string[] = [];
    return {
        writes,
        map: m,
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => {
            writes.push(k);
            m.set(k, v);
        },
        removeItem: (k: string) => void m.delete(k),
    };
}
