import { CheckCircle2, Clock3, X } from 'lucide-react';

export const getStatusBadge = (status, t) => {
    switch (status) {
        case 'resolved':
            return (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-500/12 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-100">
                    <CheckCircle2 className="h-3 w-3" /> {t('profile.support.status.resolved', {}, 'Resolved')}
                </span>
            );
        case 'closed':
            return (
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-400/20 bg-slate-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-300">
                    <X className="h-3 w-3" /> {t('profile.support.status.closed', {}, 'Closed')}
                </span>
            );
        default:
            return (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-500/12 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-amber-100">
                    <Clock3 className="h-3 w-3" /> {t('profile.support.status.open', {}, 'Open')}
                </span>
            );
    }
};
