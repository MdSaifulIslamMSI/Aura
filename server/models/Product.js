const mongoose = require('mongoose');

const normalizeTitleKey = (value) => String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const normalizeImageKey = (value) => {
    const raw = String(value || '').trim();
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
    title: { type: String, required: true },
    brand: { type: String, required: true },
    category: { type: String, required: true },
    subCategory: { type: String },
    price: { type: Number, required: true },
    originalPrice: { type: Number },
    discountPercentage: { type: Number },
    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    image: { type: String, required: true },
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
    if (this.isModified('title') || !this.titleKey) {
        this.titleKey = normalizeTitleKey(this.title);
    }
    if (this.isModified('image') || !this.imageKey) {
        this.imageKey = normalizeImageKey(this.image);
    }
});

const hydrateUniqueKeysInUpdate = (update = {}) => {
    const direct = update;
    const setBlock = update.$set || {};

    const nextTitle = typeof setBlock.title === 'string'
        ? setBlock.title
        : (typeof direct.title === 'string' ? direct.title : null);
    const nextImage = typeof setBlock.image === 'string'
        ? setBlock.image
        : (typeof direct.image === 'string' ? direct.image : null);

    if (nextTitle !== null) {
        setBlock.titleKey = normalizeTitleKey(nextTitle);
    }
    if (nextImage !== null) {
        setBlock.imageKey = normalizeImageKey(nextImage);
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
productSchema.index({ isPublished: 1, catalogVersion: 1, category: 1, price: 1 });
productSchema.index({ isPublished: 1, catalogVersion: 1, brand: 1 });
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

const Product = mongoose.model('Product', productSchema);

module.exports = Product;
