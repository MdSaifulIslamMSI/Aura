const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const DEFAULT_BACKEND_ORIGIN = 'https://dbtrhsolhec1s.cloudfront.net';
const DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN = 'https://aurapilot.vercel.app';
const DEFAULT_RUNTIME_PORT = 47831;
const STABLE_RUNTIME_FALLBACK_PORTS = 10;
const RUNTIME_LISTEN_HOST = '127.0.0.1';
const RUNTIME_PUBLIC_HOST = 'localhost';
const BROWSER_ONLY_PROXY_HEADERS = ['origin', 'referer'];
const DESKTOP_AUTH_COMPLETE_PATH = '/desktop-auth/complete';
const DESKTOP_AUTH_FRONTEND_PATH = '/desktop-login';
const DESKTOP_AUTH_CALLBACK_PARAM = 'desktopAuthCallback';
const DESKTOP_AUTH_REQUEST_TTL_MS = 5 * 60 * 1000;
const DESKTOP_AUTH_RESULT_TTL_MS = 60 * 1000;
const DESKTOP_AUTH_TOKEN_MAX_LENGTH = 8192;

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

const createDesktopAuthSecret = () => crypto.randomBytes(32).toString('base64url');

const normalizeDesktopAuthString = (value = '') => String(value || '').trim();

const isSafeRelativePath = (value = '') => {
    const normalized = normalizeDesktopAuthString(value);
    return normalized.startsWith('/') && !normalized.startsWith('//') && !normalized.startsWith('/\\');
};

const safeEquals = (left = '', right = '') => {
    const leftBuffer = Buffer.from(normalizeDesktopAuthString(left));
    const rightBuffer = Buffer.from(normalizeDesktopAuthString(right));
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const buildDesktopAuthUrl = ({
    runtimeUrl,
    authFrontendOrigin = DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN,
    path: requestPath = DESKTOP_AUTH_FRONTEND_PATH,
    requestId,
    secret,
    returnTo = '',
} = {}) => {
    const url = new URL(isSafeRelativePath(requestPath) ? requestPath : DESKTOP_AUTH_FRONTEND_PATH, authFrontendOrigin);
    url.searchParams.set('desktopAuthRequest', requestId);
    url.searchParams.set('desktopAuthSecret', secret);
    url.searchParams.set(DESKTOP_AUTH_CALLBACK_PARAM, `${trimTrailingSlash(runtimeUrl)}${DESKTOP_AUTH_COMPLETE_PATH}`);
    if (isSafeRelativePath(returnTo)) {
        url.searchParams.set('desktopAuthReturnTo', returnTo);
    }
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

const createDesktopAuthBroker = ({ onComplete = null, now = () => Date.now() } = {}) => {
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
        const request = {
            requestId,
            secret,
            expiresAt,
        };
        pendingRequests.set(requestId, request);

        return {
            requestId,
            expiresAt,
            url: buildDesktopAuthUrl({
                runtimeUrl,
                authFrontendOrigin,
                path: requestPath,
                requestId,
                secret,
                returnTo,
            }),
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
            customToken: result.customToken,
            completedAt: result.completedAt,
        };
    };

    const cancelRequest = (requestId = '') => {
        const normalizedRequestId = normalizeDesktopAuthString(requestId);
        return pendingRequests.delete(normalizedRequestId) || completedResults.delete(normalizedRequestId);
    };

    return {
        cancelRequest,
        completeRequest,
        consumeResult,
        createRequest,
        pruneExpired,
    };
};

const buildRuntimePortCandidates = (port) => {
    const requestedPort = Number(port);
    if (!Number.isInteger(requestedPort) || requestedPort <= 0) {
        return [0];
    }

    const candidates = [requestedPort];
    for (let offset = 1; offset <= STABLE_RUNTIME_FALLBACK_PORTS; offset += 1) {
        const fallbackPort = requestedPort + offset;
        if (fallbackPort < 65536) {
            candidates.push(fallbackPort);
        }
    }

    candidates.push(0);
    return candidates;
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

const startRuntimeServer = async ({ distDir, port = DEFAULT_RUNTIME_PORT, onDesktopAuthComplete = null } = {}) => {
    const resolvedDistDir = path.resolve(distDir);
    assertDistExists(resolvedDistDir);

    const backendOrigin = resolveBackendOrigin();
    const desktopAuthFrontendOrigin = resolveDesktopAuthFrontendOrigin();
    const allowedDesktopAuthOrigins = resolveAllowedDesktopAuthOrigins(desktopAuthFrontendOrigin);
    const app = express();
    const server = http.createServer(app);
    const desktopAuthBroker = createDesktopAuthBroker({ onComplete: onDesktopAuthComplete });

    const socketProxy = createProxyMiddleware(buildProxyOptions(backendOrigin));
    const apiProxy = createProxyMiddleware(buildProxyOptions(backendOrigin));

    app.disable('x-powered-by');

    app.use('/socket.io', socketProxy);
    app.use('/api', apiProxy);
    app.use('/health', apiProxy);
    app.use('/uploads', apiProxy);
    app.options(DESKTOP_AUTH_COMPLETE_PATH, (request, response) => {
        if (!applyDesktopAuthCors(request, response, allowedDesktopAuthOrigins)) {
            response.status(403).end();
            return;
        }
        response.status(204).end();
    });
    app.post(DESKTOP_AUTH_COMPLETE_PATH, express.json({ limit: '16kb' }), (request, response) => {
        const hasOrigin = Boolean(String(request.headers.origin || '').trim());
        if (hasOrigin && !applyDesktopAuthCors(request, response, allowedDesktopAuthOrigins)) {
            response.status(403).json({
                success: false,
                message: 'Desktop sign-in callback origin is not trusted.',
            });
            return;
        }

        try {
            const result = desktopAuthBroker.completeRequest(request.body || {});
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
    app.use(applyLocalFrontendCachePolicy);
    app.use(express.static(resolvedDistDir, { index: false }));

    app.use((_request, response) => {
        response.sendFile(path.join(resolvedDistDir, 'index.html'));
    });

    server.on('upgrade', socketProxy.upgrade);

    const portCandidates = buildRuntimePortCandidates(port);
    let lastListenError = null;

    for (const candidatePort of portCandidates) {
        try {
            await listenOnPort(server, candidatePort);
            if (candidatePort !== port && Number(candidatePort) !== 0) {
                console.info(`[desktop] runtime server using fallback port ${candidatePort}.`);
            } else if (Number(candidatePort) === 0 && Number(port) !== 0) {
                console.warn('[desktop] stable runtime ports are busy; falling back to an ephemeral port.');
            }
            lastListenError = null;
            break;
        } catch (error) {
            lastListenError = error;
            if (error?.code !== 'EADDRINUSE') {
                throw error;
            }
            console.warn(`[desktop] runtime port ${candidatePort} is busy; trying another local port.`);
        }
    }

    if (lastListenError) {
        throw lastListenError;
    }

    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Unable to determine desktop runtime server port.');
    }

    const runtimeUrl = buildRuntimeUrl(address.port);

    return {
        backendOrigin,
        cancelDesktopAuthRequest: desktopAuthBroker.cancelRequest,
        consumeDesktopAuthResult: desktopAuthBroker.consumeResult,
        createDesktopAuthRequest: (options = {}) => desktopAuthBroker.createRequest({
            ...options,
            authFrontendOrigin: desktopAuthFrontendOrigin,
            runtimeUrl,
        }),
        desktopAuthFrontendOrigin,
        distDir: resolvedDistDir,
        port: address.port,
        server,
        url: runtimeUrl,
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
    DESKTOP_AUTH_COMPLETE_PATH,
    DESKTOP_AUTH_FRONTEND_PATH,
    applyDesktopAuthCors,
    buildDesktopAuthUrl,
    RUNTIME_LISTEN_HOST,
    RUNTIME_PUBLIC_HOST,
    buildProxyOptions,
    isLoopbackBackendOrigin,
    applyLocalFrontendCachePolicy,
    createDesktopAuthBroker,
    buildRuntimeUrl,
    resolveAllowedDesktopAuthOrigins,
    resolveBackendOrigin,
    resolveDesktopAuthFrontendOrigin,
    shouldAllowInsecureBackendProxy,
    startRuntimeServer,
    stripBrowserOnlyProxyHeaders,
};
