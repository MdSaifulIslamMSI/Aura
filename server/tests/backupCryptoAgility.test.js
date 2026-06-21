const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'security', 'backup-crypto-agility-check.mjs');

describe('backup crypto-agility checker', () => {
    test('proves destructive production restore remains blocked by default', () => {
        const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-agility-'));
        const result = spawnSync(process.execPath, [scriptPath, '--report-dir', reportDir, '--json', '--markdown'], {
            cwd: repoRoot,
            encoding: 'utf8',
            shell: false,
            timeout: 30000,
        });

        expect(result.status).toBe(0);
        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'backup-crypto-agility-check.json'), 'utf8'));
        expect(report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'repo.backup-restore.destructive-blocked',
                status: 'pass',
            }),
            expect.objectContaining({
                id: 'repo.backup.no-private-material',
                status: 'pass',
            }),
            expect.objectContaining({
                id: 'repo.backup-restore-drill.local-fixture-proven',
                status: 'pass',
            }),
        ]));
    });
});
