const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'scripts', 'security', 'crypto-format-audit.mjs');

const runAudit = (root) => spawnSync(process.execPath, [auditScript, '--root', root], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    timeout: 60000,
});

// A throwaway repo root containing only what the audit needs.
const makeTempRoot = (registry, extraFiles = {}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-format-audit-'));
    const configDir = path.join(root, 'config', 'security');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
        path.join(configDir, 'crypto-format-registry.json'),
        typeof registry === 'string' ? registry : JSON.stringify(registry)
    );
    for (const [relative, content] of Object.entries(extraFiles)) {
        const target = path.join(root, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
    return root;
};

const baseFormat = {
    id: 'test.format',
    purpose: 'test',
    status: 'ACTIVE',
    implementation: 'server/services/present.js',
};

describe('crypto format lifecycle audit', () => {
    const tempRoots = [];
    const track = (root) => {
        tempRoots.push(root);
        return root;
    };

    afterAll(() => {
        for (const root of tempRoots) {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('the real repository passes', () => {
        const result = runAudit(repoRoot);
        const report = JSON.parse(
            fs.readFileSync(path.join(repoRoot, 'reports', 'security', 'crypto-format-audit.json'), 'utf8')
        );

        expect(result.status).toBe(0);
        expect(report.status).toBe('pass');
        expect(report.summary.blockers).toBe(0);
    });

    test('registers every legacy KDF the audit can find in production code', () => {
        const report = JSON.parse(
            fs.readFileSync(path.join(repoRoot, 'reports', 'security', 'crypto-format-audit.json'), 'utf8')
        );
        const registered = new Set(report.findings
            .filter((f) => f.code === 'legacy_site_declared')
            .map((f) => f.evidence.file));

        // The frozen derivations the detector must see and the registry must cover.
        // authProfileVault is deliberately absent: its scryptSync call is
        // pinned (four-argument), so it is not a default-cost site. Its legacy
        // fixed-salt risk is handled by rekey-on-read instead.
        for (const expected of [
            'server/services/fieldEncryptionService.js',
            'server/services/trustedDeviceChallengeService.js',
            'server/utils/otpFlowToken.js',
            'scripts/production/backup-archive-crypto.js',
        ]) {
            expect(registered.has(expected)).toBe(true);
        }
    });

    test('fails when a legacy format has no retirement route', () => {
        const root = track(makeTempRoot({
            formats: [{ ...baseFormat, status: 'LEGACY_READ', evidence: baseFormat.implementation }],
        }, { 'server/services/present.js': 'module.exports = 1;\n' }));

        const result = runAudit(root);
        const report = JSON.parse(
            fs.readFileSync(path.join(root, 'reports', 'security', 'crypto-format-audit.json'), 'utf8')
        );
        expect(result.status).toBe(1);
        expect(report.findings.map((f) => f.code)).toEqual(
            expect.arrayContaining(['legacy_no_retire_date', 'legacy_no_migration_trigger'])
        );
    });

    test('fails when a format points at evidence that does not exist', () => {
        const root = track(makeTempRoot({
            formats: [{ ...baseFormat, evidence: 'server/services/does-not-exist.js' }],
        }));

        const result = runAudit(root);
        expect(result.status).toBe(1);
    });

    test('fails on an unregistered fixed-salt scrypt in production code', () => {
        // The exact shape behind three separate findings: a literal salt and no
        // cost params, so Node's default N=16384 applies silently.
        const root = track(makeTempRoot(
            { formats: [baseFormat] },
            {
                'server/services/present.js': 'module.exports = 1;\n',
                'server/services/sneaky.js': [
                    "const crypto = require('crypto');",
                    "const derive = (s) => crypto.scryptSync(String(s || ''), 'aura-fixed-salt', 32);",
                    'module.exports = { derive };',
                ].join('\n'),
            }
        ));

        const result = runAudit(root);
        const report = JSON.parse(
            fs.readFileSync(path.join(root, 'reports', 'security', 'crypto-format-audit.json'), 'utf8')
        );
        expect(result.status).toBe(1);
        const blocker = report.findings.find((f) => f.code === 'unregistered_legacy_kdf');
        expect(blocker).toBeTruthy();
        expect(blocker.evidence.file).toBe('server/services/sneaky.js');
    });

    test('catches a multi-line bare-SHA256 key derivation', () => {
        // Per-line scanning cannot see this shape; it is exactly how
        // server/utils/otpFlowToken.js derives its legacy key.
        const root = track(makeTempRoot(
            { formats: [baseFormat] },
            {
                'server/services/present.js': 'module.exports = 1;\n',
                'server/services/multiline.js': [
                    "const crypto = require('crypto');",
                    "const derive = () => crypto.createHash('sha256')",
                    '    .update(`${process.env.SOME_SECRET}:aura-context`)',
                    "    .digest();",
                    'module.exports = { derive };',
                ].join('\n'),
            }
        ));

        const result = runAudit(root);
        expect(result.status).toBe(1);
    });

    test('does not flag a truncated digest used as an identifier', () => {
        // A keyFingerprint is not key material. Flagging it would train
        // reviewers to ignore the audit.
        const root = track(makeTempRoot(
            { formats: [baseFormat] },
            {
                'server/services/present.js': 'module.exports = 1;\n',
                'server/services/fingerprint.js': [
                    "const crypto = require('crypto');",
                    "const key = process.env.SOME_SECRET;",
                    "const keyFingerprint = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);",
                    'module.exports = { keyFingerprint };',
                ].join('\n'),
            }
        ));

        const result = runAudit(root);
        expect(result.status).toBe(0);
    });

    test('does not scan tests or fixtures for legacy KDF sites', () => {
        const root = track(makeTempRoot(
            { formats: [baseFormat] },
            {
                'server/services/present.js': 'module.exports = 1;\n',
                'server/tests/legacy.test.js': [
                    "const crypto = require('crypto');",
                    "const k = crypto.scryptSync('s', 'aura-salt', 32);",
                ].join('\n'),
                'tests/fixtures/legacy.js': "const crypto = require('crypto');\nconst k = crypto.scryptSync('s', 'aura-salt', 32);\n",
            }
        ));

        const result = runAudit(root);
        expect(result.status).toBe(0);
    });

    test('a registered file with a Frozen marker is accepted', () => {
        const root = track(makeTempRoot(
            {
                formats: [{
                    ...baseFormat,
                    id: 'legacy.format',
                    status: 'LEGACY_READ',
                    implementation: 'server/services/legacy.js',
                    evidence: 'server/services/legacy.js',
                    retireAfter: '2027-01-01',
                    migrationTrigger: 'deleted after one TTL elapses',
                }],
            },
            {
                'server/services/legacy.js': [
                    "const crypto = require('crypto');",
                    "// Frozen: reproduces the pre-migration derivation for reads only.",
                    "const derive = () => crypto.scryptSync('s', 'aura-fixed-salt', 32);",
                    'module.exports = { derive };',
                ].join('\n'),
            }
        ));

        const result = runAudit(root);
        const report = JSON.parse(
            fs.readFileSync(path.join(root, 'reports', 'security', 'crypto-format-audit.json'), 'utf8')
        );
        expect(result.status).toBe(0);
        expect(report.findings.some((f) => f.code === 'legacy_site_declared')).toBe(true);
    });
});