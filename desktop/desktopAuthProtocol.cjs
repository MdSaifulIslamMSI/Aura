const crypto = require('crypto');

const {
    DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN,
    normalizeDesktopServiceOrigin,
    trimTrailingSlash,
} = require('./runtimeConfig.cjs');

// The wire protocol between the packaged desktop shell and the hosted sign-in
// page. This module is deliberately stateless: it builds and validates the
// handoff. The per-request lifecycle lives in desktopAuthBroker.cjs.

const DESKTOP_AUTH_COMPLETE_PATH = '/desktop-auth/complete';
const DESKTOP_AUTH_CANCEL_PATH = '/desktop-auth/cancel';
const DESKTOP_AUTH_FRONTEND_PATH = '/desktop-login';
const DESKTOP_AUTH_CALLBACK_PARAM = 'desktopAuthCallback';
const DESKTOP_AUTH_TRANSPORT_PARAM = 'desktopAuthTransport';
const DESKTOP_AUTH_FORM_TRANSPORT = 'form_post';
const DESKTOP_AUTH_PROTOCOL_META_NAME = 'aura-desktop-auth-protocol';
const DESKTOP_AUTH_PROTOCOL_VERSION = '2';
const DESKTOP_AUTH_REQUEST_TTL_MS = 10 * 60 * 1000;
const DESKTOP_AUTH_RESULT_TTL_MS = DESKTOP_AUTH_REQUEST_TTL_MS;
const DESKTOP_AUTH_TOKEN_MAX_LENGTH = 8192;

const createDesktopAuthResultHtml = ({ title, heading, message }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>${title}</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f4f4f4;background:#1f1f1f}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;min-height:100svh;display:grid;place-items:center;background:#1f1f1f}
    main{width:min(28rem,calc(100% - 3rem));text-align:center}
    .mark{display:grid;place-items:center;width:3rem;height:3rem;margin:0 auto 1.75rem;border:1px solid #6f6f6f;border-radius:50%;color:#ededed;font-size:1.25rem;font-weight:650;letter-spacing:-.04em}
    h1{margin:0 0 .75rem;font-size:1.5rem;font-weight:500;letter-spacing:-.02em}
    p{margin:.35rem 0;color:#a8a8a8;font-size:.95rem;line-height:1.55}
  </style>
</head>
<body><main><div class="mark" aria-hidden="true">A</div><h1>${heading}</h1><p>${message}</p><p>You can close this tab.</p></main></body>
</html>`;

const DESKTOP_AUTH_COMPLETE_HTML = createDesktopAuthResultHtml({
    title: 'Aura Desktop Sign-In Complete',
    heading: 'Sign-in complete',
    message: 'Aura Desktop received the secure result. Return to the desktop app.',
});

const DESKTOP_AUTH_CANCEL_HTML = createDesktopAuthResultHtml({
    title: 'Aura Desktop Sign-In Cancelled',
    heading: 'Sign-in cancelled',
    message: 'Aura Desktop cancelled this browser sign-in.',
});

const DESKTOP_AUTH_FAILURE_HTML = createDesktopAuthResultHtml({
    title: 'Aura Desktop Sign-In Could Not Be Completed',
    heading: 'Sign-in could not be completed',
    message: 'Aura Desktop could not verify this browser response. Return to the desktop app and start a fresh sign-in.',
});

const normalizeDesktopAuthString = (value = '') => String(value || '').trim();

const isSafeRelativePath = (value = '') => {
    const normalized = normalizeDesktopAuthString(value);
    if (
        !normalized.startsWith('/')
        || normalized.startsWith('//')
        || normalized.includes('\\')
        || /[\u0000-\u001f\u007f]/.test(normalized)
    ) {
        return false;
    }

    // Reject encoded and double-encoded network-path/backslash variants. A
    // return target may be decoded by more than one browser/router layer, so
    // validating only the raw string can turn an apparently relative path into
    // an authority-like path later in the handoff.
    let decoded = normalized;
    try {
        for (let pass = 0; pass < 2; pass += 1) {
            const next = decodeURIComponent(decoded);
            if (
                next.startsWith('//')
                || next.startsWith('/\\')
                || next.includes('\\')
                || /[\u0000-\u001f\u007f]/.test(next)
            ) {
                return false;
            }
            if (next === decoded) break;
            decoded = next;
        }
    } catch {
        return false;
    }

    return true;
};

const safeEquals = (left = '', right = '') => {
    const leftDigest = crypto.createHash('sha256').update(normalizeDesktopAuthString(left)).digest();
    const rightDigest = crypto.createHash('sha256').update(normalizeDesktopAuthString(right)).digest();
    return crypto.timingSafeEqual(leftDigest, rightDigest);
};

const createDesktopAuthSecret = () => crypto.randomBytes(32).toString('base64url');

const buildDesktopAuthUrl = ({
    runtimeUrl,
    callbackUrl,
    authFrontendOrigin = DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN,
    path: requestPath = DESKTOP_AUTH_FRONTEND_PATH,
    requestId,
    secret,
    returnTo = '',
} = {}) => {
    const normalizedAuthFrontendOrigin = normalizeDesktopServiceOrigin(authFrontendOrigin, {
        label: 'Desktop auth frontend origin',
        preservePath: true,
    });
    const url = new URL(
        isSafeRelativePath(requestPath) ? requestPath : DESKTOP_AUTH_FRONTEND_PATH,
        normalizedAuthFrontendOrigin
    );
    const trustedCallbackUrl = callbackUrl || runtimeUrl;
    url.searchParams.set('desktopAuthRequest', requestId);
    const handoffParams = new URLSearchParams();
    handoffParams.set('desktopAuthSecret', secret);
    handoffParams.set(DESKTOP_AUTH_CALLBACK_PARAM, `${trimTrailingSlash(trustedCallbackUrl)}${DESKTOP_AUTH_COMPLETE_PATH}`);
    handoffParams.set(DESKTOP_AUTH_TRANSPORT_PARAM, DESKTOP_AUTH_FORM_TRANSPORT);
    if (isSafeRelativePath(returnTo)) {
        handoffParams.set('desktopAuthReturnTo', returnTo);
    }
    url.hash = handoffParams.toString();
    return url.toString();
};

const readDesktopAuthProtocolVersion = (html = '') => {
    const metaPattern = new RegExp(
        `<meta\\s+name=["']${DESKTOP_AUTH_PROTOCOL_META_NAME}["']\\s+content=["']([^"']+)["']\\s*\\/?\\s*>`,
        'i'
    );
    return String(metaPattern.exec(String(html || ''))?.[1] || '').trim();
};

const validateDesktopAuthFrontend = async ({
    authFrontendOrigin = DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN,
    fetchImpl = globalThis.fetch,
    timeoutMs = 8000,
} = {}) => {
    if (typeof fetchImpl !== 'function') {
        throw new Error('Desktop browser sign-in compatibility check is unavailable.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const normalizedAuthFrontendOrigin = normalizeDesktopServiceOrigin(authFrontendOrigin, {
            label: 'Desktop auth frontend origin',
            preservePath: true,
        });
        const expectedOrigin = new URL(normalizedAuthFrontendOrigin).origin;
        const response = await fetchImpl(new URL(DESKTOP_AUTH_FRONTEND_PATH, normalizedAuthFrontendOrigin), {
            headers: { Accept: 'text/html' },
            redirect: 'follow',
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`Hosted desktop sign-in returned HTTP ${response.status}.`);
        }
        if (response.url && new URL(response.url).origin !== expectedOrigin) {
            const error = new Error('Hosted desktop sign-in redirected to an untrusted origin.');
            error.code = 'auth/desktop-browser-origin-mismatch';
            throw error;
        }

        const protocolVersion = readDesktopAuthProtocolVersion(await response.text());
        if (protocolVersion !== DESKTOP_AUTH_PROTOCOL_VERSION) {
            const error = new Error(
                'Hosted desktop sign-in is out of date. Update the Aura web login before starting browser sign-in.'
            );
            error.code = 'auth/desktop-browser-protocol-mismatch';
            throw error;
        }

        return { protocolVersion };
    } catch (error) {
        if (
            error?.code === 'auth/desktop-browser-protocol-mismatch'
            || error?.code === 'auth/desktop-browser-origin-mismatch'
        ) {
            throw error;
        }
        const compatibilityError = new Error(
            'Aura could not verify the hosted browser sign-in service. Check your connection and try again.'
        );
        compatibilityError.code = 'auth/desktop-browser-compatibility-check-failed';
        compatibilityError.cause = error;
        throw compatibilityError;
    } finally {
        clearTimeout(timeout);
    }
};

const applyDesktopAuthCors = (request, response, allowedOrigins) => {
    const origin = String(request.headers.origin || '').trim();
    if (!origin || !allowedOrigins.has(origin)) {
        return false;
    }

    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Max-Age', '300');
    if (request.headers['access-control-request-private-network']) {
        response.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    return true;
};

const readNavigationContentType = (headers = {}) => String(headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();

const isOpaqueDesktopAuthNavigation = (request = {}) => {
    const headers = request.headers || {};
    const contentType = readNavigationContentType(headers);

    return String(headers.origin || '').trim().toLowerCase() === 'null'
        && contentType === 'application/x-www-form-urlencoded'
        && String(headers['sec-fetch-site'] || '').trim().toLowerCase() === 'cross-site'
        && String(headers['sec-fetch-mode'] || '').trim().toLowerCase() === 'navigate'
        && String(headers['sec-fetch-dest'] || '').trim().toLowerCase() === 'document';
};

const isTopLevelDesktopAuthFormNavigation = (request = {}) => {
    const headers = request.headers || {};
    return readNavigationContentType(headers) === 'application/x-www-form-urlencoded'
        && String(headers['sec-fetch-mode'] || '').trim().toLowerCase() === 'navigate'
        && String(headers['sec-fetch-dest'] || '').trim().toLowerCase() === 'document';
};

const applyDesktopAuthResponseSecurityHeaders = (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    );
    next();
};

const sendDesktopAuthFailure = (request, response, {
    statusCode = 400,
    message = 'Desktop sign-in could not be completed.',
} = {}) => {
    if (isTopLevelDesktopAuthFormNavigation(request)) {
        response.status(statusCode).type('html').send(DESKTOP_AUTH_FAILURE_HTML);
        return;
    }
    response.status(statusCode).json({
        success: false,
        message,
    });
};

module.exports = {
    DESKTOP_AUTH_CANCEL_PATH,
    DESKTOP_AUTH_COMPLETE_PATH,
    DESKTOP_AUTH_FRONTEND_PATH,
    DESKTOP_AUTH_PROTOCOL_META_NAME,
    DESKTOP_AUTH_PROTOCOL_VERSION,
    DESKTOP_AUTH_REQUEST_TTL_MS,
    DESKTOP_AUTH_RESULT_TTL_MS,
    DESKTOP_AUTH_COMPLETE_HTML,
    DESKTOP_AUTH_CANCEL_HTML,
    applyDesktopAuthCors,
    applyDesktopAuthResponseSecurityHeaders,
    buildDesktopAuthUrl,
    createDesktopAuthSecret,
    isOpaqueDesktopAuthNavigation,
    isSafeRelativePath,
    isTopLevelDesktopAuthFormNavigation,
    normalizeDesktopAuthString,
    readDesktopAuthProtocolVersion,
    safeEquals,
    sendDesktopAuthFailure,
    validateDesktopAuthFrontend,
};