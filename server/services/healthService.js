const mongoose = require('mongoose');
const { getRedisHealth } = require('../config/redis');
const { getMongoDeploymentHealth } = require('../config/db');
const { getCatalogHealth } = require('./catalogService');
const { getPaymentOutboxStats } = require('./payments/paymentService');
const { getOrderEmailQueueStats } = require('./email/orderEmailQueueService');
const { getCommerceReconciliationStatus } = require('./commerceReconciliationService');
const { getSocketHealth } = require('./socketService');
const { getChatQuotaHealth } = require('./chatQuotaService');
const { getFxRefreshStatus } = require('./payments/fxRateService');
const { getCommerceAssistantHealth } = require('./ai/commerceAssistantService');
const logger = require('../utils/logger');

const HEALTH_SNAPSHOT_TTL_MS = Math.max(Number(process.env.HEALTH_SNAPSHOT_TTL_MS || 5000), 500);
const healthSnapshotCache = {
    value: null,
    expiresAt: 0,
    inFlight: null,
};

/**
 * Checks if the core dependencies (DB, Redis) are healthy
 */
const checkCoreDependencies = async () => {
    const dbConnected = mongoose.connection.readyState === 1;
    const redis = getRedisHealth();
    const mongoDeployment = await getMongoDeploymentHealth();

    return {
        dbConnected,
        redisConnected: redis.connected || !redis.required,
        mongoReplicaSet: mongoDeployment.replicaSet || false,
        mongoDeployment,
    };
};

/**
 * Checks if the application-level services are ready
 */
const checkServiceReadiness = async () => {
    try {
        const [catalog, paymentQueue, emailQueue, reconciliation, fx, commerceAssistant] = await Promise.all([
            getCatalogHealth(),
            getPaymentOutboxStats(),
            getOrderEmailQueueStats(),
            getCommerceReconciliationStatus(),
            getFxRefreshStatus().catch((error) => ({
                status: 'degraded',
                error: error.message,
                schedulerEnabled: false,
                snapshotAvailable: false,
                stale: true,
            })),
            getCommerceAssistantHealth().catch((error) => ({
                route: 'controlled_gemma_commerce',
                healthy: false,
                reason: error.message,
            })),
        ]);
        const socketHealth = getSocketHealth();

        return {
            catalog,
            paymentQueue,
            emailQueue,
            reconciliation,
            fx,
            ai: {
                chatQuota: getChatQuotaHealth(),
                commerceAssistant,
            },
            realtime: {
                socket: socketHealth,
                videoCalls: {
                    activeRinging: Number(socketHealth.activeRingingVideoSessions || 0),
                    activeConnected: Number(socketHealth.activeConnectedVideoSessions || 0),
                    endedRecently: 0,
                },
            },
        };
    } catch (error) {
        logger.error('health.service_check_failed', { error: error.message });
        return {
            error: error.message,
            catalog: { staleData: true },
            fx: {
                status: 'degraded',
                error: error.message,
                schedulerEnabled: false,
                snapshotAvailable: false,
                stale: true,
            },
            ai: {
                chatQuota: getChatQuotaHealth(),
                commerceAssistant: {
                    route: 'controlled_gemma_commerce',
                    healthy: false,
                    reason: error.message,
                },
            },
            realtime: {
                socket: getSocketHealth(),
                videoCalls: {
                    activeRinging: 0,
                    activeConnected: 0,
                    endedRecently: 0,
                },
            },
        };
    }
};

const resolveCachedHealthSnapshot = async (builder) => {
    const now = Date.now();
    if (healthSnapshotCache.value && healthSnapshotCache.expiresAt > now) {
        return { ...healthSnapshotCache.value, cacheState: 'hit' };
    }

    if (healthSnapshotCache.inFlight) {
        const value = await healthSnapshotCache.inFlight;
        return { ...value, cacheState: 'shared' };
    }

    healthSnapshotCache.inFlight = Promise.resolve()
        .then(builder)
        .then((value) => {
            healthSnapshotCache.value = value;
            healthSnapshotCache.expiresAt = Date.now() + HEALTH_SNAPSHOT_TTL_MS;
            return value;
        })
        .finally(() => {
            healthSnapshotCache.inFlight = null;
        });

    const value = await healthSnapshotCache.inFlight;
    return { ...value, cacheState: 'miss' };
};

const isTruthyWorkerFailure = (value) => value === false;

const summarizeAdaptiveSecuritySignal = ({ core = {}, services = {} } = {}) => {
    const degradedSignals = [];

    if (!core.dbConnected) degradedSignals.push('database');
    if (!core.redisConnected) degradedSignals.push('redis');
    if (isTruthyWorkerFailure(services?.paymentQueue?.workerRunning)) degradedSignals.push('payment_outbox_worker');
    if (isTruthyWorkerFailure(services?.emailQueue?.workerRunning)) degradedSignals.push('order_email_worker');
    if (isTruthyWorkerFailure(services?.reconciliation?.workerRunning)) degradedSignals.push('commerce_reconciliation_worker');
    if (services?.catalog?.staleData) degradedSignals.push('catalog');
    if (String(services?.fx?.status || '').trim().toLowerCase() === 'degraded' || services?.fx?.stale) {
        degradedSignals.push('fx');
    }
    if (services?.ai?.commerceAssistant?.healthy === false) degradedSignals.push('commerce_ai');

    const mode = !core.dbConnected || !core.redisConnected
        ? 'restrictive'
        : degradedSignals.length > 0
            ? 'elevated'
            : 'standard';

    return {
        status: mode === 'standard' ? 'ok' : 'degraded',
        mode,
        degradedSignals,
        restrictSensitiveActions: mode === 'restrictive',
        requireStepUpForSensitiveActions: mode !== 'standard',
    };
};

const getCachedHealthSnapshot = async () => resolveCachedHealthSnapshot(async () => ({
    core: await checkCoreDependencies(),
    services: await checkServiceReadiness(),
    evaluatedAt: new Date().toISOString(),
}));

const getCachedAdaptiveSecuritySignal = async () => {
    const snapshot = await getCachedHealthSnapshot();

    return {
        ...summarizeAdaptiveSecuritySignal(snapshot),
        cacheState: snapshot.cacheState,
        evaluatedAt: snapshot.evaluatedAt,
    };
};

module.exports = {
    checkCoreDependencies,
    checkServiceReadiness,
    getCachedHealthSnapshot,
    getCachedAdaptiveSecuritySignal,
    summarizeAdaptiveSecuritySignal,
};
