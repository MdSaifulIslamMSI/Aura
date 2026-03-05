const User = require('../models/User');

const IST_OFFSET_MINUTES = 330;
const MAX_LEDGER_ITEMS = 200;

const REWARD_RULES = {
    daily_login: {
        basePoints: 20,
        refType: 'system',
        reason: 'Daily secure login reward',
    },
    order_placed: {
        basePoints: 15,
        perHundredPoints: 2,
        maxPoints: 1200,
        refType: 'order',
        reason: 'Order placement reward',
    },
    listing_created: {
        basePoints: 40,
        refType: 'listing',
        reason: 'Marketplace listing reward',
    },
};

const TIERS = [
    { name: 'Rookie', minLifetime: 0, nextMilestone: 500 },
    { name: 'Pro', minLifetime: 500, nextMilestone: 2000 },
    { name: 'Elite', minLifetime: 2000, nextMilestone: 5000 },
    { name: 'Legend', minLifetime: 5000, nextMilestone: 12000 },
    { name: 'Mythic', minLifetime: 12000, nextMilestone: null },
];

const sanitizeNumber = (value, fallback = 0) => {
    const normalized = Number(value);
    return Number.isFinite(normalized) ? normalized : fallback;
};

const toIstDayKey = (dateValue) => {
    const date = new Date(dateValue);
    if (!Number.isFinite(date.getTime())) return '';
    const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
    const yyyy = shifted.getUTCFullYear();
    const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(shifted.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

const getDayDiff = (fromDate, toDate) => {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return Number.POSITIVE_INFINITY;
    const fromUtcMidnight = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    const toUtcMidnight = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
    return Math.round((toUtcMidnight - fromUtcMidnight) / (24 * 60 * 60 * 1000));
};

const resolveTier = (lifetimeEarned = 0) => {
    const earned = sanitizeNumber(lifetimeEarned, 0);
    let selected = TIERS[0];
    for (const tier of TIERS) {
        if (earned >= tier.minLifetime) {
            selected = tier;
        }
    }
    return selected;
};

const computeDailyStreak = ({ lastDailyRewardAt, currentStreak, now }) => {
    const nowKey = toIstDayKey(now);
    if (!nowKey) {
        return { shouldAward: false, nextStreak: sanitizeNumber(currentStreak, 0), streakBonus: 0 };
    }

    const lastKey = toIstDayKey(lastDailyRewardAt);
    if (lastKey && lastKey === nowKey) {
        return { shouldAward: false, nextStreak: sanitizeNumber(currentStreak, 0), streakBonus: 0 };
    }

    const dayDiff = lastKey ? getDayDiff(lastKey, nowKey) : Number.POSITIVE_INFINITY;
    const previousStreak = sanitizeNumber(currentStreak, 0);
    const nextStreak = dayDiff === 1 ? previousStreak + 1 : 1;
    const streakBonus = nextStreak >= 3 ? Math.min(60, Math.floor(nextStreak / 3) * 5) : 0;

    return { shouldAward: true, nextStreak, streakBonus };
};

const computePointsForAction = ({ action, orderTotal = 0, streakBonus = 0 }) => {
    const rule = REWARD_RULES[action];
    if (!rule) return 0;

    if (action === 'order_placed') {
        const total = sanitizeNumber(orderTotal, 0);
        const variablePoints = Math.floor(total / 100) * rule.perHundredPoints;
        return Math.max(rule.basePoints, Math.min(rule.maxPoints, variablePoints));
    }

    if (action === 'daily_login') {
        return rule.basePoints + sanitizeNumber(streakBonus, 0);
    }

    return sanitizeNumber(rule.basePoints, 0);
};

const getRewardSnapshotFromUser = (userDoc) => {
    const loyalty = userDoc?.loyalty || {};
    return {
        pointsBalance: sanitizeNumber(loyalty.pointsBalance, 0),
        lifetimeEarned: sanitizeNumber(loyalty.lifetimeEarned, 0),
        lifetimeSpent: sanitizeNumber(loyalty.lifetimeSpent, 0),
        streakDays: sanitizeNumber(loyalty.streakDays, 0),
        tier: loyalty.tier || 'Rookie',
        nextMilestone: loyalty.nextMilestone === null ? null : sanitizeNumber(loyalty.nextMilestone, 500),
        lastEarnedAt: loyalty.lastEarnedAt || null,
        lastDailyRewardAt: loyalty.lastDailyRewardAt || null,
    };
};

const awardLoyaltyPoints = async ({
    userId,
    action,
    orderTotal = 0,
    refId = '',
    session,
}) => {
    const rule = REWARD_RULES[action];
    if (!rule || !userId) return { awarded: false, points: 0 };

    const user = await User.findById(userId).session(session || null);
    if (!user) return { awarded: false, points: 0 };

    if (!user.loyalty) user.loyalty = {};

    const now = new Date();
    const currentStreak = sanitizeNumber(user.loyalty.streakDays, 0);
    let streakBonus = 0;

    if (action === 'daily_login') {
        const streakState = computeDailyStreak({
            lastDailyRewardAt: user.loyalty.lastDailyRewardAt,
            currentStreak,
            now,
        });
        if (!streakState.shouldAward) {
            return {
                awarded: false,
                points: 0,
                snapshot: getRewardSnapshotFromUser(user),
            };
        }

        user.loyalty.streakDays = streakState.nextStreak;
        user.loyalty.lastDailyRewardAt = now;
        streakBonus = streakState.streakBonus;
    }

    const points = computePointsForAction({ action, orderTotal, streakBonus });
    if (points <= 0) {
        return {
            awarded: false,
            points: 0,
            snapshot: getRewardSnapshotFromUser(user),
        };
    }

    user.loyalty.pointsBalance = sanitizeNumber(user.loyalty.pointsBalance, 0) + points;
    user.loyalty.lifetimeEarned = sanitizeNumber(user.loyalty.lifetimeEarned, 0) + points;
    user.loyalty.lastEarnedAt = now;

    const tier = resolveTier(user.loyalty.lifetimeEarned);
    user.loyalty.tier = tier.name;
    user.loyalty.nextMilestone = tier.nextMilestone;

    if (!Array.isArray(user.loyalty.ledger)) user.loyalty.ledger = [];
    user.loyalty.ledger.unshift({
        eventType: action,
        points,
        reason: action === 'daily_login' && streakBonus > 0
            ? `${rule.reason} + streak bonus`
            : rule.reason,
        refType: rule.refType,
        refId: refId ? String(refId) : '',
        createdAt: now,
    });
    if (user.loyalty.ledger.length > MAX_LEDGER_ITEMS) {
        user.loyalty.ledger = user.loyalty.ledger.slice(0, MAX_LEDGER_ITEMS);
    }

    await user.save({ session: session || null });

    return {
        awarded: true,
        points,
        streakBonus,
        snapshot: getRewardSnapshotFromUser(user),
    };
};

const getUserRewards = async ({ userId, limit = 20 }) => {
    const user = await User.findById(userId).select('loyalty').lean();
    const snapshot = getRewardSnapshotFromUser(user);
    const activity = Array.isArray(user?.loyalty?.ledger) ? user.loyalty.ledger : [];

    return {
        ...snapshot,
        recentActivity: activity.slice(0, Math.max(1, Math.min(Number(limit) || 20, 100))),
    };
};

module.exports = {
    awardLoyaltyPoints,
    getUserRewards,
    getRewardSnapshotFromUser,
};
