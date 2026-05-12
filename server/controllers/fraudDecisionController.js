const asyncHandler = require('express-async-handler');
const FraudDecision = require('../models/FraudDecision');
const Order = require('../models/Order');
const ProductReview = require('../models/ProductReview');
const AppError = require('../utils/AppError');

const normalizeDateFilter = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
};

const buildFraudDecisionFilter = (query = {}) => {
    const filter = {};
    const status = String(query.status || 'open').trim();

    if (status && status !== 'all') {
        filter['review.status'] = status;
    }
    if (query.queue) filter['review.queue'] = query.queue;
    if (query.decision) filter.strictDecision = query.decision;
    if (query.action) filter.action = query.action;
    if (query.userId) filter.user = query.userId;
    if (query.subjectType) filter['subject.subjectType'] = query.subjectType;
    if (query.subjectId) filter['subject.subjectId'] = query.subjectId;

    const from = normalizeDateFilter(query.from);
    const to = normalizeDateFilter(query.to);
    if (from || to) {
        filter.createdAt = {};
        if (from) filter.createdAt.$gte = from;
        if (to) filter.createdAt.$lte = to;
    }

    return filter;
};

const mapReviewResolution = (resolution) => {
    switch (resolution) {
        case 'approve':
            return 'approved';
        case 'reject':
            return 'rejected';
        case 'escalate':
            return 'escalated';
        default:
            return 'resolved';
    }
};

const resultCounts = (result = {}) => ({
    matched: result.matchedCount ?? result.n ?? 0,
    modified: result.modifiedCount ?? result.nModified ?? 0,
});

const applyDomainResolution = async ({ decision, resolution, note, now }) => {
    const decisionId = String(decision?.decisionId || '').trim();
    if (!decisionId) return { type: 'none', matched: 0, modified: 0 };

    if (decision.action === 'product_review_submit') {
        const status = resolution === 'approve' ? 'published' : 'hidden';
        const result = await ProductReview.updateOne(
            { 'riskSnapshot.decisionId': decisionId },
            { $set: { status, updatedAt: now } }
        );
        return { type: 'product_review', status, ...resultCounts(result) };
    }

    if (decision.action === 'order_refund_request' && ['approve', 'reject'].includes(resolution)) {
        const status = resolution === 'approve' ? 'approved' : 'rejected';
        const result = await Order.updateOne(
            { 'commandCenter.refunds.fraudDecisionId': decisionId },
            {
                $set: {
                    'commandCenter.refunds.$.status': status,
                    'commandCenter.refunds.$.message': resolution === 'approve'
                        ? 'Refund approved after fraud review'
                        : 'Refund rejected after fraud review',
                    'commandCenter.refunds.$.adminNote': note || '',
                    'commandCenter.refunds.$.updatedAt': now,
                    'commandCenter.lastUpdatedAt': now,
                },
            }
        );
        return { type: 'order_refund', status, ...resultCounts(result) };
    }

    return { type: 'none', matched: 0, modified: 0 };
};

const serializeDecision = (decision = {}) => ({
    id: String(decision._id || ''),
    decisionId: decision.decisionId,
    action: decision.action,
    mode: decision.mode,
    score: decision.score,
    level: decision.level,
    strictDecision: decision.strictDecision,
    decision: decision.decision,
    user: decision.user || null,
    subject: decision.subject || {},
    factors: Array.isArray(decision.signals) ? decision.signals.map((signal) => signal.code).filter(Boolean) : [],
    signals: decision.signals || [],
    modules: decision.modules || [],
    outcome: decision.outcome || {},
    review: decision.review || {},
    createdAt: decision.createdAt,
    updatedAt: decision.updatedAt,
});

const listAdminFraudDecisions = asyncHandler(async (req, res) => {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 25);
    const skip = (page - 1) * limit;
    const filter = buildFraudDecisionFilter(req.query);

    const [items, total] = await Promise.all([
        FraudDecision.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        FraudDecision.countDocuments(filter),
    ]);

    res.json({
        page,
        limit,
        total,
        items: items.map(serializeDecision),
    });
});

const resolveAdminFraudDecision = asyncHandler(async (req, res, next) => {
    const decision = await FraudDecision.findById(req.params.decisionId);
    if (!decision) {
        return next(new AppError('Fraud decision not found', 404));
    }

    const resolution = String(req.body.resolution || '').trim();
    const status = mapReviewResolution(resolution);
    const note = String(req.body.note || '').trim();
    const now = new Date();
    const domainResolution = await applyDomainResolution({ decision, resolution, note, now });

    decision.review = {
        ...(decision.review || {}),
        status,
        assignedTo: req.body.assignedTo || decision.review?.assignedTo || null,
        reviewedBy: req.user?._id || null,
        reviewedAt: now,
        resolution,
        note,
    };
    decision.metadata = {
        ...(decision.metadata || {}),
        domainResolution,
    };

    await decision.save();

    res.json({
        message: 'Fraud decision resolved',
        item: serializeDecision(decision.toObject()),
        domainResolution,
    });
});

module.exports = {
    listAdminFraudDecisions,
    resolveAdminFraudDecision,
};
