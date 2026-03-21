import { describe, expect, it } from 'vitest';
import {
    buildAssistantRequestPayload,
    buildLocalAssistantResponse,
    buildModeActions,
    buildSuggestionActions,
    buildSupportHandoffPath,
    capVisibleActions,
    deriveAssistantMode,
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
        })).toBe('/profile?tab=support&compose=1&category=orders&subject=Support%3A+Delayed+order&intent=Delayed+order');
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
