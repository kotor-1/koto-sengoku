/**
 * 声（暫定）：端末の日本語読み上げ（Web Speech API の speechSynthesis）で、台詞の表の短い台詞だけを読む。
 *
 * - 端末に依存する：日本語の声が無い端末では声を出さない（字幕だけ）。status が 'no_japanese'・'unsupported' になる。
 * - 読むのは音声用の読み（readings.ts）。表示の文と言葉は同じ。
 * - 1 度に 1 人だけ：読む前に必ず前の声を止める（cancel）。古い声を後からまとめて鳴らさない（待ち行列を作らない）。
 * - 台詞を送る・スキップする・別の場面へ移る・アプリを切り替える・ミュートすると止める（stop）。
 * - 声の間は BGM を下げる（engine.duck）。止めた・終わった・誤り・知らせが来ないとき（長さの見込み＋2 秒）に戻す。
 * - 合戦の倍速でも、声の高さ・速さは変えない（話し手ごとの値だけ）。
 */
import type { AudioEngine } from './engine';
import { profileOf, readingFor } from './readings';
import type { TimerLike } from './music';
import { browserTimer } from './music';

/** 読み上げの口（ブラウザの speechSynthesis の使う所だけ。テストでは偽物を渡す） */
export interface SpeechLike {
    speak(u: UtteranceLike): void;
    cancel(): void;
    getVoices(): VoiceLike[];
    readonly speaking?: boolean;
    readonly pending?: boolean;
    addEventListener?(type: 'voiceschanged', fn: () => void): void;
}
export interface VoiceLike {
    name: string;
    lang: string;
    localService?: boolean;
    default?: boolean;
}
export interface UtteranceLike {
    text: string;
    lang: string;
    voice: VoiceLike | null;
    pitch: number;
    rate: number;
    volume: number;
    onstart: (() => void) | null;
    onend: (() => void) | null;
    onerror: ((e?: unknown) => void) | null;
}

export type VoiceStatus = 'unknown' | 'unsupported' | 'no_japanese' | 'ready';

export interface VoiceLineLike {
    id: string;
    speaker: string;
    text: string;
}

/** 男性の声らしい名前（端末に複数の日本語の声があるときに先に選ぶ。無ければ最初の日本語の声） */
const PREFER = ['otoya', 'ichiro', 'keita', 'daichi', 'naoki', 'hattori', 'male', '男性'];

export interface VoiceOptions {
    synth: SpeechLike | null;
    makeUtterance: (text: string) => UtteranceLike;
    timers?: TimerLike;
}

export class VoicePlayer {
    private gen = 0;
    private voice: VoiceLike | null = null;
    private _status: VoiceStatus = 'unknown';
    private guard: unknown = null;
    /** 今読んでいる台詞の id（終われば null） */
    speakingId: string | null = null;
    /** 確かめ用：読んだ台詞（新しい順に 30 件まで）と、止めた回数 */
    readonly log: { id: string; text: string; reading: string; speaker: string; pitch: number; rate: number; volume: number; at: number }[] = [];
    readonly stats = { spoken: 0, stopped: 0, refused: 0 };
    private readonly timers: TimerLike;

    constructor(
        private readonly engine: AudioEngine,
        private readonly opts: VoiceOptions,
    ) {
        this.timers = opts.timers ?? browserTimer;
        this.pickVoice();
        try {
            opts.synth?.addEventListener?.('voiceschanged', () => this.pickVoice());
        } catch {
            // 知らせが無い端末もある（読むときに選び直す）
        }
        // アプリを切り替えた：声を止める（戻っても読み直さない）
        engine.onPause((paused) => {
            if (paused) this.stop();
        });
        engine.store.onChange((s) => {
            if (s.muted || s.voice <= 0) this.stop();
        });
    }

    get status(): VoiceStatus {
        return this._status;
    }

    private pickVoice(): void {
        const synth = this.opts.synth;
        if (!synth) {
            this._status = 'unsupported';
            return;
        }
        let list: VoiceLike[] = [];
        try {
            list = synth.getVoices() ?? [];
        } catch {
            list = [];
        }
        const ja = list.filter((v) => /^ja([-_]|$)/i.test(v.lang ?? ''));
        if (ja.length === 0) {
            // 声の一覧が後から届く端末がある（届くまでは 'unknown'。一覧があって日本語が無ければ 'no_japanese'）
            this.voice = null;
            this._status = list.length > 0 ? 'no_japanese' : this._status === 'ready' ? 'no_japanese' : 'unknown';
            return;
        }
        const named = ja.find((v) => PREFER.some((p) => v.name.toLowerCase().includes(p)));
        this.voice = named ?? ja.find((v) => v.localService) ?? ja[0]!;
        this._status = 'ready';
    }

    /** 今読めるか（日本語の声がある・ミュートでない・有効にした後・アプリを切り替えていない） */
    canSay(): boolean {
        const s = this.engine.settings;
        if (this._status !== 'ready') this.pickVoice();
        return !!this.opts.synth && this._status === 'ready' && !s.muted && s.voice > 0 && !this.engine.held && this.engine.state !== 'locked' && this.engine.state !== 'unavailable';
    }

    /**
     * 台詞を読む（前の声は止める）。読めない（日本語の声が無い・ミュート・有効にする前・アプリを切り替えている）ときは何もしない。
     * 返りは読み始めたか。
     */
    say(line: VoiceLineLike): boolean {
        this.stop();
        const synth = this.opts.synth;
        const s = this.engine.settings;
        if (!synth || !this.canSay()) {
            this.stats.refused++;
            return false;
        }
        const reading = readingFor(line);
        const p = profileOf(line.speaker);
        const g = ++this.gen;
        try {
            const u = this.opts.makeUtterance(reading);
            u.lang = 'ja-JP';
            u.voice = this.voice;
            u.pitch = p.pitch;
            u.rate = p.rate;
            u.volume = Math.min(1, s.voice);
            const end = () => {
                if (g !== this.gen) return;
                this.speakingId = null;
                this.clearGuard();
                this.engine.duck(false);
            };
            u.onstart = () => {
                if (g === this.gen) this.engine.duck(true);
            };
            u.onend = end;
            u.onerror = end;
            this.speakingId = line.id;
            // 始まりの知らせを待たずに下げる（端末によっては知らせが遅い）
            this.engine.duck(true);
            // 終わりの知らせが来ない端末のため：長さの見込み（1 文字 0.16 秒 ÷ 速さ）＋ 2 秒で戻す
            const est = ([...reading].length * 0.16) / Math.max(0.5, p.rate) + 2;
            this.guard = this.timers.set(end, est * 1000);
            synth.speak(u);
            this.stats.spoken++;
            this.log.unshift({ id: line.id, text: line.text, reading, speaker: line.speaker, pitch: p.pitch, rate: p.rate, volume: u.volume, at: Date.now() });
            if (this.log.length > 30) this.log.pop();
            return true;
        } catch (e) {
            console.error(e);
            this.speakingId = null;
            this.engine.duck(false);
            return false;
        }
    }

    /** 今の声を止める（読んでいなくても、端末の読み上げの待ちを空にする） */
    stop(): void {
        this.gen++;
        this.clearGuard();
        const wasSpeaking = this.speakingId !== null;
        this.speakingId = null;
        try {
            const synth = this.opts.synth;
            if (synth && (wasSpeaking || synth.speaking || synth.pending)) synth.cancel();
        } catch {
            // 止められなくても進める
        }
        if (wasSpeaking) this.stats.stopped++;
        this.engine.duck(false);
    }

    private clearGuard(): void {
        if (this.guard !== null) {
            this.timers.clear(this.guard);
            this.guard = null;
        }
    }

    /**
     * 利用者の操作の中で 1 度だけ呼ぶ：端末によっては、最初の読み上げを操作の中で始めないと、後から読めない。
     * 空の文を音量 0 で読んでおく。
     */
    prime(): void {
        const synth = this.opts.synth;
        if (!synth) return;
        try {
            const u = this.opts.makeUtterance('');
            u.volume = 0;
            u.lang = 'ja-JP';
            synth.speak(u);
        } catch {
            // 読めなくても進める
        }
    }
}

/** ブラウザの speechSynthesis（無ければ null） */
export function browserSpeech(): { synth: SpeechLike | null; makeUtterance: (text: string) => UtteranceLike } {
    const g = globalThis as { speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance };
    if (!g.speechSynthesis || !g.SpeechSynthesisUtterance) {
        return { synth: null, makeUtterance: () => ({ text: '', lang: '', voice: null, pitch: 1, rate: 1, volume: 1, onstart: null, onend: null, onerror: null }) };
    }
    const U = g.SpeechSynthesisUtterance;
    return {
        synth: g.speechSynthesis as unknown as SpeechLike,
        makeUtterance: (text) => new U(text) as unknown as UtteranceLike,
    };
}
