import { defineConfig, devices } from '@playwright/test';

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
        baseURL: 'http://localhost:4173',
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
            command: 'npm ci && npm start',
            cwd: '../server',
            url: 'http://localhost:5000/health',
            reuseExistingServer: !process.env.CI,
            timeout: 180_000,
            env: {
                MONGO_URI: process.env.CI ? 'mongodb://127.0.0.1:27017/aura_e2e' : process.env.MONGO_URI,
                NODE_ENV: 'test',
                SIMULATED_WEBHOOK_SECRET: process.env.SIMULATED_WEBHOOK_SECRET || 'playwright-simulated-webhook-secret',
                OTP_CHALLENGE_SECRET: process.env.OTP_CHALLENGE_SECRET || 'playwright-otp-challenge-secret',
                PAYMENT_CHALLENGE_ENABLED: process.env.PAYMENT_CHALLENGE_ENABLED || 'false',
            },
        },
        {
            command: 'npm run build && npm run preview',
            // Explicit app cwd; absolute-safe when launcher is invoked from repo root.
            cwd: new URL('.', import.meta.url).pathname,
            url: 'http://localhost:4173',
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
        },
    ],
});
