const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');

const assertAbsoluteHttpUrl = (value) => {
    if (!/^https?:\/\//i.test(String(value || '').trim())) {
        throw new Error(`Expected an absolute http(s) origin, received "${value}"`);
    }
};

// Current live hosted backend origin. Update this contract first so the
// workflow and both Vercel configs stay in sync.
export const HOSTED_BACKEND_ORIGIN = 'https://13.206.172.186.sslip.io';

export const FRONTEND_CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "script-src 'self' https://apis.google.com https://accounts.google.com https://checkout.razorpay.com https://www.google.com https://www.gstatic.com https://www.recaptcha.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https: wss:",
    "frame-src 'self' https://accounts.google.com https://checkout.razorpay.com https://www.google.com https://www.recaptcha.net https://*.firebaseapp.com https://*.web.app https://app.powerbi.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
].join('; ');

export const FRONTEND_SECURITY_HEADERS = [
    {
        key: 'Content-Security-Policy',
        value: FRONTEND_CONTENT_SECURITY_POLICY,
    },
    {
        key: 'X-Frame-Options',
        value: 'DENY',
    },
    {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
    },
    {
        key: 'Referrer-Policy',
        value: 'no-referrer',
    },
    {
        key: 'Cross-Origin-Opener-Policy',
        value: 'same-origin-allow-popups',
    },
    {
        key: 'Cross-Origin-Resource-Policy',
        value: 'same-site',
    },
    {
        key: 'Permissions-Policy',
        value: 'camera=(self), microphone=(self), geolocation=(), payment=(self), usb=(), serial=(), bluetooth=()',
    },
];

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

export const buildFrontendSecurityHeaders = () => [
    {
        source: '/(.*)',
        headers: FRONTEND_SECURITY_HEADERS,
    },
];
