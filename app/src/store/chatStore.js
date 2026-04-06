import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const CHAT_STORAGE_KEY = 'aura-shopper-chat-v4';
const LEGACY_CHAT_STORAGE_KEY = 'aura-shopper-chat-v3';
const MAX_PERSISTED_MESSAGES = 36;
const MAX_VISIBLE_ACTIONS = 3;
const DEFAULT_SESSION_TITLE = 'New chat';
const DEFAULT_SESSION_PREVIEW = 'Start a new assistant thread.';
const SESSION_GROUPS = ['today', 'yesterday', 'last7Days', 'older'];
const DEFAULT_VIEWER_SCOPE = 'guest';

const createMessageId = () => `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createSessionId = () => `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const safeString = (value = '', fallback = '') => String(value ?? fallback).trim();
const trimMessages = (messages = []) => (Array.isArray(messages) ? messages.slice(-MAX_PERSISTED_MESSAGES) : []);
const truncateText = (value = '', max = 80) => {
    const normalized = safeString(value);
    if (!normalized) return '';
    return normalized.length > max ? `${normalized.slice(0, Math.max(max - 3, 1)).trim()}...` : normalized;
};

const normalizeProductId = (product = {}) => safeString(product?.id || product?._id || '');
const normalizeViewerScope = (value = '') => safeString(value || DEFAULT_VIEWER_SCOPE, DEFAULT_VIEWER_SCOPE).toLowerCase();
const isGuestViewerScope = (value = '') => normalizeViewerScope(value) === DEFAULT_VIEWER_SCOPE;

const sortSessions = (sessions = []) => (
    [...sessions].sort((left, right) => {
        if (Boolean(left?.pinned) !== Boolean(right?.pinned)) {
            return left?.pinned ? -1 : 1;
        }

        return Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0);
    })
);

const normalizeTimestamp = (value, fallback = Date.now()) => {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const startOfDay = (value = Date.now()) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
};

const differenceInDays = (left = Date.now(), right = Date.now()) => (
    Math.floor((startOfDay(left) - startOfDay(right)) / (24 * 60 * 60 * 1000))
);

const getSessionGroupKey = (updatedAt = Date.now(), now = Date.now()) => {
    const daysAgo = differenceInDays(now, updatedAt);

    if (daysAgo <= 0) return 'today';
    if (daysAgo === 1) return 'yesterday';
    if (daysAgo <= 7) return 'last7Days';
    return 'older';
};

export const generateSessionTitle = (firstUserMessage = '') => {
    const normalized = safeString(firstUserMessage);
    if (!normalized) {
        return DEFAULT_SESSION_TITLE;
    }

    return truncateText(normalized.replace(/\s+/g, ' '), 34);
};

export const buildSessionPreview = (messages = []) => {
    const latestVisibleMessage = [...(Array.isArray(messages) ? messages : [])]
        .reverse()
        .find((message) => safeString(message?.text || message?.content || ''));

    if (!latestVisibleMessage) {
        return DEFAULT_SESSION_PREVIEW;
    }

    const prefix = latestVisibleMessage.role === 'user' ? 'You: ' : '';
    return truncateText(`${prefix}${safeString(latestVisibleMessage.text || latestVisibleMessage.content || '')}`, 96);
};

export const filterChatSessions = (sessions = [], query = '') => {
    const normalizedQuery = safeString(query).toLowerCase();
    if (!normalizedQuery) {
        return [...sessions];
    }

    return sessions.filter((session) => (
        `${safeString(session?.title)} ${safeString(session?.preview)} ${safeString(session?.originPath)}`
            .toLowerCase()
            .includes(normalizedQuery)
    ));
};

export const groupChatSessionsByRecency = (sessions = [], now = Date.now()) => {
    const grouped = new Map(SESSION_GROUPS.map((key) => [key, []]));

    sortSessions(sessions).forEach((session) => {
        const bucket = getSessionGroupKey(session?.updatedAt, now);
        const currentBucket = grouped.get(bucket) || [];
        currentBucket.push(session);
        grouped.set(bucket, currentBucket);
    });

    return [
        { key: 'today', label: 'Today', sessions: grouped.get('today') || [] },
        { key: 'yesterday', label: 'Yesterday', sessions: grouped.get('yesterday') || [] },
        { key: 'last7Days', label: 'Last 7 days', sessions: grouped.get('last7Days') || [] },
        { key: 'older', label: 'Older', sessions: grouped.get('older') || [] },
    ].filter((group) => group.sessions.length > 0);
};

const uniqueStrings = (values = []) => [...new Set(
    (Array.isArray(values) ? values : [])
        .map((entry) => safeString(entry))
        .filter(Boolean)
)];

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

export const createAssistantMessage = (payload = {}) => ({
    id: safeString(payload?.id || createMessageId()),
    role: 'assistant',
    text: '',
    createdAt: Date.now(),
    isStreaming: false,
    status: 'complete',
    provisional: false,
    upgraded: false,
    upgradeEligible: false,
    traceId: '',
    decision: '',
    mode: 'explore',
    uiSurface: 'plain_answer',
    assistantTurn: null,
    product: null,
    products: [],
    cartSummary: null,
    supportPrefill: null,
    confirmation: null,
    navigation: null,
    grounding: null,
    providerInfo: null,
    providerCapabilities: null,
    ...payload,
});

export const createUserMessage = (text = '', payload = {}) => ({
    id: safeString(payload?.id || createMessageId()),
    role: 'user',
    text: safeString(text || payload?.text || payload?.content || ''),
    createdAt: normalizeTimestamp(payload?.createdAt, Date.now()),
    status: safeString(payload?.status || 'complete') || 'complete',
    ...payload,
});

export const createWelcomeMessage = () => createAssistantMessage({
    text: 'Ask about products, a cart review, support handoff, or a live app flow. I will keep the next step controlled.',
    mode: 'explore',
    uiSurface: 'plain_answer',
});

const createStreamingAssistantTurn = (text = '') => ({
    intent: 'general_knowledge',
    decision: 'respond',
    response: String(text || ''),
    ui: {
        surface: 'plain_answer',
    },
    followUps: [],
    citations: [],
    toolRuns: [],
    verification: null,
});

const createInitialClarificationState = () => ({
    fingerprint: '',
    count: 0,
    lastQuestion: '',
});

const createInitialAssistantSession = () => ({
    sessionId: '',
    contextVersion: 0,
    lastIntent: '',
    lastEntities: {
        query: '',
        productId: '',
        category: '',
        maxPrice: 0,
        quantity: 0,
    },
    contextPath: '',
    pendingAction: null,
    clarificationState: createInitialClarificationState(),
    lastResolvedEntityId: '',
    lastResults: [],
    activeProduct: null,
});

const createInitialSessionMemory = () => ({
    lastQuery: '',
    lastResults: [],
    activeProduct: null,
    lastIntent: '',
    currentIntent: '',
    clarificationState: createInitialClarificationState(),
    lastActionFingerprint: '',
    lastActionAt: 0,
});

const createInitialContext = () => ({
    route: '/',
    lastQuery: '',
    candidateProductIds: [],
    activeProductId: null,
    cartCount: 0,
    isAuthenticated: false,
    lastOrderId: null,
    assistantSession: createInitialAssistantSession(),
    sessionMemory: createInitialSessionMemory(),
});

const buildPreservedContext = (context = {}) => ({
    route: safeString(context?.route || '/', '/'),
    cartCount: Math.max(0, Number(context?.cartCount || 0)),
    isAuthenticated: Boolean(context?.isAuthenticated),
    lastOrderId: safeString(context?.lastOrderId || ''),
});

const mergeContexts = (currentContext = {}, partial = {}, fallbackSessionId = '') => ({
    ...currentContext,
    ...(partial || {}),
    assistantSession: {
        ...(currentContext?.assistantSession || createInitialAssistantSession()),
        ...(partial?.assistantSession || {}),
        sessionId: safeString(
            partial?.assistantSession?.sessionId
            || currentContext?.assistantSession?.sessionId
            || fallbackSessionId
            || ''
        ),
    },
    sessionMemory: {
        ...(currentContext?.sessionMemory || createInitialSessionMemory()),
        ...(partial?.sessionMemory || {}),
    },
});

const normalizeMessage = (message = {}) => {
    const role = safeString(message?.role || 'assistant').toLowerCase();
    if (role === 'user') {
        return createUserMessage(message?.text || message?.content || '', {
            ...message,
            id: safeString(message?.id || createMessageId()),
            createdAt: normalizeTimestamp(message?.createdAt, Date.now()),
        });
    }

    return createAssistantMessage({
        ...message,
        id: safeString(message?.id || createMessageId()),
        text: safeString(message?.text || message?.content || ''),
        createdAt: normalizeTimestamp(message?.createdAt, Date.now()),
        status: safeString(message?.status || 'complete') || 'complete',
        provisional: Boolean(message?.provisional),
        upgraded: Boolean(message?.upgraded),
        upgradeEligible: Boolean(message?.upgradeEligible),
        decision: safeString(message?.decision || ''),
        traceId: safeString(message?.traceId || ''),
        isStreaming: Boolean(message?.isStreaming),
    });
};

const normalizeActionList = (actions = [], primaryAction = null) => {
    const limit = primaryAction ? MAX_VISIBLE_ACTIONS - 1 : MAX_VISIBLE_ACTIONS;
    return Array.isArray(actions) ? actions.slice(0, Math.max(limit, 0)) : [];
};

const buildCandidateProductIds = (products = []) => (
    (Array.isArray(products) ? products : [])
        .map((product) => normalizeProductId(product))
        .filter(Boolean)
);

const createSessionConversationState = ({
    sessionId = '',
    preservedContext = {},
    messages = [createWelcomeMessage()],
    ...overrides
} = {}) => {
    const initialContext = {
        ...createInitialContext(),
        ...buildPreservedContext(preservedContext),
    };
    initialContext.assistantSession = {
        ...initialContext.assistantSession,
        sessionId: safeString(sessionId || initialContext.assistantSession?.sessionId || ''),
    };

    return {
        mode: 'explore',
        status: 'idle',
        isLoading: false,
        inputValue: '',
        messages: trimMessages(messages.map((message) => normalizeMessage(message))),
        visibleProducts: [],
        context: initialContext,
        primaryAction: null,
        secondaryActions: [],
        supportPrefill: null,
        currentIntent: null,
        pendingAction: null,
        pendingConfirmation: null,
        lastAssistantTurn: null,
        pendingUpgradeMessageIds: [],
        ...overrides,
    };
};

const createSessionMeta = ({
    id = createSessionId(),
    title = DEFAULT_SESSION_TITLE,
    preview = DEFAULT_SESSION_PREVIEW,
    createdAt = Date.now(),
    updatedAt = createdAt,
    pinned = false,
    originPath = '/',
} = {}) => ({
    id,
    title: safeString(title || DEFAULT_SESSION_TITLE, DEFAULT_SESSION_TITLE),
    preview: safeString(preview || DEFAULT_SESSION_PREVIEW, DEFAULT_SESSION_PREVIEW),
    createdAt: normalizeTimestamp(createdAt, Date.now()),
    updatedAt: normalizeTimestamp(updatedAt, createdAt),
    pinned: Boolean(pinned),
    originPath: safeString(originPath || '/', '/'),
});

const createSessionBundle = ({ originPath = '/', preservedContext = {} } = {}) => {
    const now = Date.now();
    const meta = createSessionMeta({
        id: createSessionId(),
        originPath,
        createdAt: now,
        updatedAt: now,
    });

    const state = createSessionConversationState({
        sessionId: meta.id,
        preservedContext,
    });

    return {
        meta,
        state,
    };
};

const createScopeSnapshot = ({
    activeSessionId = '',
    sessionSearchQuery = '',
    sessions = [],
    sessionStateById = {},
} = {}) => ({
    activeSessionId: safeString(activeSessionId || ''),
    sessionSearchQuery: safeString(sessionSearchQuery || ''),
    sessions: Array.isArray(sessions) ? sessions.map((session) => createSessionMeta(session)) : [],
    sessionStateById: sessionStateById && typeof sessionStateById === 'object' ? sessionStateById : {},
});

const createScopeSnapshotBundle = ({ originPath = '/', preservedContext = {} } = {}) => {
    const bundle = createSessionBundle({ originPath, preservedContext });
    return createScopeSnapshot({
        activeSessionId: bundle.meta.id,
        sessionSearchQuery: '',
        sessions: [bundle.meta],
        sessionStateById: {
            [bundle.meta.id]: bundle.state,
        },
    });
};

const coerceSessionConversationState = (value = {}, preservedContext = {}, fallbackSessionId = '') => {
    const base = createSessionConversationState({
        sessionId: fallbackSessionId,
        preservedContext,
    });

    return {
        ...base,
        ...value,
        status: safeString(value?.status || base.status) || base.status,
        isLoading: Boolean(value?.isLoading || ['thinking', 'executing'].includes(value?.status)),
        inputValue: String(value?.inputValue || ''),
        messages: Array.isArray(value?.messages) && value.messages.length > 0
            ? trimMessages(value.messages.map((message) => normalizeMessage(message)))
            : base.messages,
        visibleProducts: Array.isArray(value?.visibleProducts) ? value.visibleProducts.slice(0, 4) : base.visibleProducts,
        context: mergeContexts(base.context, value?.context || {}, fallbackSessionId),
        secondaryActions: Array.isArray(value?.secondaryActions) ? value.secondaryActions : base.secondaryActions,
        pendingUpgradeMessageIds: uniqueStrings(value?.pendingUpgradeMessageIds || base.pendingUpgradeMessageIds),
    };
};

const deriveMessageMode = ({ mode, assistantTurn, products = [] } = {}) => {
    if (mode) return mode;
    if (assistantTurn?.ui?.surface) return surfaceToMode(assistantTurn.ui.surface);
    return Array.isArray(products) && products.length === 1 ? 'product' : 'explore';
};

const buildAssistantTurnMeta = (nextAssistantTurn = {}, existingAssistantTurn = {}) => {
    const nextCitations = Array.isArray(nextAssistantTurn?.citations) ? nextAssistantTurn.citations : [];
    const nextToolRuns = Array.isArray(nextAssistantTurn?.toolRuns) ? nextAssistantTurn.toolRuns : [];
    const nextVerification = nextAssistantTurn?.verification && typeof nextAssistantTurn.verification === 'object'
        ? nextAssistantTurn.verification
        : null;

    return {
        ...(existingAssistantTurn || {}),
        ...(nextAssistantTurn || {}),
        citations: nextCitations.length > 0 ? nextCitations : (existingAssistantTurn?.citations || []),
        toolRuns: nextToolRuns.length > 0 ? nextToolRuns : (existingAssistantTurn?.toolRuns || []),
        verification: nextVerification || existingAssistantTurn?.verification || null,
    };
};

const buildAssistantMessage = ({
    id,
    createdAt,
    text = '',
    mode,
    products = [],
    product = null,
    cartSummary = null,
    supportPrefill = null,
    confirmation = null,
    navigation = null,
    assistantTurn = null,
    grounding = null,
    providerInfo = null,
    providerCapabilities = null,
    provisional = false,
    upgraded = false,
    upgradeEligible = false,
    status = 'complete',
    traceId = '',
    decision = '',
} = {}) => {
    const safeProducts = Array.isArray(products) ? products.slice(0, 4) : [];
    const resolvedProduct = product || safeProducts[0] || null;
    const resolvedMode = deriveMessageMode({
        mode,
        assistantTurn,
        products: resolvedProduct
            ? [resolvedProduct, ...safeProducts.filter((item) => normalizeProductId(item) !== normalizeProductId(resolvedProduct))]
            : safeProducts,
    });

    return createAssistantMessage({
        id: safeString(id || createMessageId()),
        createdAt: normalizeTimestamp(createdAt, Date.now()),
        text: safeString(text || assistantTurn?.response || ''),
        isStreaming: false,
        status: safeString(status || 'complete') || 'complete',
        provisional: Boolean(provisional),
        upgraded: Boolean(upgraded),
        upgradeEligible: Boolean(upgradeEligible),
        traceId: safeString(traceId || grounding?.traceId || ''),
        decision: safeString(decision || assistantTurn?.decision || ''),
        mode: resolvedMode,
        uiSurface: assistantTurn?.ui?.surface || 'plain_answer',
        assistantTurn: assistantTurn ? buildAssistantTurnMeta(assistantTurn) : null,
        product: resolvedProduct,
        products: safeProducts,
        cartSummary,
        supportPrefill,
        confirmation,
        navigation,
        grounding,
        providerInfo,
        providerCapabilities,
    });
};

const shouldCoalesceAssistantMessage = (lastMessage = null, nextMessage = null) => {
    if (!lastMessage || !nextMessage) return false;
    if (lastMessage.role !== 'assistant' || nextMessage.role !== 'assistant') return false;
    if (lastMessage.isStreaming || nextMessage.isStreaming) return false;
    if (lastMessage.upgraded || nextMessage.upgraded) return false;

    const lastText = safeString(lastMessage.text || '');
    const nextText = safeString(nextMessage.text || '');
    const lastSurface = safeString(lastMessage.uiSurface || lastMessage.assistantTurn?.ui?.surface || '');
    const nextSurface = safeString(nextMessage.uiSurface || nextMessage.assistantTurn?.ui?.surface || '');

    return Boolean(lastText && nextText && lastText === nextText && lastSurface === nextSurface);
};

const updateToolRunsForStream = (toolRuns = [], event = {}) => {
    const currentRuns = Array.isArray(toolRuns) ? [...toolRuns] : [];
    const toolName = safeString(event?.toolName || '');
    if (!toolName) {
        return currentRuns;
    }

    const runningIndex = currentRuns.findIndex((toolRun) => toolRun?.toolName === toolName && toolRun?.status === 'running');
    if (event?.status === 'running') {
        const nextRun = {
            id: event?.id || `stream-${toolName}-${Date.now()}`,
            toolName,
            status: 'running',
            latencyMs: 0,
            summary: safeString(event?.summary || ''),
            inputPreview: event?.input || event?.inputPreview || {},
            outputPreview: {},
        };
        if (runningIndex >= 0) {
            currentRuns[runningIndex] = {
                ...currentRuns[runningIndex],
                ...nextRun,
            };
            return currentRuns;
        }
        return [...currentRuns, nextRun];
    }

    if (runningIndex >= 0) {
        currentRuns[runningIndex] = {
            ...currentRuns[runningIndex],
            ...event,
            toolName,
            status: safeString(event?.status || 'completed') || 'completed',
        };
        return currentRuns;
    }

    return [
        ...currentRuns,
        {
            ...event,
            toolName,
            status: safeString(event?.status || 'completed') || 'completed',
        },
    ];
};

const appendStreamCitation = (citations = [], citation = {}) => {
    const currentCitations = Array.isArray(citations) ? [...citations] : [];
    const nextCitationId = safeString(citation?.id || `${citation?.path || ''}:${citation?.startLine || 0}`);
    if (!nextCitationId) {
        return currentCitations;
    }

    const existingIndex = currentCitations.findIndex((entry) => safeString(entry?.id || '') === nextCitationId);
    if (existingIndex >= 0) {
        currentCitations[existingIndex] = {
            ...currentCitations[existingIndex],
            ...citation,
        };
        return currentCitations;
    }

    return [...currentCitations, citation];
};

const createSafeStorage = () => createJSONStorage(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage;
    }

    return {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
    };
});

const getSessionMetaById = (sessions = [], sessionId = '') => (
    sortSessions(sessions).find((session) => session.id === safeString(sessionId)) || null
);

const refreshSessionMeta = (meta = {}, sessionState = {}, overrides = {}) => ({
    ...meta,
    ...overrides,
    id: safeString(meta?.id || overrides?.id || createSessionId()),
    title: safeString(
        overrides?.title !== undefined ? overrides.title : (meta?.title || DEFAULT_SESSION_TITLE),
        DEFAULT_SESSION_TITLE,
    ),
    preview: safeString(
        overrides?.preview !== undefined ? overrides.preview : buildSessionPreview(sessionState?.messages),
        DEFAULT_SESSION_PREVIEW,
    ) || DEFAULT_SESSION_PREVIEW,
    createdAt: normalizeTimestamp(overrides?.createdAt, meta?.createdAt || Date.now()),
    updatedAt: normalizeTimestamp(overrides?.updatedAt, Date.now()),
    pinned: overrides?.pinned !== undefined ? Boolean(overrides.pinned) : Boolean(meta?.pinned),
    originPath: safeString(
        overrides?.originPath !== undefined
            ? overrides.originPath
            : (sessionState?.context?.route || meta?.originPath || '/'),
        '/',
    ),
});

const ensureSessionCollections = (state = {}) => {
    const nextSessionStateById = {};
    const rawSessionStateById = state?.sessionStateById && typeof state.sessionStateById === 'object'
        ? state.sessionStateById
        : {};
    let sessions = Array.isArray(state?.sessions) ? state.sessions.map((session) => createSessionMeta(session)) : [];

    sessions.forEach((meta) => {
        nextSessionStateById[meta.id] = coerceSessionConversationState(
            rawSessionStateById[meta.id] || {},
            buildPreservedContext(rawSessionStateById[meta.id]?.context || { route: meta.originPath || '/' }),
            meta.id,
        );
    });

    Object.keys(rawSessionStateById).forEach((sessionId) => {
        if (sessions.some((session) => session.id === sessionId)) {
            return;
        }

        const sessionState = coerceSessionConversationState(
            rawSessionStateById[sessionId] || {},
            buildPreservedContext(rawSessionStateById[sessionId]?.context || {}),
            sessionId,
        );
        nextSessionStateById[sessionId] = sessionState;
        sessions.push(createSessionMeta({
            id: sessionId,
            title: generateSessionTitle(sessionState.messages.find((message) => message.role === 'user')?.text || ''),
            preview: buildSessionPreview(sessionState.messages),
            originPath: sessionState.context?.route || '/',
            createdAt: normalizeTimestamp(sessionState.messages[0]?.createdAt, Date.now()),
            updatedAt: normalizeTimestamp(
                sessionState.messages[sessionState.messages.length - 1]?.createdAt,
                Date.now(),
            ),
        }));
    });

    if (sessions.length === 0) {
        const bundle = createSessionBundle();
        sessions = [bundle.meta];
        nextSessionStateById[bundle.meta.id] = bundle.state;
    }

    sessions = sortSessions(sessions.map((meta) => refreshSessionMeta(
        meta,
        nextSessionStateById[meta.id] || createSessionConversationState({
            sessionId: meta.id,
            preservedContext: {
                route: meta.originPath || '/',
            },
        }),
        {
            title: safeString(meta?.title || DEFAULT_SESSION_TITLE, DEFAULT_SESSION_TITLE),
            preview: safeString(meta?.preview || DEFAULT_SESSION_PREVIEW, DEFAULT_SESSION_PREVIEW),
            createdAt: normalizeTimestamp(meta?.createdAt, Date.now()),
            updatedAt: normalizeTimestamp(meta?.updatedAt, Date.now()),
        },
    )));

    return {
        sessions,
        sessionStateById: nextSessionStateById,
    };
};

const extractScopeSnapshotFromState = (state = {}) => createScopeSnapshot({
    activeSessionId: state.activeSessionId,
    sessionSearchQuery: state.sessionSearchQuery,
    sessions: state.sessions,
    sessionStateById: state.sessionStateById,
});

const syncDerivedSessionState = (state = {}) => {
    const { sessions, sessionStateById } = ensureSessionCollections(state);
    const activeSessionId = safeString(state?.activeSessionId || sessions[0]?.id);
    const activeSession = getSessionMetaById(sessions, activeSessionId) || sessions[0];
    const activeConversationState = coerceSessionConversationState(
        sessionStateById[activeSession.id] || {},
        buildPreservedContext(sessionStateById[activeSession.id]?.context || { route: activeSession.originPath || '/' }),
        activeSession.id,
    );
    const sessionSearchQuery = safeString(state?.sessionSearchQuery || '');
    const visibleSessions = sortSessions(filterChatSessions(sessions, sessionSearchQuery));
    const groupedSessions = groupChatSessionsByRecency(visibleSessions);
    const isTyping = Boolean(
        activeConversationState.isLoading
        || activeConversationState.messages.some((message) => (
            message?.role === 'assistant' && (message?.isStreaming || message?.status === 'thinking')
        ))
    );
    const nextSessionStateById = {
        ...sessionStateById,
        [activeSession.id]: activeConversationState,
    };
    const viewerScope = normalizeViewerScope(state?.viewerScope || DEFAULT_VIEWER_SCOPE);
    const scopeSnapshotsById = {
        ...(state?.scopeSnapshotsById && typeof state.scopeSnapshotsById === 'object' ? state.scopeSnapshotsById : {}),
    };
    const nextState = {
        ...state,
        viewerScope,
        activeSessionId: activeSession.id,
        activeSession,
        sessions,
        sessionStateById: nextSessionStateById,
        sessionSearchQuery,
        visibleSessions,
        groupedSessions,
        mode: activeConversationState.mode,
        status: activeConversationState.status,
        isLoading: activeConversationState.isLoading,
        isTyping,
        inputValue: activeConversationState.inputValue,
        messages: activeConversationState.messages,
        visibleProducts: activeConversationState.visibleProducts,
        context: activeConversationState.context,
        primaryAction: activeConversationState.primaryAction,
        secondaryActions: activeConversationState.secondaryActions,
        supportPrefill: activeConversationState.supportPrefill,
        currentIntent: activeConversationState.currentIntent,
        pendingAction: activeConversationState.pendingAction,
        pendingConfirmation: activeConversationState.pendingConfirmation,
        lastAssistantTurn: activeConversationState.lastAssistantTurn,
    };
    scopeSnapshotsById[viewerScope] = extractScopeSnapshotFromState(nextState);

    return {
        ...nextState,
        scopeSnapshotsById,
    };
};

const replaceSessionConversationState = (state = {}, sessionId = '', nextConversationState = {}, metaOverrides = {}) => {
    const targetSessionId = safeString(sessionId || state?.activeSessionId);
    const currentMeta = getSessionMetaById(state?.sessions, targetSessionId);
    if (!currentMeta) {
        return syncDerivedSessionState(state);
    }

    const normalizedConversationState = coerceSessionConversationState(
        nextConversationState,
        buildPreservedContext(nextConversationState?.context || { route: currentMeta.originPath || '/' }),
        targetSessionId,
    );
    const nextMeta = refreshSessionMeta(currentMeta, normalizedConversationState, metaOverrides);

    return syncDerivedSessionState({
        ...state,
        sessions: sortSessions(state.sessions.map((session) => (
            session.id === targetSessionId ? nextMeta : session
        ))),
        sessionStateById: {
            ...state.sessionStateById,
            [targetSessionId]: normalizedConversationState,
        },
    });
};

const updateSessionConversationState = (state = {}, sessionId = '', updater = (value) => value, metaOverrides = {}) => {
    const targetSessionId = safeString(sessionId || state?.activeSessionId);
    const currentMeta = getSessionMetaById(state?.sessions, targetSessionId);
    if (!currentMeta) {
        return syncDerivedSessionState(state);
    }

    const currentConversationState = coerceSessionConversationState(
        state.sessionStateById?.[targetSessionId] || {},
        buildPreservedContext(state.sessionStateById?.[targetSessionId]?.context || { route: currentMeta.originPath || '/' }),
        targetSessionId,
    );
    const updatedConversationState = typeof updater === 'function'
        ? updater(currentConversationState, currentMeta, state)
        : currentConversationState;

    return replaceSessionConversationState(
        state,
        targetSessionId,
        updatedConversationState || currentConversationState,
        metaOverrides,
    );
};

const mergeServerSessionsIntoState = (state = {}, serverSessions = [], { authoritative = true } = {}) => {
    const { sessions, sessionStateById } = ensureSessionCollections(state);
    const mergedStateById = authoritative ? {} : {
        ...sessionStateById,
    };
    const mergedSessions = authoritative ? [] : [...sessions];
    const normalizedServerSessions = Array.isArray(serverSessions) ? serverSessions : [];

    normalizedServerSessions.forEach((serverSession) => {
        const sessionId = safeString(serverSession?.id || '');
        if (!sessionId) {
            return;
        }

        if (!mergedStateById[sessionId]) {
            mergedStateById[sessionId] = createSessionConversationState({
                sessionId,
                preservedContext: {
                    route: safeString(serverSession?.originPath || '/', '/'),
                },
            });
        }

        const nextMeta = refreshSessionMeta(
            getSessionMetaById(mergedSessions, sessionId) || createSessionMeta({ id: sessionId }),
            mergedStateById[sessionId],
            {
                id: sessionId,
                title: safeString(serverSession?.title || DEFAULT_SESSION_TITLE, DEFAULT_SESSION_TITLE),
                preview: safeString(serverSession?.preview || DEFAULT_SESSION_PREVIEW, DEFAULT_SESSION_PREVIEW),
                createdAt: normalizeTimestamp(serverSession?.createdAt, Date.now()),
                updatedAt: normalizeTimestamp(serverSession?.updatedAt, Date.now()),
                originPath: safeString(serverSession?.originPath || '/', '/'),
                pinned: getSessionMetaById(mergedSessions, sessionId)?.pinned || false,
            },
        );
        const existingIndex = mergedSessions.findIndex((entry) => entry.id === sessionId);
        if (existingIndex >= 0) {
            mergedSessions[existingIndex] = nextMeta;
        } else {
            mergedSessions.push(nextMeta);
        }
    });

    if (authoritative && mergedSessions.length === 0) {
        const fallbackOriginPath = safeString(state?.context?.route || '/', '/');
        const snapshot = createScopeSnapshotBundle({
            originPath: fallbackOriginPath,
            preservedContext: {
                ...buildPreservedContext(state?.context || {}),
                route: fallbackOriginPath,
                isAuthenticated: true,
            },
        });

        return syncDerivedSessionState({
            ...state,
            activeSessionId: snapshot.activeSessionId,
            sessions: snapshot.sessions,
            sessionStateById: snapshot.sessionStateById,
            sessionSearchQuery: '',
        });
    }

    return syncDerivedSessionState({
        ...state,
        sessions: sortSessions(mergedSessions),
        sessionStateById: mergedStateById,
    });
};

const buildConversationStateFromServerPayload = (payload = {}, existingState = {}) => {
    const session = payload?.session || {};
    const sessionId = safeString(session?.id || existingState?.context?.assistantSession?.sessionId || '');
    const preservedContext = buildPreservedContext({
        ...(existingState?.context || {}),
        route: safeString(session?.originPath || existingState?.context?.route || '/', '/'),
        isAuthenticated: true,
    });
    const messages = Array.isArray(payload?.messages) && payload.messages.length > 0
        ? payload.messages
        : [createWelcomeMessage()];

    return coerceSessionConversationState({
        ...existingState,
        status: 'idle',
        isLoading: false,
        messages,
        context: mergeContexts(existingState?.context || createInitialContext(), {
            route: safeString(session?.originPath || existingState?.context?.route || '/', '/'),
            isAuthenticated: true,
            assistantSession: payload?.assistantSession || {},
            sessionMemory: {
                ...(existingState?.context?.sessionMemory || createInitialSessionMemory()),
                lastQuery: safeString(payload?.assistantSession?.lastEntities?.query || ''),
                lastResults: Array.isArray(payload?.assistantSession?.lastResults) ? payload.assistantSession.lastResults : [],
                activeProduct: payload?.assistantSession?.activeProduct || null,
                lastIntent: safeString(payload?.assistantSession?.lastIntent || ''),
                currentIntent: safeString(payload?.assistantSession?.lastIntent || ''),
                clarificationState: payload?.assistantSession?.clarificationState || createInitialClarificationState(),
            },
        }, sessionId),
        pendingConfirmation: null,
    }, preservedContext, sessionId);
};

const switchViewerScopeState = (state = {}, {
    viewerScope = DEFAULT_VIEWER_SCOPE,
    preservedContext = null,
    resetSearch = true,
} = {}) => {
    const nextViewerScope = normalizeViewerScope(viewerScope);
    const currentViewerScope = normalizeViewerScope(state?.viewerScope || DEFAULT_VIEWER_SCOPE);
    const currentSnapshots = state?.scopeSnapshotsById && typeof state.scopeSnapshotsById === 'object'
        ? state.scopeSnapshotsById
        : {};
    const nextScopeSnapshotsById = {
        ...currentSnapshots,
        [currentViewerScope]: extractScopeSnapshotFromState(syncDerivedSessionState(state)),
    };
    const nextPreservedContext = {
        ...buildPreservedContext(state?.context || {}),
        ...(preservedContext && typeof preservedContext === 'object' ? buildPreservedContext(preservedContext) : {}),
        isAuthenticated: !isGuestViewerScope(nextViewerScope),
    };
    const nextOriginPath = safeString(nextPreservedContext.route || state?.context?.route || '/', '/');
    const nextScopeSnapshot = nextScopeSnapshotsById[nextViewerScope] || createScopeSnapshotBundle({
        originPath: nextOriginPath,
        preservedContext: {
            ...nextPreservedContext,
            route: nextOriginPath,
        },
    });

    return syncDerivedSessionState({
        ...state,
        viewerScope: nextViewerScope,
        scopeSnapshotsById: nextScopeSnapshotsById,
        activeSessionId: nextScopeSnapshot.activeSessionId,
        sessionSearchQuery: resetSearch ? '' : nextScopeSnapshot.sessionSearchQuery,
        sessions: nextScopeSnapshot.sessions,
        sessionStateById: nextScopeSnapshot.sessionStateById,
    });
};

const applyAssistantTurnToConversationState = (sessionState = {}, payload = {}, { replaceMessageId = '' } = {}) => {
    const safeProducts = Array.isArray(payload?.products) ? payload.products.slice(0, 4) : [];
    const resolvedProduct = payload?.product || safeProducts[0] || null;
    const resolvedMode = deriveMessageMode({
        mode: payload?.mode,
        assistantTurn: payload?.assistantTurn,
        products: safeProducts,
    });
    const candidateProductIds = buildCandidateProductIds(
        resolvedProduct ? [resolvedProduct, ...safeProducts] : safeProducts,
    );
    const resolvedActiveProductId = payload?.activeProductId !== undefined
        ? payload.activeProductId
        : resolvedMode === 'product'
            ? normalizeProductId(resolvedProduct) || candidateProductIds[0] || null
            : resolvedMode === 'explore'
                ? null
                : sessionState?.context?.activeProductId;
    const nextPendingConfirmation = payload?.assistantTurn?.ui?.confirmation
        ? payload.assistantTurn.ui.confirmation
        : (payload?.confirmation || null);
    const assistantSessionMemory = payload?.assistantTurn?.sessionMemory && typeof payload.assistantTurn.sessionMemory === 'object'
        ? payload.assistantTurn.sessionMemory
        : null;
    const resolvedAssistantSession = payload?.assistantSession && typeof payload.assistantSession === 'object'
        ? payload.assistantSession
        : payload?.assistantTurn?.assistantSession && typeof payload.assistantTurn.assistantSession === 'object'
            ? payload.assistantTurn.assistantSession
            : null;
    const nextSessionMemory = {
        ...sessionState.context.sessionMemory,
        ...(assistantSessionMemory || {}),
        lastQuery: assistantSessionMemory?.lastQuery ?? sessionState.context.sessionMemory.lastQuery,
        lastResults: Array.isArray(assistantSessionMemory?.lastResults)
            ? assistantSessionMemory.lastResults
            : sessionState.context.sessionMemory.lastResults,
        activeProduct: assistantSessionMemory?.activeProduct ?? sessionState.context.sessionMemory.activeProduct,
        lastIntent: assistantSessionMemory?.lastIntent
            || assistantSessionMemory?.currentIntent
            || payload?.assistantTurn?.intent
            || sessionState.context.sessionMemory.lastIntent
            || sessionState.context.sessionMemory.currentIntent,
        currentIntent: assistantSessionMemory?.lastIntent
            || assistantSessionMemory?.currentIntent
            || payload?.assistantTurn?.intent
            || sessionState.context.sessionMemory.lastIntent
            || sessionState.context.sessionMemory.currentIntent,
        clarificationState: assistantSessionMemory?.clarificationState
            || sessionState.context.sessionMemory.clarificationState,
        lastActionFingerprint: assistantSessionMemory?.lastActionFingerprint
            ?? sessionState.context.sessionMemory.lastActionFingerprint,
        lastActionAt: assistantSessionMemory?.lastActionAt
            ?? sessionState.context.sessionMemory.lastActionAt,
    };

    const nextMessage = buildAssistantMessage({
        id: payload?.id,
        text: safeString(payload?.text || payload?.assistantTurn?.response || ''),
        mode: resolvedMode,
        products: safeProducts,
        product: resolvedProduct,
        cartSummary: payload?.cartSummary || null,
        supportPrefill: payload?.supportPrefill || null,
        confirmation: payload?.confirmation || null,
        navigation: payload?.navigation || null,
        assistantTurn: payload?.assistantTurn || null,
        grounding: payload?.grounding || null,
        providerInfo: payload?.providerInfo || null,
        providerCapabilities: payload?.providerCapabilities || null,
        provisional: Boolean(payload?.provisional),
        upgraded: Boolean(payload?.upgraded),
        upgradeEligible: Boolean(payload?.upgradeEligible),
        status: safeString(payload?.status || 'complete') || 'complete',
        traceId: safeString(payload?.traceId || ''),
        decision: safeString(payload?.decision || ''),
    });

    let nextMessages = trimMessages(sessionState.messages);
    let targetMessageId = nextMessage.id;

    if (replaceMessageId) {
        const existingMessage = nextMessages.find((message) => message.id === replaceMessageId) || null;
        const replacement = existingMessage
            ? {
                ...nextMessage,
                id: replaceMessageId,
                createdAt: existingMessage.createdAt,
            }
            : nextMessage;
        targetMessageId = replacement.id;
        nextMessages = existingMessage
            ? nextMessages.map((message) => (message.id === replaceMessageId ? replacement : message))
            : [...nextMessages, replacement];
    } else {
        const lastMessage = nextMessages[nextMessages.length - 1] || null;
        nextMessages = shouldCoalesceAssistantMessage(lastMessage, nextMessage)
            ? [
                ...nextMessages.slice(0, -1),
                {
                    ...nextMessage,
                    id: lastMessage.id,
                    createdAt: lastMessage.createdAt,
                },
            ]
            : [...nextMessages, nextMessage];
        targetMessageId = nextMessages[nextMessages.length - 1]?.id || nextMessage.id;
    }

    const nextPendingUpgradeMessageIds = payload?.upgradeEligible
        ? uniqueStrings([
            ...sessionState.pendingUpgradeMessageIds.filter((entry) => entry !== targetMessageId),
            targetMessageId,
        ])
        : sessionState.pendingUpgradeMessageIds.filter((entry) => entry !== targetMessageId);

    return {
        ...sessionState,
        mode: resolvedMode,
        status: 'idle',
        isLoading: false,
        messages: trimMessages(nextMessages),
        visibleProducts: safeProducts,
        primaryAction: payload?.primaryAction || null,
        secondaryActions: normalizeActionList(payload?.secondaryActions, payload?.primaryAction || null),
        supportPrefill: payload?.supportPrefill || null,
        currentIntent: payload?.assistantTurn?.intent || sessionState.currentIntent,
        pendingAction: payload?.pendingAction ?? null,
        pendingConfirmation: nextPendingConfirmation,
        lastAssistantTurn: payload?.assistantTurn || sessionState.lastAssistantTurn,
        pendingUpgradeMessageIds: nextPendingUpgradeMessageIds,
        context: {
            ...sessionState.context,
            candidateProductIds,
            activeProductId: resolvedActiveProductId,
            lastOrderId: payload?.assistantTurn?.ui?.support?.orderId || sessionState.context.lastOrderId,
            assistantSession: resolvedAssistantSession
                ? {
                    ...sessionState.context.assistantSession,
                    ...resolvedAssistantSession,
                }
                : sessionState.context.assistantSession,
            sessionMemory: nextSessionMemory,
        },
    };
};

const createInitialState = () => {
    const bundle = createSessionBundle();
    return syncDerivedSessionState({
        isOpen: false,
        viewerScope: DEFAULT_VIEWER_SCOPE,
        scopeSnapshotsById: {
            [DEFAULT_VIEWER_SCOPE]: createScopeSnapshot({
                activeSessionId: bundle.meta.id,
                sessionSearchQuery: '',
                sessions: [bundle.meta],
                sessionStateById: {
                    [bundle.meta.id]: bundle.state,
                },
            }),
        },
        activeSessionId: bundle.meta.id,
        sessions: [bundle.meta],
        sessionStateById: {
            [bundle.meta.id]: bundle.state,
        },
        sessionSearchQuery: '',
    });
};

const parsePersistedSnapshot = (storageKey = '') => {
    if (typeof window === 'undefined' || !window.localStorage) {
        return null;
    }

    try {
        const rawValue = window.localStorage.getItem(storageKey);
        if (!rawValue) {
            return null;
        }

        const parsed = JSON.parse(rawValue);
        return parsed?.state || parsed || null;
    } catch {
        return null;
    }
};

const buildSessionBundleFromLegacyState = (legacyState = {}) => {
    const sessionId = safeString(
        legacyState?.context?.assistantSession?.sessionId
        || legacyState?.sessionId
        || createSessionId(),
    );
    const preservedContext = buildPreservedContext(legacyState?.context || {});
    const baseConversation = createSessionConversationState({
        sessionId,
        preservedContext,
    });
    const state = coerceSessionConversationState({
        mode: safeString(legacyState?.mode || baseConversation.mode) || baseConversation.mode,
        status: safeString(legacyState?.status || baseConversation.status) || baseConversation.status,
        isLoading: Boolean(legacyState?.isLoading),
        inputValue: safeString(legacyState?.inputValue || ''),
        messages: Array.isArray(legacyState?.messages) && legacyState.messages.length > 0
            ? legacyState.messages
            : baseConversation.messages,
        visibleProducts: Array.isArray(legacyState?.visibleProducts) ? legacyState.visibleProducts : [],
        context: mergeContexts(baseConversation.context, legacyState?.context || {}, sessionId),
        primaryAction: legacyState?.primaryAction || null,
        secondaryActions: Array.isArray(legacyState?.secondaryActions) ? legacyState.secondaryActions : [],
        supportPrefill: legacyState?.supportPrefill || null,
        currentIntent: legacyState?.currentIntent || null,
        pendingAction: legacyState?.pendingAction || null,
        pendingConfirmation: legacyState?.pendingConfirmation || null,
        lastAssistantTurn: legacyState?.lastAssistantTurn || null,
    }, preservedContext, sessionId);
    const firstUserMessage = state.messages.find((message) => message.role === 'user')?.text || '';
    const meta = createSessionMeta({
        id: sessionId,
        title: generateSessionTitle(firstUserMessage),
        preview: buildSessionPreview(state.messages),
        originPath: state.context?.route || '/',
        createdAt: normalizeTimestamp(state.messages[0]?.createdAt, Date.now()),
        updatedAt: normalizeTimestamp(state.messages[state.messages.length - 1]?.createdAt, Date.now()),
    });

    return {
        meta,
        state,
    };
};

const mergeState = (persistedState, currentState) => {
    const nextState = persistedState?.state || persistedState || {};
    const baseState = {
        ...currentState,
        isOpen: false,
        sessionSearchQuery: safeString(nextState?.sessionSearchQuery || ''),
    };
    const nextViewerScope = normalizeViewerScope(nextState?.viewerScope || DEFAULT_VIEWER_SCOPE);
    const persistedScopeSnapshots = nextState?.scopeSnapshotsById && typeof nextState.scopeSnapshotsById === 'object'
        ? nextState.scopeSnapshotsById
        : null;

    if (persistedScopeSnapshots) {
        const fallbackSnapshot = createScopeSnapshot({
            activeSessionId: nextState?.activeSessionId,
            sessionSearchQuery: nextState?.sessionSearchQuery,
            sessions: nextState?.sessions,
            sessionStateById: nextState?.sessionStateById,
        });
        const scopeSnapshotsById = {
            ...persistedScopeSnapshots,
        };
        if (!scopeSnapshotsById[nextViewerScope]) {
            scopeSnapshotsById[nextViewerScope] = fallbackSnapshot.sessions.length > 0
                ? fallbackSnapshot
                : createScopeSnapshotBundle();
        }
        const activeSnapshot = scopeSnapshotsById[nextViewerScope];

        return syncDerivedSessionState({
            ...baseState,
            viewerScope: nextViewerScope,
            scopeSnapshotsById,
            activeSessionId: activeSnapshot.activeSessionId,
            sessionSearchQuery: activeSnapshot.sessionSearchQuery,
            sessions: activeSnapshot.sessions,
            sessionStateById: activeSnapshot.sessionStateById,
        });
    }

    if ((Array.isArray(nextState?.sessions) && nextState.sessions.length > 0) || nextState?.sessionStateById) {
        return syncDerivedSessionState({
            ...baseState,
            viewerScope: DEFAULT_VIEWER_SCOPE,
            scopeSnapshotsById: {
                [DEFAULT_VIEWER_SCOPE]: createScopeSnapshot({
                    activeSessionId: safeString(nextState?.activeSessionId || baseState.activeSessionId),
                    sessionSearchQuery: safeString(nextState?.sessionSearchQuery || ''),
                    sessions: nextState.sessions,
                    sessionStateById: nextState.sessionStateById,
                }),
            },
            sessions: nextState.sessions,
            sessionStateById: nextState.sessionStateById,
            activeSessionId: safeString(nextState?.activeSessionId || baseState.activeSessionId),
        });
    }

    if (Array.isArray(nextState?.messages) || nextState?.context) {
        const migratedBundle = buildSessionBundleFromLegacyState(nextState);
        return syncDerivedSessionState({
            ...baseState,
            viewerScope: DEFAULT_VIEWER_SCOPE,
            scopeSnapshotsById: {
                [DEFAULT_VIEWER_SCOPE]: createScopeSnapshot({
                    activeSessionId: migratedBundle.meta.id,
                    sessionSearchQuery: '',
                    sessions: [migratedBundle.meta],
                    sessionStateById: {
                        [migratedBundle.meta.id]: migratedBundle.state,
                    },
                }),
            },
            activeSessionId: migratedBundle.meta.id,
            sessions: [migratedBundle.meta],
            sessionStateById: {
                [migratedBundle.meta.id]: migratedBundle.state,
            },
        });
    }

    const legacyState = parsePersistedSnapshot(LEGACY_CHAT_STORAGE_KEY);
    if (legacyState) {
        const migratedBundle = buildSessionBundleFromLegacyState(legacyState);
        return syncDerivedSessionState({
            ...baseState,
            viewerScope: DEFAULT_VIEWER_SCOPE,
            scopeSnapshotsById: {
                [DEFAULT_VIEWER_SCOPE]: createScopeSnapshot({
                    activeSessionId: migratedBundle.meta.id,
                    sessionSearchQuery: '',
                    sessions: [migratedBundle.meta],
                    sessionStateById: {
                        [migratedBundle.meta.id]: migratedBundle.state,
                    },
                }),
            },
            activeSessionId: migratedBundle.meta.id,
            sessions: [migratedBundle.meta],
            sessionStateById: {
                [migratedBundle.meta.id]: migratedBundle.state,
            },
        });
    }

    return syncDerivedSessionState(baseState);
};

export const useChatStore = create(
    persist(
        (set, get) => ({
            ...createInitialState(),
            open: () => set({ isOpen: true }),
            close: () => set((state) => updateSessionConversationState(
                {
                    ...state,
                    isOpen: false,
                },
                state.activeSessionId,
                (sessionState) => ({
                    ...sessionState,
                    inputValue: '',
                }),
            )),
            setSessionSearchQuery: (query = '') => set((state) => syncDerivedSessionState({
                ...state,
                sessionSearchQuery: safeString(query || ''),
            })),
            createSession: ({ originPath = '', preservedContext = null } = {}) => set((state) => {
                const nextOriginPath = safeString(originPath || state.context?.route || '/', '/');
                const bundle = createSessionBundle({
                    originPath: nextOriginPath,
                    preservedContext: {
                        ...buildPreservedContext(state.context || {}),
                        ...(preservedContext && typeof preservedContext === 'object' ? buildPreservedContext(preservedContext) : {}),
                        route: nextOriginPath,
                    },
                });

                return syncDerivedSessionState({
                    ...state,
                    activeSessionId: bundle.meta.id,
                    sessions: sortSessions([bundle.meta, ...state.sessions]),
                    sessionStateById: {
                        ...state.sessionStateById,
                        [bundle.meta.id]: bundle.state,
                    },
                    sessionSearchQuery: '',
                });
            }),
            setActiveSession: (sessionId = '') => set((state) => {
                const targetSessionId = safeString(sessionId || '');
                if (!targetSessionId || !getSessionMetaById(state.sessions, targetSessionId)) {
                    return state;
                }

                return syncDerivedSessionState({
                    ...state,
                    activeSessionId: targetSessionId,
                });
            }),
            switchViewerScope: ({ viewerScope = DEFAULT_VIEWER_SCOPE, preservedContext = null, resetSearch = true } = {}) => set((state) => switchViewerScopeState(state, {
                viewerScope,
                preservedContext,
                resetSearch,
            })),
            replaceSessionsFromServer: (serverSessions = [], options = {}) => set((state) => mergeServerSessionsIntoState(state, serverSessions, options)),
            hydrateSessionFromServer: (payload = {}) => set((state) => {
                const session = payload?.session || {};
                const sessionId = safeString(session?.id || state.activeSessionId || '');
                if (!sessionId) {
                    return state;
                }

                const currentMeta = getSessionMetaById(state.sessions, sessionId) || createSessionMeta({
                    id: sessionId,
                    originPath: safeString(session?.originPath || '/', '/'),
                });
                const currentConversationState = coerceSessionConversationState(
                    state.sessionStateById?.[sessionId] || {},
                    buildPreservedContext(state.sessionStateById?.[sessionId]?.context || { route: currentMeta.originPath || '/' }),
                    sessionId,
                );
                const nextConversationState = buildConversationStateFromServerPayload(payload, currentConversationState);
                const nextMeta = refreshSessionMeta(currentMeta, nextConversationState, {
                    id: sessionId,
                    title: safeString(session?.title || currentMeta.title || DEFAULT_SESSION_TITLE, DEFAULT_SESSION_TITLE),
                    preview: safeString(session?.preview || buildSessionPreview(nextConversationState.messages), DEFAULT_SESSION_PREVIEW),
                    createdAt: normalizeTimestamp(session?.createdAt, currentMeta.createdAt || Date.now()),
                    updatedAt: normalizeTimestamp(session?.updatedAt, Date.now()),
                    originPath: safeString(session?.originPath || currentMeta.originPath || '/', '/'),
                    pinned: currentMeta.pinned,
                });

                const sessionExists = state.sessions.some((entry) => entry.id === sessionId);
                return syncDerivedSessionState({
                    ...state,
                    activeSessionId: sessionId,
                    sessions: sortSessions(sessionExists
                        ? state.sessions.map((entry) => (entry.id === sessionId ? nextMeta : entry))
                        : [nextMeta, ...state.sessions]),
                    sessionStateById: {
                        ...state.sessionStateById,
                        [sessionId]: nextConversationState,
                    },
                });
            }),
            togglePinnedSession: (sessionId = '') => set((state) => {
                const targetSessionId = safeString(sessionId || '');
                if (!targetSessionId) {
                    return state;
                }

                return syncDerivedSessionState({
                    ...state,
                    sessions: sortSessions(state.sessions.map((session) => (
                        session.id === targetSessionId
                            ? {
                                ...session,
                                pinned: !session.pinned,
                                updatedAt: Date.now(),
                            }
                            : session
                    ))),
                });
            }),
            updateSessionOrigin: (originPath = '', sessionId = '') => set((state) => updateSessionConversationState(
                state,
                sessionId || state.activeSessionId,
                (sessionState) => ({
                    ...sessionState,
                    context: {
                        ...sessionState.context,
                        route: safeString(originPath || sessionState.context?.route || '/', '/'),
                    },
                }),
                {
                    originPath: safeString(originPath || state.context?.route || '/', '/'),
                    updatedAt: Date.now(),
                },
            )),
            setInputValue: (inputValue = '') => set((state) => updateSessionConversationState(
                state,
                state.activeSessionId,
                (sessionState) => ({
                    ...sessionState,
                    inputValue: String(inputValue || ''),
                }),
            )),
            setLoading: (isLoading) => set((state) => updateSessionConversationState(
                state,
                state.activeSessionId,
                (sessionState) => ({
                    ...sessionState,
                    isLoading: Boolean(isLoading),
                    status: isLoading ? (sessionState.status === 'executing' ? 'executing' : 'thinking') : 'idle',
                }),
            )),
            setStatus: (status = 'idle') => set((state) => updateSessionConversationState(
                state,
                state.activeSessionId,
                (sessionState) => ({
                    ...sessionState,
                    status,
                    isLoading: status === 'thinking' || status === 'executing',
                }),
            )),
            setPendingAction: (pendingAction = null) => set((state) => updateSessionConversationState(
                state,
                state.activeSessionId,
                (sessionState) => ({
                    ...sessionState,
                    pendingAction,
                }),
            )),
            setPendingConfirmation: (pendingConfirmation = null) => set((state) => updateSessionConversationState(
                state,
                state.activeSessionId,
                (sessionState) => ({
                    ...sessionState,
                    pendingConfirmation,
                }),
            )),
            clearPendingConfirmation: () => set((state) => updateSessionConversationState(
                state,
                state.activeSessionId,
                (sessionState) => ({
                    ...sessionState,
                    pendingConfirmation: null,
                }),
            )),
            rememberExecutedAction: (fingerprint = '', executedAt = Date.now()) => set((state) => updateSessionConversationState(
                state,
                state.activeSessionId,
                (sessionState) => ({
                    ...sessionState,
                    context: {
                        ...sessionState.context,
                        sessionMemory: {
                            ...sessionState.context.sessionMemory,
                            lastActionFingerprint: safeString(fingerprint || ''),
                            lastActionAt: Number(executedAt || 0),
                        },
                    },
                }),
            )),
            hydrateContext: (partial = {}) => set((state) => updateSessionConversationState(
                state,
                state.activeSessionId,
                (sessionState) => ({
                    ...sessionState,
                    context: mergeContexts(sessionState.context, partial || {}, state.activeSessionId),
                }),
                {
                    originPath: partial?.route !== undefined
                        ? safeString(partial.route || '/', '/')
                        : state.activeSession?.originPath,
                },
            )),
            appendUserMessage: (text = '', payload = {}) => {
                const safeText = safeString(text || payload?.text || payload?.content || '');
                if (!safeText) return;

                set((state) => {
                    const targetSessionId = safeString(payload?.sessionId || state.activeSessionId);
                    const currentMeta = getSessionMetaById(state.sessions, targetSessionId);
                    if (!currentMeta) {
                        return state;
                    }

                    const currentConversationState = coerceSessionConversationState(
                        state.sessionStateById[targetSessionId] || {},
                        buildPreservedContext(state.sessionStateById[targetSessionId]?.context || { route: currentMeta.originPath || '/' }),
                        targetSessionId,
                    );
                    const hasUserMessage = currentConversationState.messages.some((message) => message.role === 'user');
                    const nextMessage = createUserMessage(safeText, payload);
                    const nextConversationState = {
                        ...currentConversationState,
                        status: 'idle',
                        isLoading: false,
                        messages: trimMessages([...currentConversationState.messages, nextMessage]),
                        context: {
                            ...currentConversationState.context,
                            lastQuery: safeText,
                            sessionMemory: {
                                ...currentConversationState.context.sessionMemory,
                                lastQuery: safeText,
                            },
                        },
                    };

                    return replaceSessionConversationState(state, targetSessionId, nextConversationState, {
                        title: hasUserMessage ? currentMeta.title : generateSessionTitle(safeText),
                        preview: buildSessionPreview(nextConversationState.messages),
                        updatedAt: Date.now(),
                    });
                });
            },
            appendAssistantMessage: (payload = {}) => set((state) => updateSessionConversationState(
                state,
                payload?.sessionId || state.activeSessionId,
                (sessionState) => ({
                    ...sessionState,
                    messages: trimMessages([...sessionState.messages, createAssistantMessage(payload)]),
                }),
                {
                    updatedAt: Date.now(),
                },
            )),
            beginAssistantStream: ({
                text = '',
                providerInfo = null,
                grounding = null,
                sessionId = '',
                messageId = '',
                provisional = false,
                upgradeEligible = false,
                traceId = '',
                decision = '',
            } = {}) => {
                const streamingMessageId = safeString(messageId || createMessageId());

                set((state) => updateSessionConversationState(
                    state,
                    sessionId || state.activeSessionId,
                    (sessionState) => {
                        const streamingMessage = createAssistantMessage({
                            id: streamingMessageId,
                            text: safeString(text || ''),
                            isStreaming: true,
                            status: 'thinking',
                            provisional: Boolean(provisional),
                            upgradeEligible: Boolean(upgradeEligible),
                            traceId: safeString(traceId || ''),
                            decision: safeString(decision || ''),
                            providerInfo,
                            grounding,
                            assistantTurn: createStreamingAssistantTurn(text),
                        });

                        return {
                            ...sessionState,
                            status: 'thinking',
                            isLoading: true,
                            messages: trimMessages([...sessionState.messages, streamingMessage]),
                            pendingUpgradeMessageIds: upgradeEligible
                                ? uniqueStrings([...sessionState.pendingUpgradeMessageIds, streamingMessageId])
                                : sessionState.pendingUpgradeMessageIds,
                        };
                    },
                    {
                        updatedAt: Date.now(),
                    },
                ));

                return streamingMessageId;
            },
            setAssistantStreamMeta: (messageId = '', payload = {}, sessionId = '') => set((state) => updateSessionConversationState(
                state,
                sessionId || state.activeSessionId,
                (sessionState) => {
                    const targetMessageId = safeString(messageId || payload?.messageId || '');
                    if (!targetMessageId) {
                        return sessionState;
                    }

                    return {
                        ...sessionState,
                        pendingUpgradeMessageIds: payload?.upgradeEligible
                            ? uniqueStrings([...sessionState.pendingUpgradeMessageIds, targetMessageId])
                            : sessionState.pendingUpgradeMessageIds.filter((entry) => entry !== targetMessageId),
                        messages: trimMessages(sessionState.messages.map((message) => (
                            message.id !== targetMessageId
                                ? message
                                : {
                                    ...message,
                                    provisional: Boolean(payload?.provisional),
                                    upgradeEligible: Boolean(payload?.upgradeEligible),
                                    traceId: safeString(payload?.traceId || message.traceId || ''),
                                    decision: safeString(payload?.decision || message.decision || ''),
                                    status: message.status === 'error' ? 'error' : 'thinking',
                                }
                        ))),
                    };
                },
                {
                    updatedAt: Date.now(),
                },
            )),
            appendAssistantStreamToken: (messageId = '', token = '', sessionId = '') => {
                const safeMessageId = safeString(messageId || '');
                const nextToken = String(token || '');
                if (!safeMessageId || !nextToken) {
                    return;
                }

                set((state) => updateSessionConversationState(
                    state,
                    sessionId || state.activeSessionId,
                    (sessionState) => ({
                        ...sessionState,
                        messages: trimMessages(sessionState.messages.map((message) => {
                            if (message.id !== safeMessageId || message.upgraded) {
                                return message;
                            }

                            const nextText = `${safeString(message.text || '', '')}${nextToken}`;
                            return {
                                ...message,
                                text: nextText,
                                isStreaming: true,
                                status: 'thinking',
                                assistantTurn: {
                                    ...(message.assistantTurn || createStreamingAssistantTurn()),
                                    response: nextText,
                                },
                            };
                        })),
                    }),
                    {
                        updatedAt: Date.now(),
                    },
                ));
            },
            mergeAssistantStreamEvent: (messageId = '', eventName = '', payload = {}, sessionId = '') => {
                const safeMessageId = safeString(messageId || '');
                const safeEventName = safeString(eventName || '');
                if (!safeMessageId || !safeEventName) {
                    return;
                }

                set((state) => updateSessionConversationState(
                    state,
                    sessionId || state.activeSessionId,
                    (sessionState) => ({
                        ...sessionState,
                        messages: trimMessages(sessionState.messages.map((message) => {
                            if (message.id !== safeMessageId || message.upgraded) {
                                return message;
                            }

                            const assistantTurn = {
                                ...(message.assistantTurn || createStreamingAssistantTurn(message.text || '')),
                            };

                            if (safeEventName === 'tool_start' || safeEventName === 'tool_end') {
                                assistantTurn.toolRuns = updateToolRunsForStream(assistantTurn.toolRuns, payload);
                            }

                            if (safeEventName === 'citation') {
                                assistantTurn.citations = appendStreamCitation(assistantTurn.citations, payload);
                            }

                            if (safeEventName === 'verification') {
                                assistantTurn.verification = payload;
                            }

                            return {
                                ...message,
                                assistantTurn,
                            };
                        })),
                    }),
                    {
                        updatedAt: Date.now(),
                    },
                ));
            },
            finalizeAssistantStream: (messageId = '', payload = {}, sessionId = '') => {
                const safeMessageId = safeString(messageId || payload?.messageId || '');
                if (!safeMessageId) {
                    return;
                }

                set((state) => updateSessionConversationState(
                    state,
                    sessionId || state.activeSessionId,
                    (sessionState) => applyAssistantTurnToConversationState(sessionState, {
                        ...payload,
                        id: safeMessageId,
                    }, {
                        replaceMessageId: safeMessageId,
                    }),
                    {
                        updatedAt: Date.now(),
                    },
                ));
            },
            discardAssistantStream: (messageId = '', sessionId = '') => {
                const safeMessageId = safeString(messageId || '');
                if (!safeMessageId) {
                    return;
                }

                set((state) => updateSessionConversationState(
                    state,
                    sessionId || state.activeSessionId,
                    (sessionState) => ({
                        ...sessionState,
                        status: 'idle',
                        isLoading: false,
                        pendingUpgradeMessageIds: sessionState.pendingUpgradeMessageIds.filter((entry) => entry !== safeMessageId),
                        messages: trimMessages(sessionState.messages.filter((message) => message.id !== safeMessageId)),
                    }),
                    {
                        updatedAt: Date.now(),
                    },
                ));
            },
            failAssistantStream: (messageId = '', text = '', payload = {}, sessionId = '') => set((state) => {
                const targetSessionId = safeString(sessionId || state.activeSessionId);
                const safeMessageId = safeString(messageId || payload?.messageId || '');
                const fallbackText = safeString(text || payload?.text || 'I hit a live service issue before I could finish that. Please try again in a moment.');
                if (!safeMessageId) {
                    return updateSessionConversationState(
                        state,
                        targetSessionId,
                        (sessionState) => applyAssistantTurnToConversationState(sessionState, {
                            text: fallbackText,
                            mode: 'explore',
                            status: 'error',
                            assistantTurn: {
                                intent: 'general_knowledge',
                                decision: 'respond',
                                response: fallbackText,
                                ui: {
                                    surface: 'plain_answer',
                                },
                                followUps: ['Try again'],
                            },
                        }),
                        {
                            updatedAt: Date.now(),
                        },
                    );
                }

                return updateSessionConversationState(
                    state,
                    targetSessionId,
                    (sessionState) => ({
                        ...sessionState,
                        status: 'idle',
                        isLoading: false,
                        pendingUpgradeMessageIds: sessionState.pendingUpgradeMessageIds.filter((entry) => entry !== safeMessageId),
                        messages: trimMessages(sessionState.messages.map((message) => (
                            message.id !== safeMessageId
                                ? message
                                : {
                                    ...message,
                                    text: fallbackText,
                                    isStreaming: false,
                                    status: 'error',
                                    upgradeEligible: false,
                                    provisional: false,
                                    assistantTurn: {
                                        ...(message.assistantTurn || createStreamingAssistantTurn()),
                                        response: fallbackText,
                                    },
                                }
                        ))),
                    }),
                    {
                        updatedAt: Date.now(),
                    },
                );
            }),
            setSurface: ({
                mode = 'explore',
                visibleProducts = [],
                primaryAction = null,
                secondaryActions = [],
                supportPrefill = null,
                activeProductId,
            } = {}) => set((state) => updateSessionConversationState(
                state,
                state.activeSessionId,
                (sessionState) => {
                    const candidateProductIds = buildCandidateProductIds(visibleProducts);
                    const resolvedActiveProductId = activeProductId !== undefined
                        ? activeProductId
                        : mode === 'product'
                            ? candidateProductIds[0] || null
                            : mode === 'explore'
                                ? null
                                : sessionState.context.activeProductId;

                    return {
                        ...sessionState,
                        mode,
                        visibleProducts: Array.isArray(visibleProducts) ? visibleProducts.slice(0, 4) : [],
                        primaryAction,
                        secondaryActions: normalizeActionList(secondaryActions, primaryAction),
                        supportPrefill,
                        context: {
                            ...sessionState.context,
                            candidateProductIds,
                            activeProductId: resolvedActiveProductId,
                        },
                    };
                },
            )),
            appendAssistantTurn: (payload = {}) => set((state) => updateSessionConversationState(
                state,
                payload?.sessionId || state.activeSessionId,
                (sessionState) => applyAssistantTurnToConversationState(sessionState, payload),
                {
                    updatedAt: Date.now(),
                },
            )),
            mergeAssistantUpgrade: (payload = {}) => set((state) => {
                const sessionId = safeString(payload?.sessionId || state.activeSessionId);
                const messageId = safeString(payload?.messageId || '');
                if (!messageId) {
                    return state;
                }

                return updateSessionConversationState(
                    state,
                    sessionId,
                    (sessionState) => {
                        let didMerge = false;
                        const nextMessages = sessionState.messages.map((message) => {
                            if (message.id !== messageId || message.role !== 'assistant') {
                                return message;
                            }

                            didMerge = true;
                            const nextText = safeString(payload?.content || payload?.text || message.text || '');
                            const nextAssistantTurn = buildAssistantTurnMeta({
                                ...(payload?.assistantTurn || {}),
                                response: nextText,
                                citations: Array.isArray(payload?.citations)
                                    ? payload.citations
                                    : message?.assistantTurn?.citations || [],
                                verification: payload?.verification || message?.assistantTurn?.verification || null,
                            }, message.assistantTurn || {});

                            return {
                                ...message,
                                text: nextText || message.text,
                                provisional: false,
                                upgraded: true,
                                upgradeEligible: false,
                                isStreaming: false,
                                status: 'complete',
                                traceId: safeString(payload?.traceId || message.traceId || ''),
                                decision: safeString(payload?.decision || message.decision || ''),
                                assistantTurn: nextAssistantTurn,
                                providerInfo: payload?.providerInfo || message.providerInfo || null,
                                grounding: payload?.grounding || message.grounding || null,
                            };
                        });

                        if (!didMerge) {
                            return sessionState;
                        }

                        return {
                            ...sessionState,
                            pendingUpgradeMessageIds: sessionState.pendingUpgradeMessageIds.filter((entry) => entry !== messageId),
                            messages: trimMessages(nextMessages),
                        };
                    },
                    {
                        updatedAt: Date.now(),
                    },
                );
            }),
            resetConversation: () => set((state) => {
                const nextOriginPath = safeString(state.context?.route || '/', '/');
                const bundle = createSessionBundle({
                    originPath: nextOriginPath,
                    preservedContext: buildPreservedContext(state.context || {}),
                });

                return syncDerivedSessionState({
                    ...state,
                    activeSessionId: bundle.meta.id,
                    sessions: sortSessions([bundle.meta, ...state.sessions]),
                    sessionStateById: {
                        ...state.sessionStateById,
                        [bundle.meta.id]: bundle.state,
                    },
                    sessionSearchQuery: '',
                });
            }),
            clearActiveSessionConversation: () => set((state) => updateSessionConversationState(
                state,
                state.activeSessionId,
                (sessionState, currentMeta) => createSessionConversationState({
                    sessionId: currentMeta?.id || state.activeSessionId,
                    preservedContext: buildPreservedContext(sessionState.context || { route: currentMeta?.originPath || '/' }),
                }),
                {
                    preview: DEFAULT_SESSION_PREVIEW,
                    updatedAt: Date.now(),
                },
            )),
            getVisibleSessions: () => filterChatSessions(get().sessions, get().sessionSearchQuery),
            getGroupedSessionHistory: () => groupChatSessionsByRecency(
                filterChatSessions(get().sessions, get().sessionSearchQuery),
            ),
        }),
        {
            name: CHAT_STORAGE_KEY,
            storage: createSafeStorage(),
            partialize: (state) => ({
                viewerScope: state.viewerScope,
                scopeSnapshotsById: state.scopeSnapshotsById,
                activeSessionId: state.activeSessionId,
                sessionSearchQuery: state.sessionSearchQuery,
                sessions: state.sessions,
                sessionStateById: state.sessionStateById,
            }),
            merge: mergeState,
        },
    ),
);

export const resetChatStoreForTests = () => {
    useChatStore.setState(createInitialState());
    if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(CHAT_STORAGE_KEY);
        window.localStorage.removeItem(LEGACY_CHAT_STORAGE_KEY);
    }
};
