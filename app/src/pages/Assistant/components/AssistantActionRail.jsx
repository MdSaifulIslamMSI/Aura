import { ArrowRight, LifeBuoy } from 'lucide-react';

const AssistantActionRail = ({
    handleAction,
    isLoading,
    lastAssistantWithActions,
}) => (
    <aside className="space-y-4">
        <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Next actions</p>
            <div className="mt-4 space-y-2">
                {lastAssistantWithActions?.actions?.length ? lastAssistantWithActions.actions.map((action) => (
                    <button
                        key={`${lastAssistantWithActions.id}-${action.type}-${action.productId || action.category || action.label}`}
                        type="button"
                        onClick={() => void handleAction(action, lastAssistantWithActions.supportDraft)}
                        disabled={isLoading}
                        className="flex w-full items-center justify-between rounded-[1rem] border border-white/10 bg-slate-950/40 px-4 py-3 text-left text-sm font-semibold text-white transition-colors hover:bg-white/[0.06] disabled:opacity-60"
                    >
                        <span>{action.label || action.type.replace(/_/g, ' ')}</span>
                        <ArrowRight className="h-4 w-4 text-slate-400" />
                    </button>
                )) : (
                    <p className="text-sm leading-6 text-slate-400">
                        The assistant will surface typed CTAs here when it has a grounded next move.
                    </p>
                )}
            </div>
        </div>

        <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Support boundary</p>
            <div className="mt-4 rounded-[1rem] border border-white/10 bg-slate-950/40 p-4">
                <div className="flex items-center gap-2 text-amber-100">
                    <LifeBuoy className="h-4 w-4" />
                    <p className="text-sm font-black text-white">Structured handoff only</p>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                    Shopping stays here. When the flow becomes a support job, the assistant drafts the handoff and sends
                    you into the dedicated support desk.
                </p>
            </div>
        </div>
    </aside>
);

export default AssistantActionRail;
