import { productApi } from '@/services/api';
import { useCommerceStore, selectCartItems, selectCartSummary } from '@/store/commerceStore';
import { buildSupportHandoffPath, normalizeProductSummary } from '@/utils/assistantCommands';

const safeString = (value = '') => String(value ?? '').trim();

const DEFAULT_PAGE_PATHS = {
    home: '/',
    cart: '/cart',
    checkout: '/checkout',
    orders: '/orders',
    profile: '/profile',
    support: '/profile?tab=support',
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
    const searchProducts = async (query = '', filters = {}, uiProducts = []) => ({
        success: true,
        message: Array.isArray(uiProducts) && uiProducts.length > 0
            ? `Showing ${uiProducts.length} result${uiProducts.length === 1 ? '' : 's'}${safeString(query) ? ` for ${query}` : ''}.`
            : `Searching${safeString(query) ? ` for ${query}` : ''}.`,
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

        if (type === 'search_products') {
            return searchProducts(action.query, action.filters, uiProducts);
        }

        if (type === 'select_product') {
            return selectProduct(action.productId);
        }

        if (type === 'add_to_cart') {
            return addToCart(action.productId, action.quantity);
        }

        if (type === 'remove_from_cart') {
            return removeFromCart(action.productId);
        }

        if (type === 'go_to_checkout') {
            return goToCheckout();
        }

        if (type === 'track_order') {
            return trackOrder(action.orderId);
        }

        if (type === 'navigate_to') {
            return navigateTo(action.page, action.params);
        }

        if (type === 'open_support') {
            return openSupport(action.prefill || {}, action.orderId);
        }

        return {
            success: false,
            message: 'That action is not supported yet.',
        };
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
