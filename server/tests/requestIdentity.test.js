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

    test('parseCloudFrontViewerAddress accepts IPv4, IPv4:port, and bracketed IPv6 with a port', () => {
        const { parseCloudFrontViewerAddress } = require('../utils/requestIdentity');

        expect(parseCloudFrontViewerAddress('203.0.113.50')).toBe('203.0.113.50');
        expect(parseCloudFrontViewerAddress('203.0.113.50:443')).toBe('203.0.113.50');
        expect(parseCloudFrontViewerAddress('[2001:db8::1]:443')).toBe('2001:db8::1');
        expect(parseCloudFrontViewerAddress('2001:db8::1')).toBe('2001:db8::1');
        expect(parseCloudFrontViewerAddress('not-an-ip')).toBe('');
        expect(parseCloudFrontViewerAddress('203.0.113.50:not-a-port')).toBe('');
    });

    test('getTrustedRequestIp ignores CloudFront viewer headers until the origin is verified', () => {
        const { getTrustedRequestIp } = require('../utils/requestIdentity');

        const req = {
            ip: '198.51.100.24',
            headers: {
                'cloudfront-viewer-address': '203.0.113.50:443',
            },
        };

        expect(getTrustedRequestIp(req)).toBe('198.51.100.24');
        expect(getTrustedRequestIp({ ...req, auraOriginVerified: true })).toBe('203.0.113.50');
    });

    test('getAuthenticatedSessionRateLimitIdentity uses only the authenticated session id', () => {
        const { getAuthenticatedSessionRateLimitIdentity } = require('../utils/requestIdentity');

        expect(getAuthenticatedSessionRateLimitIdentity({
            authSession: { sessionId: 'server-session-1' },
            headers: { 'x-client-session-id': 'client-controlled' },
        })).toBe('session:server-session-1');
        expect(getAuthenticatedSessionRateLimitIdentity({
            headers: { 'x-client-session-id': 'client-controlled' },
        })).toBe('');
    });
});
