/**
 * 声の音声ファイルをゲームの中で流す（Version 28。docs/v28-town-motion-voice.md §5.4。proto3d/src/audio/voiceFiles.ts・index.ts）の自動テスト。
 * 偽の AudioContext（decodeAudioData・音源・つなぎを記録するだけ）・偽の fetch・偽のタイマー・偽のページで、
 * 流す道筋（fetch → ほどく → 音源 → 声のバス）、止める場面（行送り・選択・閉じる・字幕の替わり／スキップ／終わり／一時停止・メニュー・情勢・
 * 合戦・タイトル・ミュート・声 0・アプリの切り替え）、遅れて届いた音を捨てること（同時に 2 つ鳴らさない・後から鳴らさない）、
 * BGM を下げるのは鳴っている間だけ、声の種類（新しい声／端末の読み上げ（旧）・?voice=tts）と、新しい声では speechSynthesis に触れないことを確かめる。
 * 実際の音の出力（Chromium）は e2e/voice-play.mjs。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AudioSystem, CINE_VOICE_LATE_SEC, type VoiceTable } from '../proto3d/src/audio/index';
import { AUDIO_KEY, AudioSettingsStore, DEFAULT_AUDIO, loadAudioSettings, voiceSourceFromUrl, type VoiceSource } from '../proto3d/src/audio/settings';
import { CACHE_SIZE, STOP_FADE_SEC } from '../proto3d/src/audio/voiceFiles';
import { VOICE_MANIFEST, voiceCredits, voiceFileFor } from '../proto3d/src/audio/voiceManifest';
import { DUCK_LEVEL } from '../proto3d/src/audio/engine';
import { READINGS } from '../proto3d/src/audio/readings';
import { voiceCreditText, voiceNote } from '../proto3d/src/ui/soundPanel';
import { VOICE_LINES, VOICE_SPEAKER_NAMES, findVoiceLine, voiceCap } from '../proto3d/src/campaign/ieyasu1570/story/voiceLines';
import { FakeFetch, FakeNode, FakePage, FakeSource, FakeSynth, FakeTimers, FakeUtterance, fakeContext, memoryStorage, type FakeAudioContext } from './proto3d-audio-fakes';

const TABLE: VoiceTable = {
    byId: (id) => VOICE_LINES.find((v) => v.id === id),
    find: (s, t) => findVoiceLine(s, t),
    nameOf: (s) => (VOICE_SPEAKER_NAMES as Record<string, string>)[s] ?? '',
};

/** 一覧の長さ（偽のファイルはこの長さの音にほどける） */
const secOfUrl = (url: string) => VOICE_MANIFEST.lines.find((e) => url.endsWith(e.file))?.sec ?? 2;

/** 演出の字幕（声の id つき）・会話の行（表の文） */
const CAP = {
    oda: voiceCap('ch1.oda_envoy.ask'),
    asai: voiceCap('ch1.asai_envoy.ask'),
    council: voiceCap('ch1.tadakatsu.council'),
    gather: voiceCap('ch1.hero.gather'),
};
const SAME_DAY = { speaker: 'hero', name: '家康', text: '両家から、同じ日にか。' };
const ENVOYS = { speaker: 'tadakatsu', name: '忠勝', text: '織田家から使者が参っております。浅井家からも、別の使者が。' };
/** 表にあるが音声ファイルの無い台詞 */
const NO_FILE = { speaker: 'tadakatsu', name: '忠勝', text: '皆、陣幕の内に控えております。軍議を開かれますか。' };

/** 偽物で組んだ音のまとめ役（声の種類は既定のまま。override は URL の ?voice= のまね） */
function make(opts: { override?: VoiceSource | null; stored?: Record<string, string>; synth?: FakeSynth } = {}) {
    const { ctx, create } = fakeContext();
    const page = new FakePage();
    const timers = new FakeTimers();
    const fetch = new FakeFetch(secOfUrl);
    const synth = opts.synth ?? new FakeSynth();
    const storage = memoryStorage(opts.stored ?? {});
    const sys = new AudioSystem({
        storage,
        voices: TABLE,
        createContext: create,
        page,
        speech: { synth, makeUtterance: (t) => new FakeUtterance(t) },
        timers,
        renderer: null,
        voiceFiles: { fetchBytes: fetch.fetchBytes },
        voiceSourceOverride: opts.override ?? null,
    });
    /** 音の時計と、タイマーを一緒に進める（秒） */
    const run = (sec: number, stepMs = 10) => {
        for (let t = 0; t < sec * 1000 - 1e-6; t += stepMs) {
            ctx.advance(stepMs / 1000);
            timers.run(stepMs);
        }
    };
    return { sys, ctx, page, timers, fetch, synth, storage, run };
}

/** 約束の続き（fetch → ほどく → 流す）をすべて進める */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** 声のバスへつないだ音源（台詞の音） */
function voiceSources(sys: AudioSystem, ctx: FakeAudioContext): FakeSource[] {
    const bus = sys.engine.voiceBus as unknown as FakeNode;
    return ctx.nodes.filter((n): n is FakeSource => n instanceof FakeSource && n.kind === 'buffer' && n.everOuts.some((g) => g.everOuts.includes(bus)));
}
/** 鳴っている（始めた・止めていない・声のバスへつながっている） */
const sounding = (s: FakeSource) => s.startedAt !== null && s.stoppedAt === null && s.outs.length > 0 && s.outs.every((g) => g.outs.length > 0);
/** 音源の台詞（ほどいた長さから一覧の台詞を引く） */
const idOf = (s: FakeSource) => VOICE_MANIFEST.lines.find((e) => Math.abs((s.buffer?.duration ?? 0) - e.sec) < 1e-3)?.id;

async function started(o: ReturnType<typeof make>) {
    o.sys.unlock();
    await flush();
    expect(o.sys.engine.state).toBe('running');
}

describe('声の種類の設定（koto-sengoku/3d-audio の中。新しいキーは作らない）', () => {
    it('既定は新しい声。古い記録（声の種類の無い v:1）は音量・ミュートをそのまま、声の種類は新しい声で読む', () => {
        expect(DEFAULT_AUDIO.voiceSource).toBe('file');
        const old = memoryStorage({ [AUDIO_KEY]: '{"v":1,"muted":true,"bgm":0.3,"voice":0.5,"sfx":0.2}' });
        expect(loadAudioSettings(old)).toEqual({ muted: true, bgm: 0.3, voice: 0.5, sfx: 0.2, voiceSource: 'file' });
        expect(loadAudioSettings(memoryStorage({ [AUDIO_KEY]: '{"v":1,"voiceSource":"tts"}' })).voiceSource).toBe('tts');
        // 知らない値・壊れた値は既定
        expect(loadAudioSettings(memoryStorage({ [AUDIO_KEY]: '{"v":1,"voiceSource":"aivis"}' })).voiceSource).toBe('file');
        expect(loadAudioSettings(memoryStorage({ [AUDIO_KEY]: '{"v":1,"voiceSource":7}' })).voiceSource).toBe('file');
    });
    it('替えたときだけ、同じキーの同じ記録（v:1）に書く。ほかの保存には触れない', () => {
        const st = memoryStorage({ 'koto-sengoku/3d-ieyasu1570': '{"keep":1}' });
        const s = new AudioSettingsStore(st);
        expect(st.writes).toEqual([]);
        s.set({ voiceSource: 'tts' });
        expect(st.writes).toEqual([AUDIO_KEY]);
        expect(JSON.parse(st.map.get(AUDIO_KEY)!)).toEqual({ v: 1, muted: false, bgm: 0.6, voice: 0.9, sfx: 0.7, voiceSource: 'tts' });
        expect(st.map.get('koto-sengoku/3d-ieyasu1570')).toBe('{"keep":1}');
        // 知らない値では替えない
        s.set({ voiceSource: 'x' as VoiceSource });
        expect(s.get().voiceSource).toBe('tts');
        expect([...st.map.keys()].sort()).toEqual([AUDIO_KEY, 'koto-sengoku/3d-ieyasu1570']);
    });
    it('URL の ?voice=tts・#voice=tts・?voice=file を読む（ほかは null）', () => {
        expect(voiceSourceFromUrl('?voice=tts')).toBe('tts');
        expect(voiceSourceFromUrl('?q=low&voice=file')).toBe('file');
        expect(voiceSourceFromUrl('', '#voice=tts')).toBe('tts');
        expect(voiceSourceFromUrl('?voice=TTS')).toBeNull();
        expect(voiceSourceFromUrl('?render=manual')).toBeNull();
    });
    it('URL の指定はその回だけ設定より優先し、保存しない', () => {
        const o = make({ override: 'tts', stored: { [AUDIO_KEY]: '{"v":1,"voiceSource":"file"}' } });
        expect(o.sys.voiceSource).toBe('tts');
        expect(o.sys.voiceSourceFixed).toBe(true);
        expect(o.storage.writes).toEqual([]);
        const d = make();
        expect(d.sys.voiceSource).toBe('file');
        expect(d.sys.voiceSourceFixed).toBe(false);
    });
});

describe('新しい声：音声ファイルを声のバスで流す', () => {
    it('会話の行：同じ出どころの ./voice/<id>.mp3 を読み、ほどいて声のバスへ。鳴っている間だけ BGM を下げる', async () => {
        const o = make();
        await started(o);
        const duck = o.sys.engine.duckGain!.gain;
        o.sys.line(SAME_DAY.speaker, SAME_DAY.name, SAME_DAY.text);
        expect(o.fetch.urls).toEqual(['./voice/talk.hero.same_day.mp3']);
        // 読み込みの待ちの間は下げない
        expect(o.sys.engine.isDucked).toBe(false);
        expect(voiceSources(o.sys, o.ctx)).toHaveLength(0);
        o.fetch.answer();
        await flush();
        const [src] = voiceSources(o.sys, o.ctx);
        expect(src).toBeDefined();
        expect(idOf(src!)).toBe('talk.hero.same_day');
        expect(src!.startedAt).toBe(o.ctx.currentTime);
        expect(sounding(src!)).toBe(true);
        // 音源 → 台詞の音量の絞り → 声のバス（声の音量）→ マスター
        expect(src!.outs[0]!.outs).toEqual([o.sys.engine.voiceBus]);
        expect(o.sys.engine.isDucked).toBe(true);
        expect(duck.value).toBeCloseTo(DUCK_LEVEL);
        expect(o.sys.voiceFiles.playingId).toBe('talk.hero.same_day');
        // ほどく前に写しを渡す（同じ中身を後でもう一度ほどける）
        expect(o.ctx.decodes).toHaveLength(1);
        // 鳴り終えたら戻し、切り離す
        src!.end();
        expect(o.sys.engine.isDucked).toBe(false);
        expect(duck.value).toBe(1);
        expect(src!.outs).toHaveLength(0);
        expect(o.sys.voiceFiles.playingId).toBeNull();
    });
    it('演出の字幕：声の id の台詞を流す。字幕の文が表と違えば流さない', async () => {
        const o = make();
        await started(o);
        o.sys.caption(CAP.oda);
        expect(o.fetch.urls).toEqual(['./voice/ch1.oda_envoy.ask.mp3']);
        o.fetch.answer();
        await flush();
        expect(voiceSources(o.sys, o.ctx).map(idOf)).toEqual(['ch1.oda_envoy.ask']);
        o.sys.caption({ ...CAP.council, text: '別の文' });
        expect(o.fetch.urls).toHaveLength(1);
        expect(voiceSources(o.sys, o.ctx).filter(sounding)).toHaveLength(0);
    });
    it('音声ファイルの無い台詞は無音（読み込みもしない・端末の読み上げで埋めない）。合戦の掛け声は字幕も出さない', async () => {
        const o = make();
        await started(o);
        o.sys.line(NO_FILE.speaker, NO_FILE.name, NO_FILE.text);
        expect(o.fetch.urls).toEqual([]);
        let shown = 0;
        expect(o.sys.sayId('depart.hero', () => shown++)).toBeNull();
        expect(shown).toBe(0);
        // 表に無い文
        o.sys.line('hero', '家康', '表に無い文。');
        await flush();
        expect(voiceSources(o.sys, o.ctx)).toHaveLength(0);
        expect(o.synth.spoken).toHaveLength(0);
        expect(o.synth.cancels).toBe(0);
        // ファイルのある台詞は sayId で流せる（字幕を出す before を先に呼ぶ）
        expect(o.sys.sayId('ch1.hero.gather', () => shown++)?.id).toBe('ch1.hero.gather');
        expect(shown).toBe(1);
    });
    it('読み込みに失敗しても端末の読み上げに切り替えない（無音のまま。進行は止めない）', async () => {
        const o = make();
        await started(o);
        o.sys.line(SAME_DAY.speaker, SAME_DAY.name, SAME_DAY.text);
        o.fetch.answer(undefined, true);
        await flush();
        expect(voiceSources(o.sys, o.ctx)).toHaveLength(0);
        expect(o.sys.voiceFiles.stats.failed).toBe(1);
        expect(o.synth.spoken).toHaveLength(0);
        expect(o.sys.engine.isDucked).toBe(false);
        expect(o.sys.voiceSource).toBe('file');
    });
    it('有効にする前（利用者の操作の前）は流さない（後から流さない）', async () => {
        const o = make();
        o.sys.line(SAME_DAY.speaker, SAME_DAY.name, SAME_DAY.text);
        expect(o.fetch.urls).toEqual([]);
        o.sys.unlock();
        await flush();
        expect(voiceSources(o.sys, o.ctx)).toHaveLength(0);
    });
});

describe('新しい声：1 度に 1 つ・遅れて届いた音を捨てる', () => {
    it('速く送る A→B→C：読み込みが後から届いても、流れるのは C だけ', async () => {
        const o = make();
        await started(o);
        o.sys.caption(CAP.oda);
        o.sys.caption(CAP.asai);
        o.sys.caption(CAP.council);
        expect(o.fetch.urls).toHaveLength(3);
        // 届く順が逆でも同じ
        o.fetch.answer('ch1.tadakatsu.council.mp3');
        o.fetch.answer();
        await flush();
        const src = voiceSources(o.sys, o.ctx);
        expect(src.map(idOf)).toEqual(['ch1.tadakatsu.council']);
        expect(o.sys.voiceFiles.stats.discarded).toBe(2);
        expect(o.sys.voiceFiles.log.filter((l) => l.event === 'discard').map((l) => l.id).sort()).toEqual(['ch1.asai_envoy.ask', 'ch1.oda_envoy.ask']);
    });
    it('鳴っている台詞の次へ送る：前の音を短く絞って止め、新しい音と重ねない（同時に鳴るのはいつも 1 つまで）', async () => {
        const o = make();
        o.fetch.auto = true;
        await started(o);
        const lines = [CAP.oda, CAP.asai, CAP.council, CAP.gather];
        for (const c of lines) {
            o.sys.caption(c);
            await flush();
            const all = voiceSources(o.sys, o.ctx);
            expect(all.filter(sounding)).toHaveLength(1);
            const now = all[all.length - 1]!;
            // 前の音は、新しい音を始めた時刻＋絞る長さまでに止める
            for (const old of all.slice(0, -1)) expect(old.stoppedAt).not.toBeNull();
            for (const old of all.slice(0, -1)) expect(old.stoppedAt!).toBeLessThanOrEqual(now.startedAt! + STOP_FADE_SEC + 1e-9);
            o.run(0.3);
        }
        // 止めた音はタイマーで切り離す
        o.run(0.1);
        const all = voiceSources(o.sys, o.ctx);
        expect(all.map(idOf)).toEqual(lines.map((c) => c.voice));
        for (const old of all.slice(0, -1)) expect(old.outs).toHaveLength(0);
        // 同じ行をもう一度：ほどいた音を使う（読み直さない）
        const fetched = o.fetch.urls.length;
        o.sys.caption(CAP.oda);
        expect(o.fetch.urls).toHaveLength(fetched);
        expect(voiceSources(o.sys, o.ctx).filter(sounding).map(idOf)).toEqual(['ch1.oda_envoy.ask']);
    });
    it('読み込み中に飛ばした（演出の終わり・スキップ）：後から何も流さない。一時停止も同じ（再開しても流し直さない）', async () => {
        const o = make();
        await started(o);
        o.sys.caption(CAP.oda);
        o.sys.cineEnd();
        o.fetch.answer();
        await flush();
        expect(voiceSources(o.sys, o.ctx)).toHaveLength(0);
        o.sys.caption(CAP.asai);
        o.sys.cinePaused(true);
        o.fetch.answer();
        await flush();
        o.sys.cinePaused(false);
        await flush();
        expect(voiceSources(o.sys, o.ctx)).toHaveLength(0);
        // 鳴っている間の一時停止：止めて、再開しても流し直さない
        o.fetch.auto = true;
        o.sys.caption(CAP.council);
        await flush();
        expect(voiceSources(o.sys, o.ctx).filter(sounding)).toHaveLength(1);
        o.sys.cinePaused(true);
        expect(voiceSources(o.sys, o.ctx).filter(sounding)).toHaveLength(0);
        expect(o.sys.engine.isDucked).toBe(false);
        o.sys.cinePaused(false);
        await flush();
        expect(voiceSources(o.sys, o.ctx)).toHaveLength(1);
    });
    it('演出の字幕は、遅れすぎた音を流さない（次の字幕で切られるので）。会話の行は遅れても流す', async () => {
        const o = make();
        await started(o);
        o.sys.caption(CAP.oda);
        o.run(CINE_VOICE_LATE_SEC + 0.1);
        o.fetch.answer();
        await flush();
        expect(voiceSources(o.sys, o.ctx)).toHaveLength(0);
        expect(o.sys.voiceFiles.stats.late).toBe(1);
        o.sys.line(SAME_DAY.speaker, SAME_DAY.name, SAME_DAY.text);
        o.run(2);
        o.fetch.answer();
        await flush();
        expect(voiceSources(o.sys, o.ctx).map(idOf)).toEqual(['talk.hero.same_day']);
    });
});

describe('新しい声：止める場面', () => {
    it('アプリを切り替えた（隠れた・窓が外れた・pagehide）：すぐ止めて切り離す。戻っても流し直さない。読み込み中の台詞も捨てる', async () => {
        const o = make();
        o.fetch.auto = true;
        await started(o);
        o.sys.line(SAME_DAY.speaker, SAME_DAY.name, SAME_DAY.text);
        await flush();
        const [src] = voiceSources(o.sys, o.ctx);
        expect(sounding(src!)).toBe(true);
        o.page.hide();
        expect(o.ctx.suspends).toBe(1);
        // 音の時計が止まっていても、止めた音は切り離してある（再開の後に残りが鳴らない）
        expect(src!.stoppedAt).not.toBeNull();
        expect(src!.outs).toHaveLength(0);
        expect(o.sys.engine.isDucked).toBe(false);
        o.page.show();
        await flush();
        expect(voiceSources(o.sys, o.ctx)).toHaveLength(1);
        // 読み込み中に隠れて、隠れている間に届いた
        o.fetch.auto = false;
        o.sys.line(ENVOYS.speaker, ENVOYS.name, ENVOYS.text);
        o.page.fire('blur');
        o.fetch.answer();
        await flush();
        o.page.fire('focus');
        await flush();
        expect(voiceSources(o.sys, o.ctx)).toHaveLength(1);
        // 隠れている間の台詞は流さない
        o.page.fire('pagehide');
        o.fetch.auto = true;
        o.sys.line(ENVOYS.speaker, ENVOYS.name, ENVOYS.text);
        await flush();
        o.page.fire('pageshow');
        await flush();
        expect(voiceSources(o.sys, o.ctx)).toHaveLength(1);
    });
    it('会話の上にメニュー・情勢を開いた・タイトルへ：止める。閉じて会話に戻っても流し直さない', async () => {
        const o = make();
        o.fetch.auto = true;
        await started(o);
        for (const over of ['menu', 'situation', 'title']) {
            o.sys.setScreen('talk', false);
            o.sys.line(SAME_DAY.speaker, SAME_DAY.name, SAME_DAY.text);
            await flush();
            expect(voiceSources(o.sys, o.ctx).filter(sounding)).toHaveLength(1);
            o.sys.setScreen(over, false);
            expect(voiceSources(o.sys, o.ctx).filter(sounding)).toHaveLength(0);
            expect(o.sys.engine.isDucked).toBe(false);
            const n = voiceSources(o.sys, o.ctx).length;
            o.sys.setScreen('talk', false);
            await flush();
            expect(voiceSources(o.sys, o.ctx)).toHaveLength(n);
        }
        // 会話から軍議へ（軍議の最初の行の声は止めない）
        o.sys.setScreen('talk', false);
        o.sys.line(ENVOYS.speaker, ENVOYS.name, ENVOYS.text);
        await flush();
        o.sys.setScreen('council', false);
        expect(voiceSources(o.sys, o.ctx).filter(sounding)).toHaveLength(1);
    });
    it('行を送った（表に無い行）・選択肢を選んだ・会話を閉じた（stopVoice）・合戦へ入った：止める', async () => {
        const o = make();
        o.fetch.auto = true;
        await started(o);
        const playing = () => voiceSources(o.sys, o.ctx).filter(sounding).length;
        o.sys.line(ENVOYS.speaker, ENVOYS.name, ENVOYS.text);
        await flush();
        expect(playing()).toBe(1);
        o.sys.line('tadakatsu', '忠勝', '表に無い次の行。');
        expect(playing()).toBe(0);
        o.sys.line(SAME_DAY.speaker, SAME_DAY.name, SAME_DAY.text);
        await flush();
        o.sys.stopVoice();
        expect(playing()).toBe(0);
        o.sys.setScreen('cinematic', false);
        o.sys.caption(CAP.gather);
        await flush();
        expect(playing()).toBe(1);
        o.sys.setScreen('battle', true);
        expect(playing()).toBe(0);
        expect(o.sys.engine.isDucked).toBe(false);
    });
    it('ミュート・声の音量 0：止め、その間は流さない', async () => {
        const o = make();
        o.fetch.auto = true;
        await started(o);
        o.sys.line(SAME_DAY.speaker, SAME_DAY.name, SAME_DAY.text);
        await flush();
        o.sys.settings.set({ muted: true });
        expect(voiceSources(o.sys, o.ctx).filter(sounding)).toHaveLength(0);
        o.sys.line(ENVOYS.speaker, ENVOYS.name, ENVOYS.text);
        await flush();
        expect(voiceSources(o.sys, o.ctx)).toHaveLength(1);
        o.sys.settings.set({ muted: false, voice: 0 });
        o.sys.line(ENVOYS.speaker, ENVOYS.name, ENVOYS.text);
        await flush();
        expect(voiceSources(o.sys, o.ctx)).toHaveLength(1);
        // 読み込み中にミュートした
        o.sys.settings.set({ voice: 0.8 });
        o.fetch.auto = false;
        o.sys.caption(CAP.asai);
        o.sys.settings.set({ muted: true });
        o.fetch.answer();
        await flush();
        expect(voiceSources(o.sys, o.ctx)).toHaveLength(1);
        expect(o.sys.engine.voiceBus!.gain.value).toBeCloseTo(0.8);
    });
    it('BGM の下げは戻る：終わり・止め・終わりの知らせが来ない端末（長さ＋2 秒）', async () => {
        const o = make();
        o.fetch.auto = true;
        await started(o);
        o.sys.caption(CAP.oda);
        await flush();
        expect(o.sys.engine.isDucked).toBe(true);
        o.sys.stopVoice();
        expect(o.sys.engine.isDucked).toBe(false);
        o.sys.caption(CAP.asai);
        await flush();
        const [, src] = voiceSources(o.sys, o.ctx);
        expect(o.sys.engine.isDucked).toBe(true);
        // 終わりの知らせが来ない
        src!.onended = null;
        o.run(voiceFileFor('ch1.asai_envoy.ask')!.sec + 2.1);
        expect(o.sys.engine.isDucked).toBe(false);
        expect(o.sys.engine.duckGain!.gain.value).toBe(1);
        expect(src!.stoppedAt).not.toBeNull();
        expect(src!.outs).toHaveLength(0);
    });
});

describe('新しい声：先読みと取っておく数', () => {
    it('会話を開いた：声のある行だけ先に読み、先の 2 つはほどいておく（流すときは待たない）', async () => {
        const o = make();
        o.fetch.auto = true;
        await started(o);
        o.sys.prefetchLines([{ speaker: 'tadakatsu', name: '忠勝', text: '表に無い行。' }, ENVOYS, SAME_DAY, NO_FILE]);
        await flush();
        expect(o.fetch.urls).toEqual(['./voice/talk.tadakatsu.envoys.mp3', './voice/talk.hero.same_day.mp3']);
        expect(o.sys.voiceFiles.cached().decoded.sort()).toEqual(['talk.hero.same_day', 'talk.tadakatsu.envoys']);
        o.sys.line(ENVOYS.speaker, ENVOYS.name, ENVOYS.text);
        // ほどいてあるので、すぐ流れる
        expect(voiceSources(o.sys, o.ctx).filter(sounding).map(idOf)).toEqual(['talk.tadakatsu.envoys']);
        expect(o.fetch.urls).toHaveLength(2);
    });
    it('演出を始めた：字幕の声を出る順に先読み（有効にする前は通信だけ。有効になったらほどく）', async () => {
        const o = make();
        o.fetch.auto = true;
        const ids = ['ch1.oda_envoy.ask', 'ch1.asai_envoy.ask', 'ch1.tadakatsu.council', 'ch1.hero.gather', 'ch2.hero.decide'];
        o.sys.prefetchVoices(ids);
        await flush();
        // ファイルのある 4 つを読む。まだほどかない（AudioContext が無い）
        expect(o.fetch.urls).toHaveLength(4);
        expect(o.ctx.decodes).toHaveLength(0);
        o.sys.unlock();
        await flush();
        expect(o.sys.voiceFiles.cached().decoded).toEqual(['ch1.oda_envoy.ask', 'ch1.asai_envoy.ask']);
        // 流すと、その先の 2 つをほどいておく
        o.sys.caption(CAP.oda);
        await flush();
        expect(o.sys.voiceFiles.cached().decoded.sort()).toEqual(['ch1.asai_envoy.ask', 'ch1.oda_envoy.ask', 'ch1.tadakatsu.council']);
        o.sys.caption(CAP.asai);
        await flush();
        expect(o.sys.voiceFiles.cached().decoded.sort()).toEqual(['ch1.asai_envoy.ask', 'ch1.hero.gather', 'ch1.oda_envoy.ask', 'ch1.tadakatsu.council']);
        // ほどいてあった音をすぐ流した（読み直さない）
        expect(o.sys.voiceFiles.stats.cacheHits).toBe(2);
        expect(o.fetch.urls).toHaveLength(4);
    });
    it(`ほどいた音は ${CACHE_SIZE} 個まで（古く使った物から捨て、要ればまたほどく）`, async () => {
        const o = make();
        o.fetch.auto = true;
        await started(o);
        for (const e of VOICE_MANIFEST.lines) {
            o.sys.sayId(e.id);
            await flush();
        }
        expect(o.sys.voiceFiles.cached().decoded.length).toBeLessThanOrEqual(CACHE_SIZE);
        expect(voiceSources(o.sys, o.ctx).filter(sounding)).toHaveLength(1);
    });
});

describe('声の種類：端末の読み上げ（旧）と、新しい声では speechSynthesis に触れないこと', () => {
    let restore: (() => void) | null = null;
    afterEach(() => {
        restore?.();
        restore = null;
    });
    it('新しい声（既定）：有効にする・字幕・会話・掛け声・止める・アプリの切り替え・ミュートの間、speechSynthesis を一度も読まない', async () => {
        // ブラウザの speechSynthesis（全体の物）を見張る：読んだら数える
        const g = globalThis as Record<string, unknown>;
        const had = Object.getOwnPropertyDescriptor(g, 'speechSynthesis');
        let touched = 0;
        Object.defineProperty(g, 'speechSynthesis', {
            configurable: true,
            get() {
                touched++;
                return new FakeSynth();
            },
        });
        restore = () => {
            if (had) Object.defineProperty(g, 'speechSynthesis', had);
            else delete g.speechSynthesis;
        };
        const { ctx, create } = fakeContext();
        const page = new FakePage();
        const fetch = new FakeFetch(secOfUrl);
        fetch.auto = true;
        // speech を渡さない（ブラウザの物を使う形）
        const sys = new AudioSystem({ storage: memoryStorage(), voices: TABLE, createContext: create, page, timers: new FakeTimers(), renderer: null, voiceFiles: { fetchBytes: fetch.fetchBytes } });
        sys.unlock(true);
        await flush();
        expect(sys.needsGesture).toBe(false);
        sys.caption(CAP.oda);
        await flush();
        sys.line(SAME_DAY.speaker, SAME_DAY.name, SAME_DAY.text);
        sys.line(NO_FILE.speaker, NO_FILE.name, NO_FILE.text);
        sys.sayId('depart.hero');
        sys.sayId('battle.retreat');
        sys.cinePaused(true);
        sys.cineEnd();
        sys.stopVoice();
        page.hide();
        page.show();
        sys.settings.set({ muted: true });
        sys.settings.set({ muted: false, voice: 0 });
        sys.setScreen('battle', true);
        expect(sys.voiceStatus).toBe('unknown');
        void sys.probe();
        await flush();
        expect(touched).toBe(0);
        expect(voiceSources(sys, ctx).length).toBeGreaterThan(0);
    });
    it('偽の読み上げを渡しても、新しい声ではどの口も呼ばない（読み上げの下ごしらえもしない）', async () => {
        const calls: string[] = [];
        const synth = new Proxy(new FakeSynth(), {
            get(t, k, r) {
                calls.push(String(k));
                return Reflect.get(t, k, r) as unknown;
            },
        });
        const o = make({ synth });
        o.fetch.auto = true;
        await started(o);
        o.sys.caption(CAP.oda);
        o.sys.line(NO_FILE.speaker, NO_FILE.name, NO_FILE.text);
        o.sys.stopVoice();
        o.page.hide();
        o.page.show();
        await flush();
        expect(calls).toEqual([]);
    });
    it('端末の読み上げ（旧）を選ぶ：今までの道筋（読みのかな・話し手の高さと速さ）で読み、音声ファイルは読まない', async () => {
        const o = make();
        await started(o);
        o.sys.settings.set({ voiceSource: 'tts' });
        expect(o.sys.voiceSource).toBe('tts');
        o.sys.unlock(true);
        expect(o.sys.voice.primed).toBe(true);
        o.sys.line(SAME_DAY.speaker, SAME_DAY.name, SAME_DAY.text);
        expect(o.synth.spoken.map((u) => u.text)).toEqual([READINGS['talk.hero.same_day']!.reading]);
        expect(o.fetch.urls).toEqual([]);
        // 音声ファイルの無い台詞も、今までどおり読む（旧の道筋のまま）
        o.sys.line(NO_FILE.speaker, NO_FILE.name, NO_FILE.text);
        expect(o.synth.spoken.map((u) => u.text)).toContain(READINGS['talk.tadakatsu.again']!.reading);
        expect(o.sys.probe().voice.source).toBe('tts');
    });
    it('?voice=tts（URL の指定）：保存の値に関わらず端末の読み上げ', async () => {
        const o = make({ override: 'tts' });
        await started(o);
        o.sys.caption(CAP.oda);
        expect(o.synth.spoken.map((u) => u.text)).toEqual([READINGS['ch1.oda_envoy.ask']!.reading]);
        expect(o.fetch.urls).toEqual([]);
        // 設定を替えても URL の指定のまま
        o.sys.settings.set({ voiceSource: 'file' });
        expect(o.sys.voiceSource).toBe('tts');
    });
    it('声の種類を替えたら、今の声（どちらも）を止める', async () => {
        const o = make();
        o.fetch.auto = true;
        await started(o);
        o.sys.line(SAME_DAY.speaker, SAME_DAY.name, SAME_DAY.text);
        await flush();
        expect(voiceSources(o.sys, o.ctx).filter(sounding)).toHaveLength(1);
        o.sys.settings.set({ voiceSource: 'tts' });
        expect(voiceSources(o.sys, o.ctx).filter(sounding)).toHaveLength(0);
        o.sys.line(SAME_DAY.speaker, SAME_DAY.name, SAME_DAY.text);
        expect(o.synth.queue).toHaveLength(1);
        o.sys.settings.set({ voiceSource: 'file' });
        expect(o.synth.queue).toHaveLength(0);
        expect(o.sys.engine.isDucked).toBe(false);
    });
});

describe('音の設定の欄：声の種類の説明とクレジット', () => {
    it('クレジットは一覧の声（重なりを除く）を「音声：VOICEVOX:…」で並べる', () => {
        expect(voiceCredits()).toEqual(['VOICEVOX:玄野武宏', 'VOICEVOX:剣崎雌雄', 'VOICEVOX:離途', 'VOICEVOX:雀松朱司']);
        expect(voiceCreditText()).toBe('音声：VOICEVOX:玄野武宏、VOICEVOX:剣崎雌雄、VOICEVOX:離途、VOICEVOX:雀松朱司');
        expect(voiceCreditText([])).toBe('');
        // 一覧の声はすべて VOICEVOX:<声の名前>
        for (const e of VOICE_MANIFEST.lines) expect(e.credit).toBe(`VOICEVOX:${e.voice}`);
    });
    it('説明：新しい声は端末の読み上げと書かない。端末の読み上げ（旧）は今までの説明。URL の指定はそう書く', () => {
        expect(voiceNote('file', 'unknown', false)).not.toContain('端末');
        expect(voiceNote('file', 'unknown', false)).toContain('台詞ごとに作った音声');
        expect(voiceNote('tts', 'ready', false)).toContain('端末の日本語読み上げ（旧）');
        expect(voiceNote('tts', 'no_japanese', false)).toContain('見つかりませんでした');
        expect(voiceNote('tts', 'ready', true)).toContain('?voice=tts');
    });
});
