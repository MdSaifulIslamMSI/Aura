const {
    buildPrivacySafeRequestLogContext,
    minimizeRequestPath,
    minimizeTelemetryUrl,
    normalizeUserAgentFamily,
} = require('../utils/requestObservability');

describe('requestObservability', () => {
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
