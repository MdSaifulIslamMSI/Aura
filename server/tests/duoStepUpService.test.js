const {
    assertDuoStepUpReady,
    hasFreshDuoStepUp,
    requireDuoStepUp,
} = require('../services/duoStepUpService');

describe('duoStepUpService', () => {
    test('fails closed when Duo is enabled without complete OIDC configuration', () => {
        expect(() => assertDuoStepUpReady({
            action: 'admin-sensitive',
            env: {
                DUO_ENABLED: 'true',
            },
        })).toThrow(expect.objectContaining({
            statusCode: 503,
            code: 'DUO_NOT_CONFIGURED',
        }));
    });

    test('recognizes only fresh Duo-backed step-up sessions', () => {
        expect(hasFreshDuoStepUp({
            amr: ['password', 'duo_oidc'],
            stepUpUntil: new Date(Date.now() + 60_000).toISOString(),
        })).toBe(true);

        expect(hasFreshDuoStepUp({
            amr: ['password', 'duo_oidc'],
            stepUpUntil: new Date(Date.now() - 60_000).toISOString(),
        })).toBe(false);

        expect(hasFreshDuoStepUp({
            amr: ['password'],
            stepUpUntil: new Date(Date.now() + 60_000).toISOString(),
        })).toBe(false);
    });

    test('requires an active Duo step-up when Duo is configured', () => {
        const env = {
            DUO_ENABLED: 'true',
            DUO_CLIENT_ID: 'client-id',
            DUO_CLIENT_SECRET: 'client-secret',
            DUO_OIDC_ISSUER: 'https://sso.example.test/oidc/client-id',
            DUO_DISCOVERY_URL: 'https://sso.example.test/oidc/client-id/.well-known/openid-configuration',
            DUO_REDIRECT_URI: 'https://api.example.test/api/auth/duo/callback',
        };
        const originalEnv = Object.fromEntries(
            Object.keys(env).map((key) => [key, process.env[key]])
        );
        Object.assign(process.env, env);

        try {
            expect(() => requireDuoStepUp({
                authSession: {
                    sessionId: 'session-1',
                    amr: ['password'],
                },
            }, { action: 'recovery-sensitive' })).toThrow(expect.objectContaining({
                statusCode: 403,
                code: 'DUO_STEP_UP_REQUIRED',
            }));
        } finally {
            for (const [key, value] of Object.entries(originalEnv)) {
                if (value === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = value;
                }
            }
        }
    });
});
