const Cart = require('../models/Cart');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const { buildProductImageDeliveryUrl } = require('./productImageResolver');
const { buildDisplayPair } = require('./markets/marketPricing');

const MAX_RECENT_MUTATIONS = 25;
const PRODUCT_FIELDS = 'id title price originalPrice discountPercentage image stock brand';

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const applySession = (query, session = null) => (session ? query.session(session) : query);

const parseExpectedVersion = (value, fieldName = 'expectedVersion') => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new AppError(`${fieldName} must be a non-negative integer`, 400);
    }
    return parsed;
};

const parseProductId = (value, fieldName = 'productId') => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new AppError(`${fieldName} must be a positive integer`, 400);
    }
    return parsed;
};

const parseQuantity = (value, fieldName = 'quantity', { allowZero = false } = {}) => {
    const parsed = Number(value);
    const min = allowZero ? 0 : 1;
    if (!Number.isInteger(parsed) || parsed < min) {
        throw new AppError(`${fieldName} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`, 400);
    }
    return parsed;
};

const normalizeStoredCartItems = (items = []) => {
    const merged = new Map();
    const orderedIds = [];

    (Array.isArray(items) ? items : []).forEach((item) => {
        const productId = Number(item?.productId ?? item?.id);
        const quantity = Number(item?.quantity ?? item?.qty ?? 1);
        if (!Number.isInteger(productId) || productId <= 0) return;
        if (!Number.isInteger(quantity) || quantity <= 0) return;

        if (!merged.has(productId)) {
            orderedIds.push(productId);
            merged.set(productId, {
                productId,
                quantity,
            });
            return;
        }

        merged.get(productId).quantity += quantity;
    });

    return orderedIds.map((productId) => merged.get(productId));
};

const cloneStoredCartItems = (items = []) => normalizeStoredCartItems(items).map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
}));

const storedItemsEqual = (left = [], right = []) => JSON.stringify(
    normalizeStoredCartItems(left)
) === JSON.stringify(normalizeStoredCartItems(right));

const appendRecentMutation = (recentMutations = [], mutationId = '') => {
    const normalizedMutationId = String(mutationId || '').trim();
    if (!normalizedMutationId) {
        return Array.isArray(recentMutations) ? recentMutations : [];
    }

    const next = (Array.isArray(recentMutations) ? recentMutations : [])
        .filter((entry) => String(entry?.id || '').trim() !== normalizedMutationId)
        .map((entry) => ({
            id: String(entry?.id || '').trim(),
            appliedAt: entry?.appliedAt ? new Date(entry.appliedAt) : new Date(),
        }))
        .filter((entry) => entry.id);

    next.push({
        id: normalizedMutationId,
        appliedAt: new Date(),
    });

    return next.slice(-MAX_RECENT_MUTATIONS);
};

const cartMarketShape = (market = null) => (
    market ? {
        countryCode: market.countryCode,
        currency: market.currency,
        language: market.language,
    } : null
);

const getCartUpdatedAt = (cartDoc = {}) => {
    const updatedAtIso = String(cartDoc?.updatedAtIso || '').trim();
    if (updatedAtIso) return updatedAtIso;
    if (cartDoc?.updatedAt instanceof Date) return cartDoc.updatedAt.toISOString();
    if (cartDoc?.updatedAt) {
        const updatedAt = new Date(cartDoc.updatedAt);
        if (Number.isFinite(updatedAt.getTime())) {
            return updatedAt.toISOString();
        }
    }
    return new Date().toISOString();
};

const buildUnavailableCartItem = (storedItem = {}, market = null) => {
    const quantity = Math.max(1, Number(storedItem?.quantity || 1));
    return {
        productId: Number(storedItem?.productId || 0),
        quantity,
        requestedQuantity: quantity,
        title: `Unavailable product #${Number(storedItem?.productId || 0)}`,
        image: '',
        price: 0,
        originalPrice: 0,
        stock: 0,
        availableQuantity: 0,
        brand: '',
        discountPercentage: 0,
        availability: 'missing',
        isAvailable: false,
        lineTotal: 0,
        market: cartMarketShape(market),
        pricing: null,
    };
};

const loadProductMap = async (productIds = [], { session = null } = {}) => {
    const normalizedIds = Array.from(new Set(
        (Array.isArray(productIds) ? productIds : [])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
    ));

    if (normalizedIds.length === 0) {
        return new Map();
    }

    const query = Product.find({ id: { $in: normalizedIds } }).select(PRODUCT_FIELDS);
    const products = await applySession(query, session).lean();

    return new Map(
        (products || []).map((product) => [Number(product.id), product])
    );
};

const resolveStoredItems = async (storedItems = [], { market = null, session = null } = {}) => {
    const normalizedItems = normalizeStoredCartItems(storedItems);
    if (normalizedItems.length === 0) {
        return [];
    }

    const productMap = await loadProductMap(normalizedItems.map((item) => item.productId), { session });

    return Promise.all(normalizedItems.map(async (storedItem) => {
        const product = productMap.get(Number(storedItem.productId));
        if (!product) {
            return buildUnavailableCartItem(storedItem, market);
        }

        const requestedQuantity = Math.max(1, Number(storedItem.quantity || 1));
        const stock = Math.max(0, Number(product.stock || 0));
        const effectiveQuantity = stock > 0 ? Math.min(requestedQuantity, stock) : requestedQuantity;
        const price = Number(product.price || 0);
        const originalPrice = Number(product.originalPrice || product.price || 0);
        const pricing = market ? await buildDisplayPair({
            amount: price,
            originalAmount: originalPrice,
            baseCurrency: market.baseCurrency,
            market,
        }) : null;

        return {
            productId: Number(product.id || storedItem.productId || 0),
            quantity: effectiveQuantity,
            requestedQuantity,
            title: normalizeText(product.title) || '',
            image: buildProductImageDeliveryUrl(normalizeText(product.image) || ''),
            price,
            originalPrice,
            stock,
            availableQuantity: stock,
            brand: normalizeText(product.brand) || '',
            discountPercentage: Number(product.discountPercentage || 0),
            availability: stock <= 0 ? 'out_of_stock' : (requestedQuantity > stock ? 'limited' : 'in_stock'),
            isAvailable: stock > 0,
            lineTotal: Number((price * effectiveQuantity).toFixed(2)),
            market: cartMarketShape(market),
            pricing,
        };
    }));
};

const roundAmount = (value) => Number(Number(value || 0).toFixed(2));

const buildCartSummary = (items = [], market = null) => {
    const safeItems = Array.isArray(items) ? items : [];
    const totalQuantity = safeItems.reduce((sum, item) => sum + Math.max(0, Number(item?.quantity || 0)), 0);
    const requestedQuantity = safeItems.reduce((sum, item) => sum + Math.max(0, Number(item?.requestedQuantity || item?.quantity || 0)), 0);
    const subtotal = roundAmount(safeItems.reduce((sum, item) => (
        sum + (Number(item?.price || 0) * Math.max(0, Number(item?.quantity || 0)))
    ), 0));
    const originalSubtotal = roundAmount(safeItems.reduce((sum, item) => (
        sum + (Number(item?.originalPrice || item?.price || 0) * Math.max(0, Number(item?.quantity || 0)))
    ), 0));
    const displaySubtotal = roundAmount(safeItems.reduce((sum, item) => {
        const amount = Number(item?.pricing?.displayAmount);
        return sum + ((Number.isFinite(amount) ? amount : Number(item?.price || 0)) * Math.max(0, Number(item?.quantity || 0)));
    }, 0));
    const displayOriginalSubtotal = roundAmount(safeItems.reduce((sum, item) => {
        const amount = Number(item?.pricing?.originalDisplayAmount);
        const fallback = Number(item?.pricing?.displayAmount);
        return sum + ((Number.isFinite(amount) ? amount : (Number.isFinite(fallback) ? fallback : Number(item?.originalPrice || item?.price || 0))) * Math.max(0, Number(item?.quantity || 0)));
    }, 0));

    return {
        totalQuantity,
        requestedQuantity,
        distinctItemCount: safeItems.length,
        availableItemCount: safeItems.filter((item) => item?.isAvailable).length,
        unavailableItemCount: safeItems.filter((item) => !item?.isAvailable).length,
        subtotal,
        originalSubtotal,
        displaySubtotal,
        displayOriginalSubtotal,
        market: cartMarketShape(market),
    };
};

const buildCartSnapshotFromDoc = async (cartDoc = {}, { market = null, session = null } = {}) => {
    const items = await resolveStoredItems(cartDoc?.items || [], { market, session });
    return {
        version: Number(cartDoc?.version || 0),
        items,
        summary: buildCartSummary(items, market),
        updatedAt: getCartUpdatedAt(cartDoc),
    };
};

const ensureCartDocument = async ({ userId, user = null, session = null } = {}) => {
    if (!userId) {
        throw new AppError('User id is required for cart access', 401);
    }

    const query = Cart.findOne({ user: userId });
    let cartDoc = await applySession(query, session).lean();
    if (cartDoc) return cartDoc;

    const payload = {
        user: userId,
        version: 0,
        items: [],
        recentMutations: [],
        updatedAtIso: new Date().toISOString(),
    };

    try {
        const created = await Cart.create([payload], session ? { session } : undefined);
        const createdCart = created?.[0];
        return createdCart?.toObject ? createdCart.toObject() : createdCart;
    } catch (error) {
        if (error?.code === 11000) {
            const retryQuery = Cart.findOne({ user: userId });
            return applySession(retryQuery, session).lean();
        }
        throw error;
    }
};

const validateTouchedItems = async (nextItems = [], touchedProductIds = [], { session = null } = {}) => {
    const safeItems = normalizeStoredCartItems(nextItems);
    const touchedIds = Array.from(new Set(
        (Array.isArray(touchedProductIds) ? touchedProductIds : [])
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
    ));

    if (touchedIds.length === 0 || safeItems.length === 0) {
        return safeItems;
    }

    const productMap = await loadProductMap(touchedIds, { session });

    return safeItems.map((item) => {
        if (!touchedIds.includes(Number(item.productId))) {
            return item;
        }

        const product = productMap.get(Number(item.productId));
        if (!product) {
            throw new AppError(`Product not found: ${item.productId}`, 404);
        }

        const stock = Math.max(0, Number(product.stock || 0));
        if (stock <= 0) {
            throw new AppError(`${product.title || `Product ${item.productId}`} is out of stock`, 409);
        }

        return {
            productId: Number(item.productId),
            quantity: Math.min(Math.max(1, Number(item.quantity || 1)), stock),
        };
    });
};

const persistCartDocument = async ({
    cartDoc,
    nextItems,
    clientMutationId = '',
    session = null,
    forceMutationLog = false,
}) => {
    const nowIso = new Date().toISOString();
    const currentItems = normalizeStoredCartItems(cartDoc?.items || []);
    const safeNextItems = normalizeStoredCartItems(nextItems);
    const itemsChanged = !storedItemsEqual(currentItems, safeNextItems);
    const shouldTrackMutation = forceMutationLog || Boolean(String(clientMutationId || '').trim());

    if (!itemsChanged && !shouldTrackMutation) {
        return cartDoc;
    }

    const update = {
        $set: {
            items: safeNextItems,
            updatedAtIso: nowIso,
            recentMutations: appendRecentMutation(cartDoc?.recentMutations || [], clientMutationId),
        },
    };

    if (itemsChanged) {
        update.$inc = { version: 1 };
    }

    const query = Cart.findOneAndUpdate(
        {
            _id: cartDoc._id,
            version: Number(cartDoc?.version || 0),
        },
        update,
        {
            returnDocument: 'after',
            lean: true,
        }
    );

    return applySession(query, session);
};

const hasRecentMutation = (cartDoc = {}, clientMutationId = '') => {
    const normalizedMutationId = String(clientMutationId || '').trim();
    if (!normalizedMutationId) return false;
    return (Array.isArray(cartDoc?.recentMutations) ? cartDoc.recentMutations : []).some(
        (entry) => String(entry?.id || '').trim() === normalizedMutationId
    );
};

const getCartSnapshot = async ({ userId, user = null, market = null, session = null } = {}) => {
    const cartDoc = await ensureCartDocument({ userId, user, session });
    return buildCartSnapshotFromDoc(cartDoc, { market, session });
};

const withCartMutation = async ({
    userId,
    user = null,
    expectedVersion = null,
    clientMutationId = '',
    market = null,
    session = null,
    buildNextItems,
}) => {
    const safeExpectedVersion = parseExpectedVersion(expectedVersion);
    const cartDoc = await ensureCartDocument({ userId, user, session });

    if (safeExpectedVersion !== null && Number(cartDoc?.version || 0) !== safeExpectedVersion) {
        return {
            conflict: true,
            cart: await buildCartSnapshotFromDoc(cartDoc, { market, session }),
            appliedMutationId: '',
        };
    }

    if (hasRecentMutation(cartDoc, clientMutationId)) {
        return {
            conflict: false,
            cart: await buildCartSnapshotFromDoc(cartDoc, { market, session }),
            appliedMutationId: String(clientMutationId || '').trim(),
            duplicate: true,
        };
    }

    const baseItems = cloneStoredCartItems(cartDoc?.items || []);
    const result = await buildNextItems(baseItems);
    const nextItems = await validateTouchedItems(result?.nextItems || [], result?.touchedProductIds || [], { session });

    const persistedCart = await persistCartDocument({
        cartDoc,
        nextItems,
        clientMutationId,
        session,
        forceMutationLog: Boolean(result?.forceMutationLog),
    });

    if (!persistedCart) {
        const latestQuery = Cart.findById(cartDoc._id);
        const latestCart = await applySession(latestQuery, session).lean();
        return {
            conflict: true,
            cart: await buildCartSnapshotFromDoc(latestCart || cartDoc, { market, session }),
            appliedMutationId: '',
        };
    }

    return {
        conflict: false,
        cart: await buildCartSnapshotFromDoc(persistedCart, { market, session }),
        appliedMutationId: String(clientMutationId || '').trim(),
        duplicate: false,
    };
};

const applyCartCommands = async ({
    userId,
    user = null,
    expectedVersion = null,
    clientMutationId = '',
    commands = [],
    market = null,
    session = null,
} = {}) => {
    if (!Array.isArray(commands) || commands.length === 0) {
        throw new AppError('commands must be a non-empty array', 400);
    }

    return withCartMutation({
        userId,
        user,
        expectedVersion,
        clientMutationId,
        market,
        session,
        buildNextItems: async (baseItems) => {
            const nextItems = cloneStoredCartItems(baseItems);
            const touchedProductIds = new Set();

            commands.forEach((command = {}) => {
                const type = String(command?.type || '').trim().toLowerCase();

                if (type === 'clear_cart') {
                    nextItems.splice(0, nextItems.length);
                    return;
                }

                const productId = parseProductId(command?.productId, 'commands.productId');
                const existingIndex = nextItems.findIndex((item) => Number(item.productId) === productId);

                if (type === 'add_item') {
                    const quantity = parseQuantity(command?.quantity, 'commands.quantity');
                    touchedProductIds.add(productId);
                    if (existingIndex >= 0) {
                        nextItems[existingIndex] = {
                            productId,
                            quantity: nextItems[existingIndex].quantity + quantity,
                        };
                    } else {
                        nextItems.push({ productId, quantity });
                    }
                    return;
                }

                if (type === 'set_quantity') {
                    const quantity = parseQuantity(command?.quantity, 'commands.quantity', { allowZero: true });
                    touchedProductIds.add(productId);
                    if (quantity === 0) {
                        if (existingIndex >= 0) {
                            nextItems.splice(existingIndex, 1);
                        }
                        return;
                    }
                    if (existingIndex >= 0) {
                        nextItems[existingIndex] = { productId, quantity };
                    } else {
                        nextItems.push({ productId, quantity });
                    }
                    return;
                }

                if (type === 'remove_item') {
                    if (existingIndex >= 0) {
                        nextItems.splice(existingIndex, 1);
                    }
                    return;
                }

                throw new AppError(`Unsupported cart command type: ${command?.type || 'unknown'}`, 400);
            });

            return {
                nextItems,
                touchedProductIds: Array.from(touchedProductIds),
            };
        },
    });
};

const getCartCheckoutSnapshot = async ({
    userId,
    user = null,
    expectedVersion = null,
    session = null,
} = {}) => {
    const safeExpectedVersion = parseExpectedVersion(expectedVersion, 'cartVersion');
    const cartDoc = await ensureCartDocument({ userId, user, session });
    const currentVersion = Number(cartDoc?.version || 0);

    if (safeExpectedVersion !== null && currentVersion !== safeExpectedVersion) {
        throw new AppError('Cart changed. Refresh checkout and try again.', 409);
    }

    const storedItems = normalizeStoredCartItems(cartDoc?.items || []);
    if (storedItems.length === 0) {
        throw new AppError('Cart is empty', 400);
    }

    const productMap = await loadProductMap(storedItems.map((item) => item.productId), { session });
    const resolvedItems = storedItems.map((item) => {
        const product = productMap.get(Number(item.productId));
        if (!product) {
            throw new AppError(`Product not found: ${item.productId}`, 404);
        }

        const requestedQuantity = Math.max(1, Number(item.quantity || 1));
        const stock = Math.max(0, Number(product.stock || 0));
        if (stock <= 0) {
            throw new AppError(`${product.title || `Product ${item.productId}`} is out of stock`, 409);
        }
        if (requestedQuantity > stock) {
            throw new AppError(
                `Insufficient stock for ${product.title}. Available: ${stock}, Requested: ${requestedQuantity}`,
                409
            );
        }

        return {
            productId: Number(product.id || item.productId || 0),
            quantity: requestedQuantity,
            title: normalizeText(product.title) || '',
            image: buildProductImageDeliveryUrl(normalizeText(product.image) || ''),
            price: Number(product.price || 0),
            mongoProductId: product._id,
            stock,
            lineTotal: Number((Number(product.price || 0) * requestedQuantity).toFixed(2)),
            sellerLocation: {
                city: ['Mumbai', 'Delhi', 'Bangalore', 'Chennai', 'Hyderabad'][product.id % 5],
                state: ['Maharashtra', 'Delhi', 'Karnataka', 'Tamil Nadu', 'Telangana'][product.id % 5],
            },
        };
    });

    return {
        cart: {
            version: currentVersion,
            updatedAt: getCartUpdatedAt(cartDoc),
        },
        resolvedItems,
    };
};

const clearCartAfterCheckout = async ({
    userId,
    user = null,
    expectedVersion = null,
    market = null,
    session = null,
} = {}) => {
    const safeExpectedVersion = parseExpectedVersion(expectedVersion, 'cartVersion');
    const cartDoc = await ensureCartDocument({ userId, user, session });
    const currentVersion = Number(cartDoc?.version || 0);

    if (safeExpectedVersion !== null && currentVersion !== safeExpectedVersion) {
        throw new AppError('Cart changed. Refresh checkout and try again.', 409);
    }

    const currentItems = normalizeStoredCartItems(cartDoc?.items || []);
    if (currentItems.length === 0) {
        return buildCartSnapshotFromDoc(cartDoc, { market, session });
    }

    const query = Cart.findOneAndUpdate(
        {
            _id: cartDoc._id,
            version: currentVersion,
        },
        {
            $set: {
                items: [],
                updatedAtIso: new Date().toISOString(),
                recentMutations: appendRecentMutation(cartDoc?.recentMutations || [], ''),
            },
            $inc: { version: 1 },
        },
        {
            returnDocument: 'after',
            lean: true,
        }
    );

    const persisted = await applySession(query, session);
    if (!persisted) {
        throw new AppError('Cart changed. Refresh checkout and try again.', 409);
    }

    return buildCartSnapshotFromDoc(persisted, { market, session });
};

const toLegacyCartItem = (item = {}) => ({
    id: Number(item?.productId || 0),
    productId: Number(item?.productId || 0),
    title: item?.title || '',
    price: Number(item?.price || 0),
    image: item?.image || '',
    quantity: Math.max(0, Number(item?.quantity || 0)),
    stock: Math.max(0, Number(item?.stock || 0)),
    brand: item?.brand || '',
    discountPercentage: Number(item?.discountPercentage || 0),
    originalPrice: Number(item?.originalPrice || item?.price || 0),
    pricing: item?.pricing || null,
    market: item?.market || null,
    availability: item?.availability || 'in_stock',
    isAvailable: Boolean(item?.isAvailable),
    requestedQuantity: Math.max(0, Number(item?.requestedQuantity || item?.quantity || 0)),
    availableQuantity: Math.max(0, Number(item?.availableQuantity || item?.stock || 0)),
});

const buildLegacyCartResponse = (cartSnapshot = {}, market = null) => ({
    items: (Array.isArray(cartSnapshot?.items) ? cartSnapshot.items : []).map(toLegacyCartItem),
    revision: Number(cartSnapshot?.version || 0),
    syncedAt: cartSnapshot?.updatedAt || null,
    market: cartMarketShape(market),
});

module.exports = {
    parseExpectedVersion,
    getCartSnapshot,
    applyCartCommands,
    getCartCheckoutSnapshot,
    clearCartAfterCheckout,
    buildLegacyCartResponse,
    toLegacyCartItem,
};
