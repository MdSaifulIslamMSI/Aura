const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'security', 'internal-service-encryption-check.mjs');

describe('internal service encryption readiness checker', () => {
    test('validates environment shape without printing connection strings', () => {
        const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'internal-service-'));
        const result = spawnSync(process.execPath, [scriptPath, '--report-dir', reportDir, '--json', '--markdown'], {
            cwd: repoRoot,
            encoding: 'utf8',
            shell: false,
            timeout: 30000,
        });

        expect(result.status).toBe(0);
        expect(result.stdout).not.toContain('prod-db.example.invalid');
        expect(result.stdout).not.toContain('prod-redis.example.invalid');
        const rawReport = fs.readFileSync(path.join(reportDir, 'internal-service-encryption-check.json'), 'utf8');
        expect(rawReport).not.toContain('prod-db.example.invalid');
        expect(rawReport).not.toContain('prod-redis.example.invalid');
        const report = JSON.parse(rawReport);
        expect(report.sanitizedConnectionShapes).toEqual(expect.objectContaining({
            productionMongo: expect.stringContaining('[redacted]'),
            productionRedis: expect.stringContaining('[redacted]'),
        }));
    });
});
