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

const startOfIstDay = (dateValue) => {
    const date = new Date(dateValue);
    if (!Number.isFinite(date.getTime())) return null;
    const shiftedMs = date.getTime() + IST_OFFSET_MINUTES * 60 * 1000;
    const shifted = new Date(shiftedMs);
    const istMidnight = Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate()
    );
    return new Date(istMidnight - IST_OFFSET_MINUTES * 60 * 1000);
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
    let nextStreak = currentStreak;

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

        nextStreak = streakState.nextStreak;
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

    const projectedLifetimeEarned = sanitizeNumber(user.loyalty.lifetimeEarned, 0) + points;
    const tier = resolveTier(projectedLifetimeEarned);
    const ledgerEntry = {
        eventType: action,
        points,
        reason: action === 'daily_login' && streakBonus > 0
            ? `${rule.reason} + streak bonus`
            : rule.reason,
        refType: rule.refType,
        refId: refId ? String(refId) : '',
        createdAt: now,
    };

    // Atomic award: concurrent orders/logins mutate the same user document, so
    // a read-modify-write save() silently drops one award. $inc/$push apply
    // server-side, and the daily_login filter re-checks the IST-day boundary
    // atomically so two concurrent logins cannot both pass the streak
    // pre-check and double-award.
    const awardUpdate = {
        $inc: {
            'loyalty.pointsBalance': points,
            'loyalty.lifetimeEarned': points,
        },
        $set: {
            'loyalty.lastEarnedAt': now,
            'loyalty.tier': tier.name,
            'loyalty.nextMilestone': tier.nextMilestone,
        },
        $push: {
            'loyalty.ledger': {
                $each: [ledgerEntry],
                $position: 0,
                $slice: MAX_LEDGER_ITEMS,
            },
        },
    };
    const awardFilter = { _id: user._id };
    if (action === 'daily_login') {
        awardFilter['loyalty.lastDailyRewardAt'] = {
            $not: { $gte: startOfIstDay(now) },
        };
        awardUpdate.$set['loyalty.streakDays'] = nextStreak;
        awardUpdate.$set['loyalty.lastDailyRewardAt'] = now;
    }

    const awardResult = await User.updateOne(awardFilter, awardUpdate, session ? { session } : {});
    if (!awardResult || awardResult.modifiedCount === 0) {
        return {
            awarded: false,
            points: 0,
            snapshot: getRewardSnapshotFromUser(user),
        };
    }

    return {
        awarded: true,
        points,
        streakBonus,
        snapshot: {
            ...getRewardSnapshotFromUser(user),
            pointsBalance: sanitizeNumber(user.loyalty.pointsBalance, 0) + points,
            lifetimeEarned: projectedLifetimeEarned,
            tier: tier.name,
            nextMilestone: tier.nextMilestone,
            lastEarnedAt: now,
            ...(action === 'daily_login' ? {
                streakDays: nextStreak,
                lastDailyRewardAt: now,
            } : {}),
        },
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
