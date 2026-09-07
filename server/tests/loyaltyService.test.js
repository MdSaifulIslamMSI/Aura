jest.mock('../models/User', () => ({
  findById: jest.fn(),
  updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1, acknowledged: true }),
}));

const User = require('../models/User');
const {
  awardLoyaltyPoints,
  getRewardSnapshotFromUser,
  getUserRewards,
} = require('../services/loyaltyService');

const chainSession = (resolved) => ({ session: jest.fn().mockResolvedValue(resolved) });
const chainLean = (resolved) => ({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(resolved) }) });

describe('loyaltyService.getRewardSnapshotFromUser', () => {
  test('defaults missing ledgers to rookie zeros', () => {
    expect(getRewardSnapshotFromUser({})).toMatchObject({
      pointsBalance: 0, lifetimeEarned: 0, tier: 'Rookie', nextMilestone: 500,
    });
    expect(getRewardSnapshotFromUser(null)).toMatchObject({ tier: 'Rookie' });
  });

  test('passes through stored tiers and sanitizes numbers', () => {
    const snapshot = getRewardSnapshotFromUser({
      loyalty: { pointsBalance: '250', lifetimeEarned: 600, tier: 'Pro', nextMilestone: 2000 },
    });
    expect(snapshot).toMatchObject({ pointsBalance: 250, lifetimeEarned: 600, tier: 'Pro', nextMilestone: 2000 });
  });

  test('sanitizes non-numeric balances to zero', () => {
    expect(getRewardSnapshotFromUser({ loyalty: { pointsBalance: 'NaN-ish' } }).pointsBalance).toBe(0);
  });
});

describe('loyaltyService.awardLoyaltyPoints', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects unknown actions and missing users', async () => {
    await expect(awardLoyaltyPoints({ userId: 'u-1', action: 'hacking' })).resolves.toEqual({ awarded: false, points: 0 });
    User.findById.mockReturnValue(chainSession(null));
    await expect(awardLoyaltyPoints({ userId: 'ghost', action: 'daily_login' })).resolves.toEqual({ awarded: false, points: 0 });
  });

  test('awards daily login base points', async () => {
    const save = jest.fn().mockResolvedValue({});
    User.findById.mockReturnValue(chainSession({ loyalty: {}, save }));
    const result = await awardLoyaltyPoints({ userId: 'u-1', action: 'daily_login' });
    expect(result.awarded).toBe(true);
    expect(result.points).toBeGreaterThanOrEqual(20);
  });

  test('caps order rewards at the rule maximum', async () => {
    const save = jest.fn().mockResolvedValue({});
    User.findById.mockReturnValue(chainSession({ loyalty: {}, save }));
    const huge = await awardLoyaltyPoints({ userId: 'u-1', action: 'order_placed', orderTotal: 10000000 });
    expect(huge.awarded).toBe(true);
    expect(huge.points).toBeLessThanOrEqual(1200);
  });
});

describe('loyaltyService.getUserRewards', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns snapshots with bounded activity windows', async () => {
    const ledger = Array.from({ length: 150 }, (_, i) => ({ id: i }));
    User.findById.mockReturnValue(chainLean({ loyalty: { pointsBalance: 100, ledger } }));
    const rewards = await getUserRewards({ userId: 'u-1', limit: 200 });
    expect(rewards.pointsBalance).toBe(100);
    expect(rewards.recentActivity).toHaveLength(100);
  });

  test('handles users without ledgers', async () => {
    User.findById.mockReturnValue(chainLean(null));
    const rewards = await getUserRewards({ userId: 'ghost' });
    expect(rewards).toMatchObject({ pointsBalance: 0, tier: 'Rookie' });
    expect(rewards.recentActivity).toEqual([]);
  });
});
