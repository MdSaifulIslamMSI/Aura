const {
    buildPrivacySafeRequestLogContext,
    minimizeRequestPath,
    minimizeTelemetryUrl,
    normalizeUserAgentFamily,
} = require('../utils/requestObservability');

describe('requestObservability', () => {
    test('warns once instead of throwing when no key is configured in production', () => {
        // The fallback key is a per-process random salt, so the same user gets a
        // different pseudonym in every instance and after every restart, which
        // breaks cross-instance abuse correlation. That must never be SILENT, so
        // this warns once.
        //
        // It must also not throw. hashLogIdentifier runs on every request log, so
        // throwing here turned a startup configuration error into a runtime crash
        // across the whole request path — and it fired in CI jobs that set
        // NODE_ENV=production without running the startup gate. Production
        // fail-closed lives in assertCryptoSeparationConfig, not in here.
        const originalNodeEnv = process.env.NODE_ENV;
        const originalObservability = process.env.OBSERVABILITY_HASH_SECRET;
        const originalSessionHash = process.env.SESSION_HASH_SECRET;
        const originalSession = process.env.SESSION_SECRET;

        process.env.NODE_ENV = 'production';
        delete process.env.OBSERVABILITY_HASH_SECRET;
        delete process.env.SESSION_HASH_SECRET;
        delete process.env.SESSION_SECRET;

        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        try {
            jest.resetModules();
            const prod = require('../utils/requestObservability');

            // Must not throw even in production.
            const context = prod.buildPrivacySafeRequestLogContext({
                method: 'GET',
                originalUrl: '/api/orders',
                ip: '203.0.113.42',
            });
            expect(context.ipRef).toMatch(/^ip_[a-f0-9]{16}$/);

            // Warns exactly once, and the warning names the missing secret.
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][0]).toMatch(/OBSERVABILITY_HASH_SECRET/);

            // Still usable on a second call (no repeat warning, no throw).
            const second = prod.buildPrivacySafeRequestLogContext({
                method: 'GET', originalUrl: '/api/orders', ip: '203.0.113.42',
            });
            expect(second.ipRef).toBe(context.ipRef);
            expect(warn).toHaveBeenCalledTimes(1);
        } finally {
            warn.mockRestore();
            process.env.NODE_ENV = originalNodeEnv;
            if (originalObservability === undefined) delete process.env.OBSERVABILITY_HASH_SECRET;
            else process.env.OBSERVABILITY_HASH_SECRET = originalObservability;
            if (originalSessionHash === undefined) delete process.env.SESSION_HASH_SECRET;
            else process.env.SESSION_HASH_SECRET = originalSessionHash;
            if (originalSession === undefined) delete process.env.SESSION_SECRET;
            else process.env.SESSION_SECRET = originalSession;
            jest.resetModules();
        }
    });

    test('uses the configured key in production so pseudonyms stay stable', () => {
        const originalNodeEnv = process.env.NODE_ENV;
        const originalObservability = process.env.OBSERVABILITY_HASH_SECRET;
        const originalSessionHash = process.env.SESSION_HASH_SECRET;

        process.env.NODE_ENV = 'production';
        process.env.OBSERVABILITY_HASH_SECRET = 'stable-observability-key-for-test';
        delete process.env.SESSION_HASH_SECRET;

        try {
            jest.resetModules();
            const prod = require('../utils/requestObservability');
            const first = prod.buildPrivacySafeRequestLogContext({
                method: 'GET', originalUrl: '/api/orders', ip: '203.0.113.42',
            });
            const second = prod.buildPrivacySafeRequestLogContext({
                method: 'GET', originalUrl: '/api/orders', ip: '203.0.113.42',
            });
            expect(first.ipRef).toBe(second.ipRef);
        } finally {
            process.env.NODE_ENV = originalNodeEnv;
            if (originalObservability === undefined) delete process.env.OBSERVABILITY_HASH_SECRET;
            else process.env.OBSERVABILITY_HASH_SECRET = originalObservability;
            if (originalSessionHash === undefined) delete process.env.SESSION_HASH_SECRET;
            else process.env.SESSION_HASH_SECRET = originalSessionHash;
            jest.resetModules();
        }
    });

    test('removes queries and dynamic identifiers from logged paths', () => {
        expect(minimizeRequestPath(
            '/api/account/privacy/requests/507f1f77bcf86cd799439011?token=private'
        )).toBe('/api/account/privacy/requests/:id');
    });

    test('replaces raw session and IP values with bounded references', () => {
        const context = buildPrivacySafeRequestLogContext({
            method: 'POST',
            originalUrl: '/api/observability/client-diagnostics?ticket=private',
            requestId: 'request-correlation-id',
            ip: '203.0.113.42',
            headers: {
                'x-client-session-id': 'raw-browser-session-identifier',
                'x-client-route': '/profile?ticket=private-account-reference',
            },
        });

        expect(context).toMatchObject({
            method: 'POST',
            url: '/api/observability/client-diagnostics',
            requestId: 'request-correlation-id',
            clientRoute: '/profile',
            clientSessionRef: expect.stringMatching(/^cs_[a-f0-9]{16}$/),
            ipRef: expect.stringMatching(/^ip_[a-f0-9]{16}$/),
        });
        expect(JSON.stringify(context)).not.toContain('raw-browser-session-identifier');
        expect(JSON.stringify(context)).not.toContain('203.0.113.42');
        expect(JSON.stringify(context)).not.toContain('private-account-reference');
    });

    test('reduces diagnostic URLs and user agents to non-identifying families', () => {
        expect(minimizeTelemetryUrl(
            'https://shop.example/api/orders/507f1f77bcf86cd799439011?email=private@example.com'
        )).toBe('/api/orders/:id');
        expect(normalizeUserAgentFamily(
            'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36'
        )).toBe('chrome/windows');
    });
});
