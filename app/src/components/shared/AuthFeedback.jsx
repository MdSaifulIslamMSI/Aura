import { AlertCircle, CheckCircle2, ArrowRight, RefreshCw, WifiOff, Lock, UserX, Clock, ShieldX } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Picks an icon based on error title/type
 */
const getErrorIcon = (title = '') => {
    const t = title.toLowerCase();
    if (t.includes('expired') || t.includes('time')) return <Clock className="w-5 h-5 flex-shrink-0" />;
    if (t.includes('locked') || t.includes('attempts')) return <Lock className="w-5 h-5 flex-shrink-0" />;
    if (t.includes('not found') || t.includes('not registered')) return <UserX className="w-5 h-5 flex-shrink-0" />;
    if (t.includes('connection') || t.includes('network')) return <WifiOff className="w-5 h-5 flex-shrink-0" />;
    if (t.includes('mismatch') || t.includes('session')) return <ShieldX className="w-5 h-5 flex-shrink-0" />;
    return <AlertCircle className="w-5 h-5 flex-shrink-0" />;
};

/**
 * AuthFeedback — Rich error/success banner for auth flows.
 *
 * Props:
 *   type: 'error' | 'success'
 *   title: string
 *   detail: string
 *   hint: string (optional)
 *   actionLabel: string (optional — button text)
 *   onAction: () => void (optional — button callback)
 *   compact: bool — smaller version for modals
 */
export const AuthFeedback = ({
    type = 'error',
    title,
    detail,
    hint,
    actionLabel,
    onAction,
    compact = false,
}) => {
    const isError = type === 'error';
    const safeTitle = (title && typeof title === 'object') ? String(title.message || title) : (title || '');
    const safeDetail = (detail && typeof detail === 'object') ? String(detail.message || detail) : (detail || '');
    const safeHint = (hint && typeof hint === 'object') ? String(hint.message || hint) : (hint || '');

    return (
        <div
            className={cn(
                'rounded-2xl border animate-fade-in w-full',
                compact ? 'p-3.5' : 'p-5',
                isError
                    ? 'bg-rose-950/30 border-rose-500/25 shadow-[0_0_20px_rgba(244,63,94,0.08)]'
                    : 'bg-emerald-950/30 border-emerald-500/25 shadow-[0_0_20px_rgba(16,185,129,0.08)]'
            )}
        >
            {/* Top row: icon + title */}
            <div className="flex items-start gap-3">
                <span className={isError ? 'text-rose-400 mt-0.5' : 'text-emerald-400 mt-0.5'}>
                    {isError ? getErrorIcon(safeTitle) : <CheckCircle2 className="w-5 h-5 flex-shrink-0" />}
                </span>
                <div className="flex-1 min-w-0">
                    <p className={cn(
                        'font-bold leading-tight',
                        compact ? 'text-sm' : 'text-sm',
                        isError ? 'text-rose-300' : 'text-emerald-300'
                    )}>
                        {safeTitle}
                    </p>

                    {/* Detail line */}
                    {safeDetail && (
                        <p className={cn(
                            'mt-1 leading-snug',
                            compact ? 'text-xs' : 'text-xs',
                            'text-slate-400'
                        )}>
                            {safeDetail}
                        </p>
                    )}

                    {/* Hint line — what to do next */}
                    {safeHint && isError && (
                        <p className={cn(
                            'mt-2 leading-snug font-medium',
                            compact ? 'text-xs' : 'text-xs',
                            'text-slate-300'
                        )}>
                            💡 {safeHint}
                        </p>
                    )}
                </div>
            </div>

            {/* Action button */}
            {actionLabel && onAction && isError && (
                <button
                    type="button"
                    onClick={onAction}
                    className={cn(
                        'mt-3 flex items-center gap-1.5 font-bold uppercase tracking-wider transition-colors',
                        compact ? 'text-[10px]' : 'text-[11px]',
                        'text-rose-400 hover:text-rose-200'
                    )}
                >
                    <ArrowRight className="w-3 h-3" />
                    {actionLabel}
                </button>
            )}
        </div>
    );
};

export default AuthFeedback;
