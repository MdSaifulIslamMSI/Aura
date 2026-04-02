import { useMemo } from 'react';
import {
    Menu,
    Maximize2,
    MessageSquarePlus,
    Mic,
    MicOff,
    Minimize2,
    Plus,
    Send,
    Sparkles,
    Wand2,
    X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import MessageList from './MessageList';
import ActionBar from './ActionBar';
import MultimodalDock from './MultimodalDock';

const STARTER_PROMPTS = [
    {
        label: 'Create image',
        prompt: 'Show premium camera phones for photography under Rs 60000',
    },
    {
        label: 'Compare picks',
        prompt: 'Compare the best laptops for coding and light gaming',
    },
    {
        label: 'Review my cart',
        prompt: 'Review my cart and tell me the smartest next step',
    },
    {
        label: 'Open support',
        prompt: 'Help me hand off an order issue to support',
    },
    {
        label: 'Boost my day',
        prompt: 'Find a fast, high-value gadget upgrade for my daily workflow',
    },
    {
        label: 'Write anything',
        prompt: 'Help me decide what to buy based on value, trust, and speed',
    },
];

const safeString = (value = '') => String(value ?? '').trim();

const formatDisplayName = (value = '') => {
    const normalized = safeString(value).split(/\s+/)[0] || 'there';
    return normalized.toUpperCase();
};

const buildRecentPrompts = (messages = []) => {
    const seen = new Set();
    return [...messages]
        .reverse()
        .filter((message) => message?.role === 'user' && safeString(message?.text))
        .map((message) => safeString(message.text))
        .filter((text) => {
            if (seen.has(text)) return false;
            seen.add(text);
            return true;
        })
        .slice(0, 7);
};

const ChatContainer = ({
    currentUserLabel = 'there',
    isWhiteMode = false,
    modeLabel = 'Explore',
    subtitle = '',
    routeLabel = 'Store',
    messages = [],
    isLoading = false,
    inputValue = '',
    isListening = false,
    supportsDictation = false,
    primaryAction = null,
    secondaryActions = [],
    inputRef,
    workspaceVariant = 'large',
    onClose,
    onSetWorkspaceVariant,
    onStartFresh,
    onInputChange,
    onSubmit,
    onToggleDictation,
    onAction,
    onStarterPrompt,
    onSelectProduct,
    onAddToCart,
    onViewDetails,
    onOpenSupport,
    onConfirmPending,
    onCancelPending,
    onModifyPending,
}) => {
    const hasConversation = useMemo(
        () => messages.some((message) => message?.role === 'user') || messages.length > 1,
        [messages]
    );
    const recentPrompts = useMemo(() => buildRecentPrompts(messages), [messages]);
    const displayName = useMemo(() => formatDisplayName(currentUserLabel), [currentUserLabel]);
    const isLargeWorkspace = workspaceVariant === 'large';

    const shellClassName = isWhiteMode
        ? 'border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.98))] text-slate-950 shadow-[0_28px_80px_rgba(15,23,42,0.16)]'
        : 'border-white/10 bg-[linear-gradient(180deg,rgba(5,7,13,0.985),rgba(6,9,16,0.985))] text-slate-100 shadow-[0_28px_90px_rgba(2,6,23,0.62)]';
    const railClassName = isWhiteMode
        ? 'border-r border-slate-200 bg-slate-50/95'
        : 'border-r border-white/8 bg-[linear-gradient(180deg,rgba(28,29,31,0.96),rgba(23,24,27,0.96))]';
    const mutedTextClass = isWhiteMode ? 'text-slate-500' : 'text-white/60';
    const composerClassName = isWhiteMode
        ? 'border-slate-200 bg-slate-100/85'
        : 'border-white/10 bg-[rgba(34,35,39,0.92)]';
    const railButtonClassName = isWhiteMode
        ? 'border-slate-200 bg-white text-slate-950 hover:bg-slate-100'
        : 'border-white/8 bg-white/[0.035] text-white/88 hover:bg-white/[0.06]';
    const activeRailButtonClassName = isWhiteMode
        ? 'border-sky-200 bg-sky-50 text-sky-900'
        : 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100';
    const primaryButtonClass = isWhiteMode
        ? 'border-slate-950 bg-slate-950 text-white hover:bg-slate-800'
        : 'border-cyan-300/25 bg-cyan-400/12 text-cyan-100 hover:bg-cyan-400/20';
    const workspaceControlClassName = isWhiteMode
        ? 'border-slate-300 bg-white text-slate-950 hover:bg-slate-100'
        : 'border-white/10 bg-white/[0.045] text-white hover:bg-white/[0.08]';
    const activeWorkspaceControlClassName = isWhiteMode
        ? 'border-sky-300 bg-sky-50 text-sky-900'
        : 'border-cyan-400/20 bg-cyan-400/12 text-cyan-100';

    const helperPrompts = recentPrompts.length > 0 ? recentPrompts : STARTER_PROMPTS.map((entry) => entry.prompt);

    const restorePrompt = (prompt) => {
        onInputChange?.(prompt);
        window.requestAnimationFrame(() => inputRef?.current?.focus());
    };

    return (
        <div
            className={cn(
                'pointer-events-auto grid min-h-0 min-w-0 grid-cols-1 overflow-hidden rounded-[2rem] border backdrop-blur-2xl',
                isLargeWorkspace
                    ? 'h-[calc(100vh-0.75rem)] w-[calc(100vw-0.75rem)] sm:h-[min(95vh,920px)] sm:w-[min(98vw,1500px)] lg:grid-cols-[320px_minmax(0,1fr)]'
                    : 'h-[min(88vh,780px)] w-[min(96vw,640px)] sm:h-[min(88vh,820px)] sm:w-[min(88vw,720px)] lg:h-[min(88vh,860px)] lg:w-[min(54vw,820px)] xl:w-[820px]',
                shellClassName
            )}
        >
            <aside className={cn('hidden min-h-0 flex-col lg:flex', !isLargeWorkspace && 'lg:hidden', railClassName)}>
                <div className="flex items-center gap-3 px-5 py-5">
                    <button
                        type="button"
                        className={cn('inline-flex h-11 w-11 items-center justify-center rounded-2xl border', railButtonClassName)}
                        aria-label="Open assistant navigation"
                    >
                        <Menu className="h-5 w-5" />
                    </button>
                    <div>
                        <p className="text-lg font-semibold tracking-tight">Aura Assistant</p>
                        <p className={cn('text-xs uppercase tracking-[0.2em]', mutedTextClass)}>Commerce Workspace</p>
                    </div>
                </div>

                <div className="px-4">
                    <button
                        type="button"
                        onClick={onStartFresh}
                        className={cn('flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-base font-semibold transition-colors', railButtonClassName)}
                    >
                        <MessageSquarePlus className="h-5 w-5" />
                        New chat
                    </button>
                </div>

                <div className="px-4 pt-6">
                    <p className={cn('px-1 text-[11px] font-black uppercase tracking-[0.22em]', mutedTextClass)}>Workspace</p>
                    <div className="mt-3 space-y-2">
                        <div className={cn('rounded-2xl border px-4 py-3', activeRailButtonClassName)}>
                            <p className="text-sm font-semibold">Shopping flow</p>
                            <p className={cn('mt-1 text-xs leading-5', isWhiteMode ? 'text-sky-800' : 'text-cyan-100/82')}>
                                Keep discovery, checkout, and support handoff in one place.
                            </p>
                        </div>
                        <div className={cn('rounded-2xl border px-4 py-3', railButtonClassName)}>
                            <p className="text-sm font-semibold">{modeLabel}</p>
                            <p className={cn('mt-1 text-xs leading-5', mutedTextClass)}>{subtitle}</p>
                        </div>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-6">
                    <p className={cn('px-1 text-[11px] font-black uppercase tracking-[0.22em]', mutedTextClass)}>Chats</p>
                    <div className="mt-3 space-y-2">
                        {recentPrompts.length > 0 ? recentPrompts.map((prompt) => (
                            <button
                                key={prompt}
                                type="button"
                                onClick={() => restorePrompt(prompt)}
                                className={cn('block w-full rounded-2xl border px-4 py-3 text-left text-sm transition-colors', railButtonClassName)}
                            >
                                <span className="line-clamp-2">{prompt}</span>
                            </button>
                        )) : (
                            <div className={cn('rounded-2xl border px-4 py-4 text-sm leading-6', railButtonClassName)}>
                                Your recent prompts will stay here while this shopping session is active.
                            </div>
                        )}
                    </div>
                </div>

                <div className="px-4 pb-4 pt-5">
                    <MultimodalDock isWhiteMode={isWhiteMode} variant="compact" />
                </div>
            </aside>

            <section className="relative min-w-0 bg-transparent">
                <div className="flex h-full min-h-0 flex-col">
                    <header className="flex items-center justify-between gap-4 px-5 py-5 sm:px-8">
                        <div className="min-w-0">
                            <p className={cn('text-xs font-black uppercase tracking-[0.22em]', mutedTextClass)}>
                                {routeLabel}
                            </p>
                            <p className="mt-1 text-lg font-semibold tracking-tight sm:text-xl">Aura shopping copilot</p>
                        </div>

                        <div className="flex items-center gap-2 sm:gap-3">
                            <span className={cn('hidden rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] sm:inline-flex', railButtonClassName)}>
                                {modeLabel}
                            </span>
                            <button
                                type="button"
                                onClick={() => onSetWorkspaceVariant?.('small')}
                                className={cn(
                                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition-colors',
                                    !isLargeWorkspace ? activeWorkspaceControlClassName : workspaceControlClassName
                                )}
                                aria-label="Use small workspace"
                                title="Use small workspace"
                            >
                                <Minimize2 className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Small</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => onSetWorkspaceVariant?.('large')}
                                className={cn(
                                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition-colors',
                                    isLargeWorkspace ? activeWorkspaceControlClassName : workspaceControlClassName
                                )}
                                aria-label="Use large workspace"
                                title="Use large workspace"
                            >
                                <Maximize2 className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Large</span>
                            </button>
                            <button
                                type="button"
                                onClick={onClose}
                                className={cn('rounded-full border p-2.5 transition-colors', workspaceControlClassName)}
                                aria-label="Close chat"
                                title="Close chat"
                            >
                                <X className="h-4.5 w-4.5" />
                            </button>
                        </div>
                    </header>

                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                        {hasConversation ? (
                            <MessageList
                                messages={messages}
                                isLoading={isLoading}
                                isWhiteMode={isWhiteMode}
                                onSelectProduct={onSelectProduct}
                                onAddToCart={onAddToCart}
                                onViewDetails={onViewDetails}
                                onOpenSupport={onOpenSupport}
                                onConfirmPending={onConfirmPending}
                                onCancelPending={onCancelPending}
                                onModifyPending={onModifyPending}
                            />
                        ) : (
                            <div className="flex min-h-0 flex-1 items-center justify-center px-5 pb-8 pt-2 sm:px-8">
                                <div className="w-full max-w-4xl">
                                    <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/15 bg-cyan-400/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                                        <Sparkles className="h-3.5 w-3.5" />
                                        Aura Commerce AI
                                    </div>
                                    <h1 className="mt-6 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                                        Hi {displayName}
                                    </h1>
                                    <p className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-6xl">
                                        Where should we start?
                                    </p>
                                    <p className={cn('mt-5 max-w-3xl text-sm leading-7 sm:text-base', mutedTextClass)}>
                                        Search faster, compare smarter, move to checkout with less noise, or route an issue
                                        into support without losing shopping context.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="px-5 pb-5 pt-4 sm:px-8 sm:pb-8">
                        <div className="mx-auto w-full max-w-4xl">
                            <ActionBar
                                primaryAction={primaryAction}
                                secondaryActions={secondaryActions}
                                isWhiteMode={isWhiteMode}
                                isDisabled={isLoading}
                                onAction={onAction}
                            />

                            <form
                                onSubmit={onSubmit}
                                className={cn('mt-4 rounded-[2rem] border p-4 shadow-[0_18px_54px_rgba(0,0,0,0.28)] sm:p-5', composerClassName)}
                            >
                                <textarea
                                    ref={inputRef}
                                    value={inputValue}
                                    onChange={(event) => onInputChange?.(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' && !event.shiftKey) {
                                            event.preventDefault();
                                            onSubmit?.(event);
                                        }
                                    }}
                                    rows={Math.min(Math.max(String(inputValue || '').split('\n').length, 2), 8)}
                                    placeholder={isListening ? 'Listening...' : 'Ask Aura about products, cart, checkout, or support handoff.'}
                                    disabled={isLoading}
                                    className={cn(
                                        'min-h-[110px] w-full resize-none bg-transparent text-lg outline-none placeholder:text-white/38',
                                        isWhiteMode ? 'text-slate-950 placeholder:text-slate-400' : 'text-white'
                                    )}
                                />

                                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-colors', railButtonClassName)}
                                        >
                                            <Plus className="h-4 w-4" />
                                            Add
                                        </button>
                                        <button
                                            type="button"
                                            className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-colors', railButtonClassName)}
                                        >
                                            <Wand2 className="h-4 w-4" />
                                            Tools
                                        </button>
                                        <span className={cn('inline-flex items-center rounded-full border px-3 py-2 text-sm font-medium', railButtonClassName)}>
                                            {routeLabel}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <span className={cn('hidden rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] sm:inline-flex', railButtonClassName)}>
                                            {modeLabel}
                                        </span>
                                        {supportsDictation ? (
                                            <button
                                                type="button"
                                                onClick={onToggleDictation}
                                                className={cn('rounded-full border p-3 transition-colors', isListening ? primaryButtonClass : railButtonClassName)}
                                                aria-label={isListening ? 'Stop dictation' : 'Start dictation'}
                                            >
                                                {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                                            </button>
                                        ) : null}

                                        <button
                                            type="submit"
                                            disabled={!safeString(inputValue) || isLoading}
                                            className={cn('rounded-full border p-3 transition-colors disabled:cursor-not-allowed disabled:opacity-50', primaryButtonClass)}
                                            aria-label="Send message"
                                        >
                                            <Send className="h-5 w-5" />
                                        </button>
                                    </div>
                                </div>
                            </form>

                            <div className="mt-5 flex flex-wrap justify-center gap-3">
                                {STARTER_PROMPTS.map((entry) => (
                                    <button
                                        key={entry.label}
                                        type="button"
                                        onClick={() => onStarterPrompt?.(entry.prompt)}
                                        className={cn('rounded-full border px-4 py-3 text-sm font-medium transition-colors', railButtonClassName)}
                                    >
                                        {entry.label}
                                    </button>
                                ))}
                            </div>

                            {!hasConversation ? (
                                <div className="mt-5 flex flex-wrap justify-center gap-3">
                                    {helperPrompts.slice(0, 3).map((prompt) => (
                                        <button
                                            key={prompt}
                                            type="button"
                                            onClick={() => onStarterPrompt?.(prompt)}
                                            className={cn('rounded-full border px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.16em] transition-colors', activeRailButtonClassName)}
                                        >
                                            {prompt.length > 42 ? `${prompt.slice(0, 42)}...` : prompt}
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default ChatContainer;
