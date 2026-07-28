const User = require('../models/User');
const Product = require('../models/Product');
const ProductReview = require('../models/ProductReview');
const Listing = require('../models/Listing');
const TradeIn = require('../models/TradeIn');
const PriceAlert = require('../models/PriceAlert');

const PREVIEW_LIMIT = 6;

const toText = (value, max = 240) => String(value || '').trim().slice(0, max);
const toId = (value) => String(value?._id || value || '').trim();

const hydrateSavedItems = async (items = []) => {
    const preview = [...(Array.isArray(items) ? items : [])]
        .sort((left, right) => new Date(right?.addedAt || 0) - new Date(left?.addedAt || 0))
        .slice(0, PREVIEW_LIMIT);
    const ids = preview
        .map((item) => Number(item?.id))
        .filter((id) => Number.isFinite(id) && id > 0);
    const products = ids.length
        ? await Product.find({ id: { $in: ids } })
            .select('id title image price stock')
            .lean()
        : [];
    const productById = new Map((products || []).map((product) => [Number(product.id), product]));

    return preview.map((item) => {
        const live = productById.get(Number(item?.id)) || {};
        const productId = Number(live.id ?? item?.id);
        return {
            productId,
            title: toText(live.title || item?.title, 180),
            image: toText(live.image || item?.image, 2048),
            price: Number(live.price ?? item?.price ?? 0),
            inStock: Number(live.stock ?? item?.stock ?? 0) > 0,
            addedAt: item?.addedAt || null,
            href: `/product/${encodeURIComponent(String(productId))}`,
        };
    });
};

const mapListing = (listing = {}) => ({
    id: toId(listing),
    title: toText(listing.title, 120),
    image: toText(listing.images?.[0], 2048),
    price: Number(listing.price || 0),
    status: toText(listing.status, 24),
    views: Math.max(0, Number(listing.views || 0)),
    createdAt: listing.createdAt || null,
    href: `/listing/${encodeURIComponent(toId(listing))}`,
});

const mapReview = (review = {}) => ({
    id: toId(review),
    productId: Number(review.product?.id || 0),
    productTitle: toText(review.product?.title, 180),
    productImage: toText(review.product?.image, 2048),
    rating: Number(review.rating || 0),
    comment: toText(review.comment, 1800),
    status: toText(review.status, 24),
    helpfulCount: Math.max(0, Number(review.helpfulCount || 0)),
    createdAt: review.createdAt || null,
    updatedAt: review.updatedAt || null,
    href: review.product?.id
        ? `/product/${encodeURIComponent(String(review.product.id))}`
        : '/products',
});

const mapTradeIn = (tradeIn = {}) => ({
    id: toId(tradeIn),
    productId: Number(tradeIn.targetProduct?.productId || 0),
    productTitle: toText(tradeIn.targetProduct?.title, 180),
    productImage: toText(tradeIn.targetProduct?.image, 2048),
    estimatedValue: Math.max(0, Number(tradeIn.estimatedValue || 0)),
    finalValue: tradeIn.finalValue == null ? null : Math.max(0, Number(tradeIn.finalValue || 0)),
    status: toText(tradeIn.status, 32),
    createdAt: tradeIn.createdAt || null,
    href: '/trade-in',
});

const mapPriceAlert = (alert = {}) => ({
    id: toId(alert),
    productId: Number(alert.productId || 0),
    productTitle: toText(alert.productTitle, 180),
    productImage: toText(alert.productImage, 2048),
    currentPrice: Math.max(0, Number(alert.currentPrice || 0)),
    targetPrice: Math.max(0, Number(alert.targetPrice || 0)),
    triggered: Boolean(alert.triggered),
    isActive: Boolean(alert.isActive),
    createdAt: alert.createdAt || null,
    href: '/price-alerts',
});

const buildAccountMarketplaceHub = async (userId) => {
    const ownerId = toId(userId);
    const profilePromise = User.findById(ownerId)
        .select('wishlist wishlistRevision wishlistSyncedAt')
        .lean();
    const listingsPromise = Listing.find({ seller: ownerId })
        .select('title images price status views createdAt')
        .sort({ createdAt: -1, _id: -1 })
        .limit(PREVIEW_LIMIT)
        .lean();
    const reviewsPromise = ProductReview.find({ user: ownerId })
        .select('product rating comment status helpfulCount createdAt updatedAt')
        .populate('product', 'id title image')
        .sort({ createdAt: -1, _id: -1 })
        .limit(PREVIEW_LIMIT)
        .lean();
    const tradeInsPromise = TradeIn.find({ user: ownerId })
        .select('targetProduct estimatedValue finalValue status createdAt')
        .sort({ createdAt: -1, _id: -1 })
        .limit(PREVIEW_LIMIT)
        .lean();
    const priceAlertsPromise = PriceAlert.find({ user: ownerId })
        .select('productId productTitle productImage currentPrice targetPrice triggered isActive createdAt')
        .sort({ createdAt: -1, _id: -1 })
        .limit(PREVIEW_LIMIT)
        .lean();

    const [
        profile,
        listings,
        reviews,
        tradeIns,
        priceAlerts,
        listingCount,
        reviewCount,
        tradeInCount,
        priceAlertCount,
    ] = await Promise.all([
        profilePromise,
        listingsPromise,
        reviewsPromise,
        tradeInsPromise,
        priceAlertsPromise,
        Listing.countDocuments({ seller: ownerId }),
        ProductReview.countDocuments({ user: ownerId }),
        TradeIn.countDocuments({ user: ownerId }),
        PriceAlert.countDocuments({ user: ownerId }),
    ]);

    if (!profile) {
        const error = new Error('Account profile not found');
        error.code = 'ACCOUNT_PROFILE_NOT_FOUND';
        throw error;
    }

    const savedItems = await hydrateSavedItems(profile.wishlist || []);
    return {
        contractVersion: 1,
        previewLimit: PREVIEW_LIMIT,
        savedItems: {
            count: Array.isArray(profile.wishlist) ? profile.wishlist.length : 0,
            revision: Math.max(0, Number(profile.wishlistRevision || 0)),
            syncedAt: profile.wishlistSyncedAt || null,
            items: savedItems,
            href: '/wishlist',
        },
        reviews: {
            count: reviewCount,
            items: (reviews || []).map(mapReview),
        },
        listings: {
            count: listingCount,
            items: (listings || []).map(mapListing),
            href: '/my-listings',
        },
        tradeIns: {
            count: tradeInCount,
            items: (tradeIns || []).map(mapTradeIn),
            href: '/trade-in',
        },
        priceAlerts: {
            count: priceAlertCount,
            items: (priceAlerts || []).map(mapPriceAlert),
            href: '/price-alerts',
        },
    };
};

module.exports = {
    PREVIEW_LIMIT,
    buildAccountMarketplaceHub,
    __private: {
        hydrateSavedItems,
        mapListing,
        mapPriceAlert,
        mapReview,
        mapTradeIn,
    },
};
