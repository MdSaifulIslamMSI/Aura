require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../models/Product');
const SystemState = require('../models/SystemState');
const logger = require('../utils/logger');

const BATCH_SIZE = 500;

const run = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is required');
    }

    await mongoose.connect(process.env.MONGO_URI);
    logger.info('catalog.backfill.started', {});

    const cursor = Product.find({}, {
        _id: 1,
        id: 1,
        externalId: 1,
        source: 1,
        catalogVersion: 1,
        isPublished: 1,
        title: 1,
        brand: 1,
        category: 1,
        description: 1,
        highlights: 1,
        searchText: 1,
    }).cursor();

    const operations = [];
    let processed = 0;
    let updated = 0;
    let maxId = 1000000;

    for await (const product of cursor) {
        processed += 1;
        if (Number.isFinite(product.id)) {
            maxId = Math.max(maxId, product.id);
        }

        const externalId = product.externalId || (Number.isFinite(product.id)
            ? `legacy_${product.id}`
            : `legacy_oid_${String(product._id)}`);
        const source = product.source || 'manual';
        const catalogVersion = product.catalogVersion || 'legacy-v1';
        const isPublished = typeof product.isPublished === 'boolean' ? product.isPublished : true;
        const searchText = product.searchText || [
            product.title || '',
            product.brand || '',
            product.category || '',
            product.description || '',
            Array.isArray(product.highlights) ? product.highlights.join(' ') : '',
        ].filter(Boolean).join(' | ');

        operations.push({
            updateOne: {
                filter: { _id: product._id },
                update: {
                    $set: {
                        externalId,
                        source,
                        catalogVersion,
                        isPublished,
                        searchText,
                    },
                },
            },
        });

        if (operations.length >= BATCH_SIZE) {
            const result = await Product.bulkWrite(operations, { ordered: false });
            updated += Number(result.modifiedCount || 0);
            operations.length = 0;
        }
    }

    if (operations.length > 0) {
        const result = await Product.bulkWrite(operations, { ordered: false });
        updated += Number(result.modifiedCount || 0);
    }

    await SystemState.updateOne(
        { key: 'singleton' },
        {
            $setOnInsert: { key: 'singleton' },
            $set: {
                activeCatalogVersion: 'legacy-v1',
                previousCatalogVersion: '',
                lastSwitchAt: new Date(),
                manualProductCounter: maxId + 1,
            },
        },
        { upsert: true }
    );

    logger.info('catalog.backfill.completed', {
        processed,
        updated,
        manualProductCounter: maxId + 1,
    });

    await mongoose.disconnect();
};

run().catch(async (error) => {
    logger.error('catalog.backfill.failed', { error: error.message });
    try {
        await mongoose.disconnect();
    } catch {
        // ignore
    }
    process.exit(1);
});
