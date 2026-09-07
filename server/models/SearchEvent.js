const mongoose = require('mongoose');
const { resolveRetentionSeconds } = require('../utils/retentionTtl');

const searchEventSchema = new mongoose.Schema({
    eventId: { type: String, required: true, unique: true, index: true },
    eventType: {
        type: String,
        enum: ['search_results', 'search_click'],
        required: true,
        index: true,
    },
    searchEventId: { type: String, default: '', index: true },
    requestId: { type: String, default: '' },
    queryText: { type: String, default: '', trim: true },
    normalizedQuery: { type: String, default: '', trim: true, index: true },
    filters: { type: mongoose.Schema.Types.Mixed, default: {} },
    resultIds: [{ type: String, default: '' }],
    resultCount: { type: Number, default: 0 },
    zeroResult: { type: Boolean, default: false, index: true },
    clickedProductId: { type: String, default: '', index: true },
    clickedPosition: { type: Number, default: 0 },
    sourceContext: { type: String, default: '', trim: true, index: true },
    actorHash: { type: String, default: '', trim: true, index: true },
    userHash: { type: String, default: '', trim: true, index: true },
    sessionHash: { type: String, default: '', trim: true, index: true },
}, { timestamps: true });

searchEventSchema.index({ eventType: 1, createdAt: -1 });
searchEventSchema.index({ searchEventId: 1, eventType: 1, createdAt: -1 });
searchEventSchema.index({ normalizedQuery: 1, eventType: 1, createdAt: -1 });
// Search telemetry grows one document per search interaction; expire it after
// the configured retention window (SEARCH_EVENT_RETENTION_DAYS, default 90).
searchEventSchema.index({ createdAt: 1 }, {
    expireAfterSeconds: resolveRetentionSeconds({ envVar: 'SEARCH_EVENT_RETENTION_DAYS' }),
    name: 'search_event_created_at_ttl',
});

module.exports = mongoose.model('SearchEvent', searchEventSchema);
