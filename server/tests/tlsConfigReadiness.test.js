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
