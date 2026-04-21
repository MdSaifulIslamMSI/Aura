const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const DEFAULT_BACKEND_ORIGIN = 'http://3.109.181.238:5000';

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

const buildProxyOptions = (backendOrigin) => ({
    target: backendOrigin,
    changeOrigin: true,
    ws: true,
    xfwd: true,
    secure: false,
    cookieDomainRewrite: '',
    logLevel: 'warn',
    pathRewrite: (_path, request) => request.originalUrl || request.url,
});

const buildRuntimeUrl = (port) => `http://127.0.0.1:${port}`;

const startRuntimeServer = async ({ distDir, port = 0 } = {}) => {
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

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });

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
    resolveBackendOrigin,
    startRuntimeServer,
};
