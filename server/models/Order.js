const mongoose = require('mongoose');

const orderSchema = mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'User'
    },
    orderItems: [
        {
            title: { type: String, required: true },
            quantity: { type: Number, required: true },
            image: { type: String, required: true },
            price: { type: Number, required: true },
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
        settlementCurrency: { type: String, default: 'INR' },
        presentmentCurrency: { type: String, default: 'INR' },
        presentmentTotalRefunded: { type: Number, default: 0 },
        fullyRefunded: { type: Boolean, default: false },
        refunds: [{
            refundId: { type: String },
            amount: { type: Number, default: 0 },
            currency: { type: String, default: 'INR' },
            settlementAmount: { type: Number, default: 0 },
            settlementCurrency: { type: String, default: 'INR' },
            presentmentAmount: { type: Number, default: 0 },
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
            reason: { type: String, default: '' },
            message: { type: String, default: '' },
            refundId: { type: String, default: '' },
            adminNote: { type: String, default: '' },
            status: {
                type: String,
                enum: ['pending', 'approved', 'rejected', 'processed'],
                default: 'pending',
            },
            createdAt: { type: Date, default: Date.now },
            processedAt: { type: Date, default: null },
            updatedAt: { type: Date, default: null },
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
    taxPrice: {
        type: Number,
        required: true,
        default: 0.0
    },
    shippingPrice: {
        type: Number,
        required: true,
        default: 0.0
    },
    totalPrice: {
        type: Number,
        required: true,
        default: 0.0
    },
    baseAmount: {
        type: Number,
        default: 0.0
    },
    baseCurrency: {
        type: String,
        default: 'INR'
    },
    displayAmount: {
        type: Number,
        default: 0.0
    },
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
    presentmentCurrency: {
        type: String,
        default: 'INR'
    },
    presentmentTotalPrice: {
        type: Number,
        default: 0.0
    },
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
    paymentAdjustment: {
        type: Number,
        default: 0.0
    },
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

module.exports = mongoose.model('Order', orderSchema);
