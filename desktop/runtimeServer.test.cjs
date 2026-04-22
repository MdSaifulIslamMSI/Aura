const assert = require('node:assert/strict');
const test = require('node:test');

const {
    buildProxyOptions,
    stripBrowserOnlyProxyHeaders,
} = require('./runtimeServer.cjs');

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
