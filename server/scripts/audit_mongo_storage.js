require('dotenv').config();

const mongoose = require('mongoose');
const { assertMongoUriContract, buildMongoConnectionOptions } = require('../config/db');

const TOP_COLLECTION_LIMIT = 30;
const HIGH_INDEX_COUNT = 20;
const COLLECTION_STATS_CONCURRENCY = 5;

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
    indexToDataRatio: toNumber(stats.dataSize) > 0
        ? Math.round((toNumber(stats.indexSize) / toNumber(stats.dataSize)) * 100) / 100
        : 0,
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
    if (mongoose.connection.readyState === 1) return;

    const uri = assertMongoUriContract(process.env);
    await mongoose.connect(uri, {
        ...buildMongoConnectionOptions(process.env),
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
        const stats = await db.command({ collStats: name, maxTimeMS: 10000 });
        return summarizeCollectionStats({ ...stats, name });
    } catch (error) {
        return {
            name,
            error: redactMongoCredential(error?.message || error),
        };
    }
};

const mapWithConcurrency = async (values, concurrency, mapper) => {
    const results = new Array(values.length);
    let nextIndex = 0;

    const worker = async () => {
        while (nextIndex < values.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await mapper(values[currentIndex]);
        }
    };

    await Promise.all(Array.from(
        { length: Math.min(concurrency, values.length) },
        () => worker()
    ));
    return results;
};

const run = async () => {
    await connectMongo();

    const db = mongoose.connection.db;
    const [dbStats, collectionNames] = await Promise.all([
        db.stats(),
        listCollectionNames(db),
    ]);
    const hello = await db.admin().command({ hello: 1 });

    const collectionStats = await mapWithConcurrency(
        collectionNames,
        COLLECTION_STATS_CONCURRENCY,
        (name) => getCollectionStats(db, name)
    );

    const topCollections = collectionStats
        .sort((left, right) => toNumber(right.totalFootprintMiB) - toNumber(left.totalFootprintMiB))
        .slice(0, TOP_COLLECTION_LIMIT);
    const summary = summarizeDbStats(dbStats);
    const highIndexCollections = collectionStats
        .filter((collection) => toNumber(collection.indexCount) >= HIGH_INDEX_COUNT)
        .map((collection) => ({ name: collection.name, indexCount: collection.indexCount }));
    const findings = [];
    if (!hello?.setName) findings.push('MongoDB deployment is not a replica set; multi-document transaction durability is unavailable.');
    if (!(hello?.isWritablePrimary ?? hello?.ismaster)) findings.push('MongoDB deployment does not currently report a writable primary.');
    if (summary.indexToDataRatio > 1) findings.push('Database indexes are larger than document data; review live query plans before removing indexes.');
    if (highIndexCollections.length > 0) findings.push(`Collections at or above ${HIGH_INDEX_COUNT} indexes may have elevated write amplification.`);

    console.log(JSON.stringify({
        ok: true,
        database: db.databaseName,
        generatedAt: new Date().toISOString(),
        topology: {
            replicaSet: Boolean(hello?.setName),
            isWritablePrimary: Boolean(hello?.isWritablePrimary ?? hello?.ismaster),
            logicalSessionTimeoutMinutes: Number.isFinite(Number(hello?.logicalSessionTimeoutMinutes))
                ? Number(hello.logicalSessionTimeoutMinutes)
                : null,
        },
        summary,
        topCollections,
        highIndexCollections,
        findings,
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
