const crypto = require('crypto');
const SearchEvent = require('../models/SearchEvent');

const makeEventId = (prefix) => `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;

const normalizeText = (value) => String(value === undefined || value === null ? '' : value).trim();
const normalizeQuery = (value) => normalizeText(value).toLowerCase().replace(/\s+/g, ' ');

const hashValue = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const toStableObject = (value) => {
    if (Array.isArray(value)) {
        return value.map((entry) => toStableObject(entry));
    }
    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort((a, b) => a.localeCompare(b))
            .reduce((acc, key) => {
                const nextValue = value[key];
                if (nextValue === undefined || nextValue === null || nextValue === '') {
                    return acc;
                }
                acc[key] = toStableObject(nextValue);
                return acc;
            }, {});
    }
    return value;
};

const sanitizeFilters = (query = {}) => toStableObject({
    category: query.category,
    brand: query.brand,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    rating: query.rating,
    discount: query.discount,
    inStock: query.inStock,
    hasWarranty: query.hasWarranty,
    minReviews: query.minReviews,
    deliveryTime: query.deliveryTime,
    sort: query.sort,
});

const getRequestIp = (req) => (
    req.headers['x-forwarded-for']
        || req.ip
        || req.connection?.remoteAddress
        || ''
);

const buildIdentityHashes = (req, explicitSessionId = '') => {
    const userSeed = normalizeText(req.user?._id || req.user?.email || '');
    const sessionSeed = normalizeText(
        explicitSessionId
        || req.headers['x-session-id']
        || `${getRequestIp(req)}|${req.headers['user-agent'] || ''}`
    );

    const userHash = userSeed ? hashValue(`user:${userSeed}`) : '';
    const sessionHash = sessionSeed ? hashValue(`session:${sessionSeed}`) : '';
    const actorHash = userHash || sessionHash || hashValue(`anon:${req.requestId || Date.now()}`);

    return {
        actorHash,
        userHash,
        sessionHash,
    };
};

const extractProductId = (product = {}) => normalizeText(product?._id || product?.id || product?.externalId || '');

const recordSearchResults = async ({
    req,
    query = {},
    products = [],
    sourceContext = 'catalog_listing',
}) => {
    const eventId = makeEventId('srch');
    const keyword = normalizeText(query.keyword || query.q || '');
    const filters = sanitizeFilters(query);
    const resultIds = (Array.isArray(products) ? products : [])
        .map((product) => extractProductId(product))
        .filter(Boolean);

    const identity = buildIdentityHashes(req);
    const doc = await SearchEvent.create({
        eventId,
        eventType: 'search_results',
        searchEventId: eventId,
        requestId: normalizeText(req.requestId),
        queryText: keyword,
        normalizedQuery: normalizeQuery(keyword),
        filters,
        resultIds,
        resultCount: resultIds.length,
        zeroResult: resultIds.length === 0,
        sourceContext: normalizeText(sourceContext),
        ...identity,
    });

    return doc.toObject();
};

const recordSearchClick = async ({
    req,
    searchEventId = '',
    productId = '',
    position = 0,
    sourceContext = '',
    queryText = '',
    filters = {},
}) => {
    const normalizedProductId = normalizeText(productId);
    if (!normalizedProductId) {
        throw new Error('productId is required');
    }

    const identity = buildIdentityHashes(req);
    const doc = await SearchEvent.create({
        eventId: makeEventId('sclk'),
        eventType: 'search_click',
        searchEventId: normalizeText(searchEventId),
        requestId: normalizeText(req.requestId),
        queryText: normalizeText(queryText),
        normalizedQuery: normalizeQuery(queryText),
        filters: toStableObject(filters || {}),
        clickedProductId: normalizedProductId,
        clickedPosition: Number.isFinite(Number(position)) ? Math.max(0, Number(position)) : 0,
        sourceContext: normalizeText(sourceContext || 'catalog_click'),
        ...identity,
    });

    return doc.toObject();
};

const buildSearchTelemetrySummary = async ({ windowHours = 24 } = {}) => {
    const since = new Date(Date.now() - (Math.max(1, Number(windowHours) || 24) * 60 * 60 * 1000));

    const [searches, clicks, topQueries] = await Promise.all([
        SearchEvent.countDocuments({
            eventType: 'search_results',
            createdAt: { $gte: since },
        }),
        SearchEvent.countDocuments({
            eventType: 'search_click',
            createdAt: { $gte: since },
        }),
        SearchEvent.aggregate([
            {
                $match: {
                    eventType: 'search_results',
                    createdAt: { $gte: since },
                    normalizedQuery: { $ne: '' },
                },
            },
            {
                $group: {
                    _id: '$normalizedQuery',
                    count: { $sum: 1 },
                    zeroResults: { $sum: { $cond: ['$zeroResult', 1, 0] } },
                },
            },
            { $sort: { count: -1 } },
            { $limit: 10 },
        ]),
    ]);

    return {
        windowHours: Math.max(1, Number(windowHours) || 24),
        totalSearches: searches,
        totalClicks: clicks,
        clickThroughRate: searches > 0 ? Number((clicks / searches).toFixed(3)) : 0,
        topQueries: (topQueries || []).map((entry) => ({
            query: entry._id,
            count: Number(entry.count || 0),
            zeroResults: Number(entry.zeroResults || 0),
        })),
        generatedAt: new Date().toISOString(),
    };
};

module.exports = {
    recordSearchResults,
    recordSearchClick,
    buildSearchTelemetrySummary,
};
