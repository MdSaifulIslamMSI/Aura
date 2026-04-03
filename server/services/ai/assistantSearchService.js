const { resolveCategory } = require('../../config/categories');
const { queryProducts } = require('../catalogService');

const DEFAULT_LIMIT = 6;
const MAX_RETURN_LIMIT = 30;
const MAX_CANDIDATES = 60;

const CATEGORY_HINTS = [
    { aliases: ['iphone', 'phone', 'smartphone', 'mobile', 'mobiles', 'android', 'pixel', 'oneplus', 'samsung', 'oppo', 'vivo', 'realme'], category: 'Mobiles' },
    { aliases: ['laptop', 'macbook', 'notebook', 'ultrabook'], category: 'Laptops' },
    { aliases: ['headphone', 'headphones', 'earbud', 'earbuds', 'speaker', 'monitor', 'tv', 'electronics'], category: 'Electronics' },
    { aliases: ['gaming', 'console', 'controller', 'mouse', 'keyboard'], category: 'Gaming & Accessories' },
    { aliases: ['book', 'books', 'novel', 'paperback', 'hardcover'], category: 'Books' },
    { aliases: ['shoe', 'shoes', 'sneaker', 'sneakers', 'footwear', 'boot', 'boots'], category: 'Footwear' },
];

const SEARCH_NOISE = new Set([
    'a',
    'amazing',
    'an',
    'any',
    'around',
    'beautiful',
    'best',
    'browse',
    'budget',
    'buy',
    'cheap',
    'cheaper',
    'compare',
    'deals',
    'details',
    'find',
    'for',
    'get',
    'good',
    'i',
    'in',
    'item',
    'items',
    'just',
    'latest',
    'look',
    'looking',
    'me',
    'need',
    'now',
    'of',
    'on',
    'only',
    'please',
    'popular',
    'pretty',
    'price',
    'product',
    'products',
    'recommend',
    'search',
    'show',
    'some',
    'something',
    'the',
    'then',
    'top',
    'under',
    'want',
    'with',
]);

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const safeLower = (value, fallback = '') => safeString(value, fallback).toLowerCase();
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);

const normalizeText = (value = '') => safeLower(value)
    .replace(/[^\w\s.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeToken = (value = '') => normalizeText(value).replace(/\./g, '');

const tokenize = (value = '') => normalizeText(value)
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const dedupeProducts = (products = []) => {
    const seen = new Set();
    return (Array.isArray(products) ? products : []).filter((product) => {
        const key = safeString(product?.id || product?._id || product?.externalId);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const parseBudgetAmount = (digits = '', hasK = '') => {
    const parsed = Number(String(digits || '').replace(/,/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return hasK ? parsed * 1000 : parsed;
};

const extractBudget = (value = '') => {
    const raw = safeString(value);
    if (!raw) return 0;

    const patterns = [
        /(?:under|below|less than|max|within|around|about|near)\s*(?:rs\.?|inr)?\s*([\d,]+)\s*(k)?\b/i,
        /(?:rs\.?|inr)\s*([\d,]+)\s*(k)?\b/i,
        /\b([\d,]+)\s*(k)\b(?:\s*(?:price|budget|range))?/i,
        /\b([\d,]+)\b\s*(?:price|budget)\b/i,
    ];

    for (const pattern of patterns) {
        const match = raw.match(pattern);
        if (!match?.[1]) continue;
        const parsed = parseBudgetAmount(match[1], match[2]);
        if (parsed > 0) return parsed;
    }

    return 0;
};

const detectCategoryHint = (value = '') => {
    const normalized = normalizeText(value);
    if (!normalized) return '';

    const resolved = resolveCategory(normalized);
    if (resolved) return resolved;

    const hint = CATEGORY_HINTS.find((entry) => entry.aliases.some((alias) => normalized.includes(alias)));
    return hint?.category || '';
};

const cleanSearchQuery = (value = '', fallback = '') => {
    const normalized = safeString(value || fallback)
        .replace(/(?:under|below|less than|max|within|around|about|near)\s*(?:rs\.?|inr)?\s*[\d,]+\s*k?\b/ig, ' ')
        .replace(/(?:rs\.?|inr)\s*[\d,]+\s*k?\b/ig, ' ')
        .replace(/\b[\d,]+\s*k\b/ig, ' ')
        .replace(/\b[\d,]+\b\s*(?:price|budget)\b/ig, ' ')
        .replace(/[^\w\s.-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!normalized) return '';

    const filtered = tokenize(normalized)
        .filter((token) => !SEARCH_NOISE.has(token))
        .join(' ')
        .trim();

    return filtered || normalized;
};

const mergeQueryTokens = (baseQuery = '', nextQuery = '') => {
    const merged = [];

    [...tokenize(baseQuery), ...tokenize(nextQuery)].forEach((token) => {
        if (!token || SEARCH_NOISE.has(token) || merged.includes(token)) return;
        merged.push(token);
    });

    return merged.join(' ').trim();
};

const mergeSearchContext = ({
    message = '',
    lastQuery = '',
    category = '',
} = {}) => {
    const resolvedCategory = resolveCategory(category) || detectCategoryHint(message) || detectCategoryHint(lastQuery);
    const normalizedMessage = normalizeText(message);
    const budget = extractBudget(message);
    const cleanedCurrent = cleanSearchQuery(message, resolvedCategory);
    const cleanedLast = safeString(lastQuery) ? cleanSearchQuery(lastQuery, resolvedCategory) : '';
    const refinementOnly = Boolean(cleanedLast) && (
        /^(?:then|now|also|only|just)\b/.test(normalizedMessage)
        || /\b(price|budget|under|below|less than|max|within|around|about|cheap|cheaper)\b/.test(normalizedMessage)
        || budget > 0
        || !cleanedCurrent
    );

    let query = cleanedCurrent;
    if (refinementOnly && cleanedLast) {
        query = cleanedCurrent ? mergeQueryTokens(cleanedLast, cleanedCurrent) : cleanedLast;
    }

    return {
        query: safeString(query || cleanedLast || cleanedCurrent || message),
        category: safeString(resolvedCategory),
        maxPrice: budget,
        refinementOnly,
        usedLastQuery: refinementOnly && !cleanedCurrent && Boolean(cleanedLast),
    };
};

const levenshteinDistance = (left = '', right = '') => {
    const a = normalizeToken(left);
    const b = normalizeToken(right);
    if (!a) return b.length;
    if (!b) return a.length;

    const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let row = 0; row <= a.length; row += 1) matrix[row][0] = row;
    for (let column = 0; column <= b.length; column += 1) matrix[0][column] = column;

    for (let row = 1; row <= a.length; row += 1) {
        for (let column = 1; column <= b.length; column += 1) {
            const cost = a[row - 1] === b[column - 1] ? 0 : 1;
            matrix[row][column] = Math.min(
                matrix[row - 1][column] + 1,
                matrix[row][column - 1] + 1,
                matrix[row - 1][column - 1] + cost
            );
        }
    }

    return matrix[a.length][b.length];
};

const tokenSimilarity = (left = '', right = '') => {
    const a = normalizeToken(left);
    const b = normalizeToken(right);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.startsWith(b) || b.startsWith(a)) {
        return clamp(Math.min(a.length, b.length) / Math.max(a.length, b.length), 0, 0.96);
    }

    const distance = levenshteinDistance(a, b);
    const base = Math.max(a.length, b.length);
    return base > 0 ? clamp(1 - (distance / base), 0, 1) : 0;
};

const scoreProductRelevance = (product = {}, options = {}) => {
    const {
        query = '',
        tokens = [],
        category = '',
        excludeIds = [],
    } = options;

    const productId = safeString(product?.id || product?._id || product?.externalId);
    if (excludeIds.includes(productId)) {
        return Number.NEGATIVE_INFINITY;
    }

    const normalizedQuery = normalizeText(query);
    const title = normalizeText(product?.title || product?.displayTitle || '');
    const brand = normalizeText(product?.brand || '');
    const productCategory = normalizeText(product?.category || '');
    const description = normalizeText(product?.description || '');
    const titleTokens = tokenize(title);
    const brandTokens = tokenize(brand);
    const categoryTokens = tokenize(productCategory);
    const descriptionTokens = tokenize(description);

    let score = 0;
    let matchedTokens = 0;

    if (normalizedQuery) {
        if (title === normalizedQuery) score += 80;
        else if (title.startsWith(normalizedQuery)) score += 56;
        else if (title.includes(normalizedQuery)) score += 34;

        if (brand === normalizedQuery) score += 28;
        if (productCategory === normalizedQuery) score += 24;
    }

    tokens.forEach((token) => {
        if (!token) return;

        const exactTitleMatch = titleTokens.includes(token);
        const exactBrandMatch = brandTokens.includes(token);
        const exactCategoryMatch = categoryTokens.includes(token);
        const exactDescriptionMatch = descriptionTokens.includes(token);

        if (exactTitleMatch) {
            score += 18;
            matchedTokens += 1;
            return;
        }

        if (exactBrandMatch) {
            score += 14;
            matchedTokens += 1;
            return;
        }

        if (exactCategoryMatch) {
            score += 12;
            matchedTokens += 1;
            return;
        }

        if (exactDescriptionMatch) {
            score += 5;
            matchedTokens += 1;
            return;
        }

        const similarity = Math.max(
            ...[...titleTokens, ...brandTokens, ...categoryTokens].map((candidate) => tokenSimilarity(token, candidate)),
            0
        );

        if (similarity >= 0.92) {
            score += 12;
            matchedTokens += 1;
        } else if (similarity >= 0.84) {
            score += 8;
            matchedTokens += 1;
        } else if (similarity >= 0.74) {
            score += 4;
        }
    });

    if (category) {
        const normalizedCategory = normalizeText(category);
        if (productCategory === normalizedCategory) {
            score += 26;
        } else if (productCategory.includes(normalizedCategory) || normalizedCategory.includes(productCategory)) {
            score += 10;
        } else {
            score -= 32;
        }
    }

    if (tokens.length > 0 && matchedTokens === 0) {
        score -= 36;
    }

    if (Number(product?.stock || 0) > 0) score += 3;
    score += Math.min(6, Math.log10(Number(product?.ratingCount || 0) + 1) * 2);
    score += Math.min(5, Number(product?.rating || 0));

    return Number(score.toFixed(2));
};

const buildQueryCandidates = (query = '', category = '') => {
    const cleanedQuery = cleanSearchQuery(query, category);
    const candidates = [
        cleanedQuery,
        safeString(query),
        category && safeLower(cleanedQuery) !== safeLower(category) ? `${category} ${cleanedQuery}` : '',
    ].filter(Boolean);

    return [...new Set(candidates)];
};

const collectCandidateProducts = async ({
    query = '',
    category = '',
    maxPrice = 0,
    minPrice = 0,
    candidateLimit = MAX_CANDIDATES,
}) => {
    const candidates = buildQueryCandidates(query, category);
    const searches = candidates.length > 0 ? candidates : [safeString(category)];

    const responses = await Promise.all(
        searches.slice(0, 3).map((keyword) => queryProducts({
            keyword,
            category,
            minPrice: minPrice || undefined,
            maxPrice: maxPrice || undefined,
            limit: candidateLimit,
            includeSponsored: false,
            sort: 'relevance',
        }))
    );

    return dedupeProducts(responses.flatMap((response) => response?.products || []));
};

const rankCandidates = ({
    candidates = [],
    query = '',
    category = '',
    excludeIds = [],
    limit = DEFAULT_LIMIT,
    threshold = 14,
}) => {
    const tokens = tokenize(query).filter((token) => !SEARCH_NOISE.has(token));

    return (Array.isArray(candidates) ? candidates : [])
        .map((product) => ({
            ...product,
            __assistantScore: scoreProductRelevance(product, {
                query,
                tokens,
                category,
                excludeIds,
            }),
        }))
        .filter((product) => Number.isFinite(product.__assistantScore))
        .filter((product) => product.__assistantScore >= threshold)
        .sort((left, right) => {
            if (right.__assistantScore !== left.__assistantScore) {
                return right.__assistantScore - left.__assistantScore;
            }
            if (Number(right.ratingCount || 0) !== Number(left.ratingCount || 0)) {
                return Number(right.ratingCount || 0) - Number(left.ratingCount || 0);
            }
            return String(right._id || '').localeCompare(String(left._id || ''));
        })
        .slice(0, clamp(limit, 1, MAX_RETURN_LIMIT))
        .map(({ __assistantScore, ...product }) => product);
};

const searchProducts = async ({
    query = '',
    category = '',
    minPrice = 0,
    maxPrice = 0,
    excludeIds = [],
    limit = DEFAULT_LIMIT,
    allowClosestMatches = true,
} = {}) => {
    const detectedCategory = resolveCategory(category) || detectCategoryHint(query);
    const cleanedQuery = cleanSearchQuery(query, detectedCategory);
    const searchQuery = cleanedQuery || safeString(query) || safeString(detectedCategory || category);
    const normalizedExcludeIds = [...new Set((Array.isArray(excludeIds) ? excludeIds : []).map((entry) => safeString(entry)).filter(Boolean))];

    if (!searchQuery && !detectedCategory) {
        return {
            products: [],
            query: '',
            category: '',
            totalCandidates: 0,
            usedClosestMatch: false,
            matchConfidence: 0,
            minPrice: Number(minPrice || 0),
            maxPrice: Number(maxPrice || 0),
        };
    }

    const candidates = await collectCandidateProducts({
        query: searchQuery,
        category: detectedCategory,
        minPrice,
        maxPrice,
        candidateLimit: Math.max(MAX_CANDIDATES, clamp(limit, 1, MAX_RETURN_LIMIT) * 3),
    });

    const strictThreshold = tokenize(searchQuery).filter((token) => !SEARCH_NOISE.has(token)).length <= 1 && detectedCategory ? 8 : 14;
    const strictResults = rankCandidates({
        candidates,
        query: searchQuery,
        category: detectedCategory,
        excludeIds: normalizedExcludeIds,
        limit,
        threshold: strictThreshold,
    });

    if (strictResults.length > 0 || !allowClosestMatches) {
        return {
            products: strictResults,
            query: searchQuery,
            category: detectedCategory,
            totalCandidates: candidates.length,
            usedClosestMatch: false,
            matchConfidence: strictResults.length > 0 ? 0.86 : 0,
            minPrice: Number(minPrice || 0),
            maxPrice: Number(maxPrice || 0),
        };
    }

    const relaxedCandidates = maxPrice > 0
        ? await collectCandidateProducts({
            query: searchQuery,
            category: detectedCategory,
            minPrice,
            maxPrice: 0,
            candidateLimit: Math.max(MAX_CANDIDATES, clamp(limit, 1, MAX_RETURN_LIMIT) * 3),
        })
        : candidates;

    const relaxedResults = rankCandidates({
        candidates: relaxedCandidates,
        query: searchQuery,
        category: detectedCategory,
        excludeIds: normalizedExcludeIds,
        limit,
        threshold: Math.max(6, strictThreshold - 6),
    });

    return {
        products: relaxedResults,
        query: searchQuery,
        category: detectedCategory,
        totalCandidates: relaxedCandidates.length,
        usedClosestMatch: relaxedResults.length > 0,
        matchConfidence: relaxedResults.length > 0 ? 0.58 : 0,
        minPrice: Number(minPrice || 0),
        maxPrice: Number(maxPrice || 0),
    };
};

module.exports = {
    cleanSearchQuery,
    detectCategoryHint,
    extractBudget,
    mergeSearchContext,
    scoreProductRelevance,
    searchProducts,
    tokenize,
};
