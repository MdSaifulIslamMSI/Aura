const fs = require('fs');
const path = require('path');
const {
    cleanupReportDir,
    createReportDir,
    runSecurityScript,
} = require('./helpers/securityScriptRunner');

describe('PQC real-target proof script', () => {
    let reportDir;

    afterEach(() => cleanupReportDir(reportDir));

    test('is disabled by default and records honest skipped target evidence', () => {
        reportDir = createReportDir('pqc-real-target');
        const result = runSecurityScript('scripts/security/pqc-real-target-proof.mjs', [
            '--json',
            '--markdown',
            '--report-dir',
            reportDir,
        ]);

        expect(result.status).toBe(0);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'pqc-real-target-proof.json'), 'utf8'));
        expect(report.status).toBe('pass');
        expect(report.configuredTargets).toBe(0);
        expect(JSON.stringify(report)).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/i);
    });
});
