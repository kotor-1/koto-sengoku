import { defineConfig } from 'vite';
import { buildInfoDefine } from './buildInfo.mjs';

export default defineConfig({
    base: './',
    define: buildInfoDefine(),
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    phaser: ['phaser']
                }
            }
        },
    },
    server: {
        port: 8080
    }
});
