require('dotenv').config();

const mongoose = require('mongoose');

const parseArgs = (argv = []) => {
    const options = {};

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;

        const key = token.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            options[key] = true;
            continue;
        }

        options[key] = next;
        index += 1;
    }

    return options;
};

const JEST_DB_PATTERN = /^flipi_jest_/;

const connectMongo = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI missing in environment');
    }
    if (mongoose.connection.readyState === 1) return;
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 120000,
        maxPoolSize: 10,
    });
};

const collectJestDatabases = async () => {
    const admin = mongoose.connection.db.admin();
    const result = await admin.listDatabases();
    return result.databases
        .map((database) => database.name)
        .filter((name) => JEST_DB_PATTERN.test(name))
        .sort();
};

const purgeJestDatabases = async ({ execute = false } = {}) => {
    await connectMongo();
    const databaseNames = await collectJestDatabases();
    const report = [];

    for (const name of databaseNames) {
        const db = mongoose.connection.client.db(name);
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map((collection) => collection.name).sort();

        if (!execute) {
            report.push({
                name,
                collectionCount: collectionNames.length,
                collections: collectionNames,
            });
            continue;
        }

        const dropped = [];
        for (const collectionName of collectionNames) {
            try {
                await db.collection(collectionName).drop();
                dropped.push(collectionName);
            } catch (error) {
                dropped.push({
                    name: collectionName,
                    error: error.message,
                });
            }
        }

        report.push({
            name,
            collectionCount: collectionNames.length,
            dropped,
        });
    }

    const totalCollections = report.reduce((sum, item) => sum + item.collectionCount, 0);

    return {
        execute,
        databaseCount: report.length,
        totalCollections,
        report,
    };
};

const run = async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await purgeJestDatabases({ execute: Boolean(args.execute) });
    console.log(JSON.stringify(result, null, 2));
};

run()
    .catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close().catch(() => {});
    });
