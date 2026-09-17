const ENV_KEYS = ['PHONE_BLIND_INDEX_SECRET', 'EMAIL_BLIND_INDEX_SECRET', 'OTP_FLOW_SECRET', 'JWT_SECRET'];

const loadService = () => {
    jest.resetModules();
    // eslint-disable-next-line global-require
    return require('../services/blindIndexService');
};

describe('blindIndexService', () => {
    const previousNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        process.env.NODE_ENV = 'test';
        ENV_KEYS.forEach((key) => delete process.env[key]);
    });

    afterEach(() => {
        process.env.NODE_ENV = previousNodeEnv;
        ENV_KEYS.forEach((key) => delete process.env[key]);
    });

    test('produces deterministic 64-hex indexes for identical values', () => {
        const service = loadService();
        const first = service.computePhoneBlindIndex('+919876543210');
        const second = service.computePhoneBlindIndex('+919876543210');

        expect(first).toMatch(/^[0-9a-f]{64}$/);
        expect(first).toBe(second);
    });

    test('rejects a test value under a different secret (pepper matters)', () => {
        const service = loadService();
        const withA = service.computePhoneBlindIndex('+919876543210');
        process.env.PHONE_BLIND_INDEX_SECRET = 'another-secret-value';
        const serviceB = loadService();
        const withB = serviceB.computePhoneBlindIndex('+919876543210');
        expect(withA).not.toBe(withB);
    });

    test('returns null for empty identity values', () => {
        const service = loadService();
        expect(service.computePhoneBlindIndex('')).toBeNull();
        expect(service.computePhoneBlindIndex(undefined)).toBeNull();
        expect(service.computePhoneBlindIndex(null)).toBeNull();
        expect(service.computeEmailBlindIndex('')).toBeNull();
    });

    test('normalizes emails for the index', () => {
        const service = loadService();
        expect(service.computeEmailBlindIndex('User@Example.com ')).toBe(
            service.computeEmailBlindIndex('user@example.com')
        );
    });

    test('prefers the dedicated secret over fallbacks', () => {
        process.env.OTP_FLOW_SECRET = 'fallback-flow-secret';
        process.env.PHONE_BLIND_INDEX_SECRET = 'dedicated-phone-secret';
        const service = loadService();
        const dedicated = service.computePhoneBlindIndex('x');

        delete process.env.PHONE_BLIND_INDEX_SECRET;
        const fallback = loadService().computePhoneBlindIndex('x');

        expect(dedicated).not.toBe(fallback);
    });

    test('throws outside test when no secret is configured', () => {
        process.env.NODE_ENV = 'production';
        const service = loadService();
        expect(() => service.computePhoneBlindIndex('+919876543210')).toThrow(/blind index secret is not configured/i);
    });
});
