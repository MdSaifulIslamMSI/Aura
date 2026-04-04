import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetChatStoreForTests, useChatStore } from '../../../store/chatStore';
import {
    resetCommerceStoreForTests,
    selectCartSummary,
    useCommerceStore,
} from '../../../store/commerceStore';
import { createAssistantActionRegistry } from './assistantActionRegistry';

describe('assistantActionRegistry', () => {
    beforeEach(() => {
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
});
