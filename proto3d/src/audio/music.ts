/**
 * BGM の再生。2 つのやり方を持つ：
 *
 * 1. 描いた輪（既定）：楽譜（songs.ts）を、ゲームと同じ楽器のコードで OfflineAudioContext に 1 周分描き（音の処理の側で描くので、
 *    描画の重さに関わらない）、AudioBufferSourceNode の繰り返し（loopStart〜loopEnd）で鳴らす。鳴らす時計は音の処理の側だけなので、
 *    描画のコマが遅い・止まる（読み込み・合戦の画面の組み立て）間も途切れない。曲ごとに 1 回だけ描く（有効になった後、要る曲から順に）。
 *    輪の終わりで鳴り残る音（箏の余韻など）は、輪の頭に重ねて継ぎ目を消す。
 * 2. 先読みの予約（描き終わるまでと、OfflineAudioContext の無い端末）：setTimeout（50 ms ごと）で起き、AudioContext の currentTime から
 *    LOOKAHEAD 秒先までの音を予約する（requestAnimationFrame は使わない）。描き終わったら、同じ曲の同じ位置から描いた輪へ短く受け渡す。
 *
 * - 時計は AudioContext の時刻（描画のコマに比例しない）。止まった後（アプリの切り替え・タイマーの遅れ）に、過ぎた音をまとめて鳴らさない。
 * - 曲の切り替え：前の曲を短くフェードアウトして止め、新しい曲を少し後からフェードインする（同じ曲なら何もしない）。
 *   切り替え後に鳴り続けるのは 1 曲だけ（フェードの間の重なりは FADE_OUT 秒まで）。
 * - 声の間の BGM の下げ（ダッキング）は engine.ts の duck（BGM のバスの後ろ）。
 */
import type { AudioEngine } from './engine';
import { flute, hyoshigi, horagai, kane, koto, taiko } from './instruments';
import { SONGS, barAt, barEvents, barSeconds, type NoteEvent, type SongId } from './songs';

/**
 * 先読みの長さ（秒。描き終わるまでの予約）。描画が重い端末でタイマーが遅れても、音が途切れないよう長めにとる。
 * 先に予約した音は曲ごとの音量（フェード）・ダッキング・ミュート・一時停止（AudioContext の停止）にそのまま従うので、長くても困らない。
 */
export const LOOKAHEAD = 2.0;
/**
 * 曲の最初の予約の先読み（秒）。曲を始めた直後は、重い処理（冒頭の最初の 3D の画の組み立て・合戦の画面の組み立て）で
 * 主のスレッドが止まりやすいので、最初の 1 回だけ長く予約しておく。
 */
export const FIRST_LOOKAHEAD = 7.0;
/** 最初の予約の後、BGM を描き始めるまでの間（ミリ秒。描く準備は主のスレッドで音のつながりを作るので、最初の音の後へ遅らせる） */
export const RENDER_DELAY_MS = 1500;
export const TICK_MS = 50;
export const FADE_IN = 0.6;
export const FADE_OUT = 0.8;
/** 切り替えの時、新しい曲を始めるまでの間（秒） */
export const SWITCH_GAP = 0.35;
/** 予約から描いた輪へ受け渡すときの重ね（秒） */
export const HANDOFF = 0.3;
/** 描く輪の標本化の速さ（Hz。単音で約 4 MB／分） */
export const RENDER_RATE = 24000;
/** 輪の終わりの後に描く長さ（鳴り残る音。輪の頭に重ねる） */
const TAIL = 3.5;

export interface TimerLike {
    set(fn: () => void, ms: number): unknown;
    clear(h: unknown): void;
}
export const browserTimer: TimerLike = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** 描いた 1 曲（輪の始めと終わりは秒） */
export interface RenderedSong {
    buffer: AudioBuffer;
    loopStart: number;
    loopEnd: number;
}
export type SongRenderer = (id: SongId) => Promise<RenderedSong>;

/** 1 回の再生（曲の切り替えごとに作る） */
interface Playing {
    id: SongId;
    /** 曲の音量（フェード）。live・buf はこの前 */
    gain: GainNode;
    /** 予約の音の出口（描いた輪へ受け渡すと消す） */
    live: GainNode;
    /** 曲の頭（小節 0）の時刻 */
    origin: number;
    /** 次に読む小節の番号と、その頭の時刻 */
    bar: number;
    nextBar: number;
    pending: { t: number; e: NoteEvent }[];
    /** 描いた輪で鳴らしている（予約はしない） */
    src: AudioBufferSourceNode | null;
    /** この時刻より後の予約の音は鳴らさない（描いた輪へ受け渡した） */
    liveUntil: number;
    /** フェードアウトの終わり（これを過ぎたら外す）。鳴らしている間は Infinity */
    endAt: number;
    /** まだ 1 度も予約していない（最初の予約は FIRST_LOOKAHEAD まで） */
    fresh: boolean;
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

/** 曲の頭の段（繰り返さない段）と、繰り返す段の小節の数 */
export function loopBars(id: SongId): { intro: number; loop: number } {
    const song = SONGS[id];
    const lens = song.order.map((n) => song.sections[n]!.harmony.length);
    const intro = lens.slice(0, song.loopFrom).reduce((a, b) => a + b, 0);
    const loop = lens.slice(song.loopFrom).reduce((a, b) => a + b, 0);
    return { intro, loop };
}

/** 曲の頭から x 秒の所が、描いた輪のどこか（頭の段の後は繰り返す） */
export function loopPosition(r: { loopStart: number; loopEnd: number }, x: number): number {
    if (x < r.loopEnd) return Math.max(0, x);
    const len = r.loopEnd - r.loopStart;
    return r.loopStart + ((x - r.loopStart) % len);
}

/** OfflineAudioContext で 1 曲を描く（ブラウザ。無ければ null） */
export function offlineRenderer(): SongRenderer | null {
    const C = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
    if (!C) return null;
    return async (id) => {
        const song = SONGS[id];
        const sec = barSeconds(song);
        const spb = 60 / song.bpm;
        const { intro, loop } = loopBars(id);
        const loopStart = intro * sec;
        const loopEnd = (intro + loop) * sec;
        const sr = RENDER_RATE;
        const len = Math.ceil((loopEnd + TAIL) * sr);
        const oc = new C({ numberOfChannels: 1, length: len, sampleRate: sr });
        const bus = oc.createGain();
        bus.connect(oc.destination);
        for (let i = 0; i < intro + loop; i++) {
            const t0 = i * sec;
            for (const e of barEvents(song, i)) playNote(oc, bus, t0 + e.beat * spb, e);
        }
        const buffer = await oc.startRendering();
        // 輪の終わりで鳴り残る音を、輪の頭に重ねる（継ぎ目で余韻が切れない）
        const d = buffer.getChannelData(0);
        const s0 = Math.round(loopStart * sr);
        const s1 = Math.round(loopEnd * sr);
        for (let j = 0; s1 + j < d.length && s0 + j < s1; j++) d[s0 + j] = d[s0 + j]! + d[s1 + j]!;
        return { buffer, loopStart, loopEnd };
    };
}

export class MusicPlayer {
    private playing: Playing | null = null;
    private readonly fading: Playing[] = [];
    /** 鳴らしたい曲（有効になる前・止めている間も覚える） */
    private want: SongId | null = null;
    private timer: unknown = null;
    private readonly rendered = new Map<SongId, RenderedSong>();
    private readonly rendering = new Map<SongId, Promise<RenderedSong | null>>();
    private renderFailed = false;
    /** 確かめ用：予約した音の数・捨てた（遅れた）音の数・曲を始めた回数・描いた輪で鳴らし始めた回数・タイマーの最大の間 */
    readonly stats = { scheduled: 0, dropped: 0, starts: 0, switches: 0, loops: 0, rendered: 0, renderMs: 0, maxGapMs: 0, firstNoteCtx: -1 };
    private lastTick = -1;

    constructor(
        private readonly engine: AudioEngine,
        private readonly timers: TimerLike = browserTimer,
        private readonly note: NotePlayer = playNote,
        private readonly renderer: SongRenderer | null = null,
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
    /** 今鳴らしている曲のやり方（'loop' 描いた輪・'live' 予約。無ければ null） */
    get mode(): 'loop' | 'live' | null {
        return this.playing ? (this.playing.src ? 'loop' : 'live') : null;
    }
    /** 今音を出している曲の数（フェードアウト中を含む） */
    get audible(): SongId[] {
        return [...(this.playing ? [this.playing.id] : []), ...this.fading.map((f) => f.id)];
    }
    /** 描き終わった曲 */
    get ready(): SongId[] {
        return [...this.rendered.keys()];
    }

    /** 曲を替える（同じ曲なら何もしない。null で止める） */
    play(id: SongId | null): void {
        if (id === this.want && (id === null || this.playing?.id === id || !this.engine.canSchedule)) return;
        this.want = id;
        this.sync();
        if (id && this.renderOpen) this.requestRender(id);
    }

    /** 描き始めてよいか（最初の予約の RENDER_DELAY_MS 後から） */
    private renderOpen = false;
    private renderTimer: unknown = null;
    /** 最初の予約の後に、描くのを始める（3 曲を 1 曲ずつ） */
    private openRenderLater(): void {
        if (this.renderOpen || this.renderTimer !== null || !this.renderer) return;
        this.renderTimer = this.timers.set(() => {
            this.renderOpen = true;
            this.prefetch();
        }, RENDER_DELAY_MS);
    }

    /** 3 曲を描いておく（今の曲から。1 曲ずつ） */
    private prefetch(): void {
        const order: SongId[] = [...new Set<SongId>([...(this.want ? [this.want] : []), 'town', 'crisis', 'battle'])];
        let p: Promise<unknown> = Promise.resolve();
        for (const id of order) p = p.then(() => this.requestRender(id));
    }

    private requestRender(id: SongId): Promise<RenderedSong | null> {
        const have = this.rendered.get(id);
        if (have) return Promise.resolve(have);
        const r = this.renderer;
        if (!r || this.renderFailed || !this.engine.ctx) return Promise.resolve(null);
        let p = this.rendering.get(id);
        if (!p) {
            const t0 = Date.now();
            p = r(id)
                .then((song) => {
                    this.rendered.set(id, song);
                    this.stats.rendered++;
                    this.stats.renderMs += Date.now() - t0;
                    this.handoff();
                    return song;
                })
                .catch((e: unknown) => {
                    // 描けない端末：予約のやり方で続ける
                    console.warn('BGM を描けませんでした（予約で鳴らします）', e);
                    this.renderFailed = true;
                    return null;
                })
                .finally(() => this.rendering.delete(id));
            this.rendering.set(id, p);
        }
        return p;
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
            const live = ctx.createGain();
            live.connect(gain);
            const start = now + (this.fading.length ? SWITCH_GAP : 0.05);
            gain.gain.setValueAtTime(0, now);
            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(SONGS[this.want].gain, start + FADE_IN);
            gain.connect(this.engine.bgm);
            this.playing = { id: this.want, gain, live, origin: start, bar: 0, nextBar: start, pending: [], src: null, liveUntil: Infinity, endAt: Infinity, fresh: true };
            this.stats.starts++;
            const r = this.rendered.get(this.want);
            if (r) this.startLoop(this.playing, r, start, 0);
        }
        this.ensureTimer();
        this.tick();
    }

    /** 描いた輪で鳴らし始める（at の時刻に、曲の頭から x 秒の所から） */
    private startLoop(p: Playing, r: RenderedSong, at: number, x: number): void {
        const ctx = this.engine.ctx!;
        const src = ctx.createBufferSource();
        src.buffer = r.buffer;
        src.loop = true;
        src.loopStart = r.loopStart;
        src.loopEnd = r.loopEnd;
        src.connect(p.gain);
        src.start(at, loopPosition(r, x));
        p.src = src;
        p.liveUntil = at;
        p.pending = p.pending.filter((n) => n.t < at);
        this.stats.loops++;
    }

    /** 予約で鳴らしている曲が描き終わった：同じ位置から描いた輪へ受け渡す（予約の音は短く消す） */
    private handoff(): void {
        const p = this.playing;
        const ctx = this.engine.ctx;
        if (!p || p.src || !ctx) return;
        const r = this.rendered.get(p.id);
        if (!r) return;
        const at = Math.max(ctx.currentTime + 0.12, p.origin);
        // 受け渡しの前に鳴らし始めた予約の音は、余韻だけ短く消す（描いた輪にも同じ余韻が入っている）
        const g = p.live.gain;
        g.setValueAtTime(1, at);
        g.linearRampToValueAtTime(0, at + HANDOFF);
        this.startLoop(p, r, at, at - p.origin);
    }

    private fadeOut(p: Playing, now: number): void {
        const g = p.gain.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0, now + FADE_OUT);
        p.endAt = now + FADE_OUT + 0.05;
        try {
            p.src?.stop(p.endAt);
        } catch {
            // 止め済み
        }
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

    /** 先読みして予約する（タイマーから。テストでは直接呼ぶ）。描いた輪で鳴らしている曲は何もしない */
    tick(): void {
        const ctx = this.engine.ctx;
        if (!ctx || !this.engine.canSchedule) return;
        const now = ctx.currentTime;
        const horizon = now + LOOKAHEAD;
        let scheduled = false;
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
            if (!p.src && p.nextBar < now - 0.25) this.realign();
            // 曲の最初の予約は長く先読みする（直後の重い処理の間も鳴るように）
            const h = p.fresh ? now + FIRST_LOOKAHEAD : horizon;
            p.fresh = false;
            if (p === this.playing && !p.src) {
                const song = SONGS[p.id];
                const sec = barSeconds(song);
                const spb = 60 / song.bpm;
                while (p.nextBar <= h) {
                    for (const e of barEvents(song, p.bar)) p.pending.push({ t: p.nextBar + e.beat * spb, e });
                    p.bar++;
                    p.nextBar += sec;
                }
                p.pending.sort((a, b) => a.t - b.t);
            }
            while (p.pending.length && p.pending[0]!.t <= h) {
                const x = p.pending.shift()!;
                if (x.t < now - 0.03 || x.t >= p.endAt || x.t >= p.liveUntil) {
                    this.stats.dropped++;
                    continue;
                }
                try {
                    this.note(ctx, p.live, x.t, x.e);
                    this.stats.scheduled++;
                    if (this.stats.firstNoteCtx < 0) this.stats.firstNoteCtx = x.t;
                    scheduled = true;
                } catch (e) {
                    // 1 つの音を作れなくても曲は続ける
                    console.error(e);
                }
            }
        }
        if (scheduled || this.playing?.src) this.openRenderLater();
    }

    /** 今の曲の段の名前（確かめ用。曲の頭からの時刻で決める） */
    section(): string | null {
        const p = this.playing;
        const ctx = this.engine.ctx;
        if (!p || !ctx) return null;
        const song = SONGS[p.id];
        const x = ctx.currentTime - p.origin;
        if (x < 0) return null;
        return barAt(song, Math.floor(x / barSeconds(song))).section.name;
    }

    /** すべて止める（後片付け） */
    stopAll(): void {
        this.want = null;
        const ctx = this.engine.ctx;
        if (ctx && this.playing) this.fadeOut(this.playing, ctx.currentTime);
        this.playing = null;
    }
}
