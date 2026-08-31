const { randomUUID } = require('crypto');
const AssistantActionAudit = require('../../models/AssistantActionAudit');
const AssistantProductSnapshot = require('../../models/AssistantProductSnapshot');
const AssistantThread = require('../../models/AssistantThread');
const AssistantThreadMessage = require('../../models/AssistantThreadMessage');
const logger = require('../../utils/logger');

const DEFAULT_THREAD_TITLE = 'New chat';
const DEFAULT_THREAD_PREVIEW = 'Start a new assistant thread.';
const ACTIVE_PERSISTENCE_EXCHANGES_PATH = 'metadata.activePersistenceExchangeIds';
const CREATION_PERSISTENCE_EXCHANGE_PATH = 'metadata.creationPersistenceExchangeId';

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const buildPersistenceAbortError = (abortSignal = null) => {
    const error = new Error('assistant_request_aborted');
    error.name = 'AssistantAbortError';
    error.code = 'ASSISTANT_REQUEST_ABORTED';
    if (abortSignal?.reason instanceof Error) {
        error.cause = abortSignal.reason;
    }
    return error;
};

const throwIfPersistenceAborted = (abortSignal = null) => {
    if (abortSignal?.aborted) {
        throw buildPersistenceAbortError(abortSignal);
    }
};

const truncate = (value = '', max = 96) => {
    const normalized = safeString(value);
    if (!normalized) return '';
    return normalized.length > max ? `${normalized.slice(0, Math.max(1, max - 3)).trim()}...` : normalized;
};

const deriveThreadTitle = (firstUserMessage = '') => {
    const normalized = safeString(firstUserMessage);
    return normalized ? truncate(normalized, 34) : DEFAULT_THREAD_TITLE;
};

const buildPreview = (assistantText = '', fallback = DEFAULT_THREAD_PREVIEW) => {
    const normalized = safeString(assistantText);
    return normalized ? truncate(normalized, 96) : fallback;
};

const surfaceToMode = (surface = 'plain_answer') => {
    switch (surface) {
        case 'product_focus':
            return 'product';
        case 'cart_summary':
            return 'cart';
        case 'confirmation_card':
            return 'checkout';
        case 'support_handoff':
            return 'support';
        default:
            return 'explore';
    }
};

const mapThreadToSession = (thread = {}) => ({
    id: safeString(thread?.sessionId || ''),
    title: safeString(thread?.title || DEFAULT_THREAD_TITLE),
    preview: safeString(thread?.preview || DEFAULT_THREAD_PREVIEW),
    createdAt: thread?.createdAt ? new Date(thread.createdAt).getTime() : Date.now(),
    updatedAt: thread?.lastMessageAt ? new Date(thread.lastMessageAt).getTime() : (thread?.updatedAt ? new Date(thread.updatedAt).getTime() : Date.now()),
    originPath: safeString(thread?.originPath || '/', '/'),
    pinned: false,
    archived: safeString(thread?.status || 'active') === 'archived',
    route: safeString(thread?.lastRoute || ''),
    provider: safeString(thread?.lastProvider || ''),
});

const mapMessageToClient = (message = {}) => {
    const assistantTurn = message?.assistantTurn && typeof message.assistantTurn === 'object'
        ? message.assistantTurn
        : null;
    const ui = assistantTurn?.ui && typeof assistantTurn.ui === 'object' ? assistantTurn.ui : {};
    return {
        id: safeString(message?._id || ''),
        role: safeString(message?.role || 'assistant'),
        text: safeString(message?.content || assistantTurn?.response || ''),
        createdAt: message?.createdAt ? new Date(message.createdAt).getTime() : Date.now(),
        status: 'complete',
        isStreaming: false,
        provisional: false,
        upgraded: false,
        upgradeEligible: false,
        traceId: safeString(message?.grounding?.traceId || ''),
        decision: safeString(assistantTurn?.decision || ''),
        mode: surfaceToMode(ui?.surface || 'plain_answer'),
        uiSurface: safeString(ui?.surface || 'plain_answer'),
        assistantTurn,
        product: ui?.product || null,
        products: Array.isArray(ui?.products) ? ui.products : [],
        cartSummary: ui?.cartSummary || null,
        supportPrefill: ui?.support?.prefill || null,
        confirmation: ui?.confirmation || null,
        navigation: ui?.navigation || null,
        grounding: message?.grounding || null,
        providerInfo: {
            name: safeString(message?.provider || ''),
            model: safeString(message?.providerModel || ''),
        },
    };
};

const upsertAssistantThread = async ({
    userId,
    sessionId,
    assistantMode = 'chat',
    originPath = '/',
    title = '',
    preview = '',
    assistantSession = {},
    route = '',
    provider = '',
    providerModel = '',
    persistenceExchangeId = '',
    persistenceTimestamp = null,
} = {}) => {
    const normalizedSessionId = safeString(sessionId);
    if (!userId || !normalizedSessionId) {
        return null;
    }

    const lastMessageAt = persistenceTimestamp instanceof Date
        ? persistenceTimestamp
        : new Date();
    const normalizedExchangeId = safeString(persistenceExchangeId);

    return AssistantThread.findOneAndUpdate(
        { sessionId: normalizedSessionId, user: userId },
        {
            $setOnInsert: {
                sessionId: normalizedSessionId,
                user: userId,
                ...(normalizedExchangeId ? { [CREATION_PERSISTENCE_EXCHANGE_PATH]: normalizedExchangeId } : {}),
            },
            $set: {
                assistantMode: safeString(assistantMode || 'chat'),
                originPath: safeString(originPath || '/', '/'),
                title: safeString(title || DEFAULT_THREAD_TITLE),
                preview: safeString(preview || DEFAULT_THREAD_PREVIEW),
                lastRoute: safeString(route || ''),
                lastProvider: safeString(provider || ''),
                lastProviderModel: safeString(providerModel || ''),
                lastMessageAt,
                assistantSessionState: assistantSession && typeof assistantSession === 'object' ? assistantSession : {},
                ...(normalizedExchangeId ? { 'metadata.lastPersistenceExchangeId': normalizedExchangeId } : {}),
            },
            ...(normalizedExchangeId ? {
                $addToSet: {
                    [ACTIVE_PERSISTENCE_EXCHANGES_PATH]: normalizedExchangeId,
                },
            } : {}),
        },
        {
            returnDocument: 'after',
            upsert: true,
            lean: true,
        }
    );
};

const rollbackAbortedExchange = async ({
    thread = null,
    previousThread = null,
    createdMessages = [],
    messageCountIncremented = false,
    persistenceExchangeId = '',
    persistenceTimestamp = null,
} = {}) => {
    if (!thread?._id || !safeString(persistenceExchangeId)) return;

    const messageIds = (Array.isArray(createdMessages) ? createdMessages : [])
        .map((message) => message?._id)
        .filter(Boolean);
    const assistantMessageIds = (Array.isArray(createdMessages) ? createdMessages : [])
        .filter((message) => safeString(message?.role) === 'assistant')
        .map((message) => message?._id)
        .filter(Boolean);

    if (assistantMessageIds.length > 0) {
        await Promise.all([
            AssistantProductSnapshot.deleteMany({
                thread: thread._id,
                message: { $in: assistantMessageIds },
            }),
            AssistantActionAudit.deleteMany({
                thread: thread._id,
                message: { $in: assistantMessageIds },
            }),
        ]);
    }

    if (messageIds.length > 0) {
        await AssistantThreadMessage.deleteMany({
            thread: thread._id,
            _id: { $in: messageIds },
        });
    }

    const activeExchangePull = {
        [ACTIVE_PERSISTENCE_EXCHANGES_PATH]: safeString(persistenceExchangeId),
    };

    if (messageCountIncremented && messageIds.length > 0) {
        await AssistantThread.updateOne(
            {
                _id: thread._id,
                messageCount: { $gte: messageIds.length },
            },
            {
                $inc: { messageCount: -messageIds.length },
                $pull: activeExchangePull,
            },
        );
    } else {
        await AssistantThread.updateOne(
            { _id: thread._id },
            { $pull: activeExchangePull },
        );
    }

    const exchangeGuard = {
        _id: thread._id,
        'metadata.lastPersistenceExchangeId': safeString(persistenceExchangeId),
        [ACTIVE_PERSISTENCE_EXCHANGES_PATH]: { $size: 0 },
        ...(persistenceTimestamp instanceof Date ? { lastMessageAt: persistenceTimestamp } : {}),
    };

    if (!previousThread?._id) {
        await AssistantThread.deleteOne({
            ...exchangeGuard,
            [CREATION_PERSISTENCE_EXCHANGE_PATH]: safeString(persistenceExchangeId),
            messageCount: { $lte: 0 },
        });
        return;
    }

    await AssistantThread.updateOne(
        exchangeGuard,
        {
            $set: {
                assistantMode: previousThread.assistantMode,
                originPath: previousThread.originPath,
                title: previousThread.title,
                preview: previousThread.preview,
                lastRoute: previousThread.lastRoute,
                lastProvider: previousThread.lastProvider,
                lastProviderModel: previousThread.lastProviderModel,
                lastMessageAt: previousThread.lastMessageAt,
                assistantSessionState: previousThread.assistantSessionState || {},
                metadata: previousThread.metadata || {},
            },
        },
    );
};

const persistAssistantExchange = async ({
    user = null,
    sessionId = '',
    assistantMode = 'chat',
    context = {},
    userMessage = '',
    assistantTurn = null,
    responseText = '',
    route = '',
    provider = '',
    providerModel = '',
    retrievalProducts = [],
    retrievalHitCount = 0,
    grounding = {},
    assistantSession = {},
    actionAuditStatus = 'proposed',
    abortSignal = null,
} = {}) => {
    const userId = user?._id;
    const normalizedSessionId = safeString(sessionId);
    if (!userId || !normalizedSessionId) {
        return null;
    }

    throwIfPersistenceAborted(abortSignal);
    const persistenceExchangeId = randomUUID();
    const persistenceTimestamp = new Date();
    const title = deriveThreadTitle(userMessage);
    const preview = buildPreview(responseText);
    const previousThread = await AssistantThread.findOne({
        sessionId: normalizedSessionId,
        user: userId,
    }).lean();
    throwIfPersistenceAborted(abortSignal);

    let thread = null;
    const createdMessages = [];
    let messageCountIncremented = false;

    try {
        thread = await upsertAssistantThread({
            userId,
            sessionId: normalizedSessionId,
            assistantMode,
            originPath: safeString(context?.route || '/', '/'),
            title,
            preview,
            assistantSession,
            route,
            provider,
            providerModel,
            persistenceExchangeId,
            persistenceTimestamp,
        });
        throwIfPersistenceAborted(abortSignal);

        if (safeString(userMessage)) {
            const userDoc = await AssistantThreadMessage.create({
                thread: thread._id,
                user: userId,
                sessionId: normalizedSessionId,
                role: 'user',
                content: safeString(userMessage),
                route: safeString(route || ''),
                metadata: {
                    originPath: safeString(context?.route || '/', '/'),
                },
            });
            createdMessages.push(userDoc);
            throwIfPersistenceAborted(abortSignal);
        }

        const assistantDoc = await AssistantThreadMessage.create({
            thread: thread._id,
            user: userId,
            sessionId: normalizedSessionId,
            role: 'assistant',
            content: safeString(responseText || assistantTurn?.response || ''),
            route: safeString(route || ''),
            provider: safeString(provider || ''),
            providerModel: safeString(providerModel || ''),
            retrievalHitCount: Math.max(0, Number(retrievalHitCount || 0)),
            assistantTurn: assistantTurn && typeof assistantTurn === 'object' ? assistantTurn : null,
            grounding: grounding && typeof grounding === 'object' ? grounding : null,
        });
        createdMessages.push(assistantDoc);
        throwIfPersistenceAborted(abortSignal);

        if (Array.isArray(retrievalProducts) && retrievalProducts.length > 0) {
            await AssistantProductSnapshot.insertMany(retrievalProducts.map((entry = {}) => ({
                thread: thread._id,
                message: assistantDoc._id,
                user: userId,
                sessionId: normalizedSessionId,
                productId: safeString(entry?.id || ''),
                score: Number(entry?.score || 0),
                source: 'retrieval',
                snapshot: entry,
            })));
            throwIfPersistenceAborted(abortSignal);
        }

        const actionItems = Array.isArray(assistantTurn?.actions) ? assistantTurn.actions : [];
        const confirmationAction = assistantTurn?.ui?.confirmation?.action;
        const actionsToPersist = confirmationAction
            ? [confirmationAction, ...actionItems]
            : actionItems;

        if (actionsToPersist.length > 0) {
            await AssistantActionAudit.insertMany(actionsToPersist.map((action = {}) => ({
                thread: thread._id,
                message: assistantDoc._id,
                user: userId,
                sessionId: normalizedSessionId,
                actionType: safeString(action?.type || ''),
                status: safeString(actionAuditStatus || 'proposed'),
                requiresConfirmation: Boolean(action?.requiresConfirmation || assistantTurn?.ui?.confirmation?.action?.type === action?.type),
                payload: action,
                result: {},
            })));
            throwIfPersistenceAborted(abortSignal);
        }

        await AssistantThread.updateOne(
            { _id: thread._id },
            {
                $set: {
                    preview,
                    lastRoute: safeString(route || ''),
                    lastProvider: safeString(provider || ''),
                    lastProviderModel: safeString(providerModel || ''),
                    lastMessageAt: persistenceTimestamp,
                    assistantSessionState: assistantSession && typeof assistantSession === 'object' ? assistantSession : {},
                    'metadata.lastPersistenceExchangeId': persistenceExchangeId,
                },
                $inc: {
                    messageCount: createdMessages.length,
                },
                $pull: {
                    [ACTIVE_PERSISTENCE_EXCHANGES_PATH]: persistenceExchangeId,
                },
            }
        );
        messageCountIncremented = true;
        throwIfPersistenceAborted(abortSignal);

        return {
            thread,
            persistedMessageIds: createdMessages.map((message) => String(message._id)),
        };
    } catch (error) {
        if (abortSignal?.aborted) {
            try {
                await rollbackAbortedExchange({
                    thread,
                    previousThread,
                    createdMessages,
                    messageCountIncremented,
                    persistenceExchangeId,
                    persistenceTimestamp,
                });
            } catch (rollbackError) {
                logger.error('assistant.persistence.abort_rollback_failed', {
                    error: rollbackError.message,
                    sessionId: normalizedSessionId,
                });
            }
            throw buildPersistenceAbortError(abortSignal);
        }
        throw error;
    }
};

const listAssistantThreads = async ({ userId, includeArchived = false, limit = 50 } = {}) => {
    if (!userId) return [];

    const threads = await AssistantThread.find({
        user: userId,
        ...(includeArchived ? {} : { status: 'active' }),
    })
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .limit(Math.max(1, Number(limit || 50)))
        .lean();

    return threads.map((thread) => mapThreadToSession(thread));
};

const loadAssistantThread = async ({ userId, sessionId } = {}) => {
    if (!userId || !safeString(sessionId)) return null;

    const thread = await AssistantThread.findOne({
        user: userId,
        sessionId: safeString(sessionId),
    }).lean();

    if (!thread) return null;

    const messages = await AssistantThreadMessage.find({
        user: userId,
        sessionId: safeString(sessionId),
    })
        .sort({ createdAt: 1 })
        .lean();

    return {
        session: mapThreadToSession(thread),
        assistantSession: thread.assistantSessionState || {},
        messages: messages.map((message) => mapMessageToClient(message)),
    };
};

const resetAssistantThread = async ({ userId, sessionId } = {}) => {
    if (!userId || !safeString(sessionId)) return null;

    const thread = await AssistantThread.findOne({
        user: userId,
        sessionId: safeString(sessionId),
    });

    if (!thread) return null;

    await Promise.all([
        AssistantThreadMessage.deleteMany({ thread: thread._id }),
        AssistantProductSnapshot.deleteMany({ thread: thread._id }),
        AssistantActionAudit.deleteMany({ thread: thread._id }),
    ]);

    thread.messageCount = 0;
    thread.preview = DEFAULT_THREAD_PREVIEW;
    thread.title = thread.title || DEFAULT_THREAD_TITLE;
    thread.assistantSessionState = {};
    thread.lastMessageAt = new Date();
    await thread.save();

    return mapThreadToSession(thread.toObject());
};

const archiveAssistantThread = async ({ userId, sessionId } = {}) => {
    if (!userId || !safeString(sessionId)) return null;

    const thread = await AssistantThread.findOneAndUpdate(
        {
            user: userId,
            sessionId: safeString(sessionId),
        },
        {
            $set: {
                status: 'archived',
                lastMessageAt: new Date(),
            },
        },
        {
            returnDocument: 'after',
            lean: true,
        }
    );

    return thread ? mapThreadToSession(thread) : null;
};

module.exports = {
    archiveAssistantThread,
    listAssistantThreads,
    loadAssistantThread,
    persistAssistantExchange,
    resetAssistantThread,
    upsertAssistantThread,
};
