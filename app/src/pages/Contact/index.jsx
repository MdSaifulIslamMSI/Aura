import { useContext, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
    AlertTriangle,
    ArrowRight,
    LifeBuoy,
    Mail,
    Phone,
    RefreshCw,
    ShieldAlert,
    ShieldCheck,
} from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';
import SupportSection from '@/pages/Profile/components/SupportSection';

const SUPPORT_CHANNELS = [
    {
        label: 'Support email',
        value: 'support@aura.shop',
        href: 'mailto:support@aura.shop',
        icon: Mail,
        detail: 'Use this if the in-app desk cannot load or you need a written audit trail immediately.',
    },
    {
        label: 'Helpline',
        value: '1-800-AURA-01',
        href: 'tel:1-800-AURA-01',
        icon: Phone,
        detail: 'Use the live line for suspicious OTP, blocked checkout, or urgent recovery help.',
    },
];

const buildRouteState = (location) => ({
    pathname: location?.pathname || '/contact',
    search: location?.search || '',
    hash: location?.hash || '',
});

export default function ContactPage() {
    const { currentUser, dbUser, status, sessionError, refreshSession } = useContext(AuthContext);
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const [retrying, setRetrying] = useState(false);

    const supportLaunch = useMemo(() => ({
        focusTicketId: String(searchParams.get('ticket') || '').trim(),
        startCompose: searchParams.get('compose') === '1',
        prefill: {
            category: String(searchParams.get('category') || '').trim(),
            relatedActionId: String(searchParams.get('actionId') || '').trim(),
            subject: String(searchParams.get('subject') || '').trim(),
            intent: String(searchParams.get('intent') || '').trim(),
        },
    }), [searchParams]);

    const blockedBySessionRecovery = Boolean(currentUser && status === 'recoverable_error');

    const handleRetrySession = async () => {
        if (!currentUser || retrying) return;

        try {
            setRetrying(true);
            await refreshSession(currentUser, { force: true });
        } catch {
            // Keep the support desk available even if session repair continues to fail.
        } finally {
            setRetrying(false);
        }
    };

    return (
        <div className="min-h-screen bg-zinc-950 text-slate-100">
            <div className="relative overflow-hidden border-b border-white/10">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(245,158,11,0.15),transparent_34%)] pointer-events-none" />
                <div className="relative z-10 mx-auto max-w-7xl px-4 py-14 sm:py-16">
                    <div className="flex flex-wrap items-center gap-3">
                        <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-400/12 px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-cyan-100">
                            <LifeBuoy className="h-3.5 w-3.5" />
                            Admin Support Access
                        </span>
                        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] ${
                            blockedBySessionRecovery
                                ? 'border-amber-300/25 bg-amber-400/12 text-amber-100'
                                : currentUser
                                    ? 'border-emerald-300/25 bg-emerald-500/12 text-emerald-100'
                                    : 'border-white/10 bg-white/5 text-slate-300'
                        }`}>
                            {blockedBySessionRecovery ? <ShieldAlert className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                            {blockedBySessionRecovery ? 'Recovery-safe route' : currentUser ? 'In-app support active' : 'Public contact route'}
                        </span>
                    </div>

                    <h1 className="mt-5 max-w-4xl text-4xl font-black tracking-tight text-white sm:text-5xl">
                        Reach a real support queue when checkout, account, or governance issues block you.
                    </h1>
                    <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
                        This page is the operational handoff into Aura support. Tickets opened here are durable, visible to the admin support desk, and can escalate into a live support call when text alone is too slow.
                    </p>

                    {blockedBySessionRecovery ? (
                        <div className="mt-6 max-w-4xl rounded-[1.8rem] border border-amber-300/20 bg-amber-500/10 p-5">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-sm font-black text-amber-100">
                                        <AlertTriangle className="h-4 w-4" />
                                        Session recovery is degraded, but support access is still open.
                                    </div>
                                    <p className="mt-2 text-sm leading-6 text-amber-50/90">
                                        {sessionError?.message || 'Aura could not finish resolving the commerce profile for this session.'}
                                    </p>
                                    <p className="mt-2 text-xs uppercase tracking-[0.18em] text-amber-100/70">
                                        Open a ticket below and the admin queue can continue the recovery path.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleRetrySession}
                                    disabled={retrying}
                                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-5 py-3 text-sm font-black text-amber-50 transition-colors hover:bg-amber-300/16 disabled:opacity-60"
                                >
                                    {retrying ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                    Retry session sync
                                </button>
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>

            <div className="mx-auto max-w-7xl px-4 py-8 sm:py-10">
                <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
                    <aside className="space-y-4">
                        {SUPPORT_CHANNELS.map((channel) => {
                            const Icon = channel.icon;
                            return (
                                <a
                                    key={channel.label}
                                    href={channel.href}
                                    className="block rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-5 transition-colors hover:bg-white/[0.05]"
                                >
                                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-cyan-100">
                                        <Icon className="h-5 w-5" />
                                    </div>
                                    <p className="mt-4 text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">{channel.label}</p>
                                    <p className="mt-2 text-lg font-black text-white">{channel.value}</p>
                                    <p className="mt-2 text-sm leading-6 text-slate-400">{channel.detail}</p>
                                </a>
                            );
                        })}

                        <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-5">
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">What happens next</p>
                            <div className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                                <p>1. Open or continue a support thread.</p>
                                <p>2. Admin replies stay attached to the same ticket.</p>
                                <p>3. If needed, the ticket can escalate into a live support call.</p>
                            </div>
                            <Link
                                to="/security"
                                className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-cyan-100 transition-colors hover:text-white"
                            >
                                Review security policy
                                <ArrowRight className="h-4 w-4" />
                            </Link>
                        </div>
                    </aside>

                    <section>
                        {currentUser ? (
                            <SupportSection
                                profile={dbUser}
                                focusTicketId={supportLaunch.focusTicketId}
                                startCompose={supportLaunch.startCompose}
                                prefill={supportLaunch.prefill}
                            />
                        ) : (
                            <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 sm:p-8">
                                <div className="max-w-3xl">
                                    <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Sign-in required for tracked admin replies</p>
                                    <h2 className="mt-3 text-3xl font-black text-white">Use sign-in if you want a persistent support thread.</h2>
                                    <p className="mt-4 text-sm leading-7 text-slate-300">
                                        The direct email and helpline above always work. To create an in-app ticket that admins can answer, escalate, and keep attached to your account history, sign in first and we will bring you straight back here.
                                    </p>
                                    <div className="mt-6 flex flex-wrap gap-3">
                                        <Link
                                            to="/login"
                                            state={{ from: buildRouteState(location) }}
                                            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-emerald-400 px-5 py-3 text-sm font-black text-[#051018] shadow-[0_18px_40px_rgba(34,211,238,0.22)] transition-transform hover:scale-[1.01]"
                                        >
                                            Sign in for support
                                        </Link>
                                        <a
                                            href="mailto:support@aura.shop"
                                            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-white/10"
                                        >
                                            Email support
                                        </a>
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}
