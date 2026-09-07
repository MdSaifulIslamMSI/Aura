const mongoose = require('mongoose');

// One row per (coupon, user) redemption, written inside the order-placement
// transaction. The unique {code, user} index is the hard backstop against
// concurrent placements racing past the pre-check in orderPlacementService.
const couponRedemptionSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    order: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true,
    },
    discount: { type: Number, default: 0, min: 0 },
    discountMinor: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'INR', trim: true },
}, { timestamps: true });

couponRedemptionSchema.index(
    { code: 1, user: 1 },
    { unique: true, name: 'coupon_code_user_unique' }
);
couponRedemptionSchema.index({ user: 1, createdAt: -1 });
couponRedemptionSchema.index({ code: 1, createdAt: -1 });

module.exports = mongoose.model('CouponRedemption', couponRedemptionSchema);
