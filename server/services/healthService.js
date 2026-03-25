const mongoose = require('mongoose');
const { getRedisHealth } = require('../config/redis');
const { getMongoDeploymentHealth } = require('../config/db');
const { getCatalogHealth } = require('./catalogService');
const { getPaymentOutboxStats } = require('./payments/paymentService');
const { getOrderEmailQueueStats } = require('./email/orderEmailQueueService');
const { getCommerceReconciliationStatus } = require('./commerceReconciliationService');
const { getSocketHealth } = require('./socketService');
const { getChatQuotaHealth } = require('./chatQuotaService');
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
        const [catalog, paymentQueue, emailQueue, reconciliation] = await Promise.all([
            getCatalogHealth(),
            getPaymentOutboxStats(),
            getOrderEmailQueueStats(),
            getCommerceReconciliationStatus(),
        ]);
        const socketHealth = getSocketHealth();

        return {
            catalog,
            paymentQueue,
            emailQueue,
            reconciliation,
            ai: {
                chatQuota: getChatQuotaHealth(),
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
            ai: {
                chatQuota: getChatQuotaHealth(),
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
