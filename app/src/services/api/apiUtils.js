import { createResponseError } from '../apiBase';
import { auth, isFirebaseReady } from '../../config/firebase';
import { getTrustedDeviceHeaders } from '../deviceTrustClient';

export const PROFILE_CACHE_TTL_MS = 15 * 1000;
export const PRODUCT_DETAIL_CACHE_TTL_MS = 30 * 1000;

/**
 * Retrieves the Firebase ID token and returns an Authorization header.
 */
export const getAuthHeader = async (firebaseUser = null, options = {}) => {
    const trustedDeviceHeaders = getTrustedDeviceHeaders();

    if (!isFirebaseReady || !auth) {
        return trustedDeviceHeaders;
    }
    const user = firebaseUser || auth.currentUser;
    if (user) {
        const token = await user.getIdToken(options?.forceRefresh === true);
        return {
            'Authorization': `Bearer ${token}`,
            ...trustedDeviceHeaders,
        };
    }
    return trustedDeviceHeaders;
};

/**
 * Parses API error responses into human-readable messages.
 */
export const parseApiError = async (response, fallbackMessage) => {
    const error = await createResponseError(response, fallbackMessage);
    return error.message;
};

/**
 * Creates an idempotency key for safe retries.
 */
export const createIdempotencyKey = (prefix = 'idmp') =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Runs a callback during browser idle time or after a short delay.
 */
export const runWhenIdle = (callback) => {
    if (typeof window === 'undefined') return;
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(callback, { timeout: 1500 });
        return;
    }
    window.setTimeout(callback, 250);
};
