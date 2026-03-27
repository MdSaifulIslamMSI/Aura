const PaymentIntent = require('../../models/PaymentIntent');
const PaymentEvent = require('../../models/PaymentEvent');
const PaymentOutboxTask = require('../../models/PaymentOutboxTask');
const { flags } = require('../../config/paymentFlags');
const { getPaymentProvider } = require('./providerFactory');
const { getPaymentCapabilities } = require('./paymentCapabilities');
const { PAYMENT_STATUSES } = require('./constants');
const { hashPayload, makeEventId } = require('./helpers');
const { getPaymentMarketCatalog } = require('./paymentMarketCatalog');
const logger = require('../../utils/logger');

const EXPIRING_SOON_WINDOW_MS = 5 * 60 * 1000;
const AUTHORIZED_ATTENTION_MS = 15 * 60 * 1000;
const STALE_LOCK_WINDOW_MS = 5 * 60 * 1000;

const buildStatusMap = (entries = []) => {
    const map = {};
    entries.forEach((entry) => {
        map[entry._id] = entry.count;
    });
    return map;
};

const toMinutes = (milliseconds) => {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 0;
    return Math.round(milliseconds / 60000);
};

const getPaymentOpsOverview = async ({
    referenceTime = new Date(),
} = {}) => {
    const now = referenceTime instanceof Date ? referenceTime : new Date(referenceTime);
    const last24h = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const expiringSoonAt = new Date(now.getTime() + EXPIRING_SOON_WINDOW_MS);
    const staleLockAt = new Date(now.getTime() - STALE_LOCK_WINDOW_MS);
    const authorizedAttentionAt = new Date(now.getTime() - AUTHORIZED_ATTENTION_MS);

    let provider = null;
    try {
        provider = await getPaymentProvider({
            currency: 'INR',
            paymentMethod: 'CARD',
            userId: 'admin_ops',
        });
    } catch (error) {
        logger.warn('payment.ops_provider_unavailable', {
            error: error.message,
        });
    }

    const [
        statusGroups,
        staleIntents,
        expiringSoon,
        oldestAuthorized,
        authorizedNeedingAttention,
        outboxPending,
        outboxFailed,
        outboxProcessing,
        staleLocks,
        oldestPendingTask,
        lastWebhookEvent,
        webhookEvents24h,
        discardedWebhookTransitions24h,
        confirmFailures24h,
        capabilities,
        countriesByVolume,
        currenciesByVolume,
        internationalIntents,
    ] = await Promise.all([
        PaymentIntent.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                },
            },
        ]),
        PaymentIntent.countDocuments({
            status: { $in: [PAYMENT_STATUSES.CREATED, PAYMENT_STATUSES.CHALLENGE_PENDING] },
            expiresAt: { $lte: now },
        }),
        PaymentIntent.countDocuments({
            status: { $in: [PAYMENT_STATUSES.CREATED, PAYMENT_STATUSES.CHALLENGE_PENDING] },
            expiresAt: { $gt: now, $lte: expiringSoonAt },
        }),
        PaymentIntent.findOne({ status: PAYMENT_STATUSES.AUTHORIZED })
            .sort({ authorizedAt: 1 })
            .select('intentId authorizedAt amount method order')
            .lean(),
        PaymentIntent.countDocuments({
            status: PAYMENT_STATUSES.AUTHORIZED,
            authorizedAt: { $lte: authorizedAttentionAt },
        }),
        PaymentOutboxTask.countDocuments({ status: 'pending' }),
        PaymentOutboxTask.countDocuments({ status: 'failed' }),
        PaymentOutboxTask.countDocuments({ status: 'processing' }),
        PaymentOutboxTask.countDocuments({
            status: 'processing',
            lockedAt: { $lte: staleLockAt },
        }),
        PaymentOutboxTask.findOne({ status: 'pending' })
            .sort({ nextRunAt: 1 })
            .select('taskType intentId nextRunAt retryCount')
            .lean(),
        PaymentEvent.findOne({ source: 'webhook' })
            .sort({ receivedAt: -1 })
            .select('eventId type receivedAt')
            .lean(),
        PaymentEvent.countDocuments({
            source: 'webhook',
            receivedAt: { $gte: last24h },
        }),
        PaymentEvent.countDocuments({
            source: 'webhook',
            receivedAt: { $gte: last24h },
            'payload.processingMeta.discarded': true,
        }),
        PaymentEvent.countDocuments({
            type: 'intent.confirm_failed',
            receivedAt: { $gte: last24h },
        }),
        getPaymentCapabilities({ provider, allowFallback: true }),
        PaymentIntent.aggregate([
            {
                $group: {
                    _id: '$marketCountryCode',
                    count: { $sum: 1 },
                },
            },
            { $sort: { count: -1, _id: 1 } },
            { $limit: 5 },
        ]),
        PaymentIntent.aggregate([
            {
                $group: {
                    _id: '$marketCurrency',
                    count: { $sum: 1 },
                },
            },
            { $sort: { count: -1, _id: 1 } },
            { $limit: 5 },
        ]),
        PaymentIntent.countDocuments({
            $or: [
                { marketCountryCode: { $exists: true, $ne: 'IN' } },
                { marketCurrency: { $exists: true, $ne: 'INR' } },
            ],
        }),
    ]);

    const intentsByStatus = buildStatusMap(statusGroups);
    const marketCatalog = getPaymentMarketCatalog({ capabilities });
    const oldestPendingAgeMinutes = oldestPendingTask?.nextRunAt
        ? toMinutes(now.getTime() - new Date(oldestPendingTask.nextRunAt).getTime())
        : 0;
    const oldestAuthorizedAgeMinutes = oldestAuthorized?.authorizedAt
        ? toMinutes(now.getTime() - new Date(oldestAuthorized.authorizedAt).getTime())
        : 0;
    const webhookAgeMinutes = lastWebhookEvent?.receivedAt
        ? toMinutes(now.getTime() - new Date(lastWebhookEvent.receivedAt).getTime())
        : null;

    const alerts = [];
    if (staleIntents > 0) {
        alerts.push({
            key: 'stale_intents',
            severity: staleIntents >= 25 ? 'critical' : 'warning',
            message: `${staleIntents} payment intents are past expiry and should be swept.`,
        });
    }
    if (outboxFailed > 0) {
        alerts.push({
            key: 'failed_outbox',
            severity: outboxFailed >= 10 ? 'critical' : 'warning',
            message: `${outboxFailed} payment outbox tasks are failed and need intervention.`,
        });
    }
    if (staleLocks > 0) {
        alerts.push({
            key: 'stale_locks',
            severity: 'critical',
            message: `${staleLocks} payment outbox tasks look stuck in processing.`,
        });
    }
    if (authorizedNeedingAttention > 0) {
        alerts.push({
            key: 'aging_authorizations',
            severity: authorizedNeedingAttention >= 10 ? 'critical' : 'warning',
            message: `${authorizedNeedingAttention} authorized payments are aging before capture.`,
        });
    }
    if (capabilities?.stale) {
        alerts.push({
            key: 'provider_catalog',
            severity: 'warning',
            message: 'Provider method capabilities are running from stale cache/fallback data.',
        });
    }
    if (internationalIntents > 0 && capabilities?.rails?.card?.available === false) {
        alerts.push({
            key: 'international_card_unavailable',
            severity: 'critical',
            message: 'International payment intents exist while the live card rail is unavailable.',
        });
    }

    const attentionLevel = alerts.some((alert) => alert.severity === 'critical')
        ? 'critical'
        : alerts.length > 0
            ? 'warning'
            : 'nominal';

    return {
        generatedAt: now.toISOString(),
        attentionLevel,
        provider: {
            name: flags.paymentProvider,
            paymentsEnabled: flags.paymentsEnabled,
            webhooksEnabled: flags.paymentWebhooksEnabled,
            dynamicRoutingEnabled: flags.paymentDynamicRoutingEnabled,
            captureMode: flags.paymentCaptureMode,
            status: capabilities?.stale ? 'degraded' : 'ok',
            capabilities,
        },
        markets: {
            settlementCurrency: marketCatalog.settlementCurrency,
            internationalIntents,
            topCountries: (countriesByVolume || [])
                .filter((entry) => entry?._id)
                .map((entry) => ({ countryCode: entry._id, count: entry.count })),
            topCurrencies: (currenciesByVolume || [])
                .filter((entry) => entry?._id)
                .map((entry) => ({ currency: entry._id, count: entry.count })),
        },
        intents: {
            total: Object.values(intentsByStatus).reduce((sum, count) => sum + Number(count || 0), 0),
            byStatus: intentsByStatus,
            staleExpiredCandidates: staleIntents,
            expiringSoon,
            authorizedNeedingAttention,
            oldestAuthorized: oldestAuthorized
                ? {
                    intentId: oldestAuthorized.intentId,
                    amount: oldestAuthorized.amount,
                    method: oldestAuthorized.method,
                    order: oldestAuthorized.order || null,
                    authorizedAt: oldestAuthorized.authorizedAt,
                    ageMinutes: oldestAuthorizedAgeMinutes,
                }
                : null,
        },
        outbox: {
            pending: outboxPending,
            processing: outboxProcessing,
            failed: outboxFailed,
            staleLocks,
            oldestPending: oldestPendingTask
                ? {
                    taskType: oldestPendingTask.taskType,
                    intentId: oldestPendingTask.intentId,
                    nextRunAt: oldestPendingTask.nextRunAt,
                    retryCount: oldestPendingTask.retryCount,
                    ageMinutes: oldestPendingAgeMinutes,
                }
                : null,
        },
        webhooks: {
            lastReceivedAt: lastWebhookEvent?.receivedAt || null,
            lastEventType: lastWebhookEvent?.type || '',
            ageMinutes: webhookAgeMinutes,
            events24h: webhookEvents24h,
            discardedTransitions24h: discardedWebhookTransitions24h,
            confirmFailures24h,
        },
        alerts,
    };
};

const expireStalePaymentIntents = async ({
    referenceTime = new Date(),
    limit = 200,
    dryRun = false,
} = {}) => {
    const now = referenceTime instanceof Date ? referenceTime : new Date(referenceTime);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
    const candidates = await PaymentIntent.find({
        status: { $in: [PAYMENT_STATUSES.CREATED, PAYMENT_STATUSES.CHALLENGE_PENDING] },
        expiresAt: { $lte: now },
    })
        .sort({ expiresAt: 1 })
        .limit(safeLimit)
        .select('intentId status expiresAt user')
        .lean();

    if (dryRun) {
        return {
            dryRun: true,
            scanned: candidates.length,
            expiredCount: 0,
            intentIds: candidates.map((intent) => intent.intentId),
        };
    }

    const expiredIds = [];
    const eventsToInsert = [];

    for (const candidate of candidates) {
        const update = await PaymentIntent.updateOne(
            {
                _id: candidate._id,
                status: candidate.status,
            },
            {
                $set: {
                    status: PAYMENT_STATUSES.EXPIRED,
                },
            }
        );

        if (!update.modifiedCount) continue;

        expiredIds.push(candidate.intentId);
        eventsToInsert.push({
            eventId: makeEventId('ops'),
            intentId: candidate.intentId,
            source: 'system',
            type: 'intent.expired_by_ops',
            payloadHash: hashPayload({
                intentId: candidate.intentId,
                previousStatus: candidate.status,
                expiredAt: now.toISOString(),
            }),
            payload: {
                previousStatus: candidate.status,
                expiredAt: now.toISOString(),
                expiresAt: candidate.expiresAt,
            },
            receivedAt: now,
        });
    }

    if (eventsToInsert.length > 0) {
        await PaymentEvent.insertMany(eventsToInsert);
    }

    return {
        dryRun: false,
        scanned: candidates.length,
        expiredCount: expiredIds.length,
        intentIds: expiredIds,
    };
};

module.exports = {
    getPaymentOpsOverview,
    expireStalePaymentIntents,
};
