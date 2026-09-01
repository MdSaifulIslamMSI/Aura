const fs = require('fs');
const path = require('path');

const {
    assertRemoteFetchPolicy,
    guardedFetch,
} = require('../../security/remoteFetchGuardService');

const jsonResponse = (status, { location = '' } = {}) => ({
    status,
    headers: {
        get: (name) => (String(name).toLowerCase() === 'location' ? location : null),
    },
});

describe('operator egress — policy-only validation', () => {
    test('denies non-http schemes, metadata hosts, and allowlist violations without DNS', async () => {
        expect(() => assertRemoteFetchPolicy({ url: 'file:///etc/passwd', allowedHosts: ['api.resend.com'] }))
            .toThrow('Remote URL is not allowed.');
        expect(() => assertRemoteFetchPolicy({ url: 'http://169.254.169.254/latest/meta-data/' }))
            .toThrow('Remote URL is not allowed.');
        expect(() => assertRemoteFetchPolicy({ url: 'https://api.evil.example/v1', allowedHosts: ['api.resend.com'] }))
            .toThrow('Remote URL is not allowed.');
        expect(() => assertRemoteFetchPolicy({ url: 'https://api.resend.com/emails', allowedHosts: ['api.resend.com'] }))
            .not.toThrow();
    });
});

describe('operator egress — guardedFetch redirect policy without DNS validation', () => {
    afterEach(() => jest.restoreAllMocks());

    test('redirect to a non-allowlisted host is blocked without fetching it', async () => {
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(jsonResponse(302, { location: 'https://evil.example/steal' }));

        await expect(guardedFetch('https://api.resend.com/emails', {
            allowedHosts: ['api.resend.com'],
            validateDns: false,
            fetchImpl,
        })).rejects.toThrow('Remote URL is not allowed.');

        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    test('redirect to a metadata hostname is blocked', async () => {
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(jsonResponse(302, { location: 'http://169.254.169.254/latest/meta-data/' }));

        await expect(guardedFetch('https://api.resend.com/emails', {
            allowedHosts: ['api.resend.com'],
            validateDns: false,
            fetchImpl,
        })).rejects.toThrow('Remote URL is not allowed.');

        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    test('allowlisted redirect is followed and credential headers are stripped', async () => {
        const finalResponse = jsonResponse(200);
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(jsonResponse(302, { location: 'https://api.resend.com/emails/2' }))
            .mockResolvedValueOnce(finalResponse);

        const response = await guardedFetch('https://api.resend.com/emails', {
            allowedHosts: ['api.resend.com'],
            validateDns: false,
            fetchImpl,
            headers: { authorization: 'Bearer secret' },
        });

        expect(response).toBe(finalResponse);
        const [, secondInit] = fetchImpl.mock.calls[1];
        expect(secondInit.headers.authorization).toBeUndefined();
    });
});

describe('operator egress — internal-target allowance', () => {
    afterEach(() => jest.restoreAllMocks());

    test('allowPrivateTarget permits an operator-configured internal host', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200));

        await expect(guardedFetch('http://127.0.0.1:11434/api/tags', {
            allowedHosts: ['127.0.0.1'],
            validateDns: false,
            allowPrivateTarget: true,
            fetchImpl,
        })).resolves.toBeDefined();

        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    test('allowPrivateTarget still enforces the allowlist on every hop', async () => {
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(jsonResponse(302, { location: 'http://10.0.0.9:8200/steal' }));

        await expect(guardedFetch('http://127.0.0.1:11434/api/tags', {
            allowedHosts: ['127.0.0.1'],
            validateDns: false,
            allowPrivateTarget: true,
            fetchImpl,
        })).rejects.toThrow('Remote URL is not allowed.');

        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});

describe('operator egress — provider source contracts', () => {
    const readSource = (relative) => fs.readFileSync(
        path.join(__dirname, '..', '..', ...relative.split('/')),
        'utf8'
    );

    const migratedSites = [
        'services/email/providers/resendProvider.js',
        'services/sms/providers/twilioProvider.js',
        'services/payments/providers/razorpayProvider.js',
        'middleware/turnstileMiddleware.js',
        'services/ai/providerRegistry.js',
        'services/ai/geminiGatewayService.js',
        'services/auth/keycloakOidcService.js',
        'services/auth/oidcTokenVerifier.js',
        'services/duoOidcService.js',
        'services/ai/ollamaGatewayService.js',
        'services/translation/providers/libreTranslateProvider.js',
        'services/statusService.js',
        'services/studentPackSecurityHarnessService.js',
        'services/payments/foundation/billingProvider.js',
        'services/payments/foundation/hyperswitchProvider.js',
    ];

    test.each(migratedSites)('%s routes egress through guardedFetch', (relative) => {
        const source = readSource(relative);
        expect(source).toContain('guardedFetch(');
        expect(source).not.toMatch(/await fetch\(/);
    });
});
