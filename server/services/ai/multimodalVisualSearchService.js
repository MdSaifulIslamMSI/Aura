const { queryProducts } = require('../catalogService');
const { describeVisualInput, embedTexts, cosineSimilarity, rerankDocuments } = require('./providerRegistry');

const MAX_CANDIDATES = 36;
const MAX_MATCHES = 24;

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const normalizeText = (value = '') => safeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const uniqueStrings = (items = [], limit = 12) => {
    const output = [];
    const seen = new Set();
    for (const raw of items) {
        const normalized = normalizeText(raw);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        output.push(safeString(raw));
        if (output.length >= limit) break;
    }
    return output;
};

const buildHeuristicTokens = (payload = {}) => {
    const combined = [
        payload.message,
        payload.hints,
        payload.fileName,
        payload.imageUrl,
        payload.imageMeta?.mimeType,
        payload.imageMeta?.source,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return uniqueStrings(
        combined
            .replace(/https?:\/\/[^ ]+/g, ' ')
            .replace(/[^a-z0-9 ]+/g, ' ')
            .split(/\s+/)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length >= 3)
            .filter((entry) => ![
                'image', 'images', 'photo', 'jpeg', 'jpg', 'png', 'webp',
                'http', 'https', 'com', 'cdn', 'files', 'product', 'upload',
                'clipboard', 'camera', 'screenshot',
            ].includes(entry)),
        10
    );
};

const buildCandidateQueries = ({ description, heuristicTokens }) => {
    const seeds = [
        safeString(description?.searchQuery),
        safeString(description?.caption),
        uniqueStrings(description?.keywords || [], 6).join(' '),
        uniqueStrings(heuristicTokens || [], 6).join(' '),
    ].filter(Boolean);

    const expanded = [];
    for (const seed of seeds) {
        expanded.push(seed);
        const normalized = normalizeText(seed);
        if (normalized.split(' ').length > 3) {
            expanded.push(normalized.split(' ').slice(0, 3).join(' '));
        }
    }

    return uniqueStrings(expanded, 6);
};

const mergeProducts = (groups = []) => {
    const merged = [];
    const seen = new Set();

    for (const group of groups) {
        const products = Array.isArray(group?.products) ? group.products : [];
        for (const product of products) {
            const key = safeString(product?.id || product?._id || product?.externalId);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push(product);
            if (merged.length >= MAX_CANDIDATES) {
                return merged;
            }
        }
    }

    return merged;
};

const buildProductSearchText = (product = {}) => [
    safeString(product.title),
    safeString(product.brand),
    safeString(product.category),
    safeString(product.description),
    Array.isArray(product.highlights) ? product.highlights.join(' ') : '',
].filter(Boolean).join(' | ');

const runSemanticScoring = async ({ queryText, products }) => {
    const documents = Array.isArray(products) ? products : [];
    if (!queryText || documents.length === 0) {
        return documents.map(() => 0);
    }

    try {
        const embeddings = await embedTexts([
            queryText,
            ...documents.map((product) => buildProductSearchText(product)),
        ]);
        if (!Array.isArray(embeddings) || embeddings.length !== documents.length + 1) {
            return documents.map(() => 0);
        }

        const queryEmbedding = embeddings[0];
        return documents.map((_, index) => Number(cosineSimilarity(queryEmbedding, embeddings[index + 1]) || 0));
    } catch {
        return documents.map(() => 0);
    }
};

const enrichRankedMatches = ({ rankedDocuments = [], heuristicTokens = [], queryText = '' }) => {
    const tokens = uniqueStrings([queryText, ...(heuristicTokens || [])], 10)
        .join(' ')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);

    return rankedDocuments.map((entry, index) => {
        const product = entry?.document || {};
        const haystack = normalizeText(buildProductSearchText(product));
        const lexicalHits = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
        const lexicalScore = tokens.length > 0 ? (lexicalHits / tokens.length) : 0;
        const rerankScore = Number(entry?.score || 0);
        const semanticScore = Number(product?.__semanticScore || 0);
        const blended = Math.min(0.99, Math.max(0.15, Number(((rerankScore * 0.55) + (semanticScore * 0.3) + (lexicalScore * 0.15)).toFixed(3))));

        return {
            ...product,
            visualConfidence: blended,
            visualRank: index + 1,
            visualSignals: {
                rerankScore: Number(rerankScore.toFixed(3)),
                semanticScore: Number(semanticScore.toFixed(3)),
                lexicalScore: Number(lexicalScore.toFixed(3)),
            },
        };
    });
};

const runMultimodalVisualSearch = async (payload = {}) => {
    const images = [{
        url: safeString(payload.imageUrl),
        dataUrl: safeString(payload.imageDataUrl),
    }].filter((entry) => entry.url || entry.dataUrl);
    const heuristicTokens = buildHeuristicTokens(payload);
    const description = await describeVisualInput({
        message: payload.message,
        hints: payload.hints,
        fileName: payload.fileName,
        imageMeta: payload.imageMeta,
        images,
    });
    const candidateQueries = buildCandidateQueries({
        description,
        heuristicTokens,
    });

    const queryGroups = await Promise.all(candidateQueries.map((candidate) => queryProducts({
        keyword: candidate,
        limit: 12,
        sort: 'relevance',
        includeDetails: true,
    }).catch(() => ({ products: [] }))));

    const mergedProducts = mergeProducts(queryGroups);
    const primaryQuery = safeString(description.searchQuery || candidateQueries[0] || '');
    const semanticScores = await runSemanticScoring({
        queryText: primaryQuery || uniqueStrings(heuristicTokens, 6).join(' '),
        products: mergedProducts,
    });

    const rerankInput = mergedProducts.map((product, index) => ({
        ...product,
        __semanticScore: Number(semanticScores[index] || 0),
    }));

    const reranked = await rerankDocuments({
        query: primaryQuery || description.caption || uniqueStrings(heuristicTokens, 6).join(' '),
        documents: rerankInput.map((product) => ({
            ...product,
            text: buildProductSearchText(product),
            semanticScore: product.__semanticScore,
        })),
        topN: Math.min(MAX_MATCHES, rerankInput.length || MAX_MATCHES),
    });

    const matches = enrichRankedMatches({
        rankedDocuments: reranked,
        heuristicTokens: [
            ...heuristicTokens,
            ...(description.keywords || []),
            ...(description.attributes || []),
        ],
        queryText: primaryQuery,
    }).slice(0, MAX_MATCHES);

    return {
        querySignals: {
            tokens: uniqueStrings([
                ...heuristicTokens,
                ...(description.keywords || []),
                ...(description.attributes || []),
            ], 12),
            derivedKeyword: primaryQuery || null,
            caption: description.caption || '',
            categoryHints: description.categoryHints || [],
            visionProvider: description.provider || 'heuristic',
            imageMeta: payload.imageMeta || null,
        },
        matches,
        total: matches.length,
    };
};

module.exports = {
    runMultimodalVisualSearch,
};
