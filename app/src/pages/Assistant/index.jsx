import { useMemo } from 'react';
import {
    ArrowUp,
    Mic,
    MicOff,
    Paperclip,
    Pin,
    Plus,
    Search,
    Sparkles,
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import ActionBar from '@/components/features/chat/ActionBar';
import MessageList from '@/components/features/chat/MessageList';
import { useAssistantController } from '@/components/features/chat/useAssistantController';
import AssistantDisabledState from './components/AssistantDisabledState';
import { useSpeechInput } from '@/hooks/useSpeechInput';
import { cn } from '@/lib/utils';
import { isAssistantV2Enabled } from '@/services/assistantFeatureFlags';
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

const AssistantPage = () => {
    const assistantEnabled = isAssistantV2Enabled();
    const location = useLocation();
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
    const modeLabel = MODE_COPY[mode] || MODE_COPY.explore;
    const contextChips = [
        { id: 'route', label: routeLabel },
        { id: 'path', label: originPath },
        { id: 'cart', label: `Cart ${cartSummary.totalItems || 0}` },
        { id: 'auth', label: context.isAuthenticated ? 'Signed in' : 'Guest' },
        { id: 'state', label: status === 'thinking' ? 'Analyzing' : modeLabel },
    ];

    if (!assistantEnabled) {
        return <AssistantDisabledState />;
    }

    return (
        <div className="min-h-screen bg-[#0b0f14] text-slate-100">
            <div className="mx-auto flex min-h-screen max-w-[1600px]">
                <aside className="flex w-full max-w-[300px] flex-col border-r border-white/10 bg-[#0f172a] px-4 py-5">
                    <div className="flex items-center gap-3 border-b border-white/10 pb-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-cyan-200">
                            <Sparkles className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-white">Aura Terminal</p>
                            <p className="text-xs text-slate-400">Controlled assistant surface</p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => {
                            stopListening();
                            resetConversation();
                            window.requestAnimationFrame(() => inputRef.current?.focus());
                        }}
                        className="mt-4 inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
                    >
                        <Plus className="h-4 w-4" />
                        New chat
                    </button>

                    <label className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-300">
                        <Search className="h-4 w-4 text-slate-500" />
                        <input
                            value={sessionSearchQuery}
                            onChange={(event) => setSessionSearchQuery(event.target.value)}
                            placeholder="Search conversations"
                            className="w-full bg-transparent outline-none placeholder:text-slate-500"
                        />
                    </label>

                    <div className="mt-5 flex-1 space-y-5 overflow-y-auto pr-1">
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
                                                onClick={() => setActiveSession(session.id)}
                                                className={cn(
                                                    'flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition',
                                                    isActive
                                                        ? 'border-cyan-400/30 bg-cyan-400/10'
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
                    </div>
                </aside>

                <main className="flex min-h-screen min-w-0 flex-1 flex-col">
                    <header className="border-b border-white/10 bg-[#0b0f14]/90 px-6 py-5 backdrop-blur">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">
                                    Controlled Terminal
                                </p>
                                <h1 className="mt-2 text-2xl font-semibold text-white">
                                    {activeSession?.title || 'New chat'}
                                </h1>
                                <p className="mt-2 max-w-2xl text-sm text-slate-400">
                                    Fast answers stay responsive, refined answers upgrade in place, and conversation state stays stable.
                                </p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {contextChips.map((chip) => (
                                    <span
                                        key={chip.id}
                                        className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300"
                                    >
                                        {chip.label}
                                    </span>
                                ))}
                            </div>
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
                    </header>

                    <div className="flex min-h-0 flex-1 flex-col">
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

                        <div className="border-t border-white/10 bg-[#0b0f14] px-6 py-5">
                            <div className="mx-auto w-full max-w-5xl">
                                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                    <span className="rounded-full border border-white/10 px-2.5 py-1">Enter to send</span>
                                    <span className="rounded-full border border-white/10 px-2.5 py-1">Shift+Enter for newline</span>
                                    <span className="rounded-full border border-white/10 px-2.5 py-1">Attachments soon</span>
                                </div>

                                <form
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        if (!String(inputValue || '').trim()) {
                                            return;
                                        }
                                        if (isListening) {
                                            stopListening();
                                        }
                                        void handleUserInput(inputValue);
                                    }}
                                    className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-3 shadow-[0_20px_80px_rgba(0,0,0,0.25)]"
                                >
                                    <div className="flex items-end gap-3">
                                        <button
                                            type="button"
                                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/[0.08]"
                                            aria-label="Attachment placeholder"
                                        >
                                            <Paperclip className="h-4.5 w-4.5" />
                                        </button>

                                        <textarea
                                            ref={inputRef}
                                            value={inputValue}
                                            onChange={(event) => setInputValue(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' && !event.shiftKey) {
                                                    event.preventDefault();
                                                    if (String(inputValue || '').trim()) {
                                                        if (isListening) {
                                                            stopListening();
                                                        }
                                                        void handleUserInput(inputValue);
                                                    }
                                                }
                                            }}
                                            rows={Math.min(Math.max(String(inputValue || '').split('\n').length, 1), 6)}
                                            placeholder={isListening ? 'Listening...' : 'Ask anything. I will keep the state controlled.'}
                                            disabled={isLoading}
                                            className="max-h-44 min-h-[56px] flex-1 resize-none bg-transparent px-1 py-2 text-base text-white outline-none placeholder:text-slate-500"
                                        />

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
                                                disabled={!String(inputValue || '').trim() || isLoading}
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
