const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Product = require('../../models/Product');
const logger = require('../../utils/logger');
const { embedText, getGatewayConfig, getModelGatewayHealth } = require('./modelGatewayService');

const INDEX_DIRECTORY = path.resolve(__dirname, '../../.assistant');
const INDEX_FILE = path.join(INDEX_DIRECTORY, 'product-vector-index.json');
const INDEX_VERSION = 1;
const MAX_BACKFILL_BATCH = 100;
const DEFAULT_QUERY_EMBED_CACHE_TTL_MS = 30 * 60 * 1000;
const queryEmbeddingCache = new Map();

let indexCache = null;
let loadPromise = null;
let writePromise = Promise.resolve();
const scheduledRefreshes = new Set();

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const toPositiveNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const getQueryEmbeddingCacheTtlMs = () => toPositiveNumber(process.env.ASSISTANT_QUERY_EMBED_CACHE_TTL_MS, DEFAULT_QUERY_EMBED_CACHE_TTL_MS);

const ensureDirectory = async () => {
    await fs.promises.mkdir(INDEX_DIRECTORY, { recursive: true });
};

const createEmptyIndex = () => ({
    version: INDEX_VERSION,
    embeddingModel: getGatewayConfig().embedModel,
    updatedAt: new Date().toISOString(),
    entries: {},
});

const normalizeSpecification = (spec = {}) => {
    const key = safeString(spec?.key || '');
    const value = safeString(spec?.value || '');
    if (!key || !value) return '';
    return `${key}: ${value}`;
};

const buildProductIndexText = (product = {}) => {
    const blocks = [
        safeString(product?.title || product?.displayTitle || ''),
        safeString(product?.brand || ''),
        safeString(product?.category || ''),
        safeString(product?.subCategory || ''),
        safeString(product?.description || ''),
        ...(Array.isArray(product?.highlights) ? product.highlights.map((entry) => safeString(entry)) : []),
        ...(Array.isArray(product?.specifications) ? product.specifications.map((entry) => normalizeSpecification(entry)) : []),
    ].filter(Boolean);

    return blocks.join('\n');
};

const computeProductHash = (product = {}) => crypto
    .createHash('sha256')
    .update(JSON.stringify({
        id: safeString(product?.id || ''),
        updatedAt: product?.updatedAt ? new Date(product.updatedAt).toISOString() : '',
        isPublished: Boolean(product?.isPublished),
        text: buildProductIndexText(product),
    }))
    .digest('hex');

const readIndexFromDisk = async () => {
    await ensureDirectory();
    try {
        const raw = await fs.promises.readFile(INDEX_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return {
                ...createEmptyIndex(),
                ...parsed,
                entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {},
            };
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            logger.warn('assistant.vector_index.read_failed', { error: error.message });
        }
    }
    return createEmptyIndex();
};

const persistIndex = async (index = createEmptyIndex()) => {
    const payload = JSON.stringify({
        ...index,
        updatedAt: new Date().toISOString(),
        embeddingModel: getGatewayConfig().embedModel,
    });

    writePromise = writePromise
        .catch(() => undefined)
        .then(async () => {
            await ensureDirectory();
            await fs.promises.writeFile(INDEX_FILE, payload, 'utf8');
        });

    await writePromise;
};

const ensureIndex = async () => {
    if (indexCache) return indexCache;
    if (!loadPromise) {
        loadPromise = readIndexFromDisk()
            .then((index) => {
                indexCache = index;
                return indexCache;
            })
            .finally(() => {
                loadPromise = null;
            });
    }
    return loadPromise;
};

const productProjection = {
    id: 1,
    title: 1,
    displayTitle: 1,
    brand: 1,
    category: 1,
    subCategory: 1,
    description: 1,
    highlights: 1,
    specifications: 1,
    price: 1,
    originalPrice: 1,
    discountPercentage: 1,
    image: 1,
    stock: 1,
    rating: 1,
    ratingCount: 1,
    isPublished: 1,
    updatedAt: 1,
};

const toProductSummary = (product = {}) => ({
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
});

const cosineSimilarity = (left = [], right = []) => {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0 || left.length !== right.length) {
        return 0;
    }

    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < left.length; index += 1) {
        const a = Number(left[index] || 0);
        const b = Number(right[index] || 0);
        dot += a * b;
        leftNorm += a * a;
        rightNorm += b * b;
    }

    if (leftNorm === 0 || rightNorm === 0) {
        return 0;
    }

    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
};

const tokenize = (value = '') => safeString(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((entry) => safeString(entry))
    .filter(Boolean);

const keywordScore = (query = '', product = {}) => {
    const haystack = [
        product?.title,
        product?.displayTitle,
        product?.brand,
        product?.category,
        product?.description,
        ...(Array.isArray(product?.highlights) ? product.highlights : []),
        ...(Array.isArray(product?.specifications) ? product.specifications.map((entry) => `${entry?.key || ''} ${entry?.value || ''}`) : []),
    ].join(' ').toLowerCase();

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return 0;

    let score = 0;
    queryTokens.forEach((token) => {
        if (haystack.includes(token)) {
            score += 1;
        }
    });
    return score / queryTokens.length;
};

const exactMatchBoost = (query = '', product = {}) => {
    const normalizedQuery = safeString(query).toLowerCase();
    const title = safeString(product?.title || product?.displayTitle || '').toLowerCase();
    const brand = safeString(product?.brand || '').toLowerCase();
    const category = safeString(product?.category || '').toLowerCase();

    let boost = 0;
    if (title && normalizedQuery && title.includes(normalizedQuery)) {
        boost += 0.45;
    }
    if (brand && normalizedQuery.includes(brand)) {
        boost += 0.2;
    }
    if (category && normalizedQuery.includes(category.toLowerCase())) {
        boost += 0.15;
    }
    return boost;
};

const createQueryEmbeddingCacheKey = (query = '') => `${safeString(getGatewayConfig().embedModel)}::${safeString(query).toLowerCase()}`;

const getCachedQueryEmbedding = (query = '') => {
    const cacheKey = createQueryEmbeddingCacheKey(query);
    const cached = queryEmbeddingCache.get(cacheKey);
    if (!cached) return [];
    if (Number(cached.expiresAt || 0) <= Date.now()) {
        queryEmbeddingCache.delete(cacheKey);
        return [];
    }
    return Array.isArray(cached.embedding) ? cached.embedding : [];
};

const cacheQueryEmbedding = (query = '', embedding = []) => {
    if (!Array.isArray(embedding) || embedding.length === 0) return;
    queryEmbeddingCache.set(createQueryEmbeddingCacheKey(query), {
        embedding,
        expiresAt: Date.now() + getQueryEmbeddingCacheTtlMs(),
    });
};

const shouldSkipQueryEmbedding = () => {
    const gatewayHealth = getModelGatewayHealth();
    const breakerState = safeString(gatewayHealth?.breaker?.state || '');
    const errorMessage = safeString(gatewayHealth?.error || '').toLowerCase();
    if (breakerState === 'open') return true;
    return errorMessage.includes('quota exceeded') || errorMessage.includes('embed_content');
};

const upsertProductVectorEntry = async (product = {}, { force = false } = {}) => {
    const safeProductId = Number(product?.id || 0);
    if (!Number.isInteger(safeProductId) || safeProductId <= 0) return null;

    const index = await ensureIndex();
    const entryKey = String(safeProductId);

    if (!product?.isPublished) {
        if (index.entries[entryKey]) {
            delete index.entries[entryKey];
            await persistIndex(index);
        }
        return null;
    }

    const text = buildProductIndexText(product);
    if (!text) return null;

    const hash = computeProductHash(product);
    const existingEntry = index.entries[entryKey];
    if (!force && existingEntry?.hash === hash && Array.isArray(existingEntry?.embedding) && existingEntry.embedding.length > 0) {
        return existingEntry;
    }

    const embedding = await embedText(text, { taskType: 'RETRIEVAL_DOCUMENT' });
    if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('assistant_vector_embedding_failed');
    }

    index.entries[entryKey] = {
        productId: safeProductId,
        hash,
        indexedAt: new Date().toISOString(),
        embedding,
        summary: toProductSummary(product),
    };
    await persistIndex(index);
    return index.entries[entryKey];
};

const fetchProductForSync = async (identifier) => {
    if (identifier === undefined || identifier === null || identifier === '') return null;

    if (mongoose.isValidObjectId(identifier)) {
        return Product.findById(identifier).select(productProjection).lean();
    }

    const numericId = Number(identifier);
    if (Number.isInteger(numericId) && numericId > 0) {
        return Product.findOne({ id: numericId }).select(productProjection).lean();
    }

    return null;
};

const refreshProductVectorEntryById = async (identifier) => {
    const product = await fetchProductForSync(identifier);
    if (!product) return null;
    return upsertProductVectorEntry(product, { force: true });
};

const scheduleProductIndexRefreshById = (identifier) => {
    const key = safeString(identifier);
    if (!key || scheduledRefreshes.has(key)) return;

    scheduledRefreshes.add(key);
    setTimeout(() => {
        refreshProductVectorEntryById(identifier)
            .catch((error) => {
                logger.warn('assistant.vector_index.incremental_sync_failed', {
                    identifier: key,
                    error: error.message,
                });
            })
            .finally(() => {
                scheduledRefreshes.delete(key);
            });
    }, 0);
};

const backfillProductVectorIndex = async ({ limit = 0, force = false } = {}) => {
    const safeLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : 0;
    const batchSize = Math.min(MAX_BACKFILL_BATCH, safeLimit || MAX_BACKFILL_BATCH);
    let processed = 0;
    let updated = 0;
    let skipped = 0;
    let offset = 0;
    let exhausted = false;

    while (!exhausted) {
        const remaining = safeLimit > 0 ? Math.max(safeLimit - processed, 0) : batchSize;
        if (safeLimit > 0 && remaining <= 0) {
            break;
        }

        const products = await Product.find({ isPublished: true })
            .sort({ updatedAt: -1, createdAt: -1 })
            .skip(offset)
            .limit(Math.min(batchSize, remaining || batchSize))
            .select(productProjection)
            .lean();

        if (!products.length) {
            exhausted = true;
            break;
        }

        for (const product of products) {
            processed += 1;
            try {
                const previousHash = indexCache?.entries?.[String(product.id)]?.hash || '';
                const nextHash = computeProductHash(product);
                if (!force && previousHash === nextHash) {
                    skipped += 1;
                    continue;
                }
                await upsertProductVectorEntry(product, { force: true });
                updated += 1;
            } catch (error) {
                logger.warn('assistant.vector_index.backfill_entry_failed', {
                    productId: product.id,
                    error: error.message,
                });
            }
        }

        offset += products.length;
    }

    return {
        processed,
        updated,
        skipped,
        indexPath: INDEX_FILE,
    };
};

const hydrateLexicalCandidates = async (query = '', { limit = 10 } = {}) => {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const regexes = tokens.slice(0, 6).map((token) => new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    const candidates = await Product.find({
        isPublished: true,
        $or: [
            { title: { $in: regexes } },
            { brand: { $in: regexes } },
            { category: { $in: regexes } },
            { description: { $in: regexes } },
        ],
    })
        .limit(Math.max(5, limit * 2))
        .select(productProjection)
        .lean();

    for (const candidate of candidates) {
        try {
            await upsertProductVectorEntry(candidate, { force: false });
        } catch {
            // Keep lexical fallback available even when embedding refresh fails.
        }
    }

    return candidates;
};

const searchProductVectorIndex = async (query = '', {
    limit = 5,
} = {}) => {
    const normalizedQuery = safeString(query);
    if (!normalizedQuery) {
        return {
            results: [],
            retrievalHitCount: 0,
            provider: 'vector_store',
            fallbackUsed: false,
        };
    }

    const index = await ensureIndex();
    const lexicalCandidates = await hydrateLexicalCandidates(normalizedQuery, { limit });
    const lexicalById = new Map(lexicalCandidates.map((product) => [String(product.id), product]));

    let queryEmbedding = getCachedQueryEmbedding(normalizedQuery);
    let fallbackUsed = false;
    let fallbackReason = '';
    if (queryEmbedding.length === 0 && !shouldSkipQueryEmbedding()) {
        try {
            queryEmbedding = await embedText(normalizedQuery, { taskType: 'RETRIEVAL_QUERY' });
            cacheQueryEmbedding(normalizedQuery, queryEmbedding);
        } catch (error) {
            fallbackUsed = true;
            fallbackReason = safeString(error?.message || 'query_embedding_failed');
            logger.warn('assistant.vector_index.query_embedding_failed', {
                error: error.message,
            });
        }
    } else if (queryEmbedding.length === 0) {
        fallbackUsed = true;
        fallbackReason = 'query_embedding_skipped';
    }

    const allEntries = Object.values(index.entries || {});
    const ranked = allEntries.map((entry) => {
        const product = lexicalById.get(String(entry.productId)) || entry.summary || {};
        const lexical = keywordScore(normalizedQuery, product);
        const exact = exactMatchBoost(normalizedQuery, product);
        const semantic = Array.isArray(queryEmbedding) && queryEmbedding.length > 0
            ? cosineSimilarity(queryEmbedding, entry.embedding || [])
            : 0;
        return {
            productId: Number(entry.productId || 0),
            score: queryEmbedding.length > 0
                ? (semantic * 0.7) + (lexical * 0.2) + exact
                : (lexical * 0.85) + exact,
        };
    });

    lexicalCandidates.forEach((product) => {
        const existing = ranked.find((entry) => entry.productId === Number(product.id));
        if (!existing) {
            ranked.push({
                productId: Number(product.id),
                score: (keywordScore(normalizedQuery, product) * (queryEmbedding.length > 0 ? 0.45 : 1)) + exactMatchBoost(normalizedQuery, product),
            });
        }
    });

    const topIds = ranked
        .filter((entry) => Number.isInteger(entry.productId) && entry.productId > 0 && entry.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, Math.max(1, Number(limit || 5)));

    const products = topIds.length > 0
        ? await Product.find({
            id: { $in: topIds.map((entry) => entry.productId) },
            isPublished: true,
        })
            .select(productProjection)
            .lean()
        : [];

    const productMap = new Map(products.map((product) => [Number(product.id), product]));

    return {
        results: topIds
            .map((entry) => ({
                product: productMap.get(Number(entry.productId)) || null,
                score: Number(entry.score || 0),
            }))
            .filter((entry) => entry.product),
        retrievalHitCount: topIds.length,
        provider: 'vector_store',
        fallbackUsed,
        fallbackReason,
    };
};

const getLocalVectorIndexHealth = async () => {
    const index = await ensureIndex();
    return {
        healthy: true,
        indexPath: INDEX_FILE,
        indexVersion: index.version || INDEX_VERSION,
        embeddingModel: index.embeddingModel || getGatewayConfig().embedModel,
        entryCount: Object.keys(index.entries || {}).length,
        updatedAt: safeString(index.updatedAt || ''),
        gateway: getModelGatewayHealth(),
    };
};

module.exports = {
    backfillProductVectorIndex,
    buildProductIndexText,
    getLocalVectorIndexHealth,
    refreshProductVectorEntryById,
    scheduleProductIndexRefreshById,
    searchProductVectorIndex,
    upsertProductVectorEntry,
};
