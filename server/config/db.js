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
            // 30s — must survive Render free-tier cold start + Atlas M0 initial handshake.
            // 10s was too tight: Render wakes in ~5s but Atlas connection can take 15-25s.
            serverSelectionTimeoutMS: 30000,
            // 120s socket timeout — enough for long catalog queries without holding forever.
            socketTimeoutMS: 120000,
            // Pool sized for free tier: M0 Atlas allows ~100 connections; keep headroom.
            // 10 is safe — leaves room for the catalog + email workers that also query Mongo.
            maxPoolSize: 10,
            // 0 = don't hold idle connections when the server sleeps (free tier).
            // Holding 2 warm connections wastes M0 quotas and goes stale after sleep anyway.
            minPoolSize: 0,
            // Release connections idle for >60s so the pool shrinks during quiet periods.
            maxIdleTimeMS: 60000,
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
