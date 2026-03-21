import {
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
import { WishlistContext } from '@/context/WishlistContext';
import { chatApi } from '@/services/chatApi';
import { useChatStore } from '@/store/chatStore';
import { selectCartItems, selectCartSummary, useCommerceStore } from '@/store/commerceStore';
import {
    buildAssistantRequestPayload,
    buildModeActions,
    buildSuggestionActions,
    createChatAction,
    normalizeProductSummary,
} from '@/utils/assistantCommands';
import { createAssistantActionRegistry } from './assistantActionRegistry';

const MAX_HISTORY_ENTRIES = 12;

const extractProductIdFromPath = (pathname = '') => {
    const match = String(pathname || '').match(/^\/product\/([^/?#]+)/i);
    return match?.[1] ? String(match[1]).trim() : null;
};

const trimConversationHistory = (messages = []) => messages
    .filter((message) => message?.role && String(message?.text || '').trim())
    .map((message) => ({
        role: message.role,
        content: String(message.text || '').trim(),
    }))
    .slice(-MAX_HISTORY_ENTRIES);

const safeString = (value = '') => String(value ?? '').trim();

const isConfirmationMessage = (value = '') => /^(yes|confirm|go ahead|proceed|do it|continue|okay|ok)$/i.test(safeString(value));

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

const PRODUCT_SURFACES = new Set(['product_results', 'product_focus']);

const buildCheckoutConfirmationTurn = () => ({
    intent: 'navigation',
    entities: {
        query: '',
        productId: '',
        quantity: 0,
    },
    confidence: 1,
    decision: 'clarify',
    response: 'Checkout affects payment and order placement. Confirm before continuing.',
    actions: [],
    ui: {
        surface: 'confirmation_card',
        confirmation: {
            token: `confirm-${Date.now().toString(36)}`,
            message: 'Checkout affects payment and order placement. Confirm before continuing.',
            action: {
                type: 'navigate_to',
                page: 'checkout',
                params: {},
                requiresConfirmation: true,
                reason: 'client_checkout_confirmation',
            },
        },
    },
    contextPatch: {},
    followUps: [],
    safetyFlags: [],
});

const normalizeUiProducts = (assistantTurn = {}, response = {}) => {
    const surface = safeString(assistantTurn?.ui?.surface || 'plain_answer');
    if (!PRODUCT_SURFACES.has(surface)) {
        return [];
    }

    const turnProducts = Array.isArray(assistantTurn?.ui?.products) ? assistantTurn.ui.products : [];
    const responseProducts = Array.isArray(response?.products) ? response.products : [];
    const product = assistantTurn?.ui?.product ? [assistantTurn.ui.product] : [];

    return [...product, ...turnProducts, ...responseProducts]
        .map((entry) => normalizeProductSummary(entry))
        .filter((entry) => entry.id)
        .filter((entry, index, array) => array.findIndex((candidate) => candidate.id === entry.id) === index)
        .slice(0, 4);
};

const buildSurfaceActions = ({
    assistantTurn,
    cartCount = 0,
    lastQuery = '',
    products = [],
    supportPrefill = null,
}) => {
    if (assistantTurn?.intent === 'general_knowledge' || assistantTurn?.intent === 'unclear') {
        return {
            primaryAction: null,
            secondaryActions: [],
        };
    }

    const mode = surfaceToMode(assistantTurn?.ui?.surface || 'plain_answer');
    if (assistantTurn?.ui?.surface === 'confirmation_card') {
        return {
            primaryAction: null,
            secondaryActions: [],
        };
    }

    const followUpActions = buildSuggestionActions(assistantTurn?.followUps || []);
    const externalActions = [];

    if (mode === 'product' && products[0]?.id) {
        externalActions.push(createChatAction('add-to-cart', 'Add to cart', { id: products[0].id }, 'primary'));
        externalActions.push(createChatAction('view-details', 'View details', { id: products[0].id }));
    }

    return buildModeActions({
        mode,
        products,
        cartCount,
        lastQuery,
        supportPrefill,
        externalActions: [...externalActions, ...followUpActions],
    });
};

const mergeExecutionResults = (results = []) => results.reduce((acc, result) => ({
    success: acc.success && result.success !== false,
    message: safeString(result.message || acc.message),
    product: result.product || acc.product || null,
    products: Array.isArray(result.products) && result.products.length > 0 ? result.products : acc.products,
    cartSummary: result.cartSummary || acc.cartSummary || null,
    supportPrefill: result.supportPrefill || acc.supportPrefill || null,
    navigation: result.navigation || acc.navigation || null,
    activeProductId: safeString(result.activeProductId || acc.activeProductId || ''),
}), {
    success: true,
    message: '',
    product: null,
    products: [],
    cartSummary: null,
    supportPrefill: null,
    navigation: null,
    activeProductId: '',
});

export const useAssistantController = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { isAuthenticated } = useContext(AuthContext);
    const { wishlistItems = [] } = useContext(WishlistContext);

    const inputRef = useRef(null);
    const requestSequenceRef = useRef(0);

    const messages = useChatStore((state) => state.messages);
    const visibleProducts = useChatStore((state) => state.visibleProducts);
    const context = useChatStore((state) => state.context);
    const sessionMemory = useChatStore((state) => state.context.sessionMemory);
    const supportPrefill = useChatStore((state) => state.supportPrefill);
    const pendingConfirmation = useChatStore((state) => state.pendingConfirmation);
    const lastAssistantTurn = useChatStore((state) => state.lastAssistantTurn);
    const appendUserMessage = useChatStore((state) => state.appendUserMessage);
    const appendAssistantTurn = useChatStore((state) => state.appendAssistantTurn);
    const hydrateContext = useChatStore((state) => state.hydrateContext);
    const setInputValue = useChatStore((state) => state.setInputValue);
    const setStatus = useChatStore((state) => state.setStatus);
    const setPendingAction = useChatStore((state) => state.setPendingAction);
    const clearPendingConfirmation = useChatStore((state) => state.clearPendingConfirmation);
    const close = useChatStore((state) => state.close);
    const setSurface = useChatStore((state) => state.setSurface);

    const cartState = useCommerceStore((state) => state.cart);
    const cartItems = useMemo(() => selectCartItems({ cart: cartState }), [cartState]);
    const cartSummary = useMemo(() => selectCartSummary({ cart: cartState }), [cartState]);

    const routeProductId = useMemo(() => extractProductIdFromPath(location.pathname), [location.pathname]);
    const conversationHistory = useMemo(() => trimConversationHistory(messages), [messages]);

    const productCandidates = useMemo(() => {
        const pool = [...visibleProducts];
        [...messages].reverse().forEach((message) => {
            if (Array.isArray(message?.products)) {
                pool.push(...message.products);
            }
            if (message?.product) {
                pool.push(message.product);
            }
        });

        return pool
            .map((product) => normalizeProductSummary(product))
            .filter((product) => product.id)
            .filter((product, index, array) => array.findIndex((candidate) => candidate.id === product.id) === index);
    }, [messages, visibleProducts]);

    const registry = useMemo(() => createAssistantActionRegistry({
        navigate,
        isAuthenticated,
        candidates: productCandidates,
    }), [isAuthenticated, navigate, productCandidates]);

    useEffect(() => {
        const nextCandidateProductIds = routeProductId
            ? [...new Set([routeProductId, ...(context.candidateProductIds || [])])].slice(0, 4)
            : context.candidateProductIds;
        const nextActiveProductId = routeProductId || context.activeProductId;
        const sameCandidateIds = nextCandidateProductIds.length === (context.candidateProductIds || []).length
            && nextCandidateProductIds.every((id, index) => id === context.candidateProductIds[index]);

        if (
            context.route === location.pathname
            && context.cartCount === cartSummary.totalItems
            && context.isAuthenticated === isAuthenticated
            && context.activeProductId === nextActiveProductId
            && sameCandidateIds
        ) {
            return;
        }

        hydrateContext({
            route: location.pathname,
            cartCount: cartSummary.totalItems,
            isAuthenticated,
            activeProductId: nextActiveProductId,
            candidateProductIds: nextCandidateProductIds,
        });
    }, [
        cartSummary.totalItems,
        context.activeProductId,
        context.candidateProductIds,
        context.isAuthenticated,
        context.route,
        hydrateContext,
        isAuthenticated,
        location.pathname,
        routeProductId,
    ]);

    const executePlannedActions = useCallback(async (assistantTurn) => {
        const uiProducts = normalizeUiProducts(assistantTurn, {});
        const results = [];
        const plannedActions = assistantTurn?.actionRequest
            ? [assistantTurn.actionRequest]
            : (assistantTurn?.actions || []);

        for (const action of plannedActions) {
            setPendingAction(action);
            const result = await registry.executeAssistantAction(action, {
                uiProducts,
            });
            results.push(result);
        }

        setPendingAction(null);
        return mergeExecutionResults(results);
    }, [registry, setPendingAction]);

    const presentAssistantTurn = useCallback((assistantTurn, response = {}, execution = null) => {
        const products = normalizeUiProducts(assistantTurn, response);
        const product = execution?.product || products[0] || null;
        const supportUi = assistantTurn?.ui?.support || null;
        const derivedSupportPrefill = execution?.supportPrefill || supportUi?.prefill || null;
        const derivedCartSummary = execution?.cartSummary
            || assistantTurn?.ui?.cartSummary
            || (assistantTurn?.ui?.surface === 'cart_summary' ? cartSummary : null);
        const actions = buildSurfaceActions({
            assistantTurn,
            cartCount: cartSummary.totalItems,
            lastQuery: context.lastQuery,
            products,
            supportPrefill: derivedSupportPrefill,
        });

        appendAssistantTurn({
            text: safeString(execution?.message || assistantTurn?.response || response?.text || response?.answer || 'I can help with that.'),
            mode: surfaceToMode(assistantTurn?.ui?.surface || 'plain_answer'),
            products,
            product,
            primaryAction: actions.primaryAction,
            secondaryActions: actions.secondaryActions,
            cartSummary: derivedCartSummary,
            supportPrefill: derivedSupportPrefill,
            confirmation: assistantTurn?.ui?.confirmation || null,
            navigation: execution?.navigation || assistantTurn?.ui?.navigation || null,
            activeProductId: safeString(execution?.activeProductId || product?.id || ''),
            assistantTurn,
            pendingAction: null,
        });
    }, [appendAssistantTurn, cartSummary, context.lastQuery]);

    const confirmPendingAction = useCallback(async (confirmationToken = '') => {
        if (!pendingConfirmation?.action || (confirmationToken && pendingConfirmation.token !== confirmationToken)) {
            return;
        }

        setStatus('executing');
        clearPendingConfirmation();

        try {
            const result = await registry.executeAssistantAction(pendingConfirmation.action, {
                uiProducts: normalizeUiProducts(lastAssistantTurn || {}, {}),
            });
            const syntheticTurn = {
                ...(lastAssistantTurn || buildCheckoutConfirmationTurn()),
                decision: 'act',
                response: safeString(result.message || 'Continuing.'),
                ui: {
                    ...(lastAssistantTurn?.ui || {}),
                    confirmation: null,
                    navigation: result.navigation || lastAssistantTurn?.ui?.navigation || null,
                },
            };

            presentAssistantTurn(syntheticTurn, {}, result);

            if (
                pendingConfirmation.action.type === 'go_to_checkout'
                || pendingConfirmation.action.type === 'open_support'
                || (
                    pendingConfirmation.action.type === 'navigate_to'
                    && ['checkout', 'support', 'orders'].includes(safeString(pendingConfirmation.action.page || ''))
                )
            ) {
                close();
            }
        } catch (error) {
            appendAssistantTurn({
                text: error?.message || 'I could not complete that action right now.',
                mode: 'explore',
                assistantTurn: {
                    intent: 'general_knowledge',
                    decision: 'respond',
                    response: error?.message || 'I could not complete that action right now.',
                    ui: {
                        surface: 'plain_answer',
                    },
                    followUps: [],
                },
            });
        } finally {
            setStatus('idle');
            setPendingAction(null);
        }
    }, [
        appendAssistantTurn,
        clearPendingConfirmation,
        close,
        lastAssistantTurn,
        pendingConfirmation,
        presentAssistantTurn,
        registry,
        setPendingAction,
        setStatus,
    ]);

    const cancelPendingAction = useCallback(() => {
        clearPendingConfirmation();
        appendAssistantTurn({
            text: 'Okay, I will hold here.',
            mode: 'checkout',
            assistantTurn: {
                intent: 'navigation',
                decision: 'respond',
                response: 'Okay, I will hold here.',
                ui: {
                    surface: 'plain_answer',
                },
                followUps: ['Show my cart', 'Continue shopping'],
            },
        });
    }, [appendAssistantTurn, clearPendingConfirmation]);

    const handleUserInput = useCallback(async (rawText, { confirmationToken } = {}) => {
        const cleanedText = safeString(rawText);
        if (!cleanedText && !confirmationToken) return;

        if (confirmationToken || (pendingConfirmation && isConfirmationMessage(cleanedText))) {
            if (cleanedText) {
                appendUserMessage(cleanedText);
            }
            void confirmPendingAction(confirmationToken || pendingConfirmation?.token || '');
            setInputValue('');
            return;
        }

        appendUserMessage(cleanedText);
        setInputValue('');
        setStatus('thinking');
        const requestId = requestSequenceRef.current + 1;
        requestSequenceRef.current = requestId;

        const requestConfig = buildAssistantRequestPayload({
            message: cleanedText,
            pathname: location.pathname,
            candidateProductIds: context.candidateProductIds,
            latestProducts: productCandidates,
            cartItems,
            wishlistItems,
            activeProductId: context.activeProductId || routeProductId,
        });

        try {
            const response = await chatApi.sendMessage({
                message: cleanedText,
                conversationHistory: [
                    ...conversationHistory,
                    { role: 'user', content: cleanedText },
                ].slice(-MAX_HISTORY_ENTRIES),
                assistantMode: requestConfig.assistantMode,
                context: {
                    ...requestConfig.context,
                    cartItems,
                    cartSummary,
                    currentProductId: context.activeProductId || routeProductId,
                    currentProduct: productCandidates.find((product) => product.id === (context.activeProductId || routeProductId)) || null,
                    sessionMemory,
                },
            });

            const assistantTurn = response?.assistantTurn;
            if (!assistantTurn || typeof assistantTurn !== 'object') {
                throw new Error('Assistant response is missing a structured turn');
            }
            if (requestId !== requestSequenceRef.current) {
                return;
            }

            const plannedActions = assistantTurn?.actionRequest
                ? [assistantTurn.actionRequest]
                : (Array.isArray(assistantTurn.actions) ? assistantTurn.actions : []);

            if (assistantTurn.decision === 'act' && plannedActions.length > 0) {
                setStatus('executing');
                try {
                    const execution = await executePlannedActions(assistantTurn);
                    if (requestId !== requestSequenceRef.current) {
                        return;
                    }
                    const responseTurn = {
                        ...assistantTurn,
                        response: safeString(execution.message || assistantTurn.response),
                    };
                    presentAssistantTurn(responseTurn, response, execution);

                    const leadingActionType = plannedActions[0]?.type;
                    const leadingPage = plannedActions[0]?.page;
                    if (
                        leadingActionType === 'go_to_checkout'
                        || leadingActionType === 'open_support'
                        || (leadingActionType === 'navigate_to' && ['checkout', 'support', 'orders'].includes(safeString(leadingPage || '')))
                    ) {
                        close();
                    }
                } catch (error) {
                    appendAssistantTurn({
                        text: error?.message || 'I could not complete that action right now.',
                        mode: 'explore',
                        assistantTurn: {
                            intent: assistantTurn.intent,
                            decision: 'respond',
                            response: error?.message || 'I could not complete that action right now.',
                            ui: {
                                surface: 'plain_answer',
                            },
                            followUps: assistantTurn.followUps || [],
                        },
                    });
                }
            } else {
                presentAssistantTurn(assistantTurn, response, null);
            }
        } catch {
            if (requestId !== requestSequenceRef.current) {
                return;
            }
            appendAssistantTurn({
                text: 'The assistant is temporarily unavailable. Try again, or refine the request with a simpler product cue.',
                mode: 'explore',
                assistantTurn: {
                    intent: 'general_knowledge',
                    decision: 'respond',
                    response: 'The assistant is temporarily unavailable. Try again, or refine the request with a simpler product cue.',
                    ui: {
                        surface: 'plain_answer',
                    },
                    followUps: ['Best deals today', 'Search premium phones', 'Build a smart bundle'],
                },
            });
        } finally {
            if (requestId === requestSequenceRef.current) {
                setStatus('idle');
                setPendingAction(null);
            }
        }
    }, [
        appendAssistantTurn,
        appendUserMessage,
        cartItems,
        cartSummary,
        close,
        confirmPendingAction,
        context.activeProductId,
        context.candidateProductIds,
        conversationHistory,
        executePlannedActions,
        location.pathname,
        pendingConfirmation,
        presentAssistantTurn,
        productCandidates,
        routeProductId,
        sessionMemory,
        setInputValue,
        setPendingAction,
        setStatus,
        wishlistItems,
    ]);

    const handleAction = useCallback((action) => {
        if (!action?.kind) return;

        if (action.kind === 'search' && action.payload?.query) {
            void handleUserInput(action.payload.query);
            return;
        }

        if (action.kind === 'navigate' && action.payload?.page) {
            void registry.executeAssistantAction({
                type: 'navigate_to',
                page: action.payload.page,
                params: action.payload.params || {},
            });
            return;
        }

        if (action.kind === 'add-to-cart' && action.payload?.id) {
            void registry.executeAssistantAction({
                type: 'add_to_cart',
                productId: action.payload.id,
                quantity: action.payload.quantity || 1,
            }).then((result) => {
                presentAssistantTurn({
                    intent: 'cart_action',
                    decision: 'act',
                    response: result.message,
                    ui: {
                        surface: 'cart_summary',
                    },
                    followUps: ['Show my cart', 'Go to checkout'],
                }, {}, result);
            });
            return;
        }

        if ((action.kind === 'select-product' || action.kind === 'view-details') && action.payload?.id) {
            void registry.executeAssistantAction({
                type: 'select_product',
                productId: action.payload.id,
            });
            return;
        }

        if (action.kind === 'view-cart' || action.kind === 'edit-cart') {
            void registry.executeAssistantAction({
                type: 'navigate_to',
                page: 'cart',
            });
            return;
        }

        if (action.kind === 'continue-shopping') {
            setSurface({
                mode: 'explore',
                visibleProducts,
                primaryAction: null,
                secondaryActions: [],
                supportPrefill: null,
                activeProductId: null,
            });
            inputRef.current?.focus();
            return;
        }

        if (action.kind === 'prepare-checkout') {
            const checkoutTurn = buildCheckoutConfirmationTurn();
            presentAssistantTurn(checkoutTurn, {}, null);
            return;
        }

        if (action.kind === 'go-checkout') {
            void confirmPendingAction(pendingConfirmation?.token || '');
            return;
        }

        if (action.kind === 'handoff-support') {
            const orderId = safeString(lastAssistantTurn?.ui?.support?.orderId || context.lastOrderId || '');
            void registry.executeAssistantAction({
                type: 'open_support',
                orderId,
                prefill: action.payload?.prefill || supportPrefill || lastAssistantTurn?.ui?.support?.prefill || {},
            }).then(() => close());
        }
    }, [
        close,
        confirmPendingAction,
        context.lastOrderId,
        handleUserInput,
        lastAssistantTurn,
        pendingConfirmation?.token,
        presentAssistantTurn,
        registry,
        setSurface,
        supportPrefill,
        visibleProducts,
    ]);

    const selectProduct = useCallback((productId) => {
        if (!productId) return Promise.resolve();
        return registry.executeAssistantAction({
            type: 'select_product',
            productId,
        });
    }, [registry]);

    const addProductToCart = useCallback((productId, quantity = 1) => {
        if (!productId) return Promise.resolve();
        return registry.executeAssistantAction({
            type: 'add_to_cart',
            productId,
            quantity,
        }).then((result) => {
            presentAssistantTurn({
                intent: 'cart_action',
                decision: 'act',
                response: result.message,
                ui: {
                    surface: 'cart_summary',
                },
                followUps: ['Show my cart', 'Go to checkout'],
            }, {}, result);
        });
    }, [presentAssistantTurn, registry]);

    const openSupport = useCallback((prefill = {}, orderId = '') => (
        registry.executeAssistantAction({
            type: 'open_support',
            orderId: safeString(orderId || lastAssistantTurn?.ui?.support?.orderId || context.lastOrderId || ''),
            prefill,
        }).then(() => close())
    ), [close, context.lastOrderId, lastAssistantTurn?.ui?.support?.orderId, registry]);

    return {
        inputRef,
        addProductToCart,
        cancelPendingAction,
        confirmPendingAction,
        handleAction,
        handleUserInput,
        openSupport,
        selectProduct,
    };
};

export default useAssistantController;
