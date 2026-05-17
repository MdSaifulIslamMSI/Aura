const {
    assertAuthRiskSignalConfig,
    extractTrustedLoginRiskSignals,
    signLoginRiskSignals,
} = require('../services/authRiskSignalService');

const buildReq = ({
    method = 'POST',
    path = '/api/auth/sync',
    deviceId = 'device-a',
    headers = {},
    authRisk = null,
} = {}) => ({
    method,
    originalUrl: path,
    authRisk,
    headers: {
        'x-aura-device-id': deviceId,
        ...headers,
    },
    get(name) {
        return this.headers[String(name || '').toLowerCase()];
    },
});

describe('authRiskSignalService', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    test('ignores unsigned client-supplied login risk headers', () => {
        const result = extractTrustedLoginRiskSignals(buildReq({
            headers: {
                'x-aura-ip-reputation': 'denylist',
                'x-aura-login-failure-count': '12',
            },
        }), { deviceId: 'device-a' });

        expect(result).toMatchObject({
            trusted: false,
            source: 'untrusted_header',
            ignoredUntrustedHeaders: true,
            reason: 'missing_signature',
            signals: {
                recentFailureCount: 0,
                ipReputation: '',
                impossibleTravel: false,
            },
        });
    });

    test('accepts signed edge/server login risk headers', () => {
        process.env.AUTH_RISK_SIGNAL_SECRET = 'risk-signal-secret-for-tests';
        const timestamp = new Date().toISOString();
        const signature = signLoginRiskSignals({
            method: 'POST',
            path: '/api/auth/sync',
            deviceId: 'device-a',
            signals: {
                recentFailureCount: 7,
                ipReputation: 'proxy',
                impossibleTravel: true,
            },
            timestamp,
            secret: process.env.AUTH_RISK_SIGNAL_SECRET,
        });

        const result = extractTrustedLoginRiskSignals(buildReq({
            headers: {
                'x-aura-login-failure-count': '7',
                'x-aura-ip-reputation': 'proxy',
                'x-aura-impossible-travel': 'true',
                'x-aura-login-risk-timestamp': timestamp,
                'x-aura-login-risk-signature': signature,
            },
        }), { deviceId: 'device-a' });

        expect(result).toMatchObject({
            trusted: true,
            source: 'signed_header',
            ignoredUntrustedHeaders: false,
            reason: 'verified',
            signals: {
                recentFailureCount: 7,
                ipReputation: 'proxy',
                impossibleTravel: true,
            },
        });
    });

    test('rejects signed risk headers when the request binding changes', () => {
        process.env.AUTH_RISK_SIGNAL_SECRET = 'risk-signal-secret-for-tests';
        const timestamp = new Date().toISOString();
        const signature = signLoginRiskSignals({
            method: 'POST',
            path: '/api/auth/sync',
            deviceId: 'device-a',
            signals: { ipReputation: 'denylist' },
            timestamp,
            secret: process.env.AUTH_RISK_SIGNAL_SECRET,
        });

        const result = extractTrustedLoginRiskSignals(buildReq({
            deviceId: 'device-b',
            headers: {
                'x-aura-ip-reputation': 'denylist',
                'x-aura-login-risk-timestamp': timestamp,
                'x-aura-login-risk-signature': signature,
            },
        }), { deviceId: 'device-b' });

        expect(result).toMatchObject({
            trusted: false,
            source: 'untrusted_header',
            ignoredUntrustedHeaders: true,
            reason: 'invalid_signature',
        });
    });

    test('keeps in-process server risk context trusted without headers', () => {
        const result = extractTrustedLoginRiskSignals(buildReq({
            authRisk: {
                recentFailureCount: 4,
                ipReputation: 'watchlist',
            },
        }), { deviceId: 'device-a' });

        expect(result).toMatchObject({
            trusted: true,
            source: 'server',
            reason: 'server_context',
            signals: {
                recentFailureCount: 4,
                ipReputation: 'watchlist',
                impossibleTravel: false,
            },
        });
    });

    test('requires a signing secret before risk engine enforcement starts', () => {
        expect(() => assertAuthRiskSignalConfig({
            AUTH_RISK_ENGINE_MODE: 'enforce',
            AUTH_RISK_SIGNAL_SECRET: '',
        })).toThrow('AUTH_RISK_SIGNAL_SECRET is required');

        expect(() => assertAuthRiskSignalConfig({
            AUTH_RISK_ENGINE_MODE: 'enforce',
            AUTH_RISK_SIGNAL_SECRET: 'configured-risk-signal-secret',
        })).not.toThrow();
    });
});
