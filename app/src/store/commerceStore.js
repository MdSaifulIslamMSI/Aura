import { create } from 'zustand';
import { pushClientDiagnostic } from '../services/clientObservability';
import { userApi } from '../services/api';

export const GUEST_CART_STORAGE_KEY = 'aura_cart_guest_v2';
const COMMERCE_SYNC_STORAGE_KEY = 'aura_commerce_sync_v1';
const COMMERCE_SYNC_CHANNEL = 'aura-commerce-sync';
const COMMERCE_CHECKOUT_SESSION_KEY = 'aura_checkout_session_v1';
const CART_REFRESH_TTL_MS = 45 * 1000;
const tabId = `commerce-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

let commerceBroadcastChannel = null;
let commerceSyncInitialized = false;
let commerceSyncCleanup = null;
let activeFlushPromise = null;

const getWindowRef = () => (typeof window !== 'undefined' ? window : null);

const createEmptyCartState = (source = 'guest') => ({
    itemsById: {},
    orderedIds: [],
    revision: source === 'user' ? 0 : null,
    status: 'idle',
    source,
    pendingOps: [],
    lastHydratedAt: null,
    error: null,
});

const createEmptyCheckoutSession = () => ({
    source: 'cart',
    directBuy: null,
});

const readPersistedCheckoutSession = () => {
    const windowRef = getWindowRef();
    if (!windowRef?.sessionStorage) {
        return createEmptyCheckoutSession();
    }

    let parsed = null;
    try {
        parsed = safeParse(windowRef.sessionStorage.getItem(COMMERCE_CHECKOUT_SESSION_KEY));
    } catch {
        return createEmptyCheckoutSession();
    }
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
    if (!windowRef?.sessionStorage) {
        return;
    }

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
        // Ignore storage failures and keep checkout intent in memory.
    }
};

const safeParse = (value) => {
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const normalizeCartLine = (item = {}) => {
    const id = Number(item?.id || item?.productId || 0);
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
    };
};

const isValidCartLine = (item) => Number.isFinite(Number(item?.id)) && Number(item.id) > 0;

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

const cartLinesToState = (items = [], source = 'guest', revision = null, pendingOps = [], status = 'ready', error = null, lastHydratedAt = Date.now()) => {
    const itemsById = {};
    const orderedIds = [];

    (Array.isArray(items) ? items : []).forEach((item) => {
        const normalized = normalizeCartLine(item);
        if (!isValidCartLine(normalized)) return;
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
        error,
    };
};

const getCartItemsFromCartState = (cart = {}) => (
    (cart?.orderedIds || [])
        .map((id) => cart?.itemsById?.[id])
        .filter(Boolean)
);

const buildCartSummary = (items = []) => items.reduce((acc, item) => {
    const price = Number(item?.price || 0);
    const originalPrice = Number(item?.originalPrice || 0);
    const quantity = Number(item?.quantity || 1);
    const itemTotal = price * quantity;
    const itemOriginalTotal = originalPrice > price ? originalPrice * quantity : itemTotal;

    acc.totalPrice += itemTotal;
    acc.totalOriginalPrice += itemOriginalTotal;
    acc.totalDiscount += itemOriginalTotal - itemTotal;
    acc.totalItems += quantity;
    acc.itemCount += 1;
    return acc;
}, {
    totalPrice: 0,
    totalOriginalPrice: 0,
    totalDiscount: 0,
    totalItems: 0,
    itemCount: 0,
});

const clonePendingOp = (op = {}) => ({
    ...op,
    productSnapshot: op?.productSnapshot ? normalizeCartLine(op.productSnapshot) : null,
});

const serializeCartSnapshot = (items = []) => JSON.stringify((items || []).map((item) => normalizeCartLine(item)));

const readGuestCartSnapshot = () => {
    const windowRef = getWindowRef();
    if (!windowRef?.localStorage) return [];
    const parsed = safeParse(windowRef.localStorage.getItem(GUEST_CART_STORAGE_KEY));
    return Array.isArray(parsed)
        ? parsed.map((item) => normalizeCartLine(item)).filter(isValidCartLine)
        : [];
};

const persistGuestCartSnapshot = (items = []) => {
    const windowRef = getWindowRef();
    if (!windowRef?.localStorage) return;

    const normalizedItems = (items || []).map((item) => normalizeCartLine(item)).filter(isValidCartLine);
    if (normalizedItems.length === 0) {
        windowRef.localStorage.removeItem(GUEST_CART_STORAGE_KEY);
        return;
    }
    windowRef.localStorage.setItem(GUEST_CART_STORAGE_KEY, serializeCartSnapshot(normalizedItems));
};

const extractCartPayload = (payload = {}, source = 'user') => {
    const items = Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.cart)
            ? payload.cart
            : [];

    return {
        items: items.map((item) => normalizeCartLine(item)).filter(isValidCartLine),
        revision: source === 'user' ? Number(payload?.revision ?? 0) : null,
        syncedAt: payload?.syncedAt || null,
    };
};

const extractConflictPayload = (error) => {
    if (Number(error?.status || 0) !== 409) return null;
    const data = error?.data || {};
    if (!Array.isArray(data?.items)) return null;
    return extractCartPayload(data, 'user');
};

const applyOptimisticOp = (items = [], op = {}) => {
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

const replayPendingOps = (items = [], pendingOps = []) => (
    pendingOps.reduce((acc, op) => applyOptimisticOp(acc, op), items)
);

const emitCartDiagnostic = (type, context = {}, severity = 'info') => {
    pushClientDiagnostic(type, {
        context: {
            deviceClass: typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)')?.matches ? 'mobile' : 'desktop',
            ...context,
        },
    }, severity);
};

const broadcastCartSnapshot = (snapshot = {}) => {
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
        // Ignore cross-tab fallback failures.
    }
};

const getCanonicalSnapshotForBroadcast = (state) => ({
    source: state.cart.source,
    userId: state.authUser?.uid || null,
    items: getCartItemsFromCartState(state.cart),
    revision: state.cart.revision,
    syncedAt: state.cart.lastHydratedAt ? new Date(state.cart.lastHydratedAt).toISOString() : null,
});

const updateCartState = (set, nextCart) => set(() => ({ cart: nextCart }));

export const useCommerceStore = create((set, get) => ({
    authUser: null,
    cart: createEmptyCartState('guest'),
    checkoutSession: readPersistedCheckoutSession(),

    receiveExternalSnapshot: (snapshot = {}) => {
        const currentState = get();
        if (snapshot?.originId === tabId) return;
        if ((currentState.cart.pendingOps || []).length > 0) return;

        if (snapshot?.source === 'guest' && currentState.authUser?.uid) {
            return;
        }
        if (snapshot?.source === 'user' && snapshot?.userId !== currentState.authUser?.uid) {
            return;
        }

        const extracted = extractCartPayload({
            items: snapshot?.items || [],
            revision: snapshot?.revision,
            syncedAt: snapshot?.syncedAt,
        }, snapshot?.source || currentState.cart.source);

        updateCartState(set, cartLinesToState(
            extracted.items,
            snapshot?.source || currentState.cart.source,
            extracted.revision,
            [],
            'ready',
            null,
            Date.now(),
        ));
    },

    bindAuthUser: async (nextAuthUser) => {
        const previousAuthUser = get().authUser;
        const previousUid = previousAuthUser?.uid || null;
        const nextUid = nextAuthUser?.uid || null;

        set(() => ({
            authUser: nextUid ? { uid: nextUid, email: nextAuthUser?.email || '' } : null,
        }));

        if (!nextUid) {
            const guestItems = readGuestCartSnapshot();
            updateCartState(set, cartLinesToState(
                guestItems,
                'guest',
                null,
                [],
                'ready',
                null,
                Date.now(),
            ));
            emitCartDiagnostic('cart_hydrate', {
                authMode: 'guest',
                revision: null,
                pendingOps: 0,
                itemCount: guestItems.length,
            });
            return guestItems;
        }

        return get().hydrateCart({ force: true, mergeGuest: previousUid !== nextUid });
    },

    mergeGuestCart: async () => get().hydrateCart({ force: true, mergeGuest: true }),

    hydrateCart: async ({ force = false, mergeGuest = false } = {}) => {
        const state = get();

        if (!state.authUser?.uid) {
            const guestItems = readGuestCartSnapshot();
            updateCartState(set, cartLinesToState(
                guestItems,
                'guest',
                null,
                [],
                'ready',
                null,
                Date.now(),
            ));
            emitCartDiagnostic('cart_hydrate', {
                authMode: 'guest',
                revision: null,
                pendingOps: 0,
                itemCount: guestItems.length,
            });
            return guestItems;
        }

        if (!force && (state.cart.pendingOps || []).length > 0) {
            return getCartItemsFromCartState(state.cart);
        }

        updateCartState(set, {
            ...state.cart,
            source: 'user',
            status: 'hydrating',
            error: null,
        });

        try {
            let payload = extractCartPayload(await userApi.getCart(), 'user');

            if (mergeGuest) {
                const guestItems = readGuestCartSnapshot();
                if (guestItems.length > 0) {
                    try {
                        payload = extractCartPayload(
                            await userApi.mergeCart({ items: guestItems, expectedRevision: payload.revision }),
                            'user',
                        );
                    } catch (error) {
                        const conflictPayload = extractConflictPayload(error);
                        if (conflictPayload) {
                            payload = extractCartPayload(
                                await userApi.mergeCart({ items: guestItems, expectedRevision: conflictPayload.revision }),
                                'user',
                            );
                        } else {
                            throw error;
                        }
                    }
                    persistGuestCartSnapshot([]);
                }
            }

            const nextCart = cartLinesToState(
                payload.items,
                'user',
                payload.revision,
                [],
                'ready',
                null,
                Date.now(),
            );
            updateCartState(set, nextCart);

            emitCartDiagnostic('cart_hydrate', {
                authMode: 'user',
                revision: payload.revision,
                pendingOps: 0,
                itemCount: payload.items.length,
            });
            broadcastCartSnapshot(getCanonicalSnapshotForBroadcast(get()));
            return payload.items;
        } catch (error) {
            updateCartState(set, {
                ...get().cart,
                source: 'user',
                status: 'error',
                error: error?.message || 'Unable to hydrate cart',
            });
            emitCartDiagnostic('cart_hydrate', {
                authMode: 'user',
                revision: get().cart.revision,
                pendingOps: (get().cart.pendingOps || []).length,
                itemCount: getCartItemsFromCartState(get().cart).length,
                error: error?.message || 'Unable to hydrate cart',
            }, 'error');
            throw error;
        }
    },

    refreshIfStale: async ({ force = false } = {}) => {
        const state = get();
        if ((state.cart.pendingOps || []).length > 0) {
            return getCartItemsFromCartState(state.cart);
        }
        if (!state.authUser?.uid) {
            return get().hydrateCart({ force: true });
        }
        if (!force && state.cart.lastHydratedAt && (Date.now() - state.cart.lastHydratedAt) < CART_REFRESH_TTL_MS) {
            return getCartItemsFromCartState(state.cart);
        }
        return get().hydrateCart({ force: true });
    },

    addItem: async (product, quantity = 1) => {
        const normalizedQuantity = Math.max(1, Number(quantity || 1));
        const productSnapshot = toCartLineFromProduct(product, normalizedQuantity);
        if (!isValidCartLine(productSnapshot)) return;

        const op = {
            opId: `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            kind: 'add',
            productId: String(productSnapshot.id),
            quantity: normalizedQuantity,
            productSnapshot,
        };

        const state = get();
        const nextItems = applyOptimisticOp(getCartItemsFromCartState(state.cart), op);
        const nextPendingOps = state.authUser?.uid
            ? [...(state.cart.pendingOps || []), clonePendingOp(op)]
            : [];
        const nextCart = cartLinesToState(
            nextItems,
            state.authUser?.uid ? 'user' : 'guest',
            state.authUser?.uid ? state.cart.revision : null,
            nextPendingOps,
            state.authUser?.uid ? 'syncing' : 'ready',
            null,
            Date.now(),
        );

        updateCartState(set, nextCart);
        emitCartDiagnostic('cart_op_enqueued', {
            authMode: state.authUser?.uid ? 'user' : 'guest',
            revision: state.cart.revision,
            pendingOps: nextPendingOps.length,
            op: op.kind,
            productId: op.productId,
        });

        if (state.authUser?.uid) {
            return get().flushPendingOps();
        }

        persistGuestCartSnapshot(nextItems);
        broadcastCartSnapshot(getCanonicalSnapshotForBroadcast(get()));
        return nextItems;
    },

    setQuantity: async (productId, quantity) => {
        const op = {
            opId: `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            kind: 'set',
            productId: String(productId),
            quantity: Math.max(0, Number(quantity || 0)),
            productSnapshot: null,
        };

        const state = get();
        const nextItems = applyOptimisticOp(getCartItemsFromCartState(state.cart), op);
        const nextPendingOps = state.authUser?.uid
            ? [...(state.cart.pendingOps || []), clonePendingOp(op)]
            : [];
        const nextCart = cartLinesToState(
            nextItems,
            state.authUser?.uid ? 'user' : 'guest',
            state.authUser?.uid ? state.cart.revision : null,
            nextPendingOps,
            state.authUser?.uid ? 'syncing' : 'ready',
            null,
            Date.now(),
        );

        updateCartState(set, nextCart);
        emitCartDiagnostic('cart_op_enqueued', {
            authMode: state.authUser?.uid ? 'user' : 'guest',
            revision: state.cart.revision,
            pendingOps: nextPendingOps.length,
            op: op.kind,
            productId: op.productId,
        });

        if (state.authUser?.uid) {
            return get().flushPendingOps();
        }

        persistGuestCartSnapshot(nextItems);
        broadcastCartSnapshot(getCanonicalSnapshotForBroadcast(get()));
        return nextItems;
    },

    removeItem: async (productId) => {
        const op = {
            opId: `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            kind: 'remove',
            productId: String(productId),
            quantity: 0,
            productSnapshot: null,
        };

        const state = get();
        const nextItems = applyOptimisticOp(getCartItemsFromCartState(state.cart), op);
        const nextPendingOps = state.authUser?.uid
            ? [...(state.cart.pendingOps || []), clonePendingOp(op)]
            : [];
        const nextCart = cartLinesToState(
            nextItems,
            state.authUser?.uid ? 'user' : 'guest',
            state.authUser?.uid ? state.cart.revision : null,
            nextPendingOps,
            state.authUser?.uid ? 'syncing' : 'ready',
            null,
            Date.now(),
        );

        updateCartState(set, nextCart);
        emitCartDiagnostic('cart_op_enqueued', {
            authMode: state.authUser?.uid ? 'user' : 'guest',
            revision: state.cart.revision,
            pendingOps: nextPendingOps.length,
            op: op.kind,
            productId: op.productId,
        });

        if (state.authUser?.uid) {
            return get().flushPendingOps();
        }

        persistGuestCartSnapshot(nextItems);
        broadcastCartSnapshot(getCanonicalSnapshotForBroadcast(get()));
        return nextItems;
    },

    clearCart: ({ incrementRevision = false } = {}) => {
        const state = get();
        const nextCart = cartLinesToState(
            [],
            state.authUser?.uid ? 'user' : 'guest',
            state.authUser?.uid
                ? Number(state.cart.revision || 0) + (incrementRevision ? 1 : 0)
                : null,
            [],
            'ready',
            null,
            Date.now(),
        );

        updateCartState(set, nextCart);

        if (state.authUser?.uid) {
            broadcastCartSnapshot(getCanonicalSnapshotForBroadcast(get()));
            return;
        }

        persistGuestCartSnapshot([]);
        broadcastCartSnapshot(getCanonicalSnapshotForBroadcast(get()));
    },

    flushPendingOps: async () => {
        if (activeFlushPromise) return activeFlushPromise;

        activeFlushPromise = (async () => {
            while (true) {
                const currentState = get();
                const currentOp = currentState.cart.pendingOps?.[0];

                if (!currentState.authUser?.uid || !currentOp) {
                    const settledState = get();
                    if (settledState.cart.status !== 'ready') {
                        updateCartState(set, {
                            ...settledState.cart,
                            status: 'ready',
                            error: null,
                        });
                    }
                    return getCartItemsFromCartState(get().cart);
                }

                const expectedRevision = Number(currentState.cart.revision || 0);
                emitCartDiagnostic('cart_sync_start', {
                    authMode: 'user',
                    revision: expectedRevision,
                    pendingOps: currentState.cart.pendingOps.length,
                    op: currentOp.kind,
                    productId: currentOp.productId,
                });

                try {
                    let response;
                    if (currentOp.kind === 'add') {
                        response = await userApi.addCartItem({
                            productId: Number(currentOp.productId),
                            quantity: currentOp.quantity,
                            expectedRevision,
                        });
                    } else if (currentOp.kind === 'set') {
                        response = await userApi.setCartItemQuantity({
                            productId: Number(currentOp.productId),
                            quantity: currentOp.quantity,
                            expectedRevision,
                        });
                    } else {
                        response = await userApi.removeCartItem({
                            productId: Number(currentOp.productId),
                            expectedRevision,
                        });
                    }

                    const stateAfterResponse = get();
                    const items = getCartItemsFromCartState(stateAfterResponse.cart);
                    const nextItems = (() => {
                        if (currentOp.kind === 'remove') {
                            return items.filter((item) => String(item.id) !== String(currentOp.productId));
                        }
                        if (response?.item) {
                            const normalizedItem = normalizeCartLine(response.item);
                            const hasItem = items.some((item) => String(item.id) === String(normalizedItem.id));
                            if (hasItem) {
                                return items.map((item) => (String(item.id) === String(normalizedItem.id) ? normalizedItem : item));
                            }
                            return [...items, normalizedItem];
                        }
                        if (currentOp.kind === 'set' && Number(currentOp.quantity || 0) === 0) {
                            return items.filter((item) => String(item.id) !== String(currentOp.productId));
                        }
                        return items;
                    })();

                    const remainingOps = stateAfterResponse.cart.pendingOps.slice(1);
                    updateCartState(set, cartLinesToState(
                        nextItems,
                        'user',
                        Number(response?.revision ?? expectedRevision),
                        remainingOps,
                        remainingOps.length > 0 ? 'syncing' : 'ready',
                        null,
                        Date.now(),
                    ));

                    emitCartDiagnostic('cart_sync_commit', {
                        authMode: 'user',
                        revision: Number(response?.revision ?? expectedRevision),
                        pendingOps: remainingOps.length,
                        op: currentOp.kind,
                        productId: currentOp.productId,
                    });
                    broadcastCartSnapshot(getCanonicalSnapshotForBroadcast(get()));
                } catch (error) {
                    const conflictPayload = extractConflictPayload(error);
                    if (conflictPayload) {
                        const stateAfterConflict = get();
                        const replayedItems = replayPendingOps(conflictPayload.items, stateAfterConflict.cart.pendingOps);
                        updateCartState(set, cartLinesToState(
                            replayedItems,
                            'user',
                            conflictPayload.revision,
                            stateAfterConflict.cart.pendingOps,
                            'syncing',
                            null,
                            Date.now(),
                        ));
                        emitCartDiagnostic('cart_sync_conflict', {
                            authMode: 'user',
                            revision: conflictPayload.revision,
                            pendingOps: stateAfterConflict.cart.pendingOps.length,
                            op: currentOp.kind,
                            productId: currentOp.productId,
                        }, 'warn');
                        emitCartDiagnostic('cart_sync_replay', {
                            authMode: 'user',
                            revision: conflictPayload.revision,
                            pendingOps: stateAfterConflict.cart.pendingOps.length,
                            itemCount: replayedItems.length,
                        }, 'warn');
                        continue;
                    }

                    const failedState = get();
                    updateCartState(set, {
                        ...failedState.cart,
                        status: 'error',
                        error: error?.message || 'Cart sync failed',
                    });
                    emitCartDiagnostic('cart_sync_commit', {
                        authMode: 'user',
                        revision: failedState.cart.revision,
                        pendingOps: failedState.cart.pendingOps.length,
                        op: currentOp.kind,
                        productId: currentOp.productId,
                        error: error?.message || 'Cart sync failed',
                    }, 'error');
                    throw error;
                }
            }
        })().finally(() => {
            activeFlushPromise = null;
        });

        return activeFlushPromise;
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
}));

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
                source: 'guest',
                userId: null,
                items: readGuestCartSnapshot(),
                revision: null,
                syncedAt: new Date().toISOString(),
            });
            return;
        }

        if (event.key === COMMERCE_SYNC_STORAGE_KEY && event.newValue) {
            useCommerceStore.getState().receiveExternalSnapshot(safeParse(event.newValue) || {});
        }
    };

    windowRef.addEventListener('storage', handleStorage);

    commerceSyncCleanup = () => {
        windowRef.removeEventListener('storage', handleStorage);
        if (commerceBroadcastChannel) {
            commerceBroadcastChannel.close();
            commerceBroadcastChannel = null;
        }
        commerceSyncInitialized = false;
        commerceSyncCleanup = null;
    };

    return commerceSyncCleanup;
};

export const selectCartItems = (state) => getCartItemsFromCartState(state.cart);
export const selectCartSummary = (state) => buildCartSummary(getCartItemsFromCartState(state.cart));
export const selectCartLoading = (state) => state.cart.status === 'idle' || state.cart.status === 'hydrating';

export const resetCommerceStoreForTests = () => {
    useCommerceStore.setState({
        authUser: null,
        cart: createEmptyCartState('guest'),
        checkoutSession: createEmptyCheckoutSession(),
    });
    persistCheckoutSession(createEmptyCheckoutSession());
    activeFlushPromise = null;
};
