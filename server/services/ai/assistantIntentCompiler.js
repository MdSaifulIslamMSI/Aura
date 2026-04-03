const { resolveCategory } = require('../../config/categories');

const FILLER_WORDS = new Set([
    'a',
    'an',
    'for',
    'give',
    'just',
    'me',
    'please',
    'product',
    'products',
    'result',
    'results',
    'show',
    'some',
    'then',
    'want',
]);

const QUERY_NOISE = new Set([
    ...FILLER_WORDS,
    'add',
    'all',
    'and',
    'bag',
    'basket',
    'below',
    'browse',
    'budget',
    'buy',
    'cancel',
    'cart',
    'compare',
    'confirm',
    'details',
    'find',
    'go',
    'item',
    'items',
    'look',
    'looking',
    'navigate',
    'now',
    'ok',
    'okay',
    'open',
    'over',
    'price',
    'products',
    'put',
    'remove',
    'search',
    'than',
    'this',
    'to',
    'under',
    'view',
]);

const CATEGORY_DEFINITIONS = [
    {
        canonical: 'electronics',
        catalog: 'Electronics',
        aliases: ['electronics', 'electronic', 'gadget', 'gadgets'],
    },
    {
        canonical: 'phones',
        catalog: 'Mobiles',
        aliases: ['phone', 'phones', 'mobile', 'mobiles', 'smartphone', 'smartphones'],
    },
    {
        canonical: 'laptops',
        catalog: 'Laptops',
        aliases: ['laptop', 'laptops', 'macbook', 'macbooks', 'notebook', 'notebooks'],
    },
    {
        canonical: 'kitchen',
        catalog: 'Home & Kitchen',
        aliases: ['kitchen', 'home kitchen', 'home-kitchen', 'cookware', 'kitchenware'],
    },
    {
        canonical: 'fashion',
        catalog: 'fashion',
        aliases: ['fashion', 'clothes', 'clothing', 'apparel', 'outfit', 'outfits', 'wear'],
    },
];

const PAGE_TARGETS = [
    { target: 'home', aliases: ['home', 'homepage'] },
    { target: 'cart', aliases: ['cart', 'bag', 'basket'] },
    { target: 'checkout', aliases: ['checkout', 'payment', 'pay now', 'place order'] },
    { target: 'orders', aliases: ['orders', 'my orders', 'order history'] },
    { target: 'profile', aliases: ['profile', 'account'] },
    { target: 'wishlist', aliases: ['wishlist', 'favorites', 'favourites'] },
    { target: 'support', aliases: ['support', 'help center', 'help desk', 'customer care'] },
];

const SEARCH_CUE_PATTERN = /\b(search|find|look(?:ing)? for|browse|recommend|suggest|compare|need|show)\b/i;
const FILTER_CUE_PATTERN = /\b(under|below|less than|max|within|around|about|over|above|min|minimum|between|price|budget)\b/i;
const ADD_PATTERN = /\b(add|put|place|buy)\b/i;
const REMOVE_PATTERN = /\b(remove|delete|take out|drop)\b/i;
const NAVIGATE_PATTERN = /\b(open|go to|navigate|take me to|browse)\b/i;
const SUPPORT_PATTERN = /\b(refund|return|replace|replacement|cancel order|track|tracking|late delivery|delivery issue|damaged|defect|warranty|complaint|support|help with|issue with|problem with)\b/i;
const GENERAL_KNOWLEDGE_PATTERN = /^(?:who|what|when|where|why|how|which)\b|(?:\bmeaning of\b|\bexplain\b|\btell me about\b|\bdefine\b)/i;
const SMALL_TALK_PATTERN = /^(?:hi|hello|hey|hey there|yo|good morning|good afternoon|good evening|thanks|thank you|thx|bye|goodbye|see you|take care|how are you)\b/i;
const BARE_TOPIC_PATTERN = /^[a-z][a-z\s'.-]{2,80}$/i;
const CONFIRM_PATTERN = /^(yes|yeah|yep|ok|okay|confirm|go ahead|proceed|continue|do it)$/i;
const REJECT_PATTERN = /^(no|nope|cancel|stop|not now)$/i;
const SHOW_MORE_PATTERN = /\b(show more|more results|more options|next page|next results)\b/i;
const PRODUCT_REFERENCE_PATTERN = /\b(this|that|it|selected|current)\b/i;
const PRODUCT_HINT_PATTERN = /\b(iphone|samsung|pixel|oppo|vivo|realme|oneplus|phone|phones|laptop|laptops|tv|headphone|headphones|watch|earbuds|shoe|shoes)\b/i;

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const safeLower = (value, fallback = '') => safeString(value, fallback).toLowerCase();
const normalizeText = (value = '') => safeLower(value)
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (value = '') => normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

const toNullableNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const buildCommand = ({
    intent = 'CLARIFY',
    category = null,
    query = null,
    filters = {},
    limit = null,
    target = null,
    confidence = 0,
} = {}) => ({
    intent: safeString(intent || 'CLARIFY') || 'CLARIFY',
    category: safeString(category || '') || null,
    query: safeString(query || '') || null,
    filters: {
        priceMax: toNullableNumber(filters?.priceMax),
        priceMin: toNullableNumber(filters?.priceMin),
    },
    limit: toNullableNumber(limit),
    target: safeString(target || '') || null,
    confidence: Number.isFinite(Number(confidence))
        ? Number(Math.min(Math.max(Number(confidence), 0), 1).toFixed(2))
        : 0,
});

const parseAmount = (digits = '', hasK = '') => {
    const parsed = Number(String(digits || '').replace(/,/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return hasK ? parsed * 1000 : parsed;
};

const parseFilters = (input = '') => {
    const normalized = safeString(input);
    const betweenMatch = normalized.match(/\bbetween\s*(?:rs\.?|inr)?\s*([\d,]+)\s*(k)?\s*(?:and|to)\s*(?:rs\.?|inr)?\s*([\d,]+)\s*(k)?\b/i);
    if (betweenMatch?.[1] && betweenMatch?.[3]) {
        return {
            priceMin: parseAmount(betweenMatch[1], betweenMatch[2]) || null,
            priceMax: parseAmount(betweenMatch[3], betweenMatch[4]) || null,
        };
    }

    const minMatch = normalized.match(/\b(?:above|over|min|minimum|from)\s*(?:rs\.?|inr)?\s*([\d,]+)\s*(k)?\b/i);
    const maxMatch = normalized.match(/\b(?:under|below|less than|max|within|around|about)\s*(?:rs\.?|inr)?\s*([\d,]+)\s*(k)?\b/i);
    const standaloneMax = normalized.match(/\b([\d,]+)\s*(k)?\s*(?:price|budget)\b/i);

    return {
        priceMin: minMatch?.[1] ? parseAmount(minMatch[1], minMatch[2]) || null : null,
        priceMax: maxMatch?.[1]
            ? parseAmount(maxMatch[1], maxMatch[2]) || null
            : standaloneMax?.[1]
                ? parseAmount(standaloneMax[1], standaloneMax[2]) || null
                : null,
    };
};

const stripPricePhrases = (value = '') => safeString(value)
    .replace(/\bbetween\s*(?:rs\.?|inr)?\s*[\d,]+\s*k?\s*(?:and|to)\s*(?:rs\.?|inr)?\s*[\d,]+\s*k?\b/ig, ' ')
    .replace(/\b(?:under|below|less than|max|within|around|about|above|over|min|minimum|from)\s*(?:rs\.?|inr)?\s*[\d,]+\s*k?\b/ig, ' ')
    .replace(/\b(?:rs\.?|inr)\s*[\d,]+\s*k?\b/ig, ' ')
    .replace(/\b[\d,]+\s*k?\s*(?:price|budget)\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const stripLimitPhrases = (value = '') => safeString(value)
    .replace(/\b\d+\s+(?:[a-z-]+\s+){0,2}(?:products?|items?|results?)\b/ig, ' ')
    .replace(/\b\d+\s+(?:products?|items?|results?)\b/ig, ' ')
    .replace(/\b(?:show|give|find|search)\s+\d+\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const parseLimit = (input = '') => {
    const stripped = stripPricePhrases(input);
    const directMatch = stripped.match(/\b(\d+)\s+(?:[a-z-]+\s+){0,2}(?:products?|items?|results?)\b/i)
        || stripped.match(/\b(\d+)\s+(?:products?|items?|results?)\b/i)
        || stripped.match(/\b(?:show|give|find|search)\s+(\d+)\b/i);
    const parsed = Number(directMatch?.[1] || 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const dedupeTokens = (tokens = []) => {
    const seen = new Set();
    const ordered = [];

    (Array.isArray(tokens) ? tokens : []).forEach((token) => {
        const normalized = safeLower(token);
        if (!normalized) return;
        const singular = normalized.length > 3 ? normalized.replace(/s$/, '') : normalized;
        if (seen.has(singular)) return;
        seen.add(singular);
        ordered.push(normalized);
    });

    return ordered;
};

const findCategoryDefinition = (value = '') => {
    const normalized = normalizeText(value);
    if (!normalized) return null;

    return CATEGORY_DEFINITIONS
        .slice()
        .sort((left, right) => {
            const leftLongest = Math.max(...left.aliases.map((alias) => alias.length));
            const rightLongest = Math.max(...right.aliases.map((alias) => alias.length));
            return rightLongest - leftLongest;
        })
        .find((definition) => definition.aliases.some((alias) => new RegExp(`(^|\\b)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|$)`, 'i').test(normalized)))
        || null;
};

const detectCategory = (value = '') => findCategoryDefinition(value)?.canonical || null;

const catalogCategoryToCompilerCategory = (value = '') => {
    const resolved = resolveCategory(value) || safeString(value);
    if (!resolved) return null;

    const normalized = safeLower(resolved);
    if (normalized === 'mobiles') return 'phones';
    if (normalized === 'electronics') return 'electronics';
    if (normalized === 'laptops') return 'laptops';
    if (normalized === 'home & kitchen') return 'kitchen';
    if (["men's fashion", "women's fashion", 'footwear', 'fashion'].includes(normalized)) return 'fashion';

    return detectCategory(resolved);
};

const compilerCategoryToCatalogCategory = (value = '') => {
    const normalized = safeLower(value);
    const definition = CATEGORY_DEFINITIONS.find((entry) => entry.canonical === normalized);
    return safeString(definition?.catalog || resolveCategory(value) || value);
};

const removeCategoryAliases = (text = '', category = '') => {
    const definition = CATEGORY_DEFINITIONS.find((entry) => entry.canonical === safeLower(category));
    if (!definition) return safeString(text);

    return definition.aliases.reduce((acc, alias) => (
        acc.replace(new RegExp(`(^|\\b)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|$)`, 'ig'), ' ')
    ), safeString(text)).replace(/\s+/g, ' ').trim();
};

const buildKeywordQuery = ({
    input = '',
    category = null,
} = {}) => {
    const withoutPrice = stripPricePhrases(input);
    const withoutLimit = stripLimitPhrases(withoutPrice);
    const withoutCategory = removeCategoryAliases(withoutLimit, category);
    const tokens = dedupeTokens(tokenize(withoutCategory).filter((token) => !QUERY_NOISE.has(token)));

    if (tokens.length === 0) return null;
    return tokens.join(' ');
};

const extractPageTarget = (value = '') => {
    const normalized = normalizeText(value);
    return PAGE_TARGETS.find((entry) => entry.aliases.some((alias) => normalized.includes(alias)))?.target || null;
};

const resolvePendingActionId = ({ context = {}, assistantSession = {} } = {}) => safeString(
    assistantSession?.pendingAction?.actionId
    || context?.assistantSession?.pendingAction?.actionId
    || ''
);

const resolveLastResolvedEntityId = ({ context = {}, sessionMemory = {}, assistantSession = {} } = {}) => safeString(
    assistantSession?.lastResolvedEntityId
    || context?.assistantSession?.lastResolvedEntityId
    || sessionMemory?.activeProduct?.id
    || context?.currentProductId
    || ''
);

const resolveContextSearch = ({ sessionMemory = {}, assistantSession = {} } = {}) => {
    const lastEntities = assistantSession?.lastEntities && typeof assistantSession.lastEntities === 'object'
        ? assistantSession.lastEntities
        : {};
    const category = catalogCategoryToCompilerCategory(lastEntities.category || '')
        || catalogCategoryToCompilerCategory(sessionMemory?.activeProduct?.category || '')
        || detectCategory(sessionMemory?.lastQuery || '')
        || null;
    const query = buildKeywordQuery({
        input: safeString(lastEntities.query || sessionMemory?.lastQuery || ''),
        category,
    });

    return {
        category,
        query,
        filters: {
            priceMax: toNullableNumber(lastEntities?.maxPrice),
            priceMin: toNullableNumber(lastEntities?.priceMin),
        },
    };
};

const hasPriceFilter = (filters = {}) => Boolean(filters?.priceMax || filters?.priceMin);

const hasCommerceCue = (input = '') => (
    SEARCH_CUE_PATTERN.test(input)
    || FILTER_CUE_PATTERN.test(input)
    || NAVIGATE_PATTERN.test(input)
    || ADD_PATTERN.test(input)
    || REMOVE_PATTERN.test(input)
    || PRODUCT_HINT_PATTERN.test(input)
    || Boolean(detectCategory(input))
);

const compileIntentCommand = ({
    input = '',
    context = {},
    sessionMemory = {},
    assistantSession = {},
} = {}) => {
    const message = safeString(input);
    const normalized = normalizeText(message);
    const pendingActionId = resolvePendingActionId({ context, assistantSession });
    const lastResolvedEntityId = resolveLastResolvedEntityId({ context, sessionMemory, assistantSession });
    const contextSearch = resolveContextSearch({ sessionMemory, assistantSession });
    const category = detectCategory(message);
    const filters = parseFilters(message);
    const limit = parseLimit(message);
    const pageTarget = extractPageTarget(message);
    const keywordQuery = buildKeywordQuery({
        input: message,
        category,
    });
    const referencesCurrentItem = PRODUCT_REFERENCE_PATTERN.test(message);
    const filterOnlyFollowUp = hasPriceFilter(filters) && (
        /^(?:then|now|also|only|just)\b/i.test(normalized)
        || !keywordQuery
    );
    const showMore = SHOW_MORE_PATTERN.test(message);

    if (CONFIRM_PATTERN.test(normalized)) {
        return buildCommand({
            intent: pendingActionId ? 'CONFIRM' : 'CLARIFY',
            target: pendingActionId || null,
            confidence: pendingActionId ? 0.99 : 0.22,
        });
    }

    if (REJECT_PATTERN.test(normalized)) {
        return buildCommand({
            intent: pendingActionId ? 'REJECT' : 'CLARIFY',
            target: pendingActionId || null,
            confidence: pendingActionId ? 0.99 : 0.22,
        });
    }

    if (SUPPORT_PATTERN.test(message)) {
        return buildCommand({
            intent: 'SUPPORT',
            target: safeString(context?.activeOrderId || context?.orderId || ''),
            confidence: safeString(context?.activeOrderId || context?.orderId || '') ? 0.94 : 0.86,
        });
    }

    if (SMALL_TALK_PATTERN.test(normalized) && !hasCommerceCue(message)) {
        return buildCommand({
            intent: 'GENERAL_KNOWLEDGE',
            confidence: 0.96,
        });
    }

    if (GENERAL_KNOWLEDGE_PATTERN.test(message) && !hasCommerceCue(message)) {
        return buildCommand({
            intent: 'GENERAL_KNOWLEDGE',
            confidence: 0.88,
        });
    }

    if (
        !hasCommerceCue(message)
        && BARE_TOPIC_PATTERN.test(normalized)
        && tokenize(normalized).length <= 4
    ) {
        return buildCommand({
            intent: 'GENERAL_KNOWLEDGE',
            confidence: 0.44,
        });
    }

    if (REMOVE_PATTERN.test(message) && /\b(cart|bag|basket|this|it|item)\b/i.test(message)) {
        return buildCommand({
            intent: 'REMOVE_FROM_CART',
            category,
            query: referencesCurrentItem ? null : keywordQuery,
            target: referencesCurrentItem ? lastResolvedEntityId || null : null,
            confidence: referencesCurrentItem && lastResolvedEntityId ? 0.94 : keywordQuery ? 0.72 : 0.26,
        });
    }

    if (ADD_PATTERN.test(message)) {
        return buildCommand({
            intent: 'ADD_TO_CART',
            category,
            query: referencesCurrentItem ? null : keywordQuery,
            target: referencesCurrentItem ? lastResolvedEntityId || null : null,
            confidence: referencesCurrentItem && lastResolvedEntityId ? 0.95 : keywordQuery ? 0.74 : 0.28,
        });
    }

    if (showMore) {
        if (contextSearch.category || contextSearch.query) {
            return buildCommand({
                intent: 'SEARCH_PRODUCTS',
                category: contextSearch.category,
                query: contextSearch.query,
                filters: contextSearch.filters,
                confidence: 0.91,
            });
        }

        return buildCommand({
            intent: 'CLARIFY',
            confidence: 0.2,
        });
    }

    if (NAVIGATE_PATTERN.test(message)) {
        if (category) {
            return buildCommand({
                intent: 'NAVIGATE',
                category,
                confidence: 0.94,
            });
        }

        if (pageTarget) {
            return buildCommand({
                intent: 'NAVIGATE',
                target: pageTarget,
                confidence: 0.93,
            });
        }

        if (referencesCurrentItem && lastResolvedEntityId) {
            return buildCommand({
                intent: 'NAVIGATE',
                target: lastResolvedEntityId,
                confidence: 0.88,
            });
        }

        return buildCommand({
            intent: 'CLARIFY',
            confidence: 0.24,
        });
    }

    if (hasPriceFilter(filters)) {
        const resolvedCategory = category || contextSearch.category;
        const resolvedQuery = keywordQuery || contextSearch.query;

        if (!resolvedCategory && !resolvedQuery) {
            return buildCommand({
                intent: 'CLARIFY',
                confidence: 0.24,
            });
        }

        return buildCommand({
            intent: 'FILTER_PRODUCTS',
            category: resolvedCategory,
            query: resolvedCategory && !resolvedQuery ? null : resolvedQuery,
            filters: {
                priceMax: filters.priceMax,
                priceMin: filters.priceMin,
            },
            limit,
            confidence: filterOnlyFollowUp ? 0.9 : 0.94,
        });
    }

    if (category || SEARCH_CUE_PATTERN.test(message) || PRODUCT_HINT_PATTERN.test(message)) {
        const resolvedCategory = category;
        const resolvedQuery = resolvedCategory && !keywordQuery ? null : keywordQuery;

        if (!resolvedCategory && !resolvedQuery) {
            return buildCommand({
                intent: 'CLARIFY',
                confidence: 0.22,
            });
        }

        return buildCommand({
            intent: 'SEARCH_PRODUCTS',
            category: resolvedCategory,
            query: resolvedQuery,
            limit,
            confidence: resolvedCategory ? 0.92 : 0.84,
        });
    }

    return buildCommand({
        intent: 'CLARIFY',
        confidence: 0.18,
    });
};

module.exports = {
    catalogCategoryToCompilerCategory,
    compileIntentCommand,
    compilerCategoryToCatalogCategory,
};
