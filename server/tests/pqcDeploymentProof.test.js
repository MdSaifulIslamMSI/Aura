const fs = require('fs');
const path = require('path');
const {
    cleanupReportDir,
    createReportDir,
    runSecurityScript,
} = require('./helpers/securityScriptRunner');

describe('PQC deployment proof script', () => {
    let reportDir;

    beforeEach(() => { reportDir = createReportDir('pqc-proof'); });
    afterEach(() => cleanupReportDir(reportDir));

    const runScript = (args = []) => runSecurityScript('scripts/security/pqc-deployment-proof.mjs', [
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

    test('generates JSON and Markdown reports for supported TLS without requiring local PQC system tools', () => {
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
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'pqc-deployment-proof.json'), 'utf8'));
        expect(report.status).toBe('pass');
        expect(report.strict).toBe(true);
        expect(report.summary.fail).toBe(0);
        expect(report.subreports.every((entry) => entry.status === 'pass')).toBe(true);
        const tls = JSON.parse(fs.readFileSync(path.join(reportDir, 'tls-config-readiness.json'), 'utf8'));
        expect(tls.configsScanned).toHaveLength(1);
        expect(tls.checks).toContainEqual(expect.objectContaining({
            id: expect.stringContaining('tls.minimum.'),
            status: 'pass',
            evidence: expect.objectContaining({ effectiveViewerPolicy: 'TLSv1.3_2025' }),
        }));
        expect(report.limitations).toEqual(expect.arrayContaining([
            expect.stringContaining('No system is 100% quantum-proof'),
        ]));
        expect(fs.readFileSync(path.join(reportDir, 'pqc-deployment-proof.md'), 'utf8')).toContain('Status: pass');
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

    test('fails the aggregate proof for the real repository CloudFront default certificate', () => {
        const result = runScript();

        expect(result.status).toBe(1);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'pqc-deployment-proof.json'), 'utf8'));
        expect(report.status).toBe('fail');
        expect(report.checks.filter((entry) => entry.status === 'fail' && entry.id.startsWith('subreport.'))
            .map((entry) => entry.id)).toEqual(['subreport.tls']);
        const tls = JSON.parse(fs.readFileSync(path.join(reportDir, 'tls-config-readiness.json'), 'utf8'));
        expect(tls.status).toBe('fail');
        expect(tls.checks.filter((entry) => entry.status === 'fail').map((entry) => entry.id)).toEqual([
            'tls.legacy_tls_1_0.infra/aws/cloudfront-edge-replica.json',
            'tls.legacy_tls_1_1.infra/aws/cloudfront-edge-replica.json',
            'tls.minimum.infra/aws/cloudfront-edge-replica.json',
        ]);
        expect(tls.checks).toContainEqual(expect.objectContaining({
            id: 'tls.minimum.infra/aws/cloudfront-edge-replica.json',
            scope: 'repo',
            severity: 'high',
            summary: expect.stringContaining('CloudFrontDefaultCertificate=true forces TLSv1'),
            evidence: expect.objectContaining({ effectiveViewerPolicy: 'TLSv1' }),
        }));
        expect(report.subreports).toContainEqual(expect.objectContaining({ name: 'tls', status: 'fail', summary: tls.summary }));
        expect(report.checks).toContainEqual(expect.objectContaining({
            id: 'subreport.tls',
            status: 'fail',
            evidence: { summary: tls.summary },
        }));
        expect(fs.readFileSync(path.join(reportDir, 'pqc-deployment-proof.md'), 'utf8')).toContain('Status: fail');
    });

    test('strict mode fails missing repo-owned artifacts', () => {
        const tempRoot = path.join(reportDir, 'empty-root');
        fs.mkdirSync(tempRoot);
        const result = runScript(['--root', tempRoot]);

        expect(result.status).toBe(1);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'pqc-deployment-proof.json'), 'utf8'));
        expect(report.status).toBe('fail');
        expect(report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'repo.pqc-policy.exists', status: 'fail' }),
        ]));
    });
});
