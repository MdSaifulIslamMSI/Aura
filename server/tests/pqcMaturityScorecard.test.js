const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'security', 'pqc-maturity-scorecard.mjs');

describe('PQC maturity scorecard', () => {
    test('caps full end-to-end PQC score when providers remain unknown', () => {
        const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pqc-scorecard-test-'));
        const result = spawnSync(process.execPath, [
            scriptPath,
            '--report-dir',
            reportDir,
            '--json',
            '--markdown',
            '--strict',
            '--allow-missing-system-tools',
        ], {
            cwd: repoRoot,
            encoding: 'utf8',
            shell: false,
            timeout: 60000,
            env: {
                ...process.env,
                PQC_TLS_TARGET_URL: '',
                PQC_TLS_PROOF_MODE: 'disabled',
                PQC_SSH_PROOF_MODE: 'disabled',
                PQC_INTERNAL_EVIDENCE_MODE: 'disabled',
                PQC_BACKUP_EVIDENCE_MODE: 'disabled',
            },
        });

        expect(result.status).toBe(0);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'pqc-maturity-scorecard.json'), 'utf8'));
        const repoOwned = report.scores.find((entry) => entry.id === 'repo-owned-pqc-readiness');
        const controllable = report.scores.find((entry) => entry.id === 'controllable-surface-deployment-proof');
        const fullEndToEnd = report.scores.find((entry) => entry.id === 'full-end-to-end-pqc-coverage');

        expect(repoOwned.currentScore).toBeGreaterThan(fullEndToEnd.currentScore);
        expect(controllable.currentScore).toBeGreaterThanOrEqual(75);
        expect(fullEndToEnd.currentScore).toBeLessThanOrEqual(55);
        expect(report.providerUnknownCount).toBeGreaterThan(0);
        expect(report.limitations.join(' ')).toContain('No system is 100% quantum-proof');
    });
});
