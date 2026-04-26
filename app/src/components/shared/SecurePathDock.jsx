import { useContext, useMemo, useState } from 'react';
import {
    Brain,
    Globe2,
    LifeBuoy,
    LockKeyhole,
    ShieldCheck,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { pushClientDiagnostic } from '@/services/clientObservability';
import {
    buildAssistantWorkspacePath,
    isAdminPath,
    isAssistantWorkspacePath,
    shouldShowAssistantLauncher,
} from '@/services/assistantUiConfig';
import { buildSupportHandoffPath } from '@/utils/supportRouting';

const SUPPORT_HANDOFF_PATH = buildSupportHandoffPath();
const HIDDEN_SUPPORT_PREFIXES = [
    '/assistant',
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

const shouldShowSupportAction = (pathname = '/', search = '') => {
    const params = new URLSearchParams(search);

    if (isAdminPath(pathname) || pathname === '/' || pathname === '/contact') {
        return false;
    }

    if (HIDDEN_SUPPORT_PREFIXES.some((prefix) => String(pathname || '').startsWith(prefix))) {
        return false;
    }

    if (pathname === '/profile' && params.get('tab') === 'support') {
        return false;
    }

    if (pathname === '/orders' && params.get('support') === '1') {
        return false;
    }

    return true;
};

const SecurePathDock = () => {
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const {
        currentUser,
        dbUser,
        deviceChallenge,
        roles,
        status,
    } = useContext(AuthContext) || {};
    const pathname = location.pathname || '/';
    const supportLocation = useMemo(() => toLocationState(SUPPORT_HANDOFF_PATH), []);
    const canUseAssistant = shouldShowAssistantLauncher({ pathname })
        && !isAssistantWorkspacePath(pathname)
        && !isAdminPath(pathname);
    const canUseSupport = shouldShowSupportAction(pathname, location.search || '');
    const canUseMarket = !isAdminPath(pathname)
        && !isAssistantWorkspacePath(pathname)
        && pathname !== '/login';
    const canUseTrust = Boolean(
        currentUser
        && (roles?.isAdmin || dbUser?.isAdmin || deviceChallenge)
        && !isAdminPath(pathname)
    );

    const items = [];

    if (canUseMarket) {
        items.push({
            id: 'market',
            icon: Globe2,
            eyebrow: 'Market studio',
            title: 'Region controls',
            detail: 'Country, language, currency',
            onClick: () => {
                pushClientDiagnostic('market_studio.secure_path_opened', {
                    context: {
                        originPath: `${pathname}${location.search || ''}`,
                        source: 'secure_path_dock',
                    },
                });

                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('aura:open-market-studio', {
                        detail: {
                            source: 'secure_path_dock',
                        },
                    }));
                }
            },
        });
    }

    if (canUseTrust) {
        items.push({
            id: 'trust',
            icon: ShieldCheck,
            eyebrow: status === 'device_challenge_required' ? 'Verification needed' : 'Trust checkpoint',
            title: 'Admin proof lane',
            detail: 'Opens only inside protected actions',
            onClick: () => navigate('/admin/dashboard'),
        });
    }

    if (canUseAssistant) {
        items.push({
            id: 'assistant',
            icon: Brain,
            eyebrow: 'Commerce assistant',
            title: 'Focused copilot',
            detail: 'Carries this page context',
            onClick: () => {
                pushClientDiagnostic('assistant_workspace.launcher_opened', {
                    context: {
                        originPath: `${pathname}${location.search || ''}`,
                        source: 'secure_path_dock',
                    },
                });
                navigate(buildAssistantWorkspacePath(location));
            },
        });
    }

    if (canUseSupport) {
        const isAuthenticated = Boolean(currentUser);
        items.push({
            id: 'support',
            icon: LifeBuoy,
            eyebrow: isAuthenticated ? 'Support panel' : 'Support access',
            title: isAuthenticated ? 'Support desk' : 'Sign in for support',
            detail: isAuthenticated ? 'Appeals, refunds, account issues' : 'Keeps the help route ready',
            onClick: () => {
                if (isAuthenticated) {
                    navigate(SUPPORT_HANDOFF_PATH);
                    return;
                }

                navigate('/login', {
                    state: {
                        from: supportLocation,
                    },
                });
            },
        });
    }

    if (!items.length) {
        return null;
    }

    return (
        <nav
            className={cn('aura-secure-path-dock', isMobileOpen && 'aura-secure-path-dock--open')}
            aria-label="Secure path tools"
        >
            <div className="aura-secure-path-dock__rail">
                <button
                    type="button"
                    className="aura-secure-path-dock__header"
                    aria-label="Secure path tools"
                    aria-expanded={isMobileOpen}
                    onClick={() => setIsMobileOpen((current) => !current)}
                >
                    <LockKeyhole className="h-4 w-4" />
                    <span>Secure path</span>
                </button>
                <div className="aura-secure-path-dock__items">
                    {items.map((item) => {
                        const Icon = item.icon;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                    item.onClick();
                                    setIsMobileOpen(false);
                                }}
                                className={cn('aura-secure-path-dock__item', `aura-secure-path-dock__item--${item.id}`)}
                                aria-label={`${item.eyebrow}: ${item.title}`}
                            >
                                <span className="aura-secure-path-dock__icon">
                                    <Icon className="h-4 w-4" />
                                </span>
                                <span className="aura-secure-path-dock__copy">
                                    <span className="aura-secure-path-dock__eyebrow">{item.eyebrow}</span>
                                    <span className="aura-secure-path-dock__title">{item.title}</span>
                                    <span className="aura-secure-path-dock__detail">{item.detail}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </nav>
    );
};

export default SecurePathDock;
