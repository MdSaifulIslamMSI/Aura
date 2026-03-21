const { resolveCategory } = require('../config/categories');
const { queryProducts } = require('./catalogService');

const MAX_RESULTS = 6;

const CATEGORY_HINTS = [
    { keys: ['mobile', 'phone', 'smartphone', 'iphone', 'samsung', 'pixel', 'oneplus'], category: 'Mobiles' },
    { keys: ['laptop', 'notebook', 'macbook', 'ultrabook'], category: 'Laptops' },
    { keys: ['electronics', 'earbuds', 'speaker', 'headphone', 'audio', 'monitor', 'tv'], category: 'Electronics' },
    { keys: ['men', 'mens', 'shirt', 'jacket', 'trouser', 'jeans'], category: "Men's Fashion" },
    { keys: ['women', 'womens', 'dress', 'saree', 'kurti', 'heels'], category: "Women's Fashion" },
    { keys: ['home', 'kitchen', 'furniture', 'appliance', 'cookware', 'air fryer'], category: 'Home & Kitchen' },
    { keys: ['gaming', 'controller', 'mouse', 'keyboard', 'console', 'ps5', 'xbox'], category: 'Gaming & Accessories' },
    { keys: ['book', 'novel', 'reading', 'guide', 'paperback', 'hardcover'], category: 'Books' },
    { keys: ['shoe', 'sneaker', 'footwear', 'boot', 'sandal', 'running shoes'], category: 'Footwear' },
];

const COMMERCE_INTENT_PATTERN = /\b(buy|purchase|shop|shopping|find|show|need|want|recommend|suggest|compare|vs|versus|deal|discount|offer|sale|cheap|affordable|budget|under|below|within|max|trending|popular|best|top|product|products)\b/i;

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const safeLower = (value, fallback = '') => safeString(value, fallback).toLowerCase();
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);

const detectCategoryHint = (text) => {
    const lower = safeLower(text);
    const hit = CATEGORY_HINTS.find((group) => group.keys.some((key) => lower.includes(key)));
    return hit ? hit.category : '';
};

const extractBudget = (text) => {
    const raw = safeString(text);
    const match = raw.toLowerCase().match(/(?:under|below|less than|max|within)\s*(?:rs\.?|inr|₹)?\s*(\d{3,7})/i)
        || raw.match(/(?:rs\.?|inr|₹)\s*(\d{3,7})/i);
    return match ? Number(match[1]) : 0;
};

const normalizeKeyword = (message, categoryHint = '') => {
    const withoutBudget = safeString(message)
        .replace(/(?:under|below|less than|max|within)\s*(?:rs\.?|inr|₹)?\s*\d{3,7}/ig, ' ')
        .replace(/[^\w\s&'-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!withoutBudget) return '';

    const scrubbed = withoutBudget
        .replace(/\b(search|show|find|look|browse|open|view|need|want|recommend|suggest|compare|versus|vs|best|top|cheap|affordable|budget|deal|deals|discount|offer|offers|sale|flash|trending|popular|today|all|products?|items?|details?)\b/ig, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!scrubbed) return '';
    if (categoryHint && safeLower(scrubbed) === safeLower(categoryHint)) return '';
    return scrubbed;
};

const looksCommerceIntent = (message, conversationHistory = []) => {
    const composite = [message, ...conversationHistory.map((entry) => entry?.content || '')].join(' ');
    if (COMMERCE_INTENT_PATTERN.test(composite)) return true;
    return Boolean(detectCategoryHint(composite));
};

const isDemoCatalogProduct = (product = {}) => (
    product?.publishGate?.status === 'dev_only'
    || safeLower(product?.provenance?.sourceType) === 'dev_seed'
);

const formatInr = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 'INR 0';
    return `INR ${numeric.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const dedupeProducts = (products = []) => {
    const seen = new Set();
    return products.filter((product) => {
        const key = safeString(product?.id || product?._id || product?.externalId);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const attachAssistantMeta = (product = {}) => ({
    ...product,
    assistantMeta: {
        demoCatalog: isDemoCatalogProduct(product),
        trustTier: safeString(product?.provenance?.trustTier || 'unknown'),
        sourceType: safeString(product?.provenance?.sourceType || 'unknown'),
        publishStatus: safeString(product?.publishGate?.status || 'unknown'),
    },
});

const normalizeAssistantProducts = (products = []) => dedupeProducts(products).map(attachAssistantMeta);

const serializeProductForGrounding = (product = {}, index) => {
    const labels = [];
    if (product?.assistantMeta?.demoCatalog) labels.push('demo catalog');
    if (product?.assistantMeta?.trustTier) labels.push(`trust ${product.assistantMeta.trustTier}`);
    if (product?.assistantMeta?.publishStatus) labels.push(`publish ${product.assistantMeta.publishStatus}`);

    return [
        `[P${index + 1}] ${safeString(product.title || 'Untitled product')}`,
        `brand ${safeString(product.brand || 'Unknown')}`,
        `category ${safeString(product.category || 'Unknown')}`,
        `price ${formatInr(product.price)}`,
        `rating ${Number(product.rating || 0).toFixed(1)}/5 from ${Number(product.ratingCount || 0).toLocaleString('en-IN')} reviews`,
        `stock ${Number(product.stock || 0)}`,
        `delivery ${safeString(product.deliveryTime || 'unknown')}`,
        labels.join(', '),
    ].filter(Boolean).join(' | ');
};

const buildGroundingPrompt = ({ message, products = [], actionType }) => {
    if (!products.length) {
        return [
            'Grounded catalog context:',
            'No grounded catalog products matched this shopping request.',
            'If you answer a shopping question, say that no grounded store match is available yet.',
            `User request: ${safeString(message)}`,
        ].join('\n');
    }

    return [
        'Grounded catalog context:',
        'Use only the products listed below for shopping recommendations, comparisons, deals, or pricing claims.',
        'If a product is labeled demo catalog or has unverified trust, say that plainly and do not call it verified or official.',
        `Catalog action focus: ${safeString(actionType || 'search')}`,
        `User request: ${safeString(message)}`,
        'Products:',
        ...products.slice(0, MAX_RESULTS).map((product, index) => serializeProductForGrounding(product, index)),
        'If the user asks for something outside this context, say the store does not have a grounded match yet.',
    ].join('\n');
};

const runCatalogQuery = async (params = {}) => {
    const response = await queryProducts({
        category: safeString(params.category || ''),
        keyword: safeString(params.keyword || ''),
        maxPrice: params.maxPrice || undefined,
        minPrice: params.minPrice || undefined,
        discount: params.minDiscount || undefined,
        sort: safeString(params.sort || 'relevance'),
        limit: clamp(params.limit || MAX_RESULTS, 1, 12),
        includeSponsored: false,
    });

    return normalizeAssistantProducts(response?.products || []);
};

const searchProducts = async (params = {}) => runCatalogQuery({
    ...params,
    sort: params.sort || 'relevance',
});

const compareProducts = async (keyword1, keyword2, options = {}) => {
    const lhs = safeString(keyword1);
    const rhs = safeString(keyword2);
    if (!lhs || !rhs) return [];

    const [left, right] = await Promise.all([
        runCatalogQuery({
            keyword: lhs,
            maxPrice: options.maxPrice || undefined,
            limit: 1,
            sort: 'relevance',
        }),
        runCatalogQuery({
            keyword: rhs,
            maxPrice: options.maxPrice || undefined,
            limit: 1,
            sort: 'relevance',
        }),
    ]);

    return normalizeAssistantProducts([...left, ...right]).slice(0, 2);
};

const getDeals = async (params = {}) => runCatalogQuery({
    category: params.category,
    keyword: params.keyword,
    maxPrice: params.maxPrice,
    minPrice: params.minPrice,
    minDiscount: params.minDiscount || 10,
    limit: params.limit || MAX_RESULTS,
    sort: 'discount',
});

const getTrending = async (params = {}) => runCatalogQuery({
    category: params.category,
    keyword: params.keyword,
    limit: params.limit || MAX_RESULTS,
    sort: 'rating',
});

const buildGroundedCatalogContext = async ({ message, conversationHistory = [] } = {}) => {
    const safeMessage = safeString(message);
    const commerceIntent = looksCommerceIntent(safeMessage, conversationHistory);
    if (!commerceIntent) {
        return {
            commerceIntent: false,
            actionType: 'assistant',
            products: [],
            groundingPrompt: '',
            maxPrice: 0,
            category: '',
        };
    }

    const lower = safeLower(safeMessage);
    const detectedCategory = detectCategoryHint(safeMessage);
    const category = safeString(resolveCategory(detectedCategory) || detectedCategory);
    const maxPrice = extractBudget(safeMessage);
    const keyword = normalizeKeyword(safeMessage, category);
    let products = [];
    let actionType = 'search';

    if (/compare|vs|versus|better/i.test(lower)) {
        const vsMatch = safeMessage.match(/(?:compare\s+)?(.+?)\s*(?:vs|versus|and)\s+(.+)/i);
        if (vsMatch) {
            const lhs = safeString(vsMatch[1]).replace(/(?:under|below|less than|max|within).*/i, '').trim();
            const rhs = safeString(vsMatch[2]).replace(/(?:under|below|less than|max|within).*/i, '').trim();
            products = await compareProducts(lhs, rhs, { maxPrice });
            actionType = 'compare';
        }
    } else if (/deal|discount|offer|sale|cheap|affordable|budget/i.test(lower)) {
        products = await getDeals({
            category,
            keyword,
            maxPrice,
            minDiscount: 10,
            limit: MAX_RESULTS,
        });
        actionType = 'deals';
    } else if (/trend|trending|popular|best seller|hot/i.test(lower)) {
        products = await getTrending({
            category,
            keyword,
            limit: MAX_RESULTS,
        });
        actionType = 'trending';
    } else {
        products = await searchProducts({
            category,
            keyword: keyword || safeMessage,
            maxPrice,
            limit: MAX_RESULTS,
            sort: 'relevance',
        });
        actionType = 'search';
    }

    return {
        commerceIntent,
        actionType,
        products,
        groundingPrompt: buildGroundingPrompt({
            message: safeMessage,
            products,
            actionType,
        }),
        maxPrice,
        category,
        demoCatalog: products.some((product) => product?.assistantMeta?.demoCatalog),
    };
};

const executeCatalogActions = async (actions = []) => {
    let products = [];
    let actionType = 'assistant';

    for (const action of actions) {
        actionType = action.type;

        if (action.type === 'search') {
            products = await searchProducts(action.params);
        } else if (action.type === 'compare') {
            products = await compareProducts(action.params?.keyword1, action.params?.keyword2, {
                maxPrice: action.params?.maxPrice,
            });
        } else if (action.type === 'deals') {
            products = await getDeals(action.params);
        } else if (action.type === 'trending') {
            products = await getTrending(action.params);
        } else {
            actionType = 'assistant';
        }

        if (products.length > 0) break;
    }

    return {
        products,
        actionType: actions.length ? actionType : 'assistant',
    };
};

const buildCommerceFallbackResponse = async (message) => {
    const grounding = await buildGroundedCatalogContext({ message, conversationHistory: [] });
    if (!grounding.commerceIntent) return null;

    const demoNote = grounding.demoCatalog
        ? ' Results are currently sourced from the demo catalog fallback.'
        : '';
    const count = grounding.products.length;
    const budgetNote = grounding.maxPrice > 0
        ? ` under ${formatInr(grounding.maxPrice)}`
        : '';

    let text = 'I could not ground a clean store match yet.';
    if (grounding.actionType === 'compare') {
        text = count >= 2
            ? `Comparison ready. I found ${count} grounded options.${demoNote}`
            : `I could not ground a clean side-by-side comparison yet.${demoNote}`;
    } else if (grounding.actionType === 'deals') {
        text = count > 0
            ? `Found ${count} deal-focused options${budgetNote}.${demoNote}`
            : `No grounded deal matches found${budgetNote}.${demoNote}`;
    } else if (grounding.actionType === 'trending') {
        text = count > 0
            ? `Here are ${count} grounded trending picks.${demoNote}`
            : `I could not find grounded trending picks right now.${demoNote}`;
    } else {
        text = count > 0
            ? `Found ${count} grounded catalog matches${budgetNote}.${demoNote}`
            : `No grounded catalog matches found${budgetNote}.${demoNote}`;
    }

    return {
        text,
        products: grounding.products,
        actionType: grounding.actionType,
        demoCatalog: grounding.demoCatalog,
    };
};

module.exports = {
    detectCategoryHint,
    extractBudget,
    looksCommerceIntent,
    searchProducts,
    compareProducts,
    getDeals,
    getTrending,
    buildGroundedCatalogContext,
    executeCatalogActions,
    buildCommerceFallbackResponse,
};
