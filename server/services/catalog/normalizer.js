/**
 * catalog/normalizer.js — Product record normalization for catalog ingestion.
 *
 * Responsible for transforming raw vendor/import records into the canonical
 * AURA product shape. Pure transformation logic — no DB writes, no timers.
 *
 * Extracted from catalogService.js to isolate the single largest cohesive
 * domain: data normalization + quality scoring.
 */

const { resolveCategory } = require('../../config/categories');
const { flags } = require('../../config/catalogFlags');
const { resolveProductImage } = require('../productImageResolver');
const { analyzeCatalogRecord } = require('../catalogSourceIntegrityService');
const {
    safeString, safeLower, safeNumber, toInt, hashValue,
} = require('../../utils/catalogUtils');

const NO_IMAGE_PLACEHOLDER = 'https://via.placeholder.com/600x600?text=Aura+Product';

const PLACEHOLDER_IMAGE_PATTERNS = [
    /via\.placeholder\.com/i,
    /picsum\.photos/i,
    /placehold\.co/i,
    /dummyimage\.com/i,
];

// Lazy-load Product model to avoid circular dependency issues.
const getProductModel = () => require('../../models/Product');

const normalizeTitleKey = (value) => {
    const Product = getProductModel();
    return typeof Product.normalizeTitleKey === 'function'
        ? Product.normalizeTitleKey(value)
        : safeLower(String(value || '').replace(/\s+/g, ' ').trim());
};

const normalizeImageKey = (value) => {
    const Product = getProductModel();
    return typeof Product.normalizeImageKey === 'function'
        ? Product.normalizeImageKey(value)
        : safeLower(String(value || '').trim());
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
    raw = {}, source, sourceRef = '', snapshotManifest = null,
    title, brand, description, specifications, highlights, image, warranty,
}) => {
    const integrity = analyzeCatalogRecord({ ...raw, title, description, image });
    const sourceType = detectCatalogSourceType({ source, sourceRef });
    const specCount = Array.isArray(specifications) ? specifications.length : 0;
    const highlightCount = Array.isArray(highlights) ? highlights.length : 0;
    const hasDescription = safeString(description).length >= 40;
    const hasSpecifications = specCount >= 3;
    const hasBrand = safeString(brand).length > 0 && safeLower(brand) !== 'unknown';
    const hasImage = Boolean(safeString(image)) && !PLACEHOLDER_IMAGE_PATTERNS.some((p) => p.test(safeString(image)));
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

    const trustTier = sourceType === 'first_party' ? 'first_party'
        : (sourceType === 'provider' ? 'verified'
            : (sourceType === 'dev_seed' ? 'unverified'
                : (completenessScore >= 75 ? 'curated' : 'unverified')));

    const datasetClass = integrity.looksSynthetic ? 'synthetic'
        : (sourceType === 'dev_seed' ? 'mixed' : 'real');
    const publishReady = !integrity.looksSynthetic
        && sourceType !== 'dev_seed'
        && completenessScore >= 70
        && hasImage
        && hasDescription;

    const publishStatus = integrity.looksSynthetic ? 'rejected'
        : (sourceType === 'dev_seed' ? 'dev_only'
            : (publishReady ? 'approved' : 'pending'));
    const publishReason = integrity.looksSynthetic ? 'synthetic_signals_detected'
        : (sourceType === 'dev_seed' ? 'dev_test_catalog_only'
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
            completenessScore, specCount, highlightCount,
            hasDescription, hasSpecifications, hasBrand, hasImage, hasWarranty,
            syntheticScore: integrity.suspiciousScore,
            syntheticRejected: integrity.looksSynthetic,
            publishReady, issues,
        },
        publishGate: { status: publishStatus, reason: publishReason, checkedAt: new Date() },
    };
};

/**
 * normalizeProductRecord — transforms a raw import row into a canonical product doc.
 * Returns { product } on success or { error: { code, message } } on validation failure.
 */
const normalizeProductRecord = ({
    raw, defaultSource, catalogVersion, sourceRef = '', snapshotManifest = null, forSync = false,
}) => {
    const AppError = require('../../utils/AppError');
    const title = safeString(raw.title || raw.name || raw.productName);
    const brand = safeString(raw.brand || raw.manufacturer || 'Unknown');
    const category = normalizeCategory(raw.category || raw.subCategory || raw.department || 'Misc');
    const description = safeString(raw.description || raw.summary || '');
    const source = safeLower(defaultSource || raw.source || 'batch');
    const imageCandidate = safeString(raw.image || raw.thumbnail || raw.imageUrl || NO_IMAGE_PLACEHOLDER);
    const price = safeNumber(raw.price, NaN);
    const stock = Math.max(0, toInt(raw.stock ?? raw.quantity ?? 0, 0));
    const adCampaign = normalizeAdCampaign(raw.adCampaign);

    if (!title) return { error: { code: 'INVALID_TITLE', message: 'title is required' } };
    if (!Number.isFinite(price) || price < 0) return { error: { code: 'INVALID_PRICE', message: 'price must be a non-negative number' } };
    if (!category) return { error: { code: 'INVALID_CATEGORY', message: 'category is required' } };

    const externalSeed = safeString(raw.externalId || raw.sku || raw.productCode || raw.productId || raw.id);
    const externalId = externalSeed || hashValue(`${title}|${brand}|${category}|${price}`).slice(0, 24);
    const idCandidate = toInt(raw.id, NaN);
    const fallbackId = parseInt(hashValue(externalId).slice(0, 8), 16);
    const normalizedId = Number.isFinite(idCandidate) ? idCandidate : (100000000 + (fallbackId % 800000000));

    const image = resolveProductImage({
        existingImage: imageCandidate, title, brand, category, source,
        catalogVersion, externalId, id: normalizedId,
    });

    const highlights = Array.isArray(raw.highlights)
        ? raw.highlights.map((entry) => safeString(entry)).filter(Boolean).slice(0, 12)
        : [];
    const specifications = normalizeSpecifications(raw.specifications);
    const qualitySignals = buildCatalogQualitySignals({
        raw, source, sourceRef, snapshotManifest, title, brand, description,
        specifications, highlights, image, warranty: safeString(raw.warranty || ''),
    });

    if (source === 'provider' && !qualitySignals.contentQuality.publishReady) {
        const issueLabel = qualitySignals.contentQuality.issues[0] || 'content_quality_review_required';
        return { error: { code: 'PROVIDER_ROW_REJECTED', message: `provider row rejected: ${issueLabel}` } };
    }

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
        provenance: qualitySignals.provenance,
        contentQuality: qualitySignals.contentQuality,
        publishGate: qualitySignals.publishGate,
        searchText: buildSearchText({ title, brand, category, description, highlights, specifications }),
        updatedFromSyncAt: forSync ? new Date() : null,
    };

    normalized.ingestHash = hashValue(JSON.stringify({
        id: normalized.id, externalId: normalized.externalId, source: normalized.source,
        title: normalized.title, brand: normalized.brand, category: normalized.category,
        price: normalized.price, originalPrice: normalized.originalPrice,
        discountPercentage: normalized.discountPercentage, rating: normalized.rating,
        ratingCount: normalized.ratingCount, image: normalized.image, description: normalized.description,
        highlights: normalized.highlights, specifications: normalized.specifications,
        stock: normalized.stock, deliveryTime: normalized.deliveryTime,
        warranty: normalized.warranty, adCampaign: normalized.adCampaign,
    }));

    return { product: normalized };
};

module.exports = {
    buildSearchText,
    buildCatalogQualitySignals,
    detectCatalogSourceType,
    normalizeAdCampaign,
    normalizeCategory,
    normalizeProductRecord,
    normalizeSpecifications,
    NO_IMAGE_PLACEHOLDER,
    PLACEHOLDER_IMAGE_PATTERNS,
};
