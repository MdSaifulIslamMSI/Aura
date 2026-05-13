const {
    RECOMMENDATION_REASONS,
    SOURCE_LABELS,
} = require('../utils/recommendationConstants');
const {
    normalizeProductForClient,
    productDisplayId,
} = require('./candidateService');

const safeString = (value = '') => String(value === undefined || value === null ? '' : value).trim();
const safeLower = (value = '') => safeString(value).toLowerCase();
const clamp = (value, min = 0, max = 100) => Math.min(Math.max(Number(value) || 0, min), max);

const hasImage = (product = {}) => Boolean(product.image || (Array.isArray(product.images) && product.images.length > 0));

const getRatingScore = (product = {}) => clamp((Number(product.rating || 0) / 5) * 100);
const getDiscountScore = (product = {}) => clamp(Number(product.discountPercentage || 0) || (
    Number(product.originalPrice || 0) > Number(product.price || 0)
        ? ((Number(product.originalPrice) - Number(product.price)) / Number(product.originalPrice)) * 100
        : 0
));
const getFreshnessScore = (product = {}) => {
    const createdAt = product?.createdAt ? new Date(product.createdAt).getTime() : 0;
    if (!Number.isFinite(createdAt) || createdAt <= 0) return 0;
    const ageDays = (Date.now() - createdAt) / (24 * 60 * 60 * 1000);
    if (ageDays <= 7) return 100;
    if (ageDays <= 30) return 60;
    if (ageDays <= 90) return 25;
    return 5;
};

const getUserPreferenceScore = (product = {}, profile = {}) => {
    let score = 0;
    const category = safeLower(product.category);
    const brand = safeLower(product.brand);
    const tags = new Set((Array.isArray(product.tags) ? product.tags : []).map((tag) => safeLower(tag)));
    const favoriteCategories = new Set((profile.favoriteCategories || []).map((entry) => safeLower(entry)));
    const favoriteBrands = new Set((profile.favoriteBrands || []).map((entry) => safeLower(entry)));
    const preferredTags = (profile.preferredTags || []).map((entry) => safeLower(entry));
    const price = Number(product.price || 0);
    const priceRange = profile.preferredPriceRange || {};

    if (category && favoriteCategories.has(category)) score += 35;
    if (brand && favoriteBrands.has(brand)) score += 20;
    score += Math.min(30, preferredTags.filter((tag) => tags.has(tag)).length * 5);
    if (price > 0 && Number(priceRange.min || 0) > 0 && Number(priceRange.max || 0) > 0 && price >= priceRange.min && price <= priceRange.max) {
        score += 15;
    }
    return clamp(score);
};

const getPopularityScore = (product = {}, candidateScores = {}) => {
    if (candidateScores.popularityScore !== undefined) {
        return clamp(candidateScores.popularityScore);
    }
    const reviewDepth = Math.min(70, Math.log10(Number(product.ratingCount || 0) + 1) * 28);
    const rating = Number(product.rating || 0) >= 4 ? 20 : Number(product.rating || 0) * 4;
    return clamp(reviewDepth + rating);
};

const getPenaltyScore = (product = {}, { cartIds = new Set(), purchasedIds = new Set(), currentProductId = '' } = {}) => {
    const ids = [productDisplayId(product), safeString(product._id), safeString(product.id)].filter(Boolean);
    if (ids.some((id) => cartIds.has(id))) return 1000;
    if (currentProductId && ids.some((id) => id === String(currentProductId))) return 1000;
    let penalty = 0;
    if (ids.some((id) => purchasedIds.has(id))) penalty += 40;
    if (!hasImage(product)) penalty += 8;
    return penalty;
};

const pickReason = (candidate = {}, product = {}, profileScore = 0) => {
    if (candidate.reason) return candidate.reason;
    if (candidate.source === SOURCE_LABELS.popularity) return RECOMMENDATION_REASONS.trending;
    if (candidate.source === SOURCE_LABELS.collaborative) return RECOMMENDATION_REASONS.boughtTogether;
    if (candidate.source === SOURCE_LABELS.cart) return RECOMMENDATION_REASONS.cartAddon;
    if (profileScore >= 35) return RECOMMENDATION_REASONS.recentInterest;
    if (Number(product.rating || 0) >= 4.3) return RECOMMENDATION_REASONS.topRated;
    return RECOMMENDATION_REASONS.coldStart;
};

const scoreRecommendationCandidate = (candidate = {}, options = {}) => {
    const product = normalizeProductForClient(candidate.product || candidate);
    const candidateScores = candidate.scores || {};
    const userPreferenceScore = candidateScores.userPreferenceScore !== undefined
        ? clamp(candidateScores.userPreferenceScore)
        : getUserPreferenceScore(product, options.profile || {});
    const contentSimilarityScore = clamp(candidateScores.contentSimilarityScore);
    const collaborativeScore = clamp(candidateScores.collaborativeScore);
    const popularityScore = getPopularityScore(product, candidateScores);
    const ratingScore = getRatingScore(product);
    const discountScore = getDiscountScore(product);
    const freshnessScore = getFreshnessScore(product);
    const penaltyScore = getPenaltyScore(product, options);

    const finalScore = clamp(
        (0.30 * contentSimilarityScore)
        + (0.25 * userPreferenceScore)
        + (0.15 * collaborativeScore)
        + (0.10 * popularityScore)
        + (0.10 * ratingScore)
        + (0.05 * discountScore)
        + (0.05 * freshnessScore)
        - penaltyScore,
        -1000,
        100
    );

    return {
        product,
        score: Number(finalScore.toFixed(1)),
        reason: pickReason(candidate, product, userPreferenceScore),
        source: candidate.source || SOURCE_LABELS.fallback,
        debug: {
            contentSimilarityScore,
            userPreferenceScore,
            collaborativeScore,
            popularityScore,
            ratingScore,
            discountScore,
            freshnessScore,
            penaltyScore,
        },
    };
};

const mergeAndScoreCandidates = (candidateGroups = [], options = {}) => {
    const byProduct = new Map();

    candidateGroups.flat().filter(Boolean).forEach((candidate) => {
        const product = normalizeProductForClient(candidate.product || candidate);
        const key = productDisplayId(product);
        if (!key) return;
        const scored = scoreRecommendationCandidate({ ...candidate, product }, options);
        const existing = byProduct.get(key);
        if (!existing || scored.score > existing.score) {
            byProduct.set(key, scored);
        }
    });

    return [...byProduct.values()].sort((left, right) => right.score - left.score);
};

module.exports = {
    mergeAndScoreCandidates,
    scoreRecommendationCandidate,
};
