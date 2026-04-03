import { beforeEach, describe, expect, it } from 'vitest';
import { resetChatStoreForTests, useChatStore } from './chatStore';

describe('chatStore', () => {
    beforeEach(() => {
        localStorage.clear();
        resetChatStoreForTests();
    });

    it('starts with a focused welcome message', () => {
        const state = useChatStore.getState();

        expect(state.mode).toBe('explore');
        expect(state.messages).toHaveLength(1);
        expect(state.messages[0]).toMatchObject({
            role: 'assistant',
            mode: 'explore',
        });
    });

    it('hydrates context without losing existing state', () => {
        useChatStore.getState().hydrateContext({
            route: '/products',
            cartCount: 2,
            isAuthenticated: true,
        });

        expect(useChatStore.getState().context).toMatchObject({
            route: '/products',
            cartCount: 2,
            isAuthenticated: true,
        });
    });

    it('tracks recovery session memory fields and executed actions', () => {
        useChatStore.getState().appendAssistantTurn({
            text: 'Showing filtered results.',
            assistantTurn: {
                intent: 'product_search',
                decision: 'respond',
                response: 'Showing filtered results.',
                ui: {
                    surface: 'product_results',
                    products: [{ id: '101', title: 'Aura Phone', price: 9999 }],
                },
                sessionMemory: {
                    lastQuery: 'oppo phones',
                    lastResults: [{ id: '101', title: 'Aura Phone', price: 9999 }],
                    activeProduct: { id: '101', title: 'Aura Phone', price: 9999 },
                    lastIntent: 'product_search',
                    clarificationState: {
                        fingerprint: 'clarify:budget',
                        count: 1,
                        lastQuestion: 'Pick a budget',
                    },
                    lastActionFingerprint: 'navigate_to:category:{\"category\":\"electronics\"}',
                    lastActionAt: 1234,
                },
                followUps: ['Show more'],
            },
            assistantSession: {
                sessionId: 'session-1',
                contextVersion: 3,
                lastIntent: 'product_search',
                lastEntities: {
                    query: 'oppo phones',
                    productId: '',
                    category: 'Mobiles',
                    maxPrice: 10000,
                    quantity: 0,
                },
                contextPath: '/category/mobiles',
                pendingAction: null,
                clarificationState: {
                    fingerprint: 'clarify:budget',
                    count: 1,
                    lastQuestion: 'Pick a budget',
                },
                lastResolvedEntityId: '101',
            },
        });

        useChatStore.getState().rememberExecutedAction('add_to_cart:101:1', 4321);

        expect(useChatStore.getState().context.sessionMemory).toMatchObject({
            lastQuery: 'oppo phones',
            lastIntent: 'product_search',
            currentIntent: 'product_search',
            clarificationState: {
                fingerprint: 'clarify:budget',
                count: 1,
                lastQuestion: 'Pick a budget',
            },
            lastActionFingerprint: 'add_to_cart:101:1',
            lastActionAt: 4321,
        });
        expect(useChatStore.getState().context.assistantSession).toMatchObject({
            sessionId: 'session-1',
            contextVersion: 3,
            lastIntent: 'product_search',
            contextPath: '/category/mobiles',
            lastResolvedEntityId: '101',
        });
    });

    it('applies assistant turns as the single active surface', () => {
        useChatStore.getState().appendAssistantTurn({
            text: 'One product is in focus.',
            mode: 'product',
            products: [{ id: '101', title: 'Aura Phone', price: 54999 }],
            primaryAction: { id: 'add', kind: 'add-to-cart' },
            secondaryActions: [
                { id: 'details', kind: 'view-details' },
                { id: 'cart', kind: 'view-cart' },
                { id: 'extra', kind: 'search' },
            ],
        });

        const state = useChatStore.getState();
        expect(state.mode).toBe('product');
        expect(state.visibleProducts).toEqual([
            expect.objectContaining({ id: '101' }),
        ]);
        expect(state.context.activeProductId).toBe('101');
        expect(state.secondaryActions).toHaveLength(2);
    });

    it('resets the conversation while keeping live route context', () => {
        useChatStore.getState().hydrateContext({
            route: '/cart',
            cartCount: 1,
        });
        useChatStore.getState().appendUserMessage('show me something');
        useChatStore.getState().appendAssistantTurn({
            text: 'Done',
            mode: 'cart',
        });

        useChatStore.getState().resetConversation();

        const state = useChatStore.getState();
        expect(state.messages).toHaveLength(1);
        expect(state.context.route).toBe('/cart');
        expect(state.context.cartCount).toBe(1);
        expect(state.mode).toBe('explore');
    });

    it('stores confirmation-gated assistant turns for checkout actions', () => {
        useChatStore.getState().appendAssistantTurn({
            text: 'Checkout affects payment and order placement. Confirm before continuing.',
            assistantTurn: {
                intent: 'checkout',
                decision: 'clarify',
                response: 'Checkout affects payment and order placement. Confirm before continuing.',
                ui: {
                    surface: 'confirmation_card',
                    confirmation: {
                        token: 'confirm-123',
                        message: 'Confirm checkout',
                        action: {
                            type: 'go_to_checkout',
                        },
                    },
                },
                followUps: [],
            },
        });

        const state = useChatStore.getState();
        expect(state.mode).toBe('checkout');
        expect(state.pendingConfirmation).toMatchObject({
            token: 'confirm-123',
        });
        expect(state.lastAssistantTurn).toMatchObject({
            intent: 'checkout',
            decision: 'clarify',
        });
    });

    it('tracks streaming assistant tokens and stream metadata before finalization', () => {
        const streamId = useChatStore.getState().beginAssistantStream();

        useChatStore.getState().mergeAssistantStreamEvent(streamId, 'tool_start', {
            toolName: 'search_code_chunks',
            status: 'running',
            input: {
                query: 'checkout flow',
            },
        });
        useChatStore.getState().appendAssistantStreamToken(streamId, 'Hello');
        useChatStore.getState().appendAssistantStreamToken(streamId, ' world');
        useChatStore.getState().mergeAssistantStreamEvent(streamId, 'citation', {
            id: 'server/app.js:10',
            label: 'server/app.js:10',
            path: 'server/app.js',
            startLine: 10,
            endLine: 20,
        });
        useChatStore.getState().mergeAssistantStreamEvent(streamId, 'verification', {
            label: 'app_grounded',
            summary: 'Verified against indexed app evidence.',
            evidenceCount: 1,
        });

        const streamingMessage = useChatStore.getState().messages.find((message) => message.id === streamId);
        expect(streamingMessage).toMatchObject({
            isStreaming: true,
            text: 'Hello world',
            assistantTurn: {
                response: 'Hello world',
                verification: {
                    label: 'app_grounded',
                },
            },
        });
        expect(streamingMessage.assistantTurn.toolRuns).toHaveLength(1);
        expect(streamingMessage.assistantTurn.citations).toHaveLength(1);

        useChatStore.getState().discardAssistantStream(streamId);
        expect(useChatStore.getState().messages.find((message) => message.id === streamId)).toBeUndefined();
    });
});
