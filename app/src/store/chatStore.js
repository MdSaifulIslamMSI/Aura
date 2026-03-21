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
    mode: 'explore',
    uiSurface: 'plain_answer',
    assistantTurn: null,
    product: null,
    products: [],
    cartSummary: null,
    supportPrefill: null,
    confirmation: null,
    navigation: null,
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

const createInitialContext = () => ({
    route: '/',
    lastQuery: '',
    candidateProductIds: [],
    activeProductId: null,
    cartCount: 0,
    isAuthenticated: false,
    lastOrderId: null,
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
        mode: resolvedMode,
        uiSurface: assistantTurn?.ui?.surface || 'plain_answer',
        assistantTurn,
        product: resolvedProduct,
        products: safeProducts,
        cartSummary,
        supportPrefill,
        confirmation,
        navigation,
    });
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
            hydrateContext: (partial = {}) => set((state) => ({
                context: {
                    ...state.context,
                    ...partial,
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
                    },
                }));
            },
            appendAssistantMessage: (payload = {}) => {
                set((state) => ({
                    messages: trimMessages([...state.messages, createAssistantMessage(payload)]),
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
                activeProductId,
                assistantTurn = null,
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

                set((state) => ({
                    mode: resolvedMode,
                    status: 'idle',
                    isLoading: false,
                    messages: trimMessages([
                        ...state.messages,
                        buildAssistantMessage({
                            text,
                            mode: resolvedMode,
                            products: safeProducts,
                            product: resolvedProduct,
                            cartSummary,
                            supportPrefill,
                            confirmation,
                            navigation,
                            assistantTurn,
                        }),
                    ]),
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
                        lastOrderId: assistantTurn?.entities?.orderId || state.context.lastOrderId,
                    },
                }));
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
