const {
    getCapabilitySnapshot,
} = require('./providerRegistry');
const {
    processExplicitAssistantAction,
    processPendingAssistantConfirmation,
    processRecoveredAssistantTurn,
} = require('./assistantRecoveryService');
const {
    requestCentralIntelligenceTurn,
} = require('../intelligence/intelligenceGatewayService');
const {
    createActionId,
    markActionExecuted,
    resolveAssistantSession,
    toSessionMemory,
    updateAssistantSession,
    validatePendingAction,
} = require('./assistantSessionService');
const { validateAssistantAction } = require('./assistantToolRegistry');
const { createDecisionId, persistAuditRecord } = require('./assistantAuditService');
const { recordSemanticMemory } = require('./assistantSemanticMemoryService');
const { buildOrchestratorRouteDecision, createTraceId } = require('./assistantGovernanceService');
const { buildAuditRecord, buildOrchestratorDecision } = require('./assistantGovernanceContract');
const {
    recordConfirmationMetric,
    recordCostMetric,
    recordFallbackMetric,
    recordLatencyMetric,
    recordRouteDecisionMetric,
    recordToolValidationMetric,
} = require('./assistantObservabilityService');
const { sendMessageToUser } = require('../socketService');

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const SYSTEM_AWARENESS_PATTERN = /\b(app|architecture|backend|bug|client|code|component|controller|db|debug|diagnostic|endpoint|error|explain|file|flow|frontend|function|graph|health|how does|implementation|index|issue|line by line|model|orchestrat|path|repo|route|schema|service|socket|support video|system|trace|where is|why .*fail(?:ing|ed|s|ure)?)\b/i;
const CENTRAL_FAILURE_RECOVERY_REASONS = new Set(['service_unavailable']);
const INLINE_CONFIRM_PATTERN = /^(yes|yeah|yep|ok|okay|confirm|go ahead|proceed|continue|do it)$/i;
const INLINE_REJECT_PATTERN = /^(no|nope|cancel|stop|not now)$/i;
const LOCAL_ROUTE_QUERY_PATTERN = /\b(?:what|which)\s+(?:route|path|url)\b|where is\b.*\bworkspace\b/i;
const LOCAL_ROUTE_TARGET_PATTERN = /\b(assistant workspace|assistant|visual search|marketplace|wishlist|orders|checkout|compare|bundles|mission control|price alerts|sell|become seller|login)\b/i;

const normalizeHistory = (conversationHistory = []) => (
    Array.isArray(conversationHistory)
        ? conversationHistory.slice(-8).map((entry) => ({
            role: safeString(entry?.role || 'user'),
            content: safeString(entry?.content || ''),
        })).filter((entry) => entry.content)
        : []
);

const deriveContextPath = ({ assistantTurn = {}, context = {}, session = {} } = {}) => (
    safeString(assistantTurn?.ui?.navigation?.path || '')
    || safeString(assistantTurn?.entities?.category || '')
    || safeString(context?.route || session?.contextPath || context?.routeLabel || '')
);

const buildAuthoritativeContext = ({ context = {}, session = {}, orchestration = {} } = {}) => ({
    ...context,
    assistantSession: session,
    orchestration,
    sessionMemory: {
        ...toSessionMemory(session),
        lastActionFingerprint: safeString(context?.sessionMemory?.lastActionFingerprint || ''),
        lastActionAt: Math.max(0, Number(context?.sessionMemory?.lastActionAt || 0)),
    },
});

const shouldFallbackToRecoveredTurn = ({ result = {}, message = '', images = [], streamedEventCount = 0 } = {}) => {
    const status = safeString(result?.grounding?.status || '');
    const reason = safeString(result?.grounding?.reason || '');
    if (status !== 'cannot_verify' || !CENTRAL_FAILURE_RECOVERY_REASONS.has(reason)) return false;
    if ((Array.isArray(images) && images.length > 0) || Number(streamedEventCount || 0) > 0) return false;
    if (SYSTEM_AWARENESS_PATTERN.test(safeString(message))) {
        return LOCAL_ROUTE_QUERY_PATTERN.test(safeString(message)) && LOCAL_ROUTE_TARGET_PATTERN.test(safeString(message));
    }
    return true;
};

const deriveImplicitConfirmation = ({ message = '', session = {} } = {}) => {
    const pendingAction = session?.pendingAction && typeof session.pendingAction === 'object' ? session.pendingAction : null;
    const normalized = safeString(message);
    if (!pendingAction?.actionId || !normalized) return null;
    if (INLINE_CONFIRM_PATTERN.test(normalized)) {
        return { actionId: pendingAction.actionId, approved: true, contextVersion: pendingAction.contextVersion || session?.contextVersion || 0 };
    }
    if (INLINE_REJECT_PATTERN.test(normalized)) {
        return { actionId: pendingAction.actionId, approved: false, contextVersion: pendingAction.contextVersion || session?.contextVersion || 0 };
    }
    return null;
};

const isPureRespondTurn = (assistantTurn = {}) => {
    if (safeString(assistantTurn?.decision || '') !== 'respond') {
        return false;
    }

    if (assistantTurn?.actionRequest?.type) {
        return false;
    }

    if (assistantTurn?.ui?.confirmation) {
        return false;
    }

    return !Array.isArray(assistantTurn?.actions) || assistantTurn.actions.length === 0;
};

const resolveRealtimeSessionId = ({ context = {}, session = {} } = {}) => (
    safeString(context?.clientSessionId || context?.assistantSession?.sessionId || session?.sessionId || '')
);

const resolveRealtimeMessageId = (context = {}) => safeString(context?.clientMessageId || '');

const buildRealtimeEnvelope = ({
    context = {},
    session = {},
    traceId = '',
    decision = 'LOCAL',
    provisional = false,
    upgradeEligible = false,
} = {}) => ({
    sessionId: resolveRealtimeSessionId({ context, session }),
    messageId: resolveRealtimeMessageId(context),
    decision: safeString(decision || 'LOCAL') || 'LOCAL',
    provisional: Boolean(provisional),
    upgradeEligible: Boolean(upgradeEligible),
    traceId: safeString(traceId || ''),
});

const decorateAssistantResult = (result = {}, meta = {}) => {
    const traceId = safeString(result?.grounding?.traceId || result?.traceId || meta?.traceId || '');

    return {
        ...result,
        sessionId: safeString(meta?.sessionId || result?.sessionId || ''),
        messageId: safeString(meta?.messageId || result?.messageId || ''),
        decision: safeString(meta?.decision || result?.decision || 'LOCAL') || 'LOCAL',
        provisional: meta?.provisional !== undefined ? Boolean(meta.provisional) : Boolean(result?.provisional),
        upgradeEligible: meta?.upgradeEligible !== undefined ? Boolean(meta.upgradeEligible) : Boolean(result?.upgradeEligible),
        traceId,
    };
};

const streamPlainTextReply = ({
    writeEvent = () => {},
    messageId = '',
    sessionId = '',
    text = '',
} = {}) => {
    const chunks = String(text || '').split(/(\s+)/).filter((entry) => entry.length > 0);
    chunks.forEach((chunk) => {
        writeEvent('token', {
            sessionId,
            messageId,
            token: chunk,
            text: chunk,
        });
    });
};

const scheduleRefinedAssistantUpgrade = ({
    user = null,
    message = '',
    conversationHistory = [],
    assistantMode = 'chat',
    context = {},
    images = [],
    session = {},
    traceId = '',
    decisionId = '',
    disabledTools = [],
} = {}) => {
    const userId = safeString(user?._id || '');
    const messageId = resolveRealtimeMessageId(context);
    const sessionId = resolveRealtimeSessionId({ context, session });
    if (!userId || !messageId || !sessionId) {
        return;
    }

    setTimeout(async () => {
        try {
            const refined = await requestCentralIntelligenceTurn({
                user,
                message,
                conversationHistory: normalizeHistory(conversationHistory),
                assistantMode,
                context,
                images,
                session,
                traceId,
                decisionId,
                governanceContext: {
                    disabledTools,
                    route: 'CENTRAL',
                },
            });

            if (shouldFallbackToRecoveredTurn({ result: refined, message, images })) {
                return;
            }

            const validated = sanitizeResultTools(refined, disabledTools);
            if (!validated?.assistantTurn || !isPureRespondTurn(validated.assistantTurn)) {
                return;
            }

            sendMessageToUser(userId, 'assistant.upgrade', {
                sessionId,
                messageId,
                content: safeString(validated?.assistantTurn?.response || validated?.answer || ''),
                citations: Array.isArray(validated?.assistantTurn?.citations) ? validated.assistantTurn.citations : [],
                verification: validated?.assistantTurn?.verification || null,
                providerInfo: validated?.providerInfo || {
                    name: safeString(validated?.provider || ''),
                    model: safeString(validated?.providerModel || ''),
                },
                decision: 'HYBRID',
                traceId: safeString(validated?.grounding?.traceId || ''),
                grounding: validated?.grounding || null,
                assistantTurn: validated?.assistantTurn || null,
            });
        } catch (_) {
            // Refined upgrades are best-effort and must not affect the primary turn.
        }
    }, 0);
};

const sanitizeResultTools = (result = {}, disabledTools = []) => {
    const assistantTurn = result?.assistantTurn && typeof result.assistantTurn === 'object' ? { ...result.assistantTurn } : {};
    const ui = assistantTurn?.ui && typeof assistantTurn.ui === 'object' ? { ...assistantTurn.ui } : {};
    const safetyFlags = Array.isArray(assistantTurn?.safetyFlags) ? [...assistantTurn.safetyFlags] : [];
    const blockedTools = [];
    const actions = (Array.isArray(assistantTurn?.actions) ? assistantTurn.actions : []).filter((action) => {
        const validation = validateAssistantAction(action, { disabledTools });
        recordToolValidationMetric({ tool: safeString(action?.type || 'unknown'), ok: validation.ok });
        if (validation.ok) return true;
        blockedTools.push({ type: safeString(action?.type || ''), reason: safeString(validation.reason || 'blocked') });
        safetyFlags.push(`tool_blocked:${safeString(action?.type || 'unknown')}:${safeString(validation.reason || 'blocked')}`);
        return false;
    });
    if (ui?.confirmation?.action) {
        const validation = validateAssistantAction(ui.confirmation.action, { disabledTools });
        recordToolValidationMetric({ tool: safeString(ui.confirmation.action?.type || 'unknown'), ok: validation.ok });
        if (!validation.ok) {
            blockedTools.push({ type: safeString(ui.confirmation.action?.type || ''), reason: safeString(validation.reason || 'blocked') });
            safetyFlags.push(`tool_blocked:${safeString(ui.confirmation.action?.type || 'unknown')}:${safeString(validation.reason || 'blocked')}`);
            ui.confirmation = null;
        }
    }
    assistantTurn.actions = actions;
    assistantTurn.ui = ui;
    assistantTurn.safetyFlags = [...new Set(safetyFlags)];
    if (assistantTurn.decision === 'act' && actions.length === 0 && !assistantTurn.ui?.confirmation) {
        assistantTurn.decision = 'respond';
        assistantTurn.response = safeString(assistantTurn.response || 'I held back the action because it did not pass the governed tool contract.');
    }
    return { ...result, actions, assistantTurn, blockedTools };
};

const finalizeAssistantTurnSession = async ({ result = {}, session = {}, context = {}, confirmation = null } = {}) => {
    const assistantTurn = result?.assistantTurn || {};
    const patch = {
        lastIntent: safeString(assistantTurn?.intent || session?.lastIntent || ''),
        lastEntities: assistantTurn?.entities || session?.lastEntities || {},
        contextPath: deriveContextPath({ assistantTurn, context, session }),
        clarificationState: assistantTurn?.sessionMemory?.clarificationState || session?.clarificationState || {},
        lastResolvedEntityId: safeString(assistantTurn?.entities?.productId || assistantTurn?.ui?.product?.id || assistantTurn?.sessionMemory?.activeProduct?.id || session?.lastResolvedEntityId || ''),
        lastResults: assistantTurn?.sessionMemory?.lastResults !== undefined ? assistantTurn.sessionMemory.lastResults : session?.lastResults || [],
        activeProduct: assistantTurn?.sessionMemory?.activeProduct !== undefined ? assistantTurn.sessionMemory.activeProduct : session?.activeProduct || null,
    };
    let nextSession = session;
    const confirmationAction = assistantTurn?.ui?.confirmation?.action && typeof assistantTurn.ui.confirmation.action === 'object' ? assistantTurn.ui.confirmation.action : null;
    if (confirmationAction?.type) {
        nextSession = await updateAssistantSession({ sessionId: session.sessionId, baseSession: session, patch: { ...patch, incrementContextVersion: true } });
        const actionId = createActionId({ intent: assistantTurn.intent, entities: assistantTurn.entities, contextVersion: nextSession.contextVersion, seed: Date.now() });
        const pendingAction = {
            actionId,
            actionType: safeString(assistantTurn?.policy?.actionType || confirmationAction.type || ''),
            risk: safeString(assistantTurn?.policy?.risk || ''),
            contextVersion: nextSession.contextVersion,
            intent: safeString(assistantTurn?.intent || ''),
            message: safeString(assistantTurn?.response || ''),
            action: { ...confirmationAction, actionId, contextVersion: nextSession.contextVersion },
            entities: assistantTurn?.entities || {},
            createdAt: Date.now(),
        };
        nextSession = await updateAssistantSession({ sessionId: nextSession.sessionId, baseSession: nextSession, patch: { pendingAction } });
        assistantTurn.ui = { ...(assistantTurn.ui || {}), confirmation: { ...(assistantTurn.ui?.confirmation || {}), token: actionId, action: pendingAction.action } };
    } else if (confirmation?.approved === true) {
        nextSession = await updateAssistantSession({ sessionId: session.sessionId, baseSession: session, patch });
        nextSession = await markActionExecuted({ sessionId: nextSession.sessionId, baseSession: nextSession, actionId: confirmation.actionId });
        recordConfirmationMetric('approved');
    } else if (confirmation?.approved === false) {
        nextSession = await updateAssistantSession({ sessionId: session.sessionId, baseSession: session, patch: { ...patch, pendingAction: null, incrementContextVersion: true } });
        recordConfirmationMetric('rejected');
    } else {
        nextSession = await updateAssistantSession({ sessionId: session.sessionId, baseSession: session, patch: { ...patch, incrementContextVersion: true } });
    }
    assistantTurn.assistantSession = nextSession;
    assistantTurn.sessionMemory = { ...(assistantTurn.sessionMemory || {}), ...toSessionMemory(nextSession) };
    return { ...result, assistantTurn, assistantSession: nextSession, sessionMemory: assistantTurn.sessionMemory, grounding: { ...(result?.grounding || {}), sessionId: nextSession.sessionId, contextVersion: nextSession.contextVersion } };
};

const buildEnvelope = ({ result = {}, decision = {}, decisionId = '', traceId = '', provisional = false, upgradeEligible = false, provisionalTurn = null } = {}) => {
    const routeDecision = buildOrchestratorDecision(decision);

    return {
        ...result,
        decision: safeString(routeDecision?.route || 'LOCAL') || 'LOCAL',
        decisionMeta: routeDecision,
        provisional: Boolean(provisional),
        provisionalTurn: provisionalTurn || null,
        traceId: safeString(traceId || result?.grounding?.traceId || ''),
        decisionId: safeString(decisionId || ''),
        upgradeEligible: Boolean(upgradeEligible),
    };
};

const runLocalTurn = async ({ user = null, message = '', conversationHistory = [], assistantMode = 'chat', actionRequest = null, context = {} } = {}) => (
    actionRequest?.type
        ? processExplicitAssistantAction({ actionRequest, assistantMode, context })
        : processRecoveredAssistantTurn({ user, message, conversationHistory: normalizeHistory(conversationHistory), assistantMode, context })
);

const finalizeGovernedResult = async ({ result = {}, decision = {}, decisionId = '', traceId = '', session = {}, context = {}, confirmation = null, disabledTools = [], provisional = false, upgradeEligible = false, provisionalTurn = null } = {}) => {
    const validated = sanitizeResultTools(result, disabledTools);
    const finalized = await finalizeAssistantTurnSession({ result: validated, session, context, confirmation });
    return buildEnvelope({ result: finalized, decision, decisionId, traceId, provisional, upgradeEligible, provisionalTurn });
};

const persistGovernanceSideEffects = async ({ response = {}, decision = {}, decisionId = '', traceId = '', startedAt = 0, message = '', user = null, fallbackReason = '' } = {}) => {
    const latencyMs = Math.max(0, Date.now() - Number(startedAt || Date.now()));
    recordRouteDecisionMetric({ route: safeString(decision?.route || 'LOCAL'), assistantMode: safeString(response?.assistantTurn?.answerMode || response?.grounding?.mode || 'chat') });
    recordLatencyMetric({ route: safeString(decision?.route || 'LOCAL'), provisional: Boolean(response?.provisional), latencyMs });
    recordCostMetric({ route: safeString(decision?.route || 'LOCAL'), costEstimate: Number(decision?.cost_estimate || 0) });
    if (fallbackReason) recordFallbackMetric(fallbackReason);
    const toolRuns = Array.isArray(response?.assistantTurn?.toolRuns) ? response.assistantTurn.toolRuns : [];
    const normalizedToolProposal = response?.toolProposal && typeof response.toolProposal === 'object'
        ? response.toolProposal
        : {
            tools_needed: toolRuns.map((toolRun) => safeString(toolRun?.toolName || '')).filter(Boolean),
            reason: safeString(response?.grounding?.mode || ''),
            max_tool_hops: toolRuns.length,
        };
    await persistAuditRecord(buildAuditRecord({
        decisionId,
        traceId,
        sessionId: safeString(response?.assistantSession?.sessionId || ''),
        route: safeString(decision?.route || 'LOCAL'),
        reasonSummary: safeString(decision?.reason_summary || ''),
        confidence: Number(decision?.confidence || 0),
        costEstimate: Number(decision?.cost_estimate || 0),
        latencyBudgetMs: Number(decision?.latency_budget_ms || 0),
        requiresConfirmation: Boolean(decision?.requires_confirmation),
        risk: safeString(decision?.risk || ''),
        complexity: Number(decision?.complexity || 0),
        fallbackReason,
        confirmationOutcome: response?.assistantSession?.pendingAction ? 'pending' : response?.assistantTurn?.policy?.decision === 'REJECT' ? 'rejected' : '',
        models: [safeString(response?.providerInfo?.model || response?.providerModel || response?.provider || '')].filter(Boolean),
        toolProposals: [normalizedToolProposal],
        toolsExecuted: toolRuns.map((toolRun) => safeString(toolRun?.toolName || '')).filter(Boolean),
        overrides: decision?.overrides || {},
        provisional: Boolean(response?.provisional),
        upgradeEligible: Boolean(response?.upgradeEligible),
        status: safeString(response?.grounding?.status || 'completed'),
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date().toISOString(),
        latencyMs,
    }));
    await recordSemanticMemory({ user, message, result: response, decision, decisionId });
    return latencyMs;
};

const processAssistantTurn = async ({
    user = null,
    message = '',
    conversationHistory = [],
    assistantMode = 'chat',
    sessionId = '',
    confirmation = null,
    actionRequest = null,
    context = {},
    images = [],
}) => {
    const startedAt = Date.now();
    const decisionId = createDecisionId();
    const traceId = createTraceId();
    const session = await resolveAssistantSession({ sessionId, context });
    const effectiveConfirmation = confirmation?.actionId ? confirmation : deriveImplicitConfirmation({ message, session });
    const decision = buildOrchestratorRouteDecision({ message, assistantMode, context, actionRequest, confirmation: effectiveConfirmation, images });
    const authoritativeContext = buildAuthoritativeContext({ context, session, orchestration: { decisionId, traceId, decision } });
    const disabledTools = Array.isArray(decision?.overrides?.disabledTools) ? decision.overrides.disabledTools : [];

    let recovered;
    let provisionalTurn = null;
    let fallbackReason = '';

    if (effectiveConfirmation?.actionId) {
        const validation = await validatePendingAction({
            session,
            actionId: effectiveConfirmation.actionId,
            contextVersion: effectiveConfirmation.contextVersion || session.pendingAction?.contextVersion || 0,
        });
        recovered = await processPendingAssistantConfirmation({
            confirmation: validation.ok ? effectiveConfirmation : { ...effectiveConfirmation, approved: false },
            context: { ...authoritativeContext, confirmationInput: message },
            sessionMemory: authoritativeContext.sessionMemory,
            pendingAction: validation.pendingAction,
        });
    } else if (decision.route === 'LOCAL') {
        recovered = await runLocalTurn({ user, message, conversationHistory, assistantMode, actionRequest, context: authoritativeContext });
    } else if (decision.route === 'CENTRAL') {
        recovered = await requestCentralIntelligenceTurn({
            user,
            message,
            conversationHistory: normalizeHistory(conversationHistory),
            assistantMode,
            context: authoritativeContext,
            images,
            session,
            traceId,
            decisionId,
            governanceContext: { disabledTools, latencyBudgetMs: decision.latency_budget_ms, maxCost: decision.cost_estimate, route: decision.route },
        });
        if (shouldFallbackToRecoveredTurn({ result: recovered, message, images })) {
            fallbackReason = safeString(recovered?.grounding?.reason || 'service_unavailable');
            recovered = await runLocalTurn({ user, message, conversationHistory, assistantMode, actionRequest, context: { ...authoritativeContext, centralIntelligenceFallback: { reason: fallbackReason, traceId } } });
        }
    } else {
        const provisionalResult = await runLocalTurn({ user, message, conversationHistory, assistantMode, actionRequest, context: { ...authoritativeContext, forceLocalProvisional: true } });
        provisionalTurn = await finalizeGovernedResult({ result: provisionalResult, decision, decisionId, traceId, session, context: authoritativeContext, confirmation: effectiveConfirmation, disabledTools, provisional: true, upgradeEligible: true });
        recovered = await requestCentralIntelligenceTurn({
            user,
            message,
            conversationHistory: normalizeHistory(conversationHistory),
            assistantMode,
            context: authoritativeContext,
            images,
            session,
            traceId,
            decisionId,
            governanceContext: { disabledTools, latencyBudgetMs: decision.latency_budget_ms, maxCost: decision.cost_estimate, route: decision.route },
        });
        if (shouldFallbackToRecoveredTurn({ result: recovered, message, images })) {
            fallbackReason = safeString(recovered?.grounding?.reason || 'service_unavailable');
            recovered = provisionalResult;
        }
    }

    const effectiveDecision = fallbackReason && safeString(decision?.route || 'LOCAL') !== 'LOCAL'
        ? { ...decision, route: 'LOCAL' }
        : decision;

    const response = await finalizeGovernedResult({
        result: recovered,
        decision: effectiveDecision,
        decisionId,
        traceId,
        session,
        context: authoritativeContext,
        confirmation: effectiveConfirmation,
        disabledTools,
        provisional: false,
        upgradeEligible: effectiveDecision.route === 'HYBRID',
        provisionalTurn: effectiveDecision.route === 'HYBRID' ? provisionalTurn : null,
    });
    const latencyMs = await persistGovernanceSideEffects({ response, decision: effectiveDecision, decisionId, traceId, startedAt, message, user, fallbackReason });
    return { ...response, providerCapabilities: getCapabilitySnapshot(), latencyMs, safetyFlags: Array.isArray(response?.assistantTurn?.safetyFlags) ? response.assistantTurn.safetyFlags : [] };
};

module.exports = {
    processAssistantTurn,
};
