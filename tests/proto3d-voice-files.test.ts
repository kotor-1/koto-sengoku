/**
 * 台詞の音声ファイル（Version 28。docs/v28-town-motion-voice.md §5）の自動テスト。
 * 一覧（proto3d/src/audio/voiceManifest.gen.json）・音声の台本（proto3d/voice/script.json）・台詞の表（VOICE_LINES）・
 * 配信する MP3（proto3d/public/voice/）が食い違わないことと、演出の字幕の長さが実際の音の長さから決まることを確かめる。
 * 音の中身（読み・間・高さ・大きさ）の数の確かめは、作る道具（proto3d/tools/voice-build.py）の記録 proto3d/voice/build-report.gen.json と
 * e2e/voice-decode.mjs（Chromium の decodeAudioData でほどく）。耳で聞いた確かめではない。
 */
import { describe, expect, it } from 'vitest';
import { VOICE_MANIFEST, voiceCredits, voiceFileFor } from '../proto3d/src/audio/voiceManifest';
import { VOICE_FILE_TAIL_SEC, VOICE_LINES, VOICE_SPEAKER_NAMES, findVoiceLine, voiceEstimateSec, voiceLine, voiceSecFor } from '../proto3d/src/campaign/ieyasu1570/story/voiceLines';
import { ieyasuCinematic } from '../proto3d/src/campaign/ieyasu1570/story/cinematics';
import { newIeyasuGame, talkIeyasu } from '../proto3d/src/campaign/ieyasu1570/flow';
import { CINE_LENGTH_RANGE } from '../proto3d/src/story/timeline';

// テストは Node で動く。Node の型定義は入れていないので、使う関数だけ型を付ける（tests/proto3d-art-manifest.test.ts と同じ）
const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as {
    readFileSync(p: string): Uint8Array;
    existsSync(p: string): boolean;
    readdirSync(p: string): string[];
};
const nodeCrypto = (await import(/* @vite-ignore */ 'node:' + 'crypto')) as unknown as {
    createHash(alg: string): { update(b: Uint8Array): { digest(enc: 'hex'): string } };
};
const ROOT = decodeURIComponent(new URL('../', import.meta.url).pathname);
const PUBLIC = `${ROOT}proto3d/public/`;
const VOICE_DIR = `${PUBLIC}voice/`;
const readText = (p: string) => new TextDecoder().decode(fs.readFileSync(p));

interface ScriptLine {
    id: string;
    speaker: string;
    text: string;
    engine: string;
    voice: { name: string; style: string; styleId: number };
    alternates?: { name: string; style: string; styleId: number }[];
    kana: string;
    pauses: number[];
    pre: number;
    post: number;
    gapBefore?: number;
    note: string;
}
const SCRIPT = JSON.parse(readText(`${ROOT}proto3d/voice/script.json`)) as { lines: ScriptLine[] };

/** MP3（Layer III）のフレームを数えてほどいた長さ（秒）を出す（voice-build.py の mp3_frames と同じ数え方） */
function mp3Sec(b: Uint8Array): { frames: number; rate: number; sec: number } {
    const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
    const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
    const SRS: Record<number, number[]> = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000] };
    let i = 0;
    let frames = 0;
    let samples = 0;
    let rate = 0;
    while (i < b.length) {
        const h = ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
        if (((h >>> 21) & 0x7ff) !== 0x7ff) throw new Error(`フレームの頭が無い（${i}）`);
        const ver = ({ 0: 25, 2: 2, 3: 1 } as Record<number, number>)[(h >>> 19) & 3];
        const layer = (h >>> 17) & 3;
        const bri = (h >>> 12) & 15;
        const sri = (h >>> 10) & 3;
        if (!ver || layer !== 1 || bri === 0 || bri === 15 || sri === 3) throw new Error(`Layer III でない（${i}）`);
        const br = (ver === 1 ? BR1 : BR2)[bri]! * 1000;
        const sr = SRS[ver]![sri]!;
        rate ||= sr;
        if (sr !== rate) throw new Error('標本化の速さが途中で変わる');
        i += Math.floor(((ver === 1 ? 144 : 72) * br) / sr) + ((h >>> 9) & 1);
        frames++;
        samples += ver === 1 ? 1152 : 576;
    }
    if (i !== b.length) throw new Error('最後のフレームが切れている');
    return { frames, rate, sec: samples / rate };
}

describe('台詞の音声の一覧（voiceManifest.gen.json）と台詞の表・台本', () => {
    it('一覧の文・話し手は台詞の表（VOICE_LINES）と 1 字も違わない（id は重ならない）', () => {
        const ids = VOICE_MANIFEST.lines.map((e) => e.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBeGreaterThan(0);
        for (const e of VOICE_MANIFEST.lines) {
            const v = voiceLine(e.id);
            expect(e.text, e.id).toBe(v.text);
            expect(e.speaker, e.id).toBe(v.speaker);
        }
    });
    it('V28 の最初の台詞（第一章の町の出来事と城門の前の会話の 6 つ）に音声ファイルがある', () => {
        for (const id of ['ch1.oda_envoy.ask', 'ch1.asai_envoy.ask', 'ch1.tadakatsu.council', 'talk.tadakatsu.envoys', 'ch1.hero.gather', 'talk.hero.same_day']) {
            expect(voiceFileFor(id), id).toBeDefined();
        }
    });
    it('城門の前の会話の「織田家から使者が…」は表に入った（会話の行の文と同じで、忠勝の行から引ける）', () => {
        const script = talkIeyasu(newIeyasuGame(), 'tadakatsu');
        const line = script.lines.find((l) => l.text === '織田家から使者が参っております。浅井家からも、別の使者が。');
        expect(line).toBeDefined();
        expect(findVoiceLine(line!.speaker, line!.text)?.id).toBe('talk.tadakatsu.envoys');
        expect(VOICE_SPEAKER_NAMES[voiceLine('talk.tadakatsu.envoys').speaker]).toBe('忠勝');
    });
    it('台本（proto3d/voice/script.json）と一覧の id・声が同じ。台本の文も表と同じ', () => {
        expect(SCRIPT.lines.map((l) => l.id)).toEqual(VOICE_MANIFEST.lines.map((e) => e.id));
        for (const l of SCRIPT.lines) {
            const v = voiceLine(l.id);
            expect(l.text, l.id).toBe(v.text);
            expect(l.speaker, l.id).toBe(v.speaker);
            expect(l.engine).toBe('VOICEVOX');
            const e = voiceFileFor(l.id)!;
            expect([e.voice, e.style, e.styleId], l.id).toEqual([l.voice.name, l.voice.style, l.voice.styleId]);
            expect(e.credit).toBe(`VOICEVOX:${l.voice.name}`);
            // 読み：「、」ごとに間がある。演技のねらいがある
            expect(l.pauses.length, l.id).toBe([...l.kana].filter((c) => c === '、').length);
            expect(l.note.length, l.id).toBeGreaterThan(0);
        }
    });
    it('配役（§5.2）：使者・忠勝・家康の第一案は違う声。利用規約で使わない声・事前の確認が要る声は第一案にしない', () => {
        const first = (id: string) => voiceFileFor(id)!.voice;
        expect(first('ch1.oda_envoy.ask')).toBe('玄野武宏');
        expect(first('ch1.asai_envoy.ask')).toBe('剣崎雌雄');
        expect(first('ch1.tadakatsu.council')).toBe('離途');
        expect(first('talk.tadakatsu.envoys')).toBe('離途');
        expect(first('ch1.hero.gather')).toBe('雀松朱司');
        expect(first('talk.hero.same_day')).toBe('雀松朱司');
        for (const e of VOICE_MANIFEST.lines) expect(['もち子さん', 'No.7', 'ユーレイちゃん', '青山龍星', '後鬼'], e.id).not.toContain(e.voice);
        expect(voiceCredits()).toEqual(['VOICEVOX:玄野武宏', 'VOICEVOX:剣崎雌雄', 'VOICEVOX:離途', 'VOICEVOX:雀松朱司']);
    });
});

describe('配信する音声ファイル（proto3d/public/voice/）', () => {
    it('一覧のファイルがすべてあり、容量と sha256 が一覧どおり。MP3（モノラルの Layer III・24 kHz）で、フレームから求めた長さが sec と同じ', () => {
        for (const e of VOICE_MANIFEST.lines) {
            expect(e.file, e.id).toBe(`voice/${e.id}.mp3`);
            const p = `${PUBLIC}${e.file}`;
            expect(fs.existsSync(p), e.file).toBe(true);
            const b = fs.readFileSync(p);
            expect(b.length, e.file).toBe(e.bytes);
            expect(nodeCrypto.createHash('sha256').update(b).digest('hex'), e.file).toBe(e.sha256);
            // 単一チャンネル（チャンネルのモードの 2 ビットが 3）
            expect((b[3]! >> 6) & 3, e.file).toBe(3);
            const m = mp3Sec(b);
            expect(m.rate).toBe(24000);
            expect(Math.abs(m.sec - e.sec), e.file).toBeLessThan(0.0015);
        }
    });
    it('長さは 0 より長く、前後の無音（lead・tail）は 0 以上で長さより短い。1 つの台詞は 8 秒・200 KB まで', () => {
        for (const e of VOICE_MANIFEST.lines) {
            expect(e.sec, e.id).toBeGreaterThan(0.5);
            expect(e.sec, e.id).toBeLessThan(8);
            expect(e.bytes, e.id).toBeLessThan(200_000);
            expect(e.lead, e.id).toBeGreaterThanOrEqual(0);
            expect(e.tail, e.id).toBeGreaterThanOrEqual(0);
            expect(e.lead + e.tail, e.id).toBeLessThan(e.sec);
        }
    });
    it('置き場所には一覧の MP3 だけ（WAV・作業用の物・音声合成の本体やモデルを置かない）', () => {
        const listed = new Set(VOICE_MANIFEST.lines.map((e) => e.file.replace(/^voice\//, '')));
        for (const f of fs.readdirSync(VOICE_DIR)) expect(listed.has(f), `proto3d/public/voice/${f}`).toBe(true);
    });
});

describe('声の長さ（voiceSecFor）：音声ファイルの実際の長さを使う', () => {
    it('音声ファイルのある台詞は、ほどいた長さ ＋ 余白（VOICE_FILE_TAIL_SEC）。見積もりは使わない', () => {
        expect(VOICE_FILE_TAIL_SEC).toBeGreaterThan(0);
        expect(VOICE_FILE_TAIL_SEC).toBeLessThanOrEqual(0.5);
        for (const e of VOICE_MANIFEST.lines) expect(voiceSecFor(e.id), e.id).toBeCloseTo(e.sec + VOICE_FILE_TAIL_SEC, 9);
    });
    it('音声ファイルの無い台詞は、今までの見積もり（読みの拍 ÷（7 × 話し手の速さ）＋ 0.8）', () => {
        const without = VOICE_LINES.filter((v) => !voiceFileFor(v.id));
        expect(without.length).toBeGreaterThan(0);
        for (const v of without) expect(voiceSecFor(v.id), v.id).toBe(voiceEstimateSec(v.id));
    });
    it('第一章の冒頭の字幕：声の付いた字幕は実際の音の長さ ＋ 余白より短くなく、冒頭の長さは決まり（12〜19 秒）の内', () => {
        const spec = ieyasuCinematic(newIeyasuGame(), 'ch1_open')!;
        let n = 0;
        for (const c of spec.captions) {
            if (!c.voice) continue;
            const f = voiceFileFor(c.voice);
            expect(f, c.voice).toBeDefined();
            expect(c.end - c.start + 1e-6, c.voice).toBeGreaterThanOrEqual(f!.sec + VOICE_FILE_TAIL_SEC);
            n++;
        }
        expect(n).toBe(4);
        const [lo, hi] = CINE_LENGTH_RANGE.ch1_open;
        expect(spec.duration).toBeGreaterThanOrEqual(lo);
        expect(spec.duration).toBeLessThanOrEqual(hi);
    });
});
