const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { createDesktopOwnerAccessSignIn } = require('./ownerAccessAuth.cjs');
const { createPublicCatalogFetch } = require('./publicCatalogBridge.cjs');

const DEFAULT_BACKEND_ORIGIN = 'https://dbtrhsolhec1s.cloudfront.net';
const DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN = 'https://aurapilot.vercel.app';
const DEFAULT_RUNTIME_PORT = 47831;
const STABLE_RUNTIME_FALLBACK_PORTS = 10;
const MAX_STABLE_RUNTIME_PORT = DEFAULT_RUNTIME_PORT + STABLE_RUNTIME_FALLBACK_PORTS;
const RUNTIME_LISTEN_HOST = '127.0.0.1';
const RUNTIME_PUBLIC_HOST = 'localhost';
const RUNTIME_CALLBACK_HOST = RUNTIME_LISTEN_HOST;
const BROWSER_ONLY_PROXY_HEADERS = ['origin', 'referer'];
const DESKTOP_AUTH_COMPLETE_PATH = '/desktop-auth/complete';
const DESKTOP_AUTH_CANCEL_PATH = '/desktop-auth/cancel';
const DESKTOP_AUTH_FRONTEND_PATH = '/desktop-login';
const DESKTOP_AUTH_CALLBACK_PARAM = 'desktopAuthCallback';
const DESKTOP_AUTH_TRANSPORT_PARAM = 'desktopAuthTransport';
const DESKTOP_AUTH_FORM_TRANSPORT = 'form_post';
const DESKTOP_AUTH_PROTOCOL_META_NAME = 'aura-desktop-auth-protocol';
const DESKTOP_AUTH_PROTOCOL_VERSION = '2';
const DESKTOP_AUTH_REQUEST_TTL_MS = 10 * 60 * 1000;
const DESKTOP_AUTH_RESULT_TTL_MS = 60 * 1000;
const DESKTOP_AUTH_TOKEN_MAX_LENGTH = 8192;
const createDesktopAuthResultHtml = ({ title, heading, message }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${title}</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f4f4f4;background:#1f1f1f}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;min-height:100svh;display:grid;place-items:center;background:#1f1f1f}
    main{width:min(28rem,calc(100% - 3rem));text-align:center}
    .mark{display:grid;place-items:center;width:3rem;height:3rem;margin:0 auto 1.75rem;border:1px solid #6f6f6f;border-radius:50%;color:#ededed;font-size:1.25rem;font-weight:650;letter-spacing:-.04em}
    h1{margin:0 0 .75rem;font-size:1.5rem;font-weight:500;letter-spacing:-.02em}
    p{margin:.35rem 0;color:#a8a8a8;font-size:.95rem;line-height:1.55}
  </style>
</head>
<body><main><div class="mark" aria-hidden="true">A</div><h1>${heading}</h1><p>${message}</p><p>You can close this tab.</p></main></body>
</html>`;

const DESKTOP_AUTH_COMPLETE_HTML = createDesktopAuthResultHtml({
    title: 'Aura Desktop Sign-In Complete',
    heading: 'Sign-in complete',
    message: 'Aura Desktop received the secure result. Return to the desktop app.',
});

const DESKTOP_AUTH_CANCEL_HTML = createDesktopAuthResultHtml({
    title: 'Aura Desktop Sign-In Cancelled',
    heading: 'Sign-in cancelled',
    message: 'Aura Desktop cancelled this browser sign-in.',
});

const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const isLoopbackBackendOrigin = (backendOrigin = '') => {
    try {
        const hostname = new URL(backendOrigin).hostname.toLowerCase();
        return hostname === 'localhost'
            || hostname === '::1'
            || hostname === '[::1]'
            || hostname === '0.0.0.0'
            || hostname.startsWith('127.');
    } catch {
        return false;
    }
};

const shouldAllowInsecureBackendProxy = (backendOrigin = '') => (
    process.env.NODE_ENV !== 'production'
    && parseBooleanEnv(process.env.AURA_DESKTOP_ALLOW_INSECURE_BACKEND_PROXY, false)
    && isLoopbackBackendOrigin(backendOrigin)
);

const resolveBackendOrigin = () => {
    const configured = String(
        process.env.AURA_DESKTOP_BACKEND_ORIGIN
        || process.env.AURA_BACKEND_ORIGIN
        || DEFAULT_BACKEND_ORIGIN
    ).trim();

    return trimTrailingSlash(configured);
};

const resolveDesktopAuthFrontendOrigin = () => {
    const configured = String(
        process.env.AURA_DESKTOP_AUTH_FRONTEND_ORIGIN
        || process.env.AURA_DESKTOP_AUTH_FRONTEND_URL
        || process.env.AURA_FRONTEND_ORIGIN
        || process.env.VITE_VERCEL_FRONTEND_URL
        || DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN
    ).trim();

    try {
        const url = new URL(configured);
        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error('Unsupported desktop auth frontend protocol');
        }
        const pathname = url.pathname.replace(/\/+$/, '');
        return trimTrailingSlash(`${url.origin}${pathname}`);
    } catch {
        return DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN;
    }
};

const assertDistExists = (distDir) => {
    const indexPath = path.join(distDir, 'index.html');
    if (!fs.existsSync(indexPath)) {
        throw new Error(
            `Frontend build not found at "${indexPath}". Run "npm run desktop:frontend:build" first.`
        );
    }
};

const readDesktopAuthProtocolVersion = (html = '') => {
    const metaPattern = new RegExp(
        `<meta\\s+name=["']${DESKTOP_AUTH_PROTOCOL_META_NAME}["']\\s+content=["']([^"']+)["']\\s*\\/?\\s*>`,
        'i'
    );
    return String(metaPattern.exec(String(html || ''))?.[1] || '').trim();
};

const validateDesktopAuthFrontend = async ({
    authFrontendOrigin = DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN,
    fetchImpl = globalThis.fetch,
    timeoutMs = 8000,
} = {}) => {
    if (typeof fetchImpl !== 'function') {
        throw new Error('Desktop browser sign-in compatibility check is unavailable.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetchImpl(new URL(DESKTOP_AUTH_FRONTEND_PATH, authFrontendOrigin), {
            headers: { Accept: 'text/html' },
            redirect: 'follow',
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`Hosted desktop sign-in returned HTTP ${response.status}.`);
        }

        const protocolVersion = readDesktopAuthProtocolVersion(await response.text());
        if (protocolVersion !== DESKTOP_AUTH_PROTOCOL_VERSION) {
            const error = new Error(
                'Hosted desktop sign-in is out of date. Update the Aura web login before starting browser sign-in.'
            );
            error.code = 'auth/desktop-browser-protocol-mismatch';
            throw error;
        }

        return { protocolVersion };
    } catch (error) {
        if (error?.code === 'auth/desktop-browser-protocol-mismatch') {
            throw error;
        }
        const compatibilityError = new Error(
            'Aura could not verify the hosted browser sign-in service. Check your connection and try again.'
        );
        compatibilityError.code = 'auth/desktop-browser-compatibility-check-failed';
        compatibilityError.cause = error;
        throw compatibilityError;
    } finally {
        clearTimeout(timeout);
    }
};

const stripBrowserOnlyProxyHeaders = (proxyReq) => {
    for (const header of BROWSER_ONLY_PROXY_HEADERS) {
        proxyReq.removeHeader?.(header);
    }
    proxyReq.setHeader?.('X-Aura-Desktop-Proxy', '1');
};

const buildProxyOptions = (backendOrigin) => ({
    target: backendOrigin,
    changeOrigin: true,
    ws: true,
    xfwd: true,
    secure: !shouldAllowInsecureBackendProxy(backendOrigin),
    cookieDomainRewrite: '',
    logLevel: 'warn',
    on: {
        proxyReq: stripBrowserOnlyProxyHeaders,
        proxyReqWs: stripBrowserOnlyProxyHeaders,
    },
    pathRewrite: (_path, request) => request.originalUrl || request.url,
});

const applyLocalFrontendCachePolicy = (request, response, next) => {
    const pathname = String(request.path || request.url || '');
    if (
        !pathname.startsWith('/api')
        && !pathname.startsWith('/socket.io')
        && !pathname.startsWith('/health')
        && !pathname.startsWith('/uploads')
    ) {
        response.setHeader('Cache-Control', 'no-store, max-age=0');
        response.setHeader('Pragma', 'no-cache');
    }
    next();
};

const buildRuntimeUrl = (port) => `http://${RUNTIME_PUBLIC_HOST}:${port}`;

const buildRuntimeCallbackUrl = (port) => `http://${RUNTIME_CALLBACK_HOST}:${port}`;

const createDesktopAuthSecret = () => crypto.randomBytes(32).toString('base64url');

const normalizeDesktopAuthString = (value = '') => String(value || '').trim();

const isSafeRelativePath = (value = '') => {
    const normalized = normalizeDesktopAuthString(value);
    if (
        !normalized.startsWith('/')
        || normalized.startsWith('//')
        || normalized.includes('\\')
        || /[\u0000-\u001f\u007f]/.test(normalized)
    ) {
        return false;
    }

    // Reject encoded and double-encoded network-path/backslash variants. A
    // return target may be decoded by more than one browser/router layer, so
    // validating only the raw string can turn an apparently relative path into
    // an authority-like path later in the handoff.
    let decoded = normalized;
    try {
        for (let pass = 0; pass < 2; pass += 1) {
            const next = decodeURIComponent(decoded);
            if (
                next.startsWith('//')
                || next.startsWith('/\\')
                || next.includes('\\')
                || /[\u0000-\u001f\u007f]/.test(next)
            ) {
                return false;
            }
            if (next === decoded) break;
            decoded = next;
        }
    } catch {
        return false;
    }

    return true;
};

const safeEquals = (left = '', right = '') => {
    const leftDigest = crypto.createHash('sha256').update(normalizeDesktopAuthString(left)).digest();
    const rightDigest = crypto.createHash('sha256').update(normalizeDesktopAuthString(right)).digest();
    return crypto.timingSafeEqual(leftDigest, rightDigest);
};

const buildDesktopAuthUrl = ({
    runtimeUrl,
    callbackUrl,
    authFrontendOrigin = DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN,
    path: requestPath = DESKTOP_AUTH_FRONTEND_PATH,
    requestId,
    secret,
    returnTo = '',
} = {}) => {
    const url = new URL(isSafeRelativePath(requestPath) ? requestPath : DESKTOP_AUTH_FRONTEND_PATH, authFrontendOrigin);
    const trustedCallbackUrl = callbackUrl || runtimeUrl;
    url.searchParams.set('desktopAuthRequest', requestId);
    const handoffParams = new URLSearchParams();
    handoffParams.set('desktopAuthSecret', secret);
    handoffParams.set(DESKTOP_AUTH_CALLBACK_PARAM, `${trimTrailingSlash(trustedCallbackUrl)}${DESKTOP_AUTH_COMPLETE_PATH}`);
    handoffParams.set(DESKTOP_AUTH_TRANSPORT_PARAM, DESKTOP_AUTH_FORM_TRANSPORT);
    if (isSafeRelativePath(returnTo)) {
        handoffParams.set('desktopAuthReturnTo', returnTo);
    }
    url.hash = handoffParams.toString();
    return url.toString();
};

const getDesktopAuthOrigin = (value = '') => {
    try {
        return new URL(value).origin;
    } catch {
        return '';
    }
};

const resolveAllowedDesktopAuthOrigins = (authFrontendOrigin = DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN) => {
    const configuredOrigins = String(process.env.AURA_DESKTOP_AUTH_ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => getDesktopAuthOrigin(origin.trim()))
        .filter(Boolean);
    const primaryOrigin = getDesktopAuthOrigin(authFrontendOrigin);
    return new Set([primaryOrigin, ...configuredOrigins].filter(Boolean));
};

const applyDesktopAuthCors = (request, response, allowedOrigins) => {
    const origin = String(request.headers.origin || '').trim();
    if (!origin || !allowedOrigins.has(origin)) {
        return false;
    }

    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Max-Age', '300');
    if (request.headers['access-control-request-private-network']) {
        response.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    return true;
};

const isOpaqueDesktopAuthNavigation = (request = {}) => {
    const headers = request.headers || {};
    const contentType = String(headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase();

    return String(headers.origin || '').trim().toLowerCase() === 'null'
        && contentType === 'application/x-www-form-urlencoded'
        && String(headers['sec-fetch-site'] || '').trim().toLowerCase() === 'cross-site'
        && String(headers['sec-fetch-mode'] || '').trim().toLowerCase() === 'navigate'
        && String(headers['sec-fetch-dest'] || '').trim().toLowerCase() === 'document';
};

const createLocalRateLimiter = ({ windowMs, max }) => {
    const windows = new Map();

    return (request, response, next) => {
        const now = Date.now();
        const key = String(request.ip || request.socket?.remoteAddress || 'loopback');
        const current = windows.get(key);
        const windowState = !current || current.resetAt <= now
            ? { count: 1, resetAt: now + windowMs }
            : { count: current.count + 1, resetAt: current.resetAt };
        windows.set(key, windowState);

        if (windowState.count > max) {
            response.status(429).json({
                success: false,
                message: 'Too many desktop sign-in callback requests. Please try again shortly.',
            });
            return;
        }
        next();
    };
};

const createDesktopAuthBroker = ({ onComplete = null, onCancel = null, now = () => Date.now() } = {}) => {
    const pendingRequests = new Map();
    const completedResults = new Map();

    const pruneExpired = () => {
        const currentTime = now();
        for (const [requestId, request] of pendingRequests.entries()) {
            if (request.expiresAt <= currentTime) {
                pendingRequests.delete(requestId);
            }
        }
        for (const [requestId, result] of completedResults.entries()) {
            if (result.expiresAt <= currentTime) {
                completedResults.delete(requestId);
            }
        }
    };

    const createRequest = ({
        runtimeUrl,
        callbackUrl,
        authFrontendOrigin = DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN,
        path: requestPath = DESKTOP_AUTH_FRONTEND_PATH,
        returnTo = '',
    } = {}) => {
        pruneExpired();
        if (!runtimeUrl) {
            throw new Error('Desktop auth runtime URL is unavailable.');
        }

        const requestId = crypto.randomUUID();
        const secret = createDesktopAuthSecret();
        const expiresAt = now() + DESKTOP_AUTH_REQUEST_TTL_MS;
        const url = buildDesktopAuthUrl({
            runtimeUrl,
            callbackUrl,
            authFrontendOrigin,
            path: requestPath,
            requestId,
            secret,
            returnTo,
        });
        const request = {
            requestId,
            secret,
            expiresAt,
            url,
        };
        pendingRequests.set(requestId, request);

        return {
            requestId,
            expiresAt,
            url,
        };
    };

    const getRequest = (requestId = '') => {
        pruneExpired();
        const normalizedRequestId = normalizeDesktopAuthString(requestId);
        const request = pendingRequests.get(normalizedRequestId);
        if (!request) {
            return null;
        }

        return {
            requestId: request.requestId,
            expiresAt: request.expiresAt,
            url: request.url,
        };
    };

    const completeRequest = ({ requestId = '', secret = '', customToken = '' } = {}) => {
        pruneExpired();
        const normalizedRequestId = normalizeDesktopAuthString(requestId);
        const normalizedSecret = normalizeDesktopAuthString(secret);
        const normalizedToken = normalizeDesktopAuthString(customToken);
        const pendingRequest = pendingRequests.get(normalizedRequestId);

        if (!pendingRequest) {
            const error = new Error('Desktop sign-in request is expired or unknown.');
            error.statusCode = 404;
            throw error;
        }

        if (!safeEquals(pendingRequest.secret, normalizedSecret)) {
            const error = new Error('Desktop sign-in request could not be verified.');
            error.statusCode = 403;
            throw error;
        }

        if (!normalizedToken || normalizedToken.length > DESKTOP_AUTH_TOKEN_MAX_LENGTH) {
            const error = new Error('Desktop sign-in token is missing or too large.');
            error.statusCode = 422;
            throw error;
        }

        pendingRequests.delete(normalizedRequestId);
        const completedAt = now();
        completedResults.set(normalizedRequestId, {
            requestId: normalizedRequestId,
            customToken: normalizedToken,
            completedAt,
            expiresAt: completedAt + DESKTOP_AUTH_RESULT_TTL_MS,
        });

        onComplete?.({
            requestId: normalizedRequestId,
            completedAt,
        });

        return {
            requestId: normalizedRequestId,
            completedAt,
        };
    };

    const consumeResult = (requestId = '') => {
        pruneExpired();
        const normalizedRequestId = normalizeDesktopAuthString(requestId);
        const result = completedResults.get(normalizedRequestId);
        if (!result) {
            return null;
        }

        completedResults.delete(normalizedRequestId);
        return {
            requestId: result.requestId,
            ...(result.cancelled
                ? {
                    cancelled: true,
                    cancelledAt: result.cancelledAt,
                }
                : {
                    customToken: result.customToken,
                    completedAt: result.completedAt,
                }),
        };
    };

    const cancelAuthenticatedRequest = ({ requestId = '', secret = '' } = {}) => {
        pruneExpired();
        const normalizedRequestId = normalizeDesktopAuthString(requestId);
        const normalizedSecret = normalizeDesktopAuthString(secret);
        const pendingRequest = pendingRequests.get(normalizedRequestId);

        if (!pendingRequest) {
            const error = new Error('Desktop sign-in request is expired or unknown.');
            error.statusCode = 404;
            throw error;
        }

        if (!safeEquals(pendingRequest.secret, normalizedSecret)) {
            const error = new Error('Desktop sign-in request could not be verified.');
            error.statusCode = 403;
            throw error;
        }

        pendingRequests.delete(normalizedRequestId);
        const cancelledAt = now();
        completedResults.set(normalizedRequestId, {
            requestId: normalizedRequestId,
            cancelled: true,
            cancelledAt,
            expiresAt: cancelledAt + DESKTOP_AUTH_RESULT_TTL_MS,
        });
        onCancel?.({
            requestId: normalizedRequestId,
            cancelledAt,
        });

        return {
            requestId: normalizedRequestId,
            cancelledAt,
        };
    };

    const cancelRequest = (requestId = '') => {
        const normalizedRequestId = normalizeDesktopAuthString(requestId);
        return pendingRequests.delete(normalizedRequestId) || completedResults.delete(normalizedRequestId);
    };

    return {
        cancelAuthenticatedRequest,
        cancelRequest,
        completeRequest,
        consumeResult,
        createRequest,
        getRequest,
        pruneExpired,
    };
};

const buildRuntimePortCandidates = (port) => {
    const requestedPort = Number(port);
    if (
        !Number.isInteger(requestedPort)
        || requestedPort < DEFAULT_RUNTIME_PORT
        || requestedPort > MAX_STABLE_RUNTIME_PORT
    ) {
        throw new Error('Desktop runtime requires a fixed loopback port.');
    }

    return [requestedPort];
};

const listenOnPort = (server, port) => new Promise((resolve, reject) => {
    const handleError = (error) => {
        server.off('listening', handleListening);
        reject(error);
    };
    const handleListening = () => {
        server.off('error', handleError);
        resolve();
    };

    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen(port, RUNTIME_LISTEN_HOST);
});

const startRuntimeServer = async ({
    distDir,
    port = DEFAULT_RUNTIME_PORT,
    onDesktopAuthComplete = null,
    onDesktopAuthCancel = null,
} = {}) => {
    const resolvedDistDir = path.resolve(distDir);
    assertDistExists(resolvedDistDir);
    const frontendIndexHtml = fs.readFileSync(path.join(resolvedDistDir, 'index.html'), 'utf8');

    const backendOrigin = resolveBackendOrigin();
    const desktopAuthFrontendOrigin = resolveDesktopAuthFrontendOrigin();
    const allowedDesktopAuthOrigins = resolveAllowedDesktopAuthOrigins(desktopAuthFrontendOrigin);
    const app = express();
    const server = http.createServer(app);
    const desktopAuthBroker = createDesktopAuthBroker({
        onComplete: onDesktopAuthComplete,
        onCancel: onDesktopAuthCancel,
    });
    const desktopAuthCallbackLimiter = rateLimit({
        windowMs: 60 * 1000,
        limit: 60,
        standardHeaders: false,
        legacyHeaders: false,
        handler: (_request, response) => response.status(429).json({
            success: false,
            message: 'Too many desktop sign-in callback requests. Please try again shortly.',
        }),
    });
    const frontendFallbackLimiter = createLocalRateLimiter({ windowMs: 60 * 1000, max: 600 });

    const socketProxy = createProxyMiddleware(buildProxyOptions(backendOrigin));
    const apiProxy = createProxyMiddleware(buildProxyOptions(backendOrigin));

    app.disable('x-powered-by');

    app.use('/socket.io', socketProxy);
    app.use('/api', apiProxy);
    app.use('/health', apiProxy);
    app.use('/uploads', apiProxy);
    const handleDesktopAuthPreflight = (request, response) => {
        if (!applyDesktopAuthCors(request, response, allowedDesktopAuthOrigins)) {
            response.status(403).end();
            return;
        }
        response.status(204).end();
    };
    app.options(DESKTOP_AUTH_COMPLETE_PATH, desktopAuthCallbackLimiter, handleDesktopAuthPreflight);
    app.options(DESKTOP_AUTH_CANCEL_PATH, desktopAuthCallbackLimiter, handleDesktopAuthPreflight);
    app.post(
        DESKTOP_AUTH_COMPLETE_PATH,
        desktopAuthCallbackLimiter,
        express.json({ limit: '16kb' }),
        express.urlencoded({ extended: false, limit: '16kb' }),
        (request, response) => {
        const hasOrigin = Boolean(String(request.headers.origin || '').trim());
        const hasTrustedCorsOrigin = hasOrigin
            && applyDesktopAuthCors(request, response, allowedDesktopAuthOrigins);
        if (hasOrigin && !hasTrustedCorsOrigin && !isOpaqueDesktopAuthNavigation(request)) {
            response.status(403).json({
                success: false,
                message: 'Desktop sign-in callback origin is not trusted.',
            });
            return;
        }

        try {
            const result = desktopAuthBroker.completeRequest(request.body || {});
            if (request.is('application/x-www-form-urlencoded')) {
                response.status(200).type('html').send(DESKTOP_AUTH_COMPLETE_HTML);
                return;
            }
            response.json({
                success: true,
                requestId: result.requestId,
            });
        } catch (error) {
            response.status(error.statusCode || 400).json({
                success: false,
                message: error?.message || 'Desktop sign-in could not be completed.',
            });
        }
    });
    app.post(
        DESKTOP_AUTH_CANCEL_PATH,
        desktopAuthCallbackLimiter,
        express.json({ limit: '16kb' }),
        express.urlencoded({ extended: false, limit: '16kb' }),
        (request, response) => {
        const hasOrigin = Boolean(String(request.headers.origin || '').trim());
        const hasTrustedCorsOrigin = hasOrigin
            && applyDesktopAuthCors(request, response, allowedDesktopAuthOrigins);
        if (hasOrigin && !hasTrustedCorsOrigin && !isOpaqueDesktopAuthNavigation(request)) {
            response.status(403).json({
                success: false,
                message: 'Desktop sign-in callback origin is not trusted.',
            });
            return;
        }

        try {
            const result = desktopAuthBroker.cancelAuthenticatedRequest(request.body || {});
            if (request.is('application/x-www-form-urlencoded')) {
                response.status(200).type('html').send(DESKTOP_AUTH_CANCEL_HTML);
                return;
            }
            response.json({
                success: true,
                requestId: result.requestId,
            });
        } catch (error) {
            response.status(error.statusCode || 400).json({
                success: false,
                message: error?.message || 'Desktop sign-in could not be cancelled.',
            });
        }
    });
    app.use(applyLocalFrontendCachePolicy);
    app.use(express.static(resolvedDistDir, { index: false }));

    app.use(frontendFallbackLimiter, (_request, response) => {
        response.type('html').send(frontendIndexHtml);
    });

    server.on('upgrade', socketProxy.upgrade);

    const [runtimePort] = buildRuntimePortCandidates(port);
    try {
        await listenOnPort(server, runtimePort);
    } catch (listenError) {
        if (listenError?.code !== 'EADDRINUSE') {
            throw listenError;
        }

        const error = new Error(
            `Aura could not start its secure local sign-in service because port ${runtimePort} is already in use. Close the other Aura instance or process using this port, then reopen Aura.`
        );
        error.code = listenError.code;
        error.cause = listenError;
        throw error;
    }

    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Unable to determine desktop runtime server port.');
    }

    const runtimeUrl = buildRuntimeUrl(address.port);
    const runtimeCallbackUrl = buildRuntimeCallbackUrl(address.port);

    return {
        backendOrigin,
        cancelDesktopAuthRequest: desktopAuthBroker.cancelRequest,
        consumeDesktopAuthResult: desktopAuthBroker.consumeResult,
        createDesktopAuthRequest: (options = {}) => desktopAuthBroker.createRequest({
            ...options,
            authFrontendOrigin: desktopAuthFrontendOrigin,
            callbackUrl: runtimeCallbackUrl,
            runtimeUrl,
        }),
        getDesktopAuthRequest: desktopAuthBroker.getRequest,
        createDesktopOwnerAccessSignIn: () => createDesktopOwnerAccessSignIn({ backendOrigin }),
        fetchPublicCatalog: createPublicCatalogFetch({ backendOrigin }),
        desktopAuthFrontendOrigin,
        distDir: resolvedDistDir,
        port: address.port,
        server,
        url: runtimeUrl,
        callbackUrl: runtimeCallbackUrl,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        }),
    };
};

module.exports = {
    DEFAULT_BACKEND_ORIGIN,
    DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN,
    DEFAULT_RUNTIME_PORT,
    MAX_STABLE_RUNTIME_PORT,
    DESKTOP_AUTH_PROTOCOL_META_NAME,
    DESKTOP_AUTH_PROTOCOL_VERSION,
    DESKTOP_AUTH_REQUEST_TTL_MS,
    DESKTOP_AUTH_CANCEL_PATH,
    DESKTOP_AUTH_COMPLETE_PATH,
    DESKTOP_AUTH_FRONTEND_PATH,
    applyDesktopAuthCors,
    buildDesktopAuthUrl,
    buildRuntimePortCandidates,
    RUNTIME_LISTEN_HOST,
    RUNTIME_PUBLIC_HOST,
    RUNTIME_CALLBACK_HOST,
    buildProxyOptions,
    isLoopbackBackendOrigin,
    isOpaqueDesktopAuthNavigation,
    applyLocalFrontendCachePolicy,
    createDesktopAuthBroker,
    createLocalRateLimiter,
    buildRuntimeCallbackUrl,
    buildRuntimeUrl,
    resolveAllowedDesktopAuthOrigins,
    resolveBackendOrigin,
    resolveDesktopAuthFrontendOrigin,
    readDesktopAuthProtocolVersion,
    shouldAllowInsecureBackendProxy,
    startRuntimeServer,
    stripBrowserOnlyProxyHeaders,
    validateDesktopAuthFrontend,
};
