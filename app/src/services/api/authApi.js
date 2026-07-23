import { apiFetch, buildServiceUrl } from '../apiBase';
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
        || code === 'CSRF_TOKEN_EXPIRED'
        || message.includes('csrf token is invalid or expired')
        || message.includes('csrf token expired')
        || message.includes('csrf token has expired')
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

const isDeviceChallengeBindingMismatchError = (error) => {
    const message = `${error?.message || ''} ${error?.data?.message || ''}`.toLowerCase();
    return Number(error?.status || 0) === 403
        && message.includes('device challenge session binding mismatch');
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
    const requestMethod = String(options.method || 'POST').trim().toUpperCase() || 'POST';

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

        const headersWithCsrf = addCsrfTokenToHeaders(headers, requestMethod, csrfToken);
        const { data } = await apiFetch(path, {
            method: requestMethod,
            headers: headersWithCsrf,
            body: JSON.stringify(body),
        });
        return data;
    };

    try {
        return await execute({
            forceFreshCsrf: options.forceFreshCsrf === true,
        });
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
        method: String(options.method || 'POST').trim().toUpperCase() || 'POST',
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

const getProtectedAuthJson = async (path, options = {}) => {
    const useFirebaseBearer = options.useFirebaseBearer === true
        && Boolean(options.firebaseUser?.getIdToken);
    const headers = await getAuthHeader(options.firebaseUser, {
        useFirebaseBearer,
        forceRefresh: options.forceRefreshAuth === true,
    });
    const response = await apiFetch(path, { headers });
    if (!useFirebaseBearer) {
        cacheCsrfTokenFromResponse(response, options.csrfOwner || 'cookie_session');
    }
    return response.data;
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

const getTurnstileRequestFields = (options = {}) => {
    const token = String(options.turnstileToken || options.cfTurnstileResponse || '').trim();
    return token ? { turnstileToken: token } : {};
};

export const getDuoLoginUrl = (returnTo = '/') => {
    const params = new URLSearchParams();
    const normalizedReturnTo = String(returnTo || '/').trim();
    params.set('returnTo', normalizedReturnTo.startsWith('/') && !normalizedReturnTo.startsWith('//')
        ? normalizedReturnTo
        : '/');
    return buildServiceUrl(`/api/auth/duo/start?${params.toString()}`);
};

export const getDuoStepUpUrl = (returnTo = '/', options = {}) => {
    const params = new URLSearchParams();
    const normalizedReturnTo = String(returnTo || '/').trim();
    params.set('returnTo', normalizedReturnTo.startsWith('/') && !normalizedReturnTo.startsWith('//')
        ? normalizedReturnTo
        : '/');
    const action = String(options.action || 'admin-sensitive').trim().toLowerCase();
    if (/^[a-z0-9_-]+$/.test(action)) {
        params.set('action', action);
    }
    return buildServiceUrl(`/api/auth/duo/step-up?${params.toString()}`);
};

export const getEnterpriseLoginUrl = (returnTo = '/', options = {}) => {
    const params = new URLSearchParams();
    const normalizedReturnTo = String(returnTo || '/').trim();
    params.set('returnTo', normalizedReturnTo.startsWith('/') && !normalizedReturnTo.startsWith('//')
        ? normalizedReturnTo
        : '/');
    const loginHint = String(options.loginHint || '').trim();
    if (loginHint && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginHint)) {
        params.set('loginHint', loginHint.toLowerCase());
    }
    return buildServiceUrl(`/api/auth/enterprise/start?${params.toString()}`);
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
        body: JSON.stringify({
            ...payload,
            ...getTurnstileRequestFields(options),
        }),
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

const buildTrustedDeviceProofBody = (challenge = {}, proofPayload = {}, extra = {}) => ({
    ...extra,
    token: challenge.token,
    challengeToken: challenge.token,
    method: proofPayload?.method || 'webauthn',
    proof: proofPayload?.proofBase64 || '',
    publicKeySpkiBase64: proofPayload?.publicKeySpkiBase64 || '',
    credential: proofPayload?.credential || null,
});

const signMfaPasskeyChallenge = async (challenge = {}, options = {}) => (
    signTrustedDeviceChallenge(challenge, {
        preferredMethod: options.preferredMethod || 'webauthn',
    })
);

export const authApi = {
    getDuoLoginUrl,
    getDuoStepUpUrl,
    getEnterpriseLoginUrl,
    startDuoLogin: (options = {}) => {
        const returnTo = options.returnTo || (
            typeof window !== 'undefined'
                ? `${window.location?.pathname || '/'}${window.location?.search || ''}${window.location?.hash || ''}`
                : '/'
        );
        const url = getDuoLoginUrl(returnTo);
        if (typeof window === 'undefined' || !window.location?.assign) {
            return { redirecting: true, url };
        }
        window.location.assign(url);
        return { redirecting: true, url };
    },
    startDuoStepUp: (options = {}) => {
        const returnTo = options.returnTo || (
            typeof window !== 'undefined'
                ? `${window.location?.pathname || '/'}${window.location?.search || ''}${window.location?.hash || ''}`
                : '/'
        );
        const url = getDuoStepUpUrl(returnTo, {
            action: options.action,
        });
        if (typeof window === 'undefined' || !window.location?.assign) {
            return { redirecting: true, url };
        }
        window.location.assign(url);
        return { redirecting: true, url };
    },
    startEnterpriseLogin: (options = {}) => {
        const returnTo = options.returnTo || (
            typeof window !== 'undefined'
                ? `${window.location?.pathname || '/'}${window.location?.search || ''}${window.location?.hash || ''}`
                : '/'
        );
        const url = getEnterpriseLoginUrl(returnTo, {
            loginHint: options.loginHint,
        });
        if (typeof window === 'undefined' || !window.location?.assign) {
            return { redirecting: true, url };
        }
        window.location.assign(url);
        return { redirecting: true, url };
    },
    exchangeSession: async (options = {}) => exchangeSessionWithFirebase(options.firebaseUser, options),
    createDesktopHandoffToken: async ({
        requestId = '',
        firebaseUser = null,
        preferCookieSession = false,
    } = {}) => {
        if (preferCookieSession) {
            return postWithFreshCsrf('/auth/desktop-handoff/custom-token', {
                requestId,
            }, {
                preferCookieSession: true,
                useFirebaseBearer: false,
                disableSessionExchangeOnUnauthorized: true,
            });
        }
        return postWithFirebaseBearer('/auth/desktop-handoff/custom-token', {
            requestId,
        }, {
            firebaseUser,
            forceRefreshAuth: Boolean(firebaseUser?.getIdToken),
        });
    },
    prepareDesktopHandoff: async ({
        requestId = '',
        firebaseUser = null,
        preferCookieSession = false,
    } = {}) => postAuthBootstrap('/auth/desktop-handoff/prepare', {
        requestId,
    }, {
        firebaseUser,
        preferCookieSession,
        useFirebaseBearer: !preferCookieSession && Boolean(firebaseUser?.getIdToken),
        disableSessionExchangeOnUnauthorized: preferCookieSession,
    }),
    getSession: async (options = {}) => {
        const execute = async () => {
            const headers = options.preferCookieSession === true
                ? await getAuthHeader(null, { useFirebaseBearer: false })
                : await getAuthHeader(options.firebaseUser);
            const response = await apiFetch('/auth/session', { headers });
            cacheCsrfTokenFromResponse(response, 'cookie_session');
            return response.data;
        };

        try {
            return await execute();
        } catch (error) {
            if (
                options.preferCookieSession !== true
                && options.firebaseUser?.getIdToken
                && isUnauthorizedAuthError(error)
            ) {
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
            ...(options.desktopHandoffRequestId
                ? { desktopHandoffRequestId: options.desktopHandoffRequestId }
                : {}),
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
    getMfaSecurityCenter: async (options = {}) => (
        getProtectedAuthJson('/auth/mfa', options)
    ),
    getAdminSecurityStatus: async (options = {}) => (
        getProtectedAuthJson('/admin/security/status', options)
    ),
    exchangeAdminRecoveryGrant: async (grant, options = {}) => (
        postAuthBootstrap('/admin/security/recovery/exchange', { grant }, {
            ...options,
            preferCookieSession: false,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
            disableSessionExchangeOnUnauthorized: true,
        })
    ),
    enrollAdminRecoveryPasskey: async (options = {}) => {
        const requestOptions = {
            ...options,
            preferCookieSession: true,
            disableSessionExchangeOnUnauthorized: true,
            forceFreshCsrf: true,
        };
        const start = await postAuthBootstrap('/admin/security/passkeys/enrollment/options', {}, requestOptions);
        const proofPayload = await signMfaPasskeyChallenge(start?.deviceChallenge, options);
        return postAuthBootstrap('/admin/security/passkeys/enrollment/verify', buildTrustedDeviceProofBody(
            start?.deviceChallenge,
            proofPayload,
        ), requestOptions);
    },
    verifyAdminPasskey: async (options = {}) => {
        const requestOptions = {
            ...options,
            preferCookieSession: true,
            disableSessionExchangeOnUnauthorized: true,
            forceFreshCsrf: true,
        };
        const start = await postAuthBootstrap('/admin/security/passkeys/challenge/options', {}, requestOptions);
        const proofPayload = await signMfaPasskeyChallenge(start?.deviceChallenge, options);
        return postAuthBootstrap('/admin/security/passkeys/challenge/verify', buildTrustedDeviceProofBody(
            start?.deviceChallenge,
            proofPayload,
        ), requestOptions);
    },
    requestMfaStepUp: async ({ action = 'manual_step_up', route = '', returnTo = '' } = {}, options = {}) => (
        postAuthBootstrap('/auth/mfa/step-up', { action, route, returnTo }, {
            ...options,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
        })
    ),
    setupTotp: async (options = {}) => (
        postAuthBootstrap('/auth/mfa/totp/setup', {}, {
            ...options,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
        })
    ),
    getTotpQr: async (options = {}) => (
        getProtectedAuthJson('/auth/mfa/totp/qr', options)
    ),
    verifyTotpSetup: async (code, options = {}) => (
        postAuthBootstrap('/auth/mfa/totp/verify-setup', { code }, {
            ...options,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
        })
    ),
    verifyTotpLogin: async ({ challengeId = '', code = '', purpose = 'login', action = '' } = {}, options = {}) => (
        postAuthBootstrap('/auth/mfa/totp/verify-login', { challengeId, code, purpose, action }, {
            ...options,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
        })
    ),
    disableTotp: async (options = {}) => (
        postAuthBootstrap('/auth/mfa/totp/disable', {}, {
            ...options,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
        })
    ),
    registerMfaPasskey: async (options = {}) => {
        const start = await postAuthBootstrap('/auth/mfa/passkey/register/options', {}, {
            ...options,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
        });
        const proofPayload = await signMfaPasskeyChallenge(start?.deviceChallenge, options);
        return postAuthBootstrap('/auth/mfa/passkey/register/verify', buildTrustedDeviceProofBody(
            start?.deviceChallenge,
            proofPayload,
        ), {
            ...options,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
        });
    },
    verifyMfaPasskeyLogin: async ({ challengeId = '', purpose = 'login', action = '' } = {}, options = {}) => {
        const start = await postAuthBootstrap('/auth/mfa/passkey/login/options', { challengeId, purpose, action }, {
            ...options,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
        });
        const proofPayload = await signMfaPasskeyChallenge(start?.deviceChallenge, options);
        return postAuthBootstrap('/auth/mfa/passkey/login/verify', buildTrustedDeviceProofBody(
            start?.deviceChallenge,
            proofPayload,
            { challengeId, purpose, action },
        ), {
            ...options,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
        });
    },
    removeMfaPasskey: async ({ deviceId = '', credentialId = '' } = {}, options = {}) => (
        postAuthBootstrap('/auth/mfa/passkey/remove', { deviceId, credentialId }, {
            ...options,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
        })
    ),
    renameTrustedDevice: async ({ deviceId = '', label = '' } = {}, options = {}) => {
        const normalizedDeviceId = String(deviceId || '').trim();
        if (!normalizedDeviceId) throw new Error('Trusted device ID is required.');
        return postAuthBootstrap(
            `/auth/mfa/trusted-devices/${encodeURIComponent(normalizedDeviceId)}`,
            { label },
            {
                ...options,
                method: 'PATCH',
                useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
            }
        );
    },
    revokeTrustedDevice: async ({ deviceId = '' } = {}, options = {}) => {
        const normalizedDeviceId = String(deviceId || '').trim();
        if (!normalizedDeviceId) throw new Error('Trusted device ID is required.');
        return postAuthBootstrap(
            `/auth/mfa/trusted-devices/${encodeURIComponent(normalizedDeviceId)}/revoke`,
            {},
            {
                ...options,
                useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
            }
        );
    },
    revokeOtherTrustedDevices: async (options = {}) => (
        postAuthBootstrap('/auth/mfa/trusted-devices/revoke-others', {}, {
            ...options,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
        })
    ),
    regenerateMfaRecoveryCodes: async (options = {}) => (
        postAuthBootstrap('/auth/mfa/recovery/regenerate', {}, {
            ...options,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
        })
    ),
    verifyMfaRecoveryCode: async ({ challengeId = '', code = '', purpose = 'login', action = '' } = {}, options = {}) => (
        postAuthBootstrap('/auth/mfa/recovery/verify', { challengeId, code, purpose, action }, {
            ...options,
            useFirebaseBearer: Boolean(options.firebaseUser?.getIdToken),
        })
    ),
    verifyRecoveryCode: async (email, code, options = {}) => {
        return postPublicOtpRequest('/auth/recovery-codes/verify', {
            email,
            code,
            ...getTurnstileRequestFields(options),
        });
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
        const hasBearerAuth = Boolean(headers?.Authorization || headers?.authorization);
        if (!hasBearerAuth) {
            try {
                const data = await postWithFreshCsrf('/auth/logout', {}, {
                    csrfOwner: 'cookie_session',
                    disableSessionExchangeOnUnauthorized: true,
                    useFirebaseBearer: false,
                });
                clearCsrfTokenCache();
                return data;
            } catch (error) {
                if (!isMissingCookieSessionError(error)) {
                    throw error;
                }
                const { data } = await apiFetch('/auth/logout', {
                    method: 'POST',
                    headers,
                });
                clearCsrfTokenCache();
                return data;
            }
        }

        const { data } = await apiFetch('/auth/logout', {
            method: 'POST',
            headers,
        });
        clearCsrfTokenCache();
        return data;
    },
    verifyDeviceChallenge: async (token, proofOrPayload, publicKeySpkiBase64 = '', options = {}) => {
        const {
            desktopHandoffTarget = false,
            ...requestOptions
        } = options;
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
            ...(desktopHandoffTarget === true ? { desktopHandoffTarget: true } : {}),
        };

        const canUseFirebaseBearer = Boolean(requestOptions.firebaseUser?.getIdToken);
        const verifyWithBearer = () => postAuthBootstrap('/auth/verify-device', body, {
            ...requestOptions,
            preferCookieSession: false,
            useFirebaseBearer: canUseFirebaseBearer,
        });
        const verifyWithCookieSession = () => postAuthBootstrap('/auth/verify-device', body, {
            ...requestOptions,
            // Desktop can have Firebase auth without a backend cookie. Do not
            // rebuild a cookie session around an already-signed challenge.
            disableSessionExchangeOnUnauthorized: true,
            preferCookieSession: true,
        });

        if (requestOptions.preferCookieSession === false) {
            return verifyWithBearer();
        }

        if (canUseFirebaseBearer && requestOptions.preferCookieSession !== true) {
            return verifyWithBearer().catch((error) => {
                if (isDeviceChallengeBindingMismatchError(error)) {
                    return verifyWithCookieSession();
                }
                throw error;
            });
        }

        return verifyWithCookieSession().catch((error) => {
            if (
                canUseFirebaseBearer
                && (
                    isMissingCookieSessionError(error)
                    || isDeviceChallengeBindingMismatchError(error)
                    || isInvalidCsrfError(error)
                )
            ) {
                return verifyWithBearer();
            }
            throw error;
        });
    },
};
const solvePow = async (token, difficulty) => {
    const prefix = '0'.repeat(difficulty);
    let nonce = 0;

    if (typeof window === 'undefined' || !window.crypto || !window.crypto.subtle) {
        throw new Error('Proof-of-Work requires browser Web Crypto support');
    }

    const encoder = new TextEncoder();
    while (true) {
        const dataStr = `${token}.${nonce}`;
        const dataBuffer = encoder.encode(dataStr);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');

        if (hashHex.startsWith(prefix)) {
            return nonce;
        }
        nonce++;
        if (nonce % 500 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }
};

export const otpApi = {
    sendOtp: async (email, phone, purpose, options = {}) => {
        const candidatePaths = ['/auth/otp/send', '/otp/send'];

        let powToken = null;
        let powNonce = null;

        const isTestEnv = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test';
        const shouldFetchChallenge = !isTestEnv || options.enablePowChallenge === true;

        if (shouldFetchChallenge) {
            try {
                const challengeRes = await apiFetch('/otp/challenge', {
                    method: 'POST',
                    body: JSON.stringify({ email, phone }),
                    retries: 0,
                });
                if (challengeRes?.data?.powToken) {
                    powToken = challengeRes.data.powToken;
                    const difficulty = Number(challengeRes.data.difficulty || 3);
                    powNonce = await solvePow(powToken, difficulty);
                }
            } catch (err) {
                const status = Number(err?.status || 0);
                if ([401, 403, 429].includes(status) || status >= 500) {
                    throw err;
                }
                console.warn('PoW challenge fetch or solve failed:', err.message);
            }
        }

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
                    powToken,
                    powNonce,
                    ...options,
                    ...getTurnstileRequestFields(options),
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
                return await postPublicOtpRequest(path, {
                    phone,
                    otp,
                    purpose,
                    ...options,
                    ...getTurnstileRequestFields(options),
                });
            } catch (error) {
                lastError = error;
                if (error?.status !== 404) break;
            }
        }
        throw lastError || new Error('Failed to verify OTP');
    },
    resetPassword: async (payloadOrEmail, phone = '', password = '', options = {}) => {
        const candidatePaths = ['/auth/otp/reset-password', '/otp/reset-password'];
        const payload = payloadOrEmail && typeof payloadOrEmail === 'object' && !Array.isArray(payloadOrEmail)
            ? { ...payloadOrEmail }
            : { email: payloadOrEmail, phone, password };
        const requestOptions = payloadOrEmail && typeof payloadOrEmail === 'object' && !Array.isArray(payloadOrEmail)
            ? payloadOrEmail
            : options;
        const trustedDeviceChallenge = payload?.flowToken
            ? await requestBootstrapDeviceChallenge({
              scope: 'reset-password',
              flowToken: payload.flowToken,
            }, requestOptions)
            : null;
        let lastError = null;
        for (const path of candidatePaths) {
            try {
                return await postPublicOtpRequest(path, {
                    ...payload,
                    ...getTurnstileRequestFields(requestOptions),
                    ...(trustedDeviceChallenge ? { trustedDeviceChallenge } : {}),
                });
            } catch (error) {
                lastError = error;
                if (error?.status !== 404) break;
            }
        }
        throw lastError || new Error('Failed to reset password');
    },
    checkUserExists: async (phone, email = '', options = {}) => {
        const candidatePaths = ['/auth/otp/check-user', '/otp/check-user'];
        let lastError = null;
        for (const path of candidatePaths) {
            try {
                return await postPublicOtpRequest(path, {
                    phone,
                    email,
                    ...getTurnstileRequestFields(options),
                });
            } catch (error) {
                lastError = error;
                if (error?.status !== 404) break;
            }
        }
        throw lastError || new Error('Failed to check user');
    }
};
