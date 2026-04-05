import { useContext, useMemo } from 'react';
import { LifeBuoy, ShieldAlert } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { buildSupportHandoffPath } from '@/utils/supportRouting';

const SUPPORT_HANDOFF_PATH = buildSupportHandoffPath();
const isAdminPath = (pathname = '/') => String(pathname || '/').startsWith('/admin');

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
    const useCompactLauncher = shouldUseCompactLauncher(location.pathname);
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
                    className="fixed bottom-[calc(5.9rem+env(safe-area-inset-bottom))] right-4 z-[70] flex h-14 w-14 items-center justify-center rounded-full border border-amber-300/25 bg-[linear-gradient(140deg,rgba(7,12,24,0.96),rgba(15,23,42,0.94))] text-amber-100 shadow-[0_22px_58px_rgba(2,8,23,0.48)] backdrop-blur-xl transition-transform duration-200 hover:-translate-y-1 sm:hidden"
                    aria-label="Talk to admin support"
                    title={title}
                >
                    {isAuthenticated ? <LifeBuoy className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
                </button>

                <button
                    type="button"
                    onClick={handleOpenSupport}
                    className="fixed bottom-6 left-6 z-[70] hidden max-w-[min(92vw,24rem)] items-center gap-3 rounded-[1.5rem] border border-amber-300/25 bg-[linear-gradient(140deg,rgba(7,12,24,0.96),rgba(15,23,42,0.94))] px-4 py-3 text-left text-slate-50 shadow-[0_22px_58px_rgba(2,8,23,0.48)] backdrop-blur-xl transition-transform duration-200 hover:-translate-y-1 sm:flex"
                    aria-label="Talk to admin support"
                >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border border-amber-300/25 bg-amber-400/12 text-amber-100">
                        {isAuthenticated ? <LifeBuoy className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">{eyebrow}</p>
                        <p className="mt-1 text-sm font-black text-white">{title}</p>
                        <p className={cn('mt-1 text-xs leading-5 text-slate-300', isLoginRoute && !isAuthenticated ? 'max-w-[18rem]' : '')}>
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
            className="fixed bottom-4 left-4 z-[70] flex max-w-[min(92vw,24rem)] items-center gap-3 rounded-[1.5rem] border border-amber-300/25 bg-[linear-gradient(140deg,rgba(7,12,24,0.96),rgba(15,23,42,0.94))] px-4 py-3 text-left text-slate-50 shadow-[0_22px_58px_rgba(2,8,23,0.48)] backdrop-blur-xl transition-transform duration-200 hover:-translate-y-1 sm:bottom-6 sm:left-6"
            aria-label="Talk to admin support"
        >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border border-amber-300/25 bg-amber-400/12 text-amber-100">
                {isAuthenticated ? <LifeBuoy className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">{eyebrow}</p>
                <p className="mt-1 text-sm font-black text-white">{title}</p>
                <p className={cn('mt-1 text-xs leading-5 text-slate-300', isLoginRoute && !isAuthenticated ? 'max-w-[18rem]' : '')}>
                    {detail}
                </p>
            </div>
        </button>
    );
};

export default GlobalSupportLauncher;
