const mongoose = require('mongoose');
const Product = require('../models/Product');
const Order = require('../models/Order');
const RecommendationEvent = require('../models/RecommendationEvent');
const { queryProducts, getActiveCatalogVersion } = require('./catalogService');
const {
    ACCESSORY_KEYWORDS_BY_CATEGORY,
    EVENT_WEIGHTS,
    RECOMMENDATION_REASONS,
    SOURCE_LABELS,
    clampRecommendationLimit,
} = require('../utils/recommendationConstants');

const PRODUCT_SELECT = [
    '_id',
    'id',
    'externalId',
    'title',
    'displayTitle',
    'subtitle',
    'brand',
    'category',
    'subCategory',
    'categoryPaths',
    'tags',
    'price',
    'originalPrice',
    'discountPercentage',
    'rating',
    'ratingCount',
    'image',
    'images',
    'description',
    'highlights',
    'stock',
    'deliveryTime',
    'warranty',
    'isPublished',
    'isActive',
    'createdAt',
].join(' ');

const safeString = (value = '') => String(value === undefined || value === null ? '' : value).trim();
const safeLower = (value = '') => safeString(value).toLowerCase();
const escapeRegExp = (value = '') => safeString(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toPlain = (doc) => (doc?.toObject?.() ? doc.toObject() : doc);
const productDisplayId = (product = {}) => safeString(product?.id || product?._id || product?.externalId || '');
const productObjectId = (product = {}) => (mongoose.Types.ObjectId.isValid(product?._id) ? String(product._id) : '');
const isObjectIdLike = (value) => mongoose.Types.ObjectId.isValid(safeString(value));
const isNumericIdLike = (value) => /^\d+$/.test(safeString(value));

const normalizeTags = (product = {}) => {
    const tags = Array.isArray(product.tags) ? product.tags : [];
    const text = [
        product.title,
        product.displayTitle,
        product.brand,
        product.category,
        product.subCategory,
        ...(Array.isArray(product.highlights) ? product.highlights : []),
    ].join(' ');
    return [...new Set([
        ...tags,
        ...safeLower(text).replace(/[^a-z0-9]+/g, ' ').split(/\s+/),
    ].map((entry) => safeLower(entry)).filter((entry) => entry.length >= 2))].slice(0, 40);
};

const normalizeProductForClient = (product = {}) => {
    const plain = toPlain(product) || {};
    const title = plain.displayTitle || plain.title || '';
    return {
        ...plain,
        _id: plain._id ? String(plain._id) : plain._id,
        id: plain.id,
        name: title,
        title,
        images: Array.isArray(plain.images) ? plain.images : (plain.image ? [plain.image] : []),
        tags: normalizeTags(plain),
    };
};

const buildActiveProductFilter = async (extra = {}) => {
    const base = {
        isPublished: true,
        isActive: { $ne: false },
        stock: { $gt: 0 },
        ...extra,
    };

    try {
        const activeCatalogVersion = await getActiveCatalogVersion();
        if (activeCatalogVersion) {
            base.catalogVersion = activeCatalogVersion;
        }
    } catch {
        // Recommendations should degrade to any published, active product.
    }

    return base;
};

const findActiveProducts = async (filter = {}, { limit = 50, sort = { rating: -1, ratingCount: -1, createdAt: -1 } } = {}) => {
    const base = await buildActiveProductFilter(filter);
    let products = await Product.find(base)
        .select(PRODUCT_SELECT)
        .sort(sort)
        .limit(clampRecommendationLimit(limit, 50, 100))
        .lean();

    if (products.length === 0 && base.catalogVersion) {
        const { catalogVersion, ...fallbackBase } = base;
        products = await Product.find(fallbackBase)
            .select(PRODUCT_SELECT)
            .sort(sort)
            .limit(clampRecommendationLimit(limit, 50, 100))
            .lean();
    }

    return products.map(normalizeProductForClient);
};

const buildIdentifierClauses = (identifiers = []) => {
    const clauses = [];
    const objectIds = [];
    const numericIds = [];
    const externalIds = [];

    (Array.isArray(identifiers) ? identifiers : [identifiers]).forEach((raw) => {
        const value = safeString(raw);
        if (!value) return;
        if (isObjectIdLike(value)) objectIds.push(new mongoose.Types.ObjectId(value));
        if (isNumericIdLike(value)) numericIds.push(Number(value));
        if (!isObjectIdLike(value) && !isNumericIdLike(value)) externalIds.push(value);
    });

    if (objectIds.length > 0) clauses.push({ _id: { $in: objectIds } });
    if (numericIds.length > 0) clauses.push({ id: { $in: numericIds } });
    if (externalIds.length > 0) clauses.push({ externalId: { $in: externalIds } });
    return clauses;
};

const loadProductsByIdentifiers = async (identifiers = []) => {
    const clauses = buildIdentifierClauses(identifiers);
    if (clauses.length === 0) return [];
    return findActiveProducts({ $or: clauses }, { limit: Math.max(identifiers.length, 1) * 2 });
};

const resolveProductByIdentifier = async (identifier) => {
    const products = await loadProductsByIdentifiers([identifier]);
    return products[0] || null;
};

const buildCandidate = ({
    product,
    source = SOURCE_LABELS.fallback,
    reason = RECOMMENDATION_REASONS.coldStart,
    scores = {},
    metadata = {},
} = {}) => ({
    product: normalizeProductForClient(product),
    source,
    reason,
    scores,
    metadata,
});

const sharedTagCount = (left = {}, right = {}) => {
    const rightTags = new Set(normalizeTags(right));
    return normalizeTags(left).filter((tag) => rightTags.has(tag)).length;
};

const isNewProduct = (product = {}) => {
    const createdAt = product?.createdAt ? new Date(product.createdAt).getTime() : 0;
    if (!Number.isFinite(createdAt) || createdAt <= 0) return false;
    return Date.now() - createdAt <= 30 * 24 * 60 * 60 * 1000;
};

const scoreSimilarProduct = (baseProduct = {}, product = {}) => {
    let score = 0;
    const reasons = [];
    const baseCategory = safeLower(baseProduct.category);
    const productCategory = safeLower(product.category);
    const baseSubCategory = safeLower(baseProduct.subCategory);
    const productSubCategory = safeLower(product.subCategory);
    const baseBrand = safeLower(baseProduct.brand);
    const productBrand = safeLower(product.brand);
    const basePrice = Number(baseProduct.price || 0);
    const price = Number(product.price || 0);

    if (baseCategory && baseCategory === productCategory) {
        score += 30;
        reasons.push(RECOMMENDATION_REASONS.similarCategory);
    }
    if (baseSubCategory && baseSubCategory === productSubCategory) {
        score += 25;
        reasons.push('Same subcategory');
    }
    if (baseBrand && baseBrand === productBrand) {
        score += 15;
        reasons.push(RECOMMENDATION_REASONS.sameBrand);
    }
    const tagHits = sharedTagCount(baseProduct, product);
    if (tagHits > 0) {
        score += Math.min(25, tagHits * 5);
        reasons.push(RECOMMENDATION_REASONS.relatedProduct);
    }
    if (basePrice > 0 && price > 0 && Math.abs(price - basePrice) / basePrice <= 0.2) {
        score += 15;
        reasons.push(RECOMMENDATION_REASONS.similarPrice);
    }
    if (Number(product.rating || 0) >= 4) score += 10;
    if (Number(product.discountPercentage || 0) > 0 || Number(product.originalPrice || 0) > Number(product.price || 0)) score += 5;
    if (isNewProduct(product)) score += 3;

    return {
        score,
        reason: reasons[0] || (Number(product.rating || 0) >= 4 ? RECOMMENDATION_REASONS.popularSimilar : RECOMMENDATION_REASONS.relatedProduct),
    };
};

const getSimilarProductCandidates = async ({ productId, limit = 24 } = {}) => {
    const baseProduct = await resolveProductByIdentifier(productId);
    if (!baseProduct) return [];

    const price = Number(baseProduct.price || 0);
    const tags = normalizeTags(baseProduct).slice(0, 10);
    const clauses = [];
    if (baseProduct.category) clauses.push({ category: new RegExp(`^${escapeRegExp(baseProduct.category)}$`, 'i') });
    if (baseProduct.subCategory) clauses.push({ subCategory: new RegExp(`^${escapeRegExp(baseProduct.subCategory)}$`, 'i') });
    if (baseProduct.brand) clauses.push({ brand: new RegExp(`^${escapeRegExp(baseProduct.brand)}$`, 'i') });
    if (tags.length > 0) clauses.push({ tags: { $in: tags } });
    if (price > 0) clauses.push({ price: { $gte: price * 0.8, $lte: price * 1.2 } });

    const exclusion = {
        _id: { $ne: new mongoose.Types.ObjectId(baseProduct._id) },
        ...(baseProduct.id ? { id: { $ne: Number(baseProduct.id) } } : {}),
    };
    const filter = {
        ...exclusion,
        ...(clauses.length > 0 ? { $or: clauses } : {}),
    };
    const products = await findActiveProducts(filter, { limit: Math.max(limit * 3, 24) });

    return products
        .map((product) => {
            const similar = scoreSimilarProduct(baseProduct, product);
            return buildCandidate({
                product,
                source: SOURCE_LABELS.content,
                reason: similar.reason,
                scores: { contentSimilarityScore: similar.score },
                metadata: { baseProductId: productDisplayId(baseProduct) },
            });
        })
        .sort((left, right) => right.scores.contentSimilarityScore - left.scores.contentSimilarityScore)
        .slice(0, clampRecommendationLimit(limit, 24, 50));
};

const getFallbackProductCandidates = async ({ limit = 12, reason = RECOMMENDATION_REASONS.coldStart } = {}) => {
    const products = await findActiveProducts({}, {
        limit,
        sort: { rating: -1, ratingCount: -1, discountPercentage: -1, createdAt: -1 },
    });
    return products.map((product) => buildCandidate({
        product,
        source: SOURCE_LABELS.fallback,
        reason,
        scores: { popularityScore: Math.min(100, Number(product.ratingCount || 0)) },
    }));
};

const getTrendingProductCandidates = async ({ limit = 24, days = 7 } = {}) => {
    const since = new Date(Date.now() - Math.max(1, Number(days || 7)) * 24 * 60 * 60 * 1000);
    const weightedEvents = await RecommendationEvent.find({
        createdAt: { $gte: since },
        eventType: { $in: Object.keys(EVENT_WEIGHTS) },
        $or: [
            { productId: { $ne: null } },
            { productNumericId: { $ne: null } },
        ],
    })
        .sort({ createdAt: -1 })
        .limit(4000)
        .lean();

    const scores = new Map();
    for (const event of weightedEvents) {
        const key = event.productId ? String(event.productId) : (event.productNumericId ? String(event.productNumericId) : '');
        if (!key) continue;
        const weight = EVENT_WEIGHTS[event.eventType] || 0;
        scores.set(key, (scores.get(key) || 0) + weight);
    }

    if (scores.size === 0 && days < 30) {
        return getTrendingProductCandidates({ limit, days: 30 });
    }

    if (scores.size === 0) {
        return getFallbackProductCandidates({ limit, reason: RECOMMENDATION_REASONS.topRated });
    }

    const products = await loadProductsByIdentifiers([...scores.keys()]);
    const candidates = products.map((product) => {
        const key = productObjectId(product) || String(product.id || '');
        const numericKey = String(product.id || '');
        const eventScore = Math.max(scores.get(key) || 0, scores.get(numericKey) || 0);
        const ratingBoost = Number(product.rating || 0) >= 4 ? 8 : 0;
        const discountBoost = Number(product.discountPercentage || 0) > 0 ? 5 : 0;
        const freshnessBoost = isNewProduct(product) ? 4 : 0;
        return buildCandidate({
            product,
            source: SOURCE_LABELS.popularity,
            reason: RECOMMENDATION_REASONS.trending,
            scores: {
                popularityScore: Math.min(100, (eventScore * 5) + ratingBoost + discountBoost + freshnessBoost),
                collaborativeScore: Math.min(100, eventScore * 4),
            },
            metadata: { eventScore },
        });
    });

    return candidates
        .sort((left, right) => (right.metadata.eventScore || 0) - (left.metadata.eventScore || 0))
        .slice(0, clampRecommendationLimit(limit, 24, 50));
};

const getRecentlyViewedBasedCandidates = async ({ userId = null, sessionId = '', limit = 24 } = {}) => {
    const identityFilter = userId ? { userId } : { sessionId };
    if (!userId && !sessionId) return [];
    const events = await RecommendationEvent.find({
        ...identityFilter,
        eventType: 'product_view',
        $or: [
            { productId: { $ne: null } },
            { productNumericId: { $ne: null } },
        ],
    })
        .sort({ createdAt: -1 })
        .limit(12)
        .lean();

    const recentIds = [...new Set(events.map((event) => String(event.productId || event.productNumericId || '')).filter(Boolean))];
    const merged = [];
    const seen = new Set(recentIds);

    for (const recentId of recentIds.slice(0, 4)) {
        const similar = await getSimilarProductCandidates({ productId: recentId, limit: 8 });
        for (const candidate of similar) {
            const key = productDisplayId(candidate.product);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push({
                ...candidate,
                source: SOURCE_LABELS.recent,
                reason: RECOMMENDATION_REASONS.viewedSimilar,
            });
            if (merged.length >= limit) return merged;
        }
    }

    return merged;
};

const getSearchBasedCandidates = async ({ query = '', limit = 24 } = {}) => {
    const safeQuery = safeString(query);
    if (!safeQuery) return [];
    const result = await queryProducts({
        keyword: safeQuery,
        sort: 'relevance',
        limit: clampRecommendationLimit(limit, 8, 24),
        includeMeta: false,
        includeDetails: true,
        includeSponsored: false,
    });

    return (result.products || []).map((product) => buildCandidate({
        product: normalizeProductForClient(product),
        source: SOURCE_LABELS.search,
        reason: RECOMMENDATION_REASONS.searchBased,
        scores: { contentSimilarityScore: 70, popularityScore: 20 },
    }));
};

const getPersonalizedCandidates = async ({ profile = {}, limit = 24 } = {}) => {
    const clauses = [];
    const favoriteCategories = Array.isArray(profile.favoriteCategories) ? profile.favoriteCategories : [];
    const favoriteBrands = Array.isArray(profile.favoriteBrands) ? profile.favoriteBrands : [];
    const preferredTags = Array.isArray(profile.preferredTags) ? profile.preferredTags : [];
    const priceRange = profile.preferredPriceRange || {};

    if (favoriteCategories.length > 0) {
        clauses.push({ category: { $in: favoriteCategories.map((category) => new RegExp(`^${escapeRegExp(category)}$`, 'i')) } });
    }
    if (favoriteBrands.length > 0) {
        clauses.push({ brand: { $in: favoriteBrands.map((brand) => new RegExp(`^${escapeRegExp(brand)}$`, 'i')) } });
    }
    if (preferredTags.length > 0) {
        clauses.push({ tags: { $in: preferredTags.slice(0, 12).map((tag) => safeLower(tag)) } });
    }
    if (Number(priceRange.min || 0) > 0 || Number(priceRange.max || 0) > 0) {
        clauses.push({
            price: {
                ...(Number(priceRange.min || 0) > 0 ? { $gte: Number(priceRange.min) } : {}),
                ...(Number(priceRange.max || 0) > 0 ? { $lte: Number(priceRange.max) } : {}),
            },
        });
    }

    if (clauses.length === 0) return [];
    const products = await findActiveProducts({ $or: clauses }, { limit: Math.max(limit * 2, 24) });
    return products.map((product) => buildCandidate({
        product,
        source: SOURCE_LABELS.personalized,
        reason: RECOMMENDATION_REASONS.recentInterest,
        scores: { userPreferenceScore: 70 },
    }));
};

const resolveCartSeedProducts = async (cartItems = []) => {
    const identifiers = (Array.isArray(cartItems) ? cartItems : [])
        .map((item) => item?.productId || item?.id || item?._id)
        .map((entry) => safeString(entry))
        .filter(Boolean);
    return loadProductsByIdentifiers(identifiers);
};

const getFrequentlyBoughtTogetherCandidates = async ({ productIds = [], cartItems = [], limit = 24 } = {}) => {
    const seedIdentifiers = [
        ...(Array.isArray(productIds) ? productIds : [productIds]),
        ...(Array.isArray(cartItems) ? cartItems.map((item) => item?.productId || item?.id || item?._id) : []),
    ].map((entry) => safeString(entry)).filter(Boolean);
    const seedProducts = await loadProductsByIdentifiers(seedIdentifiers);
    const seedObjectIds = seedProducts.map((product) => productObjectId(product)).filter(Boolean);
    const excluded = new Set(seedProducts.flatMap((product) => [productObjectId(product), String(product.id || '')]).filter(Boolean));

    if (seedObjectIds.length > 0) {
        const orders = await Order.find({
            'orderItems.product': { $in: seedObjectIds.map((id) => new mongoose.Types.ObjectId(id)) },
        })
            .select('orderItems.product')
            .sort({ createdAt: -1 })
            .limit(300)
            .lean();

        const cooccurrence = new Map();
        for (const order of orders) {
            for (const item of order.orderItems || []) {
                const key = safeString(item?.product || '');
                if (!key || excluded.has(key)) continue;
                cooccurrence.set(key, (cooccurrence.get(key) || 0) + 1);
            }
        }

        if (cooccurrence.size > 0) {
            const products = await loadProductsByIdentifiers([...cooccurrence.keys()]);
            return products
                .map((product) => buildCandidate({
                    product,
                    source: SOURCE_LABELS.collaborative,
                    reason: RECOMMENDATION_REASONS.boughtTogether,
                    scores: { collaborativeScore: Math.min(100, (cooccurrence.get(productObjectId(product)) || 0) * 20) },
                    metadata: { cooccurrenceCount: cooccurrence.get(productObjectId(product)) || 0 },
                }))
                .sort((left, right) => (right.metadata.cooccurrenceCount || 0) - (left.metadata.cooccurrenceCount || 0))
                .slice(0, clampRecommendationLimit(limit, 24, 50));
        }
    }

    return getComplementaryCandidates({ seedProducts, excluded, limit });
};

const getComplementaryCandidates = async ({ seedProducts = [], excluded = new Set(), limit = 24 } = {}) => {
    const clauses = [];
    for (const product of seedProducts) {
        const category = safeLower(product.category);
        const keywords = ACCESSORY_KEYWORDS_BY_CATEGORY[category] || ACCESSORY_KEYWORDS_BY_CATEGORY[category.replace(/\s+/g, '-')] || [];
        keywords.forEach((keyword) => {
            const pattern = new RegExp(escapeRegExp(keyword), 'i');
            clauses.push({ title: pattern }, { description: pattern }, { tags: safeLower(keyword) });
        });
        if (product.category) {
            clauses.push({ category: new RegExp(`^${escapeRegExp(product.category)}$`, 'i') });
        }
    }

    if (clauses.length === 0) return [];
    const products = await findActiveProducts({ $or: clauses }, { limit: Math.max(limit * 3, 24) });
    return products
        .filter((product) => !excluded.has(productObjectId(product)) && !excluded.has(String(product.id || '')))
        .map((product) => buildCandidate({
            product,
            source: SOURCE_LABELS.cart,
            reason: RECOMMENDATION_REASONS.cartAddon,
            scores: { contentSimilarityScore: 55, userPreferenceScore: 25 },
        }))
        .slice(0, clampRecommendationLimit(limit, 24, 50));
};

const getCartAddOnCandidates = async ({ cartItems = [], limit = 24 } = {}) => {
    const seedProducts = await resolveCartSeedProducts(cartItems);
    const excluded = new Set(seedProducts.flatMap((product) => [productObjectId(product), String(product.id || '')]).filter(Boolean));
    const frequentlyBought = await getFrequentlyBoughtTogetherCandidates({ cartItems, limit });
    const complementary = await getComplementaryCandidates({ seedProducts, excluded, limit });
    return [...frequentlyBought, ...complementary].slice(0, clampRecommendationLimit(limit, 24, 50));
};

module.exports = {
    PRODUCT_SELECT,
    buildCandidate,
    findActiveProducts,
    getCartAddOnCandidates,
    getFallbackProductCandidates,
    getFrequentlyBoughtTogetherCandidates,
    getPersonalizedCandidates,
    getRecentlyViewedBasedCandidates,
    getSearchBasedCandidates,
    getSimilarProductCandidates,
    getTrendingProductCandidates,
    loadProductsByIdentifiers,
    normalizeProductForClient,
    productDisplayId,
    resolveProductByIdentifier,
};
