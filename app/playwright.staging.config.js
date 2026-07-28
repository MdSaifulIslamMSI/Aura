import { defineConfig } from '@playwright/test';

const baseURL = String(process.env.STAGING_BASE_URL || '').trim().replace(/\/+$/, '');

if (
    process.env.ACCOUNT_CENTER_STAGING_E2E !== 'true'
    || process.env.SMOKE_TARGET_ENV !== 'staging'
    || process.env.SMOKE_STAGING_ISOLATED !== 'true'
    || !/^https:\/\//i.test(baseURL)
) {
    throw new Error('Authenticated Account Center Playwright requires an explicit isolated HTTPS staging target.');
}

export default defineConfig({
    testDir: './e2e',
    testMatch: 'account-center.staging.spec.js',
    timeout: 90_000,
    expect: { timeout: 20_000 },
    retries: 1,
    workers: 1,
    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report-account-staging', open: 'never' }],
    ],
    outputDir: 'test-results/account-center-staging',
    use: {
        baseURL,
        browserName: 'chromium',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'off',
        reducedMotion: 'reduce',
    },
    projects: [
        { name: 'mobile-320', use: { viewport: { width: 320, height: 800 } } },
        { name: 'tablet-768', use: { viewport: { width: 768, height: 1024 } } },
        { name: 'desktop-1440', use: { viewport: { width: 1440, height: 1000 } } },
        { name: 'wide-2560', use: { viewport: { width: 2560, height: 1440 } } },
    ],
});
