import { describe, expect, it } from 'vitest';
import {
    buildAssistantRequestPayload,
    buildLocalAssistantResponse,
    buildNonExecutableAssistantTurn,
    buildModeActions,
    buildSuggestionActions,
    buildSupportHandoffPath,
    buildUnavailableAssistantResponse,
    capVisibleActions,
    deriveAssistantMode,
    normalizeProductSummary,
    normalizeBackendActions,
    parseAssistantCommand,
} from './assistantCommands';

describe('assistantCommands', () => {
    it('keeps explicit search commands in the guided chat flow', () => {
        expect(parseAssistantCommand('search for wireless earbuds')).toMatchObject({
            type: 'search',
            query: 'wireless earbuds',
        });
    });

    it('routes order issues into support mode locally', () => {
        expect(buildLocalAssistantResponse('I need help with a delayed order', {
            cartCount: 1,
        })).toMatchObject({
            local: true,
            mode: 'support',
            supportPrefill: expect.objectContaining({
                category: 'orders',
            }),
            primaryAction: expect.objectContaining({
                kind: 'handoff-support',
            }),
        });
    });

    it.each([
        ['open wishlist', 'wishlist'],
        ['show my orders', 'orders'],
        ['open profile', 'profile'],
        ['open compare', 'compare'],
        ['show deals', 'deals'],
        ['show trending', 'trending'],
        ['show new arrivals', 'new_arrivals'],
        ['open price alerts', 'price_alerts'],
        ['start trade-in', 'trade_in'],
        ['become a seller', 'become_seller'],
        ['sell my phone', 'sell'],
        ['my listings', 'my_listings'],
    ])('recognizes the manifest-backed local app command %s', (input, capabilityId) => {
        expect(parseAssistantCommand(input)).toMatchObject({
            type: 'capability',
            capability: {
                id: capabilityId,
            },
        });
    });

    it('answers what can I do here with route and cart facts', () => {
        const response = buildLocalAssistantResponse('what can I do here?', {
            pathname: '/cart',
            cartCount: 2,
            cartSummary: {
                totalItems: 2,
                itemCount: 1,
                totalPrice: 19998,
                totalDiscount: 2000,
            },
        });

        expect(response).toMatchObject({
            local: true,
            mode: 'explore',
            primaryAction: expect.objectContaining({
                kind: 'navigate',
            }),
        });
        expect(response.answer).toContain('You are on Cart');
        expect(response.answer).toContain('2 items');
        expect(response.answer).toContain('Rs 19,998');
        expect(response.answer).toContain('will not invent');
    });

    it('explains manifest prerequisites without claiming a sensitive action ran', () => {
        const response = buildLocalAssistantResponse('open price alerts', {
            isAuthenticated: false,
        });

        expect(response).toMatchObject({
            local: true,
            primaryAction: expect.objectContaining({
                kind: 'navigate',
                payload: {
                    page: 'price_alerts',
                    params: {},
                },
            }),
        });
        expect(response.answer).toContain('Sign-in is required');
        expect(response.answer).toContain('verified by that page');
    });

    it('provides useful and honest no-service responses for search, media, and checkout', () => {
        const search = buildUnavailableAssistantResponse('find phones under Rs 30000');
        expect(search.answer).toContain('have not invented products');
        expect(search.primaryAction).toMatchObject({
            kind: 'navigate',
            payload: {
                page: 'search',
                params: {
                    q: 'phones under Rs 30000',
                },
            },
        });

        const media = buildUnavailableAssistantResponse('', { hasMedia: true });
        expect(media.answer).toContain('was not analyzed');
        expect(media.primaryAction).toBeNull();

        const checkout = buildUnavailableAssistantResponse('checkout', {
            cartCount: 2,
            cartSummary: {
                totalItems: 2,
                totalPrice: 45000,
            },
        });
        expect(checkout.answer).toContain('2 items');
        expect(checkout.answer).toContain('Rs 45,000');
        expect(checkout.answer).toContain('verify stock');
    });

    it('removes stale executable UI from a response after session focus is lost', () => {
        expect(buildNonExecutableAssistantTurn({
            decision: 'confirm',
            actionRequest: { type: 'cancel_order', orderId: 'order-1' },
            actions: [{ type: 'navigate_to', page: 'orders' }],
            ui: {
                surface: 'confirmation_card',
                confirmation: { token: 'stale-token' },
                navigation: { page: 'orders' },
            },
            followUps: ['Yes'],
        }, 'Return to this thread and ask again.')).toMatchObject({
            decision: 'respond',
            actionRequest: null,
            actions: [],
            confirmation: null,
            navigation: null,
            response: 'Return to this thread and ask again.',
            ui: {
                surface: 'plain_answer',
                confirmation: null,
                navigation: null,
            },
            followUps: [],
        });
    });

    it('derives hidden compare mode only when enough candidate products exist', () => {
        expect(deriveAssistantMode({
            message: 'compare the two best phones',
            candidateProductIds: ['101', '202'],
        })).toBe('compare');

        expect(deriveAssistantMode({
            message: 'compare the two best phones',
            candidateProductIds: ['101'],
        })).toBe('chat');
    });

    it('derives hidden bundle mode from budget language', () => {
        expect(deriveAssistantMode({
            message: 'show me something under Rs 50000',
            candidateProductIds: [],
        })).toBe('bundle');
    });

    it('builds request payloads with normalized product ids and route context', () => {
        const payload = buildAssistantRequestPayload({
            message: 'compare these laptops',
            pathname: '/products',
            candidateProductIds: ['501', '502'],
            latestProducts: [{ id: 501, brand: 'Aura' }, { _id: 502, brand: 'Prime' }],
        });

        expect(payload.assistantMode).toBe('compare');
        expect(payload.context.productIds).toEqual(['501', '502']);
        expect(payload.context.routeLabel).toBe('Catalog');
    });

    it('preserves grounded assistant product fit metadata', () => {
        expect(normalizeProductSummary({
            id: 501,
            title: 'Aura Laptop',
            assistantRank: 1,
            assistantReason: 'within Rs 60000',
            assistantWatchout: 'low review depth',
            deliveryTime: 'Usually dispatches in 2 days',
            warranty: '1 year manufacturer warranty',
        })).toMatchObject({
            id: '501',
            assistantRank: 1,
            assistantReason: 'within Rs 60000',
            assistantWatchout: 'low review depth',
            deliveryTime: 'Usually dispatches in 2 days',
            warranty: '1 year manufacturer warranty',
        });
    });

    it('normalizes only supported backend actions', () => {
        expect(normalizeBackendActions([
            { type: 'open_voice_assistant' },
            { type: 'navigate', path: '/cart' },
            { type: 'open_product', productId: '333' },
        ])).toEqual([
            expect.objectContaining({ kind: 'view-cart' }),
            expect.objectContaining({ kind: 'view-details', payload: { id: '333' } }),
        ]);
    });

    it('builds support handoff urls with support-tab prefill', () => {
        expect(buildSupportHandoffPath({
            category: 'orders',
            subject: 'Support: Delayed order',
            intent: 'Delayed order',
        })).toBe('/contact?compose=1&category=orders&subject=Support%3A+Delayed+order&intent=Delayed+order');
    });

    it('caps visible actions to three choices', () => {
        expect(capVisibleActions([
            { id: 'a' },
            { id: 'b' },
            { id: 'c' },
            { id: 'd' },
        ])).toHaveLength(3);
    });

    it('keeps product mode limited to purchase and detail actions', () => {
        const actions = buildModeActions({
            mode: 'product',
            products: [{ id: '11', title: 'Focus Phone', price: 49999 }],
            cartCount: 0,
        });

        expect(actions.primaryAction).toMatchObject({ kind: 'add-to-cart' });
        expect(actions.secondaryActions).toEqual([
            expect.objectContaining({ kind: 'view-details' }),
        ]);
    });

    it('ignores question-style follow-up suggestions', () => {
        expect(buildSuggestionActions([
            'Need more details on a specific product?',
            'Show deals',
        ])).toEqual([
            expect.objectContaining({ kind: 'navigate', payload: expect.objectContaining({ page: 'deals' }) }),
        ]);
    });

    it('turns manifest-backed page suggestions into direct user-triggered navigation', () => {
        expect(buildSuggestionActions(['Open Price alerts'])).toEqual([
            expect.objectContaining({
                kind: 'navigate',
                payload: {
                    page: 'price_alerts',
                    params: {},
                },
            }),
        ]);
    });

    it('preserves category params for browse suggestions', () => {
        expect(buildSuggestionActions([
            'Browse electronics',
        ])).toEqual([
            expect.objectContaining({
                kind: 'navigate',
                payload: expect.objectContaining({
                    page: 'category',
                    path: '/category/electronics',
                    params: {
                        category: 'electronics',
                    },
                }),
            }),
        ]);
    });
});
