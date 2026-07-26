/* eslint-disable no-console */
const mongoose = require('mongoose');
const { isValidObjectId } = require('mongoose');
const { loadLocalEnvFiles } = require('../config/runtimeConfig');
const connectDB = require('../config/db');
const Listing = require('../models/Listing');
const ProductReview = require('../models/ProductReview');
const TradeIn = require('../models/TradeIn');
const PriceAlert = require('../models/PriceAlert');
const { EXPECTED_INDEXES } = require('../services/accountCenterMigrationService');

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

const run = async ({ argv = process.argv.slice(2) } = {}) => {
    loadLocalEnvFiles();
    const ownerArg = argv.find((entry) => String(entry).startsWith('--owner-id='));
    const ownerId = String(ownerArg || '').slice('--owner-id='.length).trim();
    const explainEnabled = argv.includes('--explain');
    if (explainEnabled && !isValidObjectId(ownerId)) {
        throw new Error('--explain requires a valid --owner-id; the identifier is never printed');
    }
    await connectDB();
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
    findIndexName,
    run,
    toEvidence,
};
