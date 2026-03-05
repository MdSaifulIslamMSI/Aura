const mongoose = require('mongoose');

const paymentMethodSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    provider: { type: String, required: true, default: 'razorpay' },
    providerMethodId: { type: String, required: true },
    type: { type: String, enum: ['card', 'upi', 'wallet', 'bank', 'other'], default: 'other' },
    brand: { type: String, default: '' },
    last4: { type: String, default: '' },
    isDefault: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    fingerprintHash: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

paymentMethodSchema.index({ user: 1, providerMethodId: 1 }, { unique: true });
paymentMethodSchema.index({ user: 1, isDefault: 1 });

module.exports = mongoose.model('PaymentMethod', paymentMethodSchema);

