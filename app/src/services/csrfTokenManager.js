import { buildApiUrl } from './apiBase';
import { getActiveMarketHeaders } from './marketRuntime';
import { getTrustedDeviceHeaders } from './deviceTrustClient';

/**
 * CSRF Token Manager
 *
 * The backend consumes each CSRF token after one successful write. We therefore
 * only keep a short-lived local reservation and consume it client-side before
 * the next POST/PUT/PATCH/DELETE leaves the browser.
 */

let cachedToken = null;
let cachedTokenExpiry = 0;
let cachedTokenOwner = '';
const CSRF_TOKEN_CACHE_TTL_MS = 50 * 60 * 1000; // 50 minutes
const CSRF_TOKEN_FORMAT = /^[a-f0-9]{64}$/;

const decodeBase64UrlJson = (value = '') => {
    if (!value) return null;

    try {
        const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
        const padding = normalized.length % 4;
        const padded = padding ? normalized.padEnd(normalized.length + (4 - padding), '=') : normalized;
        const decoded = typeof atob === 'function'
            ? atob(padded)
            : Buffer.from(padded, 'base64').toString('utf8');
        return JSON.parse(decoded);
    } catch {
        return null;
    }
};

const parseResponseBodySafely = async (response) => {
    const text = await response.text();
    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

const resolveResponseErrorMessage = async (response) => {
    const payload = await parseResponseBodySafely(response.clone());

    if (payload && typeof payload === 'object' && typeof payload.message === 'string' && payload.message.trim()) {
        return payload.message.trim();
    }

    if (typeof payload === 'string' && payload.trim()) {
        return payload.trim();
    }

    return response.statusText || 'Request failed';
};

const getAuthTokenOwner = (authToken = '') => {
    const [, payload = ''] = String(authToken || '').split('.');
    const decoded = decodeBase64UrlJson(payload);
    return String(decoded?.user_id || decoded?.sub || decoded?.uid || '').trim();
};

const normalizeCsrfRequestOptions = (input = '', options = {}) => {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        return {
            authToken: String(input.authToken || '').trim(),
            owner: String(input.owner || '').trim(),
            forceFresh: Boolean(input.forceFresh),
        };
    }

    return {
        authToken: String(input || '').trim(),
        owner: String(options.owner || '').trim(),
        forceFresh: Boolean(options.forceFresh),
    };
};

const resolveCsrfOwner = ({ authToken = '', owner = '' } = {}) => {
    if (authToken) {
        return getAuthTokenOwner(authToken);
    }
    return String(owner || 'cookie_session').trim();
};

/**
 * Clear cached CSRF token
 */
export const clearCsrfTokenCache = () => {
    console.debug('[CSRF] Clearing token cache');
    cachedToken = null;
    cachedTokenExpiry = 0;
    cachedTokenOwner = '';
};

/**
 * Check if cached token is still valid
 */
const isCsrfTokenCacheValid = (context = '') => {
    if (!cachedToken) return false;

    if (Date.now() >= cachedTokenExpiry) {
        console.debug('[CSRF] Token expired, clearing cache');
        clearCsrfTokenCache();
        return false;
    }

    const normalizedContext = normalizeCsrfRequestOptions(context);
    const owner = resolveCsrfOwner(normalizedContext);
    if (cachedTokenOwner && owner && cachedTokenOwner !== owner) {
        console.debug('[CSRF] Token owner changed, clearing cache');
        clearCsrfTokenCache();
        return false;
    }

    return true;
};

/**
 * Cache a CSRF token with validation
 * @param {string} token - Token to cache
 * @param {string} owner - Auth owner identifier associated with this token
 * @throws {Error} If token format is invalid
 */
export const cacheToken = (token, owner = '') => {
    if (!token || typeof token !== 'string') {
        throw new Error('CSRF token must be a non-empty string');
    }

    // Validate token format (should be 64-char hex = 32 bytes)
    if (!CSRF_TOKEN_FORMAT.test(token)) {
        console.error('[CSRF] Invalid token format. Expected 64-char hex, got:', token.substring(0, 20) + '...');
        throw new Error('Invalid CSRF token format from server');
    }

    console.debug('[CSRF] Token cached successfully');
    cachedToken = token;
    cachedTokenExpiry = Date.now() + CSRF_TOKEN_CACHE_TTL_MS;
    cachedTokenOwner = String(owner || '').trim();
};

const consumeCachedCsrfToken = (authToken = '') => {
    if (!isCsrfTokenCacheValid(authToken)) {
        return null;
    }

    const token = cachedToken;
    clearCsrfTokenCache();
    return token;
};

/**
 * Fetch a fresh CSRF token from the server
 * Requires active auth token
 * Uses request deduplication to prevent concurrent requests
 * 
 * @param {string|object} input - Optional Firebase ID token or request options
 * @returns {Promise<string>} CSRF token
 */
export const fetchCsrfToken = async (input = {}) => {
    const requestOptions = normalizeCsrfRequestOptions(input);
    const { authToken } = requestOptions;

    try {
        console.debug('[CSRF] Fetching token from server...');

        const response = await fetch(buildApiUrl('/auth/session'), {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
                ...getTrustedDeviceHeaders(),
                ...getActiveMarketHeaders(),
            },
            credentials: 'include',
        });

        if (!response.ok) {
            const serverMessage = await resolveResponseErrorMessage(response);
            const error = new Error(`HTTP ${response.status}: ${serverMessage}`);
            error.status = response.status;
            error.data = { message: serverMessage };
            throw error;
        }

        const token = response.headers.get('X-CSRF-Token');
        if (!token) {
            throw new Error('Server did not return X-CSRF-Token header');
        }

        console.debug('[CSRF] Token received, validating format...');
        cacheToken(token, resolveCsrfOwner(requestOptions));

        return token;
    } catch (error) {
        console.error('[CSRF] Token fetch failed:', error.message);
        clearCsrfTokenCache();
        throw error;
    }
};

/**
 * Get cached CSRF token without making a request
 * Returns null if not cached or expired
 */
export const getCachedCsrfToken = () => {
    return isCsrfTokenCacheValid() ? cachedToken : null;
};

/**
 * Ensure CSRF token is available, fetching if necessary
 * 
 * @param {string} authToken - Firebase ID token  
 * @returns {Promise<string>} CSRF token
 */
export const ensureCsrfToken = async (input = '', options = {}) => {
    const requestOptions = normalizeCsrfRequestOptions(input, options);
    const { forceFresh = false } = requestOptions;

    if (!forceFresh) {
        const cached = consumeCachedCsrfToken(requestOptions);
        if (cached) {
            return cached;
        }
    }

    await fetchCsrfToken(requestOptions);
    const reserved = consumeCachedCsrfToken(requestOptions);
    if (!reserved) {
        throw new Error('Unable to reserve a fresh CSRF token');
    }
    return reserved;
};

/**
 * Add CSRF token to request headers if needed
 *
 * Note: the token is identity-bound on the server, so callers must fetch it using
 * the same authenticated user context they will use for the subsequent write request.
 * Only adds token for state-changing methods (POST, PUT, PATCH, DELETE)
 * Throws error if token is required but missing
 * 
 * @param {Object} headers - Request headers object
 * @param {string} method - HTTP method
 * @param {string|null} csrfToken - CSRF token to add (optional)
 * @returns {Object} Updated headers
 * @throws {Error} If CSRF token required but missing
 */
export const addCsrfTokenToHeaders = (headers = {}, method = 'GET', csrfToken = null) => {
    const safeMethod = String(method || 'GET').toUpperCase();
    
    // Only validate/add CSRF token for state-changing methods
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(safeMethod)) {
        // CSRF token is REQUIRED for state-changing requests
        if (!csrfToken || typeof csrfToken !== 'string' || csrfToken.trim() === '') {
            const error = new Error(
                'CSRF token is required for state-changing requests (POST, PUT, PATCH, DELETE). ' +
                'Token is missing or invalid. Please refresh page and try again.'
            );
            console.error('[CSRF] Token missing for state-changing request:', safeMethod);
            throw error;
        }
        
        console.debug('[CSRF] Adding CSRF token to', safeMethod, 'request');
        return {
            ...headers,
            'X-CSRF-Token': csrfToken,
        };
    }
    
    return headers;
};
