const { getTurnstileFlags } = require('../config/turnstileFlags');

describe('turnstileFlags.getTurnstileFlags', () => {
    test('disabled by default outside production', () => {
        const flags = getTurnstileFlags({ NODE_ENV: 'test' });
        expect(flags.enabled).toBe(false);
        expect(flags.failClosed).toBe(true);
        expect(flags.timeoutMs).toBe(3000);
    });

    test('enabled by default in production only when a secret key exists', () => {
        expect(getTurnstileFlags({ NODE_ENV: 'production' }).enabled).toBe(false);
        expect(getTurnstileFlags({ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 'sk' }).enabled).toBe(true);
    });

    test('explicit TURNSTILE_ENABLED overrides the environment default', () => {
        expect(getTurnstileFlags({ NODE_ENV: 'test', TURNSTILE_ENABLED: 'true', TURNSTILE_SECRET_KEY: 'sk' }).enabled).toBe(true);
        expect(getTurnstileFlags({ NODE_ENV: 'production', TURNSTILE_ENABLED: 'false', TURNSTILE_SECRET_KEY: 'sk' }).enabled).toBe(false);
    });

    test('falls back to the official siteverify URL and trims keys', () => {
        const flags = getTurnstileFlags({ TURNSTILE_SECRET_KEY: '  sk  ', TURNSTILE_SITE_KEY: ' site ' });
        expect(flags.siteverifyUrl).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
        expect(flags.secretKey).toBe('sk');
        expect(flags.siteKey).toBe('site');
    });

    test('honors custom siteverify URL, timeout, and test bypass token', () => {
        const flags = getTurnstileFlags({
            TURNSTILE_SITEVERIFY_URL: 'https://proxy.internal/siteverify',
            TURNSTILE_TIMEOUT_MS: '900',
            TURNSTILE_TEST_BYPASS_TOKEN: 'bypass-token',
        });
        expect(flags.siteverifyUrl).toBe('https://proxy.internal/siteverify');
        expect(flags.timeoutMs).toBe(900);
        expect(flags.testBypassToken).toBe('bypass-token');
    });
});
