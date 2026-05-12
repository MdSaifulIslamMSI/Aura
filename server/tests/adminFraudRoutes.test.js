jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = {
            _id: '69aa0000000000000000admin',
            email: 'admin@example.com',
            isAdmin: true,
        };
        return next();
    },
    admin: (req, res, next) => next(),
}));

jest.mock('../models/FraudDecision', () => ({
    find: jest.fn(),
    countDocuments: jest.fn(),
    findById: jest.fn(),
}));

jest.mock('../models/Order', () => ({
    updateOne: jest.fn(),
}));

jest.mock('../models/ProductReview', () => ({
    updateOne: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const adminFraudRoutes = require('../routes/adminFraudRoutes');
const { errorHandler, notFound } = require('../middleware/errorMiddleware');
const FraudDecision = require('../models/FraudDecision');
const Order = require('../models/Order');
const ProductReview = require('../models/ProductReview');

const makeFindChain = (items) => ({
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(items),
});

const makeDecisionDoc = (overrides = {}) => ({
    _id: '69dd00000000000000000001',
    decisionId: 'frd_review_1',
    action: 'product_review_submit',
    mode: 'enforce',
    score: 55,
    level: 'medium',
    strictDecision: 'review',
    decision: 'review',
    user: '69dd0000000000000000user1',
    subject: { subjectType: 'product', subjectId: '69dd0000000000000000prod1' },
    signals: [{ code: 'review_duplicate_text', points: 35 }],
    modules: [],
    outcome: { reviewRequired: true },
    review: { status: 'open', queue: 'review_integrity' },
    metadata: {},
    createdAt: new Date('2026-05-12T09:00:00.000Z'),
    updatedAt: new Date('2026-05-12T09:00:00.000Z'),
    save: jest.fn().mockResolvedValue(undefined),
    toObject() {
        return {
            ...this,
            save: undefined,
            toObject: undefined,
        };
    },
    ...overrides,
});

const buildTestApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/admin/fraud', adminFraudRoutes);
    app.use(notFound);
    app.use(errorHandler);
    return app;
};

describe('Admin fraud routes', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = buildTestApp();
    });

    test('GET /api/admin/fraud returns open review queue decisions by default', async () => {
        const decision = makeDecisionDoc();
        FraudDecision.find.mockReturnValue(makeFindChain([decision]));
        FraudDecision.countDocuments.mockResolvedValue(1);

        const res = await request(app).get('/api/admin/fraud?limit=10');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            page: 1,
            limit: 10,
            total: 1,
        });
        expect(res.body.items[0]).toMatchObject({
            decisionId: 'frd_review_1',
            review: { status: 'open', queue: 'review_integrity' },
        });
        expect(FraudDecision.find).toHaveBeenCalledWith({ 'review.status': 'open' });
    });

    test('PATCH /api/admin/fraud/:decisionId/resolve publishes approved product review', async () => {
        const decision = makeDecisionDoc();
        FraudDecision.findById.mockResolvedValue(decision);
        ProductReview.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

        const res = await request(app)
            .patch('/api/admin/fraud/69dd00000000000000000001/resolve')
            .send({ resolution: 'approve', note: 'Legitimate verified review' });

        expect(res.statusCode).toBe(200);
        expect(ProductReview.updateOne).toHaveBeenCalledWith(
            { 'riskSnapshot.decisionId': 'frd_review_1' },
            { $set: expect.objectContaining({ status: 'published' }) }
        );
        expect(decision.review.status).toBe('approved');
        expect(decision.save).toHaveBeenCalled();
        expect(res.body.domainResolution).toMatchObject({
            type: 'product_review',
            status: 'published',
            matched: 1,
            modified: 1,
        });
    });

    test('PATCH /api/admin/fraud/:decisionId/resolve approves refund hold into admin ledger', async () => {
        const decision = makeDecisionDoc({
            decisionId: 'frd_refund_1',
            action: 'order_refund_request',
            review: { status: 'open', queue: 'refund_abuse' },
        });
        FraudDecision.findById.mockResolvedValue(decision);
        Order.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

        const res = await request(app)
            .patch('/api/admin/fraud/69dd00000000000000000001/resolve')
            .send({ resolution: 'approve', note: 'Customer supplied proof' });

        expect(res.statusCode).toBe(200);
        expect(Order.updateOne).toHaveBeenCalledWith(
            { 'commandCenter.refunds.fraudDecisionId': 'frd_refund_1' },
            { $set: expect.objectContaining({
                'commandCenter.refunds.$.status': 'approved',
                'commandCenter.refunds.$.adminNote': 'Customer supplied proof',
            }) }
        );
        expect(decision.review.status).toBe('approved');
        expect(res.body.domainResolution).toMatchObject({
            type: 'order_refund',
            status: 'approved',
        });
    });
});
