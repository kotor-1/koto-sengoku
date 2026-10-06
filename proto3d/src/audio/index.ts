/**
 * 音のまとめ役（AudioSystem）と、どこからでも呼べる口（audio()）。設計と確かめ：docs/audio.md。
 *
 * 取り付け（どこも短く。音が無い・失敗しても進行は止めない）：
 * - ui/boot.ts：作って登録する（installAudio）。最初の利用者の操作で有効にする。画面から曲を決める見張り（200 ms ごと）。
 * - ui/view.ts：会話の行（line）・会話を閉じた（stopVoice）・メニューの音の設定。
 * - ui/cinePlayer.ts：演出の場面（cineBeat）・字幕（caption）・一時停止（cinePaused）・終わり（cineEnd）。
 * - main.ts：足音（step）・聞く位置（listener）。
 * - battle/entry.ts：合戦の毎フレーム（battleFrame）・始まり・能力・撤退・終わり。
 */
import { AudioEngine, browserPage, type PageLike } from './engine';
import { cineMusic, creakDelay, sceneFor, type CineBeatInfo, type ScreenInput } from './director';
import { MusicPlayer, browserTimer, offlineRenderer, playNote, type SongRenderer, type TimerLike } from './music';
import { AudioSettingsStore } from './settings';
import { FootstepTracker, Sfx } from './sfx';
import type { SongId } from './songs';
import { VoicePlayer, browserSpeech, type SpeechLike, type UtteranceLike, type VoiceLineLike, type VoiceStatus } from './voice';
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
}

/** 合戦の音に要る形（battle/sim.ts の BattleState の使う所だけ） */
export interface BattleLike {
    units: readonly { status: string; present?: boolean; engagedWith: string | null; shootingAt: string | null }[];
}

export class AudioSystem {
    readonly settings: AudioSettingsStore;
    readonly engine: AudioEngine;
    readonly music: MusicPlayer;
    readonly sfx: Sfx;
    readonly voice: VoicePlayer;
    readonly feet = new FootstepTracker();
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
        const sp = opts.speech ?? browserSpeech();
        this.voice = new VoicePlayer(this.engine, { synth: sp.synth, makeUtterance: sp.makeUtterance, timers: this.timers });
        this.engine.onReady(() => this.ensureAmbienceTimer());
    }

    /**
     * 利用者の操作の中で呼ぶ（何度でもよい）。activation：端末が「操作」と数える入力（タップを離した・クリック・キー）の中か
     * （タッチの押し始めは数えない端末がある。その中では読み上げの下ごしらえをしない）
     */
    unlock(activation = true): boolean {
        const ok = this.engine.unlock();
        if (activation && this.engine.ctx && !this.voice.primed) this.voice.prime();
        this.apply('unlock');
        return ok;
    }

    get voiceStatus(): VoiceStatus {
        return this.voice.status;
    }

    // ---------------- 画面と曲

    /** 章の進行の画面・合戦の画面（boot の見張りから） */
    setScreen(screen: string, battle: boolean): void {
        if (this.screen.screen === screen && this.screen.battle === battle) return;
        // 別の画面へ移った：古い声を止める（会話・演出の中の移り変わりは、それぞれの口で止める）
        if (battle !== this.screen.battle) this.voice.stop();
        this.screen = { screen, battle, cine: this.cine };
        this.apply(`screen:${screen}${battle ? '+battle' : ''}`);
    }

    /** 演出の場面が替わった（null で演出の外） */
    cineBeat(b: CineBeatInfo | null): void {
        const prev = this.cine;
        this.cine = b;
        this.screen = { ...this.screen, cine: b };
        if (b && b.kind === 'stage' && (prev?.event !== b.event || prev?.kind !== 'stage')) {
            const d = creakDelay(b.event);
            if (d !== null) this.sfx.creak(d);
        }
        this.apply(b ? `cine:${b.moment}:${b.kind}${b.event ? `:${b.event}` : ''}` : 'cine:end');
    }
    /** 演出を閉じた（終わり・スキップ・タイトルへ）：声を止め、演出の曲の決めを外す */
    cineEnd(): void {
        this.voice.stop();
        this.cineBeat(null);
    }
    /** 演出の一時停止（自動の一時停止も）：声を止める（再開しても読み直さない） */
    cinePaused(on: boolean): void {
        if (on) this.voice.stop();
    }

    private apply(why: string): void {
        const c = this.screen.cine ? cineMusic(this.screen.cine) : sceneFor(this.screen);
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
        const line = c?.voice ? this.voices.byId(c.voice) : c?.speaker ? this.voices.find(c.speaker, c.text) : undefined;
        if (line && line.text === c!.text) this.voice.say(line);
        else this.voice.stop();
    }
    /** 会話の行が出た（表にある文なら読む。無ければ前の声を止める） */
    line(speaker: string, name: string, text: string): void {
        const v = this.voices.find(speaker, text) ?? (name ? this.voices.find(name, text) : undefined);
        if (v) this.voice.say(v);
        else this.voice.stop();
    }
    /**
     * 表の id の台詞を読む（合戦の掛け声）。読めるときは、読む前に before（字幕を出す）を呼ぶ。返りは読んだ台詞（読めなければ null）
     */
    sayId(id: string, before?: (v: VoiceLineLike) => void): VoiceLineLike | null {
        const v = this.voices.byId(id);
        if (!v || !this.voice.canSay()) return null;
        try {
            before?.(v);
        } catch (e) {
            console.error(e);
        }
        return this.voice.say(v) ? v : null;
    }
    stopVoice(): void {
        this.voice.stop();
    }
    speakerName(speaker: string): string {
        return this.voices.nameOf?.(speaker) ?? '';
    }

    // ---------------- 足音・聞く位置

    /** 探索の毎フレーム（main.ts）：歩き・走りの位相から足音 */
    step(strideTotal: number, speed: number, run: boolean): void {
        const k = this.feet.update(strideTotal, speed, run);
        if (k) this.sfx.step(k);
    }
    listener(x: number, z: number): void {
        this.sfx.setListener(x, z);
    }

    // ---------------- 合戦

    battleFrame(dt: number, s: BattleLike, speed: number, running: boolean): void {
        let engaged = 0;
        let shooting = 0;
        for (const u of s.units) {
            if (u.status !== 'ready' || u.present === false) continue;
            if (u.engagedWith) engaged++;
            else if (u.shootingAt) shooting++;
        }
        this.sfx.battleTick(dt, engaged, shooting, speed, running);
    }
    battleEvent(kind: string, speed: number): void {
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
    }
    battleCue(kind: 'start' | 'ability' | 'end', speed = 1): void {
        this.sfx.battleCue(kind, speed);
    }

    /** 確かめ用の様子 */
    probe() {
        return {
            state: this.engine.state,
            held: this.engine.held,
            ducked: this.engine.isDucked,
            settings: this.settings.get(),
            music: { wanted: this.music.wanted, current: this.music.current, mode: this.music.mode, section: this.music.section(), ready: this.music.ready, audible: this.music.audible, ...this.music.stats },
            voice: { status: this.voice.status, speaking: this.voice.speakingId, ...this.voice.stats, log: this.voice.log.slice(0, 10) },
            sfx: { ...this.sfx.stats, meleeActive: this.sfx.melee.active(this.engine.now()), meleeRefused: this.sfx.melee.refused, cueRefused: this.sfx.cues.refused },
            screen: this.screen.screen,
            battle: this.screen.battle,
            cine: this.cine,
            scenes: this.sceneLog.slice(0, 12),
        };
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
 * 最初の利用者の操作（タップ・クリック・キー）で音を有効にする見張りを付ける（有効になったら外す）。
 * タッチの押し始め（pointerdown）は端末が「操作」と数えないことがあるので、離した時（pointerup・touchend・click）とキーで呼ぶ。
 */
export function unlockOnGesture(sys: AudioSystem, target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): void {
    const types = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;
    const fn = (e: Event) => {
        sys.unlock(!(e.type === 'pointerdown' && (e as PointerEvent).pointerType !== 'mouse'));
        // 外すのは、音が始まり、読み上げの下ごしらえも済んだ（読み上げの無い端末は要らない）後
        const started = sys.engine.state === 'running' || sys.engine.state === 'unavailable';
        if (started && (sys.voice.primed || sys.voiceStatus === 'unsupported')) for (const t of types) target.removeEventListener(t, fn, true);
    };
    for (const t of types) target.addEventListener(t, fn, true);
}
