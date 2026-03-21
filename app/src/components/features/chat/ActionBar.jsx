import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const ActionBar = ({
    primaryAction = null,
    secondaryActions = [],
    isWhiteMode = false,
    isDisabled = false,
    onAction,
}) => {
    const actions = [primaryAction, ...(Array.isArray(secondaryActions) ? secondaryActions : [])].filter(Boolean).slice(0, 3);
    if (actions.length === 0) return null;

    const primaryClassName = isWhiteMode
        ? 'border-slate-950 bg-slate-950 text-white hover:bg-slate-800'
        : 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15';
    const secondaryClassName = isWhiteMode
        ? 'border-slate-200 bg-white text-slate-950 hover:bg-slate-100'
        : 'border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]';

    return (
        <div className="flex flex-wrap gap-2">
            {actions.map((action, index) => {
                const isPrimary = index === 0 && primaryAction?.id === action.id;

                return (
                    <button
                        key={action.id}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => onAction?.(action)}
                        data-tone={isPrimary ? 'primary' : 'secondary'}
                        className={cn(
                            'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                            isPrimary ? primaryClassName : secondaryClassName
                        )}
                    >
                        {action.label}
                        <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                );
            })}
        </div>
    );
};

export default ActionBar;
