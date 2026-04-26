import { ArrowUpRight, LifeBuoy, PackageSearch } from 'lucide-react';
import { cn } from '@/lib/utils';

const SupportHandoffCard = ({ prefill, orderId = '', isWhiteMode = false, onOpenSupport }) => {
    if (!prefill && !orderId) return null;

    const cardClassName = isWhiteMode
        ? 'assistant-support-card border-slate-200 bg-white text-slate-950'
        : 'assistant-support-card border-white/10 bg-white/[0.04] text-slate-100';
    const mutedTextClass = isWhiteMode ? 'text-slate-600' : 'text-slate-300';
    const buttonClassName = isWhiteMode
        ? 'border-slate-950 bg-slate-950 text-white hover:bg-slate-800'
        : 'assistant-support-card__button border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]';

    return (
        <div className={cn('rounded-[1.35rem] border p-4 shadow-sm', cardClassName)}>
            <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-current/15">
                    <LifeBuoy className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">Dedicated support handoff</p>
                    <p className={cn('mt-1 text-xs leading-5', mutedTextClass)}>
                        {orderId
                            ? 'This request is tied to a specific order, so I will take you into the order support surface instead of the generic desk.'
                            : 'Keep shopping clean and send this issue to the support desk with the context already filled in.'}
                    </p>

                    <div className="mt-3 grid gap-2 text-xs">
                        {orderId ? (
                            <div>
                                <span className={cn('font-semibold', mutedTextClass)}>Order</span>
                                <p className="mt-0.5 inline-flex items-center gap-1.5">
                                    <PackageSearch className="h-3.5 w-3.5" />
                                    {orderId}
                                </p>
                            </div>
                        ) : null}
                        <div>
                            <span className={cn('font-semibold', mutedTextClass)}>Category</span>
                            <p className="mt-0.5">{prefill?.category || 'general'}</p>
                        </div>
                        <div>
                            <span className={cn('font-semibold', mutedTextClass)}>Subject</span>
                            <p className="mt-0.5 line-clamp-2">{prefill?.subject || 'Support request'}</p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => onOpenSupport?.(prefill, orderId)}
                        className={cn('mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors', buttonClassName)}
                    >
                        {orderId ? 'Open order support' : 'Open support desk'}
                        <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SupportHandoffCard;
