import { apiFetch, API_BASE_URL as BASE_URL, buildServiceUrl } from '../apiBase';
import { getAuthHeader, parseApiError } from './apiUtils';

const PROFILE_CACHE_TTL_MS = 15 * 1000;
const profileCache = {
    key: '',
    value: null,
    cachedAt: 0,
    promise: null,
};

const getProfileCacheKey = (firebaseUser = null) => {
    const user = firebaseUser || null; // Assume auth is handled in utils
    // In real app, we'd get current user from auth state
    return user?.uid || 'current';
};

const invalidateProfileCache = () => {
    profileCache.key = '';
    profileCache.value = null;
    profileCache.cachedAt = 0;
    profileCache.promise = null;
};

export const userApi = {
    getProfile: async (options = {}) => {
        const { firebaseUser, force, cacheMs = PROFILE_CACHE_TTL_MS } = options;
        const cacheKey = getProfileCacheKey(firebaseUser);
        const cacheAge = Date.now() - profileCache.cachedAt;

        if (!force && profileCache.key === cacheKey && profileCache.value && cacheAge < cacheMs) {
            return profileCache.value;
        }

        if (profileCache.promise) return profileCache.promise;

        profileCache.promise = (async () => {
            const headers = await getAuthHeader(firebaseUser);
            const { data } = await apiFetch('/users/profile', { headers });
            profileCache.value = data;
            profileCache.cachedAt = Date.now();
            profileCache.key = cacheKey;
            return data;
        })().finally(() => {
            profileCache.promise = null;
        });

        return profileCache.promise;
    },
    updateProfile: async (payload) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/users/profile', {
            method: 'PUT',
            headers,
            body: JSON.stringify(payload),
        });
        invalidateProfileCache();
        return data;
    },
    syncCart: async (email, cartItems) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/users/cart', {
            method: 'PUT',
            headers,
            body: JSON.stringify({ email, cartItems }),
        });
        return data;
    },
    syncWishlist: async (email, wishlistItems) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/users/wishlist', {
            method: 'PUT',
            headers,
            body: JSON.stringify({ email, wishlistItems }),
        });
        return data;
    },
    getRewards: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/users/rewards', { headers });
        return data;
    },
    activateSeller: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/users/seller/activate', {
            method: 'POST',
            headers,
            body: JSON.stringify({ acceptTerms: true }),
        });
        invalidateProfileCache();
        return data;
    },
    deactivateSeller: async () => {
        const headers = await getAuthHeader();
        const candidatePaths = [
            '/users/seller/deactivate',
            '/users/deactivate-seller',
            '/users/seller/disable',
        ];

        let lastError = null;
        for (const path of candidatePaths) {
            try {
                const { data } = await apiFetch(path, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ confirmDeactivation: true }),
                });
                invalidateProfileCache();
                return data;
            } catch (error) {
                lastError = error;
                if (error?.status !== 404) break;
            }
        }
        throw lastError || new Error('Failed to deactivate seller mode');
    },
    addAddress: async (payload) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/users/addresses', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    updateAddress: async (addressId, payload) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/users/addresses/${addressId}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    deleteAddress: async (addressId) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/users/addresses/${addressId}`, {
            method: 'DELETE',
            headers,
        });
        return data;
    },
    getDashboard: async () => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/users/dashboard', { headers });
        return data;
    }
};
