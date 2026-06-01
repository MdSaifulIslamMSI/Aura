import fs from 'node:fs';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { waitForAppShell } from './support/commerceState.js';

const enabled = process.env.LOCALE_ACCESSIBILITY_QA === '1';
const MARKET_STORAGE_KEY = 'aura_market_preferences_v1';
const OUTPUT_ROOT = path.join(process.cwd(), 'test-results', 'locale-accessibility');
const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

const LOCALES = [
    { code: 'en-XA', locale: 'en-XA', direction: 'ltr', countryCode: 'IN', currency: 'INR' },
    { code: 'bn', locale: 'bn-IN', direction: 'ltr', countryCode: 'IN', currency: 'INR' },
    { code: 'hi', locale: 'hi-IN', direction: 'ltr', countryCode: 'IN', currency: 'INR' },
    { code: 'ur', locale: 'ur-IN', direction: 'rtl', countryCode: 'IN', currency: 'INR' },
    { code: 'ar', locale: 'ar-AE', direction: 'rtl', countryCode: 'AE', currency: 'AED' },
];

async function seedLocale(page, locale) {
    await page.addInitScript(({ storageKey, preference, direction }) => {
        window.localStorage.setItem(storageKey, JSON.stringify(preference));
        document.documentElement.lang = preference.locale;
        document.documentElement.dir = direction;
    }, {
        storageKey: MARKET_STORAGE_KEY,
        preference: {
            countryCode: locale.countryCode,
            currency: locale.currency,
            language: locale.code,
            locale: locale.locale,
        },
        direction: locale.direction,
    });
}

test.describe('Locale Accessibility QA', () => {
    test.skip(!enabled, 'Run only for explicit locale accessibility QA audits.');

    for (const locale of LOCALES) {
        test(`${locale.code} login shell has no serious accessibility violations`, async ({ page }, testInfo) => {
            await seedLocale(page, locale);
            await waitForAppShell(page, '/login');

            const results = await new AxeBuilder({ page }).analyze();
            const blockingViolations = results.violations.filter(({ impact }) => BLOCKING_IMPACTS.has(impact));
            const outputDir = path.join(OUTPUT_ROOT, testInfo.project.name);
            fs.mkdirSync(outputDir, { recursive: true });
            fs.writeFileSync(
                path.join(outputDir, `${locale.code}.json`),
                JSON.stringify({
                    locale: locale.code,
                    project: testInfo.project.name,
                    url: page.url(),
                    blockingViolations,
                    violationCount: results.violations.length,
                }, null, 2)
            );

            expect.soft(documentDirection(await page.locator('html').getAttribute('dir'))).toBe(locale.direction);
            expect(blockingViolations).toEqual([]);
        });
    }
});

function documentDirection(direction) {
    return direction || 'ltr';
}
