const { productDisplayId } = require('./candidateService');

const safeString = (value = '') => String(value === undefined || value === null ? '' : value).trim();
const safeLower = (value = '') => safeString(value).toLowerCase();

const hasImage = (product = {}) => Boolean(product.image || (Array.isArray(product.images) && product.images.length > 0));

const isEligibleProduct = (product = {}) => (
    product
    && product.isPublished !== false
    && product.isActive !== false
    && Number(product.stock || 0) > 0
);

const applyBusinessReranking = (recommendations = [], {
    limit = 8,
    excludeIds = new Set(),
    currentProductId = '',
    maxPerBrand = 2,
    maxPerCategory = 4,
} = {}) => {
    const sorted = [...(Array.isArray(recommendations) ? recommendations : [])]
        .filter((item) => item?.score > -999)
        .sort((left, right) => {
            const leftImageBoost = hasImage(left.product) ? 0.25 : 0;
            const rightImageBoost = hasImage(right.product) ? 0.25 : 0;
            return (right.score + rightImageBoost) - (left.score + leftImageBoost);
        });

    const output = [];
    const seen = new Set();
    const brandCounts = new Map();
    const categoryCounts = new Map();

    for (const item of sorted) {
        const product = item.product || {};
        const ids = [productDisplayId(product), safeString(product._id), safeString(product.id)].filter(Boolean);
        if (!isEligibleProduct(product)) continue;
        if (ids.some((id) => seen.has(id) || excludeIds.has(id) || id === String(currentProductId || ''))) continue;

        const brand = safeLower(product.brand);
        const category = safeLower(product.category);
        const brandCount = brandCounts.get(brand) || 0;
        const categoryCount = categoryCounts.get(category) || 0;

        if (brand && brandCount >= maxPerBrand && output.length >= Math.ceil(limit / 2)) continue;
        if (category && categoryCount >= maxPerCategory && output.length >= Math.ceil(limit / 2)) continue;

        output.push({
            product,
            score: item.score,
            reason: item.reason,
            source: item.source,
            ...(item.debug ? { debug: item.debug } : {}),
        });
        ids.forEach((id) => seen.add(id));
        if (brand) brandCounts.set(brand, brandCount + 1);
        if (category) categoryCounts.set(category, categoryCount + 1);
        if (output.length >= limit) break;
    }

    return output;
};

module.exports = {
    applyBusinessReranking,
};
