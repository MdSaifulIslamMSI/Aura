require('dotenv').config();

const mongoose = require('mongoose');
const Listing = require('../models/Listing');
const User = require('../models/User');
const { MARKETPLACE_SEED_REGEX } = require('../services/marketplaceIntegrityService');

const run = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI missing in environment');
    }

    await mongoose.connect(process.env.MONGO_URI);

    const demoUsers = await User.find({ email: /@aura\.local$/i }).select('_id').lean();
    const demoUserIds = demoUsers.map((user) => user._id);

    const deleteQuery = {
        $or: [
            { source: 'seed' },
            { description: { $regex: MARKETPLACE_SEED_REGEX } },
            ...(demoUserIds.length > 0 ? [{ seller: { $in: demoUserIds } }] : []),
        ],
    };

    const deletedListings = await Listing.deleteMany(deleteQuery);

    const normalizeResult = await Listing.updateMany(
        { source: { $exists: false } },
        { $set: { source: 'user' } }
    );

    const removableDemoUsers = await User.find({
        _id: { $in: demoUserIds },
    }).select('_id').lean();

    let deletedUsers = 0;
    if (removableDemoUsers.length > 0) {
        const ids = removableDemoUsers.map((user) => user._id);
        const activeRefs = await Listing.countDocuments({ seller: { $in: ids } });
        if (activeRefs === 0) {
            const userDeleteResult = await User.deleteMany({ _id: { $in: ids } });
            deletedUsers = userDeleteResult.deletedCount || 0;
        }
    }

    const remaining = await Listing.countDocuments({ status: 'active' });
    console.log('[marketplace-purge] done', JSON.stringify({
        deletedListings: deletedListings.deletedCount || 0,
        normalizedListings: normalizeResult.modifiedCount || 0,
        deletedDemoUsers: deletedUsers,
        remainingActiveListings: remaining,
    }, null, 2));
};

run()
    .catch((error) => {
        console.error('[marketplace-purge] failed', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
