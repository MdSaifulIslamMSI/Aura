import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'jsdom',
        exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/cypress/**'],
        setupFiles: './src/setupTests.js',
        css: true,
        pool: 'threads',
        isolate: true,
        sequence: {
            concurrent: false,
        },
        testTimeout: 15000,
        hookTimeout: 15000,
        coverage: {
            thresholds: {
                statements: 62,
                branches: 51,
                functions: 59,
                lines: 63,
            },
        },
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
