const {
    ADMIN_SECURITY_STATES,
    resolveAdminSecurityState,
} = require('../services/adminSecurityStateService');

const now = Date.now();
const env = {
    NODE_ENV: 'test',
    ADMIN_SECURITY_STATE_ENGINE_V2: 'true',
    ADMIN_PASSKEY_ENROLLMENT: 'true',
    ADMIN_PASSKEY_CHALLENGE: 'true',
    ADMIN_RECOVERY_GRANTS: 'true',
    ADMIN_ASSURANCE_ENFORCEMENT: 'true',
    ADMIN_SECURITY_HASH_SECRET: 'a8F4q2L9v7X3m6K1p5R0t8W2z4N7c9B6Y1D3',
    ADMIN_REQUIRE_ALLOWLIST: 'true',
    ADMIN_ALLOWLIST_EMAILS: 'owner@example.com',
    MFA_ENABLED: 'true',
    MFA_PASSKEY_ENABLED: 'true',
    AUTH_WEBAUTHN_RP_ID: 'localhost',
    AUTH_WEBAUTHN_ORIGIN: 'http://localhost:5173',
    AUTH_WEBAUTHN_USER_VERIFICATION: 'required',
};

const passkey = {
    deviceId: 'device-admin-1234',
    method: 'webauthn',
    credentialScope: 'admin',
    adminEligibility: 'verified',
    webauthnCredentialIdBase64Url: 'credential-id',
    webauthnUserVerification: 'required',
    webauthnUserVerified: true,
    webauthnUserVerifiedAt: new Date(now - 1000),
    revokedAt: null,
    expiresAt: null,
};

const user = {
    _id: '507f1f77bcf86cd799439011',
    email: 'owner@example.com',
    isAdmin: true,
    isVerified: true,
    accountState: 'active',
    softDeleted: false,
    trustedDevices: [],
};

const request = (overrides = {}) => ({
    user,
    authIdentity: { emailVerified: true },
    authToken: { auth_time: Math.floor(now / 1000) },
    authSession: {
        sessionId: 'session-1',
        authTimeSeconds: Math.floor(now / 1000),
        amr: [],
    },
    ...overrides,
});

describe('admin security state engine', () => {
    test('requires supervised recovery when no approved admin factor exists', () => {
        const result = resolveAdminSecurityState({ req: request(), user, env, now });
        expect(result.state).toBe(ADMIN_SECURITY_STATES.ADMIN_RECOVERY_REQUIRED);
        expect(result.actions.allowAdminAccess).toBe(false);
    });

    test('allows enrollment only after a session-bound recovery authority exists', () => {
        const result = resolveAdminSecurityState({
            req: request(),
            user,
            env,
            now,
            recoveryAuthorityActive: true,
        });
        expect(result.state).toBe(ADMIN_SECURITY_STATES.ADMIN_ENROLLMENT_REQUIRED);
        expect(result.actions.canEnrollPasskey).toBe(true);
    });

    test('requires a challenge when an approved factor exists without fresh proof', () => {
        const factorUser = { ...user, trustedDevices: [passkey] };
        const result = resolveAdminSecurityState({ req: request({ user: factorUser }), user: factorUser, env, now });
        expect(result.state).toBe(ADMIN_SECURITY_STATES.ADMIN_CHALLENGE_REQUIRED);
    });

    test('accepts only a current session-bound approved passkey assurance', () => {
        const factorUser = { ...user, trustedDevices: [passkey] };
        const req = request({
            user: factorUser,
            authSession: {
                sessionId: 'session-1',
                authTimeSeconds: Math.floor(now / 1000),
                deviceId: passkey.deviceId,
                amr: ['mfa', 'webauthn', 'passkey'],
                webAuthnStepUpUntil: new Date(now + 60_000).toISOString(),
            },
        });
        const result = resolveAdminSecurityState({ req, user: factorUser, env, now });
        expect(result.state).toBe(ADMIN_SECURITY_STATES.ADMIN_VERIFIED);
        expect(result.adminSecurity.passkeyAssuranceActive).toBe(true);
    });

    test('does not treat a general TOTP AMR as admin verification', () => {
        const req = request({
            authSession: {
                sessionId: 'session-1',
                authTimeSeconds: Math.floor(now / 1000),
                amr: ['mfa', 'totp'],
                stepUpUntil: new Date(now + 60_000).toISOString(),
            },
        });
        const result = resolveAdminSecurityState({ req, user, env, now });
        expect(result.state).toBe(ADMIN_SECURITY_STATES.ADMIN_RECOVERY_REQUIRED);
        expect(result.verified).toBe(false);
    });

    test('does not let Duo substitute for the required admin passkey policy', () => {
        const req = request({
            authSession: {
                sessionId: 'session-1',
                authTimeSeconds: Math.floor(now / 1000),
                amr: ['mfa', 'duo'],
                stepUpUntil: new Date(now + 60_000).toISOString(),
            },
        });
        const duoEnv = {
            ...env,
            ADMIN_REQUIRE_PASSKEY: 'true',
            ADMIN_DUO_PROVIDER: 'true',
            DUO_ENABLED: 'true',
            DUO_CLIENT_ID: 'client-id',
            DUO_CLIENT_SECRET: 'client-secret',
            DUO_API_HOST: 'api.example.duosecurity.com',
            DUO_REDIRECT_URI: 'http://localhost:5173/auth/duo/callback',
        };
        const result = resolveAdminSecurityState({ req, user, env: duoEnv, now });
        expect(result.state).toBe(ADMIN_SECURITY_STATES.ADMIN_RECOVERY_REQUIRED);
        expect(result.verified).toBe(false);
    });

    test('requires fresh primary authentication before recovery or challenge', () => {
        const req = request({
            authToken: { auth_time: Math.floor((now - (20 * 60_000)) / 1000) },
            authSession: {
                sessionId: 'session-1',
                authTimeSeconds: Math.floor((now - (20 * 60_000)) / 1000),
                amr: [],
            },
        });
        const result = resolveAdminSecurityState({ req, user, env, now });
        expect(result.state).toBe(ADMIN_SECURITY_STATES.PRIMARY_REAUTH_REQUIRED);
    });
});
