const {
    resolveSentryConfig,
    initSentry,
    captureServerException,
    isSentryEnabled,
    withCronMonitor,
    __testables,
} = require('../utils/sentry');

describe('server sentry wiring', () => {
    beforeEach(() => {
        __testables.reset();
    });

    afterEach(() => {
        __testables.reset();
    });

    it('stays disabled without a DSN', () => {
        expect(resolveSentryConfig({ NODE_ENV: 'production' }).enabled).toBe(false);

        expect(initSentry({ NODE_ENV: 'production' })).toEqual({
            enabled: false,
            dsnConfigured: false,
        });
        expect(isSentryEnabled()).toBe(false);
    });

    it('stays disabled in test env unless explicitly opted in', () => {
        const withoutOptIn = resolveSentryConfig({
            NODE_ENV: 'test',
            SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
        });
        expect(withoutOptIn.enabled).toBe(false);
        expect(withoutOptIn.dsnConfigured).toBe(true);

        const withOptIn = resolveSentryConfig({
            NODE_ENV: 'test',
            SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
            SENTRY_ENABLED: 'true',
        });
        expect(withOptIn.enabled).toBe(true);
    });

    it('respects the SENTRY_ENABLED kill switch', () => {
        const config = resolveSentryConfig({
            NODE_ENV: 'production',
            SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
            SENTRY_ENABLED: 'false',
        });
        expect(config.enabled).toBe(false);
    });

    it('resolves release and environment for issue grouping', () => {
        const config = resolveSentryConfig({
            NODE_ENV: 'production',
            SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
            SENTRY_RELEASE: 'git-abc123',
        });
        expect(config).toMatchObject({
            enabled: true,
            release: 'git-abc123',
            environment: 'production',
        });
    });

    it('capture is a safe no-op when disabled', () => {
        initSentry({ NODE_ENV: 'production' });
        expect(() => captureServerException(new Error('boom'), { route: '/api/x' })).not.toThrow();
    });

    it('samples traces at 10% by default and honors overrides', () => {
        expect(resolveSentryConfig({
            NODE_ENV: 'production',
            SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
        }).tracesSampleRate).toBe(0.1);
        expect(resolveSentryConfig({
            NODE_ENV: 'production',
            SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
            SENTRY_TRACES_SAMPLE_RATE: '0.5',
        }).tracesSampleRate).toBe(0.5);
        expect(resolveSentryConfig({
            NODE_ENV: 'production',
            SENTRY_DSN: 'https://public@example.ingest.sentry.io/123',
            SENTRY_ENABLED: 'false',
        }).tracesSampleRate).toBe(0);
    });

    it('cron monitor passes through results and errors when disabled', async () => {
        initSentry({ NODE_ENV: 'production' });
        await expect(withCronMonitor('test-slug', async () => 'tick-ok')).resolves.toBe('tick-ok');
        await expect(withCronMonitor('test-slug', async () => {
            throw new Error('tick-boom');
        })).rejects.toThrow('tick-boom');
    });
});
