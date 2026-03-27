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
const { prepareCatalogSnapshotForImport } = require('./catalogSnapshotService');
const {
    ensureMarketAccess,
    isProductRestrictedForMarket,
} = require('./markets/marketCatalog');
const { convertDisplayAmountToBaseAmount } = require('./markets/marketPricing');

// — Domain modules extracted from this file —
const {
    safeString, safeLower, safeNumber, toInt, makeId, hashValue,
    escapeRegExp, clonePlain, isSystemStateWriteBlocked, isDuplicateKeyError,
    mapDuplicateToAppError,
} = require('../utils/catalogUtils');
const { normalizeProductRecord } = require('./catalog/normalizer');

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
const BASE_PRODUCT_FILTER_CACHE_TTL_MS = 15 * 1000;
const PRODUCT_IDENTIFIER_CACHE_TTL_MS = 30 * 1000;
const PRODUCT_LIST_PROJECTION = {
    searchText: 0,
    titleKey: 0,
    imageKey: 0,
    ingestHash: 0,
    description: 0,
    specifications: 0,
    images: 0,
    categoryPaths: 0,
    contentQuality: 0,
    createdAt: 0,
    updatedAt: 0,
    __v: 0,
};

let importWorkerTimer = null;
let syncWorkerTimer = null;
let atlasSearchSupported = null;
let systemStateWriteBlocked = false;
let systemStateFallbackDoc = null;
let systemStateFallbackWarned = false;
let importWorkerPausedByQuota = false;
let syncWorkerPausedByQuota = false;
let publicDemoFallbackWarned = false;
let baseProductFilterCache = {
    value: null,
    cachedAt: 0,
    promise: null,
};
const productIdentifierCache = new Map();


const getProviderSourceRef = (provider) => {
    const normalized = safeLower(provider, flags.catalogDefaultSyncProvider);
    const envKey = `CATALOG_PROVIDER_SOURCE_REF_${normalized.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    return safeString(process.env[envKey] || flags.catalogProviderSourceRef);
};

const getProviderManifestRef = (provider) => {
    const normalized = safeLower(provider, flags.catalogDefaultSyncProvider);
    const envKey = `CATALOG_PROVIDER_MANIFEST_REF_${normalized.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    return safeString(process.env[envKey] || process.env.CATALOG_PROVIDER_MANIFEST_REF || '');
};

const toJobSnapshotManifest = (manifest = {}, fallbackSourceType = '') => ({
    providerName: safeString(manifest.providerName || ''),
    feedVersion: safeString(manifest.feedVersion || ''),
    exportTimestamp: manifest.exportTimestamp ? new Date(manifest.exportTimestamp) : null,
    schemaVersion: safeString(manifest.schemaVersion || ''),
    recordCount: toInt(manifest.recordCount, 0),
    sha256: safeString(manifest.sha256 || ''),
    sourceUrl: safeString(manifest.sourceUrl || ''),
    sourceRef: safeString(manifest.sourceRef || ''),
    sourceType: safeString(manifest.sourceType || fallbackSourceType || ''),
});

const toJobSourceValidation = (validation = {}) => ({
    readyForImport: Boolean(validation.readyForImport),
    manifestMatchesSource: Boolean(validation.manifestMatchesSource),
    checksumMatches: Boolean(validation.checksumMatches),
    computedSha256: safeString(validation.computedSha256 || ''),
    sampleSize: toInt(validation.sampleSize, 0),
    missingFieldCoverage: Array.isArray(validation.missingFieldCoverage)
        ? validation.missingFieldCoverage.map((entry) => safeString(entry)).filter(Boolean)
        : [],
    checkedAt: validation.checkedAt ? new Date(validation.checkedAt) : null,
});

const deriveFallbackActiveCatalogVersion = async () => {
    const published = await Product.findOne({
        isPublished: true,
        catalogVersion: { $exists: true, $ne: '' },
    })
        .sort({ updatedAt: -1, createdAt: -1 })
        .select('catalogVersion')
        .lean();

    if (published?.catalogVersion) {
        return published.catalogVersion;
    }

    const newest = await Product.findOne({
        catalogVersion: { $exists: true, $ne: '' },
    })
        .sort({ updatedAt: -1, createdAt: -1 })
        .select('catalogVersion')
        .lean();

    return newest?.catalogVersion || 'legacy-v1';
};


const invalidateBaseProductFilterCache = () => {
    baseProductFilterCache = {
        value: null,
        cachedAt: 0,
        promise: null,
    };
};

const invalidateProductIdentifierCache = (identifier = null) => {
    if (identifier === null || identifier === undefined || identifier === '') {
        productIdentifierCache.clear();
        return;
    }

    const trimmed = safeString(identifier);
    if (!trimmed) return;

    buildIdentifierOrClauses(trimmed).forEach((clause) => {
        const [[key, value]] = Object.entries(clause || {});
        if (!key || value === undefined || value === null) return;
        productIdentifierCache.delete(`${key}:${String(value)}`);
    });
};

const invalidateCatalogReadCaches = (identifier = null) => {
    invalidateBaseProductFilterCache();
    invalidateProductIdentifierCache(identifier);
};

const readCachedIdentifierValue = (identifier) => {
    const now = Date.now();
    const clauses = buildIdentifierOrClauses(identifier);

    for (const clause of clauses) {
        const [[key, value]] = Object.entries(clause || {});
        const cacheKey = `${key}:${String(value)}`;
        const cached = productIdentifierCache.get(cacheKey);
        if (!cached) continue;

        if (cached.value !== undefined && cached.expiresAt > now) {
            return clonePlain(cached.value);
        }

        if (cached.promise) {
            return cached.promise.then((result) => clonePlain(result));
        }

        productIdentifierCache.delete(cacheKey);
    }

    return null;
};

const cacheIdentifierValue = (identifier, value) => {
    const expiresAt = Date.now() + PRODUCT_IDENTIFIER_CACHE_TTL_MS;
    const clauses = buildIdentifierOrClauses(identifier);
    const keys = new Set();

    clauses.forEach((clause) => {
        const [[key, rawValue]] = Object.entries(clause || {});
        if (key && rawValue !== undefined && rawValue !== null) {
            keys.add(`${key}:${String(rawValue)}`);
        }
    });

    const hydratedValue = value && typeof value === 'object' ? value : null;
    if (hydratedValue?._id) keys.add(`_id:${String(hydratedValue._id)}`);
    if (hydratedValue?.externalId) keys.add(`externalId:${String(hydratedValue.externalId)}`);
    if (hydratedValue?.id !== undefined && hydratedValue?.id !== null) {
        keys.add(`id:${String(hydratedValue.id)}`);
    }

    keys.forEach((cacheKey) => {
        productIdentifierCache.set(cacheKey, {
            value: clonePlain(value),
            expiresAt,
        });
    });
};

const buildProductReadProjection = ({ includeDetails = false } = {}) => (
    includeDetails ? undefined : PRODUCT_LIST_PROJECTION
);

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
        
        const cleanup = () => {
            rl.close();
            stream.destroy();
        };

        try {
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
        } finally {
            cleanup();
        }
        return;
    }

    if (effectiveType === 'csv') {
        const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        
        const cleanup = () => {
            rl.close();
            stream.destroy();
        };

        try {
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
        } finally {
            cleanup();
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

const PLACEHOLDER_IMAGE_PATTERNS = [
    /via\.placeholder\.com/i,
    /picsum\.photos/i,
    /placehold\.co/i,
    /dummyimage\.com/i,
];

const detectCatalogSourceType = ({ source, sourceRef }) => {
    const normalizedSource = safeLower(source, 'batch');
    const normalizedSourceRef = safeLower(sourceRef);

    if (normalizedSource === 'manual') return 'first_party';
    if (normalizedSource === 'provider') return 'provider';
    if (
        normalizedSourceRef.includes('catalog_1m.jsonl')
        || normalizedSourceRef.includes('demo_catalog')
        || normalizedSourceRef.includes('synthetic_catalog')
    ) return 'dev_seed';
    if (normalizedSource === 'batch') return 'batch';
    return 'unknown';
};

const buildCatalogQualitySignals = ({
    raw = {},
    source,
    sourceRef = '',
    snapshotManifest = null,
    title,
    brand,
    description,
    specifications,
    highlights,
    image,
    warranty,
}) => {
    const integrity = analyzeCatalogRecord({
        ...raw,
        title,
        description,
        image,
    });
    const sourceType = detectCatalogSourceType({ source, sourceRef });
    const specCount = Array.isArray(specifications) ? specifications.length : 0;
    const highlightCount = Array.isArray(highlights) ? highlights.length : 0;
    const hasDescription = safeString(description).length >= 40;
    const hasSpecifications = specCount >= 3;
    const hasBrand = safeString(brand).length > 0 && safeLower(brand) !== 'unknown';
    const hasImage = Boolean(safeString(image)) && !PLACEHOLDER_IMAGE_PATTERNS.some((pattern) => pattern.test(safeString(image)));
    const hasWarranty = safeString(warranty).length > 0;
    const issues = [];

    if (!hasDescription) issues.push('missing_description');
    if (!hasSpecifications) issues.push('thin_specifications');
    if (!hasBrand) issues.push('missing_brand');
    if (!hasImage) issues.push('untrusted_image');
    if (integrity.looksSynthetic) issues.push('synthetic_signature');
    if (sourceType === 'dev_seed') issues.push('dev_seed_catalog');

    const completenessScore = Math.max(0, Math.min(100, Math.round(
        (hasDescription ? 30 : 0)
        + (hasSpecifications ? 30 : Math.min(specCount * 8, 24))
        + (highlightCount > 0 ? Math.min(highlightCount * 6, 18) : 0)
        + (hasBrand ? 10 : 0)
        + (hasImage ? 20 : 0)
        + (hasWarranty ? 5 : 0)
    )));

    const trustTier = sourceType === 'first_party'
        ? 'first_party'
        : (sourceType === 'provider'
            ? 'verified'
            : (sourceType === 'dev_seed'
                ? 'unverified'
                : (completenessScore >= 75 ? 'curated' : 'unverified')));

    const datasetClass = integrity.looksSynthetic
        ? 'synthetic'
        : (sourceType === 'dev_seed' ? 'mixed' : 'real');
    const publishReady = !integrity.looksSynthetic
        && sourceType !== 'dev_seed'
        && completenessScore >= 70
        && hasImage
        && hasDescription;

    const publishStatus = integrity.looksSynthetic
        ? 'rejected'
        : (sourceType === 'dev_seed'
            ? 'dev_only'
            : (publishReady ? 'approved' : 'pending'));
    const publishReason = integrity.looksSynthetic
        ? 'synthetic_signals_detected'
        : (sourceType === 'dev_seed'
            ? 'dev_test_catalog_only'
            : (publishReady ? 'ready_for_publish' : 'content_quality_review_required'));
    const observedAt = raw?.updatedAt || raw?.observedAt || raw?.publishedAt || null;
    const observedAtDate = observedAt ? new Date(observedAt) : null;

    return {
        provenance: {
            sourceName: safeString(snapshotManifest?.providerName || raw.provider || raw.sourceName || raw.source || source || 'catalog'),
            sourceType,
            sourceRef: safeString(snapshotManifest?.sourceUrl || snapshotManifest?.sourceRef || sourceRef || raw.sourceRef || ''),
            trustTier,
            datasetClass,
            feedVersion: safeString(snapshotManifest?.feedVersion || ''),
            schemaVersion: safeString(snapshotManifest?.schemaVersion || ''),
            manifestSha256: safeString(snapshotManifest?.sha256 || ''),
            observedAt: observedAtDate instanceof Date && Number.isFinite(observedAtDate.getTime()) ? observedAtDate : null,
            ingestedAt: new Date(),
            imageSourceType: hasImage ? 'real' : (safeString(image) ? 'placeholder' : 'unknown'),
        },
        contentQuality: {
            completenessScore,
            specCount,
            highlightCount,
            hasDescription,
            hasSpecifications,
            hasBrand,
            hasImage,
            hasWarranty,
            syntheticScore: integrity.suspiciousScore,
            syntheticRejected: integrity.looksSynthetic,
            publishReady,
            issues,
        },
        publishGate: {
            status: publishStatus,
            reason: publishReason,
            checkedAt: new Date(),
        },
    };
};

const ensureSystemState = async () => {
    await Product.syncProductIndexes();
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
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );
    } catch (error) {
        if (!isSystemStateWriteBlocked(error)) throw error;

        systemStateWriteBlocked = true;
        const fallbackActiveCatalogVersion = await deriveFallbackActiveCatalogVersion();
        if (!systemStateFallbackDoc) {
            systemStateFallbackDoc = {
                key: DEFAULT_SYSTEM_KEY,
                activeCatalogVersion: fallbackActiveCatalogVersion,
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
        const fallbackActiveCatalogVersion = await deriveFallbackActiveCatalogVersion();
        systemStateFallbackDoc = {
            ...getFallbackSystemState(),
            activeCatalogVersion: fallbackActiveCatalogVersion,
        };
        return systemStateFallbackDoc;
    }
};

const getSystemState = async () => getSystemStateWithFallback();

const getActiveCatalogVersion = async () => {
    const state = await getSystemState();
    return state.activeCatalogVersion || 'legacy-v1';
};

const findLatestDevOnlyCatalogVersion = async () => {
    const latestDemo = await Product.findOne({
        'publishGate.status': 'dev_only',
        catalogVersion: { $exists: true, $ne: '' },
    })
        .sort({ updatedAt: -1, createdAt: -1 })
        .select('catalogVersion')
        .lean();

    return latestDemo?.catalogVersion || '';
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
        logger.warn('catalog.startup_gate.search_unavailable', {
            message: `Atlas Search index "${flags.catalogSearchIndexName}" is unavailable. Falling back to regex search.`,
        });
    }
};

const resolveCatalogReadMode = (baseFilter = {}) => {
    if (baseFilter?.['publishGate.status'] === 'dev_only') {
        return 'demo_preview';
    }

    if (baseFilter?.isPublished === true) {
        return 'published_only';
    }

    return 'unrestricted';
};

const buildBaseProductFilterFresh = async ({ allowDemoFallback = false } = {}) => {
    if (!flags.catalogActiveVersionRequired) return {};
    const activeCatalogVersion = await getActiveCatalogVersion();
    const publishedInActiveCatalog = await Product.findOne({
        catalogVersion: activeCatalogVersion,
        isPublished: true,
    })
        .select('_id')
        .lean();

    if (publishedInActiveCatalog) {
        return {
            catalogVersion: activeCatalogVersion,
            isPublished: true,
        };
    }

    if (!allowDemoFallback || !flags.catalogPublicDemoFallback) {
        return {
            catalogVersion: activeCatalogVersion,
            isPublished: true,
        };
    }

    const demoCatalogVersion = await findLatestDevOnlyCatalogVersion();
    if (demoCatalogVersion) {
        if (!publicDemoFallbackWarned) {
            logger.warn('catalog.public_demo_fallback_enabled', {
                activeCatalogVersion,
                demoCatalogVersion,
            });
            publicDemoFallbackWarned = true;
        }

        return {
            catalogVersion: demoCatalogVersion,
            'publishGate.status': 'dev_only',
        };
    }

    return {
        catalogVersion: activeCatalogVersion,
        isPublished: true,
    };
};

const buildBaseProductFilter = async (options = {}) => {
    if (!flags.catalogActiveVersionRequired) return {};
    if (options.allowDemoFallback === true) {
        return buildBaseProductFilterFresh({ allowDemoFallback: true });
    }

    const cacheAge = Date.now() - Number(baseProductFilterCache.cachedAt || 0);
    if (baseProductFilterCache.value && cacheAge < BASE_PRODUCT_FILTER_CACHE_TTL_MS) {
        return { ...baseProductFilterCache.value };
    }

    if (baseProductFilterCache.promise) {
        const cachedValue = await baseProductFilterCache.promise;
        return { ...cachedValue };
    }

    const pending = (async () => {
        const nextValue = await buildBaseProductFilterFresh();
        baseProductFilterCache.value = nextValue;
        baseProductFilterCache.cachedAt = Date.now();
        return nextValue;
    })();

    baseProductFilterCache.promise = pending;

    try {
        const nextValue = await pending;
        return { ...nextValue };
    } finally {
        if (baseProductFilterCache.promise === pending) {
            baseProductFilterCache.promise = null;
        }
    }
};

const buildFilterFromQuery = async (query = {}, { market = null } = {}) => {
    const filter = {};
    const activeMarket = market ? ensureMarketAccess(market) : null;

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
        filter.price = {};
        if (query.minPrice !== undefined) {
            filter.price.$gte = activeMarket
                ? await convertDisplayAmountToBaseAmount({
                    amount: safeNumber(query.minPrice, 0),
                    displayCurrency: activeMarket.currency,
                    baseCurrency: activeMarket.baseCurrency,
                })
                : safeNumber(query.minPrice, 0);
        }
        if (query.maxPrice !== undefined) {
            filter.price.$lte = activeMarket
                ? await convertDisplayAmountToBaseAmount({
                    amount: safeNumber(query.maxPrice, Number.MAX_SAFE_INTEGER),
                    displayCurrency: activeMarket.currency,
                    baseCurrency: activeMarket.baseCurrency,
                })
                : safeNumber(query.maxPrice, Number.MAX_SAFE_INTEGER);
        }
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
            filter.$and = [
                ...(Array.isArray(filter.$and) ? filter.$and : []),
                {
                    $or: [
                        { category: { $in: categoryPatterns } },
                        { categoryPaths: { $in: categoryPatterns } },
                    ],
                },
            ];
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

    if (activeMarket?.restrictedCategories?.length) {
        const restrictedPatterns = activeMarket.restrictedCategories
            .map((entry) => safeString(entry))
            .filter(Boolean)
            .map((entry) => new RegExp(`^${escapeRegExp(entry)}$`, 'i'));

        if (restrictedPatterns.length > 0) {
            filter.category = {
                ...(filter.category || {}),
                $nin: restrictedPatterns,
            };
        }
    }

    if (activeMarket?.restrictedProductIds?.length) {
        const restrictedIds = activeMarket.restrictedProductIds
            .map((entry) => Number(entry))
            .filter(Number.isFinite);

        if (restrictedIds.length > 0) {
            filter.id = {
                ...(filter.id || {}),
                $nin: restrictedIds,
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
    const readProjection = buildProductReadProjection({
        includeDetails: safeLower(query.includeDetails, 'false') === 'true',
    });
    const adFilter = buildSponsoredCandidateFilter({
        mergedBase,
        keywordFilter,
        query,
    });
    const adDocs = await Product.find(adFilter)
        .select(readProjection)
        .sort({
            'adCampaign.priority': -1,
            'adCampaign.cpcBid': -1,
            rating: -1,
            _id: -1,
        })
        .limit(maxSlots * 4)
        .lean()
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

const scoreProductForDecisionVelocity = (product = {}, keywordCandidates = []) => {
    const title = safeLower(product.title);
    const brand = safeLower(product.brand);
    const category = safeLower(product.category);
    const description = safeLower(product.description);
    let score = 0;

    keywordCandidates.forEach((candidate) => {
        const token = safeLower(candidate);
        if (!token) return;
        if (title === token) score += 120;
        if (title.startsWith(token)) score += 70;
        if (title.includes(token)) score += 45;
        if (brand === token) score += 55;
        if (brand.includes(token)) score += 25;
        if (category === token) score += 35;
        if (category.includes(token)) score += 18;
        if (description.includes(token)) score += 8;
    });

    if (Number(product.stock || 0) > 0) score += 30;

    const trustTier = safeLower(product?.provenance?.trustTier);
    if (trustTier === 'first_party') score += 40;
    if (trustTier === 'verified') score += 30;
    if (trustTier === 'curated') score += 22;
    if (Boolean(product?.contentQuality?.publishReady)) score += 25;

    score += Math.min(20, Number(product?.contentQuality?.completenessScore || 0) / 4);
    score += Math.min(12, Number(product.rating || 0) * 2);
    score += Math.min(20, Math.log10(Number(product.ratingCount || 0) + 1) * 8);

    return Number(score.toFixed(2));
};

const sortProductsForDecisionVelocity = (products = [], keywordCandidates = []) => (
    [...products]
        .map((product) => ({
            ...toPlainProduct(product),
            __decisionScore: scoreProductForDecisionVelocity(product, keywordCandidates),
        }))
        .sort((a, b) => {
            if (b.__decisionScore !== a.__decisionScore) {
                return b.__decisionScore - a.__decisionScore;
            }
            if (Number(b.ratingCount || 0) !== Number(a.ratingCount || 0)) {
                return Number(b.ratingCount || 0) - Number(a.ratingCount || 0);
            }
            return String(b._id || '').localeCompare(String(a._id || ''));
        })
        .map(({ __decisionScore, ...product }) => product)
);

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

const queryProducts = async (query = {}, options = {}) => {
    const limit = Math.min(Math.max(toInt(query.limit, 12), 1), 50);
    const page = Math.max(toInt(query.page, 1), 1);
    const includeMeta = safeLower(query.includeMeta, 'true') !== 'false';
    const includeDetails = safeLower(query.includeDetails, 'false') === 'true';
    const includeSponsored = shouldIncludeSponsored(query);
    const sponsoredSlots = resolveSponsoredSlots(query);
    const readProjection = buildProductReadProjection({ includeDetails });
    const allowDemoFallback = options.allowDemoFallback === true;
    const baseFilter = await buildBaseProductFilter({ allowDemoFallback });
    const catalogReadMode = resolveCatalogReadMode(baseFilter);
    const logicalFilter = await buildFilterFromQuery(query, { market: options.market || null });
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
    const relevanceSort = safeLower(query.sort, 'relevance') === 'relevance' || !query.sort;
    const candidateFetchLimit = relevanceSort ? Math.min(limit * 3, 60) : limit;

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
        let products = [];
        let total = 0;

        if (includeMeta) {
            [products, total] = await Promise.all([
                Product.find(fallbackFilter)
                    .select(readProjection)
                    .sort(relevanceSort ? { ratingCount: -1, _id: -1 } : sort)
                    .skip(skip)
                    .limit(candidateFetchLimit)
                    .lean()
                    .maxTimeMS(requestTimeoutMs),
                Product.countDocuments(countFilter).maxTimeMS(requestTimeoutMs),
            ]);
        } else {
            products = await Product.find(fallbackFilter)
                .select(readProjection)
                .sort(relevanceSort ? { ratingCount: -1, _id: -1 } : sort)
                .skip(skip)
                .limit(candidateFetchLimit)
                .lean()
                .maxTimeMS(requestTimeoutMs);
            total = Array.isArray(products) ? products.length : 0;
        }

        let finalProducts = (products || []).map((entry) => toPlainProduct(entry));
        if (options.market) {
            finalProducts = finalProducts.filter((entry) => !isProductRestrictedForMarket(entry, options.market));
        }
        if (relevanceSort) {
            finalProducts = sortProductsForDecisionVelocity(finalProducts, keywordCandidates).slice(0, limit);
        }
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
            page: includeMeta ? page : 1,
            pages: includeMeta ? Math.max(1, Math.ceil(total / limit)) : 1,
            nextCursor: includeMeta && !relevanceSort ? (products.length === limit ? generateNextCursor(products, sort) : null) : null,
            catalogReadMode,
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
        if (baseFilter['publishGate.status']) {
            filterClauses.push({
                equals: {
                    path: 'publishGate.status',
                    value: baseFilter['publishGate.status'],
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

        if (includeMeta) {
            pipeline.push({
                $facet: {
                    products: [
                        { $limit: candidateFetchLimit },
                        ...(includeDetails ? [] : [{ $project: PRODUCT_LIST_PROJECTION }]),
                    ],
                    totalMeta: [{ $count: 'count' }],
                },
            });
        } else {
            pipeline.push({ $limit: candidateFetchLimit });
            if (!includeDetails) {
                pipeline.push({ $project: PRODUCT_LIST_PROJECTION });
            }
        }

        const aggregate = Product.aggregate(pipeline).option({ maxTimeMS: requestTimeoutMs });
        const aggregateResult = await aggregate.exec();
        const result = includeMeta
            ? (aggregateResult?.[0] || { products: [], totalMeta: [] })
            : null;
        const products = includeMeta ? (result.products || []) : aggregateResult;
        const total = includeMeta
            ? (result.totalMeta?.[0]?.count || 0)
            : (Array.isArray(products) ? products.length : 0);

        if (total > 0) {
            let finalProducts = products.map((entry) => toPlainProduct(entry));
            if (options.market) {
                finalProducts = finalProducts.filter((entry) => !isProductRestrictedForMarket(entry, options.market));
            }
            if (relevanceSort) {
                finalProducts = sortProductsForDecisionVelocity(finalProducts, keywordCandidates).slice(0, limit);
            }
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
                page: includeMeta ? page : 1,
                pages: includeMeta ? Math.max(1, Math.ceil(total / limit)) : 1,
                nextCursor: includeMeta && !relevanceSort ? (products.length === limit ? generateNextCursor(products, sort) : null) : null,
                catalogReadMode,
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

const resolveProductIdentifierFilter = async (identifier, options = {}) => {
    let baseFilter = {};
    try {
        baseFilter = await buildBaseProductFilter({
            allowDemoFallback: options.allowDemoFallback === true,
        });
    } catch (error) {
        logger.warn('catalog.resolve_identifier.base_filter_failed', { 
            identifier, 
            error: error.message 
        });
        // Fallback to empty filter (allow all published products or specific version if available)
    }
    const orClauses = buildIdentifierOrClauses(identifier);

    return {
        ...baseFilter,
        $or: orClauses,
    };
};

const getProductByIdentifier = async (identifier, options = {}) => {
    const hydrate = options.hydrate === true;
    const allowOutsideActiveCatalog = options.allowOutsideActiveCatalog === true;

    if (!hydrate) {
        const cachedProduct = readCachedIdentifierValue(identifier);
        if (cachedProduct) {
            return cachedProduct;
        }
    }

    const lookup = async () => {
        const filter = await resolveProductIdentifierFilter(identifier, options);
        const activeCatalogQuery = Product.findOne(filter);
        const inActiveCatalog = hydrate ? await activeCatalogQuery : await activeCatalogQuery.lean();
        if (inActiveCatalog) {
            if (options.market && isProductRestrictedForMarket(inActiveCatalog, options.market)) {
                return null;
            }
            return inActiveCatalog;
        }
        if (!allowOutsideActiveCatalog) return null;

        // Admin/governance fallback:
        // allow direct identifier resolution even if product is outside active catalog version.
        const fallbackOr = buildIdentifierOrClauses(identifier);
        if (!fallbackOr.length) return null;
        const fallbackQuery = Product.findOne({ $or: fallbackOr });
        const fallbackProduct = hydrate ? await fallbackQuery : await fallbackQuery.lean();
        if (fallbackProduct && options.market && isProductRestrictedForMarket(fallbackProduct, options.market)) {
            return null;
        }
        return fallbackProduct;
    };

    if (hydrate) {
        return lookup();
    }

    const pendingLookup = lookup();
    const pendingKeys = buildIdentifierOrClauses(identifier).map((clause) => {
        const [[key, value]] = Object.entries(clause || {});
        return key && value !== undefined && value !== null ? `${key}:${String(value)}` : null;
    }).filter(Boolean);

    pendingKeys.forEach((cacheKey) => {
        productIdentifierCache.set(cacheKey, {
            promise: pendingLookup,
            expiresAt: Date.now() + PRODUCT_IDENTIFIER_CACHE_TTL_MS,
        });
    });

    try {
        const product = await pendingLookup;
        cacheIdentifierValue(identifier, product);
        return clonePlain(product);
    } catch (error) {
        invalidateProductIdentifierCache(identifier);
        throw error;
    }
};

const allocateManualProductId = async (session = null) => {
    try {
        const query = SystemState.findOneAndUpdate(
            { key: DEFAULT_SYSTEM_KEY },
            {
                $inc: { manualProductCounter: 1 },
                $setOnInsert: { key: DEFAULT_SYSTEM_KEY },
            },
            { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
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
        sourceRef: 'manual:first_party',
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
        invalidateCatalogReadCaches(product.id || product._id || externalId);
        return product;
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw mapDuplicateToAppError(error);
        }
        throw error;
    }
};

const updateManualProduct = async (identifier, payload) => {
    const existing = await getProductByIdentifier(identifier, {
        hydrate: true,
        allowOutsideActiveCatalog: true,
        allowDemoFallback: true,
    });
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
        sourceRef: existing?.provenance?.sourceRef || 'manual:first_party',
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
        invalidateCatalogReadCaches(existing.id || existing._id || identifier);
        return existing;
    } catch (error) {
        if (isDuplicateKeyError(error)) {
            throw mapDuplicateToAppError(error);
        }
        throw error;
    }
};

const deleteManualProduct = async (identifier) => {
    const existing = await getProductByIdentifier(identifier, {
        allowOutsideActiveCatalog: true,
        allowDemoFallback: true,
    });
    if (!existing) throw new AppError('Product not found', 404);
    await Product.deleteOne({ _id: existing._id });
    invalidateCatalogReadCaches(existing.id || existing._id || identifier);
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
    manifestRef,
    catalogVersion,
    sourceLabel = 'batch',
}) => {
    const snapshotReport = await prepareCatalogSnapshotForImport({
        sourceType,
        sourceRef,
        manifestRef,
    });
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

    for await (const row of streamRowsFromSource(
        snapshotReport.sourceType,
        snapshotReport.sourceResource.localPath
    )) {
        totals.totalRows += 1;
        if (totals.totalRows > MAX_ROWS_PER_IMPORT) {
            throw new AppError(`Import exceeded max rows (${MAX_ROWS_PER_IMPORT})`, 400);
        }

        const normalized = normalizeProductRecord({
            raw: row.data,
            defaultSource: sourceLabel,
            catalogVersion,
            sourceRef,
            snapshotManifest: snapshotReport.manifest,
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
    return { totals, errors, snapshotReport };
};

const summarizeCatalogVersionQuality = async (catalogVersion) => {
    const [summary] = await Product.aggregate([
        { $match: { catalogVersion } },
        {
            $group: {
                _id: '$catalogVersion',
                totalProducts: { $sum: 1 },
                publishReadyProducts: {
                    $sum: { $cond: [{ $eq: ['$contentQuality.publishReady', true] }, 1, 0] },
                },
                syntheticRejectedProducts: {
                    $sum: { $cond: [{ $eq: ['$contentQuality.syntheticRejected', true] }, 1, 0] },
                },
                devOnlyProducts: {
                    $sum: { $cond: [{ $eq: ['$publishGate.status', 'dev_only'] }, 1, 0] },
                },
                trustedProducts: {
                    $sum: {
                        $cond: [
                            { $in: ['$provenance.trustTier', ['verified', 'curated', 'first_party']] },
                            1,
                            0,
                        ],
                    },
                },
                avgCompletenessScore: {
                    $avg: { $ifNull: ['$contentQuality.completenessScore', 0] },
                },
            },
        },
    ]);

    return summary || {
        totalProducts: 0,
        publishReadyProducts: 0,
        syntheticRejectedProducts: 0,
        devOnlyProducts: 0,
        trustedProducts: 0,
        avgCompletenessScore: 0,
    };
};

const evaluateCatalogPublishGate = async ({ catalogVersion, totals }) => {
    const qualitySummary = await summarizeCatalogVersionQuality(catalogVersion);
    const totalProducts = Math.max(qualitySummary.totalProducts || 0, totals?.totalRows || 0, 1);
    const failedRatio = totals?.totalRows > 0 ? (totals.failed / totals.totalRows) : 1;
    const publishReadyRatio = Number(qualitySummary.publishReadyProducts || 0) / totalProducts;
    const trustedRatio = Number(qualitySummary.trustedProducts || 0) / totalProducts;

    let publishGateStatus = 'pending';
    let publishGateReason = 'catalog_quality_review_required';
    let publishable = false;

    if (Number(qualitySummary.syntheticRejectedProducts || 0) > 0) {
        publishGateStatus = 'rejected';
        publishGateReason = 'synthetic_catalog_signals_detected';
    } else if (Number(qualitySummary.devOnlyProducts || 0) > 0) {
        publishGateStatus = 'dev_only';
        publishGateReason = 'dev_test_catalog_cannot_be_published';
    } else if (
        totals?.totalRows > 0
        && failedRatio <= 0.1
        && publishReadyRatio >= 0.75
        && trustedRatio >= 0.75
    ) {
        publishGateStatus = 'approved';
        publishGateReason = 'catalog_ready_for_publish';
        publishable = true;
    }

    return {
        publishable,
        publishGateStatus,
        publishGateReason,
        qualitySummary: {
            ...qualitySummary,
            avgCompletenessScore: Number(Number(qualitySummary.avgCompletenessScore || 0).toFixed(2)),
        },
    };
};

const createCatalogImportJob = async ({
    sourceType,
    sourceRef,
    manifestRef,
    mode = 'batch',
    initiatedBy = '',
    idempotencyKey = '',
    requestId = '',
    userId = null,
}) => {
    if (!flags.catalogImportsEnabled) {
        throw new AppError('Catalog imports are currently disabled', 403);
    }

    const snapshotReport = await prepareCatalogSnapshotForImport({
        sourceType,
        sourceRef,
        manifestRef,
    });
    const catalogVersion = `cat_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const job = await CatalogImportJob.create({
        jobId: makeId('imp'),
        status: 'pending',
        sourceType: safeLower(snapshotReport.sourceType || sourceType, 'jsonl'),
        sourceRef: safeString(sourceRef),
        manifestRef: safeString(manifestRef),
        mode: safeString(mode || 'batch'),
        initiatedBy: safeString(initiatedBy),
        user: userId || null,
        requestId: safeString(requestId),
        idempotencyKey: safeString(idempotencyKey),
        catalogVersion,
        publishable: false,
        snapshotManifest: toJobSnapshotManifest(snapshotReport.manifest, snapshotReport.sourceType),
        sourceValidation: toJobSourceValidation(snapshotReport.validation),
        startedAt: new Date(),
    });

    return job;
};

const markImportJobFinished = async ({ job, status, totals, errors }) => {
    const publishGate = await evaluateCatalogPublishGate({
        catalogVersion: job.catalogVersion,
        totals,
    });
    job.status = status;
    job.totals = totals;
    job.errorCount = totals.failed;
    job.errorSample = errors;
    job.publishable = publishGate.publishable;
    job.publishGateStatus = publishGate.publishGateStatus;
    job.publishGateReason = publishGate.publishGateReason;
    job.qualitySummary = publishGate.qualitySummary;
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
        const { totals, errors, snapshotReport } = await runImportPipeline({
            sourceType: job.sourceType,
            sourceRef: job.sourceRef,
            manifestRef: job.manifestRef,
            catalogVersion: job.catalogVersion,
            sourceLabel: job.mode === 'provider' ? 'provider' : 'batch',
        });
        job.snapshotManifest = toJobSnapshotManifest(snapshotReport.manifest, snapshotReport.sourceType);
        job.sourceValidation = toJobSourceValidation(snapshotReport.validation);

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
    const publishGate = await evaluateCatalogPublishGate({
        catalogVersion: job.catalogVersion,
        totals: job.totals,
    });
    job.publishable = publishGate.publishable;
    job.publishGateStatus = publishGate.publishGateStatus;
    job.publishGateReason = publishGate.publishGateReason;
    job.qualitySummary = publishGate.qualitySummary;
    await job.save();

    if (!job.publishable) {
        throw new AppError(
            `Catalog import is not publishable (${job.publishGateReason || 'quality gate failed'}). Resolve provenance or content-quality issues first.`,
            409
        );
    }
    if (job.status === 'published') {
        const state = await getSystemState();
        return {
            publishedVersion: state.activeCatalogVersion,
            switchedAt: state.lastSwitchAt,
            oldVersionRetained: state.previousCatalogVersion || null,
            publishGateStatus: job.publishGateStatus || 'approved',
            publishGateReason: job.publishGateReason || 'catalog_ready_for_publish',
            qualitySummary: job.qualitySummary || null,
        };
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const state = await SystemState.findOneAndUpdate(
            { key: DEFAULT_SYSTEM_KEY },
            { $setOnInsert: { key: DEFAULT_SYSTEM_KEY } },
            { returnDocument: 'after', upsert: true, session, setDefaultsOnInsert: true }
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
        invalidateCatalogReadCaches();

        return {
            publishedVersion: nextVersion,
            switchedAt: state.lastSwitchAt,
            oldVersionRetained: previousVersion || null,
            publishGateStatus: job.publishGateStatus || 'approved',
            publishGateReason: job.publishGateReason || 'catalog_ready_for_publish',
            qualitySummary: job.qualitySummary || null,
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
    { sort: { createdAt: 1 }, returnDocument: 'after' }
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
    { sort: { createdAt: 1 }, returnDocument: 'after' }
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
        const manifestRef = getProviderManifestRef(run.provider);
        if (!sourceRef) {
            throw new AppError('CATALOG_PROVIDER_SOURCE_REF is not configured for sync provider', 400);
        }
        if (!manifestRef) {
            throw new AppError('CATALOG_PROVIDER_MANIFEST_REF is not configured for sync provider', 400);
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

        const { totals, errors, snapshotReport } = await runImportPipeline({
            sourceType: 'jsonl',
            sourceRef,
            manifestRef,
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
            sourceType: safeLower(snapshotReport.sourceType || 'jsonl'),
            sourceRef,
            manifestRef,
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
            snapshotManifest: toJobSnapshotManifest(snapshotReport.manifest, snapshotReport.sourceType),
            sourceValidation: toJobSourceValidation(snapshotReport.validation),
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
    const [pendingImports, processingImports, pendingSyncRuns, processingSyncRuns, lastSyncCursor, publishReadyProducts, devOnlyProducts, syntheticRejectedProducts, publishedProductCount] = await Promise.all([
        CatalogImportJob.countDocuments({ status: 'pending' }),
        CatalogImportJob.countDocuments({ status: 'processing' }),
        CatalogSyncRun.countDocuments({ status: 'pending' }),
        CatalogSyncRun.countDocuments({ status: 'processing' }),
        CatalogSyncCursor.findOne({ provider: flags.catalogDefaultSyncProvider }).lean(),
        Product.countDocuments({ catalogVersion: state.activeCatalogVersion, 'contentQuality.publishReady': true }),
        Product.countDocuments({ catalogVersion: state.activeCatalogVersion, 'publishGate.status': 'dev_only' }),
        Product.countDocuments({ catalogVersion: state.activeCatalogVersion, 'contentQuality.syntheticRejected': true }),
        Product.countDocuments({ catalogVersion: state.activeCatalogVersion, isPublished: true }),
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
        publicReadPolicy: 'published_only',
        demoPreviewAvailable: Boolean(flags.catalogPublicDemoFallback && devOnlyProducts > 0),
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
        quality: {
            publishedProductCount,
            publishReadyProducts,
            devOnlyProducts,
            syntheticRejectedProducts,
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
