// Phase 6 (P0): strict public product DTO. The previous serializer spread the
// entire Mongo product document into public API responses, leaking internal
// provenance (including server-local sourceRef paths), catalog version, ingest
// hashes, manifest/publish-gate metadata, and ad economics. This module is the
// single allowlist boundary between the catalog document and any client.
//
// Allowlist rules:
//   - Only fields the storefront actually renders or reasons about.
//   - Internal subdocuments are reduced to the minimal public projection the
//     frontend consumes (e.g. provenance.sourceType for demo detection,
//     publishGate.status, adCampaign.isSponsored/creativeTagline).

const PUBLIC_PRODUCT_SCALAR_FIELDS = Object.freeze([
    '_id',
    'id',
    'title',
    'displayTitle',
    'subtitle',
    'brand',
    'category',
    'categoryPaths',
    'subCategory',
    'tags',
    'price',
    'originalPrice',
    'discountPercentage',
    'rating',
    'ratingCount',
    'image',
    'images',
    'description',
    'highlights',
    'specifications',
    'stock',
    'deliveryTime',
    'warranty',
    'createdAt',
    'updatedAt',
]);

const INTERNAL_FIELD_NAMES = Object.freeze([
    'provenance',
    'publishGate',
    'contentQuality',
    'adCampaign',
    'source',
    'externalId',
    'catalogVersion',
    'isPublished',
    'searchText',
    'ingestHash',
    'titleKey',
    'imageKey',
    'updatedFromSyncAt',
    '__v',
]);

const asObject = (product) => {
    if (!product || typeof product !== 'object') return null;
    return typeof product.toObject === 'function' ? product.toObject() : product;
};

const pickScalarFields = (plain) => {
    const picked = {};
    for (const field of PUBLIC_PRODUCT_SCALAR_FIELDS) {
        if (plain[field] !== undefined) picked[field] = plain[field];
    }
    return picked;
};

const pickPublicSubdocuments = (plain) => {
    const picked = {};
    const sourceType = plain?.provenance?.sourceType;
    if (sourceType !== undefined) {
        picked.provenance = { sourceType };
    }
    const gateStatus = plain?.publishGate?.status;
    if (gateStatus !== undefined) {
        picked.publishGate = { status: gateStatus };
    }
    const adCampaign = plain?.adCampaign;
    if (adCampaign && typeof adCampaign === 'object') {
        picked.adCampaign = {
            isSponsored: Boolean(adCampaign.isSponsored),
            creativeTagline: typeof adCampaign.creativeTagline === 'string' ? adCampaign.creativeTagline : '',
        };
    }
    return picked;
};

// Strict allowlist pick. Accepts a Mongoose document or a lean object.
const pickPublicProductFields = (product) => {
    const plain = asObject(product);
    if (!plain) return null;
    return {
        ...pickScalarFields(plain),
        ...pickPublicSubdocuments(plain),
    };
};

// True when the object carries internal fields beyond the allowed minimal
// public projections. Used by tests and by the runtime leak tripwire: a full
// `provenance`/`publishGate`/`adCampaign` subdocument (or any pure-internal
// field) trips it, while the reduced sourceType/status/isSponsored projection
// does not.
const REDUCED_INTERNAL_SUBDOCUMENTS = Object.freeze({
    provenance: new Set(['sourceType']),
    publishGate: new Set(['status']),
    adCampaign: new Set(['isSponsored', 'creativeTagline']),
});

const hasInternalProductFields = (candidate) => {
    if (!candidate || typeof candidate !== 'object') return false;
    for (const field of INTERNAL_FIELD_NAMES) {
        const value = candidate[field];
        if (value === undefined) continue;
        const allowedKeys = REDUCED_INTERNAL_SUBDOCUMENTS[field];
        if (!allowedKeys) return true;
        const keys = value && typeof value === 'object' ? Object.keys(value) : [];
        if (keys.some((key) => !allowedKeys.has(key))) return true;
    }
    return false;
};

module.exports = {
    INTERNAL_FIELD_NAMES,
    PUBLIC_PRODUCT_SCALAR_FIELDS,
    hasInternalProductFields,
    pickPublicProductFields,
};
