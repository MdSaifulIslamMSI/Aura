import { useMemo } from 'react';
import {
    Menu, Maximize2, MessageSquarePlus, Mic, MicOff, Minimize2,
    Plus, Send, Sparkles, Wand2, X, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import MessageList from './MessageList';
import ActionBar from './ActionBar';
import MultimodalDock from './MultimodalDock';

const STARTER_PROMPTS = [
    { label: 'Find products', prompt: 'Show premium camera phones for photography under Rs 60000' },
    { label: 'Compare laptops', prompt: 'Compare the best laptops for coding and light gaming' },
    { label: 'Review cart', prompt: 'Review my cart and tell me the smartest next step' },
    { label: 'Support help', prompt: 'Help me hand off an order issue to support' },
    { label: 'Gadget upgrade', prompt: 'Find a fast, high-value gadget upgrade for my daily workflow' },
    { label: 'Shopping advice', prompt: 'Help me decide what to buy based on value, trust, and speed' },
];

const safeString = (value = '') => String(value ?? '').trim();

const formatDisplayName = (value = '') => {
    const normalized = safeString(value).split(/\s+/)[0] || 'there';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
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
        [messages],
    );
    const recentPrompts = useMemo(() => buildRecentPrompts(messages), [messages]);
    const displayName = useMemo(() => formatDisplayName(currentUserLabel), [currentUserLabel]);
    const isLargeWorkspace = workspaceVariant === 'large';

    const shellClass = isWhiteMode
        ? 'bg-white/88 border-white/60 shadow-[0_24px_80px_rgba(15,23,42,0.12)] ring-1 ring-slate-200/60'
        : 'bg-[#090D14]/92 border-white/8 shadow-[0_28px_96px_rgba(2,6,23,0.78)] ring-1 ring-white/6';
    const panelBgClass = isWhiteMode
        ? 'bg-gradient-to-b from-slate-50/95 to-white/98 border-r border-slate-200/80'
        : 'bg-gradient-to-b from-[#10151F]/98 to-[#0A0D14]/98 border-r border-white/6';
    const textPrimary = isWhiteMode ? 'text-slate-900' : 'text-slate-50';
    const textMuted = isWhiteMode ? 'text-slate-500' : 'text-slate-400';
    const composerBg = isWhiteMode
        ? 'bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)] border border-slate-200/80'
        : 'bg-[#141923]/92 shadow-[0_10px_34px_rgba(2,6,23,0.5)] border border-white/8';
    const btnClass = isWhiteMode
        ? 'hover:bg-slate-100 text-slate-700 active:scale-[0.98]'
        : 'hover:bg-white/10 text-slate-200 active:scale-[0.98]';

    const pillBtn = cn(
        'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold tracking-wide transition-all duration-300 backdrop-blur-md',
        isWhiteMode
            ? 'border border-slate-200 bg-slate-100/80 text-slate-700 hover:bg-slate-200'
            : 'border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10',
    );

    const primaryBtn = cn(
        'flex items-center justify-center rounded-full p-3 transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-40',
        isWhiteMode
            ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md hover:from-indigo-700 hover:to-violet-700'
            : 'bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-950 shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:from-cyan-400 hover:to-blue-400',
    );

    const restorePrompt = (prompt) => {
        onInputChange?.(prompt);
        window.requestAnimationFrame(() => inputRef?.current?.focus());
    };

    const handleFormSubmit = (e) => {
        e?.preventDefault?.();
        if (safeString(inputValue) && !isLoading) {
            onSubmit?.(e);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleFormSubmit(e);
        }
    };

    return (
        <div
            className={cn(
                'pointer-events-auto grid min-h-0 min-w-0 grid-cols-1 overflow-hidden rounded-[24px] backdrop-blur-3xl transition-all duration-500 ease-out',
                isLargeWorkspace
                    ? 'h-[min(90vh,840px)] w-[min(92vw,1220px)] lg:grid-cols-[240px_minmax(0,1fr)]'
                    : 'h-[min(86vh,760px)] w-[min(94vw,820px)] sm:w-[min(90vw,860px)] lg:w-[min(72vw,920px)] xl:w-[920px]',
                shellClass,
            )}
        >
            <aside className={cn('z-10 hidden min-h-0 flex-col lg:flex', !isLargeWorkspace && 'lg:hidden', panelBgClass)}>
                <div className="flex items-center gap-3 px-5 py-5">
                    <button type="button" className={cn('rounded-xl p-2 transition-colors', btnClass)} aria-label="Menu">
                        <Menu className="h-5 w-5" />
                    </button>
                    <div>
                        <h2 className={cn('text-base font-bold tracking-tight', textPrimary)}>Aura Copilot</h2>
                        <span className={cn('text-[10px] font-semibold uppercase tracking-widest', textMuted)}>Conversation</span>
                    </div>
                </div>

                <div className="px-4">
                    <button
                        type="button"
                        onClick={onStartFresh}
                        className={cn(
                            'group flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold transition-all duration-300',
                            isWhiteMode
                                ? 'border-slate-200 bg-white text-slate-800 hover:border-indigo-300 hover:shadow-sm'
                                : 'border-white/10 bg-[#1A1D24] text-slate-200 hover:border-cyan-500/30 hover:bg-white/5',
                        )}
                    >
                        <MessageSquarePlus className={cn('h-4 w-4 transition-transform group-hover:scale-110', isWhiteMode ? 'text-indigo-500' : 'text-cyan-400')} />
                        New conversation
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-4 pt-6 scrollbar-hide">
                    <p className={cn('mb-3 px-1 text-[10px] font-bold uppercase tracking-widest', textMuted)}>Recent queries</p>
                    <div className="space-y-2">
                        {recentPrompts.length > 0 ? recentPrompts.map((prompt) => (
                            <button
                                key={prompt}
                                type="button"
                                onClick={() => restorePrompt(prompt)}
                                className={cn(
                                    'group flex w-full items-start gap-3 rounded-xl p-3 text-left text-sm transition-all duration-200',
                                    isWhiteMode ? 'text-slate-600 hover:bg-slate-100/80' : 'text-slate-300 hover:bg-white/5',
                                )}
                            >
                                <ChevronRight className={cn('mt-0.5 h-4 w-4 shrink-0 -ml-2 opacity-0 transition-all group-hover:ml-0 group-hover:opacity-100', isWhiteMode ? 'text-indigo-500' : 'text-cyan-400')} />
                                <span className="line-clamp-2 flex-1 leading-relaxed">{prompt}</span>
                            </button>
                        )) : (
                            <div className={cn('rounded-xl border border-dashed p-4 text-xs leading-relaxed', isWhiteMode ? 'border-slate-200 text-slate-500' : 'border-white/10 text-slate-400')}>
                                Recent prompts will appear here once the conversation gets moving.
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-4 pb-5">
                    <MultimodalDock isWhiteMode={isWhiteMode} variant="compact" />
                </div>
            </aside>

            <section className="relative z-20 flex min-w-0 flex-col bg-transparent">
                <header className={cn('z-30 flex items-center justify-between gap-4 border-b px-5 py-4 backdrop-blur-md', isWhiteMode ? 'border-slate-200/50 bg-white/40' : 'border-white/6 bg-black/10')}>
                    <div className="flex items-center gap-3">
                        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', isWhiteMode ? 'bg-indigo-100 text-indigo-600' : 'bg-cyan-500/20 text-cyan-400')}>
                            <Sparkles className="h-4 w-4" />
                        </div>
                        <div>
                            <p className={cn('text-xs font-semibold tracking-wide', textPrimary)}>Aura Assistant</p>
                            <p className={cn('text-[10px] uppercase tracking-wider', textMuted)}>{`${routeLabel} • ${modeLabel}`}</p>
                            {subtitle ? (
                                <p className={cn('mt-1 text-[11px] normal-case tracking-normal', textMuted)}>{subtitle}</p>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => onSetWorkspaceVariant?.(isLargeWorkspace ? 'small' : 'large')}
                            className={cn('rounded-lg p-2 transition-all', btnClass)}
                            aria-label={isLargeWorkspace ? 'Use small workspace' : 'Use large workspace'}
                        >
                            {isLargeWorkspace ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className={cn('rounded-lg p-2 transition-all', btnClass)}
                            aria-label="Close chat"
                        >
                            <X className="h-4.5 w-4.5" />
                        </button>
                    </div>
                </header>

                <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.08),transparent_32%),radial-gradient(circle_at_bottom,rgba(14,165,233,0.06),transparent_28%)]">
                    {hasConversation ? (
                        <div className="relative z-10 flex-1 overflow-y-auto">
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
                        <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-12 pt-4">
                            <div className="w-full max-w-3xl space-y-6 text-center duration-700 ease-out animate-in slide-in-from-bottom-6 fade-in">
                                <div className={cn('mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl shadow-xl', isWhiteMode ? 'bg-gradient-to-br from-indigo-500 to-violet-500' : 'bg-gradient-to-br from-cyan-400 to-blue-600')}>
                                    <Sparkles className="h-8 w-8 text-white" />
                                </div>
                                <div>
                                    <h1 className={cn('text-3xl font-bold tracking-tight sm:text-4xl', textPrimary)}>
                                        Hello, {displayName}!
                                    </h1>
                                    <p className={cn('mt-3 text-lg', textMuted)}>
                                        I&apos;m your Aura shopping copilot. Drop a request below to get started.
                                    </p>
                                </div>
                                <div className="flex flex-wrap justify-center gap-3 pt-8">
                                    {STARTER_PROMPTS.map((entry, idx) => (
                                        <button
                                            key={entry.label}
                                            onClick={() => onStarterPrompt?.(entry.prompt)}
                                            style={{ animationDelay: `${idx * 50}ms` }}
                                            className={cn('duration-500 animate-in fade-in zoom-in-95', pillBtn)}
                                        >
                                            {entry.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="relative z-20 bg-gradient-to-t from-background/80 to-transparent px-4 pb-4 pt-2 sm:px-5">
                    <div className="mx-auto w-full max-w-3xl">
                        <ActionBar
                            primaryAction={primaryAction}
                            secondaryActions={secondaryActions}
                            isWhiteMode={isWhiteMode}
                            isDisabled={isLoading}
                            onAction={onAction}
                        />

                        <form
                            onSubmit={handleFormSubmit}
                            className={cn('mt-3 rounded-[24px] p-2 ring-cyan-500/35 transition-all duration-300 focus-within:ring-2', composerBg)}
                        >
                            <div className="relative flex items-end gap-2 p-1">
                                <div className="min-w-0 flex-1">
                                    <textarea
                                        ref={inputRef}
                                        value={inputValue}
                                        onChange={(e) => onInputChange?.(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        rows={Math.min(Math.max(String(inputValue || '').split('\n').length, 1), 6)}
                                        placeholder={isListening ? 'Listening...' : 'Ask Aura about products, compare items, or track an order...'}
                                        disabled={isLoading}
                                        className={cn(
                                            'w-full resize-none bg-transparent px-3 py-2 text-[15px] outline-none placeholder:transition-opacity focus:placeholder:opacity-50',
                                            textPrimary,
                                            isWhiteMode ? 'placeholder:text-slate-400' : 'placeholder:text-slate-500',
                                        )}
                                        style={{ minHeight: '44px' }}
                                    />
                                </div>

                                <div className="mb-1 flex shrink-0 items-center gap-2 pr-1">
                                    {supportsDictation && (
                                        <button
                                            type="button"
                                            onClick={onToggleDictation}
                                            className={cn('rounded-full p-2.5 transition-all', isListening ? primaryBtn : btnClass)}
                                            aria-label={isListening ? 'Stop dictation' : 'Start dictation'}
                                        >
                                            {isListening ? <MicOff className="h-4.5 w-4.5" /> : <Mic className="h-4.5 w-4.5" />}
                                        </button>
                                    )}
                                    <button
                                        type="submit"
                                        disabled={!safeString(inputValue) || isLoading}
                                        className={primaryBtn}
                                        aria-label="Send message"
                                    >
                                        <Send className="ml-0.5 h-4.5 w-4.5" />
                                    </button>
                                </div>
                            </div>

                            <div className={cn('mt-1 flex flex-wrap items-center gap-2 border-t px-3 pb-2 pt-1', isWhiteMode ? 'border-slate-100' : 'border-white/5')}>
                                <button type="button" className={cn('inline-flex items-center gap-1.5 text-xs font-medium transition-opacity hover:opacity-80', textMuted)}>
                                    <Plus className="h-3.5 w-3.5" /> Context
                                </button>
                                <button type="button" className={cn('inline-flex items-center gap-1.5 text-xs font-medium transition-opacity hover:opacity-80', textMuted)}>
                                    <Wand2 className="h-3.5 w-3.5" /> Tools
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default ChatContainer;
