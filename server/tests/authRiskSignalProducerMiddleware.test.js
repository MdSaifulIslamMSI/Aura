const express = require('express');
const request = require('supertest');
const {
    createAuthRiskSignalProducerMiddleware,
    resolveIpReputationFromEnv,
} = require('../middleware/authRiskSignalProducerMiddleware');
const {
    extractTrustedLoginRiskSignals,
    signLoginRiskSignals,
} = require('../services/authRiskSignalService');
const { extractTrustedDeviceContext } = require('../services/trustedDeviceChallengeService');

jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const logger = require('../utils/logger');
const DEVICE_ID = 'device-test-1234';

const buildApp = ({ resolveSignals } = {}) => {
    const app = express();
    app.use(createAuthRiskSignalProducerMiddleware({ resolveSignals }));
    app.post('/api/auth/sync', (req, res) => {
        const { deviceId } = extractTrustedDeviceContext(req);
        res.json({
            producer: req.authRiskSignalProducer,
            riskSignal: extractTrustedLoginRiskSignals(req, { deviceId }),
        });
    });
    app.post('/api/products', (req, res) => res.json({ headers: req.headers }));
    return app;
};

describe('authRiskSignalProducerMiddleware', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.clearAllMocks();
    });

    test('strips spoofed client login risk headers before the auth controller sees them', async () => {
        process.env.AUTH_RISK_SIGNAL_SECRET = 'risk-signal-secret';

        const response = await request(buildApp())
            .post('/api/auth/sync')
            .set('x-aura-device-id', DEVICE_ID)
            .set('x-aura-ip-reputation', 'denylist')
            .expect(200);

        expect(response.body.producer).toMatchObject({
            signed: false,
            source: 'server_middleware',
            reason: 'no_signals',
        });
        expect(response.body.riskSignal).toMatchObject({
            trusted: false,
            source: 'none',
            reason: 'no_signals',
            signals: {
                recentFailureCount: 0,
                ipReputation: '',
                impossibleTravel: false,
            },
        });
        expect(logger.warn).toHaveBeenCalledWith(
            'auth_risk_signal.untrusted_headers_stripped',
            expect.objectContaining({ reason: 'missing_signature' })
        );
    });

    test('signs trusted server-side login risk signals for downstream verification', async () => {
        process.env.AUTH_RISK_SIGNAL_SECRET = 'risk-signal-secret';

        const response = await request(buildApp({
            resolveSignals: () => ({ ipReputation: 'denylist' }),
        }))
            .post('/api/auth/sync')
            .set('x-aura-device-id', DEVICE_ID)
            .expect(200);

        expect(response.body.producer).toMatchObject({
            signed: true,
            source: 'server_middleware',
            reason: 'signed',
        });
        expect(response.body.riskSignal).toMatchObject({
            trusted: true,
            source: 'signed_header',
            reason: 'verified',
            signals: {
                ipReputation: 'denylist',
            },
        });
    });

    test('preserves a valid upstream edge signature instead of replacing it', async () => {
        process.env.AUTH_RISK_SIGNAL_SECRET = 'risk-signal-secret';
        const timestamp = new Date().toISOString();
        const signature = signLoginRiskSignals({
            method: 'POST',
            path: '/api/auth/sync',
            deviceId: DEVICE_ID,
            signals: { ipReputation: 'proxy' },
            timestamp,
            secret: process.env.AUTH_RISK_SIGNAL_SECRET,
        });

        const response = await request(buildApp({
            resolveSignals: () => ({ ipReputation: 'denylist' }),
        }))
            .post('/api/auth/sync')
            .set('x-aura-device-id', DEVICE_ID)
            .set('x-aura-ip-reputation', 'proxy')
            .set('x-aura-login-risk-timestamp', timestamp)
            .set('x-aura-login-risk-signature', signature)
            .expect(200);

        expect(response.body.producer).toMatchObject({
            signed: false,
            source: 'upstream_signed_header',
            reason: 'preserved',
        });
        expect(response.body.riskSignal).toMatchObject({
            trusted: true,
            source: 'signed_header',
            signals: {
                ipReputation: 'proxy',
            },
        });
    });

    test('strips login risk signal headers from unrelated routes too', async () => {
        const response = await request(buildApp())
            .post('/api/products')
            .set('x-aura-ip-reputation', 'denylist')
            .expect(200);

        expect(response.body.headers['x-aura-ip-reputation']).toBeUndefined();
    });

    test('resolves server-side IP reputation from configured exact-match lists', () => {
        process.env.AUTH_RISK_IP_DENYLIST = '203.0.113.10';
        process.env.AUTH_RISK_IP_WATCHLIST = '198.51.100.20';

        expect(resolveIpReputationFromEnv({ ip: '203.0.113.10' })).toBe('denylist');
        expect(resolveIpReputationFromEnv({ ip: '198.51.100.20' })).toBe('watchlist');
        expect(resolveIpReputationFromEnv({ ip: '192.0.2.55' })).toBe('');
    });
});
