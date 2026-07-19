const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const postOpaqueFormNavigation = (targetUrl, body, headerOverrides = {}) => new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const encodedBody = body.toString();
    const request = http.request(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(encodedBody),
            Origin: 'null',
            'Sec-Fetch-Site': 'cross-site',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Dest': 'document',
            ...headerOverrides,
        },
    }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            headers: response.headers,
            status: response.statusCode,
        }));
    });
    request.on('error', reject);
    request.end(encodedBody);
});

const {
    buildProxyOptions,
    applyLocalFrontendCachePolicy,
    applyDesktopAuthCors,
    createLocalRateLimiter,
    createDesktopAuthBroker,
    DEFAULT_BACKEND_ORIGIN,
    DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN,
    DEFAULT_RUNTIME_PORT,
    DESKTOP_AUTH_PROTOCOL_VERSION,
    DESKTOP_AUTH_REQUEST_TTL_MS,
    DESKTOP_AUTH_CANCEL_PATH,
    DESKTOP_AUTH_COMPLETE_PATH,
    RUNTIME_CALLBACK_HOST,
    buildRuntimeCallbackUrl,
    buildRuntimePortCandidates,
    isLoopbackBackendOrigin,
    isOpaqueDesktopAuthNavigation,
    resolveBackendOrigin,
    resolveAllowedDesktopAuthOrigins,
    readDesktopAuthProtocolVersion,
    shouldAllowInsecureBackendProxy,
    startRuntimeServer,
    stripBrowserOnlyProxyHeaders,
    validateDesktopAuthFrontend,
} = require('./runtimeServer.cjs');

test('desktop runtime uses only the requested stable callback origin', () => {
    assert.deepEqual(
        buildRuntimePortCandidates(DEFAULT_RUNTIME_PORT),
        [DEFAULT_RUNTIME_PORT]
    );
    assert.deepEqual(
        buildRuntimePortCandidates(DEFAULT_RUNTIME_PORT + 10),
        [DEFAULT_RUNTIME_PORT + 10]
    );
    assert.equal(buildRuntimePortCandidates(DEFAULT_RUNTIME_PORT).includes(0), false);
    assert.throws(() => buildRuntimePortCandidates(0), /requires a fixed loopback port/);
    assert.throws(
        () => buildRuntimePortCandidates(DEFAULT_RUNTIME_PORT + 11),
        /requires a fixed loopback port/
    );
});

test('desktop browser handoff allows enough time for password and two OTP stages', () => {
    const now = 1_000_000;
    const broker = createDesktopAuthBroker({ now: () => now });
    const request = broker.createRequest({
        callbackUrl: 'http://127.0.0.1:47831',
        runtimeUrl: 'http://localhost:47831',
    });

    assert.equal(DESKTOP_AUTH_REQUEST_TTL_MS, 10 * 60 * 1000);
    assert.equal(request.expiresAt - now, DESKTOP_AUTH_REQUEST_TTL_MS);
});

test('desktop only recognizes Chromium opaque origins for top-level form navigation', () => {
    const validHeaders = {
        origin: 'null',
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
    };

    assert.equal(isOpaqueDesktopAuthNavigation({ headers: validHeaders }), true);
    for (const [header, value] of [
        ['origin', 'https://evil.example.test'],
        ['content-type', 'application/json'],
        ['sec-fetch-site', 'same-origin'],
        ['sec-fetch-mode', 'cors'],
        ['sec-fetch-dest', 'iframe'],
    ]) {
        assert.equal(isOpaqueDesktopAuthNavigation({
            headers: { ...validHeaders, [header]: value },
        }), false, `${header} must stay constrained`);
    }
});

test('desktop validates the hosted browser protocol before opening a request', async () => {
    const sourceHtml = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
    assert.equal(readDesktopAuthProtocolVersion(sourceHtml), DESKTOP_AUTH_PROTOCOL_VERSION);

    const compatible = await validateDesktopAuthFrontend({
        fetchImpl: async () => ({
            ok: true,
            text: async () => sourceHtml,
        }),
    });
    assert.equal(compatible.protocolVersion, DESKTOP_AUTH_PROTOCOL_VERSION);

    await assert.rejects(
        validateDesktopAuthFrontend({
            fetchImpl: async () => ({
                ok: true,
                text: async () => '<!doctype html><title>Old Aura Login</title>',
            }),
        }),
        /Hosted desktop sign-in is out of date/
    );
});

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

test('desktop runtime fails closed instead of splitting auth state across fallback ports', async () => {
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-desktop-runtime-'));
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>Aura</title>');

    const blocker = http.createServer((_request, response) => response.end('busy'));
    await new Promise((resolve) => blocker.listen(DEFAULT_RUNTIME_PORT, '127.0.0.1', resolve));
    const busyPort = DEFAULT_RUNTIME_PORT;

    try {
        await assert.rejects(
            startRuntimeServer({ distDir, port: busyPort }),
            (error) => error?.code === 'EADDRINUSE'
                && /port 47831 is already in use/.test(error.message)
        );

        const nextPortProbe = http.createServer((_request, response) => response.end('available'));
        await new Promise((resolve) => nextPortProbe.listen(DEFAULT_RUNTIME_PORT + 1, '127.0.0.1', resolve));
        await new Promise((resolve) => nextPortProbe.close(resolve));
    } finally {
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
        callbackUrl: 'http://127.0.0.1:47831',
        runtimeUrl: 'http://localhost:47831',
        returnTo: '/checkout?step=payment',
    });

    assert.match(request.url, /^https:\/\/aurapilot\.vercel\.app\/desktop-login\?/);
    const desktopAuthUrl = new URL(request.url);
    const handoffParams = new URLSearchParams(desktopAuthUrl.hash.slice(1));
    assert.equal(desktopAuthUrl.searchParams.has('desktopAuthRequest'), true);
    assert.equal(desktopAuthUrl.searchParams.has('desktopAuthSecret'), false);
    assert.equal(desktopAuthUrl.searchParams.has('desktopAuthCallback'), false);
    assert.equal(desktopAuthUrl.origin, DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN);
    assert.equal(
        handoffParams.get('desktopAuthCallback'),
        `http://127.0.0.1:47831${DESKTOP_AUTH_COMPLETE_PATH}`
    );
    assert.equal(handoffParams.get('desktopAuthTransport'), 'form_post');
    assert.equal(handoffParams.get('desktopAuthReturnTo'), '/checkout?step=payment');
    assert.deepEqual(broker.getRequest(request.requestId), {
        requestId: request.requestId,
        expiresAt: request.expiresAt,
        url: request.url,
    });

    assert.throws(() => {
        broker.completeRequest({
            requestId: request.requestId,
            secret: 'wrong-secret',
            customToken: 'custom-token',
        });
    }, /could not be verified/);

    broker.completeRequest({
        requestId: request.requestId,
        secret: handoffParams.get('desktopAuthSecret'),
        customToken: 'custom-token',
    });

    assert.equal(completedRequestId, request.requestId);
    assert.equal(broker.getRequest(request.requestId), null);
    const consumed = broker.consumeResult(request.requestId);
    assert.equal(consumed.requestId, request.requestId);
    assert.equal(consumed.customToken, 'custom-token');
    assert.equal(typeof consumed.completedAt, 'number');
    assert.equal(broker.consumeResult(request.requestId), null);
});

test('desktop auth broker rejects encoded authority-like return targets', () => {
    const broker = createDesktopAuthBroker();
    const unsafeTargets = [
        '//evil.example/steal',
        '/\\evil.example/steal',
        '/%2f%2fevil.example/steal',
        '/%5cevil.example/steal',
        '/%252f%252fevil.example/steal',
    ];

    for (const returnTo of unsafeTargets) {
        const request = broker.createRequest({
            callbackUrl: 'http://127.0.0.1:47831',
            runtimeUrl: 'http://localhost:47831',
            returnTo,
        });
        const handoffParams = new URLSearchParams(new URL(request.url).hash.slice(1));
        assert.equal(handoffParams.has('desktopAuthReturnTo'), false, returnTo);
    }
});

test('desktop auth broker requires its timing-safe secret and cancels a browser handoff once', () => {
    const cancellations = [];
    const broker = createDesktopAuthBroker({
        onCancel: (event) => cancellations.push(event),
    });
    const request = broker.createRequest({
        callbackUrl: 'http://127.0.0.1:47831',
        runtimeUrl: 'http://localhost:47831',
    });
    const handoff = new URLSearchParams(new URL(request.url).hash.slice(1));
    const secret = handoff.get('desktopAuthSecret');

    assert.throws(() => broker.cancelAuthenticatedRequest({
        requestId: request.requestId,
        secret: 'wrong-secret',
    }), (error) => error.statusCode === 403 && /could not be verified/.test(error.message));
    assert.notEqual(broker.getRequest(request.requestId), null);

    const result = broker.cancelAuthenticatedRequest({
        requestId: request.requestId,
        secret,
    });
    assert.equal(result.requestId, request.requestId);
    assert.equal(typeof result.cancelledAt, 'number');
    assert.deepEqual(cancellations, [{
        requestId: request.requestId,
        cancelledAt: result.cancelledAt,
    }]);
    assert.equal(broker.getRequest(request.requestId), null);
    assert.throws(() => broker.cancelAuthenticatedRequest({
        requestId: request.requestId,
        secret,
    }), (error) => error.statusCode === 404 && /expired or unknown/.test(error.message));
    assert.equal(cancellations.length, 1);
    assert.deepEqual(broker.consumeResult(request.requestId), {
        requestId: request.requestId,
        cancelled: true,
        cancelledAt: result.cancelledAt,
    });
    assert.equal(broker.consumeResult(request.requestId), null);

    const legacyRequest = broker.createRequest({
        callbackUrl: 'http://127.0.0.1:47831',
        runtimeUrl: 'http://localhost:47831',
    });
    assert.equal(broker.cancelRequest(legacyRequest.requestId), true);
});

test('desktop auth callback completes the HTTP handoff and consumes its token once', async () => {
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-desktop-auth-callback-'));
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>Aura</title>');

    const runtime = await startRuntimeServer({
        distDir,
        port: DEFAULT_RUNTIME_PORT + 2,
    });
    try {
        const request = runtime.createDesktopAuthRequest();
        const handoff = new URLSearchParams(new URL(request.url).hash.slice(1));
        const callbackUrl = handoff.get('desktopAuthCallback');
        const origin = 'https://aurapilot.vercel.app';

        const preflight = await fetch(callbackUrl, {
            method: 'OPTIONS',
            headers: {
                Origin: origin,
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Private-Network': 'true',
            },
        });
        assert.equal(preflight.status, 204);
        assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
        assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');

        const response = await fetch(callbackUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: origin,
            },
            body: JSON.stringify({
                requestId: request.requestId,
                secret: handoff.get('desktopAuthSecret'),
                customToken: 'integration-custom-token',
            }),
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('access-control-allow-origin'), origin);
        assert.equal((await response.json()).success, true);

        assert.equal(runtime.consumeDesktopAuthResult(request.requestId).customToken, 'integration-custom-token');
        assert.equal(runtime.consumeDesktopAuthResult(request.requestId), null);

        const formRequest = runtime.createDesktopAuthRequest();
        const formHandoff = new URLSearchParams(new URL(formRequest.url).hash.slice(1));
        const rejectedOpaqueJson = await fetch(formHandoff.get('desktopAuthCallback'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'null',
                'Sec-Fetch-Site': 'cross-site',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Dest': 'document',
            },
            body: JSON.stringify({
                requestId: formRequest.requestId,
                secret: formHandoff.get('desktopAuthSecret'),
                customToken: 'must-not-be-consumed',
            }),
        });
        assert.equal(rejectedOpaqueJson.status, 403);
        assert.notEqual(runtime.getDesktopAuthRequest(formRequest.requestId), null);

        const rejectedNestedNavigation = await postOpaqueFormNavigation(
            formHandoff.get('desktopAuthCallback'),
            new URLSearchParams({
                requestId: formRequest.requestId,
                secret: formHandoff.get('desktopAuthSecret'),
                customToken: 'must-not-be-consumed',
            }),
            { 'Sec-Fetch-Dest': 'iframe' }
        );
        assert.equal(rejectedNestedNavigation.status, 403);
        assert.notEqual(runtime.getDesktopAuthRequest(formRequest.requestId), null);

        const formResponse = await postOpaqueFormNavigation(
            formHandoff.get('desktopAuthCallback'),
            new URLSearchParams({
                requestId: formRequest.requestId,
                secret: formHandoff.get('desktopAuthSecret'),
                customToken: 'form-navigation-custom-token',
            })
        );
        assert.equal(formResponse.status, 200);
        assert.equal(formResponse.headers['access-control-allow-origin'], undefined);
        assert.match(formResponse.headers['content-type'], /^text\/html/);
        const completionHtml = formResponse.body;
        assert.match(completionHtml, /Aura Desktop received the secure result/);
        assert.match(completionHtml, /background:#1f1f1f/);
        assert.doesNotMatch(completionHtml, /#67e8f9/);
        assert.equal(runtime.consumeDesktopAuthResult(formRequest.requestId).customToken, 'form-navigation-custom-token');
        assert.equal(runtime.getDesktopAuthRequest(formRequest.requestId), null);
    } finally {
        await runtime.close();
        fs.rmSync(distDir, { force: true, recursive: true });
    }
});

test('desktop auth cancellation endpoint enforces CORS and secret authentication once', async () => {
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-desktop-auth-cancel-'));
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>Aura</title>');
    const cancellations = [];

    const runtime = await startRuntimeServer({
        distDir,
        port: DEFAULT_RUNTIME_PORT + 3,
        onDesktopAuthCancel: (event) => cancellations.push(event),
    });
    try {
        const request = runtime.createDesktopAuthRequest();
        const handoff = new URLSearchParams(new URL(request.url).hash.slice(1));
        const cancelUrl = new URL(handoff.get('desktopAuthCallback'));
        cancelUrl.pathname = DESKTOP_AUTH_CANCEL_PATH;
        const origin = 'https://aurapilot.vercel.app';

        const preflight = await fetch(cancelUrl, {
            method: 'OPTIONS',
            headers: {
                Origin: origin,
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Private-Network': 'true',
            },
        });
        assert.equal(preflight.status, 204);
        assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
        assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');

        const hostilePreflight = await fetch(cancelUrl, {
            method: 'OPTIONS',
            headers: {
                Origin: 'https://evil.example.test',
                'Access-Control-Request-Method': 'POST',
            },
        });
        assert.equal(hostilePreflight.status, 403);
        assert.equal(hostilePreflight.headers.get('access-control-allow-origin'), null);

        const hostileResponse = await fetch(cancelUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://evil.example.test',
            },
            body: JSON.stringify({
                requestId: request.requestId,
                secret: handoff.get('desktopAuthSecret'),
            }),
        });
        assert.equal(hostileResponse.status, 403);
        assert.notEqual(runtime.getDesktopAuthRequest(request.requestId), null);

        const wrongSecretResponse = await fetch(cancelUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: origin,
            },
            body: JSON.stringify({
                requestId: request.requestId,
                secret: 'wrong-secret',
            }),
        });
        assert.equal(wrongSecretResponse.status, 403);
        assert.match((await wrongSecretResponse.json()).message, /could not be verified/);
        assert.notEqual(runtime.getDesktopAuthRequest(request.requestId), null);

        const cancelResponse = await postOpaqueFormNavigation(
            cancelUrl,
            new URLSearchParams({
                requestId: request.requestId,
                secret: handoff.get('desktopAuthSecret'),
            })
        );
        assert.equal(cancelResponse.status, 200);
        assert.equal(cancelResponse.headers['access-control-allow-origin'], undefined);
        assert.match(cancelResponse.headers['content-type'], /^text\/html/);
        const cancellationHtml = cancelResponse.body;
        assert.match(cancellationHtml, /Sign-in cancelled/);
        assert.match(cancellationHtml, /Aura Desktop cancelled this browser sign-in/);
        assert.match(cancellationHtml, /background:#1f1f1f/);
        assert.equal(runtime.getDesktopAuthRequest(request.requestId), null);
        assert.equal(cancellations.length, 1);
        assert.equal(cancellations[0].requestId, request.requestId);

        const repeatedResponse = await fetch(cancelUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: origin,
            },
            body: JSON.stringify({
                requestId: request.requestId,
                secret: handoff.get('desktopAuthSecret'),
            }),
        });
        assert.equal(repeatedResponse.status, 404);
        assert.equal(cancellations.length, 1);
    } finally {
        await runtime.close();
        fs.rmSync(distDir, { force: true, recursive: true });
    }
});

test('desktop auth callback CORS only allows the hosted auth frontend', () => {
    const allowedOrigins = resolveAllowedDesktopAuthOrigins('https://aurapilot.vercel.app/desktop-login');
    const headers = new Map();
    const response = {
        setHeader: (name, value) => headers.set(name, value),
    };

    assert.equal(applyDesktopAuthCors({
        headers: {
            origin: 'https://aurapilot.vercel.app',
            'access-control-request-private-network': 'true',
        },
    }, response, allowedOrigins), true);
    assert.equal(headers.get('Access-Control-Allow-Origin'), 'https://aurapilot.vercel.app');
    assert.equal(headers.get('Access-Control-Allow-Private-Network'), 'true');

    assert.equal(applyDesktopAuthCors({
        headers: { origin: 'https://evil.example.test' },
    }, response, allowedOrigins), false);
});

test('local fallback limiter rejects excess local attempts', () => {
    const limiter = createLocalRateLimiter({ windowMs: 60 * 1000, max: 1 });
    const request = { ip: '127.0.0.1' };
    const response = {
        statusCode: 0,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
    const next = () => {};

    limiter(request, response, next);
    limiter(request, response, next);

    assert.equal(response.statusCode, 429);
    assert.match(response.body.message, /Too many desktop sign-in callback requests/);
});

test('desktop auth callback routes share the recognized route rate limiter', async () => {
    const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-desktop-auth-rate-limit-'));
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>Aura</title>');

    const runtime = await startRuntimeServer({
        distDir,
        port: DEFAULT_RUNTIME_PORT + 4,
    });
    try {
        const responses = await Promise.all(Array.from({ length: 61 }, (_, index) => fetch(
            runtime.callbackUrl + (index % 2 === 0 ? DESKTOP_AUTH_COMPLETE_PATH : DESKTOP_AUTH_CANCEL_PATH), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        })));
        assert.equal(responses.filter((response) => response.status === 429).length, 1);
        assert.match(await responses.find((response) => response.status === 429).text(), /Too many desktop sign-in callback requests/);
    } finally {
        await runtime.close();
        fs.rmSync(distDir, { force: true, recursive: true });
    }
});
