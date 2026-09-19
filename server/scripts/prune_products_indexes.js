/**
 * Data-driven index pruning for the products collection (Atlas M0).
 *
 * products carries ~34 indexes (~82MB on a 512MB shared cluster — the
 * dominant storage consumer alongside the 228MB of documents). Several
 * single-field indexes predate the catalogVersion sort-covering compounds
 * and may be dead weight, but "unused" is a fact only $indexStats can
 * witness, and the application Atlas user is not allowed to run it
 * ("user is not allowed to do action [indexStats]"). This tool therefore:
 *
 *   1. Reads $indexStats and per-index definitions when the connection is
 *      privileged enough; on PermissionDenied it prints the exact Atlas
 *      steps to obtain the numbers and still reports what it can.
 *   2. Classifies every index as PROTECTED / CANDIDATE / IN-USE:
 *        PROTECTED — _id_, unique, TTL, the partial-unique integrity index,
 *                    the catalogVersion sort-covering set, and any index
 *                    still declared in server/models/Product.js (it would
 *                    be recreated by the next index sync/import run).
 *        CANDIDATE — zero accesses since the recorded boot time.
 *        IN-USE    — anything with recorded accesses.
 *   3. Dry-run (default) prints the report. Drops happen ONLY with
 *      --execute plus an explicit --name per index — there is no
 *      "drop all candidates" mode on purpose.
 *
 * Usage:
 *   node scripts/prune_products_indexes.js
 *   node scripts/prune_products_indexes.js --execute --name <indexName> [--name ...]
 */
const mongoose = require('mongoose');
const Product = require('../models/Product');
require('dotenv').config({ quiet: true });

const SORT_COVERING_INDEX_NAMES = new Set([
    'isPublished_1_catalogVersion_1_ratingCount_-1__id_-1',
    'isPublished_1_catalogVersion_1_rating_-1__id_-1',
    'isPublished_1_catalogVersion_1_discountPercentage_-1__id_-1',
    'isPublished_1_catalogVersion_1_price_-1__id_-1',
    'isPublished_1_catalogVersion_1_createdAt_-1__id_-1',
]);

// Names that must never be dropped regardless of usage counts.
const ALWAYS_PROTECTED = new Set([
    '_id_',
    'id_1_partial_unique_numeric', // products.id identity + stock-reservation backstop
]);

const classifyIndex = ({ indexName, definition, stats, declaredInCode }) => {
    const flags = [];
    if (definition.unique) flags.push('unique');
    if (definition.expireAfterSeconds !== undefined) flags.push('ttl');
    if (definition.partialFilterExpression && definition.unique) flags.push('partial-unique');
    const protectedReasons = [];
    if (ALWAYS_PROTECTED.has(indexName) || indexName === '_id_') protectedReasons.push('always-protected');
    if (SORT_COVERING_INDEX_NAMES.has(indexName)) protectedReasons.push('sort-covering-set');
    if (definition.unique || definition.expireAfterSeconds !== undefined) protectedReasons.push('unique-or-ttl');
    if (declaredInCode) protectedReasons.push('declared-in-product-schema');
    if (protectedReasons.length > 0) {
        return { verdict: 'PROTECTED', reasons: protectedReasons, flags };
    }
    const ops = stats?.accesses?.ops;
    if (ops === undefined) {
        return { verdict: 'UNKNOWN', reasons: ['no-index-stats-permission'], flags };
    }
    return {
        verdict: ops === 0 ? 'CANDIDATE' : 'IN-USE',
        ops,
        since: stats?.accesses?.since,
        flags,
    };
};

const parseArgs = (argv) => ({
    execute: argv.includes('--execute'),
    names: argv.includes('--name')
        ? argv.slice(argv.indexOf('--name') + 1).filter((arg) => !arg.startsWith('--'))
        : [],
});

const run = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is required');
    }
    const { execute, names } = parseArgs(process.argv);
    if (execute && names.length === 0) {
        throw new Error('Refusing to run --execute without explicit --name <indexName> arguments.');
    }

    await mongoose.connect(process.env.MONGO_URI);
    const collection = mongoose.connection.collection('products');

    // Names the schema would recreate on the next sync/import.
    const declaredInCode = new Set(
        (Product.schema.indexes?.() || []).map(([keys]) => Object.entries(keys)
            .map(([field, dir]) => `${field}_${dir}`)
            .join('_'))
    );

    const definitions = await collection.listIndexes().toArray();
    let statsByName = null;
    let statsError = '';
    try {
        const stats = await collection.aggregate([{ $indexStats: {} }]).toArray();
        statsByName = new Map(stats.map((entry) => [entry.name, entry]));
    } catch (error) {
        statsError = error.message;
    }

    const rows = definitions.map((definition) => ({
        name: definition.name,
        definition,
        declaredInCode: declaredInCode.has(definition.name) || SORT_COVERING_INDEX_NAMES.has(definition.name),
        ...classifyIndex({
            indexName: definition.name,
            definition,
            stats: statsByName?.get(definition.name),
            declaredInCode: declaredInCode.has(definition.name) || SORT_COVERING_INDEX_NAMES.has(definition.name),
        }),
    }));

    console.log(`products indexes: ${definitions.length}`);
    for (const row of rows.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.name.localeCompare(b.name))) {
        const ops = row.ops === undefined ? 'n/a' : row.ops;
        console.log(`  [${row.verdict}] ${row.name} ops=${ops}${row.declaredInCode ? ' declared-in-code' : ''}`);
    }

    if (!statsByName) {
        console.log('\n$indexStats unavailable for this connection:');
        console.log(`  ${statsError}`);
        console.log('To get usage counts, run this script with a database user that holds');
        console.log('the find/indexStats actions (Atlas UI: Database > … > Edit User >');
        console.log('Built-in Role "Data Access Admin", or fetch the Atlas UI Index');
        console.log('Responder/Roaring Pangolin index metrics page and compare ops).');
    }

    const candidates = rows.filter((row) => row.verdict === 'CANDIDATE');
    console.log(`\ncandidates (0 accesses since boot, not protected): ${candidates.length}`);
    for (const candidate of candidates) console.log(`  ${candidate.name}`);

    if (!execute) {
        console.log('\nDry run. To drop specific indexes: --execute --name <indexName> [--name ...]');
    } else {
        for (const name of names) {
            const row = rows.find((entry) => entry.name === name);
            if (!row) throw new Error(`Index not found on products: ${name}`);
            if (row.verdict === 'PROTECTED') throw new Error(`Refusing to drop protected index: ${name}`);
            if (row.verdict === 'IN-USE') throw new Error(`Refusing to drop IN-USE index (${row.ops} ops): ${name}`);
            await collection.dropIndex(name);
            console.log(`Dropped ${name}`);
        }
        const smoke = await collection.findOne({ isPublished: true }, { projection: { _id: 1 } });
        console.log(`Post-drop smoke query ok: ${smoke ? 'returned a document' : 'collection empty'}`);
    }

    await mongoose.disconnect();
};

run()
    .then(async () => process.exit(0))
    .catch((error) => {
        console.error('prune_products_indexes failed:', error.message);
        process.exit(1);
    });
