const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');

const assertAbsoluteHttpUrl = (value) => {
    if (!/^https?:\/\//i.test(String(value || '').trim())) {
        throw new Error(`Expected an absolute http(s) origin, received "${value}"`);
    }
};

// Durable production backend edge used by local desktop builds and generated
// hosted production routing files when CI variables are unavailable. Preview
// deployments that use this origin are frontend previews only, not backend
// staging; staging smoke must use an isolated STAGING_API_BASE_URL instead.
export const DEFAULT_HOSTED_BACKEND_ORIGIN = 'https://dbtrhsolhec1s.cloudfront.net';

export const assertDeployableHostedBackendOrigin = (origin) => {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();

    if (parsed.protocol !== 'https:') {
        throw new Error(`Hosted backend origin must use HTTPS, received "${origin}"`);
    }
    if (hostname === 'api.aurapilot.example.com' || hostname.endsWith('.sslip.io')) {
        throw new Error(`Hosted backend origin must be a durable production edge hostname, received "${origin}"`);
    }
};

export const resolveHostedBackendOrigin = (env = process.env, options = {}) => {
    const rawOrigin = String(
        env?.AURA_BACKEND_ORIGIN
        || env?.AWS_BACKEND_BASE_URL
        || ''
    ).trim();

    if (!rawOrigin) {
        if (options.allowCommittedFallback) {
            return DEFAULT_HOSTED_BACKEND_ORIGIN;
        }
        throw new Error('Set AURA_BACKEND_ORIGIN or AWS_BACKEND_BASE_URL to the HTTPS backend edge origin.');
    }

    assertAbsoluteHttpUrl(rawOrigin);
    return trimTrailingSlash(rawOrigin);
};

export const HOSTED_BACKEND_ORIGIN = resolveHostedBackendOrigin(process.env, {
    allowCommittedFallback: true,
});

const toWebSocketOrigin = (origin = '') => trimTrailingSlash(origin).replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');

export const LOCAL_DEVELOPMENT_CONNECT_SRC = [
    'http://localhost:*',
    'http://127.0.0.1:*',
    'http://host.docker.internal:*',
];

const buildFrontendStyleSrc = ({ allowInlineStyleElement = false } = {}) => [
    "'self'",
    ...(allowInlineStyleElement ? ["'unsafe-inline'"] : []),
    'https://fonts.googleapis.com',
].join(' ');

const buildFrontendStyleElementSrc = () => [
    "'self'",
    "'unsafe-inline'",
    'https://fonts.googleapis.com',
].join(' ');

export const buildFrontendConnectSrc = (origin = HOSTED_BACKEND_ORIGIN, options = {}) => [
    "'self'",
    trimTrailingSlash(origin),
    toWebSocketOrigin(origin),
    ...(options.includeLocalDevelopmentSources ? LOCAL_DEVELOPMENT_CONNECT_SRC : []),
    'https://api.github.com',
    'https://api.stripe.com',
    'https://js.stripe.com',
    'https://hooks.stripe.com',
    'https://checkout.razorpay.com',
    'https://api.razorpay.com',
    'https://*.razorpay.com',
    'https://*.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://identitytoolkit.googleapis.com',
    'https://firebaseinstallations.googleapis.com',
    'https://firebaselogging.googleapis.com',
    'https://www.google.com',
    'https://www.gstatic.com',
    'https://www.recaptcha.net',
    'https://challenges.cloudflare.com',
    'https://*.firebaseio.com',
    'https://*.firebaseapp.com',
    'https://*.web.app',
    'https://*.livekit.cloud',
    'wss://*.livekit.cloud',
].filter(Boolean);

export const FRONTEND_CONNECT_SRC = buildFrontendConnectSrc(HOSTED_BACKEND_ORIGIN);

export const buildFrontendContentSecurityPolicy = (origin = HOSTED_BACKEND_ORIGIN, options = {}) => [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "script-src 'self' https://apis.google.com https://accounts.google.com https://checkout.razorpay.com https://js.stripe.com https://www.google.com https://www.gstatic.com https://www.recaptcha.net https://challenges.cloudflare.com",
    `style-src ${buildFrontendStyleSrc(options)}`,
    `style-src-elem ${buildFrontendStyleElementSrc()}`,
    "style-src-attr 'unsafe-inline'",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    `connect-src ${buildFrontendConnectSrc(origin, options).join(' ')}`,
    "frame-src 'self' https://accounts.google.com https://checkout.razorpay.com https://js.stripe.com https://hooks.stripe.com https://www.google.com https://www.recaptcha.net https://challenges.cloudflare.com https://*.firebaseapp.com https://*.web.app https://app.powerbi.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
].join('; ');

export const FRONTEND_CONTENT_SECURITY_POLICY = buildFrontendContentSecurityPolicy(HOSTED_BACKEND_ORIGIN);
export const FRONTEND_DEVELOPMENT_CONTENT_SECURITY_POLICY = buildFrontendContentSecurityPolicy(
    HOSTED_BACKEND_ORIGIN,
    {
        allowInlineStyleElement: true,
        includeLocalDevelopmentSources: true,
    }
);

export const buildFrontendSecurityHeaderValues = (origin = HOSTED_BACKEND_ORIGIN) => [
    {
        key: 'Content-Security-Policy',
        value: buildFrontendContentSecurityPolicy(origin),
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

export const FRONTEND_SECURITY_HEADERS = buildFrontendSecurityHeaderValues(HOSTED_BACKEND_ORIGIN);

export const FRONTEND_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const FRONTEND_SERVICE_WORKER_CACHE_CONTROL = 'no-cache, no-store, must-revalidate';
export const FRONTEND_DOCUMENT_CACHE_CONTROL = 'no-store';

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

const NETLIFY_HOSTED_PROXY_ROUTE_SUFFIXES = [
    {
        from: '/socket.io',
        to: '/socket.io/',
    },
    {
        from: '/socket.io/*',
        to: '/socket.io/:splat',
    },
    {
        from: '/api/*',
        to: '/api/:splat',
    },
    {
        from: '/health',
        to: '/health',
    },
    {
        from: '/health/ready',
        to: '/health/ready',
    },
    {
        from: '/health/live',
        to: '/health/live',
    },
    {
        from: '/uploads/*',
        to: '/uploads/:splat',
    },
];

export const SPA_FALLBACK_REWRITE = {
    source: '/:path((?!api/|socket\\.io(?:/|$)|uploads/|assets/|manifest\\.json$|sw\\.js$|favicon\\.ico$|robots\\.txt$|.*\\.[^/]+$).*)',
    destination: '/index.html',
};

const withCacheControlHeader = (headers, cacheControl) => [
    ...headers,
    {
        key: 'Cache-Control',
        value: cacheControl,
    },
];

export const buildFrontendSecurityHeaders = (origin = HOSTED_BACKEND_ORIGIN) => {
    const securityHeaders = buildFrontendSecurityHeaderValues(origin);

    return [
        {
            source: '/assets/:path*',
            headers: withCacheControlHeader(securityHeaders, FRONTEND_ASSET_CACHE_CONTROL),
        },
        {
            source: '/sw.js',
            headers: withCacheControlHeader(securityHeaders, FRONTEND_SERVICE_WORKER_CACHE_CONTROL),
        },
        {
            source: '/',
            headers: withCacheControlHeader(securityHeaders, FRONTEND_DOCUMENT_CACHE_CONTROL),
        },
        {
            source: '/index.html',
            headers: withCacheControlHeader(securityHeaders, FRONTEND_DOCUMENT_CACHE_CONTROL),
        },
        {
            source: SPA_FALLBACK_REWRITE.source,
            headers: withCacheControlHeader(securityHeaders, FRONTEND_DOCUMENT_CACHE_CONTROL),
        },
        {
            source: '/(.*)',
            headers: securityHeaders,
        },
    ];
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

export const buildNetlifyHostedBackendRedirects = (origin = HOSTED_BACKEND_ORIGIN) => {
    assertAbsoluteHttpUrl(origin);

    const normalizedOrigin = trimTrailingSlash(origin);

    return NETLIFY_HOSTED_PROXY_ROUTE_SUFFIXES.map(({ from, to }) => ({
        from,
        to: `${normalizedOrigin}${to}`,
        status: 200,
        force: true,
    }));
};
