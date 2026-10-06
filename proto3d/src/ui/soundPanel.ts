/**
 * メニューに足す小さな「音」の欄：全体のミュートと、BGM・声・効果音／環境音の音量（docs/audio.md）。
 * 変えたらすぐ当て、'koto-sengoku/3d-audio' に書く（変えたときだけ）。声は端末の日本語読み上げを使うことを短く書く。
 * 音が無い（作れなかった）ときは欄を出さない。
 */
import { audio } from '../audio';
import { VOLUME_CHANNELS, type VolumeChannel } from '../audio/settings';
import { el } from './dom';

const LABEL: Record<VolumeChannel, string> = { bgm: 'BGM', voice: '声', sfx: '効果音・環境音' };

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
    const st = sys.voiceStatus;
    const note =
        '声は端末の日本語読み上げを使います。端末に日本語の声が無いと声は出ません（字幕は出ます）。' +
        (st === 'no_japanese' || st === 'unsupported' ? 'この端末では日本語の声が見つかりませんでした。' : '');
    box.append(el('p', 'g-sound-note', note));
    return box;
}
