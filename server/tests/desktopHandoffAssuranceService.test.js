const {
    DESKTOP_HANDOFF_ASSURANCE_TTL_MS,
    consumeDesktopHandoffAssuranceGrant,
    createDesktopHandoffAssuranceGrant,
    resetDesktopHandoffAssuranceGrantsForTests,
} = require('../services/desktopHandoffAssuranceService');
const {
    issueTrustedDeviceSession,
} = require('../services/trustedDeviceChallengeService');

const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const TEST_ENV = { NODE_ENV: 'test' };

const createFakeRedis = () => {
    const records = new Map();
    return {
        records,
        set: jest.fn(async (key, value, options = {}) => {
            if (options.NX && records.has(key)) return null;
            records.set(key, value);
            return 'OK';
        }),
        eval: jest.fn(async (_script, { keys = [] } = {}) => {
            const [key] = keys;
            const value = records.get(key) || null;
            records.delete(key);
            return value;
        }),
    };
};

const buildContext = ({ admin = false, nowMs = Date.now() } = {}) => {
    const authUid = admin ? 'firebase-admin-handoff' : 'firebase-public-handoff';
    const userId = admin ? '507f1f77bcf86cd799439021' : '507f1f77bcf86cd799439020';
    const deviceId = admin ? 'device_admin_handoff_123' : 'device_public_handoff_123';
    const sessionVersion = admin ? 'admin-session-version-1' : 'public-session-version-1';
    const registration = {
        deviceId,
        method: admin ? 'webauthn' : 'browser_key',
        publicKeySpkiBase64: Buffer.from(`spki-${deviceId}`).toString('base64'),
        webauthnCredentialIdBase64Url: admin ? 'credential-admin-handoff' : '',
        webauthnUserVerification: admin ? 'required' : '',
        webauthnUserVerified: admin ? true : null,
        credentialScope: admin ? 'admin' : 'device',
        adminEligibility: admin ? 'verified' : 'none',
        sessionVersion,
        expiresAt: new Date(nowMs + 60 * 60 * 1000),
        revokedAt: null,
    };
    const user = {
        _id: userId,
        authUid,
        isAdmin: admin,
        adminRoles: admin ? ['ADMIN'] : [],
        trustedDevices: [registration],
    };
    const tokenTime = Math.floor(nowMs / 1000) - 30;
    const authToken = {
        uid: authUid,
        sub: authUid,
        auth_time: tokenTime,
        iat: tokenTime,
    };
    const authSession = {
        sessionId: admin ? 'browser-session-admin' : 'browser-session-public',
        userId,
        firebaseUid: authUid,
        deviceId,
        deviceMethod: registration.method,
        aal: 'aal2',
        amr: admin ? ['webauthn', 'passkey', 'mfa'] : ['otp', 'device_binding'],
        stepUpUntil: new Date(nowMs + 10 * 60 * 1000).toISOString(),
        webAuthnStepUpUntil: admin ? new Date(nowMs + 10 * 60 * 1000).toISOString() : null,
        absoluteExpiresAt: new Date(nowMs + 60 * 60 * 1000).toISOString(),
        idleExpiresAt: new Date(nowMs + 30 * 60 * 1000).toISOString(),
        firebaseExpiresAt: new Date(nowMs + 30 * 60 * 1000).toISOString(),
        revokedAt: null,
    };
    const { deviceSessionToken } = issueTrustedDeviceSession({
        user,
        authUid,
        authToken,
        deviceId,
        sessionVersion,
    });

    return {
        requestId: REQUEST_ID,
        user,
        authUid,
        authToken,
        authSession,
        deviceId,
        deviceSessionToken,
    };
};

const issueGrant = async (context, { nowMs, redisClient = null, env = TEST_ENV } = {}) => (
    createDesktopHandoffAssuranceGrant(context, {
        env,
        now: () => nowMs,
        redisClient,
    })
);

const consumeGrant = async (context, grant, {
    nowMs,
    redisClient = null,
    env = TEST_ENV,
    requestId = REQUEST_ID,
    getBrowserSessionById = jest.fn(async () => context.authSession),
} = {}) => {
    const desktopAuthToken = {
        uid: context.authUid,
        sub: context.authUid,
        auth_time: Math.floor(nowMs / 1000),
        iat: Math.floor(nowMs / 1000),
        ...grant.claims,
    };
    const result = await consumeDesktopHandoffAssuranceGrant({
        authToken: desktopAuthToken,
        authUid: context.authUid,
        user: context.user,
        desktopHandoffRequestId: requestId,
    }, {
        env,
        now: () => nowMs,
        redisClient,
        getBrowserSessionById,
    });
    return { desktopAuthToken, result };
};

describe('desktopHandoffAssuranceService', () => {
    beforeEach(() => {
        resetDesktopHandoffAssuranceGrantsForTests();
        jest.clearAllMocks();
    });

    test('authorizes one target-device bootstrap without transferring browser assurance', async () => {
        const nowMs = Date.now();
        const context = buildContext({ nowMs });
        const redisClient = createFakeRedis();
        const grant = await issueGrant(context, { nowMs, redisClient });

        expect(grant.claims).toEqual({
            desktop_handoff: true,
            desktop_request_id: REQUEST_ID,
            desktop_handoff_grant_id: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
            desktop_handoff_grant_exp: Math.floor((nowMs + DESKTOP_HANDOFF_ASSURANCE_TTL_MS) / 1000),
        });
        expect(redisClient.set).toHaveBeenCalledWith(
            expect.stringContaining(':desktop-handoff:assurance-grant:'),
            expect.any(String),
            { NX: true, PX: DESKTOP_HANDOFF_ASSURANCE_TTL_MS }
        );
        expect(JSON.parse([...redisClient.records.values()][0])).toMatchObject({
            sourceSessionId: context.authSession.sessionId,
        });

        const getBrowserSessionById = jest.fn(async () => context.authSession);
        const { result } = await consumeGrant(context, grant, {
            nowMs: nowMs + 1000,
            redisClient,
            getBrowserSessionById,
        });

        expect(result).toEqual({
            bootstrapExpiresAt: new Date(
                grant.claims.desktop_handoff_grant_exp * 1000
            ).toISOString(),
            requestId: REQUEST_ID,
            loginMfaSatisfied: false,
            adminPasskeySatisfied: false,
        });
        expect(result).not.toHaveProperty('deviceId');
        expect(result).not.toHaveProperty('deviceSessionToken');
        expect(result).not.toHaveProperty('additionalAmr');
        expect(getBrowserSessionById).toHaveBeenCalledWith(context.authSession.sessionId);
        expect(redisClient.eval).toHaveBeenCalledTimes(1);
        expect(redisClient.records.size).toBe(0);
    });

    test('does not transfer admin WebAuthn or step-up assurance to the target runtime', async () => {
        const nowMs = Date.now();
        const context = buildContext({ admin: true, nowMs });
        const grant = await issueGrant(context, { nowMs });
        const { result } = await consumeGrant(context, grant, { nowMs: nowMs + 1000 });

        expect(result).toEqual({
            bootstrapExpiresAt: new Date(
                grant.claims.desktop_handoff_grant_exp * 1000
            ).toISOString(),
            requestId: REQUEST_ID,
            loginMfaSatisfied: true,
            adminPasskeySatisfied: true,
        });
        expect(result).not.toHaveProperty('deviceMethod');
        expect(result).not.toHaveProperty('stepUpUntil');
        expect(result).not.toHaveProperty('webAuthnStepUpUntil');
    });

    test('accepts an active browser session after its Firebase token snapshot expires', async () => {
        const nowMs = Date.now();
        const context = buildContext({ nowMs });
        context.authSession.firebaseExpiresAt = new Date(nowMs - 1).toISOString();

        await expect(issueGrant(context, { nowMs })).resolves.toMatchObject({
            claims: {
                desktop_handoff: true,
                desktop_request_id: REQUEST_ID,
            },
        });
    });

    test('rejects grant creation while the source login MFA policy remains incomplete', async () => {
        const originalMfaEnabled = process.env.MFA_ENABLED;
        const nowMs = Date.now();
        const context = buildContext({ nowMs });
        context.user.mfa = { enabled: true };
        process.env.MFA_ENABLED = 'true';

        try {
            await expect(issueGrant(context, { nowMs })).rejects.toMatchObject({
                statusCode: 403,
                code: 'DESKTOP_HANDOFF_MFA_REQUIRED',
            });
        } finally {
            if (originalMfaEnabled === undefined) delete process.env.MFA_ENABLED;
            else process.env.MFA_ENABLED = originalMfaEnabled;
        }
    });

    test.each([
        ['absolute', 'absoluteExpiresAt'],
        ['idle', 'idleExpiresAt'],
    ])('rejects a browser session after its %s deadline', async (_label, expiryField) => {
        const nowMs = Date.now();
        const context = buildContext({ nowMs });
        context.authSession[expiryField] = new Date(nowMs - 1).toISOString();

        await expect(issueGrant(context, { nowMs })).rejects.toMatchObject({
            statusCode: 403,
            code: 'DESKTOP_HANDOFF_ASSURANCE_SESSION_EXPIRED',
        });
    });

    test.each([
        ['non-WebAuthn registration', (context) => {
            context.user.trustedDevices[0].method = 'browser_key';
            context.user.trustedDevices[0].webauthnCredentialIdBase64Url = '';
        }],
        ['unobserved user verification', (context) => {
            context.user.trustedDevices[0].webauthnUserVerified = false;
        }],
        ['unverified admin eligibility', (context) => {
            context.user.trustedDevices[0].adminEligibility = 'none';
        }],
        ['non-admin credential scope', (context) => {
            context.user.trustedDevices[0].credentialScope = 'mfa';
        }],
        ['AAL1 browser session', (context) => {
            context.authSession.aal = 'aal1';
        }],
        ['expired step-up', (context, nowMs) => {
            context.authSession.stepUpUntil = new Date(nowMs - 1).toISOString();
        }],
        ['expired WebAuthn step-up despite fresh OTP step-up', (context, nowMs) => {
            context.authSession.stepUpUntil = new Date(nowMs + 10 * 60 * 1000).toISOString();
            context.authSession.webAuthnStepUpUntil = new Date(nowMs - 1).toISOString();
            context.authSession.amr = ['webauthn', 'passkey', 'mfa', 'otp'];
        }],
        ['missing passkey AMR', (context) => {
            context.authSession.amr = ['mfa', 'otp'];
        }],
        ['missing completed MFA marker', (context) => {
            context.authSession.amr = ['webauthn', 'passkey'];
        }],
    ])('rejects admin issuance with %s', async (_label, mutate) => {
        const nowMs = Date.now();
        const context = buildContext({ admin: true, nowMs });
        mutate(context, nowMs);

        await expect(issueGrant(context, { nowMs })).rejects.toMatchObject({
            statusCode: 403,
            code: 'DESKTOP_HANDOFF_ADMIN_ASSURANCE_REQUIRED',
        });
    });

    test('rejects relay chaining from an already relayed desktop session', async () => {
        const nowMs = Date.now();
        const context = buildContext({ nowMs });
        context.authSession.amr.push('desktop_handoff');

        await expect(issueGrant(context, { nowMs })).rejects.toMatchObject({
            statusCode: 403,
            code: 'DESKTOP_HANDOFF_ASSURANCE_SOURCE_RELAYED',
        });
    });

    test('rejects and burns a grant after the exact source browser session is revoked', async () => {
        const nowMs = Date.now();
        const context = buildContext({ nowMs });
        const redisClient = createFakeRedis();
        const grant = await issueGrant(context, { nowMs, redisClient });
        const getBrowserSessionById = jest.fn().mockResolvedValue(null);

        await expect(consumeGrant(context, grant, {
            nowMs: nowMs + 1000,
            redisClient,
            getBrowserSessionById,
        })).rejects.toMatchObject({
            statusCode: 403,
            code: 'DESKTOP_HANDOFF_ASSURANCE_SESSION_MISMATCH',
        });
        expect(getBrowserSessionById).toHaveBeenCalledWith(context.authSession.sessionId);
        expect(redisClient.records.size).toBe(0);

        await expect(consumeGrant(context, grant, {
            nowMs: nowMs + 2000,
            redisClient,
        })).rejects.toMatchObject({
            statusCode: 409,
            code: 'DESKTOP_HANDOFF_ASSURANCE_GRANT_CONSUMED',
        });
    });

    test.each([
        ['session ID', 'sessionId', 'browser-session-other'],
        ['user ID', 'userId', '507f1f77bcf86cd799439099'],
        ['Firebase UID', 'firebaseUid', 'firebase-other-user'],
        ['device ID', 'deviceId', 'device_other_handoff_123'],
    ])('rejects a source browser session with a mismatched %s', async (_label, field, value) => {
        const nowMs = Date.now();
        const context = buildContext({ nowMs });
        const grant = await issueGrant(context, { nowMs });
        const sourceSession = {
            ...context.authSession,
            [field]: value,
        };

        await expect(consumeGrant(context, grant, {
            nowMs: nowMs + 1000,
            getBrowserSessionById: jest.fn().mockResolvedValue(sourceSession),
        })).rejects.toMatchObject({
            statusCode: 403,
            code: 'DESKTOP_HANDOFF_ASSURANCE_SESSION_MISMATCH',
        });
    });

    test('fails closed when the source browser session store errors during consumption', async () => {
        const nowMs = Date.now();
        const context = buildContext({ nowMs });
        const grant = await issueGrant(context, { nowMs });

        await expect(consumeGrant(context, grant, {
            nowMs: nowMs + 1000,
            getBrowserSessionById: jest.fn().mockRejectedValue(new Error('session store unavailable')),
        })).rejects.toMatchObject({
            statusCode: 503,
            code: 'DESKTOP_HANDOFF_ASSURANCE_SESSION_STORE_UNAVAILABLE',
        });

        await expect(consumeGrant(context, grant, {
            nowMs: nowMs + 2000,
        })).rejects.toMatchObject({
            statusCode: 409,
            code: 'DESKTOP_HANDOFF_ASSURANCE_GRANT_CONSUMED',
        });
    });

    test('rejects an expired five-minute grant', async () => {
        const nowMs = Date.now();
        const context = buildContext({ nowMs });
        const grant = await issueGrant(context, { nowMs });

        await expect(consumeGrant(context, grant, {
            nowMs: nowMs + DESKTOP_HANDOFF_ASSURANCE_TTL_MS + 1,
        })).rejects.toMatchObject({
            statusCode: 401,
            code: 'DESKTOP_HANDOFF_ASSURANCE_CLAIMS_INVALID',
        });
    });

    test('rejects replay after the one-time grant is consumed', async () => {
        const nowMs = Date.now();
        const context = buildContext({ nowMs });
        const grant = await issueGrant(context, { nowMs });
        await consumeGrant(context, grant, { nowMs: nowMs + 1000 });

        await expect(consumeGrant(context, grant, { nowMs: nowMs + 2000 })).rejects.toMatchObject({
            statusCode: 409,
            code: 'DESKTOP_HANDOFF_ASSURANCE_GRANT_CONSUMED',
        });
    });

    test('rejects a desktop request ID that does not match the signed claim and grant', async () => {
        const nowMs = Date.now();
        const context = buildContext({ nowMs });
        const grant = await issueGrant(context, { nowMs });

        await expect(consumeGrant(context, grant, {
            nowMs: nowMs + 1000,
            requestId: '123e4567-e89b-42d3-a456-426614174001',
        })).rejects.toMatchObject({
            statusCode: 401,
            code: 'DESKTOP_HANDOFF_ASSURANCE_CLAIMS_INVALID',
        });
    });

    test('rejects a Firebase UID that no longer matches the user binding', async () => {
        const nowMs = Date.now();
        const context = buildContext({ nowMs });
        const grant = await issueGrant(context, { nowMs });
        const mismatchedUid = 'firebase-other-user';

        await expect(consumeDesktopHandoffAssuranceGrant({
            authToken: {
                uid: mismatchedUid,
                sub: mismatchedUid,
                ...grant.claims,
            },
            authUid: mismatchedUid,
            user: context.user,
            desktopHandoffRequestId: REQUEST_ID,
        }, {
            env: TEST_ENV,
            now: () => nowMs + 1000,
            redisClient: null,
        })).rejects.toMatchObject({
            statusCode: 403,
            code: 'DESKTOP_HANDOFF_ASSURANCE_IDENTITY_MISMATCH',
        });
    });

    test.each([
        ['revocation', (registration, nowMs) => {
            registration.revokedAt = new Date(nowMs);
        }],
        ['session-version rotation', (registration) => {
            registration.sessionVersion = 'rotated-session-version';
        }],
    ])('rejects a grant after trusted-device %s', async (_label, mutate) => {
        const nowMs = Date.now();
        const context = buildContext({ nowMs });
        const grant = await issueGrant(context, { nowMs });
        mutate(context.user.trustedDevices[0], nowMs);

        await expect(consumeGrant(context, grant, { nowMs: nowMs + 1000 })).rejects.toMatchObject({
            statusCode: 403,
            code: 'DESKTOP_HANDOFF_ASSURANCE_DEVICE_CHANGED',
        });
    });

    test('fails closed when Redis is unavailable in production', async () => {
        const nowMs = Date.now();
        const context = buildContext({ nowMs });

        await expect(issueGrant(context, {
            nowMs,
            redisClient: null,
            env: { NODE_ENV: 'production' },
        })).rejects.toMatchObject({
            statusCode: 503,
            code: 'DESKTOP_HANDOFF_ASSURANCE_STORE_UNAVAILABLE',
        });
    });
});
