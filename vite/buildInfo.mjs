// ビルド時に「どのコミットから作ったか」を埋め込む。画面に表示して、実機確認の記録と照合できるようにする。
import { execSync } from 'node:child_process';

function run(cmd) {
    try {
        return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
        return '';
    }
}

export function buildInfoDefine() {
    const commit = run('git rev-parse --short HEAD') || 'unknown';
    // 未コミットの変更があれば「+変更あり」を付ける（どのコミットとも一致しない状態だと分かるように）
    const dirty = run('git status --porcelain --untracked-files=no') !== '';
    return {
        __BUILD_COMMIT__: JSON.stringify(dirty ? `${commit}+変更あり` : commit),
        __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    };
}
