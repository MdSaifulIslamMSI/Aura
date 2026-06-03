const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'security', 'check-ssh-pqc-readiness.mjs');

describe('SSH PQC readiness checker', () => {
    test('passes repo-owned SSH evidence while allowing local OpenSSH gaps as warnings', () => {
        const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-pqc-'));
        const result = spawnSync(process.execPath, [
            scriptPath,
            '--report-dir',
            reportDir,
            '--json',
            '--markdown',
            '--allow-missing-system-tools',
        ], {
            cwd: repoRoot,
            encoding: 'utf8',
            shell: false,
            timeout: 30000,
        });

        expect(result.status).toBe(0);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'ssh-pqc-readiness.json'), 'utf8'));
        expect(report.preferredHybridKeyExchange).toContain('mlkem768x25519-sha256');
        expect(report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'repo.root-login-disabled', status: 'pass' }),
            expect.objectContaining({ id: 'repo.interactive-password-disabled', status: 'pass' }),
        ]));
    });
});
