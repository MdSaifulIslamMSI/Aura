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
import ActionBar from '@/components/features/chat/ActionBar';
import MessageList from '@/components/features/chat/MessageList';
import MultimodalDock from '@/components/features/chat/MultimodalDock';
import { useAssistantController } from '@/components/features/chat/useAssistantController';
import { AuthContext } from '@/context/AuthContext';
import { useSpeechInput } from '@/hooks/useSpeechInput';
import { cn } from '@/lib/utils';
import { aiApi } from '@/services/aiApi';
import { useChatStore } from '@/store/chatStore';
import { selectCartSummary, useCommerceStore } from '@/store/commerceStore';
import { getAssistantRouteLabel } from '@/utils/assistantCommands';

const MODE_COPY = {
    explore: 'Exploration',
    product: 'Product focus',
    cart: 'Cart review',
    checkout: 'Checkout',
    support: 'Support',
};

const MAX_MEDIA_ATTACHMENTS = 3;
const MAX_MEDIA_FILE_BYTES = 8 * 1024 * 1024;
const STARTER_PROMPTS = [
    {
        id: 'compare',
        title: 'Grounded comparison',
        detail: 'Compare two real options and explain the trade-offs.',
        prompt: 'Compare the best phones under 50000 and tell me the strongest value pick.',
        intent: 'send',
    },
    {
        id: 'cart',
        title: 'Cart review',
        detail: 'Audit the cart, surface risks, and recommend the next step.',
        prompt: 'Review my cart and tell me the smartest next step before checkout.',
        intent: 'send',
    },
    {
        id: 'visual',
        title: 'Photo match',
        detail: 'Prepare a visual-search brief before you attach an image.',
        prompt: 'When I attach a product image, find the closest grounded match and explain confidence.',
        intent: 'prefill',
    },
    {
        id: 'orders',
        title: 'Order follow-up',
        detail: 'Track an order or escalate into support without losing context.',
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

const resolveOriginPath = (location, fallback = '/') => {
    const from = new URLSearchParams(location?.search || '').get('from');
    if (!from) {
        return fallback || '/';
    }

    const decoded = String(from || '').trim();
    return decoded.startsWith('/') ? decoded : `/${decoded}`;
};

const formatSessionTime = (timestamp = 0) => {
    if (!timestamp) return '';

    return new Intl.DateTimeFormat('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
    }).format(new Date(timestamp));
};

const getCapabilityTone = (enabled = false) => (
    enabled
        ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
        : 'border-amber-300/20 bg-amber-500/10 text-amber-100'
);

const AssistantPage = () => {
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

    const originPath = resolveOriginPath(location, activeSession?.originPath || context.route || '/');
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
    const modeLabel = MODE_COPY[mode] || MODE_COPY.explore;
    const lastUserMessage = useMemo(
        () => [...messages].reverse().find((message) => message?.role === 'user' && String(message?.text || '').trim())?.text || '',
        [messages],
    );
    const latestAssistantMessage = useMemo(
        () => [...messages].reverse().find((message) => message?.role === 'assistant') || null,
        [messages],
    );
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
            return `${providerName} \u00b7 ${providerModel}`;
        }
        return providerName || 'Awaiting first grounded turn';
    }, [latestAssistantMessage]);
    const assistantCapabilities = useMemo(() => {
        const providerCapabilities = latestAssistantMessage?.providerCapabilities || null;
        const voiceCapabilities = voiceSessionConfig?.capabilities || {};

        return [
            {
                id: 'text',
                label: 'Text reasoning',
                ready: providerCapabilities?.textInput !== false,
            },
            {
                id: 'image',
                label: 'Image grounding',
                ready: Boolean(providerCapabilities?.imageInput),
            },
            {
                id: 'audio',
                label: 'Audio reasoning',
                ready: Boolean(providerCapabilities?.audioInput),
            },
            {
                id: 'speech',
                label: 'Speech intake',
                ready: voiceSessionConfig?.supportsAudioUpload || voiceCapabilities?.speechToText?.mode === 'server_ready',
            },
            {
                id: 'voice',
                label: 'Voice output',
                ready: voiceCapabilities?.textToSpeech?.mode === 'server_ready',
            },
            {
                id: 'live',
                label: 'Live lane',
                ready: Boolean(voiceSessionConfig?.realtimeEnabled),
            },
        ];
    }, [latestAssistantMessage, voiceSessionConfig]);
    const assistantReadinessCopy = useMemo(() => {
        if (voiceSessionError) {
            return voiceSessionError;
        }
        if (voiceSessionConfig?.realtimeEnabled) {
            return 'Voice, speech, and live-lane controls are wired and ready from this workspace.';
        }
        if (voiceSessionConfig) {
            return 'Text and image are grounded here. Voice stays turn-based until realtime media is available.';
        }
        return 'Preparing multimodal status surface.';
    }, [voiceSessionConfig, voiceSessionError]);
    const contextChips = [
        { id: 'route', label: routeLabel },
        { id: 'path', label: originPath },
        { id: 'cart', label: `Cart ${cartSummary.totalItems || 0}` },
        { id: 'auth', label: context.isAuthenticated ? 'Signed in' : 'Guest' },
        { id: 'state', label: status === 'thinking' ? 'Analyzing' : modeLabel },
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
        if (isAuthLoading || !isAuthenticated) {
            return undefined;
        }

        let cancelled = false;
        aiApi.listSessions()
            .then((payload) => {
                if (cancelled) return;
                replaceSessionsFromServer(payload?.sessions || [], { authoritative: true });
            })
            .catch(() => {
                // Keep local cache when history hydration fails.
            });

        return () => {
            cancelled = true;
        };
    }, [isAuthLoading, isAuthenticated, replaceSessionsFromServer]);

    useEffect(() => {
        if (isAuthLoading || !isAuthenticated || !activeSessionId) {
            return undefined;
        }

        let cancelled = false;
        aiApi.getSession(activeSessionId)
            .then((payload) => {
                if (cancelled || !payload?.session) return;
                hydrateSessionFromServer(payload);
            })
            .catch(() => {
                // Local-only sessions are allowed until the first server-backed turn lands.
            });

        return () => {
            cancelled = true;
        };
    }, [activeSessionId, hydrateSessionFromServer, isAuthLoading, isAuthenticated]);

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
        if (isAuthenticated && activeSessionId) {
            aiApi.resetSession(activeSessionId)
                .catch(() => undefined)
                .finally(() => {
                    clearActiveSessionConversation();
                    window.requestAnimationFrame(() => inputRef.current?.focus());
                });
            return;
        }

        clearActiveSessionConversation();
        window.requestAnimationFrame(() => inputRef.current?.focus());
    }, [activeSessionId, clearActiveSessionConversation, inputRef, isAuthenticated]);

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

    return (
        <div className="relative h-[100dvh] overflow-hidden bg-[#050811] text-slate-100">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_32%),radial-gradient(circle_at_85%_15%,rgba(16,185,129,0.12),transparent_28%),linear-gradient(180deg,rgba(5,8,17,0.98),rgba(7,10,20,1))]" />
            <div className="pointer-events-none absolute inset-y-0 left-[19%] w-px bg-gradient-to-b from-transparent via-cyan-400/15 to-transparent" />
            <button
                type="button"
                aria-label="Close assistant history"
                onClick={() => setIsSidebarOpen(false)}
                className={cn(
                    'fixed inset-0 z-20 bg-[#02040a]/72 backdrop-blur-sm transition lg:hidden',
                    isSidebarOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
                )}
            />
            <div className="relative z-10 mx-auto flex h-[100dvh] w-full max-w-[1650px] overflow-hidden">
                <aside className={cn(
                    'fixed inset-y-0 left-0 z-30 flex h-[100dvh] w-[88vw] max-w-[320px] flex-col overflow-hidden border-r border-white/10 bg-[linear-gradient(180deg,rgba(9,14,25,0.98),rgba(7,11,21,0.96))] px-4 py-5 backdrop-blur-xl transition-transform duration-300 lg:static lg:z-auto lg:w-full lg:max-w-[320px] lg:translate-x-0',
                    isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
                )}>
                    <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className="flex h-12 w-12 items-center justify-center rounded-[1.35rem] border border-cyan-300/20 bg-cyan-400/10 text-cyan-200">
                                    <Sparkles className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-white">Aura Terminal</p>
                                    <p className="text-xs text-slate-400">Controlled commerce intelligence</p>
                                </div>
                            </div>
                            <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-slate-300">
                                {isAuthenticated ? 'Signed in' : 'Guest'}
                            </span>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-[1rem] border border-white/10 bg-white/[0.04] px-3 py-2.5">
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Threads</p>
                                <p className="mt-1 text-lg font-semibold text-white">{sessionCount}</p>
                            </div>
                            <div className="rounded-[1rem] border border-white/10 bg-white/[0.04] px-3 py-2.5">
                                <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Surface</p>
                                <p className="mt-1 text-lg font-semibold text-white">{modeLabel}</p>
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleCreateNewChat}
                        className="mt-4 inline-flex items-center justify-center gap-2 rounded-[1.2rem] border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(34,211,238,0.16),rgba(16,185,129,0.12))] px-4 py-3 text-sm font-semibold text-cyan-50 transition hover:bg-[linear-gradient(135deg,rgba(34,211,238,0.22),rgba(16,185,129,0.16))]"
                    >
                        <Plus className="h-4 w-4" />
                        New chat
                    </button>

                    <label className="mt-4 flex items-center gap-2 rounded-[1.2rem] border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-300">
                        <Search className="h-4 w-4 text-slate-500" />
                        <input
                            value={sessionSearchQuery}
                            onChange={(event) => setSessionSearchQuery(event.target.value)}
                            placeholder="Search conversations"
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
                                            <button
                                                key={session.id}
                                                type="button"
                                                onClick={() => handleSelectSession(session.id)}
                                                className={cn(
                                                    'flex w-full items-start gap-3 rounded-[1.2rem] border px-3 py-3 text-left transition-all duration-200',
                                                    isActive
                                                        ? 'border-cyan-300/25 bg-cyan-400/10 shadow-[0_12px_40px_rgba(34,211,238,0.08)]'
                                                        : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]',
                                                )}
                                            >
                                                <div className="min-w-0 flex-1">
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
                                                </div>
                                                <span
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={(event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        togglePinnedSession(session.id);
                                                    }}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            event.stopPropagation();
                                                            togglePinnedSession(session.id);
                                                        }
                                                    }}
                                                    className={cn(
                                                        'mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full border transition',
                                                        session.pinned
                                                            ? 'border-amber-300/30 bg-amber-400/10 text-amber-200'
                                                            : 'border-white/10 text-slate-500 hover:text-white',
                                                    )}
                                                >
                                                    <Pin className="h-3.5 w-3.5" />
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                        ))}

                        <section className="space-y-4">
                            <div className="rounded-[1.45rem] border border-white/10 bg-white/[0.04] p-4">
                                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-cyan-300">
                                    <Orbit className="h-3.5 w-3.5" />
                                    Model surface
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
                                        </span>
                                    ))}
                                </div>

                                {latestAssistantMessage?.grounding?.route ? (
                                    <div className="mt-3 rounded-[1rem] border border-white/10 bg-[#08111f] px-3 py-2.5 text-[11px] text-slate-300">
                                        Active route {latestAssistantMessage.grounding.route.replace(/_/g, ' ')}
                                        {latestAssistantMessage?.grounding?.retrievalHitCount ? ` | ${latestAssistantMessage.grounding.retrievalHitCount} hits` : ''}
                                    </div>
                                ) : null}
                            </div>

                            <MultimodalDock variant="compact" />
                        </section>
                    </div>
                </aside>

                <main className="flex h-[100dvh] min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:pl-0">
                    <header className="border-b border-white/10 bg-[linear-gradient(180deg,rgba(5,8,17,0.88),rgba(5,8,17,0.78))] px-6 py-5 backdrop-blur-xl">
                        <div className="rounded-[1.8rem] border border-white/10 bg-white/[0.03] px-5 py-5 shadow-[0_25px_90px_rgba(0,0,0,0.22)]">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                                <div className="flex items-start gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setIsSidebarOpen(true)}
                                        className="inline-flex h-11 w-11 items-center justify-center rounded-[1rem] border border-white/10 bg-white/[0.04] text-slate-200 transition hover:bg-white/[0.08] lg:hidden"
                                        aria-label="Open assistant history"
                                    >
                                        <Menu className="h-4 w-4" />
                                    </button>
                                    <div>
                                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">
                                        Controlled Terminal
                                    </p>
                                    <h1 className="mt-2 text-2xl font-semibold text-white">
                                        {activeSession?.title || 'New chat'}
                                    </h1>
                                    <p className="mt-2 max-w-3xl text-sm text-slate-400">
                                        Fast answers stay responsive, refined answers upgrade in place, and every commerce turn stays bounded by grounded data and explicit control paths.
                                    </p>
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={handleRetry}
                                        disabled={!String(lastUserMessage || '').trim() || isLoading}
                                        className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                                    >
                                        <span className="inline-flex items-center gap-2">
                                            <RotateCcw className="h-3.5 w-3.5" />
                                            Retry
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleClearContext}
                                        className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/[0.08]"
                                    >
                                        <span className="inline-flex items-center gap-2">
                                            <Trash2 className="h-3.5 w-3.5" />
                                            Clear context
                                        </span>
                                    </button>
                                </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                                {contextChips.map((chip) => (
                                    <span
                                        key={chip.id}
                                        className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300"
                                    >
                                        {chip.label}
                                    </span>
                                ))}
                                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300">
                                    {providerLabel}
                                </span>
                            </div>

                            {(primaryAction || (Array.isArray(secondaryActions) && secondaryActions.length > 0)) ? (
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

                    <div className="flex min-h-0 flex-1 flex-col">
                        {!hasUserMessages && !isLoading ? (
                            <section className="px-6 pt-6">
                                <div className="mx-auto max-w-5xl rounded-[1.8rem] border border-white/10 bg-[linear-gradient(135deg,rgba(10,15,30,0.95),rgba(6,10,21,0.92))] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.2)]">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div>
                                            <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-cyan-300">
                                                <WandSparkles className="h-3.5 w-3.5" />
                                                Fast starts
                                            </div>
                                            <p className="mt-2 text-lg font-semibold text-white">Start with a premium grounded workflow.</p>
                                            <p className="mt-1 max-w-2xl text-sm text-slate-400">
                                                Pick a starter and the assistant will either launch the flow directly or stage the right brief for you to refine.
                                            </p>
                                        </div>
                                        <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-100">
                                            Controlled by design
                                        </span>
                                    </div>

                                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                        {STARTER_PROMPTS.map((starter) => (
                                            <button
                                                key={starter.id}
                                                type="button"
                                                onClick={() => handleStarterPrompt(starter)}
                                                className="group rounded-[1.35rem] border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-cyan-300/20 hover:bg-cyan-400/[0.08]"
                                            >
                                                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-cyan-300">
                                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                                    {starter.intent === 'prefill' ? 'Stage' : 'Launch'}
                                                </div>
                                                <p className="mt-3 text-sm font-semibold text-white">{starter.title}</p>
                                                <p className="mt-1 text-xs leading-5 text-slate-400">{starter.detail}</p>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </section>
                        ) : null}

                        <MessageList
                            messages={messages}
                            isLoading={isLoading}
                            className="px-6 py-6"
                            onSelectProduct={(productId) => void selectProduct(productId)}
                            onAddToCart={(productId) => void addProductToCart(productId)}
                            onViewDetails={(productId) => void selectProduct(productId)}
                            onOpenSupport={(prefill, orderId) => void openSupport(prefill, orderId)}
                            onConfirmPending={(token) => void confirmPendingAction(token)}
                            onCancelPending={cancelPendingAction}
                            onModifyPending={modifyPendingAction}
                        />

                        <div className="border-t border-white/10 bg-[linear-gradient(180deg,rgba(5,8,17,0.96),rgba(5,8,17,1))] px-6 py-5">
                            <div className="mx-auto w-full max-w-5xl">
                                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                    <span className="rounded-full border border-white/10 px-2.5 py-1">Enter to send</span>
                                    <span className="rounded-full border border-white/10 px-2.5 py-1">Shift+Enter for newline</span>
                                    {assistantCapabilities.slice(0, 4).map((capability) => (
                                        <span
                                            key={capability.id}
                                            className={cn('rounded-full border px-2.5 py-1', capability.ready ? 'border-emerald-400/20 text-emerald-300' : 'border-amber-300/20 text-amber-300')}
                                        >
                                            {capability.label}
                                        </span>
                                    ))}
                                </div>

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
                                                        {attachment.kind === 'image' ? 'Image ready for grounding' : 'Audio ready for processing'}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeAttachment(attachment.id)}
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-cyan-300/20 transition hover:bg-cyan-300/10"
                                                    aria-label={`Remove ${attachment.fileName || 'attachment'}`}
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
                                    className="rounded-[1.85rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-3 shadow-[0_24px_90px_rgba(0,0,0,0.28)]"
                                >
                                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-2">
                                        <div>
                                            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-cyan-300">Prompt surface</p>
                                            <p className="mt-1 text-xs text-slate-400">{assistantReadinessCopy}</p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300">
                                                {routeLabel}
                                            </span>
                                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300">
                                                Cart {cartSummary.totalItems || 0}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-end gap-3">
                                        <button
                                            type="button"
                                            onClick={() => fileInputRef.current?.click()}
                                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/[0.08]"
                                            aria-label="Upload attachments"
                                        >
                                            <Paperclip className="h-4.5 w-4.5" />
                                        </button>

                                        <div className="flex-1 rounded-[1.4rem] border border-white/10 bg-[#07101d]/80 px-3 py-1">
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
                                                placeholder={isListening ? 'Listening...' : 'Ask for products, order help, support, or attach media for a grounded match.'}
                                                disabled={isLoading}
                                                className="max-h-44 min-h-[56px] w-full resize-none bg-transparent px-1 py-2 text-base text-white outline-none placeholder:text-slate-500"
                                            />
                                        </div>

                                        <div className="flex items-center gap-2 pb-1">
                                            {supportsSpeechInput ? (
                                                <button
                                                    type="button"
                                                    onClick={toggleListening}
                                                    className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/[0.08]"
                                                    aria-label={isListening ? 'Stop dictation' : 'Start dictation'}
                                                >
                                                    {isListening ? <MicOff className="h-4.5 w-4.5" /> : <Mic className="h-4.5 w-4.5" />}
                                                </button>
                                            ) : null}
                                            <button
                                                type="submit"
                                                disabled={(!String(inputValue || '').trim() && attachments.length === 0) || isLoading}
                                                className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-cyan-400 text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
                                                aria-label="Send message"
                                            >
                                                <ArrowUp className="h-5 w-5" />
                                            </button>
                                        </div>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
};

export default AssistantPage;
