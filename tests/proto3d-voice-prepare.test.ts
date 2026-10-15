/**
 * 声の取り置きと「今すぐ鳴らせるか」（Version 28 の直し A1。proto3d/src/audio/voiceFiles.ts・index.ts）の自動テスト。
 * 本番の実時間の録画（第一章の町の急報）で、最初の声（ch1.oda_envoy.ask）が鳴らなかった：出来事の声の読み込み・ほどきが演出を始めた時に
 * 初めて始まり、字幕より遅れてほどけ、遅れすぎた声は流さない決まり（CINE_VOICE_LATE_SEC）で捨てられた。
 * - 取り置き（prepareVoices）：出来事を待ち始めた時（主人公が歩いている間）に、出来事の台詞を全部読んでほどき、取り置きをやめるまで捨てない
 *   （ほどいた音は CACHE_SIZE 個まで。取り置きはその数に入れない。会話の声をたくさんほどいても捨てない）。
 * - cineVoiceReady：演出の再生器が、字幕の境目で時計を待たせるかを決める口（端末の読み上げ・ミュート・声 0・音を始めていない・ファイルが無い・
 *   読めなかった直後は待たない）。
 * 偽の AudioContext・偽の fetch（tests/proto3d-audio-fakes.ts）で確かめる。
 */
import { describe, expect, it } from 'vitest';
import { AudioSystem, CINE_VOICE_LATE_SEC, CINE_VOICE_WAIT_SEC, type VoiceTable } from '../proto3d/src/audio/index';
import { CACHE_SIZE } from '../proto3d/src/audio/voiceFiles';
import { VOICE_MANIFEST } from '../proto3d/src/audio/voiceManifest';
import type { VoiceSource } from '../proto3d/src/audio/settings';
import { VOICE_LINES, VOICE_SPEAKER_NAMES, findVoiceLine, voiceCap } from '../proto3d/src/campaign/ieyasu1570/story/voiceLines';
import { CH1_REPORT_LINES } from '../proto3d/src/campaign/ieyasu1570/story/cinematics';
import { FakeFetch, FakePage, FakeSynth, FakeTimers, FakeUtterance, fakeContext, memoryStorage } from './proto3d-audio-fakes';

const TABLE: VoiceTable = {
    byId: (id) => VOICE_LINES.find((v) => v.id === id),
    find: (s, t) => findVoiceLine(s, t),
    nameOf: (s) => (VOICE_SPEAKER_NAMES as Record<string, string>)[s] ?? '',
};
const secOfUrl = (url: string) => VOICE_MANIFEST.lines.find((e) => url.endsWith(e.file))?.sec ?? 2;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * 音声ファイルの一覧（偽）：本物の一覧（6 台詞）に、表のほかの台詞の偽の項目を足した物（ほどいた音の数の決まりを超えるまでほどくため）
 */
const WIDE = new Map(
    VOICE_LINES.map((v) => {
        const real = VOICE_MANIFEST.lines.find((e) => e.id === v.id);
        return [v.id, real ?? { ...VOICE_MANIFEST.lines[0]!, id: v.id, speaker: v.speaker, text: v.text, file: `voice/${v.id}.mp3`, sec: 1.5 }];
    }),
);

function make(opts: { override?: VoiceSource | null; wide?: boolean } = {}) {
    const { ctx, create } = fakeContext();
    const timers = new FakeTimers();
    const fetch = new FakeFetch((url) => (opts.wide ? ([...WIDE.values()].find((e) => url.endsWith(e.file))?.sec ?? 2) : secOfUrl(url)));
    const sys = new AudioSystem({
        storage: memoryStorage(),
        voices: TABLE,
        createContext: create,
        page: new FakePage(),
        speech: { synth: new FakeSynth(), makeUtterance: (t) => new FakeUtterance(t) },
        timers,
        renderer: null,
        voiceFiles: { fetchBytes: fetch.fetchBytes, ...(opts.wide ? { fileFor: (id: string) => WIDE.get(id) } : {}) },
        voiceSourceOverride: opts.override ?? null,
    });
    return { sys, ctx, timers, fetch };
}
async function started(o: ReturnType<typeof make>) {
    o.sys.unlock();
    await flush();
    expect(o.sys.engine.state).toBe('running');
}

const REPORT = [...CH1_REPORT_LINES];
/** 町の急報の外の台詞（偽の一覧 WIDE では、どれも音声ファイルがある：会話・ほかの演出の声） */
const OTHERS = [...WIDE.keys()].filter((id) => !REPORT.includes(id as (typeof REPORT)[number]));

describe('取り置き（prepareVoices）：待っている町の出来事の声を、歩いている間に全部ほどいて捨てない', () => {
    it('取り置くと 4 台詞すべてを読んでほどく（先読みの 2 つだけではない）。字幕が出たらすぐ鳴る（遅れで捨てない）', async () => {
        const o = make();
        o.fetch.auto = true;
        await started(o);
        o.sys.prepareVoices(REPORT);
        await flush();
        expect(o.fetch.urls.sort()).toEqual(REPORT.map((id) => `./voice/${id}.mp3`).sort());
        expect(o.sys.voiceFiles.cached().decoded.sort()).toEqual([...REPORT].sort());
        for (const id of REPORT) expect(o.sys.cineVoiceReady(voiceCap(id)), id).toBe(true);
        // 演出が始まり、最初の字幕が出た：取ってある音をすぐ流す
        o.sys.prefetchVoices(REPORT);
        o.sys.caption(voiceCap(REPORT[0]!));
        expect(o.sys.voiceFiles.playingId).toBe(REPORT[0]);
        expect(o.sys.voiceFiles.stats.late).toBe(0);
        expect(o.sys.voiceFiles.stats.cacheHits).toBe(1);
    });

    it(`会話などの声を ${CACHE_SIZE} 個より多くほどいても、取り置いた台詞は捨てない（取り置きは数に入れない）。やめれば、また古い物から捨てる`, async () => {
        expect(OTHERS.length).toBeGreaterThan(CACHE_SIZE);
        const o = make({ wide: true });
        o.fetch.auto = true;
        await started(o);
        o.sys.prepareVoices(REPORT);
        await flush();
        // 町を歩いている間に、ほかの台詞をたくさんほどく（会話の声・掛け声）
        for (const id of OTHERS) {
            o.sys.sayId(id);
            await flush();
            o.sys.stopVoice();
        }
        const decoded = o.sys.voiceFiles.cached().decoded;
        for (const id of REPORT) expect(decoded, id).toContain(id);
        expect(decoded.filter((id) => !REPORT.includes(id as (typeof REPORT)[number])).length).toBeLessThanOrEqual(CACHE_SIZE);
        // 取り置きをやめた（出来事を起こさなくなった）：数の決まりへ戻る
        o.sys.prepareVoices([]);
        expect(o.sys.voiceFiles.cached().reserved).toEqual([]);
        o.sys.sayId(OTHERS[0]!);
        await flush();
        expect(o.sys.voiceFiles.cached().decoded.length).toBeLessThanOrEqual(CACHE_SIZE);
    });

    it('有効にする前（AudioContext が無い）に取り置いた：通信だけして、有効になった時に 4 台詞すべてをほどく', async () => {
        const o = make();
        o.fetch.auto = true;
        o.sys.prepareVoices(REPORT);
        await flush();
        expect(o.fetch.urls).toHaveLength(4);
        expect(o.ctx.decodes).toHaveLength(0);
        o.sys.unlock();
        await flush();
        expect(o.sys.voiceFiles.cached().decoded.sort()).toEqual([...REPORT].sort());
        // 同じファイルを読み直さない
        expect(o.fetch.urls).toHaveLength(4);
    });

    it('端末の読み上げ（?voice=tts）では取り置かない（音声ファイルを読まない）', async () => {
        const o = make({ override: 'tts' });
        o.fetch.auto = true;
        await started(o);
        o.sys.prepareVoices(REPORT);
        await flush();
        expect(o.fetch.urls).toEqual([]);
        expect(o.sys.voiceFiles.cached().reserved).toEqual([]);
    });

    it('演出の間は、その演出の字幕の声を捨てない（ほかの台詞をほどいても）。演出が終われば数の決まりへ戻る', async () => {
        const o = make({ wide: true });
        o.fetch.auto = true;
        await started(o);
        o.sys.prefetchVoices(REPORT);
        await flush();
        for (const id of REPORT) {
            o.sys.cineVoiceReady(voiceCap(id));
            await flush();
        }
        expect(o.sys.voiceFiles.cached().decoded.sort()).toEqual([...REPORT].sort());
        for (const id of OTHERS) {
            o.sys.sayId(id);
            await flush();
        }
        for (const id of REPORT) expect(o.sys.voiceFiles.cached().decoded, id).toContain(id);
        o.sys.cineEnd();
        o.sys.sayId(OTHERS[0]!);
        await flush();
        expect(o.sys.voiceFiles.cached().decoded.length).toBeLessThanOrEqual(CACHE_SIZE);
    });
});

describe('cineVoiceReady：演出の字幕の声を今すぐ鳴らせるか（待つ要が無いときも true）', () => {
    it('まだほどけていない：false で、読み込みとほどきを始める（2 度目は読み直さない）。ほどけたら true', async () => {
        const o = make();
        await started(o);
        const c = voiceCap('ch1.oda_envoy.ask');
        expect(o.sys.cineVoiceReady(c)).toBe(false);
        expect(o.fetch.urls).toEqual(['./voice/ch1.oda_envoy.ask.mp3']);
        expect(o.sys.cineVoiceReady(c)).toBe(false);
        expect(o.fetch.urls).toHaveLength(1);
        o.fetch.answer();
        await flush();
        expect(o.sys.cineVoiceReady(c)).toBe(true);
        // 聞くだけでは鳴らさない
        expect(o.sys.voiceFiles.playingId).toBeNull();
        expect(o.sys.voiceFiles.stats.requested).toBe(0);
    });

    it('待たない：声の無い字幕・表と違う文・音声ファイルの無い台詞・端末の読み上げ・ミュート・声 0・有効にする前・読めなかった直後', async () => {
        const c = voiceCap('ch1.oda_envoy.ask');
        const noFile = VOICE_LINES.find((v) => !VOICE_MANIFEST.lines.some((e) => e.id === v.id))!;
        // 有効にする前
        const pre = make();
        expect(pre.sys.cineVoiceReady(c)).toBe(true);
        expect(pre.fetch.urls).toEqual([]);
        // 声の無い字幕・表と違う文・ファイルの無い台詞
        const o = make();
        await started(o);
        expect(o.sys.cineVoiceReady({ text: '城門から、徳川の兵が出陣する。' })).toBe(true);
        expect(o.sys.cineVoiceReady({ ...c, text: '別の文' })).toBe(true);
        expect(o.sys.cineVoiceReady({ speaker: noFile.speaker, text: noFile.text, voice: noFile.id })).toBe(true);
        expect(o.fetch.urls).toEqual([]);
        // ミュート・声 0
        o.sys.settings.set({ muted: true });
        expect(o.sys.cineVoiceReady(c)).toBe(true);
        o.sys.settings.set({ muted: false, voice: 0 });
        expect(o.sys.cineVoiceReady(c)).toBe(true);
        expect(o.fetch.urls).toEqual([]);
        o.sys.settings.set({ voice: 0.8 });
        // 読めなかった直後（もう待たない）
        expect(o.sys.cineVoiceReady(c)).toBe(false);
        o.fetch.answer(undefined, true);
        await flush();
        expect(o.sys.cineVoiceReady(c)).toBe(true);
        // 端末の読み上げ
        const t = make({ override: 'tts' });
        await started(t);
        expect(t.sys.cineVoiceReady(c)).toBe(true);
        expect(t.fetch.urls).toEqual([]);
    });

    it('待ちの最長は 2.5 秒前後（遅れの決まり 0.25 秒より長く、演出を長く止めない）', () => {
        expect(CINE_VOICE_WAIT_SEC).toBeGreaterThan(CINE_VOICE_LATE_SEC);
        expect(CINE_VOICE_WAIT_SEC).toBeGreaterThanOrEqual(2);
        expect(CINE_VOICE_WAIT_SEC).toBeLessThanOrEqual(3);
    });
});
