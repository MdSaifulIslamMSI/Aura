const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema({
    seller: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    price: { type: Number, required: true, min: 0 },
    negotiable: { type: Boolean, default: true },
    condition: {
        type: String,
        required: true,
        enum: ['new', 'like-new', 'good', 'fair'],
        default: 'good'
    },
    category: {
        type: String,
        required: true,
        enum: [
            'mobiles', 'laptops', 'electronics', 'vehicles',
            'furniture', 'fashion', 'books', 'sports',
            'home-appliances', 'gaming', 'other'
        ]
    },
    images: {
        type: [String],   // URLs / base64 data URIs
        validate: [arr => arr.length <= 5 && arr.length >= 1, 'Between 1 and 5 images required']
    },
    location: {
        city: { type: String, required: true, trim: true },
        state: { type: String, required: true, trim: true },
        pincode: { type: String, trim: true },
        latitude: { type: Number, min: -90, max: 90, default: null },
        longitude: { type: Number, min: -180, max: 180, default: null },
        accuracyMeters: { type: Number, min: 0, default: null },
        confidence: { type: Number, min: 0, max: 100, default: null },
        provider: { type: String, trim: true, maxlength: 80, default: '' },
        capturedAt: { type: Date, default: null },
    },
    escrowOptIn: {
        type: Boolean,
        default: false,
        index: true,
    },
    escrow: {
        enabled: { type: Boolean, default: false },
        state: {
            type: String,
            enum: ['none', 'held', 'released', 'cancelled'],
            default: 'none',
            index: true,
        },
        buyer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        amount: { type: Number, default: 0 },
        holdReference: { type: String, default: '' },
        paymentIntentId: { type: String, default: '', index: true },
        paymentProvider: { type: String, default: '' },
        paymentState: { type: String, default: '' },
        paymentAuthorizedAt: { type: Date, default: null },
        paymentCapturedAt: { type: Date, default: null },
        refundReference: { type: String, default: '' },
        refundedAt: { type: Date, default: null },
        startedAt: { type: Date, default: null },
        confirmedAt: { type: Date, default: null },
        releasedAt: { type: Date, default: null },
    },
    disputeCount: { type: Number, default: 0 },
    status: {
        type: String,
        enum: ['active', 'sold', 'expired'],
        default: 'active',
        index: true
    },
    source: {
        type: String,
        enum: ['user', 'seed'],
        default: 'user',
        index: true
    },
    views: { type: Number, default: 0 },
    soldAt: { type: Date, default: null },
}, {
    timestamps: true
});

// ── Indexes ──────────────────────────────────────────────────────
listingSchema.index({ title: 'text', description: 'text' });            // Full-text search
listingSchema.index({ category: 1, status: 1, createdAt: -1 });         // Browse by category
listingSchema.index({ 'location.city': 1, status: 1, createdAt: -1 }); // Browse by city
listingSchema.index({ 'location.latitude': 1, 'location.longitude': 1, status: 1 }); // GPS proximity helpers
listingSchema.index({ seller: 1, status: 1 });                          // Seller's listings
listingSchema.index({ status: 1, source: 1, createdAt: -1 });           // Real-only marketplace path
listingSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 3600 }); // Auto-expire 60 days

module.exports = mongoose.model('Listing', listingSchema);
