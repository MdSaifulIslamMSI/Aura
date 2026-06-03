const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const fixtureRoot = path.join(repoRoot, 'tests', 'fixtures', 'security', 'pqc');
const inventoryScript = path.join(repoRoot, 'scripts', 'security', 'crypto-inventory.mjs');
const policyScript = path.join(repoRoot, 'scripts', 'security', 'pqc-policy-check.mjs');
const policyConfig = path.join(repoRoot, 'config', 'security', 'post-quantum-policy.json');

const runNode = (script, args) => spawnSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
});

const tempScanRoot = (fixtureName) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pqc-scan-'));
    fs.copyFileSync(path.join(fixtureRoot, fixtureName), path.join(tempDir, fixtureName));
    return tempDir;
};

const writeAllowlist = (entries) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pqc-allowlist-'));
    const allowlistPath = path.join(tempDir, 'allowlist.json');
    fs.writeFileSync(allowlistPath, JSON.stringify({ allowedFindings: entries }, null, 2));
    return allowlistPath;
};

const readInventory = (reportDir) => JSON.parse(fs.readFileSync(path.join(reportDir, 'crypto-inventory.json'), 'utf8'));

describe('PQC inventory and policy scripts', () => {
    test.each([
        ['safe-aes-gcm.js', 'AES_256_GCM', 'INFO'],
        ['safe-bcrypt.js', 'PASSWORD_HASH_BCRYPT', 'INFO'],
        ['bad-md5.js', 'MD5_USAGE', 'BLOCKER'],
        ['bad-sha1.js', 'SHA1_SIGNATURE_OR_INTEGRITY', 'BLOCKER'],
        ['bad-rsa-public-encrypt.js', 'RSA_APPLICATION_ENCRYPTION_PUBLIC', 'BLOCKER'],
        ['bad-ecdh.js', 'CUSTOM_ECDH_KEY_EXCHANGE', 'BLOCKER'],
        ['bad-tlsv1.conf', 'TLS_V1_0_ENABLED', 'BLOCKER'],
        ['warn-jwt-rs256.js', 'JWT_CLASSICAL_SIGNATURE', 'WARNING'],
    ])('classifies %s as %s %s', (fixtureName, category, severity) => {
        const scanRoot = tempScanRoot(fixtureName);
        const reportDir = path.join(scanRoot, 'reports');
        const result = runNode(inventoryScript, ['--root', scanRoot, '--report-dir', reportDir, '--json', '--markdown']);

        expect(result.status).toBe(0);
        const inventory = readInventory(reportDir);
        expect(inventory.findings).toEqual(expect.arrayContaining([
            expect.objectContaining({ file: fixtureName, category, severity }),
        ]));
    });

    test('policy fails on blocker findings', () => {
        const scanRoot = tempScanRoot('bad-md5.js');
        const reportDir = path.join(scanRoot, 'reports');
        const result = runNode(policyScript, [
            '--root',
            scanRoot,
            '--report-dir',
            reportDir,
            '--policy',
            policyConfig,
        ]);

        expect(result.status).toBe(1);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'pqc-policy-check.json'), 'utf8'));
        expect(report.failures).toEqual(expect.arrayContaining([
            expect.objectContaining({ category: 'MD5_USAGE' }),
        ]));
    });

    test('policy passes warning-only JWT findings', () => {
        const scanRoot = tempScanRoot('warn-jwt-rs256.js');
        const reportDir = path.join(scanRoot, 'reports');
        const result = runNode(policyScript, [
            '--root',
            scanRoot,
            '--report-dir',
            reportDir,
            '--policy',
            policyConfig,
        ]);

        expect(result.status).toBe(0);
    });

    test('policy passes valid allowlist entries and fails invalid allowlist entries', () => {
        const scanRoot = tempScanRoot('bad-md5.js');
        const validReportDir = path.join(scanRoot, 'valid-reports');
        const validAllowlist = writeAllowlist([
            {
                file: 'bad-md5.js',
                category: 'MD5_USAGE',
                reason: 'Legacy fixture exception for scanner policy test.',
                expires: '2026-12-31',
            },
        ]);

        const valid = runNode(policyScript, [
            '--root',
            scanRoot,
            '--report-dir',
            validReportDir,
            '--policy',
            policyConfig,
            '--allowlist',
            validAllowlist,
        ]);

        expect(valid.status).toBe(0);

        const matchScanRoot = tempScanRoot('bad-md5.js');
        const matchQualified = runNode(policyScript, [
            '--root',
            matchScanRoot,
            '--report-dir',
            path.join(matchScanRoot, 'match-qualified-reports'),
            '--policy',
            policyConfig,
            '--allowlist',
            writeAllowlist([
                {
                    file: 'bad-md5.js',
                    category: 'MD5_USAGE',
                    match: 'md5',
                    reason: 'Legacy fixture exception constrained to the reviewed match.',
                    expires: '2026-12-31',
                },
            ]),
        ]);
        expect(matchQualified.status).toBe(0);

        const wrongMatchScanRoot = tempScanRoot('bad-md5.js');
        const wrongMatch = runNode(policyScript, [
            '--root',
            wrongMatchScanRoot,
            '--report-dir',
            path.join(wrongMatchScanRoot, 'wrong-match-reports'),
            '--policy',
            policyConfig,
            '--allowlist',
            writeAllowlist([
                {
                    file: 'bad-md5.js',
                    category: 'MD5_USAGE',
                    match: 'sha1',
                    reason: 'Wrong match should not allowlist the MD5 finding.',
                    expires: '2026-12-31',
                },
            ]),
        ]);
        expect(wrongMatch.status).toBe(1);

        const expired = runNode(policyScript, [
            '--root',
            scanRoot,
            '--report-dir',
            path.join(scanRoot, 'expired-reports'),
            '--policy',
            policyConfig,
            '--allowlist',
            writeAllowlist([
                {
                    file: 'bad-md5.js',
                    category: 'MD5_USAGE',
                    reason: 'Expired legacy exception.',
                    expires: '2026-01-01',
                },
            ]),
        ]);
        expect(expired.status).toBe(1);

        const missingReason = runNode(policyScript, [
            '--root',
            scanRoot,
            '--report-dir',
            path.join(scanRoot, 'missing-reason-reports'),
            '--policy',
            policyConfig,
            '--allowlist',
            writeAllowlist([
                {
                    file: 'bad-md5.js',
                    category: 'MD5_USAGE',
                    expires: '2026-12-31',
                },
            ]),
        ]);
        expect(missingReason.status).toBe(1);

        const missingExpiry = runNode(policyScript, [
            '--root',
            scanRoot,
            '--report-dir',
            path.join(scanRoot, 'missing-expiry-reports'),
            '--policy',
            policyConfig,
            '--allowlist',
            writeAllowlist([
                {
                    file: 'bad-md5.js',
                    category: 'MD5_USAGE',
                    reason: 'Missing expiry should fail.',
                },
            ]),
        ]);
        expect(missingExpiry.status).toBe(1);
    });
});
