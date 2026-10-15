/**
 * 音のまとめ役（AudioSystem）と、どこからでも呼べる口（audio()）。設計と確かめ：docs/audio.md。
 *
 * 取り付け（どこも短く。音が無い・失敗しても進行は止めない）：
 * - ui/boot.ts：作って登録する（installAudio）。最初の利用者の操作で有効にする。画面から曲を決める見張り（200 ms ごと）。
 * - ui/view.ts：会話の行（line）・会話の先読み（prefetchLines）・会話を閉じた・上に画面を重ねた（stopVoice）・メニューの音の設定。
 * - ui/cinePlayer.ts：演出の先読み（prefetchVoices）・場面（cineBeat）・字幕（caption）・一時停止（cinePaused）・終わり（cineEnd）・
 *   字幕の声を待つか（cineVoiceReady）・これから流す演出の声の取り置き（prepareVoices。ui/view.ts の prepareCinematic から）。
 * - main.ts：足音（step）・聞く位置（listener）。
 * - battle/entry.ts：合戦の毎フレーム（battleFrame）・始まり・能力・撤退・終わり。
 *
 * 声の種類（Version 28。docs/v28-town-motion-voice.md §5.4）：
 * - 'file'（既定）：台詞ごとに作った音声ファイル（voiceFiles.ts）。ファイルの無い台詞は無音（字幕だけ）。端末の読み上げには一切触れない
 *   （speechSynthesis を読みもしない：端末の読み上げの部品は、端末の読み上げを選んだときに初めて作る）。
 * - 'tts'：端末の読み上げ（旧。voice.ts）。音の設定の「声の種類」か、URL の ?voice=tts（その回だけ。保存しない）で選ぶ。
 * - 自動で端末の読み上げに切り替えない（ファイルが読めない・無いときも）。
 */
import { AudioEngine, browserPage, type PageLike } from './engine';
import { cineMusic, creakDelay, sceneFor, type CineBeatInfo, type ScreenInput } from './director';
import { MusicPlayer, browserTimer, offlineRenderer, playNote, type SongRenderer, type TimerLike } from './music';
import { AudioSettingsStore } from './settings';
import { FootstepTracker, Sfx } from './sfx';
import type { SongId } from './songs';
import { VoicePlayer, browserSpeech, type SpeechLike, type UtteranceLike, type VoiceLineLike, type VoiceStatus } from './voice';
import { VoiceFilePlayer, type FetchBytes } from './voiceFiles';
import type { VoiceFileEntry } from './voiceManifest';
import type { VoiceSource } from './settings';
import type { StorageLike } from '../campaign/save';

/** 声の台詞の表の引き方（campaign/ieyasu1570/story/voiceLines.ts を boot がつなぐ） */
export interface VoiceTable {
    byId(id: string): VoiceLineLike | undefined;
    find(speaker: string, text: string): VoiceLineLike | undefined;
    /** 話し手の名前（字幕の名前の欄） */
    nameOf?(speaker: string): string;
}

export interface AudioSystemOptions {
    storage: Pick<StorageLike, 'getItem' | 'setItem'> | null;
    voices: VoiceTable;
    createContext?: () => AudioContext;
    page?: PageLike | null;
    speech?: { synth: SpeechLike | null; makeUtterance: (text: string) => UtteranceLike };
    timers?: TimerLike;
    /** BGM を描く（省けば OfflineAudioContext。null で描かずに予約だけ） */
    renderer?: SongRenderer | null;
    /** 声の音声ファイルの読み方（省けばブラウザの fetch と voiceManifest の一覧。テストでは偽物） */
    voiceFiles?: { fetchBytes?: FetchBytes; fileFor?: (id: string) => VoiceFileEntry | undefined };
    /** URL の ?voice= の指定（その回だけ設定より優先。保存しない。null・省けば設定のまま） */
    voiceSourceOverride?: VoiceSource | null;
}

/**
 * 演出の字幕の声を、頼んでからこの秒数（音の時計）より遅れて流せるようになったら流さない（字幕の長さは音の長さ＋0.2 秒。
 * それより遅れて始めると、次の字幕で言い終える前に切られる）。演出を始めたときに台詞を先に読むので、ふつうは遅れない
 */
export const CINE_VOICE_LATE_SEC = 0.25;

/**
 * 演出の次の声の字幕の時刻が来ても、その声がまだほどけていないときは、演出の時計をその字幕の境目で待たせる（ui/cinePlayer.ts）。
 * その待ちの最長（秒。実時間）。過ぎたら字幕を出して進める（声はこれまでどおり：遅れすぎた声は流さない）。
 * 端末の読み上げ（旧）・ミュート・声の音量 0・音を始めていないときは待たない（cineVoiceReady が true）
 */
export const CINE_VOICE_WAIT_SEC = 2.5;

/** この画面へ移ったら声を止める（会話・軍議・演出の上に重ねる画面と、タイトル） */
const VOICE_STOP_SCREENS: ReadonlySet<string> = new Set(['menu', 'situation', 'title']);

/** 合戦の音に要る形（battle/sim.ts の BattleState の使う所だけ） */
export interface BattleLike {
    units: readonly { status: string; present?: boolean; engagedWith: string | null; shootingAt: string | null }[];
}

export class AudioSystem {
    readonly settings: AudioSettingsStore;
    readonly engine: AudioEngine;
    readonly music: MusicPlayer;
    readonly sfx: Sfx;
    /** 声（新しい声：台詞ごとの音声ファイル） */
    readonly voiceFiles: VoiceFilePlayer;
    readonly feet = new FootstepTracker();
    /** 端末の読み上げ（旧）の部品。端末の読み上げを選ぶまで作らない（新しい声では speechSynthesis に触れない） */
    private tts: VoicePlayer | null = null;
    private readonly speechOpt: AudioSystemOptions['speech'];
    private readonly sourceOverride: VoiceSource | null;
    private lastSource: VoiceSource;
    private readonly voices: VoiceTable;
    private readonly timers: TimerLike;
    private screen: ScreenInput = { screen: 'boot', battle: false, cine: null };
    private cine: CineBeatInfo | null = null;
    private ambTimer: unknown = null;
    private wind = 0;
    /** 確かめ用：曲の切り替えの記録（新しい順に 40 件） */
    readonly sceneLog: { at: number; music: SongId | null; why: string }[] = [];

    constructor(opts: AudioSystemOptions) {
        this.voices = opts.voices;
        this.timers = opts.timers ?? browserTimer;
        this.settings = new AudioSettingsStore(opts.storage);
        this.engine = new AudioEngine({ settings: this.settings, ...(opts.createContext ? { createContext: opts.createContext } : {}), page: opts.page === undefined ? browserPage() : opts.page });
        this.music = new MusicPlayer(this.engine, this.timers, playNote, opts.renderer === undefined ? offlineRenderer() : opts.renderer);
        this.sfx = new Sfx(this.engine);
        this.speechOpt = opts.speech;
        this.sourceOverride = opts.voiceSourceOverride ?? null;
        this.voiceFiles = new VoiceFilePlayer(this.engine, { timers: this.timers, ...(opts.voiceFiles ?? {}) });
        this.lastSource = this.voiceSource;
        // 声の種類を替えた：今の声（どちらも）を止める
        this.settings.onChange(() => {
            const now = this.voiceSource;
            if (now === this.lastSource) return;
            this.lastSource = now;
            this.stopAllVoices();
        });
        this.engine.onReady(() => this.ensureAmbienceTimer());
    }

    /** 今の声の種類（URL の ?voice= があればそれ。無ければ音の設定） */
    get voiceSource(): VoiceSource {
        return this.sourceOverride ?? this.settings.get().voiceSource;
    }
    /** URL の ?voice= で声の種類を決めている（音の設定の欄では替えられない） */
    get voiceSourceFixed(): boolean {
        return this.sourceOverride !== null;
    }

    /** 端末の読み上げ（旧）の部品（初めて使うときに作る。新しい声のままなら作らない） */
    get voice(): VoicePlayer {
        if (!this.tts) {
            const sp = this.speechOpt ?? browserSpeech();
            this.tts = new VoicePlayer(this.engine, { synth: sp.synth, makeUtterance: sp.makeUtterance, timers: this.timers });
        }
        return this.tts;
    }
    private get useTts(): boolean {
        return this.voiceSource === 'tts';
    }
    /** 両方の声を止める（端末の読み上げは、作ってあるときだけ） */
    private stopAllVoices(): void {
        this.voiceFiles.stop();
        this.tts?.stop();
    }

    /**
     * 利用者の操作の中で呼ぶ（何度でもよい）。activation：端末が「操作」と数える入力（タップを離した・クリック・キー）の中か
     * （タッチの押し始めは数えない端末がある。その中では読み上げの下ごしらえをしない）
     */
    unlock(activation = true): boolean {
        return guard(() => {
            const ok = this.engine.unlock();
            // 読み上げの下ごしらえは Web Audio が無い端末でもする（声は AudioContext を通らない）。端末の読み上げを選んでいるときだけ
            if (activation && this.useTts && !this.voice.primed) this.voice.prime();
            this.apply('unlock');
            return ok;
        }, false);
    }

    /** 操作の中で有効にし直す要るか（始まっていない・中断されたまま。アプリの切り替えで止めている間は要らない） */
    get needsGesture(): boolean {
        const st = this.engine.state;
        // 読み上げの下ごしらえが要るのは端末の読み上げ（旧）のときだけ（新しい声は AudioContext を通る）
        const prime = this.useTts && !this.voice.primed && this.voiceStatus !== 'unsupported';
        if (st === 'unavailable') return prime;
        return (st !== 'running' && !this.engine.held) || prime;
    }

    /** 端末の読み上げ（旧）の様子（新しい声のときは 'unknown'：端末の読み上げを調べない） */
    get voiceStatus(): VoiceStatus {
        return this.useTts ? this.voice.status : 'unknown';
    }

    // ---------------- 画面と曲

    /** 章の進行の画面・合戦の画面（boot の見張りから） */
    /** defeat：前の合戦で勝てなかった（結果確認・結末・第二章の冒頭の町を明るい曲で迎えない） */
    setScreen(screen: string, battle: boolean, defeat = false): void {
        guard(() => {
            if (this.screen.screen === screen && this.screen.battle === battle && !!this.screen.defeat === defeat) return;
            // 別の画面へ移った：古い声を止める（会話・演出の中の移り変わりは、それぞれの口で止める）。
            // 合戦の出入り・メニュー・情勢・タイトルへ移った（会話・軍議の上に重ねたときも。ui/view.ts は重ねた時にすぐ止める。ここは見張りの側の止め）
            if (battle !== this.screen.battle || (screen !== this.screen.screen && VOICE_STOP_SCREENS.has(screen))) this.stopAllVoices();
            this.screen = { screen, battle, cine: this.cine, defeat };
            this.apply(`screen:${screen}${battle ? '+battle' : ''}${defeat ? '+defeat' : ''}`);
        }, undefined);
    }

    /** 演出の場面が替わった（null で演出の外） */
    cineBeat(b: CineBeatInfo | null): void {
        guard(() => {
            const prev = this.cine;
            this.cine = b;
            this.screen = { ...this.screen, cine: b };
            if (b && b.kind === 'stage' && (prev?.event !== b.event || prev?.kind !== 'stage')) {
                const d = creakDelay(b.event);
                if (d !== null) this.sfx.creak(d);
            }
            this.apply(b ? `cine:${b.moment}:${b.kind}${b.event ? `:${b.event}` : ''}` : 'cine:end');
        }, undefined);
    }
    /** 演出を閉じた（終わり・スキップ・タイトルへ）：声を止め、演出の曲の決めを外す（字幕の声を捨てないのもやめる） */
    cineEnd(): void {
        guard(() => {
            this.stopAllVoices();
            this.voiceFiles.keepScene([]);
        }, undefined);
        this.cineBeat(null);
    }
    /** 演出の一時停止（自動の一時停止も）：声を止める（再開しても読み直さない） */
    cinePaused(on: boolean): void {
        guard(() => {
            if (on) this.stopAllVoices();
        }, undefined);
    }

    private apply(why: string): void {
        const c = this.screen.cine ? cineMusic(this.screen.cine, !!this.screen.defeat) : sceneFor(this.screen);
        if (c.music !== 'keep' && c.music !== this.music.wanted) {
            this.sceneLog.unshift({ at: this.engine.now(), music: c.music, why });
            if (this.sceneLog.length > 40) this.sceneLog.pop();
        }
        if (c.music !== 'keep') this.music.play(c.music);
        if (c.wind >= 0) this.wind = c.wind;
        this.sfx.setAmbience(this.wind, c.town);
    }

    private ensureAmbienceTimer(): void {
        if (this.ambTimer !== null) return;
        const loop = () => {
            this.ambTimer = this.timers.set(loop, 120);
            try {
                this.sfx.tickAmbience();
            } catch (e) {
                console.error(e);
            }
        };
        this.ambTimer = this.timers.set(loop, 120);
    }

    // ---------------- 声

    /** 演出の字幕が替わった（null で字幕なし）。声の id があれば読む（前の声は止める） */
    caption(c: { speaker?: string; text: string; voice?: string } | null): void {
        guard(() => {
            const line = this.cineLine(c);
            if (!line || line.text !== c!.text) this.stopAllVoices();
            else if (this.useTts) this.voice.say(line);
            else this.voiceFiles.say(line, { lateLimitSec: CINE_VOICE_LATE_SEC });
        }, undefined);
    }
    private cineLine(c: { speaker?: string; text: string; voice?: string } | null): VoiceLineLike | undefined {
        return c?.voice ? this.voices.byId(c.voice) : c?.speaker ? this.voices.find(c.speaker, c.text) : undefined;
    }
    /**
     * 演出の字幕の声を今すぐ鳴らせるか（演出の再生器が、字幕の境目で時計を待たせるかを決める：CINE_VOICE_WAIT_SEC）。
     * 待つ要が無いときも true：声の無い字幕・端末の読み上げ（旧）・ミュート・声の音量 0・音を始めていない・音声ファイルが無い・
     * 読めなかった直後。まだほどけていなければ、読み込みとほどきを始めて false
     */
    cineVoiceReady(c: { speaker?: string; text: string; voice?: string }): boolean {
        return guard(() => {
            if (this.useTts) return true;
            const line = this.cineLine(c);
            return !line || line.text !== c.text || this.voiceFiles.ready(line);
        }, true);
    }
    /** 会話の行が出た（表にある文なら読む。無ければ前の声を止める） */
    line(speaker: string, name: string, text: string): void {
        guard(() => {
            const v = this.lineOf(speaker, name, text);
            if (!v) this.stopAllVoices();
            else if (this.useTts) this.voice.say(v);
            else this.voiceFiles.say(v);
        }, undefined);
    }
    private lineOf(speaker: string, name: string, text: string): VoiceLineLike | undefined {
        return this.voices.find(speaker, text) ?? (name ? this.voices.find(name, text) : undefined);
    }
    /**
     * 会話を開いた：その会話の行のうち声のある台詞を、先に読んでおく（新しい声のときだけ。端末の読み上げは先読みが無い）
     */
    prefetchLines(lines: readonly { speaker: string; name?: string; text: string }[]): void {
        guard(() => {
            if (this.useTts) return;
            const ids: string[] = [];
            for (const l of lines) {
                const v = this.lineOf(l.speaker, l.name ?? '', l.text);
                if (v) ids.push(v.id);
            }
            this.voiceFiles.prefetch(ids);
        }, undefined);
    }
    /** 演出を始めた：字幕の声の id（出る順）を先に読んでおく（新しい声のときだけ）。演出の間は、ほどいた音を捨てない */
    prefetchVoices(ids: readonly string[]): void {
        guard(() => {
            if (this.useTts) return;
            this.voiceFiles.keepScene(ids);
            this.voiceFiles.prefetch(ids);
        }, undefined);
    }
    /**
     * これから流す演出（待っている町の出来事）の字幕の声を、今のうちに全部読んでほどき、取っておく（新しい声のときだけ。
     * 前の取り置きと替える。空で取り置きをやめる）。状態・保存には触れない
     */
    prepareVoices(ids: readonly string[]): void {
        guard(() => this.voiceFiles.reserve(this.useTts ? [] : ids), undefined);
    }
    /**
     * 表の id の台詞を読む（合戦の掛け声）。読めるときは、読む前に before（字幕を出す）を呼ぶ。返りは読んだ台詞（読めなければ null）
     */
    sayId(id: string, before?: (v: VoiceLineLike) => void): VoiceLineLike | null {
        return guard(() => {
            const v = this.voices.byId(id);
            if (!v || !(this.useTts ? this.voice.canSay() : this.voiceFiles.canSay(v))) return null;
            try {
                before?.(v);
            } catch (e) {
                console.error(e);
            }
            return (this.useTts ? this.voice.say(v) : this.voiceFiles.say(v)) ? v : null;
        }, null);
    }
    stopVoice(): void {
        guard(() => {
            this.stopAllVoices();
        }, undefined);
    }
    speakerName(speaker: string): string {
        return guard(() => {
            return this.voices.nameOf?.(speaker) ?? '';
        }, '');
    }

    // ---------------- 足音・聞く位置

    /** 探索の毎フレーム（main.ts）：歩き・走りの位相から足音 */
    step(strideTotal: number, speed: number, run: boolean): void {
        guard(() => {
            const k = this.feet.update(strideTotal, speed, run);
            if (k) this.sfx.step(k);
        }, undefined);
    }
    listener(x: number, z: number): void {
        guard(() => {
            this.sfx.setListener(x, z);
        }, undefined);
    }

    // ---------------- 合戦

    battleFrame(dt: number, s: BattleLike, speed: number, running: boolean): void {
        guard(() => {
            let engaged = 0;
            let shooting = 0;
            for (const u of s.units) {
                if (u.status !== 'ready' || u.present === false) continue;
                if (u.engagedWith) engaged++;
                else if (u.shootingAt) shooting++;
            }
            this.sfx.battleTick(dt, engaged, shooting, speed, running);
        }, undefined);
    }
    battleEvent(kind: string, speed: number): void {
        guard(() => {
            switch (kind) {
                case 'engage':
                case 'flank':
                case 'rear':
                case 'charge':
                case 'ambush':
                    this.sfx.battleCue('engage', speed);
                    break;
                case 'rout':
                case 'destroyed':
                    this.sfx.battleCue('rout', speed);
                    break;
            }
        }, undefined);
    }
    battleCue(kind: 'start' | 'ability' | 'end', speed = 1): void {
        guard(() => {
            this.sfx.battleCue(kind, speed);
        }, undefined);
    }

    /** 確かめ用の様子 */
    probe() {
        return {
            state: this.engine.state,
            held: this.engine.held,
            ducked: this.engine.isDucked,
            settings: this.settings.get(),
            music: { wanted: this.music.wanted, current: this.music.current, mode: this.music.mode, section: this.music.section(), ready: this.music.ready, audible: this.music.audible, ...this.music.stats },
            voice: this.useTts
                ? { source: 'tts' as const, status: this.voice.status, speaking: this.voice.speakingId, ...this.voice.stats, log: this.voice.log.slice(0, 10) }
                : { source: 'file' as const, fixed: this.voiceSourceFixed, speaking: this.voiceFiles.playingId, pending: this.voiceFiles.pendingId, ...this.voiceFiles.stats, lastError: this.voiceFiles.lastError, cached: this.voiceFiles.cached(), log: this.voiceFiles.log.slice(0, 12) },
            sfx: { ...this.sfx.stats, meleeActive: this.sfx.melee.active(this.engine.now()), meleeRefused: this.sfx.melee.refused, cueRefused: this.sfx.cues.refused },
            screen: this.screen.screen,
            battle: this.screen.battle,
            cine: this.cine,
            scenes: this.sceneLog.slice(0, 12),
        };
    }
}

/** 音の口の中の誤りで、呼ぶ側（演出の再生・会話・合戦・探索の毎フレーム）を止めない */
function guard<T>(fn: () => T, fallback: T): T {
    try {
        return fn();
    } catch (e) {
        console.error(e);
        return fallback;
    }
}

let current: AudioSystem | null = null;

/** 登録した音（無ければ null。呼ぶ側は audio()?.… で、無くても進める） */
export function audio(): AudioSystem | null {
    return current;
}
/** 音を作って登録する（boot から 1 回。作れなくても投げない） */
export function installAudio(opts: AudioSystemOptions): AudioSystem | null {
    try {
        current = new AudioSystem(opts);
    } catch (e) {
        console.error(e);
        current = null;
    }
    return current;
}
/** 確かめ用（テスト）：登録を外す */
export function uninstallAudio(): void {
    current = null;
}

/**
 * 利用者の操作（タップ・クリック・キー）で音を有効にする見張りを付ける。外さずに残す（軽い）：
 * 有効になった後も、AudioContext が始まっていない・中断されたまま（アプリから戻った後の resume() を端末が断った・iOS の interrupted）で、
 * アプリの切り替えで止めてもいない間だけ、操作の中で有効にし直す。始まっていれば何もしない。
 * タッチの押し始め（pointerdown）は端末が「操作」と数えないことがあるので、読み上げの下ごしらえは離した時（pointerup・touchend・click）とキーでする。
 */
export function unlockOnGesture(sys: AudioSystem, target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): void {
    const types = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;
    const fn = (e: Event) => {
        if (!sys.needsGesture) return;
        sys.unlock(!(e.type === 'pointerdown' && (e as PointerEvent).pointerType !== 'mouse'));
    };
    for (const t of types) target.addEventListener(t, fn, true);
}
