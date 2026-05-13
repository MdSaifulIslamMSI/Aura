const mongoose = require('mongoose');
const {
    RECOMMENDATION_EVENT_TYPES,
    RECOMMENDATION_SOURCE_PAGES,
} = require('../utils/recommendationConstants');

const recommendationEventSchema = mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        index: true,
    },
    sessionId: {
        type: String,
        required: true,
        trim: true,
        maxlength: 160,
        index: true,
    },
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        default: null,
        index: true,
    },
    productNumericId: {
        type: Number,
        default: null,
        index: true,
    },
    eventType: {
        type: String,
        enum: RECOMMENDATION_EVENT_TYPES,
        required: true,
        index: true,
    },
    searchQuery: {
        type: String,
        trim: true,
        maxlength: 400,
        default: '',
    },
    category: {
        type: String,
        trim: true,
        maxlength: 120,
        default: '',
    },
    sourcePage: {
        type: String,
        enum: [...RECOMMENDATION_SOURCE_PAGES, ''],
        trim: true,
        default: '',
        index: true,
    },
    recommendationSource: {
        type: String,
        trim: true,
        maxlength: 120,
        default: '',
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
}, {
    timestamps: { createdAt: true, updatedAt: false },
});

recommendationEventSchema.index({ userId: 1, createdAt: -1 });
recommendationEventSchema.index({ sessionId: 1, createdAt: -1 });
recommendationEventSchema.index({ productId: 1, eventType: 1 });
recommendationEventSchema.index({ productNumericId: 1, eventType: 1 });
recommendationEventSchema.index({ eventType: 1, createdAt: -1 });
recommendationEventSchema.index({ sourcePage: 1, createdAt: -1 });

module.exports = mongoose.model('RecommendationEvent', recommendationEventSchema);
