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
        : 'border-cyan-300/25 bg-[linear-gradient(135deg,rgba(34,211,238,0.22),rgba(16,185,129,0.14))] text-cyan-50 shadow-[0_12px_40px_rgba(34,211,238,0.12)] hover:bg-[linear-gradient(135deg,rgba(34,211,238,0.28),rgba(16,185,129,0.18))]';
    const secondaryClassName = isWhiteMode
        ? 'border-slate-200 bg-white text-slate-950 hover:bg-slate-100'
        : 'border-white/10 bg-white/[0.05] text-slate-100 hover:bg-white/[0.09]';

    return (
        <div className="flex flex-wrap gap-2.5">
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
                            'inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-xs font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm',
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
