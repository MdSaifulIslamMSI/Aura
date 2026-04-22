import { apiFetch } from '../apiBase';
import { getAuthHeader } from './apiUtils';
import { ensureCsrfToken, addCsrfTokenToHeaders, cacheToken, clearCsrfTokenCache } from '../csrfTokenManager';
import { getTrustedDeviceSessionToken, signTrustedDeviceChallenge } from '../deviceTrustClient';

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

const isMissingCookieSessionError = (error) => {
    const message = `${error?.message || ''} ${error?.data?.message || ''}`.toLowerCase();
    return isUnauthorizedAuthError(error) && (
        message.includes('csrf token fetch failed')
        || message.includes('not authorized, no session')
        || message.includes('no session')
    );
};

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
        if (
            firebaseUser.getIdToken
            && isUnauthorizedAuthError(error)
            && options.disableSessionExchangeOnUnauthorized !== true
        ) {
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
    const bearerOptions = { useFirebaseBearer: true };
    if (options.forceRefreshAuth === true) {
        bearerOptions.forceRefresh = true;
    }

    const headers = await getAuthHeader(options.firebaseUser, bearerOptions);
    const { data } = await apiFetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    return data;
};

const postAuthBootstrap = async (path, body, options = {}) => {
    if (options.preferCookieSession !== true && options.firebaseUser?.getIdToken) {
        return postWithFirebaseBearer(path, body, options);
    }
    return postWithFreshCsrf(path, body, options);
};

const postPublicOtpRequest = async (path, body) => {
    const headers = await getAuthHeader();
    const { data } = await apiFetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    return data;
};

const requestBootstrapDeviceChallenge = async (payload, options = {}) => {
    if (!getTrustedDeviceSessionToken()) {
        return null;
    }

    const headers = await getAuthHeader(options.firebaseUser, {
        useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
    });
    const { data } = await apiFetch('/auth/bootstrap-device-challenge', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    });
    const challenge = data?.deviceChallenge || null;

    if (!challenge?.token || !challenge?.challenge) {
        return null;
    }

    const proofPayload = await signTrustedDeviceChallenge(challenge);
    return {
        token: challenge.token,
        method: proofPayload?.method || 'browser_key',
        proof: proofPayload?.proofBase64 || '',
        publicKeySpkiBase64: proofPayload?.publicKeySpkiBase64 || '',
        credential: proofPayload?.credential || null,
    };
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
        return postAuthBootstrap('/auth/sync', {
            email,
            name,
            phone,
            ...(options.flowToken ? { flowToken: options.flowToken } : {}),
        }, {
            ...options,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
        });
    },
    generateRecoveryCodes: async (options = {}) => {
        return postAuthBootstrap('/auth/recovery-codes', {}, {
            ...options,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
        });
    },
    verifyRecoveryCode: async (email, code) => {
        return postPublicOtpRequest('/auth/recovery-codes/verify', { email, code });
    },
    completePhoneFactorLogin: async (email, phone, options = {}) => {
        return postWithFirebaseBearer('/auth/complete-phone-factor-login', { email, phone }, options);
    },
    completePhoneFactorVerification: async (purpose, email, phone, options = {}) => {
        const trustedDeviceChallenge = String(purpose || '').trim().toLowerCase() === 'forgot-password'
            ? await requestBootstrapDeviceChallenge({
              scope: `phone-factor:${purpose}`,
              email,
              phone,
            }, options)
            : null;

        return postWithFirebaseBearer('/auth/complete-phone-factor-verification', {
            purpose,
            email,
            phone,
            ...(trustedDeviceChallenge ? { trustedDeviceChallenge } : {}),
        }, options);
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

        const body = {
            token,
            method: normalizedPayload.method,
            proof: normalizedPayload.proof,
            publicKeySpkiBase64: normalizedPayload.publicKeySpkiBase64,
            credential: normalizedPayload.credential,
        };

        const verifyWithBearer = () => postAuthBootstrap('/auth/verify-device', body, {
            ...options,
            preferCookieSession: false,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
        });

        if (options.preferCookieSession === false) {
            return verifyWithBearer();
        }

        return postAuthBootstrap('/auth/verify-device', body, {
            ...options,
            // Desktop can have Firebase auth without a backend cookie. Do not
            // rebuild a cookie session around an already-signed challenge.
            disableSessionExchangeOnUnauthorized: true,
            preferCookieSession: true,
        }).catch((error) => {
            if (options.firebaseUser?.getIdToken && isMissingCookieSessionError(error)) {
                return verifyWithBearer();
            }
            throw error;
        });
    },
};


export const otpApi = {
    sendOtp: async (email, phone, purpose, options = {}) => {
        const candidatePaths = ['/auth/otp/send', '/otp/send'];
        const trustedDeviceChallenge = ['login', 'forgot-password'].includes(String(purpose || '').trim().toLowerCase())
            ? await requestBootstrapDeviceChallenge({
              scope: `otp-send:${purpose}`,
              email,
              phone,
            }, options)
            : null;
        let lastError = null;
        for (const path of candidatePaths) {
            try {
                return await postPublicOtpRequest(path, {
                    email,
                    phone,
                    purpose,
                    ...options,
                    ...(trustedDeviceChallenge ? { trustedDeviceChallenge } : {}),
                });
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
                return await postPublicOtpRequest(path, { phone, otp, purpose, ...options });
            } catch (error) {
                lastError = error;
                if (error?.status !== 404) break;
            }
        }
        throw lastError || new Error('Failed to verify OTP');
    },
    resetPassword: async (payloadOrEmail, phone = '', password = '') => {
        const candidatePaths = ['/auth/otp/reset-password', '/otp/reset-password'];
        const payload = payloadOrEmail && typeof payloadOrEmail === 'object' && !Array.isArray(payloadOrEmail)
            ? { ...payloadOrEmail }
            : { email: payloadOrEmail, phone, password };
        const trustedDeviceChallenge = payload?.flowToken
            ? await requestBootstrapDeviceChallenge({
              scope: 'reset-password',
              flowToken: payload.flowToken,
            })
            : null;
        let lastError = null;
        for (const path of candidatePaths) {
            try {
                return await postPublicOtpRequest(path, {
                    ...payload,
                    ...(trustedDeviceChallenge ? { trustedDeviceChallenge } : {}),
                });
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
                return await postPublicOtpRequest(path, { phone, email });
            } catch (error) {
                lastError = error;
                if (error?.status !== 404) break;
            }
        }
        throw lastError || new Error('Failed to check user');
    }
};
