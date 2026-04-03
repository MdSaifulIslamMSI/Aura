const {
    createSessionPayload,
    normalizeAction,
    normalizeCard,
    normalizeIntent,
    normalizeSupportDraft,
    safeString,
} = require('./assistantContract');

const composeAssistantResponse = ({
    session = {},
    reply = {},
    cards = [],
    actions = [],
    supportDraft = null,
    telemetry = {},
}) => ({
    session: createSessionPayload(session),
    reply: {
        text: safeString(reply?.text || ''),
        intent: normalizeIntent(reply?.intent || 'general_help'),
        confidence: Math.min(Math.max(Number(reply?.confidence || 0), 0), 1),
    },
    cards: (Array.isArray(cards) ? cards : [])
        .map((card) => normalizeCard(card))
        .filter(Boolean)
        .slice(0, 4),
    actions: (Array.isArray(actions) ? actions : [])
        .map((action) => normalizeAction(action))
        .filter(Boolean)
        .slice(0, 5),
    supportDraft: normalizeSupportDraft(supportDraft),
    telemetry: {
        latencyMs: Math.max(0, Number(telemetry?.latencyMs || 0)),
        source: safeString(telemetry?.source || 'rules'),
        retrievalHits: Math.max(0, Number(telemetry?.retrievalHits || 0)),
    },
});

module.exports = {
    composeAssistantResponse,
};
