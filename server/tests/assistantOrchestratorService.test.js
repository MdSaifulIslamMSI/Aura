jest.mock('../services/ai/providerRegistry', () => ({
    createVoiceSessionConfig: jest.fn(),
    generateStructuredResponse: jest.fn(),
    getCapabilitySnapshot: jest.fn(() => ({})),
    synthesizeSpeech: jest.fn(),
}));

jest.mock('../services/catalogService', () => ({
    getProductByIdentifier: jest.fn(),
    queryProducts: jest.fn(),
}));

jest.mock('../services/intelligence/intelligenceGatewayService', () => ({
    requestCentralIntelligenceTurn: jest.fn(),
    shouldUseCentralIntelligence: jest.fn(() => false),
    streamCentralIntelligenceTurn: jest.fn(),
}));

const { getProductByIdentifier } = require('../services/catalogService');
const {
    requestCentralIntelligenceTurn,
    shouldUseCentralIntelligence,
} = require('../services/intelligence/intelligenceGatewayService');
const { processAssistantTurn } = require('../services/ai/assistantOrchestratorService');

describe('assistantOrchestratorService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        shouldUseCentralIntelligence.mockReturnValue(false);
    });

    test('backend confirmation round-trip keeps session authority for risky actions', async () => {
        getProductByIdentifier.mockResolvedValue({
            id: 'iphone-15',
            title: 'Apple iPhone 15',
            brand: 'Apple',
            category: 'Mobiles',
            price: 69999,
        });

        const first = await processAssistantTurn({
            message: 'add this to cart',
            assistantMode: 'chat',
            context: {
                currentProductId: 'iphone-15',
                currentProduct: {
                    id: 'iphone-15',
                    title: 'Apple iPhone 15',
                    brand: 'Apple',
                    category: 'Mobiles',
                },
            },
        });

        expect(first.assistantTurn).toMatchObject({
            intent: 'cart_action',
            decision: 'clarify',
            ui: {
                surface: 'confirmation_card',
                confirmation: {
                    action: {
                        type: 'add_to_cart',
                        productId: 'iphone-15',
                    },
                },
            },
        });
        expect(first.assistantSession).toMatchObject({
            sessionId: expect.any(String),
            pendingAction: expect.objectContaining({
                actionId: expect.any(String),
                actionType: 'ADD_TO_CART',
            }),
        });
        expect(first.assistantTurn.ui.confirmation.token).toBe(first.assistantSession.pendingAction.actionId);

        const confirmed = await processAssistantTurn({
            message: '',
            assistantMode: 'chat',
            sessionId: first.assistantSession.sessionId,
            confirmation: {
                actionId: first.assistantTurn.ui.confirmation.token,
                approved: true,
                contextVersion: first.assistantSession.contextVersion,
            },
            context: {},
        });

        expect(confirmed.assistantTurn).toMatchObject({
            intent: 'cart_action',
            decision: 'act',
            actions: [
                {
                    type: 'add_to_cart',
                    productId: 'iphone-15',
                },
            ],
            policy: {
                decision: 'EXECUTE',
                reason: 'confirmed_by_user',
            },
        });
        expect(confirmed.assistantSession.pendingAction).toBeNull();
        expect(confirmed.assistantSession.executedActionIds).toContain(first.assistantTurn.ui.confirmation.token);
    });

    test('explicit checkout action request is confirmed by the backend session policy', async () => {
        const result = await processAssistantTurn({
            message: '',
            assistantMode: 'chat',
            actionRequest: {
                type: 'checkout',
            },
            context: {},
        });

        expect(result.assistantTurn).toMatchObject({
            intent: 'navigation',
            decision: 'clarify',
            ui: {
                surface: 'confirmation_card',
                confirmation: {
                    action: {
                        type: 'navigate_to',
                        page: 'checkout',
                    },
                },
            },
            policy: {
                actionType: 'CHECKOUT',
                risk: 'CRITICAL',
                decision: 'CONFIRM',
            },
        });
        expect(result.assistantSession).toMatchObject({
            sessionId: expect.any(String),
            pendingAction: expect.objectContaining({
                actionType: 'CHECKOUT',
            }),
        });
    });

    test('falls back to local recovery when central intelligence is unavailable for normal chat', async () => {
        shouldUseCentralIntelligence.mockReturnValue(true);
        requestCentralIntelligenceTurn.mockResolvedValue({
            answer: 'The system-aware intelligence layer is unavailable right now, so I cannot verify repo-grounded details.',
            assistantTurn: {
                intent: 'general_knowledge',
                decision: 'respond',
                response: 'The system-aware intelligence layer is unavailable right now, so I cannot verify repo-grounded details.',
                ui: {
                    surface: 'plain_answer',
                },
                followUps: [],
            },
            grounding: {
                status: 'cannot_verify',
                reason: 'service_unavailable',
                traceId: 'trace_test',
            },
        });

        const result = await processAssistantTurn({
            message: 'hello',
            assistantMode: 'chat',
            context: {
                sessionMemory: {
                    lastQuery: 'iphone',
                    lastResults: [{
                        id: 'iphone-15',
                        title: 'Apple iPhone 15',
                        brand: 'Apple',
                        category: 'Mobiles',
                    }],
                    activeProduct: null,
                    currentIntent: 'product_search',
                },
            },
        });

        expect(requestCentralIntelligenceTurn).toHaveBeenCalled();
        expect(result.assistantTurn).toMatchObject({
            intent: 'general_knowledge',
            decision: 'respond',
            ui: {
                surface: 'plain_answer',
            },
        });
        expect(result.answer).toBe('Hi. I can help with shopping, navigation, and live app questions.');
    });

    test('preserves cannot-verify response for system-aware questions when central intelligence is unavailable', async () => {
        shouldUseCentralIntelligence.mockReturnValue(true);
        requestCentralIntelligenceTurn.mockResolvedValue({
            answer: 'The system-aware intelligence layer is unavailable right now, so I cannot verify repo-grounded details.',
            assistantTurn: {
                intent: 'general_knowledge',
                decision: 'respond',
                response: 'The system-aware intelligence layer is unavailable right now, so I cannot verify repo-grounded details.',
                ui: {
                    surface: 'plain_answer',
                },
                followUps: [],
            },
            grounding: {
                status: 'cannot_verify',
                reason: 'service_unavailable',
                traceId: 'trace_test',
            },
        });

        const result = await processAssistantTurn({
            message: 'why is cart failing',
            assistantMode: 'chat',
            context: {},
        });

        expect(result.grounding).toMatchObject({
            status: 'cannot_verify',
            reason: 'service_unavailable',
        });
        expect(result.answer).toBe('The system-aware intelligence layer is unavailable right now, so I cannot verify repo-grounded details.');
    });
});
