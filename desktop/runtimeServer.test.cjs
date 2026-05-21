const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    buildProxyOptions,
    applyLocalFrontendCachePolicy,
    applyDesktopAuthCors,
    createDesktopAuthBroker,
    DEFAULT_BACKEND_ORIGIN,
    DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN,
    DEFAULT_RUNTIME_PORT,
    DESKTOP_AUTH_COMPLETE_PATH,
    isLoopbackBackendOrigin,
    resolveBackendOrigin,
    resolveAllowedDesktopAuthOrigins,
    shouldAllowInsecureBackendProxy,
    startRuntimeServer,
    stripBrowserOnlyProxyHeaders,
} = require('./runtimeServer.cjs');

test('desktop default backend origin matches the hosted backend routing contract', async () => {
    const { HOSTED_BACKEND_ORIGIN } = await import('../app/config/vercelRoutingContract.mjs');

    assert.equal(DEFAULT_BACKEND_ORIGIN, HOSTED_BACKEND_ORIGIN);
    assert.doesNotMatch(DEFAULT_BACKEND_ORIGIN, /3\.109\.181\.238/);
});

test('desktop proxy strips browser-only CORS headers before forwarding to AWS', () => {
    const removedHeaders = [];
    const setHeaders = new Map();
    const proxyReq = {
        removeHeader: (header) => removedHeaders.push(header),
        setHeader: (header, value) => setHeaders.set(header, value),
    };

    stripBrowserOnlyProxyHeaders(proxyReq);

    assert.deepEqual(removedHeaders, ['origin', 'referer']);
    assert.equal(setHeaders.get('X-Aura-Desktop-Proxy'), '1');
});

test('desktop proxy applies header stripping to HTTP and WebSocket proxy requests', () => {
    const options = buildProxyOptions('http://backend.example.test');

    assert.equal(options.target, 'http://backend.example.test');
    assert.equal(options.secure, true);
    assert.equal(options.on.proxyReq, stripBrowserOnlyProxyHeaders);
    assert.equal(options.on.proxyReqWs, stripBrowserOnlyProxyHeaders);
});

test('desktop proxy verifies backend TLS by default and only allows insecure loopback opt-in', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousAllowInsecure = process.env.AURA_DESKTOP_ALLOW_INSECURE_BACKEND_PROXY;

    try {
        delete process.env.AURA_DESKTOP_ALLOW_INSECURE_BACKEND_PROXY;
        process.env.NODE_ENV = 'development';

        assert.equal(buildProxyOptions('https://api.example.test').secure, true);
        assert.equal(shouldAllowInsecureBackendProxy('https://api.example.test'), false);
        assert.equal(isLoopbackBackendOrigin('https://127.0.0.1:5001'), true);

        process.env.AURA_DESKTOP_ALLOW_INSECURE_BACKEND_PROXY = 'true';
        assert.equal(buildProxyOptions('https://127.0.0.1:5001').secure, false);
        assert.equal(buildProxyOptions('https://localhost:5001').secure, false);
        assert.equal(buildProxyOptions('https://api.example.test').secure, true);

        process.env.NODE_ENV = 'production';
        assert.equal(buildProxyOptions('https://127.0.0.1:5001').secure, true);
    } finally {
        if (previousNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = previousNodeEnv;
        }

        if (previousAllowInsecure === undefined) {
            delete process.env.AURA_DESKTOP_ALLOW_INSECURE_BACKEND_PROXY;
        } else {
            process.env.AURA_DESKTOP_ALLOW_INSECURE_BACKEND_PROXY = previousAllowInsecure;
        }
    }
});

test('desktop runtime disables caching for local frontend responses only', () => {
    const frontendHeaders = new Map();
    applyLocalFrontendCachePolicy({
        path: '/assets/index.js',
    }, {
        setHeader: (name, value) => frontendHeaders.set(name, value),
    }, () => {});

    assert.equal(frontendHeaders.get('Cache-Control'), 'no-store, max-age=0');
    assert.equal(frontendHeaders.get('Pragma'), 'no-cache');

    const apiHeaders = new Map();
    applyLocalFrontendCachePolicy({
        path: '/api/products',
    }, {
        setHeader: (name, value) => apiHeaders.set(name, value),
    }, () => {});

    assert.equal(apiHeaders.has('Cache-Control'), false);
});

test('desktop runtime defaults to the hosted HTTPS backend origin', () => {
    const previousDesktopOrigin = process.env.AURA_DESKTOP_BACKEND_ORIGIN;
    const previousBackendOrigin = process.env.AURA_BACKEND_ORIGIN;
    delete process.env.AURA_DESKTOP_BACKEND_ORIGIN;
    delete process.env.AURA_BACKEND_ORIGIN;

    try {
        assert.equal(DEFAULT_BACKEND_ORIGIN, 'https://dbtrhsolhec1s.cloudfront.net');
        assert.equal(resolveBackendOrigin(), DEFAULT_BACKEND_ORIGIN);
    } finally {
        if (previousDesktopOrigin === undefined) {
            delete process.env.AURA_DESKTOP_BACKEND_ORIGIN;
        } else {
            process.env.AURA_DESKTOP_BACKEND_ORIGIN = previousDesktopOrigin;
        }

        if (previousBackendOrigin === undefined) {
            delete process.env.AURA_BACKEND_ORIGIN;
        } else {
            process.env.AURA_BACKEND_ORIGIN = previousBackendOrigin;
        }
    }
});

test('desktop runtime has a stable default port but falls back if it is busy', async () => {
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-desktop-runtime-'));
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>Aura</title>');

    const blocker = http.createServer((_request, response) => response.end('busy'));
    await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const busyPort = blocker.address().port;

    const runtime = await startRuntimeServer({ distDir, port: busyPort });

    try {
        assert.notEqual(runtime.port, busyPort);
        assert.match(runtime.url, /^http:\/\/localhost:\d+$/);
        assert.equal(DEFAULT_RUNTIME_PORT, 47831);
    } finally {
        await runtime.close();
        await new Promise((resolve) => blocker.close(resolve));
        fs.rmSync(distDir, { force: true, recursive: true });
    }
});

test('desktop auth broker completes and consumes a handoff exactly once', () => {
    let completedRequestId = '';
    const broker = createDesktopAuthBroker({
        onComplete: ({ requestId }) => {
            completedRequestId = requestId;
        },
    });

    const request = broker.createRequest({
        runtimeUrl: 'http://localhost:47831',
        returnTo: '/checkout?step=payment',
    });

    assert.match(request.url, /^https:\/\/aurapilot\.vercel\.app\/desktop-login\?/);
    assert.match(request.url, /desktopAuthRequest=/);
    assert.match(request.url, /desktopAuthSecret=/);
    assert.equal(new URL(request.url).origin, DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN);
    assert.equal(
        new URL(request.url).searchParams.get('desktopAuthCallback'),
        `http://localhost:47831${DESKTOP_AUTH_COMPLETE_PATH}`
    );
    assert.match(request.url, /desktopAuthReturnTo=%2Fcheckout%3Fstep%3Dpayment/);

    assert.throws(() => {
        broker.completeRequest({
            requestId: request.requestId,
            secret: 'wrong-secret',
            customToken: 'custom-token',
        });
    }, /could not be verified/);

    broker.completeRequest({
        requestId: request.requestId,
        secret: new URL(request.url).searchParams.get('desktopAuthSecret'),
        customToken: 'custom-token',
    });

    assert.equal(completedRequestId, request.requestId);
    const consumed = broker.consumeResult(request.requestId);
    assert.equal(consumed.requestId, request.requestId);
    assert.equal(consumed.customToken, 'custom-token');
    assert.equal(typeof consumed.completedAt, 'number');
    assert.equal(broker.consumeResult(request.requestId), null);
});

test('desktop auth callback CORS only allows the hosted auth frontend', () => {
    const allowedOrigins = resolveAllowedDesktopAuthOrigins('https://aurapilot.vercel.app/desktop-login');
    const headers = new Map();
    const response = {
        setHeader: (name, value) => headers.set(name, value),
    };

    assert.equal(applyDesktopAuthCors({
        headers: { origin: 'https://aurapilot.vercel.app' },
    }, response, allowedOrigins), true);
    assert.equal(headers.get('Access-Control-Allow-Origin'), 'https://aurapilot.vercel.app');

    assert.equal(applyDesktopAuthCors({
        headers: { origin: 'https://evil.example.test' },
    }, response, allowedOrigins), false);
});
