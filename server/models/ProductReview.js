const mongoose = require('mongoose');

const reviewMediaSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['image', 'video'],
        required: true,
    },
    url: {
        type: String,
        required: true,
        trim: true,
        maxlength: 2048,
    },
    caption: {
        type: String,
        trim: true,
        maxlength: 160,
        default: '',
    },
}, { _id: false });

const productReviewSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
        index: true,
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    order: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        default: null,
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
    },
    comment: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1800,
    },
    media: {
        type: [reviewMediaSchema],
        default: [],
    },
    isVerifiedPurchase: {
        type: Boolean,
        default: true,
        index: true,
    },
    status: {
        type: String,
        enum: ['published', 'hidden'],
        default: 'published',
        index: true,
    },
    helpfulCount: {
        type: Number,
        default: 0,
        min: 0,
    },
}, {
    timestamps: true,
});

productReviewSchema.index({ product: 1, createdAt: -1 });
productReviewSchema.index({ product: 1, rating: -1 });
productReviewSchema.index({ product: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('ProductReview', productReviewSchema);
