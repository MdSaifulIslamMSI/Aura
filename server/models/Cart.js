const mongoose = require('mongoose');

const cartItemSchema = mongoose.Schema({
    productId: { type: Number, required: true, min: 1 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
}, { _id: false });

const recentMutationSchema = mongoose.Schema({
    id: { type: String, required: true },
    appliedAt: { type: Date, default: Date.now },
}, { _id: false });

const cartSchema = mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true,
    },
    version: { type: Number, default: 0, min: 0 },
    items: { type: [cartItemSchema], default: [] },
    recentMutations: { type: [recentMutationSchema], default: [] },
    updatedAtIso: { type: String, default: null },
}, {
    timestamps: true,
});

module.exports = mongoose.model('Cart', cartSchema);
