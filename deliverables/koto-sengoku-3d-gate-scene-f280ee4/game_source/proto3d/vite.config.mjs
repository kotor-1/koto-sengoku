// 3D 比較版（独立した試作）。既存の 2D 版（Phaser）のビルドとは別に動かす。
//   開発: npm run proto3d:dev（http://localhost:8090/）
//   本番: npm run proto3d:build（dist-proto3d/）
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { buildInfoDefine } from '../vite/buildInfo.mjs';

export default defineConfig({
    root: resolve(import.meta.dirname),
    base: './',
    publicDir: 'public',
    define: buildInfoDefine(),
    build: {
        outDir: resolve(import.meta.dirname, '../dist-proto3d'),
        emptyOutDir: true,
        rollupOptions: {
            input: resolve(import.meta.dirname, 'index.html'),
            output: { manualChunks: { three: ['three'] } },
        },
    },
    server: { port: 8090, strictPort: true },
    preview: { port: 8090, strictPort: true },
});
