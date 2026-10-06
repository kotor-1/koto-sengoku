/**
 * BGM の再生：楽譜（songs.ts）を AudioContext の時計で先読みして予約する。
 *
 * - 時計：setTimeout（50 ms ごと）で起き、AudioContext の currentTime から LOOKAHEAD 秒先までの音を予約する（requestAnimationFrame は使わない）。
 *   描画のコマが遅くても、曲の速さは変わらない。
 * - 止まった後（アプリの切り替えで AudioContext を止めた・タイマーが遅れた）に、過ぎた音をまとめて鳴らさない：
 *   予約しそびれた音は捨て、次の小節の頭から続ける。
 * - 曲の切り替え：前の曲を短くフェードアウトして止め、新しい曲を少し後からフェードインする（同じ曲なら何もしない）。
 *   切り替え後に鳴り続けるのは 1 曲だけ（フェードの間の重なりは FADE_OUT 秒まで）。
 * - 声の間の BGM の下げ（ダッキング）は engine.ts の duck（BGM のバスの後ろ）。
 */
import type { AudioEngine } from './engine';
import { flute, hyoshigi, horagai, kane, koto, taiko } from './instruments';
import { SONGS, barEvents, barSeconds, type NoteEvent, type SongId } from './songs';

/**
 * 先読みの長さ（秒）。描画が重い端末（1 コマに 1 秒以上かかる検証のコンテナなど）でタイマーが遅れても、音が途切れないよう長めにとる。
 * 先に予約した音は曲ごとの音量（フェード）・ダッキング・ミュート・一時停止（AudioContext の停止）にそのまま従うので、長くても困らない。
 */
export const LOOKAHEAD = 2.0;
export const TICK_MS = 50;
export const FADE_IN = 0.6;
export const FADE_OUT = 0.8;
/** 切り替えの時、新しい曲を始めるまでの間（秒） */
export const SWITCH_GAP = 0.35;

export interface TimerLike {
    set(fn: () => void, ms: number): unknown;
    clear(h: unknown): void;
}
export const browserTimer: TimerLike = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** 1 回の再生（曲の切り替えごとに作る） */
interface Playing {
    id: SongId;
    gain: GainNode;
    /** 次に読む小節の番号と、その頭の時刻 */
    bar: number;
    nextBar: number;
    pending: { t: number; e: NoteEvent }[];
    /** フェードアウトの終わり（これを過ぎたら外す）。鳴らしている間は Infinity */
    endAt: number;
}

export type NotePlayer = (ctx: BaseAudioContext, out: AudioNode, t: number, e: NoteEvent) => void;

/** 楽器に渡す（既定） */
export const playNote: NotePlayer = (ctx, out, t, e) => {
    switch (e.inst) {
        case 'koto':
            koto(ctx, out, t, e.midi, e.vel, { dur: e.dur, ...(e.bend ? { bend: e.bend } : {}), ...(e.pan ? { pan: e.pan } : {}) });
            break;
        case 'fue':
            flute(ctx, out, t, e.midi + 12, e.dur, e.vel, { ...(e.pan ? { pan: e.pan } : {}) });
            break;
        case 'shaku':
            flute(ctx, out, t, e.midi, e.dur, e.vel, { breathy: true, ...(e.pan ? { pan: e.pan } : {}) });
            break;
        case 'taiko':
            taiko(ctx, out, t, e.vel, 1);
            break;
        case 'shime':
            taiko(ctx, out, t, e.vel, 0, 0.2);
            break;
        case 'kane':
            kane(ctx, out, t, e.vel, -0.3);
            break;
        case 'hyoshigi':
            hyoshigi(ctx, out, t, e.vel, 0.25);
            break;
        case 'horagai':
            horagai(ctx, out, t, e.dur, e.vel, e.midi);
            break;
    }
};

export class MusicPlayer {
    private playing: Playing | null = null;
    private readonly fading: Playing[] = [];
    /** 鳴らしたい曲（有効になる前・止めている間も覚える） */
    private want: SongId | null = null;
    private timer: unknown = null;
    /** 確かめ用：予約した音の数・捨てた（遅れた）音の数・曲を始めた回数 */
    readonly stats = { scheduled: 0, dropped: 0, starts: 0, switches: 0, maxGapMs: 0 };
    private lastTick = -1;

    constructor(
        private readonly engine: AudioEngine,
        private readonly timers: TimerLike = browserTimer,
        private readonly note: NotePlayer = playNote,
    ) {
        engine.onReady(() => this.sync());
        engine.onPause((paused) => {
            if (!paused) this.realign();
        });
    }

    /** 鳴らしたい曲（null で止める） */
    get wanted(): SongId | null {
        return this.want;
    }
    /** 今鳴らしている曲（フェードアウト中の曲は含めない） */
    get current(): SongId | null {
        return this.playing?.id ?? null;
    }
    /** 今音を出している曲の数（フェードアウト中を含む） */
    get audible(): SongId[] {
        return [...(this.playing ? [this.playing.id] : []), ...this.fading.map((f) => f.id)];
    }

    /** 曲を替える（同じ曲なら何もしない。null で止める） */
    play(id: SongId | null): void {
        if (id === this.want && (id === null || this.playing?.id === id || !this.engine.live)) return;
        this.want = id;
        this.sync();
    }

    /** 鳴らしたい曲に合わせる（有効になった時にも呼ぶ） */
    private sync(): void {
        const ctx = this.engine.ctx;
        if (!ctx || !this.engine.bgm) return;
        if (this.playing?.id === this.want) {
            this.ensureTimer();
            return;
        }
        const now = ctx.currentTime;
        if (this.playing) {
            this.fadeOut(this.playing, now);
            this.playing = null;
            this.stats.switches++;
        }
        if (this.want) {
            const gain = ctx.createGain();
            const start = now + (this.fading.length ? SWITCH_GAP : 0.05);
            gain.gain.setValueAtTime(0, now);
            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(1, start + FADE_IN);
            gain.connect(this.engine.bgm);
            this.playing = { id: this.want, gain, bar: 0, nextBar: start, pending: [], endAt: Infinity };
            this.stats.starts++;
        }
        this.ensureTimer();
        this.tick();
    }

    private fadeOut(p: Playing, now: number): void {
        const g = p.gain.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0, now + FADE_OUT);
        p.endAt = now + FADE_OUT + 0.05;
        // まだ予約していない音は捨てる（フェードの後に鳴らさない）
        p.pending = p.pending.filter((x) => x.t < p.endAt);
        this.fading.push(p);
    }

    private ensureTimer(): void {
        if (this.timer !== null) return;
        if (!this.playing && this.fading.length === 0) return;
        const loop = () => {
            this.timer = null;
            this.tick();
            if (this.playing || this.fading.length) this.timer = this.timers.set(loop, TICK_MS);
        };
        this.timer = this.timers.set(loop, TICK_MS);
    }

    /** 止まった後（再開）：過ぎた音を捨て、次の小節の頭を今より後にする */
    private realign(): void {
        const ctx = this.engine.ctx;
        if (!ctx) return;
        const now = ctx.currentTime;
        for (const p of [this.playing, ...this.fading]) {
            if (!p) continue;
            const before = p.pending.length;
            p.pending = p.pending.filter((x) => x.t >= now);
            this.stats.dropped += before - p.pending.length;
            if (p.nextBar < now) {
                const sec = barSeconds(SONGS[p.id]);
                const skip = Math.ceil((now - p.nextBar) / sec);
                p.bar += skip;
                p.nextBar += skip * sec;
            }
        }
    }

    /** 先読みして予約する（タイマーから。テストでは直接呼ぶ） */
    tick(): void {
        const ctx = this.engine.ctx;
        if (!ctx || !this.engine.live) return;
        const now = ctx.currentTime;
        const horizon = now + LOOKAHEAD;
        if (this.lastTick >= 0) this.stats.maxGapMs = Math.max(this.stats.maxGapMs, Math.round((now - this.lastTick) * 1000));
        this.lastTick = now;
        // フェードアウトの終わった曲を外す
        for (let i = this.fading.length - 1; i >= 0; i--) {
            const f = this.fading[i]!;
            if (now >= f.endAt) {
                try {
                    f.gain.disconnect();
                } catch {
                    // 外し済み
                }
                this.fading.splice(i, 1);
            }
        }
        for (const p of [this.playing, ...this.fading]) {
            if (!p) continue;
            // タイマーが大きく遅れた（裏に回った等）：過ぎた音をまとめて鳴らさない
            if (p.nextBar < now - 0.25) this.realign();
            if (p === this.playing) {
                const song = SONGS[p.id];
                const sec = barSeconds(song);
                const spb = 60 / song.bpm;
                while (p.nextBar <= horizon) {
                    for (const e of barEvents(song, p.bar)) p.pending.push({ t: p.nextBar + e.beat * spb, e });
                    p.bar++;
                    p.nextBar += sec;
                }
                p.pending.sort((a, b) => a.t - b.t);
            }
            while (p.pending.length && p.pending[0]!.t <= horizon) {
                const x = p.pending.shift()!;
                if (x.t < now - 0.03 || x.t >= p.endAt) {
                    this.stats.dropped++;
                    continue;
                }
                try {
                    this.note(ctx, p.gain, x.t, x.e);
                    this.stats.scheduled++;
                } catch (e) {
                    // 1 つの音を作れなくても曲は続ける
                    console.error(e);
                }
            }
        }
    }

    /** すべて止める（後片付け） */
    stopAll(): void {
        this.want = null;
        const ctx = this.engine.ctx;
        if (ctx && this.playing) this.fadeOut(this.playing, ctx.currentTime);
        this.playing = null;
    }
}
