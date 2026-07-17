import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetChatStoreForTests, useChatStore } from '../../../store/chatStore';
import {
    resetCommerceStoreForTests,
    selectCartSummary,
    useCommerceStore,
} from '../../../store/commerceStore';
import { createAssistantActionRegistry } from './assistantActionRegistry';
import { productApi } from '../../../services/api';
import { APP_ASSISTANT_CAPABILITIES } from '../../../utils/assistantCommands';

describe('assistantActionRegistry', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
        sessionStorage.clear();
        resetChatStoreForTests();
        resetCommerceStoreForTests();
    });

    it('suppresses duplicate category navigation within two seconds', async () => {
        const navigate = vi.fn();
        const registry = createAssistantActionRegistry({
            navigate,
            isAuthenticated: false,
            candidates: [],
        });

        const first = await registry.executeAssistantAction({
            type: 'navigate_to',
            page: 'category',
            params: {
                category: 'electronics',
            },
        });
        const second = await registry.executeAssistantAction({
            type: 'navigate_to',
            page: 'category',
            params: {
                category: 'electronics',
            },
        });

        expect(first.suppressedDuplicate).toBe(false);
        expect(second.suppressedDuplicate).toBe(true);
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(useChatStore.getState().context.sessionMemory).toMatchObject({
            lastActionFingerprint: 'navigate_to:category:{"category":"electronics"}',
        });
    });

    it('suppresses duplicate add-to-cart actions within two seconds', async () => {
        vi.spyOn(productApi, 'getProductById').mockResolvedValue({
            id: '101',
            title: 'Aura Phone',
            brand: 'Aura',
            category: 'Mobiles',
            price: 9999,
            stock: 4,
        });
        const navigate = vi.fn();
        const registry = createAssistantActionRegistry({
            navigate,
            isAuthenticated: false,
            candidates: [
                {
                    id: '101',
                    title: 'Aura Phone',
                    brand: 'Aura',
                    category: 'Mobiles',
                    price: 9999,
                    stock: 4,
                },
            ],
        });

        const first = await registry.executeAssistantAction({
            type: 'add_to_cart',
            productId: '101',
            quantity: 1,
        });
        const second = await registry.executeAssistantAction({
            type: 'add_to_cart',
            productId: '101',
            quantity: 1,
        });

        expect(first.suppressedDuplicate).toBe(false);
        expect(second.suppressedDuplicate).toBe(true);
        expect(selectCartSummary(useCommerceStore.getState()).totalItems).toBe(1);
        expect(productApi.getProductById).toHaveBeenCalledWith('101', { force: true });
    });

    it('refuses to add a product when canonical inventory is zero', async () => {
        vi.spyOn(productApi, 'getProductById').mockResolvedValue({
            id: '101',
            title: 'Aura Phone',
            price: 9999,
            stock: 0,
        });
        const registry = createAssistantActionRegistry({
            navigate: vi.fn(),
            candidates: [{ id: '101', title: 'Stale Aura Phone', stock: 10 }],
        });

        const result = await registry.executeAssistantAction({
            type: 'add_to_cart',
            productId: '101',
            quantity: 1,
        });

        expect(result.success).toBe(false);
        expect(result.message).toMatch(/unavailable|out of stock/i);
        expect(selectCartSummary(useCommerceStore.getState()).totalItems).toBe(0);
    });

    it('caps additions at canonical remaining stock', async () => {
        vi.spyOn(productApi, 'getProductById').mockResolvedValue({
            id: '101',
            title: 'Aura Phone',
            price: 9999,
            stock: 2,
        });
        const registry = createAssistantActionRegistry({
            navigate: vi.fn(),
            candidates: [{ id: '101', title: 'Stale Aura Phone', stock: 99 }],
        });

        await registry.executeAssistantAction({
            type: 'add_to_cart',
            productId: '101',
            quantity: 1,
        });
        await registry.executeAssistantAction({
            type: 'add_to_cart',
            productId: '101',
            quantity: 10,
        });

        expect(selectCartSummary(useCommerceStore.getState()).totalItems).toBe(2);
    });

    it('fails closed when action ownership changes while add-to-cart is in flight', async () => {
        vi.spyOn(productApi, 'getProductById').mockResolvedValue({
            id: '101',
            title: 'Aura Phone',
            price: 9999,
            stock: 2,
        });
        let finishAdd;
        let markAddStarted;
        const addStarted = new Promise((resolve) => {
            markAddStarted = resolve;
        });
        const addItem = vi.fn(() => {
            markAddStarted();
            return new Promise((resolve) => {
                finishAdd = resolve;
            });
        });
        const removeItem = vi.fn();
        useCommerceStore.setState({ addItem, removeItem });
        let ownsAction = true;
        const registry = createAssistantActionRegistry({ navigate: vi.fn() });

        const resultPromise = registry.executeAssistantAction({
            type: 'add_to_cart',
            productId: '101',
            quantity: 1,
        }, {
            canExecute: () => ownsAction,
        });
        await addStarted;
        ownsAction = false;
        finishAdd([]);
        const result = await resultPromise;

        expect(addItem).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
            success: false,
            ownershipLost: true,
            message: '',
        });
        expect(removeItem).not.toHaveBeenCalled();
    });

    it('builds query-param navigation paths for profile subroutes', async () => {
        const navigate = vi.fn();
        const registry = createAssistantActionRegistry({
            navigate,
            isAuthenticated: true,
            candidates: [],
        });

        const result = await registry.executeAssistantAction({
            type: 'navigate_to',
            page: 'profile',
            params: {
                tab: 'settings',
            },
        });

        expect(result.success).toBe(true);
        expect(navigate).toHaveBeenCalledWith('/profile?tab=settings');
        expect(result.navigation).toMatchObject({
            page: 'profile',
            path: '/profile?tab=settings',
        });
    });

    it('navigates manifest-backed catalog and account capabilities', async () => {
        const navigate = vi.fn();
        const registry = createAssistantActionRegistry({ navigate });

        await registry.executeAssistantAction({
            type: 'navigate_to',
            page: 'catalog',
            params: { q: 'phones under 30000' },
        });
        await registry.executeAssistantAction({
            type: 'navigate_to',
            page: 'price_alerts',
        });

        expect(navigate).toHaveBeenNthCalledWith(1, '/products?q=phones+under+30000');
        expect(navigate).toHaveBeenNthCalledWith(2, '/price-alerts');
    });

    it('resolves every manifest capability id to its declared app route', async () => {
        const navigate = vi.fn();
        const registry = createAssistantActionRegistry({ navigate });

        for (const capability of APP_ASSISTANT_CAPABILITIES) {
            const params = capability.id === 'category'
                ? { category: 'electronics' }
                : capability.id === 'product'
                    ? { productId: '101' }
                    : capability.id === 'listing'
                        ? { listingId: 'listing-101' }
                        : capability.id === 'seller_profile'
                            ? { sellerId: 'seller-101' }
                            : {};
            await registry.executeAssistantAction({
                type: 'navigate_to',
                page: capability.id,
                params,
            });
            const expectedPath = capability.route
                .replace(':category', 'electronics')
                .replace(':productId', '101')
                .replace(':id', capability.id === 'product'
                    ? '101'
                    : capability.id === 'listing'
                        ? 'listing-101'
                        : 'seller-101');
            expect(navigate).toHaveBeenLastCalledWith(expectedPath);
        }
    });
});
