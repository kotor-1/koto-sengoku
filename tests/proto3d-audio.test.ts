/**
 * 音（proto3d/src/audio/）の自動テスト。偽の AudioContext・speechSynthesis・タイマー・ページで、
 * 設定の保存と読み込み・ミュート、声の止め方（送り・スキップ・場面の移り・アプリの切り替え・重ならない・たまらない）、
 * 曲の切り替えとダッキング、足音（止まると鳴らない）、合戦の発音数の制限、失敗しても進むこと、台詞の読みと表の文の一致を確かめる。
 * ここは自動テストだけ（実際の音の出力は docs/audio.md の確かめの記録）。
 */
import { describe, expect, it } from 'vitest';
import { AudioEngine, DUCK_LEVEL } from '../proto3d/src/audio/engine';
import { AudioSystem, unlockOnGesture, type VoiceTable } from '../proto3d/src/audio/index';
import { FADE_OUT, FIRST_LOOKAHEAD, HANDOFF, LOOKAHEAD, MusicPlayer, RENDER_DELAY_MS, TICK_MS, loopBars, loopPosition, type RenderedSong, type SongRenderer } from '../proto3d/src/audio/music';
import { AUDIO_KEY, AudioSettingsStore, DEFAULT_AUDIO, loadAudioSettings } from '../proto3d/src/audio/settings';
import { FootstepTracker, Sfx, VoiceLimiter } from '../proto3d/src/audio/sfx';
import { BEATS_PER_BAR, SONGS, barAt, barEvents, parseMelody, type SongId } from '../proto3d/src/audio/songs';
import { MUST_KANA, READINGS, readingFor, PROFILES } from '../proto3d/src/audio/readings';
import { cineMusic, sceneFor } from '../proto3d/src/audio/director';
import { VOICE_LINES, VOICE_SPEAKER_NAMES, findVoiceLine } from '../proto3d/src/campaign/ieyasu1570/story/voiceLines';
import { FakePage, FakeSynth, FakeTimers, FakeUtterance, fakeContext, memoryStorage, type FakeAudioContext } from './proto3d-audio-fakes';

const TABLE: VoiceTable = {
    byId: (id) => VOICE_LINES.find((v) => v.id === id),
    find: (s, t) => findVoiceLine(s, t),
    nameOf: (s) => (VOICE_SPEAKER_NAMES as Record<string, string>)[s] ?? '',
};

/** 偽物で組んだ音のまとめ役 */
function makeSystem(opts: { storage?: ReturnType<typeof memoryStorage> | null; synth?: FakeSynth | null; noContext?: boolean } = {}) {
    const { ctx, create } = fakeContext();
    const page = new FakePage();
    const timers = new FakeTimers();
    const synth = opts.synth === undefined ? new FakeSynth() : opts.synth;
    const storage = opts.storage === undefined ? memoryStorage() : opts.storage;
    const sys = new AudioSystem({
        storage,
        voices: TABLE,
        createContext: opts.noContext
            ? () => {
                  throw new Error('Web Audio が使えない');
              }
            : create,
        page,
        speech: { synth, makeUtterance: (t) => new FakeUtterance(t) },
        timers,
    });
    /** 音の時計と、タイマーを一緒に進める（秒） */
    const run = (sec: number, stepMs = TICK_MS) => {
        for (let t = 0; t < sec * 1000 - 1e-6; t += stepMs) {
            ctx.advance(stepMs / 1000);
            timers.run(stepMs);
        }
    };
    return { sys, ctx, page, timers, synth, storage, run };
}

async function settle() {
    await Promise.resolve();
    await Promise.resolve();
}

// ================================================================ 設定

describe('音の設定（koto-sengoku/3d-audio）', () => {
    it('無ければ既定。読むだけでは書かない。変えたときだけ、そのキーだけに書く', () => {
        const st = memoryStorage({ 'koto-sengoku/3d-ieyasu1570': '{"keep":1}' });
        const s = new AudioSettingsStore(st);
        expect(s.get()).toEqual(DEFAULT_AUDIO);
        expect(st.writes).toEqual([]);
        s.set({ muted: true, bgm: 0.25 });
        expect(st.writes).toEqual([AUDIO_KEY]);
        expect(st.map.get('koto-sengoku/3d-ieyasu1570')).toBe('{"keep":1}');
        const back = loadAudioSettings(st);
        expect(back).toEqual({ ...DEFAULT_AUDIO, muted: true, bgm: 0.25 });
    });
    it('壊れた値・範囲の外・読めない保存領域でも既定で動く（値は 0〜1）', () => {
        expect(loadAudioSettings(memoryStorage({ [AUDIO_KEY]: '{oops' }))).toEqual(DEFAULT_AUDIO);
        expect(loadAudioSettings(memoryStorage({ [AUDIO_KEY]: '{"muted":"yes","bgm":7,"voice":-1,"sfx":null}' }))).toEqual({ ...DEFAULT_AUDIO, bgm: 1, voice: 0 });
        const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
        const s = new AudioSettingsStore(broken);
        expect(s.get()).toEqual(DEFAULT_AUDIO);
        expect(s.set({ sfx: 0.5 })).toBe(false);
        expect(s.get().sfx).toBe(0.5);
        expect(new AudioSettingsStore(null).set({ muted: true })).toBe(false);
    });
    it('ミュート：マスターを 0 に、戻すと 1 に。音量は各バスへ（2 乗の曲線）', () => {
        const { sys } = makeSystem();
        sys.unlock();
        const e = sys.engine;
        expect(e.master!.gain.value).toBe(1);
        sys.settings.set({ muted: true });
        expect(e.master!.gain.value).toBe(0);
        sys.settings.set({ muted: false, bgm: 0.5, sfx: 1, voice: 0.4 });
        expect(e.master!.gain.value).toBe(1);
        expect(e.bgm!.gain.value).toBeCloseTo(0.25);
        expect(e.sfx!.gain.value).toBeCloseTo(1);
        expect(e.voiceBus!.gain.value).toBeCloseTo(0.4);
    });
    it('保存した設定を次の起動で読む', () => {
        const st = memoryStorage();
        makeSystem({ storage: st }).sys.settings.set({ muted: true, voice: 0.3 });
        const b = makeSystem({ storage: st });
        b.sys.unlock();
        expect(b.sys.settings.get()).toMatchObject({ muted: true, voice: 0.3 });
        expect(b.sys.engine.master!.gain.value).toBe(0);
    });
});

// ================================================================ 有効にする・失敗しても進む

describe('有効にする・失敗しても進む', () => {
    it('利用者の操作（unlock）までは AudioContext を作らない。作った後は 1 つだけ', async () => {
        const { sys, ctx } = makeSystem();
        sys.setScreen('explore', false);
        expect(sys.engine.ctx).toBeNull();
        expect(sys.music.wanted).toBe('town');
        sys.unlock();
        sys.unlock();
        await settle();
        expect(sys.engine.ctx).toBe(ctx as unknown as AudioContext);
        expect(sys.engine.state).toBe('running');
        // 有効になったら、決めてあった曲が始まる
        expect(sys.music.current).toBe('town');
    });
    it('最初の操作で有効にする：タッチの押し始めでは読み上げの下ごしらえをせず、離した時にする。有効になったら見張りを外す', async () => {
        const { sys, synth } = makeSystem();
        const ls = new Map<string, (e: Event) => void>();
        const target = {
            addEventListener: (t: string, fn: (e: Event) => void) => void ls.set(t, fn),
            removeEventListener: (t: string) => void ls.delete(t),
        } as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>;
        unlockOnGesture(sys, target);
        expect([...ls.keys()].sort()).toEqual(['click', 'keydown', 'pointerdown', 'pointerup', 'touchend']);
        ls.get('pointerdown')!({ type: 'pointerdown', pointerType: 'touch' } as unknown as Event);
        expect(sys.engine.ctx).not.toBeNull();
        expect(synth!.queue.length + synth!.cancels).toBe(0);
        expect(sys.voice.primed).toBe(false);
        await settle();
        ls.get('pointerup')!({ type: 'pointerup', pointerType: 'touch' } as unknown as Event);
        expect(sys.voice.primed).toBe(true);
        // 見張りは残す（軽い）。始まっていれば何もしない
        expect(ls.size).toBe(5);
        expect(sys.needsGesture).toBe(false);
    });
    it('戻った後に端末が止めたまま（resume を断った・interrupted）なら、次の操作の中で始め直す。アプリの切り替えで止めている間はしない', async () => {
        const { sys, ctx, page } = makeSystem();
        const ls = new Map<string, (e: Event) => void>();
        const target = {
            addEventListener: (t: string, fn: (e: Event) => void) => void ls.set(t, fn),
            removeEventListener: (t: string) => void ls.delete(t),
        } as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>;
        unlockOnGesture(sys, target);
        ls.get('click')!({ type: 'click' } as Event);
        await settle();
        expect(sys.engine.state).toBe('running');
        const n = ctx.resumes;
        ls.get('click')!({ type: 'click' } as Event);
        expect(ctx.resumes).toBe(n);
        // 隠れている間は、操作が来ても始めない
        page.hide();
        ctx.autoResume = false;
        ls.get('keydown')!({ type: 'keydown' } as Event);
        expect(sys.engine.state).toBe('paused');
        // 戻った（ジェスチャーの外の resume は始まらない）→ 止めたまま
        page.show();
        await settle();
        expect(sys.engine.state).toBe('locked');
        expect(sys.needsGesture).toBe(true);
        ctx.autoResume = true;
        const m = ctx.resumes;
        ls.get('pointerup')!({ type: 'pointerup', pointerType: 'touch' } as unknown as Event);
        await settle();
        expect(ctx.resumes).toBe(m + 1);
        expect(sys.engine.state).toBe('running');
        // iOS の interrupted のまね：端末が止めた → 次の操作で始め直す
        ctx.interrupt();
        expect(sys.engine.state).toBe('locked');
        ls.get('click')!({ type: 'click' } as Event);
        await settle();
        expect(sys.engine.state).toBe('running');
    });
    it('「はじめから」の操作の中で始めた直後（始まりの知らせの前）から最初の音を予約する。最初の予約は長め、描くのは最初の予約の後', async () => {
        const f: string[] = [];
        const { ctx, create } = fakeContext();
        ctx.autoResume = false;
        const timers = new FakeTimers();
        const sys = new AudioSystem({
            storage: null,
            voices: TABLE,
            createContext: create,
            page: null,
            speech: { synth: new FakeSynth(), makeUtterance: (t) => new FakeUtterance(t) },
            timers,
            renderer: (id) => {
                f.push(id);
                return new Promise(() => {});
            },
        });
        sys.unlock();
        sys.cineBeat({ moment: 'ch1_open', kind: 'stage', event: 'town_life' });
        expect(sys.engine.state).toBe('locked');
        expect(sys.engine.canSchedule).toBe(true);
        expect(sys.music.current).toBe('town');
        const starts = ctx.starts;
        // 始まりの前（時刻 0 のまま）に、FIRST_LOOKAHEAD 秒先までの音を予約した
        const last = Math.max(...starts.map((x) => x.t));
        expect(sys.music.stats.scheduled).toBeGreaterThan(20);
        expect(last).toBeGreaterThan(FIRST_LOOKAHEAD - 1.5);
        // 描くのは最初の予約の RENDER_DELAY_MS 後から（それまで主のスレッドで音のつながりを作らない）
        expect(f).toEqual([]);
        timers.run(RENDER_DELAY_MS - 10);
        expect(f).toEqual([]);
        timers.run(20);
        await settle();
        expect(f[0]).toBe('town');
        // 始まった後は、ふつうに続ける
        ctx.start();
        await settle();
        expect(sys.engine.state).toBe('running');
    });
    it('音の口の中の誤りで、呼ぶ側を止めない（演出の字幕・場面・会話の行・合戦・足音）', () => {
        const bad: VoiceTable = {
            byId: () => {
                throw new Error('表が壊れた');
            },
            find: () => {
                throw new Error('表が壊れた');
            },
        };
        const { ctx, create } = fakeContext();
        const sys = new AudioSystem({ storage: null, voices: bad, createContext: create, page: null, speech: { synth: new FakeSynth(), makeUtterance: (t) => new FakeUtterance(t) }, timers: new FakeTimers(), renderer: null });
        sys.unlock();
        void ctx;
        expect(() => {
            sys.caption({ speaker: '忠勝', text: 'x', voice: 'y' });
            sys.line('hero', '家康', 'x');
            expect(sys.sayId('depart.hero')).toBeNull();
            sys.battleFrame(0.1, null as unknown as { units: [] }, 1, true);
            sys.step(NaN, 1, false);
            sys.cineBeat({ moment: 'ch1_open', kind: 'stage', event: 'town_life' });
            sys.cineEnd();
        }).not.toThrow();
    });
    it('Web Audio が無い端末でも、読み上げがあれば操作の後に声を出す（下ごしらえは 1 回だけ）', () => {
        const synth = new FakeSynth();
        const sys = new AudioSystem({
            storage: null,
            voices: TABLE,
            createContext: () => {
                throw new Error('Web Audio が無い');
            },
            page: null,
            speech: { synth, makeUtterance: (t) => new FakeUtterance(t) },
            timers: new FakeTimers(),
            renderer: null,
        });
        expect(sys.sayId('depart.hero')).toBeNull();
        sys.unlock();
        expect(sys.engine.state).toBe('unavailable');
        expect(sys.voice.primed).toBe(true);
        expect(sys.needsGesture).toBe(false);
        expect(sys.sayId('depart.hero')?.id).toBe('depart.hero');
        expect(synth.spoken.map((u) => u.text)).toEqual([READINGS['depart.hero']!.reading]);
    });
    it('Web Audio が使えない端末：投げず、すべての口が何もしないで返る', () => {
        const { sys, run } = makeSystem({ noContext: true });
        expect(() => {
            expect(sys.unlock()).toBe(false);
            sys.setScreen('explore', false);
            sys.step(3.2, 1.4, false);
            sys.caption({ speaker: '織田家の使者', text: '徳川殿にも、兵を出していただきたい。', voice: 'ch1.oda_envoy.ask' });
            sys.battleFrame(0.1, { units: [{ status: 'ready', engagedWith: 'x', shootingAt: null }] }, 1, true);
            sys.battleCue('start');
            sys.cineEnd();
            run(1);
        }).not.toThrow();
        expect(sys.engine.state).toBe('unavailable');
    });
    it('読み上げが無い・投げる端末：声は出さず（字幕だけ）、投げない', () => {
        const none = makeSystem({ synth: null });
        none.sys.unlock();
        expect(none.sys.voiceStatus).toBe('unsupported');
        expect(none.sys.sayId('depart.hero')).toBeNull();
        const bad = new FakeSynth();
        bad.throwOnSpeak = true;
        const b = makeSystem({ synth: bad });
        b.sys.unlock();
        expect(() => b.sys.sayId('depart.hero')).not.toThrow();
        expect(b.sys.engine.isDucked).toBe(false);
    });
    it('日本語の声が無い端末：声なし（status no_japanese）', () => {
        const { sys, synth } = makeSystem({ synth: new FakeSynth([{ name: 'Samantha', lang: 'en-US' }]) });
        sys.unlock();
        expect(sys.voiceStatus).toBe('no_japanese');
        expect(sys.sayId('depart.hero')).toBeNull();
        expect(synth!.spoken).toHaveLength(0);
    });
});

// ================================================================ 声

describe('声（端末の読み上げ）：読み・止め方', () => {
    it('表の台詞を、音声用の読みで、話し手ごとの高さ・速さで読む（日本語）', () => {
        const { sys, synth } = makeSystem();
        sys.unlock();
        const v = sys.sayId('ch1.tadakatsu.council');
        expect(v?.text).toBe('殿、軍議を開きましょう。城門の前でお待ちします。');
        const u = synth!.spoken[0]!;
        expect(u.text).toBe(READINGS['ch1.tadakatsu.council']!.reading);
        expect(u.text.startsWith('との、')).toBe(true);
        expect(u.lang).toBe('ja-JP');
        expect(u.pitch).toBe(PROFILES.tadakatsu!.pitch);
        expect(u.rate).toBe(PROFILES.tadakatsu!.rate);
        expect(u.volume).toBeCloseTo(DEFAULT_AUDIO.voice);
    });
    it('会話の行：表にある文だけ読み、行を送ると前の声を止める（同時に 2 人が話さない）', () => {
        const { sys, synth } = makeSystem();
        sys.unlock();
        sys.line('hero', '家康', '両家から、同じ日にか。');
        expect(synth!.spoken.map((u) => u.text)).toEqual([READINGS['talk.hero.same_day']!.reading]);
        // 次の行（表に無い文）へ送った：止める
        sys.line('tadakatsu', '忠勝', '表に無い長い説明の行。');
        expect(synth!.queue).toHaveLength(0);
        expect(synth!.cancels).toBeGreaterThanOrEqual(1);
        // 続けて 2 つ読んでも、待ちは 1 つまで
        sys.line('hero', '家康', '両家から、同じ日にか。');
        sys.line('tadakatsu', '忠勝', '皆、陣幕の内に控えております。軍議を開かれますか。');
        expect(synth!.maxQueue).toBe(1);
        expect(synth!.queue.map((u) => u.text)).toEqual([READINGS['talk.tadakatsu.again']!.reading]);
    });
    it('演出：字幕が替わると前の声を止めて読む・一時停止で止め、再開しても読み直さない・スキップ（終わり）で止める', () => {
        const { sys, synth } = makeSystem();
        sys.unlock();
        sys.caption({ speaker: '織田家の使者', text: '徳川殿にも、兵を出していただきたい。', voice: 'ch1.oda_envoy.ask' });
        expect(synth!.queue).toHaveLength(1);
        sys.caption({ speaker: '浅井家の使者', text: '主は、徳川殿と手を結びたいと。', voice: 'ch1.asai_envoy.ask' });
        expect(synth!.maxQueue).toBe(1);
        expect(synth!.queue[0]!.text).toBe(READINGS['ch1.asai_envoy.ask']!.reading);
        sys.cinePaused(true);
        expect(synth!.queue).toHaveLength(0);
        const n = synth!.spoken.length;
        sys.cinePaused(false);
        expect(synth!.spoken.length).toBe(n);
        sys.caption({ speaker: '忠勝', text: '殿、軍議を開きましょう。城門の前でお待ちします。', voice: 'ch1.tadakatsu.council' });
        expect(synth!.queue).toHaveLength(1);
        sys.cineEnd();
        expect(synth!.queue).toHaveLength(0);
        // 字幕の文が表と違う（声の id だけ合う）なら読まない（字幕と声の言葉をそろえる）
        sys.caption({ speaker: '忠勝', text: '別の文', voice: 'ch1.tadakatsu.council' });
        expect(synth!.queue).toHaveLength(0);
    });
    it('別の場面へ移る（合戦の画面に入る）と止める', () => {
        const { sys, synth } = makeSystem();
        sys.unlock();
        sys.setScreen('cinematic', false);
        sys.sayId('depart.hero');
        expect(synth!.queue).toHaveLength(1);
        sys.setScreen('battle', true);
        expect(synth!.queue).toHaveLength(0);
    });
    it('アプリを切り替えると止め、戻っても読み直さない。切り替えている間の台詞はためない', async () => {
        const { sys, synth, page, ctx } = makeSystem();
        sys.unlock();
        await settle();
        sys.sayId('depart.hero');
        page.hide();
        expect(ctx.suspends).toBe(1);
        expect(synth!.queue).toHaveLength(0);
        // 隠れている間の台詞（合戦の掛け声など）は読まない
        expect(sys.sayId('battle.retreat')).toBeNull();
        const n = synth!.spoken.length;
        page.show();
        await settle();
        expect(ctx.resumes).toBeGreaterThanOrEqual(2);
        expect(synth!.spoken.length).toBe(n);
        expect(synth!.queue).toHaveLength(0);
        // blur・pagehide でも止める
        page.fire('blur');
        expect(sys.engine.held).toBe(true);
        page.fire('focus');
        expect(sys.engine.held).toBe(false);
        page.fire('pagehide');
        expect(sys.engine.held).toBe(true);
        page.fire('pageshow');
        expect(sys.engine.held).toBe(false);
    });
    it('ミュート・声の音量 0 では読まず、読んでいる声も止める', () => {
        const { sys, synth } = makeSystem();
        sys.unlock();
        sys.sayId('depart.hero');
        sys.settings.set({ muted: true });
        expect(synth!.queue).toHaveLength(0);
        expect(sys.sayId('depart.hero')).toBeNull();
        sys.settings.set({ muted: false, voice: 0 });
        expect(sys.sayId('depart.hero')).toBeNull();
    });
    it('有効にする前（利用者の操作の前）は読まない', () => {
        const { sys, synth } = makeSystem();
        expect(sys.sayId('depart.hero')).toBeNull();
        expect(synth!.spoken).toHaveLength(0);
    });
});

// ================================================================ 曲

function musicOnly(renderer: SongRenderer | null = null) {
    const { ctx, create } = fakeContext();
    const page = new FakePage();
    const engine = new AudioEngine({ settings: new AudioSettingsStore(null), createContext: create, page });
    const timers = new FakeTimers();
    const played: { t: number; inst: string; song: SongId | null }[] = [];
    let tag: SongId | null = null;
    const music = new MusicPlayer(engine, timers, (_c, _o, t, e) => played.push({ t, inst: e.inst, song: tag }), renderer);
    engine.unlock();
    const run = (sec: number, stepMs = TICK_MS) => {
        for (let t = 0; t < sec * 1000 - 1e-6; t += stepMs) {
            ctx.advance(stepMs / 1000);
            timers.run(stepMs);
        }
    };
    return { ctx, engine, music, played, run, timers, setTag: (s: SongId | null) => (tag = s), page };
}

describe('BGM：曲の切り替え・先読み・時計', () => {
    it('同じ曲をもう一度選んでも始め直さない。切り替えは短いフェードで、後に鳴り続けるのは 1 曲だけ', async () => {
        const m = musicOnly();
        await settle();
        m.music.play('town');
        m.run(2);
        m.music.play('town');
        m.music.play('town');
        expect(m.music.stats.starts).toBe(1);
        m.music.play('battle');
        expect(m.music.audible).toEqual(['battle', 'town']);
        m.run(FADE_OUT + 0.3);
        expect(m.music.audible).toEqual(['battle']);
        m.music.play('crisis');
        m.music.play('town');
        m.run(FADE_OUT + 0.3);
        expect(m.music.audible).toEqual(['town']);
        m.music.play(null);
        m.run(FADE_OUT + 0.3);
        expect(m.music.audible).toEqual([]);
        // 止めた後は予約しない
        const n = m.music.stats.scheduled;
        m.run(3);
        expect(m.music.stats.scheduled).toBe(n);
    });
    it('予約は AudioContext の時計で決まる（タイマーの間隔がばらついても、同じ時間に同じ数の音）', async () => {
        const a = musicOnly();
        const b = musicOnly();
        await settle();
        a.music.play('battle');
        b.music.play('battle');
        a.run(20, 50);
        // b はタイマーが遅れがち（間隔 50〜250 ms）
        let left = 20000;
        let k = 0;
        while (left > 0) {
            const step = Math.min(left, [50, 250, 120, 80][k++ % 4]!);
            b.ctx.advance(step / 1000);
            b.timers.run(step);
            left -= step;
        }
        // 予約済みの音の時刻は同じ（先読みの端の差だけ）
        const ta = a.played.filter((p) => p.t < 19).map((p) => p.t.toFixed(4));
        const tb = b.played.filter((p) => p.t < 19).map((p) => p.t.toFixed(4));
        expect(tb).toEqual(ta);
        expect(a.music.stats.dropped).toBe(0);
    });
    it('タイマーが大きく遅れた（裏に回った）後に、過ぎた音をまとめて鳴らさない', async () => {
        const m = musicOnly();
        await settle();
        m.music.play('town');
        m.run(3);
        const before = m.played.length;
        // 5 秒タイマーが動かない（AudioContext は進む）
        m.ctx.advance(5);
        m.timers.run(TICK_MS);
        const now = m.ctx.currentTime;
        const late = m.played.slice(before).filter((p) => p.t < now - 0.05);
        expect(late).toHaveLength(0);
        // 先読みの範囲より先は予約しない
        expect(Math.max(...m.played.map((p) => p.t))).toBeLessThanOrEqual(now + LOOKAHEAD + 1e-9);
    });
    it('アプリを切り替えている間は予約しない（戻った後も、たまった音を鳴らさない）', async () => {
        const m = musicOnly();
        await settle();
        m.music.play('crisis');
        m.run(2);
        m.page.hide();
        const n = m.played.length;
        m.run(5);
        expect(m.played.length).toBe(n);
        m.page.show();
        await settle();
        m.run(0.5);
        const now = m.ctx.currentTime;
        expect(m.played.slice(n).every((p) => p.t >= now - 0.6)).toBe(true);
    });
});

describe('BGM：描いた輪（音の処理の側で鳴らす。描画が止まっても途切れない）', () => {
    /** 偽の描き手：呼ばれた曲を記録し、resolve を手で呼ぶ */
    function fakeRenderer() {
        const calls: string[] = [];
        const waits = new Map<string, (r: RenderedSong) => void>();
        const make = (id: SongId): RenderedSong => {
            const { intro, loop } = loopBars(id);
            const sec = (60 / SONGS[id].bpm) * BEATS_PER_BAR;
            return { buffer: { duration: (intro + loop) * sec + 3.5 } as AudioBuffer, loopStart: intro * sec, loopEnd: (intro + loop) * sec };
        };
        const r: SongRenderer = (id) => {
            calls.push(id);
            return new Promise((res) => waits.set(id, () => res(make(id))));
        };
        return { r, calls, finish: (id: SongId) => waits.get(id)?.(make(id)) };
    }
    const sources = (ctx: FakeAudioContext) => ctx.starts.filter((s) => s.kind === 'buffer').map((s) => s.node as unknown as { startedAt: number; offset: number; stoppedAt: number | null; loop: boolean; loopStart: number; loopEnd: number });

    it('有効になったら、今の曲から 3 曲を 1 曲ずつ描く。描き終わった曲は、予約せずに輪で鳴らす', async () => {
        const f = fakeRenderer();
        const m = musicOnly(f.r);
        m.music.play('battle');
        await settle();
        // 描くのは最初の予約の後（RENDER_DELAY_MS）から
        expect(f.calls).toEqual([]);
        m.run(RENDER_DELAY_MS / 1000 + 0.1);
        await settle();
        expect(f.calls).toContain('battle');
        expect(m.music.mode).toBe('live');
        f.finish('battle');
        for (let i = 0; i < 6; i++) await settle();
        expect(m.music.mode).toBe('loop');
        // 1 曲ずつ（描き終わってから次）
        expect(f.calls.length).toBeLessThanOrEqual(2);
        f.finish('town');
        for (let i = 0; i < 6; i++) await settle();
        f.finish('crisis');
        for (let i = 0; i < 6; i++) await settle();
        expect(m.music.ready.sort()).toEqual(['battle', 'crisis', 'town']);
        // 町の曲へ：予約の音は作らず、輪の頭から
        const n = m.played.length;
        m.music.play('town');
        m.run(5);
        expect(m.music.mode).toBe('loop');
        expect(m.played.length).toBe(n);
        const src = sources(m.ctx)[sources(m.ctx).length - 1]!;
        expect(src.loop).toBe(true);
        expect(src.offset).toBe(0);
        // 輪は曲の 1 周（合戦は頭の段の後から繰り返す）
        const b = loopBars('battle');
        expect(b.intro).toBe(2);
        const battleSrc = sources(m.ctx)[0]!;
        expect(battleSrc.loopStart).toBeCloseTo(2 * (60 / SONGS.battle.bpm) * 4);
        // 前の曲（合戦）の輪はフェードの終わりで止める
        expect(battleSrc.stoppedAt).not.toBeNull();
        m.run(FADE_OUT + 0.3);
        expect(m.music.audible).toEqual(['town']);
    });
    it('描き終わるまでは予約で鳴らし、描き終わったら同じ位置から輪へ受け渡す（受け渡しの後は予約しない）', async () => {
        const f = fakeRenderer();
        const m = musicOnly(f.r);
        await settle();
        m.music.play('crisis');
        m.run(7.3);
        await settle();
        expect(m.music.mode).toBe('live');
        expect(m.played.length).toBeGreaterThan(0);
        f.finish('crisis');
        await settle();
        await settle();
        expect(m.music.mode).toBe('loop');
        const src = sources(m.ctx)[sources(m.ctx).length - 1]!;
        // 曲の頭（始めた 0.05 秒後）からの位置
        expect(src.offset).toBeCloseTo(src.startedAt - 0.05, 3);
        // 受け渡しの後は新しく予約しない。先に予約してあった音（先読みの分）は、予約の出口の音量を HANDOFF 秒で 0 にして消す
        const n = m.played.length;
        m.run(6);
        expect(m.played.length).toBe(n);
        const faded = m.ctx.nodes.some((nd) => {
            const g = (nd as unknown as { gain?: { calls: { m: string; v: number; t: number }[] } }).gain;
            return !!g?.calls.some((c) => c.m === 'lin' && c.v === 0 && Math.abs(c.t - (src.startedAt + HANDOFF)) < 1e-6);
        });
        expect(faded).toBe(true);
    });
    it('描けない端末では予約のまま続ける', async () => {
        const m = musicOnly(() => Promise.reject(new Error('描けない')));
        await settle();
        m.music.play('town');
        await settle();
        await settle();
        m.run(3);
        expect(m.music.mode).toBe('live');
        expect(m.played.length).toBeGreaterThan(10);
    });
    it('輪の位置：頭の段の後は loopStart〜loopEnd を繰り返す', () => {
        const r = { loopStart: 3, loopEnd: 13 };
        expect(loopPosition(r, 0)).toBe(0);
        expect(loopPosition(r, 12.5)).toBe(12.5);
        expect(loopPosition(r, 13)).toBe(3);
        expect(loopPosition(r, 27.5)).toBeCloseTo(7.5);
    });
});

describe('ダッキング：声の間は BGM を下げる', () => {
    it('読み始めで下げ、終わり・止めたら戻す。古い声の終わりの知らせで、新しい声の下げを外さない', () => {
        const { sys, synth } = makeSystem();
        sys.unlock();
        const duck = sys.engine.duckGain!.gain;
        expect(duck.value).toBe(1);
        sys.sayId('ch1.oda_envoy.ask');
        expect(sys.engine.isDucked).toBe(true);
        expect(duck.value).toBeCloseTo(DUCK_LEVEL);
        synth!.finish();
        expect(sys.engine.isDucked).toBe(false);
        expect(duck.value).toBe(1);
        // 古い発話を取っておき、新しい声の後にその終わりの知らせが来ても下げたまま
        sys.sayId('ch1.oda_envoy.ask');
        const old = synth!.queue[0]!;
        sys.sayId('ch1.asai_envoy.ask');
        old.onend?.();
        expect(sys.engine.isDucked).toBe(true);
        sys.stopVoice();
        expect(sys.engine.isDucked).toBe(false);
    });
    it('終わりの知らせが来ない端末でも、長さの見込みの後に戻す', () => {
        const { sys, synth, run } = makeSystem();
        sys.unlock();
        sys.sayId('depart.hero');
        synth!.queue[0]!.onend = null;
        synth!.queue[0]!.onerror = null;
        run(8);
        expect(sys.engine.isDucked).toBe(false);
    });
});

describe('画面と曲（director）', () => {
    it('城下・軍議・合戦・タイトル、出陣と帰還の演出', async () => {
        const { sys } = makeSystem();
        sys.unlock();
        await settle();
        sys.setScreen('title', false);
        expect(sys.music.wanted).toBeNull();
        sys.setScreen('explore', false);
        expect(sys.music.wanted).toBe('town');
        sys.setScreen('menu', false);
        expect(sys.music.wanted).toBe('town');
        sys.setScreen('council', false);
        expect(sys.music.wanted).toBe('crisis');
        sys.setScreen('situation', false);
        expect(sys.music.wanted).toBe('crisis');
        sys.setScreen('explore', false);
        sys.setScreen('cinematic', false);
        sys.cineBeat({ moment: 'departure', kind: 'stage', event: 'column_depart' });
        expect(sys.music.wanted).toBe('battle');
        sys.cineEnd();
        sys.setScreen('battle', false);
        expect(sys.music.wanted).toBe('battle');
        sys.setScreen('battle', true);
        expect(sys.music.wanted).toBe('battle');
        sys.setScreen('cinematic', false);
        sys.cineBeat({ moment: 'return', kind: 'stage', event: 'column_return', victory: false });
        expect(sys.music.wanted).toBe('crisis');
        sys.cineBeat({ moment: 'return', kind: 'stage', event: 'column_return', victory: true });
        expect(sys.music.wanted).toBe('town');
        sys.cineEnd();
        sys.setScreen('explore', false);
        expect(sys.music.wanted).toBe('town');
    });
    it('章の冒頭：町の様子は城下、急報（使者・家臣の報告）は危機の曲。木戸を通る出来事できしみ', async () => {
        const { sys } = makeSystem();
        sys.unlock();
        await settle();
        sys.cineBeat({ moment: 'ch1_open', kind: 'stage', event: 'town_life' });
        expect(sys.music.wanted).toBe('town');
        const creaks = sys.sfx.stats.creaks;
        sys.cineBeat({ moment: 'ch1_open', kind: 'stage', event: 'envoys_arrive' });
        expect(sys.music.wanted).toBe('crisis');
        expect(sys.sfx.stats.creaks).toBe(creaks + 1);
        sys.cineBeat({ moment: 'ch1_open', kind: 'stage', event: 'retainer_report' });
        expect(sys.music.wanted).toBe('crisis');
        expect(cineMusic({ moment: 'ch1_intro', kind: 'map' }).music).toBe('crisis');
        expect(sceneFor({ screen: 'practice', battle: false, cine: null }).music).toBeNull();
    });
    it('前の合戦で勝てなかった後の結果確認・結末・第二章の冒頭の町の場面は、明るい城下の曲にしない', async () => {
        const { sys } = makeSystem();
        sys.unlock();
        await settle();
        sys.setScreen('record', false, true);
        expect(sys.music.wanted).toBe('crisis');
        sys.setScreen('record', false, false);
        expect(sys.music.wanted).toBe('town');
        sys.setScreen('cinematic', false, true);
        sys.cineBeat({ moment: 'ch2_open', kind: 'stage', event: 'wounded_rest' });
        expect(sys.music.wanted).toBe('crisis');
        sys.cineBeat({ moment: 'ch2_open', kind: 'stage', event: 'town_life' });
        expect(sys.music.wanted).toBe('crisis');
        sys.cineEnd();
        sys.setScreen('ending', false, true);
        expect(sys.music.wanted).toBe('crisis');
        // 探索は勝ち負けにかかわらず城下（依頼：城下＝探索）
        sys.setScreen('explore', false, true);
        expect(sys.music.wanted).toBe('town');
        expect(cineMusic({ moment: 'ch2_open', kind: 'stage', event: 'wounded_rest' }).music).toBe('town');
        expect(cineMusic({ moment: 'ch2_open', kind: 'stage', event: 'wounded_rest' }, true).music).toBe('crisis');
    });
});

// ================================================================ 楽譜

describe('楽譜：旋律・伴奏・打楽器と段の変化（短い単音の繰り返しではない）', () => {
    for (const id of Object.keys(SONGS) as SongId[]) {
        it(`${id}：小節の拍がそろい、段ごとに旋律が違い、3 つの層がある`, () => {
            const song = SONGS[id];
            for (const [name, s] of Object.entries(song.sections)) {
                const bars = parseMelody(s.melody);
                expect(bars.length, `${name} の小節の数`).toBe(s.harmony.length);
                bars.forEach((b, i) => expect(b.reduce((a, n) => a + n.beats, 0), `${name} ${i + 1} 小節目`).toBeCloseTo(BEATS_PER_BAR));
            }
            const melodies = new Set(Object.values(song.sections).filter((s) => s.lead).map((s) => s.melody));
            expect(melodies.size).toBeGreaterThanOrEqual(2);
            const total = song.order.reduce((a, n) => a + song.sections[n]!.harmony.length, 0);
            const insts = new Set<string>();
            const pitches = new Set<number>();
            for (let i = 0; i < total; i++) {
                for (const e of barEvents(song, i)) {
                    insts.add(e.inst);
                    if (e.inst === 'fue' || e.inst === 'shaku') pitches.add(e.midi);
                }
            }
            expect(insts.has('koto')).toBe(true);
            expect(insts.has('fue') || insts.has('shaku')).toBe(true);
            expect(insts.has('taiko') || insts.has('shime')).toBe(true);
            expect(pitches.size).toBeGreaterThanOrEqual(6);
            // 繰り返し：最後の小節の次は loopFrom の段の頭
            expect(barAt(song, total).section).toBe(song.sections[song.order[song.loopFrom]!]);
        });
    }
});

// ================================================================ 足音

describe('足音：歩き・走りの位相に合わせ、止まると鳴らない', () => {
    it('半周ごとに 1 歩。止まっている間は位相が動いても鳴らさない', () => {
        const f = new FootstepTracker();
        let total = 0;
        let steps = 0;
        // 歩く：1 周期 1.4 m・1.4 m/秒 → 1 秒 1 周期。60 コマで 3 秒
        for (let i = 0; i < 180; i++) {
            total += 1 / 60;
            if (f.update(total, 1.4, false)) steps++;
        }
        expect(steps).toBeGreaterThanOrEqual(5);
        expect(steps).toBeLessThanOrEqual(6);
        // 止まる
        let still = 0;
        for (let i = 0; i < 120; i++) if (f.update(total, 0, false)) still++;
        expect(still).toBe(0);
        // 止まりかけ（ごく遅い・位相が少し進む）も鳴らさない
        for (let i = 0; i < 60; i++) {
            total += 0.01;
            if (f.update(total, 0.1, false)) still++;
        }
        expect(still).toBe(0);
        // 走る
        expect([...Array(60)].map(() => f.update((total += 1 / 30), 3, true)).filter((x) => x === 'run').length).toBeGreaterThan(0);
    });
    it('まとめ役：歩けば効果音のバスに足音、止まれば鳴らない', async () => {
        const { sys, ctx } = makeSystem();
        sys.unlock();
        await settle();
        let total = 0;
        for (let i = 0; i < 120; i++) {
            total += 1.4 / 60 / 1.4;
            sys.step(total, 1.4, false);
        }
        const n = sys.sfx.stats.footsteps;
        expect(n).toBeGreaterThanOrEqual(3);
        for (let i = 0; i < 120; i++) sys.step(total, 0, false);
        expect(sys.sfx.stats.footsteps).toBe(n);
        expect(ctx.starts.length).toBeGreaterThan(0);
    });
});

// ================================================================ 合戦

describe('合戦の効果音：発音数と 1 秒あたりの数の制限、倍速では間引く', () => {
    it('VoiceLimiter：同時の数・1 秒の数を超えない', () => {
        const l = new VoiceLimiter(4, 6);
        let ok = 0;
        // 0.3 秒鳴る音を 0.01 秒ごとに：最初の 0.29 秒は同時の 4 まで、1 秒では 6 まで
        for (let i = 0; i < 30; i++) if (l.tryStart(i * 0.01, 0.3)) ok++;
        expect(ok).toBe(4);
        for (let i = 30; i < 100; i++) if (l.tryStart(i * 0.01, 0.3)) ok++;
        expect(ok).toBe(6);
        let ok2 = 0;
        for (let i = 0; i < 100; i++) if (l.tryStart(2 + i * 0.01, 0.05)) ok2++;
        expect(ok2).toBe(6);
    });
    it('40 部隊が斬り合っても、1 秒に 6 まで・同時に 4 まで。倍速では 1 秒に 3 まで', async () => {
        for (const [speed, cap] of [[1, 6], [2, 3]] as const) {
            const { sys, ctx } = makeSystem();
            sys.unlock();
            await settle();
            const units = Array.from({ length: 40 }, (_, i) => ({ status: 'ready', engagedWith: `e${i}`, shootingAt: null }));
            let maxActive = 0;
            const perSec: number[] = [];
            for (let sec = 0; sec < 5; sec++) {
                const before = sys.sfx.stats.clashes;
                for (let f = 0; f < 60; f++) {
                    ctx.advance(1 / 60);
                    sys.battleFrame(1 / 60, { units }, speed, true);
                    maxActive = Math.max(maxActive, sys.sfx.melee.active(ctx.currentTime));
                }
                perSec.push(sys.sfx.stats.clashes - before);
            }
            expect(Math.max(...perSec)).toBeLessThanOrEqual(cap);
            expect(Math.min(...perSec)).toBeGreaterThan(0);
            expect(maxActive).toBeLessThanOrEqual(4);
        }
    });
    it('指揮（一時停止）・結果の間は鳴らさない。出来事の太鼓も制限する', async () => {
        const { sys, ctx } = makeSystem();
        sys.unlock();
        await settle();
        const units = Array.from({ length: 10 }, () => ({ status: 'ready', engagedWith: 'x', shootingAt: 'y' }));
        for (let f = 0; f < 120; f++) {
            ctx.advance(1 / 60);
            sys.battleFrame(1 / 60, { units }, 1, false);
        }
        expect(sys.sfx.stats.clashes + sys.sfx.stats.arrows).toBe(0);
        for (let i = 0; i < 30; i++) sys.battleEvent('engage', 1);
        expect(sys.sfx.stats.cues).toBeLessThanOrEqual(2);
    });
    it('効果音の発音そのもの（偽の AudioContext）：40 部隊でも 1 秒に作る音源の数は限られる', async () => {
        const { ctx } = fakeContext();
        const engine = new AudioEngine({ settings: new AudioSettingsStore(null), createContext: () => ctx as unknown as AudioContext, page: null });
        engine.unlock();
        await settle();
        const sfx = new Sfx(engine);
        const start = ctx.starts.length;
        for (let f = 0; f < 60; f++) {
            (ctx as FakeAudioContext).advance(1 / 60);
            sfx.battleTick(1 / 60, 40, 40, 1, true);
        }
        // 刃・矢 1 つは音源 2〜5 個。1 秒 6 個まで → 30 個まで
        expect(ctx.starts.length - start).toBeLessThanOrEqual(30);
    });
});

// ================================================================ 読み

describe('声の台詞の読み：表の文と一致し、読み違えやすい語はかな', () => {
    const strip = (s: string) => s.replace(/[、。「」！？\s]/g, '');
    it('表の台詞すべてに、その文に対して書いた読みがある（表の文が変わったら読みを書き直す）', () => {
        for (const v of VOICE_LINES) {
            const r = READINGS[v.id];
            expect(r, `${v.id} の読み`).toBeDefined();
            expect(r!.text, `${v.id} の読みを書いた時の文`).toBe(v.text);
        }
        for (const id of Object.keys(READINGS)) expect(VOICE_LINES.some((v) => v.id === id), `表に無い読み ${id}`).toBe(true);
    });
    it('読みには名前・語の漢字（家康・忠勝・数正・殿・退き口・近江など）を残さない', () => {
        for (const v of VOICE_LINES) {
            const r = readingFor(v);
            for (const w of MUST_KANA) expect(r.includes(w), `${v.id}：${w}`).toBe(false);
        }
    });
    it('言葉は同じ（表の文のかなの続き 3 字以上は、読みにもそのまま入る）', () => {
        for (const v of VOICE_LINES) {
            const r = strip(readingFor(v));
            const runs = strip(v.text).match(/[ぁ-ゟ]{3,}/g) ?? [];
            for (const run of runs) expect(r.includes(run), `${v.id}：「${run}」`).toBe(true);
        }
    });
    it('話し手ごとの声の高さ・速さがある（表の話し手すべて）', () => {
        for (const v of VOICE_LINES) expect(PROFILES[v.speaker], v.speaker).toBeDefined();
    });
});
