const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const CatalogImportJob = require('../models/CatalogImportJob');
const CatalogSyncCursor = require('../models/CatalogSyncCursor');
const CatalogSyncRun = require('../models/CatalogSyncRun');
const SystemState = require('../models/SystemState');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { resolveCategory } = require('../config/categories');
const { flags } = require('../config/catalogFlags');
const { resolveProductImage } = require('./productImageResolver');

const WORKER_ID = `${os.hostname()}-${process.pid}`;
const IMPORT_BATCH_SIZE = 500;
const MAX_ERROR_SAMPLE = 100;
const MAX_ROWS_PER_IMPORT = 2_000_000;
const MAX_FILTER_COMPLEXITY = 20;
const MAX_SPONSORED_SLOTS = 4;
const DEFAULT_SPONSORED_SLOTS = 2;
const LOCK_EXPIRY_MS = 5 * 60 * 1000;
const DEFAULT_SYSTEM_KEY = 'singleton';
const NO_IMAGE_PLACEHOLDER = 'https://via.placeholder.com/600x600?text=Aura+Product';

let importWorkerTimer = null;
let syncWorkerTimer = null;
let atlasSearchSupported = null;
let systemStateWriteBlocked = false;
let systemStateFallbackDoc = null;
let systemStateFallbackWarned = false;
let importWorkerPausedByQuota = false;
let syncWorkerPausedByQuota = false;

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const safeLower = (value, fallback = '') => safeString(value, fallback).toLowerCase();
const safeNumber = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};
const toInt = (value, fallback = 0) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.trunc(num);
};

const makeId = (prefix) => `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;

const hashValue = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalizeTitleKey = (value) => (typeof Product.normalizeTitleKey === 'function'
    ? Product.normalizeTitleKey(value)
    : safeLower(String(value || '').replace(/\s+/g, ' ').trim()));
const normalizeImageKey = (value) => (typeof Product.normalizeImageKey === 'function'
    ? Product.normalizeImageKey(value)
    : safeLower(String(value || '').trim()));
const isSystemStateWriteBlocked = (error) => {
    const message = safeLower(error?.message || '');
    return message.includes('cannot create a new collection')
        || message.includes('over your space quota')
        || message.includes('using 510 collections of 500')
        || message.includes('space quota');
};
const isDuplicateKeyError = (error) => {
    if (!error) return false;
    if (error.code === 11000) return true;
    if (Array.isArray(error.writeErrors) && error.writeErrors.some((entry) => entry?.code === 11000)) return true;
    return String(error.message || '').includes('E11000');
};
const detectDuplicateField = (error) => {
    if (error?.keyPattern?.titleKey) return 'name';
    if (error?.keyPattern?.imageKey) return 'image';

    const rawMessage = safeString(error?.message || '');
    if (rawMessage.includes('titleKey')) return 'name';
    if (rawMessage.includes('imageKey')) return 'image';

    if (Array.isArray(error?.writeErrors)) {
        const joined = error.writeErrors.map((entry) => safeString(entry?.errmsg || '')).join(' ');
        if (joined.includes('titleKey')) return 'name';
        if (joined.includes('imageKey')) return 'image';
    }

    return 'product identity';
};
const mapDuplicateToAppError = (error) => {
    const field = detectDuplicateField(error);
    if (field === 'name') {
        return new AppError('Duplicate product name is not allowed. Use a unique product name.', 409);
    }
    if (field === 'image') {
        return new AppError('Duplicate product image is not allowed. Use a unique image URL.', 409);
    }
    return new AppError('Duplicate product identity is not allowed.', 409);
};

const getProviderSourceRef = (provider) => {
    const normalized = safeLower(provider, flags.catalogDefaultSyncProvider);
    const envKey = `CATALOG_PROVIDER_SOURCE_REF_${normalized.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    return safeString(process.env[envKey] || flags.catalogProviderSourceRef);
};

const buildSearchText = (record = {}) => [
    safeString(record.title),
    safeString(record.brand),
    safeString(record.category),
    safeString(record.description),
    Array.isArray(record.highlights) ? record.highlights.join(' ') : '',
    Array.isArray(record.specifications)
        ? record.specifications.map((entry) => `${safeString(entry?.key)} ${safeString(entry?.value)}`).join(' ')
        : '',
].filter(Boolean).join(' | ');

const resolveSourceRefPath = (sourceRef) => {
    const trimmed = safeString(sourceRef);
    if (!trimmed) {
        throw new AppError('sourceRef is required', 400);
    }
    const candidatePaths = [
        trimmed,
        path.resolve(process.cwd(), trimmed),
        path.resolve(process.cwd(), 'data', trimmed),
        path.resolve(process.cwd(), '..', trimmed),
    ];

    for (const candidate of candidatePaths) {
        if (fs.existsSync(candidate)) return candidate;
    }
    throw new AppError(`Catalog sourceRef file not found: ${trimmed}`, 404);
};

const parseCsvLine = (line) => {
    const out = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        const next = line[i + 1];

        if (ch === '"' && inQuotes && next === '"') {
            current += '"';
            i += 1;
            continue;
        }

        if (ch === '"') {
            inQuotes = !inQuotes;
            continue;
        }

        if (ch === ',' && !inQuotes) {
            out.push(current.trim());
            current = '';
            continue;
        }

        current += ch;
    }
    out.push(current.trim());
    return out;
};

async function* streamRowsFromSource(sourceType, sourceRef) {
    const filePath = resolveSourceRefPath(sourceRef);
    const ext = safeLower(path.extname(filePath).replace('.', ''));
    const effectiveType = safeLower(sourceType || ext || 'jsonl');

    if (['jsonl', 'ndjson'].includes(effectiveType)) {
        const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        let row = 0;

        for await (const line of rl) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            row += 1;
            let parsed;
            try {
                parsed = JSON.parse(trimmed);
            } catch (error) {
                throw new AppError(`Invalid JSONL at row ${row}: ${error.message}`, 400);
            }
            yield { row, data: parsed };
        }
        return;
    }

    if (effectiveType === 'csv') {
        const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        let row = 0;
        let headers = null;

        for await (const line of rl) {
            if (!line.trim()) continue;
            row += 1;
            if (!headers) {
                headers = parseCsvLine(line).map((h) => safeString(h));
                continue;
            }
            const values = parseCsvLine(line);
            const record = {};
            headers.forEach((header, idx) => {
                record[header] = values[idx] ?? '';
            });
            yield { row: row - 1, data: record };
        }
        return;
    }

    if (effectiveType === 'json') {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            throw new AppError(`Invalid JSON source: ${error.message}`, 400);
        }
        const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : []);
        let row = 0;
        for (const item of rows) {
            row += 1;
            yield { row, data: item };
        }
        return;
    }

    throw new AppError(`Unsupported sourceType: ${effectiveType}`, 400);
}

const normalizeCategory = (value) => {
    const raw = safeString(value);
    if (!raw) return '';
    const mapped = resolveCategory(raw);
    return mapped || raw;
};

const normalizeAdCampaign = (raw = {}) => {
    const campaign = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    const startsAt = campaign.startsAt ? new Date(campaign.startsAt) : null;
    const endsAt = campaign.endsAt ? new Date(campaign.endsAt) : null;
    const budgetTotal = Math.max(0, safeNumber(campaign.budgetTotal, 0));
    const budgetSpent = Math.max(0, safeNumber(campaign.budgetSpent, 0));
    const status = safeLower(campaign.status, 'inactive');
    const placement = safeLower(campaign.placement, 'all');
    const hasWindow = startsAt instanceof Date && Number.isFinite(startsAt.getTime())
        && endsAt instanceof Date && Number.isFinite(endsAt.getTime())
        && startsAt <= endsAt;

    return {
        isSponsored: Boolean(campaign.isSponsored),
        status: ['inactive', 'active', 'paused', 'expired'].includes(status) ? status : 'inactive',
        priority: Math.min(100, Math.max(0, toInt(campaign.priority, 0))),
        cpcBid: Number(Math.min(100000, Math.max(0, safeNumber(campaign.cpcBid, 0))).toFixed(2)),
        budgetTotal: Number(Math.min(100000000, budgetTotal).toFixed(2)),
        budgetSpent: Number(Math.min(100000000, budgetSpent).toFixed(2)),
        startsAt: hasWindow ? startsAt : null,
        endsAt: hasWindow ? endsAt : null,
        placement: ['search', 'listing', 'home', 'all'].includes(placement) ? placement : 'all',
        creativeTagline: safeString(campaign.creativeTagline).slice(0, 120),
    };
};

const normalizeSpecifications = (raw = []) => {
    const source = Array.isArray(raw)
        ? raw
        : (raw && typeof raw === 'object'
            ? Object.entries(raw).map(([key, value]) => ({ key, value }))
            : []);

    const seen = new Set();
    const output = [];
    for (const item of source) {
        const key = safeString(item?.key || item?.name || '').slice(0, 80);
        const value = safeString(item?.value || item?.val || '').slice(0, 300);
        if (!key || !value) continue;

        const dedupe = `${key.toLowerCase()}::${value.toLowerCase()}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        output.push({ key, value });

        if (output.length >= 30) break;
    }
    return output;
};

const normalizeProductRecord = ({
    raw,
    defaultSource,
    catalogVersion,
    forSync = false,
}) => {
    const title = safeString(raw.title || raw.name || raw.productName);
    const brand = safeString(raw.brand || raw.manufacturer || 'Unknown');
    const category = normalizeCategory(raw.category || raw.subCategory || raw.department || 'Misc');
    const description = safeString(raw.description || raw.summary || '');
    const source = safeLower(defaultSource || raw.source || 'batch');
    const imageCandidate = safeString(raw.image || raw.thumbnail || raw.imageUrl || NO_IMAGE_PLACEHOLDER);
    const price = safeNumber(raw.price, NaN);
    const stock = Math.max(0, toInt(raw.stock ?? raw.quantity ?? 0, 0));
    const adCampaign = normalizeAdCampaign(raw.adCampaign);

    if (!title) {
        return { error: { code: 'INVALID_TITLE', message: 'title is required' } };
    }
    if (!Number.isFinite(price) || price < 0) {
        return { error: { code: 'INVALID_PRICE', message: 'price must be a non-negative number' } };
    }
    if (!category) {
        return { error: { code: 'INVALID_CATEGORY', message: 'category is required' } };
    }

    const externalSeed = safeString(raw.externalId || raw.sku || raw.productCode || raw.productId || raw.id);
    const externalId = externalSeed || hashValue(`${title}|${brand}|${category}|${price}`).slice(0, 24);
    const idCandidate = toInt(raw.id, NaN);
    const fallbackId = parseInt(hashValue(externalId).slice(0, 8), 16);
    const normalizedId = Number.isFinite(idCandidate)
        ? idCandidate
        : (100000000 + (fallbackId % 800000000));
    const image = resolveProductImage({
        existingImage: imageCandidate,
        title,
        brand,
        category,
        source,
        catalogVersion,
        externalId,
        id: normalizedId,
    });
    const highlights = Array.isArray(raw.highlights)
        ? raw.highlights.map((entry) => safeString(entry)).filter(Boolean).slice(0, 12)
        : [];
    const specifications = normalizeSpecifications(raw.specifications);

    const normalized = {
        id: normalizedId,
        externalId,
        source: source === 'provider' ? 'provider' : (source === 'manual' ? 'manual' : 'batch'),
        catalogVersion,
        isPublished: false,
        title,
        titleKey: normalizeTitleKey(title),
        brand,
        category,
        subCategory: safeString(raw.subCategory || ''),
        price: Number(price.toFixed(2)),
        originalPrice: Number(safeNumber(raw.originalPrice, price).toFixed(2)),
        discountPercentage: Number(safeNumber(raw.discountPercentage, 0).toFixed(2)),
        rating: Number(Math.min(Math.max(safeNumber(raw.rating, 0), 0), 5).toFixed(1)),
        ratingCount: Math.max(0, toInt(raw.ratingCount, 0)),
        image,
        imageKey: normalizeImageKey(image),
        description,
        highlights,
        specifications,
        stock,
        deliveryTime: safeString(raw.deliveryTime || '3-5 days'),
        warranty: safeString(raw.warranty || ''),
        adCampaign,
        searchText: buildSearchText({
            title,
            brand,
            category,
            description,
            highlights,
            specifications,
        }),
        updatedFromSyncAt: forSync ? new Date() : null,
    };

    normalized.ingestHash = hashValue(JSON.stringify({
        id: normalized.id,
        externalId: normalized.externalId,
        source: normalized.source,
        title: normalized.title,
        brand: normalized.brand,
        category: normalized.category,
        price: normalized.price,
        originalPrice: normalized.originalPrice,
        discountPercentage: normalized.discountPercentage,
        rating: normalized.rating,
        ratingCount: normalized.ratingCount,
        image: normalized.image,
        description: normalized.description,
        highlights: normalized.highlights,
        specifications: normalized.specifications,
        stock: normalized.stock,
        deliveryTime: normalized.deliveryTime,
        warranty: normalized.warranty,
        adCampaign: normalized.adCampaign,
    }));

    return { product: normalized };
};

const ensureSystemState = async () => {
    if (systemStateWriteBlocked && systemStateFallbackDoc) {
        return systemStateFallbackDoc;
    }

    const existing = await SystemState.findOne({ key: DEFAULT_SYSTEM_KEY });
    if (existing) return existing;

    try {
        return await SystemState.findOneAndUpdate(
            { key: DEFAULT_SYSTEM_KEY },
            {
                $setOnInsert: {
                    key: DEFAULT_SYSTEM_KEY,
                    activeCatalogVersion: 'legacy-v1',
                    previousCatalogVersion: '',
                    lastSwitchAt: new Date(),
                    manualProductCounter: 1000000,
                },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    } catch (error) {
        if (!isSystemStateWriteBlocked(error)) throw error;

        systemStateWriteBlocked = true;
        if (!systemStateFallbackDoc) {
            systemStateFallbackDoc = {
                key: DEFAULT_SYSTEM_KEY,
                activeCatalogVersion: 'legacy-v1',
                previousCatalogVersion: '',
                lastSwitchAt: new Date(),
                manualProductCounter: 1000000,
                _fallback: true,
            };
        }

        if (!systemStateFallbackWarned) {
            logger.warn('catalog.system_state.fallback_defaults', {
                reason: safeString(error.message).slice(0, 200),
            });
            systemStateFallbackWarned = true;
        }

        return systemStateFallbackDoc;
    }
};

const pauseCatalogWorkerIfQuotaBlocked = ({ worker, error }) => {
    if (!isSystemStateWriteBlocked(error)) return false;

    if (worker === 'import') {
        importWorkerPausedByQuota = true;
        if (importWorkerTimer) {
            clearInterval(importWorkerTimer);
            importWorkerTimer = null;
        }
    } else if (worker === 'sync') {
        syncWorkerPausedByQuota = true;
        if (syncWorkerTimer) {
            clearInterval(syncWorkerTimer);
            syncWorkerTimer = null;
        }
    }

    logger.warn(`catalog.${worker}.worker_paused_quota`, {
        reason: safeString(error.message).slice(0, 200),
    });
    return true;
};

const getWorkerPauseReason = () => ({
    importPausedByQuota: importWorkerPausedByQuota,
    syncPausedByQuota: syncWorkerPausedByQuota,
});

const getFallbackSystemState = () => {
    if (systemStateFallbackDoc) return systemStateFallbackDoc;
    return {
        key: DEFAULT_SYSTEM_KEY,
        activeCatalogVersion: 'legacy-v1',
        previousCatalogVersion: '',
        lastSwitchAt: new Date(),
        manualProductCounter: 1000000,
        _fallback: true,
    };
};

const resetWorkerPauseFlags = () => {
    importWorkerPausedByQuota = false;
    syncWorkerPausedByQuota = false;
};

const getSystemStateWithFallback = async () => {
    try {
        return await ensureSystemState();
    } catch (error) {
        if (!isSystemStateWriteBlocked(error)) throw error;
        systemStateWriteBlocked = true;
        if (!systemStateFallbackWarned) {
            logger.warn('catalog.system_state.fallback_defaults', {
                reason: safeString(error.message).slice(0, 200),
            });
            systemStateFallbackWarned = true;
        }
        systemStateFallbackDoc = getFallbackSystemState();
        return systemStateFallbackDoc;
    }
};

const getSystemState = async () => getSystemStateWithFallback();

const getActiveCatalogVersion = async () => {
    const state = await getSystemState();
    return state.activeCatalogVersion || 'legacy-v1';
};

const assertSearchAvailable = async () => {
    if (atlasSearchSupported !== null) {
        return atlasSearchSupported;
    }

    try {
        await Product.aggregate([
            {
                $search: {
                    index: flags.catalogSearchIndexName,
                    text: { query: 'aura', path: ['searchText'] },
                },
            },
            { $limit: 1 },
        ]);
        atlasSearchSupported = true;
    } catch (error) {
        atlasSearchSupported = false;
        logger.warn('catalog.search.unavailable', { error: error.message });
    }

    return atlasSearchSupported;
};

const enforceCatalogStartupCheck = async () => {
    if (!flags.catalogSearchCheckOnBoot || flags.isTest) return;
    const available = await assertSearchAvailable();
    if (!available && flags.isProduction) {
        throw new Error(`Atlas Search index "${flags.catalogSearchIndexName}" is unavailable`);
    }
};

const buildBaseProductFilter = async () => {
    if (!flags.catalogActiveVersionRequired) return {};
    const activeCatalogVersion = await getActiveCatalogVersion();
    return {
        catalogVersion: activeCatalogVersion,
        isPublished: true,
    };
};

const buildFilterFromQuery = (query = {}) => {
    const filter = {};

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
        filter.price = {};
        if (query.minPrice !== undefined) filter.price.$gte = safeNumber(query.minPrice, 0);
        if (query.maxPrice !== undefined) filter.price.$lte = safeNumber(query.maxPrice, Number.MAX_SAFE_INTEGER);
    }

    if (query.brand) {
        const brands = safeString(query.brand).split(',').map((entry) => entry.trim()).filter(Boolean);
        if (brands.length > 0) {
            filter.brand = { $in: brands.map((brand) => new RegExp(`^${brand}$`, 'i')) };
        }
    }

    if (query.rating !== undefined) {
        filter.rating = { $gte: safeNumber(query.rating, 0) };
    }

    if (query.discount !== undefined) {
        filter.discountPercentage = { $gte: safeNumber(query.discount, 0) };
    }

    if (query.category && safeLower(query.category) !== 'all') {
        const categoryTokens = safeString(query.category)
            .split(',')
            .map((entry) => safeString(entry))
            .filter(Boolean);

        const categoryPatterns = categoryTokens.map((entry) => {
            const mapped = resolveCategory(entry);
            if (mapped) {
                return new RegExp(`^${escapeRegExp(mapped)}$`, 'i');
            }

            const clean = safeString(entry).replace(/[-_]/g, ' ').replace(/[^a-zA-Z0-9 ]/g, '').trim();
            if (!clean) return null;
            const regexPattern = clean.split(/\s+/).join('.*');
            return new RegExp(regexPattern, 'i');
        }).filter(Boolean);

        if (categoryPatterns.length > 0) {
            filter.category = { $in: categoryPatterns };
        }
    }

    if (safeLower(query.inStock) === 'true') {
        filter.stock = { ...(filter.stock || {}), $gt: 0 };
    }

    if (query.minStock !== undefined) {
        filter.stock = { ...(filter.stock || {}), $gte: safeNumber(query.minStock, 0) };
    }

    if (safeLower(query.hasWarranty) === 'true') {
        filter.warranty = { $regex: '\\S+', $options: 'i' };
    }

    if (query.minReviews !== undefined) {
        filter.ratingCount = { $gte: safeNumber(query.minReviews, 0) };
    }

    if (query.deliveryTime) {
        const windows = safeString(query.deliveryTime)
            .split(',')
            .map((entry) => safeString(entry))
            .filter(Boolean);
        if (windows.length > 0) {
            filter.deliveryTime = {
                $in: windows.map((window) => new RegExp(`^${escapeRegExp(window)}$`, 'i')),
            };
        }
    }

    return filter;
};

const buildKeywordCandidates = (keyword) => {
    const cleaned = safeString(keyword).replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];

    const tokens = cleaned.split(' ').filter(Boolean).slice(0, 6);
    const alphaTokens = tokens.filter((token) => /[a-zA-Z]/.test(token));
    const numericTokens = tokens.filter((token) => /^\d+$/.test(token));

    const candidates = [cleaned];

    if (alphaTokens.length > 0) {
        candidates.push(alphaTokens[0]);
    }
    if (alphaTokens.length > 1) {
        candidates.push(`${alphaTokens[0]} ${alphaTokens[1]}`);
    }
    if (numericTokens.length > 0 && alphaTokens.length > 0) {
        candidates.push(`${alphaTokens[0]} ${numericTokens[0]}`);
    }
    if (tokens.length > 0) {
        candidates.push(tokens[0]);
    }

    return [...new Set(candidates.map((entry) => entry.trim()).filter(Boolean))];
};

const buildKeywordRegexFilter = (keywordCandidates = []) => {
    if (!Array.isArray(keywordCandidates) || keywordCandidates.length === 0) {
        return {};
    }

    return {
        $or: keywordCandidates.flatMap((candidate) => {
            const pattern = escapeRegExp(candidate);
            return [
                { title: { $regex: pattern, $options: 'i' } },
                { brand: { $regex: pattern, $options: 'i' } },
                { category: { $regex: pattern, $options: 'i' } },
            ];
        }),
    };
};

const resolveSort = (sortBy) => {
    switch (safeLower(sortBy, 'relevance')) {
        case 'price-asc': return { price: 1, _id: 1 };
        case 'price-desc': return { price: -1, _id: -1 };
        case 'newest': return { createdAt: -1, _id: -1 };
        case 'rating': return { rating: -1, _id: -1 };
        case 'discount': return { discountPercentage: -1, _id: -1 };
        case 'relevance':
        default: return { ratingCount: -1, _id: -1 };
    }
};

const shouldIncludeSponsored = (query = {}) => safeLower(query.includeSponsored, 'true') !== 'false';

const resolveSponsoredSlots = (query = {}) => {
    const requested = toInt(query.sponsoredSlots, DEFAULT_SPONSORED_SLOTS);
    return Math.min(MAX_SPONSORED_SLOTS, Math.max(0, requested));
};

const buildSponsoredCandidateFilter = ({
    mergedBase,
    keywordFilter,
    query,
}) => {
    const now = new Date();
    const placementHint = safeString(query.category) || safeString(query.keyword) ? 'listing' : 'home';
    const adFilter = {
        ...mergedBase,
        'adCampaign.isSponsored': true,
        'adCampaign.status': 'active',
        'adCampaign.budgetTotal': { $gt: 0 },
        $expr: { $lt: ['$adCampaign.budgetSpent', '$adCampaign.budgetTotal'] },
        $and: [
            {
                $or: [
                    { 'adCampaign.startsAt': null },
                    { 'adCampaign.startsAt': { $exists: false } },
                    { 'adCampaign.startsAt': { $lte: now } },
                ],
            },
            {
                $or: [
                    { 'adCampaign.endsAt': null },
                    { 'adCampaign.endsAt': { $exists: false } },
                    { 'adCampaign.endsAt': { $gte: now } },
                ],
            },
            {
                $or: [
                    { 'adCampaign.placement': 'all' },
                    { 'adCampaign.placement': placementHint },
                ],
            },
        ],
    };

    if (keywordFilter?.$or?.length) {
        adFilter.$and.push({ $or: keywordFilter.$or });
    }

    return adFilter;
};

const toPlainProduct = (product) => (product?.toObject?.() ? product.toObject() : product);

const fetchSponsoredProducts = async ({
    mergedBase,
    keywordFilter,
    query,
    maxSlots,
}) => {
    if (maxSlots <= 0) return [];
    const adFilter = buildSponsoredCandidateFilter({
        mergedBase,
        keywordFilter,
        query,
    });
    const adDocs = await Product.find(adFilter)
        .sort({
            'adCampaign.priority': -1,
            'adCampaign.cpcBid': -1,
            rating: -1,
            _id: -1,
        })
        .limit(maxSlots * 4)
        .maxTimeMS(8000);

    return (adDocs || []).map((doc) => {
        const plain = toPlainProduct(doc);
        return {
            ...plain,
            adMeta: {
                isSponsored: true,
                label: 'Sponsored',
                campaignStatus: plain?.adCampaign?.status || 'active',
                priority: Number(plain?.adCampaign?.priority || 0),
                cpcBid: Number(plain?.adCampaign?.cpcBid || 0),
            },
        };
    });
};

const mergeSponsoredIntoProducts = ({
    organicProducts,
    sponsoredProducts,
    maxSlots,
}) => {
    if (!Array.isArray(organicProducts) || organicProducts.length === 0) return organicProducts || [];
    if (!Array.isArray(sponsoredProducts) || sponsoredProducts.length === 0 || maxSlots <= 0) {
        return organicProducts;
    }

    const result = [...organicProducts.map((item) => toPlainProduct(item))];
    const existingIds = new Set(result.map((item) => String(item?._id || item?.id || '')));
    const usableSponsored = sponsoredProducts.filter((ad) => {
        const id = String(ad?._id || ad?.id || '');
        return id && !existingIds.has(id);
    });

    let inserted = 0;
    for (const ad of usableSponsored) {
        if (inserted >= maxSlots) break;
        const slotIndex = Math.min((inserted * 5) + 1, result.length - 1);
        result[slotIndex] = ad;
        inserted += 1;
    }
    return result;
};

const decodeCursor = (cursor) => {
    if (!cursor) return null;
    try {
        const raw = Buffer.from(cursor, 'base64').toString('utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed;
    } catch {
        return null;
    }
};

const buildCursorCondition = ({ cursor, sort }) => {
    const sortKey = Object.keys(sort).find((key) => key !== '_id') || '_id';
    const direction = sort[sortKey] || -1;
    if (!cursor || cursor.lastVal === undefined || !cursor.lastId) return null;

    if (sortKey === '_id') {
        return direction === -1
            ? { _id: { $lt: new mongoose.Types.ObjectId(cursor.lastId) } }
            : { _id: { $gt: new mongoose.Types.ObjectId(cursor.lastId) } };
    }

    const cursorId = new mongoose.Types.ObjectId(cursor.lastId);
    return direction === -1
        ? {
            $or: [
                { [sortKey]: { $lt: cursor.lastVal } },
                { [sortKey]: cursor.lastVal, _id: { $lt: cursorId } },
            ],
        }
        : {
            $or: [
                { [sortKey]: { $gt: cursor.lastVal } },
                { [sortKey]: cursor.lastVal, _id: { $gt: cursorId } },
            ],
        };
};

const generateNextCursor = (products, sort) => {
    if (!Array.isArray(products) || products.length === 0) return null;
    const sortKey = Object.keys(sort).find((key) => key !== '_id') || '_id';
    const last = products[products.length - 1];
    const payload = {
        lastVal: sortKey === '_id' ? String(last._id) : last[sortKey],
        lastId: String(last._id),
        sortKey,
    };
    return Buffer.from(JSON.stringify(payload)).toString('base64');
};

const countFilterComplexity = (filter) => {
    let complexity = 0;
    const walk = (value) => {
        if (!value || typeof value !== 'object') return;
        Object.keys(value).forEach((key) => {
            complexity += 1;
            walk(value[key]);
        });
    };
    walk(filter);
    return complexity;
};

const queryProducts = async (query = {}) => {
    const limit = Math.min(Math.max(toInt(query.limit, 12), 1), 50);
    const page = Math.max(toInt(query.page, 1), 1);
    const includeSponsored = shouldIncludeSponsored(query);
    const sponsoredSlots = resolveSponsoredSlots(query);
    const baseFilter = await buildBaseProductFilter();
    const logicalFilter = buildFilterFromQuery(query);
    const mergedBase = { ...baseFilter, ...logicalFilter };

    if (countFilterComplexity(mergedBase) > MAX_FILTER_COMPLEXITY) {
        throw new AppError('Filter complexity exceeds allowed limits', 400);
    }

    const sort = resolveSort(query.sort);
    const cursor = decodeCursor(query.nextCursor);
    const cursorCondition = buildCursorCondition({ cursor, sort });
    const finalFilter = cursorCondition
        ? { ...mergedBase, ...cursorCondition }
        : mergedBase;

    const keyword = safeString(query.keyword);
    const keywordCandidates = buildKeywordCandidates(keyword);
    const useAtlasSearch = keywordCandidates.length > 0 && await assertSearchAvailable();
    const requestTimeoutMs = 8000;
    const keywordFilter = buildKeywordRegexFilter(keywordCandidates);

    const runRegexFallbackQuery = async () => {
        const fallbackFilter = {
            ...finalFilter,
            ...keywordFilter,
        };

        const countFilter = {
            ...mergedBase,
            ...keywordFilter,
        };

        const skip = cursor ? 0 : (page - 1) * limit;
        const [products, total] = await Promise.all([
            Product.find(fallbackFilter)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .maxTimeMS(requestTimeoutMs),
            Product.countDocuments(countFilter).maxTimeMS(requestTimeoutMs),
        ]);

        let finalProducts = (products || []).map((entry) => toPlainProduct(entry));
        if (includeSponsored && sponsoredSlots > 0 && finalProducts.length > 0) {
            const sponsoredProducts = await fetchSponsoredProducts({
                mergedBase,
                keywordFilter,
                query,
                maxSlots: sponsoredSlots,
            });
            finalProducts = mergeSponsoredIntoProducts({
                organicProducts: finalProducts,
                sponsoredProducts,
                maxSlots: sponsoredSlots,
            });
        }

        return {
            products: finalProducts,
            total,
            page,
            pages: Math.max(1, Math.ceil(total / limit)),
            nextCursor: products.length === limit ? generateNextCursor(products, sort) : null,
        };
    };

    if (useAtlasSearch) {
        const mustClauses = [
            {
                text: {
                    query: keywordCandidates.length === 1 ? keywordCandidates[0] : keywordCandidates,
                    path: ['title', 'description', 'brand', 'category', 'searchText'],
                },
            },
        ];
        const filterClauses = [];

        if (baseFilter.catalogVersion) {
            filterClauses.push({
                equals: {
                    path: 'catalogVersion',
                    value: baseFilter.catalogVersion,
                },
            });
        }
        if (baseFilter.isPublished !== undefined) {
            filterClauses.push({
                equals: {
                    path: 'isPublished',
                    value: baseFilter.isPublished,
                },
            });
        }
        if (logicalFilter.category && typeof logicalFilter.category === 'string') {
            filterClauses.push({
                equals: {
                    path: 'category',
                    value: logicalFilter.category,
                },
            });
        }
        if (logicalFilter.price?.$gte !== undefined || logicalFilter.price?.$lte !== undefined) {
            filterClauses.push({
                range: {
                    path: 'price',
                    ...(logicalFilter.price.$gte !== undefined ? { gte: logicalFilter.price.$gte } : {}),
                    ...(logicalFilter.price.$lte !== undefined ? { lte: logicalFilter.price.$lte } : {}),
                },
            });
        }
        if (logicalFilter.rating?.$gte !== undefined) {
            filterClauses.push({
                range: {
                    path: 'rating',
                    gte: logicalFilter.rating.$gte,
                },
            });
        }
        if (logicalFilter.discountPercentage?.$gte !== undefined) {
            filterClauses.push({
                range: {
                    path: 'discountPercentage',
                    gte: logicalFilter.discountPercentage.$gte,
                },
            });
        }

        const pipeline = [
            {
                $search: {
                    index: flags.catalogSearchIndexName,
                    compound: {
                        must: mustClauses,
                        ...(filterClauses.length > 0 ? { filter: filterClauses } : {}),
                    },
                },
            },
            ...(Object.keys(logicalFilter).length > 0 ? [{ $match: logicalFilter }] : []),
            ...(cursorCondition ? [{ $match: cursorCondition }] : []),
        ];

        if (safeLower(query.sort) === 'relevance' || !query.sort) {
            pipeline.push({ $addFields: { __score: { $meta: 'searchScore' } } });
            pipeline.push({ $sort: { __score: -1, _id: -1 } });
        } else {
            pipeline.push({ $sort: sort });
        }

        pipeline.push({
            $facet: {
                products: [{ $limit: limit }],
                totalMeta: [{ $count: 'count' }],
            },
        });

        const aggregate = Product.aggregate(pipeline).option({ maxTimeMS: requestTimeoutMs });
        const [result = { products: [], totalMeta: [] }] = await aggregate.exec();
        const products = result.products || [];
        const total = result.totalMeta?.[0]?.count || 0;

        if (total > 0) {
            let finalProducts = products.map((entry) => toPlainProduct(entry));
            if (includeSponsored && sponsoredSlots > 0 && finalProducts.length > 0) {
                const sponsoredProducts = await fetchSponsoredProducts({
                    mergedBase,
                    keywordFilter,
                    query,
                    maxSlots: sponsoredSlots,
                });
                finalProducts = mergeSponsoredIntoProducts({
                    organicProducts: finalProducts,
                    sponsoredProducts,
                    maxSlots: sponsoredSlots,
                });
            }

            return {
                products: finalProducts,
                total,
                page,
                pages: Math.max(1, Math.ceil(total / limit)),
                nextCursor: products.length === limit ? generateNextCursor(products, sort) : null,
            };
        }

        logger.warn('catalog.search.atlas_zero_results_fallback', {
            keyword: keywordCandidates[0] || '',
            candidateCount: keywordCandidates.length,
        });

        return runRegexFallbackQuery();
    }
    return runRegexFallbackQuery();
};

const buildIdentifierOrClauses = (identifier) => {
    const trimmed = safeString(identifier);
    const numeric = Number(trimmed);
    const byId = Number.isFinite(numeric) ? { id: numeric } : null;
    const byExternal = { externalId: trimmed };
    const byMongoId = mongoose.isValidObjectId(trimmed) ? { _id: trimmed } : null;

    return [byExternal, ...(byId ? [byId] : []), ...(byMongoId ? [byMongoId] : [])];
};

const resolveProductIdentifierFilter = async (identifier) => {
    const baseFilter = await buildBaseProductFilter();
    const orClauses = buildIdentifierOrClauses(identifier);

    return {
        ...baseFilter,
        $or: orClauses,
    };
};

const getProductByIdentifier = async (identifier) => {
    const filter = await resolveProductIdentifierFilter(identifier);
    const inActiveCatalog = await Product.findOne(filter);
    if (inActiveCatalog) return inActiveCatalog;

    // Admin/governance fallback:
    // allow direct identifier resolution even if product is outside active catalog version.
    const fallbackOr = buildIdentifierOrClauses(identifier);
    if (!fallbackOr.length) return null;
    return Product.findOne({ $or: fallbackOr });
};

const allocateManualProductId = async (session = null) => {
    try {
        const query = SystemState.findOneAndUpdate(
            { key: DEFAULT_SYSTEM_KEY },
            {
                $inc: { manualProductCounter: 1 },
                $setOnInsert: { key: DEFAULT_SYSTEM_KEY },
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        const state = session ? await query.session(session) : await query;
        return state.manualProductCounter;
    } catch (error) {
        if (!isSystemStateWriteBlocked(error)) throw error;

        const maxManual = await Product.findOne({ source: 'manual' }).sort({ id: -1 }).select('id').lean();
        const nextFromManual = Number(maxManual?.id) + 1;
        const fallbackId = Number.isFinite(nextFromManual) && nextFromManual > 1000000
            ? nextFromManual
            : 1000001;

        logger.warn('catalog.manual_id.fallback_sequence', {
            fallbackId,
            reason: safeString(error.message).slice(0, 200),
        });
        return fallbackId;
    }
};

const createManualProduct = async (payload) => {
    const activeVersion = await getActiveCatalogVersion();
    const productId = await allocateManualProductId();
    const externalId = `manual_${crypto.randomUUID()}`;
    const normalized = normalizeProductRecord({
        raw: { ...payload, id: productId, externalId, source: 'manual' },
        defaultSource: 'manual',
        catalogVersion: activeVersion,
        forSync: false,
    });

    if (normalized.error) {
        throw new AppError(normalized.error.message, 400);
    }

    const duplicate = await Product.findOne({
        $or: [
            { titleKey: normalized.product.titleKey },
            { imageKey: normalized.product.imageKey },
        ],
    }).select('_id titleKey imageKey').lean();
    if (duplicate?.titleKey === normalized.product.titleKey) {
        throw new AppError('Product name already exists. Use a unique product name.', 409);
    }
    if (duplicate?.imageKey === normalized.product.imageKey) {
        throw new AppError('Product image already exists. Use a unique image URL.', 409);
    }

    try {
        const product = await Product.create({
            ...normalized.product,
            isPublished: true,
            catalogVersion: activeVersion,
        });
        return product;
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw mapDuplicateToAppError(error);
        }
        throw error;
    }
};

const updateManualProduct = async (identifier, payload) => {
    const existing = await getProductByIdentifier(identifier);
    if (!existing) throw new AppError('Product not found', 404);

    const merged = {
        ...existing.toObject(),
        ...payload,
        externalId: existing.externalId,
        source: existing.source || 'manual',
        catalogVersion: existing.catalogVersion,
    };
    const normalized = normalizeProductRecord({
        raw: merged,
        defaultSource: existing.source || 'manual',
        catalogVersion: existing.catalogVersion,
        forSync: false,
    });
    if (normalized.error) {
        throw new AppError(normalized.error.message, 400);
    }

    const duplicate = await Product.findOne({
        _id: { $ne: existing._id },
        $or: [
            { titleKey: normalized.product.titleKey },
            { imageKey: normalized.product.imageKey },
        ],
    }).select('_id titleKey imageKey').lean();
    if (duplicate?.titleKey === normalized.product.titleKey) {
        throw new AppError('Product name already exists. Use a unique product name.', 409);
    }
    if (duplicate?.imageKey === normalized.product.imageKey) {
        throw new AppError('Product image already exists. Use a unique image URL.', 409);
    }

    try {
        Object.assign(existing, normalized.product);
        await existing.save();
        return existing;
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw mapDuplicateToAppError(error);
        }
        throw error;
    }
};

const deleteManualProduct = async (identifier) => {
    const existing = await getProductByIdentifier(identifier);
    if (!existing) throw new AppError('Product not found', 404);
    await Product.deleteOne({ _id: existing._id });
    return { message: 'Product removed' };
};

const pushError = (errors, row, code, message) => {
    if (errors.length >= MAX_ERROR_SAMPLE) return;
    errors.push({ row, code, message: safeString(message).slice(0, 300) });
};

const bulkUpsertProducts = async ({ docs, catalogVersion }) => {
    if (docs.length === 0) {
        return { inserted: 0, updated: 0, skipped: 0 };
    }

    const localTitleKeys = new Set();
    const localImageKeys = new Set();
    for (const doc of docs) {
        const titleKey = normalizeTitleKey(doc.titleKey || doc.title);
        const imageKey = normalizeImageKey(doc.imageKey || doc.image);
        doc.titleKey = titleKey;
        doc.imageKey = imageKey;

        if (localTitleKeys.has(titleKey)) {
            throw new AppError('Import batch contains duplicate product names. Every product name must be unique.', 409);
        }
        if (localImageKeys.has(imageKey)) {
            throw new AppError('Import batch contains duplicate product images. Every product image must be unique.', 409);
        }
        localTitleKeys.add(titleKey);
        localImageKeys.add(imageKey);
    }

    const orFilters = docs.map((doc) => ({
        externalId: doc.externalId,
        source: doc.source,
        catalogVersion,
    }));

    const existing = await Product.find({ $or: orFilters })
        .select('_id externalId source catalogVersion ingestHash')
        .lean();

    const existingMap = new Map(
        existing.map((doc) => [`${doc.externalId}|${doc.source}|${doc.catalogVersion}`, doc])
    );
    const existingIdentity = await Product.find({
        $or: [
            { titleKey: { $in: [...localTitleKeys] } },
            { imageKey: { $in: [...localImageKeys] } },
        ],
    }).select('_id externalId source catalogVersion titleKey imageKey').lean();
    const existingByTitleKey = new Map();
    const existingByImageKey = new Map();
    for (const row of existingIdentity) {
        if (row.titleKey) {
            const key = row.titleKey;
            const list = existingByTitleKey.get(key) || [];
            list.push(row);
            existingByTitleKey.set(key, list);
        }
        if (row.imageKey) {
            const key = row.imageKey;
            const list = existingByImageKey.get(key) || [];
            list.push(row);
            existingByImageKey.set(key, list);
        }
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const now = new Date();
    const operations = [];

    for (const doc of docs) {
        const key = `${doc.externalId}|${doc.source}|${catalogVersion}`;
        const found = existingMap.get(key);
        const foundId = found?._id ? String(found._id) : null;

        const titleCollisions = existingByTitleKey.get(doc.titleKey) || [];
        const titleConflict = titleCollisions.find((entry) => String(entry._id) !== foundId);
        if (titleConflict) {
            throw new AppError('Duplicate product name detected in existing catalog. Import aborted to preserve strict uniqueness.', 409);
        }

        const imageCollisions = existingByImageKey.get(doc.imageKey) || [];
        const imageConflict = imageCollisions.find((entry) => String(entry._id) !== foundId);
        if (imageConflict) {
            throw new AppError('Duplicate product image detected in existing catalog. Import aborted to preserve strict uniqueness.', 409);
        }

        if (found && found.ingestHash === doc.ingestHash) {
            skipped += 1;
            continue;
        }

        if (found) {
            updated += 1;
            operations.push({
                updateOne: {
                    filter: { _id: found._id },
                    update: { $set: { ...doc, updatedAt: now } },
                },
            });
        } else {
            inserted += 1;
            operations.push({
                updateOne: {
                    filter: {
                        externalId: doc.externalId,
                        source: doc.source,
                        catalogVersion,
                    },
                    update: {
                        $set: { ...doc, updatedAt: now },
                        $setOnInsert: { createdAt: now },
                    },
                    upsert: true,
                },
            });
        }
    }

    if (operations.length > 0) {
        try {
            await Product.bulkWrite(operations, { ordered: false });
        } catch (error) {
            if (isDuplicateKeyError(error)) {
                throw mapDuplicateToAppError(error);
            }
            throw error;
        }
    }

    return { inserted, updated, skipped };
};

const runImportPipeline = async ({
    sourceType,
    sourceRef,
    catalogVersion,
    sourceLabel = 'batch',
}) => {
    const totals = {
        totalRows: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
    };
    const errors = [];
    let batch = [];

    const flushBatch = async () => {
        if (batch.length === 0) return;
        const result = await bulkUpsertProducts({
            docs: batch,
            catalogVersion,
        });
        totals.inserted += result.inserted;
        totals.updated += result.updated;
        totals.skipped += result.skipped;
        batch = [];
    };

    for await (const row of streamRowsFromSource(sourceType, sourceRef)) {
        totals.totalRows += 1;
        if (totals.totalRows > MAX_ROWS_PER_IMPORT) {
            throw new AppError(`Import exceeded max rows (${MAX_ROWS_PER_IMPORT})`, 400);
        }

        const normalized = normalizeProductRecord({
            raw: row.data,
            defaultSource: sourceLabel,
            catalogVersion,
            forSync: sourceLabel === 'provider',
        });
        if (normalized.error) {
            totals.failed += 1;
            pushError(errors, row.row, normalized.error.code, normalized.error.message);
            continue;
        }

        batch.push(normalized.product);
        if (batch.length >= IMPORT_BATCH_SIZE) {
            await flushBatch();
        }
    }

    await flushBatch();
    return { totals, errors };
};

const createCatalogImportJob = async ({
    sourceType,
    sourceRef,
    mode = 'batch',
    initiatedBy = '',
    idempotencyKey = '',
    requestId = '',
    userId = null,
}) => {
    if (!flags.catalogImportsEnabled) {
        throw new AppError('Catalog imports are currently disabled', 403);
    }

    const catalogVersion = `cat_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const job = await CatalogImportJob.create({
        jobId: makeId('imp'),
        status: 'pending',
        sourceType: safeLower(sourceType, 'jsonl'),
        sourceRef: safeString(sourceRef),
        mode: safeString(mode || 'batch'),
        initiatedBy: safeString(initiatedBy),
        user: userId || null,
        requestId: safeString(requestId),
        idempotencyKey: safeString(idempotencyKey),
        catalogVersion,
        publishable: false,
        startedAt: new Date(),
    });

    return job;
};

const markImportJobFinished = async ({ job, status, totals, errors }) => {
    job.status = status;
    job.totals = totals;
    job.errorCount = totals.failed;
    job.errorSample = errors;
    job.publishable = totals.totalRows > 0 && (totals.failed / totals.totalRows) <= 0.1;
    job.finishedAt = new Date();
    job.lockedAt = null;
    job.lockedBy = null;
    await job.save();

    if (['completed', 'completed_with_errors'].includes(status)) {
        await SystemState.updateOne(
            { key: DEFAULT_SYSTEM_KEY },
            { $set: { catalogLastImportAt: new Date() } },
            { upsert: true }
        );
    }
};

const processCatalogImportJobById = async (jobId) => {
    const job = await CatalogImportJob.findOne({ jobId });
    if (!job) throw new AppError('Catalog import job not found', 404);
    if (!['pending', 'processing'].includes(job.status)) {
        return job;
    }

    if (job.status === 'pending') {
        job.status = 'processing';
        job.lockedAt = new Date();
        job.lockedBy = WORKER_ID;
        job.startedAt = job.startedAt || new Date();
        await job.save();
    }

    try {
        const { totals, errors } = await runImportPipeline({
            sourceType: job.sourceType,
            sourceRef: job.sourceRef,
            catalogVersion: job.catalogVersion,
            sourceLabel: job.mode === 'provider' ? 'provider' : 'batch',
        });

        const status = totals.failed > 0 ? 'completed_with_errors' : 'completed';
        await markImportJobFinished({ job, status, totals, errors });
        return job;
    } catch (error) {
        const message = error instanceof AppError ? error.message : 'Catalog import failed';
        const totals = job.totals || {
            totalRows: 0, inserted: 0, updated: 0, skipped: 0, failed: 0,
        };
        totals.failed += 1;
        const errors = Array.isArray(job.errorSample) ? [...job.errorSample] : [];
        pushError(errors, totals.totalRows || 0, 'IMPORT_FAILED', message);
        await markImportJobFinished({
            job,
            status: 'failed',
            totals,
            errors,
        });
        throw error;
    }
};

const publishCatalogVersion = async (jobId) => {
    const job = await CatalogImportJob.findOne({ jobId });
    if (!job) throw new AppError('Catalog import job not found', 404);
    if (!job.publishable) {
        throw new AppError('Catalog import is not publishable. Resolve import errors first.', 409);
    }
    if (job.status === 'published') {
        const state = await getSystemState();
        return {
            publishedVersion: state.activeCatalogVersion,
            switchedAt: state.lastSwitchAt,
            oldVersionRetained: state.previousCatalogVersion || null,
        };
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const state = await SystemState.findOneAndUpdate(
            { key: DEFAULT_SYSTEM_KEY },
            { $setOnInsert: { key: DEFAULT_SYSTEM_KEY } },
            { new: true, upsert: true, session, setDefaultsOnInsert: true }
        );

        const previousVersion = state.activeCatalogVersion || '';
        const nextVersion = job.catalogVersion;

        if (previousVersion && previousVersion !== nextVersion) {
            await Product.updateMany(
                { catalogVersion: previousVersion },
                { $set: { isPublished: false } },
                { session }
            );
        }

        await Product.updateMany(
            { catalogVersion: nextVersion },
            { $set: { isPublished: true } },
            { session }
        );

        state.previousCatalogVersion = previousVersion || '';
        state.activeCatalogVersion = nextVersion;
        state.lastSwitchAt = new Date();
        await state.save({ session });

        job.status = 'published';
        job.publishedAt = new Date();
        await job.save({ session });

        await session.commitTransaction();
        session.endSession();

        const keepVersions = [nextVersion];
        if (previousVersion && previousVersion !== nextVersion) keepVersions.push(previousVersion);
        await Product.deleteMany({ catalogVersion: { $nin: keepVersions } });

        return {
            publishedVersion: nextVersion,
            switchedAt: state.lastSwitchAt,
            oldVersionRetained: previousVersion || null,
        };
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw error;
    }
};

const createCatalogSyncRun = async ({
    provider,
    cursor,
    idempotencyKey = '',
    requestId = '',
    userId = null,
}) => {
    if (!flags.catalogSyncEnabled) {
        throw new AppError('Catalog sync is currently disabled', 403);
    }

    const normalizedProvider = safeLower(provider, flags.catalogDefaultSyncProvider);
    return CatalogSyncRun.create({
        syncRunId: makeId('sync'),
        provider: normalizedProvider,
        cursorInput: safeString(cursor),
        status: 'pending',
        idempotencyKey: safeString(idempotencyKey),
        requestId: safeString(requestId),
        user: userId || null,
        startedAt: new Date(),
    });
};

const upsertCatalogSyncCursor = async ({ provider, cursor, success, errorMessage = '' }) => {
    const setData = {
        lastRunAt: new Date(),
        ...(success ? { lastSuccessAt: new Date(), cursor, lastError: '', failCount: 0 } : { lastError: errorMessage.slice(0, 200) }),
    };

    const update = success
        ? { $set: setData }
        : { $set: setData, $inc: { failCount: 1 } };

    await CatalogSyncCursor.updateOne(
        { provider },
        update,
        { upsert: true }
    );
};

const claimNextPendingImportJob = async () => CatalogImportJob.findOneAndUpdate(
    { status: 'pending' },
    {
        $set: {
            status: 'processing',
            lockedAt: new Date(),
            lockedBy: WORKER_ID,
            startedAt: new Date(),
        },
    },
    { sort: { createdAt: 1 }, new: true }
);

const claimNextPendingSyncRun = async () => CatalogSyncRun.findOneAndUpdate(
    { status: 'pending' },
    {
        $set: {
            status: 'processing',
            lockedAt: new Date(),
            lockedBy: WORKER_ID,
            startedAt: new Date(),
        },
    },
    { sort: { createdAt: 1 }, new: true }
);

const processCatalogSyncRunById = async (syncRunId) => {
    const run = await CatalogSyncRun.findOne({ syncRunId });
    if (!run) throw new AppError('Catalog sync run not found', 404);
    if (run.status !== 'pending' && run.status !== 'processing') {
        return run;
    }

    if (run.status === 'pending') {
        run.status = 'processing';
        run.lockedAt = new Date();
        run.lockedBy = WORKER_ID;
        await run.save();
    }

    try {
        const cursorDoc = await CatalogSyncCursor.findOne({ provider: run.provider }).lean();
        const cursorFromState = run.cursorInput || cursorDoc?.cursor || '';
        const sourceRef = getProviderSourceRef(run.provider);
        if (!sourceRef) {
            throw new AppError('CATALOG_PROVIDER_SOURCE_REF is not configured for sync provider', 400);
        }

        const baseVersion = await getActiveCatalogVersion();
        const nextVersion = `sync_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

        await Product.aggregate([
            {
                $match: {
                    catalogVersion: baseVersion,
                    isPublished: true,
                },
            },
            {
                $unset: '_id',
            },
            {
                $set: {
                    catalogVersion: nextVersion,
                    isPublished: false,
                    updatedAt: new Date(),
                },
            },
            {
                $merge: {
                    into: 'products',
                    on: ['externalId', 'source', 'catalogVersion'],
                    whenMatched: 'replace',
                    whenNotMatched: 'insert',
                },
            },
        ]);

        const { totals, errors } = await runImportPipeline({
            sourceType: 'jsonl',
            sourceRef,
            catalogVersion: nextVersion,
            sourceLabel: 'provider',
        });

        run.totals = {
            processed: totals.totalRows,
            inserted: totals.inserted,
            updated: totals.updated,
            skipped: totals.skipped,
            failed: totals.failed,
        };
        run.errorSample = errors;
        run.cursorOutput = new Date().toISOString();
        run.finishedAt = new Date();
        run.lockedAt = null;
        run.lockedBy = null;

        if (totals.failed > 0) {
            run.status = 'completed_with_errors';
            await run.save();
            await upsertCatalogSyncCursor({
                provider: run.provider,
                cursor: cursorFromState,
                success: false,
                errorMessage: 'sync completed with row-level errors',
            });
            return run;
        }

        const fakeJob = await CatalogImportJob.create({
            jobId: makeId('syncpub'),
            status: 'completed',
            sourceType: 'jsonl',
            sourceRef,
            mode: 'provider',
            initiatedBy: 'system-sync',
            catalogVersion: nextVersion,
            totals: {
                totalRows: totals.totalRows,
                inserted: totals.inserted,
                updated: totals.updated,
                skipped: totals.skipped,
                failed: totals.failed,
            },
            publishable: true,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            user: run.user || null,
            requestId: run.requestId || '',
        });

        await publishCatalogVersion(fakeJob.jobId);

        run.status = 'completed';
        await run.save();
        await upsertCatalogSyncCursor({
            provider: run.provider,
            cursor: run.cursorOutput,
            success: true,
        });
        await SystemState.updateOne(
            { key: DEFAULT_SYSTEM_KEY },
            { $set: { catalogLastSyncAt: new Date() } },
            { upsert: true }
        );
        return run;
    } catch (error) {
        run.status = 'failed';
        run.finishedAt = new Date();
        run.lockedAt = null;
        run.lockedBy = null;
        run.errorSample = [...(run.errorSample || []), {
            row: 0,
            code: 'SYNC_FAILED',
            message: safeString(error.message).slice(0, 300),
        }].slice(-MAX_ERROR_SAMPLE);
        await run.save();
        await upsertCatalogSyncCursor({
            provider: run.provider,
            cursor: run.cursorInput || '',
            success: false,
            errorMessage: error.message || 'sync failed',
        });
        throw error;
    }
};

const releaseStaleCatalogLocks = async () => {
    const lockExpiry = new Date(Date.now() - LOCK_EXPIRY_MS);
    await Promise.all([
        CatalogImportJob.updateMany(
            { status: 'processing', lockedAt: { $lt: lockExpiry } },
            { $set: { status: 'pending', lockedAt: null, lockedBy: null } }
        ),
        CatalogSyncRun.updateMany(
            { status: 'processing', lockedAt: { $lt: lockExpiry } },
            { $set: { status: 'pending', lockedAt: null, lockedBy: null } }
        ),
    ]);
};

const runCatalogImportWorkerCycle = async () => {
    if (!flags.catalogImportsEnabled || importWorkerPausedByQuota) return;
    try {
        await releaseStaleCatalogLocks();

        for (let i = 0; i < 3; i += 1) {
            const job = await claimNextPendingImportJob();
            if (!job) break;
            try {
                await processCatalogImportJobById(job.jobId);
            } catch (error) {
                if (pauseCatalogWorkerIfQuotaBlocked({ worker: 'import', error })) return;
                logger.error('catalog.import.worker_failed', {
                    jobId: job.jobId,
                    error: error.message,
                });
            }
        }
    } catch (error) {
        if (pauseCatalogWorkerIfQuotaBlocked({ worker: 'import', error })) return;
        throw error;
    }
};

const runCatalogSyncWorkerCycle = async () => {
    if (!flags.catalogSyncEnabled || syncWorkerPausedByQuota) return;
    try {
        await releaseStaleCatalogLocks();

        const run = await claimNextPendingSyncRun();
        if (run) {
            try {
                await processCatalogSyncRunById(run.syncRunId);
            } catch (error) {
                if (pauseCatalogWorkerIfQuotaBlocked({ worker: 'sync', error })) return;
                logger.error('catalog.sync.worker_failed', {
                    syncRunId: run.syncRunId,
                    error: error.message,
                });
            }
        }
    } catch (error) {
        if (pauseCatalogWorkerIfQuotaBlocked({ worker: 'sync', error })) return;
        throw error;
    }
};

const startCatalogWorkers = () => {
    resetWorkerPauseFlags();

    if (flags.catalogImportsEnabled && !importWorkerTimer) {
        importWorkerTimer = setInterval(() => {
            runCatalogImportWorkerCycle().catch((error) => {
                logger.error('catalog.import.cycle_failed', { error: error.message });
            });
        }, flags.catalogImportWorkerPollMs);
    }

    if (flags.catalogSyncEnabled && !syncWorkerTimer) {
        syncWorkerTimer = setInterval(() => {
            runCatalogSyncWorkerCycle().catch((error) => {
                logger.error('catalog.sync.cycle_failed', { error: error.message });
            });
        }, flags.catalogSyncIntervalMs);
    }
};

const stopCatalogWorkersForTests = () => {
    if (importWorkerTimer) {
        clearInterval(importWorkerTimer);
        importWorkerTimer = null;
    }
    if (syncWorkerTimer) {
        clearInterval(syncWorkerTimer);
        syncWorkerTimer = null;
    }
};

const getCatalogImportJob = async (jobId) => {
    const job = await CatalogImportJob.findOne({ jobId }).lean();
    if (!job) throw new AppError('Catalog import job not found', 404);
    return job;
};

const getCatalogHealth = async () => {
    const state = await getSystemState();
    const [pendingImports, processingImports, pendingSyncRuns, processingSyncRuns, lastSyncCursor] = await Promise.all([
        CatalogImportJob.countDocuments({ status: 'pending' }),
        CatalogImportJob.countDocuments({ status: 'processing' }),
        CatalogSyncRun.countDocuments({ status: 'pending' }),
        CatalogSyncRun.countDocuments({ status: 'processing' }),
        CatalogSyncCursor.findOne({ provider: flags.catalogDefaultSyncProvider }).lean(),
    ]);

    const now = Date.now();
    const lastImportAt = state.catalogLastImportAt ? new Date(state.catalogLastImportAt).getTime() : null;
    const lastSyncAt = state.catalogLastSyncAt ? new Date(state.catalogLastSyncAt).getTime() : null;
    const importAgeSec = lastImportAt ? Math.floor((now - lastImportAt) / 1000) : null;
    const syncAgeSec = lastSyncAt ? Math.floor((now - lastSyncAt) / 1000) : null;
    const queueLagSec = Math.max(
        pendingImports * 5,
        processingImports * 5,
        pendingSyncRuns * 30,
        processingSyncRuns * 30
    );
    const syncPolicyActive = flags.catalogSyncEnabled && Boolean(flags.catalogProviderSourceRef);

    return {
        activeVersion: state.activeCatalogVersion || 'legacy-v1',
        previousVersion: state.previousCatalogVersion || null,
        lastSuccessfulImportAt: state.catalogLastImportAt || null,
        lastSuccessfulSyncAt: state.catalogLastSyncAt || null,
        lastImportAgeSec: importAgeSec,
        lastSyncAgeSec: syncAgeSec,
        queueLagSec,
        staleData: syncPolicyActive ? (syncAgeSec !== null && syncAgeSec > 30 * 60) : false,
        searchProviderStatus: (atlasSearchSupported === null ? 'unknown' : (atlasSearchSupported ? 'ok' : 'degraded')),
        syncCursor: lastSyncCursor?.cursor || '',
        workers: {
            importWorkerRunning: Boolean(importWorkerTimer),
            syncWorkerRunning: Boolean(syncWorkerTimer),
            ...getWorkerPauseReason(),
        },
    };
};

module.exports = {
    assertSearchAvailable,
    enforceCatalogStartupCheck,
    getActiveCatalogVersion,
    queryProducts,
    getProductByIdentifier,
    createManualProduct,
    updateManualProduct,
    deleteManualProduct,
    createCatalogImportJob,
    processCatalogImportJobById,
    publishCatalogVersion,
    createCatalogSyncRun,
    processCatalogSyncRunById,
    runCatalogImportWorkerCycle,
    runCatalogSyncWorkerCycle,
    startCatalogWorkers,
    stopCatalogWorkersForTests,
    getCatalogImportJob,
    getCatalogHealth,
    ensureSystemState,
};
