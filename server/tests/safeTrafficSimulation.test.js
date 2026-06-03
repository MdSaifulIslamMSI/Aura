const fs = require('fs');
const path = require('path');
const {
    cleanupReportDir,
    createReportDir,
    runSecurityScript,
} = require('./helpers/securityScriptRunner');

describe('safe traffic simulation script', () => {
    let reportDir;

    afterEach(() => cleanupReportDir(reportDir));

    test('defaults to dry-run and sends no traffic', () => {
        reportDir = createReportDir('safe-sim');
        const result = runSecurityScript('scripts/security/safe-traffic-simulation.mjs', [
            '--json',
            '--markdown',
            '--local',
            '--report-dir',
            reportDir,
        ]);

        expect(result.status).toBe(0);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'safe-traffic-simulation.json'), 'utf8'));
        expect(report.dryRun).toBe(true);
        expect(report.networkRequestsSent).toBe(false);
    });

    test('refuses destructive profiles', () => {
        reportDir = createReportDir('safe-sim-refuse');
        const result = runSecurityScript('scripts/security/safe-traffic-simulation.mjs', [
            '--json',
            '--profile',
            'ai-abuse',
            '--target',
            'http://127.0.0.1:5000',
            '--report-dir',
            reportDir,
        ]);

        expect(result.status).toBe(1);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'safe-traffic-simulation.json'), 'utf8'));
        expect(report.status).toBe('fail');
        expect(report.checks.find((entry) => entry.id === 'simulation.destructive-profile-refused').status).toBe('fail');
    });
});
