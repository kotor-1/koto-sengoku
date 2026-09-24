/**
 * 起動中のビルドの情報。実機確認の記録と照合するために画面に表示する。
 */
import { VERSION } from 'phaser';

export const BUILD = {
    commit: typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : 'unknown',
    time: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '',
    phaser: VERSION,
    mode: import.meta.env.DEV ? '開発' : '本番',
} as const;

export function buildLabel(): string {
    return `コミット ${BUILD.commit} ・ Phaser ${BUILD.phaser} ・ ${BUILD.mode}ビルド`;
}
