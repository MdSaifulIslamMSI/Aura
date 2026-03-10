const mongoose = require('mongoose');
const logger = require('../utils/logger');

const dropLegacyUserOtpTtlIndex = async () => {
    try {
        const usersCollection = mongoose.connection.collection('users');
        const indexes = await usersCollection.indexes();
        const otpTtlIndex = indexes.find(
            (index) => index.key?.otpExpiry === 1 && Number(index.expireAfterSeconds) === 0
        );

        if (!otpTtlIndex) {
            return;
        }

        await usersCollection.dropIndex(otpTtlIndex.name);
        logger.warn('db.legacy_otp_ttl_index_dropped', { indexName: otpTtlIndex.name });
    } catch (error) {
        const message = String(error?.message || '').toLowerCase();
        const missingNamespace = message.includes('ns does not exist') || message.includes('namespace not found');
        if (!missingNamespace) {
            logger.warn('db.legacy_otp_ttl_index_drop_failed', { error: error.message });
        }
    }
};

const getMongoDeploymentHealth = async () => {
    const readyState = mongoose.connection.readyState;
    const connected = readyState === 1;

    if (!connected) {
        return {
            connected: false,
            readyState,
            replicaSet: false,
            replicaSetName: '',
            isWritablePrimary: false,
            hosts: [],
            logicalSessionTimeoutMinutes: null,
            error: null,
        };
    }

    try {
        const hello = await mongoose.connection.db.admin().command({ hello: 1 });
        return {
            connected: true,
            readyState,
            replicaSet: Boolean(hello?.setName),
            replicaSetName: String(hello?.setName || ''),
            isWritablePrimary: Boolean(hello?.isWritablePrimary ?? hello?.ismaster),
            hosts: Array.isArray(hello?.hosts) ? hello.hosts : [],
            logicalSessionTimeoutMinutes: Number.isFinite(Number(hello?.logicalSessionTimeoutMinutes))
                ? Number(hello.logicalSessionTimeoutMinutes)
                : null,
            error: null,
        };
    } catch (error) {
        return {
            connected: true,
            readyState,
            replicaSet: false,
            replicaSetName: '',
            isWritablePrimary: false,
            hosts: [],
            logicalSessionTimeoutMinutes: null,
            error: error.message,
        };
    }
};

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 10000,  // fail-fast on startup (was 30s)
            socketTimeoutMS: 120000,           // reduced from 180s
            maxPoolSize: 20,                  // up from default 5 — handles concurrent requests
            minPoolSize: 2,                   // keep 2 warm connections always
            maxIdleTimeMS: 60000,             // release idle connections after 60s
            waitQueueTimeoutMS: 10000,        // fail fast if pool is exhausted
        });
        logger.info('db.connected', { host: conn.connection.host });
        await dropLegacyUserOtpTtlIndex();
    } catch (error) {
        logger.error('db.connect_failed', { error: error.message });
        process.exit(1);
    }
};

module.exports = connectDB;
module.exports.getMongoDeploymentHealth = getMongoDeploymentHealth;
