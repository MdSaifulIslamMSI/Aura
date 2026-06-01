const DEFAULT_MARKET_STORAGE_KEY = 'aura_market_preferences_v1';

const localeQaJson = async (route, body, status = 200) => {
    await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
};

const emptyRecommendations = {
    recommendations: [],
    items: [],
    total: 0,
};

export const seedMarketLocale = async (page, {
    preference,
    direction = 'ltr',
    storageKey = DEFAULT_MARKET_STORAGE_KEY,
    markerKey = '__locale_qa_seed__',
} = {}) => {
    const seedToken = `locale-qa-${preference?.language || preference?.locale || 'unknown'}-${Date.now()}`;

    await page.addInitScript((payload) => {
        const applyRootAttributes = () => {
            const root = document.documentElement;
            if (!root || !payload.preference) return;
            root.lang = payload.preference.locale || payload.preference.language || '';
            root.dir = payload.direction || 'ltr';
            root.setAttribute('data-market-language', payload.preference.language || '');
            root.setAttribute('data-market-country', payload.preference.countryCode || '');
        };

        let alreadySeeded = false;
        try {
            alreadySeeded = window.sessionStorage?.getItem(payload.markerKey) === payload.seedToken;
        } catch {
            alreadySeeded = false;
        }

        if (!alreadySeeded) {
            try {
                window.sessionStorage?.setItem(payload.markerKey, payload.seedToken);
            } catch {
                // Some browser contexts deny storage before navigation; the DOM attributes still seed locale.
            }

            try {
                window.localStorage?.setItem(payload.storageKey, JSON.stringify(payload.preference));
            } catch {
                // Keep locale QA deterministic even when browser storage is unavailable.
            }
        }

        applyRootAttributes();
    }, {
        seedToken,
        storageKey,
        markerKey,
        preference,
        direction,
    });
};

export const mockLocaleShellApis = async (page) => {
    await page.route('**/transparenttextures.com/patterns/cubes.png', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Cross-Origin-Resource-Policy': 'cross-origin',
            },
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0f172a"/><path d="M0 16h32M16 0v32" stroke="#ffffff" stroke-opacity="0.12"/></svg>',
        });
    });

    await page.route('**/health/live**', async (route) => {
        await localeQaJson(route, {
            status: 'ok',
            service: 'aura-locale-qa',
            timestamp: '2026-01-01T00:00:00.000Z',
        });
    });

    await page.route('**/health**', async (route) => {
        await localeQaJson(route, {
            status: 'ok',
            service: 'aura-locale-qa',
            timestamp: '2026-01-01T00:00:00.000Z',
        });
    });

    await page.route('**/api/emergency/status**', async (route) => {
        await localeQaJson(route, {
            maintenance: false,
            readOnly: false,
            disabledFeatures: [],
            bannerMessage: '',
            timestamp: '2026-01-01T00:00:00.000Z',
        });
    });

    await page.route('**/api/markets/fx-rates**', async (route) => {
        const url = new URL(route.request().url());
        const baseCurrency = String(url.searchParams.get('baseCurrency') || 'INR').toUpperCase();
        const rates = {
            AED: 0.044,
            CNY: 0.087,
            INR: 1,
            JPY: 1.85,
            USD: 0.012,
        };
        rates[baseCurrency] = 1;

        await localeQaJson(route, {
            baseCurrency,
            rates,
            source: 'locale-qa',
            provider: 'fixture',
            fetchedAt: '2026-01-01T00:00:00.000Z',
            asOfDate: '2026-01-01',
            cacheTtlMs: 60000,
            stale: false,
        });
    });

    await page.route('**/api/recommendation-events**', async (route) => {
        await localeQaJson(route, { ok: true });
    });

    await page.route('**/api/recommendations/**', async (route) => {
        await localeQaJson(route, emptyRecommendations);
    });

    await page.route('**/api/observability/client-diagnostics**', async (route) => {
        await localeQaJson(route, { accepted: true });
    });
};

export const captureLocaleQaScreenshot = async (page, {
    path,
    fullPage = true,
} = {}) => {
    try {
        await page.screenshot({ path, fullPage });
        return {
            screenshotPath: path,
            screenshotMode: fullPage ? 'full-page' : 'viewport',
            screenshotError: '',
        };
    } catch (error) {
        if (!fullPage) {
            return {
                screenshotPath: '',
                screenshotMode: 'failed',
                screenshotError: error?.message || String(error),
            };
        }

        try {
            await page.screenshot({ path, fullPage: false });
            return {
                screenshotPath: path,
                screenshotMode: 'viewport-fallback',
                screenshotError: error?.message || String(error),
            };
        } catch (fallbackError) {
            return {
                screenshotPath: '',
                screenshotMode: 'failed',
                screenshotError: fallbackError?.message || String(fallbackError),
            };
        }
    }
};
