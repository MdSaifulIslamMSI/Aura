import { expect, test } from '@playwright/test';
import { mockLocaleShellApis, seedMarketLocale } from './support/localeQaHarness.js';

const enabled = process.env.LOGIN_VISUAL_QA === '1';

async function prepareLoginSurface(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedMarketLocale(page, {
    preference: {
      countryCode: 'IN',
      currency: 'INR',
      language: 'en',
      locale: 'en-IN',
    },
    direction: 'ltr',
    markerKey: '__login_visual_seed__',
  });
  await mockLocaleShellApis(page);
  await page.goto('/login');
  await page.locator('.login-experience[data-auth-state="idle"]').waitFor({ state: 'visible' });
  await page.evaluate(() => document.fonts?.ready);
}

test.describe('Login Visual Regression', () => {
  test.skip(!enabled, 'Run only for explicit login visual regression audits.');

  test.beforeEach(async ({ page }) => {
    await prepareLoginSurface(page);
  });

  test('member access surface matches the approved baseline', async ({ page }) => {
    await expect(page.locator('.login-experience')).toHaveScreenshot('member-access-surface.png', {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.015,
    });
  });

  test('country chooser matches the approved baseline', async ({ page }) => {
    await page.getByRole('button', { name: /change country code/i }).click();
    const dialog = page.getByRole('dialog', { name: /choose country code/i });
    await expect(dialog).toBeVisible();
    await page.mouse.move(1, 1);
    await expect(dialog).toHaveScreenshot('country-code-dialog.png', {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.015,
    });
  });
});
