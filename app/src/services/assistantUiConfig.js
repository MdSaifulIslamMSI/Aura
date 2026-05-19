export const ASSISTANT_WORKSPACE_PATH = '/assistant';
export const FRONTEND_LAUNCH_HUB_PATH = '/launch';
export const DESKTOP_LOGIN_PATH = '/desktop-login';

const AMBIENT_CHROME_PREFIXES = [
    '/',
    '/products',
    '/category/',
    '/search',
    '/deals',
    '/trending',
    '/new-arrivals',
    '/marketplace',
    '/product/',
    '/listing/',
    '/seller/',
    '/compare',
    '/visual-search',
    '/bundles',
    '/mission-control',
    '/trust',
];

const CHATBOT_ROUTE_PREFIXES = [
    '/products',
    '/category/',
    '/search',
    '/deals',
    '/trending',
    '/new-arrivals',
    '/marketplace',
    '/product/',
    '/listing/',
    '/cart',
];

const BACKEND_STATUS_ROUTE_PREFIXES = [
    '/login',
    '/cart',
    '/checkout',
    '/orders',
    '/profile',
    '/contact',
    '/trust',
];

const normalizePathname = (pathname = '/') => String(pathname || '/').trim() || '/';

export const routeMatches = (pathname = '/', prefixes = []) => {
    const normalizedPathname = normalizePathname(pathname);

    if (normalizedPathname === '/') {
        return prefixes.includes('/');
    }

    return prefixes.some((prefix) => prefix !== '/' && normalizedPathname.startsWith(prefix));
};

export const isAdminPath = (pathname = '/') => normalizePathname(pathname).startsWith('/admin');

export const isAssistantWorkspacePath = (pathname = '/') => (
    normalizePathname(pathname).startsWith(ASSISTANT_WORKSPACE_PATH)
);

export const isFrontendLaunchHubPath = (pathname = '/') => (
    normalizePathname(pathname).startsWith(FRONTEND_LAUNCH_HUB_PATH)
);

export const isDesktopLoginPath = (pathname = '/') => (
    normalizePathname(pathname).startsWith(DESKTOP_LOGIN_PATH)
);

export const isStatusPath = (pathname = '/') => (
    normalizePathname(pathname).startsWith('/status')
);

export const isDesktopAuthLoginRequest = (pathname = '/', search = '') => {
    if (normalizePathname(pathname) !== '/login') {
        return false;
    }

    const params = new URLSearchParams(String(search || ''));
    return params.has('desktopAuthRequest')
        || params.has('desktopAuthSecret')
        || params.has('desktopAuthCallback')
        || params.has('desktopAuthReturnTo');
};

export const shouldShowSiteChrome = (pathname = '/') => (
    !isFrontendLaunchHubPath(pathname)
    && !isDesktopLoginPath(pathname)
    && !isStatusPath(pathname)
    && !isAssistantWorkspacePath(pathname)
);

export const shouldShowAmbientChrome = (pathname = '/') => (
    !isAdminPath(pathname)
    && !isDesktopLoginPath(pathname)
    && !isStatusPath(pathname)
    && !isAssistantWorkspacePath(pathname)
    && routeMatches(pathname, AMBIENT_CHROME_PREFIXES)
);

export const shouldShowChatbotSurface = (pathname = '/') => (
    !isAdminPath(pathname) && routeMatches(pathname, CHATBOT_ROUTE_PREFIXES)
);

export const shouldShowAssistantLauncher = ({
    pathname = '/',
} = {}) => (
    shouldShowChatbotSurface(pathname)
    && !isAssistantWorkspacePath(pathname)
);

export const shouldShowBackendStatusBanner = (pathname = '/') => (
    !isDesktopLoginPath(pathname)
    && !isStatusPath(pathname)
    && (isAdminPath(pathname) || routeMatches(pathname, BACKEND_STATUS_ROUTE_PREFIXES))
);

export const buildAssistantWorkspacePath = (location = {}) => {
    const pathname = normalizePathname(location?.pathname);
    const search = typeof location?.search === 'string' ? location.search : '';
    const from = `${pathname}${search}`;
    return `${ASSISTANT_WORKSPACE_PATH}?from=${encodeURIComponent(from)}`;
};
