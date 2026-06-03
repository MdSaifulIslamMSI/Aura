const fs = require('fs');
const os = require('os');
const path = require('path');

describe('cryptoPolicy config', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        jest.resetModules();
    });

    test('loads the repository PQC policy without changing runtime behavior', () => {
        process.env.NODE_ENV = 'test';
        const { loadCryptoPolicy } = require('../config/cryptoPolicy');

        const policy = loadCryptoPolicy();

        expect(policy.minimumTlsVersion).toBe('TLSv1.3');
        expect(policy.preferredHybridKeyExchange).toContain('mlkem768x25519-sha256');
        expect(policy.allowedSymmetricCrypto).toContain('AES-256-GCM');
        expect(policy.allowedPasswordHashing).toContain('bcrypt');
    });

    test('throws on malformed policy in test mode', () => {
        process.env.NODE_ENV = 'test';
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pqc-policy-'));
        const policyPath = path.join(tempDir, 'bad-policy.json');
        fs.writeFileSync(policyPath, JSON.stringify({ minimumTlsVersion: 'TLSv1.2' }));
        const { loadCryptoPolicy } = require('../config/cryptoPolicy');

        expect(() => loadCryptoPolicy({ policyPath })).toThrow('policyVersion');
    });

    test('logs and returns safe fallback in production when policy cannot load', () => {
        process.env.NODE_ENV = 'production';
        const logger = { warn: jest.fn() };
        const { loadCryptoPolicy } = require('../config/cryptoPolicy');

        const policy = loadCryptoPolicy({
            policyPath: path.join(os.tmpdir(), 'missing-pqc-policy.json'),
            logger,
        });

        expect(policy.minimumTlsVersion).toBe('TLSv1.3');
        expect(logger.warn).toHaveBeenCalledWith('crypto_policy.load_failed', expect.any(Object));
    });
});
