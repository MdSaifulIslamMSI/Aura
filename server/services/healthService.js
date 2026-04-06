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

module.exports = {
    checkCoreDependencies,
    checkServiceReadiness,
};
