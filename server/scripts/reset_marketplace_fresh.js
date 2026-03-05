require('dotenv').config();

const mongoose = require('mongoose');
const Listing = require('../models/Listing');
const TradeIn = require('../models/TradeIn');
const PaymentIntent = require('../models/PaymentIntent');
const PaymentEvent = require('../models/PaymentEvent');
const PaymentOutboxTask = require('../models/PaymentOutboxTask');

const MARKETPLACE_INTENT_FILTER = {
    $or: [
        { 'metadata.listingId': { $exists: true, $ne: '' } },
        { 'metadata.paymentPurpose': 'marketplace_escrow' },
        { 'metadata.channel': 'marketplace' },
    ],
};

const runSnapshot = async () => {
    const [totalListings, activeListings, soldListings, tradeInsWithListing, marketplaceIntents] = await Promise.all([
        Listing.countDocuments({}),
        Listing.countDocuments({ status: 'active' }),
        Listing.countDocuments({ status: 'sold' }),
        TradeIn.countDocuments({ listing: { $exists: true, $ne: null } }),
        PaymentIntent.countDocuments(MARKETPLACE_INTENT_FILTER),
    ]);

    let paymentEvents = 0;
    let paymentOutboxTasks = 0;

    if (marketplaceIntents > 0) {
        const intents = await PaymentIntent.find(MARKETPLACE_INTENT_FILTER).select('intentId').lean();
        const intentIds = intents.map((entry) => entry.intentId).filter(Boolean);
        if (intentIds.length > 0) {
            [paymentEvents, paymentOutboxTasks] = await Promise.all([
                PaymentEvent.countDocuments({ intentId: { $in: intentIds } }),
                PaymentOutboxTask.countDocuments({ intentId: { $in: intentIds } }),
            ]);
        }
    }

    return {
        listings: {
            total: totalListings,
            active: activeListings,
            sold: soldListings,
        },
        tradeInsLinkedToListings: tradeInsWithListing,
        marketplacePaymentIntents: marketplaceIntents,
        marketplacePaymentEvents: paymentEvents,
        marketplaceOutboxTasks: paymentOutboxTasks,
    };
};

const run = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI missing in environment');
    }

    const execute = process.argv.includes('--execute');
    await mongoose.connect(process.env.MONGO_URI);

    const before = await runSnapshot();
    console.log('[marketplace-reset] snapshot_before');
    console.log(JSON.stringify(before, null, 2));

    if (!execute) {
        console.log('[marketplace-reset] dry run only. Re-run with --execute to delete marketplace data.');
        return;
    }

    const session = await mongoose.startSession();
    const summary = {
        deletedListings: 0,
        deletedTradeIns: 0,
        deletedPaymentIntents: 0,
        deletedPaymentEvents: 0,
        deletedPaymentOutboxTasks: 0,
    };

    try {
        await session.withTransaction(async () => {
            const intents = await PaymentIntent.find(MARKETPLACE_INTENT_FILTER).select('intentId').session(session).lean();
            const intentIds = intents.map((entry) => entry.intentId).filter(Boolean);

            const [listingDelete, tradeInDelete] = await Promise.all([
                Listing.deleteMany({}, { session }),
                TradeIn.deleteMany({ listing: { $exists: true, $ne: null } }, { session }),
            ]);

            summary.deletedListings = listingDelete.deletedCount || 0;
            summary.deletedTradeIns = tradeInDelete.deletedCount || 0;

            if (intentIds.length > 0) {
                const [outboxDelete, eventDelete, intentDelete] = await Promise.all([
                    PaymentOutboxTask.deleteMany({ intentId: { $in: intentIds } }, { session }),
                    PaymentEvent.deleteMany({ intentId: { $in: intentIds } }, { session }),
                    PaymentIntent.deleteMany({ intentId: { $in: intentIds } }, { session }),
                ]);

                summary.deletedPaymentOutboxTasks = outboxDelete.deletedCount || 0;
                summary.deletedPaymentEvents = eventDelete.deletedCount || 0;
                summary.deletedPaymentIntents = intentDelete.deletedCount || 0;
            }
        });
    } finally {
        await session.endSession();
    }

    const after = await runSnapshot();
    console.log('[marketplace-reset] deleted');
    console.log(JSON.stringify(summary, null, 2));
    console.log('[marketplace-reset] snapshot_after');
    console.log(JSON.stringify(after, null, 2));
};

run()
    .catch((error) => {
        console.error('[marketplace-reset] failed', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });

