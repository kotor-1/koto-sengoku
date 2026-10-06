/**
 * 音の土台：AudioContext を 1 つ持ち、マスター → BGM・声・効果音／環境音の 3 つのバスに分ける。
 *
 *   BGM バス（音量 × ダッキング）─┐
 *   声のバス ───────────────────┼→ マスター（ミュート）→ 圧縮（割れ止め）→ 測り（AnalyserNode）→ 出力
 *   効果音／環境音のバス ────────┘
 *
 * - 有効にする時：利用者の操作（タイトルの「はじめから」など、最初のタップ・クリック・キー）の中で unlock() を呼ぶ。
 *   それまでは AudioContext を作らない（作れない・始められない端末でも、進行は止めない：state は 'unavailable' のまま）。
 * - アプリの切り替え（visibilitychange・pagehide・blur）では AudioContext を一時停止（suspend）する。戻ったら（見えていて窓が前）再開する。
 *   一時停止の間は AudioContext の時計が止まるので、曲の先読みの予約（music.ts）はたまらない。止めた知らせ（onPause）で声を止める。
 * - 声（端末の読み上げ）は AudioContext を通らない（speechSynthesis）。声のバスは音量の値を持つだけで、voice.ts が読む。
 * - 時計は AudioContext の currentTime（描画のコマに比例しない）。
 */
import { AudioSettingsStore, type AudioSettings } from './settings';

export type EngineState = 'locked' | 'running' | 'paused' | 'unavailable';

/** アプリの切り替えの見張り先（テストでは偽物を渡す） */
export interface PageLike {
    visible(): boolean;
    focused(): boolean;
    on(type: 'visibilitychange' | 'pagehide' | 'pageshow' | 'blur' | 'focus', fn: () => void): void;
}

export interface EngineOptions {
    settings: AudioSettingsStore;
    /** AudioContext を作る（省けばブラウザの AudioContext。無ければ音なし） */
    createContext?: () => AudioContext;
    page?: PageLike | null;
}

/** ダッキング（声の間に BGM を下げる）の量 */
export const DUCK_LEVEL = 0.32;

export class AudioEngine {
    ctx: AudioContext | null = null;
    master: GainNode | null = null;
    bgm: GainNode | null = null;
    /** BGM のダッキング（bgm の後ろ） */
    duckGain: GainNode | null = null;
    voiceBus: GainNode | null = null;
    sfx: GainNode | null = null;
    analyser: AnalyserNode | null = null;
    private _state: EngineState = 'locked';
    /** 止めている理由（hidden・blur・pagehide）。空になったら再開 */
    private readonly holds = new Set<string>();
    private ducked = false;
    private readonly pauseListeners = new Set<(paused: boolean) => void>();
    private readonly readyListeners = new Set<() => void>();
    /** 最後の誤り（確かめ用） */
    lastError: string | null = null;

    constructor(private readonly opts: EngineOptions) {
        opts.settings.onChange(() => this.applySettings());
        const page = opts.page;
        if (page) {
            // 戻ったとき：見えていれば hidden を外し、窓が前なら blur を外す（窓の前後が分からない端末で、勝手に止めたままにしない）
            const sync = () => {
                this.setHold('hidden', !page.visible());
                if (page.focused()) this.setHold('blur', false);
            };
            page.on('visibilitychange', sync);
            page.on('blur', () => this.setHold('blur', true));
            page.on('focus', sync);
            page.on('pagehide', () => this.setHold('pagehide', true));
            page.on('pageshow', () => {
                this.setHold('pagehide', false);
                sync();
            });
        }
    }

    get state(): EngineState {
        return this._state;
    }
    get settings(): AudioSettings {
        return this.opts.settings.get();
    }
    get store(): AudioSettingsStore {
        return this.opts.settings;
    }
    /** 音を鳴らしてよいか（有効で、止めていない） */
    get live(): boolean {
        return this._state === 'running' && !!this.ctx;
    }
    /** 利用者の操作の中で resume() を呼び、まだ始まりの知らせ（Promise）が来ていない */
    private starting = false;
    /**
     * 音を予約してよいか：始まっている、または操作の中で始めている途中（止めていない）。
     * 始めている途中に予約した音は、始まった時刻から鳴る（「はじめから」の直後の重い処理の間も、最初の音を待たせない）
     */
    get canSchedule(): boolean {
        return !!this.ctx && this._state !== 'unavailable' && !this.held && (this.live || this.starting);
    }
    /** 今の時刻（秒。AudioContext の時計） */
    now(): number {
        return this.ctx?.currentTime ?? 0;
    }
    /** アプリの切り替えなどで止めている */
    get held(): boolean {
        return this.holds.size > 0;
    }

    /**
     * 利用者の操作の中で呼ぶ：AudioContext を作り（1 回だけ）、始める。何度呼んでもよい。
     * 作れない・始められないときも投げない（進行を止めない）。返りは今鳴らせるか。
     */
    unlock(): boolean {
        if (this._state === 'unavailable') return false;
        try {
            if (!this.ctx) this.build();
            const ctx = this.ctx!;
            if (!this.held && ctx.state !== 'running') {
                this.starting = true;
                const p = ctx.resume();
                // 始まったら知らせる（resume は非同期。始まる前に予約した音は、始まった時刻から鳴る）
                void Promise.resolve(p)
                    .then(() => this.refreshState())
                    .catch((e: unknown) => {
                        this.starting = false;
                        this.lastError = e instanceof Error ? e.message : String(e);
                    });
            }
            this.refreshState();
        } catch (e) {
            this.lastError = e instanceof Error ? e.message : String(e);
            this._state = 'unavailable';
            this.ctx = null;
            return false;
        }
        return this.live;
    }

    private build(): void {
        const make =
            this.opts.createContext ??
            (() => {
                const C = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
                if (!C) throw new Error('この端末では Web Audio を使えません');
                return new C({ latencyHint: 'interactive' });
            });
        const ctx = make();
        this.ctx = ctx;
        const master = ctx.createGain();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 10;
        comp.ratio.value = 4;
        comp.attack.value = 0.006;
        comp.release.value = 0.25;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        master.connect(comp);
        comp.connect(analyser);
        analyser.connect(ctx.destination);
        const bgm = ctx.createGain();
        const duck = ctx.createGain();
        bgm.connect(duck);
        duck.connect(master);
        const voice = ctx.createGain();
        voice.connect(master);
        const sfx = ctx.createGain();
        sfx.connect(master);
        this.master = master;
        this.bgm = bgm;
        this.duckGain = duck;
        this.voiceBus = voice;
        this.sfx = sfx;
        this.analyser = analyser;
        try {
            ctx.addEventListener?.('statechange', () => this.refreshState());
        } catch {
            // statechange が無くても困らない
        }
        this.applySettings(true);
    }

    private refreshState(): void {
        if (this._state === 'unavailable' || !this.ctx) return;
        const was = this._state;
        this._state = this.held ? 'paused' : this.ctx.state === 'running' ? 'running' : 'locked';
        if (this.ctx.state === 'running') this.starting = false;
        if (this._state === 'running' && was !== 'running') {
            for (const l of this.readyListeners) safe(l);
        }
    }

    /** 設定（ミュート・音量）をバスに当てる。immediate はすぐ（作った時） */
    applySettings(immediate = false): void {
        const ctx = this.ctx;
        if (!ctx || !this.master) return;
        const s = this.settings;
        const t = ctx.currentTime;
        const set = (p: AudioParam, v: number) => {
            if (immediate) {
                p.cancelScheduledValues(t);
                p.setValueAtTime(v, t);
            } else {
                p.cancelScheduledValues(t);
                p.setTargetAtTime(v, t, 0.03);
            }
        };
        set(this.master.gain, s.muted ? 0 : 1);
        set(this.bgm!.gain, s.bgm * s.bgm);
        set(this.voiceBus!.gain, s.voice);
        set(this.sfx!.gain, s.sfx * s.sfx);
        set(this.duckGain!.gain, this.ducked ? DUCK_LEVEL : 1);
    }

    /** 声の間は BGM を下げる（on）／戻す（off） */
    duck(on: boolean): void {
        if (this.ducked === on) return;
        this.ducked = on;
        const ctx = this.ctx;
        if (!ctx || !this.duckGain) return;
        const t = ctx.currentTime;
        const g = this.duckGain.gain;
        g.cancelScheduledValues(t);
        g.setTargetAtTime(on ? DUCK_LEVEL : 1, t, on ? 0.06 : 0.25);
    }
    get isDucked(): boolean {
        return this.ducked;
    }

    /** 止める理由を足す／外す。最初の理由で一時停止し、すべて外れたら再開する */
    setHold(reason: string, on: boolean): void {
        const before = this.held;
        if (on) this.holds.add(reason);
        else this.holds.delete(reason);
        const after = this.held;
        if (before === after) return;
        const ctx = this.ctx;
        if (ctx && this._state !== 'unavailable') {
            try {
                if (after) void Promise.resolve(ctx.suspend()).catch(() => {});
                else void Promise.resolve(ctx.resume()).then(() => this.refreshState()).catch(() => {});
            } catch (e) {
                this.lastError = e instanceof Error ? e.message : String(e);
            }
        }
        this.refreshState();
        for (const l of this.pauseListeners) safe(() => l(after));
    }

    /** 止めた（true）・再開した（false）の知らせ（声を止める・曲の予約を今に合わせる） */
    onPause(fn: (paused: boolean) => void): () => void {
        this.pauseListeners.add(fn);
        return () => this.pauseListeners.delete(fn);
    }
    /** 鳴らせるようになった（有効にした・再開した） */
    onReady(fn: () => void): () => void {
        this.readyListeners.add(fn);
        return () => this.readyListeners.delete(fn);
    }

    /** 確かめ用：マスターの後の音の大きさ（RMS。0〜1）と最大値 */
    level(): { rms: number; peak: number } {
        const a = this.analyser;
        if (!a) return { rms: 0, peak: 0 };
        const buf = new Float32Array(a.fftSize);
        a.getFloatTimeDomainData(buf);
        let sum = 0;
        let peak = 0;
        for (const v of buf) {
            sum += v * v;
            const m = Math.abs(v);
            if (m > peak) peak = m;
        }
        return { rms: Math.sqrt(sum / buf.length), peak };
    }
}

function safe(fn: () => void): void {
    try {
        fn();
    } catch (e) {
        console.error(e);
    }
}

/** ブラウザのページの見張り（visibilitychange・pagehide・blur） */
export function browserPage(): PageLike | null {
    if (typeof document === 'undefined' || typeof window === 'undefined') return null;
    return {
        visible: () => document.visibilityState !== 'hidden',
        focused: () => (typeof document.hasFocus === 'function' ? document.hasFocus() : true),
        on: (type, fn) => {
            if (type === 'visibilitychange') document.addEventListener(type, fn);
            else window.addEventListener(type, fn);
        },
    };
}
