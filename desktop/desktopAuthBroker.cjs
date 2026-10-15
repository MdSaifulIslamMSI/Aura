const crypto = require('crypto');

const { DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN } = require('./runtimeConfig.cjs');
const {
    DESKTOP_AUTH_FRONTEND_PATH,
    DESKTOP_AUTH_REQUEST_TTL_MS,
    DESKTOP_AUTH_RESULT_TTL_MS,
    DESKTOP_AUTH_TOKEN_MAX_LENGTH,
    buildDesktopAuthUrl,
    createDesktopAuthSecret,
    normalizeDesktopAuthString,
    safeEquals,
} = require('./desktopAuthProtocol.cjs');

// Owns the lifecycle of one browser sign-in handoff: a pending request, the
// one-time secret that proves the callback came from the request we opened, and
// the short-lived result the renderer consumes exactly once.
const createDesktopAuthBroker = ({ onComplete = null, onCancel = null, now = () => Date.now() } = {}) => {
    const pendingRequests = new Map();
    const completedResults = new Map();

    const pruneExpired = () => {
        const currentTime = now();
        for (const [requestId, request] of pendingRequests.entries()) {
            if (request.expiresAt <= currentTime) {
                pendingRequests.delete(requestId);
            }
        }
        for (const [requestId, result] of completedResults.entries()) {
            if (result.expiresAt <= currentTime) {
                completedResults.delete(requestId);
            }
        }
    };

    const createRequest = ({
        runtimeUrl,
        callbackUrl,
        authFrontendOrigin = DEFAULT_DESKTOP_AUTH_FRONTEND_ORIGIN,
        path: requestPath = DESKTOP_AUTH_FRONTEND_PATH,
        returnTo = '',
    } = {}) => {
        pruneExpired();
        if (!runtimeUrl) {
            throw new Error('Desktop auth runtime URL is unavailable.');
        }

        const requestId = crypto.randomUUID();
        const secret = createDesktopAuthSecret();
        const expiresAt = now() + DESKTOP_AUTH_REQUEST_TTL_MS;
        const url = buildDesktopAuthUrl({
            runtimeUrl,
            callbackUrl,
            authFrontendOrigin,
            path: requestPath,
            requestId,
            secret,
            returnTo,
        });
        const request = {
            requestId,
            secret,
            expiresAt,
            url,
        };
        pendingRequests.set(requestId, request);

        return {
            requestId,
            expiresAt,
            url,
        };
    };

    const getRequest = (requestId = '') => {
        pruneExpired();
        const normalizedRequestId = normalizeDesktopAuthString(requestId);
        const request = pendingRequests.get(normalizedRequestId);
        if (!request) {
            return null;
        }

        return {
            requestId: request.requestId,
            expiresAt: request.expiresAt,
            url: request.url,
        };
    };

    // Shared by complete and cancel: both must present the secret we issued, and
    // both must reject unknown or already-settled requests.
    //
    // Deliberately does NOT consume the request. Callers decide when the
    // pending entry is spent, and the ordering is load-bearing: complete must
    // still be able to retry after a rejected token, so it validates the token
    // before consuming.
    const verifyPendingRequest = (requestId, secret) => {
        const normalizedRequestId = normalizeDesktopAuthString(requestId);
        const normalizedSecret = normalizeDesktopAuthString(secret);
        const pendingRequest = pendingRequests.get(normalizedRequestId);

        if (!pendingRequest) {
            const error = new Error('Desktop sign-in request is expired or unknown.');
            error.statusCode = 404;
            throw error;
        }

        if (!safeEquals(pendingRequest.secret, normalizedSecret)) {
            const error = new Error('Desktop sign-in request could not be verified.');
            error.statusCode = 403;
            throw error;
        }

        return normalizedRequestId;
    };

    const completeRequest = ({ requestId = '', secret = '', customToken = '' } = {}) => {
        pruneExpired();
        const normalizedToken = normalizeDesktopAuthString(customToken);

        const normalizedRequestId = verifyPendingRequest(requestId, secret);

        if (!normalizedToken || normalizedToken.length > DESKTOP_AUTH_TOKEN_MAX_LENGTH) {
            const error = new Error('Desktop sign-in token is missing or too large.');
            error.statusCode = 422;
            throw error;
        }

        pendingRequests.delete(normalizedRequestId);
        const completedAt = now();
        completedResults.set(normalizedRequestId, {
            requestId: normalizedRequestId,
            customToken: normalizedToken,
            completedAt,
            expiresAt: completedAt + DESKTOP_AUTH_RESULT_TTL_MS,
        });

        try {
            onComplete?.({
                requestId: normalizedRequestId,
                completedAt,
            });
        } catch (error) {
            console.warn('[desktop] completed auth notification failed:', error?.message || error);
        }

        return {
            requestId: normalizedRequestId,
            completedAt,
        };
    };

    const consumeResult = (requestId = '') => {
        pruneExpired();
        const normalizedRequestId = normalizeDesktopAuthString(requestId);
        const result = completedResults.get(normalizedRequestId);
        if (!result) {
            return null;
        }

        completedResults.delete(normalizedRequestId);
        return {
            requestId: result.requestId,
            ...(result.cancelled
                ? {
                    cancelled: true,
                    cancelledAt: result.cancelledAt,
                }
                : {
                    customToken: result.customToken,
                    completedAt: result.completedAt,
                }),
        };
    };

    const cancelAuthenticatedRequest = ({ requestId = '', secret = '' } = {}) => {
        pruneExpired();

        const normalizedRequestId = verifyPendingRequest(requestId, secret);

        pendingRequests.delete(normalizedRequestId);
        const cancelledAt = now();
        completedResults.set(normalizedRequestId, {
            requestId: normalizedRequestId,
            cancelled: true,
            cancelledAt,
            expiresAt: cancelledAt + DESKTOP_AUTH_RESULT_TTL_MS,
        });
        try {
            onCancel?.({
                requestId: normalizedRequestId,
                cancelledAt,
            });
        } catch (error) {
            console.warn('[desktop] cancelled auth notification failed:', error?.message || error);
        }

        return {
            requestId: normalizedRequestId,
            cancelledAt,
        };
    };

    const cancelRequest = (requestId = '') => {
        const normalizedRequestId = normalizeDesktopAuthString(requestId);
        return pendingRequests.delete(normalizedRequestId) || completedResults.delete(normalizedRequestId);
    };

    return {
        cancelAuthenticatedRequest,
        cancelRequest,
        completeRequest,
        consumeResult,
        createRequest,
        getRequest,
        pruneExpired,
    };
};

module.exports = {
    createDesktopAuthBroker,
};