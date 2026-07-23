const {
    resolveAdminSecurityConfig,
    validateAdminSecurityConfig,
} = require('../config/adminSecurityConfig');

const validPasskeyEnv = {
    NODE_ENV: 'production',
    ADMIN_SECURITY_STATE_ENGINE_V2: 'true',
    ADMIN_PASSKEY_ENROLLMENT: 'true',
    ADMIN_PASSKEY_CHALLENGE: 'true',
    ADMIN_RECOVERY_GRANTS: 'true',
    ADMIN_ASSURANCE_ENFORCEMENT: 'true',
    ADMIN_SECURITY_HASH_SECRET: 'a8F4q2L9v7X3m6K1p5R0t8W2z4N7c9B6Y1D3',
    AUTH_SESSION_ALLOW_MEMORY_FALLBACK: 'false',
    MFA_ENABLED: 'true',
    MFA_PASSKEY_ENABLED: 'true',
    AUTH_WEBAUTHN_RP_ID: 'aurapilot.vercel.app',
    AUTH_WEBAUTHN_ORIGIN: 'https://aurapilot.vercel.app',
    AUTH_WEBAUTHN_USER_VERIFICATION: 'required',
};

describe('admin security configuration', () => {
    test('keeps new recovery surfaces disabled by default', () => {
        const config = resolveAdminSecurityConfig({ NODE_ENV: 'test' });
        expect(config.stateEngineV2).toBe(false);
        expect(config.recoveryGrants).toBe(false);
        expect(config.passkeyEnrollment).toBe(false);
    });

    test('accepts a production fail-closed recovery contract', () => {
        const result = validateAdminSecurityConfig({ env: validPasskeyEnv });
        expect(result.safe).toBe(true);
        expect(result.failures).toEqual([]);
    });

    test('rejects recovery without a dedicated strong hashing secret', () => {
        const result = validateAdminSecurityConfig({
            env: { ...validPasskeyEnv, ADMIN_SECURITY_HASH_SECRET: '' },
        });
        expect(result.safe).toBe(false);
        expect(result.failures.join(' ')).toMatch(/ADMIN_SECURITY_HASH_SECRET/);
    });

    test('rejects disabled production assurance enforcement', () => {
        const result = validateAdminSecurityConfig({
            env: { ...validPasskeyEnv, ADMIN_ASSURANCE_ENFORCEMENT: 'false' },
        });
        expect(result.safe).toBe(false);
        expect(result.failures.join(' ')).toMatch(/cannot be disabled/);
    });

    test('rejects non-required WebAuthn user verification', () => {
        const result = validateAdminSecurityConfig({
            env: { ...validPasskeyEnv, AUTH_WEBAUTHN_USER_VERIFICATION: 'preferred' },
        });
        expect(result.safe).toBe(false);
        expect(result.failures.join(' ')).toMatch(/USER_VERIFICATION/);
    });
});
