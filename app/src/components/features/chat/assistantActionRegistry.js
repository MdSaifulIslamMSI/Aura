import { productApi } from '@/services/api';
import { useCommerceStore, selectCartItems, selectCartSummary } from '@/store/commerceStore';
import { useChatStore } from '@/store/chatStore';
import { buildSupportHandoffPath, normalizeProductSummary } from '@/utils/assistantCommands';

const safeString = (value = '') => String(value ?? '').trim();
const ACTION_DEDUPE_WINDOW_MS = 2000;

const DEFAULT_PAGE_PATHS = {
    home: '/',
    cart: '/cart',
    checkout: '/checkout',
    orders: '/orders',
    profile: '/profile',
    support: '/contact',
    wishlist: '/wishlist',
    marketplace: '/marketplace',
    deals: '/deals',
    trending: '/trending',
    new_arrivals: '/new-arrivals',
    compare: '/compare',
    bundles: '/bundles',
    visual_search: '/visual-search',
};

const titleCase = (value = '') => safeString(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const buildPathFromNavigation = (page = '', params = {}) => {
    const normalizedPage = safeString(page);
    if (normalizedPage === 'category' && safeString(params?.category)) {
        return `/category/${safeString(params.category)}`;
    }

    if (normalizedPage === 'product' && safeString(params?.productId)) {
        return `/product/${safeString(params.productId)}`;
    }

    const basePath = DEFAULT_PAGE_PATHS[normalizedPage] || '/';
    const searchParams = new URLSearchParams();

    Object.entries(params || {}).forEach(([key, value]) => {
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
            ? `Showing ${uiProducts.length} result${uiProducts.length === 1 ? '' : 's'}${safeString(query) ? ` for ${query}` : ''}.`
            : 'No validated search results are available yet.',
        products: Array.isArray(uiProducts) ? uiProducts.map((product) => normalizeProductSummary(product)) : [],
        filters,
    });

    const selectProduct = async (productId = '') => {
        const product = await resolveProductFromCandidates(productId, candidates);
        const normalizedId = safeString(product?.id || productId);
        if (normalizedId) {
            navigate(`/product/${normalizedId}`);
        }

        return {
            success: Boolean(normalizedId),
            message: product?.title ? `Opened ${product.title}.` : 'Opened the selected product.',
            product,
            activeProductId: normalizedId || null,
        };
    };

    const addToCart = async (productId = '', quantity = 1) => {
        const product = await resolveProductFromCandidates(productId, candidates);
        if (!product?.id) {
            return {
                success: false,
                message: 'I could not find that product to add it to your cart.',
            };
        }

        await useCommerceStore.getState().addItem({
            ...product,
            stock: Number(product.stock || 10),
        }, Math.max(1, Number(quantity || 1)));

        return {
            success: true,
            message: `Added ${product.title} to your cart.`,
            product,
            cartItems: selectCartItems(useCommerceStore.getState()),
            cartSummary: selectCartSummary(useCommerceStore.getState()),
        };
    };

    const removeFromCart = async (productId = '') => {
        const product = await resolveProductFromCandidates(productId, candidates);
        await useCommerceStore.getState().removeItem(productId);

        return {
            success: true,
            message: product?.title ? `Removed ${product.title} from your cart.` : 'Removed that item from your cart.',
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
            message: 'Taking you to checkout.',
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
                ? `Opening tracking for order ${orderId}.`
                : 'Opening your orders.',
            navigation: {
                page: 'orders',
                path,
            },
        };
    };

    const navigateTo = async (page = '', params = {}) => {
        const path = buildPathFromNavigation(page, params);
        navigate(path);

        return {
            success: true,
            message: `Opening ${titleCase(page || 'that page')}.`,
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
                message: `Opening support for order ${orderId}.`,
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
            message: 'Opening the support desk.',
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

        if (type === 'search_products') {
            return finalize(await searchProducts(action.query, action.filters, uiProducts));
        }

        if (type === 'select_product') {
            return finalize(await selectProduct(action.productId));
        }

        if (type === 'add_to_cart') {
            return finalize(await addToCart(action.productId, action.quantity));
        }

        if (type === 'remove_from_cart') {
            return finalize(await removeFromCart(action.productId));
        }

        if (type === 'go_to_checkout') {
            return finalize(await goToCheckout());
        }

        if (type === 'track_order') {
            return finalize(await trackOrder(action.orderId));
        }

        if (type === 'navigate_to') {
            return finalize(await navigateTo(action.page, action.params));
        }

        if (type === 'open_support') {
            return finalize(await openSupport(action.prefill || {}, action.orderId));
        }

        return finalize({
            success: false,
            message: 'That action is not supported yet.',
        });
    };

    return {
        addToCart,
        executeAssistantAction,
        goToCheckout,
        navigateTo,
        openSupport,
        removeFromCart,
        searchProducts,
        selectProduct,
        trackOrder,
    };
};
