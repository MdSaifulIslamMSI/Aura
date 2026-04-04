import { useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
import { useMarket } from '@/context/MarketContext';
import { productApi } from '@/services/api';
import { createAssistantActionAdapter } from '@/services/assistantActionAdapter';
import { assistantApi } from '@/services/assistantApi';
import {
    readAssistantWorkspaceState,
    writeAssistantWorkspaceState,
} from '@/services/assistantSessionStorage';
import { pushClientDiagnostic } from '@/services/clientObservability';
import { selectCartSummary, useCommerceStore } from '@/store/commerceStore';
import {
    createAssistantMessage,
    createWelcomeMessage,
    deriveOriginContext,
    extractCandidateProductIds,
    safeString,
} from './workspaceModels';

export const useAssistantWorkspace = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { currentUser } = useContext(AuthContext);
    const { formatPrice } = useMarket();

    const persistedState = useMemo(() => readAssistantWorkspaceState(), []);
    const originContext = useMemo(
        () => deriveOriginContext(searchParams.get('from') || '/'),
        [searchParams]
    );
    const [sessionId, setSessionId] = useState(persistedState.sessionId);
    const [inputValue, setInputValue] = useState(persistedState.draft);
    const [messages, setMessages] = useState(() => [createWelcomeMessage(originContext)]);
    const [isLoading, setIsLoading] = useState(false);
    const [originProduct, setOriginProduct] = useState(null);

    const cartState = useCommerceStore((state) => state.cart);
    const cartSummary = useMemo(() => selectCartSummary({ cart: cartState }), [cartState]);
    const candidateProductIds = useMemo(
        () => extractCandidateProductIds(
            messages,
            originContext.entityType === 'product' ? originContext.entityId : ''
        ),
        [messages, originContext.entityId, originContext.entityType]
    );

    const lastAssistantWithActions = useMemo(
        () => (
            [...messages].reverse().find((message) => (
                message.role === 'assistant'
                && Array.isArray(message.actions)
                && message.actions.length > 0
            )) || null
        ),
        [messages]
    );

    const actionAdapter = useMemo(() => createAssistantActionAdapter({
        navigate,
        isAuthenticated: Boolean(currentUser),
    }), [currentUser, navigate]);

    useEffect(() => {
        writeAssistantWorkspaceState({
            sessionId,
            draft: inputValue,
        });
    }, [inputValue, sessionId]);

    useEffect(() => {
        if (originContext.entityType !== 'product' || !originContext.entityId) {
            setOriginProduct(null);
            return;
        }

        let active = true;

        productApi.getProductById(originContext.entityId)
            .then((product) => {
                if (active) {
                    setOriginProduct(product);
                }
            })
            .catch(() => {
                if (active) {
                    setOriginProduct(null);
                }
            });

        return () => {
            active = false;
        };
    }, [originContext.entityId, originContext.entityType]);

    const appendMessage = (payload) => {
        setMessages((current) => [...current, createAssistantMessage(payload)]);
    };

    const handleSubmit = async (event) => {
        event?.preventDefault?.();
        const message = safeString(inputValue);
        if (!message || isLoading) {
            return;
        }

        setMessages((current) => [...current, createAssistantMessage({
            role: 'user',
            text: message,
            cards: [],
            actions: [],
            supportDraft: null,
            telemetry: null,
        })]);
        setInputValue('');
        setIsLoading(true);

        pushClientDiagnostic('assistant_v2.turn_requested', {
            context: {
                originPath: originContext.path,
                sessionId,
            },
        });

        try {
            const response = await assistantApi.createTurn({
                sessionId,
                message,
                routeContext: originContext,
                commerceContext: {
                    activeProductId: originContext.entityType === 'product'
                        ? originContext.entityId
                        : '',
                    candidateProductIds,
                    cartSummary,
                },
                userContext: {
                    authenticated: Boolean(currentUser),
                },
            });

            setSessionId(response.session.id);
            appendMessage({
                text: response.reply.text,
                cards: response.cards,
                actions: response.actions,
                supportDraft: response.supportDraft,
                telemetry: response.telemetry,
                decision: response.decision,
                provisional: response.provisional,
                traceId: response.traceId,
                decisionId: response.decisionId,
                upgradeEligible: response.upgradeEligible,
            });
            pushClientDiagnostic('assistant_v2.turn_completed', {
                context: {
                    sessionId: response.session.id,
                    intent: response.reply.intent,
                    retrievalHits: response.telemetry.retrievalHits,
                    latencyMs: response.telemetry.latencyMs,
                    route: response?.decision?.route || '',
                    traceId: response.traceId,
                    decisionId: response.decisionId,
                },
            });
        } catch (error) {
            appendMessage({
                text: error?.message || 'The assistant workspace is unavailable right now.',
                cards: [],
                actions: [],
            });
            pushClientDiagnostic('assistant_v2.turn_failed', {
                error: {
                    message: error?.message || 'assistant turn failed',
                },
            }, 'warn');
        } finally {
            setIsLoading(false);
        }
    };

    const handleAction = async (action, supportDraft = null) => {
        pushClientDiagnostic('assistant_v2.action_selected', {
            context: {
                actionType: safeString(action?.type || ''),
                originPath: originContext.path,
            },
        });

        const result = await actionAdapter.run(action, { supportDraft });
        if (result?.message) {
            appendMessage({
                text: result.message,
                cards: result?.cartSummary ? [{
                    type: 'cart_summary',
                    title: 'Updated cart snapshot',
                    description: 'The cart changed through the normal commerce flow.',
                    cartSummary: result.cartSummary,
                }] : [],
                actions: [],
            });
        }
    };

    return {
        cartSummary,
        formatPrice,
        handleAction,
        handleSubmit,
        inputValue,
        isLoading,
        lastAssistantWithActions,
        messages,
        originContext,
        originProduct,
        sessionId,
        setInputValue,
    };
};
