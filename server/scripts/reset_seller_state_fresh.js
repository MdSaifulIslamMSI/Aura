require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/User');

const TIERS = [
    { name: 'Rookie', minLifetime: 0, nextMilestone: 500 },
    { name: 'Pro', minLifetime: 500, nextMilestone: 2000 },
    { name: 'Elite', minLifetime: 2000, nextMilestone: 5000 },
    { name: 'Legend', minLifetime: 5000, nextMilestone: 12000 },
    { name: 'Mythic', minLifetime: 12000, nextMilestone: null },
];

const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const resolveTier = (lifetimeEarned = 0) => {
    const earned = toNumber(lifetimeEarned, 0);
    let selected = TIERS[0];
    for (const tier of TIERS) {
        if (earned >= tier.minLifetime) {
            selected = tier;
        }
    }
    return selected;
};

const isListingLedgerEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return false;
    return entry.eventType === 'listing_created' || entry.refType === 'listing';
};

const snapshot = async () => {
    const [sellerUsers, sellerActivatedUsers, usersWithListingLedger] = await Promise.all([
        User.countDocuments({ isSeller: true }),
        User.countDocuments({ sellerActivatedAt: { $ne: null } }),
        User.countDocuments({
            $or: [
                { 'loyalty.ledger.eventType': 'listing_created' },
                { 'loyalty.ledger.refType': 'listing' },
            ],
        }),
    ]);

    const listingLedgerAgg = await User.aggregate([
        { $match: { loyalty: { $exists: true }, 'loyalty.ledger.0': { $exists: true } } },
        { $unwind: '$loyalty.ledger' },
        {
            $match: {
                $or: [
                    { 'loyalty.ledger.eventType': 'listing_created' },
                    { 'loyalty.ledger.refType': 'listing' },
                ],
            },
        },
        {
            $group: {
                _id: null,
                entries: { $sum: 1 },
                points: { $sum: { $ifNull: ['$loyalty.ledger.points', 0] } },
            },
        },
    ]);

    const listingLedger = listingLedgerAgg[0] || { entries: 0, points: 0 };

    return {
        users: {
            isSellerTrue: sellerUsers,
            sellerActivatedAtSet: sellerActivatedUsers,
            withListingLedgerEntries: usersWithListingLedger,
        },
        listingLoyalty: {
            entries: toNumber(listingLedger.entries, 0),
            points: toNumber(listingLedger.points, 0),
        },
    };
};

const run = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI missing in environment');
    }

    const execute = process.argv.includes('--execute');
    await mongoose.connect(process.env.MONGO_URI);

    const before = await snapshot();
    console.log('[seller-reset] snapshot_before');
    console.log(JSON.stringify(before, null, 2));

    if (!execute) {
        console.log('[seller-reset] dry run only. Re-run with --execute to apply changes.');
        return;
    }

    const users = await User.find({
        $or: [
            { isSeller: true },
            { sellerActivatedAt: { $ne: null } },
            { 'loyalty.ledger.eventType': 'listing_created' },
            { 'loyalty.ledger.refType': 'listing' },
        ],
    }).select('_id isSeller sellerActivatedAt loyalty');

    let usersTouched = 0;
    let usersSellerRevoked = 0;
    let removedLedgerEntries = 0;
    let removedLedgerPoints = 0;

    for (const user of users) {
        let changed = false;

        if (user.isSeller || user.sellerActivatedAt) {
            if (user.isSeller) usersSellerRevoked += 1;
            user.isSeller = false;
            user.sellerActivatedAt = null;
            changed = true;
        }

        if (user.loyalty && Array.isArray(user.loyalty.ledger) && user.loyalty.ledger.length > 0) {
            const keep = [];
            const removed = [];

            for (const entry of user.loyalty.ledger) {
                if (isListingLedgerEntry(entry)) {
                    removed.push(entry);
                } else {
                    keep.push(entry);
                }
            }

            if (removed.length > 0) {
                const removedPoints = removed.reduce((sum, entry) => sum + toNumber(entry.points, 0), 0);
                const removedEarned = removed.reduce((sum, entry) => {
                    const points = toNumber(entry.points, 0);
                    return sum + (points > 0 ? points : 0);
                }, 0);

                removedLedgerEntries += removed.length;
                removedLedgerPoints += removedPoints;

                user.loyalty.ledger = keep;
                user.loyalty.pointsBalance = Math.max(0, toNumber(user.loyalty.pointsBalance, 0) - Math.max(0, removedPoints));
                user.loyalty.lifetimeEarned = Math.max(0, toNumber(user.loyalty.lifetimeEarned, 0) - removedEarned);

                const tier = resolveTier(user.loyalty.lifetimeEarned);
                user.loyalty.tier = tier.name;
                user.loyalty.nextMilestone = tier.nextMilestone;
                user.loyalty.lastEarnedAt = keep[0]?.createdAt || null;
                changed = true;
            }
        }

        if (changed) {
            await user.save();
            usersTouched += 1;
        }
    }

    const after = await snapshot();
    console.log('[seller-reset] changed');
    console.log(JSON.stringify({
        usersTouched,
        usersSellerRevoked,
        removedLedgerEntries,
        removedLedgerPoints,
    }, null, 2));
    console.log('[seller-reset] snapshot_after');
    console.log(JSON.stringify(after, null, 2));
};

run()
    .catch((error) => {
        console.error('[seller-reset] failed', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });

