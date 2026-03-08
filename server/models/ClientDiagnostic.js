const mongoose = require('mongoose');

const parseRetentionSeconds = () => {
    const parsed = Number(process.env.CLIENT_DIAGNOSTIC_RETENTION_SEC || 14 * 24 * 60 * 60);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 14 * 24 * 60 * 60;
    }
    return Math.trunc(parsed);
};

const clientDiagnosticSchema = new mongoose.Schema({
    eventId: { type: String, default: '', index: true },
    type: { type: String, required: true, maxlength: 120, index: true },
    severity: { type: String, default: 'info', maxlength: 32, index: true },
    timestamp: { type: Date, default: null, index: true },
    route: { type: String, default: '', maxlength: 220, index: true },
    sessionId: { type: String, default: '', maxlength: 120, index: true },
    requestId: { type: String, default: '', maxlength: 120, index: true },
    serverRequestId: { type: String, default: '', maxlength: 120, index: true },
    method: { type: String, default: '', maxlength: 16 },
    url: { type: String, default: '', maxlength: 520 },
    detail: { type: String, default: '', maxlength: 260 },
    status: { type: Number, default: 0, index: true },
    durationMs: { type: Number, default: 0 },
    error: { type: mongoose.Schema.Types.Mixed, default: {} },
    context: { type: mongoose.Schema.Types.Mixed, default: {} },
    ingestionRequestId: { type: String, default: '', maxlength: 120, index: true },
    clientIp: { type: String, default: '', maxlength: 120 },
    userAgent: { type: String, default: '', maxlength: 260 },
    ingestedAt: {
        type: Date,
        default: Date.now,
        expires: parseRetentionSeconds(),
        index: true,
    },
}, { timestamps: false });

clientDiagnosticSchema.index({ ingestedAt: -1, type: 1 });
clientDiagnosticSchema.index({ sessionId: 1, ingestedAt: -1 });
clientDiagnosticSchema.index({ requestId: 1, ingestedAt: -1 });
clientDiagnosticSchema.index({ serverRequestId: 1, ingestedAt: -1 });

module.exports = mongoose.model('ClientDiagnostic', clientDiagnosticSchema);
