/**
 * 声（Version 28。docs/v28-town-motion-voice.md §5.4）：台詞ごとに事前に作った音声ファイル（voiceManifest.ts の一覧の MP3）を流す。
 *
 * - 読み込み：同じ出どころの fetch → arrayBuffer → AudioContext.decodeAudioData → AudioBufferSourceNode → 声のバス（engine.voiceBus）。
 *   CSP は変えない（connect-src 'self' の fetch。data: URL・blob: の音・WASM は使わない）。
 * - 台詞ごとに、要るときに読む（一覧の全部を最初に読まない）。ほどいた音は少しだけ取っておく（新しく使った順に CACHE_SIZE 個）。
 *   今の場面（会話・演出）の次に来そうな台詞は先に読んでおく（prefetch：先の DECODE_AHEAD 個はほどくまで、残りは通信だけ）。
 * - 1 度に 1 つだけ：新しい台詞の前に必ず今の声を止める。読み込み・ほどきが、後から始めた台詞より遅れて終わったら捨てる
 *   （世代の数 gen。古い台詞を後から鳴らさない・2 つの声を同時に鳴らさない）。
 * - 止める（stop）：行を送った・選択肢を選んだ・会話を閉じた・演出の字幕が替わった／飛ばした／終わった／一時停止・メニューや情勢を重ねた・
 *   合戦へ入った・タイトルへ戻った・ミュート・声の音量 0・アプリを切り替えた（隠れた・窓が外れた・pagehide）。戻っても前の台詞を流し直さない。
 *   止めた音は 12 ms で音量を 0 にして止め、すぐ（音の時計が止まっていても、タイマーで）声のバスから切り離す（再開の後に残りが鳴らない）。
 * - BGM を下げる（engine.duck）のは、音が実際に鳴っている間だけ（始めた時に下げ、終わった・止めた時に戻す。読み込みの待ちの間は下げない）。
 * - 音声ファイルの無い台詞は鳴らさない（端末の読み上げで自動的に埋めない）。
 */
import type { AudioEngine } from './engine';
import type { TimerLike } from './music';
import { browserTimer } from './music';
import { voiceFileFor, type VoiceFileEntry } from './voiceManifest';

/** 同じ出どころのファイルを読む口（テストでは偽物を渡す） */
export type FetchBytes = (url: string) => Promise<ArrayBuffer>;

export interface VoiceFileOptions {
    /** id の台詞の音声ファイル（省けば voiceManifest の一覧） */
    fileFor?: (id: string) => VoiceFileEntry | undefined;
    /** ファイルを読む（省けばブラウザの fetch） */
    fetchBytes?: FetchBytes;
    timers?: TimerLike;
}

export interface VoiceFileLine {
    id: string;
    text: string;
}

/** say の細かい決め */
export interface VoicePlayOptions {
    /**
     * 頼んでからこの秒数（音の時計）より遅れて鳴らせるようになった音は流さない（演出の字幕：字幕の長さは音の長さ＋0.2 秒なので、
     * 遅れて始めると次の字幕で切られる）。省けば遅れても流す（会話の行は、利用者が送るまで出ている）
     */
    lateLimitSec?: number;
}

/** ほどいた音を取っておく数（1 つ 5 秒・モノラル 48 kHz で約 1 MB） */
export const CACHE_SIZE = 6;
/** 読んだファイル（MP3 の中身。1 つ 20〜40 KB）を取っておく数 */
export const BYTES_CACHE_SIZE = 24;
/** 先に読む台詞のうち、ほどくまでする数（残りは通信だけ） */
export const DECODE_AHEAD = 2;
/** 止める時に音量を 0 にする長さ（秒。ぷつっという音を避ける。新しい台詞の頭の無音（0.06 秒以上）より短い） */
export const STOP_FADE_SEC = 0.012;
/** 失敗したファイルを読み直すまでの最短の間（ms） */
export const RETRY_AFTER_MS = 10000;

type Event = 'play' | 'end' | 'stop' | 'discard' | 'late' | 'fail' | 'refused';

interface Playing {
    id: string;
    src: AudioBufferSourceNode;
    gain: GainNode;
    guard: unknown;
}

export class VoiceFilePlayer {
    private gen = 0;
    private cur: Playing | null = null;
    /** ほどいた音（Map の順＝古く使った順） */
    private readonly buffers = new Map<string, AudioBuffer>();
    /** 読んだファイルの中身（ほどく前。ほどくと AudioContext に渡した写しが使えなくなるので、写しを渡す） */
    private readonly bytes = new Map<string, Promise<ArrayBuffer>>();
    private readonly decoding = new Map<string, Promise<AudioBuffer>>();
    private readonly failedAt = new Map<string, number>();
    /** 今の場面で次に来そうな台詞（会話の行・演出の字幕の順） */
    private upcoming: string[] = [];
    private readonly timers: TimerLike;
    private readonly fileFor: (id: string) => VoiceFileEntry | undefined;
    private readonly fetchBytes: FetchBytes;
    /** 鳴っている台詞の id（無ければ null） */
    playingId: string | null = null;
    /** 読み込み・ほどきを待っている台詞の id（無ければ null） */
    pendingId: string | null = null;
    /** 確かめ用：新しい順に 30 件まで */
    readonly log: { id: string; event: Event; at: number; sec?: number; why?: string }[] = [];
    readonly stats = { requested: 0, played: 0, ended: 0, stopped: 0, discarded: 0, late: 0, failed: 0, refused: 0, fetched: 0, decoded: 0, cacheHits: 0 };
    lastError: string | null = null;

    constructor(
        private readonly engine: AudioEngine,
        opts: VoiceFileOptions = {},
    ) {
        this.timers = opts.timers ?? browserTimer;
        this.fileFor = opts.fileFor ?? voiceFileFor;
        this.fetchBytes = opts.fetchBytes ?? browserFetchBytes;
        // アプリを切り替えた：止める（戻っても流し直さない。読み込み中の台詞も捨てる）
        engine.onPause((paused) => {
            if (paused) this.stop();
        });
        engine.store.onChange((s) => {
            if (s.muted || s.voice <= 0) this.stop();
        });
        // 鳴らせるようになった（最初の操作・再開）：次に来そうな台詞を先にほどいておく
        engine.onReady(() => this.prefetch(this.upcoming));
    }

    /** id の台詞に音声ファイルがあるか（文も表と同じ） */
    has(line: VoiceFileLine): boolean {
        const e = this.fileFor(line.id);
        return !!e && e.text === line.text;
    }

    /** 今流せるか（音声ファイルがある・音を始めてある・止めていない・ミュートでない・声の音量が 0 でない） */
    canSay(line: VoiceFileLine): boolean {
        return this.has(line) && this.canPlay();
    }

    private canPlay(): boolean {
        const s = this.engine.settings;
        return this.engine.canSchedule && !!this.engine.voiceBus && !s.muted && s.voice > 0;
    }

    /**
     * 台詞の音声ファイルを流す（前の声は必ず止める）。流せない（ファイルが無い・有効にする前・止めている・ミュート）ときは何もしない。
     * 返りは流し始めた（または読み込みを始めた）か。読み込みの後に、もっと新しい台詞・止める知らせが来ていれば流さない。
     */
    say(line: VoiceFileLine, opts: VoicePlayOptions = {}): boolean {
        this.stop();
        const e = this.fileFor(line.id);
        if (!e || e.text !== line.text || !this.canPlay()) {
            this.stats.refused++;
            this.note(line.id, 'refused', e ? undefined : 'no_file');
            return false;
        }
        const g = this.gen;
        this.stats.requested++;
        this.aheadOf(line.id);
        const hit = this.buffers.get(e.id);
        if (hit) {
            this.stats.cacheHits++;
            this.touch(e.id, hit);
            this.start(e, hit);
            return true;
        }
        const askedAt = this.engine.now();
        this.pendingId = e.id;
        void this.load(e).then(
            (buf) => {
                if (g !== this.gen) {
                    // 後から別の台詞を始めた・止めた：捨てる
                    this.stats.discarded++;
                    this.note(e.id, 'discard');
                    return;
                }
                this.pendingId = null;
                if (!this.canPlay()) {
                    this.stats.discarded++;
                    this.note(e.id, 'discard', 'cannot_play');
                    return;
                }
                const late = this.engine.now() - askedAt;
                if (opts.lateLimitSec !== undefined && late > opts.lateLimitSec) {
                    this.stats.late++;
                    this.note(e.id, 'late', `${late.toFixed(3)}s`);
                    return;
                }
                this.start(e, buf);
            },
            (err: unknown) => {
                if (g === this.gen) this.pendingId = null;
                this.stats.failed++;
                this.lastError = err instanceof Error ? err.message : String(err);
                this.note(e.id, 'fail', this.lastError);
            },
        );
        return true;
    }

    /** 今の声を止める（鳴っていなくても、読み込み中の台詞を捨てる） */
    stop(): void {
        this.gen++;
        this.pendingId = null;
        const p = this.cur;
        if (!p) return;
        this.cur = null;
        this.playingId = null;
        this.silence(p);
        this.stats.stopped++;
        this.note(p.id, 'stop');
        this.engine.duck(false);
    }

    /**
     * 次に来そうな台詞（今の会話の行・演出の字幕の順）を覚え、先に読む：先の DECODE_AHEAD 個はほどくまで（AudioContext があれば）、
     * 残りは通信だけ。ファイルの無い台詞は飛ばす。失敗しても何もしない（流すときに読み直す）
     */
    prefetch(ids: readonly string[]): void {
        this.upcoming = [...ids];
        let n = 0;
        for (const id of ids) {
            const e = this.fileFor(id);
            if (!e) continue;
            if (n < DECODE_AHEAD && this.engine.ctx) void this.load(e).catch(() => {});
            else void this.bytesOf(e).catch(() => {});
            n++;
        }
    }

    /** 流し始めた台詞の後に来そうな台詞を、先にほどいておく */
    private aheadOf(id: string): void {
        const i = this.upcoming.indexOf(id);
        if (i < 0 || !this.engine.ctx) return;
        let n = 0;
        for (const next of this.upcoming.slice(i + 1)) {
            const e = this.fileFor(next);
            if (!e) continue;
            void this.load(e).catch(() => {});
            if (++n >= DECODE_AHEAD) break;
        }
    }

    private start(e: VoiceFileEntry, buf: AudioBuffer): void {
        const ctx = this.engine.ctx;
        const bus = this.engine.voiceBus;
        if (!ctx || !bus) return;
        try {
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const gain = ctx.createGain();
            src.connect(gain);
            gain.connect(bus);
            const p: Playing = { id: e.id, src, gain, guard: null };
            src.onended = () => this.ended(p);
            src.start(ctx.currentTime);
            this.cur = p;
            this.playingId = e.id;
            // 終わりの知らせが来ない端末のため：長さ＋2 秒で終わったことにする（そのときは音も止める）
            p.guard = this.timers.set(() => this.ended(p, true), (buf.duration + 2) * 1000);
            this.engine.duck(true);
            this.stats.played++;
            this.note(e.id, 'play', undefined, Math.round(buf.duration * 1000) / 1000);
        } catch (err) {
            this.lastError = err instanceof Error ? err.message : String(err);
            this.note(e.id, 'fail', this.lastError);
            this.cur = null;
            this.playingId = null;
            this.engine.duck(false);
        }
    }

    /** 鳴り終えた（force：終わりの知らせが来ないまま見込みの時間が過ぎた。音も止める） */
    private ended(p: Playing, force = false): void {
        if (this.cur !== p) return;
        this.cur = null;
        this.playingId = null;
        if (force) this.silence(p);
        else {
            this.clearGuard(p);
            disconnect(p);
        }
        this.stats.ended++;
        this.note(p.id, 'end');
        this.engine.duck(false);
    }

    /** 音を止めて声のバスから切り離す。音の時計が進んでいれば短く絞ってから、止まっていればすぐ */
    private silence(p: Playing): void {
        this.clearGuard(p);
        p.src.onended = null;
        const ctx = this.engine.ctx;
        const live = !!ctx && this.engine.live;
        try {
            if (live) {
                const t = ctx!.currentTime;
                const g = p.gain.gain;
                g.cancelScheduledValues(t);
                g.setValueAtTime(g.value, t);
                g.linearRampToValueAtTime(0, t + STOP_FADE_SEC);
                p.src.stop(t + STOP_FADE_SEC);
            } else p.src.stop();
        } catch {
            // 既に止まっている（終わった後）
        }
        // 切り離しは音の時計を待たない（一時停止の直前に止めた音が、再開の後に残りを鳴らさない）
        if (live) this.timers.set(() => disconnect(p), STOP_FADE_SEC * 1000 + 40);
        else disconnect(p);
    }

    private clearGuard(p: Playing): void {
        if (p.guard !== null) {
            this.timers.clear(p.guard);
            p.guard = null;
        }
    }

    /** ほどいた音（取ってあればそれ。無ければ読んでほどく。同じ台詞を 2 度並べて読まない） */
    private load(e: VoiceFileEntry): Promise<AudioBuffer> {
        const hit = this.buffers.get(e.id);
        if (hit) return Promise.resolve(hit);
        const busy = this.decoding.get(e.id);
        if (busy) return busy;
        const ctx = this.engine.ctx;
        if (!ctx) return Promise.reject(new Error('音がまだ有効になっていない'));
        const p = this.bytesOf(e)
            .then((b) => decodeBytes(ctx, b.slice(0)))
            .then((buf) => {
                this.stats.decoded++;
                this.touch(e.id, buf);
                return buf;
            });
        this.decoding.set(e.id, p);
        const done = () => {
            if (this.decoding.get(e.id) === p) this.decoding.delete(e.id);
        };
        p.then(done, done);
        return p;
    }

    /** ファイルの中身（読んであればそれ。失敗したら覚えを消す：RETRY_AFTER_MS の後に読み直せる） */
    private bytesOf(e: VoiceFileEntry): Promise<ArrayBuffer> {
        const have = this.bytes.get(e.id);
        if (have) {
            // 新しく使った順に並べ直す
            this.bytes.delete(e.id);
            this.bytes.set(e.id, have);
            return have;
        }
        const failed = this.failedAt.get(e.id);
        if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return Promise.reject(new Error(`読めなかった直後: ${e.file}`));
        const p = this.fetchBytes(voiceUrl(e)).then((b) => {
            this.stats.fetched++;
            return b;
        });
        this.bytes.set(e.id, p);
        p.catch(() => {
            if (this.bytes.get(e.id) === p) this.bytes.delete(e.id);
            this.failedAt.set(e.id, Date.now());
        });
        while (this.bytes.size > BYTES_CACHE_SIZE) this.bytes.delete(this.bytes.keys().next().value!);
        return p;
    }

    private touch(id: string, buf: AudioBuffer): void {
        this.buffers.delete(id);
        this.buffers.set(id, buf);
        while (this.buffers.size > CACHE_SIZE) this.buffers.delete(this.buffers.keys().next().value!);
    }

    private note(id: string, event: Event, why?: string, sec?: number): void {
        this.log.unshift({ id, event, at: Math.round(this.engine.now() * 1000) / 1000, ...(sec !== undefined ? { sec } : {}), ...(why ? { why } : {}) });
        if (this.log.length > 30) this.log.pop();
    }

    /** 確かめ用：取ってある台詞（ほどいた音・読んだファイル） */
    cached(): { decoded: string[]; bytes: string[] } {
        return { decoded: [...this.buffers.keys()], bytes: [...this.bytes.keys()] };
    }
}

function disconnect(p: Playing): void {
    try {
        p.src.disconnect();
        p.gain.disconnect();
    } catch {
        // 既に切り離してある
    }
}

/** ページからの相対の場所（dist の index.html の隣の voice/…。開発サーバーでは proto3d/public/voice/…） */
export function voiceUrl(e: Pick<VoiceFileEntry, 'file'>): string {
    return `./${e.file}`;
}

/** decodeAudioData（古い Safari は約束を返さず、知らせの関数だけを呼ぶ。どちらでも 1 度だけ答える） */
export function decodeBytes(ctx: AudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
    return new Promise((resolve, reject) => {
        try {
            const r = ctx.decodeAudioData(bytes, resolve, (e) => reject(e ?? new Error('音声ファイルをほどけない')));
            if (r && typeof (r as Promise<AudioBuffer>).then === 'function') (r as Promise<AudioBuffer>).then(resolve, reject);
        } catch (e) {
            reject(e);
        }
    });
}

/** ブラウザの fetch（同じ出どころ。HTTP の誤りは失敗） */
export async function browserFetchBytes(url: string): Promise<ArrayBuffer> {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
    return await r.arrayBuffer();
}
