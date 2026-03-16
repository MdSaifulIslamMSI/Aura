/**
 * CSRF Token Manager
 * 
 * Manages CSRF token lifecycle:
 * - Fetches token from server on demand
 * - Caches token with proper expiry
 * - Prevents concurrent token fetch requests
 * - Validates token format (64-char hex)
 * - Includes token in state-changing requests
 *
 * Header flow:
 * 1) Client fetches token from GET /api/auth/session (response header: X-CSRF-Token).
 * 2) Client sends that same token in X-CSRF-Token on POST/PUT/PATCH/DELETE.
 * 3) Server validates token + current authenticated identity (uid/email) before consuming token.
 */

let cachedToken = null;
let cachedTokenExpiry = 0;
let tokenFetchInProgress = null;
const CSRF_TOKEN_CACHE_TTL_MS = 50 * 60 * 1000; // 50 minutes
const CSRF_TOKEN_FORMAT = /^[a-f0-9]{64}$/;

/**
 * Clear cached CSRF token
 */
export const clearCsrfTokenCache = () => {
    console.debug('[CSRF] Clearing token cache');
    cachedToken = null;
    cachedTokenExpiry = 0;
};

/**
 * Check if cached token is still valid
 */
const isCsrfTokenCacheValid = () => {
    if (!cachedToken) return false;
    
    if (Date.now() >= cachedTokenExpiry) {
        console.debug('[CSRF] Token expired, clearing cache');
        clearCsrfTokenCache();
        return false;
    }
    
    return true;
};

/**
 * Cache a CSRF token with validation
 * @param {string} token - Token to cache
 * @throws {Error} If token format is invalid
 */
export const cacheToken = (token) => {
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
};

/**
 * Fetch a fresh CSRF token from the server
 * Requires active auth token
 * Uses request deduplication to prevent concurrent requests
 * 
 * @param {string} authToken - Firebase ID token
 * @returns {Promise<string>} CSRF token
 */
export const fetchCsrfToken = async (authToken) => {
    if (!authToken) {
        throw new Error('Auth token required to fetch CSRF token');
    }

    // Return cached token if still valid
    if (isCsrfTokenCacheValid()) {
        console.debug('[CSRF] Using cached token');
        return cachedToken;
    }

    // Prevent duplicate concurrent fetch requests
    if (tokenFetchInProgress) {
        console.debug('[CSRF] Token fetch already in progress, waiting...');
        return tokenFetchInProgress;
    }

    // Create promise and store reference
    tokenFetchInProgress = (async () => {
        try {
            console.debug('[CSRF] Fetching token from server...');
            
            const response = await fetch('/api/auth/session', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // Extract CSRF token from response headers
            const token = response.headers.get('X-CSRF-Token');
            if (!token) {
                throw new Error('Server did not return X-CSRF-Token header');
            }

            console.debug('[CSRF] Token received, validating format...');
            
            // Validate and cache token
            cacheToken(token);

            return token;
        } catch (error) {
            console.error('[CSRF] Token fetch failed:', error.message);
            clearCsrfTokenCache();
            throw error;
        } finally {
            // Clear in-progress flag
            tokenFetchInProgress = null;
        }
    })();

    return tokenFetchInProgress;
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
export const ensureCsrfToken = async (authToken) => {
    const cached = getCachedCsrfToken();
    if (cached) {
        return cached;
    }
    return fetchCsrfToken(authToken);
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
