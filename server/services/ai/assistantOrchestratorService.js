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
const { sendMessageToUser } = require('../socketService');

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const SYSTEM_AWARENESS_PATTERN = /\b(app|architecture|backend|bug|client|code|component|controller|db|debug|diagnostic|endpoint|error|explain|file|flow|frontend|function|graph|health|how does|implementation|index|issue|line by line|model|orchestrat|path|repo|route|schema|service|socket|support video|system|trace|where is|why .*fail(?:ing|ed|s|ure)?)\b/i;
const CENTRAL_FAILURE_RECOVERY_REASONS = new Set(['service_unavailable']);

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

    return !SYSTEM_AWARENESS_PATTERN.test(safeString(message));
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
    decision,
    provisional: Boolean(provisional),
    upgradeEligible: Boolean(upgradeEligible),
    traceId: safeString(traceId || ''),
});

const decorateAssistantResult = (result = {}, meta = {}) => {
    const traceId = safeString(result?.grounding?.traceId || result?.traceId || meta?.traceId || '');

    return {
        ...result,
        sessionId: safeString(meta?.sessionId || ''),
        messageId: safeString(meta?.messageId || ''),
        decision: safeString(meta?.decision || 'LOCAL') || 'LOCAL',
        provisional: Boolean(meta?.provisional),
        upgradeEligible: Boolean(meta?.upgradeEligible),
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
                conversationHistory,
                assistantMode,
                context,
                images,
                session,
            });

            if (!refined?.assistantTurn || !isPureRespondTurn(refined.assistantTurn)) {
                return;
            }

            sendMessageToUser(userId, 'assistant.upgrade', {
                sessionId,
                messageId,
                content: safeString(refined?.assistantTurn?.response || refined?.answer || ''),
                citations: Array.isArray(refined?.assistantTurn?.citations) ? refined.assistantTurn.citations : [],
                verification: refined?.assistantTurn?.verification || null,
                providerInfo: refined?.providerInfo || {
                    name: safeString(refined?.provider || ''),
                    model: safeString(refined?.providerModel || ''),
                },
                decision: 'HYBRID',
                traceId: safeString(refined?.grounding?.traceId || ''),
                grounding: refined?.grounding || null,
                assistantTurn: refined?.assistantTurn || null,
            });
        } catch (_) {
            // Refined upgrades are best-effort and should not affect the primary turn.
        }
    }, 0);
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
    const authoritativeContext = buildAuthoritativeContext({
        context,
        session: resolvedSession,
    });
    let responseDecision = 'LOCAL';

    let recovered;
    if (confirmation?.actionId) {
        const validation = validatePendingAction({
            session: resolvedSession,
            actionId: confirmation.actionId,
            contextVersion: confirmation.contextVersion || resolvedSession.pendingAction?.contextVersion || 0,
        });

        if (!validation.ok) {
            recovered = await processPendingAssistantConfirmation({
                confirmation: {
                    ...confirmation,
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
                confirmation,
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
        confirmation,
        actionRequest,
        assistantMode,
        context: authoritativeContext,
    })) {
        responseDecision = 'CENTRAL';
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
            responseDecision = 'LOCAL';
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
        confirmation,
    });

    return {
        ...finalized,
        providerCapabilities: getCapabilitySnapshot(),
        latencyMs: Date.now() - startedAt,
        safetyFlags: Array.isArray(finalized?.assistantTurn?.safetyFlags)
            ? finalized.assistantTurn.safetyFlags
            : [],
        sessionId: resolveRealtimeSessionId({ context: authoritativeContext, session: resolvedSession }),
        messageId: resolveRealtimeMessageId(authoritativeContext),
        decision: responseDecision,
        provisional: false,
        upgradeEligible: false,
        traceId: safeString(finalized?.grounding?.traceId || ''),
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
    const authoritativeContext = buildAuthoritativeContext({
        context,
        session: resolvedSession,
    });
    const normalizedConversationHistory = normalizeHistory(conversationHistory);
    const baseRealtimeMeta = {
        context: authoritativeContext,
        session: resolvedSession,
    };
    const canUseCentral = shouldUseCentralIntelligence({
        message,
        confirmation,
        actionRequest,
        assistantMode,
        context: authoritativeContext,
    });
    const canScheduleRefinedUpgrade = Boolean(
        safeString(user?._id || '')
        && resolveRealtimeSessionId(baseRealtimeMeta)
        && resolveRealtimeMessageId(authoritativeContext)
        && !confirmation?.actionId
        && !actionRequest?.type
        && assistantMode !== 'voice'
        && canUseCentral
    );

    if (canScheduleRefinedUpgrade) {
        const recovered = await processRecoveredAssistantTurn({
            user,
            message,
            conversationHistory: normalizedConversationHistory,
            assistantMode,
            context: authoritativeContext,
            images,
        });
        const finalized = finalizeAssistantTurnSession({
            result: recovered,
            session: resolvedSession,
            context: authoritativeContext,
            confirmation,
        });
        const upgradeEligible = isPureRespondTurn(finalized?.assistantTurn || {});
        const response = decorateAssistantResult({
            ...finalized,
            providerCapabilities: getCapabilitySnapshot(),
            latencyMs: Date.now() - startedAt,
            safetyFlags: Array.isArray(finalized?.assistantTurn?.safetyFlags)
                ? finalized.assistantTurn.safetyFlags
                : [],
        }, buildRealtimeEnvelope({
            ...baseRealtimeMeta,
            decision: upgradeEligible ? 'HYBRID' : 'LOCAL',
            provisional: upgradeEligible,
            upgradeEligible,
            traceId: safeString(finalized?.grounding?.traceId || ''),
        }));

        writeEvent('message_meta', buildRealtimeEnvelope({
            ...baseRealtimeMeta,
            decision: response.decision,
            provisional: response.provisional,
            upgradeEligible: response.upgradeEligible,
            traceId: response.traceId,
        }));
        streamPlainTextReply({
            writeEvent,
            sessionId: response.sessionId,
            messageId: response.messageId,
            text: response?.assistantTurn?.response || response?.answer || '',
        });
        writeEvent('final_turn', response);

        if (upgradeEligible) {
            scheduleRefinedAssistantUpgrade({
                user,
                message,
                conversationHistory: normalizedConversationHistory,
                assistantMode,
                context: authoritativeContext,
                images,
                session: resolvedSession,
            });
        }

        return response;
    }

    if (canUseCentral) {
        let streamedEventCount = 0;
        let usedFallbackRecovery = false;
        writeEvent('message_meta', buildRealtimeEnvelope({
            ...baseRealtimeMeta,
            decision: 'CENTRAL',
            provisional: false,
            upgradeEligible: false,
        }));
        const trackedWriteEvent = (eventName, payload) => {
            if (eventName !== 'final_turn') {
                streamedEventCount += 1;
            }
            writeEvent(eventName, {
                ...(payload || {}),
                sessionId: safeString(payload?.sessionId || resolveRealtimeSessionId(baseRealtimeMeta)),
                messageId: safeString(payload?.messageId || resolveRealtimeMessageId(authoritativeContext)),
            });
        };

        let recovered = await streamCentralIntelligenceTurn({
            user,
            message,
            conversationHistory: normalizedConversationHistory,
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
            usedFallbackRecovery = true;
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
            confirmation,
        });

        const response = {
            ...finalized,
            providerCapabilities: getCapabilitySnapshot(),
            latencyMs: Date.now() - startedAt,
            safetyFlags: Array.isArray(finalized?.assistantTurn?.safetyFlags)
                ? finalized.assistantTurn.safetyFlags
                : [],
        };
        const decoratedResponse = decorateAssistantResult(response, buildRealtimeEnvelope({
            ...baseRealtimeMeta,
            decision: usedFallbackRecovery ? 'LOCAL' : 'CENTRAL',
            provisional: false,
            upgradeEligible: false,
            traceId: safeString(response?.grounding?.traceId || ''),
        }));

        if (usedFallbackRecovery) {
            writeEvent('message_meta', buildRealtimeEnvelope({
                ...baseRealtimeMeta,
                decision: 'LOCAL',
                provisional: false,
                upgradeEligible: false,
                traceId: decoratedResponse.traceId,
            }));
            streamPlainTextReply({
                writeEvent,
                sessionId: decoratedResponse.sessionId,
                messageId: decoratedResponse.messageId,
                text: decoratedResponse?.assistantTurn?.response || decoratedResponse?.answer || '',
            });
        }

        writeEvent('final_turn', decoratedResponse);
        return decoratedResponse;
    }

    const result = await processAssistantTurn({
        user,
        message,
        conversationHistory,
        assistantMode,
        sessionId,
        confirmation,
        actionRequest,
        context,
        images,
    });
    const decoratedResult = decorateAssistantResult(result, buildRealtimeEnvelope({
        ...baseRealtimeMeta,
        decision: safeString(result?.decision || 'LOCAL') || 'LOCAL',
        provisional: false,
        upgradeEligible: false,
        traceId: safeString(result?.traceId || result?.grounding?.traceId || ''),
    }));

    writeEvent('message_meta', buildRealtimeEnvelope({
        ...baseRealtimeMeta,
        decision: decoratedResult.decision,
        provisional: false,
        upgradeEligible: false,
        traceId: decoratedResult.traceId,
    }));
    streamPlainTextReply({
        writeEvent,
        sessionId: decoratedResult.sessionId,
        messageId: decoratedResult.messageId,
        text: decoratedResult?.assistantTurn?.response || decoratedResult?.answer || '',
    });
    writeEvent('final_turn', decoratedResult);
    return decoratedResult;
};

module.exports = {
    createVoiceSessionConfig,
    processAssistantTurn,
    streamAssistantTurn,
    synthesizeVoiceReply: synthesizeSpeech,
};
