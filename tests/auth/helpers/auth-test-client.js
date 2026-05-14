'use strict';

const SAFE_LOCAL_BASE_URLS = new Set([
    'http://localhost:5000',
    'http://127.0.0.1:5000',
]);

function assertSafeAuthTestBaseUrl(baseUrl) {
    const normalized = String(baseUrl || 'http://localhost:5000').replace(/\/$/, '');
    const allowNonLocal = process.env.AUTH_TEST_ALLOW_NON_LOCAL === 'true';
    if (!SAFE_LOCAL_BASE_URLS.has(normalized) && !allowNonLocal) {
        throw new Error(`Refusing to run auth tests against non-local URL ${normalized}. Set AUTH_TEST_ALLOW_NON_LOCAL=true for staging.`);
    }
    return normalized;
}

module.exports = {
    SAFE_LOCAL_BASE_URLS,
    assertSafeAuthTestBaseUrl,
};
