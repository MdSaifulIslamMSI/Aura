const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { canonicalizeProductImageUrl } = require('../services/productImageResolver');

const normalizeTitleKey = (value) => String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const normalizeImageKey = (value) => {
    const raw = canonicalizeProductImageUrl(value);
    if (!raw) return '';

    try {
        const url = new URL(raw);
        const params = [...url.searchParams.entries()]
            .sort(([aKey], [bKey]) => aKey.localeCompare(bKey));
        const query = params.length
            ? `?${params.map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`).join('&')}`
            : '';

        return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, '').toLowerCase()}${query}`;
    } catch {
        return normalizeTitleKey(raw);
    }
};

const normalizeImageList = (value) => {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => canonicalizeProductImageUrl(entry))
        .filter(Boolean);
};

const normalizeCategoryPathList = (value, primaryCategory = '') => {
    const seen = new Set();
    const ordered = [];

    [primaryCategory, ...(Array.isArray(value) ? value : [])]
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .forEach((entry) => {
            const key = entry.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            ordered.push(entry);
        });

    return ordered;
};

const productSchema = new mongoose.Schema({
    id: { type: Number, index: true },
    externalId: { type: String, trim: true },
    source: {
        type: String,
        enum: ['manual', 'batch', 'provider'],
        default: 'manual',
    },
    catalogVersion: { type: String, default: 'legacy-v1' },
    isPublished: { type: Boolean, default: true },
    searchText: { type: String, default: '' },
    ingestHash: { type: String, default: '' },
    titleKey: {
        type: String,
        trim: true,
        default() {
            return normalizeTitleKey(this.title);
        },
    },
    imageKey: {
        type: String,
        trim: true,
        default() {
            return normalizeImageKey(this.image);
        },
    },
    updatedFromSyncAt: { type: Date, default: null },
    provenance: {
        sourceName: { type: String, trim: true, default: '' },
        sourceType: {
            type: String,
            enum: ['manual', 'provider', 'batch', 'first_party', 'dev_seed', 'unknown'],
            default: 'unknown',
            index: true,
        },
        sourceRef: { type: String, trim: true, default: '' },
        trustTier: {
            type: String,
            enum: ['unverified', 'verified', 'curated', 'first_party'],
            default: 'unverified',
            index: true,
        },
        datasetClass: {
            type: String,
            enum: ['real', 'synthetic', 'mixed', 'unknown'],
            default: 'unknown',
            index: true,
        },
        feedVersion: { type: String, trim: true, default: '' },
        schemaVersion: { type: String, trim: true, default: '' },
        manifestSha256: { type: String, trim: true, default: '' },
        observedAt: { type: Date, default: null },
        ingestedAt: { type: Date, default: Date.now },
        imageSourceType: {
            type: String,
            enum: ['real', 'placeholder', 'unknown'],
            default: 'unknown',
        },
    },
    contentQuality: {
        completenessScore: { type: Number, default: 0, min: 0, max: 100 },
        specCount: { type: Number, default: 0, min: 0 },
        highlightCount: { type: Number, default: 0, min: 0 },
        hasDescription: { type: Boolean, default: false },
        hasSpecifications: { type: Boolean, default: false },
        hasBrand: { type: Boolean, default: false },
        hasImage: { type: Boolean, default: false },
        hasWarranty: { type: Boolean, default: false },
        syntheticScore: { type: Number, default: 0, min: 0 },
        syntheticRejected: { type: Boolean, default: false },
        publishReady: { type: Boolean, default: false, index: true },
        issues: [{ type: String, trim: true }],
    },
    publishGate: {
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected', 'dev_only'],
            default: 'pending',
            index: true,
        },
        reason: { type: String, trim: true, default: '' },
        checkedAt: { type: Date, default: null },
    },
    title: { type: String, required: true },
    displayTitle: { type: String, trim: true, default: '' },
    subtitle: { type: String, trim: true, default: '' },
    brand: { type: String, required: true },
    category: { type: String, required: true },
    categoryPaths: [{ type: String, trim: true }],
    subCategory: { type: String },
    price: { type: Number, required: true },
    originalPrice: { type: Number },
    discountPercentage: { type: Number },
    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    image: { type: String, required: true },
    images: [{ type: String, trim: true }],
    description: { type: String },
    highlights: [{ type: String }],
    specifications: [{
        key: { type: String, trim: true, maxlength: 80 },
        value: { type: String, trim: true, maxlength: 300 },
    }],
    stock: { type: Number, default: 0 },
    deliveryTime: { type: String },
    warranty: { type: String },
    adCampaign: {
        isSponsored: { type: Boolean, default: false, index: true },
        status: {
            type: String,
            enum: ['inactive', 'active', 'paused', 'expired'],
            default: 'inactive',
            index: true,
        },
        priority: { type: Number, default: 0, min: 0, max: 100, index: true },
        cpcBid: { type: Number, default: 0, min: 0, max: 100000, index: true },
        budgetTotal: { type: Number, default: 0, min: 0 },
        budgetSpent: { type: Number, default: 0, min: 0 },
        startsAt: { type: Date, default: null },
        endsAt: { type: Date, default: null },
        placement: {
            type: String,
            enum: ['search', 'listing', 'home', 'all'],
            default: 'all',
        },
        creativeTagline: { type: String, trim: true, maxlength: 120, default: '' },
    },
}, {
    timestamps: true
});

productSchema.pre('validate', function productUniqueKeyPreValidate() {
    const normalizedImages = normalizeImageList(this.images);
    if (normalizedImages.length > 0) {
        this.images = normalizedImages;
        if (!this.image || this.isModified('images')) {
            this.image = normalizedImages[0];
        }
    } else if (this.image) {
        this.image = canonicalizeProductImageUrl(this.image);
        this.images = [this.image];
    }

    if (this.isModified('title') || !this.titleKey) {
        this.titleKey = normalizeTitleKey(this.title);
    }
    if (!this.displayTitle) {
        this.displayTitle = this.title;
    }
    this.categoryPaths = normalizeCategoryPathList(this.categoryPaths, this.category);
    if (this.isModified('image') || !this.imageKey) {
        this.image = canonicalizeProductImageUrl(this.image);
        this.imageKey = normalizeImageKey(this.image);
    }
});

const hydrateUniqueKeysInUpdate = (update = {}) => {
    const direct = update;
    const setBlock = update.$set || {};

    const nextTitle = typeof setBlock.title === 'string'
        ? setBlock.title
        : (typeof direct.title === 'string' ? direct.title : null);
    const nextImages = Array.isArray(setBlock.images)
        ? setBlock.images
        : (Array.isArray(direct.images) ? direct.images : null);
    const nextImage = typeof setBlock.image === 'string'
        ? setBlock.image
        : (typeof direct.image === 'string' ? direct.image : null);
    const nextCategory = typeof setBlock.category === 'string'
        ? setBlock.category
        : (typeof direct.category === 'string' ? direct.category : null);
    const nextCategoryPaths = Array.isArray(setBlock.categoryPaths)
        ? setBlock.categoryPaths
        : (Array.isArray(direct.categoryPaths) ? direct.categoryPaths : null);

    if (nextTitle !== null) {
        setBlock.titleKey = normalizeTitleKey(nextTitle);
    }
    if (nextCategory !== null || nextCategoryPaths !== null) {
        setBlock.categoryPaths = normalizeCategoryPathList(
            nextCategoryPaths !== null ? nextCategoryPaths : setBlock.categoryPaths,
            nextCategory !== null ? nextCategory : setBlock.category
        );
    }
    if (nextImages !== null) {
        const normalizedImages = normalizeImageList(nextImages);
        setBlock.images = normalizedImages;
        if (!nextImage && normalizedImages.length > 0) {
            setBlock.image = normalizedImages[0];
        }
    }
    if (nextImage !== null) {
        setBlock.image = canonicalizeProductImageUrl(nextImage);
        if (!Array.isArray(setBlock.images) || setBlock.images.length === 0) {
            setBlock.images = [setBlock.image];
        }
        setBlock.imageKey = normalizeImageKey(setBlock.image);
    }

    if (Object.keys(setBlock).length > 0) {
        update.$set = setBlock;
    }
    return update;
};

productSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function productUniqueKeyUpdatePre() {
    const update = this.getUpdate();
    if (update) {
        this.setUpdate(hydrateUniqueKeysInUpdate(update));
    }
});

productSchema.index(
    { externalId: 1, source: 1, catalogVersion: 1 },
    {
        unique: true,
        sparse: true,
    }
);
productSchema.index(
    { titleKey: 1 },
    {
        unique: true,
        partialFilterExpression: { titleKey: { $type: 'string' } },
    }
);
productSchema.index(
    { imageKey: 1 },
    {
        unique: true,
        partialFilterExpression: { imageKey: { $type: 'string' } },
    }
);
productSchema.index({ category: 1 });
productSchema.index({ categoryPaths: 1 });
productSchema.index({ title: 1 });
productSchema.index({ isPublished: 1, catalogVersion: 1, category: 1, price: 1 });
productSchema.index({ isPublished: 1, catalogVersion: 1, brand: 1 });
productSchema.index({ isPublished: 1, 'contentQuality.publishReady': 1, 'provenance.trustTier': 1 });
productSchema.index({ catalogVersion: 1, 'publishGate.status': 1, 'provenance.datasetClass': 1 });
productSchema.index({
    'adCampaign.isSponsored': 1,
    'adCampaign.status': 1,
    'adCampaign.priority': -1,
    'adCampaign.cpcBid': -1,
    category: 1,
    brand: 1,
});

productSchema.statics.normalizeTitleKey = normalizeTitleKey;
productSchema.statics.normalizeImageKey = normalizeImageKey;

productSchema.statics.syncProductIndexes = async function () {
    try {
        await this.syncIndexes();
        logger.info('product_model.indices_synced');
    } catch (error) {
        logger.error('product_model.sync_indices_failed', { error: error.message });
    }
};

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
