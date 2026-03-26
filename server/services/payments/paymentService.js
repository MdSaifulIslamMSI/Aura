const mongoose = require('mongoose');
const AppError = require('../../utils/AppError');
const Order = require('../../models/Order');
const User = require('../../models/User');
const PaymentIntent = require('../../models/PaymentIntent');
const PaymentEvent = require('../../models/PaymentEvent');
const PaymentMethod = require('../../models/PaymentMethod');
const PaymentOutboxTask = require('../../models/PaymentOutboxTask');
const os = require('os');
const WORKER_ID = `${os.hostname()}-${process.pid}`;
const {
    buildOrderQuote,
} = require('../orderPricingService');
const { getPaymentProvider } = require('./providerFactory');
const { evaluateRisk } = require('./riskEngine');
const {
    DIGITAL_METHODS,
    INTENT_EXPIRY_MINUTES,
    MAX_OUTBOX_RETRIES,
    OUTBOX_POLL_MS,
    PAYMENT_SECURITY_MAX_ACTIVE_INTENTS,
    PAYMENT_SECURITY_MAX_CONFIRM_ATTEMPTS,
    PAYMENT_SECURITY_MAX_CONFIRM_FAILURES,
    PAYMENT_SECURITY_CONFIRM_LOCK_MINUTES,
    PAYMENT_STATUSES,
} = require('./constants');
const {
    hashPayload,
    makeIntentId,
    makeEventId,
    roundCurrency,
    normalizeMethod,
    mapPaymentMethodToProviderType,
    mapProviderTypeToPaymentMethod,
} = require('./helpers');
const {
    diff,
    buildSecurityState,
    setSecurityState,
    getLockUntilDate,
    assertQuoteMatches,
    isIntentExpired,
    assertConfirmNotLocked,
} = require('./securityGuards');
const {
    calculateRefundable,
    buildRefundEntry,
    buildRefundMutation,
} = require('./refundState');
const {
    scheduleCaptureTask,
    scheduleRefundTask,
    updateOrderCommandRefundEntry,
    getPaymentOutboxStats,
} = require('./outboxState');
const {
    getNetbankingBankCatalog,
    lookupNetbankingBankName,
    normalizeNetbankingBankCode,
    resolveNetbankingBank,
} = require('./netbankingCatalog');
const { flags } = require('../../config/paymentFlags');
const { verifyPaymentChallengeToken } = require('../../utils/paymentChallengeToken');
const logger = require('../../utils/logger');

const appendPaymentEvent = async ({
    eventId = makeEventId('evt'),
    intentId,
    source,
    type,
    payload,
}) => {
    const payloadHash = hashPayload(payload);
    return PaymentEvent.create({
        eventId,
        intentId,
        source,
        type,
        payloadHash,
        payload,
        receivedAt: new Date(),
    });
};

const ensurePaymentsEnabled = () => {
    if (!flags.paymentsEnabled) {
        throw new AppError('Payments are currently disabled', 503);
    }
};

const registerConfirmFailure = async ({
    intent,
    reason,
    providerOrderId = '',
    providerPaymentId = '',
}) => {
    const current = buildSecurityState(intent);
    const failedConfirmAttempts = current.failedConfirmAttempts + 1;
    const totalConfirmFailures = current.totalConfirmFailures + 1;

    const shouldLock = failedConfirmAttempts >= PAYMENT_SECURITY_MAX_CONFIRM_FAILURES;
    const lockedUntil = shouldLock
        ? new Date(Date.now() + (PAYMENT_SECURITY_CONFIRM_LOCK_MINUTES * 60 * 1000))
        : null;

    setSecurityState(intent, {
        failedConfirmAttempts: shouldLock ? 0 : failedConfirmAttempts,
        totalConfirmFailures,
        lastConfirmFailedAt: new Date().toISOString(),
        lastConfirmFailureReason: String(reason || 'unknown_failure'),
        lockedUntil: lockedUntil ? lockedUntil.toISOString() : null,
    });

    intent.attemptCount = Number(intent.attemptCount || 0) + 1;
    await intent.save();

    try {
        await appendPaymentEvent({
            intentId: intent.intentId,
            source: 'api',
            type: 'intent.confirm_failed',
            payload: {
                reason,
                providerOrderId,
                providerPaymentId,
                failedConfirmAttempts: shouldLock ? PAYMENT_SECURITY_MAX_CONFIRM_FAILURES : failedConfirmAttempts,
                totalConfirmFailures,
                lockedUntil: lockedUntil ? lockedUntil.toISOString() : null,
            },
        });
    } catch (eventError) {
        logger.warn('payment.confirm_failure_event_failed', {
            intentId: intent.intentId,
            reason,
            error: eventError.message,
        });
    }
};

const buildCheckoutPayload = ({
    providerOrderId,
    amount,
    currency,
    user,
    paymentMethod,
    paymentContext = {},
}) => {
    if (!process.env.RAZORPAY_KEY_ID) {
        throw new AppError('Razorpay checkout key is not configured on the server', 503);
    }

    const checkoutPayload = {
        key: process.env.RAZORPAY_KEY_ID,
        orderId: providerOrderId,
        amount,
        currency,
        name: 'Aura Marketplace',
        description: 'Aura Secure Checkout',
        prefill: {
            name: user?.name || '',
            email: user?.email || '',
            contact: user?.phone || '',
        },
        theme: { color: '#06b6d4' },
    };

    const preferredBankCode = normalizeNetbankingBankCode(paymentContext?.netbanking?.bankCode);
    if (paymentMethod === 'NETBANKING' && preferredBankCode) {
        const preferredBankName = lookupNetbankingBankName(
            preferredBankCode,
            paymentContext?.netbanking?.bankName
        );
        checkoutPayload.config = {
            display: {
                blocks: {
                    preferred_netbanking_bank: {
                        name: `Continue with ${preferredBankName}`,
                        instruments: [
                            {
                                method: 'netbanking',
                                banks: [preferredBankCode],
                            },
                        ],
                    },
                },
                hide: [
                    { method: 'upi' },
                    { method: 'card' },
                    { method: 'wallet' },
                ],
                sequence: ['block.preferred_netbanking_bank', 'netbanking'],
                preferences: {
                    show_default_blocks: false,
                },
            },
        };
    }

    return checkoutPayload;
};

const normalizeSavedBankPreference = (savedMethod = {}) => {
    if (String(savedMethod?.type || '').trim().toLowerCase() !== 'bank') return null;

    const bankCode = normalizeNetbankingBankCode(
        savedMethod?.metadata?.bankCode || savedMethod?.providerMethodId
    );
    if (!bankCode) return null;

    return {
        bankCode,
        bankName: lookupNetbankingBankName(bankCode, savedMethod?.metadata?.bankName || savedMethod?.brand),
        source: 'saved_method',
        savedMethodId: String(savedMethod?._id || ''),
        isDefault: Boolean(savedMethod?.isDefault),
    };
};

const decorateStoredPaymentMethod = (method = {}) => {
    if (String(method?.type || '').trim().toLowerCase() !== 'bank') {
        return method;
    }

    const bankCode = normalizeNetbankingBankCode(method?.metadata?.bankCode || method?.providerMethodId);
    if (!bankCode) return method;

    const bankName = lookupNetbankingBankName(bankCode, method?.metadata?.bankName || method?.brand);
    return {
        ...method,
        brand: bankName,
        metadata: {
            ...(method.metadata || {}),
            bankCode,
            bankName,
        },
    };
};

const annotateBankCatalogEntries = (banks = [], savedBanks = []) => {
    const savedByCode = new Map(savedBanks.map((bank) => [bank.bankCode, bank]));

    return (banks || []).map((bank) => {
        const savedBank = savedByCode.get(bank.code);
        return {
            ...bank,
            isSaved: Boolean(savedBank),
            isDefaultSaved: Boolean(savedBank?.isDefault),
            savedMethodId: savedBank?.savedMethodId || '',
        };
    });
};

const resolveIntentPaymentContext = async ({
    paymentMethod,
    paymentContext = {},
    savedMethod = null,
    provider = null,
}) => {
    if (paymentMethod !== 'NETBANKING') {
        return {};
    }

    const requestedBankCode = normalizeNetbankingBankCode(paymentContext?.netbanking?.bankCode);
    const savedBank = normalizeSavedBankPreference(savedMethod);

    if (requestedBankCode && savedBank?.bankCode && requestedBankCode !== savedBank.bankCode) {
        throw new AppError('Selected netbanking bank does not match the saved bank preference', 409);
    }

    const resolvedBankCode = requestedBankCode || savedBank?.bankCode;
    if (!resolvedBankCode) {
        throw new AppError('Select a supported netbanking bank before continuing', 400);
    }

    const catalog = await getNetbankingBankCatalog({
        provider,
        allowFallback: false,
    });
    const providerBank = resolveNetbankingBank(catalog, resolvedBankCode);
    if (!providerBank) {
        throw new AppError('Selected bank is not available for netbanking right now', 409);
    }

    return {
        netbanking: {
            bankCode: providerBank.code,
            bankName: providerBank.name,
            source: savedBank?.bankCode === providerBank.code ? 'saved_method' : (paymentContext?.netbanking?.source || 'catalog'),
        },
    };
};

const normalizeProviderMethodSnapshot = (methodInfo = {}) => {
    if (String(methodInfo.type || '').trim().toLowerCase() !== 'bank') {
        return methodInfo;
    }

    const bankCode = normalizeNetbankingBankCode(methodInfo.bankCode || methodInfo.providerMethodId);
    const bankName = lookupNetbankingBankName(bankCode, methodInfo.bankName || methodInfo.brand);
    return {
        ...methodInfo,
        bankCode,
        bankName,
        brand: bankName || methodInfo.brand || bankCode,
        providerMethodId: bankCode || methodInfo.providerMethodId || '',
    };
};

const createPaymentIntent = async ({
    user,
    quotePayload,
    quoteSnapshot,
    paymentMethod,
    savedMethodId,
    paymentContext = {},
    deviceContext = {},
    requestMeta = {},
}) => {
    ensurePaymentsEnabled();

    const normalizedMethod = normalizeMethod(paymentMethod);
    if (!DIGITAL_METHODS.includes(normalizedMethod)) {
        throw new AppError('Payment intent can only be created for digital methods', 400);
    }

    const activeIntentsCount = await PaymentIntent.countDocuments({
        user: user._id,
        order: null,
        status: {
            $in: [
                PAYMENT_STATUSES.CREATED,
                PAYMENT_STATUSES.CHALLENGE_PENDING,
                PAYMENT_STATUSES.AUTHORIZED,
            ],
        },
        expiresAt: { $gt: new Date() },
    });

    if (activeIntentsCount >= PAYMENT_SECURITY_MAX_ACTIVE_INTENTS) {
        throw new AppError(
            `Too many active payment intents. Complete or wait for existing intents before creating a new one.`,
            429
        );
    }

    const quote = await buildOrderQuote(
        { ...quotePayload, paymentMethod: normalizedMethod },
        { checkStock: true }
    );
    assertQuoteMatches(quoteSnapshot, quote.pricing.totalPrice);

    let savedMethod = null;
    if (savedMethodId && flags.paymentSavedMethodsEnabled) {
        savedMethod = await PaymentMethod.findOne({ _id: savedMethodId, user: user._id, status: 'active' }).lean();
        if (!savedMethod) {
            throw new AppError('Saved payment method is invalid', 400);
        }
        const expectedSavedType = mapPaymentMethodToProviderType(normalizedMethod);
        if (expectedSavedType && String(savedMethod.type || '').trim().toLowerCase() !== expectedSavedType) {
            throw new AppError('Saved payment method does not match the selected payment rail', 400);
        }
    }

    const risk = await evaluateRisk({
        userId: user._id,
        amount: quote.pricing.totalPrice,
        deviceContext,
        requestMeta,
        shippingAddress: quote.normalized.shippingAddress,
        mode: flags.paymentRiskMode,
    });

    if (risk.blocked) {
        throw new AppError('Payment blocked by risk policy. Try COD or contact support.', 403);
    }

    const provider = await getPaymentProvider({
        amount: quote.pricing.totalPrice,
        currency: 'INR',
        paymentMethod: normalizedMethod,
        bin: String(requestMeta.cardBin || ''),
        userId: user._id,
    });
    const resolvedPaymentContext = await resolveIntentPaymentContext({
        paymentMethod: normalizedMethod,
        paymentContext,
        savedMethod,
        provider,
    });
    const intentId = makeIntentId();
    const providerOrder = await provider.createOrder({
        amount: quote.pricing.totalPrice,
        currency: 'INR',
        receipt: intentId,
        notes: {
            intentId,
            userId: String(user._id),
            checkoutSource: quote.normalized.checkoutSource,
            paymentMethod: normalizedMethod,
            netbankingBankCode: resolvedPaymentContext?.netbanking?.bankCode || '',
        },
    });

    const challengeRequired = flags.paymentChallengeEnabled && risk.challengeRequired;
    const intentStatus = challengeRequired ? PAYMENT_STATUSES.CHALLENGE_PENDING : PAYMENT_STATUSES.CREATED;
    const expiresAt = new Date(Date.now() + (INTENT_EXPIRY_MINUTES * 60 * 1000));

    const intent = await PaymentIntent.create({
        intentId,
        user: user._id,
        provider: provider.name,
        routingInsights: provider.routingInsights || null,
        providerOrderId: providerOrder.id,
        amount: quote.pricing.totalPrice,
        currency: 'INR',
        method: normalizedMethod,
        status: intentStatus,
        riskSnapshot: {
            score: risk.score,
            decision: risk.strictDecision,
            factors: risk.factors,
            mode: risk.mode,
        },
        challenge: {
            required: challengeRequired,
            status: challengeRequired ? 'pending' : 'none',
            verifiedAt: null,
        },
        orderClaim: {
            state: 'none',
            key: '',
            lockedAt: null,
        },
        expiresAt,
        metadata: {
            quotePayload,
            quoteSnapshot,
            shippingAddress: quote.normalized.shippingAddress,
            deliveryOption: quote.normalized.deliveryOption,
            deliverySlot: quote.normalized.deliverySlot,
            couponCode: quote.normalized.couponCode,
            checkoutSource: quote.normalized.checkoutSource,
            ip: requestMeta.ip || '',
            userAgent: requestMeta.userAgent || '',
            deviceContext,
            savedMethodId: savedMethodId || '',
            paymentContext: resolvedPaymentContext,
            netbanking: resolvedPaymentContext?.netbanking || null,
            securityLayer: {
                failedConfirmAttempts: 0,
                totalConfirmFailures: 0,
                lastConfirmFailedAt: null,
                lastConfirmFailureReason: '',
                lockedUntil: null,
            },
        },
    });

    await appendPaymentEvent({
        intentId,
        source: 'api',
        type: 'intent.created',
        payload: {
            providerOrderId: providerOrder.id,
            amount: quote.pricing.totalPrice,
            risk,
        },
    });

    return {
        intentId: intent.intentId,
        provider: provider.name,
        providerOrderId: intent.providerOrderId,
        amount: intent.amount,
        currency: intent.currency,
        status: intent.status,
        riskDecision: risk.strictDecision,
        challengeRequired,
        paymentContext: resolvedPaymentContext,
        checkoutPayload: buildCheckoutPayload({
            providerOrderId: intent.providerOrderId,
            amount: quote.pricing.totalPrice,
            currency: 'INR',
            user,
            paymentMethod: normalizedMethod,
            paymentContext: resolvedPaymentContext,
        }),
    };
};

const markChallengeVerified = async ({ userId, userPhone, intentId, challengeToken }) => {
    const intent = await PaymentIntent.findOne({ intentId, user: userId });
    if (!intent) throw new AppError('Payment intent not found', 404);
    if (!intent.challenge?.required) {
        return {
            intentId: intent.intentId,
            challengeRequired: false,
            status: intent.status,
        };
    }

    const tokenPayload = verifyPaymentChallengeToken(challengeToken);
    if (String(tokenPayload.sub) !== String(userId)) {
        throw new AppError('Challenge token does not belong to this user', 403);
    }
    if (String(tokenPayload.phone || '') !== String(userPhone || '')) {
        throw new AppError('Challenge token phone mismatch', 403);
    }
    if (tokenPayload.intentId && String(tokenPayload.intentId) !== String(intentId)) {
        throw new AppError('Challenge token does not match this payment intent', 403);
    }

    intent.challenge.status = 'verified';
    intent.challenge.verifiedAt = new Date();
    if (intent.status === PAYMENT_STATUSES.CHALLENGE_PENDING) {
        intent.status = PAYMENT_STATUSES.CREATED;
    }
    await intent.save();

    await appendPaymentEvent({
        intentId,
        source: 'api',
        type: 'challenge.verified',
        payload: { userId: String(userId) },
    });

    return {
        intentId: intent.intentId,
        challengeRequired: true,
        status: intent.status,
    };
};

const confirmPaymentIntent = async ({
    userId,
    intentId,
    providerPaymentId,
    providerOrderId,
    providerSignature,
}) => {
    ensurePaymentsEnabled();

    const intent = await PaymentIntent.findOne({ intentId, user: userId });
    if (!intent) throw new AppError('Payment intent not found', 404);

    const cleanPaymentId = String(providerPaymentId || '').trim();
    const cleanOrderId = String(providerOrderId || '').trim();
    const cleanSignature = String(providerSignature || '').trim();

    if (isIntentExpired(intent)) {
        intent.status = PAYMENT_STATUSES.EXPIRED;
        await intent.save();
        throw new AppError('Payment intent expired. Please retry payment.', 409);
    }

    assertConfirmNotLocked(intent);

    if (Number(intent.attemptCount || 0) >= PAYMENT_SECURITY_MAX_CONFIRM_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + (PAYMENT_SECURITY_CONFIRM_LOCK_MINUTES * 60 * 1000));
        setSecurityState(intent, {
            failedConfirmAttempts: 0,
            lastConfirmFailedAt: new Date().toISOString(),
            lastConfirmFailureReason: 'max_confirm_attempts_exceeded',
            lockedUntil: lockedUntil.toISOString(),
        });
        await intent.save();
        throw new AppError(
            `Maximum confirmation attempts reached for this payment intent. Retry after ${PAYMENT_SECURITY_CONFIRM_LOCK_MINUTES} minutes.`,
            429
        );
    }

    if (intent.challenge?.required && intent.challenge.status !== 'verified') {
        throw new AppError('Payment challenge must be verified before confirmation', 403);
    }

    if (cleanOrderId !== intent.providerOrderId) {
        await registerConfirmFailure({
            intent,
            reason: 'provider_order_mismatch',
            providerOrderId: cleanOrderId,
            providerPaymentId: cleanPaymentId,
        });
        throw new AppError('Payment order mismatch', 400);
    }

    if ([PAYMENT_STATUSES.AUTHORIZED, PAYMENT_STATUSES.CAPTURED].includes(intent.status)) {
        if (intent.providerPaymentId && cleanPaymentId && intent.providerPaymentId !== cleanPaymentId) {
            throw new AppError('Payment intent already confirmed with a different payment reference', 409);
        }

        return {
            intentId: intent.intentId,
            status: intent.status,
            authorizedAt: intent.authorizedAt,
            riskDecision: intent.riskSnapshot?.decision || 'allow',
            providerMethod: intent.metadata?.providerMethodSnapshot || null,
        };
    }

    const duplicatePaymentRef = await PaymentIntent.findOne({
        _id: { $ne: intent._id },
        provider: intent.provider,
        providerPaymentId: cleanPaymentId,
    }).select('intentId user').lean();

    if (duplicatePaymentRef) {
        await registerConfirmFailure({
            intent,
            reason: 'payment_reference_replay_detected',
            providerOrderId: cleanOrderId,
            providerPaymentId: cleanPaymentId,
        });
        throw new AppError('Payment reference replay detected. Transaction blocked.', 409);
    }

    const provider = await getPaymentProvider({
        amount: intent.amount,
        currency: intent.currency,
        paymentMethod: intent.method,
        userId: intent.user,
    });
    const verified = provider.verifySignature({
        orderId: cleanOrderId,
        paymentId: cleanPaymentId,
        signature: cleanSignature,
    });
    if (!verified) {
        await registerConfirmFailure({
            intent,
            reason: 'invalid_signature',
            providerOrderId: cleanOrderId,
            providerPaymentId: cleanPaymentId,
        });
        throw new AppError('Invalid payment signature', 400);
    }

    let payment;
    try {
        payment = await provider.fetchPayment(cleanPaymentId);
    } catch (error) {
        await registerConfirmFailure({
            intent,
            reason: 'provider_fetch_failed',
            providerOrderId: cleanOrderId,
            providerPaymentId: cleanPaymentId,
        });
        throw new AppError('Unable to verify payment with provider right now. Please retry.', 502);
    }

    const status = String(payment.status || '').toLowerCase();
    if (!['captured', 'authorized'].includes(status)) {
        await registerConfirmFailure({
            intent,
            reason: `provider_status_${status || 'unknown'}`,
            providerOrderId: cleanOrderId,
            providerPaymentId: cleanPaymentId,
        });
        throw new AppError(`Provider returned non-authorized status: ${status || 'unknown'}`, 409);
    }

    const nextStatus = status === 'captured' ? PAYMENT_STATUSES.CAPTURED : PAYMENT_STATUSES.AUTHORIZED;

    const methodInfo = normalizeProviderMethodSnapshot(provider.parsePaymentMethod(payment));
    const providerConfirmedMethod = mapProviderTypeToPaymentMethod(methodInfo.type);
    if (providerConfirmedMethod !== intent.method) {
        await registerConfirmFailure({
            intent,
            reason: `provider_method_mismatch:${providerConfirmedMethod || 'unknown'}`,
            providerOrderId: cleanOrderId,
            providerPaymentId: cleanPaymentId,
        });
        throw new AppError('Provider payment method does not match the selected checkout method', 409);
    }

    const expectedBankCode = normalizeNetbankingBankCode(
        intent.metadata?.paymentContext?.netbanking?.bankCode || intent.metadata?.netbanking?.bankCode
    );
    if (intent.method === 'NETBANKING' && expectedBankCode && methodInfo.bankCode && expectedBankCode !== methodInfo.bankCode) {
        await registerConfirmFailure({
            intent,
            reason: `provider_bank_mismatch:${methodInfo.bankCode}`,
            providerOrderId: cleanOrderId,
            providerPaymentId: cleanPaymentId,
        });
        throw new AppError('Provider bank does not match the selected netbanking bank', 409);
    }

    intent.providerPaymentId = cleanPaymentId;
    intent.providerMethodId = methodInfo.providerMethodId || '';
    intent.status = nextStatus;
    intent.authorizedAt = new Date();
    if (nextStatus === PAYMENT_STATUSES.CAPTURED) {
        intent.capturedAt = new Date();
    }
    intent.attemptCount = Number(intent.attemptCount || 0) + 1;

    setSecurityState(intent, {
        failedConfirmAttempts: 0,
        lastConfirmFailedAt: null,
        lastConfirmFailureReason: '',
        lockedUntil: null,
    });
    intent.metadata = {
        ...(intent.metadata || {}),
        providerMethodSnapshot: methodInfo,
    };
    intent.markModified('metadata');
    await intent.save();

    if (flags.paymentSavedMethodsEnabled && methodInfo.providerMethodId) {
        await PaymentMethod.updateOne(
            {
                user: userId,
                providerMethodId: methodInfo.providerMethodId,
            },
            {
                $set: {
                    user: userId,
                    provider: provider.name,
                    providerMethodId: methodInfo.providerMethodId,
                    type: methodInfo.type,
                    brand: methodInfo.brand,
                    last4: methodInfo.last4,
                    status: 'active',
                    metadata: methodInfo.bankCode ? {
                        bankCode: methodInfo.bankCode,
                        bankName: methodInfo.bankName || methodInfo.brand || '',
                        enrollmentSource: 'checkout',
                    } : {},
                },
                $setOnInsert: {
                    fingerprintHash: hashPayload(`${methodInfo.type}|${methodInfo.brand}|${methodInfo.last4}|${methodInfo.providerMethodId}`),
                    isDefault: false,
                },
            },
            { upsert: true }
        );
    }

    await appendPaymentEvent({
        intentId,
        source: 'api',
        type: 'intent.confirmed',
        payload: {
            providerPaymentId: cleanPaymentId,
            providerOrderId: cleanOrderId,
            status: nextStatus,
            securityLayer: {
                maxAttempts: PAYMENT_SECURITY_MAX_CONFIRM_ATTEMPTS,
                maxFailures: PAYMENT_SECURITY_MAX_CONFIRM_FAILURES,
            },
        },
    });

    return {
        intentId: intent.intentId,
        status: intent.status,
        authorizedAt: intent.authorizedAt,
        riskDecision: intent.riskSnapshot?.decision || 'allow',
        providerMethod: methodInfo,
    };
};

const getPaymentIntentForUser = async ({ intentId, userId, allowAdmin = false }) => {
    const filter = { intentId };
    if (!allowAdmin) filter.user = userId;

    const intent = await PaymentIntent.findOne(filter).lean();
    if (!intent) throw new AppError('Payment intent not found', 404);

    const events = await PaymentEvent.find({ intentId }).sort({ receivedAt: 1 }).lean();
    return { ...intent, events };
};

const validatePaymentIntentForOrder = async ({
    userId,
    paymentIntentId,
    paymentMethod,
    totalPrice,
    session = null,
    claimForOrder = false,
    claimKey = '',
}) => {
    const normalizedMethod = normalizeMethod(paymentMethod);
    if (!DIGITAL_METHODS.includes(normalizedMethod)) {
        return { paymentIntent: null, isPaid: false, paymentState: 'pending' };
    }

    if (!paymentIntentId) {
        throw new AppError('paymentIntentId is required for digital checkout', 400);
    }

    const findIntentQuery = PaymentIntent.findOne({ intentId: paymentIntentId, user: userId });
    const intent = session ? await findIntentQuery.session(session) : await findIntentQuery;
    if (!intent) throw new AppError('Payment intent not found for this user', 404);
    if (isIntentExpired(intent)) throw new AppError('Payment intent expired. Please retry payment.', 409);

    if (diff(intent.amount, totalPrice) > 0.01) {
        throw new AppError('Payment amount mismatch with latest quote', 409);
    }
    if (intent.method !== normalizedMethod) {
        throw new AppError('Payment method mismatch for intent', 409);
    }

    if (![PAYMENT_STATUSES.AUTHORIZED, PAYMENT_STATUSES.CAPTURED].includes(intent.status)) {
        throw new AppError('Payment is not authorized for order placement', 400);
    }

    if (claimForOrder) {
        const lockKey = String(claimKey || makeEventId('claim')).trim();
        const claimQuery = PaymentIntent.findOneAndUpdate(
            {
                _id: intent._id,
                $and: [
                    { $or: [{ order: null }, { order: { $exists: false } }] },
                    {
                        $or: [
                            { 'orderClaim.state': 'none' },
                            { 'orderClaim.state': 'locked', 'orderClaim.key': lockKey },
                        ],
                    },
                ],
            },
            {
                $set: {
                    orderClaim: {
                        state: 'locked',
                        key: lockKey,
                        lockedAt: new Date(),
                    },
                },
            },
            { returnDocument: 'after' }
        );
        const claimedIntent = session ? await claimQuery.session(session) : await claimQuery;
        if (!claimedIntent) {
            throw new AppError('Payment intent is already being used for another order', 409);
        }
        const isPaid = claimedIntent.status === PAYMENT_STATUSES.CAPTURED;
        return {
            paymentIntent: claimedIntent,
            isPaid,
            paymentState: claimedIntent.status,
            claimKey: lockKey,
        };
    }

    const isPaid = intent.status === PAYMENT_STATUSES.CAPTURED;
    return {
        paymentIntent: intent,
        isPaid,
        paymentState: intent.status,
    };
};

const linkIntentToOrder = async ({ intentId, orderId, session = null, claimKey = '' }) => {
    if (!intentId) return null;
    const query = PaymentIntent.findOneAndUpdate(
        {
            intentId,
            $or: [{ order: null }, { order: orderId }],
        },
        {
            $set: {
                order: orderId,
                orderClaim: {
                    state: 'consumed',
                    key: String(claimKey || ''),
                    lockedAt: new Date(),
                },
            },
        },
        { returnDocument: 'after' }
    );
    return session ? query.session(session) : query;
};

const applyOrderPaymentCapture = async (intent) => {
    if (!intent?.order) return;

    await Order.updateOne(
        { _id: intent.order },
        {
            $set: {
                paymentState: PAYMENT_STATUSES.CAPTURED,
                paymentCapturedAt: intent.capturedAt || new Date(),
                isPaid: true,
                paidAt: intent.capturedAt || new Date(),
            },
        }
    );
};

const captureIntentNow = async ({ intentId }) => {
    const intent = await PaymentIntent.findOne({ intentId });
    if (!intent) throw new AppError('Capture intent not found', 404);
    if (intent.status === PAYMENT_STATUSES.CAPTURED) return intent;
    if (intent.status !== PAYMENT_STATUSES.AUTHORIZED) {
        throw new AppError(`Capture not allowed from status ${intent.status}`, 400);
    }

    const provider = await getPaymentProvider({
        amount: intent.amount,
        currency: intent.currency,
        paymentMethod: intent.method,
        userId: intent.user,
    });
    await provider.capture({
        paymentId: intent.providerPaymentId,
        amount: intent.amount,
        currency: intent.currency,
    });

    intent.status = PAYMENT_STATUSES.CAPTURED;
    intent.capturedAt = new Date();
    await intent.save();

    await appendPaymentEvent({
        intentId,
        source: 'system',
        type: 'intent.captured',
        payload: { capturedAt: intent.capturedAt.toISOString() },
    });
    await applyOrderPaymentCapture(intent);

    return intent;
};

const createRefundForIntent = async ({
    actorUserId,
    isAdmin,
    intentId,
    amount,
    reason,
}) => {
    if (!flags.paymentRefundsEnabled) {
        throw new AppError('Refund operations are disabled', 403);
    }

    const intent = await PaymentIntent.findOne({ intentId }).populate('order');
    if (!intent) throw new AppError('Payment intent not found', 404);
    if (!intent.order) throw new AppError('Refund can only be created after order placement', 400);

    const order = intent.order;
    if (!isAdmin && String(order.user) !== String(actorUserId)) {
        throw new AppError('Not authorized to refund this payment', 403);
    }

    if (!intent.providerPaymentId) {
        throw new AppError('Provider payment reference is missing for refund', 400);
    }

    const refundable = calculateRefundable(order);
    if (refundable <= 0) {
        throw new AppError('No refundable amount remaining', 400);
    }

    const requestedAmount = amount === undefined || amount === null ? refundable : roundCurrency(amount);
    if (requestedAmount <= 0) throw new AppError('Refund amount must be positive', 400);
    if (requestedAmount > refundable) throw new AppError('Refund amount exceeds refundable balance', 400);

    const provider = await getPaymentProvider({
        amount: requestedAmount,
        currency: intent.currency,
        paymentMethod: intent.method,
        userId: intent.user,
    });
    const providerRefund = await provider.refund({
        paymentId: intent.providerPaymentId,
        amount: requestedAmount,
        notes: {
            reason: reason || 'requested_by_user',
            intentId,
        },
    });

    const refundEntry = buildRefundEntry({
        providerRefund,
        requestedAmount,
        reason,
        fallbackRefundId: makeEventId('refund'),
    });
    const refundMutation = buildRefundMutation({
        order,
        requestedAmount,
        refundEntry,
    });

    await Order.updateOne(
        { _id: order._id },
        {
            $set: {
                refundSummary: refundMutation.refundSummary,
                paymentState: refundMutation.paymentState,
            },
        }
    );

    intent.status = refundMutation.paymentState;
    await intent.save();

    await appendPaymentEvent({
        intentId,
        source: 'api',
        type: 'refund.created',
        payload: refundEntry,
    });

    return {
        refundId: refundEntry.refundId,
        status: refundEntry.status,
        amount: refundEntry.amount,
        currency: intent.currency,
        intentId,
    };
};

const extractWebhookIdentifiers = (event = {}) => {
    const paymentEntity = event.payload?.payment?.entity || {};
    const refundEntity = event.payload?.refund?.entity || {};
    return {
        eventId: event.id || makeEventId('wh'),
        paymentId: paymentEntity.id || refundEntity.payment_id || '',
        orderId: paymentEntity.order_id || '',
        eventType: event.event || 'unknown',
        paymentStatus: paymentEntity.status || '',
        refundId: refundEntity.id || '',
        amount: paymentEntity.amount || refundEntity.amount || 0,
        payload: event,
    };
};

const PAYMENT_STATUS_TRANSITIONS = {
    [PAYMENT_STATUSES.CREATED]: new Set([
        PAYMENT_STATUSES.CREATED,
        PAYMENT_STATUSES.AUTHORIZED,
        PAYMENT_STATUSES.FAILED,
        PAYMENT_STATUSES.EXPIRED,
    ]),
    [PAYMENT_STATUSES.CHALLENGE_PENDING]: new Set([
        PAYMENT_STATUSES.CHALLENGE_PENDING,
        PAYMENT_STATUSES.CREATED,
        PAYMENT_STATUSES.FAILED,
        PAYMENT_STATUSES.EXPIRED,
    ]),
    [PAYMENT_STATUSES.AUTHORIZED]: new Set([
        PAYMENT_STATUSES.AUTHORIZED,
        PAYMENT_STATUSES.CAPTURED,
        PAYMENT_STATUSES.FAILED,
    ]),
    [PAYMENT_STATUSES.CAPTURED]: new Set([
        PAYMENT_STATUSES.CAPTURED,
        PAYMENT_STATUSES.PARTIALLY_REFUNDED,
        PAYMENT_STATUSES.REFUNDED,
    ]),
    [PAYMENT_STATUSES.PARTIALLY_REFUNDED]: new Set([
        PAYMENT_STATUSES.PARTIALLY_REFUNDED,
        PAYMENT_STATUSES.REFUNDED,
    ]),
    [PAYMENT_STATUSES.REFUNDED]: new Set([
        PAYMENT_STATUSES.REFUNDED,
    ]),
    [PAYMENT_STATUSES.FAILED]: new Set([
        PAYMENT_STATUSES.FAILED,
    ]),
    [PAYMENT_STATUSES.EXPIRED]: new Set([
        PAYMENT_STATUSES.EXPIRED,
    ]),
};

const canTransitionPaymentStatus = ({ currentStatus, targetStatus }) => {
    if (!targetStatus) return true;
    const allowedTargets = PAYMENT_STATUS_TRANSITIONS[currentStatus] || new Set([currentStatus]);
    return allowedTargets.has(targetStatus);
};

const mapWebhookEventToPaymentStatus = ({ eventType, currentStatus }) => {
    if (eventType === 'payment.authorized') return PAYMENT_STATUSES.AUTHORIZED;
    if (eventType === 'payment.captured') return PAYMENT_STATUSES.CAPTURED;
    if (eventType === 'payment.failed') return PAYMENT_STATUSES.FAILED;
    if (eventType === 'refund.processed') {
        if (currentStatus === PAYMENT_STATUSES.REFUNDED) {
            return PAYMENT_STATUSES.REFUNDED;
        }
        return PAYMENT_STATUSES.PARTIALLY_REFUNDED;
    }
    return null;
};

const processRazorpayWebhook = async ({ signature, rawBody }) => {
    const provider = await getPaymentProvider();
    if (provider.name !== 'razorpay') {
        throw new AppError('Unsupported payment provider for webhook processing', 400);
    }

    const valid = provider.verifyWebhookSignature({ rawBody, signature });
    if (!valid) {
        throw new AppError('Invalid webhook signature', 400);
    }

    const parsed = provider.parseWebhook(rawBody);
    const parsedEvent = extractWebhookIdentifiers(parsed);

    const existing = await PaymentEvent.findOne({ eventId: parsedEvent.eventId }).lean();
    if (existing) {
        return { received: true, deduped: true };
    }

    const intent = await PaymentIntent.findOne({
        $or: [
            { providerOrderId: parsedEvent.orderId },
            { providerPaymentId: parsedEvent.paymentId },
        ],
    });

    if (!intent) {
        await PaymentEvent.create({
            eventId: parsedEvent.eventId,
            intentId: 'unknown',
            source: 'webhook',
            type: parsedEvent.eventType,
            payloadHash: hashPayload(parsed),
            payload: parsed,
            receivedAt: new Date(),
        });
        return { received: true, deduped: false, intentId: null };
    }

    const currentStatus = intent.status;
    const mapped = mapWebhookEventToPaymentStatus({
        eventType: parsedEvent.eventType,
        currentStatus,
    });
    const validTransition = canTransitionPaymentStatus({
        currentStatus,
        targetStatus: mapped,
    });

    if (!validTransition) {
        logger.warn('payment.webhook_transition_discarded', {
            eventId: parsedEvent.eventId,
            eventType: parsedEvent.eventType,
            intentId: intent.intentId,
            currentStatus,
            targetStatus: mapped,
        });

        await PaymentEvent.create({
            eventId: parsedEvent.eventId,
            intentId: intent.intentId,
            source: 'webhook',
            type: parsedEvent.eventType,
            payloadHash: hashPayload(parsed),
            payload: {
                ...parsed,
                processingMeta: {
                    discarded: true,
                    reason: 'invalid_status_transition',
                    currentStatus,
                    targetStatus: mapped,
                },
            },
            receivedAt: new Date(),
        });

        return {
            received: true,
            deduped: false,
            intentId: intent.intentId,
            discarded: true,
            reason: 'invalid_status_transition',
        };
    }

    if (mapped) {
        intent.status = mapped;
    }
    if (parsedEvent.paymentId) {
        intent.providerPaymentId = parsedEvent.paymentId;
    }
    if (parsedEvent.eventType === 'payment.authorized') {
        intent.authorizedAt = new Date();
    }
    if (parsedEvent.eventType === 'payment.captured') {
        intent.capturedAt = new Date();
    }
    await intent.save();

    await PaymentEvent.create({
        eventId: parsedEvent.eventId,
        intentId: intent.intentId,
        source: 'webhook',
        type: parsedEvent.eventType,
        payloadHash: hashPayload(parsed),
        payload: parsed,
        receivedAt: new Date(),
    });

    const statusTransitionedToCaptured = currentStatus !== PAYMENT_STATUSES.CAPTURED
        && intent.status === PAYMENT_STATUSES.CAPTURED;
    if (statusTransitionedToCaptured) {
        await applyOrderPaymentCapture(intent);
    }

    return { received: true, deduped: false, intentId: intent.intentId };
};

const processOutboxTask = async (task) => {
    task.status = 'processing';
    await task.save();

    try {
        if (task.taskType === 'capture') {
            await captureIntentNow({ intentId: task.intentId });
        } else if (task.taskType === 'refund') {
            const refundResult = await createRefundForIntent({
                actorUserId: task.payload?.actorUserId || null,
                isAdmin: true,
                intentId: task.intentId,
                amount: task.payload?.amount ?? undefined,
                reason: task.payload?.reason || 'queued_refund_retry',
            });

            await updateOrderCommandRefundEntry({
                orderId: task.payload?.orderId,
                requestId: task.payload?.requestId,
                status: 'processed',
                message: `Refund processed (${refundResult.status})`,
                refundId: refundResult.refundId || '',
                processedAt: new Date(),
            });
        } else {
            throw new AppError(`Unsupported outbox task type: ${task.taskType}`, 400);
        }

        task.status = 'done';
        task.lastError = '';
        task.lockedAt = null;
        task.lockedBy = null;
        await task.save();
    } catch (error) {
        const isRetryable = Number(error?.statusCode || 500) >= 500;
        task.retryCount += 1;
        task.lastError = error.message;

        if (!isRetryable || task.retryCount >= MAX_OUTBOX_RETRIES) {
            task.status = 'failed';
            task.nextRunAt = new Date(Date.now() + (60 * 60 * 1000));
            if (task.taskType === 'refund') {
                await updateOrderCommandRefundEntry({
                    orderId: task.payload?.orderId,
                    requestId: task.payload?.requestId,
                    status: 'rejected',
                    message: error.message || 'Refund retry exhausted',
                    processedAt: new Date(),
                });
            }
        } else {
            task.status = 'pending';
            const backoffMs = Math.min((2 ** task.retryCount) * 1000, 5 * 60 * 1000);
            task.nextRunAt = new Date(Date.now() + backoffMs);
            if (task.taskType === 'refund') {
                await updateOrderCommandRefundEntry({
                    orderId: task.payload?.orderId,
                    requestId: task.payload?.requestId,
                    status: 'pending',
                    message: `Retry scheduled: ${error.message || 'provider temporary failure'}`,
                    processedAt: new Date(),
                });
            }
        }
        task.lockedAt = null;
        task.lockedBy = null;
        await task.save();
    }
};

const runOutboxCycle = async () => {
    // 1. Release stale locks (tasks stuck in processing for > 5 mins)
    const lockExpiry = new Date(Date.now() - 5 * 60 * 1000);
    await PaymentOutboxTask.updateMany(
        { status: 'processing', lockedAt: { $lt: lockExpiry } },
        { $set: { status: 'pending', lockedAt: null, lockedBy: null } }
    );

    // 2. Fetch and lock up to 20 tasks sequentially
    for (let i = 0; i < 20; i++) {
        const task = await PaymentOutboxTask.findOneAndUpdate(
            {
                status: 'pending',
                nextRunAt: { $lte: new Date() }
            },
            {
                $set: {
                    status: 'processing',
                    lockedAt: new Date(),
                    lockedBy: WORKER_ID
                }
            },
            { returnDocument: 'after', sort: { nextRunAt: 1 } }
        );

        if (!task) break; // Exhausted queue

        await processOutboxTask(task);
    }
};

let outboxTimer = null;
const startPaymentOutboxWorker = () => {
    if (outboxTimer || !flags.paymentsEnabled) return;
    outboxTimer = setInterval(() => {
        runOutboxCycle().catch((error) => {
            logger.error('payment_outbox.cycle_failed', { error: error.message });
        });
    }, OUTBOX_POLL_MS);
};

const getPaymentOutboxStatsWithWorker = async () => {
    const stats = await getPaymentOutboxStats();
    return {
        ...stats,
        workerRunning: Boolean(outboxTimer),
    };
};

const listUserPaymentMethods = async ({ userId }) => {
    if (!flags.paymentSavedMethodsEnabled) return [];
    const methods = await PaymentMethod.find({ user: userId, status: 'active' })
        .sort({ isDefault: -1, updatedAt: -1 })
        .lean();
    return methods.map(decorateStoredPaymentMethod);
};

const listNetbankingBanks = async ({ userId }) => {
    ensurePaymentsEnabled();

    const provider = await getPaymentProvider({
        currency: 'INR',
        paymentMethod: 'NETBANKING',
        userId,
    });
    const [catalog, storedMethods] = await Promise.all([
        getNetbankingBankCatalog({ provider, allowFallback: true }),
        flags.paymentSavedMethodsEnabled
            ? PaymentMethod.find({ user: userId, status: 'active', type: 'bank' })
                .sort({ isDefault: -1, updatedAt: -1 })
                .lean()
            : [],
    ]);

    const savedBanks = storedMethods
        .map(normalizeSavedBankPreference)
        .filter(Boolean);
    const defaultSavedBank = savedBanks.find((bank) => bank.isDefault) || null;

    return {
        ...catalog,
        defaultBankCode: defaultSavedBank?.bankCode || '',
        savedBanks,
        banks: annotateBankCatalogEntries(catalog.banks, savedBanks),
        featuredBanks: annotateBankCatalogEntries(catalog.featuredBanks, savedBanks),
    };
};

const PAYMENT_METHOD_ENROLLMENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const getRecentIntentBinding = async ({ userId, providerMethodId, paymentIntentId = '' }) => {
    const normalizedIntentId = String(paymentIntentId || '').trim();
    const query = {
        user: userId,
        status: { $in: [PAYMENT_STATUSES.AUTHORIZED, PAYMENT_STATUSES.CAPTURED] },
        authorizedAt: { $gte: new Date(Date.now() - PAYMENT_METHOD_ENROLLMENT_MAX_AGE_MS) },
        'metadata.providerMethodSnapshot.providerMethodId': providerMethodId,
    };

    if (normalizedIntentId) {
        query.intentId = normalizedIntentId;
    }

    return PaymentIntent.findOne(query).sort({ authorizedAt: -1 });
};

const saveUserPaymentMethod = async ({ userId, method, paymentIntentId = '' }) => {
    if (!flags.paymentSavedMethodsEnabled) {
        throw new AppError('Saved payment methods are disabled', 403);
    }

    const providerMethodId = String(method.providerMethodId || '').trim();
    if (!providerMethodId) throw new AppError('providerMethodId is required', 400);

    const bindingIntent = await getRecentIntentBinding({
        userId,
        providerMethodId,
        paymentIntentId,
    });
    if (!bindingIntent || !bindingIntent.providerPaymentId) {
        throw new AppError('Unable to establish payment method ownership for this user', 403);
    }

    const provider = await getPaymentProvider({
        amount: bindingIntent.amount,
        currency: bindingIntent.currency,
        paymentMethod: bindingIntent.method,
        userId: bindingIntent.user,
    });

    let providerPayment;
    try {
        providerPayment = await provider.fetchPayment(bindingIntent.providerPaymentId);
    } catch (error) {
        throw new AppError('Unable to verify payment method with provider right now. Please retry.', 502);
    }

    const providerMethodSnapshot = normalizeProviderMethodSnapshot(provider.parsePaymentMethod(providerPayment || {}));
    if (providerMethodSnapshot.providerMethodId !== providerMethodId) {
        throw new AppError('Unable to establish payment method ownership for this user', 403);
    }

    if (String(providerPayment.order_id || bindingIntent.providerOrderId) !== String(bindingIntent.providerOrderId)) {
        throw new AppError('Unable to establish payment method ownership for this user', 403);
    }

    const payload = {
        user: userId,
        provider: bindingIntent.provider || method.provider || flags.paymentProvider || 'razorpay',
        providerMethodId,
        type: providerMethodSnapshot.type || method.type || 'other',
        brand: providerMethodSnapshot.brand || method.brand || '',
        last4: providerMethodSnapshot.last4 || method.last4 || '',
        status: 'active',
        fingerprintHash: hashPayload(`${providerMethodId}|${providerMethodSnapshot.type || method.type || 'other'}|${providerMethodSnapshot.last4 || method.last4 || ''}`),
        metadata: {
            ...(method.metadata || {}),
            ...(providerMethodSnapshot.bankCode ? {
                bankCode: providerMethodSnapshot.bankCode,
                bankName: providerMethodSnapshot.bankName || providerMethodSnapshot.brand || '',
            } : {}),
        },
    };

    await PaymentMethod.updateOne(
        { user: userId, providerMethodId },
        { $set: payload, $setOnInsert: { isDefault: false } },
        { upsert: true }
    );

    const storedMethod = await PaymentMethod.findOne({ user: userId, providerMethodId }).lean();
    return decorateStoredPaymentMethod(storedMethod);
};

const deleteUserPaymentMethod = async ({ userId, methodId }) => {
    const method = await PaymentMethod.findOne({ _id: methodId, user: userId });
    if (!method) throw new AppError('Payment method not found', 404);
    method.status = 'inactive';
    method.isDefault = false;
    await method.save();
    return { success: true };
};

const setDefaultPaymentMethod = async ({ userId, methodId }) => {
    const method = await PaymentMethod.findOne({ _id: methodId, user: userId, status: 'active' });
    if (!method) throw new AppError('Payment method not found', 404);

    await PaymentMethod.updateMany({ user: userId }, { $set: { isDefault: false } });
    method.isDefault = true;
    await method.save();
    return method.toObject();
};

const listAdminPaymentIntents = async ({ page = 1, limit = 20, status, provider, method }) => {
    const skip = (Math.max(Number(page), 1) - 1) * Math.max(Number(limit), 1);
    const query = {};
    if (status) query.status = status;
    if (provider) query.provider = provider;
    if (method) query.method = method;

    const [items, total] = await Promise.all([
        PaymentIntent.find(query)
            .populate('user', 'name email phone')
            .populate('order', '_id totalPrice paymentState createdAt')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Math.max(Number(limit), 1))
            .lean(),
        PaymentIntent.countDocuments(query),
    ]);

    return { items, total };
};

module.exports = {
    createPaymentIntent,
    confirmPaymentIntent,
    getPaymentIntentForUser,
    processRazorpayWebhook,
    validatePaymentIntentForOrder,
    linkIntentToOrder,
    scheduleCaptureTask,
    scheduleRefundTask,
    captureIntentNow,
    createRefundForIntent,
    runOutboxCycle,
    startPaymentOutboxWorker,
    getPaymentOutboxStats: getPaymentOutboxStatsWithWorker,
    markChallengeVerified,
    listUserPaymentMethods,
    listNetbankingBanks,
    saveUserPaymentMethod,
    deleteUserPaymentMethod,
    setDefaultPaymentMethod,
    listAdminPaymentIntents,
};
