import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const isCI = Boolean(process.env.CI);
const previewHost = '127.0.0.1';
const previewPort = '4173';
const previewBaseUrl = `http://localhost:${previewPort}`;
const localApiBaseUrl = 'http://127.0.0.1:5000/api';
const e2eCorsOrigins = 'http://localhost:4173,http://127.0.0.1:4173';
const appDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * playwright.config.js — E2E test configuration for the AURA frontend.
 *
 * Tests run against the Vite dev server (automatically started by Playwright).
 * In CI, the server is built and served via `vite preview` for speed.
 *
 * Defensive precheck: `use.baseURL` is fixed to http://localhost:4173 and must be
 * served by Vite preview from the `app/` directory.
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ],

    use: {
        // Must match the Vite preview server started from `app/` in webServer below.
        baseURL: previewBaseUrl,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    // Automatically build and serve before running tests in CI.
    webServer: [
        {
            command: isCI ? 'npm ci && npm start' : 'npm start',
            cwd: '../server',
            url: 'http://localhost:5000/health',
            reuseExistingServer: !isCI,
            timeout: 180_000,
            env: {
                ...process.env,
                MONGO_URI: isCI ? 'mongodb://127.0.0.1:27017/aura_e2e' : process.env.MONGO_URI,
                NODE_ENV: 'test',
                CORS_ORIGIN: process.env.CORS_ORIGIN || e2eCorsOrigins,
                SIMULATED_WEBHOOK_SECRET: process.env.SIMULATED_WEBHOOK_SECRET || 'playwright-simulated-webhook-secret',
                OTP_CHALLENGE_SECRET: process.env.OTP_CHALLENGE_SECRET || 'playwright-otp-challenge-secret',
                PAYMENT_CHALLENGE_ENABLED: process.env.PAYMENT_CHALLENGE_ENABLED || 'false',
            },
        },
        {
            command: `npm run build -- --mode test && npm run preview -- --host ${previewHost} --port ${previewPort}`,
            // Explicit app cwd; absolute-safe when launcher is invoked from repo root.
            cwd: appDir,
            url: previewBaseUrl,
            reuseExistingServer: !isCI,
            timeout: 120_000,
            env: {
                ...process.env,
                VITE_API_URL: process.env.VITE_API_URL || localApiBaseUrl,
                VITE_ENABLE_BACKEND_STATUS_BANNER: 'false',
                VITE_FIREBASE_MEASUREMENT_ID: '',
            },
        },
    ],
});
