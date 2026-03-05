const mongoose = require('mongoose');

const tradeInSchema = mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    // The marketplace listing being traded in
    listing: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Listing'
    },
    // OR a manual item description (if no listing exists)
    manualItem: {
        title: String,
        category: String,
        condition: { type: String, enum: ['new', 'like-new', 'good', 'fair', 'poor'] },
        images: [String],
        description: String
    },
    // The catalog product they want to buy with trade-in
    targetProduct: {
        productId: { type: Number, required: true },
        title: { type: String, required: true },
        price: { type: Number, required: true },
        image: String
    },
    // Trade-in valuation
    estimatedValue: { type: Number, required: true },
    finalValue: { type: Number, default: null },       // set by admin after review
    discountApplied: { type: Number, default: 0 },     // actual discount on product

    status: {
        type: String,
        enum: ['pending', 'under-review', 'approved', 'rejected', 'completed'],
        default: 'pending'
    },
    adminNotes: { type: String, default: '' },
    rejectionReason: { type: String, default: '' }
}, {
    timestamps: true
});

tradeInSchema.index({ user: 1, status: 1 });
tradeInSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('TradeIn', tradeInSchema);
