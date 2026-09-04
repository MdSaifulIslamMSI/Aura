jest.mock('mongoose', () => ({
    connect: jest.fn(),
}));
jest.mock('../models/Order', () => ({
    aggregate: jest.fn(),
}));
jest.mock('../models/User', () => ({
    bulkWrite: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
}));

const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const { run } = require('../scripts/backfill-lifetime-spent');

describe('backfill-lifetime-spent', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...OLD_ENV, MONGO_URI: 'mongodb://localhost:27017/backfill-test' };
    });

    afterEach(() => {
        process.env = OLD_ENV;
    });

    test('sets absolute lifetime spend per user from the order aggregate', async () => {
        Order.aggregate.mockResolvedValue([
            { _id: 'user_a', total: 2500 },
            { _id: 'user_b', total: 750 },
        ]);
        User.bulkWrite.mockResolvedValue({ matchedCount: 2, modifiedCount: 2 });

        await run();

        expect(mongoose.connect).toHaveBeenCalledWith('mongodb://localhost:27017/backfill-test');
        expect(Order.aggregate).toHaveBeenCalledWith([
            { $group: { _id: '$user', total: { $sum: '$totalPrice' } } },
        ]);
        expect(User.bulkWrite).toHaveBeenCalledWith(
            [
                {
                    updateOne: {
                        filter: { _id: 'user_a' },
                        update: { $set: { lifetimeSpent: 2500 } },
                    },
                },
                {
                    updateOne: {
                        filter: { _id: 'user_b' },
                        update: { $set: { lifetimeSpent: 750 } },
                    },
                },
            ],
            { ordered: false }
        );
    });

    test('skips entries without a user or a finite total', async () => {
        Order.aggregate.mockResolvedValue([
            { _id: null, total: 100 },
            { _id: 'user_c', total: Number.NaN },
            { _id: 'user_d', total: 300 },
        ]);
        User.bulkWrite.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

        await run();

        expect(User.bulkWrite).toHaveBeenCalledTimes(1);
        expect(User.bulkWrite).toHaveBeenCalledWith(
            [
                {
                    updateOne: {
                        filter: { _id: 'user_d' },
                        update: { $set: { lifetimeSpent: 300 } },
                    },
                },
            ],
            { ordered: false }
        );
    });

    test('requires MONGO_URI', async () => {
        delete process.env.MONGO_URI;

        await expect(run()).rejects.toThrow('MONGO_URI is required');
    });
});
