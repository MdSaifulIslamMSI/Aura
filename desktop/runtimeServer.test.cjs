const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    buildProxyOptions,
    DEFAULT_BACKEND_ORIGIN,
    DEFAULT_RUNTIME_PORT,
    resolveBackendOrigin,
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
    assert.equal(options.on.proxyReq, stripBrowserOnlyProxyHeaders);
    assert.equal(options.on.proxyReqWs, stripBrowserOnlyProxyHeaders);
});

test('desktop runtime defaults to the hosted HTTPS backend origin', () => {
    const previousDesktopOrigin = process.env.AURA_DESKTOP_BACKEND_ORIGIN;
    const previousBackendOrigin = process.env.AURA_BACKEND_ORIGIN;
    delete process.env.AURA_DESKTOP_BACKEND_ORIGIN;
    delete process.env.AURA_BACKEND_ORIGIN;

    try {
        assert.equal(DEFAULT_BACKEND_ORIGIN, 'https://13.206.172.186.sslip.io');
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
