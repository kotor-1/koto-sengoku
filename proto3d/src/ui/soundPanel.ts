/**
 * メニューに足す小さな「音」の欄：全体のミュートと、BGM・声・効果音／環境音の音量、声の種類（docs/audio.md）。
 * 変えたらすぐ当て、'koto-sengoku/3d-audio' に書く（変えたときだけ）。
 * 声の種類（Version 28。docs/v28-town-motion-voice.md §5.4）：新しい声（台詞ごとに作った音声ファイル・既定）／端末の読み上げ（旧）。
 * URL の ?voice= で決めている回は、選べないようにして、そのことを書く。声のクレジット（「音声：VOICEVOX:…」。一覧に使った声の名前）を出す。
 * 音が無い（作れなかった）ときは欄を出さない。
 */
import { audio } from '../audio';
import { VOICE_SOURCES, VOLUME_CHANNELS, type VoiceSource, type VolumeChannel } from '../audio/settings';
import { voiceCredits } from '../audio/voiceManifest';
import { el } from './dom';

const LABEL: Record<VolumeChannel, string> = { bgm: 'BGM', voice: '声', sfx: '効果音・環境音' };
const SOURCE_LABEL: Record<VoiceSource, string> = { file: '新しい声', tts: '端末の読み上げ（旧）' };

/**
 * 声の種類ごとの短い説明（端末の読み上げは、端末に日本語の声が無いと分かったときにそのことを足す）。
 * 端末の読み上げ（旧）でも演出の字幕の長さは新しい声の音声ファイルの長さのまま（docs/v28-town-motion-voice.md §7.7・§8.5）なので、
 * 読み上げが次の字幕で止まることがあると書き、旧版そのままの比べ方（Version 27）を示す
 */
export function voiceNote(source: VoiceSource, status: string, fixed: boolean): string {
    const base =
        source === 'file'
            ? '声は台詞ごとに作った音声です。音声の無い台詞は字幕だけです。'
            : '声は端末の日本語読み上げ（旧）を使います。端末に日本語の声が無いと声は出ません（字幕は出ます）。' +
              (status === 'no_japanese' || status === 'unsupported' ? 'この端末では日本語の声が見つかりませんでした。' : '') +
              '字幕の長さは新しい声に合わせているため、端末によっては読み上げが途中で止まることがあります（旧版の読み上げのままの比較は Version 27 で）。';
    return base + (fixed ? `（URL の指定 ?voice=${source} でこの種類にしています）` : '');
}

/** 音声のクレジット（一覧に使った声。無ければ空） */
export function voiceCreditText(credits: readonly string[] = voiceCredits()): string {
    return credits.length ? `音声：${credits.join('、')}` : '';
}

/** 欄の見た目（メニューの板の中に小さく。ui.css は担当が多いので、ここで 1 回だけ足す） */
const CSS = `
.g-sound { margin-top: 12px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.14); font-size: 13px; }
.g-sound-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.g-sound-mute { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.g-sound-mute input { width: 18px; height: 18px; }
.g-sound-row { display: grid; grid-template-columns: 7.5em 1fr 2.5em; align-items: center; gap: 8px; min-height: 30px; }
.g-sound-row input[type=range] { width: 100%; touch-action: none; }
.g-sound-row .v { text-align: right; font-variant-numeric: tabular-nums; opacity: 0.8; }
.g-sound-note { margin: 6px 0 0; font-size: 11.5px; opacity: 0.75; line-height: 1.45; }
.g-sound-row select { grid-column: 2 / 4; min-height: 28px; font: inherit; font-size: 13px; color: inherit; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.28); border-radius: 4px; padding: 2px 6px; }
.g-sound-row select option { color: #111; background: #f4efe4; }
.g-sound-row select:disabled { opacity: 0.6; }
.g-sound-credit { margin: 4px 0 0; font-size: 11px; opacity: 0.7; line-height: 1.4; }
`;
let styled = false;
function ensureStyle(): void {
    if (styled) return;
    styled = true;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.append(st);
}

/** 欄を作る（無ければ null） */
export function soundPanel(): HTMLElement | null {
    const sys = audio();
    if (!sys) return null;
    ensureStyle();
    const s = sys.settings.get();
    const box = el('div', 'g-sound');
    box.dataset.sound = 'panel';
    // 欄の中の操作は、層（画面を覆う物）の押し始めの preventDefault に渡さない（つまみを動かせるように）
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    // つまみ・ミュートに当てたキー（矢印など）は、メニューのボタンの並びの選び直しに回さない（Esc・M はメニューを閉じるのに回す）
    box.addEventListener('keydown', (e) => {
        if (e.code !== 'Escape' && e.code !== 'KeyM') e.stopPropagation();
    });
    const head = el('div', 'g-sound-head');
    head.append(el('b', undefined, '音'));
    const muteLabel = el('label', 'g-sound-mute');
    const mute = el('input');
    mute.type = 'checkbox';
    mute.checked = s.muted;
    mute.dataset.id = 'mute';
    mute.addEventListener('change', () => {
        sys.unlock();
        sys.settings.set({ muted: mute.checked });
    });
    muteLabel.append(mute, document.createTextNode('ミュート'));
    head.append(muteLabel);
    box.append(head);
    for (const ch of VOLUME_CHANNELS) {
        const row = el('label', 'g-sound-row');
        const name = el('span', 'n', LABEL[ch]);
        const r = el('input');
        r.type = 'range';
        r.min = '0';
        r.max = '100';
        r.step = '5';
        r.value = String(Math.round(s[ch] * 100));
        r.dataset.id = ch;
        r.setAttribute('aria-label', `${LABEL[ch]}の音量`);
        const v = el('span', 'v', `${r.value}`);
        r.addEventListener('input', () => {
            v.textContent = r.value;
            sys.unlock();
            sys.settings.set({ [ch]: Number(r.value) / 100 });
        });
        row.append(name, r, v);
        box.append(row);
    }
    // 声の種類（新しい声／端末の読み上げ（旧））。URL の ?voice= で決めている回は選べない
    const srcRow = el('label', 'g-sound-row');
    const src = el('select');
    src.dataset.id = 'voiceSource';
    src.setAttribute('aria-label', '声の種類');
    for (const v of VOICE_SOURCES) {
        const o = el('option', undefined, SOURCE_LABEL[v]);
        o.value = v;
        src.append(o);
    }
    src.value = sys.voiceSource;
    src.disabled = sys.voiceSourceFixed;
    srcRow.append(el('span', 'n', '声の種類'), src);
    box.append(srcRow);
    const note = el('p', 'g-sound-note');
    note.dataset.id = 'voiceNote';
    const showNote = () => (note.textContent = voiceNote(sys.voiceSource, sys.voiceStatus, sys.voiceSourceFixed));
    src.addEventListener('change', () => {
        sys.unlock();
        sys.settings.set({ voiceSource: src.value as VoiceSource });
        src.value = sys.voiceSource;
        showNote();
    });
    showNote();
    box.append(note);
    // クレジット（音声ファイルに使った声。VOICEVOX の利用規約で作品の中に書く。声の種類に関わらず出す）
    const credit = voiceCreditText();
    if (credit) {
        const c = el('p', 'g-sound-credit', credit);
        c.dataset.id = 'voiceCredit';
        box.append(c);
    }
    return box;
}
