import {
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
import { useSocket } from '@/context/SocketContext';
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

const resolveAssistantContextPath = (location = {}) => {
    const pathname = safeString(location?.pathname || '/', '/');
    if (!pathname.startsWith('/assistant')) {
        return pathname;
    }

    const from = safeString(new URLSearchParams(location?.search || '').get('from') || '/', '/');
    return from.startsWith('/') ? from : `/${from}`;
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
    const followUpActions = buildSuggestionActions(assistantTurn?.followUps || []);

    if (assistantTurn?.intent === 'general_knowledge') {
        return {
            primaryAction: null,
            secondaryActions: [],
        };
    }

    if (assistantTurn?.intent === 'unclear') {
        return {
            primaryAction: null,
            secondaryActions: followUpActions,
        };
    }

    const mode = surfaceToMode(assistantTurn?.ui?.surface || 'plain_answer');
    if (assistantTurn?.ui?.surface === 'confirmation_card') {
        return {
            primaryAction: null,
            secondaryActions: [],
        };
    }

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
    message: result?.suppressedDuplicate ? acc.message : safeString(result.message || acc.message),
    product: result.product || acc.product || null,
    products: Array.isArray(result.products) && result.products.length > 0 ? result.products : acc.products,
    cartSummary: result.cartSummary || acc.cartSummary || null,
    supportPrefill: result.supportPrefill || acc.supportPrefill || null,
    navigation: result.navigation || acc.navigation || null,
    activeProductId: safeString(result.activeProductId || acc.activeProductId || ''),
    suppressedDuplicate: acc.suppressedDuplicate && Boolean(result?.suppressedDuplicate),
    actionFingerprint: safeString(result.actionFingerprint || acc.actionFingerprint || ''),
    actionAt: Math.max(Number(acc.actionAt || 0), Number(result.actionAt || 0)),
}), {
    success: true,
    message: '',
    product: null,
    products: [],
    cartSummary: null,
    supportPrefill: null,
    navigation: null,
    activeProductId: '',
    suppressedDuplicate: results.length > 0,
    actionFingerprint: '',
    actionAt: 0,
});

export const useAssistantController = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { isAuthenticated } = useContext(AuthContext);
    const { wishlistItems = [] } = useContext(WishlistContext);
    const { socket } = useSocket() || {};

    const inputRef = useRef(null);
    const requestSequenceRef = useRef(0);

    const messages = useChatStore((state) => state.messages);
    const visibleProducts = useChatStore((state) => state.visibleProducts);
    const activeSessionId = useChatStore((state) => state.activeSessionId);
    const context = useChatStore((state) => state.context);
    const assistantSession = useChatStore((state) => state.context.assistantSession);
    const sessionMemory = useChatStore((state) => state.context.sessionMemory);
    const supportPrefill = useChatStore((state) => state.supportPrefill);
    const pendingConfirmation = useChatStore((state) => state.pendingConfirmation);
    const lastAssistantTurn = useChatStore((state) => state.lastAssistantTurn);
    const appendUserMessage = useChatStore((state) => state.appendUserMessage);
    const appendAssistantTurn = useChatStore((state) => state.appendAssistantTurn);
    const beginAssistantStream = useChatStore((state) => state.beginAssistantStream);
    const setAssistantStreamMeta = useChatStore((state) => state.setAssistantStreamMeta);
    const appendAssistantStreamToken = useChatStore((state) => state.appendAssistantStreamToken);
    const mergeAssistantStreamEvent = useChatStore((state) => state.mergeAssistantStreamEvent);
    const finalizeAssistantStream = useChatStore((state) => state.finalizeAssistantStream);
    const discardAssistantStream = useChatStore((state) => state.discardAssistantStream);
    const failAssistantStream = useChatStore((state) => state.failAssistantStream);
    const mergeAssistantUpgrade = useChatStore((state) => state.mergeAssistantUpgrade);
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

    const assistantContextPath = useMemo(
        () => resolveAssistantContextPath(location),
        [location.pathname, location.search],
    );
    const routeProductId = useMemo(() => extractProductIdFromPath(assistantContextPath), [assistantContextPath]);
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
            context.route === assistantContextPath
            && context.cartCount === cartSummary.totalItems
            && context.isAuthenticated === isAuthenticated
            && context.activeProductId === nextActiveProductId
            && sameCandidateIds
        ) {
            return;
        }

        hydrateContext({
            route: assistantContextPath,
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
        assistantContextPath,
        isAuthenticated,
        routeProductId,
    ]);

    useEffect(() => {
        if (!socket || !isAuthenticated) {
            return undefined;
        }

        const handleAssistantUpgrade = (payload = {}) => {
            mergeAssistantUpgrade({
                sessionId: payload?.sessionId || '',
                messageId: payload?.messageId || '',
                content: payload?.content || '',
                citations: payload?.citations || [],
                verification: payload?.verification || null,
                providerInfo: payload?.providerInfo || null,
                decision: payload?.decision || '',
                traceId: payload?.traceId || '',
                grounding: payload?.grounding || null,
                assistantTurn: payload?.assistantTurn || null,
            });
        };

        socket.on('assistant.upgrade', handleAssistantUpgrade);
        return () => {
            socket.off('assistant.upgrade', handleAssistantUpgrade);
        };
    }, [isAuthenticated, mergeAssistantUpgrade, socket]);

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

    const presentAssistantTurn = useCallback((assistantTurn, response = {}, execution = null, options = {}) => {
        if (execution?.suppressedDuplicate) {
            if (options?.replaceMessageId) {
                discardAssistantStream(options.replaceMessageId, options.sessionId || activeSessionId);
            }
            return;
        }

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
        const messagePayload = {
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
            grounding: response?.grounding || null,
            providerInfo: response?.providerInfo || {
                name: safeString(response?.provider || ''),
                model: safeString(response?.providerModel || ''),
            },
            activeProductId: safeString(execution?.activeProductId || product?.id || ''),
            provisional: Boolean(response?.provisional),
            upgradeEligible: Boolean(response?.upgradeEligible),
            traceId: safeString(response?.traceId || response?.grounding?.traceId || ''),
            decision: safeString(response?.decision || assistantTurn?.decision || ''),
            assistantTurn,
            assistantSession: response?.assistantSession || assistantTurn?.assistantSession || null,
            pendingAction: null,
        };

        if (options?.replaceMessageId) {
            finalizeAssistantStream(options.replaceMessageId, messagePayload, options.sessionId || activeSessionId);
            return;
        }

        appendAssistantTurn({
            ...messagePayload,
            sessionId: options.sessionId || activeSessionId,
        });
    }, [
        activeSessionId,
        appendAssistantTurn,
        cartSummary,
        context.lastQuery,
        discardAssistantStream,
        finalizeAssistantStream,
    ]);

    const confirmPendingAction = useCallback(async (confirmationToken = '') => {
        if (!pendingConfirmation?.action || (confirmationToken && pendingConfirmation.token !== confirmationToken)) {
            return;
        }

        setStatus('executing');
        clearPendingConfirmation();

        try {
            const response = await chatApi.sendMessage({
                message: '',
                conversationHistory: conversationHistory.slice(-MAX_HISTORY_ENTRIES),
                assistantMode: 'chat',
                sessionId: assistantSession?.sessionId || activeSessionId || '',
                confirmation: {
                    actionId: pendingConfirmation.token,
                    approved: true,
                    contextVersion: pendingConfirmation.action?.contextVersion || assistantSession?.contextVersion || 0,
                },
                context: {
                    clientSessionId: activeSessionId,
                    route: assistantContextPath,
                    routeLabel: context.routeLabel,
                    cartItems,
                    cartSummary,
                    currentProductId: context.activeProductId || routeProductId,
                    currentProduct: productCandidates.find((product) => product.id === (context.activeProductId || routeProductId)) || null,
                    assistantSession,
                },
            });
            const assistantTurn = response?.assistantTurn;
            if (!assistantTurn || typeof assistantTurn !== 'object') {
                throw new Error('Assistant confirmation response is missing a structured turn');
            }

            const plannedActions = assistantTurn?.actionRequest
                ? [assistantTurn.actionRequest]
                : (Array.isArray(assistantTurn.actions) ? assistantTurn.actions : []);

            if (assistantTurn.decision === 'act' && plannedActions.length > 0) {
                const execution = await executePlannedActions(assistantTurn);
                if (!execution?.suppressedDuplicate) {
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
                }
            } else {
                presentAssistantTurn(assistantTurn, response, null);
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
        activeSessionId,
        assistantSession,
        assistantContextPath,
        appendAssistantTurn,
        cartItems,
        cartSummary,
        clearPendingConfirmation,
        close,
        context.activeProductId,
        context.routeLabel,
        conversationHistory,
        executePlannedActions,
        pendingConfirmation,
        presentAssistantTurn,
        productCandidates,
        routeProductId,
        setPendingAction,
        setStatus,
    ]);

    const cancelPendingAction = useCallback(async () => {
        if (!pendingConfirmation?.token) {
            return;
        }

        clearPendingConfirmation();
        try {
            const response = await chatApi.sendMessage({
                message: '',
                conversationHistory: conversationHistory.slice(-MAX_HISTORY_ENTRIES),
                assistantMode: 'chat',
                sessionId: assistantSession?.sessionId || activeSessionId || '',
                confirmation: {
                    actionId: pendingConfirmation.token,
                    approved: false,
                    contextVersion: pendingConfirmation.action?.contextVersion || assistantSession?.contextVersion || 0,
                },
                context: {
                    clientSessionId: activeSessionId,
                    route: assistantContextPath,
                    routeLabel: context.routeLabel,
                    cartItems,
                    cartSummary,
                    currentProductId: context.activeProductId || routeProductId,
                    currentProduct: productCandidates.find((product) => product.id === (context.activeProductId || routeProductId)) || null,
                    assistantSession,
                },
            });
            const assistantTurn = response?.assistantTurn;
            if (!assistantTurn || typeof assistantTurn !== 'object') {
                throw new Error('Assistant cancellation response is missing a structured turn');
            }

            presentAssistantTurn(assistantTurn, response, null);
        } catch {
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
        }
    }, [
        activeSessionId,
        assistantSession,
        assistantContextPath,
        appendAssistantTurn,
        cartItems,
        cartSummary,
        clearPendingConfirmation,
        context.activeProductId,
        context.routeLabel,
        conversationHistory,
        pendingConfirmation,
        presentAssistantTurn,
        productCandidates,
        routeProductId,
    ]);

    const modifyPendingAction = useCallback(() => {
        void cancelPendingAction().finally(() => {
            window.requestAnimationFrame(() => inputRef.current?.focus());
        });
    }, [cancelPendingAction]);

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
            pathname: assistantContextPath,
            candidateProductIds: context.candidateProductIds,
            latestProducts: productCandidates,
            cartItems,
            wishlistItems,
            activeProductId: context.activeProductId || routeProductId,
        });
        const streamMessageId = beginAssistantStream({
            sessionId: activeSessionId,
        });

        try {
            const response = await chatApi.streamMessage({
                message: cleanedText,
                conversationHistory: [
                    ...conversationHistory,
                    { role: 'user', content: cleanedText },
                ].slice(-MAX_HISTORY_ENTRIES),
                assistantMode: requestConfig.assistantMode,
                sessionId: assistantSession?.sessionId || activeSessionId || '',
                context: {
                    ...requestConfig.context,
                    clientSessionId: activeSessionId,
                    clientMessageId: streamMessageId,
                    cartItems,
                    cartSummary,
                    currentProductId: context.activeProductId || routeProductId,
                    currentProduct: productCandidates.find((product) => product.id === (context.activeProductId || routeProductId)) || null,
                    assistantSession,
                },
            }, (eventName, data) => {
                if (requestId !== requestSequenceRef.current) {
                    return;
                }

                if (eventName === 'message_meta') {
                    setAssistantStreamMeta(
                        safeString(data?.messageId || streamMessageId),
                        data || {},
                        safeString(data?.sessionId || activeSessionId),
                    );
                    return;
                }

                if (eventName === 'token') {
                    appendAssistantStreamToken(
                        safeString(data?.messageId || streamMessageId),
                        String(data?.text ?? data?.delta ?? data?.raw ?? ''),
                        safeString(data?.sessionId || activeSessionId),
                    );
                    return;
                }

                if (['tool_start', 'tool_end', 'citation', 'verification'].includes(eventName)) {
                    mergeAssistantStreamEvent(
                        safeString(data?.messageId || streamMessageId),
                        eventName,
                        data || {},
                        safeString(data?.sessionId || activeSessionId),
                    );
                }
            });

            const assistantTurn = response?.assistantTurn;
            if (!assistantTurn || typeof assistantTurn !== 'object') {
                throw new Error('Assistant response is missing a structured turn');
            }
            if (requestId !== requestSequenceRef.current) {
                discardAssistantStream(streamMessageId, activeSessionId);
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
                        discardAssistantStream(streamMessageId, activeSessionId);
                        return;
                    }
                    if (execution?.suppressedDuplicate) {
                        discardAssistantStream(streamMessageId, activeSessionId);
                        return;
                    }
                    const responseTurn = {
                        ...assistantTurn,
                        response: safeString(execution.message || assistantTurn.response),
                    };
                    presentAssistantTurn(responseTurn, response, execution, {
                        replaceMessageId: streamMessageId,
                        sessionId: activeSessionId,
                    });

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
                    failAssistantStream(
                        streamMessageId,
                        error?.message || 'I could not complete that action right now.',
                        {},
                        activeSessionId,
                    );
                }
            } else {
                presentAssistantTurn(assistantTurn, response, null, {
                    replaceMessageId: streamMessageId,
                    sessionId: activeSessionId,
                });
            }
        } catch {
            if (requestId !== requestSequenceRef.current) {
                discardAssistantStream(streamMessageId, activeSessionId);
                return;
            }
            failAssistantStream(
                streamMessageId,
                'I hit a live service issue before I could finish that. Please try again in a moment.',
                {},
                activeSessionId,
            );
        } finally {
            if (requestId === requestSequenceRef.current) {
                setStatus('idle');
                setPendingAction(null);
            }
        }
    }, [
        activeSessionId,
        assistantContextPath,
        assistantSession,
        appendAssistantStreamToken,
        appendUserMessage,
        beginAssistantStream,
        cartItems,
        cartSummary,
        close,
        confirmPendingAction,
        context.activeProductId,
        context.candidateProductIds,
        conversationHistory,
        discardAssistantStream,
        executePlannedActions,
        failAssistantStream,
        mergeAssistantStreamEvent,
        pendingConfirmation,
        presentAssistantTurn,
        productCandidates,
        routeProductId,
        setAssistantStreamMeta,
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
                if (result?.suppressedDuplicate) {
                    return;
                }
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
            setStatus('thinking');
            void chatApi.sendMessage({
                message: '',
                conversationHistory,
                assistantMode: 'chat',
                sessionId: assistantSession?.sessionId || activeSessionId || '',
                actionRequest: {
                    type: 'checkout',
                },
                context: {
                    cartItems,
                    cartSummary,
                    clientSessionId: activeSessionId,
                    currentProductId: context.activeProductId || routeProductId,
                    currentProduct: productCandidates.find((product) => product.id === (context.activeProductId || routeProductId)) || null,
                    assistantSession,
                },
            }).then((response) => {
                const assistantTurn = response?.assistantTurn;
                if (!assistantTurn || typeof assistantTurn !== 'object') {
                    throw new Error('Assistant response is missing a structured turn');
                }
                presentAssistantTurn(assistantTurn, response, null);
            }).catch(() => {
                presentAssistantTurn({
                    intent: 'navigation',
                    confidence: 1,
                    decision: 'respond',
                    response: 'Checkout confirmation is unavailable right now. Please try again.',
                    actions: [],
                    ui: {
                        surface: 'plain_answer',
                    },
                    followUps: ['View cart'],
                }, {}, null);
            }).finally(() => {
                setStatus('idle');
            });
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
            }).then((result) => {
                if (!result?.suppressedDuplicate) {
                    close();
                }
            });
        }
    }, [
        activeSessionId,
        close,
        assistantSession,
        cartItems,
        cartSummary,
        conversationHistory,
        confirmPendingAction,
        context.lastOrderId,
        context.activeProductId,
        handleUserInput,
        lastAssistantTurn,
        pendingConfirmation?.token,
        presentAssistantTurn,
        productCandidates,
        registry,
        routeProductId,
        setStatus,
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
            if (result?.suppressedDuplicate) {
                return result;
            }
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
        }).then((result) => {
            if (!result?.suppressedDuplicate) {
                close();
            }
            return result;
        })
    ), [close, context.lastOrderId, lastAssistantTurn?.ui?.support?.orderId, registry]);

    return {
        inputRef,
        addProductToCart,
        cancelPendingAction,
        confirmPendingAction,
        handleAction,
        handleUserInput,
        modifyPendingAction,
        openSupport,
        selectProduct,
    };
};

export default useAssistantController;
