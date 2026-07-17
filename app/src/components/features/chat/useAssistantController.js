import {
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useIntl } from 'react-intl';
import { AuthContext } from '@/context/AuthContext';
import { useSocket } from '@/context/SocketContext';
import { WishlistContext } from '@/context/WishlistContext';
import { chatApi } from '@/services/chatApi';
import { resolveAssistantOriginLocation } from '@/services/assistantUiConfig';
import { useChatStore } from '@/store/chatStore';
import { selectCartItems, selectCartSummary, useCommerceStore } from '@/store/commerceStore';
import {
    buildAssistantRequestPayload,
    buildModeActions,
    buildNonExecutableAssistantTurn,
    buildSuggestionActions,
    buildUnavailableAssistantResponse,
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
const buildMediaSummary = ({ images = [], audio = [] } = {}) => {
    const imageCount = Array.isArray(images) ? images.length : 0;
    const audioCount = Array.isArray(audio) ? audio.length : 0;
    const parts = [];
    if (imageCount > 0) {
        parts.push(`${imageCount} image${imageCount === 1 ? '' : 's'}`);
    }
    if (audioCount > 0) {
        parts.push(`${audioCount} audio clip${audioCount === 1 ? '' : 's'}`);
    }
    return parts.length > 0 ? `Attached ${parts.join(' and ')}` : '';
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
    const intl = useIntl();
    const { isAuthenticated } = useContext(AuthContext);
    const { wishlistItems = [] } = useContext(WishlistContext);
    const { socket } = useSocket() || {};

    const inputRef = useRef(null);

    const messages = useChatStore((state) => state.messages);
    const visibleProducts = useChatStore((state) => state.visibleProducts);
    const activeSessionId = useChatStore((state) => state.activeSessionId);
    const requestStateBySessionRef = useRef(new Map());
    const activeSessionIdRef = useRef(activeSessionId);
    const sessionFocusEpochRef = useRef(0);
    const context = useChatStore((state) => state.context);
    const assistantSession = useChatStore((state) => state.context.assistantSession);
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
    const clearTurnActions = useChatStore((state) => state.clearTurnActions);
    const clearPendingConfirmation = useChatStore((state) => state.clearPendingConfirmation);
    const close = useChatStore((state) => state.close);
    const setSurface = useChatStore((state) => state.setSurface);

    const cartState = useCommerceStore((state) => state.cart);
    const cartItems = useMemo(() => selectCartItems({ cart: cartState }), [cartState]);
    const cartSummary = useMemo(() => selectCartSummary({ cart: cartState }), [cartState]);

    const assistantContextPath = useMemo(
        () => resolveAssistantOriginLocation({
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
        }).path,
        [location.hash, location.pathname, location.search],
    );
    const routeProductId = useMemo(() => extractProductIdFromPath(assistantContextPath), [assistantContextPath]);
    const conversationHistory = useMemo(() => trimConversationHistory(messages), [messages]);

    useEffect(() => {
        activeSessionIdRef.current = useChatStore.getState().activeSessionId;
        return useChatStore.subscribe((state, previousState) => {
            if (state.activeSessionId !== previousState.activeSessionId) {
                activeSessionIdRef.current = state.activeSessionId;
                sessionFocusEpochRef.current += 1;
            }
        });
    }, []);

    useEffect(() => () => {
        requestStateBySessionRef.current.forEach((requestState) => {
            requestState?.abortController?.abort();
        });
        requestStateBySessionRef.current.clear();
    }, []);

    const isCurrentSessionRequest = useCallback((sessionId = '', generation = 0) => (
        requestStateBySessionRef.current.get(sessionId)?.generation === generation
    ), []);

    const beginSessionRequest = useCallback((sessionId = '') => {
        const previousRequest = requestStateBySessionRef.current.get(sessionId) || {
            generation: 0,
            streamMessageId: '',
            abortController: null,
        };
        previousRequest.abortController?.abort();
        if (previousRequest.streamMessageId) {
            discardAssistantStream(previousRequest.streamMessageId, sessionId);
        }

        const generation = previousRequest.generation + 1;
        const abortController = typeof AbortController === 'function' ? new AbortController() : null;
        requestStateBySessionRef.current.set(sessionId, {
            generation,
            streamMessageId: '',
            abortController,
        });
        return {
            generation,
            signal: abortController?.signal,
        };
    }, [discardAssistantStream]);

    const registerSessionStream = useCallback((sessionId = '', generation = 0, streamMessageId = '') => {
        if (!isCurrentSessionRequest(sessionId, generation)) {
            return false;
        }
        requestStateBySessionRef.current.set(sessionId, {
            generation,
            streamMessageId,
            abortController: requestStateBySessionRef.current.get(sessionId)?.abortController || null,
        });
        return true;
    }, [isCurrentSessionRequest]);

    const invalidateSessionRequest = useCallback((sessionId = '') => {
        const targetSessionId = safeString(sessionId || useChatStore.getState().activeSessionId || '');
        if (!targetSessionId) return;

        const previousRequest = requestStateBySessionRef.current.get(targetSessionId) || {
            generation: 0,
            streamMessageId: '',
            abortController: null,
        };
        previousRequest.abortController?.abort();
        if (previousRequest.streamMessageId) {
            discardAssistantStream(previousRequest.streamMessageId, targetSessionId);
        }
        requestStateBySessionRef.current.set(targetSessionId, {
            generation: previousRequest.generation + 1,
            streamMessageId: '',
            abortController: null,
        });
        setStatus('idle', targetSessionId);
        clearTurnActions(targetSessionId);
    }, [clearTurnActions, discardAssistantStream, setStatus]);

    const ownsActionFocus = useCallback((sessionId = '', focusEpoch = 0) => (
        activeSessionIdRef.current === sessionId && sessionFocusEpochRef.current === focusEpoch
    ), []);

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
        formatMessage: (descriptor, values) => intl.formatMessage(descriptor, values),
    }), [intl, isAuthenticated, navigate, productCandidates]);

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
        context.cartCount,
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

    const executePlannedActions = useCallback(async (assistantTurn, {
        sessionId = '',
        canExecute = () => true,
    } = {}) => {
        const uiProducts = normalizeUiProducts(assistantTurn, {});
        const results = [];
        const plannedActions = assistantTurn?.actionRequest
            ? [assistantTurn.actionRequest]
            : (assistantTurn?.actions || []);

        for (const action of plannedActions) {
            if (!canExecute()) {
                return {
                    ...mergeExecutionResults(results),
                    success: false,
                    ownershipLost: true,
                };
            }
            setPendingAction(action, sessionId);
            const result = await registry.executeAssistantAction(action, {
                uiProducts,
                canExecute,
            });
            results.push(result);
            if (result?.ownershipLost) {
                return {
                    ...mergeExecutionResults(results),
                    success: false,
                    ownershipLost: true,
                };
            }
        }

        setPendingAction(null, sessionId);
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
            providerCapabilities: response?.providerCapabilities || null,
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

        const initiatingSessionId = activeSessionIdRef.current;
        const focusEpoch = sessionFocusEpochRef.current;
        const {
            generation: requestGeneration,
            signal: requestSignal,
        } = beginSessionRequest(initiatingSessionId);
        const isCurrentRequest = () => isCurrentSessionRequest(initiatingSessionId, requestGeneration);
        const canExecute = () => isCurrentRequest() && ownsActionFocus(initiatingSessionId, focusEpoch);
        setStatus('executing', initiatingSessionId);
        clearPendingConfirmation(initiatingSessionId);

        try {
            const response = await chatApi.sendMessage({
                message: '',
                conversationHistory: conversationHistory.slice(-MAX_HISTORY_ENTRIES),
                assistantMode: 'chat',
                sessionId: assistantSession?.sessionId || initiatingSessionId || '',
                confirmation: {
                    actionId: pendingConfirmation.token,
                    approved: true,
                    contextVersion: pendingConfirmation.action?.contextVersion || assistantSession?.contextVersion || 0,
                },
                context: {
                    clientSessionId: initiatingSessionId,
                    route: assistantContextPath,
                    routeLabel: context.routeLabel,
                    cartItems,
                    cartSummary,
                    currentProductId: context.activeProductId || routeProductId,
                    currentProduct: productCandidates.find((product) => product.id === (context.activeProductId || routeProductId)) || null,
                    assistantSession,
                },
                signal: requestSignal,
            });
            if (!isCurrentRequest()) return;
            const assistantTurn = response?.assistantTurn;
            if (!assistantTurn || typeof assistantTurn !== 'object') {
                throw new Error('Assistant confirmation response is missing a structured turn');
            }

            const plannedActions = assistantTurn?.actionRequest
                ? [assistantTurn.actionRequest]
                : (Array.isArray(assistantTurn.actions) ? assistantTurn.actions : []);

            if (!canExecute()) {
                presentAssistantTurn(buildNonExecutableAssistantTurn(
                    assistantTurn,
                    'I did not run that action because you changed assistant threads. Return to this thread and ask again if you still want it.',
                ), response, null, {
                    sessionId: initiatingSessionId,
                });
                return;
            }

            if (assistantTurn.decision === 'act' && plannedActions.length > 0) {
                const execution = await executePlannedActions(assistantTurn, {
                    sessionId: initiatingSessionId,
                    canExecute,
                });
                if (execution?.ownershipLost) {
                    presentAssistantTurn(buildNonExecutableAssistantTurn(
                        assistantTurn,
                        'I did not run that action because you changed assistant threads. Return to this thread and ask again if you still want it.',
                    ), response, null, {
                        sessionId: initiatingSessionId,
                    });
                    return;
                }
                if (!execution?.suppressedDuplicate) {
                    const responseTurn = {
                        ...assistantTurn,
                        response: safeString(execution.message || assistantTurn.response),
                    };
                    presentAssistantTurn(responseTurn, response, execution, {
                        sessionId: initiatingSessionId,
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
                }
            } else {
                presentAssistantTurn(assistantTurn, response, null, {
                    sessionId: initiatingSessionId,
                });
            }
        } catch (error) {
            if (!isCurrentRequest()) return;
            appendAssistantTurn({
                sessionId: initiatingSessionId,
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
            if (isCurrentRequest()) {
                requestStateBySessionRef.current.set(initiatingSessionId, {
                    generation: requestGeneration,
                    streamMessageId: '',
                    abortController: null,
                });
                setStatus('idle', initiatingSessionId);
                setPendingAction(null, initiatingSessionId);
            }
        }
    }, [
        assistantSession,
        assistantContextPath,
        appendAssistantTurn,
        beginSessionRequest,
        cartItems,
        cartSummary,
        clearPendingConfirmation,
        close,
        context.activeProductId,
        context.routeLabel,
        conversationHistory,
        executePlannedActions,
        isCurrentSessionRequest,
        ownsActionFocus,
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

        const initiatingSessionId = activeSessionIdRef.current;
        const {
            generation: requestGeneration,
            signal: requestSignal,
        } = beginSessionRequest(initiatingSessionId);
        const isCurrentRequest = () => isCurrentSessionRequest(initiatingSessionId, requestGeneration);
        clearPendingConfirmation(initiatingSessionId);
        try {
            const response = await chatApi.sendMessage({
                message: '',
                conversationHistory: conversationHistory.slice(-MAX_HISTORY_ENTRIES),
                assistantMode: 'chat',
                sessionId: assistantSession?.sessionId || initiatingSessionId || '',
                confirmation: {
                    actionId: pendingConfirmation.token,
                    approved: false,
                    contextVersion: pendingConfirmation.action?.contextVersion || assistantSession?.contextVersion || 0,
                },
                context: {
                    clientSessionId: initiatingSessionId,
                    route: assistantContextPath,
                    routeLabel: context.routeLabel,
                    cartItems,
                    cartSummary,
                    currentProductId: context.activeProductId || routeProductId,
                    currentProduct: productCandidates.find((product) => product.id === (context.activeProductId || routeProductId)) || null,
                    assistantSession,
                },
                signal: requestSignal,
            });
            if (!isCurrentRequest()) return;
            const assistantTurn = response?.assistantTurn;
            if (!assistantTurn || typeof assistantTurn !== 'object') {
                throw new Error('Assistant cancellation response is missing a structured turn');
            }

            presentAssistantTurn(assistantTurn, response, null, {
                sessionId: initiatingSessionId,
            });
        } catch {
            if (!isCurrentRequest()) return;
            appendAssistantTurn({
                sessionId: initiatingSessionId,
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
        } finally {
            if (isCurrentRequest()) {
                requestStateBySessionRef.current.set(initiatingSessionId, {
                    generation: requestGeneration,
                    streamMessageId: '',
                    abortController: null,
                });
            }
        }
    }, [
        assistantSession,
        assistantContextPath,
        appendAssistantTurn,
        beginSessionRequest,
        cartItems,
        cartSummary,
        clearPendingConfirmation,
        context.activeProductId,
        context.routeLabel,
        conversationHistory,
        isCurrentSessionRequest,
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

    const handleUserInput = useCallback(async (rawText, { confirmationToken, images = [], audio = [] } = {}) => {
        const cleanedText = safeString(rawText);
        const safeImages = Array.isArray(images) ? images : [];
        const safeAudio = Array.isArray(audio) ? audio : [];
        const userVisibleText = cleanedText || buildMediaSummary({ images: safeImages, audio: safeAudio });
        if (!cleanedText && !confirmationToken && safeImages.length === 0 && safeAudio.length === 0) return;

        const initiatingSessionId = activeSessionIdRef.current || activeSessionId;
        if (confirmationToken || (pendingConfirmation && isConfirmationMessage(cleanedText))) {
            if (cleanedText) {
                appendUserMessage(cleanedText, { sessionId: initiatingSessionId });
            }
            void confirmPendingAction(confirmationToken || pendingConfirmation?.token || '');
            setInputValue('');
            return;
        }

        clearTurnActions(initiatingSessionId);
        appendUserMessage(userVisibleText, {
            sessionId: initiatingSessionId,
            images: safeImages,
            audio: safeAudio,
        });
        setInputValue('');
        setStatus('thinking', initiatingSessionId);
        const {
            generation: requestGeneration,
            signal: requestSignal,
        } = beginSessionRequest(initiatingSessionId);
        const focusEpoch = sessionFocusEpochRef.current;
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
            sessionId: initiatingSessionId,
        });
        registerSessionStream(initiatingSessionId, requestGeneration, streamMessageId);
        const isCurrentRequest = () => isCurrentSessionRequest(initiatingSessionId, requestGeneration);
        const canExecute = () => isCurrentRequest() && ownsActionFocus(initiatingSessionId, focusEpoch);
        const presentOwnershipNotice = (assistantTurn, response) => presentAssistantTurn(buildNonExecutableAssistantTurn(
            assistantTurn,
            'I did not run that action because you changed assistant threads. Return to this thread and ask again if you still want it.',
        ), response, null, {
            replaceMessageId: streamMessageId,
            sessionId: initiatingSessionId,
        });

        try {
            const response = await chatApi.streamMessage({
                message: cleanedText,
                conversationHistory: [
                    ...conversationHistory,
                    { role: 'user', content: cleanedText },
                ].slice(-MAX_HISTORY_ENTRIES),
                assistantMode: requestConfig.assistantMode,
                sessionId: assistantSession?.sessionId || initiatingSessionId || '',
                context: {
                    ...requestConfig.context,
                    clientSessionId: initiatingSessionId,
                    clientMessageId: streamMessageId,
                    cartItems,
                    cartSummary,
                    currentProductId: context.activeProductId || routeProductId,
                    currentProduct: productCandidates.find((product) => product.id === (context.activeProductId || routeProductId)) || null,
                    assistantSession,
                },
                images: safeImages,
                audio: safeAudio,
                signal: requestSignal,
            }, (eventName, data) => {
                if (!isCurrentRequest()) return;

                if (eventName === 'message_meta') {
                    setAssistantStreamMeta(streamMessageId, data || {}, initiatingSessionId);
                    return;
                }

                if (eventName === 'token') {
                    appendAssistantStreamToken(
                        streamMessageId,
                        String(data?.text ?? data?.delta ?? data?.raw ?? ''),
                        initiatingSessionId,
                    );
                    return;
                }

                if (['tool_start', 'tool_end', 'citation', 'verification'].includes(eventName)) {
                    mergeAssistantStreamEvent(streamMessageId, eventName, data || {}, initiatingSessionId);
                }
            });

            const assistantTurn = response?.assistantTurn;
            if (!assistantTurn || typeof assistantTurn !== 'object') {
                throw new Error('Assistant response is missing a structured turn');
            }
            if (!isCurrentRequest()) return;

            const plannedActions = assistantTurn?.actionRequest
                ? [assistantTurn.actionRequest]
                : (Array.isArray(assistantTurn.actions) ? assistantTurn.actions : []);

            if (assistantTurn.decision === 'act' && plannedActions.length > 0) {
                if (!canExecute()) {
                    presentOwnershipNotice(assistantTurn, response);
                    return;
                }

                setStatus('executing', initiatingSessionId);
                try {
                    const execution = await executePlannedActions(assistantTurn, {
                        sessionId: initiatingSessionId,
                        canExecute,
                    });
                    if (!isCurrentRequest()) return;
                    if (execution?.ownershipLost) {
                        presentOwnershipNotice(assistantTurn, response);
                        return;
                    }
                    if (execution?.suppressedDuplicate) {
                        discardAssistantStream(streamMessageId, initiatingSessionId);
                        return;
                    }
                    const responseTurn = {
                        ...assistantTurn,
                        response: safeString(execution.message || assistantTurn.response),
                    };
                    presentAssistantTurn(responseTurn, response, execution, {
                        replaceMessageId: streamMessageId,
                        sessionId: initiatingSessionId,
                    });

                    const leadingActionType = plannedActions[0]?.type;
                    const leadingPage = plannedActions[0]?.page;
                    if (canExecute() && (
                        leadingActionType === 'go_to_checkout'
                        || leadingActionType === 'open_support'
                        || (leadingActionType === 'navigate_to' && ['checkout', 'support', 'orders'].includes(safeString(leadingPage || '')))
                    )) {
                        close();
                    }
                } catch (error) {
                    if (isCurrentRequest()) {
                        failAssistantStream(
                            streamMessageId,
                            error?.message || 'I could not complete that action right now.',
                            {},
                            initiatingSessionId,
                        );
                    }
                }
            } else {
                presentAssistantTurn(assistantTurn, response, null, {
                    replaceMessageId: streamMessageId,
                    sessionId: initiatingSessionId,
                });
            }
        } catch {
            if (!isCurrentRequest()) return;

            clearTurnActions(initiatingSessionId);
            const fallback = buildUnavailableAssistantResponse(cleanedText, {
                hasMedia: safeImages.length > 0 || safeAudio.length > 0,
                cartCount: cartSummary.totalItems,
                cartSummary,
                cartItems,
                lastQuery: context.lastQuery,
                activeProductId: context.activeProductId || routeProductId,
                candidateProductIds: context.candidateProductIds,
                isAuthenticated,
                pathname: assistantContextPath,
            });
            const fallbackTurn = {
                intent: 'local_fallback',
                decision: 'respond',
                response: fallback.answer,
                actions: [],
                ui: {
                    surface: fallback.mode === 'cart'
                        ? 'cart_summary'
                        : fallback.mode === 'product'
                            ? 'product_focus'
                            : fallback.mode === 'checkout'
                                ? 'cart_summary'
                                : fallback.mode === 'support'
                                    ? 'support_handoff'
                                    : 'plain_answer',
                },
                followUps: [],
            };

            finalizeAssistantStream(streamMessageId, {
                text: fallback.answer,
                mode: fallback.mode,
                cartSummary: fallback.cartSummary || null,
                supportPrefill: fallback.supportPrefill || null,
                primaryAction: fallback.primaryAction || null,
                secondaryActions: fallback.secondaryActions || [],
                activeProductId: fallback.activeProductId,
                providerInfo: {
                    name: 'local',
                    model: 'deterministic',
                },
                providerCapabilities: {
                    textInput: true,
                    imageInput: false,
                    audioInput: false,
                },
                decision: 'respond',
                assistantTurn: fallbackTurn,
            }, initiatingSessionId);
        } finally {
            if (isCurrentRequest()) {
                requestStateBySessionRef.current.set(initiatingSessionId, {
                    generation: requestGeneration,
                    streamMessageId: '',
                    abortController: null,
                });
                setStatus('idle', initiatingSessionId);
                setPendingAction(null, initiatingSessionId);
            }
        }
    }, [
        activeSessionId,
        assistantContextPath,
        assistantSession,
        appendAssistantStreamToken,
        appendUserMessage,
        beginAssistantStream,
        beginSessionRequest,
        cartItems,
        cartSummary,
        clearTurnActions,
        close,
        confirmPendingAction,
        context.activeProductId,
        context.candidateProductIds,
        context.lastQuery,
        conversationHistory,
        discardAssistantStream,
        executePlannedActions,
        failAssistantStream,
        finalizeAssistantStream,
        isCurrentSessionRequest,
        isAuthenticated,
        mergeAssistantStreamEvent,
        ownsActionFocus,
        pendingConfirmation,
        presentAssistantTurn,
        productCandidates,
        registerSessionStream,
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
            const initiatingSessionId = activeSessionIdRef.current;
            const focusEpoch = sessionFocusEpochRef.current;
            const {
                generation: requestGeneration,
                signal: requestSignal,
            } = beginSessionRequest(initiatingSessionId);
            const isCurrentRequest = () => isCurrentSessionRequest(initiatingSessionId, requestGeneration);
            setStatus('thinking', initiatingSessionId);
            void chatApi.sendMessage({
                message: '',
                conversationHistory,
                assistantMode: 'chat',
                sessionId: assistantSession?.sessionId || initiatingSessionId || '',
                actionRequest: {
                    type: 'checkout',
                },
                context: {
                    cartItems,
                    cartSummary,
                    clientSessionId: initiatingSessionId,
                    currentProductId: context.activeProductId || routeProductId,
                    currentProduct: productCandidates.find((product) => product.id === (context.activeProductId || routeProductId)) || null,
                    assistantSession,
                },
                signal: requestSignal,
            }).then((response) => {
                if (!isCurrentRequest()) return;
                const assistantTurn = response?.assistantTurn;
                if (!assistantTurn || typeof assistantTurn !== 'object') {
                    throw new Error('Assistant response is missing a structured turn');
                }
                const safeTurn = ownsActionFocus(initiatingSessionId, focusEpoch)
                    ? assistantTurn
                    : buildNonExecutableAssistantTurn(
                        assistantTurn,
                        'Checkout preparation did not continue because you changed assistant threads. Return to this thread and ask again.',
                    );
                presentAssistantTurn(safeTurn, response, null, {
                    sessionId: initiatingSessionId,
                });
            }).catch(() => {
                if (!isCurrentRequest()) return;
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
                }, {}, null, {
                    sessionId: initiatingSessionId,
                });
            }).finally(() => {
                if (isCurrentRequest()) {
                    requestStateBySessionRef.current.set(initiatingSessionId, {
                        generation: requestGeneration,
                        streamMessageId: '',
                        abortController: null,
                    });
                    setStatus('idle', initiatingSessionId);
                }
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
        close,
        assistantSession,
        beginSessionRequest,
        cartItems,
        cartSummary,
        conversationHistory,
        confirmPendingAction,
        context.lastOrderId,
        context.activeProductId,
        handleUserInput,
        isCurrentSessionRequest,
        lastAssistantTurn,
        ownsActionFocus,
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
        invalidateSessionRequest,
        modifyPendingAction,
        openSupport,
        selectProduct,
    };
};

export default useAssistantController;
