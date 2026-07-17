import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    AudioLines,
    ArrowUp,
    CheckCircle2,
    Menu,
    RotateCcw,
    Mic,
    MicOff,
    Orbit,
    Paperclip,
    Pin,
    Plus,
    Search,
    Sparkles,
    Trash2,
    WandSparkles,
    X,
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { FormattedMessage, defineMessages, useIntl } from 'react-intl';
import ActionBar from '@/components/features/chat/ActionBar';
import MessageList from '@/components/features/chat/MessageList';
import MultimodalDock from '@/components/features/chat/MultimodalDock';
import { useAssistantController } from '@/components/features/chat/useAssistantController';
import { AuthContext } from '@/context/AuthContext';
import { useSpeechInput } from '@/hooks/useSpeechInput';
import { cn } from '@/lib/utils';
import { aiApi } from '@/services/aiApi';
import { resolveAssistantOriginLocation } from '@/services/assistantUiConfig';
import { useChatStore } from '@/store/chatStore';
import { selectCartSummary, useCommerceStore } from '@/store/commerceStore';
import { getAssistantRouteLabel } from '@/utils/assistantCommands';

import { StableText } from '@/i18n/StableText';
const MODE_COPY = {
    explore: { id: 'assistant.mode.exploration', defaultMessage: 'Exploration' },
    product: { id: 'assistant.mode.productFocus', defaultMessage: 'Product focus' },
    cart: { id: 'assistant.mode.cartReview', defaultMessage: 'Cart review' },
    checkout: { id: 'assistant.mode.checkout', defaultMessage: 'Checkout' },
    support: { id: 'assistant.mode.support', defaultMessage: 'Support' },
};

const MAX_MEDIA_ATTACHMENTS = 3;
const MAX_MEDIA_FILE_BYTES = 8 * 1024 * 1024;
const starterPromptMessages = defineMessages({
    compareTitle: {
        id: 'assistant.starter.compare.title',
        defaultMessage: 'Grounded comparison',
    },
    compareDetail: {
        id: 'assistant.starter.compare.detail',
        defaultMessage: 'Compare two real options and explain the trade-offs.',
    },
    cartTitle: {
        id: 'assistant.starter.cart.title',
        defaultMessage: 'Cart review',
    },
    cartDetail: {
        id: 'assistant.starter.cart.detail',
        defaultMessage: 'Audit the cart, surface risks, and recommend the next step.',
    },
    visualTitle: {
        id: 'assistant.starter.visual.title',
        defaultMessage: 'Photo match',
    },
    visualDetail: {
        id: 'assistant.starter.visual.detail',
        defaultMessage: 'Prepare a visual-search brief before you attach an image.',
    },
    ordersTitle: {
        id: 'assistant.starter.orders.title',
        defaultMessage: 'Order follow-up',
    },
    ordersDetail: {
        id: 'assistant.starter.orders.detail',
        defaultMessage: 'Track an order or escalate into support without losing context.',
    },
});
const composerMessages = defineMessages({
    listeningPlaceholder: {
        id: 'common.jsx.expression.listening.6dab600d',
        defaultMessage: 'Listening...',
        description: 'Stable UI message migrated from legacy market-pack lookup. Review context in the localization migration inventory.',
    },
    promptPlaceholder: {
        id: 'cart.jsx.expression.compare.products.review.a.cart.or.find.40cd3600',
        defaultMessage: 'Compare products, review a cart, or find a match...',
        description: 'Stable UI message migrated from legacy market-pack lookup. Review context in the localization migration inventory.',
    },
});
const STARTER_PROMPTS = [
    {
        id: 'compare',
        titleMessage: starterPromptMessages.compareTitle,
        detailMessage: starterPromptMessages.compareDetail,
        prompt: 'Compare the best phones under 50000 and tell me the strongest value pick.',
        intent: 'send',
    },
    {
        id: 'cart',
        titleMessage: starterPromptMessages.cartTitle,
        detailMessage: starterPromptMessages.cartDetail,
        prompt: 'Review my cart and tell me the smartest next step before checkout.',
        intent: 'send',
    },
    {
        id: 'visual',
        titleMessage: starterPromptMessages.visualTitle,
        detailMessage: starterPromptMessages.visualDetail,
        prompt: 'When I attach a product image, find the closest grounded match and explain confidence.',
        intent: 'prefill',
    },
    {
        id: 'orders',
        titleMessage: starterPromptMessages.ordersTitle,
        detailMessage: starterPromptMessages.ordersDetail,
        prompt: 'Help me track my latest order and tell me if I should open support.',
        intent: 'send',
    },
];

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read ${file?.name || 'attachment'}`));
    reader.readAsDataURL(file);
});

const toComposerAttachment = async (file) => {
    const mimeType = String(file?.type || '').trim().toLowerCase();
    const isImage = mimeType.startsWith('image/');
    const isAudio = mimeType.startsWith('audio/');
    if (!isImage && !isAudio) {
        throw new Error('Only image and audio files are supported.');
    }
    if (Number(file?.size || 0) > MAX_MEDIA_FILE_BYTES) {
        throw new Error(`${file?.name || 'Attachment'} is larger than 8 MB.`);
    }

    return {
        id: `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: isImage ? 'image' : 'audio',
        fileName: String(file?.name || '').trim(),
        mimeType,
        dataUrl: await readFileAsDataUrl(file),
    };
};

const formatSessionTime = (timestamp = 0) => {
    if (!timestamp) return '';

    return new Intl.DateTimeFormat('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
    }).format(new Date(timestamp));
};

const getCapabilityTone = (availability = null) => {
    if (availability === true) {
        return 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100';
    }
    if (availability === false) {
        return 'border-amber-300/20 bg-amber-500/10 text-amber-100';
    }
    return 'border-white/10 bg-white/[0.04] text-slate-300';
};

const AssistantPage = () => {
    const intl = useIntl();
    const location = useLocation();
    const {
        currentUser,
        dbUser,
        isAuthenticated,
        loading: isAuthLoading,
    } = useContext(AuthContext);
    const cartState = useCommerceStore((state) => state.cart);
    const cartSummary = useMemo(() => selectCartSummary({ cart: cartState }), [cartState]);

    const activeSession = useChatStore((state) => state.activeSession);
    const activeSessionId = useChatStore((state) => state.activeSessionId);
    const groupedSessions = useChatStore((state) => state.groupedSessions || []);
    const sessionSearchQuery = useChatStore((state) => state.sessionSearchQuery);
    const messages = useChatStore((state) => state.messages);
    const inputValue = useChatStore((state) => state.inputValue);
    const isLoading = useChatStore((state) => state.isLoading);
    const mode = useChatStore((state) => state.mode);
    const status = useChatStore((state) => state.status);
    const context = useChatStore((state) => state.context);
    const primaryAction = useChatStore((state) => state.primaryAction);
    const secondaryActions = useChatStore((state) => state.secondaryActions);
    const setInputValue = useChatStore((state) => state.setInputValue);
    const setActiveSession = useChatStore((state) => state.setActiveSession);
    const togglePinnedSession = useChatStore((state) => state.togglePinnedSession);
    const setSessionSearchQuery = useChatStore((state) => state.setSessionSearchQuery);
    const resetConversation = useChatStore((state) => state.resetConversation);
    const replaceSessionsFromServer = useChatStore((state) => state.replaceSessionsFromServer);
    const hydrateSessionFromServer = useChatStore((state) => state.hydrateSessionFromServer);
    const clearActiveSessionConversation = useChatStore((state) => state.clearActiveSessionConversation);
    const switchViewerScope = useChatStore((state) => state.switchViewerScope);
    const fileInputRef = useRef(null);
    const [attachments, setAttachments] = useState([]);
    const [attachmentError, setAttachmentError] = useState('');
    const [contextError, setContextError] = useState('');
    const [voiceSessionConfig, setVoiceSessionConfig] = useState(null);
    const [voiceSessionError, setVoiceSessionError] = useState('');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const {
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
    } = useAssistantController();

    const {
        isListening,
        supportsSpeechInput,
        stopListening,
        toggleListening,
    } = useSpeechInput({
        value: inputValue,
        onChange: setInputValue,
        clearOnStart: true,
        lang: 'en-IN',
    });

    const originPath = resolveAssistantOriginLocation(
        location,
        activeSession?.originPath || context.route || '/',
    ).path;
    const routeLabel = getAssistantRouteLabel(originPath);
    const viewerScope = useMemo(() => {
        if (isAuthLoading) {
            return '';
        }

        if (!isAuthenticated) {
            return 'guest';
        }

        const identity = String(
            dbUser?._id
            || currentUser?.uid
            || currentUser?.email
            || 'signed-in'
        ).trim();

        return `user:${identity}`;
    }, [currentUser?.email, currentUser?.uid, dbUser?._id, isAuthLoading, isAuthenticated]);
    const modeLabel = intl.formatMessage(MODE_COPY[mode] || MODE_COPY.explore);
    const lastUserMessage = useMemo(
        () => [...messages].reverse().find((message) => message?.role === 'user' && String(message?.text || '').trim())?.text || '',
        [messages],
    );
    const latestAssistantMessage = useMemo(
        () => [...messages].reverse().find((message) => message?.role === 'assistant') || null,
        [messages],
    );
    const latestTurnOwnsActions = useMemo(() => {
        const surface = String(latestAssistantMessage?.uiSurface || latestAssistantMessage?.assistantTurn?.ui?.surface || '');
        const productCount = Array.isArray(latestAssistantMessage?.products) ? latestAssistantMessage.products.length : 0;
        const ownsProductActions = ['product_results', 'product_focus'].includes(surface) && productCount === 1;
        const ownsSupportAction = Boolean(
            latestAssistantMessage?.supportPrefill
            || latestAssistantMessage?.assistantTurn?.ui?.support?.orderId
        );

        return ownsProductActions || ownsSupportAction || surface === 'confirmation_card';
    }, [latestAssistantMessage]);
    const hasUserMessages = useMemo(
        () => messages.some((message) => message?.role === 'user'),
        [messages],
    );
    const sessionCount = useMemo(
        () => groupedSessions.reduce((total, group) => total + (Array.isArray(group?.sessions) ? group.sessions.length : 0), 0),
        [groupedSessions],
    );
    const providerLabel = useMemo(() => {
        const providerName = String(latestAssistantMessage?.providerInfo?.name || latestAssistantMessage?.grounding?.provider || '').trim();
        const providerModel = String(latestAssistantMessage?.providerInfo?.model || latestAssistantMessage?.grounding?.providerModel || '').trim();
        if (providerName && providerModel) {
            return intl.formatMessage(
                { id: 'assistant.provider.modelLabel', defaultMessage: '{providerName} · {providerModel}' },
                { providerName, providerModel },
            );
        }
        return providerName || intl.formatMessage({ id: 'assistant.provider.localToolsReady', defaultMessage: 'Local store tools ready' });
    }, [intl, latestAssistantMessage]);
    const assistantCapabilities = useMemo(() => {
        const providerCapabilities = latestAssistantMessage?.providerCapabilities || null;
        const voiceCapabilities = voiceSessionConfig?.capabilities || {};

        return [
            {
                id: 'text',
                label: intl.formatMessage({ id: 'assistant.capability.textReasoning', defaultMessage: 'Text reasoning' }),
                ready: providerCapabilities ? providerCapabilities.textInput === true : null,
            },
            {
                id: 'image',
                label: intl.formatMessage({ id: 'assistant.capability.imageGrounding', defaultMessage: 'Image grounding' }),
                ready: providerCapabilities ? Boolean(providerCapabilities.imageInput) : null,
            },
            {
                id: 'audio',
                label: intl.formatMessage({ id: 'assistant.capability.audioReasoning', defaultMessage: 'Audio reasoning' }),
                ready: providerCapabilities ? Boolean(providerCapabilities.audioInput) : null,
            },
            {
                id: 'speech',
                label: intl.formatMessage({ id: 'assistant.capability.speechIntake', defaultMessage: 'Speech intake' }),
                ready: voiceSessionConfig
                    ? Boolean(voiceSessionConfig.supportsAudioUpload || voiceCapabilities?.speechToText?.mode === 'server_ready')
                    : null,
            },
            {
                id: 'voice',
                label: intl.formatMessage({ id: 'assistant.capability.voiceOutput', defaultMessage: 'Voice output' }),
                ready: voiceSessionConfig ? voiceCapabilities?.textToSpeech?.mode === 'server_ready' : null,
            },
            {
                id: 'live',
                label: intl.formatMessage({ id: 'assistant.capability.liveLane', defaultMessage: 'Live lane' }),
                ready: voiceSessionConfig ? Boolean(voiceSessionConfig.realtimeEnabled) : null,
            },
        ];
    }, [intl, latestAssistantMessage, voiceSessionConfig]);
    const assistantReadinessCopy = useMemo(() => {
        if (voiceSessionError) {
            return voiceSessionError;
        }
        if (voiceSessionConfig?.realtimeEnabled) {
            return intl.formatMessage({ id: 'assistant.readiness.realtimeReady', defaultMessage: 'Voice, speech, and live-lane controls are wired and ready from this workspace.' });
        }
        if (voiceSessionConfig) {
            return intl.formatMessage({ id: 'assistant.readiness.turnBasedVoice', defaultMessage: 'Text and image are grounded here. Voice stays turn-based until realtime media is available.' });
        }
        return intl.formatMessage({
            id: 'assistant.readiness.localCoreReady',
            defaultMessage: 'App guidance, cart review, and grounded store tools remain available without a model. Media support appears when ready.',
        });
    }, [intl, voiceSessionConfig, voiceSessionError]);
    const cartContextLabel = cartSummary.totalItems > 0
        ? intl.formatMessage(
            { id: 'assistant.context.cartSummary', defaultMessage: 'Cart {count} · {subtotal}' },
            {
                count: cartSummary.totalItems,
                subtotal: intl.formatNumber(cartSummary.totalPrice, {
                    style: 'currency',
                    currency: cartSummary.currency || 'INR',
                    maximumFractionDigits: 0,
                }),
            },
        )
        : intl.formatMessage({ id: 'assistant.context.cartEmpty', defaultMessage: 'Cart empty' });
    const contextChips = [
        { id: 'route', label: routeLabel },
        { id: 'cart', label: cartContextLabel },
        { id: 'auth', label: context.isAuthenticated
            ? intl.formatMessage({ id: 'assistant.context.signedIn', defaultMessage: 'Signed in' })
            : intl.formatMessage({ id: 'assistant.context.guest', defaultMessage: 'Guest' }) },
        { id: 'state', label: status === 'thinking'
            ? intl.formatMessage({ id: 'assistant.context.analyzing', defaultMessage: 'Analyzing' })
            : modeLabel },
    ];

    useEffect(() => {
        if (isAuthLoading || !viewerScope) {
            return;
        }

        switchViewerScope({
            viewerScope,
            preservedContext: {
                route: originPath,
                cartCount: cartSummary.totalItems,
                isAuthenticated,
            },
        });
    }, [
        cartSummary.totalItems,
        isAuthenticated,
        isAuthLoading,
        originPath,
        switchViewerScope,
        viewerScope,
    ]);

    useEffect(() => {
        if (isAuthLoading || !isAuthenticated || !viewerScope) {
            return undefined;
        }

        const requestSnapshot = useChatStore.getState();
        if (String(requestSnapshot.viewerScope || '').toLowerCase() !== viewerScope.toLowerCase()) {
            return undefined;
        }
        const expectedRevisions = Object.fromEntries(
            (requestSnapshot.sessions || []).map((session) => [
                session.id,
                requestSnapshot.getSessionConversationRevision(session.id),
            ]),
        );
        let cancelled = false;
        aiApi.listSessions()
            .then((payload) => {
                if (cancelled) return;
                replaceSessionsFromServer(payload?.sessions || [], {
                    authoritative: true,
                    expectedViewerScope: viewerScope,
                    expectedRevisions,
                });
            })
            .catch(() => {
                // Keep local cache when history hydration fails.
            });

        return () => {
            cancelled = true;
        };
    }, [isAuthLoading, isAuthenticated, replaceSessionsFromServer, viewerScope]);

    useEffect(() => {
        if (isAuthLoading || !isAuthenticated || !activeSessionId || !viewerScope) {
            return undefined;
        }

        const requestSnapshot = useChatStore.getState();
        if (
            String(requestSnapshot.viewerScope || '').toLowerCase() !== viewerScope.toLowerCase()
            || requestSnapshot.activeSessionId !== activeSessionId
        ) {
            return undefined;
        }
        let cancelled = false;
        const expectedRevision = requestSnapshot.getSessionConversationRevision(activeSessionId);
        aiApi.getSession(activeSessionId)
            .then((payload) => {
                if (cancelled || !payload?.session) return;
                hydrateSessionFromServer(payload, {
                    activate: false,
                    expectedRevision,
                    expectedViewerScope: viewerScope,
                    sessionId: activeSessionId,
                });
            })
            .catch(() => {
                // Local-only sessions are allowed until the first server-backed turn lands.
            });

        return () => {
            cancelled = true;
        };
    }, [activeSessionId, hydrateSessionFromServer, isAuthLoading, isAuthenticated, viewerScope]);

    useEffect(() => {
        let cancelled = false;

        aiApi.createVoiceSession({
            locale: 'en-IN',
        }).then((payload) => {
            if (cancelled) return;
            setVoiceSessionConfig(payload || null);
            setVoiceSessionError('');
        }).catch(() => {
            if (cancelled) return;
            setVoiceSessionConfig(null);
            setVoiceSessionError('Voice surface is warming up. Chat and grounded product search remain fully available.');
        });

        return () => {
            cancelled = true;
        };
    }, [isAuthenticated]);

    useEffect(() => {
        setIsSidebarOpen(false);
    }, [activeSessionId, viewerScope]);

    const handleSelectSession = useCallback((sessionId) => {
        setActiveSession(sessionId);
        setIsSidebarOpen(false);
    }, [setActiveSession]);

    const handleCreateNewChat = useCallback(() => {
        stopListening();
        setAttachments([]);
        setAttachmentError('');
        setIsSidebarOpen(false);

        if (!isAuthenticated) {
            resetConversation();
            window.requestAnimationFrame(() => inputRef.current?.focus());
            return;
        }

        aiApi.createSession({
            assistantMode: 'chat',
            originPath,
        }).then((payload) => {
            if (payload?.session) {
                hydrateSessionFromServer(payload);
            } else {
                resetConversation();
            }
        }).catch(() => {
            resetConversation();
        }).finally(() => {
            window.requestAnimationFrame(() => inputRef.current?.focus());
        });
    }, [hydrateSessionFromServer, inputRef, isAuthenticated, originPath, resetConversation, stopListening]);

    const handleClearContext = useCallback(() => {
        setAttachments([]);
        setAttachmentError('');
        setContextError('');
        const targetSessionId = activeSessionId;
        invalidateSessionRequest(targetSessionId);
        if (isAuthenticated && activeSessionId) {
            aiApi.resetSession(targetSessionId)
                .then(() => {
                    clearActiveSessionConversation(targetSessionId);
                })
                .catch(() => {
                    setContextError('I could not clear this saved thread because the assistant service did not confirm the reset. Your existing messages are still here.');
                })
                .finally(() => {
                    window.requestAnimationFrame(() => inputRef.current?.focus());
                });
            return;
        }

        clearActiveSessionConversation(targetSessionId);
        window.requestAnimationFrame(() => inputRef.current?.focus());
    }, [activeSessionId, clearActiveSessionConversation, inputRef, invalidateSessionRequest, isAuthenticated]);

    const handleRetry = useCallback(() => {
        if (!String(lastUserMessage || '').trim() || isLoading) {
            return;
        }
        void handleUserInput(lastUserMessage);
    }, [handleUserInput, isLoading, lastUserMessage]);

    const removeAttachment = useCallback((attachmentId = '') => {
        setAttachments((current) => current.filter((entry) => entry.id !== attachmentId));
    }, []);

    const handleAttachmentSelection = useCallback(async (event) => {
        const files = Array.from(event?.target?.files || []);
        if (files.length === 0) {
            return;
        }

        setAttachmentError('');

        try {
            const selected = [];
            for (const file of files.slice(0, MAX_MEDIA_ATTACHMENTS)) {
                selected.push(await toComposerAttachment(file));
            }

            setAttachments((current) => {
                const next = [...current, ...selected].slice(0, MAX_MEDIA_ATTACHMENTS);
                return next;
            });
        } catch (error) {
            setAttachmentError(error?.message || 'Attachment upload failed.');
        } finally {
            if (event?.target) {
                event.target.value = '';
            }
        }
    }, []);

    const handleStarterPrompt = useCallback((starter) => {
        if (!starter?.prompt) {
            return;
        }

        if (starter.intent === 'prefill') {
            setInputValue(starter.prompt);
            window.requestAnimationFrame(() => inputRef.current?.focus());
            return;
        }

        void handleUserInput(starter.prompt);
    }, [handleUserInput, inputRef, setInputValue]);

    useEffect(() => {
        if (!isSidebarOpen || typeof window === 'undefined') {
            return undefined;
        }

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setIsSidebarOpen(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isSidebarOpen]);

    return (
        <div className="assistant-theme-shell relative h-dvh overflow-hidden text-slate-100">
            <div className="assistant-theme-shell__base pointer-events-none absolute inset-0" />
            <div className="assistant-theme-shell__rail pointer-events-none absolute inset-y-0 left-1/4 w-px" />
            {isSidebarOpen ? (
                <div
                    aria-hidden="true"
                    onClick={() => setIsSidebarOpen(false)}
                    className="fixed inset-0 z-30 bg-black/30 transition lg:hidden"
                />
            ) : null}
            <div className="relative mx-auto flex h-dvh w-full overflow-hidden">
                <aside className={cn(
                    'assistant-history-panel fixed inset-y-0 left-0 z-40 flex h-dvh w-72 max-w-full flex-col overflow-hidden border-r border-cyan-300/10 px-3 py-4 transition-transform duration-300 lg:static lg:z-auto lg:w-full lg:max-w-xs lg:translate-x-0 lg:px-4 lg:py-5 lg:shadow-none',
                    isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
                )}>
                    <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-4 shadow-lg">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className="flex h-12 w-12 items-center justify-center rounded-[1.35rem] border border-cyan-300/20 bg-cyan-400/10 text-cyan-200">
                                    <Sparkles className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-white"><StableText id={"common.jsx.text.aura.terminal.2fded973"} defaultMessage={"Aura Terminal"} /></p>
                                    <p className="text-xs text-slate-400"><StableText id={"common.jsx.text.controlled.commerce.intelligence.ac057065"} defaultMessage={"Controlled commerce intelligence"} /></p>
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                                <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-slate-300">
                                    {isAuthenticated ? <StableText id={"common.jsx.expression.signed.in.4347f904"} defaultMessage={"Signed in"} /> : <StableText id={"common.jsx.expression.guest.c539652f"} defaultMessage={"Guest"} />}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setIsSidebarOpen(false)}
                                    className="inline-flex h-10 w-10 touch-manipulation items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-slate-300 transition hover:bg-white/[0.1] lg:hidden"
                                    aria-label={intl.formatMessage({ id: 'assistant.history.close.ariaLabel', defaultMessage: 'Close assistant history' })}
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-[1rem] border border-white/10 bg-white/[0.04] px-3 py-2.5">
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500"><FormattedMessage id="assistant.sidebar.threads" defaultMessage="Threads" /></p>
                                <p className="mt-1 text-lg font-semibold text-white">{sessionCount}</p>
                            </div>
                            <div className="rounded-[1rem] border border-white/10 bg-white/[0.04] px-3 py-2.5">
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500"><StableText id={"common.jsx.text.surface.35807d37"} defaultMessage={"Surface"} /></p>
                                <p className="mt-1 text-lg font-semibold text-white">{modeLabel}</p>
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleCreateNewChat}
                        className="mt-4 inline-flex items-center justify-center gap-2 rounded-[1.2rem] border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/20"
                    >
                        <Plus className="h-4 w-4" />
                        <FormattedMessage id="assistant.chat.new" defaultMessage="New chat" />
                    </button>

                    <label className="mt-4 flex items-center gap-2 rounded-[1.2rem] border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-300">
                        <Search className="h-4 w-4 text-slate-500" />
                        <input
                            value={sessionSearchQuery}
                            onChange={(event) => setSessionSearchQuery(event.target.value)}
                            placeholder={intl.formatMessage({ id: 'assistant.history.search.placeholder', defaultMessage: 'Search conversations' })}
                            className="w-full bg-transparent outline-none placeholder:text-slate-500"
                        />
                    </label>

                    <div className="mt-5 flex-1 space-y-5 overflow-y-auto overscroll-contain pr-1">
                        {groupedSessions.map((group) => (
                            <section key={group.key}>
                                <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                    {group.label}
                                </p>
                                <div className="space-y-2">
                                    {group.sessions.map((session) => {
                                        const isActive = session.id === activeSessionId;
                                        return (
                                            <div
                                                key={session.id}
                                                className={cn(
                                                    'flex w-full items-start gap-3 rounded-[1.2rem] border px-3 py-3 text-left transition-all duration-200',
                                                    isActive
                                                        ? 'border-cyan-300/25 bg-cyan-400/10 shadow-[0_12px_40px_rgba(34,211,238,0.08)]'
                                                        : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]',
                                                )}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => handleSelectSession(session.id)}
                                                    className="min-w-0 flex-1 text-left outline-none"
                                                >
                                                    <div className="flex items-center justify-between gap-3">
                                                        <p className="truncate text-sm font-medium text-white">
                                                            {session.title}
                                                        </p>
                                                        <span className="shrink-0 text-[11px] text-slate-500">
                                                            {formatSessionTime(session.updatedAt)}
                                                        </span>
                                                    </div>
                                                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">
                                                        {session.preview}
                                                    </p>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        togglePinnedSession(session.id);
                                                    }}
                                                    aria-label={intl.formatMessage(
                                                        { id: 'assistant.history.pinToggle.ariaLabel', defaultMessage: '{action} {title}' },
                                                        {
                                                            action: session.pinned
                                                                ? intl.formatMessage({ id: 'assistant.history.unpin', defaultMessage: 'Unpin' })
                                                                : intl.formatMessage({ id: 'assistant.history.pin', defaultMessage: 'Pin' }),
                                                            title: session.title,
                                                        }
                                                    )}
                                                    className={cn(
                                                        'mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition',
                                                        session.pinned
                                                            ? 'border-amber-300/30 bg-amber-400/10 text-amber-200'
                                                            : 'border-white/10 text-slate-500 hover:text-white',
                                                    )}
                                                >
                                                    <Pin className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        ))}

                        <section className="space-y-4">
                            <div className="rounded-[1.45rem] border border-white/10 bg-white/[0.04] p-4">
                                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-cyan-300">
                                    <Orbit className="h-3.5 w-3.5" />
                                    <FormattedMessage id="assistant.sidebar.readiness" defaultMessage="Assistant readiness" />
                                </div>
                                <p className="mt-2 text-sm font-semibold text-white">{providerLabel}</p>
                                <p className="mt-1 text-xs leading-5 text-slate-400">{assistantReadinessCopy}</p>

                                <div className="mt-3 flex flex-wrap gap-2">
                                    {assistantCapabilities.map((capability) => (
                                        <span
                                            key={capability.id}
                                            className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', getCapabilityTone(capability.ready))}
                                        >
                                            {capability.label}
                                            <span className="sr-only">: </span>
                                            <span className="ml-1 opacity-80">
                                                {capability.ready === true
                                                    ? intl.formatMessage({ id: 'assistant.capability.available', defaultMessage: 'Available' })
                                                    : capability.ready === false
                                                        ? intl.formatMessage({ id: 'assistant.capability.unavailable', defaultMessage: 'Unavailable' })
                                                        : intl.formatMessage({ id: 'assistant.capability.checking', defaultMessage: 'Checking' })}
                                            </span>
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <MultimodalDock variant="compact" />
                        </section>
                    </div>
                </aside>

                <section
                    aria-label={intl.formatMessage({ id: 'assistant.workspace.ariaLabel', defaultMessage: 'Assistant workspace' })}
                    className="flex h-dvh min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:pl-0"
                >
                    <header className="assistant-command-header shrink-0 border-b border-white/10 bg-[linear-gradient(180deg,rgba(5,8,17,0.9),rgba(5,8,17,0.78))] px-3 py-3 backdrop-blur-xl sm:px-6 sm:py-4">
                        <div className="assistant-command-header__panel rounded-[1rem] border border-white/10 bg-white/[0.03] px-3 py-3 shadow-lg sm:rounded-[1.2rem] sm:px-5 sm:py-4">
                            <div className="flex items-start justify-between gap-3 sm:flex-wrap sm:gap-4">
                                <div className="flex items-start gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setIsSidebarOpen(true)}
                                        className="inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-[1rem] border border-white/10 bg-white/[0.04] text-slate-200 transition hover:bg-white/[0.08] active:scale-95 lg:hidden"
                                        aria-label={intl.formatMessage({ id: 'assistant.history.open.ariaLabel', defaultMessage: 'Open assistant history' })}
                                    >
                                        <Menu className="h-5 w-5" />
                                    </button>
                                    <div>
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300 sm:text-[11px] sm:tracking-[0.2em]">
                                            <StableText id={"common.jsx.text.commerce.copilot.e872e317"} defaultMessage={"Commerce Copilot"} />
                                        </p>
                                        <h1 className="mt-1 text-lg font-semibold text-white sm:mt-1.5 sm:text-2xl">
                                            {activeSession?.title || intl.formatMessage({ id: 'assistant.chat.new', defaultMessage: 'New chat' })}
                                        </h1>
                                        <p className="mt-1 hidden max-w-3xl text-sm leading-6 text-slate-400 sm:block">
                                            <StableText id={"order.jsx.text.ask.for.product.picks.cart.review.order.db04ca3e"} defaultMessage={"Ask for product picks, cart review, order support, or grounded marketplace decisions."} />
                                        </p>
                                    </div>
                                </div>

                                <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
                                    <button
                                        type="button"
                                        onClick={handleRetry}
                                        disabled={!String(lastUserMessage || '').trim() || isLoading}
                                        className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
                                    >
                                        <span className="inline-flex items-center gap-2">
                                            <RotateCcw className="h-3.5 w-3.5" />
                                            <span className="hidden sm:inline"><FormattedMessage id="assistant.action.retry" defaultMessage="Retry" /></span>
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleClearContext}
                                        className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-white/[0.08] sm:px-3"
                                    >
                                        <span className="inline-flex items-center gap-2">
                                            <Trash2 className="h-3.5 w-3.5" />
                                            <span className="hidden sm:inline"><StableText id={"common.jsx.text.clear.context.e550a0f3"} defaultMessage={"Clear context"} /></span>
                                        </span>
                                    </button>
                                </div>
                            </div>

                            <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible sm:pb-0">
                                {contextChips.map((chip) => (
                                    <span
                                        key={chip.id}
                                        className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300"
                                    >
                                        {chip.label}
                                    </span>
                                ))}
                            </div>

                            {!latestTurnOwnsActions && (primaryAction || (Array.isArray(secondaryActions) && secondaryActions.length > 0)) ? (
                                <div className="mt-4">
                                    <ActionBar
                                        primaryAction={primaryAction}
                                        secondaryActions={secondaryActions}
                                        isDisabled={isLoading}
                                        onAction={handleAction}
                                    />
                                </div>
                            ) : null}
                        </div>
                    </header>

                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                        {!hasUserMessages && !isLoading ? (
                            <section className="assistant-starter-deck shrink-0 px-3 pt-2 sm:px-6 sm:pt-4">
                                <div className="assistant-starter-panel mx-auto max-w-5xl rounded-[0.9rem] border border-white/10 p-2.5 shadow-lg sm:rounded-[1.2rem] sm:p-5">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-300 sm:text-[11px] sm:tracking-[0.18em]">
                                                <WandSparkles className="h-3.5 w-3.5" />
                                                <FormattedMessage id="assistant.fastStarts.eyebrow" defaultMessage="Fast starts" />
                                            </div>
                                            <p className="mt-1.5 text-sm font-semibold text-white sm:mt-2 sm:text-lg">
                                                <FormattedMessage id="assistant.fastStarts.title" defaultMessage="Start with a grounded shopping workflow." />
                                            </p>
                                            <p className="mt-1 hidden max-w-2xl text-sm leading-6 text-slate-400 sm:block">
                                                <FormattedMessage id="assistant.fastStarts.description" defaultMessage="Choose a task. The assistant uses current store context, explains trade-offs, and asks before any account-changing action." />
                                            </p>
                                        </div>
                                        <span className="hidden rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 sm:inline-flex sm:px-3 sm:text-xs">
                                            <FormattedMessage id="assistant.fastStarts.badge" defaultMessage="Verified store context" />
                                        </span>
                                    </div>

                                    <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:mt-4 sm:gap-2.5 md:grid-cols-2 xl:grid-cols-4">
                                        {STARTER_PROMPTS.map((starter) => (
                                            <button
                                                key={starter.id}
                                                type="button"
                                                onClick={() => handleStarterPrompt(starter)}
                                                className="group h-16 rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-left transition hover:border-cyan-300/20 hover:bg-cyan-400/10 sm:h-28 sm:rounded-[1rem] sm:p-3.5"
                                            >
                                                <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.14em] text-cyan-300 sm:gap-2 sm:text-[10px] sm:tracking-[0.17em]">
                                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                                    {starter.intent === 'prefill'
                                                        ? <FormattedMessage id="assistant.starter.stage" defaultMessage="Prepare" />
                                                        : <FormattedMessage id="assistant.starter.launch" defaultMessage="Ask now" />}
                                                </div>
                                                <p className="mt-1.5 text-sm font-semibold leading-snug text-white sm:mt-2.5">
                                                    {intl.formatMessage(starter.titleMessage)}
                                                </p>
                                                <p className="mt-1 hidden text-xs leading-5 text-slate-400 sm:block">
                                                    {intl.formatMessage(starter.detailMessage)}
                                                </p>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </section>
                        ) : null}

                        <MessageList
                            messages={messages}
                            isLoading={isLoading}
                            className="px-3 py-3 sm:px-6 sm:py-5"
                            onSelectProduct={(productId) => void selectProduct(productId)}
                            onAddToCart={(productId) => void addProductToCart(productId)}
                            onViewDetails={(productId) => void selectProduct(productId)}
                            onOpenSupport={(prefill, orderId) => void openSupport(prefill, orderId)}
                            onConfirmPending={(token) => void confirmPendingAction(token)}
                            onCancelPending={cancelPendingAction}
                            onModifyPending={modifyPendingAction}
                        />

                        <div className="assistant-composer-dock shrink-0 border-t border-white/10 bg-slate-950 px-3 pt-2 sm:px-5 sm:pt-3">
                            <div className="mx-auto w-full max-w-4xl">
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*,audio/*"
                                    multiple
                                    className="hidden"
                                    onChange={handleAttachmentSelection}
                                />

                                {attachments.length > 0 ? (
                                    <div className="mb-4 flex flex-wrap gap-3">
                                        {attachments.map((attachment) => (
                                            <div
                                                key={attachment.id}
                                                className="group flex items-center gap-3 rounded-[1.2rem] border border-cyan-300/20 bg-cyan-400/10 px-3 py-2.5 text-xs text-cyan-50"
                                            >
                                                {attachment.kind === 'image' ? (
                                                    <img
                                                        src={attachment.dataUrl}
                                                        alt={attachment.fileName || 'attachment'}
                                                        className="h-10 w-10 rounded-[0.9rem] object-cover"
                                                    />
                                                ) : (
                                                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-[0.9rem] border border-cyan-300/20 bg-[#091323]">
                                                        <AudioLines className="h-4 w-4" />
                                                    </span>
                                                )}
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-semibold">{attachment.fileName || 'attachment'}</p>
                                                    <p className="text-[11px] text-cyan-100/75">
                                                        {attachment.kind === 'image' ? <StableText id={"common.jsx.expression.image.ready.for.grounding.152acb95"} defaultMessage={"Image ready for grounding"} /> : <StableText id={"common.jsx.expression.audio.ready.for.processing.68d50ec5"} defaultMessage={"Audio ready for processing"} />}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeAttachment(attachment.id)}
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-cyan-300/20 transition hover:bg-cyan-300/10"
                                                    aria-label={intl.formatMessage(
                                                        { id: 'assistant.attachment.remove.ariaLabel', defaultMessage: 'Remove {fileName}' },
                                                        {
                                                            fileName: attachment.fileName || intl.formatMessage({ id: 'assistant.attachment.fallbackName', defaultMessage: 'attachment' }),
                                                        }
                                                    )}
                                                >
                                                    <X className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}

                                {attachmentError ? (
                                    <p className="mb-3 text-xs text-rose-300">{attachmentError}</p>
                                ) : null}

                                {contextError ? (
                                    <p className="mb-3 text-xs text-rose-300" role="alert">{contextError}</p>
                                ) : null}

                                <form
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        const imageAttachments = attachments
                                            .filter((attachment) => attachment.kind === 'image')
                                            .map(({ id, kind, ...rest }) => rest);
                                        const audioAttachments = attachments
                                            .filter((attachment) => attachment.kind === 'audio')
                                            .map(({ id, kind, ...rest }) => rest);
                                        if (!String(inputValue || '').trim() && imageAttachments.length === 0 && audioAttachments.length === 0) {
                                            return;
                                        }
                                        if (isListening) {
                                            stopListening();
                                        }
                                        void handleUserInput(inputValue, {
                                            images: imageAttachments,
                                            audio: audioAttachments,
                                        });
                                        setAttachments([]);
                                        setAttachmentError('');
                                    }}
                                    className="rounded-[1.35rem] border border-cyan-300/20 px-2.5 py-2 transition sm:rounded-[1.6rem] sm:px-3"
                                >
                                    <div className="flex items-center gap-2 sm:gap-3">
                                        <button
                                            type="button"
                                            onClick={() => fileInputRef.current?.click()}
                                            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/[0.08]"
                                            aria-label={intl.formatMessage({ id: 'assistant.attachments.upload.ariaLabel', defaultMessage: 'Upload attachments' })}
                                        >
                                            <Paperclip className="h-4 w-4" />
                                        </button>

                                        <div className="min-w-0 flex-1 rounded-full px-3">
                                            <textarea
                                                ref={inputRef}
                                                value={inputValue}
                                                onChange={(event) => setInputValue(event.target.value)}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter' && !event.shiftKey) {
                                                        event.preventDefault();
                                                        if (String(inputValue || '').trim() || attachments.length > 0) {
                                                            const imageAttachments = attachments
                                                                .filter((attachment) => attachment.kind === 'image')
                                                                .map(({ id, kind, ...rest }) => rest);
                                                            const audioAttachments = attachments
                                                                .filter((attachment) => attachment.kind === 'audio')
                                                                .map(({ id, kind, ...rest }) => rest);
                                                            if (isListening) {
                                                                stopListening();
                                                            }
                                                            void handleUserInput(inputValue, {
                                                                images: imageAttachments,
                                                                audio: audioAttachments,
                                                            });
                                                            setAttachments([]);
                                                            setAttachmentError('');
                                                        }
                                                    }
                                                }}
                                                rows={Math.min(Math.max(String(inputValue || '').split('\n').length, 1), 6)}
                                                placeholder={isListening
                                                    ? intl.formatMessage(composerMessages.listeningPlaceholder)
                                                    : intl.formatMessage(composerMessages.promptPlaceholder)}
                                                disabled={isLoading}
                                                className="assistant-composer-textarea block max-h-28 min-h-10 w-full resize-none overflow-y-auto bg-transparent px-0 py-2 text-[15px] leading-6 text-white outline-none placeholder:text-slate-500 sm:min-h-12"
                                            />
                                        </div>

                                        <div className="flex shrink-0 items-center gap-2">
                                            {supportsSpeechInput ? (
                                                <button
                                                    type="button"
                                                    onClick={toggleListening}
                                                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/[0.08]"
                                                aria-label={isListening
                                                    ? intl.formatMessage({ id: 'assistant.dictation.stop.ariaLabel', defaultMessage: 'Stop dictation' })
                                                    : intl.formatMessage({ id: 'assistant.dictation.start.ariaLabel', defaultMessage: 'Start dictation' })}
                                                >
                                                    {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                                                </button>
                                            ) : null}
                                            <button
                                                type="submit"
                                                disabled={(!String(inputValue || '').trim() && attachments.length === 0) || isLoading}
                                                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-cyan-400 text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                                                aria-label={intl.formatMessage({ id: 'assistant.composer.send.ariaLabel', defaultMessage: 'Send message' })}
                                            >
                                                <ArrowUp className="h-4.5 w-4.5" />
                                            </button>
                                        </div>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default AssistantPage;
