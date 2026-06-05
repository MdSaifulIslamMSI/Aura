const withAlienEnv = async (env, fn) => {
    const previous = {};
    Object.keys(env).forEach((key) => {
        previous[key] = process.env[key];
        process.env[key] = env[key];
    });
    try {
        return await fn();
    } finally {
        Object.keys(env).forEach((key) => {
            if (previous[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = previous[key];
            }
        });
    }
};

const alienEnv = ({ strict = 'false' } = {}) => ({
    ALIEN_OTP_ENABLED: 'true',
    ALIEN_OTP_SENSITIVE_ACTIONS_ENABLED: 'true',
    ALIEN_OTP_AUDIT_ENABLED: 'false',
    ALIEN_OTP_STRICT_MODE: strict,
});

const buildReq = (overrides = {}) => ({
    method: 'POST',
    originalUrl: '/api/admin/users/user-2/disable',
    requestId: 'req-1',
    headers: {
        'x-request-id': 'req-1',
        'x-aura-device-id': 'device-1',
        'user-agent': 'jest-agent',
        ...(overrides.headers || {}),
    },
    body: overrides.body || {},
    user: {
        _id: 'user-1',
        isVerified: true,
        trustedDevices: [],
    },
    authSession: {
        sessionId: 'session-1',
        userId: 'user-1',
    },
});

describe('ALIEN OTP middleware', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    test('allows missing proof in non-strict proof-only mode', async () => {
        await withAlienEnv(alienEnv(), async () => {
            const { alienOtpRequired } = require('../middleware/alienOtpRequired');
            const next = jest.fn();

            await alienOtpRequired({ action: 'admin.user.disable' })(buildReq(), {}, next);

            expect(next).toHaveBeenCalledWith();
        });
    });

    test('denies missing proof in strict mode', async () => {
        await withAlienEnv(alienEnv({ strict: 'true' }), async () => {
            const { alienOtpRequired } = require('../middleware/alienOtpRequired');
            const next = jest.fn();

            await alienOtpRequired({ action: 'admin.user.disable' })(buildReq(), {}, next);

            expect(next).toHaveBeenCalledWith(expect.objectContaining({
                statusCode: 403,
                code: 'ALIEN_OTP_REQUIRED',
            }));
        });
    });

    test('verifies proof and consumes the challenge before allowing', async () => {
        jest.doMock('../services/alienOtpWebAuthnService', () => ({
            verifyAlienAssertion: jest.fn().mockResolvedValue({
                success: true,
                method: 'webauthn',
                deviceId: 'device-1',
            }),
        }));

        await withAlienEnv(alienEnv({ strict: 'true' }), async () => {
            const {
                createChallenge,
                getChallenge,
                resetAlienOtpChallengeMemoryForTests,
            } = require('../services/alienOtpChallengeService');
            const { alienOtpRequired } = require('../middleware/alienOtpRequired');
            resetAlienOtpChallengeMemoryForTests();
            const challenge = await createChallenge({
                userId: 'user-1',
                action: 'admin.user.disable',
                resourceId: 'user-2',
                sessionId: 'session-1',
                deviceId: 'device-1',
            });
            const next = jest.fn();

            await alienOtpRequired({ action: 'admin.user.disable' })(buildReq({
                body: {
                    resourceId: 'user-2',
                    alienOtpChallengeId: challenge.challengeId,
                    alienOtpProof: {
                        method: 'webauthn',
                        credential: { response: {} },
                    },
                },
            }), {}, next);

            expect(next).toHaveBeenCalledWith();
            expect(await getChallenge(challenge.challengeId)).toBeNull();
        });
    });
});
