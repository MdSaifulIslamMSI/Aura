require('dotenv').config();

const mongoose = require('mongoose');
const StatusCheck = require('../models/StatusCheck');

const EXECUTE = process.argv.includes('--execute');

const readArg = (name, fallback = '') => {
    const prefix = `--${name}=`;
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : fallback;
};

const parsePositiveInteger = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.trunc(parsed);
};

const redactMongoCredential = (value) => String(value || '')
    .replace(/mongodb(\+srv)?:\/\/[^@\s]+@/gi, 'mongodb$1://<redacted>@');

const resolveCutoff = (retentionDays) => new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000));

const connectMongo = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI missing in environment');
    }
    if (mongoose.connection.readyState === 1) return;
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 180000,
        maxPoolSize: 5,
    });
};

const pruneStatusChecks = async ({
    dryRun = true,
    retentionDays,
    batchSize,
    maxDelete,
} = {}) => {
    const cutoff = resolveCutoff(retentionDays);
    const staleFilter = { checkedAt: { $lt: cutoff } };
    const [totalBefore, staleBefore, oldest, newest] = await Promise.all([
        StatusCheck.countDocuments({}),
        StatusCheck.countDocuments(staleFilter),
        StatusCheck.findOne({}).sort({ checkedAt: 1 }).select('checkedAt').lean(),
        StatusCheck.findOne({}).sort({ checkedAt: -1 }).select('checkedAt').lean(),
    ]);

    const summary = {
        dryRun: Boolean(dryRun),
        retentionDays,
        cutoff: cutoff.toISOString(),
        totalBefore,
        staleBefore,
        oldestCheckedAt: oldest?.checkedAt ? new Date(oldest.checkedAt).toISOString() : null,
        newestCheckedAt: newest?.checkedAt ? new Date(newest.checkedAt).toISOString() : null,
    };

    if (dryRun || staleBefore === 0 || maxDelete === 0) {
        return {
            ...summary,
            deletedCount: 0,
            remainingStaleCount: staleBefore,
        };
    }

    let deletedCount = 0;
    while (deletedCount < staleBefore && deletedCount < maxDelete) {
        const remainingLimit = Math.min(batchSize, maxDelete - deletedCount);
        const staleIds = await StatusCheck.find(staleFilter)
            .sort({ checkedAt: 1 })
            .select('_id')
            .limit(remainingLimit)
            .lean();
        if (!staleIds.length) break;

        const result = await StatusCheck.deleteMany({ _id: { $in: staleIds.map((row) => row._id) } });
        const batchDeleted = Number(result.deletedCount || 0);
        deletedCount += batchDeleted;
        if (batchDeleted < staleIds.length) break;
    }

    return {
        ...summary,
        deletedCount,
        remainingStaleCount: await StatusCheck.countDocuments(staleFilter),
    };
};

const run = async () => {
    await connectMongo();

    const retentionDays = parsePositiveInteger(
        readArg('retention-days', process.env.STATUS_CHECK_RETENTION_DAYS || '7'),
        7
    );
    const batchSize = parsePositiveInteger(
        readArg('batch-size', process.env.STATUS_CHECK_RETENTION_BATCH_SIZE || '5000'),
        5000
    );
    const maxDeleteArg = readArg('max-delete', '');
    const maxDelete = maxDeleteArg
        ? parsePositiveInteger(maxDeleteArg, Number.POSITIVE_INFINITY)
        : Number.POSITIVE_INFINITY;

    const result = await pruneStatusChecks({
        dryRun: !EXECUTE,
        retentionDays,
        batchSize,
        maxDelete,
    });

    console.log(JSON.stringify({
        execute: EXECUTE,
        collection: 'statuschecks',
        ...result,
        note: EXECUTE
            ? 'Deleted only raw status check telemetry older than the retention cutoff.'
            : 'Preview only. Re-run with --execute to delete stale status check telemetry.',
    }, null, 2));
};

run()
    .catch((error) => {
        console.error(JSON.stringify({
            ok: false,
            error: redactMongoCredential(error?.message || error),
        }, null, 2));
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close().catch(() => {});
    });
