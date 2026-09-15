import desktopAuthLoopbackContract from '../../config/desktopAuthLoopback.cjs';

const {
    DESKTOP_AUTH_LOOPBACK_CONNECT_SOURCES,
    DESKTOP_AUTH_LOOPBACK_FORM_ACTION_SOURCES,
} = desktopAuthLoopbackContract;

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

    if (!rawOrigin || (options.allowSameOriginFallback && rawOrigin === '/')) {
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
    allowSameOriginFallback: true,
});

const toWebSocketOrigin = (origin = '') => trimTrailingSlash(origin).replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');

export const LOCAL_DEVELOPMENT_CONNECT_SRC = [
    'http://localhost:*',
    'http://127.0.0.1:*',
    'http://host.docker.internal:*',
    'ws://localhost:*',
    'ws://127.0.0.1:*',
];

// Vite's dev server requires an inline react-refresh preamble in index.html,
// so the development policy must allow inline scripts. Production keeps them blocked.
export const LOCAL_DEVELOPMENT_SCRIPT_SRC = [
    "'unsafe-inline'",
    "'unsafe-eval'",
];

const buildFrontendScriptSrc = ({ allowInlineScriptElement = false } = {}) => [
    "'self'",
    ...(allowInlineScriptElement ? LOCAL_DEVELOPMENT_SCRIPT_SRC : []),
    'https://apis.google.com',
    'https://accounts.google.com',
    'https://checkout.razorpay.com',
    'https://js.stripe.com',
    'https://www.google.com',
    'https://www.gstatic.com',
    'https://www.recaptcha.net',
    'https://challenges.cloudflare.com',
    // Datadog RUM browser-agent bundle (US5 org).
    'https://www.datadoghq-browser-agent.com',
].join(' ');

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
    ...DESKTOP_AUTH_LOOPBACK_CONNECT_SOURCES,
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
    // Sentry event + trace ingest (regional + global endpoints).
    'https://*.ingest.sentry.io',
    'https://*.ingest.us.sentry.io',
    // Datadog RUM browser intake (US5 org).
    'https://browser-intake-us5-datadoghq.com',
].filter(Boolean);

export const FRONTEND_CONNECT_SRC = buildFrontendConnectSrc(HOSTED_BACKEND_ORIGIN);

export const buildFrontendContentSecurityPolicy = (origin = HOSTED_BACKEND_ORIGIN, options = {}) => [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `form-action 'self' ${DESKTOP_AUTH_LOOPBACK_FORM_ACTION_SOURCES.join(' ')}`,
    `script-src ${buildFrontendScriptSrc(options)}`,
    `style-src ${buildFrontendStyleSrc(options)}`,
    `style-src-elem ${buildFrontendStyleElementSrc()}`,
    "style-src-attr 'unsafe-inline'",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    `connect-src ${buildFrontendConnectSrc(origin, options).join(' ')}`,
    "frame-src 'self' https://accounts.google.com https://checkout.razorpay.com https://js.stripe.com https://hooks.stripe.com https://www.google.com https://www.recaptcha.net https://challenges.cloudflare.com https://*.firebaseapp.com https://*.web.app https://app.powerbi.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(options.includeFrameAncestors === false ? [] : ["frame-ancestors 'none'"]),
].join('; ');

export const FRONTEND_CONTENT_SECURITY_POLICY = buildFrontendContentSecurityPolicy(HOSTED_BACKEND_ORIGIN);
export const FRONTEND_META_CONTENT_SECURITY_POLICY = buildFrontendContentSecurityPolicy(
    HOSTED_BACKEND_ORIGIN,
    { includeFrameAncestors: false }
);
export const FRONTEND_DEVELOPMENT_CONTENT_SECURITY_POLICY = buildFrontendContentSecurityPolicy(
    HOSTED_BACKEND_ORIGIN,
    {
        allowInlineScriptElement: true,
        allowInlineStyleElement: true,
        includeLocalDevelopmentSources: true,
    }
);

export const buildFrontendSecurityHeaderValues = (origin = HOSTED_BACKEND_ORIGIN) => [
    {
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains',
    },
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

const RENDER_PROXY_ROUTES = [
    { source: '/socket.io', destination: '/socket.io/' },
    { source: '/socket.io/*', destination: '/socket.io/*' },
    { source: '/api/*', destination: '/api/*' },
    { source: '/health', destination: '/health' },
    { source: '/health/ready', destination: '/health/ready' },
    { source: '/health/live', destination: '/health/live' },
    { source: '/uploads/*', destination: '/uploads/*' },
];

// Render serves published files before evaluating rules, but the bare
// domain root needs an explicit rewrite: its `/*` wildcard does not match
// `/`, and directory-index behavior is unreliable once rules exist.
const RENDER_ROOT_REWRITE = { source: '/', destination: '/index.html' };

export const buildRenderProxyRoutes = (origin = HOSTED_BACKEND_ORIGIN) => {
    assertAbsoluteHttpUrl(origin);

    const normalizedOrigin = trimTrailingSlash(origin);

    return RENDER_PROXY_ROUTES.map(({ source, destination }) => ({
        type: 'rewrite',
        source,
        destination: `${normalizedOrigin}${destination}`,
    }));
};

const escapeYamlDoubleQuoted = (value = '') => String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

// Renders the Render.com Blueprint (render.yaml) for the static storefront:
// same Vite build, same backend proxy rewrites, same security headers as the
// Vercel/Netlify lanes. Regenerated by app/scripts/sync_vercel_configs.mjs.
export const buildRenderBlueprint = (origin = HOSTED_BACKEND_ORIGIN) => {
    assertAbsoluteHttpUrl(origin);

    const backendOrigin = trimTrailingSlash(origin);
    const headers = buildFrontendSecurityHeaderValues(backendOrigin);
    const routes = [
        ...buildRenderProxyRoutes(backendOrigin),
        { type: 'rewrite', ...RENDER_ROOT_REWRITE },
        { type: 'rewrite', source: '/*', destination: '/index.html' },
    ];

    const lines = [
        '# Generated by app/scripts/sync_vercel_configs.mjs — do not edit by hand.',
        `# Hosted backend origin: ${backendOrigin}`,
        'services:',
        '  - type: web',
        '    name: aura-storefront',
        '    runtime: static',
        '    buildCommand: npm --prefix app ci && npm run build --prefix app',
        '    staticPublishPath: app/dist',
        '    previews:',
        '      generation: automatic',
        '    buildFilter:',
        '      paths:',
        '        - app/**',
        '        - render.yaml',
        '    routes:',
        ...routes.flatMap(({ type, source, destination }) => [
            `      - type: ${type}`,
            `        source: ${source}`,
            `        destination: ${destination}`,
        ]),
        '    headers:',
        ...headers.flatMap(({ key, value }) => [
            '      - path: /*',
            `        name: ${key}`,
            `        value: "${escapeYamlDoubleQuoted(value)}"`,
        ]),
        '',
    ];

    return lines.join('\n');
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

// Railway serves the Vite SPA from a Caddy container (app/Dockerfile.railway
// + app/Caddyfile): same build, same backend proxy routes, same security
// headers as the Vercel/Netlify/Render lanes. The Railway platform
// healthcheck hits `/` (the SPA shell) so frontend liveness stays decoupled
// from backend health; CI verifies the proxied /health/live separately.
// Regenerated by app/scripts/sync_vercel_configs.mjs.
export const RAILWAY_HEALTHCHECK_PATH = '/';
export const RAILWAY_HEALTHCHECK_TIMEOUT = 300;

const RAILWAY_PROXY_ROUTES = [
    { handle: '/socket.io', rewrite: '/socket.io/' },
    { handle: '/socket.io/*' },
    { handle: '/api/*' },
    { handle: '/health' },
    { handle: '/health/ready' },
    { handle: '/health/live' },
    { handle: '/uploads/*' },
];

const escapeCaddyQuoted = (value = '') => String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export const buildRailwayCaddyfile = (origin = HOSTED_BACKEND_ORIGIN) => {
    assertAbsoluteHttpUrl(origin);

    const backendOrigin = trimTrailingSlash(origin);
    const headers = buildFrontendSecurityHeaderValues(backendOrigin);
    const headerLines = headers
        .map(({ key, value }) => `        ${key} "${escapeCaddyQuoted(value)}"`)
        .join('\n');

    const proxyHandles = RAILWAY_PROXY_ROUTES.map(({ handle, rewrite }) => [
        `    handle ${handle} {`,
        ...(rewrite ? [`        rewrite * ${rewrite}`] : []),
        `        reverse_proxy ${backendOrigin} {`,
        '            header_up Host {http.reverse_proxy.upstream.host}',
        '        }',
        '    }',
    ].join('\n')).join('\n\n');

    return [
        '# Generated by app/scripts/sync_vercel_configs.mjs — do not edit by hand.',
        `# Hosted backend origin: ${backendOrigin}`,
        '{',
        '    admin off',
        '    persist_config off',
        '    auto_https off',
        '    log {',
        '        format json',
        '    }',
        '    servers {',
        '        trusted_proxies static private_ranges 100.0.0.0/8',
        '    }',
        '}',
        '',
        ':{$PORT:3000} {',
        '    log {',
        '        format json',
        '    }',
        '',
        '    encode gzip',
        '',
        '    header {',
        headerLines,
        '    }',
        '',
        proxyHandles,
        '',
        '    handle /assets/* {',
        `        header Cache-Control "${FRONTEND_ASSET_CACHE_CONTROL}"`,
        '        root * dist',
        '        file_server',
        '    }',
        '',
        '    handle /sw.js {',
        `        header Cache-Control "${FRONTEND_SERVICE_WORKER_CACHE_CONTROL}"`,
        '        root * dist',
        '        file_server',
        '    }',
        '',
        '    handle /index.html {',
        `        header Cache-Control "${FRONTEND_DOCUMENT_CACHE_CONTROL}"`,
        '        root * dist',
        '        file_server',
        '    }',
        '',
        '    handle / {',
        `        header Cache-Control "${FRONTEND_DOCUMENT_CACHE_CONTROL}"`,
        '        root * dist',
        '        file_server',
        '    }',
        '',
        '    handle {',
        '        root * dist',
        '        file_server',
        '        try_files {path} /index.html',
        '    }',
        '}',
        '',
    ].join('\n');
};

// Railway config-as-code for the storefront service. The Railway service must
// use the default Root Directory (repo root — leave it empty), Config File
// `/app/railway.toml`, Dockerfile Path `app/Dockerfile.railway`, and Watch
// Paths covering app/ plus the two repo-root inputs the Vite build reads.
// Regenerated by app/scripts/sync_vercel_configs.mjs.
export const buildRailwayToml = (origin = HOSTED_BACKEND_ORIGIN) => {
    assertAbsoluteHttpUrl(origin);

    return [
        '# Generated by app/scripts/sync_vercel_configs.mjs — do not edit by hand.',
        `# Hosted backend origin: ${trimTrailingSlash(origin)}`,
        '# Railway service settings: Root Directory empty (repo root), Config File',
        '# `/app/railway.toml`, Dockerfile Path `app/Dockerfile.railway`, Watch Paths',
        '# `/app/**`, `config/desktopAuthLoopback.cjs`, `shared/assistantCapabilities.json`.',
        '# The storefront builds from the repo root because the Vite build graph',
        '# imports those two repo-root files outside app/.',
        '[build]',
        'builder = "DOCKERFILE"',
        'dockerfilePath = "app/Dockerfile.railway"',
        '',
        '[deploy]',
        `healthcheckPath = "${RAILWAY_HEALTHCHECK_PATH}"`,
        `healthcheckTimeout = ${RAILWAY_HEALTHCHECK_TIMEOUT}`,
        'restartPolicyType = "ALWAYS"',
        'restartPolicyMaxRetries = 5',
        '',
    ].join('\n');
};
