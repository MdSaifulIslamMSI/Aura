const crypto = require('crypto');
const mongoose = require('mongoose');
const FraudDecision = require('../models/FraudDecision');
const PaymentIntent = require('../models/PaymentIntent');
const Order = require('../models/Order');
const ProductReview = require('../models/ProductReview');
const { flags } = require('../config/fraudDecisioningFlags');
const { evaluateRisk: evaluatePaymentRisk } = require('./payments/riskEngine');
const { evaluateLoginRisk } = require('./authRiskEngineService');
const { getIntegrityIssue } = require('./marketplaceIntegrityService');
const { buildSellerTrustPassport } = require('./sellerTrustService');
const logger = require('../utils/logger');

const DECISIONS = Object.freeze({
    ALLOW: 'allow',
    CHALLENGE: 'challenge',
    REVIEW: 'review',
    HOLD: 'hold',
    BLOCK: 'block',
});

const LEVELS = Object.freeze({
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
});

const DECISION_RANK = Object.freeze({
    [DECISIONS.ALLOW]: 0,
    [DECISIONS.CHALLENGE]: 1,
    [DECISIONS.REVIEW]: 2,
    [DECISIONS.HOLD]: 3,
    [DECISIONS.BLOCK]: 4,
});

const clampScore = (value) => Math.max(0, Math.min(100, Number(value) || 0));

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const normalizeMode = (mode, fallback = flags.fraudDecisioningMode) => {
    const normalized = safeString(mode || fallback).toLowerCase();
    if (['off', 'monitor', 'shadow', 'enforce'].includes(normalized)) return normalized;
    return fallback;
};

const makeDecisionId = () => `frd_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`;

const hashSignalValue = (value) => {
    const clean = safeString(value);
    if (!clean) return '';
    return crypto.createHash('sha256').update(clean).digest('hex').slice(0, 24);
};

const sanitizeRequestMeta = (requestMeta = {}) => ({
    ipHash: hashSignalValue(requestMeta.ip),
    userAgentHash: hashSignalValue(requestMeta.userAgent),
    requestId: safeString(requestMeta.requestId).slice(0, 120),
    market: requestMeta.market || null,
    source: safeString(requestMeta.source).slice(0, 80),
});

const scoreLevel = (score) => {
    if (score >= 90) return LEVELS.CRITICAL;
    if (score >= 70) return LEVELS.HIGH;
    if (score >= 40) return LEVELS.MEDIUM;
    return LEVELS.LOW;
};

const strongerDecision = (current, candidate) =>
    (DECISION_RANK[candidate] || 0) > (DECISION_RANK[current] || 0) ? candidate : current;

const isReadyModel = (Model) => Model?.db?.readyState === 1;

const isValidObjectId = (value) => mongoose.isValidObjectId(value);

const dateAgo = (ms) => new Date(Date.now() - ms);

const normalizeCouponCode = (value) => safeString(value).toUpperCase().replace(/[^A-Z0-9_-]+/g, '').slice(0, 40);

const normalizeReviewText = (value) => safeString(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getDeviceId = (deviceContext = {}) => safeString(
    deviceContext.deviceId
    || deviceContext.deviceFingerprint
    || deviceContext.fingerprint
    || deviceContext.browserSessionId
).slice(0, 160);

const addSignal = (signals, {
    code,
    source = 'fraud_decisioning',
    points = 0,
    severity = 'medium',
    message = '',
    evidence = {},
}) => {
    const cleanCode = safeString(code);
    if (!cleanCode) return;
    signals.push({
        code: cleanCode,
        source,
        points: clampScore(points),
        severity,
        message: safeString(message).slice(0, 500),
        evidence,
    });
};

const isPaymentAction = (action) => action.startsWith('payment') || action === 'escrow_payment_intent';
const isRefundAction = (action) => action.startsWith('refund') || action === 'order_refund_request';
const isReviewAction = (action) => action.startsWith('review') || action === 'product_review_submit';

const decisionFromScore = ({ action, score }) => {
    if (isRefundAction(action)) {
        if (score >= 70) return DECISIONS.HOLD;
        if (score >= 40) return DECISIONS.REVIEW;
        return DECISIONS.ALLOW;
    }
    if (isReviewAction(action)) {
        if (score >= 40) return DECISIONS.REVIEW;
        return DECISIONS.ALLOW;
    }
    if (score >= 70) return DECISIONS.BLOCK;
    if (score >= 55) return isPaymentAction(action) ? DECISIONS.CHALLENGE : DECISIONS.REVIEW;
    if (score >= 40) return isPaymentAction(action) || action.startsWith('auth')
        ? DECISIONS.CHALLENGE
        : DECISIONS.REVIEW;
    return DECISIONS.ALLOW;
};

const effectiveDecisionForMode = ({ strictDecision, mode }) => {
    if (mode === 'enforce') return strictDecision;
    return DECISIONS.ALLOW;
};

const buildOutcome = ({ decision, mode }) => ({
    enforced: mode === 'enforce' && decision !== DECISIONS.ALLOW,
    blocked: decision === DECISIONS.BLOCK,
    challengeRequired: decision === DECISIONS.CHALLENGE,
    reviewRequired: decision === DECISIONS.REVIEW,
    holdRequired: decision === DECISIONS.HOLD,
});

const shouldPersist = (persist) => persist !== false && flags.fraudDecisionAuditEnabled;

const queueForDecision = ({ action, decision }) => {
    if (decision === DECISIONS.ALLOW || decision === DECISIONS.CHALLENGE) return '';
    if (isPaymentAction(action)) return 'payment_risk';
    if (isRefundAction(action)) return 'refund_abuse';
    if (isReviewAction(action)) return 'review_integrity';
    if (action.startsWith('marketplace_listing')) return 'marketplace_integrity';
    if (action.startsWith('auth')) return 'auth_risk';
    return 'fraud_risk';
};

const persistDecision = async (decision, persist) => {
    if (!shouldPersist(persist)) return null;
    if (FraudDecision.db.readyState !== 1) return null;
    try {
        const saved = await FraudDecision.create({
            decisionId: decision.decisionId,
            action: decision.action,
            mode: decision.mode,
            score: decision.score,
            level: decision.level,
            strictDecision: decision.strictDecision,
            decision: decision.decision,
            user: mongoose.isValidObjectId(decision.userId) ? decision.userId : null,
            subject: decision.subject,
            signals: decision.signals,
            modules: decision.modules,
            requestMeta: decision.requestMeta,
            outcome: decision.outcome,
            review: decision.review,
            metadata: decision.metadata,
        });
        return saved.decisionId;
    } catch (error) {
        logger.warn('fraud_decision.audit_failed', {
            action: decision.action,
            decisionId: decision.decisionId,
            error: error.message,
        });
        return null;
    }
};

const collectDecisionVelocitySignals = async ({ action, userId, requestMeta = {}, subject = {} }) => {
    const signals = [];
    if (!isReadyModel(FraudDecision)) return signals;

    const sanitized = sanitizeRequestMeta(requestMeta);
    const since15m = dateAgo(15 * 60 * 1000);
    const since1h = dateAgo(60 * 60 * 1000);
    const subjectType = safeString(subject.subjectType || subject.type);
    const subjectId = safeString(subject.subjectId || subject.id);

    try {
        const jobs = [];
        jobs.push(isValidObjectId(userId)
            ? FraudDecision.countDocuments({ user: userId, createdAt: { $gte: since15m } })
            : Promise.resolve(0));
        jobs.push(sanitized.ipHash
            ? FraudDecision.countDocuments({ 'requestMeta.ipHash': sanitized.ipHash, createdAt: { $gte: since15m } })
            : Promise.resolve(0));
        jobs.push(subjectType && subjectId
            ? FraudDecision.countDocuments({
                'subject.subjectType': subjectType,
                'subject.subjectId': subjectId,
                createdAt: { $gte: since1h },
            })
            : Promise.resolve(0));

        const [userDecisions15m, ipDecisions15m, subjectDecisions1h] = await Promise.all(jobs);

        if (userDecisions15m >= 8) {
            addSignal(signals, {
                code: 'decision_velocity_user_15m',
                source: 'decision_velocity',
                points: 25,
                severity: 'high',
                message: 'User has unusually high risk-decision velocity.',
                evidence: { count: userDecisions15m, window: '15m' },
            });
        } else if (userDecisions15m >= 4) {
            addSignal(signals, {
                code: 'decision_velocity_user_15m',
                source: 'decision_velocity',
                points: 12,
                severity: 'medium',
                message: 'User has elevated risk-decision velocity.',
                evidence: { count: userDecisions15m, window: '15m' },
            });
        }

        if (ipDecisions15m >= 25) {
            addSignal(signals, {
                code: 'decision_velocity_ip_15m',
                source: 'decision_velocity',
                points: 30,
                severity: 'high',
                message: 'Many risk decisions are originating from the same network signal.',
                evidence: { count: ipDecisions15m, window: '15m' },
            });
        }

        if (subjectDecisions1h >= 10) {
            addSignal(signals, {
                code: 'decision_velocity_subject_1h',
                source: 'decision_velocity',
                points: 20,
                severity: 'medium',
                message: 'The same subject is receiving repeated risk decisions.',
                evidence: { count: subjectDecisions1h, window: '1h' },
            });
        }
    } catch (error) {
        logger.warn('fraud_decision.velocity_failed', { action, error: error.message });
    }

    return signals;
};

const collectPaymentGraphSignals = async ({ userId, deviceContext = {}, requestMeta = {}, shippingAddress = {} }) => {
    const signals = [];
    if (!isReadyModel(PaymentIntent)) return signals;

    const since24h = dateAgo(24 * 60 * 60 * 1000);
    const since30d = dateAgo(30 * 24 * 60 * 60 * 1000);
    const ip = safeString(requestMeta.ip);
    const deviceId = getDeviceId(deviceContext);
    const postalCode = safeString(shippingAddress.postalCode || shippingAddress.pincode);

    try {
        if (ip) {
            const [ipIntentCount, ipUsers] = await Promise.all([
                PaymentIntent.countDocuments({ 'metadata.ip': ip, createdAt: { $gte: since24h } }),
                PaymentIntent.distinct('user', { 'metadata.ip': ip, createdAt: { $gte: since24h } }),
            ]);
            if (ipIntentCount >= 25 || ipUsers.length >= 6) {
                addSignal(signals, {
                    code: 'shared_ip_payment_cluster',
                    source: 'payment_identity_graph',
                    points: 25,
                    severity: 'high',
                    message: 'Payment activity forms a dense shared-IP cluster.',
                    evidence: { intentCount: ipIntentCount, userCount: ipUsers.length, window: '24h' },
                });
            } else if (ipUsers.length >= 3) {
                addSignal(signals, {
                    code: 'shared_ip_multi_user',
                    source: 'payment_identity_graph',
                    points: 12,
                    severity: 'medium',
                    message: 'Multiple users recently used the same IP for payments.',
                    evidence: { userCount: ipUsers.length, window: '24h' },
                });
            }
        }

        if (deviceId.length >= 8) {
            const deviceQuery = {
                'metadata.deviceContext.deviceId': deviceId,
                createdAt: { $gte: since30d },
            };
            const deviceUsers = await PaymentIntent.distinct('user', deviceQuery);
            const otherUsers = isValidObjectId(userId)
                ? deviceUsers.filter((entry) => String(entry) !== String(userId))
                : deviceUsers;
            if (otherUsers.length >= 3) {
                addSignal(signals, {
                    code: 'shared_device_multi_account',
                    source: 'payment_identity_graph',
                    points: 40,
                    severity: 'high',
                    message: 'The same device fingerprint is linked to multiple payment accounts.',
                    evidence: { otherUserCount: otherUsers.length, window: '30d' },
                });
            } else if (otherUsers.length >= 1) {
                addSignal(signals, {
                    code: 'shared_device_seen_elsewhere',
                    source: 'payment_identity_graph',
                    points: 15,
                    severity: 'medium',
                    message: 'The device fingerprint was seen on another payment account.',
                    evidence: { otherUserCount: otherUsers.length, window: '30d' },
                });
            }
        }

        if (postalCode.length >= 4) {
            const postalUsers = await PaymentIntent.distinct('user', {
                'metadata.shippingAddress.postalCode': postalCode,
                createdAt: { $gte: since24h },
            });
            if (postalUsers.length >= 8) {
                addSignal(signals, {
                    code: 'shipping_postal_velocity',
                    source: 'payment_identity_graph',
                    points: 15,
                    severity: 'medium',
                    message: 'Shipping postal code has unusually high recent buyer concentration.',
                    evidence: { userCount: postalUsers.length, window: '24h' },
                });
            }
        }
    } catch (error) {
        logger.warn('fraud_decision.payment_graph_failed', { error: error.message });
    }

    return signals;
};

const collectCouponSignals = async ({ userId, couponCode }) => {
    const signals = [];
    const normalizedCoupon = normalizeCouponCode(couponCode);
    if (!normalizedCoupon || !isReadyModel(Order) || !isValidObjectId(userId)) return signals;

    try {
        const since24h = dateAgo(24 * 60 * 60 * 1000);
        const since30d = dateAgo(30 * 24 * 60 * 60 * 1000);
        const [userCoupon24h, userCoupon30d, globalCouponUsers24h] = await Promise.all([
            Order.countDocuments({ user: userId, couponCode: normalizedCoupon, createdAt: { $gte: since24h } }),
            Order.countDocuments({ user: userId, couponCode: normalizedCoupon, createdAt: { $gte: since30d } }),
            Order.distinct('user', { couponCode: normalizedCoupon, createdAt: { $gte: since24h } }),
        ]);

        if (userCoupon24h >= 3) {
            addSignal(signals, {
                code: 'coupon_velocity_user_24h',
                source: 'coupon_abuse',
                points: 40,
                severity: 'high',
                message: 'User has repeated same-coupon usage in a short window.',
                evidence: { couponCode: normalizedCoupon, count: userCoupon24h, window: '24h' },
            });
        } else if (userCoupon30d >= 5) {
            addSignal(signals, {
                code: 'coupon_reuse_user_30d',
                source: 'coupon_abuse',
                points: 14,
                severity: 'medium',
                message: 'User has high same-coupon reuse over 30 days.',
                evidence: { couponCode: normalizedCoupon, count: userCoupon30d, window: '30d' },
            });
        }

        if (globalCouponUsers24h.length >= 50) {
            addSignal(signals, {
                code: 'coupon_global_spike_24h',
                source: 'coupon_abuse',
                points: 18,
                severity: 'medium',
                message: 'Coupon usage is spiking across many users.',
                evidence: { couponCode: normalizedCoupon, userCount: globalCouponUsers24h.length, window: '24h' },
            });
        }
    } catch (error) {
        logger.warn('fraud_decision.coupon_failed', { error: error.message });
    }

    return signals;
};

const collectRefundSignals = async ({ userId, order = {}, amount = 0, reason = '' }) => {
    const signals = [];
    if (!isReadyModel(Order)) return signals;

    const refunds = Array.isArray(order?.commandCenter?.refunds) ? order.commandCenter.refunds : [];
    const activeRefunds = refunds.filter((refund) => !['processed', 'rejected'].includes(String(refund?.status || '').toLowerCase()));
    const orderTotal = Number(order?.totalPrice || 0);
    const requestedAmount = Number(amount || 0);
    const refundRatio = orderTotal > 0 ? requestedAmount / orderTotal : 0;

    if (activeRefunds.length > 0) {
        addSignal(signals, {
            code: 'duplicate_open_refund_request',
            source: 'refund_abuse',
            points: 45,
            severity: 'high',
            message: 'Order already has an open refund workflow.',
            evidence: { openRefunds: activeRefunds.length },
        });
    }

    if (refundRatio >= 0.95 && orderTotal > 0) {
        addSignal(signals, {
            code: 'near_full_refund_request',
            source: 'refund_abuse',
            points: 18,
            severity: 'medium',
            message: 'Refund request is near the full order value.',
            evidence: { amount: requestedAmount, orderTotal },
        });
    }

    if (!order?.isDelivered && String(order?.orderStatus || '').toLowerCase() !== 'cancelled') {
        addSignal(signals, {
            code: 'pre_delivery_refund_request',
            source: 'refund_abuse',
            points: 14,
            severity: 'medium',
            message: 'Refund requested before delivery completion.',
            evidence: { orderStatus: order?.orderStatus || 'unknown' },
        });
    }

    if (safeString(reason).length > 0 && safeString(reason).length < 8) {
        addSignal(signals, {
            code: 'weak_refund_reason',
            source: 'refund_abuse',
            points: 8,
            severity: 'low',
            message: 'Refund reason has very little detail.',
        });
    }

    if (isValidObjectId(userId)) {
        try {
            const since30d = dateAgo(30 * 24 * 60 * 60 * 1000);
            const [recentRefundOrders, recentCancelledOrders] = await Promise.all([
                Order.countDocuments({
                    user: userId,
                    'commandCenter.refunds.0': { $exists: true },
                    createdAt: { $gte: since30d },
                }),
                Order.countDocuments({
                    user: userId,
                    orderStatus: 'cancelled',
                    createdAt: { $gte: since30d },
                }),
            ]);

            if (recentRefundOrders >= 4) {
                addSignal(signals, {
                    code: 'refund_velocity_user_30d',
                    source: 'refund_abuse',
                    points: 42,
                    severity: 'high',
                    message: 'User has high refund-request velocity.',
                    evidence: { count: recentRefundOrders, window: '30d' },
                });
            } else if (recentRefundOrders >= 2) {
                addSignal(signals, {
                    code: 'refund_repeat_user_30d',
                    source: 'refund_abuse',
                    points: 18,
                    severity: 'medium',
                    message: 'User has multiple recent refund requests.',
                    evidence: { count: recentRefundOrders, window: '30d' },
                });
            }

            if (recentCancelledOrders >= 3) {
                addSignal(signals, {
                    code: 'cancel_refund_correlation',
                    source: 'refund_abuse',
                    points: 18,
                    severity: 'medium',
                    message: 'User has repeated recent cancellations alongside refund activity.',
                    evidence: { count: recentCancelledOrders, window: '30d' },
                });
            }
        } catch (error) {
            logger.warn('fraud_decision.refund_history_failed', { error: error.message });
        }
    }

    return signals;
};

const collectReviewSignals = async ({ userId, productId, reviewInput = {} }) => {
    const signals = [];
    if (!isReadyModel(ProductReview)) return signals;

    const rating = Number(reviewInput.rating || 0);
    const comment = normalizeReviewText(reviewInput.comment);
    const commentLength = comment.length;

    if (rating === 5 && commentLength < 24) {
        addSignal(signals, {
            code: 'thin_five_star_review',
            source: 'review_integrity',
            points: 15,
            severity: 'medium',
            message: 'Five-star review has very little written evidence.',
        });
    }

    if (commentLength > 0 && commentLength < 12) {
        addSignal(signals, {
            code: 'thin_review_text',
            source: 'review_integrity',
            points: 10,
            severity: 'low',
            message: 'Review text is too thin for strong trust.',
        });
    }

    try {
        const since24h = dateAgo(24 * 60 * 60 * 1000);
        const since30d = dateAgo(30 * 24 * 60 * 60 * 1000);
        const jobs = [];
        jobs.push(isValidObjectId(userId)
            ? ProductReview.countDocuments({ user: userId, createdAt: { $gte: since24h } })
            : Promise.resolve(0));
        jobs.push(isValidObjectId(userId)
            ? ProductReview.countDocuments({ user: userId, status: 'hidden', createdAt: { $gte: since30d } })
            : Promise.resolve(0));
        jobs.push(comment
            ? ProductReview.countDocuments({ comment: new RegExp(`^${comment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), createdAt: { $gte: since30d } })
            : Promise.resolve(0));
        jobs.push(isValidObjectId(productId) && rating >= 1 && rating <= 5
            ? ProductReview.countDocuments({ product: productId, rating, createdAt: { $gte: since24h } })
            : Promise.resolve(0));

        const [recentReviews, hiddenReviews, duplicateComments, sameRatingProductBurst] = await Promise.all(jobs);

        if (recentReviews >= 6) {
            addSignal(signals, {
                code: 'review_velocity_user_24h',
                source: 'review_integrity',
                points: 35,
                severity: 'high',
                message: 'User posted unusually many reviews in 24 hours.',
                evidence: { count: recentReviews, window: '24h' },
            });
        } else if (recentReviews >= 3) {
            addSignal(signals, {
                code: 'review_repeat_user_24h',
                source: 'review_integrity',
                points: 16,
                severity: 'medium',
                message: 'User has elevated review frequency.',
                evidence: { count: recentReviews, window: '24h' },
            });
        }

        if (hiddenReviews >= 2) {
            addSignal(signals, {
                code: 'prior_hidden_reviews',
                source: 'review_integrity',
                points: 28,
                severity: 'high',
                message: 'User has recent hidden reviews.',
                evidence: { count: hiddenReviews, window: '30d' },
            });
        }

        if (duplicateComments >= 2) {
            addSignal(signals, {
                code: 'duplicate_review_text',
                source: 'review_integrity',
                points: 38,
                severity: 'high',
                message: 'Review text duplicates recent marketplace reviews.',
                evidence: { count: duplicateComments, window: '30d' },
            });
        }

        if (sameRatingProductBurst >= 8) {
            addSignal(signals, {
                code: 'product_rating_burst',
                source: 'review_integrity',
                points: 22,
                severity: 'medium',
                message: 'Product has a same-rating review burst.',
                evidence: { rating, count: sameRatingProductBurst, window: '24h' },
            });
        }
    } catch (error) {
        logger.warn('fraud_decision.review_failed', { error: error.message });
    }

    return signals;
};

const buildDecision = async ({
    action,
    userId = null,
    mode,
    subject = {},
    requestMeta = {},
    signals = [],
    modules = [],
    forcedDecision = null,
    metadata = {},
    persist = true,
}) => {
    const normalizedMode = normalizeMode(mode);
    const combinedSignals = [...signals];
    const velocitySignals = await collectDecisionVelocitySignals({ action, userId, requestMeta, subject });
    combinedSignals.push(...velocitySignals);

    const score = clampScore(combinedSignals.reduce((sum, signal) => sum + (Number(signal.points) || 0), 0));
    const scoredDecision = decisionFromScore({ action, score });
    const strictDecision = forcedDecision
        ? strongerDecision(scoredDecision, forcedDecision)
        : scoredDecision;
    const decision = normalizedMode === 'off'
        ? DECISIONS.ALLOW
        : effectiveDecisionForMode({ strictDecision, mode: normalizedMode });
    const outcome = buildOutcome({ decision, mode: normalizedMode });
    const decisionId = makeDecisionId();
    const factorCodes = combinedSignals.map((signal) => signal.code);
    const reviewQueue = queueForDecision({ action, decision: strictDecision });
    const review = {
        status: reviewQueue ? 'open' : 'none',
        queue: reviewQueue,
        assignedTo: null,
        reviewedBy: null,
        reviewedAt: null,
        resolution: '',
        note: '',
    };

    const result = {
        decisionId,
        auditId: null,
        action,
        userId,
        mode: normalizedMode,
        score,
        level: scoreLevel(score),
        strictDecision,
        decision,
        factors: factorCodes,
        signals: combinedSignals,
        modules,
        subject: {
            subjectType: safeString(subject.subjectType || subject.type).slice(0, 80),
            subjectId: safeString(subject.subjectId || subject.id).slice(0, 160),
        },
        requestMeta: sanitizeRequestMeta(requestMeta),
        outcome,
        enforced: outcome.enforced,
        blocked: outcome.blocked,
        challengeRequired: outcome.challengeRequired,
        reviewRequired: outcome.reviewRequired,
        holdRequired: outcome.holdRequired,
        message: combinedSignals.find((signal) => ['critical', 'high'].includes(signal.severity))?.message || '',
        review,
        metadata,
    };

    result.auditId = await persistDecision(result, persist);
    return result;
};

const assessPaymentIntent = async ({
    action,
    user,
    userId,
    amount,
    deviceContext,
    requestMeta,
    shippingAddress,
    mode,
    subject,
    metadata,
    persist,
}) => {
    const normalizedUserId = userId || user?._id || null;
    const paymentRisk = await evaluatePaymentRisk({
        userId: normalizedUserId,
        amount,
        deviceContext,
        requestMeta,
        shippingAddress,
        mode: 'enforce',
    });
    const signals = [];
    (paymentRisk.factors || []).forEach((factor) => {
        addSignal(signals, {
            code: factor,
            source: 'payment_risk_engine',
            points: Math.max(10, Math.round((paymentRisk.score || 0) / Math.max((paymentRisk.factors || []).length, 1))),
            severity: paymentRisk.strictDecision === DECISIONS.BLOCK ? 'high' : 'medium',
            message: `Payment risk signal: ${factor}`,
        });
    });
    const graphSignals = await collectPaymentGraphSignals({
        userId: normalizedUserId,
        deviceContext,
        requestMeta,
        shippingAddress,
    });
    const couponSignals = await collectCouponSignals({
        userId: normalizedUserId,
        couponCode: metadata?.couponCode,
    });
    signals.push(...graphSignals, ...couponSignals);

    const forcedDecision = paymentRisk.strictDecision === DECISIONS.BLOCK
        ? DECISIONS.BLOCK
        : paymentRisk.strictDecision === DECISIONS.CHALLENGE
            ? DECISIONS.CHALLENGE
            : null;

    return buildDecision({
        action,
        userId: normalizedUserId,
        mode,
        subject,
        requestMeta,
        signals,
        modules: [{
            name: 'payment_risk_engine',
            score: clampScore(paymentRisk.score),
            decision: paymentRisk.strictDecision || DECISIONS.ALLOW,
            factors: paymentRisk.factors || [],
            metadata: { mode: paymentRisk.mode },
        }, {
            name: 'payment_identity_graph',
            score: clampScore(graphSignals.reduce((sum, signal) => sum + signal.points, 0)),
            decision: graphSignals.some((signal) => signal.severity === 'high') ? DECISIONS.CHALLENGE : DECISIONS.ALLOW,
            factors: graphSignals.map((signal) => signal.code),
            metadata: {},
        }, {
            name: 'coupon_abuse',
            score: clampScore(couponSignals.reduce((sum, signal) => sum + signal.points, 0)),
            decision: couponSignals.some((signal) => signal.severity === 'high') ? DECISIONS.CHALLENGE : DECISIONS.ALLOW,
            factors: couponSignals.map((signal) => signal.code),
            metadata: { couponCode: normalizeCouponCode(metadata?.couponCode) },
        }],
        forcedDecision,
        metadata: {
            ...metadata,
            amount,
        },
        persist,
    });
};

const assessMarketplaceListing = async ({
    action,
    user,
    userId,
    sellerId,
    listingInput = {},
    requestMeta,
    mode = flags.marketplaceFraudMode,
    subject,
    metadata,
    persist,
}) => {
    const normalizedUserId = userId || user?._id || sellerId || null;
    const signals = [];
    const modules = [];
    let forcedDecision = null;
    const integrityIssue = getIntegrityIssue(listingInput);

    if (integrityIssue) {
        addSignal(signals, {
            code: 'listing_integrity_block',
            source: 'marketplace_integrity',
            points: 100,
            severity: 'critical',
            message: integrityIssue,
            evidence: { fieldSet: Object.keys(listingInput || {}) },
        });
        forcedDecision = DECISIONS.BLOCK;
    }
    modules.push({
        name: 'marketplace_integrity',
        score: integrityIssue ? 100 : 0,
        decision: integrityIssue ? DECISIONS.BLOCK : DECISIONS.ALLOW,
        factors: integrityIssue ? ['listing_integrity_block'] : [],
        metadata: { integrityIssue: integrityIssue || '' },
    });

    if (sellerId || user?._id) {
        try {
            const trustPassport = await buildSellerTrustPassport({
                sellerId: sellerId || user._id,
                sellerUser: user || null,
            });
            modules.push({
                name: 'seller_trust',
                score: clampScore(100 - trustPassport.trustScore),
                decision: trustPassport.fraudRiskTier === 'high'
                    ? DECISIONS.REVIEW
                    : trustPassport.fraudRiskTier === 'medium'
                        ? DECISIONS.REVIEW
                        : DECISIONS.ALLOW,
                factors: [`seller_risk_${trustPassport.fraudRiskTier}`],
                metadata: {
                    trustScore: trustPassport.trustScore,
                    fraudRiskTier: trustPassport.fraudRiskTier,
                    stats: trustPassport.stats,
                },
            });
            if (trustPassport.fraudRiskTier === 'high') {
                addSignal(signals, {
                    code: 'seller_high_fraud_tier',
                    source: 'seller_trust',
                    points: 45,
                    severity: 'high',
                    message: 'Seller history requires marketplace fraud review.',
                    evidence: { trustScore: trustPassport.trustScore },
                });
                forcedDecision = strongerDecision(forcedDecision || DECISIONS.ALLOW, DECISIONS.REVIEW);
            } else if (trustPassport.fraudRiskTier === 'medium') {
                addSignal(signals, {
                    code: 'seller_medium_fraud_tier',
                    source: 'seller_trust',
                    points: 20,
                    severity: 'medium',
                    message: 'Seller history has elevated dispute or escrow risk.',
                    evidence: { trustScore: trustPassport.trustScore },
                });
            }
        } catch (error) {
            logger.warn('fraud_decision.seller_trust_failed', {
                action,
                sellerId: safeString(sellerId || user?._id),
                error: error.message,
            });
            addSignal(signals, {
                code: 'seller_trust_unavailable',
                source: 'seller_trust',
                points: 8,
                severity: 'low',
                message: 'Seller trust passport was unavailable during fraud scoring.',
            });
        }
    }

    return buildDecision({
        action,
        userId: normalizedUserId,
        mode,
        subject,
        requestMeta,
        signals,
        modules,
        forcedDecision,
        metadata,
        persist,
    });
};

const assessRefundRequest = async ({
    action,
    user,
    userId,
    order = {},
    amount,
    reason,
    requestMeta,
    mode = flags.postPurchaseFraudMode,
    subject,
    metadata,
    persist,
}) => {
    const normalizedUserId = userId || user?._id || order?.user || null;
    const refundSignals = await collectRefundSignals({
        userId: normalizedUserId,
        order,
        amount,
        reason,
    });
    const hasHardHoldSignal = refundSignals.some((signal) => [
        'duplicate_open_refund_request',
        'refund_velocity_user_30d',
    ].includes(signal.code));
    const forcedDecision = hasHardHoldSignal ? DECISIONS.HOLD : null;

    return buildDecision({
        action,
        userId: normalizedUserId,
        mode,
        subject: subject || { type: 'order', id: order?._id || '' },
        requestMeta,
        signals: refundSignals,
        modules: [{
            name: 'refund_abuse',
            score: clampScore(refundSignals.reduce((sum, signal) => sum + signal.points, 0)),
            decision: hasHardHoldSignal ? DECISIONS.HOLD : DECISIONS.ALLOW,
            factors: refundSignals.map((signal) => signal.code),
            metadata: {
                amount,
                orderTotal: Number(order?.totalPrice || 0),
                refundCount: Array.isArray(order?.commandCenter?.refunds) ? order.commandCenter.refunds.length : 0,
            },
        }],
        forcedDecision,
        metadata,
        persist,
    });
};

const assessReviewSubmit = async ({
    action,
    user,
    userId,
    productId,
    reviewInput = {},
    requestMeta,
    mode = flags.reviewFraudMode,
    subject,
    metadata,
    persist,
}) => {
    const normalizedUserId = userId || user?._id || null;
    const reviewSignals = await collectReviewSignals({
        userId: normalizedUserId,
        productId,
        reviewInput,
    });
    const hasHighIntegritySignal = reviewSignals.some((signal) => signal.severity === 'high');
    const forcedDecision = hasHighIntegritySignal ? DECISIONS.REVIEW : null;

    return buildDecision({
        action,
        userId: normalizedUserId,
        mode,
        subject: subject || { type: 'product', id: productId || '' },
        requestMeta,
        signals: reviewSignals,
        modules: [{
            name: 'review_integrity',
            score: clampScore(reviewSignals.reduce((sum, signal) => sum + signal.points, 0)),
            decision: hasHighIntegritySignal ? DECISIONS.REVIEW : DECISIONS.ALLOW,
            factors: reviewSignals.map((signal) => signal.code),
            metadata: {
                rating: Number(reviewInput.rating || 0),
                hasMedia: Array.isArray(reviewInput.media) && reviewInput.media.length > 0,
            },
        }],
        forcedDecision,
        metadata,
        persist,
    });
};

const assessAuthLogin = async ({
    action,
    user,
    userId,
    deviceId,
    recentFailureCount,
    ipReputation,
    impossibleTravel,
    emailVerified,
    trustedDeviceRequired,
    requestMeta,
    mode,
    subject,
    metadata,
    persist,
}) => {
    const loginRisk = evaluateLoginRisk({
        user,
        deviceId,
        recentFailureCount,
        ipReputation,
        impossibleTravel,
        emailVerified,
        trustedDeviceRequired,
    });
    const signals = [];
    (loginRisk.signals || []).forEach((signal) => {
        addSignal(signals, {
            code: signal.reason,
            source: 'auth_risk_engine',
            points: signal.points,
            severity: loginRisk.block ? 'high' : 'medium',
            message: signal.detail,
        });
    });

    const forcedDecision = loginRisk.block
        ? DECISIONS.BLOCK
        : loginRisk.requireStepUp
            ? DECISIONS.CHALLENGE
            : null;

    return buildDecision({
        action,
        userId: userId || user?._id || null,
        mode,
        subject,
        requestMeta,
        signals,
        modules: [{
            name: 'auth_risk_engine',
            score: loginRisk.score,
            decision: forcedDecision || DECISIONS.ALLOW,
            factors: loginRisk.reasons || [],
            metadata: {
                knownDevice: loginRisk.knownDevice,
                level: loginRisk.level,
            },
        }],
        forcedDecision,
        metadata,
        persist,
    });
};

const assessFraudDecision = async (input = {}) => {
    const action = safeString(input.action, 'unknown');
    if (isPaymentAction(action)) {
        return assessPaymentIntent({ ...input, action });
    }
    if (action.startsWith('marketplace_listing')) {
        return assessMarketplaceListing({ ...input, action });
    }
    if (isRefundAction(action)) {
        return assessRefundRequest({ ...input, action });
    }
    if (isReviewAction(action)) {
        return assessReviewSubmit({ ...input, action });
    }
    if (action.startsWith('auth')) {
        return assessAuthLogin({ ...input, action });
    }
    return buildDecision({
        ...input,
        action,
        signals: [],
        modules: [{
            name: 'default_allow',
            score: 0,
            decision: DECISIONS.ALLOW,
            factors: [],
            metadata: {},
        }],
    });
};

module.exports = {
    DECISIONS,
    LEVELS,
    assessFraudDecision,
    buildDecision,
    normalizeMode,
};
