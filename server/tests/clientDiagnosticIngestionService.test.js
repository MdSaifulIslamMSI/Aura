jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
}));

const logger = require('../utils/logger');
const { persistClientDiagnostics } = require('../services/clientDiagnosticIngestionService');

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
                url: `/api/payments?access_token=raw-token&ok=1`,
                error: {
                    authorization: bearer,
                    message: `provider failed with ${bearer} and ${webhookSecret}`,
                    nested: {
                        cookie: 'aura_sid=raw-session',
                        proof: 'raw-dpop-proof',
                        url: `/api/auth/callback?code=raw-code&next=/account`,
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

        expect(diagnostic.url).toContain('access_token=[REDACTED]');
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
});
