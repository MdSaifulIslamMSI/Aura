const SchemaMigration = require('../models/SchemaMigration');
const SchemaMigrationLock = require('../models/SchemaMigrationLock');
const { runMigrations, checksumOf } = require('../migrations/runner');

describe('migration runner', () => {
    beforeEach(async () => {
        await SchemaMigration.deleteMany({});
        await SchemaMigrationLock.deleteMany({});
    });

    test('applies pending migrations in registry order and records the ledger', async () => {
        const calls = [];
        const registry = [
            { id: '001_test_add_field', description: 'add field', up: async () => { calls.push('a'); } },
            { id: '002_test_backfill', description: 'backfill', up: async () => { calls.push('b'); } },
        ];

        const result = await runMigrations({ registry });

        expect(result.ok).toBe(true);
        expect(result.applied).toEqual(['001_test_add_field', '002_test_backfill']);
        expect(result.skipped).toEqual([]);
        expect(calls).toEqual(['a', 'b']);

        const rows = await SchemaMigration.find({}).sort({ migrationId: 1 }).lean();
        expect(rows.map((row) => row.migrationId)).toEqual(['001_test_add_field', '002_test_backfill']);
        expect(rows[0].appliedAt).toBeInstanceOf(Date);
        expect(rows[0].checksum).toBe(checksumOf(registry[0].up.toString()));
    });

    test('skips migrations already recorded in the ledger', async () => {
        await SchemaMigration.create({ migrationId: '001_test_add_field', checksum: 'legacy' });
        const calls = [];
        const registry = [
            { id: '001_test_add_field', up: async () => { calls.push('a'); } },
            { id: '002_test_backfill', up: async () => { calls.push('b'); } },
        ];

        const result = await runMigrations({ registry });

        expect(result.applied).toEqual(['002_test_backfill']);
        expect(result.skipped).toEqual(['001_test_add_field']);
        expect(calls).toEqual(['b']);
    });

    test('refuses to run while another runner holds a fresh lock', async () => {
        await SchemaMigrationLock.create({
            _id: 'runner',
            lockedAt: new Date(),
            lockedBy: 'other-host-1',
        });

        const result = await runMigrations({
            registry: [{ id: '001_test_never', up: async () => {} }],
        });

        expect(result).toEqual({ ok: false, reason: 'lock_held' });
        expect(await SchemaMigration.countDocuments({})).toBe(0);
    });

    test('a failing migration leaves no ledger row and releases the lock', async () => {
        const registry = [{
            id: '001_test_fails',
            up: async () => {
                throw new Error('boom');
            },
        }];

        await expect(runMigrations({ registry })).rejects.toThrow('boom');

        expect(await SchemaMigration.countDocuments({})).toBe(0);
        const lock = await SchemaMigrationLock.findById('runner');
        expect(lock.lockedAt).toBeNull();
        expect(lock.lockedBy).toBe('');
    });
});
