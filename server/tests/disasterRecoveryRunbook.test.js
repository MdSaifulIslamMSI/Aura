const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'smoke', 'backup-restore-check.mjs');

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
