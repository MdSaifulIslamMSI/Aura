const User = require('../models/User');
const { awardLoyaltyPoints, getUserRewards } = require('../services/loyaltyService');

describe('loyaltyService integration', () => {
  let user;

  beforeEach(async () => {
    user = await User.create({ name: 'Loyal', email: `loyal-${Date.now()}@example.com` });
  });

  test('awards and persists daily login streaks', async () => {
    const first = await awardLoyaltyPoints({ userId: user._id, action: 'daily_login' });
    expect(first.awarded).toBe(true);
    expect(first.points).toBeGreaterThanOrEqual(20);

    const reloaded = await User.findById(user._id).lean();
    expect(reloaded.loyalty.lifetimeEarned).toBeGreaterThan(0);

    const rewards = await getUserRewards({ userId: user._id });
    expect(rewards.pointsBalance).toBe(first.points);
  });

  test('blocks double daily awards on the same day', async () => {
    await awardLoyaltyPoints({ userId: user._id, action: 'daily_login' });
    const second = await awardLoyaltyPoints({ userId: user._id, action: 'daily_login' });
    expect(second.awarded).toBe(false);
  });

  test('accumulates order rewards with ledger entries', async () => {
    await awardLoyaltyPoints({ userId: user._id, action: 'order_placed', orderTotal: 5000, refId: 'o-1' });
    const rewards = await getUserRewards({ userId: user._id, limit: 5 });
    expect(rewards.lifetimeEarned).toBeGreaterThan(0);
    expect(rewards.recentActivity.length).toBeGreaterThan(0);
  });
});
