import { useContext } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
import { buildSupportHandoffPath } from '@/utils/assistantCommands';

const AUTH_BOOTSTRAP_STATES = new Set(['bootstrap', 'loading']);

const AuthPendingState = ({ message = 'Resolving your session...' }) => (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.045] p-8 text-center shadow-glass">
            <div className="mx-auto h-12 w-12 rounded-full border-4 border-neo-cyan/70 border-t-transparent animate-spin" />
            <h2 className="mt-5 text-xl font-black text-white">Session checkpoint</h2>
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

const AuthRecoveryState = ({ message, onRetry, onResetSignIn, onOpenSupport }) => (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-lg rounded-3xl border border-amber-300/15 bg-zinc-950/70 p-8 shadow-glass">
            <div className="inline-flex rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-amber-200">
                Recoverable session issue
            </div>
            <h2 className="mt-4 text-2xl font-black text-white">This account needs a fresh session sync.</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
                {message || 'The identity provider succeeded, but the commerce profile could not be resolved yet.'}
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-400">
                If retry keeps failing, reset the sign-in flow and we will bring you back to the same page after login.
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-400">
                Need a real escalation path? Open the admin support desk from here. Tickets created there stay visible to the support team even when profile sync is degraded.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
                <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.06] px-5 py-3 text-sm font-black uppercase tracking-[0.18em] text-neo-cyan transition-colors hover:bg-white/[0.1]"
                >
                    Retry session sync
                </button>
                <button
                    type="button"
                    onClick={onOpenSupport}
                    className="inline-flex items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-400/12 px-5 py-3 text-sm font-black uppercase tracking-[0.18em] text-cyan-100 transition-colors hover:bg-cyan-400/18"
                >
                    Open admin support
                </button>
                <button
                    type="button"
                    onClick={onResetSignIn}
                    className="inline-flex items-center justify-center rounded-full border border-amber-300/20 bg-amber-300/10 px-5 py-3 text-sm font-black uppercase tracking-[0.18em] text-amber-100 transition-colors hover:bg-amber-300/16"
                >
                    Reset sign-in
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
    const location = useLocation();
    const navigate = useNavigate();
    return { auth, location, navigate };
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
    children,
}) => {
    if (AUTH_BOOTSTRAP_STATES.has(status)) {
        return <AuthPendingState message={pendingMessage} />;
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
            />
        );
    }

    return children;
};

export const ProtectedRoute = ({ children }) => {
    const { auth, location, navigate } = useAuthGate();
    const { status, sessionError, refreshSession, currentUser, logout } = auth;

    const resolved = renderResolvedGate({
        status,
        currentUser,
        sessionError,
        refreshSession,
        logout,
        navigate,
        location,
        pendingMessage: 'Resolving your session...',
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
    const { auth, location, navigate } = useAuthGate();
    const { status, roles, sessionError, refreshSession, currentUser, logout } = auth;

    const resolved = renderResolvedGate({
        status,
        currentUser,
        sessionError,
        refreshSession,
        logout,
        navigate,
        location,
        pendingMessage: 'Checking admin session access...',
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
    const { auth, location, navigate } = useAuthGate();
    const { status, roles, sessionError, refreshSession, currentUser, logout } = auth;

    const resolved = renderResolvedGate({
        status,
        currentUser,
        sessionError,
        refreshSession,
        logout,
        navigate,
        location,
        pendingMessage: 'Checking seller account state...',
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
