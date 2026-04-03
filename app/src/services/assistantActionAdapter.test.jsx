import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getProductById: vi.fn(),
    addItem: vi.fn(),
    buildSupportHandoffPath: vi.fn(),
}));

vi.mock('@/services/api', () => ({
    productApi: {
        getProductById: mocks.getProductById,
    },
}));

vi.mock('@/store/commerceStore', () => ({
    selectCartSummary: vi.fn(() => ({
        totalItems: 2,
        itemCount: 1,
        totalPrice: 54999,
        totalOriginalPrice: 59999,
        totalDiscount: 5000,
        currency: 'INR',
    })),
    useCommerceStore: {
        getState: () => ({
            addItem: mocks.addItem,
            cart: {},
        }),
    },
}));

vi.mock('@/utils/assistantCommands', () => ({
    buildSupportHandoffPath: mocks.buildSupportHandoffPath,
}));

import { createAssistantActionAdapter } from './assistantActionAdapter';

describe('assistantActionAdapter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.buildSupportHandoffPath.mockReturnValue('/contact?compose=1&category=orders');
    });

    it('opens a product page for open_product actions', async () => {
        const navigate = vi.fn();
        const adapter = createAssistantActionAdapter({ navigate, isAuthenticated: true });

        const result = await adapter.run({
            type: 'open_product',
            productId: '101',
        });

        expect(navigate).toHaveBeenCalledWith('/product/101');
        expect(result).toMatchObject({
            path: '/product/101',
        });
    });

    it('sends signed-out checkout actions through login with return state', async () => {
        const navigate = vi.fn();
        const adapter = createAssistantActionAdapter({ navigate, isAuthenticated: false });

        const result = await adapter.run({
            type: 'open_checkout',
        });

        expect(navigate).toHaveBeenCalledWith('/login', {
            state: {
                from: {
                    pathname: '/checkout',
                    search: '',
                    hash: '',
                },
            },
        });
        expect(result.message).toMatch(/sign in/i);
    });

    it('adds a product to cart through the normal commerce store flow', async () => {
        const navigate = vi.fn();
        mocks.getProductById.mockResolvedValue({
            id: 88,
            title: 'Aura Phone',
            displayTitle: 'Aura Phone Ultra',
        });

        const adapter = createAssistantActionAdapter({ navigate, isAuthenticated: true });
        const result = await adapter.run({
            type: 'add_to_cart',
            productId: '88',
            quantity: 2,
        });

        expect(mocks.getProductById).toHaveBeenCalledWith('88');
        expect(mocks.addItem).toHaveBeenCalledWith(expect.objectContaining({ id: 88 }), 2);
        expect(result).toMatchObject({
            cartSummary: expect.objectContaining({
                totalItems: 2,
                currency: 'INR',
            }),
        });
    });

    it('builds a structured support handoff path for support actions', async () => {
        const navigate = vi.fn();
        const adapter = createAssistantActionAdapter({ navigate, isAuthenticated: true });

        const result = await adapter.run(
            { type: 'open_support' },
            {
                supportDraft: {
                    category: 'orders',
                    subject: 'Delayed order',
                    body: 'My order is late',
                    relatedOrderId: 'ORD-1',
                },
            }
        );

        expect(mocks.buildSupportHandoffPath).toHaveBeenCalledWith({
            category: 'orders',
            subject: 'Delayed order',
            intent: 'My order is late',
            actionId: 'ORD-1',
        });
        expect(navigate).toHaveBeenCalledWith('/contact?compose=1&category=orders');
        expect(result.path).toBe('/contact?compose=1&category=orders');
    });
});
