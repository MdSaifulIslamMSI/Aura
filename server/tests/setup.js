const mongoose = require('mongoose');
const dotenv = require('dotenv');
const fs = require('fs/promises');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { resolveVaultFile } = require('../services/authProfileVault');

dotenv.config();

const FALLBACK_TEST_URI = 'mongodb://127.0.0.1:27017/aura_test';

const normalizeUri = (uri) => String(uri || '').trim().replace(/\/+$/, '');

const TEST_MONGO_URI = process.env.TEST_MONGO_URI || FALLBACK_TEST_URI;

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

let memoryServer = null;

const shouldPreferInMemoryMongo = () => {
    if (process.env.TEST_MONGO_URI) return false;
    return parseBoolean(process.env.TEST_USE_IN_MEMORY_MONGO, true);
};

const shouldFallbackToInMemoryMongo = () => parseBoolean(process.env.TEST_FALLBACK_TO_IN_MEMORY_MONGO, true);

const startInMemoryMongo = async () => {
    if (!memoryServer) {
        memoryServer = await MongoMemoryServer.create({
            instance: { dbName: 'aura_test' },
        });
    }
    return memoryServer.getUri();
};

const dropLegacyUserOtpTtlIndex = async () => {
    try {
        const collection = mongoose.connection.collection('users');
        const indexes = await collection.indexes();
        const otpTtlIndex = indexes.find(
            (index) => index.key?.otpExpiry === 1 && Number(index.expireAfterSeconds) === 0
        );

        if (otpTtlIndex?.name) {
            await collection.dropIndex(otpTtlIndex.name);
        }
    } catch (error) {
        const message = String(error?.message || '').toLowerCase();
        const missingNamespace = message.includes('ns does not exist') || message.includes('namespace not found');
        if (!missingNamespace) {
            throw error;
        }
    }
};

const reconcileUserPhoneIndexes = async () => {
    try {
        const collection = mongoose.connection.collection('users');
        const indexes = await collection.indexes();
        const singleFieldPhoneIndexes = indexes.filter((index) => index.key?.phone === 1 && Object.keys(index.key || {}).length === 1);

        for (const index of singleFieldPhoneIndexes) {
            const isDesiredPartial = index.name === 'phone_1_partial_unique_nonempty';
            if (!isDesiredPartial) {
                await collection.dropIndex(index.name);
            }
        }

        const refreshedIndexes = await collection.indexes();
        const hasDesiredPartial = refreshedIndexes.some((index) => index.name === 'phone_1_partial_unique_nonempty');
        if (!hasDesiredPartial) {
            await collection.createIndex(
                { phone: 1 },
                {
                    name: 'phone_1_partial_unique_nonempty',
                    unique: true,
                    partialFilterExpression: {
                        $and: [
                            { phone: { $exists: true } },
                            { phone: { $type: 'string' } },
                            { phone: { $gt: '' } },
                        ],
                    },
                }
            );
        }
    } catch (error) {
        const message = String(error?.message || '').toLowerCase();
        const missingNamespace = message.includes('ns does not exist') || message.includes('namespace not found');
        if (!missingNamespace) {
            throw error;
        }
    }
};

beforeAll(async () => {
    const primaryUri = process.env.MONGO_URI;
    if (process.env.TEST_MONGO_URI && primaryUri && normalizeUri(TEST_MONGO_URI) === normalizeUri(primaryUri)) {
        throw new Error('Unsafe test configuration: TEST_MONGO_URI resolves to primary MONGO_URI.');
    }

    let connectUri = TEST_MONGO_URI;
    let inMemoryStartError = null;
    if (shouldPreferInMemoryMongo()) {
        try {
            connectUri = await startInMemoryMongo();
        } catch (error) {
            inMemoryStartError = error;
            connectUri = TEST_MONGO_URI;
        }
    }

    if (mongoose.connection.readyState === 0) {
        try {
            await mongoose.connect(connectUri, {
                serverSelectionTimeoutMS: 5000,
            });
        } catch (error) {
            if (!shouldFallbackToInMemoryMongo() || inMemoryStartError) {
                const rootCause = inMemoryStartError
                    ? `In-memory Mongo unavailable (${inMemoryStartError.message}); fallback DB connection failed (${connectUri}): ${error.message}`
                    : `Test DB connection failed (${connectUri}): ${error.message}`;
                throw new Error(`${rootCause}. Set TEST_MONGO_URI to a reachable test MongoDB, or fix mongodb-memory-server.`);
            }
            connectUri = await startInMemoryMongo();
            await mongoose.connect(connectUri, {
                serverSelectionTimeoutMS: 5000,
            });
        }
    }
    await dropLegacyUserOtpTtlIndex();
    await reconcileUserPhoneIndexes();
}, 30000); // Increase timeout to 30s for slow connections

afterEach(async () => {
    if (mongoose.connection.readyState !== 1) {
        return;
    }
    const collections = mongoose.connection.collections;
    const names = Object.keys(collections);
    await Promise.all(names.map(async (name) => {
        try {
            await collections[name].deleteMany({});
        } catch (error) {
            const message = String(error?.message || '').toLowerCase();
            const missingNamespace = message.includes('ns does not exist') || message.includes('namespace not found');
            if (!missingNamespace) {
                throw error;
            }
        }
    }));
    try {
        await fs.unlink(resolveVaultFile());
    } catch (error) {
        const code = String(error?.code || '');
        if (code !== 'ENOENT') {
            throw error;
        }
    }
});

afterAll(async () => {
    await mongoose.connection.close();
    if (memoryServer) {
        await memoryServer.stop();
        memoryServer = null;
    }
});
