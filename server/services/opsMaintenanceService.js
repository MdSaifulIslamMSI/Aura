const logger = require('../utils/logger');
const { flags: paymentFlags } = require('../config/paymentFlags');
const { flags: emailFlags } = require('../config/emailFlags');
const { flags: catalogFlags } = require('../config/catalogFlags');
const {
    runOutboxCycle,
    getPaymentOutboxStats,
} = require('./payments/paymentService');
const {
    runOrderEmailQueueCycle,
    getOrderEmailQueueStats,
} = require('./email/orderEmailQueueService');
const { runEmailOpsMonitorCycle } = require('./email/emailOpsMonitorService');
const {
    runCatalogImportWorkerCycle,
    runCatalogSyncWorkerCycle,
    getCatalogHealth,
} = require('./catalogService');
const {
    runCommerceReconciliationCycle,
    getCommerceReconciliationStatus,
} = require('./commerceReconciliationService');
const { runAdminAnalyticsMonitorCycle } = require('./adminAnalyticsMonitorService');

const TASK_DEFINITIONS = {
    paymentOutbox: {
        enabled: () => paymentFlags.paymentsEnabled,
        run: () => runOutboxCycle(),
        stats: () => getPaymentOutboxStats(),
    },
    orderEmail: {
        enabled: () => emailFlags.orderEmailsEnabled,
        run: () => runOrderEmailQueueCycle(),
        stats: () => getOrderEmailQueueStats(),
    },
    emailOpsMonitor: {
        enabled: () => String(process.env.EMAIL_OPS_MONITOR_ENABLED || 'true').trim().toLowerCase() !== 'false',
        run: () => runEmailOpsMonitorCycle(),
        stats: async () => ({ status: 'ok' }),
    },
    catalogImport: {
        enabled: () => catalogFlags.catalogImportsEnabled,
        run: () => runCatalogImportWorkerCycle(),
        stats: () => getCatalogHealth(),
    },
    catalogSync: {
        enabled: () => catalogFlags.catalogSyncEnabled,
        run: () => runCatalogSyncWorkerCycle(),
        stats: () => getCatalogHealth(),
    },
    reconciliation: {
        enabled: () => String(process.env.COMMERCE_RECONCILIATION_ENABLED || 'true').trim().toLowerCase() !== 'false',
        run: () => runCommerceReconciliationCycle(),
        stats: () => getCommerceReconciliationStatus(),
    },
    adminAnalytics: {
        enabled: () => String(process.env.ADMIN_ANALYTICS_MONITOR_ENABLED || 'true').trim().toLowerCase() !== 'false',
        run: () => runAdminAnalyticsMonitorCycle(),
        stats: async () => ({ status: 'ok' }),
    },
};

const normalizeTaskList = (requestedTasks = []) => {
    const rawTasks = Array.isArray(requestedTasks)
        ? requestedTasks
        : String(requestedTasks || '')
            .split(',')
            .map((task) => task.trim())
            .filter(Boolean);

    const unique = [...new Set(rawTasks)];
    if (unique.length === 0 || unique.includes('all')) {
        return Object.keys(TASK_DEFINITIONS);
    }

    return unique.filter((task) => Object.prototype.hasOwnProperty.call(TASK_DEFINITIONS, task));
};

const runMaintenanceTasks = async ({ requestedTasks = [], source = 'manual', requestId = '' } = {}) => {
    const tasks = normalizeTaskList(requestedTasks);
    const startedAt = new Date();
    const results = [];

    for (const taskName of tasks) {
        const task = TASK_DEFINITIONS[taskName];
        const taskStarted = Date.now();

        if (!task) {
            results.push({
                task: taskName,
                status: 'unknown',
                durationMs: 0,
                message: 'Task is not registered',
            });
            continue;
        }

        if (!task.enabled()) {
            results.push({
                task: taskName,
                status: 'disabled',
                durationMs: 0,
                message: 'Task is disabled by configuration',
            });
            continue;
        }

        try {
            await task.run();
            const stats = typeof task.stats === 'function' ? await task.stats() : null;
            results.push({
                task: taskName,
                status: 'ok',
                durationMs: Date.now() - taskStarted,
                stats,
            });
        } catch (error) {
            logger.error('ops_maintenance.task_failed', {
                task: taskName,
                source,
                requestId,
                error: error.message,
            });
            results.push({
                task: taskName,
                status: 'failed',
                durationMs: Date.now() - taskStarted,
                message: error.message,
            });
        }
    }

    const failed = results.filter((entry) => entry.status === 'failed').length;
    const disabled = results.filter((entry) => entry.status === 'disabled').length;

    return {
        source,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        requestedTasks: tasks,
        failed,
        disabled,
        success: failed === 0,
        results,
    };
};

module.exports = {
    TASK_DEFINITIONS,
    normalizeTaskList,
    runMaintenanceTasks,
};
