import { Mic, MicOff, Send, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import MessageList from './MessageList';
import ActionBar from './ActionBar';
import MultimodalDock from './MultimodalDock';

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
    onClose,
    onInputChange,
    onSubmit,
    onToggleDictation,
    onAction,
    onSelectProduct,
    onAddToCart,
    onViewDetails,
    onOpenSupport,
    onConfirmPending,
    onCancelPending,
    onModifyPending,
}) => {
    const shellClassName = isWhiteMode
        ? 'border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.98))] text-slate-950 shadow-[0_28px_80px_rgba(15,23,42,0.16)]'
        : 'border-white/10 bg-[linear-gradient(180deg,rgba(6,10,24,0.98),rgba(8,15,31,0.98))] text-slate-100 shadow-[0_28px_90px_rgba(2,6,23,0.6)]';
    const mutedTextClass = isWhiteMode ? 'text-slate-500' : 'text-slate-400';
    const panelClassName = isWhiteMode
        ? 'border-slate-200 bg-white'
        : 'border-white/10 bg-white/[0.04]';
    const primaryButtonClass = isWhiteMode
        ? 'border-slate-950 bg-slate-950 text-white hover:bg-slate-800'
        : 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15';

    return (
        <div className={cn('pointer-events-auto flex h-[min(78vh,680px)] w-[min(92vw,420px)] flex-col overflow-hidden rounded-[1.9rem] border backdrop-blur-2xl', shellClassName)}>
            <header className="border-b border-white/10 px-4 py-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-black uppercase tracking-[0.18em]">Shopping Assistant</h3>
                            <span className={cn('rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]', panelClassName)}>
                                {modeLabel}
                            </span>
                        </div>
                        <p className={cn('mt-1 text-sm', mutedTextClass)}>{subtitle}</p>
                        <p className={cn('mt-2 text-[11px] font-medium uppercase tracking-[0.14em]', mutedTextClass)}>
                            {routeLabel}
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className={cn('rounded-full border p-2 transition-colors', panelClassName)}
                        aria-label="Close chat"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </header>

            <MultimodalDock isWhiteMode={isWhiteMode} />

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

            <div className="border-t border-white/10 px-4 py-4">
                <ActionBar
                    primaryAction={primaryAction}
                    secondaryActions={secondaryActions}
                    isWhiteMode={isWhiteMode}
                    isDisabled={isLoading}
                    onAction={onAction}
                />

                <form
                    onSubmit={onSubmit}
                    className={cn('mt-3 flex items-end gap-2 rounded-[1.35rem] border p-2', panelClassName)}
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
                        rows={Math.min(Math.max(String(inputValue || '').split('\n').length, 1), 4)}
                        placeholder={isListening ? 'Listening...' : 'Describe what you want, or tell me the issue to hand off.'}
                        disabled={isLoading}
                        className={cn(
                            'min-h-[52px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none',
                            mutedTextClass
                        )}
                    />

                    {supportsDictation ? (
                        <button
                            type="button"
                            onClick={onToggleDictation}
                            className={cn('rounded-full border p-2 transition-colors', isListening ? primaryButtonClass : panelClassName)}
                            aria-label={isListening ? 'Stop dictation' : 'Start dictation'}
                        >
                            {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        </button>
                    ) : null}

                    <button
                        type="submit"
                        disabled={!String(inputValue || '').trim() || isLoading}
                        className={cn('rounded-full border p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50', primaryButtonClass)}
                        aria-label="Send message"
                    >
                        <Send className="h-4 w-4" />
                    </button>
                </form>
            </div>
        </div>
    );
};

export default ChatContainer;
