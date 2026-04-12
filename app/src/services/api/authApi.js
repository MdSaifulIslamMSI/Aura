import { apiFetch } from '../apiBase';
import { getAuthHeader } from './apiUtils';
import { ensureCsrfToken, addCsrfTokenToHeaders, cacheToken, clearCsrfTokenCache } from '../csrfTokenManager';

/**
 * Auth API CSRF flow:
 * - Read endpoint (/auth/session) returns X-CSRF-Token header for the current auth identity.
 * - Session-bound write endpoints fetch a fresh single-use token in X-CSRF-Token.
 * - Fresh Firebase bearer proof routes (phone-factor completion) skip CSRF and rely on Authorization only.
 */

const extractAuthTokenFromHeaders = (headers = {}) => {
    const authHeader = headers?.Authorization || headers?.authorization || '';
    return String(authHeader).replace(/^Bearer\s+/i, '').trim();
};

const isInvalidCsrfError = (error) => {
    const code = String(error?.data?.code || '').trim();
    const message = String(error?.message || '').toLowerCase();
    return error?.status === 403 && (
        code === 'CSRF_TOKEN_INVALID'
        || message.includes('csrf token is invalid or expired')
    );
};

const isUnauthorizedAuthError = (error) => Number(error?.status || 0) === 401;

const cacheCsrfTokenFromResponse = (response, owner = 'cookie_session') => {
    const csrfToken = response.response?.headers?.get('X-CSRF-Token');
    if (csrfToken && typeof cacheToken === 'function') {
        try {
            cacheToken(csrfToken, owner);
        } catch (error) {
            console.warn('Failed to cache CSRF token:', error.message);
        }
    }
};

const exchangeSessionWithFirebase = async (firebaseUser, options = {}) => {
    if (!firebaseUser?.getIdToken) {
        throw new Error('A Firebase-authenticated user is required to exchange a server session.');
    }

    const headers = await getAuthHeader(firebaseUser, {
        useFirebaseBearer: true,
        forceRefresh: options.forceRefreshAuth === true,
    });
    const response = await apiFetch('/auth/exchange', {
        method: 'POST',
        headers,
    });

    cacheCsrfTokenFromResponse(response, 'cookie_session');
    return response.data;
};

const postWithFreshCsrf = async (path, body, options = {}) => {
    const firebaseUser = options.firebaseUser || {};
    const shouldUseFirebaseBearer = options.useFirebaseBearer === true;

    const execute = async ({ forceFreshCsrf = false, forceRefreshAuth = false } = {}) => {
        const headers = await getAuthHeader(firebaseUser, {
            useFirebaseBearer: shouldUseFirebaseBearer,
            forceRefresh: forceRefreshAuth,
        });
        const authToken = shouldUseFirebaseBearer
            ? (
                options.authToken
                || extractAuthTokenFromHeaders(headers)
                || (firebaseUser.getIdToken ? await firebaseUser.getIdToken(forceRefreshAuth) : '')
            )
            : '';
        let csrfToken = null;
        try {
            csrfToken = await ensureCsrfToken({
                authToken,
                owner: options.csrfOwner || 'cookie_session',
                forceFresh: forceFreshCsrf,
            });
        } catch (error) {
            const wrappedError = new Error(`CSRF token fetch failed for ${path}: ${error.message}. Please refresh and try again.`);
            wrappedError.status = Number(error?.status || 0);
            wrappedError.data = error?.data || null;
            throw wrappedError;
        }

        const headersWithCsrf = addCsrfTokenToHeaders(headers, 'POST', csrfToken);
        const { data } = await apiFetch(path, {
            method: 'POST',
            headers: headersWithCsrf,
            body: JSON.stringify(body),
        });
        return data;
    };

    try {
        return await execute();
    } catch (error) {
        if (firebaseUser.getIdToken && isUnauthorizedAuthError(error)) {
            clearCsrfTokenCache();
            await exchangeSessionWithFirebase(firebaseUser, {
                forceRefreshAuth: true,
            });
            return execute({
                forceFreshCsrf: true,
                forceRefreshAuth: shouldUseFirebaseBearer,
            });
        }

        if (isUnauthorizedAuthError(error)) {
            throw error;
        }

        if (!isInvalidCsrfError(error)) {
            throw error;
        }

        clearCsrfTokenCache();
        return execute({ forceFreshCsrf: true });
    }
};

const postWithFirebaseBearer = async (path, body, options = {}) => {
    const headers = await getAuthHeader(options.firebaseUser, { useFirebaseBearer: true });
    const { data } = await apiFetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    return data;
};

export const authApi = {
    exchangeSession: async (options = {}) => exchangeSessionWithFirebase(options.firebaseUser, options),
    getSession: async (options = {}) => {
        const execute = async () => {
            const headers = await getAuthHeader(options.firebaseUser);
            const response = await apiFetch('/auth/session', { headers });
            cacheCsrfTokenFromResponse(response, 'cookie_session');
            return response.data;
        };

        try {
            return await execute();
        } catch (error) {
            if (options.firebaseUser?.getIdToken && isUnauthorizedAuthError(error)) {
                clearCsrfTokenCache();
                return exchangeSessionWithFirebase(options.firebaseUser, {
                    forceRefreshAuth: true,
                });
            }
            throw error;
        }
    },
    syncSession: async (email, name, phone, options = {}) => {
        return postWithFreshCsrf('/auth/sync', {
            email,
            name,
            phone,
            ...(options.flowToken ? { flowToken: options.flowToken } : {}),
        }, {
            ...options,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
        });
    },
    completePhoneFactorLogin: async (email, phone, options = {}) => {
        return postWithFirebaseBearer('/auth/complete-phone-factor-login', { email, phone }, options);
    },
    completePhoneFactorVerification: async (purpose, email, phone, options = {}) => {
        return postWithFirebaseBearer('/auth/complete-phone-factor-verification', { purpose, email, phone }, options);
    },
    logoutSession: async (options = {}) => {
        const headers = await getAuthHeader(options.firebaseUser);
        const { data } = await apiFetch('/auth/logout', {
            method: 'POST',
            headers,
        });
        clearCsrfTokenCache();
        return data;
    },
    verifyDeviceChallenge: async (token, proofOrPayload, publicKeySpkiBase64 = '', options = {}) => {
        const normalizedPayload = proofOrPayload && typeof proofOrPayload === 'object' && !Array.isArray(proofOrPayload)
            ? {
                method: proofOrPayload.method || 'browser_key',
                proof: proofOrPayload.proofBase64 || '',
                publicKeySpkiBase64: proofOrPayload.publicKeySpkiBase64 || '',
                credential: proofOrPayload.credential || null,
            }
            : {
                method: 'browser_key',
                proof: String(proofOrPayload || ''),
                publicKeySpkiBase64: String(publicKeySpkiBase64 || ''),
                credential: null,
            };

        return postWithFreshCsrf('/auth/verify-device', {
            token,
            method: normalizedPayload.method,
            proof: normalizedPayload.proof,
            publicKeySpkiBase64: normalizedPayload.publicKeySpkiBase64,
            credential: normalizedPayload.credential,
        }, options);
    },
};


export const otpApi = {
    sendOtp: async (email, phone, purpose, options = {}) => {
        const candidatePaths = ['/auth/otp/send', '/otp/send'];
        let lastError = null;
        for (const path of candidatePaths) {
            try {
                const { data } = await apiFetch(path, {
                    method: 'POST',
                    body: JSON.stringify({ email, phone, purpose, ...options }),
                });
                return data;
            } catch (error) {
                lastError = error;
                if (error?.status !== 404) break;
            }
        }
        throw lastError || new Error('Failed to send OTP');
    },
    verifyOtp: async (phone, otp, purpose, intentIdOrOptions = '', extraOptions = {}) => {
        const candidatePaths = ['/auth/otp/verify', '/otp/verify'];
        const options = typeof intentIdOrOptions === 'string'
            ? { intentId: intentIdOrOptions, ...extraOptions }
            : { ...(intentIdOrOptions || {}) };
        let lastError = null;
        for (const path of candidatePaths) {
            try {
                const { data } = await apiFetch(path, {
                    method: 'POST',
                    body: JSON.stringify({ phone, otp, purpose, ...options }),
                });
                return data;
            } catch (error) {
                lastError = error;
                if (error?.status !== 404) break;
            }
        }
        throw lastError || new Error('Failed to verify OTP');
    },
    resetPassword: async (email, phone, password) => {
        const candidatePaths = ['/auth/otp/reset-password', '/otp/reset-password'];
        let lastError = null;
        for (const path of candidatePaths) {
            try {
                const { data } = await apiFetch(path, {
                    method: 'POST',
                    body: JSON.stringify({ email, phone, password }),
                });
                return data;
            } catch (error) {
                lastError = error;
                if (error?.status !== 404) break;
            }
        }
        throw lastError || new Error('Failed to reset password');
    },
    checkUserExists: async (phone, email = '') => {
        const candidatePaths = ['/auth/otp/check-user', '/otp/check-user'];
        let lastError = null;
        for (const path of candidatePaths) {
            try {
                const { data } = await apiFetch(path, {
                    method: 'POST',
                    body: JSON.stringify({ phone, email }),
                });
                return data;
            } catch (error) {
                lastError = error;
                if (error?.status !== 404) break;
            }
        }
        throw lastError || new Error('Failed to check user');
    }
};
