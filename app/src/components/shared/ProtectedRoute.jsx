import { useContext } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
import { useMarket } from '@/context/MarketContext';
import { buildSupportHandoffPath } from '@/utils/assistantCommands';

const AUTH_BOOTSTRAP_STATES = new Set(['bootstrap', 'loading']);

const AuthPendingState = ({ message = 'Resolving your session...', title = 'Session checkpoint' }) => (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.045] p-8 text-center shadow-glass">
            <div className="mx-auto h-12 w-12 rounded-full border-4 border-neo-cyan/70 border-t-transparent animate-spin" />
            <h2 className="mt-5 text-xl font-black text-white">{title}</h2>
            <p className="mt-2 text-sm text-slate-400">{message}</p>
        </div>
    </div>
);

const toRouteState = (location) => ({
    pathname: location?.pathname || '/',
    search: location?.search || '',
    hash: location?.hash || '',
});

const buildRecoverySupportPath = (location, sessionError) => {
    const blockedPath = `${location?.pathname || '/'}${location?.search || ''}${location?.hash || ''}`;
    const normalizedMessage = String(sessionError?.message || '')
        .replace(/\s+/g, ' ')
        .trim();

    return buildSupportHandoffPath({
        category: 'general_support',
        subject: 'Support: Session sync blocked account access',
        intent: normalizedMessage
            ? `Blocked from ${blockedPath} because the session sync could not finish. Error: ${normalizedMessage}`.slice(0, 320)
            : `Blocked from ${blockedPath} because the session sync could not finish.`.slice(0, 320),
    });
};

const AuthRecoveryState = ({
    message,
    onRetry,
    onResetSignIn,
    onOpenSupport,
    badge = 'Recoverable session issue',
    title = 'This account needs a fresh session sync.',
    fallbackMessage = 'The identity provider succeeded, but the commerce profile could not be resolved yet.',
    hint = 'If retry keeps failing, reset the sign-in flow and we will bring you back to the same page after login.',
    supportHint = 'Need a real escalation path? Open the admin support desk from here. Tickets created there stay visible to the support team even when profile sync is degraded.',
    retryLabel = 'Retry session sync',
    supportLabel = 'Open admin support',
    resetLabel = 'Reset sign-in',
}) => (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-lg rounded-3xl border border-amber-300/15 bg-zinc-950/70 p-8 shadow-glass">
            <div className="inline-flex rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-amber-200">
                {badge}
            </div>
            <h2 className="mt-4 text-2xl font-black text-white">{title}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
                {message || fallbackMessage}
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-400">
                {hint}
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-400">
                {supportHint}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
                <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.06] px-5 py-3 text-sm font-black uppercase tracking-[0.18em] text-neo-cyan transition-colors hover:bg-white/[0.1]"
                >
                    {retryLabel}
                </button>
                <button
                    type="button"
                    onClick={onOpenSupport}
                    className="inline-flex items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-400/12 px-5 py-3 text-sm font-black uppercase tracking-[0.18em] text-cyan-100 transition-colors hover:bg-cyan-400/18"
                >
                    {supportLabel}
                </button>
                <button
                    type="button"
                    onClick={onResetSignIn}
                    className="inline-flex items-center justify-center rounded-full border border-amber-300/20 bg-amber-300/10 px-5 py-3 text-sm font-black uppercase tracking-[0.18em] text-amber-100 transition-colors hover:bg-amber-300/16"
                >
                    {resetLabel}
                </button>
            </div>
            <div className="mt-5 flex flex-wrap gap-4 text-xs text-slate-400">
                <a href="mailto:support@aura.shop" className="transition-colors hover:text-white">support@aura.shop</a>
                <a href="tel:1-800-AURA-01" className="transition-colors hover:text-white">1-800-AURA-01</a>
            </div>
        </div>
    </div>
);

const useAuthGate = () => {
    const auth = useContext(AuthContext);
    const { t } = useMarket();
    const location = useLocation();
    const navigate = useNavigate();
    return { auth, location, navigate, t };
};

const renderResolvedGate = ({
    status,
    currentUser,
    sessionError,
    refreshSession,
    logout,
    navigate,
    location,
    pendingMessage,
    pendingTitle,
    t,
    children,
}) => {
    if (AUTH_BOOTSTRAP_STATES.has(status)) {
        return <AuthPendingState message={pendingMessage} title={pendingTitle} />;
    }

    if (status === 'device_challenge_required' && currentUser) {
        return (
            <AuthPendingState
                title={t('auth.deviceChallenge.title', {}, 'Trusted device checkpoint')}
                message={t('auth.deviceChallenge.message', {}, 'Approve this browser in the security checkpoint to continue.')}
            />
        );
    }

    if (status === 'recoverable_error' && currentUser) {
        const supportPath = buildRecoverySupportPath(location, sessionError);
        return (
            <AuthRecoveryState
                message={sessionError?.message}
                onRetry={() => { refreshSession(currentUser, { force: true }).catch(() => {}); }}
                onOpenSupport={() => {
                    navigate(supportPath, {
                        state: {
                            from: toRouteState(location),
                        },
                    });
                }}
                onResetSignIn={() => {
                    Promise.resolve(logout?.())
                        .catch(() => {})
                        .finally(() => {
                            navigate('/login', {
                                replace: true,
                                state: {
                                    from: toRouteState(location),
                                },
                            });
                        });
                }}
                badge={t('auth.recoverableIssue', {}, 'Recoverable session issue')}
                title={t('auth.recovery.title', {}, 'This account needs a fresh session sync.')}
                fallbackMessage={t('auth.recovery.message', {}, 'The identity provider succeeded, but the commerce profile could not be resolved yet.')}
                hint={t('auth.recovery.hint', {}, 'If retry keeps failing, reset the sign-in flow and we will bring you back to the same page after login.')}
                supportHint={t('auth.recovery.supportHint', {}, 'Need a real escalation path? Open the admin support desk from here. Tickets created there stay visible to the support team even when profile sync is degraded.')}
                retryLabel={t('auth.recovery.retry', {}, 'Retry session sync')}
                supportLabel={t('auth.recovery.openSupport', {}, 'Open admin support')}
                resetLabel={t('auth.recovery.resetSignIn', {}, 'Reset sign-in')}
            />
        );
    }

    return children;
};

export const ProtectedRoute = ({ children }) => {
    const { auth, location, navigate, t } = useAuthGate();
    const { status, sessionError, refreshSession, currentUser, logout } = auth;

    const resolved = renderResolvedGate({
        status,
        currentUser,
        sessionError,
        refreshSession,
        logout,
        navigate,
        location,
        pendingMessage: t('auth.pending.resolveSession', {}, 'Resolving your session...'),
        pendingTitle: t('auth.pending.title', {}, 'Session checkpoint'),
        t,
        children,
    });

    if (resolved !== children) {
        return resolved;
    }

    if (!currentUser) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    return children;
};

export const AdminRoute = ({ children }) => {
    const { auth, location, navigate, t } = useAuthGate();
    const { status, roles, sessionError, refreshSession, currentUser, logout } = auth;

    const resolved = renderResolvedGate({
        status,
        currentUser,
        sessionError,
        refreshSession,
        logout,
        navigate,
        location,
        pendingMessage: t('auth.pending.admin', {}, 'Checking admin session access...'),
        pendingTitle: t('auth.pending.title', {}, 'Session checkpoint'),
        t,
        children,
    });

    if (resolved !== children) {
        return resolved;
    }

    if (!currentUser) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    if (!roles?.isAdmin) {
        return <Navigate to="/" state={{ from: location }} replace />;
    }

    return children;
};

export const SellerRoute = ({ children }) => {
    const { auth, location, navigate, t } = useAuthGate();
    const { status, roles, sessionError, refreshSession, currentUser, logout } = auth;

    const resolved = renderResolvedGate({
        status,
        currentUser,
        sessionError,
        refreshSession,
        logout,
        navigate,
        location,
        pendingMessage: t('auth.pending.seller', {}, 'Checking seller account state...'),
        pendingTitle: t('auth.pending.title', {}, 'Session checkpoint'),
        t,
        children,
    });

    if (resolved !== children) {
        return resolved;
    }

    if (!currentUser) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    if (!roles?.isSeller) {
        return <Navigate to="/become-seller" state={{ from: location }} replace />;
    }

    return children;
};

export default ProtectedRoute;
