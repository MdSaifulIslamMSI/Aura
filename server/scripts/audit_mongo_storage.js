require('dotenv').config();

const mongoose = require('mongoose');
const { assertMongoUriContract, buildMongoConnectionOptions } = require('../config/db');

const TOP_COLLECTION_LIMIT = 30;
const HIGH_INDEX_COUNT = 20;
const COLLECTION_STATS_CONCURRENCY = 5;
const TOP_INDEX_USAGE_LIMIT = 5;
const UNUSED_INDEX_NAME_LIMIT = 10;

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

const summarizeIndexUsageStats = (name, stats = []) => {
    const indexes = stats
        .map((entry) => ({
            name: String(entry.name || ''),
            ops: toNumber(entry.accesses?.ops),
            since: entry.accesses?.since || null,
        }))
        .filter((entry) => entry.name);
    const nonIdIndexes = indexes.filter((entry) => entry.name !== '_id_');
    const unusedNonIdIndexes = nonIdIndexes.filter((entry) => entry.ops === 0);
    const totalOps = indexes.reduce((total, entry) => total + entry.ops, 0);

    return {
        name,
        indexCountWithUsage: indexes.length,
        totalIndexOps: totalOps,
        unusedNonIdIndexCount: unusedNonIdIndexes.length,
        unusedNonIdIndexNames: unusedNonIdIndexes
            .slice(0, UNUSED_INDEX_NAME_LIMIT)
            .map((entry) => entry.name),
        topIndexesByOps: [...indexes]
            .sort((left, right) => right.ops - left.ops)
            .slice(0, TOP_INDEX_USAGE_LIMIT)
            .map((entry) => ({
                name: entry.name,
                ops: entry.ops,
                since: entry.since,
            })),
    };
};

const flattenWinningPlanStages = (plan, output = []) => {
    if (!plan || typeof plan !== 'object') return output;
    if (plan.stage) output.push(String(plan.stage));
    for (const key of ['inputStage', 'inputStages', 'outerStage', 'innerStage', 'thenStage', 'elseStage']) {
        const value = plan[key];
        if (Array.isArray(value)) {
            value.forEach((entry) => flattenWinningPlanStages(entry, output));
        } else {
            flattenWinningPlanStages(value, output);
        }
    }
    if (Array.isArray(plan.shards)) {
        plan.shards.forEach((shard) => flattenWinningPlanStages(shard.winningPlan || shard, output));
    }
    return output;
};

const collectWinningIndexNames = (plan, output = new Set()) => {
    if (!plan || typeof plan !== 'object') return output;
    if (plan.indexName) output.add(String(plan.indexName));
    for (const value of Object.values(plan)) {
        if (Array.isArray(value)) {
            value.forEach((entry) => collectWinningIndexNames(entry, output));
        } else if (value && typeof value === 'object') {
            collectWinningIndexNames(value, output);
        }
    }
    return output;
};

const shapeValue = (value) => {
    if (Array.isArray(value)) return value.map(shapeValue);
    if (!value || typeof value !== 'object' || value instanceof Date) return '?';
    return Object.keys(value).sort().reduce((acc, key) => {
        acc[key] = key.startsWith('$') ? shapeValue(value[key]) : shapeValue(value[key]);
        return acc;
    }, {});
};

const queryShape = ({ filter = {}, sort = {} }) => ({
    filter: shapeValue(filter),
    sort: Object.keys(sort).sort().reduce((acc, key) => {
        acc[key] = sort[key] === -1 ? -1 : 1;
        return acc;
    }, {}),
});

const explainQuerySpecs = Object.freeze([
    {
        id: 'products.published-category-price',
        collection: 'products',
        filter: { isPublished: true, catalogVersion: 'legacy-v1', category: 'Mobiles' },
        sort: { price: 1, _id: 1 },
    },
    {
        id: 'products.published-brand',
        collection: 'products',
        filter: { isPublished: true, catalogVersion: 'legacy-v1', brand: 'Apple' },
        sort: { _id: 1 },
    },
    {
        id: 'products.publish-governance',
        collection: 'products',
        filter: { catalogVersion: 'legacy-v1', 'publishGate.status': 'approved', 'provenance.datasetClass': 'real' },
        sort: { _id: 1 },
    },
    {
        id: 'products.sponsored-placement',
        collection: 'products',
        filter: {
            'adCampaign.isSponsored': true,
            'adCampaign.status': 'active',
            category: 'Mobiles',
            brand: 'Apple',
        },
        sort: {
            'adCampaign.priority': -1,
            'adCampaign.cpcBid': -1,
            _id: 1,
        },
    },
    {
        id: 'frauddecisions.open-review-queue',
        collection: 'frauddecisions',
        filter: { 'review.status': 'open', 'review.queue': 'manual' },
        sort: { createdAt: -1, _id: -1 },
    },
    {
        id: 'frauddecisions.user-history',
        collection: 'frauddecisions',
        filter: { user: '000000000000000000000000' },
        sort: { createdAt: -1, _id: -1 },
    },
    {
        id: 'frauddecisions.subject-history',
        collection: 'frauddecisions',
        filter: { 'subject.subjectType': 'order', 'subject.subjectId': '000000000000000000000000' },
        sort: { createdAt: -1, _id: -1 },
    },
]);

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

const getCollectionIndexUsage = async (db, name) => {
    try {
        const stats = await db.collection(name)
            .aggregate([{ $indexStats: {} }], { maxTimeMS: 10000 })
            .toArray();
        return summarizeIndexUsageStats(name, stats);
    } catch (error) {
        return {
            name,
            error: redactMongoCredential(error?.message || error),
        };
    }
};

const explainQueryShape = async (db, spec) => {
    try {
        const explain = await db.collection(spec.collection)
            .find(spec.filter)
            .sort(spec.sort)
            .limit(1)
            .maxTimeMS(5000)
            .explain('queryPlanner');
        const winningPlan = explain?.queryPlanner?.winningPlan || {};
        const stages = flattenWinningPlanStages(winningPlan);
        const winningIndexNames = [...collectWinningIndexNames(winningPlan)];

        return {
            id: spec.id,
            collection: spec.collection,
            ok: true,
            shape: queryShape(spec),
            winningIndexNames,
            usesCollectionScan: stages.includes('COLLSCAN'),
            stageSummary: [...new Set(stages)].slice(0, 8),
        };
    } catch (error) {
        return {
            id: spec.id,
            collection: spec.collection,
            ok: false,
            shape: queryShape(spec),
            error: redactMongoCredential(error?.message || error),
        };
    }
};

const explainCuratedQueryShapes = async (db, collectionNames) => {
    const existing = new Set(collectionNames);
    const specs = explainQuerySpecs.filter((spec) => existing.has(spec.collection));
    return mapWithConcurrency(specs, COLLECTION_STATS_CONCURRENCY, (spec) => explainQueryShape(db, spec));
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
    const indexUsageStats = await mapWithConcurrency(
        collectionNames,
        COLLECTION_STATS_CONCURRENCY,
        (name) => getCollectionIndexUsage(db, name)
    );
    const queryPlans = await explainCuratedQueryShapes(db, collectionNames);

    const topCollections = collectionStats
        .sort((left, right) => toNumber(right.totalFootprintMiB) - toNumber(left.totalFootprintMiB))
        .slice(0, TOP_COLLECTION_LIMIT);
    const summary = summarizeDbStats(dbStats);
    const highIndexCollections = collectionStats
        .filter((collection) => toNumber(collection.indexCount) >= HIGH_INDEX_COUNT)
        .map((collection) => ({ name: collection.name, indexCount: collection.indexCount }));
    const indexStatsUnauthorized = indexUsageStats.length > 0
        && indexUsageStats.every((entry) => /\[indexStats\]/i.test(String(entry.error || '')));
    const indexUsageUnavailableReason = indexStatsUnauthorized ? 'indexStats_not_authorized' : '';
    const indexUsageByName = new Map(indexUsageStats.map((entry) => [entry.name, entry]));
    const highUnusedIndexCollections = indexUsageStats
        .filter((entry) => !entry.error && toNumber(entry.unusedNonIdIndexCount) >= 5)
        .sort((left, right) => toNumber(right.unusedNonIdIndexCount) - toNumber(left.unusedNonIdIndexCount))
        .slice(0, 10)
        .map((entry) => ({
            name: entry.name,
            unusedNonIdIndexCount: entry.unusedNonIdIndexCount,
            unusedNonIdIndexNames: entry.unusedNonIdIndexNames,
            totalIndexOps: entry.totalIndexOps,
        }));
    const queryPlansUsingCollectionScan = queryPlans
        .filter((plan) => plan.ok && plan.usesCollectionScan)
        .map((plan) => plan.id);
    const findings = [];
    if (!hello?.setName) findings.push('MongoDB deployment is not a replica set; multi-document transaction durability is unavailable.');
    if (!(hello?.isWritablePrimary ?? hello?.ismaster)) findings.push('MongoDB deployment does not currently report a writable primary.');
    if (summary.indexToDataRatio > 1) findings.push('Database indexes are larger than document data; review live query plans before removing indexes.');
    if (highIndexCollections.length > 0) findings.push(`Collections at or above ${HIGH_INDEX_COUNT} indexes may have elevated write amplification.`);
    if (highUnusedIndexCollections.length > 0) findings.push('Live index usage stats show collections with several non-_id indexes at zero observed operations; keep observing before dropping indexes.');
    if (indexUsageUnavailableReason) findings.push('MongoDB user cannot run $indexStats; grant read-only indexStats evidence access before removing any live index.');
    if (queryPlansUsingCollectionScan.length > 0) findings.push(`Curated query plans used collection scans: ${queryPlansUsingCollectionScan.join(', ')}.`);

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
        topCollections: topCollections.map((collection) => ({
            ...collection,
            indexUsage: indexUsageUnavailableReason
                ? { unavailableReason: indexUsageUnavailableReason }
                : (indexUsageByName.get(collection.name) || null),
        })),
        highIndexCollections,
        indexUsage: {
            unavailableReason: indexUsageUnavailableReason || null,
            collectionsWithStats: indexUsageStats.filter((entry) => !entry.error).length,
            collectionsWithErrors: indexUsageStats.filter((entry) => entry.error).length,
            highUnusedIndexCollections,
        },
        queryPlans,
        findings,
        collectionCount: collectionStats.length,
        note: 'Read-only report. No documents, tokens, connection strings, or secrets are printed.',
    }, null, 2));
};

module.exports = {
    collectWinningIndexNames,
    explainQuerySpecs,
    flattenWinningPlanStages,
    queryShape,
    summarizeIndexUsageStats,
};

if (require.main === module) {
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
}
