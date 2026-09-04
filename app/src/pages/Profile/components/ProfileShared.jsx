import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMarket } from '@/context/MarketContext';
import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';

export function StatCard({ icon: Icon, label, value, color }) {
    const colorMap = {
        blue: 'border-blue-400/20 bg-blue-500/12 text-blue-200',
        green: 'border-emerald-400/20 bg-emerald-500/12 text-emerald-200',
        pink: 'border-pink-400/20 bg-pink-500/12 text-pink-200',
        purple: 'border-purple-400/20 bg-purple-500/12 text-purple-200',
        indigo: 'border-indigo-400/20 bg-indigo-500/12 text-indigo-200',
        emerald: 'border-emerald-400/20 bg-emerald-500/12 text-emerald-200',
        amber: 'border-amber-400/20 bg-amber-500/12 text-amber-200',
        cyan: 'border-cyan-400/20 bg-cyan-500/12 text-cyan-200',
    };
    const iconColor = colorMap[color] || colorMap.cyan;

    return (
        <div className="premium-stat-card premium-card-hover">
            <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${iconColor}`}>
                <Icon className="w-5 h-5" aria-hidden="true" />
            </div>
            <p className="mt-5 text-3xl font-black tracking-tight text-white">{value}</p>
            <p className="mt-1 text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{label}</p>
        </div>
    );
}

export function QuickLink({ to, icon: Icon, label, desc }) {
    const { t: legacyT } = useMarket();
    const t = useStableIcuMessages(legacyT);

    return (
        <Link to={to} className="premium-panel premium-card-hover group p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-neo-cyan">
                <Icon className="w-6 h-6 transition-transform duration-300 group-hover:scale-110" aria-hidden="true" />
            </div>
            <p className="mt-4 text-base font-black text-white">{label}</p>
            <p className="mt-1 text-sm text-slate-400">{desc}</p>
            <div className="mt-5 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-neo-cyan">
                {t('profile.shared.open', {}, 'Open')} <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </div>
        </Link>
    );
}

export function InfoRow({ icon: Icon, label, value, badge }) {
    const { t: legacyT } = useMarket();
    const t = useStableIcuMessages(legacyT);

    return (
        <div className="profile-premium-info-row">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-neo-cyan">
                <Icon className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="mb-1 text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{label}</p>
                <div className="text-sm font-semibold text-white">{value || t('profile.shared.notSet', {}, 'Not set')}</div>
            </div>
            {badge && <span className="premium-chip-muted mt-1 text-[10px] font-black uppercase tracking-[0.2em]">{badge}</span>}
        </div>
    );
}

export function EmptyState({ icon: Icon, title, body, action }) {
    return (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center">
            {Icon ? (
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#d2a96c]/25 bg-[#d2a96c]/10">
                    <Icon className="h-7 w-7 text-[#d2a96c]" aria-hidden="true" />
                </div>
            ) : null}
            <p className="text-lg font-black text-white">{title}</p>
            {body ? <p className="mx-auto mt-1 max-w-xs text-sm text-slate-400">{body}</p> : null}
            {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
        </div>
    );
}

export function SectionSkeleton({ rows = 3, label }) {
    return (
        <div role="status" aria-live="polite" className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            {label ? <p className="mb-4 text-sm text-slate-400">{label}</p> : null}
            <div className="grid gap-3" aria-hidden="true">
                {Array.from({ length: rows }).map((_, index) => (
                    <span
                        key={index}
                        className="h-14 animate-pulse rounded-xl border border-white/10 bg-white/5 motion-reduce:animate-none"
                    />
                ))}
            </div>
        </div>
    );
}

export function TogglePref({ label, desc, on, setOn }) {
    return (
        <div className="profile-premium-toggle-row">
            <div>
                <p className="text-sm font-semibold text-white">{label}</p>
                <p className="text-xs text-slate-400">{desc}</p>
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={Boolean(on)}
                aria-label={label}
                onClick={() => setOn(!on)}
                className={cn('profile-premium-toggle', on && 'profile-premium-toggle-on')}>
                <div aria-hidden="true" className={cn('profile-premium-toggle-thumb', on && 'profile-premium-toggle-thumb-on')} />
            </button>
        </div>
    );
}
