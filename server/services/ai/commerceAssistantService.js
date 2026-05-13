const crypto = require('crypto');
const Order = require('../../models/Order');
const Product = require('../../models/Product');
const { buildAssistantTurn, buildConfirmationToken, safeString: contractSafeString } = require('./assistantContract');
const { validateAssistantAction } = require('./assistantToolRegistry');
const {
    recordFallbackMetric,
    recordLatencyMetric,
    recordRetrievalMetric,
    recordRouteDecisionMetric,
    recordToolValidationMetric,
} = require('./assistantObservabilityService');
const logger = require('../../utils/logger');
const { CATEGORY_MAP, resolveCategory } = require('../../config/categories');
const { canonicalizeProductImageUrl } = require('../productImageResolver');
const {
    archiveAssistantThread,
    listAssistantThreads,
    loadAssistantThread,
    persistAssistantExchange,
    resetAssistantThread,
    upsertAssistantThread,
} = require('./assistantThreadPersistenceService');
const { checkModelGatewayHealth, generateStructuredJson, getModelGatewayHealth } = require('./modelGatewayService');
const { getLocalVectorIndexHealth, searchProductVectorIndex } = require('./localProductVectorIndexService');
const { buildKnowledgeAnswerText, retrieveCommerceKnowledge } = require('./commerceKnowledgeRagService');
const { getRecommendationsForAssistant: getHybridRecommendationsForAssistant } = require('../recommendationService');

const ROUTE_GENERAL = 'GENERAL';
const ROUTE_ECOMMERCE = 'ECOMMERCE_SEARCH';
const ROUTE_ACTION = 'ACTION';
const HOSTED_GEMMA_PROVIDER = 'gemini';
const HOSTED_GEMMA_MODEL_TOKEN = 'gemma';
const ACTION_ROUTE_PATTERN = /\b(add .* cart|remove .* cart|checkout|track (my )?order|order status|cancel (my )?order|return (my )?order|refund (my )?order|replace (my )?order|apply .*coupon|use .*coupon|support|open cart|show (my )?cart|go to cart|go to checkout|open checkout|open support|go to support|open orders|go to orders)\b/i;
const COMMERCE_CONTEXT_INTENTS = new Set(['product_search', 'product_selection']);
const FOLLOW_UP_REFINEMENT_PATTERN = /^(?:no\b|not\b|only\b|instead\b|more\b|another\b|else\b|different\b|similar\b|cheaper\b|budget\b|premium\b|show\b|in\b|for\b|under\b|above\b|around\b|within\b|prefer\b|want\b)/i;
const COMMERCE_COMPARISON_PATTERN = /\b(which|best|better|compare|comparison|difference|different|rating|rated|review|reviews|why|worth|spec|specs|feature|features|camera|battery|display|ram|storage|faster|slower|cheapest|highest|lowest|top)\b/i;
const GENERAL_QUESTION_PATTERN = /^(?:who|what|when|where|why|how|are|is|am|can|could|would|will|did|do)\b/i;
const SMALL_TALK_PATTERN = /^(?:hi|hello|hey|yo|thanks|thank you|ok|okay|cool|great|nice|good morning|good afternoon|good evening)(?:\s+(?:there|assistant|codex))?[!.?\s]*$/i;
const COMMERCE_KEYWORD_PATTERN = /\b(price|prices|cost|costs|product|products|item|items|phone|phones|mobile|mobiles|laptop|laptops|shoe|shoes|shirt|shirts|dress|dresses|jeans|tshirt|t-shirt|kurta|saree|jacket|fashion|clothing|apparel|footwear|compare|comparison|available|availability|stock|inventory|delivery|shipping|seller|warranty|return|returns|refund|coupon|payment|brand|brands|rupees|rs)\b/i;
const KNOWLEDGE_FIRST_COMMERCE_PATTERN = /\b(policy|policies|return|returns|refund|replacement|cancel(?:lation)? rules|warranty|support|delivery|shipping|coupon|promo|payment|size guide|manual|faq)\b/i;
const PRODUCT_DISCOVERY_VERBS_PATTERN = /\b(show|find|suggest|recommend|best|top|compare|buy|add|under|above|around|within)\b/i;
const RECOMMENDATION_INTENT_PATTERN = /\b(recommend|suggest|best|top|for me|personal|what should i buy|what to buy|goes with|with this|complete (my )?cart|add-?ons?|accessor(?:y|ies)|frequently bought|similar|related|trending|popular)\b/i;
const RETRIEVAL_SORT_VALUES = new Set(['relevance', 'rating_desc', 'price_asc', 'price_desc']);
const COMMERCE_CATEGORY_HINTS = [
    'fashion',
    'clothing',
    'apparel',
    'men',
    'women',
    'kids',
    'beauty',
    'grocery',
    'electronics',
    'mobile',
    'laptop',
    'home',
    'furniture',
    'footwear',
    'shoes',
];
const CONCRETE_PRODUCT_CATEGORY_HINTS = [
    { category: 'Laptops', query: 'laptop', terms: ['laptop', 'laptops', 'notebook', 'notebooks'] },
    { category: 'Mobiles', query: 'mobile phone', terms: ['phone', 'phones', 'mobile', 'mobiles', 'smartphone', 'smartphones'] },
    { category: 'Footwear', query: 'shoes', terms: ['shoe', 'shoes', 'sneaker', 'sneakers', 'heel', 'heels', 'slipper', 'slippers', 'sandal', 'sandals'] },
    { category: 'Fashion', query: 'fashion clothing', terms: ['shirt', 'shirts', 'dress', 'dresses', 'jeans', 'tshirt', 't-shirt', 'kurta', 'saree', 'jacket'] },
    { category: 'Books', query: 'books', terms: ['book', 'books', 'novel', 'novels'] },
];
const CATEGORY_QUERY_TEXT = {
    Laptops: 'laptop',
    Mobiles: 'mobile phone',
    Footwear: 'shoes',
    Fashion: 'fashion clothing',
    "Men's Fashion": 'men fashion clothing',
    "Women's Fashion": 'women fashion clothing',
    Books: 'books',
    Electronics: 'electronics',
    'Gaming & Accessories': 'gaming accessories',
};
const COMMERCE_BRAND_HINTS = [
    'Apple',
    'Samsung',
    'Dell',
    'HP',
    'Asus',
    'Lenovo',
    'Acer',
    'Sony',
    'LG',
    'OnePlus',
    'Xiaomi',
    'Redmi',
    'Realme',
    'Oppo',
    'Vivo',
    'Nike',
    'Adidas',
    'Puma',
    'Boat',
    'JBL',
];

const safeString = (value, fallback = '') => contractSafeString(value, fallback);
const uniq = (values = []) => [...new Set((Array.isArray(values) ? values : []).map((entry) => safeString(entry)).filter(Boolean))];
const SCHEMA_PLACEHOLDER_VALUES = new Set(['string', 'number', 'boolean', 'array', 'object', 'null']);
const APPROVE_CONFIRMATION_PATTERN = /^\s*(yes|y|ok|okay|confirm|continue|proceed|go ahead|do it|sure)\b/i;
const DECLINE_CONFIRMATION_PATTERN = /^\s*(no|n|cancel|stop|do not|don't|nope|not now)\b/i;
const hasAudioAttachments = (audio = []) => Array.isArray(audio) && audio.length > 0;
const isHostedGemmaAudioUnsupported = (gatewayHealth = {}, audio = []) => (
    hasAudioAttachments(audio)
    && safeString(gatewayHealth?.provider || '') === 'gemini'
    && gatewayHealth?.apiConfigured !== false
    && gatewayHealth?.capabilities?.audioInput === false
);
const isSchemaPlaceholder = (value = '') => {
    const normalized = safeString(value).toLowerCase();
    return SCHEMA_PLACEHOLDER_VALUES.has(normalized) || normalized.includes('...');
};
const filterPlaceholderStrings = (values = []) => uniq(values || []).filter((entry) => !isSchemaPlaceholder(entry)).slice(0, 4);
const toBooleanFlag = (value, fallback = false) => {
    const normalized = safeString(value).toLowerCase();
    if (!normalized) return fallback;
    return !['false', '0', 'no', 'off'].includes(normalized);
};
const isHostedGemmaCommerceRequired = () => toBooleanFlag(process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA, false);
const isCommerceModelSummaryEnabled = ({ requireHostedGemma = false } = {}) => (
    Boolean(requireHostedGemma)
    || toBooleanFlag(process.env.ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED, false)
);
const buildCommerceModelProviderOptions = (requireHostedGemma = false) => (
    requireHostedGemma
        ? { provider: HOSTED_GEMMA_PROVIDER, disableProviderFallback: true }
        : {}
);
const isGemmaModel = (modelName = '') => safeString(modelName).toLowerCase().includes(HOSTED_GEMMA_MODEL_TOKEN);
const isHostedGemmaGatewayHealthy = (gatewayHealth = {}) => (
    safeString(gatewayHealth?.activeProvider || gatewayHealth?.provider || '').toLowerCase() === HOSTED_GEMMA_PROVIDER
    && gatewayHealth?.healthy === true
    && gatewayHealth?.apiConfigured !== false
    && isGemmaModel(gatewayHealth?.resolvedChatModel || gatewayHealth?.chatModel || '')
);

const createTraceId = () => (typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.createHash('sha256').update(`${Date.now()}-${Math.random().toString(36).slice(2)}`).digest('hex').slice(0, 24));
const createSessionId = () => `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createMessageId = () => `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const PRODUCT_CARD_SELECT = 'id title displayTitle brand category price originalPrice discountPercentage image images stock rating ratingCount titleKey description highlights specifications';
const MEDIA_LOOKUP_QUERY_KEYS = new Set(['q', 'query', 'product', 'productname', 'product_name', 'title', 'slug', 'name']);
const MEDIA_PRODUCT_ID_QUERY_KEYS = new Set(['pid', 'productid', 'product_id', 'product-id', 'itemid', 'item_id']);
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"')]+/gi;
const GENERIC_MEDIA_QUERY_VALUES = new Set(['image', 'images', 'photo', 'photos', 'picture', 'product', 'products', 'item', 'items', 'upload', 'uploads']);
const COMMERCE_COLOR_TERMS = ['black', 'white', 'blue', 'red', 'green', 'pink', 'brown', 'grey', 'gray', 'silver', 'gold', 'beige', 'purple', 'yellow', 'orange', 'navy'];
const COMMERCE_MATERIAL_TERMS = ['cotton', 'leather', 'denim', 'silk', 'wool', 'linen', 'mesh', 'wood', 'wooden', 'metal', 'plastic', 'steel'];

const normalizeProductCard = (product = {}) => ({
    id: Number(product?.id || 0),
    title: safeString(product?.displayTitle || product?.title || ''),
    brand: safeString(product?.brand || ''),
    category: safeString(product?.category || ''),
    price: Number(product?.price || 0),
    originalPrice: Number(product?.originalPrice || product?.price || 0),
    discountPercentage: Number(product?.discountPercentage || 0),
    image: safeString(product?.image || ''),
    stock: Math.max(0, Number(product?.stock || 0)),
    rating: Number(product?.rating || 0),
    ratingCount: Math.max(0, Number(product?.ratingCount || 0)),
    description: safeString(product?.description || ''),
    highlights: Array.isArray(product?.highlights) ? product.highlights.map((entry) => safeString(entry)).filter(Boolean).slice(0, 8) : [],
    specifications: Array.isArray(product?.specifications)
        ? product.specifications.map((entry) => ({
            key: safeString(entry?.key || ''),
            value: safeString(entry?.value || ''),
        })).filter((entry) => entry.key && entry.value).slice(0, 12)
        : [],
    assistantRank: Math.max(0, Number(product?.assistantRank || 0)),
    assistantReason: safeString(product?.assistantReason || product?.reason || ''),
    assistantWatchout: safeString(product?.assistantWatchout || product?.watchout || ''),
});
const normalizeRetrievalSortBy = (value = '') => {
    const normalized = safeString(value).toLowerCase();
    return RETRIEVAL_SORT_VALUES.has(normalized) ? normalized : '';
};
const parsePositiveCurrency = (value = '') => {
    const normalized = safeString(value).replace(/,/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
const matchesWholeTerm = (normalizedValue = '', term = '') => (
    new RegExp(`\\b${String(term || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(normalizedValue)
);
const findConcreteProductCategoryHint = (value = '') => {
    const normalized = safeString(value).toLowerCase();
    if (!normalized) return null;
    return CONCRETE_PRODUCT_CATEGORY_HINTS.find((entry) => (
        entry.terms.some((term) => matchesWholeTerm(normalized, term))
    )) || null;
};
const inferBrandFromMessage = (value = '') => {
    const normalized = safeString(value).toLowerCase();
    if (!normalized) return '';
    const matchedBrand = COMMERCE_BRAND_HINTS.find((brand) => matchesWholeTerm(normalized, brand));
    return safeString(matchedBrand || '');
};
const resolveCategoryQueryText = (category = '') => {
    const safeCategory = safeString(category);
    return safeString(CATEGORY_QUERY_TEXT[safeCategory] || safeCategory.replace(/&/g, ' ').toLowerCase());
};
const inferCanonicalCategory = (value = '') => {
    const normalized = safeString(value).toLowerCase();
    if (!normalized) return '';

    const concreteCategory = findConcreteProductCategoryHint(normalized);
    if (concreteCategory?.category) return concreteCategory.category;

    const synonymMap = new Map([
        ['fashion', 'Fashion'],
        ['clothing', 'Fashion'],
        ['apparel', 'Fashion'],
        ['shirt', 'Fashion'],
        ['shirts', 'Fashion'],
        ['dress', 'Fashion'],
        ['dresses', 'Fashion'],
        ['jeans', 'Fashion'],
        ['tshirt', 'Fashion'],
        ['t-shirt', 'Fashion'],
        ['kurta', 'Fashion'],
        ['saree', 'Fashion'],
        ['jacket', 'Fashion'],
        ['menswear', "Men's Fashion"],
        ['men fashion', "Men's Fashion"],
        ['mens fashion', "Men's Fashion"],
        ["men's fashion", "Men's Fashion"],
        ['men', "Men's Fashion"],
        ['womenswear', "Women's Fashion"],
        ['women fashion', "Women's Fashion"],
        ['womens fashion', "Women's Fashion"],
        ["women's fashion", "Women's Fashion"],
        ['women', "Women's Fashion"],
        ['shoe', 'Footwear'],
        ['shoes', 'Footwear'],
        ['heel', 'Footwear'],
        ['heels', 'Footwear'],
        ['slipper', 'Footwear'],
        ['slippers', 'Footwear'],
        ['sandals', 'Footwear'],
        ['phone', 'Mobiles'],
        ['phones', 'Mobiles'],
        ['mobile', 'Mobiles'],
        ['mobiles', 'Mobiles'],
        ['laptop', 'Laptops'],
        ['laptops', 'Laptops'],
        ['book', 'Books'],
        ['books', 'Books'],
    ]);
    const candidates = uniq([
        ...Object.keys(CATEGORY_MAP),
        ...Object.values(CATEGORY_MAP),
        ...synonymMap.keys(),
    ]).sort((left, right) => right.length - left.length);

    for (const candidate of candidates) {
        if (!candidate) continue;
        if (normalized.includes(candidate.toLowerCase())) {
            if (synonymMap.has(candidate.toLowerCase())) {
                return synonymMap.get(candidate.toLowerCase()) || '';
            }
            return safeString(resolveCategory(candidate) || candidate);
        }
    }
    return '';
};
const buildHeuristicRetrievalQueryText = ({ message = '', filters = {} } = {}) => {
    const brand = safeString(filters?.brand || '');
    const category = safeString(filters?.category || '');
    const concreteCategory = findConcreteProductCategoryHint(message);
    const categoryQuery = concreteCategory?.query || resolveCategoryQueryText(category);
    const requiredTerms = Array.isArray(filters?.requiredTerms)
        ? filters.requiredTerms.map((entry) => safeString(entry).toLowerCase()).filter(Boolean).slice(0, 4)
        : [];
    const queryParts = uniq([
        brand,
        categoryQuery,
        ...requiredTerms,
    ]);
    return safeString(queryParts.length > 0 ? queryParts.join(' ') : message);
};
const extractRequiredTerms = ({ payload = {}, message = '' } = {}) => {
    const normalizedMessage = safeString(message).toLowerCase();
    const payloadTerms = Array.isArray(payload?.requiredTerms)
        ? payload.requiredTerms
        : (Array.isArray(payload?.attributes) ? payload.attributes : []);
    const terms = new Set(payloadTerms.map((entry) => safeString(entry).toLowerCase()).filter(Boolean));

    COMMERCE_COLOR_TERMS.forEach((color) => {
        if (new RegExp(`\\b${color}\\b`, 'i').test(normalizedMessage)) {
            terms.add(color);
        }
    });

    COMMERCE_MATERIAL_TERMS.forEach((material) => {
        if (new RegExp(`\\b${material}\\b`, 'i').test(normalizedMessage)) {
            terms.add(material);
        }
    });

    const sizeMatch = normalizedMessage.match(/\bsize\s*([0-9]{1,2}|xxl|xl|xs|s|m|l)\b/i);
    if (sizeMatch?.[1]) {
        terms.add(`size ${safeString(sizeMatch[1]).toLowerCase()}`);
    }

    const storageMatches = normalizedMessage.match(/\b\d+\s*(?:gb|tb)\b/gi) || [];
    storageMatches.forEach((entry) => {
        const match = safeString(entry).toLowerCase().match(/^(\d+)\s*(gb|tb)$/);
        if (match) {
            terms.add(`${match[1]} ${match[2]}`);
        }
    });

    if (/\bram\b/i.test(normalizedMessage)) {
        terms.add('ram');
    }
    if (/\bstorage\b/i.test(normalizedMessage)) {
        terms.add('storage');
    }

    return uniq([...terms]).slice(0, 8);
};
const inferStructuredRetrievalFilters = ({ payload = {}, message = '', assistantSession = {} } = {}) => {
    const safeMessage = safeString(message);
    const normalizedMessage = safeMessage.toLowerCase();
    const lastEntities = assistantSession?.lastEntities || {};
    const inferred = {
        category: safeString(payload?.category || ''),
        brand: safeString(payload?.brand || ''),
        minPrice: parsePositiveCurrency(payload?.minPrice || 0),
        maxPrice: parsePositiveCurrency(payload?.maxPrice || 0),
        minRating: 0,
        inStock: typeof payload?.inStock === 'boolean' ? payload.inStock : null,
        sortBy: normalizeRetrievalSortBy(payload?.sortBy || ''),
        requiredTerms: extractRequiredTerms({ payload, message: safeMessage }),
    };

    const rawMinRating = Number(payload?.minRating || 0);
    if (Number.isFinite(rawMinRating) && rawMinRating > 0) {
        inferred.minRating = Math.min(5, Math.max(0, rawMinRating));
    }

    if (!inferred.category) {
        const explicitCategory = inferCanonicalCategory(safeMessage);
        const hasExplicitCategoryHint = Boolean(extractCommerceCategoryHint(safeMessage));
        const canReuseLastCategory = !hasExplicitCategoryHint && shouldRouteAsCommerceFollowUp({
            message: safeMessage,
            assistantSession,
        });
        inferred.category = explicitCategory || (canReuseLastCategory ? safeString(lastEntities?.category || '') : '');
    } else {
        inferred.category = safeString(resolveCategory(inferred.category) || inferred.category);
    }

    if (!inferred.brand) {
        inferred.brand = inferBrandFromMessage(safeMessage);
    }

    if (!inferred.maxPrice) {
        const maxPriceMatch = normalizedMessage.match(/\b(?:under|below|within|less than|up to)\s*(?:rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)\b/i);
        inferred.maxPrice = parsePositiveCurrency(maxPriceMatch?.[1] || lastEntities?.maxPrice || 0);
    }

    if (!inferred.minPrice) {
        const minPriceMatch = normalizedMessage.match(/\b(?:above|over|more than)\s*(?:rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)\b/i);
        inferred.minPrice = parsePositiveCurrency(minPriceMatch?.[1] || 0);
    }

    if (!inferred.minRating) {
        const ratingMatch = normalizedMessage.match(/\b([1-5](?:\.\d)?)\s*(?:star|stars|rating)\b/i);
        if (ratingMatch?.[1]) {
            inferred.minRating = Math.min(5, Math.max(0, Number(ratingMatch[1])));
        }
    }

    if (inferred.inStock === null) {
        if (/\b(?:in stock|available now|ready to ship)\b/i.test(normalizedMessage)) {
            inferred.inStock = true;
        } else if (/\b(?:out of stock|unavailable|sold out)\b/i.test(normalizedMessage)) {
            inferred.inStock = false;
        }
    }

    if (!inferred.sortBy) {
        if (/\b(?:top rated|best rated|highest rated)\b/i.test(normalizedMessage)) {
            inferred.sortBy = 'rating_desc';
        } else if (/\b(?:cheaper|cheapest|lowest price|budget)\b/i.test(normalizedMessage)) {
            inferred.sortBy = 'price_asc';
        } else if (/\b(?:premium|expensive|high end|luxury)\b/i.test(normalizedMessage)) {
            inferred.sortBy = 'price_desc';
        }
    }

    if (inferred.maxPrice > 0 && inferred.minPrice > inferred.maxPrice) {
        [inferred.minPrice, inferred.maxPrice] = [inferred.maxPrice, inferred.minPrice];
    }

    return {
        category: safeString(inferred.category || ''),
        brand: safeString(inferred.brand || ''),
        minPrice: Number(inferred.minPrice || 0),
        maxPrice: Number(inferred.maxPrice || 0),
        minRating: Number(inferred.minRating || 0),
        inStock: typeof inferred.inStock === 'boolean' ? inferred.inStock : null,
        sortBy: normalizeRetrievalSortBy(inferred.sortBy || ''),
        requiredTerms: Array.isArray(inferred.requiredTerms) ? inferred.requiredTerms : [],
    };
};
const hasActiveRetrievalFilters = (filters = {}) => Boolean(
    safeString(filters?.category || '')
    || safeString(filters?.brand || '')
    || Number(filters?.minPrice || 0) > 0
    || Number(filters?.maxPrice || 0) > 0
    || Number(filters?.minRating || 0) > 0
    || typeof filters?.inStock === 'boolean'
    || normalizeRetrievalSortBy(filters?.sortBy || '')
    || Array.isArray(filters?.requiredTerms) && filters.requiredTerms.length > 0
);
const matchesCategoryFilter = (requestedCategory = '', productCategory = '') => {
    const normalizedCategory = safeString(requestedCategory || '').toLowerCase();
    const normalizedProductCategory = safeString(productCategory || '').toLowerCase();
    if (!normalizedCategory) return true;
    if (!normalizedProductCategory) return false;
    return normalizedProductCategory === normalizedCategory || normalizedProductCategory.includes(normalizedCategory);
};
const matchesRetrievalFilters = (product = {}, filters = {}) => {
    const normalizedCategory = safeString(filters?.category || '').toLowerCase();
    const normalizedBrand = safeString(filters?.brand || '').toLowerCase();
    const price = Number(product?.price || 0);
    const stock = Math.max(0, Number(product?.stock || 0));
    const rating = Number(product?.rating || 0);
    const searchable = [
        product?.title,
        product?.displayTitle,
        product?.brand,
        product?.category,
        product?.description,
        ...(Array.isArray(product?.highlights) ? product.highlights : []),
        ...(Array.isArray(product?.specifications) ? product.specifications.map((entry) => `${entry?.key || ''} ${entry?.value || ''}`) : []),
    ].map((entry) => safeString(entry).toLowerCase()).join(' ');

    if (normalizedCategory) {
        if (!matchesCategoryFilter(normalizedCategory, product?.category)) {
            return false;
        }
    }
    if (normalizedBrand) {
        const productBrand = safeString(product?.brand || '').toLowerCase();
        if (!(productBrand === normalizedBrand || productBrand.includes(normalizedBrand))) {
            return false;
        }
    }
    if (Number(filters?.minPrice || 0) > 0 && price < Number(filters.minPrice || 0)) {
        return false;
    }
    if (Number(filters?.maxPrice || 0) > 0 && price > Number(filters.maxPrice || 0)) {
        return false;
    }
    if (Number(filters?.minRating || 0) > 0 && rating < Number(filters.minRating || 0)) {
        return false;
    }
    if (filters?.inStock === true && stock <= 0) {
        return false;
    }
    if (filters?.inStock === false && stock > 0) {
        return false;
    }
    if (Array.isArray(filters?.requiredTerms) && filters.requiredTerms.length > 0) {
        const missingTerm = filters.requiredTerms.find((term) => {
            const normalizedTerm = safeString(term).toLowerCase();
            if (!normalizedTerm) return false;
            if (searchable.includes(normalizedTerm)) return false;
            const termTokens = normalizedTerm.split(/\s+/).filter(Boolean);
            return !termTokens.every((token) => searchable.includes(token));
        });
        if (missingTerm) {
            return false;
        }
    }
    return true;
};
const normalizeLookupText = (value = '') => safeString(value)
    .normalize('NFKC')
    .replace(/%20/gi, ' ')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/^\d+px-/i, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bnew\s+/i, '')
    .trim()
    .toLowerCase();
const escapeRegExp = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isMeaningfulMediaQuery = (value = '') => {
    const normalized = normalizeLookupText(value);
    if (!normalized || normalized.length < 3) return false;
    if (!/[a-z]/i.test(normalized)) return false;
    return !GENERIC_MEDIA_QUERY_VALUES.has(normalized);
};
const sanitizeMediaQuery = (value = '') => {
    const normalized = normalizeLookupText(value);
    return isMeaningfulMediaQuery(normalized) ? normalized : '';
};
const extractUrlsFromText = (value = '') => uniq((safeString(value).match(URL_PATTERN) || []));
const parsePositiveInteger = (value = '') => {
    const normalized = safeString(value);
    if (!/^\d{3,12}$/.test(normalized)) return 0;
    const parsed = Number(normalized);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};
const createProductLookupResults = (products = [], {
    reason = '',
    provider = 'catalog_lookup',
    scoreBase = 0.99,
} = {}) => ({
    results: (Array.isArray(products) ? products : []).map((product, index) => ({
        product,
        score: Math.max(0.5, Number(scoreBase) - (index * 0.02)),
    })),
    retrievalHitCount: Array.isArray(products) ? products.length : 0,
    provider,
    fallbackUsed: false,
    fallbackReason: safeString(reason || 'direct_catalog_lookup'),
});
const shouldReuseSessionResultsForCommerce = ({ message = '', assistantSession = {} } = {}) => {
    const normalized = safeString(message).toLowerCase();
    if (!normalized || !Array.isArray(assistantSession?.lastResults) || assistantSession.lastResults.length === 0) {
        return false;
    }
    if (COMMERCE_COMPARISON_PATTERN.test(normalized)) return true;
    return /\b(which one|this one|that one|first one|second one|third one|among these|among them)\b/i.test(normalized);
};
const shouldAnswerKnowledgeBeforeCatalog = ({
    message = '',
    images = [],
    audio = [],
    assistantSession = {},
} = {}) => {
    const normalized = safeString(message).toLowerCase();
    if (!normalized) return false;
    if ((Array.isArray(images) && images.length > 0) || (Array.isArray(audio) && audio.length > 0)) return false;
    if (hasRecentCommerceContext(assistantSession) && PRODUCT_DISCOVERY_VERBS_PATTERN.test(normalized)) return false;
    if (!KNOWLEDGE_FIRST_COMMERCE_PATTERN.test(normalized)) return false;
    return !PRODUCT_DISCOVERY_VERBS_PATTERN.test(normalized) || /\b(policy|faq|rules|how|what|when|where|can i|do you)\b/i.test(normalized);
};
const extractMediaLookupHints = ({
    message = '',
    images = [],
    context = {},
} = {}) => {
    const productIds = new Set();
    const imageUrls = new Set();
    const queryCandidates = new Set();
    const titleCandidates = new Set();

    const pushProductId = (value = '') => {
        const numericId = parsePositiveInteger(value);
        if (numericId > 0) {
            productIds.add(String(numericId));
        }
    };
    const pushImageUrl = (value = '') => {
        const canonical = safeString(canonicalizeProductImageUrl(value));
        if (canonical) {
            imageUrls.add(canonical);
        }
    };
    const pushQueryCandidate = (value = '') => {
        const sanitized = sanitizeMediaQuery(value);
        if (!sanitized) return;
        queryCandidates.add(sanitized);
        titleCandidates.add(sanitized);
    };
    const inspectUrl = (value = '') => {
        const canonical = safeString(canonicalizeProductImageUrl(value));
        if (!canonical) return;
        pushImageUrl(canonical);

        try {
            const parsed = new URL(canonical);
            parsed.searchParams.forEach((entryValue, entryKey) => {
                const normalizedKey = safeString(entryKey).toLowerCase();
                if (MEDIA_PRODUCT_ID_QUERY_KEYS.has(normalizedKey)) {
                    pushProductId(entryValue);
                }
                if (MEDIA_LOOKUP_QUERY_KEYS.has(normalizedKey)) {
                    pushQueryCandidate(entryValue);
                }
            });

            const segments = parsed.pathname
                .split('/')
                .map((segment) => safeString(decodeURIComponent(segment)))
                .filter(Boolean);

            segments.forEach((segment, index) => {
                const normalizedSegment = safeString(segment).toLowerCase();
                if (['product', 'products', 'item', 'items', 'pid'].includes(normalizedSegment)) {
                    pushProductId(segments[index + 1] || '');
                }
            });

            const basename = safeString(segments[segments.length - 1] || '');
            if (basename) {
                pushQueryCandidate(basename);
            }

            const penultimate = safeString(segments[segments.length - 2] || '');
            if (penultimate && !['uploads', 'images', 'product-images', 'api', 'products', 'media'].includes(penultimate.toLowerCase())) {
                pushQueryCandidate(`${penultimate} ${basename}`);
            }
        } catch {
            pushQueryCandidate(canonical);
        }
    };

    pushProductId(context?.currentProductId || '');
    (Array.isArray(context?.candidateProductIds) ? context.candidateProductIds : []).forEach((entry) => pushProductId(entry));
    extractUrlsFromText(message).forEach((url) => inspectUrl(url));
    (Array.isArray(images) ? images : []).forEach((image) => {
        inspectUrl(image?.url || '');
        pushQueryCandidate(image?.alt || image?.label || image?.name || '');
    });
    pushQueryCandidate(message);

    return {
        productIds: [...productIds],
        imageUrls: [...imageUrls],
        queryCandidates: [...queryCandidates],
        titleCandidates: [...titleCandidates],
    };
};
const loadDirectProductsFromMediaHints = async ({
    mediaHints = {},
    limit = 5,
} = {}) => {
    const safeLimit = Math.max(1, Number(limit || 5));
    const numericIds = uniq((mediaHints?.productIds || []).map((entry) => safeString(entry)))
        .map((entry) => parsePositiveInteger(entry))
        .filter((entry) => entry > 0);

    if (numericIds.length > 0) {
        const products = await Product.find({
            id: { $in: numericIds },
            isPublished: true,
        })
            .select(PRODUCT_CARD_SELECT)
            .lean();
        const byId = new Map(products.map((product) => [Number(product.id), product]));
        const ordered = numericIds.map((id) => byId.get(id)).filter(Boolean).slice(0, safeLimit);
        if (ordered.length > 0) {
            return createProductLookupResults(ordered, { reason: 'direct_product_id' });
        }
    }

    const imageUrls = uniq(mediaHints?.imageUrls || []);
    if (imageUrls.length > 0) {
        const products = await Product.find({
            isPublished: true,
            $or: [
                { image: { $in: imageUrls } },
                { images: { $in: imageUrls } },
            ],
        })
            .limit(safeLimit)
            .select(PRODUCT_CARD_SELECT)
            .lean();
        if (products.length > 0) {
            return createProductLookupResults(products, { reason: 'direct_image_url' });
        }
    }

    const titleCandidates = uniq((mediaHints?.titleCandidates || []).map((entry) => sanitizeMediaQuery(entry)).filter(Boolean));
    if (titleCandidates.length > 0) {
        const exactProducts = await Product.find({
            isPublished: true,
            titleKey: { $in: titleCandidates },
        })
            .limit(safeLimit)
            .select(PRODUCT_CARD_SELECT)
            .lean();
        if (exactProducts.length > 0) {
            const seenProductIds = new Set();
            const rankedExact = titleCandidates
                .map((titleKey) => exactProducts.find((product) => safeString(product?.titleKey || '').toLowerCase() === titleKey))
                .filter((product) => {
                    const productId = safeString(product?.id || '');
                    if (!productId || seenProductIds.has(productId)) return false;
                    seenProductIds.add(productId);
                    return true;
                });
            return createProductLookupResults(rankedExact, { reason: 'direct_title_key' });
        }

        for (const titleCandidate of titleCandidates.slice(0, 3)) {
            const pattern = new RegExp(escapeRegExp(titleCandidate).replace(/\s+/g, '\\s+'), 'i');
            const products = await Product.find({
                isPublished: true,
                $or: [
                    { titleKey: pattern },
                    { title: pattern },
                    { displayTitle: pattern },
                ],
            })
                .limit(safeLimit)
                .select(PRODUCT_CARD_SELECT)
                .lean();
            if (products.length > 0) {
                return createProductLookupResults(products, { reason: 'direct_title_partial' });
            }
        }
    }

    return {
        results: [],
        retrievalHitCount: 0,
        provider: 'catalog_lookup',
        fallbackUsed: false,
        fallbackReason: 'no_direct_media_match',
    };
};
const buildMediaHintQuery = (mediaHints = {}, fallback = '') => (
    safeString(mediaHints?.queryCandidates?.[0] || fallback || '')
);

const hasRecentCommerceContext = (assistantSession = {}) => (
    COMMERCE_CONTEXT_INTENTS.has(safeString(assistantSession?.lastIntent || ''))
    || Array.isArray(assistantSession?.lastResults) && assistantSession.lastResults.length > 0
    || Boolean(assistantSession?.activeProduct?.id)
    || Boolean(safeString(assistantSession?.lastEntities?.query || ''))
);

const extractCommerceCategoryHint = (message = '') => {
    const normalized = safeString(message).toLowerCase();
    if (!normalized) return '';
    return COMMERCE_CATEGORY_HINTS.find((hint) => new RegExp(`\\b${escapeRegExp(hint)}\\b`, 'i').test(normalized)) || '';
};

const shouldRouteAsCommerceFollowUp = ({ message = '', assistantSession = {} } = {}) => {
    const normalized = safeString(message).toLowerCase();
    if (!normalized || !hasRecentCommerceContext(assistantSession)) return false;
    if (COMMERCE_COMPARISON_PATTERN.test(normalized)) return true;
    if (GENERAL_QUESTION_PATTERN.test(normalized)) return false;
    if (extractCommerceCategoryHint(normalized)) return true;
    if (FOLLOW_UP_REFINEMENT_PATTERN.test(normalized)) return true;
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    return wordCount <= 6 && /\b(section|category|options?|results?|products?|items?)\b/i.test(normalized);
};

const shouldUseContextualCommercePlanner = ({
    message = '',
    assistantSession = {},
    conversationHistory = [],
} = {}) => {
    const normalized = safeString(message).toLowerCase();
    if (!normalized || !hasRecentCommerceContext(assistantSession)) return false;
    if (COMMERCE_COMPARISON_PATTERN.test(normalized)) return true;
    if (GENERAL_QUESTION_PATTERN.test(normalized)) return false;
    if (extractCommerceCategoryHint(normalized)) return true;
    if (FOLLOW_UP_REFINEMENT_PATTERN.test(normalized)) return true;
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    return wordCount <= 8 && Array.isArray(conversationHistory) && conversationHistory.length > 0;
};

const normalizeAssistantSession = (session = {}, sessionId = '') => ({
    sessionId: safeString(session?.sessionId || sessionId),
    contextVersion: Math.max(0, Number(session?.contextVersion || 0)),
    lastIntent: safeString(session?.lastIntent || ''),
    lastEntities: {
        query: safeString(session?.lastEntities?.query || ''),
        productId: safeString(session?.lastEntities?.productId || ''),
        category: safeString(session?.lastEntities?.category || ''),
        maxPrice: Number(session?.lastEntities?.maxPrice || 0),
        quantity: Number(session?.lastEntities?.quantity || 0),
        orderId: safeString(session?.lastEntities?.orderId || ''),
    },
    contextPath: safeString(session?.contextPath || ''),
    pendingAction: session?.pendingAction && typeof session.pendingAction === 'object' ? session.pendingAction : null,
    clarificationState: session?.clarificationState && typeof session.clarificationState === 'object'
        ? session.clarificationState
        : { fingerprint: '', count: 0, lastQuestion: '' },
    lastResolvedEntityId: safeString(session?.lastResolvedEntityId || ''),
    lastResults: Array.isArray(session?.lastResults) ? session.lastResults.map((entry) => normalizeProductCard(entry)).filter((entry) => entry.id) : [],
    activeProduct: session?.activeProduct ? normalizeProductCard(session.activeProduct) : null,
});

const buildSessionMemory = (assistantSession = {}) => ({
    lastQuery: safeString(assistantSession?.lastEntities?.query || ''),
    lastResults: Array.isArray(assistantSession?.lastResults) ? assistantSession.lastResults : [],
    activeProduct: assistantSession?.activeProduct || null,
    lastIntent: safeString(assistantSession?.lastIntent || ''),
    currentIntent: safeString(assistantSession?.lastIntent || ''),
    clarificationState: assistantSession?.clarificationState || { fingerprint: '', count: 0, lastQuestion: '' },
});

const RETRIEVAL_QUERY_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        query: { type: 'string' },
        category: { type: 'string' },
        brand: { type: 'string' },
        minPrice: { type: 'number' },
        maxPrice: { type: 'number' },
        minRating: { type: 'number' },
        inStock: { type: 'boolean' },
        sortBy: { type: 'string', enum: [...RETRIEVAL_SORT_VALUES] },
        requiredTerms: {
            type: 'array',
            items: { type: 'string' },
        },
        followUps: {
            type: 'array',
            items: { type: 'string' },
        },
    },
    required: ['query'],
};

const GENERAL_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        answer: { type: 'string' },
        followUps: {
            type: 'array',
            items: { type: 'string' },
        },
    },
    required: ['answer'],
};

const COMMERCE_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        answer: { type: 'string' },
        productIds: {
            type: 'array',
            items: { type: 'string' },
        },
        focusProductId: { type: 'string' },
        followUps: {
            type: 'array',
            items: { type: 'string' },
        },
    },
    required: ['answer', 'productIds'],
};

const buildGrounding = ({
    assistantMode = 'chat',
    route = ROUTE_GENERAL,
    provider = 'rule',
    providerModel = '',
    retrievalHitCount = 0,
    sessionId = '',
    traceId = '',
    status = 'completed',
    health = {},
    validator = {},
} = {}) => ({
    mode: safeString(assistantMode || 'chat'),
    route: safeString(route || ROUTE_GENERAL),
    provider: safeString(provider || 'rule'),
    providerModel: safeString(providerModel || ''),
    retrievalHitCount: Math.max(0, Number(retrievalHitCount || 0)),
    sessionId: safeString(sessionId || ''),
    traceId: safeString(traceId || ''),
    status: safeString(status || 'completed'),
    health,
    validator,
});

const buildResponseEnvelope = ({
    assistantTurn,
    route,
    provider = 'rule',
    providerModel = '',
    products = [],
    followUps = [],
    sessionId = '',
    traceId = '',
    assistantMode = 'chat',
    assistantSession = {},
    health = {},
    providerCapabilities = null,
    retrievalHitCount = 0,
    validator = {},
    messageId = '',
} = {}) => ({
    answer: safeString(assistantTurn?.response || ''),
    products,
    actions: Array.isArray(assistantTurn?.actions) ? assistantTurn.actions : [],
    followUps,
    assistantTurn,
    grounding: buildGrounding({
        assistantMode,
        route,
        provider,
        providerModel,
        retrievalHitCount,
        sessionId,
        traceId,
        health,
        validator,
    }),
    provider,
    providerModel,
    providerInfo: { name: provider, model: providerModel },
    providerCapabilities: providerCapabilities || health?.gateway?.capabilities || null,
    route,
    traceId,
    sessionId,
    messageId,
    assistantSession,
    sessionMemory: buildSessionMemory(assistantSession),
    provisional: false,
    upgradeEligible: false,
});

const buildHostedGemmaUnavailableEnvelope = ({
    message = '',
    sessionId = '',
    traceId = '',
    assistantMode = 'chat',
    assistantSession = {},
    gatewayHealth = {},
    vectorStoreHealth = null,
    reason = 'hosted_gemma_required',
    products = [],
    retrieval = null,
    retrievalQuery = null,
    retrievalRelaxation = null,
} = {}) => {
    const normalizedProducts = decorateCommerceProducts(products, retrievalQuery?.filters || {})
        .filter((product) => product.id)
        .slice(0, 3);
    const focusProduct = normalizedProducts[0] || null;
    const followUps = normalizedProducts.length > 0
        ? ['Retry with hosted Gemma', 'Compare these matches later', 'Ask for another category']
        : ['Retry with hosted Gemma', 'Try another category', 'Check again shortly'];
    const unavailableAnswer = normalizedProducts.length > 0
        ? 'Hosted Gemma commerce reasoning is temporarily unavailable, so I am showing validated catalog matches without downgrading to a weaker shopping answer.'
        : 'Hosted Gemma commerce reasoning is temporarily unavailable right now, so I am not downgrading this commerce answer to a weaker provider. Please retry shortly.';
    const assistantTurn = buildAssistantTurn({
        intent: 'product_search',
        confidence: 0.76,
        decision: 'respond',
        response: buildCommerceResponseText({
            answer: unavailableAnswer,
            products: normalizedProducts,
            filters: retrievalQuery?.filters || {},
            relaxation: retrievalRelaxation,
        }),
        followUps,
        ui: {
            surface: normalizedProducts.length > 0 ? (normalizedProducts.length === 1 ? 'product_focus' : 'product_results') : 'plain_answer',
            title: normalizedProducts.length > 0 ? 'Validated matches pending hosted Gemma' : 'Hosted Gemma temporarily unavailable',
            products: normalizedProducts,
            product: normalizedProducts.length === 1 ? focusProduct : null,
            insights: buildCommerceResultInsights(normalizedProducts, retrievalQuery?.filters || {}, retrievalRelaxation),
        },
        verification: {
            label: 'provider_temporarily_unavailable',
            confidence: 1,
            summary: 'Hosted Gemma commerce reasoning is required for this route, so the assistant refused to downgrade to a weaker provider or local summary.',
        },
        toolRuns: normalizedProducts.length > 0 ? [{
            id: `retrieval-${Date.now()}`,
            toolName: 'search_products',
            status: 'completed',
            latencyMs: 0,
            summary: `${Math.max(0, Number(retrieval?.retrievalHitCount || normalizedProducts.length))} catalog hits`,
            inputPreview: { query: safeString(retrievalQuery?.query || message) },
            outputPreview: { productIds: normalizedProducts.map((product) => String(product.id)) },
        }] : [],
        answerMode: 'commerce',
    });

    return buildResponseEnvelope({
        assistantTurn,
        route: ROUTE_ECOMMERCE,
        provider: HOSTED_GEMMA_PROVIDER,
        providerModel: safeString(gatewayHealth?.resolvedChatModel || gatewayHealth?.chatModel || ''),
        products: normalizedProducts,
        followUps,
        sessionId,
        traceId,
        assistantMode,
        assistantSession: {
            ...assistantSession,
            lastIntent: 'product_search',
            lastEntities: {
                ...assistantSession.lastEntities,
                query: safeString(retrievalQuery?.query || message),
                productId: safeString(focusProduct?.id || ''),
                category: safeString(retrievalQuery?.filters?.category || focusProduct?.category || ''),
                maxPrice: Number(retrievalQuery?.filters?.maxPrice || assistantSession?.lastEntities?.maxPrice || 0),
            },
            lastResolvedEntityId: safeString(focusProduct?.id || ''),
            lastResults: normalizedProducts,
            activeProduct: focusProduct,
            pendingAction: null,
        },
        health: {
            gateway: gatewayHealth,
            vectorStore: vectorStoreHealth,
        },
        providerCapabilities: gatewayHealth?.capabilities || null,
        retrievalHitCount: Math.max(0, Number(retrieval?.retrievalHitCount || normalizedProducts.length)),
        validator: {
            ok: false,
            reason: safeString(reason || 'hosted_gemma_required'),
            requiredProvider: HOSTED_GEMMA_PROVIDER,
            retrievalQuery: retrievalQuery?.validator || null,
            retrievalProvider: safeString(retrieval?.provider || ''),
            retrievalReason: safeString(retrieval?.fallbackReason || ''),
            retrievalRelaxation: retrievalRelaxation ? {
                reason: retrievalRelaxation.reason,
                label: retrievalRelaxation.label,
            } : null,
        },
        messageId: createMessageId(),
    });
};

const detectRoute = ({
    message = '',
    actionRequest = null,
    confirmation = null,
    context = {},
    assistantSession = {},
    images = [],
    audio = [],
} = {}) => {
    if (confirmation?.actionId || actionRequest?.type) return { route: ROUTE_ACTION, reason: 'action' };
    if ((Array.isArray(images) && images.length > 0) || (Array.isArray(audio) && audio.length > 0)) {
        return { route: ROUTE_ECOMMERCE, reason: 'multimodal_input' };
    }
    const normalized = safeString(message).toLowerCase();
    if (!normalized) return { route: ROUTE_GENERAL, reason: 'empty' };
    if (ACTION_ROUTE_PATTERN.test(normalized)) {
        return { route: ROUTE_ACTION, reason: 'keyword_action' };
    }
    if (
        RECOMMENDATION_INTENT_PATTERN.test(normalized)
        && (
            COMMERCE_KEYWORD_PATTERN.test(normalized)
            || context?.currentProductId
            || (Array.isArray(context?.cartItems) && context.cartItems.length > 0)
            || hasRecentCommerceContext(assistantSession)
        )
    ) {
        return { route: ROUTE_ECOMMERCE, reason: 'recommendation_intent' };
    }
    if (SMALL_TALK_PATTERN.test(normalized)) {
        return { route: ROUTE_GENERAL, reason: 'small_talk' };
    }
    if (
        COMMERCE_KEYWORD_PATTERN.test(normalized)
        || /\bunder\s+\d+\b/i.test(normalized)
        || shouldRouteAsCommerceFollowUp({ message: normalized, assistantSession })
    ) {
        return { route: ROUTE_ECOMMERCE, reason: 'commerce_context_or_keyword' };
    }
    return { route: ROUTE_GENERAL, reason: 'default' };
};

const inferConfirmationFromMessage = ({ message = '', confirmation = null, assistantSession = {} } = {}) => {
    if (confirmation?.actionId) return confirmation;

    const pendingAction = assistantSession?.pendingAction || null;
    if (!pendingAction?.actionId) return confirmation;

    const normalized = safeString(message);
    if (!normalized) return confirmation;

    if (APPROVE_CONFIRMATION_PATTERN.test(normalized)) {
        return {
            actionId: safeString(pendingAction.actionId),
            approved: true,
            contextVersion: Number(pendingAction.contextVersion || 0),
        };
    }

    if (DECLINE_CONFIRMATION_PATTERN.test(normalized)) {
        return {
            actionId: safeString(pendingAction.actionId),
            approved: false,
            contextVersion: Number(pendingAction.contextVersion || 0),
        };
    }

    return confirmation;
};

const resolveStoredAssistantSession = async ({ user = null, sessionId = '', context = {} } = {}) => {
    const normalizedSessionId = safeString(sessionId || context?.clientSessionId || '');
    if (user?._id && normalizedSessionId) {
        const storedThread = await loadAssistantThread({ userId: user._id, sessionId: normalizedSessionId });
        if (storedThread?.assistantSession) {
            return normalizeAssistantSession(storedThread.assistantSession, normalizedSessionId);
        }
    }
    if (context?.assistantSession) {
        return normalizeAssistantSession(context.assistantSession, normalizedSessionId);
    }
    return normalizeAssistantSession({}, normalizedSessionId);
};

const resolveAnswerText = (payload = {}) => (
    safeString(
        payload?.answer
        || payload?.response
        || payload?.text
        || payload?.summary
        || ''
    )
);

const extractModelProductIds = (payload = {}) => {
    const directIds = Array.isArray(payload?.productIds) ? payload.productIds : [];
    if (directIds.length > 0) return directIds;

    if (Array.isArray(payload?.products)) {
        return payload.products
            .map((entry) => (entry && typeof entry === 'object' ? entry.id || entry.productId : entry))
            .filter(Boolean);
    }

    return payload?.productId ? [payload.productId] : [];
};

const validateGeneralPayload = (payload = {}) => {
    const answer = resolveAnswerText(payload);
    return {
        ok: Boolean(answer) && !isSchemaPlaceholder(answer),
        data: {
            answer,
            followUps: filterPlaceholderStrings(payload?.followUps || []),
        },
    };
};

const validateCommercePayload = (payload = {}, allowedIds = []) => {
    const allowed = new Set((Array.isArray(allowedIds) ? allowedIds : []).map((entry) => safeString(entry)));
    const answer = resolveAnswerText(payload);
    const rawProductIds = extractModelProductIds(payload);
    const productIds = uniq(rawProductIds)
        .filter((entry) => !isSchemaPlaceholder(entry))
        .filter((entry) => allowed.has(safeString(entry)))
        .slice(0, 5);
    const focusProductIdCandidate = payload?.focusProductId
        || payload?.productId
        || payload?.focusProduct?.id
        || payload?.selectedProductId
        || '';
    return {
        ok: Boolean(answer) && !isSchemaPlaceholder(answer),
        data: {
            answer,
            productIds,
            focusProductId: (!isSchemaPlaceholder(focusProductIdCandidate) && allowed.has(safeString(focusProductIdCandidate || '')))
                ? safeString(focusProductIdCandidate || '')
                : (productIds[0] || ''),
            followUps: filterPlaceholderStrings(payload?.followUps || []),
        },
        rejectedProductIds: uniq(rawProductIds).filter((entry) => !allowed.has(safeString(entry))),
    };
};

const validateRetrievalQueryPayload = (payload = {}) => {
    const query = safeString(payload?.query || payload?.searchQuery || payload?.search || '');
    const filters = inferStructuredRetrievalFilters({ payload, message: query });
    return {
        ok: Boolean(query) && !isSchemaPlaceholder(query),
        data: {
            query,
            filters,
            followUps: filterPlaceholderStrings(payload?.followUps || []),
        },
    };
};

const trimConversationHistory = (history = []) => (
    Array.isArray(history)
        ? history
            .filter((entry) => ['user', 'assistant', 'system'].includes(safeString(entry?.role || '')))
            .map((entry) => ({ role: safeString(entry.role), content: safeString(entry.content || '').slice(0, 1000) }))
            .slice(-6)
        : []
);

const deriveRetrievalQuery = async ({
    message = '',
    conversationHistory = [],
    assistantSession = {},
    images = [],
    audio = [],
    route = ROUTE_ECOMMERCE,
    mediaHints = {},
    requireHostedGemma = false,
} = {}) => {
    const safeMessage = safeString(message);
    const hintedQuery = buildMediaHintQuery(mediaHints, safeMessage);
    const categoryHint = extractCommerceCategoryHint(safeMessage);
    const heuristicFilters = inferStructuredRetrievalFilters({
        message: safeMessage,
        assistantSession,
    });
    const heuristicQuery = buildHeuristicRetrievalQueryText({
        message: hintedQuery || safeMessage,
        filters: heuristicFilters,
    });
    const shouldPlanFromContext = shouldUseContextualCommercePlanner({
        message: safeMessage,
        assistantSession,
        conversationHistory,
    });
    if ((!Array.isArray(images) || images.length === 0) && (!Array.isArray(audio) || audio.length === 0)) {
        if (categoryHint && hasRecentCommerceContext(assistantSession)) {
            return {
                query: heuristicQuery || `${categoryHint} products`,
                provider: '',
                providerModel: '',
                filters: heuristicFilters,
                validator: { ok: true, reason: 'category_hint_query' },
            };
        }
        if (!shouldPlanFromContext) {
            return {
                query: heuristicQuery || safeMessage,
                provider: '',
                providerModel: '',
                filters: heuristicFilters,
                validator: { ok: true, reason: 'text_query' },
            };
        }
    }

    if (!safeMessage && hintedQuery) {
        return {
            query: hintedQuery,
            provider: '',
            providerModel: '',
            filters: heuristicFilters,
            validator: { ok: true, reason: 'media_hint_query' },
        };
    }

    try {
        const attempts = [
            {
                systemPrompt: [
                    'You are a retrieval planner for a controlled ecommerce assistant.',
                    'Inspect the text and any uploaded images or audio.',
                    'Return JSON only.',
                    'Schema: {"query":"string","category":"string","brand":"string","minPrice":0,"maxPrice":0,"minRating":0,"inStock":true,"sortBy":"relevance","requiredTerms":["string"],"followUps":["string"]}.',
                    'Do not echo placeholder values like "string". Fill the fields with real content.',
                    'Generate a compact ecommerce search query using brand, category, color, material, device family, or relevant specs when clear.',
                    'Extract hard filters like max price, minimum rating, in-stock requirements, and must-have attributes like color, material, RAM, or storage when the user states them.',
                    'Do not mention uncertainty inside the query text.',
                ].join('\n'),
                prompt: [
                    hasRecentCommerceContext(assistantSession) ? `Previous ecommerce query: ${safeString(assistantSession?.lastEntities?.query || '')}` : '',
                    Array.isArray(assistantSession?.lastResults) && assistantSession.lastResults.length > 0
                        ? `Recent results: ${assistantSession.lastResults.slice(0, 4).map((product) => `${safeString(product?.title || '')} (${safeString(product?.category || '')})`).join('; ')}`
                        : '',
                    Array.isArray(conversationHistory) && conversationHistory.length > 0
                        ? `Conversation:\n${trimConversationHistory(conversationHistory).map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`).join('\n')}`
                        : '',
                    safeMessage || 'Describe the uploaded item as an ecommerce search query.',
                ].filter(Boolean).join('\n\n'),
            },
            {
                systemPrompt: [
                    'You are a retrieval planner for a controlled ecommerce assistant.',
                    'Return JSON only and use real values, never placeholders.',
                    'Example valid JSON: {"query":"dell xps 13 laptop","category":"Laptops","maxPrice":50000,"inStock":true,"requiredTerms":["16gb ram"],"followUps":["Compare similar laptops","Set a budget"]}.',
                    'When the user is refining a previous shopping request, rewrite it into the next explicit catalog query.',
                    'Describe the uploaded product as a concise shopping search query.',
                ].join('\n'),
                prompt: [
                    hasRecentCommerceContext(assistantSession) ? `Previous ecommerce query: ${safeString(assistantSession?.lastEntities?.query || '')}` : '',
                    safeMessage || 'Identify the item in the uploaded media and convert it into an ecommerce search query.',
                ].filter(Boolean).join('\n\n'),
            },
        ];

        let parsed = null;
        let response = null;
        for (const attempt of attempts) {
            response = await generateStructuredJson({
                systemPrompt: attempt.systemPrompt,
                prompt: attempt.prompt,
                route,
                temperature: 0.1,
                images,
                audio,
                responseJsonSchema: RETRIEVAL_QUERY_RESPONSE_SCHEMA,
                ...buildCommerceModelProviderOptions(requireHostedGemma),
            });
            parsed = validateRetrievalQueryPayload(response.data);
            if (parsed.ok) {
                break;
            }
        }

        if (!parsed?.ok || !response) {
            throw new Error('invalid_retrieval_query_payload');
        }
        return {
            query: parsed.data.query,
            provider: response.provider,
            providerModel: response.providerModel,
            filters: inferStructuredRetrievalFilters({
                payload: parsed.data.filters,
                message: `${safeMessage}\n${parsed.data.query}`,
                assistantSession,
            }),
            validator: { ok: true, reason: 'model_query_valid' },
        };
    } catch (error) {
        logger.warn('assistant.retrieval_query.fallback', {
            error: error.message,
            route,
        });
        return {
            query: categoryHint
                ? (heuristicQuery || `${categoryHint} products`)
                : (heuristicQuery || hintedQuery || safeMessage || safeString(assistantSession?.lastEntities?.query || '') || 'product'),
            provider: '',
            providerModel: '',
            filters: heuristicFilters,
            validator: { ok: false, reason: safeString(error?.message || 'retrieval_query_fallback') },
        };
    }
};

const performGeneralTurn = async ({
    message = '',
    conversationHistory = [],
    assistantMode = 'chat',
    sessionId = '',
    traceId = '',
    assistantSession = {},
    images = [],
    audio = [],
} = {}) => {
    let provider = 'rule';
    let providerModel = '';
    let validator = { ok: true, reason: 'fallback' };
    let gatewayHealth = await checkModelGatewayHealth().catch(() => getModelGatewayHealth());

    if (isHostedGemmaAudioUnsupported(gatewayHealth, audio)) {
        const assistantTurn = buildAssistantTurn({
            intent: 'general_knowledge',
            confidence: 0.95,
            decision: 'respond',
            response: 'Hosted Gemma 4 is active for text and image requests here, but the currently available Gemma 4 API models on this key do not accept audio attachments yet. Please type the request, upload an image, or use the browser microphone input.',
            followUps: ['Type what the audio says', 'Upload an image instead', 'Use the microphone input'],
            ui: { surface: 'plain_answer' },
            verification: {
                label: 'provider_capability_limit',
                confidence: 1,
                summary: 'Audio attachment blocked because the hosted Gemma 4 models available on this API key are text-and-image only.',
            },
            answerMode: 'commerce',
        });

        return buildResponseEnvelope({
            assistantTurn,
            route: ROUTE_GENERAL,
            provider: 'rule',
            providerModel: safeString(gatewayHealth?.resolvedChatModel || gatewayHealth?.chatModel || ''),
            products: [],
            followUps: assistantTurn.followUps,
            sessionId,
            traceId,
            assistantMode,
            assistantSession: {
                ...assistantSession,
                lastIntent: 'general_knowledge',
                lastEntities: { ...assistantSession.lastEntities, query: safeString(message) },
                pendingAction: null,
            },
            health: { gateway: gatewayHealth },
            providerCapabilities: gatewayHealth?.capabilities || null,
            retrievalHitCount: 0,
            validator: { ok: false, reason: 'audio_input_unsupported' },
            messageId: createMessageId(),
        });
    }

    let payload = {
        answer: 'I can help with products, cart actions, orders, and support. Ask anything and I will keep the result controlled.',
        followUps: ['Show product deals', 'Help with my cart'],
    };

    try {
        const history = trimConversationHistory(conversationHistory).map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`).join('\n');
        const attempts = [
            {
                systemPrompt: [
                    'You are Aura, a controlled ecommerce assistant.',
                    'Return valid JSON only.',
                    'Schema: {"answer":"string","followUps":["string"]}.',
                    'Do not echo placeholder values like "string". Fill the fields with real content.',
                    'Keep the answer concise.',
                ].join('\n'),
                prompt: [history ? `Conversation:\n${history}` : '', `User: ${message || 'Analyze the provided input.'}`, 'Return JSON only.'].filter(Boolean).join('\n\n'),
            },
            {
                systemPrompt: [
                    'You are Aura, a controlled ecommerce assistant.',
                    'Return valid JSON only.',
                    'Use real values, never schema placeholders.',
                    'Example valid JSON: {"answer":"I can help you find products, manage your cart, and check orders.","followUps":["Show product deals","Help with my cart"]}.',
                ].join('\n'),
                prompt: `User request: ${message || 'Analyze the provided input.'}`,
            },
        ];

        let parsed = null;
        let response = null;
        for (const attempt of attempts) {
            response = await generateStructuredJson({
                systemPrompt: attempt.systemPrompt,
                prompt: attempt.prompt,
                route: ROUTE_GENERAL,
                temperature: 0.25,
                images,
                audio,
                responseJsonSchema: GENERAL_RESPONSE_SCHEMA,
            });
            parsed = validateGeneralPayload(response.data);
            if (parsed.ok) {
                break;
            }
        }

        if (!parsed?.ok || !response) throw new Error('invalid_general_payload');
        provider = response.provider;
        providerModel = response.providerModel;
        gatewayHealth = await checkModelGatewayHealth({ provider, force: true }).catch(() => getModelGatewayHealth());
        validator = { ok: true, reason: 'model_json_valid' };
        payload = parsed.data;
    } catch (error) {
        recordFallbackMetric(safeString(error?.message || 'general_fallback'));
        logger.warn('assistant.general.fallback', { error: error.message, traceId });
    }

    const assistantTurn = buildAssistantTurn({
        intent: 'general_knowledge',
        confidence: provider !== 'rule' ? 0.82 : 0.55,
        decision: 'respond',
        response: payload.answer,
        followUps: payload.followUps,
        ui: { surface: 'plain_answer' },
        verification: {
            label: provider !== 'rule' ? 'model_knowledge' : 'cannot_verify',
            confidence: provider !== 'rule' ? 0.72 : 0.4,
            summary: provider !== 'rule'
                ? 'Model gateway answer with controlled JSON validation.'
                : 'Fell back to deterministic copy because the model gateway was unavailable.',
        },
        answerMode: provider !== 'rule' ? 'model_knowledge' : 'commerce',
    });

    return buildResponseEnvelope({
        assistantTurn,
        route: ROUTE_GENERAL,
        provider,
        providerModel,
        products: [],
        followUps: assistantTurn.followUps,
        sessionId,
        traceId,
        assistantMode,
        assistantSession: {
            ...assistantSession,
            lastIntent: 'general_knowledge',
            lastEntities: { ...assistantSession.lastEntities, query: safeString(message) },
            pendingAction: null,
        },
        health: { gateway: gatewayHealth },
        providerCapabilities: gatewayHealth?.capabilities || null,
        retrievalHitCount: 0,
        validator,
        messageId: createMessageId(),
    });
};

const summarizeProducts = (products = []) => (
    (Array.isArray(products) ? products : []).slice(0, 3).map((product, index) => (
        `${index === 0 ? 'Top match' : `Option ${index + 1}`}: ${product.title} by ${product.brand || 'the listed brand'} at Rs. ${Number(product.price || 0)}.`
    )).join(' ')
);

const formatCommercePrice = (value = 0) => `Rs ${Number(value || 0).toLocaleString('en-IN')}`;

const buildCommerceFilterSummary = (filters = {}) => {
    const parts = [];
    const category = safeString(filters?.category || '');
    const brand = safeString(filters?.brand || '');
    const minPrice = Number(filters?.minPrice || 0);
    const maxPrice = Number(filters?.maxPrice || 0);
    const minRating = Number(filters?.minRating || 0);
    const requiredTerms = Array.isArray(filters?.requiredTerms) ? filters.requiredTerms.map((entry) => safeString(entry)).filter(Boolean) : [];
    const sortBy = normalizeRetrievalSortBy(filters?.sortBy || '');

    if (category) parts.push(`category ${category}`);
    if (brand) parts.push(`brand ${brand}`);
    if (minPrice > 0 && maxPrice > 0) {
        parts.push(`${formatCommercePrice(minPrice)} to ${formatCommercePrice(maxPrice)}`);
    } else if (maxPrice > 0) {
        parts.push(`under ${formatCommercePrice(maxPrice)}`);
    } else if (minPrice > 0) {
        parts.push(`above ${formatCommercePrice(minPrice)}`);
    }
    if (minRating > 0) parts.push(`${minRating.toFixed(1)}+ rating`);
    if (filters?.inStock === true) parts.push('in stock only');
    if (filters?.inStock === false) parts.push('out of stock only');
    if (requiredTerms.length > 0) parts.push(`must include ${requiredTerms.slice(0, 4).join(', ')}`);
    if (sortBy === 'rating_desc') parts.push('sorted by rating');
    if (sortBy === 'price_asc') parts.push('sorted by lowest price');
    if (sortBy === 'price_desc') parts.push('sorted by premium price');
    return parts;
};

const buildCommerceResultInsights = (products = [], filters = {}, relaxation = null) => {
    const normalizedProducts = (Array.isArray(products) ? products : []).map((product) => normalizeProductCard(product)).filter((product) => product.id);
    const prices = normalizedProducts.map((product) => Number(product.price || 0)).filter((price) => price > 0);
    const ratings = normalizedProducts.map((product) => Number(product.rating || 0)).filter((rating) => rating > 0);
    const appliedFilters = buildCommerceFilterSummary(filters);
    return {
        appliedFilters,
        resultCount: normalizedProducts.length,
        priceMin: prices.length ? Math.min(...prices) : 0,
        priceMax: prices.length ? Math.max(...prices) : 0,
        topRating: ratings.length ? Math.max(...ratings) : 0,
        inStockCount: normalizedProducts.filter((product) => Number(product.stock || 0) > 0).length,
        brands: uniq(normalizedProducts.map((product) => product.brand)).slice(0, 4),
        categories: uniq(normalizedProducts.map((product) => product.category)).slice(0, 4),
        relaxed: Boolean(relaxation),
        relaxationReason: safeString(relaxation?.reason || ''),
        relaxationLabel: safeString(relaxation?.label || ''),
    };
};

const formatCommerceInsightLines = (products = [], filters = {}, relaxation = null) => {
    const insights = buildCommerceResultInsights(products, filters, relaxation);
    const lines = [];
    if (insights.appliedFilters.length > 0) {
        lines.push(`- Applied: ${insights.appliedFilters.join('; ')}.`);
    }
    if (insights.resultCount > 0) {
        const pricePart = insights.priceMin && insights.priceMax
            ? `, ${formatCommercePrice(insights.priceMin)}-${formatCommercePrice(insights.priceMax)}`
            : '';
        lines.push(`- Shortlist: ${insights.resultCount} verified result${insights.resultCount === 1 ? '' : 's'}${pricePart}; ${insights.inStockCount}/${insights.resultCount} in stock.`);
    }
    if (insights.topRating > 0) {
        lines.push(`- Quality: top rating ${insights.topRating.toFixed(1)}${insights.brands.length ? ` across ${insights.brands.join(', ')}` : ''}.`);
    }
    if (relaxation?.label) {
        lines.push(`- Relaxed: ${safeString(relaxation.label)}; original constraints are still called out in each card.`);
    }
    return lines;
};

const buildNoResultFollowUps = (filters = {}) => {
    const followUps = [];
    if (Number(filters?.maxPrice || 0) > 0) followUps.push('Broaden the budget');
    if (safeString(filters?.category || '')) followUps.push(`Show another ${safeString(filters.category)} option`);
    if (Array.isArray(filters?.requiredTerms) && filters.requiredTerms.length > 0) followUps.push('Remove one must-have term');
    if (filters?.inStock === true) followUps.push('Include out-of-stock items');
    followUps.push('Try a different product name');
    return uniq(followUps).slice(0, 4);
};

const buildNoResultResponseText = ({ query = '', filters = {} } = {}) => {
    const appliedFilters = buildCommerceFilterSummary(filters);
    const target = appliedFilters.length
        ? appliedFilters.join('; ')
        : safeString(query || 'that request');
    return [
        `I do not have a validated catalog match for ${target} right now.`,
        'I will not fill the gap with unrelated products.',
        'Try broadening the budget, removing one must-have attribute, or switching category.'
    ].join('\n\n');
};

const scoreCommerceProduct = (product = {}, filters = {}, retrievalScore = 0) => {
    const price = Number(product?.price || 0);
    const stock = Math.max(0, Number(product?.stock || 0));
    const rating = Math.max(0, Number(product?.rating || 0));
    const ratingCount = Math.max(0, Number(product?.ratingCount || 0));
    const discountPercentage = Math.max(0, Number(product?.discountPercentage || 0));
    const minPrice = Number(filters?.minPrice || 0);
    const maxPrice = Number(filters?.maxPrice || 0);
    let score = Math.max(0, Number(retrievalScore || 0));

    if (safeString(filters?.category || '') && matchesCategoryFilter(filters.category, product?.category)) score += 0.18;
    if (safeString(filters?.brand || '') && safeString(product?.brand || '').toLowerCase().includes(safeString(filters.brand).toLowerCase())) score += 0.15;
    if (stock > 0) score += 0.2;
    if (filters?.inStock === true && stock <= 0) score -= 0.45;
    if (rating > 0) score += Math.min(0.18, (rating / 5) * 0.18);
    if (ratingCount >= 25) score += 0.04;
    if (discountPercentage > 0) score += Math.min(0.08, discountPercentage / 100);
    if (maxPrice > 0) score += price > 0 && price <= maxPrice ? 0.22 : -0.2;
    if (minPrice > 0) score += price >= minPrice ? 0.08 : -0.08;
    return score;
};

const sortCommerceEntries = (entries = [], filters = {}) => {
    const normalizedEntries = (Array.isArray(entries) ? entries : []).filter((entry) => entry?.product);
    const sortBy = normalizeRetrievalSortBy(filters?.sortBy || '');
    const withScores = normalizedEntries.map((entry) => ({
        ...entry,
        assistantScore: scoreCommerceProduct(entry.product, filters, entry.score),
    }));
    if (sortBy === 'rating_desc') {
        return withScores.sort((left, right) => (
            Number(right?.product?.rating || 0) - Number(left?.product?.rating || 0)
            || Number(right?.assistantScore || 0) - Number(left?.assistantScore || 0)
        ));
    }
    if (sortBy === 'price_asc') {
        return withScores.sort((left, right) => (
            Number(left?.product?.price || Number.MAX_SAFE_INTEGER) - Number(right?.product?.price || Number.MAX_SAFE_INTEGER)
            || Number(right?.assistantScore || 0) - Number(left?.assistantScore || 0)
        ));
    }
    if (sortBy === 'price_desc') {
        return withScores.sort((left, right) => (
            Number(right?.product?.price || 0) - Number(left?.product?.price || 0)
            || Number(right?.assistantScore || 0) - Number(left?.assistantScore || 0)
        ));
    }
    return withScores.sort((left, right) => Number(right?.assistantScore || 0) - Number(left?.assistantScore || 0));
};

const buildRelaxedRetrievalPlans = ({ query = '', filters = {} } = {}) => {
    const base = {
        category: safeString(filters?.category || ''),
        brand: safeString(filters?.brand || ''),
        minPrice: Number(filters?.minPrice || 0),
        maxPrice: Number(filters?.maxPrice || 0),
        minRating: Number(filters?.minRating || 0),
        inStock: typeof filters?.inStock === 'boolean' ? filters.inStock : null,
        sortBy: normalizeRetrievalSortBy(filters?.sortBy || ''),
        requiredTerms: Array.isArray(filters?.requiredTerms) ? filters.requiredTerms : [],
    };
    const plans = [];
    const pushPlan = (reason, label, nextFilters) => {
        const dedupeKey = JSON.stringify(nextFilters);
        if (!plans.some((plan) => plan.dedupeKey === dedupeKey)) {
            plans.push({
                query: safeString(query || base.category || base.brand || 'product'),
                filters: nextFilters,
                reason,
                label,
                dedupeKey,
            });
        }
    };

    if (base.maxPrice > 0) {
        pushPlan('relaxed_budget', `budget above ${formatCommercePrice(base.maxPrice)}`, { ...base, maxPrice: 0 });
    }
    if (base.minRating > 0) {
        pushPlan('relaxed_rating', `rating below ${base.minRating.toFixed(1)} allowed`, { ...base, minRating: 0 });
    }
    if (base.inStock === true) {
        pushPlan('relaxed_stock', 'including out-of-stock catalog items', { ...base, inStock: null });
    }
    if (base.requiredTerms.length > 0) {
        pushPlan('relaxed_required_terms', 'without every must-have term', { ...base, requiredTerms: [] });
    }
    const fullyRelaxed = {
        ...base,
        maxPrice: base.maxPrice > 0 ? 0 : base.maxPrice,
        minRating: base.minRating > 0 ? 0 : base.minRating,
        inStock: base.inStock === true ? null : base.inStock,
        requiredTerms: base.requiredTerms.length > 0 ? [] : base.requiredTerms,
    };
    if (JSON.stringify(fullyRelaxed) !== JSON.stringify(base)) {
        pushPlan('relaxed_all_soft_constraints', 'soft constraints relaxed together', fullyRelaxed);
    }
    return plans.map(({ dedupeKey, ...plan }) => plan).slice(0, 5);
};

const buildProductFitSignals = (product = {}, filters = {}) => {
    const signals = [];
    const watchouts = [];
    const price = Number(product?.price || 0);
    const rating = Number(product?.rating || 0);
    const ratingCount = Math.max(0, Number(product?.ratingCount || 0));
    const stock = Math.max(0, Number(product?.stock || 0));
    const discountPercentage = Math.max(0, Number(product?.discountPercentage || 0));
    const maxPrice = Number(filters?.maxPrice || 0);
    const category = safeString(filters?.category || '');

    if (category && matchesCategoryFilter(category, product?.category)) {
        signals.push(`matches ${category}`);
    }

    if (maxPrice > 0) {
        if (price > 0 && price <= maxPrice) {
            signals.push(`within ${formatCommercePrice(maxPrice)}`);
        } else if (price > maxPrice) {
            watchouts.push(`above ${formatCommercePrice(maxPrice)}`);
        }
    }

    if (stock > 0) {
        signals.push(`${stock} in stock`);
    } else {
        watchouts.push('out of stock');
    }

    if (rating >= 4) {
        signals.push(`${rating.toFixed(1)} rating`);
    } else if (rating > 0) {
        watchouts.push(`${rating.toFixed(1)} rating`);
    }

    if (ratingCount > 0 && ratingCount < 25) {
        watchouts.push('low review depth');
    }

    if (discountPercentage > 0) {
        signals.push(`${Math.round(discountPercentage)}% off`);
    }

    if (safeString(product?.brand || '')) {
        signals.push(`${safeString(product.brand)} brand lane`);
    }

    return {
        reason: signals.slice(0, 3).join(', '),
        watchout: watchouts.slice(0, 2).join(', '),
        signals,
        watchouts,
    };
};

const decorateCommerceProducts = (products = [], filters = {}) => (
    (Array.isArray(products) ? products : [])
        .map((product, index) => {
            const normalized = normalizeProductCard(product);
            const fit = buildProductFitSignals(normalized, filters);
            return {
                ...normalized,
                assistantRank: index + 1,
                assistantReason: fit.reason,
                assistantWatchout: fit.watchout,
            };
        })
);

const buildCommerceResponseText = ({
    answer = '',
    products = [],
    filters = {},
    relaxation = null,
} = {}) => {
    const normalizedProducts = decorateCommerceProducts(products, filters).slice(0, 3);
    const baseLead = safeString(answer || summarizeProducts(normalizedProducts));
    const lead = relaxation
        ? [
            `No exact catalog match for ${buildCommerceFilterSummary(filters).join('; ') || 'the original constraints'}. Showing nearest verified alternatives after relaxing ${safeString(relaxation.label || 'one constraint')}.`,
            baseLead,
        ].filter(Boolean).join(' ')
        : baseLead;
    if (normalizedProducts.length === 0) {
        return lead;
    }

    const productLines = normalizedProducts.map((product, index) => {
        const label = index === 0 ? 'Best fit' : `Option ${index + 1}`;
        const facts = [
            formatCommercePrice(product.price),
            product.assistantReason,
            product.assistantWatchout ? `watch: ${product.assistantWatchout}` : '',
        ].filter(Boolean);
        return `- ${label}: ${product.title}${product.brand ? ` by ${product.brand}` : ''} - ${facts.join('; ')}.`;
    });
    const nextStep = normalizedProducts.length === 1
        ? 'Open details to verify delivery, seller, and warranty before adding it to cart.'
        : 'Pick one option to inspect, then compare the short list or narrow the budget.';

    return [
        lead,
        '**Decision signals**',
        formatCommerceInsightLines(normalizedProducts, filters, relaxation).join('\n'),
        '**Grounded picks**',
        productLines.join('\n'),
        '**Next step**',
        nextStep,
    ].filter(Boolean).join('\n\n');
};

const shouldUseRecommendationEngineForAssistant = ({ message = '', context = {} } = {}) => {
    if (context?.forceRecommendations === true || context?.recommendationMode === true) return true;
    const normalized = safeString(message);
    if (!normalized) return false;
    return RECOMMENDATION_INTENT_PATTERN.test(normalized);
};

const resolveRecommendationContext = ({ context = {}, assistantSession = {} } = {}) => {
    const currentProductId = safeString(
        context?.currentProductId
        || context?.productId
        || assistantSession?.activeProduct?.id
        || assistantSession?.lastEntities?.productId
        || ''
    );
    const cartItems = Array.isArray(context?.cartItems)
        ? context.cartItems
        : [];

    return {
        currentProductId,
        cartItems,
        page: safeString(context?.page || context?.sourcePage || 'assistant'),
    };
};

const buildAssistantRecommendationText = ({ message = '', recommendations = [] } = {}) => {
    if (!recommendations.length) {
        return 'I could not find a confident recommendation from the catalog signals yet. Try naming a product, category, or budget and I will rerank the catalog again.';
    }

    const intro = /\b(with|accessor|addon|add-on|complete|together|cart)\b/i.test(message)
        ? 'Here are catalog-backed add-ons and related picks that fit the current context.'
        : 'Here are catalog-backed recommendations ranked from product fit, activity, popularity, stock, and rating signals.';
    const lines = recommendations.slice(0, 5).map((item, index) => {
        const product = normalizeProductCard(item.product || {});
        const reason = safeString(item.reason || product.assistantReason || 'Matches the current shopping context');
        const label = index === 0 ? 'Top pick' : `Option ${index + 1}`;
        return `- ${label}: ${product.title}${product.brand ? ` by ${product.brand}` : ''} - ${formatCommercePrice(product.price)}; ${reason}.`;
    });

    return [
        intro,
        '**Recommended picks**',
        lines.join('\n'),
        '**Next step**',
        recommendations.length === 1
            ? 'Open the product to verify details, delivery, and warranty before adding it to cart.'
            : 'Open one pick to inspect details, or ask me to compare the strongest options.',
    ].join('\n\n');
};

const buildAssistantRecommendationEnvelope = async ({
    message = '',
    user = null,
    sessionId = '',
    traceId = '',
    assistantMode = 'chat',
    assistantSession = {},
    context = {},
    gatewayHealth = {},
    vectorStoreHealth = null,
} = {}) => {
    const recommendationContext = resolveRecommendationContext({ context, assistantSession });
    const recommendations = await getHybridRecommendationsForAssistant({
        userId: user?._id || null,
        sessionId,
        message,
        context: recommendationContext,
        limit: 5,
    }).catch((error) => {
        logger.warn('assistant.recommendations.fallback', { error: error.message, traceId });
        return [];
    });
    const products = recommendations.map((item, index) => ({
        ...(item.product || {}),
        assistantRank: index + 1,
        assistantReason: safeString(item.reason || 'Matches the current shopping context'),
        recommendationMeta: {
            source: safeString(item.source || 'assistant_recommendation'),
            reason: safeString(item.reason || ''),
        },
    }));
    const decoratedProducts = decorateCommerceProducts(products, {}).map((product, index) => ({
        ...product,
        assistantReason: safeString(recommendations[index]?.reason || product.assistantReason),
    }));
    const focusProduct = decoratedProducts[0] || null;
    const assistantTurn = buildAssistantTurn({
        intent: 'product_search',
        confidence: recommendations.length > 0 ? 0.94 : 0.66,
        decision: 'respond',
        response: buildAssistantRecommendationText({ message, recommendations }),
        followUps: recommendations.length > 0
            ? ['Compare these picks', 'Set a price limit', 'Show add-ons']
            : ['Name a category', 'Set a budget', 'Show trending products'],
        ui: {
            surface: decoratedProducts.length === 1 ? 'product_focus' : (decoratedProducts.length > 1 ? 'product_results' : 'plain_answer'),
            title: 'Hybrid recommendations',
            products: decoratedProducts,
            product: decoratedProducts.length === 1 ? focusProduct : null,
        },
        verification: {
            label: 'app_grounded',
            confidence: recommendations.length > 0 ? 1 : 0.7,
            summary: recommendations.length > 0
                ? 'Recommendations came from the hybrid recommendation engine using catalog, behavior, popularity, stock, and rating signals.'
                : 'The recommendation engine returned no confident product candidates.',
            evidenceCount: recommendations.length,
        },
        toolRuns: [{
            id: `recommendations-${Date.now()}`,
            toolName: 'recommend_products',
            status: 'completed',
            latencyMs: 0,
            summary: `${recommendations.length} hybrid recommendation${recommendations.length === 1 ? '' : 's'} returned`,
            inputPreview: {
                query: safeString(message),
                currentProductId: recommendationContext.currentProductId,
                cartCount: recommendationContext.cartItems.length,
            },
            outputPreview: {
                productIds: decoratedProducts.map((product) => String(product.id || product._id || '')).filter(Boolean),
            },
        }],
        answerMode: 'commerce',
    });

    return buildResponseEnvelope({
        assistantTurn,
        route: ROUTE_ECOMMERCE,
        provider: 'hybrid_recommendation_engine',
        providerModel: '',
        products: decoratedProducts,
        followUps: assistantTurn.followUps,
        sessionId,
        traceId,
        assistantMode,
        assistantSession: {
            ...assistantSession,
            lastIntent: 'product_search',
            lastEntities: {
                ...assistantSession.lastEntities,
                query: safeString(message),
                productId: recommendationContext.currentProductId || safeString(focusProduct?.id || ''),
                category: safeString(focusProduct?.category || assistantSession?.lastEntities?.category || ''),
            },
            lastResults: decoratedProducts,
            activeProduct: focusProduct || assistantSession.activeProduct,
            pendingAction: null,
        },
        health: {
            gateway: gatewayHealth || getModelGatewayHealth(),
            vectorStore: vectorStoreHealth,
        },
        providerCapabilities: gatewayHealth?.capabilities || null,
        retrievalHitCount: recommendations.length,
        validator: { ok: recommendations.length > 0, reason: 'hybrid_recommendation_engine' },
        messageId: createMessageId(),
    });
};

const performCommerceTurn = async ({
    user = null,
    message = '',
    conversationHistory = [],
    assistantMode = 'chat',
    sessionId = '',
    traceId = '',
    assistantSession = {},
    context = {},
    images = [],
    audio = [],
} = {}) => {
    const requireHostedGemma = isHostedGemmaCommerceRequired();
    let gatewayHealth = await checkModelGatewayHealth({
        provider: requireHostedGemma ? HOSTED_GEMMA_PROVIDER : '',
        disableProviderFallback: requireHostedGemma,
    }).catch(() => getModelGatewayHealth());
    const vectorStoreHealthPromise = getLocalVectorIndexHealth().catch(() => null);
    if (shouldAnswerKnowledgeBeforeCatalog({
        message,
        images,
        audio,
        assistantSession,
    })) {
        const knowledgeRetrieval = await retrieveCommerceKnowledge({
            query: message,
            products: [],
            limit: 6,
        }).catch((error) => {
            logger.warn('assistant.knowledge_first.fallback', { error: error.message, traceId });
            return { chunks: [], citations: [], hitCount: 0, toolRun: null };
        });
        if (knowledgeRetrieval.hitCount > 0) {
            const assistantTurn = buildAssistantTurn({
                intent: 'support',
                confidence: 0.92,
                decision: 'respond',
                response: buildKnowledgeAnswerText(knowledgeRetrieval.chunks, { query: message }),
                followUps: ['Track an order', 'Open support', 'Find a product'],
                ui: { surface: 'plain_answer', title: 'Grounded store guidance', products: [] },
                verification: {
                    label: 'app_grounded',
                    confidence: 1,
                    summary: `Answer grounded in ${knowledgeRetrieval.hitCount} policy, FAQ, review, or product-knowledge chunk${knowledgeRetrieval.hitCount === 1 ? '' : 's'} before catalog retrieval.`,
                    evidenceCount: knowledgeRetrieval.hitCount,
                },
                citations: knowledgeRetrieval.citations,
                toolRuns: knowledgeRetrieval.toolRun ? [knowledgeRetrieval.toolRun] : [],
                answerMode: 'commerce',
            });
            return buildResponseEnvelope({
                assistantTurn,
                route: ROUTE_ECOMMERCE,
                provider: 'local_knowledge',
                providerModel: '',
                products: [],
                followUps: assistantTurn.followUps,
                sessionId,
                traceId,
                assistantMode,
                assistantSession: {
                    ...assistantSession,
                    lastIntent: assistantTurn.intent,
                    lastEntities: {
                        ...assistantSession.lastEntities,
                        query: safeString(message),
                    },
                    lastResults: [],
                    activeProduct: null,
                    pendingAction: null,
                },
                health: {
                    gateway: gatewayHealth,
                    vectorStore: await vectorStoreHealthPromise,
                },
                providerCapabilities: gatewayHealth?.capabilities || null,
                retrievalHitCount: knowledgeRetrieval.hitCount,
                validator: {
                    ok: true,
                    reason: 'knowledge_first_grounding',
                    knowledgeHitCount: knowledgeRetrieval.hitCount,
                },
                messageId: createMessageId(),
            });
        }
    }
    if (requireHostedGemma && !isHostedGemmaGatewayHealthy(gatewayHealth) && gatewayHealth?.apiConfigured !== false) {
        gatewayHealth = await checkModelGatewayHealth({
            provider: HOSTED_GEMMA_PROVIDER,
            disableProviderFallback: true,
            force: true,
        }).catch(() => getModelGatewayHealth());
    }
    if (isHostedGemmaAudioUnsupported(gatewayHealth, audio)) {
        const assistantTurn = buildAssistantTurn({
            intent: 'product_search',
            confidence: 0.98,
            decision: 'respond',
            response: 'Hosted Gemma 4 can ground product requests from text and images here, but the currently available Gemma 4 API models on this key do not accept audio attachments yet. Please type the product request or upload a product image.',
            followUps: ['Type the product name', 'Upload a product image', 'Ask for another category'],
            ui: { surface: 'plain_answer', title: 'Audio not available on current model', products: [] },
            verification: {
                label: 'provider_capability_limit',
                confidence: 1,
                summary: 'Audio attachment blocked because the hosted Gemma 4 models available on this API key are text-and-image only.',
            },
            answerMode: 'commerce',
        });
        return buildResponseEnvelope({
            assistantTurn,
            route: ROUTE_ECOMMERCE,
            provider: 'rule',
            providerModel: safeString(gatewayHealth?.resolvedChatModel || gatewayHealth?.chatModel || ''),
            products: [],
            followUps: assistantTurn.followUps,
            sessionId,
            traceId,
            assistantMode,
            assistantSession: {
                ...assistantSession,
                lastIntent: 'product_search',
                lastEntities: { ...assistantSession.lastEntities, query: safeString(message) },
                lastResults: [],
                activeProduct: null,
                pendingAction: null,
            },
            health: {
                gateway: gatewayHealth,
                vectorStore: await vectorStoreHealthPromise,
            },
            providerCapabilities: gatewayHealth?.capabilities || null,
            retrievalHitCount: 0,
            validator: { ok: false, reason: 'audio_input_unsupported' },
            messageId: createMessageId(),
        });
    }

    const mediaHints = extractMediaLookupHints({
        message,
        images,
        context,
    });

    if (
        shouldUseRecommendationEngineForAssistant({ message, context })
        && (!Array.isArray(images) || images.length === 0)
        && (!Array.isArray(audio) || audio.length === 0)
    ) {
        return buildAssistantRecommendationEnvelope({
            message,
            user,
            sessionId,
            traceId,
            assistantMode,
            assistantSession,
            context,
            gatewayHealth,
            vectorStoreHealth: await vectorStoreHealthPromise,
        });
    }

    if (requireHostedGemma && !isHostedGemmaGatewayHealthy(gatewayHealth)) {
        recordFallbackMetric('hosted_gemma_gateway_unavailable');
        logger.warn('assistant.commerce.hosted_gemma_required', {
            traceId,
            gatewayProvider: safeString(gatewayHealth?.activeProvider || gatewayHealth?.provider || ''),
            gatewayHealthy: Boolean(gatewayHealth?.healthy),
            gatewayModel: safeString(gatewayHealth?.resolvedChatModel || gatewayHealth?.chatModel || ''),
            gatewayError: safeString(gatewayHealth?.error || ''),
        });
        const categoryHint = extractCommerceCategoryHint(message);
        const retrievalQuery = {
            query: categoryHint
                ? `${categoryHint} products`
                : (buildMediaHintQuery(mediaHints, message) || safeString(assistantSession?.lastEntities?.query || '') || 'product'),
            provider: '',
            providerModel: '',
            filters: inferStructuredRetrievalFilters({
                message,
                assistantSession,
            }),
            validator: {
                ok: false,
                reason: 'hosted_gemma_gateway_unavailable_catalog_fallback',
            },
        };
        let retrieval = await loadDirectProductsFromMediaHints({
            mediaHints,
            limit: 5,
        });
        if (!retrieval?.retrievalHitCount) {
            retrieval = await searchProductVectorIndex(retrievalQuery.query, {
                limit: 5,
                filters: retrievalQuery.filters,
            }).catch((error) => ({
                results: [],
                retrievalHitCount: 0,
                provider: 'catalog_fallback',
                fallbackUsed: true,
                fallbackReason: safeString(error?.message || 'catalog_fallback_failed'),
            }));
        }
        const products = (Array.isArray(retrieval?.results) ? retrieval.results : [])
            .map((entry) => entry?.product)
            .filter((product) => product && matchesRetrievalFilters(product, retrievalQuery.filters));
        return buildHostedGemmaUnavailableEnvelope({
            message,
            sessionId,
            traceId,
            assistantMode,
            assistantSession,
            gatewayHealth,
            vectorStoreHealth: await vectorStoreHealthPromise,
            reason: 'hosted_gemma_gateway_unavailable',
            products,
            retrieval,
            retrievalQuery,
        });
    }

    const reuseSessionResults = shouldReuseSessionResultsForCommerce({ message, assistantSession });
    const retrievalQuery = reuseSessionResults
        ? {
            query: safeString(assistantSession?.lastEntities?.query || message),
            provider: '',
            providerModel: '',
            filters: {},
            validator: { ok: true, reason: 'session_result_context' },
        }
        : await deriveRetrievalQuery({
            message,
            conversationHistory,
            assistantSession,
            images,
            audio,
            route: ROUTE_ECOMMERCE,
            mediaHints,
            requireHostedGemma,
        });
    let retrieval = reuseSessionResults
        ? createProductLookupResults(
            assistantSession.lastResults.map((product) => normalizeProductCard(product)),
            { reason: 'assistant_session_context', provider: 'assistant_session' }
        )
        : await loadDirectProductsFromMediaHints({
            mediaHints,
            limit: 5,
        });
    if (!retrieval?.retrievalHitCount) {
        retrieval = await searchProductVectorIndex(retrievalQuery.query || buildMediaHintQuery(mediaHints, message), {
            limit: 5,
            filters: retrievalQuery.filters,
        });
    }
    let retrievalRelaxation = null;
    if (hasActiveRetrievalFilters(retrievalQuery.filters)) {
        const strictFilteredEntries = (Array.isArray(retrieval?.results) ? retrieval.results : [])
            .filter((entry) => matchesRetrievalFilters(entry?.product || {}, retrievalQuery.filters));
        retrieval = {
            ...retrieval,
            results: strictFilteredEntries,
            retrievalHitCount: strictFilteredEntries.length,
        };
    }
    if (!Number(retrieval?.retrievalHitCount || 0)) {
        for (const plan of buildRelaxedRetrievalPlans({ query: retrievalQuery.query, filters: retrievalQuery.filters })) {
            const relaxedRetrieval = await searchProductVectorIndex(plan.query, {
                limit: 5,
                filters: plan.filters,
            }).catch((error) => ({
                results: [],
                retrievalHitCount: 0,
                provider: 'relaxed_catalog_fallback',
                fallbackUsed: true,
                fallbackReason: safeString(error?.message || plan.reason),
            }));
            const relaxedEntries = (Array.isArray(relaxedRetrieval?.results) ? relaxedRetrieval.results : [])
                .filter((entry) => matchesRetrievalFilters(entry?.product || {}, plan.filters));
            if (relaxedEntries.length > 0) {
                retrieval = {
                    ...relaxedRetrieval,
                    results: relaxedEntries,
                    retrievalHitCount: relaxedEntries.length,
                    fallbackUsed: true,
                    fallbackReason: plan.reason,
                };
                retrievalRelaxation = plan;
                break;
            }
        }
    }
    retrieval = {
        ...retrieval,
        results: sortCommerceEntries(Array.isArray(retrieval?.results) ? retrieval.results : [], retrievalQuery.filters),
    };
    retrieval.retrievalHitCount = retrieval.results.length;
    const vectorStoreHealth = await vectorStoreHealthPromise;
    recordRetrievalMetric({
        route: ROUTE_ECOMMERCE,
        provider: safeString(retrieval?.provider || 'vector_store'),
        fallbackUsed: Boolean(retrieval?.fallbackUsed),
        reason: safeString(retrieval?.fallbackReason || retrievalQuery?.validator?.reason || 'none'),
        hitCount: Number(retrieval?.retrievalHitCount || 0),
    });
    const sourceProducts = retrieval.results.map((entry) => entry.product).filter(Boolean);
    const knowledgeRetrieval = await retrieveCommerceKnowledge({
        query: retrievalQuery.query || message,
        products: sourceProducts,
        limit: 6,
    }).catch((error) => {
        logger.warn('assistant.knowledge_retrieval.fallback', { error: error.message, traceId });
        return { chunks: [], citations: [], hitCount: 0, toolRun: null, contextText: '' };
    });
    if (!sourceProducts.length) {
        if (knowledgeRetrieval.hitCount > 0) {
            const knowledgeFollowUps = ['Track an order', 'Open support', 'Find a product'];
            const assistantTurn = buildAssistantTurn({
                intent: /\b(return|refund|cancel|warranty|support|delivery|track|coupon|payment|order)\b/i.test(message) ? 'support' : 'general_knowledge',
                confidence: 0.9,
                decision: 'respond',
                response: buildKnowledgeAnswerText(knowledgeRetrieval.chunks, { query: retrievalQuery.query || message }),
                followUps: knowledgeFollowUps,
                ui: { surface: 'plain_answer', title: 'Grounded store guidance', products: [] },
                verification: {
                    label: 'app_grounded',
                    confidence: 1,
                    summary: `Answer grounded in ${knowledgeRetrieval.hitCount} policy, FAQ, review, or product-knowledge chunk${knowledgeRetrieval.hitCount === 1 ? '' : 's'}.`,
                    evidenceCount: knowledgeRetrieval.hitCount,
                },
                citations: knowledgeRetrieval.citations,
                toolRuns: knowledgeRetrieval.toolRun ? [knowledgeRetrieval.toolRun] : [],
                answerMode: 'commerce',
            });
            return buildResponseEnvelope({
                assistantTurn,
                route: ROUTE_ECOMMERCE,
                provider: 'local_knowledge',
                providerModel: '',
                products: [],
                followUps: assistantTurn.followUps,
                sessionId,
                traceId,
                assistantMode,
                assistantSession: {
                    ...assistantSession,
                    lastIntent: assistantTurn.intent,
                    lastEntities: {
                        ...assistantSession.lastEntities,
                        query: safeString(retrievalQuery.query || message),
                    },
                    lastResults: [],
                    activeProduct: null,
                    pendingAction: null,
                },
                health: {
                    gateway: gatewayHealth,
                    vectorStore: vectorStoreHealth,
                },
                providerCapabilities: gatewayHealth?.capabilities || null,
                retrievalHitCount: knowledgeRetrieval.hitCount,
                validator: {
                    ok: true,
                    reason: 'knowledge_only_grounding',
                    retrievalQuery: retrievalQuery.validator,
                    retrievalProvider: safeString(retrieval?.provider || ''),
                    knowledgeHitCount: knowledgeRetrieval.hitCount,
                },
                messageId: createMessageId(),
            });
        }
        const noResultResponse = buildNoResultResponseText({
            query: retrievalQuery.query || message,
            filters: retrievalQuery.filters,
        });
        const followUps = buildNoResultFollowUps(retrievalQuery.filters);
        const assistantTurn = buildAssistantTurn({
            intent: 'product_search',
            confidence: 0.96,
            decision: 'respond',
            response: noResultResponse,
            followUps,
            ui: { surface: 'plain_answer', title: 'No verified match', products: [] },
            verification: { label: 'app_grounded', confidence: 1, summary: 'No indexed product matched the request, and no unrelated products were returned.' },
            answerMode: 'commerce',
        });
        return buildResponseEnvelope({
            assistantTurn,
            route: ROUTE_ECOMMERCE,
            provider: 'rule',
            providerModel: '',
            products: [],
            followUps: assistantTurn.followUps,
            sessionId,
            traceId,
            assistantMode,
            assistantSession: {
                ...assistantSession,
                lastIntent: 'product_search',
                lastEntities: {
                    ...assistantSession.lastEntities,
                    query: safeString(retrievalQuery.query || message),
                    maxPrice: Number(retrievalQuery?.filters?.maxPrice || assistantSession?.lastEntities?.maxPrice || 0),
                    category: safeString(retrievalQuery?.filters?.category || assistantSession?.lastEntities?.category || ''),
                },
                lastResults: [],
                activeProduct: null,
                pendingAction: null,
            },
            health: {
                gateway: gatewayHealth,
                vectorStore: vectorStoreHealth,
            },
            providerCapabilities: gatewayHealth?.capabilities || null,
            retrievalHitCount: 0,
            validator: {
                ok: true,
                reason: 'no_results',
                retrievalQuery: retrievalQuery.validator,
                retrievalProvider: safeString(retrieval?.provider || ''),
                retrievalReason: safeString(retrieval?.fallbackReason || ''),
            },
            messageId: createMessageId(),
        });
    }

    const normalizedProducts = sourceProducts.map((product) => ({ ...product, ...normalizeProductCard(product) }));
    const allowedIds = normalizedProducts.map((product) => String(product.id));
    let provider = 'rule';
    let providerModel = '';
    let validator = { ok: true, reason: 'deterministic_summary' };
    let modelPayload = null;
    const useModelSummary = isCommerceModelSummaryEnabled({ requireHostedGemma });

    if (useModelSummary) {
        try {
        const history = trimConversationHistory(conversationHistory).map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`).join('\n');
        const groundingProducts = normalizedProducts.map((product) => ({
            id: product.id,
            title: product.title,
            brand: product.brand,
            category: product.category,
            price: product.price,
            originalPrice: product.originalPrice,
            discountPercentage: product.discountPercentage,
            stock: product.stock,
            rating: product.rating,
            ratingCount: product.ratingCount,
            description: safeString(product.description || ''),
            highlights: Array.isArray(product.highlights) ? product.highlights : [],
            specifications: Array.isArray(product.specifications) ? product.specifications : [],
        }));
        const databaseJson = JSON.stringify(groundingProducts);
        const knowledgeJson = JSON.stringify((Array.isArray(knowledgeRetrieval.chunks) ? knowledgeRetrieval.chunks : [])
            .map((chunk) => ({
                id: chunk.id,
                type: chunk.sourceType,
                title: chunk.title,
                text: chunk.text,
                policyType: chunk.policyType,
                metadata: chunk.metadata || {},
            })));
        const attempts = [
            {
                systemPrompt: [
                    'You are Aura, a controlled ecommerce assistant.',
                    'Return valid JSON only.',
                    'Use ONLY the provided product JSON and knowledge JSON.',
                    'Product JSON is authoritative for product, price, stock, rating, and spec facts in this turn.',
                    'Knowledge JSON is authoritative for policies, FAQs, reviews, manuals, and support workflow guidance.',
                    'Never invent products, prices, stock, ratings, specs, discounts, delivery dates, refund promises, or policy exceptions.',
                    'If data is missing, say "Not available".',
                    'Schema: {"answer":"string","productIds":["string"],"focusProductId":"string","followUps":["string"]}.',
                    'Do not echo placeholder values like "string". Fill the fields with real content.',
                    `DATABASE:\n${databaseJson}`,
                    `KNOWLEDGE:\n${knowledgeJson}`,
                ].join('\n'),
                prompt: [
                    history ? `Conversation:\n${history}` : '',
                    `User query: ${message || 'Analyze the provided input.'}`,
                    retrievalQuery.query ? `Retrieval query: ${retrievalQuery.query}` : '',
                    hasActiveRetrievalFilters(retrievalQuery.filters) ? `Applied filters: ${JSON.stringify(retrievalQuery.filters)}` : '',
                    retrievalRelaxation ? `Exact filters had no catalog hits. These are relaxed alternatives after ${safeString(retrievalRelaxation.label)}; say that clearly.` : '',
                    'Return JSON only.',
                ].filter(Boolean).join('\n\n'),
            },
            {
                systemPrompt: [
                    'You are Aura, a controlled ecommerce assistant.',
                    'Return valid JSON only.',
                    'Use ONLY the provided product JSON and knowledge JSON.',
                    'Never invent products, prices, stock, ratings, specs, discounts, delivery dates, or refund promises.',
                    `Example valid JSON: {"answer":"${safeString(normalizedProducts[0]?.title || 'Top match')} is a strong match at Rs. ${Number(normalizedProducts[0]?.price || 0)}.","productIds":["${safeString(allowedIds[0] || '')}"],"focusProductId":"${safeString(allowedIds[0] || '')}","followUps":["Compare the top results","Set a price limit"]}.`,
                    `DATABASE:\n${databaseJson}`,
                    `KNOWLEDGE:\n${knowledgeJson}`,
                ].join('\n'),
                prompt: [
                    `User query: ${message || retrievalQuery.query || 'Analyze the provided input.'}`,
                    hasActiveRetrievalFilters(retrievalQuery.filters) ? `Applied filters: ${JSON.stringify(retrievalQuery.filters)}` : '',
                    retrievalRelaxation ? `Relaxed alternatives: ${safeString(retrievalRelaxation.label)}.` : '',
                ].filter(Boolean).join('\n\n'),
            },
        ];

        let parsed = null;
        let response = null;
        for (const attempt of attempts) {
            response = await generateStructuredJson({
                systemPrompt: attempt.systemPrompt,
                prompt: attempt.prompt,
                route: ROUTE_ECOMMERCE,
                temperature: 0.15,
                images,
                audio,
                responseJsonSchema: COMMERCE_RESPONSE_SCHEMA,
                ...buildCommerceModelProviderOptions(requireHostedGemma),
            });
            parsed = validateCommercePayload(response.data, allowedIds);
            if (parsed.ok) {
                break;
            }
        }

        if (!parsed?.ok || !response) throw new Error('invalid_commerce_payload');
        if (requireHostedGemma && (
            safeString(response.provider || '').toLowerCase() !== HOSTED_GEMMA_PROVIDER
            || !isGemmaModel(response.providerModel || gatewayHealth?.resolvedChatModel || gatewayHealth?.chatModel || '')
        )) {
            throw new Error('hosted_gemma_provider_mismatch');
        }
        provider = response.provider;
        providerModel = response.providerModel;
        gatewayHealth = await checkModelGatewayHealth({
            provider: requireHostedGemma ? HOSTED_GEMMA_PROVIDER : provider,
            disableProviderFallback: requireHostedGemma,
            force: true,
        }).catch(() => getModelGatewayHealth());
        validator = parsed.rejectedProductIds.length > 0
            ? { ok: false, reason: 'unknown_product_ids_stripped', rejectedProductIds: parsed.rejectedProductIds }
            : { ok: true, reason: 'model_json_valid' };
        modelPayload = parsed.data;
        } catch (error) {
        recordFallbackMetric(safeString(error?.message || 'commerce_fallback'));
        logger.warn('assistant.commerce.fallback', { error: error.message, traceId });
        if (requireHostedGemma) {
            return buildHostedGemmaUnavailableEnvelope({
                message,
                sessionId,
                traceId,
                assistantMode,
                assistantSession,
                gatewayHealth,
                vectorStoreHealth,
                reason: safeString(error?.message || 'hosted_gemma_generation_failed'),
                products: normalizedProducts,
                retrieval,
                retrievalQuery,
                retrievalRelaxation,
            });
        }
        }
    }
    if (!useModelSummary) {
        validator = { ok: true, reason: 'deterministic_summary_fast_catalog' };
    }

    const selectedProducts = modelPayload?.productIds?.length
        ? normalizedProducts.filter((product) => modelPayload.productIds.includes(String(product.id)))
        : normalizedProducts.slice(0, 3);
    const focusProduct = modelPayload?.focusProductId
        ? normalizedProducts.find((product) => String(product.id) === String(modelPayload.focusProductId))
        : selectedProducts[0];
    const decoratedSelectedProducts = decorateCommerceProducts(selectedProducts, retrievalQuery.filters);
    const decoratedFocusProduct = focusProduct
        ? decoratedSelectedProducts.find((product) => String(product.id) === String(focusProduct.id)) || normalizeProductCard(focusProduct)
        : null;
    const followUps = modelPayload?.followUps?.length
        ? modelPayload.followUps
        : ['Compare the top results', 'Show another category', 'Set a price limit'];
    const productCitations = selectedProducts.map((product) => ({
        id: String(product.id),
        label: safeString(product.title || ''),
        type: 'product',
        title: safeString(product.title || ''),
        excerpt: `Price Rs. ${Number(product.price || 0)} | Stock ${Math.max(0, Number(product.stock || 0))}`,
        score: Math.min(1, Number(retrieval.results.find((entry) => Number(entry?.product?.id) === Number(product.id))?.score || 0)),
    }));
    const toolRuns = [{
        id: `retrieval-${Date.now()}`,
        toolName: 'search_products',
        status: 'completed',
        latencyMs: 0,
        summary: `${retrieval.retrievalHitCount} catalog hits`,
        inputPreview: { query: safeString(retrievalQuery.query || buildMediaHintQuery(mediaHints, message)) },
        outputPreview: { productIds: selectedProducts.map((product) => String(product.id)) },
    }];
    if (knowledgeRetrieval.toolRun && knowledgeRetrieval.hitCount > 0) {
        toolRuns.push(knowledgeRetrieval.toolRun);
    }
    const evidenceCount = decoratedSelectedProducts.length + Math.max(0, Number(knowledgeRetrieval.hitCount || 0));
    const assistantTurn = buildAssistantTurn({
        intent: selectedProducts.length === 1 ? 'product_selection' : 'product_search',
        confidence: provider !== 'rule' ? 0.92 : 0.74,
        decision: 'respond',
        response: buildCommerceResponseText({
            answer: modelPayload?.answer || summarizeProducts(selectedProducts),
            products: selectedProducts,
            filters: retrievalQuery.filters,
            relaxation: retrievalRelaxation,
        }),
        followUps,
        ui: {
            surface: decoratedSelectedProducts.length === 1 ? 'product_focus' : 'product_results',
            title: decoratedSelectedProducts.length === 1 ? safeString(decoratedFocusProduct?.title || '') : 'Validated results',
            products: decoratedSelectedProducts,
            product: decoratedSelectedProducts.length === 1 && decoratedFocusProduct ? decoratedFocusProduct : null,
            insights: buildCommerceResultInsights(decoratedSelectedProducts, retrievalQuery.filters, retrievalRelaxation),
        },
        verification: {
            label: 'app_grounded',
            confidence: 1,
            summary: `Answer grounded in ${decoratedSelectedProducts.length} retrieved catalog result${decoratedSelectedProducts.length === 1 ? '' : 's'} and ${Math.max(0, Number(knowledgeRetrieval.hitCount || 0))} knowledge chunk${knowledgeRetrieval.hitCount === 1 ? '' : 's'}.`,
            evidenceCount,
        },
        citations: [...productCitations, ...(Array.isArray(knowledgeRetrieval.citations) ? knowledgeRetrieval.citations : [])],
        toolRuns,
        answerMode: 'commerce',
    });

    return buildResponseEnvelope({
        assistantTurn,
        route: ROUTE_ECOMMERCE,
        provider,
        providerModel,
        products: decoratedSelectedProducts,
        followUps,
        sessionId,
        traceId,
        assistantMode,
        assistantSession: {
            ...assistantSession,
            lastIntent: assistantTurn.intent,
            lastEntities: {
                ...assistantSession.lastEntities,
                query: safeString(retrievalQuery.query || message),
                maxPrice: Number(retrievalQuery?.filters?.maxPrice || assistantSession?.lastEntities?.maxPrice || 0),
                productId: safeString(decoratedFocusProduct?.id || ''),
                category: safeString(retrievalQuery?.filters?.category || decoratedSelectedProducts[0]?.category || context?.category || ''),
            },
            lastResolvedEntityId: safeString(decoratedFocusProduct?.id || ''),
            lastResults: decoratedSelectedProducts,
            activeProduct: decoratedFocusProduct,
            pendingAction: null,
        },
        health: {
            gateway: gatewayHealth,
            vectorStore: vectorStoreHealth,
        },
        providerCapabilities: gatewayHealth?.capabilities || null,
        retrievalHitCount: retrieval.retrievalHitCount + Math.max(0, Number(knowledgeRetrieval.hitCount || 0)),
        validator: {
            ...validator,
            retrievalQuery: retrievalQuery.validator,
            retrievalProvider: safeString(retrieval?.provider || ''),
            retrievalReason: safeString(retrieval?.fallbackReason || ''),
            knowledgeHitCount: Math.max(0, Number(knowledgeRetrieval.hitCount || 0)),
            retrievalRelaxation: retrievalRelaxation ? {
                reason: retrievalRelaxation.reason,
                label: retrievalRelaxation.label,
            } : null,
        },
        messageId: createMessageId(),
    });
};

const parseOrderId = (message = '') => {
    const match = safeString(message).match(/\b([a-f0-9]{24})\b/i);
    return match?.[1] ? safeString(match[1]) : '';
};

const parseCouponCode = (message = '') => {
    const normalized = safeString(message).toUpperCase();
    const quoted = normalized.match(/\b(?:COUPON|CODE|PROMO)\s+([A-Z0-9_-]{3,30})\b/);
    if (quoted?.[1]) return safeString(quoted[1]);
    const afterApply = normalized.match(/\b(?:APPLY|USE)\s+([A-Z0-9_-]{3,30})(?:\s+(?:COUPON|CODE|PROMO))?\b/);
    return afterApply?.[1] ? safeString(afterApply[1]) : '';
};

const loadLatestOrder = async (userId) => (userId
    ? Order.findOne({ user: userId }).sort({ createdAt: -1 }).select('orderStatus totalPrice createdAt paymentState paymentMethod isDelivered refundSummary commandCenter').lean()
    : null);

const buildActionContext = ({ context = {}, assistantSession = {} } = {}) => ({
    ...context,
    currentProductId: safeString(
        context?.currentProductId
        || assistantSession?.activeProduct?.id
        || assistantSession?.lastResolvedEntityId
        || assistantSession?.lastEntities?.productId
        || ''
    ),
    candidateProductIds: uniq([
        ...(Array.isArray(context?.candidateProductIds) ? context.candidateProductIds : []),
        ...(Array.isArray(assistantSession?.lastResults)
            ? assistantSession.lastResults.map((product) => safeString(product?.id || ''))
            : []),
    ]),
});

const resolveProductForAction = async ({ message = '', context = {} } = {}) => {
    const explicitProductId = safeString(context?.currentProductId || '');
    if (explicitProductId) {
        const numericId = Number(explicitProductId);
        if (Number.isInteger(numericId) && numericId > 0) {
            const direct = await Product.findOne({ id: numericId, isPublished: true }).select(PRODUCT_CARD_SELECT).lean();
            if (direct) return normalizeProductCard(direct);
        }
    }
    const cleaned = safeString(message).replace(/\b(add|remove|from|to|cart|please|my|the|a|an)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const retrieval = await searchProductVectorIndex(cleaned || message, { limit: 1 });
    return retrieval.results?.[0]?.product ? normalizeProductCard(retrieval.results[0].product) : null;
};

const buildConfirmationEnvelope = ({
    action,
    assistantSession,
    sessionId,
    traceId,
    assistantMode,
    responseText,
    intent = 'cart_action',
    entities = {},
} = {}) => {
    const nextContextVersion = Math.max(1, Number(assistantSession?.contextVersion || 0) + 1);
    const pendingAction = {
        actionId: buildConfirmationToken(action),
        actionType: safeString(action?.type || ''),
        risk: 'mutation',
        contextVersion: nextContextVersion,
        intent,
        message: safeString(responseText),
        action,
        entities,
        createdAt: Date.now(),
    };
    const nextSession = {
        ...assistantSession,
        contextVersion: nextContextVersion,
        lastIntent: intent,
        lastEntities: { ...assistantSession.lastEntities, ...entities },
        pendingAction,
    };
    const assistantTurn = buildAssistantTurn({
        intent,
        confidence: 0.99,
        decision: 'respond',
        response: responseText,
        ui: {
            surface: 'confirmation_card',
            confirmation: {
                token: pendingAction.actionId,
                message: responseText,
                action,
            },
        },
        verification: {
            label: 'app_grounded',
            confidence: 1,
            summary: 'Action requires explicit confirmation before execution.',
        },
        policy: {
            actionType: safeString(action?.type || ''),
            risk: 'mutation',
            decision: 'CONFIRM',
            reason: 'user_confirmation_required',
        },
        answerMode: 'commerce',
    });
    return buildResponseEnvelope({
        assistantTurn,
        route: ROUTE_ACTION,
        provider: 'rule',
        providerModel: '',
        products: [],
        followUps: ['Yes, continue', 'No, cancel'],
        sessionId,
        traceId,
        assistantMode,
        assistantSession: nextSession,
        health: { gateway: getModelGatewayHealth() },
        retrievalHitCount: 0,
        validator: { ok: true, reason: 'confirmation_required' },
        messageId: createMessageId(),
    });
};

const getActionConfirmationText = (action = {}) => {
    const type = safeString(action?.type || '');
    if (type === 'go_to_checkout') return 'I can take you to checkout. Confirm and I will continue.';
    if (type === 'remove_from_cart') return `Remove ${safeString(action.product?.title || 'this item')} from your cart?`;
    if (type === 'add_to_cart') return `Add ${safeString(action.product?.title || 'this item')} to your cart?`;
    if (type === 'cancel_order') return `Cancel order ${safeString(action.orderId || '').slice(-6) || 'selected'}? I will send this to the live order API after you confirm.`;
    if (type === 'create_return_request') return `Create a ${safeString(action.requestType || 'return')} request for order ${safeString(action.orderId || '').slice(-6) || 'selected'}? I will send it to the live order API after you confirm.`;
    return 'Confirm this action and I will continue.';
};

const getConfirmedActionResponseText = (action = {}) => {
    const type = safeString(action?.type || '');
    if (type === 'go_to_checkout') return 'Taking you to checkout.';
    if (type === 'remove_from_cart') return 'Removing that item from your cart.';
    if (type === 'add_to_cart') return 'Adding that item to your cart.';
    if (type === 'cancel_order') return 'Cancelling that order through the live order API.';
    if (type === 'create_return_request') return `Creating that ${safeString(action.requestType || 'return')} request through the live order API.`;
    return 'Running that action.';
};

const getActionIntent = (action = {}) => {
    const type = safeString(action?.type || '');
    if (type === 'go_to_checkout') return 'checkout';
    if (type === 'cancel_order' || type === 'create_return_request') return 'support';
    return 'cart_action';
};

const respondToConfirmation = ({ confirmation = null, assistantSession = {}, sessionId = '', traceId = '', assistantMode = 'chat' } = {}) => {
    const pendingAction = assistantSession?.pendingAction || null;
    if (!pendingAction || safeString(confirmation?.actionId || '') !== safeString(pendingAction?.actionId || '')) {
        const assistantTurn = buildAssistantTurn({
            intent: 'navigation',
            confidence: 1,
            decision: 'respond',
            response: 'That confirmation is no longer valid. Please ask again so I can rebuild it safely.',
            ui: { surface: 'plain_answer' },
            verification: { label: 'app_grounded', confidence: 1, summary: 'Pending action token was missing or expired.' },
        });
        return buildResponseEnvelope({
            assistantTurn,
            route: ROUTE_ACTION,
            provider: 'rule',
            providerModel: '',
            products: [],
            followUps: ['Try again'],
            sessionId,
            traceId,
            assistantMode,
            assistantSession: { ...assistantSession, pendingAction: null, contextVersion: Math.max(1, Number(assistantSession?.contextVersion || 0) + 1) },
            health: { gateway: getModelGatewayHealth() },
            retrievalHitCount: 0,
            validator: { ok: false, reason: 'missing_pending_action' },
            messageId: createMessageId(),
        });
    }

    if (Number(confirmation?.contextVersion || 0) > 0 && Number(confirmation.contextVersion) !== Number(pendingAction.contextVersion || 0)) {
        const assistantTurn = buildAssistantTurn({
            intent: safeString(pendingAction?.intent || 'navigation'),
            confidence: 1,
            decision: 'respond',
            response: 'That action context changed, so I did not continue. Please ask again.',
            ui: { surface: 'plain_answer' },
            verification: { label: 'app_grounded', confidence: 1, summary: 'Pending action context version mismatch.' },
        });
        return buildResponseEnvelope({
            assistantTurn,
            route: ROUTE_ACTION,
            provider: 'rule',
            providerModel: '',
            products: [],
            followUps: ['Try again'],
            sessionId,
            traceId,
            assistantMode,
            assistantSession: { ...assistantSession, pendingAction: null, contextVersion: Math.max(1, Number(assistantSession?.contextVersion || 0) + 1) },
            health: { gateway: getModelGatewayHealth() },
            retrievalHitCount: 0,
            validator: { ok: false, reason: 'context_version_mismatch' },
            messageId: createMessageId(),
        });
    }

    if (!confirmation?.approved) {
        const assistantTurn = buildAssistantTurn({
            intent: safeString(pendingAction?.intent || 'navigation'),
            confidence: 1,
            decision: 'respond',
            response: 'Okay, I will hold here.',
            ui: { surface: 'plain_answer' },
            verification: { label: 'app_grounded', confidence: 1, summary: 'User declined the pending action.' },
        });
        return buildResponseEnvelope({
            assistantTurn,
            route: ROUTE_ACTION,
            provider: 'rule',
            providerModel: '',
            products: [],
            followUps: ['Show my cart', 'Keep browsing'],
            sessionId,
            traceId,
            assistantMode,
            assistantSession: { ...assistantSession, pendingAction: null, contextVersion: Math.max(1, Number(assistantSession?.contextVersion || 0) + 1) },
            health: { gateway: getModelGatewayHealth() },
            retrievalHitCount: 0,
            validator: { ok: true, reason: 'confirmation_declined' },
            messageId: createMessageId(),
        });
    }

    const action = pendingAction.action || null;
    const validation = validateAssistantAction(action);
    recordToolValidationMetric({ tool: safeString(action?.type || 'unknown'), ok: validation.ok });
    if (!validation.ok) {
        const assistantTurn = buildAssistantTurn({
            intent: safeString(pendingAction?.intent || 'navigation'),
            confidence: 1,
            decision: 'respond',
            response: 'I blocked that action because it did not pass validation.',
            ui: { surface: 'plain_answer' },
            verification: { label: 'app_grounded', confidence: 1, summary: 'Action failed validation after confirmation.' },
            policy: { actionType: safeString(action?.type || ''), risk: validation.definition?.mutation ? 'mutation' : 'low', decision: 'REJECT', reason: validation.reason },
        });
        return buildResponseEnvelope({
            assistantTurn,
            route: ROUTE_ACTION,
            provider: 'rule',
            providerModel: '',
            products: [],
            followUps: ['Try again'],
            sessionId,
            traceId,
            assistantMode,
            assistantSession: { ...assistantSession, pendingAction: null, contextVersion: Math.max(1, Number(assistantSession?.contextVersion || 0) + 1) },
            health: { gateway: getModelGatewayHealth() },
            retrievalHitCount: 0,
            validator: { ok: false, reason: validation.reason },
            messageId: createMessageId(),
        });
    }

    const assistantTurn = buildAssistantTurn({
        intent: safeString(pendingAction?.intent || 'navigation'),
        confidence: 1,
        decision: 'act',
        response: getConfirmedActionResponseText(action),
        actions: [action],
        ui: {
            surface: action?.type === 'go_to_checkout' ? 'navigation_notice' : 'plain_answer',
            navigation: action?.type === 'go_to_checkout' ? { page: 'checkout', path: '/checkout', params: {} } : null,
        },
        verification: { label: 'app_grounded', confidence: 1, summary: 'Action confirmed and validated.' },
        answerMode: 'commerce',
    });
    return buildResponseEnvelope({
        assistantTurn,
        route: ROUTE_ACTION,
        provider: 'rule',
        providerModel: '',
        products: [],
        followUps: [],
        sessionId,
        traceId,
        assistantMode,
        assistantSession: { ...assistantSession, pendingAction: null, contextVersion: Math.max(1, Number(assistantSession?.contextVersion || 0) + 1) },
        health: { gateway: getModelGatewayHealth() },
        retrievalHitCount: 0,
        validator: { ok: true, reason: 'confirmed' },
        messageId: createMessageId(),
    });
};

const resolveActionPlan = async ({ message = '', actionRequest = null, user = null, context = {} } = {}) => {
    if (actionRequest?.type) {
        const type = safeString(actionRequest.type).toLowerCase();
        if (type === 'checkout') return { type: 'go_to_checkout', requiresConfirmation: true };
        if (type === 'support') return { type: 'open_support', orderId: safeString(actionRequest?.orderId || ''), prefill: actionRequest?.prefill || {}, requiresConfirmation: false };
        if (type === 'track_order') return { type: 'track_order', orderId: safeString(actionRequest?.orderId || ''), requiresConfirmation: false };
        if (type === 'navigate_to') return { type: 'navigate_to', page: safeString(actionRequest?.page || ''), params: actionRequest?.params || {}, requiresConfirmation: false };
        if (type === 'get_product_details' || type === 'check_inventory' || type === 'get_price') {
            return { type, productId: safeString(actionRequest?.productId || context?.currentProductId || ''), requiresConfirmation: false };
        }
        if (type === 'compare_products') {
            return { type, productIds: Array.isArray(actionRequest?.productIds) ? actionRequest.productIds.map((entry) => safeString(entry)).filter(Boolean) : [], query: safeString(actionRequest?.query || message), requiresConfirmation: false };
        }
        if (type === 'recommend_products') {
            return { type, query: safeString(actionRequest?.query || message || 'recommended products'), filters: actionRequest?.filters || {}, requiresConfirmation: false };
        }
        if (type === 'apply_coupon') {
            return { type, couponCode: safeString(actionRequest?.couponCode || parseCouponCode(message)), requiresConfirmation: false };
        }
        if (type === 'cancel_order') {
            const requestedId = safeString(actionRequest?.orderId || parseOrderId(message));
            const latestOrder = requestedId
                ? await Order.findOne({ _id: requestedId, user: user?._id }).select('orderStatus totalPrice createdAt paymentState paymentMethod isDelivered').lean()
                : await loadLatestOrder(user?._id);
            return {
                type,
                orderId: safeString(latestOrder?._id || requestedId || ''),
                reason: safeString(actionRequest?.reason || 'Requested from assistant'),
                order: latestOrder || null,
                unresolved: !safeString(latestOrder?._id || requestedId || ''),
                requiresConfirmation: true,
            };
        }
        if (type === 'create_return_request') {
            const requestedId = safeString(actionRequest?.orderId || parseOrderId(message));
            const latestOrder = requestedId
                ? await Order.findOne({ _id: requestedId, user: user?._id }).select('orderStatus totalPrice createdAt paymentState paymentMethod isDelivered refundSummary').lean()
                : await loadLatestOrder(user?._id);
            return {
                type,
                orderId: safeString(latestOrder?._id || requestedId || ''),
                requestType: safeString(actionRequest?.requestType || 'refund'),
                reason: safeString(actionRequest?.reason || message || 'Requested from assistant'),
                amount: Math.max(0, Number(actionRequest?.amount || 0)),
                order: latestOrder || null,
                unresolved: !safeString(latestOrder?._id || requestedId || ''),
                requiresConfirmation: true,
            };
        }
        if (type === 'get_payment_status') {
            const requestedId = safeString(actionRequest?.orderId || parseOrderId(message));
            const latestOrder = requestedId
                ? await Order.findOne({ _id: requestedId, user: user?._id }).select('orderStatus totalPrice createdAt paymentState paymentMethod isDelivered').lean()
                : await loadLatestOrder(user?._id);
            return { type, orderId: safeString(latestOrder?._id || requestedId || ''), order: latestOrder || null, unresolved: !safeString(latestOrder?._id || requestedId || ''), requiresConfirmation: false };
        }
    }

    const normalized = safeString(message).toLowerCase();
    if (/\bshow (my )?cart\b/i.test(normalized) || /\bopen cart\b/i.test(normalized)) {
        return { type: 'navigate_to', page: 'cart', params: {}, requiresConfirmation: false };
    }
    if (/\bcheckout\b/i.test(normalized) || /\bbuy now\b/i.test(normalized)) {
        return { type: 'go_to_checkout', requiresConfirmation: true };
    }
    if (/\b(apply|use)\b/i.test(normalized) && /\b(coupon|promo|code)\b/i.test(normalized)) {
        return { type: 'apply_coupon', couponCode: parseCouponCode(normalized), requiresConfirmation: false };
    }
    if (/\btrack (my )?order\b/i.test(normalized) || /\border status\b/i.test(normalized)) {
        const requestedId = parseOrderId(normalized);
        const latestOrder = requestedId
            ? await Order.findOne({ _id: requestedId, user: user?._id }).select('orderStatus totalPrice createdAt paymentState paymentMethod isDelivered').lean()
            : await loadLatestOrder(user?._id);
        return { type: 'track_order', orderId: safeString(latestOrder?._id || requestedId || ''), order: latestOrder || null, requiresConfirmation: false };
    }
    if (/\bcancel\b/i.test(normalized) && /\border\b/i.test(normalized)) {
        const requestedId = parseOrderId(normalized);
        const latestOrder = requestedId
            ? await Order.findOne({ _id: requestedId, user: user?._id }).select('orderStatus totalPrice createdAt paymentState paymentMethod isDelivered').lean()
            : await loadLatestOrder(user?._id);
        return {
            type: 'cancel_order',
            orderId: safeString(latestOrder?._id || requestedId || ''),
            reason: safeString(message || 'Requested from assistant'),
            order: latestOrder || null,
            unresolved: !safeString(latestOrder?._id || requestedId || ''),
            requiresConfirmation: true,
        };
    }
    if (/\b(return|refund|replace|replacement)\b/i.test(normalized) && /\border\b/i.test(normalized)) {
        const requestedId = parseOrderId(normalized);
        const latestOrder = requestedId
            ? await Order.findOne({ _id: requestedId, user: user?._id }).select('orderStatus totalPrice createdAt paymentState paymentMethod isDelivered refundSummary').lean()
            : await loadLatestOrder(user?._id);
        return {
            type: 'create_return_request',
            orderId: safeString(latestOrder?._id || requestedId || ''),
            requestType: /\b(replace|replacement)\b/i.test(normalized) ? 'replacement' : 'refund',
            reason: safeString(message || 'Requested from assistant'),
            order: latestOrder || null,
            unresolved: !safeString(latestOrder?._id || requestedId || ''),
            requiresConfirmation: true,
        };
    }
    if (/\b(payment|paid|charge|refund status)\b/i.test(normalized) && /\border\b/i.test(normalized)) {
        const requestedId = parseOrderId(normalized);
        const latestOrder = requestedId
            ? await Order.findOne({ _id: requestedId, user: user?._id }).select('orderStatus totalPrice createdAt paymentState paymentMethod isDelivered').lean()
            : await loadLatestOrder(user?._id);
        return { type: 'get_payment_status', orderId: safeString(latestOrder?._id || requestedId || ''), order: latestOrder || null, unresolved: !safeString(latestOrder?._id || requestedId || ''), requiresConfirmation: false };
    }
    if (/\bsupport\b/i.test(normalized) || /\bhelp with order\b/i.test(normalized)) {
        const requestedId = parseOrderId(normalized);
        const orderScoped = requestedId || /\border\b/i.test(normalized);
        const latestOrder = orderScoped
            ? (requestedId
                ? await Order.findOne({ _id: requestedId, user: user?._id }).select('orderStatus totalPrice createdAt').lean()
                : await loadLatestOrder(user?._id))
            : null;
        return {
            type: 'open_support',
            orderId: safeString(latestOrder?._id || requestedId || ''),
            prefill: {
                subject: orderScoped ? 'Order support request' : 'Customer support request',
                category: latestOrder || requestedId ? 'order_help' : 'general_help',
                body: safeString(message),
            },
            requiresConfirmation: false,
        };
    }
    if (/\bremove\b/i.test(normalized) && /\bcart\b/i.test(normalized)) {
        const product = await resolveProductForAction({ message, context });
        return product
            ? { type: 'remove_from_cart', productId: String(product.id), quantity: 1, product, requiresConfirmation: true }
            : { type: 'remove_from_cart', unresolved: true, requiresConfirmation: true };
    }
    if (/\badd\b/i.test(normalized) && /\bcart\b/i.test(normalized)) {
        const product = await resolveProductForAction({ message, context });
        return product
            ? { type: 'add_to_cart', productId: String(product.id), quantity: 1, product, requiresConfirmation: true }
            : { type: 'add_to_cart', unresolved: true, requiresConfirmation: true };
    }
    return null;
};

const performActionTurn = async ({
    message = '',
    actionRequest = null,
    confirmation = null,
    user = null,
    assistantMode = 'chat',
    sessionId = '',
    traceId = '',
    assistantSession = {},
    context = {},
} = {}) => {
    if (confirmation?.actionId) {
        return respondToConfirmation({ confirmation, assistantSession, sessionId, traceId, assistantMode });
    }

    const actionContext = buildActionContext({ context, assistantSession });
    const action = await resolveActionPlan({ message, actionRequest, user, context: actionContext });
    if (!action) {
        const assistantTurn = buildAssistantTurn({
            intent: 'navigation',
            confidence: 0.8,
            decision: 'respond',
            response: 'I could not resolve a supported action from that request.',
            ui: { surface: 'plain_answer' },
            followUps: ['Show my cart', 'Track my last order', 'Open support'],
            verification: { label: 'app_grounded', confidence: 1, summary: 'No supported assistant action matched the request.' },
        });
        return buildResponseEnvelope({
            assistantTurn,
            route: ROUTE_ACTION,
            provider: 'rule',
            providerModel: '',
            products: [],
            followUps: assistantTurn.followUps,
            sessionId,
            traceId,
            assistantMode,
            assistantSession: { ...assistantSession, pendingAction: null },
            health: { gateway: getModelGatewayHealth() },
            retrievalHitCount: 0,
            validator: { ok: false, reason: 'unresolved_action' },
            messageId: createMessageId(),
        });
    }

    const validation = validateAssistantAction(action);
    recordToolValidationMetric({ tool: safeString(action?.type || 'unknown'), ok: validation.ok });
    if (!validation.ok) {
        logger.warn('assistant.action.blocked', { actionType: action.type, reason: validation.reason, traceId });
        const assistantTurn = buildAssistantTurn({
            intent: 'navigation',
            confidence: 1,
            decision: 'respond',
            response: 'I blocked that action because it did not pass policy validation.',
            ui: { surface: 'plain_answer' },
            verification: { label: 'app_grounded', confidence: 1, summary: 'Action validation blocked the request.' },
            policy: { actionType: safeString(action?.type || ''), risk: validation.definition?.mutation ? 'mutation' : 'low', decision: 'REJECT', reason: validation.reason },
        });
        return buildResponseEnvelope({
            assistantTurn,
            route: ROUTE_ACTION,
            provider: 'rule',
            providerModel: '',
            products: [],
            followUps: ['Try another action'],
            sessionId,
            traceId,
            assistantMode,
            assistantSession: { ...assistantSession, pendingAction: null },
            health: { gateway: getModelGatewayHealth() },
            retrievalHitCount: 0,
            validator: { ok: false, reason: validation.reason },
            messageId: createMessageId(),
        });
    }

    if (['get_product_details', 'check_inventory', 'get_price'].includes(action.type)) {
        const product = await resolveProductForAction({
            message,
            context: { ...actionContext, currentProductId: safeString(action.productId || actionContext.currentProductId || '') },
        });
        const assistantTurn = buildAssistantTurn({
            intent: 'product_selection',
            confidence: product?.id ? 0.96 : 0.7,
            decision: 'respond',
            response: product?.id
                ? [
                    `${safeString(product.title || 'That product')} is currently Rs. ${Number(product.price || 0)}.`,
                    `Stock: ${Math.max(0, Number(product.stock || 0))}.`,
                    product.rating ? `Rating: ${Number(product.rating || 0)} from ${Math.max(0, Number(product.ratingCount || 0))} rating${Number(product.ratingCount || 0) === 1 ? '' : 's'}.` : '',
                ].filter(Boolean).join(' ')
                : 'I could not resolve an authoritative product for that live lookup.',
            actions: product?.id ? [{ type: 'select_product', productId: String(product.id) }] : [],
            ui: {
                surface: product?.id ? 'product_focus' : 'plain_answer',
                title: safeString(product?.title || ''),
                product: product?.id ? product : null,
                products: product?.id ? [product] : [],
            },
            followUps: product?.id ? ['Add to cart', 'Compare similar products', 'Check return policy'] : ['Name the product', 'Show recent products'],
            verification: {
                label: 'app_grounded',
                confidence: 1,
                summary: product?.id ? 'Resolved live product price and stock from the product database.' : 'No product record matched the action request.',
                evidenceCount: product?.id ? 1 : 0,
            },
            answerMode: 'commerce',
        });
        return buildResponseEnvelope({
            assistantTurn,
            route: ROUTE_ACTION,
            provider: 'rule',
            providerModel: '',
            products: product?.id ? [product] : [],
            followUps: assistantTurn.followUps,
            sessionId,
            traceId,
            assistantMode,
            assistantSession: {
                ...assistantSession,
                lastIntent: 'product_selection',
                lastEntities: { ...assistantSession.lastEntities, productId: safeString(product?.id || action.productId || '') },
                activeProduct: product?.id ? product : assistantSession.activeProduct,
                pendingAction: null,
            },
            health: { gateway: getModelGatewayHealth() },
            retrievalHitCount: product?.id ? 1 : 0,
            validator: { ok: Boolean(product?.id), reason: product?.id ? action.type : 'product_not_resolved' },
            messageId: createMessageId(),
        });
    }

    if (action.type === 'apply_coupon') {
        const assistantTurn = buildAssistantTurn({
            intent: 'checkout',
            confidence: 0.88,
            decision: 'act',
            response: safeString(action.couponCode)
                ? `Opening checkout so the quote API can validate coupon ${safeString(action.couponCode)} against your live cart.`
                : 'Opening checkout so the quote API can validate a coupon against your live cart.',
            actions: [action],
            ui: { surface: 'navigation_notice', navigation: { page: 'checkout', path: '/checkout', params: safeString(action.couponCode) ? { coupon: safeString(action.couponCode) } : {} } },
            followUps: ['Review checkout total', 'Show my cart'],
            verification: {
                label: 'app_grounded',
                confidence: 1,
                summary: 'Coupon validation is delegated to the checkout quote API; no discount was invented by the assistant.',
            },
            answerMode: 'commerce',
        });
        return buildResponseEnvelope({
            assistantTurn,
            route: ROUTE_ACTION,
            provider: 'rule',
            providerModel: '',
            products: [],
            followUps: assistantTurn.followUps,
            sessionId,
            traceId,
            assistantMode,
            assistantSession: { ...assistantSession, pendingAction: null },
            health: { gateway: getModelGatewayHealth() },
            retrievalHitCount: 0,
            validator: { ok: true, reason: 'coupon_checkout_handoff' },
            messageId: createMessageId(),
        });
    }

    if (action.type === 'compare_products') {
        const productIds = Array.isArray(action.productIds) && action.productIds.length
            ? action.productIds
            : uniq(actionContext.candidateProductIds || []).slice(0, 4);
        const assistantTurn = buildAssistantTurn({
            intent: 'product_selection',
            confidence: productIds.length > 1 ? 0.9 : 0.65,
            decision: productIds.length > 1 ? 'act' : 'respond',
            response: productIds.length > 1
                ? 'Opening a side-by-side comparison for the selected products.'
                : 'I need at least two products before I can open a comparison.',
            actions: productIds.length > 1 ? [{ type: 'compare_products', productIds, query: safeString(action.query || message) }] : [],
            ui: { surface: productIds.length > 1 ? 'navigation_notice' : 'plain_answer' },
            followUps: productIds.length > 1 ? ['Refine by price', 'Check stock'] : ['Show products to compare'],
            verification: { label: 'app_grounded', confidence: 1, summary: 'Comparison action uses only candidate product ids already present in assistant context.' },
            answerMode: 'commerce',
        });
        return buildResponseEnvelope({
            assistantTurn,
            route: ROUTE_ACTION,
            provider: 'rule',
            providerModel: '',
            products: [],
            followUps: assistantTurn.followUps,
            sessionId,
            traceId,
            assistantMode,
            assistantSession: { ...assistantSession, pendingAction: null },
            health: { gateway: getModelGatewayHealth() },
            retrievalHitCount: productIds.length,
            validator: { ok: productIds.length > 1, reason: productIds.length > 1 ? 'compare_products' : 'not_enough_products' },
            messageId: createMessageId(),
        });
    }

    if (action.type === 'recommend_products') {
        return buildAssistantRecommendationEnvelope({
            message: safeString(action.query || message || 'recommended products'),
            user,
            sessionId,
            traceId,
            assistantMode,
            assistantSession,
            context: {
                ...actionContext,
                ...(context || {}),
                filters: action.filters || {},
            },
            gatewayHealth: getModelGatewayHealth(),
            vectorStoreHealth: await getLocalVectorIndexHealth().catch(() => null),
        });
    }

    if (action.type === 'get_payment_status') {
        const order = action.order || (action.orderId ? await Order.findOne({ _id: action.orderId, user: user?._id }).select('orderStatus totalPrice createdAt paymentState paymentMethod isDelivered').lean() : await loadLatestOrder(user?._id));
        const assistantTurn = buildAssistantTurn({
            intent: 'support',
            confidence: order ? 0.96 : 0.7,
            decision: 'respond',
            response: order
                ? `Order ${String(order._id).slice(-6)} payment is ${safeString(order.paymentState || 'pending')} via ${safeString(order.paymentMethod || 'the selected method')}. Order status is ${safeString(order.orderStatus || 'placed')}.`
                : 'I could not find a recent order for this account to check payment status.',
            ui: { surface: 'plain_answer' },
            followUps: order ? ['Track this order', 'Open support'] : ['Open support'],
            verification: { label: 'app_grounded', confidence: 1, summary: order ? 'Resolved from the order database.' : 'No recent order matched the payment-status request.' },
            answerMode: 'commerce',
        });
        return buildResponseEnvelope({
            assistantTurn,
            route: ROUTE_ACTION,
            provider: 'rule',
            providerModel: '',
            products: [],
            followUps: assistantTurn.followUps,
            sessionId,
            traceId,
            assistantMode,
            assistantSession: { ...assistantSession, lastIntent: 'support', lastEntities: { ...assistantSession.lastEntities, orderId: safeString(order?._id || action.orderId || '') }, pendingAction: null },
            health: { gateway: getModelGatewayHealth() },
            retrievalHitCount: order ? 1 : 0,
            validator: { ok: Boolean(order), reason: order ? 'payment_status_lookup' : 'order_not_found' },
            messageId: createMessageId(),
        });
    }

    if (action.type === 'track_order') {
        const order = action.order || (action.orderId ? await Order.findOne({ _id: action.orderId, user: user?._id }).select('orderStatus totalPrice createdAt').lean() : await loadLatestOrder(user?._id));
        const assistantTurn = buildAssistantTurn({
            intent: 'navigation',
            confidence: 0.98,
            decision: 'respond',
            response: order
                ? `Your latest order ${String(order._id).slice(-6)} is currently ${safeString(order.orderStatus || 'processing')} and totals Rs. ${Number(order.totalPrice || 0)}.`
                : 'I could not find a recent order for this account.',
            ui: { surface: 'plain_answer' },
            followUps: order ? ['Open support', 'Show my cart'] : ['Open support'],
            verification: { label: 'app_grounded', confidence: 1, summary: order ? 'Resolved from the order database.' : 'No recent order matched the request.' },
            answerMode: 'commerce',
        });
        return buildResponseEnvelope({
            assistantTurn,
            route: ROUTE_ACTION,
            provider: 'rule',
            providerModel: '',
            products: [],
            followUps: assistantTurn.followUps,
            sessionId,
            traceId,
            assistantMode,
            assistantSession: { ...assistantSession, lastIntent: 'navigation', lastEntities: { ...assistantSession.lastEntities, orderId: safeString(order?._id || action.orderId || '') }, pendingAction: null },
            health: { gateway: getModelGatewayHealth() },
            retrievalHitCount: 0,
            validator: { ok: true, reason: 'order_lookup' },
            messageId: createMessageId(),
        });
    }

    if (action.type === 'open_support') {
        const orderScopedSupport = Boolean(safeString(action.orderId || ''));
        const assistantTurn = buildAssistantTurn({
            intent: 'support',
            confidence: 0.99,
            decision: 'act',
            response: orderScopedSupport ? `Opening support for order ${String(action.orderId).slice(-6)}.` : 'Opening the support desk.',
            actions: [action],
            ui: { surface: 'support_handoff', support: { orderId: safeString(action.orderId || ''), prefill: action.prefill || {} } },
            verification: {
                label: 'app_grounded',
                confidence: 1,
                summary: orderScopedSupport
                    ? 'Support handoff prepared from validated order context.'
                    : 'Support handoff prepared without binding to an order.',
            },
            answerMode: 'commerce',
        });
        return buildResponseEnvelope({
            assistantTurn,
            route: ROUTE_ACTION,
            provider: 'rule',
            providerModel: '',
            products: [],
            followUps: [],
            sessionId,
            traceId,
            assistantMode,
            assistantSession: { ...assistantSession, pendingAction: null },
            health: { gateway: getModelGatewayHealth() },
            retrievalHitCount: 0,
            validator: { ok: true, reason: 'support_handoff' },
            messageId: createMessageId(),
        });
    }

    if (action.type === 'navigate_to') {
        const assistantTurn = buildAssistantTurn({
            intent: 'navigation',
            confidence: 0.99,
            decision: 'act',
            response: action.page === 'cart' ? 'Opening your cart.' : `Opening ${safeString(action.page || 'that page').replace(/_/g, ' ')}.`,
            actions: [action],
            ui: { surface: 'navigation_notice', navigation: { page: safeString(action.page || ''), path: action.page === 'cart' ? '/cart' : '/', params: action.params || {} } },
            verification: { label: 'app_grounded', confidence: 1, summary: 'Navigation action validated by the backend router.' },
            answerMode: 'commerce',
        });
        return buildResponseEnvelope({
            assistantTurn,
            route: ROUTE_ACTION,
            provider: 'rule',
            providerModel: '',
            products: [],
            followUps: [],
            sessionId,
            traceId,
            assistantMode,
            assistantSession: { ...assistantSession, pendingAction: null },
            health: { gateway: getModelGatewayHealth() },
            retrievalHitCount: 0,
            validator: { ok: true, reason: 'navigation' },
            messageId: createMessageId(),
        });
    }

    if (action.unresolved) {
        if (['cancel_order', 'create_return_request', 'get_payment_status'].includes(action.type)) {
            const assistantTurn = buildAssistantTurn({
                intent: 'support',
                confidence: 0.76,
                decision: 'respond',
                response: 'I need a signed-in order or a specific order ID before I can run that order workflow.',
                ui: { surface: 'plain_answer' },
                followUps: ['Open orders', 'Open support'],
                verification: { label: 'app_grounded', confidence: 1, summary: 'Order workflow blocked because no authoritative order was resolved.' },
                policy: { actionType: safeString(action?.type || ''), risk: validation.definition?.mutation ? 'mutation' : 'low', decision: 'REJECT', reason: 'order_not_resolved' },
            });
            return buildResponseEnvelope({
                assistantTurn,
                route: ROUTE_ACTION,
                provider: 'rule',
                providerModel: '',
                products: [],
                followUps: assistantTurn.followUps,
                sessionId,
                traceId,
                assistantMode,
                assistantSession: { ...assistantSession, pendingAction: null },
                health: { gateway: getModelGatewayHealth() },
                retrievalHitCount: 0,
                validator: { ok: false, reason: 'order_not_resolved' },
                messageId: createMessageId(),
            });
        }
        const assistantTurn = buildAssistantTurn({
            intent: 'cart_action',
            confidence: 0.75,
            decision: 'respond',
            response: 'I need the exact product before I can change your cart. Try naming the item again.',
            ui: { surface: 'plain_answer' },
            followUps: ['Show me phones', 'Show me shoes', 'Open my cart'],
            verification: { label: 'app_grounded', confidence: 1, summary: 'Cart mutation blocked because no authoritative product was resolved.' },
            policy: { actionType: safeString(action?.type || ''), risk: 'mutation', decision: 'REJECT', reason: 'product_not_resolved' },
        });
        return buildResponseEnvelope({
            assistantTurn,
            route: ROUTE_ACTION,
            provider: 'rule',
            providerModel: '',
            products: [],
            followUps: assistantTurn.followUps,
            sessionId,
            traceId,
            assistantMode,
            assistantSession: { ...assistantSession, pendingAction: null },
            health: { gateway: getModelGatewayHealth() },
            retrievalHitCount: 0,
            validator: { ok: false, reason: 'product_not_resolved' },
            messageId: createMessageId(),
        });
    }

    return buildConfirmationEnvelope({
        action,
        assistantSession,
        sessionId,
        traceId,
        assistantMode,
        responseText: getActionConfirmationText(action),
        intent: getActionIntent(action),
        entities: {
            query: safeString(message),
            productId: safeString(action.product?.id || action.productId || ''),
            quantity: Number(action.quantity || 1),
            orderId: safeString(action.orderId || ''),
            operation: safeString(action.type || ''),
        },
    });
};

const persistSignedInTurn = async ({ response, user, sessionId, assistantMode, context, message } = {}) => {
    if (!user?._id || !response?.assistantTurn) return null;
    return persistAssistantExchange({
        user,
        sessionId,
        assistantMode,
        context,
        userMessage: message,
        assistantTurn: response.assistantTurn,
        responseText: response.answer,
        route: response.route,
        provider: response.provider,
        providerModel: response.providerModel,
        retrievalProducts: Array.isArray(response.products) ? response.products : [],
        retrievalHitCount: Number(response?.grounding?.retrievalHitCount || 0),
        grounding: response.grounding,
        assistantSession: response.assistantSession,
        actionAuditStatus: response?.assistantTurn?.ui?.confirmation?.action ? 'proposed' : 'executed',
    });
};

const processAssistantTurn = async ({
    user = null,
    message = '',
    conversationHistory = [],
    assistantMode = 'chat',
    sessionId = '',
    confirmation = null,
    actionRequest = null,
    context = {},
    images = [],
    audio = [],
} = {}) => {
    const startedAt = Date.now();
    const traceId = createTraceId();
    const resolvedSessionId = safeString(sessionId || context?.clientSessionId || '') || createSessionId();
    const assistantSession = await resolveStoredAssistantSession({ user, sessionId: resolvedSessionId, context });
    const resolvedConfirmation = inferConfirmationFromMessage({ message, confirmation, assistantSession });
    const routeDecision = detectRoute({
        message,
        actionRequest,
        confirmation: resolvedConfirmation,
        context,
        assistantSession,
        images,
        audio,
    });
    recordRouteDecisionMetric({ route: routeDecision.route, assistantMode });

    let response;
    if (routeDecision.route === ROUTE_ACTION) {
        response = await performActionTurn({
            message,
            actionRequest,
            confirmation: resolvedConfirmation,
            user,
            assistantMode,
            sessionId: resolvedSessionId,
            traceId,
            assistantSession,
            context,
        });
    } else if (routeDecision.route === ROUTE_ECOMMERCE) {
        response = await performCommerceTurn({
            user,
            message,
            conversationHistory,
            assistantMode,
            sessionId: resolvedSessionId,
            traceId,
            assistantSession,
            context,
            images,
            audio,
        });
    } else {
        response = await performGeneralTurn({
            message,
            conversationHistory,
            assistantMode,
            sessionId: resolvedSessionId,
            traceId,
            assistantSession,
            images,
            audio,
        });
    }

    response.latencyMs = Date.now() - startedAt;
    response.grounding = { ...(response.grounding || {}), routeReason: routeDecision.reason, latencyMs: response.latencyMs };
    await persistSignedInTurn({ response, user, sessionId: resolvedSessionId, assistantMode, context, message });
    recordLatencyMetric({ route: routeDecision.route, provisional: false, latencyMs: response.latencyMs });
    return response;
};

const streamPlainTextReply = (writeEvent, { sessionId = '', messageId = '', text = '' } = {}) => {
    const chunks = safeString(text).match(/.{1,18}/g) || [];
    chunks.forEach((chunk) => {
        writeEvent('token', { sessionId, messageId, text: chunk });
    });
};

const streamAssistantTurn = async ({
    user = null,
    message = '',
    conversationHistory = [],
    assistantMode = 'chat',
    sessionId = '',
    confirmation = null,
    actionRequest = null,
    context = {},
    images = [],
    audio = [],
    writeEvent = null,
} = {}) => {
    if (typeof writeEvent !== 'function') {
        throw new Error('writeEvent callback is required for streaming');
    }

    const response = await processAssistantTurn({
        user,
        message,
        conversationHistory,
        assistantMode,
        sessionId,
        confirmation,
        actionRequest,
        context,
        images,
        audio,
    });

    const resolvedSessionId = safeString(response.sessionId || sessionId || context?.clientSessionId || '');
    const resolvedMessageId = safeString(context?.clientMessageId || response.messageId || createMessageId());
    writeEvent('message_meta', {
        sessionId: resolvedSessionId,
        messageId: resolvedMessageId,
        decision: safeString(response?.assistantTurn?.decision || ''),
        provisional: false,
        upgradeEligible: false,
        traceId: response.traceId,
    });
    (Array.isArray(response?.assistantTurn?.toolRuns) ? response.assistantTurn.toolRuns : []).forEach((toolRun) => {
        writeEvent('tool_end', { sessionId: resolvedSessionId, messageId: resolvedMessageId, ...toolRun });
    });
    (Array.isArray(response?.assistantTurn?.citations) ? response.assistantTurn.citations : []).forEach((citation) => {
        writeEvent('citation', { sessionId: resolvedSessionId, messageId: resolvedMessageId, ...citation });
    });
    if (response?.assistantTurn?.verification) {
        writeEvent('verification', { sessionId: resolvedSessionId, messageId: resolvedMessageId, ...response.assistantTurn.verification });
    }
    streamPlainTextReply(writeEvent, { sessionId: resolvedSessionId, messageId: resolvedMessageId, text: response.answer });
    writeEvent('final_turn', { ...response, sessionId: resolvedSessionId, messageId: resolvedMessageId });
    return { ...response, sessionId: resolvedSessionId, messageId: resolvedMessageId };
};
const listSessions = async ({ user }) => listAssistantThreads({ userId: user?._id });
const getSession = async ({ user, sessionId }) => loadAssistantThread({ userId: user?._id, sessionId });
const createSession = async ({ user, sessionId = '', assistantMode = 'chat', originPath = '/' } = {}) => {
    const resolvedSessionId = safeString(sessionId || '') || createSessionId();
    const thread = await upsertAssistantThread({
        userId: user?._id,
        sessionId: resolvedSessionId,
        assistantMode,
        originPath,
        title: 'New chat',
        preview: 'Start a new assistant thread.',
        assistantSession: normalizeAssistantSession({}, resolvedSessionId),
        route: '',
        provider: '',
        providerModel: '',
    });
    return thread ? {
        session: {
            id: resolvedSessionId,
            title: safeString(thread.title || 'New chat'),
            preview: safeString(thread.preview || 'Start a new assistant thread.'),
            createdAt: thread.createdAt ? new Date(thread.createdAt).getTime() : Date.now(),
            updatedAt: Date.now(),
            originPath: safeString(thread.originPath || '/', '/'),
            pinned: false,
            archived: false,
        },
        assistantSession: normalizeAssistantSession(thread.assistantSessionState || {}, resolvedSessionId),
        messages: [],
    } : null;
};
const resetSession = async ({ user, sessionId }) => resetAssistantThread({ userId: user?._id, sessionId });
const archiveSession = async ({ user, sessionId }) => archiveAssistantThread({ userId: user?._id, sessionId });
const getCommerceAssistantHealth = async () => ({
    route: 'hybrid_rag_commerce',
    gateway: getModelGatewayHealth(),
    vectorStore: await getLocalVectorIndexHealth().catch((error) => ({ healthy: false, error: error.message })),
});

module.exports = {
    ROUTE_ACTION,
    ROUTE_ECOMMERCE,
    ROUTE_GENERAL,
    archiveSession,
    createSession,
    detectRoute,
    getCommerceAssistantHealth,
    getSession,
    listSessions,
    processAssistantTurn,
    resetSession,
    streamAssistantTurn,
    __testables: {
        buildActionContext,
        buildCommerceFilterSummary,
        buildCommerceResultInsights,
        buildCommerceResponseText,
        buildHostedGemmaUnavailableEnvelope,
        buildNoResultResponseText,
        buildRelaxedRetrievalPlans,
        decorateCommerceProducts,
        detectRoute,
        deriveRetrievalQuery,
        extractCommerceCategoryHint,
        extractMediaLookupHints,
        buildHeuristicRetrievalQueryText,
        inferStructuredRetrievalFilters,
        inferConfirmationFromMessage,
        buildCommerceModelProviderOptions,
        isCommerceModelSummaryEnabled,
        isHostedGemmaCommerceRequired,
        isHostedGemmaGatewayHealthy,
        isHostedGemmaAudioUnsupported,
        matchesRetrievalFilters,
        scoreCommerceProduct,
        sortCommerceEntries,
        resolveActionPlan,
        shouldAnswerKnowledgeBeforeCatalog,
        shouldReuseSessionResultsForCommerce,
        shouldRouteAsCommerceFollowUp,
        validateCommercePayload,
        validateGeneralPayload,
        validateRetrievalQueryPayload,
    },
};
