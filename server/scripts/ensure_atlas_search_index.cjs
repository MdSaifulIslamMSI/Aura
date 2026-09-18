// One-shot maintenance script for the catalog performance indexes.
//
// What it does (idempotent — every step is a no-op when the target exists):
//   1. Creates the sort-covering compound indexes declared on the Product
//      schema (the (isPublished, catalogVersion, <sortKey>, _id:-1) family)
//      so catalog listings stop running in-memory blocking sorts.
//   2. Creates the Atlas Search index used by catalogService keyword search
//      (products_search_v1 by default). Without it, keyword search silently
//      falls back to a double collection scan (regex find + countDocuments).
//
// Deliberately NOT part of boot (syncCriticalIndexes): index builds on the
// ~178MiB products collection should run one at a time, off-peak, on purpose.
// Run with --execute; without it the script only prints the plan.
// Local/driver-based MongoDB (non-Atlas) skips step 2 with a warning — the
// regular indexes still apply.
//
// Usage:
//   npm run indexes:search -- --execute          # apply to MONGO_URI target
//   npm run indexes:search                       # dry-run plan only
//   CATALOG_SEARCH_INDEX_NAME overrides the search index name (same env the
//   runtime reads via config/catalogFlags).
require('dotenv').config();
const mongoose = require('mongoose');
const { flags: catalogFlags } = require('../config/catalogFlags');
const Product = require('../models/Product');
const logger = require('../utils/logger');

const SORT_COVERING_INDEXES = [
    { isPublished: 1, catalogVersion: 1, ratingCount: -1, _id: -1 },
    { isPublished: 1, catalogVersion: 1, rating: -1, _id: -1 },
    { isPublished: 1, catalogVersion: 1, discountPercentage: -1, _id: -1 },
    { isPublished: 1, catalogVersion: 1, price: -1, _id: -1 },
    { isPublished: 1, catalogVersion: 1, createdAt: -1, _id: -1 },
];

// dynamic:false keeps the index small on a 178MiB collection. category is
// mapped twice (string for text search, token for the equals filter clause);
// filter fields (catalogVersion/isPublished/publishGate.status/price/rating/
// discountPercentage) must be mapped because the $search filter clauses
// reference them.
const SEARCH_INDEX_FIELDS = {
    title: { type: 'string' },
    description: { type: 'string' },
    brand: { type: 'string' },
    category: [{ type: 'token' }, { type: 'string' }],
    searchText: { type: 'string' },
    catalogVersion: { type: 'token' },
    isPublished: { type: 'boolean' },
    'publishGate.status': { type: 'token' },
    price: { type: 'number' },
    rating: { type: 'number' },
    discountPercentage: { type: 'number' },
};

const isSearchUnsupportedError = (error = {}) => {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('unrecognized command')
        || message.includes('command not found')
        || message.includes('not supported')
        || message.includes('search indexes require atlas');
};

const listSearchIndexes = async (collectionName) => {
    const response = await mongoose.connection.db.command({ listSearchIndexes: collectionName });
    return response?.cursor?.firstBatch || response?.indexes || [];
};

const ensureSearchIndex = async (collectionName) => {
    const existing = await listSearchIndexes(collectionName);
    const existingNames = new Set(existing.map((entry) => String(entry?.name || '')));
    if (existingNames.has(catalogFlags.catalogSearchIndexName)) {
        logger.info('catalog_index.search_already_exists', {
            collection: collectionName,
            index: catalogFlags.catalogSearchIndexName,
        });
        return { created: false };
    }

    await mongoose.connection.db.command({
        createSearchIndexes: collectionName,
        indexes: [
            {
                name: catalogFlags.catalogSearchIndexName,
                definition: { mappings: { dynamic: false, fields: SEARCH_INDEX_FIELDS } },
            },
        ],
    });
    logger.info('catalog_index.search_created', {
        collection: collectionName,
        index: catalogFlags.catalogSearchIndexName,
    });
    return { created: true };
};

const run = async () => {
    const execute = process.argv.includes('--execute');
    if (!execute) {
        logger.warn('catalog_index.dry_run', {
            message: 'Plan only. Re-run with --execute to apply against MONGO_URI.',
            sortCoveringIndexes: SORT_COVERING_INDEXES.length,
            searchIndex: catalogFlags.catalogSearchIndexName,
        });
        return;
    }

    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is required');
    }

    await mongoose.connect(process.env.MONGO_URI);

    const failures = [];

    for (const keys of SORT_COVERING_INDEXES) {
        try {
            await Product.collection.createIndex(keys);
            logger.info('catalog_index.sort_covering_ensured', { keys });
        } catch (error) {
            failures.push({ step: 'createIndex', keys, error: error.message });
            logger.error('catalog_index.sort_covering_failed', { keys, error: error.message });
        }
    }

    try {
        await ensureSearchIndex('products');
    } catch (error) {
        // Capability probe, not URI sniffing: Atlas URIs come in both srv and
        // non-srv forms, while local mongod simply doesn't know the search
        // commands. Anything else is a real failure.
        if (isSearchUnsupportedError(error)) {
            logger.warn('catalog_index.search_skipped_non_atlas', {
                message: 'This MongoDB does not support search indexes. Regular indexes were applied.',
                error: error.message,
            });
        } else {
            failures.push({ step: 'createSearchIndexes', error: error.message });
            logger.error('catalog_index.search_failed', { error: error.message });
        }
    }

    await mongoose.disconnect();

    if (failures.length > 0) {
        logger.error('catalog_index.completed_with_failures', { failures });
        process.exitCode = 1;
        return;
    }
    logger.info('catalog_index.complete', {});
};

run().catch((error) => {
    logger.error('catalog_index.unhandled_error', { error: error.message });
    process.exit(1);
});
