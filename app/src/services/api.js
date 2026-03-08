import { auth, isFirebaseReady } from '../config/firebase';
import {
    API_BASE_URL as BASE_URL,
    apiFetch,
    buildServiceUrl,
    createResponseError,
    requestWithTrace,
} from './apiBase';

const getAuthHeader = async (firebaseUser = null) => {
    if (!isFirebaseReady || !auth) {
        return {};
    }
    const user = firebaseUser || auth.currentUser;
    if (user) {
        const token = await user.getIdToken();
        return { 'Authorization': `Bearer ${token}` };
    }
    return {};
};

const createIdempotencyKey = (prefix = 'idmp') =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const parseApiError = async (response, fallbackMessage) => {
    const error = await createResponseError(response, fallbackMessage);
    return error.message;
};

const prefetchedProductIds = new Set();
const prefetchedListingIds = new Set();

const rawFetch = (input, init = undefined) => requestWithTrace(input, {
    ...(init || {}),
    throwOnHttpError: false,
});

const fetch = (input, init = undefined) => requestWithTrace(input, init || {});

const runWhenIdle = (callback) => {
    if (typeof window === 'undefined') return;
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(callback, { timeout: 1500 });
        return;
    }
    window.setTimeout(callback, 250);
};

/**
 * PRODUCTION-GRADE API SERVICE
 * - Unified Error Handling
 * - Timeout Management
 * - Type Validation
 */

export const productApi = {
    getProducts: async (params = {}, options = {}) => {
        const { data } = await apiFetch('/products', {
            method: 'GET',
            params,
            signal: options.signal,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
        });
        return data;
    },
    trackSearchClick: async (payload = {}) => {
        try {
            await fetch(`${BASE_URL}/products/telemetry/search-click`, {
                method: 'POST',
                keepalive: true,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });
        } catch {
            // Search click telemetry is best-effort only.
        }
    },
    getProductById: async (id, options = {}) => {
        const { data } = await apiFetch(`/products/${id}`, {
            method: 'GET',
            signal: options.signal,
        });
        return data;
    },
    prefetchProductById: (id) => {
        const normalizedId = id == null ? '' : String(id).trim();
        if (!normalizedId || prefetchedProductIds.has(normalizedId)) return;
        prefetchedProductIds.add(normalizedId);

        runWhenIdle(async () => {
            try {
                await fetch(`${BASE_URL}/products/${encodeURIComponent(normalizedId)}`, {
                    method: 'GET',
                    headers: { Accept: 'application/json' },
                });
            } catch {
                // Prefetch failures are intentionally ignored.
            }
        });
    },
    getProductReviews: async (id, params = {}) => {
        const cleanParams = Object.fromEntries(
            Object.entries(params).filter(([_, v]) => v != null && v !== '')
        );
        const query = new URLSearchParams(cleanParams).toString();
        const url = query
            ? `${BASE_URL}/products/${id}/reviews?${query}`
            : `${BASE_URL}/products/${id}/reviews`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch product reviews'));
        }
        return response.json();
    },
    createProductReview: async (id, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/products/${id}/reviews`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to submit review'));
        }
        return response.json();
    },
    visualSearch: async (payload = {}) => {
        const response = await fetch(`${BASE_URL}/products/visual-search`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Visual search failed'));
        }
        return response.json();
    },
    getDealDna: async (id) => {
        const response = await fetch(`${BASE_URL}/products/${id}/deal-dna`);
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch deal DNA score'));
        }
        return response.json();
    },
    getCompatibility: async (id, params = {}) => {
        const cleanParams = Object.fromEntries(
            Object.entries(params).filter(([_, v]) => v !== undefined && v !== null && v !== '')
        );
        const query = new URLSearchParams(cleanParams).toString();
        const url = query
            ? `${BASE_URL}/products/${id}/compatibility?${query}`
            : `${BASE_URL}/products/${id}/compatibility`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch compatibility graph'));
        }
        return response.json();
    },
    buildSmartBundle: async (payload = {}) => {
        const response = await fetch(`${BASE_URL}/products/bundles/build`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to build smart bundle'));
        }
        return response.json();
    },
    getRecommendations: async (payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/products/recommendations', {
            method: 'POST',
            headers: {
                ...headers,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        return data;
    },
    // Admin Methods
    deleteProduct: async (id) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/products/${id}`, {
            method: 'DELETE',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            }
        });
        if (!response.ok) throw new Error('Failed to delete product');
        return await response.json();
    },
    createProduct: async (payload = {}) => {
        const headers = await getAuthHeader();
        const body = (payload && typeof payload === 'object' && Object.keys(payload).length > 0)
            ? payload
            : {
                title: 'New Product',
                price: 999,
                description: 'New product description',
                category: 'Electronics',
                brand: 'Aura',
                image: 'https://via.placeholder.com/300',
                stock: 0,
                discountPercentage: 0,
                deliveryTime: '3-5 days',
            };
        const response = await fetch(`${BASE_URL}/products`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body)
        });
        if (!response.ok) throw new Error('Failed to create product');
        return await response.json();
    },
    updateProduct: async (product) => {
        const headers = await getAuthHeader();
        const { _id, id, ...payload } = product || {};
        const response = await fetch(`${BASE_URL}/products/${_id || id}`, {
            method: 'PUT',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Failed to update product');
        return await response.json();
    }
};

export const userApi = {
    /**
     * Sync user with backend after Firebase auth.
     * Sends the Firebase token for auth + user details for upsert.
     */
    login: async (email, name, phone, options = {}) => {
        const data = await authApi.syncSession(email, name, phone, options);
        return data?.profile || null;
    },
    getProfile: async (_email = '', options = {}) => {
        const headers = await getAuthHeader(options.firebaseUser || null);
        const { data } = await apiFetch('/users/profile', {
            method: 'GET',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        });
        return data;
    },
    syncCart: async (email, cartItems) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/users/cart`, {
            method: 'PUT',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, cartItems })
        });
        if (!response.ok) throw new Error('Failed to sync cart');
        return await response.json();
    },
    syncWishlist: async (email, wishlistItems) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/users/wishlist`, {
            method: 'PUT',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, wishlistItems })
        });
        if (!response.ok) throw new Error('Failed to sync wishlist');
        return await response.json();
    },
    updateProfile: async (data) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/users/profile`, {
            method: 'PUT',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to update profile');
        return result;
    },
    activateSeller: async () => {
        const headers = await getAuthHeader();
        const candidatePaths = [
            `${BASE_URL}/users/seller/activate`,
            `${BASE_URL}/users/activate-seller`,
            `${BASE_URL}/users/seller/enable`,
        ];

        let lastErrorMessage = 'Failed to activate seller mode';
        for (const path of candidatePaths) {
            const response = await rawFetch(path, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ acceptTerms: true }),
            });

            if (response.ok) {
                return response.json();
            }

            const message = await parseApiError(response, 'Failed to activate seller mode');
            lastErrorMessage = message || lastErrorMessage;

            // 404 on one path can occur during rolling/stale backend instances; try next alias.
            if (response.status !== 404) {
                break;
            }
        }

        throw new Error(lastErrorMessage);
    },
    deactivateSeller: async () => {
        const headers = await getAuthHeader();
        const candidatePaths = [
            `${BASE_URL}/users/seller/deactivate`,
            `${BASE_URL}/users/deactivate-seller`,
            `${BASE_URL}/users/seller/disable`,
        ];

        let lastErrorMessage = 'Failed to deactivate seller mode';
        for (const path of candidatePaths) {
            const response = await rawFetch(path, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmDeactivation: true }),
            });

            if (response.ok) {
                return response.json();
            }

            const message = await parseApiError(response, 'Failed to deactivate seller mode');
            lastErrorMessage = message || lastErrorMessage;
            if (response.status !== 404) {
                break;
            }
        }

        throw new Error(lastErrorMessage);
    },
    getDashboard: async () => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/users/dashboard`, {
            headers: { ...headers, 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error('Failed to fetch dashboard');
        return response.json();
    },
    getRewards: async () => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/users/rewards`, {
            headers: { ...headers, 'Content-Type': 'application/json' }
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to fetch rewards');
        return result;
    },
    addAddress: async (data) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/users/addresses`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to add address');
        return result;
    },
    updateAddress: async (addressId, data) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/users/addresses/${addressId}`, {
            method: 'PUT',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to update address');
        return result;
    },
    deleteAddress: async (addressId) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/users/addresses/${addressId}`, {
            method: 'DELETE',
            headers: { ...headers, 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error('Failed to delete address');
        return response.json();
    }
};

export const authApi = {
    getSession: async (options = {}) => {
        const headers = await getAuthHeader(options.firebaseUser || null);
        const { data } = await apiFetch('/auth/session', {
            method: 'GET',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
        });
        return data;
    },
    syncSession: async (email, name, phone, options = {}) => {
        const headers = await getAuthHeader(options.firebaseUser || null);
        const { data } = await apiFetch('/auth/sync', {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, name, phone }),
        });
        return data;
    },
};

export const otpApi = {
    sendOtp: async (email, phone, purpose, options = {}) => {
        const credentialProofToken = typeof options?.credentialProofToken === 'string'
            ? options.credentialProofToken.trim()
            : '';
        const candidatePaths = ['/auth/otp/send', '/otp/send'];
        let lastError = null;

        for (const path of candidatePaths) {
            try {
                const { data } = await apiFetch(path, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email,
                        phone,
                        purpose,
                        ...(credentialProofToken ? { credentialProofToken } : {}),
                    }),
                });
                return data;
            } catch (error) {
                lastError = error;
                if (error?.status !== 404) break;
            }
        }

        throw lastError || new Error('Failed to send OTP');
    },
    verifyOtp: async (phone, otp, purpose, intentId = '') => {
        const candidatePaths = ['/auth/otp/verify', '/otp/verify'];
        let lastError = null;

        for (const path of candidatePaths) {
            try {
                const { data } = await apiFetch(path, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone, otp, purpose, ...(intentId ? { intentId } : {}) }),
                });
                return data;
            } catch (error) {
                lastError = error;
                if (error?.status !== 404) break;
            }
        }

        throw lastError || new Error('Failed to verify OTP');
    },
    checkUserExists: async (phone, email = '') => {
        const candidatePaths = ['/auth/otp/check-user', '/otp/check-user'];
        let lastError = null;

        for (const path of candidatePaths) {
            try {
                const { data } = await apiFetch(path, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone, ...(email ? { email } : {}) }),
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

export const trustApi = {
    getClientSignals: async () => {
        const timezone = typeof Intl !== 'undefined'
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : 'unknown';

        const language = typeof navigator !== 'undefined'
            ? (navigator.language || 'unknown')
            : 'unknown';

        const online = typeof navigator !== 'undefined'
            ? navigator.onLine
            : true;

        const secureContext = typeof window !== 'undefined'
            ? Boolean(window.isSecureContext)
            : false;

        const permissionsSupported = typeof navigator !== 'undefined' && Boolean(navigator.permissions);

        return {
            online,
            secureContext,
            permissionsSupported,
            language,
            timezone,
        };
    },
    getHealthStatus: async () => {
        let backend = {
            status: 'degraded',
            db: 'unknown',
            uptime: 0,
            timestamp: null,
        };

        try {
            const response = await rawFetch(buildServiceUrl('/health'), {
                headers: { Accept: 'application/json' },
            });
            if (response.ok) {
                const data = await response.json();
                backend = {
                    status: data?.status || 'degraded',
                    db: data?.db || 'unknown',
                    uptime: Number(data?.uptime || 0),
                    timestamp: data?.timestamp || null,
                };
            }
        } catch {
            // graceful fallback to degraded
        }

        const client = await trustApi.getClientSignals();
        const isHealthy = backend.status === 'ok' && backend.db === 'connected' && client.online;
        const derivedStatus = isHealthy ? 'healthy' : 'degraded';

        return { backend, client, derivedStatus };
    },
};

export const adminApi = {
    getNotificationSummary: async () => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/notifications/summary`, {
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch admin notification summary'));
        }
        return response.json();
    },
    listNotifications: async (params = {}) => {
        const headers = await getAuthHeader();
        const clean = Object.fromEntries(
            Object.entries(params).filter(([_, value]) => value !== undefined && value !== null && value !== '')
        );
        const query = new URLSearchParams(clean).toString();
        const url = query
            ? `${BASE_URL}/admin/notifications?${query}`
            : `${BASE_URL}/admin/notifications`;
        const response = await fetch(url, {
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch admin notifications'));
        }
        return response.json();
    },
    markNotificationRead: async (notificationId, read = true) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/notifications/${notificationId}/read`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ read: Boolean(read) }),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to update notification state'));
        }
        return response.json();
    },
    markAllNotificationsRead: async (filters = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/notifications/read-all`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(filters),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to mark notifications read'));
        }
        return response.json();
    },
    getAnalyticsOverview: async (params = {}) => {
        const headers = await getAuthHeader();
        const clean = Object.fromEntries(
            Object.entries(params).filter(([_, value]) => value !== undefined && value !== null && value !== '')
        );
        const query = new URLSearchParams(clean).toString();
        const url = query
            ? `${BASE_URL}/admin/analytics/overview?${query}`
            : `${BASE_URL}/admin/analytics/overview`;
        const response = await fetch(url, {
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch analytics overview'));
        }
        return response.json();
    },
    getAnalyticsTimeSeries: async (params = {}) => {
        const headers = await getAuthHeader();
        const clean = Object.fromEntries(
            Object.entries(params).filter(([_, value]) => value !== undefined && value !== null && value !== '')
        );
        const query = new URLSearchParams(clean).toString();
        const url = query
            ? `${BASE_URL}/admin/analytics/timeseries?${query}`
            : `${BASE_URL}/admin/analytics/timeseries`;
        const response = await fetch(url, {
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch analytics timeline'));
        }
        return response.json();
    },
    getAnalyticsAnomalies: async (params = {}) => {
        const headers = await getAuthHeader();
        const clean = Object.fromEntries(
            Object.entries(params).filter(([_, value]) => value !== undefined && value !== null && value !== '')
        );
        const query = new URLSearchParams(clean).toString();
        const url = query
            ? `${BASE_URL}/admin/analytics/anomalies?${query}`
            : `${BASE_URL}/admin/analytics/anomalies`;
        const response = await fetch(url, {
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch analytics anomalies'));
        }
        return response.json();
    },
    getBiConfig: async () => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/analytics/bi-config`, {
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch BI configuration'));
        }
        return response.json();
    },
    exportAnalyticsCsv: async (params = {}) => {
        const headers = await getAuthHeader();
        const clean = Object.fromEntries(
            Object.entries(params).filter(([_, value]) => value !== undefined && value !== null && value !== '')
        );
        const query = new URLSearchParams(clean).toString();
        const url = query
            ? `${BASE_URL}/admin/analytics/export?${query}`
            : `${BASE_URL}/admin/analytics/export`;
        const response = await fetch(url, {
            headers: { ...headers },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to export analytics CSV'));
        }
        const blob = await response.blob();
        const disposition = response.headers.get('content-disposition') || '';
        const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
        const filename = match?.[1] || `admin_export_${Date.now()}.csv`;
        const rowCount = Number(response.headers.get('x-admin-export-row-count') || 0);
        return { blob, filename, rowCount };
    },
    getSystemHealth: async () => {
        const headers = await getAuthHeader();
        const response = await fetch('/health', {
            headers: { ...headers, Accept: 'application/json' },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch system health'));
        }
        return response.json();
    },
    getOpsReadiness: async () => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/ops/readiness`, {
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch admin readiness'));
        }
        return response.json();
    },
    runOpsSmoke: async () => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/ops/smoke`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to run admin smoke checks'));
        }
        return response.json();
    },
    getClientDiagnostics: async (params = {}) => {
        const headers = await getAuthHeader();
        const clean = Object.fromEntries(
            Object.entries(params).filter(([_, value]) => value !== undefined && value !== null && value !== '')
        );
        const query = new URLSearchParams(clean).toString();
        const url = query
            ? `${BASE_URL}/admin/ops/client-diagnostics?${query}`
            : `${BASE_URL}/admin/ops/client-diagnostics`;
        const response = await fetch(url, {
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch client diagnostics'));
        }
        return response.json();
    },
    listUsers: async (params = {}) => {
        const headers = await getAuthHeader();
        const clean = Object.fromEntries(
            Object.entries(params).filter(([_, value]) => value !== undefined && value !== null && value !== '')
        );
        const query = new URLSearchParams(clean).toString();
        const url = query
            ? `${BASE_URL}/admin/users?${query}`
            : `${BASE_URL}/admin/users`;
        const response = await fetch(url, {
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch users'));
        }
        return response.json();
    },
    getUserDetails: async (userId) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/users/${userId}`, {
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch user details'));
        }
        return response.json();
    },
    warnUser: async (userId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/users/${userId}/warn`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to warn user'));
        }
        return response.json();
    },
    suspendUser: async (userId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/users/${userId}/suspend`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to suspend user'));
        }
        return response.json();
    },
    dismissWarning: async (userId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/users/${userId}/dismiss-warning`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to dismiss warning'));
        }
        return response.json();
    },
    reactivateUser: async (userId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/users/${userId}/reactivate`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to reactivate user'));
        }
        return response.json();
    },
    deleteUser: async (userId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/users/${userId}/delete`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to delete user'));
        }
        return response.json();
    },
    getProducts: async (params = {}) => {
        const headers = await getAuthHeader();
        const clean = Object.fromEntries(
            Object.entries(params).filter(([_, value]) => value !== undefined && value !== null && value !== '')
        );
        clean._t = Date.now().toString();
        const query = new URLSearchParams(clean).toString();
        const url = query
            ? `${BASE_URL}/admin/products?${query}`
            : `${BASE_URL}/admin/products`;
        const response = await fetch(url, {
            headers: { ...headers, 'Content-Type': 'application/json' },
            cache: 'no-store',
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch admin products'));
        }
        return response.json();
    },
    getProductById: async (id) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/products/${encodeURIComponent(String(id))}?_t=${Date.now()}`, {
            headers: { ...headers, 'Content-Type': 'application/json' },
            cache: 'no-store',
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch admin product'));
        }
        return response.json();
    },
    getProductLogs: async (id) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/products/${encodeURIComponent(String(id))}/logs?_t=${Date.now()}`, {
            headers: { ...headers, 'Content-Type': 'application/json' },
            cache: 'no-store',
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch product logs'));
        }
        return response.json();
    },
    createProduct: async (payload) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/products`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to create product'));
        }
        return response.json();
    },
    updateProductCore: async (id, payload) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/products/${encodeURIComponent(String(id))}/core`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to update product core details'));
        }
        return response.json();
    },
    updateProductPricing: async (id, payload) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/products/${encodeURIComponent(String(id))}/pricing`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to update product pricing'));
        }
        return response.json();
    },
    deleteProduct: async (id, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/products/${encodeURIComponent(String(id))}`, {
            method: 'DELETE',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to delete product'));
        }
        return response.json();
    },
};

export const orderApi = {
    quoteOrder: async (payload) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/orders/quote`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to quote order'));
        }
        return await response.json();
    },
    simulatePayment: async (payload) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/orders/simulate-payment`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Payment simulation failed'));
        }
        return await response.json();
    },
    createOrder: async (orderData) => {
        const headers = await getAuthHeader();
        const idempotencyKey = orderData?.idempotencyKey || createIdempotencyKey('order');
        const response = await fetch(`${BASE_URL}/orders`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify(orderData)
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Order creation failed'));
        }
        return await response.json();
    },
    getMyOrders: async () => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/orders/myorders`, {
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) throw new Error('Failed to fetch orders');
        return await response.json();
    },
    getOrderTimeline: async (orderId) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/orders/${orderId}/timeline`, {
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch order timeline'));
        }
        return response.json();
    },
    getCommandCenter: async (orderId) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/orders/${orderId}/command-center`, {
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch command center'));
        }
        return response.json();
    },
    requestRefund: async (orderId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/orders/${orderId}/command-center/refund`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Refund request failed'));
        }
        return response.json();
    },
    cancelOrder: async (orderId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/orders/${orderId}/cancel`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Order cancellation failed'));
        }
        return response.json();
    },
    cancelOrderAdmin: async (orderId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/orders/${orderId}/admin-cancel`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Admin cancellation failed'));
        }
        return response.json();
    },
    requestReplacement: async (orderId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/orders/${orderId}/command-center/replace`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Replacement request failed'));
        }
        return response.json();
    },
    sendSupportMessage: async (orderId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/orders/${orderId}/command-center/support`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Support message failed'));
        }
        return response.json();
    },
    createWarrantyClaim: async (orderId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/orders/${orderId}/command-center/warranty`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Warranty claim failed'));
        }
        return response.json();
    },
    processRefundRequestAdmin: async (orderId, requestId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/orders/${orderId}/command-center/refund/${requestId}/admin`, {
            method: 'PATCH',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to process refund request'));
        }
        return response.json();
    },
    processReplacementRequestAdmin: async (orderId, requestId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/orders/${orderId}/command-center/replace/${requestId}/admin`, {
            method: 'PATCH',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to process replacement request'));
        }
        return response.json();
    },
    replySupportAdmin: async (orderId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/orders/${orderId}/command-center/support/admin-reply`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to send support reply'));
        }
        return response.json();
    },
    processWarrantyClaimAdmin: async (orderId, claimId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/orders/${orderId}/command-center/warranty/${claimId}/admin`, {
            method: 'PATCH',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to process warranty claim'));
        }
        return response.json();
    },
    getAllOrders: async () => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/orders`, {
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            }
        });
        if (!response.ok) throw new Error('Failed to fetch all orders');
        return await response.json();
    },
    updateOrderStatusAdmin: async (orderId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/orders/${orderId}/status`, {
            method: 'PATCH',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to update order status'));
        }
        return response.json();
    }
};

export const paymentApi = {
    createIntent: async (payload) => {
        const headers = await getAuthHeader();
        const idempotencyKey = payload?.idempotencyKey || createIdempotencyKey('intent');
        const response = await fetch(`${BASE_URL}/payments/intents`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to create payment intent'));
        }
        return response.json();
    },
    confirmIntent: async (intentId, payload) => {
        const headers = await getAuthHeader();
        const idempotencyKey = payload?.idempotencyKey || createIdempotencyKey('confirm');
        const response = await fetch(`${BASE_URL}/payments/intents/${intentId}/confirm`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to confirm payment'));
        }
        return response.json();
    },
    getIntent: async (intentId) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/payments/intents/${intentId}`, {
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch payment intent'));
        }
        return response.json();
    },
    completeChallenge: async (intentId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/payments/intents/${intentId}/challenge/complete`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to complete payment challenge'));
        }
        return response.json();
    },
    createRefund: async (intentId, payload = {}) => {
        const headers = await getAuthHeader();
        const idempotencyKey = payload?.idempotencyKey || createIdempotencyKey('refund');
        const response = await fetch(`${BASE_URL}/payments/intents/${intentId}/refunds`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to create refund'));
        }
        return response.json();
    },
    getMethods: async () => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/payments/methods`, {
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch payment methods'));
        }
        return response.json();
    },
    saveMethod: async (payload) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/payments/methods`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to save payment method'));
        }
        return response.json();
    },
    setDefaultMethod: async (methodId) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/payments/methods/${methodId}/default`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to set default payment method'));
        }
        return response.json();
    },
    deleteMethod: async (methodId) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/payments/methods/${methodId}`, {
            method: 'DELETE',
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to delete payment method'));
        }
        return response.json();
    },
    getAdminPayments: async (params = {}) => {
        const headers = await getAuthHeader();
        const clean = Object.fromEntries(Object.entries(params).filter(([_, value]) => value !== undefined && value !== null && value !== ''));
        const query = new URLSearchParams(clean).toString();
        const url = query ? `${BASE_URL}/admin/payments?${query}` : `${BASE_URL}/admin/payments`;
        const response = await fetch(url, {
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch admin payments'));
        }
        return response.json();
    },
    getRefundLedger: async (params = {}) => {
        const headers = await getAuthHeader();
        const clean = Object.fromEntries(Object.entries(params).filter(([_, value]) => value !== undefined && value !== null && value !== ''));
        const query = new URLSearchParams(clean).toString();
        const url = query
            ? `${BASE_URL}/admin/payments/refunds/ledger?${query}`
            : `${BASE_URL}/admin/payments/refunds/ledger`;
        const response = await fetch(url, {
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch refund ledger'));
        }
        return response.json();
    },
    updateRefundLedgerReference: async (orderId, requestId, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/payments/refunds/ledger/${orderId}/${requestId}/reference`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to update refund reference'));
        }
        return response.json();
    },
    getAdminPaymentById: async (intentId) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/admin/payments/${intentId}`, {
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to fetch payment detail'));
        }
        return response.json();
    },
    captureAdminPayment: async (intentId, payload = {}) => {
        const headers = await getAuthHeader();
        const idempotencyKey = payload?.idempotencyKey || createIdempotencyKey('capture');
        const response = await fetch(`${BASE_URL}/admin/payments/${intentId}/capture`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to capture payment'));
        }
        return response.json();
    },
    retryAdminCapture: async (intentId, payload = {}) => {
        const headers = await getAuthHeader();
        const idempotencyKey = payload?.idempotencyKey || createIdempotencyKey('retry-capture');
        const response = await fetch(`${BASE_URL}/admin/payments/${intentId}/retry-capture`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to queue capture retry'));
        }
        return response.json();
    },
};

export const listingApi = {
    createListing: async (data) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/listings`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to create listing');
        return result;
    },
    getListings: async (params = {}) => {
        const cleanParams = Object.fromEntries(
            Object.entries(params).filter(([_, v]) => v != null && v !== '')
        );
        const qs = new URLSearchParams(cleanParams).toString();
        const url = qs ? `${BASE_URL}/listings?${qs}` : `${BASE_URL}/listings`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch listings');
        return response.json();
    },
    getHotspots: async (params = {}) => {
        const cleanParams = Object.fromEntries(
            Object.entries(params).filter(([_, v]) => v != null && v !== '')
        );
        const qs = new URLSearchParams(cleanParams).toString();
        const url = qs ? `${BASE_URL}/listings/hotspots?${qs}` : `${BASE_URL}/listings/hotspots`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch city hotspots');
        return response.json();
    },
    getListingById: async (id) => {
        const response = await fetch(`${BASE_URL}/listings/${id}`);
        if (!response.ok) throw new Error('Listing not found');
        return response.json();
    },
    prefetchListingById: (id) => {
        const normalizedId = id == null ? '' : String(id).trim();
        if (!normalizedId || prefetchedListingIds.has(normalizedId)) return;
        prefetchedListingIds.add(normalizedId);

        runWhenIdle(async () => {
            try {
                await fetch(`${BASE_URL}/listings/${encodeURIComponent(normalizedId)}`, {
                    method: 'GET',
                    headers: { Accept: 'application/json' },
                });
            } catch {
                // Prefetch failures are intentionally ignored.
            }
        });
    },
    updateListing: async (id, data) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/listings/${id}`, {
            method: 'PUT',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Update failed');
        return result;
    },
    markSold: async (id) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/listings/${id}/sold`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error('Failed to mark as sold');
        return response.json();
    },
    deleteListing: async (id) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/listings/${id}`, {
            method: 'DELETE',
            headers: { ...headers, 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error('Failed to delete listing');
        return response.json();
    },
    getMyListings: async () => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/listings/my`, {
            headers: { ...headers, 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error('Failed to fetch your listings');
        return response.json();
    },
    getSellerProfile: async (userId) => {
        const response = await fetch(`${BASE_URL}/listings/seller/${userId}`);
        if (!response.ok) throw new Error('Seller not found');
        return response.json();
    },
    createEscrowIntent: async (id, payload = {}) => {
        const headers = await getAuthHeader();
        const idempotencyKey = payload?.idempotencyKey || createIdempotencyKey('escrow-intent');
        const response = await fetch(`${BASE_URL}/listings/${id}/escrow/intents`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to create escrow payment intent');
        return result;
    },
    confirmEscrowIntent: async (id, intentId, payload = {}) => {
        const headers = await getAuthHeader();
        const idempotencyKey = payload?.idempotencyKey || createIdempotencyKey('escrow-confirm');
        const response = await fetch(`${BASE_URL}/listings/${id}/escrow/intents/${intentId}/confirm`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to confirm escrow payment intent');
        return result;
    },
    startEscrow: async (id, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/listings/${id}/escrow/start`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to start escrow');
        return result;
    },
    confirmEscrow: async (id) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/listings/${id}/escrow/confirm`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to confirm escrow delivery');
        return result;
    },
    cancelEscrow: async (id) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/listings/${id}/escrow/cancel`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to cancel escrow');
        return result;
    },
    getMessageInbox: async () => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/listings/messages/inbox`, {
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to fetch message inbox');
        return result;
    },
    getListingMessages: async (id, params = {}) => {
        const headers = await getAuthHeader();
        const cleanParams = Object.fromEntries(
            Object.entries(params).filter(([_, v]) => v !== undefined && v !== null && v !== '')
        );
        const qs = new URLSearchParams(cleanParams).toString();
        const url = qs
            ? `${BASE_URL}/listings/${id}/messages?${qs}`
            : `${BASE_URL}/listings/${id}/messages`;
        const response = await fetch(url, {
            headers: { ...headers, 'Content-Type': 'application/json' },
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to fetch listing conversation');
        return result;
    },
    sendListingMessage: async (id, payload = {}) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/listings/${id}/messages`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Failed to send message');
        return result;
    }
};

// ── Trade-In API ─────────────────────────────────────────────
const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read file for upload'));
    reader.readAsDataURL(file);
});

export const uploadApi = {
    signReviewMediaUpload: async ({ fileName, mimeType, sizeBytes }) => {
        const headers = await getAuthHeader();
        const response = await fetch(`${BASE_URL}/uploads/reviews/sign`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName, mimeType, sizeBytes }),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to sign media upload'));
        }
        return response.json();
    },
    uploadSignedReviewMedia: async ({ uploadToken, file }) => {
        const headers = await getAuthHeader();
        const dataUrl = await fileToDataUrl(file);
        const response = await fetch(`${BASE_URL}/uploads/reviews/upload`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uploadToken,
                fileName: file?.name || 'review-media',
                mimeType: file?.type || '',
                dataUrl,
            }),
        });
        if (!response.ok) {
            throw new Error(await parseApiError(response, 'Failed to upload media'));
        }
        return response.json();
    },
    uploadReviewMediaFromFile: async (file) => {
        const signData = await uploadApi.signReviewMediaUpload({
            fileName: file?.name || 'review-media',
            mimeType: file?.type || '',
            sizeBytes: file?.size || 0,
        });
        return uploadApi.uploadSignedReviewMedia({
            uploadToken: signData.uploadToken,
            file,
        });
    },
};

export const tradeInApi = {
    estimate: async (data) => {
        const headers = await getAuthHeader();
        const r = await fetch(`${BASE_URL}/trade-in/estimate`, {
            method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await r.json();
        if (!r.ok) throw new Error(result.message || 'Estimation failed');
        return result;
    },
    create: async (data) => {
        const headers = await getAuthHeader();
        const r = await fetch(`${BASE_URL}/trade-in`, {
            method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await r.json();
        if (!r.ok) throw new Error(result.message || 'Trade-in creation failed');
        return result;
    },
    getMyTradeIns: async () => {
        const headers = await getAuthHeader();
        const r = await fetch(`${BASE_URL}/trade-in/my`, { headers });
        if (!r.ok) throw new Error('Failed to fetch trade-ins');
        return r.json();
    },
    cancel: async (id) => {
        const headers = await getAuthHeader();
        const r = await fetch(`${BASE_URL}/trade-in/${id}`, { method: 'DELETE', headers });
        if (!r.ok) throw new Error('Failed to cancel');
        return r.json();
    }
};

// ── Price Alert API ──────────────────────────────────────────
export const priceAlertApi = {
    create: async (productId, targetPrice) => {
        const headers = await getAuthHeader();
        const r = await fetch(`${BASE_URL}/price-alerts`, {
            method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId, targetPrice })
        });
        const result = await r.json();
        if (!r.ok) throw new Error(result.message || 'Alert creation failed');
        return result;
    },
    getMyAlerts: async () => {
        const headers = await getAuthHeader();
        const r = await fetch(`${BASE_URL}/price-alerts/my`, { headers });
        if (!r.ok) throw new Error('Failed to fetch alerts');
        return r.json();
    },
    delete: async (id) => {
        const headers = await getAuthHeader();
        const r = await fetch(`${BASE_URL}/price-alerts/${id}`, { method: 'DELETE', headers });
        if (!r.ok) throw new Error('Failed to delete alert');
        return r.json();
    },
    getHistory: async (productId) => {
        const r = await fetch(`${BASE_URL}/price-alerts/history/${productId}`);
        if (!r.ok) throw new Error('Failed to fetch history');
        return r.json();
    }
};

