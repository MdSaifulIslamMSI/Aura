require('dotenv').config();

const mongoose = require('mongoose');
const Product = require('../models/Product');
const SystemState = require('../models/SystemState');

const EXECUTE = process.argv.includes('--execute');

const DEMO_FILTER = {
    $or: [
        { 'provenance.sourceType': 'dev_seed' },
        { 'publishGate.status': 'dev_only' },
        { catalogVersion: /^demo-catalog/i },
        { catalogVersion: /^cat_.*demo/i },
        { 'provenance.sourceRef': /demo_catalog|synthetic_catalog/i },
        { 'provenance.sourceName': /demo catalog/i },
    ],
};

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const isDemoVersion = (value) => /^demo-catalog/i.test(safeString(value));

const connectMongo = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI missing in environment');
    }
    if (mongoose.connection.readyState === 1) return;
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 180000,
        maxPoolSize: 10,
    });
};

const resolveFallbackVersion = async (purgedVersions = []) => {
    const excluded = purgedVersions.filter(Boolean);
    const baseFilter = excluded.length > 0
        ? { catalogVersion: { $nin: excluded } }
        : {};

    const published = await Product.findOne({
        ...baseFilter,
        isPublished: true,
        catalogVersion: { ...(baseFilter.catalogVersion || {}), $exists: true, $ne: '' },
    })
        .sort({ updatedAt: -1, createdAt: -1 })
        .select('catalogVersion')
        .lean();

    if (published?.catalogVersion && !isDemoVersion(published.catalogVersion)) {
        return published.catalogVersion;
    }

    const newest = await Product.findOne({
        ...baseFilter,
        catalogVersion: { ...(baseFilter.catalogVersion || {}), $exists: true, $ne: '' },
    })
        .sort({ updatedAt: -1, createdAt: -1 })
        .select('catalogVersion')
        .lean();

    if (newest?.catalogVersion && !isDemoVersion(newest.catalogVersion)) {
        return newest.catalogVersion;
    }

    return 'legacy-v1';
};

const hasSystemStateCollection = async () => {
    const collections = await mongoose.connection.db.listCollections({ name: 'systemstates' }).toArray();
    return collections.length > 0;
};

const run = async () => {
    await connectMongo();

    const [demoCount, groupedVersions] = await Promise.all([
        Product.countDocuments(DEMO_FILTER),
        Product.aggregate([
            { $match: DEMO_FILTER },
            { $group: { _id: '$catalogVersion', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
        ]),
    ]);

    const purgedVersions = groupedVersions
        .map((entry) => safeString(entry?._id))
        .filter(Boolean);

    console.log(JSON.stringify({
        execute: EXECUTE,
        demoCount,
        purgedVersions,
        groupedVersions,
    }, null, 2));

    if (!EXECUTE) {
        console.log('Preview only. Re-run with --execute to delete demo catalog rows.');
        return;
    }

    const deletion = await Product.deleteMany(DEMO_FILTER);
    const fallbackVersion = await resolveFallbackVersion(purgedVersions);
    let stateUpdate = { modifiedCount: 0, skipped: false };
    if (await hasSystemStateCollection()) {
        stateUpdate = await SystemState.updateMany(
            {
                $or: [
                    { activeCatalogVersion: { $in: purgedVersions } },
                    { previousCatalogVersion: { $in: purgedVersions } },
                ],
            },
            {
                $set: {
                    activeCatalogVersion: fallbackVersion,
                    previousCatalogVersion: '',
                    lastSwitchAt: new Date(),
                },
            }
        );
    } else {
        stateUpdate.skipped = true;
    }

    const remainingDemoCount = await Product.countDocuments(DEMO_FILTER);

    console.log(JSON.stringify({
        deletedCount: deletion.deletedCount || 0,
        fallbackVersion,
        systemStatesUpdated: stateUpdate.modifiedCount || 0,
        systemStateSkipped: Boolean(stateUpdate.skipped),
        remainingDemoCount,
    }, null, 2));
};

run()
    .catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close().catch(() => {});
    });
