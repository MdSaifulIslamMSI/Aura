const fs = require('fs');
const path = require('path');
const {
    cleanupReportDir,
    createReportDir,
    runSecurityScript,
} = require('./helpers/securityScriptRunner');

describe('combined security maturity scorecard', () => {
    let reportDir;

    afterEach(() => cleanupReportDir(reportDir));

    test('combines PQC and traffic resilience with explicit limitation caps', () => {
        reportDir = createReportDir('security-maturity');
        const result = runSecurityScript('scripts/security/security-maturity-scorecard.mjs', [
            '--json',
            '--markdown',
            '--strict',
            '--report-dir',
            reportDir,
        ], { timeout: 60000 });

        expect(result.status).toBe(0);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'security-maturity-scorecard.json'), 'utf8'));
        expect(report.status).toBe('pass');
        expect(report.limitations.join(' ')).toMatch(/No system is 100% quantum-proof/);
        expect(report.limitations.join(' ')).toMatch(/No system is completely DDoS-proof/);
    });
});
