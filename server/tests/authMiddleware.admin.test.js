const ORIGINAL_ENV = {
    NODE_ENV: process.env.NODE_ENV,
    ADMIN_STRICT_ACCESS_ENABLED: process.env.ADMIN_STRICT_ACCESS_ENABLED,
    ADMIN_REQUIRE_EMAIL_VERIFIED: process.env.ADMIN_REQUIRE_EMAIL_VERIFIED,
    ADMIN_REQUIRE_2FA: process.env.ADMIN_REQUIRE_2FA,
    ADMIN_REQUIRE_ALLOWLIST: process.env.ADMIN_REQUIRE_ALLOWLIST,
    ADMIN_REQUIRE_FRESH_LOGIN_MINUTES: process.env.ADMIN_REQUIRE_FRESH_LOGIN_MINUTES,
    ADMIN_ALLOWLIST_EMAILS: process.env.ADMIN_ALLOWLIST_EMAILS,
    AUTH_DEVICE_CHALLENGE_MODE: process.env.AUTH_DEVICE_CHALLENGE_MODE,
    AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK: process.env.AUTH_DEVICE_CHALLENGE_ALLOW_VAULT_FALLBACK,
    AUTH_VAULT_SECRET: process.env.AUTH_VAULT_SECRET,
    AUTH_VAULT_SECRET_VERSION: process.env.AUTH_VAULT_SECRET_VERSION,
};

const loadAdminMiddleware = () => {
    jest.resetModules();
    return require('../middleware/authMiddleware').admin;
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
});
