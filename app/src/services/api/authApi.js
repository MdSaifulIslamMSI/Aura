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

const postWithFreshCsrf = async (path, body, options = {}) => {
    const headers = await getAuthHeader(options.firebaseUser);
    const firebaseUser = options.firebaseUser || {};
    const authToken = options.authToken || extractAuthTokenFromHeaders(headers) || (firebaseUser.getIdToken ? await firebaseUser.getIdToken() : '');

    const execute = async (forceFresh = false) => {
        let csrfToken = null;
        try {
            if (authToken) {
                csrfToken = await ensureCsrfToken(authToken, { forceFresh });
            }
        } catch (error) {
            throw new Error(`CSRF token fetch failed for ${path}: ${error.message}. Please refresh and try again.`);
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
        return await execute(false);
    } catch (error) {
        if (!authToken || !isInvalidCsrfError(error)) {
            throw error;
        }

        clearCsrfTokenCache();
        return execute(true);
    }
};

const postWithFirebaseBearer = async (path, body, options = {}) => {
    const headers = await getAuthHeader(options.firebaseUser);
    const { data } = await apiFetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    return data;
};

export const authApi = {
    getSession: async (options = {}) => {
        const headers = await getAuthHeader(options.firebaseUser);
        const authToken = extractAuthTokenFromHeaders(headers);
        const response = await apiFetch('/auth/session', { headers });
        
        // Extract and cache CSRF token from response
        const csrfToken = response.response?.headers?.get('X-CSRF-Token');
        if (csrfToken && typeof cacheToken === 'function') {
            try {
                cacheToken(csrfToken, authToken);
            } catch (e) {
                console.warn('Failed to cache CSRF token:', e.message);
            }
        }
        
        return response.data;
    },
    syncSession: async (email, name, phone, options = {}) => {
        return postWithFreshCsrf('/auth/sync', {
            email,
            name,
            phone,
            ...(options.flowToken ? { flowToken: options.flowToken } : {}),
        }, options);
    },
    completePhoneFactorLogin: async (email, phone, options = {}) => {
        return postWithFirebaseBearer('/auth/complete-phone-factor-login', { email, phone }, options);
    },
    completePhoneFactorVerification: async (purpose, email, phone, options = {}) => {
        return postWithFirebaseBearer('/auth/complete-phone-factor-verification', { purpose, email, phone }, options);
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
    verifyLatticeChallenge: async (token, proof, _deviceId, options = {}) => {
        return authApi.verifyDeviceChallenge(token, proof, '', options);
    },
    verifyQuantumChallenge: async (token, proof, _deviceId, options = {}) => {
        return authApi.verifyDeviceChallenge(token, proof, '', options);
    }
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
