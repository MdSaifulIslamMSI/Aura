import { useMemo } from 'react';
import {
    Menu, Maximize2, MessageSquarePlus, Mic, MicOff, Minimize2,
    Plus, Send, Sparkles, Wand2, X, ChevronRight
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
        [messages]
    );
    const recentPrompts = useMemo(() => buildRecentPrompts(messages), [messages]);
    const displayName = useMemo(() => formatDisplayName(currentUserLabel), [currentUserLabel]);
    const isLargeWorkspace = workspaceVariant === 'large';

    // Premium Aesthetics design tokens
    const shellClass = isWhiteMode
        ? 'bg-white/80 border-white/50 shadow-[0_32px_96px_rgba(30,41,59,0.15)] ring-1 ring-slate-200/50'
        : 'bg-[#0A0D14]/85 border-white/10 shadow-[0_32px_120px_rgba(0,0,0,0.8)] ring-1 ring-white/5';
    
    const panelBgClass = isWhiteMode
        ? 'bg-gradient-to-b from-slate-50/90 to-white/95 border-r border-slate-200'
        : 'bg-gradient-to-b from-[#11141A]/95 to-[#0A0D14]/95 border-r border-white/5';

    const textPrimary = isWhiteMode ? 'text-slate-900' : 'text-slate-50';
    const textMuted = isWhiteMode ? 'text-slate-500' : 'text-slate-400';
    
    const composerBg = isWhiteMode
        ? 'bg-white shadow-[0_8px_32px_rgba(0,0,0,0.04)] border border-slate-200/80'
        : 'bg-[#1A1D24]/80 shadow-[0_8px_32px_rgba(0,0,0,0.4)] border border-white/10';

    const btnClass = isWhiteMode
        ? 'hover:bg-slate-100 text-slate-700 active:scale-[0.98]'
        : 'hover:bg-white/10 text-slate-200 active:scale-[0.98]';

    const pillBtn = cn(
        'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold tracking-wide transition-all duration-300 backdrop-blur-md',
        isWhiteMode ? 'bg-slate-100/80 hover:bg-slate-200 border border-slate-200 text-slate-700' 
                   : 'bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200'
    );

    const primaryBtn = cn(
        'flex items-center justify-center rounded-full p-3 transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed',
        isWhiteMode 
            ? 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-md' 
            : 'bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-slate-950 shadow-[0_0_20px_rgba(6,182,212,0.3)]'
    );

    const helperPrompts = recentPrompts.length > 0 ? recentPrompts : STARTER_PROMPTS.map((entry) => entry.prompt);

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
                    ? 'h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] sm:h-[min(94vh,900px)] sm:w-[min(96vw,1400px)] lg:grid-cols-[280px_minmax(0,1fr)]'
                    : 'h-[min(85vh,700px)] w-[min(94vw,540px)] sm:h-[min(85vh,760px)] sm:w-[min(88vw,680px)] lg:h-[min(85vh,760px)] lg:w-[min(54vw,760px)] xl:w-[760px]',
                shellClass
            )}
        >
            <aside className={cn('hidden min-h-0 flex-col z-10 lg:flex', !isLargeWorkspace && 'lg:hidden', panelBgClass)}>
                <div className="flex items-center gap-3 px-6 py-6">
                    <button type="button" className={cn('p-2 rounded-xl transition-colors', btnClass)} aria-label="Menu">
                        <Menu className="h-5 w-5" />
                    </button>
                    <div>
                        <h2 className={cn("text-base font-bold tracking-tight", textPrimary)}>Aura Copilot</h2>
                        <span className={cn("text-[10px] font-semibold uppercase tracking-widest", textMuted)}>Workspace</span>
                    </div>
                </div>

                <div className="px-5">
                    <button
                        type="button"
                        onClick={onStartFresh}
                        className={cn(
                            'group flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold transition-all duration-300',
                            isWhiteMode 
                                ? 'bg-white border-slate-200 text-slate-800 hover:border-indigo-300 hover:shadow-sm' 
                                : 'bg-[#1A1D24] border-white/10 text-slate-200 hover:border-cyan-500/30 hover:bg-white/5'
                        )}
                    >
                        <MessageSquarePlus className={cn("h-4 w-4 transition-transform group-hover:scale-110", isWhiteMode ? "text-indigo-500" : "text-cyan-400")} />
                        New conversation
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 pt-8 scrollbar-hide">
                    <p className={cn('px-1 text-[10px] font-bold uppercase tracking-widest mb-3', textMuted)}>Recent Queries</p>
                    <div className="space-y-2">
                        {recentPrompts.length > 0 ? recentPrompts.map((prompt) => (
                            <button
                                key={prompt}
                                type="button"
                                onClick={() => restorePrompt(prompt)}
                                className={cn(
                                    'w-full group flex items-start gap-3 rounded-xl p-3 text-left text-sm transition-all duration-200',
                                    isWhiteMode ? 'hover:bg-slate-100/80 text-slate-600' : 'hover:bg-white/5 text-slate-300'
                                )}
                            >
                                <ChevronRight className={cn("h-4 w-4 shrink-0 mt-0.5 opacity-0 -ml-2 group-hover:opacity-100 group-hover:ml-0 transition-all", isWhiteMode ? "text-indigo-500" : "text-cyan-400")} />
                                <span className="line-clamp-2 leading-relaxed flex-1">{prompt}</span>
                            </button>
                        )) : (
                            <div className={cn('rounded-xl p-4 text-xs leading-relaxed border border-dashed', isWhiteMode ? 'border-slate-200 text-slate-500' : 'border-white/10 text-slate-400')}>
                                Your shopping history and prompt combinations will appear here magically.
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-5 pb-6">
                    <MultimodalDock isWhiteMode={isWhiteMode} variant="compact" />
                </div>
            </aside>

            <section className="relative flex min-w-0 flex-col bg-transparent z-20">
                <header className={cn("flex items-center justify-between gap-4 px-6 py-4 backdrop-blur-md border-b z-30", isWhiteMode ? "border-slate-200/50 bg-white/40" : "border-white/5 bg-black/10")}>
                    <div className="flex items-center gap-3">
                        <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", isWhiteMode ? "bg-indigo-100 text-indigo-600" : "bg-cyan-500/20 text-cyan-400")}>
                            <Sparkles className="h-4 w-4" />
                        </div>
                        <div>
                            <p className={cn("text-xs font-semibold tracking-wide", textPrimary)}>Aura Assistant</p>
                            <p className={cn("text-[10px] uppercase tracking-wider", textMuted)}>{routeLabel} • {modeLabel}</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => onSetWorkspaceVariant?.(isLargeWorkspace ? 'small' : 'large')}
                            className={cn('p-2 rounded-lg transition-all', btnClass)}
                            aria-label="Toggle workspace"
                        >
                            {isLargeWorkspace ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className={cn('p-2 rounded-lg transition-all', btnClass)}
                            aria-label="Close"
                        >
                            <X className="h-4.5 w-4.5" />
                        </button>
                    </div>
                </header>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden relative">
                    {hasConversation ? (
                        <div className="flex-1 overflow-y-auto z-10 relative">
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
                        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-12 pt-4 relative z-10">
                            <div className="w-full max-w-3xl text-center space-y-6 animate-in slide-in-from-bottom-6 fade-in duration-700 ease-out">
                                <div className={cn("mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl shadow-xl", isWhiteMode ? "bg-gradient-to-br from-indigo-500 to-violet-500" : "bg-gradient-to-br from-cyan-400 to-blue-600")}>
                                    <Sparkles className="h-8 w-8 text-white" />
                                </div>
                                <div>
                                    <h1 className={cn("text-3xl font-bold tracking-tight sm:text-4xl", textPrimary)}>
                                        Hello, {displayName}!
                                    </h1>
                                    <p className={cn("mt-3 text-lg", textMuted)}>
                                        I'm your Aura shopping copilot. Drop a request below to get started.
                                    </p>
                                </div>
                                <div className="pt-8 flex flex-wrap justify-center gap-3">
                                    {STARTER_PROMPTS.map((entry, idx) => (
                                        <button
                                            key={entry.label}
                                            onClick={() => onStarterPrompt?.(entry.prompt)}
                                            style={{ animationDelay: `${idx * 50}ms` }}
                                            className={cn("animate-in fade-in zoom-in-95 duration-500", pillBtn)}
                                        >
                                            {entry.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="px-4 pb-4 pt-2 sm:px-6 z-20 relative bg-gradient-to-t from-background/80 to-transparent">
                     <div className="mx-auto w-full max-w-4xl">
                        <ActionBar
                            primaryAction={primaryAction}
                            secondaryActions={secondaryActions}
                            isWhiteMode={isWhiteMode}
                            isDisabled={isLoading}
                            onAction={onAction}
                        />

                        <form
                            onSubmit={handleFormSubmit}
                            className={cn('mt-3 rounded-[24px] p-2 transition-all duration-300 focus-within:ring-2 ring-indigo-500/50', composerBg)}
                        >
                            <div className="relative flex items-end gap-2 p-1">
                                <div className="flex-1 min-w-0">
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
                                            isWhiteMode ? 'placeholder:text-slate-400' : 'placeholder:text-slate-500'
                                        )}
                                        style={{ minHeight: '44px' }}
                                    />
                                </div>
                                
                                <div className="flex items-center gap-2 mb-1 pr-1 shrink-0">
                                    {supportsDictation && (
                                        <button
                                            type="button"
                                            onClick={onToggleDictation}
                                            className={cn('p-2.5 rounded-full transition-all', isListening ? primaryBtn : btnClass)}
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
                                        <Send className="h-4.5 w-4.5 ml-0.5" />
                                    </button>
                                </div>
                            </div>
                            
                            <div className={cn("flex flex-wrap items-center gap-2 px-3 pb-2 pt-1 mt-1 border-t", isWhiteMode ? "border-slate-100" : "border-white/5")}>
                                <button type="button" className={cn("inline-flex items-center gap-1.5 text-xs font-medium hover:opacity-80 transition-opacity", textMuted)}>
                                    <Plus className="h-3.5 w-3.5" /> Context
                                </button>
                                <button type="button" className={cn("inline-flex items-center gap-1.5 text-xs font-medium hover:opacity-80 transition-opacity", textMuted)}>
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
