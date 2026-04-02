jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, _res, next) => {
        req.user = {
            _id: 'user-1',
            email: 'shopper@example.com',
        };
        return next();
    },
}));

jest.mock('../models/Cart', () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
}));

jest.mock('../models/Product', () => ({
    find: jest.fn(),
}));

jest.mock('../services/productImageResolver', () => ({
    buildProductImageDeliveryUrl: jest.fn((image) => image),
}));

jest.mock('../services/markets/marketPricing', () => ({
    buildDisplayPair: jest.fn(async ({ amount = 0, originalAmount = 0 }) => ({
        baseAmount: Number(amount || 0),
        baseCurrency: 'INR',
        displayAmount: Number(amount || 0),
        displayCurrency: 'INR',
        originalDisplayAmount: Number(originalAmount || amount || 0),
        originalBaseAmount: Number(originalAmount || amount || 0),
    })),
}));

const express = require('express');
const request = require('supertest');
const cartRoutes = require('../routes/cartRoutes');
const { errorHandler, notFound } = require('../middleware/errorMiddleware');
const Cart = require('../models/Cart');
const Product = require('../models/Product');

const makeLeanChain = (result) => ({
    lean: jest.fn().mockResolvedValue(result),
});

const makeSelectLeanChain = (result) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
});

const buildTestApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/cart', cartRoutes);
    app.use(notFound);
    app.use(errorHandler);
    return app;
};

describe('Canonical cart routes', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = buildTestApp();
    });

    test('GET /api/cart returns the canonical cart snapshot', async () => {
        Cart.findOne.mockImplementation(() => makeLeanChain({
            _id: 'cart-1',
            user: 'user-1',
            version: 3,
            items: [{ productId: 7, quantity: 2 }],
            recentMutations: [],
            updatedAtIso: '2026-04-02T00:00:00.000Z',
        }));
        Product.find.mockImplementation(() => makeSelectLeanChain([{
            id: 7,
            title: 'Aura Phone',
            price: 15999,
            originalPrice: 17999,
            discountPercentage: 11,
            image: '/phone.png',
            stock: 4,
            brand: 'Aura',
        }]));

        const res = await request(app).get('/api/cart');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            version: 3,
            updatedAt: '2026-04-02T00:00:00.000Z',
            summary: expect.objectContaining({
                totalQuantity: 2,
                distinctItemCount: 1,
            }),
        });
        expect(res.body.items).toEqual([
            expect.objectContaining({
                productId: 7,
                quantity: 2,
                title: 'Aura Phone',
            }),
        ]);
    });

    test('POST /api/cart/commands returns a canonical conflict snapshot when compare-and-swap loses the race', async () => {
        Cart.findOne.mockImplementation(() => makeLeanChain({
            _id: 'cart-1',
            user: 'user-1',
            version: 4,
            items: [],
            recentMutations: [],
            updatedAtIso: '2026-04-02T00:01:00.000Z',
        }));
        Cart.findOneAndUpdate.mockResolvedValue(null);
        Cart.findById.mockImplementation(() => makeLeanChain({
            _id: 'cart-1',
            user: 'user-1',
            version: 5,
            items: [{ productId: 7, quantity: 1 }],
            recentMutations: [],
            updatedAtIso: '2026-04-02T00:01:10.000Z',
        }));
        Product.find.mockImplementation(() => makeSelectLeanChain([{
            id: 7,
            title: 'Aura Phone',
            price: 15999,
            originalPrice: 17999,
            discountPercentage: 11,
            image: '/phone.png',
            stock: 4,
            brand: 'Aura',
        }]));

        const res = await request(app)
            .post('/api/cart/commands')
            .send({
                expectedVersion: 4,
                clientMutationId: 'cart-mutation-1',
                commands: [{
                    type: 'add_item',
                    productId: 7,
                    quantity: 1,
                }],
            });

        expect(res.statusCode).toBe(409);
        expect(res.body).toMatchObject({
            code: 'cart_version_conflict',
            cart: {
                version: 5,
                updatedAt: '2026-04-02T00:01:10.000Z',
            },
        });
        expect(res.body.cart.items).toEqual([
            expect.objectContaining({
                productId: 7,
                quantity: 1,
            }),
        ]);
    });
});
