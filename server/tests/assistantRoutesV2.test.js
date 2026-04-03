const express = require('express');
const request = require('supertest');

jest.mock('../middleware/authMiddleware', () => ({
    protectOptional: (req, res, next) => {
        if (req.headers.authorization) {
            req.user = { _id: 'user-1' };
        }
        next();
    },
}));

jest.mock('../services/assistantCommerceService', () => ({
    buildGroundedCatalogContext: jest.fn().mockResolvedValue({
        actionType: 'search',
        category: 'Mobiles',
        maxPrice: 0,
        products: [{
            id: 101,
            title: 'Phone Pro',
            brand: 'Aura',
            category: 'Mobiles',
            price: 49999,
            originalPrice: 54999,
            discountPercentage: 9,
            image: 'https://example.com/phone.png',
            rating: 4.6,
            ratingCount: 1400,
            deliveryTime: '2 days',
            stock: 7,
        }],
    }),
    compareProducts: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/catalogService', () => ({
    getProductByIdentifier: jest.fn().mockResolvedValue({
        id: 101,
        title: 'Phone Pro',
        brand: 'Aura',
        category: 'Mobiles',
        price: 49999,
        originalPrice: 54999,
        discountPercentage: 9,
        image: 'https://example.com/phone.png',
        rating: 4.6,
        ratingCount: 1400,
        deliveryTime: '2 days',
        stock: 7,
    }),
}));

const { flags: assistantFlags } = require('../config/assistantFlags');
const assistantRoutes = require('../routes/assistantRoutes');

describe('assistantRoutes v2', () => {
    const app = express();
    app.use(express.json());
    app.use('/api/assistant', assistantRoutes);
    app.use((err, req, res, next) => {
        res.status(err.statusCode || err.status || 500).json({
            message: err.message,
        });
    });

    beforeEach(() => {
        assistantFlags.assistantV2Enabled = true;
    });

    test('returns grounded commerce results for guests', async () => {
        const res = await request(app)
            .post('/api/assistant/turns')
            .send({
                message: 'best phones under 50000',
                routeContext: {
                    path: '/',
                },
                commerceContext: {
                    candidateProductIds: [],
                    cartSummary: {
                        totalItems: 0,
                        itemCount: 0,
                        totalPrice: 0,
                        currency: 'INR',
                    },
                },
                userContext: {
                    authenticated: false,
                },
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.reply.intent).toBe('product_search');
        expect(res.body.cards[0].type).toBe('product');
        expect(res.body.actions[0].type).toBe('open_product');
    });

    test('supports authenticated cart checkout prompts', async () => {
        const res = await request(app)
            .post('/api/assistant/turns')
            .set('Authorization', 'Bearer fake')
            .send({
                message: 'checkout',
                routeContext: {
                    path: '/cart',
                },
                commerceContext: {
                    cartSummary: {
                        totalItems: 2,
                        itemCount: 1,
                        totalPrice: 1999,
                        totalOriginalPrice: 2399,
                        totalDiscount: 400,
                        currency: 'INR',
                    },
                },
                userContext: {
                    authenticated: true,
                },
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.reply.intent).toBe('checkout');
        expect(res.body.cards[0].type).toBe('cart_summary');
        expect(res.body.actions[0].type).toBe('open_checkout');
    });

    test('respects the feature flag when disabled', async () => {
        assistantFlags.assistantV2Enabled = false;

        const res = await request(app)
            .post('/api/assistant/turns')
            .send({
                message: 'best phones',
                routeContext: {
                    path: '/',
                },
            });

        expect(res.statusCode).toBe(404);
        expect(res.body.message).toMatch(/disabled/i);
    });
});
