const {
    createVoiceSessionConfig,
    getCapabilitySnapshot,
    synthesizeSpeech,
} = require('./providerRegistry');
const {
    processExplicitAssistantAction,
    processPendingAssistantConfirmation,
    processRecoveredAssistantTurn,
} = require('./assistantRecoveryService');
const {
    requestCentralIntelligenceTurn,
    shouldUseCentralIntelligence,
    streamCentralIntelligenceTurn,
} = require('../intelligence/intelligenceGatewayService');
const {
    createActionId,
    markActionExecuted,
    resolveAssistantSession,
    toSessionMemory,
    updateAssistantSession,
    validatePendingAction,
} = require('./assistantSessionService');

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const SYSTEM_AWARENESS_PATTERN = /\b(app|architecture|backend|bug|client|code|component|controller|db|debug|diagnostic|endpoint|error|explain|file|flow|frontend|function|graph|health|how does|implementation|index|issue|line by line|model|orchestrat|path|repo|route|schema|service|socket|support video|system|trace|where is|why .*fail(?:ing|ed|s|ure)?)\b/i;
const CENTRAL_FAILURE_RECOVERY_REASONS = new Set(['service_unavailable']);
const INLINE_CONFIRM_PATTERN = /^(yes|yeah|yep|ok|okay|confirm|go ahead|proceed|continue|do it)$/i;
const INLINE_REJECT_PATTERN = /^(no|nope|cancel|stop|not now)$/i;
const LOCAL_ROUTE_QUERY_PATTERN = /\b(?:what|which)\s+(?:route|path|url)\b|where is\b.*\bworkspace\b/i;
const LOCAL_ROUTE_TARGET_PATTERN = /\b(assistant workspace|assistant|visual search|marketplace|wishlist|orders|checkout|compare|bundles|mission control|price alerts|sell|become seller|login)\b/i;

const normalizeHistory = (conversationHistory = []) => (
    Array.isArray(conversationHistory)
        ? conversationHistory
            .slice(-8)
            .map((entry) => ({
                role: safeString(entry?.role || 'user'),
                content: safeString(entry?.content || ''),
            }))
            .filter((entry) => entry.content)
        : []
);

const deriveContextPath = ({ assistantTurn = {}, context = {}, session = {} } = {}) => {
    if (safeString(assistantTurn?.ui?.navigation?.path || '')) {
        return safeString(assistantTurn.ui.navigation.path);
    }

    if (safeString(assistantTurn?.entities?.category || '')) {
        return safeString(assistantTurn.entities.category);
    }

    return safeString(context?.route || session?.contextPath || context?.routeLabel || '');
};

const buildAuthoritativeContext = ({ context = {}, session = {} } = {}) => ({
    ...context,
    assistantSession: session,
    sessionMemory: {
        ...toSessionMemory(session),
        lastActionFingerprint: safeString(context?.sessionMemory?.lastActionFingerprint || ''),
        lastActionAt: Math.max(0, Number(context?.sessionMemory?.lastActionAt || 0)),
    },
});

const shouldFallbackToRecoveredTurn = ({
    result = {},
    message = '',
    images = [],
    streamedEventCount = 0,
} = {}) => {
    const status = safeString(result?.grounding?.status || '');
    const reason = safeString(result?.grounding?.reason || '');

    if (status !== 'cannot_verify') {
        return false;
    }

    if (!CENTRAL_FAILURE_RECOVERY_REASONS.has(reason)) {
        return false;
    }

    if (Array.isArray(images) && images.length > 0) {
        return false;
    }

    if (Number(streamedEventCount || 0) > 0) {
        return false;
    }

    if (SYSTEM_AWARENESS_PATTERN.test(safeString(message))) {
        return LOCAL_ROUTE_QUERY_PATTERN.test(safeString(message))
            && LOCAL_ROUTE_TARGET_PATTERN.test(safeString(message));
    }

    return true;
};

const deriveImplicitConfirmation = ({
    message = '',
    session = {},
} = {}) => {
    const pendingAction = session?.pendingAction && typeof session.pendingAction === 'object'
        ? session.pendingAction
        : null;
    const normalized = safeString(message);

    if (!pendingAction?.actionId || !normalized) {
        return null;
    }

    if (INLINE_CONFIRM_PATTERN.test(normalized)) {
        return {
            actionId: pendingAction.actionId,
            approved: true,
            contextVersion: pendingAction.contextVersion || session?.contextVersion || 0,
        };
    }

    if (INLINE_REJECT_PATTERN.test(normalized)) {
        return {
            actionId: pendingAction.actionId,
            approved: false,
            contextVersion: pendingAction.contextVersion || session?.contextVersion || 0,
        };
    }

    return null;
};

const finalizeAssistantTurnSession = ({
    result = {},
    session = {},
    context = {},
    confirmation = null,
}) => {
    const assistantTurn = result?.assistantTurn || {};
    const assistantSessionPatch = {
        lastIntent: safeString(assistantTurn?.intent || session?.lastIntent || ''),
        lastEntities: assistantTurn?.entities || session?.lastEntities || {},
        contextPath: deriveContextPath({
            assistantTurn,
            context,
            session,
        }),
        clarificationState: assistantTurn?.sessionMemory?.clarificationState || session?.clarificationState || {},
        lastResolvedEntityId: safeString(
            assistantTurn?.entities?.productId
            || assistantTurn?.ui?.product?.id
            || assistantTurn?.sessionMemory?.activeProduct?.id
            || session?.lastResolvedEntityId
            || ''
        ),
        lastResults: assistantTurn?.sessionMemory?.lastResults !== undefined
            ? assistantTurn.sessionMemory.lastResults
            : session?.lastResults || [],
        activeProduct: assistantTurn?.sessionMemory?.activeProduct !== undefined
            ? assistantTurn.sessionMemory.activeProduct
            : session?.activeProduct || null,
    };

    let nextSession = session;
    const confirmationAction = assistantTurn?.ui?.confirmation?.action && typeof assistantTurn.ui.confirmation.action === 'object'
        ? assistantTurn.ui.confirmation.action
        : null;

    if (confirmationAction?.type) {
        nextSession = updateAssistantSession({
            sessionId: session.sessionId,
            baseSession: session,
            patch: {
                ...assistantSessionPatch,
                incrementContextVersion: true,
            },
        });
        const actionId = createActionId({
            intent: assistantTurn.intent,
            entities: assistantTurn.entities,
            contextVersion: nextSession.contextVersion,
            seed: Date.now(),
        });
        const pendingAction = {
            actionId,
            actionType: safeString(assistantTurn?.policy?.actionType || confirmationAction.type || ''),
            risk: safeString(assistantTurn?.policy?.risk || ''),
            contextVersion: nextSession.contextVersion,
            intent: safeString(assistantTurn?.intent || ''),
            message: safeString(assistantTurn?.response || ''),
            action: {
                ...confirmationAction,
                actionId,
                contextVersion: nextSession.contextVersion,
            },
            entities: assistantTurn?.entities || {},
            createdAt: Date.now(),
        };
        nextSession = updateAssistantSession({
            sessionId: nextSession.sessionId,
            baseSession: nextSession,
            patch: {
                pendingAction,
            },
        });

        assistantTurn.ui = {
            ...(assistantTurn.ui || {}),
            confirmation: {
                ...(assistantTurn.ui?.confirmation || {}),
                token: actionId,
                action: pendingAction.action,
            },
        };
    } else if (confirmation?.approved === true) {
        nextSession = updateAssistantSession({
            sessionId: session.sessionId,
            baseSession: session,
            patch: assistantSessionPatch,
        });
        nextSession = markActionExecuted({
            sessionId: nextSession.sessionId,
            baseSession: nextSession,
            actionId: confirmation.actionId,
        });
    } else if (confirmation?.approved === false) {
        nextSession = updateAssistantSession({
            sessionId: session.sessionId,
            baseSession: session,
            patch: {
                ...assistantSessionPatch,
                pendingAction: null,
                incrementContextVersion: true,
            },
        });
    } else {
        nextSession = updateAssistantSession({
            sessionId: session.sessionId,
            baseSession: session,
            patch: {
                ...assistantSessionPatch,
                incrementContextVersion: true,
            },
        });
    }

    assistantTurn.assistantSession = nextSession;
    assistantTurn.sessionMemory = {
        ...(assistantTurn.sessionMemory || {}),
        ...toSessionMemory(nextSession),
    };

    return {
        ...result,
        assistantTurn,
        assistantSession: nextSession,
        sessionMemory: assistantTurn.sessionMemory,
        grounding: {
            ...(result?.grounding || {}),
            sessionId: nextSession.sessionId,
            contextVersion: nextSession.contextVersion,
        },
    };
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
    const resolvedSession = resolveAssistantSession({
        sessionId,
        context,
    });
    const effectiveConfirmation = confirmation?.actionId
        ? confirmation
        : deriveImplicitConfirmation({
            message,
            session: resolvedSession,
        });
    const authoritativeContext = buildAuthoritativeContext({
        context,
        session: resolvedSession,
    });

    let recovered;
    if (effectiveConfirmation?.actionId) {
        const validation = validatePendingAction({
            session: resolvedSession,
            actionId: effectiveConfirmation.actionId,
            contextVersion: effectiveConfirmation.contextVersion || resolvedSession.pendingAction?.contextVersion || 0,
        });

        if (!validation.ok) {
            recovered = await processPendingAssistantConfirmation({
                confirmation: {
                    ...effectiveConfirmation,
                    approved: false,
                },
                context: {
                    ...authoritativeContext,
                    confirmationInput: message,
                },
                sessionMemory: authoritativeContext.sessionMemory,
                pendingAction: validation.pendingAction,
            });
        } else {
            recovered = await processPendingAssistantConfirmation({
                confirmation: effectiveConfirmation,
                context: {
                    ...authoritativeContext,
                    confirmationInput: message,
                },
                sessionMemory: authoritativeContext.sessionMemory,
                pendingAction: validation.pendingAction,
            });
        }
    } else if (shouldUseCentralIntelligence({
        message,
        confirmation: effectiveConfirmation,
        actionRequest,
        assistantMode,
        context: authoritativeContext,
    })) {
        recovered = await requestCentralIntelligenceTurn({
            user,
            message,
            conversationHistory: normalizeHistory(conversationHistory),
            assistantMode,
            context: authoritativeContext,
            images,
            session: resolvedSession,
        });

        if (shouldFallbackToRecoveredTurn({
            result: recovered,
            message,
            images,
        })) {
            recovered = await processRecoveredAssistantTurn({
                user,
                message,
                conversationHistory: normalizeHistory(conversationHistory),
                assistantMode,
                context: {
                    ...authoritativeContext,
                    centralIntelligenceFallback: {
                        reason: safeString(recovered?.grounding?.reason || ''),
                        traceId: safeString(recovered?.grounding?.traceId || ''),
                    },
                },
                images,
            });
        }
    } else if (actionRequest?.type) {
        recovered = await processExplicitAssistantAction({
            actionRequest,
            assistantMode,
            context: authoritativeContext,
        });
    } else {
        recovered = await processRecoveredAssistantTurn({
            user,
            message,
            conversationHistory: normalizeHistory(conversationHistory),
            assistantMode,
            context: authoritativeContext,
            images,
        });
    }

    const finalized = finalizeAssistantTurnSession({
        result: recovered,
        session: resolvedSession,
        context: authoritativeContext,
        confirmation: effectiveConfirmation,
    });

    return {
        ...finalized,
        providerCapabilities: getCapabilitySnapshot(),
        latencyMs: Date.now() - startedAt,
        safetyFlags: Array.isArray(finalized?.assistantTurn?.safetyFlags)
            ? finalized.assistantTurn.safetyFlags
            : [],
    };
};

const streamAssistantTurn = async ({
    user = null,
    message = '',
    conversationHistory = [],
    assistantMode = 'chat',
    sessionId = '',
    confirmation = null,
    actionRequest = null,
    context = {},
    images = [],
    writeEvent = () => {},
}) => {
    const startedAt = Date.now();
    const resolvedSession = resolveAssistantSession({
        sessionId,
        context,
    });
    const effectiveConfirmation = confirmation?.actionId
        ? confirmation
        : deriveImplicitConfirmation({
            message,
            session: resolvedSession,
        });
    const authoritativeContext = buildAuthoritativeContext({
        context,
        session: resolvedSession,
    });

    if (shouldUseCentralIntelligence({
        message,
        confirmation: effectiveConfirmation,
        actionRequest,
        assistantMode,
        context: authoritativeContext,
    })) {
        let streamedEventCount = 0;
        const trackedWriteEvent = (eventName, payload) => {
            if (eventName !== 'final_turn') {
                streamedEventCount += 1;
            }
            writeEvent(eventName, payload);
        };

        let recovered = await streamCentralIntelligenceTurn({
            user,
            message,
            conversationHistory: normalizeHistory(conversationHistory),
            assistantMode,
            context: authoritativeContext,
            images,
            session: resolvedSession,
            writeEvent: trackedWriteEvent,
        });

        if (shouldFallbackToRecoveredTurn({
            result: recovered,
            message,
            images,
            streamedEventCount,
        })) {
            recovered = await processRecoveredAssistantTurn({
                user,
                message,
                conversationHistory: normalizeHistory(conversationHistory),
                assistantMode,
                context: {
                    ...authoritativeContext,
                    centralIntelligenceFallback: {
                        reason: safeString(recovered?.grounding?.reason || ''),
                        traceId: safeString(recovered?.grounding?.traceId || ''),
                    },
                },
                images,
            });
        }

        const finalized = finalizeAssistantTurnSession({
            result: recovered,
            session: resolvedSession,
            context: authoritativeContext,
            confirmation: effectiveConfirmation,
        });

        const response = {
            ...finalized,
            providerCapabilities: getCapabilitySnapshot(),
            latencyMs: Date.now() - startedAt,
            safetyFlags: Array.isArray(finalized?.assistantTurn?.safetyFlags)
                ? finalized.assistantTurn.safetyFlags
                : [],
        };

        writeEvent('final_turn', response);
        return response;
    }

    const result = await processAssistantTurn({
        user,
        message,
        conversationHistory,
        assistantMode,
        sessionId,
        confirmation: effectiveConfirmation,
        actionRequest,
        context,
        images,
    });

    writeEvent('final_turn', result);
    return result;
};

module.exports = {
    createVoiceSessionConfig,
    processAssistantTurn,
    streamAssistantTurn,
    synthesizeVoiceReply: synthesizeSpeech,
};
