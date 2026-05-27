const {
    buildPublicHealthPayload,
    shouldFailClosedMissingHealthReadyToken,
    shouldExposeDetailedHealth,
} = require('../services/healthDisclosureService');

describe('health disclosure service', () => {
    test('exposes detailed health outside production for local diagnostics', () => {
        expect(shouldExposeDetailedHealth({
            runtimeNodeEnv: 'test',
        })).toBe(true);
    });

    test('hides detailed health in production when no health token is configured', () => {
        expect(shouldExposeDetailedHealth({
            runtimeNodeEnv: 'production',
            req: { headers: { 'x-health-token': 'candidate' } },
            healthReadyToken: '',
        })).toBe(false);
    });

    test('requires the production health token before exposing detailed health', () => {
        const req = {
            headers: {
                'x-health-token': 'health-token-2026',
            },
        };

        expect(shouldExposeDetailedHealth({
            runtimeNodeEnv: 'production',
            req,
            healthReadyToken: 'wrong-token',
        })).toBe(false);
        expect(shouldExposeDetailedHealth({
            runtimeNodeEnv: 'production',
            req,
            healthReadyToken: 'health-token-2026',
        })).toBe(true);
    });

    test('fails closed for production readiness when no health token is configured', () => {
        expect(shouldFailClosedMissingHealthReadyToken({
            runtimeNodeEnv: 'production',
            healthReadyToken: '',
        })).toBe(true);
        expect(shouldFailClosedMissingHealthReadyToken({
            runtimeNodeEnv: 'test',
            healthReadyToken: '',
        })).toBe(false);
        expect(shouldFailClosedMissingHealthReadyToken({
            runtimeNodeEnv: 'production',
            healthReadyToken: 'health-token-2026',
        })).toBe(false);
    });

    test('public health payload omits topology and subsystem internals', () => {
        const payload = buildPublicHealthPayload({
            status: 'degraded',
            core: {
                dbConnected: false,
                redisConnected: true,
                mongoDeployment: { setName: 'rs0' },
            },
            uptime: 12.5,
            timestamp: '2026-05-04T00:00:00.000Z',
        });

        expect(payload).toEqual({
            status: 'degraded',
            service: 'aura-marketplace-api',
            version: expect.any(String),
            environment: 'test',
            db: 'disconnected',
            uptime: 12.5,
            timestamp: '2026-05-04T00:00:00.000Z',
            redis: {
                connected: true,
            },
        });
        expect(payload).not.toHaveProperty('topology');
        expect(payload).not.toHaveProperty('queues');
        expect(payload).not.toHaveProperty('ai');
        expect(payload).not.toHaveProperty('catalog');
        expect(payload).not.toHaveProperty('realtime');
    });
});
