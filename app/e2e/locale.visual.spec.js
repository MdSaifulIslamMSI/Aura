import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { mockProductDetailApis, waitForAppShell } from './support/commerceState.js';

const enabled = process.env.LOCALE_VISUAL_QA === '1';
const MARKET_STORAGE_KEY = 'aura_market_preferences_v1';
const OUTPUT_ROOT = path.join(process.cwd(), 'test-results', 'locale-visual');

const LOCALES = [
  {
    code: 'hi',
    direction: 'ltr',
    preference: {
      countryCode: 'IN',
      currency: 'INR',
      language: 'hi',
      locale: 'hi-IN',
    },
  },
  {
    code: 'ar',
    direction: 'rtl',
    preference: {
      countryCode: 'AE',
      currency: 'AED',
      language: 'ar',
      locale: 'ar-AE',
    },
  },
  {
    code: 'ja',
    direction: 'ltr',
    preference: {
      countryCode: 'JP',
      currency: 'JPY',
      language: 'ja',
      locale: 'ja-JP',
    },
  },
  {
    code: 'zh',
    direction: 'ltr',
    preference: {
      countryCode: 'CN',
      currency: 'CNY',
      language: 'zh',
      locale: 'zh-CN',
    },
  },
];

const MARKETPLACE_FIXTURE = {
  listings: [
    {
      _id: 'listing-1',
      title: 'Aura Horizon Camera Pro Creator Edition with 4K workflow kit',
      category: 'electronics',
      price: 48999,
      condition: 'like-new',
      escrowOptIn: true,
      negotiable: true,
      views: 1224,
      createdAt: '2026-03-27T08:00:00.000Z',
      images: ['https://placehold.co/900x900/0f172a/f8fafc?text=Camera'],
      location: { city: 'Bengaluru', state: 'Karnataka' },
      seller: { name: 'Riya Studio', isVerified: true },
    },
    {
      _id: 'listing-2',
      title: 'Nimbus Workstation Chair Signature lumbar mesh series',
      category: 'furniture',
      price: 17999,
      condition: 'good',
      escrowOptIn: false,
      negotiable: false,
      views: 486,
      createdAt: '2026-03-26T18:30:00.000Z',
      images: ['https://placehold.co/900x900/111827/e5e7eb?text=Chair'],
      location: { city: 'Dubai', state: 'Dubai' },
      seller: { name: 'Office Orbit', isVerified: false },
    },
  ],
  pagination: {
    page: 1,
    pages: 1,
    total: 2,
  },
  hotspots: [
    {
      city: 'Bengaluru',
      state: 'Karnataka',
      category: 'electronics',
      heatLabel: 'blazing',
      heatScore: 92,
      demandScore: 89,
      demandLevel: 'High',
      supplyScore: 44,
      supplyLevel: 'Tight',
      supplyCount: 31,
      soldCount: 19,
      proximity: 'local',
    },
    {
      city: 'Dubai',
      state: 'Dubai',
      category: 'furniture',
      heatLabel: 'rising',
      heatScore: 76,
      demandScore: 68,
      demandLevel: 'Rising',
      supplyScore: 59,
      supplyLevel: 'Balanced',
      supplyCount: 24,
      soldCount: 11,
      proximity: 'regional',
    },
  ],
};

async function seedLocale(page, locale) {
  const seedToken = `locale-visual-${locale.preference.language}-${Date.now()}`;

  await page.addInitScript(({ seedToken: token, storageKey, preference, direction }) => {
    if (window.sessionStorage.getItem('__locale_visual_seed__') === token) return;

    window.sessionStorage.setItem('__locale_visual_seed__', token);
    window.localStorage.setItem(storageKey, JSON.stringify(preference));
    const root = document.documentElement;
    if (!root) return;
    root.lang = preference.locale;
    root.dir = direction;
    root.setAttribute('data-market-language', preference.language);
    root.setAttribute('data-market-country', preference.countryCode);
  }, {
    seedToken,
    storageKey: MARKET_STORAGE_KEY,
    preference: locale.preference,
    direction: locale.direction,
  });
}

async function mockMarketplaceApis(page) {
  await page.route('**/api/listings/hotspots**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hotspots: MARKETPLACE_FIXTURE.hotspots }),
    });
  });

  await page.route('**/api/hotspots**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hotspots: MARKETPLACE_FIXTURE.hotspots }),
    });
  });

  await page.route('**/api/listings', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MARKETPLACE_FIXTURE),
    });
  });

  await page.route('**/api/listings?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MARKETPLACE_FIXTURE),
    });
  });

  await page.route('**/api/listings/*', async (route) => {
    const listingId = route.request().url().split('/').pop();
    const listing = MARKETPLACE_FIXTURE.listings.find((entry) => entry._id === listingId) || MARKETPLACE_FIXTURE.listings[0];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(listing),
    });
  });
}

async function analyzeLayout(page) {
  return page.evaluate(() => {
    const summarizeSelector = (element) => {
      if (!(element instanceof HTMLElement)) return '';
      const parts = [];
      let current = element;
      let depth = 0;
      while (current && depth < 4) {
        const tag = current.tagName.toLowerCase();
        const id = current.id ? `#${current.id}` : '';
        const classNames = typeof current.className === 'string'
          ? current.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((name) => `.${name}`).join('')
          : '';
        parts.unshift(`${tag}${id}${classNames}`);
        current = current.parentElement;
        depth += 1;
      }
      return parts.join(' > ');
    };

    const layoutViewportWidth = window.innerWidth;
    const layoutViewportHeight = window.innerHeight;
    const documentViewportWidth = document.documentElement.clientWidth || layoutViewportWidth;
    const documentViewportHeight = document.documentElement.clientHeight || layoutViewportHeight;
    const visualViewportWidth = window.visualViewport?.width
      ? Math.round(window.visualViewport.width)
      : layoutViewportWidth;
    const visualViewportHeight = window.visualViewport?.height
      ? Math.round(window.visualViewport.height)
      : layoutViewportHeight;
    const vw = Math.min(layoutViewportWidth, documentViewportWidth, visualViewportWidth);
    const vh = Math.min(layoutViewportHeight, documentViewportHeight, visualViewportHeight);
    const offenders = [];
    const globalOverflowCandidates = [];

    const elements = Array.from(document.querySelectorAll('body *'));
    elements.forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;

      const rect = element.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;

      const overflowLeft = rect.left < -4;
      const overflowRight = rect.right > (vw + 4);

      if (!overflowLeft && !overflowRight) return;

      const entry = {
        tag: element.tagName.toLowerCase(),
        selector: summarizeSelector(element),
        className: typeof element.className === 'string' ? element.className.trim().slice(0, 120) : '',
        text: (element.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 120),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
      };

      globalOverflowCandidates.push(entry);
      if (rect.bottom < 0 || rect.top > vh) return;

      offenders.push(entry);
    });

    return {
      dir: document.documentElement.dir || 'ltr',
      lang: document.documentElement.lang || '',
      layoutViewportWidth,
      layoutViewportHeight,
      documentViewportWidth,
      documentViewportHeight,
      visualViewportWidth,
      visualViewportHeight,
      effectiveViewportWidth: vw,
      effectiveViewportHeight: vh,
      htmlScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      horizontalOverflowPx: Math.max(
        document.documentElement.scrollWidth - vw,
        document.body.scrollWidth - vw,
        0
      ),
      clippedElements: offenders.slice(0, 12),
      globalOverflowCandidates: globalOverflowCandidates.slice(0, 20),
    };
  });
}

function attachPageDiagnostics(page, localeCode, scenarioName) {
  page.on('pageerror', (error) => {
    console.error(`[locale-qa:${localeCode}:${scenarioName}:pageerror] ${error?.stack || error?.message || error}`);
  });

  page.on('console', async (message) => {
    if (message.type() !== 'error') return;
    const text = await message.text();
    if (text.includes('Failed to load resource: net::ERR_CONNECTION_REFUSED')) return;
    console.error(`[locale-qa:${localeCode}:${scenarioName}:console] ${text}`);
  });
}

async function captureScenario(page, testInfo, locale, scenarioName, pathName, setup = null) {
  attachPageDiagnostics(page, locale.code, scenarioName);
  await seedLocale(page, locale);
  if (setup) {
    await setup(page);
  }

  await waitForAppShell(page, pathName);

  const report = await analyzeLayout(page);
  const scenarioDir = path.join(OUTPUT_ROOT, testInfo.project.name, locale.code);
  fs.mkdirSync(scenarioDir, { recursive: true });

  const screenshotPath = path.join(scenarioDir, `${scenarioName}.png`);
  const reportPath = path.join(scenarioDir, `${scenarioName}.json`);

  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
  });

  fs.writeFileSync(reportPath, JSON.stringify({
    locale: locale.code,
    project: testInfo.project.name,
    scenario: scenarioName,
    url: page.url(),
    report,
    screenshotPath,
  }, null, 2));

  return { screenshotPath, reportPath, report };
}

test.describe('Locale Visual QA', () => {
  test.skip(!enabled, 'Run only for explicit locale visual QA audits.');

  for (const locale of LOCALES) {
    test(`${locale.code} login shell stays within viewport`, async ({ page }, testInfo) => {
      const result = await captureScenario(page, testInfo, locale, 'login', '/login');
      expect.soft(result.report.dir).toBe(locale.direction);
      expect.soft(result.report.horizontalOverflowPx).toBeLessThanOrEqual(2);
    });

    test(`${locale.code} marketplace shell stays within viewport`, async ({ page }, testInfo) => {
      const result = await captureScenario(
        page,
        testInfo,
        locale,
        'marketplace',
        '/marketplace',
        async (auditPage) => {
          await mockMarketplaceApis(auditPage);
        }
      );
      expect.soft(result.report.dir).toBe(locale.direction);
      expect.soft(result.report.horizontalOverflowPx).toBeLessThanOrEqual(2);
    });

    test(`${locale.code} product shell stays within viewport`, async ({ page }, testInfo) => {
      const result = await captureScenario(
        page,
        testInfo,
        locale,
        'product',
        '/product/990001',
        async (auditPage) => {
          await mockProductDetailApis(auditPage, {
            productId: 990001,
            product: {
              title: 'Aura Flux Phone Max Creator Bundle',
              displayTitle: 'Aura Flux Phone Max Creator Bundle',
            },
          });
        }
      );
      expect.soft(result.report.dir).toBe(locale.direction);
      expect.soft(result.report.horizontalOverflowPx).toBeLessThanOrEqual(2);
    });

    test(`${locale.code} product reviews shell stays within viewport`, async ({ page }, testInfo) => {
      attachPageDiagnostics(page, locale.code, 'product-reviews');
      await seedLocale(page, locale);
      await mockProductDetailApis(page, {
        productId: 990001,
        product: {
          title: 'Aura Flux Phone Max Creator Bundle',
          displayTitle: 'Aura Flux Phone Max Creator Bundle',
        },
      });
      await waitForAppShell(page, '/product/990001');
      await page.getByTestId('product-tab-reviews').scrollIntoViewIfNeeded();
      await page.getByTestId('product-tab-reviews').click({ force: true });
      await page.waitForTimeout(250);

      const report = await analyzeLayout(page);
      const scenarioDir = path.join(OUTPUT_ROOT, testInfo.project.name, locale.code);
      fs.mkdirSync(scenarioDir, { recursive: true });

      const screenshotPath = path.join(scenarioDir, 'product-reviews.png');
      const reportPath = path.join(scenarioDir, 'product-reviews.json');

      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });

      fs.writeFileSync(reportPath, JSON.stringify({
        locale: locale.code,
        project: testInfo.project.name,
        scenario: 'product-reviews',
        url: page.url(),
        report,
        screenshotPath,
      }, null, 2));

      expect.soft(report.dir).toBe(locale.direction);
      expect.soft(report.horizontalOverflowPx).toBeLessThanOrEqual(2);
    });
  }
});
