require('dotenv').config();

const mongoose = require('mongoose');

const TOP_COLLECTION_LIMIT = 30;

const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const toMiB = (value) => Math.round((toNumber(value) / 1024 / 1024) * 100) / 100;

const redactMongoCredential = (value) => String(value || '')
    .replace(/mongodb(\+srv)?:\/\/[^@\s]+@/gi, 'mongodb$1://<redacted>@');

const summarizeDbStats = (stats = {}) => ({
    collections: toNumber(stats.collections),
    objects: toNumber(stats.objects),
    dataSizeMiB: toMiB(stats.dataSize),
    storageSizeMiB: toMiB(stats.storageSize),
    indexSizeMiB: toMiB(stats.indexSize),
    totalSizeMiB: toMiB(toNumber(stats.storageSize) + toNumber(stats.indexSize)),
});

const summarizeCollectionStats = (stats = {}) => ({
    name: String(stats.ns || '').split('.').slice(1).join('.') || String(stats.name || ''),
    count: toNumber(stats.count),
    avgObjSizeBytes: toNumber(stats.avgObjSize),
    dataSizeMiB: toMiB(stats.size),
    storageSizeMiB: toMiB(stats.storageSize),
    totalIndexSizeMiB: toMiB(stats.totalIndexSize),
    totalFootprintMiB: toMiB(toNumber(stats.storageSize) + toNumber(stats.totalIndexSize)),
    indexCount: Object.keys(stats.indexSizes || {}).length,
});

const connectMongo = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI missing in environment');
    }

    if (mongoose.connection.readyState === 1) return;

    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 120000,
        maxPoolSize: 5,
    });
};

const listCollectionNames = async (db) => {
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    return collections
        .map((collection) => String(collection.name || '').trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
};

const getCollectionStats = async (db, name) => {
    try {
        const stats = await db.command({ collStats: name });
        return summarizeCollectionStats({ ...stats, name });
    } catch (error) {
        return {
            name,
            error: redactMongoCredential(error?.message || error),
        };
    }
};

const run = async () => {
    await connectMongo();

    const db = mongoose.connection.db;
    const [dbStats, collectionNames] = await Promise.all([
        db.stats(),
        listCollectionNames(db),
    ]);

    const collectionStats = [];
    for (const name of collectionNames) {
        collectionStats.push(await getCollectionStats(db, name));
    }

    const topCollections = collectionStats
        .sort((left, right) => toNumber(right.totalFootprintMiB) - toNumber(left.totalFootprintMiB))
        .slice(0, TOP_COLLECTION_LIMIT);

    console.log(JSON.stringify({
        ok: true,
        database: db.databaseName,
        generatedAt: new Date().toISOString(),
        summary: summarizeDbStats(dbStats),
        topCollections,
        collectionCount: collectionStats.length,
        note: 'Read-only report. No documents, tokens, connection strings, or secrets are printed.',
    }, null, 2));
};

run()
    .catch((error) => {
        console.error(JSON.stringify({
            ok: false,
            error: redactMongoCredential(error?.message || error),
        }, null, 2));
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close().catch(() => {});
    });
