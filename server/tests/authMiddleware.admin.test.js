const ORIGINAL_ENV = {
    NODE_ENV: process.env.NODE_ENV,
    ADMIN_STRICT_ACCESS_ENABLED: process.env.ADMIN_STRICT_ACCESS_ENABLED,
    ADMIN_REQUIRE_EMAIL_VERIFIED: process.env.ADMIN_REQUIRE_EMAIL_VERIFIED,
    ADMIN_REQUIRE_2FA: process.env.ADMIN_REQUIRE_2FA,
    ADMIN_REQUIRE_PASSKEY: process.env.ADMIN_REQUIRE_PASSKEY,
    ADMIN_REQUIRE_ALLOWLIST: process.env.ADMIN_REQUIRE_ALLOWLIST,
    ADMIN_REQUIRE_FRESH_LOGIN_MINUTES: process.env.ADMIN_REQUIRE_FRESH_LOGIN_MINUTES,
    ADMIN_ALLOWLIST_EMAILS: process.env.ADMIN_ALLOWLIST_EMAILS,
    AUTH_DEVICE_CHALLENGE_MODE: process.env.AUTH_DEVICE_CHALLENGE_MODE,
    AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK: process.env.AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK,
    AUTH_VAULT_SECRET: process.env.AUTH_VAULT_SECRET,
    AUTH_VAULT_SECRET_VERSION: process.env.AUTH_VAULT_SECRET_VERSION,
    PRIVILEGED_JIT_ACCESS_ENABLED: process.env.PRIVILEGED_JIT_ACCESS_ENABLED,
    AUTH_REQUIRE_WEBAUTHN_FOR_ADMIN_STATE_CHANGES: process.env.AUTH_REQUIRE_WEBAUTHN_FOR_ADMIN_STATE_CHANGES,
    AUTH_REQUIRE_WEBAUTHN_STEP_UP_FOR_ADMIN_STATE_CHANGES: process.env.AUTH_REQUIRE_WEBAUTHN_STEP_UP_FOR_ADMIN_STATE_CHANGES,
    DUO_ENABLED: process.env.DUO_ENABLED,
    DUO_CLIENT_ID: process.env.DUO_CLIENT_ID,
    DUO_CLIENT_SECRET: process.env.DUO_CLIENT_SECRET,
    DUO_OIDC_ISSUER: process.env.DUO_OIDC_ISSUER,
    DUO_DISCOVERY_URL: process.env.DUO_DISCOVERY_URL,
    DUO_REDIRECT_URI: process.env.DUO_REDIRECT_URI,
};

const loadAdminMiddleware = () => {
    jest.resetModules();
    return require('../middleware/authMiddleware').admin;
};

const loadAuthMiddleware = () => {
    jest.resetModules();
    return require('../middleware/authMiddleware');
};

const loadTrustedDeviceService = () => {
    jest.resetModules();
    return require('../services/trustedDeviceChallengeService');
};

describe('authMiddleware admin second-factor enforcement', () => {
    afterEach(() => {
        for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
        jest.resetModules();
    });

    test('accepts a verified trusted device as the admin second factor when the policy requires it', async () => {
        process.env.NODE_ENV = 'test';
        process.env.ADMIN_STRICT_ACCESS_ENABLED = 'true';
        process.env.ADMIN_REQUIRE_EMAIL_VERIFIED = 'true';
        process.env.ADMIN_REQUIRE_2FA = 'true';
        process.env.ADMIN_REQUIRE_PASSKEY = 'false';
        process.env.ADMIN_REQUIRE_ALLOWLIST = 'false';
        process.env.ADMIN_REQUIRE_FRESH_LOGIN_MINUTES = '30';
        process.env.ADMIN_ALLOWLIST_EMAILS = 'admin@example.com';
        process.env.AUTH_DEVICE_CHALLENGE_MODE = 'admin';
        process.env.AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK = 'true';
        process.env.AUTH_VAULT_SECRET = 'vault-secret-ABCDEFGHIJKLMNOPQRSTUVWXYZ12';
        process.env.AUTH_VAULT_SECRET_VERSION = 'vault-v1';

        const nowSeconds = Math.floor(Date.now() / 1000);
        const {
            TRUSTED_DEVICE_ID_HEADER,
            TRUSTED_DEVICE_SESSION_HEADER,
            issueTrustedDeviceSession,
        } = loadTrustedDeviceService();
        const admin = loadAdminMiddleware();
        const deviceId = 'device-abcdefghijkl';
        const user = {
            _id: 'user-1',
            isAdmin: true,
            email: 'admin@example.com',
        };
        const authToken = {
            email: 'admin@example.com',
            email_verified: true,
            auth_time: nowSeconds - 60,
            iat: nowSeconds - 60,
        };
        const { deviceSessionToken } = issueTrustedDeviceSession({
            user,
            authUid: 'firebase-admin-uid',
            authToken,
            deviceId,
        });
        const headers = {
            [TRUSTED_DEVICE_ID_HEADER]: deviceId,
            [TRUSTED_DEVICE_SESSION_HEADER]: deviceSessionToken,
        };
        const req = {
            user,
            authUid: 'firebase-admin-uid',
            authToken,
            headers,
            originalUrl: '/api/admin/dashboard',
            get: (header) => headers[header],
        };
        const next = jest.fn();

        await admin(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
    });

    test('blocks browser-key trusted devices when the admin passkey policy requires WebAuthn', async () => {
        process.env.NODE_ENV = 'test';
        process.env.ADMIN_STRICT_ACCESS_ENABLED = 'true';
        process.env.ADMIN_REQUIRE_EMAIL_VERIFIED = 'true';
        process.env.ADMIN_REQUIRE_2FA = 'true';
        process.env.ADMIN_REQUIRE_PASSKEY = 'true';
        process.env.ADMIN_REQUIRE_ALLOWLIST = 'false';
        process.env.ADMIN_REQUIRE_FRESH_LOGIN_MINUTES = '30';
        process.env.ADMIN_ALLOWLIST_EMAILS = 'admin@example.com';
        process.env.AUTH_DEVICE_CHALLENGE_MODE = 'admin';
        process.env.AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK = 'true';
        process.env.AUTH_VAULT_SECRET = 'vault-secret-ABCDEFGHIJKLMNOPQRSTUVWXYZ12';
        process.env.AUTH_VAULT_SECRET_VERSION = 'vault-v1';

        const nowSeconds = Math.floor(Date.now() / 1000);
        const {
            TRUSTED_DEVICE_ID_HEADER,
            TRUSTED_DEVICE_SESSION_HEADER,
            issueTrustedDeviceSession,
        } = loadTrustedDeviceService();
        const admin = loadAdminMiddleware();
        const deviceId = 'device-browser-abcdefghijkl';
        const user = {
            _id: 'user-1',
            isAdmin: true,
            email: 'admin@example.com',
            trustedDevices: [{ deviceId, method: 'browser_key' }],
        };
        const authToken = {
            email: 'admin@example.com',
            email_verified: true,
            auth_time: nowSeconds - 60,
            iat: nowSeconds - 60,
        };
        const { deviceSessionToken } = issueTrustedDeviceSession({
            user,
            authUid: 'firebase-admin-uid',
            authToken,
            deviceId,
        });
        const headers = {
            [TRUSTED_DEVICE_ID_HEADER]: deviceId,
            [TRUSTED_DEVICE_SESSION_HEADER]: deviceSessionToken,
        };
        const req = {
            user,
            authUid: 'firebase-admin-uid',
            authToken,
            headers,
            originalUrl: '/api/admin/dashboard',
            get: (header) => headers[header],
        };
        const next = jest.fn();

        await admin(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Admin access requires passkey verification',
            statusCode: 403,
        }));
    });

    test('accepts WebAuthn trusted devices when the admin passkey policy requires it', async () => {
        process.env.NODE_ENV = 'test';
        process.env.ADMIN_STRICT_ACCESS_ENABLED = 'true';
        process.env.ADMIN_REQUIRE_EMAIL_VERIFIED = 'true';
        process.env.ADMIN_REQUIRE_2FA = 'true';
        process.env.ADMIN_REQUIRE_PASSKEY = 'true';
        process.env.ADMIN_REQUIRE_ALLOWLIST = 'false';
        process.env.ADMIN_REQUIRE_FRESH_LOGIN_MINUTES = '30';
        process.env.ADMIN_ALLOWLIST_EMAILS = 'admin@example.com';
        process.env.AUTH_DEVICE_CHALLENGE_MODE = 'admin';
        process.env.AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK = 'true';
        process.env.AUTH_VAULT_SECRET = 'vault-secret-ABCDEFGHIJKLMNOPQRSTUVWXYZ12';
        process.env.AUTH_VAULT_SECRET_VERSION = 'vault-v1';

        const nowSeconds = Math.floor(Date.now() / 1000);
        const {
            TRUSTED_DEVICE_ID_HEADER,
            TRUSTED_DEVICE_SESSION_HEADER,
            issueTrustedDeviceSession,
        } = loadTrustedDeviceService();
        const admin = loadAdminMiddleware();
        const deviceId = 'device-webauthn-abcdefghijkl';
        const user = {
            _id: 'user-1',
            isAdmin: true,
            email: 'admin@example.com',
            trustedDevices: [{
                deviceId,
                method: 'webauthn',
                webauthnCredentialIdBase64Url: 'credential-id',
            }],
        };
        const authToken = {
            email: 'admin@example.com',
            email_verified: true,
            auth_time: nowSeconds - 60,
            iat: nowSeconds - 60,
        };
        const { deviceSessionToken } = issueTrustedDeviceSession({
            user,
            authUid: 'firebase-admin-uid',
            authToken,
            deviceId,
        });
        const headers = {
            [TRUSTED_DEVICE_ID_HEADER]: deviceId,
            [TRUSTED_DEVICE_SESSION_HEADER]: deviceSessionToken,
        };
        const req = {
            user,
            authUid: 'firebase-admin-uid',
            authToken,
            headers,
            originalUrl: '/api/admin/dashboard',
            get: (header) => headers[header],
        };
        const next = jest.fn();

        await admin(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
    });

    test('defaults production admin access to allowlist and second-factor enforcement', () => {
        const { resolveAdminAccessPolicy } = loadAuthMiddleware();

        expect(resolveAdminAccessPolicy({ NODE_ENV: 'production' })).toEqual({
            strictAccessEnabled: true,
            requireEmailVerified: true,
            requireSecondFactor: true,
            requirePasskey: true,
            requireAllowlist: true,
            freshLoginMinutes: 30,
        });
    });

    test('keeps non-production admin defaults compatible with local smoke accounts', () => {
        const { resolveAdminAccessPolicy } = loadAuthMiddleware();

        expect(resolveAdminAccessPolicy({ NODE_ENV: 'development' })).toEqual({
            strictAccessEnabled: true,
            requireEmailVerified: true,
            requireSecondFactor: false,
            requirePasskey: false,
            requireAllowlist: false,
            freshLoginMinutes: 30,
        });
    });

    test('returns a machine-readable code when required admin allowlist is missing', async () => {
        process.env.NODE_ENV = 'test';
        process.env.ADMIN_STRICT_ACCESS_ENABLED = 'true';
        process.env.ADMIN_REQUIRE_EMAIL_VERIFIED = 'true';
        process.env.ADMIN_REQUIRE_2FA = 'false';
        process.env.ADMIN_REQUIRE_PASSKEY = 'false';
        process.env.ADMIN_REQUIRE_ALLOWLIST = 'true';
        process.env.ADMIN_REQUIRE_FRESH_LOGIN_MINUTES = '30';
        process.env.ADMIN_ALLOWLIST_EMAILS = '';
        process.env.AUTH_DEVICE_CHALLENGE_MODE = 'off';

        const nowSeconds = Math.floor(Date.now() / 1000);
        const admin = loadAdminMiddleware();
        const req = {
            user: {
                _id: 'user-1',
                isAdmin: true,
                isVerified: true,
                email: 'admin@example.com',
            },
            authUid: 'firebase-admin-uid',
            authToken: {
                email: 'admin@example.com',
                email_verified: true,
                auth_time: nowSeconds - 60,
                iat: nowSeconds - 60,
            },
            headers: {},
            originalUrl: '/api/admin/dashboard',
            get: () => '',
        };
        const next = jest.fn();

        await admin(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Admin access is locked: allowlist is not configured',
            statusCode: 403,
            code: 'ADMIN_ALLOWLIST_MISSING',
        }));
    });

    test('blocks admin access when no second factor is present', async () => {
        process.env.NODE_ENV = 'test';
        process.env.ADMIN_STRICT_ACCESS_ENABLED = 'true';
        process.env.ADMIN_REQUIRE_EMAIL_VERIFIED = 'true';
        process.env.ADMIN_REQUIRE_2FA = 'true';
        process.env.ADMIN_REQUIRE_ALLOWLIST = 'false';
        process.env.ADMIN_REQUIRE_FRESH_LOGIN_MINUTES = '30';
        process.env.ADMIN_ALLOWLIST_EMAILS = 'admin@example.com';
        process.env.AUTH_DEVICE_CHALLENGE_MODE = 'admin';
        process.env.AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK = 'true';
        process.env.AUTH_VAULT_SECRET = 'vault-secret-ABCDEFGHIJKLMNOPQRSTUVWXYZ12';
        process.env.AUTH_VAULT_SECRET_VERSION = 'vault-v1';

        const nowSeconds = Math.floor(Date.now() / 1000);
        const admin = loadAdminMiddleware();
        const req = {
            user: {
                _id: 'user-1',
                isAdmin: true,
                email: 'admin@example.com',
            },
            authUid: 'firebase-admin-uid',
            authToken: {
                email: 'admin@example.com',
                email_verified: true,
                auth_time: nowSeconds - 60,
                iat: nowSeconds - 60,
            },
            headers: {},
            originalUrl: '/api/admin/dashboard',
            get: () => '',
        };
        const next = jest.fn();

        await admin(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            message: 'Admin access requires a verified second factor',
            statusCode: 403,
        }));
    });

    test('accepts trusted social providers when the stored admin profile is verified', async () => {
        process.env.NODE_ENV = 'test';
        process.env.ADMIN_STRICT_ACCESS_ENABLED = 'true';
        process.env.ADMIN_REQUIRE_EMAIL_VERIFIED = 'true';
        process.env.ADMIN_REQUIRE_2FA = 'false';
        process.env.ADMIN_REQUIRE_PASSKEY = 'false';
        process.env.AUTH_DEVICE_CHALLENGE_MODE = 'off';
        process.env.ADMIN_REQUIRE_ALLOWLIST = 'false';
        process.env.ADMIN_REQUIRE_FRESH_LOGIN_MINUTES = '30';
        process.env.ADMIN_ALLOWLIST_EMAILS = 'admin@example.com';

        const nowSeconds = Math.floor(Date.now() / 1000);
        const admin = loadAdminMiddleware();
        const req = {
            user: {
                _id: 'user-1',
                isAdmin: true,
                isVerified: true,
                email: 'admin@example.com',
            },
            authUid: 'firebase-admin-x',
            authToken: {
                email: 'admin@example.com',
                email_verified: false,
                auth_time: nowSeconds - 60,
                iat: nowSeconds - 60,
                firebase: {
                    sign_in_provider: 'twitter.com',
                },
            },
            authIdentity: {
                uid: 'firebase-admin-x',
                email: 'admin@example.com',
                emailVerified: false,
            },
            headers: {},
            originalUrl: '/api/admin/dashboard',
            get: () => '',
        };
        const next = jest.fn();

        await admin(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
    });

    test('fails closed for admin state changes when Duo is enabled but incomplete', async () => {
        process.env.NODE_ENV = 'test';
        process.env.ADMIN_STRICT_ACCESS_ENABLED = 'true';
        process.env.ADMIN_REQUIRE_EMAIL_VERIFIED = 'true';
        process.env.ADMIN_REQUIRE_2FA = 'false';
        process.env.ADMIN_REQUIRE_PASSKEY = 'false';
        process.env.ADMIN_REQUIRE_ALLOWLIST = 'false';
        process.env.ADMIN_REQUIRE_FRESH_LOGIN_MINUTES = '30';
        process.env.ADMIN_ALLOWLIST_EMAILS = '';
        process.env.AUTH_DEVICE_CHALLENGE_MODE = 'off';
        process.env.DUO_ENABLED = 'true';
        delete process.env.DUO_CLIENT_ID;
        delete process.env.DUO_CLIENT_SECRET;
        delete process.env.DUO_OIDC_ISSUER;
        delete process.env.DUO_DISCOVERY_URL;
        delete process.env.DUO_REDIRECT_URI;

        const nowSeconds = Math.floor(Date.now() / 1000);
        const admin = loadAdminMiddleware();
        const req = {
            method: 'POST',
            user: {
                _id: 'user-1',
                isAdmin: true,
                isVerified: true,
                email: 'admin@example.com',
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
            },
            headers: {},
            originalUrl: '/api/admin/users/target',
            get: () => '',
        };
        const next = jest.fn();

        await admin(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 503,
            code: 'DUO_NOT_CONFIGURED',
        }));
    });

    test('requires fresh Duo step-up for admin state changes when Duo is configured', async () => {
        process.env.NODE_ENV = 'test';
        process.env.ADMIN_STRICT_ACCESS_ENABLED = 'true';
        process.env.ADMIN_REQUIRE_EMAIL_VERIFIED = 'true';
        process.env.ADMIN_REQUIRE_2FA = 'false';
        process.env.ADMIN_REQUIRE_PASSKEY = 'false';
        process.env.ADMIN_REQUIRE_ALLOWLIST = 'false';
        process.env.ADMIN_REQUIRE_FRESH_LOGIN_MINUTES = '30';
        process.env.ADMIN_ALLOWLIST_EMAILS = '';
        process.env.AUTH_DEVICE_CHALLENGE_MODE = 'off';
        process.env.DUO_ENABLED = 'true';
        process.env.DUO_CLIENT_ID = 'duo-client-id';
        process.env.DUO_CLIENT_SECRET = 'duo-client-secret';
        process.env.DUO_OIDC_ISSUER = 'https://duo.example.test/oidc/duo-client-id';
        process.env.DUO_DISCOVERY_URL = 'https://duo.example.test/oidc/duo-client-id/.well-known/openid-configuration';
        process.env.DUO_REDIRECT_URI = 'https://api.example.test/api/auth/duo/callback';

        const nowSeconds = Math.floor(Date.now() / 1000);
        const admin = loadAdminMiddleware();
        const req = {
            method: 'POST',
            user: {
                _id: 'user-1',
                isAdmin: true,
                isVerified: true,
                email: 'admin@example.com',
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
                amr: ['password'],
            },
            headers: {},
            originalUrl: '/api/admin/users/target',
            get: () => '',
        };
        const next = jest.fn();

        await admin(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 403,
            code: 'DUO_STEP_UP_REQUIRED',
        }));
    });

    test('accepts fresh Duo step-up for admin state changes', async () => {
        process.env.NODE_ENV = 'test';
        process.env.ADMIN_STRICT_ACCESS_ENABLED = 'true';
        process.env.ADMIN_REQUIRE_EMAIL_VERIFIED = 'true';
        process.env.ADMIN_REQUIRE_2FA = 'false';
        process.env.ADMIN_REQUIRE_PASSKEY = 'false';
        process.env.ADMIN_REQUIRE_ALLOWLIST = 'false';
        process.env.ADMIN_REQUIRE_FRESH_LOGIN_MINUTES = '30';
        process.env.ADMIN_ALLOWLIST_EMAILS = '';
        process.env.AUTH_DEVICE_CHALLENGE_MODE = 'off';
        process.env.DUO_ENABLED = 'true';
        process.env.DUO_CLIENT_ID = 'duo-client-id';
        process.env.DUO_CLIENT_SECRET = 'duo-client-secret';
        process.env.DUO_OIDC_ISSUER = 'https://duo.example.test/oidc/duo-client-id';
        process.env.DUO_DISCOVERY_URL = 'https://duo.example.test/oidc/duo-client-id/.well-known/openid-configuration';
        process.env.DUO_REDIRECT_URI = 'https://api.example.test/api/auth/duo/callback';

        const nowSeconds = Math.floor(Date.now() / 1000);
        const admin = loadAdminMiddleware();
        const req = {
            method: 'POST',
            user: {
                _id: 'user-1',
                isAdmin: true,
                isVerified: true,
                email: 'admin@example.com',
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
                amr: ['password', 'duo_oidc'],
                stepUpUntil: new Date(Date.now() + 60_000).toISOString(),
            },
            headers: {},
            originalUrl: '/api/admin/users/target',
            get: () => '',
        };
        const next = jest.fn();

        await admin(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
    });

    test('blocks manifest-protected admin actions when privileged JIT is enabled without an active grant', async () => {
        process.env.NODE_ENV = 'test';
        process.env.ADMIN_STRICT_ACCESS_ENABLED = 'true';
        process.env.ADMIN_REQUIRE_EMAIL_VERIFIED = 'true';
        process.env.ADMIN_REQUIRE_2FA = 'false';
        process.env.ADMIN_REQUIRE_PASSKEY = 'false';
        process.env.ADMIN_REQUIRE_ALLOWLIST = 'false';
        process.env.ADMIN_REQUIRE_FRESH_LOGIN_MINUTES = '30';
        process.env.ADMIN_ALLOWLIST_EMAILS = '';
        process.env.AUTH_DEVICE_CHALLENGE_MODE = 'off';
        process.env.PRIVILEGED_JIT_ACCESS_ENABLED = 'true';
        process.env.DUO_ENABLED = 'false';
        process.env.AUTH_REQUIRE_WEBAUTHN_FOR_ADMIN_STATE_CHANGES = 'false';

        const nowSeconds = Math.floor(Date.now() / 1000);
        const admin = loadAdminMiddleware();
        const req = {
            method: 'POST',
            user: {
                _id: 'user-1',
                isAdmin: true,
                isVerified: true,
                email: 'admin@example.com',
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
                privilegedGrants: [],
            },
            headers: {},
            originalUrl: '/api/admin/users/507f1f77bcf86cd799439011/delete',
            get: () => '',
        };
        const next = jest.fn();

        await admin(req, {}, next);

        expect(req.authzDecision).toMatchObject({
            allowed: false,
            code: 'PRIVILEGED_JIT_REQUIRED',
            permission: 'admin.users.delete',
        });
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 403,
            code: 'PRIVILEGED_JIT_REQUIRED',
        }));
    });

    test('accepts manifest-protected admin actions with an active privileged JIT grant', async () => {
        process.env.NODE_ENV = 'test';
        process.env.ADMIN_STRICT_ACCESS_ENABLED = 'true';
        process.env.ADMIN_REQUIRE_EMAIL_VERIFIED = 'true';
        process.env.ADMIN_REQUIRE_2FA = 'false';
        process.env.ADMIN_REQUIRE_PASSKEY = 'false';
        process.env.ADMIN_REQUIRE_ALLOWLIST = 'false';
        process.env.ADMIN_REQUIRE_FRESH_LOGIN_MINUTES = '30';
        process.env.ADMIN_ALLOWLIST_EMAILS = '';
        process.env.AUTH_DEVICE_CHALLENGE_MODE = 'off';
        process.env.PRIVILEGED_JIT_ACCESS_ENABLED = 'true';
        process.env.DUO_ENABLED = 'false';
        process.env.AUTH_REQUIRE_WEBAUTHN_FOR_ADMIN_STATE_CHANGES = 'false';

        const nowSeconds = Math.floor(Date.now() / 1000);
        const admin = loadAdminMiddleware();
        const req = {
            method: 'POST',
            user: {
                _id: 'user-1',
                isAdmin: true,
                isVerified: true,
                email: 'admin@example.com',
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
                privilegedGrants: [{
                    grantId: 'jit-grant-admin-delete',
                    permission: 'admin.users.delete',
                    status: 'approved',
                    expiresAt: new Date(Date.now() + 60_000).toISOString(),
                }],
            },
            headers: {},
            originalUrl: '/api/admin/users/507f1f77bcf86cd799439011/delete',
            get: () => '',
        };
        const next = jest.fn();

        await admin(req, {}, next);

        expect(req.authzDecision).toMatchObject({
            allowed: true,
            reason: 'jit_grant_satisfied',
            grantId: 'jit-grant-admin-delete',
            permission: 'admin.users.delete',
        });
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
    });
});
