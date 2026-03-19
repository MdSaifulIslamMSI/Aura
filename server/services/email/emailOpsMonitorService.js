const AdminNotification = require('../../models/AdminNotification');
const logger = require('../../utils/logger');
const EmailDeliveryLog = require('../../models/EmailDeliveryLog');
const { getOrderEmailQueueStats } = require('./orderEmailQueueService');

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const MONITOR_ENABLED = parseBooleanEnv(process.env.EMAIL_OPS_MONITOR_ENABLED, true);
const MONITOR_INTERVAL_MS = Math.max(Number(process.env.EMAIL_OPS_MONITOR_INTERVAL_MS || 300000), 60000);
const ALERT_DEDUPE_MINUTES = Math.max(Number(process.env.EMAIL_OPS_ALERT_DEDUPE_MINUTES || 30), 5);
const FAILURE_WINDOW_MINUTES = Math.max(Number(process.env.EMAIL_OPS_FAILURE_WINDOW_MINUTES || 15), 5);
const FAILURE_THRESHOLD = Math.max(Number(process.env.EMAIL_OPS_FAILURE_THRESHOLD || 3), 1);
const QUEUE_FAILED_THRESHOLD = Math.max(Number(process.env.EMAIL_OPS_QUEUE_FAILED_THRESHOLD || 3), 1);
const QUEUE_BACKLOG_THRESHOLD = Math.max(Number(process.env.EMAIL_OPS_QUEUE_BACKLOG_THRESHOLD || 10), 1);

let timer = null;

const buildNotificationId = (key) =>
    `adm_eml_${key}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const upsertNotification = async ({ key, title, summary, severity, highlights = [], metadata = {} }) => {
    const dedupeAfter = new Date(Date.now() - (ALERT_DEDUPE_MINUTES * 60 * 1000));
    const actionKey = `email.ops.${key}`;
    const existing = await AdminNotification.findOne({
        source: 'system',
        actionKey,
        createdAt: { $gte: dedupeAfter },
    }).lean();

    if (existing) return { skipped: true, reason: 'recent_duplicate' };

    await AdminNotification.create({
        notificationId: buildNotificationId(key),
        source: 'system',
        actionKey,
        title,
        summary: String(summary || '').slice(0, 500),
        severity,
        method: 'SYSTEM',
        path: '/api/admin/email-ops/summary',
        statusCode: 200,
        durationMs: 0,
        actorRole: 'system',
        entityType: 'email',
        entityId: key,
        highlights: highlights.slice(0, 5),
        metadata,
        requestId: '',
    });

    return { skipped: false };
};

const runEmailOpsMonitorCycle = async () => {
    if (!MONITOR_ENABLED) return;

    try {
        const failureSince = new Date(Date.now() - (FAILURE_WINDOW_MINUTES * 60 * 1000));
        const [recentFailures, queue] = await Promise.all([
            EmailDeliveryLog.find({
                status: 'failed',
                createdAt: { $gte: failureSince },
            }).sort({ createdAt: -1 }).limit(20).lean(),
            getOrderEmailQueueStats().catch(() => ({ status: 'degraded', pending: 0, retry: 0, failed: 0 })),
        ]);

        if (recentFailures.length >= FAILURE_THRESHOLD) {
            const latest = recentFailures[0];
            const outcome = await upsertNotification({
                key: 'failure-spike',
                title: 'Email Failure Spike Detected',
                summary: `${recentFailures.length} email deliveries failed in the last ${FAILURE_WINDOW_MINUTES} minutes.`,
                severity: recentFailures.length >= FAILURE_THRESHOLD * 2 ? 'critical' : 'warning',
                highlights: [
                    `Failures: ${recentFailures.length}`,
                    `Latest event: ${latest?.eventType || 'unknown'}`,
                    `Latest code: ${latest?.errorCode || 'UNKNOWN'}`,
                ],
                metadata: {
                    windowMinutes: FAILURE_WINDOW_MINUTES,
                    latestFailureAt: latest?.createdAt || null,
                    latestErrorCode: latest?.errorCode || '',
                },
            });
            if (!outcome.skipped) {
                logger.warn('email_ops.failure_spike_alert_created', {
                    failures: recentFailures.length,
                    windowMinutes: FAILURE_WINDOW_MINUTES,
                });
            }
        }

        const backlog = Number(queue.pending || 0) + Number(queue.retry || 0) + Number(queue.processing || 0);
        if (Number(queue.failed || 0) >= QUEUE_FAILED_THRESHOLD || backlog >= QUEUE_BACKLOG_THRESHOLD || !queue.workerRunning) {
            const outcome = await upsertNotification({
                key: 'queue-risk',
                title: 'Order Email Queue Requires Attention',
                summary: `Queue backlog=${backlog}, failed=${Number(queue.failed || 0)}, worker=${queue.workerRunning ? 'online' : 'offline'}.`,
                severity: (!queue.workerRunning || Number(queue.failed || 0) >= QUEUE_FAILED_THRESHOLD * 2) ? 'critical' : 'warning',
                highlights: [
                    `Pending: ${Number(queue.pending || 0)}`,
                    `Retry: ${Number(queue.retry || 0)}`,
                    `Failed: ${Number(queue.failed || 0)}`,
                    `Worker: ${queue.workerRunning ? 'online' : 'offline'}`,
                ],
                metadata: queue,
            });
            if (!outcome.skipped) {
                logger.warn('email_ops.queue_alert_created', {
                    backlog,
                    failed: Number(queue.failed || 0),
                    workerRunning: Boolean(queue.workerRunning),
                });
            }
        }
    } catch (error) {
        logger.error('email_ops.monitor_cycle_failed', { error: error.message });
    }
};

const startEmailOpsMonitor = () => {
    if (!MONITOR_ENABLED) {
        logger.info('email_ops.monitor_disabled');
        return;
    }
    if (timer) return;
    timer = setInterval(runEmailOpsMonitorCycle, MONITOR_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
    runEmailOpsMonitorCycle().catch((error) => {
        logger.error('email_ops.monitor_boot_cycle_failed', { error: error.message });
    });
    logger.info('email_ops.monitor_started', { intervalMs: MONITOR_INTERVAL_MS });
};

const stopEmailOpsMonitor = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
};

module.exports = {
    runEmailOpsMonitorCycle,
    startEmailOpsMonitor,
    stopEmailOpsMonitor,
};
