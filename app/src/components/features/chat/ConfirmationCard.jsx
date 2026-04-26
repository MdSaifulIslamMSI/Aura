import { CheckCircle2, PauseCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const ConfirmationCard = ({
    confirmation,
    isWhiteMode = false,
    onConfirm,
    onCancel,
    onModify,
}) => {
    if (!confirmation?.action) return null;

    const cardClassName = isWhiteMode
        ? 'assistant-confirm-card border-slate-200 bg-white text-slate-950'
        : 'assistant-confirm-card border-white/10 bg-white/[0.04] text-slate-100';
    const mutedTextClass = isWhiteMode ? 'text-slate-600' : 'text-slate-300';
    const confirmClassName = isWhiteMode
        ? 'border-slate-950 bg-slate-950 text-white hover:bg-slate-800'
        : 'assistant-confirm-card__primary border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]';
    const cancelClassName = isWhiteMode
        ? 'border-slate-200 bg-white text-slate-950 hover:bg-slate-100'
        : 'border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]';

    return (
        <div className={cn('rounded-[1.35rem] border p-4 shadow-sm', cardClassName)}>
            <p className="text-sm font-bold">Confirmation required</p>
            <p className={cn('mt-2 text-xs leading-5', mutedTextClass)}>
                {confirmation.message || 'Please confirm before I continue.'}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => onConfirm?.(confirmation.token)}
                    className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors', confirmClassName)}
                >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Confirm
                </button>
                <button
                    type="button"
                    onClick={() => onCancel?.()}
                    className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors', cancelClassName)}
                >
                    <PauseCircle className="h-3.5 w-3.5" />
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={() => onModify?.()}
                    className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors', cancelClassName)}
                >
                    <PauseCircle className="h-3.5 w-3.5" />
                    Modify
                </button>
            </div>
        </div>
    );
};

export default ConfirmationCard;
