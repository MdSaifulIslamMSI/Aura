const { applyHttpServerTimeouts } = require('../utils/httpServerTimeouts');

describe('http server socket timeouts', () => {
    test('defaults exceed the 60s CDN/LB origin keep-alive idle', () => {
        const server = {};
        applyHttpServerTimeouts(server);
        expect(server.keepAliveTimeout).toBe(65000);
        expect(server.headersTimeout).toBe(66000);
        expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
    });

    test('env overrides take precedence', () => {
        const server = {};
        applyHttpServerTimeouts(server, { SERVER_KEEP_ALIVE_TIMEOUT_MS: '72000', SERVER_HEADERS_TIMEOUT_MS: '73000' });
        expect(server.keepAliveTimeout).toBe(72000);
        expect(server.headersTimeout).toBe(73000);
    });
});
