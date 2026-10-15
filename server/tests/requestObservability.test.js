const {
    buildPrivacySafeRequestLogContext,
    minimizeRequestPath,
    minimizeTelemetryUrl,
    normalizeUserAgentFamily,
} = require('../utils/requestObservability');

describe('requestObservability', () => {
    test('refuses to pseudonymise with a per-process key in production', () => {
        // Regression: the fallback key was a per-process random salt with no
        // production guard, so the same user got a different pseudonym in every
        // instance and after every restart — breaking cross-instance abuse
        // correlation silently. Production must fail closed instead.
        const originalNodeEnv = process.env.NODE_ENV;
        const originalObservability = process.env.OBSERVABILITY_HASH_SECRET;
        const originalSessionHash = process.env.SESSION_HASH_SECRET;
        const originalSession = process.env.SESSION_SECRET;

        process.env.NODE_ENV = 'production';
        delete process.env.OBSERVABILITY_HASH_SECRET;
        delete process.env.SESSION_HASH_SECRET;
        delete process.env.SESSION_SECRET;

        try {
            // Re-require so the module reads the mutated environment.
            jest.resetModules();
            const prod = require('../utils/requestObservability');
            expect(() => prod.buildPrivacySafeRequestLogContext({
                method: 'GET',
                originalUrl: '/api/orders',
                ip: '203.0.113.42',
            })).toThrow(/OBSERVABILITY_HASH_SECRET/);
        } finally {
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
