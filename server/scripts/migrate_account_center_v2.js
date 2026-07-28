/* eslint-disable no-console */
const mongoose = require('mongoose');
const { loadLocalEnvFiles } = require('../config/runtimeConfig');
const connectDB = require('../config/db');
const { runAccountCenterMigration } = require('../services/accountCenterMigrationService');

const BOOLEAN_FLAGS = new Set(['execute', 'help']);
const VALUE_FLAGS = new Set([
    'mode',
    'run-id',
    'approved-by',
    'ticket',
    'backup-evidence',
    'rollback-sha',
    'batch-size',
    'max-batches',
    'delay-ms',
]);

const parseArgs = (argv = []) => {
    const parsed = {};
    argv.forEach((argument) => {
        if (!String(argument).startsWith('--')) throw new Error('Unexpected migration argument');
        const separator = argument.indexOf('=');
        const key = argument.slice(2, separator >= 0 ? separator : undefined);
        const value = separator >= 0 ? argument.slice(separator + 1).trim() : true;
        if (!BOOLEAN_FLAGS.has(key) && !VALUE_FLAGS.has(key)) {
            throw new Error(`Unknown migration option: --${key}`);
        }
        if (VALUE_FLAGS.has(key) && value === true) {
            throw new Error(`Migration option --${key} requires a value`);
        }
        if (Object.prototype.hasOwnProperty.call(parsed, key)) {
            throw new Error(`Migration option --${key} was provided more than once`);
        }
        parsed[key] = value;
    });
    return parsed;
};

const usage = () => [
    'Account Center V2 additive migration',
    '',
    'Dry-run audit:',
    '  npm --prefix server run migrate:account-center-v2 -- --mode=audit --run-id=<safe-id>',
    '',
    'Apply (staging first; requires backup and immutable rollback evidence):',
    '  Set ACCOUNT_CENTER_MIGRATION_APPLY_ENABLED=true, then run with:',
    '  --mode=apply --execute --run-id=<safe-id> --approved-by=<operator> --ticket=<ticket>',
    '  --backup-evidence=<reference> --rollback-sha=<40-char-sha>',
    '',
    'Optional bounded controls: --batch-size=200 --max-batches=1000 --delay-ms=50',
].join('\n');

const run = async ({ argv = process.argv.slice(2), env = process.env } = {}) => {
    loadLocalEnvFiles();
    const args = parseArgs(argv);
    if (args.help) return { help: usage() };
    await connectDB();
    return runAccountCenterMigration({
        mode: String(args.mode || 'audit').trim().toLowerCase(),
        execute: args.execute === true,
        runId: String(args['run-id'] || '').trim(),
        approvedBy: String(args['approved-by'] || '').trim(),
        ticket: String(args.ticket || '').trim(),
        backupEvidence: String(args['backup-evidence'] || '').trim(),
        rollbackSha: String(args['rollback-sha'] || '').trim(),
        batchSize: args['batch-size'],
        maxBatches: args['max-batches'],
        delayMs: args['delay-ms'],
    }, { env });
};

if (require.main === module) {
    run()
        .then((result) => {
            process.stdout.write(`${result.help || JSON.stringify(result, null, 2)}\n`);
        })
        .catch((error) => {
            process.stderr.write(`${JSON.stringify({
                success: false,
                code: String(error?.code || 'ACCOUNT_CENTER_MIGRATION_FAILED'),
                message: String(error?.message || 'Account Center migration failed').slice(0, 500),
            })}\n`);
            process.exitCode = 1;
        })
        .finally(async () => {
            if (mongoose.connection.readyState !== 0) {
                await mongoose.connection.close().catch(() => null);
            }
        });
}

module.exports = {
    parseArgs,
    run,
    usage,
};
