const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { createDesktopOwnerAccessSignIn } = require('./ownerAccessAuth.cjs');
const { createPublicCatalogFetch } = require('./publicCatalogBridge.cjs');
const { buildProxyOptions } = require('./backendProxy.cjs');
const { createDesktopAuthBroker } = require('./desktopAuthBroker.cjs');
const {
    DESKTOP_AUTH_CANCEL_PATH,
    DESKTOP_AUTH_COMPLETE_PATH,
    DESKTOP_AUTH_COMPLETE_HTML,
    DESKTOP_AUTH_CANCEL_HTML,
    applyDesktopAuthCors,
    applyDesktopAuthResponseSecurityHeaders,
    isOpaqueDesktopAuthNavigation,
    sendDesktopAuthFailure,
} = require('./desktopAuthProtocol.cjs');
const {
    DEFAULT_RUNTIME_PORT,
    RUNTIME_LISTEN_HOST,
    assertDistExists,
    buildRuntimeCallbackUrl,
    buildRuntimePortCandidates,
    buildRuntimeUrl,
    isAllowedRuntimeHostHeader,
    rejectForeignRuntimeHost,
    resolveAllowedDesktopAuthOrigins,
    resolveBackendOrigin,
    resolveDesktopAuthFrontendOrigin,
} = require('./runtimeConfig.cjs');

// Composition root. This module owns only the HTTP assembly and the server
// lifecycle; the concerns it delegates are split across:
//
//   runtimeConfig.cjs        origins, ports, loopback + DNS-rebinding guards
//   backendProxy.cjs         the proxy to the hosted backend
//   desktopAuthProtocol.cjs  the stateless browser sign-in handoff contract
//   desktopAuthBroker.cjs    the per-request sign-in lifecycle
//
// Every historical export is still re-exported at the bottom: desktop/main.cjs,
// runtimeServer.test.cjs, and scripts/desktop/verify-packaged-runtime.mjs (which
// loads this file from an extracted asar) all resolve names from here.

// Bounds the throwaway startup request below. Deliberately short: if the loopback
// stack is not answering, booting should continue rather than wait on warmup.
const WARMUP_TIMEOUT_MS = 2000;

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

// Registers the /desktop-auth/complete and /desktop-auth/cancel pair, which
// differ only in which broker call they make and which result page they serve.
const registerDesktopAuthCallbackRoute = ({
    app,
    path: routePath,
    run,
    successHtml,
    failureMessage,
    callbackLimiter,
    requireTrustedPreflightOrigin,
}) => {
    // A preflight from an untrusted origin must be refused outright. Returning
    // 204 to any origin advertises that the POST is reachable, which is what
    // the browser then tries; the origin gate has to run before the limiter so
    // hostile origins cannot probe this route either.
    const handlePreflight = (_request, response) => {
        response.status(204).end();
    };

    app.options(
        routePath,
        applyDesktopAuthResponseSecurityHeaders,
        requireTrustedPreflightOrigin,
        callbackLimiter,
        handlePreflight
    );

    app.post(
        routePath,
        callbackLimiter,
        express.json({ limit: '16kb' }),
        express.urlencoded({ extended: false, limit: '16kb' }),
        (request, response) => {
            try {
                const result = run(request.body || {});
                if (request.is('application/x-www-form-urlencoded')) {
                    response.status(200).type('html').send(successHtml);
                    return;
                }
                response.json({
                    success: true,
                    requestId: result.requestId,
                });
            } catch (error) {
                sendDesktopAuthFailure(request, response, {
                    statusCode: error.statusCode || 400,
                    message: error?.message || failureMessage,
                });
            }
        }
    );
};

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
    const desktopAuthTransportLimiter = rateLimit({
        windowMs: 60 * 1000,
        limit: 120,
        standardHeaders: false,
        legacyHeaders: false,
        keyGenerator: (request) => {
            const origin = String(request.headers.origin || '').trim();
            if (allowedDesktopAuthOrigins.has(origin)) {
                return `trusted:${origin}`;
            }
            if (isOpaqueDesktopAuthNavigation(request)) {
                return 'opaque-navigation';
            }
            return 'untrusted';
        },
        handler: (request, response) => sendDesktopAuthFailure(request, response, {
            statusCode: 429,
            message: 'Too many desktop sign-in transport requests. Please try again shortly.',
        }),
    });
    const desktopAuthCallbackLimiter = rateLimit({
        windowMs: 60 * 1000,
        limit: 60,
        standardHeaders: false,
        legacyHeaders: false,
        handler: (request, response) => sendDesktopAuthFailure(request, response, {
            statusCode: 429,
            message: 'Too many desktop sign-in callback requests. Please try again shortly.',
        }),
    });
    const frontendFallbackLimiter = createLocalRateLimiter({ windowMs: 60 * 1000, max: 600 });

    const socketProxy = createProxyMiddleware(buildProxyOptions(backendOrigin));
    const apiProxy = createProxyMiddleware(buildProxyOptions(backendOrigin));

    app.disable('x-powered-by');

    app.use(rejectForeignRuntimeHost);

    app.use('/socket.io', socketProxy);
    app.use('/api', apiProxy);
    app.use('/health', apiProxy);
    app.use('/uploads', apiProxy);

    const requireTrustedDesktopAuthPreflightOrigin = (request, response, next) => {
        if (!applyDesktopAuthCors(request, response, allowedDesktopAuthOrigins)) {
            response.status(403).end();
            return;
        }
        next();
    };
    const requireTrustedDesktopAuthTransport = (request, response, next) => {
        if (
            applyDesktopAuthCors(request, response, allowedDesktopAuthOrigins)
            || isOpaqueDesktopAuthNavigation(request)
        ) {
            next();
            return;
        }
        sendDesktopAuthFailure(request, response, {
            statusCode: 403,
            message: 'Desktop sign-in callback origin is not trusted.',
        });
    };

    // Reject untrusted browser transports before they reach the counted callback
    // route. Keeping this gate outside the POST handler prevents hostile origins
    // from exhausting the rate-limit budget reserved for legitimate handoffs.
    app.use(
        [DESKTOP_AUTH_COMPLETE_PATH, DESKTOP_AUTH_CANCEL_PATH],
        applyDesktopAuthResponseSecurityHeaders,
        desktopAuthTransportLimiter,
        requireTrustedDesktopAuthTransport,
    );

    registerDesktopAuthCallbackRoute({
        app,
        path: DESKTOP_AUTH_COMPLETE_PATH,
        run: (body) => desktopAuthBroker.completeRequest(body),
        successHtml: DESKTOP_AUTH_COMPLETE_HTML,
        failureMessage: 'Desktop sign-in could not be completed.',
        callbackLimiter: desktopAuthCallbackLimiter,
        requireTrustedPreflightOrigin: requireTrustedDesktopAuthPreflightOrigin,
    });
    registerDesktopAuthCallbackRoute({
        app,
        path: DESKTOP_AUTH_CANCEL_PATH,
        run: (body) => desktopAuthBroker.cancelAuthenticatedRequest(body),
        successHtml: DESKTOP_AUTH_CANCEL_HTML,
        failureMessage: 'Desktop sign-in could not be cancelled.',
        callbackLimiter: desktopAuthCallbackLimiter,
        requireTrustedPreflightOrigin: requireTrustedDesktopAuthPreflightOrigin,
    });

    app.use(applyLocalFrontendCachePolicy);
    app.use(express.static(resolvedDistDir, { index: false }));

    app.use(frontendFallbackLimiter, (_request, response) => {
        response.type('html').send(frontendIndexHtml);
    });

    server.on('upgrade', (request, socket, head) => {
        if (!isAllowedRuntimeHostHeader(request.headers.host)) {
            socket.destroy();
            return;
        }
        socketProxy.upgrade(request, socket, head);
    });

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

    // The first request through a freshly-built express + node:http stack costs
    // roughly 200ms more than steady state (measured: 218ms first vs 5-24ms
    // warm). The window's /login navigation is that first request, so the penalty
    // otherwise lands on the desktop startup critical path. One throwaway GET /
    // moves it here, where desktop/main.cjs overlaps it with the launch-shell
    // load instead of paying for it serially.
    //
    // Never fatal: a failed warmup must not stop the app booting. fetch sets
    // Host from the URL, which is the loopback public host the Host guard
    // requires, so this cannot 421 itself.
    try {
        const warmupController = new AbortController();
        const warmupTimer = setTimeout(() => warmupController.abort(), WARMUP_TIMEOUT_MS);
        try {
            await fetch(`${runtimeUrl}/`, { signal: warmupController.signal });
        } finally {
            clearTimeout(warmupTimer);
        }
    } catch {
        // Best effort only.
    }

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
            // Chromium renderers keep keep-alive sockets open; without an
            // explicit close the pending `server.close()` would stall app quit
            // until the OS gives up on the process.
            server.closeIdleConnections?.();
            server.closeAllConnections?.();
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

// Re-exported so existing importers keep resolving these names from
// runtimeServer.cjs. The names are grouped by the module that now owns them.
const runtimeConfig = require('./runtimeConfig.cjs');
const backendProxy = require('./backendProxy.cjs');
const desktopAuthProtocol = require('./desktopAuthProtocol.cjs');
const desktopAuthBroker = require('./desktopAuthBroker.cjs');

module.exports = {
    ...runtimeConfig,
    ...backendProxy,
    ...desktopAuthProtocol,
    ...desktopAuthBroker,
    applyLocalFrontendCachePolicy,
    createLocalRateLimiter,
    startRuntimeServer,
};