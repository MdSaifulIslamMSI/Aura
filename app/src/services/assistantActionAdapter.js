import { productApi } from '@/services/api';
import {
    selectCartSummary,
    useCommerceStore,
} from '@/store/commerceStore';
import { buildSupportHandoffPath } from '@/utils/assistantCommands';

const safeString = (value = '') => String(value ?? '').trim();

const slugify = (value = '') => safeString(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const toRouteState = (path = '/') => ({
    pathname: path,
    search: '',
    hash: '',
});

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

        if (type === 'open_product' && safeString(action?.productId)) {
            const path = `/product/${safeString(action.productId)}`;
            navigate(path);
            return {
                message: 'Opened the product detail page.',
                path,
            };
        }

        if (type === 'open_category' && safeString(action?.category)) {
            const path = `/category/${slugify(action.category)}`;
            navigate(path);
            return {
                message: `Opened ${safeString(action.category)}.`,
                path,
            };
        }

        if (type === 'open_cart') {
            navigate('/cart');
            return {
                message: 'Opened your cart.',
                path: '/cart',
            };
        }

        if (type === 'open_checkout') {
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

        if (type === 'open_support') {
            const path = buildSupportPath(supportDraft);
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

        return {
            message: 'That assistant action is not supported yet.',
        };
    },
});
