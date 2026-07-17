import { defineMessages } from 'react-intl';
import { orderApi, productApi } from '@/services/api';
import { useCommerceStore, selectCartItems, selectCartSummary } from '@/store/commerceStore';
import { useChatStore } from '@/store/chatStore';
import {
    APP_ASSISTANT_CAPABILITIES,
    buildSupportHandoffPath,
    normalizeProductSummary,
} from '@/utils/assistantCommands';

const safeString = (value = '') => String(value ?? '').trim();
const ACTION_DEDUPE_WINDOW_MS = 2000;

const assistantActionMessages = defineMessages({
    takingToCheckout: { id: 'assistant.action.checkout.navigation', defaultMessage: 'Taking you to checkout.' },
    chooseOrderForReturn: { id: 'assistant.action.return.chooseOrder', defaultMessage: 'Open your orders and choose the order for the return or refund request.' },
    unsupportedAction: { id: 'assistant.action.unsupported', defaultMessage: 'That action is not supported yet.' },
    searchResults: { id: 'assistant.action.search.results', defaultMessage: 'Showing {count} result{pluralSuffix}{querySuffix}.' },
    searchQuerySuffix: { id: 'assistant.action.search.querySuffix', defaultMessage: ' for {query}' },
    noValidatedSearchResults: { id: 'assistant.action.search.noValidatedResults', defaultMessage: 'No validated search results are available yet.' },
    openedProduct: { id: 'assistant.action.product.opened', defaultMessage: 'Opened {title}.' },
    openedSelectedProduct: { id: 'assistant.action.product.openedSelected', defaultMessage: 'Opened the selected product.' },
    addToCartMissingProduct: { id: 'assistant.action.cart.addMissingProduct', defaultMessage: 'I could not find that product to add it to your cart.' },
    addToCartUnavailableProduct: { id: 'assistant.action.cart.addUnavailableProduct', defaultMessage: 'That product is unavailable or out of stock, so I did not add it to your cart.' },
    addedToCart: { id: 'assistant.action.cart.added', defaultMessage: 'Added {title} to your cart.' },
    removedFromCart: { id: 'assistant.action.cart.removed', defaultMessage: 'Removed {title} from your cart.' },
    removedCartItem: { id: 'assistant.action.cart.removedItem', defaultMessage: 'Removed that item from your cart.' },
    openTrackingForOrder: { id: 'assistant.action.orders.openTracking', defaultMessage: 'Opening tracking for order {orderId}.' },
    openingOrders: { id: 'assistant.action.orders.opening', defaultMessage: 'Opening your orders.' },
    chooseOrderToCancel: { id: 'assistant.action.orders.chooseCancel', defaultMessage: 'Open your orders and choose the order to cancel.' },
    cancelledOrder: { id: 'assistant.action.orders.cancelled', defaultMessage: 'Cancelled order {orderId}.' },
    unableToCancelOrder: { id: 'assistant.action.orders.cancelUnavailable', defaultMessage: 'Unable to cancel that order right now.' },
    createdOrderRequest: { id: 'assistant.action.orders.createdRequest', defaultMessage: 'Created {requestType} request for order {orderId}.' },
    unableToCreateOrderRequest: { id: 'assistant.action.orders.createRequestUnavailable', defaultMessage: 'Unable to create that request right now.' },
    openCheckoutForCoupon: { id: 'assistant.action.checkout.openCoupon', defaultMessage: 'Opening checkout to validate coupon {couponCode}.' },
    openCheckoutForValidation: { id: 'assistant.action.checkout.openValidation', defaultMessage: 'Opening checkout to validate your coupon.' },
    needsTwoProductsToCompare: { id: 'assistant.action.compare.needsTwoProducts', defaultMessage: 'I need at least two products to compare.' },
    openingProductComparison: { id: 'assistant.action.compare.opening', defaultMessage: 'Opening product comparison.' },
    openingPaymentForOrder: { id: 'assistant.action.payments.openingOrder', defaultMessage: 'Opening payment details for order {orderId}.' },
    openingPage: { id: 'assistant.action.navigation.openingPage', defaultMessage: 'Opening {page}.' },
    thatPage: { id: 'assistant.action.navigation.thatPage', defaultMessage: 'that page' },
    openingSupportForOrder: { id: 'assistant.action.support.openingOrder', defaultMessage: 'Opening support for order {orderId}.' },
    openingSupportDesk: { id: 'assistant.action.support.openingDesk', defaultMessage: 'Opening the support desk.' },
});

const interpolateDefaultMessage = (message = '', values = {}) => String(message || '').replace(
    /\{([A-Za-z][A-Za-z0-9_]*)\}/g,
    (match, key) => (values[key] === undefined || values[key] === null ? match : String(values[key]))
);

const formatAssistantActionMessage = (formatMessage, descriptor, values = {}) => (
    formatMessage ? formatMessage(descriptor, values) : interpolateDefaultMessage(descriptor.defaultMessage, values)
);

const DEFAULT_PAGE_PATHS = {
    ...Object.fromEntries(APP_ASSISTANT_CAPABILITIES
        .filter((capability) => safeString(capability?.id) && safeString(capability?.route) && !safeString(capability.route).includes(':'))
        .map((capability) => [safeString(capability.id), safeString(capability.route)])),
    login: '/login',
    search: '/search',
    mission_control: '/mission-control',
};

const CAPABILITY_ROUTE_BY_ID = new Map(APP_ASSISTANT_CAPABILITIES
    .filter((capability) => safeString(capability?.id) && safeString(capability?.route))
    .map((capability) => [safeString(capability.id), safeString(capability.route)]));

const titleCase = (value = '') => safeString(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const buildPathFromNavigation = (page = '', params = {}) => {
    const normalizedPage = safeString(page);
    const declaredRoute = CAPABILITY_ROUTE_BY_ID.get(normalizedPage) || DEFAULT_PAGE_PATHS[normalizedPage] || '';
    if (!declaredRoute) return '';

    const consumedParams = new Set();
    let missingRouteParam = false;
    const basePath = declaredRoute.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_match, token) => {
        const contextKey = token === 'id'
            ? {
                product: 'productId',
                listing: 'listingId',
                seller_profile: 'sellerId',
            }[normalizedPage] || 'id'
            : token;
        const value = safeString(params?.[token] ?? params?.[contextKey] ?? '');
        if (!value) {
            missingRouteParam = true;
            return '';
        }
        consumedParams.add(token);
        consumedParams.add(contextKey);
        return encodeURIComponent(value);
    });
    if (!basePath || missingRouteParam) return '';
    const searchParams = new URLSearchParams();

    Object.entries(params || {}).forEach(([key, value]) => {
        if (consumedParams.has(key)) return;
        if (value === undefined || value === null || value === '') return;
        searchParams.set(key, String(value));
    });

    const query = searchParams.toString();
    if (!query) return basePath;
    return `${basePath}${basePath.includes('?') ? '&' : '?'}${query}`;
};

const stableStringify = (value = {}) => JSON.stringify(
    Object.keys(value || {}).sort().reduce((acc, key) => {
        acc[key] = value[key];
        return acc;
    }, {})
);

const buildActionFingerprint = (action = {}) => {
    const type = safeString(action?.type || '');
    if (!type) return '';

    if (type === 'add_to_cart' || type === 'remove_from_cart') {
        return `${type}:${safeString(action?.productId)}:${Math.max(1, Number(action?.quantity || 1))}`;
    }

    if (type === 'navigate_to') {
        return `${type}:${safeString(action?.page)}:${stableStringify(action?.params || {})}`;
    }

    if (type === 'go_to_checkout') {
        return 'navigate_to:checkout:{}';
    }

    if (type === 'open_support') {
        return `open_support:${safeString(action?.orderId)}:${stableStringify(action?.prefill || {})}`;
    }

    if (type === 'track_order') {
        return `track_order:${safeString(action?.orderId)}`;
    }

    if (type === 'get_product_details' || type === 'check_inventory' || type === 'get_price') {
        return `${type}:${safeString(action?.productId)}`;
    }

    if (type === 'cancel_order' || type === 'create_return_request' || type === 'get_payment_status') {
        return `${type}:${safeString(action?.orderId)}:${safeString(action?.requestType)}:${safeString(action?.reason)}`;
    }

    if (type === 'apply_coupon') {
        return `apply_coupon:${safeString(action?.couponCode)}`;
    }

    if (type === 'compare_products') {
        return `compare_products:${(Array.isArray(action?.productIds) ? action.productIds : []).map((entry) => safeString(entry)).filter(Boolean).join(',')}`;
    }

    return '';
};

const resolveProductFromCandidates = async (productId = '', candidates = []) => {
    const normalizedId = safeString(productId);
    if (!normalizedId) return null;

    const localMatch = (Array.isArray(candidates) ? candidates : [])
        .map((product) => normalizeProductSummary(product))
        .find((product) => String(product.id) === normalizedId);

    if (localMatch) return localMatch;

    try {
        const fetched = await productApi.getProductById(normalizedId);
        return normalizeProductSummary(fetched || {});
    } catch {
        return null;
    }
};

const resolveCanonicalProduct = async (productId = '') => {
    const normalizedId = safeString(productId);
    if (!normalizedId) return null;

    try {
        const product = normalizeProductSummary(await productApi.getProductById(normalizedId, { force: true }) || {});
        return String(product.id) === normalizedId ? product : null;
    } catch {
        return null;
    }
};

const buildOrderSupportPath = (orderId = '', prefill = {}) => {
    const params = new URLSearchParams();
    params.set('focus', safeString(orderId));
    params.set('expand', '1');
    params.set('support', '1');
    if (safeString(prefill?.category)) params.set('category', safeString(prefill.category));
    if (safeString(prefill?.subject)) params.set('subject', safeString(prefill.subject));
    if (safeString(prefill?.body)) params.set('intent', safeString(prefill.body));
    return `/orders?${params.toString()}`;
};

export const createAssistantActionRegistry = ({
    navigate,
    isAuthenticated = false,
    candidates = [],
    formatMessage = null,
} = {}) => {
    const readLastActionState = () => {
        const memory = useChatStore.getState().context?.sessionMemory || {};
        return {
            fingerprint: safeString(memory.lastActionFingerprint || ''),
            at: Number(memory.lastActionAt || 0),
        };
    };

    const rememberAction = (fingerprint = '', executedAt = Date.now()) => {
        useChatStore.getState().rememberExecutedAction(fingerprint, executedAt);
    };

    const searchProducts = async (query = '', filters = {}, uiProducts = []) => ({
        success: true,
        message: Array.isArray(uiProducts) && uiProducts.length > 0
            ? formatAssistantActionMessage(formatMessage, assistantActionMessages.searchResults, {
                count: uiProducts.length,
                pluralSuffix: uiProducts.length === 1 ? '' : 's',
                querySuffix: safeString(query)
                    ? formatAssistantActionMessage(formatMessage, assistantActionMessages.searchQuerySuffix, { query: safeString(query) })
                    : '',
            })
            : formatAssistantActionMessage(formatMessage, assistantActionMessages.noValidatedSearchResults),
        products: Array.isArray(uiProducts) ? uiProducts.map((product) => normalizeProductSummary(product)) : [],
        filters,
    });

    const selectProduct = async (productId = '', canExecute = () => true) => {
        const product = await resolveProductFromCandidates(productId, candidates);
        if (!canExecute()) {
            return {
                success: false,
                ownershipLost: true,
                message: '',
            };
        }
        const normalizedId = safeString(product?.id || productId);
        if (normalizedId) {
            navigate(`/product/${normalizedId}`);
        }

        return {
            success: Boolean(normalizedId),
            message: product?.title
                ? formatAssistantActionMessage(formatMessage, assistantActionMessages.openedProduct, { title: product.title })
                : formatAssistantActionMessage(formatMessage, assistantActionMessages.openedSelectedProduct),
            product,
            activeProductId: normalizedId || null,
        };
    };

    const addToCart = async (productId = '', quantity = 1, canExecute = () => true) => {
        const product = await resolveCanonicalProduct(productId);
        if (!product?.id) {
            return {
                success: false,
                message: formatAssistantActionMessage(formatMessage, assistantActionMessages.addToCartMissingProduct),
            };
        }


        const canonicalStock = Math.floor(Number(product.stock));
        if (!Number.isFinite(canonicalStock) || canonicalStock <= 0) {
            return {
                success: false,
                message: formatAssistantActionMessage(formatMessage, assistantActionMessages.addToCartUnavailableProduct),
            };
        }

        const requestedQuantity = Math.max(1, Math.floor(Number(quantity) || 1));
        const existingQuantity = selectCartItems(useCommerceStore.getState())
            .filter((item) => safeString(item?.id || item?._id) === safeString(product.id))
            .reduce((total, item) => total + Math.max(0, Number(item?.quantity) || 0), 0);
        const remainingStock = Math.max(0, canonicalStock - existingQuantity);
        if (remainingStock <= 0) {
            return {
                success: false,
                message: formatAssistantActionMessage(formatMessage, assistantActionMessages.addToCartUnavailableProduct),
            };
        }
        const allowedQuantity = Math.min(requestedQuantity, remainingStock);

        if (!canExecute()) {
            return {
                success: false,
                ownershipLost: true,
                message: '',
            };
        }

        await useCommerceStore.getState().addItem({
            ...product,
            stock: canonicalStock,
        }, allowedQuantity);

        if (!canExecute()) {
            return {
                success: false,
                ownershipLost: true,
                message: '',
            };
        }

        return {
            success: true,
            message: formatAssistantActionMessage(formatMessage, assistantActionMessages.addedToCart, { title: product.title }),
            product,
            cartItems: selectCartItems(useCommerceStore.getState()),
            cartSummary: selectCartSummary(useCommerceStore.getState()),
        };
    };

    const removeFromCart = async (productId = '', canExecute = () => true) => {
        const product = await resolveProductFromCandidates(productId, candidates);
        if (!canExecute()) {
            return {
                success: false,
                ownershipLost: true,
                message: '',
            };
        }
        await useCommerceStore.getState().removeItem(productId);

        return {
            success: true,
            message: product?.title
                ? formatAssistantActionMessage(formatMessage, assistantActionMessages.removedFromCart, { title: product.title })
                : formatAssistantActionMessage(formatMessage, assistantActionMessages.removedCartItem),
            product,
            cartItems: selectCartItems(useCommerceStore.getState()),
            cartSummary: selectCartSummary(useCommerceStore.getState()),
        };
    };

    const goToCheckout = async () => {
        if (!isAuthenticated) {
            navigate('/login', {
                state: {
                    from: {
                        pathname: '/checkout',
                    },
                },
            });
        } else {
            navigate('/checkout');
        }

        return {
            success: true,
            message: formatAssistantActionMessage(formatMessage, assistantActionMessages.takingToCheckout),
            navigation: {
                page: 'checkout',
                path: '/checkout',
            },
            cartSummary: selectCartSummary(useCommerceStore.getState()),
        };
    };

    const trackOrder = async (orderId = '') => {
        const path = buildOrderSupportPath(orderId);
        navigate(path);

        return {
            success: Boolean(safeString(orderId)),
            message: safeString(orderId)
                ? formatAssistantActionMessage(formatMessage, assistantActionMessages.openTrackingForOrder, { orderId })
                : formatAssistantActionMessage(formatMessage, assistantActionMessages.openingOrders),
            navigation: {
                page: 'orders',
                path,
            },
        };
    };

    const cancelOrder = async (orderId = '', reason = '') => {
        const normalizedOrderId = safeString(orderId);
        if (!normalizedOrderId) {
            navigate('/orders');
            return {
                success: false,
                message: formatAssistantActionMessage(formatMessage, assistantActionMessages.chooseOrderToCancel),
                navigation: {
                    page: 'orders',
                    path: '/orders',
                },
            };
        }

        try {
            const result = await orderApi.cancelOrder(normalizedOrderId, {
                reason: safeString(reason) || 'Requested from assistant',
            });
            const path = buildOrderSupportPath(normalizedOrderId);
            navigate(path);
            return {
                success: true,
                message: result?.message || formatAssistantActionMessage(formatMessage, assistantActionMessages.cancelledOrder, { orderId: normalizedOrderId }),
                order: result?.order || null,
                navigation: {
                    page: 'orders',
                    path,
                },
            };
        } catch (error) {
            return {
                success: false,
                message: safeString(error?.message) || formatAssistantActionMessage(formatMessage, assistantActionMessages.unableToCancelOrder),
            };
        }
    };

    const createReturnRequest = async ({
        orderId = '',
        requestType = 'refund',
        reason = '',
        amount = 0,
    } = {}) => {
        const normalizedOrderId = safeString(orderId);
        if (!normalizedOrderId) {
            navigate('/orders');
            return {
                success: false,
                message: formatAssistantActionMessage(formatMessage, assistantActionMessages.chooseOrderForReturn),
                navigation: {
                    page: 'orders',
                    path: '/orders',
                },
            };
        }

        try {
            const normalizedType = safeString(requestType || 'refund').toLowerCase();
            const payload = {
                reason: safeString(reason) || 'Requested from assistant',
            };
            if (Number(amount) > 0) payload.amount = Number(amount);
            const result = normalizedType === 'replacement'
                ? await orderApi.requestReplacement(normalizedOrderId, payload)
                : await orderApi.requestRefund(normalizedOrderId, payload);
            const path = buildOrderSupportPath(normalizedOrderId, {
                category: normalizedType === 'replacement' ? 'replacement' : 'refund',
                subject: normalizedType === 'replacement' ? 'Replacement request' : 'Refund request',
                body: payload.reason,
            });
            navigate(path);
            return {
                success: true,
                message: result?.message || formatAssistantActionMessage(formatMessage, assistantActionMessages.createdOrderRequest, {
                    orderId: normalizedOrderId,
                    requestType: normalizedType,
                }),
                commandCenter: result?.commandCenter || null,
                navigation: {
                    page: 'orders',
                    path,
                },
            };
        } catch (error) {
            return {
                success: false,
                message: safeString(error?.message) || formatAssistantActionMessage(formatMessage, assistantActionMessages.unableToCreateOrderRequest),
            };
        }
    };

    const applyCoupon = async (couponCode = '') => {
        const params = {};
        if (safeString(couponCode)) params.coupon = safeString(couponCode).toUpperCase();
        const path = buildPathFromNavigation('checkout', params);
        navigate(path);

        return {
            success: true,
            message: safeString(couponCode)
                ? formatAssistantActionMessage(formatMessage, assistantActionMessages.openCheckoutForCoupon, { couponCode: safeString(couponCode).toUpperCase() })
                : formatAssistantActionMessage(formatMessage, assistantActionMessages.openCheckoutForValidation),
            navigation: {
                page: 'checkout',
                path,
                params,
            },
        };
    };

    const compareProducts = async (productIds = []) => {
        const ids = (Array.isArray(productIds) ? productIds : []).map((entry) => safeString(entry)).filter(Boolean);
        if (ids.length < 2) {
            return {
                success: false,
                message: formatAssistantActionMessage(formatMessage, assistantActionMessages.needsTwoProductsToCompare),
            };
        }

        const path = buildPathFromNavigation('compare', { products: ids.join(',') });
        navigate(path);
        return {
            success: true,
            message: formatAssistantActionMessage(formatMessage, assistantActionMessages.openingProductComparison),
            navigation: {
                page: 'compare',
                path,
                params: { products: ids.join(',') },
            },
        };
    };

    const getPaymentStatus = async (orderId = '') => {
        const path = buildOrderSupportPath(orderId);
        navigate(path);
        return {
            success: Boolean(safeString(orderId)),
            message: safeString(orderId)
                ? formatAssistantActionMessage(formatMessage, assistantActionMessages.openingPaymentForOrder, { orderId })
                : formatAssistantActionMessage(formatMessage, assistantActionMessages.openingOrders),
            navigation: {
                page: 'orders',
                path,
            },
        };
    };

    const navigateTo = async (page = '', params = {}) => {
        const path = buildPathFromNavigation(page, params);
        if (!path) {
            return {
                success: false,
                message: formatAssistantActionMessage(formatMessage, assistantActionMessages.unsupportedAction),
            };
        }
        navigate(path);

        return {
            success: true,
            message: formatAssistantActionMessage(formatMessage, assistantActionMessages.openingPage, {
                page: safeString(page)
                    ? titleCase(page)
                    : formatAssistantActionMessage(formatMessage, assistantActionMessages.thatPage),
            }),
            navigation: {
                page: safeString(page),
                path,
                params,
            },
            cartSummary: safeString(page) === 'cart' ? selectCartSummary(useCommerceStore.getState()) : null,
        };
    };

    const openSupport = async (prefill = {}, orderId = '') => {
        if (safeString(orderId)) {
            const path = buildOrderSupportPath(orderId, prefill);
            navigate(path);

            return {
                success: true,
                message: formatAssistantActionMessage(formatMessage, assistantActionMessages.openingSupportForOrder, { orderId }),
                supportPrefill: prefill,
                navigation: {
                    page: 'orders',
                    path,
                },
            };
        }

        const path = buildSupportHandoffPath({
            category: prefill?.category,
            subject: prefill?.subject,
            intent: prefill?.body || prefill?.intent,
            actionId: prefill?.relatedActionId || '',
        });
        navigate(path);

        return {
            success: true,
            message: formatAssistantActionMessage(formatMessage, assistantActionMessages.openingSupportDesk),
            supportPrefill: prefill,
            navigation: {
                page: 'support',
                path,
            },
        };
    };

    const executeAssistantAction = async (action = {}, options = {}) => {
        const type = safeString(action?.type || '');
        const uiProducts = Array.isArray(options?.uiProducts) ? options.uiProducts : [];
        const canExecute = typeof options?.canExecute === 'function' ? options.canExecute : () => true;
        const fingerprint = buildActionFingerprint(action);
        const now = Date.now();

        if (fingerprint) {
            const lastAction = readLastActionState();
            if (lastAction.fingerprint === fingerprint && (now - lastAction.at) < ACTION_DEDUPE_WINDOW_MS) {
                return {
                    success: true,
                    suppressedDuplicate: true,
                    message: '',
                    actionFingerprint: fingerprint,
                    actionAt: lastAction.at,
                };
            }
        }

        const finalize = (result = {}) => {
            if (fingerprint && result?.success !== false && !result?.suppressedDuplicate) {
                rememberAction(fingerprint, now);
            }

            return {
                ...result,
                suppressedDuplicate: Boolean(result?.suppressedDuplicate),
                actionFingerprint: fingerprint || safeString(result?.actionFingerprint || ''),
                actionAt: result?.actionAt || (fingerprint ? now : 0),
            };
        };

        if (!canExecute()) {
            return finalize({
                success: false,
                ownershipLost: true,
                message: '',
            });
        }

        if (type === 'search_products') {
            return finalize(await searchProducts(action.query, action.filters, uiProducts));
        }

        if (type === 'select_product') {
            return finalize(await selectProduct(action.productId, canExecute));
        }

        if (type === 'get_product_details' || type === 'check_inventory' || type === 'get_price') {
            return finalize(await selectProduct(action.productId, canExecute));
        }

        if (type === 'add_to_cart') {
            return finalize(await addToCart(action.productId, action.quantity, canExecute));
        }

        if (type === 'remove_from_cart') {
            return finalize(await removeFromCart(action.productId, canExecute));
        }

        if (type === 'go_to_checkout') {
            return finalize(await goToCheckout());
        }

        if (type === 'track_order') {
            return finalize(await trackOrder(action.orderId));
        }

        if (type === 'cancel_order') {
            return finalize(await cancelOrder(action.orderId, action.reason));
        }

        if (type === 'create_return_request') {
            return finalize(await createReturnRequest({
                orderId: action.orderId,
                requestType: action.requestType,
                reason: action.reason,
                amount: action.amount,
            }));
        }

        if (type === 'apply_coupon') {
            return finalize(await applyCoupon(action.couponCode));
        }

        if (type === 'compare_products') {
            return finalize(await compareProducts(action.productIds));
        }

        if (type === 'recommend_products') {
            return finalize(await searchProducts(action.query, action.filters, uiProducts));
        }

        if (type === 'get_payment_status') {
            return finalize(await getPaymentStatus(action.orderId));
        }

        if (type === 'navigate_to') {
            return finalize(await navigateTo(action.page, action.params));
        }

        if (type === 'open_support') {
            return finalize(await openSupport(action.prefill || {}, action.orderId));
        }

        return finalize({
            success: false,
            message: formatAssistantActionMessage(formatMessage, assistantActionMessages.unsupportedAction),
        });
    };

    return {
        addToCart,
        executeAssistantAction,
        applyCoupon,
        cancelOrder,
        compareProducts,
        createReturnRequest,
        getPaymentStatus,
        goToCheckout,
        navigateTo,
        openSupport,
        removeFromCart,
        searchProducts,
        selectProduct,
        trackOrder,
    };
};
