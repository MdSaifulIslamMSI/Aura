const mongoose = require('mongoose');
const { PAYMENT_METHODS } = require('../services/payments/constants');

const riskSnapshotSchema = new mongoose.Schema({
    score: { type: Number, default: 0 },
    decision: { type: String, enum: ['allow', 'challenge', 'block'], default: 'allow' },
    factors: [{ type: String }],
    mode: { type: String, default: 'shadow' },
}, { _id: false });

const challengeSchema = new mongoose.Schema({
    required: { type: Boolean, default: false },
    status: { type: String, enum: ['none', 'pending', 'verified', 'failed'], default: 'none' },
    verifiedAt: { type: Date, default: null },
}, { _id: false });

const orderClaimSchema = new mongoose.Schema({
    state: { type: String, enum: ['none', 'locked', 'consumed'], default: 'none' },
    key: { type: String, default: '' },
    lockedAt: { type: Date, default: null },
}, { _id: false });

const paymentIntentSchema = new mongoose.Schema({
    intentId: { type: String, required: true, unique: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    provider: { type: String, required: true, default: 'razorpay' },
    providerOrderId: { type: String, required: true, index: true },
    providerPaymentId: { type: String, default: '', index: true },
    providerMethodId: { type: String, default: '' },
    amount: { type: Number, required: true },
    currency: { type: String, required: true, default: 'INR' },
    settlementAmount: { type: Number, default: 0 },
    marketCountryCode: { type: String, default: 'IN', index: true },
    marketCurrency: { type: String, default: 'INR', index: true },
    settlementCurrency: { type: String, default: 'INR' },
    providerBaseAmount: { type: Number, default: null },
    providerBaseCurrency: { type: String, default: '' },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    status: {
        type: String,
        enum: ['created', 'challenge_pending', 'authorized', 'captured', 'failed', 'partially_refunded', 'refunded', 'expired'],
        default: 'created',
        index: true,
    },
    riskSnapshot: { type: riskSnapshotSchema, default: () => ({}) },
    challenge: { type: challengeSchema, default: () => ({}) },
    orderClaim: { type: orderClaimSchema, default: () => ({}) },
    authorizedAt: { type: Date, default: null },
    capturedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },
    attemptCount: { type: Number, default: 0 },
    routingInsights: { type: mongoose.Schema.Types.Mixed, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

paymentIntentSchema.index({ user: 1, createdAt: -1 });
paymentIntentSchema.index({ provider: 1, providerOrderId: 1 });
paymentIntentSchema.index({ provider: 1, providerPaymentId: 1 });
paymentIntentSchema.index({ user: 1, status: 1, expiresAt: 1 });
paymentIntentSchema.index({ user: 1, order: 1, 'orderClaim.state': 1 });
paymentIntentSchema.index({ marketCountryCode: 1, marketCurrency: 1, status: 1 });

module.exports = mongoose.model('PaymentIntent', paymentIntentSchema);
