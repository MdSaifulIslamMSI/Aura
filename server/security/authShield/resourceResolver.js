const mongoose = require('mongoose');
const Order = require('../../models/Order');
const Listing = require('../../models/Listing');
const PaymentIntent = require('../../models/PaymentIntent');
const PaymentMethod = require('../../models/PaymentMethod');
const User = require('../../models/User');

const objectIdOrNull = (value = '') => (
    mongoose.isValidObjectId(String(value || '').trim()) ? String(value).trim() : null
);

const normalizeId = (value = '') => String(value || '').trim();

const resolveUserResource = async (req = {}) => {
    const userId = objectIdOrNull(req.params?.userId || req.params?.id || req.user?._id);
    if (!userId) return null;
    const user = await User.findById(userId).select('_id accountState isAdmin isSeller').lean();
    if (!user) return null;
    return {
        type: 'user',
        id: normalizeId(user._id),
        ownerId: normalizeId(user._id),
        tenantId: '',
        allowedRelations: ['self', 'admin'],
        sensitivity: 'critical',
        accountState: user.accountState || 'active',
    };
};

const resolveOrderResource = async (req = {}) => {
    const orderId = objectIdOrNull(req.params?.orderId || req.params?.id);
    if (!orderId) return null;
    const order = await Order.findById(orderId)
        .select('_id user paymentIntentId marketCountryCode orderItems')
        .lean();
    if (!order) return null;
    return {
        type: 'order',
        id: normalizeId(order._id),
        ownerId: normalizeId(order.user),
        buyerId: normalizeId(order.user),
        sellerId: '',
        tenantId: normalizeId(order.marketCountryCode),
        allowedRelations: ['buyer', 'admin'],
        sensitivity: 'medium',
        paymentIntentId: normalizeId(order.paymentIntentId),
    };
};

const resolveListingResource = async (req = {}) => {
    const listingId = objectIdOrNull(req.params?.listingId || req.params?.id);
    if (!listingId) return null;
    const listing = await Listing.findById(listingId)
        .select('_id seller escrow.buyer marketCountryCode')
        .lean();
    if (!listing) return null;
    return {
        type: 'listing',
        id: normalizeId(listing._id),
        ownerId: normalizeId(listing.seller),
        sellerId: normalizeId(listing.seller),
        buyerId: normalizeId(listing.escrow?.buyer),
        tenantId: normalizeId(listing.marketCountryCode),
        allowedRelations: ['seller', 'buyer', 'admin'],
        sensitivity: 'medium',
    };
};

const resolvePaymentIntentResource = async (req = {}) => {
    const intentId = normalizeId(req.params?.intentId || req.body?.intentId);
    if (!intentId) return null;
    const intent = await PaymentIntent.findOne({ intentId })
        .select('_id intentId user order marketCountryCode marketCurrency')
        .lean();
    if (!intent) return null;
    return {
        type: 'payment',
        id: normalizeId(intent.intentId || intent._id),
        ownerId: normalizeId(intent.user),
        buyerId: normalizeId(intent.user),
        tenantId: normalizeId(intent.marketCountryCode || intent.marketCurrency),
        allowedRelations: ['buyer', 'admin'],
        sensitivity: 'critical',
        orderId: normalizeId(intent.order),
    };
};

const resolvePaymentMethodResource = async (req = {}) => {
    const methodId = objectIdOrNull(req.params?.methodId);
    if (!methodId) return null;
    const method = await PaymentMethod.findById(methodId).select('_id user').lean();
    if (!method) return null;
    return {
        type: 'payment_method',
        id: normalizeId(method._id),
        ownerId: normalizeId(method.user),
        buyerId: normalizeId(method.user),
        allowedRelations: ['owner'],
        sensitivity: 'high',
    };
};

const resolvePaymentRefundResource = async (req = {}) => {
    const intentResource = await resolvePaymentIntentResource(req);
    if (intentResource) {
        return {
            ...intentResource,
            type: 'refund',
            sensitivity: 'critical',
        };
    }
    const orderResource = await resolveOrderResource(req);
    if (!orderResource) return null;
    return {
        ...orderResource,
        type: 'refund',
        sensitivity: 'critical',
    };
};

const resolveReviewResource = async (req = {}) => ({
    type: 'review',
    id: normalizeId(req.params?.reviewId || req.params?.id || req.body?.reviewId || 'review'),
    ownerId: normalizeId(req.user?._id),
    tenantId: '',
    allowedRelations: ['owner', 'admin'],
    sensitivity: 'medium',
});

const resolveUploadModerationResource = async (req = {}) => ({
    type: 'upload',
    id: normalizeId(req.body?.uploadId || req.body?.uploadToken || req.params?.id || 'review-media'),
    ownerId: normalizeId(req.user?._id),
    tenantId: '',
    allowedRelations: ['owner', 'admin'],
    sensitivity: 'high',
});

const resolveAdminConfigResource = async (req = {}) => ({
    type: 'admin_config',
    id: normalizeId(req.params?.key || req.path || req.originalUrl || 'admin_config'),
    tenantId: '',
    allowedRelations: ['admin'],
    sensitivity: 'critical',
});

const resourceResolvers = Object.freeze({
    user: resolveUserResource,
    order: resolveOrderResource,
    listing: resolveListingResource,
    review: resolveReviewResource,
    payment: resolvePaymentIntentResource,
    paymentMethod: resolvePaymentMethodResource,
    paymentRefund: resolvePaymentRefundResource,
    uploadModeration: resolveUploadModerationResource,
    adminConfig: resolveAdminConfigResource,
});

module.exports = {
    objectIdOrNull,
    resolveAdminConfigResource,
    resolveListingResource,
    resolveOrderResource,
    resolvePaymentIntentResource,
    resolvePaymentMethodResource,
    resolvePaymentRefundResource,
    resolveReviewResource,
    resolveUploadModerationResource,
    resolveUserResource,
    resourceResolvers,
};
