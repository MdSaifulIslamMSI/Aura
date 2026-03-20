import React, {
    startTransition,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    ArrowUpRight,
    Bot,
    ChevronRight,
    Command,
    Compass,
    Cpu,
    Gauge,
    Heart,
    Maximize2,
    MessageCircle,
    Mic,
    MicOff,
    Minimize2,
    Package,
    Percent,
    Search,
    Send,
    ShieldCheck,
    ShoppingCart,
    Sparkles,
    Star,
    Trash2,
    TrendingUp,
    UserRound,
    Wand2,
    X,
    Zap,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import VoiceSearch from '@/components/shared/VoiceSearch';
import { AuthContext } from '@/context/AuthContext';
import { CartContext } from '@/context/CartContext';
import { useColorMode } from '@/context/ColorModeContext';
import { WishlistContext } from '@/context/WishlistContext';
import { cn } from '@/lib/utils';
import { chatApi } from '@/services/chatApi';
import {
    ASSISTANT_COMMAND_HINTS,
    buildAssistantRequestPayload,
    buildLocalAssistantResponse,
    getAssistantRouteLabel,
} from '@/utils/assistantCommands';

const SESSION_KEY = 'aura-chatbot-session-v3';
const MAX_PERSISTED_MESSAGES = 24;
const MAX_HISTORY_ENTRIES = 12;
const AUTO_EXECUTE_DELAY_MS = 160;

const renderAssistantText = (text, isWhiteMode) => {
    const paragraphs = String(text || '')
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

    return (
        <div
            className={cn(
                'space-y-3 text-sm leading-7',
                isWhiteMode ? 'text-slate-700' : 'text-slate-200'
            )}
        >
            {(paragraphs.length > 0 ? paragraphs : [String(text || '')]).map((paragraph, index) => (
                <p key={`assistant-paragraph-${index}`} className="whitespace-pre-wrap break-words">
                    {paragraph}
                </p>
            ))}
        </div>
    );
};

const MODE_OPTIONS = [
    {
        id: 'chat',
        label: 'Concierge',
        hint: 'Fast answers, live catalog guidance, route-aware help.',
        Icon: Sparkles,
    },
    {
        id: 'compare',
        label: 'Compare',
        hint: 'Use recent product candidates to pick the strongest option.',
        Icon: TrendingUp,
    },
    {
        id: 'bundle',
        label: 'Bundle',
        hint: 'Build setups around price ceilings and mission goals.',
        Icon: Package,
    },
];

const createMessageId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const trimMessages = (items = []) => items.slice(-MAX_PERSISTED_MESSAGES);
const trimHistory = (items = []) => items.slice(-MAX_HISTORY_ENTRIES);

const getPathLabel = (path = '/') => {
    if (path === '/') return 'Home';
    if (path.startsWith('/deals')) return 'Deals';
    if (path.startsWith('/trending')) return 'Trending';
    if (path.startsWith('/new-arrivals')) return 'New arrivals';
    if (path.startsWith('/marketplace')) return 'Marketplace';
    if (path.startsWith('/visual-search')) return 'Visual search';
    if (path.startsWith('/mission-control')) return 'Mission Control';
    if (path.startsWith('/bundles')) return 'Bundles';
    if (path.startsWith('/compare')) return 'Compare';
    if (path.startsWith('/cart')) return 'Cart';
    if (path.startsWith('/wishlist')) return 'Wishlist';
    if (path.startsWith('/orders')) return 'Orders';
    if (path.startsWith('/profile')) return 'Profile';
    if (path.startsWith('/category/')) return 'Category';
    if (path.startsWith('/search')) return 'Search';
    if (path.startsWith('/product/')) return 'Product';
    return 'Route';
};

const createAssistantMessage = (payload = {}) => ({
    id: createMessageId(),
    role: 'assistant',
    text: '',
    products: [],
    suggestions: [],
    actions: [],
    actionType: 'assistant',
    provider: 'local',
    mode: 'chat',
    latencyMs: 0,
    local: false,
    createdAt: Date.now(),
    ...payload,
});

const createUserMessage = (text) => ({
    id: createMessageId(),
    role: 'user',
    text,
    createdAt: Date.now(),
});

const createInitialMessage = () => createAssistantMessage({
    text: 'Aura Command is live. I can reason through products, compare options, build bundles, and guide decisions in-chat. I only open routes when you explicitly ask me to.',
    suggestions: ASSISTANT_COMMAND_HINTS.slice(0, 4),
    actionType: 'greeting',
    provider: 'local',
    local: true,
});

const readSession = () => {
    if (typeof window === 'undefined') return null;

    try {
        const raw = window.localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed?.messages) || !Array.isArray(parsed?.conversationHistory)) {
            return null;
        }

        return {
            messages: trimMessages(parsed.messages).map((message) => ({
                ...message,
                id: message.id || createMessageId(),
            })),
            conversationHistory: trimHistory(parsed.conversationHistory),
            activeMode: MODE_OPTIONS.some((mode) => mode.id === parsed.activeMode) ? parsed.activeMode : 'chat',
        };
    } catch {
        return null;
    }
};

const serializeSession = ({ messages, conversationHistory, activeMode }) => {
    if (typeof window === 'undefined') return;

    const payload = {
        messages: trimMessages(messages),
        conversationHistory: trimHistory(conversationHistory),
        activeMode,
    };

    window.localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
};

const getActionLabel = (action = {}) => {
    switch (action.type) {
        case 'navigate':
            return `Open ${getPathLabel(action.path)}`;
        case 'search':
            return `Search "${action.query}"`;
        case 'open_product':
            return 'Open product';
        case 'open_voice_assistant':
            return 'Voice mode';
        case 'close':
            return 'Close chat';
        default:
            return 'Run action';
    }
};

const getActionTone = (actionType = '') => {
    switch (actionType) {
        case 'deals':
            return {
                Icon: Percent,
                label: 'Deals',
                className: 'bg-rose-500/15 text-rose-200 border-rose-400/20',
            };
        case 'trending':
            return {
                Icon: TrendingUp,
                label: 'Trending',
                className: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/20',
            };
        case 'compare':
            return {
                Icon: Gauge,
                label: 'Compare',
                className: 'bg-indigo-500/15 text-indigo-200 border-indigo-400/20',
            };
        case 'greeting':
            return {
                Icon: ShieldCheck,
                label: 'Premium',
                className: 'bg-cyan-500/15 text-cyan-100 border-cyan-300/20',
            };
        default:
            return {
                Icon: Wand2,
                label: 'Assistant',
                className: 'bg-violet-500/15 text-violet-100 border-violet-300/20',
            };
    }
};

const buildCommandDeck = ({ pathname, cartCount, wishlistCount }) => {
    const routePrompt = pathname.startsWith('/marketplace')
        ? 'Scout the most compelling marketplace listings'
        : pathname.startsWith('/product/')
            ? 'Find the strongest alternative to this product'
            : pathname.startsWith('/products') || pathname.startsWith('/category') || pathname.startsWith('/search')
                ? 'Summarize the strongest products in this lane'
                : 'Show the best deals today';

    return [
        {
            id: 'deals',
            title: 'Deal Pulse',
            description: 'Surface the sharpest live discounts instantly.',
            prompt: 'Show the best deals today',
            Icon: Percent,
            accent: 'from-rose-500/25 via-orange-500/20 to-transparent',
        },
        {
            id: 'route',
            title: 'Route Intel',
            description: 'Use the current page as live shopping context.',
            prompt: routePrompt,
            Icon: Sparkles,
            accent: 'from-cyan-500/25 via-sky-500/20 to-transparent',
        },
        {
            id: 'bundle',
            title: 'Bundle Architect',
            description: 'Build a premium setup around a hard budget.',
            prompt: 'Build a gaming bundle under Rs 80000',
            Icon: Package,
            accent: 'from-violet-500/25 via-fuchsia-500/20 to-transparent',
        },
        {
            id: 'marketplace',
            title: 'Marketplace Radar',
            description: 'Jump into local discovery and seller scouting.',
            prompt: 'Open marketplace',
            Icon: Compass,
            accent: 'from-emerald-500/25 via-teal-500/20 to-transparent',
        },
        {
            id: 'cart',
            title: cartCount > 0 ? 'Cart Concierge' : 'Next Purchase',
            description: cartCount > 0
                ? `Open your cart and tighten the final decision around ${cartCount} item${cartCount > 1 ? 's' : ''}.`
                : 'Move from browsing to a high-intent shopping lane.',
            prompt: cartCount > 0 ? 'Open cart' : 'Search for premium headphones under Rs 15000',
            Icon: ShoppingCart,
            accent: 'from-indigo-500/25 via-blue-500/20 to-transparent',
        },
        {
            id: 'wishlist',
            title: wishlistCount > 0 ? 'Wishlist Focus' : 'Voice Sprint',
            description: wishlistCount > 0
                ? `Re-open your ${wishlistCount} saved pick${wishlistCount > 1 ? 's' : ''} and decide faster.`
                : 'Launch the hands-free voice control surface.',
            prompt: wishlistCount > 0 ? 'Open wishlist' : 'Open voice assistant',
            Icon: wishlistCount > 0 ? Heart : Mic,
            accent: 'from-pink-500/25 via-purple-500/20 to-transparent',
        },
    ];
};

const ChatBot = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { colorMode } = useColorMode();
    const { currentUser, isAuthenticated } = useContext(AuthContext);
    const { cartItems = [], addToCart } = useContext(CartContext);
    const { wishlistItems = [] } = useContext(WishlistContext);

    const restoredSession = useMemo(() => readSession(), []);
    const [isOpen, setIsOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [showVoiceAssistant, setShowVoiceAssistant] = useState(false);
    const [messages, setMessages] = useState(() => restoredSession?.messages?.length > 0 ? restoredSession.messages : [createInitialMessage()]);
    const [conversationHistory, setConversationHistory] = useState(() => restoredSession?.conversationHistory || []);
    const [activeMode, setActiveMode] = useState(() => restoredSession?.activeMode || 'chat');
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);

    const inputRef = useRef(null);
    const messagesEndRef = useRef(null);
    const recognitionRef = useRef(null);

    const isWhiteMode = colorMode === 'white';
    const routeLabel = getAssistantRouteLabel(location.pathname);
    const latestAssistantMessage = useMemo(
        () => [...messages].reverse().find((message) => message.role === 'assistant') || null,
        [messages]
    );
    const latestProductPool = useMemo(
        () => [...messages].reverse().find((message) => Array.isArray(message.products) && message.products.length > 0)?.products || [],
        [messages]
    );
    const commandDeck = useMemo(
        () => buildCommandDeck({
            pathname: location.pathname,
            cartCount: cartItems.length,
            wishlistCount: wishlistItems.length,
        }),
        [cartItems.length, location.pathname, wishlistItems.length]
    );
    const launcherHint = latestAssistantMessage?.suggestions?.[0] || routeLabel;

    const shellClass = isWhiteMode
        ? 'border-slate-200/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(239,244,255,0.97))] text-slate-950 shadow-[0_24px_80px_rgba(15,23,42,0.18)]'
        : 'border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_26%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.18),transparent_25%),linear-gradient(180deg,rgba(6,10,24,0.98),rgba(10,14,28,0.98))] text-slate-100 shadow-[0_28px_90px_rgba(2,6,23,0.72)]';
    const panelClass = isWhiteMode
        ? 'border-slate-200/80 bg-white/75'
        : 'border-white/10 bg-white/[0.045]';
    const mutedTextClass = isWhiteMode ? 'text-slate-500' : 'text-slate-400';
    const strongTextClass = isWhiteMode ? 'text-slate-950' : 'text-slate-100';

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, []);

    const executeAssistantAction = useCallback((action = {}) => {
        if (!action?.type) return;

        switch (action.type) {
            case 'close':
                setIsOpen(false);
                return;
            case 'open_voice_assistant':
                setShowVoiceAssistant(true);
                return;
            case 'open_product':
                if (action.productId) {
                    navigate(`/product/${action.productId}`);
                }
                return;
            case 'navigate':
                if (action.path) {
                    navigate(action.path);
                }
                return;
            case 'search':
                if (action.query) {
                    navigate(`/search?q=${encodeURIComponent(action.query)}`);
                }
                return;
            default:
                return;
        }
    }, [navigate]);

    useEffect(() => {
        scrollToBottom();
    }, [messages, isExpanded, isOpen, scrollToBottom]);

    useEffect(() => {
        if (!isOpen) return;
        setUnreadCount(0);
        window.requestAnimationFrame(() => inputRef.current?.focus());
    }, [isOpen]);

    useEffect(() => {
        serializeSession({ messages, conversationHistory, activeMode });
    }, [activeMode, conversationHistory, messages]);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                setIsOpen(true);
            }

            if (event.key === 'Escape') {
                if (showVoiceAssistant) {
                    setShowVoiceAssistant(false);
                } else if (isOpen) {
                    setIsOpen(false);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, showVoiceAssistant]);

    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return undefined;

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-IN';

        recognition.onresult = (event) => {
            const transcript = Array.from(event.results)
                .map((result) => result[0]?.transcript || '')
                .join('');
            setInput(transcript);
        };

        recognition.onerror = () => {
            setIsListening(false);
        };

        recognition.onend = () => {
            setIsListening(false);
        };

        recognitionRef.current = recognition;
        return () => {
            recognition.stop();
        };
    }, []);

    const appendAssistantMessage = useCallback((assistantMessage) => {
        startTransition(() => {
            setMessages((previous) => trimMessages([...previous, assistantMessage]));
        });

        if (!isOpen) {
            setUnreadCount((value) => value + 1);
        }
    }, [isOpen]);

    const appendUserMessage = useCallback((text) => {
        startTransition(() => {
            setMessages((previous) => trimMessages([...previous, createUserMessage(text)]));
        });
    }, []);

    const handleClearChat = useCallback(() => {
        setMessages([createInitialMessage()]);
        setConversationHistory([]);
        setActiveMode('chat');
    }, []);

    const toggleListening = useCallback(() => {
        if (!recognitionRef.current) {
            setShowVoiceAssistant(true);
            return;
        }

        if (isListening) {
            recognitionRef.current.stop();
            setIsListening(false);
            return;
        }

        setInput('');
        recognitionRef.current.start();
        setIsListening(true);
    }, [isListening]);

    const handleSend = useCallback(async (rawText, options = {}) => {
        const messageText = typeof rawText === 'string' ? rawText : input;
        const cleanedText = String(messageText || '').trim();
        if (!cleanedText) return;

        if (isListening) {
            recognitionRef.current?.stop();
            setIsListening(false);
        }

        appendUserMessage(cleanedText);
        setInput('');

        const nextHistory = trimHistory([...conversationHistory, { role: 'user', content: cleanedText }]);
        const localResponse = buildLocalAssistantResponse(cleanedText, {
            cartCount: cartItems.length,
            wishlistCount: wishlistItems.length,
        });

        if (localResponse?.local) {
            const assistantMessage = createAssistantMessage({
                text: localResponse.answer,
                suggestions: localResponse.suggestions || [],
                actions: localResponse.actions || [],
                actionType: localResponse.actionType || 'assistant',
                provider: 'local',
                local: true,
                mode: 'chat',
            });

            appendAssistantMessage(assistantMessage);
            setConversationHistory(trimHistory([...nextHistory, { role: 'assistant', content: assistantMessage.text }]));

            if (localResponse.autoExecute && localResponse.actions?.[0]) {
                window.setTimeout(() => executeAssistantAction(localResponse.actions[0]), AUTO_EXECUTE_DELAY_MS);
            }
            return;
        }

        const requestConfig = buildAssistantRequestPayload({
            message: cleanedText,
            selectedMode: options.modeOverride || activeMode,
            pathname: location.pathname,
            latestProducts: latestProductPool,
            cartItems,
            wishlistItems,
        });

        setIsLoading(true);

        try {
            const response = await chatApi.sendMessage({
                message: cleanedText,
                conversationHistory: nextHistory,
                assistantMode: requestConfig.assistantMode,
                context: requestConfig.context,
            });

            const assistantText = response.text || 'Aura Command is temporarily unavailable. Try again in a moment.';
            const assistantMessage = createAssistantMessage({
                text: assistantText,
                products: response.products || [],
                suggestions: response.suggestions || [],
                actions: response.actions || [],
                actionType: response.actionType || 'assistant',
                provider: response.provider || 'local',
                mode: response.mode || requestConfig.assistantMode,
                latencyMs: response.latencyMs || 0,
                local: false,
            });

            appendAssistantMessage(assistantMessage);
            setConversationHistory(trimHistory([...nextHistory, { role: 'assistant', content: assistantText }]));
        } catch {
            const fallbackMessage = createAssistantMessage({
                text: 'Aura Command hit turbulence while reaching the AI layer. Try again, or use the instant quick actions while the connection settles.',
                suggestions: ['Show the best deals today', 'Open marketplace', 'Open voice assistant'],
                actionType: 'assistant',
                provider: 'local',
                local: true,
            });
            appendAssistantMessage(fallbackMessage);
            setConversationHistory(trimHistory([...nextHistory, { role: 'assistant', content: fallbackMessage.text }]));
        } finally {
            setIsLoading(false);
        }
    }, [
        activeMode,
        appendAssistantMessage,
        appendUserMessage,
        cartItems,
        conversationHistory,
        executeAssistantAction,
        input,
        isListening,
        latestProductPool,
        location.pathname,
        wishlistItems,
    ]);

    const handleSuggestionClick = useCallback((suggestion) => {
        handleSend(suggestion);
    }, [handleSend]);

    const handleAddToCart = useCallback((product, event) => {
        event.stopPropagation();
        addToCart({
            id: product.id,
            title: product.title,
            price: product.price,
            originalPrice: product.originalPrice,
            discountPercentage: product.discountPercentage,
            image: product.image,
            stock: product.stock || 10,
            brand: product.brand,
        });
    }, [addToCart]);

    const handleDeckClick = useCallback((entry) => {
        handleSend(entry.prompt);
    }, [handleSend]);

    const handleSubmit = useCallback((event) => {
        event.preventDefault();
        handleSend(input);
    }, [handleSend, input]);

    const portalTarget = typeof document !== 'undefined' ? document.body : null;
    if (!portalTarget) return null;

    return createPortal(
        <div className="pointer-events-none fixed inset-0 z-[2147483600] flex items-end justify-end p-4 sm:p-6">
            {isOpen ? (
                <div
                    className={cn(
                        'pointer-events-auto flex min-h-0 flex-col overflow-hidden rounded-[2rem] border backdrop-blur-2xl transition-all duration-300',
                        shellClass,
                        isExpanded
                            ? 'h-[min(88vh,840px)] w-[min(95vw,1080px)]'
                            : 'h-[min(70vh,620px)] w-[min(92vw,430px)]'
                    )}
                >
                    <div className="border-b border-white/10 px-4 py-3.5 sm:px-5 sm:py-4">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3">
                                <div className={cn(
                                    'flex h-12 w-12 items-center justify-center rounded-2xl border shadow-[0_0_30px_rgba(56,189,248,0.18)]',
                                    isWhiteMode
                                        ? 'border-cyan-200 bg-gradient-to-br from-cyan-500/15 to-indigo-500/15 text-cyan-700'
                                        : 'border-cyan-400/20 bg-gradient-to-br from-cyan-400/15 to-violet-500/20 text-cyan-200'
                                )}>
                                    <Bot className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className={cn('text-base font-black tracking-wide', strongTextClass)}>Aura Command</h3>
                                        {isExpanded ? (
                                            <span className={cn(
                                                'rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]',
                                                isWhiteMode
                                                    ? 'border-cyan-200 bg-cyan-500/10 text-cyan-700'
                                                    : 'border-cyan-400/20 bg-cyan-500/10 text-cyan-200'
                                            )}>
                                                Premium AI
                                            </span>
                                        ) : null}
                                    </div>
                                    <p className={cn('mt-1 text-sm', mutedTextClass)}>
                                        {isExpanded
                                            ? 'Faster shopping intelligence with instant actions, voice entry, and route-aware context.'
                                            : 'Fast help for search, deals, compare, and bundle decisions.'}
                                    </p>
                                    {isExpanded ? (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', panelClass)}>
                                                <Command className="mr-1 inline h-3.5 w-3.5" />
                                                Cmd/Ctrl + K
                                            </span>
                                            <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', panelClass)}>
                                                <Cpu className="mr-1 inline h-3.5 w-3.5" />
                                                {latestAssistantMessage?.provider || 'local'}
                                            </span>
                                            <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', panelClass)}>
                                                <Gauge className="mr-1 inline h-3.5 w-3.5" />
                                                {latestAssistantMessage?.latencyMs ? `${latestAssistantMessage.latencyMs} ms` : 'ready'}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-semibold', panelClass)}>
                                                {routeLabel} · {MODE_OPTIONS.find((mode) => mode.id === activeMode)?.label}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowVoiceAssistant(true)}
                                    className={cn('rounded-2xl border p-3 transition-colors', panelClass)}
                                    title="Open voice assistant"
                                >
                                    <Mic className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={handleClearChat}
                                    className={cn('rounded-2xl border p-3 transition-colors', panelClass)}
                                    title="Clear chat"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsExpanded((value) => !value)}
                                    className={cn('hidden rounded-2xl border p-3 transition-colors sm:block', panelClass)}
                                    title={isExpanded ? 'Minimize chat' : 'Expand chat'}
                                >
                                    {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsOpen(false)}
                                    className={cn('rounded-2xl border p-3 transition-colors', panelClass)}
                                    title="Close chat"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className={cn('grid min-h-0 flex-1', isExpanded ? 'lg:grid-cols-[280px_minmax(0,1fr)]' : 'grid-cols-1')}>
                        {isExpanded ? (
                            <aside className={cn('hidden border-r px-4 py-4 lg:flex lg:flex-col lg:gap-4', panelClass)}>
                                <div className={cn('rounded-[1.5rem] border p-4', panelClass)}>
                                    <p className={cn('text-[11px] font-black uppercase tracking-[0.18em]', mutedTextClass)}>Live Context</p>
                                    <div className="mt-4 space-y-3">
                                        <div>
                                            <p className={cn('text-[11px] font-semibold uppercase tracking-[0.16em]', mutedTextClass)}>Route</p>
                                            <p className={cn('mt-1 text-sm font-bold', strongTextClass)}>{routeLabel}</p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className={cn('rounded-2xl border p-3', panelClass)}>
                                                <p className={cn('text-[10px] uppercase tracking-[0.18em]', mutedTextClass)}>Cart</p>
                                                <p className={cn('mt-1 text-2xl font-black', strongTextClass)}>{cartItems.length}</p>
                                            </div>
                                            <div className={cn('rounded-2xl border p-3', panelClass)}>
                                                <p className={cn('text-[10px] uppercase tracking-[0.18em]', mutedTextClass)}>Wishlist</p>
                                                <p className={cn('mt-1 text-2xl font-black', strongTextClass)}>{wishlistItems.length}</p>
                                            </div>
                                        </div>
                                        <div className={cn('rounded-2xl border p-3', panelClass)}>
                                            <p className={cn('text-[10px] uppercase tracking-[0.18em]', mutedTextClass)}>Identity</p>
                                            <p className={cn('mt-1 text-sm font-bold', strongTextClass)}>
                                                {isAuthenticated ? currentUser?.displayName || currentUser?.email || 'Signed in' : 'Guest mode'}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className={cn('rounded-[1.5rem] border p-4', panelClass)}>
                                    <p className={cn('text-[11px] font-black uppercase tracking-[0.18em]', mutedTextClass)}>Quick Missions</p>
                                    <div className="mt-4 space-y-3">
                                        {commandDeck.map((entry) => (
                                            <button
                                                key={entry.id}
                                                type="button"
                                                onClick={() => handleDeckClick(entry)}
                                                className={cn(
                                                    'group relative overflow-hidden rounded-2xl border p-4 text-left transition-transform hover:-translate-y-0.5',
                                                    panelClass
                                                )}
                                            >
                                                <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br opacity-80', entry.accent)} />
                                                <div className="relative flex items-start justify-between gap-3">
                                                    <div>
                                                        <p className={cn('text-sm font-black', strongTextClass)}>{entry.title}</p>
                                                        <p className={cn('mt-1 text-xs leading-5', mutedTextClass)}>{entry.description}</p>
                                                    </div>
                                                    <entry.Icon className="h-4 w-4 flex-shrink-0" />
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </aside>
                        ) : null}

                        <section className="flex min-h-0 flex-col">
                            <div className="border-b border-white/10 px-4 py-4">
                                <div className="flex flex-col gap-3">
                                    <div className="flex flex-wrap gap-2">
                                        {MODE_OPTIONS.map((mode) => (
                                            <button
                                                key={mode.id}
                                                type="button"
                                                onClick={() => setActiveMode(mode.id)}
                                                className={cn(
                                                    'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black uppercase tracking-[0.16em] transition-colors',
                                                    activeMode === mode.id
                                                        ? isWhiteMode
                                                            ? 'border-slate-950 bg-slate-950 text-white'
                                                            : 'border-cyan-300/30 bg-cyan-400/12 text-cyan-100'
                                                        : panelClass
                                                )}
                                                title={mode.hint}
                                            >
                                                <mode.Icon className="h-3.5 w-3.5" />
                                                {mode.label}
                                            </button>
                                        ))}
                                    </div>
                                    {isExpanded ? (
                                        <div className={cn('text-xs font-semibold', mutedTextClass)}>
                                            {MODE_OPTIONS.find((mode) => mode.id === activeMode)?.hint}
                                        </div>
                                    ) : null}
                                </div>

                                {!isExpanded ? (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {commandDeck.slice(0, 3).map((entry) => (
                                            <button
                                                key={entry.id}
                                                type="button"
                                                onClick={() => handleDeckClick(entry)}
                                                className={cn(
                                                    'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors',
                                                    panelClass
                                                )}
                                            >
                                                <entry.Icon className="h-3.5 w-3.5 flex-shrink-0" />
                                                <span>{entry.title}</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : null}
                            </div>

                            <div className="flex-1 overflow-y-auto px-4 py-5">
                                <div className="space-y-5">
                                    {messages.map((message) => {
                                        const tone = getActionTone(message.actionType);
                                        return (
                                            <div
                                                key={message.id}
                                                className={cn('flex flex-col gap-3', message.role === 'user' ? 'items-end' : 'items-start')}
                                            >
                                                <div
                                                    className={cn(
                                                        'max-w-[92%] rounded-[1.5rem] border px-4 py-3 shadow-sm',
                                                        message.role === 'user'
                                                            ? isWhiteMode
                                                                ? 'border-slate-950 bg-slate-950 text-white'
                                                                : 'border-cyan-400/20 bg-gradient-to-br from-cyan-500/20 to-violet-500/25 text-slate-50'
                                                            : panelClass
                                                    )}
                                                >
                                                    {message.role === 'assistant' && isExpanded ? (
                                                        <div className="mb-3 flex flex-wrap items-center gap-2">
                                                            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]', tone.className)}>
                                                                <tone.Icon className="h-3 w-3" />
                                                                {tone.label}
                                                            </span>
                                                            <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]', panelClass)}>
                                                                {message.local ? 'instant' : (message.provider || 'local')}
                                                            </span>
                                                            {message.latencyMs ? (
                                                                <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]', panelClass)}>
                                                                    {message.latencyMs} ms
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                    ) : null}

                                                    {message.role === 'assistant' && !isExpanded ? (
                                                        <div className="mb-3">
                                                            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]', tone.className)}>
                                                                <tone.Icon className="h-3 w-3" />
                                                                {tone.label}
                                                            </span>
                                                        </div>
                                                    ) : null}

                                                    {message.role === 'assistant' ? (
                                                        renderAssistantText(message.text, isWhiteMode)
                                                    ) : (
                                                        <p className="text-sm leading-7">{message.text}</p>
                                                    )}
                                                </div>

                                                {Array.isArray(message.actions) && message.actions.length > 0 ? (
                                                    <div className="flex max-w-[92%] flex-wrap gap-2">
                                                        {message.actions.map((action, index) => (
                                                            <button
                                                                key={`${message.id}-action-${index}`}
                                                                type="button"
                                                                onClick={() => executeAssistantAction(action)}
                                                                className={cn(
                                                                    'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black uppercase tracking-[0.16em] transition-colors',
                                                                    panelClass
                                                                )}
                                                            >
                                                                {getActionLabel(action)}
                                                                <ArrowUpRight className="h-3.5 w-3.5" />
                                                            </button>
                                                        ))}
                                                    </div>
                                                ) : null}

                                                {Array.isArray(message.products) && message.products.length > 0 ? (
                                                    <div className="grid w-full gap-3">
                                                        {message.products.slice(0, isExpanded ? 6 : 3).map((product, index) => (
                                                            <button
                                                                key={product._id || product.id || `${message.id}-product-${index}`}
                                                                type="button"
                                                                onClick={() => navigate(`/product/${product.id || product._id}`)}
                                                                className={cn('group flex w-full items-center gap-4 rounded-[1.4rem] border p-3 text-left transition-transform hover:-translate-y-0.5', panelClass)}
                                                            >
                                                                <div className={cn('flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl border p-2', panelClass)}>
                                                                    <img
                                                                        src={product.image}
                                                                        alt={product.title}
                                                                        className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-105"
                                                                    />
                                                                </div>
                                                                <div className="min-w-0 flex-1">
                                                                    <p className={cn('truncate text-sm font-bold', strongTextClass)}>{product.title}</p>
                                                                    <div className="mt-1 flex flex-wrap items-center gap-2">
                                                                        <span className="text-sm font-black text-emerald-400">
                                                                            Rs {Number(product.price || 0).toLocaleString('en-IN')}
                                                                        </span>
                                                                        {Number(product.originalPrice || 0) > Number(product.price || 0) ? (
                                                                            <span className="text-xs text-slate-500 line-through">
                                                                                Rs {Number(product.originalPrice || 0).toLocaleString('en-IN')}
                                                                            </span>
                                                                        ) : null}
                                                                        {product.rating ? (
                                                                            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold', panelClass)}>
                                                                                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                                                                                {product.rating}
                                                                            </span>
                                                                        ) : null}
                                                                    </div>
                                                                    <div className="mt-2 flex items-center justify-between gap-3">
                                                                        <span className={cn('truncate text-xs', mutedTextClass)}>
                                                                            {product.brand || 'Aura catalog'}
                                                                        </span>
                                                                        <button
                                                                            type="button"
                                                                            onClick={(event) => handleAddToCart(product, event)}
                                                                            className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.16em]', panelClass)}
                                                                        >
                                                                            <ShoppingCart className="h-3.5 w-3.5" />
                                                                            Add
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                ) : null}

                                                {message.role === 'assistant' && Array.isArray(message.suggestions) && message.suggestions.length > 0 && message.id === messages[messages.length - 1]?.id ? (
                                                    <div className="flex max-w-[92%] flex-wrap gap-2">
                                                        {message.suggestions.map((suggestion, index) => (
                                                            <button
                                                                key={`${message.id}-suggestion-${index}`}
                                                                type="button"
                                                                onClick={() => handleSuggestionClick(suggestion)}
                                                                className={cn('rounded-full border px-3 py-2 text-xs font-semibold transition-colors', panelClass)}
                                                            >
                                                                {suggestion}
                                                            </button>
                                                        ))}
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })}

                                    {isLoading ? (
                                        <div className="flex items-start">
                                            <div className={cn('rounded-[1.5rem] border px-4 py-3', panelClass)}>
                                                <div className="flex items-center gap-2">
                                                    <span className="h-2 w-2 animate-bounce rounded-full bg-cyan-400" />
                                                    <span className="h-2 w-2 animate-bounce rounded-full bg-violet-400 [animation-delay:120ms]" />
                                                    <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-400 [animation-delay:240ms]" />
                                                </div>
                                            </div>
                                        </div>
                                    ) : null}

                                    <div ref={messagesEndRef} />
                                </div>
                            </div>

                            <div className="border-t border-white/10 px-4 py-4">
                                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                                    {isExpanded ? (
                                        <>
                                            <div className={cn('flex flex-wrap items-center gap-2 text-xs font-semibold', mutedTextClass)}>
                                                <span className={cn('rounded-full border px-2.5 py-1', panelClass)}>
                                                    <Search className="mr-1 inline h-3.5 w-3.5" />
                                                    {routeLabel}
                                                </span>
                                                <span className={cn('rounded-full border px-2.5 py-1', panelClass)}>
                                                    <ShoppingCart className="mr-1 inline h-3.5 w-3.5" />
                                                    {cartItems.length} cart
                                                </span>
                                                <span className={cn('rounded-full border px-2.5 py-1', panelClass)}>
                                                    <Heart className="mr-1 inline h-3.5 w-3.5" />
                                                    {wishlistItems.length} wishlist
                                                </span>
                                                <span className={cn('rounded-full border px-2.5 py-1', panelClass)}>
                                                    <UserRound className="mr-1 inline h-3.5 w-3.5" />
                                                    {isAuthenticated ? 'signed in' : 'guest'}
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setShowVoiceAssistant(true)}
                                                className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black uppercase tracking-[0.16em]', panelClass)}
                                            >
                                                <Zap className="h-3.5 w-3.5" />
                                                Voice sprint
                                            </button>
                                        </>
                                    ) : (
                                        <div className={cn('text-xs font-semibold', mutedTextClass)}>
                                            Type a shopping task or jump in with voice.
                                        </div>
                                    )}
                                </div>

                                <form onSubmit={handleSubmit} className="flex items-end gap-3">
                                    <div className="relative flex-1">
                                        <textarea
                                            ref={inputRef}
                                            value={input}
                                            onChange={(event) => setInput(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' && !event.shiftKey) {
                                                    event.preventDefault();
                                                    handleSubmit(event);
                                                }
                                            }}
                                            placeholder={
                                                isListening
                                                    ? 'Listening...'
                                                    : activeMode === 'bundle'
                                                        ? 'Example: Build a creator setup under Rs 90000'
                                                        : activeMode === 'compare'
                                                            ? 'Example: Compare the strongest recent picks'
                                                            : 'Ask for advice, comparison, or bundles. I stay in chat unless you tell me to open something'
                                            }
                                            className={cn(
                                                'w-full resize-none rounded-[1.5rem] border px-4 py-3 pr-24 text-sm outline-none transition-colors',
                                                panelClass,
                                                isWhiteMode
                                                    ? 'placeholder:text-slate-400'
                                                    : 'placeholder:text-slate-500'
                                            )}
                                            rows={Math.min(Math.max(input.split('\n').length, 1), 5)}
                                            disabled={isLoading}
                                        />
                                        <div className="absolute bottom-2 right-2 flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={toggleListening}
                                                className={cn(
                                                    'rounded-2xl border p-2.5 transition-colors',
                                                    isListening
                                                        ? 'border-rose-400/30 bg-rose-500/10 text-rose-300'
                                                        : panelClass
                                                )}
                                                title={isListening ? 'Stop dictation' : 'Start dictation'}
                                            >
                                                {isListening ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={!input.trim() || isLoading}
                                                className={cn(
                                                    'rounded-2xl border p-2.5 transition-transform disabled:cursor-not-allowed disabled:opacity-40',
                                                    isWhiteMode
                                                        ? 'border-slate-950 bg-slate-950 text-white'
                                                        : 'border-cyan-300/25 bg-gradient-to-br from-cyan-500/20 to-violet-500/30 text-slate-50'
                                                )}
                                            >
                                                <Send className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </div>
                                </form>

                                <p className={cn('mt-3 text-[11px] font-medium', mutedTextClass)}>
                                    {isExpanded
                                        ? 'Aura Command can act fast, but still verify critical prices, stock, and policy details before checkout.'
                                        : 'Double-check price, stock, and policy details before checkout.'}
                                </p>
                            </div>
                        </section>
                    </div>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => setIsOpen(true)}
                    className={cn(
                        'pointer-events-auto relative flex items-center gap-3 rounded-full border px-4 py-3 backdrop-blur-xl transition-transform duration-300 hover:-translate-y-0.5',
                        isWhiteMode
                            ? 'border-slate-200/90 bg-white/90 text-slate-950 shadow-[0_18px_50px_rgba(15,23,42,0.12)]'
                            : 'border-cyan-400/18 bg-[linear-gradient(135deg,rgba(6,10,24,0.96),rgba(14,23,45,0.96))] text-slate-50 shadow-[0_22px_60px_rgba(2,6,23,0.58)]'
                    )}
                >
                    <div className={cn(
                        'flex h-11 w-11 items-center justify-center rounded-full border',
                        isWhiteMode
                            ? 'border-cyan-200 bg-gradient-to-br from-cyan-500/15 to-indigo-500/15 text-cyan-700'
                            : 'border-cyan-400/25 bg-gradient-to-br from-cyan-500/20 to-violet-500/25 text-cyan-100'
                    )}>
                        <MessageCircle className="h-5 w-5" />
                    </div>
                    <div className="hidden text-left sm:block">
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300">Aura Command</p>
                        <p className="max-w-[13rem] truncate text-sm font-semibold">{launcherHint}</p>
                    </div>
                    <ChevronRight className="hidden h-4 w-4 sm:block" />

                    {unreadCount > 0 ? (
                        <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-black text-white">
                            {unreadCount}
                        </span>
                    ) : null}
                </button>
            )}

            {showVoiceAssistant ? (
                <VoiceSearch
                    onClose={() => setShowVoiceAssistant(false)}
                    onResult={(query) => {
                        setShowVoiceAssistant(false);
                        handleSend(`Search for ${query}`);
                    }}
                />
            ) : null}
        </div>,
        portalTarget
    );
};

export default ChatBot;
