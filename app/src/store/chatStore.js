import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const CHAT_STORAGE_KEY = 'aura-shopper-chat-v2';
const MAX_PERSISTED_MESSAGES = 24;
const MAX_VISIBLE_ACTIONS = 3;

const createMessageId = () => `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const trimMessages = (messages = []) => messages.slice(-MAX_PERSISTED_MESSAGES);

const normalizeProductId = (product = {}) => String(product?.id || product?._id || '').trim();

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
    id: createMessageId(),
    role: 'assistant',
    text: '',
    createdAt: Date.now(),
    isStreaming: false,
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
    ...payload,
});

export const createUserMessage = (text = '') => ({
    id: createMessageId(),
    role: 'user',
    text: String(text || '').trim(),
    createdAt: Date.now(),
});

export const createWelcomeMessage = () => createAssistantMessage({
    text: 'Tell me what you want to buy. I will keep the next step focused.',
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

const createInitialState = () => ({
    mode: 'explore',
    status: 'idle',
    isOpen: false,
    isLoading: false,
    inputValue: '',
    messages: [createWelcomeMessage()],
    visibleProducts: [],
    context: createInitialContext(),
    primaryAction: null,
    secondaryActions: [],
    supportPrefill: null,
    currentIntent: null,
    pendingAction: null,
    pendingConfirmation: null,
    lastAssistantTurn: null,
});

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

const normalizeActionList = (actions = [], primaryAction = null) => {
    const limit = primaryAction ? MAX_VISIBLE_ACTIONS - 1 : MAX_VISIBLE_ACTIONS;
    return Array.isArray(actions) ? actions.slice(0, Math.max(limit, 0)) : [];
};

const buildCandidateProductIds = (products = []) => (
    (Array.isArray(products) ? products : [])
        .map((product) => normalizeProductId(product))
        .filter(Boolean)
);

const mergeState = (persistedState, currentState) => {
    const nextState = persistedState?.state || persistedState || {};
    const mergedMessages = Array.isArray(nextState.messages) && nextState.messages.length > 0
        ? trimMessages(nextState.messages)
        : currentState.messages;

    return {
        ...currentState,
        ...nextState,
        messages: mergedMessages,
        visibleProducts: Array.isArray(nextState.visibleProducts) ? nextState.visibleProducts : currentState.visibleProducts,
        context: {
            ...currentState.context,
            ...(nextState.context || {}),
            assistantSession: {
                ...currentState.context.assistantSession,
                ...(nextState.context?.assistantSession || {}),
            },
            sessionMemory: {
                ...currentState.context.sessionMemory,
                ...(nextState.context?.sessionMemory || {}),
            },
        },
        secondaryActions: Array.isArray(nextState.secondaryActions) ? nextState.secondaryActions : currentState.secondaryActions,
    };
};

const deriveMessageMode = ({ mode, assistantTurn, products = [] } = {}) => {
    if (mode) return mode;
    if (assistantTurn?.ui?.surface) return surfaceToMode(assistantTurn.ui.surface);
    return Array.isArray(products) && products.length === 1 ? 'product' : 'explore';
};

const buildAssistantMessage = ({
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
}) => {
    const safeProducts = Array.isArray(products) ? products.slice(0, 4) : [];
    const resolvedProduct = product || safeProducts[0] || null;
    const resolvedMode = deriveMessageMode({
        mode,
        assistantTurn,
        products: resolvedProduct ? [resolvedProduct, ...safeProducts.filter((item) => normalizeProductId(item) !== normalizeProductId(resolvedProduct))] : safeProducts,
    });

    return createAssistantMessage({
        text,
        isStreaming: false,
        mode: resolvedMode,
        uiSurface: assistantTurn?.ui?.surface || 'plain_answer',
        assistantTurn,
        product: resolvedProduct,
        products: safeProducts,
        cartSummary,
        supportPrefill,
        confirmation,
        navigation,
        grounding,
        providerInfo,
    });
};

const shouldCoalesceAssistantMessage = (lastMessage = null, nextMessage = null) => {
    if (!lastMessage || !nextMessage) return false;
    if (lastMessage.role !== 'assistant' || nextMessage.role !== 'assistant') return false;
    if (lastMessage.isStreaming || nextMessage.isStreaming) return false;

    const lastText = String(lastMessage.text || '').trim();
    const nextText = String(nextMessage.text || '').trim();
    const lastSurface = String(lastMessage.uiSurface || lastMessage.assistantTurn?.ui?.surface || '').trim();
    const nextSurface = String(nextMessage.uiSurface || nextMessage.assistantTurn?.ui?.surface || '').trim();

    return Boolean(lastText && nextText && lastText === nextText && lastSurface === nextSurface);
};

const updateToolRunsForStream = (toolRuns = [], event = {}) => {
    const currentRuns = Array.isArray(toolRuns) ? [...toolRuns] : [];
    const toolName = String(event?.toolName || '').trim();
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
            summary: String(event?.summary || '').trim(),
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
            status: String(event?.status || 'completed').trim() || 'completed',
        };
        return currentRuns;
    }

    return [
        ...currentRuns,
        {
            ...event,
            toolName,
            status: String(event?.status || 'completed').trim() || 'completed',
        },
    ];
};

const appendStreamCitation = (citations = [], citation = {}) => {
    const currentCitations = Array.isArray(citations) ? [...citations] : [];
    const nextCitationId = String(citation?.id || `${citation?.path || ''}:${citation?.startLine || 0}`).trim();
    if (!nextCitationId) {
        return currentCitations;
    }

    const existingIndex = currentCitations.findIndex((entry) => String(entry?.id || '').trim() === nextCitationId);
    if (existingIndex >= 0) {
        currentCitations[existingIndex] = {
            ...currentCitations[existingIndex],
            ...citation,
        };
        return currentCitations;
    }

    return [...currentCitations, citation];
};

export const useChatStore = create(
    persist(
        (set, get) => ({
            ...createInitialState(),
            open: () => set({ isOpen: true }),
            close: () => set({ isOpen: false, inputValue: '' }),
            setInputValue: (inputValue = '') => set({ inputValue }),
            setLoading: (isLoading) => set((state) => ({
                isLoading: Boolean(isLoading),
                status: isLoading ? (state.status === 'executing' ? 'executing' : 'thinking') : 'idle',
            })),
            setStatus: (status = 'idle') => set({
                status,
                isLoading: status === 'thinking' || status === 'executing',
            }),
            setPendingAction: (pendingAction = null) => set({ pendingAction }),
            setPendingConfirmation: (pendingConfirmation = null) => set({ pendingConfirmation }),
            clearPendingConfirmation: () => set({ pendingConfirmation: null }),
            rememberExecutedAction: (fingerprint = '', executedAt = Date.now()) => set((state) => ({
                context: {
                    ...state.context,
                    sessionMemory: {
                        ...state.context.sessionMemory,
                        lastActionFingerprint: String(fingerprint || '').trim(),
                        lastActionAt: Number(executedAt || 0),
                    },
                },
            })),
            hydrateContext: (partial = {}) => set((state) => ({
                context: {
                    ...state.context,
                    ...partial,
                    assistantSession: {
                        ...state.context.assistantSession,
                        ...(partial.assistantSession || {}),
                    },
                    sessionMemory: {
                        ...state.context.sessionMemory,
                        ...(partial.sessionMemory || {}),
                    },
                },
            })),
            appendUserMessage: (text = '') => {
                const safeText = String(text || '').trim();
                if (!safeText) return;

                set((state) => ({
                    messages: trimMessages([...state.messages, createUserMessage(safeText)]),
                    context: {
                        ...state.context,
                        lastQuery: safeText,
                        sessionMemory: {
                            ...state.context.sessionMemory,
                            lastQuery: safeText,
                        },
                    },
                }));
            },
            appendAssistantMessage: (payload = {}) => {
                set((state) => ({
                    messages: trimMessages([...state.messages, createAssistantMessage(payload)]),
                }));
            },
            beginAssistantStream: ({
                text = '',
                providerInfo = null,
                grounding = null,
            } = {}) => {
                const streamingMessage = createAssistantMessage({
                    text: String(text || ''),
                    isStreaming: true,
                    providerInfo,
                    grounding,
                    assistantTurn: createStreamingAssistantTurn(text),
                });

                set((state) => ({
                    messages: trimMessages([...state.messages, streamingMessage]),
                }));

                return streamingMessage.id;
            },
            appendAssistantStreamToken: (messageId = '', token = '') => {
                const safeMessageId = String(messageId || '').trim();
                const nextToken = String(token || '');
                if (!safeMessageId || !nextToken) {
                    return;
                }

                set((state) => ({
                    messages: trimMessages(state.messages.map((message) => {
                        if (message.id !== safeMessageId) {
                            return message;
                        }

                        const nextText = `${String(message.text || '')}${nextToken}`;
                        return {
                            ...message,
                            text: nextText,
                            assistantTurn: {
                                ...(message.assistantTurn || createStreamingAssistantTurn()),
                                response: nextText,
                            },
                        };
                    })),
                }));
            },
            mergeAssistantStreamEvent: (messageId = '', eventName = '', payload = {}) => {
                const safeMessageId = String(messageId || '').trim();
                const safeEventName = String(eventName || '').trim();
                if (!safeMessageId || !safeEventName) {
                    return;
                }

                set((state) => ({
                    messages: trimMessages(state.messages.map((message) => {
                        if (message.id !== safeMessageId) {
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
                }));
            },
            finalizeAssistantStream: (messageId = '', payload = {}) => {
                const safeMessageId = String(messageId || '').trim();
                if (!safeMessageId) {
                    return;
                }

                const builtMessage = buildAssistantMessage(payload);

                set((state) => ({
                    messages: trimMessages(state.messages.map((message) => (
                        message.id === safeMessageId
                            ? {
                                ...builtMessage,
                                id: safeMessageId,
                                createdAt: message.createdAt,
                            }
                            : message
                    ))),
                }));
            },
            discardAssistantStream: (messageId = '') => {
                const safeMessageId = String(messageId || '').trim();
                if (!safeMessageId) {
                    return;
                }

                set((state) => ({
                    messages: trimMessages(state.messages.filter((message) => message.id !== safeMessageId)),
                }));
            },
            setSurface: ({
                mode = 'explore',
                visibleProducts = [],
                primaryAction = null,
                secondaryActions = [],
                supportPrefill = null,
                activeProductId,
            } = {}) => {
                const candidateProductIds = buildCandidateProductIds(visibleProducts);
                const resolvedActiveProductId = activeProductId !== undefined
                    ? activeProductId
                    : mode === 'product'
                        ? candidateProductIds[0] || null
                        : mode === 'explore'
                            ? null
                            : get().context.activeProductId;

                set((state) => ({
                    mode,
                    visibleProducts: Array.isArray(visibleProducts) ? visibleProducts.slice(0, 4) : [],
                    primaryAction,
                    secondaryActions: normalizeActionList(secondaryActions, primaryAction),
                    supportPrefill,
                    context: {
                        ...state.context,
                        candidateProductIds,
                        activeProductId: resolvedActiveProductId,
                    },
                }));
            },
            appendAssistantTurn: ({
                text = '',
                mode,
                products = [],
                product = null,
                primaryAction = null,
                secondaryActions = [],
                supportPrefill = null,
                cartSummary = null,
                confirmation = null,
                navigation = null,
                grounding = null,
                providerInfo = null,
                activeProductId,
                assistantTurn = null,
                assistantSession = null,
                pendingAction = null,
            } = {}) => {
                const safeProducts = Array.isArray(products) ? products.slice(0, 4) : [];
                const resolvedMode = deriveMessageMode({
                    mode,
                    assistantTurn,
                    products: safeProducts,
                });
                const resolvedProduct = product || safeProducts[0] || null;
                const candidateProductIds = buildCandidateProductIds(resolvedProduct ? [resolvedProduct, ...safeProducts] : safeProducts);
                const resolvedActiveProductId = activeProductId !== undefined
                    ? activeProductId
                    : resolvedMode === 'product'
                        ? normalizeProductId(resolvedProduct) || candidateProductIds[0] || null
                        : resolvedMode === 'explore'
                            ? null
                            : get().context.activeProductId;

                const nextPendingConfirmation = assistantTurn?.ui?.confirmation
                    ? assistantTurn.ui.confirmation
                    : confirmation
                        ? confirmation
                        : null;

                set((state) => {
                    const assistantSessionMemory = assistantTurn?.sessionMemory && typeof assistantTurn.sessionMemory === 'object'
                        ? assistantTurn.sessionMemory
                        : null;
                    const resolvedAssistantSession = assistantSession && typeof assistantSession === 'object'
                        ? assistantSession
                        : assistantTurn?.assistantSession && typeof assistantTurn.assistantSession === 'object'
                            ? assistantTurn.assistantSession
                            : null;
                    const nextSessionMemory = {
                        ...state.context.sessionMemory,
                        ...(assistantSessionMemory || {}),
                        lastQuery: assistantSessionMemory?.lastQuery ?? state.context.sessionMemory.lastQuery,
                        lastResults: Array.isArray(assistantSessionMemory?.lastResults)
                            ? assistantSessionMemory.lastResults
                            : state.context.sessionMemory.lastResults,
                        activeProduct: assistantSessionMemory?.activeProduct ?? state.context.sessionMemory.activeProduct,
                        lastIntent: assistantSessionMemory?.lastIntent
                            || assistantSessionMemory?.currentIntent
                            || assistantTurn?.intent
                            || state.context.sessionMemory.lastIntent
                            || state.context.sessionMemory.currentIntent,
                        currentIntent: assistantSessionMemory?.lastIntent
                            || assistantSessionMemory?.currentIntent
                            || assistantTurn?.intent
                            || state.context.sessionMemory.lastIntent
                            || state.context.sessionMemory.currentIntent,
                        clarificationState: assistantSessionMemory?.clarificationState
                            || state.context.sessionMemory.clarificationState,
                        lastActionFingerprint: assistantSessionMemory?.lastActionFingerprint
                            ?? state.context.sessionMemory.lastActionFingerprint,
                        lastActionAt: assistantSessionMemory?.lastActionAt
                            ?? state.context.sessionMemory.lastActionAt,
                    };

                    const nextMessage = buildAssistantMessage({
                        text,
                        mode: resolvedMode,
                        products: safeProducts,
                        product: resolvedProduct,
                        cartSummary,
                        supportPrefill,
                        confirmation,
                        navigation,
                        assistantTurn,
                        grounding,
                        providerInfo,
                    });
                    const lastMessage = state.messages[state.messages.length - 1] || null;
                    const nextMessages = shouldCoalesceAssistantMessage(lastMessage, nextMessage)
                        ? [
                            ...state.messages.slice(0, -1),
                            {
                                ...nextMessage,
                                id: lastMessage.id,
                                createdAt: lastMessage.createdAt,
                            },
                        ]
                        : [...state.messages, nextMessage];

                    return {
                        mode: resolvedMode,
                        status: 'idle',
                        isLoading: false,
                        messages: trimMessages(nextMessages),
                        visibleProducts: safeProducts,
                        primaryAction,
                        secondaryActions: normalizeActionList(secondaryActions, primaryAction),
                        supportPrefill,
                        currentIntent: assistantTurn?.intent || state.currentIntent,
                        pendingAction,
                        pendingConfirmation: nextPendingConfirmation,
                        lastAssistantTurn: assistantTurn || state.lastAssistantTurn,
                        context: {
                            ...state.context,
                            candidateProductIds,
                            activeProductId: resolvedActiveProductId,
                            lastOrderId: assistantTurn?.ui?.support?.orderId || state.context.lastOrderId,
                            assistantSession: resolvedAssistantSession
                                ? {
                                    ...state.context.assistantSession,
                                    ...resolvedAssistantSession,
                                }
                                : state.context.assistantSession,
                            sessionMemory: nextSessionMemory,
                        },
                    };
                });
            },
            resetConversation: () => set((state) => {
                const initialState = createInitialState();
                return {
                    ...initialState,
                    isOpen: state.isOpen,
                    context: {
                        ...initialState.context,
                        route: state.context.route,
                        cartCount: state.context.cartCount,
                        isAuthenticated: state.context.isAuthenticated,
                    },
                };
            }),
        }),
        {
            name: CHAT_STORAGE_KEY,
            storage: createSafeStorage(),
            partialize: (state) => ({
                mode: state.mode,
                messages: state.messages,
                visibleProducts: state.visibleProducts,
                context: state.context,
                primaryAction: state.primaryAction,
                secondaryActions: state.secondaryActions,
                supportPrefill: state.supportPrefill,
                currentIntent: state.currentIntent,
                pendingConfirmation: state.pendingConfirmation,
                lastAssistantTurn: state.lastAssistantTurn,
            }),
            merge: mergeState,
        }
    )
);

export const resetChatStoreForTests = () => {
    useChatStore.setState(createInitialState());
    if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(CHAT_STORAGE_KEY);
    }
};
