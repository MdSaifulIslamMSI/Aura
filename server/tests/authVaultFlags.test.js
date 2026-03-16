describe('authVaultFlags', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...ORIGINAL_ENV };
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    test('throws outside test env when secret missing', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.AUTH_VAULT_SECRET;

        const { assertAuthVaultConfig } = require('../config/authVaultFlags');
        expect(() => assertAuthVaultConfig()).toThrow(/AUTH_VAULT_SECRET is required/);
    });

    test('throws in production when secret is weak', () => {
        process.env.NODE_ENV = 'production';
        process.env.AUTH_VAULT_SECRET = 'default-secret';

        const { assertAuthVaultConfig } = require('../config/authVaultFlags');
        expect(() => assertAuthVaultConfig()).toThrow(/must be at least 32 chars/);
    });

    test('passes in production when secret is strong', () => {
        process.env.NODE_ENV = 'production';
        process.env.AUTH_VAULT_SECRET = 'A9f1!4x2q7m8r0p3k5n6t9u2w4y7z8b1';

        const { assertAuthVaultConfig } = require('../config/authVaultFlags');
        expect(() => assertAuthVaultConfig()).not.toThrow();
    });
});
