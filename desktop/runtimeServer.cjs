const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const DEFAULT_BACKEND_ORIGIN = 'https://13.206.172.186.sslip.io';
const DEFAULT_RUNTIME_PORT = 47831;
const STABLE_RUNTIME_FALLBACK_PORTS = 10;
const RUNTIME_LISTEN_HOST = '127.0.0.1';
const RUNTIME_PUBLIC_HOST = 'localhost';
const BROWSER_ONLY_PROXY_HEADERS = ['origin', 'referer'];

const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');

const resolveBackendOrigin = () => {
    const configured = String(
        process.env.AURA_DESKTOP_BACKEND_ORIGIN
        || process.env.AURA_BACKEND_ORIGIN
        || DEFAULT_BACKEND_ORIGIN
    ).trim();

    return trimTrailingSlash(configured);
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
    secure: false,
    cookieDomainRewrite: '',
    logLevel: 'warn',
    on: {
        proxyReq: stripBrowserOnlyProxyHeaders,
        proxyReqWs: stripBrowserOnlyProxyHeaders,
    },
    pathRewrite: (_path, request) => request.originalUrl || request.url,
});

const buildRuntimeUrl = (port) => `http://${RUNTIME_PUBLIC_HOST}:${port}`;

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

const startRuntimeServer = async ({ distDir, port = DEFAULT_RUNTIME_PORT } = {}) => {
    const resolvedDistDir = path.resolve(distDir);
    assertDistExists(resolvedDistDir);

    const backendOrigin = resolveBackendOrigin();
    const app = express();
    const server = http.createServer(app);

    const socketProxy = createProxyMiddleware(buildProxyOptions(backendOrigin));
    const apiProxy = createProxyMiddleware(buildProxyOptions(backendOrigin));

    app.disable('x-powered-by');

    app.use('/socket.io', socketProxy);
    app.use('/api', apiProxy);
    app.use('/health', apiProxy);
    app.use('/uploads', apiProxy);
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

    return {
        backendOrigin,
        distDir: resolvedDistDir,
        port: address.port,
        server,
        url: buildRuntimeUrl(address.port),
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
    DEFAULT_RUNTIME_PORT,
    RUNTIME_LISTEN_HOST,
    RUNTIME_PUBLIC_HOST,
    buildProxyOptions,
    buildRuntimeUrl,
    resolveBackendOrigin,
    startRuntimeServer,
    stripBrowserOnlyProxyHeaders,
};
