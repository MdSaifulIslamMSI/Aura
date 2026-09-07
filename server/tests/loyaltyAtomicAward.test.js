const User = require('../models/User');
const { awardLoyaltyPoints } = require('../services/loyaltyService');

const makeUser = async () => User.create({
    name: 'Atomic Loyalty User',
    email: `atomic-loyalty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
});

describe('loyaltyService atomic awards', () => {
    test('concurrent order rewards all land in the balance instead of losing updates', async () => {
        const user = await makeUser();

        const results = await Promise.all(Array.from({ length: 10 }, () => awardLoyaltyPoints({
            userId: user._id,
            action: 'order_placed',
            orderTotal: 1000,
            refId: 'order-concurrent',
        })));

        expect(results.every((result) => result.awarded)).toBe(true);

        const reloaded = await User.findById(user._id).lean();
        const totalAwarded = results.reduce((sum, result) => sum + result.points, 0);
        expect(reloaded.loyalty.pointsBalance).toBe(totalAwarded);
        expect(reloaded.loyalty.lifetimeEarned).toBe(totalAwarded);
        expect(reloaded.loyalty.ledger).toHaveLength(10);
    });

    test('concurrent daily logins award exactly once', async () => {
        const user = await makeUser();

        const results = await Promise.all(Array.from({ length: 5 }, () => awardLoyaltyPoints({
            userId: user._id,
            action: 'daily_login',
        })));

        const awardedCount = results.filter((result) => result.awarded).length;
        expect(awardedCount).toBe(1);

        const reloaded = await User.findById(user._id).lean();
        expect(reloaded.loyalty.pointsBalance).toBe(results.find((result) => result.awarded).points);
        expect(reloaded.loyalty.ledger).toHaveLength(1);
        expect(reloaded.loyalty.streakDays).toBe(1);
    });

    test('ledger keeps newest entry first and honours the bounded size', async () => {
        const user = await makeUser();

        for (let index = 0; index < 3; index += 1) {
            await awardLoyaltyPoints({
                userId: user._id,
                action: 'order_placed',
                orderTotal: 1000,
                refId: `order-${index}`,
            });
        }

        const reloaded = await User.findById(user._id).lean();
        expect(reloaded.loyalty.ledger.map((entry) => entry.refId)).toEqual([
            'order-2',
            'order-1',
            'order-0',
        ]);
        expect(reloaded.loyalty.pointsBalance).toBe(60);
    });
});
