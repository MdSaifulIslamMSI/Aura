import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authApi, getDuoStepUpUrl } from '@/services/api/authApi';

const ADMIN_SECURITY_UI_ENABLED = String(
    import.meta.env.VITE_ADMIN_SECURITY_STATE_ENGINE_V2 || 'false'
).trim().toLowerCase() === 'true';

const STATE_COPY = {
    ACCOUNT_DISABLED: {
        badge: 'Account unavailable',
        title: 'This admin account cannot continue.',
        body: 'The server reports that the account is disabled or suspended. Contact a security administrator before trying again.',
    },
    EMAIL_VERIFICATION_REQUIRED: {
        badge: 'Identity check',
        title: 'Verify the admin email first.',
        body: 'Admin security setup starts only after the identity provider confirms this email address.',
    },
    NOT_AUTHORIZED_AS_ADMIN: {
        badge: 'Access denied',
        title: 'This account is not authorized for admin access.',
        body: 'Admin role and allowlist decisions come from the server and cannot be changed on this page.',
    },
    PRIMARY_REAUTH_REQUIRED: {
        badge: 'Fresh sign-in required',
        title: 'Sign in again before continuing.',
        body: 'Recovery and admin verification require a recent primary sign-in. Your destination will be preserved in memory for this sign-in flow.',
    },
    ADMIN_CHALLENGE_REQUIRED: {
        badge: 'Admin verification',
        title: 'Verify an approved admin factor.',
        body: 'Use the passkey registered for this browser, or complete Duo when it is available. Verification creates only a short-lived server session assurance.',
    },
    ADMIN_RECOVERY_REQUIRED: {
        badge: 'Supervised recovery',
        title: 'An approved admin factor must be enrolled.',
        body: 'Ask an authorized operator for a short-lived, one-time recovery grant. The grant can enroll a factor; it cannot open the admin console.',
    },
    ADMIN_ENROLLMENT_REQUIRED: {
        badge: 'Enroll admin passkey',
        title: 'Create the required admin passkey.',
        body: 'Your recovery grant is now bound to this browser session. Complete the passkey ceremony before the authority expires.',
    },
    ADMIN_PROVIDER_UNAVAILABLE: {
        badge: 'Provider unavailable',
        title: 'Admin verification is temporarily unavailable.',
        body: 'The server cannot reach or safely configure an approved admin verification provider. Access remains locked.',
    },
    ADMIN_SECURITY_CONFIGURATION_ERROR: {
        badge: 'Configuration lock',
        title: 'Admin security configuration is incomplete.',
        body: 'The backend failed its admin security contract. Access remains locked until an operator repairs the configuration.',
    },
};

const normalizeError = (error) => {
    if (error?.name === 'NotAllowedError') {
        return 'The passkey prompt was cancelled, timed out, or could not use this authenticator. No security state was changed.';
    }
    return error?.data?.message || error?.message || 'The security checkpoint could not be completed.';
};

const safeReturnPath = (location) => {
    const candidate = `${location?.pathname || '/admin'}${location?.search || ''}${location?.hash || ''}`;
    return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : '/admin';
};

export const AdminSecurityCheckpoint = ({ auth, children }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const mountedRef = useRef(true);
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(ADMIN_SECURITY_UI_ENABLED);
    const [busy, setBusy] = useState('');
    const [grant, setGrant] = useState('');
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        if (!ADMIN_SECURITY_UI_ENABLED) return;
        setLoading(true);
        setError('');
        try {
            const next = await authApi.getAdminSecurityStatus({
                firebaseUser: auth?.currentUser,
                useFirebaseBearer: true,
            });
            if (mountedRef.current) setStatus(next);
        } catch (requestError) {
            if (mountedRef.current) setError(normalizeError(requestError));
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [auth?.currentUser]);

    useEffect(() => {
        mountedRef.current = true;
        refresh();
        return () => {
            mountedRef.current = false;
        };
    }, [refresh]);

    if (!ADMIN_SECURITY_UI_ENABLED) return children;
    if (!loading && status?.enabled === true && status?.state === 'ADMIN_VERIFIED') return children;

    const state = status?.enabled === false
        ? 'ADMIN_SECURITY_CONFIGURATION_ERROR'
        : (status?.state || '');
    const copy = STATE_COPY[state] || {
        badge: 'Admin security checkpoint',
        title: 'Checking admin security state.',
        body: 'The server is resolving the required verification path.',
    };
    const returnTo = safeReturnPath(location);

    const run = async (name, operation, { signOutAfter = false } = {}) => {
        if (busy) return;
        setBusy(name);
        setError('');
        try {
            await operation();
            if (signOutAfter) {
                setGrant('');
                await Promise.resolve(auth?.logout?.()).catch(() => {});
                navigate('/login', { replace: true, state: { from: returnTo } });
                return;
            }
            await refresh();
        } catch (operationError) {
            setError(normalizeError(operationError));
        } finally {
            if (mountedRef.current) setBusy('');
        }
    };

    const signOut = () => {
        setGrant('');
        Promise.resolve(auth?.logout?.())
            .catch(() => {})
            .finally(() => navigate('/login', { replace: true, state: { from: returnTo } }));
    };

    return (
        <main className="flex min-h-[72vh] items-center justify-center bg-slate-950 px-4 py-12 text-slate-100">
            <section
                className="w-full max-w-2xl rounded-3xl border border-cyan-300/15 bg-slate-950/90 p-6 shadow-glass sm:p-9"
                aria-labelledby="admin-security-title"
                aria-busy={loading || Boolean(busy)}
            >
                <div className="inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-cyan-100">
                    {loading ? 'Checking server policy' : copy.badge}
                </div>
                <h1 id="admin-security-title" className="mt-5 text-3xl font-black text-white">
                    {loading ? 'Resolving the admin checkpoint…' : copy.title}
                </h1>
                <p className="mt-4 text-sm leading-6 text-slate-300">
                    {loading ? 'No admin content is loaded until the backend returns an authoritative security state.' : copy.body}
                </p>

                {state === 'ADMIN_RECOVERY_REQUIRED' ? (
                    <form
                        className="mt-7 rounded-2xl border border-white/10 bg-white/[0.035] p-5"
                        onSubmit={(event) => {
                            event.preventDefault();
                            run('exchange', async () => {
                                await authApi.exchangeAdminRecoveryGrant(grant, {
                                    firebaseUser: auth?.currentUser,
                                });
                                setGrant('');
                            });
                        }}
                    >
                        <label htmlFor="admin-recovery-grant" className="block text-sm font-bold text-white">
                            One-time recovery grant
                        </label>
                        <p id="admin-recovery-help" className="mt-2 text-xs leading-5 text-slate-400">
                            Paste the operator-issued grant. It stays only in this field until exchange and is never saved in browser storage.
                        </p>
                        <input
                            id="admin-recovery-grant"
                            type="password"
                            autoComplete="off"
                            spellCheck="false"
                            value={grant}
                            onChange={(event) => setGrant(event.target.value)}
                            aria-describedby="admin-recovery-help"
                            className="mt-4 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 font-mono text-sm text-white outline-none ring-cyan-300/50 focus:ring-2"
                        />
                        <button
                            type="submit"
                            disabled={busy || grant.trim().length < 32}
                            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-cyan-300 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                            {busy === 'exchange' ? 'Exchanging…' : 'Continue to passkey setup'}
                        </button>
                    </form>
                ) : null}

                {!loading && state === 'ADMIN_ENROLLMENT_REQUIRED' ? (
                    <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => run('enroll', () => authApi.enrollAdminRecoveryPasskey({
                            firebaseUser: auth?.currentUser,
                        }), { signOutAfter: true })}
                        className="mt-7 inline-flex min-h-11 items-center justify-center rounded-full bg-cyan-300 px-6 py-3 text-sm font-black uppercase tracking-[0.14em] text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                        {busy === 'enroll' ? 'Waiting for passkey…' : 'Set up admin passkey'}
                    </button>
                ) : null}

                {!loading && state === 'ADMIN_CHALLENGE_REQUIRED' ? (
                    <div className="mt-7 flex flex-wrap gap-3">
                        {status?.actions?.canChallengePasskey ? (
                            <button
                                type="button"
                                disabled={Boolean(busy)}
                                onClick={() => run('verify', () => authApi.verifyAdminPasskey({
                                    firebaseUser: auth?.currentUser,
                                }))}
                                className="inline-flex min-h-11 items-center justify-center rounded-full bg-cyan-300 px-6 py-3 text-sm font-black uppercase tracking-[0.14em] text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                                {busy === 'verify' ? 'Waiting for passkey…' : 'Verify with passkey'}
                            </button>
                        ) : null}
                        {status?.actions?.canUseDuo ? (
                            <a
                                href={getDuoStepUpUrl(returnTo, { action: 'admin-sensitive' })}
                                className="inline-flex min-h-11 items-center justify-center rounded-full border border-cyan-300/25 bg-cyan-300/10 px-6 py-3 text-sm font-black uppercase tracking-[0.14em] text-cyan-100"
                            >
                                Verify with Duo
                            </a>
                        ) : null}
                    </div>
                ) : null}

                {!loading && state === 'PRIMARY_REAUTH_REQUIRED' ? (
                    <button
                        type="button"
                        onClick={signOut}
                        className="mt-7 inline-flex min-h-11 items-center justify-center rounded-full bg-cyan-300 px-6 py-3 text-sm font-black uppercase tracking-[0.14em] text-slate-950"
                    >
                        Sign in again
                    </button>
                ) : null}

                {error ? (
                    <div role="alert" className="mt-5 rounded-xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm leading-6 text-rose-100">
                        {error}
                    </div>
                ) : null}

                <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-white/10 pt-5">
                    <button
                        type="button"
                        onClick={refresh}
                        disabled={loading || Boolean(busy)}
                        className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-slate-200 disabled:opacity-45"
                    >
                        Retry server check
                    </button>
                    <button
                        type="button"
                        onClick={signOut}
                        className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-slate-300"
                    >
                        Sign out
                    </button>
                    <a href="/" className="px-2 py-2 text-xs font-bold text-cyan-200 hover:text-white">
                        Return to storefront
                    </a>
                </div>

                {status?.requestId ? (
                    <p className="mt-5 text-[11px] text-slate-500">Request ID: {status.requestId}</p>
                ) : null}
            </section>
        </main>
    );
};

export default AdminSecurityCheckpoint;
