const fs = require('fs');
const path = require('path');
const {
    cleanupReportDir,
    createReportDir,
    runSecurityScript,
} = require('./helpers/securityScriptRunner');

describe('backpressure readiness script', () => {
    let reportDir;

    afterEach(() => cleanupReportDir(reportDir));

    test('generates a repository backpressure readiness report', () => {
        reportDir = createReportDir('backpressure');
        const result = runSecurityScript('scripts/security/backpressure-readiness-check.mjs', [
            '--json',
            '--markdown',
            '--report-dir',
            reportDir,
        ]);

        expect(result.status).toBe(0);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'backpressure-readiness.json'), 'utf8'));
        expect(report.status).toBe('pass');
    });
});
