/**
 * Migration: enforce a unique index on products.id.
 *
 * products.id is the numeric public identifier used by carts, price alerts,
 * trade-ins, and (critically) atomic stock reservation. Until now it carried
 * only a non-unique index, so a duplicate id could silently persist and make
 * stock decrements hit an arbitrary document.
 *
 * Dry-run by default: audits duplicate ids and reports the current index.
 * With --execute: refuses to proceed while duplicates exist (resolve them
 * first), otherwise drops the old non-unique id_1 index and creates the
 * unique one. Safe to re-run.
 *
 * Usage:
 *   node scripts/migrate_product_id_unique.js            # audit only
 *   node scripts/migrate_product_id_unique.js --execute  # create unique index
 */
const mongoose = require('mongoose');
require('dotenv').config();

const run = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is required');
    }

    const execute = process.argv.includes('--execute');

    await mongoose.connect(process.env.MONGO_URI);
    const collection = mongoose.connection.collection('products');

    const duplicates = await collection.aggregate([
        { $match: { id: { $type: 'number' } } },
        { $group: { _id: '$id', count: { $sum: 1 }, docs: { $push: '$_id' } } },
        { $match: { count: { $gt: 1 } } },
        { $sort: { _id: 1 } },
        { $limit: 50 },
    ]).toArray();

    const indexes = await collection.indexes();
    const idIndex = indexes.find((index) => index.key?.id === 1);

    console.log(`products.id index: ${idIndex ? `${idIndex.name} (unique=${Boolean(idIndex.unique)})` : 'missing'}`);
    console.log(`Duplicate id groups: ${duplicates.length}`);
    for (const dup of duplicates) {
        console.log(`  id=${dup._id} count=${dup.count} docs=${dup.docs.join(', ')}`);
    }

    if (!execute) {
        console.log('Dry run complete. Re-run with --execute to create the unique index.');
        return;
    }

    if (duplicates.length > 0) {
        throw new Error(
            'Duplicate products.id values exist. Resolve them (reassign or remove the newer duplicate) before creating the unique index.'
        );
    }

    if (idIndex && !idIndex.unique) {
        await collection.dropIndex(idIndex.name);
        console.log(`Dropped non-unique index: ${idIndex.name}`);
    }

    await collection.createIndex({ id: 1 }, { unique: true, name: 'id_1' });
    console.log('Created unique index id_1 on products.id');
};

run()
    .then(async () => {
        await mongoose.connection.close();
    })
    .catch(async (error) => {
        console.error('products.id unique migration failed:', error.message);
        try {
            await mongoose.connection.close();
        } catch {
            // connection may not be open yet
        }
        process.exit(1);
    });
