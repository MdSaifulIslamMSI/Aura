/* eslint-disable no-console */
const mongoose = require('mongoose');
const { isValidObjectId } = require('mongoose');
const { loadLocalEnvFiles } = require('../config/runtimeConfig');
const connectDB = require('../config/db');
const Listing = require('../models/Listing');
const ProductReview = require('../models/ProductReview');
const TradeIn = require('../models/TradeIn');
const PriceAlert = require('../models/PriceAlert');
const User = require('../models/User');
const { EXPECTED_INDEXES } = require('../services/accountCenterMigrationService');

const EXPECTED_QUERY_INDEXES = Object.freeze({
    listings: 'listing_owner_history',
    reviews: 'product_review_owner_history',
    tradeIns: 'trade_in_owner_history',
    priceAlerts: 'price_alert_owner_history',
});

const findIndexName = (plan = {}) => {
    if (plan.indexName) return String(plan.indexName);
    return Object.values(plan).reduce((found, value) => {
        if (found) return found;
        if (value && typeof value === 'object') return findIndexName(value);
        return '';
    }, '');
};

const toEvidence = (name, explain = {}) => {
    const execution = explain.executionStats || {};
    const returned = Number(execution.nReturned || 0);
    const examined = Number(execution.totalDocsExamined || 0);
    return {
        name,
        indexName: findIndexName(explain.queryPlanner?.winningPlan || {}),
        nReturned: returned,
        totalDocsExamined: examined,
        examinedPerReturned: returned > 0 ? Number((examined / returned).toFixed(2)) : examined,
        executionTimeMillis: Number(execution.executionTimeMillis || 0),
    };
};

const assertStrictEvidence = (evidence = {}, { explainEnabled = false } = {}) => {
    const missing = Array.isArray(evidence?.indexes?.missing) ? evidence.indexes.missing : [];
    if (missing.length > 0) {
        throw new Error(`Account Center query indexes are missing: ${missing.join(', ')}`);
    }
    if (!explainEnabled) return evidence;

    const planByName = new Map(
        (Array.isArray(evidence.queryPlans) ? evidence.queryPlans : [])
            .map((entry) => [String(entry?.name || ''), String(entry?.indexName || '')])
    );
    const invalidPlans = Object.entries(EXPECTED_QUERY_INDEXES)
        .filter(([name, expectedIndex]) => planByName.get(name) !== expectedIndex)
        .map(([name, expectedIndex]) => `${name}:${expectedIndex}`);
    if (invalidPlans.length > 0) {
        throw new Error(`Account Center query plans did not use the required indexes: ${invalidPlans.join(', ')}`);
    }
    return evidence;
};

const run = async ({ argv = process.argv.slice(2) } = {}) => {
    loadLocalEnvFiles();
    const ownerArg = argv.find((entry) => String(entry).startsWith('--owner-id='));
    const ownerEnvArg = argv.find((entry) => String(entry).startsWith('--owner-from-env='));
    let ownerId = String(ownerArg || '').slice('--owner-id='.length).trim();
    const ownerEnvName = String(ownerEnvArg || '').slice('--owner-from-env='.length).trim();
    const explainEnabled = argv.includes('--explain');
    const strictEnabled = argv.includes('--strict');
    if (ownerEnvName && !/^[A-Z][A-Z0-9_]{1,63}$/.test(ownerEnvName)) {
        throw new Error('--owner-from-env requires a safe environment variable name');
    }
    await connectDB();
    if (explainEnabled && !ownerId && ownerEnvName) {
        const ownerEmail = String(process.env[ownerEnvName] || '').trim().toLowerCase();
        const owner = ownerEmail
            ? await User.findOne({ email: ownerEmail }).select('_id').lean()
            : null;
        ownerId = String(owner?._id || '').trim();
    }
    if (explainEnabled && !isValidObjectId(ownerId)) {
        throw new Error('--explain requires a resolvable owner; the identifier is never printed');
    }
    const models = [Listing, ProductReview, TradeIn, PriceAlert];
    const indexGroups = await Promise.all(models.map(
        (model) => model.collection.indexes().catch(() => [])
    ));
    const indexNames = indexGroups.flat().map((index) => String(index?.name || '')).filter(Boolean);
    const missingIndexes = EXPECTED_INDEXES
        .filter((name) => !name.startsWith('account_privacy_job_'))
        .filter((name) => !indexNames.includes(name));
    const evidence = {
        indexes: {
            expected: EXPECTED_INDEXES.filter((name) => !name.startsWith('account_privacy_job_')),
            missing: missingIndexes,
        },
        queryPlans: [],
    };
    if (explainEnabled) {
        const queries = [
            ['listings', Listing.find({ seller: ownerId }).sort({ createdAt: -1, _id: -1 }).limit(6)],
            ['reviews', ProductReview.find({ user: ownerId }).sort({ createdAt: -1, _id: -1 }).limit(6)],
            ['tradeIns', TradeIn.find({ user: ownerId }).sort({ createdAt: -1, _id: -1 }).limit(6)],
            ['priceAlerts', PriceAlert.find({ user: ownerId }).sort({ createdAt: -1, _id: -1 }).limit(6)],
        ];
        evidence.queryPlans = await Promise.all(queries.map(
            async ([name, query]) => toEvidence(name, await query.explain('executionStats'))
        ));
    }
    if (strictEnabled) {
        assertStrictEvidence(evidence, { explainEnabled });
    }
    return evidence;
};

if (require.main === module) {
    run()
        .then((evidence) => process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`))
        .catch((error) => {
            process.stderr.write(`${String(error?.message || 'Account query verification failed').slice(0, 500)}\n`);
            process.exitCode = 1;
        })
        .finally(async () => {
            if (mongoose.connection.readyState !== 0) {
                await mongoose.connection.close().catch(() => null);
            }
        });
}

module.exports = {
    EXPECTED_QUERY_INDEXES,
    assertStrictEvidence,
    findIndexName,
    run,
    toEvidence,
};
