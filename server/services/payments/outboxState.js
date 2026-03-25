const AppError = require('../../utils/AppError');
const Order = require('../../models/Order');
const PaymentIntent = require('../../models/PaymentIntent');
const PaymentOutboxTask = require('../../models/PaymentOutboxTask');
const { flags } = require('../../config/paymentFlags');
const { PAYMENT_STATUSES } = require('./constants');
const { roundCurrency } = require('./helpers');

const scheduleCaptureTask = async ({ intentId, session = null }) => {
    if (flags.paymentCaptureMode !== 'post_order_auth_capture') return null;

    const intentQuery = PaymentIntent.findOne({ intentId }).select('status');
    const intent = session ? await intentQuery.session(session) : await intentQuery;
    if (!intent) {
        throw new AppError('Capture scheduling failed: payment intent not found', 404);
    }
    if (intent.status === PAYMENT_STATUSES.CAPTURED) {
        return null;
    }
    if (intent.status !== PAYMENT_STATUSES.AUTHORIZED) {
        throw new AppError(`Capture scheduling allowed only from authorized state (current: ${intent.status})`, 409);
    }

    try {
        const query = PaymentOutboxTask.findOneAndUpdate(
            {
                taskType: 'capture',
                intentId,
                status: { $in: ['pending', 'processing', 'failed'] },
            },
            {
                $setOnInsert: {
                    taskType: 'capture',
                    intentId,
                    payload: {},
                },
                $set: {
                    status: 'pending',
                    nextRunAt: new Date(),
                    lockedAt: null,
                    lockedBy: null,
                },
            },
            {
                upsert: true,
                returnDocument: 'after',
                setDefaultsOnInsert: true,
            }
        );
        const task = session ? await query.session(session) : await query;
        return task;
    } catch (error) {
        if (error?.code === 11000) {
            const existingQuery = PaymentOutboxTask.findOne({
                taskType: 'capture',
                intentId,
                status: { $in: ['pending', 'processing'] },
            });
            return session ? existingQuery.session(session) : existingQuery;
        }
        throw error;
    }
};

const scheduleRefundTask = async ({
    intentId,
    amount,
    reason,
    orderId,
    requestId,
    actorUserId = null,
    session = null,
}) => {
    if (!intentId || !orderId || !requestId) return null;

    const payload = {
        amount: amount === undefined || amount === null ? null : roundCurrency(Number(amount)),
        reason: reason || 'queued_refund_retry',
        orderId: String(orderId),
        requestId: String(requestId),
        actorUserId: actorUserId ? String(actorUserId) : '',
    };

    const existingQuery = PaymentOutboxTask.findOne({
        taskType: 'refund',
        intentId,
        'payload.requestId': payload.requestId,
        status: { $in: ['pending', 'processing'] },
    });
    const existing = session ? await existingQuery.session(session) : await existingQuery;
    if (existing) return existing;

    const task = new PaymentOutboxTask({
        taskType: 'refund',
        intentId,
        payload,
        status: 'pending',
        retryCount: 0,
        nextRunAt: new Date(Date.now() + 20 * 1000),
    });
    return session ? task.save({ session }) : task.save();
};

const updateOrderCommandRefundEntry = async ({
    orderId,
    requestId,
    status,
    message,
    refundId,
    processedAt = new Date(),
}) => {
    if (!orderId || !requestId) return;

    const update = {
        'commandCenter.refunds.$.status': status,
        'commandCenter.refunds.$.processedAt': processedAt,
        'commandCenter.lastUpdatedAt': new Date(),
    };
    if (message !== undefined) update['commandCenter.refunds.$.message'] = message;
    if (refundId !== undefined) update['commandCenter.refunds.$.refundId'] = refundId;

    await Order.updateOne(
        { _id: orderId, 'commandCenter.refunds.requestId': requestId },
        { $set: update }
    );
};

const getPaymentOutboxStats = async () => {
    const [pending, processing, failed, byType] = await Promise.all([
        PaymentOutboxTask.countDocuments({ status: 'pending' }),
        PaymentOutboxTask.countDocuments({ status: 'processing' }),
        PaymentOutboxTask.countDocuments({ status: 'failed' }),
        PaymentOutboxTask.aggregate([
            {
                $group: {
                    _id: '$taskType',
                    pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
                    failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
                },
            },
        ]),
    ]);

    const taskTypes = {};
    byType.forEach((entry) => {
        taskTypes[entry._id] = { pending: entry.pending, failed: entry.failed };
    });

    return {
        status: 'ok',
        pending,
        processing,
        failed,
        taskTypes,
    };
};

module.exports = {
    scheduleCaptureTask,
    scheduleRefundTask,
    updateOrderCommandRefundEntry,
    getPaymentOutboxStats,
};
