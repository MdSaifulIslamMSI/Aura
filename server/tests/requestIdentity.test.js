describe('request identity helpers', () => {
    afterEach(() => {
        jest.resetModules();
    });

    test('getTrustedRequestIp prefers Express trusted req.ip over raw forwarded headers', () => {
        const { getTrustedRequestIp } = require('../utils/requestIdentity');

        const req = {
            ip: '198.51.100.24',
            headers: {
                'x-forwarded-for': '203.0.113.9, 10.0.0.5',
            },
            socket: {
                remoteAddress: '10.0.0.20',
            },
        };

        expect(getTrustedRequestIp(req)).toBe('198.51.100.24');
    });

    test('getAuthenticatedRateLimitIdentity uses authenticated principal when available', () => {
        const { getAuthenticatedRateLimitIdentity } = require('../utils/requestIdentity');

        const req = {
            authUid: 'user-123',
            ip: '198.51.100.24',
        };

        expect(getAuthenticatedRateLimitIdentity(req)).toBe('uid:user-123');
    });

    test('getAuthenticatedRateLimitIdentity falls back to trusted ip for anonymous callers', () => {
        const { getAuthenticatedRateLimitIdentity } = require('../utils/requestIdentity');

        const req = {
            ip: '198.51.100.24',
        };

        expect(getAuthenticatedRateLimitIdentity(req)).toBe('ip:198.51.100.24');
    });
});
