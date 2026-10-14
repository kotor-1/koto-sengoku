/**
 * 台詞の音声ファイルの一覧（Version 28。docs/v28-town-motion-voice.md §5）。
 *
 * - 一覧は voiceManifest.gen.json（proto3d/tools/voice-build.py build が、音声の台本 proto3d/voice/script.json から作る。手で書き換えない）。
 *   音声ファイルは proto3d/public/voice/<id>.mp3（VOICEVOX で事前に作った MP3。モノラル 24 kHz 固定 64 kbps）。
 *   音声合成の本体・モデル・辞書はリポジトリにも配信にも入れない（出来た台詞の音声ファイルだけを配信する）。
 * - id は台詞の表（campaign/ieyasu1570/story/voiceLines.ts の VOICE_LINES）と同じ。文（text）は表と 1 字も違わない
 *   （作る道具が違えば書き込みを断り、tests/proto3d-voice-files.test.ts も確かめる）。
 * - sec は Chromium の decodeAudioData でほどいた長さ（MP3 のフレームの数 × 576 標本 ÷ 24 kHz。前の LAME の遅れ・後ろの詰め物を含む）。
 *   lead・tail はほどいた音の前後の無音（秒。声の切り口まで）、gapBefore は前の話し手の声の終わりからの間の目安（演出用。ファイルには入れない）。
 * - 一覧に無い台詞は音声ファイルが無い（新しい声では無音。旧読み上げで自動的に埋めない：§5.4）。
 */
import generated from './voiceManifest.gen.json';

export interface VoiceFileEntry {
    id: string;
    /** 話し手の id（voiceLines.ts の VoiceSpeaker） */
    speaker: string;
    /** 表示の文（台詞の表と同じ） */
    text: string;
    /** ページからの相対の置き場所（例 'voice/ch1.oda_envoy.ask.mp3'） */
    file: string;
    /** ほどいた長さ（秒） */
    sec: number;
    bytes: number;
    sha256: string;
    /** 作品の中に出すクレジット（'VOICEVOX:<声の名前>'） */
    credit: string;
    voice: string;
    style: string;
    styleId: number;
    /** ほどいた音の前の無音・後ろの無音（秒） */
    lead: number;
    tail: number;
    /** 前の話し手の声の終わりから、この台詞の声の始まりまでの間の目安（秒。台本の値） */
    gapBefore?: number;
}

export interface VoiceManifest {
    version: number;
    engine: string;
    format: string;
    loudness: { targetLufs: number; method: string; peakMaxDbfs: number };
    lines: VoiceFileEntry[];
}

export const VOICE_MANIFEST: Readonly<VoiceManifest> = generated as VoiceManifest;

const BY_ID: ReadonlyMap<string, VoiceFileEntry> = new Map(VOICE_MANIFEST.lines.map((e) => [e.id, e]));

/** id の台詞の音声ファイル（無ければ undefined） */
export function voiceFileFor(id: string): VoiceFileEntry | undefined {
    return BY_ID.get(id);
}

/** 音声ファイルに使った声のクレジット（重なりを除いた、一覧の順。音の設定の画面・docs に出す） */
export function voiceCredits(): string[] {
    return [...new Set(VOICE_MANIFEST.lines.map((e) => e.credit))];
}
