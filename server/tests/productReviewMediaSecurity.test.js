jest.mock('../services/catalogService', () => ({
    queryProducts: jest.fn(),
    getProductByIdentifier: jest.fn(),
    createManualProduct: jest.fn(),
    updateManualProduct: jest.fn(),
    deleteManualProduct: jest.fn(),
}));

jest.mock('../services/fraudDecisioningService', () => ({
    assessFraudDecision: jest.fn(),
}));

const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const ProductReview = require('../models/ProductReview');
const { createProductReview } = require('../controllers/productController');
const { getProductByIdentifier } = require('../services/catalogService');
const { assessFraudDecision } = require('../services/fraudDecisioningService');

const makeProduct = () => Product.create({
    title: `Review Media Product ${Date.now()} ${Math.random().toString(36).slice(2)}`,
    brand: 'Aura',
    category: 'Security',
    price: 1999,
    image: `https://example.com/product-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
    description: 'A product fixture for review media security tests.',
    stock: 5,
});

const makeDeliveredOrder = ({ userId, productId }) => Order.create({
    user: userId,
    orderItems: [{
        title: 'Review Media Product',
        quantity: 1,
        image: 'https://example.com/product.jpg',
        price: 1999,
        product: productId,
    }],
    shippingAddress: {
        address: '221B Baker Street',
        city: 'London',
        postalCode: '10001',
        country: 'India',
    },
    paymentMethod: 'CARD',
    itemsPrice: 1999,
    taxPrice: 0,
    shippingPrice: 0,
    totalPrice: 1999,
    isPaid: true,
    paidAt: new Date(),
    isDelivered: true,
    deliveredAt: new Date(),
    paymentState: 'captured',
});

const buildReq = ({ userId, productId, media }) => ({
    user: {
        _id: userId,
        email: 'reviewer@example.com',
        isAdmin: false,
    },
    params: { id: String(productId) },
    body: {
        rating: 5,
        comment: 'This product is good enough for a verified review.',
        media,
    },
    headers: {},
    ip: '127.0.0.1',
});

const buildRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
});

describe('product review media security', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        assessFraudDecision.mockResolvedValue({
            blocked: false,
            reviewRequired: false,
            holdRequired: false,
            auditId: 'fraud-decision-review-media',
            decisionId: 'fraud-decision-review-media',
            strictDecision: 'allow',
            score: 0,
            factors: [],
            mode: 'monitor',
        });
    });

    test('fabricated review upload URL is rejected without creating a review row', async () => {
        const userId = new mongoose.Types.ObjectId();
        const product = await makeProduct();
        await makeDeliveredOrder({ userId, productId: product._id });
        getProductByIdentifier.mockResolvedValue(product);
        const res = buildRes();
        const next = jest.fn();

        await createProductReview(buildReq({
            userId,
            productId: product._id,
            media: [{
                type: 'image',
                url: '/uploads/reviews/rejected-or-never-promoted.png',
                caption: 'proof',
            }],
        }), res, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 400,
            message: expect.stringMatching(/review media/i),
        }));
        await expect(ProductReview.countDocuments()).resolves.toBe(0);
        expect(res.status).not.toHaveBeenCalledWith(201);
        expect(res.json).not.toHaveBeenCalled();
    });
});
