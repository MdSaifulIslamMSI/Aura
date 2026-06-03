const ORIGINAL_ENV = { ...process.env };

const loadAuthMiddleware = () => {
    jest.resetModules();
    return require('../middleware/authMiddleware');
};

const configureAdminWebAuthnStepUpEnv = () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_STRICT_ACCESS_ENABLED = 'true';
    process.env.ADMIN_REQUIRE_EMAIL_VERIFIED = 'true';
    process.env.ADMIN_REQUIRE_2FA = 'false';
    process.env.ADMIN_REQUIRE_ALLOWLIST = 'false';
    process.env.ADMIN_REQUIRE_FRESH_LOGIN_MINUTES = '30';
    process.env.ADMIN_ALLOWLIST_EMAILS = '';
    process.env.AUTH_DEVICE_CHALLENGE_MODE = 'off';
    process.env.AUTH_REQUIRE_WEBAUTHN_STEP_UP_FOR_ADMIN_STATE_CHANGES = 'true';
    process.env.DUO_ENABLED = 'false';
};

const buildAdminRequest = ({ trustedDevices = [], authSession = {} } = {}) => {
    const nowSeconds = Math.floor(Date.now() / 1000);

    return {
        method: 'POST',
        user: {
            _id: 'user-1',
            isAdmin: true,
            isVerified: true,
            email: 'admin@example.com',
            trustedDevices,
        },
        authUid: 'firebase-admin-uid',
        authToken: {
            email: 'admin@example.com',
            email_verified: true,
            auth_time: nowSeconds - 60,
            iat: nowSeconds - 60,
        },
        authSession: {
            sessionId: 'session-admin-1',
            userId: 'user-1',
            email: 'admin@example.com',
            ...authSession,
        },
        headers: {},
        originalUrl: '/api/admin/users/target',
        get: () => '',
    };
};

describe('authMiddleware admin WebAuthn step-up enforcement', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
    });

    test('defaults production admin state changes to fresh WebAuthn step-up', () => {
        const { resolvePhishingResistantAdminPolicy } = loadAuthMiddleware();

        expect(resolvePhishingResistantAdminPolicy({ NODE_ENV: 'production' })).toEqual({
            requireWebAuthnStepUpForStateChangingAdminActions: true,
        });
        expect(resolvePhishingResistantAdminPolicy({ NODE_ENV: 'development' })).toEqual({
            requireWebAuthnStepUpForStateChangingAdminActions: false,
        });
        expect(resolvePhishingResistantAdminPolicy({
            NODE_ENV: 'production',
            AUTH_REQUIRE_WEBAUTHN_STEP_UP_FOR_ADMIN_STATE_CHANGES: 'false',
        })).toEqual({
            requireWebAuthnStepUpForStateChangingAdminActions: false,
        });
    });

    test('blocks admin state changes when WebAuthn step-up is enabled but no credential is registered', async () => {
        configureAdminWebAuthnStepUpEnv();

        const { admin } = loadAuthMiddleware();
        const next = jest.fn();

        await admin(buildAdminRequest({ trustedDevices: [] }), {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 403,
            code: 'ADMIN_WEBAUTHN_REGISTRATION_REQUIRED',
        }));
    });

    test('requires fresh WebAuthn step-up for admin state changes when policy is enabled', async () => {
        configureAdminWebAuthnStepUpEnv();

        const { admin } = loadAuthMiddleware();
        const next = jest.fn();

        await admin(buildAdminRequest({
            trustedDevices: [
                {
                    deviceId: 'device-admin-webauthn',
                    method: 'webauthn',
                },
            ],
            authSession: {
                amr: ['webauthn'],
                stepUpUntil: new Date(Date.now() - 60_000).toISOString(),
            },
        }), {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 403,
            code: 'ADMIN_WEBAUTHN_STEP_UP_REQUIRED',
        }));
    });

    test('accepts fresh WebAuthn step-up for admin state changes when policy is enabled', async () => {
        configureAdminWebAuthnStepUpEnv();

        const { admin } = loadAuthMiddleware();
        const next = jest.fn();

        await admin(buildAdminRequest({
            trustedDevices: [
                {
                    deviceId: 'device-admin-webauthn',
                    method: 'webauthn',
                },
            ],
            authSession: {
                amr: ['webauthn'],
                stepUpUntil: new Date(Date.now() + 60_000).toISOString(),
            },
        }), {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
    });
});
