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
        recovered = await requestCentralIntelligenceTurn({
            user,
            message,
            conversationHistory: normalizeHistory(conversationHistory),
            assistantMode,
            context: authoritativeContext,
            images,
            session: resolvedSession,
        });
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

    if (shouldUseCentralIntelligence({
        message,
        confirmation,
        actionRequest,
        assistantMode,
        context: authoritativeContext,
    })) {
        const recovered = await streamCentralIntelligenceTurn({
            user,
            message,
            conversationHistory: normalizeHistory(conversationHistory),
            assistantMode,
            context: authoritativeContext,
            images,
            session: resolvedSession,
            writeEvent,
        });

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

        writeEvent('final_turn', response);
        return response;
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

    writeEvent('final_turn', result);
    return result;
};

module.exports = {
    createVoiceSessionConfig,
    processAssistantTurn,
    streamAssistantTurn,
    synthesizeVoiceReply: synthesizeSpeech,
};
