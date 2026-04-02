const { assembleRouteContext } = require('./assistantRouteContextService');
const { routeAssistantCommerceTurn } = require('./assistantCommerceRouter');
const { composeAssistantResponse } = require('./assistantResponseComposer');
const { recordAssistantTurn } = require('./assistantTelemetryService');
const { resolveAssistantSession, saveAssistantSession } = require('./assistantSessionService');
const { safeString } = require('./assistantContract');

const normalizeCommerceContext = (commerceContext = {}) => ({
    activeProductId: safeString(commerceContext?.activeProductId || ''),
    candidateProductIds: [...new Set((Array.isArray(commerceContext?.candidateProductIds) ? commerceContext.candidateProductIds : [])
        .map((entry) => safeString(entry))
        .filter(Boolean))]
        .slice(0, 8),
    cartSummary: commerceContext?.cartSummary && typeof commerceContext.cartSummary === 'object'
        ? {
            totalPrice: Math.max(0, Number(commerceContext.cartSummary.totalPrice || 0)),
            totalOriginalPrice: Math.max(0, Number(commerceContext.cartSummary.totalOriginalPrice || 0)),
            totalDiscount: Math.max(0, Number(commerceContext.cartSummary.totalDiscount || 0)),
            totalItems: Math.max(0, Number(commerceContext.cartSummary.totalItems || 0)),
            itemCount: Math.max(0, Number(commerceContext.cartSummary.itemCount || 0)),
            currency: safeString(commerceContext.cartSummary.currency || 'INR'),
        }
        : {
            totalPrice: 0,
            totalOriginalPrice: 0,
            totalDiscount: 0,
            totalItems: 0,
            itemCount: 0,
            currency: 'INR',
        },
});

const normalizeUserContext = ({ reqUser = null, payloadUserContext = {} } = {}) => ({
    authenticated: Boolean(reqUser?._id || payloadUserContext?.authenticated),
});

const createAssistantTurn = async ({
    sessionId = '',
    message = '',
    routeContext = {},
    commerceContext = {},
    userContext = {},
    reqUser = null,
}) => {
    const startedAt = Date.now();
    const resolvedSession = await resolveAssistantSession(sessionId);
    const normalizedRouteContext = assembleRouteContext(routeContext);
    const normalizedCommerceContext = normalizeCommerceContext(commerceContext);
    const normalizedUserContext = normalizeUserContext({
        reqUser,
        payloadUserContext: userContext,
    });

    const outcome = await routeAssistantCommerceTurn({
        message,
        routeContext: normalizedRouteContext,
        commerceContext: normalizedCommerceContext,
        session: resolvedSession,
    });

    const nextSession = await saveAssistantSession({
        ...resolvedSession,
        turnCount: Number(resolvedSession.turnCount || 0) + 1,
        lastIntent: safeString(outcome?.reply?.intent || resolvedSession.lastIntent || 'general_help'),
        lastRouteContext: normalizedRouteContext,
        lastCommerceContext: normalizedCommerceContext,
        lastUserContext: normalizedUserContext,
        lastProductIds: Array.isArray(outcome?.sessionPatch?.lastProductIds)
            ? outcome.sessionPatch.lastProductIds
            : resolvedSession.lastProductIds || [],
        activeProductId: safeString(outcome?.sessionPatch?.activeProductId || normalizedCommerceContext.activeProductId || resolvedSession.activeProductId || ''),
        lastQuery: safeString(outcome?.sessionPatch?.lastQuery || message || resolvedSession.lastQuery || ''),
        lastSupportDraft: outcome?.sessionPatch?.lastSupportDraft || resolvedSession.lastSupportDraft || null,
    });

    const response = composeAssistantResponse({
        session: nextSession,
        reply: outcome.reply,
        cards: outcome.cards,
        actions: outcome.actions,
        supportDraft: outcome.supportDraft,
        telemetry: {
            ...outcome.telemetry,
            latencyMs: Date.now() - startedAt,
        },
    });

    recordAssistantTurn({
        session: nextSession,
        intent: response.reply.intent,
        routeContext: normalizedRouteContext,
        telemetry: response.telemetry,
        actions: response.actions,
        supportDraft: response.supportDraft,
    });

    return response;
};

module.exports = {
    createAssistantTurn,
};
