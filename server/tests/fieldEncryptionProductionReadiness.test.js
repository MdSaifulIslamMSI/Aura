const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Production must never silently store PII in plaintext.
 *
 * The pre-existing `assertFieldEncryptionConfig` validates configuration *given*
 * the flag, but returns early when the flag is off. These tests pin the new
 * production gate that closes that hole.
 */

const loadService = () => {
    jest.resetModules();
    return require('../services/fieldEncryptionService');
};

const STRONG_MASTER = 'local-master-key-for-readiness-tests-0123456789';

describe('fieldEncryption production readiness', () => {
    const originalEnv = { ...process.env };

    const clearCryptoEnv = () => {
        delete process.env.FIELD_ENCRYPTION_ENABLED;
        delete process.env.FIELD_ENCRYPTION_KMS_KEY_ID;
        delete process.env.FIELD_ENCRYPTION_MASTER_KEY;
        delete process.env.FIELD_ENCRYPTION_KEY_VERSION;
        delete process.env.FIELD_ENCRYPTION_PREVIOUS_KEYS;
        delete process.env.ALLOW_PLAINTEXT_AT_REST_IN_PRODUCTION;
    };

    afterEach(() => {
        process.env = { ...originalEnv };
        clearCryptoEnv();
    });

    describe('getFieldEncryptionStatus', () => {
        test('reports disabled when the flag is off (dev)', () => {
            process.env.NODE_ENV = 'development';
            clearCryptoEnv();
            const svc = loadService();

            const status = svc.getFieldEncryptionStatus();
            expect(status.enabled).toBe(false);
            expect(status.mode).toBe('disabled');
            expect(status.plaintextAtRest).toBe(true);
            expect(status.acknowledgedPlaintextAtRest).toBe(false);
        });

        test('reports kms mode when a KMS key id is configured', () => {
            process.env.NODE_ENV = 'production';
            clearCryptoEnv();
            process.env.FIELD_ENCRYPTION_ENABLED = 'true';
            process.env.FIELD_ENCRYPTION_KMS_KEY_ID = 'arn:aws:kms:us-east-1:111:key/abc';
            const svc = loadService();

            const status = svc.getFieldEncryptionStatus();
            expect(status.enabled).toBe(true);
            expect(status.mode).toBe('kms');
            expect(status.provider).toBe('kms');
            expect(status.plaintextAtRest).toBe(false);
        });

        test('reports local mode with a local master key outside production', () => {
            process.env.NODE_ENV = 'development';
            clearCryptoEnv();
            process.env.FIELD_ENCRYPTION_ENABLED = 'true';
            process.env.FIELD_ENCRYPTION_MASTER_KEY = STRONG_MASTER;
            const svc = loadService();

            const status = svc.getFieldEncryptionStatus();
            expect(status.mode).toBe('local');
            expect(status.provider).toBe('local');
        });

        test('marks plaintext at rest as acknowledged only with the explicit override', () => {
            process.env.NODE_ENV = 'production';
            clearCryptoEnv();

            const withoutOverride = loadService().getFieldEncryptionStatus();
            expect(withoutOverride.mode).toBe('disabled');
            expect(withoutOverride.acknowledgedPlaintextAtRest).toBe(false);

            process.env.ALLOW_PLAINTEXT_AT_REST_IN_PRODUCTION = 'true';
            const withOverride = loadService().getFieldEncryptionStatus();
            expect(withOverride.mode).toBe('disabled_acknowledged');
            expect(withOverride.acknowledgedPlaintextAtRest).toBe(true);
        });
    });

    describe('assertFieldEncryptionProductionReadiness', () => {
        test('throws in production when encryption is disabled and unacknowledged', () => {
            process.env.NODE_ENV = 'production';
            clearCryptoEnv();

            expect(() => loadService().assertFieldEncryptionProductionReadiness())
                .toThrow(/refuses to start with encryption at rest disabled/);
        });

        test('error message names both the fix and the escape hatch', () => {
            process.env.NODE_ENV = 'production';
            clearCryptoEnv();

            expect(() => loadService().assertFieldEncryptionProductionReadiness()).toThrow(
                /FIELD_ENCRYPTION_KMS_KEY_ID[\s\S]*ALLOW_PLAINTEXT_AT_REST_IN_PRODUCTION/
            );
        });

        test('does not throw when the override is explicitly set', () => {
            process.env.NODE_ENV = 'production';
            clearCryptoEnv();
            process.env.ALLOW_PLAINTEXT_AT_REST_IN_PRODUCTION = 'true';

            const svc = loadService();
            expect(() => svc.assertFieldEncryptionProductionReadiness()).not.toThrow();
            expect(svc.assertFieldEncryptionProductionReadiness().acknowledgedPlaintextAtRest).toBe(true);
        });

        test('does not throw when encryption is properly enabled with KMS', () => {
            process.env.NODE_ENV = 'production';
            clearCryptoEnv();
            process.env.FIELD_ENCRYPTION_ENABLED = 'true';
            process.env.FIELD_ENCRYPTION_KMS_KEY_ID = 'arn:aws:kms:us-east-1:111:key/abc';

            const status = loadService().assertFieldEncryptionProductionReadiness();
            expect(status.enabled).toBe(true);
            expect(status.plaintextAtRest).toBe(false);
        });

        test('is inert outside production even with nothing configured', () => {
            process.env.NODE_ENV = 'development';
            clearCryptoEnv();

            expect(() => loadService().assertFieldEncryptionProductionReadiness()).not.toThrow();
        });

        test('is inert in test even with nothing configured', () => {
            process.env.NODE_ENV = 'test';
            clearCryptoEnv();

            expect(() => loadService().assertFieldEncryptionProductionReadiness()).not.toThrow();
        });
    });
});
