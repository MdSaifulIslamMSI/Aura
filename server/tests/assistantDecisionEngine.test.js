jest.mock('../services/ai/providerRegistry', () => ({
    generateStructuredResponse: jest.fn().mockResolvedValue({
        payload: null,
        provider: 'local',
        model: 'local',
        rawText: '',
        errors: [],
    }),
}));

const {
    buildDeterministicClassification,
    planAssistantTurn,
} = require('../services/ai/assistantDecisionEngine');

describe('assistantDecisionEngine', () => {
    test('classifies general knowledge questions deterministically', () => {
        const result = buildDeterministicClassification({
            message: 'What is AI?',
            assistantMode: 'chat',
            context: {},
        });

        expect(result.intent).toBe('general_knowledge');
        expect(result.entities.category).toBe('');
        expect(result.entities.priceMax).toBe(0);
    });

    test('extracts product search entities from budget queries', () => {
        const result = buildDeterministicClassification({
            message: 'Best phones under 20000',
            assistantMode: 'chat',
            context: {},
        });

        expect(result.intent).toBe('product_search');
        expect(result.entities.category).toBe('Mobiles');
        expect(result.entities.priceMax).toBe(20000);
    });

    test('routes cart navigation requests through navigation intent', () => {
        const result = buildDeterministicClassification({
            message: 'Show my cart',
            assistantMode: 'chat',
            context: {},
        });

        expect(result.intent).toBe('navigation');
        expect(result.entities.page).toBe('cart');
    });

    test('plans checkout as a confirmation-gated clarification', () => {
        const turn = planAssistantTurn({
            message: 'Take me to checkout',
            classification: {
                intent: 'checkout',
                confidence: 0.98,
                entities: {},
                needsClarification: false,
            },
            enriched: {
                assistantMode: 'chat',
                cartSummary: {
                    itemCount: 2,
                    subtotal: 49999,
                },
            },
        });

        expect(turn.decision).toBe('clarify');
        expect(turn.ui.surface).toBe('confirmation_card');
        expect(turn.ui.confirmation.action.type).toBe('go_to_checkout');
        expect(turn.contextPatch.pendingConfirmation.token).toBeTruthy();
    });

    test('plans order tracking as a support action', () => {
        const turn = planAssistantTurn({
            message: 'Track my order 123',
            classification: {
                intent: 'support',
                confidence: 0.95,
                entities: {
                    orderId: '123',
                },
                needsClarification: false,
            },
            enriched: {
                assistantMode: 'chat',
                supportPrefill: {
                    category: 'delivery',
                    body: 'Track my order 123',
                    intent: 'support',
                },
            },
        });

        expect(turn.decision).toBe('act');
        expect(turn.actions[0].type).toBe('track_order');
        expect(turn.actions[0].orderId).toBe('123');
        expect(turn.ui.surface).toBe('support_handoff');
    });
});
