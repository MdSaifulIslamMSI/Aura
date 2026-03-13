import { defineConfig, devices } from '@playwright/test';

/**
 * playwright.config.js — E2E test configuration for the AURA frontend.
 *
 * Tests run against the Vite dev server (automatically started by Playwright).
 * In CI, the server is built and served via `vite preview` for speed.
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
            command: 'npm start',
            cwd: '../server',
            url: 'http://localhost:5000/health',
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
        },
        {
            command: 'npm run build && npm run preview',
            url: 'http://localhost:4173',
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
        },
    ],
});
