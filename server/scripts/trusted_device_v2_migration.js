/* eslint-disable no-console */
const mongoose = require('mongoose');
const { loadLocalEnvFiles } = require('../config/runtimeConfig');
const connectDB = require('../config/db');
const User = require('../models/User');
const TrustedDeviceCredential = require('../models/TrustedDeviceCredential');
const TrustedDeviceMigrationRun = require('../models/TrustedDeviceMigrationRun');
const {
    buildMigrationEvidence,
    createMongooseTrustedDeviceMigrationStore,
    runTrustedDeviceV2Migration,
} = require('../services/trustedDeviceV2MigrationService');

const BOOLEAN_FLAGS = new Set(['execute', 'help']);
const VALUE_FLAGS = new Set([
    'mode',
    'run-id',
    'evidence-run-id',
    'audience',
    'requested-by',
    'approved-by',
    'audit-run-id',
    'approval-hash',
    'batch-size',
    'max-batches',
    'lease-seconds',
    'max-error-samples',
    'owner-id',
]);

const normalizeText = (value) => String(value === undefined || value === null ? '' : value).trim();

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = normalizeText(value).toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parseArgs = (argv = []) => {
    const parsed = {};
    for (const argument of argv) {
        if (!argument.startsWith('--')) {
            throw new Error(`Unexpected positional argument: ${argument}`);
        }
        const separatorIndex = argument.indexOf('=');
        const key = argument.slice(2, separatorIndex >= 0 ? separatorIndex : undefined);
        const value = separatorIndex >= 0 ? argument.slice(separatorIndex + 1) : true;
        if (!BOOLEAN_FLAGS.has(key) && !VALUE_FLAGS.has(key)) {
            throw new Error(`Unknown migration option: --${key}`);
        }
        if (VALUE_FLAGS.has(key) && value === true) {
            throw new Error(`Migration option --${key} requires a value.`);
        }
        if (Object.prototype.hasOwnProperty.call(parsed, key)) {
            throw new Error(`Migration option --${key} was provided more than once.`);
        }
        parsed[key] = value;
    }
    return parsed;
};

const usage = () => [
    'Trusted-device V2 migration',
    '',
    'Audit (writes run metadata, never V2 credentials):',
    '  npm --prefix server run migrate:trusted-device-v2 -- --mode=audit --run-id=<id> --audience=all --requested-by=<operator>',
    '',
    'Apply (requires completed audit approval and two explicit mutation gates):',
    '  Set TRUSTED_DEVICE_V2_MIGRATION_APPLY_ENABLED=true, then run:',
    '  npm --prefix server run migrate:trusted-device-v2 -- --mode=apply --execute --run-id=<new-id> --audit-run-id=<audit-id> --approval-hash=<hash> --approved-by=<operator> --requested-by=<operator> --audience=all',
    '',
    'Read stored evidence:',
    '  npm --prefix server run migrate:trusted-device-v2 -- --evidence-run-id=<id>',
    '',
    'Required secret environment variable (never printed):',
    '  TRUSTED_DEVICE_V2_MIGRATION_PSEUDONYM_KEY (at least 32 characters)',
].join('\n');

const redactErrorMessage = (value) => normalizeText(value)
    .replace(/mongodb(\+srv)?:\/\/[^@\s]+@/gi, 'mongodb$1://<redacted>@')
    .slice(0, 500);

const buildRunOptions = (args, env = process.env) => ({
    mode: normalizeText(args.mode || 'audit').toLowerCase(),
    runId: normalizeText(args['run-id']),
    audience: normalizeText(args.audience || 'all').toLowerCase(),
    requestedBy: normalizeText(args['requested-by'] || env.TRUSTED_DEVICE_V2_MIGRATION_OPERATOR),
    approvedBy: normalizeText(args['approved-by']),
    auditRunId: normalizeText(args['audit-run-id']),
    approvalHash: normalizeText(args['approval-hash']),
    pseudonymKey: normalizeText(env.TRUSTED_DEVICE_V2_MIGRATION_PSEUDONYM_KEY),
    batchSize: args['batch-size'],
    maxBatches: args['max-batches'],
    leaseSeconds: args['lease-seconds'],
    maxErrorSamples: args['max-error-samples'],
    ownerId: normalizeText(args['owner-id']),
});

const assertApplyGate = (args, env = process.env) => {
    if (normalizeText(args.mode || 'audit').toLowerCase() !== 'apply') return;
    if (args.execute !== true || !parseBoolean(env.TRUSTED_DEVICE_V2_MIGRATION_APPLY_ENABLED, false)) {
        const error = new Error(
            'Apply mode requires --execute and TRUSTED_DEVICE_V2_MIGRATION_APPLY_ENABLED=true.'
        );
        error.code = 'MIGRATION_APPLY_GATE_REQUIRED';
        throw error;
    }
};

const run = async ({ argv = process.argv.slice(2), env = process.env } = {}) => {
    loadLocalEnvFiles();
    const args = parseArgs(argv);
    if (args.help) {
        return { help: usage() };
    }

    assertApplyGate(args, env);
    await connectDB();
    const store = createMongooseTrustedDeviceMigrationStore({
        UserModel: User,
        CredentialModel: TrustedDeviceCredential,
        MigrationRunModel: TrustedDeviceMigrationRun,
    });

    const evidenceRunId = normalizeText(args['evidence-run-id']);
    if (evidenceRunId) {
        const storedRun = await store.getRun(evidenceRunId);
        if (!storedRun) {
            const error = new Error('Migration run was not found.');
            error.code = 'MIGRATION_RUN_NOT_FOUND';
            throw error;
        }
        return { evidence: buildMigrationEvidence(storedRun) };
    }

    return {
        evidence: await runTrustedDeviceV2Migration(buildRunOptions(args, env), { store }),
    };
};

if (require.main === module) {
    run()
        .then((result) => {
            if (result.help) {
                process.stdout.write(`${result.help}\n`);
                return;
            }
            process.stdout.write(`${JSON.stringify(result.evidence, null, 2)}\n`);
        })
        .catch((error) => {
            process.stderr.write(`${JSON.stringify({
                success: false,
                code: normalizeText(error?.code) || 'MIGRATION_FAILED',
                message: redactErrorMessage(error?.message) || 'Trusted-device V2 migration failed.',
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
    assertApplyGate,
    buildRunOptions,
    parseArgs,
    redactErrorMessage,
    run,
    usage,
};
