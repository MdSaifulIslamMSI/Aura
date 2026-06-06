const mongoose = require('mongoose');

const securityEventSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now, index: true },
    requestId: { type: String, default: '', index: true },
    userId: { type: String, default: '', index: true },
    tenantId: { type: String, default: '', index: true },
    action: { type: String, default: '', index: true },
    route: { type: String, default: '' },
    method: { type: String, default: '' },
    ipHash: { type: String, default: '', index: true },
    userAgentHash: { type: String, default: '' },
    riskScore: { type: Number, default: 0 },
    decision: { type: String, default: '', index: true },
    reasonCode: { type: String, default: '', index: true },
    environment: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, {
    collection: 'security_events',
    minimize: true,
});

securityEventSchema.index({ timestamp: -1, decision: 1 });
securityEventSchema.index({ action: 1, timestamp: -1 });

module.exports = mongoose.models.SecurityEvent || mongoose.model('SecurityEvent', securityEventSchema);
