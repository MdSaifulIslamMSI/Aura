require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const logger = require('../utils/logger');

const BATCH_SIZE = 500;

// Recomputes User.lifetimeSpent / User.lifetimeSpentMinor as the gross sums of
// Order.totalPrice / Order.totalPriceMinor per user. Matches the legacy
// dashboard aggregate semantics exactly: ALL orders (including cancelled),
// base currency units, no refund subtraction.
// Idempotent: sets absolute values, safe to re-run to repair drift.
// Run server/scripts/audit_money_minor_units.js first so orders carry
// totalPriceMinor; users whose orders predate minor units keep float-only.
const run = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is required');
    }

    await mongoose.connect(process.env.MONGO_URI);
    logger.info('lifetime_spent.backfill.started', {});

    const totals = await Order.aggregate([
        {
            $group: {
                _id: '$user',
                total: { $sum: '$totalPrice' },
                totalMinor: { $sum: '$totalPriceMinor' },
            },
        },
    ]);

    let updated = 0;
    for (let i = 0; i < totals.length; i += BATCH_SIZE) {
        const batch = totals.slice(i, i + BATCH_SIZE);
        const operations = batch
            .filter((entry) => entry._id && Number.isFinite(Number(entry.total)))
            .map((entry) => {
                const update = { lifetimeSpent: Number(entry.total) };
                if (Number.isFinite(Number(entry.totalMinor)) && Number(entry.totalMinor) > 0) {
                    update.lifetimeSpentMinor = Number(entry.totalMinor);
                }
                return {
                    updateOne: {
                        filter: { _id: entry._id },
                        update: { $set: update },
                    },
                };
            });
        if (operations.length === 0) continue;
        const result = await User.bulkWrite(operations, { ordered: false });
        updated += Number(result?.matchedCount || 0);
        logger.info('lifetime_spent.backfill.batch', {
            batch: Math.floor(i / BATCH_SIZE) + 1,
            users: operations.length,
        });
    }

    logger.info('lifetime_spent.backfill.completed', { usersWithOrders: totals.length, updated });
};

if (require.main === module) {
    run()
        .then(() => process.exit(0))
        .catch((error) => {
            logger.error('lifetime_spent.backfill.failed', { error: error?.message || String(error) });
            process.exit(1);
        });
}

module.exports = { run };
