import { useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';

/**
 * ProtectedRoute — Redirects to /login if user is not authenticated
 */
export const ProtectedRoute = ({ children }) => {
    const { isAuthenticated } = useContext(AuthContext);
    const location = useLocation();

    if (!isAuthenticated) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    return children;
};

/**
 * AdminRoute — Redirects non-admin users to home
 * Note: Real admin check happens on the backend via protect+admin middleware.
 * This is a UX guard only — it prevents non-admins from seeing the admin UI.
 */
export const AdminRoute = ({ children }) => {
    const { isAuthenticated, dbUser } = useContext(AuthContext);
    const location = useLocation();

    if (!isAuthenticated) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    if (!dbUser?.isAdmin) {
        return <Navigate to="/" state={{ from: location }} replace />;
    }

    return children;
};

/**
 * SellerRoute â€” Redirects non-seller users to onboarding.
 */
export const SellerRoute = ({ children }) => {
    const { isAuthenticated, dbUser } = useContext(AuthContext);
    const location = useLocation();

    if (!isAuthenticated) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    // Wait until dbUser is hydrated after Firebase auth sync.
    if (!dbUser) {
        return (
            <div className="flex h-[70vh] items-center justify-center">
                <div className="w-10 h-10 rounded-full border-4 border-neo-cyan/70 border-t-transparent animate-spin" />
            </div>
        );
    }

    if (!dbUser?.isSeller) {
        return <Navigate to="/become-seller" state={{ from: location }} replace />;
    }

    return children;
};

export default ProtectedRoute;
