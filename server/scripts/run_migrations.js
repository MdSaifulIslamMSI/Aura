require('dotenv').config();
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { registry } = require('../migrations');
const { runMigrations, getMigrationStatus } = require('../migrations/runner');

// Runs the registry in order under a singleton lock, recording each applied
// migration in the SchemaMigration ledger. Existing one-off scripts under
// server/scripts/migrate_*.js stay as documented legacy.
const run = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is required');
    }
    await mongoose.connect(process.env.MONGO_URI);

    if (process.argv.includes('--status')) {
        const status = await getMigrationStatus({ registry });
        process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
        return;
    }

    const result = await runMigrations({ registry });
    if (!result.ok) {
        throw new Error(`migration lock held (${result.reason}); another runner may be active`);
    }
    logger.info('migrations.run.completed', { applied: result.applied, skipped: result.skipped });
};

if (require.main === module) {
    run()
        .then(() => process.exit(0))
        .catch((error) => {
            logger.error('migrations.run.failed', { error: error?.message || String(error) });
            process.exit(1);
        });
}

module.exports = { run };
