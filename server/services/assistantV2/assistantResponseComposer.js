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
    decision = null,
    provisional = false,
    traceId = '',
    decisionId = '',
    upgradeEligible = false,
    provisionalReply = null,
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
        route: safeString(telemetry?.route || ''),
        traceId: safeString(telemetry?.traceId || ''),
        decisionId: safeString(telemetry?.decisionId || ''),
        provisional: Boolean(telemetry?.provisional),
        upgradeEligible: Boolean(telemetry?.upgradeEligible),
    },
    decision: decision && typeof decision === 'object'
        ? {
            route: safeString(decision.route || ''),
            confidence: Math.min(Math.max(Number(decision.confidence || 0), 0), 1),
            costEstimate: Math.max(0, Number(decision.cost_estimate || 0)),
            latencyBudgetMs: Math.max(0, Number(decision.latency_budget_ms || 0)),
            requiresConfirmation: Boolean(decision.requires_confirmation),
            reasonSummary: safeString(decision.reason_summary || ''),
        }
        : null,
    provisional: Boolean(provisional),
    traceId: safeString(traceId || ''),
    decisionId: safeString(decisionId || ''),
    upgradeEligible: Boolean(upgradeEligible),
    provisionalReply: provisionalReply && typeof provisionalReply === 'object'
        ? {
            text: safeString(provisionalReply.text || ''),
            intent: normalizeIntent(provisionalReply.intent || 'general_help'),
            confidence: Math.min(Math.max(Number(provisionalReply.confidence || 0), 0), 1),
        }
        : null,
});

module.exports = {
    composeAssistantResponse,
};
