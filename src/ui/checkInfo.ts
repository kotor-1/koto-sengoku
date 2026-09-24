/**
 * 実機確認のための表示（控えめ）：
 * - タイトルとメニューに、コミット ID・Phaser の版・ビルドの種類
 * - メニューに画質の切り替え（自動→高→低）。次回の起動（再読み込み）で反映
 */
import { buildLabel } from '../buildInfo';
import { QUALITY_LABELS, loadQualityChoice, saveQualityChoice, type QualityChoice, type QualityProfile } from '../render/world/quality';

const ORDER: QualityChoice[] = ['auto', 'high', 'low'];

export function setupCheckInfo(quality: QualityProfile): void {
    const label = buildLabel();
    for (const id of ['build-info', 'menu-build-info']) {
        const el = document.getElementById(id);
        if (el) el.textContent = label;
    }

    const btn = document.getElementById('btn-quality');
    const note = document.getElementById('quality-note');
    if (!btn || !note) return;
    let choice = loadQualityChoice();
    const current = `いまの画質：${quality.tier === 'high' ? '高' : '低'}（${quality.reason}）`;
    const render = (msg?: string) => {
        btn.textContent = `画質：${QUALITY_LABELS[choice]}`;
        note.textContent = msg ?? current;
    };
    render();
    btn.addEventListener('click', () => {
        choice = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
        const ok = saveQualityChoice(choice);
        render(ok ? `${current}。再読み込みで反映されます` : '画質の設定を端末に保存できませんでした');
    });
}
