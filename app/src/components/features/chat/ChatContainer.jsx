import { useMemo } from 'react';
import {
    ArrowUp,
    Maximize2,
    MessageSquarePlus,
    Mic,
    MicOff,
    Minimize2,
    Paperclip,
    Sparkles,
    X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import MessageList from './MessageList';
import ActionBar from './ActionBar';

const STARTER_PROMPTS = [
    { label: 'Find products', prompt: 'Show premium camera phones for photography under Rs 60000' },
    { label: 'Review cart', prompt: 'Review my cart and tell me the smartest next step' },
    { label: 'Order help', prompt: 'Help me hand off an order issue to support' },
    { label: 'Explain app', prompt: 'Explain checkout end to end' },
];

const safeString = (value = '') => String(value ?? '').trim();

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
        .slice(0, 4);
};

const ChatContainer = ({
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
        [messages],
    );
    const recentPrompts = useMemo(() => buildRecentPrompts(messages), [messages]);
    const isLargeWorkspace = workspaceVariant === 'large';

    const shellClass = isWhiteMode
        ? 'border-slate-200/80 bg-white/95 text-slate-950 shadow-[0_36px_120px_rgba(15,23,42,0.18)]'
        : 'border-white/10 bg-[#020406]/96 text-white shadow-[0_40px_140px_rgba(0,0,0,0.72)]';
    const headerText = isWhiteMode ? 'text-slate-500' : 'text-white/45';
    const controlButton = isWhiteMode
        ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
        : 'border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.08]';
    const composerClass = isWhiteMode
        ? 'border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]'
        : 'border-white/10 bg-black/90 shadow-[0_20px_80px_rgba(0,0,0,0.45)]';
    const chipClass = isWhiteMode
        ? 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
        : 'border-white/10 bg-white/[0.03] text-white/75 hover:bg-white/[0.08]';
    const subtextClass = isWhiteMode ? 'text-slate-500' : 'text-white/55';
    const inputPlaceholderClass = isWhiteMode ? 'placeholder:text-slate-400' : 'placeholder:text-white/28';
    const sendButtonClass = isWhiteMode
        ? 'bg-slate-950 text-white hover:bg-slate-800'
        : 'bg-white text-slate-950 hover:bg-white/90';

    const handleFormSubmit = (event) => {
        event?.preventDefault?.();
        if (safeString(inputValue) && !isLoading) {
            onSubmit?.(event);
        }
    };

    const handleKeyDown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            handleFormSubmit(event);
        }
    };

    return (
        <div
            className={cn(
                'pointer-events-auto relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[34px] border backdrop-blur-2xl transition-all duration-500',
                isLargeWorkspace
                    ? 'h-[min(90vh,860px)] w-[min(92vw,1120px)]'
                    : 'h-[min(86vh,780px)] w-[min(94vw,920px)]',
                shellClass,
            )}
        >
            <div
                aria-hidden="true"
                className={cn(
                    'pointer-events-none absolute inset-0 opacity-90',
                    isWhiteMode
                        ? 'bg-[radial-gradient(circle_at_top,rgba(148,163,184,0.08),transparent_35%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.92))]'
                        : 'bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_26%),radial-gradient(circle_at_50%_100%,rgba(56,189,248,0.05),transparent_28%),linear-gradient(180deg,rgba(2,4,6,0.98),rgba(0,0,0,0.98))]'
                )}
            />
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-[0.16]"
                style={{
                    backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.45) 1px, transparent 0)',
                    backgroundSize: '28px 28px',
                }}
            />

            <header className={cn('relative z-10 flex items-center justify-between gap-4 px-5 py-4 sm:px-6', headerText)}>
                <div className="flex items-center gap-3">
                    <div className={cn(
                        'flex h-11 w-11 items-center justify-center rounded-2xl border shadow-[0_0_40px_rgba(255,255,255,0.12)]',
                        isWhiteMode
                            ? 'border-slate-200 bg-slate-950 text-white'
                            : 'border-white/10 bg-[#031019] text-white'
                    )}>
                        <Sparkles className="h-5 w-5" />
                    </div>
                    <div>
                        <p className={cn('text-sm font-semibold tracking-tight', isWhiteMode ? 'text-slate-950' : 'text-white')}>Aura Intelligence</p>
                        <p className="text-[11px] uppercase tracking-[0.24em]">{safeString(routeLabel) || 'Store'} / {safeString(modeLabel) || 'Explore'}</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onStartFresh}
                        className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors', controlButton)}
                        aria-label="New conversation"
                    >
                        <MessageSquarePlus className="h-4 w-4" />
                        <span className="hidden sm:inline">New thread</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => onSetWorkspaceVariant?.(isLargeWorkspace ? 'small' : 'large')}
                        className={cn('inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors', controlButton)}
                        aria-label={isLargeWorkspace ? 'Use small workspace' : 'Use large workspace'}
                    >
                        {isLargeWorkspace ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className={cn('inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors', controlButton)}
                        aria-label="Close chat"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </header>

            <div className="relative z-10 flex min-h-0 flex-1 flex-col">
                {hasConversation ? (
                    <div className="min-h-0 flex-1 overflow-hidden">
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
                    </div>
                ) : (
                    <div className="flex flex-1 items-center justify-center px-6 py-6 sm:px-10">
                        <div className="w-full max-w-4xl text-center">
                            <div className={cn(
                                'mx-auto flex h-20 w-20 items-center justify-center rounded-[28px] border shadow-[0_0_60px_rgba(255,255,255,0.14)]',
                                isWhiteMode
                                    ? 'border-slate-200 bg-slate-950 text-white'
                                    : 'border-white/10 bg-[#04131d] text-white'
                            )}>
                                <Sparkles className="h-9 w-9" />
                            </div>
                            <h1 className={cn('mt-8 text-4xl font-semibold tracking-tight sm:text-5xl', isWhiteMode ? 'text-slate-950' : 'text-white')}>
                                How can I help you today?
                            </h1>
                            <p className={cn('mx-auto mt-4 max-w-2xl text-sm leading-7 sm:text-base', subtextClass)}>
                                {subtitle || 'Ask about products, cart actions, support handoffs, or app flows. The assistant keeps the thread focused and fast.'}
                            </p>

                            {recentPrompts.length > 0 ? (
                                <div className="mt-8 flex flex-wrap justify-center gap-3">
                                    {recentPrompts.map((prompt) => (
                                        <button
                                            key={prompt}
                                            type="button"
                                            onClick={() => onInputChange?.(prompt)}
                                            className={cn('rounded-full border px-4 py-2 text-sm transition-colors', chipClass)}
                                        >
                                            {prompt}
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </div>
                )}

                <div className="px-4 pb-4 pt-2 sm:px-6 sm:pb-6">
                    {(primaryAction || (Array.isArray(secondaryActions) && secondaryActions.length > 0)) ? (
                        <div className="mx-auto mb-3 w-full max-w-4xl">
                            <ActionBar
                                primaryAction={primaryAction}
                                secondaryActions={secondaryActions}
                                isWhiteMode={isWhiteMode}
                                isDisabled={isLoading}
                                onAction={onAction}
                            />
                        </div>
                    ) : null}

                    <div className="mx-auto w-full max-w-4xl">
                        <form
                            onSubmit={handleFormSubmit}
                            className={cn('rounded-[28px] border px-4 py-3 sm:px-5 sm:py-4', composerClass)}
                        >
                            <div className="flex items-end gap-3">
                                <button
                                    type="button"
                                    className={cn('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors', controlButton)}
                                    aria-label="Attach context"
                                >
                                    <Paperclip className="h-4.5 w-4.5" />
                                </button>

                                <div className="min-w-0 flex-1">
                                    <textarea
                                        ref={inputRef}
                                        value={inputValue}
                                        onChange={(event) => onInputChange?.(event.target.value)}
                                        onKeyDown={handleKeyDown}
                                        rows={Math.min(Math.max(String(inputValue || '').split('\n').length, 1), 6)}
                                        placeholder={isListening ? 'Listening...' : 'Ask anything'}
                                        disabled={isLoading}
                                        className={cn(
                                            'max-h-40 w-full resize-none bg-transparent py-2 text-base outline-none sm:text-lg',
                                            isWhiteMode ? 'text-slate-950' : 'text-white',
                                            inputPlaceholderClass,
                                        )}
                                    />
                                </div>

                                <div className="flex shrink-0 items-center gap-2 pb-1">
                                    {supportsDictation ? (
                                        <button
                                            type="button"
                                            onClick={onToggleDictation}
                                            className={cn('inline-flex h-11 w-11 items-center justify-center rounded-full border transition-colors', controlButton)}
                                            aria-label={isListening ? 'Stop dictation' : 'Start dictation'}
                                        >
                                            {isListening ? <MicOff className="h-4.5 w-4.5" /> : <Mic className="h-4.5 w-4.5" />}
                                        </button>
                                    ) : null}
                                    <button
                                        type="submit"
                                        disabled={!safeString(inputValue) || isLoading}
                                        className={cn(
                                            'inline-flex h-12 w-12 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-35',
                                            sendButtonClass,
                                        )}
                                        aria-label="Send message"
                                    >
                                        <ArrowUp className="h-5 w-5" />
                                    </button>
                                </div>
                            </div>
                        </form>

                        {!hasConversation ? (
                            <div className="mt-4 flex flex-wrap justify-center gap-3">
                                {STARTER_PROMPTS.map((entry) => (
                                    <button
                                        key={entry.label}
                                        type="button"
                                        onClick={() => onStarterPrompt?.(entry.prompt)}
                                        className={cn('rounded-full border px-4 py-2 text-sm transition-colors', chipClass)}
                                    >
                                        {entry.label}
                                    </button>
                                ))}
                            </div>
                        ) : null}

                        <div className={cn('mt-4 flex flex-wrap items-center justify-between gap-3 px-1 text-[11px]', subtextClass)}>
                            <span>{safeString(routeLabel) || 'Store'} / {safeString(modeLabel) || 'Explore'}</span>
                            <span>{supportsDictation ? 'Voice ready' : 'Chat mode'}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ChatContainer;
