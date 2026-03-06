const mongoose = require('mongoose');
const Product = require('../models/Product');
const User = require('../models/User');
const { queryProducts, getActiveCatalogVersion } = require('./catalogService');

const MAX_RECENTLY_VIEWED = 8;
const MAX_SEARCH_HISTORY = 5;
const MAX_RESULTS = 6;

const CATEGORY_RULES = [
    { category: 'mobiles', pattern: /\bmobile|iphone|android|phone|galaxy|pixel|oneplus\b/i },
    { category: 'laptops', pattern: /\blaptop|macbook|notebook|ultrabook\b/i },
    { category: 'electronics', pattern: /\bearbuds|headphone|speaker|camera|tv|monitor|gadget|electronic\b/i },
    { category: "men's-fashion", pattern: /\bshirt|hoodie|jeans|men|mens|sneaker|jacket\b/i },
    { category: "women's-fashion", pattern: /\bdress|heels|handbag|women|womens|kurti|saree\b/i },
    { category: 'home-kitchen', pattern: /\bair fryer|blender|kitchen|home|furniture|mixer|cookware\b/i },
    { category: 'gaming', pattern: /\bgaming|console|controller|ps5|xbox|gpu\b/i },
    { category: 'books', pattern: /\bbook|novel|biography|exam|guide\b/i },
    { category: 'sports', pattern: /\bfootball|cricket|tennis|gym|sports|dumbbell|yoga\b/i },
];

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const normalizeId = (value) => safeString(value);
const formatCategoryLabel = (value = '') => safeString(value).replace(/-/g, ' ');

const inferCategoryFromText = (value = '') => {
    const text = safeString(value);
    if (!text) return null;
    return CATEGORY_RULES.find((rule) => rule.pattern.test(text))?.category || null;
};

const pushWeightedCategory = (counter, category, weight) => {
    if (!category) return;
    counter.set(category, (counter.get(category) || 0) + weight);
};

const pushWeightedBrand = (counter, brand, weight) => {
    if (!brand) return;
    const normalized = safeString(brand);
    if (!normalized) return;
    counter.set(normalized, (counter.get(normalized) || 0) + weight);
};

const buildMetaFromSignals = ({ primaryCategory, hasCart, hasWishlist, hasRecent, hasSearch }) => {
    let eyebrow = 'Intent-Based Recommendations';
    let title = 'Curated for Your Next Move';
    let description = 'These picks combine your durable account signals with your current browsing session.';

    if (hasCart && primaryCategory) {
        eyebrow = 'Persistent Cart Momentum';
        title = `Keep building your ${formatCategoryLabel(primaryCategory)} stack`;
        description = 'Server-side recommendations are reinforcing what is already in your cart so the next decision stays fast.';
    } else if (hasWishlist && primaryCategory) {
        eyebrow = 'Wishlist Signal';
        title = `More from your ${formatCategoryLabel(primaryCategory)} shortlist`;
        description = 'Your stored wishlist is steering this lane, even when you switch devices.';
    } else if (hasRecent) {
        eyebrow = 'Resume Discovery';
        title = 'Continue where your product research left off';
        description = 'This lane blends recent browsing with your saved account intent so discovery does not restart from zero.';
    } else if (hasSearch) {
        eyebrow = 'Search Intent';
        title = 'Results shaped around what you have been looking for';
        description = 'Recent query intent is now blended with your account history instead of staying trapped in one browser session.';
    } else {
        eyebrow = 'Account-Backed Picks';
        title = 'High-confidence catalog picks';
        description = 'No strong personal signal yet, so this lane defaults to broad, high-trust discovery from the live catalog.';
    }

    return { eyebrow, title, description };
};

const normalizeClientInput = (input = {}) => {
    const recentlyViewed = Array.isArray(input.recentlyViewed)
        ? input.recentlyViewed
            .slice(0, MAX_RECENTLY_VIEWED)
            .map((item) => ({
                id: normalizeId(item?.id || item?._id),
                category: safeString(item?.category),
                brand: safeString(item?.brand),
            }))
            .filter((item) => item.id || item.category || item.brand)
        : [];

    const searchHistory = Array.isArray(input.searchHistory)
        ? input.searchHistory
            .map((value) => safeString(value))
            .filter(Boolean)
            .slice(0, MAX_SEARCH_HISTORY)
        : [];

    const limit = Math.min(Math.max(Number(input.limit) || MAX_RESULTS, 1), 12);

    return { recentlyViewed, searchHistory, limit };
};

const buildProductFilter = async () => {
    const activeCatalogVersion = await getActiveCatalogVersion();
    return {
        catalogVersion: activeCatalogVersion,
        isPublished: true,
    };
};

const loadUserSignals = async (userId) => {
    if (!userId) {
        return { cart: [], wishlist: [] };
    }

    const user = await User.findById(userId).select('cart wishlist').lean();
    return {
        cart: Array.isArray(user?.cart) ? user.cart : [],
        wishlist: Array.isArray(user?.wishlist) ? user.wishlist : [],
    };
};

const hydrateSeedProducts = async ({ cart = [], wishlist = [], recentlyViewed = [] }) => {
    const ids = [...cart, ...wishlist].map((item) => normalizeId(item?.id));
    recentlyViewed.forEach((item) => {
        if (item?.id) ids.push(normalizeId(item.id));
    });

    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) {
        return new Map();
    }

    const numericIds = uniqueIds
        .filter((value) => /^\d+$/.test(value))
        .map((value) => Number(value));

    const objectIds = uniqueIds
        .filter((value) => mongoose.Types.ObjectId.isValid(value))
        .map((value) => new mongoose.Types.ObjectId(value));

    const clauses = [];
    if (numericIds.length > 0) clauses.push({ id: { $in: numericIds } });
    if (objectIds.length > 0) clauses.push({ _id: { $in: objectIds } });

    if (clauses.length === 0) {
        return new Map();
    }

    const filter = await buildProductFilter();
    const products = await Product.find({
        ...filter,
        $or: clauses,
    }).lean();

    const lookup = new Map();
    for (const product of products) {
        lookup.set(normalizeId(product.id), product);
        lookup.set(normalizeId(product._id), product);
    }

    return lookup;
};

const rankEntries = (counter) => [...counter.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([key]) => key);

const collectRecommendationSignals = ({ cart = [], wishlist = [], recentlyViewed = [], searchHistory = [], hydratedProducts = new Map() }) => {
    const categoryWeights = new Map();
    const brandWeights = new Map();
    const excludeIds = new Set();

    const cartSeeds = cart.map((item) => hydratedProducts.get(normalizeId(item?.id))).filter(Boolean);
    const wishlistSeeds = wishlist.map((item) => hydratedProducts.get(normalizeId(item?.id))).filter(Boolean);
    const recentSeeds = recentlyViewed
        .map((item) => hydratedProducts.get(normalizeId(item?.id)) || item)
        .filter(Boolean);

    cartSeeds.forEach((item) => {
        pushWeightedCategory(categoryWeights, item?.category, 4);
        pushWeightedBrand(brandWeights, item?.brand, 3);
        excludeIds.add(normalizeId(item?.id || item?._id));
    });

    wishlistSeeds.forEach((item) => {
        pushWeightedCategory(categoryWeights, item?.category, 3);
        pushWeightedBrand(brandWeights, item?.brand, 2);
        excludeIds.add(normalizeId(item?.id || item?._id));
    });

    recentSeeds.forEach((item) => {
        pushWeightedCategory(categoryWeights, item?.category, 2);
        pushWeightedBrand(brandWeights, item?.brand, 1);
        if (item?.id || item?._id) {
            excludeIds.add(normalizeId(item?.id || item?._id));
        }
    });

    searchHistory.forEach((term) => {
        pushWeightedCategory(categoryWeights, inferCategoryFromText(term), 1);
    });

    return {
        rankedCategories: rankEntries(categoryWeights).slice(0, 3),
        rankedBrands: rankEntries(brandWeights).slice(0, 2),
        recentQueries: searchHistory.slice(0, 3),
        excludeIds,
        hasCart: cartSeeds.length > 0,
        hasWishlist: wishlistSeeds.length > 0,
        hasRecent: recentSeeds.length > 0,
        hasSearch: searchHistory.length > 0,
    };
};

const queryRecommendationPools = async ({ rankedCategories, rankedBrands, recentQueries }) => {
    const requests = [];

    if (rankedCategories[0]) {
        requests.push(queryProducts({ category: rankedCategories[0], sort: 'rating', limit: 8 }));
    }
    if (rankedCategories[1]) {
        requests.push(queryProducts({ category: rankedCategories[1], sort: 'discount', limit: 8 }));
    }
    if (rankedBrands[0]) {
        requests.push(queryProducts({ brand: rankedBrands[0], sort: 'rating', limit: 8 }));
    }
    if (recentQueries[0]) {
        requests.push(queryProducts({ keyword: recentQueries[0], sort: 'relevance', limit: 8 }));
    }
    if (requests.length === 0) {
        requests.push(queryProducts({ sort: 'rating', limit: 8 }));
    }

    return Promise.allSettled(requests);
};

const mergeRecommendationProducts = ({ responses, excludeIds, limit }) => {
    const output = [];
    const seen = new Set();

    for (const response of responses) {
        if (response.status !== 'fulfilled') continue;
        const products = Array.isArray(response.value?.products) ? response.value.products : [];

        for (const product of products) {
            const key = normalizeId(product?.id || product?._id);
            if (!key || seen.has(key) || excludeIds.has(key)) continue;
            seen.add(key);
            output.push(product);
            if (output.length >= limit) {
                return output;
            }
        }
    }

    return output;
};

const buildProductRecommendations = async ({ userId = null, input = {} } = {}) => {
    const normalizedInput = normalizeClientInput(input);
    const persisted = await loadUserSignals(userId);
    const hydratedProducts = await hydrateSeedProducts({
        cart: persisted.cart,
        wishlist: persisted.wishlist,
        recentlyViewed: normalizedInput.recentlyViewed,
    });

    const signals = collectRecommendationSignals({
        cart: persisted.cart,
        wishlist: persisted.wishlist,
        recentlyViewed: normalizedInput.recentlyViewed,
        searchHistory: normalizedInput.searchHistory,
        hydratedProducts,
    });

    const responses = await queryRecommendationPools(signals);
    const products = mergeRecommendationProducts({
        responses,
        excludeIds: signals.excludeIds,
        limit: normalizedInput.limit,
    });

    return {
        ...buildMetaFromSignals({
            primaryCategory: signals.rankedCategories[0] || null,
            hasCart: signals.hasCart,
            hasWishlist: signals.hasWishlist,
            hasRecent: signals.hasRecent,
            hasSearch: signals.hasSearch,
        }),
        primaryCategory: signals.rankedCategories[0] || null,
        sourceLabels: [
            ...(signals.hasCart ? ['persistent cart'] : []),
            ...(signals.hasWishlist ? ['stored wishlist'] : []),
            ...(signals.hasRecent ? ['recent browsing'] : []),
            ...(signals.hasSearch ? ['search intent'] : []),
        ],
        products,
    };
};

module.exports = {
    buildProductRecommendations,
};
