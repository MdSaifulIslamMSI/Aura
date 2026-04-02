const {
    buildGroundedCatalogContext,
    compareProducts,
} = require('../assistantCommerceService');
const { getProductByIdentifier } = require('../catalogService');
const { normalizeProductSummary, safeString } = require('./assistantContract');

const fetchProductById = async (productId = '') => {
    const product = await getProductByIdentifier(productId, {
        allowDemoFallback: true,
    });
    if (!product) return null;
    const normalized = normalizeProductSummary(product);
    return normalized.id ? normalized : null;
};

const fetchProductsByIds = async (productIds = []) => {
    const uniqueIds = [...new Set((Array.isArray(productIds) ? productIds : [])
        .map((entry) => safeString(entry))
        .filter(Boolean))]
        .slice(0, 6);

    const products = await Promise.all(uniqueIds.map((productId) => fetchProductById(productId)));
    return products.filter((product) => product?.id);
};

const resolveGroundedCatalog = async (message = '') => {
    const grounding = await buildGroundedCatalogContext({
        message: safeString(message),
        conversationHistory: [],
    });

    return {
        actionType: safeString(grounding?.actionType || 'search'),
        category: safeString(grounding?.category || ''),
        maxPrice: Math.max(0, Number(grounding?.maxPrice || 0)),
        products: (Array.isArray(grounding?.products) ? grounding.products : [])
            .map((product) => normalizeProductSummary(product))
            .filter((product) => product.id),
    };
};

const resolveComparisonProducts = async ({ message = '', candidateProductIds = [] } = {}) => {
    const candidateProducts = await fetchProductsByIds(candidateProductIds);
    if (candidateProducts.length >= 2) {
        return candidateProducts.slice(0, 2);
    }

    const compareMatch = safeString(message).match(/(.+?)\s+(?:vs|versus)\s+(.+)/i);
    if (!compareMatch?.[1] || !compareMatch?.[2]) {
        return candidateProducts.slice(0, 2);
    }

    const products = await compareProducts(compareMatch[1], compareMatch[2], {});
    return (Array.isArray(products) ? products : [])
        .map((product) => normalizeProductSummary(product))
        .filter((product) => product.id)
        .slice(0, 2);
};

module.exports = {
    fetchProductById,
    fetchProductsByIds,
    resolveComparisonProducts,
    resolveGroundedCatalog,
};
