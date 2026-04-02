import { ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import AssistantCardRenderer from './AssistantCardRenderer';

const AssistantThreadPanel = ({
    handleAction,
    handleSubmit,
    inputValue,
    isLoading,
    messages,
    sessionId,
    setInputValue,
}) => (
    <section className="min-w-0">
        <div className="flex h-full min-h-[68vh] flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(8,12,24,0.96),rgba(9,16,30,0.98))] shadow-[0_28px_90px_rgba(2,6,23,0.5)]">
            <div className="border-b border-white/10 px-5 py-4">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-200">Thread</p>
                <p className="mt-2 text-sm text-slate-400">
                    Session id: <span className="font-mono text-slate-200">{sessionId || 'new session'}</span>
                </p>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
                {messages.map((message) => (
                    <div key={message.id} className={cn('max-w-[48rem]', message.role === 'user' ? 'ml-auto' : 'mr-auto')}>
                        <div
                            className={cn(
                                'rounded-[1.5rem] border px-4 py-3',
                                message.role === 'user'
                                    ? 'border-cyan-300/20 bg-cyan-400/12 text-cyan-50'
                                    : 'border-white/10 bg-white/[0.04] text-slate-100'
                            )}
                        >
                            <p className="text-sm leading-7">{message.text}</p>
                            {message.telemetry ? (
                                <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                                    {message.telemetry.source} | {message.telemetry.retrievalHits} hits | {message.telemetry.latencyMs} ms
                                </p>
                            ) : null}
                        </div>
                        {Array.isArray(message.cards) && message.cards.length > 0 ? (
                            <div className="mt-3 space-y-3">
                                {message.cards.map((card) => (
                                    <AssistantCardRenderer
                                        key={card.id || `${message.id}-${card.type}`}
                                        card={card}
                                        onAction={(action) => void handleAction(action, message.supportDraft)}
                                        isBusy={isLoading}
                                    />
                                ))}
                            </div>
                        ) : null}
                    </div>
                ))}

                {isLoading ? (
                    <div className="mr-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-300">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Thinking through the next commerce move
                    </div>
                ) : null}
            </div>

            <div className="border-t border-white/10 px-5 py-4">
                <form onSubmit={handleSubmit} className="space-y-3">
                    <textarea
                        value={inputValue}
                        onChange={(event) => setInputValue(event.target.value)}
                        rows={Math.min(Math.max(String(inputValue || '').split('\n').length, 2), 5)}
                        placeholder="Ask for recommendations, a compare, a cart review, or a support handoff..."
                        disabled={isLoading}
                        className="min-h-[96px] w-full resize-none rounded-[1.4rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                            Ephemeral shopping session. Support escalation creates the durable record.
                        </p>
                        <button
                            type="submit"
                            disabled={!String(inputValue || '').trim() || isLoading}
                            className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/12 px-5 py-3 text-sm font-black uppercase tracking-[0.16em] text-cyan-100 transition-colors hover:bg-cyan-400/18 disabled:opacity-60"
                        >
                            Ask assistant
                            <ArrowRight className="h-4 w-4" />
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </section>
);

export default AssistantThreadPanel;
