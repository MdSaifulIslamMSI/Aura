const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'security', 'tls-config-readiness.mjs');

const runScript = (args) => spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    timeout: 30000,
});

describe('TLS config readiness checker', () => {
    test('passes repo TLS examples and treats non-terminating templates as skipped', () => {
        const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-readiness-'));
        const result = runScript(['--report-dir', reportDir, '--json', '--markdown']);

        expect(result.status).toBe(0);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'tls-config-readiness.json'), 'utf8'));
        expect(report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: expect.stringContaining('infra/security/nginx-tls13-pqc-ready.conf.example'),
                status: 'pass',
            }),
        ]));
        expect(report.checks.some((entry) => entry.status === 'skipped')).toBe(true);
    });

    test('warns rather than fails for a default-certificate CDN pinned below TLS 1.3', () => {
        // CloudFront on CloudFrontDefaultCertificate will accept and deploy a
        // TLS 1.3 minimum but does not honour it, enforcing its own 1.2 floor
        // (verified by probing the live edge). Failing here would be a gate no
        // real distribution could ever satisfy; skipping it silently was the
        // original bug. The check must stay visible.
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-cdn-default-'));
        const cfg = path.join(tempDir, 'edge.json');
        fs.writeFileSync(cfg, JSON.stringify({
            ViewerCertificate: {
                CloudFrontDefaultCertificate: true,
                MinimumProtocolVersion: 'TLSv1.2_2021',
            },
        }, null, 2));
        const reportDir = path.join(tempDir, 'reports');
        const result = runScript(['--config', cfg, '--report-dir', reportDir, '--json', '--markdown']);

        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'tls-config-readiness.json'), 'utf8'));
        const check = report.checks.find((c) => c.id.includes('tls.minimum'));
        expect(check.status).toBe('warning');
        expect(check.summary).toMatch(/custom ACM certificate/i);
    });

    test('still fails a custom-certificate CDN pinned below TLS 1.3', () => {
        // Where TLS 1.3 IS enforceable the gate must keep its teeth.
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-cdn-custom-'));
        const cfg = path.join(tempDir, 'edge.json');
        fs.writeFileSync(cfg, JSON.stringify({
            ViewerCertificate: {
                CloudFrontDefaultCertificate: false,
                MinimumProtocolVersion: 'TLSv1.2_2021',
            },
        }, null, 2));
        const reportDir = path.join(tempDir, 'reports');
        const result = runScript(['--config', cfg, '--report-dir', reportDir, '--json', '--markdown']);

        expect(result.status).toBe(1);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'tls-config-readiness.json'), 'utf8'));
        const check = report.checks.find((c) => c.id.includes('tls.minimum'));
        expect(check.status).toBe('fail');
    });

    test('passes a CDN edge config pinned to a TLS 1.3 minimum', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-cdn-good-'));
        const goodCdnConfig = path.join(tempDir, 'edge.json');
        fs.writeFileSync(goodCdnConfig, JSON.stringify({
            ViewerCertificate: {
                CloudFrontDefaultCertificate: true,
                MinimumProtocolVersion: 'TLSv1.3_2021',
            },
        }, null, 2));
        const reportDir = path.join(tempDir, 'reports');
        const result = runScript(['--config', goodCdnConfig, '--report-dir', reportDir, '--json', '--markdown']);

        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'tls-config-readiness.json'), 'utf8'));
        expect(report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: expect.stringContaining('tls.minimum'),
                status: 'pass',
            }),
        ]));
    });

    test('fails configs that enable legacy TLS or SSL protocol tokens', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-bad-config-'));
        const badConfig = path.join(tempDir, 'bad.conf');
        fs.writeFileSync(badConfig, [
            'server {',
            '  listen 443 ssl;',
            '  ssl_protocols TLSv1 TLSv1.1;',
            '}',
            '',
        ].join('\n'));
        const reportDir = path.join(tempDir, 'reports');
        const result = runScript(['--config', badConfig, '--report-dir', reportDir, '--json', '--markdown']);

        expect(result.status).toBe(1);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'tls-config-readiness.json'), 'utf8'));
        expect(report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ status: 'fail', summary: expect.stringContaining('legacy protocol token') }),
        ]));
    });
});
