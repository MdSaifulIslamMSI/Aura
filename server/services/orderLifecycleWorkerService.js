const logger = require('../utils/logger');
const { withCronMonitor } = require('../utils/sentry');
const crypto = require('crypto');
const Order = require('../models/Order');
const AdminNotification = require('../models/AdminNotification');
const { cancelOrderForFailedCapture, DIGITAL_PAYMENT_METHODS } = require('./orderService');
const { recordOrderEvent } = require('../middleware/metrics');

// Order lifecycle automation. Reuses the compensation core shared with the
// capture-failure path: cancel is a conditional update (race-safe), so no
// leader lock is required — concurrent replicas may attempt the same order
// but only one cancel update can win.
const DEFAULT_AUTO_CANCEL_MINUTES = 60;
const DEFAULT_POLL_MS = 60 * 1000;
const MIN_POLL_MS = 30 * 1000;
const DEFAULT_COD_ALERT_HOURS = 24;
const MAX_AUTO_CANCELS_PER_CYCLE = 50;
const ALERT_DEDUPE_WINDOW_MS = 60 * 60 * 1000;

let lifecycleTimer = null;
let lastCodAgingAlertAt = 0;

const parsePositiveIntEnv = (value, fallback, minimum = 1) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : fallback;
};

const isLifecycleEnabled = () => ['1', 'true', 'yes', 'on'].includes(
    String(process.env.ORDER_LIFECYCLE_ENABLED ?? 'true').trim().toLowerCase()
);

const getAutoCancelCutoff = (now = new Date()) => {
    const minutes = parsePositiveIntEnv(process.env.ORDER_AUTO_CANCEL_MINUTES, DEFAULT_AUTO_CANCEL_MINUTES);
    return new Date(now.getTime() - minutes * 60 * 1000);
};

const runOrderLifecycleCycle = async () => {
    if (!isLifecycleEnabled()) return { skipped: true };

    const cutoff = getAutoCancelCutoff();
    const staleUnpaid = await Order.find({
        orderStatus: { $in: ['placed', 'processing'] },
        cancelledAt: null,
        isPaid: false,
        isDelivered: { $ne: true },
        paymentMethod: { $in: Array.from(DIGITAL_PAYMENT_METHODS) },
        createdAt: { $lte: cutoff },
    })
        .select('_id paymentIntentId totalPrice')
        .limit(MAX_AUTO_CANCELS_PER_CYCLE)
        .lean();

    let cancelled = 0;
    for (const order of staleUnpaid) {
        if (!order.paymentIntentId) continue;
        const result = await cancelOrderForFailedCapture({
            intentId: order.paymentIntentId,
            reason: 'Payment not confirmed in time — order auto-cancelled',
            alertActionKey: 'order_auto_cancel_unpaid',
            alertTitle: 'Unpaid digital order auto-cancelled',
            alertSummary: `Order ${order._id} auto-cancelled after the payment window elapsed; stock released.`,
        });
        if (result.handled) {
            cancelled += 1;
            recordOrderEvent('auto_cancelled');
        } else if (result.reason && result.reason !== 'no_cancelable_order') {
            logger.warn('order_lifecycle.auto_cancel_skipped', {
                orderId: String(order._id),
                intentId: order.paymentIntentId,
                reason: result.reason,
                error: result.error || '',
            });
        }
    }

    // COD aging: surfaced to admins instead of auto-cancelled — a COD order
    // is a real customer intent and deserves a human look.
    const codCutoffHours = parsePositiveIntEnv(process.env.ORDER_COD_ALERT_HOURS, DEFAULT_COD_ALERT_HOURS);
    const codCutoff = new Date(Date.now() - codCutoffHours * 60 * 60 * 1000);
    const staleCodCount = await Order.countDocuments({
        paymentMethod: 'COD',
        orderStatus: 'placed',
        cancelledAt: null,
        createdAt: { $lte: codCutoff },
    });
    let codAlerted = false;
    if (staleCodCount > 0 && (Date.now() - lastCodAgingAlertAt) > ALERT_DEDUPE_WINDOW_MS) {
        lastCodAgingAlertAt = Date.now();
        codAlerted = true;
        try {
            await AdminNotification.create({
                notificationId: crypto.randomUUID(),
                source: 'system',
                actionKey: 'order_cod_aging',
                title: 'Stale COD orders need review',
                summary: `${staleCodCount} COD order(s) have sat unconfirmed for over ${codCutoffHours}h.`,
                severity: 'warning',
                actorRole: 'system',
                entityType: 'order',
                entityId: 'cod_aging',
                highlights: [`Count: ${staleCodCount}`, `Older than: ${codCutoffHours}h`],
                metadata: { count: staleCodCount, codCutoffHours },
                requestId: 'order_lifecycle_worker',
            });
        } catch (alertError) {
            logger.warn('order_lifecycle.cod_alert_failed', { error: alertError.message });
        }
    }

    if (cancelled > 0 || staleUnpaid.length > 0) {
        logger.info('order_lifecycle.cycle_complete', {
            examined: staleUnpaid.length,
            cancelled,
            staleCodCount,
            codAlerted,
        });
    }

    return { skipped: false, examined: staleUnpaid.length, cancelled, staleCodCount };
};

const startOrderLifecycleWorker = () => {
    if (lifecycleTimer || !isLifecycleEnabled()) return;
    const pollMs = Math.max(
        parsePositiveIntEnv(process.env.ORDER_LIFECYCLE_POLL_MS, DEFAULT_POLL_MS, 1000),
        MIN_POLL_MS
    );
    lifecycleTimer = setInterval(() => {
        withCronMonitor(
            'order-lifecycle',
            () => runOrderLifecycleCycle(),
            { schedule: { type: 'interval', value: Math.round(pollMs / 60000) || 1, unit: 'minute' } },
        ).catch((error) => {
            logger.error('order_lifecycle.cycle_failed', { error: error.message });
        });
    }, pollMs);
};

const stopOrderLifecycleWorkerForTests = () => {
    if (!lifecycleTimer) return;
    clearInterval(lifecycleTimer);
    lifecycleTimer = null;
};

module.exports = {
    getAutoCancelCutoff,
    isLifecycleEnabled,
    runOrderLifecycleCycle,
    startOrderLifecycleWorker,
    stopOrderLifecycleWorkerForTests,
};
