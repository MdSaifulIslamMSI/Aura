import { useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';

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

const AuthRecoveryState = ({ message, onRetry }) => (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-lg rounded-3xl border border-amber-300/15 bg-zinc-950/70 p-8 shadow-glass">
            <div className="inline-flex rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-amber-200">
                Recoverable session issue
            </div>
            <h2 className="mt-4 text-2xl font-black text-white">This account needs a fresh session sync.</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
                {message || 'The identity provider succeeded, but the commerce profile could not be resolved yet.'}
            </p>
            <button
                type="button"
                onClick={onRetry}
                className="mt-6 inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.06] px-5 py-3 text-sm font-black uppercase tracking-[0.18em] text-neo-cyan transition-colors hover:bg-white/[0.1]"
            >
                Retry session sync
            </button>
        </div>
    </div>
);

const useAuthGate = () => {
    const auth = useContext(AuthContext);
    const location = useLocation();
    return { auth, location };
};

const renderResolvedGate = ({ status, currentUser, sessionError, refreshSession, pendingMessage, children }) => {
    if (AUTH_BOOTSTRAP_STATES.has(status)) {
        return <AuthPendingState message={pendingMessage} />;
    }

    if (status === 'recoverable_error' && currentUser) {
        return (
            <AuthRecoveryState
                message={sessionError?.message}
                onRetry={() => { refreshSession(currentUser, { force: true }).catch(() => {}); }}
            />
        );
    }

    return children;
};

export const ProtectedRoute = ({ children }) => {
    const { auth, location } = useAuthGate();
    const { status, sessionError, refreshSession, currentUser } = auth;

    const resolved = renderResolvedGate({
        status,
        currentUser,
        sessionError,
        refreshSession,
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
    const { auth, location } = useAuthGate();
    const { status, roles, sessionError, refreshSession, currentUser } = auth;

    const resolved = renderResolvedGate({
        status,
        currentUser,
        sessionError,
        refreshSession,
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
    const { auth, location } = useAuthGate();
    const { status, roles, sessionError, refreshSession, currentUser } = auth;

    const resolved = renderResolvedGate({
        status,
        currentUser,
        sessionError,
        refreshSession,
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
