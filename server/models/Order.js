const mongoose = require('mongoose');
const {
    hydrateOrderMinorUnits,
    minorUnitsField,
} = require('../services/payments/moneyStorage');
const { defineEncryptedField } = require('./utils/encryptedField');

const inventoryDispositionItemSchema = new mongoose.Schema({
    productId: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
}, { _id: false });

const inventoryDispositionSchema = new mongoose.Schema({
    status: {
        type: String,
        enum: ['claimed', 'completed', 'skipped'],
        default: 'claimed',
    },
    claimId: { type: String, default: '' },
    items: { type: [inventoryDispositionItemSchema], default: [] },
    claimedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
}, { _id: false });

const orderSchema = mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    orderItems: [
        {
            title: { type: String, required: true },
            quantity: { type: Number, required: true, min: 1 },
            image: { type: String, required: true },
            price: { type: Number, required: true },
            priceMinor: minorUnitsField(),
            product: {
                type: mongoose.Schema.Types.ObjectId,
                required: true,
                ref: 'Product'
            }
        }
    ],
    shippingAddress: {
        address: { type: String, required: true },
        city: { type: String, required: true },
        postalCode: { type: String, required: true },
        country: { type: String, required: true }
    },
    paymentMethod: {
        type: String,
        required: true,
        default: 'COD' // or 'Card'
    },
    orderStatus: {
        type: String,
        enum: ['placed', 'processing', 'shipped', 'delivered', 'cancelled'],
        default: 'placed',
        index: true,
    },
    cancelledAt: {
        type: Date,
        default: null,
    },
    cancelReason: {
        type: String,
        default: '',
    },
    statusTimeline: [{
        status: { type: String, default: 'placed' },
        message: { type: String, default: '' },
        actor: { type: String, default: 'system' },
        at: { type: Date, default: Date.now },
    }],
    paymentResult: {
        id: { type: String },
        status: { type: String },
        update_time: { type: String },
        email_address: { type: String }
    },
    confirmationEmailStatus: {
        type: String,
        enum: ['pending', 'sent', 'failed', 'skipped'],
        default: 'pending',
        index: true,
    },
    confirmationEmailSentAt: {
        type: Date,
        default: null,
    },
    confirmationEmailNotificationId: {
        type: String,
        default: '',
        index: true,
    },
    paymentIntentId: {
        type: String,
        default: '',
        index: true
    },
    idempotencyKey: {
        type: String,
        default: '',
        index: true,
        select: false,
    },
    paymentProvider: {
        type: String,
        default: ''
    },
    paymentState: {
        type: String,
        default: 'pending'
    },
    paymentAuthorizedAt: {
        type: Date,
        default: null
    },
    paymentCapturedAt: {
        type: Date,
        default: null
    },
    riskSnapshot: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    refundSummary: {
        totalRefunded: { type: Number, default: 0 },
        totalRefundedMinor: minorUnitsField(),
        settlementCurrency: { type: String, default: 'INR' },
        presentmentCurrency: { type: String, default: 'INR' },
        presentmentTotalRefunded: { type: Number, default: 0 },
        presentmentTotalRefundedMinor: minorUnitsField(),
        fullyRefunded: { type: Boolean, default: false },
        refunds: [{
            refundId: { type: String },
            requestId: { type: String, default: '' },
            amount: { type: Number, default: 0 },
            amountMinor: minorUnitsField(),
            currency: { type: String, default: 'INR' },
            settlementAmount: { type: Number, default: 0 },
            settlementAmountMinor: minorUnitsField(),
            settlementCurrency: { type: String, default: 'INR' },
            presentmentAmount: { type: Number, default: 0 },
            presentmentAmountMinor: minorUnitsField(),
            presentmentCurrency: { type: String, default: 'INR' },
            reason: { type: String, default: '' },
            status: { type: String, default: '' },
            createdAt: { type: Date, default: Date.now },
        }],
    },
    commandCenter: {
        refunds: [{
            requestId: { type: String, default: '' },
            amount: { type: Number, default: 0 },
            amountMinor: minorUnitsField(),
            reason: { type: String, default: '' },
            message: { type: String, default: '' },
            refundId: { type: String, default: '' },
            adminNote: { type: String, default: '' },
            fraudDecisionId: { type: String, default: '', index: true },
            riskDecision: { type: String, default: 'allow' },
            riskScore: { type: Number, default: 0 },
            riskFactors: { type: [String], default: [] },
            status: {
                type: String,
                enum: ['pending', 'approved', 'rejected', 'processed'],
                default: 'pending',
            },
            createdAt: { type: Date, default: Date.now },
            processedAt: { type: Date, default: null },
            updatedAt: { type: Date, default: null },
            inventoryDisposition: { type: inventoryDispositionSchema },
        }],
        replacements: [{
            requestId: { type: String, default: '' },
            reason: { type: String, default: '' },
            itemProductId: { type: String, default: '' },
            itemTitle: { type: String, default: '' },
            quantity: { type: Number, default: 1 },
            message: { type: String, default: '' },
            trackingId: { type: String, default: '' },
            adminNote: { type: String, default: '' },
            status: {
                type: String,
                enum: ['pending', 'approved', 'rejected', 'shipped'],
                default: 'pending',
            },
            createdAt: { type: Date, default: Date.now },
            processedAt: { type: Date, default: null },
            updatedAt: { type: Date, default: null },
        }],
        supportChats: [{
            messageId: { type: String, default: '' },
            actor: {
                type: String,
                enum: ['customer', 'support'],
                default: 'customer',
            },
            message: { type: String, default: '' },
            createdAt: { type: Date, default: Date.now },
        }],
        warrantyClaims: [{
            claimId: { type: String, default: '' },
            issue: { type: String, default: '' },
            itemProductId: { type: String, default: '' },
            itemTitle: { type: String, default: '' },
            resolutionNote: { type: String, default: '' },
            status: {
                type: String,
                enum: ['pending', 'approved', 'rejected', 'in_review'],
                default: 'pending',
            },
            createdAt: { type: Date, default: Date.now },
            processedAt: { type: Date, default: null },
        }],
        lastUpdatedAt: { type: Date, default: null },
    },
    itemsPrice: {
        type: Number,
        required: true,
        default: 0.0
    },
    itemsPriceMinor: minorUnitsField(),
    taxPrice: {
        type: Number,
        required: true,
        default: 0.0
    },
    taxPriceMinor: minorUnitsField(),
    shippingPrice: {
        type: Number,
        required: true,
        default: 0.0
    },
    shippingPriceMinor: minorUnitsField(),
    totalPrice: {
        type: Number,
        required: true,
        default: 0.0
    },
    totalPriceMinor: minorUnitsField(),
    baseAmount: {
        type: Number,
        default: 0.0
    },
    baseAmountMinor: minorUnitsField(),
    baseCurrency: {
        type: String,
        default: 'INR'
    },
    displayAmount: {
        type: Number,
        default: 0.0
    },
    displayAmountMinor: minorUnitsField(),
    displayCurrency: {
        type: String,
        default: 'INR'
    },
    fxRateLocked: {
        type: Number,
        default: 1
    },
    fxTimestamp: {
        type: String,
        default: ''
    },
    settlementCurrency: {
        type: String,
        default: 'INR'
    },
    settlementAmount: {
        type: Number,
        default: 0.0
    },
    settlementAmountMinor: minorUnitsField(),
    presentmentCurrency: {
        type: String,
        default: 'INR'
    },
    presentmentTotalPrice: {
        type: Number,
        default: 0.0
    },
    presentmentTotalPriceMinor: minorUnitsField(),
    marketCountryCode: {
        type: String,
        default: 'IN'
    },
    couponCode: {
        type: String,
        default: ''
    },
    couponDiscount: {
        type: Number,
        default: 0.0
    },
    couponDiscountMinor: minorUnitsField(),
    paymentAdjustment: {
        type: Number,
        default: 0.0
    },
    paymentAdjustmentMinor: minorUnitsField(),
    deliveryOption: {
        type: String,
        enum: ['standard', 'express'],
        default: 'standard'
    },
    deliverySlot: {
        date: { type: String },
        window: { type: String }
    },
    checkoutSource: {
        type: String,
        enum: ['cart', 'directBuy'],
        default: 'cart'
    },
    // Points actually granted for this order; the cancel path reverses exactly
    // this amount, so it must be captured at award time, not recomputed.
    loyaltyPointsAwarded: {
        type: Number,
        default: 0,
        min: 0
    },
    deliveryPromise: {
        estimateText: { type: String, default: '' },
        promisedDate: { type: Date, default: null },
        serviceable: { type: Boolean, default: true },
        zone: { type: String, default: '' },
        computedAt: { type: Date, default: null },
    },
    pricingVersion: {
        type: String,
        default: 'v1'
    },
    priceBreakdown: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    isPaid: {
        type: Boolean,
        required: true,
        default: false
    },
    paidAt: {
        type: Date
    },
    isDelivered: {
        type: Boolean,
        required: true,
        default: false
    },
    deliveredAt: {
        type: Date
    }
}, {
    timestamps: true
});

const shipmentCheckpointSchema = mongoose.Schema({
    status: {
        type: String,
        enum: ['packed', 'shipped', 'out_for_delivery', 'delivered', 'returned', 'exception'],
        required: true,
    },
    message: { type: String, default: '' },
    location: { type: String, default: '' },
    actor: { type: String, default: 'system' },
    at: { type: Date, default: Date.now },
}, { _id: false });

const shipmentSchema = mongoose.Schema({
    shipmentId: { type: String, required: true },
    items: [{
        productId: { type: String, default: '' },
        title: { type: String, default: '' },
        quantity: { type: Number, default: 1, min: 1 },
    }],
    courier: { type: String, default: '' },
    trackingId: { type: String, default: '' },
    status: {
        type: String,
        enum: ['pending', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'returned', 'exception'],
        default: 'pending',
    },
    // Hard-capped at append time ($slice) so webhook storms cannot grow the
    // order document without bound.
    checkpoints: { type: [shipmentCheckpointSchema], default: [] },
    promisedDate: { type: Date, default: null },
    dispatchedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: null },
}, { _id: false });

orderSchema.add({
    shipments: { type: [shipmentSchema], default: [] },
});

orderSchema.index({ user: 1, idempotencyKey: 1 }, {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $gt: '' } },
    name: 'user_idempotency_key_unique',
});
orderSchema.index({ user: 1, createdAt: -1, _id: -1 });
orderSchema.index({ createdAt: -1, _id: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1, _id: -1 });
orderSchema.index({ paymentState: 1, createdAt: -1, _id: -1 });
// Account overview filters { user, orderStatus: $in } + sorts createdAt;
// dashboard counts { user }. Both are per-view account reads.
orderSchema.index({ user: 1, orderStatus: 1, createdAt: -1 });

orderSchema.pre('validate', function hydrateMinorUnitMoneyFields() {
    hydrateOrderMinorUnits(this);
});

// PII at rest: the street line is encrypted; city/postalCode/country stay
// plaintext for pricing, fraud, and courier serviceability checks.
defineEncryptedField(orderSchema, 'shippingAddress.address');

module.exports = mongoose.model('Order', orderSchema);
