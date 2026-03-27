const asyncHandler = require('express-async-handler');
const AppError = require('../utils/AppError');
const PaymentIntentModel = require('../models/PaymentIntent');
const PaymentEvent = require('../models/PaymentEvent');
const PaymentOutboxTask = require('../models/PaymentOutboxTask');
const Order = require('../models/Order');
const User = require('../models/User');
const { notifyAdminActionToUser } = require('../services/email/adminActionEmailService');
const { flags: paymentFlags } = require('../config/paymentFlags');
const { DIGITAL_METHODS } = require('../services/payments/constants');
const {
    createPaymentIntent,
    confirmPaymentIntent,
    getPaymentIntentForUser,
    processRazorpayWebhook,
    createRefundForIntent,
    markChallengeVerified,
    listUserPaymentMethods,
    listPaymentCapabilities,
    listNetbankingBanks,
    saveUserPaymentMethod,
    deleteUserPaymentMethod,
    setDefaultPaymentMethod,
    listAdminPaymentIntents,
    captureIntentNow,
    scheduleCaptureTask,
} = require('../services/payments/paymentService');
const {
    getPaymentOpsOverview,
    expireStalePaymentIntents,
} = require('../services/payments/paymentOperationsService');
const {
    resolveRefundAmounts,
    buildRefundEntry,
    buildRefundMutation,
} = require('../services/payments/refundState');
const { sendPersistentNotification } = require('../services/notificationService');
const {
    getRequiredIdempotencyKey,
    getStableUserKey,
    withIdempotency,
} = require('../services/payments/idempotencyService');

const getRequestMeta = (req) => ({
    ip: req.ip || req.connection?.remoteAddress || '',
    userAgent: req.headers['user-agent'] || '',
    market: req.market || null,
});

const notifyPaymentOwnerAdminAction = async ({
    req,
    intentId,
    actionKey,
    actionTitle,
    actionSummary,
    highlights = [],
}) => {
    const intent = await PaymentIntentModel
        .findOne({ intentId })
        .select('intentId user order amount currency provider method')
        .lean();
    if (!intent?.user) return;

    const targetUser = await User.findById(intent.user).select('name email').lean();
    if (!targetUser?.email) return;

    await notifyAdminActionToUser({
        targetUser: { ...targetUser, _id: intent.user },
        actorUser: req.user,
        actionKey,
        actionTitle,
        actionSummary,
        highlights: [
            `Payment intent: ${intent.intentId}`,
            `Order reference: ${intent.order ? String(intent.order) : 'not linked'}`,
            `Method: ${intent.method || 'unknown'}`,
            `Amount: ${intent.amount || 0} ${intent.currency || 'INR'}`,
            ...highlights,
        ],
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
    });

    // Also send persistent in-app notification
    await sendPersistentNotification(
        intent.user,
        actionTitle,
        actionSummary,
        'payment',
        {
            relatedEntity: intent.order ? String(intent.order) : String(intent._id),
            actionUrl: intent.order ? `/orders` : `/profile`,
        }
    );
};

const DIGITAL_PAYMENT_METHODS = new Set(DIGITAL_METHODS);

const parseDateMaybe = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
};

const toStatusLower = (value) => String(value || '').trim().toLowerCase();

const deriveRefundSettlementAndReconciliation = ({
    refundStatus,
    paymentMethod,
    paymentIntentId,
    refundId,
    isQueued,
    providerVerified,
}) => {
    const status = toStatusLower(refundStatus);
    const method = String(paymentMethod || '').trim().toUpperCase();
    const hasIntent = Boolean(String(paymentIntentId || '').trim());
    const hasRefundId = Boolean(String(refundId || '').trim());
    const isDigital = DIGITAL_PAYMENT_METHODS.has(method);

    let settlement = 'none';
    if (status === 'processed') {
        settlement = isDigital && hasIntent ? 'provider' : 'manual';
    } else if (status === 'pending' && isQueued) {
        settlement = 'queued';
    } else if (status === 'approved') {
        settlement = 'manual_review';
    }

    let reconciliation = 'pending';
    if (status === 'processed') {
        if (settlement === 'provider') {
            reconciliation = providerVerified ? 'provider_verified' : 'provider_unverified';
        } else {
            reconciliation = hasRefundId ? 'manual_recorded' : 'manual_reference_missing';
        }
    } else if (status === 'rejected') {
        reconciliation = 'n/a';
    }

    return { settlement, reconciliation };
};

const enrichRefundLedgerRows = async (rows = []) => {
    const normalizedRows = Array.isArray(rows) ? rows : [];
    if (normalizedRows.length === 0) return [];

    const requestIds = normalizedRows
        .map((row) => String(row.requestId || '').trim())
        .filter(Boolean);
    const intentIds = normalizedRows
        .map((row) => String(row.paymentIntentId || '').trim())
        .filter(Boolean);

    const [queuedTasks, refundEvents] = await Promise.all([
        requestIds.length
            ? PaymentOutboxTask.find({
                taskType: 'refund',
                status: { $in: ['pending', 'processing'] },
                'payload.requestId': { $in: requestIds },
            })
                .select('status retryCount nextRunAt lastError payload')
                .lean()
            : [],
        intentIds.length
            ? PaymentEvent.find({
                intentId: { $in: intentIds },
                type: 'refund.created',
            })
                .select('intentId payload receivedAt')
                .lean()
            : [],
    ]);

    const queuedByRequestId = new Map();
    queuedTasks.forEach((task) => {
        const key = String(task?.payload?.requestId || '').trim();
        if (!key) return;
        if (queuedByRequestId.has(key)) return;
        queuedByRequestId.set(key, {
            status: task.status || 'pending',
            retryCount: Number(task.retryCount || 0),
            nextRunAt: task.nextRunAt || null,
            lastError: task.lastError || '',
        });
    });

    const providerVerification = new Set();
    refundEvents.forEach((event) => {
        const intentId = String(event.intentId || '').trim();
        const payloadRefundId = String(event?.payload?.refundId || event?.payload?.id || '').trim();
        if (!intentId || !payloadRefundId) return;
        providerVerification.add(`${intentId}:${payloadRefundId}`);
    });

    return normalizedRows.map((row) => {
        const requestId = String(row.requestId || '').trim();
        const paymentIntentId = String(row.paymentIntentId || '').trim();
        const refundId = String(row.refundId || '').trim();
        const queueMeta = queuedByRequestId.get(requestId) || null;
        const providerVerified = Boolean(
            paymentIntentId && refundId && providerVerification.has(`${paymentIntentId}:${refundId}`)
        );

        const { settlement, reconciliation } = deriveRefundSettlementAndReconciliation({
            refundStatus: row.refundStatus,
            paymentMethod: row.paymentMethod,
            paymentIntentId,
            refundId,
            isQueued: Boolean(queueMeta),
            providerVerified,
        });

        return {
            ledgerId: `${String(row.orderId)}:${requestId}`,
            orderId: String(row.orderId),
            requestId,
            user: row.userDoc?._id ? {
                _id: String(row.userDoc._id),
                name: row.userDoc.name || '',
                email: row.userDoc.email || '',
                phone: row.userDoc.phone || '',
            } : null,
            payment: {
                method: row.paymentMethod || '',
                provider: row.paymentProvider || '',
                intentId: paymentIntentId || '',
                state: row.paymentState || '',
            },
            order: {
                status: row.orderStatus || '',
                totalPrice: Number(row.totalPrice || 0),
            },
            refund: {
                status: row.refundStatus || 'pending',
                amount: Number(row.amount || 0),
                reason: row.reason || '',
                message: row.message || '',
                adminNote: row.adminNote || '',
                refundId,
                createdAt: row.createdAt || null,
                updatedAt: row.updatedAt || null,
                processedAt: row.processedAt || null,
            },
            settlement,
            reconciliation,
            queue: queueMeta,
            providerVerification: providerVerified ? 'verified' : 'unverified',
        };
    });
};

// @desc    Refund ledger list for admin reconciliation
// @route   GET /api/admin/payments/refunds/ledger
// @access  Private/Admin
const getAdminRefundLedger = asyncHandler(async (req, res, next) => {
    try {
        const page = Math.max(Number(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
        const skip = (page - 1) * limit;
        const status = String(req.query.status || '').trim();
        const method = String(req.query.method || '').trim().toUpperCase();
        const provider = String(req.query.provider || '').trim();
        const search = String(req.query.query || '').trim();
        const settlementFilter = String(req.query.settlement || '').trim();
        const reconciliationFilter = String(req.query.reconciliation || '').trim();
        const fromDate = parseDateMaybe(req.query.from);
        const toDateRaw = parseDateMaybe(req.query.to);
        const toDate = toDateRaw ? new Date(toDateRaw.getTime() + (24 * 60 * 60 * 1000) - 1) : null;

        const pipeline = [
            { $match: { 'commandCenter.refunds.0': { $exists: true } } },
            { $unwind: '$commandCenter.refunds' },
            {
                $project: {
                    orderId: '$_id',
                    user: '$user',
                    paymentMethod: '$paymentMethod',
                    paymentProvider: '$paymentProvider',
                    paymentIntentId: '$paymentIntentId',
                    paymentState: '$paymentState',
                    orderStatus: '$orderStatus',
                    totalPrice: '$totalPrice',
                    requestId: '$commandCenter.refunds.requestId',
                    refundStatus: '$commandCenter.refunds.status',
                    amount: '$commandCenter.refunds.amount',
                    reason: '$commandCenter.refunds.reason',
                    message: '$commandCenter.refunds.message',
                    adminNote: '$commandCenter.refunds.adminNote',
                    refundId: '$commandCenter.refunds.refundId',
                    createdAt: '$commandCenter.refunds.createdAt',
                    updatedAt: '$commandCenter.refunds.updatedAt',
                    processedAt: '$commandCenter.refunds.processedAt',
                },
            },
        ];

        const match = {};
        if (status) match.refundStatus = status;
        if (method) match.paymentMethod = method;
        if (provider) match.paymentProvider = provider;
        if (fromDate || toDate) {
            match.createdAt = {};
            if (fromDate) match.createdAt.$gte = fromDate;
            if (toDate) match.createdAt.$lte = toDate;
        }
        if (Object.keys(match).length > 0) {
            pipeline.push({ $match: match });
        }

        pipeline.push({
            $lookup: {
                from: 'users',
                localField: 'user',
                foreignField: '_id',
                as: 'userDoc',
            },
        });
        pipeline.push({ $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: true } });
        pipeline.push({
            $addFields: {
                orderIdStr: { $toString: '$orderId' },
            },
        });

        if (search) {
            const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            pipeline.push({
                $match: {
                    $or: [
                        { requestId: searchRegex },
                        { refundId: searchRegex },
                        { reason: searchRegex },
                        { message: searchRegex },
                        { adminNote: searchRegex },
                        { orderIdStr: searchRegex },
                        { 'userDoc.email': searchRegex },
                        { 'userDoc.name': searchRegex },
                        { 'userDoc.phone': searchRegex },
                    ],
                },
            });
        }

        pipeline.push({ $sort: { createdAt: -1 } });

        const needsDerivedFilters = Boolean(settlementFilter || reconciliationFilter);

        let rows = [];
        let total = 0;
        if (needsDerivedFilters) {
            const allRows = await Order.aggregate(pipeline);
            const enriched = await enrichRefundLedgerRows(allRows);
            const filtered = enriched.filter((row) => {
                if (settlementFilter && row.settlement !== settlementFilter) return false;
                if (reconciliationFilter && row.reconciliation !== reconciliationFilter) return false;
                return true;
            });
            total = filtered.length;
            rows = filtered.slice(skip, skip + limit);
        } else {
            const faceted = await Order.aggregate([
                ...pipeline,
                {
                    $facet: {
                        items: [{ $skip: skip }, { $limit: limit }],
                        total: [{ $count: 'count' }],
                    },
                },
            ]);
            const facetResult = faceted[0] || { items: [], total: [] };
            const itemRows = Array.isArray(facetResult.items) ? facetResult.items : [];
            total = Number(facetResult.total?.[0]?.count || 0);
            rows = await enrichRefundLedgerRows(itemRows);
        }

        return res.json({
            page,
            limit,
            total,
            pages: Math.max(1, Math.ceil(total / limit)),
            items: rows,
        });
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to fetch refund ledger', 500));
    }
});

// @desc    Record manual refund reference / reconciliation note
// @route   PATCH /api/admin/payments/refunds/ledger/:orderId/:requestId/reference
// @access  Private/Admin
const updateAdminRefundLedgerReference = asyncHandler(async (req, res, next) => {
    const order = await Order.findById(req.params.orderId);
    if (!order) {
        return next(new AppError('Order not found', 404));
    }

    const refunds = Array.isArray(order?.commandCenter?.refunds) ? order.commandCenter.refunds : [];
    const requestId = String(req.params.requestId || '').trim();
    const refundIndex = refunds.findIndex((entry) => String(entry?.requestId || '') === requestId);
    if (refundIndex < 0) {
        return next(new AppError('Refund request not found', 404));
    }

    const refund = refunds[refundIndex];
    const previousStatus = toStatusLower(refund.status || 'pending');
    const refundId = String(req.body.refundId || '').trim();
    const note = String(req.body.note || '').trim();

    refund.refundId = refundId;
    refund.adminNote = note;
    refund.updatedAt = new Date();

    let message = 'Refund ledger reference updated';
    if (previousStatus === 'approved') {
        refund.status = 'processed';
        refund.processedAt = new Date();
        refund.message = note || 'Manual refund processed and reference recorded by admin';

        const amount = Number(refund.amount || 0);
        if (amount > 0) {
            const refundAmounts = resolveRefundAmounts({
                order,
                amount,
                amountMode: 'settlement',
            });
            const refundEntry = buildRefundEntry({
                providerRefund: {
                    id: refundId,
                    status: 'processed',
                },
                refundAmounts,
                reason: refund.reason || note || 'manual_refund_reconciliation',
                fallbackRefundId: refundId,
                createdAt: refund.processedAt,
            });
            const refundMutation = buildRefundMutation({
                order,
                refundEntry,
            });
            order.refundSummary = refundMutation.refundSummary;
            order.paymentState = refundMutation.paymentState;
        }

        message = 'Manual refund marked processed with reference';
    } else if (previousStatus === 'processed') {
        refund.message = note || refund.message || 'Refund reference updated by admin';
    } else {
        return next(new AppError('Reference update allowed only for approved/processed refund requests', 409));
    }

    order.commandCenter = order.commandCenter || {};
    order.commandCenter.lastUpdatedAt = new Date();
    order.statusTimeline = Array.isArray(order.statusTimeline) ? order.statusTimeline : [];
    order.statusTimeline.push({
        status: order.orderStatus || 'placed',
        message: `Admin updated refund reference for request ${requestId}`,
        actor: 'admin',
        at: new Date(),
    });
    order.markModified('commandCenter');
    await order.save();

    const targetUser = await User.findById(order.user).select('name email').lean();
    if (targetUser?.email) {
        await notifyAdminActionToUser({
            targetUser: { ...targetUser, _id: order.user },
            actorUser: req.user,
            actionKey: 'admin.refund.reference_update',
            actionTitle: 'Refund Reference Updated by Admin',
            actionSummary: 'An administrator recorded a refund reference for your order.',
            highlights: [
                `Order ID: ${String(order._id)}`,
                `Request ID: ${requestId}`,
                `Previous status: ${previousStatus}`,
                `Current status: ${refund.status}`,
                `Refund reference: ${refundId}`,
                `Admin note: ${note || 'No note provided'}`,
            ],
            requestId: req.requestId,
            method: req.method,
            path: req.originalUrl,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
        });
    }

    return res.json({
        success: true,
        message,
        ledgerEntry: {
            orderId: String(order._id),
            requestId,
            status: refund.status,
            refundId: refund.refundId,
            adminNote: refund.adminNote || '',
            processedAt: refund.processedAt || null,
            updatedAt: refund.updatedAt || null,
        },
        refundSummary: order.refundSummary || null,
    });
});

// @desc    Create payment intent
// @route   POST /api/payments/intents
// @access  Private
const createIntent = asyncHandler(async (req, res, next) => {
    try {
        const idempotencyKey = getRequiredIdempotencyKey(req);
        const userKey = getStableUserKey(req);

        const result = await withIdempotency({
            key: idempotencyKey,
            userKey,
            route: 'payments:create_intent',
            requestPayload: req.body,
            handler: async () => {
                const response = await createPaymentIntent({
                    user: req.user,
                    quotePayload: req.body.quotePayload,
                    quoteSnapshot: req.body.quoteSnapshot,
                    paymentMethod: req.body.paymentMethod,
                    savedMethodId: req.body.savedMethodId,
                    paymentContext: req.body.paymentContext || {},
                    deviceContext: req.body.deviceContext || {},
                    requestMeta: getRequestMeta(req),
                });
                return { statusCode: 200, response };
            },
        });

        return res.status(result.statusCode).json(result.response);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to create payment intent', 500));
    }
});

// @desc    Mark payment challenge complete
// @route   POST /api/payments/intents/:intentId/challenge/complete
// @access  Private
const completeChallenge = asyncHandler(async (req, res, next) => {
    try {
        const result = await markChallengeVerified({
            userId: req.user._id,
            userPhone: req.user.phone,
            intentId: req.params.intentId,
            challengeToken: req.body.challengeToken,
        });
        return res.json(result);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to complete challenge', 500));
    }
});

// @desc    Confirm payment intent
// @route   POST /api/payments/intents/:intentId/confirm
// @access  Private
const confirmIntent = asyncHandler(async (req, res, next) => {
    try {
        const idempotencyKey = getRequiredIdempotencyKey(req);
        const userKey = getStableUserKey(req);

        const result = await withIdempotency({
            key: idempotencyKey,
            userKey,
            route: `payments:confirm_intent:${req.params.intentId}`,
            requestPayload: req.body,
            handler: async () => {
                const response = await confirmPaymentIntent({
                    userId: req.user._id,
                    intentId: req.params.intentId,
                    providerPaymentId: req.body.providerPaymentId,
                    providerOrderId: req.body.providerOrderId,
                    providerSignature: req.body.providerSignature,
                });
                return { statusCode: 200, response };
            },
        });

        return res.status(result.statusCode).json(result.response);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to confirm payment intent', 500));
    }
});

// @desc    Get payment intent with timeline
// @route   GET /api/payments/intents/:intentId
// @access  Private
const getIntent = asyncHandler(async (req, res, next) => {
    try {
        const intent = await getPaymentIntentForUser({
            intentId: req.params.intentId,
            userId: req.user._id,
            allowAdmin: Boolean(req.user?.isAdmin),
        });
        return res.json(intent);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to fetch payment intent', 500));
    }
});

// @desc    Create refund for payment intent
// @route   POST /api/payments/intents/:intentId/refunds
// @access  Private
const createRefund = asyncHandler(async (req, res, next) => {
    try {
        const idempotencyKey = getRequiredIdempotencyKey(req);
        const userKey = getStableUserKey(req);

        const result = await withIdempotency({
            key: idempotencyKey,
            userKey,
            route: `payments:create_refund:${req.params.intentId}`,
            requestPayload: req.body,
            handler: async () => {
                const response = await createRefundForIntent({
                    actorUserId: req.user._id,
                    isAdmin: Boolean(req.user?.isAdmin),
                    intentId: req.params.intentId,
                    amount: req.body.amount,
                    amountMode: req.body.amountMode,
                    reason: req.body.reason,
                });
                return { statusCode: 200, response };
            },
        });

        if (req.user?.isAdmin) {
            await notifyPaymentOwnerAdminAction({
                req,
                intentId: req.params.intentId,
                actionKey: 'admin.payment.refund',
                actionTitle: 'Refund Issued by Admin',
                actionSummary: 'An administrator initiated a refund against your payment.',
                highlights: [
                    `Refund ID: ${result.response?.refundId || 'pending'}`,
                    `Refund status: ${result.response?.status || 'processed'}`,
                    `Refund amount: ${result.response?.amount || req.body.amount || 'full'} ${result.response?.currency || 'INR'}`,
                    `Reason: ${String(req.body?.reason || 'admin_refund').trim() || 'admin_refund'}`,
                ],
            });
        }

        return res.status(result.statusCode).json(result.response);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to create refund', 500));
    }
});

// @desc    Razorpay webhook receiver
// @route   POST /api/payments/webhooks/razorpay
// @access  Public
const handleRazorpayWebhook = asyncHandler(async (req, res, next) => {
    try {
        const signature = req.headers['x-razorpay-signature'];

        if (paymentFlags.paymentProvider !== 'razorpay') {
            throw new AppError(`Unsupported PAYMENT_PROVIDER=${paymentFlags.paymentProvider} for Razorpay webhook route`, 409);
        }

        if (!signature) {
            throw new AppError('Missing webhook signature', 403);
        }

        const rawBody = req.rawBody || JSON.stringify(req.body || {});
        const result = await processRazorpayWebhook({ signature, rawBody });
        return res.status(200).json(result);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to process webhook', 500));
    }
});

// @desc    List payment methods for user
// @route   GET /api/payments/methods
// @access  Private
const getPaymentMethods = asyncHandler(async (req, res, next) => {
    try {
        const methods = await listUserPaymentMethods({ userId: req.user._id });
        return res.json(methods);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to fetch payment methods', 500));
    }
});

// @desc    List live payment rail capabilities for checkout
// @route   GET /api/payments/capabilities
// @access  Private
const getPaymentCapabilitiesCatalog = asyncHandler(async (req, res, next) => {
    try {
        const capabilities = await listPaymentCapabilities({ userId: req.user._id });
        return res.json(capabilities);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to fetch payment capabilities', 500));
    }
});

// @desc    List supported netbanking banks for secure checkout
// @route   GET /api/payments/netbanking/banks
// @access  Private
const getNetbankingBanks = asyncHandler(async (req, res, next) => {
    try {
        const catalog = await listNetbankingBanks({ userId: req.user._id });
        return res.json(catalog);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to fetch netbanking banks', 500));
    }
});

// @desc    Save tokenized payment method
// @route   POST /api/payments/methods
// @access  Private
const addPaymentMethod = asyncHandler(async (req, res, next) => {
    try {
        const method = await saveUserPaymentMethod({
            userId: req.user._id,
            method: req.body,
            paymentIntentId: req.body.paymentIntentId,
        });
        return res.status(201).json(method);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to save payment method', 500));
    }
});

// @desc    Set default payment method
// @route   PATCH /api/payments/methods/:methodId/default
// @access  Private
const makeDefaultPaymentMethod = asyncHandler(async (req, res, next) => {
    try {
        const method = await setDefaultPaymentMethod({ userId: req.user._id, methodId: req.params.methodId });
        return res.json(method);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to set default method', 500));
    }
});

// @desc    Delete payment method
// @route   DELETE /api/payments/methods/:methodId
// @access  Private
const removePaymentMethod = asyncHandler(async (req, res, next) => {
    try {
        const result = await deleteUserPaymentMethod({ userId: req.user._id, methodId: req.params.methodId });
        return res.json(result);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to delete payment method', 500));
    }
});

// @desc    List payment operations for admin
// @route   GET /api/admin/payments
// @access  Private/Admin
const getAdminPayments = asyncHandler(async (req, res, next) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 20;
        const result = await listAdminPaymentIntents({
            page,
            limit,
            status: req.query.status,
            provider: req.query.provider,
            method: req.query.method,
        });
        return res.json({
            page,
            limit,
            total: result.total,
            items: result.items,
        });
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to fetch admin payments', 500));
    }
});

// @desc    Payment detail for admin
// @route   GET /api/admin/payments/:intentId
// @access  Private/Admin
const getAdminPaymentById = asyncHandler(async (req, res, next) => {
    try {
        const intent = await getPaymentIntentForUser({
            intentId: req.params.intentId,
            userId: req.user._id,
            allowAdmin: true,
        });
        return res.json(intent);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to fetch payment detail', 500));
    }
});

// @desc    Force capture an authorized payment intent
// @route   POST /api/admin/payments/:intentId/capture
// @access  Private/Admin
const captureAdminPayment = asyncHandler(async (req, res, next) => {
    try {
        const idempotencyKey = getRequiredIdempotencyKey(req);
        const userKey = getStableUserKey(req);

        const result = await withIdempotency({
            key: idempotencyKey,
            userKey,
            route: `payments:admin_capture:${req.params.intentId}`,
            requestPayload: req.body || {},
            handler: async () => {
                const intent = await captureIntentNow({ intentId: req.params.intentId });
                return {
                    statusCode: 200,
                    response: {
                        intentId: intent.intentId,
                        status: intent.status,
                        capturedAt: intent.capturedAt,
                    },
                };
            },
        });

        await notifyPaymentOwnerAdminAction({
            req,
            intentId: req.params.intentId,
            actionKey: 'admin.payment.capture',
            actionTitle: 'Payment Captured by Admin',
            actionSummary: 'An administrator captured your authorized payment.',
            highlights: [
                `Captured at: ${result.response?.capturedAt || new Date().toISOString()}`,
                `Final status: ${result.response?.status || 'captured'}`,
            ],
        });

        return res.status(result.statusCode).json(result.response);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to capture payment', 500));
    }
});

// @desc    Re-enqueue capture task
// @route   POST /api/admin/payments/:intentId/retry-capture
// @access  Private/Admin
const retryAdminCapture = asyncHandler(async (req, res, next) => {
    try {
        const idempotencyKey = getRequiredIdempotencyKey(req);
        const userKey = getStableUserKey(req);

        const result = await withIdempotency({
            key: idempotencyKey,
            userKey,
            route: `payments:admin_retry_capture:${req.params.intentId}`,
            requestPayload: req.body || {},
            handler: async () => {
                const task = await scheduleCaptureTask({ intentId: req.params.intentId });
                return {
                    statusCode: 200,
                    response: {
                        queued: Boolean(task),
                        taskId: task?._id || null,
                        intentId: req.params.intentId,
                    },
                };
            },
        });

        await notifyPaymentOwnerAdminAction({
            req,
            intentId: req.params.intentId,
            actionKey: 'admin.payment.capture_retry',
            actionTitle: 'Payment Capture Retry Queued',
            actionSummary: 'An administrator queued a payment capture retry for your order.',
            highlights: [
                `Queued: ${result.response?.queued ? 'yes' : 'no'}`,
                `Task ID: ${result.response?.taskId || 'n/a'}`,
            ],
        });

        return res.status(result.statusCode).json(result.response);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to requeue capture', 500));
    }
});

// @desc    Payment operations overview for admin command center
// @route   GET /api/admin/payments/ops/overview
// @access  Private/Admin
const getAdminPaymentOpsOverview = asyncHandler(async (req, res, next) => {
    try {
        const overview = await getPaymentOpsOverview();
        return res.json(overview);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to fetch payment operations overview', 500));
    }
});

// @desc    Expire stale payment intents from admin ops
// @route   POST /api/admin/payments/ops/expire-stale
// @access  Private/Admin
const expireAdminStalePaymentIntents = asyncHandler(async (req, res, next) => {
    try {
        const idempotencyKey = getRequiredIdempotencyKey(req);
        const userKey = getStableUserKey(req);

        const result = await withIdempotency({
            key: idempotencyKey,
            userKey,
            route: 'payments:admin_expire_stale',
            requestPayload: req.body || {},
            handler: async () => {
                const response = await expireStalePaymentIntents({
                    limit: req.body?.limit,
                    dryRun: Boolean(req.body?.dryRun),
                });
                return { statusCode: 200, response };
            },
        });

        return res.status(result.statusCode).json(result.response);
    } catch (error) {
        if (error instanceof AppError) return next(error);
        return next(new AppError(error.message || 'Failed to expire stale payment intents', 500));
    }
});

module.exports = {
    createIntent,
    completeChallenge,
    confirmIntent,
    getIntent,
    createRefund,
    handleRazorpayWebhook,
    getPaymentMethods,
    getPaymentCapabilitiesCatalog,
    getNetbankingBanks,
    addPaymentMethod,
    makeDefaultPaymentMethod,
    removePaymentMethod,
    getAdminPayments,
    getAdminPaymentById,
    getAdminRefundLedger,
    updateAdminRefundLedgerReference,
    captureAdminPayment,
    retryAdminCapture,
    getAdminPaymentOpsOverview,
    expireAdminStalePaymentIntents,
};
