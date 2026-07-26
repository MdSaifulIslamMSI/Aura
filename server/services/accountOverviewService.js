const User = require('../models/User');
const Order = require('../models/Order');
const Listing = require('../models/Listing');
const SupportTicket = require('../models/SupportTicket');

const ACCOUNT_OVERVIEW_CONTRACT_VERSION = 1;
const ACTIVE_ORDER_STATUSES = ['placed', 'processing', 'shipped'];
const PENDING_FINANCIAL_STATUSES = ['pending', 'approved', 'in_review'];
const IDENTITY_PROJECTION = [
    'name',
    'email',
    'phone',
    'avatar',
    'dob',
    'bio',
    'isVerified',
    'isSeller',
    'accountState',
    'addresses',
    'wishlist',
    'createdAt',
].join(' ');
const RECENT_ORDER_PROJECTION = [
    '_id',
    'orderStatus',
    'isPaid',
    'isDelivered',
    'presentmentTotalPrice',
    'presentmentCurrency',
    'totalPrice',
    'createdAt',
    'orderItems.title',
    'orderItems.image',
].join(' ');

const toIsoOrNull = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const normalizeText = (value) => String(value || '').trim();

const calculateProfileCompletion = (user = {}) => {
    const checks = [
        normalizeText(user.name),
        normalizeText(user.email),
        normalizeText(user.phone),
        normalizeText(user.avatar),
        user.dob,
        normalizeText(user.bio),
        Array.isArray(user.addresses) && user.addresses.length > 0,
    ];
    const complete = checks.filter(Boolean).length;
    return Math.round((complete / checks.length) * 100);
};

const toSavedItemPreview = (item = {}) => ({
    id: Number(item.id || 0),
    title: normalizeText(item.title),
    image: normalizeText(item.image),
    price: Number(item.price || 0),
});

const toRecentOrder = (order = {}) => {
    const firstItem = Array.isArray(order.orderItems) ? order.orderItems[0] : null;
    const presentmentAmount = Number(order.presentmentTotalPrice || 0);
    const fallbackAmount = Number(order.totalPrice || 0);

    return {
        id: String(order._id || ''),
        status: normalizeText(order.orderStatus) || 'placed',
        paid: Boolean(order.isPaid),
        delivered: Boolean(order.isDelivered),
        total: {
            amount: presentmentAmount > 0 ? presentmentAmount : fallbackAmount,
            currency: normalizeText(order.presentmentCurrency) || 'INR',
        },
        createdAt: toIsoOrNull(order.createdAt),
        item: firstItem ? {
            title: normalizeText(firstItem.title),
            image: normalizeText(firstItem.image),
        } : null,
    };
};

const loadOrderOverview = async (userId) => {
    const [activeCount, recentOrders] = await Promise.all([
        Order.countDocuments({
            user: userId,
            orderStatus: { $in: ACTIVE_ORDER_STATUSES },
        }),
        Order.find({ user: userId })
            .select(RECENT_ORDER_PROJECTION)
            .sort({ createdAt: -1, _id: -1 })
            .limit(3)
            .lean(),
    ]);

    return {
        activeCount: Number(activeCount || 0),
        recent: (recentOrders || []).map(toRecentOrder),
    };
};

const loadPendingPostPurchaseOverview = async (userId) => ({
    pendingCount: Number(await Order.countDocuments({
        user: userId,
        $or: [
            { 'commandCenter.refunds.status': { $in: PENDING_FINANCIAL_STATUSES } },
            { 'commandCenter.replacements.status': { $in: PENDING_FINANCIAL_STATUSES } },
        ],
    }) || 0),
});

const loadSupportOverview = async (userId) => {
    const [openCount, actionRequired] = await Promise.all([
        SupportTicket.countDocuments({ user: userId, status: 'open' }),
        SupportTicket.findOne({ user: userId, userActionRequired: true })
            .select('_id subject status category lastMessageAt')
            .sort({ lastMessageAt: -1, _id: -1 })
            .lean(),
    ]);

    return {
        openCount: Number(openCount || 0),
        actionRequired: actionRequired ? {
            id: String(actionRequired._id || ''),
            subject: normalizeText(actionRequired.subject),
            status: normalizeText(actionRequired.status),
            category: normalizeText(actionRequired.category),
            updatedAt: toIsoOrNull(actionRequired.lastMessageAt),
        } : null,
    };
};

const loadMarketplaceOverview = async (userId) => {
    const [activeCount, soldCount, recentListing] = await Promise.all([
        Listing.countDocuments({ seller: userId, status: 'active' }),
        Listing.countDocuments({ seller: userId, status: 'sold' }),
        Listing.findOne({ seller: userId })
            .select('_id title images status views createdAt')
            .sort({ createdAt: -1, _id: -1 })
            .lean(),
    ]);

    return {
        activeCount: Number(activeCount || 0),
        soldCount: Number(soldCount || 0),
        recent: recentListing ? {
            id: String(recentListing._id || ''),
            title: normalizeText(recentListing.title),
            image: normalizeText(recentListing.images?.[0]),
            status: normalizeText(recentListing.status),
            views: Number(recentListing.views || 0),
            createdAt: toIsoOrNull(recentListing.createdAt),
        } : null,
    };
};

const buildSecurityOverview = (user = {}) => {
    const recommendationCodes = [];
    if (!user.isVerified) recommendationCodes.push('VERIFY_EMAIL');
    if (!normalizeText(user.phone)) recommendationCodes.push('ADD_VERIFIED_PHONE');
    if (calculateProfileCompletion(user) < 100) recommendationCodes.push('COMPLETE_PROFILE');
    if (user.accountState && user.accountState !== 'active') {
        recommendationCodes.unshift('REVIEW_ACCOUNT_STATUS');
    }

    return {
        attentionRequired: recommendationCodes.length > 0,
        recommendationCodes: recommendationCodes.slice(0, 3),
    };
};

const buildAccountOverview = async (userId) => {
    const normalizedUserId = normalizeText(userId);
    if (!normalizedUserId) {
        const error = new Error('Authenticated account identity is required');
        error.code = 'ACCOUNT_IDENTITY_REQUIRED';
        throw error;
    }

    const user = await User.findById(normalizedUserId)
        .select(IDENTITY_PROJECTION)
        .lean();
    if (!user) {
        const error = new Error('Account profile not found');
        error.code = 'ACCOUNT_PROFILE_NOT_FOUND';
        throw error;
    }

    const optionalSources = {
        orders: () => loadOrderOverview(user._id),
        postPurchase: () => loadPendingPostPurchaseOverview(user._id),
        support: () => loadSupportOverview(user._id),
        marketplace: () => loadMarketplaceOverview(user._id),
    };
    const sourceNames = Object.keys(optionalSources);
    const sourceResults = await Promise.allSettled(
        sourceNames.map((sourceName) => optionalSources[sourceName]())
    );
    const unavailable = [];
    const resolved = {};

    sourceResults.forEach((result, index) => {
        const sourceName = sourceNames[index];
        if (result.status === 'fulfilled') {
            resolved[sourceName] = result.value;
        } else {
            unavailable.push(sourceName);
        }
    });

    return {
        contractVersion: ACCOUNT_OVERVIEW_CONTRACT_VERSION,
        generatedAt: new Date().toISOString(),
        identity: {
            name: normalizeText(user.name),
            email: normalizeText(user.email),
            avatar: normalizeText(user.avatar),
            memberSince: toIsoOrNull(user.createdAt),
            accountState: normalizeText(user.accountState) || 'active',
            verified: Boolean(user.isVerified),
            seller: Boolean(user.isSeller),
            completion: calculateProfileCompletion(user),
        },
        orders: resolved.orders || { activeCount: 0, recent: [] },
        postPurchase: resolved.postPurchase || { pendingCount: 0 },
        savedItems: {
            count: Array.isArray(user.wishlist) ? user.wishlist.length : 0,
            preview: (Array.isArray(user.wishlist) ? user.wishlist : [])
                .slice(0, 3)
                .map(toSavedItemPreview),
        },
        security: buildSecurityOverview(user),
        support: resolved.support || { openCount: 0, actionRequired: null },
        marketplace: resolved.marketplace || {
            activeCount: 0,
            soldCount: 0,
            recent: null,
        },
        meta: {
            partial: unavailable.length > 0,
            unavailable,
        },
    };
};

module.exports = {
    ACCOUNT_OVERVIEW_CONTRACT_VERSION,
    buildAccountOverview,
    calculateProfileCompletion,
};
