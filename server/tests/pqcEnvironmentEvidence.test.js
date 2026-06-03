const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');

const runNodeScript = (scriptRelativePath, args = [], options = {}) => spawnSync(
    process.execPath,
    [path.join(repoRoot, scriptRelativePath), ...args],
    {
        cwd: repoRoot,
        encoding: 'utf8',
        shell: false,
        timeout: options.timeout || 30000,
        env: { ...process.env, ...(options.env || {}) },
    },
);

describe('PQC environment evidence scripts', () => {
    test('TLS endpoint checker records disabled mode without opening a live target', () => {
        const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-endpoint-evidence-'));
        const result = runNodeScript('scripts/security/tls-endpoint-pqc-readiness.mjs', [
            '--report-dir',
            reportDir,
            '--json',
            '--markdown',
        ], {
            env: {
                PQC_TLS_TARGET_URL: '',
                PQC_TLS_PROOF_MODE: 'disabled',
            },
        });

        expect(result.status).toBe(0);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'tls-endpoint-pqc-readiness.json'), 'utf8'));
        expect(report.status).toBe('pass');
        expect(report.mode).toBe('disabled');
        expect(report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'tls.endpoint.handshake', status: 'skipped' }),
            expect.objectContaining({ id: 'tls.endpoint.legacy-protocol-rejection', status: 'skipped' }),
        ]));
    });

    test('internal service evidence redacts runtime connection strings', () => {
        const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'internal-evidence-'));
        const result = runNodeScript('scripts/security/internal-service-encryption-check.mjs', [
            '--report-dir',
            reportDir,
            '--json',
            '--markdown',
        ], {
            env: {
                PQC_INTERNAL_EVIDENCE_MODE: 'staging',
                DATABASE_URL: 'mongodb+srv://user:pass@prod-db.example.invalid/aura?tls=true',
                REDIS_URL: 'rediss://:secret@prod-redis.example.invalid:6380',
            },
        });

        expect(result.status).toBe(0);
        const rawReport = fs.readFileSync(path.join(reportDir, 'internal-service-encryption-evidence.json'), 'utf8');
        expect(rawReport).not.toContain('prod-db.example.invalid');
        expect(rawReport).not.toContain('prod-redis.example.invalid');
        expect(rawReport).not.toContain('secret');
        const report = JSON.parse(rawReport);
        expect(report.sanitizedConnectionShapes).toEqual(expect.objectContaining({
            database: 'mongodb+srv://[redacted]',
            redis: 'rediss://[redacted]',
        }));
    });
});
