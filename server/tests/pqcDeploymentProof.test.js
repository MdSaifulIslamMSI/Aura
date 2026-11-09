const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'security', 'pqc-deployment-proof.mjs');

const runScript = (args, options = {}) => spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    timeout: options.timeout || 60000,
});

describe('PQC deployment proof script', () => {
    test('generates JSON and Markdown reports without requiring local PQC system tools', () => {
        const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pqc-proof-'));
        const result = runScript(['--report-dir', reportDir, '--json', '--markdown', '--allow-missing-system-tools']);

        expect(result.status).toBe(0);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'pqc-deployment-proof.json'), 'utf8'));
        expect(report.status).toBe('pass');
        expect(report.limitations).toEqual(expect.arrayContaining([
            expect.stringContaining('No system is 100% quantum-proof'),
        ]));
        expect(fs.existsSync(path.join(reportDir, 'pqc-deployment-proof.md'))).toBe(true);
        expect(fs.existsSync(path.join(reportDir, 'ssh-pqc-readiness.json'))).toBe(true);
        expect(fs.existsSync(path.join(reportDir, 'ssh-pqc-environment-proof.json'))).toBe(true);
        expect(fs.existsSync(path.join(reportDir, 'tls-config-readiness.json'))).toBe(true);
        expect(fs.existsSync(path.join(reportDir, 'tls-endpoint-pqc-readiness.json'))).toBe(true);
        expect(fs.existsSync(path.join(reportDir, 'pqc-lab-benchmark.json'))).toBe(true);
        expect(fs.existsSync(path.join(reportDir, 'internal-service-encryption-evidence.json'))).toBe(true);
        expect(fs.existsSync(path.join(reportDir, 'backup-pqc-encryption-evidence.json'))).toBe(true);
        expect(fs.existsSync(path.join(reportDir, 'release-signing-readiness.json'))).toBe(true);
        expect(fs.existsSync(path.join(reportDir, 'pqc-provider-register-check.json'))).toBe(true);
    });

    test('strict mode fails missing repo-owned artifacts', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pqc-proof-empty-root-'));
        const reportDir = path.join(tempRoot, 'reports');
        const result = runScript([
            '--root',
            tempRoot,
            '--report-dir',
            reportDir,
            '--json',
            '--markdown',
            '--strict',
            '--allow-missing-system-tools',
        ]);

        expect(result.status).toBe(1);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'pqc-deployment-proof.json'), 'utf8'));
        expect(report.status).toBe('fail');
        expect(report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'repo.pqc-policy.exists', status: 'fail' }),
        ]));
    });
});
