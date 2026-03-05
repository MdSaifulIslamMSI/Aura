const mongoose = require('mongoose');

const priceAlertSchema = mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    productId: { type: Number, required: true },   // references Product.id
    productTitle: { type: String, required: true },
    productImage: { type: String },
    currentPrice: { type: Number, required: true }, // price when alert was set
    targetPrice: { type: Number, required: true },
    triggered: { type: Boolean, default: false },
    triggeredAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true }
}, {
    timestamps: true
});

priceAlertSchema.index({ user: 1, isActive: 1 });
priceAlertSchema.index({ productId: 1, isActive: 1, targetPrice: 1 });

module.exports = mongoose.model('PriceAlert', priceAlertSchema);
