const fs = require('fs');
const path = require('path');
const {
    cleanupReportDir,
    createReportDir,
    runSecurityScript,
} = require('./helpers/securityScriptRunner');

describe('provider circuit-breaker readiness script', () => {
    let reportDir;

    afterEach(() => cleanupReportDir(reportDir));

    test('reports provider dependency failure posture without live calls', () => {
        reportDir = createReportDir('provider-breakers');
        const result = runSecurityScript('scripts/security/provider-circuit-breaker-check.mjs', [
            '--json',
            '--markdown',
            '--report-dir',
            reportDir,
        ]);

        expect(result.status).toBe(0);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'provider-circuit-breakers.json'), 'utf8'));
        expect(report.providers.map((entry) => entry.provider)).toEqual(expect.arrayContaining([
            'Stripe',
            'Razorpay',
            'AI providers',
        ]));
    });
});
