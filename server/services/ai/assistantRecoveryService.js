const { generateStructuredResponse } = require('./providerRegistry');
const { getProductByIdentifier } = require('../catalogService');
const logger = require('../../utils/logger');
const { evaluateExecutionPolicy } = require('./assistantExecutionPolicy');
const {
    compileIntentCommand,
    compilerCategoryToCatalogCategory,
} = require('./assistantIntentCompiler');
const {
    cleanSearchQuery,
    mergeSearchContext,
    searchProducts,
} = require('./assistantSearchService');

const ACT_DIRECT_THRESHOLD = 0.7;
const INFER_CONFIRM_THRESHOLD = 0.4;
const MAX_CLARIFICATION_REPEATS = 1;
const MAX_COMPILED_RESULTS = 30;

const PAGE_TARGETS = [
    { page: 'home', path: '/', aliases: ['home', 'homepage'] },
    { page: 'assistant', path: '/assistant', aliases: ['assistant workspace', 'assistant'] },
    { page: 'login', path: '/login', aliases: ['log in', 'login', 'sign in', 'signin'] },
    { page: 'cart', path: '/cart', aliases: ['cart', 'bag', 'basket'] },
    { page: 'checkout', path: '/checkout', aliases: ['checkout', 'payment', 'pay now', 'place order'] },
    { page: 'orders', path: '/orders', aliases: ['orders', 'my orders', 'order history'] },
    { page: 'profile', path: '/profile', aliases: ['profile', 'account'] },
    { page: 'wishlist', path: '/wishlist', aliases: ['wishlist', 'favorites', 'favourites'] },
    { page: 'marketplace', path: '/marketplace', aliases: ['marketplace', 'market place'] },
    { page: 'support', path: '/profile?tab=support', aliases: ['support', 'help desk', 'customer care', 'help center'] },
    { page: 'deals', path: '/deals', aliases: ['deals', 'offers', 'discounts'] },
    { page: 'compare', path: '/compare', aliases: ['compare page', 'ai compare', 'compare'] },
    { page: 'visual_search', path: '/visual-search', aliases: ['visual search', 'camera search'] },
    { page: 'bundles', path: '/bundles', aliases: ['smart bundles', 'bundle builder', 'bundles'] },
    { page: 'mission_control', path: '/mission-control', aliases: ['mission control', 'mission os'] },
    { page: 'sell', path: '/sell', aliases: ['sell item', 'create listing', 'new listing', 'sell'] },
    { page: 'become_seller', path: '/become-seller', aliases: ['become a seller', 'become seller', 'seller onboarding'] },
    { page: 'my_listings', path: '/my-listings', aliases: ['my listings', 'seller desk', 'seller tools'] },
    { page: 'price_alerts', path: '/price-alerts', aliases: ['price alerts', 'price alert'] },
    { page: 'trade_in', path: '/trade-in', aliases: ['trade in', 'trade-in'] },
    { page: 'product', path: '/product', aliases: ['product', 'details', 'detail page'] },
];

const SUPPORT_PATTERN = /\b(refund|return|replace|replacement|cancel order|track|tracking|late delivery|delivery issue|damaged|defect|warranty|complaint|support|help with|issue with|problem with)\b/i;
const GENERAL_KNOWLEDGE_PATTERN = /^(?:who|what|when|where|why|how|which)\b|(?:\bmeaning of\b|\bexplain\b|\btell me about\b|\bdefine\b)/i;
const SEARCH_PATTERN = /\b(search|find|look for|show me|recommend|suggest|compare|vs|versus|buy|need|want|budget|under|below|within)\b/i;
const CART_ADD_PATTERN = /\b(add|put|place|buy)\b.*\b(cart|bag|basket)\b|\badd this\b|\bbuy this\b/i;
const CART_REMOVE_PATTERN = /\b(remove|delete|take out|drop)\b.*\b(cart|bag|basket)\b/i;
const NAVIGATION_PATTERN = /\b(open|go to|take me to|navigate|show)\b/i;
const PRODUCT_REFERENCE_PATTERN = /\b(this|that|it|selected|current)\b/i;
const SHOW_MORE_PATTERN = /\b(show more|more options|more results|next results|next page)\b/i;
const CATEGORY_BROWSE_PATTERN = /\b(open|browse|go to|take me to)\b/i;
const FILTER_REFINEMENT_PATTERN = /^(?:then|now|also|only|just)?\s*(?:under|below|less than|max|within|around|about)?\s*(?:rs\.?|inr)?\s*[\d,]+\s*k?\s*(?:price|budget)?$/i;
const PRODUCT_SEARCH_CUE_PATTERN = /\b(iphone|samsung|pixel|oppo|vivo|realme|phone|phones|laptop|laptops|headphone|headphones|earbuds|watch|tv|book|books|shoes?)\b/i;
const SMALL_TALK_PATTERN = /^(?:hi|hello|hey|hey there|yo|good morning|good afternoon|good evening)(?:\b|[!. ]|$)/i;
const THANKS_PATTERN = /^(?:thanks|thank you|thx)(?:\b|[!. ]|$)/i;
const FAREWELL_PATTERN = /^(?:bye|goodbye|see you|take care)(?:\b|[!. ]|$)/i;

const CATEGORY_SLUG_LOOKUP = new Map([
    ['Mobiles', 'mobiles'],
    ['Laptops', 'laptops'],
    ['Electronics', 'electronics'],
    ["Men's Fashion", "men's-fashion"],
    ["Women's Fashion", "women's-fashion"],
    ['Footwear', 'footwear'],
    ['Home & Kitchen', 'home-kitchen'],
    ['Gaming & Accessories', 'gaming'],
    ['Books', 'books'],
]);

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const safeLower = (value, fallback = '') => safeString(value, fallback).toLowerCase();
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);
const titleCase = (value = '') => safeString(value)
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

const toCategorySlug = (value = '') => {
    const normalized = safeString(value);
    if (!normalized) return '';
    return CATEGORY_SLUG_LOOKUP.get(normalized) || safeLower(normalized)
        .replace(/&/g, 'and')
        .replace(/['"]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
};

const normalizeClarificationState = (value = {}) => ({
    fingerprint: safeString(value?.fingerprint || ''),
    count: Math.max(0, Number(value?.count || 0)),
    lastQuestion: safeString(value?.lastQuestion || ''),
});

const NAVIGATION_TARGET_OVERRIDES = {
    profile_addresses: {
        page: 'profile',
        params: {
            tab: 'addresses',
        },
    },
    profile_notifications: {
        page: 'profile',
        params: {
            tab: 'notifications',
        },
    },
    profile_payments: {
        page: 'profile',
        params: {
            tab: 'settings',
        },
    },
    profile_settings: {
        page: 'profile',
        params: {
            tab: 'settings',
        },
    },
    profile_support: {
        page: 'profile',
        params: {
            tab: 'support',
        },
    },
};

const stripCategoryBrowseQuery = (message = '', categoryLabel = '') => cleanSearchQuery(
    safeString(message).replace(/\b(open|browse|go to|take me to)\b/gi, ' '),
    categoryLabel
);

const resolveCategoryBrowseQuery = (message = '', categoryLabel = '') => {
    const cleaned = safeString(stripCategoryBrowseQuery(message, categoryLabel));
    const normalizedCategory = safeLower(categoryLabel);
    return safeLower(cleaned) === normalizedCategory ? '' : cleaned;
};

const formatCurrency = (value = 0) => {
    const amount = Number(value || 0);
    return amount > 0 ? `Rs ${amount.toLocaleString('en-IN')}` : '';
};

const buildNavigationDescriptor = (page = '', params = {}) => {
    const definition = PAGE_TARGETS.find((entry) => entry.page === safeString(page)) || null;
    const basePath = safeString(definition?.path || '/');
    const mergedParams = {
        ...(definition?.params && typeof definition.params === 'object' ? definition.params : {}),
        ...(params && typeof params === 'object' ? params : {}),
    };

    if (safeString(page) === 'category' && safeString(mergedParams.category)) {
        return {
            page: 'category',
            path: `/category/${safeString(mergedParams.category)}`,
            params: mergedParams,
        };
    }

    if (safeString(page) === 'product' && safeString(mergedParams.productId)) {
        return {
            page: 'product',
            path: `/product/${safeString(mergedParams.productId)}`,
            params: mergedParams,
        };
    }

    const searchParams = new URLSearchParams();
    Object.entries(mergedParams).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        searchParams.set(key, String(value));
    });

    const query = searchParams.toString();

    return {
        page: safeString(page),
        path: query ? `${basePath}${basePath.includes('?') ? '&' : '?'}${query}` : basePath,
        params: mergedParams,
    };
};

const buildNavigationResponse = (page = '', params = {}) => {
    const normalizedPage = safeString(page);
    const tab = safeString(params?.tab || '');

    if (normalizedPage === 'category' && safeString(params?.category || '')) {
        return `Opening ${safeString(params.category).replace(/-/g, ' ')}.`;
    }

    if (normalizedPage === 'product') {
        return 'Opening that product.';
    }

    if (normalizedPage === 'profile' && tab === 'addresses') {
        return 'Opening your saved addresses.';
    }

    if (normalizedPage === 'profile' && tab === 'settings') {
        return 'Opening profile settings.';
    }

    if (normalizedPage === 'profile' && tab === 'notifications') {
        return 'Opening your notifications.';
    }

    if (normalizedPage === 'profile' && tab === 'support') {
        return 'Opening support in your profile.';
    }

    return `Opening ${titleCase(normalizedPage || 'that page')}.`;
};

const buildLocalKnowledgeInterpretation = (response = '', confidence = 0.96) => ({
    intent: 'general_knowledge',
    entities: {
        query: '',
        productId: '',
        quantity: 0,
        category: '',
        priceMin: 0,
        maxPrice: 0,
        limit: 0,
    },
    confidence,
    decision: 'respond',
    response: safeString(response),
    meta: {
        operation: '',
        page: '',
        orderId: '',
        showMore: false,
        categorySlug: '',
        categoryLabel: '',
        refinementFollowUp: false,
        localAnswer: true,
    },
});

const hasMeaningfulProductTitle = (product = null) => {
    const title = safeString(product?.title || product?.displayTitle || product?.name || '');
    return Boolean(title) && safeLower(title) !== 'untitled product';
};

const isProductRouteContext = (context = {}) => {
    const route = safeLower(context?.route || '');
    const routeLabel = safeLower(context?.routeLabel || '');
    return route.startsWith('/product') || routeLabel.includes('product detail');
};

const resolveActiveProductContext = ({ context = {}, sessionMemory = {} } = {}) => (
    (() => {
        const directProduct = context?.currentProduct
            || context?.product
            || context?.focusProduct
            || null;
        if (directProduct && hasMeaningfulProductTitle(directProduct)) {
            return directProduct;
        }

        const memoryProduct = sessionMemory?.activeProduct || null;
        if (memoryProduct && hasMeaningfulProductTitle(memoryProduct)) {
            return memoryProduct;
        }

        return null;
    })()
);

const buildProductContextAnswer = ({ message = '', product = null, context = {} } = {}) => {
    if (!product || typeof product !== 'object') return '';

    const normalized = safeLower(message);
    if (!normalized || /\bcompare\b/i.test(normalized)) return '';

    const title = safeString(product?.title || product?.displayTitle || product?.name || '');
    if (!title || !hasMeaningfulProductTitle(product)) return '';

    const directProductReference = /\b(this|that|it|selected|current|product)\b/i.test(normalized);
    if (!directProductReference && !isProductRouteContext(context)) {
        return '';
    }

    const brand = safeString(product?.brand || '');
    const category = safeString(product?.category || '');
    const price = formatCurrency(product?.price || 0);
    const originalPrice = formatCurrency(product?.originalPrice || 0);
    const rating = Number(product?.rating || 0);
    const ratingCount = Math.max(0, Number(product?.ratingCount || 0));
    const stock = Math.max(0, Number(product?.stock || 0));
    const warranty = safeString(product?.warranty || '');
    const deliveryTime = safeString(product?.deliveryTime || '');

    if (/\b(?:price|cost|how much)\b/i.test(normalized)) {
        if (!price) return `I do not have the current price for ${title} in this context.`;
        return originalPrice && originalPrice !== price
            ? `${title} is priced at ${price}, down from ${originalPrice}.`
            : `${title} is priced at ${price}.`;
    }

    if (/\b(?:in stock|available|availability)\b/i.test(normalized)) {
        return stock > 0
            ? `${title} is in stock with ${stock} unit${stock === 1 ? '' : 's'} available right now.`
            : `${title} is currently out of stock.`;
    }

    if (/\bwarranty\b/i.test(normalized)) {
        return warranty
            ? `${title} includes ${warranty}.`
            : `I do not see a warranty note for ${title} in the current product context.`;
    }

    if (/\b(?:delivery|shipping|ship|arrive|eta)\b/i.test(normalized)) {
        return deliveryTime
            ? `${title} is showing delivery in ${deliveryTime}.`
            : `I do not have delivery timing for ${title} in the current product context.`;
    }

    if (/\b(?:tell me about|describe|about this product|product details|details of this product|this product)\b/i.test(normalized)) {
        const parts = [];
        if (brand) parts.push(`${title} is from ${brand}`);
        else parts.push(`${title} is available now`);
        if (category) parts.push(`in ${category}`);
        if (price) parts.push(`at ${price}`);
        if (rating > 0) {
            const ratingLabel = ratingCount > 0
                ? `${rating.toFixed(1)} stars from ${ratingCount.toLocaleString('en-IN')} ratings`
                : `${rating.toFixed(1)} stars`;
            parts.push(`with ${ratingLabel}`);
        }
        if (stock > 0) parts.push(`and ${stock} unit${stock === 1 ? '' : 's'} in stock`);
        return `${parts.join(' ')}.`;
    }

    return '';
};

const buildCartContextAnswer = ({ message = '', context = {} } = {}) => {
    const normalized = safeLower(message);
    if (!normalized) return '';

    const cartSummary = context?.cartSummary && typeof context.cartSummary === 'object'
        ? context.cartSummary
        : {};
    const subtotal = Number(
        cartSummary?.subtotal
        || cartSummary?.subtotalAmount
        || cartSummary?.total
        || 0
    );
    const itemCount = Math.max(0, Number(cartSummary?.itemCount || cartSummary?.totalItems || 0));

    if (/\b(subtotal|cart total|cart subtotal|order total)\b/i.test(normalized)) {
        if (!subtotal) return 'Your cart subtotal is not available in this context right now.';
        return itemCount > 0
            ? `Your current cart subtotal is ${formatCurrency(subtotal)} across ${itemCount} item${itemCount === 1 ? '' : 's'}.`
            : `Your current cart subtotal is ${formatCurrency(subtotal)}.`;
    }

    if (/\bcoupon|promo code|discount code\b/i.test(normalized)) {
        return 'Use the coupon field in cart or checkout. Configured coupon codes in this repo include AURA10, FREESHIP, and UPI50.';
    }

    if (/\bupi\b/i.test(normalized)) {
        return 'UPI is supported in checkout, alongside other digital payment rails.';
    }

    if (/\b(?:cash on delivery|cod)\b/i.test(normalized)) {
        return 'Cash on delivery is available as a checkout payment option.';
    }

    if (/\bpayment methods?\b/i.test(normalized)) {
        if (/^(?:where do i|where can i|how do i|open|show)\b/i.test(normalized)) {
            return '';
        }
        return 'Saved payment methods are managed from your profile, and checkout supports card, UPI, wallet, and netbanking flows.';
    }

    return '';
};

const buildRouteGuidanceInterpretation = (message = '') => {
    const normalized = safeLower(message);
    if (!/\b(?:what|which)\s+(?:route|path|url)\b/i.test(normalized) && !/\bwhere is\b.*\bworkspace\b/i.test(normalized)) {
        return null;
    }

    const pageTarget = findPageTarget(message);
    if (!pageTarget) return null;

    const descriptor = buildNavigationDescriptor(pageTarget.page, pageTarget.params || {});
    const label = titleCase(pageTarget.page || 'page');
    return buildLocalKnowledgeInterpretation(`The route for ${label} is ${descriptor.path}.`, 0.93);
};

const buildComparisonInterpretation = ({ message = '', sessionMemory = {} } = {}) => {
    if (!/\bcompare\b/i.test(message) || !/\b(first two|first 2|these two|the first two)\b/i.test(message)) {
        return null;
    }

    const products = uniqueProducts(sessionMemory?.lastResults || []).slice(0, 2);
    if (products.length < 2) return null;

    return {
        intent: 'product_search',
        entities: {
            query: '',
            productId: '',
            quantity: 0,
            category: '',
            priceMin: 0,
            maxPrice: 0,
            limit: 2,
        },
        confidence: 0.9,
        decision: 'respond',
        response: '',
        meta: {
            operation: '',
            page: 'compare',
            orderId: '',
            showMore: false,
            categorySlug: '',
            categoryLabel: '',
            refinementFollowUp: false,
            compareSelection: true,
            compareProducts: products,
            navigationParams: {
                ids: products.map((product) => safeString(product.id)).filter(Boolean).join(','),
            },
        },
    };
};

const buildFirstResultNavigationInterpretation = ({ message = '', sessionMemory = {} } = {}) => {
    if (!/\b(first one|first result|top result|best match)\b/i.test(message)) {
        return null;
    }

    if (!/\b(open|go to|view|show)\b/i.test(message)) {
        return null;
    }

    const firstProduct = uniqueProducts(sessionMemory?.lastResults || []).slice(0, 1)[0] || null;
    if (!firstProduct?.id) return null;

    return {
        intent: 'navigation',
        entities: {
            query: '',
            productId: safeString(firstProduct.id),
            quantity: 0,
            category: '',
            priceMin: 0,
            maxPrice: 0,
            limit: 0,
        },
        confidence: 0.9,
        decision: 'act',
        response: '',
        meta: {
            operation: '',
            page: 'product',
            orderId: '',
            showMore: false,
            categorySlug: '',
            categoryLabel: '',
            refinementFollowUp: false,
            navigationParams: {},
        },
    };
};

const buildLocalCommerceInterpretation = ({ message = '', context = {}, sessionMemory = {} } = {}) => {
    const comparison = buildComparisonInterpretation({
        message,
        sessionMemory,
    });
    if (comparison) return comparison;

    if (/\bcheaper\b/i.test(message) && safeString(sessionMemory?.lastQuery || '')) {
        const activeCategory = safeString(
            sessionMemory?.activeProduct?.category
            || sessionMemory?.lastResults?.[0]?.category
            || ''
        );
        return {
            intent: 'product_search',
            entities: {
                query: safeString(sessionMemory.lastQuery),
                productId: '',
                quantity: 0,
                category: activeCategory,
                priceMin: 0,
                maxPrice: 0,
                limit: 6,
            },
            confidence: 0.82,
            decision: 'act',
            response: '',
            meta: {
                operation: '',
                page: '',
                orderId: '',
                showMore: false,
                categorySlug: toCategorySlug(activeCategory),
                categoryLabel: activeCategory,
                refinementFollowUp: true,
            },
        };
    }

    const firstResultNavigation = buildFirstResultNavigationInterpretation({
        message,
        sessionMemory,
    });
    if (firstResultNavigation) return firstResultNavigation;

    const routeGuidance = buildRouteGuidanceInterpretation(message);
    if (routeGuidance) return routeGuidance;

    const productAnswer = buildProductContextAnswer({
        message,
        context,
        product: resolveActiveProductContext({
            context,
            sessionMemory,
        }),
    });
    if (productAnswer) return buildLocalKnowledgeInterpretation(productAnswer, 0.97);

    const cartAnswer = buildCartContextAnswer({
        message,
        context,
    });
    if (cartAnswer) return buildLocalKnowledgeInterpretation(cartAnswer, 0.95);

    return null;
};

const normalizeProductSummary = (product = {}) => {
    const id = safeString(product?.id || product?._id || '');
    if (!id) return null;

    return {
        id,
        title: safeString(product?.displayTitle || product?.title || product?.name || 'Untitled product'),
        brand: safeString(product?.brand || ''),
        category: safeString(product?.category || ''),
        price: Number(product?.price || 0),
        originalPrice: Number(product?.originalPrice || product?.price || 0),
        discountPercentage: Number(product?.discountPercentage || 0),
        image: safeString(product?.image || product?.thumbnail || ''),
        stock: Math.max(0, Number(product?.stock || 0)),
        rating: Number(product?.rating || 0),
        ratingCount: Number(product?.ratingCount || 0),
    };
};

const uniqueProducts = (products = []) => {
    const seen = new Set();
    return (Array.isArray(products) ? products : [])
        .map((product) => normalizeProductSummary(product))
        .filter(Boolean)
        .filter((product) => {
            if (seen.has(product.id)) return false;
            seen.add(product.id);
            return true;
        });
};

const extractQuantity = (message = '', fallback = 1) => {
    const match = safeString(message).match(/\b(?:qty|quantity|add|remove)\s*(\d+)\b/i)
        || safeString(message).match(/\b(\d+)\s+(?:items?|pieces?|units?)\b/i);
    const parsed = Number(match?.[1] || 0);
    return parsed > 0 ? parsed : fallback;
};

const extractOrderId = (message = '', context = {}) => safeString(
    safeString(message).match(/\b(?:order(?:\s+id)?|tracking(?:\s+id)?)\s*(?:#|no\.?|number)?\s*([a-z0-9-]{3,})\b/i)?.[1]
    || safeString(message).match(/\b#([a-z0-9-]{3,})\b/i)?.[1]
    || context?.activeOrderId
    || context?.orderId
    || ''
);

const findPageTarget = (message = '') => {
    const normalized = safeLower(message);
    return PAGE_TARGETS
        .slice()
        .sort((left, right) => {
            const leftLongest = Math.max(...left.aliases.map((alias) => alias.length));
            const rightLongest = Math.max(...right.aliases.map((alias) => alias.length));
            return rightLongest - leftLongest;
        })
        .find((entry) => entry.aliases.some((alias) => normalized.includes(alias)))
        || null;
};

const resolveSessionMemory = (context = {}) => {
    const rawMemory = context?.sessionMemory && typeof context.sessionMemory === 'object'
        ? context.sessionMemory
        : {};

    const lastResults = uniqueProducts(
        rawMemory.lastResults
        || context.visibleProducts
        || context.latestProducts
        || []
    ).slice(0, 6);

    const activeProduct = normalizeProductSummary(
        rawMemory.activeProduct
        || context.currentProduct
        || context.product
        || null
    );

    return {
        lastQuery: safeString(rawMemory.lastQuery || context.lastQuery || ''),
        lastResults,
        activeProduct,
        lastIntent: safeString(rawMemory.lastIntent || rawMemory.currentIntent || context.lastIntent || context.currentIntent || ''),
        currentIntent: safeString(rawMemory.lastIntent || rawMemory.currentIntent || context.lastIntent || context.currentIntent || ''),
        clarificationState: normalizeClarificationState(rawMemory.clarificationState || context.clarificationState || {}),
        lastActionFingerprint: safeString(rawMemory.lastActionFingerprint || context.lastActionFingerprint || ''),
        lastActionAt: Math.max(0, Number(rawMemory.lastActionAt || context.lastActionAt || 0)),
    };
};

const resolveReferencedProduct = ({ message = '', sessionMemory = {}, context = {} }) => {
    const explicitProductId = safeString(
        safeString(message).match(/\b(?:product|item)\s+([a-z0-9._-]{3,})\b/i)?.[1]
        || context?.currentProductId
        || ''
    );

    if (explicitProductId) {
        return {
            productId: explicitProductId,
            ambiguous: false,
        };
    }

    const referencesContext = PRODUCT_REFERENCE_PATTERN.test(message)
        || /\b(first one|first result|top result|best match)\b/i.test(message);

    if (!referencesContext) {
        return {
            productId: '',
            ambiguous: false,
        };
    }

    if (sessionMemory?.activeProduct?.id) {
        return {
            productId: safeString(sessionMemory.activeProduct.id),
            ambiguous: false,
        };
    }

    if (Array.isArray(sessionMemory?.lastResults) && sessionMemory.lastResults.length === 1) {
        return {
            productId: safeString(sessionMemory.lastResults[0]?.id),
            ambiguous: false,
        };
    }

    if (/\b(first one|first result|top result|best match)\b/i.test(message) && Array.isArray(sessionMemory?.lastResults) && sessionMemory.lastResults.length > 0) {
        return {
            productId: safeString(sessionMemory.lastResults[0]?.id),
            ambiguous: false,
        };
    }

    return {
        productId: '',
        ambiguous: Array.isArray(sessionMemory?.lastResults) && sessionMemory.lastResults.length > 1,
    };
};

const buildSupportPrefill = ({ message = '', orderId = '' } = {}) => ({
    category: /\b(refund|return|replace|replacement)\b/i.test(message)
        ? 'returns'
        : /\b(track|tracking|delivery|shipment|late)\b/i.test(message)
            ? 'orders'
            : /\b(payment|charged|upi|card)\b/i.test(message)
                ? 'payments'
                : 'general',
    subject: safeString(message).slice(0, 72) || 'Support request',
    body: safeString(message),
    orderId: safeString(orderId),
});

const findProductFromContext = ({ productId = '', sessionMemory = {} } = {}) => {
    const normalizedProductId = safeString(productId);
    if (!normalizedProductId) return null;

    if (safeString(sessionMemory?.activeProduct?.id || '') === normalizedProductId) {
        return normalizeProductSummary(sessionMemory.activeProduct);
    }

    if (Array.isArray(sessionMemory?.lastResults)) {
        const match = sessionMemory.lastResults.find((product) => safeString(product?.id || '') === normalizedProductId);
        if (match) {
            return normalizeProductSummary(match);
        }
    }

    return null;
};

const buildPolicyPromptMessage = async ({
    policy = {},
    interpretation = {},
    sessionMemory = {},
    context = {},
}) => {
    const actionType = safeString(policy?.actionType || '');
    const query = safeString(interpretation?.entities?.query || '');
    const category = safeString(interpretation?.entities?.category || interpretation?.meta?.categoryLabel || '');
    const page = safeString(interpretation?.meta?.page || '');
    const productId = safeString(interpretation?.entities?.productId || '');

    if (actionType === 'SEARCH') {
        const minBudget = Math.max(0, Number(interpretation?.entities?.priceMin || 0));
        const budget = Math.max(0, Number(interpretation?.entities?.maxPrice || 0));
        const parts = [query || category || 'this search'];
        if (minBudget > 0) {
            parts.push(`above Rs ${minBudget.toLocaleString('en-IN')}`);
        }
        if (budget > 0) {
            parts.push(`under Rs ${budget.toLocaleString('en-IN')}`);
        }
        return `Search for ${parts.join(' ')}?`;
    }

    if (actionType === 'NAVIGATE') {
        if (page === 'category' && category) {
            return `Open ${safeLower(category)}?`;
        }
        if (page) {
            return `Open ${safeLower(page)}?`;
        }
        return 'Open that page?';
    }

    if (actionType === 'SUPPORT') {
        return 'Open support for this request?';
    }

    if (actionType === 'CHECKOUT') {
        return 'Checkout affects payment and order placement. Continue to checkout?';
    }

    if (actionType === 'ADD_TO_CART' || actionType === 'REMOVE_FROM_CART') {
        const localProduct = findProductFromContext({
            productId,
            sessionMemory,
        });
        const fetchedProduct = localProduct || (productId ? await getProductByIdentifier(productId).catch(() => null) : null);
        const productTitle = safeString(fetchedProduct?.title || fetchedProduct?.displayTitle || localProduct?.title || '');
        const verb = actionType === 'REMOVE_FROM_CART' ? 'Remove' : 'Add';
        if (productTitle) {
            return `${verb} ${productTitle} ${actionType === 'REMOVE_FROM_CART' ? 'from' : 'to'} your cart?`;
        }

        if (query) {
            return `${verb} ${query} ${actionType === 'REMOVE_FROM_CART' ? 'from' : 'to'} your cart?`;
        }

        return `${verb} this item ${actionType === 'REMOVE_FROM_CART' ? 'from' : 'to'} your cart?`;
    }

    return safeString(context?.routeLabel || 'Continue with this action?') || 'Continue with this action?';
};

const buildDeterministicInterpretation = ({ message = '', context = {}, sessionMemory = {} }) => {
    const safeMessage = safeString(message);
    const assistantSession = context?.assistantSession && typeof context.assistantSession === 'object'
        ? context.assistantSession
        : {};
    const pageTarget = findPageTarget(safeMessage);
    const quantity = extractQuantity(safeMessage, 1);
    const productReference = resolveReferencedProduct({
        message: safeMessage,
        sessionMemory,
        context,
    });
    const orderId = extractOrderId(safeMessage, context);
    const lastQuery = safeString(sessionMemory.lastQuery || '');
    const localCommerceInterpretation = buildLocalCommerceInterpretation({
        message: safeMessage,
        context,
        sessionMemory,
    });

    if (localCommerceInterpretation) {
        return localCommerceInterpretation;
    }

    const compiledCommand = compileIntentCommand({
        input: safeMessage,
        context,
        sessionMemory,
        assistantSession,
    });
    const compiledCategoryLabel = safeString(compilerCategoryToCatalogCategory(compiledCommand.category || ''));
    const compiledCategorySlug = toCategorySlug(compiledCategoryLabel || compiledCommand.category || '');
    const showMore = SHOW_MORE_PATTERN.test(safeMessage) && Boolean(
        safeString(assistantSession?.lastEntities?.query || '')
        || safeString(assistantSession?.lastEntities?.category || '')
        || lastQuery
    );
    const resolvedLimit = Math.max(
        1,
        Number(
            compiledCommand.limit
            || assistantSession?.lastEntities?.limit
            || 6
        ) || 6
    );
    const resolvedProductId = safeString(compiledCommand.target || productReference.productId || '');

    if (compiledCommand.intent === 'ADD_TO_CART' || compiledCommand.intent === 'REMOVE_FROM_CART') {
        return {
            intent: 'cart_action',
            entities: {
                query: safeString(compiledCommand.query || ''),
                productId: resolvedProductId,
                quantity,
                category: compiledCategoryLabel,
                priceMin: Math.max(0, Number(compiledCommand.filters?.priceMin || 0)),
                maxPrice: Math.max(0, Number(compiledCommand.filters?.priceMax || 0)),
                limit: resolvedLimit,
            },
            confidence: Number(compiledCommand.confidence || 0),
            decision: resolvedProductId ? 'act' : 'clarify',
            response: resolvedProductId
                ? ''
                : compiledCommand.intent === 'REMOVE_FROM_CART'
                    ? `Which ${safeString(compiledCommand.query || 'product')} should I remove from your cart?`
                    : `Which ${safeString(compiledCommand.query || 'product')} should I add to your cart?`,
            meta: {
                operation: compiledCommand.intent === 'REMOVE_FROM_CART' ? 'remove' : 'add',
                page: '',
                orderId: '',
                showMore: false,
                categorySlug: compiledCategorySlug,
                categoryLabel: compiledCategoryLabel,
                refinementFollowUp: false,
                compiledCommand,
            },
        };
    }

    if (compiledCommand.intent === 'SUPPORT') {
        return {
            intent: 'support',
            entities: {
                query: safeMessage,
                productId: resolvedProductId,
                quantity: 0,
                category: '',
                priceMin: 0,
                maxPrice: 0,
                limit: 0,
            },
            confidence: Number(compiledCommand.confidence || 0),
            decision: 'act',
            response: '',
            meta: {
                operation: '',
                page: orderId || /\b(track|tracking)\b/i.test(safeMessage) ? 'orders' : 'support',
                orderId: safeString(compiledCommand.target || orderId),
                showMore: false,
                categorySlug: '',
                categoryLabel: '',
                refinementFollowUp: false,
                compiledCommand,
            },
        };
    }

    if (compiledCommand.intent === 'NAVIGATE') {
        const compiledTarget = safeString(compiledCommand.target || '');
        const targetOverride = NAVIGATION_TARGET_OVERRIDES[compiledTarget] || null;
        const resolvedPage = compiledCategoryLabel
            ? 'category'
            : targetOverride?.page
                || pageTarget?.page
                || (resolvedProductId ? 'product' : compiledTarget);

        return {
            intent: 'navigation',
            entities: {
                query: '',
                productId: resolvedPage === 'product' ? resolvedProductId : '',
                quantity: 0,
                category: resolvedPage === 'category' ? compiledCategoryLabel : '',
                priceMin: 0,
                maxPrice: 0,
                limit: 0,
            },
            confidence: Number(compiledCommand.confidence || 0),
            decision: resolvedPage ? 'act' : 'clarify',
            response: '',
            meta: {
                operation: '',
                page: resolvedPage,
                orderId: '',
                showMore: false,
                categorySlug: resolvedPage === 'category' ? compiledCategorySlug : '',
                categoryLabel: resolvedPage === 'category' ? compiledCategoryLabel : '',
                refinementFollowUp: false,
                navigationParams: targetOverride?.params || {},
                compiledCommand,
            },
        };
    }

    if (compiledCommand.intent === 'SEARCH_PRODUCTS' || compiledCommand.intent === 'FILTER_PRODUCTS') {
        return {
            intent: 'product_search',
            entities: {
                query: safeString(compiledCommand.query || ''),
                productId: '',
                quantity: 0,
                category: compiledCategoryLabel,
                priceMin: Math.max(0, Number(compiledCommand.filters?.priceMin || 0)),
                maxPrice: Math.max(0, Number(compiledCommand.filters?.priceMax || 0)),
                limit: resolvedLimit,
            },
            confidence: Number(compiledCommand.confidence || 0),
            decision: compiledCategoryLabel || safeString(compiledCommand.query || '') ? 'act' : 'clarify',
            response: '',
            meta: {
                operation: '',
                page: '',
                orderId: '',
                showMore,
                categorySlug: compiledCategorySlug,
                categoryLabel: compiledCategoryLabel,
                refinementFollowUp: compiledCommand.intent === 'FILTER_PRODUCTS',
                compiledCommand,
            },
        };
    }

    if (compiledCommand.intent === 'GENERAL_KNOWLEDGE') {
        return {
            intent: 'general_knowledge',
            entities: {
                query: safeMessage,
                productId: '',
                quantity: 0,
                category: '',
                priceMin: 0,
                maxPrice: 0,
                limit: 0,
            },
            confidence: Number(compiledCommand.confidence || 0),
            decision: 'respond',
            response: '',
            meta: {
                operation: '',
                page: '',
                orderId: '',
                showMore: false,
                categorySlug: '',
                categoryLabel: '',
                refinementFollowUp: false,
                compiledCommand,
            },
        };
    }

    if (compiledCommand.intent === 'CONFIRM' || compiledCommand.intent === 'REJECT') {
        return {
            intent: 'unclear',
            entities: {
                query: '',
                productId: '',
                quantity: 0,
                category: '',
                priceMin: 0,
                maxPrice: 0,
                limit: 0,
            },
            confidence: Number(compiledCommand.confidence || 0),
            decision: 'clarify',
            response: compiledCommand.intent === 'CONFIRM'
                ? 'Use the confirmation controls for this action.'
                : 'Use the cancel control if you do not want to continue.',
            meta: {
                operation: '',
                page: '',
                orderId: '',
                showMore: false,
                categorySlug: '',
                categoryLabel: '',
                refinementFollowUp: false,
                compiledCommand,
            },
        };
    }

    return {
        intent: 'unclear',
        entities: {
            query: '',
            productId: '',
            quantity: 0,
            category: compiledCategoryLabel,
            priceMin: Math.max(0, Number(compiledCommand.filters?.priceMin || 0)),
            maxPrice: Math.max(0, Number(compiledCommand.filters?.priceMax || 0)),
            limit: resolvedLimit,
        },
        confidence: Number(compiledCommand.confidence || 0),
        decision: 'clarify',
        response: '',
        meta: {
            operation: '',
            page: '',
            orderId: '',
            showMore: false,
            categorySlug: compiledCategorySlug,
            categoryLabel: compiledCategoryLabel,
            refinementFollowUp: false,
            compiledCommand,
        },
    };
};

const buildInterpreterSystemPrompt = () => [
    'You are an AI assistant for an e-commerce app.',
    'You MUST return ONLY valid JSON.',
    'Format:',
    '{"intent":"general_knowledge | product_search | navigation | cart_action | support | unclear","entities":{"query":"","productId":"","category":"","maxPrice":0,"quantity":0,"limit":0},"confidence":0.0,"response":"","meta":{"operation":"","page":"","orderId":"","showMore":false,"categoryLabel":"","categorySlug":"","refinementFollowUp":false,"navigationParams":{}}}',
    'Rules:',
    '- NEVER return plain text.',
    '- You are the primary planner for this turn. Use the deterministic hint only as fallback grounding, not as the decision source.',
    '- Extract intent and entities clearly.',
    '- If unsure, set intent = "unclear".',
    '- Confidence must be between 0 and 1.',
    '- general_knowledge is only for non-commerce factual or explanatory questions.',
    '- product_search is only for shopping discovery, recommendations, comparisons, budgets, or more results.',
    '- navigation is for opening app pages or browsing a product category.',
    '- cart_action is only for adding or removing a product from cart.',
    '- support is for refunds, returns, tracking, damaged orders, warranty help, or customer-care handoff.',
    '- Use meta.operation = "add" or "remove" for cart_action.',
    '- Use meta.page for navigation targets like home, assistant, cart, checkout, profile, wishlist, marketplace, deals, compare, bundles, visual_search, mission_control, sell, become_seller, my_listings, price_alerts, trade_in, category, product, support, or orders.',
    '- Use meta.navigationParams only when a route needs params, such as {"productId":"..."} or {"category":"laptops"} or {"ids":"p1,p2"}.',
    '- Use response for the direct user-facing reply, especially for general_knowledge answers.',
    '- Never invent productId. Only use it when the user explicitly names it or session memory makes it unambiguous.',
].join('\n');

const buildInterpreterUserPrompt = ({
    message = '',
    deterministic = {},
    sessionMemory = {},
    context = {},
    conversationHistory = [],
}) => {
    const summary = {
        lastQuery: safeString(sessionMemory?.lastQuery || ''),
        activeProduct: sessionMemory?.activeProduct
            ? {
                id: safeString(sessionMemory.activeProduct.id),
                title: safeString(sessionMemory.activeProduct.title),
            }
            : null,
        lastResults: Array.isArray(sessionMemory?.lastResults)
            ? sessionMemory.lastResults.slice(0, 4).map((product) => ({
                id: safeString(product?.id),
                title: safeString(product?.title),
            }))
            : [],
        lastIntent: safeString(sessionMemory?.lastIntent || sessionMemory?.currentIntent || ''),
    };
    const contextSummary = {
        route: safeString(context?.route || ''),
        routeLabel: safeString(context?.routeLabel || ''),
        currentProductId: safeString(context?.currentProduct?.id || context?.currentProductId || ''),
        currentProductTitle: safeString(context?.currentProduct?.title || ''),
        cartItems: Math.max(0, Number(context?.cartSummary?.itemCount || context?.cartSummary?.totalItems || 0)),
    };
    const history = (Array.isArray(conversationHistory) ? conversationHistory : [])
        .slice(-4)
        .map((entry) => ({
            role: safeString(entry?.role || ''),
            content: safeString(entry?.content || ''),
        }))
        .filter((entry) => entry.role && entry.content);

    return [
        `User message: ${safeString(message)}`,
        `Session memory: ${JSON.stringify(summary)}`,
        `Runtime context: ${JSON.stringify(contextSummary)}`,
        `Recent conversation: ${JSON.stringify(history)}`,
        `Fallback grounding hint: ${JSON.stringify({
            intent: deterministic.intent,
            entities: deterministic.entities,
            confidence: deterministic.confidence,
            meta: deterministic.meta,
        })}`,
        'Return JSON only.',
    ].join('\n\n');
};

const normalizeNavigationParams = (value = {}, fallback = {}) => {
    const source = value && typeof value === 'object' ? value : fallback;
    if (!source || typeof source !== 'object') return {};

    return Object.entries(source).reduce((accumulator, [key, entry]) => {
        const normalizedKey = safeString(key);
        if (!normalizedKey) return accumulator;
        if (entry === undefined || entry === null || entry === '') return accumulator;
        accumulator[normalizedKey] = typeof entry === 'string' ? safeString(entry) : entry;
        return accumulator;
    }, {});
};

const normalizeInterpretationMeta = (meta = {}, fallback = {}) => ({
    operation: safeString(meta?.operation || fallback?.operation || ''),
    page: safeString(meta?.page || fallback?.page || ''),
    orderId: safeString(meta?.orderId || fallback?.orderId || ''),
    showMore: meta?.showMore !== undefined
        ? Boolean(meta.showMore)
        : Boolean(fallback?.showMore),
    categoryLabel: safeString(meta?.categoryLabel || fallback?.categoryLabel || ''),
    categorySlug: safeString(meta?.categorySlug || fallback?.categorySlug || ''),
    refinementFollowUp: meta?.refinementFollowUp !== undefined
        ? Boolean(meta.refinementFollowUp)
        : Boolean(fallback?.refinementFollowUp),
    localAnswer: meta?.localAnswer !== undefined
        ? Boolean(meta.localAnswer)
        : Boolean(fallback?.localAnswer),
    compareSelection: meta?.compareSelection !== undefined
        ? Boolean(meta.compareSelection)
        : Boolean(fallback?.compareSelection),
    compareProducts: Array.isArray(meta?.compareProducts)
        ? meta.compareProducts
        : Array.isArray(fallback?.compareProducts)
            ? fallback.compareProducts
            : [],
    compiledCommand: meta?.compiledCommand && typeof meta.compiledCommand === 'object'
        ? meta.compiledCommand
        : fallback?.compiledCommand && typeof fallback.compiledCommand === 'object'
            ? fallback.compiledCommand
            : null,
    navigationParams: normalizeNavigationParams(meta?.navigationParams, fallback?.navigationParams),
});

const normalizeModelInterpretation = (payload = {}, fallback = {}) => ({
    intent: ['product_search', 'general_knowledge', 'cart_action', 'navigation', 'support', 'unclear'].includes(safeString(payload?.intent))
        ? safeString(payload.intent)
        : safeString(fallback.intent || 'unclear'),
    entities: {
        query: safeString(payload?.entities?.query || fallback?.entities?.query || ''),
        productId: safeString(payload?.entities?.productId || fallback?.entities?.productId || ''),
        category: safeString(payload?.entities?.category || fallback?.entities?.category || ''),
        maxPrice: Math.max(0, Number(payload?.entities?.maxPrice ?? fallback?.entities?.maxPrice ?? 0) || 0),
        quantity: Math.max(0, Number(payload?.entities?.quantity ?? fallback?.entities?.quantity ?? 0) || 0),
        limit: Math.max(0, Number(payload?.entities?.limit ?? fallback?.entities?.limit ?? 0) || 0),
    },
    confidence: clamp(payload?.confidence ?? fallback?.confidence ?? 0, 0, 1),
    response: safeString(payload?.response || fallback?.response || ''),
    meta: normalizeInterpretationMeta(payload?.meta, fallback?.meta),
});

const shouldUseModel = (deterministic = {}, message = '') => {
    return Boolean(safeString(message));
};

const interpretWithModel = async ({
    message = '',
    sessionMemory = {},
    deterministic = {},
    context = {},
    conversationHistory = [],
}) => {
    let response = null;

    try {
        response = await generateStructuredResponse({
            systemPrompt: buildInterpreterSystemPrompt(),
            userPrompt: buildInterpreterUserPrompt({
                message,
                deterministic,
                sessionMemory,
                context,
                conversationHistory,
            }),
            temperature: 0.08,
            maxTokens: 320,
        });
    } catch (error) {
        logger.warn('assistant.model_planner_failed', {
            messagePreview: safeString(message).slice(0, 120),
            error: safeString(error?.message || error),
        });
    }

    if (!response?.payload || response.provider === 'local') {
        return {
            interpretation: normalizeModelInterpretation({}),
            provider: 'local',
        };
    }

    return {
        interpretation: normalizeModelInterpretation(response.payload),
        provider: response.provider,
    };
};

const mergeInterpretationMeta = (deterministicMeta = {}, modelMeta = {}) => normalizeInterpretationMeta(
    {
        ...deterministicMeta,
        ...modelMeta,
        navigationParams: normalizeNavigationParams(
            modelMeta?.navigationParams,
            deterministicMeta?.navigationParams
        ),
    },
    deterministicMeta
);

const mergeInterpretations = (deterministic = {}, model = {}) => {
    const modelConfidence = Number(model.confidence || 0);
    const deterministicConfidence = Number(deterministic.confidence || 0);

    if (!model.intent || model.intent === 'unclear' || modelConfidence < 0.35) {
        return deterministic;
    }

    if (
        deterministic?.meta?.localAnswer
        && safeString(deterministic?.response || '')
    ) {
        return deterministic;
    }

    if (
        deterministic.intent === 'support'
        && model.intent !== 'support'
        && deterministicConfidence >= 0.72
    ) {
        return deterministic;
    }

    if (
        ['cart_action', 'navigation'].includes(safeString(deterministic.intent || ''))
        && deterministicConfidence >= 0.75
        && ['general_knowledge', 'unclear'].includes(safeString(model.intent || ''))
    ) {
        return deterministic;
    }

    const merged = {
        ...deterministic,
        ...model,
        entities: {
            query: safeString(model.entities?.query || deterministic.entities?.query || ''),
            productId: safeString(model.entities?.productId || deterministic.entities?.productId || ''),
            category: safeString(model.entities?.category || deterministic.entities?.category || ''),
            maxPrice: Math.max(0, Number(model.entities?.maxPrice || deterministic.entities?.maxPrice || 0)),
            quantity: Math.max(0, Number(model.entities?.quantity || deterministic.entities?.quantity || 0)),
            limit: Math.max(0, Number(model.entities?.limit || deterministic.entities?.limit || 0)),
        },
        meta: mergeInterpretationMeta(deterministic.meta, model.meta),
        confidence: Math.max(modelConfidence, deterministicConfidence),
        response: safeString(model.response || deterministic.response || ''),
    };

    if (
        merged.intent === 'cart_action'
        && !safeString(merged.meta?.operation || '')
    ) {
        return deterministic;
    }

    if (
        merged.intent === 'navigation'
        && !safeString(merged.meta?.page || '')
    ) {
        return deterministic;
    }

    if (merged.intent === 'product_search') {
        const hasSearchTarget = Boolean(
            safeString(merged.entities?.query || '')
            || safeString(merged.entities?.category || '')
            || Number(merged.entities?.maxPrice || 0) > 0
            || Number(merged.entities?.limit || 0) > 0
            || Boolean(merged.meta?.showMore)
        );
        if (!hasSearchTarget) {
            return deterministic;
        }
    }

    return merged;
};

const buildKnowledgeFallback = (message = '') => ({
    response: (() => {
        const normalized = safeLower(message)
            .replace(/[^\w\s'-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!normalized) {
            return 'I can help with shopping, navigation, and app questions.';
        }

        if (SMALL_TALK_PATTERN.test(normalized)) {
            return 'Hi. I can help with shopping, navigation, and live app questions.';
        }

        if (THANKS_PATTERN.test(normalized)) {
            return 'Anytime. I can still help with shopping actions, navigation, and app flows.';
        }

        if (FAREWELL_PATTERN.test(normalized)) {
            return 'See you soon.';
        }

        return `The live knowledge service is unavailable right now, so I cannot answer "${safeString(message)}" reliably. I can still help with shopping actions and app flows.`;
    })(),
    provider: 'local',
});

const buildKnowledgePrompt = (message = '') => ({
    systemPrompt: [
        'You answer general knowledge questions for a commerce assistant.',
        'Return strict JSON only.',
        'Schema: {"answer":"string"}',
        'Rules:',
        '- Answer directly and concisely.',
        '- Do not mention products, shopping UI, or cart behavior.',
        '- If the answer is uncertain, say so plainly instead of guessing.',
    ].join('\n'),
    userPrompt: `Question: ${safeString(message)}\n\nReturn JSON only.`,
});

const answerGeneralKnowledge = async (message = '') => {
    const prompt = buildKnowledgePrompt(message);
    const response = await generateStructuredResponse({
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        temperature: 0.18,
        maxTokens: 260,
    });

    if (!response?.payload || response.provider === 'local') {
        return buildKnowledgeFallback(message);
    }

    return {
        response: safeString(response.payload?.answer || ''),
        provider: response.provider,
    };
};

const shouldOfferStructuredClarification = ({
    message = '',
    interpretation = {},
} = {}) => {
    const normalizedMessage = safeString(message);
    if (!normalizedMessage) return false;

    if (['product_search', 'cart_action', 'navigation', 'support'].includes(safeString(interpretation?.intent || ''))) {
        return true;
    }

    return (
        SEARCH_PATTERN.test(normalizedMessage)
        || CART_ADD_PATTERN.test(normalizedMessage)
        || CART_REMOVE_PATTERN.test(normalizedMessage)
        || NAVIGATION_PATTERN.test(normalizedMessage)
        || SUPPORT_PATTERN.test(normalizedMessage)
        || SHOW_MORE_PATTERN.test(normalizedMessage)
        || FILTER_REFINEMENT_PATTERN.test(normalizedMessage)
        || CATEGORY_BROWSE_PATTERN.test(normalizedMessage)
        || PRODUCT_REFERENCE_PATTERN.test(normalizedMessage)
        || PRODUCT_SEARCH_CUE_PATTERN.test(normalizedMessage)
        || GENERAL_KNOWLEDGE_PATTERN.test(normalizedMessage)
        || Boolean(safeString(interpretation?.entities?.category || interpretation?.meta?.categoryLabel || ''))
    );
};

const getDecisionBand = (confidence = 0) => {
    const normalized = Number(confidence || 0);
    if (normalized >= ACT_DIRECT_THRESHOLD) return 'act';
    if (normalized >= INFER_CONFIRM_THRESHOLD) return 'infer';
    return 'clarify';
};

const buildClarificationFingerprint = ({
    message = '',
    intent = '',
    response = '',
    followUps = [],
} = {}) => [
    safeLower(message),
    safeLower(intent),
    safeLower(response),
    (Array.isArray(followUps) ? followUps : []).map((entry) => safeLower(entry)).join('|'),
].filter(Boolean).join('::').slice(0, 240);

const buildNextClarificationState = ({
    current = {},
    fingerprint = '',
    question = '',
} = {}) => ({
    fingerprint: safeString(fingerprint),
    count: safeString(fingerprint) && safeString(current?.fingerprint) === safeString(fingerprint)
        ? Math.max(0, Number(current?.count || 0)) + 1
        : 1,
    lastQuestion: safeString(question),
});

const buildCategoryFollowUps = (categoryLabel = '') => {
    const normalized = safeLower(categoryLabel);
    if (!normalized) return [];
    return [`Browse ${normalized}`, `Search ${normalized} products`];
};

const buildSessionMemory = ({
    current = {},
    assistantTurn = {},
    products = [],
    activeProduct = null,
    clarificationState = null,
    lastActionFingerprint,
    lastActionAt,
}) => {
    const nextIntent = safeString(assistantTurn?.intent || current?.lastIntent || current?.currentIntent || '');

    return {
        lastQuery: safeString(
            assistantTurn?.intent === 'product_search'
                ? assistantTurn?.entities?.query
                : current?.lastQuery || ''
        ),
        lastResults: assistantTurn?.intent === 'product_search'
            ? uniqueProducts(products).slice(0, clamp(assistantTurn?.entities?.limit || 6, 1, MAX_COMPILED_RESULTS))
            : uniqueProducts(current?.lastResults || []).slice(0, 6),
        activeProduct: normalizeProductSummary(activeProduct || current?.activeProduct || null),
        lastIntent: nextIntent,
        currentIntent: nextIntent,
        clarificationState: clarificationState
            ? normalizeClarificationState(clarificationState)
            : normalizeClarificationState(current?.clarificationState || {}),
        lastActionFingerprint: safeString((lastActionFingerprint ?? current?.lastActionFingerprint) || ''),
        lastActionAt: Math.max(0, Number((lastActionAt ?? current?.lastActionAt) || 0)),
    };
};

const buildFollowUps = ({
    intent = '',
    products = [],
    actionType = '',
    hasMoreContext = false,
    categoryLabel = '',
    inferred = false,
    existing = [],
}) => {
    const next = Array.isArray(existing) ? existing.map((entry) => safeString(entry)).filter(Boolean) : [];

    if (intent === 'product_search') {
        if (products.length > 1) next.push('show more');
        if (products.length === 1) next.push('add this to cart');
        if (inferred && categoryLabel) next.unshift(`Browse ${safeLower(categoryLabel)}`);
        return [...new Set(next)].slice(0, 4);
    }

    if (intent === 'cart_action') {
        next.push('show my cart', 'go to checkout');
        return [...new Set(next)].slice(0, 3);
    }

    if (intent === 'support') {
        next.push(hasMoreContext ? 'open support' : 'show my orders');
        return [...new Set(next)].slice(0, 3);
    }

    if (intent === 'navigation' && actionType === 'checkout') {
        next.push('show my cart');
        return [...new Set(next)].slice(0, 3);
    }

    if (intent === 'navigation' && inferred && categoryLabel) {
        next.push(`Search ${safeLower(categoryLabel)} products`);
    }

    return [...new Set(next)].slice(0, 4);
};

const createAssistantTurn = ({
    intent = 'unclear',
    entities = {},
    confidence = 0,
    decision = 'clarify',
    response = '',
    actions = [],
    ui = {},
    followUps = [],
    sessionMemory = {},
    policy = null,
    decisionTrace = null,
    assistantSession = null,
}) => ({
    intent: safeString(intent || 'unclear'),
    entities: {
        query: safeString(entities?.query || ''),
        productId: safeString(entities?.productId || ''),
        category: safeString(entities?.category || ''),
        priceMin: Math.max(0, Number(entities?.priceMin || 0)),
        maxPrice: Math.max(0, Number(entities?.maxPrice || 0)),
        quantity: Math.max(0, Number(entities?.quantity) || 0),
        limit: Math.max(0, Number(entities?.limit || 0)),
    },
    confidence: clamp(confidence, 0, 1),
    decision: safeString(decision || 'clarify'),
    response: safeString(response),
    actions: Array.isArray(actions) ? actions.filter(Boolean).slice(0, 2) : [],
    ui: {
        surface: safeString(ui?.surface || 'plain_answer'),
        products: uniqueProducts(ui?.products || []).slice(0, clamp(entities?.limit || 6, 1, MAX_COMPILED_RESULTS)),
        product: normalizeProductSummary(ui?.product || null),
        cartSummary: ui?.cartSummary || null,
        confirmation: ui?.confirmation || null,
        navigation: ui?.navigation || null,
        support: ui?.support || null,
        search: ui?.search || null,
    },
    followUps: Array.isArray(followUps) ? followUps.map((entry) => safeString(entry)).filter(Boolean).slice(0, 4) : [],
    sessionMemory,
    assistantSession: assistantSession || null,
    contextPatch: {
        sessionMemory,
    },
    policy: policy && typeof policy === 'object' ? {
        actionType: safeString(policy?.actionType || ''),
        risk: safeString(policy?.risk || ''),
        decision: safeString(policy?.decision || ''),
        reason: safeString(policy?.reason || ''),
        confidence: clamp(policy?.confidence ?? confidence, 0, 1),
    } : null,
    decisionTrace: decisionTrace && typeof decisionTrace === 'object'
        ? {
            input: safeString(decisionTrace?.input || ''),
            resolvedIntent: safeString(decisionTrace?.resolvedIntent || intent),
            confidence: clamp(decisionTrace?.confidence ?? confidence, 0, 1),
            risk: safeString(decisionTrace?.risk || ''),
            decision: safeString(decisionTrace?.decision || ''),
            fallbackUsed: Boolean(decisionTrace?.fallbackUsed),
            actionType: safeString(decisionTrace?.actionType || ''),
            matchType: safeString(decisionTrace?.matchType || ''),
        }
        : null,
    safetyFlags: [],
});

const buildDecisionTrace = ({
    input = '',
    interpretation = {},
    policy = {},
    fallbackUsed = false,
    matchType = '',
} = {}) => ({
    input: safeString(input),
    resolvedIntent: safeString(interpretation?.intent || ''),
    confidence: clamp(interpretation?.confidence ?? policy?.confidence ?? 0, 0, 1),
    risk: safeString(policy?.risk || ''),
    decision: safeString(policy?.decision || ''),
    fallbackUsed: Boolean(fallbackUsed),
    actionType: safeString(policy?.actionType || ''),
    matchType: safeString(matchType || ''),
});

const mapPolicyDecisionToTurnDecision = (policyDecision = '') => {
    const normalized = safeString(policyDecision);
    if (normalized === 'EXECUTE') return 'act';
    if (normalized === 'RESPOND') return 'respond';
    return 'clarify';
};

const applyDecisionMetadata = (assistantTurn = {}, policy = {}, decisionTrace = {}) => ({
    ...assistantTurn,
    policy: assistantTurn?.policy || {
        actionType: safeString(policy?.actionType || ''),
        risk: safeString(policy?.risk || ''),
        decision: safeString(policy?.decision || ''),
        reason: safeString(policy?.reason || ''),
        confidence: clamp(policy?.confidence ?? assistantTurn?.confidence ?? 0, 0, 1),
    },
    decisionTrace: assistantTurn?.decisionTrace || buildDecisionTrace({
        input: safeString(decisionTrace?.input || ''),
        interpretation: {
            intent: safeString(decisionTrace?.resolvedIntent || assistantTurn?.intent || ''),
            confidence: decisionTrace?.confidence ?? assistantTurn?.confidence ?? 0,
        },
        policy,
        fallbackUsed: Boolean(decisionTrace?.fallbackUsed),
        matchType: safeString(decisionTrace?.matchType || ''),
    }),
});

const buildConfirmationAction = ({
    policy = {},
    interpretation = {},
    sessionMemory = {},
} = {}) => {
    const actionType = safeString(policy?.actionType || '');
    const page = safeString(interpretation?.meta?.page || '');
    const categorySlug = safeString(interpretation?.meta?.categorySlug || toCategorySlug(interpretation?.entities?.category || ''));
    const productId = safeString(interpretation?.entities?.productId || '');
    const navigationParams = interpretation?.meta?.navigationParams && typeof interpretation.meta.navigationParams === 'object'
        ? { ...interpretation.meta.navigationParams }
        : {};

    if (actionType === 'SEARCH') {
        return {
            type: 'search_products',
            query: safeString(interpretation?.entities?.query || sessionMemory?.lastQuery || ''),
            filters: {
                category: safeString(interpretation?.entities?.category || ''),
                priceMin: Math.max(0, Number(interpretation?.entities?.priceMin || 0)),
                maxPrice: Math.max(0, Number(interpretation?.entities?.maxPrice || 0)),
            },
            limit: Math.max(1, Number(interpretation?.entities?.limit || 6)),
            reason: policy.reason,
        };
    }

    if (actionType === 'ADD_TO_CART' || actionType === 'REMOVE_FROM_CART') {
        return {
            type: actionType === 'REMOVE_FROM_CART' ? 'remove_from_cart' : 'add_to_cart',
            productId,
            quantity: Math.max(1, Number(interpretation?.entities?.quantity || 1)),
            reason: policy.reason,
        };
    }

    if (actionType === 'CHECKOUT') {
        return {
            type: 'navigate_to',
            page: 'checkout',
            params: {},
            requiresConfirmation: true,
            reason: policy.reason,
        };
    }

    if (actionType === 'SUPPORT') {
        return {
            type: 'navigate_to',
            page: safeString(interpretation?.meta?.page || 'support'),
            params: {},
            reason: policy.reason,
        };
    }

    if (actionType === 'NAVIGATE') {
        if (page === 'category') {
            return {
                type: 'navigate_to',
                page: 'category',
                params: {
                    category: categorySlug,
                    ...navigationParams,
                },
                reason: policy.reason,
            };
        }

        if (page === 'product') {
            return {
                type: 'navigate_to',
                page: 'product',
                params: {
                    productId,
                },
                reason: policy.reason,
            };
        }

        return {
            type: 'navigate_to',
            page,
            params: navigationParams,
            reason: policy.reason,
        };
    }

    return null;
};

const buildClarificationPayload = ({
    message = '',
    interpretation = {},
    sessionMemory = {},
} = {}) => {
    const categoryLabel = safeString(interpretation?.entities?.category || interpretation?.meta?.categoryLabel || '');
    const lastQuery = safeString(sessionMemory?.lastQuery || '');
    const lastResults = uniqueProducts(sessionMemory?.lastResults || []).slice(0, 4);
    const operation = safeString(interpretation?.meta?.operation || '');
    const page = safeString(interpretation?.meta?.page || '');

    if (interpretation?.intent === 'cart_action' && !safeString(interpretation?.entities?.productId || '')) {
        if (lastResults.length > 1) {
            return {
                response: operation === 'remove'
                    ? 'Pick the cart item you want me to remove.'
                    : 'Pick the product you want me to add to your cart.',
                followUps: [],
                ui: {
                    surface: 'product_results',
                    products: lastResults,
                },
            };
        }

        return {
            response: operation === 'remove'
                ? 'Which cart item should I remove?'
                : 'Which product should I add to your cart?',
            followUps: [],
            ui: {
                surface: 'plain_answer',
            },
        };
    }

    if (interpretation?.intent === 'navigation' && page === 'product' && !safeString(interpretation?.entities?.productId || '')) {
        return {
            response: lastResults.length > 1 ? 'Pick the product you want me to open.' : 'Which product should I open?',
            followUps: [],
            ui: {
                surface: lastResults.length > 1 ? 'product_results' : 'plain_answer',
                products: lastResults,
            },
        };
    }

    if (categoryLabel) {
        return {
            response: `Do you mean browse ${safeLower(categoryLabel)} or search products in ${safeLower(categoryLabel)}?`,
            followUps: buildCategoryFollowUps(categoryLabel),
            ui: {
                surface: 'plain_answer',
            },
        };
    }

    if (lastQuery && safeString(sessionMemory?.lastIntent || sessionMemory?.currentIntent || '') === 'product_search') {
        return {
            response: `Do you want more results for ${lastQuery} or a tighter budget?`,
            followUps: ['show more', `Search ${lastQuery}`],
            ui: {
                surface: 'plain_answer',
            },
        };
    }

    return {
        response: 'Can you clarify what you want?',
        followUps: [],
        ui: {
            surface: 'plain_answer',
        },
    };
};

const escalateClarificationPayload = (clarification = {}) => ({
    ...clarification,
    response: clarification?.ui?.surface === 'product_results'
        ? 'Pick the matching product so I can continue.'
        : Array.isArray(clarification?.followUps) && clarification.followUps.length > 0
            ? 'Pick one of these options so I can continue.'
            : safeString(clarification?.response || ''),
});

const forceInferenceFromContext = ({
    message = '',
    interpretation = {},
    sessionMemory = {},
} = {}) => {
    const categoryLabel = safeString(interpretation?.entities?.category || interpretation?.meta?.categoryLabel || '');
    const categorySlug = safeString(interpretation?.meta?.categorySlug || toCategorySlug(categoryLabel));
    const activeProductId = safeString(sessionMemory?.activeProduct?.id || '');
    const singleResultId = Array.isArray(sessionMemory?.lastResults) && sessionMemory.lastResults.length === 1
        ? safeString(sessionMemory.lastResults[0]?.id)
        : '';
    const lastQuery = safeString(sessionMemory?.lastQuery || '');

    if (interpretation.intent === 'cart_action' && !safeString(interpretation?.entities?.productId || '')) {
        const resolvedProductId = activeProductId || singleResultId;
        if (resolvedProductId) {
            return {
                ...interpretation,
                confidence: Math.max(INFER_CONFIRM_THRESHOLD, Number(interpretation.confidence || 0)),
                entities: {
                    ...interpretation.entities,
                    productId: resolvedProductId,
                },
            };
        }
    }

    if (interpretation.intent === 'navigation' && safeString(interpretation?.meta?.page || '') === 'product' && !safeString(interpretation?.entities?.productId || '')) {
        const resolvedProductId = activeProductId || singleResultId;
        if (resolvedProductId) {
            return {
                ...interpretation,
                confidence: Math.max(INFER_CONFIRM_THRESHOLD, Number(interpretation.confidence || 0)),
                entities: {
                    ...interpretation.entities,
                    productId: resolvedProductId,
                },
            };
        }
    }

    if (
        (interpretation.intent === 'unclear' || interpretation.intent === 'product_search')
        && categorySlug
        && CATEGORY_BROWSE_PATTERN.test(message)
        && !resolveCategoryBrowseQuery(message, categoryLabel)
    ) {
        return {
            ...interpretation,
            intent: 'navigation',
            confidence: Math.max(INFER_CONFIRM_THRESHOLD, Number(interpretation.confidence || 0)),
            entities: {
                ...interpretation.entities,
                category: categoryLabel,
            },
            meta: {
                ...interpretation.meta,
                page: 'category',
                categorySlug,
                categoryLabel,
            },
        };
    }

    if ((interpretation.intent === 'unclear' || interpretation.intent === 'product_search') && lastQuery) {
        const merged = mergeSearchContext({
            message,
            lastQuery,
            category: categoryLabel,
        });

        return {
            ...interpretation,
            intent: 'product_search',
            confidence: Math.max(INFER_CONFIRM_THRESHOLD, Number(interpretation.confidence || 0)),
            entities: {
                ...interpretation.entities,
                query: safeString(merged.query || lastQuery),
                category: safeString(merged.category || categoryLabel),
                maxPrice: Math.max(0, Number(merged.maxPrice || interpretation?.entities?.maxPrice || 0)),
            },
            meta: {
                ...interpretation.meta,
                categorySlug: toCategorySlug(merged.category || categoryLabel),
                categoryLabel: safeString(merged.category || categoryLabel),
                showMore: Boolean(interpretation?.meta?.showMore),
            },
        };
    }

    return null;
};

const executeDecision = async ({
    message = '',
    interpretation = {},
    context = {},
    sessionMemory = {},
    policyOverrideDecision = '',
    policyReasonOverride = '',
}) => {
    let workingInterpretation = {
        ...interpretation,
        entities: {
            query: safeString(interpretation?.entities?.query || ''),
            productId: safeString(interpretation?.entities?.productId || ''),
            category: safeString(interpretation?.entities?.category || ''),
            maxPrice: Math.max(0, Number(interpretation?.entities?.maxPrice || 0)),
            quantity: Math.max(0, Number(interpretation?.entities?.quantity || 0)),
        },
        meta: interpretation?.meta || {},
    };
    let band = getDecisionBand(workingInterpretation.confidence);
    const provider = safeString(workingInterpretation.provider || 'local');
    const clarificationAttempts = Math.max(0, Number(sessionMemory?.clarificationState?.count || 0));
    let policy = evaluateExecutionPolicy({
        intentResolution: workingInterpretation,
        clarificationAttempts,
    });
    if (safeString(policyOverrideDecision)) {
        policy = {
            ...policy,
            decision: safeString(policyOverrideDecision),
            reason: safeString(policyReasonOverride || policy.reason || ''),
        };
    }
    let decisionTrace = buildDecisionTrace({
        input: message,
        interpretation: workingInterpretation,
        policy,
        fallbackUsed: false,
    });

    logger.info('assistant.policy_decision', {
        input: safeString(message).slice(0, 200),
        resolvedIntent: decisionTrace.resolvedIntent,
        confidence: decisionTrace.confidence,
        risk: decisionTrace.risk,
        decision: decisionTrace.decision,
        fallbackUsed: decisionTrace.fallbackUsed,
        actionType: decisionTrace.actionType,
        sessionId: safeString(context?.assistantSession?.sessionId || ''),
        contextVersion: Math.max(0, Number(context?.assistantSession?.contextVersion || 0)),
    });

    if (policy.decision === 'CONFIRM' && workingInterpretation.intent !== 'general_knowledge') {
        const confirmationMessage = await buildPolicyPromptMessage({
            policy,
            interpretation: workingInterpretation,
            sessionMemory,
            context,
        });
        const confirmationAction = buildConfirmationAction({
            policy,
            interpretation: workingInterpretation,
            sessionMemory,
        });
        const assistantTurn = applyDecisionMetadata(createAssistantTurn({
            intent: safeString(workingInterpretation.intent || 'unclear'),
            entities: workingInterpretation.entities,
            confidence: workingInterpretation.confidence,
            decision: mapPolicyDecisionToTurnDecision(policy.decision),
            response: confirmationMessage,
            ui: {
                surface: 'confirmation_card',
                confirmation: {
                    token: '',
                    message: confirmationMessage,
                    action: confirmationAction,
                },
            },
            followUps: ['Modify request'],
            sessionMemory: buildSessionMemory({
                current: sessionMemory,
                assistantTurn: workingInterpretation,
                clarificationState: {},
            }),
            policy,
            decisionTrace,
        }), policy, decisionTrace);

        return {
            answer: assistantTurn.response,
            assistantTurn,
            products: [],
            followUps: assistantTurn.followUps,
            provider,
        };
    }

    if (
        policy.decision === 'CLARIFY'
        || policy.decision === 'CLARIFY_STRONG'
        || policy.decision === 'FORCE_STRUCTURED_UI'
        || band === 'clarify'
        || workingInterpretation.intent === 'unclear'
    ) {
        const clarification = buildClarificationPayload({
            message,
            interpretation: workingInterpretation,
            sessionMemory,
        });
        const strongClarification = policy.decision === 'CLARIFY_STRONG' || policy.decision === 'FORCE_STRUCTURED_UI';
        const structuredOptions = strongClarification
            ? uniqueProducts(sessionMemory?.lastResults || []).slice(0, 4)
            : [];
        const effectiveClarification = strongClarification
            && structuredOptions.length > 0
            && shouldOfferStructuredClarification({
                message,
                interpretation: workingInterpretation,
            })
            ? {
                response: 'Pick the matching product so I can continue.',
                followUps: clarification.followUps,
                ui: {
                    surface: 'product_results',
                    products: structuredOptions,
                },
            }
            : clarification;
        const fingerprint = buildClarificationFingerprint({
            message,
            intent: workingInterpretation.intent,
            response: effectiveClarification.response,
            followUps: effectiveClarification.followUps,
        });
        const nextClarificationState = buildNextClarificationState({
            current: sessionMemory?.clarificationState || {},
            fingerprint,
            question: effectiveClarification.response,
        });

        if (nextClarificationState.count > MAX_CLARIFICATION_REPEATS) {
            const forcedInterpretation = forceInferenceFromContext({
                message,
                interpretation: workingInterpretation,
                sessionMemory,
            });

            if (forcedInterpretation) {
                workingInterpretation = forcedInterpretation;
                band = getDecisionBand(Math.max(forcedInterpretation.confidence, INFER_CONFIRM_THRESHOLD));
                policy = evaluateExecutionPolicy({
                    intentResolution: workingInterpretation,
                    clarificationAttempts: nextClarificationState.count,
                });
                decisionTrace = buildDecisionTrace({
                    input: message,
                    interpretation: workingInterpretation,
                    policy,
                    fallbackUsed: true,
                });
                if (policy.decision === 'CONFIRM' && workingInterpretation.intent !== 'general_knowledge') {
                    const confirmationMessage = await buildPolicyPromptMessage({
                        policy,
                        interpretation: workingInterpretation,
                        sessionMemory,
                        context,
                    });
                    const confirmationAction = buildConfirmationAction({
                        policy,
                        interpretation: workingInterpretation,
                        sessionMemory,
                    });
                    const assistantTurn = applyDecisionMetadata(createAssistantTurn({
                        intent: safeString(workingInterpretation.intent || 'unclear'),
                        entities: workingInterpretation.entities,
                        confidence: workingInterpretation.confidence,
                        decision: mapPolicyDecisionToTurnDecision(policy.decision),
                        response: confirmationMessage,
                        ui: {
                            surface: 'confirmation_card',
                            confirmation: {
                                token: '',
                                message: confirmationMessage,
                                action: confirmationAction,
                            },
                        },
                        followUps: ['Modify request'],
                        sessionMemory: buildSessionMemory({
                            current: sessionMemory,
                            assistantTurn: workingInterpretation,
                            clarificationState: {},
                        }),
                        policy,
                        decisionTrace,
                    }), policy, decisionTrace);

                    return {
                        answer: assistantTurn.response,
                        assistantTurn,
                        products: [],
                        followUps: assistantTurn.followUps,
                        provider,
                    };
                }
            } else {
                const escalatedClarification = escalateClarificationPayload(clarification);
                const assistantTurn = applyDecisionMetadata(createAssistantTurn({
                    intent: safeString(workingInterpretation.intent || 'unclear'),
                    entities: workingInterpretation.entities,
                    confidence: workingInterpretation.confidence,
                    decision: 'clarify',
                    response: escalatedClarification.response,
                    ui: escalatedClarification.ui,
                    followUps: escalatedClarification.followUps,
                    sessionMemory: buildSessionMemory({
                        current: sessionMemory,
                        assistantTurn: workingInterpretation,
                        clarificationState: buildNextClarificationState({
                            current: sessionMemory?.clarificationState || {},
                            fingerprint: buildClarificationFingerprint({
                                message,
                                intent: workingInterpretation.intent,
                                response: escalatedClarification.response,
                                followUps: escalatedClarification.followUps,
                            }),
                            question: escalatedClarification.response,
                        }),
                    }),
                    policy,
                    decisionTrace,
                }), policy, decisionTrace);

                return {
                    answer: assistantTurn.response,
                    assistantTurn,
                    products: uniqueProducts(escalatedClarification?.ui?.products || []).slice(0, 6),
                    followUps: assistantTurn.followUps,
                    provider,
                };
            }
        } else {
            const assistantTurn = applyDecisionMetadata(createAssistantTurn({
                intent: safeString(workingInterpretation.intent || 'unclear'),
                entities: workingInterpretation.entities,
                confidence: workingInterpretation.confidence,
                decision: 'clarify',
                response: effectiveClarification.response,
                ui: effectiveClarification.ui,
                followUps: effectiveClarification.followUps,
                sessionMemory: buildSessionMemory({
                    current: sessionMemory,
                    assistantTurn: workingInterpretation,
                    clarificationState: nextClarificationState,
                }),
                policy,
                decisionTrace,
            }), policy, decisionTrace);

            return {
                answer: assistantTurn.response,
                assistantTurn,
                products: uniqueProducts(effectiveClarification?.ui?.products || []).slice(0, 6),
                followUps: assistantTurn.followUps,
                provider,
            };
        }
    }

    if (workingInterpretation.intent === 'general_knowledge') {
        const useLocalKnowledge = Boolean(
            workingInterpretation?.meta?.localAnswer
            && safeString(workingInterpretation.response || '')
        );
        const usePlannerKnowledge = Boolean(
            !useLocalKnowledge
            && provider !== 'local'
            && safeString(workingInterpretation.response || '')
        );
        const knowledge = useLocalKnowledge
            ? {
                response: safeString(workingInterpretation.response || ''),
                provider: 'local',
            }
            : usePlannerKnowledge
                ? {
                    response: safeString(workingInterpretation.response || ''),
                    provider,
                }
            : await answerGeneralKnowledge(message);
        const assistantTurn = applyDecisionMetadata(createAssistantTurn({
            intent: 'general_knowledge',
            entities: workingInterpretation.entities,
            confidence: workingInterpretation.confidence,
            decision: 'respond',
            response: knowledge.response || workingInterpretation.response,
            ui: {
                surface: 'plain_answer',
            },
            followUps: [],
            sessionMemory: buildSessionMemory({
                current: sessionMemory,
                assistantTurn: workingInterpretation,
                clarificationState: {},
            }),
            policy,
            decisionTrace,
        }), policy, decisionTrace);

        return {
            answer: assistantTurn.response,
            assistantTurn,
            products: [],
            followUps: [],
            provider: safeString(knowledge.provider || provider),
        };
    }

    if (workingInterpretation.intent === 'product_search') {
        if (workingInterpretation?.meta?.compareSelection) {
            const selectedProducts = uniqueProducts(
                workingInterpretation?.meta?.compareProducts
                || sessionMemory?.lastResults
                || []
            ).slice(0, 2);
            const compareIds = selectedProducts.map((product) => safeString(product.id)).filter(Boolean).join(',');

            if (selectedProducts.length >= 2 && compareIds) {
                const navigation = buildNavigationDescriptor('compare', {
                    ids: compareIds,
                });

                const assistantTurn = applyDecisionMetadata(createAssistantTurn({
                    intent: 'product_search',
                    entities: {
                        ...workingInterpretation.entities,
                        limit: 2,
                    },
                    confidence: workingInterpretation.confidence,
                    decision: 'act',
                    response: 'Comparing the first two results.',
                    actions: [
                        {
                            type: 'navigate_to',
                            page: 'compare',
                            params: {
                                ids: compareIds,
                            },
                            reason: 'compare_selected_results',
                        },
                    ],
                    ui: {
                        surface: 'product_results',
                        products: selectedProducts,
                        navigation,
                        search: {
                            query: 'comparison',
                            matchType: 'exact',
                            confidence: clamp(workingInterpretation.confidence ?? 0.9, 0, 0.99),
                        },
                    },
                    followUps: [
                        'Open the first one',
                        'Show cheaper options',
                    ],
                    sessionMemory: buildSessionMemory({
                        current: sessionMemory,
                        assistantTurn: {
                            ...workingInterpretation,
                            entities: {
                                ...workingInterpretation.entities,
                                limit: 2,
                            },
                        },
                        products: selectedProducts,
                        clarificationState: {},
                    }),
                    policy,
                    decisionTrace,
                }), policy, decisionTrace);

                return {
                    answer: assistantTurn.response,
                    assistantTurn,
                    products: selectedProducts,
                    followUps: assistantTurn.followUps,
                    provider,
                };
            }
        }

        const categoryLabel = safeString(workingInterpretation.entities?.category || workingInterpretation.meta?.categoryLabel || '');
        const excludeIds = workingInterpretation.meta?.showMore
            ? (sessionMemory?.lastResults || []).map((product) => safeString(product?.id)).filter(Boolean)
            : [];
        const requestedLimit = Math.max(1, Number(workingInterpretation.entities?.limit || workingInterpretation.meta?.compiledCommand?.limit || 6) || 6);
        const search = await searchProducts({
            query: workingInterpretation.entities?.query,
            category: categoryLabel || context?.category || '',
            minPrice: Math.max(0, Number(workingInterpretation.entities?.priceMin || 0)),
            maxPrice: Math.max(0, Number(workingInterpretation.entities?.maxPrice || 0)),
            excludeIds,
            limit: requestedLimit,
        });

        const products = uniqueProducts(search.products).slice(0, requestedLimit);
        const inferred = false;
        const structuredQuery = safeString(workingInterpretation.entities?.query || '');
        const displaySearchLabel = safeString(
            structuredQuery
            || search.category
            || categoryLabel
            || search.query
            || 'your search'
        );
        decisionTrace = {
            ...decisionTrace,
            matchType: search.usedClosestMatch ? 'approximate' : 'exact',
        };

        if (products.length === 0) {
            const response = `I couldn't find relevant products for ${displaySearchLabel}. Try a more specific product name or budget.`;
            const followUps = categoryLabel ? buildCategoryFollowUps(categoryLabel) : [];
            const fingerprint = buildClarificationFingerprint({
                message,
                intent: 'product_search',
                response,
                followUps,
            });
            const nextClarificationState = buildNextClarificationState({
                current: sessionMemory?.clarificationState || {},
                fingerprint,
                question: response,
            });

            const assistantTurn = applyDecisionMetadata(createAssistantTurn({
                intent: 'product_search',
                entities: {
                    ...workingInterpretation.entities,
                    query: structuredQuery,
                    category: safeString(search.category || categoryLabel),
                    priceMin: Math.max(0, Number(search.minPrice || workingInterpretation.entities?.priceMin || 0)),
                    maxPrice: Math.max(0, Number(search.maxPrice || workingInterpretation.entities?.maxPrice || 0)),
                    limit: requestedLimit,
                },
                confidence: workingInterpretation.confidence,
                decision: 'clarify',
                response,
                ui: {
                    surface: 'plain_answer',
                },
                followUps,
                sessionMemory: buildSessionMemory({
                    current: sessionMemory,
                    assistantTurn: {
                        ...workingInterpretation,
                        entities: {
                            ...workingInterpretation.entities,
                            query: structuredQuery,
                            category: safeString(search.category || categoryLabel),
                            priceMin: Math.max(0, Number(search.minPrice || workingInterpretation.entities?.priceMin || 0)),
                            maxPrice: Math.max(0, Number(search.maxPrice || workingInterpretation.entities?.maxPrice || 0)),
                            limit: requestedLimit,
                        },
                    },
                    clarificationState: nextClarificationState,
                }),
                policy,
                decisionTrace,
            }), policy, decisionTrace);

            return {
                answer: assistantTurn.response,
                assistantTurn,
                products: [],
                followUps: assistantTurn.followUps,
                provider,
            };
        }

        const assistantTurn = applyDecisionMetadata(createAssistantTurn({
            intent: 'product_search',
            entities: {
                ...workingInterpretation.entities,
                query: structuredQuery,
                category: safeString(search.category || categoryLabel),
                priceMin: Math.max(0, Number(search.minPrice || workingInterpretation.entities?.priceMin || 0)),
                maxPrice: Math.max(0, Number(search.maxPrice || workingInterpretation.entities?.maxPrice || 0)),
                limit: requestedLimit,
            },
            confidence: workingInterpretation.confidence,
            decision: 'respond',
            response: search.usedClosestMatch
                ? `No exact match${
                    search.maxPrice
                        ? ` under Rs ${Number(search.maxPrice).toLocaleString('en-IN')}`
                        : search.minPrice
                            ? ` above Rs ${Number(search.minPrice).toLocaleString('en-IN')}`
                            : ''
                }. Showing closest results.`
                : inferred
                    ? `Showing results based on your request for ${displaySearchLabel}.`
                    : `Found ${products.length} relevant result${products.length === 1 ? '' : 's'} for ${displaySearchLabel}.`,
            ui: {
                surface: products.length > 1 ? 'product_results' : products.length === 1 ? 'product_focus' : 'plain_answer',
                products,
                product: products.length === 1 ? products[0] : null,
                search: {
                    query: displaySearchLabel,
                    matchType: search.usedClosestMatch ? 'approximate' : 'exact',
                    confidence: clamp(search.matchConfidence ?? workingInterpretation.confidence ?? 0, 0, 0.99),
                },
            },
            followUps: buildFollowUps({
                intent: 'product_search',
                products,
                categoryLabel: safeString(search.category || categoryLabel),
                inferred,
            }),
            sessionMemory: buildSessionMemory({
                current: sessionMemory,
                assistantTurn: {
                    ...workingInterpretation,
                    entities: {
                        ...workingInterpretation.entities,
                        query: structuredQuery,
                        category: safeString(search.category || categoryLabel),
                    priceMin: Math.max(0, Number(search.minPrice || workingInterpretation.entities?.priceMin || 0)),
                        maxPrice: Math.max(0, Number(search.maxPrice || workingInterpretation.entities?.maxPrice || 0)),
                        limit: requestedLimit,
                    },
                },
            products,
                activeProduct: products.length === 1 ? products[0] : null,
                clarificationState: {},
            }),
            policy,
            decisionTrace,
        }), policy, decisionTrace);

        return {
            answer: assistantTurn.response,
            assistantTurn,
            products,
            followUps: assistantTurn.followUps,
            provider,
        };
    }

    if (workingInterpretation.intent === 'cart_action') {
        const productId = safeString(workingInterpretation.entities?.productId || '');
        const operation = safeString(workingInterpretation.meta?.operation || 'add');
        if (!productId) {
            const clarification = buildClarificationPayload({
                message,
                interpretation: workingInterpretation,
                sessionMemory,
            });
            const fingerprint = buildClarificationFingerprint({
                message,
                intent: 'cart_action',
                response: clarification.response,
                followUps: clarification.followUps,
            });
            const nextClarificationState = buildNextClarificationState({
                current: sessionMemory?.clarificationState || {},
                fingerprint,
                question: clarification.response,
            });

            if (nextClarificationState.count > MAX_CLARIFICATION_REPEATS) {
                const forcedInterpretation = forceInferenceFromContext({
                    message,
                    interpretation: workingInterpretation,
                    sessionMemory,
                });

                if (forcedInterpretation) {
                    workingInterpretation = forcedInterpretation;
                    policy = evaluateExecutionPolicy({
                        intentResolution: workingInterpretation,
                        clarificationAttempts: nextClarificationState.count,
                    });
                    decisionTrace = buildDecisionTrace({
                        input: message,
                        interpretation: workingInterpretation,
                        policy,
                        fallbackUsed: true,
                    });
                } else {
                    const escalatedClarification = escalateClarificationPayload(clarification);
                    const assistantTurn = applyDecisionMetadata(createAssistantTurn({
                        intent: 'cart_action',
                        entities: workingInterpretation.entities,
                        confidence: workingInterpretation.confidence,
                        decision: 'clarify',
                        response: escalatedClarification.response,
                        ui: escalatedClarification.ui,
                        followUps: escalatedClarification.followUps,
                        sessionMemory: buildSessionMemory({
                            current: sessionMemory,
                            assistantTurn: workingInterpretation,
                            clarificationState: buildNextClarificationState({
                                current: sessionMemory?.clarificationState || {},
                                fingerprint: buildClarificationFingerprint({
                                    message,
                                    intent: 'cart_action',
                                    response: escalatedClarification.response,
                                    followUps: escalatedClarification.followUps,
                                }),
                                question: escalatedClarification.response,
                            }),
                        }),
                        policy,
                        decisionTrace,
                    }), policy, decisionTrace);

                    return {
                        answer: assistantTurn.response,
                        assistantTurn,
                        products: uniqueProducts(escalatedClarification?.ui?.products || []).slice(0, 6),
                        followUps: assistantTurn.followUps,
                        provider,
                    };
                }
            }

            if (!safeString(workingInterpretation.entities?.productId || '')) {
                const assistantTurn = applyDecisionMetadata(createAssistantTurn({
                    intent: 'cart_action',
                    entities: workingInterpretation.entities,
                    confidence: workingInterpretation.confidence,
                    decision: 'clarify',
                    response: clarification.response,
                    ui: clarification.ui,
                    followUps: clarification.followUps,
                    sessionMemory: buildSessionMemory({
                        current: sessionMemory,
                        assistantTurn: workingInterpretation,
                        clarificationState: nextClarificationState,
                    }),
                    policy,
                    decisionTrace,
                }), policy, decisionTrace);

                return {
                    answer: assistantTurn.response,
                    assistantTurn,
                    products: uniqueProducts(clarification?.ui?.products || []).slice(0, 6),
                    followUps: assistantTurn.followUps,
                    provider,
                };
            }
        }

        const resolvedProductId = safeString(workingInterpretation.entities?.productId || productId);
        const product = await getProductByIdentifier(resolvedProductId).catch(() => null);
        const action = {
            type: operation === 'remove' ? 'remove_from_cart' : 'add_to_cart',
            productId: resolvedProductId,
            quantity: Math.max(1, Number(workingInterpretation.entities?.quantity || 1)),
            reason: 'validated_cart_action',
        };
        const assistantTurn = applyDecisionMetadata(createAssistantTurn({
            intent: 'cart_action',
            entities: {
                ...workingInterpretation.entities,
                productId: resolvedProductId,
                quantity: Math.max(1, Number(workingInterpretation.entities?.quantity || 1)),
            },
            confidence: workingInterpretation.confidence,
            decision: 'act',
            response: '',
            actions: [action],
            ui: {
                surface: 'cart_summary',
                product,
                products: product ? [product] : [],
                cartSummary: context?.cartSummary || null,
            },
            followUps: buildFollowUps({
                intent: 'cart_action',
            }),
            sessionMemory: buildSessionMemory({
                current: sessionMemory,
                assistantTurn: workingInterpretation,
                activeProduct: product || sessionMemory.activeProduct,
                clarificationState: {},
            }),
            policy,
            decisionTrace,
        }), policy, decisionTrace);

        return {
            answer: assistantTurn.response,
            assistantTurn,
            products: product ? [normalizeProductSummary(product)] : [],
            followUps: assistantTurn.followUps,
            provider,
        };
    }

    if (workingInterpretation.intent === 'navigation') {
        const page = safeString(workingInterpretation.meta?.page || '');
        const params = workingInterpretation?.meta?.navigationParams && typeof workingInterpretation.meta.navigationParams === 'object'
            ? { ...workingInterpretation.meta.navigationParams }
            : {};
        const inferred = band === 'infer';
        const categoryLabel = safeString(workingInterpretation.entities?.category || workingInterpretation.meta?.categoryLabel || '');

        if (page === 'product') {
            const productId = safeString(workingInterpretation.entities?.productId || '');
            if (!productId) {
                const clarification = buildClarificationPayload({
                    message,
                    interpretation: workingInterpretation,
                    sessionMemory,
                });
                const fingerprint = buildClarificationFingerprint({
                    message,
                    intent: 'navigation',
                    response: clarification.response,
                    followUps: clarification.followUps,
                });
                const nextClarificationState = buildNextClarificationState({
                    current: sessionMemory?.clarificationState || {},
                    fingerprint,
                    question: clarification.response,
                });

                if (nextClarificationState.count > MAX_CLARIFICATION_REPEATS) {
                    const forcedInterpretation = forceInferenceFromContext({
                        message,
                        interpretation: workingInterpretation,
                        sessionMemory,
                    });

                    if (forcedInterpretation) {
                        workingInterpretation = forcedInterpretation;
                        policy = evaluateExecutionPolicy({
                            intentResolution: workingInterpretation,
                            clarificationAttempts: nextClarificationState.count,
                        });
                        decisionTrace = buildDecisionTrace({
                            input: message,
                            interpretation: workingInterpretation,
                            policy,
                            fallbackUsed: true,
                        });
                    } else {
                        const escalatedClarification = escalateClarificationPayload(clarification);
                        const assistantTurn = applyDecisionMetadata(createAssistantTurn({
                            intent: 'navigation',
                            entities: workingInterpretation.entities,
                            confidence: workingInterpretation.confidence,
                            decision: 'clarify',
                            response: escalatedClarification.response,
                            ui: escalatedClarification.ui,
                            followUps: escalatedClarification.followUps,
                            sessionMemory: buildSessionMemory({
                                current: sessionMemory,
                                assistantTurn: workingInterpretation,
                                clarificationState: buildNextClarificationState({
                                    current: sessionMemory?.clarificationState || {},
                                    fingerprint: buildClarificationFingerprint({
                                        message,
                                        intent: 'navigation',
                                        response: escalatedClarification.response,
                                        followUps: escalatedClarification.followUps,
                                    }),
                                    question: escalatedClarification.response,
                                }),
                            }),
                            policy,
                            decisionTrace,
                        }), policy, decisionTrace);

                        return {
                            answer: assistantTurn.response,
                            assistantTurn,
                            products: uniqueProducts(escalatedClarification?.ui?.products || []).slice(0, 6),
                            followUps: assistantTurn.followUps,
                            provider,
                        };
                    }
                }

                if (!safeString(workingInterpretation.entities?.productId || '')) {
                    const assistantTurn = applyDecisionMetadata(createAssistantTurn({
                        intent: 'navigation',
                        entities: workingInterpretation.entities,
                        confidence: workingInterpretation.confidence,
                        decision: 'clarify',
                        response: clarification.response,
                        ui: clarification.ui,
                        followUps: clarification.followUps,
                        sessionMemory: buildSessionMemory({
                            current: sessionMemory,
                            assistantTurn: workingInterpretation,
                            clarificationState: nextClarificationState,
                        }),
                        policy,
                        decisionTrace,
                    }), policy, decisionTrace);

                    return {
                        answer: assistantTurn.response,
                        assistantTurn,
                        products: uniqueProducts(clarification?.ui?.products || []).slice(0, 6),
                        followUps: assistantTurn.followUps,
                        provider,
                    };
                }
            }

            params.productId = safeString(workingInterpretation.entities?.productId || productId);
        }

        if (page === 'category') {
            const categorySlug = safeString(workingInterpretation.meta?.categorySlug || toCategorySlug(categoryLabel));
            const navigation = buildNavigationDescriptor('category', {
                ...params,
                category: categorySlug,
            });
            const action = {
                type: 'navigate_to',
                page: 'category',
                params: navigation.params,
                reason: 'validated_category_navigation',
            };
        const assistantTurn = applyDecisionMetadata(createAssistantTurn({
            intent: 'navigation',
            entities: workingInterpretation.entities,
            confidence: workingInterpretation.confidence,
            decision: 'act',
            response: buildNavigationResponse('category', navigation.params),
            actions: [action],
            ui: {
                surface: 'navigation_notice',
                navigation: {
                    page: 'category',
                        path: navigation.path,
                        params: navigation.params,
                    },
                },
                followUps: buildFollowUps({
                    intent: 'navigation',
                    categoryLabel,
                    inferred,
                }),
                sessionMemory: buildSessionMemory({
                    current: sessionMemory,
                    assistantTurn: workingInterpretation,
                    clarificationState: {},
                }),
                policy,
                decisionTrace,
            }), policy, decisionTrace);

            return {
                answer: assistantTurn.response,
                assistantTurn,
                products: [],
                followUps: assistantTurn.followUps,
                provider,
            };
        }

        if (page === 'checkout') {
            const confirmationAction = {
                type: 'navigate_to',
                page: 'checkout',
                params: {},
                requiresConfirmation: true,
                reason: 'checkout_navigation_confirmation',
            };
            const assistantTurn = applyDecisionMetadata(createAssistantTurn({
                intent: 'navigation',
                entities: workingInterpretation.entities,
                confidence: workingInterpretation.confidence,
                decision: 'clarify',
                response: 'Checkout affects payment and order placement. Should I open checkout?',
                actions: [],
                ui: {
                    surface: 'confirmation_card',
                    confirmation: {
                        token: `checkout-${Date.now().toString(36)}`,
                        message: 'Checkout affects payment and order placement. Confirm before continuing.',
                        action: confirmationAction,
                    },
                },
                followUps: buildFollowUps({
                    intent: 'navigation',
                    actionType: 'checkout',
                }),
                sessionMemory: buildSessionMemory({
                    current: sessionMemory,
                    assistantTurn: workingInterpretation,
                    clarificationState: {},
                }),
                policy,
                decisionTrace,
            }), policy, decisionTrace);

            return {
                answer: assistantTurn.response,
                assistantTurn,
                products: [],
                followUps: assistantTurn.followUps,
                provider,
            };
        }

        const navigation = buildNavigationDescriptor(page, params);
        const action = {
            type: 'navigate_to',
            page,
            params: navigation.params,
            reason: 'validated_navigation',
        };
        const assistantTurn = applyDecisionMetadata(createAssistantTurn({
            intent: 'navigation',
            entities: workingInterpretation.entities,
            confidence: workingInterpretation.confidence,
            decision: 'act',
            response: buildNavigationResponse(page, navigation.params),
            actions: [action],
            ui: {
                surface: page === 'cart' ? 'cart_summary' : 'navigation_notice',
                navigation: {
                    page,
                    path: navigation.path,
                    params: navigation.params,
                },
                cartSummary: page === 'cart' ? context?.cartSummary || null : null,
            },
            followUps: buildFollowUps({
                intent: 'navigation',
                categoryLabel,
                inferred,
            }),
            sessionMemory: buildSessionMemory({
                current: sessionMemory,
                assistantTurn: workingInterpretation,
                clarificationState: {},
            }),
            policy,
            decisionTrace,
        }), policy, decisionTrace);

        return {
            answer: assistantTurn.response,
            assistantTurn,
            products: [],
            followUps: [],
            provider,
        };
    }

    if (workingInterpretation.intent === 'support') {
        const orderId = safeString(workingInterpretation.meta?.orderId || '');
        const prefill = buildSupportPrefill({
            message,
            orderId,
        });
        const page = safeString(workingInterpretation.meta?.page || (orderId ? 'orders' : 'support'));
        const params = orderId
            ? {
                focus: orderId,
                support: 1,
                category: prefill.category,
                subject: prefill.subject,
                intent: prefill.body,
            }
            : {
                tab: 'support',
                compose: 1,
                category: prefill.category,
                subject: prefill.subject,
                intent: prefill.body,
            };
        const action = {
            type: 'navigate_to',
            page,
            params,
            reason: 'validated_support_handoff',
        };
        const assistantTurn = applyDecisionMetadata(createAssistantTurn({
            intent: 'support',
            entities: workingInterpretation.entities,
            confidence: workingInterpretation.confidence,
            decision: 'act',
            response: '',
            actions: [action],
            ui: {
                surface: 'support_handoff',
                support: {
                    orderId,
                    prefill,
                },
                navigation: {
                    page,
                    path: page === 'orders' ? '/orders' : '/profile?tab=support',
                    params,
                },
            },
            followUps: buildFollowUps({
                intent: 'support',
                hasMoreContext: Boolean(orderId),
            }),
            sessionMemory: buildSessionMemory({
                current: sessionMemory,
                assistantTurn: workingInterpretation,
                clarificationState: {},
            }),
            policy,
            decisionTrace,
        }), policy, decisionTrace);

        return {
            answer: assistantTurn.response,
            assistantTurn,
            products: [],
            followUps: assistantTurn.followUps,
            provider,
        };
    }

    const assistantTurn = applyDecisionMetadata(createAssistantTurn({
        intent: 'unclear',
        entities: workingInterpretation.entities,
        confidence: workingInterpretation.confidence,
        decision: 'clarify',
        response: 'Can you clarify what you want?',
        ui: {
            surface: 'plain_answer',
        },
        sessionMemory: buildSessionMemory({
            current: sessionMemory,
            assistantTurn: workingInterpretation,
            clarificationState: normalizeClarificationState(sessionMemory?.clarificationState || {}),
        }),
        policy,
        decisionTrace,
    }), policy, decisionTrace);

    return {
        answer: assistantTurn.response,
        assistantTurn,
        products: [],
        followUps: [],
        provider,
    };
};

const buildInterpretationFromPendingAction = (pendingAction = {}) => {
    const action = pendingAction?.action && typeof pendingAction.action === 'object'
        ? pendingAction.action
        : {};
    const type = safeString(action?.type || '');
    const entities = {
        query: safeString(pendingAction?.entities?.query || action?.query || ''),
        productId: safeString(pendingAction?.entities?.productId || action?.productId || action?.params?.productId || ''),
        category: safeString(pendingAction?.entities?.category || action?.filters?.category || action?.params?.category || ''),
        priceMin: Math.max(0, Number(pendingAction?.entities?.priceMin || action?.filters?.priceMin || 0)),
        maxPrice: Math.max(0, Number(pendingAction?.entities?.maxPrice || action?.filters?.maxPrice || 0)),
        quantity: Math.max(0, Number(pendingAction?.entities?.quantity || action?.quantity || 0)),
        limit: Math.max(0, Number(pendingAction?.entities?.limit || action?.limit || 0)),
    };

    if (type === 'search_products') {
        return {
            intent: 'product_search',
            confidence: 1,
            entities,
            meta: {
                categoryLabel: entities.category,
                categorySlug: toCategorySlug(entities.category),
                showMore: false,
            },
            provider: 'local',
        };
    }

    if (type === 'add_to_cart' || type === 'remove_from_cart') {
        return {
            intent: 'cart_action',
            confidence: 1,
            entities,
            meta: {
                operation: type === 'remove_from_cart' ? 'remove' : 'add',
            },
            provider: 'local',
        };
    }

    if (type === 'navigate_to') {
        const page = safeString(action?.page || '');
        return {
            intent: page === 'support' ? 'support' : 'navigation',
            confidence: 1,
            entities,
            meta: {
                page,
                categoryLabel: entities.category,
                categorySlug: toCategorySlug(entities.category),
            },
            provider: 'local',
        };
    }

    return {
        intent: safeString(pendingAction?.intent || 'unclear'),
        confidence: 1,
        entities,
        meta: {},
        provider: 'local',
    };
};

const processPendingAssistantConfirmation = async ({
    confirmation = {},
    context = {},
    sessionMemory = {},
    pendingAction = null,
}) => {
    const normalizedPendingAction = pendingAction && typeof pendingAction === 'object'
        ? pendingAction
        : null;
    const approved = Boolean(confirmation?.approved);

    if (!normalizedPendingAction?.action) {
        const assistantTurn = createAssistantTurn({
            intent: 'unclear',
            entities: {},
            confidence: 0,
            decision: 'clarify',
            response: 'That action needs a fresh confirmation.',
            ui: {
                surface: 'plain_answer',
            },
            followUps: ['Modify request'],
            sessionMemory: buildSessionMemory({
                current: sessionMemory,
                assistantTurn: {
                    intent: safeString(sessionMemory?.lastIntent || 'unclear'),
                },
                clarificationState: normalizeClarificationState(sessionMemory?.clarificationState || {}),
            }),
        });

        return {
            answer: assistantTurn.response,
            assistantTurn,
            products: [],
            followUps: assistantTurn.followUps,
            provider: 'local',
        };
    }

    if (!approved) {
        const assistantTurn = applyDecisionMetadata(createAssistantTurn({
            intent: safeString(normalizedPendingAction.intent || 'unclear'),
            entities: normalizedPendingAction.entities || {},
            confidence: 1,
            decision: 'respond',
            response: 'Okay, I will hold here.',
            ui: {
                surface: 'plain_answer',
            },
            followUps: ['Modify request'],
            sessionMemory: buildSessionMemory({
                current: sessionMemory,
                assistantTurn: {
                    intent: safeString(normalizedPendingAction.intent || sessionMemory?.lastIntent || ''),
                    entities: normalizedPendingAction.entities || {},
                },
                clarificationState: {},
            }),
            policy: {
                actionType: safeString(normalizedPendingAction.actionType || ''),
                risk: safeString(normalizedPendingAction.risk || ''),
                decision: 'REJECT',
                reason: 'user_cancelled_confirmation',
                confidence: 1,
            },
            decisionTrace: {
                input: safeString(context?.confirmationInput || ''),
                resolvedIntent: safeString(normalizedPendingAction.intent || ''),
                confidence: 1,
                risk: safeString(normalizedPendingAction.risk || ''),
                decision: 'REJECT',
                fallbackUsed: false,
                actionType: safeString(normalizedPendingAction.actionType || ''),
            },
        }), {
            actionType: safeString(normalizedPendingAction.actionType || ''),
            risk: safeString(normalizedPendingAction.risk || ''),
            decision: 'REJECT',
            reason: 'user_cancelled_confirmation',
            confidence: 1,
        }, {
            input: safeString(context?.confirmationInput || ''),
            resolvedIntent: safeString(normalizedPendingAction.intent || ''),
            confidence: 1,
            risk: safeString(normalizedPendingAction.risk || ''),
            decision: 'REJECT',
            actionType: safeString(normalizedPendingAction.actionType || ''),
            fallbackUsed: false,
        });

        return {
            answer: assistantTurn.response,
            assistantTurn,
            products: [],
            followUps: assistantTurn.followUps,
            provider: 'local',
        };
    }

    return executeDecision({
        message: safeString(context?.confirmationInput || normalizedPendingAction.message || ''),
        interpretation: buildInterpretationFromPendingAction(normalizedPendingAction),
        context,
        sessionMemory,
        policyOverrideDecision: 'EXECUTE',
        policyReasonOverride: 'confirmed_by_user',
    });
};

const buildLegacyShape = ({ answer = '', products = [], followUps = [], provider = 'local', mode = 'chat', assistantTurn = {} }) => ({
    text: safeString(answer),
    products: uniqueProducts(products).slice(0, clamp(assistantTurn?.entities?.limit || 6, 1, MAX_COMPILED_RESULTS)),
    suggestions: Array.isArray(followUps) ? followUps.slice(0, 4) : [],
    actionType: safeString(assistantTurn?.intent || 'assistant'),
    isAI: provider !== 'local',
    provider,
    mode,
});

const buildRecoveryEnvelope = ({
    executed = {},
    interpretation = {},
    assistantMode = 'chat',
    sessionMemory = {},
} = {}) => ({
    answer: safeString(executed.answer || executed.assistantTurn?.response || ''),
    products: uniqueProducts(executed.products || []).slice(0, clamp(executed.assistantTurn?.entities?.limit || 6, 1, MAX_COMPILED_RESULTS)),
    actions: Array.isArray(executed.assistantTurn?.actions) ? executed.assistantTurn.actions : [],
    followUps: Array.isArray(executed.followUps) ? executed.followUps : [],
    assistantTurn: executed.assistantTurn,
    provider: safeString(executed.provider || interpretation.provider || 'local'),
    grounding: {
        mode: safeString(assistantMode || 'chat'),
        actionType: safeString(executed.assistantTurn?.intent || interpretation.intent || 'assistant'),
        sessionMemory: executed.assistantTurn?.sessionMemory || sessionMemory,
    },
    sessionMemory: executed.assistantTurn?.sessionMemory || sessionMemory,
    legacy: buildLegacyShape({
        answer: safeString(executed.answer || executed.assistantTurn?.response || ''),
        products: executed.products || [],
        followUps: executed.followUps || [],
        provider: safeString(executed.provider || interpretation.provider || 'local'),
        mode: safeString(assistantMode || 'chat'),
        assistantTurn: executed.assistantTurn,
    }),
});

const normalizeActionRequestType = (value = '') => safeString(value).toLowerCase().replace(/[\s-]+/g, '_');

const buildInterpretationFromActionRequest = ({
    actionRequest = {},
    sessionMemory = {},
} = {}) => {
    const requestType = normalizeActionRequestType(actionRequest?.type || '');
    const activeProductId = safeString(
        actionRequest?.productId
        || sessionMemory?.lastResolvedEntityId
        || sessionMemory?.activeProduct?.id
        || ''
    );
    const quantity = Math.max(1, Number(actionRequest?.quantity || 1));

    if (requestType === 'checkout') {
        return {
            intent: 'navigation',
            entities: {
                query: '',
                productId: '',
                quantity: 0,
                category: '',
                maxPrice: 0,
            },
            confidence: 1,
            response: '',
            provider: 'policy',
            meta: {
                page: 'checkout',
            },
        };
    }

    if (requestType === 'navigate_to') {
        return {
            intent: 'navigation',
            entities: {
                query: '',
                productId: safeString(actionRequest?.productId || ''),
                quantity: 0,
                category: safeString(actionRequest?.params?.category || ''),
                maxPrice: 0,
            },
            confidence: 1,
            response: '',
            provider: 'policy',
            meta: {
                page: safeString(actionRequest?.page || 'home'),
                categorySlug: toCategorySlug(actionRequest?.params?.category || ''),
            },
        };
    }

    if (requestType === 'add_to_cart' || requestType === 'remove_from_cart') {
        return {
            intent: 'cart_action',
            entities: {
                query: '',
                productId: activeProductId,
                quantity,
                category: '',
                maxPrice: 0,
            },
            confidence: activeProductId ? 1 : 0.35,
            response: '',
            provider: 'policy',
            meta: {
                operation: requestType === 'remove_from_cart' ? 'remove' : 'add',
            },
        };
    }

    return {
        intent: 'unclear',
        entities: {
            query: '',
            productId: '',
            quantity: 0,
            category: '',
            maxPrice: 0,
        },
        confidence: 0,
        response: '',
        provider: 'policy',
        meta: {},
    };
};

const processExplicitAssistantAction = async ({
    actionRequest = {},
    assistantMode = 'chat',
    context = {},
} = {}) => {
    const sessionMemory = resolveSessionMemory(context);
    const interpretation = buildInterpretationFromActionRequest({
        actionRequest,
        sessionMemory,
    });
    const message = safeString(actionRequest?.type || actionRequest?.page || 'assistant action');
    const executed = await executeDecision({
        message,
        interpretation,
        context,
        sessionMemory,
    });

    return buildRecoveryEnvelope({
        executed,
        interpretation,
        assistantMode,
        sessionMemory,
    });
};

const processRecoveredAssistantTurn = async ({
    user = null,
    message = '',
    conversationHistory = [],
    assistantMode = 'chat',
    context = {},
}) => {
    const sessionMemory = resolveSessionMemory(context);
    const deterministic = buildDeterministicInterpretation({
        message,
        context,
        sessionMemory,
    });

    let interpretation = deterministic;
    let provider = safeString(deterministic.provider || 'local');

    if (shouldUseModel(deterministic, message)) {
        const model = await interpretWithModel({
            message,
            sessionMemory,
            deterministic,
            context,
            conversationHistory,
        });
        interpretation = mergeInterpretations(deterministic, model.interpretation);
        provider = safeString(
            interpretation === deterministic
                ? deterministic.provider || 'local'
                : model.provider || deterministic.provider || 'local'
        );
    }

    interpretation = {
        ...interpretation,
        meta: mergeInterpretationMeta(deterministic.meta, interpretation.meta),
        provider: provider === 'local' ? safeString(deterministic.provider || 'local') : provider,
    };

    const executed = await executeDecision({
        message,
        interpretation,
        context,
        sessionMemory,
        conversationHistory,
        user,
        assistantMode,
    });

    return buildRecoveryEnvelope({
        executed,
        interpretation,
        assistantMode,
        sessionMemory,
    });
};

module.exports = {
    buildDeterministicInterpretation,
    processExplicitAssistantAction,
    processPendingAssistantConfirmation,
    processRecoveredAssistantTurn,
    resolveSessionMemory,
};
