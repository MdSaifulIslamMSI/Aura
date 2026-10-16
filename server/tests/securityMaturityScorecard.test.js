const fs = require('fs');
const path = require('path');
const {
    cleanupReportDir,
    createReportDir,
    runSecurityScript,
} = require('./helpers/securityScriptRunner');

const scriptOptions = {
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
};

describe('combined security maturity scorecard', () => {
    let reportDir;

    beforeEach(() => { reportDir = createReportDir('security-maturity'); });
    afterEach(() => cleanupReportDir(reportDir));

    const runScript = (args = []) => runSecurityScript('scripts/security/security-maturity-scorecard.mjs', [
        '--json', '--markdown', '--strict', '--allow-missing-system-tools',
        '--report-dir', reportDir,
        ...args,
    ], scriptOptions);

    test('combines PQC and traffic resilience with explicit limitation caps under supported TLS', () => {
        // Score arithmetic must not depend on the current deployment certificate.
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
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'security-maturity-scorecard.json'), 'utf8'));
        expect(report.status).toBe('pass');
        expect(report.strict).toBe(true);
        expect(report.summary.fail).toBe(0);
        expect(report.pqc.status).toBe('pass');
        expect(report.traffic.status).toBe('pass');
        expect(Object.fromEntries(report.sections.map(({ id, score }) => [id, score]))).toEqual({
            'pqc-readiness': 98,
            'controllable-surface-pqc-proof': 82,
            'full-end-to-end-pqc-cap': 52,
            'route-security': 96,
            'traffic-resilience-proof': 100,
            'observability-readiness': 90,
            'incident-readiness': 92,
            'provider-dependency-risk': 82,
        });
        expect(report.weightedScore).toBe(87);
        const markdown = fs.readFileSync(path.join(reportDir, 'security-maturity-scorecard.md'), 'utf8');
        expect(markdown).toContain('Status: pass');
        expect(markdown).toContain('Weighted score: 87%');
        expect(report.limitations.join(' ')).toMatch(/No system is 100% quantum-proof/);
        expect(report.limitations.join(' ')).toMatch(/No system is completely DDoS-proof/);
    });

    test('propagates the real repository CloudFront blockers through PQC to the combined gate', () => {
        const result = runScript();

        expect(result.status).toBe(1);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'security-maturity-scorecard.json'), 'utf8'));
        expect(report.status).toBe('fail');
        expect(report.checks.filter((entry) => entry.status === 'fail').map((entry) => entry.id)).toEqual([
            'security-maturity.pqc-scorecard',
        ]);
        expect(report.pqc.status).toBe('fail');
        expect(report.pqc.checks.filter((entry) => entry.status === 'fail')).toEqual([
            expect.objectContaining({
                id: 'scorecard.subreport.tlsConfig',
                scope: 'repo',
                evidence: { summary: expect.objectContaining({ fail: 3 }) },
            }),
        ]);
        expect(report.traffic.status).toBe('pass');
        expect(report.weightedScore).toBe(85);
        expect(fs.readFileSync(path.join(reportDir, 'security-maturity-scorecard.md'), 'utf8')).toContain('Status: fail');

        // The scorecard retains input summaries, so inspect the source TLS report too.
        const tlsResult = runSecurityScript('scripts/security/tls-config-readiness.mjs', [
            '--json', '--markdown', '--strict', '--report-dir', reportDir,
        ], scriptOptions);
        expect(tlsResult.status).toBe(1);
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
    });
});
