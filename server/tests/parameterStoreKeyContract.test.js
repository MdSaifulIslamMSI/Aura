const {
    DEFAULT_AWS_PARAMETER_KEYS,
    __testables,
} = require('../config/runtimeConfig');

const resolveParameterStoreSecretKeys = __testables.resolveParameterStoreSecretKeys;

/**
 * Guards against the drift that made encryption-at-rest silently inert.
 *
 * `FIELD_ENCRYPTION_ENABLED`, `FIELD_ENCRYPTION_KMS_KEY_ID` and
 * `SECURITY_LOG_HASH_KEY` all existed in `/aura/prod`, but were missing from
 * DEFAULT_AWS_PARAMETER_KEYS. The loader iterates that list, so production ran
 * with the in-code defaults: encryption off, and log pseudonymisation falling
 * back to a shared secret. The values were configured; the app never read them.
 */

// Every variable the crypto startup assertions require at boot. If one is added
// to an assert*Config() gate, it belongs here too.
const BOOT_CRITICAL_KEYS = Object.freeze([
    'FIELD_ENCRYPTION_ENABLED',
    'FIELD_ENCRYPTION_KMS_KEY_ID',
    'FIELD_ENCRYPTION_MASTER_KEY',
    'FIELD_ENCRYPTION_KEY_VERSION',
    'FIELD_ENCRYPTION_PREVIOUS_KEYS',
    'SECURITY_LOG_HASH_KEY',
    'PHONE_BLIND_INDEX_SECRET',
    'EMAIL_BLIND_INDEX_SECRET',
    'OTP_HASH_SECRET',
    'AUTH_RECOVERY_CODE_SECRET',
    'OTP_FLOW_SECRET',
    'MFA_SECRET_ENCRYPTION_KEY',
    'AUTH_VAULT_SECRET',
    'AUTH_VAULT_PREVIOUS_SECRETS',
]);

describe('Parameter Store key contract', () => {
    test('the key list has no duplicates', () => {
        expect(new Set(DEFAULT_AWS_PARAMETER_KEYS).size).toBe(DEFAULT_AWS_PARAMETER_KEYS.length);
    });

    test('every boot-critical crypto key is loadable from Parameter Store', () => {
        const missing = BOOT_CRITICAL_KEYS.filter((key) => !DEFAULT_AWS_PARAMETER_KEYS.includes(key));
        expect(missing).toEqual([]);
    });

    test('field encryption enablement and key id are loadable', () => {
        // The exact regression: these were configured in SSM but never read.
        expect(DEFAULT_AWS_PARAMETER_KEYS).toContain('FIELD_ENCRYPTION_ENABLED');
        expect(DEFAULT_AWS_PARAMETER_KEYS).toContain('FIELD_ENCRYPTION_KMS_KEY_ID');
    });

    test('the log pseudonymisation key is loadable', () => {
        // Without this, redactSecurityMetadata falls back to a shared secret.
        expect(DEFAULT_AWS_PARAMETER_KEYS).toContain('SECURITY_LOG_HASH_KEY');
    });

    test('extra keys from AWS_PARAMETER_STORE_SECRET_KEYS are unioned in', () => {
        const previous = process.env.AWS_PARAMETER_STORE_SECRET_KEYS;
        try {
            process.env.AWS_PARAMETER_STORE_SECRET_KEYS = 'SOME_EXTRA_KEY,ANOTHER_ONE';
            const keys = resolveParameterStoreSecretKeys();
            expect(keys).toContain('SOME_EXTRA_KEY');
            expect(keys).toContain('ANOTHER_ONE');
            // Defaults are preserved, not replaced.
            expect(keys).toContain('MONGO_URI');
        } finally {
            if (previous === undefined) delete process.env.AWS_PARAMETER_STORE_SECRET_KEYS;
            else process.env.AWS_PARAMETER_STORE_SECRET_KEYS = previous;
        }
    });

    test('the override does not introduce duplicates', () => {
        const previous = process.env.AWS_PARAMETER_STORE_SECRET_KEYS;
        try {
            process.env.AWS_PARAMETER_STORE_SECRET_KEYS = 'MONGO_URI,REDIS_URL';
            const keys = resolveParameterStoreSecretKeys();
            expect(new Set(keys).size).toBe(keys.length);
        } finally {
            if (previous === undefined) delete process.env.AWS_PARAMETER_STORE_SECRET_KEYS;
            else process.env.AWS_PARAMETER_STORE_SECRET_KEYS = previous;
        }
    });
});
