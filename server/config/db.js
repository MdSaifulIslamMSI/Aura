const mongoose = require('mongoose');
const logger = require('../utils/logger');

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parseNumber = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(Math.max(numeric, min), max);
};

const isProductionEnvironment = (env = process.env) => (
    String(env.NODE_ENV || '').trim().toLowerCase() === 'production'
);

const hasEncryptedMongoTransport = (uri = '') => {
    const normalized = String(uri || '').trim();
    return normalized.startsWith('mongodb+srv://')
        || /[?&](?:tls|ssl)=true(?:&|$)/i.test(normalized);
};

const assertMongoUriContract = (env = process.env) => {
    const uri = String(env.MONGO_URI || '').trim();
    if (!uri) throw new Error('MONGO_URI is required');

    const requireTls = parseBoolean(env.MONGO_REQUIRE_TLS, isProductionEnvironment(env));
    if (requireTls && !hasEncryptedMongoTransport(uri)) {
        throw new Error('Production MongoDB connections must use mongodb+srv or explicitly enable tls=true');
    }

    return uri;
};

const buildMongoConnectionOptions = (env = process.env) => {
    const production = isProductionEnvironment(env);
    const options = {
        serverSelectionTimeoutMS: parseNumber(env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 30000, { min: 1000, max: 120000 }),
        socketTimeoutMS: parseNumber(env.MONGO_SOCKET_TIMEOUT_MS, 120000, { min: 5000, max: 300000 }),
        maxPoolSize: parseNumber(env.MONGO_MAX_POOL_SIZE, 10, { min: 1, max: 100 }),
        minPoolSize: parseNumber(env.MONGO_MIN_POOL_SIZE, 0, { min: 0, max: 20 }),
        maxIdleTimeMS: parseNumber(env.MONGO_MAX_IDLE_TIME_MS, 60000, { min: 1000, max: 600000 }),
        maxConnecting: parseNumber(env.MONGO_MAX_CONNECTING, 2, { min: 1, max: 10 }),
        waitQueueTimeoutMS: parseNumber(env.MONGO_WAIT_QUEUE_TIMEOUT_MS, 10000, { min: 1000, max: 120000 }),
        autoIndex: parseBoolean(env.MONGO_AUTO_INDEX, !production),
    };

    if (production) {
        options.retryWrites = parseBoolean(env.MONGO_RETRY_WRITES, true);
        options.writeConcern = {
            w: 'majority',
            wtimeoutMS: parseNumber(env.MONGO_WRITE_CONCERN_TIMEOUT_MS, 10000, { min: 1000, max: 120000 }),
        };
    }

    return options;
};

const dropLegacyUserOtpTtlIndex = async () => {
    try {
        const usersCollection = mongoose.connection.collection('users');
        const indexes = await usersCollection.indexes();
        const otpTtlIndex = indexes.find(
            (index) => index.key?.otpExpiry === 1 && Number(index.expireAfterSeconds) === 0
        );

        if (!otpTtlIndex) return;

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

const assertMongoDeploymentContract = ({ env = process.env, health }) => {
    if (!isProductionEnvironment(env)) return;

    const splitRuntimeEnabled = parseBoolean(env.SPLIT_RUNTIME_ENABLED, false);
    const requireReplicaSet = parseBoolean(env.MONGO_REQUIRE_REPLICA_SET, splitRuntimeEnabled);
    if (requireReplicaSet && !health?.replicaSet) {
        throw new Error('Production MongoDB must expose a replica set when transactions or split runtime are enabled');
    }
    if (requireReplicaSet && !health?.isWritablePrimary) {
        throw new Error('Production MongoDB does not currently expose a writable primary');
    }
};

const connectDB = async () => {
    try {
        const uri = assertMongoUriContract(process.env);
        const conn = await mongoose.connect(uri, buildMongoConnectionOptions(process.env));
        logger.info('db.connected', { host: conn.connection.host });

        const deploymentHealth = await getMongoDeploymentHealth();
        assertMongoDeploymentContract({ env: process.env, health: deploymentHealth });

        if (parseBoolean(process.env.MONGO_DROP_LEGACY_OTP_TTL_ON_STARTUP, false)) {
            await dropLegacyUserOtpTtlIndex();
        }
    } catch (error) {
        logger.error('db.connect_failed', { error: error.message });
        process.exit(1);
    }
};

module.exports = connectDB;
module.exports.assertMongoDeploymentContract = assertMongoDeploymentContract;
module.exports.assertMongoUriContract = assertMongoUriContract;
module.exports.buildMongoConnectionOptions = buildMongoConnectionOptions;
module.exports.getMongoDeploymentHealth = getMongoDeploymentHealth;
module.exports.hasEncryptedMongoTransport = hasEncryptedMongoTransport;
