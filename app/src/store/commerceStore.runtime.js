import { create } from 'zustand';
import { pushClientDiagnostic } from '../services/clientObservability';
import { userApi } from '../services/api';

export const GUEST_CART_STORAGE_KEY = 'aura_cart_guest_v2';
export const GUEST_WISHLIST_STORAGE_KEY = 'aura_wishlist_guest_v2';

const COMMERCE_SYNC_STORAGE_KEY = 'aura_commerce_sync_v2';
const COMMERCE_SYNC_CHANNEL = 'aura-commerce-sync-v2';
const COMMERCE_CHECKOUT_SESSION_KEY = 'aura_checkout_session_v1';
const AUTH_COMMERCE_STORAGE_KEY = 'aura_commerce_auth_v1';
const MAX_PERSISTED_AUTH_IDENTITIES = 5;
const ENTITY_REFRESH_TTL_MS = {
    cart: 45 * 1000,
    wishlist: 45 * 1000,
};
const tabId = `commerce-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

let commerceBroadcastChannel = null;
let commerceSyncInitialized = false;
let commerceSyncCleanup = null;
const activeFlushPromises = {
    cart: null,
    wishlist: null,
};
const activeHydratePromises = {
    cart: null,
    wishlist: null,
    commerce: null,
};

const getWindowRef = () => (typeof window !== 'undefined' ? window : null);

const safeParse = (value) => {
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const normalizeAuthUser = (user) => {
    if (!user?.uid) return null;

    const firebaseUser = typeof user?.getIdToken === 'function'
        ? user
        : (typeof user?.firebaseUser?.getIdToken === 'function' ? user.firebaseUser : null);

    return {
        uid: user.uid,
        email: user.email || '',
        ...(firebaseUser ? { firebaseUser } : {}),
    };
};

const getExplicitFirebaseUser = (authUser) => (
    typeof authUser?.firebaseUser?.getIdToken === 'function'
        ? authUser.firebaseUser
        : null
);

const buildApiOptions = (firebaseUser, extra = {}) => (
    firebaseUser ? { ...extra, firebaseUser } : extra
);

const createEmptyEntityState = (source = 'guest') => ({
    itemsById: {},
    orderedIds: [],
    revision: source === 'user' ? 0 : null,
    status: 'idle',
    source,
    pendingOps: [],
    lastHydratedAt: null,
    syncedAt: null,
    error: null,
});

const createEmptySyncState = () => ({
    authGeneration: 0,
});

const createEmptyCheckoutSession = () => ({
    source: 'cart',
    directBuy: null,
});

const normalizeCartLine = (item = {}) => {
    const id = Number(item?.id || item?.productId || 0);
    const pricing = item?.pricing && typeof item.pricing === 'object'
        ? {
            ...item.pricing,
            baseAmount: Number(item.pricing.baseAmount ?? item?.price ?? 0),
            baseCurrency: String(item.pricing.baseCurrency || 'INR').toUpperCase(),
            displayAmount: Number(item.pricing.displayAmount ?? item?.price ?? 0),
            displayCurrency: String(item.pricing.displayCurrency || item?.market?.currency || 'INR').toUpperCase(),
            originalDisplayAmount: Number(item.pricing.originalDisplayAmount ?? item?.originalPrice ?? item?.price ?? 0),
            originalBaseAmount: Number(item.pricing.originalBaseAmount ?? item?.originalPrice ?? item?.price ?? 0),
        }
        : null;
    return {
        id,
        title: String(item?.title || '').trim(),
        brand: String(item?.brand || '').trim(),
        price: Number(item?.price || 0),
        originalPrice: Number(item?.originalPrice || item?.price || 0),
        discountPercentage: Number(item?.discountPercentage || 0),
        image: String(item?.image || '').trim(),
        stock: Math.max(0, Number(item?.stock || 0)),
        deliveryTime: String(item?.deliveryTime || '2-3 days').trim(),
        quantity: Math.max(1, Number(item?.quantity || 1)),
        pricing,
        market: item?.market || null,
    };
};

const normalizeWishlistLine = (item = {}) => {
    const id = Number(item?.id || item?.productId || 0);
    const pricing = item?.pricing && typeof item.pricing === 'object'
        ? {
            ...item.pricing,
            baseAmount: Number(item.pricing.baseAmount ?? item?.price ?? 0),
            baseCurrency: String(item.pricing.baseCurrency || 'INR').toUpperCase(),
            displayAmount: Number(item.pricing.displayAmount ?? item?.price ?? 0),
            displayCurrency: String(item.pricing.displayCurrency || item?.market?.currency || 'INR').toUpperCase(),
            originalDisplayAmount: Number(item.pricing.originalDisplayAmount ?? item?.originalPrice ?? item?.price ?? 0),
            originalBaseAmount: Number(item.pricing.originalBaseAmount ?? item?.originalPrice ?? item?.price ?? 0),
        }
        : null;
    return {
        id,
        title: String(item?.title || '').trim(),
        brand: String(item?.brand || '').trim(),
        price: Number(item?.price || 0),
        originalPrice: Number(item?.originalPrice || item?.price || 0),
        discountPercentage: Number(item?.discountPercentage || 0),
        image: String(item?.image || '').trim(),
        stock: Math.max(0, Number(item?.stock || 0)),
        rating: Number(item?.rating || 0),
        ratingCount: Math.max(0, Number(item?.ratingCount || 0)),
        deliveryTime: String(item?.deliveryTime || '').trim(),
        category: String(item?.category || '').trim(),
        addedAt: item?.addedAt || new Date().toISOString(),
        pricing,
        market: item?.market || null,
    };
};

const isValidCartLine = (item) => Number.isFinite(Number(item?.id)) && Number(item.id) > 0;
const isValidWishlistLine = (item) => Number.isFinite(Number(item?.id)) && Number(item.id) > 0;

const toCartLineFromProduct = (product = {}, quantity = 1) => normalizeCartLine({
    id: product?.id ?? product?._id,
    title: product?.displayTitle || product?.title || '',
    brand: product?.brand || '',
    price: product?.price,
    originalPrice: product?.originalPrice,
    discountPercentage: product?.discountPercentage,
    image: product?.image,
    stock: product?.stock,
    deliveryTime: product?.deliveryTime,
    quantity,
});

const toWishlistLineFromProduct = (product = {}) => normalizeWishlistLine({
    id: product?.id ?? product?._id,
    title: product?.displayTitle || product?.title || '',
    brand: product?.brand || '',
    price: product?.price,
    originalPrice: product?.originalPrice,
    discountPercentage: product?.discountPercentage,
    image: product?.image,
    stock: product?.stock,
    rating: product?.rating,
    ratingCount: product?.ratingCount,
    deliveryTime: product?.deliveryTime,
    category: product?.category,
    addedAt: product?.addedAt || new Date().toISOString(),
});

const readPersistedCheckoutSession = () => {
    const windowRef = getWindowRef();
    if (!windowRef?.sessionStorage) {
        return createEmptyCheckoutSession();
    }

    const parsed = safeParse(windowRef.sessionStorage.getItem(COMMERCE_CHECKOUT_SESSION_KEY));
    if (parsed?.source !== 'direct-buy' || !parsed?.directBuy?.item) {
        return createEmptyCheckoutSession();
    }

    const directBuyItem = normalizeCartLine(parsed.directBuy.item);
    if (!isValidCartLine(directBuyItem)) {
        return createEmptyCheckoutSession();
    }

    return {
        source: 'direct-buy',
        directBuy: {
            productId: String(parsed.directBuy.productId || directBuyItem.id),
            quantity: Math.max(1, Number(parsed.directBuy.quantity || directBuyItem.quantity || 1)),
            item: directBuyItem,
        },
    };
};

const persistCheckoutSession = (session = createEmptyCheckoutSession()) => {
    const windowRef = getWindowRef();
    if (!windowRef?.sessionStorage) return;

    try {
        if (session?.source !== 'direct-buy' || !session?.directBuy?.item) {
            windowRef.sessionStorage.removeItem(COMMERCE_CHECKOUT_SESSION_KEY);
            return;
        }

        const payload = {
            source: 'direct-buy',
            directBuy: {
                productId: String(session.directBuy.productId || session.directBuy.item.id),
                quantity: Math.max(1, Number(session.directBuy.quantity || session.directBuy.item.quantity || 1)),
                item: normalizeCartLine(session.directBuy.item),
            },
        };

        windowRef.sessionStorage.setItem(COMMERCE_CHECKOUT_SESSION_KEY, JSON.stringify(payload));
    } catch {
        // Ignore session persistence failures.
    }
};

const serializeSnapshot = (items = [], normalizeLine) => JSON.stringify(
    (items || []).map((item) => normalizeLine(item))
);

const readGuestSnapshot = (storageKey, normalizeLine, isValidLine) => {
    const windowRef = getWindowRef();
    if (!windowRef?.localStorage) return [];

    const parsed = safeParse(windowRef.localStorage.getItem(storageKey));
    return Array.isArray(parsed)
        ? parsed.map((item) => normalizeLine(item)).filter(isValidLine)
        : [];
};

const persistGuestSnapshot = (storageKey, items, normalizeLine, isValidLine) => {
    const windowRef = getWindowRef();
    if (!windowRef?.localStorage) return;

    const normalizedItems = (items || []).map((item) => normalizeLine(item)).filter(isValidLine);
    if (normalizedItems.length === 0) {
        windowRef.localStorage.removeItem(storageKey);
        return;
    }

    windowRef.localStorage.setItem(storageKey, serializeSnapshot(normalizedItems, normalizeLine));
};

const normalizeAuthIdentityPart = (value = '') => String(value || '').trim().toLowerCase();

const getPersistedAuthIdentityKey = (authUser = null) => {
    const uid = String(authUser?.uid || '').trim();
    const email = normalizeAuthIdentityPart(authUser?.email);

    if (!uid && !email) {
        return '';
    }

    return `${uid || 'nouid'}::${email || 'noemail'}`;
};

const readPersistedAuthCommerceStore = () => {
    const windowRef = getWindowRef();
    if (!windowRef?.localStorage) return {};

    const parsed = safeParse(windowRef.localStorage.getItem(AUTH_COMMERCE_STORAGE_KEY));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
};

const writePersistedAuthCommerceStore = (store = {}) => {
    const windowRef = getWindowRef();
    if (!windowRef?.localStorage) return;

    const trimmedEntries = Object.entries(store)
        .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
        .sort(([, left], [, right]) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0))
        .slice(0, MAX_PERSISTED_AUTH_IDENTITIES);

    try {
        if (trimmedEntries.length === 0) {
            windowRef.localStorage.removeItem(AUTH_COMMERCE_STORAGE_KEY);
            return;
        }

        windowRef.localStorage.setItem(
            AUTH_COMMERCE_STORAGE_KEY,
            JSON.stringify(Object.fromEntries(trimmedEntries)),
        );
    } catch {
        // Ignore auth snapshot persistence failures.
    }
};

const serializePersistedAuthEntityState = (entityKey, entityState = {}) => {
    const normalizeLine = entityKey === 'cart' ? normalizeCartLine : normalizeWishlistLine;
    const items = (entityState?.orderedIds || [])
        .map((id) => entityState?.itemsById?.[id])
        .filter(Boolean)
        .map((item) => normalizeLine(item));

    return {
        items,
        revision: Number(entityState?.revision || 0),
        syncedAt: entityState?.syncedAt || null,
        lastHydratedAt: Number(entityState?.lastHydratedAt || 0) || null,
    };
};

const readPersistedAuthEntityState = (authUser, entityKey) => {
    const config = getEntityConfig(entityKey);
    const identityKey = getPersistedAuthIdentityKey(authUser);

    if (!identityKey) return null;

    const entry = readPersistedAuthCommerceStore()?.[identityKey]?.[entityKey];
    if (!entry || !Array.isArray(entry.items)) return null;

    return {
        items: entry.items
            .map((item) => config.normalizeLine(item))
            .filter(config.isValidLine),
        revision: Number(entry.revision || 0),
        syncedAt: entry.syncedAt || null,
        lastHydratedAt: Number(entry.lastHydratedAt || 0) || null,
    };
};

const persistAuthenticatedEntityState = (authUser, entityKey, entityState = {}) => {
    const identityKey = getPersistedAuthIdentityKey(authUser);
    if (!identityKey || entityState?.source !== 'user') {
        return;
    }

    const store = readPersistedAuthCommerceStore();
    const currentEntry = store?.[identityKey] && typeof store[identityKey] === 'object'
        ? store[identityKey]
        : {};

    store[identityKey] = {
        ...currentEntry,
        updatedAt: Date.now(),
        [entityKey]: serializePersistedAuthEntityState(entityKey, entityState),
    };

    writePersistedAuthCommerceStore(store);
};

const buildEntityState = (
    entityKey,
    items = [],
    source = 'guest',
    revision = null,
    pendingOps = [],
    status = 'ready',
    error = null,
    lastHydratedAt = Date.now(),
    syncedAt = null,
) => {
    const { normalizeLine, isValidLine } = entityKey === 'cart'
        ? {
            normalizeLine: normalizeCartLine,
            isValidLine: isValidCartLine,
        }
        : {
            normalizeLine: normalizeWishlistLine,
            isValidLine: isValidWishlistLine,
        };

    const itemsById = {};
    const orderedIds = [];

    (Array.isArray(items) ? items : []).forEach((item) => {
        const normalized = normalizeLine(item);
        if (!isValidLine(normalized)) return;
        const key = String(normalized.id);
        itemsById[key] = normalized;
        orderedIds.push(key);
    });

    return {
        itemsById,
        orderedIds,
        revision: source === 'user' ? Number(revision ?? 0) : null,
        status,
        source,
        pendingOps,
        lastHydratedAt,
        syncedAt,
        error,
    };
};

const getEntityItems = (entityKey, entityState = {}) => (
    (entityState?.orderedIds || [])
        .map((id) => entityState?.itemsById?.[id])
        .filter(Boolean)
);

const buildCartSummary = (items = []) => items.reduce((acc, item) => {
    const price = Number(item?.pricing?.displayAmount ?? item?.price ?? 0);
    const originalPrice = Number(item?.pricing?.originalDisplayAmount ?? item?.originalPrice ?? item?.price ?? 0);
    const quantity = Number(item?.quantity || 1);
    const itemTotal = price * quantity;
    const itemOriginalTotal = originalPrice > price ? originalPrice * quantity : itemTotal;

    acc.totalPrice += itemTotal;
    acc.totalOriginalPrice += itemOriginalTotal;
    acc.totalDiscount += itemOriginalTotal - itemTotal;
    acc.totalItems += quantity;
    acc.itemCount += 1;
    acc.currency = item?.pricing?.displayCurrency || acc.currency;
    return acc;
}, {
    totalPrice: 0,
    totalOriginalPrice: 0,
    totalDiscount: 0,
    totalItems: 0,
    itemCount: 0,
    currency: 'INR',
});

const extractEntityPayload = (entityKey, payload = {}, source = 'user') => {
    const items = Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.cart)
            ? payload.cart
            : Array.isArray(payload?.wishlist)
                ? payload.wishlist
                : [];

    return {
        items: items
            .map((item) => (entityKey === 'cart' ? normalizeCartLine(item) : normalizeWishlistLine(item)))
            .filter((item) => (entityKey === 'cart' ? isValidCartLine(item) : isValidWishlistLine(item))),
        revision: source === 'user' ? Number(payload?.revision ?? 0) : null,
        syncedAt: payload?.syncedAt || null,
    };
};

const extractConflictPayload = (entityKey, error) => {
    if (Number(error?.status || 0) !== 409) return null;
    const data = error?.data || {};
    if (!Array.isArray(data?.items)) return null;
    return extractEntityPayload(entityKey, data, 'user');
};

const applyCartOp = (items = [], op = {}) => {
    const nextItems = items.map((item) => normalizeCartLine(item));
    const productId = String(op?.productId || '');
    const currentIndex = nextItems.findIndex((item) => String(item.id) === productId);

    if (op?.kind === 'add') {
        if (currentIndex >= 0) {
            const current = nextItems[currentIndex];
            nextItems[currentIndex] = normalizeCartLine({
                ...current,
                quantity: Math.min(
                    Math.max(1, Number(current.quantity || 1)) + Math.max(1, Number(op.quantity || 1)),
                    Math.max(1, Number(current.stock || current.quantity || 1)),
                ),
            });
            return nextItems;
        }

        if (!op?.productSnapshot) {
            return nextItems;
        }

        nextItems.push(normalizeCartLine({
            ...op.productSnapshot,
            quantity: Math.min(
                Math.max(1, Number(op.quantity || op.productSnapshot.quantity || 1)),
                Math.max(1, Number(op.productSnapshot.stock || op.quantity || 1)),
            ),
        }));
        return nextItems;
    }

    if (op?.kind === 'set') {
        if (currentIndex < 0) return nextItems;
        const requestedQuantity = Math.max(0, Number(op.quantity || 0));
        if (requestedQuantity === 0) {
            return nextItems.filter((item) => String(item.id) !== productId);
        }

        const current = nextItems[currentIndex];
        nextItems[currentIndex] = normalizeCartLine({
            ...current,
            quantity: Math.min(
                requestedQuantity,
                Math.max(1, Number(current.stock || requestedQuantity)),
            ),
        });
        return nextItems;
    }

    if (op?.kind === 'remove') {
        return nextItems.filter((item) => String(item.id) !== productId);
    }

    return nextItems;
};

const applyWishlistOp = (items = [], op = {}) => {
    const nextItems = items.map((item) => normalizeWishlistLine(item));
    const productId = String(op?.productId || '');
    const currentIndex = nextItems.findIndex((item) => String(item.id) === productId);

    if (op?.kind === 'add') {
        if (!op?.productSnapshot) {
            return nextItems;
        }

        const normalizedSnapshot = normalizeWishlistLine(op.productSnapshot);
        if (currentIndex >= 0) {
            nextItems[currentIndex] = {
                ...nextItems[currentIndex],
                ...normalizedSnapshot,
                addedAt: nextItems[currentIndex].addedAt || normalizedSnapshot.addedAt,
            };
            return nextItems;
        }

        nextItems.push(normalizedSnapshot);
        return nextItems;
    }

    if (op?.kind === 'remove') {
        return nextItems.filter((item) => String(item.id) !== productId);
    }

    return nextItems;
};

const replayPendingOps = (entityKey, items = [], pendingOps = []) => (
    pendingOps.reduce((acc, op) => (
        entityKey === 'cart'
            ? applyCartOp(acc, op)
            : applyWishlistOp(acc, op)
    ), items)
);

const resolveCommittedItems = (entityKey, currentItems = [], op = {}, response = {}) => {
    const items = currentItems.map((item) => (
        entityKey === 'cart' ? normalizeCartLine(item) : normalizeWishlistLine(item)
    ));

    if (op?.kind === 'remove') {
        return items.filter((item) => String(item.id) !== String(op.productId));
    }

    if (!response?.item) {
        if (entityKey === 'cart' && op?.kind === 'set' && Number(op.quantity || 0) === 0) {
            return items.filter((item) => String(item.id) !== String(op.productId));
        }
        return items;
    }

    const normalizedItem = entityKey === 'cart'
        ? normalizeCartLine(response.item)
        : normalizeWishlistLine(response.item);
    const hasItem = items.some((item) => String(item.id) === String(normalizedItem.id));

    if (hasItem) {
        return items.map((item) => (
            String(item.id) === String(normalizedItem.id) ? normalizedItem : item
        ));
    }

    return [...items, normalizedItem];
};

const clonePendingOp = (entityKey, op = {}) => ({
    ...op,
    productSnapshot: op?.productSnapshot
        ? (entityKey === 'cart'
            ? normalizeCartLine(op.productSnapshot)
            : normalizeWishlistLine(op.productSnapshot))
        : null,
});

const emitCommerceDiagnostic = (type, context = {}, severity = 'info') => {
    pushClientDiagnostic(type, {
        context: {
            deviceClass: typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)')?.matches ? 'mobile' : 'desktop',
            tabId,
            ...context,
        },
    }, severity);
};

const updateEntityState = (set, entityKey, nextEntityState) => set(() => ({
    [entityKey]: nextEntityState,
}));

const getEntityConfig = (entityKey) => {
    if (entityKey === 'cart') {
        return {
            guestStorageKey: GUEST_CART_STORAGE_KEY,
            refreshTtl: ENTITY_REFRESH_TTL_MS.cart,
            normalizeLine: normalizeCartLine,
            isValidLine: isValidCartLine,
            toLineFromProduct: toCartLineFromProduct,
            applyOp: applyCartOp,
            getSnapshot: async (firebaseUser) => userApi.getCart(buildApiOptions(firebaseUser)),
            mergeSnapshot: async ({ items, expectedRevision, firebaseUser }) => (
                userApi.mergeCart(buildApiOptions(firebaseUser, { items, expectedRevision }))
            ),
            syncSnapshot: async ({ items, expectedRevision, firebaseUser }) => (
                userApi.syncCart(items, buildApiOptions(firebaseUser, { expectedRevision }))
            ),
            commitOp: async (op, expectedRevision, firebaseUser) => {
                if (op.kind === 'add') {
                    return userApi.addCartItem(buildApiOptions(firebaseUser, {
                        productId: Number(op.productId),
                        quantity: op.quantity,
                        expectedRevision,
                    }));
                }

                if (op.kind === 'set') {
                    return userApi.setCartItemQuantity(buildApiOptions(firebaseUser, {
                        productId: Number(op.productId),
                        quantity: op.quantity,
                        expectedRevision,
                    }));
                }

                return userApi.removeCartItem(buildApiOptions(firebaseUser, {
                    productId: Number(op.productId),
                    expectedRevision,
                }));
            },
        };
    }

    return {
        guestStorageKey: GUEST_WISHLIST_STORAGE_KEY,
        refreshTtl: ENTITY_REFRESH_TTL_MS.wishlist,
        normalizeLine: normalizeWishlistLine,
        isValidLine: isValidWishlistLine,
        toLineFromProduct: toWishlistLineFromProduct,
        applyOp: applyWishlistOp,
        getSnapshot: async (firebaseUser) => userApi.getWishlist(buildApiOptions(firebaseUser)),
        mergeSnapshot: async ({ items, expectedRevision, firebaseUser }) => (
            userApi.mergeWishlist(buildApiOptions(firebaseUser, { items, expectedRevision }))
        ),
        syncSnapshot: async ({ items, expectedRevision, firebaseUser }) => (
            userApi.syncWishlist(items, buildApiOptions(firebaseUser, { expectedRevision }))
        ),
        commitOp: async (op, expectedRevision, firebaseUser) => {
            if (op.kind === 'add') {
                return userApi.addWishlistItem(buildApiOptions(firebaseUser, {
                    productId: Number(op.productId),
                    expectedRevision,
                }));
            }

            return userApi.removeWishlistItem(buildApiOptions(firebaseUser, {
                productId: Number(op.productId),
                expectedRevision,
            }));
        },
    };
};

const readGuestEntitySnapshot = (entityKey) => {
    const config = getEntityConfig(entityKey);
    return readGuestSnapshot(config.guestStorageKey, config.normalizeLine, config.isValidLine);
};

const persistGuestEntitySnapshot = (entityKey, items = []) => {
    const config = getEntityConfig(entityKey);
    persistGuestSnapshot(config.guestStorageKey, items, config.normalizeLine, config.isValidLine);
};

const broadcastEntitySnapshot = (snapshot = {}) => {
    const windowRef = getWindowRef();
    if (!windowRef) return;

    const payload = {
        ...snapshot,
        originId: tabId,
        timestamp: Date.now(),
    };

    if (commerceBroadcastChannel) {
        commerceBroadcastChannel.postMessage(payload);
        return;
    }

    try {
        windowRef.localStorage.setItem(COMMERCE_SYNC_STORAGE_KEY, JSON.stringify(payload));
        windowRef.localStorage.removeItem(COMMERCE_SYNC_STORAGE_KEY);
    } catch {
        // Ignore fallback failures.
    }
};

const getCanonicalSnapshotForBroadcast = (state, entityKey) => ({
    entity: entityKey,
    source: state[entityKey].source,
    userId: state.authUser?.uid || null,
    items: getEntityItems(entityKey, state[entityKey]),
    revision: state[entityKey].revision,
    syncedAt: state[entityKey].syncedAt || null,
});

export const useCommerceStore = create((set, get) => {
    const hydrateEntity = async (entityKey, { force = false, mergeGuest = false, authGeneration = null } = {}) => {
        if (activeHydratePromises[entityKey]) {
            return activeHydratePromises[entityKey];
        }

        activeHydratePromises[entityKey] = (async () => {
            const config = getEntityConfig(entityKey);
            const state = get();
            const currentAuthUser = state.authUser;
            const effectiveGeneration = authGeneration ?? state.sync.authGeneration;
            const requestId = `${entityKey}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

            if (!currentAuthUser?.uid) {
                const guestItems = readGuestEntitySnapshot(entityKey);
                const nextEntity = buildEntityState(
                    entityKey,
                    guestItems,
                    'guest',
                    null,
                    [],
                    'ready',
                    null,
                    Date.now(),
                    null,
                );
                updateEntityState(set, entityKey, nextEntity);
                emitCommerceDiagnostic('commerce_hydrate_end', {
                    entity: entityKey,
                    authMode: 'guest',
                    userId: null,
                    revision: null,
                    pendingOps: 0,
                    itemCount: guestItems.length,
                    requestId,
                });
                return guestItems;
            }

            if (!force && (state[entityKey].pendingOps || []).length > 0) {
                return getEntityItems(entityKey, state[entityKey]);
            }

            updateEntityState(set, entityKey, {
                ...state[entityKey],
                source: 'user',
                status: 'hydrating',
                error: null,
            });

            emitCommerceDiagnostic('commerce_hydrate_start', {
                entity: entityKey,
                authMode: 'user',
                userId: currentAuthUser.uid,
                revision: state[entityKey].revision,
                pendingOps: (state[entityKey].pendingOps || []).length,
                requestId,
            });

            try {
                const firebaseUser = getExplicitFirebaseUser(currentAuthUser);
                let payload = extractEntityPayload(
                    entityKey,
                    await config.getSnapshot(firebaseUser),
                    'user',
                );
                const persistedAuthSnapshot = readPersistedAuthEntityState(currentAuthUser, entityKey);

                if (
                    persistedAuthSnapshot
                    && payload.items.length === 0
                    && Number(payload.revision || 0) === 0
                    && persistedAuthSnapshot.items.length > 0
                ) {
                    try {
                        payload = extractEntityPayload(
                            entityKey,
                            await config.syncSnapshot({
                                items: persistedAuthSnapshot.items,
                                expectedRevision: payload.revision,
                                firebaseUser,
                            }),
                            'user',
                        );
                    } catch (error) {
                        const conflictPayload = extractConflictPayload(entityKey, error);
                        if (!conflictPayload) {
                            throw error;
                        }
                        payload = conflictPayload;
                    }
                }

                if (mergeGuest) {
                    const guestItems = readGuestEntitySnapshot(entityKey);
                    if (guestItems.length > 0) {
                        try {
                            payload = extractEntityPayload(
                                entityKey,
                                await config.mergeSnapshot({
                                    items: guestItems,
                                    expectedRevision: payload.revision,
                                    firebaseUser,
                                }),
                                'user',
                            );
                        } catch (error) {
                            const conflictPayload = extractConflictPayload(entityKey, error);
                            if (!conflictPayload) {
                                throw error;
                            }

                            payload = extractEntityPayload(
                                entityKey,
                                await config.mergeSnapshot({
                                    items: guestItems,
                                    expectedRevision: conflictPayload.revision,
                                    firebaseUser,
                                }),
                                'user',
                            );
                        }
                        persistGuestEntitySnapshot(entityKey, []);
                    }
                }

                if (get().sync.authGeneration !== effectiveGeneration || get().authUser?.uid !== currentAuthUser.uid) {
                    emitCommerceDiagnostic('commerce_divergence_detected', {
                        entity: entityKey,
                        authMode: 'user',
                        userId: currentAuthUser.uid,
                        revision: payload.revision,
                        pendingOps: (get()[entityKey].pendingOps || []).length,
                        requestId,
                        reason: 'stale_hydration_ignored',
                    }, 'warn');
                    return getEntityItems(entityKey, get()[entityKey]);
                }

                const nextEntity = buildEntityState(
                    entityKey,
                    payload.items,
                    'user',
                    payload.revision,
                    [],
                    'ready',
                    null,
                    Date.now(),
                    payload.syncedAt,
                );
                updateEntityState(set, entityKey, nextEntity);

                emitCommerceDiagnostic('commerce_hydrate_end', {
                    entity: entityKey,
                    authMode: 'user',
                    userId: currentAuthUser.uid,
                    revision: payload.revision,
                    pendingOps: 0,
                    itemCount: payload.items.length,
                    requestId,
                });

                broadcastEntitySnapshot(getCanonicalSnapshotForBroadcast(get(), entityKey));
                return payload.items;
            } catch (error) {
                if (get().sync.authGeneration !== effectiveGeneration || get().authUser?.uid !== currentAuthUser.uid) {
                    return getEntityItems(entityKey, get()[entityKey]);
                }

                updateEntityState(set, entityKey, {
                    ...get()[entityKey],
                    source: 'user',
                    status: 'error',
                    error: error?.message || `Unable to hydrate ${entityKey}`,
                });

                emitCommerceDiagnostic('commerce_hydrate_end', {
                    entity: entityKey,
                    authMode: 'user',
                    userId: currentAuthUser.uid,
                    revision: get()[entityKey].revision,
                    pendingOps: (get()[entityKey].pendingOps || []).length,
                    itemCount: getEntityItems(entityKey, get()[entityKey]).length,
                    requestId,
                    error: error?.message || `Unable to hydrate ${entityKey}`,
                }, 'error');
                throw error;
            } finally {
                activeHydratePromises[entityKey] = null;
            }
        })();

        return activeHydratePromises[entityKey];
    };

    const refreshEntityIfStale = async (entityKey, { force = false } = {}) => {
        const state = get();
        if ((state[entityKey].pendingOps || []).length > 0) {
            return getEntityItems(entityKey, state[entityKey]);
        }
        if (!state.authUser?.uid) {
            return hydrateEntity(entityKey, { force: true });
        }
        if (!force && state[entityKey].lastHydratedAt && (Date.now() - state[entityKey].lastHydratedAt) < getEntityConfig(entityKey).refreshTtl) {
            return getEntityItems(entityKey, state[entityKey]);
        }
        return hydrateEntity(entityKey, { force: true });
    };

    const enqueueEntityOp = async (entityKey, op) => {
        const state = get();
        const config = getEntityConfig(entityKey);
        const nextItems = config.applyOp(getEntityItems(entityKey, state[entityKey]), op);
        const nextPendingOps = state.authUser?.uid
            ? [...(state[entityKey].pendingOps || []), clonePendingOp(entityKey, {
                ...op,
                baseRevision: state[entityKey].revision,
            })]
            : [];

        const nextEntity = buildEntityState(
            entityKey,
            nextItems,
            state.authUser?.uid ? 'user' : 'guest',
            state.authUser?.uid ? state[entityKey].revision : null,
            nextPendingOps,
            state.authUser?.uid ? 'syncing' : 'ready',
            null,
            Date.now(),
            state[entityKey].syncedAt || null,
        );

        updateEntityState(set, entityKey, nextEntity);
        emitCommerceDiagnostic('commerce_op_enqueued', {
            entity: entityKey,
            authMode: state.authUser?.uid ? 'user' : 'guest',
            userId: state.authUser?.uid || null,
            revision: state[entityKey].revision,
            baseRevision: state[entityKey].revision,
            pendingOps: nextPendingOps.length,
            op: op.kind,
            productId: op.productId,
        });

        if (state.authUser?.uid) {
            return get().flushPendingOps(entityKey);
        }

        persistGuestEntitySnapshot(entityKey, nextItems);
        broadcastEntitySnapshot(getCanonicalSnapshotForBroadcast(get(), entityKey));
        return nextItems;
    };

    const flushEntityOps = async (entityKey) => {
        if (activeFlushPromises[entityKey]) {
            return activeFlushPromises[entityKey];
        }

        activeFlushPromises[entityKey] = (async () => {
            const config = getEntityConfig(entityKey);

            while (true) {
                const currentState = get();
                const currentEntity = currentState[entityKey];
                const currentOp = currentEntity.pendingOps?.[0];

                if (!currentState.authUser?.uid || !currentOp) {
                    const settledState = get();
                    const settledEntity = settledState[entityKey];
                    if (settledEntity.status !== 'ready') {
                        updateEntityState(set, entityKey, {
                            ...settledEntity,
                            status: 'ready',
                            error: null,
                        });
                    }
                    return getEntityItems(entityKey, get()[entityKey]);
                }

                const expectedRevision = Number(currentEntity.revision || 0);
                const firebaseUser = getExplicitFirebaseUser(currentState.authUser);

                emitCommerceDiagnostic('commerce_sync_start', {
                    entity: entityKey,
                    authMode: 'user',
                    userId: currentState.authUser.uid,
                    revision: expectedRevision,
                    baseRevision: currentOp.baseRevision ?? expectedRevision,
                    pendingOps: currentEntity.pendingOps.length,
                    op: currentOp.kind,
                    productId: currentOp.productId,
                });

                try {
                    const response = await config.commitOp(currentOp, expectedRevision, firebaseUser);
                    if (get().authUser?.uid !== currentState.authUser.uid) {
                        emitCommerceDiagnostic('commerce_divergence_detected', {
                            entity: entityKey,
                            authMode: 'user',
                            userId: currentState.authUser.uid,
                            revision: expectedRevision,
                            baseRevision: currentOp.baseRevision ?? expectedRevision,
                            pendingOps: (get()[entityKey].pendingOps || []).length,
                            op: currentOp.kind,
                            productId: currentOp.productId,
                            reason: 'stale_sync_response_ignored',
                        }, 'warn');
                        return getEntityItems(entityKey, get()[entityKey]);
                    }

                    const stateAfterResponse = get();
                    const currentItems = getEntityItems(entityKey, stateAfterResponse[entityKey]);
                    const nextItems = resolveCommittedItems(entityKey, currentItems, currentOp, response);
                    const remainingOps = stateAfterResponse[entityKey].pendingOps.slice(1);

                    updateEntityState(set, entityKey, buildEntityState(
                        entityKey,
                        nextItems,
                        'user',
                        Number(response?.revision ?? expectedRevision),
                        remainingOps,
                        remainingOps.length > 0 ? 'syncing' : 'ready',
                        null,
                        Date.now(),
                        response?.syncedAt || stateAfterResponse[entityKey].syncedAt || null,
                    ));

                    emitCommerceDiagnostic('commerce_op_commit', {
                        entity: entityKey,
                        authMode: 'user',
                        userId: currentState.authUser.uid,
                        revision: Number(response?.revision ?? expectedRevision),
                        baseRevision: currentOp.baseRevision ?? expectedRevision,
                        pendingOps: remainingOps.length,
                        op: currentOp.kind,
                        productId: currentOp.productId,
                    });

                    broadcastEntitySnapshot(getCanonicalSnapshotForBroadcast(get(), entityKey));
                } catch (error) {
                    const conflictPayload = extractConflictPayload(entityKey, error);
                    if (conflictPayload) {
                        if (get().authUser?.uid !== currentState.authUser.uid) {
                            return getEntityItems(entityKey, get()[entityKey]);
                        }

                        const stateAfterConflict = get();
                        const replayedItems = replayPendingOps(
                            entityKey,
                            conflictPayload.items,
                            stateAfterConflict[entityKey].pendingOps,
                        );

                        updateEntityState(set, entityKey, buildEntityState(
                            entityKey,
                            replayedItems,
                            'user',
                            conflictPayload.revision,
                            stateAfterConflict[entityKey].pendingOps,
                            'syncing',
                            null,
                            Date.now(),
                            conflictPayload.syncedAt,
                        ));

                        emitCommerceDiagnostic('commerce_op_conflict', {
                            entity: entityKey,
                            authMode: 'user',
                            userId: currentState.authUser.uid,
                            revision: conflictPayload.revision,
                            baseRevision: currentOp.baseRevision ?? expectedRevision,
                            pendingOps: stateAfterConflict[entityKey].pendingOps.length,
                            op: currentOp.kind,
                            productId: currentOp.productId,
                        }, 'warn');
                        continue;
                    }

                    const failedState = get();
                    updateEntityState(set, entityKey, {
                        ...failedState[entityKey],
                        status: 'error',
                        error: error?.message || `${entityKey} sync failed`,
                    });

                    emitCommerceDiagnostic('commerce_op_commit', {
                        entity: entityKey,
                        authMode: 'user',
                        userId: currentState.authUser.uid,
                        revision: failedState[entityKey].revision,
                        baseRevision: currentOp.baseRevision ?? expectedRevision,
                        pendingOps: failedState[entityKey].pendingOps.length,
                        op: currentOp.kind,
                        productId: currentOp.productId,
                        error: error?.message || `${entityKey} sync failed`,
                    }, 'error');
                    throw error;
                }
            }
        })().finally(() => {
            activeFlushPromises[entityKey] = null;
        });

        return activeFlushPromises[entityKey];
    };

    return {
        authUser: null,
        cart: createEmptyEntityState('guest'),
        wishlist: createEmptyEntityState('guest'),
        checkoutSession: readPersistedCheckoutSession(),
        sync: createEmptySyncState(),

        receiveExternalSnapshot: (snapshot = {}) => {
            const entityKey = snapshot?.entity;
            if (!entityKey || !['cart', 'wishlist'].includes(entityKey)) return;
            if (snapshot?.originId === tabId) return;

            const currentState = get();
            const currentEntity = currentState[entityKey];
            if ((currentEntity.pendingOps || []).length > 0) {
                return;
            }

            if (snapshot?.source === 'guest' && currentState.authUser?.uid) {
                return;
            }
            if (snapshot?.source === 'user' && snapshot?.userId !== currentState.authUser?.uid) {
                return;
            }

            const extracted = extractEntityPayload(entityKey, {
                items: snapshot?.items || [],
                revision: snapshot?.revision,
                syncedAt: snapshot?.syncedAt,
            }, snapshot?.source || currentEntity.source);

            updateEntityState(set, entityKey, buildEntityState(
                entityKey,
                extracted.items,
                snapshot?.source || currentEntity.source,
                extracted.revision,
                [],
                'ready',
                null,
                Date.now(),
                extracted.syncedAt,
            ));
        },

        bindAuthUser: async (nextAuthUser) => {
            const previousAuthUser = get().authUser;
            const previousUid = previousAuthUser?.uid || null;
            const normalizedAuthUser = normalizeAuthUser(nextAuthUser);
            const nextUid = normalizedAuthUser?.uid || null;

            if (previousUid !== nextUid) {
                const pendingOpCount = (get().cart.pendingOps || []).length + (get().wishlist.pendingOps || []).length;
                if (pendingOpCount > 0) {
                    emitCommerceDiagnostic('commerce_divergence_detected', {
                        entity: 'commerce',
                        authMode: nextUid ? 'user' : 'guest',
                        userId: nextUid,
                        revision: null,
                        pendingOps: pendingOpCount,
                        reason: 'auth_transition_with_pending_ops',
                    }, 'warn');
                }
            }

            set((state) => ({
                authUser: normalizedAuthUser,
                sync: {
                    ...state.sync,
                    authGeneration: previousUid === nextUid
                        ? state.sync.authGeneration
                        : state.sync.authGeneration + 1,
                },
            }));

            if (nextUid) {
                const recoveredCart = readPersistedAuthEntityState(normalizedAuthUser, 'cart');
                const recoveredWishlist = readPersistedAuthEntityState(normalizedAuthUser, 'wishlist');

                if (recoveredCart || recoveredWishlist) {
                    set((state) => ({
                        cart: recoveredCart
                            ? buildEntityState(
                                'cart',
                                recoveredCart.items,
                                'user',
                                recoveredCart.revision,
                                [],
                                'ready',
                                null,
                                recoveredCart.lastHydratedAt || Date.now(),
                                recoveredCart.syncedAt,
                            )
                            : state.cart,
                        wishlist: recoveredWishlist
                            ? buildEntityState(
                                'wishlist',
                                recoveredWishlist.items,
                                'user',
                                recoveredWishlist.revision,
                                [],
                                'ready',
                                null,
                                recoveredWishlist.lastHydratedAt || Date.now(),
                                recoveredWishlist.syncedAt,
                            )
                            : state.wishlist,
                    }));
                }
            }

            if (!nextUid) {
                const nextCart = buildEntityState(
                    'cart',
                    readGuestEntitySnapshot('cart'),
                    'guest',
                    null,
                    [],
                    'ready',
                    null,
                    Date.now(),
                    null,
                );
                const nextWishlist = buildEntityState(
                    'wishlist',
                    readGuestEntitySnapshot('wishlist'),
                    'guest',
                    null,
                    [],
                    'ready',
                    null,
                    Date.now(),
                    null,
                );

                set(() => ({
                    cart: nextCart,
                    wishlist: nextWishlist,
                }));

                emitCommerceDiagnostic('commerce_hydrate_end', {
                    entity: 'commerce',
                    authMode: 'guest',
                    userId: null,
                    revision: null,
                    pendingOps: 0,
                    itemCount: nextCart.orderedIds.length + nextWishlist.orderedIds.length,
                    requestId: `auth-${Date.now()}`,
                });

                return {
                    cart: getEntityItems('cart', nextCart),
                    wishlist: getEntityItems('wishlist', nextWishlist),
                };
            }

            return get().hydrateCommerce({
                force: true,
                mergeGuest: previousUid !== nextUid,
            });
        },

        hydrateCommerce: async ({ force = false, mergeGuest = false } = {}) => {
            if (activeHydratePromises.commerce) {
                return activeHydratePromises.commerce;
            }

            activeHydratePromises.commerce = (async () => {
                const state = get();
                if (!state.authUser?.uid) {
                    return get().bindAuthUser(null);
                }

                const authGeneration = state.sync.authGeneration;
                const [cartItems, wishlistItems] = await Promise.all([
                    hydrateEntity('cart', { force, mergeGuest, authGeneration }),
                    hydrateEntity('wishlist', { force, mergeGuest, authGeneration }),
                ]);

                return {
                    cart: cartItems,
                    wishlist: wishlistItems,
                };
            })().finally(() => {
                activeHydratePromises.commerce = null;
            });

            return activeHydratePromises.commerce;
        },

        hydrateCart: async ({ force = false, mergeGuest = false } = {}) => (
            hydrateEntity('cart', { force, mergeGuest })
        ),

        hydrateWishlist: async ({ force = false, mergeGuest = false } = {}) => (
            hydrateEntity('wishlist', { force, mergeGuest })
        ),

        mergeGuestCart: async () => hydrateEntity('cart', { force: true, mergeGuest: true }),
        mergeGuestWishlist: async () => hydrateEntity('wishlist', { force: true, mergeGuest: true }),

        refreshIfStale: async ({ force = false } = {}) => refreshEntityIfStale('cart', { force }),
        refreshWishlistIfStale: async ({ force = false } = {}) => refreshEntityIfStale('wishlist', { force }),

        addItem: async (product, quantity = 1) => {
            const normalizedQuantity = Math.max(1, Number(quantity || 1));
            const productSnapshot = toCartLineFromProduct(product, normalizedQuantity);
            if (!isValidCartLine(productSnapshot)) return [];

            return enqueueEntityOp('cart', {
                opId: `cart-op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                kind: 'add',
                productId: String(productSnapshot.id),
                quantity: normalizedQuantity,
                productSnapshot,
            });
        },

        setQuantity: async (productId, quantity) => enqueueEntityOp('cart', {
            opId: `cart-op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            kind: 'set',
            productId: String(productId),
            quantity: Math.max(0, Number(quantity || 0)),
            productSnapshot: null,
        }),

        removeItem: async (productId) => enqueueEntityOp('cart', {
            opId: `cart-op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            kind: 'remove',
            productId: String(productId),
            quantity: 0,
            productSnapshot: null,
        }),

        addWishlistItem: async (product) => {
            const productSnapshot = toWishlistLineFromProduct(product);
            if (!isValidWishlistLine(productSnapshot)) return [];

            return enqueueEntityOp('wishlist', {
                opId: `wishlist-op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                kind: 'add',
                productId: String(productSnapshot.id),
                quantity: 1,
                productSnapshot,
            });
        },

        removeWishlistItem: async (productId) => enqueueEntityOp('wishlist', {
            opId: `wishlist-op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            kind: 'remove',
            productId: String(productId),
            quantity: 0,
            productSnapshot: null,
        }),

        toggleWishlistItem: (product) => {
            const productId = Number(product?.id || product?._id || 0);
            const exists = getEntityItems('wishlist', get().wishlist)
                .some((item) => Number(item.id) === productId);

            if (exists) {
                void get().removeWishlistItem(productId);
                return false;
            }

            void get().addWishlistItem(product);
            return true;
        },

        moveCartItemToWishlist: async (productId) => {
            const cartItem = getEntityItems('cart', get().cart)
                .find((item) => Number(item.id) === Number(productId));
            if (!cartItem) return false;

            const alreadyWishlisted = getEntityItems('wishlist', get().wishlist)
                .some((item) => Number(item.id) === Number(productId));

            await get().addWishlistItem(cartItem);
            try {
                await get().removeItem(productId);
                return true;
            } catch (error) {
                if (!alreadyWishlisted) {
                    await get().removeWishlistItem(productId).catch(() => {});
                }
                throw error;
            }
        },

        moveWishlistItemToCart: async (productId) => {
            const wishlistItem = getEntityItems('wishlist', get().wishlist)
                .find((item) => Number(item.id) === Number(productId));
            if (!wishlistItem) return false;

            const previousCartItem = getEntityItems('cart', get().cart)
                .find((item) => Number(item.id) === Number(productId));
            const previousQuantity = Math.max(0, Number(previousCartItem?.quantity || 0));

            await get().addItem(wishlistItem, 1);
            try {
                await get().removeWishlistItem(productId);
                return true;
            } catch (error) {
                if (previousCartItem) {
                    await get().setQuantity(productId, previousQuantity).catch(() => {});
                } else {
                    await get().removeItem(productId).catch(() => {});
                }
                throw error;
            }
        },

        clearCart: ({ incrementRevision = false } = {}) => {
            const state = get();
            const nextCart = buildEntityState(
                'cart',
                [],
                state.authUser?.uid ? 'user' : 'guest',
                state.authUser?.uid
                    ? Number(state.cart.revision || 0) + (incrementRevision ? 1 : 0)
                    : null,
                [],
                'ready',
                null,
                Date.now(),
                state.cart.syncedAt,
            );

            updateEntityState(set, 'cart', nextCart);

            if (!state.authUser?.uid) {
                persistGuestEntitySnapshot('cart', []);
            }

            broadcastEntitySnapshot(getCanonicalSnapshotForBroadcast(get(), 'cart'));
        },

        clearWishlist: async () => {
            const state = get();
            const nextWishlist = buildEntityState(
                'wishlist',
                [],
                state.authUser?.uid ? 'user' : 'guest',
                state.authUser?.uid ? state.wishlist.revision : null,
                [],
                state.authUser?.uid ? 'syncing' : 'ready',
                null,
                Date.now(),
                state.wishlist.syncedAt,
            );
            updateEntityState(set, 'wishlist', nextWishlist);

            if (!state.authUser?.uid) {
                persistGuestEntitySnapshot('wishlist', []);
                broadcastEntitySnapshot(getCanonicalSnapshotForBroadcast(get(), 'wishlist'));
                return [];
            }

            try {
                const firebaseUser = getExplicitFirebaseUser(state.authUser);
                const payload = extractEntityPayload(
                    'wishlist',
                    await getEntityConfig('wishlist').syncSnapshot({
                        items: [],
                        expectedRevision: Number(state.wishlist.revision || 0),
                        firebaseUser,
                    }),
                    'user',
                );

                updateEntityState(set, 'wishlist', buildEntityState(
                    'wishlist',
                    payload.items,
                    'user',
                    payload.revision,
                    [],
                    'ready',
                    null,
                    Date.now(),
                    payload.syncedAt,
                ));
                broadcastEntitySnapshot(getCanonicalSnapshotForBroadcast(get(), 'wishlist'));
                return payload.items;
            } catch (error) {
                const conflictPayload = extractConflictPayload('wishlist', error);
                if (conflictPayload) {
                    updateEntityState(set, 'wishlist', buildEntityState(
                        'wishlist',
                        conflictPayload.items,
                        'user',
                        conflictPayload.revision,
                        [],
                        'ready',
                        null,
                        Date.now(),
                        conflictPayload.syncedAt,
                    ));
                    broadcastEntitySnapshot(getCanonicalSnapshotForBroadcast(get(), 'wishlist'));
                    return conflictPayload.items;
                }

                updateEntityState(set, 'wishlist', {
                    ...get().wishlist,
                    status: 'error',
                    error: error?.message || 'Wishlist sync failed',
                });
                throw error;
            }
        },

        flushPendingOps: async (entityKey = 'cart') => {
            if (entityKey === 'all') {
                await flushEntityOps('cart');
                return flushEntityOps('wishlist');
            }
            return flushEntityOps(entityKey);
        },

        startDirectBuy: (product, quantity = 1) => {
            const directBuyItem = toCartLineFromProduct(product, quantity);
            if (!isValidCartLine(directBuyItem)) return;

            const nextSession = {
                source: 'direct-buy',
                directBuy: {
                    productId: String(directBuyItem.id),
                    quantity: directBuyItem.quantity,
                    item: directBuyItem,
                },
            };

            persistCheckoutSession(nextSession);
            set(() => ({
                checkoutSession: nextSession,
            }));
        },

        clearDirectBuy: () => {
            persistCheckoutSession(createEmptyCheckoutSession());
            set(() => ({
                checkoutSession: createEmptyCheckoutSession(),
            }));
        },
    };
});

export const initializeCommerceSync = () => {
    const windowRef = getWindowRef();
    if (!windowRef || commerceSyncInitialized) {
        return commerceSyncCleanup || (() => {});
    }

    commerceSyncInitialized = true;

    if (typeof windowRef.BroadcastChannel === 'function') {
        commerceBroadcastChannel = new windowRef.BroadcastChannel(COMMERCE_SYNC_CHANNEL);
        commerceBroadcastChannel.onmessage = (event) => {
            useCommerceStore.getState().receiveExternalSnapshot(event?.data || {});
        };
    }

    const handleStorage = (event) => {
        if (!event) return;

        if (event.key === GUEST_CART_STORAGE_KEY && !useCommerceStore.getState().authUser?.uid) {
            useCommerceStore.getState().receiveExternalSnapshot({
                entity: 'cart',
                source: 'guest',
                userId: null,
                items: readGuestEntitySnapshot('cart'),
                revision: null,
                syncedAt: new Date().toISOString(),
            });
            return;
        }

        if (event.key === GUEST_WISHLIST_STORAGE_KEY && !useCommerceStore.getState().authUser?.uid) {
            useCommerceStore.getState().receiveExternalSnapshot({
                entity: 'wishlist',
                source: 'guest',
                userId: null,
                items: readGuestEntitySnapshot('wishlist'),
                revision: null,
                syncedAt: new Date().toISOString(),
            });
            return;
        }

        if (event.key === COMMERCE_SYNC_STORAGE_KEY && event.newValue) {
            useCommerceStore.getState().receiveExternalSnapshot(safeParse(event.newValue) || {});
        }
    };

    const handleBeforeUnload = (event) => {
        const state = useCommerceStore.getState();
        const pendingOps = (state.cart.pendingOps || []).length + (state.wishlist.pendingOps || []).length;
        if (pendingOps <= 0) return;

        event.preventDefault();
        event.returnValue = '';
    };

    windowRef.addEventListener('storage', handleStorage);
    windowRef.addEventListener('beforeunload', handleBeforeUnload);

    commerceSyncCleanup = () => {
        windowRef.removeEventListener('storage', handleStorage);
        windowRef.removeEventListener('beforeunload', handleBeforeUnload);
        if (commerceBroadcastChannel) {
            commerceBroadcastChannel.close();
            commerceBroadcastChannel = null;
        }
        commerceSyncInitialized = false;
        commerceSyncCleanup = null;
    };

    return commerceSyncCleanup;
};

export const selectCartItems = (state) => getEntityItems('cart', state.cart);
export const selectCartSummary = (state) => buildCartSummary(getEntityItems('cart', state.cart));
export const selectCartLoading = (state) => state.cart.status === 'idle' || state.cart.status === 'hydrating';
export const selectWishlistItems = (state) => getEntityItems('wishlist', state.wishlist);
export const selectWishlistLoading = (state) => state.wishlist.status === 'idle' || state.wishlist.status === 'hydrating';
export const selectWishlistCount = (state) => getEntityItems('wishlist', state.wishlist).length;

export const resetCommerceStoreForTests = () => {
    useCommerceStore.setState({
        authUser: null,
        cart: createEmptyEntityState('guest'),
        wishlist: createEmptyEntityState('guest'),
        checkoutSession: createEmptyCheckoutSession(),
        sync: createEmptySyncState(),
    });

    persistCheckoutSession(createEmptyCheckoutSession());
    persistGuestEntitySnapshot('cart', []);
    persistGuestEntitySnapshot('wishlist', []);
    activeFlushPromises.cart = null;
    activeFlushPromises.wishlist = null;
    activeHydratePromises.cart = null;
    activeHydratePromises.wishlist = null;
    activeHydratePromises.commerce = null;
};

useCommerceStore.subscribe((state) => {
    if (!state?.authUser?.uid) {
        return;
    }

    persistAuthenticatedEntityState(state.authUser, 'cart', state.cart);
    persistAuthenticatedEntityState(state.authUser, 'wishlist', state.wishlist);
});
