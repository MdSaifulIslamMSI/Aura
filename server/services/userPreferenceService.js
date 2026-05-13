const Cart = require('../models/Cart');
const User = require('../models/User');
const RecommendationEvent = require('../models/RecommendationEvent');
const {
    EVENT_WEIGHTS,
} = require('../utils/recommendationConstants');
const {
    loadProductsByIdentifiers,
    normalizeProductForClient,
    productDisplayId,
} = require('./candidateService');

const safeString = (value = '') => String(value === undefined || value === null ? '' : value).trim();
const safeLower = (value = '') => safeString(value).toLowerCase();

const increment = (map, key, weight = 1) => {
    const normalized = safeString(key);
    if (!normalized) return;
    map.set(normalized, (map.get(normalized) || 0) + Number(weight || 1));
};

const topKeys = (map, limit = 8) => [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([key]) => key)
    .slice(0, limit);

const collectSearchTags = (query = '') => safeLower(query)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .slice(0, 8);

const loadPersistedSignals = async (userId = null) => {
    if (!userId) {
        return { cartItems: [], wishlistItems: [] };
    }

    const [cart, user] = await Promise.all([
        Cart.findOne({ user: userId }).select('items').lean(),
        User.findById(userId).select('wishlist').lean(),
    ]);

    return {
        cartItems: Array.isArray(cart?.items) ? cart.items : [],
        wishlistItems: Array.isArray(user?.wishlist) ? user.wishlist : [],
    };
};

const buildUserPreferenceProfile = async ({
    userId = null,
    sessionId = '',
    eventLimit = 120,
} = {}) => {
    const identityClauses = [];
    if (userId) identityClauses.push({ userId });
    if (sessionId) identityClauses.push({ sessionId });

    const eventFilter = identityClauses.length > 0 ? { $or: identityClauses } : null;
    const [events, persisted] = await Promise.all([
        eventFilter
            ? RecommendationEvent.find(eventFilter)
                .sort({ createdAt: -1 })
                .limit(Math.min(Math.max(Number(eventLimit) || 120, 1), 300))
                .lean()
            : Promise.resolve([]),
        loadPersistedSignals(userId),
    ]);

    const productIdentifiers = [];
    const searchQueries = [];
    const categoryWeights = new Map();
    const brandWeights = new Map();
    const tagWeights = new Map();
    const recentProductIds = [];
    const purchasedProductIds = [];
    const cartProductIds = [];

    for (const event of events) {
        const weight = EVENT_WEIGHTS[event.eventType] || 1;
        const productIdentifier = safeString(event.productId || event.productNumericId || '');
        if (productIdentifier) {
            productIdentifiers.push(productIdentifier);
            if (event.eventType === 'product_view' || event.eventType === 'recommendation_click') {
                recentProductIds.push(productIdentifier);
            }
            if (event.eventType === 'purchase') {
                purchasedProductIds.push(productIdentifier);
            }
            if (event.eventType === 'add_to_cart') {
                cartProductIds.push(productIdentifier);
            }
        }
        if (event.category) increment(categoryWeights, event.category, weight);
        if (event.searchQuery) {
            searchQueries.push(event.searchQuery);
            collectSearchTags(event.searchQuery).forEach((token) => increment(tagWeights, token, weight));
        }
    }

    persisted.cartItems.forEach((item) => {
        const id = safeString(item?.productId || item?.id || item?._id || '');
        if (!id) return;
        productIdentifiers.push(id);
        cartProductIds.push(id);
    });
    persisted.wishlistItems.forEach((item) => {
        const id = safeString(item?.id || item?._id || item?.productId || '');
        if (!id) return;
        productIdentifiers.push(id);
        if (item.category) increment(categoryWeights, item.category, 3);
        if (item.brand) increment(brandWeights, item.brand, 2);
    });

    const products = await loadProductsByIdentifiers([...new Set(productIdentifiers)]);
    const productLookup = new Map();
    products.forEach((product) => {
        productLookup.set(String(product._id || ''), product);
        productLookup.set(String(product.id || ''), product);
    });

    const prices = [];
    for (const rawId of productIdentifiers) {
        const product = productLookup.get(String(rawId));
        if (!product) continue;
        const eventWeight = events.find((event) => String(event.productId || event.productNumericId || '') === String(rawId))
            ? EVENT_WEIGHTS[events.find((event) => String(event.productId || event.productNumericId || '') === String(rawId))?.eventType] || 1
            : 1;
        increment(categoryWeights, product.category, eventWeight);
        increment(brandWeights, product.brand, eventWeight);
        (Array.isArray(product.tags) ? product.tags : []).forEach((tag) => increment(tagWeights, tag, eventWeight));
        const price = Number(product.price || 0);
        if (price > 0) prices.push(price);
    }

    const averagePrice = prices.length > 0
        ? prices.reduce((sum, price) => sum + price, 0) / prices.length
        : 0;

    return {
        hasSignals: events.length > 0 || products.length > 0 || searchQueries.length > 0,
        favoriteCategories: topKeys(categoryWeights, 6),
        favoriteBrands: topKeys(brandWeights, 6),
        preferredTags: topKeys(tagWeights, 16),
        preferredPriceRange: averagePrice > 0
            ? {
                min: Math.max(1, Math.round(averagePrice * 0.65)),
                max: Math.round(averagePrice * 1.45),
                average: Math.round(averagePrice),
            }
            : { min: 0, max: 0, average: 0 },
        recentProducts: [...new Set(recentProductIds)].slice(0, 12),
        cartProductIds: [...new Set(cartProductIds)].slice(0, 40),
        purchasedProductIds: [...new Set(purchasedProductIds)].slice(0, 40),
        searchQueries: [...new Set(searchQueries)].slice(0, 10),
        seedProducts: products.map(normalizeProductForClient),
        excludeIds: new Set([
            ...cartProductIds,
            ...products
                .filter((product) => cartProductIds.includes(String(product.id)) || cartProductIds.includes(String(product._id)))
                .flatMap((product) => [productDisplayId(product), String(product._id || '')]),
        ].filter(Boolean)),
    };
};

module.exports = {
    buildUserPreferenceProfile,
};
