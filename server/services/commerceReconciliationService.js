const crypto = require('crypto');
const Order = require('../models/Order');
const User = require('../models/User');
const PaymentIntent = require('../models/PaymentIntent');
const PaymentOutboxTask = require('../models/PaymentOutboxTask');
const OrderEmailNotification = require('../models/OrderEmailNotification');
const AdminNotification = require('../models/AdminNotification');
const logger = require('../utils/logger');
const { scheduleCaptureTask, scheduleRefundTask } = require('./payments/outboxState');
const { enqueueOrderPlacedEmail } = require('./email/orderEmailQueueService');

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const WORKER_ENABLED = parseBoolean(process.env.COMMERCE_RECONCILIATION_ENABLED, true);
const POLL_MS = Math.max(30000, Number(process.env.COMMERCE_RECONCILIATION_POLL_MS || 120000));
const STALE_LOCK_MS = 10 * 60 * 1000;
const RECENT_LOOKBACK_MS = 45 * 24 * 60 * 60 * 1000;
const MAX_SCAN_ORDERS = 60;

let reconciliationTimer = null;
let lastSummary = {
    status: 'unknown',
    scannedOrders: 0,
    safeRepairs: 0,
    unsafeMismatchCount: 0,
    unsafeIssues: [],
    generatedAt: null,
};
let lastUnsafeAlertAt = 0;

const lower = (value) => String(value || '').trim().toLowerCase();

const buildOrderEmailStatus = (notification) => {
    const status = lower(notification?.status);
    if (status === 'sent') return 'sent';
    if (['failed'].includes(status)) return 'failed';
    return 'pending';
};

const syncOrderFromPaymentIntent = async ({ order, paymentIntent }) => {
    if (!paymentIntent) return 0;

    const updates = {};
    const intentStatus = lower(paymentIntent.status);

    if (!order.paymentIntentId && paymentIntent.intentId) {
        updates.paymentIntentId = paymentIntent.intentId;
    }
    if (paymentIntent.provider && order.paymentProvider !== paymentIntent.provider) {
        updates.paymentProvider = paymentIntent.provider;
    }
    if (intentStatus === 'authorized') {
        if (lower(order.paymentState) !== 'authorized') {
            updates.paymentState = 'authorized';
        }
        if (!order.paymentAuthorizedAt && paymentIntent.authorizedAt) {
            updates.paymentAuthorizedAt = paymentIntent.authorizedAt;
        }
    }
    if (intentStatus === 'captured') {
        if (lower(order.paymentState) !== 'captured') {
            updates.paymentState = 'captured';
        }
        if (!order.isPaid) {
            updates.isPaid = true;
        }
        if (!order.paidAt && paymentIntent.capturedAt) {
            updates.paidAt = paymentIntent.capturedAt;
        }
        if (!order.paymentCapturedAt && paymentIntent.capturedAt) {
            updates.paymentCapturedAt = paymentIntent.capturedAt;
        }
    }
    if (['failed', 'expired', 'partially_refunded', 'refunded'].includes(intentStatus) && lower(order.paymentState) !== intentStatus) {
        updates.paymentState = intentStatus;
    }

    if (Object.keys(updates).length === 0) return 0;
    await Order.updateOne({ _id: order._id }, { $set: updates });
    return 1;
};

const syncOrderEmailState = async ({ order, emailNotification }) => {
    if (!emailNotification && lower(order.confirmationEmailStatus) === 'pending') {
        const user = await User.findById(order.user).select('name email').lean();
        if (user?.email) {
            const created = await enqueueOrderPlacedEmail({
                order,
                user,
                requestId: 'commerce_reconciliation',
            });

            if (created?.notificationId) {
                await Order.updateOne(
                    { _id: order._id },
                    {
                        $set: {
                            confirmationEmailStatus: 'pending',
                            confirmationEmailNotificationId: created.notificationId,
                        },
                    }
                );
                return 1;
            }
        }
        return 0;
    }

    if (!emailNotification) return 0;

    const nextStatus = buildOrderEmailStatus(emailNotification);
    const updates = {};

    if (lower(order.confirmationEmailStatus) !== nextStatus) {
        updates.confirmationEmailStatus = nextStatus;
    }
    if (emailNotification.notificationId && order.confirmationEmailNotificationId !== emailNotification.notificationId) {
        updates.confirmationEmailNotificationId = emailNotification.notificationId;
    }
    if (nextStatus === 'sent' && emailNotification.sentAt && !order.confirmationEmailSentAt) {
        updates.confirmationEmailSentAt = emailNotification.sentAt;
    }

    if (Object.keys(updates).length === 0) return 0;
    await Order.updateOne({ _id: order._id }, { $set: updates });
    return 1;
};

const ensureCaptureTask = async ({ order, paymentIntent }) => {
    if (!paymentIntent || lower(paymentIntent.status) !== 'authorized' || lower(order.orderStatus) === 'cancelled') {
        return 0;
    }

    const existing = await PaymentOutboxTask.findOne({
        taskType: 'capture',
        intentId: paymentIntent.intentId,
        status: { $in: ['pending', 'processing', 'failed'] },
    }).lean();

    if (existing) return 0;
    await scheduleCaptureTask({ intentId: paymentIntent.intentId });
    return 1;
};

const ensureRefundTasks = async ({ order, paymentIntent }) => {
    if (!paymentIntent?.intentId) return 0;

    let repairs = 0;
    const refunds = Array.isArray(order?.commandCenter?.refunds) ? order.commandCenter.refunds : [];
    for (const refund of refunds) {
        if (lower(refund?.status) !== 'approved' || !refund?.requestId) continue;
        const existing = await PaymentOutboxTask.findOne({
            taskType: 'refund',
            intentId: paymentIntent.intentId,
            'payload.requestId': String(refund.requestId),
            status: { $in: ['pending', 'processing', 'failed'] },
        }).lean();

        if (existing) continue;

        await scheduleRefundTask({
            intentId: paymentIntent.intentId,
            amount: refund.amount,
            reason: refund.reason,
            orderId: order._id,
            requestId: refund.requestId,
            actorUserId: null,
        });
        repairs += 1;
    }

    return repairs;
};

const collectUnsafeIssues = ({ order, paymentIntent, emailNotification }) => {
    const issues = [];
    const paymentState = lower(order.paymentState);

    if ((order.isPaid || paymentState === 'captured') && !paymentIntent) {
        issues.push({
            orderId: String(order._id),
            code: 'paid_order_missing_intent',
            message: 'Order is marked paid or captured without a payment intent.',
        });
    }

    if (
        lower(order.confirmationEmailStatus) === 'sent'
        && (!emailNotification || ['failed'].includes(lower(emailNotification?.status)))
    ) {
        issues.push({
            orderId: String(order._id),
            code: 'email_status_mismatch',
            message: 'Order says confirmation email was sent, but notification state does not confirm delivery.',
        });
    }

    const processedRefunds = (Array.isArray(order?.commandCenter?.refunds) ? order.commandCenter.refunds : [])
        .filter((refund) => lower(refund?.status) === 'processed');
    if (processedRefunds.length > 0 && Number(order?.refundSummary?.totalRefunded || 0) <= 0) {
        issues.push({
            orderId: String(order._id),
            code: 'refund_summary_mismatch',
            message: 'Processed refund command exists without refund summary totals.',
        });
    }

    return issues;
};

const emitUnsafeMismatchAlert = async (summary) => {
    if (!summary.unsafeMismatchCount) return;
    if ((Date.now() - lastUnsafeAlertAt) < 60 * 60 * 1000) return;

    const highlights = summary.unsafeIssues.slice(0, 5).map((issue) => `${issue.code}:${issue.orderId}`);
    await AdminNotification.create({
        notificationId: crypto.randomUUID(),
        source: 'system',
        actionKey: 'commerce_reconciliation_unsafe',
        title: 'Commerce reconciliation found unsafe mismatches',
        summary: `${summary.unsafeMismatchCount} unsafe mismatch(es) remain after ${summary.safeRepairs} safe repair(s).`,
        severity: 'critical',
        actorRole: 'system',
        entityType: 'operations',
        entityId: 'commerce_reconciliation',
        highlights,
        metadata: summary,
        requestId: 'commerce_reconciliation',
    });

    lastUnsafeAlertAt = Date.now();
};

const runCommerceReconciliationCycle = async () => {
    const since = new Date(Date.now() - RECENT_LOOKBACK_MS);
    const orders = await Order.find({
        $or: [
            { updatedAt: { $gte: since } },
            { paymentIntentId: { $exists: true, $ne: '' } },
            { confirmationEmailStatus: { $in: ['pending', 'sent', 'failed'] } },
            { 'commandCenter.refunds.0': { $exists: true } },
            { 'commandCenter.replacements.0': { $exists: true } },
        ],
    })
        .sort({ updatedAt: -1 })
        .limit(MAX_SCAN_ORDERS)
        .lean();

    if (orders.length === 0) {
        lastSummary = {
            status: 'healthy',
            scannedOrders: 0,
            safeRepairs: 0,
            unsafeMismatchCount: 0,
            unsafeIssues: [],
            generatedAt: new Date().toISOString(),
        };
        return lastSummary;
    }

    const paymentIntentIds = [...new Set(orders.map((order) => String(order.paymentIntentId || '')).filter(Boolean))];
    const orderIds = orders.map((order) => order._id);
    const emailNotificationIds = [...new Set(orders.map((order) => String(order.confirmationEmailNotificationId || '')).filter(Boolean))];

    const [paymentIntents, emailNotifications] = await Promise.all([
        paymentIntentIds.length > 0 || orderIds.length > 0
            ? PaymentIntent.find({
                $or: [
                    ...(paymentIntentIds.length > 0 ? [{ intentId: { $in: paymentIntentIds } }] : []),
                    ...(orderIds.length > 0 ? [{ order: { $in: orderIds } }] : []),
                ],
            }).lean()
            : Promise.resolve([]),
        orderIds.length > 0 || emailNotificationIds.length > 0
            ? OrderEmailNotification.find({
                $or: [
                    ...(orderIds.length > 0 ? [{ order: { $in: orderIds } }] : []),
                    ...(emailNotificationIds.length > 0 ? [{ notificationId: { $in: emailNotificationIds } }] : []),
                ],
            }).lean()
            : Promise.resolve([]),
    ]);

    const paymentIntentById = new Map();
    const paymentIntentByOrder = new Map();
    paymentIntents.forEach((intent) => {
        if (intent.intentId) paymentIntentById.set(String(intent.intentId), intent);
        if (intent.order) paymentIntentByOrder.set(String(intent.order), intent);
    });

    const emailByOrder = new Map();
    const emailById = new Map();
    emailNotifications.forEach((notification) => {
        if (notification.order) emailByOrder.set(String(notification.order), notification);
        if (notification.notificationId) emailById.set(String(notification.notificationId), notification);
    });

    let safeRepairs = 0;
    const unsafeIssues = [];

    for (const order of orders) {
        const paymentIntent = paymentIntentById.get(String(order.paymentIntentId || ''))
            || paymentIntentByOrder.get(String(order._id))
            || null;
        const emailNotification = emailById.get(String(order.confirmationEmailNotificationId || ''))
            || emailByOrder.get(String(order._id))
            || null;

        safeRepairs += await syncOrderFromPaymentIntent({ order, paymentIntent });
        safeRepairs += await syncOrderEmailState({ order, emailNotification });
        safeRepairs += await ensureCaptureTask({ order, paymentIntent });
        safeRepairs += await ensureRefundTasks({ order, paymentIntent });
        unsafeIssues.push(...collectUnsafeIssues({ order, paymentIntent, emailNotification }));
    }

    lastSummary = {
        status: unsafeIssues.length === 0 ? 'healthy' : 'degraded',
        scannedOrders: orders.length,
        safeRepairs,
        unsafeMismatchCount: unsafeIssues.length,
        unsafeIssues,
        generatedAt: new Date().toISOString(),
    };

    await emitUnsafeMismatchAlert(lastSummary);
    return lastSummary;
};

const startCommerceReconciliationWorker = () => {
    if (!WORKER_ENABLED || reconciliationTimer) return;
    reconciliationTimer = setInterval(() => {
        runCommerceReconciliationCycle().catch((error) => {
            logger.error('commerce_reconciliation.cycle_failed', {
                error: error.message,
            });
        });
    }, POLL_MS);
};

const stopCommerceReconciliationWorkerForTests = () => {
    if (!reconciliationTimer) return;
    clearInterval(reconciliationTimer);
    reconciliationTimer = null;
};

const getCommerceReconciliationStatus = async () => {
    const staleThreshold = new Date(Date.now() - STALE_LOCK_MS);
    const [paymentCaptureBacklog, refundBacklog, orderEmailBacklog, stalePaymentLocks, staleEmailLocks, replacementBacklog] = await Promise.all([
        PaymentOutboxTask.countDocuments({ taskType: 'capture', status: { $in: ['pending', 'processing', 'failed'] } }),
        PaymentOutboxTask.countDocuments({ taskType: 'refund', status: { $in: ['pending', 'processing', 'failed'] } }),
        OrderEmailNotification.countDocuments({ status: { $in: ['pending', 'processing', 'retry', 'failed'] } }),
        PaymentOutboxTask.countDocuments({ status: 'processing', lockedAt: { $lt: staleThreshold } }),
        OrderEmailNotification.countDocuments({ status: 'processing', lockedAt: { $lt: staleThreshold } }),
        Order.countDocuments({ 'commandCenter.replacements.status': { $in: ['pending', 'approved'] } }),
    ]);

    const staleLocks = stalePaymentLocks + staleEmailLocks;
    const unsafeMismatchCount = Number(lastSummary?.unsafeMismatchCount || 0);
    const status = unsafeMismatchCount === 0 && staleLocks === 0 ? 'healthy' : 'degraded';

    return {
        status,
        workerRunning: Boolean(reconciliationTimer),
        paymentCaptureBacklog,
        refundBacklog,
        orderEmailBacklog,
        replacementBacklog,
        staleLocks,
        unsafeMismatchCount,
        lastRun: lastSummary,
    };
};

module.exports = {
    runCommerceReconciliationCycle,
    startCommerceReconciliationWorker,
    stopCommerceReconciliationWorkerForTests,
    getCommerceReconciliationStatus,
};
