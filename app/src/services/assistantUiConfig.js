export const ASSISTANT_WORKSPACE_PATH = '/assistant';

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
    ASSISTANT_WORKSPACE_PATH,
];

const CHATBOT_ROUTE_PREFIXES = [
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
    '/cart',
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

export const shouldShowAmbientChrome = (pathname = '/') => (
    !isAdminPath(pathname) && routeMatches(pathname, AMBIENT_CHROME_PREFIXES)
);

export const shouldShowChatbotSurface = (pathname = '/') => (
    !isAdminPath(pathname) && routeMatches(pathname, CHATBOT_ROUTE_PREFIXES)
);

export const shouldShowAssistantLauncher = ({
    pathname = '/',
    assistantV2Enabled = false,
} = {}) => (
    assistantV2Enabled
    && shouldShowChatbotSurface(pathname)
    && !isAssistantWorkspacePath(pathname)
);

export const shouldShowLegacyChatBot = ({
    pathname = '/',
    assistantV2Enabled = false,
} = {}) => (
    !assistantV2Enabled && shouldShowChatbotSurface(pathname)
);

export const buildAssistantWorkspacePath = (location = {}) => {
    const pathname = normalizePathname(location?.pathname);
    const search = typeof location?.search === 'string' ? location.search : '';
    const from = `${pathname}${search}`;
    return `${ASSISTANT_WORKSPACE_PATH}?from=${encodeURIComponent(from)}`;
};
