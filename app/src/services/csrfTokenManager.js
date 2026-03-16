/**
 * CSRF Token Manager
 * 
 * Manages CSRF token lifecycle:
 * - Fetches token from server on demand
 * - Caches token with expiry
 * - Automatically includes token in state-changing requests
 */

let cachedToken = null;
let cachedTokenExpiry = 0;
const CSRF_TOKEN_CACHE_TTL_MS = 50 * 60 * 1000; // 50 minutes (token expires at 60)

/**
 * Clear cached CSRF token
 */
export const clearCsrfTokenCache = () => {
    cachedToken = null;
    cachedTokenExpiry = 0;
};

/**
 * Check if cached token is still valid
 */
const isCsrfTokenCacheValid = () => {
    return cachedToken && Date.now() < cachedTokenExpiry;
};

/**
 * Fetch a fresh CSRF token from the server
 * Requires active auth token
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
        return cachedToken;
    }

    try {
        const response = await fetch('/api/auth/session', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch CSRF token: ${response.statusText}`);
        }

        // Extract CSRF token from response headers
        const token = response.headers.get('X-CSRF-Token');
        if (!token) {
            throw new Error('CSRF token not found in response headers');
        }

        // Cache token
        cachedToken = token;
        cachedTokenExpiry = Date.now() + CSRF_TOKEN_CACHE_TTL_MS;

        return token;
    } catch (error) {
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
export const ensureCsrfToken = async (authToken) => {
    const cached = getCachedCsrfToken();
    if (cached) {
        return cached;
    }
    return fetchCsrfToken(authToken);
};

/**
 * Add CSRF token to request headers if needed
 * Only adds token for state-changing methods (POST, PUT, PATCH, DELETE)
 * 
 * @param {Object} headers - Request headers object
 * @param {string} method - HTTP method
 * @param {string|null} csrfToken - CSRF token to add (optional)
 * @returns {Object} Updated headers
 */
export const addCsrfTokenToHeaders = (headers = {}, method = 'GET', csrfToken = null) => {
    const safeMethod = String(method || 'GET').toUpperCase();
    
    // Only add CSRF token for state-changing methods
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(safeMethod) && csrfToken) {
        return {
            ...headers,
            'X-CSRF-Token': csrfToken,
        };
    }
    
    return headers;
};
