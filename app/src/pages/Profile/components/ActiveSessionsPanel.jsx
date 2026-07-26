import { useMemo, useState } from 'react';
import { AlertTriangle, Clock3, Laptop, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';

const formatSessionDate = (value) => {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date);
};

export default function ActiveSessionsPanel({
    sessions = [],
    loading = false,
    loaded = false,
    error = null,
    action = '',
    onRetry,
    onRevokeSession,
    onRevokeOtherSessions,
}) {
    const [confirmingSessionId, setConfirmingSessionId] = useState('');
    const [confirmingOthers, setConfirmingOthers] = useState(false);
    const orderedSessions = useMemo(() => [...sessions].sort((left, right) => {
        if (Boolean(left?.current) !== Boolean(right?.current)) {
            return left?.current ? -1 : 1;
        }
        return Date.parse(right?.lastActiveAt || 0) - Date.parse(left?.lastActiveAt || 0);
    }), [sessions]);
    const otherSessionCount = orderedSessions.filter((session) => !session?.current).length;
    const errorMessage = String(error?.message || '').trim()
        || 'Your active sessions could not be loaded. No sessions were changed.';

    const requestSessionRevocation = async (session) => {
        if (confirmingSessionId !== session.id) {
            setConfirmingSessionId(session.id);
            setConfirmingOthers(false);
            return;
        }
        if (!onRevokeSession) return;
        try {
            await onRevokeSession(session);
            setConfirmingSessionId('');
        } catch {
            // Keep the confirmation visible so the user can retry or cancel.
        }
    };

    const requestOtherSessionRevocation = async () => {
        if (!confirmingOthers) {
            setConfirmingOthers(true);
            setConfirmingSessionId('');
            return;
        }
        if (!onRevokeOtherSessions) return;
        try {
            await onRevokeOtherSessions();
            setConfirmingOthers(false);
        } catch {
            // Keep the confirmation visible so the user can retry or cancel.
        }
    };

    return (
        <section
            aria-labelledby="active-sessions-heading"
            className="rounded-[1.6rem] border border-cyan-300/20 bg-cyan-400/[0.07] p-4"
        >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100">
                            <Laptop className="h-3.5 w-3.5" aria-hidden="true" />
                            {loaded ? `${orderedSessions.length} active` : 'Session inventory'}
                        </span>
                        {orderedSessions.some((session) => session?.current) ? (
                            <span className="text-xs font-semibold text-emerald-200">This session is protected</span>
                        ) : null}
                    </div>
                    <h4 id="active-sessions-heading" className="mt-3 flex items-center gap-2 text-sm font-black text-white">
                        <ShieldCheck className="h-4 w-4 text-cyan-100" aria-hidden="true" />
                        Active sessions
                    </h4>
                    <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-300">
                        These are signed-in browser sessions. They are separate from passkeys and remembered browsers, which identify or verify a device but do not prove that a session is still active.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={onRetry}
                    disabled={loading || !onRetry}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-black text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                    {loading ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {error ? (
                <div className="mt-4 flex gap-3 rounded-xl border border-rose-300/25 bg-rose-400/10 p-3 text-xs leading-5 text-rose-100" role="alert">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <p>{errorMessage}</p>
                </div>
            ) : null}

            {!loaded && loading ? (
                <div className="mt-4 grid gap-3" role="status" aria-live="polite" aria-label="Loading active sessions">
                    {[0, 1].map((item) => (
                        <div key={item} className="h-24 animate-pulse rounded-xl border border-white/10 bg-white/5 motion-reduce:animate-none" />
                    ))}
                </div>
            ) : null}

            {loaded && orderedSessions.length === 0 && !error ? (
                <div className="mt-4 rounded-xl border border-dashed border-white/15 bg-black/15 px-4 py-6 text-center">
                    <Laptop className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
                    <p className="mt-2 text-sm font-bold text-white">No active browser sessions found</p>
                    <p className="mt-1 text-xs text-slate-400">Refresh the page or sign in again if this browser should appear.</p>
                </div>
            ) : null}

            {orderedSessions.length > 0 ? (
                <div className="mt-4 grid gap-3">
                    {orderedSessions.map((session) => {
                        const isConfirming = confirmingSessionId === session.id;
                        const isWorking = action === `revoke:${session.id}`;
                        const clientLabel = [session.client, session.os].filter(Boolean).join(' on ') || 'Unknown browser';

                        return (
                            <article key={session.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-sm font-black text-white">{clientLabel}</p>
                                            {session.current ? (
                                                <span className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.15em] text-emerald-100">
                                                    Current
                                                </span>
                                            ) : null}
                                        </div>
                                        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                                            Last active {formatSessionDate(session.lastActiveAt)}
                                            <span aria-hidden="true">|</span>
                                            Started {formatSessionDate(session.createdAt)}
                                        </p>
                                        {isConfirming ? (
                                            <p className="mt-2 text-xs font-semibold text-rose-100">
                                                {session.current
                                                    ? 'This will sign you out on this browser.'
                                                    : 'This browser session will need to sign in again.'}
                                            </p>
                                        ) : null}
                                    </div>
                                    <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                                        <button
                                            type="button"
                                            onClick={() => requestSessionRevocation(session)}
                                            disabled={Boolean(action) || !onRevokeSession}
                                            aria-label={`${isConfirming ? 'Confirm sign out' : 'Sign out'} ${clientLabel}${session.current ? ' current session' : ''}`}
                                            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50 ${isConfirming ? 'border-rose-300/35 bg-rose-500/20 text-rose-50' : 'border-white/10 bg-white/5 text-white hover:bg-white/10'}`}
                                        >
                                            <LogOut className="h-4 w-4" aria-hidden="true" />
                                            {isWorking ? 'Signing out...' : isConfirming ? 'Confirm sign out' : 'Sign out'}
                                        </button>
                                        {isConfirming ? (
                                            <button
                                                type="button"
                                                onClick={() => setConfirmingSessionId('')}
                                                className="min-h-10 rounded-lg px-3 text-xs font-bold text-slate-300 hover:bg-white/5 hover:text-white"
                                            >
                                                Cancel
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            ) : null}

            {otherSessionCount > 0 ? (
                <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p className="text-sm font-black text-amber-50">Sign out other sessions</p>
                        <p className="mt-1 text-xs text-amber-100/80">Keep this browser signed in and revoke {otherSessionCount} other {otherSessionCount === 1 ? 'session' : 'sessions'}.</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:items-end">
                        <button
                            type="button"
                            onClick={requestOtherSessionRevocation}
                            disabled={Boolean(action) || !onRevokeOtherSessions}
                            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50 ${confirmingOthers ? 'border-rose-300/35 bg-rose-500/20 text-rose-50' : 'border-amber-200/25 bg-amber-300/10 text-amber-50 hover:bg-amber-300/15'}`}
                        >
                            <LogOut className="h-4 w-4" aria-hidden="true" />
                            {action === 'revoke-others'
                                ? 'Signing out...'
                                : confirmingOthers
                                    ? `Confirm sign out ${otherSessionCount}`
                                    : 'Sign out other sessions'}
                        </button>
                        {confirmingOthers ? (
                            <button
                                type="button"
                                onClick={() => setConfirmingOthers(false)}
                                className="min-h-10 rounded-lg px-3 text-xs font-bold text-amber-100/80 hover:bg-white/5 hover:text-white"
                            >
                                Cancel
                            </button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </section>
    );
}
