import { useContext, useMemo } from 'react';
import { LifeBuoy, ShieldAlert } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { buildSupportHandoffPath } from '@/utils/supportRouting';

const SUPPORT_HANDOFF_PATH = buildSupportHandoffPath();
const isAdminPath = (pathname = '/') => String(pathname || '/').startsWith('/admin');
const SUPPORT_LAUNCHER_HIDDEN_PREFIXES = [
    '/assistant',
    '/search',
    '/marketplace',
    '/visual-search',
    '/compare',
    '/category/',
    '/product/',
    '/listing/',
    '/deals',
    '/trending',
    '/new-arrivals',
    '/login',
];

const toLocationState = (path = '/') => {
    const [pathname = '/', rawSearch = ''] = String(path || '/').split('?');
    return {
        pathname: pathname || '/',
        search: rawSearch ? `?${rawSearch}` : '',
        hash: '',
    };
};

const shouldHideSupportLauncher = (pathname = '/', search = '') => {
    const params = new URLSearchParams(search);

    if (isAdminPath(pathname)) {
        return true;
    }

    if (pathname === '/contact') {
        return true;
    }

    if (pathname === '/') {
        return true;
    }

    if (SUPPORT_LAUNCHER_HIDDEN_PREFIXES.some((prefix) => String(pathname || '').startsWith(prefix))) {
        return true;
    }

    if (pathname === '/profile' && params.get('tab') === 'support') {
        return true;
    }

    if (pathname === '/orders' && params.get('support') === '1') {
        return true;
    }

    return false;
};

const shouldUseCompactLauncher = (pathname = '/') => pathname.startsWith('/product/');

const GlobalSupportLauncher = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { currentUser } = useContext(AuthContext);

    const supportLocation = useMemo(() => toLocationState(SUPPORT_HANDOFF_PATH), []);

    if (shouldHideSupportLauncher(location.pathname, location.search)) {
        return null;
    }

    const isAuthenticated = Boolean(currentUser);
    const isLoginRoute = location.pathname === '/login';
    const useCompactLauncher = shouldUseCompactLauncher(location.pathname) || isLoginRoute;
    const eyebrow = isAuthenticated ? 'Need help now?' : (isLoginRoute ? 'Blocked account?' : 'Need admin help?');
    const title = isAuthenticated ? 'Chat, voice, video support' : 'Sign in for support';
    const detail = isAuthenticated
        ? 'Open the support desk for issues, appeals, refunds, or account problems with one thread that can escalate into voice or video.'
        : 'Keep your sign-in flow pointed at the support desk so a suspension or warning is not a dead end.';

    const handleOpenSupport = () => {
        if (isAuthenticated) {
            navigate(SUPPORT_HANDOFF_PATH);
            return;
        }

        navigate('/login', {
            state: {
                from: supportLocation,
            },
        });
    };

    if (useCompactLauncher) {
        return (
            <>
                <button
                    type="button"
                    onClick={handleOpenSupport}
                    className="aura-support-launcher aura-floating-utility aura-floating-utility--support fixed bottom-[calc(5.9rem+env(safe-area-inset-bottom))] left-4 z-[71] flex h-14 w-14 items-center justify-center rounded-full border text-slate-50 transition-transform duration-200 hover:-translate-y-1 sm:hidden"
                    aria-label="Talk to admin support"
                    title={title}
                >
                    {isAuthenticated ? <LifeBuoy className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
                </button>

                <button
                    type="button"
                    onClick={handleOpenSupport}
                    className="aura-support-launcher aura-floating-utility aura-floating-utility--support fixed bottom-6 left-6 z-[71] hidden items-center gap-3 rounded-full border px-3 py-3 text-left text-slate-50 transition-transform duration-200 hover:-translate-y-1 sm:flex"
                    aria-label="Talk to admin support"
                >
                    <div className="aura-floating-utility__icon flex h-11 w-11 shrink-0 items-center justify-center rounded-full border">
                        {isAuthenticated ? <LifeBuoy className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
                    </div>
                    <div className="aura-floating-utility__copy min-w-0">
                        <p className="aura-floating-utility__eyebrow text-[10px] font-black uppercase tracking-[0.2em]">{eyebrow}</p>
                        <p className="aura-floating-utility__title mt-1 text-sm font-black">{title}</p>
                        <p className={cn('aura-floating-utility__detail mt-1 text-xs leading-5', isLoginRoute && !isAuthenticated ? 'max-w-[18rem]' : '')}>
                            {detail}
                        </p>
                    </div>
                </button>
            </>
        );
    }

    return (
        <button
            type="button"
            onClick={handleOpenSupport}
            className="aura-support-launcher aura-floating-utility aura-floating-utility--support fixed bottom-4 left-4 z-[71] flex items-center gap-3 rounded-full border px-3 py-3 text-left text-slate-50 transition-transform duration-200 hover:-translate-y-1 sm:bottom-6 sm:left-6"
            aria-label="Talk to admin support"
        >
            <div className="aura-floating-utility__icon flex h-11 w-11 shrink-0 items-center justify-center rounded-full border">
                {isAuthenticated ? <LifeBuoy className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
            </div>
            <div className="aura-floating-utility__copy min-w-0">
                <p className="aura-floating-utility__eyebrow text-[10px] font-black uppercase tracking-[0.2em]">{eyebrow}</p>
                <p className="aura-floating-utility__title mt-1 text-sm font-black">{title}</p>
                <p className={cn('aura-floating-utility__detail mt-1 text-xs leading-5', isLoginRoute && !isAuthenticated ? 'max-w-[18rem]' : '')}>
                    {detail}
                </p>
            </div>
        </button>
    );
};

export default GlobalSupportLauncher;
