const fs = require('fs');
const path = require('path');
const {
    cleanupReportDir,
    createReportDir,
    runSecurityScript,
} = require('./helpers/securityScriptRunner');

describe('rate limit coverage script', () => {
    let reportDir;

    afterEach(() => cleanupReportDir(reportDir));

    test('proves dangerous route families have limiter or replay evidence', () => {
        reportDir = createReportDir('rate-coverage');
        const result = runSecurityScript('scripts/security/rate-limit-coverage-check.mjs', [
            '--json',
            '--markdown',
            '--strict',
            '--report-dir',
            reportDir,
        ]);

        expect(result.status).toBe(0);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'rate-limit-coverage.json'), 'utf8'));
        expect(report.status).toBe('pass');
        expect(report.coveredRoutes.map((entry) => entry.name)).toContain('AI call');
    });

    test('bundle builder is guarded by a distributed, fail-closed limiter', () => {
        const routeSource = fs.readFileSync(
            path.join(__dirname, '..', 'routes', 'productRoutes.js'),
            'utf8'
        );

        expect(routeSource).toContain("name: 'product_bundle_build'");
        expect(routeSource).toContain('securityCritical: true');
        expect(routeSource).toMatch(/\.post\(bundleBuildLimiter,\s*validate\(bundleBuildSchema\),\s*buildProductBundle\)/);
    });
});
