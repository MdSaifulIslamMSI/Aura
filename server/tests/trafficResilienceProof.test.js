const fs = require('fs');
const path = require('path');
const {
    cleanupReportDir,
    createReportDir,
    runSecurityScript,
} = require('./helpers/securityScriptRunner');

describe('traffic resilience proof script', () => {
    let reportDir;

    afterEach(() => cleanupReportDir(reportDir));

    test('aggregates traffic fortress subreports into a passing strict proof', () => {
        reportDir = createReportDir('traffic-proof');
        const result = runSecurityScript('scripts/security/traffic-resilience-proof.mjs', [
            '--json',
            '--markdown',
            '--strict',
            '--report-dir',
            reportDir,
        ], { timeout: 60000 });

        expect(result.status).toBe(0);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'traffic-resilience-proof.json'), 'utf8'));
        expect(report.status).toBe('pass');
        expect(report.trafficResilienceScore).toBeGreaterThanOrEqual(90);
    });
});
