import { productApi } from '@/services/api';
import {
    selectCartItems,
    selectCartSummary,
    useCommerceStore,
} from '@/store/commerceStore';
import { buildSupportHandoffPath } from '@/utils/assistantCommands';

const safeString = (value = '') => String(value ?? '').trim();
const titleCase = (value = '') => safeString(value)
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

const slugify = (value = '') => safeString(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const DEFAULT_PAGE_PATHS = {
    home: '/',
    assistant: '/assistant',
    login: '/login',
    cart: '/cart',
    checkout: '/checkout',
    orders: '/orders',
    profile: '/profile',
    support: '/profile?tab=support',
    wishlist: '/wishlist',
    marketplace: '/marketplace',
    deals: '/deals',
    compare: '/compare',
    bundles: '/bundles',
    visual_search: '/visual-search',
    mission_control: '/mission-control',
    sell: '/sell',
    become_seller: '/become-seller',
    my_listings: '/my-listings',
    price_alerts: '/price-alerts',
    trade_in: '/trade-in',
};

const toRouteState = (path = '/') => ({
    pathname: path,
    search: '',
    hash: '',
});

const buildNavigationPath = (page = '', params = {}) => {
    const normalizedPage = safeString(page);
    const normalizedParams = params && typeof params === 'object' ? params : {};

    if (normalizedPage === 'category' && safeString(normalizedParams.category)) {
        return `/category/${safeString(normalizedParams.category)}`;
    }

    if (normalizedPage === 'product' && safeString(normalizedParams.productId)) {
        return `/product/${safeString(normalizedParams.productId)}`;
    }

    const basePath = DEFAULT_PAGE_PATHS[normalizedPage] || '/';
    const searchParams = new URLSearchParams();

    Object.entries(normalizedParams).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        searchParams.set(key, String(value));
    });

    const query = searchParams.toString();
    return query ? `${basePath}${basePath.includes('?') ? '&' : '?'}${query}` : basePath;
};

const buildSupportPath = (supportDraft = null) => buildSupportHandoffPath({
    category: safeString(supportDraft?.category || ''),
    subject: safeString(supportDraft?.subject || ''),
    intent: safeString(supportDraft?.body || ''),
    actionId: safeString(supportDraft?.relatedOrderId || ''),
});

export const createAssistantActionAdapter = ({
    navigate,
    isAuthenticated = false,
} = {}) => ({
    run: async (action = {}, options = {}) => {
        const type = safeString(action?.type || '');
        const supportDraft = options?.supportDraft || null;

        if ((type === 'open_product' || type === 'select_product') && safeString(action?.productId)) {
            const path = `/product/${safeString(action.productId)}`;
            navigate(path);
            return {
                message: 'Opened the product detail page.',
                path,
            };
        }

        if (type === 'search_products') {
            const category = safeString(action?.filters?.category || action?.category || '');
            return {
                message: category
                    ? `Refined the workspace for ${category}.`
                    : 'Updated the grounded product set in the workspace.',
            };
        }

        if ((type === 'open_category' || (type === 'navigate_to' && safeString(action?.page) === 'category')) && safeString(action?.category || action?.params?.category)) {
            const category = safeString(action?.category || action?.params?.category);
            const path = `/category/${slugify(category)}`;
            navigate(path);
            return {
                message: `Opened ${category}.`,
                path,
            };
        }

        if (type === 'open_cart' || (type === 'navigate_to' && safeString(action?.page) === 'cart')) {
            navigate('/cart');
            return {
                message: 'Opened your cart.',
                path: '/cart',
            };
        }

        if (type === 'open_checkout' || type === 'go_to_checkout' || (type === 'navigate_to' && safeString(action?.page) === 'checkout')) {
            if (!isAuthenticated) {
                navigate('/login', {
                    state: {
                        from: toRouteState('/checkout'),
                    },
                });
                return {
                    message: 'Sign in to continue to checkout.',
                    path: '/login',
                };
            }

            navigate('/checkout');
            return {
                message: 'Opened checkout.',
                path: '/checkout',
            };
        }

        if (type === 'track_order') {
            const path = safeString(action?.orderId)
                ? `/orders?focus=${encodeURIComponent(safeString(action.orderId))}&expand=1`
                : '/orders';
            navigate(path);
            return {
                message: safeString(action?.orderId)
                    ? `Opened tracking for order ${safeString(action.orderId)}.`
                    : 'Opened your orders.',
                path,
            };
        }

        if (type === 'open_support') {
            const effectiveDraft = action?.prefill && typeof action.prefill === 'object'
                ? {
                    ...supportDraft,
                    ...action.prefill,
                }
                : supportDraft;
            const path = safeString(action?.orderId)
                ? `/orders?focus=${encodeURIComponent(safeString(action.orderId))}&expand=1&support=1`
                : buildSupportPath(effectiveDraft);
            navigate(path);
            return {
                message: 'Opened the support desk with the drafted handoff.',
                path,
            };
        }

        if (type === 'add_to_cart' && safeString(action?.productId)) {
            const product = await productApi.getProductById(safeString(action.productId));
            if (!product) {
                return {
                    message: 'That product could not be loaded for the cart action.',
                };
            }

            await useCommerceStore.getState().addItem(product, Math.max(1, Number(action?.quantity || 1)));
            return {
                message: `Added ${safeString(product?.displayTitle || product?.title || 'the product')} to your cart.`,
                cartSummary: selectCartSummary(useCommerceStore.getState()),
            };
        }

        if (type === 'remove_from_cart' && safeString(action?.productId)) {
            const product = await productApi.getProductById(safeString(action.productId)).catch(() => null);
            await useCommerceStore.getState().removeItem(safeString(action.productId));
            return {
                message: `Removed ${safeString(product?.displayTitle || product?.title || 'the product')} from your cart.`,
                cartItems: selectCartItems(useCommerceStore.getState()),
                cartSummary: selectCartSummary(useCommerceStore.getState()),
            };
        }

        if (type === 'navigate_to' && safeString(action?.page)) {
            const path = buildNavigationPath(action.page, action.params);
            navigate(path);
            return {
                message: `Opened ${titleCase(action.page)}.`,
                path,
            };
        }

        return {
            message: 'That assistant action is not supported yet.',
        };
    },
});
