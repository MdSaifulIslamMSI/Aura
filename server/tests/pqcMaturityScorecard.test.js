const fs = require('fs');
const path = require('path');
const {
    cleanupReportDir,
    createReportDir,
    runSecurityScript,
} = require('./helpers/securityScriptRunner');

describe('PQC maturity scorecard', () => {
    let reportDir;

    beforeEach(() => { reportDir = createReportDir('pqc-scorecard-test'); });
    afterEach(() => cleanupReportDir(reportDir));

    const runScript = (args = []) => runSecurityScript('scripts/security/pqc-maturity-scorecard.mjs', [
        '--report-dir', reportDir, '--json', '--markdown', '--strict', '--allow-missing-system-tools',
        ...args,
    ], {
        timeout: 60000,
        env: {
            PQC_ENV_PROOF_MODE: 'disabled',
            PQC_REAL_TARGET_PROOF_MODE: 'disabled',
            PQC_TLS_TARGET_URL: '',
            PQC_TLS_PROOF_MODE: 'disabled',
            PQC_SSH_PROOF_MODE: 'disabled',
            PQC_INTERNAL_EVIDENCE_MODE: 'disabled',
            PQC_BACKUP_EVIDENCE_MODE: 'disabled',
            DRY_RUN: 'true',
        },
    });

    test('caps full end-to-end PQC score when providers remain unknown under supported TLS', () => {
        const configPath = path.join(reportDir, 'modern-edge.json');
        fs.writeFileSync(configPath, JSON.stringify({
            ViewerCertificate: {
                CloudFrontDefaultCertificate: false,
                IAMCertificateId: 'test-certificate',
                SSLSupportMethod: 'sni-only',
                MinimumProtocolVersion: 'TLSv1.3_2025',
            },
        }));
        const result = runScript(['--config', configPath]);

        expect(result.status).toBe(0);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'pqc-maturity-scorecard.json'), 'utf8'));
        expect(report.status).toBe('pass');
        expect(report.strict).toBe(true);
        expect(report.summary.fail).toBe(0);
        expect(Object.fromEntries(report.scores.map(({ id, currentScore }) => [id, currentScore]))).toEqual({
            'repo-owned-pqc-readiness': 98,
            'crypto-inventory-policy': 98,
            'ci-enforced-evidence': 98,
            'controllable-surface-deployment-proof': 82,
            'full-end-to-end-pqc-coverage': 52,
        });
        expect(report.overallScore).toBe(90);
        const markdown = fs.readFileSync(path.join(reportDir, 'pqc-maturity-scorecard.md'), 'utf8');
        expect(markdown).toContain('Status: pass');
        expect(markdown).toContain('Overall weighted score: 90%');
        const repoOwned = report.scores.find((entry) => entry.id === 'repo-owned-pqc-readiness');
        const controllable = report.scores.find((entry) => entry.id === 'controllable-surface-deployment-proof');
        const fullEndToEnd = report.scores.find((entry) => entry.id === 'full-end-to-end-pqc-coverage');

        expect(repoOwned.currentScore).toBeGreaterThan(fullEndToEnd.currentScore);
        expect(controllable.currentScore).toBeGreaterThanOrEqual(75);
        expect(fullEndToEnd.currentScore).toBeLessThanOrEqual(55);
        expect(report.providerUnknownCount).toBeGreaterThan(0);
        expect(report.limitations.join(' ')).toContain('No system is 100% quantum-proof');
    });

    test('propagates repository TLS failure without treating a numeric maturity score as a pass', () => {
        const result = runScript();

        expect(result.status).toBe(1);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'pqc-maturity-scorecard.json'), 'utf8'));
        expect(report.status).toBe('fail');
        expect(report.checks.filter((entry) => entry.status === 'fail')).toEqual([
            expect.objectContaining({
                id: 'scorecard.subreport.tlsConfig',
                scope: 'repo',
                evidence: { summary: expect.objectContaining({ fail: 3 }) },
            }),
        ]);
        expect(report.scores).toContainEqual(expect.objectContaining({
            id: 'repo-owned-pqc-readiness', currentScore: 82,
        }));
        expect(report.overallScore).toBe(85);
        expect(fs.readFileSync(path.join(reportDir, 'pqc-maturity-scorecard.md'), 'utf8')).toContain('Status: fail');
    });
});
