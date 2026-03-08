import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './src/setupTests.js',
        css: true,
        fileParallelism: false,
        pool: 'threads',
        maxWorkers: 1,
        isolate: false,
        sequence: {
            concurrent: false,
        },
        testTimeout: 15000,
        hookTimeout: 15000,
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
