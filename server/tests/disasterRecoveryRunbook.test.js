const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'smoke', 'backup-restore-check.mjs');
const drillScriptPath = path.join(repoRoot, 'scripts', 'smoke', 'isolated-restore-drill.mjs');

const runCheck = (env = {}) => spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        ...env,
    },
    encoding: 'utf8',
});

describe('backup restore check script', () => {
    test('blocks production restore by default', () => {
        const result = runCheck({
            RESTORE_TARGET_ENV: 'production',
            AURA_BACKUP_COMMAND: 'backup-command-with-sensitive-fixture',
            AURA_RESTORE_COMMAND: 'restore-command-with-sensitive-fixture',
            AURA_BACKUP_STORAGE_URI: 'private-sensitive-backup-location',
        });

        expect(result.status).toBe(1);
        expect(result.stdout).toContain('production_restore_blocked');
        expect(result.stdout).not.toContain('sensitive-fixture');
        expect(result.stdout).not.toContain('private-sensitive-backup-location');
    });

    test('reports non-production dry run as configuration-only evidence', () => {
        const result = runCheck({
            RESTORE_TARGET_ENV: 'staging',
            DRY_RUN: 'true',
            AURA_BACKUP_COMMAND: 'mongodump',
            AURA_RESTORE_COMMAND: 'mongorestore',
            AURA_BACKUP_STORAGE_URI: 's3://staging-backups/aura',
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('backup_restore_configuration_ready');
        expect(result.stdout).toContain('configuration_only');
        expect(result.stdout).toContain('"restoreDrillProven": false');
    });

    test('fails closed with safe message when required configuration is missing', () => {
        const result = runCheck({
            RESTORE_TARGET_ENV: 'staging',
            MONGODB_URI: 'sensitive-connection-fixture',
        });

        expect(result.status).toBe(1);
        expect(result.stdout).toContain('missing_backup_restore_configuration');
        expect(result.stdout).not.toContain('sensitive-connection-fixture');
    });
});

describe('isolated backup restore drill script', () => {
    test('proves a local disposable fixture restore without touching production data', () => {
        const result = spawnSync(process.execPath, [drillScriptPath], {
            cwd: repoRoot,
            env: {
                PATH: process.env.PATH,
                SystemRoot: process.env.SystemRoot,
                RESTORE_TARGET_ENV: 'test',
                MONGODB_URI: 'sensitive-connection-fixture',
            },
            encoding: 'utf8',
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('isolated_restore_drill_proven');
        expect(result.stdout).toContain('local_disposable_fixture');
        expect(result.stdout).toContain('"restoreDrillProven": true');
        expect(result.stdout).toContain('"productionDataTouched": false');
        expect(result.stdout).not.toContain('sensitive-connection-fixture');
    });

    test('blocks production-target restore drills by default', () => {
        const result = spawnSync(process.execPath, [drillScriptPath], {
            cwd: repoRoot,
            env: {
                PATH: process.env.PATH,
                SystemRoot: process.env.SystemRoot,
                RESTORE_TARGET_ENV: 'production',
            },
            encoding: 'utf8',
        });

        expect(result.status).toBe(1);
        expect(result.stdout).toContain('production_restore_drill_blocked');
        expect(result.stdout).toContain('"backupExecuted": false');
        expect(result.stdout).toContain('"productionDataTouched": false');
    });

    test('writes redacted drill evidence reports when requested', () => {
        const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-drill-report-'));
        const result = spawnSync(process.execPath, [
            drillScriptPath,
            '--report-dir',
            reportDir,
            '--json',
            '--markdown',
        ], {
            cwd: repoRoot,
            env: {
                PATH: process.env.PATH,
                SystemRoot: process.env.SystemRoot,
                RESTORE_TARGET_ENV: 'test',
            },
            encoding: 'utf8',
        });

        expect(result.status).toBe(0);

        const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'isolated-backup-restore-drill.json'), 'utf8'));
        expect(report.status).toBe('pass');
        expect(report.evidence.restoreDrillProven).toBe(true);
        expect(report.evidence.productionDataTouched).toBe(false);
        expect(fs.existsSync(path.join(reportDir, 'isolated-backup-restore-drill.md'))).toBe(true);
    });
});
