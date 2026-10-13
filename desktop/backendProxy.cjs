const {
    normalizeDesktopServiceOrigin,
    shouldAllowInsecureBackendProxy,
} = require('./runtimeConfig.cjs');

// Origin and referer are stripped so the hosted backend never sees a loopback
// desktop context, and the desktop is marked explicitly instead.
const BROWSER_ONLY_PROXY_HEADERS = ['origin', 'referer'];

const stripBrowserOnlyProxyHeaders = (proxyReq) => {
    for (const header of BROWSER_ONLY_PROXY_HEADERS) {
        proxyReq.removeHeader?.(header);
    }
    proxyReq.setHeader?.('X-Aura-Desktop-Proxy', '1');
};

const buildProxyOptions = (backendOrigin) => {
    const normalizedBackendOrigin = normalizeDesktopServiceOrigin(backendOrigin, {
        label: 'Desktop backend origin',
        preservePath: true,
    });
    return ({
        target: normalizedBackendOrigin,
        changeOrigin: true,
        ws: true,
        xfwd: true,
        secure: !shouldAllowInsecureBackendProxy(normalizedBackendOrigin),
        cookieDomainRewrite: '',
        logLevel: 'warn',
        on: {
            proxyReq: stripBrowserOnlyProxyHeaders,
            proxyReqWs: stripBrowserOnlyProxyHeaders,
        },
        pathRewrite: (_path, request) => request.originalUrl || request.url,
    });
};

module.exports = {
    BROWSER_ONLY_PROXY_HEADERS,
    buildProxyOptions,
    stripBrowserOnlyProxyHeaders,
};