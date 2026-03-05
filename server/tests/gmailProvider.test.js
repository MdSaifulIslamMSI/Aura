const GmailProvider = require('../services/email/providers/gmailProvider');

describe('Gmail Provider Error Mapping', () => {
    const provider = new GmailProvider({
        user: 'test@example.com',
        pass: 'app-password',
        fromName: 'Aura Marketplace',
        fromAddress: 'test@example.com',
    });

    test('maps auth error as non-retryable', () => {
        const mapped = provider.normalizeError({ code: 'EAUTH', responseCode: 535 });
        expect(mapped.code).toBe('AUTH_FAILED');
        expect(mapped.retryable).toBe(false);
    });

    test('maps recipient envelope error as non-retryable', () => {
        const mapped = provider.normalizeError({ code: 'EENVELOPE', responseCode: 550 });
        expect(mapped.code).toBe('INVALID_RECIPIENT');
        expect(mapped.retryable).toBe(false);
    });

    test('maps network error as retryable', () => {
        const mapped = provider.normalizeError({ code: 'ECONNECTION' });
        expect(mapped.code).toBe('NETWORK_ERROR');
        expect(mapped.retryable).toBe(true);
    });
});
