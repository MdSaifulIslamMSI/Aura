import { apiFetch, API_BASE_URL as BASE_URL, buildServiceUrl } from '../apiBase';
import { getAuthHeader, parseApiError } from './apiUtils';
import { cartApi, normalizeCartSnapshot } from './cartApi';

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

const normalizeCartPayload = (payload = {}) => {
    const snapshot = payload?.cart && typeof payload.cart === 'object' && !Array.isArray(payload.cart)
        ? payload.cart
        : payload;

    return {
        items: Array.isArray(snapshot?.items)
            ? snapshot.items
            : Array.isArray(snapshot?.cart)
                ? snapshot.cart
                : [],
        revision: Number(snapshot?.revision ?? snapshot?.version ?? 0),
        syncedAt: snapshot?.syncedAt || snapshot?.updatedAt || null,
        summary: snapshot?.summary || null,
    };
};

const normalizeWishlistPayload = (payload = {}) => ({
    items: Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.wishlist)
            ? payload.wishlist
            : [],
    revision: Number(payload?.revision ?? 0),
    syncedAt: payload?.syncedAt || null,
});

const coerceProfileOptions = (options = {}) => {
    if (typeof options === 'string') {
        return {};
    }
    return options || {};
};

const normalizeCartItemsForCommands = (items = []) => {
    const merged = new Map();

    (Array.isArray(items) ? items : []).forEach((item) => {
        const productId = Number(item?.productId ?? item?.id);
        const quantity = Number(item?.quantity ?? item?.qty ?? 1);
        if (!Number.isInteger(productId) || productId <= 0) return;
        if (!Number.isInteger(quantity) || quantity <= 0) return;

        if (merged.has(productId)) {
            merged.set(productId, merged.get(productId) + quantity);
            return;
        }

        merged.set(productId, quantity);
    });

    return Array.from(merged.entries()).map(([productId, quantity]) => ({
        productId,
        quantity,
    }));
};

const buildCartMutationResponse = (snapshot, productId = null) => {
    const normalizedSnapshot = normalizeCartPayload(snapshot);
    const selectedItem = productId === null
        ? null
        : normalizedSnapshot.items.find((item) => Number(item?.id || item?.productId) === Number(productId)) || null;

    return {
        item: selectedItem,
        revision: normalizedSnapshot.revision,
        syncedAt: normalizedSnapshot.syncedAt,
    };
};

const buildCartConflictError = (snapshot) => {
    const normalizedSnapshot = normalizeCartPayload(snapshot);
    const error = new Error('Cart revision conflict');
    error.status = 409;
    error.data = normalizedSnapshot;
    return error;
};

const normalizeCartConflictError = (error) => {
    if (Number(error?.status || 0) !== 409) {
        return error;
    }

    error.data = normalizeCartPayload(error?.data?.cart || error?.data || {});
    if (!error.message) {
        error.message = 'Cart revision conflict';
    }
    return error;
};

const buildReplaceCartCommands = (currentItems = [], desiredItems = []) => {
    const currentById = new Map(
        normalizeCartItemsForCommands(currentItems).map((item) => [item.productId, item.quantity])
    );
    const desiredById = new Map(
        normalizeCartItemsForCommands(desiredItems).map((item) => [item.productId, item.quantity])
    );

    const commands = [];

    currentById.forEach((_quantity, productId) => {
        if (!desiredById.has(productId)) {
            commands.push({
                type: 'remove_item',
                productId,
            });
        }
    });

    desiredById.forEach((quantity, productId) => {
        if (currentById.get(productId) !== quantity) {
            commands.push({
                type: 'set_quantity',
                productId,
                quantity,
            });
        }
    });

    return commands;
};

export const userApi = {
    login: async (email, name, phone, options = {}) => {
        // Assume authApi is imported or we can just fetch from /auth/sync directly since authApi might not be accessible here cleanly without a circular dependency.
        const headers = await getAuthHeader(options.firebaseUser);
        const { data } = await apiFetch('/auth/sync', {
            method: 'POST',
            headers,
            body: JSON.stringify({ email, name, phone }),
        });
        invalidateProfileCache();
        return data?.profile || null;
    },
    getProfile: async (options = {}) => {
        const { firebaseUser, force, cacheMs = PROFILE_CACHE_TTL_MS } = coerceProfileOptions(options);
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
    getCart: async (options = {}) => {
        const { firebaseUser } = coerceProfileOptions(options);
        const snapshot = await cartApi.getCart({ firebaseUser });
        return normalizeCartPayload(snapshot);
    },
    addCartItem: async ({
        productId,
        quantity = 1,
        expectedRevision = null,
        firebaseUser = null,
        clientMutationId = '',
    } = {}) => {
        try {
            const response = await cartApi.applyCommands({
                firebaseUser,
                expectedVersion: expectedRevision,
                clientMutationId,
                commands: [{
                    type: 'add_item',
                    productId,
                    quantity,
                }],
            });
            invalidateProfileCache();
            return buildCartMutationResponse(response.cart, productId);
        } catch (error) {
            throw normalizeCartConflictError(error);
        }
    },
    setCartItemQuantity: async ({
        productId,
        quantity,
        expectedRevision = null,
        firebaseUser = null,
        clientMutationId = '',
    } = {}) => {
        try {
            const response = await cartApi.applyCommands({
                firebaseUser,
                expectedVersion: expectedRevision,
                clientMutationId,
                commands: [{
                    type: 'set_quantity',
                    productId,
                    quantity,
                }],
            });
            invalidateProfileCache();
            return buildCartMutationResponse(response.cart, productId);
        } catch (error) {
            throw normalizeCartConflictError(error);
        }
    },
    removeCartItem: async ({
        productId,
        expectedRevision = null,
        firebaseUser = null,
        clientMutationId = '',
    } = {}) => {
        try {
            const response = await cartApi.applyCommands({
                firebaseUser,
                expectedVersion: expectedRevision,
                clientMutationId,
                commands: [{
                    type: 'remove_item',
                    productId,
                }],
            });
            invalidateProfileCache();
            return buildCartMutationResponse(response.cart, productId);
        } catch (error) {
            throw normalizeCartConflictError(error);
        }
    },
    mergeCart: async ({ items = [], expectedRevision = null, firebaseUser = null } = {}) => {
        const normalizedItems = normalizeCartItemsForCommands(items);
        if (normalizedItems.length === 0) {
            return userApi.getCart({ firebaseUser });
        }

        try {
            const { cart } = await cartApi.applyCommands({
                firebaseUser,
                expectedVersion: expectedRevision,
                commands: normalizedItems.map((item) => ({
                    type: 'add_item',
                    productId: item.productId,
                    quantity: item.quantity,
                })),
            });
            invalidateProfileCache();
            return normalizeCartPayload(cart);
        } catch (error) {
            throw normalizeCartConflictError(error);
        }
    },
    syncCart: async (cartItems, options = {}) => {
        const { firebaseUser, expectedRevision = null } = coerceProfileOptions(options);
        try {
            const currentSnapshot = normalizeCartSnapshot(await cartApi.getCart({ firebaseUser }));
            if (
                expectedRevision !== null
                && expectedRevision !== undefined
                && Number(currentSnapshot.version || 0) !== Number(expectedRevision)
            ) {
                throw buildCartConflictError(currentSnapshot);
            }

            const commands = buildReplaceCartCommands(currentSnapshot.items, cartItems);
            if (commands.length === 0) {
                return normalizeCartPayload(currentSnapshot);
            }

            const { cart } = await cartApi.applyCommands({
                firebaseUser,
                expectedVersion: expectedRevision ?? currentSnapshot.version,
                commands,
            });
            invalidateProfileCache();
            return normalizeCartPayload(cart);
        } catch (error) {
            throw normalizeCartConflictError(error);
        }
    },
    syncWishlist: async (wishlistItems, options = {}) => {
        const { firebaseUser, expectedRevision = null } = coerceProfileOptions(options);
        const headers = await getAuthHeader(firebaseUser);
        const { data } = await apiFetch('/users/wishlist', {
            method: 'PUT',
            headers,
            body: JSON.stringify({
                wishlistItems,
                ...(expectedRevision !== null && expectedRevision !== undefined ? { expectedRevision } : {}),
            }),
        });
        invalidateProfileCache();
        return normalizeWishlistPayload(data);
    },
    getWishlist: async (options = {}) => {
        const { firebaseUser } = coerceProfileOptions(options);
        const headers = await getAuthHeader(firebaseUser);
        const { data } = await apiFetch('/users/wishlist', {
            headers,
        });
        return normalizeWishlistPayload(data);
    },
    addWishlistItem: async ({ productId, expectedRevision = null, firebaseUser = null } = {}) => {
        const headers = await getAuthHeader(firebaseUser);
        const { data } = await apiFetch('/users/wishlist/items', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                productId,
                ...(expectedRevision !== null && expectedRevision !== undefined ? { expectedRevision } : {}),
            }),
        });
        invalidateProfileCache();
        return data;
    },
    removeWishlistItem: async ({ productId, expectedRevision = null, firebaseUser = null } = {}) => {
        const headers = await getAuthHeader(firebaseUser);
        const { data } = await apiFetch(`/users/wishlist/items/${productId}`, {
            method: 'DELETE',
            headers,
            body: JSON.stringify({
                ...(expectedRevision !== null && expectedRevision !== undefined ? { expectedRevision } : {}),
            }),
        });
        invalidateProfileCache();
        return data;
    },
    mergeWishlist: async ({ items = [], expectedRevision = null, firebaseUser = null } = {}) => {
        const headers = await getAuthHeader(firebaseUser);
        const { data } = await apiFetch('/users/wishlist/merge', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                items,
                ...(expectedRevision !== null && expectedRevision !== undefined ? { expectedRevision } : {}),
            }),
        });
        invalidateProfileCache();
        return normalizeWishlistPayload(data);
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
