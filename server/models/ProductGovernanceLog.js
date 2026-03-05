const mongoose = require('mongoose');

const productGovernanceLogSchema = new mongoose.Schema({
    actionId: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: false,
        index: true,
    },
    productRef: {
        type: String,
        required: true,
        trim: true,
        index: true,
    },
    actionType: {
        type: String,
        required: true,
        enum: ['create', 'update_core', 'update_pricing', 'delete'],
        index: true,
    },
    actorUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    actorEmail: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
    },
    reason: {
        type: String,
        default: '',
        trim: true,
        maxlength: 800,
    },
    beforeSnapshot: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
    },
    afterSnapshot: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
    },
    changeSet: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
}, {
    timestamps: true,
});

productGovernanceLogSchema.index({ productRef: 1, createdAt: -1 });
productGovernanceLogSchema.index({ actorEmail: 1, createdAt: -1 });

module.exports = mongoose.model('ProductGovernanceLog', productGovernanceLogSchema);

