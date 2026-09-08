const crypto = require('crypto');
const os = require('os');
const logger = require('../utils/logger');
const SchemaMigration = require('../models/SchemaMigration');
const SchemaMigrationLock = require('../models/SchemaMigrationLock');

const LOCK_ID = 'runner';
const LOCK_STALE_MS = Number(process.env.MIGRATION_LOCK_STALE_MS || 10 * 60 * 1000);
const WORKER_ID = `${os.hostname()}-${process.pid}`;

const checksumOf = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const acquireMigrationLock = async () => {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - LOCK_STALE_MS);
    try {
        return await SchemaMigrationLock.findOneAndUpdate(
            {
                _id: LOCK_ID,
                $or: [
                    { lockedAt: null },
                    { lockedAt: { $exists: false } },
                    { lockedAt: { $lte: staleCutoff } },
                ],
            },
            { $set: { lockedAt: now, lockedBy: WORKER_ID } },
            { upsert: true, returnDocument: 'after' }
        );
    } catch (error) {
        // The singleton already exists with a fresh lock, so the upsert's
        // insert path hits the _id unique index: another runner holds it.
        if (error?.code === 11000) {
            return null;
        }
        throw error;
    }
};

const releaseMigrationLock = async () => {
    await SchemaMigrationLock.updateOne(
        { _id: LOCK_ID, lockedBy: WORKER_ID },
        { $set: { lockedAt: null, lockedBy: '' } }
    );
};

const listAppliedMigrations = async () => SchemaMigration.find({}).sort({ appliedAt: 1, _id: 1 }).lean();

const runMigrations = async ({ registry = [] } = {}) => {
    const lock = await acquireMigrationLock();
    if (!lock) {
        return { ok: false, reason: 'lock_held' };
    }

    const applied = [];
    const skipped = [];
    try {
        const seen = new Set((await listAppliedMigrations()).map((row) => row.migrationId));
        for (const migration of registry) {
            if (seen.has(migration.id)) {
                skipped.push(migration.id);
                continue;
            }
            const startedAt = Date.now();
            await migration.up();
            const durationMs = Date.now() - startedAt;
            await SchemaMigration.create({
                migrationId: migration.id,
                checksum: checksumOf(migration.up.toString()),
                description: migration.description || '',
                durationMs,
                appliedBy: WORKER_ID,
            });
            applied.push(migration.id);
            logger.info('migrations.applied', { migrationId: migration.id, durationMs });
        }
        return { ok: true, applied, skipped };
    } finally {
        await releaseMigrationLock();
    }
};

const getMigrationStatus = async ({ registry = [] } = {}) => {
    const rows = await listAppliedMigrations();
    const appliedIds = new Set(rows.map((row) => row.migrationId));
    return {
        applied: rows.map((row) => ({
            migrationId: row.migrationId,
            description: row.description,
            appliedAt: row.appliedAt,
            checksum: row.checksum,
            appliedBy: row.appliedBy,
        })),
        pending: registry.filter((migration) => !appliedIds.has(migration.id)).map((migration) => migration.id),
    };
};

module.exports = {
    runMigrations,
    getMigrationStatus,
    checksumOf,
    WORKER_ID,
};
