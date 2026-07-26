const mongoose = require('mongoose');
const User = require('../models/User');
const { loadLocalEnvFiles } = require('../config/runtimeConfig');
const {
    cleanupOrphanedAvatarMedia,
    cleanupStaleAvatarQuarantine,
    getStorageDriver,
} = require('../services/avatarMediaStorageService');

loadLocalEnvFiles();

const execute = process.argv.includes('--execute');
const olderThanHours = Math.max(
    1,
    Number(process.env.AVATAR_QUARANTINE_TTL_HOURS || 24)
);

const run = async () => {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 30_000,
        maxPoolSize: 2,
    });
    const users = await User.find({
        'avatarMedia.storageKey': { $exists: true, $ne: '' },
    }).select('avatarMedia.storageKey').lean();
    const referencedKeys = users
        .map((user) => user.avatarMedia?.storageKey)
        .filter(Boolean);
    const [quarantine, orphaned] = await Promise.all([
        cleanupStaleAvatarQuarantine({
            olderThanMs: olderThanHours * 60 * 60 * 1000,
            dryRun: !execute,
        }),
        cleanupOrphanedAvatarMedia({
            referencedKeys,
            olderThanMs: Math.max(7 * 24, olderThanHours) * 60 * 60 * 1000,
            dryRun: !execute,
        }),
    ]);
    process.stdout.write(`${JSON.stringify({
        mode: execute ? 'execute' : 'dry-run',
        storageDriver: getStorageDriver(),
        olderThanHours,
        referencedKeys: referencedKeys.length,
        staleQuarantineCandidates: quarantine.removed,
        orphanedFinalCandidates: orphaned.removed,
    })}\n`);
};

run().catch((error) => {
    process.stderr.write(`Avatar media cleanup failed: ${error.message}\n`);
    process.exitCode = 1;
}).finally(async () => {
    await mongoose.connection.close().catch(() => {});
});
