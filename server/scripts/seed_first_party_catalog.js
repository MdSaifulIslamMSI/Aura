require('dotenv').config();

const mongoose = require('mongoose');
const crypto = require('crypto');
const Product = require('../models/Product');
const SystemState = require('../models/SystemState');
const { CATEGORY_ORDER, buildProductDocument } = require('../services/firstPartyCatalogGenerator');

const TARGET_TOTAL = Number(process.env.FIRST_PARTY_CATALOG_SIZE || 100000);
const TARGET_VERSION = process.env.FIRST_PARTY_CATALOG_VERSION || 'aura-firstparty-v1';
const BATCH_SIZE = Number(process.env.FIRST_PARTY_CATALOG_BATCH_SIZE || 1000);
const DEFAULT_SYSTEM_KEY = 'singleton';

const hashValue = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const ensureMongo = async () => {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 180000,
        maxPoolSize: 20,
    });
};

const buildOperation = (doc) => ({
    updateOne: {
        filter: {
            externalId: doc.externalId,
            source: doc.source,
            catalogVersion: doc.catalogVersion,
        },
        update: {
            $set: {
                ...doc,
                ingestHash: hashValue(JSON.stringify({
                    title: doc.title,
                    brand: doc.brand,
                    category: doc.category,
                    price: doc.price,
                    originalPrice: doc.originalPrice,
                    discountPercentage: doc.discountPercentage,
                    rating: doc.rating,
                    ratingCount: doc.ratingCount,
                    image: doc.image,
                    description: doc.description,
                    highlights: doc.highlights,
                    specifications: doc.specifications,
                    stock: doc.stock,
                    deliveryTime: doc.deliveryTime,
                    warranty: doc.warranty,
                })),
            },
        },
        upsert: true,
    },
});

const seedCatalog = async () => {
    await ensureMongo();

    const existingCount = await Product.countDocuments({
        source: 'provider',
        catalogVersion: TARGET_VERSION,
    });

    console.log(`[seed] existing provider docs in ${TARGET_VERSION}: ${existingCount}`);

    for (let offset = 0; offset < TARGET_TOTAL; offset += BATCH_SIZE) {
        const ops = [];
        const upper = Math.min(offset + BATCH_SIZE, TARGET_TOTAL);

        for (let globalIndex = offset; globalIndex < upper; globalIndex += 1) {
            const categoryIndex = Math.floor(globalIndex / CATEGORY_ORDER.length);
            const doc = buildProductDocument({
                globalIndex,
                categoryIndex,
                catalogVersion: TARGET_VERSION,
                source: 'provider',
            });
            ops.push(buildOperation(doc));
        }

        await Product.bulkWrite(ops, { ordered: false });

        if (upper % 10000 === 0 || upper === TARGET_TOTAL) {
            console.log(`[seed] upserted ${upper}/${TARGET_TOTAL}`);
        }
    }

    await Product.updateMany(
        { catalogVersion: { $ne: TARGET_VERSION } },
        { $set: { isPublished: false } }
    );
    await Product.updateMany(
        { catalogVersion: TARGET_VERSION },
        { $set: { isPublished: true } }
    );

    await SystemState.findOneAndUpdate(
        { key: DEFAULT_SYSTEM_KEY },
        {
            $set: {
                key: DEFAULT_SYSTEM_KEY,
                activeCatalogVersion: TARGET_VERSION,
                previousCatalogVersion: 'legacy-v1',
                lastSwitchAt: new Date(),
                catalogLastImportAt: new Date(),
            },
            $setOnInsert: {
                manualProductCounter: 1000000,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const counts = await Promise.all(CATEGORY_ORDER.map(async (category) => ({
        category,
        count: await Product.countDocuments({ catalogVersion: TARGET_VERSION, isPublished: true, category }),
    })));

    const total = await Product.countDocuments({ catalogVersion: TARGET_VERSION, isPublished: true });
    console.log(JSON.stringify({
        catalogVersion: TARGET_VERSION,
        total,
        categories: counts,
    }, null, 2));
};

seedCatalog()
    .catch((error) => {
        console.error('[seed:fatal]', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
