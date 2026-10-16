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
        expect(policy.deploymentProof).toMatchObject({
            sshHybridKexPreferred: true,
            tls13RequiredWhereAppControlled: true,
            oqsProviderLabOnly: true,
            providerControlledSurfacesTracked: true,
        });
        expect(policy.controlledSurfaces).toMatchObject({
            ssh: 'hybrid-pqc-ready',
            tlsEdge: 'tls13-hardened-provider-dependent-pqc',
            backups: 'symmetric-strong-key-agility',
        });
    });

    test('keeps the required edge policy strict despite an unsafe measured floor', () => {
        const root = path.resolve(__dirname, '..', '..');
        const posture = JSON.parse(fs.readFileSync(path.join(root, 'config', 'security', 'tls-edge-posture.json'), 'utf8'));
        expect(posture.requirements).toMatchObject({ rejectLegacyTls: true, requireTls13Available: true });
        expect(posture.edges.find((edge) => edge.provider === 'AWS CloudFront').minExpected).toBe('TLSv1.2');
    });

    test('CloudFront bootstrap uses origin protocol enums rather than viewer policy names', () => {
        const root = path.resolve(__dirname, '..', '..');
        const bootstrap = fs.readFileSync(path.join(root, 'infra', 'aws', 'bootstrap-frontend-cloudfront.ps1'), 'utf8');
        const origins = bootstrap.match(/OriginSslProtocols\s*=\s*@\{\s*Quantity\s*=\s*1\s*Items\s*=\s*@\("TLSv1\.2"\)\s*\}/g);
        expect(origins).toHaveLength(2);
        expect(bootstrap).not.toContain('TLSv1.3_2021');
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
        expect(policy.deploymentProof.tls13RequiredWhereAppControlled).toBe(true);
        expect(logger.warn).toHaveBeenCalledWith('crypto_policy.load_failed', expect.any(Object));
    });
});
