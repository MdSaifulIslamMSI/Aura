const mongoose = require('mongoose');
const FraudDecision = require('../models/FraudDecision');
const ProductReview = require('../models/ProductReview');
const { listAdminFraudDecisions, resolveAdminFraudDecision } = require('../controllers/fraudDecisionController');

const createRes = () => {
    const res = {
        statusCode: 200,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
    return res;
};

const invoke = async (handler, req) => {
    const res = createRes();
    const next = jest.fn();
    await handler(req, res, next);
    return { res, next };
};

let decisionSeq = 0;
const makeDecision = (overrides = {}) => FraudDecision.create({
    decisionId: 'fd_test_' + Date.now() + '_' + (decisionSeq += 1),
    action: 'order_refund_request',
    strictDecision: 'review',
    decision: 'review',
    review: { status: 'open', queue: 'payments' },
    ...overrides,
});

beforeEach(async () => {
    await Promise.all([
        FraudDecision.deleteMany({}),
        ProductReview.deleteMany({}),
    ]);
});

describe('fraudDecisionController.listAdminFraudDecisions', () => {
    test('returns only open decisions by default and serializes signal codes', async () => {
        await makeDecision({
            signals: [{ code: 'velocity_high', points: 30 }, { code: 'geo_mismatch', points: 15 }],
        });
        await makeDecision({ review: { status: 'open', queue: 'payments' } });
        await makeDecision({ review: { status: 'resolved', queue: 'payments' } });

        const { res } = await invoke(listAdminFraudDecisions, { query: {} });

        expect(res.body.total).toBe(2);
        expect(res.body.page).toBe(1);
        expect(res.body.limit).toBe(25);
        expect(res.body.items).toHaveLength(2);
        expect(res.body.items[0]).toMatchObject({
            action: 'order_refund_request',
            strictDecision: 'review',
        });
        const withSignals = res.body.items.find((item) => item.factors.length > 0);
        expect(withSignals.factors).toEqual(expect.arrayContaining(['velocity_high', 'geo_mismatch']));
        expect(res.body.items.every((item) => item.review.status === 'open')).toBe(true);
    });

    test('supports status=all, queue, decision, and subject filters', async () => {
        await makeDecision({ review: { status: 'open', queue: 'payments' } });
        await makeDecision({
            action: 'product_review_submit',
            strictDecision: 'block',
            review: { status: 'resolved', queue: 'reviews' },
            subject: { subjectType: 'product_review', subjectId: 'pr-1' },
        });

        const all = await invoke(listAdminFraudDecisions, { query: { status: 'all' } });
        expect(all.res.body.total).toBe(2);

        const byQueue = await invoke(listAdminFraudDecisions, { query: { status: 'all', queue: 'reviews' } });
        expect(byQueue.res.body.total).toBe(1);
        expect(byQueue.res.body.items[0].action).toBe('product_review_submit');

        const byDecision = await invoke(listAdminFraudDecisions, { query: { status: 'all', decision: 'block' } });
        expect(byDecision.res.body.total).toBe(1);

        const bySubject = await invoke(listAdminFraudDecisions, { query: { status: 'all', subjectType: 'product_review' } });
        expect(bySubject.res.body.total).toBe(1);
    });
    test('paginates with page and limit', async () => {
        for (let i = 0; i < 3; i += 1) {
            await makeDecision({ score: i });
        }

        const page2 = await invoke(listAdminFraudDecisions, { query: { page: '2', limit: '1' } });
        expect(page2.res.body.total).toBe(3);
        expect(page2.res.body.items).toHaveLength(1);
        expect(page2.res.body.page).toBe(2);
    });

    test('filters by createdAt range', async () => {
        await makeDecision({});
        await makeDecision({});

        const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const noneFrom = await invoke(listAdminFraudDecisions, { query: { from: future } });
        expect(noneFrom.res.body.total).toBe(0);

        const noneRange = await invoke(listAdminFraudDecisions, {
            query: { from: future, to: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() },
        });
        expect(noneRange.res.body.total).toBe(0);

        const all = await invoke(listAdminFraudDecisions, { query: { to: future } });
        expect(all.res.body.total).toBe(2);
    });

    test('ignores invalid date filters instead of throwing', async () => {
        await makeDecision({});
        const res = await invoke(listAdminFraudDecisions, { query: { from: 'not-a-date' } });
        expect(res.res.body.total).toBe(1);
    });
});

describe('fraudDecisionController.resolveAdminFraudDecision', () => {
    test('returns 404 through next for an unknown decision id', async () => {
        const { next } = await invoke(resolveAdminFraudDecision, {
            params: { decisionId: new mongoose.Types.ObjectId().toString() },
            body: { resolution: 'approve' },
        });

        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0].statusCode).toBe(404);
    });

    test('records the review resolution and reviewer on the decision', async () => {
        const reviewerId = new mongoose.Types.ObjectId();
        const decision = await makeDecision({});

        const { res } = await invoke(resolveAdminFraudDecision, {
            params: { decisionId: decision._id.toString() },
            body: { resolution: 'approve', note: 'looks legitimate' },
            user: { _id: reviewerId },
        });

        expect(res.body.message).toBe('Fraud decision resolved');
        expect(res.body.item.review).toMatchObject({
            status: 'approved',
            resolution: 'approve',
            note: 'looks legitimate',
        });
        expect(String(res.body.item.review.reviewedBy)).toBe(reviewerId.toString());
    });

    test('maps unknown resolutions to the generic resolved status', async () => {
        const decision = await makeDecision({});
        const { res } = await invoke(resolveAdminFraudDecision, {
            params: { decisionId: decision._id.toString() },
            body: { resolution: 'vibes' },
            user: { _id: new mongoose.Types.ObjectId() },
        });
        expect(res.body.item.review.status).toBe('resolved');
    });

    test('applies the product review domain resolution on approve', async () => {
        const decision = await makeDecision({ action: 'product_review_submit', decisionId: 'fd_domain_1' });
        const review = await ProductReview.create({
            product: new mongoose.Types.ObjectId(),
            user: new mongoose.Types.ObjectId(),
            rating: 1,
            comment: 'spam review',
            status: 'hidden',
            riskSnapshot: { decisionId: 'fd_domain_1' },
        });

        const { res } = await invoke(resolveAdminFraudDecision, {
            params: { decisionId: decision._id.toString() },
            body: { resolution: 'approve' },
            user: { _id: new mongoose.Types.ObjectId() },
        });

        expect(res.body.domainResolution).toMatchObject({
            type: 'product_review',
            status: 'published',
            matched: 1,
            modified: 1,
        });
        const refreshed = await ProductReview.findById(review._id).lean();
        expect(refreshed.status).toBe('published');
    });

    test('reports a none domain resolution for non-domain actions', async () => {
        const decision = await makeDecision({ action: 'account_takeover_probe' });
        const { res } = await invoke(resolveAdminFraudDecision, {
            params: { decisionId: decision._id.toString() },
            body: { resolution: 'reject' },
            user: { _id: new mongoose.Types.ObjectId() },
        });
        expect(res.body.domainResolution).toMatchObject({ type: 'none', matched: 0 });
    });
});