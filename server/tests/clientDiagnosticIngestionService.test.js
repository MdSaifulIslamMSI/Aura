jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
}));

const logger = require('../utils/logger');
const {
    listClientDiagnostics,
    persistClientDiagnostics,
} = require('../services/clientDiagnosticIngestionService');

describe('clientDiagnosticIngestionService', () => {
    beforeEach(() => {
        logger.warn.mockClear();
    });

    test('redacts sensitive diagnostic payloads before storing or logging them', async () => {
        const bearer = ['Bearer ', 'clientdiagnostictoken'].join('');
        const webhookSecret = ['whsec_', 'clientdiagnostic'].join('');
        const paymentClientSecret = ['pi_clientdiagnostic_', 'secret_123'].join('');

        const result = await persistClientDiagnostics({
            events: [{
                type: 'api.network_error',
                severity: 'error',
                url: '/api/payments?access_token=raw-token&ok=1',
                error: {
                    authorization: bearer,
                    message: `provider failed with ${bearer} and ${webhookSecret}`,
                    nested: {
                        cookie: 'aura_sid=raw-session',
                        proof: 'raw-dpop-proof',
                        url: '/api/auth/callback?code=raw-code&next=/account',
                    },
                },
                context: {
                    clientSecret: paymentClientSecret,
                    safe: 'kept',
                },
            }],
            ingestionRequestId: 'req-client-diagnostics-redaction',
            clientSessionId: 'client-session-redaction',
            clientRoute: '/checkout',
            clientIp: '127.0.0.1',
            userAgent: 'diagnostic-test-agent',
        });

        const diagnostic = result.acceptedDiagnostics[0];
        const serializedDiagnostic = JSON.stringify(diagnostic);
        const serializedLogs = JSON.stringify(logger.warn.mock.calls);

        expect(diagnostic.url).toBe('/api/payments');
        expect(diagnostic.error.authorization).toBe('[REDACTED]');
        expect(diagnostic.error.message).toBe('provider failed with [REDACTED] and [REDACTED]');
        expect(diagnostic.error.nested.cookie).toBe('[REDACTED]');
        expect(diagnostic.error.nested.proof).toBe('[REDACTED]');
        expect(diagnostic.error.nested.url).toContain('code=[REDACTED]');
        expect(diagnostic.context.clientSecret).toBe('[REDACTED]');
        expect(diagnostic.context.safe).toBe('kept');
        expect(serializedDiagnostic).not.toContain('clientdiagnostictoken');
        expect(serializedDiagnostic).not.toContain('clientdiagnostic');
        expect(serializedDiagnostic).not.toContain('raw-session');
        expect(serializedDiagnostic).not.toContain('raw-dpop-proof');
        expect(serializedDiagnostic).not.toContain(paymentClientSecret);
        expect(serializedLogs).not.toContain('clientdiagnostictoken');
        expect(serializedLogs).not.toContain('raw-session');
    });

    test('stores coarse diagnostic context and preserves lookup through a hashed session reference', async () => {
        const rawSessionId = 'private-browser-session-for-diagnostic-test';
        const rawIp = '203.0.113.87';
        const privateQuery = 'email=private@example.com';
        const result = await persistClientDiagnostics({
            events: [{
                type: 'api.response_error',
                route: '/profile?ticket=private-reference',
                url: `https://shop.example/api/orders/507f1f77bcf86cd799439011?${privateQuery}`,
                method: 'GET',
                status: 503,
            }],
            clientSessionId: rawSessionId,
            clientIp: rawIp,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
        });

        expect(result.acceptedDiagnostics[0]).toMatchObject({
            route: '/profile',
            url: '/api/orders/:id',
            sessionId: expect.stringMatching(/^cs_[a-f0-9]{16}$/),
            clientIp: expect.stringMatching(/^ip_[a-f0-9]{16}$/),
            userAgent: 'chrome/windows',
        });
        expect(JSON.stringify(result.acceptedDiagnostics[0])).not.toContain(rawSessionId);
        expect(JSON.stringify(result.acceptedDiagnostics[0])).not.toContain(rawIp);
        expect(JSON.stringify(result.acceptedDiagnostics[0])).not.toContain(privateQuery);

        const lookup = await listClientDiagnostics({ sessionId: rawSessionId });
        expect(lookup.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: 'api.response_error' }),
        ]));
    });
});
