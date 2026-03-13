import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function StatCard({ icon: Icon, label, value, color }) {
    const colorMap = {
        blue: 'bg-blue-50 text-blue-600',
        green: 'bg-green-50 text-green-600',
        pink: 'bg-pink-50 text-pink-600',
        purple: 'bg-purple-50 text-purple-600',
        indigo: 'bg-indigo-50 text-indigo-600',
        emerald: 'bg-emerald-50 text-emerald-600',
        amber: 'bg-amber-50 text-amber-600',
        cyan: 'bg-cyan-50 text-cyan-600',
    };
    const iconColor = colorMap[color] || colorMap.blue;

    return (
        <div className="premium-stat-card premium-card-hover">
            <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 ${iconColor}`}>
                <Icon className="w-5 h-5" />
            </div>
            <p className="mt-5 text-3xl font-black tracking-tight text-white">{value}</p>
            <p className="mt-1 text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{label}</p>
        </div>
    );
}

export function QuickLink({ to, icon: Icon, label, desc }) {
    return (
        <Link to={to} className="premium-panel premium-card-hover group p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-neo-cyan">
                <Icon className="w-6 h-6 transition-transform duration-300 group-hover:scale-110" />
            </div>
            <p className="mt-4 text-base font-black text-white">{label}</p>
            <p className="mt-1 text-sm text-slate-400">{desc}</p>
            <div className="mt-5 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-neo-cyan">
                Open <ChevronRight className="w-4 h-4" />
            </div>
        </Link>
    );
}

export function InfoRow({ icon: Icon, label, value, badge }) {
    return (
        <div className="profile-premium-info-row">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-neo-cyan">
                <Icon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="mb-1 text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{label}</p>
                <div className="text-sm font-semibold text-white">{value || 'Not set'}</div>
            </div>
            {badge && <span className="premium-chip-muted mt-1 text-[10px] font-black uppercase tracking-[0.2em]">{badge}</span>}
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
            <button onClick={() => setOn(!on)}
                className={cn('profile-premium-toggle', on && 'profile-premium-toggle-on')}>
                <div className={cn('profile-premium-toggle-thumb', on && 'profile-premium-toggle-thumb-on')} />
            </button>
        </div>
    );
}
