const mongoose = require('mongoose');

const fraudSignalSchema = new mongoose.Schema({
    code: { type: String, required: true },
    source: { type: String, default: 'fraud_decisioning' },
    points: { type: Number, default: 0 },
    severity: { type: String, enum: ['info', 'low', 'medium', 'high', 'critical'], default: 'medium' },
    message: { type: String, default: '', maxlength: 500 },
    evidence: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false });

const fraudModuleSchema = new mongoose.Schema({
    name: { type: String, required: true },
    score: { type: Number, default: 0 },
    decision: { type: String, default: 'allow' },
    factors: [{ type: String }],
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false });

const fraudDecisionSchema = new mongoose.Schema({
    decisionId: { type: String, required: true, unique: true, index: true },
    action: { type: String, required: true, index: true },
    mode: { type: String, enum: ['off', 'monitor', 'shadow', 'enforce'], default: 'monitor', index: true },
    score: { type: Number, default: 0, index: true },
    level: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'low', index: true },
    strictDecision: {
        type: String,
        enum: ['allow', 'challenge', 'review', 'hold', 'block'],
        default: 'allow',
        index: true,
    },
    decision: {
        type: String,
        enum: ['allow', 'challenge', 'review', 'hold', 'block'],
        default: 'allow',
        index: true,
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    subject: {
        subjectType: { type: String, default: '', index: true },
        subjectId: { type: String, default: '', index: true },
    },
    signals: { type: [fraudSignalSchema], default: [] },
    modules: { type: [fraudModuleSchema], default: [] },
    requestMeta: { type: mongoose.Schema.Types.Mixed, default: {} },
    outcome: {
        enforced: { type: Boolean, default: false, index: true },
        blocked: { type: Boolean, default: false, index: true },
        challengeRequired: { type: Boolean, default: false },
        reviewRequired: { type: Boolean, default: false, index: true },
        holdRequired: { type: Boolean, default: false },
    },
    review: {
        status: {
            type: String,
            enum: ['none', 'open', 'approved', 'rejected', 'resolved', 'escalated'],
            default: 'none',
            index: true,
        },
        queue: { type: String, default: '', index: true },
        assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        reviewedAt: { type: Date, default: null },
        resolution: { type: String, default: '', maxlength: 240 },
        note: { type: String, default: '', maxlength: 1000 },
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

fraudDecisionSchema.index({ action: 1, createdAt: -1 });
fraudDecisionSchema.index({ user: 1, createdAt: -1 });
fraudDecisionSchema.index({ 'subject.subjectType': 1, 'subject.subjectId': 1, createdAt: -1 });
fraudDecisionSchema.index({ strictDecision: 1, createdAt: -1 });
fraudDecisionSchema.index({ 'review.status': 1, 'review.queue': 1, createdAt: -1 });

module.exports = mongoose.model('FraudDecision', fraudDecisionSchema);
