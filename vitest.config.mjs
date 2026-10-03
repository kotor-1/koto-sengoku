import { defineConfig } from 'vitest/config';

// 1 つのテストの時間の上限は既定の 5 秒のまま。重いテスト（合戦の台本を何十回も最後まで進める・町を歩く道を調べる）には、そのテストの
// it(…, 60_000) で個別の上限を付けている（第4群の確かめ：負荷 13〜15 の時に 6 本が 5 秒を超えた。どれも開発機の空いた時の 1.7〜3.2 秒が、
// CPU の取り合いで約 3.4 倍に延びただけで、結果は同じ。空いた時に 0.5 秒（負荷の時 2 秒）を超えるテストには個別の上限を付けた）。
// 計算の重さのテスト（tests/proto3d-battle-terrain.test.ts の 1 刻み 3 ms）は、経過時間ではなく、その処理の CPU の時間で測る。
export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
    },
});
