const AdminNotification = require('../models/AdminNotification');
const logger = require('../utils/logger');
const { detectAnomalies } = require('./adminAnalyticsService');

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const MONITOR_ENABLED = parseBooleanEnv(process.env.ADMIN_ANALYTICS_MONITOR_ENABLED, true);
const MONITOR_INTERVAL_MS = Math.max(Number(process.env.ADMIN_ANALYTICS_MONITOR_INTERVAL_MS || 300000), 60000);
const ALERT_DEDUPE_MINUTES = Math.max(Number(process.env.ADMIN_ANALYTICS_ALERT_DEDUPE_MINUTES || 30), 5);

let timer = null;

const buildNotificationId = (key) =>
    `adm_anm_${key}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const upsertAnomalyNotification = async (anomaly) => {
    const dedupeAfter = new Date(Date.now() - (ALERT_DEDUPE_MINUTES * 60 * 1000));
    const existing = await AdminNotification.findOne({
        source: 'system',
        actionKey: `analytics.anomaly.${anomaly.key}`,
        createdAt: { $gte: dedupeAfter },
    }).lean();

    if (existing) {
        return { skipped: true, reason: 'recent_duplicate' };
    }

    const summary = `${anomaly.title} detected: current=${anomaly.currentCount}, expected=${anomaly.baselineExpected}, ratio=${anomaly.ratio}x`;

    await AdminNotification.create({
        notificationId: buildNotificationId(anomaly.key),
        source: 'system',
        actionKey: `analytics.anomaly.${anomaly.key}`,
        title: `Analytics Alert: ${anomaly.title}`,
        summary: summary.slice(0, 500),
        severity: anomaly.severity === 'critical' ? 'critical' : 'warning',
        method: 'SYSTEM',
        path: '/api/admin/analytics/anomalies',
        statusCode: 200,
        durationMs: 0,
        actorRole: 'system',
        entityType: 'analytics',
        entityId: anomaly.key,
        highlights: [
            `Current: ${anomaly.currentCount}`,
            `Expected: ${anomaly.baselineExpected}`,
            `Ratio: ${anomaly.ratio}x`,
        ],
        metadata: {
            windowMinutes: anomaly.windowMinutes,
            recommendation: anomaly.recommendation,
        },
        requestId: '',
    });

    return { skipped: false };
};

const runAdminAnalyticsMonitorCycle = async () => {
    if (!MONITOR_ENABLED) return;
    try {
        const result = await detectAnomalies({});
        if (!Array.isArray(result.anomalies) || result.anomalies.length === 0) return;

        for (const anomaly of result.anomalies) {
            const outcome = await upsertAnomalyNotification(anomaly);
            if (!outcome.skipped) {
                logger.warn('admin_analytics.anomaly_alert_created', {
                    anomalyKey: anomaly.key,
                    severity: anomaly.severity,
                    currentCount: anomaly.currentCount,
                    ratio: anomaly.ratio,
                });
            }
        }
    } catch (error) {
        logger.error('admin_analytics.monitor_cycle_failed', { error: error.message });
    }
};

const startAdminAnalyticsMonitor = () => {
    if (!MONITOR_ENABLED) {
        logger.info('admin_analytics.monitor_disabled');
        return;
    }
    if (timer) return;
    timer = setInterval(runAdminAnalyticsMonitorCycle, MONITOR_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
    runAdminAnalyticsMonitorCycle().catch((error) => {
        logger.error('admin_analytics.monitor_boot_cycle_failed', { error: error.message });
    });
    logger.info('admin_analytics.monitor_started', { intervalMs: MONITOR_INTERVAL_MS });
};

const stopAdminAnalyticsMonitor = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
};

module.exports = {
    startAdminAnalyticsMonitor,
    stopAdminAnalyticsMonitor,
    runAdminAnalyticsMonitorCycle,
};
