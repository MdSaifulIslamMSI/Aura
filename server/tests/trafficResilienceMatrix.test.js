const fs = require('fs');
const path = require('path');
const {
    cleanupReportDir,
    createReportDir,
    runSecurityScript,
} = require('./helpers/securityScriptRunner');

describe('traffic resilience matrix script', () => {
    let reportDir;

    afterEach(() => cleanupReportDir(reportDir));

    test('generates a passing strict matrix from repo evidence', () => {
        reportDir = createReportDir('traffic-matrix');
        const result = runSecurityScript('scripts/security/traffic-resilience-matrix-check.mjs', [
            '--json',
            '--markdown',
            '--strict',
            '--report-dir',
            reportDir,
        ]);

        expect(result.status).toBe(0);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'traffic-resilience-matrix.json'), 'utf8'));
        expect(report.status).toBe('pass');
        expect(report.rows.length).toBeGreaterThanOrEqual(20);
    });
});
