jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, _res, next) => {
        req.user = {
            _id: 'user-1',
            email: 'shopper@example.com',
        };
        req.authToken = {
            email_verified: true,
            auth_time: Math.floor(Date.now() / 1000),
        };
        return next();
    },
    invalidateUserCache: jest.fn(),
    invalidateUserCacheByEmail: jest.fn(),
}));

jest.mock('../middleware/distributedRateLimit', () => ({
    createDistributedRateLimit: jest.fn(() => (_req, _res, next) => next()),
}));

jest.mock('../models/User', () => ({
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findById: jest.fn(),
}));

jest.mock('../models/Product', () => ({
    find: jest.fn(),
    findOne: jest.fn(),
}));

jest.mock('../services/authProfileVault', () => ({
    saveAuthProfileSnapshot: jest.fn(),
}));

jest.mock('../services/loyaltyService', () => ({
    awardLoyaltyPoints: jest.fn(),
    getUserRewards: jest.fn(),
    getRewardSnapshotFromUser: jest.fn(() => ({
        pointsBalance: 0,
        lifetimeEarned: 0,
        lifetimeSpent: 0,
        tier: 'Rookie',
        nextMilestone: 500,
    })),
}));

jest.mock('../services/productImageResolver', () => ({
    buildProductImageDeliveryUrl: jest.fn((image) => image),
}));

jest.mock('../services/markets/marketPricing', () => ({
    buildDisplayPair: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const userRoutes = require('../routes/userRoutes');
const { errorHandler, notFound } = require('../middleware/errorMiddleware');
const User = require('../models/User');
const Product = require('../models/Product');

const makeLeanChain = (result) => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
});

const buildTestApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/api/users', userRoutes);
    app.use(notFound);
    app.use(errorHandler);
    return app;
};

describe('User cart concurrency protections', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = buildTestApp();
    });

    test('POST /api/users/cart/items returns a revision conflict when the compare-and-swap loses the race', async () => {
        const liveProduct = {
            id: 7,
            title: 'Aura Phone',
            price: 14999,
            originalPrice: 16999,
            discountPercentage: 12,
            image: '/phone.png',
            stock: 5,
            brand: 'Aura',
        };

        const staleUser = {
            _id: 'user-1',
            email: 'shopper@example.com',
            cart: [],
            cartRevision: 4,
            cartSyncedAt: new Date('2026-04-01T00:05:00.000Z'),
        };

        const latestUser = {
            ...staleUser,
            cart: [
                {
                    ...liveProduct,
                    quantity: 1,
                },
            ],
            cartRevision: 5,
            cartSyncedAt: new Date('2026-04-01T00:05:10.000Z'),
        };

        User.findOne.mockResolvedValue(staleUser);
        User.findOneAndUpdate.mockResolvedValue(null);
        User.findById.mockResolvedValue(latestUser);
        Product.findOne.mockImplementation(() => makeLeanChain(liveProduct));
        Product.find.mockImplementation(() => makeLeanChain([liveProduct]));

        const res = await request(app)
            .post('/api/users/cart/items')
            .send({
                productId: 7,
                quantity: 1,
                expectedRevision: 4,
            });

        expect(res.statusCode).toBe(409);
        expect(res.body).toMatchObject({
            code: 'cart_revision_conflict',
            revision: 5,
        });
        expect(res.body.items).toEqual([
            expect.objectContaining({
                id: 7,
                quantity: 1,
                price: 14999,
            }),
        ]);
        expect(User.findOneAndUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: 'user-1',
                cartRevision: 4,
            }),
            expect.objectContaining({
                $inc: { cartRevision: 1 },
            }),
            expect.objectContaining({ new: true }),
        );
    });

    test('GET /api/users/cart falls back to the latest cart snapshot when hydration loses the race', async () => {
        const liveProduct = {
            id: 7,
            title: 'Aura Phone',
            price: 15999,
            originalPrice: 17999,
            discountPercentage: 11,
            image: '/phone.png',
            stock: 4,
            brand: 'Aura',
        };

        const staleUser = {
            _id: 'user-1',
            email: 'shopper@example.com',
            cart: [
                {
                    ...liveProduct,
                    price: 14999,
                    originalPrice: 16999,
                    quantity: 1,
                },
            ],
            cartRevision: 2,
            cartSyncedAt: new Date('2026-04-01T00:02:00.000Z'),
        };

        const latestUser = {
            ...staleUser,
            cart: [
                {
                    ...liveProduct,
                    quantity: 2,
                },
            ],
            cartRevision: 3,
            cartSyncedAt: new Date('2026-04-01T00:02:08.000Z'),
        };

        User.findOne.mockResolvedValue(staleUser);
        User.findOneAndUpdate.mockResolvedValue(null);
        User.findById.mockResolvedValue(latestUser);
        Product.find.mockImplementation(() => makeLeanChain([liveProduct]));

        const res = await request(app).get('/api/users/cart');

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({
            revision: 3,
        });
        expect(res.body.items).toEqual([
            expect.objectContaining({
                id: 7,
                quantity: 2,
                price: 15999,
            }),
        ]);
        expect(User.findOneAndUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: 'user-1',
                cartRevision: 2,
            }),
            expect.objectContaining({
                $inc: { cartRevision: 1 },
            }),
            expect.objectContaining({ new: true }),
        );
    });
});
