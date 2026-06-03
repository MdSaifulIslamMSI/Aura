const fs = require('fs');
const os = require('os');
const path = require('path');

describe('expanded PQC config', () => {
    const writePolicy = (overrides = {}) => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pqc-config-'));
        const policyPath = path.join(tempDir, 'policy.json');
        const base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'security', 'post-quantum-policy.json'), 'utf8'));
        fs.writeFileSync(policyPath, JSON.stringify({ ...base, ...overrides }, null, 2));
        return policyPath;
    };

    test('requires deploymentProof controls to be boolean', () => {
        const { loadCryptoPolicy } = require('../config/cryptoPolicy');
        const policyPath = writePolicy({
            deploymentProof: {
                sshHybridKexPreferred: 'yes',
                tls13RequiredWhereAppControlled: true,
                openssl35NativePqcPreferred: true,
                oqsProviderLabOnly: true,
                providerControlledSurfacesTracked: true,
            },
        });

        expect(() => loadCryptoPolicy({ policyPath })).toThrow('deploymentProof.sshHybridKexPreferred');
    });

    test('requires controlled surface statuses to be present', () => {
        const { loadCryptoPolicy } = require('../config/cryptoPolicy');
        const policyPath = writePolicy({
            controlledSurfaces: {
                ssh: 'hybrid-pqc-ready',
            },
        });

        expect(() => loadCryptoPolicy({ policyPath })).toThrow('controlledSurfaces.tlsEdge');
    });
});
