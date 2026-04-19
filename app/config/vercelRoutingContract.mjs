const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');

const assertAbsoluteHttpUrl = (value) => {
    if (!/^https?:\/\//i.test(String(value || '').trim())) {
        throw new Error(`Expected an absolute http(s) origin, received "${value}"`);
    }
};

// Current live hosted backend origin. Update this contract first so the
// workflow and both Vercel configs stay in sync.
export const HOSTED_BACKEND_ORIGIN = 'http://3.109.181.238:5000';

const HOSTED_PROXY_ROUTE_SUFFIXES = [
    {
        source: '/socket.io',
        destination: '/socket.io/',
    },
    {
        source: '/socket.io/',
        destination: '/socket.io/',
    },
    {
        source: '/socket.io/:path*',
        destination: '/socket.io/:path*',
    },
    {
        source: '/api/:path*',
        destination: '/api/:path*',
    },
    {
        source: '/health',
        destination: '/health',
    },
    {
        source: '/health/ready',
        destination: '/health/ready',
    },
    {
        source: '/health/live',
        destination: '/health/live',
    },
    {
        source: '/uploads/:path*',
        destination: '/uploads/:path*',
    },
];

export const SPA_FALLBACK_REWRITE = {
    source: '/:path((?!api/|socket\\.io(?:/|$)|uploads/|assets/|manifest\\.json$|sw\\.js$|favicon\\.ico$|robots\\.txt$|.*\\.[^/]+$).*)',
    destination: '/index.html',
};

export const buildHostedBackendRewrites = (origin = HOSTED_BACKEND_ORIGIN) => {
    assertAbsoluteHttpUrl(origin);

    const normalizedOrigin = trimTrailingSlash(origin);

    return [
        ...HOSTED_PROXY_ROUTE_SUFFIXES.map(({ source, destination }) => ({
            source,
            destination: `${normalizedOrigin}${destination}`,
        })),
        SPA_FALLBACK_REWRITE,
    ];
};
