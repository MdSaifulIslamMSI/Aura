// Socket timeouts must stay above CDN/LB origin keep-alive idle (60s) so the
// edge never reuses a connection the server is already closing — the classic
// cause of intermittent 502/504s for Node behind CloudFront/ALB.
// requestTimeout bounds wedged handlers (route budgets max at 25s for AI);
// it must sit above headersTimeout and below the LB idle timeout.
const applyHttpServerTimeouts = (server, env = process.env) => {
    server.keepAliveTimeout = Number(env.SERVER_KEEP_ALIVE_TIMEOUT_MS) || 65000;
    server.headersTimeout = Number(env.SERVER_HEADERS_TIMEOUT_MS) || 66000;
    server.requestTimeout = Number(env.SERVER_REQUEST_TIMEOUT_MS) || 35000;
    return server;
};

module.exports = { applyHttpServerTimeouts };
