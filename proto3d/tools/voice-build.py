#!/usr/bin/env python3
"""
台詞の音声（Version 28。docs/v28-town-motion-voice.md §5）：音声の台本 proto3d/voice/script.json から、
VOICEVOX CORE（手元で動かす音声合成。有料 API ではない）で台詞ごとの音声ファイルを作る。

    <VOICEVOX の入った Python> -I proto3d/tools/voice-build.py build   --ort LIB --dict DIR --vvm DIR
    <VOICEVOX の入った Python> -I proto3d/tools/voice-build.py samples --ort LIB --dict DIR --vvm DIR [--out DIR]
    python3 -I proto3d/tools/voice-build.py check

- 音声合成の本体・モデル・辞書の場所は引数か環境変数（VOICEVOX_ORT＝ONNX Runtime の .so、VOICEVOX_DICT＝Open JTalk の辞書のフォルダ、
  VOICEVOX_VVM＝音声モデル *.vvm のフォルダ）で渡す。リポジトリには入れない・書かない（公開リポジトリ。配信にも入れない）。
  使う Python は voicevox_core（0.17.0）・lameenc・numpy の入った物（例：手元の仮想環境）。check は numpy も音声合成も要らない。
- build：
  1. 台本の文を台詞の表（proto3d/src/campaign/ieyasu1570/story/voiceLines.ts の VOICE_LINES）と比べ、1 つでも違えば何も書かずに止める
     （id が表に無い・話し手が違う・文が 1 字でも違う）。台本の形（読みの「、」と間の数、拍の直しの拍のかな、声の名前とスタイルの id）も確かめる。
  2. 読み：台本の kana から AudioQuery を作る（create_audio_query_from_kana）。同じ文の自動の読み（Open JTalk の解析。create_audio_query）
     と比べ、違い（読み・アクセント・句の切り方）を一覧にする。作った AudioQuery の kana が台本どおりかも確かめる。
  3. 話す速さ・高さ・抑揚・音量・句の間（「、」ごと。話す速さを掛けた後の実際の秒）・拍の直し（高さ・長さ）を入れて合成する（24 kHz・16 bit・モノラル）。
  4. 前後の無音を台本の pre・post にそろえる（声の始まりと終わり：10 ms ごとの音量が、その台詞のピークより 50 dB 下か -60 dBFS の大きい方を
     超える最初と最後の所から 20 ms 外。切り口は 5 ms でなめらかにする）。
  5. 音量をそろえる：台本の chunkGainDb（「、」で分けたまとまりごとの音量の差。間の真ん中で切り替える）を掛けてから、
     ITU-R BS.1770-4 の K 特性・ゲート付きの積分ラウドネスで -20 LUFS（モノラルを 1 チャンネルとして測る）に、
     台本の loudnessOffsetDb（演技の差。±3 dB まで）を足した値へ。4 倍に補間したピーク（true peak の近似）が -1.5 dBFS を超えるなら、
     そこまで下げる（その台詞は目標より小さくなる。報告に書く）。MP3 にすると少し山が増えるので、ほどいた後の -1 dBFS を守るための余白。
  6. MP3 にする：lameenc（LAME）・モノラル・24 kHz（音声合成の元の速さ。44.1 kHz へ上げても中身は増えない）・固定 64 kbps（CBR。
     話し声には十分で、フレームの数から長さが決まる）・品質 2。MP3 の先頭には LAME の遅れ（1105 標本・約 46 ms。Chromium の decodeAudioData で
     測った。LAME/Xing の情報の枠は書かれないので、ほどく側は削らない）が入るので、前の無音をその分だけ短くして、ほどいた音の前の無音を pre にする。
  7. 書く：proto3d/public/voice/<id>.mp3、proto3d/src/audio/voiceManifest.gen.json（ゲームが読む一覧：id・話し手・文・ファイル・
     ほどいた長さ sec・容量・sha256・クレジット・声・スタイル・前後の無音・間）、proto3d/voice/build-report.gen.json（読みの違いと数の測り）。
- samples：第一案と代わりの案（台本の alternates）を、同じ読み・同じ作り方で WAV と MP3 にして、作業用のフォルダへ書く
  （既定：$VOICE_SAMPLES_DIR。ファイル名の例 01_使者_織田_玄野武宏ツンギレ_第一案.wav）。読みを直した台詞は、自動の読みのままの物も作る
  （_自動の読み）。数の測り（長さ・間・基本周波数・ラウドネス・ピーク）を samples.json に書く。リポジトリには書かない。
- check：一覧のファイルがある・容量と sha256 が一覧どおり・MP3 のフレームから求めた長さが sec と同じ・一覧の文が台詞の表と同じ・台本と一覧の id と声が同じ。
- 作った者は音を耳で聞けない：読み・間・高さ・大きさは数で確かめただけ。声の良し悪しは利用者が聞いて決める。
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import io
import json
import math
import os
import re
import sys
import wave
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / 'proto3d/voice/script.json'
VOICE_LINES_TS = REPO / 'proto3d/src/campaign/ieyasu1570/story/voiceLines.ts'
PUBLIC = REPO / 'proto3d/public'
OUT_DIR = PUBLIC / 'voice'
MANIFEST = REPO / 'proto3d/src/audio/voiceManifest.gen.json'
REPORT = REPO / 'proto3d/voice/build-report.gen.json'

SR = 24000
TARGET_LUFS = -20.0
OFFSET_MAX_DB = 3.0
PEAK_CEIL_DB = -1.5
PEAK_MAX_DB = -1.0
MP3_KBPS = 64
MP3_QUALITY = 2
# LAME の遅れ（標本。24 kHz の MPEG-2 Layer III。Chromium の decodeAudioData で、音の立ち上がり 1110・終わり 1100 標本の遅れを測った）
MP3_DELAY = 1105
PRE_MIN = 0.05
EDGE_MARGIN = 0.02
FADE = 0.005
# 間（無音）とみなす音量：10 ms ごとの音量（3 つの中央値でならす）が、その台詞の最も大きい 10 ms より 35 dB 下より小さい所
GAP_DB = 35.0

# 使わない声（利用規約：ゲーム作品の除外・非商用だけ など。voicevox_vvm の TERMS.txt）
FORBIDDEN_VOICES = {'もち子さん', 'No.7', 'ユーレイちゃん'}
# 企業が携わる形で使うなら事前の確認が要る声（第一案にはしない。サンプルだけ）
CONFIRM_VOICES = {'青山龍星', '後鬼'}


class VoiceError(Exception):
    """止める理由（人が読む文）"""


# ---------------------------------------------------------------- 台詞の表・台本

def read_voice_lines(path: Path = VOICE_LINES_TS) -> dict[str, dict]:
    """voiceLines.ts の VOICE_LINES（L('id', 'speaker', 'where', '文') の並び）を読む"""
    src = path.read_text(encoding='utf-8')
    m = re.search(r'export const VOICE_LINES[^=]*=\s*\[(.*?)\n\];', src, re.S)
    if not m:
        raise VoiceError(f'{path} に VOICE_LINES が見つからない')
    out: dict[str, dict] = {}
    for g in re.finditer(r"L\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']*)'\s*\)", m.group(1)):
        vid, speaker, where, text = g.groups()
        if vid in out:
            raise VoiceError(f'VOICE_LINES の id {vid} が重なっている')
        out[vid] = {'speaker': speaker, 'where': where, 'text': text}
    if not out:
        raise VoiceError('VOICE_LINES が空')
    return out


def load_script(path: Path = SCRIPT) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def phrases_of(kana: str) -> list[tuple[str, str]]:
    """読みをアクセント句に分ける：[(句, 後ろの区切り '/' か '、' か '')]"""
    out = []
    buf = ''
    for ch in kana:
        if ch in '/、':
            out.append((buf, ch))
            buf = ''
        else:
            buf += ch
    out.append((buf, ''))
    return out


def check_script(script: dict, table: dict[str, dict]) -> list[str]:
    """台本の誤り（文が表と違う・形の誤り）。空なら書いてよい"""
    errs: list[str] = []
    seen = set()
    for ln in script.get('lines', []):
        vid = ln.get('id')
        if vid in seen:
            errs.append(f'{vid}：台本の id が重なっている')
        seen.add(vid)
        row = table.get(vid)
        if row is None:
            errs.append(f'{vid}：台詞の表（VOICE_LINES）に無い id')
            continue
        if ln.get('text') != row['text']:
            errs.append(f'{vid}：文が台詞の表と違う（台本「{ln.get("text")}」・表「{row["text"]}」）')
        if ln.get('speaker') != row['speaker']:
            errs.append(f'{vid}：話し手が台詞の表と違う（台本 {ln.get("speaker")}・表 {row["speaker"]}）')
        if ln.get('engine') != 'VOICEVOX':
            errs.append(f'{vid}：engine は VOICEVOX だけ')
        kana = ln.get('kana', '')
        if not re.fullmatch(r"[ァ-ヴー'/、_？]+", kana or ''):
            errs.append(f'{vid}：kana にカタカナと「\'」「/」「、」「_」「？」以外の字がある')
        for ph, _ in phrases_of(kana):
            if ph.count("'") != 1:
                errs.append(f'{vid}：アクセント句「{ph}」の「\'」が 1 つでない')
        n_breaks = kana.count('、')
        if len(ln.get('pauses', [])) != n_breaks:
            errs.append(f'{vid}：pauses の数 {len(ln.get("pauses", []))} が kana の「、」の数 {n_breaks} と違う')
        for p in ln.get('pauses', []):
            if not (0.0 <= p <= 1.5):
                errs.append(f'{vid}：間 {p} 秒は 0〜1.5 秒の外')
        if not (PRE_MIN <= ln.get('pre', 0) <= 1.0):
            errs.append(f'{vid}：pre は {PRE_MIN}〜1 秒（MP3 の遅れを前の無音から引くので {PRE_MIN} 秒より短くできない）')
        if not (0.05 <= ln.get('post', 0) <= 1.0):
            errs.append(f'{vid}：post は 0.05〜1 秒')
        cg = ln.get('chunkGainDb', [])
        if cg and len(cg) != n_breaks + 1:
            errs.append(f'{vid}：chunkGainDb の数 {len(cg)} が「、」で分けたまとまりの数 {n_breaks + 1} と違う')
        if any(abs(g) > 6 for g in cg):
            errs.append(f'{vid}：chunkGainDb は ±6 dB まで')
        if abs(ln.get('loudnessOffsetDb', 0.0)) > OFFSET_MAX_DB:
            errs.append(f'{vid}：loudnessOffsetDb は ±{OFFSET_MAX_DB} dB まで')
        for k, lo, hi in (('speed', 0.5, 2.0), ('pitch', -0.15, 0.15), ('intonation', 0.0, 2.0), ('volume', 0.0, 2.0)):
            v = ln.get(k)
            if not isinstance(v, (int, float)) or not (lo <= v <= hi):
                errs.append(f'{vid}：{k} は {lo}〜{hi}')
        voices = [ln.get('voice') or {}] + list(ln.get('alternates', []))
        for i, v in enumerate(voices):
            name = v.get('name')
            if name in FORBIDDEN_VOICES:
                errs.append(f'{vid}：{name} は利用規約の制限で使わない声')
            if i == 0 and name in CONFIRM_VOICES and not ln.get('termsConfirmed'):
                errs.append(f'{vid}：{name} は事前の確認が要る声（第一案にしない。確認したら termsConfirmed）')
            if not isinstance(v.get('styleId'), int) or not v.get('style'):
                errs.append(f'{vid}：声 {name} のスタイルと styleId が無い')
        if not ln.get('note'):
            errs.append(f'{vid}：演技のねらい（note）が無い')
    return errs


# ---------------------------------------------------------------- 読みの比べ

def reading_only(kana: str) -> str:
    return re.sub(r"['_？/、]", '', kana)


def kana_diffs(auto: str, mine: str) -> list[str]:
    """自動の読みと台本の読みの違い（句ごと。読み・アクセント・句の切り方・無声化）"""
    a = [p for p, _ in phrases_of(auto)]
    b = [p for p, _ in phrases_of(mine)]
    sa = [reading_only(x) for x in a]
    sb = [reading_only(x) for x in b]
    out: list[str] = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=sa, b=sb, autojunk=False).get_opcodes():
        if op == 'equal':
            for x, y in zip(a[i1:i2], b[j1:j2]):
                if x.replace('_', '') != y.replace('_', ''):
                    out.append(f'アクセント：{x} → {y}')
                elif x != y:
                    out.append(f'無声化：{x} → {y}')
            continue
        left = '/'.join(a[i1:i2]) or '（なし）'
        right = '/'.join(b[j1:j2]) or '（なし）'
        kind = '句の切り方' if ''.join(sa[i1:i2]) == ''.join(sb[j1:j2]) else '読み'
        out.append(f'{kind}：{left} → {right}')
    if [s for _, s in phrases_of(auto) if s] != [s for _, s in phrases_of(mine) if s] and not any(d.startswith('句の切り方') for d in out):
        out.append(f'間の位置：{"".join(s or "|" for _, s in phrases_of(auto))} → {"".join(s or "|" for _, s in phrases_of(mine))}')
    return out


# ---------------------------------------------------------------- 音声合成

class Engine:
    def __init__(self, ort: str, dic: str, vvm: str):
        try:
            import voicevox_core
            from voicevox_core.blocking import Onnxruntime, OpenJtalk, Synthesizer, VoiceModelFile
        except ImportError as e:
            raise VoiceError(f'voicevox_core が読めない（VOICEVOX CORE の入った Python で動かす）：{e}')
        for label, p in (('ONNX Runtime（--ort）', ort), ('辞書（--dict）', dic), ('音声モデルのフォルダ（--vvm）', vvm)):
            if not p or not Path(p).exists():
                raise VoiceError(f'{label} の場所が無い：{p!r}（引数か環境変数で渡す）')
        self.core_version = getattr(voicevox_core, '__version__', '?')
        self.ort_name = Path(ort).name
        self.dic_name = Path(dic).name
        ortlib = Onnxruntime.load_once(filename=str(ort))
        self.syn = Synthesizer(ortlib, OpenJtalk(str(dic)))
        self.styles: dict[int, tuple[str, str, str]] = {}
        for f in sorted(Path(vvm).glob('*.vvm')):
            with VoiceModelFile.open(f) as m:
                self.syn.load_voice_model(m)
                for c in m.metas:
                    for s in c.styles:
                        self.styles[s.id] = (c.name, s.name, str(getattr(c, 'version', '')))

    def check_voice(self, v: dict) -> None:
        got = self.styles.get(v['styleId'])
        if got is None:
            raise VoiceError(f'スタイル id {v["styleId"]}（{v["name"]} {v["style"]}）の音声モデルが読み込まれていない')
        if got[0] != v['name'] or got[1] != v['style']:
            raise VoiceError(f'スタイル id {v["styleId"]} は {got[0]} {got[1]}（台本は {v["name"]} {v["style"]}）')

    def auto_query(self, text: str, style: int):
        return self.syn.create_audio_query(text, style)

    def query(self, ln: dict, style: int, *, edits: bool = True):
        q = self.syn.create_audio_query_from_kana(ln['kana'], style)
        if q.kana != ln['kana']:
            raise VoiceError(f'{ln["id"]}：作った読み {q.kana} が台本の kana {ln["kana"]} と違う')
        apply_params(q, ln)
        if edits:
            apply_pauses(q, ln)
            apply_emphasis(q, ln)
        return q

    def synth(self, q, style: int) -> bytes:
        return self.syn.synthesis(q, style)


def apply_params(q, ln: dict) -> None:
    q.speed_scale = float(ln['speed'])
    q.pitch_scale = float(ln['pitch'])
    q.intonation_scale = float(ln['intonation'])
    q.volume_scale = float(ln['volume'])
    # 前後の無音は合成の後に切りそろえる（ここでは短く。声の始まりの立ち上がりを切らない長さ）
    q.pre_phoneme_length = 0.1
    q.post_phoneme_length = 0.1


def apply_pauses(q, ln: dict) -> None:
    pauses = list(ln.get('pauses', []))
    k = 0
    for ap in q.accent_phrases:
        if ap.pause_mora is None:
            continue
        if k >= len(pauses):
            raise VoiceError(f'{ln["id"]}：句の間の数が pauses より多い')
        pm = ap.pause_mora
        # 合成は音の長さを話す速さで割るので、掛けておく（実際の間が台本の秒になる）
        if isinstance(pm, dict):
            pm['vowel_length'] = pauses[k] * q.speed_scale
        else:
            pm.vowel_length = pauses[k] * q.speed_scale
        k += 1
    if k != len(pauses):
        raise VoiceError(f'{ln["id"]}：句の間の数 {k} が pauses の数 {len(pauses)} と違う')


def apply_emphasis(q, ln: dict) -> None:
    for e in ln.get('emphasis', []):
        try:
            m = q.accent_phrases[e['phrase']].moras[e['mora']]
        except IndexError:
            raise VoiceError(f'{ln["id"]}：拍の直しの場所 {e["phrase"]}/{e["mora"]} が無い')
        if m.text != e['text']:
            raise VoiceError(f'{ln["id"]}：拍の直しの場所 {e["phrase"]}/{e["mora"]} は「{m.text}」（台本は「{e["text"]}」）')
        if m.pitch > 0:
            m.pitch = m.pitch + float(e.get('pitch', 0.0))
        f = float(e.get('length', 1.0))
        m.vowel_length = m.vowel_length * f
        if m.consonant_length is not None:
            m.consonant_length = m.consonant_length * f


def intended_pauses(q) -> list[float]:
    out = []
    for ap in q.accent_phrases:
        pm = ap.pause_mora
        if pm is None:
            continue
        vl = pm['vowel_length'] if isinstance(pm, dict) else pm.vowel_length
        out.append(round(vl / q.speed_scale, 3))
    return out


# ---------------------------------------------------------------- 音の処理（numpy）

def np_():
    import numpy as np
    return np


def wav_to_float(wav: bytes):
    np = np_()
    with wave.open(io.BytesIO(wav)) as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2 or w.getframerate() != SR:
            raise VoiceError(f'合成の WAV の形が想定外：{w.getnchannels()} ch・{w.getsampwidth() * 8} bit・{w.getframerate()} Hz')
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768.0
    return x


def float_to_wav(x) -> bytes:
    np = np_()
    b = io.BytesIO()
    with wave.open(b, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(to_int16(x).tobytes())
    return b.getvalue()


def to_int16(x):
    np = np_()
    return np.clip(np.round(x * 32767.0), -32768, 32767).astype(np.int16)


def frame_db(x, hop: int):
    np = np_()
    n = len(x) // hop
    if n == 0:
        return np.array([-120.0])
    f = x[: n * hop].reshape(n, hop)
    return 10 * np.log10(np.maximum((f ** 2).mean(axis=1), 1e-12))


def speech_bounds(x) -> tuple[int, int]:
    """声の始まりと終わり（標本）：10 ms ごとの音量が、ピークより 50 dB 下か -60 dBFS の大きい方を超える最初と最後の 10 ms"""
    np = np_()
    hop = SR // 100
    db = frame_db(x, hop)
    th = max(float(db.max()) - 50.0, -60.0)
    on = np.nonzero(db > th)[0]
    if len(on) == 0:
        raise VoiceError('声が無い（合成の結果が無音）')
    return int(on[0]) * hop, min(len(x), (int(on[-1]) + 1) * hop)


def trim_pad(x, pre: float, post: float, *, mp3: bool) -> tuple:
    """前後の無音を pre・post にそろえる。mp3 のときは MP3 の遅れの分だけ前を短くする（ほどいた音の前の無音が pre になる）"""
    np = np_()
    a, b = speech_bounds(x)
    m = int(EDGE_MARGIN * SR)
    a = max(0, a - m)
    b = min(len(x), b + m)
    y = x[a:b].copy()
    nf = int(FADE * SR)
    ramp = 0.5 - 0.5 * np.cos(np.linspace(0, math.pi, nf))
    y[:nf] *= ramp
    y[-nf:] *= ramp[::-1]
    lead = int(round(pre * SR)) - (MP3_DELAY if mp3 else 0)
    if lead < 0:
        raise VoiceError(f'pre {pre} 秒が MP3 の遅れより短い')
    return np.concatenate([np.zeros(lead), y, np.zeros(int(round(post * SR)))]), len(y)


def _biquad(x, b, a):
    np = np_()
    b0, b1, b2 = (v / a[0] for v in b)
    a1, a2 = a[1] / a[0], a[2] / a[0]
    y = np.empty_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x.tolist()):
        o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, v
        y2, y1 = y1, o
        y[i] = o
    return y


def loudness_lufs(x) -> float:
    """ITU-R BS.1770-4 の積分ラウドネス（K 特性・400 ms の区切り 75% 重ね・-70 LUFS と -10 LU のゲート）。モノラルを 1 チャンネルとして測る"""
    np = np_()
    # K 特性（pyloudnorm と同じ係数の作り方。任意の標本化の速さ）
    G, Q, fc = 3.999843853973347, 0.7071752369554193, 1681.974450955533
    A = 10 ** (G / 40.0)
    w0 = 2 * math.pi * fc / SR
    al = math.sin(w0) / (2 * Q)
    c = math.cos(w0)
    sa = math.sqrt(A)
    shelf_b = (A * ((A + 1) + (A - 1) * c + 2 * sa * al), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - 2 * sa * al))
    shelf_a = ((A + 1) - (A - 1) * c + 2 * sa * al, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - 2 * sa * al)
    Q2, fc2 = 0.5003270373253953, 38.13547087602444
    w0 = 2 * math.pi * fc2 / SR
    al = math.sin(w0) / (2 * Q2)
    c = math.cos(w0)
    hp_b = ((1 + c) / 2, -(1 + c), (1 + c) / 2)
    hp_a = (1 + al, -2 * c, 1 - al)
    y = _biquad(_biquad(x, shelf_b, shelf_a), hp_b, hp_a)
    blk, step = int(0.4 * SR), int(0.1 * SR)
    if len(y) < blk:
        return -0.691 + 10 * math.log10(max(float((y ** 2).mean()), 1e-12))
    z = np.array([(y[i:i + blk] ** 2).mean() for i in range(0, len(y) - blk + 1, step)])
    lj = -0.691 + 10 * np.log10(np.maximum(z, 1e-12))
    z1 = z[lj > -70]
    if len(z1) == 0:
        return -120.0
    rel = -0.691 + 10 * math.log10(z1.mean()) - 10
    z2 = z[(lj > -70) & (lj > rel)]
    return -0.691 + 10 * math.log10(z2.mean())


def peak_db(x, oversample: int = 1) -> float:
    np = np_()
    if oversample > 1:
        n = len(x)
        X = np.fft.rfft(x, n=2 * n)
        x = np.fft.irfft(X, n=2 * n * oversample) * oversample
    return 20 * math.log10(max(float(np.abs(x).max()), 1e-9))


def f0_track(x):
    """基本周波数（YIN：10 ms ごと・20 ms の積分窓・累積平均で正規化した差分の 0.15 の谷・60〜400 Hz）。声の無い所は入れない"""
    np = np_()
    hop, win = SR // 100, SR // 50
    lo, hi = SR // 400, SR // 60
    db = frame_db(x, hop)
    gate = float(db.max()) - 30.0
    times, f0 = [], []
    n = win + hi
    for k, i in enumerate(range(0, len(x) - n, hop)):
        c = k + (win // 2) // hop
        if c < len(db) and db[c] < gate:
            continue
        seg = x[i:i + n]
        a = seg[:win]
        e0 = float((a * a).sum())
        if e0 <= 1e-10:
            continue
        cs = np.concatenate([[0.0], np.cumsum(seg * seg)])
        et = cs[win:win + hi + 1] - cs[0:hi + 1]
        r = np.fft.irfft(np.conj(np.fft.rfft(a, 2 * n)) * np.fft.rfft(seg, 2 * n))[: hi + 1]
        d = e0 + et - 2 * r
        d[0] = 0.0
        cm = np.ones_like(d)
        acc = np.cumsum(d[1:])
        cm[1:] = d[1:] * np.arange(1, hi + 1) / np.maximum(acc, 1e-12)
        cand = np.nonzero(cm[lo:hi] < 0.15)[0]
        if len(cand):
            j = lo + int(cand[0])
            while j + 1 < hi and cm[j + 1] < cm[j]:
                j += 1
        else:
            j = lo + int(np.argmin(cm[lo:hi]))
            if cm[j] > 0.3:
                continue
        if 0 < j < hi:
            p0, p1, p2 = cm[j - 1], cm[j], cm[j + 1]
            den = p0 - 2 * p1 + p2
            dj = (p0 - p2) / (2 * den) if den != 0 else 0.0
        else:
            dj = 0.0
        times.append((i + win / 2) / SR)
        f0.append(SR / (j + dj))
    return np.array(times), np.array(f0)


def measure(x, speech_len: int | None = None) -> dict:
    """数の測り：長さ・前後の無音・中の間（120 ms 以上）・基本周波数・ラウドネス・ピーク"""
    np = np_()
    a, b = speech_bounds(x)
    hop = SR // 100
    db = smooth_db(frame_db(x, hop))
    th = float(db.max()) - GAP_DB
    gaps = []
    run = None
    for k in range(a // hop, b // hop):
        if db[k] < th:
            run = k if run is None else run
        else:
            if run is not None and (k - run) * hop >= 0.12 * SR:
                gaps.append({'at': round(run * hop / SR, 3), 'sec': round((k - run) * hop / SR, 3)})
            run = None
    t, f0 = f0_track(x)
    res = {
        'sec': round(len(x) / SR, 3),
        'speechSec': round((b - a) / SR, 3),
        'leadSec': round(a / SR, 3),
        'tailSec': round((len(x) - b) / SR, 3),
        'pauses': gaps,
        'lufs': round(loudness_lufs(x), 2),
        'peakDb': round(peak_db(x), 2),
        'truePeakDb': round(peak_db(x, 4), 2),
    }
    if len(f0):
        st = 12 * np.log2(f0 / np.median(f0))
        res['f0'] = {
            'medianHz': round(float(np.median(f0)), 1),
            'p10Hz': round(float(np.percentile(f0, 10)), 1),
            'p90Hz': round(float(np.percentile(f0, 90)), 1),
            'minHz': round(float(f0.min()), 1),
            'maxHz': round(float(f0.max()), 1),
            'rangeSemitones': round(float(np.percentile(st, 90) - np.percentile(st, 10)), 2),
            'voicedFrames': int(len(f0)),
        }
        # 語尾：最後の声のある 150 ms の中央値の、台詞全体の中央値からの差（半音。正は高い）
        end = t[-1]
        last = f0[t >= end - 0.15]
        res['f0']['endVsMedianSemitones'] = round(float(12 * np.log2(np.median(last) / np.median(f0))), 2)
    return res


def smooth_db(db):
    """10 ms ごとの音量を 3 つの中央値でならす（一瞬の小さな音・切れ目で間を割らない）"""
    np = np_()
    if len(db) < 3:
        return db
    p = np.concatenate([[db[0]], db, [db[-1]]])
    return np.median(np.stack([p[:-2], p[1:-1], p[2:]]), axis=0)


def find_breaks(x, n: int) -> list[tuple[int, int]]:
    """声の中の間（「、」の所）を前から n 個見つける：10 ms ごとの音量がピークの GAP_DB 下より小さい 40 ms 以上の所の、長い方から n 個を時刻の順に"""
    np = np_()
    hop = SR // 100
    db = smooth_db(frame_db(x, hop))
    th = float(db.max()) - GAP_DB
    a, b = speech_bounds(x)
    runs, run = [], None
    for k in range(a // hop, b // hop):
        if db[k] < th:
            run = k if run is None else run
        else:
            if run is not None and k - run >= 4:
                runs.append((run * hop, k * hop))
            run = None
    if len(runs) < n:
        raise VoiceError(f'句の音量を変える間が {n} 個見つからない（見つかったのは {len(runs)} 個）')
    return sorted(sorted(runs, key=lambda r: r[0] - r[1])[:n])


def expected_breaks(q, n_samples: int) -> list[float]:
    """AudioQuery の音の長さから見積もった「、」の間の真ん中の時刻（秒。合成の長さに合わせて伸び縮みさせる）"""
    sp = q.speed_scale
    t = q.pre_phoneme_length / sp
    out = []
    for ap in q.accent_phrases:
        for m in ap.moras:
            t += ((m.consonant_length or 0.0) + m.vowel_length) / sp
        pm = ap.pause_mora
        if pm is not None:
            vl = (pm['vowel_length'] if isinstance(pm, dict) else pm.vowel_length) / sp
            out.append(t + vl / 2)
            t += vl
    t += q.post_phoneme_length / sp
    k = n_samples / SR / t
    return [v * k for v in out]


def chunk_gain(x, gains_db: list[float], q=None):
    """「、」で分けた句のまとまりごとに音量を変える（クリップゲイン。切り替えは間の真ん中で 40 ms かけてなめらかに）。
    見つけた間が AudioQuery からの見積もりと 0.2 秒より離れていれば止める（別の所の無音を間と取り違えない）"""
    np = np_()
    if not gains_db or all(g == 0 for g in gains_db):
        return x
    breaks = find_breaks(x, len(gains_db) - 1)
    if q is not None:
        for (s0, s1), e in zip(breaks, expected_breaks(q, len(x))):
            if abs((s0 + s1) / 2 / SR - e) > 0.2:
                raise VoiceError(f'句の音量を変える間の位置 {(s0 + s1) / 2 / SR:.2f} 秒が見積もり {e:.2f} 秒と合わない')
    env = np.full(len(x), 10 ** (gains_db[0] / 20))
    half = int(0.02 * SR)
    for (s0, s1), g0, g1 in zip(breaks, gains_db[:-1], gains_db[1:]):
        c = (s0 + s1) // 2
        a0, a1 = 10 ** (g0 / 20), 10 ** (g1 / 20)
        ramp = 0.5 - 0.5 * np.cos(np.linspace(0, math.pi, 2 * half))
        env[c - half:c + half] = a0 + (a1 - a0) * ramp
        env[c + half:] = a1
    return x * env


def normalize(x, offset_db: float) -> tuple:
    """目標のラウドネスへ。4 倍補間のピークが PEAK_CEIL_DB を超えるならそこまで（返り：音・掛けた dB・ピークで抑えたか）"""
    lufs = loudness_lufs(x)
    gain = TARGET_LUFS + offset_db - lufs
    tp = peak_db(x, 4)
    limited = False
    if tp + gain > PEAK_CEIL_DB:
        gain = PEAK_CEIL_DB - tp
        limited = True
    return x * (10 ** (gain / 20)), gain, limited


# ---------------------------------------------------------------- MP3

MP3_BR = {
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
MP3_SR = {1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 25: [11025, 12000, 8000]}


def mp3_frames(data: bytes) -> dict:
    """MP3（Layer III）のフレームを数える。返り：{frames, samples, rate, sec}。形が崩れていれば止める"""
    i = 0
    if data[:3] == b'ID3':
        size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
        i = 10 + size
    frames = samples = 0
    rate = None
    while i < len(data):
        if i + 4 > len(data):
            raise VoiceError(f'MP3 の終わりに半端なバイト（{len(data) - i}）')
        h = int.from_bytes(data[i:i + 4], 'big')
        if (h >> 21) & 0x7FF != 0x7FF:
            raise VoiceError(f'MP3 のフレームの頭が無い（{i} バイト目）')
        ver = {0: 25, 2: 2, 3: 1}.get((h >> 19) & 3)
        layer = (h >> 17) & 3
        bri = (h >> 12) & 15
        sri = (h >> 10) & 3
        pad = (h >> 9) & 1
        if ver is None or layer != 1 or bri in (0, 15) or sri == 3:
            raise VoiceError(f'Layer III でない・形の誤りのフレーム（{i} バイト目）')
        br = MP3_BR[1 if ver == 1 else 2][bri] * 1000
        sr = MP3_SR[ver][sri]
        rate = rate or sr
        if sr != rate:
            raise VoiceError('フレームごとに標本化の速さが違う')
        spf = 1152 if ver == 1 else 576
        flen = (144 if ver == 1 else 72) * br // sr + pad
        i += flen
        frames += 1
        samples += spf
    if i != len(data):
        raise VoiceError('MP3 の最後のフレームが途中で切れている')
    return {'frames': frames, 'samples': samples, 'rate': rate, 'sec': samples / rate}


def encode_mp3(x) -> bytes:
    try:
        import lameenc
    except ImportError as e:
        raise VoiceError(f'lameenc が読めない：{e}')
    e = lameenc.Encoder()
    e.set_bit_rate(MP3_KBPS)
    e.set_in_sample_rate(SR)
    e.set_channels(1)
    e.set_quality(MP3_QUALITY)
    return bytes(e.encode(to_int16(x).tobytes()) + e.flush())


# ---------------------------------------------------------------- 作る

def render(eng: Engine, ln: dict, voice: dict, *, auto: bool = False) -> dict:
    """1 つの台詞を 1 つの声で作る（返り：WAV・MP3・測り・読み）"""
    eng.check_voice(voice)
    sid = voice['styleId']
    if auto:
        q = eng.auto_query(ln['text'], sid)
        apply_params(q, ln)
    else:
        q = eng.query(ln, sid)
    raw = wav_to_float(eng.synth(q, sid))
    if not auto:
        raw = chunk_gain(raw, list(ln.get('chunkGainDb', [])), q)
    # 音量は、ほどいた後と同じ形（前の無音がそのまま pre）で測って決め、MP3 にする形（前の無音から MP3 の遅れを引いた形）にも同じ dB を掛ける
    wav_x, speech_len = trim_pad(raw, ln['pre'], ln['post'], mp3=False)
    wav_x, gain, limited = normalize(wav_x, float(ln.get('loudnessOffsetDb', 0.0)))
    x, _ = trim_pad(raw, ln['pre'], ln['post'], mp3=True)
    x = x * (10 ** (gain / 20))
    mp3 = encode_mp3(x)
    fr = mp3_frames(mp3)
    m = measure(wav_x)
    lead = (len(x) - speech_len - int(round(ln['post'] * SR)) + MP3_DELAY) / SR
    return {
        'query_kana': q.kana,
        'intendedPauses': intended_pauses(q),
        'gainDb': round(gain, 2),
        'peakLimited': limited,
        'wav': float_to_wav(wav_x),
        'mp3': mp3,
        'mp3info': fr,
        'lead': round(lead, 3),
        'tail': round(fr['sec'] - lead - speech_len / SR, 3),
        'measure': m,
    }


def engine_from(args) -> Engine:
    return Engine(args.ort or os.environ.get('VOICEVOX_ORT', ''), args.dict or os.environ.get('VOICEVOX_DICT', ''), args.vvm or os.environ.get('VOICEVOX_VVM', ''))


def validated(table=None) -> tuple[dict, dict]:
    script = load_script()
    table = table or read_voice_lines()
    errs = check_script(script, table)
    if errs:
        raise VoiceError('台本に誤りがあるので何も書かない：\n  ' + '\n  '.join(errs))
    return script, table


def cmd_build(args) -> int:
    script, _table = validated()
    eng = engine_from(args)
    entries, report = [], []
    files: dict[Path, bytes] = {}
    for ln in script['lines']:
        v = ln['voice']
        auto = eng.auto_query(ln['text'], v['styleId']).kana
        r = render(eng, ln, v)
        rel = f'voice/{ln["id"]}.mp3'
        files[PUBLIC / rel] = r['mp3']
        e = {
            'id': ln['id'],
            'speaker': ln['speaker'],
            'text': ln['text'],
            'file': rel,
            'sec': round(r['mp3info']['sec'], 3),
            'bytes': len(r['mp3']),
            'sha256': hashlib.sha256(r['mp3']).hexdigest(),
            'credit': f'VOICEVOX:{v["name"]}',
            'voice': v['name'],
            'style': v['style'],
            'styleId': v['styleId'],
            'lead': r['lead'],
            'tail': r['tail'],
        }
        if 'gapBefore' in ln:
            e['gapBefore'] = ln['gapBefore']
        entries.append(e)
        report.append({
            'id': ln['id'],
            'voice': f'{v["name"]}（{v["style"]}・{v["styleId"]}）',
            'autoKana': auto,
            'kana': ln['kana'],
            'readingChanged': reading_only(auto) != reading_only(ln['kana']),
            'diffs': kana_diffs(auto, ln['kana']),
            'intendedPauses': r['intendedPauses'],
            'gainDb': r['gainDb'],
            'peakLimited': r['peakLimited'],
            'pcm': r['measure'],
            'mp3': {'bytes': len(r['mp3']), 'frames': r['mp3info']['frames'], 'sec': round(r['mp3info']['sec'], 3), 'lead': r['lead'], 'tail': r['tail']},
        })
        m = r['measure']
        print(f'{ln["id"]}: {e["sec"]:.3f} s・{e["bytes"]} B・{m["lufs"]} LUFS・true peak {m["truePeakDb"]} dBFS・'
              f'F0 中央 {m.get("f0", {}).get("medianHz")} Hz・間 {[p["sec"] for p in m["pauses"]]}・読みの違い {len(report[-1]["diffs"])}')
    stale = sorted(p.name for p in OUT_DIR.glob('*') if p.is_file() and PUBLIC / f'voice/{p.name}' not in files) if OUT_DIR.exists() else []
    manifest = {
        'version': 1,
        'about': '台詞の音声の一覧（proto3d/tools/voice-build.py build が作る。手で書き換えない）',
        'engine': f'VOICEVOX CORE {eng.core_version}',
        'format': f'MP3 モノラル {SR} Hz 固定 {MP3_KBPS} kbps（LAME・lameenc）',
        'loudness': {'targetLufs': TARGET_LUFS, 'method': 'ITU-R BS.1770-4（K 特性・ゲート付き。モノラルを 1 チャンネルとして測る）＋台本の演技の差', 'peakMaxDbfs': PEAK_MAX_DB},
        'lines': entries,
    }
    rep = {
        'about': '台詞の音声を作ったときの記録（proto3d/tools/voice-build.py build が作る）。数で測っただけで、耳で聞いた確かめではない',
        'engine': f'VOICEVOX CORE {eng.core_version}・{eng.ort_name}・{eng.dic_name}',
        'models': sorted({f'{n}（{s}・id {sid}・モデル {ver}）' for sid, (n, s, ver) in eng.styles.items() if any(ln['voice']['styleId'] == sid for ln in script['lines'])}),
        'loudness': manifest['loudness'],
        'mp3Delay': MP3_DELAY,
        'lines': report,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for p, b in files.items():
        p.write_bytes(b)
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=4) + '\n', encoding='utf-8')
    REPORT.write_text(json.dumps(rep, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'書いた：{len(files)} ファイル（{sum(len(b) for b in files.values())} B）・{MANIFEST.relative_to(REPO)}・{REPORT.relative_to(REPO)}')
    if stale:
        print(f'注意：一覧に無いファイルが proto3d/public/voice にある（消していない）：{", ".join(stale)}')
    return 0


def cmd_samples(args) -> int:
    script, _ = validated()
    out = Path(args.out or os.environ.get('VOICE_SAMPLES_DIR', ''))
    if not str(out) or str(out) == '.':
        raise VoiceError('サンプルの書き先（--out か VOICE_SAMPLES_DIR）が無い')
    if out.resolve() == REPO.resolve() or REPO.resolve() in out.resolve().parents:
        raise VoiceError('サンプルはリポジトリの外の作業用のフォルダへ書く（WAV をリポジトリに入れない）')
    out.mkdir(parents=True, exist_ok=True)
    eng = engine_from(args)
    rows = []
    for n, ln in enumerate(script['lines'], start=1):
        auto = eng.auto_query(ln['text'], ln['voice']['styleId']).kana
        variants = [(ln['voice'], '第一案', False)]
        for k, alt in enumerate(ln.get('alternates', []), start=1):
            variants.append((alt, '代わりの案' if len(ln.get('alternates', [])) == 1 else f'代わりの案{k}', False))
        if kana_diffs(auto, ln['kana']):
            variants.append((ln['voice'], '自動の読み', True))
        for v, tag, is_auto in variants:
            r = render(eng, ln, v, auto=is_auto)
            stem = f'{n:02d}_{ln["label"]}_{v["name"]}{v["style"]}_{tag}'
            (out / f'{stem}.wav').write_bytes(r['wav'])
            (out / f'{stem}.mp3').write_bytes(r['mp3'])
            rows.append({
                'file': f'{stem}.wav',
                'mp3': f'{stem}.mp3',
                'id': ln['id'],
                'text': ln['text'],
                'voice': v['name'],
                'style': v['style'],
                'styleId': v['styleId'],
                'choice': tag,
                'kana': r['query_kana'],
                'gainDb': r['gainDb'],
                'peakLimited': r['peakLimited'],
                'mp3Bytes': len(r['mp3']),
                'mp3Sec': round(r['mp3info']['sec'], 3),
                **r['measure'],
            })
            m = r['measure']
            print(f'{stem}: {m["sec"]} s・{m["lufs"]} LUFS・peak {m["peakDb"]} dBFS・F0 中央 {m.get("f0", {}).get("medianHz")} Hz・間 {[p["sec"] for p in m["pauses"]]}')
    (out / 'samples.json').write_text(json.dumps({
        'about': '台詞の音声のサンプル（第一案・代わりの案・自動の読み）の数の測り。耳で聞いた確かめではない。リポジトリには入れない',
        'engine': f'VOICEVOX CORE {eng.core_version}',
        'note': 'WAV は MP3 と同じ音量・前後の無音（pre・post）。MP3 は前に LAME の遅れ（約 46 ms）を見込んで前の無音を短くしてある',
        'samples': rows,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'書いた：{len(rows)} 組（WAV と MP3）・{out / "samples.json"}')
    return 0


def cmd_check(_args) -> int:
    table = read_voice_lines()
    script = load_script()
    errs = check_script(script, table)
    man = json.loads(MANIFEST.read_text(encoding='utf-8'))
    sids = [ln['id'] for ln in script['lines']]
    mids = [e['id'] for e in man['lines']]
    if sids != mids:
        errs.append(f'台本と一覧の id が違う（台本 {sids}・一覧 {mids}）')
    by_script = {ln['id']: ln for ln in script['lines']}
    for e in man['lines']:
        row = table.get(e['id'])
        if row is None or row['text'] != e['text'] or row['speaker'] != e['speaker']:
            errs.append(f'{e["id"]}：一覧の文・話し手が台詞の表と違う')
        ln = by_script.get(e['id'])
        if ln and (ln['voice']['name'] != e['voice'] or ln['voice']['styleId'] != e['styleId'] or e['credit'] != f'VOICEVOX:{e["voice"]}'):
            errs.append(f'{e["id"]}：一覧の声・クレジットが台本と違う')
        p = PUBLIC / e['file']
        if not p.is_file():
            errs.append(f'{e["id"]}：ファイル {e["file"]} が無い')
            continue
        b = p.read_bytes()
        if len(b) != e['bytes'] or hashlib.sha256(b).hexdigest() != e['sha256']:
            errs.append(f'{e["id"]}：{e["file"]} の容量・sha256 が一覧と違う')
        try:
            fr = mp3_frames(b)
            if abs(fr['sec'] - e['sec']) > 0.0015:
                errs.append(f'{e["id"]}：MP3 のフレームから求めた長さ {fr["sec"]:.4f} が一覧の {e["sec"]} と違う')
        except VoiceError as x:
            errs.append(f'{e["id"]}：{x}')
    listed = {Path(e['file']).name for e in man['lines']}
    for p in sorted(OUT_DIR.glob('*')) if OUT_DIR.exists() else []:
        if p.name not in listed:
            errs.append(f'proto3d/public/voice/{p.name} は一覧に無い（WAV・作業用の物を置かない）')
    for x in errs:
        print('×', x)
    print(f'check：{len(man["lines"])} 件・誤り {len(errs)}')
    return 1 if errs else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='台詞の音声（VOICEVOX）を台本から作る・確かめる（Version 28）')
    sub = ap.add_subparsers(dest='cmd', required=True)
    for name in ('build', 'samples'):
        s = sub.add_parser(name)
        s.add_argument('--ort', help='ONNX Runtime の .so（VOICEVOX 用。環境変数 VOICEVOX_ORT）')
        s.add_argument('--dict', help='Open JTalk の辞書のフォルダ（VOICEVOX_DICT）')
        s.add_argument('--vvm', help='音声モデル *.vvm のフォルダ（VOICEVOX_VVM）')
        if name == 'samples':
            s.add_argument('--out', help='サンプルの書き先（リポジトリの外。VOICE_SAMPLES_DIR）')
    sub.add_parser('check')
    args = ap.parse_args(argv)
    try:
        return {'build': cmd_build, 'samples': cmd_samples, 'check': cmd_check}[args.cmd](args)
    except VoiceError as e:
        print(f'止めた：{e}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
